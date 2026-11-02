import { test } from "node:test";
import assert from "node:assert/strict";
import { hasKeywordNow, isSupportedCard, powerOf } from "../index.js";
import type { CardDef } from "../index.js";
import { act, card, cast, creature, find, on, perm, setup, settle } from "./themeKit.js";

// Threshold, hellbent, metalcraft and morbid (real text).
const DEFS: Record<string, CardDef> = {
  beast: card("beast", "Krosan Beast", "creature", "{3}{G}", "Creature — Squirrel Beast", "Threshold — Krosan Beast gets +7/+7 as long as there are seven or more cards in your graveyard.", { power: 1, toughness: 1 }),
  dragon: card("dragon", "Rakdos Pit Dragon", "creature", "{2}{R}{R}", "Creature — Dragon", "Flying\n{R}: Rakdos Pit Dragon gains first strike until end of turn.\nHellbent — Rakdos Pit Dragon has double strike as long as you have no cards in hand.", { power: 3, toughness: 3, keywords: ["flying"] }),
  fall: card("fall", "Tragic Fall", "instant", "{1}{B}", "Instant", "Target creature gets -3/-3 until end of turn.\nHellbent — That creature gets -13/-13 until end of turn instead if you have no cards in hand.", {}),
  hunger: card("hunger", "Hunger of the Howlpack", "instant", "{G}", "Instant", "Put a +1/+1 counter on target creature.\nMorbid — Put three +1/+1 counters on that creature instead if a creature died this turn.", {}),
  dispatch: card("dispatch", "Dispatch", "instant", "{W}", "Instant", "Tap target creature.\nMetalcraft — If you control three or more artifacts, exile that creature.", {}),
  drake: card("drake", "Lumengrid Drake", "creature", "{3}{U}", "Creature — Drake", "Flying\nMetalcraft — When Lumengrid Drake enters, if you control three or more artifacts, return target creature to its owner's hand.", { power: 2, toughness: 2, keywords: ["flying"] }),
  trinket: card("trinket", "Trinket", "artifact", "{1}", "Artifact", ""),
};

test("the cards are understood", () => {
  for (const id of ["beast", "dragon", "fall", "hunger", "dispatch", "drake"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("threshold: the bonus is there with seven cards in the graveyard, and not before", () => {
  const g = setup(DEFS, [], ["beast"]);
  const beast = find(g, "m0")!;
  assert.equal(powerOf(g, beast), 1);
  g.players.p1.graveyard = Array.from({ length: 6 }, (_, i) => ({ iid: `y${i}`, defId: "bear", owner: "p1" as const }));
  assert.equal(powerOf(g, beast), 1, "six is not enough");
  g.players.p1.graveyard.push({ iid: "y6", defId: "bear", owner: "p1" });
  assert.equal(powerOf(g, beast), 8, "seven: +7/+7");
});

test("hellbent: double strike only while the hand is empty", () => {
  const g = setup(DEFS, ["bear"], ["dragon"]);
  assert.equal(hasKeywordNow(g, find(g, "m0")!, "double strike"), false, "a card in hand");
  g.players.p1.hand = [];
  assert.equal(hasKeywordNow(g, find(g, "m0")!, "double strike"), true, "an empty hand");
});

test("metalcraft: Lumengrid Drake bounces a creature only with three artifacts", () => {
  let g = setup(DEFS, ["drake"], ["trinket", "trinket", "trinket"], ["ogre"]);
  g = cast(g, "h0");
  if (g.pendingChoice) g = settle(act(g, "p1", { type: "chooseTargets", targets: [on("t0")] }));
  assert.equal(find(g, "t0"), undefined, "the Ogre went back to its owner's hand");
  let h = setup(DEFS, ["drake"], ["trinket", "trinket"], ["ogre"]);
  h = cast(h, "h0");
  assert.equal(h.pendingChoice, null);
  assert.ok(find(h, "t0"), "two artifacts: nothing happens");
});

test("Tragic Fall: -3/-3 normally, -13/-13 instead when the hand is empty", () => {
  let g = setup(DEFS, ["fall"], [], ["hulk"]);
  g.players.p1.hand.push({ iid: "extra", defId: "bear", owner: "p1" });
  g = cast(g, "h0", [on("t0")]);
  assert.equal(find(g, "t0")!.damage, 0);
  assert.equal(powerOf(g, find(g, "t0")!), 5 - 3, "5/5 became 2/2");
  let h = setup(DEFS, ["fall"], [], ["hulk"]);
  h = cast(h, "h0", [on("t0")]);
  assert.equal(find(h, "t0"), undefined, "no other cards in hand: -13/-13 killed the Hulk");
});

test("morbid: three counters instead of one when a creature died this turn", () => {
  let g = setup(DEFS, ["hunger"], ["bear"]);
  g = cast(g, "h0", [on("m0")]);
  assert.equal(find(g, "m0")!.counters, 1);
  let h = setup(DEFS, ["hunger", "bolt"], ["bear"], ["bear"]);
  h = cast(h, "h1", [on("t0")]);
  assert.equal(find(h, "t0"), undefined, "the Bear died");
  h = cast(h, "h0", [on("m0")]);
  assert.equal(find(h, "m0")!.counters, 3);
  void act; void creature; void perm;
});

test("metalcraft: Dispatch taps, and exiles with three artifacts", () => {
  let g = setup(DEFS, ["dispatch"], ["trinket", "trinket"], ["bear"]);
  g = cast(g, "h0", [on("t0")]);
  assert.equal(find(g, "t0")!.tapped, true);
  let h = setup(DEFS, ["dispatch"], ["trinket", "trinket", "trinket"], ["bear"]);
  h = cast(h, "h0", [on("t0")]);
  assert.equal(find(h, "t0"), undefined, "exiled");
});
