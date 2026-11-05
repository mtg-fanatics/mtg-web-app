import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, CARDS, createGame, getCastable, isSupportedCard, payMana } from "../index.js";
import type { Action, CardDef, CardInstance, GameState, PlayerId } from "../index.js";

const artifact = (id: string, cost: string, text: string, extra: Partial<CardDef> = {}): CardDef => ({ id, name: id, type: "artifact", cost: 1, manaCost: cost, typeLine: "Artifact", text, ...extra });

const DEFS: Record<string, CardDef> = {
  ...CARDS,
  solring: artifact("solring", "{1}", "{T}: Add {C}{C}."),
  signet: artifact("signet", "{2}", "{T}: Add one mana of any color."),
  rock: artifact("rock", "{2}", "{T}: Add {R}."),
  slowrock: artifact("slowrock", "{2}", "This artifact enters tapped.\n{T}: Add {G}."),
  sword: artifact("sword", "{3}", "Whenever equipped creature blocks a creature with flying, draw a card."),
  shatter: { id: "shatter", name: "Shatter", type: "instant", cost: 2, manaCost: "{R}", text: "Destroy target artifact." },
  golem: { ...artifact("golem", "{2}", "", { power: 2, toughness: 2 }), type: "creature", typeLine: "Artifact Creature — Golem" },
  expensive: { id: "expensive", name: "Expensive", type: "creature", cost: 3, manaCost: "{2}{R}", power: 3, toughness: 3 },
};

const perm = (iid: string, defId: string, owner: PlayerId = "p1") => ({ card: { iid, defId, owner } as CardInstance, tapped: false, summoningSick: false, damage: 0 });

function setup(lands: string[], hand: string[]): GameState {
  const g = createGame({ p1: Array(40).fill("mountain"), p2: Array(40).fill("mountain") }, 1);
  g.cards = { ...DEFS };
  g.players.p1.battlefield = lands.map((d, i) => perm(`l${i}`, d));
  g.players.p1.hand = hand.map((d, i) => ({ iid: `h${i}`, defId: d, owner: "p1" }));
  g.players.p2.hand = [];
  return g;
}
function act(s: GameState, p: PlayerId, a: Action): GameState {
  const r = applyAction(s, p, a);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

test("mana rocks are understood; equipment with an unread trigger is not (yet)", () => {
  for (const id of ["solring", "signet", "rock", "slowrock", "golem"]) assert.equal(isSupportedCard(DEFS[id]), true, id);
  assert.equal(isSupportedCard(DEFS.sword), false);
});

test("an artifact is cast in a main phase, enters the battlefield, and can pay for spells at once", () => {
  let g = setup(["mountain", "mountain"], ["rock", "expensive"]);
  g.phase = "main1";
  g = act(g, "p1", { type: "castSpell", iid: "h0", targets: [] });
  const rock = g.players.p1.battlefield.find((p) => p.card.iid === "h0")!;
  assert.ok(rock);
  assert.equal(rock.summoningSick, false); // not a creature: no summoning sickness
  // The two Mountains were tapped to pay for the rock. Untap them: Mountain + Mountain + the rock = the 3 mana of {2}{R}.
  assert.equal(getCastable(g, "p1").some((c) => c.iid === "h1"), false); // only the rock is untapped: 1 mana
  g.players.p1.battlefield.filter((p) => p.card.defId === "mountain").forEach((p) => (p.tapped = false));
  assert.equal(getCastable(g, "p1").some((c) => c.iid === "h1"), true);
});

test("Sol Ring: one tap pays for two generic mana", () => {
  const g = setup(["mountain"], []);
  g.players.p1.battlefield.push(perm("sol", "solring"));
  const r = payMana(g, "p1", { generic: 3, colored: {} });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual([...r.tap].sort(), ["l0", "sol"]);
  const only = payMana(g, "p1", { generic: 2, colored: {} });
  assert.equal(only.ok, true);
  if (only.ok) assert.equal(only.tap.length, 1); // the ring alone is enough
  assert.equal(payMana(g, "p1", { generic: 4, colored: {} }).ok, false);
});

test("an artifact that enters tapped can't make mana that turn", () => {
  let g = setup(["mountain", "mountain"], ["slowrock"]);
  g.phase = "main1";
  g = act(g, "p1", { type: "castSpell", iid: "h0", targets: [] });
  assert.equal(g.players.p1.battlefield.find((p) => p.card.iid === "h0")!.tapped, true);
});

test("destroy target artifact: artifacts and artifact creatures are legal, other creatures are not", () => {
  let g = setup(["mountain", "mountain"], ["shatter"]);
  g.players.p2.battlefield = [perm("a", "rock", "p2"), perm("g", "golem", "p2"), perm("e", "expensive", "p2")];
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "permanent", iid: "e" }] }).ok, false);
  g = act(g, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "permanent", iid: "a" }] });
  assert.equal(g.players.p2.battlefield.some((p) => p.card.iid === "a"), false);
  assert.equal(g.players.p2.graveyard.length, 1);
});
