"use client";

import { memo, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { OPPONENT } from "@mtg/engine";
import type { CardDef, GameState, PlayerId } from "@mtg/engine";
import { playerName } from "./log";
import { cardDetailImageUrl, cardImageUrl } from "@/lib/cards";
import { useAnimationsOn } from "@/lib/motion";
import { itemName, readable, targetName } from "./cardText";
import { helpFor } from "./glossary";
import { ManaText } from "./ManaSymbols";
import { stackCard } from "./ResolveZone";
import { liteMode } from "./perfTier";
import { preloadImage } from "@/lib/prefetch";
import type { Announcement } from "./log";

/**
 * The chain: every spell and ability on the stack is a big card with its chain number, linked to the one under it by a chain. A new
 * one slams in with a burst of light (and "CHAIN" sweeps across once there are two); as the stack resolves, the top card flashes and
 * is gone, then the next one. Every card stays long enough to be read, however fast the game moves on. Only transform and opacity
 * are animated, and nothing here takes a click.
 */
interface Link {
  id: string;
  n: number; // chain link number: the bottom of the stack is 1
  def?: CardDef;
  name: string;
  text: string;
  /** What the special words in the text mean, in plain English (Flash, Ward, Landfall...). */
  help: string[];
  /** How and when this kind of card can be played, in one sentence. */
  kind?: string;
  target: string;
  mine: boolean;
  gone: boolean; // no longer on the stack (it stays on screen until it has been seen)
  leaving: boolean; // playing its exit
  fresh: number; // order of arrival in the same update (they land one after the other)
  hold?: number; // how long it stays on screen at least (triggers: they were never on the stack long enough to be seen)
}

const MIN_SHOW_MS = 4800; // a card (and what it says) is on screen at least this long after it arrives
const EXIT_GAP_MS = 2000; // cards that leave together leave one after the other, newest first, slowly
const LEAVE_MS = 2000; // (the fade-out below takes this long)
const STAGGER_MS = 260;
const MAX_SHOWN = 12; // (everything on the chain is shown: the cards get smaller the more there are; a card is never left out and then brought back)
const MAX_PHONE = 8; // a phone lists them one under the other, each with its text beside it
const TILT = [-7, 4, -3, 6, -5, 3, -4, 5];

const subscribe = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

/** Abilities that triggered and resolved inside one update (the stack was empty again before the screen could show them). */
export interface Flash {
  key: number;
  items: Announcement[];
}

const FLASH_SHOW_MS = 3600;

/** One plain sentence about the kind of thing this is, for someone who does not know the rules yet. */
function kindLine(state: GameState, item: GameState["stack"][number]): string | undefined {
  if (item.kind === "ability") return item.trigger ? "A triggered ability: it happens by itself when its condition is met, and goes on the stack above whatever is there." : "An ability: it is used by paying its cost, and it can be answered before it resolves.";
  const def = state.cards[item.card.defId];
  const kicked = item.kicked ? " (kicked: it does more)" : "";
  if (def?.type === "instant") return `An instant${kicked}: it can be cast any time you have priority. The newest card on the chain happens first.`;
  if (def?.type === "sorcery") return `A sorcery${kicked}: normally only in your own main phase, with nothing else on the stack.`;
  if (def?.type === "creature") return "A creature spell: when it resolves it enters the battlefield. It can be countered while it is on the chain.";
  return undefined;
}

const LINK_PITCH = 21; // distance between the centres of two links (they overlap: each hangs through the hole of the next)
const LINK_LEN = 29;
const LINK_WID = 19;

/**
 * A real chain between two hooks: it sags under its own weight (the lowest point is straight under the middle, whichever way the chain
 * runs), its links follow the curve one after the other, alternating between a ring seen face-on (with its hole) and one seen edge-on
 * (a thin bar; it is turned a quarter, so it passes through the hole of its neighbours), all of brushed steel with a dark rim and a shine.
 * Drawn in the frame of the strand: it starts at (0, 0) and ends at (len, 0), turned `angle` degrees on screen.
 */
const ChainStrand = memo(function ChainStrand({ len, angle, seed }: { len: number; angle: number; seed: number }) {
  const uid = useId().replace(/:/g, "");
  const rad = (angle * Math.PI) / 180;
  const gx = Math.sin(rad); // where "down on the screen" points in the strand's own frame
  const gy = Math.cos(rad);
  const sag = Math.max(8, Math.min(len * 0.15, 64));
  const pts: { x: number; y: number; s: number }[] = [];
  const SAMPLES = 40;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const d = 4 * t * (1 - t) * sag; // a parabola: close enough to the hanging curve
    const x = t * len + d * gx;
    const y = d * gy;
    const s = i === 0 ? 0 : pts[i - 1].s + Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
    pts.push({ x, y, s });
  }
  const arc = pts[SAMPLES].s;
  const n = Math.max(2, Math.round(arc / LINK_PITCH) + 1);
  const links: { x: number; y: number; a: number; face: boolean; k: number }[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (arc * k) / (n - 1);
    while (j < SAMPLES - 1 && pts[j + 1].s < target) j++;
    const p0 = pts[j];
    const p1 = pts[j + 1];
    const f = p1.s > p0.s ? Math.min(1, Math.max(0, (target - p0.s) / (p1.s - p0.s))) : 0;
    const hash = Math.sin((k + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    const rnd = hash - Math.floor(hash);
    links.push({
      x: p0.x + (p1.x - p0.x) * f,
      y: p0.y + (p1.y - p0.y) * f,
      a: (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI + (rnd - 0.5) * 7, // (no two links hang exactly alike)
      face: k % 2 === 0,
      k,
    });
  }
  const R = LINK_WID / 2 - 1.9; // (the rim is drawn on the outside of the ring)
  return (
    <svg className="chain-strand" width="1" height="1" overflow="visible" aria-hidden="true">
      <defs>
        <linearGradient id={`m${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8fafc" />
          <stop offset="0.3" stopColor="#cbd5e1" />
          <stop offset="0.55" stopColor="#64748b" />
          <stop offset="0.8" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#334155" />
        </linearGradient>
      </defs>
      {/* the rings seen face-on first, then the ones seen edge-on over them (they go through the holes) */}
      {links.filter((l) => l.face).map((l) => (
        <g key={l.k} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.a.toFixed(1)}) scale(1 ${(0.86 + 0.14 * Math.abs(Math.cos(l.k * 1.7 + seed))).toFixed(2)})`}>
          <rect x={-LINK_LEN / 2 + 2} y={-R} width={LINK_LEN - 4} height={2 * R} rx={R} fill="none" stroke="#070d18" strokeWidth="6.4" />
          <rect x={-LINK_LEN / 2 + 2} y={-R} width={LINK_LEN - 4} height={2 * R} rx={R} fill="none" stroke={`url(#m${uid})`} strokeWidth="4" />
          <path d={`M${-LINK_LEN / 2 + 7} ${-R + 0.2} H${LINK_LEN / 2 - 7}`} stroke="#fff" strokeOpacity="0.8" strokeWidth="1" strokeLinecap="round" />
          <rect className="chain-spark" style={{ "--i": l.k } as React.CSSProperties} x={-LINK_LEN / 2 + 2} y={-R} width={LINK_LEN - 4} height={2 * R} rx={R} fill="none" stroke="#e0fbff" strokeWidth="4" />
        </g>
      ))}
      {links.filter((l) => !l.face).map((l) => (
        <g key={l.k} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.a.toFixed(1)})`}>
          <rect x={-LINK_LEN / 2 + 1} y={-3.4} width={LINK_LEN - 2} height="6.8" rx="3.4" fill={`url(#m${uid})`} stroke="#070d18" strokeWidth="1.3" />
          <path d={`M${-LINK_LEN / 2 + 5} -1.6 H${LINK_LEN / 2 - 5}`} stroke="#fff" strokeOpacity="0.75" strokeWidth="1" strokeLinecap="round" />
          <rect className="chain-spark" style={{ "--i": l.k } as React.CSSProperties} x={-LINK_LEN / 2 + 1} y={-3.4} width={LINK_LEN - 2} height="6.8" rx="3.4" fill="#e0fbff" />
        </g>
      ))}
    </svg>
  );
});

export default function ChainFx({ state, actor, extra, onPass }: { state: GameState; actor: PlayerId; extra?: Flash | null; /** Pass priority (or let it resolve, or continue): given to a player, not to someone watching. */ onPass?: () => void }) {
  const on = useAnimationsOn();
  const sizeKey = useSyncExternalStore(subscribe, () => `${window.innerWidth}x${window.innerHeight}`, () => "1200x800");
  const [links, setLinks] = useState<Link[]>([]);
  const [seenIds, setSeenIds] = useState("");
  const [banner, setBanner] = useState<number | null>(null);
  const [seenFlash, setSeenFlash] = useState(0);
  const [hiddenAt, setHiddenAt] = useState<string | null>(null); // "Show board": the chain is put away until a new card joins it
  const born = useRef(new Map<string, number>()); // when each card arrived
  const planned = useRef(new Set<string>()); // cards whose exit is already scheduled
  const dismissed = useRef(new Set<string>()); // cards this player clicked away: they do not come back while they are on the stack

  // What is on the stack changed: new cards arrive; cards that are not on it any more are marked (their exit comes later).
  const ids = state.stack.map((i) => i.id).join(",");
  if (ids !== seenIds) {
    setSeenIds(ids);
    const live = new Map(state.stack.map((item, i) => [item.id, { item, n: i + 1 }]));
    const next: Link[] = links.map((l) => (l.gone || live.has(l.id) ? l : { ...l, gone: true }));
    let fresh = 0;
    for (const [id, { item, n }] of live) {
      if (links.some((l) => l.id === id) || dismissed.current.has(id)) continue;
      next.push({
        id,
        n,
        def: stackCard(state, item),
        name: itemName(state, item),
        text: item.kind === "ability" ? readable(item.text, item.sourceName) : readable(state.cards[item.card.defId]?.text ?? "", state.cards[item.card.defId]?.name ?? ""),
        help: helpFor(item.kind === "ability" ? item.text : (state.cards[item.card.defId]?.text ?? ""), 2),
        kind: kindLine(state, item),
        target: item.targets.length > 0 ? item.targets.map((t) => targetName(state, t)).join(", ") : "",
        mine: item.controller === actor,
        gone: false,
        leaving: false,
        fresh: fresh++,
      });
    }
    next.sort((a, b) => a.n - b.n);
    setLinks(next);
    if (fresh > 0 && live.size >= 2) setBanner((b) => (b ?? 0) + 1);
  }

  // Triggers that came and went within one update: shown as links of their own, newest on top, as they were resolved.
  if (extra && extra.key !== seenFlash) {
    setSeenFlash(extra.key);
    const items = extra.items;
    setLinks((ls) => {
      const top = Math.max(0, ...ls.filter((l) => !l.gone).map((l) => l.n));
      const added: Link[] = items.map((a, i) => ({
        id: `trigger-${a.id}`,
        n: top + items.length - i, // (the first to resolve was the top of the chain)
        def: a.defId ? state.cards[a.defId] : undefined,
        name: a.title,
        text: [...(a.kind === "spell" && a.defId && state.cards[a.defId]?.text ? [readable(state.cards[a.defId].text as string, state.cards[a.defId].name)] : a.lines), ...(a.result ?? [])].join("\n"),
        help: helpFor([...a.lines, ...(a.defId ? [state.cards[a.defId]?.text ?? ""] : [])].join(" "), 2),
        kind: a.kind === "trigger" ? "A triggered ability: it happens by itself when its condition is met, and goes on the stack above whatever is there." : undefined,
        target: "",
        mine: a.player === actor,
        gone: true,
        leaving: false,
        fresh: i,
        hold: FLASH_SHOW_MS,
      }));
      return [...ls.filter((l) => !added.some((x) => x.id === l.id)), ...added].sort((x, y) => x.n - y.n);
    });
    if (items.length >= 2) setBanner((b) => (b ?? 0) + 1);
  }

  // The sharp picture of each card starts loading as soon as the card is known.
  useEffect(() => {
    for (const l of links) if (l.def) preloadImage(cardDetailImageUrl(l.def, "normal"));
  }, [links]);

  // Note when a card arrived, and plan the exit of the ones that are gone: after they had their time on screen, newest first.
  useEffect(() => {
    const now = performance.now();
    for (const l of links) if (!born.current.has(l.id)) born.current.set(l.id, now);
    const waiting = links.filter((l) => l.gone && !l.leaving && !planned.current.has(l.id)).sort((a, b) => b.n - a.n);
    waiting.forEach((l, i) => {
      planned.current.add(l.id);
      const wait = Math.max(0, (l.hold ?? MIN_SHOW_MS) - (now - (born.current.get(l.id) ?? now))) + i * EXIT_GAP_MS;
      // (these timers are keyed by card, not by this effect: they must still run when the list changes again)
      setTimeout(() => setLinks((ls) => ls.map((x) => (x.id === l.id ? { ...x, leaving: true } : x))), wait);
    });
  }, [links]);
  useEffect(() => {
    if (!links.some((l) => l.leaving)) return;
    const t = setTimeout(
      () =>
        setLinks((ls) => {
          for (const l of ls) {
            if (!l.leaving) continue;
            born.current.delete(l.id);
            planned.current.delete(l.id);
          }
          return ls.filter((l) => !l.leaving);
        }),
      LEAVE_MS,
    );
    return () => clearTimeout(t);
  }, [links]);
  useEffect(() => {
    if (banner === null) return;
    const t = setTimeout(() => setBanner(null), 1700);
    return () => clearTimeout(t);
  }, [banner]);

  // (a chain that was clicked away still leaves the buttons while something is on the stack: the player can still pass or resolve)
  const barOnly = links.length === 0 && state.stack.length > 0 && !!state.priority;
  if ((links.length === 0 && !barOnly) || state.winner) return null;
  const newest = links[links.length - 1]?.id ?? null;
  const choiceOpen = !!(state.pendingChoice || state.pendingPick); // a choice (what to discard, a target) must never be covered by the chain
  const cardsHidden = choiceOpen || (hiddenAt !== null && hiddenAt === newest);
  const round = state.priority;
  const canPass = !!onPass && !!round && round.holder === actor && !choiceOpen;
  const topName = state.stack.length > 0 ? itemName(state, state.stack[state.stack.length - 1]) : null;
  const passLabel = state.stack.length === 0 ? "Continue" : round?.passes === 1 ? `Resolve ${topName}` : "Pass";

  const [vw, vh] = sizeKey.split("x").map(Number);
  const phone = vw < 1024;
  const shown = links.slice(-(phone ? MAX_PHONE : MAX_SHOWN));
  const m = shown.length;
  const rowH = Math.round(Math.min(vh * 0.17, 122, (vh * 0.62) / Math.max(1, m)));
  // (more than six on a wide screen: smaller cards, so that they all fit and none has to leave)
  const H = phone ? Math.round(rowH * 0.9) : Math.round(Math.min(vh * 0.36, 320) * (m > 6 ? Math.max(0.55, 6 / m) : 1));
  const cw = Math.round(H * 0.716);
  const wide = Math.round(Math.min(vw * 0.94, 440)); // (phone) the width the card and its text share
  const stepX = m > 1 ? Math.min(H * 0.64, (vw * 0.8 - cw) / (m - 1)) : 0;
  const stepY = H * 0.24;
  // A wide screen: the cards cascade, each with its text under it. A phone: one under the other, each with its text beside it.
  const at = shown.map((_, i) =>
    phone ? { x: Math.round(-wide / 2 + cw / 2), y: Math.round((i - (m - 1) / 2) * rowH) } : { x: Math.round((i - (m - 1) / 2) * stepX), y: Math.round((i - (m - 1) / 2) * stepY) },
  );
  // A wide screen: the notes sit in one row under the cards (each as wide as the room allows); a phone: beside each card.
  // (more than six: the notes shrink to a name each, in as many rows as they need)
  const compact = !phone && m > 6;
  const cols = compact ? Math.max(1, Math.min(m, Math.floor((vw * 0.92) / 162))) : m;
  const noteW = phone ? wide - cw - 12 : Math.max(150, Math.min(270, Math.floor((vw * 0.92) / cols) - 12));
  const rowY = Math.round(Math.max(...at.map((a) => a.y), 0) + H / 2 + 16);
  // Where a chain is fastened to a card: low on its left side (a phone, with its cards one under the other: the middle), so the chain runs along the foot of the cascade
  const hook = (p: { x: number; y: number }) => (phone ? p : { x: Math.round(p.x - cw * 0.36), y: Math.round(p.y + H * 0.4) });
  const originTop = vh * (phone ? 0.44 : 0.42);
  const live = links.some((l) => !l.leaving);
  /** Clicking outside ends the chain for this player only: every card on screen goes at once, and none of them comes back (the opponent's screen is not touched). */
  const dismiss = () => {
    for (const l of links) {
      dismissed.current.add(l.id);
      born.current.delete(l.id);
      planned.current.delete(l.id);
    }
    for (const item of state.stack) dismissed.current.add(item.id);
    setHiddenAt(null);
    setBanner(null);
    setLinks([]);
  };
  const lite = liteMode();

  return (
    <div className={`pointer-events-none fixed inset-0 z-[80] ${lite ? "chain-lite" : ""}`}>
      {/* The buttons stay while the chain plays: pass, resolve or continue without waiting for it, and put the chain away to see the board. */}
      <div className="pointer-events-auto absolute left-1/2 top-[3.4rem] z-[100] flex max-w-[96vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/25 bg-slate-950/90 p-1.5 shadow-xl shadow-black/50">
        {canPass ? (
          <button onClick={onPass} className="min-h-11 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 text-base font-extrabold text-black shadow">
            {passLabel}
          </button>
        ) : (
          round && !choiceOpen && <span className="px-3 text-sm font-semibold text-slate-200">Waiting for {playerName(round.holder === actor ? OPPONENT[actor] : round.holder)}…</span>
        )}
        {choiceOpen && <span className="px-3 text-sm font-semibold text-amber-200">Make your choice below</span>}
        {!barOnly && (
          <button
            onClick={() => setHiddenAt(cardsHidden && !choiceOpen ? null : newest)}
            disabled={choiceOpen}
            className="min-h-11 rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-bold text-white disabled:opacity-40"
          >
            {cardsHidden ? "Show chain" : "Show board"}
          </button>
        )}
      </div>
      <div className="contents" style={cardsHidden ? { display: "none" } : undefined}>
      <p className="sr-only" role="status">
        Chain: {links.filter((l) => !l.leaving).map((l) => `${l.n}, ${l.name}`).join("; ")}
      </p>
      {/* the dimmed background: a click on it puts the chain away (the "Show chain" button brings it back) */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-700 ${live && !choiceOpen ? "pointer-events-auto cursor-pointer" : ""}`}
        style={{ opacity: live ? 0.3 : 0 }}
        onClick={dismiss}
        aria-hidden="true"
      />
      <div className="absolute" style={{ left: "50%", top: phone ? "44%" : "42%" }}>
        {/* the chains between a card and the one before it (over the older card, under the newer one) */}
        {shown.map((l, i) => {
          if (i === 0) return null;
          const a = hook(at[i - 1]);
          const b = hook(at[i]);
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          return (
            <div
              key={`link-${l.id}`}
              className={`chain-link ${on && !l.leaving ? "chain-link-in" : ""} ${l.leaving ? "chain-link-out" : ""}`}
              style={{ width: Math.max(1, Math.round(len)), zIndex: 21 + 2 * l.n, transform: `translate(${a.x}px, ${a.y}px) rotate(${angle}deg)`, animationDelay: `${420 + l.fresh * STAGGER_MS}ms`, "--d": `${420 + l.fresh * STAGGER_MS}ms` } as React.CSSProperties}
            >
              <ChainStrand len={len} angle={angle} seed={l.n} />
            </div>
          );
        })}
        {shown.map((l, i) => {
          const image = l.def?.image ? cardImageUrl(l.def.image) : null; // (146px wide: it shows at once)
          const sharp = l.def ? cardDetailImageUrl(l.def, "normal") : null; // (488px wide: the card's own text stays readable at this size)
          const glow = l.mine ? "34, 211, 238" : "251, 113, 133";
          return (
            <div
              key={l.id}
              className={`chain-card ${on ? (l.leaving ? "chain-out" : "chain-in") : ""}`}
              style={
                {
                  width: cw,
                  height: H,
                  marginLeft: -cw / 2,
                  marginTop: -H / 2,
                  zIndex: 20 + 2 * l.n,
                  "--x": `${at[i].x}px`,
                  "--y": `${at[i].y}px`,
                  "--r": `${phone ? [-2, 1.5, -1.5, 2][i % 4] : TILT[i % TILT.length]}deg`,
                  "--ex": `${Math.round(vw * 0.28)}px`,
                  "--ey": `${Math.round(vh * 0.3)}px`,
                  "--glow": glow,
                  animationDelay: l.leaving ? undefined : `${l.fresh * STAGGER_MS}ms`,
                } as React.CSSProperties
              }
            >
              {on && !l.leaving && !lite && <span className="chain-rays" style={{ animationDelay: `${l.fresh * STAGGER_MS}ms` }} />}
              {/* a card frame with its name and text: what shows until the picture has loaded (or when there is no picture) */}
              <div className="chain-face chain-frame">
                <div className="chain-frame-name">{l.def?.name ?? l.name}</div>
                {l.def?.manaCost && (
                  <div className="chain-frame-cost">
                    <ManaText text={l.def.manaCost} />
                  </div>
                )}
                <div className="chain-frame-text">{l.text}</div>
              </div>
              {image && <div className="chain-face chain-art" style={{ backgroundImage: `url(${image})` }} />}
              {sharp && <div className="chain-face chain-art" style={{ backgroundImage: `url(${sharp})` }} />}
              <span className="chain-flash" />
              <span className="chain-num" style={{ animationDelay: `${l.fresh * STAGGER_MS + 300}ms` }}>
                {l.n}
              </span>
            </div>
          );
        })}
        {/* what each card does: its own flat layer (text inside a tilted, scaling card is drawn small and then stretched: blurry) */}
        {shown.map((l, i) => {
          const col = compact ? i % cols : i;
          const x = phone ? Math.round(at[i].x + cw / 2 + 10) : Math.round((col - (cols - 1) / 2) * (noteW + 12) - noteW / 2);
          const y = phone ? Math.round(at[i].y - H / 2) : rowY + (compact ? Math.floor(i / cols) * 58 : 0);
          return (
            <div
              key={`note-${l.id}`}
              className={`chain-note ${on ? (l.leaving ? "chain-note-out" : "chain-note-in") : ""}`}
              style={{ width: noteW, transform: `translate(${x}px, ${y}px)`, zIndex: 40 + l.n, maxHeight: phone ? H : compact ? 52 : Math.max(120, Math.floor(vh - originTop - y - 12)), animationDelay: l.leaving ? undefined : `${l.fresh * STAGGER_MS + 450}ms` }}
            >
              <div className="chain-note-name">{l.name}</div>
              {l.text && !compact && (
                <p className="chain-note-text">
                  <ManaText text={l.text} />
                </p>
              )}
              {l.target && !compact && <p className="chain-note-target">Target: {l.target}</p>}
              {l.kind && !compact && <p className="chain-note-kind">{l.kind}</p>}
              {(compact ? [] : l.help).map((h, k) => (
                <p key={k} className="chain-note-help">
                  ⓘ {h}
                </p>
              ))}
            </div>
          );
        })}
      </div>
      {on && banner !== null && (
        <div key={banner} className="chain-text" aria-hidden="true">
          CHAIN
        </div>
      )}
      </div>
    </div>
  );
}
