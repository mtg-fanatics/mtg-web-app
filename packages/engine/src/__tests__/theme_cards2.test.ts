import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportedCard, powerOf } from "../index.js";
import type { CardDef } from "../index.js";
import { act, attack, card, cast, creature, find, nextTurn, on, pick, player, setup, settle } from "./themeKit.js";

// More cards of the older theme decks (real text): white helpers, green fliers-killers, blue tricks and the red burn.
const DEFS: Record<string, CardDef> = {
  veteran: card("veteran", "Alaborn Veteran", "creature", "{2}{W}", "Creature — Human Knight", "{T}: Target creature gets +2/+2 until end of turn. Activate only during your turn, before attackers are declared.", { power: 2, toughness: 2 }),
  fury: card("fury", "Angel of Fury", "creature", "{4}{W}{W}", "Creature — Angel", "Flying\nWhen Angel of Fury dies, you may shuffle it into its owner's library.", { power: 5, toughness: 5 }),
  wildebeests: card("wildebeests", "Stampeding Wildebeests", "creature", "{2}{G}{G}", "Creature — Antelope Beast", "Trample\nAt the beginning of your upkeep, return a green creature you control to its owner's hand.", { power: 4, toughness: 4, colors: ["G"] }),
  greenbear: card("greenbear", "Green Bear", "creature", "{1}{G}", "Creature — Bear", "", { power: 2, toughness: 2, colors: ["G"] }),
  hurricane: card("hurricane", "Hurricane", "sorcery", "{X}{G}", "Sorcery", "Hurricane deals X damage to each creature with flying and each player."),
  flyer: card("flyer", "Flyer", "creature", "{1}{U}", "Creature — Bird", "Flying", { power: 2, toughness: 2 }),
  deluge: card("deluge", "Deluge", "instant", "{2}{U}", "Instant", "Tap all creatures without flying."),
  counterbore: card("counterbore", "Counterbore", "instant", "{3}{U}{U}", "Instant", "Counter target spell. Search its controller's graveyard, hand, and library for all cards with the same name as that spell and exile them. Then that player shuffles."),
  tactics: card("tactics", "Guerrilla Tactics", "instant", "{1}{R}", "Instant", "Guerrilla Tactics deals 2 damage to any target.\nWhen a spell or ability an opponent controls causes you to discard Guerrilla Tactics, it deals 4 damage to any target."),
  mind: card("mind", "Mind Rot", "sorcery", "{2}{B}", "Sorcery", "Target player discards two cards."),
};

test("these cards are understood", () => {
  for (const id of ["veteran", "fury", "wildebeests", "hurricane", "deluge", "counterbore", "tactics"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("Alaborn Veteran pumps only on your turn before attackers are declared", () => {
  let g = setup(DEFS, [], ["veteran", "bear"]);
  find(g, "m0")!.summoningSick = false;
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [on("m1")] }));
  assert.equal(powerOf(g, find(g, "m1")!), 4);
  // after attackers are declared it can't be used any more
  let h = setup(DEFS, [], ["veteran", "bear"]);
  find(h, "m0")!.summoningSick = false;
  find(h, "m1")!.summoningSick = false;
  h = attack(h, ["m1"]);
  const r = (() => { try { return act(h, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [on("m1")] }); } catch { return null; } })();
  assert.equal(r, null, "too late: attackers are declared");
  // in the second main phase, neither
  let i = setup(DEFS, [], ["veteran", "bear"]);
  find(i, "m0")!.summoningSick = false;
  i.phase = "main2";
  const r2 = (() => { try { return act(i, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [on("m1")] }); } catch { return null; } })();
  assert.equal(r2, null);
  // and not in the opponent's turn
  let j = setup(DEFS, [], ["veteran", "bear"]);
  find(j, "m0")!.summoningSick = false;
  j.active = "p2";
  const r3 = (() => { try { return act(j, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [on("m1")] }); } catch { return null; } })();
  assert.equal(r3, null);
});

test("Angel of Fury: when it dies you may shuffle it into your library", () => {
  for (const [accept, inLibrary] of [[true, true], [false, false]] as const) {
    let g = setup(DEFS, ["bolt", "bolt"], ["fury"]);
    const library = g.players.p1.library.length;
    g = cast(g, "h0", [on("m0")]);
    g = cast(g, "h1", [on("m0")]);
    assert.equal(find(g, "m0"), undefined);
    assert.equal(g.pendingPick?.kind, "mayPay");
    g = settle(act(g, "p1", accept ? { type: "pick", iid: "pay" } : { type: "pick" }));
    assert.equal(g.players.p1.library.some((c) => c.iid === "m0"), inLibrary);
    assert.equal(g.players.p1.graveyard.some((c) => c.iid === "m0"), !inLibrary);
    if (inLibrary) assert.equal(g.players.p1.library.length, library + 1);
  }
});

test("Stampeding Wildebeests returns a green creature you control to your hand at your upkeep", () => {
  let g = setup(DEFS, [], ["wildebeests", "greenbear", "bear"]);
  g = nextTurn(g); // p2's turn
  g = nextTurn(g); // p1's turn: upkeep trigger
  assert.equal(g.pendingPick?.kind, "bounceOwn");
  assert.deepEqual([...g.pendingPick!.options].sort(), ["m0", "m1"], "only the green creatures, not the plain Bear");
  g = settle(act(g, "p1", { type: "pick", iid: "m1" }));
  assert.ok(g.players.p1.hand.some((c) => c.iid === "m1"));
  assert.ok(find(g, "m0"));
});

test("Stampeding Wildebeests alone has to return itself", () => {
  let g = setup(DEFS, [], ["wildebeests"]);
  g = nextTurn(g);
  g = nextTurn(g);
  if (g.pendingPick) g = settle(act(g, "p1", { type: "pick", iid: "m0" }));
  assert.equal(find(g, "m0"), undefined);
  assert.ok(g.players.p1.hand.some((c) => c.iid === "m0"));
});

test("Hurricane deals X to each flyer and each player, and not to ground creatures", () => {
  let g = setup(DEFS, ["hurricane"], ["bear", "flyer"], ["flyer", "ogre"]);
  g = cast(g, "h0", [], { x: 2 });
  assert.equal(g.players.p1.life, 18);
  assert.equal(g.players.p2.life, 18);
  assert.equal(find(g, "m1"), undefined, "my flyer (2/2) died");
  assert.equal(find(g, "t0"), undefined, "their flyer died");
  assert.equal(find(g, "m0")!.damage, 0);
  assert.equal(find(g, "t1")!.damage, 0);
});

test("Deluge taps every creature without flying", () => {
  let g = setup(DEFS, ["deluge"], ["bear", "flyer"], ["ogre", "flyer"]);
  g = cast(g, "h0");
  assert.equal(find(g, "m0")!.tapped, true);
  assert.equal(find(g, "t0")!.tapped, true, "the ogre too");
  assert.equal(find(g, "m1")!.tapped, false);
  assert.equal(find(g, "t1")!.tapped, false);
});

test("Counterbore counters the spell and exiles every card with its name from its controller's graveyard, hand and library", () => {
  let g = setup(DEFS, ["counterbore"]);
  g.players.p2.hand = [{ iid: "b1", defId: "bolt", owner: "p2" }, { iid: "b2", defId: "bolt", owner: "p2" }, { iid: "o1", defId: "ogre", owner: "p2" }];
  g.players.p2.graveyard = [{ iid: "b3", defId: "bolt", owner: "p2" }];
  g.players.p2.library.push({ iid: "b4", defId: "bolt", owner: "p2" });
  g.players.p2.battlefield.push({ card: { iid: "pm", defId: "mountain", owner: "p2" }, tapped: false, summoningSick: false, damage: 0 });
  g.active = "p2"; // p2 casts Bolt at p1's player in their own turn; p1 answers
  g.phase = "main1";
  g.priority = null;
  g = act(g, "p2", { type: "castSpell", iid: "b1", targets: [player("p1")] });
  assert.equal(g.priority?.holder, "p1");
  g = act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "stack", id: g.stack[0].id }] });
  g = settle(g);
  assert.equal(g.players.p1.life, 20, "the Bolt was countered");
  const names = (cards: { defId: string }[]) => cards.filter((c) => c.defId === "bolt").length;
  assert.equal(names(g.players.p2.hand), 0);
  assert.equal(names(g.players.p2.graveyard), 0, "even the countered one");
  assert.equal(names(g.players.p2.library), 0);
  assert.equal(names(g.players.p2.exile), 4);
  assert.equal(g.players.p2.hand.length, 1, "the Ogre stays");
});

test("Guerrilla Tactics deals 2 damage when cast", () => {
  let g = setup(DEFS, ["tactics"], [], ["ogre"]);
  g = cast(g, "h0", [on("t0")]);
  assert.equal(find(g, "t0")!.damage, 2);
});

test("Guerrilla Tactics deals 4 damage to any target when an opponent's spell makes you discard it", () => {
  let g = setup(DEFS, ["mind"], [], ["ogre"]);
  // p2 holds Guerrilla Tactics (and nothing else): p1's Mind Rot makes them discard it
  g.players.p2.hand = [{ iid: "gt", defId: "tactics", owner: "p2" }];
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [player("p2")] }));
  // the trigger needs a target for its 4 damage: p2 chooses
  assert.equal(g.pendingChoice?.player, "p2");
  g = choose2(g, [player("p1")]);
  assert.equal(g.players.p1.life, 16);
  assert.ok(g.players.p2.graveyard.some((c) => c.iid === "gt"));
});

function choose2(g: ReturnType<typeof setup>, targets: unknown[]) {
  return settle(act(g, g.pendingChoice!.player, { type: "chooseTargets", targets: targets as never }));
}

test("Guerrilla Tactics does not trigger when you discard it yourself", () => {
  let g = setup(DEFS, ["tactics"]);
  g.cards.looter = card("looter", "Rummage", "sorcery", "{R}", "Sorcery", "Discard a card, then draw a card.");
  g.players.p1.hand.push({ iid: "rm", defId: "looter", owner: "p1" });
  g = settle(act(g, "p1", { type: "castSpell", iid: "rm", targets: [] }));
  if (g.pendingPick) g = settle(act(g, "p1", { type: "pick", iid: "h0" }));
  assert.equal(g.pendingChoice, null);
  assert.equal(g.players.p2.life, 20);
});
