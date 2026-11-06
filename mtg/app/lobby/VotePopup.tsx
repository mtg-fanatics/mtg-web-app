"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STARTER_DECK } from "@mtg/engine";
import { holdWallpaper } from "../LiveWallpaper";
import { Cross } from "../Icons";
import { CoinDisplay } from "../play/CoinFlip";
import LookPicker from "../play/LookPicker";
import { myLook, randomLook } from "@/lib/playmat";
import { FINISHERS, getFinisher, playChosenFinisher, setFinisher, warmFinishers } from "../play/finishers";
import type { FinisherId } from "../play/finishers";
import { listPlayableDecks } from "@/lib/decks";
import type { DeckChoice } from "@/lib/decks";
import DeckPicker from "../decks/DeckPicker";
import { buildRandomDeck } from "@/lib/randomDeck";
import { loadDefaults, readDeckDefault, saveDefaults } from "@/lib/defaults";
import { useCached, writeCached } from "@/lib/dashCache";
import { leaveRoom, send } from "@/lib/online/session";
import type { RoomSnapshot } from "@/lib/online/protocol";
import { KickButton } from "./RoomPopup";

const RANDOM_ID = "random";
const STARTER: DeckChoice = { id: "starter", name: "Starter deck", ids: STARTER_DECK, official: true, colors: [] };
const STEPS = [
  { stage: "decks", label: "Decks" },
  { stage: "coin", label: "Coin toss" },
] as const;

/**
 * The pop-up that takes a room from "two players" to "the game starts": both choose a 60-card deck,
 * then the coin is tossed and whoever wins it decides who goes first.
 */
export default function VotePopup({ room }: { room: RoomSnapshot }) {
  useEffect(() => holdWallpaper(), []);
  const at = STEPS.findIndex((s) => s.stage === room.stage);
  const me = room.players.find((p) => p.seat === room.you);
  const guest = room.you === room.host ? room.players.find((p) => p.seat !== room.host) : undefined; // the host may still remove the guest

  return (
    <div role="dialog" aria-modal="true" aria-label="Choosing decks" className="sheet fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4">
      <div className={`flex max-h-[calc(100dvh-1rem)] w-full min-w-0 flex-col gap-4 overflow-x-hidden overflow-y-auto sm:max-h-[calc(100dvh-2rem)] sm:gap-5 leather ${room.stage === "decks" ? "max-w-[88rem] p-3 sm:p-7 lg:h-[calc(100dvh-2rem)] lg:overflow-y-hidden" :"max-w-lg p-3 sm:p-6"} text-white`}>
        <header className="flex items-center gap-3">
          <ol className="flex flex-1 items-center gap-2" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.stage} className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-[15px] font-bold max-sm:px-2.5 ${i === at ? "paper !border-[1.5px] !shadow-none" : i < at ? "bg-[#6b9a7f]/20 text-[#a9d4b9]" : "bg-white/10 text-slate-300"}`}>
                {i < at ? "✓" : `${i + 1}.`} <span className={i === at ? "" : "max-sm:hidden"}>{s.label}</span>
              </li>
            ))}
          </ol>
          {guest && !guest.bot && <KickButton name={guest.name} />}
          <button onClick={() => leaveRoom()} aria-label="Leave the table" title="Leave the table" className="btn-ghost !h-10 !w-10 !px-0">
            <Cross width={18} height={18} />
          </button>
        </header>

        {room.stage === "decks" && <DeckStep room={room} ready={me?.deckReady ?? false} />}
        {(room.stage === "coin" || room.stage === "playing") && room.coin && <CoinStep room={room} />}
      </div>
    </div>
  );
}

function PlayerChips({ room, show }: { room: RoomSnapshot; show: (p: RoomSnapshot["players"][number]) => React.ReactNode }) {
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {room.players.map((p) => (
        <li key={p.seat} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm">
          <span className="font-bold">{p.name}</span>
          {p.seat === room.you && <span className="text-slate-300"> (you)</span>}: {show(p)}
        </li>
      ))}
    </ul>
  );
}

function DeckStep({ room, ready }: { room: RoomSnapshot; ready: boolean }) {
  const size = room.size ?? 60; // every deck is 60 cards
  // The table: the card sleeve and playmat this player wants. The server shows them to both players (and to anyone watching).
  const [sleeve, setSleeve] = useState(() => myLook.read("sleeve"));
  const [mat, setMat] = useState(() => myLook.read("mat"));
  const [previewing, setPreviewing] = useState(false);
  const [finisher, setFinisherState] = useState<FinisherId>(() => getFinisher());
  useEffect(() => warmFinishers(finisher), [finisher]);
  // the finishing move is shown once, on the table behind this window, so the player sees what happens to the loser
  async function preview() {
    if (previewing) return;
    setPreviewing(true);
    try {
      await playChosenFinisher(null, null, finisher);
    } finally {
      setPreviewing(false);
    }
  }
  const [botLook] = useState(() => randomLook()); // against the computer, the host also dresses its table
  const vsBotRoom = room.players.some((p) => p.bot);
  useEffect(() => {
    send("look", { sleeve, mat, finisher, ...(vsBotRoom ? { bot: botLook } : {}) });
  }, [sleeve, mat, finisher, vsBotRoom, botLook]);
  const cachedChoices = useCached<DeckChoice[]>("playable-decks"); // last time's decks, shown at once while the fresh list loads
  const [fetchedOptions, setOptions] = useState<DeckChoice[] | null>(null);
  const options = fetchedOptions ?? (cachedChoices ? [...cachedChoices, STARTER] : null);
  const [choice, setChoice] = useState(RANDOM_ID);
  const [busy, setBusy] = useState(false);
  const touched = useRef(false); // the player picked a deck themselves: their pick is not replaced by the saved default
  const [saved, setSaved] = useState(false); // this pick was made the default
  const [loadFailed, setLoadFailed] = useState(false); // the decks could not be fetched (the login may have expired)
  const [attempt, setAttempt] = useState(0);

  // Every saved deck that is legal and fully playable, the ready-made decks and the starter deck; the menu keeps those of this size.
  useEffect(() => {
    let cancelled = false;
    listPlayableDecks()
      .then(({ choices }) => (writeCached("playable-decks", choices), [...choices, STARTER]))
      .then(async (found) => {
        // the deck (and table) picked last time are picked again, if the deck is still there
        const account = await loadDefaults();
        if (cancelled) return;
        setLoadFailed(false);
        setOptions(found);
        const want = readDeckDefault() || account.deck || "";
        if (!touched.current && want && found.some((o) => o.id === want && o.ids.length === size)) setChoice(want);
        if (account.sleeve && !myLook.read("sleeve")) setSleeve(account.sleeve);
        if (account.mat && !myLook.read("mat")) setMat(account.mat);
      })
      .catch(() => {
        // the starter deck and a random deck still work, but the player is told their decks are missing and can try again
        if (cancelled) return;
        setLoadFailed(true);
        setOptions((o) => o ?? [STARTER]);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm() {
    setBusy(true);
    try {
      const picked = options?.find((o) => o.id === choice && o.ids.length === size);
      const mine = picked ?? (await buildRandomDeck(size));
      // against the bot, the host also brings the bot's deck: a random one
      const vsBot = room.players.some((p) => p.bot);
      const botDeck = vsBot ? await buildRandomDeck(size) : undefined;
      // what was picked is the player's default from now on: the deck, the sleeve and the playmat
      void saveDefaults({ deck: choice, sleeve, mat });
      setSaved(true);
      send("deck", { name: picked ? picked.name : (mine as { name: string }).name, ids: picked ? picked.ids : (mine as { ids: string[] }).ids, ...(picked?.side ? { side: picked.side } : {}), ...(botDeck ? { botDeck: { name: botDeck.name, ids: botDeck.ids } } : {}) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-x-7 gap-y-4 text-center lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:text-left">
      {/* on a wide screen each side scrolls on its own: the table side's long content does not move the decks side */}
      <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        <div>
        <h2 className="text-3xl text-[#e8dcc0] sm:text-4xl">Bring your deck</h2>
        <p className="mt-1 text-base text-slate-200 sm:text-lg">
          {size} cards. {room.players.some((p) => p.bot) ? "The bot plays a random deck." : "Your opponent does not see which one you pick."}
        </p>
        </div>
        {loadFailed && (
          <p role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/50 bg-amber-950/60 px-3 py-2 text-left text-[15px] text-amber-100">
            <span className="min-w-0 flex-1">Your decks could not be loaded (your login may have expired). You can still play a random deck.</span>
            <button type="button" onClick={() => (setLoadFailed(false), setOptions(null), setAttempt((n) => n + 1))} className="btn-ghost !px-3 !py-1">
              Try again
            </button>
          </p>
        )}
        <DeckPicker choices={options ?? []} size={size} randomId={RANDOM_ID} value={choice} onChange={(id) => ((touched.current = true), setChoice(id))} disabled={ready} loading={options === null} wide />
      </div>
      <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
      <div className="rounded-2xl border border-white/20 bg-white/5 p-4 text-center">
        <h3 className="mb-3 text-xl text-[#e8dcc0]">Dress your side of the table</h3>
        <LookPicker
          large
          who={room.you}
          sleeve={sleeve}
          mat={mat}
          disabled={ready}
          onSleeve={(v) => (setSleeve(v), myLook.write("sleeve", v))}
          onMat={(v) => (setMat(v), myLook.write("mat", v))}
        />
        <div className="mt-4 border-t border-white/15 pt-4">
          <h3 className="mb-1 text-base font-bold uppercase tracking-widest text-[#e8dcc0]">Finishing move</h3>
          <p className="mb-3 text-sm text-slate-300">{FINISHERS.find((f) => f.id === finisher)?.blurb} It plays on your opponent&apos;s mat when you win.</p>
          <div className="mb-3 flex flex-wrap justify-center gap-2">
            {FINISHERS.map((f) => (
              <button
                key={f.id}
                onClick={() => (setFinisherState(f.id), setFinisher(f.id))}
                aria-pressed={finisher === f.id}
                className={finisher === f.id ? "paper !border-[1.5px] !px-3 !py-1.5 text-[15px] font-extrabold !shadow-none" : "btn-ghost !px-3 !py-1.5"}
              >
                {f.name}
              </button>
            ))}
          </div>
          <button onClick={() => void preview()} disabled={previewing} className="rounded-xl border border-white/30 bg-white/10 px-4 py-1.5 text-sm font-bold text-white hover:bg-white/20 disabled:opacity-40">
            {previewing ? "Playing…" : "Preview"}
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-300">{vsBotRoom ? "Your table is shown on your side of the battlefield." : "Your opponent sees your mat and sleeve on their screen, and you see theirs."}</p>
      </div>
      <button
        onClick={() => void confirm()}
        disabled={ready || busy || options === null}
        className="sheet-action btn-gold !px-8 !py-3.5 !text-xl sm:!py-4 sm:!text-2xl"
      >
        {ready ? "Ready, and waiting" : busy ? "Shuffling…" : "I am ready"}
      </button>
      <p className="text-center text-sm font-semibold text-slate-300">
        {saved || ready ? "Noted: next time this deck, sleeve and playmat are already waiting for you." : "Your deck, card sleeve and playmat are saved as your default when you press Ready."}
      </p>
      <PlayerChips room={room} show={(p) => (p.deckReady ? <span className="font-bold text-[#a9d4b9]">ready</span> : p.bot ? <span className="text-slate-300">is waiting on you</span> : <span className="text-slate-300">choosing…</span>)} />
      </div>
    </section>
  );
}

function CoinStep({ room }: { room: RoomSnapshot }) {
  const coin = room.coin!;
  const [landed, setLanded] = useState(false);
  const onLanded = useCallback(() => setLanded(true), []);
  const name = (seat: "p1" | "p2") => room.players.find((p) => p.seat === seat)?.name ?? "";
  const { call, result, winner } = coin;
  if (!call || !result || !winner) return <CallStep room={room} />;
  const iWon = winner === room.you;

  return (
    <section className="flex flex-col items-center gap-3 text-center">
      <h2 className="font-display text-3xl font-extrabold uppercase tracking-[0.2em] text-[#e8dcc0] [text-shadow:0_2px_18px_rgba(244,180,61,0.45)]">The coin toss</h2>
      <div className="relative">
        {/* a pool of warm light under the coin */}
        <div className="pointer-events-none absolute inset-x-6 -inset-y-2 rounded-full bg-[radial-gradient(closest-side,rgba(244,180,61,0.35),transparent)]" aria-hidden="true" />
        <CoinDisplay result={result} onLanded={onLanded} className="relative h-64 w-[min(22rem,80vw)]" />
      </div>
      {!landed ? (
        <p className="text-[15px] text-slate-200">
          {name(coin.caller)} called <span className="font-bold capitalize text-[#e8d9b5]">{call}</span>…
        </p>
      ) : (
        <>
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-amber-200/30 bg-amber-300/10 px-5 py-2 text-lg">
            <span className="font-display text-sm font-bold uppercase tracking-widest text-amber-200/80">It&apos;s</span>
            <span className="font-display text-2xl font-extrabold capitalize text-[#e8dcc0]">{result}</span>
            <span className="text-slate-100"><span className="font-bold text-[#e8d9b5]">{name(winner)}</span> wins the flip</span>
          </p>
          {coin.chose ? (
            <p className="rounded-full border border-emerald-300/30 bg-emerald-400/15 px-5 py-2 text-[15px] font-semibold text-[#a9d4b9]">
              {name(winner)} chose to go {coin.chose}. Starting the match…
            </p>
          ) : iWon ? (
            <>
              <p className="text-[15px] text-slate-200">Who plays first?</p>
              <div className="flex gap-3">
                <button onClick={() => send("order", { first: true })} className="btn-gold !px-7 !py-3 text-base">
                  I will go first
                </button>
                <button onClick={() => send("order", { first: false })} className="btn-ghost !px-7 !py-3 text-base">
                  Go second
                </button>
              </div>
            </>
          ) : (
            <p className="rounded-full border border-white/15 bg-white/10 px-5 py-2 text-[15px] text-slate-200">{name(winner)} is deciding who plays first…</p>
          )}
        </>
      )}
    </section>
  );
}

/** Before the flip: the caller picks heads or tails, the other player waits. */
function CallStep({ room }: { room: RoomSnapshot }) {
  const caller = room.coin!.caller;
  const callerName = room.players.find((p) => p.seat === caller)?.name ?? "";
  return (
    <section className="flex flex-col items-center gap-4 text-center">
      <div>
        <h2 className="font-display text-3xl font-extrabold uppercase tracking-[0.2em] text-[#e8dcc0] [text-shadow:0_2px_18px_rgba(244,180,61,0.45)]">The coin toss</h2>
        <p className="mt-1 text-[15px] text-slate-200">Whoever wins the toss decides who plays first.</p>
      </div>
      {caller === room.you ? (
        <>
          <p className="text-lg font-semibold">Call it!</p>
          <div className="flex gap-3">
            <button onClick={() => send("call", { side: "heads" })} className="btn-gold !px-7 !py-3 text-base">
              Heads
            </button>
            <button onClick={() => send("call", { side: "tails" })} className="btn-ghost !px-7 !py-3 text-base">
              Tails
            </button>
          </div>
        </>
      ) : (
        <p className="rounded-full border border-white/15 bg-white/10 px-5 py-2 text-[15px] text-slate-200">Waiting for {callerName} to call heads or tails…</p>
      )}
    </section>
  );
}
