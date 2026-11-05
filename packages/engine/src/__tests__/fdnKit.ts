import assert from "node:assert/strict";
import fs from "node:fs";
import { applyAction, CARDS, createGame } from "../index.js";
import { doubleFaces } from "../oracle/doubleFaced.js";
import type { Action, CardDef, CardInstance, GameState, PlayerId } from "../index.js";

// Helpers for the Foundations tests: the real printed cards (scripts/fdn-cards.json) played in a small, controlled game.

interface Row {
  id: string;
  name: string;
  type: CardDef["type"];
  cost: number;
  power: number | null;
  toughness: number | null;
  type_line: string;
  mana_cost: string | null;
  oracle_text: string | null;
  colors: string[] | null;
  keywords: string[] | null;
}

const ROWS: Row[] = JSON.parse(fs.readFileSync(new URL("../../scripts/fdn-cards.json", import.meta.url), "utf8"));

/** The card as the game loads it from the database. */
export function realCard(name: string): CardDef {
  const c = ROWS.find((r) => r.name === name);
  assert.ok(c, `no Foundations card named ${name}`);
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    cost: c.cost,
    power: c.power ?? undefined,
    toughness: c.type === "planeswalker" ? undefined : (c.toughness ?? undefined),
    loyalty: c.type === "planeswalker" ? (c.toughness ?? undefined) : undefined,
    typeLine: c.type_line,
    manaCost: c.mana_cost ?? undefined,
    text: c.oracle_text ?? "",
    colors: c.colors ?? [],
    keywords: (c.keywords ?? []).map((k) => k.toLowerCase()),
  };
}

export const ROW_NAMES = ROWS.map((r) => r.name);

const basic = (id: string, name: string): CardDef => ({ id, name, type: "land", cost: 0, typeLine: `Basic Land — ${name}` });

/** A made-up creature (for the other side of a test) with exactly the text given. */
export function plain(id: string, name: string, manaCost: string, power: number, toughness: number, text = "", typeLine = "Creature — Bear", colors: string[] = []): CardDef {
  return { id, name, type: "creature", cost: (manaCost.match(/\{[^}]+\}/g) ?? []).reduce((n, s) => n + (/^\{\d+\}$/.test(s) ? Number(s.slice(1, -1)) : 1), 0), manaCost, text, power, toughness, typeLine, colors };
}

export const BASE: Record<string, CardDef> = {
  ...CARDS,
  plains: basic("plains", "Plains"),
  island: basic("island", "Island"),
  swamp: basic("swamp", "Swamp"),
  mountain: { ...CARDS.mountain },
  forest: basic("forest", "Forest"),
  bear: plain("bear", "Bear", "{2}", 2, 2, "", "Creature — Bear", ["G"]),
  giant: plain("giant", "Giant", "{5}", 6, 6, "", "Creature — Giant", ["R"]),
  elf: plain("elf", "Elf", "{G}", 1, 1, "", "Creature — Elf Druid", ["G"]),
};

export const perm = (iid: string, defId: string, owner: PlayerId = "p1") => ({ card: { iid, defId, owner } as CardInstance, tapped: false, summoningSick: false, damage: 0 });

export interface Setup {
  /** Names (real Marvel cards, or ids from `extra`) in p1's hand. */
  hand?: string[];
  /** On p1's battlefield, besides the lands. */
  mine?: string[];
  /** On p2's battlefield. */
  theirs?: string[];
  /** Cards in p1's library, top first (default: five Plains). */
  library?: string[];
  /** In p1's graveyard. */
  yard?: string[];
  extra?: Record<string, CardDef>;
  /** p2's hand (default: two Bears). */
  oppHand?: string[];
  /** Lands p1 has: default three of each color. */
  lands?: number;
}

/** p1 (the active player, in their first main phase) has plenty of mana of every color. */
export function setup(s: Setup = {}): GameState {
  const defs: Record<string, CardDef> = { ...BASE, ...(s.extra ?? {}) };
  const need = (name: string) => {
    if (defs[name]) return name;
    const def = realCard(name);
    defs[def.id] = def;
    return def.id;
  };
  const g = createGame({ p1: Array(40).fill("mountain"), p2: Array(40).fill("mountain") }, 1);
  const ids = {
    hand: (s.hand ?? []).map(need),
    mine: (s.mine ?? []).map(need),
    theirs: (s.theirs ?? []).map(need),
    library: (s.library ?? ["plains", "plains", "plains", "plains", "plains"]).map(need),
    yard: (s.yard ?? []).map(need),
    oppHand: (s.oppHand ?? ["bear", "bear"]).map(need),
  };
  g.cards = defs;
  // a transforming card is played as its front face, with the back face waiting (as createGame does)
  for (const [id, def] of Object.entries(defs)) {
    const faces = doubleFaces(def);
    if (!faces) continue;
    g.cards[id] = faces.front;
    g.cards[faces.back.id] = faces.back;
  }
  const n = s.lands ?? 3;
  g.players.p1.hand = ids.hand.map((d, i) => ({ iid: `h${i}`, defId: d, owner: "p1" }));
  g.players.p1.library = ids.library.map((d, i) => ({ iid: `c${i}`, defId: d, owner: "p1" as const }));
  g.players.p1.graveyard = ids.yard.map((d, i) => ({ iid: `y${i}`, defId: d, owner: "p1" as const }));
  g.players.p2.hand = ids.oppHand.map((d, i) => ({ iid: `oh${i}`, defId: d, owner: "p2" as const }));
  g.players.p2.library = Array.from({ length: 5 }, (_, i) => ({ iid: `oc${i}`, defId: "plains", owner: "p2" as const }));
  g.players.p1.battlefield = [
    ...["plains", "island", "swamp", "mountain", "forest"].flatMap((land) => Array.from({ length: n }, (_, i) => perm(`${land}${i}`, land))),
    ...ids.mine.map((d, i) => perm(`m${i}`, d)),
  ];
  g.players.p2.battlefield = ids.theirs.map((d, i) => perm(`t${i}`, d, "p2"));
  g.phase = "main1";
  g.active = "p1";
  return g;
}

export function act(s: GameState, p: PlayerId, a: Action): GameState {
  const r = applyAction(s, p, a);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}
export const fails = (s: GameState, p: PlayerId, a: Action): string => {
  const r = applyAction(s, p, a);
  assert.ok(!r.ok, "expected the action to be refused");
  return r.ok ? "" : r.error;
};

/** Both players pass until the stack is empty (stops at a choice). */
export function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.priority && !g.pendingPick && !g.pendingChoice; i++) g = act(g, g.priority.holder, { type: "passPriority" });
  return g;
}

/** Answers a pending target choice (a triggered ability waiting for its targets) with the first legal ones, then settles. */
export const find = (g: GameState, iid: string) => [...g.players.p1.battlefield, ...g.players.p2.battlefield].find((p) => p.card.iid === iid);
export const named = (g: GameState, who: PlayerId, name: string) => g.players[who].battlefield.filter((p) => g.cards[p.card.defId].name === name);
export const perms = (iid: string) => [{ kind: "permanent" as const, iid }];
export const on = perms;
export const hand = (g: GameState, who: PlayerId = "p1") => g.players[who].hand.map((c) => g.cards[c.defId].name);
export const yard = (g: GameState, who: PlayerId = "p1") => g.players[who].graveyard.map((c) => g.cards[c.defId].name);
export const library = (g: GameState, who: PlayerId = "p1") => g.players[who].library.map((c) => g.cards[c.defId].name);

/** A triggered ability is waiting for its targets: choose them, then let everything resolve. */
export const choose = (g: GameState, p: PlayerId, targets: Extract<Action, { type: "chooseTargets" }>["targets"]): GameState => settle(act(g, p, { type: "chooseTargets", targets }));

/** p1 moves to combat and attacks with the given creatures; whatever triggers is put on the stack and resolved (stops at a choice). */
export function attackWith(g: GameState, iids: string[]): GameState {
  let s = g;
  while (s.phase !== "attackers") s = act(s, s.active, { type: "passPhase" });
  s = act(s, s.active, { type: "declareAttackers", attackers: iids });
  return settle(s);
}

/** Passes (without doing anything) until p1's next turn reaches its first main phase. Triggers that need a choice stop the loop: the caller answers them. */
export function toNextTurn(g: GameState, who: PlayerId = "p1"): GameState {
  const turn = g.turn;
  let s = g;
  for (let i = 0; i < 200; i++) {
    if (s.active === who && s.turn > turn && s.phase === "main1" && !s.priority && !s.pendingPick && !s.pendingChoice) return s;
    if (s.pendingPick || s.pendingChoice || s.winner) return s;
    const actor = s.priority ? s.priority.holder : s.phase === "blockers" ? (s.active === "p1" ? "p2" : "p1") : s.active;
    s = act(s, actor, s.priority ? { type: "passPriority" } : s.phase === "blockers" ? { type: "declareBlockers", blocks: [] } : { type: "passPhase" });
  }
  throw new Error("the turn never came round");
}
