import { memo, useRef } from "react";
import type { CardDef } from "@mtg/engine";
import { cardImageUrl } from "@/lib/cards";
import { isTokenDef, useTokenArt } from "@/lib/tokenArt";
import TokenFrame from "./TokenFrame";
import { ManaText } from "./ManaSymbols";

type Size = "sm" | "md" | "lg";

// Stored art is 146x204, so "lg" shows it at its native size.
// On the play screen the page sets --card-h from the window height so the whole board fits without scrolling; elsewhere it is 168px.
const ART_SIZE: Record<Size, string> = { sm: "h-[calc(var(--card-h,168px)*0.8)] aspect-[146/204]", md: "h-[var(--card-h,168px)] aspect-[146/204]", lg: "h-[201px] w-36" };
const FRAME_SIZE: Record<Size, string> = ART_SIZE;

// A card turned sideways is as wide as it is tall; the margin gives it that extra width so its neighbours don't get covered.
const TAP_MARGIN: Record<Size, string> = { sm: "mx-[calc(var(--card-h,168px)*0.115)]", md: "mx-[calc(var(--card-h,168px)*0.142)]", lg: "mx-8" };

export const COMBAT_BADGE: Record<string, string> = {
  free: "bg-yellow-400 text-black",
  best: "bg-yellow-400 text-black",
  safe: "bg-green-600 text-white",
  good: "bg-green-600 text-white",
  risky: "bg-orange-500 text-white",
  trade: "bg-orange-500 text-white",
  chump: "bg-orange-500 text-white",
  block: "bg-sky-600 text-white",
  threat: "bg-red-600 text-white",
  blocked: "bg-emerald-600 text-white",
};

interface Props {
  /** Combat advice: the card glows in the color of the tone and wears the label as a badge. */
  combat?: { tone: string; label: string; why?: string };
  def: CardDef;
  tapped?: boolean;
  summoningSick?: boolean;
  damage?: number;
  /** Power and toughness right now (auras, anthems and pumps change them). Defaults to the printed ones. Given for a creature on the battlefield, they are always shown. */
  power?: number;
  toughness?: number;
  /** In hand: you can play this right now with the mana you have. Gets a green glow and a badge. */
  castable?: boolean;
  /** Replaces "✓ Castable" when the card can only be cast a special way (e.g. "✓ Warp only"). */
  castLabel?: string;
  /** In hand: you can't play this right now. The card is dimmed, `hint` says why. */
  dim?: boolean;
  hint?: string;
  /** Small labels on the card, e.g. "On: Grizzly Bears" for an Aura, or the Auras attached to a creature. */
  tags?: string[];
  /** Counters on it. -1/-1 counters that infect put there make the card look infected. */
  counters?: { plus?: number; minus?: number; infected?: boolean; stun?: number };
  /** "Ward {2}": targeting it costs an opponent extra. */
  ward?: string;
  /** Tailwind ring classes, e.g. "ring-2 ring-amber-400" */
  ring?: string;
  note?: string;
  size?: Size;
  /** Marks the card on the page so the combat animation can find it. */
  iid?: string;
  /** Attacking this turn: the card lifts up and glows red. */
  attacking?: boolean;
  onClick?: () => void;
  /** Mouse over / keyboard focus: used to show the card in the detail panel. */
  onHover?: () => void;
  /**
   * Show the card big. Adds a magnifier button (visible on hover) and makes right-click work.
   * Use it where a plain click already does something else, like adding the card to a deck.
   */
  onZoom?: () => void;
}

const HOLD_MS = 450;

/**
 * Touch screens have no hover and no right-click: pressing a card and holding it (without moving, which would be a scroll) enlarges it,
 * and the click that follows the release is not a click on the card. Everything else about the card is the same.
 */
function useHold(onZoom: (() => void) | undefined, onClick: (() => void) | undefined) {
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const stop = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch" || !onZoom) return;
      held.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        held.current = true;
        start.current = null;
        navigator.vibrate?.(15);
        onZoom();
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const from = start.current;
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 10) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onClick: () => {
      if (held.current) {
        held.current = false;
        return;
      }
      onClick?.();
    },
  };
}

/** "+1/+1 ×2", and "☣ Infected −1/−1 ×1" in poison green. */
function StatusChips({ plus = 0, minus = 0, infected = false, stun = 0, ward }: NonNullable<Props["counters"]> & { ward?: string }) {
  if (plus <= 0 && minus <= 0 && stun <= 0 && !ward) return null;
  return (
    <div className="absolute left-1 top-1/2 z-10 flex -translate-y-1/2 flex-col items-start gap-1 text-[10px] font-bold leading-tight">
      {stun > 0 && (
        <span
          title={`${stun} stun counter${stun === 1 ? "" : "s"}: when it would untap, a stun counter comes off instead. It stays tapped through its next ${stun === 1 ? "untap" : `${stun} untaps`}.`}
          className="rounded-md bg-sky-950/90 px-1.5 py-0.5 text-sky-200 shadow ring-1 ring-sky-300/80"
        >
          ❄ Stun ×{stun}
        </span>
      )}
      {ward && (
        <span
          title={`${ward}: when an opponent's spell or ability targets it, they pay the ward cost or their spell or ability is countered.`}
          className="rounded-md bg-indigo-900/90 px-1.5 py-0.5 text-white shadow ring-1 ring-indigo-300/80"
        >
          <ManaText text={ward} />
        </span>
      )}
      {minus > 0 && (
        <span
          title={`${infected ? "Infected: " : ""}${minus} -1/-1 counter${minus === 1 ? "" : "s"}. ${minus === 1 ? "It stays" : "They stay"} on the creature.`}
          className="flex flex-col rounded-md bg-lime-950/90 px-1.5 py-0.5 text-lime-300 shadow ring-1 ring-lime-400/80"
        >
          {infected && <span>☣ Infected</span>}
          <span>−1/−1 ×{minus}</span>
        </span>
      )}
      {plus > 0 && (
        <span title={`${plus} +1/+1 counter${plus === 1 ? "" : "s"}`} className="rounded-md bg-emerald-700/90 px-1.5 py-0.5 text-white shadow ring-1 ring-emerald-300/80">
          +1/+1 ×{plus}
        </span>
      )}
    </div>
  );
}

function Card({ combat, def, tapped, summoningSick, damage = 0, power, toughness, tags, counters, ward, castable, castLabel, dim, hint, ring = "", note, size = "sm", iid, attacking, onClick, onHover, onZoom }: Props) {
  const hold = useHold(onZoom, onClick);
  const tokenArt = useTokenArt(def); // tokens have no stored art: it comes from Scryfall
  const imageUrl = def.image ? cardImageUrl(def.image) : tokenArt?.small || null;
  const tokenFrame = !imageUrl && isTokenDef(def); // a token Scryfall has no picture of: we draw the card ourselves
  const nowPower = power ?? def.power ?? 0;
  const nowToughness = toughness ?? def.toughness ?? 0;
  const toughnessLeft = nowToughness - damage;
  const changed = def.type === "creature" && (nowPower !== (def.power ?? 0) || nowToughness !== (def.toughness ?? 0));
  const weakened = nowPower < (def.power ?? 0) || nowToughness < (def.toughness ?? 0);
  const infected = counters?.infected === true && (counters.minus ?? 0) > 0;
  const statsTone =
    damage > 0 ? "bg-red-700 text-white ring-red-300" : (counters?.minus ?? 0) > 0 ? "bg-lime-900 text-lime-200 ring-lime-400" : weakened ? "bg-orange-700 text-white ring-orange-300" : changed ? "bg-emerald-700 text-white ring-emerald-300" : "bg-zinc-900/85 text-white ring-white/40";
  const statsWhy = `Power ${nowPower}, toughness ${toughnessLeft}${damage > 0 ? ` (${nowToughness} minus ${damage} damage)` : ""}${changed ? `. Printed: ${def.power ?? 0}/${def.toughness ?? 0}` : ""}`;
  const base = `relative shrink-0 overflow-hidden rounded-lg border border-zinc-600 text-left text-xs transition ${
    tapped && !attacking ? `rotate-90 brightness-[.72] ${TAP_MARGIN[size]}` : ""
  } ${attacking ? "-translate-y-3 scale-105 shadow-xl shadow-red-500/50 ring-2 ring-red-500" : ""} ${
    onClick ? "cursor-pointer hover:-translate-y-1" : "cursor-default"
  } ${castable ? "castable-glow" : ""} ${combat ? `combat-${combat.tone}` : ""} ${dim ? "brightness-[.7] saturate-50" : ""} ${ring}`;
  const hover = hint ?? (combat ? `${combat.label}${combat.why ? `: ${combat.why}` : ""}` : undefined) ?? (onHover ? undefined : [def.typeLine, def.manaCost, def.text].filter(Boolean).join("\n"));
  const badge = combat ? (
    <span className={`absolute left-1 top-1 z-10 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold shadow ${COMBAT_BADGE[combat.tone] ?? "bg-zinc-700 text-white"}`}>{combat.label}</span>
  ) : castable ? (
    <span className={`absolute left-1 top-1 z-10 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white shadow ${castLabel ? "bg-amber-600" : "bg-emerald-500"}`}>{castLabel ?? <><span aria-hidden="true">✓</span><span className="max-lg:sr-only"> Castable</span></>}</span>
  ) : null;

  // Real card art already shows name, cost, text and P/T: only add the live game status on top.
  if (imageUrl || tokenFrame) {
    return (
      <button
        type="button"
        data-card-iid={iid}
        data-scry={def.scryfallId} // (a finishing move draws the flying cards from the sharp picture)
        data-tint={def.colors?.[0]}
        {...hold}
        onMouseEnter={onHover}
        onContextMenu={onZoom && ((e) => (e.preventDefault(), onZoom()))}
        onFocus={onHover}
        title={hover}
        style={imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        className={`${base} ${ART_SIZE[size]} bg-slate-800`}
      >
        <span className="sr-only">{def.name}</span>
        {tokenFrame && <TokenFrame def={def} art={tokenArt?.crop} power={nowPower} toughness={toughnessLeft} damaged={damage > 0} />}
        {infected && <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-lime-500/45 via-lime-900/15 to-transparent" />}
        {badge}
        {(counters || ward) && <StatusChips {...counters} ward={ward} />}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 p-1 text-[10px] font-semibold">
          {note && <span className="rounded bg-sky-600 px-1 text-white">{note}</span>}
          {tags?.map((t, i) => (
            <span key={`${i}-${t}`} className="rounded bg-violet-700 px-1 text-white">
              {t}
            </span>
          ))}
          {tapped && (
            <span className="rounded bg-black/80 px-1 text-zinc-200">
              <i className="ms ms-tap" role="img" aria-label="Tapped" title="Tapped" />
            </span>
          )}
          {summoningSick && <span className="rounded bg-black/80 px-1 text-zinc-200">Summoning sick</span>}
        </div>
        {!tokenFrame && (power !== undefined || damage > 0 || changed) && (
          <span className={`absolute right-1 top-1 z-20 rounded-md px-1.5 py-0.5 font-extrabold leading-none shadow ring-1 ${size === "sm" ? "text-xs" : "text-sm"} ${statsTone}`} title={statsWhy}>
            {nowPower}/{toughnessLeft}
          </span>
        )}
      </button>
    );
  }

  // No art: draw a simple frame.
  const tint = def.type === "land" ? (def.id === "forest" ? "bg-green-900" : "bg-red-900") : "bg-indigo-900";
  return (
    <button
      type="button"
      data-card-iid={iid}
      data-tint={def.colors?.[0]}
      {...hold}
      onMouseEnter={onHover}
      onContextMenu={onZoom && ((e) => (e.preventDefault(), onZoom()))}
      onFocus={onHover}
      title={hover}
      className={`${base} ${tint} flex flex-col justify-between p-2 text-white ${FRAME_SIZE[size]}`}
    >
      {badge}
      {(counters || ward) && <StatusChips {...counters} ward={ward} />}
      <div className="flex justify-between gap-1 rounded bg-black/40 px-1">
        <span className="font-semibold leading-tight">{def.name}</span>
        {def.type === "creature" && <span className="text-amber-300">{def.cost}</span>}
      </div>
      <div className="rounded bg-black/40 px-1 text-zinc-300">
        <div className="capitalize">{def.type}</div>
        {note && <div className="text-sky-300">{note}</div>}
        {tags?.map((t, i) => (
          <div key={`${i}-${t}`} className="rounded bg-violet-700/90 px-1 text-[10px] text-white">
            {t}
          </div>
        ))}
        {tapped && (
          <div>
            <i className="ms ms-tap" role="img" aria-label="Tapped" title="Tapped" />
          </div>
        )}
        {summoningSick && <div>Summoning sick</div>}
      </div>
      {def.type === "creature" && (
        <div className="self-end rounded bg-black/70 px-1.5 py-0.5 font-bold" title={statsWhy}>
          {nowPower}/{damage ? <span className="text-red-400">{toughnessLeft}</span> : toughnessLeft}
        </div>
      )}
    </button>
  );
}

function CardViewInner(props: Props) {
  const card = <Card {...props} />;
  if (!props.onZoom) return card;

  return (
    <div className="group relative shrink-0">
      {card}
      <button
        type="button"
        onClick={props.onZoom}
        aria-label={`Enlarge ${props.def.name}`}
        title="Enlarge (or right-click the card)"
        className={`absolute right-1 ${props.power !== undefined ? "top-8" : "top-1"} [@media(hover:none)]:hidden flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white opacity-0 shadow transition hover:bg-black group-hover:opacity-100 focus-visible:opacity-100`}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 21 21" />
        </svg>
      </button>
    </div>
  );
}

/**
 * A card is drawn again only when something it shows has changed. The game state is a brand new object after every move, so what is compared is
 * what the card shows, not the objects. A card that can be clicked is always drawn again (its click handler remembers the game as it was
 * when it was drawn, and must not be an old one); the hover and enlarge handlers only depend on the card and what is shown, which is compared.
 */
function sameCard(a: Props, b: Props): boolean {
  if (a.onClick || b.onClick) return false;
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = x[k];
    const q = y[k];
    if (typeof p === "function" || typeof q === "function") {
      if (!!p !== !!q) return false; // (only whether the handler exists)
      continue;
    }
    if (p === q) continue;
    if (k === "def") {
      const d = p as CardDef | undefined;
      const e = q as CardDef | undefined;
      if (d?.id === e?.id && d?.name === e?.name && d?.text === e?.text && d?.image === e?.image) continue;
      return false;
    }
    if (typeof p === "object" && typeof q === "object" && p && q && JSON.stringify(p) === JSON.stringify(q)) continue;
    return false;
  }
  return true;
}

const CardView = memo(CardViewInner, sameCard);
export default CardView;
