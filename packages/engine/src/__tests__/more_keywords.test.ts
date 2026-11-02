import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, getPossibleBlockers, isSupportedCard, toughnessOf } from "../index.js";
import type { CardDef } from "../index.js";
import { act, attack, card, cast, creature, find, on, setup, settle } from "./themeKit.js";

// Shroud, shadow, horsemanship and wither (real text).
const DEFS: Record<string, CardDef> = {
  beetles: card("beetles", "Pincher Beetles", "creature", "{2}{G}", "Creature — Insect", "Shroud", { power: 3, toughness: 1, keywords: ["shroud"] }),
  horror: card("horror", "Dauthi Horror", "creature", "{1}{B}", "Creature — Shade", "Shadow\nDauthi Horror can't be blocked by white creatures.", { power: 2, toughness: 1, keywords: ["shadow"] }),
  shade: card("shade", "Dauthi Slayer", "creature", "{B}{B}", "Creature — Shade", "Shadow\nDauthi Slayer attacks each combat if able.", { power: 2, toughness: 2, keywords: ["shadow"] }),
  zhao: card("zhao", "Wei Strike Force", "creature", "{2}{B}", "Creature — Human Soldier", "Horsemanship", { power: 3, toughness: 2, keywords: ["horsemanship"] }),
  ram: card("ram", "Boggart Ram-Gang", "creature", "{R/G}{R/G}{R/G}", "Creature — Goblin Warrior", "Haste\nWither", { power: 3, toughness: 3, keywords: ["haste", "wither"] }),
  bolt: card("bolt", "Bolt", "instant", "{R}", "Instant", "Bolt deals 3 damage to target creature."),
};

test("the keywords are understood", () => {
  for (const id of ["beetles", "ram", "zhao"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("shroud: nobody can target it, not even its controller", () => {
  const g = setup(DEFS, ["bolt"], ["beetles"], ["beetles"]);
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [on("t0")] }).ok, false, "an opponent's");
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [on("m0")] }).ok, false, "its own controller's");
});

test("shadow can be blocked only by creatures with shadow, and a shadow creature blocks only shadow creatures", () => {
  let g = setup(DEFS, [], ["horror"], ["bear"]);
  find(g, "m0")!.summoningSick = false;
  g.cards.bear = { ...g.cards.bear };
  g = attack(g, ["m0"]);
  assert.deepEqual(getPossibleBlockers(g), [], "a Bear can't block it");
  assert.equal(g.players.p2.life, 18, "so it was not blocked");
  // the other way round: a shadow creature can't block an ordinary attacker
  let h = setup(DEFS, [], ["bear"], ["shade"]);
  find(h, "m0")!.summoningSick = false;
  h = attack(h, ["m0"]);
  assert.deepEqual(getPossibleBlockers(h), []);
});

test("shadow blocks shadow", () => {
  let g = setup(DEFS, [], ["horror"], ["shade"]);
  find(g, "m0")!.summoningSick = false;
  g = attack(g, ["m0"]);
  assert.deepEqual(getPossibleBlockers(g), ["t0"]);
});

test("horsemanship can be blocked only by creatures with horsemanship", () => {
  let g = setup(DEFS, [], ["zhao"], ["bear", "zhao"]);
  find(g, "m0")!.summoningSick = false;
  g = attack(g, ["m0"]);
  assert.equal(applyAction(g, "p2", { type: "declareBlockers", blocks: [{ attacker: "m0", blocker: "t0" }] }).ok, false);
  assert.equal(applyAction(g, "p2", { type: "declareBlockers", blocks: [{ attacker: "m0", blocker: "t1" }] }).ok, true);
});

test("wither: combat damage to a creature is -1/-1 counters, to a player ordinary damage", () => {
  let g = setup(DEFS, [], ["ram"], ["bear"]);
  find(g, "m0")!.summoningSick = false;
  g = attack(g, ["m0"]);
  g = settle(act(g, "p2", { type: "declareBlockers", blocks: [{ attacker: "m0", blocker: "t0" }] }));
  const ogre = find(g, "t0");
  // the 2/2 Bear took 3 damage as counters: dead, and it dealt 2 to the Ram-Gang
  assert.equal(ogre, undefined, "the Bear died");
  const ram = find(g, "m0")!;
  assert.equal(ram.damage, 2, "the Ram-Gang took ordinary damage (the Bear has no wither)");
  let h = setup(DEFS, [], ["ram"], []);
  find(h, "m0")!.summoningSick = false;
  h = attack(h, ["m0"]);
  assert.equal(h.players.p2.life, 17, "players take it as ordinary damage");
});

test("wither damage stays: a surviving creature keeps the -1/-1 counters", () => {
  let g = setup(DEFS, [], ["ram"], ["hulk"]);
  find(g, "m0")!.summoningSick = false;
  g = attack(g, ["m0"]);
  g = settle(act(g, "p2", { type: "declareBlockers", blocks: [{ attacker: "m0", blocker: "t0" }] }));
  const hulk = find(g, "t0")!;
  assert.equal(hulk.damage, 0);
  assert.equal(toughnessOf(g, hulk), 2, "5/5 with three -1/-1 counters");
  void cast; void creature;
});
