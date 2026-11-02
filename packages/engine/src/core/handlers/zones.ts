import { getCard } from "../../cards.js";
import type { CardInstance, Permanent, PlayerId } from "../../types.js";
import { colorsOfPerm, findPermanentOrNull, isArtifactDef, isCreature, kw, nameOf, playerLabel } from "../permanents.js";
import { isToken, makeToken, putCounters, putIntoGraveyard, regenerateInstead, removeFromBattlefield, sacrificePermanent, spellLeavesStack } from "../zones.js";
import { creatureEntered, queueTriggers } from "../triggers.js";
import { subjectsOf } from "../targets.js";
import { plural, type EffectHandlers } from "./shared.js";

/** Cards moving between the battlefield, the hand, the graveyard and exile, and tokens being made. */
export const ZONE_EFFECTS = {
  destroy({ state, ctx, events, say, preventRegen }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm" || kw(state, s.perm, "indestructible")) continue;
      if (preventRegen) s.perm.noRegen = true;
      if (regenerateInstead(state, s.perm)) {
        say(`${nameOf(state, s.perm)} regenerates.`);
        continue;
      }
      if (isCreature(state, s.perm)) ctx.destroyed = { ...ctx.destroyed, [s.owner]: (ctx.destroyed?.[s.owner] ?? 0) + 1 };
      putIntoGraveyard(state, s.perm, s.owner, events);
    }
  },
  destroyArtifacts({ state, events, say, value }, effect) {
    const most = value(effect.mvAtMost);
    for (const player of Object.values(state.players)) {
      for (const perm of player.battlefield.filter((p) => isArtifactDef(getCard(state, p.card.defId)) && getCard(state, p.card.defId).cost <= most)) {
        if (kw(state, perm, "indestructible")) continue;
        if (regenerateInstead(state, perm)) say(`${nameOf(state, perm)} regenerates.`);
        else putIntoGraveyard(state, perm, player.id, events);
      }
    }
  },
  exile({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const card = removeFromBattlefield(state, s.perm, s.owner);
      if (card) {
        state.players[card.owner].exile.push(card);
        say(`${getCard(state, card.defId).name} is exiled.`);
      }
    }
  },
  // Airbend: exile it; while it stays exiled its owner may cast it for {2} rather than its mana cost (a token just ceases to exist).
  airbend({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const name = nameOf(state, s.perm);
      const card = removeFromBattlefield(state, s.perm, s.owner);
      if (!card) continue;
      if (isToken(card)) {
        say(`${name} is exiled and ceases to exist.`);
        continue;
      }
      state.players[card.owner].exile.push(card);
      (state.players[card.owner].mayPlay ??= []).push({ iid: card.iid, source: "airbend", always: true, payGeneric: 2 });
      say(`${name} is airbent: its owner may cast it for {2} while it is exiled.`);
    }
  },
  bounce({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k === "stack" && s.item.kind === "spell") {
        // "Return target spell to its owner's hand": it leaves the stack without resolving.
        state.stack.splice(state.stack.indexOf(s.item), 1);
        spellLeavesStack(state, s.item, "hand");
        say(`${getCard(state, s.item.card.defId).name} returns to its owner's hand.`);
        continue;
      }
      if (s.k !== "perm") continue;
      const card = removeFromBattlefield(state, s.perm, s.owner);
      if (card) {
        state.players[card.owner].hand.push(card);
        say(`${getCard(state, card.defId).name} returns to its owner's hand.`);
      }
    }
  },
  blink({ state, ctx, events, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const card = removeFromBattlefield(state, s.perm, s.owner);
      if (!card) continue;
      // It comes back as a new object: no counters, damage or attachments, and its "enters" abilities trigger again.
      state.players[card.owner].battlefield.push({ card, tapped: false, summoningSick: true, damage: 0 });
      events.push({ type: "permanentEntered", player: card.owner, iid: card.iid });
      queueTriggers(state, card, card.owner, "enters");
      creatureEntered(state, card, card.owner);
      say(`${getCard(state, card.defId).name} is exiled and returns to the battlefield.`);
    }
  },
  bounceOwn({ state, ctx, startPick }, effect) {
    const mine = state.players[ctx.controller].battlefield.filter((p) => isCreature(state, p) && !(effect.other && p.card.iid === ctx.sourceId) && (!effect.color || colorsOfPerm(state, p).includes(effect.color)));
    if (mine.length === 0 || state.pendingPick) return;
    startPick({
      player: ctx.controller,
      prompt: `${ctx.sourceName}: choose ${effect.other ? "another creature" : effect.color === "G" ? "a green creature" : "a creature"} you control to return to its owner's hand`,
      kind: "bounceOwn",
      options: mine.map((p) => p.card.iid),
      optional: false,
      owner: ctx.controller,
      remaining: 1,
      ordered: [],
    });
  },
  sacrifice({ state, ctx, events, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      say(`${nameOf(state, s.perm)} is sacrificed.`);
      sacrificePermanent(state, s.perm, s.owner, events);
    }
  },
  exileUntilLeaves({ state, ctx, say }, effect) {
    // The source must still be on the battlefield: otherwise nothing is exiled (rule 610.3c).
    const holder = findPermanentOrNull(state, ctx.sourceId)?.perm;
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm" || !holder) continue;
      const card = removeFromBattlefield(state, s.perm, s.owner);
      if (!card) continue;
      state.players[card.owner].exile.push(card);
      holder.held = [...(holder.held ?? []), card];
      say(`${getCard(state, card.defId).name} is exiled until ${nameOf(state, holder)} leaves the battlefield.`);
    }
  },
  returnFromYard({ state, ctx, say }) {
    // "When this dies, return it to its owner's hand": the card is in its owner's graveyard by now.
    for (const p of Object.values(state.players)) {
      const at = p.graveyard.findIndex((c) => c.iid === ctx.sourceId);
      if (at < 0) continue;
      const [card] = p.graveyard.splice(at, 1);
      p.hand.push(card);
      say(`${getCard(state, card.defId).name} returns to its owner's hand.`);
    }
  },
  returnAsEnchantment({ state, ctx, events, say }) {
    // "Return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.)"
    const owner = Object.values(state.players).find((p) => p.graveyard.some((c) => c.iid === ctx.sourceId));
    if (!owner) return;
    const [card] = owner.graveyard.splice(owner.graveyard.findIndex((c) => c.iid === ctx.sourceId), 1);
    const id = `${card.defId}@enchantment`;
    if (!state.cards[id]) {
      const printed = getCard(state, card.defId);
      state.cards[id] = { ...printed, id, type: "enchantment", typeLine: (printed.typeLine ?? "Enchantment").replace(/\bCreature ?/, "").replace(/\s+—/, " —").trim(), power: undefined, toughness: undefined };
    }
    const returned: CardInstance = { iid: card.iid, defId: id, owner: card.owner, printed: card.defId };
    owner.battlefield.push({ card: returned, tapped: false, summoningSick: false, damage: 0 });
    events.push({ type: "permanentEntered", player: owner.id, iid: card.iid });
    queueTriggers(state, returned, owner.id, "enters");
    creatureEntered(state, returned, owner.id);
    say(`${getCard(state, id).name} returns to the battlefield as an enchantment.`);
  },
  returnSelfToBattlefield({ state, ctx, events, say }, effect) {
    const owner = Object.values(state.players).find((p) => p.graveyard.some((c) => c.iid === ctx.sourceId));
    if (!owner) return;
    const [card] = owner.graveyard.splice(owner.graveyard.findIndex((c) => c.iid === ctx.sourceId), 1);
    const perm: Permanent = { card, tapped: effect.tapped === true, summoningSick: true, damage: 0, ...(effect.finality ? { finality: true } : {}), ...(effect.minusCounters ? { minusCounters: effect.minusCounters } : {}) };
    owner.battlefield.push(perm);
    events.push({ type: "permanentEntered", player: owner.id, iid: card.iid });
    if (effect.counters) putCounters(state, perm, owner.id, effect.counters);
    queueTriggers(state, card, owner.id, "enters");
    creatureEntered(state, card, owner.id);
    say(`${getCard(state, card.defId).name} returns to the battlefield${effect.tapped ? " tapped" : effect.finality ? " with a finality counter" : effect.minusCounters ? " with a -1/-1 counter" : ""}.`);
  },
  createToken({ state, ctx, events, say, value }, effect) {
    const n = value(effect.amount);
    // "Its controller creates a 1/1 token": the player is not always the one who cast the spell.
    const who = effect.who ? (subjectsOf(state, effect.who, ctx).find((s) => s.k === "player") as { k: "player"; id: PlayerId } | undefined)?.id : ctx.controller;
    if (!who) return;
    for (let i = 0; i < n; i++) ctx.created = [...(ctx.created ?? []), makeToken(state, effect.token, who, events)];
    if (n > 0) say(`${playerLabel(who)} creates ${plural(n, `${effect.token.name} token`)}.`);
  },
  exileYardCard({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "card") continue;
      const yard = state.players[s.owner].graveyard;
      yard.splice(yard.indexOf(s.card), 1);
      state.players[s.owner].exile.push({ ...s.card, exiledBy: ctx.sourceId });
      say(`${getCard(state, s.card.defId).name} is exiled from ${playerLabel(s.owner)}'s graveyard.`);
    }
  },
  putExiledWith({ state, ctx, events, say }) {
    // Each creature card it exiled comes back under its controller as a 1/1 Spirit with a flying counter.
    for (const owner of Object.values(state.players)) {
      for (const found of owner.exile.filter((c) => c.exiledBy === ctx.sourceId && getCard(state, c.defId).type === "creature")) {
        owner.exile.splice(owner.exile.indexOf(found), 1);
        const card = { iid: found.iid, defId: found.defId, owner: found.owner };
        state.players[ctx.controller].battlefield.push({ card, tapped: false, summoningSick: true, damage: 0, kwCounters: ["flying"], baseOverride: { power: 1, toughness: 1 }, addedSubtypes: ["spirit"] });
        events.push({ type: "permanentEntered", player: ctx.controller, iid: card.iid });
        say(`${getCard(state, card.defId).name} returns as a 1/1 Spirit with a flying counter.`);
        queueTriggers(state, card, ctx.controller, "enters");
        creatureEntered(state, card, ctx.controller);
      }
    }
  },
  reanimate({ state, ctx, events, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "card") continue;
      const yard = state.players[s.owner].graveyard;
      yard.splice(yard.indexOf(s.card), 1);
      const name = getCard(state, s.card.defId).name;
      if (effect.to === "hand") {
        state.players[s.card.owner].hand.push(s.card);
        say(`${name} returns to its owner's hand.`);
      } else {
        // It comes back under the control of the player who used the effect.
        state.players[ctx.controller].battlefield.push({ card: s.card, tapped: effect.tapped === true, summoningSick: true, damage: 0, ...(effect.finality ? { finality: true } : {}) });
        events.push({ type: "permanentEntered", player: ctx.controller, iid: s.card.iid });
        if (effect.attacking && state.combat) state.combat.attackers.push({ attacker: s.card.iid, blockers: [] }); // "...tapped and attacking"
        queueTriggers(state, s.card, ctx.controller, "enters");
        creatureEntered(state, s.card, ctx.controller);
      }
    }
  },
  exileFromHand({ state, ctx, startPick }, effect) {
    // The source must still be on the battlefield to keep the card (rule 610.3c); the hand is looked at either way.
    for (const s of subjectsOf(state, effect.who, ctx)) {
      if (s.k !== "player" || state.pendingPick) continue;
      const hand = state.players[s.id].hand;
      if (hand.length === 0) continue;
      const holder = findPermanentOrNull(state, ctx.sourceId)?.perm;
      const nonland = hand.filter((c) => getCard(state, c.defId).type !== "land").map((c) => c.iid);
      startPick({
        player: ctx.controller,
        prompt: `${playerLabel(s.id)}'s hand: you may exile a nonland card from it until ${ctx.sourceName} leaves the battlefield`,
        kind: "handExile",
        options: holder ? nonland : [],
        seen: hand.map((c) => c.iid).filter((iid) => !holder || !nonland.includes(iid)),
        optional: true,
        owner: s.id,
        remaining: 1,
        ordered: [],
        ...(holder ? { holder: holder.card.iid } : {}),
      });
    }
  },
  exileToPlay({ state, ctx, startPick }, effect) {
    for (const s of subjectsOf(state, effect.who, ctx)) {
      if (s.k !== "player" || state.pendingPick || state.players[s.id].hand.length === 0) continue;
      startPick({
        player: s.id,
        prompt: `${ctx.sourceName}: exile a card from your hand. You may play it while it stays exiled (a spell costs {${effect.tax}} more, a land enters tapped).`,
        kind: "exileToPlay",
        options: state.players[s.id].hand.map((c) => c.iid),
        optional: false,
        owner: s.id,
        remaining: 1,
        ordered: [],
        playTax: effect.tax,
        playLandTapped: effect.tappedLand,
      });
    }
  },
  attachToCreated({ state, ctx, say }) {
    const source = findPermanentOrNull(state, ctx.sourceId)?.perm;
    const token = ctx.created?.at(-1);
    const host = token ? findPermanentOrNull(state, token)?.perm : undefined;
    if (!source || !host) return;
    source.attachedTo = host.card.iid;
    say(`${getCard(state, source.card.defId).name} is attached to ${getCard(state, host.card.defId).name}.`);
  },
  exileGraveyard({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.who, ctx)) {
      if (s.k !== "player") continue;
      const p = state.players[s.id];
      if (p.graveyard.length === 0) continue;
      say(`${playerLabel(s.id)}'s graveyard is exiled (${plural(p.graveyard.length, "card")}).`);
      p.exile.push(...p.graveyard);
      p.graveyard = [];
    }
  },
  upkeepDraw({ state, ctx, say }) {
    const me = state.players[ctx.controller];
    me.upkeepDraws = [...(me.upkeepDraws ?? []), { source: ctx.sourceId, name: ctx.sourceName }];
    say(`${playerLabel(ctx.controller)} will draw a card at the beginning of the next upkeep.`);
  },
  yardCastable({ state, ctx, say }) {
    // Only the creature cards there now (rule 611.2c): one put there later doesn't gain it.
    const me = state.players[ctx.controller];
    me.yardCastable = [...new Set([...(me.yardCastable ?? []), ...me.graveyard.filter((c) => getCard(state, c.defId).type === "creature").map((c) => c.iid)])];
    say(`Until end of turn, ${playerLabel(ctx.controller)} may cast creature cards from their graveyard.`);
  },
  warpExile({ state, ctx, say }) {
    const found = findPermanentOrNull(state, ctx.sourceId);
    if (!found?.perm.warped) return; // it left the battlefield already (and came back as a new object)
    const card = removeFromBattlefield(state, found.perm, found.owner.id);
    if (!card) return;
    state.players[card.owner].exile.push(card);
    state.players[card.owner].mayPlay = [...(state.players[card.owner].mayPlay ?? []), { iid: card.iid, source: "warp", fromTurn: state.turn + 1 }];
    say(`${ctx.sourceName} is exiled (warp). Its owner may cast it from exile on a later turn.`);
  },
} satisfies EffectHandlers;
