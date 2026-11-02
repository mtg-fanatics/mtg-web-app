"use client";

import { isPack, PACK_TYPE, setName } from "@/lib/decks";
import { ManaSymbol } from "../play/ManaSymbols";
import { Lens } from "../Icons";

/** What the Decks page is narrowed to. Empty values mean "everything". */
export interface DeckFilterState {
  query: string;
  /** A deck must have every one of these colors (W, U, B, R, G). */
  colors: string[];
  /** A deck type such as "Theme Deck", or PACK_TYPE for the Jumpstart packs. */
  type: string;
  /** A set code such as "FDN". */
  set: string;
  /** Your own decks: only the ones ready to play, or only the ones with a problem. */
  status: "all" | "ready" | "problems";
}

export const NO_FILTERS: DeckFilterState = { query: "", colors: [], type: "", set: "", status: "all" };

export const filtersOn = (f: DeckFilterState) => f.query.trim() !== "" || f.colors.length > 0 || f.type !== "" || f.set !== "" || f.status !== "all";

/** The deck type as filtered on (the older name of the packs counts as the packs). */
export const typeOf = (deckType: string | null | undefined) => (isPack({ deckType: deckType ?? null }) ? PACK_TYPE : (deckType ?? "Other"));

/** Does this deck pass the filters? `colors` are the deck's colors; `ready` is only known for your own decks. */
export function deckMatches(f: DeckFilterState, deck: { name: string; deckType?: string | null; code?: string | null }, colors: string[], ready?: boolean): boolean {
  const q = f.query.trim().toLowerCase();
  if (q && !deck.name.toLowerCase().includes(q)) return false;
  if (f.colors.length > 0 && !f.colors.every((c) => colors.includes(c))) return false;
  if (f.type && typeOf(deck.deckType) !== f.type) return false;
  if (f.set && (deck.code ?? "") !== f.set) return false;
  if (f.status === "ready" && ready !== true) return false;
  if (f.status === "problems" && ready !== false) return false;
  return true;
}

const COLOR_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

const box = "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition";

/**
 * The row of filters above a list of decks: a name search, the colors, and (when given) the type, the set and the status.
 * `shown` and `total` say how many decks pass.
 */
export default function DeckFilterBar({
  value,
  onChange,
  types,
  sets,
  status = false,
  shown,
  total,
}: {
  value: DeckFilterState;
  onChange: (next: DeckFilterState) => void;
  types?: { value: string; label: string }[];
  sets?: { value: string; label: string }[];
  status?: boolean;
  shown: number;
  total: number;
}) {
  const set = (patch: Partial<DeckFilterState>) => onChange({ ...value, ...patch });
  const toggleColor = (c: string) => set({ colors: value.colors.includes(c) ? value.colors.filter((x) => x !== c) : [...value.colors, c] });

  return (
    <div role="search" aria-label="Filter the decks" className="flex flex-wrap items-center gap-2.5">
      <label className="tool-field min-w-[13rem] flex-1 sm:max-w-xs">
        <Lens />
        <input value={value.query} onChange={(e) => set({ query: e.target.value })} maxLength={60} placeholder="Search by name" aria-label="Search decks by name" className="w-full" />
      </label>

      <div role="group" aria-label="Colors" className="flex items-center gap-1">
        {(["W", "U", "B", "R", "G"] as const).map((c) => {
          const on = value.colors.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleColor(c)}
              aria-pressed={on}
              title={`${COLOR_NAMES[c]}${on ? " (click to remove)" : ""}`}
              className={`${box} !px-2 ${on ? "border-amber-400 bg-amber-400/25" : "border-white/25 bg-white/10 hover:bg-white/20"}`}
            >
              <ManaSymbol symbol={c} />
              <span className="sr-only">{COLOR_NAMES[c]}</span>
            </button>
          );
        })}
      </div>

      {types && types.length > 1 && (
        <label className="tool-field">
          <select value={value.type} onChange={(e) => set({ type: e.target.value })} className="glass-select cursor-pointer pr-1" aria-label="Deck type">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {sets && sets.length > 1 && (
        <label className="tool-field">
          <select value={value.set} onChange={(e) => set({ set: e.target.value })} className="glass-select cursor-pointer pr-1" aria-label="Set">
            <option value="">All sets</option>
            {sets.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {status && (
        <div className="seg" role="group" aria-label="Status">
          {(
            [
              ["all", "All"],
              ["ready", "Ready to play"],
              ["problems", "Has problems"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={value.status === id} onClick={() => set({ status: id })}>
              {label}
            </button>
          ))}
        </div>
      )}

      {filtersOn(value) && (
        <button type="button" onClick={() => onChange(NO_FILTERS)} className="btn-ghost !px-3 !py-1.5">
          Clear filters
        </button>
      )}
      <span className="count-chip">{filtersOn(value) ? `${shown} of ${total}` : `${total}`} decks</span>
    </div>
  );
}

/** The sets that appear among decks, as filter choices, by name. */
export function setChoices(decks: { code: string | null }[]): { value: string; label: string }[] {
  const codes = [...new Set(decks.map((d) => d.code).filter((c): c is string => Boolean(c)))];
  return codes.map((c) => ({ value: c, label: setName(c) ?? c })).sort((a, b) => a.label.localeCompare(b.label));
}
