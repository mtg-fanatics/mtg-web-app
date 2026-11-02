"use client";

import { useEffect, useState } from "react";
import type { CardDef } from "@mtg/engine";
import { loadDeckPreview, setName } from "@/lib/decks";
import type { DeckBoard, DeckContents, OfficialDeck } from "@/lib/decks";
import { Lightbox } from "../play/CardDetail";
import CardView from "../play/CardView";
import { CardSkeletons } from "../Skeleton";
import Link from "next/link";
import { useHoverZoom } from "../play/HoverZoom";
import { holdWallpaper } from "../LiveWallpaper";

const BOARDS: { id: DeckBoard; label: string }[] = [
  { id: "commander", label: "Commander" },
  { id: "main", label: "Main deck" },
  { id: "side", label: "Sideboard" },
];

type Loaded = { contents: DeckContents; defs: Record<string, CardDef> };

/**
 * Look inside a deck. Hover a card to see it big, click it to read it large.
 * For an official deck, pass `onCopy`; for one of your own, pass `editHref` instead.
 */
export default function DeckPreview({
  deck,
  parts,
  busy = false,
  onCopy,
  editHref,
  layer = "z-20",
  onClose,
}: {
  deck: Pick<OfficialDeck, "id" | "name"> & Partial<Pick<OfficialDeck, "code" | "releaseDate">>;
  /** Decks shown together as one (two packs mixed), instead of `deck.id`. */
  parts?: string[];
  busy?: boolean;
  onCopy?: () => void;
  /** A link to edit the deck, for your own decks. */
  editHref?: string;
  /** Stacking class, for when this opens on top of another pop-up. */
  layer?: string;
  onClose: () => void;
}) {
  const zoom = useHoverZoom();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomedIdx, setZoomedIdx] = useState<number | null>(null); // position in the deck, while a card is open large

  const sources = (parts ?? [deck.id]).join(",");
  useEffect(() => {
    let cancelled = false;
    loadDeckPreview(sources)
      .then((l) => !cancelled && setLoaded(l))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sources]);

  // Freeze the moving wallpaper behind the blurred glass while this is open.
  useEffect(() => holdWallpaper(), []);

  // Esc closes the preview, unless a card is open large (then Esc closes just that).
  useEffect(() => {
    if (zoomedIdx !== null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomedIdx, onClose]);

  const sections = loaded
    ? BOARDS.map(({ id, label }) => {
        const entries = Object.entries(loaded.contents.boards[id])
          .map(([cardId, qty]) => ({ def: loaded.defs[cardId], qty }))
          .filter((e): e is { def: CardDef; qty: number } => Boolean(e.def))
          .sort((a, b) => a.def.cost - b.def.cost || a.def.name.localeCompare(b.def.name));
        return { id, label, entries, total: entries.reduce((n, e) => n + e.qty, 0) };
      }).filter((s) => s.entries.length > 0)
    : [];

  // Every distinct card in the order shown on screen, so Previous / Next follow what you see.
  const flat = sections.flatMap((s) => s.entries.map((e) => ({ ...e, label: s.label })));
  const sectionStart = sections.map((_, i) => sections.slice(0, i).reduce((n, s) => n + s.entries.length, 0));
  const step = (by: number) => setZoomedIdx((i) => (i === null ? null : (i + by + flat.length) % flat.length));
  const current = zoomedIdx === null ? null : flat[zoomedIdx];

  const allIds = sections.flatMap((s) => s.entries.flatMap((e) => Array<string>(e.qty).fill(e.def.id)));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={deck.name}
      onClick={onClose}
      className={`fixed inset-0 ${layer} flex items-center justify-center bg-black/70 p-4`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel-glass flex max-h-[92vh] w-full max-w-6xl flex-col gap-4 overflow-hidden p-5 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)] sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="page-title truncate !text-2xl sm:!text-3xl">{deck.name}</h2>
            <div className="flex flex-wrap items-center gap-2">
              {deck.code && <span className="chip chip-meta">{setName(deck.code)}</span>}
              {deck.releaseDate && <span className="chip chip-meta">{deck.releaseDate.slice(0, 4)}</span>}
              {loaded && <span className="chip chip-meta">{allIds.length} cards</span>}
            </div>
          </div>
          {onCopy && (
            <button
              onClick={onCopy}
              disabled={busy}
              title="Make your own copy to change its cards"
              className="btn-gold ml-auto !px-4 !py-2"
            >
              {busy ? "Copying…" : "Copy & edit"}
            </button>
          )}
          {editHref && (
            <Link href={editHref} className="btn-gold ml-auto !px-4 !py-2">
              Edit deck
            </Link>
          )}
          <button onClick={onClose} aria-label="Close" className="btn-ghost !px-3 !py-2 !text-lg leading-none">
            ×
          </button>
        </div>

        {error && <p className="rounded-xl border border-red-400/40 bg-red-950/50 px-3 py-2 text-sm text-[#f0bfb0]">Could not load the deck: {error}</p>}
        {!loaded && !error && <CardSkeletons count={20} size="md" className="flex flex-wrap gap-2" />}

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          {sections.map((s, si) => (
            <section key={s.id}>
              <h3 className="mb-2.5 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-[#e8dcc0]">
                {s.label}
                <span className="count-chip !px-2 !py-0 !text-xs">{s.total}</span>
                <span className="h-px flex-1 bg-gradient-to-r from-[#d9694f]/50 to-transparent" aria-hidden="true" />
              </h3>
              <div className="flex flex-wrap gap-2.5">
                {s.entries.map(({ def, qty }, ei) => (
                  <div key={def.id} className="card-tile !items-stretch" {...zoom.on(def)}>
                    <CardView
                      def={def}
                      size="md"
                      note={qty > 1 ? `×${qty}` : undefined}
                      onClick={() => (zoom.hide(), setZoomedIdx(sectionStart[si] + ei))}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {zoomedIdx === null && zoom.node}

      {current && (
        <Lightbox
          def={current.def}
          onClose={() => setZoomedIdx(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          caption={`${current.label} · card ${zoomedIdx! + 1} of ${flat.length}${current.qty > 1 ? ` · ×${current.qty} in the deck` : ""}`}
        />
      )}
    </div>
  );
}
