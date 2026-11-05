import type { ParsedCard, StaticEffect } from "../../effects.js";
import { keywordList, toNumber } from "../words.js";
import { parseStatic, selfStatic } from "../abilities.js";
import { newCtx } from "../targets.js";
import { parseEffectText } from "../effectText.js";

// Lines from the Marvel Super Heroes set (teamwork, plans and the like). Each reader takes one line of a permanent's text
// and says whether it read it, like the readers in the other files of this folder.

/** Names printed in front of an ability ("Radar Sense — You may look at ..."): the text after the dash is the ability. */
export const MARVEL_ABILITY_WORD = /^(?:avian telepathy|radar sense|sonic attack|unbreakable skin|embiggen fist|wasp's sting|cosmic awareness|photographic reflexes|cybernetic senses|mental organism|designed only for killing|no one dies!|i love squirrels!|do you like squirrels\?|intangibility|brontosaurus|tyrannosaurus rex|seismic takedown|trick arrows|enrage|landfall) — /;

/** Reads the effect part of a trigger line the usual way: "it" is the permanent itself. Pushes the trigger, or notes the line as not understood. */
function trigger(out: ParsedCard, line: string, event: ParsedCard["triggers"][number]["event"], body: string, extra: Partial<ParsedCard["triggers"][number]> = {}, about: "self" | "other" = "self"): true {
  const ctx = newCtx(true);
  // "other": the trigger is about another creature ("that creature", "it") rather than the permanent itself
  if (about === "other") ctx.hasOther = ctx.itIsOther = true;
  const effects = parseEffectText(about === "other" ? body : body.replace(/^it /, "~ ").replace(/ on (?:him|her|it) and /, " on ~ and ").replace(/ on (?:him|her|it)$/, " on ~"), ctx);
  if (effects && effects.length > 0) out.triggers.push({ event, effects, targets: ctx.targets, text: line, ...extra });
  else out.unsupported.push(line);
  return true;
}

/** "Whenever Agent Maria Hill becomes tapped to pay a teamwork cost, put a +1/+1 counter on her and draw a card." */
export function readTeamworkTrigger(line: string, out: ParsedCard): boolean {
  const m = /^whenever ~ becomes tapped to pay a teamwork cost,? (.+)$/.exec(line);
  return m ? trigger(out, line, "teamworkTap", m[1]) : false;
}

/**
 * "Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn." / "Whenever Luke Cage attacks alone, ..." /
 * "Whenever equipped creature attacks alone, untap it and scry 1."
 */
export function readAttacksAlone(line: string, out: ParsedCard): boolean {
  const m = /^whenever (a creature you control|~|equipped creature) attacks alone,? (.+)$/.exec(line);
  if (!m) return false;
  const who = m[1];
  return trigger(out, line, "attacksAlone", m[2], who === "~" ? { selfOnly: true } : who === "equipped creature" ? { hostOnly: true } : {}, who === "~" ? "self" : "other");
}

/** Exalted is that same trigger: each instance gives the lone attacker +1/+1. */
export function readExalted(line: string, out: ParsedCard): boolean {
  if (line !== "exalted") return false;
  return readAttacksAlone("whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn", out);
}

/** "Whenever equipped creature attacks, tap target creature defending player controls." / "Whenever an equipped creature you control attacks, it connives." */
export function readEquippedAttacks(line: string, out: ParsedCard): boolean {
  const m = /^whenever (equipped creature|an equipped creature you control) attacks,? (.+)$/.exec(line);
  if (!m) return false;
  return trigger(out, line, "allyAttacks", m[2], m[1] === "equipped creature" ? { hostOnly: true } : { equippedOnly: true }, "other");
}

const ORDINAL: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };

/**
 * A Plan enchantment's second line: "When the fourth plan counter is put on this enchantment, sacrifice it. When you do, put an indestructible counter on
 * target creature you control." / "..., sacrifice it, draw a card, and put a +1/+1 counter on each creature you control."
 */
export function readPlanThreshold(line: string, out: ParsedCard): boolean {
  const m = /^when the (first|second|third|fourth|fifth|sixth|seventh) plan counter is put on ~, sacrifice it(?:(,| and|\. when you do,) (.+))?$/.exec(line);
  if (!m) return false;
  const ctx = newCtx(true);
  const effects = m[3] ? parseEffectText(m[3].replace(/, and /g, " and "), ctx) : [];
  if (!effects) {
    out.unsupported.push(line);
    return true;
  }
  out.plan = { threshold: ORDINAL[m[1]], effects, targets: ctx.targets, text: line };
  return true;
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

/** A Saga's chapter: "I — Scry 2." / "II, III — Each opponent loses 2 life." */
export function readChapter(line: string, out: ParsedCard): boolean {
  const m = /^((?:i|ii|iii|iv|v)(?:, (?:i|ii|iii|iv|v))*) — (.+)$/.exec(line);
  if (!m) return false;
  const numbers = m[1].split(", ").map((r) => ROMAN[r]);
  const ctx = newCtx(true);
  const effects = parseEffectText(m[2], ctx);
  if (!effects || effects.length === 0) {
    out.unsupported.push(line);
    return true;
  }
  const saga = (out.saga ??= { final: 0, chapters: [] });
  saga.chapters.push({ numbers, effects, targets: ctx.targets, text: line });
  saga.final = Math.max(saga.final, ...numbers);
  return true;
}

/** "As long as there are two or more creature cards in your graveyard, ~ gets +2/+2 and is all creature types." */
export function readYardCondition(line: string, out: ParsedCard): boolean {
  const m = /^as long as there are (two|three|\d+) or more creature cards in your graveyard, ~ (.+)$/.exec(line);
  if (!m) return false;
  const n = toNumber(m[1]) ?? 2;
  const allTypes = / and is all creature types$/.test(m[2]);
  const body = m[2].replace(/ and is all creature types$/, "");
  const st = body === "" ? ({ scope: "self", power: 0, toughness: 0, keywords: [] } as StaticEffect) : selfStatic(`~ ${body}`);
  if (!st) {
    out.unsupported.push(line);
    return true;
  }
  (out.statics ??= []).push({ ...st, scope: "self", cond: { yardCreatures: n }, ...(allTypes ? { allTypes: true } : {}) });
  return true;
}

/** "Whenever you cast a spell that targets a creature you control, put a +1/+1 counter on ~." / "...that targets one or more creatures, ..." */
export function readSpellTargetsTrigger(line: string, out: ParsedCard): boolean {
  const m = /^whenever you cast a spell that targets (a creature you control|one or more creatures),? (.+)$/.exec(line);
  return m ? trigger(out, line, "youCast", m[2], { spellTargets: m[1] === "a creature you control" ? "ownCreature" : "creatures" }) : false;
}

/** "Whenever ~ becomes tapped, ..." / "Whenever equipped creature becomes tapped, it deals 1 damage to each opponent." */
export function readBecomesTapped(line: string, out: ParsedCard): boolean {
  const m = /^whenever (~|equipped creature) becomes tapped,? (.+)$/.exec(line);
  if (!m) return false;
  return trigger(out, line, m[1] === "~" ? "selfTapped" : "hostTapped", m[1] === "~" ? m[2] : m[2].replace(/^it deals /, "~ deals "));
}

/**
 * "Whenever one or more creatures you control become tapped, draw a card, then discard a card and put a plan counter on this enchantment." /
 * "Whenever a creature you control becomes tapped during your turn, if it's the first time that creature has become tapped this turn, untap it."
 */
export function readAllyTapped(line: string, out: ParsedCard): boolean {
  const batch = /^whenever one or more creatures you control become tapped,? (.+)$/.exec(line);
  if (batch) return trigger(out, line, "allyTapped", batch[1], { batch: true });
  const first = /^whenever a creature you control becomes tapped during your turn, if it's the first time that creature has become tapped this turn, (.+)$/.exec(line);
  return first ? trigger(out, line, "allyTapped", first[1], { yourTurnOnly: true, firstTapOnly: true }, "other") : false;
}

/** "Whenever you put a +1/+1 counter on another creature, ..." / "...on a creature, ..." / "...on one or more other Heroes you control, you may ..." */
export function readYouPutCounters(line: string, out: ParsedCard): boolean {
  const m = /^whenever you put (?:a|one or more) \+1\/\+1 counters? on (another creature|a creature|one or more other ([a-z]+)s you control),? (.+)$/.exec(line);
  if (!m) return false;
  const body = m[3].replace(/^you may /, "");
  return trigger(out, line, "allyCountersAdded", body, m[1] === "a creature" ? {} : { other: true, ...(m[2] ? { subtypes: [m[2]] } : {}) });
}

/** "Whenever another creature you control enters, if it has greater power or toughness than ~, put a +1/+1 counter on ~." */
export function readEntersGreater(line: string, out: ParsedCard): boolean {
  const m = /^whenever another creature you control enters, if it has greater power or toughness than ~, (.+)$/.exec(line);
  return m ? trigger(out, line, "allyEnters", m[1], { other: true, cond: { enteringGreater: true } }) : false;
}

/** "Doc Samson: if you would put one or more counters on a permanent you control, put that many plus one of each of those kinds of counters on that permanent instead." */
export function readCountersPlusOne(line: string, out: ParsedCard): boolean {
  if (line !== "if you would put one or more counters on a permanent you control, put that many plus one of each of those kinds of counters on that permanent instead") return false;
  out.countersPlusOne = true;
  return true;
}

/** "You have no maximum hand size." / "Your maximum hand size is ten." */
export function readHandSize(line: string, out: ParsedCard): boolean {
  if (line === "you have no maximum hand size") out.maxHandSize = Infinity;
  else if (line === "your maximum hand size is ten") out.maxHandSize = 10;
  else return false;
  return true;
}

/** "As long as you've put one or more +1/+1 counters on ~ this turn, he has flying." */
export function readCounteredThisTurn(line: string, out: ParsedCard): boolean {
  const self = /^as long as you've put one or more \+1\/\+1 counters on ~ this turn, ~ (.+)$/.exec(line);
  if (self) {
    const st = selfStatic(`~ ${self[1]}`);
    if (!st) return false;
    (out.statics ??= []).push({ ...st, scope: "self", cond: { selfCounteredThisTurn: true } });
    return true;
  }
  const each = /^each creature you control that you've put one or more \+1\/\+1 counters on this turn (has|have) (.+)$/.exec(line);
  if (!each) return false;
  const st = parseStatic(`creatures you control have ${each[2]}`);
  if (!st) return false;
  (out.statics ??= []).push({ ...st, targetCounteredThisTurn: true });
  return true;
}

/** "Attacking creature tokens you control have first strike." / "Creatures you control with +1/+1 counters on them have trample." */
export function readTokenAndCounterLords(line: string, out: ParsedCard): boolean {
  const tokens = /^attacking creature tokens you control have ([a-z ,]+)$/.exec(line);
  const counters = /^(?:creatures you control with \+1\/\+1 counters on them have|each creature you control with a \+1\/\+1 counter on it has) ([a-z ,]+)$/.exec(line);
  const m = tokens ?? counters;
  const keywords = m ? keywordList(m[1]) : null;
  if (!m || !keywords) return false;
  (out.statics ??= []).push({ scope: "yours", power: 0, toughness: 0, keywords, ...(tokens ? { attackingOnly: true, tokensOnly: true } : { withCounters: true }) });
  return true;
}

/** "Stature can't be blocked if her power is 1 or less." */
export function readUnblockableIfSmall(line: string, out: ParsedCard): boolean {
  const m = /^~ can't be blocked if (?:her|his|its) power is (\d+) or less$/.exec(line);
  if (!m) return false;
  (out.statics ??= []).push({ scope: "self", power: 0, toughness: 0, keywords: [], unblockable: true, cond: { powerAtMost: Number(m[1]) } });
  return true;
}

/** "As long as you control an artifact creature or a Plan, ~ has indestructible." */
export function readControlsArtifactCreatureOrPlan(line: string, out: ParsedCard): boolean {
  const m = /^as long as you control an artifact creature or a plan, ~ (has .+)$/.exec(line);
  const st = m ? selfStatic(`~ ${m[1]}`) : null;
  if (!st) return false;
  (out.statics ??= []).push({ ...st, scope: "self", cond: { artifactCreatureOrPlan: true } });
  return true;
}

/** "Instant and sorcery spells you cast with mana value 4 or greater cost {X} less to cast, where X is The Scarlet Witch's power." */
export function readScarletWitchDiscount(line: string, out: ParsedCard): boolean {
  const m = /^instant and sorcery spells you cast with mana value (\d+) or greater cost \{X\} less to cast, where x is ~'s power$/i.exec(line);
  if (!m) return false;
  (out.costMods ??= []).push({ n: 0, minMV: Number(m[1]), nFromPower: true, instantSorceryOnly: true });
  return true;
}

/** "Whenever another Villain and/or artifact you control enters, ..." / "Whenever an artifact you control enters, ..." */
export function readVillainOrArtifactEnters(line: string, out: ParsedCard): boolean {
  const m = /^whenever (another villain and\/or artifact|an artifact) you control enters,? (.+)$/.exec(line);
  if (!m) return false;
  const villain = m[1].startsWith("another");
  return trigger(out, line, "allyEnters", m[2], { orArtifact: true, subtypes: villain ? ["villain"] : [], ...(villain ? { other: true } : {}), ...(/this ability triggers only once/.test(line) ? { oncePerTurn: true } : {}) });
}

/** "Whenever ~ attacks, draw a card if her power is 4 or greater." / "Whenever ~ attacks, if he's equipped, each opponent loses X life and you gain X life, where X is the number of Equipment attached to him." */
export function readAttackConditions(line: string, out: ParsedCard): boolean {
  const power = /^whenever ~ attacks, draw a card if (?:her|his|its) power is (\d+) or greater$/.exec(line);
  if (power) {
    out.triggers.push({ event: "attacks", cond: { selfPowerAtLeast: Number(power[1]) }, effects: [{ type: "draw", amount: 1, who: { t: "you" } }], targets: [], text: line });
    return true;
  }
  if (/^whenever ~ attacks, if (?:he's|she's|it's) equipped, each opponent loses x life and you gain x life, where x is the number of equipment attached to (?:him|her|it)$/.test(line)) {
    const amount = { count: { kind: "equipmentOnSelf" as const } };
    out.triggers.push({ event: "attacks", cond: { selfEquipped: true }, effects: [{ type: "loseLife", amount, who: { t: "opp" } }, { type: "gainLife", amount, who: { t: "you" } }], targets: [], text: line });
    return true;
  }
  return false;
}

/** "You may activate abilities of creatures you control as though those creatures had haste." */
export function readHasteForAbilities(line: string, out: ParsedCard): boolean {
  if (line !== "you may activate abilities of creatures you control as though those creatures had haste") return false;
  out.hasteForAbilities = true;
  return true;
}

/** "Whenever one or more tokens you control enter, you may draw a card." */
export function readTokensEnter(line: string, out: ParsedCard): boolean {
  const m = /^whenever one or more tokens you control enter,? (?:you may )?(.+)$/.exec(line);
  return m ? trigger(out, line, "tokenEnters", m[1], { batch: true }) : false;
}

/** "Whenever a player or permanent becomes the target of an ability you control, draw a card." */
export function readAbilityTargets(line: string, out: ParsedCard): boolean {
  const m = /^whenever a player or permanent becomes the target of an ability you control,? (.+)$/.exec(line);
  return m ? trigger(out, line, "yourAbilityTargets", m[1]) : false;
}

/** Enrage: "Whenever ~ is dealt damage, put a +1/+1 counter on him. If he's attacking, untap him and there is an additional combat phase after this phase." (and Red Hulk's) */
export function readEnrage(line: string, out: ParsedCard): boolean {
  const m = /^whenever ~ is dealt damage,? (put a \+1\/\+1 counter on (?:him|~)\. (?:if he's attacking, untap him and there is an additional combat phase after this phase|when you do, ~ deals damage equal to the number of \+1\/\+1 counters on (?:him|~) to any other target))$/.exec(line);
  if (!m) return false;
  return trigger(out, line, "damaged", m[1].replace(/ on him\b/g, " on ~").replace(/\. when you do, /, ". "));
}

/** "Whenever a player draws their second card each turn, you draw a card." (King T'Challa) */
export function readAnyDrawSecond(line: string, out: ParsedCard): boolean {
  const m = /^whenever a player draws their second card each turn,? (.+)$/.exec(line);
  return m ? trigger(out, line, "anyDrawSecond", m[1]) : false;
}

/** "Prevent all damage that would be dealt to Black Panther." / "Your opponents can't cast spells during your turn." */
export function readDamagePrevention(line: string, out: ParsedCard): boolean {
  if (line === "prevent all damage that would be dealt to ~") out.preventDamageToSelf = true;
  else if (line === "players can't gain life") out.noLifeGain = true;
  else if (line === "damage can't be prevented") out.damageUnpreventable = true;
  else if (line === "your opponents can't cast spells during your turn") out.noOppSpellsOnYourTurn = true;
  else return false;
  return true;
}

/** "Whenever a creature you control is dealt damage, you may have ~ deal that much damage to any target. Do this only once each turn." (The Sensational She-Hulk) */
export function readAllyDamaged(line: string, out: ParsedCard): boolean {
  const m = /^whenever a creature you control is dealt damage, you may have ~ deal that much damage to any target(\. do this only once each turn)?$/.exec(line);
  if (!m) return false;
  out.triggers.push({ event: "allyDamaged", effects: [{ type: "damage", amount: "X", to: { t: "target", i: 0 } }], targets: [{ kind: "any", optional: true, label: "any target" }], text: line, ...(m[1] ? { oncePerTurn: true } : {}) });
  return true;
}

/** Iron Man: "At the beginning of combat on your turn, you may put an artifact card from your hand onto the battlefield. If it's an Equipment, attach it to ~." */
export function readIronManCombat(line: string, out: ParsedCard): boolean {
  if (line !== "at the beginning of combat on your turn, you may put an artifact card from your hand onto the battlefield. if it's an equipment, attach it to ~") return false;
  out.triggers.push({ event: "beginCombat", effects: [{ type: "putFromHand", subtype: "", maxMV: 99, elseDraw: false, cardType: "artifact", attach: true }], targets: [], text: line });
  return true;
}

/** "No One Dies! — When ~ enters, you may tap him. When you do, another target nonattacking creature you control gains indestructible until end of turn." (Spider-Man) */
export function readNoOneDies(line: string, out: ParsedCard): boolean {
  if (line !== "when ~ enters, you may tap him. when you do, another target nonattacking creature you control gains indestructible until end of turn") return false;
  out.triggers.push({
    event: "enters",
    effects: [
      {
        type: "mayPay",
        cost: "",
        prompt: "You may tap Spider-Man. If you do, another target nonattacking creature you control gains indestructible until end of turn.",
        then: [{ type: "tap", what: { t: "self" } }, { type: "grant", keyword: "indestructible", what: { t: "target", i: 0 } }],
        thenSpecs: [{ kind: "creature", controller: "you", other: true, filter: "notAttacking", label: "another target nonattacking creature you control" }],
      },
    ],
    targets: [],
    text: line,
  });
  return true;
}

/** "Whenever ~ attacks, you may pay {3}{B}. When you do, return target creature card from your graveyard to the battlefield tapped and attacking with a finality counter on it." (Grim Reaper) */
export function readGrimReaper(line: string, out: ParsedCard): boolean {
  if (line !== "whenever ~ attacks, you may pay {3}{B}. when you do, return target creature card from your graveyard to the battlefield tapped and attacking with a finality counter on it") return false;
  out.triggers.push({
    event: "attacks",
    effects: [
      {
        type: "mayPay",
        cost: "{3}{B}",
        then: [{ type: "reanimate", what: { t: "target", i: 0 }, to: "battlefield", tapped: true, finality: true, attacking: true }],
        thenSpecs: [{ kind: "graveyardCreature", controller: "you", label: "target creature card from your graveyard" }],
      },
    ],
    targets: [],
    text: line,
  });
  return true;
}

/** "At the beginning of the upkeep of enchanted creature's controller, that player draws a card." (Super Intelligence) */
export function readHostUpkeep(line: string, out: ParsedCard): boolean {
  if (line !== "at the beginning of the upkeep of enchanted creature's controller, that player draws a card") return false;
  out.triggers.push({ event: "hostUpkeep", effects: [{ type: "draw", amount: 1, who: { t: "you" } }], targets: [], text: line });
  return true;
}

/** Alien Invasion's beginning-of-combat ability. */
export function readAlienInvasion(line: string, out: ParsedCard): boolean {
  if (!/^at the beginning of combat on your turn, create a 1\/1 red alien creature token with haste and "~ attacks each combat if able\.?" put a \+1\/\+1 counter on it for each invasion counter on ~, then put an invasion counter on ~$/.test(line)) return false;
  out.triggers.push({ event: "beginCombat", effects: [{ type: "invasion" }], targets: [], text: line });
  return true;
}
