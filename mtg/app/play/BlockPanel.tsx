"use client";

import { gainedKeywords, getPossibleBlockers, powerOf } from "@mtg/engine";
import type { GameState, PlayerId } from "@mtg/engine";
import { COMBAT_BADGE } from "./CardView";
import { blockOutcome, canBlock } from "./combatHints";
import { playerName } from "./log";
import { nameWithStats, ptText } from "./stats";

/**
 * The blocking step, spelled out: what to click next, every attacker with whoever is blocking it, and what that block
 * is likely to lead to. Blocks are made by clicking: one of your creatures (on the board), then the attacker it should
 * block (on the board, or its row here). `blocks` maps blocker iid -> attacker iid.
 */
export default function BlockPanel({
  state,
  actor,
  blocks,
  picked,
  onChange,
  onPicked,
}: {
  state: GameState;
  actor: PlayerId;
  blocks: Record<string, string>;
  /** The creature clicked to block with, waiting for its attacker. */
  picked: string | null;
  onChange: (blocks: Record<string, string>) => void;
  onPicked: (iid: string | null) => void;
}) {
  const combat = state.combat;
  if (!combat || combat.attackers.length === 0) return null;
  const attackerPlayer = state.active;
  const find = (iid: string) => Object.values(state.players).flatMap((p) => p.battlefield).find((x) => x.card.iid === iid);
  const nameOf = (iid: string) => {
    const p = find(iid);
    return p ? nameWithStats(state, p) : iid;
  };
  const mine = getPossibleBlockers(state);

  const setBlock = (blocker: string, attacker: string | null) => {
    const next = { ...blocks };
    if (attacker) next[blocker] = attacker;
    else delete next[blocker];
    onChange(next);
  };

  let unblockedDamage = 0;
  for (const a of combat.attackers) {
    const perm = find(a.attacker);
    if (perm && !a.target && !Object.values(blocks).includes(a.attacker)) unblockedDamage += Math.max(0, powerOf(state, perm));
  }
  const life = state.players[actor].life;
  const step = picked
    ? null
    : mine.length === 0
      ? "You have no creature that can block."
      : combat.attackers.length === 1
        ? "Click one of your creatures to block with it. Click it again to take the block back."
        : "Click one of your creatures, then the attacker it should block. Click a blocker again to take it back.";

  return (
    <section data-block-panel className="flex flex-col gap-1.5 rounded-xl border border-sky-400/60 bg-sky-50 px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <h2 className="font-bold text-sky-900">🛡️ {playerName(attackerPlayer)} is attacking</h2>
        <span className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 font-semibold ${unblockedDamage >= life ? "bg-red-600 text-white" : "bg-white text-zinc-700"}`}>
            {unblockedDamage >= life ? "Lethal! " : ""}Unblocked: {unblockedDamage} dmg ({life} life)
          </span>
          {Object.keys(blocks).length > 0 && (
            <button onClick={() => onChange({})} className="rounded border border-zinc-400 bg-white px-2 py-0.5 hover:bg-zinc-100">
              Clear blocks
            </button>
          )}
        </span>
      </div>

      {picked ? (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-600 px-2 py-1 text-sm font-semibold text-white">
          🛡 Blocking with {nameOf(picked)}: now click the attacker it should block.
          <button onClick={() => onPicked(null)} className="rounded border border-white/60 px-2 py-0.5 text-xs font-normal hover:bg-white/15">
            Cancel
          </button>
        </p>
      ) : (
        <p className="text-sm text-sky-900 max-lg:text-xs">👆 {step}</p>
      )}

      <ul className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(17rem,1fr))]">
        {combat.attackers.map((a) => {
          const perm = find(a.attacker);
          if (!perm) return null;
          const def = state.cards[perm.card.defId];
          const assigned = Object.entries(blocks).filter(([, at]) => at === a.attacker).map(([b]) => b);
          const walker = a.target ? nameOf(a.target) : null;
          const legal = picked ? canBlock(state, actor, picked, a.attacker) : null;
          const outcome = assigned.length > 0 ? blockOutcome(state, perm, assigned.flatMap((b) => find(b) ?? [])) : null;
          return (
            <li key={a.attacker} className={`flex flex-col gap-1 rounded-lg border px-2 py-1.5 ${legal?.ok ? "border-sky-500 bg-white ring-2 ring-sky-400" : assigned.length ? "border-emerald-400 bg-white" : "border-red-300 bg-white"}`}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-sm font-semibold">{def.name}</span>
                <span className="rounded bg-zinc-900 px-1.5 text-xs font-bold text-white" title="Power / toughness now">
                  {ptText(state, perm)}
                </span>
                {[...(def.keywords ?? []), ...gainedKeywords(state, perm), ...(perm.tempKeywords ?? [])].map((k, i) => (
                  <span key={`${i}-${k}`} className="rounded bg-amber-100 px-1.5 text-xs capitalize text-amber-900">
                    {k}
                  </span>
                ))}
                {walker && <span className="text-zinc-500">→ {walker}</span>}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {assigned.length === 0 ? (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">{walker ? "Unblocked" : `Unblocked: −${Math.max(0, powerOf(state, perm))}`}</span>
                ) : (
                  assigned.map((b) => (
                    <span key={b} className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                      🛡 {nameOf(b)}
                      <button onClick={() => setBlock(b, null)} aria-label={`Stop blocking with ${nameOf(b)}`} className="rounded px-1 hover:bg-emerald-200">
                        ✕
                      </button>
                    </span>
                  ))
                )}
                {outcome && (
                  <span title={outcome.why} className={`rounded px-2 py-0.5 text-xs font-semibold ${COMBAT_BADGE[outcome.tone] ?? ""}`}>
                    {outcome.label}
                  </span>
                )}
              </div>

              {legal &&
                (legal.ok ? (
                  <button
                    onClick={() => {
                      setBlock(picked!, a.attacker);
                      onPicked(null);
                    }}
                    className="self-start rounded-lg bg-sky-600 px-3 py-1 text-sm font-semibold text-white hover:bg-sky-500"
                  >
                    🛡 Block this with {nameOf(picked!)}
                  </button>
                ) : (
                  <span className="text-xs text-zinc-500">{nameOf(picked!)} can&apos;t block this: {legal.reason}</span>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
