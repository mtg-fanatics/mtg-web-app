import { getCard } from "../cards.js";
import { absorbDamage, hostDamageLife } from "../core/prevention.js";
import { parseCard } from "../oracle.js";
import {
  addPoison,
  canPrevent,
  changeLife,
  creatureDamaged,
  checkStateBasedActions,
  findPermanent,
  isProtectedFrom,
  kw,
  lethalFor,
  nameOf,
  playerLabel,
  onBoard,
  powerOf,
  sacrificePermanent,
  qualityOfPerm,
  queueDamageDraws,
  queueTriggers,
  toughnessOf,
} from "../core.js";
import { OPPONENT } from "../types.js";
import type { GameState, Permanent, PlayerId, PlayerState } from "../types.js";
import type { GameEvent } from "../actions.js";

// Combat damage (rule 510): how each attacker splits its damage, and dealing it.

const power = (s: GameState, p: Permanent) => (p.damageByToughness ? Math.max(0, toughnessOf(s, p)) : powerOf(s, p)); // "assigns combat damage equal to its toughness"

/** After the blockers are declared and anyone has responded: assign damage, or deal it. */
export function continueAfterBlockers(state: GameState, events: GameEvent[]): void {
  const combat = state.combat;
  if (!combat) return;
  // Spells cast before damage can have removed creatures from the fight.
  combat.attackers = combat.attackers.filter((a) => onBoard(state, a.attacker));
  if (combat.attackers.length === 0) {
    state.combat = null;
    state.phase = "main2";
    events.push({ type: "phaseChanged", phase: "main2" });
    return;
  }
  if (getDamageAssignments(state).length > 0) {
    state.phase = "damage"; // the attacker's controller must divide damage (rule 510.1c)
    events.push({ type: "phaseChanged", phase: "damage" });
  } else {
    resolveCombat(state, events, {});
  }
}

export interface DamageEntry {
  attacker: string;
  blockers: string[];
  power: number;
  /** Set when the attacker has trample: it may also assign damage to this (the defending) player. */
  trampleTo?: PlayerId;
}

/** Attackers blocked by two or more creatures: their controller divides the damage (rule 510.1c). */
export function getDamageAssignments(state: GameState): DamageEntry[] {
  if (!state.combat) return [];
  return state.combat.attackers
    // Several blockers need a split (rule 510.1c). A trampler with even one blocker chooses how much goes past it (702.19b).
    .filter((a) => {
      if (!onBoard(state, a.attacker)) return false;
      const alive = a.blockers.filter((b) => onBoard(state, b)).length;
      return alive >= 2 || (alive === 1 && kw(state, findPermanent(state, a.attacker).perm, "trample"));
    })
    .map((a) => {
      const perm = findPermanent(state, a.attacker).perm;
      const entry: DamageEntry = { attacker: a.attacker, blockers: a.blockers.filter((b) => onBoard(state, b)), power: power(state, perm) };
      if (kw(state, perm, "trample")) entry.trampleTo = OPPONENT[state.active];
      return entry;
    })
    .filter((a) => a.power > 0);
}

/**
 * Lethal damage to each blocker in turn. Without trample the leftover goes on the last blocker; with
 * trample it goes to the defending player. Always totals the attacker's full power.
 */
function planDamage(state: GameState, attacker: Permanent, blockers: string[], defender: PlayerId): Record<string, number> {
  let left = power(state, attacker);
  const trample = kw(state, attacker, "trample");
  const out: Record<string, number> = {};
  blockers.forEach((id, i) => {
    const lethal = lethalFor(state, attacker, findPermanent(state, id).perm);
    const give = i === blockers.length - 1 && !trample ? left : Math.min(left, lethal);
    out[id] = give;
    left -= give;
  });
  if (trample && left > 0) out[defender] = left;
  return out;
}

/** A sensible default split for the UI (see planDamage). */
export function suggestDamageAssignment(state: GameState, attacker: string): Record<string, number> {
  const entry = getDamageAssignments(state).find((a) => a.attacker === attacker);
  if (!entry) return {};
  return planDamage(state, findPermanent(state, attacker).perm, entry.blockers, OPPONENT[state.active]);
}

/**
 * Combat damage (rule 510). With first strike or double strike in the fight there are two damage steps:
 * first strikers and double strikers deal damage first, creatures that died deal none, and then everyone
 * else (and the double strikers again) deals damage. Each step's damage is dealt at once, then state-based
 * actions run. `assigned` holds the split the player chose for multiple blockers (used for the first
 * damage a creature deals; a second strike is split automatically among the blockers still alive).
 */
export function resolveCombat(state: GameState, events: GameEvent[], assigned: Record<string, Record<string, number>>): void {
  const combat = state.combat!;
  const defenderId = OPPONENT[state.active];
  const onBoard = (iid: string) => Object.values(state.players).some((p) => p.battlefield.some((x) => x.card.iid === iid));
  const find = (iid: string) => findPermanent(state, iid).perm;

  const everyone = [...combat.attackers.map((a) => a.attacker), ...combat.attackers.flatMap((a) => a.blockers)].filter((id) => onBoard(id)); // (this function's own onBoard takes just the id)
  const anyFirstStrike = everyone.some((id) => kw(state, find(id), "first strike") || kw(state, find(id), "double strike"));
  const dealsIn = (p: Permanent, step: "first" | "regular") => {
    const first = kw(state, p, "first strike") || kw(state, p, "double strike");
    return step === "first" ? first : kw(state, p, "double strike") || !first;
  };

  const split = new Set<string>(); // attackers that already used the split the player chose

  const runStep = (step: "first" | "regular") => {
    // Work out every hit first, so the damage of a step really is simultaneous.
    const hits: { source: Permanent; target: Permanent | PlayerState; amount: number }[] = [];
    for (const { attacker, blockers, target: walkerId } of combat.attackers) {
      if (!onBoard(attacker)) continue;
      const a = find(attacker);
      const alive = blockers.filter(onBoard);
      // Who the attacker is really hitting: the player, or the planeswalker it attacked (if that is gone, nothing).
      const defendingTarget = (): Permanent | PlayerState | null => (walkerId ? (onBoard(walkerId) ? find(walkerId) : null) : state.players[defenderId]);

      if (dealsIn(a, step)) {
        const p = power(state, a);
        if (blockers.length === 0) {
          const hitTarget = defendingTarget();
          if (hitTarget) hits.push({ source: a, target: hitTarget, amount: p });
        } else if (alive.length === 0) {
          // Blocked, but every blocker is gone: only a trampler still hurts the player (rule 702.19e).
          const hitTarget = defendingTarget();
          if (kw(state, a, "trample") && hitTarget) hits.push({ source: a, target: hitTarget, amount: p });
        } else {
          const chosen = split.has(attacker) ? undefined : assigned[attacker];
          const usable = chosen && Object.keys(chosen).every((k) => k === defenderId || alive.includes(k));
          const plan = usable ? chosen : planDamage(state, a, alive, defenderId);
          split.add(attacker);
          for (const [targetId, amount] of Object.entries(plan)) {
            const hitTarget = targetId === defenderId ? defendingTarget() : find(targetId);
            if (hitTarget) hits.push({ source: a, target: hitTarget, amount });
          }
        }
      }
      for (const id of alive) {
        const b = find(id);
        if (dealsIn(b, step)) hits.push({ source: b, target: a, amount: power(state, b) }); // blockers hit back
      }
    }

    const gains = new Map<Permanent, number>(); // lifelink: each source is its own life gain
    const sacrifice = new Set<Permanent>(); // "When this creature deals combat damage, sacrifice it"
    const poison: { player: PlayerId; amount: number }[] = [];
    const preventable = canPrevent(state);
    for (const hit of state.preventCombat && preventable ? [] : hits) {
      const { source, target } = hit;
      let { amount } = hit;
      // Protection: damage from a source with the quality it is protected from is prevented.
      if (preventable && !("battlefield" in target) && isProtectedFrom(state, target, qualityOfPerm(state, source))) amount = 0;
      if (preventable && !("battlefield" in target) && parseCard(getCard(state, target.card.defId)).preventDamageToSelf) amount = 0; // "Prevent all damage that would be dealt to ~"
      if (amount <= 0) continue; // rule 510.1a: 0 or less damage isn't dealt
      const toPlayer = "battlefield" in target;
      if (toPlayer && state.players[source.card.owner].doubleDamage && target.id !== source.card.owner) amount *= 2;
      // "Prevent the next 3 damage that would be dealt to it this turn", "prevent 1 of that damage" (a planeswalker has no shield)
      if (toPlayer || getCard(state, target.card.defId).type !== "planeswalker") {
        const through = absorbDamage(state, toPlayer ? { k: "player", id: target.id } : { k: "perm", perm: target }, amount);
        if (through < amount) events.push({ type: "effect", text: `${amount - through} of the combat damage to ${toPlayer ? playerLabel(target.id) : nameOf(state, target)} is prevented.` });
        amount = through;
        if (amount <= 0) continue;
      }
      const infect = kw(state, source, "infect");
      const shrink = infect || (!toPlayer && kw(state, source, "wither")); // wither: damage to a creature is -1/-1 counters (to a player it is ordinary damage)
      if (toPlayer) target.damagedThisTurn = true;
      if (toPlayer && !infect) {
        target.life -= amount;
        target.lifeLostThisTurn = (target.lifeLostThisTurn ?? 0) + amount;
      } else if (toPlayer) {
        poison.push({ player: target.id, amount });
      } else if (getCard(state, target.card.defId).type === "planeswalker") {
        target.loyalty = (target.loyalty ?? 0) - amount; // damage to a planeswalker removes loyalty
      } else {
        if (shrink) {
          target.minusCounters = (target.minusCounters ?? 0) + amount;
          target.infected = true;
        } else target.damage += amount;
        creatureDamaged(state, target, target.card.owner, amount); // "Whenever ~ is dealt damage"
        (target.damagedBy ??= []).push(source.card.iid);
        if (kw(state, source, "deathtouch")) target.deathtouched = true;
      }
      if (kw(state, source, "lifelink")) gains.set(source, (gains.get(source) ?? 0) + amount);
      events.push({ type: "combatDamage", source: source.card.iid, target: toPlayer ? target.id : target.card.iid, amount, ...(infect ? { infect: true as const } : {}) });
      // Toxic: a player dealt combat damage by it also gets that many poison counters.
      const toxic = toPlayer ? (parseCard(getCard(state, source.card.defId)).toxic ?? 0) : 0;
      if (toPlayer && toxic > 0) poison.push({ player: target.id, amount: toxic });
      if (source.sacOnDamage) sacrifice.add(source);
      hostDamageLife(state, source, amount, events); // Spirit Link
      if (toPlayer && onBoard(source.card.iid)) {
        queueTriggers(state, source.card, source.card.owner, "combatDamagePlayer");
        queueTriggers(state, source.card, source.card.owner, "damageOpp"); // "whenever ~ deals damage to an opponent" (combat damage is damage too)
        queueDamageDraws(state, source);
        // Auras on the creature: "Whenever enchanted creature deals damage to an opponent, ..."
        for (const owner of Object.values(state.players)) {
          for (const aura of owner.battlefield) if (aura.attachedTo === source.card.iid) queueTriggers(state, aura.card, owner.id, "hostDamagesPlayer");
        }
      }
    }
    for (const p of poison) addPoison(state, p.player, p.amount, events);
    for (const doomed of sacrifice) {
      const owner = Object.values(state.players).find((p) => p.battlefield.includes(doomed));
      if (owner) sacrificePermanent(state, doomed, owner.id, events);
    }
    for (const [source, amount] of gains) {
      const controller = Object.values(state.players).find((p) => p.battlefield.includes(source))?.id ?? source.card.owner;
      changeLife(state, controller, amount, events);
    }
  };

  for (const step of anyFirstStrike ? (["first", "regular"] as const) : (["regular"] as const)) {
    runStep(step);
    checkStateBasedActions(state, events);
    if (state.winner) {
      state.combat = null;
      return;
    }
  }

  state.combat = null;
  // "There is an additional combat phase after this phase": another declare-attackers step before the second main phase.
  const next = (state.extraCombats ?? 0) > 0 ? "attackers" : "main2";
  if (next === "attackers") state.extraCombats = (state.extraCombats ?? 1) - 1;
  state.phase = next;
  events.push({ type: "phaseChanged", phase: next });
}
