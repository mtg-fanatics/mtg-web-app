"use client";

import { useState } from "react";
import { manaSources } from "@mtg/engine";
import type { Action, GameState, PlayerId } from "@mtg/engine";
import { ManaSymbol, ManaText } from "./ManaSymbols";
import { cardNameAnywhere, costLabel, paymentOf } from "./castInfo";

/** What is being paid for, waiting for the player to pick the mana to pay with. */
export interface PayChoice {
  action: Action;
  as: PlayerId;
}

/**
 * Mana management: nothing is tapped for the player. Every spell and ability that costs mana asks which lands (or mana creatures, or floating
 * mana) to use. The player ticks exactly what they want to spend; "Pay" is available once that pays the cost with nothing left over.
 */
export function PayPanel({ state, choice, onPay, onCancel }: { state: GameState; choice: PayChoice; onPay: (spare: string[]) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const usable = manaSources(state, choice.as).filter((s) => !s.tapped && !s.sick);
  const spare = usable.map((s) => s.iid).filter((iid) => !picked.includes(iid));
  const check = picked.length > 0 ? paymentOf(state, choice.action, choice.as, spare) : { ok: false, life: 0, ask: [], made: [] };
  const used = new Set(check.made.map((m) => m.iid));
  const extra = check.ok ? picked.filter((iid) => !used.has(iid)) : [];
  const name = "iid" in choice.action && choice.action.iid ? cardNameAnywhere(state, choice.action.iid) : "this";
  const cost = costLabel(state, choice.action, choice.as);
  const label = (iid: string) => usable.find((s) => s.iid === iid)?.name ?? "a land";
  return (
    <section className="panel-in flex flex-col gap-2 rounded-lg border border-emerald-400/60 p-3 text-white" style={{ background: "#022c22", color: "#fff" }}>
      <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold" style={{ color: "#fff" }}>
        <span>Pay for {name}</span>
        {cost && (
          <span className="flex items-center gap-px rounded-full bg-black/40 px-2 py-0.5">
            <ManaText text={cost} />
          </span>
        )}
      </h2>
      <p className="text-sm" style={{ color: "#d1fae5" }}>Pick the mana to spend. Nothing is tapped for you.</p>
      <div className="flex flex-wrap gap-2">
        {usable.length === 0 && <span className="text-sm" style={{ color: "#e8d9b5" }}>You have no untapped mana.</span>}
        {usable.map((s) => {
          const on = picked.includes(s.iid);
          return (
            <button
              key={s.iid}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.iid) : [...p, s.iid]))}
              className={`flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold ${on ? "border-amber-300 bg-amber-400/25 ring-2 ring-amber-300" : "border-white/25 bg-white/10"}`}
            >
              <span aria-hidden="true">{on ? "☑" : "☐"}</span>
              <span className="flex items-center gap-px">
                {(s.colors.length === 5 ? ["W", "U", "B", "R", "G"] : s.colors).map((c) => (
                  <ManaSymbol key={c} symbol={c} />
                ))}
              </span>
              <span>{s.name}</span>
            </button>
          );
        })}
      </div>
      {picked.length > 0 && !check.ok && <p className="text-sm font-semibold" style={{ color: "#e8d9b5" }}>That is not enough mana of the right colors yet: pick more.</p>}
      {extra.length > 0 && <p className="text-sm font-semibold" style={{ color: "#e8d9b5" }}>That is more than the cost: untick {extra.map(label).join(", ")}.</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onPay(spare)} disabled={!check.ok || extra.length > 0} className="min-h-11 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 text-sm font-extrabold text-black disabled:opacity-40">
          Pay
        </button>
        <button onClick={onCancel} className="min-h-11 rounded-xl border border-white/30 px-4 text-sm font-semibold">
          Cancel
        </button>
      </div>
    </section>
  );
}
