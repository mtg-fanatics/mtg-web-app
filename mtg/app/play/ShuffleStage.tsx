"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { OPPONENT } from "@mtg/engine";
import type { GameState, PlayerId } from "@mtg/engine";
import { animationsEnabled } from "@/lib/motion";
import { SleeveBack } from "./AppearanceDialog";
import { playerName } from "./log";
import { riffleElement } from "./pileFx";

const W = 118;
const H = 165;
const FLY_MS = 750;
const PLAYERS: PlayerId[] = ["p1", "p2"];

type Spot = Record<PlayerId, { x: number; y: number }>;
const center = (el: Element | null) => {
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
};

/**
 * Before the hands are decided, each player shuffles the OTHER player's deck, as across a real table:
 * the libraries fly out to the middle of the opposite playmat, the player whose mat it is clicks the deck to shuffle it,
 * and when both are done the decks fly back to their library spots. `onDone` is called once they are home.
 */
export default function ShuffleStage({
  state,
  viewer,
  watching,
  actor,
  sleeve,
  onShuffle,
  onDone,
}: {
  state: GameState;
  /** Online: the seat of the player at this screen. Hot-seat: null (whoever is to act shuffles). */
  viewer: PlayerId | null;
  watching: boolean;
  actor: PlayerId;
  sleeve: (p: PlayerId) => { css: string; edge: string };
  onShuffle: (shuffler: PlayerId) => void;
  onDone: () => void;
}) {
  const shuffled = state.opening?.shuffled ?? { p1: true, p2: true };
  const motion = animationsEnabled();
  const [home, setHome] = useState<Spot | null>(null); // each library's spot
  const [table, setTable] = useState<Spot | null>(null); // the middle of the mat of the player who shuffles it
  const [phase, setPhase] = useState<"in" | "wait" | "out">("in");
  const [riffled, setRiffled] = useState<PlayerId[]>(() => PLAYERS.filter((o) => shuffled[OPPONENT[o]])); // already shuffled when this appeared
  const stack = useRef<Partial<Record<PlayerId, HTMLDivElement | null>>>({});
  const started = useRef(new Set<PlayerId>(riffled));
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  // Where everything is: remeasured when the players swap sides (hot-seat) or the window changes.
  useLayoutEffect(() => {
    const measure = () => {
      const libs = PLAYERS.map((p) => center(document.querySelector(`[data-pile="library-${p}"]`)));
      const mats = PLAYERS.map((p) => center(document.querySelector(`[data-mat="${p}"]`)));
      if (libs.some((c) => !c) || mats.some((c) => !c)) return;
      setHome({ p1: libs[0]!, p2: libs[1]! });
      // a deck lies on the mat of the player who shuffles it: the other player's
      setTable({ p1: mats[1]!, p2: mats[0]! });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [actor]);

  // The decks fly out; after that they can be shuffled.
  useEffect(() => {
    const t = setTimeout(() => setPhase((p) => (p === "in" ? "wait" : p)), motion ? FLY_MS + 100 : 0);
    return () => clearTimeout(t);
  }, [motion]);

  // A deck is shuffled (by a click here, or by the other player somewhere else): it riffles, once.
  useEffect(() => {
    if (phase === "in") return;
    for (const owner of PLAYERS) {
      if (!shuffled[OPPONENT[owner]] || started.current.has(owner)) continue;
      started.current.add(owner);
      const el = stack.current[owner]?.firstElementChild as HTMLElement | null;
      void (el ? riffleElement(el) : Promise.resolve()).then(() => setRiffled((r) => [...r, owner]));
    }
  }, [phase, shuffled.p1, shuffled.p2]); // eslint-disable-line react-hooks/exhaustive-deps

  // Both decks shuffled: they fly home.
  useEffect(() => {
    if (phase !== "wait" || riffled.length < 2) return;
    const t = setTimeout(() => setPhase("out"), 250);
    return () => clearTimeout(t);
  }, [phase, riffled.length]);
  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => done.current(), motion ? FLY_MS : 0);
    return () => clearTimeout(t);
  }, [phase, motion]);

  // The libraries themselves are hidden while their decks are away.
  const hideLibraries = home && phase !== "out";

  if (!home || !table) return null;
  return (
    <>
      {hideLibraries && <style>{`[data-pile^="library-"] > :first-child { visibility: hidden; }`}</style>}
      <div className="pointer-events-none fixed inset-0 z-[60]" aria-live="polite">
        {PLAYERS.map((owner) => {
          const shuffler = OPPONENT[owner];
          const spot = phase === "in" || phase === "out" ? home[owner] : table[owner];
          const isShuffled = shuffled[shuffler];
          // online only the player at this screen shuffles for their own seat; in hot-seat whoever is up does
          const canClick = phase === "wait" && !isShuffled && !watching && playerToShuffle(state) === shuffler && (viewer === null || viewer === shuffler);
          const shrink = phase === "in" || phase === "out";
          const label = isShuffled
            ? "Shuffled ✓"
            : canClick
              ? `Click to shuffle ${playerName(owner)}'s deck`
              : playerToShuffle(state) === shuffler
                ? `${playerName(shuffler)} is shuffling ${playerName(owner)}'s deck…`
                : `${playerName(shuffler)} shuffles ${playerName(owner)}'s deck next`;
          return (
            <div
              key={owner}
              className="absolute flex flex-col items-center gap-2"
              style={{
                left: spot.x - W / 2,
                top: spot.y - H / 2,
                width: W,
                transform: shrink ? "scale(0.45)" : "scale(1)",
                transition: motion ? `left ${FLY_MS}ms cubic-bezier(.3,.7,.3,1), top ${FLY_MS}ms cubic-bezier(.3,.7,.3,1), transform ${FLY_MS}ms ease` : "none",
              }}
            >
              <div
                ref={(el) => {
                  stack.current[owner] = el;
                }}
                onClick={canClick ? () => onShuffle(shuffler) : undefined}
                role={canClick ? "button" : undefined}
                tabIndex={canClick ? 0 : undefined}
                aria-label={label}
                onKeyDown={canClick ? (e) => (e.key === "Enter" || e.key === " ") && onShuffle(shuffler) : undefined}
                className={`relative ${canClick ? "pointer-events-auto cursor-pointer shuffle-ready" : ""}`}
                style={{ width: W, height: H }}
              >
                <SleeveBack css={sleeve(owner).css} edge={sleeve(owner).edge} className="h-full w-full shadow-[2px_-2px_0_rgba(0,0,0,0.55),4px_-4px_0_rgba(255,255,255,0.18),6px_-6px_0_rgba(0,0,0,0.45)]" />
              </div>
              <span
                // (the words say "click to shuffle": clicking them does it, like clicking the deck)
                onClick={canClick ? () => onShuffle(shuffler) : undefined}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold shadow-lg transition-opacity ${shrink ? "opacity-0" : "opacity-100"} ${canClick ? "pointer-events-auto cursor-pointer" : ""} ${canClick ? "border-amber-300 bg-amber-400 text-black" : "border-white/25 bg-slate-950/90 text-slate-100"}`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Whose turn it is to shuffle: the starting player first, then the other. */
function playerToShuffle(state: GameState): PlayerId | null {
  const s = state.opening?.shuffled;
  if (!s) return null;
  return [state.startingPlayer, OPPONENT[state.startingPlayer]].find((p) => !s[p]) ?? null;
}
