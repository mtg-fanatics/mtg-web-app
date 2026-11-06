import type { GameEvent, GameState, PlayerId } from "@mtg/engine";

// The messages between the website and the live game server (game-server/src/rooms/MatchRoom.ts). Keep the two in step.

export type Stage = "waiting" | "vote" | "decks" | "coin" | "playing" | "over";
export const DECK_SIZES = [20, 40, 60] as const;
/** Close code for a guest the host removed: the browser says so, and doesn't try to reconnect. */
export const KICKED = 4100;
/** Error code for a restore of a match that has ended or was never saved: the browser stops trying. */
export const MATCH_GONE = 410;

/** A player's card sleeve and playmat, each "preset:<id>" or "" for their default. */
export interface Look {
  sleeve: string;
  mat: string;
  /** The finishing move this player plays when they win. */
  finisher?: string;
}

/** What a room looks like to the lobby list. */
export interface LobbyRoomInfo {
  roomId: string;
  name: string;
  host: string;
  players: string[];
  status: Stage;
  turn: number;
  clients: number;
  maxClients: number;
  /** A password is needed to join. */
  locked: boolean;
  /** A room with a computer opponent: nobody else can join it. */
  bot: boolean;
  /** People watching the match. */
  spectators: number;
}

/** Where a room stands, as sent to each player in it. */
export interface RoomSnapshot {
  stage: Stage;
  name: string;
  you: PlayerId;
  host: PlayerId;
  locked: boolean;
  size: number | null;
  mismatch: boolean;
  players: { seat: PlayerId; name: string; connected: boolean; voted: number | null; deckReady: boolean; avatar?: string; bot?: boolean; look?: Look }[];
  /** `call`, `result` and `winner` stay null until the caller has called heads or tails. */
  coin: { caller: PlayerId; call: "heads" | "tails" | null; result: "heads" | "tails" | null; winner: PlayerId | null; chose: "first" | "second" | null } | null;
  winner: PlayerId | "draw" | null;
  endReason: string | null;
  /** After the game: the player who asked for a rematch, until the other answers. */
  rematch: PlayerId | null;
  /** Best of 3 or 5: the games so far. Null for a single game. */
  series: { bestOf: number; game: number; wins: Record<PlayerId, number>; /** The whole series is over (someone has won enough games, or left). */ decided: boolean; /** Between games: who has pressed "Next game". */ ready: PlayerId[] } | null;
  /** How many people are watching. */
  spectators: number;
  /** True when this player is watching, not playing (`you` is then only the side the board is drawn from). */
  spectating?: boolean;
}

/** After the game: this player's own library, top card first, with what is needed to draw it. (The opponent's is never sent.) */
export interface RevealPayload {
  library: string[];
  cards: Record<string, { id: string; name: string; type: string; image?: string; typeLine?: string; manaCost?: string; scryfallId?: string }>;
}

/** The match has begun (or the player came back to it): the game as this player sees it. */
export interface StartPayload {
  view: GameState;
  events: GameEvent[];
  you: PlayerId;
  names: Record<PlayerId, string>;
  deckNames: Record<PlayerId, string>;
  /** This player's own deck, so they can keep a copy of a random one. */
  deck?: { name: string; ids: string[] };
  summary: string;
  fresh: boolean;
  /** True for someone watching: both hands are face down and nothing can be done. */
  spectator?: boolean;
  /** Each player's card sleeve and playmat, chosen before the match. */
  looks?: Record<PlayerId, Look>;
}

export interface UpdatePayload {
  view: GameState;
  events: GameEvent[];
}

export interface ChatLine {
  id: number;
  from: PlayerId;
  name: string;
  text: string;
}

/** A friend asking this player to join their match room (game-server/src/rooms/SocialRoom.ts). */
export interface Invite {
  fromId: string;
  from: string;
  roomId: string;
  roomName: string;
  /** The room has a password: the invitation lets this player in without it. */
  locked: boolean;
  /** When it arrived (set by the browser). */
  at: number;
}

/** How one friend is doing, from the game server (game-server/src/rooms/SocialRoom.ts). */
export interface FriendStatus {
  id: string;
  online: boolean;
  /** The room this friend is in. A match with status "playing" can be watched. */
  match: { roomId: string; name: string; locked: boolean; status: Stage; bot: boolean; spectators: number; players: string[] } | null;
}
