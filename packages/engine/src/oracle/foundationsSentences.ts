import type { Amount, Effect } from "../effects.js";
import { isKeyword, toAmount } from "./words.js";
import type { Keyword } from "../keywords.js";
import { refFor } from "./targets.js";
import type { Ctx } from "./targets.js";

// Sentences of the cards of Foundations that no older deck had.

type SentenceParser = (s: string, ctx: Ctx) => Effect[] | null;

const WORD_N: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// the counters that other parts of the engine already know by name
const KNOWN_COUNTERS = /^(?:stun|loyalty|lore|poison|finality|plan|invasion|age|level|time|oil|shield|flying|first|double|deathtouch|lifelink|menace|trample|vigilance|haste|reach|indestructible|hexproof)$/;

const itself = (what: string, ctx: Ctx): boolean => what === "~" || (what === "it" && !!ctx.allowSelf && !ctx.itIsOther);

/** "Put a bait counter on ~." / "put that many incubation counters on it" / "remove three incubation counters from ~". */
const namedCounters: SentenceParser = (s, ctx) => {
  const put = /^put (a|an|one|two|three|four|five|that many) ([a-z]+) counters? on (~|it)$/.exec(s);
  if (put && !KNOWN_COUNTERS.test(put[2]) && itself(put[3], ctx)) {
    const amount: Amount = put[1] === "that many" ? { count: { kind: "x" } } : (WORD_N[put[1]] ?? 1);
    return [{ type: "namedCounters", name: put[2], amount, what: { t: "self" } }];
  }
  const take = /^remove (a|an|one|two|three|four|five) ([a-z]+) counters? from (~|it)$/.exec(s);
  if (take && !KNOWN_COUNTERS.test(take[2]) && itself(take[3], ctx)) return [{ type: "namedCounters", name: take[2], amount: WORD_N[take[1]] ?? 1, what: { t: "self" }, remove: true }];
  return null;
};

/** "Each opponent discards their hand." / "Each player discards their hand, then draws seven cards." */
const discardHands: SentenceParser = (s, ctx) => {
  const m = /^(each opponent|each player|target player|target opponent) discards their hand(?:, then draws? (a|one|two|three|four|five|six|seven|\d+) cards?)?$/.exec(s);
  const who = m ? refFor(m[1], ctx) : null;
  if (!m || !who) return null;
  const draw = m[2] ? toAmount(m[2]) : null;
  return [{ type: "discardHands", who, ...(typeof draw === "number" ? { thenDraw: draw } : {}) }];
};

/** "An opponent gains control of ~." (Wishclaw Talisman) */
const giftControl: SentenceParser = (s) => (s === "an opponent gains control of ~" ? [{ type: "giftControl", what: { t: "self" } }] : null);

/** "Each opponent loses life equal to the number of soul counters on ~." (read as: the counters it had as it was sacrificed, which is the X of the ability) */
const lifeLossPerCounters: SentenceParser = (s, ctx) => {
  const m = /^each opponent loses life equal to the number of ([a-z]+) counters on ~$/.exec(s);
  if (!m) return null;
  void ctx;
  return [{ type: "loseLife", amount: { count: { kind: "x" } }, who: { t: "opp" } }];
};

/** "Until end of turn, creatures you control get +1/+1 and gain haste." (Heroic Reinforcements) */
const teamPumpAndGain: SentenceParser = (s) => {
  const m = /^until end of turn, creatures you control get \+(\d+)\/\+(\d+) and gain ([a-z ]+)$/.exec(s);
  if (!m || !isKeyword(m[3])) return null;
  const what = { t: "allCreatures" as const, scope: "yours" as const };
  return [{ type: "pump", power: Number(m[1]), toughness: Number(m[2]), what }, { type: "grant", keyword: m[3] as Keyword, what }];
};

/** "Other creatures you control get +1/+1 until end of turn." (Syr Alin) */
const otherTeamPump: SentenceParser = (s) => {
  const m = /^other creatures you control get \+(\d+)\/\+(\d+) until end of turn$/.exec(s);
  return m ? [{ type: "pump", power: Number(m[1]), toughness: Number(m[2]), what: { t: "allCreatures", scope: "yours", notSelf: true } }] : null;
};

/** "Another target creature you control gains trample and gets +X/+X until end of turn, where X is ~'s power." (Ashroot Animist) */
const ashroot: SentenceParser = (s, ctx) => {
  if (s !== "another target creature you control gains trample and gets +x/+x until end of turn, where x is ~'s power") return null;
  ctx.targets.push({ kind: "creature", controller: "you", other: true, label: "another target creature you control" });
  const what = { t: "target" as const, i: ctx.targets.length - 1 };
  return [{ type: "grant", keyword: "trample", what }, { type: "pump", power: 1, toughness: 1, what, per: { kind: "selfPower" } }];
};

/** "Double target creature's power until end of turn." (Bulk Up) */
const doublePower: SentenceParser = (s, ctx) => {
  if (s !== "double target creature's power until end of turn") return null;
  ctx.targets.push({ kind: "creature", label: "target creature" });
  const i = ctx.targets.length - 1;
  return [{ type: "pump", power: 1, toughness: 0, what: { t: "target", i }, per: { kind: "targetPower", i } }];
};

/** "Return all attacking creatures to their owner's hand." (Aetherize) */
const bounceAttackers: SentenceParser = (s) => (s === "return all attacking creatures to their owner's hand" ? [{ type: "bounce", what: { t: "attackingCreatures" } }] : null);

/** "Return up to one other target permanent you control to its owner's hand." (Mischievous Pup) */
const bounceOwnOther: SentenceParser = (s, ctx) => {
  if (s !== "return up to one other target permanent you control to its owner's hand") return null;
  ctx.targets.push({ kind: "permanent", controller: "you", other: true, optional: true, label: "up to one other target permanent you control" });
  return [{ type: "bounce", what: { t: "target", i: ctx.targets.length - 1 } }];
};

/** "You may have it fight target creature you don't control." (Affectionate Indrik: "it" is the creature that entered) */
const mayFight: SentenceParser = (s, ctx) => {
  if (s !== "you may have it fight target creature you don't control" || !ctx.allowSelf) return null;
  ctx.targets.push({ kind: "creature", controller: "opponent", label: "target creature you don't control" });
  return [{ type: "fight", a: { t: "self" }, b: { t: "target", i: ctx.targets.length - 1 } }];
};

const discardUnlessAttacked: SentenceParser = (s) => (s === "then discard a card unless you attacked this turn" ? [{ type: "discardUnlessAttacked" }] : null);

/** "Return all creature cards with mana value 2 or less from your graveyard to the battlefield." (Raise the Past) */
const raiseThePast: SentenceParser = (s) => {
  const m = /^return all creature cards with mana value (\d+) or less from your graveyard to the battlefield$/.exec(s);
  return m ? [{ type: "reanimateAll", maxMV: Number(m[1]) }] : null;
};

/** "If target player has exactly 10 life, ~ deals 10 damage to that player." (Hidetsugu's Second Rite) */
const exactLifeBurn: SentenceParser = (s, ctx) => {
  const m = /^if target player has exactly (\d+) life, ~ deals (\d+) damage to that player$/.exec(s);
  if (!m) return null;
  const who = refFor("target player", ctx);
  return who ? [{ type: "damageIfLife", who, life: Number(m[1]), amount: Number(m[2]) }] : null;
};

/** "Draw a card for each different mana value among nonland permanents you control." (Lunar Insight) */
const drawPerMV: SentenceParser = (s) => (s === "draw a card for each different mana value among nonland permanents you control" ? [{ type: "draw", amount: { count: { kind: "distinctMV" } }, who: { t: "you" } }] : null);

/** "Target opponent loses X life, where X is the amount of life you gained this turn." (Midnight Snack) */
const lifeGainedDrain: SentenceParser = (s, ctx) => {
  if (s !== "target opponent loses x life, where x is the amount of life you gained this turn") return null;
  const who = refFor("target opponent", ctx);
  return who ? [{ type: "loseLife", amount: { count: { kind: "lifeGainedThisTurn" } }, who }] : null;
};

export const FDN_SENTENCES: SentenceParser[] = [namedCounters, discardHands, giftControl, lifeLossPerCounters, teamPumpAndGain, otherTeamPump, ashroot, doublePower, bounceAttackers, bounceOwnOther, mayFight, discardUnlessAttacked, raiseThePast, exactLifeBurn, drawPerMV, lifeGainedDrain];
