"use client";

import { useState } from "react";
import Link from "next/link";
import type { CardType } from "@mtg/engine";
import { CARDS_PAGE_SIZE, cardDetailImageUrl } from "@/lib/cards";
import { onIntent, preloadImage } from "@/lib/prefetch";
import { Lightbox } from "../play/CardDetail";
import CardView from "../play/CardView";
import { useHoverZoom } from "../play/HoverZoom";
import { CardSkeletons } from "../Skeleton";
import { usePageKeys } from "@/lib/pageKeys";
import TypeButton from "./TypeButton";
import { useCardSearch } from "./useCardSearch";
import { Back, Lens } from "../Icons";

type Filter = "all" | CardType;
const TYPES: Filter[] = ["all", "creature", "land", "instant", "sorcery", "enchantment", "artifact", "planeswalker"];

export default function CardBrowser() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<Filter>("all");
  const [playableOnly, setPlayableOnly] = useState(false);
  const [page, setPage] = useState(0);
  const { result, loading } = useCardSearch({ query, type, playableOnly, page });
  const zoom = useHoverZoom(); // the big card shown while the mouse is over a card
  const [zoomedIdx, setZoomedIdx] = useState<number | null>(null); // position on this page, while a card is open large

  const shown = result?.cards ?? [];
  const zoomed = zoomedIdx === null ? undefined : shown[zoomedIdx];
  const step = (by: number) => setZoomedIdx((i) => (i === null || shown.length === 0 ? null : (i + by + shown.length) % shown.length));
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / CARDS_PAGE_SIZE));
  usePageKeys({ page, pages, setPage, enabled: zoomedIdx === null }); // the arrow keys turn the page
  const icon = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

  return (
    <main className="cards-glass relative flex flex-1 flex-col gap-3 p-3 text-slate-100 lg:h-[calc(100dvh-2.7rem)] lg:flex-none lg:overflow-hidden">
      <div className="page-atmosphere" aria-hidden="true" />
      <div className="glass flex shrink-0 flex-col gap-3 p-3 sm:p-4">
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
                setPage(0);
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
                setPage(0);
              }}
            />
            <i />
            Playable only
          </label>
          <span className="count-chip ml-auto">{loading ? "Loading…" : `${total.toLocaleString()} cards`}</span>
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
              setPage(0);
              
            }}
          />
        ))}
      </div>
      </div>

      {result?.error && <p className="rounded-xl border border-red-400/40 bg-red-950/50 px-3 py-2 text-sm text-[#f0bfb0]">Could not load cards: {result.error}</p>}
      {result && !result.error && !loading && total === 0 && (
        <p className="empty-note">Nothing by that name on these shelves. If the whole library is empty, the card import has not been run yet (see the project notes).</p>
      )}

      {!result && <CardSkeletons count={CARDS_PAGE_SIZE} size="md" className="glass cards-fit p-3" />}
      <div className={`glass cards-fit p-3 transition-opacity ${loading ? "opacity-50" : ""}`}>
        {result?.cards.map((def, i) => (
          <div key={def.id} className="card-tile glass-tile" {...zoom.on(def)} {...onIntent(() => preloadImage(cardDetailImageUrl(def, "large")))}>
            <CardView def={def} size="md" onClick={() => (zoom.hide(), setZoomedIdx(i))} />
            {def.playable === false ? <span className="chip chip-meta !text-[10px]">Not playable yet</span> : <span className="chip chip-ok !text-[10px]">Playable</span>}
          </div>
        ))}
      </div>

      <div className="glass mx-auto flex shrink-0 items-center justify-center gap-3 !rounded-full px-5 py-1.5 text-sm">
        <button disabled={page === 0} onClick={() => setPage(page - 1)} className="pager-btn">
          ← Prev
        </button>
        <span className="count-chip">
          Page {page + 1} of {pages.toLocaleString()}
        </span>
        <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="pager-btn">
          Next →
        </button>
      </div>

      {zoomedIdx === null && zoom.node}

      {zoomed && (
        <Lightbox
          def={zoomed}
          onClose={() => setZoomedIdx(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          caption={`Card ${zoomedIdx! + 1} of ${shown.length} on this page`}
        />
      )}
    </main>
  );
}
