// Plays the bot against a random player (and against itself) with REAL cards, to measure it.
// The bot only ever sees `viewFor(state, seat)`: its own hand and the battlefields, never a library or the other hand.
// Run from packages/engine:   npx tsx scripts/botGames.ts [games=40] [firstSeed=1]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { handLimit, applyAction, botAction, createGame, getCastable, getDamageAssignments, getForcedBlocks, getPossibleAttackers, getPossibleBlockers, isSupportedCard, legalTargets, MAX_HAND_SIZE, playerToAct, suggestDamageAssignment, viewFor } from "../src/index.js";
import type { Action, CardDef, GameState, PlayerId, TargetChoice } from "../src/index.js";

const [games = 40, firstSeed = 1] = process.argv.slice(2).map(Number);

// ───────── real cards and decks ─────────
const cacheDir = path.resolve("../../mtg/.import-cache");
const file = fs.readdirSync(cacheDir).filter((f) => f.startsWith("oracle-cards") && f.endsWith(".jsonl.gz")).sort().pop()!;
const lines = zlib.gunzipSync(fs.readFileSync(path.join(cacheDir, file))).toString("utf8").split("\n").filter(Boolean);
const TYPES = [["Land", "land"], ["Creature", "creature"], ["Planeswalker", "planeswalker"], ["Instant", "instant"], ["Sorcery", "sorcery"], ["Enchantment", "enchantment"], ["Artifact", "artifact"]];
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const defs: Record<string, CardDef> = {};
for (const line of lines) {
  const c = JSON.parse(line);
  if (c.layout !== "normal" || c.card_faces) continue;
  const front = (c.type_line as string).split("—")[0];
  const type = TYPES.find(([w]) => front.includes(w))?.[1] ?? "other";
  const def: CardDef = {
    id: slug(c.name), name: c.name, type, cost: Math.round(c.cmc),
    power: /^\d+$/.test(c.power ?? "") ? Number(c.power) : undefined,
    toughness: /^\d+$/.test(c.toughness ?? "") ? Number(c.toughness) : undefined,
    loyalty: /^\d+$/.test(c.loyalty ?? "") ? Number(c.loyalty) : undefined,
    typeLine: c.type_line, manaCost: c.mana_cost ?? "", text: c.oracle_text ?? "", colors: c.colors ?? [],
    keywords: (c.keywords ?? []).map((k: string) => k.toLowerCase()),
  };
  if (["land", "creature", "artifact", "enchantment", "planeswalker", "instant", "sorcery"].includes(type) && isSupportedCard(def)) defs[def.id] = def;
}
const all = Object.values(defs);
type Rng = () => number;
const rngFrom = (seed: number): Rng => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};
const pick = <T,>(rng: Rng, xs: T[]): T => xs[Math.floor(rng() * xs.length)];

function buildDeck(rng: Rng): string[] {
  const colors = ["W", "U", "B", "R", "G"].sort(() => rng() - 0.5).slice(0, 2);
  const fits = (d: CardDef) => (d.colors ?? []).every((c) => colors.includes(c));
  const creatures = all.filter((d) => d.type === "creature" && fits(d) && d.cost <= 5);
  const others = all.filter((d) => ["instant", "sorcery", "artifact", "enchantment"].includes(d.type) && fits(d) && d.cost <= 5);
  const basicOf: Record<string, string> = { W: "plains", U: "island", B: "swamp", R: "mountain", G: "forest" };
  const basics = colors.map((c) => basicOf[c]).filter((id) => defs[id]);
  const deck: string[] = [];
  const copies = new Map<string, number>();
  while (deck.length < 24) {
    const d = rng() < 0.7 ? pick(rng, creatures) : pick(rng, others);
    if ((copies.get(d.id) ?? 0) >= 3) continue;
    copies.set(d.id, (copies.get(d.id) ?? 0) + 1);
    deck.push(d.id);
  }
  while (deck.length < 40) deck.push(pick(rng, basics));
  return deck;
}

// ───────── a random player (the yardstick) ─────────
function randomTargets(s: GameState, specs: { kind: string }[], me: PlayerId, rng: Rng): TargetChoice[] | null {
  const out: TargetChoice[] = [];
  for (const spec of specs) {
    const o = legalTargets(s, spec as never, me);
    if (o.length === 0) return null;
    out.push(pick(rng, o));
  }
  return out;
}
function randomAction(s: GameState, me: PlayerId, rng: Rng): Action {
  if (s.pendingPick) return s.pendingPick.optional && rng() < 0.3 ? { type: "pick" } : { type: "pick", iid: pick(rng, s.pendingPick.options) };
  if (s.pendingChoice) return { type: "chooseTargets", targets: randomTargets(s, s.pendingChoice.specs, s.pendingChoice.item.controller, rng) ?? [] };
  if (s.priority) return { type: "passPriority" };
  const p = s.players[me];
  switch (s.phase) {
    case "mulligan": return { type: "keepHand", bottom: [] };
    case "cleanup": return { type: "discard", iids: p.hand.slice(0, p.hand.length - handLimit(s, me)).map((c) => c.iid) };
    case "damage": return { type: "assignDamage", assignments: getDamageAssignments(s).flatMap((d) => Object.entries(suggestDamageAssignment(s, d.attacker)).map(([blocker, amount]) => ({ attacker: d.attacker, blocker, amount }))) };
    case "blockers": {
      const forced = getForcedBlocks(s);
      const attackers = s.combat?.attackers.map((a) => a.attacker) ?? [];
      return { type: "declareBlockers", blocks: [...forced, ...getPossibleBlockers(s).filter((b) => !forced.some((f) => f.blocker === b) && rng() < 0.5 && attackers.length).map((blocker) => ({ blocker, attacker: pick(rng, attackers) }))] };
    }
    case "attackers": {
      const can = getPossibleAttackers(s).filter(() => rng() < 0.6);
      return can.length ? { type: "declareAttackers", attackers: can } : { type: "passPhase" };
    }
    default: {
      const options: Action[] = [];
      for (const c of p.hand) if (s.cards[c.defId]?.type === "land" && p.landsPlayedThisTurn < 1) options.push({ type: "playLand", iid: c.iid });
      for (const c of getCastable(s, me)) {
        if (c.modal || c.maxX !== undefined || c.sacrifice) continue;
        const t = randomTargets(s, c.specs, me, rng);
        if (t) options.push({ type: "castSpell", iid: c.iid, targets: t });
      }
      return options.length && rng() < 0.85 ? pick(rng, options) : { type: "passPhase" };
    }
  }
}

// ───────── a game ─────────
interface Result { winner: PlayerId | "draw" | null; turns: number; actions: number; botMs: number[]; stuck: boolean; botNull: number }
function play(seed: number, bots: Record<PlayerId, boolean>): Result {
  const rng = rngFrom(seed);
  const decks = { p1: buildDeck(rng), p2: buildDeck(rng) };
  let s = createGame(decks, seed * 7919, defs, { startingPlayer: rng() < 0.5 ? "p1" : "p2", mulligan: true });
  const botMs: number[] = [];
  let botNull = 0;
  let actions = 0;
  let refused = 0;
  while (!s.winner && actions < 3000) {
    const who = playerToAct(s);
    let action: Action | null;
    if (bots[who]) {
      const t0 = performance.now();
      action = botAction(viewFor(s, who), who); // the bot sees its own view only
      botMs.push(performance.now() - t0);
      if (!action) { botNull++; action = randomAction(s, who, rng); }
    } else action = randomAction(s, who, rng);
    let r = applyAction(s, who, action);
    if (!r.ok) {
      if (++refused > 40) return { winner: s.winner, turns: s.turn, actions, botMs, stuck: true, botNull };
      r = applyAction(s, who, s.priority ? { type: "passPriority" } : s.phase === "blockers" ? { type: "declareBlockers", blocks: getForcedBlocks(s) } : { type: "passPhase" });
      if (!r.ok) continue;
    } else refused = 0;
    s = r.state;
    actions++;
  }
  return { winner: s.winner, turns: s.turn, actions, botMs, stuck: !s.winner, botNull };
}

const stats = (xs: number[]) => (xs.length ? { avg: xs.reduce((a, b) => a + b, 0) / xs.length, max: Math.max(...xs), p95: [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] } : { avg: 0, max: 0, p95: 0 });

function match(label: string, setup: (g: number) => Record<PlayerId, boolean>, botSeat?: (g: number) => PlayerId) {
  let botWins = 0, otherWins = 0, draws = 0, stuck = 0, nulls = 0, turns = 0, finished = 0;
  const ms: number[] = [];
  for (let g = 0; g < games; g++) {
    const bots = setup(g);
    const r = play(firstSeed + g, bots);
    ms.push(...r.botMs);
    nulls += r.botNull;
    if (r.stuck) { stuck++; continue; }
    finished++;
    turns += r.turns;
    if (r.winner === "draw") draws++;
    else if (botSeat ? r.winner === botSeat(g) : r.winner === "p1") botWins++;
    else otherWins++;
  }
  const t = stats(ms);
  console.log(`${label}: ${botWins} wins, ${otherWins} losses, ${draws} draws of ${finished} finished games | stuck ${stuck} | bot gave no move ${nulls}x | ${(turns / Math.max(1, finished)).toFixed(1)} turns/game | thinking avg ${t.avg.toFixed(0)} ms, 95% under ${t.p95.toFixed(0)} ms, slowest ${t.max.toFixed(0)} ms`);
}

console.log(`${all.length} real cards loaded`);
match("bot vs random player", (g) => (g % 2 === 0 ? { p1: true, p2: false } : { p1: false, p2: true }), (g) => (g % 2 === 0 ? "p1" : "p2"));
match("bot vs bot            ", () => ({ p1: true, p2: true }));
