"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { scaled, useAnimationsOn } from "@/lib/motion";
import { useMedia } from "./play/useMedia";
import "./book.css";
import "./album.css";

/**
 * A page-turning album: an open book on the table, two pages side by side (one page on a narrow screen), and real leaves that turn over the spine.
 * It knows nothing about what is on the pages: the screen hands over how many pages there are, which one is showing, and how to draw one.
 *
 *   - `index` is the left page of the spread being shown (the page itself on a narrow screen). `onIndex` is called when a turn is over.
 *   - `prepare` is awaited before a turn starts: load what the pages that will appear need, so they are already painted when the leaf comes over.
 *   - Every page of the neighbouring spreads is already in the document, sitting in its place under or behind the visible ones (see `roleOf`). A turn
 *     therefore only moves pages that exist: it builds nothing, and when it ends the pages only change place, with the same transform they landed on, so
 *     there is no work (and no jump) at the end of it. The pages two spreads away are added after each turn, when things are quiet.
 *   - A turn is CSS 3D (transform and opacity only). With the game's Motion switch off there is no turn:
 *     the pages cross-fade. A jump to a far page, or a new search, cross-fades too.
 *   - Turns are queued at most once: more requests while one is going just move the one waiting, and if it is more than one spread away the book
 *     skips straight to it instead of leafing through.
 */

export interface AlbumProps {
  /** How many pages the album has in all. */
  pages: number;
  index: number;
  onIndex: (index: number) => void;
  prepare: (pages: number[]) => Promise<void>;
  renderPage: (page: number) => ReactNode;
  /** Something that changes when what `renderPage` draws for a page changes (a page that has the same token is not drawn again). */
  pageToken: (page: number) => unknown;
  /** Called as a turn or a jump begins (close a hover card, for example). */
  onTurnStart?: () => void;
  /** The pages are waiting for new content (a search is running): they are dimmed a little. */
  busy?: boolean;
  /** Changes when the contents are a different set altogether (another search): the pages fade in. */
  resetKey?: string;
  keysEnabled?: boolean;
  label?: string;
}

interface Turn {
  dir: 1 | -1;
  from: number;
  to: number;
  dur: number;
}

const FULL_MS = 800;
const QUICK_MS = 520;

/** Where a page is, by how far it is from the left page of the spread: L and R are on show; the others wait under or behind them. */
function roleOf(d: number, spread: boolean): string {
  if (spread) return ({ 0: "L", 1: "R", 2: "NL", 3: "UN", "-1": "PR", "-2": "UP" } as Record<string, string>)[d] ?? "far";
  return d === 0 ? "P" : d === 1 ? "N" : d === -1 ? "V" : "far";
}

const Body = memo(
  function Body({ i, render }: { i: number; render: (i: number) => ReactNode; token: unknown }) {
    return <>{render(i)}</>;
  },
  (a, b) => a.i === b.i && Object.is(a.token, b.token),
);

export default function Album({ pages, index, onIndex, prepare, renderPage, pageToken, onTurnStart, busy = false, resetKey = "", keysEnabled = true, label = "Card album" }: AlbumProps) {
  const narrow = useMedia("(max-width: 1023px)");
  const on = useAnimationsOn();
  // (only the game's Motion switch decides, not the computer's own "reduce motion" setting: that one silently hid animations before, with no way to tell why)
  const animated = on;
  const spread = !narrow;
  const step = spread ? 2 : 1;
  const total = Math.max(1, pages);
  const snap = useCallback((i: number) => Math.min(Math.max(0, spread ? i - (i % 2) : i), spread ? (total - 1) - ((total - 1) % 2) : total - 1), [spread, total]);
  const idx = snap(index);
  const spreads = Math.ceil(total / step);

  const [turn, setTurn] = useState<Turn | null>(null);
  const [fading, setFading] = useState(false);
  const [prep, setPrep] = useState<1 | -1 | null>(null); // a turn is about to start: its two pages get their own layers now, so the first frame is not spent building them
  const [jumping, setJumping] = useState<number | null>(null); // the page whose number is being edited
  const running = useRef(false);
  const pending = useRef<number | null>(null);
  const live = useRef({ idx, animated, spread, step, snap, prepare, onIndex, onTurnStart });
  live.current = { idx, animated, spread, step, snap, prepare, onIndex, onTurnStart };
  const committing = useRef(false);
  const heading = useRef(idx); // where the book is going: the page it is on, or the end of the turn or jump under way, or the one waiting after it

  const settle = useCallback((at: number) => {
    running.current = false;
    committing.current = false;
    const next = pending.current;
    pending.current = null;
    if (next !== null && next !== at) void run(at, next, true); // eslint-disable-line @typescript-eslint/no-use-before-define
    else heading.current = at;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(
    async (from: number, to: number, quick: boolean) => {
      const L = live.current;
      running.current = true;
      L.onTurnStart?.();
      const turning = L.animated && Math.abs(to - from) === L.step;
      if (turning) {
        const dir = to > from ? 1 : -1;
        const need = L.spread ? (dir === 1 ? [from + 2, from + 3] : [from - 2, from - 1]) : [dir === 1 ? from + 1 : from - 1];
        setPrep(dir);
        await Promise.all([L.prepare(need), new Promise((r) => setTimeout(r, 90))]);
        committing.current = false;
        setPrep(null);
        setTurn({ dir, from, to, dur: scaled(quick ? QUICK_MS : FULL_MS) });
        return;
      }
      // a jump, a reduced-motion change of page, or a long way: a quick cross-fade
      setFading(true);
      await new Promise((r) => setTimeout(r, L.animated ? 150 : 80));
      await L.prepare(L.spread ? [to, to + 1] : [to]);
      live.current.onIndex(to);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      setFading(false);
      settle(to);
    },
    [settle],
  );

  /** Goes to a page (the spread it is on). Several requests in a row keep only the last one. */
  const go = useCallback(
    (target: number) => {
      const t = live.current.snap(target);
      heading.current = t;
      if (running.current) {
        pending.current = t;
        return;
      }
      if (t === live.current.idx) return;
      void run(live.current.idx, t, false);
    },
    [run],
  );

  const finishTurn = useCallback(
    (t: Turn) => {
      if (committing.current) return;
      committing.current = true;
      live.current.onIndex(t.to); // (with the setTurn below: one render, so the book never shows the old pages for a frame)
      setTurn(null);
      settle(t.to);
    },
    [settle],
  );

  // a timer behind the end of the leaf's animation, in case the browser never reports one
  useEffect(() => {
    if (!turn) return;
    const t = window.setTimeout(() => finishTurn(turn), turn.dur + 1800);
    return () => window.clearTimeout(t);
  }, [turn, finishTurn]);

  useEffect(() => {
    if (!running.current) heading.current = idx;
  }, [idx]);

  // a change of mode (the window was resized) puts the book on a page it can show
  useEffect(() => {
    if (!running.current && idx !== index) onIndex(idx);
  }, [idx, index, onIndex]);

  // the arrow keys turn the page (the same rules as everywhere: not while typing, not under a window); pressing again while a turn is going moves the one waiting
  useEffect(() => {
    if (!keysEnabled || jumping !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowRight" && e.key !== "ArrowLeft") || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest('[role="dialog"], [role="listbox"], [role="slider"]'))) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      go(heading.current + (e.key === "ArrowRight" ? step : -step));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keysEnabled, jumping, go, step]);

  // swipe, on a touch screen
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "touch") swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.6) go(heading.current + (dx < 0 ? step : -step));
  };

  // which pages are in the document: the ones on show and those a turn brings in, always; the two spreads either side are added one page at a time
  // while things are quiet (a page is a few dozen elements and nine pictures: building them in the middle of a turn would be felt)
  const [extras, setExtras] = useState<number[]>([]);
  const nearLo = spread ? idx - 2 : idx - 1;
  const nearHi = spread ? idx + 3 : idx + 1;
  const wideLo = spread ? idx - 4 : idx - 2;
  const wideHi = spread ? idx + 5 : idx + 3;
  useEffect(() => {
    if (turn || fading) return;
    const inWide = (p: number) => p >= wideLo && p <= wideHi && p >= 0 && p < total;
    const missing: number[] = [];
    for (let p = wideLo; p <= wideHi; p++) if (inWide(p) && !(p >= nearLo && p <= nearHi) && !extras.includes(p)) missing.push(p);
    missing.sort((x, y) => Math.abs(x - idx - 0.5) - Math.abs(y - idx - 0.5));
    const stale = extras.some((p) => !inWide(p));
    if (missing.length === 0 && !stale) return;
    const t = window.setTimeout(() => setExtras((prev) => [...prev.filter(inWide), ...(missing.length ? [missing[0]] : [])]), missing.length ? 90 : 400);
    return () => window.clearTimeout(t);
  }, [turn, fading, idx, extras, nearLo, nearHi, wideLo, wideHi, total]);
  const mounted: number[] = [];
  for (let i = Math.max(0, Math.min(nearLo, ...extras)); i <= Math.min(total - 1, Math.max(nearHi, ...extras)); i++) {
    if ((i >= nearLo && i <= nearHi) || extras.includes(i)) mounted.push(i);
  }

  const prog = spreads > 1 ? idx / step / (spreads - 1) : 0;
  const atStart = idx <= 0;
  const atEnd = idx + step >= total;
  const shown = (role: string) => role === "L" || role === "R" || role === "P";

  const style = { "--prog": prog, "--dur": `${turn?.dur ?? FULL_MS}ms` } as CSSProperties;

  return (
    <div className="alb-fit">
      <div className="alb" data-mode={spread ? "spread" : "single"} data-turning={turn ? turn.dir : undefined} data-prep={prep ?? undefined} style={style} role="group" aria-label={label} aria-roledescription="album">
        <div className="alb-cover" aria-hidden="true" />
        <div className="alb-pages">
          <div className="alb-stack-box" aria-hidden="true" />

          <div
            key={resetKey}
            className="alb-sheets"
            data-fade={fading ? "out" : "in"}
            data-busy={busy ? "yes" : "no"}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onAnimationEnd={(e) => turn && e.animationName.startsWith("alb-pg-") && finishTurn(turn)}
          >
            {/* plain paper under everything: what shows where a page is missing (the end of the album) */}
            <div className="alb-blank" data-side="l" aria-hidden="true" />
            {spread && <div className="alb-blank" data-side="r" aria-hidden="true" />}
            {mounted.map((i) => {
              const role = roleOf(i - idx, spread);
              const interactive = shown(role) && !turn;
              return (
                <section
                  key={i}
                  className="alb-page"
                  data-role={role}
                  data-side={spread && i % 2 === 0 ? "l" : "r"}
                  aria-label={shown(role) ? `Page ${i + 1}` : undefined}
                  aria-hidden={shown(role) ? undefined : true}
                >
                  <Body i={i} render={renderPage} token={pageToken(i)} />
                  {interactive && jumping === i ? (
                    <form
                      className="alb-folio alb-folio-edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const n = Number.parseInt(new FormData(e.currentTarget).get("page") as string, 10);
                        setJumping(null);
                        if (Number.isFinite(n)) go(n - 1);
                      }}
                    >
                      <input name="page" type="number" min={1} max={total} defaultValue={i + 1} autoFocus aria-label={`Go to page, 1 to ${total.toLocaleString()}`} onBlur={() => setJumping(null)} onKeyDown={(e) => e.key === "Escape" && setJumping(null)} />
                    </form>
                  ) : (
                    <button type="button" className="alb-folio" tabIndex={interactive ? 0 : -1} disabled={!interactive} onClick={() => setJumping(i)} title={`Page ${(i + 1).toLocaleString()} of ${total.toLocaleString()}: click to go to another page`}>
                      {(i + 1).toLocaleString()}
                    </button>
                  )}
                  <div className="alb-sheen" aria-hidden="true" />
                </section>
              );
            })}
          </div>

          <button type="button" className="alb-edge alb-edge-l" aria-label="Previous page" disabled={atStart} onClick={() => go(heading.current - step)} />
          <button type="button" className="alb-edge alb-edge-r" aria-label="Next page" disabled={atEnd} onClick={() => go(heading.current + step)} />
          <button type="button" className="alb-corner alb-corner-l" aria-label="Previous page" title="Previous page" disabled={atStart} onClick={() => go(heading.current - step)} />
          <button type="button" className="alb-corner alb-corner-r" aria-label="Next page" title="Next page" disabled={atEnd} onClick={() => go(heading.current + step)} />
        </div>
      </div>
    </div>
  );
}
