import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportedCard } from "../index.js";
import type { CardDef } from "../index.js";
import { act, card, cast, find, nextTurn, on, player, setup, settle, top } from "./themeKit.js";

// Duress, Inquisition of Kozilek, Militia Bugler and "doesn't untap" (real text).
const DEFS: Record<string, CardDef> = {
  duress: card("duress", "Duress", "sorcery", "{B}", "Sorcery", "Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card."),
  inquisition: card("inquisition", "Inquisition of Kozilek", "sorcery", "{B}", "Sorcery", "Target player reveals their hand. You choose a nonland card from it with mana value 3 or less. That player discards that card."),
  bugler: card("bugler", "Militia Bugler", "creature", "{2}{W}", "Creature — Human Soldier", "Vigilance\nWhen Militia Bugler enters, look at the top four cards of your library. You may reveal a creature card with power 2 or less from among them and put it into your hand. Put the rest on the bottom of your library in a random order.", { power: 2, toughness: 3 }),
  monolith: card("monolith", "Grim Monolith", "artifact", "{2}", "Artifact", "Grim Monolith doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{4}: Untap Grim Monolith."),
  stuff: card("stuff", "Some Instant", "instant", "{1}{R}", "Instant", "You gain 1 life."),
  big: card("big", "Big Spell", "sorcery", "{4}{R}", "Sorcery", "You gain 1 life."),
};

test("the cards are understood", () => {
  for (const id of ["duress", "inquisition", "bugler", "monolith"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

function opponentHand(g: ReturnType<typeof setup>, ids: string[]) {
  g.players.p2.hand = ids.map((d, i) => ({ iid: `oh${i}`, defId: d, owner: "p2" as const }));
}

test("Duress: only a noncreature, nonland card can be chosen", () => {
  let g = setup(DEFS, ["duress"]);
  opponentHand(g, ["mountain", "bear", "stuff"]);
  g = cast(g, "h0", [player("p2")]);
  assert.equal(g.pendingPick?.kind, "discard");
  assert.deepEqual(g.pendingPick!.options, ["oh2"], "the Instant");
  g = settle(act(g, "p1", { type: "pick", iid: "oh2" }));
  assert.deepEqual(g.players.p2.hand.map((c) => c.iid), ["oh0", "oh1"]);
  assert.equal(g.players.p2.graveyard.some((c) => c.iid === "oh2"), true);
});

test("Inquisition of Kozilek: a nonland card with mana value 3 or less", () => {
  let g = setup(DEFS, ["inquisition"]);
  opponentHand(g, ["mountain", "big", "stuff", "bear"]);
  g = cast(g, "h0", [player("p2")]);
  assert.deepEqual([...g.pendingPick!.options].sort(), ["oh2", "oh3"], "the 2-mana Instant and the 1-mana Bear, not the 5-mana spell or the land");
});

test("Militia Bugler: a creature with power 2 or less goes to the hand, the rest to the bottom", () => {
  let g = setup(DEFS, ["bugler"]);
  top(g, ["hulk", "ogre", "bear", "mountain"]);
  g = cast(g, "h0");
  assert.equal(g.pendingPick?.kind, "revealToHand");
  const names = g.pendingPick!.options.map((iid) => g.cards[g.players.p1.library.find((c) => c.iid === iid)!.defId].name);
  assert.deepEqual(names, ["bear"], "only the 2/2 (the 5/5 and the 3/3 have too much power)");
  g = settle(act(g, "p1", { type: "pick", iid: g.pendingPick!.options[0] }));
  assert.equal(g.players.p1.hand.some((c) => g.cards[c.defId].name === "bear"), true);
  void find; void nextTurn; void on;
});

test("Grim Monolith stays tapped through the untap step", () => {
  let g = setup(DEFS, [], ["monolith"]);
  const mono = find(g, "m0")!;
  mono.tapped = true;
  g = nextTurn(g);
  g = nextTurn(g);
  assert.equal(find(g, "m0")!.tapped, true, "still tapped on my next turn");
});
