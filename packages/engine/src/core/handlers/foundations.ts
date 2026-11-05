import { getCard } from "../../cards.js";
import type { PlayerId } from "../../types.js";
import { OPPONENT } from "../../types.js";
import { nameOf, playerLabel } from "../permanents.js";
import { drawCards } from "../zones.js";
import { cardsDiscarded } from "../triggers.js";
import { subjectsOf } from "../targets.js";
import { enterBattlefield } from "../../stack/resolve.js";
import type { EffectHandlers } from "./shared.js";

/** Effects that came with Foundations (the cards of that set that had no place in the older decks). */
export const FDN_EFFECTS = {
  /** "Each opponent discards their hand" / "Each player discards their hand, then draws seven cards." */
  discardHands({ state, ctx, events, say }, effect) {
    const players = subjectsOf(state, effect.who, ctx).flatMap((s): PlayerId[] => (s.k === "player" ? [s.id] : []));
    for (const id of players) {
      const hand = state.players[id].hand;
      const iids = hand.map((c) => c.iid);
      state.players[id].graveyard.push(...hand.splice(0));
      cardsDiscarded(state, id, iids, events);
      say(`${playerLabel(id)} discards their hand.`);
    }
    if (effect.thenDraw) for (const id of players) drawCards(state, id, effect.thenDraw, events);
  },
  /** "An opponent gains control of ~." */
  giftControl({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const to = OPPONENT[s.owner];
      const from = state.players[s.owner].battlefield;
      from.splice(from.indexOf(s.perm), 1);
      s.perm.summoningSick = true;
      state.players[to].battlefield.push(s.perm);
      say(`${playerLabel(to)} gains control of ${getCard(state, s.perm.card.defId).name}.`);
      void nameOf;
    }
  },
  /** "Return all creature cards with mana value 2 or less from your graveyard to the battlefield." */
  reanimateAll({ state, ctx, events, say }, effect) {
    const yard = state.players[ctx.controller].graveyard;
    const cards = yard.filter((c) => getCard(state, c.defId).type === "creature" && getCard(state, c.defId).cost <= effect.maxMV);
    for (const card of cards) {
      yard.splice(yard.indexOf(card), 1);
      enterBattlefield(state, card, ctx.controller, events);
      say(`${getCard(state, card.defId).name} returns to the battlefield.`);
    }
  },
  /** "If target player has exactly 10 life, ~ deals 10 damage to that player." */
  damageIfLife({ state, ctx, say, nested }, effect) {
    for (const s of subjectsOf(state, effect.who, ctx)) {
      if (s.k !== "player") continue;
      if (state.players[s.id].life !== effect.life) {
        say(`${playerLabel(s.id)} does not have exactly ${effect.life} life.`);
        continue;
      }
      nested([{ type: "damage", amount: effect.amount, to: effect.who }]);
    }
  },
  /** "...then discard a card unless you attacked this turn." */
  discardUnlessAttacked({ state, ctx, nested }) {
    if (state.players[ctx.controller].attackedThisTurn) return;
    nested([{ type: "discard", who: { t: "you" }, amount: 1, chooser: "victim" }]);
  },
} satisfies EffectHandlers;
