"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { powerOf, toughnessOf } from "@mtg/engine";
import type { CardDef, GameState, PlayerId } from "@mtg/engine";
import { buildSteps, fetchReplay } from "@/lib/replay";
import type { Replay, Step } from "@/lib/replay";
import CardView from "../play/CardView";
import { Lightbox } from "../play/CardDetail";
import { describeEvents } from "../play/log";
import { Skeleton } from "../Skeleton";

const SPEEDS = [0.5, 1, 2, 4];
const LINES = new WeakMap<Step, string[]>(); // the log text of each step, once worked out

/** A match played again, move by move, with both hands open. */
export default function ReplayView({ id }: { id: string }) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchReplay(id)
      .then((r) => alive && setReplay(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <main className="cards-glass relative flex flex-1 flex-col gap-3 p-3 text-slate-100 lg:h-[calc(100dvh-2.7rem)] lg:flex-none lg:overflow-hidden">
      <div className="page-atmosphere" aria-hidden="true" />
      {error && (
        <div className="glass glass-flat mx-auto mt-16 flex max-w-lg flex-col items-center gap-4 p-8 text-center">
          <h1 className="page-title !text-2xl">No replay</h1>
          <p className="text-slate-200">{error}</p>
          <Link href="/" className="btn-gold">
            Back to the dashboard
          </Link>
        </div>
      )}
      {!error && !replay && (
        <div className="glass glass-flat flex flex-1 flex-col gap-3 p-5" role="status" aria-label="Loading the replay">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {replay && <Viewer replay={replay} />}
    </main>
  );
}

function Viewer({ replay }: { replay: Replay }) {
  const built = useMemo(() => buildSteps(replay), [replay]);
  const steps = built.steps;
  const [at, setAt] = useState(0);
  // It starts playing by itself: the first move is only a table with nothing on it yet (the hands are dealt, the lands and spells come later), which looked like an empty page.
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoomed, setZoomed] = useState<CardDef | null>(null);
  const last = steps.length - 1;
  const step = steps[Math.min(at, last)];

  useEffect(() => {
    if (!playing || at >= last) return;
    const t = setTimeout(() => setAt((n) => Math.min(last, n + 1)), 750 / speed);
    return () => clearTimeout(t);
  }, [playing, at, last, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (zoomed || (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
      if (e.key === "ArrowRight") setAt((n) => Math.min(last, n + 1));
      else if (e.key === "ArrowLeft") setAt((n) => Math.max(0, n - 1));
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, zoomed]);

  // the game text says "Player 1" and "Player 2": the replay shows the players' real names
  // worked out one step at a time, when first needed (a long match has hundreds of steps)
  const lines = (i: number) => {
    const s = steps[i];
    let l = LINES.get(s);
    if (!l) {
      l = i === 0 ? ["The match begins."] : describeEvents(s.events, s.state).map((x) => x.replaceAll("Player 1", replay.names.p1).replaceAll("Player 2", replay.names.p2));
      LINES.set(s, l);
    }
    return l;
  };
  const name = (p: PlayerId) => replay.names[p];
  const result = replay.winner === "draw" ? "A draw" : replay.winner ? `${name(replay.winner)} won` : "";
  const g = step.state;

  return (
    <>
      <header className="glass glass-flat flex shrink-0 flex-wrap items-center gap-3 !rounded-2xl px-4 py-2">
        <Link href="/" className="btn-ghost !px-3 !py-1.5" aria-label="Back to the dashboard">
          ← Back
        </Link>
        <h1 className="page-title !text-xl">Replay</h1>
        <span className="text-[15px] font-semibold">
          {name("p1")} <span className="text-slate-400">vs</span> {name("p2")}
        </span>
        {result && <span className="chip chip-ok">{result}</span>}
        <span className="ml-auto text-sm text-slate-300">{new Date(replay.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
      </header>
      {built.broken && <p className="shrink-0 rounded-xl border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-sm text-[#e8d9b5]">The replay stops at step {last}: the game rules have changed since this match, so the rest can&apos;t be shown. ({built.broken})</p>}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="glass glass-flat flex min-h-0 flex-col gap-2 p-3" aria-label="The table">
          <Side g={g} who="p2" name={name("p2")} onZoom={setZoomed} />
          <Stack g={g} />
          <Side g={g} who="p1" name={name("p1")} onZoom={setZoomed} />
        </section>
        <aside className="glass glass-flat flex min-h-0 flex-col gap-2 p-3" aria-label="What happened">
          <h2 className="font-display text-sm font-bold uppercase tracking-widest text-[#e8dcc0]">What happened</h2>
          <LogList lines={lines} steps={steps} at={at} onJump={setAt} name={name} />
        </aside>
      </div>

      <footer className="glass glass-flat flex shrink-0 flex-wrap items-center gap-3 !rounded-2xl px-4 py-2">
        <div className="flex items-center gap-1.5">
          <button onClick={() => (setPlaying(false), setAt(0))} aria-label="Back to the start" className="btn-ghost !px-2.5 !py-1.5">
            ⏮
          </button>
          <button onClick={() => setAt((n) => Math.max(0, n - 1))} disabled={at === 0} aria-label="Previous move" className="btn-ghost !px-2.5 !py-1.5">
            ◀
          </button>
          <button onClick={() => (at >= last ? (setAt(0), setPlaying(true)) : setPlaying(!playing))} aria-label={playing && at < last ? "Pause" : "Play"} className="btn-gold !px-4 !py-1.5">
            {at >= last ? "↺ Again" : playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button onClick={() => setAt((n) => Math.min(last, n + 1))} disabled={at >= last} aria-label="Next move" className="btn-ghost !px-2.5 !py-1.5">
            ▶
          </button>
          <button onClick={() => (setPlaying(false), setAt(last))} aria-label="To the end" className="btn-ghost !px-2.5 !py-1.5">
            ⏭
          </button>
        </div>
        <input type="range" min={0} max={last} value={Math.min(at, last)} onChange={(e) => (setPlaying(false), setAt(Number(e.target.value)))} aria-label="Move" className="min-w-40 flex-1 accent-amber-400" />
        <span className="text-sm tabular-nums text-slate-300">
          Move {at} of {last} · Turn {g.turn}
        </span>
        <div role="group" aria-label="Speed" className="flex gap-1 rounded-full border border-white/15 bg-white/5 p-0.5">
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => setSpeed(s)} aria-pressed={speed === s} className={`rounded-full px-2.5 py-1 text-xs font-bold ${speed === s ? "bg-amber-400 text-black" : "text-slate-200 hover:bg-white/10"}`}>
              {s}×
            </button>
          ))}
        </div>
      </footer>
      {zoomed && <Lightbox def={zoomed} onClose={() => setZoomed(null)} />}
    </>
  );
}

/** One player: life, piles, the hand (face up) and the battlefield. */
const Side = memo(function Side({ g, who, name, onZoom }: { g: GameState; who: PlayerId; name: string; onZoom: (d: CardDef) => void }) {
  const p = g.players[who];
  const active = g.active === who && g.phase !== "mulligan";
  const lands = p.battlefield.filter((x) => g.cards[x.card.defId].type === "land");
  const rest = p.battlefield.filter((x) => g.cards[x.card.defId].type !== "land");
  const card = (c: { iid: string; defId: string }, extra: Partial<React.ComponentProps<typeof CardView>> = {}) => {
    const def = g.cards[c.defId];
    return <CardView key={c.iid} def={def} size="sm" onClick={() => onZoom(def)} {...extra} />;
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 [--card-h:clamp(54px,9.2dvh,96px)]">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={`rounded-full px-3 py-0.5 font-bold ${who === "p1" ? "bg-sky-500/25 text-sky-100" : "bg-rose-500/25 text-rose-100"}`}>{name}</span>
        {active && <span className="chip chip-ok">{g.phase}</span>}
        <span className="font-bold text-rose-200">♥ {p.life}</span>
        {(p.poison ?? 0) > 0 && <span className="font-bold text-lime-200">☠ {p.poison}/10</span>}
        <span className="text-slate-300">Library {p.library.length}</span>
        <span className="text-slate-300">Graveyard {p.graveyard.length}</span>
        {p.exile.length > 0 && <span className="text-slate-300">Exile {p.exile.length}</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-1.5">
        <div className="flex flex-wrap items-start gap-1.5">
          {rest.map((x) => card(x.card, { tapped: x.tapped, damage: x.damage, power: g.cards[x.card.defId].type === "creature" ? powerOf(g, x) : undefined, toughness: g.cards[x.card.defId].type === "creature" ? toughnessOf(g, x) : undefined, tags: [...(x.counters ? [`${x.counters}× +1/+1`] : [])] }))}
          {lands.map((x) => card(x.card, { tapped: x.tapped }))}
          {p.battlefield.length === 0 && <span className="px-2 text-xs text-slate-400">Nothing on the battlefield.</span>}
        </div>
      </div>
      <div className="flex items-start gap-1.5 overflow-x-auto" aria-label={`${name}'s hand`}>
        <span className="shrink-0 self-center pr-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Hand {p.hand.length}</span>
        {p.hand.map((c) => card(c))}
      </div>
    </div>
  );
});

/** What is waiting to resolve. */
function Stack({ g }: { g: GameState }) {
  if (g.stack.length === 0) return null;
  return (
    <div className="shrink-0 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-1.5 text-sm">
      <span className="mr-2 text-xs font-bold uppercase tracking-widest text-[#e8dcc0]">On the stack</span>
      {[...g.stack].reverse().map((s, i) => (
        <span key={s.id} className="mr-3">
          {i === 0 ? "▸ " : ""}
          {s.kind === "spell" ? g.cards[s.card.defId].name : s.sourceName}
        </span>
      ))}
    </div>
  );
}

/** Every step so far; the current one is highlighted and kept in view. Click a line to jump there. */
function LogList({ lines, steps, at, onJump, name }: { lines: (i: number) => string[]; steps: Step[]; at: number; onJump: (i: number) => void; name: (p: PlayerId) => string }) {
  const current = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = current.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    // scroll the list itself, not the page (scrollIntoView can move every scrolling ancestor, which relayouts the whole screen)
    if (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop - box.clientHeight / 2;
  }, [at]);
  const rows = steps.flatMap((s, i) => (lines(i).length > 0 ? [{ i, s }] : []));
  return (
    <ol className="relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1 text-[13px]">
      {rows.map(({ i, s }) => {
        const on = i === at || (i < at && !rows.some((r) => r.i > i && r.i <= at));
        return (
          <li key={i} ref={on ? current : undefined}>
            <button onClick={() => onJump(i)} className={`w-full rounded-lg px-2 py-1 text-left leading-snug transition ${on ? "bg-amber-400/25 ring-1 ring-amber-300/60" : i > at ? "opacity-40 hover:opacity-80" : "hover:bg-white/10"}`}>
              {s.who && <span className="mr-1 text-[10px] font-bold uppercase text-slate-400">{name(s.who)}</span>}
              {lines(i).join(" ")}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
