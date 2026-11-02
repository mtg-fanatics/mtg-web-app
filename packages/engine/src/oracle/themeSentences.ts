import type { Effect } from "../effects.js";
import { refFor, targetSpec } from "./targets.js";
import type { Ctx } from "./targets.js";
import { toNumber } from "./words.js";

// Sentences of the older theme decks.

type SentenceParser = (s: string, ctx: Ctx) => Effect[] | null;

/** "Prevent the next 4 damage that would be dealt to any target this turn." */
const preventNext: SentenceParser = (s, ctx) => {
  const m = /^prevent the next (\d+|one|two|three|four|five) damage that would be dealt to (any target|target creature|target player|target creature or player) this turn$/.exec(s);
  const amount = m ? toNumber(m[1]) : null;
  const to = m ? refFor(m[2], ctx) : null;
  return amount && to ? [{ type: "prevent", amount, to }] : null;
};

/** Aven Fisher: "You may draw a card." (when it dies) */
const mayDraw: SentenceParser = (s) =>
  s === "you may draw a card" ? [{ type: "mayPay", cost: "", prompt: "Draw a card?", then: [{ type: "draw", amount: 1, who: { t: "you" } }] }] : null;

/** Beacon of Destruction: "Shuffle ~ into its owner's library." */
const shuffleSpell: SentenceParser = (s) => (s === "shuffle ~ into its owner's library" ? [{ type: "shuffleSpell" }] : null);

/** False Peace: "Target player skips all combat phases of their next turn." */
const skipCombat: SentenceParser = (s, ctx) => {
  const m = /^(target player|target opponent) skips all combat phases of their next turn$/.exec(s);
  const who = m ? refFor(m[1], ctx) : null;
  return who ? [{ type: "skipCombat", who }] : null;
};

/** Enrage: "Target creature gets +X/+0 until end of turn." */
const pumpByX: SentenceParser = (s, ctx) => {
  const m = /^(target creature) gets \+x\/([+-]\d+) until end of turn$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return m && what ? [{ type: "pump", power: 1, toughness: Number(m[2]), what, per: { kind: "x" } }] : null;
};

/** Hurricane: "~ deals X damage to each creature with flying and each player." */
const flyersAndPlayers: SentenceParser = (s) => {
  const m = /^~ deals (\d+|x) damage to each creature with flying and each player$/.exec(s);
  if (!m) return null;
  const amount = m[1] === "x" ? ("X" as const) : Number(m[1]);
  return [{ type: "damage", amount, to: { t: "allCreatures", scope: "all", flying: true } }, { type: "damage", amount, to: { t: "eachPlayer" } }];
};

/** Angel of Fury: "You may shuffle it into its owner's library." (when it dies) */
const mayShuffleIt: SentenceParser = (s) =>
  s === "you may shuffle it into its owner's library" ? [{ type: "mayPay", cost: "", prompt: "Shuffle it into your library?", then: [{ type: "shuffleSelfFromYard" }] }] : null;

/** Counterbore: "Counter target spell. Search its controller's graveyard, hand, and library for all cards with the same name as that spell and exile them. Then that player shuffles." */
const counterbore: SentenceParser = (s, ctx) => {
  if (s !== "@@counterbore@@") return null;
  const what = refFor("target spell", ctx);
  return what ? [{ type: "counter", what, exileCopies: true }] : null;
};

/** Jagged Lightning: "~ deals 3 damage to each of two target creatures." (two different targets, both required) */
const eachOfTwo: SentenceParser = (s, ctx) => {
  const m = /^~ deals (\d+) damage to each of two target creatures$/.exec(s);
  const spec = m ? targetSpec("target creature") : null;
  if (!m || !spec || ctx.targets.length > 0) return null;
  ctx.targets.push({ ...spec, distinct: true, label: "first target creature" }, { ...spec, distinct: true, label: "second target creature" });
  return [0, 1].map((i): Effect => ({ type: "damage", amount: Number(m[1]), to: { t: "target", i } }));
};

/** Relentless Assault: "Untap all creatures that attacked this turn." / "After this main phase, there is an additional combat phase followed by an additional main phase." */
const untapAttackers: SentenceParser = (s, ctx) => {
  if (s !== "untap all creatures that attacked this turn") return null;
  const what = refFor("all creatures that attacked this turn", ctx);
  return what ? [{ type: "untap", what }] : null;
};
const extraCombatMain: SentenceParser = (s) => (s === "after this main phase, there is an additional combat phase followed by an additional main phase" ? [{ type: "extraCombatMain" }] : null);

/** Wildfire: "Each player sacrifices four lands of their choice." */
const sacrificeLands: SentenceParser = (s) => {
  const m = /^each player sacrifices (\w+) lands of their choice$/.exec(s);
  const n = m ? toNumber(m[1]) : null;
  return n ? [{ type: "sacrificeLands", who: { t: "you" }, n }, { type: "sacrificeLands", who: { t: "opp" }, n }] : null;
};

export const THEME_SENTENCES: SentenceParser[] = [sacrificeLands, eachOfTwo, untapAttackers, extraCombatMain, preventNext, mayDraw, shuffleSpell, skipCombat, pumpByX, flyersAndPlayers, mayShuffleIt, counterbore];
