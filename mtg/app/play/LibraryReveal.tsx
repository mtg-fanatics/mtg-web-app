"use client";

import type { CardDef } from "@mtg/engine";
import { cardImageUrl } from "@/lib/cards";
import type { RevealPayload } from "@/lib/online/protocol";
import { useHoverZoom } from "./HoverZoom";

type Card = RevealPayload["cards"][string];

function Face({ card, className, zoom }: { card: Card | undefined; className: string; zoom: ReturnType<typeof useHoverZoom> }) {
  const url = card?.image ? cardImageUrl(card.image) : null;
  return (
    <div
      {...(card ? zoom.on(card as unknown as CardDef) : {})}
      className={`relative shrink-0 overflow-hidden rounded-md border border-zinc-600 bg-slate-800 bg-cover bg-center ${className}`}
      style={url ? { backgroundImage: `url(${url})` } : undefined}
    >
      {!url && <span className="absolute inset-0 flex items-center justify-center p-1 text-center text-[11px] font-semibold leading-tight text-white">{card?.name ?? "?"}</span>}
    </div>
  );
}

/**
 * The game is over: the player's OWN library is turned face up, so they can see what was left in it and which card they would have drawn next.
 * (The opponent's library is not sent to them, so it cannot be shown.) Hovering (or holding, on a phone) a card shows it big. Shown before the
 * Victory / Defeat screen.
 */
export default function LibraryReveal({ reveal, onContinue }: { reveal: RevealPayload; onContinue: () => void }) {
  const zoom = useHoverZoom();
  const ids = reveal.library;
  const next = ids[0] ? reveal.cards[ids[0]] : undefined;
  return (
    <div role="dialog" aria-modal="true" aria-label="Your library" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3">
      <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col gap-3 overflow-hidden rounded-2xl border border-white/25 p-4 text-white shadow-2xl" style={{ background: "#0b1020" }}>
        <header className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl font-extrabold tracking-wide">Your library</h2>
          <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-sm font-bold">{ids.length} cards left</span>
        </header>

        {ids.length === 0 ? (
          <p className="rounded-xl border border-white/15 bg-white/5 px-4 py-6 text-center text-lg">Your library was empty.</p>
        ) : (
          <>
            <div className="flex items-center gap-4 rounded-xl border border-amber-300/50 bg-amber-400/10 p-3">
              <Face card={next} zoom={zoom} className="h-36 w-[6.3rem] ring-2 ring-amber-300" />
              <div className="min-w-0">
                <p className="text-xs font-extrabold uppercase tracking-widest" style={{ color: "#e8d9b5" }}>You would have drawn next</p>
                <p className="text-xl font-extrabold">{next?.name ?? "?"}</p>
                {next?.typeLine && <p className="text-sm text-slate-300">{next.typeLine}</p>}
              </div>
            </div>
            <p className="text-sm text-slate-300">The rest of the library, in the order it would have been drawn (top first). Hover a card to see it big.</p>
            <ol className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto pr-1">
              {ids.map((id, i) => (
                <li key={`${id}-${i}`} className="relative">
                  <Face card={reveal.cards[id]} zoom={zoom} className="h-[5.6rem] w-[4rem]" />
                  <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/75 px-1 text-[10px] font-bold">{i + 1}</span>
                </li>
              ))}
            </ol>
          </>
        )}

        <button onClick={onContinue} autoFocus className="min-h-11 self-center rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-8 text-base font-extrabold text-black shadow-lg">
          Continue
        </button>
      </div>
      {zoom.node}
    </div>
  );
}
