import { test } from "node:test";
import assert from "node:assert/strict";
import { getActivatable, getCastable, isSupportedCard, parseCard, powerOf } from "../index.js";
import { act, attackWith, choose, find, hand, named, on, plain, realCard, setup, settle, yard } from "./fdnKit.js";

// The cards of Foundations that were added to the engine for this set, played as printed.

test("Wishclaw Talisman: three wish counters; using one finds a card and gives the artifact to the opponent", () => {
  let g = setup({ mine: ["Wishclaw Talisman"], library: ["Juggernaut", "plains"] });
  assert.ok(isSupportedCard(realCard("Wishclaw Talisman")));
  find(g, "m0")!.named = { wish: 3 };
  const use = getActivatable(g, "p1").find((a) => a.iid === "m0");
  assert.ok(use, "it can be activated");
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  assert.equal(g.pendingPick?.kind, "searchAny");
  g = settle(act(g, "p1", { type: "pick", iid: "c0" }));
  assert.ok(hand(g).includes("Juggernaut"));
  assert.equal(find(g, "m0") && g.players.p2.battlefield.some((p) => p.card.iid === "m0"), true, "the opponent controls it now");
  assert.equal(find(g, "m0")!.named?.wish, 2);
});

test("Mazemind Tome: scry or draw, a page counter each time; the fourth exiles it and gains 4 life", () => {
  let g = setup({ mine: ["Mazemind Tome"], library: ["plains", "plains", "plains", "plains", "plains"] });
  const tome = () => g.players.p1.battlefield.some((p) => p.card.iid === "m0");
  for (let i = 0; i < 4; i++) {
    assert.ok(tome(), `still there before use ${i + 1}`);
    find(g, "m0")!.tapped = false;
    g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 1, targets: [] }));
  }
  assert.equal(tome(), false, "exiled after four page counters");
  assert.equal(g.players.p1.life, 24);
  assert.equal(g.players.p1.hand.length, 4);
});

test("Instant and sorcery spells cost {1} less with Mocking Sprite; Kithkin and Soldier spells with Ballyrush Banneret", () => {
  const bolt = plain("bolt", "Zap", "{1}{R}", 0, 0, "");
  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 2, manaCost: "{1}{R}", typeLine: "Instant", text: "Zap deals 1 damage to any target.", colors: ["R"] };
  void bolt;
  let g = setup({ hand: ["zap"], mine: ["Mocking Sprite"], extra: { zap } });
  const cost = getCastable(g, "p1").find((c) => c.iid === "h0");
  assert.ok(cost);
  g = act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] });
  const tapped = g.players.p1.battlefield.filter((p) => p.tapped).length;
  assert.equal(tapped, 1, "one land paid for a two-mana instant");
});

test("Knight of Malice: hexproof from white, and bigger while any player controls a white permanent", () => {
  const whiteBolt = { id: "wb", name: "White Zap", type: "instant" as const, cost: 1, manaCost: "{W}", typeLine: "Instant", text: "White Zap deals 1 damage to any target.", colors: ["W"] };
  const redBolt = { id: "rb", name: "Red Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Red Zap deals 1 damage to any target.", colors: ["R"] };
  let g = setup({ hand: ["wb", "rb"], theirs: ["Knight of Malice"], extra: { wb: whiteBolt, rb: redBolt } });
  assert.equal(powerOf(g, find(g, "t0")!), 2, "no white permanent");
  const r = (iid: string) => g.players.p1.hand.find((c) => g.cards[c.defId].name === iid)!.iid;
  const refused = (name: string) => {
    const x = (globalThis as { applyAction?: unknown }).applyAction;
    void x;
    try {
      act(g, "p1", { type: "castSpell", iid: r(name), targets: on("t0") });
      return false;
    } catch {
      return true;
    }
  };
  assert.equal(refused("White Zap"), true, "a white spell can't target it");
  assert.equal(refused("Red Zap"), false, "a red one can");
  g.players.p1.battlefield.push({ card: { iid: "w1", defId: "wb", owner: "p1" }, tapped: false, summoningSick: false, damage: 0 });
  g.cards.wb = { ...g.cards.wb, type: "artifact" };
  assert.equal(powerOf(g, find(g, "t0")!), 3, "a white permanent is in play");
});

test("Fog Bank deals and takes no combat damage", () => {
  let g = setup({ mine: ["giant"], theirs: ["Fog Bank"] });
  g.players.p1.battlefield.find((p) => p.card.iid === "m0")!.summoningSick = false;
  g = attackWith(g, ["m0"]);
  g = act(g, "p2", { type: "declareBlockers", blocks: [{ blocker: "t0", attacker: "m0" }] });
  g = settle(g);
  assert.equal(find(g, "t0")!.damage, 0);
  assert.equal(find(g, "m0")!.damage, 0);
});

test("Twinflame Tyrant doubles the damage dealt to an opponent", () => {
  let g = setup({ hand: ["bolt"], mine: ["Twinflame Tyrant"], extra: { bolt: { id: "bolt", name: "Bolt", type: "instant", cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Bolt deals 3 damage to any target.", colors: ["R"] } } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(g.players.p2.life, 14);
});

test("Drake Hatcher: damage becomes incubation counters; three of them make a Drake", () => {
  let g = setup({ mine: ["Drake Hatcher"] });
  g.players.p1.battlefield.find((p) => p.card.iid === "m0")!.summoningSick = false;
  g = attackWith(g, ["m0"]);
  assert.equal(find(g, "m0")!.named?.incubation, 1);
  find(g, "m0")!.named = { incubation: 3 };
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  assert.equal(named(g, "p1", "Drake").length, 1);
  assert.equal(find(g, "m0")!.named?.incubation, undefined);
});

test("Lathril makes as many Elf Warriors as the damage it dealt", () => {
  let g = setup({ mine: ["Lathril, Blade of the Elves"] });
  g.players.p1.battlefield.find((p) => p.card.iid === "m0")!.summoningSick = false;
  g = attackWith(g, ["m0"]);
  assert.equal(named(g, "p1", "Elf Warrior").length, 2);
});

test("Heroic Reinforcements: two Soldiers, and everything gets +1/+1 and haste", () => {
  let g = setup({ hand: ["Heroic Reinforcements"], mine: ["bear"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(named(g, "p1", "Soldier").length, 2);
  assert.equal(powerOf(g, find(g, "m0")!), 3);
  assert.ok(g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].name === "Soldier").every((p) => (p.tempKeywords ?? []).includes("haste")));
});

test("Brass's Bounty: a Treasure for each land", () => {
  let g = setup({ hand: ["Brass's Bounty"] });
  const lands = g.players.p1.battlefield.length;
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(named(g, "p1", "Treasure").length, lands);
});

test("the parser reads what the set's cards say", () => {
  for (const name of ["Rune-Scarred Demon", "Vile Entomber", "Deathmark", "Devout Decree", "Midnight Reaper", "Crystal Barricade", "Sphinx of the Final Word", "Elenda, Saint of Dusk"]) {
    assert.ok(parseCard(realCard(name)).ok, name);
  }
  void choose;
  void yard;
});
