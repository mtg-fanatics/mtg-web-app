"use client";

import { legalTargets } from "@mtg/engine";
import type { GameState, PlayerId, TargetChoice, TargetSpec } from "@mtg/engine";
import { Help, targetKey, targetName } from "./cardText";
import { ManaText } from "./ManaSymbols";

/** Picks the targets one need at a time. `onDone` gets them all; `onCancel` is missing when a choice is forced. */
export function TargetPanel({
  state,
  controller,
  title,
  detail,
  cost,
  specs,
  chosen,
  aimed,
  onAim,
  onPick,
  onCancel,
}: {
  state: GameState;
  controller: PlayerId;
  title: string;
  /** What the ability does, shown under the title. */
  detail?: string;
  /** What was paid to use the ability (shown as a reminder). */
  cost?: string;
  specs: TargetSpec[];
  chosen: TargetChoice[];
  /** Clicked but not yet confirmed. */
  aimed: TargetChoice | null;
  onAim: (t: TargetChoice | null) => void;
  onPick: (t: TargetChoice) => void;
  onCancel?: () => void;
}) {
  const spec = specs[chosen.length];
  if (!spec) return null;
  const options = legalTargets(state, spec, controller);
  const aim = aimed && options.some((t) => targetKey(t) === targetKey(aimed)) ? aimed : null;
  // Anything on the battlefield is chosen by clicking the glowing card itself. The list only holds what has no card to click:
  // a player, a spell on the stack, a card in a graveyard, or "no target".
  const onBoard = (t: TargetChoice) => t.kind === "permanent" && Object.values(state.players).some((p) => p.battlefield.some((x) => x.card.iid === t.iid));
  const cardsToClick = options.some(onBoard);
  const listed = options.filter((t) => !onBoard(t));
  return (
    <section data-pick-board={cardsToClick && !aim ? "" : undefined} className="panel-in flex flex-col gap-2 rounded-lg border border-sky-500/50 bg-sky-50 p-3 max-lg:gap-1 max-lg:p-2">
      <h2 className="text-base font-semibold text-sky-800 max-lg:text-sm">
        {title}
        <span className="font-normal text-sky-700">
          {" "}
          — choose {spec.label}
          {specs.length > 1 ? ` (${chosen.length + 1}/${specs.length})` : ""}
        </span>
      </h2>
      {cost && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-sky-900">
          <span className="font-semibold">You pay:</span> <ManaText text={cost} />
        </p>
      )}
      {detail && (
        <div className="max-h-[7.5rem] overflow-y-auto rounded max-lg:hidden bg-white px-3 py-2 text-[15px] leading-relaxed text-zinc-800">
          <div className="mb-0.5 text-xs font-bold uppercase font-display tracking-wider text-sky-700">What it does</div>
          <p className="whitespace-pre-line">{detail}</p>
          <Help text={detail} max={3} large />
        </div>
      )}
      {cardsToClick && <p className="text-sm font-medium text-sky-800 max-lg:text-xs">👆 Click one of the glowing cards on the battlefield, then confirm it here.</p>}
      {aim && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-white px-3 py-2">
          <span className="text-sm text-zinc-800">
            🎯 <span className="font-semibold">{targetName(state, aim)}</span>
          </span>
          <button onClick={() => onPick(aim)} className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-amber-400">
            Confirm target
          </button>
          <button onClick={() => onAim(null)} className="rounded-lg border border-zinc-400 px-3 py-1.5 text-sm hover:bg-zinc-200">
            Change
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {listed.length > 0 && cardsToClick && <span className="text-sm text-zinc-600">Or choose:</span>}
        {listed.map((t, i) => (
          <button
            key={i}
            onClick={() => onAim(t)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${aim && targetKey(aim) === targetKey(t) ? "border-amber-500 bg-amber-100 ring-2 ring-amber-400" : "border-sky-400 bg-white hover:bg-sky-100"}`}
          >
            {targetName(state, t)}
          </button>
        ))}
        {onCancel && (
          <button onClick={onCancel} className="rounded-lg border border-zinc-400 px-3 py-1.5 text-sm hover:bg-zinc-200">
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
