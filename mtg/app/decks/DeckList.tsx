"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CardDef } from "@mtg/engine";
import { copyOfficialDeck, coverOf, DECK_PAGE_SIZE, deckColors, deckStatus, deleteDeck, listMyDecks, listOfficialDecks, loadDeckPreview, loadDefsFor, isPack, OFFICIAL_SECTIONS, PACK_TYPE, setName } from "@/lib/decks";
import type { Deck, DeckEntries, OfficialDeck } from "@/lib/decks";
import { cardImageUrl } from "@/lib/cards";
import { onIntent } from "@/lib/prefetch";
import ConfirmDialog from "../ConfirmDialog";
import LiveWallpaper from "../LiveWallpaper";
import { RowSkeletons, Skeleton } from "../Skeleton";
import DeckColors from "./DeckColors";
import DeckFilterBar, { deckMatches, NO_FILTERS, setChoices, typeOf } from "./DeckFilters";
import DeckPreview from "./DeckPreview";
import MixPacks from "./MixPacks";
import { Back, Plus } from "../Icons";

const iconProps = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const cardTotal = (entries: DeckEntries) => Object.values(entries).reduce((n, q) => n + q, 0);

/** The card a deck is shown with: its most expensive creature (or spell) that has a picture. */
/** Numbered page buttons: first, previous, a window of numbers around the current page, next, last. */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  const numbers: (number | "gap")[] = [];
  for (let i = 0; i < pages; i++) {
    if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) numbers.push(i);
    else if (numbers[numbers.length - 1] !== "gap") numbers.push("gap");
  }
  const base = "pager-btn";
  return (
    <nav aria-label="Pages" className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
      <button disabled={page === 0} onClick={() => onPage(page - 1)} className={base}>
        ← Prev
      </button>
      {numbers.map((n, i) =>
        n === "gap" ? (
          <span key={`gap${i}`} className="px-1 text-slate-300">
            …
          </span>
        ) : (
          <button key={n} onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined} className={base}>
            {n + 1}
          </button>
        ),
      )}
      <button disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} className={base}>
        Next →
      </button>
    </nav>
  );
}

export default function DeckList() {
  const [tab, setTab] = useState<"mine" | "official">("mine");
  return (
    <main className="relative flex h-[calc(100dvh-2.6rem)] min-h-0 flex-none flex-col overflow-hidden p-4 text-slate-100 sm:p-6">
      <LiveWallpaper name="decks" />
      <div className="panel-glass mx-auto flex max-h-full min-h-0 w-full max-w-6xl flex-col gap-4 p-5 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)] sm:p-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Link href="/" className="btn-ghost" aria-label="Back to the home page">
            <Back width={15} height={15} />
            Home
          </Link>
          <h1 className="page-title">Your decks</h1>
          <div className="seg" role="group" aria-label="Which decks">
            <button onClick={() => setTab("mine")} aria-pressed={tab === "mine"}>
              Mine
            </button>
            <button onClick={() => setTab("official")} aria-pressed={tab === "official"}>
              Ready-made
            </button>
          </div>
          <Link href="/decks/new" className="btn-gold ml-auto !px-4 !py-2 !text-sm">
            <Plus width={16} height={16} />
            New deck
          </Link>
        </div>
        {/* only the decks scroll, inside the panel: the title and the tabs stay where they are */}
        <div className="deck-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">{tab === "mine" ? <MyDecks /> : <OfficialDecks />}</div>
      </div>
    </main>
  );
}

function MyDecks() {
  const [version, setVersion] = useState(0);
  const [deleting, setDeleting] = useState<Deck | null>(null); // the deck the "are you sure?" pop-up is about
  const [shown, setShown] = useState(0);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [data, setData] = useState<{ version: number; decks: Deck[]; defs: Record<string, CardDef>; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyDecks()
      .then(async (decks) => ({ version, decks, defs: await loadDefsFor(decks) }))
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setData({ version, decks: [], defs: {}, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!data || data.version !== version) return <RowSkeletons count={5} className="h-[72px]" label="Loading decks" />;
  if (data.error) return <p className="text-sm text-[#fca5a5]">Could not load decks: {data.error}</p>;
  if (data.decks.length === 0)
    return (
      <p className="empty-note">
        The shelf is bare. Write a deck with &quot;New deck&quot;, or borrow from the ready-made ones: play them as they are, or copy one and change its cards.
      </p>
    );

  const visible = data.decks.filter((d) => deckMatches(filters, { name: d.name }, deckColors(data.defs, d.entries), deckStatus(data.defs, d.entries).ready));
  const pages = Math.max(1, Math.ceil(visible.length / DECK_PAGE_SIZE));
  const current = Math.min(shown, pages - 1);
  return (
    <>
    <DeckFilterBar value={filters} onChange={(f) => (setFilters(f), setShown(0))} status shown={visible.length} total={data.decks.length} />
    {visible.length === 0 && (
      <p className="empty-note">
        Nothing on the shelf fits.{" "}
        <button onClick={() => setFilters(NO_FILTERS)} className="underline hover:text-[#e8dcc0]">
          Wipe the filters clean
        </button>
      </p>
    )}
    <ul className="flex flex-col gap-2.5">
      {visible.slice(current * DECK_PAGE_SIZE, (current + 1) * DECK_PAGE_SIZE).map((deck) => {
        const status = deckStatus(data.defs, deck.entries);
        return (
          <li key={deck.id} className="deck-row" style={{ "--accent": status.ready ? "#6b9a7f" : "#d9694f" } as React.CSSProperties}>
            <Link href={`/decks/${deck.id}`} className="deck-name hover:text-[#d9694f]">
              {deck.name}
            </Link>
            <DeckColors colors={deckColors(data.defs, deck.entries)} />
            <span className="chip chip-meta">{status.count} cards</span>
            {status.ready ? (
              <span className="chip chip-ok">✓ Ready to play</span>
            ) : (
              <span
                className="chip chip-warn"
                title={[...status.errors, ...status.unplayable.map((c) => `${c.name} can't be played yet`)].join("\n")}
              >
                ⚠ {status.errors.length + status.unplayable.length} problem{status.errors.length + status.unplayable.length === 1 ? "" : "s"}
              </span>
            )}
            <Link href={`/decks/${deck.id}`} className="btn-ghost ml-auto">
              Edit
            </Link>
            <button onClick={() => setDeleting(deck)} className="btn-danger">
              Delete
            </button>
          </li>
        );
      })}
    </ul>
    <Pager page={current} pages={pages} onPage={setShown} />
    {deleting && (
      <ConfirmDialog
        title="Delete this deck?"
        subject={deleting.name}
        message="The deck is removed from your account for good. The cards stay in the catalogue, and you can always build a new one."
        confirmLabel="Delete deck"
        cancelLabel="Keep deck"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          await deleteDeck(deleting.id);
          setDeleting(null);
          setVersion((v) => v + 1);
        }}
      />
    )}
    </>
  );
}

function OfficialDecks() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OfficialDeck | null>(null); // deck being looked at before copying
  const [filters, setFilters] = useState(NO_FILTERS);
  const [data, setData] = useState<{ decks: OfficialDeck[]; defs: Record<string, CardDef>; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOfficialDecks()
      .then(async (decks) => ({ decks, defs: await loadDefsFor(decks) }))
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setData({ decks: [], defs: {}, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy(deck: OfficialDeck) {
    setBusy(deck.id);
    setError(null);
    try {
      router.push(`/decks/${await copyOfficialDeck(deck.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy the deck.");
      setBusy(null);
    }
  }

  if (!data)
    return (
      <div role="status" aria-label="Loading decks" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[212px] rounded-xl" />
        ))}
      </div>
    );
  if (data.error) return <p className="text-sm text-[#fca5a5]">Could not load decks: {data.error}</p>;
  if (data.decks.length === 0) return <p className="empty-note">No ready-made decks have been bound yet.</p>;

  // the filters narrow everything below: the tiles of each section, and the packs to mix
  const decks = data.decks.filter((d) => deckMatches(filters, d, deckColors(data.defs, d.entries)));
  const packs = decks.filter(isPack).sort((a, b) => a.name.localeCompare(b.name));
  const known = new Set([...OFFICIAL_SECTIONS.map((s) => s.deckType), PACK_TYPE, "Foundations pack"]);
  const others = [...new Set(data.decks.map((d) => d.deckType ?? "Other"))].filter((t) => !known.has(t));
  const sections = [...OFFICIAL_SECTIONS, ...others.map((t) => ({ deckType: t, title: t, blurb: "" }))]
    .map((s) => ({ ...s, decks: decks.filter((d) => (d.deckType ?? "Other") === s.deckType) }))
    .filter((s) => s.decks.length > 0);
  const typeLabels = new Map([...OFFICIAL_SECTIONS.map((s) => [s.deckType, s.title] as const), [PACK_TYPE, "Jumpstart packs"] as const]);
  const types = [...new Set(data.decks.map((d) => typeOf(d.deckType)))].map((t) => ({ value: t, label: typeLabels.get(t) ?? t }));

  return (
    <>
      <p className="text-sm text-slate-300">
        Every card in these decks works in the game. Pick one when a game asks for your deck, or copy it to your decks to change cards.
      </p>
      <DeckFilterBar value={filters} onChange={setFilters} types={types} sets={setChoices(data.decks)} shown={decks.length} total={data.decks.length} />
      {error && <p className="text-sm text-[#fca5a5]">{error}</p>}
      {decks.length === 0 && (
        <p className="empty-note">
          Nothing on the shelf fits.{" "}
          <button onClick={() => setFilters(NO_FILTERS)} className="underline hover:text-[#e8dcc0]">
            Wipe the filters clean
          </button>
        </p>
      )}
      {sections.map((section) => (
        <section key={section.deckType} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-title text-base font-extrabold uppercase tracking-[0.16em] text-[#e8dcc0]">{section.title}</h2>
            {section.blurb && <span className="text-sm text-slate-300">{section.blurb}</span>}
          </div>
          <ul className="grid gap-3 max-sm:flex max-sm:snap-x max-sm:snap-mandatory max-sm:overflow-x-auto max-sm:pb-2 max-sm:[&>li]:w-[82%] max-sm:[&>li]:shrink-0 max-sm:[&>li]:snap-start sm:grid-cols-2 lg:grid-cols-4">
            {section.decks.map((deck) => (
              <OfficialDeckTile
                key={deck.id}
                deck={deck}
                defs={data.defs}
                busy={busy === deck.id}
                disabled={busy !== null}
                onView={() => setPreview(deck)}
                onCopy={() => copy(deck)}
              />
            ))}
          </ul>
        </section>
      ))}
      {packs.length >= 1 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-title text-base font-extrabold uppercase tracking-[0.16em] text-[#e8dcc0]">Make your own trio</h2>
            <span className="text-sm text-slate-300">Prefer a different combination? Mix any three packs into a 60-card deck, like Jumpstart.</span>
          </div>
          <MixPacks packs={packs} defs={data.defs} />
        </section>
      )}

      {preview && <DeckPreview deck={preview} busy={busy === preview.id} onCopy={() => copy(preview)} onClose={() => setPreview(null)} />}
    </>
  );
}

function OfficialDeckTile({
  deck,
  defs,
  busy,
  disabled,
  onView,
  onCopy,
}: {
  deck: OfficialDeck;
  defs: Record<string, CardDef>;
  busy: boolean;
  disabled: boolean;
  onView: () => void;
  onCopy: () => void;
}) {
  const cover = coverOf(defs, deck.entries);
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-white/20 bg-white/[0.07] shadow-lg shadow-black/30 transition hover:-translate-y-0.5 hover:border-amber-300/50">
      <button
        onClick={onView}
        {...onIntent(() => void loadDeckPreview(deck.id).catch(() => undefined))}
        aria-label={`View the cards of ${deck.name}`}
        className="h-28 bg-slate-900/60 bg-cover opacity-90 transition hover:opacity-100"
        style={cover?.image ? { backgroundImage: `url(${cardImageUrl(cover.image)})`, backgroundPosition: "50% 22%" } : undefined}
      />
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{deck.name}</span>
          <span className="ml-auto">
            <DeckColors colors={deckColors(defs, deck.entries)} />
          </span>
        </div>
        <span className="text-xs text-slate-200">
          {[`${cardTotal(deck.entries)} cards`, setName(deck.code), deck.releaseDate?.slice(0, 4)].filter(Boolean).join(" · ")}
        </span>
        <div className="mt-2 flex gap-2">
          <button onClick={onView} {...onIntent(() => void loadDeckPreview(deck.id).catch(() => undefined))} className="btn-ghost flex-1">
            View cards
          </button>
          <button disabled={disabled} onClick={onCopy} title="Make your own copy to change its cards" className="btn-gold flex-1">
            {busy ? "Copying…" : "Copy & edit"}
          </button>
        </div>
      </div>
    </li>
  );
}
