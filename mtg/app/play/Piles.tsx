"use client";

import { memo } from "react";
import type { CardDef, GameState, PlayerId } from "@mtg/engine";
import { cardImageUrl } from "@/lib/cards";
import CardView from "./CardView";
import { playerName } from "./log";
import { SleeveBack } from "./AppearanceDialog";
import { useUnseenCards } from "./pileFx";
import { ZoneIcon } from "./BattlefieldBits";

/** The back of a card: used for the library and by the draw animation. */
export const CARD_BACK = "bg-gradient-to-br from-amber-700 via-amber-900 to-stone-900";

// A pile is its own size container, so what is inside grows and shrinks with the room the pile is given:
// the card picture takes most of its height (never more than about half its width), the number and the names scale with it.
const PILE_BOX = "bf-pocket flex min-h-0 w-full [container-type:size] overflow-hidden rounded-lg border-2 text-slate-100";
const ART_HEIGHT = "min(72cqh, 46cqw * 1.4)";
const COUNT_SIZE = "clamp(1.1rem, 24cqh, 2.6rem)";
const LABEL_SIZE = "clamp(0.72rem, 12cqh, 0.98rem)";

/**
 * A pile of cards: the library (face down, count) or the graveyard (top card face up, click to browse).
 * `data-pile` lets the animations find it, so cards can fly in.
 */
function PileInner({ state, owner, kind, compact, onOpen, deckName, sleeve }: { state: GameState; owner: PlayerId; kind: "library" | "graveyard" | "exile"; compact?: boolean; onOpen?: () => void; deckName?: string; sleeve?: { css: string; edge: string } }) {
  const cards = state.players[owner][kind];
  const unseen = useUnseenCards(owner);
  const shown = cards.length + (kind === "library" ? unseen : 0); // (the opening hands are dealt on screen: the library counts down)
  const top = kind !== "library" ? state.cards[cards[cards.length - 1]?.defId ?? ""] : undefined;
  const label = kind === "library" ? "Library" : kind === "graveyard" ? "Graveyard" : "Exile";
  const clickable = kind !== "library" && cards.length > 0 && onOpen;

  if (kind === "exile") {
    // Exile is usually empty or nearly so: a slim strip, not a full pile.
    return (
      <button
        type="button"
        data-pile={`exile-${owner}`}
        data-zone="exile"
        onClick={clickable ? onOpen : undefined}
        disabled={!clickable}
        aria-label={`${playerName(owner)}'s exile: ${cards.length} cards`}
        title={clickable ? `Look at the cards ${playerName(owner)} has in exile` : "Exile: cards removed from the game. Nothing here yet."}
        className={`${PILE_BOX} flex-[0.8] items-center gap-2 px-2 py-1 max-lg:gap-1 max-lg:px-1 ${clickable ? "cursor-pointer hover:bg-black/50" : "cursor-default"}`}
      >
        <div
          className="relative shrink-0 rounded-[3px] border border-sky-200/50 bg-sky-950/60"
          style={{ height: ART_HEIGHT, aspectRatio: "5 / 7", ...(top?.image ? { backgroundImage: `url(${cardImageUrl(top.image)})`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}
        />
        <span className="bf-zone-label max-lg:hidden" style={{ fontSize: LABEL_SIZE }}><ZoneIcon kind="exile" />Exile</span>
        <span className="bf-count ml-auto" style={{ fontSize: COUNT_SIZE }}>{cards.length}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-pile={`${kind}-${owner}`}
      data-zone={kind}
      onClick={clickable ? onOpen : undefined}
      disabled={!clickable}
      aria-label={`${playerName(owner)}'s ${label.toLowerCase()}: ${shown} cards`}
      title={clickable ? `Look through ${playerName(owner)}'s graveyard` : undefined}
      className={`${PILE_BOX} relative justify-center gap-3 max-lg:gap-1 ${compact ? `min-w-0 px-2 py-1 max-lg:px-0.5 ${kind === "library" ? "flex-[1.3]" : "flex-1"}` : "h-36 px-3"} ${clickable ? "cursor-pointer hover:bg-black/50" : "cursor-default"}`}
    >
      {kind === "library" && cards.length > 0 && sleeve ? (
        <div className="relative ml-1 mt-1 shrink-0" data-sleeve-pile style={{ height: ART_HEIGHT, aspectRatio: "5 / 7" }}>
          {/* a thicker stack looks like a bigger library */}
          <SleeveBack
            css={sleeve.css}
            edge={sleeve.edge}
            className={`${compact ? "h-full w-full" : "h-28 w-20"} ${cards.length > 20 ? "shadow-[2px_-2px_0_rgba(0,0,0,0.55),4px_-4px_0_rgba(255,255,255,0.18),6px_-6px_0_rgba(0,0,0,0.45)]" : cards.length > 6 ? "shadow-[2px_-2px_0_rgba(0,0,0,0.55),4px_-4px_0_rgba(255,255,255,0.18)]" : ""}`}
          />
        </div>
      ) : (
        <div
          className={`relative shrink-0 rounded border border-white/30 ${compact ? "" : "h-28 w-20"} ${kind === "library" && cards.length > 0 ? CARD_BACK : "bg-white/10"}`}
          style={{ ...(compact ? { height: ART_HEIGHT, aspectRatio: "5 / 7" } : {}), ...(top?.image ? { backgroundImage: `url(${cardImageUrl(top.image)})`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}
        >
          {kind === "library" && cards.length > 0 && <div className="absolute inset-1 rounded-sm border border-[#d9694f]/50" />}
          {cards.length === 0 && <span className="bf-bare absolute inset-0 flex items-center justify-center text-[10px] max-lg:hidden">bare</span>}
        </div>
      )}
      <div className="flex min-w-0 flex-col text-left">
        <span className="bf-zone-label max-lg:hidden" style={{ fontSize: LABEL_SIZE }}><ZoneIcon kind={kind} />{label}</span>
        <span className="bf-count" style={{ fontSize: COUNT_SIZE }}>{shown}</span>
        {kind === "library" && deckName && (
          <span title={deckName} className={`truncate text-slate-300 max-lg:hidden ${compact ? "max-w-24" : "max-w-40 text-xs"}`} style={compact ? { fontSize: LABEL_SIZE } : undefined}>
            {deckName}
          </span>
        )}
      </div>
    </button>
  );
}

/** Everything in a graveyard, newest first. Closes with the X button only. */
export function GraveyardDialog({ state, owner, zone = "graveyard", onClose, onZoom, onPreview, onUnpreview }: { state: GameState; owner: PlayerId; zone?: "graveyard" | "exile"; onClose: () => void; onZoom: (def: CardDef) => void; onPreview?: (def: CardDef, el: HTMLElement) => void; onUnpreview?: () => void }) {
  const cards = [...state.players[owner][zone]].reverse();
  const title = zone === "exile" ? "exile" : "graveyard";
  const paradigms = new Set(zone === "exile" ? (state.players[owner].paradigms ?? []) : []);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="game-modal fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 rounded-2xl border border-white/25 bg-slate-950/95 p-4 text-white shadow-2xl shadow-black/50 ring-1 ring-inset ring-white/10 [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold tracking-wide text-white">
            {playerName(owner)}&apos;s {title} ({cards.length})
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full border border-white/30 bg-white/10 px-3 py-1 text-lg leading-none text-white hover:bg-white/20">
            ×
          </button>
        </div>
        <div className="flex flex-wrap gap-2 overflow-y-auto">
          {cards.map((c) => (
            <div key={c.iid} className="flex shrink-0 flex-col items-center gap-1" onMouseEnter={(e) => onPreview?.(state.cards[c.defId], e.currentTarget)} onMouseLeave={() => onUnpreview?.()}>
              <CardView def={state.cards[c.defId]} onClick={() => onZoom(state.cards[c.defId])} />
              {paradigms.has(c.iid) && (
                <span className="w-[calc(var(--card-h,168px)*0.716)] text-center text-[11px] leading-tight text-amber-200">
                  Paradigm: a free copy each turn, at the start of {playerName(owner)}&apos;s first main phase
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A pile is drawn again only when its cards, or what it is called or dressed in, changed (the game state is a new object after every move). */
export const Pile = memo(PileInner, (a, b) => JSON.stringify([a.state.players[a.owner][a.kind], a.owner, a.kind, a.compact, a.deckName, a.sleeve, !!a.onOpen]) === JSON.stringify([b.state.players[b.owner][b.kind], b.owner, b.kind, b.compact, b.deckName, b.sleeve, !!b.onOpen]));
