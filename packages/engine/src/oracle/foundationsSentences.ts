import type { Amount, Effect } from "../effects.js";
import { toAmount } from "./words.js";
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

export const FDN_SENTENCES: SentenceParser[] = [namedCounters, discardHands, giftControl, lifeLossPerCounters];
