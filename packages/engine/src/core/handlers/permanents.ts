import { CONJURED, getCard } from "../../cards.js";
import { parseCard } from "../../oracle.js";
import { OPPONENT } from "../../types.js";
import type { GameState, Permanent, PlayerId } from "../../types.js";
import { findPermanentOrNull, isCreature, nameOf, playerLabel, powerOf, subtypesOf } from "../permanents.js";
import { changeLife, makeTokenCopy, putCounters, tapPerm } from "../zones.js";
import { subjectsOf } from "../targets.js";
import { queueTriggers } from "../triggers.js";
import { cardAnywhere, plural, noteTempSource, type EffectHandlers, type EffectOf, type EffectRun } from "./shared.js";

function tapOrUntapAll({ state, ctx, say }: EffectRun, effect: EffectOf<"tap" | "untap">): void {
  for (const s of subjectsOf(state, effect.what, ctx)) {
    if (s.k !== "perm") continue;
    if (effect.type === "tap") tapForController(state, s.perm, s.owner, ctx.controller);
    else if (s.perm.tapped && s.perm.stun) {
      s.perm.stun -= 1;
      say(`${nameOf(state, s.perm)} stays tapped: a stun counter is removed instead.`);
    } else s.perm.tapped = false;
  }
}

/** "Whenever you tap an untapped creature an opponent controls" (Sharae of Numbing Depths, Solitary Sanctuary) triggers for whoever's effect did it. */
function tapForController(state: GameState, perm: Permanent, owner: PlayerId, tapper: PlayerId): void {
  const theirUntappedCreature = !perm.tapped && owner !== tapper && isCreature(state, perm);
  tapPerm(state, perm, owner);
  if (!theirUntappedCreature) return;
  for (const watcher of state.players[tapper].battlefield) queueTriggers(state, watcher.card, tapper, "youTapOpp");
}

/** Changes to permanents: counters, power and toughness, keywords, tapping, control and what they are. */
export const PERMANENT_EFFECTS = {
  /** Woeleecher: takes a -1/-1 counter off, and only if one was there, the controller gains life. */
  removeMinusCounter({ state, ctx, events, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm" || !(s.perm.minusCounters ?? 0)) continue;
      s.perm.minusCounters = (s.perm.minusCounters ?? 0) - 1;
      say(`A -1/-1 counter is removed from ${nameOf(state, s.perm)}.`);
      if (effect.gain) changeLife(state, ctx.controller, effect.gain, events);
    }
  },
  /** Leech Medic: a card that is not in any deck is made and put into the controller's hand. */
  conjureCard({ state, ctx, say }, effect) {
    const def = CONJURED[effect.card];
    state.cards[def.id] ??= def;
    state.players[ctx.controller].hand.push({ iid: `gen${state.nextId++}`, defId: def.id, owner: ctx.controller });
    say(`${playerLabel(ctx.controller)} puts ${def.name} into their hand.`);
  },
  /** A creature with a spell beside it becomes prepared: a copy of the spell can be cast from it. */
  becomePrepared({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const prepare = parseCard(getCard(state, s.perm.card.defId)).prepare;
      if (!prepare || s.perm.prepared) continue;
      state.cards[prepare.id] ??= prepare;
      s.perm.prepared = prepare.id;
      say(`${nameOf(state, s.perm)} becomes prepared.`);
    }
  },
  /** Blitz Leech: every counter on the creature goes. */
  removeAllCounters({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.counters = 0;
      s.perm.minusCounters = 0;
      s.perm.kwCounters = undefined;
      s.perm.stun = undefined;
      say(`All counters are removed from ${nameOf(state, s.perm)}.`);
    }
  },
  putSavedCounters({ state, ctx, say }, effect) {
    const died = ctx.died;
    if (!died || (died.counters === 0 && died.minusCounters === 0)) return;
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      putCounters(state, s.perm, s.owner, died.counters);
      if (died.minusCounters) s.perm.minusCounters = (s.perm.minusCounters ?? 0) + died.minusCounters;
      say(`${ctx.sourceName}'s counters are put on ${nameOf(state, s.perm)}.`);
    }
  },
  offspringCopy({ state, ctx, events, say }) {
    // A 1/1 token copy (rule 702.175): the card as printed, with base power and toughness 1/1.
    const card = cardAnywhere(state, ctx.sourceId);
    if (!card) return;
    makeTokenCopy(state, getCard(state, card.printed ?? card.defId), ctx.controller, events);
    say(`${ctx.sourceName}'s offspring: a 1/1 token copy enters.`);
  },
  copySelfToken({ state, ctx, events, say }) {
    // A token copy of the permanent as it is printed (or as it last was, when it has left the battlefield).
    const card = cardAnywhere(state, ctx.sourceId);
    const defId = card ? (card.printed ?? card.defId) : ctx.sourceDefId;
    if (!defId) return;
    makeTokenCopy(state, getCard(state, defId), ctx.controller, events, false);
    say(`${ctx.sourceName}: a token copy of it enters.`);
  },
  addLoyalty({ state, ctx, say }, effect) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (!self) return;
    self.loyalty = (self.loyalty ?? 0) + effect.amount;
    say(`${ctx.sourceName} gets ${plural(effect.amount, "loyalty counter")} (${self.loyalty}).`);
  },
  solve({ state, ctx, say }) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (!self || self.solved) return;
    self.solved = true;
    say(`${ctx.sourceName} is solved.`);
  },
  tap: tapOrUntapAll,
  untap: tapOrUntapAll,
  regenerate({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.regenShield = (s.perm.regenShield ?? 0) + 1;
      say(`${nameOf(state, s.perm)} gets a regeneration shield until end of turn.`);
    }
  },
  noRegen() {},
  namedCounters({ state, ctx, say, value }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const n = value(effect.amount);
      const now = s.perm.named?.[effect.name] ?? 0;
      const next = effect.remove ? Math.max(0, now - n) : now + n;
      s.perm.named = { ...s.perm.named, [effect.name]: next };
      if (next === 0) delete s.perm.named[effect.name];
      say(`${nameOf(state, s.perm)} ${effect.remove ? "loses" : "gets"} ${plural(effect.remove ? now - next : n, `${effect.name} counter`)}.`);
      if (!effect.remove) queueTriggers(state, s.perm.card, s.owner, "namedLimit");
    }
  },
  addCounters({ state, ctx, say, value }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      if (effect.kind === "minus") s.perm.minusCounters = (s.perm.minusCounters ?? 0) + value(effect.amount);
      else putCounters(state, s.perm, s.owner, value(effect.amount));
      say(`${nameOf(state, s.perm)} gets ${plural(value(effect.amount), effect.kind === "minus" ? "-1/-1 counter" : "+1/+1 counter")}.`);
    }
  },
  gainControl({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm" || s.owner === ctx.controller) continue;
      const from = state.players[s.owner].battlefield;
      from.splice(from.indexOf(s.perm), 1);
      if (effect.whileSource) s.perm.controlledWhile = { source: ctx.sourceId, owner: s.owner };
      else s.perm.controlReturn = s.perm.controlReturn ?? s.owner; // it goes back at the end of the turn
      s.perm.summoningSick = true;
      state.players[ctx.controller].battlefield.push(s.perm);
      say(`${playerLabel(ctx.controller)} gains control of ${nameOf(state, s.perm)} ${effect.whileSource ? `for as long as they control ${ctx.sourceName}` : "until end of turn"}.`);
    }
  },
  addSubtype({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm" || subtypesOf(state, s.perm).includes(effect.subtype)) continue;
      s.perm.addedSubtypes = [...(s.perm.addedSubtypes ?? []), effect.subtype];
      say(`${nameOf(state, s.perm)} becomes a ${effect.subtype[0].toUpperCase()}${effect.subtype.slice(1)} in addition to its other types.`);
    }
  },
  combatDamageDraw({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.damageDraws = [...(s.perm.damageDraws ?? []), { player: ctx.controller, source: ctx.sourceName }];
      say(`This turn, whenever ${nameOf(state, s.perm)} deals combat damage to a player, ${playerLabel(ctx.controller)} draws a card.`);
    }
  },
  crewed({ state, ctx, say }) {
    for (const s of subjectsOf(state, { t: "self" }, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.crewed = true;
      say(`${nameOf(state, s.perm)} becomes an artifact creature until end of turn.`);
    }
  },
  grantIfPowerBelow({ state, ctx, say }, effect) {
    for (const perm of state.players[ctx.controller].battlefield) {
      if (!isCreature(state, perm) || powerOf(state, perm) >= (ctx.x ?? 0)) continue;
      perm.tempKeywords = [...(perm.tempKeywords ?? []), effect.keyword];
    }
    say(`Creatures with power less than ${ctx.x ?? 0} gain ${effect.keyword} until end of turn.`);
  },
  setBase({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.tempBase = { power: effect.power, toughness: effect.toughness };
      say(`${nameOf(state, s.perm)} becomes ${effect.power}/${effect.toughness} until end of turn.`);
    }
  },
  tapOrUntap({ state, ctx, startPick }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm" || state.pendingPick) continue;
      startPick({
        player: ctx.controller,
        prompt: `${nameOf(state, s.perm)}: tap it or untap it?`,
        kind: "toggle",
        options: ["tap", "untap"],
        optional: true,
        owner: ctx.controller,
        remaining: 1,
        ordered: [],
        toggleIid: s.perm.card.iid,
      });
    }
  },
  stun({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm" || (effect.theirsOnly && s.owner === ctx.controller)) continue;
      const n = effect.amount ?? 1;
      s.perm.stun = (s.perm.stun ?? 0) + n;
      say(n === 1 ? `${nameOf(state, s.perm)} gets a stun counter: its next untap is skipped.` : `${nameOf(state, s.perm)} gets ${n} stun counters: its next ${n} untaps are skipped.`);
    }
  },
  becomeCopy({ state, ctx, say }, effect) {
    // It keeps its counters, damage and everything else that isn't printed on the card.
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    const model = subjectsOf(state, effect.what, ctx).find((x) => x.k === "perm");
    if (!self || !model || model.k !== "perm") return;
    self.card = { ...self.card, defId: model.perm.card.defId, printed: self.card.printed ?? self.card.defId };
    say(`${ctx.sourceName} becomes a copy of ${nameOf(state, model.perm)}.`);
  },
  exileIfDies({ state, ctx }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) if (s.k === "perm") s.perm.exileOnDeath = true;
  },
  grantDiesReturn({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.diesReturn = true;
      say(`${nameOf(state, s.perm)} will return to the battlefield if it dies this turn.`);
    }
  },
  becomeSubtype({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.subtypesOverride = [effect.subtype];
      say(`${nameOf(state, s.perm)} becomes a ${effect.subtype}.`);
    }
  },
  distributeCounters({ state, ctx, say }, effect) {
    // The split is the one announced with the targets: the first target gets any extra (3 = 3, 2+1, or 1+1+1).
    const chosen = ctx.targets.filter((t) => t.kind !== "none");
    const hit: { perm: Permanent; owner: PlayerId }[] = [];
    chosen.forEach((t, i) => {
      const found = t.kind === "permanent" ? findPermanentOrNull(state, t.iid) : null;
      if (!found) return;
      putCounters(state, found.perm, found.owner.id, Math.floor(effect.total / chosen.length) + (i < effect.total % chosen.length ? 1 : 0));
      hit.push({ perm: found.perm, owner: found.owner.id });
    });
    if (effect.double) for (const h of hit) putCounters(state, h.perm, h.owner, h.perm.counters ?? 0);
    for (const h of hit) say(`${nameOf(state, h.perm)} now has ${plural(h.perm.counters ?? 0, "+1/+1 counter")}.`);
  },
  attach({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      const source = findPermanentOrNull(state, ctx.sourceId)?.perm;
      if (s.k !== "perm" || !source) continue;
      source.attachedTo = s.perm.card.iid;
      say(`${nameOf(state, source)} is attached to ${nameOf(state, s.perm)}.`);
    }
  },
  pump({ state, ctx, say, value }, effect) {
    // "gets +1/+0 for each other attacking Goblin": the amount is multiplied by a count
    const times = effect.per ? value({ count: effect.per }) : 1;
    const dp = effect.power * times;
    const dt = effect.toughness * times;
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      noteTempSource(s.perm, ctx);
      s.perm.powerBonus = (s.perm.powerBonus ?? 0) + dp;
      s.perm.toughnessBonus = (s.perm.toughnessBonus ?? 0) + dt;
      const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
      say(`${nameOf(state, s.perm)} gets ${sign(dp)}/${sign(dt)} until end of turn.`);
    }
  },
  ifSubtypeGrant({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const types = subtypesOf(state, s.perm);
      if (!types.includes(effect.subtype)) continue;
      s.perm.tempKeywords = [...(s.perm.tempKeywords ?? []), effect.keyword];
      say(`${nameOf(state, s.perm)} gains ${effect.keyword} until end of turn.`);
    }
  },
  tapForBonus({ state, ctx, startPick }) {
    const source = findPermanentOrNull(state, ctx.sourceId);
    const options = state.players[ctx.controller].battlefield.filter((p) => isCreature(state, p) && !p.tapped && p.card.iid !== ctx.sourceId).map((p) => p.card.iid);
    if (!source || options.length === 0 || state.pendingPick) return;
    startPick({
      player: ctx.controller,
      prompt: `${ctx.sourceName}: tap any number of your untapped creatures. It gets +1/+1 for each one (click "Done" when you have enough).`,
      kind: "tapSome",
      options,
      optional: true,
      owner: ctx.controller,
      remaining: options.length,
      ordered: [],
      toggleIid: ctx.sourceId,
    });
  },
  untargetable({ state, ctx, say }, effect) {
    const opponent = OPPONENT[ctx.controller];
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      noteTempSource(s.perm, ctx);
      s.perm.untargetableBy = [...new Set([...(s.perm.untargetableBy ?? []), opponent])];
      say(`${nameOf(state, s.perm)} can't be the target of spells or abilities ${playerLabel(opponent)} controls this turn.`);
    }
  },
  grant({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      noteTempSource(s.perm, ctx);
      s.perm.tempKeywords = [...(s.perm.tempKeywords ?? []), effect.keyword];
      say(`${nameOf(state, s.perm)} gains ${effect.keyword} until end of turn.`);
    }
  },
} satisfies EffectHandlers;
