"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CardType } from "@mtg/engine";
import { cardDetailImageUrl } from "@/lib/cards";
import { onIntent, preloadImage } from "@/lib/prefetch";
import { Lightbox } from "../play/CardDetail";
import CardView from "../play/CardView";
import { useHoverZoom } from "../play/HoverZoom";
import { useMedia } from "../play/useMedia";
import Album from "../Album";
import { Skeleton } from "../Skeleton";
import TypeButton from "./TypeButton";
import { ALBUM_PAGE_CARDS, useAlbumPages } from "./useAlbumPages";
import { Back, Lens } from "../Icons";

type Filter = "all" | CardType;
const TYPES: Filter[] = ["all", "creature", "land", "instant", "sorcery", "enchantment", "artifact", "planeswalker"];

/** The library: every card in the game, kept in an album. The search, the filters and the paging of the data are the same as ever; the album shows them nine cards to a page. */
export default function CardBrowser() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<Filter>("all");
  const [playableOnly, setPlayableOnly] = useState(false);
  const [index, setIndex] = useState(0); // the album page at the left of the spread (the page itself on a narrow screen)
  const filters = { query, type, playableOnly };
  const { cardsOf, ensure, total, loading, error, ready } = useAlbumPages(filters, index);
  const narrow = useMedia("(max-width: 1023px)");
  const zoom = useHoverZoom(); // the big card shown while the mouse is over a card
  const [zoomedIdx, setZoomedIdx] = useState<number | null>(null); // position among the cards on show, while a card is open large

  const pages = ready ? Math.max(1, Math.ceil(total / ALBUM_PAGE_CARDS)) : 2; // (until the first answer, a spread of placeholders)
  const shown = [...(cardsOf(index) ?? []), ...(narrow ? [] : cardsOf(index + 1) ?? [])];
  const zoomed = zoomedIdx === null ? undefined : shown[zoomedIdx];
  const step = (by: number) => setZoomedIdx((i) => (i === null || shown.length === 0 ? null : (i + by + shown.length) % shown.length));
  const resetKey = JSON.stringify(filters);
  // the pages are drawn once and left alone while their cards do not change: what they call on a click or a hover is read from here, so it is always current
  const ctl = useRef({ zoom, index, pick: (_n: number) => {} });
  ctl.current = { zoom, index, pick: (n: number) => setZoomedIdx(n) };

  // after each turn, the neighbouring pages are fetched in the background (and the ones after those), so the next turn has its pages ready
  useEffect(() => {
    if (!ready || total === 0) return;
    const near = narrow ? [index + 1, index + 2, index - 1] : [index + 2, index + 3, index + 4, index + 5, index - 2, index - 1];
    void ensure(near.filter((p) => p >= 0 && p < pages), 2500);
  }, [index, ready, total, pages, narrow, ensure]);

  const icon = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  void icon;

  const renderPage = (i: number) => {
    const cards = cardsOf(i);
    return (
      <div className="alb-grid">
        {Array.from({ length: ALBUM_PAGE_CARDS }, (_, k) => {
          const def = cards?.[k];
          return (
            <div key={k} className="alb-slot">
              {!cards && (
                // the page's cards have not arrived yet: placeholders the size of a card and its caption, so nothing jumps when they do
                <div role="status" aria-label="Loading cards" className="alb-wait">
                  <Skeleton className="h-[var(--card-h)] aspect-[146/204] !rounded-xl" />
                  <Skeleton className="alb-wait-caption" />
                </div>
              )}
              {def && (
                <div className="card-tile" {...ctl.current.zoom.on(def)} {...onIntent(() => preloadImage(cardDetailImageUrl(def, "large")))}>
                  <CardView def={def} size="md" onClick={() => (ctl.current.zoom.hide(), ctl.current.pick((i - ctl.current.index) * ALBUM_PAGE_CARDS + k))} />
                  {def.playable === false ? (
                    <span className="alb-caption" data-playable="no">Not playable yet</span>
                  ) : (
                    <span className="alb-caption" data-playable="yes">Playable</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <main className="cards-glass relative flex h-[calc(100dvh-2.7rem)] flex-none flex-col gap-3 overflow-hidden p-3 text-slate-100">
      <div className="page-atmosphere" aria-hidden="true" />
      <div className="album-strip flex shrink-0 flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Link href="/" className="btn-ghost" aria-label="Back to the home page">
            <Back width={15} height={15} />
            Home
          </Link>
          <h1 className="page-title">The library</h1>
          <label className="tool-field min-w-[15rem] flex-1 sm:max-w-sm">
            <Lens />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              placeholder="Search by name"
              aria-label="Search cards by name"
              className="w-full"
            />
          </label>
          <label className="switch" title="Cards the game engine can play today">
            <input
              type="checkbox"
              checked={playableOnly}
              onChange={(e) => {
                setPlayableOnly(e.target.checked);
                setIndex(0);
              }}
            />
            <i />
            Playable only
          </label>
          <span className="count-chip ml-auto">{loading && total === 0 ? "Loading…" : `${total.toLocaleString()} cards`}</span>
        </div>

        <div className="icon-seg self-start" role="group" aria-label="Card type">
          {TYPES.map((t) => (
            <TypeButton
              key={t}
              type={t}
              active={type === t}
              glass
              onClick={() => {
                setType(t);
                setIndex(0);
              }}
            />
          ))}
        </div>
      </div>

      {error && <p className="rounded-xl border border-red-400/40 bg-red-950/50 px-3 py-2 text-sm text-[#f0bfb0]">Could not load cards: {error}</p>}
      {ready && !error && !loading && total === 0 && (
        <p className="empty-note">Nothing by that name on these shelves. If the whole library is empty, the card import has not been run yet (see the project notes).</p>
      )}

      <Album
        pages={pages}
        index={index}
        onIndex={setIndex}
        prepare={(p) => ensure(p)}
        renderPage={renderPage}
        pageToken={cardsOf}
        onTurnStart={() => zoom.hide()}
        busy={loading}
        resetKey={resetKey}
        keysEnabled={zoomedIdx === null}
        label="The card library"
      />

      {zoomedIdx === null && zoom.node}

      {zoomed && (
        <Lightbox
          def={zoomed}
          onClose={() => setZoomedIdx(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          caption={`Card ${zoomedIdx! + 1} of ${shown.length} on show`}
        />
      )}
    </main>
  );
}
