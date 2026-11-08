"use client";

import { useEffect, useRef, useState } from "react";
import type { CardDef } from "@mtg/engine";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CardType } from "@mtg/engine";
import { cardDetailImageUrl, notStandardSet } from "@/lib/cards";
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
import AddToDeck from "./AddToDeck";
import { CARD_SETS } from "@/lib/sets";

type Filter = "all" | CardType;
const TYPES: Filter[] = ["all", "creature", "land", "instant", "sorcery", "enchantment", "artifact", "planeswalker"];

/** The set to show cards of (any set when empty): newest first. */
function SetSelect({ value, onChange, standardOnly = false, className = "" }: { value: string; onChange: (code: string) => void; standardOnly?: boolean; className?: string }) {
  // with Standard legal on, only the sets that are in Standard (and the one already chosen, so the page can say it is not)
  const sets = standardOnly ? CARD_SETS.filter((s) => s.standard || s.code === value) : CARD_SETS;
  return (
    <label className={`tool-field ${className}`} title="Only cards printed in this set">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Set" className="w-full min-w-0 cursor-pointer">
        <option value="" style={{ color: "#111" }}>{standardOnly ? "Any Standard set" : "Any set"}</option>
        {sets.map((s) => (
          <option key={s.code} value={s.code} style={{ color: "#111" }}>
            {s.name} ({s.year})
          </option>
        ))}
      </select>
    </label>
  );
}

/** The library: every card in the game, kept in an album. The search, the filters and the paging of the data are the same as ever; the album shows them nine cards to a page. */
export default function CardBrowser() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<Filter>("all");
  const [playableOnly, setPlayableOnly] = useState(false);
  const [set, setSet] = useState(""); // a set's code, or "" for every set
  const [standardOnly, setStandardOnly] = useState(false);
  const [legendary, setLegendary] = useState(false);
  // a link from the Scribe ("See them in the library") arrives with its filters in the address: /cards?type=creature&set=fdn&standard=1
  const address = useSearchParams();
  const addressKey = address.toString();
  useEffect(() => {
    const p = new URLSearchParams(addressKey);
    if (addressKey === "") return;
    setIndex(0);
    (setType("all"), setSet(""), setStandardOnly(false), setLegendary(false), setPlayableOnly(false), setQuery("")); // (a new link starts from nothing)
    const wanted = p.get("type");
    if (wanted && (TYPES as string[]).includes(wanted)) setType(wanted as Filter);
    if (p.get("set")) setSet(p.get("set")!.toLowerCase());
    if (p.get("standard") === "1") setStandardOnly(true);
    if (p.get("legendary") === "1") setLegendary(true);
    if (p.get("playable") === "1") setPlayableOnly(true);
    if (p.get("q")) setQuery(p.get("q")!);
  }, [addressKey]);
  const [filtersOpen, setFiltersOpen] = useState(false); // phones: the filters are a sheet from the foot of the screen
  const [index, setIndex] = useState(0); // the album page at the left of the spread (the page itself on a narrow screen)
  const filters = { query, type, playableOnly, set: set || undefined, standardOnly, legendary };
  const { cardsOf, ensure, total, loading, error, ready } = useAlbumPages(filters, index);
  const narrow = useMedia("(max-width: 1023px)");
  const zoom = useHoverZoom(); // the big card shown while the mouse is over a card
  const [zoomedIdx, setZoomedIdx] = useState<number | null>(null); // position among the cards on show, while a card is open large

  const pages = ready ? Math.max(1, Math.ceil(total / ALBUM_PAGE_CARDS)) : 2; // (until the first answer, a spread of placeholders)
  const shown = [...(cardsOf(index) ?? []), ...(narrow ? [] : cardsOf(index + 1) ?? [])];
  const [crossing, setCrossing] = useState<"first" | "last" | null>(null); // the large card is going on to the next (or back to the previous) pages: which card of them it lands on
  const held = useRef<CardDef | undefined>(undefined); // the card on show while the next pages are fetched
  const zoomed = zoomedIdx === null ? undefined : shown[zoomedIdx];
  if (zoomed) held.current = zoomed;
  const shownLarge = zoomed ?? (crossing ? held.current : undefined);
  // Next/previous on the large card: through the cards on show, then on to the neighbouring pages (and round the whole library at its ends).
  const step = (by: number) => {
    if (zoomedIdx === null || shown.length === 0) return;
    const next = zoomedIdx + by;
    if (next >= 0 && next < shown.length) return setZoomedIdx(next);
    const per = narrow ? 1 : 2;
    const lastPage = narrow ? pages - 1 : pages - 1 - ((pages - 1) % 2);
    const to = by > 0 ? (index + per > lastPage ? 0 : index + per) : index - per < 0 ? lastPage : index - per;
    if (to === index) return setZoomedIdx((next + shown.length) % shown.length); // a library of one spread
    setZoomedIdx(null);
    setCrossing(by > 0 ? "first" : "last");
    setIndex(to);
  };
  useEffect(() => {
    if (!crossing) return;
    const cards = [...(cardsOf(index) ?? []), ...(narrow ? [] : cardsOf(index + 1) ?? [])];
    if (cards.length === 0) return; // not here yet: this runs again when they arrive
    setZoomedIdx(crossing === "first" ? 0 : cards.length - 1);
    setCrossing(null);
  }, [crossing, index, narrow, cardsOf]);
  const resetKey = JSON.stringify(filters);
  const outOfStandard = notStandardSet(query, set || undefined, standardOnly); // a set that is not Standard legal, asked for with Standard legal on
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
    <main className="cards-glass relative flex h-[calc(100dvh-var(--bar-h)-0.1rem)] flex-none flex-col gap-3 overflow-hidden p-3 text-slate-100">
      <div className="page-atmosphere" aria-hidden="true" />
      <div className="album-strip lib-bar flex shrink-0 flex-col gap-3 p-3 sm:p-4">
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
              placeholder="Search by name, or a set like FDN"
              aria-label="Search cards by name"
              className="w-full"
            />
          </label>
          <button type="button" className="btn-ghost lib-filter-btn" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
            Filters{type !== "all" || playableOnly || set || standardOnly || legendary ? " •" : ""}
          </button>
          <label className="switch max-md:hidden" title="Cards the game engine can play today">
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
          <SetSelect
            value={set}
            standardOnly={standardOnly}
            onChange={(code) => {
              setSet(code);
              setIndex(0);
            }}
            className="max-md:hidden w-[15rem]"
          />
          <label className="switch max-md:hidden" title="Cards legal in Standard today">
            <input
              type="checkbox"
              checked={standardOnly}
              onChange={(e) => {
                setStandardOnly(e.target.checked);
                setIndex(0);
              }}
            />
            <i />
            Standard legal
          </label>
          <label className="switch max-md:hidden" title="Legendary cards only (with the creature button: legendary creatures)">
            <input
              type="checkbox"
              checked={legendary}
              onChange={(e) => {
                setLegendary(e.target.checked);
                setIndex(0);
              }}
            />
            <i />
            Legendary
          </label>
          <span className="count-chip ml-auto max-md:hidden">{loading && total === 0 ? "Loading…" : `${total.toLocaleString()} cards`}</span>
        </div>

        <div className="icon-seg self-start max-md:hidden" role="group" aria-label="Card type">
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

      {filtersOpen && (
        <>
          <div className="bar-sheet-backdrop" aria-hidden="true" onClick={() => setFiltersOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Filters" className="foot-sheet">
            <div className="bar-sheet-head">
              <span className="font-title text-lg text-[#e8dcc0]">Filters</span>
              <button type="button" aria-label="Close the filters" onClick={() => setFiltersOpen(false)} className="bar-sheet-x">
                ×
              </button>
            </div>
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
            <label className="switch" title="Cards legal in Standard today">
              <input
                type="checkbox"
                checked={standardOnly}
                onChange={(e) => {
                  setStandardOnly(e.target.checked);
                  setIndex(0);
                }}
              />
              <i />
              Standard legal
            </label>
            <label className="switch" title="Legendary cards only (with the creature button: legendary creatures)">
              <input
                type="checkbox"
                checked={legendary}
                onChange={(e) => {
                  setLegendary(e.target.checked);
                  setIndex(0);
                }}
              />
              <i />
              Legendary
            </label>
            <SetSelect
              value={set}
              standardOnly={standardOnly}
              onChange={(code) => {
                setSet(code);
                setIndex(0);
              }}
            />
            <div className="icon-seg flex-wrap" role="group" aria-label="Card type">
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
            <button type="button" className="btn-gold foot-sheet-done" onClick={() => setFiltersOpen(false)}>
              Show {loading && total === 0 ? "the cards" : `${total.toLocaleString()} cards`}
            </button>
          </div>
        </>
      )}

      {error && <p className="rounded-xl border border-red-400/40 bg-red-950/50 px-3 py-2 text-sm text-[#f0bfb0]">Could not load cards: {error}</p>}
      {outOfStandard && (
        <p role="status" className="empty-note">
          This set is not Standard legal: {outOfStandard.name} ({outOfStandard.code.toUpperCase()}). Turn off “Standard legal” to see its cards.
        </p>
      )}
      {ready && !error && !loading && total === 0 && !outOfStandard && (
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
        keysEnabled={zoomedIdx === null && !crossing}
        label="The card library"
      />

      {zoomedIdx === null && !crossing && zoom.node}

      {shownLarge && (
        <Lightbox
          def={shownLarge}
          onClose={() => (setCrossing(null), setZoomedIdx(null))}
          {...(shown.length > 1 ? { onPrev: () => step(-1), onNext: () => step(1) } : {})}
          caption={zoomedIdx === null ? "Loading the next cards…" : `Card ${zoomedIdx + 1} of ${shown.length} on show`}
          actions={<AddToDeck key={shownLarge.id} def={shownLarge} />}
        />
      )}
    </main>
  );
}
