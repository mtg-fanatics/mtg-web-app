import assert from "node:assert/strict";
import { applyAction, CARDS, createGame } from "../index.js";
import type { Action, CardDef, CardInstance, GameState, PlayerId } from "../index.js";

// What the tests of the older theme decks share: the cards (with their real text), a board, and the moves.

export const card = (id: string, name: string, type: CardDef["type"], manaCost: string, typeLine: string, text: string, extra: Partial<CardDef> = {}): CardDef => ({
  id, name, type, cost: (manaCost.match(/\{[^}]+\}/g) ?? []).reduce((n, s) => n + (/^\{\d+\}$/.test(s) ? Number(s.slice(1, -1)) : 1), 0), manaCost, typeLine, text,
  keywords: (text.match(/^(flying|haste|first strike|trample|vigilance|reach|deathtouch|lifelink)\b/gim) ?? []).map((k) => k.toLowerCase()), ...extra,
});
export const creature = (id: string, power: number, toughness: number, manaCost = "{R}", typeLine = "Creature — Bear", text = ""): CardDef => card(id, id, "creature", manaCost, typeLine, text, { power, toughness });
export const basic = (id: string, name: string): CardDef => ({ id, name, type: "land", cost: 0, typeLine: `Basic Land — ${name}`, text: `{T}: Add {${name[0] === "I" ? "U" : name[0]}}.` });

export const BASE: Record<string, CardDef> = {
  ...CARDS,
  plains: basic("plains", "Plains"),
  island: basic("island", "Island"),
  mountain: basic("mountain", "Mountain"),
  forest: basic("forest", "Forest"),
  swamp: basic("swamp", "Swamp"),
  bear: creature("bear", 2, 2),
  ogre: creature("ogre", 3, 3, "{2}{R}"),
  hulk: creature("hulk", 5, 5, "{4}{R}"),
  bolt: card("bolt", "Bolt", "instant", "{R}", "Instant", "Bolt deals 3 damage to any target."),
};

export const perm = (iid: string, defId: string, owner: PlayerId = "p1") => ({ card: { iid, defId, owner } as CardInstance, tapped: false, summoningSick: false, damage: 0 });

/** p1's first main phase with four Plains, four Islands, four Mountains, three Forests and three Swamps, the cards in hand, and permanents on each side (p2 has two Islands). */
export function setup(defs: Record<string, CardDef>, hand: string[], mine: string[] = [], theirs: string[] = []): GameState {
  const g = createGame({ p1: Array(40).fill("mountain"), p2: Array(40).fill("mountain") }, 1);
  g.cards = { ...BASE, ...defs };
  g.players.p1.hand = hand.map((d, i) => ({ iid: `h${i}`, defId: d, owner: "p1" }));
  g.players.p1.battlefield = [
    ...["plains", "plains", "plains", "plains", "island", "island", "island", "island", "mountain", "mountain", "mountain", "mountain", "forest", "forest", "forest", "swamp", "swamp", "swamp"].map((d, i) => perm(`l${i}`, d)),
    ...mine.map((d, i) => perm(`m${i}`, d)),
  ];
  g.players.p2.battlefield = [...Array.from({ length: 2 }, (_, i) => perm(`k${i}`, "island", "p2")), ...theirs.map((d, i) => perm(`t${i}`, d, "p2"))];
  g.players.p2.hand = [];
  g.phase = "main1";
  return g;
}

export function act(s: GameState, p: PlayerId, a: Action): GameState {
  const r = applyAction(s, p, a);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}
export const all = (g: GameState) => [...g.players.p1.battlefield, ...g.players.p2.battlefield];
export const find = (g: GameState, iid: string) => all(g).find((p) => p.card.iid === iid);
export const on = (iid: string) => ({ kind: "permanent" as const, iid });
export const player = (id: PlayerId) => ({ kind: "player" as const, id });

/** Both players pass until the stack is empty (or a choice is waiting). */
export const settle = (g: GameState) => {
  while (g.priority && !g.pendingChoice && !g.pendingPick) g = act(g, g.priority.holder, { type: "passPriority" });
  return g;
};
export const cast = (g: GameState, iid: string, targets: unknown[] = [], extra: Partial<Extract<Action, { type: "castSpell" }>> = {}) => settle(act(g, "p1", { type: "castSpell", iid, targets: targets as never, ...extra }));
export const choose = (g: GameState, targets: unknown[]) => settle(act(g, g.pendingChoice!.player, { type: "chooseTargets", targets: targets as never }));
export const pick = (g: GameState, iid?: string) => settle(act(g, g.pendingPick!.player, { type: "pick", ...(iid ? { iid } : {}) }));
export const attack = (g: GameState, attackers: string[], by: PlayerId = "p1") => {
  g.phase = "attackers";
  g.active = by;
  return settle(act(g, by, { type: "declareAttackers", attackers }));
};
/** p1's library gets these cards on top, in this order. */
export const top = (g: GameState, defIds: string[], who: PlayerId = "p1") => (g.players[who].library = [...defIds.map((d, i) => ({ iid: `top${who}${i}`, defId: d, owner: who })), ...g.players[who].library]);
/** Passes until the next turn begins (stops at a choice). */
export function nextTurn(g: GameState): GameState {
  const turn = g.turn;
  for (let i = 0; i < 60 && g.turn === turn && !g.winner; i++) {
    if (g.pendingPick || g.pendingChoice) break;
    g = g.priority ? act(g, g.priority.holder, { type: "passPriority" }) : act(g, g.active, { type: "passPhase" });
  }
  return g;
}
