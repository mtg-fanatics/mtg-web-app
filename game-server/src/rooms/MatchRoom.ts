import { Room, Client, CloseCode, ServerError, matchMaker } from "colyseus";
import type { Delayed } from "colyseus";
import { applyAction, createGame, HIDDEN_CARD_ID, playerToAct, spectatorView, unplayableCards, viewFor } from "@mtg/engine";
import type { Action, CardDef, GameEvent, GameState, PlayerId } from "@mtg/engine";
import { accountFromToken, dropLive, friendIdsOf, loadCards, loadLive, saveLive, saveMatch, saveReplay } from "../supabase.js";
import type { Account } from "../supabase.js";
import { botPool } from "../botPool.js";
import { LIMITS, passwordGuesses } from "../limits.js";

/**
 * One match, from the moment the host opens the room to the moment someone wins.
 *
 *   waiting  → the host is alone, or the second player has joined (the host then sees "Vote")
 *   (vote    → no longer used: every deck is 60 cards, the host's "Vote" button now goes straight to decks)
 *   decks    → both players choose a deck of that size
 *   coin     → the guest calls heads or tails, the server flips the coin; whoever wins it chooses who goes first
 *   playing  → the game runs HERE: the server holds the real game state and the rules; the browsers only send actions
 *   over     → someone won (or left)
 *
 * Nothing secret is ever sent: each player gets a view of the game with the opponent's hand and both libraries face down.
 *
 * The match is saved after every change. When the server restarts (a deploy) it is saved once more and the players are let
 * go; their browsers then ask for it back with `restore`, which brings it back under the same room id.
 */
export type Stage = "waiting" | "vote" | "decks" | "coin" | "playing" | "over";
/** Every deck is this many cards. */
export const DECK_SIZE = 60;
/** Close code for a guest the host removed: the browser says so, and doesn't try to reconnect. */
export const KICKED = 4100;
/** Error code (sent as the HTTP status, so it must be one) for a restore of a match that has ended or was never saved: the browser stops trying. */
export const MATCH_GONE = 410;

/** What a player chose for the table: their card sleeve and playmat, as "preset:<id>" (empty = their default). Shown to everyone in the match. */
export interface Look {
  sleeve: string;
  mat: string;
  /** The finishing move this player plays when they win; the other player's screen plays it too. */
  finisher?: string;
}

interface Member {
  look?: Look;
  sessionId: string;
  account: Account;
  seat: PlayerId;
  connected: boolean;
  vote: number | null;
  /** `side`: the sideboard, outside the game ("learn" can fetch a Lesson from it). */
  deck: { name: string; ids: string[]; side?: string[] } | null;
  /** The computer player: it has no browser, and the room plays its moves. */
  isBot?: boolean;
}

export interface RoomMeta {
  name: string;
  host: string;
  players: string[];
  status: Stage;
  turn: number;
  /** A password is needed to join. The password itself never leaves the server. */
  locked: boolean;
  /** A room with a computer opponent: nobody else can join it. */
  bot: boolean;
  /** People watching the match. */
  spectators: number;
}

/** What the lobby shows for a room, and what each player's room pop-up is drawn from. */
export interface RoomSnapshot {
  stage: Stage;
  name: string;
  you: PlayerId;
  host: PlayerId;
  locked: boolean;
  size: number | null;
  /** "The votes differ" so the pop-up can say so. */
  mismatch: boolean;
  players: { seat: PlayerId; name: string; connected: boolean; voted: number | null; deckReady: boolean; avatar?: string; bot?: boolean; look?: Look }[];
  /** `call`, `result` and `winner` stay null until the caller has called heads or tails. */
  coin: { caller: PlayerId; call: Side | null; result: Side | null; winner: PlayerId | null; chose: "first" | "second" | null } | null;
  winner: PlayerId | "draw" | null;
  endReason: string | null;
  /** After the game: the player who asked for a rematch, until the other answers. */
  rematch: PlayerId | null;
  /** Best of 3 or 5: the games so far. Null for a single game. */
  series: { bestOf: number; game: number; wins: Record<PlayerId, number>; /** The whole series is over (someone has won enough games, or left). */ decided: boolean; /** Between games: who has pressed "Next game". */ ready: PlayerId[] } | null;
  /** How many people are watching. */
  spectators: number;
  /** Set when this snapshot is for someone watching, not playing (`you` is then only the side the board is drawn from). */
  spectating?: boolean;
}

type Side = "heads" | "tails";

/** Everything needed to bring a match back after a restart. It never leaves the server: it holds the password and both hands. */
interface SavedMatch {
  title: string;
  password: string;
  banned: string[];
  members: Pick<Member, "account" | "seat" | "vote" | "deck" | "isBot">[];
  stage: Stage;
  size: number | null;
  mismatch: boolean;
  coin: RoomSnapshot["coin"];
  game: GameState | null;
  deckNames: Record<PlayerId, string>;
  replay?: Replay | null;
}

/** Everything needed to play a finished match again: the engine is deterministic, so the seed, the decks and the actions are enough. */
export interface Replay {
  v: 1;
  seed: number;
  starting: PlayerId;
  names: Record<PlayerId, string>;
  decks: Record<PlayerId, string[]>;
  sides?: Partial<Record<PlayerId, string[]>>;
  cards: GameState["cards"];
  /** Every action in order: who did it, what, and the mana the player chose to spare (see applyFor). */
  log: { p: PlayerId; a: Action; s?: string[] }[];
  winner?: PlayerId | "draw";
  reason?: string | null;
  at: string;
}

const RECONNECT_SECONDS = 60;
const CLAIM_SETUP_SECONDS = 90; // a seat being set up that never connects frees its claim after this long

export const acctKey = (accountId: string) => `acct-room:${accountId}`;
/** Set (for a while) when a member invites a friend to a room: the friend may join even a room with a password. */
export const inviteKey = (roomId: string, accountId: string) => `room-invite:${roomId}:${accountId}`;
/** Is this room still open (on any server process)? */
async function roomIsOpen(roomId: string) {
  try {
    return Boolean(await matchMaker.getRoomById(roomId));
  } catch {
    return false;
  }
}
const SAVE_DELAY_MS = 300; // changes in quick succession are saved once

export class MatchRoom extends Room<{ metadata: RoomMeta }> {
  /** Two players, and the people watching. */
  maxClients = 2 + LIMITS.maxSpectators();
  /** A browser that sends more than this per second is cut off. */
  maxMessagesPerSecond = LIMITS.messagesPerSecond();

  /** Rooms on this process with a computer opponent and a game not yet over: the bot is the expensive part, so these are capped. */
  private static botRooms = new Set<string>();

  private members: Member[] = [];
  private stage: Stage = "waiting";
  private title = "Room";
  private password = "";
  private banned = new Set<string>(); // accounts the host removed: they can't come back to this room
  private size: number | null = null;
  private mismatch = false;
  private coin: RoomSnapshot["coin"] = null;
  private game: GameState | null = null;
  private replay: Replay | null = null;
  private winner: PlayerId | "draw" | null = null;
  private endReason: string | null = null;
  private revealed: { libraries: Record<PlayerId, string[]>; cards: Record<string, Pick<CardDef, "id" | "name" | "type" | "image" | "typeLine" | "manaCost" | "scryfallId">> } | null = null; // both libraries, once the game is over
  private rematchFrom: PlayerId | null = null; // asked for a rematch, and waiting for the other player's answer
  /** Best of 3 or 5 (null: a single game): the score, and who is ready for the next game. */
  private series: { bestOf: number; game: number; wins: Record<PlayerId, number>; decided: boolean; ready: Set<PlayerId> } | null = null;
  private nextTimer?: ReturnType<typeof setTimeout>;
  private deckNames: Record<PlayerId, string> = { p1: "", p2: "" };
  private defs: Record<string, CardDef> = {};
  private busy = false; // actions are handled one at a time
  private botTimer?: ReturnType<typeof setTimeout>;
  private botRun = 0; // bumped whenever a bot move in the works must be thrown away
  private idleTimer?: ReturnType<typeof setTimeout>;
  private spectators = new Map<string, { account: Account }>(); // by session id: people watching, who see no hand and can do nothing
  private claimed = new Set<string>(); // accounts that currently hold a seat here (one room per account)
  private lastChat = 0;
  private saveTimer: Delayed | undefined;
  private saving: Promise<void> = Promise.resolve(); // saves (and the final delete) go out one after another, in order
  private ended = false; // over, or closed: nothing to bring back
  private shuttingDown = false;
  private restored = false; // brought back after a restart, and the player hasn't returned yet
  private endingTurn: { seat: PlayerId; turn: number } | null = null; // "End turn" was pressed: it carries on after a choice along the way

  messages = {
    startVote: (client: Client) => {
      const m = this.member(client);
      if (!m || m.seat !== "p1" || this.stage !== "waiting" || this.members.length < 2) return;
      // The players have voted on the game mode (a single game, best of 3 or best of 5): they must agree before they choose decks.
      const votes = this.members.map((x) => x.vote);
      if (votes.some((v) => v === null) || new Set(votes).size !== 1) {
        client.send("error", { message: "You both need to pick the same game mode first." });
        return;
      }
      this.series = { bestOf: votes[0] as number, game: 1, wins: { p1: 0, p2: 0 }, decided: false, ready: new Set() };
      this.members.forEach((x) => ((x.vote = null), (x.deck = null)));
      this.mismatch = false;
      this.size = DECK_SIZE;
      this.stage = "decks";
      this.publish();
    },

    /** A player's vote for the game mode: 1 (a single game), 3 or 5 (best of). The computer votes the same as the host. */
    format: (client: Client, message: { bestOf?: number }) => {
      const m = this.member(client);
      const n = message?.bestOf;
      if (!m || this.stage !== "waiting" || (n !== 1 && n !== 3 && n !== 5)) return;
      m.vote = n;
      const bot = this.bot;
      if (bot && m.seat === "p1") bot.vote = n;
      this.publish();
    },

    /** Between the games of a series: this player is ready. The next game begins when both are (or after a minute). */
    nextGame: (client: Client) => {
      const m = this.member(client);
      const s = this.series;
      if (!m || this.stage !== "over" || !s || s.decided) return;
      s.ready.add(m.seat);
      if (this.members.every((x) => s.ready.has(x.seat))) void this.startNextGame();
      else this.publish();
    },

    /** The host plays against the computer instead of waiting for a second player. */
    addBot: (client: Client) => {
      const m = this.member(client);
      if (!m || m.seat !== "p1" || this.stage !== "waiting" || this.members.length !== 1) return;
      if (MatchRoom.botRooms.size >= LIMITS.maxBotGames() && !MatchRoom.botRooms.has(this.roomId)) {
        client.send("error", { message: "The computer opponents are all busy right now. Try again in a moment." });
        return;
      }
      MatchRoom.botRooms.add(this.roomId);
      this.members.push({ sessionId: "bot", account: { id: "bot", username: "Bot" }, seat: "p2", connected: true, vote: this.members[0]?.vote ?? null, deck: null, isBot: true });
      this.publish();
    },

    removeBot: (client: Client) => {
      const m = this.member(client);
      if (!m || m.seat !== "p1" || this.stage !== "waiting" || !this.bot) return;
      this.members = this.members.filter((x) => !x.isBot);
      MatchRoom.botRooms.delete(this.roomId);
      this.publish();
    },

    deck: async (client: Client, message: { name?: string; ids?: unknown; side?: unknown; botDeck?: { name?: string; ids?: unknown } }) => {
      const m = this.member(client);
      if (!m || this.stage !== "decks" || this.size === null) return;
      // at most 200 entries are even looked at (the biggest deck is 60), each a short text
      const idsOf = (x: unknown) => (Array.isArray(x) ? (x as unknown[]).slice(0, 200).filter((y): y is string => typeof y === "string" && y.length <= 80) : []);
      const check = async (ids: string[]) => {
        if (ids.length !== this.size) throw new Error(`The deck needs exactly ${this.size} cards.`);
        const cards = await loadCards(ids);
        const bad = ids.find((id) => !cards[id] || cards[id].playable === false);
        if (bad) throw new Error(`"${bad}" can't be played in this game.`);
        // the stored flag can lag behind the rules engine: the engine has the last word on what it can play
        const stuck = unplayableCards(cards, ids)[0];
        if (stuck) throw new Error(`${stuck.name} can't be played yet.`);
        Object.assign(this.defs, cards);
      };
      // A sideboard is at most 15 cards; one the engine can't play is just left out.
      const sideboard = async (x: unknown) => {
        const ids = idsOf(x).slice(0, 15);
        const cards = ids.length > 0 ? await loadCards(ids) : {};
        const usable = ids.filter((id) => cards[id] && cards[id].playable !== false && unplayableCards(cards, [id]).length === 0);
        Object.assign(this.defs, cards);
        return usable;
      };
      try {
        const ids = idsOf(message?.ids);
        await check(ids);
        // against the bot, the host brings the bot's deck too (a random one)
        if (this.bot && m.seat === "p1") {
          const botIds = idsOf(message?.botDeck?.ids);
          await check(botIds);
          this.bot.deck = { name: String(message?.botDeck?.name ?? "Bot deck").slice(0, 40), ids: botIds };
        }
        const side = await sideboard(message?.side);
        m.deck = { name: String(message?.name ?? "Deck").slice(0, 40), ids, ...(side.length > 0 ? { side } : {}) };
      } catch (e) {
        client.send("error", { message: e instanceof Error ? e.message : "That deck can't be used." });
        return;
      }
      if (this.stage === "decks" && this.members.length === 2 && this.members.every((x) => x.deck)) this.startCoin();
      this.publish();
    },

    /** The player's card sleeve and playmat, chosen before the game. Only a preset's name is accepted (never a picture), so it is small and safe to show the other player. */
    look: (client: Client, message: { sleeve?: unknown; mat?: unknown; finisher?: unknown; bot?: { sleeve?: unknown; mat?: unknown } }) => {
      const m = this.member(client);
      if (!m || this.stage === "playing" || this.stage === "over") return;
      const clean = (v: unknown) => (typeof v === "string" && /^(preset:[a-z0-9-]{1,40})?$/.test(v) ? v : "");
      m.look = { sleeve: clean(message?.sleeve), mat: clean(message?.mat), ...(typeof message?.finisher === "string" && /^(reaper|judgment|void|meteor|zero|random)$/.test(message.finisher) ? { finisher: message.finisher } : {}) };
      const bot = this.bot; // the host also dresses the computer's table
      if (bot && m.seat === "p1" && message?.bot) bot.look = { sleeve: clean(message.bot.sleeve), mat: clean(message.bot.mat) };
      this.publish();
    },

    call: (client: Client, message: { side?: string }) => {
      const m = this.member(client);
      const side = message?.side;
      if (!m || (side !== "heads" && side !== "tails")) return;
      this.callCoin(m, side);
    },

    order: (client: Client, message: { first?: boolean }) => {
      const m = this.member(client);
      if (!m || this.stage !== "coin" || !this.coin || this.coin.winner !== m.seat || this.coin.chose) return;
      this.coin.chose = message?.first === false ? "second" : "first";
      this.startGame(this.coin.chose === "first" ? m.seat : m.seat === "p1" ? "p2" : "p1");
    },

    action: (client: Client, message: { action?: Action; spare?: string[] }) => {
      const m = this.member(client);
      if (!m || !message?.action || typeof message.action !== "object") return;
      const spare = Array.isArray(message.spare) ? message.spare.slice(0, 40).filter((x): x is string => typeof x === "string") : undefined;
      this.play(m, () => this.applyFor(m.seat, message.action as Action, spare));
    },

    endTurn: (client: Client) => {
      const m = this.member(client);
      if (!m || !this.game) return;
      this.endingTurn = { seat: m.seat, turn: this.game.turn };
      this.play(m, () => this.passThroughTurn(m.seat));
    },

    /** After the game: a player asks the other for a rematch. */
    rematch: (client: Client) => {
      const m = this.member(client);
      if (!m || this.stage !== "over" || this.members.length !== 2 || this.rematchFrom || this.members.some((x) => !x.connected)) return;
      this.rematchFrom = m.seat;
      this.publish();
      // the computer always says yes, after a moment
      if (this.members.some((x) => x.isBot && x.seat !== m.seat)) this.botTimer = setTimeout(() => void this.beginRematch(), 1500);
    },

    /** The player who was asked: yes (the decks are chosen again, then the coin toss) or no. */
    rematchReply: async (client: Client, message: { accept?: boolean }) => {
      const m = this.member(client);
      if (!m || this.stage !== "over" || !this.rematchFrom || this.rematchFrom === m.seat) return;
      if (message?.accept === false) {
        const asker = this.members.find((x) => x.seat === this.rematchFrom);
        this.rematchFrom = null;
        if (asker) this.clientOf(asker)?.send("error", { message: `${m.account.username} declined the rematch.` });
        this.publish();
        return;
      }
      await this.beginRematch();
    },

    /** The player who asked changes their mind. */
    cancelRematch: (client: Client) => {
      const m = this.member(client);
      if (!m || this.stage !== "over" || this.rematchFrom !== m.seat) return;
      this.rematchFrom = null;
      clearTimeout(this.botTimer);
      this.publish();
    },

    /** A browser that has just joined (or reconnected) asks where things stand, once it is ready to listen. */
    hello: (client: Client) => {
      const m = this.member(client);
      if (!m) {
        if (this.spectators.has(client.sessionId)) {
          client.send("room", this.snapshot({ seat: "p1" }, true));
          this.sendGameToSpectator(client);
        }
        return;
      }
      client.send("room", this.snapshot(m));
      if (this.stage === "playing" || this.stage === "over") this.sendGame(m);
      if (this.stage === "over" && this.revealed) client.send("reveal", this.revealFor(m.seat));
    },

    /** The host removes the guest, any time before the match starts. onLeave then frees the seat. */
    kick: (client: Client) => {
      const m = this.member(client);
      if (!m || m.seat !== "p1" || this.stage === "playing" || this.stage === "over") return;
      const guest = this.members.find((x) => x.seat === "p2");
      if (!guest) return;
      if (guest.isBot) {
        // "removing" the bot just takes it out of the room
        this.members = this.members.filter((x) => !x.isBot);
        MatchRoom.botRooms.delete(this.roomId);
        this.publish();
        return;
      }
      this.banned.add(guest.account.id);
      this.clientOf(guest)?.leave(KICKED);
    },

    chat: (client: Client, message: { text?: string }) => {
      const m = this.member(client);
      const text = String(message?.text ?? "").trim().slice(0, 200);
      if (!m || !text || Date.now() - this.lastChat < 500) return; // no flooding the other player
      this.lastChat = Date.now();
      this.broadcast("chat", { from: m.seat, name: m.account.username, text });
    },
  };

  async onAuth(client: Client, options: { token?: string; password?: string; spectate?: boolean }) {
    const account = await accountFromToken(options?.token);
    if (!account) throw new Error("Please sign in again.");
    if (this.banned.has(account.id)) throw new Error("The host removed you from this room.");
    // someone who only wants to watch
    if (options?.spectate) return this.authSpectator(account, options.password);
    // the same account can't hold two seats
    if (this.members.some((m) => m.account.id === account.id && m.connected)) throw new Error("You are already in this room.");
    // a player coming back to their own seat doesn't need the password again
    const member = this.members.some((m) => m.account.id === account.id);
    // a room holding a seat for someone who dropped is unlocked so they can come back; nobody else gets in
    if (!member && this.members.length >= 2) throw new Error("This room is full.");
    if (this.password && !member && !(await this.wasInvited(account.id))) this.checkPassword(account, options?.password);
    // the server has room for only so many rooms; the one being opened right now is already counted
    if (this.members.length === 0 && matchMaker.stats.local.roomCount > LIMITS.maxRooms()) throw new Error("The server is full right now. Try again in a few minutes.");
    // one room at a time per account (and so one account can't flood the lobby with rooms)
    if (!member) await this.claim(account.id);
    return account;
  }

  /** Did a player in this room invite this account? Then the password is not asked for. */
  private async wasInvited(accountId: string): Promise<boolean> {
    return Boolean(await Promise.resolve(this.presence.get(inviteKey(this.roomId, accountId))));
  }

  /** The room's password, with the same lock-out after too many wrong guesses for joining and for watching. */
  private checkPassword(account: Account, given: string | undefined) {
    const wait = passwordGuesses.waitSeconds(account.id);
    if (wait > 0) throw new Error(`Too many wrong passwords. Try again in ${wait} seconds.`);
    if (given !== this.password) {
      if (given) passwordGuesses.fail(account.id);
      throw new Error(given ? "Wrong password." : "This room needs a password.");
    }
    passwordGuesses.succeed(account.id);
  }

  /** Watching: free in an open room, with the password in a locked one. Only a match that is being played can be watched. */
  private async authSpectator(account: Account, password: string | undefined) {
    if (this.stage !== "playing") throw new Error(this.stage === "over" ? "This match is over." : "This match has not started yet.");
    if (this.members.some((m) => m.account.id === account.id)) throw new Error("You are playing in this match.");
    if (this.spectators.size >= LIMITS.maxSpectators()) throw new Error("This match already has as many people watching as it allows.");
    if (this.password) this.checkPassword(account, password);
    await this.claim(account.id); // one room at a time: you can't play in one match and watch another
    return { ...account, spectator: true };
  }

  /** Reserves the account for this room, or refuses if it holds a seat in another room that is still open. */
  private async claim(accountId: string) {
    const key = acctKey(accountId);
    const other = (await this.presence.get(key)) as string | null;
    if (other && other !== this.roomId && (await roomIsOpen(other))) throw new Error("You already have a room open. Leave it before opening or joining another one.");
    await this.presence.setex(key, this.roomId, CLAIM_SETUP_SECONDS); // made permanent in onJoin; expires if the connection never completes
  }

  /** The account no longer holds a seat here. */
  private release(accountId: string) {
    if (!this.claimed.delete(accountId)) return;
    const key = acctKey(accountId);
    void Promise.resolve(this.presence.get(key)).then((v) => v === this.roomId && this.presence.del(key));
  }

  async onCreate(options: { name?: string; password?: string; restore?: string }) {
    if (options?.restore) return this.restore(String(options.restore));
    this.title = String(options?.name ?? "").trim().slice(0, 40) || "Room";
    this.password = String(options?.password ?? "").slice(0, 40);
  }

  /** After a restart: the match as it was saved, under its old id. Both players are away until their browsers rejoin. */
  private async restore(roomId: string) {
    const saved = (await loadLive(roomId)) as SavedMatch | null;
    if (!saved) throw new ServerError(MATCH_GONE, "That match has ended.");
    this.roomId = roomId;
    this.title = saved.title;
    this.password = saved.password;
    this.banned = new Set(saved.banned);
    this.members = saved.members.map((m) => ({ ...m, sessionId: m.isBot ? "bot" : "", connected: m.isBot === true })); // the bot has no browser to wait for
    this.stage = saved.stage;
    this.size = saved.size;
    this.mismatch = saved.mismatch;
    this.coin = saved.coin;
    this.game = saved.game;
    this.replay = saved.replay ?? null;
    this.deckNames = saved.deckNames;
    const deckIds = this.members.flatMap((m) => m.deck?.ids ?? []);
    if (deckIds.length > 0) Object.assign(this.defs, await loadCards(deckIds)); // the decks chosen before the game started
    this.restored = true;
    this.clock.setTimeout(() => this.giveUpOnAbsent(), RECONNECT_SECONDS * 2 * 1000);
  }

  /** A restart (a deploy): the match is saved as it stands, then the players are let go. Their browsers rejoin once the server is back. */
  async onBeforeShutdown() {
    this.shuttingDown = true;
    clearTimeout(this.botTimer); // a bot move after the last save would be lost
    await this.flush();
    await this.disconnect(CloseCode.SERVER_SHUTDOWN);
  }

  onJoin(client: Client, _options: unknown, account?: Account) {
    const acc = (account ?? (client.auth as Account | undefined))!;
    this.claimed.add(acc.id);
    void this.presence.set(acctKey(acc.id), this.roomId); // holds the seat for good (until released)
    if ((acc as Account & { spectator?: boolean }).spectator) {
      void this.watcherArrived(client, acc);
      return;
    }
    const back = this.members.find((x) => x.account.id === acc.id);
    if (back) {
      // a player coming back after a lost connection, or after a restart
      back.sessionId = client.sessionId;
      back.connected = true;
      this.publish();
      this.sendGame(back);
      if (this.restored) {
        this.restored = false;
        this.resumeBot();
      }
      return;
    }
    const seat: PlayerId = this.members.some((x) => x.seat === "p1") ? "p2" : "p1";
    this.members.push({ sessionId: client.sessionId, account: acc, seat, connected: true, vote: null, deck: null });
    this.publish();
  }

  async onLeave(client: Client, code: number) {
    if (this.shuttingDown) return; // the restart letting everyone go: the match was saved and goes on afterwards
    const watcher = this.spectators.get(client.sessionId);
    if (watcher) {
      this.spectators.delete(client.sessionId);
      this.release(watcher.account.id);
      this.publish();
      return;
    }
    const m = this.members.find((x) => x.sessionId === client.sessionId);
    if (!m) return;
    const leftOnPurpose = code === CloseCode.CONSENTED;

    if (this.stage === "playing" && !leftOnPurpose) {
      // a dropped connection: hold the seat for a while
      m.connected = false;
      this.publish();
      try {
        const back = await this.allowReconnection(client, RECONNECT_SECONDS);
        m.sessionId = back.sessionId; // the new connection takes the old seat
        m.connected = true;
        this.publish();
        return; // the browser now asks "hello" and gets the game as it stands
      } catch {
        if (m.sessionId !== client.sessionId) return; // they came back through a fresh join instead
        m.connected = false;
      }
    }
    this.gone(m);
  }

  /** After a restart: whoever hasn't come back by now is treated as having left. */
  private giveUpOnAbsent() {
    if (this.ended || this.members.length === 0) return;
    const away = this.members.filter((m) => !m.connected);
    if (this.members.every((m) => !m.connected || m.isBot)) {
      // nobody came back: the match quietly goes away, with no result
      this.forget();
      this.stage = "over";
      void this.disconnect();
      return;
    }
    for (const m of away) this.gone(m);
  }

  /** A player has left for good: during the game the other player wins; before it, a guest frees the seat and the host closes the room. */
  private gone(m: Member) {
    if (this.stage === "playing") {
      this.finish(m.seat === "p1" ? "p2" : "p1", `${m.account.username} left the game.`);
      return;
    }
    if (this.stage === "over") {
      if (this.series && !this.series.decided) {
        this.series.decided = true; // nobody to play the next game with
        clearTimeout(this.nextTimer);
        for (const x of this.members) this.release(x.account.id);
        this.forget();
      }
      this.members = this.members.filter((x) => x !== m);
      this.release(m.account.id);
      this.publish();
      if (this.members.length === 0 && this.spectators.size > 0) {
        this.broadcast("closed", { message: "The match is over." });
        void this.disconnect();
      }
      return;
    }
    // before the game: the host leaving closes the room, a guest leaving just frees the seat
    if (m.seat === "p1") {
      this.broadcast("closed", { message: `${m.account.username} (the host) closed the room.` });
      this.forget();
      this.members = [];
      void this.disconnect(); // onDispose frees everyone's claim
      return;
    }
    this.members = this.members.filter((x) => x !== m);
    this.release(m.account.id);
    this.members.forEach((x) => ((x.vote = null), (x.deck = null)));
    this.stage = "waiting";
    this.size = null;
    this.mismatch = false;
    this.coin = null;
    this.publish();
  }

  // ───────── helpers ─────────
  private member(client: Client) {
    return this.members.find((x) => x.sessionId === client.sessionId);
  }

  private clientOf(m: Member) {
    return this.clients.find((c) => c.sessionId === m.sessionId);
  }

  /** Both players' sleeves and playmats, by seat. */
  private looks(): Record<PlayerId, Look> {
    const of = (seat: PlayerId) => this.members.find((x) => x.seat === seat)?.look ?? { sleeve: "", mat: "" };
    return { p1: of("p1"), p2: of("p2") };
  }

  private clientById(sessionId: string) {
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  /** A person has started watching: they get the room and the game as a spectator sees it, and the players are told. */
  private async watcherArrived(client: Client, acc: Account) {
    this.spectators.set(client.sessionId, { account: acc });
    this.touch();
    client.send("room", this.snapshot({ seat: "p1" }, true));
    this.sendGameToSpectator(client);
    this.publish(); // the players' count and the lobby's line
    const friends = await friendIdsOf(acc.id);
    for (const m of this.members) {
      if (m.isBot) continue;
      this.clientOf(m)?.send("spectator", { name: acc.username, friend: friends.has(m.account.id) });
    }
  }

  /** The whole game as a spectator sees it: both hands and both libraries face down. */
  private sendGameToSpectator(client: Client) {
    if (!this.game) return;
    const winnerName = this.coin ? this.members.find((x) => x.seat === this.coin!.winner)?.account.username : "";
    const callerName = this.coin ? this.members.find((x) => x.seat === this.coin!.caller)?.account.username : "";
    client.send("start", {
      view: spectatorView(this.game),
      events: [] as GameEvent[],
      you: "p1",
      spectator: true,
      names: Object.fromEntries(this.members.map((x) => [x.seat, x.account.username])),
      deckNames: this.deckNames,
      summary: this.coin ? `${callerName} called ${this.coin.call}; it landed ${this.coin.result}. ${winnerName} won the flip and chose to go ${this.coin.chose}.` : "",
      fresh: false,
      looks: this.looks(),
    });
  }

  private snapshot(m: Pick<Member, "seat">, spectating = false): RoomSnapshot {
    return {
      stage: this.stage,
      name: this.title,
      you: m.seat,
      host: "p1",
      locked: this.password !== "",
      size: this.size,
      mismatch: this.mismatch,
      players: this.members.map((x) => ({ seat: x.seat, name: x.account.username, connected: x.connected, voted: x.vote, deckReady: x.deck !== null, ...(x.account.avatar ? { avatar: x.account.avatar } : {}), ...(x.isBot ? { bot: true } : {}), ...(x.look ? { look: x.look } : {}) })),
      coin: this.coin,
      winner: this.winner,
      endReason: this.endReason,
      rematch: this.stage === "over" && this.members.length === 2 ? this.rematchFrom : null,
      series: this.series && this.series.bestOf > 1 ? { bestOf: this.series.bestOf, game: this.series.game, wins: { ...this.series.wins }, decided: this.series.decided, ready: [...this.series.ready] } : null,
      spectators: this.spectators.size,
      ...(spectating ? { spectating: true } : {}),
    };
  }

  /** Tells every player where things stand, and updates the room's line in the lobby. */
  private publish() {
    this.touch();
    for (const m of this.members) this.clientOf(m)?.send("room", this.snapshot(m));
    for (const id of this.spectators.keys()) this.clientById(id)?.send("room", this.snapshot({ seat: "p1" }, true));
    const host = this.members.find((x) => x.seat === "p1");
    void this.setMetadata({ name: this.title, host: host?.account.username ?? "", players: this.members.map((x) => x.account.username), status: this.stage, turn: this.game?.turn ?? 0, locked: this.password !== "", bot: this.bot !== undefined, spectators: this.spectators.size });
    this.persist();
  }

  /** Saves the match shortly after a change, so a restart can bring it back. */
  private persist() {
    if (this.ended || this.shuttingDown || this.members.length === 0) return;
    this.saveTimer ??= this.clock.setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  /** Saves now. Resolves once this save (and any before it) is done. */
  private flush(): Promise<void> {
    this.saveTimer?.clear();
    this.saveTimer = undefined;
    if (this.ended || this.members.length === 0) return this.saving;
    const json = JSON.stringify(this.toSaved());
    this.saving = this.saving.then(() => saveLive(this.roomId, json));
    return this.saving;
  }

  /** The match is over, or the room closed: the saved copy is deleted, after any save still on its way so that can't bring it back. */
  private forget() {
    this.ended = true;
    this.saveTimer?.clear();
    this.saveTimer = undefined;
    const roomId = this.roomId;
    this.saving = this.saving.then(() => dropLive(roomId));
  }

  private toSaved(): SavedMatch {
    return {
      title: this.title,
      password: this.password,
      banned: [...this.banned],
      members: this.members.map(({ account, seat, vote, deck, isBot }) => ({ account, seat, vote, deck, isBot })),
      stage: this.stage,
      size: this.size,
      mismatch: this.mismatch,
      coin: this.coin,
      game: this.game,
      deckNames: this.deckNames,
      replay: this.replay,
    };
  }

  /** Between the games of a series: the computer is ready at once, and the next game starts by itself after a minute. */
  private scheduleNextGame() {
    const s = this.series;
    if (!s) return;
    s.ready.clear();
    clearTimeout(this.nextTimer);
    const bot = this.bot;
    if (bot) s.ready.add(bot.seat);
    this.nextTimer = setTimeout(() => void this.startNextGame(), 60_000);
  }

  /** The next game of the series: the same decks, and the player who lost the last game goes first. */
  private async startNextGame() {
    const s = this.series;
    if (this.stage !== "over" || !s || s.decided || this.members.length !== 2) return;
    clearTimeout(this.nextTimer);
    s.game++;
    s.ready.clear();
    const first: PlayerId = this.winner === "p1" ? "p2" : this.winner === "p2" ? "p1" : this.replay?.starting === "p1" ? "p2" : "p1";
    this.game = null;
    this.winner = null;
    this.endReason = null;
    this.endingTurn = null;
    this.botRun++;
    await this.startGame(first);
  }

  /** The rematch was accepted: the same two players choose their decks again, then the coin is tossed, then a new game begins. */
  private async beginRematch() {
    if (this.stage !== "over" || !this.rematchFrom || this.members.length !== 2) return;
    const bot = this.bot;
    if (bot && MatchRoom.botRooms.size >= LIMITS.maxBotGames() && !MatchRoom.botRooms.has(this.roomId)) {
      this.rematchFrom = null;
      for (const m of this.members) this.clientOf(m)?.send("error", { message: "The computer opponents are all busy right now. Try again in a moment." });
      this.publish();
      return;
    }
    // each player holds a seat in one room again (a player who has since opened or joined another room can't take part)
    for (const m of this.members) {
      if (m.isBot) continue;
      try {
        await this.claim(m.account.id);
      } catch {
        this.rematchFrom = null;
        for (const x of this.members) this.clientOf(x)?.send("error", { message: `${m.account.username} is in another room, so there is no rematch.` });
        this.publish();
        return;
      }
      this.claimed.add(m.account.id);
      void this.presence.set(acctKey(m.account.id), this.roomId);
    }
    if (this.stage !== "over" || this.members.length !== 2) return; // (someone left while the claims were made)
    if (bot) MatchRoom.botRooms.add(this.roomId);
    clearTimeout(this.botTimer);
    this.botRun++;
    this.rematchFrom = null;
    this.game = null;
    this.replay = null;
    this.coin = null;
    this.winner = null;
    this.endReason = null;
    this.endingTurn = null;
    this.deckNames = { p1: "", p2: "" };
    this.ended = false;
    if (this.series) this.series = { bestOf: this.series.bestOf, game: 1, wins: { p1: 0, p2: 0 }, decided: false, ready: new Set() };
    this.members.forEach((x) => ((x.vote = null), (x.deck = null)));
    this.mismatch = false;
    this.size = DECK_SIZE;
    this.stage = "decks";
    this.publish();
  }

  /** The coin waits for the guest to call it (the host already started the vote); the "call" message flips it. */
  private startCoin() {
    this.coin = { caller: "p2", call: null, result: null, winner: null, chose: null };
    this.stage = "coin";
    // The bot is the guest: it calls the coin itself, after a moment.
    const bot = this.bot;
    if (bot) {
      this.botTimer = setTimeout(() => this.callCoin(bot, Math.random() < 0.5 ? "heads" : "tails"), 1500);
    }
  }

  /** The caller calls heads or tails and the coin is flipped. If the bot wins the toss, it chooses to go first once the coin has landed. */
  private callCoin(m: Member, side: Side) {
    if (this.stage !== "coin" || !this.coin || this.coin.caller !== m.seat || this.coin.call) return;
    const result: Side = Math.random() < 0.5 ? "heads" : "tails";
    this.coin = { ...this.coin, call: side, result, winner: result === side ? m.seat : m.seat === "p1" ? "p2" : "p1" };
    this.publish();
    const bot = this.bot;
    if (bot && this.coin.winner === bot.seat) {
      this.botTimer = setTimeout(() => {
        if (this.stage !== "coin" || !this.coin || this.coin.chose) return;
        this.coin.chose = "first";
        void this.startGame(bot.seat);
        this.publish();
      }, 5500);
    }
  }

  /** What a player is shown when the game ends: their own library, top card first, and only the card details that library needs. */
  private revealFor(seat: PlayerId) {
    const all = this.revealed!;
    const library = all.libraries[seat];
    const cards: typeof all.cards = {};
    for (const id of new Set(library)) if (all.cards[id]) cards[id] = all.cards[id];
    return { library, cards };
  }

  private async startGame(first: PlayerId) {
    const [a, b] = [this.members.find((x) => x.seat === "p1")!, this.members.find((x) => x.seat === "p2")!];
    this.deckNames = { p1: a.deck!.name, p2: b.deck!.name };
    const decks = { p1: a.deck!.ids, p2: b.deck!.ids };
    const sides = { ...(a.deck!.side ? { p1: a.deck!.side } : {}), ...(b.deck!.side ? { p2: b.deck!.side } : {}) };
    try {
      const seed = Math.floor(Math.random() * 2 ** 31);
      this.game = createGame(decks, seed, this.defs, { startingPlayer: first, mulligan: true, shuffleStep: true, sideboards: sides });
      this.replay = { v: 1, seed, starting: first, names: { p1: a.account.username, p2: b.account.username }, decks, ...(Object.keys(sides).length > 0 ? { sides } : {}), cards: this.game.cards, log: [], at: new Date().toISOString() };
    } catch (e) {
      // a deck the engine can't play got through: send both players back to choose again, instead of leaving the match stuck
      console.error("Could not start the match:", e instanceof Error ? e.message : e);
      for (const m of this.members) {
        m.deck = null;
        this.clientOf(m)?.send("error", { message: `${e instanceof Error ? e.message : "That deck can't be played"} Choose your decks again.` });
      }
      this.coin = null;
      this.stage = "decks";
      this.publish();
      return;
    }
    this.revealed = null;
    this.stage = "playing";
    this.publish();
    for (const m of this.members) this.sendGame(m, true);
    for (const id of this.spectators.keys()) {
      const watcher = this.clientById(id);
      if (watcher) this.sendGameToSpectator(watcher);
    }
    this.scheduleBot();
  }

  /** The whole game as one player sees it: sent when the match starts and to a player who reconnects. */
  private sendGame(m: Member, fresh = false) {
    if (!this.game) return;
    const winnerName = this.coin ? this.members.find((x) => x.seat === this.coin!.winner)?.account.username : "";
    const callerName = this.coin ? this.members.find((x) => x.seat === this.coin!.caller)?.account.username : "";
    this.clientOf(m)?.send("start", {
      view: viewFor(this.game, m.seat),
      events: [] as GameEvent[],
      you: m.seat,
      names: Object.fromEntries(this.members.map((x) => [x.seat, x.account.username])),
      deckNames: this.deckNames,
      ...(m.deck ? { deck: m.deck } : {}),
      summary: this.coin ? `${callerName} called ${this.coin.call}; it landed ${this.coin.result}. ${winnerName} won the flip and chose to go ${this.coin.chose}.` : "",
      fresh,
      looks: this.looks(),
    });
  }

  private sendUpdate(events: GameEvent[]) {
    if (!this.game) return;
    this.touch(); // a move was made: the room is in use
    for (const m of this.members) this.clientOf(m)?.send("update", { view: viewFor(this.game, m.seat), events });
    if (this.spectators.size > 0) {
      const view = spectatorView(this.game);
      for (const id of this.spectators.keys()) this.clientById(id)?.send("update", { view, events });
    }
  }

  /** One action at a time, only from the right player, and the new state goes out to both. */
  private play(m: Member, run: () => { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string }) {
    if (this.stage !== "playing" || !this.game || this.busy || this.shuttingDown) return;
    this.busy = true;
    try {
      const r = run();
      if (!r.ok) {
        this.clientOf(m)?.send("error", { message: r.error });
        return;
      }
      this.game = r.state;
      this.sendUpdate(r.events);
      this.persist();
      if (this.game.winner) this.finish(this.game.winner, null);
    } finally {
      this.busy = false;
    }
    this.continueEndTurn();
    this.scheduleBot();
  }

  /** The bot's turn to act: it thinks (it is quick), waits a moment so the screen can follow, then plays. */
  private scheduleBot() {
    const bot = this.bot;
    if (!bot || this.stage !== "playing" || !this.game || this.game.winner || playerToAct(this.game) !== bot.seat) return;
    clearTimeout(this.botTimer);
    const run = ++this.botRun;
    this.botTimer = setTimeout(async () => {
      const game = this.game;
      if (!game || this.stage !== "playing" || playerToAct(game) !== bot.seat) return;
      // the bot thinks in a worker thread, and is given only what a player could see
      const action = await botPool.think(viewFor(game, bot.seat), bot.seat);
      if (run !== this.botRun || this.stage !== "playing") return; // the room moved on or closed while it thought
      if (this.game !== game) return void this.scheduleBot(); // the game changed meanwhile: think again about the new position
      if (!action) {
        this.finish(bot.seat === "p1" ? "p2" : "p1", "The bot could not find a move.");
        return;
      }
      const quick = ["passPriority", "passPhase", "keepHand", "mulligan", "discard", "assignDamage", "pick", "chooseTargets", "declareBlockers"].includes(action.type);
      this.botTimer = setTimeout(() => this.play(bot, () => this.applyFor(bot.seat, action)), quick ? 250 : 900 + Math.random() * 600);
    }, 60);
  }

  /** After a restart, once the player is back: the bot carries on with what it was about to do. */
  private resumeBot() {
    const bot = this.bot;
    if (bot && this.stage === "coin" && this.coin && !this.coin.call) this.startCoin(); // it calls the coin again
    else if (bot && this.stage === "coin" && this.coin?.winner === bot.seat && !this.coin.chose) {
      this.coin.chose = "first";
      void this.startGame(bot.seat);
      this.publish();
    } else this.scheduleBot();
  }

  private get bot(): Member | undefined {
    return this.members.find((x) => x.isBot);
  }

  private applyFor(seat: PlayerId, action: Action, spare?: string[]) {
    const state = this.game!;
    if (action.type !== "concede" && action.type !== "setStops" && playerToAct(state) !== seat) return { ok: false as const, error: "It isn't your turn to act." };
    const held = spare && spare.length > 0 ? { ...state, players: { ...state.players, [seat]: { ...state.players[seat], spareMana: spare } } } : state;
    const r = applyAction(held, seat, action);
    if (r.ok) this.replay?.log.push({ p: seat, a: action, ...(spare && spare.length > 0 ? { s: spare } : {}) });
    if (r.ok) r.state.players[seat].spareMana = undefined;
    return r;
  }

  /**
   * "End turn" stops where something needs a choice first, like the target of a "beginning of combat" trigger (it
   * triggers even without an attack). Once that has resolved and it's the player's move again, the turn carries on ending.
   */
  private continueEndTurn() {
    const e = this.endingTurn;
    const g = this.game;
    if (!e || !g) return;
    if (this.stage !== "playing" || g.turn !== e.turn || g.winner || g.phase === "cleanup") {
      this.endingTurn = null;
      return;
    }
    if (playerToAct(g) !== e.seat || g.priority || g.pendingChoice || g.pendingPick) return; // still settling
    const m = this.members.find((x) => x.seat === e.seat);
    const r = this.passThroughTurn(e.seat);
    if (!m || !r.ok) {
      this.endingTurn = null;
      return;
    }
    this.play(m, () => r);
  }

  /** "End turn": passes through the rest of the turn in one go, as the hot-seat button does. */
  private passThroughTurn(seat: PlayerId) {
    let s = this.game!;
    if (playerToAct(s) !== seat) return { ok: false as const, error: "It isn't your turn to act." };
    const events: GameEvent[] = [];
    const turn = s.turn;
    for (let i = 0; i < 6 && s.turn === turn && !s.winner && s.phase !== "cleanup"; i++) {
      const who = playerToAct(s);
      const r = applyAction(s, who, { type: "passPhase" });
      if (!r.ok) return i === 0 ? r : { ok: true as const, state: s, events };
      this.replay?.log.push({ p: who, a: { type: "passPhase" } });
      s = r.state;
      events.push(...r.events);
    }
    return { ok: true as const, state: s, events };
  }

  private finish(winner: PlayerId | "draw", reason: string | null) {
    if (this.stage === "over") return;
    // A match that never got past the opening (keeping or mulliganing the hand: someone left, or the page was closed) is
    // not a result: nobody lost a game that did not begin. Only a game that really started is recorded.
    const began = !!this.game && this.game.phase !== "mulligan" && !this.game.opening;
    if (reason && this.game && !this.game.winner) {
      // someone left: the game state itself records the result
      const r = applyAction(this.game, winner === "p1" ? "p2" : "p1", { type: "concede" });
      if (r.ok) {
        this.replay?.log.push({ p: winner === "p1" ? "p2" : "p1", a: { type: "concede" } });
        this.game = r.state;
        this.sendUpdate(r.events);
      }
    }
    // The libraries are turned face up for the players: what was left in them, and what would have been drawn next (the first card of each).
    if (this.game) {
      const libraries = { p1: this.game.players.p1.library.map((c) => c.defId), p2: this.game.players.p2.library.map((c) => c.defId) } as Record<PlayerId, string[]>;
      const cards: NonNullable<MatchRoom["revealed"]>["cards"] = {};
      for (const id of new Set([...libraries.p1, ...libraries.p2])) {
        const d = this.game.cards[id];
        if (d && id !== HIDDEN_CARD_ID) cards[id] = { id: d.id, name: d.name, type: d.type, ...(d.image ? { image: d.image } : {}), ...(d.typeLine ? { typeLine: d.typeLine } : {}), ...(d.manaCost ? { manaCost: d.manaCost } : {}), ...(d.scryfallId ? { scryfallId: d.scryfallId } : {}) };
      }
      this.revealed = { libraries, cards };
      // Each player is sent ONLY their own library: the opponent's stays hidden.
      for (const m of this.members) this.clientOf(m)?.send("reveal", this.revealFor(m.seat));
    }
    this.winner = winner;
    this.endReason = reason;
    this.rematchFrom = null;
    this.stage = "over";
    const series = this.series;
    if (series && series.bestOf > 1) {
      if (winner !== "draw") series.wins[winner]++;
      series.decided = reason !== null || (winner !== "draw" && series.wins[winner] >= Math.ceil(series.bestOf / 2));
      if (!series.decided) {
        // the series goes on: nothing is saved yet, the players keep their seats and decks, and the next game follows
        this.scheduleNextGame();
        this.publish();
        return;
      }
    }
    MatchRoom.botRooms.delete(this.roomId);
    for (const m of this.members) this.release(m.account.id); // a finished game no longer holds the players to this room
    this.forget(); // the result is recorded below; there is nothing left to bring back
    const a = this.members.find((x) => x.seat === "p1");
    const b = this.members.find((x) => x.seat === "p2");
    const replay = this.replay;
    if (replay) {
      replay.winner = winner;
      replay.reason = reason;
    }
    if (a && b && !this.bot && began) void saveMatch({ p1: a.account.id, p2: b.account.id, winner: winner === "draw" ? null : (winner === "p1" ? a : b).account.id, turns: this.game?.turn ?? 0 }).then((id) => (id && replay ? saveReplay(id, replay) : undefined));
    this.publish();
  }

  /** Closes a room that nobody is using, so abandoned rooms don't pile up. Every update starts the clock again. */
  private touch() {
    clearTimeout(this.idleTimer);
    const minutes = this.stage === "playing" ? LIMITS.stuckGameMinutes() : this.stage === "over" ? 10 : LIMITS.idleMinutes();
    this.idleTimer = setTimeout(() => {
      this.broadcast("closed", { message: "The room was closed because nobody had done anything for a while." });
      void this.disconnect();
    }, minutes * 60_000);
    this.idleTimer.unref?.();
  }

  onDispose() {
    clearTimeout(this.botTimer);
    clearTimeout(this.nextTimer);
    clearTimeout(this.idleTimer);
    this.botRun++;
    MatchRoom.botRooms.delete(this.roomId);
    for (const id of [...this.claimed]) this.release(id);
  }

  /** Test helper: the real state, never sent to anyone. */
  debugGame() {
    return this.game;
  }
}

export { HIDDEN_CARD_ID };
