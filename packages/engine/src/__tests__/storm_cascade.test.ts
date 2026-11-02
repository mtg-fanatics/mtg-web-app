import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportedCard } from "../index.js";
import type { CardDef } from "../index.js";
import { act, card, cast, find, setup, settle, top } from "./themeKit.js";

// Storm and cascade (real text).
const DEFS: Record<string, CardDef> = {
  warrens: card("warrens", "Empty the Warrens", "sorcery", "{3}{R}", "Sorcery", "Create two 1/1 red Goblin creature tokens.\nStorm (When you cast this spell, copy it for each spell cast before it this turn.)"),
  weather: card("weather", "Weather the Storm", "instant", "{1}{G}", "Instant", "You gain 3 life.\nStorm (When you cast this spell, copy it for each spell cast before it this turn.)"),
  cheap: card("cheap", "Cheap Spell", "instant", "{R}", "Instant", "You gain 1 life."),
  denial: card("denial", "Cascader", "sorcery", "{3}{U}{U}", "Sorcery", "Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)\nYou gain 2 life."),
};

test("the cards are understood", () => {
  for (const id of ["warrens", "weather", "denial"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("storm: a copy for each spell cast before it this turn", () => {
  let g = setup(DEFS, ["cheap", "cheap", "weather"]);
  g = cast(g, "h0");
  g = cast(g, "h1");
  const before = g.players.p1.life; // 22
  g = cast(g, "h2");
  assert.equal(g.players.p1.life, before + 3 * 3, "the spell and two copies: three times 3 life");
});

test("storm with no spell before it is just the spell", () => {
  let g = setup(DEFS, ["weather"]);
  g = cast(g, "h0");
  assert.equal(g.players.p1.life, 23);
});

test("storm: tokens for every copy", () => {
  let g = setup(DEFS, ["cheap", "warrens"]);
  g = cast(g, "h0");
  g = cast(g, "h1");
  assert.equal(g.players.p1.battlefield.filter((p) => g.cards[p.card.defId].name === "Goblin").length, 4, "two copies' worth of two tokens each");
});

test("cascade: the cheaper spell may be cast for free, and the lands skipped go to the bottom", () => {
  let g = setup(DEFS, ["denial"]);
  top(g, ["mountain", "mountain", "ogre", "hulk"]);
  const libBefore = g.players.p1.library.length;
  g = cast(g, "h0");
  assert.equal(g.players.p1.life, 22, "the Cascader resolved");
  const ogre = g.players.p1.exile.find((c) => g.cards[c.defId].name === "ogre");
  assert.ok(ogre, "the 3-mana creature is in exile, ready to be cast");
  assert.equal(g.players.p1.library.length, libBefore - 1, "only the Ogre left the library for good: the two lands went to the bottom");
  // cast it from exile without paying
  const tapped = g.players.p1.battlefield.filter((p) => p.tapped).length;
  g = settle(act(g, "p1", { type: "castSpell", iid: ogre!.iid, targets: [], from: "exile" }));
  assert.ok(g.players.p1.battlefield.some((p) => p.card.iid === ogre!.iid), "it entered");
  assert.equal(g.players.p1.battlefield.filter((p) => p.tapped).length, tapped, "no mana was paid for it");
  void find;
});
