"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OPPONENT } from "@mtg/engine";
import type { PlayerId } from "@mtg/engine";
import type { CoinScene } from "./coin3d";
import { playerName } from "./log";

type Side = "heads" | "tails";
type Stage = "call" | "flipping" | "result";

// Used only by the flat fallback coin (browsers without WebGL).
const HEADS_ANGLE = 360 * 6;
const TAILS_ANGLE = HEADS_ANGLE + 180;
const FLAT_FLIP_MS = 2200;

/**
 * Rule 103.1: the players agree how to decide who chooses the first turn. Here the caller picks
 * heads or tails, the coin is flipped, and whoever wins chooses to go first or second.
 */
export default function CoinFlip({
  caller,
  onDone,
  onBack,
}: {
  caller: PlayerId;
  onDone: (first: PlayerId, summary: string) => void;
  onBack: () => void;
}) {
  const [stage, setStage] = useState<Stage>("call");
  const [call, setCall] = useState<Side | null>(null);
  const [result, setResult] = useState<Side | null>(null);
  const [use3d, setUse3d] = useState(true);
  const [angle, setAngle] = useState(0); // flat fallback coin only

  const landed = useCallback(() => setStage("result"), []);
  const no3d = useCallback(() => setUse3d(false), []);

  // Safety net: never leave the players staring at a coin that has stopped moving.
  useEffect(() => {
    if (stage !== "flipping") return;
    const timer = setTimeout(() => setStage("result"), use3d ? 8000 : FLAT_FLIP_MS + 300);
    return () => clearTimeout(timer);
  }, [stage, use3d]);

  function flip(choice: Side) {
    const outcome: Side = Math.random() < 0.5 ? "heads" : "tails";
    setCall(choice);
    setResult(outcome);
    setStage("flipping");
    // Flat fallback: wait two frames so the coin is drawn at 0 degrees first, then the spin runs.
    requestAnimationFrame(() => requestAnimationFrame(() => setAngle(outcome === "heads" ? HEADS_ANGLE : TAILS_ANGLE)));
  }

  const winner = call && result ? (call === result ? caller : OPPONENT[caller]) : null;
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-4 p-5 text-slate-100 sm:p-8">
      <div className="page-atmosphere" aria-hidden="true" />
      <div className="panel-glass flex w-full max-w-2xl flex-col items-center gap-4 px-6 py-8 text-center sm:px-10">
        <h1 className="page-title !text-3xl sm:!text-4xl">Coin flip</h1>
        <p className="text-sm uppercase tracking-[0.25em] text-slate-300">Who goes first?</p>

        <div className="relative flex items-center justify-center">
          <div className="pointer-events-none absolute inset-x-6 bottom-6 top-10 rounded-full bg-[radial-gradient(closest-side,rgba(244,180,61,0.28),transparent)]" aria-hidden="true" />
          {use3d ? <Coin3D result={result} flipping={stage === "flipping"} onLanded={landed} onUnavailable={no3d} /> : <FlatCoin stage={stage} angle={angle} />}
        </div>

        {stage === "call" && (
          <>
            <p className="text-slate-200">
              <span className="font-bold text-[#e8dcc0]">{playerName(caller)}</span>, call it. The winner chooses who goes first.
            </p>
            <div className="flex gap-3">
              <button onClick={() => flip("heads")} className="btn-gold !px-8 !py-3 !text-base">
                Heads
              </button>
              <button onClick={() => flip("tails")} className="btn-gold !px-8 !py-3 !text-base">
                Tails
              </button>
            </div>
            <button onClick={onBack} className="btn-ghost !text-sm">
              ← Back to deck choice
            </button>
          </>
        )}

        {stage === "flipping" && (
          <p className="text-slate-200">
            {playerName(caller)} called <span className="font-bold capitalize text-[#e8dcc0]">{call}</span>…
          </p>
        )}

        {stage === "result" && winner && call && result && (
          <>
            <p className="text-xl">
              It&apos;s <span className="font-bold capitalize text-[#e8dcc0]">{result}</span>! {playerName(caller)} called {call}, so <span className="font-bold text-[#e8dcc0]">{playerName(winner)}</span> wins the flip.
            </p>
            <p className="text-slate-300">{playerName(winner)}, who goes first?</p>
            <div className="flex gap-3">
              {([true, false] as const).map((goFirst) => (
                <button
                  key={String(goFirst)}
                  onClick={() =>
                    onDone(
                      goFirst ? winner : OPPONENT[winner],
                      `${playerName(caller)} called ${call}; it landed ${result}. ${playerName(winner)} won the flip and chose to go ${goFirst ? "first" : "second"}.`,
                    )
                  }
                  className={`${goFirst ? "btn-gold" : "btn-ghost"} !px-8 !py-3 !text-base`}
                >
                  Go {goFirst ? "first" : "second"}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/** The real 3D coin (three.js, loaded only when this screen opens). Tells the parent if WebGL isn't available. */
function Coin3D({
  result,
  flipping,
  onLanded,
  onUnavailable,
  className = "h-[28rem] w-[min(32rem,92vw)]",
}: {
  result: Side | null;
  flipping: boolean;
  onLanded: () => void;
  onUnavailable: () => void;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<CoinScene | null>(null);
  const request = useRef<{ result: Side; onLanded: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("./coin3d")
      .then(({ createCoinScene }) => {
        if (cancelled || !canvas.current) return;
        try {
          scene.current = createCoinScene(canvas.current);
        } catch {
          onUnavailable(); // no WebGL
          return;
        }
        // The flip may have been requested while three.js was still loading.
        if (request.current) scene.current.flip(request.current.result, request.current.onLanded);
      })
      .catch(onUnavailable);
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [onUnavailable]);

  useEffect(() => {
    if (!flipping || !result) return;
    request.current = { result, onLanded };
    scene.current?.flip(result, onLanded);
  }, [flipping, result, onLanded]);

  return <canvas ref={canvas} className={className} aria-label="A coin" />;
}

/** Fallback for browsers without WebGL: a flat coin that spins with CSS. */
function FlatCoin({ stage, angle }: { stage: Stage; angle: number }) {
  return (
    <div className="coin-scene">
      <div className={`coin-shadow ${stage === "flipping" ? "is-flipping" : ""}`} />
      <div className={`coin-air ${stage === "flipping" ? "is-flipping" : ""}`}>
        <div className={`coin-wobble ${stage === "flipping" ? "is-flipping" : ""}`}>
          <div
            className="coin"
            style={{
              transform: `rotateX(${angle}deg)`,
              transition: stage === "call" ? "none" : `transform ${FLAT_FLIP_MS}ms cubic-bezier(0.25, 0.6, 0.3, 1)`,
            }}
          >
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="coin-edge" style={{ transform: `translateZ(${i - 4}px)` }} />
            ))}
            <div className="coin-face coin-heads">
              <span className="text-5xl">H</span>
              <span className="text-sm uppercase font-display tracking-widest">Heads</span>
            </div>
            <div className="coin-face coin-tails">
              <span className="text-5xl">T</span>
              <span className="text-sm uppercase font-display tracking-widest">Tails</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The coin on its own, for pop-ups: it flips at once towards a result that is already decided (online, the server flips it)
 * and tells the parent when it has landed. Uses the 3D coin, or the flat one where WebGL is not available.
 */
export function CoinDisplay({ result, onLanded, className }: { result: Side; onLanded: () => void; className?: string }) {
  const [use3d, setUse3d] = useState(true);
  const [angle, setAngle] = useState(0);
  const no3d = useCallback(() => setUse3d(false), []);

  useEffect(() => {
    // The flat coin spins to its result and reports; the 3D coin reports by itself, so this is only the safety net for both.
    const frame = use3d ? 0 : requestAnimationFrame(() => requestAnimationFrame(() => setAngle(result === "heads" ? HEADS_ANGLE : TAILS_ANGLE)));
    const timer = setTimeout(onLanded, use3d ? 8000 : FLAT_FLIP_MS + 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [use3d, result, onLanded]);

  return use3d ? <Coin3D result={result} flipping onLanded={onLanded} onUnavailable={no3d} className={className} /> : <FlatCoin stage="flipping" angle={angle} />;
}
