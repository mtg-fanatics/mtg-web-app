import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, getCastable, isSupportedCard } from "../index.js";
import type { CardDef } from "../index.js";
import { act, card, find, perm, settle, setup } from "./themeKit.js";

// Convoke (real text).
const DEFS: Record<string, CardDef> = {
  guardsman: card("guardsman", "Vault Guardsman", "creature", "{3}{W}", "Creature — Human Soldier", "Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\nVigilance", { power: 3, toughness: 3 }),
  whitebear: card("whitebear", "White Knight", "creature", "{W}", "Creature — Knight", "", { power: 2, toughness: 2, colors: ["W"] }),
  redbear: card("redbear", "Red Bear", "creature", "{R}", "Creature — Bear", "", { power: 2, toughness: 2, colors: ["R"] }),
};

/** Only one Forest on the battlefield (so the spell can't be paid for with mana alone), and the creatures. */
function board(creatures: string[]) {
  const g = setup(DEFS, ["guardsman"], creatures);
  g.players.p1.battlefield = [perm("l0", "forest"), ...g.players.p1.battlefield.filter((p) => p.card.iid.startsWith("m"))];
  for (const p of g.players.p1.battlefield) p.summoningSick = false;
  return g;
}

test("the card is understood", () => {
  assert.equal(isSupportedCard({ ...DEFS.guardsman }), true);
});

test("convoke: not castable with mana alone, castable with the creatures to tap", () => {
  const g = board(["whitebear", "redbear", "bear"]);
  const castable = getCastable(g, "p1").find((c) => c.iid === "h0");
  assert.ok(castable, "castable thanks to the creatures");
  assert.ok(castable!.convoke, "with a convoke choice");
  assert.equal(castable!.convoke!.min, 3, "{3}{W} with a Forest: three creatures (one pays {W}, two pay {1})");
  assert.equal(castable!.convoke!.options.length, 3);
});

test("convoke: the creatures chosen are tapped, and a white one pays {W}", () => {
  let g = board(["whitebear", "redbear", "bear"]);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [], convoke: ["m0", "m1", "m2"] }));
  assert.ok(g.players.p1.battlefield.some((p) => p.card.defId === "guardsman"), "it entered");
  for (const id of ["m0", "m1", "m2"]) assert.equal(find(g, id)!.tapped, true, id);
});

test("convoke: a red creature can't pay for {W}", () => {
  const g = board(["redbear", "redbear", "redbear"]);
  const r = applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [], convoke: ["m0", "m1", "m2"] });
  assert.equal(r.ok, false, "the {W} is not paid by red creatures, and a Forest makes no white mana");
});

test("convoke: not told which creatures, the engine taps as many as it takes", () => {
  let g = board(["whitebear", "bear", "bear", "bear"]);
  g = settle(act(g, "p1", { type: "castSpell", iid: "h0", targets: [] }));
  assert.ok(g.players.p1.battlefield.some((p) => p.card.defId === "guardsman"));
  assert.equal(g.players.p1.battlefield.filter((p) => p.card.iid.startsWith("m") && p.tapped).length, 3);
});

test("convoke: a tapped creature can't be used, and a card without convoke refuses", () => {
  const g = board(["whitebear", "bear", "bear"]);
  find(g, "m1")!.tapped = true;
  assert.equal(applyAction(g, "p1", { type: "castSpell", iid: "h0", targets: [], convoke: ["m0", "m1", "m2"] }).ok, false);
  const h = setup(DEFS, ["bolt"], ["bear"]);
  assert.equal(applyAction(h, "p1", { type: "castSpell", iid: "h0", targets: [{ kind: "player", id: "p2" }], convoke: ["m0"] }).ok, false);
});
