import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportedCard } from "../index.js";
import type { CardDef } from "../index.js";
import { act, attack, card, cast, creature, find, nextTurn, on, player, setup, settle } from "./themeKit.js";

// The cards of the older theme decks that prevent damage or gain life from it (real text).
const DEFS: Record<string, CardDef> = {
  hands: card("hands", "Mending Hands", "instant", "{W}", "Instant", "Prevent the next 4 damage that would be dealt to any target this turn."),
  salve: card("salve", "Healing Salve", "instant", "{W}", "Instant", "Choose one —\n• Target player gains 3 life.\n• Prevent the next 3 damage that would be dealt to any target this turn."),
  link: card("link", "Spirit Link", "enchantment", "{W}", "Enchantment — Aura", "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nWhenever enchanted creature deals damage, you gain that much life."),
  reversal: card("reversal", "Blessed Reversal", "instant", "{1}{W}", "Instant", "You gain 3 life for each creature attacking you."),
  samite: card("samite", "Samite Healer", "creature", "{1}{W}", "Creature — Human Cleric", "{T}: Prevent the next 1 damage that would be dealt to any target this turn.", { power: 1, toughness: 1 }),
  master: card("master", "Master Healer", "creature", "{4}{W}", "Creature — Human Cleric", "{T}: Prevent the next 4 damage that would be dealt to any target this turn.", { power: 1, toughness: 1 }),
  armor: card("armor", "Urza's Armor", "artifact", "{6}", "Artifact", "If a source would deal damage to you, prevent 1 of that damage."),
  ogre: creature("ogre", 3, 3, "{2}{R}"),
};

test("every prevention card of the theme decks is understood", () => {
  for (const id of ["hands", "salve", "link", "reversal", "samite", "master", "armor"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("Mending Hands shields a creature from the next 4 damage this turn, and what is left of the shield stays", () => {
  let g = setup(DEFS, ["hands", "bolt", "bolt"], ["ogre"]);
  g = cast(g, "h0", [on("m0")]);
  assert.equal(find(g, "m0")!.preventShield, 4);
  g = cast(g, "h1", [on("m0")]); // 3 damage: all prevented
  assert.equal(find(g, "m0")!.damage, 0);
  assert.equal(find(g, "m0")!.preventShield, 1);
  g = cast(g, "h2", [on("m0")]); // 3 damage: 1 prevented, 2 gets through
  assert.equal(find(g, "m0")!.damage, 2);
  assert.equal(find(g, "m0")!.preventShield, undefined);
});

test("a shield on a player stops the damage to them, then wears off at the end of the turn", () => {
  let g = setup(DEFS, ["hands", "bolt"]);
  g = cast(g, "h0", [player("p2")]);
  assert.equal(g.players.p2.preventShield, 4);
  g = cast(g, "h1", [player("p2")]);
  assert.equal(g.players.p2.life, 20, "the 3 damage was prevented");
  assert.equal(g.players.p2.preventShield, 1);
  g = nextTurn(g);
  assert.equal(g.players.p2.preventShield, undefined, "the shield was only for this turn");
});

test("a shield stops combat damage too, and the creature is not hurt", () => {
  let g = setup(DEFS, ["hands"], ["ogre"], ["ogre"]);
  g = cast(g, "h0", [on("m0")]);
  g.phase = "attackers";
  g = settle(act(g, "p1", { type: "declareAttackers", attackers: ["m0"] }));
  g = settle(act(g, "p2", { type: "declareBlockers", blocks: [{ blocker: "t0", attacker: "m0" }] }));
  assert.equal(find(g, "m0")!.damage, 0, "3 damage from the blocking ogre was prevented");
  assert.equal(find(g, "m0")!.preventShield, 1);
  assert.equal(find(g, "t0"), undefined, "the other ogre took 3 damage and died");
});

test("a shield on a player stops combat damage", () => {
  let g = setup(DEFS, ["hands"], [], ["ogre"]);
  g = cast(g, "h0", [player("p1")]);
  g = attack(g, ["t0"], "p2");
  assert.equal(g.players.p1.life, 20 - 0, "all 3 combat damage was prevented");
  assert.equal(g.players.p1.preventShield, 1);
});

test("damage that can't be prevented gets through a shield", () => {
  let g = setup(DEFS, ["hands", "bolt"]);
  g = cast(g, "h0", [player("p2")]);
  g.noPrevention = true;
  g = cast(g, "h1", [player("p2")]);
  assert.equal(g.players.p2.life, 17);
});

test("Healing Salve is either 3 life or a shield of 3", () => {
  const g = setup(DEFS, ["salve"], ["ogre"]);
  g.players.p1.life = 10;
  const life = cast(g, "h0", [player("p1")], { modes: [0] });
  assert.equal(life.players.p1.life, 13);
  const shield = cast(g, "h0", [on("m0")], { modes: [1] });
  assert.equal(find(shield, "m0")!.preventShield, 3);
  assert.equal(shield.players.p1.life, 10);
});

test("Samite Healer taps to shield from 1 damage, Master Healer from 4", () => {
  let g = setup(DEFS, ["bolt"], ["samite", "master", "ogre"]);
  find(g, "m0")!.summoningSick = false;
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [on("m2")] }));
  assert.equal(find(g, "m2")!.preventShield, 1);
  assert.equal(find(g, "m0")!.tapped, true);
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m1", index: 0, targets: [on("m2")] }));
  assert.equal(find(g, "m2")!.preventShield, 5);
  g = cast(g, "h0", [on("m2")]);
  assert.equal(find(g, "m2")!.damage, 0);
  assert.equal(find(g, "m2")!.preventShield, 2);
});

test("Spirit Link gains its controller life equal to the damage the creature deals, in combat and out of it", () => {
  let g = setup(DEFS, ["link"], ["ogre"]);
  g = cast(g, "h0", [on("m0")]);
  assert.equal(find(g, "m0")!.counters ?? 0, 0);
  g.players.p1.life = 10;
  g = attack(g, ["m0"]);
  assert.equal(g.players.p2.life, 17);
  assert.equal(g.players.p1.life, 13, "3 damage to the player: 3 life");
});

test("Spirit Link also counts damage dealt to a blocker, and damage that was prevented does not count", () => {
  let g = setup(DEFS, ["link", "hands"], ["ogre"], ["ogre"]);
  g = cast(g, "h0", [on("m0")]);
  g = cast(g, "h1", [on("t0")]); // shield on the blocker
  g.players.p1.life = 10;
  g.phase = "attackers";
  g = settle(act(g, "p1", { type: "declareAttackers", attackers: ["m0"] }));
  g = settle(act(g, "p2", { type: "declareBlockers", blocks: [{ blocker: "t0", attacker: "m0" }] }));
  assert.equal(find(g, "t0")!.damage, 0, "the shield took it");
  assert.equal(g.players.p1.life, 10, "no damage was dealt, so no life");
});

test("Blessed Reversal gains 3 life for each creature attacking you", () => {
  let g = setup(DEFS, ["reversal"], [], ["ogre", "ogre", "ogre"]);
  g.phase = "attackers";
  g.active = "p2";
  g = act(g, "p2", { type: "declareAttackers", attackers: ["t0", "t1"] });
  if (g.priority?.holder === "p2") g = act(g, "p2", { type: "passPriority" });
  assert.equal(g.priority?.holder, "p1");
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(g.players.p1.life, 20 + 6 - 6, "6 life from two attackers, then 6 combat damage (the ogres are unblocked)");
});

test("Blessed Reversal counts only the attackers that attack you", () => {
  let g = setup(DEFS, ["reversal"], [], ["ogre"]);
  g = cast(g, "h0");
  assert.equal(g.players.p1.life, 20, "nothing attacks you");
});

test("Urza's Armor prevents 1 of every damage dealt to its controller", () => {
  let g = setup(DEFS, ["bolt", "bolt"], [], []);
  g.players.p1.battlefield.push({ card: { iid: "arm", defId: "armor", owner: "p1" }, tapped: false, summoningSick: false, damage: 0 });
  g = cast(g, "h0", [player("p1")]);
  assert.equal(g.players.p1.life, 18, "3 damage, 1 prevented");
  g = cast(g, "h1", [player("p1")]);
  assert.equal(g.players.p1.life, 16);
  g.players.p2.battlefield.push({ card: { iid: "ogre2", defId: "ogre", owner: "p2" }, tapped: false, summoningSick: false, damage: 0 });
  g = attack(g, ["ogre2"], "p2");
  assert.equal(g.players.p1.life, 14, "a 3-power attacker deals 2 through the armor");
  g.players.p1.life = 20;
});
