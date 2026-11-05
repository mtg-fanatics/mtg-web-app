import type { Amount, CardFilter, CountSpec, Effect, Ref, TokenSpec } from "../effects.js";
import { parseManaCost } from "../mana.js";
import { amountOf, CARD_TYPES, COLOR_OF, forEachCount, isKeyword, keywordList, parseCount, singularType, toAmount, toNumber } from "./words.js";
import { isCreatureRef, isPermanentRef, isPlayerRef, refFor } from "./targets.js";
import type { Ctx } from "./targets.js";
import { parseClause } from "./effectText.js";
import { MARVEL_SENTENCES } from "./marvelSentences.js";
import { JUND_SENTENCES } from "./jundSentences.js";
import { INFECT_SENTENCES } from "./infectSentences.js";
import { GREEN_SENTENCES } from "./greenSentences.js";
import { STUN_SENTENCES } from "./stunSentences.js";
import { WIPE_SENTENCES } from "./wipeSentences.js";
import { VAMP_SENTENCES } from "./vampSentences.js";
import { THEME_SENTENCES } from "./themeSentences.js";
import { UPKEEP_SENTENCES } from "./upkeepParts.js";
import { FDN_SENTENCES } from "./foundationsSentences.js";

// One parser per kind of sentence ("Draw a card", "~ deals 3 damage to any target"), tried in order.

type SentenceParser = (s: string, ctx: Ctx) => Effect[] | null;

const damage: SentenceParser = (s, ctx) => {
  // "~ deals damage to target creature equal to the number of Mountains you control"
  const counted = /^~ deals damage to (.+?) equal to the number of (.+)$/.exec(s);
  if (counted) {
    const count = parseCount(counted[2]);
    const at = refFor(counted[1], ctx);
    return count && at && !(at.t === "target" && ctx.targets[at.i].kind === "spell") ? [{ type: "damage", amount: { count }, to: at }] : null;
  }
  const where = /^~ deals x damage to (.+), where x is (.+)$/.exec(s);
  if (where) {
    const amount = amountOf(where[2], ctx);
    const to = amount ? refFor(where[1], ctx) : null;
    return amount && to ? [{ type: "damage", amount, to }] : null;
  }
  const m = /^~ deals (\d+|x) damage to (.+)$/.exec(s);
  if (!m) return null;
  const amount = toAmount(m[1])!;
  // "~ deals 2 damage to each non-Villain creature and each opponent"
  const andOpp = /^(each .+ creature) and each opponent$/.exec(m[2]);
  if (andOpp) {
    const group = refFor(andOpp[1], ctx);
    return group ? [{ type: "damage", amount, to: group }, { type: "damage", amount, to: { t: "opp" } }] : null;
  }
  if (m[2] === "each creature and each player") {
    return [{ type: "damage", amount, to: { t: "allCreatures", scope: "all" } }, { type: "damage", amount, to: { t: "eachPlayer" } }];
  }
  const to = refFor(m[2], ctx);
  if (!to || (to.t === "target" && ctx.targets[to.i].kind === "spell")) return null;
  return [{ type: "damage", amount, to }];
};

/** "You gain life equal to that creature's power" / "You gain 1 life for each attacking creature you control". */
const lifeCounted: SentenceParser = (s, ctx) => {
  const eq = /^(you|target player|each opponent) (gain|lose)s? life equal to (.+)$/.exec(s);
  const each = /^(you|target player|each opponent) (gain|lose)s? (\d+|an|a) life for each (.+)$/.exec(s);
  if (!eq && !each) return null;
  const m = (eq ?? each)!;
  const who = refFor(m[1], ctx);
  if (!who || !isPlayerRef(who, ctx)) return null;
  let amount: Amount | null;
  if (eq) amount = amountOf(eq[3], ctx);
  else {
    const c = forEachCount(each![4]);
    amount = c ? { count: c, times: each![3] === "a" || each![3] === "an" ? 1 : Number(each![3]) } : null;
  }
  return amount ? [{ type: m[2] === "gain" ? "gainLife" : "loseLife", amount, who }] : null;
};

/** Tokens made from a count, or that join the attack: "create x 1/1 red Goblin creature tokens, where x is the number of Goblins you control". */
const createTokenCounted: SentenceParser = (s, ctx) => {
  let base = s;
  let tappedAttacking = false;
  const att = / that(?:'s| are) tapped and attacking$/.exec(base);
  if (att) {
    tappedAttacking = true;
    base = base.slice(0, att.index);
  }
  let amount: Amount | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(create x .+ tokens?), where x is (.+)$/.exec(base))) {
    amount = amountOf(m[2], ctx);
    base = m[1];
  } else if ((m = /^create that many (.+ tokens?)$/.exec(base))) {
    amount = { count: { kind: "x" } }; // "that many": the damage that was just dealt
    base = `create x ${m[1]}`;
  } else if ((m = /^create a number of (.+ tokens?) equal to (.+)$/.exec(base))) {
    amount = amountOf(m[2], ctx);
    base = `create x ${m[1]}`;
  } else if ((m = /^(create (?:a|an|one) .+ tokens?(?: with [a-z ,]+)?) for each (.+)$/.exec(base))) {
    const c = forEachCount(m[2]);
    amount = c ? { count: c } : null;
    base = m[1];
  } else if (!tappedAttacking) return null;
  if (!amount && !tappedAttacking) return null;
  const made = createToken(base, ctx);
  if (!made) return null;
  return made.map((e) => (e.type === "createToken" ? { ...e, ...(amount ? { amount } : {}), token: { ...e.token, ...(tappedAttacking ? { tappedAttacking: true } : {}) } } : e));
};

const draw: SentenceParser = (s, ctx) => {
  const m = /^(?:(you|target player|target opponent|each player|each opponent) )?draws? (a|an|one|two|three|four|five|six|seven|\d+|x) cards?$/.exec(s);
  if (!m) return null;
  const amount = toAmount(m[2]);
  const who = refFor(m[1] ?? "you", ctx);
  return amount !== null && who && isPlayerRef(who, ctx) ? [{ type: "draw", amount, who }] : null;
};

const life: SentenceParser = (s, ctx) => {
  const m = /^(you|target player|target opponent|each player|each opponent|defending player|its owner|its controller|that creature's owner|that creature's controller) (gain|gains|lose|loses) (\d+|x) life$/.exec(s);
  if (!m) return null;
  const who = refFor(m[1], ctx);
  if (!who || !isPlayerRef(who, ctx)) return null;
  return [{ type: m[2].startsWith("gain") ? "gainLife" : "loseLife", amount: toAmount(m[3])!, who }];
};

/** "destroy / exile / return to hand / tap / untap" and similar one-object effects on creatures. */
function creatureVerb(re: RegExp, make: (what: Ref, m: RegExpExecArray) => Effect): SentenceParser {
  return (s, ctx) => {
    const m = re.exec(s);
    if (!m) return null;
    const what = refFor(m[1], ctx);
    return what && isCreatureRef(what, ctx) ? [make(what, m)] : null;
  };
}

const destroy: SentenceParser = (s, ctx) => {
  const m = /^destroy (.+)$/.exec(s);
  if (!m) return null;
  const what = refFor(m[1], ctx);
  return what && isPermanentRef(what, ctx) ? [{ type: "destroy", what }] : null;
};
const topOfLibrary = creatureVerb(/^put (.+) on top of its owner's library$/, (what) => ({ type: "topOfLibrary", what }));

/** "Return target creature card from your graveyard to the battlefield (tapped) / to your hand", "... with a finality counter on it". */
const reanimate: SentenceParser = (s, ctx) => {
  const m = /^(?:you may )?return ((?:another )?target .+? card(?: with .+?)? from your graveyard(?:@\d+)?) to (the battlefield tapped|the battlefield|your hand)( with a finality counter on (?:it|~))?$/.exec(s);
  if (!m) return null;
  const what = refFor(m[1], ctx);
  const kind = what?.t === "target" ? ctx.targets[what.i].kind : undefined;
  if (!what || !kind?.startsWith("graveyard") || ((kind === "graveyardSpell" || kind === "graveyardCard") && m[2] !== "your hand")) return null;
  // A spell's "another target ... card" means one of its other targets, not the spell itself: not read yet.
  if (m[1].startsWith("another ") && !ctx.allowSelf) return null;
  return [{ type: "reanimate", what, to: m[2] === "your hand" ? "hand" : "battlefield", tapped: m[2].endsWith("tapped"), ...(m[3] ? { finality: true } : {}) }];
};
/** Like creatureVerb, but any permanent: "return target nonland permanent to its owner's hand". */
function permanentVerb(re: RegExp, make: (what: Ref) => Effect): SentenceParser {
  return (s, ctx) => {
    const m = re.exec(s);
    if (!m) return null;
    const what = refFor(m[1], ctx);
    return what && isPermanentRef(what, ctx) ? [make(what)] : null;
  };
}
const exile = permanentVerb(/^exile (.+)$/, (what) => ({ type: "exile", what }));
const bounce = permanentVerb(/^return (.+) to (?:its|their) owner(?:s')?'?s? hands?$/, (what) => ({ type: "bounce", what }));
/** "Return target creature you own to your hand": your hand is its owner's. */
const bounceOwned: SentenceParser = (s, ctx) => {
  const m = /^return (.+) to your hand$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what?.t === "target" && ctx.targets[what.i].owner === "you" && isPermanentRef(what, ctx) ? [{ type: "bounce", what }] : null;
};
/** "Tap target creature or land" / "untap target nonland permanent" / "untap it" */
const tapUntap: SentenceParser = (s, ctx) => {
  const m = /^(tap|untap) (.+)$/.exec(s);
  const what = m ? refFor(m[2], ctx) : null;
  return m && what && isPermanentRef(what, ctx) ? [{ type: m[1] as "tap" | "untap", what }] : null;
};

const pump: SentenceParser = (s, ctx) => {
  const m = /^(.+?) gets? ([+-]\d+)\/([+-]\d+)(?: and gains? ([a-z ,]+?))? until end of turn$/.exec(s);
  if (!m) return null;
  const keywords = m[4] !== undefined ? keywordList(m[4]) : [];
  if (!keywords) return null;
  const what = refFor(m[1], ctx);
  if (!what || !isCreatureRef(what, ctx)) return null;
  return [{ type: "pump", power: Number(m[2]), toughness: Number(m[3]), what }, ...keywords.map((keyword): Effect => ({ type: "grant", keyword, what }))];
};

const grant: SentenceParser = (s, ctx) => {
  const m = /^(.+?) gains? ([a-z ,]+?) until end of turn$/.exec(s);
  const keywords = m ? keywordList(m[2]) : null;
  if (!m || !keywords) return null;
  const what = refFor(m[1], ctx);
  return what && isCreatureRef(what, ctx) ? keywords.map((keyword): Effect => ({ type: "grant", keyword, what })) : null;
};

const counter: SentenceParser = (s, ctx) => {
  const m = /^counter (target (?:(?:creature|noncreature|artifact or creature|creature or enchantment|artifact or enchantment|colorless|triggered ability or colorless|(?:white|blue|black|red|green) or (?:white|blue|black|red|green)) )?spell(?: with mana value \d+(?: or (?:less|greater))?)?)$/.exec(s);
  if (!m) return null;
  const what = refFor(m[1], ctx);
  return what ? [{ type: "counter", what }] : null;
};

/** There is no regeneration in the engine, so "it can't be regenerated" changes nothing. */
const noRegen: SentenceParser = (s) =>
  /^(?:(?:it|they) can't be regenerated(?: this turn)?|(?:a|that) creature dealt damage this way can't be regenerated this turn)$/.test(s) ? [{ type: "noRegen" }] : null;

/** "Target creature you control fights target creature you don't control." */
const fight: SentenceParser = (s, ctx) => {
  const m = /^(target creature you control) fights (target creature you don't control|target creature an opponent controls)$/.exec(s);
  if (!m) return null;
  const a = refFor(m[1], ctx);
  const b = refFor(m[2], ctx);
  return a && b ? [{ type: "fight", a, b }] : null;
};

/** "Target creature you control deals damage equal to its power to target creature you don't control." */
const bite: SentenceParser = (s, ctx) => {
  const m = /^(~|target creature you control|that creature) deals damage equal to (twice )?its power to (target creature(?: or planeswalker)?(?: you don't control| an opponent controls)?)$/.exec(s);
  if (!m) return null;
  const from = refFor(m[1], ctx);
  const to = refFor(m[3], ctx);
  return from && to ? [{ type: "bite", from, to, ...(m[2] ? { times: 2 } : {}) }] : null;
};

const gainControl = creatureVerb(/^gain control of (.+) until end of turn$/, (what) => ({ type: "gainControl", what }));
const cantBlockNow = creatureVerb(/^(.+) can't block this turn$/, (what) => ({ type: "cantBlockThisTurn", what }));
const regenerate = creatureVerb(/^regenerate (.+)$/, (what) => ({ type: "regenerate", what }));

/** "Put a +1/+1 counter on target creature", "put two +1/+1 counters on ~". */
const counters: SentenceParser = (s, ctx) => {
  const m = /^put (a|an|one|two|three|four|\d+|x) (\+1\/\+1|-1\/-1) counters? on (.+)$/.exec(s);
  if (!m) return null;
  const amount = toAmount(m[1]);
  const what = refFor(m[3], ctx);
  return amount !== null && what && isCreatureRef(what, ctx) ? [{ type: "addCounters", amount, what, ...(m[2] === "-1/-1" ? { kind: "minus" as const } : {}) }] : null;
};

/** "target player mills three cards": the top cards of their library go to the graveyard. */
const mill: SentenceParser = (s, ctx) => {
  const m = /^(?:(you|target player|target opponent|each opponent|each player|that player) )?mills? (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) cards?$/.exec(s);
  if (!m) return null;
  const amount = toAmount(m[2]);
  const who = refFor(m[1] ?? "you", ctx);
  return amount !== null && who && isPlayerRef(who, ctx) ? [{ type: "mill", amount, who }] : null;
};

/** "scry 2": the player may put any of the top cards on the bottom. Waits for the player, so nothing else can follow. */
const scry: SentenceParser = (s) => {
  const m = /^scry (a|one|two|three|four|five|\d+)$/.exec(s);
  const n = m ? toNumber(m[1]) : null;
  return n ? [{ type: "scry", n }] : null;
};

/** "surveil 2": like scry, but the cards you don't keep go to the graveyard. */
const surveil: SentenceParser = (s) => {
  const m = /^surveil (a|one|two|three|four|five|\d+)$/.exec(s);
  const n = m ? toNumber(m[1]) : null;
  return n ? [{ type: "surveil", n }] : null;
};

export const TOKEN_COLOR: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const FOOD: TokenSpec = { name: "Food", type: "artifact", colors: [], subtypes: "Food", keywords: [], text: "{2}, {T}, Sacrifice this artifact: You gain 3 life." };
const MAP: TokenSpec = { name: "Map", type: "artifact", colors: [], subtypes: "Map", keywords: [], text: "{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery." };
const CLUE: TokenSpec = { name: "Clue", type: "artifact", colors: [], subtypes: "Clue", keywords: [], text: "{2}, Sacrifice this artifact: Draw a card." };
const BLOOD: TokenSpec = { name: "Blood", type: "artifact", colors: [], subtypes: "Blood", keywords: [], text: "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card." };
const TREASURE: TokenSpec = { name: "Treasure", type: "artifact", colors: [], subtypes: "Treasure", keywords: [], text: "{T}, Sacrifice this artifact: Add one mana of any color." };

/** "Create a Treasure token", "create two 1/1 white Soldier creature tokens", "...with flying". */
const createToken: SentenceParser = (s) => {
  const m0 = /^create (a|an|one|two|three|four|five|\d+|x) (tapped )?(.+?) tokens?(?: named ([a-z' -]+?))?(?: with ([a-z ,]+))?$/.exec(s);
  const amount = m0 ? toAmount(m0[1]) : null;
  if (!m0 || amount === null) return null;
  // regroup so the rest reads as before: 1 amount, 2 description, 3 name, 4 keywords
  const m = [m0[0], m0[1], m0[3], m0[4], m0[5]];
  const plainToken = m[3] === undefined && m[4] === undefined;
  if (m[2] === "treasure") return plainToken ? [{ type: "createToken", token: TREASURE, amount }] : null;
  if (m[2] === "food") return plainToken ? [{ type: "createToken", token: FOOD, amount }] : null;
  if (m[2] === "clue") return plainToken ? [{ type: "createToken", token: CLUE, amount }] : null;
  if (m[2] === "map") return plainToken ? [{ type: "createToken", token: MAP, amount }] : null;
  if (m[2] === "blood") return plainToken ? [{ type: "createToken", token: BLOOD, amount }] : null;
  // "a legendary 1/1 blue Bird Scout creature token": the engine has no legend rule, so only the rest matters
  const body = /^(\d+)\/(\d+) (?:(colorless|white|blue|black|red|green)(?:(?:,| and) (white|blue|black|red|green))* )?([a-z]+(?: [a-z]+)*?) creature$/.exec(m[2].replace(/^legendary /, ""));
  if (!body) return null;
  const artifactToken = /(?:^| )artifact$/.test(body[5]);
  if (body[5].includes("artifact") && !artifactToken) return null;
  const colors = [...m[2].matchAll(/\b(white|blue|black|red|green)\b/g)].map((c) => TOKEN_COLOR[c[1]]);
  const changeling = m[4] === "changeling";
  const keywords = m[4] === undefined || changeling ? [] : keywordList(m[4]);
  if (!keywords) return null;
  const subtypes = body[5].replace(/ ?artifact$/, "").split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const name = m[3] ? m[3].split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : subtypes;
  return [{ type: "createToken", amount, token: { name, type: "creature", power: Number(body[1]), toughness: Number(body[2]), colors, subtypes, keywords, text: "", ...(m0[2] ? { tapped: true } : {}), ...(artifactToken ? { artifact: true } : {}), ...(changeling ? { changeling: true } : {}) } }];
};

/** "target player discards two cards": the player who discards chooses which. */
const discard: SentenceParser = (s, ctx) => {
  const m = /^(?:(you|target player|target opponent|each opponent|that player) )?discards? (a|one|two|three|\d+) cards?( at random)?$/.exec(s);
  if (!m) return null;
  const amount = toNumber(m[2]);
  const who = refFor(m[1] ?? "you", ctx);
  return amount !== null && who && isPlayerRef(who, ctx) ? [{ type: "discard", who, amount, chooser: m[3] ? "random" : "victim" }] : null;
};

/** "~ deals damage equal to the sacrificed creature's power to any target" (the power is remembered when the creature is sacrificed as a cost). */
const flingDamage: SentenceParser = (s, ctx) => {
  const m = /^~ deals damage equal to the sacrificed creature's power to (.+)$/.exec(s);
  const to = m ? refFor(m[1], ctx) : null;
  return to ? [{ type: "damage", amount: "X", to }] : null;
};
const investigate: SentenceParser = (s, ctx) => {
  if (s === "investigate") return [{ type: "createToken", token: CLUE, amount: 1 }];
  const m = /^(target player|target opponent) investigates$/.exec(s); // "Target player investigates."
  const who = m ? refFor(m[1], ctx) : null;
  return who && isPlayerRef(who, ctx) ? [{ type: "createToken", token: CLUE, amount: 1, who }] : null;
};

/** "Put a stun counter on it" / "put three stun counters on it": the next untap (or three) doesn't happen (to a creature, or any permanent). */
const stunCounter: SentenceParser = (s, ctx) => {
  const m = /^put (a|one|two|three|four|five) stun counters? on (.+)$/.exec(s);
  const what = m ? refFor(m[2], ctx) : null;
  const amount = m ? toNumber(m[1]) : null;
  if (!what || !amount || !(isCreatureRef(what, ctx) || isPermanentRef(what, ctx))) return null;
  return [{ type: "stun", what, ...(amount > 1 ? { amount } : {}) }];
};

const unblockable = creatureVerb(/^(.+) can't be blocked this turn$/, (what) => ({ type: "unblockable", what }));

/** "Airbend target nonland permanent." (also "up to one other target nonland permanent", through the "up to" reading) */
const airbend: SentenceParser = (s, ctx) => {
  const m = /^airbend (.+)$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what?.t === "target" && isPermanentRef(what, ctx) ? [{ type: "airbend", what }] : null;
};

/** "Exile target nonland permanent an opponent controls until ~ leaves the battlefield." (also "up to one target ...") */
const exileUntil: SentenceParser = (s, ctx) => {
  const m = /^exile (.+?) until ~ leaves the battlefield$/.exec(s);
  const what = m ? refFor(m[1].replace(/^another /, ""), ctx) : null;
  return what?.t === "target" && isPermanentRef(what, ctx) ? [{ type: "exileUntilLeaves", what }] : null;
};

/** "creature", "artifact or creature", "land", "forest", "goblin", "permanent": what may be sacrificed as a cost. */
export function parseSacrificeFilter(phrase: string): CardFilter | null {
  if (phrase === "permanent") return { all: true };
  const filter: CardFilter = {};
  for (const term of phrase.split(/ or /).map((x) => x.trim())) {
    if (["creature", "artifact", "land", "enchantment"].includes(term)) (filter.types ??= []).push(term);
    else if (["plains", "island", "swamp", "mountain", "forest"].includes(term)) (filter.subtypes ??= []).push(term);
    else if (/^[a-z]+$/.test(term)) (filter.subtypes ??= []).push(term); // a creature type: goblin, elf...
    else return null;
  }
  return filter.types || filter.subtypes ? filter : null;
}

const sacrificeIt: SentenceParser = (s) => (s === "sacrifice it" || s === "sacrifice ~" ? [{ type: "sacrifice", what: { t: "self" } }] : null);

/** "Exile target creature you control, then return that card to the battlefield under your control." */
/** "Until end of turn, another target Goblin you control gains flying and 'When this creature deals combat damage, sacrifice it.'" */
const sacOnDamageGrant: SentenceParser = (s, ctx) => {
  const m = /^until end of turn, ((?:another )?target [a-z]+ you control) gains flying and "when ~ deals combat damage, sacrifice it.?"$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "grant", keyword: "flying", what }, { type: "sacOnDamage", what }] : null;
};

const exileTopParser: SentenceParser = (s) => (s === "@@exiletopplay@@" ? [{ type: "exileTop", playIfAttacked: true }] : s === "@@exiletopuntil@@" ? [{ type: "exileTop", untilEndStep: true }] : s === "@@exiletopnext@@" ? [{ type: "exileTop", throughNextTurn: true }] : null);

/** "Whenever that creature deals combat damage to a player this turn, you draw a card." (about the creature targeted before it) */
const damageDraw: SentenceParser = (s, ctx) =>
  s === "whenever that creature deals combat damage to a player this turn, you draw a card" && ctx.targets.length > 0 ? [{ type: "combatDamageDraw", what: { t: "target", i: ctx.targets.length - 1 } }] : null;

/** "When this Vehicle enters, it becomes an artifact creature until end of turn." */
const becomeCreature: SentenceParser = (s) => (s === "~ becomes an artifact creature until end of turn" ? [{ type: "crewed" }] : null);

/** A creature land: "~ becomes a 1/1 Phyrexian Blinkmoth artifact creature with flying and infect until end of turn. It's still a land." (colorless: a color would change too) */
const animateLand: SentenceParser = (s) => {
  const m = /^@@animateland (\d+)\/(\d+) ([a-z ]+?)(?: with ([a-z ,]+?))?@@$/.exec(s);
  const keywords = m?.[4] ? keywordList(m[4]) : [];
  const subtypes = m ? m[3].split(" ") : [];
  if (!m || !keywords || subtypes.some((w) => w === "and" || COLOR_OF[w])) return null;
  const what = { t: "self" as const };
  return [{ type: "becomeCreatureNow", what, subtypes }, { type: "setBase", what, power: Number(m[1]), toughness: Number(m[2]) }, ...keywords.map((keyword): Effect => ({ type: "grant", keyword, what }))];
};

/** "Target creature can't be the target of spells or abilities your opponents control this turn." */
const untargetable: SentenceParser = (s, ctx) => {
  const m = /^(target creature(?: you control)?) can't be the target of spells or abilities your opponents control this turn$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "untargetable", what }] : null;
};

/** "Each opponent gets a poison counter." / "Target player gets two poison counters." / "Each player gets a poison counter." */
const poison: SentenceParser = (s, ctx) => {
  const m = /^(each opponent|each player|you|target opponent|target player|that player) gets? (a|an|one|two|three|four|\d+) poison counters?$/.exec(s);
  const who = m ? refFor(m[1], ctx) : null;
  if (!who || !isPlayerRef(who, ctx)) return null;
  return [{ type: "poison", who, amount: m![2] === "a" || m![2] === "an" ? 1 : (toNumber(m![2]) ?? 1) }];
};

/** Woeleecher: "Remove a -1/-1 counter from target creature. If you do, you gain 2 life." */
const removeMinusCounter: SentenceParser = (s, ctx) => {
  const m = /^@@removeminus (\d+)@@$/.exec(s);
  if (!m) return null;
  const what = refFor("target creature", ctx);
  return what && isCreatureRef(what, ctx) ? [{ type: "removeMinusCounter", what, gain: Number(m[1]) }] : null;
};
/** Leech Medic: "Create a Leeches token card and put it into your hand." */
const conjureLeeches: SentenceParser = (s) => (s === "create a leeches token card and put it into your hand" ? [{ type: "conjureCard", card: "leeches" }] : null);
/** Leech Collector: "~ becomes prepared." */
const becomePrepared: SentenceParser = (s) => (s === "~ becomes prepared" ? [{ type: "becomePrepared", what: { t: "self" } }] : null);
/** Blitz Leech: "Remove all counters from that creature." */
const removeAllCounters = creatureVerb(/^remove all counters from (that creature|target creature|it)$/, (what) => ({ type: "removeAllCounters", what }));

/** Leeches: "Target player loses all poison counters. Leeches deals that much damage to that player." */
const poisonBurn: SentenceParser = (s, ctx) => {
  if (s !== "@@poisonburn@@") return null;
  const who = refFor("target player", ctx);
  return who && isPlayerRef(who, ctx) ? [{ type: "poisonBurn", who }] : null;
};

/** Lightstall Inquisitor: "Each opponent exiles a card from their hand and may play that card for as long as it remains exiled. ..." */
const exileToPlay: SentenceParser = (s) => {
  const m = /^@@exiletoplay (\d+)@@$/.exec(s);
  return m ? [{ type: "exileToPlay", who: { t: "opp" }, tax: Number(m[1]), tappedLand: true }] : null;
};

/** "Those creatures don't untap during their controller's next untap step." (after tapping up to two targets) */
const stunThose: SentenceParser = (s, ctx) =>
  s === "those creatures don't untap during their controller's next untap step" && ctx.targets.length > 0 ? ctx.targets.map((_, i): Effect => ({ type: "stun", what: { t: "target", i } })) : null;

const lenaSacrifice: SentenceParser = (s) =>
  s === "creatures you control with power less than ~'s power gain indestructible until end of turn" ? [{ type: "grantIfPowerBelow", keyword: "indestructible" }] : null;

const doubleDamageParser: SentenceParser = (s) =>
  s === "if a source you control would deal damage to an opponent this turn, it deals double that damage to that player instead" ? [{ type: "doubleDamage" }] : null;

/** "Each opponent creates a 1/1 red Pirate creature token with 'This token can't block' and 'Creatures you control attack each combat if able.'" */
const quotedToken: SentenceParser = (s) => {
  const m = /^each opponent creates an? (\d+)\/(\d+) (white|blue|black|red|green) ([a-z]+) creature token with "(.+?)" and "(.+?)\.?"$/.exec(s);
  if (!m) return null;
  const subtype = m[4].charAt(0).toUpperCase() + m[4].slice(1);
  return [{ type: "createToken", amount: 1, who: { t: "opp" }, token: { name: subtype, type: "creature", power: Number(m[1]), toughness: Number(m[2]), colors: [TOKEN_COLOR[m[3]]], subtypes: subtype, keywords: [], text: `${m[5]}.
${m[6]}.` } }];
};

const blinkParser: SentenceParser = (s, ctx) => {
  const m = /^exile ((?:another )?target (?:creature or enchantment|non-[a-z]+ creature|creature)(?: you control)?), then return (?:that card|it) to the battlefield under (?:your|its owner's) control$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "blink", what }] : null;
};

const scryIfMV: SentenceParser = (s, ctx) => {
  const m = /^if its mana value was (\d+) or less, scry (\d+)$/.exec(s);
  return m && ctx.targets.length > 0 ? [{ type: "scryIfMV", what: { t: "target", i: ctx.targets.length - 1 }, max: Number(m[1]), n: Number(m[2]) }] : null;
};

const noGroundBlock: SentenceParser = (s) => (s === "creatures without flying can't block this turn" ? [{ type: "noGroundBlock" }] : null);

const setBase: SentenceParser = (s, ctx) => {
  const m = /^until end of turn, (target creature) becomes an? (?:[a-z]+ )?[a-z]+ with base power and toughness (\d+)\/(\d+)$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return m && what ? [{ type: "setBase", what, power: Number(m[2]), toughness: Number(m[3]) }] : null;
};

const loseDefender: SentenceParser = (s) => (/^~ loses defender and becomes an? [a-z]+ until end of turn$/.test(s) ? [{ type: "loseDefender", what: { t: "self" } }] : null);

const sweep: SentenceParser = (s, ctx) => {
  if (s !== "~ deals x damage to each creature without flying and each planeswalker") return null;
  return [{ type: "damage", amount: "X", to: { t: "allCreatures", scope: "all", noFlying: true } }, { type: "damage", amount: "X", to: { t: "allPlaneswalkers" } }];
};

/** "You may tap any number of untapped creatures you control. ~ gets +1/+1 until end of turn for each creature tapped this way." */
const tapForBonus: SentenceParser = (s) => (s === "@@tapforbonus@@" ? [{ type: "tapForBonus" }] : null);

const assignByToughness: SentenceParser = (s, ctx) => {
  const m = /^(target creature you control) assigns combat damage equal to its toughness rather than its power this turn$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "assignByToughness", what }] : null;
};

/** "If that creature is a Cat, it gains first strike until end of turn." */
const ifSubtypeGrant: SentenceParser = (s, ctx) => {
  const m = /^if that creature is an? ([a-z]+), it gains ([a-z ]+) until end of turn$/.exec(s);
  if (!m || ctx.targets.length === 0 || !isKeyword(m[2])) return null;
  return [{ type: "ifSubtypeGrant", what: { t: "target", i: ctx.targets.length - 1 }, subtype: m[1], keyword: m[2] }];
};

const libraryChoice: SentenceParser = (s, ctx) => {
  const m = /^the owner of (target nonland permanent) puts it on their choice of the top or bottom of their library$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "libraryChoice", what }] : null;
};

/** "+1/+0 for each other attacking Goblin". */
/** "Other attacking creatures you control get +X/+0 until end of turn, where X is the number of counters on ~." */
const pumpWhere: SentenceParser = (s, ctx) => {
  const m = /^(.+?) get \+x\/([+-]\d+) until end of turn, where x is the number of counters on ~$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return m && what ? [{ type: "pump", power: 1, toughness: Number(m[2]), what, per: { kind: "selfCounters" } }] : null;
};

/** "~ and Drakes you control each get +X/+X until end of turn, where X is the number of cards in your hand." (Alandra) */
const pumpHandTeam: SentenceParser = (s) => {
  const m = /^~ and ([a-z]+) you control each get \+x\/\+x until end of turn, where x is the number of cards in your hand$/.exec(s);
  if (!m) return null;
  return [
    { type: "pump", power: 1, toughness: 1, what: { t: "self" }, per: { kind: "hand" } },
    { type: "pump", power: 1, toughness: 1, what: { t: "allCreatures", scope: "yours", subtype: singularType(m[1]) }, per: { kind: "hand" } },
  ];
};

const pumpPer: SentenceParser = (s, ctx) => {
  const m = /^(.+?) gets? ([+-]\d+)\/([+-]\d+) until end of turn for each (.+)$/.exec(s);
  if (!m) return null;
  const what = refFor(m[1], ctx);
  const per = forEachCount(m[4]);
  return what && per && isCreatureRef(what, ctx) ? [{ type: "pump", power: Number(m[2]), toughness: Number(m[3]), what, per }] : null;
};

/** "Draw a card for each creature you control with toughness greater than its power." */
const drawForEach: SentenceParser = (s) => {
  const m = /^draw a card for each (.+)$/.exec(s);
  if (!m) return null;
  const c: CountSpec | null = m[1] === "creature you control with toughness greater than its power" ? { kind: "toughnessGtPower" } : forEachCount(m[1]);
  return c ? [{ type: "draw", amount: { count: c }, who: { t: "you" } }] : null;
};

const rummageBottom: SentenceParser = (s) => (s === "@@rummagebottom@@" ? [{ type: "rummage", toBottom: true }] : null);

/** "Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle." */
const searchTheirs: SentenceParser = (s, ctx) => {
  if (s !== "its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle" || ctx.targets.length === 0) return null;
  return [{ type: "search", tapped: true, who: { t: "controllerOf", i: ctx.targets.length - 1 } }];
};

/** "Its controller creates a 1/1 white Soldier creature token." */
const tokenForController: SentenceParser = (s, ctx) => {
  const m = /^(?:its|that creature's) controller creates (.+)$/.exec(s);
  if (!m || ctx.targets.length === 0) return null;
  const made = createToken(`create ${m[1]}`, ctx);
  return made ? made.map((e) => (e.type === "createToken" ? { ...e, who: { t: "controllerOf" as const, i: ctx.targets.length - 1 } } : e)) : null;
};

/** "Target player creates a 6/5 blue Leviathan creature token with hexproof." */
const tokenForPlayer: SentenceParser = (s, ctx) => {
  const m = /^(target player|target opponent|each player|each opponent) creates (.+)$/.exec(s);
  if (!m) return null;
  const who = refFor(m[1], ctx);
  if (!who || !isPlayerRef(who, ctx)) return null;
  const made = createToken(`create ${m[2]}`, ctx);
  return made ? made.map((e) => (e.type === "createToken" ? { ...e, who } : e)) : null;
};

const bounceOwn: SentenceParser = (s) => {
  const m = /^return (a|another) (green )?creature you control to its owner's hand$/.exec(s);
  return m ? [{ type: "bounceOwn", other: m[1] === "another", ...(m[2] ? { color: "G" } : {}) }] : null;
};

const winGame: SentenceParser = (s) => (s === "you win the game" ? [{ type: "winGame" }] : null);

/** "You may draw a card unless that player pays {1}." (Rhystic Study) */
const drawUnlessPay: SentenceParser = (s) => {
  const m = /^you may draw a card unless that player pays ((?:\{[^}]+\})+)$/.exec(s);
  return m && parseManaCost(m[1]) ? [{ type: "drawUnlessPay", cost: m[1] }] : null;
};

/** "You may tap or untap target permanent." */
const tapOrUntap: SentenceParser = (s, ctx) => {
  const m = /^(?:you may )?tap or untap (target (?:nonland )?(?:permanent|creature))$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "tapOrUntap", what }] : null;
};

const returnSelfYard: SentenceParser = (s) => (s === "return ~ from your graveyard to your hand" ? [{ type: "returnFromYard" }] : null);

const fog: SentenceParser = (s) => (s === "prevent all combat damage that would be dealt this turn" ? [{ type: "fog" }] : null);
const rummage: SentenceParser = (s) => (s === "@@rummage@@" ? [{ type: "rummage" }] : null);

/** "Attach it to target creature you control" (an Equipment that attaches itself as it enters). */
const attachSelf: SentenceParser = (s, ctx) => {
  const m = /^attach (?:~|it) to (target [a-z]+ you control)$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what && isCreatureRef(what, ctx) ? [{ type: "attach", what }] : null;
};

const becomeCopy: SentenceParser = (s, ctx) => {
  const m = /^~ becomes a copy of ((?:another )?target creature(?: you control)?)$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "becomeCopy", what }] : null;
};

/** "Counter target spell unless its controller pays {2}." */
const counterUnless: SentenceParser = (s, ctx) => {
  const m = /^counter (target (?:noncreature |creature )?spell|that spell) unless its controller pays ((?:\{[^}]+\})+)$/.exec(s);
  const what = m ? (m[1] === "that spell" ? (ctx.targets.length > 0 && ctx.targets[ctx.targets.length - 1].kind === "spell" ? ({ t: "target", i: ctx.targets.length - 1 } as const) : null) : refFor(m[1], ctx)) : null;
  return m && what && parseManaCost(m[2]) ? [{ type: "counterUnlessPay", what, cost: m[2] }] : null;
};

/** "If that creature would die this turn, exile it instead." ("that creature": the creature the spell targets.) */
const exileIfDies: SentenceParser = (s, ctx) => {
  if (!/^if that (?:creature|creature or planeswalker) would die this turn, exile it instead$/.test(s)) return null;
  let i = ctx.targets.length - 1;
  while (i >= 0 && ctx.targets[i].kind !== "creature" && ctx.targets[i].kind !== "creatureOrPlaneswalker") i--;
  return i >= 0 ? [{ type: "exileIfDies", what: { t: "target", i } }] : null;
};

/** "Exile up to one target Equipment attached to that creature." */
const exileAttachedEquipment: SentenceParser = (s, ctx) => {
  const host = ctx.targets.length - 1;
  if (s !== "exile up to one target equipment attached to that creature" || host < 0 || ctx.targets[host].kind !== "creature") return null;
  ctx.targets.push({ kind: "artifact", subtype: "equipment", optional: true, attachedToTarget: host, label: "up to one target Equipment attached to that creature" });
  return [{ type: "exile", what: { t: "target", i: ctx.targets.length - 1 } }];
};

/** "If it's a Zombie card, draw a card." (about the card the spell returned) */
/** "If you control another Hero, you gain 2 life." */
const ifControlOther: SentenceParser = (s, ctx) => {
  const m = /^if you control another ([a-z]+), (.+)$/.exec(s);
  const then = m ? parseClause(m[2], ctx) : null;
  return m && then ? [{ type: "ifControlOther", subtype: m[1], then }] : null;
};

/** "~ connives" / "it connives" (the creature that entered, in "whenever another Villain enters, it connives"). */
const connive: SentenceParser = (s, ctx) => {
  const m = /^(it|~) connives$/.exec(s);
  if (!m) return null;
  return [{ type: "connive", what: m[1] === "it" && ctx.itIsOther ? { t: "other" } : { t: "self" } }];
};

const ifSubtypeThen: SentenceParser = (s, ctx) => {
  const m = /^if it's an? ([a-z]+) card, (.+)$/.exec(s);
  if (!m || ctx.targets.length === 0) return null;
  const what: Ref = { t: "target", i: ctx.targets.length - 1 };
  const then = parseClause(m[2], ctx);
  return then ? [{ type: "ifSubtype", what, subtype: m[1], then }] : null;
};

/** "Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures." */
const distribute: SentenceParser = (s, ctx) => {
  const m = /^distribute (two|three|four|five) \+1\/\+1 counters among one, two, or three target creatures(, then double the number of \+1\/\+1 counters on each of those creatures)?$/.exec(s);
  if (!m || ctx.targets.length > 0) return null;
  const labels = ["target creature (it gets the most counters)", "second target creature (optional)", "third target creature (optional)"];
  labels.forEach((label, i) => ctx.targets.push({ kind: "creature", distinct: true, ...(i > 0 ? { optional: true } : {}), label }));
  return [{ type: "distributeCounters", total: toNumber(m[1])!, ...(m[2] ? { double: true } : {}) }];
};

/** "Each creature you control gets +3/+3 until end of turn and must be blocked this turn if able." */
const pumpMustBeBlocked: SentenceParser = (s, ctx) => {
  const m = /^(.+?) gets? ([+-]\d+)\/([+-]\d+) until end of turn and must be blocked this turn if able$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return m && what && isCreatureRef(what, ctx) ? [{ type: "pump", power: Number(m[2]), toughness: Number(m[3]), what }, { type: "mustBeBlocked", what }] : null;
};

/** "Attacking creatures you control get +X/+X until end of turn, where X is the number of attacking creatures." */
const pumpX: SentenceParser = (s, ctx) => {
  const m = /^(.+?) gets? \+x\/\+x until end of turn, where x is the number of (.+)$/.exec(s);
  const per = m ? parseCount(m[2]) : null;
  const what = m && per ? refFor(m[1], ctx) : null;
  return per && what && isCreatureRef(what, ctx) ? [{ type: "pump", power: 1, toughness: 1, what, per }] : null;
};

/** "Until end of turn, target creature gains 'When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it.'" */
const diesReturnGrant: SentenceParser = (s, ctx) => {
  const m = /^until end of turn, (target creature) gains "when ~ dies, return it to the battlefield tapped under its owner's control with a \+1\/\+1 counter on it\.?"$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "grantDiesReturn", what }] : null;
};

/** "Return this card from your graveyard to the battlefield tapped." (an ability that works from the graveyard) */
const returnSelfFromYard: SentenceParser = (s) => {
  const m = /^return ~ from your graveyard to the battlefield(?: (tapped|with a finality counter on it))?$/.exec(s);
  return m ? [{ type: "returnSelfToBattlefield", ...(m[1] === "tapped" ? { tapped: true } : m[1] ? { finality: true } : {}) }] : null;
};

/** "~ becomes a Werewolf": the new creature type replaces its others. */
const becomeSubtype: SentenceParser = (s) => {
  const m = /^~ becomes an? ([a-z]+)$/.exec(s);
  return m && !CARD_TYPES.includes(m[1]) ? [{ type: "becomeSubtype", what: { t: "self" }, subtype: m[1] }] : null;
};

const explore: SentenceParser = (s, ctx) => {
  if (s === "~ explores") return [{ type: "explore" }];
  const m = /^(target creature you control|target creature that crewed it this turn) explores$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "explore", what }] : null;
};

/** "Destroy all other creatures if its power is exactly 20." */
const ifSelfPower: SentenceParser = (s, ctx) => {
  const m = /^(.+) if its power is exactly (\d+)$/.exec(s);
  const then = m && ctx.allowSelf ? parseClause(m[1], ctx) : null;
  return then ? [{ type: "ifSelfPower", n: Number(m![2]), then }] : null;
};

/** "Infusion — If you gained life this turn, ..." / "Draw a card if you've gained 3 or more life this turn." */
const ifLifeGained: SentenceParser = (s, ctx) => {
  const before = /^(?:infusion — )?if you gained life this turn, (.+)$/.exec(s);
  const after = /^(.+) if you've gained (\w+) or more life this turn$/.exec(s);
  const atLeast = before ? 1 : after ? toNumber(after[2]) : null;
  const then = atLeast !== null ? parseClause(before ? before[1] : after![1], ctx) : null;
  return then ? [{ type: "ifLifeGained", atLeast: atLeast!, then }] : null;
};

/** "When this creature dies, put its counters on target creature you control." */
const putSavedCounters: SentenceParser = (s, ctx) => {
  const m = /^put its counters on (target creature you control)$/.exec(s);
  const what = m && ctx.allowSelf ? refFor(m[1], ctx) : null;
  return what ? [{ type: "putSavedCounters", what }] : null;
};

/** Meltdown: "Destroy each artifact with mana value X or less." */
const destroyArtifacts: SentenceParser = (s) => {
  const m = /^destroy each artifact with mana value (x|\d+) or less$/.exec(s);
  return m ? [{ type: "destroyArtifacts", mvAtMost: toAmount(m[1])! }] : null;
};

/** Stoke Genius: "Discard your hand, then draw two cards." */
const discardHand: SentenceParser = (s) => (s === "discard your hand" ? [{ type: "discardHand" }] : null);

/** Colorstorm Stallion: "If five or more mana was spent to cast that spell, create a token that's a copy of this creature." */
const ifManaSpent: SentenceParser = (s, ctx) => {
  const m = /^if (two|three|four|five|six|seven|\d+) or more mana was spent to cast that spell, (.+)$/.exec(s);
  const then = m ? parseClause(m[2], ctx) : null;
  return then ? [{ type: "ifManaSpent", n: toNumber(m![1]) ?? 5, then }] : null;
};
const copySelfToken: SentenceParser = (s, ctx) => (s === "create a token that's a copy of ~" && ctx.allowSelf ? [{ type: "copySelfToken" }] : null);

/** Impractical Joke: "Damage can't be prevented this turn." */
const noPrevention: SentenceParser = (s) => (s === "damage can't be prevented this turn" ? [{ type: "noPrevention" }] : null);

/** Ral, Crackling Wit: "Put a loyalty counter on Ral." / "You get an emblem with 'Instant and sorcery spells you cast have storm.'" */
const addLoyalty: SentenceParser = (s, ctx) => {
  const m = /^put (a|an|one|two|three|\d+) loyalty counters? on ~$/.exec(s);
  return m && ctx.allowSelf ? [{ type: "addLoyalty", amount: toNumber(m[1]) ?? 1 }] : null;
};
const stormEmblem: SentenceParser = (s) => (/^you get an emblem with "instant and sorcery spells you cast have storm\.?"\.?$/.test(s) ? [{ type: "stormEmblem" }] : null);

/** Sunspine Lynx: "It deals damage to each player equal to the number of nonbasic lands that player controls." */
const damagePerNonbasic: SentenceParser = (s) => (s === "~ deals damage to each player equal to the number of nonbasic lands that player controls" ? [{ type: "damagePerNonbasic" }] : null);

/** Ghost Vacuum: "Exile target card from a graveyard." and, later, every creature card it exiled comes back as a 1/1 Spirit with flying. */
const exileYardCard: SentenceParser = (s, ctx) => {
  const m = /^exile (target card from a graveyard)$/.exec(s);
  const what = m ? refFor(m[1], ctx) : null;
  return what ? [{ type: "exileYardCard", what }] : null;
};
const putExiledWith: SentenceParser = (s) => (s === "@@putexiledwith@@" ? [{ type: "putExiledWith" }] : null);

/** "Exile target player's graveyard." */
const exileGraveyard: SentenceParser = (s, ctx) => {
  const m = /^exile (target player|target opponent|that player)'s graveyard$/.exec(s);
  const who = m ? refFor(m[1], ctx) : null;
  return who && isPlayerRef(who, ctx) ? [{ type: "exileGraveyard", who }] : null;
};

/** A Case of the Uneaten Feast: 'Creature cards in your graveyard gain "You may cast this card from your graveyard" until end of turn.' */
const yardCastable: SentenceParser = (s) => (s === 'creature cards in your graveyard gain "you may cast ~ from your graveyard" until end of turn' ? [{ type: "yardCastable" }] : null);

const PARSERS: SentenceParser[] = [...FDN_SENTENCES, ...MARVEL_SENTENCES, ...JUND_SENTENCES, ...INFECT_SENTENCES, ...GREEN_SENTENCES, ...STUN_SENTENCES, ...WIPE_SENTENCES, ...VAMP_SENTENCES, ...THEME_SENTENCES, ...UPKEEP_SENTENCES, poisonBurn, removeMinusCounter, removeAllCounters, conjureLeeches, becomePrepared, discardHand, ifManaSpent, copySelfToken, noPrevention, addLoyalty, stormEmblem, damagePerNonbasic, exileYardCard, putExiledWith, bounceOwned, exileGraveyard, destroyArtifacts, connive, tokenForPlayer, ifControlOther, airbend, exileToPlay, explore, ifSelfPower, ifLifeGained, putSavedCounters, yardCastable, exileIfDies, exileAttachedEquipment, ifSubtypeThen, distribute, pumpMustBeBlocked, pumpX, diesReturnGrant, returnSelfFromYard, becomeSubtype, stunThose, lenaSacrifice, doubleDamageParser, quotedToken, exileTopParser, damageDraw, becomeCreature, animateLand, untargetable, poison, sacOnDamageGrant, pumpWhere, pumpHandTeam, tapForBonus, assignByToughness, ifSubtypeGrant, libraryChoice, pumpPer, drawForEach, blinkParser, scryIfMV, noGroundBlock, setBase, loseDefender, sweep, rummageBottom, searchTheirs, tokenForController, bounceOwn, lifeCounted, createTokenCounted, winGame, drawUnlessPay, tapOrUntap, sacrificeIt, returnSelfYard, flingDamage, investigate, stunCounter, unblockable, exileUntil, fog, rummage, attachSelf, counterUnless, becomeCopy, damage, draw, life, mill, scry, surveil, createToken, discard, fight, bite, gainControl, cantBlockNow, regenerate, counters, destroy, exile, bounce, topOfLibrary, reanimate, tapUntap, pump, grant, counter, noRegen];

export function parseSimple(s: string, ctx: Ctx): Effect[] | null {
  for (const parse of PARSERS) {
    const result = parse(s, ctx);
    if (result) return result;
  }
  return null;
}
