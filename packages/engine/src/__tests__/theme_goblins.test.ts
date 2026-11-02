import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, isSupportedCard, powerOf } from "../index.js";
import type { CardDef, GameState } from "../index.js";
import { act, attack, card, cast, creature, find, nextTurn, on, setup, settle } from "./themeKit.js";

// The goblin cards of the older theme decks (real text).
const DEFS: Record<string, CardDef> = {
  general: card("general", "Goblin General", "creature", "{1}{R}{R}", "Creature — Goblin Warrior", "Whenever Goblin General attacks, Goblin creatures you control get +1/+1 until end of turn.", { power: 2, toughness: 2 }),
  goblin: creature("goblin", 1, 1, "{R}", "Creature — Goblin"),
  jagged: card("jagged", "Jagged Lightning", "sorcery", "{3}{R}{R}", "Sorcery", "Jagged Lightning deals 3 damage to each of two target creatures."),
  relentless: card("relentless", "Relentless Assault", "sorcery", "{2}{R}{R}", "Sorcery", "Untap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase."),
};

test("the goblin cards are understood", () => {
  for (const id of ["general", "jagged", "relentless"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("Goblin General: when it attacks, every Goblin you control (itself too) gets +1/+1 until end of turn", () => {
  let g = setup(DEFS, [], ["general", "goblin", "bear"]);
  for (const iid of ["m0", "m1", "m2"]) find(g, iid)!.summoningSick = false;
  g = attack(g, ["m0", "m1"]);
  // the pump lasted for the combat that followed: the damage dealt shows it
  assert.equal(g.players.p2.life, 20 - 3 - 2, "General 3 + Goblin 2");
  assert.equal(powerOf(g, find(g, "m2")!), 2, "the Bear is not a Goblin");
  assert.equal(powerOf(g, find(g, "m0")!), 3, "the bonus lasts until end of turn");
});

test("Goblin General only pumps the Goblins of its controller", () => {
  let g = setup(DEFS, [], ["general"], ["goblin"]);
  find(g, "m0")!.summoningSick = false;
  g = attack(g, ["m0"]);
  assert.equal(powerOf(g, find(g, "t0")!), 1);
});

test("Jagged Lightning deals 3 damage to each of two different target creatures", () => {
  let g = setup(DEFS, ["jagged"], ["bear"], ["ogre", "hulk"]);
  g = cast(g, "h0", [on("t0"), on("t1")]);
  assert.equal(find(g, "t0"), undefined, "the 3/3 died");
  assert.equal(find(g, "t1")!.damage, 3, "the 5/5 took 3");
  assert.equal(find(g, "m0")!.damage, 0);
});

test("Jagged Lightning needs two different targets", () => {
  const g = setup(DEFS, ["jagged"], [], ["ogre", "hulk"]);
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [on("t0"), on("t0")] }).ok, false);
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [on("t0")] }).ok, false);
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [on("t0"), on("t1")] }).ok, true);
});

function step(g: GameState): GameState {
  return settle(act(g, g.active, { type: "passPhase" }));
}

test("Relentless Assault cast after combat: the attackers untap, and there is another combat and another main phase", () => {
  let g = setup(DEFS, ["relentless"], ["ogre"]);
  find(g, "m0")!.summoningSick = false;
  g = attack(g, ["m0"]);
  assert.equal(g.players.p2.life, 17);
  assert.equal(g.phase, "main2");
  assert.equal(find(g, "m0")!.tapped, true);
  g = cast(g, "h0");
  assert.equal(find(g, "m0")!.tapped, false, "it untapped");
  g = step(g); // main2 ends: the additional combat phase
  assert.equal(g.phase, "attackers");
  g = settle(act(g, "p1", { type: "declareAttackers", attackers: ["m0"] }));
  assert.equal(g.players.p2.life, 14, "it attacks a second time");
  assert.equal(g.phase, "main2", "the additional main phase");
  g = step(g);
  assert.equal(g.phase, "end", "and then the turn ends");
});

test("Relentless Assault cast before combat: the additional combat and main come first, then the regular combat", () => {
  let g = setup(DEFS, ["relentless"], ["ogre", "bear"]);
  find(g, "m0")!.summoningSick = false;
  find(g, "m1")!.summoningSick = false;
  g = cast(g, "h0");
  g = step(g); // main1 ends: the additional combat
  assert.equal(g.phase, "attackers");
  g = settle(act(g, "p1", { type: "declareAttackers", attackers: ["m0"] })); // the ogre attacks
  assert.equal(g.players.p2.life, 17);
  assert.equal(g.phase, "main2", "the additional main phase");
  g = step(g);
  assert.equal(g.phase, "attackers", "the regular combat is still to come");
  g = settle(act(g, "p1", { type: "declareAttackers", attackers: ["m1"] })); // the bear attacks
  assert.equal(g.players.p2.life, 15);
  assert.equal(g.phase, "main2", "the regular second main phase");
  g = step(g);
  assert.equal(g.phase, "end");
});

test("Relentless Assault without attacking in the additional combat still goes on to the additional main phase", () => {
  let g = setup(DEFS, ["relentless"], ["ogre"]);
  find(g, "m0")!.summoningSick = false;
  g.phase = "main2";
  g = cast(g, "h0");
  g = step(g);
  assert.equal(g.phase, "attackers");
  g = step(g); // no attack
  assert.equal(g.phase, "main2");
  g = step(g);
  assert.equal(g.phase, "end");
});

test("the extra phases do not carry over into the next turn", () => {
  let g = setup(DEFS, ["relentless"], ["ogre"]);
  g.phase = "main2";
  g = cast(g, "h0");
  g = nextTurn(g);
  assert.equal(g.extraCombatMain, undefined);
  assert.equal(g.extraStep, undefined);
});

// Wildfire, Magnivore, Anarchist and Goblin Firestarter (real text)
const MORE: Record<string, CardDef> = {
  wildfire: card("wildfire", "Wildfire", "sorcery", "{4}{R}{R}", "Sorcery", "Each player sacrifices four lands of their choice. Wildfire deals 4 damage to each creature."),
  magnivore: card("magnivore", "Magnivore", "creature", "{2}{R}{R}", "Creature — Lhurgoyf", "Haste\nMagnivore's power and toughness are each equal to the number of sorcery cards in all graveyards.", { power: undefined, toughness: undefined }),
  anarchist: card("anarchist", "Anarchist", "creature", "{4}{R}", "Creature — Human Wizard", "When Anarchist enters the battlefield, you may return target sorcery card from your graveyard to your hand.", { power: 2, toughness: 2 }),
  firestarter: card("firestarter", "Goblin Firestarter", "creature", "{R}", "Creature — Goblin", "Sacrifice Goblin Firestarter: It deals 1 damage to any target. Activate only during your turn, before attackers are declared.", { power: 1, toughness: 1 }),
  armageddon: card("armageddon", "Armageddon", "sorcery", "{3}{W}", "Sorcery", "Destroy all lands."),
};
Object.assign(DEFS, MORE);

test("Wildfire, Magnivore, Anarchist and Goblin Firestarter are understood", () => {
  for (const id of ["wildfire", "magnivore", "anarchist", "firestarter"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("Wildfire: each player chooses four lands to sacrifice, then every creature takes 4", () => {
  let g = setup(DEFS, ["wildfire"], ["bear", "hulk"], ["ogre"]);
  g.players.p2.battlefield.push(...["a", "b", "c", "d", "e"].map((x) => ({ card: { iid: `pl${x}`, defId: "mountain", owner: "p2" as const }, tapped: false, summoningSick: false, damage: 0 })));
  const mineLands = () => g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].type === "land").length;
  const before = mineLands();
  g = act(g, "p1", { type: "castSpell", iid: "h0", targets: [] });
  g = settle(g);
  // p1 chooses first (the caster), four times
  assert.equal(g.pendingPick?.kind, "sacrificeOwn");
  assert.equal(g.pendingPick?.player, "p1");
  assert.equal(g.pendingPick?.remaining, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(g.pendingPick?.player, "p1");
    g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  }
  assert.equal(g.pendingPick?.player, "p2", "then the opponent chooses");
  assert.equal(g.pendingPick?.options.length, 7);
  for (let i = 0; i < 4; i++) g = settle(act(g, "p2", { type: "pick", iid: g.pendingPick!.options[0] }));
  assert.equal(g.pendingPick, null);
  assert.equal(mineLands(), before - 4 - 0, "(the caster paid with six of them: they tapped, but still count)");
  assert.equal(g.players.p2.battlefield.filter((p) => g.cards[p.card.defId].type === "land").length, 3, "7 lands, 4 sacrificed");
  assert.equal(find(g, "m0"), undefined, "the Bear died");
  assert.equal(find(g, "m1")!.damage, 4, "the 5/5 took 4");
  assert.equal(find(g, "t0"), undefined, "the Ogre died");
});

test("Wildfire: a player with four lands or fewer sacrifices them all without being asked", () => {
  let g = setup(DEFS, ["wildfire"], [], []);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  // p2 has only two lands: gone at once; p1 still has to choose 4 of the remaining lands
  assert.equal(g.pendingPick?.player, "p1");
  for (let i = 0; i < 4; i++) g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  assert.equal(g.pendingPick, null);
  assert.equal(g.players.p2.battlefield.filter((p) => g.cards[p.card.defId].type === "land").length, 0);
});

test("Magnivore is as big as the number of sorcery cards in all graveyards, and has haste", () => {
  let g = setup(DEFS, ["magnivore"]);
  g.players.p1.graveyard = [{ iid: "s1", defId: "wildfire", owner: "p1" }, { iid: "s2", defId: "bolt", owner: "p1" }];
  g.players.p2.graveyard = [{ iid: "s3", defId: "armageddon", owner: "p2" }];
  g = cast(g, "h0");
  assert.equal(powerOf(g, find(g, "h0")!), 2, "two sorceries in graveyards (the Bolt is an instant)");
  g.players.p2.graveyard.push({ iid: "s4", defId: "wildfire", owner: "p2" });
  assert.equal(powerOf(g, find(g, "h0")!), 3);
  g = attack(g, ["h0"]);
  assert.equal(g.players.p2.life, 17, "haste: it attacked at once");
});

test("Anarchist returns a sorcery card from your graveyard to your hand (not an instant)", () => {
  let g = setup(DEFS, ["anarchist"]);
  g.players.p1.graveyard = [{ iid: "s1", defId: "wildfire", owner: "p1" }, { iid: "s2", defId: "bolt", owner: "p1" }];
  g = settle(cast(g, "h0"));
  // the only sorcery card is chosen by itself: the Bolt (an instant) is not a legal target
  assert.ok(g.players.p1.hand.some((c) => c.iid === "s1"));
  assert.ok(g.players.p1.graveyard.some((c) => c.iid === "s2"));
});

test("Anarchist with two sorceries in the graveyard lets you choose", () => {
  let g = setup(DEFS, ["anarchist"]);
  g.players.p1.graveyard = [{ iid: "s1", defId: "wildfire", owner: "p1" }, { iid: "s3", defId: "armageddon", owner: "p1" }, { iid: "s2", defId: "bolt", owner: "p1" }];
  g = settle(cast(g, "h0"));
  assert.equal(g.pendingChoice?.player, "p1");
  assert.equal(applyAction(g, "p1", { type: "chooseTargets", targets: [{ kind: "card", iid: "s2" }] }).ok, false, "an instant is not a legal target");
  g = settle(act(g, "p1", { type: "chooseTargets", targets: [{ kind: "card", iid: "s3" }] }));
  assert.ok(g.players.p1.hand.some((c) => c.iid === "s3"));
});

test("Anarchist with no sorcery card does nothing", () => {
  let g = setup(DEFS, ["anarchist"]);
  g.players.p1.graveyard = [{ iid: "s2", defId: "bolt", owner: "p1" }];
  g = settle(cast(g, "h0"));
  assert.equal(g.players.p1.hand.length, 0);
  assert.ok(find(g, "h0"));
});

test("Goblin Firestarter: sacrifice it for 1 damage, before attackers are declared in your turn", () => {
  let g = setup(DEFS, [], ["firestarter"], ["ogre"]);
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [on("t0")] }));
  assert.equal(find(g, "m0"), undefined);
  assert.equal(find(g, "t0")!.damage, 1);
  let h = setup(DEFS, [], ["firestarter"], ["ogre"]);
  h.phase = "main2";
  assert.equal(applyAction(h, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [on("t0")] }).ok, false);
});
