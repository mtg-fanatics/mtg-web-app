"use client";

import { MatTear } from "./MatTear";
import { InkRule, Seal } from "./BattlefieldBits";
import { useAnimationsOn } from "@/lib/motion";
import "./battlefield.css";
import type { MatFocus } from "@/lib/playmat";
import { gainedKeywords, wardOf } from "@mtg/engine";
import type { CardDef, GameState, Permanent, PlayerId } from "@mtg/engine";
import type { Inspected } from "./CardDetail";
import CardView from "./CardView";
import FitToHeight from "./FitToHeight";
import { isCreatureNow, liveCardProps, ptText } from "./stats";
import { PLAYER_STYLE } from "./theme";

export type Interaction = (p: Permanent) => { onClick?: () => void; ring: string; note?: string; combat?: { tone: string; label: string; why?: string }; dim?: boolean };

export function Side({ label, children, player, tone, grow, mat, matFx, zones, overlay, life }: { matFx?: MatFocus; label: string; children: React.ReactNode; player?: PlayerId; tone?: "emerald"; grow?: boolean; mat?: string; zones?: React.ReactNode; overlay?: React.ReactNode; life?: number }) {
  const style = player ? PLAYER_STYLE[player] : null;
  if (mat) {
    // A playmat: the player's chosen surface, and the library and graveyard in their own zones on the right.
    return (
      <section
        data-mat={player}
        className={`playmat bf relative flex flex-col gap-1 overflow-hidden rounded-2xl border-2 border-black/60 px-1.5 py-1 text-white lg:px-3 lg:py-1.5 ${grow ? "min-h-0 flex-1" : "shrink-0"}`}
        style={life !== undefined ? { background: "#0b0a0f" } : { background: `linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.2)), ${mat}` }}
      >
        {life !== undefined && <MatTear life={life} mat={mat} seed={player === "p2" ? 7 : 3} fx={matFx} />}
        <div className="bf-vignette" aria-hidden="true" />
        <div className="bf-frame" aria-hidden="true" />
        <h2 className="bf-title relative z-[1] flex items-center gap-2 max-lg:sr-only">
          {player && <Seal player={player} />}
          {label}
        </h2>
        {/* Notices (what the other player just cast) float over the mat, so they never squeeze the cards. */}
        {overlay && <div className="pointer-events-none absolute inset-x-2 top-2 z-20 lg:inset-x-4 lg:top-9 flex flex-col gap-1.5 lg:right-48">{overlay}</div>}
        <div className="relative z-[1] flex min-h-0 flex-1 gap-1.5 lg:gap-3">
          <FitToHeight className="flex-1">{children}</FitToHeight>
          {zones && (
            // the library, graveyard and exile share the whole height of the mat, and scale with it (a choice panel makes the mat shorter, for example)
            <div className="bf-zones flex min-h-0 w-[4.5rem] shrink-0 flex-col gap-1 rounded-xl border-2 border-dashed border-white/30 bg-black/25 p-1 lg:w-44 lg:gap-1.5 lg:p-1.5">{zones}</div>
          )}
        </div>
      </section>
    );
  }
  const tray = tone === "emerald";
  return (
    <section
      className={`relative flex flex-col gap-1.5 rounded-2xl border-2 px-1.5 py-1 shadow-lg lg:px-3 lg:py-2 ${grow ? "min-h-0 flex-1 overflow-y-auto" : "shrink-0"} ${
        tray ? "border-[#8fc4a5]/50 bg-slate-950/65 text-white" : style ? `${style.border} ${style.borderL} ${style.soft}` : "border-zinc-200 border-l-zinc-400 bg-white/70"
      }`}
    >
      <h2 className={`flex items-center gap-2 font-display text-xs font-bold uppercase tracking-widest max-lg:sr-only ${tray ? "text-[#a9d4b9]" : "text-zinc-600"}`}>
        {style && <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.bar}`} aria-hidden="true" />}
        {label}
      </h2>
      {children}
    </section>
  );
}

/** The line between a player's creatures and lands, labelled on the side where the lands are. */
export function LandsDivider({ landsBelow, onMat }: { landsBelow: boolean; onMat?: boolean }) {
  const draw = useAnimationsOn();
  const label = onMat ? (
    <span className="bf-caption max-lg:hidden">Lands &amp; artifacts</span>
  ) : (
    <span className="font-display text-[11px] font-semibold uppercase tracking-widest text-zinc-500 max-lg:hidden">Lands &amp; artifacts</span>
  );
  return (
    <div className={`flex flex-col gap-0.5 ${onMat ? "bf-divider" : ""}`} role="separator" aria-label="Lands are on this side of the line">
      {!landsBelow && label}
      {onMat ? <InkRule draw={draw} seed={landsBelow ? 1 : 2} /> : <div className="h-0.5 w-full rounded bg-zinc-400" />}
      {landsBelow && label}
    </div>
  );
}

// A land played this turn is summoning sick too, which only matters once it becomes a creature.
const statusOf = (state: GameState, p: Permanent, creature: boolean) =>
  [
    creature && `Power/toughness now: ${ptText(state, p)}`,
    p.tapped && "Tapped",
    p.summoningSick && creature && "Summoning sick",
    p.damage > 0 && `${p.damage} damage`,
    p.counters && `${p.counters} +1/+1 counter${p.counters === 1 ? "" : "s"}`,
    p.minusCounters && `${p.infected ? "Infected: " : ""}${p.minusCounters} -1/-1 counter${p.minusCounters === 1 ? "" : "s"}`,
    p.stun && `${p.stun} stun counter${p.stun === 1 ? "" : "s"}: stays tapped through its next ${p.stun === 1 ? "untap" : `${p.stun} untaps`}`,
    wardOf(state, p)?.text,
  ].filter(Boolean) as string[];

/** One row of permanents (lands or creatures). */
export function Lane({
  perms,
  state,
  interaction,
  size,
  onInspect,
  onZoom,
  attackingIds,
  onPreview,
  onUnpreview,
  collapseEmpty,
}: {
  /** An empty row takes no space (used in combat, when room is tight). */
  collapseEmpty?: boolean;
  perms: Permanent[];
  onPreview: (def: CardDef, el: HTMLElement) => void;
  onUnpreview: () => void;
  attackingIds: string[];
  state: GameState;
  interaction: Interaction;
  size: "sm" | "md";
  onInspect: (def: Inspected["def"], status?: string[]) => void;
  onZoom: (def: Inspected["def"]) => void;
}) {
  const everything = [...state.players.p1.battlefield, ...state.players.p2.battlefield];
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

  const renderPerm = (p: Permanent, attachment = false) => {
    const def = state.cards[p.card.defId];
    // Auras and Equipment: "On: <creature>" on them, and their names on the creature they are attached to.
    const host = p.attachedTo ? everything.find((x) => x.card.iid === p.attachedTo) : undefined;
    const attached = everything.filter((x) => x.attachedTo === p.card.iid);
    const tags = [
      ...(host ? [`On: ${state.cards[host.card.defId].name}`] : []),
      ...attached.map((a) => `+ ${state.cards[a.card.defId].name}`),
      ...(p.prepared ? ["Prepared"] : []),
      ...(p.solved ? ["Solved"] : []),
      ...(p.finality ? ["Finality counter"] : []),
      ...(p.warped ? ["Warped: exiled at end step"] : []),
      ...(p.sacAtEnd ? ["Sacrificed at end step"] : []),
      ...(/\bClass\b/.test(def.typeLine ?? "") ? [`Level ${p.classLevel ?? 1}`] : []),
      ...(p.heldFromHand ?? []).map((c) => `Holding: ${state.cards[c.defId]?.name ?? "a card"}`),
      ...(p.chosenColor ? [`Color: ${p.chosenColor}`] : []),
      ...(p.chosenType ? [`Type: ${p.chosenType.charAt(0).toUpperCase()}${p.chosenType.slice(1)}`] : []),
      ...(p.regenShield ? ["Regenerates"] : []),
      ...(p.preventShield ? [`Prevents the next ${p.preventShield} damage this turn`] : []),
      ...(p.controlledWhile ? [`Under control of ${state.cards[everything.find((x) => x.card.iid === p.controlledWhile!.source)?.card.defId ?? ""]?.name ?? "an effect"}`] : []),
      // keywords it has without printing them: delirium, an anthem, an Equipment, a counter
      ...gainedKeywords(state, p).map((k) => k.charAt(0).toUpperCase() + k.slice(1)),
      // effects that last until end of turn
      ...(p.powerBonus || p.toughnessBonus ? [`${sign(p.powerBonus ?? 0)}/${sign(p.toughnessBonus ?? 0)} this turn`] : []),
      ...(p.tempKeywords ?? []).map((k) => `${k} this turn`),
      ...(p.cantBlockTurn ? ["can't block this turn"] : []),
      ...(p.controlReturn ? ["stolen until end of turn"] : []),
      // which spell or ability is behind those effects
      ...(p.tempFrom ?? []).map((f) => `✦ ${f.name}`),
      ...(p.loyalty !== undefined ? [`Loyalty ${p.loyalty}`] : []),
      ...(p.crewed ? ["Crewed"] : []),
    ];
    const creature = isCreatureNow(state, p);
    return (
      <div key={p.card.iid} className="shrink-0" onMouseEnter={(e) => onPreview(def, e.currentTarget)} onMouseLeave={onUnpreview}>
      <CardView
        iid={p.card.iid}
        tags={tags}
        {...liveCardProps(state, p)}
        attacking={attackingIds.includes(p.card.iid)}
        def={def}
        size={attachment ? "sm" : size}
        summoningSick={p.summoningSick && creature}
        {...interaction(p)}
        {...(attachment ? { ring: "ring-2 ring-violet-400" } : {})}
        onHover={() => onInspect(def, statusOf(state, p, creature))}
        onZoom={() => onZoom(def)}
      />
      </div>
    );
  };

  return (
    <div className={`flex flex-wrap items-start gap-1.5 ${collapseEmpty && perms.length === 0 ? "" : size === "md" ? "min-h-[var(--card-h,168px)]" : "min-h-[calc(var(--card-h,168px)*0.8)]"}`}>
      {perms
        // An Aura or Equipment is drawn next to what it is attached to, not on its own.
        .filter((p) => !(p.attachedTo && everything.some((x) => x.card.iid === p.attachedTo)))
        .map((p) => {
          const attachments = everything.filter((x) => x.attachedTo === p.card.iid);
          const group = (
            <>
              {renderPerm(p)}
              {attachments.map((a) => renderPerm(a, true))}
            </>
          );
          return attachments.length > 0 ? (
            <div key={p.card.iid} className="flex items-start gap-1 rounded-lg border border-violet-300 bg-violet-50/50 p-1">
              {group}
            </div>
          ) : (
            <div key={p.card.iid}>{group}</div>
          );
        })}
    </div>
  );
}

/** What every row of permanents needs from the play screen. */
export interface LaneContext {
  state: GameState;
  attackingIds: string[];
  onInspect: (def: Inspected["def"], status?: string[]) => void;
  onZoom: (def: Inspected["def"]) => void;
  onPreview: (def: CardDef, el: HTMLElement) => void;
  onUnpreview: () => void;
}

/**
 * One player's permanents on their mat: lands and other permanents in the small row, creatures in the big one, and beside the creatures
 * the combat zone, where creatures in the fight stand. `top` is the opponent's side: lands first, the combat zone on the right.
 */
export function Battlefield({
  owner,
  top,
  lane,
  interaction,
  inCombat,
  combatSetup,
  ...side
}: {
  owner: PlayerId;
  top?: boolean;
  lane: LaneContext;
  interaction: Interaction;
  inCombat: (p: Permanent) => boolean;
  /** This player is choosing attackers or blockers, so the combat zone shows even while it is empty. */
  combatSetup: boolean;
  label: string;
  mat: string;
  matFx?: MatFocus;
  zones: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const { state } = lane;
  const perms = state.players[owner].battlefield;
  const fighting = perms.filter(inCombat);
  const resting = perms.filter((p) => !inCombat(p));
  const isCreature = (p: Permanent) => state.cards[p.card.defId].type === "creature" || p.crewed === true;
  const inCombatStep = state.phase === "attackers" || state.phase === "blockers" || state.phase === "damage";
  const zone = fighting.length > 0 || combatSetup ? <CombatZone perms={fighting} attackingSide={owner === state.active} lane={lane} interaction={interaction} /> : null;
  const lands = <Lane perms={resting.filter((p) => !isCreature(p))} interaction={interaction} size="sm" {...lane} />;
  const creatures = (
    <div className="flex items-stretch gap-2">
      {zone && !top && <div className="max-w-[60%] shrink-0">{zone}</div>}
      <div className="min-w-0 flex-1">
        <Lane perms={resting.filter(isCreature)} interaction={interaction} size="md" collapseEmpty={inCombatStep} {...lane} />
      </div>
      {zone && top && <div className="max-w-[60%] shrink-0">{zone}</div>}
    </div>
  );
  return (
    <Side player={owner} grow life={state.players[owner].life} {...side}>
      {top ? lands : creatures}
      <LandsDivider landsBelow={!top} onMat />
      {top ? creatures : lands}
    </Side>
  );
}

/** The attackers (on the side whose turn it is) or the blockers. */
function CombatZone({ perms, attackingSide, lane, interaction }: { perms: Permanent[]; attackingSide: boolean; lane: LaneContext; interaction: Interaction }) {
  return (
    <div className={`flex flex-col gap-1 rounded-lg border-2 border-dashed px-2 py-1 ${attackingSide ? "border-red-400 bg-[#450a0a]/45" : "border-sky-400 bg-[#082f49]/45"}`}>
      <div className={`flex items-center gap-2 text-[11px] font-extrabold uppercase font-display tracking-widest ${attackingSide ? "text-[#f0bfb0]" : "text-[#c9d3e0]"}`}>
        {attackingSide ? "⚔ Attack zone" : "🛡 Block zone"}
        {perms.length > 0 && <span>({perms.length})</span>}
        {perms.length === 0 && <span className="font-medium normal-case tracking-normal text-slate-200 max-lg:hidden">{attackingSide ? "Click a glowing creature to move it here and attack with it." : "Click one of your creatures, then the attacker it should block."}</span>}
      </div>
      {perms.length > 0 && <Lane perms={perms} interaction={interaction} size="md" {...lane} />}
    </div>
  );
}
