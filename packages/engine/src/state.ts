import { CARDS } from "./cards.js";
import { doubleFaces } from "./oracle/doubleFaced.js";
import { isSupportedCard, parseCard } from "./oracle.js";
import type { CardDef, CardInstance, GameState, PlayerId, PlayerState } from "./types.js";

export const STARTING_LIFE = 20;
export const STARTING_HAND = 7;

/** mulberry32: tiny seeded RNG. Takes a state, returns [0,1) value and next state. */
export function nextRandom(rng: number): [number, number] {
  let t = (rng + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Fisher-Yates. Returns a new array and the advanced RNG state. */
export function shuffle<T>(items: readonly T[], rng: number): [T[], number] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const [r, next] = nextRandom(rng);
    rng = next;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, rng];
}

function makePlayer(id: PlayerId, deck: string[], rng: number, defs: Record<string, CardDef>): [PlayerState, number] {
  for (const defId of deck) {
    if (!defs[defId]) throw new Error(`Unknown card: ${defId}`);
    if (defs[defId].playable === false || !isSupportedCard(defs[defId])) throw new Error(`${defs[defId].name} can't be played yet.`);
  }
  // Shuffled before the ids are given out: `viewFor` hides a card but keeps its id, and an id that followed
  // the deck list (cards grouped, the starter deck's order public) would tell the opponent which card it is.
  const [order, nextRng] = shuffle(deck, rng);
  const library: CardInstance[] = order.map((defId, i) => ({ iid: `${id}-${i}`, defId, owner: id }));
  const player: PlayerState = {
    id,
    life: STARTING_LIFE,
    library: library.slice(STARTING_HAND),
    hand: library.slice(0, STARTING_HAND),
    battlefield: [],
    graveyard: [],
    exile: [],
    landsPlayedThisTurn: 0,
  };
  return [player, nextRng];
}

/** Shuffled before the ids are given out, like the library, so an id doesn't tell which card it is. */
function sideboardOf(id: PlayerId, cards: string[], seed: number): CardInstance[] | undefined {
  if (cards.length === 0) return undefined;
  const [order] = shuffle(cards, seed);
  return order.map((defId, i) => ({ iid: `${id}-sb${i}`, defId, owner: id }));
}

/**
 * Create a new game. Both players draw an opening hand of 7.
 * By default p1 goes first and the game starts at main1 of turn 1. With `mulligan: true` the game
 * starts in the mulligan phase instead; the starting player skips their first draw (rule 103.8a).
 */
export function createGame(
  decks: Record<PlayerId, string[]>,
  seed: number,
  cardDefs: Record<string, CardDef> = CARDS,
  options: { startingPlayer?: PlayerId; mulligan?: boolean; shuffleStep?: boolean; sideboards?: Partial<Record<PlayerId, string[]>> } = {},
): GameState {
  const [p1, rng1] = makePlayer("p1", decks.p1, seed, cardDefs);
  const [p2, rng2] = makePlayer("p2", decks.p2, rng1, cardDefs);
  // The sideboard is outside the game: only "learn" reaches into it. A card the engine can't play stays out.
  const usable = (id: string) => cardDefs[id] !== undefined && cardDefs[id].playable !== false && isSupportedCard(cardDefs[id]);
  const sideboards = { p1: (options.sideboards?.p1 ?? []).filter(usable), p2: (options.sideboards?.p2 ?? []).filter(usable) };
  p1.sideboard = sideboardOf("p1", sideboards.p1, seed);
  p2.sideboard = sideboardOf("p2", sideboards.p2, seed + 1);
  // Keep only the cards actually used in this game.
  const cards: Record<string, CardDef> = Object.fromEntries(
    [...new Set([...decks.p1, ...decks.p2, ...sideboards.p1, ...sideboards.p2])].map((id) => [id, cardDefs[id]]),
  );
  // A transforming card is played as its front face; its back face waits in the card list for when it transforms.
  for (const [id, def] of Object.entries(cards)) {
    const faces = def ? doubleFaces(def) : null;
    if (!faces) continue;
    cards[id] = faces.front;
    cards[faces.back.id] = faces.back;
  }
  const game: GameState = {
    cards,
    players: { p1, p2 },
    startingPlayer: options.startingPlayer ?? "p1",
    opening: options.mulligan
      ? { taken: { p1: 0, p2: 0 }, kept: { p1: false, p2: false }, ...(options.shuffleStep ? { shuffled: { p1: false, p2: false } } : {}) }
      : null,
    active: options.startingPlayer ?? "p1",
    turn: 1,
    phase: options.mulligan ? "mulligan" : "main1",
    combat: null,
    rng: rng2,
    winner: null,
    stack: [],
    priority: null,
    pendingChoice: null,
    pendingPick: null,
    triggerQueue: [],
    nextId: 1,
  };
  if (!options.mulligan) beginWithOpeningHandCards(game);
  return game;
}

/** Leyline Axe: "If this card is in your opening hand, you may begin the game with it on the battlefield." (always taken) */
export function beginWithOpeningHandCards(state: GameState): void {
  for (const player of Object.values(state.players)) {
    for (const card of [...player.hand]) {
      if (!parseCard(state.cards[card.defId]).beginsOnBattlefield) continue;
      player.hand.splice(player.hand.indexOf(card), 1);
      player.battlefield.push({ card, tapped: false, summoningSick: false, damage: 0 });
    }
  }
}
