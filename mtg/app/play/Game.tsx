"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import {
  applyAction,
  getCastable,
  getDamageAssignments,
  getLegalActions,
  liftedSpecs,
  getPossibleAttackers,
  getForcedBlocks,
  getPossibleBlockers,
  OPPONENT,
  parseCard,
  playerToAct,
  powerOf,
  suggestDamageAssignment,
  legalTargets,
} from "@mtg/engine";
import type { Action, Activatable, CardDef, GameEvent, GameState, Permanent, PlayerId, TargetChoice, TargetSpec } from "@mtg/engine";
import { useBattlefieldBackground } from "@/lib/background";
import { dismissNotice, leaveRoom, send as netSend, useOnline } from "@/lib/online/session";
import { Lightbox } from "./CardDetail";
import { HoverDetail, HoverPreview } from "./HoverPanels";
import { PREVIEW_W, setInspected, setPreview } from "./hoverStore";
import { useStacked, useTouch } from "./useMedia";
import CardView from "./CardView";
import { liveCardProps } from "./stats";
import RotateHint from "./RotateHint";
import ChainFx from "./ChainFx";
import LibraryReveal from "./LibraryReveal";
import { useStops } from "@/lib/stops";
import type { RevealPayload } from "@/lib/online/protocol";
import { PayPanel } from "./PayPanel";
import type { PayChoice } from "./PayPanel";
import type { Flash } from "./ChainFx";
import VotePopup from "../lobby/VotePopup";
import type { Inspected } from "./CardDetail";
import EnterBattlefield from "./EnterBattlefield";
import { attackersIn, isCombatPlaying, playCombat } from "./combatFx";
import { playCasts, playEffects, playLeaving } from "./effectFx";
import { ResignDialog, VictoryDialog } from "./EndDialogs";
import { GraveyardDialog, Pile } from "./Piles";
import ShuffleStage from "./ShuffleStage";
import { shufflePending } from "./shuffleStep";
import { primeAudio } from "@/lib/sound";
import { playChosenFinisher, warmFinishers } from "./finishers";
import { handDraws, hideDrawn, holdLibraryCounts, holdPiles, isPileBusy, playDeal, playDraws, playOpponentDiscards, playOpponentDraws, playToGraveyard, untilBattlefieldShown } from "./pileFx";
import type { Draw } from "./pileFx";
import { announcementsFrom, describeEvents, endReason, mergeAnnouncements, playerName, worthTelling } from "./log";
import type { Announcement } from "./log";
import { PassReminder, PlayedThisTurn, TurnSplash, WelcomeSplash } from "./Announcements";
import ResolveZone, { isRevealing } from "./ResolveZone";
import { lifeSettling } from "./lifeCount";
import { applyPerfClass } from "./perfTier";
import { ChatPanel, LogPanel, PlayersPanel } from "./SidePanels";
import { manaNotes } from "./manaInfo";
import type { ManaNote } from "./manaInfo";
import { useAppearance } from "@/lib/playmat";
import { useCustomCursor } from "@/lib/cursor";
import BlockPanel from "./BlockPanel";
import { attackHint, blockHint, canBlock } from "./combatHints";
import { cardAt, payWithLabel, printedLine, pumpNow, readable, tokenNames } from "./cardText";
import { ChoicePanel, LandFacePanel, XPanel } from "./ChoicePanels";
import { PickPanel, ResolvingNotice } from "./PickPanel";
import { StackPanel } from "./StackPanel";
import { chainSteps, nextChain } from "./chain";
import type { Chain } from "./chain";
import { TargetPanel } from "./TargetPanel";
import type { ChatMessage } from "./SidePanels";
import AbilitiesDialog from "./AbilitiesDialog";
import { abilityList, countAbilities, lockedAbilities, NO_ABILITIES } from "./abilityInfo";
import { Battlefield, Side } from "./Board";
import type { LaneContext } from "./Board";
import CastPlanPanels from "./CastPlanPanels";
import { splitAbility } from "./abilityText";
import { cardNameAnywhere, paymentOf, phyrexianChoices, preparedSpell } from "./castInfo";
import type { CastPlan } from "./castInfo";
import { AttackTargetsPanel, DamagePanel } from "./CombatPanels";
import CommandBar, { primaryAction } from "./CommandBar";
import HandRow from "./HandRow";
import { ManaText } from "./ManaSymbols";
import { KeepRandomDecks } from "./SaveDeck";
import type { PlayedDeck } from "./SaveDeck";
import StepBanner from "./StepBanner";
import { playGameSounds } from "./gameSounds";
import { useBattleFullscreen, useFullscreen } from "./useBattleFullscreen";
import { useOnlineMatch } from "./useOnlineMatch";


/** One way to pay Phyrexian mana: "Pay with mana: {B}{B}", "Pay 2 life and {B}", "Pay 4 life". */
function phyrexianLabel(choice: { life: number; mana: string }): React.ReactNode {
  if (choice.life === 0) return <>Pay with mana: <ManaText text={choice.mana} /></>;
  if (!choice.mana) return `Pay ${choice.life} life`;
  return <>Pay {choice.life} life and <ManaText text={choice.mana} /></>;
}

/** Width of the big card shown while the mouse is over a card in hand. */
/** How long "Your turn" stays on screen; matches the turn-splash animation in globals.css. */
const TURN_SPLASH_MS = 1800;
const WELCOME_MS = 2300; // how long "Welcome to the Battle Field, Now Duel!" stays up before the cards are dealt
// How long a player can sit on their own turn before being reminded to pass it; shorter once nothing is left to do.
const REMIND_IDLE_MS = 20000;
const REMIND_DONE_MS = 6000;

/**
 * The online play screen, one per match. Next.js keeps a page alive after leaving it (cacheComponents),
 * so without the key a new match would open on the last match's board and end popup.
 */
export function OnlineGame() {
  const { matchId, game, snapshot } = useOnline();
  const router = useRouter();
  // Leaving a match (Back to the lobby, or the room closing) must not bring the loading screen back for a moment: the board just goes.
  const [hadGame, setHadGame] = useState(false);
  const [left, setLeft] = useState(false);
  if (game && !hadGame) setHadGame(true);
  if (hadGame && !snapshot && !game && !left) setLeft(true);
  if (left && (snapshot || game)) {
    setLeft(false);
    setHadGame(!!game);
  }
  useEffect(() => {
    if (!left) return;
    const t = setTimeout(() => router.replace("/"), 400);
    return () => clearTimeout(t);
  }, [left, router]);
  const gameNo = snapshot?.series?.game ?? 1; // (each game of a best of 3 or 5 starts on a fresh board)
  // A rematch: the same two players choose their decks and the coin is tossed again, on this page; then a new game starts on a fresh board.
  const choosing = !!snapshot && !snapshot.spectating && (snapshot.stage === "decks" || snapshot.stage === "coin");
  const [rounds, setRounds] = useState(0);
  const [wasChoosing, setWasChoosing] = useState(false);
  if (choosing !== wasChoosing) {
    setWasChoosing(choosing);
    if (choosing) setRounds(rounds + 1);
  }
  // One "visit" per match. The match id arrives a moment after this screen opens (a while, on a slow connection): that
  // must not restart the loading screen or the board, so only leaving a match, or moving to another one, starts a new visit.
  const [seen, setSeen] = useState<string | null>(null);
  const [visit, setVisit] = useState(0);
  if (matchId !== seen) {
    setSeen(matchId);
    if (seen !== null) setVisit(visit + 1); // (from a match to none, or to a different match; from none to a match is the same visit)
  }
  if (left) return <main className="battlefield-bg min-h-[calc(100dvh-2.6rem)]" />;
  if (choosing && snapshot) {
    return (
      <main className="battlefield-bg min-h-[calc(100dvh-2.6rem)]">
        <VotePopup room={snapshot} />
      </main>
    );
  }
  return (
    <>
      <Game key={`game-${visit}-${rounds}-${gameNo}`} online />
      {/* the loading screen: up until the match has arrived from the server, then it fades */}
      <EnterBattlefield key={`enter-${visit}-${rounds}-${gameNo}`} ready={game !== null} names={game?.names} />
    </>
  );
}

/**
 * The play screen. On its own (hot-seat) it runs the game itself, with both players on one screen.
 * With `online` the game runs on the game server: this screen shows the game as the server describes it to this player,
 * sends this player's actions, and does nothing while it is the other player's turn.
 */
export default function Game({ online = false }: { online?: boolean } = {}) {
  const [localGame, setGame] = useState<GameState | null>(null);
  const net = useOnline();
  /** The game on screen: hot-seat, the one this screen has been updating, or (right after joining) the server's first view. */
  const game = localGame ?? (online ? (net.game?.view ?? null) : null);
  // The result screen comes up once the life totals have counted all the way down (even below zero), and a moment after, so the last hit is seen.
  useEffect(() => applyPerfClass(), []); // (cheaper effects and result screen on a weak computer)
  const won = !!game?.winner;
  const [endShown, setEndShown] = useState(false); // the result screen waits for the last life points to count down
  const [finisherDone, setFinisherDone] = useState(false); // ...and for the winner's finishing move
  const [liveSeen, setLiveSeen] = useState(false); // this screen saw the game being played (not a finished game opened afterwards: no finisher then)
  useEffect(() => {
    if (!won) {
      const off = setTimeout(() => (setEndShown(false), setFinisherDone(false), setLiveSeen(true)), 0);
      return () => clearTimeout(off);
    }
    // Every attacker has to finish its attack, and the life total has to finish counting (below zero too): only then does the result come up.
    // (A game that ends without a hit, like a resignation, shows it at once.)
    let t: ReturnType<typeof setTimeout>;
    let waited = false;
    const check = () => {
      if (isCombatPlaying() || lifeSettling() > 0) {
        waited = true;
        t = setTimeout(check, 150);
      } else t = setTimeout(() => setEndShown(true), waited ? 900 : 0);
    };
    check();
    return () => clearTimeout(t);
  }, [won]);
  const router = useRouter();
  // Which player this browser is. Remembered, because leaving the room at the end clears `net.game`:
  // falling back to the player to act would flip the screen (and the end popup) to the opponent's side.
  const [seat, setSeat] = useState<PlayerId | null>(null);
  if (online && net.game && net.game.you !== seat) setSeat(net.game.you);
  // Watching a match (not playing it): the board is drawn from one side, both hands are face down, and nothing can be done.
  const [watching, setWatching] = useState(false);
  if (online && net.game && (net.game.spectator === true) !== watching) setWatching(net.game.spectator === true);
  // Online: after getting back in (a lost connection, a server restart) the server's copy of the game replaces the one on screen.
  const [startSeen, setStartSeen] = useState(net.game);
  if (online && net.game !== startSeen) {
    setStartSeen(net.game);
    if (net.game && localGame) setGame(net.game.view);
  }
  const gameRef = useRef<GameState | null>(null);
  const commitRef = useRef<(r: { state: GameState; events: GameEvent[] }) => Promise<void>>(async () => {});
  const endTurnRef = useRef<() => Promise<void>>(async () => {});
  const [endingTurn, setEndingTurn] = useState<number | null>(null); // the turn "End turn" was pressed in
  const background = useBattlefieldBackground(); // the picture behind the battlefield
  const look = useAppearance(online ? (net.game?.looks ?? null) : null); // each player's card sleeves and playmat (online: what each chose before the match)
  const [menuOpen, setMenuOpen] = useState(false); // phones: the side panels (chat, log, looks) are a menu over the board
  const [peek, setPeek] = useState(false); // phones: the choice sheet is tucked away to see the board under it
  // a new panel in the sheet (a different question) always opens it
  const watchSheet = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const watch = new MutationObserver(() => setPeek(false));
    watch.observe(el, { childList: true });
    return () => watch.disconnect();
  }, []);
  const stacked = useStacked();
  const touch = useTouch(); // no mouse: nothing is "under" it, so no card is shown big on hover
  const [cursorOn] = useCustomCursor();
  useBattleFullscreen(game !== null); // the battle fills the whole screen, whatever its size
  const fullscreen = useFullscreen();
  // The Magic cursor is for the play screen only: the page gets a class while this screen is open.
  useEffect(() => {
    document.body.classList.toggle("mtg-cursor", cursorOn);
    return () => document.body.classList.remove("mtg-cursor");
  }, [cursorOn]);
  const [localLog, setLog] = useState<string[]>([]);
  const summary = online ? net.game?.summary : undefined;
  const log = useMemo(() => (summary ? [...localLog, summary] : localLog), [localLog, summary]); // newest first; the coin toss is the oldest line (the same list while nothing was added: the log is not drawn again)
  const [localError, setError] = useState<string | null>(null);
  const error = localError ?? (online ? net.error : null);
  const [attacking, setAttacking] = useState<string[]>([]);
  const [chosenBlocks, setBlocks] = useState<Record<string, string>>({}); // blocker iid -> attacker iid, as chosen by the player
  const [picked, setPicked] = useState<string | null>(null); // blocker waiting for an attacker
  const [handPick, setHandPick] = useState<string[]>([]); // cards chosen to bottom (mulligan) or discard (cleanup)
  const [assign, setAssign] = useState<Record<string, Record<string, number>>>({}); // attacker -> blocker -> damage
  const [localChat, setChat] = useState<ChatMessage[]>([]);
  const chat: ChatMessage[] = online ? net.chat.map((m) => ({ id: m.id, from: m.from, text: m.text })) : localChat;
  const [zoomed, setZoomed] = useState<CardDef | null>(null); // card shown large in the popup
  const [resigning, setResigning] = useState<PlayerId | null>(null); // player being asked to confirm a resignation
  // A spell or ability being set up: its targets are picked one by one, then `build` makes the action.
  const [targeting, setTargeting] = useState<{ title: string; specs: TargetSpec[]; build: (t: TargetChoice[]) => Action; detail?: string; cost?: string } | null>(null);
  const [chosen, setChosen] = useState<TargetChoice[]>([]);
  const [aimed, setAimed] = useState<TargetChoice | null>(null); // a target clicked, waiting for "Confirm target"
  const [confirmSkip, setConfirmSkip] = useState(false); // "Skip attack" and "No blocks" ask once more while a creature could attack or block
  const [plan, setPlan] = useState<CastPlan | null>(null); // a spell being cast step by step
  const [landFace, setLandFace] = useState<string | null>(null); // a modal land (a Pathway) waiting for its face to be chosen
  const [modePick, setModePick] = useState<number[]>([]);
  const [history, setHistory] = useState<Announcement[]>([]); // everything cast or used, kept for the turn
  const [announcements, setAnnouncements] = useState<Announcement[]>([]); // "Player 1 cast ...", shown on the caster's side
  const [revealing, setRevealing] = useState<{ items: Announcement[]; cards: Record<string, CardDef> } | null>(null); // online: the opponent's play, shown before the board changes
  const [chain, setChain] = useState<Chain>({ steps: [], over: false }); // spells and abilities answering each other, and how each left the stack
  const [manaNote, setManaNote] = useState<Partial<Record<PlayerId, ManaNote>>>({}); // "−2 paid for Become Immense", next to each player's mana
  const [lifeConfirm, setLifeConfirm] = useState<{ text: string; options: { label: React.ReactNode; go: () => void }[] } | null>(null); // "this costs life / taps a creature: do it?"
  const [xValue, setXValue] = useState(0);
  const [abilityX, setAbilityX] = useState<{ a: Activatable; payWith?: string } | null>(null); // an ability with {X} in its cost, waiting for the player's X
  const [attackTargets, setAttackTargets] = useState<Record<string, string>>({}); // attacker iid -> planeswalker iid
  const [abilitiesOpen, setAbilitiesOpen] = useState(false); // the abilities pop-up
  const [abilityFocus, setAbilityFocus] = useState<string | null>(null); // a battlefield card clicked to see only its abilities
  const [viewingYard, setViewingYard] = useState<{ owner: PlayerId; zone: "graveyard" | "exile" } | null>(null); // whose graveyard or exile is open
  const [endNote, setEndNote] = useState<string | null>(null); // how the game ended, for the win popup
  // The finishing move (the one this player picked): it hits the loser's mat once the last blow has landed, and the result comes up after it.
  const finisherWinner = game?.winner === "p1" || game?.winner === "p2" ? game.winner : null;
  const finisherOn = !!finisherWinner && liveSeen && !(endNote ?? "").includes("resigned");
  const resultReady = endShown && (!finisherOn || finisherDone);
  const finisherPlayed = useRef(false);
  useEffect(() => warmFinishers(), []);
  useEffect(() => {
    if (!endShown || !finisherOn || !finisherWinner || finisherDone || finisherPlayed.current) return;
    finisherPlayed.current = true;
    void playChosenFinisher(finisherWinner, OPPONENT[finisherWinner]).finally(() => setTimeout(() => setFinisherDone(true), 300));
  }, [endShown, finisherOn, finisherWinner, finisherDone]);
  useEffect(() => {
    if (!won) finisherPlayed.current = false;
  }, [won]);
  useEffect(() => {
    const id = window.setTimeout(primeAudio, 1200); // (the first sound of the match must not be the one that builds the audio)
    return () => window.clearTimeout(id);
  }, []);
  const [stageSeen, setStageSeen] = useState(false); // the shuffle step was on screen
  const [stageDone, setStageDone] = useState(false); // ...and the decks are back at their libraries
  const [intro, setIntro] = useState(false); // the loading screen and the welcome message are still on: the decks wait for them
  const stageDoneRef = useRef(false);
  useEffect(() => () => (setInspected(null), setPreview(null)), []); // (what the mouse was over does not follow the player to another page)
  const [welcome, setWelcome] = useState(false); // "Welcome to the Battle Field, Now Duel!" while it is on screen
  const [payChoice, setPayChoice] = useState<PayChoice | null>(null);
  const [stops, setStop] = useStops(); // where the game waits for this player to pass priority
  const [seenReveal, setSeenReveal] = useState<RevealPayload | null>(null); // the libraries were shown, and the player moved on to the result
  const [triggerFlash, setTriggerFlash] = useState<Flash | null>(null); // triggers that resolved at once: the chain shows them too
  const [turnSplash, setTurnSplash] = useState(0); // online: counts "Your turn" splashes, 0 while none is on screen

  const deckNames = net.game ? net.game.deckNames : { p1: "", p2: "" }; // shown on each library
  const [savedDecks, setSavedDecks] = useState<Partial<Record<PlayerId, string>>>({}); // random decks kept in My decks: the copy's id

  useEffect(() => {
    gameRef.current = game;
    commitRef.current = commit;
    endTurnRef.current = endTurn;
  });

  // Hot-seat: "End turn" stopped for a choice along the way (a trigger's target) carries on once it's settled. Online the server does this.
  useEffect(() => {
    if (online || !game || endingTurn !== game.turn || game.winner || game.phase === "cleanup") return;
    if (game.priority || game.pendingChoice || game.pendingPick) return;
    void endTurnRef.current();
  }, [online, game, endingTurn]);   

  useEffect(() => {
    if (Object.keys(manaNote).length === 0) return;
    const t = setTimeout(() => setManaNote({}), 4500);
    return () => clearTimeout(t);
  }, [manaNote]);

  // A chain's summary goes away by itself after a while (or when the next chain starts).
  useEffect(() => {
    if (!chain.over) return;
    const t = setTimeout(() => setChain({ steps: [], over: false }), 15000);
    return () => clearTimeout(t);
  }, [chain]);

  useOnlineMatch(online, game, seat, gameRef, commitRef, openingDeal);
  // The server runs the game: it is told where this player wants priority stops (when the match starts, and whenever they are changed).
  const inGame = game !== null;
  useEffect(() => {
    if (!online || watching || !inGame) return;
    netSend("action", { action: { type: "setStops", stops } });
  }, [online, watching, inGame, stops]);

  // The "Your turn" splash goes away by itself.
  useEffect(() => {
    if (turnSplash === 0) return;
    const timer = setTimeout(() => setTurnSplash(0), TURN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, [turnSplash]);

  // An announcement fades away by itself after a few seconds.
  useEffect(() => {
    if (announcements.length === 0) return;
    const timer = setTimeout(() => setAnnouncements((l) => l.slice(1)), 7000);
    return () => clearTimeout(timer);
  }, [announcements]);

  function resetSelection() {
    setTargeting(null);
    setChosen([]);
    setAimed(null);
    setConfirmSkip(false);
    setPlan(null);
    setLandFace(null);
    setAbilityX(null);
    setLifeConfirm(null);
    setModePick([]);
    setAttackTargets({});
    setAttacking([]);
    setBlocks({});
    setPicked(null);
    setHandPick([]);
    setAssign({});
  }

  if (online && !game) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-zinc-900">
        <h1 className="text-2xl font-bold">Joining the match…</h1>
        <p className="text-zinc-600">If this takes more than a few seconds you will be taken back to the lobby.</p>
        <button
          onClick={() => {
            leaveRoom();
            router.push("/");
          }}
          className="btn-ghost"
        >
          ← Back to dashboard
        </button>
      </main>
    );
  }

  if (!game) return null; // (the match arrives from the game server: the screen above covers the wait)

  const state = game;
  if (shufflePending(state) && !stageSeen) setStageSeen(true); // the shuffle step starts
  const actor = seat ?? playerToAct(state);
  /** Hot-seat: always true. Online: only while the game is waiting for this player. */
  const mine = !online || (!watching && playerToAct(state) === actor);
  const other = OPPONENT[actor];
  // Online the server only tells each player their own deck.
  const playedDecks: Partial<Record<PlayerId, PlayedDeck>> = net.game?.deck ? { [actor]: net.game.deck } : {};
  const keepDeck = (who: PlayerId, id: string) => setSavedDecks((s) => ({ ...s, [who]: id }));
  // Someone who is only watching can do nothing, so none of what could be done is worked out for them (these rules checks run after every move).
  const legal = watching ? [] : getLegalActions(state, actor);
  const playable = new Set(legal.flatMap((a) => (a.type === "playLand" || a.type === "castCreature" || a.type === "castSpell" ? [a.iid] : [])));
  const possibleAttackers = watching ? [] : getPossibleAttackers(state);
  const possibleBlockers = watching ? [] : getPossibleBlockers(state);
  // Blocks the rules force ("all creatures able to block it do so") are part of the blocks from the start.
  const blocks = { ...chosenBlocks, ...(watching ? {} : Object.fromEntries(getForcedBlocks(state).map((f) => [f.blocker, f.attacker]))) };
  const attackerIds = state.combat?.attackers.map((a) => a.attacker) ?? [];

  /**
   * Applies an action for `as` (the player to act, unless someone resigns out of turn). Before it is applied the player is asked about
   * anything they might not want: life paid for Phyrexian mana (or mana, when they could pay life instead), and creatures tapped for mana
   * (which could attack or block instead).
   */
  async function act(action: Action, as: PlayerId = actor, opts: { life?: boolean; mana?: boolean; pointless?: boolean; spare?: string[]; paid?: boolean } = {}) {
    if (watching || isCombatPlaying() || isPileBusy() || isRevealing()) return; // a watcher can't act; and ignore clicks while something is being animated
    const spare = opts.spare ?? [];
    const pay = paymentOf(state, action, as, spare);
    if (!pay.ok && spare.length > 0) {
      setLifeConfirm(null);
      setError("There is not enough mana without using that card.");
      return;
    }
    // Mana management: nothing is tapped for the player. Anything that costs mana asks which mana to spend first.
    if (!opts.paid && pay.ok && pay.made.length > 0 && (action.type === "castSpell" || action.type === "castCreature" || action.type === "activateAbility")) {
      setPayChoice({ action, as });
      return;
    }
    const lifeOrMana = phyrexianChoices(state, action, as, spare);
    if (lifeOrMana.length > 0 && (action.type === "castSpell" || action.type === "activateAbility")) {
      setLifeConfirm({
        text: `${cardNameAnywhere(state, action.iid)}: pay its Phyrexian mana with mana, or with 2 life for each symbol? You are at ${state.players[as].life} life.`,
        options: lifeOrMana.map((c) => ({ label: phyrexianLabel(c), go: () => act(c.action, as, c.life > 0 ? { ...opts, life: true } : opts) })),
      });
      return;
    }
    const nameOfIid = (iid: string) => {
      const perm = state.players[as].battlefield.find((p) => p.card.iid === iid);
      return perm ? state.cards[perm.card.defId].name : "a card";
    };
    if (!opts.mana && pay.ask.length > 0) {
      const names = pay.ask.map(nameOfIid).join(" and ");
      const symbols = (iids: (iid: string) => boolean) => pay.made.filter((m) => iids(m.iid)).map((m) => `{${m.color}}`).join("");
      const rest = [...new Set(pay.made.filter((m) => !pay.ask.includes(m.iid)).map((m) => m.iid))].map((iid) => `${nameOfIid(iid)} ${symbols((x) => x === iid)}`);
      const what = "iid" in action && action.iid ? `${cardNameAnywhere(state, action.iid)}: ` : "";
      setLifeConfirm({
        text: `${what ? `${what}tap` : "Tap"} ${names} for ${symbols((x) => pay.ask.includes(x))}? A creature tapped for mana can't attack or block until it untaps.${rest.length > 0 ? ` The rest is paid by ${rest.join(", ")}.` : ""}`,
        options: [
          { label: <>Yes, tap {names} for <ManaText text={symbols((x) => pay.ask.includes(x))} /></>, go: () => act(action, as, { ...opts, mana: true }) },
          { label: `No, keep ${names} untapped`, go: () => act(action, as, { ...opts, spare: [...spare, ...pay.ask] }) },
        ],
      });
      return;
    }
    if (!opts.life && pay.life > 0) {
      setLifeConfirm({
        text: `This will cost you ${pay.life} life, because you don't have the mana to pay for it. You are at ${state.players[as].life} life.`,
        options: [{ label: "Yes, pay the life", go: () => act(action, as, { ...opts, life: true }) }],
      });
      return;
    }
    // A spell that only affects attacking creatures does nothing when none are attacking.
    if (!opts.pointless && action.type === "castSpell" && !state.combat) {
      const card = state.players[as].hand.find((c) => c.iid === action.iid);
      const spell = card ? parseCard(state.cards[card.defId]).spell : undefined;
      if (card && spell && !spell.modal && spell.effects.length > 0 && spell.effects.every((e) => "what" in e && e.what?.t === "attackingCreatures")) {
        setLifeConfirm({
          text: `No creature is attacking right now, so ${state.cards[card.defId].name} would do nothing. Cast it during combat, after attackers are declared.`,
          options: [{ label: "Cast it anyway", go: () => act(action, as, { ...opts, pointless: true }) }],
        });
        return;
      }
    }
    setLifeConfirm(null);
    const held = spare.length > 0 ? { ...state, players: { ...state.players, [as]: { ...state.players[as], spareMana: spare } } } : state;
    if (online) {
      // The server runs the rules: send the action, and the result comes back as an update.
      if (!mine && action.type !== "concede") {
        setError("Wait for your opponent.");
        return;
      }
      netSend("action", { action, ...(spare.length > 0 ? { spare } : {}) });
      setError(null);
      return;
    }
    const r = applyAction(held, as, action);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    r.state.players[as].spareMana = undefined;
    // Combat damage: play the attack on the board as it is now, then show the result.
    const fought = attackersIn(state, r.events);
    // The screen edges flash for the player who is being attacked, not for the attacker (online; hot-seat shares one screen).
    if (fought.length > 0) await playCombat(r.events, fought, { flash: !online || seat === OPPONENT[state.active] });
    await commit(r);
    setError(null);
  }

  /**
   * Shows the result of an action: cards that died fly to the graveyard first, then the new state appears and
   * the cards that were drawn fly out of the library, turn over in the middle and land in the hand.
   */
  async function commit(r: { state: GameState; events: GameEvent[] }) {
    const viewer = seat ?? playerToAct(r.state);
    playGameSounds(r.events, online ? viewer : null);
    // Everything cast, used or triggered and resolved within this one step (nobody had to pass for it) plays as links of the chain, on its own,
    // before the board changes. (What stayed on the stack was already on screen as the chain while it waited.)
    const told = announcementsFrom(r.events, r.state).map((a): Announcement => (a.done && !a.later ? { ...a, flashed: true } : a));
    const quick = told.filter((a) => a.flashed);
    if (quick.length > 0) {
      // (Nothing waits for it: the board and whose turn it is to answer update at once, so a response (a counterspell) is possible while the chain plays.)
      flushSync(() => setTriggerFlash((f) => ({ key: (f?.key ?? 0) + 1, items: quick })));
    }
    const gone = r.events.flatMap((e) => (e.type === "creatureDied" ? [e.iid] : e.type === "cardsDiscarded" ? e.iids : []));
    const before = gameRef.current; // the board as it was, to see what this action changed
    const steps = chainSteps(r.events, before ?? r.state, r.state);
    await playCasts(r.events, r.state); // beams fly to their targets, and the result shows as they land
    await playLeaving(before, r.state, r.events); // exiled or returned cards fade away first
    await playToGraveyard(gone, new Set(r.events.flatMap((e) => (e.type === "creatureDied" ? [e.iid] : []))));
    // The other player's hand is a number, not cards: their draws and discards fly to and from it.
    playOpponentDraws(r.events.flatMap((e) => (e.type === "cardDrawn" && e.player !== viewer && gameRef.current?.phase !== "mulligan" ? [e.player] : [])));
    playOpponentDiscards(r.events.flatMap((e) => (e.type === "cardsDiscarded" && e.player !== viewer ? e.iids.flatMap((iid) => { const c = [...r.state.players[e.player].graveyard, ...(before?.players[e.player].hand ?? [])].find((x) => x.iid === iid); return c ? [{ owner: e.player, def: r.state.cards[c.defId] }] : []; }) : [])));
    // Only the viewer's own cards are animated: the opponent's hand is just a count, so their draw or mulligan
    // would fly across this screen as if it were the viewer's.
    const draws: Draw[] = gameRef.current?.phase === "mulligan" ? [] : r.events.flatMap((e) => {
      const card = e.type === "cardDrawn" && e.player === viewer ? r.state.players[viewer].hand.find((c) => c.iid === e.iid) : undefined;
      return card ? [{ iid: card.iid, owner: viewer, faceUp: true, def: r.state.cards[card.defId] }] : [];
    }).slice(0, 3);
    // A mulligan deals a whole new hand.
    const redeal = r.events.some((e) => e.type === "mulliganTaken" && e.player === viewer);
    const dealt: Draw[] = redeal ? handDraws(r.state, seat) : [];
    // flushSync puts the new cards on the page right away, so they can be hidden before they are ever painted.
    flushSync(() => {
      setGame(r.state);
      setPreview(null);
      setLog((l) => [...describeEvents(r.events, r.state).reverse(), ...l].slice(0, 300));
      setEndNote(endReason(r.events, r.state));
      setChain((c) => nextChain(c, steps, before, r.state));
      const notes = manaNotes(before, r.state, r.events);
      if (Object.keys(notes).length > 0) setManaNote((n) => ({ ...n, ...notes }));
      // Online: the opponent passed the turn. Said loudly, in case this player looked away while waiting.
      if (online && r.events.some((e) => e.type === "turnStarted" && e.player === viewer)) setTurnSplash((n) => n + 1);
      setRevealing(null);
      if (told.length > 0) {
        setAnnouncements((a) => mergeAnnouncements(a, told).slice(-4));
        setHistory((h) => mergeAnnouncements(h, told).slice(-40));
      }
      resetSelection();
    });
    playEffects(before, r.state, r.events); // beams, numbers, counters, new cards: they play while the game carries on
    hideDrawn(draws);
    await playDraws(draws);
    if (redeal) {
      hideDrawn(dealt);
      await playDeal(dealt);
    }
  }

  /**
   * The start of a match: the opening hand stays hidden while the loading screen fades and, for the players, "Welcome to the
   * Battle Field, Now Duel!" shows on the board. Then the cards are dealt from the library.
   */
  async function openingDeal(hand: Draw[], greet: boolean, start?: GameState) {
    hideDrawn(hand);
    const first = start ?? gameRef.current;
    if (first) holdLibraryCounts(first); // the libraries show 60 until the cards are dealt
    setIntro(true);
    const release = holdPiles(); // clicks wait for the cards
    try {
      await untilBattlefieldShown();
      if (greet) {
        setWelcome(true);
        await new Promise((r) => setTimeout(r, WELCOME_MS));
        setWelcome(false);
      }
    } finally {
      release();
      setIntro(false);
    }
    // The decks are shuffled across the table first (each player shuffles the other's; clicks must work meanwhile), then the hands are dealt.
    const giveUp = Date.now() + 10 * 60_000;
    // (both players must have shuffled the other's deck, and the decks be back home, before a card is dealt)
    const waiting = () => {
      const g = gameRef.current;
      return !!g?.opening?.shuffled && (shufflePending(g) || !stageDoneRef.current);
    };
    while (Date.now() < giveUp && waiting()) await new Promise((r) => setTimeout(r, 60));
    await playDeal(hand);
  }

  /**
   * Passes through the rest of the turn in one click (used when there is nothing to attack with).
   * Stops early if the player has to make a choice, such as discarding down to seven cards.
   */
  async function endTurn() {
    if (isCombatPlaying() || isPileBusy() || isRevealing()) return;
    setEndingTurn(state.turn);
    if (online) {
      if (mine) netSend("endTurn");
      return;
    }
    let s = state;
    const events: GameEvent[] = [];
    for (let i = 0; i < 6 && s.turn === state.turn && !s.winner && s.phase !== "cleanup"; i++) {
      const r = applyAction(s, playerToAct(s), { type: "passPhase" });
      if (!r.ok) {
        if (i === 0) setError(r.error); // later on, a trigger along the way needs a choice first: the turn carries on after it
        break;
      }
      s = r.state;
      events.push(...r.events);
    }
    await commit({ state: s, events });
  }

  function clickHandCard(iid: string, defId: string) {
    if (state.phase === "mulligan" && mulligansTaken === 0) return; // keep or mulligan: nothing to pick yet
    if (state.phase === "mulligan" || state.phase === "cleanup") {
      // Choosing cards to put on the bottom (mulligan) or to discard (cleanup).
      setHandPick((p) => (p.includes(iid) ? p.filter((x) => x !== iid) : [...p, iid]));
      return;
    }
    if (state.cards[defId].type === "land") {
      if (state.cards[`${defId}//back`]?.type === "land") setLandFace(iid);
      else act({ type: "playLand", iid });
      return;
    }
    // A card in exile that may be played (Expressive Iteration) is shown with the hand and cast the same way.
    const inExile = state.players[actor].exile.some((c) => c.iid === iid);
    const ways = getCastable(state, actor).filter((c) => c.iid === iid && (inExile ? c.zone === "exile" : c.zone === undefined));
    const castable = ways.find((c) => !c.adventure) ?? ways[0];
    if (!castable) {
      act({ type: "castSpell", iid, targets: [] }); // not castable now: the engine says why
      return;
    }
    const adventure = ways.find((c) => c.adventure);
    advance({ iid, name: state.cards[defId].name, castable, ...(inExile ? { from: "exile" as const } : {}), ...(adventure ? { adventureCastable: adventure } : {}) });
  }

  /** Moves a spell on to whatever it still needs: modes, the kicker, X, targets, and finally the cast itself. */
  function advance(p: CastPlan) {
    const c = p.castable;
    setPlan(p);
    if (p.adventureCastable && p.adventure === undefined) return; // the creature-or-Adventure panel is shown
    if (c.teamwork && p.teamwork === undefined) return; // the teamwork panel is shown
    if (c.modal && p.modes === undefined) return; // the mode panel is shown
    if (c.warp !== undefined && p.warp === undefined) return; // the warp panel is shown
    if ((c.kicker !== undefined || c.blight) && p.kicked === undefined) return; // the kicker (offspring, blight) panel is shown
    if (c.blight && p.kicked && p.sacrifice === undefined) return; // the creature to blight
    if (c.maxX !== undefined && p.x === undefined) {
      setXValue(c.maxX);
      return;
    }
    if (c.delve && p.delve === undefined) return; // the delve panel is shown
    if (c.replicate && c.replicate.max > 0 && p.replicate === undefined) return; // the replicate panel is shown
    if (c.harmonize && c.harmonize.options.length > 0 && p.harmonizeTap === undefined) return; // the harmonize panel is shown
    if ((c.sacrifice || c.discard) && p.sacrifice === undefined) return; // the sacrifice (or discard) panel is shown
    const baseSpecs = c.modal ? (p.modes ?? []).flatMap((m) => c.modal!.modes[m].specs) : c.specs;
    const ownSpecs = (p.teamwork?.length ?? 0) > 0 ? liftedSpecs(baseSpecs) : baseSpecs; // teamwork can waive a limit on the target
    const specs = Array.from({ length: 1 + (p.replicate ?? 0) }, () => ownSpecs).flat(); // each replicate copy has targets of its own
    const build = (targets: TargetChoice[]): Action => ({
      type: "castSpell",
      iid: p.iid,
      targets,
      ...(p.from ? { from: p.from } : {}),
      ...(p.modes ? { modes: p.modes } : {}),
      ...(p.kicked ? { kicked: true } : {}),
      ...(p.teamwork?.length ? { teamwork: p.teamwork } : {}),
      ...(p.x !== undefined ? { x: p.x } : {}),
      ...(p.sacrifice ? { sacrifice: p.sacrifice } : {}),
      ...(p.warp ? { warp: true } : {}),
      ...(p.delve ? { delve: p.delve } : {}),
      ...(p.replicate ? { replicate: p.replicate } : {}),
      ...(p.adventure ? { adventure: true } : {}),
      ...(p.harmonizeTap ? { harmonizeTap: p.harmonizeTap } : {}),
    });
    const title = p.name + (p.x !== undefined && c.maxX !== undefined ? ` (X = ${p.x})` : "") + (p.kicked ? (c.blight ? " (blighted)" : c.kickerName === "offspring" ? " (with offspring)" : c.kickerName === "waterbend" ? " (waterbend)" : c.kickerName === "buyback" ? " (buyback)" : " (kicked)") : "") + (p.teamwork?.length ? " (teamwork)" : "") + (p.warp ? " (warp)" : "") + (p.replicate ? ` (${p.replicate + 1} copies with replicate)` : "");
    setPlan(null);
    if (specs.length === 0) {
      act(build([]));
    } else {
      setChosen([]);
      // what the spell does, from the card itself, shown while choosing
      const spellCard = Object.values(state.players).flatMap((pl) => [...pl.hand, ...pl.graveyard, ...pl.exile]).find((card) => card.iid === p.iid);
      const spellText = p.from === "prepared" ? preparedSpell(state, actor, p.iid)?.spell.text : spellCard ? state.cards[spellCard.defId].text : undefined;
      setTargeting({ title, specs, build, detail: spellText ? readable(spellText, p.name) : undefined });
    }
  }

  function startLoyalty(a: { iid: string; index: number; specs: TargetSpec[]; text: string }) {
    if (a.specs.length === 0) {
      act({ type: "loyalty", iid: a.iid, index: a.index, targets: [] });
    } else {
      setChosen([]);
      setTargeting({ title: readable(a.text.replace(/^[+-]?\d+: /, ""), state.cards[Object.values(state.players).flatMap((p) => p.battlefield).find((x) => x.card.iid === a.iid)!.card.defId].name), specs: a.specs, build: (targets) => ({ type: "loyalty", iid: a.iid, index: a.index, targets }) });
    }
  }

  function startAbility(a: Activatable, payWith?: string, x?: number) {
    const at = cardAt(state, a.iid);
    const name = at?.def.name ?? cardNameAnywhere(state, a.iid);
    const words = splitAbility(printedLine(a.text, at?.def), name);
    const cost = words.cost ? readable(words.cost, name) : undefined;
    const effects = at ? (parseCard(at.def).activated[a.index]?.effects ?? []) : [];
    // "Discard a card" / "Sacrifice a creature" as a cost: ask which one first.
    if (a.costChoices && payWith === undefined) {
      setLifeConfirm({
        text: `${name}: choose ${tokenNames(a.costLabel ?? "a card")}${cost ? ` (${cost} ➜ ${words.effect})` : ""}`,
        options: a.costChoices.map((iid) => ({ label: payWithLabel(state, iid, effects), go: () => startAbility(a, iid, undefined) })),
      });
      return;
    }
    setLifeConfirm(null);
    // "{X}{R}, {T}, Sacrifice ~: deals X damage": the player chooses X first (up to what they can pay).
    if (a.maxX !== undefined && x === undefined) {
      setXValue(a.maxX);
      setAbilityX({ a, ...(payWith !== undefined ? { payWith } : {}) });
      return;
    }
    setAbilityX(null);
    const extra = { ...(payWith === undefined ? {} : { payWith }), ...(x === undefined ? {} : { x }) };
    if (a.specs.length === 0) {
      act({ type: "activateAbility", iid: a.iid, index: a.index, targets: [], ...extra });
    } else {
      setChosen([]);
      const now = at ? pumpNow(state, at.player, effects) : null;
      setTargeting({ title: `${name}: ${words.effect}`, cost, ...(now ? { detail: now } : {}), specs: a.specs, build: (targets) => ({ type: "activateAbility", iid: a.iid, index: a.index, targets, ...extra }) });
    }
  }

  /** One more target picked: when every need is filled, the spell, ability or trigger is put on the stack. */
  function pickTarget(t: TargetChoice) {
    const ctx = state.pendingChoice ? { specs: state.pendingChoice.specs, build: (targets: TargetChoice[]) => ({ type: "chooseTargets", targets }) as Action } : targeting;
    if (!ctx) return;
    setAimed(null);
    const next = [...chosen, t];
    if (next.length < ctx.specs.length) setChosen(next);
    else act(ctx.build(next));
  }

  // While choosing a target, every creature or permanent that can be chosen glows, and clicking the card itself picks it.
  const targetingSpec = (state.pendingChoice ? state.pendingChoice.specs : targeting?.specs)?.[chosen.length];
  const clickableTargets = new Set<string>(
    targetingSpec
      ? legalTargets(state, targetingSpec, state.pendingChoice ? state.pendingChoice.item.controller : actor).flatMap((t) => (t.kind === "permanent" ? [t.iid] : []))
      : [],
  );

  /** Returns click handler + ring styling for a permanent, depending on the current step. */
  function interaction(owner: PlayerId, perm: Permanent): { onClick?: () => void; ring: string; note?: string; combat?: { tone: string; label: string; why?: string }; dim?: boolean } {
    if (online && !mine) return { ring: "" };
    const iid = perm.card.iid;
    const def = state.cards[perm.card.defId];
    const isCreature = def.type === "creature" || perm.crewed === true;
    if (clickableTargets.has(iid) && aimed?.kind === "permanent" && aimed.iid === iid) {
      return { ring: "ring-4 ring-amber-400", combat: { tone: "block", label: "🎯 Confirm the target", why: "Press Confirm target in the panel, or click another card." }, onClick: () => setAimed(null) };
    }
    if (clickableTargets.has(iid)) {
      return { ring: "ring-4 ring-sky-400", combat: { tone: "block", label: "🎯 Click to target", why: "Choose this as the target." }, onClick: () => setAimed({ kind: "permanent", iid }) };
    }
    if (clickableTargets.size > 0) return { ring: "", dim: true }; // not a legal target right now
    if (state.phase === "attackers" && owner === actor) {
      if (possibleAttackers.includes(iid)) {
        const on = attacking.includes(iid);
        return {
          ring: "",
          combat: on ? { tone: "threat", label: "⚔ Attacking", why: "Click to take it out of the attack." } : attackHint(state, actor, perm),
          onClick: () => setAttacking((a) => (on ? a.filter((x) => x !== iid) : [...a, iid])),
        };
      }
      if (isCreature) return { ring: "", dim: true }; // can't attack this turn (tapped, just arrived, defender...)
    }
    if (state.phase === "blockers") {
      if (owner === actor && possibleBlockers.includes(iid)) {
        // Players may still respond to the attack: blockers are declared once both pass. Until then, advice without clicks.
        if (state.priority) return { ring: "", combat: blockHint(state, actor, perm) };
        if (getForcedBlocks(state).some((f) => f.blocker === iid)) return { ring: "", combat: { tone: "blocked", label: "🛡 Must block", why: "An attacker's text forces every creature able to block it to do so." } };
        const target = blocks[iid];
        return {
          ring: picked === iid ? "ring-4 ring-sky-400" : "",
          combat: target ? { tone: "blocked", label: "🛡 Blocking", why: "Click to stop blocking with it." } : picked === iid ? { tone: "block", label: "Now click an attacker" } : blockHint(state, actor, perm),
          onClick: () => {
            if (target) {
              setBlocks((b) => Object.fromEntries(Object.entries(b).filter(([blocker]) => blocker !== iid)));
            } else if (attackerIds.length === 1 && canBlock(state, actor, iid, attackerIds[0]).ok) {
              setBlocks((b) => ({ ...b, [iid]: attackerIds[0] })); // only one attacker: the click blocks it
              setPicked(null);
            } else {
              setPicked(picked === iid ? null : iid);
            }
          },
        };
      }
      if (owner === actor && isCreature) return { ring: "", dim: true }; // can't block
      if (owner !== actor && attackerIds.includes(iid)) {
        const blockedBy = Object.values(blocks).filter((a) => a === iid).length;
        const legal = picked ? canBlock(state, actor, picked, iid) : null;
        if (legal && !legal.ok) return { ring: "", dim: true, combat: { tone: "threat", label: "Can't block this", why: legal.reason } };
        return {
          ring: picked ? "ring-4 ring-red-400" : "",
          combat: blockedBy ? { tone: "blocked", label: `Blocked ×${blockedBy}` } : { tone: "threat", label: picked ? "Block this one" : "⚔ Attacking", why: `Deals ${powerOf(state, perm)} damage if nobody blocks it.` },
          onClick: picked
            ? () => {
                setBlocks((b) => ({ ...b, [picked]: iid }));
                setPicked(null);
              }
            : undefined,
        };
      }
    }
    // A card of yours that has something to do right now (an ability, loyalty, crew, cycling): it glows, and a click shows just its abilities.
    if (owner === actor && mine && !state.pendingChoice && !targeting && !plan && abilityIids.has(iid)) {
      return { ring: "ring-2 ring-emerald-400", note: "⚡ Ability", onClick: () => setAbilityFocus(iid) };
    }
    return { ring: "" };
  }

  /** Is this creature in the combat zone? Chosen or declared attackers, and chosen or declared blockers, leave their row and stand there. */
  function inCombat(owner: PlayerId, perm: Permanent): boolean {
    const iid = perm.card.iid;
    if (attackerIds.includes(iid) || state.combat?.attackers.some((a) => a.blockers.includes(iid))) return true;
    if (owner === actor && state.phase === "attackers" && attacking.includes(iid)) return true;
    if (owner === actor && state.phase === "blockers" && blocks[iid]) return true;
    return false;
  }

  const mulligansTaken = state.opening?.taken[actor] ?? 0;
  const damageNeeded = state.phase === "damage" ? getDamageAssignments(state) : [];
  const effectiveAssign = (attacker: string) => assign[attacker] ?? suggestDamageAssignment(state, attacker);
  const primary = primaryAction(state, actor, mine, { handPick, attacking, attackTargets, blocks, damageTo: effectiveAssign });
  // The big button would give up an attack or blocks that could be made.
  const skipping =
    state.phase === "blockers" ? Object.keys(blocks).length === 0 && possibleBlockers.length > 0 : state.phase === "attackers" && attacking.length === 0 && possibleAttackers.length > 0;

  // In the first main phase, "Go to combat" is only available once the player has a card on their battlefield.
  const noCombatYet = state.phase === "main1" && state.players[actor].battlefield.length === 0;
  // When the only thing left to play is a land (or nothing at all), the button says "Pass turn".
  const onlyLandsLeft =
    (state.phase === "main1" || state.phase === "main2") &&
    [...playable].every((iid) => state.cards[state.players[actor].hand.find((c) => c.iid === iid)?.defId ?? ""]?.type === "land");
  // "End turn" skips the rest of the player's own turn at any point before combat or after it.
  const showEndTurn = mine && !state.priority && !state.pendingChoice && !state.pendingPick && (state.phase === "main1" || state.phase === "attackers" || state.phase === "main2");

  /** Shows the card big next to the element the mouse is over: above it when there is room, otherwise below. */
  function showPreview(def: CardDef, el: HTMLElement) {
    if (touch) return; // (a tap also "hovers" on a touch screen, and the big card would stay: a long press enlarges a card instead)
    const r = el.getBoundingClientRect();
    const h = PREVIEW_W * 1.4;
    const top = r.top - 8 - h >= 8 ? r.top - 8 - h : Math.min(r.bottom + 8, window.innerHeight - h - 8);
    setPreview({ def, el, left: Math.min(Math.max(8, r.left + r.width / 2 - PREVIEW_W / 2), window.innerWidth - PREVIEW_W - 8), top: Math.max(8, top) });
  }
  const abilities = watching ? NO_ABILITIES : abilityList(state, actor);
  const abilityCount = countAbilities(abilities);
  const abilityIids = new Set<string>([...abilities.abilities.map((x) => x.iid), ...abilities.loyalty.map((x) => x.iid), ...abilities.crews.map((x) => x.iid)]);
  const abilityLocked = watching ? 0 : lockedAbilities(state, actor).length;
  const inspect = (def: Inspected["def"], status?: string[]) => setInspected({ def, status });
  const lane: LaneContext = { state, attackingIds: attackerIds, onInspect: inspect, onZoom: setZoomed, onPreview: showPreview, onUnpreview: () => setPreview(null) };
  // Choosing attackers or blockers: the player's combat zone shows even while it is empty.
  const combatSetup = (id: PlayerId) => mine && (state.phase === "attackers" || state.phase === "blockers") && id === actor;

  return (
    <main
      className="battlefield-bg flex h-[calc(100dvh-2.6rem)] flex-col gap-1.5 overflow-hidden p-1.5 text-zinc-900 [--card-h:clamp(60px,9.5dvh,110px)] lg:gap-2 lg:p-2 lg:[--card-h:clamp(74px,11.8dvh,150px)] lg:h-[calc(100dvh-2.5rem)] lg:grid lg:grid-cols-[15rem_minmax(0,1fr)_17rem]"
      data-peek={peek ? "1" : undefined}
      style={{ "--bf-image": background.css, "--bf-dim": background.dim } as React.CSSProperties}
    >
      {/* Left: players, chat, log */}
      <aside className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-2 lg:overflow-y-auto">
        {/* On a phone these are a menu that covers the board; on a big screen they are the left column. */}
        <div className={`${menuOpen ? "fixed inset-x-0 bottom-0 top-[2.6rem] z-40 flex flex-col gap-2 overflow-y-auto bg-slate-950/95 p-3" : "hidden"} lg:contents`}>
        <div className="flex items-center justify-between lg:hidden">
          <h2 className="font-display text-base font-bold uppercase tracking-widest text-white">Menu</h2>
          <button onClick={() => setMenuOpen(false)} aria-label="Close the menu" className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/10 text-2xl leading-none text-white">
            ×
          </button>
        </div>
        <p className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-slate-100 lg:hidden">Tip: press and hold any card to see it big.</p>
        {fullscreen.available && (
          <button
            onClick={fullscreen.toggle}
            className="flex w-full items-center justify-between rounded-xl border border-white/40 bg-slate-950/55 px-3 py-2 text-left font-display text-xs font-bold uppercase tracking-wide text-white shadow-sm hover:bg-slate-900/70"
          >
            <span>⛶ {fullscreen.on ? "Leave full screen" : "Full screen"}</span>
          </button>
        )}
        {!watching && (
          <div className="flex flex-col gap-1 rounded-xl border border-white/40 bg-slate-950/55 px-3 py-2 text-white" role="group" aria-label="Priority stops">
            <span className="font-display text-xs font-bold uppercase tracking-wide">Stop for priority</span>
            {(
              [
                ["attack", "When I am attacked"],
                ["spell", "On their spells"],
                ["block", "After blocks"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex min-h-9 cursor-pointer items-center justify-between gap-2 text-sm">
                <span>{label}</span>
                <input type="checkbox" checked={stops[key]} onChange={(e) => setStop(key, e.target.checked)} className="h-5 w-5 accent-amber-400" />
              </label>
            ))}
          </div>
        )}
        <PlayedThisTurn items={history.filter((h) => h.turn === state.turn)} state={state} onZoom={(defId) => setZoomed(state.cards[defId])} />
        {!watching && (
          <ChatPanel
            messages={chat}
            as={actor}
            onSend={(text) => (online ? netSend("chat", { text }) : setChat((c) => [...c, { id: c.length, from: actor, text }]))}
          />
        )}
        <LogPanel lines={log} cards={state.cards} onPreview={(d, el) => (showPreview(d, el), inspect(d))} onUnpreview={() => setPreview(null)} onZoom={setZoomed} />
        <div className="lg:hidden">
          <KeepRandomDecks decks={{ [actor]: playedDecks[actor] }} saved={savedDecks} onSaved={keepDeck} label={() => "Save my random deck"} />
        </div>
        {!watching && !state.winner && (
          <button onClick={() => (setMenuOpen(false), setResigning(actor))} className="rounded-xl border border-red-400/60 bg-red-950/40 px-3 py-2.5 text-sm font-bold text-red-200 lg:hidden">
            Resign
          </button>
        )}
        </div>
        {/* You: bottom left */}
        <div className="order-3 flex shrink-0 items-stretch gap-1.5 lg:order-none lg:block">
          <div className="min-w-0 flex-1">
            <PlayersPanel state={state} order={[actor]} actor={actor} onResign={watching ? undefined : setResigning} heading={watching ? "Player" : "You"} manaNotes={manaNote} />
            <div className="max-lg:hidden">
              <KeepRandomDecks className="mt-2" decks={{ [actor]: playedDecks[actor] }} saved={savedDecks} onSaved={keepDeck} label={() => "Save my random deck"} />
            </div>
          </div>
          <button onClick={() => setMenuOpen(true)} aria-label="Open the menu: chat, log and settings" className="flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-white/30 bg-slate-950/60 text-white lg:hidden">
            <span className="text-xl leading-none" aria-hidden="true">☰</span>
            <span className="text-[11px] font-bold uppercase tracking-wide">Menu</span>
          </button>
        </div>
      </aside>

      {/* Center: the battle */}
      <section className="order-2 flex min-h-0 flex-1 flex-col gap-1.5 lg:order-none lg:flex-initial lg:[--hand-h:clamp(74px,11.8dvh,150px)] lg:has-[.action-box>*]:[--hand-h:clamp(58px,9dvh,110px)]">
        <Battlefield
          owner={other}
          top
          label={`${playerName(other)}'s battlefield`}
          mat={look.mat(other).css}
          lane={lane}
          interaction={(p) => interaction(other, p)}
          inCombat={(p) => inCombat(other, p)}
          combatSetup={combatSetup(other)}
          overlay={
            <ResolveZone
              state={state}
              played={announcements.filter((a) => !a.flashed && (a.player === other || worthTelling(a)))}
              revealing={revealing}
              onClose={(id) => setAnnouncements((l) => l.filter((x) => x.id !== id))}
              onZoom={setZoomed}
            />
          }
          zones={
            <>
              <Pile state={state} owner={other} kind="library" compact deckName={deckNames[other]} sleeve={look.sleeve(other)} />
              <Pile state={state} owner={other} kind="graveyard" compact onOpen={() => setViewingYard({ owner: other, zone: "graveyard" })} />
              <Pile state={state} owner={other} kind="exile" onOpen={() => setViewingYard({ owner: other, zone: "exile" })} />
            </>
          }
        />

        <CommandBar
          state={state}
          actor={actor}
          mine={mine}
          primary={primary}
          skipping={skipping}
          confirmSkip={confirmSkip}
          onConfirmSkip={setConfirmSkip}
          onAct={act}
          noCombatYet={noCombatYet}
          showEndTurn={showEndTurn}
          onlyLandsLeft={onlyLandsLeft}
          onEndTurn={endTurn}
          series={online && !watching ? net.snapshot?.series : null}
        />
        {!state.winner && watching && (
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-sky-300/50 bg-sky-950/60 px-3 py-2 text-sm text-sky-100 shadow-sm">
            <span aria-hidden="true">👁</span>
            <span className="min-w-0 flex-1">
              You are watching. It is <b>{playerName(playerToAct(state))}</b>&apos;s turn to act.
            </span>
          </div>
        )}
        {!watching && <StepBanner state={state} actor={actor} waiting={online && !mine} error={error} abilityCount={abilityCount} abilityLocked={abilityLocked} onOpenAbilities={() => setAbilitiesOpen(true)} />}

        {/* Panels that appear while something needs an answer. They share a box that scrolls on its own, so the board never moves. */}
        <button onClick={() => setPeek((v) => !v)} className="peek-btn shrink-0 rounded-lg border border-white/30 bg-slate-950/70 py-1.5 text-sm font-bold text-white">
          {peek ? "▴ Show the choices" : "▾ Hide the choices to see the board"}
        </button>
        <div ref={watchSheet} className="action-box flex max-h-[34dvh] shrink-0 flex-col gap-1.5 overflow-y-auto empty:hidden">
        {mine && state.phase === "blockers" && !state.priority && !state.pendingChoice && !state.pendingPick && <BlockPanel state={state} actor={actor} blocks={blocks} picked={picked} onChange={(b) => { setBlocks(b); setPicked(null); }} onPicked={setPicked} />}

        {stacked && mine && state.phase === "attackers" && !state.priority && !state.pendingChoice && !state.pendingPick && !targeting && possibleAttackers.length > 0 && (
          <section className="flex flex-col gap-1.5 rounded-xl border border-red-400/60 bg-red-950/90 p-2 text-white [--card-h:92px]">
            <h2 className="text-sm font-bold">Tap the creatures that attack</h2>
            <div className="flex gap-2 overflow-x-auto py-1">
              {state.players[actor].battlefield
                .filter((p) => possibleAttackers.includes(p.card.iid))
                .map((p) => {
                  const on = attacking.includes(p.card.iid);
                  return (
                    <CardView
                      key={p.card.iid}
                      def={state.cards[p.card.defId]}
                      size="md"
                      {...liveCardProps(state, p)}
                      ring={on ? "ring-4 ring-red-500" : ""}
                      note={on ? "⚔ Attacking" : undefined}
                      onClick={() => setAttacking((a) => (on ? a.filter((x) => x !== p.card.iid) : [...a, p.card.iid]))}
                      onZoom={() => setZoomed(state.cards[p.card.defId])}
                    />
                  );
                })}
            </div>
          </section>
        )}
        <AttackTargetsPanel state={state} actor={actor} attacking={attacking} targets={attackTargets} onChange={setAttackTargets} />

        <StackPanel
          state={state}
          actor={actor}
          onPass={() => act({ type: "passPriority" })}
          waiting={online && !mine ? `Waiting for ${playerName(playerToAct(state))} to ${state.pendingPick || state.pendingChoice ? "choose" : "respond"}…` : undefined}
          chain={chain.steps}
          chainOver={chain.over}
          onCloseChain={() => setChain({ steps: [], over: false })}
        />

        {payChoice && (
          <PayPanel
            key={JSON.stringify(payChoice.action)}
            state={state}
            choice={payChoice}
            onCancel={() => setPayChoice(null)}
            onPay={(spare) => {
              const c = payChoice;
              setPayChoice(null);
              void act(c.action, c.as, { spare, paid: true });
            }}
          />
        )}
        {lifeConfirm && (
          <ChoicePanel
            title={<ManaText text={lifeConfirm.text} />}
            options={[...lifeConfirm.options.map((o) => ({ label: o.label, onPick: o.go })), { label: "Cancel", onPick: () => setLifeConfirm(null) }]}
            onCancel={() => setLifeConfirm(null)}
          />
        )}
        {abilityX && (
          <XPanel
            name={`${cardNameAnywhere(state, abilityX.a.iid)}'s ability`}
            max={abilityX.a.maxX ?? 0}
            x={xValue}
            onChange={(x) => setXValue(Math.min(abilityX.a.maxX ?? 0, Math.max(0, x)))}
            onCast={() => startAbility(abilityX.a, abilityX.payWith, xValue)}
            onCancel={resetSelection}
          />
        )}
        {landFace && <LandFacePanel state={state} actor={actor} iid={landFace} onPlay={(back) => { setLandFace(null); act({ type: "playLand", iid: landFace, ...(back ? { back: true } : {}) }); }} onCancel={resetSelection} />}
        {plan && (
          <CastPlanPanels
            state={state}
            actor={actor}
            plan={plan}
            modePick={modePick}
            onModePick={setModePick}
            xValue={xValue}
            onX={setXValue}
            onAdvance={advance}
            onCancel={resetSelection}
          />
        )}

        {online && !mine && <ResolvingNotice state={state} onZoom={setZoomed} />}

        {mine && state.pendingChoice && endingTurn === state.turn && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ⏭ Ending your turn: {state.pendingChoice.item.sourceName} still triggers along the way, even without an attack (that&apos;s the rule). Choose its target and your turn then ends by itself.
          </p>
        )}
        {mine && (state.pendingChoice || targeting) && (
          <TargetPanel
            state={state}
            controller={actor}
            title={state.pendingChoice ? `${state.pendingChoice.item.sourceName}: triggered ability` : (targeting?.title ?? "")}
            detail={state.pendingChoice ? readable(state.pendingChoice.item.text, state.pendingChoice.item.sourceName) : targeting?.detail}
            cost={state.pendingChoice ? undefined : targeting?.cost}
            specs={state.pendingChoice ? state.pendingChoice.specs : (targeting?.specs ?? [])}
            chosen={chosen}
            aimed={aimed}
            onAim={setAimed}
            onPick={pickTarget}
            onCancel={state.pendingChoice ? undefined : () => resetSelection()}
          />
        )}

        {mine && damageNeeded.length > 0 && (
          <DamagePanel
            state={state}
            needed={damageNeeded}
            effective={effectiveAssign}
            onShift={(attacker, from, to) =>
              setAssign((a) => {
                const cur = a[attacker] ?? suggestDamageAssignment(state, attacker);
                return { ...a, [attacker]: { ...cur, [from]: (cur[from] ?? 0) - 1, [to]: (cur[to] ?? 0) + 1 } };
              })
            }
          />
        )}
        </div>

        <Battlefield
          owner={actor}
          label={`${playerName(actor)}'s battlefield`}
          mat={look.mat(actor).css}
          lane={lane}
          interaction={(p) => interaction(actor, p)}
          inCombat={(p) => inCombat(actor, p)}
          combatSetup={combatSetup(actor)}
          zones={
            <>
              <Pile state={state} owner={actor} kind="exile" onOpen={() => setViewingYard({ owner: actor, zone: "exile" })} />
              <Pile state={state} owner={actor} kind="graveyard" compact onOpen={() => setViewingYard({ owner: actor, zone: "graveyard" })} />
              <Pile state={state} owner={actor} kind="library" compact deckName={deckNames[actor]} sleeve={look.sleeve(actor)} />
            </>
          }
        />

        {!watching && (
        // Only the hand gets smaller while a choice panel is open or in combat: the battlefields are fitted by FitToHeight, so making their
        // cards smaller too (as this once did) meant laying out the whole board again for every phase.
        <div className="contents [--card-h:clamp(72px,13dvh,130px)] lg:[--card-h:var(--hand-h)]" style={state.phase === "attackers" ? ({ "--card-h": "clamp(60px, 10.5dvh, 130px)" } as React.CSSProperties) : state.phase === "blockers" ? ({ "--card-h": "clamp(56px, 9dvh, 110px)" } as React.CSSProperties) : undefined}>
        <Side label={`${playerName(actor)}'s hand`} tone="emerald">
          <HandRow
            state={state}
            actor={actor}
            mine={mine}
            playable={playable}
            exiled={state.players[actor].exile.filter((c) => playable.has(c.iid))}
            handPick={handPick}
            onClick={clickHandCard}
            onPreview={showPreview}
            onUnpreview={() => setPreview(null)}
            onInspect={(def) => inspect(def)}
            onZoom={setZoomed}
          />
        </Side>
        </div>
        )}
      </section>

      {/* Right: the card under the mouse, big */}
      <aside className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-2">
        {/* Your opponent: top right */}
        <div className="order-1 shrink-0 lg:order-none">
          <PlayersPanel state={state} order={[other]} actor={actor} onResign={online ? undefined : setResigning} heading={watching ? "Player" : "Opponent"} manaNotes={manaNote} />
        </div>
        <div className="hidden min-h-0 flex-1 lg:block lg:overflow-y-auto">
          <HoverDetail />
        </div>
      </aside>

      {(abilitiesOpen || abilityFocus) && !state.pendingChoice && !targeting && (
        <AbilitiesDialog
          only={abilityFocus ?? undefined}
          state={state}
          actor={actor}
          list={abilities}
          onClose={() => (setAbilitiesOpen(false), setAbilityFocus(null))}
          onAct={act}
          onAbility={startAbility}
          onLoyalty={startLoyalty}
          onCast={advance}
        />
      )}

      {mine && <PickPanel state={state} onPick={(iid) => act({ type: "pick", iid })} onZoom={setZoomed} onPreview={showPreview} onUnpreview={() => setPreview(null)} />}
      {viewingYard && <GraveyardDialog state={state} owner={viewingYard.owner} zone={viewingYard.zone} onClose={() => (setPreview(null), setViewingYard(null))} onZoom={setZoomed} onPreview={showPreview} onUnpreview={() => setPreview(null)} />}

      <HoverPreview hidden={!!zoomed || !!state.winner} />

      {zoomed && <Lightbox def={zoomed} onClose={() => setZoomed(null)} />}

      {resigning && !state.winner && (
        <ResignDialog
          player={resigning}
          onCancel={() => setResigning(null)}
          onConfirm={() => {
            act({ type: "concede" }, resigning);
            setResigning(null);
          }}
        />
      )}

      {online && (watching || (net.snapshot?.spectators ?? 0) > 0 || net.notices.length > 0) && (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-30 flex flex-col items-center gap-2 px-4">
          {watching && (
            <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-sky-300/60 bg-slate-950/90 py-1.5 pl-4 pr-1.5 text-sm font-semibold text-sky-100 shadow-xl shadow-black/40">
              <span>
                👁 Watching{(net.snapshot?.spectators ?? 0) > 1 ? ` · ${net.snapshot?.spectators} watching` : ""}
              </span>
              <button
                onClick={() => {
                  leaveRoom();
                  router.push("/");
                }}
                className="btn-ghost !py-1"
              >
                ← Back to dashboard
              </button>
            </div>
          )}
          {!watching && (net.snapshot?.spectators ?? 0) > 0 && (
            <div className="rounded-full border border-white/25 bg-slate-950/85 px-3 py-1 text-xs font-semibold text-slate-100 shadow-lg shadow-black/40">
              👁 {net.snapshot?.spectators} watching
            </div>
          )}
          {net.notices.map((n) => (
            <button
              key={n.id}
              onClick={() => dismissNotice(n.id)}
              title="Dismiss"
              className="pointer-events-auto max-w-md rounded-2xl border border-amber-300/60 bg-slate-950/90 px-4 py-2 text-left text-sm font-semibold text-amber-100 shadow-xl shadow-black/40"
            >
              👁 {n.text}
            </button>
          ))}
        </div>
      )}

      <RotateHint />
      {!watching && <ChainFx state={state} actor={actor} extra={triggerFlash} onPass={() => void act({ type: "passPriority" })} />}
      {watching && <ChainFx state={state} actor="p1" extra={triggerFlash} />}
      {welcome && <WelcomeSplash />}
      {stageSeen && !stageDone && !intro && !welcome && state.opening?.shuffled && (
        <ShuffleStage
          state={state}
          viewer={online ? seat : null}
          watching={watching}
          actor={actor}
          sleeve={look.sleeve}
          onShuffle={(who) => void act({ type: "shuffleDeck" }, who)}
          onDone={() => {
            stageDoneRef.current = true;
            setStageDone(true);
          }}
        />
      )}
      {turnSplash > 0 && !state.winner && <TurnSplash key={turnSplash} />}
      {online && net.reconnecting && (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-3 z-30 flex justify-center px-4">
          <div className="rounded-full border border-amber-300/60 bg-slate-950/85 px-4 py-2 text-sm font-semibold text-amber-100 shadow-xl shadow-black/40">⟳ Reconnecting to the game server…</div>
        </div>
      )}
      {online && showEndTurn && !state.winner && !targeting && !plan && attacking.length === 0 && (
        <PassReminder state={state} after={state.phase === "main2" && onlyLandsLeft ? REMIND_DONE_MS : REMIND_IDLE_MS} opponent={playerName(other)} onEndTurn={endTurn} />
      )}

      {state.winner && resultReady && online && !watching && net.reveal && seenReveal !== net.reveal && (
        <LibraryReveal reveal={net.reveal} onContinue={() => setSeenReveal(net.reveal)} />
      )}
      {state.winner && resultReady && !(online && !watching && net.reveal && seenReveal !== net.reveal) && <VictoryDialog
          winner={state.winner}
          reason={endNote ?? (online ? net.snapshot?.endReason ?? null : null)}
          series={
            online && !watching && net.snapshot?.series
              ? { ...net.snapshot.series, you: actor, opponent: playerName(other), onReady: () => netSend("nextGame") }
              : undefined
          }
          rematch={
            online && !watching && net.snapshot && net.snapshot.players.length === 2 && !(net.snapshot.series && !net.snapshot.series.decided)
              ? {
                  state: net.snapshot.rematch === null ? "none" : net.snapshot.rematch === actor ? "sent" : "incoming",
                  opponent: playerName(other),
                  onAsk: () => netSend("rematch"),
                  onCancel: () => netSend("cancelRematch"),
                  onAccept: () => netSend("rematchReply", { accept: true }),
                  onDecline: () => netSend("rematchReply", { accept: false }),
                }
              : undefined
          }
          you={online && !watching ? actor : undefined}
          keep={
            <KeepRandomDecks
              className="mt-4"
              decks={playedDecks}
              saved={savedDecks}
              onSaved={keepDeck}
              label={(who) => (online ? "Save my random deck" : `Save ${playerName(who)}'s deck`)}
              note={online ? "Liked your random cards?" : "Liked the random cards?"}
            />
          }
          onLeave={
            online
              ? () => {
                  leaveRoom();
                  router.push("/");
                }
              : undefined
          }
        />}
    </main>
  );
}
