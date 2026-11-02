"use client";

import { powerOf } from "@mtg/engine";
import type { GameState, Permanent, PlayerId } from "@mtg/engine";
import { useState } from "react";
import type { CastPlan } from "./castInfo";
import { ManaText } from "./ManaSymbols";
import { ChoicePanel, XPanel } from "./ChoicePanels";
import { isCreatureNow, nameWithStats } from "./stats";
import { paidPart } from "./cardText";

interface Props {
  state: GameState;
  actor: PlayerId;
  plan: CastPlan;
  modePick: number[];
  onModePick: (modes: number[]) => void;
  xValue: number;
  onX: (x: number) => void;
  onAdvance: (plan: CastPlan) => void;
  onCancel: () => void;
}

/** Teamwork: tap creatures with total power N or more as an additional cost (the spell then does more). */
function TeamworkPanel({ state, actor, plan, onAdvance, onCancel }: Pick<Props, "state" | "actor" | "plan" | "onAdvance" | "onCancel">) {
  const team = plan.castable.teamwork!;
  const [using, setUsing] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  if (!using) {
    return (
      <ChoicePanel
        title={`${plan.name} has teamwork ${team.n}`}
        options={[
          { label: "Cast it normally", onPick: () => onAdvance({ ...plan, teamwork: [] }) },
          { label: `Use teamwork: tap creatures with total power ${team.n} or more, and the spell does more`, onPick: () => setUsing(true) },
        ]}
        onCancel={onCancel}
      />
    );
  }
  const perms = team.options.map((iid) => state.players[actor].battlefield.find((p) => p.card.iid === iid)!);
  const total = picked.reduce((n, i) => n + Math.max(0, powerOf(state, perms[i])), 0);
  return (
    <ChoicePanel
      title={`Teamwork ${team.n}: choose creatures to tap (total power ${total} of ${team.n})`}
      options={perms.map((p) => ({ label: `${state.cards[p.card.defId].name} (power ${powerOf(state, p)})`, onPick: () => undefined }))}
      multi={{
        selected: picked,
        onToggle: (i) => setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i]),
        onDone: () => onAdvance({ ...plan, teamwork: picked.map((i) => perms[i].card.iid) }),
        canDone: total >= team.n,
      }}
      onCancel={onCancel}
    />
  );
}

/** Delve: graveyard cards to exile, each paying one generic mana. The cards best given up start out chosen. */
function DelvePanel({ state, actor, plan, onAdvance, onCancel }: Pick<Props, "state" | "actor" | "plan" | "onAdvance" | "onCancel">) {
  const delve = plan.castable.delve!;
  const [picked, setPicked] = useState<number[]>(() => delve.options.slice(0, delve.max).map((_, i) => i));
  const cards = delve.options.map((iid) => state.players[actor].graveyard.find((c) => c.iid === iid)!);
  return (
    <ChoicePanel
      title={`${plan.name} has delve: each card you exile from your graveyard pays one generic mana (${picked.length} chosen, ${delve.min > 0 ? `at least ${delve.min}, ` : ""}at most ${delve.max})`}
      options={cards.map((c) => ({ label: state.cards[c.defId].name, onPick: () => undefined }))}
      multi={{
        selected: picked,
        onToggle: (i) => setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : picked.length < delve.max ? [...picked, i] : picked),
        onDone: () => onAdvance({ ...plan, delve: picked.map((i) => cards[i].iid) }),
        canDone: picked.length >= delve.min,
      }}
      onCancel={onCancel}
    />
  );
}

/** Convoke: untapped creatures to tap, each paying for {1} or a mana of its color. */
function ConvokePanel({ state, actor, plan, onAdvance, onCancel }: Pick<Props, "state" | "actor" | "plan" | "onAdvance" | "onCancel">) {
  const convoke = plan.castable.convoke!;
  const [picked, setPicked] = useState<number[]>([]);
  const perms = convoke.options.map((iid) => state.players[actor].battlefield.find((p) => p.card.iid === iid)!);
  return (
    <ChoicePanel
      title={`${plan.name} has convoke: each creature you tap pays for {1} or one mana of its color (${picked.length} chosen${convoke.min > 0 ? `, at least ${convoke.min} needed` : ""})`}
      options={perms.map((p) => ({ label: nameWithStats(state, p), onPick: () => undefined }))}
      multi={{
        selected: picked,
        onToggle: (i) => setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : picked.length < convoke.max ? [...picked, i] : picked),
        onDone: () => onAdvance({ ...plan, convoke: picked.map((i) => perms[i].card.iid) }),
        canDone: picked.length >= convoke.min,
      }}
      onCancel={onCancel}
    />
  );
}

/** A card with an Adventure: cast the creature, or the Adventure spell beside it. */
function AdventurePanel({ plan, onAdvance, onCancel }: Pick<Props, "plan" | "onAdvance" | "onCancel">) {
  const [creature, spell] = plan.name.split(" // ");
  return (
    <ChoicePanel
      title={`${plan.name}: cast the creature, or its Adventure?`}
      options={[
        { label: `Cast ${creature}`, disabled: plan.castable.adventure, onPick: () => onAdvance({ ...plan, name: creature, adventure: false }) },
        { label: `Cast ${spell} (Adventure): afterwards the card goes into exile, and you may cast ${creature} from there later`, onPick: () => onAdvance({ ...plan, name: spell, castable: plan.adventureCastable!, adventure: true }) },
      ]}
      onCancel={onCancel}
    />
  );
}

/** Harmonize: tap a creature to pay {X} of the cost (X: its power), or pay it all with mana. */
function HarmonizePanel({ state, actor, plan, onAdvance, onCancel }: Pick<Props, "state" | "actor" | "plan" | "onAdvance" | "onCancel">) {
  const harmonize = plan.castable.harmonize!;
  return (
    <ChoicePanel
      title={`${plan.name}: harmonize — tap a creature to pay {X} of the cost, X being its power?`}
      options={[
        { label: "Don't tap a creature: pay the full cost", disabled: !harmonize.free, onPick: () => onAdvance({ ...plan, harmonizeTap: "" }) },
        ...harmonize.options.map((iid) => {
          const perm = state.players[actor].battlefield.find((p) => p.card.iid === iid)!;
          const power = powerOf(state, perm);
          return { label: <>Tap {state.cards[perm.card.defId].name}: <ManaText text={`{${power}}`} /> less</>, onPick: () => onAdvance({ ...plan, harmonizeTap: iid }) };
        }),
      ]}
      onCancel={onCancel}
    />
  );
}

const listed = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** Waterbend: what tapping pays and what's left for mana, a creature that then can't attack, and what paying it adds to the spell. */
function WaterbendPanel({ state, actor, plan, onAdvance, onCancel }: Pick<Props, "state" | "actor" | "plan" | "onAdvance" | "onCancel">) {
  const c = plan.castable;
  const me = state.players[actor];
  const taps = (c.waterbendTaps ?? []).map((iid) => me.battlefield.find((p) => p.card.iid === iid)).filter((p): p is Permanent => p !== undefined);
  const nameOf = (p: Permanent) => state.cards[p.card.defId].name;
  const rest = Number(/\d+/.exec(c.kicker ?? "")?.[0] ?? 0) - taps.length;
  const attackers = state.active === actor && state.phase === "main1" ? taps.filter((p) => isCreatureNow(state, p) && !p.summoningSick) : [];
  const card = [...me.hand, ...me.graveyard, ...me.exile].find((x) => x.iid === plan.iid);
  const extra = card ? paidPart(state.cards[card.defId].text ?? "") : null;
  const how =
    taps.length === 0 ? (
      <>, all with mana</>
    ) : (
      <>
        : tap {listed(taps.map(nameOf))} (<ManaText text="{1}" /> each){rest > 0 && <> and pay <ManaText text={`{${rest}}`} /> with mana</>}
      </>
    );
  return (
    <ChoicePanel
      title={`${plan.name}: you may waterbend ${c.kicker} (an additional cost)`}
      options={[
        { label: extra ? `Cast it normally, without: ${extra}` : "Cast it normally", onPick: () => onAdvance({ ...plan, kicked: false }) },
        {
          label: (
            <>
              Waterbend <ManaText text={c.kicker ?? ""} />
              {how}.{extra && <span className="block font-medium text-indigo-900">Then also: {extra}</span>}
              {attackers.length > 0 && <span className="block text-amber-800">⚠ {listed(attackers.map(nameOf))} can&apos;t attack this turn then.</span>}
            </>
          ),
          onPick: () => onAdvance({ ...plan, kicked: true }),
        },
      ]}
      onCancel={onCancel}
    />
  );
}

/** The question a spell being cast still needs answered, in order: creature or Adventure, modes, warp, the kicker (or offspring, or blight), X, delve, replicate, harmonize, then a creature to sacrifice or a card to discard. */
export default function CastPlanPanels({ state, actor, plan, modePick, onModePick, xValue, onX, onAdvance, onCancel }: Props) {
  const c = plan.castable;
  if (plan.adventureCastable && plan.adventure === undefined) return <AdventurePanel plan={plan} onAdvance={onAdvance} onCancel={onCancel} />;
  const teamworkDone = c.teamwork === undefined || plan.teamwork !== undefined;
  const modesDone = !c.modal || plan.modes !== undefined;
  const warpDone = c.warp === undefined || plan.warp !== undefined;
  const kickerDone = (c.kicker === undefined && !c.blight) || plan.kicked !== undefined;
  const xDone = c.maxX === undefined || plan.x !== undefined;

  if (!teamworkDone) return <TeamworkPanel state={state} actor={actor} plan={plan} onAdvance={onAdvance} onCancel={onCancel} />;
  if (c.modal && !modesDone) {
    const max = c.modal.bothIfKicked && (plan.teamwork?.length ?? 0) > 0 ? 2 : c.modal.max;
    return (
      <ChoicePanel
        title={`${plan.name}: choose ${max === 1 ? "one" : "one or both"}`}
        options={c.modal.modes.map((m, i) => ({
          label: <ManaText text={m.text} />,
          disabled: !m.available,
          onPick: () => onAdvance({ ...plan, modes: [i] }),
        }))}
        multi={
          max > 1
            ? {
                selected: modePick,
                onToggle: (i) => onModePick(modePick.includes(i) ? modePick.filter((x) => x !== i) : modePick.length < max ? [...modePick, i] : modePick),
                onDone: () => onAdvance({ ...plan, modes: [...modePick].sort((a, b) => a - b) }),
              }
            : undefined
        }
        onCancel={onCancel}
      />
    );
  }
  if (!warpDone) {
    return (
      <ChoicePanel
        title={`${plan.name} has warp`}
        options={[
          { label: "Cast it normally", disabled: c.warpOnly, onPick: () => onAdvance({ ...plan, warp: false }) },
          { label: <>Cast it for its warp cost <ManaText text={c.warp ?? ""} />: it is exiled at the next end step, and you may cast it from exile on a later turn</>, onPick: () => onAdvance({ ...plan, warp: true }) },
        ]}
        onCancel={onCancel}
      />
    );
  }
  if (!kickerDone && c.blight) {
    const counters = c.blight.n === 1 ? "a -1/-1 counter" : `${c.blight.n} -1/-1 counters`;
    return (
      <ChoicePanel
        title={`${plan.name}: you may blight ${c.blight.n} (an additional cost)`}
        options={[
          { label: "Cast it normally", onPick: () => onAdvance({ ...plan, kicked: false }) },
          { label: `Blight ${c.blight.n}: put ${counters} on a creature you control`, onPick: () => onAdvance({ ...plan, kicked: true }) },
        ]}
        onCancel={onCancel}
      />
    );
  }
  if (!kickerDone && c.kickerName === "waterbend") return <WaterbendPanel state={state} actor={actor} plan={plan} onAdvance={onAdvance} onCancel={onCancel} />;
  if (!kickerDone) {
    const offspring = c.kickerName === "offspring";
    const buyback = c.kickerName === "buyback";
    return (
      <ChoicePanel
        title={offspring ? `${plan.name} has offspring` : buyback ? `${plan.name} has buyback` : `${plan.name} has a kicker`}
        options={[
          { label: "Cast it normally", onPick: () => onAdvance({ ...plan, kicked: false }) },
          offspring
            ? { label: <>Pay offspring <ManaText text={c.kicker ?? ""} /> too: a 1/1 token copy enters with it</>, onPick: () => onAdvance({ ...plan, kicked: true }) }
            : buyback
              ? { label: <>Pay buyback <ManaText text={c.kicker ?? ""} /> too: it returns to your hand when it resolves</>, onPick: () => onAdvance({ ...plan, kicked: true }) }
              : { label: <>Cast it kicked, paying the extra <ManaText text={c.kicker ?? ""} /></>, onPick: () => onAdvance({ ...plan, kicked: true }) },
        ]}
        onCancel={onCancel}
      />
    );
  }
  if (c.blight && plan.kicked && plan.sacrifice === undefined) {
    return (
      <ChoicePanel
        title={`${plan.name}: choose a creature to blight`}
        options={c.blight.options.map((iid) => {
          const perm = state.players[actor].battlefield.find((p) => p.card.iid === iid)!;
          return { label: nameWithStats(state, perm), onPick: () => onAdvance({ ...plan, sacrifice: iid }) };
        })}
        onCancel={onCancel}
      />
    );
  }
  if (!xDone) {
    return <XPanel name={plan.name} max={c.maxX ?? 0} x={xValue} onChange={(x) => onX(Math.min(c.maxX ?? 0, Math.max(0, x)))} onCast={() => onAdvance({ ...plan, x: xValue })} onCancel={onCancel} />;
  }
  if (c.delve && plan.delve === undefined) return <DelvePanel state={state} actor={actor} plan={plan} onAdvance={onAdvance} onCancel={onCancel} />;
  if (c.convoke && plan.convoke === undefined) return <ConvokePanel state={state} actor={actor} plan={plan} onAdvance={onAdvance} onCancel={onCancel} />;
  if (c.replicate && c.replicate.max > 0 && plan.replicate === undefined) {
    const each = c.replicate.cost;
    return (
      <ChoicePanel
        title={`${plan.name}: replicate? Pay ${each} more for each copy; each copy gets a target of its own`}
        options={Array.from({ length: c.replicate.max + 1 }, (_, n) => ({
          label: n === 0 ? "No copies" : <>{n === 1 ? "1 copy" : `${n} copies`}: <ManaText text={each.repeat(n)} /> more</>,
          onPick: () => onAdvance({ ...plan, replicate: n }),
        }))}
        onCancel={onCancel}
      />
    );
  }
  if (c.harmonize && c.harmonize.options.length > 0 && plan.harmonizeTap === undefined) return <HarmonizePanel state={state} actor={actor} plan={plan} onAdvance={onAdvance} onCancel={onCancel} />;
  if (plan.sacrifice !== undefined) return null;
  // "Flashback—Sacrifice a Mountain": the permanent is the flashback cost, not an additional cost.
  if (c.sacrifice && c.zone === "graveyard") {
    return (
      <ChoicePanel
        title={`${plan.name}: choose a permanent to sacrifice (its flashback cost)`}
        options={c.sacrifice.map((iid) => {
          const perm = state.players[actor].battlefield.find((p) => p.card.iid === iid)!;
          return { label: `${state.cards[perm.card.defId].name}${perm.tapped ? " (tapped)" : ""}`, onPick: () => onAdvance({ ...plan, sacrifice: iid }) };
        })}
        onCancel={onCancel}
      />
    );
  }
  if (c.sacrifice) {
    return (
      <ChoicePanel
        title={`${plan.name}: choose a creature to sacrifice${c.orPay ? ", or pay the extra mana" : ""} (an additional cost)`}
        options={[
          ...c.sacrifice.map((iid) => {
            const perm = state.players[actor].battlefield.find((p) => p.card.iid === iid)!;
            return { label: nameWithStats(state, perm), onPick: () => onAdvance({ ...plan, sacrifice: iid }) };
          }),
          ...(c.orPay ? [{ label: <>Pay <ManaText text={c.orPay} /> instead</>, onPick: () => onAdvance({ ...plan, sacrifice: "pay" }) }] : []),
        ]}
        onCancel={onCancel}
      />
    );
  }
  if (c.discard) {
    return (
      <ChoicePanel
        title={`${plan.name}: choose a card to discard (an additional cost)`}
        options={c.discard.map((iid) => {
          const card = state.players[actor].hand.find((h) => h.iid === iid)!;
          return { label: state.cards[card.defId].name, onPick: () => onAdvance({ ...plan, sacrifice: iid }) };
        })}
        onCancel={onCancel}
      />
    );
  }
  return null;
}
