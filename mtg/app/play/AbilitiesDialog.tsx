"use client";

import { getCastable } from "@mtg/engine";
import type { Action, Activatable, GameState, LoyaltyOption, PlayerId } from "@mtg/engine";
import { abilityWarnings, lockedAbilities } from "./abilityInfo";
import type { abilityList } from "./abilityInfo";
import { preparedSpell } from "./castInfo";
import type { CastPlan } from "./castInfo";
import { AbilityPanel } from "./AbilityPanel";
import { CardParts } from "./CardParts";
import { cardParts } from "./abilityParts";

interface Props {
  state: GameState;
  actor: PlayerId;
  list: ReturnType<typeof abilityList>;
  onClose: () => void;
  onAct: (action: Action) => void;
  onAbility: (a: Activatable) => void;
  onLoyalty: (a: LoyaltyOption) => void;
  onCast: (plan: CastPlan) => void;
  /** Opened from a card on the battlefield: only that card's abilities. */
  only?: string;
}

/** The abilities pop-up: everything that can be used right now, and what can't yet and why. Choosing one closes it. */
export default function AbilitiesDialog({ state, actor, list, onClose, onAct, onAbility, onLoyalty, onCast, only }: Props) {
  const closing =
    <T,>(run: (value: T) => void) =>
    (value: T) => {
      onClose();
      run(value);
    };

  function castFromZone(iid: string) {
    const castable = getCastable(state, actor).find((c) => c.iid === iid && (c.zone === "graveyard" || c.zone === "exile" || c.zone === "prepared"));
    const card = [...state.players[actor].graveyard, ...state.players[actor].exile].find((x) => x.iid === iid);
    const name = castable?.zone === "prepared" ? preparedSpell(state, actor, iid)?.spell.name : card && state.cards[card.defId].name.split(" // ")[0]; // a two-part card is cast as its creature
    if (castable && name) onCast({ iid, name, from: castable.zone as "graveyard" | "exile" | "prepared", castable });
  }

  const focusedDef = only ? state.cards[[...state.players.p1.battlefield, ...state.players.p2.battlefield].find((p) => p.card.iid === only)?.card.defId ?? ""] : undefined;
  const focused = focusedDef && cardParts(focusedDef).some((p) => p.kind !== "activated" && p.kind !== "spell" && p.kind !== "cost") ? focusedDef : undefined;

  return (
    <div role="dialog" aria-modal="true" aria-label="Abilities" className="sheet fixed inset-0 z-30 flex items-start justify-center bg-black/40 p-4 pt-24" onClick={onClose}>
      <div className="flex max-h-[80dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold uppercase font-display tracking-wide text-emerald-800">⚡ {only ? (focusedDef?.name ?? "Abilities") : "Abilities"}</h2>
            <p className="text-sm text-zinc-600">Pick one. The cost is shown first, then what it does. {only ? "" : "Tip: click a glowing card on the battlefield to see just its abilities."}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full border border-zinc-300 px-3 leading-7 hover:bg-zinc-100">
            ✕
          </button>
        </div>
        <AbilityPanel
          state={state}
          abilities={list.abilities}
          onUse={closing(onAbility)}
          cycles={list.cycles}
          onCycle={closing((iid: string) => onAct({ type: "cycle", iid }))}
          crews={list.crews}
          onCrew={closing((iid: string) => onAct({ type: "crew", iid }))}
          loyalty={list.loyalty}
          onLoyalty={closing(onLoyalty)}
          plots={list.plots}
          onPlot={closing((iid: string) => onAct({ type: "plot", iid }))}
          locked={lockedAbilities(state, actor)}
          warnings={abilityWarnings(state, actor)}
          only={only}
          flashbacks={list.flashbacks}
          exileLands={list.exileLands}
          onPlayLand={closing((iid: string) => onAct({ type: "playLand", iid }))}
          onFlashback={closing(castFromZone)}
        />
        {focused && (
          <section className="flex flex-col gap-2 rounded-lg border border-violet-300 bg-violet-50 p-3">
            <h3 className="text-sm font-semibold uppercase font-display tracking-wide text-violet-700">Its other abilities: these aren&apos;t clicked</h3>
            <CardParts def={focused} skip={["activated", "spell", "cost"]} />
          </section>
        )}
      </div>
    </div>
  );
}
