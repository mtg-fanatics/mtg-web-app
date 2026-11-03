// Plays the bot against itself with the official decks of a folder (DECKS=<folder of card-id lists>, made by mtg/scripts/deckcandidates.mjs with DUMP=...), to see that no deck
// gets the game stuck or crashes it. Run from packages/engine:   DECKS=<folder> npx tsx scripts/themeBots.ts [games per pairing = 6] [firstSeed = 1]
// (the lines below are botGames.ts's: the cards and the random player)
// The bot only ever sees `viewFor(state, seat)`: its own hand and the battlefields, never a library or the other hand.
// Run from packages/engine:   npx tsx scripts/botGames.ts [games=40] [firstSeed=1]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { handLimit, applyAction, botAction, createGame, getCastable, getDamageAssignments, getForcedBlocks, getPossibleAttackers, getPossibleBlockers, isSupportedCard, legalTargets, MAX_HAND_SIZE, playerToAct, suggestDamageAssignment, viewFor } from "../src/index.js";
import type { Action, CardDef, GameState, PlayerId, TargetChoice } from "../src/index.js";

const [games = 6, firstSeed = 1] = process.argv.slice(2).map(Number);

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


const deckDir = process.env.DECKS!;
const deckFiles = fs.readdirSync(deckDir).filter((f) => f.endsWith(".json") && !/SOS|ECL/.test(f));
const decksOf = (f: string): string[] => (JSON.parse(fs.readFileSync(path.join(deckDir, f), "utf8")) as string[]).filter((id) => defs[id]);
let totalGames = 0, stuckGames = 0, nullMoves = 0, crashes = 0, finishedGames = 0;
const problems: string[] = [];
for (let i = 0; i < deckFiles.length; i++) {
  for (const j of [(i + 1) % deckFiles.length, (i + 4) % deckFiles.length, (i + 9) % deckFiles.length]) {
    for (let g = 0; g < games; g++) {
      const seed = firstSeed + g + i * 1000 + j * 7;
      const rng = rngFrom(seed);
      const decks = { p1: decksOf(deckFiles[i]), p2: decksOf(deckFiles[j]) };
      let s = createGame(decks, seed * 7919, defs, { startingPlayer: rng() < 0.5 ? "p1" : "p2", mulligan: true });
      let actions = 0, refused = 0, stuck = false;
      totalGames++;
      try {
        while (!s.winner && actions < 3000) {
          const who = playerToAct(s);
          let action = botAction(viewFor(s, who), who);
          if (!action) { nullMoves++; action = s.priority ? { type: "passPriority" } : { type: "passPhase" }; }
          let r = applyAction(s, who, action);
          if (!r.ok) {
            if (++refused > 40) { stuck = true; problems.push(`STUCK ${deckFiles[i]} vs ${deckFiles[j]} seed ${seed} phase ${s.phase} ${who} ${JSON.stringify(action)} -> ${r.error}`); break; }
            r = applyAction(s, who, s.priority ? { type: "passPriority" } : s.phase === "blockers" ? { type: "declareBlockers", blocks: getForcedBlocks(s) } : { type: "passPhase" });
            if (!r.ok) continue;
          } else refused = 0;
          s = r.state;
          actions++;
        }
      } catch (e) {
        crashes++;
        problems.push(`CRASH ${deckFiles[i]} vs ${deckFiles[j]} seed ${seed}: ${String(e instanceof Error ? e.stack : e).slice(0, 400)}`);
        continue;
      }
      if (stuck || !s.winner) { stuckGames++; if (!stuck) problems.push(`NO WINNER after ${actions} actions ${deckFiles[i]} vs ${deckFiles[j]} seed ${seed} phase ${s.phase}`); }
      else finishedGames++;
    }
  }
}
console.log(`${totalGames} bot games: ${finishedGames} finished, ${stuckGames} stuck or unfinished, ${crashes} crashed, bot gave no move ${nullMoves}x`);
for (const p of problems.slice(0, 12)) console.log(p);
