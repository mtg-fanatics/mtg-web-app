import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, CARDS, createGame } from "../index.js";
import type { CardDef, GameState, PlayerId } from "../index.js";

// Priority stops: a player who asked for them is given priority when attacked, when the opponent casts a spell and after blockers, even with nothing to respond with.

const DEFS: Record<string, CardDef> = {
  ...CARDS,
  bear: { id: "bear", name: "Bear", type: "creature", cost: 2, manaCost: "{1}{R}", power: 2, toughness: 2, text: "", typeLine: "Creature — Bear", colors: ["R"], keywords: [] },
  gain: { id: "gain", name: "Healing Spell", type: "instant", cost: 1, manaCost: "{R}", text: "You gain 1 life.", colors: ["R"], keywords: [] },
};
const perm = (iid: string, defId: string, owner: PlayerId) => ({ card: { iid, defId, owner }, tapped: false, summoningSick: false, damage: 0 });
function setup(hand: string[] = []): GameState {
  const g = createGame({ p1: Array(40).fill("mountain"), p2: Array(40).fill("mountain") }, 1);
  g.cards = DEFS;
  g.phase = "main1";
  g.active = "p1";
  g.opening = null;
  g.players.p1.hand = hand.map((d, i) => ({ iid: `h${i + 1}`, defId: d, owner: "p1" as const }));
  g.players.p2.hand = [];
  g.players.p1.battlefield = [perm("a1", "bear", "p1"), perm("l1", "mountain", "p1")];
  g.players.p2.battlefield = [perm("b1", "bear", "p2"), perm("m1", "mountain", "p2")];
  return g;
}
const stops = (s: GameState, who: PlayerId, st: { attack?: boolean; spell?: boolean; block?: boolean }) => {
  const r = applyAction(s, who, { type: "setStops", stops: st });
  assert.ok(r.ok);
  return r.state;
};

test("without stops, a player with nothing to respond with is passed over", () => {
  let s = setup();
  s.phase = "attackers";
  const r = applyAction(s, "p1", { type: "declareAttackers", attackers: ["a1"] });
  assert.ok(r.ok);
  s = r.state;
  assert.equal(s.priority, null);
});

test("attack stop: the attacked player gets priority after attackers are declared, and passing carries on to the blockers", () => {
  let s = stops(setup(), "p2", { attack: true });
  s.phase = "attackers";
  const r = applyAction(s, "p1", { type: "declareAttackers", attackers: ["a1"] });
  assert.ok(r.ok);
  s = r.state;
  assert.equal(s.priority?.holder, "p2");
  assert.equal(s.priority?.then, "afterAttackers");
  const p = applyAction(s, "p2", { type: "passPriority" });
  assert.ok(p.ok);
  assert.equal(p.state.priority, null);
  assert.equal(p.state.phase, "blockers");
});

test("block stop: after blockers are declared the players are given priority", () => {
  let s = stops(stops(setup(), "p1", { block: true }), "p2", { block: true });
  s.phase = "attackers";
  s = (applyAction(s, "p1", { type: "declareAttackers", attackers: ["a1"] }) as { state: GameState }).state;
  const b = applyAction(s, "p2", { type: "declareBlockers", blocks: [{ blocker: "b1", attacker: "a1" }] });
  assert.ok(b.ok);
  assert.equal(b.state.priority?.then, "afterBlockers");
  assert.ok(b.state.priority?.holder === "p1" || b.state.priority?.holder === "p2");
});

test("spell stop: the player is given priority when the opponent casts a spell, even with no response", () => {
  let s = stops(setup(["gain"]), "p2", { spell: true });
  const r = applyAction(s, "p1", { type: "castSpell", iid: "h1", targets: [] });
  assert.ok(r.ok);
  s = r.state;
  assert.equal(s.stack.length, 1);
  assert.equal(s.priority?.holder, "p2");
  const p = applyAction(s, "p2", { type: "passPriority" });
  assert.ok(p.ok);
  assert.equal(p.state.stack.length, 0, "it resolves once the stopped player passes");
});

test("setStops works at any time, by the player who is not to act", () => {
  const s = setup();
  const r = applyAction(s, "p2", { type: "setStops", stops: { spell: true } });
  assert.ok(r.ok);
  assert.equal(r.state.players.p2.stops?.spell, true);
});
