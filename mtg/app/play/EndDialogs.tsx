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

// The emblem above the result: crossed swords on a shield for a win, a skull for a loss, two seals for a draw.
// Flat shapes only (no gradients or filters), so the screen costs next to nothing to draw.
const INK = "#1f1710";
const PAPER = "#e8dcc0";

function Sword({ rotate }: { rotate: number }) {
  return (
    <g transform={`rotate(${rotate} 48 52)`}>
      <path d="M48 6l5 9v46h-10V15z" fill="#d9d2c0" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M48 12v46" stroke="#a79f8a" strokeWidth="1.6" />
      <rect x="35" y="61" width="26" height="6" rx="2" fill="#8c6a3c" stroke={INK} strokeWidth="2.2" />
      <rect x="45" y="67" width="6" height="14" fill="#5a3a22" stroke={INK} strokeWidth="2" />
      <circle cx="48" cy="85" r="4.600" fill="#8c6a3c" stroke={INK} strokeWidth="2.2" />
    </g>
  );
}

function Emblem({ result }: { result: "win" | "lose" | "draw" }) {
  if (result === "win") {
    return (
      <svg viewBox="0 0 96 96" width="116" height="116" aria-hidden="true" className="victory-emblem">
        <path d="M48 8l30 10v28c0 18-13 30-30 38C31 76 18 64 18 46V18z" fill="#b3392b" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d="M48 15l23 7.500V46c0 14-10 24-23 30.500C35 70 25 60 25 46V22.500z" fill="none" stroke={PAPER} strokeOpacity=".55" strokeWidth="1.800" strokeDasharray="3.500 3" />
        <Sword rotate={-42} />
        <Sword rotate={42} />
        <circle cx="48" cy="52" r="5" fill="#e8dcc0" stroke={INK} strokeWidth="2.200" />
      </svg>
    );
  }
  if (result === "lose") {
    return (
      <svg viewBox="0 0 96 96" width="112" height="112" aria-hidden="true" className="victory-emblem">
        <path d="M48 10c-18 0-30 12-30 28 0 10 4 17 11 21v11c0 3 2 5 5 5h28c3 0 5-2 5-5V59c7-4 11-11 11-21 0-16-12-28-30-28z" fill={PAPER} stroke={INK} strokeWidth="3.200" strokeLinejoin="round" />
        <ellipse cx="35" cy="42" rx="8" ry="9.500" fill={INK} />
        <ellipse cx="61" cy="42" rx="8" ry="9.500" fill={INK} />
        <path d="M48 52l-5 10h10z" fill={INK} />
        <path d="M37 71v10M44 72v10M52 72v10M59 71v10" stroke={INK} strokeWidth="2.600" strokeLinecap="round" />
        <path d="M65 16l-5 10 6 5-4 9" fill="none" stroke="#7d2219" strokeWidth="2.400" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 96 64" width="112" height="75" aria-hidden="true" className="victory-emblem">
      <path d="M48 6v46M26 52h44M14 16h68" fill="none" stroke={INK} strokeWidth="3.400" strokeLinecap="round" />
      <path d="M14 16l-9 22h18zM82 16l-9 22h18z" fill="#4f7a62" stroke={INK} strokeWidth="2.600" strokeLinejoin="round" />
      <path d="M5 38c0 5 4 8 9 8s9-3 9-8M73 38c0 5 4 8 9 8s9-3 9-8" fill="none" stroke={INK} strokeWidth="2.600" />
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
        <div data-result={result} className={`victory-scroll ${spin ? "scroll-unroll" : ""}`}>
          <div aria-hidden="true" className="scroll-roll" />
          <div className="scroll-lower">
          <div className="scroll-body">
            <div className="scroll-sheet">
              <div className="scroll-inner">
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
              <button onClick={rematch.onAsk} className="btn-gold !px-7 !py-3 !text-base">
                Rematch
              </button>
            )}
            {rematch?.state === "sent" && (
              <button onClick={rematch.onCancel} className="btn-ghost !px-6 !py-3 !text-base">
                Cancel rematch
              </button>
            )}
            {rematch?.state === "incoming" && (
              <>
                <button onClick={rematch.onAccept} autoFocus className="btn-gold !px-7 !py-3 !text-base">
                  Accept
                </button>
                <button onClick={rematch.onDecline} className="btn-danger !px-6 !py-3 !text-base">
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
              <button onClick={onLeave} autoFocus={!series || series.decided} className="btn-gold victory-leave !px-7 !py-3 !text-base">
                Back to the front room
              </button>
            )}
          </div>
              </div>
            </div>
            <div aria-hidden="true" className="scroll-roll scroll-roll-bottom" />
          </div>
          </div>
        </div>
      </div>
    </>
  );
}
