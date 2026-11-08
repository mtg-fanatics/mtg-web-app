"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cardImageUrl } from "@/lib/cards";
import { ask, askWithPicture, STARTERS } from "@/lib/guide/answer";
import { readPicture } from "@/lib/guide/ocr";
import { ManaText } from "./play/ManaSymbols";
import type { CardSource, GuideCard, Reply } from "@/lib/guide/answer";

interface Turn {
  from: "me" | "scribe";
  text: string;
  card?: GuideCard;
  chips?: string[];
  link?: { label: string; href: string };
  /** A picture the player sent (shown in this visit only). */
  image?: string;
}

/** Mana and tap symbols in the text are drawn as the game's icons ({T} is the tap symbol, {Q} untap). */
const icons = (text: string) => text.replace(/\{T\}/g, "{tap}").replace(/\{Q\}/g, "{untap}");

const COLUMNS = "id, name, type, type_line, mana_cost, oracle_text, rarity, playable, printings, standard_legal, image_path, scryfall_id";
const KEY = "scribe-turns";
const rulingsSeen = new Map<string, string[]>(); // a card's rulings are fetched once per visit

/** The cards of the game's own database (and the official rulings, from Scryfall). */
const source: CardSource = {
  async byWords(words, limit) {
    let q = createClient().from("cards").select(COLUMNS);
    for (const w of words) q = q.ilike("name", `%${w.replace(/[%_\\]/g, "\\$&")}%`);
    const { data, error } = await q.limit(40);
    if (error) throw new Error(error.message);
    return (data as GuideCard[]).sort((a, b) => a.name.length - b.name.length).slice(0, limit);
  },
  async search(f, limit) {
    let q = createClient().from("cards").select(COLUMNS, { count: "exact" });
    if (f.types.length === 1) q = q.eq("type", f.types[0]);
    else if (f.types.length > 1) q = q.in("type", f.types);
    if (f.colors.length) q = q.overlaps("colors", f.colors);
    else if (f.colorless) q = q.filter("colors", "eq", "{}");
    for (const k of f.keywords) q = q.contains("keywords", [k]);
    for (const t of f.text) q = q.ilike("oracle_text", t);
    if (f.maxCost !== undefined) q = q.lte("cost", f.maxCost);
    if (f.minCost !== undefined) q = q.gte("cost", f.minCost);
    if (f.rarity) q = q.eq("rarity", f.rarity);
    if (f.set) q = q.contains("printings", [f.set]);
    if (f.standard) q = q.eq("standard_legal", true);
    if (f.legendary) q = q.ilike("type_line", "%Legendary%");
    if (f.playable) q = q.eq("playable", true);
    const { data, count, error } = await q.order("name").limit(limit);
    if (error) throw new Error(error.message);
    return { cards: data as GuideCard[], total: count ?? (data as GuideCard[]).length };
  },
  async rulings(card) {
    if (!card.scryfall_id) return [];
    const seen = rulingsSeen.get(card.scryfall_id);
    if (seen) return seen;
    try {
      const res = await fetch(`https://api.scryfall.com/cards/${card.scryfall_id}/rulings`);
      if (!res.ok) return [];
      const { data } = (await res.json()) as { data: { comment: string }[] };
      const out = data.map((r) => r.comment);
      rulingsSeen.set(card.scryfall_id, out);
      return out;
    } catch {
      return [];
    }
  },
};

const HELLO: Turn = { from: "scribe", text: "I'm the Scribe. Ask me what a card does, what a rule word means, or whether a card or set is Standard legal.", chips: STARTERS };

/**
 * A floating helper, on every page except the duel itself: ask it about a card, a set or a rule. It answers from the game's own cards, sets and
 * rules glossary (lib/guide), so it costs nothing and does not guess.
 */
export default function Scribe() {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([HELLO]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Looking it up…");
  const [picture, setPicture] = useState<{ file: File; url: string } | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // the conversation survives moving between pages (this tab only)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) setTurns(JSON.parse(saved) as Turn[]);
    } catch {
      // no storage: it starts fresh
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-40).map(({ image, ...rest }) => (void image, rest)))); // (a picture is not kept)
    } catch {
      // (private window)
    }
  }, [turns]);

  useEffect(() => {
    if (!open) return;
    void createClient().auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
    const t = setTimeout(() => input.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns, busy, open]);

  // never over a duel (the chat there is for the two players), and not on the sign-in page
  if (path.startsWith("/play") || path.startsWith("/login")) return null;

  function attach(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setTurns((t) => [...t, { from: "scribe", text: "I can only look at pictures (PNG, JPG, WebP)." }]);
      return;
    }
    if (picture) URL.revokeObjectURL(picture.url);
    setPicture({ file, url: URL.createObjectURL(file) });
    input.current?.focus();
  }

  async function send(question: string) {
    const q = question.trim();
    if ((!q && !picture) || busy) return;
    const sent = picture;
    setText("");
    setPicture(null);
    setTurns((t) => [...t, { from: "me", text: q, ...(sent ? { image: sent.url } : {}) }]);
    setBusy(true);
    setStatus(sent ? "Reading the picture…" : "Looking it up…");
    let reply: Reply;
    try {
      if (sent) {
        let words: string;
        try {
          words = await readPicture(sent.file);
        } catch {
          words = "";
          setTurns((t) => [...t, { from: "scribe", text: "I couldn't read that picture just now (the reader needs a connection the first time). Try again in a moment." }]);
          setBusy(false);
          return;
        }
        setStatus("Looking it up…");
        reply = await askWithPicture(q, words, source);
      } else {
        reply = await ask(q, source);
      }
    } catch {
      reply = { text: "I couldn't reach the card list just now. Try again in a moment." };
    }
    setTurns((t) => [...t, { from: "scribe", ...reply }]);
    setBusy(false);
  }

  const last = turns[turns.length - 1];

  return (
    <>
      {open && (
        <section role="dialog" aria-label="The Scribe" className="scribe-panel">
          <header className="scribe-head">
            <span className="font-title text-lg text-[#e8dcc0]">The Scribe</span>
            <button type="button" aria-label="Clear the conversation" title="Start over" className="scribe-x" onClick={() => setTurns([HELLO])}>
              ↺
            </button>
            <button type="button" aria-label="Close the Scribe" className="scribe-x" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <div ref={log} className="scribe-log" aria-live="polite">
            {signedIn === false && <p className="scribe-note">Sign in to ask about cards: the card list is for players only.</p>}
            {turns.map((t, i) => (
              <div key={i} className={t.from === "me" ? "scribe-me" : "scribe-bot"}>
                {t.card?.image_path && t.from === "scribe" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cardImageUrl(t.card.image_path)} alt={t.card.name} className="scribe-card" />
                )}
                {t.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.image} alt="The picture you sent" className="scribe-sent" />
                )}
                {t.text && (
                  <p className="whitespace-pre-line">
                    <ManaText text={icons(t.text)} />
                  </p>
                )}
                {t.link && (
                  <button type="button" className="scribe-chip mt-2" onClick={() => router.push(t.link!.href)}>
                    {t.link.label} →
                  </button>
                )}
              </div>
            ))}
            {busy && <p className="scribe-bot scribe-busy">{status}</p>}
          </div>
          {last?.chips && !busy && (
            <div className="scribe-chips">
              {last.chips.map((c) => (
                <button key={c} type="button" className="scribe-chip" onClick={() => void send(c)}>
                  {c}
                </button>
              ))}
            </div>
          )}
          <form
            className="scribe-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <label className="scribe-attach" title="Send a picture of a card or an effect" aria-label="Send a picture">
              <input type="file" accept="image/*" hidden onChange={(e) => (attach(e.target.files?.[0]), (e.target.value = ""))} />
              📎
            </label>
            {picture && (
              <span className="scribe-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={picture.url} alt="The picture to send" />
                <button type="button" aria-label="Remove the picture" onClick={() => (URL.revokeObjectURL(picture.url), setPicture(null))}>
                  ×
                </button>
              </span>
            )}
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
                if (file) (e.preventDefault(), attach(file));
              }}
              placeholder={picture ? "Add a question (or just send)" : "Ask about a card, set or rule"}
              aria-label="Your question"
              maxLength={200}
            />
            <button type="submit" disabled={busy || (!text.trim() && !picture)}>
              Ask
            </button>
          </form>
        </section>
      )}
      <button type="button" className="scribe-fab" aria-label={open ? "Close the Scribe" : "Ask the Scribe"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "×" : "?"}
      </button>
    </>
  );
}
