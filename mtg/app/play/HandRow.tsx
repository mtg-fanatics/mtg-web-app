"use client";

import { castCostOf, getCastable, payMana } from "@mtg/engine";
import type { CardDef, CardInstance, GameState, PlayerId } from "@mtg/engine";
import CardView from "./CardView";
import { shufflePending } from "./shuffleStep";

interface Props {
  state: GameState;
  actor: PlayerId;
  mine: boolean;
  playable: Set<string>;
  /** Cards in exile the player may play now (Expressive Iteration, an Adventure, warp...): they sit with the hand's playable cards. */
  exiled?: CardInstance[];
  handPick: string[];
  onClick: (iid: string, defId: string) => void;
  onPreview: (def: CardDef, el: HTMLElement) => void;
  onUnpreview: () => void;
  onInspect: (def: CardDef) => void;
  onZoom: (def: CardDef) => void;
}

/** The player's hand. While choosing cards (mulligan, discard) it stays together; otherwise playable cards come first, apart from the rest. */
export default function HandRow({ state, actor, mine, playable, exiled = [], handPick, onClick, onPreview, onUnpreview, onInspect, onZoom }: Props) {
  const hand = state.players[actor].hand;
  // The opening seven are not drawn (not even shown) until both players have shuffled each other's deck.
  if (shufflePending(state)) {
    return (
      <div className="flex min-h-[calc(var(--card-h,168px)*0.8)] items-center justify-center rounded-lg border border-dashed border-white/25 px-3 py-2 text-center text-sm text-slate-200">
        Your 7 cards are dealt once you have both shuffled each other&apos;s deck.
      </div>
    );
  }
  const mulligansTaken = state.opening?.taken[actor] ?? 0;
  // While deciding whether to keep or mulligan the cards can only be looked at, until a mulligan means choosing cards to bottom.
  // Online, the player waiting for the other to keep or discard can only look too.
  const lookOnly = (state.phase === "mulligan" && mulligansTaken === 0) || (!mine && (state.phase === "mulligan" || state.phase === "cleanup"));
  const choosing = state.phase === "mulligan" || state.phase === "cleanup" || state.pendingPick !== null || state.winner !== null;

  const card = (c: CardInstance) => {
    const def = state.cards[c.defId];
    const notes = exiled.includes(c) ? { castable: true, castLabel: "✓ From exile", hint: exileHint(state, actor, c.iid) } : handNotes(state, actor, c.iid, c.defId, playable.has(c.iid));
    return (
      <div key={c.iid} className="hand-slot shrink-0" onMouseEnter={(e) => onPreview(def, e.currentTarget)} onMouseLeave={onUnpreview}>
        <CardView
          iid={c.iid}
          def={def}
          ring={handPick.includes(c.iid) ? "ring-2 ring-red-400" : choosing && !lookOnly && (state.phase === "mulligan" || state.phase === "cleanup") ? "ring-2 ring-emerald-400" : ""}
          castable={notes.castable}
          castLabel={notes.castLabel}
          dim={notes.dim}
          hint={notes.hint}
          onClick={lookOnly ? undefined : () => onClick(c.iid, c.defId)}
          onHover={() => onInspect(def)}
          onZoom={() => onZoom(def)}
        />
      </div>
    );
  };

  if (choosing) return <div className="flex min-h-[calc(var(--card-h,168px)*0.8)] items-start gap-1.5 overflow-x-auto py-1">{hand.map(card)}</div>;
  const ready = [...hand.filter((c) => playable.has(c.iid)), ...exiled];
  const waiting = hand.filter((c) => !playable.has(c.iid));
  // Playable cards and the rest sit side by side in one row, so the hand takes one card's height.
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto py-1 max-lg:gap-1.5">
      <div className="flex min-w-0 flex-col gap-0.5 max-lg:shrink-0">
        <h3 className="text-[10px] font-semibold uppercase font-display tracking-wide text-[#a9d4b9] max-lg:hidden">Can play now ({ready.length})</h3>
        <div className="flex min-h-[calc(var(--card-h,168px)*0.8+0.5rem)] items-start gap-1.5 rounded-lg border border-[#8fc4a5]/40 bg-[#022c22]/40 p-1 max-lg:min-h-0 max-lg:border-0 max-lg:bg-transparent max-lg:p-0 max-lg:has-[>p]:hidden">
          {ready.length > 0 ? ready.map(card) : <p className="self-center px-2 text-xs text-slate-300">Nothing can be played right now.</p>}
        </div>
      </div>
      {waiting.length > 0 && (
        <div className="flex min-w-0 flex-col gap-0.5 max-lg:shrink-0">
          <h3 className="text-[10px] font-semibold uppercase font-display tracking-wide text-slate-300 max-lg:hidden">Can&apos;t play now ({waiting.length})</h3>
          <div className="flex items-start gap-1.5 rounded-lg border border-white/15 bg-white/10 p-1 max-lg:border-0 max-lg:bg-transparent max-lg:p-0">{waiting.map(card)}</div>
        </div>
      )}
    </div>
  );
}

/** Why a card in exile may be played now. */
function exileHint(state: GameState, actor: PlayerId, iid: string): string {
  const entry = state.players[actor].mayPlay?.find((e) => e.iid === iid);
  const why =
    entry?.source === "thisTurn" ? "it was exiled from your library, and you may play it this turn"
    : entry?.source === "adventure" ? "it went on an Adventure: you may cast the creature from exile"
    : entry?.source === "warp" ? "warp exiled it: you may cast it from exile"
    : entry?.source === "plot" ? "you plotted it: cast it for free, as a sorcery"
    : entry?.source === "airbend" ? "it was airbent: you may cast it for {2} while it is exiled"
    : entry?.source === "exiled" ? `it was exiled from your hand: you may play it while it stays exiled${entry.tax ? `, for {${entry.tax}} more` : ""}`
    : entry?.throughTurn !== undefined ? "it was exiled from your library, and you may play it until the end of your next turn"
    : entry?.untilTurn !== undefined ? "it was exiled from your library, and you may play it until your next end step"
    : "it was exiled, and you may play it now";
  return `In exile: ${why}.`;
}

/**
 * What the hand should show for a card: castable (green, with a badge), or dimmed with the reason why not.
 * Only while playing normally: during the mulligan and the discard the hand is for choosing cards, not casting.
 */
function handNotes(state: GameState, actor: PlayerId, iid: string, defId: string, ok: boolean): { castable?: boolean; castLabel?: string; dim?: boolean; hint?: string } {
  if (state.phase === "mulligan" || state.phase === "cleanup" || state.pendingPick || state.winner) return {};
  const def = state.cards[defId];
  if (ok) {
    // Warp: when the full cost can't be paid but the warp cost can, say so, or the card looks castable "normally" and isn't.
    const warp = getCastable(state, actor).find((c) => c.iid === iid && !c.zone)?.warp;
    if (warp?.length && getCastable(state, actor).find((c) => c.iid === iid && !c.zone)?.warpOnly) {
      return {
        castable: true,
        castLabel: "✓ Warp only",
        hint: `You can't pay its full cost (${def.manaCost ?? def.cost}) yet, but you can cast it with Warp ${warp}: it is exiled at the next end step, and you may cast it from exile after that.`,
      };
    }
    return { castable: true };
  }
  if (def.type === "land") {
    return { dim: true, hint: state.players[actor].landsPlayedThisTurn >= 1 ? "You already played a land this turn." : "You can only play a land in your own main phase." };
  }
  const cost = castCostOf(state, actor, def);
  const paid = cost ? payMana(state, actor, cost, def) : null;
  if (cost && paid && !paid.ok) {
    return { dim: true, hint: paid.missing === "life" ? "Not enough life to pay for this." : paid.missing === "generic" ? `Not enough mana: it costs ${def.manaCost ?? def.cost}.` : `Not enough mana of the right color: it costs ${def.manaCost}.` };
  }
  return { dim: true, hint: "You have the mana, but can't cast it right now (wrong phase, something is on the stack, or it has no legal target)." };
}
