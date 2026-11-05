import type { CardFilter, Effect, TokenSpec } from "../effects.js";
import { CARD_TYPES, keywordList } from "./words.js";
import { isCreatureRef, refFor } from "./targets.js";
import type { Ctx } from "./targets.js";

// Sentences of the Jund Sacrifice deck and its sideboard: revolt, learn, Blood tokens, transforming Sagas, firebending.

type SentenceParser = (s: string, ctx: Ctx) => Effect[] | null;

const TOKEN_COLOR: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const capitalized = (words: string) => words.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** Fatal Push: "Destroy target creature if it has mana value 2 or less." */
const destroyIfMV: SentenceParser = (s, ctx) => {
  const m = /^destroy (target creature) if it has mana value (\d+) or less$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "destroyIfMV", what, max: Number(m![2]) }] : null;
};

const learn: SentenceParser = (s) => (s === "learn" ? [{ type: "learn" }] : null);

/** Bloodtithe Harvester: "Target creature gets -X/-X until end of turn, where X is twice the number of Blood tokens you control." */
const twicePerToken: SentenceParser = (s, ctx) => {
  const m = /^(target creature) gets -x\/-x until end of turn, where x is twice the number of ([a-z]+) tokens you control$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what && isCreatureRef(what, ctx) ? [{ type: "pump", power: -2, toughness: -2, what, per: { kind: "permanents", what: "subtype", subtype: m![2], scope: "you" } }] : null;
};

/** "Return a creature card from your graveyard to the battlefield with a finality counter on it." / "Return a creature or planeswalker card from your graveyard to your hand." */
const fromYard: SentenceParser = (s) => {
  const m = /^return an? ([a-z ]+?) card from your graveyard to (your hand|the battlefield)( with a finality counter on it)?$/.exec(s);
  if (!m) return null;
  const types = m[1].split(" or ");
  if (!types.every((t) => CARD_TYPES.includes(t))) return null;
  const filter: CardFilter = { types };
  return [{ type: "fromYard", filter, to: m[2] === "your hand" ? "hand" : "battlefield", ...(m[3] ? { finality: true } : {}) }];
};

const discardDraw: SentenceParser = (s) => {
  const m = /^@@discarddraw (\d+)@@$/.exec(s);
  return m ? [{ type: "discardUpToDraw", n: Number(m[1]) }] : null;
};

const rummageMore: SentenceParser = (s) => {
  const m = /^@@rummagedraw (\d+)@@$/.exec(s);
  return m ? [{ type: "rummage", draw: Number(m[1]) }] : null;
};

const exileTopMany: SentenceParser = (s) => {
  const m = /^@@exiletopnext (\d+)@@$/.exec(s);
  return m ? [{ type: "exileTop", throughNextTurn: true, n: Number(m[1]) }] : null;
};

/** A transforming Saga's last chapter: "Exile this Saga, then return it to the battlefield transformed under your control." */
const returnTransformed: SentenceParser = (s, ctx) =>
  s === "exile ~, then return it to the battlefield transformed under your control" && ctx.allowSelf ? [{ type: "exileReturnTransformed" }] : null;

/** Reflection of Kiki-Jiki: "Create a token that's a copy of another target nonlegendary creature you control, except it has haste." */
const copyToken: SentenceParser = (s, ctx) => {
  const m = /^create a token that's a copy of ((?:another )?target (?:nonlegendary )?(?:creature|nonland permanent) you control)(, except it has haste)?$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "copyTokenOf", what, ...(m![2] ? { haste: true } : {}) }] : null;
};

const anyColorMana: SentenceParser = (s) => (s === "add one mana of any color" ? [{ type: "addMana", mana: [], anyColor: 1 }] : null);

/** Ruinous Waterbending, paid: "Whenever a creature dies this turn, you gain 1 life." */
const deathLife: SentenceParser = (s) => (s === "whenever a creature dies this turn, you gain 1 life" ? [{ type: "deathLifeThisTurn" }] : null);

/** Fable of the Mirror-Breaker: 'Create a 2/2 red Goblin Shaman creature token with "Whenever this token attacks, create a Treasure token."' */
const tokenWithAbility: SentenceParser = (s) => {
  const m = /^create an? (\d+)\/(\d+) (white|blue|black|red|green) ([a-z ]+?) creature token with "(.+?)\.?"$/.exec(s);
  if (!m) return null;
  const subtypes = capitalized(m[4]);
  const text = `${m[5].charAt(0).toUpperCase()}${m[5].slice(1).replace(/~/g, "this token")}.`;
  const token: TokenSpec = { name: subtypes, type: "creature", power: Number(m[1]), toughness: Number(m[2]), colors: [TOKEN_COLOR[m[3]]], subtypes, keywords: [], text };
  return [{ type: "createToken", amount: 1, token }];
};

/** Avatar Roku: "Create a 4/4 red Dragon creature token with flying and firebending 4." (firebending is an ability of the token's) */
const firebendingToken: SentenceParser = (s) => {
  const m = /^create an? (\d+)\/(\d+) (white|blue|black|red|green) ([a-z]+) creature token with (?:([a-z ,]+?) and )?firebending (\d+)$/.exec(s);
  const keywords = m?.[5] ? keywordList(m[5]) : [];
  if (!m || !keywords) return null;
  const subtypes = capitalized(m[4]);
  const token: TokenSpec = { name: subtypes, type: "creature", power: Number(m[1]), toughness: Number(m[2]), colors: [TOKEN_COLOR[m[3]]], subtypes, keywords, text: `Firebending ${m[6]}` };
  return [{ type: "createToken", amount: 1, token }];
};

export const JUND_SENTENCES: SentenceParser[] = [destroyIfMV, learn, twicePerToken, fromYard, discardDraw, rummageMore, exileTopMany, returnTransformed, copyToken, anyColorMana, deathLife, tokenWithAbility, firebendingToken];
