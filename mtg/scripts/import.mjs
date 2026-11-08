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
const phase = args[0];
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
  const meta = await getJson("https://api.scryfall.com/bulk-data");
  const bulk = meta.data.find((x) => x.type === "oracle_cards");
  const file = path.join(CACHE, path.basename(new URL(bulk.jsonl_download_uri).pathname));
  if (!fs.existsSync(file)) {
    console.log(`Downloading Scryfall oracle cards (${(bulk.compressed_size / 1e6).toFixed(0)} MB)...`);
    const res = await get(bulk.jsonl_download_uri, "*/*", 300_000);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }

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
      standard: c.legalities?.standard === "legal",
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
      standard_legal: c.standard,
      printings: [],
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

/**
 * Every set each card was printed in (lowercase codes), from MTGJSON's AtomicCards file (about 45 MB, cached): the Scryfall file has
 * one printing per card, so "the Foundations cards" would miss the ones reprinted since. Names are the key; a failure leaves the lists empty.
 */
async function loadPrintings() {
  const file = path.join(CACHE, "AtomicCards.json.gz");
  try {
    if (!fs.existsSync(file)) {
      console.log("Downloading MTGJSON AtomicCards (the sets of every card)...");
      const res = await get("https://mtgjson.com/api/v5/AtomicCards.json.gz", "*/*", 600_000);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const { data } = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
    const out = new Map();
    for (const [name, faces] of Object.entries(data)) out.set(name, [...new Set(faces.flatMap((f) => f.printings ?? []).map((x) => x.toLowerCase()))]);
    return out;
  } catch (e) {
    console.warn(`Could not read the sets of each card (${e.message}): the Set filter will only see each card's newest set.`);
    return new Map();
  }
}

// ───────── phases ─────────
async function importCards() {
  const rows = buildRows(await loadOracle(), dryRun ? new Map() : await loadExistingIds()).slice(0, limit);
  const printings = await loadPrintings();
  for (const r of rows) r.printings = printings.get(r.name) ?? [r.set_code];
  const playable = rows.filter((r) => r.playable);
  console.log(`${rows.length} cards, ${playable.length} playable by the engine.`);
  if (dryRun) {
    console.log("types:", Object.entries(Object.groupBy(rows, (r) => r.type)).map(([k, v]) => `${k} ${v.length}`).join(", "));
    console.log("sample:", stripPrivate(rows.find((r) => r.id === "lightning-bolt") ?? rows[0]));
    for (const id of ["mountain", "forest", "grizzly-bears", "hill-giant", "mons-s-goblin-raiders", "rumbling-baloth"])
      console.log(`starter card ${id}:`, rows.find((r) => r.id === id) ? `exists, playable=${rows.find((r) => r.id === id).playable}` : "not in Scryfall (your custom row stays)");
    return;
  }
  const supabase = db();
  let done = 0;
  for (const batch of chunks(rows, 500)) {
    const { error } = await withRetry(() => supabase.from("cards").upsert(batch.map(stripPrivate), { onConflict: "id" }));
    if (error) throw new Error(error.message);
    done += batch.length;
    console.log(`cards ${done}/${rows.length}`);
  }
}

async function importImages() {
  const rows = buildRows(await loadOracle(), dryRun ? new Map() : await loadExistingIds());
  const byId = new Map(rows.map((r) => [r.id, r]));

  let todo;
  if (dryRun) {
    todo = rows.filter((r) => r._small);
  } else {
    const supabase = db();
    todo = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("cards").select("id").is("image_path", null).order("id").range(from, from + 999);
      if (error) throw new Error(error.message);
      todo.push(...data.map((d) => byId.get(d.id)).filter((r) => r?._small));
      if (data.length < 1000) break;
    }
  }
  todo = todo.slice(0, limit);
  console.log(`${todo.length} images to upload.`);
  if (dryRun) return console.log("sample:", todo[0]?._small);

  const supabase = db();
  let done = 0;
  let failed = 0;
  for (const group of chunks(todo, 200)) {
    const saved = [];
    await pool(group, 8, async (row) => {
      try {
        const bytes = await withRetry(async () => Buffer.from(await (await get(row._small)).arrayBuffer()));
        const file = `small/${row.id}.jpg`;
        const { error } = await withRetry(() => supabase.storage.from(BUCKET).upload(file, bytes, { contentType: "image/jpeg", upsert: true }));
        if (error) throw new Error(error.message);
        saved.push({ id: row.id, image_path: file });
      } catch (e) {
        failed++;
        console.warn(`  failed ${row.id}: ${e.message}`);
      }
    });
    // Only touch image_path, so re-imported card data (e.g. `playable`) is never overwritten.
    await pool(saved, 8, async ({ id, image_path }) => {
      const { error } = await withRetry(() => supabase.from("cards").update({ image_path }).eq("id", id));
      if (error) throw new Error(error.message);
    });
    done += group.length;
    console.log(`images ${done}/${todo.length} (failed ${failed})`);
  }
  if (failed) console.log(`${failed} failed. Run the same command again to retry them.`);
}

// The official decks players pick from. Every deck is 60 cards:
//   - the theme decks (60 cards already),
//   - trios: three 20-card packs (Foundations, Jumpstart, the Beginner Boxes) of different colors shuffled together,
//   - a 40-card starter deck, topped up with 20 basic lands in its own colors,
//   - any other 60-card official deck the game can play completely.
// A pack the game can play is also kept on its own, so players can mix any three of them (lib/decks.ts PACK_TYPE).
// The list grows by itself as the engine learns more cards: run `decks` again after a `cards` import. Any official deck in
// the database that is not in that list is removed by `decks`.
const KEEP_DECKS = new Set(["Eerie_SOS", "Lifegain_SOS", "Angels_ECL", "Pirates_ECL"]);
const PACK_TYPE = "Jumpstart pack";
const DECK_SIZE = 60; // every deck offered is this many cards
const PACK_SIZE = 20; // a pack: three of them make a deck
const BASICS = { W: "plains", U: "island", B: "swamp", R: "mountain", G: "forest" };
/** What kind of trio a set's packs make (the deck type, which the Decks page shows as a section). */
const trioType = (meta) => (meta.code === "FDN" ? "Foundations" : meta.type === "Jumpstart" ? "Jumpstart trio" : "Beginner Box trio");

/**
 * Trios: each set's packs in threes, packs of different colors together, so every pack is part of a ready-made 60-card deck.
 * `colorsOf` says which colors a pack uses. A set with fewer than three playable packs makes none (its packs can still be mixed).
 */
function trios(packs, colorsOf) {
  const bySet = Map.groupBy(packs, (p) => `${p.meta.code}|${trioType(p.meta)}`);
  const out = [];
  for (const [, list] of bySet) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.meta.name.localeCompare(b.meta.name) || a.meta.fileName.localeCompare(b.meta.fileName));
    const used = new Map(sorted.map((p) => [p, 0]));
    const share = (a, b) => [...colorsOf(a)].some((c) => colorsOf(b).has(c));
    const leastUsed = (pool) => [...pool].sort((a, b) => used.get(a) - used.get(b) || a.meta.name.localeCompare(b.meta.name))[0];
    const seen = new Set();
    for (const anchor of sorted) {
      if (used.get(anchor) > 0) continue; // already part of a trio
      const others = sorted.filter((p) => p !== anchor);
      const apart = others.filter((p) => !share(anchor, p));
      const partner = leastUsed(apart.length > 0 ? apart : others);
      const rest = others.filter((p) => p !== partner);
      const apartFromBoth = rest.filter((p) => !share(anchor, p) && !share(partner, p));
      const apartFromAnchor = rest.filter((p) => !share(anchor, p));
      const third = leastUsed(apartFromBoth.length > 0 ? apartFromBoth : apartFromAnchor.length > 0 ? apartFromAnchor : rest);
      const group = [anchor, partner, third];
      const key = group.map((x) => x.meta.fileName).sort().join("+");
      if (seen.has(key)) continue;
      seen.add(key);
      for (const g of group) used.set(g, used.get(g) + 1);
      const counts = new Map();
      for (const g of group) for (const [k, qty] of g.counts) counts.set(k, (counts.get(k) ?? 0) + qty);
      out.push({
        meta: { name: group.map((x) => x.meta.name).join(" + "), type: trioType(anchor.meta), code: anchor.meta.code, releaseDate: anchor.meta.releaseDate, fileName: group.map((x) => x.meta.fileName).join("+") },
        counts,
      });
    }
  }
  return out;
}

async function importDecks() {
  const cardRowsAll = buildRows(await loadOracle(), dryRun ? new Map() : await loadExistingIds());
  const oracleToId = new Map(cardRowsAll.map((r) => [r.oracle_id, r.id]));
  const playableIds = new Set(cardRowsAll.filter((r) => r.playable).map((r) => r.id));
  const isLand = new Map(cardRowsAll.map((r) => [r.id, r.type === "land"]));
  const nameOf = new Map(cardRowsAll.map((r) => [r.id, r.name]));
  const colorsById = new Map(cardRowsAll.map((r) => [r.id, r.colors ?? []]));
  const basicOracle = new Map(cardRowsAll.filter((r) => Object.values(BASICS).includes(r.id)).map((r) => [r.id, r.oracle_id])); // plains -> its oracle id
  // every official deck is looked at (the files are kept in .import-cache, so after the first time this is quick)
  const list = (await getJson("https://mtgjson.com/api/v5/DeckList.json")).data;
  console.log(`${list.length} official decks to look at.`);

  const downloaded = [];
  let missing = 0;
  let done = 0;
  await pool(list, 8, async (meta) => {
    try {
      const cached = path.join(CACHE, "decks", `${meta.fileName}.json`);
      let deck;
      if (fs.existsSync(cached)) {
        deck = JSON.parse(fs.readFileSync(cached, "utf-8"));
      } else {
        deck = (await getJson(`https://mtgjson.com/api/v5/decks/${meta.fileName}.json`)).data;
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        fs.writeFileSync(cached, JSON.stringify(deck));
      }
      const counts = new Map();
      const sections = [["main", deck.mainBoard], ["side", deck.sideBoard], ["commander", deck.commander]];
      for (const [board, cards] of sections) {
        for (const card of cards ?? []) {
          const id = oracleToId.get(card.identifiers?.scryfallOracleId);
          if (!id) {
            missing += card.count;
            continue;
          }
          counts.set(`${id}|${board}`, (counts.get(`${id}|${board}`) ?? 0) + card.count);
        }
      }
      if (counts.size) downloaded.push({ meta, counts });
    } catch (e) {
      console.warn(`  skipped ${meta.fileName}: ${e.message}`);
    }
    if (++done % 100 === 0) console.log(`downloaded ${done}/${list.length}`);
  });

  // can the game play every card of the main deck (and commander), and what size is it?
  const mainSize = (d) => [...d.counts].reduce((n, [key, qty]) => (key.endsWith("|side") ? n : n + qty), 0);
  const playsFully = (d) => [...d.counts.keys()].every((key) => key.endsWith("|side") || playableIds.has(key.split("|")[0]));
  // a deck of nothing but basic lands (the "Land Pack" boxes) is not something to play
  const spells = (d) => [...d.counts].reduce((n, [key, qty]) => (key.endsWith("|side") || isLand.get(key.split("|")[0]) ? n : n + qty), 0);
  const worthPlaying = (d) => spells(d) >= 8 && playsFully(d);
  const colorsOfPack = (d) => new Set([...d.counts.keys()].flatMap((k) => colorsById.get(k.split("|")[0]) ?? []));

  /** A 40-card deck topped up to 60 with basic lands, in the proportion of the colors of its spells. */
  const withLands = (d) => {
    const need = DECK_SIZE - mainSize(d);
    const weight = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const [key, qty] of d.counts) if (!key.endsWith("|side") && !isLand.get(key.split("|")[0])) for (const c of colorsById.get(key.split("|")[0]) ?? []) weight[c] += qty;
    const total = Object.values(weight).reduce((a, b) => a + b, 0);
    const colors = Object.keys(weight).filter((c) => weight[c] > 0);
    const share = Object.fromEntries((total > 0 ? colors : ["W"]).map((c) => [c, total > 0 ? (weight[c] / total) * need : need]));
    const lands = Object.fromEntries(Object.entries(share).map(([c, x]) => [c, Math.floor(x)]));
    let left = need - Object.values(lands).reduce((a, b) => a + b, 0);
    for (const [c] of Object.entries(share).sort((a, b) => (b[1] % 1) - (a[1] % 1))) if (left-- > 0) lands[c]++; // the biggest remainders get the extras
    const counts = new Map(d.counts);
    for (const [c, n] of Object.entries(lands)) {
      const id = oracleToId.get(basicOracle.get(BASICS[c]));
      if (id && n > 0) counts.set(`${id}|main`, (counts.get(`${id}|main`) ?? 0) + n);
    }
    return { ...d, counts };
  };

  const ready = downloaded.filter((d) => worthPlaying(d) || KEEP_DECKS.has(d.meta.fileName));
  const packs = ready.filter((d) => mainSize(d) === PACK_SIZE && (d.meta.type === "Jumpstart" || d.meta.type === "Box Set"));
  const isPack = new Set(packs);
  const whole = ready.filter((d) => !isPack.has(d) && (mainSize(d) === DECK_SIZE || KEEP_DECKS.has(d.meta.fileName)));
  const topped = ready.filter((d) => !isPack.has(d) && !KEEP_DECKS.has(d.meta.fileName) && mainSize(d) === 40).map(withLands);
  const decks = [
    ...whole,
    ...topped,
    ...packs.map((p) => ({ ...p, meta: { ...p.meta, type: PACK_TYPE } })),
    ...trios(packs, colorsOfPack),
  ].filter((d, i, all) => all.findIndex((x) => x.meta.fileName === d.meta.fileName) === i);
  const total = decks.reduce((n, d) => n + d.counts.size, 0);
  console.log(`${decks.length} decks, ${total} deck-card rows, ${missing} cards skipped (tokens etc.).`);
  console.log("decks:", decks.map((d) => d.meta.name).join(", "));
  if (dryRun) {
    // the best decks to teach the engine next: a size a game is played with, and only one or two cards it can't play yet
    const short = downloaded
      .filter((d) => !worthPlaying(d) && [20, 40, 60].includes(mainSize(d)) && spells(d) >= 8)
      .map((d) => ({ d, lacking: [...new Set([...d.counts.keys()].filter((k) => !k.endsWith("|side") && !playableIds.has(k.split("|")[0])).map((k) => nameOf.get(k.split("|")[0]) ?? k))] }))
      .filter((x) => x.lacking.length >= 1 && x.lacking.length <= 2)
      .sort((a, b) => a.lacking.length - b.lacking.length);
    console.log(`
${short.length} more decks are only 1-2 cards short:`);
    for (const { d, lacking } of short.slice(0, 40)) console.log(`  ${d.meta.name} (${d.meta.type}, ${d.meta.code}, ${mainSize(d)} cards): ${lacking.join(", ")}`);
    return;
  }

  const supabase = db();
  const ids = new Map(); // fileName -> deck id
  for (const batch of chunks(decks, 200)) {
    const rows = batch.map(({ meta }) => ({
      official: true,
      name: meta.name.slice(0, 120),
      deck_type: meta.type,
      code: meta.code,
      release_date: meta.releaseDate || null,
      source: meta.source ?? null,
      file_name: meta.fileName,
    }));
    const { data, error } = await withRetry(() => supabase.from("decks").upsert(rows, { onConflict: "file_name" }).select("id, file_name"));
    if (error) throw new Error(error.message);
    data.forEach((d) => ids.set(d.file_name, d.id));
  }

  // Replace the cards of every imported deck, so re-running never duplicates (--hide-stale updates them in place instead).
  for (const batch of hideStale ? [] : chunks([...ids.values()], 200)) {
    const { error } = await withRetry(() => supabase.from("deck_cards").delete().in("deck_id", batch));
    if (error) throw new Error(error.message);
  }
  const cardRows = decks.flatMap(({ meta, counts }) =>
    [...counts].map(([key, qty]) => {
      const [card_id, board] = key.split("|");
      return { deck_id: ids.get(meta.fileName), card_id, board, qty };
    }),
  );
  let done2 = 0;
  for (const batch of chunks(cardRows, 1000)) {
    const { error } = await withRetry(() =>
      hideStale ? supabase.from("deck_cards").upsert(batch, { onConflict: "deck_id,card_id,board" }) : supabase.from("deck_cards").insert(batch),
    );
    if (error) throw new Error(error.message);
    done2 += batch.length;
    console.log(`deck cards ${done2}/${cardRows.length}`);
  }

  // Remove every other official deck imported earlier (starter decks, Jumpstart packs, ...). Players' own decks,
  // including copies they made of official ones, are separate decks and stay.
  const existing = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("decks").select("id, file_name").eq("official", true).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    existing.push(...data);
    if (data.length < 1000) break;
  }
  const stale = existing.filter((d) => !ids.has(d.file_name)).map((d) => d.id);
  for (const batch of chunks(stale, 100)) {
    // An unlisted deck has no owner and isn't official, so no player can read it.
    const { error } = await withRetry(() =>
      hideStale ? supabase.from("decks").update({ official: false }).in("id", batch) : supabase.from("decks").delete().in("id", batch), // deck_cards go with them
    );
    if (error) throw new Error(error.message);
  }
  console.log(`${hideStale ? "Unlisted" : "Removed"} ${stale.length} other official decks.`);
}

const phases = { cards: importCards, images: importImages, decks: importDecks };
if (!phases[phase]) {
  console.error("Usage: node scripts/import.mjs <cards|images|decks> [--limit N] [--dry-run]");
  process.exit(1);
}
await phases[phase]();

// The Decks page reads a stored list of the official decks (supabase/04-scale.sql); bring it up to date with what was just imported.
if (!dryRun && (phase === "cards" || phase === "decks")) {
  const { error } = await db().rpc("refresh_official_decks");
  if (error) console.warn(`Could not refresh the stored deck list (${error.message}). If you have not yet run supabase/04-scale.sql, that is fine; otherwise run: select public.refresh_official_decks();`);
  else console.log("Refreshed the stored list of official decks.");
}
console.log("Done.");
