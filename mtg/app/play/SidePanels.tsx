"use client";

import { useAnimationsOn } from "@/lib/motion";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HIDDEN_CARD_ID } from "@mtg/engine";
import type { CardDef, GameState, PlayerId } from "@mtg/engine";
import { ManaText } from "./ManaSymbols";
import { ManaMeter } from "./ManaMeter";
import type { ManaNote } from "./manaInfo";
import { playerName } from "./log";
import { lifeBusyUntil, registerLife } from "./lifeCount";
import { useUnseenCards } from "./pileFx";
import { useStacked } from "./useMedia";
import { PLAYER_STYLE } from "./theme";
import { Heart, Hand, InkDrop, Shield, Skull, Spark } from "../Icons";
import { Seal, ZoneIcon } from "./BattlefieldBits";
import "./ledger.css";

export interface ChatMessage {
  id: number;
  from: PlayerId;
  text: string;
}

// Each panel has a role: the players are bound pages, the chat is a slip of paper, the log a ruled ledger. See ledger.css.
const frame = "pl-frame flex min-h-0 flex-col gap-2 p-3";
const slip = "chat-slip flex min-h-0 flex-col gap-2 p-3";
const ledger = "log-ledger flex min-h-0 flex-col gap-2 p-3";
const title = "panel-title";

/** The ink well under a life total: the ink is drawn down as the life goes, and a ledger tick marks every five. */
function InkWell({ life, big }: { life: number; big?: boolean }) {
  const level = life <= 5 ? "low" : life <= 10 ? "mid" : "ok";
  return (
    <div className={`ink-well ${big ? "ink-well-big" : ""}`} aria-hidden="true">
      <div className="ink-well-fill" data-level={level} style={{ width: `${Math.max(0, Math.min(100, (life / 20) * 100))}%` }} />
    </div>
  );
}

/**
 * A life total that counts up or down ONE POINT AT A TIME: a creature that hits for 5 takes 20 to 19, 18, 17, 16, 15, each step a beat
 * apart with a small pop, so every point of damage is seen going. Past zero it keeps going into the negatives. The attack animation starts
 * the count the moment its hit lands (see `lifeCount`); a change that arrives from the game state does the same if it is not already shown.
 * The combat animation finds the number by `data-life`.
 */
function LifeTotal({ id, value }: { id: PlayerId; value: number }) {
  const [shown, setShown] = useState(value);
  const current = useRef(value); // what is on screen right now
  const target = useRef(value); // where the count is going
  const number = useRef<HTMLSpanElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const drop = useRef<HTMLSpanElement>(null);
  const dropAnim = useRef<Animation | null>(null);
  const onRef = useRef(false);
  const pop = useRef<Animation | null>(null); // one pop animation, replayed on every point (a new one each time is a lot of small work)
  const timer = useRef(0);
  const on = useAnimationsOn();
  useEffect(() => {
    onRef.current = on;
  }, [on]);

  // Counts towards `target`, a point per beat. A new change while it is counting just moves the target: one count, never two at once.
  const count = useCallback(() => {
    window.clearTimeout(timer.current);
    const points = Math.abs(target.current - current.current);
    if (points === 0) return;
    const beat = Math.max(110, Math.min(300, 2000 / points)); // ms per point: a few points are counted slowly, a long count still ends in about two seconds
    lifeBusyUntil(performance.now() + beat * points);
    // Each step only changes the text of the number (no React render, nothing laid out again) and pops its wrapper (transform only: the
    // number itself already has its own pulsing animation when it is low). React is told once, at the end, for the colour and glow.
    const tick = () => {
      const up = target.current > current.current;
      current.current += up ? 1 : -1;
      const text = number.current?.firstChild;
      if (text) text.nodeValue = String(current.current);
      if (drop.current && onRef.current) {
        // a small drop of ink falls from the number (wax red when life goes, moss when it comes back)
        drop.current.dataset.dir = up ? "gain" : "loss";
        dropAnim.current ??= drop.current.animate([{ opacity: 0.9, transform: "translateY(-12px) scale(0.7)" }, { opacity: 0, transform: "translateY(10px) scale(1)" }], { duration: 520, easing: "ease-in" });
        dropAnim.current.currentTime = 0;
        dropAnim.current.play();
      }
      if (wrap.current) {
        pop.current ??= wrap.current.animate([{ transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 180, easing: "ease-out" });
        pop.current.currentTime = 0;
        pop.current.play();
      }
      if (current.current !== target.current) timer.current = window.setTimeout(tick, beat);
      else setShown(current.current);
    };
    tick();
  }, []);

  useEffect(() => registerLife(id, (change) => { target.current += change; count(); }), [id, count]);
  useEffect(() => {
    if (value === target.current) return; // (the attack already counted it)
    target.current = value;
    count();
  }, [value, count]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const danger = shown <= 5 ? 2 : shown <= 10 ? 1 : 0; // 2: glowing red and pumping slowly, 1: a slow amber glow
  return (
    <span ref={wrap} className="relative inline-flex items-center justify-center">
      {danger > 0 && <span aria-hidden="true" className={`life-halo ${danger === 2 ? "life-halo-red" : "life-halo-amber"} ${on ? "life-halo-moving" : ""}`} />}
      <span ref={number} data-life={id} className={`life-num relative inline-block text-3xl tabular-nums lg:text-4xl ${danger === 2 ? "life-low life-pump" : danger === 1 ? "life-mid" : "life-ok"} ${danger === 2 && on ? "life-pump-moving" : ""}`}>
        {shown}
      </span>
      <span ref={drop} aria-hidden="true" className="life-drop">
        <InkDrop width={14} height={14} />
      </span>
    </span>
  );
}

/** Both players' name, life, mana and pile sizes. The player to act is highlighted. */
function PlayersPanelInner({
  state,
  order,
  actor,
  onResign,
  heading = "Players",
  manaNotes = {},
}: {
  state: GameState;
  order: PlayerId[];
  actor: PlayerId;
  /** A recent change in a player's untapped mana, and why. */
  manaNotes?: Partial<Record<PlayerId, ManaNote>>;
  /** The small title above the panel. */
  heading?: string;
  /** Shows a Resign button on each player. */
  onResign?: (id: PlayerId) => void;
}) {
  const unseen = { p1: useUnseenCards("p1"), p2: useUnseenCards("p2") }; // (the opening hands are dealt on screen: the libraries count down)
  const stacked = useStacked();
  const [detail, setDetail] = useState<PlayerId | null>(null); // phones: tap a player to see everything about them
  if (stacked) {
    // A phone has no room for a column of panels: each player is a short card (name and life, then mana, then the pile sizes).
    return (
      <div className="flex flex-col gap-1">
        {detail && <PlayerDetail state={state} id={detail} actor={actor} unseen={unseen[detail]} note={manaNotes[detail]} onResign={onResign} onClose={() => setDetail(null)} />}
        {order.map((id) => {
          const p = state.players[id];
          const style = PLAYER_STYLE[id];
          const acting = id === actor;
          return (
            <div key={id} role="button" tabIndex={0} aria-label={`${playerName(id)}: details`} onClick={() => setDetail(id)} onKeyDown={(e) => e.key === "Enter" && setDetail(id)} data-side={id} className={`pl-card cursor-pointer px-2.5 py-1.5 ${acting ? "pl-acting" : ""}`}>
              <div className="flex items-center gap-1.5">
                <span title={playerName(id)} className="pl-name min-w-0 max-w-[34%] truncate text-[15px]">
                  <Seal player={id} />
                  {playerName(id)}
                </span>
                {/* (the amber ring already says whose turn it is: no room for the badge on a phone) */}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  <span className="pl-counts flex gap-1.5 text-[13px]">
                    <span title="Cards in hand"><Hand width={15} height={15} /><b>{p.hand.length}</b></span>
                    <span title="Cards in library"><ZoneIcon kind="library" /><b>{p.library.length + unseen[id]}</b></span>
                    <span title="Cards in graveyard"><ZoneIcon kind="graveyard" /><b>{p.graveyard.length}</b></span>
                  </span>
                  <DeathLife n={p.deathLife ?? 0} short />
                  {(p.preventShield ?? 0) > 0 && <span className="pl-tag text-[13px]" title="The next damage dealt to this player this turn is prevented"><Shield width={14} height={14} /> {p.preventShield}</span>}
                  <Emblems texts={(p.emblems ?? []).map((e) => e.text)} short />
                  {(p.poison ?? 0) > 0 && (
                    <span data-poison={id} data-grave={(p.poison ?? 0) >= 7 ? "yes" : "no"} className="pl-tag pl-poison text-[13px] tabular-nums">
                      <Skull width={14} height={14} /> {p.poison}/10
                    </span>
                  )}
                  <Heart width={20} height={20} className="ink-icon pl-heart" />
                  <LifeTotal id={id} value={p.life} />
                </span>
              </div>
              {/* the opponent's mana is a detail: only the player's own is shown */}
              {id === actor && <ManaMeter state={state} id={id} note={manaNotes[id]} compact />}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <section className={frame}>
      <h2 className={title}>{heading}</h2>
      {order.map((id) => {
        const p = state.players[id];
        const style = PLAYER_STYLE[id];
        const acting = id === actor;
        return (
          <div key={id} data-side={id} className={`pl-card p-3 ${acting ? "pl-acting" : ""}`}>
            {/* a long account name shortens (…) and the badge wraps below it instead of leaving the panel; Resign sits at the end of the life row */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span title={playerName(id)} className="pl-name min-w-0 max-w-full truncate text-lg">
                <Seal player={id} />
                {playerName(id)}
              </span>
              {acting && <span className="pl-act shrink-0 whitespace-nowrap">to act</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Heart width={26} height={26} className="ink-icon pl-heart" />
              <LifeTotal id={id} value={p.life} />
              {onResign && !state.winner && (
                <button onClick={() => onResign(id)} title="Give up this game: the other player wins" className="btn-danger ml-auto shrink-0 !px-3 !py-1">
                  Resign
                </button>
              )}
              <DeathLife n={p.deathLife ?? 0} />
              {(p.preventShield ?? 0) > 0 && (
                <span title="The next damage dealt to this player this turn is prevented" className="pl-tag text-sm">
                  <Shield width={15} height={15} /> {p.preventShield}
                </span>
              )}
              <Emblems texts={(p.emblems ?? []).map((e) => e.text)} />
              {(p.poison ?? 0) > 0 && (
                <span data-poison={id} data-grave={(p.poison ?? 0) >= 7 ? "yes" : "no"} title="Poison counters: a player with ten or more loses the game" className="pl-tag pl-poison text-sm tabular-nums">
                  <Skull width={15} height={15} /> {p.poison}/10
                </span>
              )}
            </div>
            <InkWell life={p.life} />
            <ManaMeter state={state} id={id} note={manaNotes[id]} />
            <div className="pl-ledger mt-2">
              <span data-hand={id} title="Cards in hand">
                <Hand width={16} height={16} /> Hand <b>{p.hand.length}</b>
              </span>
              <span title="Cards in library">
                <ZoneIcon kind="library" /> Library <b>{p.library.length + unseen[id]}</b>
              </span>
              <span title="Cards in graveyard">
                <ZoneIcon kind="graveyard" /> Yard <b>{p.graveyard.length}</b>
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Ruinous Waterbending with waterbend paid: "whenever a creature dies this turn, you gain 1 life", once for each such spell. */
/** Emblems (Elspeth's "Creatures you control get +2/+2 and have flying."): nothing on the battlefield shows them. */
function Emblems({ texts, short }: { texts: string[]; short?: boolean }) {
  if (texts.length === 0) return null;
  return (
    <span title={texts.map((t) => `Emblem: ${t}`).join("\n")} className={`pl-tag ${short ? "text-[13px]" : "text-sm"}`}>
      <Spark width={14} height={14} /> {short ? (texts.length > 1 ? `×${texts.length}` : "") : texts.map((t) => `Emblem: ${t}`).join(" · ")}
    </span>
  );
}

function DeathLife({ n, short }: { n: number; short?: boolean }) {
  if (n === 0) return null;
  return (
    <span title={`This turn, whenever a creature dies, this player gains ${n} life (Ruinous Waterbending)`} className={`pl-tag ${short ? "text-[13px]" : "text-sm"}`}>
      <InkDrop width={14} height={14} /> {short ? `+${n}/death` : `Creature dies: +${n} life (this turn)`}
    </span>
  );
}

/** A phone's player panel is short; tapping it opens everything about that player in a sheet. */
function PlayerDetail({ state, id, actor, unseen, note, onResign, onClose }: { state: GameState; id: PlayerId; actor: PlayerId; unseen: number; note?: ManaNote; onResign?: (id: PlayerId) => void; onClose: () => void }) {
  const p = state.players[id];
  const style = PLAYER_STYLE[id];
  const rows: [React.ReactNode, string, number][] = [
    [<Hand key="h" width={18} height={18} />, "Hand", p.hand.length],
    [<ZoneIcon key="l" kind="library" />, "Library", p.library.length + unseen],
    [<ZoneIcon key="g" kind="graveyard" />, "Graveyard", p.graveyard.length],
    [<ZoneIcon key="e" kind="exile" />, "Exile", p.exile.length],
  ];
  return (
    <div role="dialog" aria-modal="true" aria-label={`${playerName(id)}'s details`} className="game-modal fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-3" onClick={onClose}>
      <div data-side={id} className="pl-card w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="pl-name min-w-0 truncate text-xl"><Seal player={id} />{playerName(id)}</span>
          {id === actor && <span className="pl-act">to act</span>}
          <button onClick={onClose} aria-label="Close" className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-2xl leading-none">
            ×
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Heart width={30} height={30} className="ink-icon pl-heart" />
          <span className="life-num text-5xl tabular-nums">{p.life}</span>
          {(p.poison ?? 0) > 0 && <span className="pl-tag pl-poison text-base"><Skull width={16} height={16} /> {p.poison}/10 poison</span>}
        </div>
        {(p.preventShield ?? 0) > 0 && <div className="pl-tag mt-2 text-sm"><Shield width={15} height={15} /> The next {p.preventShield} damage dealt to this player this turn is prevented.</div>}
        {p.skipCombat === state.turn + 1 || p.skipCombat === state.turn + 2 ? <div className="mt-2 rounded bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-900">Skips all combat phases of their next turn.</div> : null}
        {(p.deathLife ?? 0) > 0 && (
          <div className="mt-2">
            <DeathLife n={p.deathLife ?? 0} />
          </div>
        )}
        {(p.emblems ?? []).length > 0 && (
          <div className="mt-2">
            <Emblems texts={(p.emblems ?? []).map((e) => e.text)} />
          </div>
        )}
        <InkWell life={p.life} big />
        <ManaMeter state={state} id={id} note={note} mark={false} />
        <div className="mt-3 grid grid-cols-2 gap-2 text-base">
          {rows.map(([icon, label, n]) => (
            <div key={label} className="pl-row flex items-center justify-between px-3 py-2">
              <span className="inline-flex items-center gap-1.5">
                {icon} {label}
              </span>
              <b className="tabular-nums">{n}</b>
            </div>
          ))}
        </div>
        {onResign && !state.winner && (
          <button onClick={() => (onClose(), onResign(id))} className="btn-danger mt-3 w-full !py-2.5">
            Resign
          </button>
        )}
      </div>
    </div>
  );
}

/** Local chat for now. It will be wired to the live game server when matches go online. */
export function ChatPanel({ messages, as, onSend }: { messages: ChatMessage[]; as: PlayerId; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <section className={`${slip} h-48 lg:h-auto lg:min-h-[8.5rem] lg:flex-1`}>
      <h2 className={title}>Chat</h2>
      <div className="min-h-0 flex-1 overflow-y-auto text-[15px] leading-relaxed">
        {messages.length === 0 && <p className="text-[15px] text-zinc-600">No messages yet.</p>}
        {messages.map((m) => (
          <p key={m.id} className="break-words">
            <span className={m.from === "p1" ? "font-semibold text-amber-600" : "font-semibold text-sky-600"}>{playerName(m.from)}: </span>
            {m.text}
          </p>
        ))}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = text.trim();
          if (!trimmed) return;
          onSend(trimmed);
          setText("");
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder={`Message as ${playerName(as)}`}
          className="slip-field min-w-0 flex-1 px-2.5 py-1.5 text-[15px] outline-none"
        />
        <button type="submit" className="btn-gold !px-3.5 !py-1 !text-sm">
          Send
        </button>
      </form>
    </section>
  );
}

/** What the log needs to turn a card's name in a line into something to point at. */
interface LogCards {
  pattern: RegExp | null;
  byName: Map<string, CardDef>;
  onPreview: (def: CardDef, el: HTMLElement) => void;
  onUnpreview: () => void;
  onZoom: (def: CardDef) => void;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regex for every card in this game and both player names (longest first, so "Llanowar Elves" is not read as "Llanowar"). */
function logPattern(cards: Record<string, CardDef>): { pattern: RegExp | null; byName: Map<string, CardDef> } {
  const byName = new Map<string, CardDef>();
  for (const d of Object.values(cards)) if (d.id !== HIDDEN_CARD_ID && d.name && !byName.has(d.name)) byName.set(d.name, d);
  const words = [...byName.keys(), playerName("p1"), playerName("p2")].filter((w) => w.length > 1).sort((a, b) => b.length - a.length);
  return { pattern: words.length ? new RegExp(`(?<![\\w'’])(${words.map(escapeRe).join("|")})(?![\\w])`, "g") : null, byName };
}

/**
 * One line of the log. A card named in it can be pointed at (the big card shows, as on the board) or pressed (it opens); a player's name has
 * their color. Drawn once and left alone while the line is not changed.
 */
const LogLine = memo(function LogLine({ line, cards }: { line: string; cards: LogCards }) {
  const parts = cards.pattern ? line.split(cards.pattern) : [line];
  return (
    <div className={line.startsWith("—") ? "mt-2 border-t border-zinc-300/70 pt-1.5 font-bold text-zinc-900" : ""}>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <ManaText key={i} text={part} />;
        const def = cards.byName.get(part);
        if (def)
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={(e) => cards.onPreview(def, e.currentTarget)}
              onMouseLeave={cards.onUnpreview}
              onFocus={(e) => cards.onPreview(def, e.currentTarget)}
              onBlur={cards.onUnpreview}
              onClick={() => (cards.onUnpreview(), cards.onZoom(def))}
              className="cursor-help rounded-sm font-semibold text-violet-800 underline decoration-violet-400/70 decoration-dotted underline-offset-2 hover:bg-violet-500/20"
            >
              {part}
            </button>
          );
        const who = part === playerName("p1") ? "p1" : part === playerName("p2") ? "p2" : null;
        return who ? (
          <span key={i} className={`font-semibold ${PLAYER_STYLE[who].text}`}>
            {part}
          </span>
        ) : (
          part
        );
      })}
    </div>
  );
});

/**
 * The log, newest line first. Each new move adds lines at the top, so a line is known by its text and by how many identical lines are older than
 * it, not by its place in the list: the lines already there keep their page elements and are not drawn again (the list can have sixty lines,
 * and it was redrawn in full after every single move, by every viewer).
 */
export const LogPanel = memo(
  function LogPanel({ lines, cards, onPreview, onUnpreview, onZoom }: { lines: string[]; cards: Record<string, CardDef>; onPreview: LogCards["onPreview"]; onUnpreview: () => void; onZoom: (def: CardDef) => void }) {
  // The game state is a new object after every move, its cards too: the pattern is rebuilt only when the cards or the names are others.
  const signature = `${Object.keys(cards).join("|")}#${playerName("p1")}#${playerName("p2")}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- (`signature` stands for `cards` and the player names)
  const found = useMemo(() => logPattern(cards), [signature]);
  const hooks = useRef({ onPreview, onUnpreview, onZoom });
  useEffect(() => {
    hooks.current = { onPreview, onUnpreview, onZoom };
  });
  // These forward to the latest handlers, so the lines (which are not drawn again) never hold on to an old one.
  const logCards = useMemo<LogCards>(
    () => ({ ...found, onPreview: (d, el) => hooks.current.onPreview(d, el), onUnpreview: () => hooks.current.onUnpreview(), onZoom: (d) => hooks.current.onZoom(d) }),
    [found],
  );
  const older = new Map<string, number>();
  const keyed = [...lines].reverse().map((line) => {
    const n = older.get(line) ?? 0;
    older.set(line, n + 1);
    return { line, key: `${n}:${line}` };
  }).reverse();
  return (
    <section className={`${ledger} h-48 lg:h-auto lg:min-h-[8.5rem] lg:flex-1`}>
      <h2 className={title}>Log</h2>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-[15px] leading-relaxed text-zinc-800">
        {keyed.map((x) => (
          <LogLine key={x.key} line={x.line} cards={logCards} />
        ))}
      </div>
    </section>
  );
  },
  // the handlers are read through a ref and the cards only matter when lines are drawn: only new lines redraw the log
  (a, b) => a.lines === b.lines,
);

/** What a players panel shows comes from these: both players (their mana can depend on the other's cards), whose turn it is and what is being waited for. The game state itself is a new object after every move. */
const panelSig = (p: { state: GameState; order: PlayerId[]; actor: PlayerId; heading?: string; onResign?: unknown }) =>
  JSON.stringify([p.order, p.state.players.p1, p.state.players.p2, p.actor, p.heading, p.state.turn, p.state.phase, p.state.active, p.state.priority?.holder, !!p.state.pendingPick, !!p.state.pendingChoice, p.state.winner, !!p.onResign]);
export const PlayersPanel = memo(PlayersPanelInner, (a, b) => panelSig(a) === panelSig(b));
