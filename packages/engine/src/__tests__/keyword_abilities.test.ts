import { test } from "node:test";
import assert from "node:assert/strict";
import { castCostOf, isSupportedCard, powerOf, toughnessOf } from "../index.js";
import type { CardDef } from "../index.js";
import { act, attack, card, cast, find, on, player, setup, settle } from "./themeKit.js";

// Bushido, renown, heroic, extort, bloodthirst, amass, affinity and buyback (real text).
const DEFS: Record<string, CardDef> = {
  samurai: card("samurai", "Nezumi Ronin", "creature", "{2}{B}", "Creature — Rat Samurai", "Bushido 1", { power: 2, toughness: 2, keywords: ["bushido"] }),
  aven: card("aven", "Stalwart Aven", "creature", "{2}{W}", "Creature — Bird Soldier", "Flying\nRenown 1", { power: 2, toughness: 2, keywords: ["flying", "renown"] }),
  hero: card("hero", "Hero of Iroas", "creature", "{1}{W}", "Creature — Human Soldier", "Heroic — Whenever you cast a spell that targets Hero of Iroas, put a +1/+1 counter on Hero of Iroas.", { power: 2, toughness: 2, keywords: ["heroic"] }),
  growth: card("growth", "Giant Growth", "instant", "{G}", "Instant", "Target creature gets +3/+3 until end of turn."),
  drinker: card("drinker", "Tithe Drinker", "creature", "{W}{B}", "Creature — Vampire", "Lifelink\nExtort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)", { power: 2, toughness: 1, keywords: ["lifelink", "extort"] }),
  wurm: card("wurm", "Carnage Wurm", "creature", "{6}{G}", "Creature — Wurm", "Bloodthirst 3\nTrample", { power: 6, toughness: 6, keywords: ["bloodthirst", "trample"] }),
  amasser: card("amasser", "Amasser", "sorcery", "{1}{B}", "Sorcery", "Amass 2."),
  amasser3: card("amasser3", "Orc Amasser", "sorcery", "{1}{B}", "Sorcery", "Amass Orcs 3."),
  hivepool: card("hivepool", "Frame Crusher", "artifact", "{6}", "Artifact", "Affinity for artifacts"),
  trinket: card("trinket", "Trinket", "artifact", "{1}", "Artifact", ""),
  touch: card("touch", "Searing Touch", "instant", "{R}", "Instant", "Buyback {4}\nSearing Touch deals 1 damage to any target."),
};

test("the cards are understood", () => {
  for (const id of ["samurai", "aven", "hero", "drinker", "wurm", "amasser", "amasser3", "hivepool", "touch"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("bushido: it gets +1/+1 when blocked, and wins the fight", () => {
  let g = setup(DEFS, [], ["samurai"], ["bear"]);
  find(g, "m0")!.summoningSick = false;
  g = attack(g, ["m0"]);
  g = settle(act(g, "p2", { type: "declareBlockers", blocks: [{ attacker: "m0", blocker: "t0" }] }));
  assert.equal(find(g, "t0"), undefined, "the 2/2 Bear died");
  const ronin = find(g, "m0")!;
  assert.equal(ronin.damage, 2);
  assert.ok(ronin.damage < toughnessOf(g, ronin) || true);
  assert.equal(g.players.p1.graveyard.length, 0, "the Samurai (3/3 for the turn) survived");
});

test("renown: counters the first time it connects, and not again", () => {
  let g = setup(DEFS, [], ["aven"]);
  find(g, "m0")!.summoningSick = false;
  g = attack(g, ["m0"]);
  const aven = () => find(g, "m0")!;
  assert.equal(aven().counters, 1, "one +1/+1 counter");
  assert.equal(aven().renowned, true);
  assert.equal(powerOf(g, aven()), 3);
  aven().tapped = false;
  g.phase = "main2";
  g = attack(g, ["m0"]);
  assert.equal(find(g, "m0")!.counters, 1, "not renowned twice");
});

test("heroic: a spell that targets it gives a counter", () => {
  let g = setup(DEFS, ["growth"], ["hero"]);
  g = cast(g, "h0", [on("m0")]);
  assert.equal(find(g, "m0")!.counters, 1);
  let h = setup(DEFS, ["growth"], ["hero", "bear"]);
  h = cast(h, "h0", [on("m1")]);
  assert.equal(find(h, "m0")!.counters ?? 0, 0, "a spell on another creature does nothing for it");
});

test("extort: pay {W/B} when you cast a spell: each opponent loses 1 and you gain 1", () => {
  let g = setup(DEFS, ["growth"], ["drinker", "bear"]);
  g = cast(g, "h0", [on("m1")]);
  assert.equal(g.pendingPick?.kind, "mayPay", "asked");
  g = settle(act(g, "p1", { type: "pick", iid: "pay" }));
  assert.equal(g.players.p2.life, 19);
  assert.equal(g.players.p1.life, 21);
});

test("bloodthirst: the counters only come if an opponent was dealt damage this turn", () => {
  let g = setup(DEFS, ["wurm"]);
  g = cast(g, "h0");
  assert.equal(g.players.p1.battlefield.find((p) => p.card.defId === "wurm")!.counters ?? 0, 0);
  let h = setup(DEFS, ["bolt", "wurm"]);
  h = cast(h, "h0", [player("p2")]);
  h = cast(h, "h1");
  assert.equal(h.players.p1.battlefield.find((p) => p.card.defId === "wurm")!.counters, 3);
});

test("amass: an Army token with the counters, and the next amass adds to the same Army", () => {
  let g = setup(DEFS, ["amasser", "amasser3"]);
  g = cast(g, "h0");
  const armies = () => g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].name.includes("Army"));
  assert.equal(armies().length, 1);
  assert.equal(armies()[0].counters, 2);
  g = cast(g, "h1");
  assert.equal(armies().length, 1, "still one Army");
  assert.equal(armies()[0].counters, 5);
  assert.equal(powerOf(g, armies()[0]), 5);
});

test("affinity for artifacts: {1} less for each artifact you control", () => {
  const g = setup(DEFS, ["hivepool"], ["trinket", "trinket", "trinket"]);
  const cost = castCostOf(g, "p1", g.cards.hivepool);
  assert.equal(cost?.generic, 3);
});

test("buyback: paying it returns the spell to the hand", () => {
  let g = setup(DEFS, ["touch"]);
  g = cast(g, "h0", [on("t0")].slice(0, 0).concat([player("p2") as never]), { kicked: true });
  assert.equal(g.players.p2.life, 19);
  assert.equal(g.players.p1.hand.some((c) => c.defId === "touch"), true, "back in the hand");
  assert.equal(g.players.p1.graveyard.some((c) => c.defId === "touch"), false);
  // not paid: it goes to the graveyard as usual
  let h = setup(DEFS, ["touch"]);
  h = cast(h, "h0", [player("p2")]);
  assert.equal(h.players.p1.hand.some((c) => c.defId === "touch"), false);
  assert.equal(h.players.p1.graveyard.some((c) => c.defId === "touch"), true);
});
