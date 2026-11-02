import { checkStateBasedActions, drawCards, forbidden, handLimit, newId, queueChapters, queueTriggers } from "../core.js";
import { getCard } from "../cards.js";
import { parseCard } from "../oracle.js";
import { OPPONENT } from "../types.js";
import type { CardDef, GameState, PlayerState } from "../types.js";
import type { GameEvent } from "../actions.js";
import type { Effect } from "../effects.js";

// Moving through the turn: the next phase, the end of the turn and the start of the next one.

/** Untap, upkeep and draw are automatic, so a player only stops in main1, attackers, blockers, damage, main2, end or cleanup. */
export function advancePhase(state: GameState, events: GameEvent[]): void {
  switch (state.phase) {
    case "main1":
      if (extraCombatAfterMain(state, "attackers")) break;
      if (state.players[state.active].skipCombat === state.turn) {
        // "Skips all combat phases of their next turn" (False Peace)
        state.players[state.active].skipCombat = undefined;
        state.phase = "main2";
        break;
      }
      state.phase = "attackers";
      // "At the beginning of combat on your turn"
      for (const perm of state.players[state.active].battlefield) queueTriggers(state, perm.card, state.active, "beginCombat");
      break;
    case "attackers":
      state.phase = "main2"; // reached only when nobody attacks
      break;
    case "main2":
      if (extraCombatAfterMain(state, "end")) break;
      state.phase = "end";
      // "At the beginning of your end step" / "of each end step"
      for (const owner of Object.values(state.players)) {
        for (const perm of owner.battlefield) queueTriggers(state, perm.card, owner.id, owner.id === state.active ? "endStep" : "endStepEach");
      }
      for (const perm of state.players[state.active].battlefield) queueTriggers(state, perm.card, state.active, "endStepEach");
      queueWarpExiles(state);
      queueEndStepSacrifices(state);
      break;
    case "end":
      // Cleanup step (rule 514.1): discard down to the maximum hand size.
      if (state.players[state.active].hand.length > handLimit(state, state.active)) {
        state.phase = "cleanup";
        break;
      }
      startNextTurn(state, events);
      return;
    default:
      return;
  }
  events.push({ type: "phaseChanged", phase: state.phase });
}

/**
 * Relentless Assault: when a main phase ends and an additional combat phase and main phase are waiting, they come now, then the turn goes on with what it was
 * about to do (`resume`: the regular combat, or the end step). True if the turn went into one of them (the phase is set).
 */
function extraCombatAfterMain(state: GameState, resume: "attackers" | "end"): boolean {
  const beginCombat = () => {
    state.phase = "attackers";
    for (const perm of state.players[state.active].battlefield) queueTriggers(state, perm.card, state.active, "beginCombat");
  };
  if (state.extraStep === "main") {
    // the additional main phase is over
    if ((state.extraCombatMain ?? 0) > 0) {
      state.extraCombatMain = (state.extraCombatMain ?? 1) - 1; // (a second Relentless Assault: another round)
      beginCombat();
      return true;
    }
    const back = state.extraResume;
    state.extraStep = undefined;
    state.extraResume = undefined;
    if (back === "attackers") {
      beginCombat();
      return true;
    }
    return false;
  }
  if ((state.extraCombatMain ?? 0) > 0) {
    state.extraCombatMain = (state.extraCombatMain ?? 1) - 1;
    state.extraStep = "main";
    state.extraResume = resume;
    beginCombat();
    return true;
  }
  return false;
}

/** Warp: "exile this creature at the beginning of the next end step". */
function queueWarpExiles(state: GameState): void {
  for (const owner of Object.values(state.players)) {
    for (const perm of owner.battlefield) {
      if (!perm.warped) continue;
      const name = state.cards[perm.card.defId].name;
      const text = "Warp: exile this at the beginning of the next end step. You may cast it from exile on a later turn.";
      state.triggerQueue.push({ specs: [], item: { kind: "ability", id: newId(state), controller: owner.id, source: perm.card.iid, sourceName: name, effects: [{ type: "warpExile" }], targets: [], specs: [], text } });
    }
  }
}

/** Reflection of Kiki-Jiki's copies: "Sacrifice it at the beginning of the next end step." */
function queueEndStepSacrifices(state: GameState): void {
  for (const owner of Object.values(state.players)) {
    for (const perm of owner.battlefield) {
      if (!perm.sacAtEnd) continue;
      const name = state.cards[perm.card.defId].name;
      state.triggerQueue.push({ specs: [], item: { kind: "ability", id: newId(state), controller: owner.id, source: perm.card.iid, sourceName: name, effects: [{ type: "sacrifice", what: { t: "self" } }], targets: [], specs: [], text: "Sacrifice this token at the beginning of the next end step." } });
    }
  }
}

/** Paradigm: "you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases". */
/** What a paradigm spell does: its rules text without the paradigm line and reminder text. */
const spellText = (def: CardDef) =>
  (def.text ?? "")
    .split("\n")
    .filter((line) => !/^paradigm\b/i.test(line))
    .join(" ")
    .replace(/\s*\([^)]*\)/g, "")
    .trim();

function queueParadigms(state: GameState, p: PlayerState): void {
  const names = new Set<string>();
  for (const iid of p.paradigms ?? []) {
    const card = p.exile.find((c) => c.iid === iid);
    const def = card ? getCard(state, card.defId) : undefined;
    if (!def || names.has(def.name)) continue;
    names.add(def.name);
    const targets = parseCard(def).spell?.targets ?? [];
    const thenText = `Paradigm: cast a copy of ${def.name} without paying its mana cost. ${spellText(def)}`;
    const effects: Effect[] = [{ type: "mayPay", cost: "", prompt: `Paradigm: cast a copy of ${def.name} for free?`, then: [{ type: "castCopy", defId: def.id }], ...(targets.length > 0 ? { thenSpecs: targets, thenText } : {}) }];
    state.triggerQueue.push({ specs: [], item: { kind: "ability", id: newId(state), controller: p.id, source: iid, sourceName: def.name, effects, targets: [], specs: [], text: `Paradigm: you may cast a copy of ${def.name}.` } });
  }
}

export function startNextTurn(state: GameState, events: GameEvent[]): void {
  state.preventCombat = undefined;
  state.noPrevention = undefined;
  state.noGroundBlock = undefined;
  state.extraCombats = undefined;
  state.extraCombatMain = undefined;
  state.extraStep = undefined;
  state.extraResume = undefined;
  // Rule 514.2: damage wears off for everyone at end of turn.
  state.creatureDied = undefined;
  for (const p of Object.values(state.players)) {
    p.drawnThisTurn = 0;
    p.costLessThisTurn = undefined;
    p.discardedThisTurn = undefined;
    p.freeNext = undefined;
    p.doubleDamage = undefined;
    p.preventShield = undefined;
    p.lifeGainedThisTurn = 0;
    p.lifeLostThisTurn = 0;
    p.landsEnteredThisTurn = undefined;
    p.attackedThisTurn = undefined;
    p.spellsCastThisTurn = 0;
    p.yardCastable = undefined;
    p.leftThisTurn = undefined;
    p.deathLife = undefined;
    p.pool = undefined;
    p.battlefield.forEach((perm) => {
      perm.damage = 0;
      perm.unblockableTurn = undefined;
      perm.tempBase = undefined;
      perm.attackedThisTurn = undefined;
      perm.sacOnDamage = undefined;
      perm.tempNoDefender = undefined;
      perm.damagedBy = undefined;
      perm.deathtouched = false;
      perm.powerBonus = 0;
      perm.tempFrom = undefined;
      perm.toughnessBonus = 0;
      perm.tempKeywords = [];
      perm.regenShield = 0; // "until end of turn"
      perm.preventShield = undefined;
      perm.usedAbilities = [];
      perm.crewed = false; // a Vehicle stops being a creature at end of turn
      perm.crewedBy = undefined;
      perm.tempSubtypes = undefined;
      perm.tempLostSubtypes = undefined;
      perm.tempColors = undefined;
      perm.tempNonartifact = undefined;
      perm.untargetableBy = undefined;
      perm.loyaltyUsed = false;
      perm.cantBlockTurn = false;
      perm.noRegen = false;
      perm.exileOnDeath = undefined;
      perm.mustBeBlocked = undefined;
      perm.diesReturn = undefined;
      perm.damageDraws = undefined;
      perm.countersThisTurn = undefined;
      perm.powerFromHand = undefined;
      perm.tappedThisTurn = undefined;
    });
  }
  // "Gain control of target creature until end of turn": it goes back to its controller.
  for (const p of Object.values(state.players)) {
    for (const perm of [...p.battlefield]) {
      if (!perm.controlReturn) continue;
      const back = perm.controlReturn;
      delete perm.controlReturn;
      if (back === p.id) continue;
      p.battlefield.splice(p.battlefield.indexOf(perm), 1);
      state.players[back].battlefield.push(perm);
    }
  }
  // The "until end of turn" effects just ended: a creature that was only alive because of one (toughness 0 now) dies (rule 704.3).
  checkStateBasedActions(state, events);
  if (state.winner) return;

  state.active = OPPONENT[state.active];
  state.turn++;
  events.push({ type: "turnStarted", player: state.active, turn: state.turn });

  const p = state.players[state.active];
  untap(state, p);
  // Upkeep: "at the beginning of your upkeep" / "of each upkeep"
  for (const owner of Object.values(state.players)) {
    for (const perm of owner.battlefield) queueTriggers(state, perm.card, owner.id, owner.id === state.active ? "upkeep" : "upkeepEach");
  }
  for (const perm of p.battlefield) queueTriggers(state, perm.card, state.active, "upkeepEach");
  // "Draw a card at the beginning of the next turn's upkeep."
  for (const owner of Object.values(state.players)) {
    for (const d of owner.upkeepDraws ?? []) {
      state.triggerQueue.push({ specs: [], item: { kind: "ability", id: newId(state), controller: owner.id, source: d.source, sourceName: d.name, effects: [{ type: "draw", amount: 1, who: { t: "you" } }], targets: [], specs: [], text: "At the beginning of the next turn's upkeep, draw a card." } });
    }
    owner.upkeepDraws = undefined;
  }
  // "At the beginning of the upkeep of enchanted creature's controller, that player draws a card."
  for (const owner of Object.values(state.players)) {
    for (const perm of owner.battlefield) {
      if (!perm.attachedTo || !parseCard(getCard(state, perm.card.defId)).triggers.some((t) => t.event === "hostUpkeep")) continue;
      if (p.battlefield.some((host) => host.card.iid === perm.attachedTo)) queueTriggers(state, perm.card, state.active, "hostUpkeep");
    }
  }

  if (p.library.length === 0) {
    state.winner = OPPONENT[state.active];
    events.push({ type: "gameWon", player: state.winner });
    return;
  }
  drawCards(state, state.active, 1, events, true); // (the draw step's card counts as the first card drawn this turn)
  // Sagas: a lore counter after the draw step, then that chapter's ability.
  for (const perm of p.battlefield) {
    if (!parseCard(getCard(state, perm.card.defId)).saga) continue;
    perm.lore = (perm.lore ?? 0) + 1;
    queueChapters(state, perm, state.active);
  }
  queueParadigms(state, p);

  state.phase = "main1";
  events.push({ type: "phaseChanged", phase: "main1" });
}

function untap(state: GameState, p: PlayerState): void {
  p.landsPlayedThisTurn = 0;
  p.spareMana = undefined;
  for (const perm of p.battlefield) {
    if (perm.stun && perm.tapped) perm.stun -= 1; // a stun counter: instead of untapping, remove one
    else if (!forbidden(state, perm, "noUntap")) perm.tapped = false; // "doesn't untap during its controller's untap step"
    perm.summoningSick = false;
  }
}
