import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, CARDS, createGame, getCastable, isSupportedCard, legalTargets, payMana, powerOf, toughnessOf, viewFor } from "../index.js";
import { kw as kwOf } from "../core.js";
import type { Action, CardDef, CardInstance, GameState, PlayerId } from "../index.js";

// The cards of the "Lifegain" theme deck (Secrets of Strixhaven) that needed new rules, with their real text.
const card = (id: string, name: string, type: CardDef["type"], manaCost: string, typeLine: string, text: string, keywords: string[] = [], extra: Partial<CardDef> = {}): CardDef => ({
  id, name, type, cost: (manaCost.match(/\{[^}]+\}/g) ?? []).reduce((n, s) => n + (/^\{\d+\}$/.test(s) ? Number(s.slice(1, -1)) : 1), 0), manaCost, typeLine, text, keywords, ...extra,
});
const creature = (id: string, power: number, toughness: number, typeLine = "Creature — Bear", text = "", keywords: string[] = [], manaCost = "{W}"): CardDef =>
  card(id, id, "creature", manaCost, typeLine, text, keywords, { power, toughness });

const DEFS: Record<string, CardDef> = {
  ...CARDS,
  plains: { id: "plains", name: "Plains", type: "land", cost: 0, typeLine: "Basic Land — Plains" },
  swamp: { id: "swamp", name: "Swamp", type: "land", cost: 0, typeLine: "Basic Land — Swamp" },
  bear: creature("bear", 2, 2),
  ogre: creature("ogre", 3, 3, "Creature — Ogre", "", [], "{2}{B}"),
  bat: creature("bat", 1, 1, "Creature — Bat", "Flying", ["flying"]),
  shroud: creature("shroud", 2, 2, "Creature — Elf", "Hexproof", ["hexproof"]),
  warded: creature("warded", 2, 2, "Creature — Elf", "Ward {2}", ["ward"]),
  leech: creature("leech", 2, 2, "Creature — Leech", "Lifelink", ["lifelink"]),
  shield: card("shield", "Shield", "artifact", "{1}", "Artifact", ""),
  bolt: card("bolt", "Bolt", "instant", "{R}", "Instant", "Bolt deals 3 damage to any target."),
  murder: card("murder", "Murder", "instant", "{B}", "Instant", "Destroy target creature."),
  balm: card("balm", "Balm", "instant", "{W}", "Instant", "You gain 2 life."),
  amalia: card("amalia", "Amalia Benavides Aguirre", "creature", "{W}{B}", "Legendary Creature — Vampire Scout", "Ward—Pay 3 life.\nWhenever you gain life, Amalia Benavides Aguirre explores. Then destroy all other creatures if its power is exactly 20. (To have this creature explore, reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on this creature, then put the card back or put it into your graveyard.)", ["explore", "ward"], { power: 2, toughness: 2 }),
  feast: card("feast", "Case of the Uneaten Feast", "enchantment", "{W}", "Enchantment — Case", "Whenever a creature enters the battlefield under your control, you gain 1 life.\nTo solve — You've gained 5 or more life this turn. (If unsolved, solve at the beginning of your end step.)\nSolved — Sacrifice this Case: Creature cards in your graveyard gain \"You may cast this card from your graveyard\" until end of turn.", ["solved"]),
  caveBat: card("caveBat", "Deep-Cavern Bat", "creature", "{1}{B}", "Creature — Bat", "Flying, lifelink\nWhen this creature enters, look at target opponent's hand. You may exile a nonland card from it until this creature leaves the battlefield.", ["flying", "lifelink"], { power: 1, toughness: 1 }),
  channeler: card("channeler", "Essence Channeler", "creature", "{1}{W}", "Creature — Bat Cleric", "As long as you've lost life this turn, this creature has flying and vigilance.\nWhenever you gain life, put a +1/+1 counter on this creature.\nWhen this creature dies, put its counters on target creature you control.", [], { power: 2, toughness: 1 }),
  panda: card("panda", "Fiendish Panda", "creature", "{2}{W}{B}", "Creature — Bear Demon", "Whenever you gain life, put a +1/+1 counter on this creature.\nWhen this creature dies, return another target non-Bear creature card with mana value less than or equal to this creature's power from your graveyard to the battlefield.", [], { power: 3, toughness: 2 }),
  fate: card("fate", "Foolish Fate", "instant", "{2}{B}", "Instant", "Destroy target creature.\nInfusion — If you gained life this turn, that creature's controller loses 3 life.", ["infusion"]),
  haliya: card("haliya", "Haliya, Guided by Light", "creature", "{2}{W}", "Legendary Creature — Human Soldier", "Whenever Haliya or another creature or artifact you control enters, you gain 1 life.\nAt the beginning of your end step, draw a card if you've gained 3 or more life this turn.\nWarp {W} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)", ["warp"], { power: 3, toughness: 3 }),
  village: card("village", "Mudflat Village", "land", "", "Land", "{T}: Add {C}.\n{T}: Add {B}. Spend this mana only to cast a creature spell.\n{1}{B}, {T}, Sacrifice this land: Return target Bat, Lizard, Rat, or Squirrel card from your graveyard to your hand."),
  nowhere: card("nowhere", "Nowhere to Run", "enchantment", "{1}{B}", "Enchantment", "Flash\nWhen this enchantment enters, target creature an opponent controls gets -3/-3 until end of turn.\nCreatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. Ward abilities of those creatures don't trigger.", ["flash"]),
  hex: card("hex", "Requiting Hex", "instant", "{B}", "Instant", "As an additional cost to cast this spell, you may blight 1. (You may put a -1/-1 counter on a creature you control.)\nDestroy target creature with mana value 2 or less. If this spell's additional cost was paid, you gain 2 life.", ["blight"]),
  cleric: card("cleric", "Starscape Cleric", "creature", "{1}{B}", "Creature — Bat Cleric", "Offspring {2}{B} (You may pay an additional {2}{B} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nFlying\nThis creature can't block.\nWhenever you gain life, each opponent loses 1 life.", ["flying", "offspring"], { power: 2, toughness: 1 }),
  batLord: creature("batLord", 1, 1, "Creature — Bat", "Whenever a Bat you control attacks, it gets +2/+0 until end of turn."),
  raiser: creature("raiser", 2, 2, "Creature — Human", "At the beginning of your end step, return target creature card with mana value less than or equal to this creature's power from your graveyard to the battlefield."),
  zoraline: card("zoraline", "Zoraline, Cosmos Caller", "creature", "{1}{W}{B}", "Legendary Creature — Bat Cleric", "Flying, vigilance\nWhenever a Bat you control attacks, you gain 1 life.\nWhenever Zoraline enters or attacks, you may pay {W}{B} and 2 life. When you do, return target nonland permanent card with mana value 3 or less from your graveyard to the battlefield with a finality counter on it.", ["flying", "vigilance"], { power: 3, toughness: 3 }),
};

const perm = (iid: string, defId: string, owner: PlayerId = "p1") => ({ card: { iid, defId, owner } as CardInstance, tapped: false, summoningSick: false, damage: 0 });

/** p1's first main phase with four Plains and four Swamps, the cards in hand, and creatures on each side. */
function setup(hand: string[], mine: string[] = [], theirs: string[] = []): GameState {
  const g = createGame({ p1: Array(40).fill("mountain"), p2: Array(40).fill("mountain") }, 1);
  g.cards = { ...DEFS };
  g.players.p1.hand = hand.map((d, i) => ({ iid: `h${i}`, defId: d, owner: "p1" }));
  g.players.p1.battlefield = [...["plains", "plains", "plains", "plains", "swamp", "swamp", "swamp", "swamp"].map((d, i) => perm(`l${i}`, d)), ...mine.map((d, i) => perm(`m${i}`, d))];
  g.players.p2.battlefield = [...Array.from({ length: 3 }, (_, i) => perm(`k${i}`, "mountain", "p2")), ...theirs.map((d, i) => perm(`t${i}`, d, "p2"))];
  g.players.p2.hand = [];
  g.phase = "main1";
  return g;
}
function act(s: GameState, p: PlayerId, a: Action): GameState {
  const r = applyAction(s, p, a);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}
const find = (g: GameState, iid: string) => [...g.players.p1.battlefield, ...g.players.p2.battlefield].find((p) => p.card.iid === iid);
const on = (iid: string) => ({ kind: "permanent" as const, iid });
const settle = (g: GameState) => {
  while (g.priority && !g.pendingChoice && !g.pendingPick) g = act(g, g.priority.holder, { type: "passPriority" });
  return g;
};
const cast = (g: GameState, iid: string, targets: { kind: "permanent" | "player" | "card"; iid?: string; id?: PlayerId }[] = [], extra: Partial<Extract<Action, { type: "castSpell" }>> = {}) =>
  settle(act(g, "p1", { type: "castSpell", iid, targets: targets as never, ...extra }));
const choose = (g: GameState, targets: unknown[]) => settle(act(g, g.pendingChoice!.player, { type: "chooseTargets", targets: targets as never }));
/** A trigger with a single legal target takes it by itself; with more, it waits for the choice. */
const chooseIfAsked = (g: GameState, targets: unknown[]) => (g.pendingChoice ? choose(g, targets) : g);
const pick = (g: GameState, iid?: string) => settle(act(g, g.pendingPick!.player, { type: "pick", ...(iid ? { iid } : {}) }));
/** From p1's main phase to the beginning of the end step, with its triggers resolved. */
const toEndStep = (g: GameState) => {
  g.phase = "main2";
  return settle(act(g, "p1", { type: "passPhase" }));
};
const gainLife = (g: GameState, n = 2) => {
  for (let i = 0; i < n / 2; i++) {
    g.players.p1.hand.push({ iid: `balm${g.nextId}-${i}`, defId: "balm", owner: "p1" });
    g = cast(g, `balm${g.nextId}-${i}`);
    while (g.pendingChoice) g = choose(g, g.pendingChoice.specs.map(() => ({ kind: "none" })));
  }
  return g;
};

test("every card of the Lifegain deck that needed new rules is understood", () => {
  for (const id of ["amalia", "feast", "caveBat", "channeler", "panda", "fate", "haliya", "village", "nowhere", "hex", "cleric", "zoraline"]) assert.equal(isSupportedCard(DEFS[id]), true, id);
});

test("combat lifelink is a life gain like any other: it counts this turn and triggers 'whenever you gain life'", () => {
  let g = setup([], ["leech", "channeler"]);
  g = settle(act(g, "p1", { type: "passPhase" }));
  g = settle(act(g, "p1", { type: "declareAttackers", attackers: ["m0"] }));
  if (g.phase === "blockers") g = settle(act(g, "p2", { type: "declareBlockers", blocks: [] }));
  assert.equal(g.players.p1.life, 22);
  assert.equal(g.players.p1.lifeGainedThisTurn, 2);
  assert.equal(find(g, "m1")!.counters, 1); // Essence Channeler
});

test("Amalia: ward—pay 3 life, and exploring whenever you gain life", () => {
  // the opponent pays 3 life to target it, or the spell is countered
  let g = setup([], ["amalia"]);
  g.active = "p2";
  g.players.p2.hand = [{ iid: "x0", defId: "bolt", owner: "p2" }];
  g = settle(act(g, "p2", { type: "castSpell", iid: "x0", targets: [on("m0")] }));
  assert.equal(g.pendingPick?.kind, "ward");
  assert.equal(g.pendingPick?.payLife, 3);
  g = pick(g, "pay");
  assert.equal(g.players.p2.life, 17);
  assert.equal(find(g, "m0"), undefined); // paid, so the Bolt resolved

  // a land on top goes to the hand; a nonland card gives a counter and may be put into the graveyard
  g = setup([], ["amalia"]);
  g.players.p1.library[0] = { ...g.players.p1.library[0], defId: "plains" };
  const land = g.players.p1.library[0].iid;
  g = gainLife(g);
  assert.ok(g.players.p1.hand.some((c) => c.iid === land));
  assert.equal(find(g, "m0")!.counters ?? 0, 0);
  g.players.p1.library[0] = { ...g.players.p1.library[0], defId: "ogre" };
  const ogre = g.players.p1.library[0].iid;
  g = gainLife(g);
  assert.equal(find(g, "m0")!.counters, 1);
  assert.equal(g.pendingPick?.kind, "surveil");
  g = pick(g, ogre);
  assert.ok(g.players.p1.graveyard.some((c) => c.iid === ogre));
});

test("Amalia: at exactly 20 power, every other creature is destroyed", () => {
  let g = setup([], ["amalia", "bear"], ["ogre"]);
  find(g, "m0")!.counters = 17; // 19/19: one more counter makes 20
  g.players.p1.library[0] = { ...g.players.p1.library[0], defId: "ogre" };
  g = gainLife(g);
  g = pick(g); // keep the card on top
  assert.equal(powerOf(g, find(g, "m0")!), 20);
  assert.equal(find(g, "m1"), undefined);
  assert.equal(find(g, "t0"), undefined);
  assert.ok(find(g, "m0"));
});

test("Case of the Uneaten Feast: life for each creature, solved at the end step after 5 life, then creatures can be cast from the graveyard", () => {
  let g = setup(["bear"], ["feast"]);
  g = cast(g, "h0");
  assert.equal(g.players.p1.life, 21);
  // only 1 life this turn: not solved
  g = toEndStep(g);
  assert.notEqual(find(g, "m0")!.solved, true);
  g = setup([], ["feast"]);
  g = gainLife(g, 6);
  assert.equal(getCastable(g, "p1").length >= 0, true);
  g = toEndStep(g);
  assert.equal(find(g, "m0")!.solved, true);
  // solved: sacrifice it, then cast the Ogre from the graveyard (only cards that were there when it was sacrificed)
  g.phase = "main1";
  g.players.p1.graveyard = [{ iid: "y0", defId: "ogre", owner: "p1" }];
  g = settle(act(g, "p1", { type: "activateAbility", iid: "m0", index: 0 }));
  assert.equal(find(g, "m0"), undefined);
  g.players.p1.graveyard.push({ iid: "y1", defId: "bear", owner: "p1" });
  const fromYard = getCastable(g, "p1").filter((c) => c.zone === "graveyard").map((c) => c.iid);
  assert.deepEqual(fromYard, ["y0"]);
  g = cast(g, "y0", [], { from: "graveyard" });
  assert.ok(g.players.p1.battlefield.some((p) => p.card.iid === "y0"));
});

test("Deep-Cavern Bat: looks at the opponent's hand and exiles a nonland card until it leaves", () => {
  let g = setup(["caveBat", "murder"]);
  g.players.p2.hand = [{ iid: "x0", defId: "bolt", owner: "p2" }, { iid: "x1", defId: "mountain", owner: "p2" }];
  g = cast(g, "h0");
  g = chooseIfAsked(g, [{ kind: "player", id: "p2" }]);
  assert.equal(g.pendingPick?.kind, "handExile");
  assert.deepEqual(g.pendingPick?.options, ["x0"]);
  assert.deepEqual(g.pendingPick?.seen, ["x1"]);
  // the chooser sees the whole hand, the land too
  const view = viewFor(g, "p1");
  assert.deepEqual(view.players.p2.hand.map((c) => c.defId), ["bolt", "mountain"]);
  g = pick(g, "x0");
  assert.deepEqual(g.players.p2.hand.map((c) => c.iid), ["x1"]);
  assert.ok(g.players.p2.exile.some((c) => c.iid === "x0"));
  // the Bat dies: the card goes back to its owner's hand
  const batIid = g.players.p1.battlefield.find((p) => p.card.defId === "caveBat")!.card.iid;
  g = cast(g, "h1", [on(batIid)]);
  assert.ok(g.players.p2.hand.some((c) => c.iid === "x0"));
});

test("Essence Channeler: flying and vigilance after losing life; when it dies its counters move", () => {
  let g = setup(["murder"], ["channeler", "bear"]);
  assert.equal(kwOf(g, find(g, "m0")!, "flying"), false);
  g.players.p1.lifeLostThisTurn = 1;
  assert.equal(kwOf(g, find(g, "m0")!, "flying"), true);
  assert.equal(kwOf(g, find(g, "m0")!, "vigilance"), true);
  g = gainLife(g, 4); // two counters
  assert.equal(find(g, "m0")!.counters, 2);
  g = cast(g, "h0", [on("m0")]);
  g = chooseIfAsked(g, [on("m1")]);
  assert.equal(find(g, "m1")!.counters, 2);
});

test("Fiendish Panda: returns a non-Bear creature card with mana value up to its power as it died", () => {
  let g = setup(["murder"], ["panda"]);
  g.players.p1.graveyard = [{ iid: "y0", defId: "ogre", owner: "p1" }, { iid: "y1", defId: "bear", owner: "p1" }, { iid: "y2", defId: "zoraline", owner: "p1" }, { iid: "y3", defId: "panda", owner: "p1" }];
  g = cast(g, "h0", [on("m0")]);
  // power 3: the 3-mana Ogre and Zoraline are fine; a Bear isn't (another Panda is a Bear too), nor is this Panda itself
  const legal = legalTargets(g, g.pendingChoice!.specs[0], "p1").map((t) => (t.kind === "card" ? t.iid : t.kind));
  assert.deepEqual(legal, ["y0", "y2"]);
  g = choose(g, [{ kind: "card", iid: "y0" }]);
  assert.ok(find(g, "y0"));
  // with power 2 the Ogre is too expensive
  g = setup(["murder"], ["panda"]);
  g.players.p1.graveyard = [{ iid: "y0", defId: "ogre", owner: "p1" }];
  find(g, "m0")!.minusCounters = 1;
  g = cast(g, "h0", [on("m0")]);
  assert.ok(!g.pendingChoice || legalTargets(g, g.pendingChoice.specs[0], "p1").every((t) => t.kind === "none"));
});

test("Foolish Fate: infusion makes the controller lose 3 life only if you gained life this turn", () => {
  let g = setup(["fate"], [], ["bear"]);
  g = cast(g, "h0", [on("t0")]);
  assert.equal(g.players.p2.life, 20);
  g = setup(["fate"], [], ["bear"]);
  g = gainLife(g);
  g = cast(g, "h0", [on("t0")]);
  assert.equal(find(g, "t0"), undefined);
  assert.equal(g.players.p2.life, 17);
});

test("Haliya: life for itself and each creature or artifact, a card at the end step after 3 life", () => {
  let g = setup(["haliya", "shield", "bear"]);
  g = cast(g, "h0");
  assert.equal(g.players.p1.life, 21); // Haliya itself
  g = cast(g, "h1");
  g = cast(g, "h2");
  assert.equal(g.players.p1.life, 23);
  const hand = g.players.p1.hand.length;
  g = toEndStep(g);
  assert.equal(g.players.p1.hand.length, hand + 1);
  // only 1 life gained: no card
  g = setup(["haliya"]);
  g = cast(g, "h0");
  const before = g.players.p1.hand.length;
  g = toEndStep(g);
  assert.equal(g.players.p1.hand.length, before);
});

test("Haliya: warp for {W}, exiled at the end step, castable from exile only on a later turn", () => {
  let g = setup(["haliya"]);
  g.players.p1.battlefield = g.players.p1.battlefield.filter((p) => p.card.iid !== "l1" && p.card.iid !== "l2" && p.card.iid !== "l3");
  g.players.p1.battlefield.forEach((p) => p.card.defId === "swamp" && (p.tapped = true)); // a single Plains untapped
  const castable = getCastable(g, "p1").find((c) => c.iid === "h0")!;
  assert.equal(castable.warp, "{W}");
  assert.equal(castable.warpOnly, true);
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [] }).ok, false);
  g = cast(g, "h0", [], { warp: true });
  assert.equal(find(g, "h0")!.warped, true);
  g = toEndStep(g);
  assert.equal(find(g, "h0"), undefined);
  assert.ok(g.players.p1.exile.some((c) => c.iid === "h0"));
  assert.ok(!getCastable(g, "p1").some((c) => c.iid === "h0")); // not this turn
  g.turn += 2;
  g.phase = "main1";
  g.players.p1.battlefield.forEach((p) => (p.tapped = false));
  const later = getCastable(g, "p1").find((c) => c.iid === "h0");
  assert.equal(later?.zone, "exile");
  assert.equal(later?.warp, undefined); // warp only works from the hand
  g = cast(g, "h0", [], { from: "exile" });
  assert.ok(find(g, "h0"));
  assert.equal(find(g, "h0")!.warped, undefined);
});

test("Mudflat Village: its {B} only pays for creature spells; it returns a Bat card", () => {
  const g = setup([], ["village"]);
  g.players.p1.battlefield = g.players.p1.battlefield.filter((p) => !p.card.defId.match(/plains|swamp/));
  assert.equal(payMana(g, "p1", { generic: 0, colored: { B: 1 } }, DEFS.murder).ok, false);
  assert.equal(payMana(g, "p1", { generic: 0, colored: { B: 1 } }, DEFS.bat).ok, true);
  assert.equal(payMana(g, "p1", { generic: 1, colored: {} }, DEFS.murder).ok, true); // {C}
  let h = setup([], ["village"]);
  h.players.p1.graveyard = [{ iid: "y0", defId: "bat", owner: "p1" }, { iid: "y1", defId: "bear", owner: "p1" }];
  const villageAbility = 0;
  h = settle(act(h, "p1", { type: "activateAbility", iid: "m0", index: villageAbility, targets: [{ kind: "card", iid: "y0" }] }));
  assert.ok(h.players.p1.hand.some((c) => c.iid === "y0"));
  assert.equal(applyAction(setupWithYard(), "p1", { type: "activateAbility", iid: "m0", index: villageAbility, targets: [{ kind: "card", iid: "y1" }] }).ok, false);
  function setupWithYard() {
    const s = setup([], ["village"]);
    s.players.p1.graveyard = [{ iid: "y1", defId: "bear", owner: "p1" }];
    return s;
  }
});

test("Nowhere to Run: -3/-3 on entering; the opponent's hexproof and ward don't stop your spells", () => {
  let g = setup(["nowhere", "murder", "murder"], [], ["shroud", "warded", "ogre"]);
  g = cast(g, "h0");
  g = choose(g, [on("t2")]);
  assert.equal(find(g, "t2"), undefined); // the 3/3 Ogre
  g = cast(g, "h1", [on("t0")]);
  assert.equal(find(g, "t0"), undefined);
  g = cast(g, "h2", [on("t1")]);
  assert.equal(g.pendingPick, null); // no ward payment asked
  assert.equal(find(g, "t1"), undefined);
});

test("Requiting Hex: you may blight 1 to gain 2 life; mana value 2 or less only", () => {
  let g = setup(["hex", "hex"], ["bear"], ["leech", "ogre"]);
  const castable = getCastable(g, "p1").find((c) => c.iid === "h0")!;
  assert.deepEqual(castable.blight, { n: 1, options: ["m0"] });
  assert.equal(legalTargets(g, castable.specs[0], "p1").some((t) => t.kind === "permanent" && t.iid === "t1"), false); // the 3-mana Ogre
  g = cast(g, "h0", [on("t0")], { kicked: true, sacrifice: "m0" });
  assert.equal(find(g, "t0"), undefined);
  assert.equal(find(g, "m0")!.minusCounters, 1);
  assert.equal(g.players.p1.life, 22);
  // not blighted: no life
  g = setup(["hex"], ["bear"], ["leech"]);
  g = cast(g, "h0", [on("t0")]);
  assert.equal(g.players.p1.life, 20);
});

test("Starscape Cleric: offspring makes a 1/1 token copy; can't block; each life gain drains", () => {
  let g = setup(["cleric"]);
  const castable = getCastable(g, "p1").find((c) => c.iid === "h0")!;
  assert.equal(castable.kicker, "{2}{B}");
  assert.equal(castable.kickerName, "offspring");
  g = cast(g, "h0", [], { kicked: true });
  const clerics = g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].name === "Starscape Cleric");
  assert.equal(clerics.length, 2);
  const token = clerics.find((p) => p.card.iid !== "h0")!;
  assert.equal(powerOf(g, token), 1);
  assert.equal(toughnessOf(g, token), 1);
  assert.equal(kwOf(g, token, "flying"), true);
  g = gainLife(g);
  assert.equal(g.players.p2.life, 18); // both trigger
  // without offspring, no copy
  g = setup(["cleric"]);
  g = cast(g, "h0");
  assert.equal(g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].name === "Starscape Cleric").length, 1);
});

test("Zoraline: each attacking Bat gains 1 life; paying {W}{B} and 2 life returns a cheap permanent card with a finality counter", () => {
  let g = setup(["zoraline", "murder"], ["bat"]);
  g.players.p1.graveyard = [{ iid: "y0", defId: "ogre", owner: "p1" }, { iid: "y1", defId: "plains", owner: "p1" }];
  g = cast(g, "h0");
  assert.equal(g.pendingPick?.kind, "mayPay");
  g = settle(act(g, "p1", { type: "pick", iid: "pay" }));
  assert.equal(g.players.p1.life, 18);
  const legal = legalTargets(g, g.pendingChoice!.specs[0], "p1").map((t) => (t.kind === "card" ? t.iid : t.kind));
  assert.deepEqual(legal.filter((x) => x !== "none"), ["y0"]); // not the land
  g = choose(g, [{ kind: "card", iid: "y0" }]);
  assert.equal(find(g, "y0")!.finality, true);
  // with a finality counter it is exiled instead of dying
  g = cast(g, "h1", [on("y0")]);
  assert.ok(g.players.p1.exile.some((c) => c.iid === "y0"));
  assert.ok(!g.players.p1.graveyard.some((c) => c.iid === "y0"));
  // two Bats attack: 2 life
  const zoraline = g.players.p1.battlefield.find((p) => p.card.defId === "zoraline")!;
  zoraline.summoningSick = false;
  const life = g.players.p1.life;
  g = settle(act(g, "p1", { type: "passPhase" }));
  g = act(g, "p1", { type: "declareAttackers", attackers: ["m0", zoraline.card.iid] });
  while (g.pendingPick) g = pick(g); // don't pay for Zoraline's attack trigger
  g = settle(g);
  assert.equal(g.players.p1.life, life + 2);
});

test("'Whenever a Bat you control attacks, it ...': it is the Bat that attacks", () => {
  let g = setup([], ["batLord", "bat"]);
  g = settle(act(g, "p1", { type: "passPhase" }));
  g = settle(act(g, "p1", { type: "declareAttackers", attackers: ["m1"] }));
  if (g.phase === "blockers") g = settle(act(g, "p2", { type: "declareBlockers", blocks: [] }));
  assert.equal(g.players.p2.life, 17); // the 1/1 Bat hit for 3
});

test("'Mana value less than or equal to this creature's power' uses its power when it triggers", () => {
  let g = setup([], ["raiser"]);
  g.players.p1.graveyard = [{ iid: "y0", defId: "ogre", owner: "p1" }, { iid: "y1", defId: "bear", owner: "p1" }];
  g = toEndStep(g);
  // power 2: the 3-mana Ogre can't be chosen, so the Bear is returned
  assert.ok(find(g, "y1"));
  assert.equal(find(g, "y0"), undefined);
});
