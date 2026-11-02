import type { ParsedCard } from "../effects.js";
import { readWard, readToxic, readProtection, readKeywordLine, readNoRulesEffect, readLandwalk, readAttacksEachCombat, readBlockedOnlyBy, readBlockedByOneAtMost, readCantBlock, readBlockedByPower, readAttackOnlyIfDefenderHas, readAttackOnlyWithMoreCreatures, readBlockOnlyWithMoreCreatures, readUnblockableByColor, readCreaturesAttackEachCombat, readTypeAttacksEachCombat, readAllMustBlock, readBlocksOnlyFlyers, readCantAttackOrBlockAlone, readUnblockable } from "./lines/keywords.js";
import { readStatsEqualToCount, readAuraTarget, readDeliriumStatic, readAbilityWordStatic, readStaticAbility, readCostLessIfYouControl, readIfDrawnCards, readTypedSpellsCostLess, readSpellTax, readCheaperOnOtherTurns, readBigSpellsCostLess, readDuringYourTurn, readAsLongAsYouControl, readWhileAttacking, readAttackingAnthem, readPowerEqualToCount, readTargetingTax, readEnteredThisTurnStatic, readGrantedLandMana, readHostBecomes, readTappedCreaturesHave, readLifeTotalStatic, readTwoTypeLord, readLord, readIgnoresHexproof } from "./lines/statics.js";
import { readEntersWithCounters, readEntersWithMinusCounters, readKickedCounters, readChooseColorOnEnter, readOthersEnterWithCounters, readEntersTappedUnless, readPreventNoncombatDamage, readGrantsLifeGainCounters, readDrawsTwoInstead, readGainLifePlusOne, readGainTwiceLife, readEntersPrepared, readEntersTapped, readShockLand } from "./lines/entering.js";
import { readOpponentTapped, readLifeGainedTrigger, readLandfall, readAttackWithOthers, readBecomesTarget, readCastSpellTrigger, readDrawCardTrigger, readEnchantedDealsDamage, readPackTactics, readBeginningOfStep, readAnySpellCast, readCastKindSpell, readAllyDies, readCountersPutOnAlly, readAnotherCreatureEntersOrLeaves, readBlocksOrBlocked, readDamagedCreatureDies, readDamageAndAnyDies, readEerie, readReturnWhenHostDies, readTapXOnEnter, readDiesReturnsToBattlefield, readAllyEnters, readYouAttack, readYouDiscard, readExcessDamage, readSelfTrigger, readTrigger, readAllyAttacks, readToSolve } from "./lines/triggers.js";
import { readLoyaltyAbility, readCrew, readEquip, readSacrificeForMana, readLandcycling, readActivatedAbility, readRestrictedMana, readSolvedAbility } from "./lines/activated.js";

import { readCumulativeUpkeep, readEcho } from "./upkeepParts.js";
import { readDiscardedByOpponent, readGoblinKing, readHostControl, readHostDamageLife, readReduceDamage } from "./lines/theme.js";
import { readSacrificeTrigger, readFirebending, readCreatureLandWithTrigger, readTappedIfMoreLands } from "./lines/sacrifice.js";
import { readKeywordLord, readCreatureSpellCast } from "./lines/infect.js";
import { readUndying, readCostLessByPower } from "./lines/green.js";
import { readEntersStunned, readYouTapOpp, readPersist } from "./lines/stun.js";
import { readOppCreatureDies } from "./lines/wipe.js";
import { MARVEL_ABILITY_WORD, readAttacksAlone, readExalted, readChapter, readEquippedAttacks, readAbilityTargets, readAlienInvasion, readAllyDamaged, readGrimReaper, readHostUpkeep, readNoOneDies, readAnyDrawSecond, readDamagePrevention, readEnrage, readIronManCombat, readAllyTapped, readAttackConditions, readHasteForAbilities, readTokensEnter, readBecomesTapped, readControlsArtifactCreatureOrPlan, readScarletWitchDiscount, readTokenAndCounterLords, readUnblockableIfSmall, readVillainOrArtifactEnters, readCountersPlusOne, readCounteredThisTurn, readEntersGreater, readHandSize, readPlanThreshold, readSpellTargetsTrigger, readTeamworkTrigger, readYardCondition, readYouPutCounters } from "./lines/marvel.js";

// One line of a permanent's text: a keyword, a triggered, activated or static ability, an aura or equipment line.
// Each kind of line has a reader in lines/.

/** The readers in the order they are tried. The first one that reads the line wins, so a more specific sentence must come before a general one. */
const READERS: ((line: string, out: ParsedCard) => boolean)[] = [
  readLoyaltyAbility,
  readReduceDamage,
  readEcho,
  readCumulativeUpkeep,
  readHostDamageLife,
  readHostControl,
  readGoblinKing,
  readDiscardedByOpponent,
  readSacrificeTrigger,
  readKeywordLord,
  readCreatureSpellCast,
  readUndying,
  readCostLessByPower,
  readEntersStunned,
  readYouTapOpp,
  readPersist,
  readOppCreatureDies,
  readFirebending,
  readCreatureLandWithTrigger,
  readTappedIfMoreLands,
  readTeamworkTrigger,
  readPlanThreshold,
  readChapter,
  readYardCondition,
  readDeliriumStatic,
  readAbilityWordStatic,
  readNoOneDies,
  readGrimReaper,
  readHostUpkeep,
  readAlienInvasion,
  readEnrage,
  readAnyDrawSecond,
  readDamagePrevention,
  readAllyDamaged,
  readIronManCombat,
  readHasteForAbilities,
  readTokensEnter,
  readAbilityTargets,
  readTokenAndCounterLords,
  readUnblockableIfSmall,
  readControlsArtifactCreatureOrPlan,
  readScarletWitchDiscount,
  readVillainOrArtifactEnters,
  readAttackConditions,
  readCountersPlusOne,
  readHandSize,
  readCounteredThisTurn,
  readEntersGreater,
  readSpellTargetsTrigger,
  readBecomesTapped,
  readAllyTapped,
  readYouPutCounters,
  readAttacksAlone,
  readExalted,
  readEquippedAttacks,
  readWard,
  readToxic,
  readOpponentTapped,
  readLifeGainedTrigger,
  readLandfall,
  readProtection,
  readStatsEqualToCount,
  readAuraTarget,
  readStaticAbility,
  readKeywordLine,
  readEntersWithCounters,
  readNoRulesEffect,
  readCrew,
  readLandwalk,
  readAttacksEachCombat,
  readEquip,
  readSacrificeForMana,
  readEntersWithMinusCounters,
  readKickedCounters,
  readChooseColorOnEnter,
  readOthersEnterWithCounters,
  readBlockedOnlyBy,
  readBlockedByOneAtMost,
  readCantBlock,
  readCostLessIfYouControl,
  readIfDrawnCards,
  readAttackWithOthers,
  readBecomesTarget,
  readEntersTappedUnless,
  readShockLand,
  readBlockedByPower,
  readAttackOnlyIfDefenderHas,
  readCastSpellTrigger,
  readLandcycling,
  readDrawCardTrigger,
  readAttackOnlyWithMoreCreatures,
  readBlockOnlyWithMoreCreatures,
  readUnblockableByColor,
  readTypedSpellsCostLess,
  readSpellTax,
  readCheaperOnOtherTurns,
  readBigSpellsCostLess,
  readDuringYourTurn,
  readAsLongAsYouControl,
  readWhileAttacking,
  readAttackingAnthem,
  readEnchantedDealsDamage,
  readPackTactics,
  readCreaturesAttackEachCombat,
  readTypeAttacksEachCombat,
  readPowerEqualToCount,
  readTargetingTax,
  readBeginningOfStep,
  readAnySpellCast,
  readCastKindSpell,
  readAllyDies,
  readCountersPutOnAlly,
  readAnotherCreatureEntersOrLeaves,
  readBlocksOrBlocked,
  readPreventNoncombatDamage,
  readGrantsLifeGainCounters,
  readDrawsTwoInstead,
  readGainLifePlusOne,
  readGainTwiceLife,
  readEnteredThisTurnStatic,
  readGrantedLandMana,
  readHostBecomes,
  readTappedCreaturesHave,
  readLifeTotalStatic,
  readTwoTypeLord,
  readLord,
  readAllMustBlock,
  readDamageAndAnyDies,
  readDamagedCreatureDies,
  readBlocksOnlyFlyers,
  readCantAttackOrBlockAlone,
  readEerie,
  readReturnWhenHostDies,
  readTapXOnEnter,
  readDiesReturnsToBattlefield,
  readEntersPrepared,
  readAllyEnters,
  readAllyAttacks,
  readYouAttack,
  readYouDiscard,
  readExcessDamage,
  readUnblockable,
  readEntersTapped,
  readSelfTrigger,
  readEitherTrigger,
  readTrigger,
  readIgnoresHexproof,
  readToSolve,
  readRestrictedMana,
  readSolvedAbility,
  readActivatedAbility,
];

export function parseCreatureLine(rawLine: string, out: ParsedCard): void {
  // "... This ability triggers only once each turn.": read the line without it, then mark the triggers it produced.
  const once = /\.? this ability triggers only once each turn\.?$/.exec(rawLine);
  if (once) {
    const before = out.triggers.length;
    // Only once each turn, "whenever one or more other creatures ... enter" is the same as "whenever another creature ... enters".
    const head = rawLine
      .slice(0, once.index)
      .replace(/^whenever one or more other creatures you control( with power \d+ or less)? enter,/, "whenever another creature you control$1 enters,")
      .replace(/^whenever one or more creatures you control die,/, "whenever a creature you control dies,");
    parseCreatureLine(head, out);
    for (let i = before; i < out.triggers.length; i++) out.triggers[i] = { ...out.triggers[i], oncePerTurn: true };
    return;
  }
  // "When The Sackville-Bagginses enter": a name that is plural
  const line = rawLine.replace(/\.$/, "").replace(/^(?:raid|opus|channel|undergrowth|threshold|hellbent|metalcraft|morbid) — /, "").replace(/^when ~ enter,/, "when ~ enters,").replace(MARVEL_ABILITY_WORD, "");

  for (const read of READERS) if (read(line, out)) return;
  out.unsupported.push(line);
}

// "When this creature enters or dies, mill two cards.": two triggers with the same effect
function readEitherTrigger(line: string, out: ParsedCard): boolean {
  const either = /^when(?:ever)? ~ (enters|attacks) or (dies|attacks),? (.+)$/.exec(line);
  if (either && either[1] !== either[2]) {
    const before = out.triggers.length;
    parseCreatureLine(`when ~ ${either[1]}, ${either[3]}`, out);
    parseCreatureLine(`whenever ~ ${either[2]}, ${either[3]}`, out);
    if (out.triggers.length === before + 2) out.triggers[before].text = out.triggers[before + 1].text = line;
    return true;
  }
  return false;
}
