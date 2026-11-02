import { getCard } from "../../cards.js";
import type { GameEvent } from "../../actions.js";
import type { Amount, Effect, PendingPick, RunContext } from "../../effects.js";
import { parseCard } from "../../oracle.js";
import { nextRandom } from "../../state.js";
import type { CardInstance, GameState, Permanent, PlayerId } from "../../types.js";
import { canPrevent, findPermanentOrNull, isPlaneswalker, nameOf, playerLabel, toughnessOf } from "../permanents.js";
import { addPoison, changeLife } from "../zones.js";
import { creatureDamaged, excessDamageDealt, queueTriggers } from "../triggers.js";
import { absorbDamage, hostDamageLife } from "../prevention.js";

/** A spell, ability or creature dealing damage, with what changes how its damage works. */
export interface DamageSource {
  name: string;
  controller: PlayerId;
  deathtouch: boolean;
  lifelink: boolean;
  /** Infect: damage to players is poison counters, damage to creatures is -1/-1 counters. */
  infect: boolean;
  /** Wither: damage to creatures is -1/-1 counters (damage to players is ordinary damage). */
  wither?: boolean;
  /** The permanent that deals it, when it is one (Spirit Link looks at what a creature deals). */
  perm?: Permanent;
}

/** What every effect handler gets: the game, the spell or ability being run, and helpers bound to them. */
export interface EffectRun {
  state: GameState;
  ctx: RunContext;
  events: GameEvent[];
  /** The source of the effects as a damage dealer. */
  trait: DamageSource;
  say: (text: string) => void;
  value: (amount: Amount) => number;
  /** "It can't be regenerated" is part of this spell. */
  preventRegen: boolean;
  /** A choice among cards: the game waits, and the effects after this one run once it is answered. */
  startPick: (pick: PendingPick) => void;
  /** Runs more effects of the same spell or ability ("if it was kicked, ..."). */
  nested: (effects: Effect[]) => void;
}

export type EffectOf<T extends Effect["type"]> = Extract<Effect, { type: T }>;
export type EffectHandlers = { [T in Effect["type"]]?: (run: EffectRun, effect: EffectOf<T>) => void };

/** A random number from 0 up to (not including) 1, taken from the game's seeded generator. */
export function rngNext(state: GameState): number {
  const [r, next] = nextRandom(state.rng);
  state.rng = next;
  return r;
}

/** Damage that isn't combat damage (spells, abilities). Deathtouch and lifelink on the source count. */
export function dealDamage(
  state: GameState,
  source: DamageSource,
  target: { k: "player"; id: PlayerId } | { k: "perm"; perm: Permanent },
  amount: number,
  events: GameEvent[],
): void {
  if (amount <= 0) return;
  const preventable = canPrevent(state);
  // "Prevent all damage that would be dealt to ~."
  if (preventable && target.k === "perm" && parseCard(getCard(state, target.perm.card.defId)).preventDamageToSelf) {
    events.push({ type: "effect", text: `The damage to ${nameOf(state, target.perm)} is prevented.` });
    return;
  }
  // "Prevent all noncombat damage that would be dealt to you and creatures you control."
  const victim = target.k === "player" ? target.id : isPlaneswalker(state, target.perm) ? undefined : findPermanentOrNull(state, target.perm.card.iid)?.owner.id;
  if (preventable && victim && state.players[victim].battlefield.some((p) => parseCard(getCard(state, p.card.defId)).preventNoncombat)) {
    events.push({ type: "effect", text: `The damage to ${target.k === "player" ? playerLabel(target.id) : nameOf(state, target.perm)} is prevented.` });
    return;
  }
  if (target.k === "player" && state.players[source.controller].doubleDamage && target.id !== source.controller) amount *= 2; // "it deals double that damage instead"
  // "Prevent the next 3 damage that would be dealt to it this turn", "prevent 1 of that damage" (a planeswalker has no shield)
  if (target.k === "player" || !isPlaneswalker(state, target.perm)) {
    const before = amount;
    amount = absorbDamage(state, target, amount);
    if (amount < before) events.push({ type: "effect", text: `${before - amount} of the damage to ${target.k === "player" ? playerLabel(target.id) : nameOf(state, target.perm)} is prevented.` });
    if (amount <= 0) return;
  }
  state.lastExcess = 0; // only damage to a creature has an excess
  if (target.k === "player") {
    state.players[target.id].damagedThisTurn = true;
    if (source.infect) addPoison(state, target.id, amount, events);
    else changeLife(state, target.id, -amount, events);
  } else if (isPlaneswalker(state, target.perm)) {
    target.perm.loyalty = (target.perm.loyalty ?? 0) - amount; // damage to a planeswalker removes that much loyalty
  } else {
    // Excess damage (rule 120.4a): more than it took to destroy it, counting the damage already marked and deathtouch.
    const lethal = Math.max(0, toughnessOf(state, target.perm) - target.perm.damage);
    const needed = source.deathtouch ? Math.min(1, lethal) : lethal;
    state.lastExcess = Math.max(0, amount - needed); // "you gain life equal to the excess damage dealt this way"
    if (amount > needed && victim) excessDamageDealt(state, victim);
    if (source.infect || source.wither) {
      target.perm.minusCounters = (target.perm.minusCounters ?? 0) + amount;
      target.perm.infected = true;
    } else target.perm.damage += amount;
    if (source.deathtouch) target.perm.deathtouched = true;
    if (victim) creatureDamaged(state, target.perm, victim, amount); // "Whenever ~ is dealt damage"
  }
  events.push({ type: "damage", source: source.name, target: target.k === "player" ? target.id : target.perm.card.iid, amount });
  if (source.lifelink) changeLife(state, source.controller, amount, events);
  if (source.perm) hostDamageLife(state, source.perm, amount, events);
  // "Whenever ~ deals damage to an opponent" (Thieving Magpie)
  if (source.perm && target.k === "player" && target.id !== source.controller) queueTriggers(state, source.perm.card, source.controller, "damageOpp");
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Remembers which spell or ability put an "until end of turn" effect on a permanent. */
export function noteTempSource(perm: Permanent, ctx: { sourceName: string; sourceDefId?: string }): void {
  const list = (perm.tempFrom ??= []);
  if (!list.some((x) => x.name === ctx.sourceName)) list.push({ name: ctx.sourceName, ...(ctx.sourceDefId ? { defId: ctx.sourceDefId } : {}) });
}

/** A card wherever it is: on the battlefield, or in a hand, graveyard, library or exile. */
export function cardAnywhere(state: GameState, iid: string): CardInstance | undefined {
  for (const p of Object.values(state.players)) {
    const card = p.battlefield.find((perm) => perm.card.iid === iid)?.card ?? [...p.hand, ...p.graveyard, ...p.library, ...p.exile].find((c) => c.iid === iid);
    if (card) return card;
  }
  return undefined;
}
