import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, CARDS, createGame, getPossibleAttackers, getPossibleBlockers, isSupportedCard, powerOf, toughnessOf } from "../index.js";
import type { Action, CardDef, CardInstance, GameState, PlayerId } from "../index.js";

const ench = (id: string, name: string, text: string, typeLine = "Enchantment — Aura", keywords: string[] = ["enchant"]): CardDef => ({
  id,
  name,
  type: "enchantment",
  cost: 1,
  manaCost: "{R}",
  typeLine,
  text,
  keywords,
});
const creature = (id: string, power = 2, toughness = 2): CardDef => ({ id, name: id, type: "creature", cost: 1, manaCost: "{R}", power, toughness });

const DEFS: Record<string, CardDef> = {
  ...CARDS,
  bear: creature("bear"),
  bear2: creature("bear2"),
  mighty: ench("mighty", "Mighty", "Enchant creature\nEnchanted creature gets +2/+2 and has flying."),
  pacifism: ench("pacifism", "Pacifism", "Enchant creature\nEnchanted creature can't attack or block."),
  chill: ench("chill", "Chill", "Enchant creature\nEnchanted creature doesn't untap during its controller's untap step."),
  vigor: ench("vigor", "Vigor", "Enchant creature\nWhen this Aura enters, draw a card.\nEnchanted creature gets +1/+1."),
  sour: ench("sour", "Sour", "Enchant creature\nEnchanted creature gets -2/-2."),
  mine: ench("mine", "Mine", "Enchant creature you control\nEnchanted creature gets +1/+1."),
  anthem: ench("anthem", "Anthem", "Creatures you control get +1/+1.", "Enchantment", []),
  lord: ench("lord", "Lord", "Other creatures you control get +1/+1 and have first strike.", "Enchantment", []),
  banish: { id: "banish", name: "Banish", type: "instant", cost: 1, manaCost: "{R}", text: "Destroy target enchantment." },
  disenchant: { id: "disenchant", name: "Disenchant", type: "instant", cost: 1, manaCost: "{R}", text: "Destroy target artifact or enchantment." },
  kill: { id: "kill", name: "Kill", type: "instant", cost: 1, manaCost: "{R}", text: "Destroy target creature." },
  equipment: { id: "equipment", name: "Equipment", type: "artifact", cost: 1, manaCost: "{R}", typeLine: "Artifact — Equipment", text: "Whenever equipped creature blocks a creature with flying, draw a card." },
  trinket: { id: "trinket", name: "Trinket", type: "artifact", cost: 1, manaCost: "{R}", typeLine: "Artifact", text: "" },
};

const perm = (iid: string, defId: string, owner: PlayerId = "p1") => ({ card: { iid, defId, owner } as CardInstance, tapped: false, summoningSick: false, damage: 0 });

function setup(hand: string[], mine: string[] = [], theirs: string[] = [], opponentHand: string[] = []): GameState {
  const g = createGame({ p1: Array(40).fill("mountain"), p2: Array(40).fill("mountain") }, 1);
  g.cards = { ...DEFS };
  g.players.p1.hand = hand.map((d, i) => ({ iid: `h${i}`, defId: d, owner: "p1" }));
  g.players.p2.hand = opponentHand.map((d, i) => ({ iid: `o${i}`, defId: d, owner: "p2" }));
  g.players.p1.battlefield = [...Array.from({ length: 4 }, (_, i) => perm(`l${i}`, "mountain")), ...mine.map((d, i) => perm(`m${i}`, d))];
  g.players.p2.battlefield = [...Array.from({ length: 4 }, (_, i) => perm(`q${i}`, "mountain", "p2")), ...theirs.map((d, i) => perm(`t${i}`, d, "p2"))];
  return g;
}
function act(s: GameState, p: PlayerId, a: Action): GameState {
  const r = applyAction(s, p, a);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}
const find = (g: GameState, iid: string) => [...g.players.p1.battlefield, ...g.players.p2.battlefield].find((p) => p.card.iid === iid)!;
const castOn = (g: GameState, iid: string, target: string) => act(g, "p1", { type: "castSpell", iid, targets: [{ kind: "permanent", iid: target }] });

test("the common aura and enchantment texts are understood; equipment with an unread trigger is not", () => {
  for (const id of ["mighty", "pacifism", "chill", "vigor", "sour", "mine", "anthem", "lord", "banish", "disenchant"]) assert.equal(isSupportedCard(DEFS[id]), true, id);
  assert.equal(isSupportedCard(DEFS.equipment), false);
});

test("an Aura is cast on a creature, attaches to it, and changes its power, toughness and keywords", () => {
  let g = setup(["mighty"], ["bear"]);
  g.phase = "main1";
  g = castOn(g, "h0", "m0");
  const aura = g.players.p1.battlefield.find((p) => p.card.iid === "h0")!;
  assert.equal(aura.attachedTo, "m0");
  assert.equal(powerOf(g, find(g, "m0")), 4);
  assert.equal(toughnessOf(g, find(g, "m0")), 4);
  // flying: an opposing creature with no flying or reach can't block it
  g.players.p2.battlefield.push(perm("t0", "bear", "p2"));
  g.phase = "attackers";
  const attack = act(g, "p1", { type: "declareAttackers", attackers: ["m0"] });
  const blocked = applyAction(attack, "p2", { type: "declareBlockers", blocks: [{ blocker: "t0", attacker: "m0" }] });
  assert.equal(blocked.ok, false);
});

test("the Aura goes to the graveyard when its creature dies", () => {
  let g = setup(["mighty"], ["bear"]);
  g.phase = "main1";
  g = castOn(g, "h0", "m0");
  g.players.p1.hand = [{ iid: "k", defId: "kill", owner: "p1" }];
  g = act(g, "p1", { type: "castSpell", iid: "k", targets: [{ kind: "permanent", iid: "m0" }] });
  assert.equal(g.players.p1.battlefield.some((p) => p.card.iid === "h0"), false);
  assert.deepEqual(g.players.p1.graveyard.map((c) => c.iid).sort(), ["h0", "k", "m0"]);
});

test("an Aura whose target is gone when it resolves fizzles", () => {
  let g = setup(["mighty"], ["bear"], [], ["kill"]);
  g.phase = "main1";
  g = castOn(g, "h0", "m0");
  assert.ok(g.priority); // the opponent holds an instant and has mana: they may respond
  g = act(g, "p2", { type: "castSpell", iid: "o0", targets: [{ kind: "permanent", iid: "m0" }] });
  assert.equal(g.players.p1.battlefield.some((p) => p.card.iid === "h0"), false);
  assert.equal(g.players.p1.graveyard.some((c) => c.iid === "h0"), true);
});

test("Pacifism: the creature can't attack or block", () => {
  let g = setup(["pacifism"], ["bear"]);
  g.phase = "main1";
  g = castOn(g, "h0", "m0");
  g.phase = "attackers";
  assert.deepEqual(getPossibleAttackers(g), []);
  assert.equal(applyAction(g, "p1", { type: "declareAttackers", attackers: ["m0"] }).ok, false);

  let h = setup(["pacifism"], [], ["bear"]);
  h.phase = "main1";
  h = castOn(h, "h0", "t0");
  h.players.p1.battlefield.push(perm("a", "bear"));
  h.phase = "blockers";
  h.combat = { attackers: [{ attacker: "a", blockers: [] }] };
  assert.deepEqual(getPossibleBlockers(h), []);
});

test("a creature that doesn't untap stays tapped", () => {
  let g = setup(["chill"], [], ["bear"]);
  g.phase = "main1";
  g = castOn(g, "h0", "t0");
  find(g, "t0").tapped = true;
  g.phase = "end";
  g = act(g, "p1", { type: "passPhase" }); // p2's turn starts: their untap step
  assert.equal(g.active, "p2");
  assert.equal(find(g, "t0").tapped, true);
  assert.equal(find(g, "q0").tapped, false);
});

test("an Aura's enter trigger works, and -2/-2 kills a 2/2", () => {
  let g = setup(["vigor"], ["bear"]);
  g.phase = "main1";
  const hand = g.players.p1.hand.length;
  g = castOn(g, "h0", "m0");
  assert.equal(g.players.p1.hand.length, hand); // the Aura left the hand (-1) and a card was drawn (+1)

  let h = setup(["sour"], [], ["bear"]);
  h.phase = "main1";
  h = castOn(h, "h0", "t0");
  assert.equal(h.players.p2.battlefield.some((p) => p.card.iid === "t0"), false);
});

test("Enchant creature you control can't go on an opponent's creature", () => {
  const g = setup(["mine"], [], ["bear"]);
  g.phase = "main1";
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "permanent", iid: "t0" }] }).ok, false);
});

test("an anthem helps only your creatures; 'other' leaves out the enchantment's own bearer", () => {
  let g = setup(["anthem"], ["bear"], ["bear2"]);
  g.phase = "main1";
  g = act(g, "p1", { type: "castSpell", iid: "h0", targets: [] });
  assert.equal(powerOf(g, find(g, "m0")), 3);
  assert.equal(powerOf(g, find(g, "t0")), 2);

  let h = setup(["lord"], ["bear"]);
  h.phase = "main1";
  h = act(h, "p1", { type: "castSpell", iid: "h0", targets: [] });
  assert.equal(powerOf(h, find(h, "m0")), 3);
});

test("destroy target enchantment, and artifact or enchantment", () => {
  let g = setup(["banish"], ["bear"], []);
  g.players.p2.battlefield.push(perm("e", "anthem", "p2"));
  g.phase = "main1";
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "permanent", iid: "m0" }] }).ok, false);
  g = castOn(g, "h0", "e");
  assert.equal(g.players.p2.battlefield.some((p) => p.card.iid === "e"), false);

  let h = setup(["disenchant"], [], []);
  h.players.p2.battlefield.push(perm("art", "trinket", "p2"));
  h.phase = "main1";
  h = castOn(h, "h0", "art");
  assert.equal(h.players.p2.battlefield.some((p) => p.card.iid === "art"), false);
});
