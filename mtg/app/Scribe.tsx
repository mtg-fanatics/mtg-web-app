"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cardImageUrl } from "@/lib/cards";
import { ask, askWithPicture, STARTERS } from "@/lib/guide/answer";
import { readPicture } from "@/lib/guide/ocr";
import { ManaText } from "./play/ManaSymbols";
import ScribeMark from "./ScribeMark";
import { Lightbox } from "./play/CardDetail";
import { useHoverZoom } from "./play/HoverZoom";
import type { CardDef } from "@mtg/engine";
import type { CardSource, GuideCard, Intent, Reply } from "@/lib/guide/answer";

interface Turn {
  from: "me" | "scribe";
  text: string;
  card?: GuideCard;
  chips?: string[];
  link?: { label: string; href: string };
  /** Cards shown as pictures, the set this answer was about, and the cards it listed (what a follow-up can point back at). */
  images?: GuideCard[];
  set?: string;
  listed?: GuideCard[];
  /** What was asked about a card, and the list that was shown (so a follow-up can carry on from them). */
  intent?: Intent;
  list?: Reply["list"];
  /** A picture the player sent (shown in this visit only). */
  image?: string;
}

/** One saved conversation. */
interface Conversation {
  id: string;
  title: string;
  updated: number;
  turns: Turn[];
}

/** Mana and tap symbols in the text are drawn as the game's icons ({T} is the tap symbol, {Q} untap). */
const icons = (text: string) => text.replace(/\{T\}/g, "{tap}").replace(/\{Q\}/g, "{untap}");

const COLUMNS = "id, name, type, type_line, mana_cost, oracle_text, rarity, playable, printings, standard_legal, image_path, scryfall_id";
const rulingsSeen = new Map<string, string[]>(); // a card's rulings are fetched once per visit

/** The cards of the game's own database (and the official rulings, from Scryfall). */
const source: CardSource = {
  async byWords(words, limit, startsWith = false) {
    let q = createClient().from("cards").select(COLUMNS);
    words.forEach((w, i) => (q = q.ilike("name", `${startsWith && i === 0 ? "" : "%"}${w.replace(/[%_\\]/g, "\\$&")}%`)));
    const { data, error } = await q.limit(startsWith ? 250 : 40); // (a name's beginning matches a lot of cards: the closest spelling is picked from all of them)
    if (error) throw new Error(error.message);
    return (data as GuideCard[]).sort((a, b) => a.name.length - b.name.length).slice(0, limit);
  },
  async search(f, limit, offset = 0) {
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
    for (const k of f.subtypes ?? []) q = q.ilike("type_line", `%${k}%`);
    if (f.playable) q = q.eq("playable", true);
    const ordered = f.order === "cost_desc" ? q.order("cost", { ascending: false }).order("name") : f.order === "cost_asc" ? q.order("cost", { ascending: true }).order("name") : f.order === "power_desc" ? q.order("power", { ascending: false, nullsFirst: false }).order("name") : q.order("name");
    const { data, count, error } = await ordered.range(offset, offset + limit - 1);
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

const HELLO: Turn = { from: "scribe", text: "I'm the Scribe. Ask me what a card does, what a rule word means, or whether a card or set is Standard legal. You can also send me a picture of a card.", chips: STARTERS };
/** The game's own card description for the hover zoom and the large view. */
const toDef = (c: GuideCard): CardDef => ({
  id: c.id,
  name: c.name,
  type: c.type as CardDef["type"],
  cost: 0,
  ...(c.mana_cost ? { manaCost: c.mana_cost } : {}),
  ...(c.type_line ? { typeLine: c.type_line } : {}),
  ...(c.oracle_text ? { text: c.oracle_text } : {}),
  ...(c.image_path ? { image: c.image_path } : {}),
  ...(c.scryfall_id ? { scryfallId: c.scryfall_id } : {}),
  ...(c.rarity ? { rarity: c.rarity } : {}),
});

/** A card's picture from Scryfall, "normal" (488 pixels wide) or "large" (672). */
const sharp = (c: GuideCard, size: "normal" | "large") => (c.scryfall_id ? `https://cards.scryfall.io/${size}/front/${c.scryfall_id[0]}/${c.scryfall_id[1]}/${c.scryfall_id}.jpg` : c.image_path ? cardImageUrl(c.image_path) : "");
const MAX_CONVERSATIONS = 50;
const MAX_TURNS = 80;
const POS_KEY = "scribe-pos";

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((Math.random() * 16) | 0).toString(16)));
const newConversation = (): Conversation => ({ id: uuid(), title: "New conversation", updated: Date.now(), turns: [HELLO] });
const storeKey = (uid: string) => `scribe:v2:${uid}`;
const asked = (c: Conversation) => c.turns.filter((t) => t.from === "me").length;
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * A floating helper, on every page except the duel itself: ask it about a card, a set or a rule, or send it a picture of a card. It answers from
 * the game's own cards, sets and rules glossary (lib/guide), so it costs nothing and does not guess. It can be dragged anywhere on the screen,
 * and every conversation is kept under the player's own account (nobody else can read it) so an earlier one can be opened again.
 */
export default function Scribe() {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [uid, setUid] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Looking it up…");
  const [picture, setPicture] = useState<{ file: File; url: string } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // where the seal is (null: its usual corner)
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const fab = vp.w <= 767 ? 48 : 56; // the seal's size in pixels (smaller on a phone)
  const zoom = useHoverZoom(); // the big card while the mouse is over a card in the talk
  const [look, setLook] = useState<{ cards: GuideCard[]; at: number } | null>(null); // a card (or a group of them) opened large
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dbOk = useRef(true); // false when the database has no table for the history yet (then this device keeps a copy)
  const savedAt = useRef(new Map<string, number>()); // each conversation's last change that is already in the database
  const live = useRef<{ x: number; y: number } | null>(null); // where the seal is right now while it is being dragged
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean; fab: boolean } | null>(null);

  const current = convs.find((c) => c.id === currentId) ?? null;
  const turns = current?.turns ?? [HELLO];

  const clampPos = (x: number, y: number, w = vp.w, h = vp.h) => ({ x: Math.min(Math.max(8, x), Math.max(8, w - fab - 8)), y: Math.min(Math.max(8, y), Math.max(8, h - fab - 8)) });

  // Who is asking: the history belongs to that player alone. It is kept in the database under their account (see supabase/08-scribe-history.sql:
  // only its owner can read it), and when they sign out, or another player signs in, everything of theirs leaves the screen.
  const uidRef = useRef<string | null>(null);
  useEffect(() => {
    uidRef.current = uid;
  }, [uid]);
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id ?? null;
      if (uidRef.current === null || (id !== null && id === uidRef.current)) return;
      try {
        for (const key of Object.keys(localStorage)) if (key.startsWith("scribe:v2:")) localStorage.removeItem(key); // (the copy kept when the database could not be reached)
      } catch {
        // (no storage)
      }
      uidRef.current = null;
      savedAt.current.clear();
      setOpen(false);
      setView("chat");
      setConvs([]);
      setCurrentId(null);
      setLoaded(false);
      setUid(null);
      setSignedIn(null);
      setText("");
      setPicture(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // who is asking, once the helper is first opened
  useEffect(() => {
    if (!open || uid) return;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        setSignedIn(Boolean(data.user));
        setUid(data.user?.id ?? "guest");
      });
  }, [open, uid]);

  // that player's conversations: the newest one carries on (or a fresh one if it is empty). A player who is not signed in keeps nothing.
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void (async () => {
      let list: Conversation[] = [];
      if (uid !== "guest") {
        const { data, error } = await createClient().from("scribe_chats").select("id, title, turns, updated_at").order("updated_at", { ascending: false }).limit(MAX_CONVERSATIONS);
        if (error) {
          dbOk.current = false; // the table is not there yet: this device keeps a copy instead
          try {
            list = (JSON.parse(localStorage.getItem(storeKey(uid)) ?? "null") as { list: Conversation[] } | null)?.list ?? [];
          } catch {
            list = [];
          }
        } else {
          dbOk.current = true;
          list = (data as { id: string; title: string; turns: Turn[]; updated_at: string }[]).map((r) => ({ id: r.id, title: r.title, updated: Date.parse(r.updated_at), turns: r.turns }));
          for (const c of list) savedAt.current.set(c.id, c.updated);
        }
      }
      if (!alive) return;
      const newest = list[0];
      const open = newest ?? newConversation();
      setConvs(newest ? list : [open]);
      setCurrentId(open.id);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  // every change is saved shortly after (a picture is not: it only lives in this visit)
  useEffect(() => {
    if (!uid || uid === "guest" || !loaded) return;
    const timer = setTimeout(() => {
      const keep = (c: Conversation) => c.turns.slice(-MAX_TURNS).map(({ image, ...rest }) => (void image, rest));
      if (dbOk.current) {
        for (const c of convs) {
          if (asked(c) === 0 || savedAt.current.get(c.id) === c.updated) continue;
          savedAt.current.set(c.id, c.updated);
          void createClient()
            .from("scribe_chats")
            .upsert({ id: c.id, title: c.title.slice(0, 120), turns: keep(c), updated_at: new Date(c.updated).toISOString() })
            .then(({ error }) => {
              if (!error) return;
              savedAt.current.delete(c.id);
              dbOk.current = false;
              setConvs((list) => [...list]); // (saved on this device instead, below)
            });
        }
      } else {
        try {
          const list = convs.filter((c) => asked(c) > 0).slice(0, MAX_CONVERSATIONS).map((c) => ({ ...c, turns: keep(c) }));
          localStorage.setItem(storeKey(uid), JSON.stringify({ list }));
        } catch {
          // (private window, or the storage is full)
        }
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [convs, uid, loaded]);

  // the seal's place, remembered; and kept on the screen when the window changes
  useEffect(() => {
    const size = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setVp({ w, h });
      setPos((p) => (p ? clampPos(p.x, p.y, w, h) : p));
    };
    size();
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? "null") as { x: number; y: number } | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) setPos(clampPos(saved.x, saved.y, window.innerWidth, window.innerHeight));
    } catch {
      // not saved
    }
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => view === "chat" && input.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !look && setOpen(false); // (with a card open large, Escape closes just that)
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, view, look]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns, busy, open, view]);

  // never over a duel (the chat there is for the two players), and not on the sign-in page
  if (path.startsWith("/play") || path.startsWith("/login")) return null;

  // ── moving it: drag the seal, or the title bar of the open panel ──
  const here = pos ?? clampPos(vp.w - fab - 16, vp.h - fab - 16);
  function dragStart(e: ReactPointerEvent<HTMLElement>, fab: boolean) {
    if (e.button !== 0) return;
    if (!fab && (e.target as HTMLElement).closest("button, a, input, label")) return; // (a press on a button in the title bar is that button's)
    drag.current = { sx: e.clientX, sy: e.clientY, ox: here.x, oy: here.y, moved: false, fab };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function dragMove(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    d.moved = true;
    live.current = clampPos(d.ox + dx, d.oy + dy);
    setPos(live.current);
  }
  function dragEnd(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(live.current ?? here));
      } catch {
        // (not saved)
      }
    } else if (d.fab) setOpen((o) => !o);
  }

  // the panel opens beside the seal, on the side with room
  const narrow = vp.w <= 640;
  const panelW = narrow ? vp.w - 16 : Math.min(384, vp.w - 32);
  const panelH = Math.min(544, vp.h - 96);
  const cx = here.x + fab / 2;
  const cy = here.y + fab / 2;
  const panelLeft = narrow ? 8 : Math.min(Math.max(8, cx > vp.w / 2 ? here.x + fab - panelW : here.x), vp.w - panelW - 8);
  const panelTop = Math.min(Math.max(8, cy > vp.h / 2 ? here.y - 8 - panelH : here.y + fab + 8), vp.h - panelH - 8);

  // ── the conversations ──
  const patch = (id: string, change: (c: Conversation) => Conversation) => setConvs((list) => list.map((c) => (c.id === id ? change(c) : c)));
  function startNew() {
    const empty = convs.find((c) => asked(c) === 0);
    const fresh = empty ?? newConversation();
    if (!empty) {
      // only the newest 50 are kept: the oldest goes (from the database too) to make room
      const oldest = [...convs].sort((a, b) => b.updated - a.updated).slice(MAX_CONVERSATIONS - 1).map((c) => c.id);
      forgetInDatabase(oldest);
      setConvs((list) => [fresh, ...list.filter((c) => !oldest.includes(c.id))]);
    }
    setCurrentId(fresh.id);
    setView("chat");
  }
  function openConversation(id: string) {
    setCurrentId(id);
    setView("chat");
  }
  function forgetInDatabase(ids: string[]) {
    for (const id of ids) savedAt.current.delete(id);
    if (uid && uid !== "guest" && dbOk.current && ids.length > 0) createClient().from("scribe_chats").delete().in("id", ids).then(() => undefined); // (a database request only goes out once something reads its answer)
  }
  function remove(id: string) {
    forgetInDatabase([id]);
    const rest = convs.filter((c) => c.id !== id);
    if (id === currentId) {
      const next = rest.find((c) => asked(c) === 0) ?? newConversation();
      setConvs(rest.includes(next) ? rest : [next, ...rest]);
      setCurrentId(next.id);
    } else setConvs(rest);
  }
  function clearAll() {
    forgetInDatabase(convs.map((c) => c.id));
    const fresh = newConversation();
    setConvs([fresh]);
    setCurrentId(fresh.id);
    setView("chat");
  }

  function attach(file: File | undefined | null) {
    if (!file || !currentId) return;
    if (!file.type.startsWith("image/")) {
      patch(currentId, (c) => ({ ...c, turns: [...c.turns, { from: "scribe", text: "I can only look at pictures (PNG, JPG, WebP)." }] }));
      return;
    }
    if (picture) URL.revokeObjectURL(picture.url);
    setPicture({ file, url: URL.createObjectURL(file) });
    input.current?.focus();
  }

  async function send(question: string) {
    const q = question.trim();
    if ((!q && !picture) || busy || !currentId) return;
    const id = currentId;
    const sent = picture;
    // what the talk has been about so far: the card the Scribe last answered with
    // what the talk was last about: the newest card or set it answered with (a card shown as a picture counts), and the newest list
    let lastCard: GuideCard | undefined;
    let lastSet: string | undefined;
    for (const t of [...turns].reverse()) {
      if (t.from !== "scribe") continue;
      const subject = t.card ?? (t.images?.length === 1 ? t.images[0] : undefined);
      if (subject) {
        lastCard = subject;
        break;
      }
      if (t.set) {
        lastSet = t.set;
        break;
      }
    }
    const newest = <K extends "listed" | "list" | "intent">(key: K) => [...turns].reverse().find((t) => t.from === "scribe" && t[key] !== undefined)?.[key];
    const context = { card: lastCard, set: lastSet, listed: newest("listed"), list: newest("list"), intent: newest("intent"), chips: [...turns].reverse().find((t) => t.from === "scribe")?.chips, previous: turns.filter((t) => t.from === "scribe").map((t) => t.text), asked: turns.filter((t) => t.from === "me").map((t) => t.text) };
    setText("");
    setPicture(null);
    patch(id, (c) => ({ ...c, updated: Date.now(), title: asked(c) === 0 ? (q || "A picture").slice(0, 48) : c.title, turns: [...c.turns, { from: "me", text: q, ...(sent ? { image: sent.url } : {}) }] }));
    setBusy(true);
    setStatus(sent ? "Reading the picture…" : "Looking it up…");
    let reply: Reply;
    try {
      if (sent) {
        let words = "";
        try {
          words = await readPicture(sent.file);
        } catch {
          patch(id, (c) => ({ ...c, turns: [...c.turns, { from: "scribe", text: "I couldn't read that picture just now (the reader needs a connection the first time). Try again in a moment." }] }));
          setBusy(false);
          return;
        }
        setStatus("Looking it up…");
        reply = await askWithPicture(q, words, source, context);
      } else {
        reply = await ask(q, source, context);
      }
    } catch {
      reply = { text: "I couldn't reach the card list just now. Try again in a moment." };
    }
    patch(id, (c) => ({ ...c, updated: Date.now(), turns: [...c.turns, { from: "scribe", ...reply }] }));
    setBusy(false);
  }

  const last = turns[turns.length - 1];
  const sorted = [...convs].filter((c) => asked(c) > 0).sort((a, b) => b.updated - a.updated);
  const panelStyle = { left: panelLeft, top: panelTop, right: "auto", bottom: "auto", width: panelW, height: panelH } as const;

  return (
    <>
      {open && (
        <section role="dialog" aria-label="The Scribe" className="scribe-panel" style={panelStyle}>
          <header className="scribe-head" onPointerDown={(e) => dragStart(e, false)} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} title="Drag to move">
            <ScribeMark size={26} />
            <span className="font-title text-lg text-[#e8dcc0]">{view === "history" ? "Past conversations" : "The Scribe"}</span>
            <button type="button" aria-label={view === "history" ? "Back to the conversation" : "Past conversations"} title={view === "history" ? "Back" : "History"} className="scribe-x" onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}>
              {view === "history" ? (
                "←"
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              )}
            </button>
            <button type="button" aria-label="New conversation" title="New conversation" className="scribe-x" onClick={startNew}>
              +
            </button>
            <button type="button" aria-label="Close the Scribe" className="scribe-x" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>

          {view === "history" ? (
            <div className="scribe-log" aria-label="Past conversations">
              {!loaded ? (
                <p className="scribe-note">Loading your conversations…</p>
              ) : sorted.length === 0 ? (
                <p className="scribe-note">Nothing here yet. Your conversations are kept under your account (only you can read them), so you can open them again later.</p>
              ) : (
                <ul className="scribe-hist">
                  {sorted.map((c) => (
                    <li key={c.id} data-current={c.id === currentId}>
                      <button type="button" className="scribe-hist-open" onClick={() => openConversation(c.id)}>
                        <b>{c.title}</b>
                        <span>
                          {when(c.updated)} · {asked(c)} {asked(c) === 1 ? "question" : "questions"}
                        </span>
                      </button>
                      <button type="button" className="scribe-x" aria-label={`Delete “${c.title}”`} title="Delete" onClick={() => remove(c.id)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {sorted.length > 0 && (
                <button type="button" className="scribe-chip self-start" onClick={clearAll}>
                  Delete all conversations
                </button>
              )}
            </div>
          ) : (
            <>
              <div ref={log} className="scribe-log" aria-live="polite">
                {signedIn === false && <p className="scribe-note">Sign in to ask about cards: the card list is for players only.</p>}
                {turns.map((t, i) => (
                  <div key={i} className={t.from === "me" ? "scribe-me" : "scribe-bot"}>
                    {t.card?.image_path && t.from === "scribe" && (
                      <button type="button" className="scribe-card" title={`${t.card.name}: open large`} {...zoom.on(toDef(t.card))} onClick={() => (zoom.hide(), setLook({ cards: [t.card!], at: 0 }))}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cardImageUrl(t.card.image_path)} alt={t.card.name} />
                      </button>
                    )}
                    {t.images && t.images.length > 0 && (
                      <div className="scribe-pics" data-many={t.images.length > 1}>
                        {t.images.map((c, at) => (
                          <button key={c.id} type="button" title={`${c.name}: open large`} {...zoom.on(toDef(c))} onClick={() => (zoom.hide(), setLook({ cards: t.images!, at }))}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={sharp(c, "normal")} alt={c.name} loading="lazy" onError={(e) => c.image_path && (e.currentTarget.src = cardImageUrl(c.image_path))} />
                          </button>
                        ))}
                      </div>
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
            </>
          )}
        </section>
      )}
      {look && (
        <Lightbox
          def={toDef(look.cards[look.at])}
          onClose={() => setLook(null)}
          {...(look.cards.length > 1 ? { onPrev: () => setLook({ ...look, at: (look.at + look.cards.length - 1) % look.cards.length }), onNext: () => setLook({ ...look, at: (look.at + 1) % look.cards.length }) } : {})}
          caption={look.cards.length > 1 ? `Card ${look.at + 1} of ${look.cards.length}` : undefined}
        />
      )}
      {!look && zoom.node}
      <button
        type="button"
        className="scribe-fab"
        aria-label={open ? "Close the Scribe" : "Ask the Scribe (drag to move)"}
        aria-expanded={open}
        style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
        onPointerDown={(e) => dragStart(e, true)}
        onPointerMove={dragMove}
        onPointerUp={dragEnd}
        onPointerCancel={dragEnd}
        onClick={(e) => e.detail === 0 && setOpen((o) => !o)} // (the keyboard: a mouse or a finger is handled when the pointer lifts)
      >
        <ScribeMark size={fab} />
      </button>
    </>
  );
}
