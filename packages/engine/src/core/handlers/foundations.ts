import { getCard } from "../../cards.js";
import type { PlayerId } from "../../types.js";
import { OPPONENT } from "../../types.js";
import { nameOf, playerLabel } from "../permanents.js";
import { drawCards } from "../zones.js";
import { cardsDiscarded } from "../triggers.js";
import { subjectsOf } from "../targets.js";
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
} satisfies EffectHandlers;
