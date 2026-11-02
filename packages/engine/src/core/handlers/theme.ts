import type { GameEvent } from "../../actions.js";
import { getCard } from "../../cards.js";
import { shuffle } from "../../state.js";
import type { GameState, PlayerId } from "../../types.js";
import { nameOf, playerLabel } from "../permanents.js";
import { sacrificePermanent } from "../zones.js";
import { subjectsOf } from "../targets.js";
import type { EffectHandlers } from "./shared.js";

/** The effects of the older theme decks. */
export const THEME_EFFECTS = {
  /** "Prevent the next 3 damage that would be dealt to any target this turn." */
  prevent({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.to, ctx)) {
      if (s.k === "player") {
        state.players[s.id].preventShield = (state.players[s.id].preventShield ?? 0) + effect.amount;
        say(`The next ${effect.amount} damage that would be dealt to ${playerLabel(s.id)} this turn is prevented.`);
      } else if (s.k === "perm") {
        s.perm.preventShield = (s.perm.preventShield ?? 0) + effect.amount;
        say(`The next ${effect.amount} damage that would be dealt to ${nameOf(state, s.perm)} this turn is prevented.`);
      }
    }
  },
  /** Wildfire: the player sacrifices that many lands of their choice (all they have, when they have no more). */
  sacrificeLands({ state, ctx, events, say, startPick }, effect) {
    for (const s of subjectsOf(state, effect.who, ctx)) {
      if (s.k !== "player" || state.pendingPick) continue;
      const lands = state.players[s.id].battlefield.filter((p) => getCard(state, p.card.defId).type === "land");
      if (lands.length <= effect.n) {
        for (const land of lands) sacrificePermanent(state, land, s.id, events);
        if (lands.length > 0) say(`${playerLabel(s.id)} sacrifices ${lands.length === 1 ? "a land" : `${lands.length} lands`}.`);
        continue;
      }
      startPick({ player: s.id, prompt: `Choose ${effect.n} lands to sacrifice (${effect.n} left)`, kind: "sacrificeOwn", options: lands.map((p) => p.card.iid), optional: false, owner: s.id, remaining: effect.n, ordered: [] });
    }
  },
  /** Relentless Assault: a combat phase and a main phase are added after the current main phase (see advancePhase). */
  extraCombatMain({ state, say }) {
    state.extraCombatMain = (state.extraCombatMain ?? 0) + 1;
    say("After this main phase there is an additional combat phase, followed by an additional main phase.");
  },
  /** Beacon of Destruction: the spell itself is shuffled into the library as it leaves the stack (see resolve.ts). */
  shuffleSpell() {},
  /** False Peace: the player's next turn has no combat phase. */
  skipCombat({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.who, ctx)) {
      if (s.k !== "player") continue;
      const next = state.active === s.id ? state.turn + 2 : state.turn + 1; // (the turns alternate)
      state.players[s.id].skipCombat = next;
      say(`${playerLabel(s.id)} skips all combat phases of their next turn.`);
    }
  },
  /** Angel of Fury: the card goes from its owner's graveyard into their library, which is shuffled. */
  shuffleSelfFromYard({ state, ctx, events, say }) {
    for (const p of Object.values(state.players)) {
      const at = p.graveyard.findIndex((c) => c.iid === ctx.sourceId);
      if (at < 0) continue;
      const [card] = p.graveyard.splice(at, 1);
      state.players[card.owner].library.push(card);
      [state.players[card.owner].library, state.rng] = shuffle(state.players[card.owner].library, state.rng);
      events.push({ type: "libraryShuffled", player: card.owner });
      say(`${getCard(state, card.defId).name} is shuffled into its owner's library.`);
    }
  },
} satisfies EffectHandlers;

/** Counterbore: every card named like the spell, in its controller's graveyard, hand and library, is exiled (the spell itself if it is on its way to the graveyard too), then the library is shuffled. */
export function exileCopiesOf(state: GameState, controller: PlayerId, name: string, events: GameEvent[], say: (text: string) => void): void {
  const player = state.players[controller];
  const same = (c: { defId: string }) => getCard(state, c.defId).name === name;
  let n = 0;
  for (const zone of ["graveyard", "hand", "library"] as const) {
    const hit = player[zone].filter(same);
    n += hit.length;
    player[zone] = player[zone].filter((c) => !same(c));
    player.exile.push(...hit);
  }
  [player.library, state.rng] = shuffle(player.library, state.rng);
  events.push({ type: "libraryShuffled", player: controller });
  say(`${n} ${name} ${n === 1 ? "card is" : "cards are"} exiled from ${playerLabel(controller)}'s graveyard, hand and library.`);
}
