

// Helpers shared by combat (actions.ts) and the stack (stack.ts): reading permanents, moving cards between
// zones, dealing damage, running effects, and state-based actions.

export {
  colorsOfPerm,
  bindSpecs,
  canPrevent,
  cardMatches,
  countFor,
  dynamicCount,
  entersTappedNow,
  findPermanent,
  findPermanentOrNull,
  forbidden,
  gainedKeywords,
  hasDelirium,
  isArtifactDef,
  handLimit,
  isCreature,
  keywordsNow,
  isEnchantmentDef,
  isPermanentCard,
  isPlaneswalker,
  isProtectedFrom,
  kw,
  lethalFor,
  nameOf,
  newId,
  onBoard,
  playerLabel,
  playerToAct,
  powerOf,
  qualityOfDef,
  qualityOfPerm,
  shiftTargets,
  staticEffectsOn,
  subtypesOf,
  toughnessOf,
  yardCardTypes,
} from "./core/permanents.js";
export {
  addPoison,
  changeLife,
  counterStackItem,
  drawCards,
  exilePlayable,
  exilePlayTerms,
  isToken,
  makeToken,
  onLifeGained,
  putCounters,
  makeTokenCopy,
  putIntoGraveyard,
  sacrificePermanent,
  regenerateInstead,
  removeFromBattlefield,
  spellLeavesStack,
  tapPerm,
} from "./core/zones.js";
export { askAsEnters, cardsDiscarded, creatureEntered, creatureDamaged, landEntered, queueChapters, queueDamageDraws, queueTriggers, queueWard, spellCast, wardOf } from "./core/triggers.js";
export { isLegalTarget, legalTargets } from "./core/targets.js";
export { runEffects } from "./core/runEffects.js";
export { dealDamage } from "./core/handlers/shared.js";
export { checkStateBasedActions } from "./core/sba.js";

export type { RunContext } from "./effects.js";
