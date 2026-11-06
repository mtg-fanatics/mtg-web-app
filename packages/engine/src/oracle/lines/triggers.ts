import type { Effect, ParsedCard, TriggeredAbility } from "../../effects.js";
import { COLOR_OF, singularType } from "../words.js";
import { newCtx } from "../targets.js";
import { parseEffectText } from "../effectText.js";
import { interveningCond } from "../abilities.js";
import type { TriggerCond } from "../abilities.js";

// Triggered abilities. Each reader takes one line of a permanent's text and says whether it read it.

// "Whenever you gain life, put a +1/+1 counter on this creature."
/**
 * "Whenever an Island an opponent controls becomes tapped, you may gain 1 life." (Thoughtleech)
 * "Whenever an artifact an opponent controls becomes tapped or an opponent activates an artifact's ability without {T} in its activation cost, you gain 1 life." (Powerleech)
 */
export function readOpponentTapped(line: string, out: ParsedCard): boolean {
  const both = /^whenever an artifact an opponent controls becomes tapped or an opponent activates an artifact's ability without \{t\} in its activation cost,? (.+)$/i.exec(line);
  const one = /^whenever an? ([a-z]+) an opponent controls becomes tapped,? (.+)$/.exec(line);
  const m = both ?? one;
  if (!m) return false;
  const ctx = newCtx(true);
  const effects = parseEffectText((both ? m[1] : m[2]).replace(/^you may /, "you "), ctx);
  if (!effects || effects.length === 0) {
    out.unsupported.push(line);
    return true;
  }
  const subtype = both ? "artifact" : m[1];
  out.triggers.push({ event: "oppPermTapped", subtypes: [subtype], effects, targets: ctx.targets, text: line });
  if (both) out.triggers.push({ event: "oppArtifactAbility", effects, targets: ctx.targets, text: line });
  return true;
}

export function readLifeGainedTrigger(line: string, out: ParsedCard): boolean {
  const gain = /^whenever you gain life( for the first time each turn)?,? (.+)$/.exec(line);
  if (gain) {
    const ctx = newCtx(true);
    const effects = parseEffectText(gain[2].replace(/^it /, "~ ").replace(/ on it$/, " on ~"), ctx);
    if (effects && effects.length > 0) out.triggers.push({ event: "lifeGained", effects, targets: ctx.targets, text: line, ...(gain[1] ? { oncePerTurn: true } : {}) });
    else out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Landfall — Whenever a land you control enters, ..."
export function readLandfall(line: string, out: ParsedCard): boolean {
  const landfall = /^(?:landfall — )?whenever a land (?:you control enters|enters(?: the battlefield)? under your control),? (.+)$/.exec(line);
  if (landfall) {
    const ctx = newCtx(true);
    const effects = parseEffectText(landfall[1].replace(/^it /, "~ ").replace(/ on it$/, " on ~"), ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({ event: "landfall", effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Battalion — Whenever ~ and at least two other creatures attack, ..." / "Whenever you attack with two or more creatures, ..."
export function readAttackWithOthers(line: string, out: ParsedCard): boolean {
  const attackN = /^(?:battalion — )?whenever (~ and at least two other creatures attack|you attack with two or more creatures),? (.+)$/.exec(line);
  if (attackN) {
    const ctx = newCtx(true);
    const effects = parseEffectText(attackN[2].replace(/^it /, "~ ").replace(/ on it$/, " on ~"), ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({ event: attackN[1].startsWith("~") ? "battalion" : "attackTwo", effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

export function readBecomesTarget(line: string, out: ParsedCard): boolean {
  const allyTargeted = /^whenever a creature you control becomes the target of a (spell or ability an opponent controls|spell),? (.+)$/.exec(line);
  if (allyTargeted) {
    // "...put a +1/+1 counter on target creature you control other than that creature."
    const text = allyTargeted[2].replace(/(target creature you control) other than that creature/, "$1");
    const notOther = text !== allyTargeted[2];
    const ctx = newCtx(true);
    const effects = /\bthat creature\b/.test(text) ? null : parseEffectText(text, ctx);
    if (!effects || effects.length === 0) {
      out.unsupported.push(line);
      return true;
    }
    const targets = notOther ? ctx.targets.map((t) => (t.label === "target creature you control" ? { ...t, notOther: true, label: "target creature you control other than that creature" } : t)) : ctx.targets;
    out.triggers.push({ event: "allyTargeted", ...(allyTargeted[1] === "spell" ? { bySpell: true } : { byOpponent: true }), effects, targets, text: line });
    return true;
  }
  const targeted = /^when ~ becomes the target of a spell or ability,? (.+)$/.exec(line);
  if (targeted) {
    const ctx = newCtx(true);
    const effects = parseEffectText(targeted[1], ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({ event: "becomesTarget", effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Whenever you cast a noncreature spell, ..." / "...an instant or sorcery spell, ..."
export function readCastSpellTrigger(line: string, out: ParsedCard): boolean {
  const cast = /^whenever you cast (a noncreature|an instant or sorcery|a noncreature or ([a-z]+)) spell,? (.+)$/.exec(line);
  if (cast) {
    const ctx = newCtx(true);
    const effects = parseEffectText(cast[3].replace(/^it /, "~ ").replace(/ on it$/, " on ~"), ctx);
    if (effects && effects.length > 0) {
      const event = cast[1].startsWith("a noncreature") ? "noncreatureSpell" : "instantOrSorcery";
      out.triggers.push({ event, ...(cast[2] ? { orSpellSubtype: cast[2] } : {}), effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Whenever you draw your second card each turn, ..." / "Whenever you draw a card, ..."
export function readDrawCardTrigger(line: string, out: ParsedCard): boolean {
  const drawn = /^whenever you draw (your second card each turn|your fifth card each turn|a card),? (.+)$/.exec(line);
  if (drawn) {
    const ctx = newCtx(true);
    const effects = parseEffectText(drawn[2].replace(/^it /, "~ ").replace(/ on it$/, " on ~"), ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({ event: drawn[1] === "a card" ? "drawCard" : drawn[1].includes("fifth") ? "drawFifth" : "drawSecond", effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Whenever enchanted creature deals damage to an opponent, you may draw a card."
export function readEnchantedDealsDamage(line: string, out: ParsedCard): boolean {
  const hostDamage = /^whenever enchanted creature deals damage to an opponent,? (?:you may )?(.+)$/.exec(line);
  if (hostDamage) {
    const ctx = newCtx(true);
    const effects = parseEffectText(hostDamage[1], ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({ event: "hostDamagesPlayer", effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Pack tactics — Whenever ~ attacks, if you attacked with creatures with total power 6 or greater this combat, ..."
export function readPackTactics(line: string, out: ParsedCard): boolean {
  const pack = /^(?:pack tactics — )?whenever ~ attacks, if you attacked with creatures with total power (\d+) or greater this combat, (.+)$/.exec(line);
  if (pack) {
    const ctx = newCtx(true);
    const effects = parseEffectText(pack[2], ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({ event: "attacks", cond: { attackPowerAtLeast: Number(pack[1]) }, effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// ── turn structure: "At the beginning of your upkeep / each end step / combat on your turn, ..."
export function readBeginningOfStep(line: string, out: ParsedCard): boolean {
  const turn = /^at the beginning of (your upkeep|each upkeep|your end step|each end step|the end step|combat on your turn),? (.+)$/.exec(line);
  if (turn) {
    let rest = turn[2];
    let cond: TriggerCond = {};
    const intervening = /^if (.+?), (.+)$/.exec(rest);
    if (intervening) {
      const read = interveningCond(intervening[1]);
      if (!read) {
        out.unsupported.push(line);
        return true;
      }
      cond = read;
      rest = intervening[2];
    }
    if (cond.enchantedUntapped) rest = rest.replace(/^tap it$/, "tap enchanted creature");
    const may = /^you may have /.test(rest);
    rest = rest.replace(/^you may have (target creature) get /, "$1 gets ").replace(/^you may gain /, "you gain ");
    const ctx = newCtx(true);
    const effects = parseEffectText(rest, ctx);
    if (effects && effects.length > 0) {
      const event = ({ "your upkeep": "upkeep", "each upkeep": "upkeepEach", "your end step": "endStep", "each end step": "endStepEach", "the end step": "endStepEach", "combat on your turn": "beginCombat" } as const)[turn[1] as "your upkeep"];
      out.triggers.push({ event, effects, targets: ctx.targets.map((t) => (may ? { ...t, optional: true } : t)), text: line, ...(Object.keys(cond).length ? { cond } : {}) });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// ── "Whenever you cast a red spell, ..." / "Whenever you cast a Lesson spell, ...": a spell of that color or subtype
// Kor Firewalker: "Whenever a player casts a red spell, you may gain 1 life."
export function readCastKindSpell(line: string, out: ParsedCard): boolean {
  const m = /^whenever (you cast|a player casts) an? ([a-z]+) spell,? (.+)$/.exec(line);
  if (!m || ["noncreature", "instant", "creature", "nonland"].includes(m[2])) return false;
  const color = COLOR_OF[m[2]];
  if (m[1] === "a player casts" && !color) return false;
  const ctx = newCtx(true);
  const effects = parseEffectText(m[3].replace(/^it /, "~ ").replace(/ on it$/, " on ~").replace(/^you may gain /, "you gain "), ctx);
  if (effects && effects.length > 0) {
    const event = m[1] === "you cast" ? "youCast" : "anyCasts";
    out.triggers.push({ event, effects, targets: ctx.targets, text: line, ...(color ? { spellColor: color } : m[2] === "kicked" ? { spellKicked: true } : { spellSubtype: m[2] }) });
    return true;
  }
  out.unsupported.push(line);
  return true;
}

// ── "Whenever you cast a spell during an opponent's turn", "Whenever an opponent casts a spell, ..."
export function readAnySpellCast(line: string, out: ParsedCard): boolean {
  // Flurry: "whenever you cast your second spell each turn"
  const castAny = /^(?:flurry — )?whenever you cast (a|your first|your second) spell( each turn)?( during (?:an opponent's turn|each opponent's turn))?,? (.+)$/.exec(line);
  const oppCast = /^whenever an opponent casts a spell,? (.+)$/.exec(line);
  if (castAny || oppCast) {
    const body = (castAny ? castAny[4] : oppCast![1]).replace(/^it /, "~ ").replace(/ on it$/, " on ~");
    const ctx = newCtx(true);
    const effects = parseEffectText(body, ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({
        event: castAny ? "youCast" : "opponentCasts",
        effects,
        targets: ctx.targets,
        text: line,
        ...(castAny?.[3] ? { opponentTurnOnly: true } : {}),
        ...(castAny?.[1] === "your first" ? { firstOnly: true } : {}),
        ...(castAny?.[1] === "your second" ? { secondOnly: true } : {}),
      });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Whenever a Vampire you control dies, ..." / "Whenever this creature or another creature you control dies, ..."
export function readAllyDies(line: string, out: ParsedCard): boolean {
  // "whenever a nontoken creature you control dies" (Midnight Reaper), "another nontoken creature" (Spinner of Souls)
  const allyDies = /^whenever (~ or another|another|an?) (nontoken creature|creature|[a-z]+) you control dies,? (.+)$/.exec(line);
  if (allyDies) {
    const ctx = newCtx(true);
    const effects = parseEffectText(allyDies[3], ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({
        event: "allyDies",
        ...(allyDies[1] === "another" ? { other: true } : {}),
        ...(allyDies[2] === "nontoken creature" ? { nontoken: true } : allyDies[2] === "creature" ? {} : { subtypes: [allyDies[2]] }),
        effects,
        targets: ctx.targets,
        text: line,
      });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Whenever one or more +1/+1 counters are put on another non-Hydra creature you control, put a +1/+1 counter on this creature."
// and "Whenever you put one or more +1/+1 counters on this creature, draw a card."
export function readCountersPutOnAlly(line: string, out: ParsedCard): boolean {
  const countersOn = /^whenever one or more \+1\/\+1 counters are put on another (?:non-([a-z]+) )?creature you control,? (.+)$/.exec(line);
  const onSelf = /^whenever you put one or more \+1\/\+1 counters on ~,? (.+)$/.exec(line);
  if (!countersOn && !onSelf) return false;
  const ctx = newCtx(true);
  const effects = parseEffectText((countersOn ?? onSelf)![countersOn ? 2 : 1], ctx);
  if (!effects || effects.length === 0) {
    out.unsupported.push(line);
    return true;
  }
  if (onSelf) out.triggers.push({ event: "allyCountersAdded", selfOnly: true, effects, targets: ctx.targets, text: line });
  else out.triggers.push({ event: "allyCountersAdded", other: true, ...(countersOn![1] ? { notSubtype: countersOn![1] } : {}), effects, targets: ctx.targets, text: line });
  return true;
}

// ── "Whenever another creature (you control) enters / leaves the battlefield"
export function readAnotherCreatureEntersOrLeaves(line: string, out: ParsedCard): boolean {
  const anyEnter = /^whenever another( nontoken)? creature( you control)? enters(?: the battlefield)?,? (.+)$/.exec(line);
  const leaves = /^whenever another creature you control leaves the battlefield,? (.+)$/.exec(line);
  if ((anyEnter && !anyEnter[2]) || leaves) {
    const ctx = newCtx(true);
    const effects = parseEffectText((anyEnter ? anyEnter[3] : leaves![1]).replace(/^it /, "~ ").replace(/ on it$/, " on ~"), ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({ event: anyEnter ? "anyCreatureEnters" : "allyLeaves", effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// ── "Whenever ~ blocks or becomes blocked by a creature, ~ deals 1 damage to that creature."
// Wall of Frost: "Whenever ~ blocks a creature, that creature doesn't untap during its controller's next untap step."
export function readBlocksOrBlocked(line: string, out: ParsedCard): boolean {
  const blockedBy = /^whenever ~ (blocks or becomes blocked by|blocks) a creature,? (.+)$/.exec(line);
  if (blockedBy) {
    const ctx = newCtx(true);
    ctx.hasOther = true;
    const effects = parseEffectText(blockedBy[2], ctx);
    if (effects && effects.length > 0) {
      const events = blockedBy[1] === "blocks" ? (["blocks"] as const) : (["blocks", "blocked"] as const);
      for (const event of events) out.triggers.push({ event, effects, targets: ctx.targets, text: line, usesOther: true });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Whenever Mockingbird is dealt damage, put a +1/+1 counter on her." / "Whenever ~ or another nontoken creature dies, you create a 2/1 Villain token."
export function readDamageAndAnyDies(line: string, out: ParsedCard): boolean {
  const dealt = /^whenever ~ is dealt damage,? (.+)$/.exec(line);
  const dies = /^whenever (~ or )?another( nontoken)? creature dies,? (.+)$/.exec(line);
  if (!dealt && !dies) return false;
  const ctx = newCtx(true);
  const effects = parseEffectText((dealt ? dealt[1] : dies![3]).replace(/^you create /, "create "), ctx);
  if (effects && effects.length > 0) {
    out.triggers.push(
      dealt
        ? { event: "damaged", effects, targets: ctx.targets, text: line }
        : { event: "anyDies", ...(dies![1] ? {} : { other: true }), ...(dies![2] ? { nontoken: true } : {}), effects, targets: ctx.targets, text: line },
    );
    return true;
  }
  out.unsupported.push(line);
  return true;
}

export function readDamagedCreatureDies(line: string, out: ParsedCard): boolean {
  const damagedDies = /^whenever a creature dealt damage by ~ this turn dies,? (.+)$/.exec(line);
  if (damagedDies) {
    const ctx = newCtx(true);
    const effects = parseEffectText(damagedDies[1].replace(/^it /, "~ ").replace(/ on it$/, " on ~"), ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({ event: "damagedDies", effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Eerie — Whenever an enchantment you control enters and whenever you fully unlock a Room, ...": Rooms are two-part cards,
// which can't be played here, so only the enchantment half can happen.
export function readEerie(line: string, out: ParsedCard): boolean {
  const eerie = /^(?:eerie — )?whenever an enchantment you control enters(?: and whenever you fully unlock a room)?,? (.+)$/.exec(line);
  if (eerie) {
    const ctx = newCtx(true);
    const effects = parseEffectText(eerie[1], ctx);
    if (effects && effects.length > 0) out.triggers.push({ event: "allyEnters", enchantments: true, effects, targets: ctx.targets, text: line });
    else out.unsupported.push(line);
    return true;
  }
  return false;
}

export function readReturnWhenHostDies(line: string, out: ParsedCard): boolean {
  if (line === "when enchanted creature dies, return ~ to its owner's hand") {
    out.triggers.push({ event: "enchantedDies", effects: [{ type: "returnFromYard" }], targets: [], text: line });
    return true;
  }
  return false;
}

// "When this enters, tap X target creatures. Put a stun counter on each of those creatures you don't control." (X is what was paid for it)
export function readTapXOnEnter(line: string, out: ParsedCard): boolean {
  const tapX = /^when ~ enters, tap x target creatures(\. put a stun counter on each of those creatures you don't control)?$/.exec(line);
  if (tapX) {
    const effects: Effect[] = [{ type: "tap", what: { t: "target", i: 0 } }];
    if (tapX[1]) effects.push({ type: "stun", what: { t: "target", i: 0 }, theirsOnly: true });
    out.triggers.push({ event: "enters", xTargets: true, effects, targets: [{ kind: "creature", distinct: true, label: "target creature" }], text: line });
    return true;
  }
  return false;
}

export function readDiesReturnsToBattlefield(line: string, out: ParsedCard): boolean {
  if (line === "when ~ dies, if it was a creature, return it to the battlefield under its owner's control. it's an enchantment") {
    out.triggers.push({ event: "dies", cond: { wasCreature: true }, effects: [{ type: "returnAsEnchantment" }], targets: [], text: line });
    return true;
  }
  return false;
}

// "Whenever another creature you control enters, you gain 1 life." / "...with power 2 or less enters..."
export function readAllyEnters(line: string, out: ParsedCard): boolean {
  line = line.replace(/^(whenever (?:~ or )?(?:another|an?)(?: nontoken)? creature)(?: enters(?: the battlefield)? under your control)/, "$1 you control enters"); // "a creature enters the battlefield under your control"
  const ally =/^whenever (~ or )?(another|a)( nontoken)? creature you control(?: with power (\d+) or (less|greater))? enters(?: the battlefield)?,? (.+)$/.exec(line);
  const allyTyped = /^when(?:ever)? (~ or )?(?:another|an?)( nontoken)? ([a-z]+(?:(?:, or | or |, )[a-z]+)*) you control enters(?: the battlefield)?,? (.+)$/.exec(line);
  const creatureOrArtifact = allyTyped?.[3] === "creature or artifact"; // "~ or another creature or artifact you control"
  if (ally || (allyTyped && !/^(creature|nontoken creature)$/.test(allyTyped[3]))) {
    const ctx = newCtx(true);
    ctx.hasOther = true; // "that creature" is the one that entered
    ctx.itIsOther = true;
    const body = ally ? ally[6] : allyTyped![4];
    const effects = parseEffectText(body, ctx);
    if (effects && effects.length > 0) {
      const withSelf = (ally ? ally[1] : allyTyped![1]) !== undefined; // "~ or another": the permanent itself counts too
      out.triggers.push({
        event: "allyEnters",
        ...(withSelf || (ally && ally[2] === "a") ? {} : { other: true }),
        ...(ally?.[3] || allyTyped?.[2] ? { nontoken: true } : {}),
        ...(ally?.[4] ? (ally[5] === "less" ? { maxPower: Number(ally[4]) } : { minPower: Number(ally[4]) }) : {}),
        ...(/do this only once each turn$/.test(line) ? { oncePerTurn: true } : {}),
        ...(creatureOrArtifact ? { artifacts: true } : allyTyped && !ally ? { subtypes: allyTyped[3].split(/, or |, | or /).map((n) => singularType(n.trim())) } : {}),
        effects,
        targets: ctx.targets,
        text: line,
      });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

// "Whenever a Bat you control attacks, ...": once for each one that attacks.
export function readAllyAttacks(line: string, out: ParsedCard): boolean {
  const m = /^whenever an? ([a-z]+) you control attacks,? (.+)$/.exec(line);
  if (!m || m[1] === "creature" || m[1] === "commander") return false;
  const ctx = newCtx(true);
  ctx.hasOther = true; // "it" is the creature that attacks
  ctx.itIsOther = true;
  const effects = parseEffectText(m[2].replace(/ on it$/, " on that creature"), ctx);
  if (effects && effects.length > 0) out.triggers.push({ event: "allyAttacks", subtypes: [m[1]], effects, targets: ctx.targets, text: line });
  else out.unsupported.push(line);
  return true;
}

// A Case: "To solve — You've gained 5 or more life this turn." It is checked at the beginning of your end step (rule 702.169).
export function readToSolve(line: string, out: ParsedCard): boolean {
  const m = /^to solve — you've gained (\d+) or more life this turn$/.exec(line);
  if (!m) return false;
  out.triggers.push({ event: "endStep", cond: { lifeGainedAtLeast: Number(m[1]), unsolved: true }, effects: [{ type: "solve" }], targets: [], text: `To solve — You've gained ${m[1]} or more life this turn.` });
  return true;
}

// "Whenever one or more Goblins / creatures you control attack, ..." / "Whenever you attack, if a Pirate and a Vehicle attacked this combat, ..."
export function readYouAttack(line: string, out: ParsedCard): boolean {
  const youAttack = /^whenever (?:one or more ([a-z]+) you control attack(?: a player)?,?|you attack,) (.+)$/.exec(line);
  if (!youAttack) return false;
  let body = youAttack[2];
  const intervening = /^if (.+?), (.+)$/.exec(body);
  const cond = intervening ? interveningCond(intervening[1]) : null;
  if (cond) body = intervening![2];
  const ctx = newCtx(true);
  const effects = parseEffectText(body.replace(/^it /, "~ "), ctx);
  if (!effects || effects.length === 0) {
    out.unsupported.push(line);
    return true;
  }
  const subtype = youAttack[1] && youAttack[1] !== "creatures" ? { attackerSubtypes: [singularType(youAttack[1])] } : {};
  out.triggers.push({ event: "youAttack", ...subtype, ...(cond ? { cond } : {}), effects, targets: ctx.targets, text: line });
  return true;
}

// "Whenever you discard one or more cards, put that many +1/+1 counters on this creature.": once for each batch of cards; X is how many.
export function readYouDiscard(line: string, out: ParsedCard): boolean {
  const m = /^whenever you discard one or more cards,? (.+)$/.exec(line);
  if (!m) return false;
  const ctx = newCtx(true);
  const effects = parseEffectText(m[1].replace(/\bput that many \+1\/\+1 counters\b/, "put x +1/+1 counters"), ctx);
  if (effects && effects.length > 0) out.triggers.push({ event: "youDiscard", effects, targets: ctx.targets, text: line });
  else out.unsupported.push(line);
  return true;
}

// "Whenever one or more creatures your opponents control are dealt excess noncombat damage, create a Treasure token."
export function readExcessDamage(line: string, out: ParsedCard): boolean {
  const m = /^whenever one or more creatures your opponents control are dealt excess noncombat damage,? (.+)$/.exec(line);
  if (!m) return false;
  const ctx = newCtx(true);
  const effects = parseEffectText(m[1], ctx);
  if (effects && effects.length > 0) out.triggers.push({ event: "excessDamage", effects, targets: ctx.targets, text: line });
  else out.unsupported.push(line);
  return true;
}

// "When ~ enters, ...", "Whenever ~ attacks, ...", "When ~ dies, ..."
// "When ~ enters or becomes the target of a spell or ability an opponent controls, ..." is two triggers
export function readSelfTrigger(line: string, out: ParsedCard): boolean {
  const enterOrTargeted = /^when ~ enters or becomes the target of a spell or ability an opponent controls,? (.+)$/.exec(line);
  if (enterOrTargeted) {
    const ctx = newCtx(true);
    const effects = parseEffectText(enterOrTargeted[1], ctx);
    if (effects && effects.length > 0) {
      out.triggers.push({ event: "enters", effects, targets: ctx.targets, text: line }, { event: "becomesTarget", byOpponent: true, effects, targets: ctx.targets, text: line });
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}

export function readTrigger(line: string, out: ParsedCard): boolean {
  const trigger = /^(?:when(?:ever)?|as) ~ (enters(?: the battlefield)?|dies|is put into a graveyard from the battlefield|attacks|blocks|becomes blocked|deals combat damage to a player|deals damage to an opponent),? (.+)$/.exec(line);
  if (trigger) {
    const ctx = newCtx(true);
    const head = trigger[1];
    // "..., if you control an artifact or enchantment, ~ gets +1/+1": an "intervening if"
    const intervening = /^if (.+?), (.+)$/.exec(trigger[2]);
    const cond = intervening && !/^(?:it|~) was kicked$/.test(intervening[1]) ? interveningCond(intervening[1]) : null;
    if (cond) trigger[2] = intervening![2];
    const triggerCond = cond ? { cond } : {};
    const eventOf = (): TriggeredAbility["event"] =>
      head.startsWith("enters") ? "enters" : head === "dies" || head.startsWith("is put") ? "dies" : head === "attacks" ? "attacks" : head === "blocks" ? "blocks" : head === "becomes blocked" ? "blocked" : head === "deals damage to an opponent" ? "damageOpp" : "combatDamagePlayer";
    // "When this dies, return it to its owner's hand": the card is not on the battlefield any more.
    if (eventOf() === "dies" && /^return (?:it|~) to its owner's hand$/.test(trigger[2])) {
      out.triggers.push({ event: "dies", effects: [{ type: "returnFromYard" }], targets: [], text: line });
      return true;
    }
    // "When this enters, it deals 1 damage...": "it" is the creature itself.
    const wasKicked = /^if (?:it|~) was kicked, /.test(trigger[2]);
    // "...put a +1/+1 counter on it" is this creature, but "tap target creature and put a stun counter on it" is the target.
    const body = trigger[2].replace(/^if (?:it|~) was kicked, /, "").replace(/^it /, "~ ");
    const bodyText = /\btarget\b/.test(body) ? body : body.replace(/ on it$/, " on ~");
    let optionalTargets = false;
    let effects = parseEffectText(bodyText, ctx);
    if (!effects && /^you may /.test(bodyText)) {
      // "You may tap target creature" / "you may have it deal 1 damage to any target": the target is optional.
      const ctx2 = newCtx(true);
      const stripped = bodyText.replace(/^you may have it deal /, "~ deals ").replace(/^you may /, "");
      const again = parseEffectText(stripped, ctx2);
      if (again && ctx2.targets.length > 0) {
        effects = again;
        ctx.targets = ctx2.targets;
        optionalTargets = true;
      }
    }
    // "When this dies, exile it, then ...": the card is in the graveyard by then, which "it" can't reach yet.
    if (eventOf() === "dies" && effects?.some((e) => e.type === "exile" && e.what.t === "self")) effects = null;
    if (effects && effects.length > 0) {
      const event = eventOf();
      const ability: TriggeredAbility = { event, effects, targets: optionalTargets ? ctx.targets.map((t) => ({ ...t, optional: true })) : ctx.targets, text: line, ...triggerCond, ...(wasKicked ? { ifKicked: true } : {}) };
      out.triggers.push(ability);
      return true;
    }
    out.unsupported.push(line);
    return true;
  }
  return false;
}
