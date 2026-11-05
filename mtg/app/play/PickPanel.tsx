"use client";

import { useState } from "react";
import type { CardDef, GameState } from "@mtg/engine";
import CardView from "./CardView";
import { ManaText } from "./ManaSymbols";
import { playerName } from "./log";
import { liveCardProps } from "./stats";

/** A choice among cards (which to discard, which to keep, which land to fetch, the order of the library). */
type PickKind = NonNullable<GameState["pendingPick"]>["kind"];

const CONFIRM: Partial<Record<PickKind, (name: string) => string>> = {
  discard: (n) => `Discard ${n}`,
  rummage: (n) => `Discard ${n}`,
  bounceOwn: (n) => `Return ${n}`,
  sacrificeOwn: (n) => `Sacrifice ${n}`,
  tapSome: (n) => `Tap ${n}`,
  crew: (n) => `Tap ${n}`,
  toHand: (n) => `Take ${n}`,
  searchLand: (n) => `Take ${n}`,
  searchAny: (n) => `Take ${n}`,
  revealToHand: (n) => `Take ${n}`,
  handExile: (n) => `Exile ${n}`,
  exileToPlay: (n) => `Exile ${n}`,
  playExile: (n) => `Exile ${n}: play it this turn`,
  keepTop: (n) => `Keep ${n} on top`,
  mayCost: (n) => `Sacrifice or discard ${n}`,
  discardDraw: (n) => `Discard ${n}`,
  fromYard: (n) => `Return ${n}`,
  legend: (n) => `Keep ${n}`,
  handToField: (n) => `Put ${n} onto the battlefield`,
  scry: (n) => `Put ${n} on the bottom`,
  surveil: (n) => `Put ${n} into the graveyard`,
};

interface PickProps {
  state: GameState;
  onPick: (iid?: string) => void;
  onZoom: (def: CardDef) => void;
  onPreview?: (def: CardDef, el: HTMLElement) => void;
  onUnpreview?: () => void;
}

/** A choice the game is waiting for (discard a card, scry, search...), in a dialog in front of the board so it can't be missed. */
export function PickPanel(props: PickProps) {
  const pick = props.state.pendingPick;
  if (!pick) return null;
  return (
    <PickDialog key={`${pick.kind}:${pick.options.join()}`} title={pick.source ? `${pick.source.name}: ${pick.prompt}` : pick.prompt}>
      <PickChoice {...props} />
    </PickDialog>
  );
}

/** "See the board" tucks the dialog away into a button, for a look at the battlefield before choosing. */
function PickDialog({ title, children }: { title: string; children: React.ReactNode }) {
  const [tucked, setTucked] = useState(false);
  if (tucked)
    return (
      <button
        onClick={() => setTucked(false)}
        className="fixed bottom-4 left-1/2 z-30 max-w-[calc(100vw-2rem)] -translate-x-1/2 truncate rounded-full border-2 border-rose-400 bg-rose-50 px-5 py-2 text-sm font-bold text-rose-800 shadow-2xl shadow-black/40 hover:bg-rose-100"
      >
        ✋ {title}: choose
      </button>
    );
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="sheet game-modal fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-2 overflow-y-auto">
        <button onClick={() => setTucked(true)} className="self-end rounded-full border border-white/30 bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20">
          👁 See the board
        </button>
        <div className="shadow-2xl shadow-black/50">{children}</div>
      </div>
    </div>
  );
}

function PickChoice({ state, onPick, onZoom, onPreview, onUnpreview }: PickProps) {
  const [selected, setSelected] = useState<string | null>(null); // a clicked card waits for the Confirm button
  const pick = state.pendingPick;
  if (!pick) return null;
  const owner = state.players[pick.owner];
  // (learn reaches into the sideboard; a few effects return a card from the graveyard)
  const sideboard = new Set((owner.sideboard ?? []).map((c) => c.iid));
  const cards = pick.options.flatMap((iid) => {
    const card = [...owner.hand, ...owner.library, ...owner.battlefield.map((p) => p.card), ...owner.graveyard, ...(owner.sideboard ?? [])].find((c) => c.iid === iid);
    return card ? [card] : [];
  });
  // A permanent to choose (to tap, return, keep...) is shown as it is now: power, toughness, counters, damage.
  const onField = (iid: string) => owner.battlefield.find((p) => p.card.iid === iid);
  if (pick.kind === "color") {
    const names: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
    return (
      <section className="panel-in flex flex-col gap-2 rounded-lg border border-rose-500/50 bg-rose-50 p-3">
        <PickHeader state={state} onZoom={onZoom} />
        <div className="flex flex-wrap gap-2">
          {pick.options.map((o) => (
            <button key={o} onClick={() => onPick(o)} className="flex items-center gap-2 rounded-lg border border-rose-400 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-rose-100">
              <ManaText text={`{${o}}`} /> {names[o] ?? o}
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (pick.kind === "ward" || pick.kind === "mode" || pick.kind === "mayPay" || pick.kind === "tax" || pick.kind === "toggle" || pick.kind === "topBottom" || pick.kind === "creatureType") {
    return (
      <section className="panel-in flex flex-col gap-2 rounded-lg border border-rose-500/50 bg-rose-50 p-3">
        <PickHeader state={state} onZoom={onZoom} />
        <div className="flex flex-wrap gap-2">
          {(pick.kind === "ward" || pick.kind === "mayPay" || pick.kind === "tax") && (
            <button onClick={() => onPick("pay")} className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-amber-400">
              {pick.wardCost || pick.payLife ? (
                <>
                  Pay <ManaText text={pick.wardCost ?? ""} />
                  {pick.payLife ? `${pick.wardCost ? " and " : ""}${pick.payLife} life` : ""}
                </>
              ) : (
                "Yes"
              )}
            </button>
          )}
          {(pick.kind === "toggle" || pick.kind === "topBottom" || pick.kind === "creatureType") &&
            pick.options.map((o) => (
              <button key={o} onClick={() => onPick(o)} className="rounded-lg border border-rose-400 bg-white px-4 py-1.5 text-sm font-semibold capitalize hover:bg-rose-100">
                {pick.kind === "topBottom" ? `Put it on the ${o}` : o}
              </button>
            ))}
          {pick.kind === "mode" &&
            pick.options.map((o) => (
              <button key={o} onClick={() => onPick(o)} className="rounded-lg border border-rose-400 bg-white px-3 py-1.5 text-left text-sm hover:bg-rose-100">
                <ManaText text={pick.modes?.[Number(o)]?.text ?? o} />
              </button>
            ))}
          {pick.optional && (
            <button onClick={() => onPick(undefined)} className="rounded-lg border border-zinc-400 px-3 py-1.5 text-sm hover:bg-zinc-200">
              {pick.kind === "tax" ? "Don't pay (they draw)" : pick.kind === "toggle" ? "Do nothing" : !pick.wardCost && !pick.payLife ? "No" : "Don't pay"}
            </button>
          )}
        </div>
      </section>
    );
  }
  const chosen = cards.find((c) => c.iid === selected);
  const confirm = (iid?: string) => {
    setSelected(null);
    onUnpreview?.(); // the card under the mouse goes away without a mouseleave
    onPick(iid);
  };
  const preview = (def: CardDef) => ({ onMouseEnter: (e: React.MouseEvent<HTMLElement>) => onPreview?.(def, e.currentTarget), onMouseLeave: () => onUnpreview?.() });
  return (
    <section className="panel-in flex flex-col gap-2 rounded-lg border border-rose-500/50 bg-rose-50 p-3">
      <PickHeader state={state} onZoom={onZoom} />
      <div className="flex flex-wrap gap-2">
        {cards.map((c) => (
          <div key={c.iid} className="shrink-0" {...preview(state.cards[c.defId])}>
            <CardView
              def={state.cards[c.defId]}
              {...(onField(c.iid) ? liveCardProps(state, onField(c.iid)!) : {})}
              size="md"
              ring={c === chosen ? "ring-4 ring-amber-400" : "ring-2 ring-rose-400"}
              onClick={() => setSelected(c === chosen ? null : c.iid)}
              onZoom={() => onZoom(state.cards[c.defId])}
            />
            {pick.kind === "learn" && <div className="mt-0.5 text-center text-[11px] font-semibold text-rose-700">{sideboard.has(c.iid) ? "Sideboard Lesson" : "In your hand"}</div>}
          </div>
        ))}
      </div>
      {/* The other cards that were looked at are shown too, so the player can see what goes to the bottom. */}
      {/* Looking at a hand: the cards that can't be taken (its lands) are shown too. */}
      {(pick.seen ?? []).length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase font-display tracking-wide text-zinc-500">Also in that hand (can&apos;t be taken)</span>
          <div className="flex flex-wrap gap-2">
            {(pick.seen ?? [])
              .flatMap((id) => owner.hand.filter((c) => c.iid === id))
              .map((c) => (
                <div key={c.iid} className="shrink-0" {...preview(state.cards[c.defId])}>
                  <CardView def={state.cards[c.defId]} dim onZoom={() => onZoom(state.cards[c.defId])} />
                </div>
              ))}
          </div>
        </div>
      )}
      {pick.kind === "revealToHand" && (pick.bottomIids ?? []).some((id) => !pick.options.includes(id)) && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase font-display tracking-wide text-zinc-500">Also looked at (can&apos;t be taken)</span>
          <div className="flex flex-wrap gap-2">
            {(pick.bottomIids ?? [])
              .filter((id) => !pick.options.includes(id))
              .flatMap((id) => owner.library.filter((c) => c.iid === id))
              .map((c) => (
                <div key={c.iid} className="shrink-0" {...preview(state.cards[c.defId])}>
                  <CardView def={state.cards[c.defId]} dim onZoom={() => onZoom(state.cards[c.defId])} />
                </div>
              ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* Only looking (Mishra's Bauble): there is nothing to choose, just a button to go on. */}
        {pick.kind !== "look" && (
          <button
            onClick={() => chosen && confirm(chosen.iid)}
            disabled={!chosen}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {chosen ? confirmLabel(pick, state.cards[chosen.defId].name, sideboard.has(chosen.iid), onField(chosen.iid) !== undefined) : "Click a card, then confirm"}
          </button>
        )}
        {pick.optional && (
          <button onClick={() => confirm(undefined)} className="rounded-lg border border-zinc-400 px-3 py-1.5 text-sm hover:bg-zinc-200">
            {declineLabel(pick)}
          </button>
        )}
      </div>
    </section>
  );
}

type Pick = NonNullable<GameState["pendingPick"]>;

function confirmLabel(pick: Pick, name: string, fromSideboard: boolean, onField: boolean): string {
  if (pick.kind === "learn") return fromSideboard ? `Put ${name} into your hand` : `Discard ${name}, then draw a card`;
  if (pick.kind === "mayCost") return onField ? `Sacrifice ${name}` : `Discard ${name}`;
  return (CONFIRM[pick.kind] ?? ((n: string) => `Choose ${n}`))(name);
}

function declineLabel(pick: Pick): string {
  const n = pick.ordered.length;
  if (pick.kind === "discardDraw") return n > 0 ? `Stop: draw ${n === 1 ? "a card" : `${n} cards`}` : "Don't discard";
  if (pick.kind === "mayCost" && pick.remaining > 1) return n > 0 ? "Stop: sacrifice none" : "Don't";
  if (pick.kind === "learn") return "Don't learn";
  if (pick.kind === "searchLand" || pick.kind === "searchAny") return "Don't search";
  if (pick.kind === "crew") return "Cancel";
  if (pick.kind === "scry" || pick.kind === "surveil") return "Keep the rest on top";
  if (pick.kind === "revealToHand") return "Take nothing";
  if (pick.kind === "rummage" || pick.kind === "discard") return "Don't discard";
  if (pick.kind === "tapSome") return "Done";
  if (pick.kind === "handExile") return "Exile nothing";
  if (pick.kind === "mayCost") return "Don't";
  if (pick.kind === "handToField") return pick.elseDraw ? "Don't: draw a card instead" : "Don't";
  if (pick.kind === "look") return "OK, leave it on top";
  return "No, leave it";
}

/** The card a choice comes from, found wherever it is now (a resolving spell is already in the graveyard). */
function sourceDef(state: GameState): CardDef | null {
  if (state.pendingPick?.source?.defId) return state.cards[state.pendingPick.source.defId] ?? null;
  // an ability of a card in the graveyard or exile (paradigm) has no permanent to name it by
  const iid = state.pendingPick?.source?.iid ?? state.pendingChoice?.item.source;
  if (!iid) return null;
  const card = Object.values(state.players)
    .flatMap((p) => [...p.battlefield.map((x) => x.card), ...p.graveyard, ...p.exile])
    .find((c) => c.iid === iid);
  return card ? (state.cards[card.defId] ?? null) : null;
}

/** What a choice is for: the card it comes from and its text, then the question. */
function PickHeader({ state, onZoom }: { state: GameState; onZoom: (def: CardDef) => void }) {
  const pick = state.pendingPick!;
  const def = sourceDef(state);
  return (
    <div className="flex items-start gap-3">
      {def && <CardView def={def} onZoom={() => onZoom(def)} />}
      <div className="min-w-0">
        {pick.source && <div className="text-[11px] font-semibold uppercase font-display tracking-wide text-rose-700">Resolving {pick.source.name}</div>}
        <h2 className="text-sm font-semibold text-rose-800">
          {playerName(pick.player)}: {pick.prompt}
        </h2>
        {def?.text && (
          <p className="mt-1 whitespace-pre-line text-[13px] leading-snug text-zinc-700">
            <ManaText text={def.text} />
          </p>
        )}
      </div>
    </div>
  );
}

/** Online, for the player who is waiting: what the other player is in the middle of, so the pause makes sense. */
export function ResolvingNotice({ state, onZoom }: { state: GameState; onZoom: (def: CardDef) => void }) {
  const chooser = state.pendingPick?.player ?? state.pendingChoice?.player;
  const name = state.pendingPick?.source?.name ?? state.pendingChoice?.item.sourceName;
  if (!chooser || !name) return null;
  const def = sourceDef(state);
  return (
    <section className="flex items-start gap-3 rounded-lg border border-violet-500/50 bg-violet-50 p-3">
      {def && <CardView def={def} onZoom={() => onZoom(def)} />}
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase font-display tracking-wide text-violet-700">Resolving {name}</div>
        <p className="text-sm font-semibold text-violet-900">Waiting for {playerName(chooser)} to choose…</p>
        {def?.text && (
          <p className="mt-1 whitespace-pre-line text-[13px] leading-snug text-zinc-700">
            <ManaText text={def.text} />
          </p>
        )}
      </div>
    </section>
  );
}
