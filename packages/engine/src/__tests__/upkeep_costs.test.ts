import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportedCard } from "../index.js";
import type { CardDef, GameState } from "../index.js";
import { act, card, cast, find, nextTurn, setup, settle } from "./themeKit.js";

// Echo, cumulative upkeep and "sacrifice ~ unless you pay" (real text).
const DEFS: Record<string, CardDef> = {
  troll: card("troll", "Albino Troll", "creature", "{1}{G}", "Creature — Troll", "Echo {1}{G}\n(At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)\n{1}{G}: Regenerate Albino Troll.", { power: 3, toughness: 3 }),
  zombie: card("zombie", "Cumulative Zombie", "creature", "{2}{B}", "Creature — Zombie", "Cumulative upkeep {1}", { power: 4, toughness: 4 }),
  pet: card("pet", "Hungry Pet", "creature", "{1}{R}", "Creature — Beast", "At the beginning of your upkeep, sacrifice Hungry Pet unless you pay {R}.", { power: 3, toughness: 1 }),
};

const toMyUpkeep = (g: GameState) => {
  g = nextTurn(g); // the opponent's turn
  g = nextTurn(g); // mine again
  return g;
};

test("the cards are understood", () => {
  for (const id of ["troll", "zombie", "pet"]) assert.equal(isSupportedCard({ ...DEFS[id] }), true, id);
});

test("echo: asked at the next upkeep, once; paying keeps it, and it is not asked again", () => {
  let g = setup(DEFS, ["troll"]);
  g = cast(g, "h0");
  const troll = () => g.players.p1.battlefield.find((p) => p.card.defId === "troll");
  assert.ok(troll(), "it entered");
  g = toMyUpkeep(g);
  assert.equal(g.pendingPick?.kind, "mayPay", "the echo question");
  assert.match(g.pendingPick!.prompt, /pay \{1\}\{G\}/);
  g = settle(act(g, "p1", { type: "pick", iid: "pay" }));
  assert.ok(troll(), "paid: it stays");
  g = toMyUpkeep(g);
  assert.equal(g.pendingPick, null, "the echo is only paid once");
  assert.ok(troll());
});

test("echo: not paying sacrifices it", () => {
  let g = setup(DEFS, ["troll"]);
  g = cast(g, "h0");
  g = toMyUpkeep(g);
  g = settle(act(g, "p1", { type: "pick" }));
  assert.equal(g.players.p1.battlefield.some((p) => p.card.defId === "troll"), false);
  assert.equal(g.players.p1.graveyard.some((c) => c.defId === "troll"), true);
});

test("echo: with no mana to pay it, it is sacrificed without asking", () => {
  let g = setup(DEFS, ["troll"]);
  g = cast(g, "h0");
  g.players.p1.battlefield = g.players.p1.battlefield.filter((p) => p.card.defId === "troll");
  g = toMyUpkeep(g);
  assert.equal(g.players.p1.battlefield.some((p) => p.card.defId === "troll"), false);
});

test("cumulative upkeep: an age counter every upkeep and the cost once for each", () => {
  let g = setup(DEFS, ["zombie"]);
  g = cast(g, "h0");
  g = toMyUpkeep(g);
  assert.match(g.pendingPick!.prompt, /pay \{1\},/);
  g = settle(act(g, "p1", { type: "pick", iid: "pay" }));
  assert.equal(find(g, g.players.p1.battlefield.find((p) => p.card.defId === "zombie")!.card.iid)!.age, 1);
  g = toMyUpkeep(g);
  assert.match(g.pendingPick!.prompt, /pay \{1\}\{1\},/, "two age counters: twice the cost");
  g = settle(act(g, "p1", { type: "pick" }));
  assert.equal(g.players.p1.battlefield.some((p) => p.card.defId === "zombie"), false, "declined: sacrificed");
});

test("sacrifice ~ unless you pay: asked every upkeep", () => {
  let g = setup(DEFS, ["pet"]);
  g = cast(g, "h0");
  for (let i = 0; i < 2; i++) {
    g = toMyUpkeep(g);
    assert.equal(g.pendingPick?.kind, "mayPay");
    g = settle(act(g, "p1", { type: "pick", iid: "pay" }));
    assert.ok(g.players.p1.battlefield.some((p) => p.card.defId === "pet"));
  }
});
