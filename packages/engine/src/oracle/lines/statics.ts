import type { ParsedCard, StaticEffect } from "../../effects.js";
import { CARD_TYPES, keywordList, parseCount, singularType, toNumber } from "../words.js";
import { AURA_TARGETS, parseStatic, selfStatic } from "../abilities.js";

// Static abilities: power and toughness, costs, conditions and lords. Each reader takes one line of a permanent's text and says whether it read it.

export function readStatsEqualToCount(line: string, out: ParsedCard): boolean {
  if (line === "~'s power and toughness are each equal to the greatest mana value among cards in your graveyard") {
    out.dynamicStats = { kind: "greatestMVYard" };
    return true;
  }
  const cda = /^~'s power and toughness are each equal to the number of (.+)$/.exec(line);
  const count = cda ? parseCount(cda[1]) : null;
  if (count) {
    out.dynamicStats = count;
    return true;
  }
  return false;
}

export function readAuraTarget(line: string, out: ParsedCard): boolean {
  if (AURA_TARGETS[line]) {
    out.aura = AURA_TARGETS[line];
    return true;
  }
  return false;
}

// Delirium: "as long as there are four or more card types among cards in your graveyard, ~ gets +2/+2, has flying, and attacks each combat if able"
export function readDeliriumStatic(line: string, out: ParsedCard): boolean {
  const m = /^(?:delirium — )?as long as there are four or more card types among cards in your graveyard, ~ (.+)$/.exec(line);
  if (!m) return false;
  const mustAttack = /,? and attacks each combat if able$/.test(m[1]);
  const st = selfStatic(`~ ${m[1].replace(/,? and attacks each combat if able$/, "").replace(/, has /, " and has ")}`);
  if (!st) {
    out.unsupported.push(line);
    return true;
  }
  (out.statics ??= []).push({ ...st, cond: { delirium: true }, ...(mustAttack ? { mustAttack: true } : {}) });
  return true;
}

export function readStaticAbility(line: string, out: ParsedCard): boolean {
  const staticEffect = parseStatic(line);
  if (staticEffect) {
    (out.statics ??= []).push(staticEffect);
    return true;
  }
  return false;
}

export function readCostLessIfYouControl(line: string, out: ParsedCard): boolean {
  const reduction = /^~ costs \{(\d+)\} less to cast if you control an? ([a-z]+)$/.exec(line);
  if (reduction) {
    out.costReduction = { n: Number(reduction[1]), ifControl: reduction[2] };
    return true;
  }
  return false;
}

// Nowhere to Run
export function readIgnoresHexproof(line: string, out: ParsedCard): boolean {
  if (line !== "creatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. ward abilities of those creatures don't trigger") return false;
  out.ignoresHexproof = true;
  return true;
}

// "~ gets +1/+1 as long as you've drawn two or more cards this turn" / "~ can't be blocked as long as ..."
export function readIfDrawnCards(line: string, out: ParsedCard): boolean {
  const drawnCond = /^~ (gets ([+-]\d+)\/([+-]\d+)|can't be blocked) as long as you've drawn (two|three|four|\d+) or more cards this turn$/.exec(line);
  if (drawnCond) {
    const st: StaticEffect = { scope: "self", power: 0, toughness: 0, keywords: [], cond: { drawnAtLeast: toNumber(drawnCond[4]) ?? 2 } };
    if (drawnCond[2]) {
      st.power = Number(drawnCond[2]);
      st.toughness = Number(drawnCond[3]);
    } else st.unblockable = true;
    (out.statics ??= []).push(st);
    return true;
  }
  return false;
}

// Permanents that make your spells cheaper
export function readTypedSpellsCostLess(line: string, out: ParsedCard): boolean {
  // "Instant and sorcery spells you cast cost {1} less to cast." (Mocking Sprite, Archmage of Runes)
  const spells = /^instant and sorcery spells you cast cost \{(\d+)\} less to cast$/.exec(line);
  if (spells) {
    (out.costMods ??= []).push({ n: Number(spells[1]), instantSorceryOnly: true });
    return true;
  }
  // "Kithkin spells and Soldier spells you cast cost {1} less to cast." (Ballyrush Banneret)
  const two = /^([a-z]+) spells and ([a-z]+) spells you cast cost \{(\d+)\} less to cast$/.exec(line);
  if (two) {
    (out.costMods ??= []).push({ n: Number(two[3]), subtypes: [singularType(two[1]), singularType(two[2])] });
    return true;
  }
  const typedSpells = /^([a-z]+) spells you cast cost \{(\d+)\} less to cast$/.exec(line);
  if (typedSpells) {
    (out.costMods ??= []).push({ n: Number(typedSpells[2]), subtype: singularType(typedSpells[1]) });
    return true;
  }
  return false;
}

/** "White spells you cast cost {W} more to cast." */
export function readSpellTax(line: string, out: ParsedCard): boolean {
  const m = /^(white|blue|black|red|green) spells you cast cost \{([wubrgWUBRG])\} more to cast$/.exec(line);
  if (!m) return false;
  (out.spellTax ??= []).push({ color: m[2].toUpperCase(), extra: m[2].toUpperCase() });
  return true;
}

export function readCheaperOnOtherTurns(line: string, out: ParsedCard): boolean {
  const otherTurns = /^during turns other than yours, spells you cast cost \{(\d+)\} less to cast$/.exec(line);
  if (otherTurns) {
    (out.costMods ??= []).push({ n: Number(otherTurns[1]), otherTurn: true });
    return true;
  }
  return false;
}

export function readBigSpellsCostLess(line: string, out: ParsedCard): boolean {
  const bigSpells = /^spells you cast with mana value (\d+) or greater cost \{(\d+)\} less to cast and can't be countered$/.exec(line);
  if (bigSpells) {
    (out.costMods ??= []).push({ n: Number(bigSpells[2]), minMV: Number(bigSpells[1]) });
    out.uncounterableMinMV = Number(bigSpells[1]);
    return true;
  }
  return false;
}

// "During your turn, ~ has first strike." / "During your turn, equipped creature gets +2/+0 and has first strike."
export function readDuringYourTurn(line: string, out: ParsedCard): boolean {
  const yourTurn = /^during your turn, (.+)$/.exec(line);
  const yourTurnStatic = yourTurn ? selfStatic(yourTurn[1]) ?? parseStatic(yourTurn[1]) : null;
  if (yourTurnStatic) {
    (out.statics ??= []).push({ ...yourTurnStatic, cond: { yourTurn: true } });
    return true;
  }
  return false;
}

// "As long as you control a Dragon, ~ has flying." / "~ has flying as long as it's attacking."
export function readAsLongAsYouControl(line: string, out: ParsedCard): boolean {
  const controlsFirst = /^as long as you control an? ([a-z]+), (.+)$/.exec(line);
  const controlsStatic = controlsFirst && !CARD_TYPES.includes(controlsFirst[1]) ? selfStatic(controlsFirst[2]) : null;
  if (controlsStatic) {
    (out.statics ??= []).push({ ...controlsStatic, cond: { controls: controlsFirst![1] } });
    return true;
  }
  return false;
}

export function readWhileAttacking(line: string, out: ParsedCard): boolean {
  const whileAttacking = /^(.+?) as long as it's attacking$/.exec(line) ?? /^as long as ~ is attacking, (.+)$/.exec(line);
  const attackingStatic = whileAttacking ? selfStatic(whileAttacking[1]) : null;
  if (attackingStatic) {
    (out.statics ??= []).push({ ...attackingStatic, cond: { attacking: true } });
    return true;
  }
  return false;
}

// "Attacking creatures you control get +1/+0."
export function readAttackingAnthem(line: string, out: ParsedCard): boolean {
  const attackAnthem = /^attacking creatures you control get ([+-]\d+)\/([+-]\d+)$/.exec(line);
  if (attackAnthem) {
    (out.statics ??= []).push({ scope: "yours", attackingOnly: true, power: Number(attackAnthem[1]), toughness: Number(attackAnthem[2]), keywords: [] });
    return true;
  }
  return false;
}

// "Syr Elenora's power is equal to the number of cards in your hand." / the tax on spells that target her
export function readPowerEqualToCount(line: string, out: ParsedCard): boolean {
  const powerCount = /^~'s power is equal to the number of (.+)$/.exec(line);
  if (powerCount && parseCount(powerCount[1])) {
    out.dynamicStats = parseCount(powerCount[1])!;
    return true;
  }
  return false;
}

export function readTargetingTax(line: string, out: ParsedCard): boolean {
  const tax = /^spells your opponents cast that target ~ cost \{(\d+)\} more to cast$/.exec(line);
  if (tax) {
    out.targetTax = Number(tax[1]);
    return true;
  }
  return false;
}

// "As long as this Aura entered this turn, enchanted creature has hexproof."
export function readEnteredThisTurnStatic(line: string, out: ParsedCard): boolean {
  const fresh = /^as long as ~ entered this turn, (.+)$/.exec(line);
  const freshStatic = fresh ? parseStatic(fresh[1]) : null;
  if (freshStatic) {
    (out.statics ??= []).push({ ...freshStatic, cond: { enteredThisTurn: true } });
    return true;
  }
  return false;
}

// The mana ability an Aura gives its land is read when mana is paid (mana.ts).
export function readGrantedLandMana(line: string, out: ParsedCard): boolean {
  if (/^enchanted land has "\{T\}: add two mana of any one color\.?"$/.test(line)) return true;
  return false;
}

export function readHostBecomes(line: string, out: ParsedCard): boolean {
  const becomes = /^enchanted creature loses all abilities and is an? (white|blue|black|red|green) ([a-z]+) creature with base power and toughness (\d+)\/(\d+)$/.exec(line);
  if (becomes) {
    const color = ({ white: "W", blue: "U", black: "B", red: "R", green: "G" } as const)[becomes[1] as "white"];
    out.hostBecomes = { subtype: becomes[2], color, power: Number(becomes[3]), toughness: Number(becomes[4]) };
    return true;
  }
  return false;
}

export function readTappedCreaturesHave(line: string, out: ParsedCard): boolean {
  // "Tapped creatures you control have hexproof." / "Other untapped creatures you control have hexproof."
  const tappedGrant = /^(other )?(tapped|untapped) creatures you control have (.+)$/.exec(line);
  const tappedKeywords = tappedGrant ? keywordList(tappedGrant[3]) : null;
  if (tappedGrant && tappedKeywords) {
    (out.statics ??= []).push({ scope: "yours", ...(tappedGrant[2] === "tapped" ? { tappedOnly: true } : { untappedOnly: true }), ...(tappedGrant[1] ? { other: true } : {}), power: 0, toughness: 0, keywords: tappedKeywords });
    return true;
  }
  return false;
}

// ── statics that depend on your life total: "~ gets +2/+2 as long as you have 25 or more life"
export function readLifeTotalStatic(line: string, out: ParsedCard): boolean {
  const lifeCond = (text: string): StaticEffect["cond"] | null => {
    let m4: RegExpExecArray | null;
    if ((m4 = /^you have (\d+) or more life$/.exec(text))) return { lifeAtLeast: Number(m4[1]) };
    if ((m4 = /^you have at least (\d+) life more than your starting life total$/.exec(text))) return { lifeAtLeast: 20 + Number(m4[1]) };
    if (text === "your life total is greater than or equal to your starting life total") return { lifeAtLeast: 20 };
    if (text === "you've lost life this turn") return { lostLife: true };
    return null;
  };
  const before = /^as long as (.+?), (.+)$/.exec(line);
  const after = /^(.+?) as long as (you have .+|your life total is .+|you've lost life this turn)$/.exec(line);
  const lifeStatic = before && lifeCond(before[1]) ? { cond: lifeCond(before[1])!, body: before[2] } : after && lifeCond(after[2]) ? { cond: lifeCond(after[2])!, body: after[1] } : null;
  if (lifeStatic) {
    const st = selfStatic(lifeStatic.body) ?? parseStatic(lifeStatic.body);
    if (st) {
      (out.statics ??= []).push({ ...st, cond: lifeStatic.cond });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// ── lords of a creature type: "Other Minotaur creatures you control get +1/+1 and have trample"
// "Skeletons you control and other Zombies you control get +1/+1 and have deathtouch.": Death Baron itself is a Zombie, so it's left out.
export function readTwoTypeLord(line: string, out: ParsedCard): boolean {
  const twoLords = /^([a-z]+) you control and other ([a-z]+) you control ((?:get|have) .+)$/.exec(line);
  const twoLordsStatic = twoLords ? parseStatic(`creatures you control ${twoLords[3]}`) : null;
  if (twoLordsStatic) {
    (out.statics ??= []).push({ ...twoLordsStatic, other: true, subtypes: [singularType(twoLords![1]), singularType(twoLords![2])] });
    return true;
  }
  return false;
}

export function readLord(line: string, out: ParsedCard): boolean {
  const lord = /^(other )?(attacking )?([a-z]+(?:(?:, and |, | and )[a-z]+)*)(?: creatures)? you control ((?:get|have) .+)$/.exec(line);
  if (lord && !/^(creatures|nonland permanents|permanents)$/.test(lord[3])) {
    const names = lord[3].split(/, and |, | and /).map((n) => singularType(n.trim()));
    const st = parseStatic(`creatures you control ${lord[4]}`);
    if (st) {
      (out.statics ??= []).push({ ...st, ...(lord[1] ? { other: true } : {}), ...(lord[2] ? { attackingOnly: true } : {}), subtypes: names });
      return true;
    }
  }
  return false;
}

// Threshold, hellbent, metalcraft: "as long as there are seven or more cards in your graveyard, ~ gets +2/+2", "~ has double strike as long as you have no cards in hand"
const STATIC_COND = "there are seven or more cards in your graveyard|you have no cards in hand|you control three or more artifacts";
const STATIC_COND_OF = (text: string): NonNullable<StaticEffect["cond"]> => (/graveyard/.test(text) ? { yardAtLeast: 7 } : /no cards in hand/.test(text) ? { handEmpty: true } : { artifactsAtLeast: 3 });
export function readAbilityWordStatic(line: string, out: ParsedCard): boolean {
  const m = new RegExp(`^(?:(?:threshold|hellbent|metalcraft) — )?(?:as long as (${STATIC_COND}), (.+)|(.+?) as long as (${STATIC_COND}))$`).exec(line);
  if (!m) return false;
  const cond = STATIC_COND_OF(m[1] ?? m[4]);
  // ("an additional +2/+0" is just +2/+0 on top)
  const body = (m[2] ?? m[3]).replace(" gets an additional ", " gets ").replace(" get an additional ", " get ");
  const st = body.startsWith("~ ") ? selfStatic(body) : parseStatic(body);
  if (!st) return false;
  (out.statics ??= []).push({ ...st, cond });
  return true;
}

/** "~ doesn't untap during your untap step." (Grim Monolith, Jasconian Isle: it stays tapped until something untaps it) */
export function readSelfNoUntap(line: string, out: ParsedCard): boolean {
  if (line !== "~ doesn't untap during your untap step") return false;
  (out.statics ??= []).push({ scope: "self", power: 0, toughness: 0, keywords: [], noUntap: true });
  return true;
}
