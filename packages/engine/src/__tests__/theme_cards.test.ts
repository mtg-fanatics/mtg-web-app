import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportedCard, powerOf, toughnessOf } from "../index.js";
import type { CardDef } from "../index.js";
import { act, attack, card, cast, creature, find, nextTurn, on, pick, player, setup, settle, top } from "./themeKit.js";

// Cards of the older theme decks (real text): blue flyers and card draw, control magic, goblins, and the red and white spells.
const DEFS: Record<string, CardDef> = {
  fisher: card("fisher", "Aven Fisher", "creature", "{3}{U}", "Creature — Bird Soldier", "Flying\nWhen Aven Fisher dies, you may draw a card.", { power: 2, toughness: 2 }),
  magpie: card("magpie", "Thieving Magpie", "creature", "{2}{U}{U}", "Creature — Bird", "Flying\nWhenever Thieving Magpie deals damage to an opponent, draw a card.", { power: 1, toughness: 3 }),
  confiscate: card("confiscate", "Confiscate", "enchantment", "{4}{U}{U}", "Enchantment — Aura", "Enchant permanent\nYou control enchanted permanent."),
  mind: card("mind", "Mind Control", "enchantment", "{3}{U}{U}", "Enchantment — Aura", "Enchant creature\nYou control enchanted creature."),
  arcanis: card("arcanis", "Arcanis the Omnipotent", "creature", "{3}{U}{U}{U}", "Legendary Creature — Wizard", "{T}: Draw three cards.\n{2}{U}{U}: Return Arcanis to its owner's hand.", { power: 3, toughness: 4 }),
  telling: card("telling", "Telling Time", "instant", "{1}{U}", "Instant", "Look at the top three cards of your library. Put one of those cards into your hand, one on top of your library, and one on the bottom of your library."),
  matron: card("matron", "Goblin Matron", "creature", "{2}{R}", "Creature — Goblin", "When Goblin Matron enters the battlefield, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle your library.", { power: 1, toughness: 1 }),
  king: card("king", "Goblin King", "creature", "{1}{R}{R}", "Creature — Goblin", "Other Goblins get +1/+1 and have mountainwalk.", { power: 2, toughness: 2 }),
  goblin: creature("goblin", 1, 1, "{R}", "Creature — Goblin"),
  scout: card("scout", "Viashino Sandscout", "creature", "{1}{R}", "Creature — Lizard Scout", "Haste\nAt the beginning of the end step, return Viashino Sandscout to its owner's hand.", { power: 2, toughness: 2 }),
  beacon: card("beacon", "Beacon of Destruction", "instant", "{3}{R}{R}", "Instant", "Beacon of Destruction deals 5 damage to any target. Shuffle Beacon of Destruction into its owner's library."),
  armageddon: card("armageddon", "Armageddon", "sorcery", "{3}{W}", "Sorcery", "Destroy all lands."),
  peace: card("peace", "False Peace", "sorcery", "{W}", "Sorcery", "Target player skips all combat phases of their next turn."),
  enrage: card("enrage", "Enrage", "instant", "{X}{R}", "Instant", "Target creature gets +X/+0 until end of turn."),
  isleland: { id: "isleland", name: "Island", type: "land", cost: 0, typeLine: "Basic Land — Island", text: "{T}: Add {U}." },
};

test("every card of these theme decks is understood", () => {
  for (const id of ["fisher", "magpie", "confiscate", "mind", "arcanis", "telling", "matron", "king", "scout", "beacon", "armageddon", "peace", "enrage"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("Aven Fisher: when it dies you may draw a card (and may decline)", () => {
  for (const [accept, hand] of [[true, 1], [false, 0]] as const) {
    let g = setup(DEFS, ["bolt"], ["fisher"]);
    g = cast(g, "h0", [on("m0")]);
    assert.equal(g.pendingPick?.kind, "mayPay");
    g = settle(act(g, "p1", accept ? { type: "pick", iid: "pay" } : { type: "pick" }));
    assert.equal(g.players.p1.hand.length, hand);
  }
});

test("Thieving Magpie draws a card each time it hurts the opponent, and flies over a ground blocker", () => {
  let g = setup(DEFS, [], ["magpie"], ["ogre"]);
  find(g, "m0")!.summoningSick = false;
  top(g, ["bear", "bear"]);
  g = attack(g, ["m0"]);
  assert.equal(g.phase === "blockers", false, "the ogre has no way to block a flyer");
  assert.equal(g.players.p2.life, 19);
  assert.equal(g.players.p1.hand.length, 1);
});

test("Mind Control takes a creature while it is on the battlefield, and gives it back when it leaves", () => {
  let g = setup(DEFS, ["mind"], [], ["ogre"]);
  g = cast(g, "h0", [on("t0")]);
  assert.ok(g.players.p1.battlefield.some((p) => p.card.iid === "t0"), "p1 controls the ogre now");
  assert.ok(!g.players.p2.battlefield.some((p) => p.card.iid === "t0"));
  assert.equal(find(g, "t0")!.summoningSick, true, "it has just come under p1's control");
});

test("Mind Control: when the Aura is destroyed, the creature goes back to its owner", () => {
  let g = setup(DEFS, ["mind", "bolt"], [], ["ogre"]);
  g.cards.disenchant = card("disenchant", "Disenchant", "instant", "{1}{W}", "Instant", "Destroy target enchantment.");
  g.players.p1.hand.push({ iid: "d0", defId: "disenchant", owner: "p1" });
  g = cast(g, "h0", [on("t0")]);
  const auraIid = g.players.p1.battlefield.find((p) => p.attachedTo === "t0")!.card.iid;
  g = cast(g, "d0", [on(auraIid)]);
  assert.ok(g.players.p2.battlefield.some((p) => p.card.iid === "t0"), "the ogre is p2's again");
  assert.ok(!g.players.p1.battlefield.some((p) => p.card.iid === "t0"));
});

test("a creature taken by Mind Control that dies goes to its OWNER's graveyard", () => {
  let g = setup(DEFS, ["mind", "bolt", "bolt"], [], ["hulk"]);
  g = cast(g, "h0", [on("t0")]);
  g = cast(g, "h1", [on("t0")]);
  g = cast(g, "h2", [on("t0")]);
  assert.equal(find(g, "t0"), undefined);
  assert.ok(g.players.p2.graveyard.some((c) => c.iid === "t0"), "in p2's graveyard");
  assert.ok(!g.players.p1.graveyard.some((c) => c.iid === "t0"));
  assert.ok(g.players.p1.graveyard.some((c) => c.defId === "mind"), "the Aura is in p1's graveyard");
});

test("Confiscate takes any permanent: a land too", () => {
  let g = setup(DEFS, ["confiscate"], [], []);
  g = cast(g, "h0", [on("k0")]);
  assert.ok(g.players.p1.battlefield.some((p) => p.card.iid === "k0"));
});

test("Arcanis taps to draw three, and returns to its owner's hand for {2}{U}{U}", () => {
  let g = setup(DEFS, [], ["arcanis"]);
  find(g, "m0")!.summoningSick = false;
  top(g, ["bear", "bear", "bear"]);
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0 }));
  assert.equal(g.players.p1.hand.length, 3);
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 1 }));
  assert.equal(find(g, "m0"), undefined);
  assert.ok(g.players.p1.hand.some((c) => c.defId === "arcanis"));
});

test("Telling Time: one card to the hand, one on top, one on the bottom", () => {
  let g = setup(DEFS, ["telling"]);
  top(g, ["bear", "ogre", "hulk"]);
  const library = g.players.p1.library.length;
  g = cast(g, "h0");
  assert.equal(g.pendingPick?.kind, "toHand");
  g = pick(g, "topp11"); // ogre to the hand
  assert.equal(g.pendingPick?.kind, "keepTop");
  assert.deepEqual([...g.pendingPick!.options].sort(), ["topp10", "topp12"]);
  g = pick(g, "topp12"); // hulk stays on top, bear to the bottom
  assert.equal(g.pendingPick, null);
  assert.equal(g.players.p1.hand.at(-1)?.defId, "ogre");
  assert.equal(g.players.p1.library[0].defId, "hulk");
  assert.equal(g.players.p1.library.at(-1)?.defId, "bear");
  assert.equal(g.players.p1.library.length, library - 1);
});

test("Telling Time with only two cards left: one in hand, the other stays on top", () => {
  let g = setup(DEFS, ["telling"]);
  g.players.p1.library = [];
  top(g, ["bear", "ogre"]);
  g = cast(g, "h0");
  g = pick(g, "topp10");
  assert.equal(g.pendingPick, null);
  assert.equal(g.players.p1.library.length, 1);
  assert.equal(g.players.p1.library[0].defId, "ogre");
});

test("Goblin Matron searches for a Goblin card and may find none", () => {
  let g = setup(DEFS, ["matron"]);
  g.players.p1.library = [{ iid: "lib0", defId: "bear", owner: "p1" }, { iid: "lib1", defId: "king", owner: "p1" }, { iid: "lib2", defId: "goblin", owner: "p1" }];
  g = cast(g, "h0");
  g = settle(g);
  assert.equal(g.pendingPick?.kind, "searchAny");
  assert.deepEqual([...g.pendingPick!.options].sort(), ["lib1", "lib2"]);
  g = pick(g, "lib1");
  assert.ok(g.players.p1.hand.some((c) => c.defId === "king"));
  // declining
  let h = setup(DEFS, ["matron"]);
  h.players.p1.library = [{ iid: "lib0", defId: "king", owner: "p1" }];
  h = settle(cast(h, "h0"));
  h = settle(act(h, "p1", { type: "pick" }));
  assert.equal(h.players.p1.hand.length, 0);
});

test("Goblin King gives other Goblins +1/+1 (whoever's they are) and mountainwalk, but not itself", () => {
  const g = setup(DEFS, [], ["king", "goblin", "bear"], ["goblin"]);
  assert.equal(powerOf(g, find(g, "m0")!), 2, "the King itself is not boosted");
  assert.equal(powerOf(g, find(g, "m1")!), 2, "a Goblin of mine");
  assert.equal(toughnessOf(g, find(g, "m1")!), 2);
  assert.equal(powerOf(g, find(g, "m2")!), 2, "a Bear is not a Goblin");
  assert.equal(powerOf(g, find(g, "t0")!), 2, "the opponent's Goblin gets it too");
});

test("mountainwalk from Goblin King: unblockable while the defender controls a Mountain", () => {
  const play = (withMountain: boolean) => {
    let g = setup(DEFS, [], ["king", "goblin"], ["bear"]);
    find(g, "m1")!.summoningSick = false;
    if (withMountain) g.players.p2.battlefield.push({ card: { iid: "mt", defId: "mountain", owner: "p2" }, tapped: false, summoningSick: false, damage: 0 });
    g.phase = "attackers";
    g = act(g, "p1", { type: "declareAttackers", attackers: ["m1"] });
    return settleToBlockers(g);
  };
  assert.notEqual(play(true).phase, "blockers", "the Bear can't block a creature with mountainwalk when p2 controls a Mountain");
  assert.equal(play(false).phase, "blockers", "without a Mountain it can block");
});
function settleToBlockers(g: ReturnType<typeof setup>) {
  while (g.priority && g.phase !== "blockers") g = act(g, g.priority.holder, { type: "passPriority" });
  return g;
}

test("Viashino Sandscout has haste, and returns to its owner's hand at the end step", () => {
  let g = setup(DEFS, ["scout"]);
  g = cast(g, "h0");
  g = attack(g, ["h0"]);
  assert.equal(g.players.p2.life, 18, "it attacked at once");
  g = nextTurn(g);
  assert.equal(find(g, "h0"), undefined, "it went back");
  assert.ok(g.players.p1.hand.some((c) => c.iid === "h0"));
});

test("Beacon of Destruction deals 5 damage and is shuffled into its owner's library", () => {
  let g = setup(DEFS, ["beacon"], [], ["hulk"]);
  const library = g.players.p1.library.length;
  g = cast(g, "h0", [on("t0")]);
  assert.equal(find(g, "t0"), undefined, "5 damage kills the 5/5");
  assert.equal(g.players.p1.library.length, library + 1);
  assert.ok(g.players.p1.library.some((c) => c.iid === "h0"));
  assert.ok(!g.players.p1.graveyard.some((c) => c.iid === "h0"));
});

test("Beacon of Destruction that fizzles goes to the graveyard, not the library", () => {
  let g = setup(DEFS, ["beacon"], [], ["ogre"]);
  g.players.p2.hand = [{ iid: "pb", defId: "bolt", owner: "p2" }];
  g.players.p2.battlefield.push({ card: { iid: "pm", defId: "mountain", owner: "p2" }, tapped: false, summoningSick: false, damage: 0 });
  g = act(g, "p1", { type: "castSpell", iid: "h0", targets: [on("t0")] });
  assert.equal(g.priority?.holder, "p2", "p2 may respond");
  g = act(g, "p2", { type: "castSpell", iid: "pb", targets: [on("t0")] }); // in response: p2 kills its own ogre, so Beacon has no target left
  g = settle(g);
  assert.equal(find(g, "t0"), undefined);
  assert.ok(g.players.p1.graveyard.some((c) => c.iid === "h0"), "a spell that fizzles goes to the graveyard");
  assert.ok(!g.players.p1.library.some((c) => c.iid === "h0"));
});

test("Armageddon destroys every land, both players'", () => {
  let g = setup(DEFS, ["armageddon"], ["bear"], []);
  g = cast(g, "h0");
  const lands = [...g.players.p1.battlefield, ...g.players.p2.battlefield].filter((p) => g.cards[p.card.defId].type === "land");
  assert.equal(lands.length, 0);
  assert.ok(find(g, "m0"), "the creature stays");
  assert.equal(g.players.p2.graveyard.filter((c) => c.defId === "island").length, 2);
});

test("False Peace: the player skips combat in their next turn only", () => {
  let g = setup(DEFS, ["peace"], [], ["ogre"]);
  g = cast(g, "h0", [player("p2")]);
  assert.equal(g.players.p2.skipCombat, g.turn + 1);
  g = nextTurn(g);
  assert.equal(g.active, "p2");
  assert.equal(g.phase, "main1");
  g = act(g, "p2", { type: "passPhase" });
  assert.equal(g.phase, "main2", "no combat phase");
  g = nextTurn(g);
  g = nextTurn(g); // p1's turn, and then p2's again
  assert.equal(g.active, "p2");
  g = act(g, "p2", { type: "passPhase" });
  assert.equal(g.phase, "attackers", "combat is back the turn after");
});

test("False Peace cast on yourself skips your own next turn's combat", () => {
  let g = setup(DEFS, ["peace"], ["bear"]);
  g = cast(g, "h0", [player("p1")]);
  assert.equal(g.players.p1.skipCombat, g.turn + 2);
});

test("Enrage gives +X/+0 for the X that was paid", () => {
  let g = setup(DEFS, ["enrage"], ["bear"]);
  g = cast(g, "h0", [on("m0")], { x: 3 });
  assert.equal(powerOf(g, find(g, "m0")!), 5);
  assert.equal(toughnessOf(g, find(g, "m0")!), 2);
});

test("Spells attack: a Magpie attack draws only when it deals damage", () => {
  let g = setup(DEFS, [], ["magpie"], ["bear"]);
  find(g, "m0")!.summoningSick = false;
  top(g, ["bear"]);
  g = attack(g, ["m0"]);
  assert.equal(g.players.p1.hand.length, 1);
});

test("\"Whenever ~ deals damage to an opponent\" also counts damage that is not combat damage (a pinger), and not damage to a creature", () => {
  const pinger = card("pinger", "Pinger", "creature", "{1}{U}", "Creature — Wizard", "{T}: Pinger deals 1 damage to any target.\nWhenever Pinger deals damage to an opponent, draw a card.", { power: 1, toughness: 1 });
  let g = setup({ pinger }, [], ["pinger"], ["bear"]);
  find(g, "m0")!.summoningSick = false;
  top(g, ["bear", "bear"]);
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [player("p2")] }));
  assert.equal(g.players.p2.life, 19);
  assert.equal(g.players.p1.hand.length, 1, "drew for hurting the opponent");
  let h = setup({ pinger }, [], ["pinger"], ["bear"]);
  find(h, "m0")!.summoningSick = false;
  top(h, ["bear"]);
  h = settle(act(h, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [on("t0")] }));
  assert.equal(h.players.p1.hand.length, 0, "damage to a creature does not count");
});
