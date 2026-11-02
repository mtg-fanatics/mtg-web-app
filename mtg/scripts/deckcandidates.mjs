// Which old official decks (from the MTGJSON cache that `import.mjs decks` fills) are closest to being playable, and what is missing? Run from the mtg folder:
//   node scripts/deckcandidates.mjs                       the Theme Decks with at most 12 cards the engine can't play yet, and the reasons ranked
//   TYPES="Theme Deck,Starter Deck" MAXMISS=4 TOP=40 node scripts/deckcandidates.mjs
//   TEXT="Bomber|Sky Slam" node scripts/deckcandidates.mjs   the text of the missing cards of those decks
//   DUMP=some/folder node scripts/deckcandidates.mjs         writes every fully playable deck as a list of card ids (60 cards: topped up with basic lands), to play it with
//                                                            FUZZ_DECK=<file> npx tsx scripts/fuzz.ts (in packages/engine)
// (decksurvey.mjs does the same for the decks that are already in the database.) It reads the oracle cards and the decks from mtg/.import-cache, so no key is needed.
// Imports real MTG data into Supabase. Run from the mtg folder:
//
//   node scripts/import.mjs cards   [--limit N] [--dry-run]   cards from Scryfall
//   node scripts/import.mjs images  [--limit N] [--dry-run]   small card images -> Storage bucket "card-art"
//   node scripts/import.mjs decks   [--dry-run] [--hide-stale] official decks from MTGJSON (see KEEP_DECKS)
//
// Order matters: cards, then images, then decks. Every phase can be re-run safely and
// `images` resumes where it stopped. --dry-run needs no Supabase key and writes nothing.
// --hide-stale unlists the other official decks instead of deleting them (setting official back to true restores one).
// Needs SUPABASE_SECRET_KEY in mtg/.env.local (server-only: no NEXT_PUBLIC_ prefix!).
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { isSupportedCard } from "@mtg/engine";

const UA = "MTGDuelPersonalProject/0.1 (personal, non-commercial)";
const CACHE = path.resolve(".import-cache");
const BUCKET = "card-art";

const args = process.argv.slice(2);
const phase = "x";
const dryRun = args.includes("--dry-run");
const hideStale = args.includes("--hide-stale");
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

// ───────── helpers ─────────
function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in mtg/.env.local");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function withRetry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 500 * i * i));
    }
  }
}

async function get(url, accept = "*/*", timeoutMs = 30_000) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

const getJson = (url) => withRetry(async () => (await get(url, "application/json")).json());

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ───────── Scryfall -> card rows ─────────
const SKIP_LAYOUTS = new Set([
  "token", "double_faced_token", "emblem", "art_series", "vanguard", "planar", "scheme", "augment", "host", "reversible_card",
]);
const TYPE_ORDER = [
  ["Land", "land"], ["Creature", "creature"], ["Planeswalker", "planeswalker"], ["Instant", "instant"],
  ["Sorcery", "sorcery"], ["Enchantment", "enchantment"], ["Artifact", "artifact"], ["Battle", "battle"],
];

const slugBase = (name) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "card";

/** Streams the Scryfall oracle bulk file (one card per unique card) and keeps only what we need. */
async function loadOracle() {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, fs.readdirSync(CACHE).filter((f) => f.startsWith("oracle-cards") && f.endsWith(".jsonl.gz")).sort().pop());
  const out = [];
  const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (SKIP_LAYOUTS.has(c.layout)) continue;
    const front = c.card_faces?.[0];
    out.push({
      oracle_id: c.oracle_id,
      scryfall_id: c.id,
      name: c.name,
      layout: c.layout,
      multiFace: Boolean(c.card_faces),
      type_line: c.type_line,
      frontType: front?.type_line ?? c.type_line,
      mana_cost: c.mana_cost ?? front?.mana_cost ?? "",
      cmc: c.cmc ?? 0,
      colors: c.colors ?? front?.colors ?? [],
      text: c.oracle_text ?? (c.card_faces ? c.card_faces.map((f) => f.oracle_text ?? "").join("\n//\n") : ""),
      rarity: c.rarity,
      set: c.set,
      keywords: c.keywords ?? [],
      power: c.power ?? front?.power ?? null,
      toughness: c.toughness ?? front?.toughness ?? null,
      loyalty: c.loyalty ?? front?.loyalty ?? null,
      small: c.image_uris?.small ?? front?.image_uris?.small ?? null,
    });
  }
  return out;
}

/**
 * Can the game engine play this card today? The engine itself decides: it reads the card's rules text and
 * only accepts a card when every line of it is understood (see packages/engine/src/oracle.ts).
 */
function isPlayable(c, type) {
  // A prepare card is one creature card with a spell beside it: the engine reads both halves from the joined text.
  // An Adventure card is the same: a creature with its Adventure spell beside it.
  // A Case is one face; its "To solve" and "Solved" lines are read like any other. So is a Class, level by level.
  // A transforming card (Fable of the Mirror-Breaker) and a modal double-faced land (a Pathway) have both faces in the joined
  // text: the engine knows which of them it can play (packages/engine/src/oracle/doubleFaced.ts) and rejects the others.
  const landPair = c.layout === "modal_dfc" && c.type_line.split(" // ").every((t) => /^Land\b/.test(t));
  if (!["normal", "prepare", "adventure", "case", "class", "transform"].includes(c.layout) && !landPair) return false;
  if (!["land", "creature", "artifact", "enchantment", "planeswalker", "instant", "sorcery"].includes(type)) return false;
  return isSupportedCard({
    id: "check",
    name: c.name,
    type,
    cost: Math.round(c.cmc),
    power: /^\d+$/.test(c.power ?? "") ? Number(c.power) : undefined,
    toughness: /^\d+$/.test(c.toughness ?? "") ? Number(c.toughness) : undefined,
    loyalty: /^\d+$/.test(c.loyalty ?? "") ? Number(c.loyalty) : undefined,
    typeLine: c.type_line,
    manaCost: c.mana_cost,
    text: c.text,
    keywords: c.keywords.map((k) => k.toLowerCase()),
  });
}

/**
 * Ids already in the database, by Scryfall oracle id. A card keeps its id forever: decks and saved games point at
 * it, and a new card with the same name must not change the id of an old one.
 */
async function loadExistingIds() {
  const supabase = db();
  const existing = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("cards").select("id, oracle_id").not("oracle_id", "is", null).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data) existing.set(row.oracle_id, row.id);
    if (data.length < 1000) break;
  }
  return existing;
}

/**
 * Turns oracle cards into database rows, with readable unique ids like "lightning-bolt".
 * `existing` (oracle id -> id already in the database) keeps old cards on their old ids; only new cards get new ids.
 */
function buildRows(oracle, existing = new Map()) {
  const counts = new Map();
  for (const c of oracle) counts.set(slugBase(c.name), (counts.get(slugBase(c.name)) ?? 0) + 1);
  const taken = new Set(existing.values());

  return oracle.map((c) => {
    const base = slugBase(c.name);
    let id = existing.get(c.oracle_id);
    if (!id) {
      id = counts.get(base) > 1 ? `${base}-${c.oracle_id.slice(0, 8)}` : base;
      if (taken.has(id)) id = `${base}-${c.oracle_id.slice(0, 8)}`; // the plain name already belongs to another card
      taken.add(id);
    }
    const front = c.frontType.split("—")[0];
    const type = TYPE_ORDER.find(([word]) => front.includes(word))?.[1] ?? "other";
    return {
      id,
      name: c.name,
      type,
      cost: Math.round(c.cmc),
      power: /^\d+$/.test(c.power ?? "") ? Number(c.power) : null,
      // A planeswalker has no toughness: its starting loyalty is kept in that column (the game reads it back as loyalty).
      toughness: type === "planeswalker" ? (/^\d+$/.test(c.loyalty ?? "") ? Number(c.loyalty) : null) : /^\d+$/.test(c.toughness ?? "") ? Number(c.toughness) : null,
      type_line: c.type_line,
      mana_cost: c.mana_cost,
      cmc: c.cmc,
      colors: c.colors,
      oracle_text: c.text,
      rarity: c.rarity,
      set_code: c.set,
      keywords: c.keywords,
      oracle_id: c.oracle_id,
      scryfall_id: c.scryfall_id,
      playable: isPlayable(c, type),
      _small: c.small, // not a column: stripped before saving
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const stripPrivate = ({ _small, ...row }) => row;

import { failedSentences, keywordsSupported, parseCard } from "@mtg/engine";
const oracleList = await loadOracle();
const layoutOf = new Map(oracleList.map((c) => [c.oracle_id, c.layout]));
const rows = buildRows(oracleList);
const byOracle = new Map(rows.map((r) => [r.oracle_id, r]));
const rawByName = new Map();
const TYPES = new Set((process.env.TYPES ?? "Theme Deck").split(","));
const want = Number(process.env.MAXMISS ?? 12);
const decks = [];
for (const f of fs.readdirSync(path.join(CACHE, "decks"))) {
  const d = JSON.parse(fs.readFileSync(path.join(CACHE, "decks", f), "utf8"));
  if (!TYPES.has(d.type)) continue;
  const main = new Map();
  for (const c of d.mainBoard ?? []) { const r = byOracle.get(c.identifiers?.scryfallOracleId); if (!r) { main.set("?" + c.name, { r: { name: c.name, id: "?", playable: false, type: "other", missingRow: true }, n: c.count }); continue; } const e = main.get(r.id) ?? { r, n: 0 }; e.n += c.count; main.set(r.id, e); }
  const size = [...main.values()].reduce((n, e) => n + e.n, 0);
  const bad = [...main.values()].filter((e) => !e.r.playable);
  decks.push({ file: f.replace(".json", ""), name: d.name, code: d.code, date: d.releaseDate, size, bad, main });
}
decks.sort((a, b) => a.bad.length - b.bad.length || a.name.localeCompare(b.name));
console.log(decks.length, "decks of", [...TYPES].join(","), "; playable already:", decks.filter((d) => d.bad.length === 0).length);
const defOf = (r) => ({ id: "x", name: r.name, type: r.type, cost: Math.round(r.cmc), power: /^\d+$/.test(r.power ?? "") ? Number(r.power) : undefined, toughness: /^\d+$/.test(r.toughness ?? "") ? Number(r.toughness) : undefined, loyalty: /^\d+$/.test(r.loyalty ?? "") ? Number(r.loyalty) : undefined, typeLine: r.type_line, manaCost: r.mana_cost, colors: r.colors, text: r.oracle_text, keywords: r.keywords.map((k) => k.toLowerCase()) });
const why = (r) => { if (r.missingRow) return ["no card row"]; if (!["land","creature","artifact","enchantment","planeswalker","instant","sorcery"].includes(r.type)) return ["type " + r.type]; if (!["normal","prepare","adventure","case","class","transform"].includes(layoutOf.get(r.oracle_id))) return ["layout " + layoutOf.get(r.oracle_id)]; const d = defOf(r); const out = []; for (const k of d.keywords) if (!keywordsSupported({ ...d, keywords: [k] })) out.push("keyword: " + k); for (const s of failedSentences(d)) out.push("text: " + s.replace(/\d+/g, "N").slice(0, 90)); if (!out.length) out.push("line: " + parseCard(d).unsupported.map((l) => l.slice(0, 80)).join(" | ")); return out; };
const reasonDecks = new Map();
for (const d of decks) { if (d.bad.length === 0 || d.bad.length > want || d.size < 40) continue; for (const e of d.bad) for (const w of why(e.r)) { const x = reasonDecks.get(w) ?? { decks: new Set(), cards: new Set() }; x.decks.add(d.name + " [" + d.code + "]"); x.cards.add(e.r.name); reasonDecks.set(w, x); } }
for (const d of decks.filter((d) => d.bad.length > 0 && d.bad.length <= want && d.size >= 40)) console.log(`${String(d.bad.length).padStart(3)} ${d.name} [${d.code} ${d.date}] ${d.size}c :: ` + d.bad.map((e) => e.r.name + " ×" + e.n).join("; "));
console.log("\nreasons:");
for (const [w, x] of [...reasonDecks].sort((a, b) => b[1].decks.size - a[1].decks.size).slice(0, Number(process.env.TOP ?? 60))) console.log(String(x.decks.size).padStart(3), String(x.cards.size).padStart(3), w, "  e.g.", [...x.cards][0]);
if (process.env.TEXT) {
  const names = new Set(process.env.TEXT.split("|"));
  const shown = new Set();
  for (const d of decks) { if (!names.has(d.name)) continue; console.log("\n## " + d.name + " " + d.size); for (const e of d.bad) { if (shown.has(e.r.name)) { console.log("  (see above) " + e.r.name); continue; } shown.add(e.r.name); console.log("  " + e.n + "x " + e.r.name + " " + e.r.mana_cost + " | " + e.r.type_line + " | " + (e.r.oracle_text ?? "").replace(/\n/g, " / ") + "  ## " + why(e.r).join(" ## ")); } }
}
if (process.env.DUMP) {
  fs.mkdirSync(process.env.DUMP, { recursive: true });
  const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const colorOf = { W: "plains", U: "island", B: "swamp", R: "mountain", G: "forest" };
  const only = process.env.ONLY ? new Set(process.env.ONLY.split("|")) : null;
  for (const d of decks) {
    if (d.bad.length > 0 || (only && !only.has(d.name))) continue;
    const ids = [];
    const weight = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const e of d.main.values()) { for (let i = 0; i < e.n; i++) ids.push(slug(e.r.name)); if (e.r.type !== "land") for (const c of e.r.colors) weight[c] += e.n; }
    const need = 60 - ids.length;
    const total = Object.values(weight).reduce((a, b) => a + b, 0) || 1;
    let left = need;
    const entries = Object.entries(weight).filter(([, w]) => w > 0);
    for (const [c, w] of entries) { const n = Math.floor((w / total) * need); for (let i = 0; i < n; i++) ids.push(colorOf[c]); left -= n; }
    for (let i = 0; left > 0; i++, left--) ids.push(colorOf[entries[i % entries.length][0]]);
    fs.writeFileSync(process.env.DUMP + "/" + d.file + ".json", JSON.stringify(ids));
  }
  console.log("dumped decks to", process.env.DUMP);
}
