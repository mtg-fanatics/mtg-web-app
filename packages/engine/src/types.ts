// Pure game types. No imports from React/Next/Colyseus/Supabase.

import type { ModeSpec, PendingChoice, PendingPick, PriorityRound, StackItem, StaticEffect, TargetSpec } from "./effects.js";
import type { Keyword } from "./keywords.js";
import type { ManaColor } from "./mana.js";

export type PlayerId = "p1" | "p2";

export type Phase =
  | "mulligan" // before turn 1: each player keeps or mulligans (rule 103.5)
  | "untap"
  | "draw"
  | "main1"
  | "attackers" // active player declares attackers
  | "blockers" // defending player declares blockers
  | "damage" // active player divides damage among multiple blockers (rule 510.1c)
  | "main2"
  | "end"
  | "cleanup"; // active player discards down to the maximum hand size (rule 514.1)

export interface Combat {
  /** `blockers` are the iids of the creatures blocking this attacker (empty = unblocked). */
  attackers: { attacker: string; blockers: string[]; /** The planeswalker it attacks (missing: it attacks the player). */ target?: string }[];
}

export type CardType =
  | "land"
  | "creature"
  | "instant"
  | "sorcery"
  | "enchantment"
  | "artifact"
  | "planeswalker"
  | "battle"
  | "other";

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  /** Generic mana cost (colors come later). Lands cost 0. */
  cost: number;
  power?: number;
  toughness?: number;
  /** Planeswalkers: starting loyalty. (The database keeps it in the toughness column; the card loader copies it here.) */
  loyalty?: number;
  /** Path of the card art inside the Supabase "card-art" bucket (optional). */
  image?: string;
  /** false = the card exists but the engine can't play it yet (has abilities, other types...). */
  playable?: boolean;
  /** Display-only details, e.g. "Creature — Bear", "{1}{G}", rules text. */
  typeLine?: string;
  manaCost?: string;
  text?: string;
  colors?: string[];
  rarity?: string;
  /** Scryfall printing id, used to load a high-resolution image for the card detail view. */
  scryfallId?: string;
  /** Library only: the set (its code) a search asked for, so the card is shown as printed there. */
  printSet?: string;
  /** Keyword abilities printed on the card, lowercase, e.g. ["flying", "first strike"]. */
  keywords?: string[];
}

/** One physical card in a game. `iid` is unique per game; `defId` points at a CardDef. */
export interface CardInstance {
  iid: string;
  defId: string;
  owner: PlayerId;
  /** On the battlefield, the card's own definition while it is something else (a copy of another creature, or an enchantment instead of a creature). */
  printed?: string;
  /** In exile: the permanent that exiled it ("each creature card exiled with ~"). */
  exiledBy?: string;
}

export interface Permanent {
  card: CardInstance;
  tapped: boolean;
  summoningSick: boolean;
  damage: number;
  /** Dealt damage by a deathtouch source this turn, so it is destroyed even without lethal damage. */
  deathtouched?: boolean;
  /** "Until end of turn" changes, cleared when the turn ends. */
  /** The spells and abilities behind the "until end of turn" changes below (names and card ids), so the board can show where they come from. */
  tempFrom?: { name: string; defId?: string }[];
  /** Permanents that dealt damage to this one this turn ("whenever a creature dealt damage by ~ this turn dies"). */
  damagedBy?: string[];
  /** Stun counters: instead of untapping, remove one. */
  stun?: number;
  /** "Can't be blocked this turn." */
  unblockableTurn?: boolean;
  /** "Becomes 4/4 until end of turn", "loses defender until end of turn". */
  tempBase?: { power: number; toughness: number };
  tempNoDefender?: boolean;
  /** "Assigns combat damage equal to its toughness rather than its power this turn." */
  damageByToughness?: boolean;
  /** "When this creature deals combat damage, sacrifice it" (until end of turn). */
  sacOnDamage?: boolean;
  /** It attacked this turn. */
  attackedThisTurn?: boolean;
  /** Cards this permanent keeps in exile until it leaves the battlefield (Banishing Light), and ones exiled from a hand (Deep-Cavern Bat). */
  held?: CardInstance[];
  heldFromHand?: CardInstance[];
  powerBonus?: number;
  toughnessBonus?: number;
  tempKeywords?: Keyword[];
  /** An Aura: the iid of the permanent it is attached to. */
  attachedTo?: string;
  /** +1/+1 counters. */
  counters?: number;
  /** Counters of any other kind, by name ("bait", "incubation", "page"...): the cards that use them say what they do. */
  named?: Record<string, number>;
  /** -1/-1 counters. A +1/+1 and a -1/-1 counter on the same permanent cancel each other out. */
  minusCounters?: number;
  /** Dealt damage by a source with infect: some of its -1/-1 counters came from infect. */
  infected?: boolean;
  /** It was cast with its kicker paid. */
  kicked?: boolean;
  /** It entered from a spell that was cast ("when this enters, if you cast it"). */
  cast?: boolean;
  /** For as long as it stays: "is a 1/1 Spirit in addition to its other types". */
  baseOverride?: { power: number; toughness: number };
  addedSubtypes?: string[];
  /** A Vehicle that has been crewed this turn: it is an artifact creature until end of turn. */
  crewed?: boolean;
  /** The creatures that crewed it this turn. */
  crewedBy?: string[];
  /** "Prevent the next 3 damage that would be dealt to it this turn": what is left of the shield. */
  preventShield?: number;
  /** "Prevent all combat damage that would be dealt to it this turn." */
  noCombatDamage?: boolean;
  /** Fake Your Own Death: until end of turn, when it dies it returns tapped and the player who cast the spell gets a Treasure. */
  returnOnDeath?: PlayerId;
  /** Soulstone Sanctuary: it became a creature for good. */
  animated?: boolean;
  /** Regeneration shields (until end of turn): the next time it would be destroyed it is tapped and healed instead. */
  regenShield?: number;
  /** Hit by something that says it "can't be regenerated" this turn. */
  noRegen?: boolean;
  /** "As this enters, choose a color": the color that was chosen. */
  chosenColor?: "W" | "U" | "B" | "R" | "G";
  /** "As this land enters, choose a creature type": the type that was chosen (lowercase). */
  chosenType?: string;
  /** Sorcerous Spyglass: the card name it names. */
  chosenName?: string;
  /** Control was taken "until end of turn": the player it goes back to. */
  controlReturn?: PlayerId;
  /** Control was taken "for as long as you control" `source`: it goes back to `owner` when that ends. */
  controlledWhile?: { source: string; owner: PlayerId };
  /** "Target creature can't block this turn." */
  cantBlockTurn?: boolean;
  /** Planeswalkers: loyalty counters. At 0 the planeswalker is put into the graveyard. */
  loyalty?: number;
  /** Planeswalkers: a loyalty ability was already activated this turn (only one per turn). */
  loyaltyUsed?: boolean;
  /** Indexes of its activated abilities already used this turn (for "activate only once each turn"). */
  usedAbilities?: number[];
  /** The turn it entered, for "as long as this Aura entered this turn". */
  enteredTurn?: number;
  /** The X paid for it, for "when this enters, tap X target creatures". */
  xPaid?: number;
  /** Prepared: the card id of its spell, a copy of which may be cast (and that unprepares it). */
  prepared?: string;
  /** "Choose one that hasn't been chosen": the modes already chosen. */
  chosenModes?: number[];
  /** "If that creature would die this turn, exile it instead." */
  exileOnDeath?: boolean;
  /** "Must be blocked this turn if able." */
  mustBeBlocked?: boolean;
  /** "~ becomes a Werewolf": its creature types now. */
  subtypesOverride?: string[];
  /** Indexes of its "activate only once" abilities that were used. */
  usedOnce?: number[];
  /** Venom Connoisseur: how many times its ability resolved this turn. */
  venomCount?: number;
  /** Until end of turn: "When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it." */
  diesReturn?: boolean;
  /** Until end of turn: "whenever that creature deals combat damage to a player this turn, you draw a card": who draws, and the card that said so. */
  damageDraws?: { player: PlayerId; source: string }[];
  /** A finality counter: if it would die, it is exiled instead. */
  finality?: boolean;
  /** Cast for its warp cost: exiled at the beginning of the next end step. */
  warped?: boolean;
  /** A Case that has been solved. */
  solved?: boolean;
  /** Keyword counters ("an indestructible counter"): it has these keywords for as long as it stays. */
  kwCounters?: Keyword[];
  /** Until end of turn: its base power is the number of cards in its controller's hand (Ms. Marvel). */
  powerFromHand?: boolean;
  /** +1/+1 counters put on it this turn, and whether it became tapped already this turn. */
  countersThisTurn?: number;
  tappedThisTurn?: boolean;
  /** Invasion counters (Alien Invasion). */
  invasion?: number;
  /** Renown: it already got its counters. */
  renowned?: boolean;
  /** Echo: its echo cost is still to be paid at the next upkeep. */
  echoDue?: boolean;
  /** Cumulative upkeep: the age counters on it. */
  age?: number;
  /** Lore counters on a Saga. */
  lore?: number;
  /** Plan counters (Marvel's Plan enchantments). */
  planCounters?: number;
  /** Until end of turn: creature types it has in addition to its own ("becomes a 1/1 Phyrexian Blinkmoth artifact creature"). */
  tempSubtypes?: string[];
  /** Until end of turn: creature types it doesn't have ("isn't a Human"), and the colors it has instead of its own ("a 3/3 green Ape"). */
  tempLostSubtypes?: string[];
  tempColors?: string[];
  /** Until end of turn it is a creature but not an artifact (Treetop Village), though it was made one like a crewed Vehicle. */
  tempNonartifact?: boolean;
  /** This turn: players whose spells and abilities can't target it ("can't be the target of spells or abilities your opponents control this turn"). */
  untargetableBy?: PlayerId[];
  /** A Class: the level it has reached (1 as it enters). */
  classLevel?: number;
  /** "Sacrifice it at the beginning of the next end step." */
  sacAtEnd?: boolean;
}

/** Mana that was added and not spent yet: it lasts until the end of the phase it was made in (or of combat, for firebending). */
export interface FloatingMana {
  color: ManaColor;
  turn: number;
  phase: Phase;
  /** "This mana lasts until end of combat." */
  combat?: boolean;
  /** Savage Ventmaw: it isn't lost as steps and phases end this turn. */
  allTurn?: boolean;
}

export interface PlayerState {
  id: PlayerId;
  life: number;
  library: CardInstance[]; // index 0 = top
  hand: CardInstance[];
  battlefield: Permanent[];
  graveyard: CardInstance[];
  exile: CardInstance[];
  landsPlayedThisTurn: number;
  /** Cards drawn so far this turn ("whenever you draw your second card each turn"). */
  drawnThisTurn?: number;
  /** Life gained and spells cast so far this turn ("if you gained 3 or more life this turn", "your first spell"). */
  lifeGainedThisTurn?: number;
  spellsCastThisTurn?: number;
  /** Life lost this turn ("if an opponent lost life this turn"), and whether the player attacked (raid). */
  lifeLostThisTurn?: number;
  /** Kaito's emblem. */
  ninjaEmblem?: boolean;
  /** Teach by Example: the next instant or sorcery spell cast this turn is copied. */
  copyNextSpell?: boolean;
  /** Sphinx of Forgotten Lore: instants and sorceries in the graveyard that have flashback until end of turn. */
  grantedFlashback?: string[];
  /** Finale of Revelation: no maximum hand size. */
  noHandLimit?: boolean;
  /** Instants and sorceries cast this turn (Thousand-Year Storm). */
  instSorcCastThisTurn?: number;
  /** How many separate times the player gained life this turn. */
  lifeGainEventsThisTurn?: number;
  attackedThisTurn?: boolean;
  /** Cards in exile that may be played: "During any turn you attacked with ~, you may play that card", or a warped card from turn `fromTurn` on. */
  /** `tax`: a spell cast this way costs that much more; `tappedLand`: a land played this way enters tapped (Lightstall Inquisitor). */
  /** `throughTurn`: playable up to and including the end of that turn ("until the end of your next turn"). `always` + `payGeneric`: airbend, playable while it stays exiled, for that much generic mana instead of its cost. */
  /** `sorcery`: cast only as a sorcery (a plotted card, which is free: `payGeneric` 0). */
  mayPlay?: { iid: string; source: string; fromTurn?: number; untilTurn?: number; throughTurn?: number; always?: boolean; payGeneric?: number; tax?: number; tappedLand?: boolean; sorcery?: boolean; /** Tinybones: only on your turn and while this permanent is on the battlefield; any type of mana pays for it. */ via?: string }[];
  /** Creature cards in the graveyard that may be cast from there until end of turn. */
  yardCastable?: string[];
  /** "If a source you control would deal damage to an opponent this turn, it deals double that damage instead." */
  doubleDamage?: boolean;
  /** Priority stops: the game waits for this player to pass (it does not pass for them) when they are attacked, when the opponent casts a spell, and when blockers have been declared, even with nothing to respond with. */
  stops?: { attack?: boolean; spell?: boolean; block?: boolean };
  /** Permanents the player chose not to tap for mana: payments skip them. Only set around one action, and cleared as a turn begins. */
  spareMana?: string[];
  /** "Artifact spells you cast this turn cost {1} less": the discounts, cleared as the turn ends. */
  costLessThisTurn?: { n: number; spell: string }[];
  /** Cards discarded so far this turn. */
  discardedThisTurn?: number;
  /** "The next red or green creature spell you cast this turn can be cast without paying its mana cost." */
  freeNext?: { colors: string[] };
  /** Tried to draw from an empty library: loses the game when state-based actions are next checked. */
  drewFromEmpty?: boolean;
  /** Poison counters: ten or more and the player loses the game (rule 704.5c). */
  poison?: number;
  /** An opponent dealt damage to this player this turn (bloodthirst). */
  damagedThisTurn?: boolean;
  /** Lands that entered under this player's control this turn ("if you had a land enter the battlefield under your control this turn"). */
  landsEnteredThisTurn?: number;
  /** An emblem: "Instant and sorcery spells you cast have storm." */
  stormEmblem?: boolean;
  /** Emblems that change this player's creatures ("Creatures you control get +2/+2 and have flying."). */
  emblems?: { text: string; static: StaticEffect }[];
  /** "Draw a card at the beginning of the next turn's upkeep": one per card that said so (Mishra's Bauble). */
  upkeepDraws?: { source: string; name: string }[];
  /** Permanents that left the battlefield under this player's control this turn (revolt). */
  leftThisTurn?: number;
  /** Cards outside the game: the sideboard a Lesson can be learned from. */
  sideboard?: CardInstance[];
  /** "Prevent the next 3 damage that would be dealt to target player this turn": what is left of the shield. */
  preventShield?: number;
  /** "Skips all combat phases of their next turn": the number of the turn whose combat phases are skipped. */
  skipCombat?: number;
  /** Mana that was added and not spent yet. */
  pool?: FloatingMana[];
  /** "Whenever a creature dies this turn, you gain 1 life": once for each spell that said so. */
  deathLife?: number;
  /** Paradigm: the exiled cards a copy of which may be cast at the beginning of each of the player's first main phases. */
  paradigms?: string[];
}

export interface GameState {
  /** Definitions of every card used in this game, so the state is self-contained. */
  cards: Record<string, CardDef>;
  /** The excess of the last damage dealt to a creature (damage beyond what it took to destroy it): "you gain life equal to the excess damage dealt this way". */
  lastExcess?: number;
  /** The toughness of the creature that was sacrificed last ("gain life equal to its toughness"). */
  lastSacToughness?: number;
  /** Creature cards put into a graveyard from the battlefield this turn (Abyssal Harvester). */
  yardedThisTurn?: string[];
  /** Cards exiled until the next end step (Charming Prince, Kykar): they come back then. */
  delayedReturns?: { iid: string; controller: PlayerId; named?: Record<string, number> }[];
  players: Record<PlayerId, PlayerState>;
  /** The player who takes the first turn (rule 103.1). */
  startingPlayer: PlayerId;
  /** Mulligan progress; null once the game has started. */
  /** `shuffled`: the shuffle step before keeping or mulliganing: each player shuffles the OTHER player's library (set with the `shuffleStep` option). */
  opening: { taken: Record<PlayerId, number>; kept: Record<PlayerId, boolean>; shuffled?: Record<PlayerId, boolean> } | null;
  active: PlayerId;
  turn: number;
  phase: Phase;
  combat: Combat | null;
  /** Seeded RNG state so shuffles are reproducible (and replayable). */
  rng: number;
  /** The player who won, "draw" when both players lost at the same time, or null while the game goes on. */
  winner: PlayerId | "draw" | null;
  /** Spells and abilities waiting to resolve. The last item is on top and resolves first. */
  stack: StackItem[];
  /** An open round of priority (players may respond to the top of the stack), or null. */
  priority: PriorityRound | null;
  /** A triggered ability whose controller must choose its targets before it goes on the stack. */
  pendingChoice: PendingChoice | null;
  /** Additional combat phases still to come this turn. */
  extraCombats?: number;
  /** A creature died this turn (morbid). */
  creatureDied?: boolean;
  /**
   * Relentless Assault: "After this main phase, there is an additional combat phase followed by an additional main phase." `extraCombatMain`: how many are still to start,
   * `extraStep`: the additional combat has begun, so the next main phase is the additional one, `extraResume`: what the turn goes on with after it.
   */
  extraCombatMain?: number;
  extraStep?: "main";
  extraResume?: "attackers" | "end";
  /** A choice among cards that the game is waiting for (see effects.ts). */
  pendingPick: PendingPick | null;
  /** "Prevent all combat damage that would be dealt this turn." Cleared as the next turn begins. */
  preventCombat?: boolean;
  /** "Damage can't be prevented this turn." Cleared as the next turn begins. */
  noPrevention?: boolean;
  /** "Creatures without flying can't block this turn." */
  noGroundBlock?: boolean;
  /** Triggers that have happened and are about to go on the stack. */
  triggerQueue: { item: Extract<StackItem, { kind: "ability" }>; specs: TargetSpec[]; modes?: ModeSpec[]; /** "Choose one that hasn't been chosen". */ unchosen?: boolean }[];
  /** Counter used to give every stack item a unique id. */
  nextId: number;
}

export const OPPONENT: Record<PlayerId, PlayerId> = { p1: "p2", p2: "p1" };
