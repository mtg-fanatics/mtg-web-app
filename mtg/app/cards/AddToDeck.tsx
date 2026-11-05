"use client";

import { useEffect, useState } from "react";
import type { CardDef } from "@mtg/engine";
import { MAX_COPIES, isBasicLand } from "@mtg/engine";
import { getDeck, listMyDecks, saveDeck } from "@/lib/decks";
import type { Deck } from "@/lib/decks";

const KEY = "inkfall.last-deck";
const lastDeck = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/**
 * "Add to deck", under a card shown large in the library: choose one of your decks (the one used last comes first) and one more copy is written into it, with the same
 * save the deck editor uses. Nothing else about the deck is touched.
 */
export default function AddToDeck({ def }: { def: CardDef }) {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    listMyDecks()
      .then((list) => {
        if (!live) return;
        setDecks(list);
        const last = lastDeck();
        setChosen(list.find((d) => d.id === last)?.id ?? list[0]?.id ?? "");
      })
      .catch(() => live && setDecks([]));
    return () => {
      live = false;
    };
  }, []);

  if (def.playable === false) return <p className="add-to-deck-note">The game cannot play this card yet, so it cannot go in a deck.</p>;
  if (decks === null) return <p className="add-to-deck-note">Looking for your decks…</p>;
  if (decks.length === 0) {
    // no deck yet: one press writes the first one, with this card in it
    const start = async () => {
      if (busy) return;
      setBusy(true);
      setNote(null);
      try {
        const id = await saveDeck({ name: "My first deck", entries: { [def.id]: 1 } });
        try {
          localStorage.setItem(KEY, id);
        } catch {
          /* (it just will not be remembered) */
        }
        setDecks(await listMyDecks());
        setChosen(id);
        setNote({ text: `Started "My first deck" with ${def.name}. Add more from here, or open it under Your decks.` });
      } catch (e) {
        setNote({ text: e instanceof Error ? e.message : "Could not start the deck.", bad: true });
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="add-to-deck">
        <p className="add-to-deck-note">You have no deck yet.</p>
        <button type="button" onClick={() => void start()} disabled={busy} className="btn-gold add-to-deck-go">
          {busy ? "Starting…" : "Start a deck with this card"}
        </button>
        {note && (
          <p role="status" className={`add-to-deck-note ${note.bad ? "add-to-deck-bad" : ""}`}>
            {note.text}
          </p>
        )}
      </div>
    );
  }

  async function add() {
    if (!chosen || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const fresh = await getDeck(chosen); // (the deck as it is now: it may have been changed on another screen)
      const had = fresh.entries[def.id] ?? 0;
      const entries = { ...fresh.entries, [def.id]: had + 1 };
      await saveDeck({ id: fresh.id, name: fresh.name, entries });
      try {
        localStorage.setItem(KEY, chosen);
      } catch {
        /* (it just will not be remembered) */
      }
      const over = !isBasicLand(def) && had + 1 > MAX_COPIES;
      setNote({ text: `Added: ×${had + 1} in ${fresh.name}.${over ? ` (More than ${MAX_COPIES} copies: the deck will not be playable until it is trimmed.)` : ""}` });
      setDecks((list) => list && list.map((d) => (d.id === fresh.id ? { ...d, entries } : d)));
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : "Could not add it.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  const inDeck = decks.find((d) => d.id === chosen)?.entries[def.id] ?? 0;
  return (
    <div className="add-to-deck">
      <label className="add-to-deck-pick">
        <span className="sr-only">Deck</span>
        <select value={chosen} onChange={(e) => (setChosen(e.target.value), setNote(null))} aria-label="Add to which deck">
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.entries[def.id] ? ` (×${d.entries[def.id]})` : ""}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => void add()} disabled={busy} className="btn-gold add-to-deck-go">
        {busy ? "Adding…" : inDeck > 0 ? "Add another" : "Add to deck"}
      </button>
      {note && (
        <p role="status" className={`add-to-deck-note ${note.bad ? "add-to-deck-bad" : ""}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
