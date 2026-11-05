import { getCard } from "../cards.js";
import type { GameEvent } from "../actions.js";
import { parseCard } from "../oracle.js";
import type { GameState, Permanent, PlayerId } from "../types.js";
import { canPrevent } from "./permanents.js";
import { changeLife } from "./zones.js";

// Damage prevention that is not "prevent all": shields ("prevent the next 3 damage that would be dealt to it this turn"), and "prevent 1 of that damage" (Urza's Armor).

/** "If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead": how many times it is doubled. */
export function damageDoublings(state: GameState, controller: PlayerId, sourceIsCreature: boolean, victimController: PlayerId | undefined): number {
  let n = 0;
  for (const perm of state.players[controller].battlefield) {
    const d = parseCard(getCard(state, perm.card.defId)).damageDoubler;
    if (!d || (d.creaturesOnly && !sourceIsCreature)) continue;
    if (d.opponentSideOnly && (victimController === undefined || victimController === controller)) continue;
    n++;
  }
  return n;
}

/**
 * How much of `amount` damage still gets through to a player or a creature. Uses up the shields on it as it goes. (Nothing is prevented
 * while damage can't be prevented.)
 */
export function absorbDamage(state: GameState, target: { k: "player"; id: PlayerId } | { k: "perm"; perm: Permanent }, amount: number): number {
  if (amount <= 0 || !canPrevent(state)) return amount;
  if (target.k === "player") {
    // "If a source would deal damage to you, prevent 1 of that damage": every such permanent of the player, each in turn
    for (const p of state.players[target.id].battlefield) amount -= Math.min(amount, parseCard(getCard(state, p.card.defId)).reduceDamageToYou ?? 0);
  }
  const holder = target.k === "player" ? state.players[target.id] : target.perm;
  const shield = holder.preventShield ?? 0;
  if (shield > 0 && amount > 0) {
    const used = Math.min(shield, amount);
    holder.preventShield = shield - used || undefined;
    amount -= used;
  }
  return amount;
}

/** Spirit Link: "Whenever enchanted creature deals damage, you gain that much life": each such Aura on the creature gains its controller the damage dealt. */
export function hostDamageLife(state: GameState, source: Permanent, amount: number, events: GameEvent[]): void {
  if (amount <= 0) return;
  for (const owner of Object.values(state.players)) {
    for (const aura of owner.battlefield) {
      if (aura.attachedTo === source.card.iid && parseCard(getCard(state, aura.card.defId)).hostDamageLife) changeLife(state, owner.id, amount, events);
    }
  }
}
