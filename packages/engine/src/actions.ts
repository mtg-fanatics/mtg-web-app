import { getCard } from "./cards.js";
import {
  askAsEnters,
  cardsDiscarded,
  checkStateBasedActions,
  entersTappedNow,
  exilePlayable,
  exilePlayTerms,
  findPermanent,
  findPermanentOrNull,
  forbidden,
  handLimit,
  isCreature,
  isProtectedFrom,
  kw,
  landEntered,
  lethalFor,
  nameOf,
  onBoard,
  playerToAct,
  powerOf,
  qualityOfDef,
  qualityOfPerm,
  queueTriggers,
  staticEffectsOn,
  tapPerm,
  subtypesOf,
  toughnessOf,
} from "./core.js";
import type { TargetChoice } from "./effects.js";
import type { ManaColor } from "./mana.js";
import { parseCard } from "./oracle.js";
import { BACK_SUFFIX } from "./oracle/doubleFaced.js";
import { shuffle, STARTING_HAND } from "./state.js";
import { activateAbility, activateLoyalty, castSpell, chooseTargets, crewVehicle, cycleCard, getCastable, openWindow, passPriority, pickCard, plotCard, settle } from "./stack.js";
import type { Outcome } from "./stack.js";
import { OPPONENT } from "./types.js";
import type { GameState, Permanent, PlayerId } from "./types.js";
import { continueAfterBlockers, getDamageAssignments, resolveCombat } from "./actions/combat.js";
import { advancePhase, startNextTurn } from "./actions/turn.js";

export { getDamageAssignments, suggestDamageAssignment } from "./actions/combat.js";
export type { DamageEntry } from "./actions/combat.js";

export { playerToAct };

export type Block = { attacker: string; blocker: string };
/** `blocker` is a blocking creature, or the defending player's id when a trampler assigns excess damage to them. */
export type DamageAssignment = { attacker: string; blocker: string; amount: number };

export type Action =
  | { type: "mulligan" }
  | { type: "keepHand"; bottom: string[] }
  | { type: "shuffleDeck" } // before keeping or mulliganing: shuffle the OTHER player's library
  | { type: "playLand"; iid: string; back?: boolean } // `back`: a modal double-faced land played with its back face up
  | { type: "castCreature"; iid: string }
  | { type: "castSpell"; iid: string; targets?: TargetChoice[]; x?: number; kicked?: boolean; from?: "graveyard" | "exile" | "prepared"; modes?: number[]; sacrifice?: string; warp?: boolean; /** Teamwork: the creatures tapped as an additional cost. */ teamwork?: string[]; /** Phyrexian symbols paid with 2 life each even where mana could pay them. */ phyrexianLife?: number; /** Delve: the graveyard cards exiled to pay for generic mana (left out: the engine chooses). */ delve?: string[]; /** Replicate: how many times it is paid (the targets of each copy follow the spell's). */ replicate?: number; /** An Adventure card: cast its Adventure spell instead of the creature. */ adventure?: boolean; /** Harmonize: the creature tapped to pay {X} of the cost. */ harmonizeTap?: string }
  | { type: "activateAbility"; iid: string; index: number; targets?: TargetChoice[]; payWith?: string; /** The X of a cost like "{X}{R}": what the player chose to pay. */ x?: number; /** Phyrexian symbols paid with 2 life each even where mana could pay them. */ phyrexianLife?: number }
  | { type: "crew"; iid: string } // crew a Vehicle: then choose the creatures to tap
  | { type: "cycle"; iid: string } // cycle a card from hand (pay its cycling cost, discard it, draw a card)
  | { type: "plot"; iid: string } // plot a card from hand (pay its plot cost and exile it, to cast it for free on a later turn)
  | { type: "passPriority" }
  | { type: "chooseTargets"; targets: TargetChoice[] }
  | { type: "pick"; iid?: string } // answer a choice among cards (iid missing = decline)
  | { type: "passPhase" }
  | { type: "declareAttackers"; attackers: string[]; targets?: Record<string, string> } // `targets`: attacker iid -> planeswalker iid (default: the player)
  | { type: "loyalty"; iid: string; index: number; targets?: TargetChoice[] }
  | { type: "declareBlockers"; blocks: Block[] }
  | { type: "assignDamage"; assignments: DamageAssignment[] }
  | { type: "discard"; iids: string[] }
  | { type: "concede" }
  /** Which moments of the game stop and wait for this player to pass priority (see `Player.stops`). Allowed at any time, by either player. */
  | { type: "setStops"; stops: { attack?: boolean; spell?: boolean; block?: boolean } };

export type GameEvent =
  | { type: "mulliganTaken"; player: PlayerId; count: number }
  | { type: "handKept"; player: PlayerId; bottomed: number }
  | { type: "libraryShuffled"; player: PlayerId } // a card shuffled `player`'s library (a search, "then shuffle")
  | { type: "deckShuffled"; player: PlayerId; owner: PlayerId } // `player` shuffled `owner`'s library
  | { type: "landPlayed"; player: PlayerId; iid: string }
  | { type: "creatureCast"; player: PlayerId; iid: string; tapped: string[] }
  | { type: "phaseChanged"; phase: GameState["phase"] }
  | { type: "turnStarted"; player: PlayerId; turn: number }
  | { type: "cardDrawn"; player: PlayerId; iid: string }
  | { type: "attackersDeclared"; player: PlayerId; attackers: string[] }
  | { type: "blockersDeclared"; player: PlayerId; blocks: Block[] }
  | { type: "combatDamage"; source: string; target: string | PlayerId; amount: number; /** Dealt by a creature with infect: poison counters or -1/-1 counters. */ infect?: true }
  | { type: "lifeGained"; player: PlayerId; amount: number }
  | { type: "lifeLost"; player: PlayerId; amount: number }
  | { type: "poisoned"; player: PlayerId; amount: number }
  | { type: "spellCast"; player: PlayerId; iid: string; tapped: string[]; targets: TargetChoice[]; /** A copy (gone once it resolves): the card it copies. */ copyOf?: string }
  | { type: "abilityActivated"; player: PlayerId; iid: string; name: string; text: string; targets?: TargetChoice[] }
  | { type: "permanentEntered"; player: PlayerId; iid: string }
  | { type: "damage"; source: string; target: string | PlayerId; amount: number }
  | { type: "effect"; text: string }
  | { type: "countered"; name: string; controller: PlayerId; /** The spell's card, or the permanent the ability came from. */ iid: string; /** What countered it: a spell, or a ward that wasn't paid. */ by?: string }
  /**
   * The top of the stack resolved. `iid`: the spell's card, or the permanent the ability came from. `fizzled`: it did nothing, because every
   * target it had stopped being legal (why, in words). `trigger`: a triggered ability, with its text. `did`: what it changed.
   */
  | { type: "resolved"; name: string; controller: PlayerId; iid: string; ability?: true; trigger?: true; text?: string; fizzled?: string; did?: Outcome[] }
  /** Mana was paid: each mana made, and the permanent that made it (named, as a Treasure is gone once it is used). */
  | { type: "manaPaid"; player: PlayerId; made: { iid: string; name: string; color: ManaColor }[] }
  | { type: "creatureDied"; player: PlayerId; iid: string; /** Its name (a token is gone by then). */ name?: string; /** An artifact or enchantment going to the graveyard. */ noncreature?: true; sacrificed?: true }
  | { type: "cardsDiscarded"; player: PlayerId; iids: string[] }
  | { type: "conceded"; player: PlayerId }
  | { type: "gameWon"; player: PlayerId }
  | { type: "gameDrawn" };

export type Result =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

const MAIN_PHASES = ["main1", "main2"];
export const MAX_LANDS_PER_TURN = 1;
/** Rule 402.2: normally seven. */
export const MAX_HAND_SIZE = 7;
export const MAX_MULLIGANS = 7;

const fail = (error: string): Result => ({ ok: false, error });
/** "Attacks each combat if able": printed on the creature, or given by another permanent ("Other Goblins you control attack each combat if able"). */
const mustAttack = (state: GameState, perm: Permanent): boolean => parseCard(getCard(state, perm.card.defId)).mustAttack === true || staticEffectsOn(state, perm).some((st) => st.mustAttack === true);

/** True while a lure check is trying a single block, so that trial does not demand more blocks itself. */
let lureProbe = false;
const toughness = toughnessOf;

/** Pure: never mutates the input state. Illegal actions return `{ ok: false }`. */
export function applyAction(state: GameState, player: PlayerId, action: Action): Result {
  if (state.winner) return fail("The game is over.");

  // Rule 104.3a: a player may concede at any time, even when it isn't their turn.
  if (action.type === "concede") {
    const next = structuredClone(state);
    next.winner = OPPONENT[player];
    return {
      ok: true,
      state: next,
      events: [{ type: "conceded", player }, { type: "gameWon", player: next.winner }],
    };
  }

  if (action.type === "setStops") {
    const next = structuredClone(state);
    next.players[player].stops = { attack: action.stops.attack === true, spell: action.stops.spell === true, block: action.stops.block === true };
    return { ok: true, state: next, events: [] };
  }

  if (player !== playerToAct(state)) return fail("It is not your turn.");
  if (state.pendingPick && action.type !== "pick") return fail("Make your choice first.");
  if (action.type === "pick" && !state.pendingPick) return fail("There is nothing to choose.");
  if (state.pendingChoice && action.type !== "chooseTargets") return fail("Choose a target for the ability first.");
  if (state.priority && !state.pendingChoice && !state.pendingPick && !["castSpell", "castCreature", "activateAbility", "passPriority", "cycle", "crew"].includes(action.type)) {
    return fail("Respond to what is on the stack, or pass priority.");
  }

  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const me = next.players[player];
  /** Called when a round of priority ends and the game should carry on with combat damage. */
  const onContinue = (then: "afterBlockers" | "afterAttackers") => {
    if (then === "afterBlockers") continueAfterBlockers(next, events);
  };

  switch (action.type) {
    case "shuffleDeck": {
      const opening = next.opening;
      if (next.phase !== "mulligan" || !opening?.shuffled) return fail("There is nothing to shuffle right now.");
      if (opening.shuffled[player]) return fail("You already shuffled your opponent's deck.");
      const owner = OPPONENT[player];
      const [shuffledLibrary, rng] = shuffle(next.players[owner].library, next.rng);
      next.rng = rng;
      next.players[owner].library = shuffledLibrary;
      opening.shuffled[player] = true;
      events.push({ type: "deckShuffled", player, owner });
      break;
    }

    case "mulligan": {
      if (next.phase !== "mulligan" || !next.opening) return fail("Mulligans are only taken before the game starts.");
      if (next.opening.shuffled && !(next.opening.shuffled.p1 && next.opening.shuffled.p2)) return fail("Both decks are shuffled first.");
      if (next.opening.taken[player] >= MAX_MULLIGANS) return fail("You can't mulligan any more.");
      // Rule 103.5: shuffle your hand back, draw a new seven; you bottom cards when you keep.
      const [shuffled, rng] = shuffle([...me.hand, ...me.library], next.rng);
      next.rng = rng;
      me.hand = shuffled.slice(0, STARTING_HAND);
      me.library = shuffled.slice(STARTING_HAND);
      next.opening.taken[player]++;
      events.push({ type: "mulliganTaken", player, count: next.opening.taken[player] });
      break;
    }

    case "keepHand": {
      if (next.phase !== "mulligan" || !next.opening) return fail("You can only keep your hand before the game starts.");
      if (next.opening.shuffled && !(next.opening.shuffled.p1 && next.opening.shuffled.p2)) return fail("Both decks are shuffled first.");
      const taken = next.opening.taken[player];
      const unique = new Set(action.bottom);
      if (action.bottom.length !== taken || unique.size !== taken) {
        return fail(`Choose ${taken} card${taken === 1 ? "" : "s"} to put on the bottom of your library.`);
      }
      for (const iid of action.bottom) {
        const idx = me.hand.findIndex((c) => c.iid === iid);
        if (idx < 0) return fail("That card is not in your hand.");
        me.library.push(...me.hand.splice(idx, 1));
      }
      next.opening.kept[player] = true;
      events.push({ type: "handKept", player, bottomed: taken });
      if (next.opening.kept.p1 && next.opening.kept.p2) {
        next.opening = null;
        next.phase = "main1"; // the starting player skips their first draw (rule 103.8a)
        next.active = next.startingPlayer;
        events.push({ type: "turnStarted", player: next.active, turn: 1 });
        events.push({ type: "phaseChanged", phase: "main1" });
      }
      break;
    }

    case "playLand": {
      if (!MAIN_PHASES.includes(next.phase)) return fail("Lands can only be played in a main phase.");
      if (me.landsPlayedThisTurn >= MAX_LANDS_PER_TURN) return fail("You already played a land this turn.");
      let idx = me.hand.findIndex((c) => c.iid === action.iid);
      let zone = me.hand;
      const { tappedLand } = exilePlayTerms(next, player, action.iid); // "each land played this way enters tapped"
      if (idx < 0 && exilePlayable(next, player).some((c) => c.iid === action.iid)) {
        zone = me.exile; // "you may play that card" from exile
        idx = me.exile.findIndex((c) => c.iid === action.iid);
        me.mayPlay = (me.mayPlay ?? []).filter((e) => e.iid !== action.iid);
      }
      if (idx < 0) return fail("That card is not in your hand.");
      if (getCard(next, zone[idx].defId).type !== "land") return fail("That card is not a land.");
      const backId = `${zone[idx].defId}${BACK_SUFFIX}`;
      if (action.back && next.cards[backId]?.type !== "land") return fail("That land has no other face to play.");
      const [played] = zone.splice(idx, 1);
      const card = action.back ? { ...played, defId: backId, printed: played.defId } : played;
      me.battlefield.push({ card, tapped: (zone === me.exile && tappedLand) || entersTappedNow(next, player, getCard(next, card.defId)), summoningSick: true, damage: 0, enteredTurn: next.turn });
      me.landsPlayedThisTurn++;
      events.push({ type: "landPlayed", player, iid: card.iid });
      queueTriggers(next, card, player, "enters"); // "When this land enters, you gain 1 life."
      landEntered(next, player); // landfall
      askAsEnters(next, me.battlefield[me.battlefield.length - 1], player); // "As this enters, choose a color" (or a creature type)
      break;
    }

    case "castCreature":
    case "castSpell": {
      const error = castSpell(next, player, action.iid, action.type === "castSpell" ? (action.targets ?? []) : [], events, action.type === "castSpell" ? action.x : 0, action.type === "castSpell" ? action.kicked === true : false, action.type === "castSpell" ? (action.from ?? "hand") : me.hand.some((c) => c.iid === action.iid) ? "hand" : "exile", action.type === "castSpell" ? action.modes : undefined, action.type === "castSpell" ? action.sacrifice : undefined, action.type === "castSpell" && action.warp === true, action.type === "castSpell" ? action.teamwork : undefined, action.type === "castSpell" ? action.phyrexianLife : 0, action.type === "castSpell" ? action.delve : undefined, action.type === "castSpell" ? (action.replicate ?? 0) : 0, action.type === "castSpell" && action.adventure === true, action.type === "castSpell" ? action.harmonizeTap : undefined);
      if (error) return fail(error);
      break;
    }

    case "activateAbility": {
      const error = activateAbility(next, player, action.iid, action.index, action.targets ?? [], events, action.payWith, action.x, action.phyrexianLife);
      if (error) return fail(error);
      break;
    }

    case "loyalty": {
      const error = activateLoyalty(next, player, action.iid, action.index, action.targets ?? [], events);
      if (error) return fail(error);
      break;
    }

    case "crew": {
      const error = crewVehicle(next, player, action.iid);
      if (error) return fail(error);
      break;
    }

    case "cycle": {
      const error = cycleCard(next, player, action.iid, events);
      if (error) return fail(error);
      break;
    }

    case "plot": {
      const error = plotCard(next, player, action.iid, events);
      if (error) return fail(error);
      break;
    }

    case "passPriority": {
      const error = passPriority(next, player, events, onContinue);
      if (error) return fail(error);
      break;
    }

    case "pick": {
      const error = pickCard(next, player, action.iid, events);
      if (error) return fail(error);
      break;
    }

    case "chooseTargets": {
      const error = chooseTargets(next, player, action.targets);
      if (error) return fail(error);
      break;
    }

    case "passPhase": {
      if (next.phase === "attackers") {
        const forced = getPossibleAttackers(next).filter((id) => mustAttack(next, findPermanent(next, id).perm));
        if (forced.length > 0) return fail(`${nameOf(next, findPermanent(next, forced[0]).perm)} attacks each combat if able.`);
      }
      // Passing the attackers step means "no attack". The other special steps need a real choice.
      if (next.phase === "mulligan") return fail("Keep your hand or take a mulligan first.");
      if (next.phase === "blockers") return fail("Declare your blockers (an empty list blocks nothing).");
      if (next.phase === "damage") return fail("Assign combat damage first.");
      if (next.phase === "cleanup") return fail(`Discard down to ${handLimit(next, player)} cards first.`);
      advancePhase(next, events);
      break;
    }

    case "declareAttackers": {
      if (next.phase !== "attackers") return fail("Attackers are declared in the attackers step.");
      const ids = new Set(action.attackers);
      if (ids.size !== action.attackers.length) return fail("A creature can only attack once.");
      const chosen: Permanent[] = [];
      for (const iid of ids) {
        const perm = me.battlefield.find((p) => p.card.iid === iid);
        if (!perm || !isCreature(next, perm)) return fail("Only your creatures can attack.");
        if (kw(next, perm, "defender")) return fail(`${nameOf(next, perm)} has defender and can't attack.`);
        if (forbidden(next, perm, "cantAttack")) return fail(`${nameOf(next, perm)} can't attack.`);
        if (perm.tapped) return fail("A tapped creature can't attack.");
        if (perm.summoningSick && !kw(next, perm, "haste")) return fail(`${nameOf(next, perm)} just arrived this turn, so it can't attack yet (summoning sickness). It can attack from your next turn, or right away if it has haste.`);
        chosen.push(perm);
      }
      for (const perm of chosen) {
        if (parseCard(getCard(next, perm.card.defId)).attackIfMoreCreatures && me.battlefield.filter((p) => isCreature(next, p)).length <= next.players[OPPONENT[player]].battlefield.filter((p) => isCreature(next, p)).length) {
          return fail(`${nameOf(next, perm)} can't attack unless you control more creatures than the defending player.`);
        }
        const land = parseCard(getCard(next, perm.card.defId)).attackOnlyIfDefenderControls;
        if (land && !next.players[OPPONENT[player]].battlefield.some((p) => (getCard(next, p.card.defId).typeLine ?? "").includes(land))) {
          return fail(`${nameOf(next, perm)} can't attack unless the defending player controls an ${land}.`);
        }
        if (parseCard(getCard(next, perm.card.defId)).cantAttackAlone && chosen.length < 2) return fail(`${nameOf(next, perm)} can't attack alone.`);
      }
      // "Attacks each combat if able."
      const forced = getPossibleAttackers(next).filter((id) => !ids.has(id) && mustAttack(next, findPermanent(next, id).perm));
      if (forced.length > 0) return fail(`${nameOf(next, findPermanent(next, forced[0]).perm)} attacks each combat if able.`);
      if (chosen.length === 0) {
        advancePhase(next, events); // no attack: straight to main2
        break;
      }
      me.attackedThisTurn = true; // raid
      chosen.forEach((p) => {
        p.attackedThisTurn = true;
        if (!kw(next, p, "vigilance")) tapPerm(next, p, player); // vigilance: attacking doesn't tap it
      });
      for (const [attacker, walker] of Object.entries(action.targets ?? {})) {
        const found = findPermanentOrNull(next, walker);
        if (!ids.has(attacker) || !found || found.owner.id !== OPPONENT[player] || getCard(next, found.perm.card.defId).type !== "planeswalker") return fail("An attacker can only attack the opponent or one of their planeswalkers.");
      }
      next.combat = { attackers: chosen.map((p) => ({ attacker: p.card.iid, blockers: [], ...(action.targets?.[p.card.iid] ? { target: action.targets[p.card.iid] } : {}) })) };
      next.phase = "blockers";
      chosen.forEach((p) => queueTriggers(next, p.card, player, "attacks", { attackers: chosen.map((c) => c.card.iid) }));
      if (chosen.length >= 3) chosen.forEach((p) => queueTriggers(next, p.card, player, "battalion")); // "Battalion — whenever this and at least two other creatures attack"
      if (chosen.length >= 2) for (const p of me.battlefield) queueTriggers(next, p.card, player, "attackTwo");
      if (chosen.length === 1) for (const p of me.battlefield) queueTriggers(next, p.card, player, "attacksAlone", { other: chosen[0].card.iid, self: p.card.iid === chosen[0].card.iid });
      for (const p of me.battlefield) queueTriggers(next, p.card, player, "youAttack", { attackers: chosen.map((c) => c.card.iid) });
      // "Whenever a Bat you control attacks": once for each attacking Bat.
      for (const attacker of chosen) for (const p of me.battlefield) queueTriggers(next, p.card, player, "allyAttacks", { subtypes: subtypesOf(next, attacker), other: attacker.card.iid }); // "Whenever one or more creatures you control attack" // "Whenever you attack with two or more creatures"
      events.push({ type: "attackersDeclared", player, attackers: [...ids] });
      events.push({ type: "phaseChanged", phase: "blockers" });
      // The attacking player gets priority first, so a trick like "attacking creatures get +2/+0" can be cast now that there are attackers.
      // If neither player can respond, this passes straight through to the blockers.
      openWindow(next, player, "afterAttackers");
      break;
    }

    case "declareBlockers": {
      if (next.phase !== "blockers" || !next.combat) return fail("Blockers are declared in the blockers step.");
      // An attacker may have left the battlefield since it was declared (a trigger, a sacrifice): it is no longer in combat.
      next.combat.attackers = next.combat.attackers.filter((a) => onBoard(next, a.attacker));
      // Rule 509.1a: each creature blocks at most one attacker, but several may block the same one.
      const usedBlockers = new Set<string>();
      for (const { attacker, blocker } of action.blocks) {
        if (!next.combat.attackers.some((a) => a.attacker === attacker)) return fail("That creature isn't attacking.");
        if (usedBlockers.has(blocker)) return fail("A creature can only block one attacker.");
        const perm = me.battlefield.find((p) => p.card.iid === blocker);
        if (!perm || !isCreature(next, perm)) return fail("Only your creatures can block.");
        if (perm.tapped) return fail("A tapped creature can't block.");
        if (parseCard(getCard(next, perm.card.defId)).cantBlock || forbidden(next, perm, "cantBlock")) return fail(`${nameOf(next, perm)} can't block.`);
        const attackerPerm = findPermanent(next, attacker).perm;
        if (parseCard(getCard(next, attackerPerm.card.defId)).cantBeBlocked || attackerPerm.unblockableTurn || staticEffectsOn(next, attackerPerm).some((st) => st.unblockable)) return fail(`${nameOf(next, attackerPerm)} can't be blocked${attackerPerm.unblockableTurn ? " this turn" : ""}.`);
        const attackerDef = getCard(next, attackerPerm.card.defId);
        const blockerDef = getCard(next, perm.card.defId);
        const isArtifact = (blockerDef.typeLine ?? "").split("—")[0].includes("Artifact") || blockerDef.type === "artifact";
        if (kw(next, attackerPerm, "fear") && !isArtifact && !(blockerDef.colors ?? []).includes("B")) {
          return fail(`${nameOf(next, perm)} can't block ${nameOf(next, attackerPerm)}: it has fear (only artifact and black creatures can block it).`);
        }
        if (kw(next, attackerPerm, "intimidate") && !isArtifact && !(blockerDef.colors ?? []).some((c) => (attackerDef.colors ?? []).includes(c))) {
          return fail(`${nameOf(next, perm)} can't block ${nameOf(next, attackerPerm)}: it has intimidate (only artifact creatures and creatures sharing a color can block it).`);
        }
        if (isProtectedFrom(next, attackerPerm, qualityOfPerm(next, perm))) {
          return fail(`${nameOf(next, perm)} can't block ${nameOf(next, attackerPerm)}: it has protection from it.`);
        }
        const only = parseCard(attackerDef).blockedOnlyBy;
        if (only) {
          const allowed =
            only.subtypes.some((t) => (blockerDef.typeLine ?? "").includes(t)) ||
            only.keywords.some((k) => kw(next, perm, k)) ||
            only.colors.some((c) => (blockerDef.colors ?? []).includes(c)) ||
            (only.artifact && isArtifact);
          if (!allowed) return fail(`${nameOf(next, perm)} can't block ${nameOf(next, attackerPerm)}: it can only be blocked by certain creatures.`);
        }
        for (const walk of [...(parseCard(attackerDef).landwalk ?? []), ...staticEffectsOn(next, attackerPerm).flatMap((st) => st.landwalk ?? [])]) {
          const land = walk.charAt(0).toUpperCase() + walk.slice(1);
          if (me.battlefield.some((p) => getCard(next, p.card.defId).type === "land" && (getCard(next, p.card.defId).typeLine ?? "").includes(land))) {
            return fail(`${nameOf(next, attackerPerm)} has ${walk}walk and can't be blocked: you control a ${land}.`);
          }
        }
        if (kw(next, attackerPerm, "flying") && !kw(next, perm, "flying") && !kw(next, perm, "reach")) {
          return fail(`${nameOf(next, perm)} can't block ${nameOf(next, attackerPerm)}: it has flying (only creatures with flying or reach can block it).`);
        }
        const power = parseCard(attackerDef).cantBeBlockedByPower;
        if (power && (power.op === "max" ? powerOf(next, perm) <= power.n : powerOf(next, perm) >= power.n)) {
          return fail(`${nameOf(next, perm)} can't block ${nameOf(next, attackerPerm)}: creatures with power ${power.n} or ${power.op === "max" ? "less" : "greater"} can't block it.`);
        }
        if (next.noGroundBlock && !kw(next, perm, "flying")) return fail(`${nameOf(next, perm)} can't block: creatures without flying can't block this turn.`);
        const colorsBar = parseCard(attackerDef).cantBeBlockedByColors;
        if (colorsBar?.some((c) => (blockerDef.colors ?? []).includes(c))) return fail(`${nameOf(next, perm)} can't block ${nameOf(next, attackerPerm)}: it can't be blocked by creatures of that color.`);
        if (parseCard(blockerDef).blockIfMoreCreatures && me.battlefield.filter((p) => isCreature(next, p)).length <= next.players[next.active].battlefield.filter((p) => isCreature(next, p)).length) {
          return fail(`${nameOf(next, perm)} can't block unless you control more creatures than the attacking player.`);
        }
        if (parseCard(blockerDef).blocksOnlyFlying && !kw(next, attackerPerm, "flying")) {
          return fail(`${nameOf(next, perm)} can block only creatures with flying.`);
        }
        usedBlockers.add(blocker);
      }
      // "All creatures able to block it do so": every creature that could block it must. A one-block trial of the same rules tells who is able.
      if (!lureProbe) {
        for (const a of next.combat.attackers) {
          if (!parseCard(getCard(next, findPermanent(next, a.attacker).perm.card.defId)).lureAll) continue;
          for (const b of me.battlefield) {
            if (b.tapped || !isCreature(next, b) || action.blocks.some((x) => x.blocker === b.card.iid && x.attacker === a.attacker)) continue;
            lureProbe = true;
            let able = false;
            try {
              able = applyAction(state, player, { type: "declareBlockers", blocks: [{ blocker: b.card.iid, attacker: a.attacker }] }).ok;
            } finally {
              lureProbe = false;
            }
            if (able) return fail(`${nameOf(next, b)} must block ${nameOf(next, findPermanent(next, a.attacker).perm)}: all creatures able to block it do so.`);
          }
        }
      }
      // "Must be blocked this turn if able": as many of those attackers as possible are blocked (rule 509.1c).
      if (!lureProbe) {
        const required = getRequiredBlocks(state);
        const blocked = new Set(action.blocks.map((b) => b.attacker));
        const met = [...blocked].filter((a) => findPermanent(next, a).perm.mustBeBlocked).length;
        const missed = required.find((r) => !blocked.has(r.attacker));
        if (met < required.length && missed) {
          return fail(`${nameOf(next, findPermanent(next, missed.attacker).perm)} must be blocked this turn if able: ${nameOf(next, findPermanent(next, missed.blocker).perm)} can block it.`);
        }
      }
      for (const blocker of usedBlockers) {
        const perm = me.battlefield.find((p) => p.card.iid === blocker)!;
        if (parseCard(getCard(next, perm.card.defId)).cantAttackAlone && usedBlockers.size < 2) return fail(`${nameOf(next, perm)} can't block alone.`);
      }
      for (const a of next.combat.attackers) {
        const blockedBy = action.blocks.filter((b) => b.attacker === a.attacker).length;
        const attackerPerm = findPermanent(next, a.attacker).perm;
        if (blockedBy === 1 && kw(next, attackerPerm, "menace")) {
          return fail(`${nameOf(next, attackerPerm)} has menace: it can't be blocked except by two or more creatures.`);
        }
      }
      for (const { attacker, blocker } of action.blocks) {
        next.combat.attackers.find((a) => a.attacker === attacker)!.blockers.push(blocker);
      }
      for (const a of next.combat.attackers) {
        const limit = parseCard(getCard(next, findPermanent(next, a.attacker).perm.card.defId)).maxBlockers;
        if (limit !== undefined && a.blockers.length > limit) return fail(`${nameOf(next, findPermanent(next, a.attacker).perm)} can't be blocked by more than ${limit} creature${limit === 1 ? "" : "s"}.`);
      }
      events.push({ type: "blockersDeclared", player, blocks: action.blocks });
      const announced = new Set<string>();
      for (const { blocker, attacker } of action.blocks) {
        queueTriggers(next, me.battlefield.find((p) => p.card.iid === blocker)!.card, player, "blocks", { other: attacker });
        // "Becomes blocked" happens once per attacker; "becomes blocked by a creature, ... that creature" once for each blocker.
        queueTriggers(next, findPermanent(next, attacker).perm.card, next.active, "blocked", { other: blocker, onlyOther: announced.has(attacker) });
        announced.add(attacker);
      }
      // Both players may cast instants before damage. If neither can, this passes straight through.
      openWindow(next, next.active, "afterBlockers");
      break;
    }

    case "assignDamage": {
      if (next.phase !== "damage" || !next.combat) return fail("There is no combat damage to assign right now.");
      const needed = getDamageAssignments(next);
      const assigned: Record<string, Record<string, number>> = {};
      for (const { attacker, blocker, amount } of action.assignments) {
        const entry = needed.find((n) => n.attacker === attacker);
        const targets = entry ? [...entry.blockers, ...(entry.trampleTo ? [entry.trampleTo] : [])] : [];
        if (!entry || !targets.includes(blocker)) return fail("That damage can't be assigned there.");
        if (!Number.isInteger(amount) || amount < 0) return fail("Damage must be a whole number.");
        assigned[attacker] ??= {};
        assigned[attacker][blocker] = (assigned[attacker][blocker] ?? 0) + amount;
      }
      for (const entry of needed) {
        const split = assigned[entry.attacker] ?? {};
        const sum = Object.values(split).reduce((a, b) => a + b, 0);
        const attackerPerm = findPermanent(next, entry.attacker).perm;
        if (sum !== entry.power) return fail(`${nameOf(next, attackerPerm)} must assign exactly ${entry.power} damage.`);
        // Trample (rule 702.19b): every blocker must be assigned lethal damage before any goes to the player.
        if (entry.trampleTo && (split[entry.trampleTo] ?? 0) > 0) {
          for (const id of entry.blockers) {
            if ((split[id] ?? 0) < lethalFor(next, attackerPerm, findPermanent(next, id).perm)) {
              return fail(`${nameOf(next, attackerPerm)} must assign lethal damage to every blocker before trampling over to the player.`);
            }
          }
        }
      }
      resolveCombat(next, events, assigned);
      break;
    }

    case "discard": {
      if (next.phase !== "cleanup") return fail("You only discard down to hand size at the end of your turn.");
      const excess = me.hand.length - handLimit(next, player);
      const unique = new Set(action.iids);
      if (action.iids.length !== excess || unique.size !== excess) {
        return fail(`Discard exactly ${excess} card${excess === 1 ? "" : "s"}.`);
      }
      for (const iid of action.iids) {
        const idx = me.hand.findIndex((c) => c.iid === iid);
        if (idx < 0) return fail("That card is not in your hand.");
        me.graveyard.push(...me.hand.splice(idx, 1));
      }
      cardsDiscarded(next, player, action.iids, events);
      startNextTurn(next, events);
      break;
    }
  }

  // Rule 704.3: state-based actions are checked whenever a player would get priority, so a creature whose size depends on the board
  // (power and toughness equal to the cards in your hand) dies as soon as that count drops, not at some later point.
  if (!next.winner) checkStateBasedActions(next, events);
  settle(next, events, onContinue);
  if (lureProbe || !nothingCanBlock(next)) return { ok: true, state: next, events };
  // The defending player has no block to make, so the blockers step is declared for them and combat carries on to damage.
  const skipped = applyAction(next, OPPONENT[next.active], { type: "declareBlockers", blocks: [] });
  return skipped.ok ? { ok: true, state: skipped.state, events: [...events, ...skipped.events] } : { ok: true, state: next, events };
}

/** iids of creatures the active player could attack with right now. */
export function getPossibleAttackers(state: GameState): string[] {
  if (state.winner || state.phase !== "attackers") return [];
  return state.players[state.active].battlefield
    .filter((p) => isCreature(state, p) && !p.tapped && (!p.summoningSick || kw(state, p, "haste")) && !kw(state, p, "defender") && !forbidden(state, p, "cantAttack"))
    .map((p) => p.card.iid);
}

/**
 * Blocks the rules demand right now: every creature able to block an attacker with "all creatures able to block it do so" must.
 * The UI fills these in, so a player is never left guessing why their blocks were refused.
 */
export function getForcedBlocks(state: GameState): { blocker: string; attacker: string }[] {
  if (state.winner || state.phase !== "blockers" || !state.combat) return [];
  const defender = OPPONENT[state.active];
  const out: { blocker: string; attacker: string }[] = [];
  lureProbe = true;
  try {
    for (const a of state.combat.attackers) {
      if (!parseCard(getCard(state, findPermanent(state, a.attacker).perm.card.defId)).lureAll) continue;
      for (const b of state.players[defender].battlefield) {
        if (b.tapped || !isCreature(state, b) || out.some((o) => o.blocker === b.card.iid)) continue;
        if (applyAction(state, defender, { type: "declareBlockers", blocks: [{ blocker: b.card.iid, attacker: a.attacker }] }).ok) out.push({ blocker: b.card.iid, attacker: a.attacker });
      }
    }
  } finally {
    lureProbe = false;
  }
  return out;
}

/** Are these blocks legal by themselves? (A trial of the declare-blockers rules that doesn't demand lure or must-be-blocked blocks.) */
function legalBlocks(state: GameState, defender: PlayerId, blocks: Block[]): boolean {
  lureProbe = true;
  try {
    return applyAction(state, defender, { type: "declareBlockers", blocks }).ok;
  } finally {
    lureProbe = false;
  }
}

/** Can this creature block that attacker by itself? */
const ableToBlock = (state: GameState, defender: PlayerId, blocker: string, attacker: string): boolean => legalBlocks(state, defender, [{ blocker, attacker }]);

/** The blockers step is waiting on the defending player, and no creature of theirs could block any attacker. */
function nothingCanBlock(state: GameState): boolean {
  if (state.winner || state.phase !== "blockers" || !state.combat || state.priority || state.pendingChoice || state.pendingPick) return false;
  const defender = OPPONENT[state.active];
  const blockers = getPossibleBlockers(state);
  if (blockers.length === 0) return true;
  // "Can't block alone" only blocks alongside another creature: too many combinations to try, so the player decides.
  if (blockers.length >= 2 && blockers.some((b) => parseCard(getCard(state, findPermanent(state, b).perm.card.defId)).cantAttackAlone)) return false;
  const pairs = blockers.flatMap((b, i) => blockers.slice(i + 1).map((c) => [b, c]));
  return !state.combat.attackers.some(({ attacker }) => {
    if (blockers.some((b) => ableToBlock(state, defender, b, attacker))) return true;
    // Menace: one blocker alone is refused, two together may not be.
    return kw(state, findPermanent(state, attacker).perm, "menace") && pairs.some(([b, c]) => legalBlocks(state, defender, [{ blocker: b, attacker }, { blocker: c, attacker }]));
  });
}

/**
 * "Must be blocked this turn if able" (rule 509.1c): blocks, one blocker each, that meet as many of those requirements as can be met.
 * How many there are is how many the defending player must meet. `taken`: blockers already spoken for.
 */
export function getRequiredBlocks(state: GameState, taken: string[] = []): { blocker: string; attacker: string }[] {
  if (state.winner || state.phase !== "blockers" || !state.combat) return [];
  const defender = OPPONENT[state.active];
  const must = state.combat.attackers.map((a) => a.attacker).filter((iid) => findPermanentOrNull(state, iid)?.perm.mustBeBlocked);
  if (must.length === 0) return [];
  const blockers = state.players[defender].battlefield.filter((b) => !b.tapped && isCreature(state, b) && !taken.includes(b.card.iid)).map((b) => b.card.iid);
  const able = new Map(must.map((a) => [a, blockers.filter((b) => ableToBlock(state, defender, b, a))]));
  // A maximum matching of blockers to those attackers (Kuhn's algorithm).
  const owner = new Map<string, string>();
  const place = (attacker: string, seen: Set<string>): boolean => {
    for (const b of able.get(attacker) ?? []) {
      if (seen.has(b)) continue;
      seen.add(b);
      if (!owner.has(b) || place(owner.get(b)!, seen)) {
        owner.set(b, attacker);
        return true;
      }
    }
    return false;
  };
  for (const a of must) place(a, new Set());
  return [...owner].map(([blocker, attacker]) => ({ blocker, attacker }));
}

/** iids of creatures the defending player could block with right now. */
export function getPossibleBlockers(state: GameState): string[] {
  if (state.winner || state.phase !== "blockers") return [];
  return state.players[OPPONENT[state.active]].battlefield
    .filter((p) => isCreature(state, p) && !p.tapped && !parseCard(getCard(state, p.card.defId)).cantBlock && !forbidden(state, p, "cantBlock"))
    .map((p) => p.card.iid);
}

/**
 * Simple actions the UI can offer the given player right now. Attacks, blocks, damage splits,
 * discards and bottoming cards are free-form choices, so the UI builds those itself.
 */
export function getLegalActions(state: GameState, player: PlayerId): Action[] {
  if (state.winner || player !== playerToAct(state)) return [];
  if (state.pendingChoice || state.pendingPick) return []; // the screen asks for the targets or the card
  if (state.priority) {
    // Respond with a spell or ability (the screen builds those, they need targets), or pass.
    return [{ type: "passPriority" }, ...getCastable(state, player).map((c): Action => ({ type: "castSpell", iid: c.iid, targets: [] }))];
  }
  if (state.phase === "mulligan") {
    const shuffled = state.opening?.shuffled;
    if (shuffled && !(shuffled.p1 && shuffled.p2)) return [{ type: "shuffleDeck" }];
    const taken = state.opening?.taken[player] ?? 0;
    return [
      ...(taken < MAX_MULLIGANS ? [{ type: "mulligan" } as Action] : []),
      ...(taken === 0 ? [{ type: "keepHand", bottom: [] } as Action] : []),
    ];
  }
  const castable = getCastable(state, player).map((c): Action => ({ type: "castSpell", iid: c.iid, targets: [] }));
  if (state.phase === "blockers") return [{ type: "declareBlockers", blocks: [] }, ...castable];
  if (state.phase === "damage" || state.phase === "cleanup") return [];
  const actions: Action[] = [{ type: "passPhase" }, ...castable];
  if (state.phase === "attackers") {
    const attackers = getPossibleAttackers(state);
    if (attackers.length) actions.push({ type: "declareAttackers", attackers });
  }
  if (!MAIN_PHASES.includes(state.phase)) return actions;
  for (const card of [...state.players[player].hand, ...exilePlayable(state, player)]) {
    if (getCard(state, card.defId).type !== "land") continue;
    const action: Action = { type: "playLand", iid: card.iid };
    if (applyAction(state, player, action).ok) actions.push(action);
    if (state.cards[`${card.defId}${BACK_SUFFIX}`]?.type === "land" && applyAction(state, player, { ...action, back: true }).ok) actions.push({ ...action, back: true });
  }
  return actions;
}
