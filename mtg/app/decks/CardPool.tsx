"use client";

import { useEffect, useRef, useState } from "react";
import type { CardDef, CardType } from "@mtg/engine";
import { CARDS_PAGE_SIZE } from "@/lib/cards";
import type { DeckEntries } from "@/lib/decks";
import CardView from "../play/CardView";
import { useHoverZoom } from "../play/HoverZoom";
import { CardSkeletons } from "../Skeleton";
import { usePageKeys } from "@/lib/pageKeys";
import { ManaSymbol } from "../play/ManaSymbols";
import TypeButton from "../cards/TypeButton";
import { useCardSearch } from "../cards/useCardSearch";
import { useMedia } from "../play/useMedia";

type Filter = "all" | CardType;
const TYPES: Filter[] = ["all", "creature", "land", "instant", "sorcery", "enchantment", "artifact", "planeswalker"];
const COLORS = ["W", "U", "B", "R", "G"];

/** The Add cards tab: search the cards the game can play and click one to add a copy to the deck. */
export default function CardPool({ hidden, entries, onAdd, onZoom }: { hidden: boolean; entries: DeckEntries; onAdd: (def: CardDef) => void; onZoom: (def: CardDef) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<Filter>("all");
  const [colors, setColors] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const zoom = useHoverZoom(); // the big card next to whatever the mouse is over
  const phone = useMedia("(max-width: 1023px)"); // a phone scrolls on through the pages instead of turning them
  const { result, loading } = useCardSearch({ query, type, playableOnly: true, colors, page });
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / CARDS_PAGE_SIZE));
  usePageKeys({ page, pages, setPage, enabled: !hidden }); // the arrow keys turn the page (while this list is the one on screen)

  // Any change to the search starts again from the first page.
  const refine = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(0);
  };
  const toggleColor = refine((c: string) => setColors((cs) => COLORS.filter((x) => (x === c ? !cs.includes(c) : cs.includes(x)))));

  return (
    <section className={hidden ? "hidden" : "glass flex flex-col gap-3 p-4"}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => refine(setQuery)(e.target.value)}
          placeholder="Search cards"
          className="rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 outline-none focus:border-amber-300"
        />
        {TYPES.map((t) => (
          <TypeButton key={t} type={t} active={type === t} onClick={() => refine(setType)(t)} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-300">Colors</span>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggleColor(c)}
            aria-pressed={colors.includes(c)}
            className={`rounded-full p-1 transition ${colors.includes(c) ? "bg-amber-400" : "opacity-40 grayscale hover:opacity-80"}`}
          >
            <ManaSymbol symbol={c} />
          </button>
        ))}
        {colors.length > 0 && (
          <button type="button" onClick={() => refine(setColors)([])} className="text-xs text-slate-300 underline hover:text-white">
            Any color
          </button>
        )}
        <span className="text-xs text-slate-400">
          {colors.length > 0 ? "Cards of these colors, plus colorless ones. " : ""}
          {loading ? "Loading…" : `${total.toLocaleString()} cards`}
        </span>
      </div>
      {result?.error && <p className="text-sm text-red-300">{result.error}</p>}
      {!result && <CardSkeletons count={CARDS_PAGE_SIZE} size="md" className="flex flex-wrap gap-2" />}
      <div className={`pool-grid flex flex-wrap gap-2 transition-opacity ${loading ? "opacity-50" : ""}`}>
        {phone && Array.from({ length: page }, (_, i) => <PoolPage key={`${query}|${type}|${colors.join("")}|${i}`} search={{ query, type, playableOnly: true, colors, page: i }} entries={entries} onAdd={onAdd} onZoom={onZoom} />)}
        {result?.cards.map((def) => (
          <div key={def.id} {...zoom.on(def)}>
            <CardView def={def} note={entries[def.id] ? `×${entries[def.id]}` : undefined} onClick={() => onAdd(def)} onZoom={() => onZoom(def)} />
          </div>
        ))}
      </div>
      {phone ? (
        <MoreSentinel more={page + 1 < pages} busy={loading} onMore={() => setPage((p) => p + 1)} />
      ) : (
      <div className="mx-auto flex items-center gap-3 text-sm">
        <button disabled={page === 0} onClick={() => setPage(page - 1)} className="btn-ghost !px-3 !py-1">
          ← Prev
        </button>
        <span className="text-slate-300">
          Page {page + 1} of {pages.toLocaleString()}
        </span>
        <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="btn-ghost !px-3 !py-1">
          Next →
        </button>
      </div>
      )}
      {zoom.node}
    </section>
  );
}

/** One earlier page of the results, kept in the list while a phone scrolls on to the next. */
function PoolPage({ search, entries, onAdd, onZoom }: { search: Parameters<typeof useCardSearch>[0]; entries: DeckEntries; onAdd: (def: CardDef) => void; onZoom: (def: CardDef) => void }) {
  const { result } = useCardSearch(search);
  return (
    <>
      {result?.cards.map((def) => (
        <div key={def.id}>
          <CardView def={def} note={entries[def.id] ? `×${entries[def.id]}` : undefined} onClick={() => onAdd(def)} onZoom={() => onZoom(def)} />
        </div>
      ))}
    </>
  );
}

/** The foot of the list: when it scrolls into view the next page is asked for (and a button does the same, for anyone who would rather press). */
function MoreSentinel({ more, busy, onMore }: { more: boolean; busy: boolean; onMore: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  useEffect(() => {
    latest.current = onMore;
  });
  useEffect(() => {
    const el = box.current;
    if (!el || !more || busy || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && latest.current(), { rootMargin: "600px 0px" });
    watch.observe(el);
    return () => watch.disconnect();
  }, [more, busy]);
  return (
    <div ref={box} className="mx-auto min-h-12 text-center text-sm text-slate-300">
      {more ? (
        <button type="button" className="btn-ghost" disabled={busy} onClick={onMore}>
          {busy ? "Loading…" : "More cards"}
        </button>
      ) : (
        "That is all of them."
      )}
    </div>
  );
}
