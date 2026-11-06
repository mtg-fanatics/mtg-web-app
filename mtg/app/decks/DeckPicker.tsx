"use client";

import { useMemo, useState } from "react";
import { cardImageUrl } from "@/lib/cards";
import { setName } from "@/lib/decks";
import type { DeckChoice } from "@/lib/decks";
import { Skeleton } from "../Skeleton";
import DeckColors from "./DeckColors";

type Tab = "all" | "mine" | "official";

const art = (d?: DeckChoice) => (d?.cover ? { backgroundImage: `url(${cardImageUrl(d.cover)})`, backgroundPosition: "50% 22%" } : undefined);

/**
 * "Choose your deck": the decks as picture tiles instead of a drop-down. A search box, tabs for your own and the ready-made decks,
 * and a random deck first. The chosen deck is shown big above the list.
 * `compact`: one column, for narrow places (the hot-seat setup). `wide`: everything larger, for a pop-up with room.
 */
export default function DeckPicker({
  choices,
  size,
  randomId,
  value,
  onChange,
  disabled = false,
  compact = false,
  loading = false,
  wide = false,
}: {
  choices: DeckChoice[];
  size: number;
  randomId: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  compact?: boolean;
  loading?: boolean;
  wide?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const fits = useMemo(() => choices.filter((c) => c.ids.length === size), [choices, size]);
  // Your own decks are always listed. One that is not 60 cards can't be played yet, so it is shown greyed out with the reason
  // (it used to vanish from the list, and players thought their decks were gone).
  const mine = choices.filter((c) => !c.official);
  const official = fits.filter((c) => c.official);
  const all = [...mine.filter((c) => c.ids.length === size), ...official, ...mine.filter((c) => c.ids.length !== size)];
  const shown = (tab === "mine" ? mine : tab === "official" ? official : all).filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  const picked = fits.find((c) => c.id === value);
  const skeleton = loading && choices.length === 0; // the decks are on their way: shapes where they will be
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All", count: all.length },
    ...(mine.length > 0 ? [{ id: "mine" as const, label: "My decks", count: mine.length }] : []),
    { id: "official", label: "Ready-made", count: official.length },
  ];

  return (
    <div className={`flex flex-col text-left ${wide ? "gap-4 lg:min-h-0 lg:flex-1" : "gap-3"}`} aria-busy={loading}>
      {/* the chosen deck */}
      <div className={`relative flex items-end overflow-hidden rounded-xl border-2 border-[#120c07] bg-slate-900/70 shadow-lg shadow-black/40 ${wide ? "min-h-[7rem]" : "min-h-[4.75rem]"}`}>
        <div className="absolute inset-0 bg-cover opacity-55" style={art(picked)} aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-slate-950/10" aria-hidden="true" />
        <div className={`relative flex w-full items-center gap-3 ${wide ? "px-6 py-5" : "px-4 py-3"}`}>
          <div className="min-w-0 flex-1">
            <p className={`italic-note text-[#d8c8a2] ${wide ? "text-base" : "text-xs"}`}>Your deck</p>
            <p className={`truncate font-title leading-tight text-[#f1e8d0] ${wide ? "text-2xl sm:text-4xl" : "text-xl"}`}>{picked ? picked.name : `Random ${size}-card deck`}</p>
            <p className={`text-slate-300 ${wide ? "text-base" : "text-xs"}`}>
              {picked ? [`${size} cards`, picked.official ? "Ready-made" : "Your deck", setName(picked.code ?? null)].filter(Boolean).join(" · ") : "A new mix every game"}
            </p>
          </div>
          {picked && (
            <span className={wide ? "origin-right scale-125" : ""}>
              <DeckColors colors={picked.colors} />
            </span>
          )}
          {!picked && (
            <span aria-hidden="true" className={wide ? "text-5xl" : "text-3xl"}>
              🎲
            </span>
          )}
        </div>
      </div>

      {/* search and tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Which decks" className="seg !flex max-w-full gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-md font-bold transition ${wide ? "px-3 py-1.5 text-sm sm:px-5 sm:py-2 sm:text-base" : "px-3 py-1 text-xs"} ${tab === t.id ? "paper !border-[1.5px] !shadow-none" : "text-slate-200 hover:bg-white/10"}`}
            >
              {t.label}{" "}
              {skeleton ? <Skeleton className="inline-block h-3.5 w-5 align-middle" /> : <span className={tab === t.id ? "opacity-70" : "text-slate-400"}>{t.count}</span>}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search decks…"
          aria-label="Search decks"
          className={`min-w-0 flex-1 max-[520px]:basis-full auth-input !w-auto ${wide ? "px-5 py-2.5 text-base" : "px-3.5 py-1.5 text-sm"}`}
        />
      </div>

      {/* the decks */}
      <ul role="listbox" aria-label="Decks" className={`grid content-start overflow-y-auto pr-1 ${wide ? "max-h-[max(24rem,calc(100dvh-26rem))] gap-3 lg:min-h-0 lg:max-h-none lg:flex-1" : "max-h-[17rem] gap-2"} ${compact ? "grid-cols-1" : "grid-cols-1 min-[440px]:grid-cols-2"}`}>
        <li role="presentation">
          <Tile selected={value === randomId} disabled={disabled} onPick={() => onChange(randomId)} emoji="🎲" wide={wide}>
            <span className="min-w-0 flex-1">
              <span className={`block truncate font-bold leading-tight ${wide ? "text-lg" : "text-sm"}`}>Random deck</span>
              <span className={`block text-slate-300 ${wide ? "text-sm" : "text-xs"}`}>{size} cards, a new mix</span>
            </span>
          </Tile>
        </li>
        {skeleton &&
          Array.from({ length: wide ? 8 : 5 }, (_, i) => (
            <li key={`sk${i}`} role="presentation" aria-hidden="true">
              <div className={`flex items-stretch rounded-xl border border-white/10 bg-white/[0.04] ${wide ? "gap-3.5 p-2.5" : "gap-2.5 p-1.5"}`}>
                <Skeleton className={`shrink-0 ${wide ? "h-[4.75rem] w-28" : "h-12 w-16"}`} />
                <div className="flex flex-1 flex-col justify-center gap-2">
                  <Skeleton className={`w-4/5 ${wide ? "h-4" : "h-3"}`} />
                  <Skeleton className={`w-1/2 ${wide ? "h-3.5" : "h-3"}`} />
                </div>
              </div>
            </li>
          ))}
        {skeleton && (
          <li className="sr-only" role="status">
            Loading your decks…
          </li>
        )}
        {shown.map((d) => (
          <li key={d.id} role="presentation">
            <Tile selected={value === d.id} disabled={disabled || d.ids.length !== size} onPick={() => onChange(d.id)} art={art(d)} wide={wide}>
              <span className="min-w-0 flex-1">
                <span className={`line-clamp-2 font-bold leading-tight ${wide ? "text-lg" : "text-sm"}`}>{d.name}</span>
                <span className={`mt-1 flex items-center gap-1.5 text-slate-300 ${wide ? "text-sm" : "text-xs"}`}>
                  <DeckColors colors={d.colors} />
                  <span className="truncate">{d.ids.length !== size ? `${d.ids.length} cards: needs ${size}` : d.official ? (setName(d.code ?? null) ?? "Ready-made") : "Your deck"}</span>
                </span>
              </span>
            </Tile>
          </li>
        ))}
        {!loading && shown.length === 0 && query && <li className="col-span-full py-3 text-center text-sm text-slate-300">No deck matches “{query}”.</li>}
      </ul>
      {mine.some((c) => c.ids.length !== size) && <p className="text-xs text-slate-400">Greyed-out decks of yours don&apos;t have {size} cards yet. Add cards in the deck editor to play them.</p>}
    </div>
  );
}

function Tile({
  selected,
  disabled,
  onPick,
  art: artStyle,
  emoji,
  wide,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
  art?: React.CSSProperties;
  emoji?: string;
  wide: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={onPick}
      className={`group relative flex h-full w-full items-stretch overflow-hidden rounded-lg border-2 text-left transition disabled:opacity-60 ${wide ? "gap-3.5 p-2.5 pr-4" : "gap-2.5 p-1.5 pr-2.5"} ${
        selected ? "border-[#d9694f] bg-[#b3392b]/20 ring-2 ring-[#d9694f]/60" : "border-[#120c07] bg-white/[0.06] hover:-translate-y-0.5 hover:border-[#d9694f]/60 hover:bg-white/10"
      }`}
    >
      <span
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-cover ring-1 ring-black/40 transition group-hover:brightness-110 ${wide ? "h-[4.75rem] w-28 text-4xl" : "h-12 w-16 text-2xl"} ${emoji ? "bg-gradient-to-br from-indigo-500/50 to-fuchsia-500/40" : "bg-slate-800"}`}
        style={artStyle}
        aria-hidden="true"
      >
        {emoji}
      </span>
      {children}
      {selected && (
        <span aria-hidden="true" className={`absolute flex items-center justify-center rounded-[45%_55%_50%_50%] bg-[#e8dcc0] font-extrabold text-[#1f1710] shadow ${wide ? "right-2 top-2 h-6 w-6 text-sm" : "right-1.5 top-1.5 h-5 w-5 text-xs"}`}>
          ✓
        </span>
      )}
    </button>
  );
}
