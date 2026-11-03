"use client";

import type { ReactNode } from "react";
import type { PlayerId } from "@mtg/engine";
import { OPPONENT } from "@mtg/engine";
import { animationsEnabled } from "@/lib/motion";
import ConfirmDialog from "../ConfirmDialog";
import { playerName } from "./log";
import { Scribble } from "../Icons";

/** Asks before a player resigns. Resigning ends the game at once and the other player wins. */
export function ResignDialog({ player, onConfirm, onCancel }: { player: PlayerId; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog
      title={`${playerName(player)}, resign?`}
      message={`Resigning ends the game right now and ${playerName(OPPONENT[player])} wins.`}
      confirmLabel="Resign"
      cancelLabel="Keep playing"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

// The pictures on the result page: pen-and-ink, one stroke weight, a thin wash of the result's colour inside the lines.
// Crossed swords for a win, a snapped blade for a loss, a pair of scales for a draw. The stamp is the wax seal that presses in over the corner.
const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const WASH = { fill: "var(--accent)", fillOpacity: 0.2 } as const;

function Sword({ rotate }: { rotate: number }) {
  return (
    <g transform={`rotate(${rotate} 48 50)`}>
      <path d="M48 7.500l4.600 8.200.4 36.600h-10l.3-36.800z" {...WASH} stroke="none" />
      <path d="M48 7.500l4.600 8.200.4 36.600h-10l.3-36.800z" {...STROKE} />
      <path d="M48.200 17v31" {...STROKE} strokeWidth="1.400" strokeOpacity=".6" />
      <path d="M36.500 55.200c7-1.600 15-1.700 23 0" {...STROKE} />
      <path d="M48 56v12.500" {...STROKE} strokeWidth="3.400" />
      <circle cx="48" cy="72" r="3.200" {...STROKE} />
    </g>
  );
}

function Emblem({ result }: { result: "win" | "lose" | "draw" }) {
  const ragged = { filter: "url(#ink-rough-sm)", overflow: "visible" } as const;
  if (result === "win") {
    return (
      <svg viewBox="0 0 96 90" width="112" height="105" aria-hidden="true" className="victory-emblem" style={ragged}>
        <Sword rotate={-38} />
        <Sword rotate={38} />
      </svg>
    );
  }
  if (result === "lose") {
    return (
      <svg viewBox="8 22 82 66" width="120" height="97" aria-hidden="true" className="victory-emblem" style={ragged}>
        <g transform="rotate(-14 40 50)">
          <path d="M40 31.500l-3.600 4 3.400 3.200-3.500 3.800.3 11.300h9.600l.3-22.300z" {...WASH} stroke="none" />
          <path d="M40 31.500l-3.600 4 3.400 3.200-3.500 3.800.3 11.300h9.600l.3-22.300-2.800 2.600z" {...STROKE} />
          <path d="M29 55.200c7-1.600 15-1.700 23 0" {...STROKE} />
          <path d="M40.500 56v12.500" {...STROKE} strokeWidth="3.400" />
          <circle cx="40.500" cy="72" r="3.200" {...STROKE} />
        </g>
        <g transform="rotate(58 70 66)">
          <path d="M70 52l4.400 8-.4 14h-8l-.4-14z" {...WASH} stroke="none" />
          <path d="M70 52l4.400 8-.4 14h-8l-.4-14z" {...STROKE} />
        </g>
        <path d="M18 80c10-1.800 22-1.200 34 .2M62 82c7-.6 13-.4 19 .3" {...STROKE} strokeWidth="1.400" strokeOpacity=".55" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 96 90" width="112" height="105" aria-hidden="true" className="victory-emblem" style={ragged}>
      <path d="M48 14v52M30 70c10-1.500 26-1.500 36 0M17 25c20-3.200 42-3.200 62 .2" {...STROKE} />
      <path d="M17 25L8 48h18zM79 25l-9 23h18z" {...WASH} stroke="none" />
      <path d="M17 25L8 48h18zM79 25l-9 23h18z" {...STROKE} />
      <path d="M8 48c.4 6 4.600 9 9 9s8.600-3 9-9M70 48c.4 6 4.600 9 9 9s8.600-3 9-9" {...STROKE} />
    </svg>
  );
}

// The wax seal: an uneven blot of wax, a ring pressed into it, and the word in the same press.
const WAX = "M32 4c7 .1 10 3.600 16 5 6 1.400 9.500 5.500 10.300 12 .600 5 5.200 8.400 3.800 14.500-1.300 5.700-4.300 9.500-5.300 14.500-1.200 6-5.500 10.300-11.800 12.500-5.200 1.800-8.800 6-16 5.800-7-.2-10.600-4.200-15.800-6.200C7.500 53.400 3.800 49 2.800 43c-1-5.300-5.600-8.800-4-14.800C.100 22.600 4 19 5.400 13.800 7 8.200 11.300 5.300 17 4.200 24 2.800 25 3.900 32 4z";
function Stamp({ result }: { result: "win" | "lose" | "draw" }) {
  const word = result === "draw" ? "Drawn" : result === "lose" ? "Lost" : "Won";
  return (
    <svg viewBox="-2 -2 68 70" width="92" height="96" aria-hidden="true">
      <path d={WAX} fill="var(--seal)" stroke="var(--seal-edge)" strokeWidth="2" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="var(--seal-ink)" strokeOpacity=".6" strokeWidth="1.600" strokeDasharray="3 2.600" />
      <text x="32" y="38" textAnchor="middle" fontSize={word === "Drawn" ? 13.5 : 17} fill="var(--seal-ink)" style={{ fontFamily: "var(--font-fell), Georgia, serif" }}>{word}</text>
    </svg>
  );
}

/** Shown when the game ends: Victory, Defeat, or a Draw. */
export function VictoryDialog({
  winner,
  reason,
  you,
  onLeave,
  keep,
  rematch,
  series,
}: {
  winner: PlayerId | "draw";
  reason: string | null;
  /** Online: which player is looking at the screen. */
  you?: PlayerId;
  onLeave?: () => void;
  /** Buttons to keep the random decks that were played. */
  keep?: ReactNode;
  /** Online, best of 3 or 5: the score; while the series goes on there is a "Next game" button instead of a rematch. */
  series?: { bestOf: number; game: number; wins: Record<PlayerId, number>; decided: boolean; ready: PlayerId[]; you: PlayerId; opponent: string; onReady: () => void };
  /** Online: asking the other player for another game. */
  rematch?: { state: "none" | "sent" | "incoming"; opponent: string; onAsk: () => void; onCancel: () => void; onAccept: () => void; onDecline: () => void };
}) {
  const lost = you !== undefined && winner !== "draw" && winner !== you;
  const result = winner === "draw" ? "draw" : lost ? "lose" : "win";
  const title = result === "draw" ? "A draw" : result === "lose" ? "Defeated" : "Victory";
  const spin = animationsEnabled();
  return (
    <>
      <div role="dialog" aria-modal="true" aria-label={result === "win" ? "You win" : result === "lose" ? "You lost" : "Draw"} className="victory-backdrop">
        <div data-result={result} className={`result-page ${spin ? "result-settle" : ""}`}>
          <div aria-hidden="true" className="result-shadow" />
          <div className="result-sheet">
            <div className="result-inner">
          <div className="victory-medal"><Emblem result={result} /></div>
          <h2 className="victory-title">{title}</h2>
          <Scribble width={200} className="victory-rule" />
          <p className="victory-sub">{result === "draw" ? "Neither hand takes this one." : result === "lose" ? `${playerName(winner as PlayerId)} takes this one. The ink dries; there is always another game.` : `The table is yours, ${playerName(winner as PlayerId)}.`}</p>
          {reason && <p className="victory-reason">{reason}</p>}
          {series && (
            <p className="victory-reason">
              {series.decided
                ? `${series.wins[series.you] > series.wins[OPPONENT[series.you]] ? "You won" : "You lost"} the best of ${series.bestOf}: ${series.wins[series.you]} – ${series.wins[OPPONENT[series.you]]}`
                : `Game ${series.game} of up to ${series.bestOf}. Score: you ${series.wins[series.you]} – ${series.wins[OPPONENT[series.you]]} ${series.opponent}`}
            </p>
          )}
          {keep}
          {rematch?.state === "incoming" && (
            <p role="status" className="victory-reason">
              {rematch.opponent} wants a rematch.
            </p>
          )}
          {rematch?.state === "sent" && (
            <p role="status" className="victory-reason">
              Rematch asked. Waiting for {rematch.opponent} to answer…
            </p>
          )}
          <div className="victory-actions">
            {rematch?.state === "none" && (
              <button onClick={rematch.onAsk} autoFocus className="btn-gold !px-7 !py-3 !text-base">
                Rematch
              </button>
            )}
            {rematch?.state === "sent" && (
              <button onClick={rematch.onCancel} className="btn-ghost result-quiet !px-6 !py-3 !text-base">
                Cancel rematch
              </button>
            )}
            {rematch?.state === "incoming" && (
              <>
                <button onClick={rematch.onAccept} autoFocus className="btn-gold !px-7 !py-3 !text-base">
                  Accept
                </button>
                <button onClick={rematch.onDecline} className="btn-ghost result-quiet !px-6 !py-3 !text-base">
                  Reject
                </button>
              </>
            )}
            {series && !series.decided && (
              series.ready.includes(series.you) ? (
                <p role="status" className="victory-reason">Waiting for {series.opponent} to be ready…</p>
              ) : (
                <button onClick={series.onReady} autoFocus className="btn-gold !px-7 !py-3 !text-base">
                  Next game
                </button>
              )
            )}
            {onLeave && (
              <button onClick={onLeave} autoFocus={(!series || series.decided) && rematch?.state !== "none"} className={`!px-7 !py-3 !text-base ${rematch?.state === "none" || rematch?.state === "incoming" || (series && !series.decided) ? "btn-ghost result-quiet" : "btn-gold"}`}>
                Back to the front room
              </button>
            )}
            </div>
            </div>
          </div>
          <div aria-hidden="true" className={`result-stamp ${spin ? "result-stamp-press" : ""}`}><Stamp result={result} /></div>
        </div>
      </div>
    </>
  );
}
