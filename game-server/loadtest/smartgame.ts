// TEMP test helper: a smart player (the engine's bot) opens a room against the server's bot with rich themed decks, so a browser can spectate a full game.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Client } from "@colyseus/sdk";
import { botAction, isSupportedCard, playerToAct } from "@mtg/engine";
import type { Action, CardDef, GameState, PlayerId } from "@mtg/engine";

const HOST = process.env.HOST ?? "localhost:2567";
const SEED = Number(process.env.SEED ?? 5);
const DELAY = Number(process.env.DELAY ?? 700);
const cacheDir = path.resolve("../mtg/.import-cache");
const file = fs.readdirSync(cacheDir).filter((f) => f.startsWith("oracle-cards") && f.endsWith(".jsonl.gz")).sort().pop()!;
const lines = zlib.gunzipSync(fs.readFileSync(path.join(cacheDir, file))).toString("utf8").split("\n").filter(Boolean);
const TYPES = [["Land", "land"], ["Creature", "creature"], ["Planeswalker", "planeswalker"], ["Instant", "instant"], ["Sorcery", "sorcery"], ["Enchantment", "enchantment"], ["Artifact", "artifact"]];
const slug = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const defs: Record<string, CardDef> = {};
for (const line of lines) {
  const c = JSON.parse(line);
  if (c.layout !== "normal" || c.card_faces) continue;
  const front = (c.type_line as string).split("—")[0];
  const type = TYPES.find(([w]) => front.includes(w))?.[1] ?? "other";
  const def: CardDef = { id: slug(c.name), name: c.name, type, cost: Math.round(c.cmc), power: /^\d+$/.test(c.power ?? "") ? Number(c.power) : undefined, toughness: /^\d+$/.test(c.toughness ?? "") ? Number(c.toughness) : undefined, loyalty: /^\d+$/.test(c.loyalty ?? "") ? Number(c.loyalty) : undefined, typeLine: c.type_line, manaCost: c.mana_cost ?? "", text: c.oracle_text ?? "", colors: c.colors ?? [], keywords: (c.keywords ?? []).map((k: string) => k.toLowerCase()) } as CardDef;
  if (["land", "creature", "artifact", "enchantment", "planeswalker", "instant", "sorcery"].includes(type) && isSupportedCard(def)) defs[def.id] = def;
}
const all = Object.values(defs);
let t = SEED >>> 0;
const rng = () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
const basicOf: Record<string, string> = { W: "plains", U: "island", B: "swamp", R: "mountain", G: "forest" };
function buildDeck(colors: string[]): string[] {
  const fits = (d: CardDef) => (d.colors ?? []).length > 0 && (d.colors ?? []).every((c) => colors.includes(c));
  const creatures = all.filter((d) => d.type === "creature" && fits(d) && d.cost <= 5 && /\b(flying|first strike|trample|haste|deathtouch|lifelink|vigilance|reach|when|whenever|\{T\})/i.test(d.text ?? ""));
  const spells = all.filter((d) => ["instant", "sorcery"].includes(d.type) && fits(d) && d.cost <= 5);
  const perms = all.filter((d) => ["artifact", "enchantment", "planeswalker"].includes(d.type) && fits(d) && d.cost <= 5);
  const deck: string[] = []; const copies = new Map<string, number>();
  const add = (d: CardDef) => { if ((copies.get(d.id) ?? 0) >= 3) return false; copies.set(d.id, (copies.get(d.id) ?? 0) + 1); deck.push(d.id); return true; };
  while (deck.length < 36) { const r = rng(); add(r < 0.4 ? pick(spells) : r < 0.8 ? pick(creatures) : pick(perms.length ? perms : creatures)); }
  const basics = colors.map((c) => basicOf[c]);
  while (deck.length < 60) deck.push(basics[deck.length % basics.length]);
  return deck;
}
const mine = buildDeck(["U", "R"]);
const theirs = buildDeck(["B", "G"]);
const names = (ids: string[]) => [...new Set(ids)].filter((i) => !Object.values(basicOf).includes(i)).slice(0, 14).map((i) => defs[i].name).join(", ");
console.log("MY DECK:", names(mine)); console.log("BOT DECK:", names(theirs));

const client = new Client(`ws://${HOST}`);
const room = await client.create("match", { name: "watch me", token: "dev:sp" + Math.random().toString(36).slice(2, 7) });
fs.writeFileSync(process.env.ROOMFILE ?? "room.txt", room.roomId);
let view: GameState | null = null; let seat: PlayerId = "p1"; let moves = 0; let busy = false;
const act = () => {
  if (!view || busy) return;
  if (view.winner) { console.log("GAME OVER, winner", view.winner, "after", moves, "moves, turn", view.turn); return; }
  const a: Action | null = playerToAct(view) === seat ? botAction(view, seat) : null;
  if (a) { busy = true; moves++; setTimeout(() => { busy = false; room.send("action", { action: a }); }, DELAY); }
};
room.onMessage("room", (s: { stage: string; you: PlayerId; coin: { winner: PlayerId | null } | null; members?: unknown }) => {
  seat = s.you;
  if (s.stage === "waiting") room.send("addBot");
  if (s.stage === "decks") room.send("deck", { name: "Storm", ids: mine, botDeck: { name: "Rot", ids: theirs } });
  if (s.stage === "coin" && s.coin?.winner === "p1") room.send("order", { first: true });
});
room.onMessage("start", (m: { view: GameState }) => { view = m.view; console.log("started"); act(); });
room.onMessage("update", (m: { view: GameState }) => { view = m.view; act(); });
room.onMessage("error", (m: { message?: string }) => console.log("server error:", m?.message));
room.onMessage("*" as never, () => {});
room.send("format", { bestOf: 1 });
setTimeout(() => room.send("startVote"), Number(process.env.VOTE_AFTER ?? 500));
setInterval(() => { if (view) console.log("turn", view.turn, view.phase, "life", view.players.p1.life, view.players.p2.life, "moves", moves); }, 15000);
