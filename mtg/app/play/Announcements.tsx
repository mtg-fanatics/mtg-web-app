"use client";

import { useEffect, useState, memo } from "react";
import type { GameState } from "@mtg/engine";
import { cardImageUrl } from "@/lib/cards";
import { animationsEnabled } from "@/lib/motion";
import { playerName } from "./log";
import type { Announcement } from "./log";
import { ManaText } from "./ManaSymbols";

const RESULT_LOOK: Record<NonNullable<Announcement["done"]>, { mark: string; className: string }> = {
  resolved: { mark: "✓", className: "text-emerald-800" },
  fizzled: { mark: "⦸", className: "text-amber-700" },
  countered: { mark: "✗", className: "text-orange-700" },
};

/** What was paid and said when it was cast, then what it did once it left the stack (each change on its own line). */
export function PlayLines({ a, size = "text-[15px]" }: { a: Announcement; size?: string }) {
  const look = RESULT_LOOK[a.done ?? "resolved"];
  return (
    <>
      {a.lines.length > 0 && (
        <ul className={`mt-1 list-disc pl-5 ${size} leading-snug text-zinc-700`}>
          {a.lines.map((l, i) => (
            <li key={i}>
              <ManaText text={l} />
            </li>
          ))}
        </ul>
      )}
      {a.done && (a.result ?? []).length > 0 && (
        <ul className={`mt-1 flex flex-col gap-0.5 ${size} font-medium leading-snug ${look.className}`}>
          {a.result!.map((l, i) => (
            <li key={i}>
              <span aria-hidden className="mr-1">{look.mark}</span>
              {l}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** "Welcome to the Battle Field, Now Duel!" over the board when a match begins, for the players. It doesn't block clicks. */
export function WelcomeSplash() {
  return (
    <div role="status" aria-live="assertive" className="pointer-events-none fixed inset-x-0 top-[14dvh] z-30 flex justify-center px-4">
      <div className="welcome-splash rounded-3xl border-2 border-amber-300/80 bg-slate-950/80 px-10 py-6 text-center shadow-2xl shadow-black/50">
        <div className="font-display text-xl font-bold uppercase tracking-[0.28em] text-slate-100 [text-shadow:0_2px_12px_rgba(0,0,0,0.7)] sm:text-2xl">Welcome to the Battle Field</div>
        <div className="mt-1 font-display text-5xl font-extrabold uppercase tracking-[0.12em] text-amber-300 [text-shadow:0_2px_16px_rgba(244,180,61,0.55)] sm:text-7xl">Now Duel!</div>
      </div>
    </div>
  );
}

/** "Your turn" across the top of the screen when the opponent passes the turn. It doesn't block clicks. */
export function TurnSplash() {
  return (
    <div role="status" aria-live="assertive" className="pointer-events-none fixed inset-x-0 top-[14dvh] z-30 flex justify-center px-4">
      <div className={`${animationsEnabled() ? "turn-splash" : ""} rounded-3xl border-2 border-amber-300/80 bg-slate-950/75 px-10 py-5 text-center shadow-2xl shadow-black/50`}>
        <div className="font-display text-5xl font-extrabold uppercase tracking-[0.2em] text-amber-300 [text-shadow:0_2px_12px_rgba(0,0,0,0.6)] sm:text-6xl">Your turn</div>
      </div>
    </div>
  );
}

/**
 * Everything cast or used this turn, kept on screen until the turn ends: spells go to the graveyard as soon as they
 * resolve, so without this it is hard to follow what has happened and what is still in effect.
 */
function PlayedThisTurnInner({ items, state, onZoom }: { items: Announcement[]; state: GameState; onZoom: (defId: string) => void }) {
  if (items.length === 0) return null;
  return (
    <section className="flex shrink-0 flex-col gap-1 rounded-xl border border-amber-300 bg-amber-50/80 p-2 shadow-sm">
      <h2 className="text-sm font-bold uppercase font-display tracking-wide text-amber-800">Played this turn ({items.length})</h2>
      <ol className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
        {[...items].reverse().map((a) => {
          const def = a.defId ? state.cards[a.defId] : undefined;
          return (
            <li key={a.id} className="flex items-start gap-2.5 rounded border border-amber-200 bg-white p-1.5">
              <button
                type="button"
                onClick={() => a.defId && onZoom(a.defId)}
                aria-label={def ? `Enlarge ${def.name}` : "Card"}
                className="h-14 w-10 shrink-0 rounded border border-zinc-500 bg-zinc-300 bg-cover bg-center"
                style={def?.image ? { backgroundImage: `url(${cardImageUrl(def.image)})` } : undefined}
              />
              <div className="min-w-0 flex-1 text-[15px] leading-snug">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 text-xs font-bold uppercase font-display ${a.player === "p1" ? "bg-sky-100 text-sky-800" : "bg-rose-100 text-rose-800"}`}>{playerName(a.player)}</span>
                  <span className="font-semibold">{a.title.replace(`${playerName(a.player)}'s `, "").replace(`${playerName(a.player)} `, "")}</span>
                  <span className="text-sm text-zinc-600">{a.kind === "trigger" ? "triggered ability" : a.kind}</span>
                </div>
                <PlayLines a={a} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Online: a player who sits on their own turn is reminded that the opponent is waiting. Any change to the game starts the wait again. */
export function PassReminder({ state, after, opponent, onEndTurn }: { state: GameState; after: number; opponent: string; onEndTurn: () => void }) {
  const [shownFor, setShownFor] = useState<GameState | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setShownFor(state), after);
    return () => clearTimeout(timer);
  }, [state, after]);
  if (shownFor !== state) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[14dvh] z-30 flex justify-center px-4 max-lg:hidden">
      <div
        className={`${animationsEnabled() ? "pass-reminder" : ""} pointer-events-auto flex flex-wrap items-center justify-center gap-3 rounded-2xl border-2 border-amber-300/80 bg-slate-950/85 px-5 py-3 text-[15px] font-semibold text-amber-100 shadow-2xl shadow-black/50`}
      >
        <span>⏰ Still your turn. {opponent} is waiting for you to pass it.</span>
        <button onClick={onEndTurn} className="rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-1.5 text-sm font-extrabold text-black shadow-md shadow-amber-500/40 hover:-translate-y-0.5">
          End turn
        </button>
        <button onClick={() => setShownFor(null)} className="rounded-xl border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10">
          Not yet
        </button>
      </div>
    </div>
  );
}

/** Drawn again only when what was played changed. */
export const PlayedThisTurn = memo(PlayedThisTurnInner, (a, b) => JSON.stringify(a.items) === JSON.stringify(b.items));
