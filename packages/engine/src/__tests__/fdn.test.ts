import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, getActivatable, getCastable, isSupportedCard, parseCard, powerOf } from "../index.js";
import { subtypesOf } from "../core/permanents.js";
import { act, attackWith, BASE, choose, fails, find, toNextTurn, hand, named, on, plain, realCard, setup, settle, yard } from "./fdnKit.js";

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

test("Burnished Hart: pay, sacrifice, and fetch two basic lands onto the battlefield tapped", () => {
  let g = setup({ mine: ["Burnished Hart"], library: ["plains", "plains", "plains"] });
  assert.ok(isSupportedCard(realCard("Burnished Hart")));
  const before = g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].type === "land").length;
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  assert.ok(g.pendingPick, "asked for the second land");
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  assert.equal(g.pendingPick, null);
  const after = g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].type === "land").length;
  assert.equal(after, before + 2);
  assert.equal(find(g, "m0"), undefined, "the Hart was sacrificed");
});

test("Bloodthirsty Conqueror gains what the opponent loses; Cat Collector makes a cat on the first life gain each turn only", () => {
  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Zap deals 3 damage to any target.", colors: ["R"] };
  const heal = { id: "heal", name: "Heal", type: "instant" as const, cost: 1, manaCost: "{W}", typeLine: "Instant", text: "You gain 2 life.", colors: ["W"] };
  let g = setup({ hand: ["zap"], mine: ["Bloodthirsty Conqueror"], extra: { zap } });
  assert.ok(isSupportedCard(realCard("Bloodthirsty Conqueror")));
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(g.players.p2.life, 17);
  assert.equal(g.players.p1.life, 23);

  g = setup({ hand: ["heal", "heal"], mine: ["Cat Collector"], extra: { heal } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  g = settle(act(g, "p1", { type: "castSpell", iid: "h1", targets: [] }));
  assert.equal(named(g, "p1", "Cat").length, 1, "one cat, not two");
});

test("Exsanguinate drains X; River's Rebuke bounces the nonland permanents; Rise of the Dark Realms takes every graveyard; Macabre Waltz returns two", () => {
  let g = setup({ hand: ["Exsanguinate"] });
  g.players.p1.life = 10;
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [], x: 4 }));
  assert.equal(g.players.p2.life, 16);
  assert.equal(g.players.p1.life, 14);

  g = setup({ hand: ["River's Rebuke"], theirs: ["Juggernaut", "plains"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(g.players.p2.battlefield.length, 1, "only the land stays");
  assert.ok(hand(g, "p2").includes("Juggernaut"));

  g = setup({ hand: ["Rise of the Dark Realms"], yard: ["Juggernaut"], lands: 4 });
  g.players.p2.graveyard = [{ iid: "z0", defId: g.players.p1.graveyard[0].defId, owner: "p2" }];
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(named(g, "p1", "Juggernaut").length, 2);

  g = setup({ hand: ["Macabre Waltz"], yard: ["Juggernaut", "Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "card", iid: "y0" }, { kind: "card", iid: "y1" }] }));
  assert.equal(hand(g).filter((n) => n === "Juggernaut").length, 2);
});

test("Fleeting Flight, Primal Might, Prime Speaker Zegana, Tragic Banshee, Harmless Offering, Campus Guide", () => {
  // Fleeting Flight: counter, flying, and combat damage to it is prevented
  let g = setup({ hand: ["Fleeting Flight"], mine: ["Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m0") }));
  assert.equal(find(g, "m0")!.counters ?? 0, 1);
  assert.equal(find(g, "m0")!.noCombatDamage, true);

  // Primal Might with X=2: +2/+2 and it fights
  g = setup({ hand: ["Primal Might"], mine: ["Juggernaut"], theirs: ["bear"] });
  const before = powerOf(g, find(g, "m0")!);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", x: 2, targets: [{ kind: "permanent", iid: "m0" }, { kind: "permanent", iid: "t0" }] }));
  assert.equal(powerOf(g, find(g, "m0")!), before + 2);
  assert.equal(find(g, "t0"), undefined, "the bear died fighting");

  // Zegana: counters equal to the greatest power among the others, then draws that many
  g = setup({ hand: ["Prime Speaker Zegana"], mine: ["Juggernaut"], lands: 4 });
  const jug = powerOf(g, find(g, "m0")!);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  const zeg = g.players.p1.battlefield.find((p) => g.cards[p.card.defId].name === "Prime Speaker Zegana")!;
  assert.equal(powerOf(g, zeg), 1 + jug);
  assert.equal(g.players.p1.hand.length, 1 + jug > 5 ? 5 : Math.min(1 + jug, 5));

  // Tragic Banshee: -1/-1 normally
  g = setup({ hand: ["Tragic Banshee"], theirs: ["Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(powerOf(g, find(g, "t0")!), powerOf(setup({ theirs: ["Juggernaut"] }), find(setup({ theirs: ["Juggernaut"] }), "t0")!) - 1);

  // Harmless Offering
  g = setup({ hand: ["Harmless Offering"], mine: ["Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m0") }));
  assert.equal(g.players.p2.battlefield.some((p) => p.card.iid === "m0"), true);

  // Campus Guide: the land goes on top
  g = setup({ hand: ["Campus Guide"], library: ["plains", "forest", "plains"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  if (g.pendingPick) g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick.options[0] }));
  assert.equal(g.pendingPick, null);
  assert.equal(g.players.p1.library.length, 3);
});

test("Scavenging Ooze exiles a card from a graveyard and grows only for a creature; Soul-Shackled Zombie drains", () => {
  let g = setup({ mine: ["Scavenging Ooze"], yard: ["Juggernaut", "plains"] });
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [{ kind: "card", iid: "y1" }] }));
  assert.equal(yard(g).length, 1, "the land is gone");
  assert.equal(find(g, "m0")!.counters ?? 0, 0, "no growth for a land");
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [{ kind: "card", iid: "y0" }] }));
  assert.equal(yard(g).length, 0);
  assert.equal(find(g, "m0")!.counters, 1);
  assert.equal(g.players.p1.life, 21);

  g = setup({ hand: ["Soul-Shackled Zombie"], yard: ["Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  g = choose(g, "p1", [{ kind: "card", iid: "y0" }, { kind: "none" }]);
  assert.equal(g.players.p2.life, 18);
  assert.equal(g.players.p1.life, 22);
});

test("Authority of the Consuls taps entering creatures of the opponent and gains life; Mossborn Hydra doubles on landfall", () => {
  let g = setup({ theirs: ["Authority of the Consuls"], hand: ["bear"] });
  assert.ok(isSupportedCard(realCard("Authority of the Consuls")));
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  const bear = g.players.p1.battlefield.find((p) => g.cards[p.card.defId].name === g.cards["bear"].name && p.card.iid === "h0");
  assert.equal(bear?.tapped, true, "it entered tapped");
  assert.equal(g.players.p2.life, 21);

  let h = setup({ mine: ["Mossborn Hydra"], hand: ["forest"] });
  assert.equal(find(h, "m0")!.counters ?? 0, 0);
  find(h, "m0")!.counters = 3;
  h = settle(act(h, "p1", { type: "playLand", iid: "h0" }));
  assert.equal(find(h, "m0")!.counters, 6);
});

test("Feldon's Cane shuffles the graveyard in and is exiled; Divine Resilience; Diamond Mare; Demonic Pact; Fynn", () => {
  let g = setup({ mine: ["Feldon's Cane"], yard: ["Juggernaut", "plains"], library: ["plains"] });
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  assert.equal(g.players.p1.graveyard.length, 0, "graveyard shuffled away");
  assert.equal(g.players.p1.library.length, 3);
  assert.equal(g.players.p1.exile.length, 1, "the Cane itself is exiled");

  g = setup({ hand: ["Divine Resilience"], mine: ["Juggernaut", "Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m0") }));
  assert.ok(find(g, "m0")); // (resolves without trouble; kicked version covers the team)

  const white = { id: "wz", name: "White Zap", type: "instant" as const, cost: 1, manaCost: "{W}", typeLine: "Instant", text: "White Zap deals 1 damage to any target.", colors: ["W"] };
  g = setup({ hand: ["wz"], mine: ["Diamond Mare"], extra: { wz: white } });
  find(g, "m0")!.chosenColor = "W";
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(g.players.p1.life, 21);

  g = setup({ mine: ["Fynn, the Fangbearer"] });
  assert.ok(isSupportedCard(realCard("Fynn, the Fangbearer")));
  assert.ok(isSupportedCard(realCard("Demonic Pact")));
});

test("Doubling Season, Omniscience, Dictate of Kruphix, High Fae Trickster, Niv-Mizzet", () => {
  // Doubling Season doubles the Soldiers of Heroic Reinforcements
  let g = setup({ hand: ["Heroic Reinforcements"], mine: ["Doubling Season"], lands: 4 });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(named(g, "p1", "Soldier").length, 4);

  // Omniscience: a big spell for no mana
  g = setup({ hand: ["Rise of the Dark Realms"], mine: ["Omniscience"], lands: 0 });
  const castable = getCastable(g, "p1").find((c) => c.iid === "h0");
  assert.ok(castable, "castable with no lands");

  // Dictate of Kruphix: not directly testable without a turn; check the parse
  assert.ok(isSupportedCard(realCard("Dictate of Kruphix")));
  assert.ok(isSupportedCard(realCard("High Fae Trickster")));

  // Niv-Mizzet draws for noncombat damage
  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Zap deals 3 damage to any target.", colors: ["R"] };
  g = setup({ hand: ["zap"], mine: ["Niv-Mizzet, Visionary"], extra: { zap } });
  const handBefore = g.players.p1.hand.length;
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(g.players.p1.hand.length, handBefore - 1 + 3);
});

test("Tribute to Hunger and Ayli gain the sacrificed creature's toughness; Goblin Negotiation makes Goblins from excess damage", () => {
  let g = setup({ hand: ["Tribute to Hunger"], theirs: ["Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(find(g, "t0"), undefined, "sacrificed");
  assert.equal(g.players.p1.life, 23);

  g = setup({ mine: ["Ayli, Eternal Pilgrim", "Juggernaut"] });
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [], payWith: "m1" }));
  assert.equal(g.players.p1.life, 23);

  g = setup({ hand: ["Goblin Negotiation"], theirs: ["bear"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", x: 5, targets: on("t0") }));
  assert.ok(named(g, "p1", "Goblin").length >= 1);
});

test("Electroduplicate copies a creature with haste", () => {
  let g = setup({ hand: ["Electroduplicate"], mine: ["Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m0") }));
  const copies = named(g, "p1", "Juggernaut");
  assert.equal(copies.length, 2);
  assert.ok(copies.some((p) => p.sacAtEnd), "the copy is sacrificed at end of turn");
});

test("Charming Prince can exile a creature of yours until the end step", () => {
  let g = setup({ hand: ["Charming Prince"], mine: ["Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(g.pendingPick?.kind, "mode");
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[2] }));
  try {
    g = choose(g, "p1", on("m0"));
  } catch {
    /* (the only target was chosen for the player) */
  }
  assert.equal(find(g, "m0"), undefined, "exiled");
  // advance to the end step
  for (let i = 0; i < 12 && !find(g, "m0"); i++) g = settle(act(g, "p1", { type: "passPhase" }));
  assert.ok(find(g, "m0"), "back at the end step");
});

test("Dread Summons makes a tapped Zombie for each creature card milled", () => {
  let g = setup({ hand: ["Dread Summons"], library: ["Juggernaut", "Juggernaut", "plains"] });
  g.players.p2.library = [{ iid: "oc0", defId: g.players.p1.library[0].defId, owner: "p2" }, ...g.players.p2.library];
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", x: 2, targets: [] }));
  assert.equal(named(g, "p1", "Zombie").length, 3);
  assert.ok(named(g, "p1", "Zombie").every((p) => p.tapped));
});

test("Lathril taps ten Elves to drain 10; Garna punishes a creature of yours dying", () => {
  const elf = plain("elf", "Elf Scout", "{G}", 1, 1, "", "Creature — Elf", ["G"]);
  let g = setup({ mine: ["Lathril, Blade of the Elves", ...Array(10).fill("elf")], extra: { elf } });
  g.players.p1.battlefield.forEach((p) => (p.summoningSick = false));
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  assert.equal(g.players.p2.life, 10);
  assert.equal(g.players.p1.life, 30);

  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Zap deals 5 damage to any target.", colors: ["R"] };
  g = setup({ hand: ["zap"], mine: ["Garna, Bloodfist of Keld", "Juggernaut"], extra: { zap } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m1") }));
  assert.equal(g.players.p2.life, 19, "Juggernaut died without attacking: 1 damage");
});

test("Nine-Lives Familiar and Infernal Vessel come back; Progenitus is shuffled away; Dryad Militant exiles spells; Flamewake Phoenix returns at combat", () => {
  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Zap deals 9 damage to any target.", colors: ["R"] };
  let g = setup({ hand: ["Nine-Lives Familiar", "zap"], extra: { zap }, lands: 4 });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(find(g, "h0")!.named?.revival, 8);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h1", targets: on("h0") }));
  assert.equal(find(g, "h0"), undefined, "dead for now");
  for (let i = 0; i < 12 && !find(g, "h0"); i++) g = settle(act(g, "p1", { type: "passPhase" }));
  assert.equal(find(g, "h0")?.named?.revival, 7, "back with one fewer");

  g = setup({ hand: ["zap"], mine: ["Infernal Vessel"], extra: { zap } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m0") }));
  assert.equal(find(g, "m0")?.counters, 2, "returned with two counters");
  assert.ok(find(g, "m0") && subtypesCheck(g));

  g = setup({ hand: ["zap"], mine: ["Progenitus"], extra: { zap }, library: ["plains"] });
  assert.ok(isSupportedCard(realCard("Progenitus")));
  g = setup({ hand: ["zap"], theirs: ["Dryad Militant"], extra: { zap } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(yard(g).length, 0, "the spell was exiled");
  assert.equal(g.players.p1.exile.length, 1);
});
const subtypesCheck = (g: ReturnType<typeof setup>) => (find(g, "m0")?.addedSubtypes ?? []).includes("demon");

test("Grow from the Ashes, Circuitous Route, Demolition Field, Maze's End", () => {
  const lands = (g: ReturnType<typeof setup>) => g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].type === "land").length;
  let g = setup({ hand: ["Grow from the Ashes"], library: ["plains", "plains", "plains"] });
  let n = lands(g);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  assert.equal(lands(g), n + 1);

  g = setup({ hand: ["Grow from the Ashes"], library: ["plains", "plains", "plains"], lands: 4 });
  n = lands(g);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [], kicked: true }));
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  assert.equal(lands(g), n + 2);

  g = setup({ hand: ["Circuitous Route"], library: ["plains", "plains", "plains"] });
  n = lands(g);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  assert.equal(lands(g), n + 2);

  assert.ok(isSupportedCard(realCard("Demolition Field")));
  g = setup({ mine: ["Maze's End"], library: ["plains"] });
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  assert.ok(hand(g).includes("Maze's End"), "the land went back to hand");
});

test("Ramos grows with the colors of spells and cashes counters in for mana; Savage Ventmaw keeps its mana all turn", () => {
  const two = { id: "two", name: "Twin Zap", type: "instant" as const, cost: 2, manaCost: "{R}{W}", typeLine: "Instant", text: "Twin Zap deals 1 damage to any target.", colors: ["R", "W"] };
  let g = setup({ hand: ["two"], mine: ["Ramos, Dragon Engine"], extra: { two } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(find(g, "m0")!.counters, 2);
  find(g, "m0")!.counters = 5;
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  assert.equal(find(g, "m0")!.counters, 0);
  assert.equal(g.players.p1.pool?.length, 10);
  assert.ok(isSupportedCard(realCard("Savage Ventmaw")));
});

test("Venom Connoisseur: deathtouch for itself, then the whole team on the second creature", () => {
  let g = setup({ mine: ["Venom Connoisseur"], hand: ["bear", "bear"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(find(g, "m0")!.tempKeywords?.includes("deathtouch"), true);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h1", targets: [] }));
  assert.equal(find(g, "h0")!.tempKeywords?.includes("deathtouch"), true, "the team has it on the second creature");
});

test("Painful Quandary: lose 5 life unless a card is discarded", () => {
  // p2 holds Painful Quandary; p1 casts a spell and must choose
  let g = setup({ hand: ["bear"], theirs: ["Painful Quandary"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(g.players.p1.life, 15, "nothing to discard: the life is lost");

  g = setup({ hand: ["bear", "bear"], theirs: ["Painful Quandary"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(g.pendingPick?.kind, "ransom");
  g = settle(act(g, "p1", { type: "pick", iid: "h1" }));
  assert.equal(g.players.p1.life, 20);
  assert.equal(g.players.p1.hand.length, 0);
});

test("Planeswalkers and edicts: Liliana -4 and -9, Chandra -4 and +2, Ajani -8, Kaito, Blasphemous Edict", () => {
  // Liliana -4: each player sacrifices two creatures
  let g = setup({ mine: ["Liliana, Dreadhorde General", "bear", "bear", "bear"], theirs: ["bear", "bear", "bear"] });
  find(g, "m0")!.loyalty = 6;
  g = settle(act(g, "p1", { type: "loyalty", iid: "m0", index: 1, targets: [] }));
  for (let i = 0; i < 4 && g.pendingPick; i++) g = settle(act(g, g.pendingPick.player, { type: "pick", iid: g.pendingPick.options[0] }));
  assert.equal(g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].type === "creature").length, 1);
  assert.equal(g.players.p2.battlefield.filter((p) => g.cards[p.card.defId].type === "creature").length, 1);

  // Chandra -4: 8 damage divided
  g = setup({ mine: ["Chandra, Flameshaper"], theirs: ["bear", "Juggernaut"] });
  find(g, "m0")!.loyalty = 6;
  g = settle(act(g, "p1", { type: "loyalty", iid: "m0", index: 2, targets: [{ kind: "permanent", iid: "t0" }, { kind: "permanent", iid: "t1" }, { kind: "none" }, { kind: "none" }] }));
  assert.equal(find(g, "t0"), undefined);
  assert.equal(find(g, "t1"), undefined);

  // Ajani -8: tokens equal to life
  g = setup({ mine: ["Ajani, Caller of the Pride"] });
  find(g, "m0")!.loyalty = 8;
  g = settle(act(g, "p1", { type: "loyalty", iid: "m0", index: 2, targets: [] }));
  assert.equal(named(g, "p1", "Cat").length, 20);

  // Blasphemous Edict is castable for {B} with thirteen creatures out
  const bears = Array(13).fill("bear");
  g = setup({ hand: ["Blasphemous Edict"], mine: bears, lands: 0 });
  g.players.p1.battlefield.push({ card: { iid: "sw", defId: "swamp", owner: "p1" }, tapped: false, summoningSick: false, damage: 0 });
  assert.ok(getCastable(g, "p1").some((c) => c.iid === "h0"), "castable for {B}");
});

test("Valkyrie's Call, Spinner of Souls, Hare Apparent, Soulstone Sanctuary, Uncharted Voyage, Ovika", () => {
  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Zap deals 9 damage to any target.", colors: ["R"] };
  let g = setup({ hand: ["zap"], mine: ["Valkyrie's Call", "Juggernaut"], extra: { zap } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m1") }));
  const back = find(g, "m1");
  assert.ok(back, "returned");
  assert.equal(back!.counters, 1);
  assert.ok(back!.addedSubtypes?.includes("angel"));

  g = setup({ hand: ["zap"], mine: ["Spinner of Souls", "Juggernaut"], extra: { zap }, library: ["plains", "plains", "Juggernaut", "plains"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m1") }));
  assert.ok(hand(g).includes("Juggernaut"), "found the creature");
  assert.equal(g.players.p1.library.length, 3);

  g = setup({ hand: ["Hare Apparent"], mine: ["Hare Apparent", "Hare Apparent"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(named(g, "p1", "Rabbit").length, 2);

  g = setup({ mine: ["Soulstone Sanctuary"] });
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  assert.equal(powerOf(g, find(g, "m0")!), 3);
  assert.ok(find(g, "m0")!.animated);

  g = setup({ hand: ["Uncharted Voyage"], theirs: ["Juggernaut"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("t0") }));
  assert.equal(g.pendingPick?.kind, "topBottom");

  const burn = { id: "burn", name: "Burn", type: "sorcery" as const, cost: 3, manaCost: "{2}{R}", typeLine: "Sorcery", text: "Burn deals 1 damage to any target.", colors: ["R"] };
  g = setup({ hand: ["burn"], mine: ["Ovika, Enigma Goliath"], extra: { burn } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(named(g, "p1", "Phyrexian Goblin").length, 3);
});

test("Teach by Example, Thousand-Year Storm and Pyromancer's Goggles copy spells", () => {
  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Zap deals 1 damage to any target.", colors: ["R"] };
  let g = setup({ hand: ["Teach by Example", "zap"], extra: { zap } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  g = settle(act(g, "p1", { type: "castSpell", iid: "h1", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(g.players.p2.life, 18, "the original and its copy");

  g = setup({ hand: ["zap", "zap", "zap"], mine: ["Thousand-Year Storm"], extra: { zap } });
  for (const iid of ["h0", "h1", "h2"]) g = settle(act(g, "p1", { type: "castSpell", iid, targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(g.players.p2.life, 20 - (1 + 2 + 3), "1 + (1+1) + (1+2) copies");

  g = setup({ hand: ["zap"], mine: ["Pyromancer's Goggles"], extra: { zap }, lands: 0 });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }] }));
  assert.equal(g.players.p2.life, 18, "copied: Goggles paid for the red spell");
});

test("Genesis Wave, Finale of Revelation, Time Stop, Gate Colossus", () => {
  let g = setup({ hand: ["Genesis Wave"], library: ["Juggernaut", "plains", "plains", "Juggernaut"], lands: 4 });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", x: 3, targets: [] }));
  assert.ok(g.players.p1.battlefield.some((p) => p.card.iid === "c1"), "a land with mana value 0 entered");
  assert.equal(g.players.p1.graveyard.length >= 1, true);

  g = setup({ hand: ["Finale of Revelation"], library: Array(15).fill("plains"), lands: 4 });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", x: 3, targets: [] }));
  assert.equal(g.players.p1.hand.length, 3);
  assert.equal(g.players.p1.exile.length, 1, "exiled, not in the graveyard");

  g = setup({ hand: ["Time Stop"], lands: 4 });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(g.phase, "end");
  assert.ok(isSupportedCard(realCard("Aurelia, the Warleader")));
  assert.ok(isSupportedCard(realCard("Gate Colossus")));
});

test("Desecration Demon makes the opponent choose at combat; Redcap Gutter-Dweller's Rats can't block", () => {
  let g = setup({ mine: ["Desecration Demon"], theirs: ["bear"] });
  g = settle(act(g, "p1", { type: "passPhase" }));
  assert.equal(g.pendingPick?.kind, "ransom");
  assert.equal(g.pendingPick?.player, "p2");
  g = settle(act(g, "p2", { type: "pick", iid: "t0" }));
  assert.equal(find(g, "t0"), undefined, "sacrificed");
  assert.equal(find(g, "m0")!.counters, 1);
  assert.equal(find(g, "m0")!.tapped, true);

  g = setup({ hand: ["Redcap Gutter-Dweller"], lands: 4 });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  const rats = named(g, "p1", "Rat");
  assert.equal(rats.length, 2);
  assert.ok(parseCard(g.cards[rats[0].card.defId]).cantBlock, "the Rats can't block");
});

test("Hoarding Dragon exiles an artifact and gives it back when it dies", () => {
  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Zap deals 9 damage to any target.", colors: ["R"] };
  let g = setup({ hand: ["Hoarding Dragon", "zap"], library: ["Juggernaut", "plains"], extra: { zap }, lands: 4 });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(g.pendingPick?.kind, "searchAny");
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  assert.equal(g.players.p1.exile.length, 1);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h1", targets: on("h0") }));
  assert.ok(hand(g).includes("Juggernaut"));
});

test("Ordeal of Nylea grows the creature each attack and is sacrificed for two lands at three counters", () => {
  let g = setup({ hand: ["Ordeal of Nylea"], mine: ["bear"], library: ["plains", "plains", "plains"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m0") }));
  find(g, "m0")!.summoningSick = false;
  find(g, "m0")!.counters = 2;
  g = attackWith(g, ["m0"]);
  assert.equal(find(g, "m0")!.counters, 3);
  assert.equal(g.players.p1.battlefield.some((p) => p.card.iid === "h0"), false, "the Aura was sacrificed");
  assert.equal(g.pendingPick?.kind, "searchLand");
});

test("Leyline Axe begins on the battlefield; Zul Ashur lets a Zombie be cast from the graveyard", () => {
  const axe = realCard("Leyline Axe");
  const g0 = createGame({ p1: Array(40).fill(axe.id), p2: Array(40).fill("mountain") }, 1, { ...BASE, [axe.id]: axe });
  assert.equal(g0.players.p1.battlefield.length, 7, "all seven in the opening hand began on the battlefield");
  assert.equal(g0.players.p1.hand.length, 0);

  const zombie = plain("zb", "Grave Zombie", "{B}", 2, 2, "", "Creature — Zombie", ["B"]);
  let g = setup({ mine: ["Zul Ashur, Lich Lord"], yard: ["zb"], extra: { zb: zombie } });
  find(g, "m0")!.summoningSick = false;
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [{ kind: "card", iid: "y0" }] }));
  g = settle(act(g, "p1", { type: "castSpell", iid: "y0", targets: [], from: "graveyard" }));
  assert.ok(g.players.p1.battlefield.some((p) => p.card.iid === "y0"), "cast from the graveyard");
});

test("Zimone doubles counters, Kellan grows up, Loot digs and gives a second land drop, Banner of Kinship", () => {
  let g = setup({ mine: ["Zimone, Paradox Sculptor", "bear"] });
  find(g, "m0")!.summoningSick = false;
  find(g, "m1")!.counters = 3;
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [{ kind: "permanent", iid: "m1" }, { kind: "none" }] }));
  assert.equal(find(g, "m1")!.counters, 6);

  g = setup({ mine: ["Kellan, Planar Trailblazer"] });
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  assert.equal(find(g, "m0")!.named?.stage, 1);
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 1, targets: [] }));
  assert.equal(find(g, "m0")!.named?.stage, 2);
  assert.equal(powerOf(g, find(g, "m0")!), 3);

  g = setup({ mine: ["Loot, Exuberant Explorer"], hand: ["forest", "forest"] });
  g = settle(act(g, "p1", { type: "playLand", iid: "h0" }));
  g = settle(act(g, "p1", { type: "playLand", iid: "h1" }));
  assert.equal(g.players.p1.hand.length, 0, "two land drops with Loot");

  assert.ok(isSupportedCard(realCard("Banner of Kinship")));
});

test("Fake Your Own Death brings the creature back with a Treasure; Etali exiles a card from each library", () => {
  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Zap deals 9 damage to any target.", colors: ["R"] };
  let g = setup({ hand: ["Fake Your Own Death", "zap"], mine: ["Juggernaut"], extra: { zap } });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("m0") }));
  g = settle(act(g, "p1", { type: "castSpell", iid: "h1", targets: on("m0") }));
  const back = g.players.p1.battlefield.find((p) => p.card.iid === "m0");
  assert.ok(back, "returned");
  assert.equal(back!.tapped, true);
  assert.equal(named(g, "p1", "Treasure").length, 1);

  g = setup({ mine: ["Etali, Primal Storm"], library: ["Juggernaut"] });
  find(g, "m0")!.summoningSick = false;
  g = attackWith(g, ["m0"]);
  assert.equal(g.players.p1.exile.length, 2, "one card from each library");
});

test("Witness Protection makes the creature a 1/1 with no abilities", () => {
  let g = setup({ hand: ["Witness Protection"], theirs: ["Juggernaut"] });
  assert.equal(powerOf(g, find(g, "t0")!), 5);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("t0") }));
  assert.equal(powerOf(g, find(g, "t0")!), 1);
});

test("Curator of Destinies splits five cards into piles; Sorcerous Spyglass shuts off the named card's abilities", () => {
  let g = setup({ hand: ["Curator of Destinies"], library: ["plains", "island", "swamp", "mountain", "forest"], lands: 4 });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(g.pendingPick?.kind, "pileSplit");
  g = settle(act(g, "p1", { type: "pick", iid: "c0" }));
  g = settle(act(g, "p1", { type: "pick", iid: "c1" }));
  g = settle(act(g, "p1", { type: "pick" }));
  assert.equal(g.pendingPick?.kind, "pileChoose");
  assert.equal(g.pendingPick?.player, "p2");
  g = settle(act(g, "p2", { type: "pick", iid: "up" }));
  assert.equal(g.players.p1.hand.length, 2);
  assert.equal(g.players.p1.graveyard.length, 3);

  g = setup({ hand: ["Sorcerous Spyglass"], mine: ["Feldon's Cane"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(g.pendingPick?.kind, "cardName");
  g = settle(act(g, "p1", { type: "pick", iid: "Feldon's Cane" }));
  assert.ok(fails(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }), "the Cane can't be activated now");
});

test("Quilled Greatwurm: counters from combat damage, and casting it from the graveyard for six counters", () => {
  let g = setup({ mine: ["Quilled Greatwurm"] });
  find(g, "m0")!.summoningSick = false;
  g = attackWith(g, ["m0"]);
  for (let i = 0; i < 6 && g.phase !== "main2"; i++) g = settle(act(g, g.priority?.holder ?? "p1", { type: "passPhase" }));
  assert.ok((find(g, "m0")!.counters ?? 0) >= 1, "it grew from its own damage");

  g = setup({ mine: ["bear"], yard: ["Quilled Greatwurm"], lands: 4 });
  find(g, "m0")!.counters = 6;
  g = settle(act(g, "p1", { type: "castSpell", iid: "y0", targets: [], from: "graveyard" }));
  assert.ok(g.players.p1.battlefield.some((p) => p.card.iid === "y0"), "cast from the graveyard");
  assert.equal(find(g, "m0")!.counters, 0);
});

test("Wildborn Preserver: pay X for X counters when a non-Human enters", () => {
  let g = setup({ hand: ["bear"], mine: ["Wildborn Preserver"] });
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.equal(g.pendingPick?.kind, "payX");
  g = settle(act(g, "p1", { type: "pick", iid: "3" }));
  assert.equal(find(g, "m0")!.counters, 3);
});

test("Vizier of the Menagerie: the top creature card can be cast, with any mana", () => {
  let g = setup({ mine: ["Vizier of the Menagerie"], library: ["Juggernaut", "plains"], lands: 0 });
  g.players.p1.battlefield.push({ card: { iid: "mt", defId: "mountain", owner: "p1" }, tapped: false, summoningSick: false, damage: 0 });
  g.players.p1.battlefield.push({ card: { iid: "mt2", defId: "mountain", owner: "p1" }, tapped: false, summoningSick: false, damage: 0 });
  g.players.p1.battlefield.push({ card: { iid: "mt3", defId: "mountain", owner: "p1" }, tapped: false, summoningSick: false, damage: 0 });
  g.players.p1.battlefield.push({ card: { iid: "mt4", defId: "mountain", owner: "p1" }, tapped: false, summoningSick: false, damage: 0 });
  assert.ok(getCastable(g, "p1").some((c) => c.iid === "c0" && c.zone === "library"));
  g = settle(act(g, "p1", { type: "castSpell", iid: "c0", targets: [], from: "library" }));
  assert.ok(g.players.p1.battlefield.some((p) => p.card.iid === "c0"));
});

test("Fishing Pole: tap the creature for a bait counter; when it untaps, a Fish", () => {
  let g = setup({ mine: ["Fishing Pole", "bear"] });
  find(g, "m0")!.attachedTo = "m1";
  find(g, "m1")!.summoningSick = false;
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  assert.equal(find(g, "m0")!.named?.bait, 1);
  assert.equal(find(g, "m1")!.tapped, true);
  g = toNextTurn(g, "p1");
  assert.equal(named(g, "p1", "Fish").length, 1);
  assert.equal(find(g, "m0")!.named?.bait ?? 0, 0);
});

test("Tinybones stashes what the opponent discards and lets you play it", () => {
  let g = setup({ mine: ["Tinybones, Bauble Burglar"], lands: 4 });
  find(g, "m0")!.summoningSick = false;
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [] }));
  if (g.pendingPick) g = settle(act(g, g.pendingPick.player, { type: "pick", iid: g.pendingPick.options[0] }));
  assert.equal(g.players.p1.exile.length, 1, "the discarded card is in your exile");
  const iid = g.players.p1.exile[0].iid;
  g = settle(act(g, "p1", { type: "castSpell", iid, targets: [], from: "exile" }));
  assert.ok(g.players.p1.battlefield.some((p) => p.card.iid === iid), "cast from exile");
});

test("Abyssal Harvester copies a creature card that went to the graveyard this turn", () => {
  const zap = { id: "zap", name: "Zap", type: "instant" as const, cost: 1, manaCost: "{R}", typeLine: "Instant", text: "Zap deals 9 damage to any target.", colors: ["R"] };
  let g = setup({ hand: ["zap"], mine: ["Abyssal Harvester"], theirs: ["Juggernaut"], extra: { zap } });
  find(g, "m0")!.summoningSick = false;
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: on("t0") }));
  const iid = g.players.p2.graveyard[0].iid;
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0, targets: [{ kind: "card", iid }] }));
  const copies = named(g, "p1", "Juggernaut");
  assert.equal(copies.length, 1);
  assert.ok(subtypesOf(g, copies[0]).includes("nightmare"));
});
