import { getCard } from "../../cards.js";
import type { Permanent, PlayerId } from "../../types.js";
import { isBasicLand } from "../../deck.js";
import { canPrevent, findPermanentOrNull, isProtectedFrom, kw, lethalFor, nameOf, playerLabel, powerOf, qualityOfDef, qualityOfPerm } from "../permanents.js";
import { addPoison, changeLife } from "../zones.js";
import { subjectsOf } from "../targets.js";
import { dealDamage, type EffectHandlers, type EffectOf, type EffectRun } from "./shared.js";

function changeLifeOf({ state, ctx, events, value }: EffectRun, effect: EffectOf<"gainLife" | "loseLife">): void {
  for (const s of subjectsOf(state, effect.who, ctx)) {
    if (s.k === "player") changeLife(state, s.id, effect.type === "gainLife" ? value(effect.amount) : -value(effect.amount), events);
  }
}

function fightOrBite({ state, ctx, events, say }: EffectRun, effect: EffectOf<"fight" | "bite">): void {
  const first = subjectsOf(state, effect.type === "fight" ? effect.a : effect.from, ctx).find((x) => x.k === "perm");
  const second = subjectsOf(state, effect.type === "fight" ? effect.b : effect.to, ctx).find((x) => x.k === "perm");
  if (first?.k !== "perm" || second?.k !== "perm") return; // a target is gone: nothing happens
  const traitOf = (perm: Permanent, controller: PlayerId) => ({ perm, name: nameOf(state, perm), controller, deathtouch: kw(state, perm, "deathtouch"), lifelink: kw(state, perm, "lifelink"), infect: kw(state, perm, "infect") });
  const hit = (from: Permanent, fromOwner: PlayerId, to: Permanent, amount = Math.max(0, powerOf(state, from)) * (effect.type === "bite" ? (effect.times ?? 1) : 1)) => {
    const quality = qualityOfPerm(state, from);
    if (isProtectedFrom(state, to, quality) && canPrevent(state)) return say(`${nameOf(state, to)} has protection: the damage is prevented.`);
    dealDamage(state, traitOf(from, fromOwner), { k: "perm", perm: to }, amount, events);
  };
  const a = { perm: first.perm, owner: first.owner };
  const b = { perm: second.perm, owner: second.owner };
  // Ram Through: with trample, the creature takes only what is lethal and the rest goes to its controller instead.
  if (effect.type === "bite" && effect.trampleExcess && kw(state, a.perm, "trample")) {
    const power = Math.max(0, powerOf(state, a.perm));
    const lethal = Math.min(power, lethalFor(state, a.perm, b.perm));
    hit(a.perm, a.owner, b.perm, lethal);
    dealDamage(state, traitOf(a.perm, a.owner), { k: "player", id: b.owner }, power - lethal, events);
    return;
  }
  hit(a.perm, a.owner, b.perm);
  if (effect.type === "fight") hit(b.perm, b.owner, a.perm); // power doesn't change from damage, so the order doesn't matter
}

/** Damage, fights and the rules of combat. */
export const DAMAGE_EFFECTS = {
  gainLife: changeLifeOf,
  loseLife: changeLifeOf,
  poison({ state, ctx, events, value }, effect) {
    for (const s of subjectsOf(state, effect.who, ctx)) if (s.k === "player") addPoison(state, s.id, value(effect.amount), events);
  },
  fight: fightOrBite,
  bite: fightOrBite,
  /** Leeches: the player loses every poison counter, and takes that much damage. */
  poisonBurn({ state, ctx, events, trait, say }, effect) {
    for (const s of subjectsOf(state, effect.who, ctx)) {
      if (s.k !== "player") continue;
      const n = state.players[s.id].poison ?? 0;
      state.players[s.id].poison = undefined;
      say(`${playerLabel(s.id)} loses ${n} poison counter${n === 1 ? "" : "s"}.`);
      if (n > 0) dealDamage(state, trait, s, n, events);
    }
  },
  damage({ state, ctx, events, trait, say, value, preventRegen }, effect) {
    for (const s of subjectsOf(state, effect.to, ctx)) {
      if (s.k === "player") dealDamage(state, trait, s, value(effect.amount), events);
      else if (s.k === "perm") {
        if (ctx.sourceDefId && isProtectedFrom(state, s.perm, qualityOfDef(getCard(state, ctx.sourceDefId))) && canPrevent(state)) {
          say(`${nameOf(state, s.perm)} has protection: the damage is prevented.`);
          continue;
        }
        if (preventRegen) s.perm.noRegen = true;
        dealDamage(state, trait, s, value(effect.amount), events);
        if (value(effect.amount) > 0 && findPermanentOrNull(state, ctx.sourceId)) (s.perm.damagedBy ??= []).push(ctx.sourceId);
      }
    }
  },
  cantBlockThisTurn({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.cantBlockTurn = true;
      say(`${nameOf(state, s.perm)} can't block this turn.`);
    }
  },
  sacOnDamage({ state, ctx }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k === "perm") s.perm.sacOnDamage = true;
    }
  },
  doubleDamage({ state, ctx, say }) {
    state.players[ctx.controller].doubleDamage = true;
    say(`Damage ${playerLabel(ctx.controller)}'s sources deal to an opponent is doubled this turn.`);
  },
  noGroundBlock({ state, say }) {
    state.noGroundBlock = true;
    say("Creatures without flying can't block this turn.");
  },
  loseDefender({ state, ctx }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k === "perm") s.perm.tempNoDefender = true;
    }
  },
  winGame({ state, ctx, events }) {
    state.winner = ctx.controller;
    events.push({ type: "gameWon", player: ctx.controller });
  },
  unblockable({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.unblockableTurn = true;
      say(`${nameOf(state, s.perm)} can't be blocked this turn.`);
    }
  },
  noPrevention({ state, say }) {
    state.noPrevention = true;
    say("Damage can't be prevented this turn.");
  },
  damagePerNonbasic({ state, events, trait }) {
    for (const player of Object.values(state.players)) {
      const nonbasic = player.battlefield.filter((p) => getCard(state, p.card.defId).type === "land" && !isBasicLand(getCard(state, p.card.defId))).length;
      dealDamage(state, trait, { k: "player", id: player.id }, nonbasic, events);
    }
  },
  fog({ state, say }) {
    state.preventCombat = true;
    say("All combat damage this turn is prevented.");
  },
  mustBeBlocked({ state, ctx }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) if (s.k === "perm") s.perm.mustBeBlocked = true;
  },
  assignByToughness({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.damageByToughness = true;
      say(`${nameOf(state, s.perm)} assigns combat damage equal to its toughness this turn.`);
    }
  },
} satisfies EffectHandlers;
