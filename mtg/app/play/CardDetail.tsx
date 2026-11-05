"use client";

import { useEffect, useState } from "react";
import type { CardDef } from "@mtg/engine";
import { KEYWORD_RULES } from "@mtg/engine";
import { helpFor, helpForWord } from "./glossary";
import type { Keyword } from "@mtg/engine";
import { cardDetailImageUrl, cardImageUrl } from "@/lib/cards";
import { isTokenDef, useTokenArt } from "@/lib/tokenArt";
import TokenFrame from "./TokenFrame";
import CardView from "./CardView";
import { ManaCostView } from "./ManaSymbols";
import Tip from "./Tip";
import { CardParts } from "./CardParts";
import { cardParts, worthParts } from "./abilityParts";

export interface Inspected {
  def: CardDef;
  /** Live game status, e.g. ["Tapped", "2 damage"]. */
  status?: string[];
}

/** Right-hand panel: the card under the mouse. Click it to read it full-screen. */
export default function CardDetail({ inspected }: { inspected: Inspected | null }) {
  if (!inspected) {
    return (
      <Panel>
        <p className="text-sm text-zinc-500">Hover over a card to see it here.</p>
      </Panel>
    );
  }
  // Keyed by card so the popup closes and the image fallback resets when another card is inspected.
  return (
    <Panel>
      <Body key={inspected.def.id} inspected={inspected} />
    </Panel>
  );
}

function Body({ inspected: { def, status } }: { inspected: Inspected }) {
  const [open, setOpen] = useState(false);
  const parts = cardParts(def);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        title="Click to enlarge"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(true)}
        className="cursor-zoom-in rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <CardImage def={def} size="normal" className="w-full rounded-xl shadow-lg" fallback={<CardView def={def} size="lg" />} />
        <p className="mt-1 text-center text-[10px] text-zinc-500">Click to enlarge</p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-2xl font-bold leading-tight">{def.name}</h2>
          {def.manaCost && <ManaCostView cost={def.manaCost} />}
        </div>
        <div className="text-base text-zinc-700">{def.typeLine ?? def.type}</div>
        {def.keywords && def.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {def.keywords.map((k) => (
              <Tip key={k} text={KEYWORD_RULES[k as Keyword] ?? helpForWord(k) ?? k}>
                <span className="inline-flex items-center gap-1.5 rounded bg-zinc-200 px-2.5 py-1 text-sm font-medium capitalize">
                  <i className={`ms ms-ability-${k.replace(/ /g, "-")}`} aria-hidden="true" />
                  {k}
                </span>
              </Tip>
            ))}
          </div>
        )}
        {def.text && <p className="whitespace-pre-line rounded bg-zinc-200/60 p-2.5 text-base leading-relaxed">{def.text}</p>}
        {worthParts(parts) && (
          <div className="rounded border border-violet-200 bg-violet-50 p-2.5">
            <div className="mb-1.5 text-sm font-semibold uppercase font-display tracking-wide text-violet-700">How it works, part by part</div>
            <CardParts def={def} parts={parts} />
          </div>
        )}
        {helpFor(def.text, 5).length > 0 && (
          <div className="rounded border border-sky-200 bg-sky-50 p-2.5 text-[15px] leading-relaxed text-zinc-800">
            <div className="mb-1.5 text-sm font-semibold uppercase font-display tracking-wide text-sky-700">What this means</div>
            {helpFor(def.text, 5).map((h, i) => (
              <p key={`${i}-${h}`} className="mb-1 last:mb-0">
                ⓘ {h}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
          {def.power !== undefined && def.toughness !== undefined && (
            <span className="rounded bg-zinc-300 px-2.5 py-0.5 text-base font-bold">
              {def.power}/{def.toughness}
            </span>
          )}
          <span className="text-zinc-700">Cost {def.cost}</span>
          {def.rarity && <span className="capitalize text-zinc-700">{def.rarity}</span>}
          {def.playable === false && <span className="rounded bg-zinc-200 px-2 py-0.5 text-red-600">Not playable yet</span>}
          {status?.map((s, i) => (
            <span key={`${i}-${s}`} className="rounded bg-sky-100 px-2.5 py-0.5 text-sky-800">
              {s}
            </span>
          ))}
        </div>
      </div>

      {open && <Lightbox def={def} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Big centered card. It closes only with the × button or the Esc key: clicking outside the card
 * does nothing. Pass `onPrev` / `onNext` to browse through a list of cards with arrow buttons or the ← → keys.
 */
export function Lightbox({
  def,
  onClose,
  onPrev,
  onNext,
  caption,
  actions,
}: {
  def: CardDef;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Small text under the card, e.g. "Main deck · 12 of 98". */
  caption?: string;
  /** Buttons under the card (the library's "Add to deck"). */
  actions?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onNext?.();
      else if (e.key === "ArrowLeft") onPrev?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  const arrow =
    `absolute ${actions ? "top-[36%]" : "top-1/2"} flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-4xl leading-none text-zinc-900 shadow-lg hover:bg-white`; // (with buttons under the card the arrows sit over the card, clear of them)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={def.name}
      // The popup can sit inside another window (the deck preview). Stop clicks here from reaching it,
      // so a click outside the card neither closes this popup nor the window behind it.
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
    >
      <div className="relative flex flex-col items-center gap-2">
        <CardImage
          key={def.id}
          def={def}
          size="large"
          className={`${actions ? "max-h-[68vh]" : caption ? "max-h-[84vh]" : "max-h-[90vh]"} w-auto max-w-[90vw] rounded-2xl shadow-2xl`}
          fallback={
            <div className="flex w-80 flex-col gap-2 rounded-2xl border border-zinc-400 bg-zinc-100 p-5 shadow-2xl">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-2xl font-bold">{def.name}</h2>
                {def.manaCost && <span className="font-mono text-amber-700">{def.manaCost}</span>}
              </div>
              <div className="text-zinc-600">{def.typeLine ?? def.type}</div>
              {def.text && <p className="whitespace-pre-line text-lg leading-snug">{def.text}</p>}
              {def.power !== undefined && def.toughness !== undefined && (
                <div className="self-end rounded bg-zinc-300 px-3 py-1 text-xl font-bold">
                  {def.power}/{def.toughness}
                </div>
              )}
            </div>
          }
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-lg shadow-lg hover:bg-zinc-300"
        >
          ×
        </button>
        {caption && (
          <p className="text-center text-sm text-white/85">
            {caption}
            {(onPrev || onNext) && <span className="text-white/50"> · use ← → to browse</span>}
          </p>
        )}
        {actions}
      </div>

      {/* Arrows sit at the screen edges; clicking them must not close the popup. */}
      {onPrev && (
        <button
          type="button"
          aria-label="Previous card"
          onClick={(e) => (e.stopPropagation(), onPrev())}
          className={`${arrow} left-3 sm:left-8`}
        >
          ‹
        </button>
      )}
      {onNext && (
        <button
          type="button"
          aria-label="Next card"
          onClick={(e) => (e.stopPropagation(), onNext())}
          className={`${arrow} right-3 sm:right-8`}
        >
          ›
        </button>
      )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-100/60 p-3 lg:h-full">
      <h2 className="text-xs font-semibold uppercase font-display tracking-wide text-zinc-500">Card</h2>
      {children}
    </section>
  );
}

/** Scryfall's high-res image, then your stored small art; shows `fallback` if neither loads. */
export function CardImage({
  def,
  size,
  className,
  fallback,
}: {
  def: CardDef;
  size: "normal" | "large";
  className: string;
  fallback: React.ReactNode;
}) {
  const tokenArt = useTokenArt(def);
  const sources = [cardDetailImageUrl(def, size), tokenArt?.large ?? null, def.image ? cardImageUrl(def.image) : null].filter((s): s is string => Boolean(s));
  const [step, setStep] = useState(0);

  if (step >= sources.length) {
    // a token with no picture anywhere: draw the token card (it keeps the card's shape at any size)
    if (isTokenDef(def)) {
      return (
        <div className={`relative aspect-[146/204] overflow-hidden ${className}`}>
          <TokenFrame def={def} art={tokenArt?.crop} />
        </div>
      );
    }
    return <>{fallback}</>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={sources[step]} alt={def.name} onError={() => setStep(step + 1)} className={className} />
  );
}
