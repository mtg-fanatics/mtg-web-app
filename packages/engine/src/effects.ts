import type { CardDef, CardInstance, PlayerId } from "./types.js";
import type { Keyword } from "./keywords.js";
import type { ManaColor } from "./mana.js";

// ───────── what a card can do, as data ─────────
// Card text is turned into these structures by oracle.ts. The engine only ever runs these, never raw text.

/** Who or what an effect applies to. */
export type Ref =
  | { t: "target"; i: number } // the i-th target chosen when the spell/ability was put on the stack
  | { t: "self" } // the permanent the ability belongs to
  | { t: "you" } // the controller
  | { t: "opp" } // the controller's opponent
  | { t: "eachPlayer" }
  | { t: "allCreatures"; scope: "all" | "yours" | "opponents"; except?: number; noFlying?: boolean; flying?: boolean; attacked?: boolean; subtype?: string; notSubtype?: string; notSelf?: boolean; tapped?: boolean; power?: { n: number; op: "min" | "max" }; mv?: { n: number; op: "min" | "max" } } // `except`: not the i-th target; `notSelf`: "all other creatures"; `tapped`: only tapped (true) or untapped (false) ones; `power`/`mv`: "with power 4 or greater", "with mana value 3 or less"
  | { t: "allPlaneswalkers" }
  | { t: "allLands" } // every land ("destroy all lands")
  | { t: "ownerOf"; i: number } // the owner of the i-th target ("its owner gains 4 life")
  | { t: "controllerOf"; i: number } // the controller of the i-th target, as it was when the spell resolved
  | { t: "enchanted" } // the permanent this Aura is attached to
  | { t: "attackingCreatures"; other?: boolean } // every creature attacking right now (`other`: not the permanent itself)
  | { t: "other" } // "that creature": the creature that blocked this one, or that this one blocked
  | { t: "creaturesOf"; i: number }; // every creature controlled by the i-th target (a player)

/** A number printed on the card, or "X": the value chosen when the spell was cast. */
export type Amount = number | "X" | { count: CountSpec; times?: number };

/** What an edict makes a player sacrifice. */
export type EdictType = "creature" | "planeswalker" | "artifact" | "enchantment";

export type Effect =
  | { type: "damage"; amount: Amount; to: Ref }
  | { type: "draw"; amount: Amount; who: Ref }
  | { type: "gainLife"; amount: Amount; who: Ref }
  | { type: "loseLife"; amount: Amount; who: Ref }
  | { type: "destroy"; what: Ref }
  | { type: "destroyArtifacts"; mvAtMost: Amount } // "destroy each artifact with mana value X or less"
  | { type: "exile"; what: Ref }
  | { type: "bounce"; what: Ref }
  | { type: "tap"; what: Ref }
  | { type: "untap"; what: Ref }
  | { type: "pump"; power: number; toughness: number; what: Ref; per?: CountSpec } // until end of turn (`per`: for each of something)
  | { type: "grant"; keyword: Keyword; what: Ref } // until end of turn
  | { type: "counter"; what: Ref; exileCopies?: boolean } // `exileCopies` (Counterbore): then every card with the same name in its controller's graveyard, hand and library is exiled
  | { type: "topOfLibrary"; what: Ref } // "put target creature on top of its owner's library"
  | { type: "reanimate"; what: Ref; to: "battlefield" | "hand"; tapped?: boolean; finality?: boolean; attacking?: boolean } // a card from a graveyard (`finality`: "with a finality counter on it")
  // The next three ask a player to choose cards, so a card that has one can't have any other effect (see PendingPick).
  | { type: "discard"; who: Ref; amount: number; chooser: "victim" | "you" | "random"; nonland?: boolean } // "target player discards two cards" / "you choose a card from their hand"
  | { type: "lookPick"; mode: "toHand" | "toGraveyard" | "arrange" | "iterate" | "look" | "toHandTop"; n: number; who?: Ref } // look at the top cards of a library ("iterate": one to hand, one exiled to play this turn, one to the bottom; "toHandTop": one to hand, one on top, one on the bottom)
  // "Look at the top five cards. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom."
  | { type: "revealToHand"; n: number; filter: CardFilter; random: boolean; required?: boolean; restTo?: "bottom" | "graveyard"; reveal?: boolean; take?: number } // `take`: "put two of them into your hand"
  // Search your library for a card (a basic land card, or any card): onto the battlefield (tapped) or into your hand, then shuffle.
  | { type: "search"; tapped?: boolean; for?: "basicLand" | "any"; to?: "hand" | "battlefield"; who?: Ref; reveal?: boolean; filters?: CardFilter[]; label?: string } // `filters`: a card that fits any of them, `label` names it
  | { type: "scry"; n: number } // look at the top n cards; any of them may go to the bottom (see PendingPick)
  | { type: "mill"; amount: Amount; who: Ref } // the top cards of the library go to the graveyard
  | { type: "regenerate"; what: Ref } // a regeneration shield until end of turn
  | { type: "revealPut"; n: number; filter: CardFilter; maxMV: number } // reveal the top cards: put every match onto the battlefield, the rest on the bottom in a random order
  | { type: "grantIfPowerBelow"; keyword: Keyword } // "Creatures you control with power less than ~'s power gain indestructible"
  | { type: "doubleDamage" } // damage your sources deal to an opponent is doubled this turn
  | { type: "exileTop"; playIfAttacked?: boolean; untilEndStep?: boolean; throughNextTurn?: boolean; n?: number } // exile the top card of your library; "during any turn you attacked with ~, you may play that card" / "you may play that card until your next end step"
  | { type: "blink"; what: Ref }
  | { type: "sacOnDamage"; what: Ref } // until end of turn: "When this creature deals combat damage, sacrifice it"
  | { type: "tapForBonus" } // "you may tap any number of untapped creatures you control. This gets +1/+1 for each"
  | { type: "assignByToughness"; what: Ref } // assigns combat damage equal to its toughness this turn
  | { type: "ifSubtypeGrant"; what: Ref; subtype: string; keyword: Keyword } // "If that creature is a Cat, it gains first strike"
  | { type: "libraryChoice"; what: Ref } // the owner puts it on the top or the bottom of their library // exile it, then return it to the battlefield
  | { type: "scryIfMV"; what: Ref; max: number; n: number } // "if its mana value was 3 or less, scry 1"
  | { type: "noGroundBlock" } // creatures without flying can't block this turn
  | { type: "setBase"; what: Ref; power: number; toughness: number } // becomes N/N until end of turn
  | { type: "loseDefender"; what: Ref }
  | { type: "winGame" }
  | { type: "cascade"; mv: number } // "Cascade": exile cards from the top until a nonland card with a lesser mana value; it may be cast for free this turn, the rest go to the bottom in a random order
  | { type: "renown"; n: number } // "Renown 2": if it isn't renowned, +1/+1 counters, and it becomes renowned
  | { type: "amass"; n: number; subtype?: string } // "Amass 2" / "Amass Orcs 2": +1/+1 counters on an Army you control (a 0/0 Army token first, if there is none)
  | { type: "unlessPay"; cost: string; otherwise: Effect[]; echo?: boolean; cumulative?: boolean } // "sacrifice ~ unless you pay {1}": the controller pays or `otherwise` happens (echo: only the first upkeep; cumulative: the cost once for each age counter)
  | { type: "mayPay"; prompt?: string; cost: string; life?: number; then: Effect[]; thenSpecs?: TargetSpec[]; thenText?: string } // "When you do, ... target ...": the targets are chosen after paying // "you may pay {1}. If you do, ..." (`life`: "pay 2 life")
  | { type: "mayDiscard"; then: Effect[]; thenSpecs?: TargetSpec[] } // "you may discard a card. When you do, ..."
  | { type: "drawUnlessPay"; cost: string } // "you may draw a card unless that player pays {1}" (the opponent who cast the spell)
  | { type: "tapOrUntap"; what: Ref } // you may tap or untap target permanent
  | { type: "bounceOwn"; other: boolean; color?: string } // "return a creature you control to its owner's hand": the player chooses (`color`: "a green creature")
  | { type: "sacrifice"; what: Ref } // sacrifice a permanent ("when this becomes the target of a spell or ability, sacrifice it")
  | { type: "stun"; what: Ref; theirsOnly?: boolean; amount?: number } // stun counters, one unless `amount` says (`theirsOnly`: only on the ones the controller doesn't control)
  | { type: "shuffleIntoLibrary"; what: Ref } // Floodpits Drowner: "shuffle ~ and target creature ... into their owners' libraries"
  | { type: "unblockable"; what: Ref } // can't be blocked this turn
  | { type: "exileUntilLeaves"; what: Ref } // exile target permanent until this one leaves the battlefield
  | { type: "fog" } // prevent all combat damage this turn
  | { type: "rummage"; toBottom?: boolean; draw?: number } // `draw`: "if you do, draw two cards" // you may discard a card; if you do, draw a card (waits for the player)
  | { type: "returnFromYard" } // "when this dies, return it to its owner's hand"
  | { type: "counterUnlessPay"; what: Ref; cost: string } // counter target spell unless its controller pays
  | { type: "noRegen" } // "it can't be regenerated": the destroy/damage of the same spell can't be saved by a shield
  | { type: "addCounters"; amount: Amount; what: Ref; kind?: "minus" } // +1/+1 counters (or -1/-1 with kind "minus")
  | { type: "fight"; a: Ref; b: Ref } // each deals damage equal to its power to the other
  | { type: "bite"; from: Ref; to: Ref; times?: number; trampleExcess?: boolean } // "target creature you control deals damage equal to its power to target creature" (`trampleExcess`: with trample, the excess goes to that creature's controller instead)
  | { type: "gainControl"; what: Ref; whileSource?: boolean } // until end of turn (`whileSource`: "for as long as you control ~")
  | { type: "addSubtype"; what: Ref; subtype: string } // "That creature becomes a Vampire in addition to its other types." (for good)
  | { type: "cantBlockThisTurn"; what: Ref }
  | { type: "crewed" } // this Vehicle becomes an artifact creature until end of turn
  | { type: "combatDamageDraw"; what: Ref } // "whenever that creature deals combat damage to a player this turn, you draw a card"
  | { type: "wardCheck"; cost: string; itemId: string; life?: number } // ward: counter the spell or ability unless its controller pays (mana, or `life`)
  | { type: "ifKicked"; then: Effect[]; otherwise?: Effect[] } // "if this spell was kicked, ..." (and "... instead")
  | { type: "surveil"; n: number } // like scry, but the cards you don't keep go to the graveyard
  | { type: "attach"; what: Ref } // equip: attach this permanent to the target
  | { type: "returnAsEnchantment" } // "return it to the battlefield under its owner's control. It's an enchantment." (from the graveyard)
  | { type: "becomeCopy"; what: Ref } // "~ becomes a copy of another target creature you control"
  | { type: "exileIfDies"; what: Ref } // "if that creature would die this turn, exile it instead"
  | { type: "ifControlOther"; subtype: string; then: Effect[] } // "if you control another Hero, you gain 2 life"
  | { type: "connive"; what: Ref } // draw a card, then discard a card; a nonland card discarded gives the creature a +1/+1 counter
  | { type: "ifSubtype"; what: Ref; subtype: string; then: Effect[] } // "if it's a Zombie card, draw a card" (wherever the card is now)
  | { type: "mustBeBlocked"; what: Ref } // "must be blocked this turn if able"
  | { type: "becomeSubtype"; what: Ref; subtype: string } // "~ becomes a Werewolf": the new creature type replaces the others
  | { type: "returnSelfToBattlefield"; tapped?: boolean; counters?: number; minusCounters?: number; finality?: boolean } // the card itself, from its owner's graveyard
  | { type: "grantDiesReturn"; what: Ref } // until end of turn: "when this dies, return it to the battlefield tapped with a +1/+1 counter"
  | { type: "distributeCounters"; total: number; double?: boolean } // among the chosen targets, the first ones getting any extra; then double them
  | { type: "createToken"; token: TokenSpec; amount: Amount; who?: Ref }
  | { type: "ifLifeGained"; atLeast: number; then: Effect[] } // "if you gained life this turn, ..." / "draw a card if you've gained 3 or more life this turn"
  | { type: "ifSelfPower"; n: number; then: Effect[] } // "then destroy all other creatures if its power is exactly 20"
  | { type: "explore"; what?: Ref } // the permanent (or `what`) explores (rule 701.44)
  | { type: "exileFromHand"; who: Ref } // look at target opponent's hand; you may exile a nonland card from it until this leaves the battlefield
  | { type: "exileToPlay"; who: Ref; tax: number; tappedLand: boolean } // each of them exiles a card from their hand and may play it while it stays exiled (spells cost `tax` more)
  | { type: "putSavedCounters"; what: Ref } // "put its counters on target creature you control": the counters it had as it died
  | { type: "offspringCopy" } // offspring: create a 1/1 token copy of this creature
  | { type: "yardCastable" } // creature cards in your graveyard gain "You may cast this card from your graveyard" until end of turn
  | { type: "solve" } // a Case becomes solved
  | { type: "airbend"; what: Ref } // exile it; its owner may cast it for {2} (rather than its mana cost) for as long as it stays exiled
  | { type: "becomeCreatureNow"; what: Ref; subtypes?: string[]; color?: string; nonartifact?: boolean } // until end of turn it is an artifact creature (of these creature types, of this color; `nonartifact`: just a creature)
  | { type: "loseSubtype"; what: Ref; subtype: string } // "... and isn't a Human" until end of turn
  | { type: "untargetable"; what: Ref } // "can't be the target of spells or abilities your opponents control this turn"
  | { type: "ifNow"; cond: "yourMainPhase" | "landEntered" | "ferocious" | "delirium" | "threshold" | "hellbent" | "metalcraft" | "morbid" | "instantAndSorcery" | "lessLife" | "fewerCreatures"; then: Effect[]; otherwise?: Effect[] } // "if you cast ~ during your main phase, ... instead", landfall "... instead", ferocious "... if you control a creature with power 4 or greater", delirium "if there are four or more card types among cards in your graveyard, ...", "if there is an instant card and a sorcery card in your graveyard, instead ...", "if you have less life than an opponent", "if you control fewer creatures than an opponent"
  | { type: "ifControlledTarget"; i: number; then: Effect[] } // "if you controlled that permanent, draw a card"
  | { type: "attachToCreated" } // "you may attach ~ to it": this Equipment goes on the token the same ability just created
  | { type: "exileGraveyard"; who: Ref } // "exile target player's graveyard"
  | { type: "upkeepDraw" } // "draw a card at the beginning of the next turn's upkeep"
  | { type: "poison"; who: Ref; amount: Amount } // "each opponent gets a poison counter"
  | { type: "removeMinusCounter"; what: Ref; gain?: number } // Woeleecher: "remove a -1/-1 counter from target creature. If you do, you gain 2 life"
  | { type: "conjureCard"; card: "leeches" } // Leech Medic: "create a Leeches token card and put it into your hand"
  | { type: "becomePrepared"; what: Ref } // Leech Collector: "~ becomes prepared"
  | { type: "removeAllCounters"; what: Ref } // Blitz Leech: "remove all counters from that creature"
  | { type: "poisonBurn"; who: Ref } // Leeches: "target player loses all poison counters. ~ deals that much damage to that player"
  | { type: "powerFromHand" } // until end of turn: this creature's base power is the number of cards in your hand
  | { type: "mayCost"; cost: "artifactOrCard" | "artifactOrNonland" | "otherCreature" | "otherCreatureOrArtifact" | "threeOtherNonland" | "vampire"; then: Effect[]; thenSpecs?: TargetSpec[] } // "you may sacrifice an artifact or discard a card. If you do, ..."
  | { type: "ifYardCreatures"; n: number; then: Effect[]; otherwise?: Effect[] } // "...if there are two or more creature cards in your graveyard. Otherwise, mill two cards."
  | { type: "invasion" } // Alien Invasion: a 1/1 Alien with a +1/+1 counter for each invasion counter, then an invasion counter
  | { type: "discardUnless"; cardType: "artifact" | "creature" } // "discard two cards unless you discard an artifact card"
  | { type: "discardHand" } // "discard your hand"
  | { type: "transform" } // a double-faced permanent turns over
  | { type: "extraCombatIfAttacking" } // "if he's attacking, untap him and there is an additional combat phase after this phase"
  | { type: "putFromHand"; subtype: string; maxMV: number; elseDraw: boolean; cardType?: "artifact" | "land"; attach?: boolean; tapped?: boolean } // "you may put a Hero creature card with mana value 3 or less from your hand onto the battlefield. If you don't, draw a card"
  | { type: "doublePT"; what: Ref } // until end of turn: double its power and toughness
  | { type: "costLess"; n: number; spell: "artifact" } // this turn, spells of that kind you cast cost {n} less
  | { type: "freeNext"; colors: string[] } // the next creature spell of one of these colors you cast this turn costs nothing
  | { type: "addKeywordCounter"; keyword: Keyword; what: Ref } // "put a double strike counter on ~": it has that keyword for as long as the counter is there
  | { type: "planCounter" } // "put a plan counter on this enchantment": at the card's threshold it is sacrificed (see ParsedCard.plan)
  | { type: "warpExile" } // warp: exile the permanent; its owner may cast it from exile on a later turn
  | { type: "ifManaSpent"; n: number; then: Effect[] } // "if five or more mana was spent to cast that spell, ..." (a cast trigger's X is the mana spent)
  | { type: "copySelfToken" } // "create a token that's a copy of ~"
  | { type: "noPrevention" } // "damage can't be prevented this turn"
  | { type: "addLoyalty"; amount: number } // "put a loyalty counter on ~"
  | { type: "stormEmblem" } // "you get an emblem with 'Instant and sorcery spells you cast have storm.'"
  | { type: "emblem"; static: StaticEffect; text: string } // "you get an emblem with 'Creatures you control get +2/+2 and have flying.'"
  | { type: "damagePerNonbasic" } // "~ deals damage to each player equal to the number of nonbasic lands that player controls"
  | { type: "exileYardCard"; what: Ref } // "exile target card from a graveyard": remembered as exiled with the source
  | { type: "putExiledWith" } // "put each creature card exiled with ~ onto the battlefield under your control with a flying counter on it. Each of them is a 1/1 Spirit in addition to its other types."
  | { type: "destroyIfMV"; what: Ref; max: number; revoltMax?: number } // "destroy target creature if it has mana value 2 or less" (revolt: 4 or less if a permanent left the battlefield under your control this turn)
  | { type: "ifSacrificedToughness"; atLeast: number; then: Effect[]; otherwise: Effect[] } // "if the sacrificed creature's toughness was 4 or greater, ... instead"
  | { type: "levelUp"; level: number } // a Class gains its next level
  | { type: "fromYard"; filter: CardFilter; to: "hand" | "battlefield"; finality?: boolean } // "return a creature card from your graveyard to your hand": chosen as it resolves, not targeted
  | { type: "discardUpToDraw"; n: number } // "you may discard up to two cards. If you do, draw that many cards."
  | { type: "exileReturnTransformed" } // "exile this Saga, then return it to the battlefield transformed under your control"
  | { type: "copyTokenOf"; what: Ref; haste?: boolean; sacAtEnd?: boolean } // "create a token that's a copy of target creature, except it has haste. Sacrifice it at the beginning of the next end step."
  | { type: "learn" } // reveal a Lesson card from outside the game and put it into your hand, or discard a card to draw a card
  | { type: "addMana"; mana: ManaColor[]; anyColor?: number; combat?: boolean } // "add {R}{R}{R}{R}" / "add one mana of any color" (`anyColor`); `combat`: it lasts until end of combat
  | { type: "deathLifeThisTurn" } // "whenever a creature dies this turn, you gain 1 life"
  | { type: "proliferate" } // another counter of each kind on the players and permanents that already have one (the ones that help you)
  | { type: "edict"; who: Ref; types: EdictType[] } // "each opponent sacrifices a creature or planeswalker of their choice"
  | { type: "castCopy"; defId: string } // paradigm: a copy of the exiled spell is cast, with the targets chosen for it
  | { type: "prevent"; amount: number; to: Ref } // "prevent the next 3 damage that would be dealt to any target this turn": a shield on a creature or a player until end of turn
  | { type: "shuffleSelfFromYard" } // "you may shuffle it into its owner's library" (when it dies): the card goes from the graveyard into its owner's library
  | { type: "sacrificeLands"; who: Ref; n: number } // "each player sacrifices four lands of their choice" (one of these for each player): all of them when they have no more than that
  | { type: "extraCombatMain" } // "after this main phase, there is an additional combat phase followed by an additional main phase"
  | { type: "shuffleSpell" } // "shuffle ~ into its owner's library": the spell goes into the library instead of the graveyard (Beacon of Destruction)
  | { type: "skipCombat"; who: Ref }; // "target player skips all combat phases of their next turn"

/** Which cards a "reveal a ... card" effect may take: any of the types, or any of the creature types (subtypes), or any nonland card. */
export interface CardFilter {
  types?: string[];
  subtypes?: string[];
  colors?: string[];
  nonland?: boolean;
  /** Any card at all ("put one of them into your hand"). */
  all?: boolean;
  /** Also required, on top of the terms above: "a basic Plains card", "a creature card with mana value 1 or less". */
  basic?: boolean;
  maxMV?: number;
}

/** A token the game makes up while playing: a Treasure, or "a 1/1 white Soldier creature token". */
export interface TokenSpec {
  name: string;
  type: "creature" | "artifact";
  power?: number;
  toughness?: number;
  colors: string[];
  /** Printed after the dash, e.g. "Soldier". */
  subtypes: string;
  keywords: Keyword[];
  text: string;
  /** An artifact creature token (a Thopter). */
  artifact?: boolean;
  /** "Create a tapped 2/1 ... token": it enters tapped. */
  tapped?: boolean;
  /** "...that's tapped and attacking": it joins the combat. */
  tappedAttacking?: boolean;
  /** "...with changeling": every creature type. */
  changeling?: boolean;
  /** "They gain haste until end of turn." */
  hasteThisTurn?: boolean;
}

/** Everything an effect needs to know about where it came from. Kept with a pending choice so the rest of the effects can run later. */
export interface RunContext {
  controller: PlayerId;
  /** The card or permanent the effect comes from. */
  sourceId: string;
  sourceName: string;
  targets: TargetChoice[];
  specs: TargetSpec[];
  /** The spell's own stack id, so a spell can't target itself. */
  stackId?: string;
  /** The X chosen when the spell was cast. */
  x?: number;
  /** The spell was cast with its kicker paid. */
  kicked?: boolean;
  /** Who controlled each targeted permanent when the effects started (so "its controller" still works after it is destroyed). */
  lki?: Record<string, PlayerId>;
  /** The card definition the effects come from (for protection: its colors and whether it is an artifact). */
  sourceDefId?: string;
  /** "That creature": the creature a blocker blocked, or that blocked it. */
  other?: string;
  /** A "when this dies" ability: the creature as it last was on the battlefield (its power and counters). */
  died?: LastKnown;
  /** The tokens these effects created so far, for "you may attach ~ to it". */
  created?: string[];
  /** The toughness of the creature sacrificed to pay for the ability ("if the sacrificed creature's toughness was 4 or greater"). */
  sacToughness?: number;
  /** The creatures these effects destroyed so far, by who controlled them ("for each creature destroyed this way"). */
  destroyed?: Partial<Record<PlayerId, number>>;
}

/** A permanent as it last existed on the battlefield. */
export interface LastKnown {
  power: number;
  counters: number;
  minusCounters: number;
}

/** The qualities of a source that protection looks at. */
export interface SourceQuality {
  colors: string[];
  artifact: boolean;
}

/** What a target may be. Chosen when the spell is cast or the ability is put on the stack. */
export interface TargetSpec {
  /**
   * "any" = a creature or a player. "land" and "artifactOrLand" are permanents. "graveyardCreature" is a creature
   * card in a graveyard (see `controller` for whose); "graveyardCard" is a card of any type (see `subtypes`).
   */
  kind: "creature" | "player" | "any" | "spell" | "permanent" | "graveyardSpell" | "land" | "artifact" | "artifactOrLand" | "enchantment" | "artifactOrEnchantment" | "graveyardCreature" | "graveyardPermanent" | "graveyardCard" | "planeswalker" | "creatureOrPlaneswalker" | "playerOrPlaneswalker";
  /** "with power 4 or greater" / "with power 2 or less". */
  power?: { n: number; op: "min" | "max" | "eq" };
  /** "nonartifact": not an artifact. */
  notArtifact?: boolean;
  /** "with flying" / "without flying". */
  keyword?: { name: Keyword; has: boolean };
  /** "target creature with a stun counter on it". */
  stunned?: boolean;
  /** For creatures: only ones in this state ("target tapped creature", "target attacking or blocking creature"). */
  filter?: "tapped" | "attacking" | "blocking" | "attackingOrBlocking" | "attackingAlone" | "notAttacking";
  /** For creatures: only ones this player controls (relative to the controller of the spell). */
  controller?: "you" | "opponent";
  /** "nonblack" etc.: colors the creature must not have. */
  notColors?: string[];
  /** "target black or red permanent": it has at least one of these colors. */
  colorsAny?: string[];
  /** For players: only the controller's opponent. */
  opponentOnly?: boolean;
  /** For "permanent" targets: "target nonland permanent". */
  nonland?: boolean;
  /** "target creature or enchantment": a permanent of any of these types ("creature", "enchantment", "artifact", "land", "planeswalker"). */
  types?: string[];
  /** "non-Angel creature". */
  notSubtype?: string;
  /** "target Goblin you control": a creature of this type. */
  subtype?: string;
  /** "target Bat, Lizard, Rat, or Squirrel card": a card with any of these types. */
  subtypes?: string[];
  /** "with mana value less than or equal to this creature's power": its power as it died, filled in as `mv` when the ability triggers. */
  mvAtMostPower?: boolean;
  /** "target spell or permanent": a spell on the stack is also allowed. */
  orSpell?: boolean;
  /** "X target creatures": every target marked this way must be a different permanent. */
  distinct?: boolean;
  /** "Up to one target ...": the player may choose no target at all (a "none" choice). */
  optional?: boolean;
  /** "another target ...": not the permanent the ability belongs to (filled in as `except` when the ability is put on the stack). */
  other?: boolean;
  except?: string;
  /** "Another target nonlegendary creature you control". */
  nonlegendary?: boolean;
  /** "Target creature that crewed it this turn": one that crewed the Vehicle the ability belongs to (filled in as `crewOf`). */
  crewedIt?: boolean;
  crewOf?: string;
  /** "...other than that creature": not the creature the trigger is about (also filled in as `except`). */
  notOther?: boolean;
  /** "with mana value 2 or greater" / "with mana value 2" (`eq`). */
  mv?: { n: number; op: "min" | "max" | "eq" };
  /** "Target artifact, enchantment, or creature with flying": a creature only counts with this keyword. */
  creatureWith?: Keyword;
  /** "Exile up to one target Equipment attached to that creature": it must be attached to the permanent chosen for this target. */
  attachedToTarget?: number;
  toughness?: { n: number; op: "min" | "max" | "eq" };
  /** Cut Down: "with total power and toughness 5 or less". */
  totalPTMax?: number;
  /** "target noncreature artifact": an artifact that is not also a creature. */
  noncreature?: boolean;
  /** The mana value or power limit above is waived when the spell was kicked ("...mana value 3 or less. If this spell was cast using teamwork, instead exile target creature"). */
  liftedWhenKicked?: boolean;
  /** For spells: "target creature spell" / "target noncreature spell". */
  spellKind?: "creature" | "noncreature" | "artifactOrCreature" | "creatureOrEnchantment" | "artifactOrEnchantment";
  /** For spells: "target colorless spell" / only spells of this color (W, U, B, R or G). */
  colorless?: boolean;
  spellColor?: string;
  /** "Target red or green spell": a spell of any of these colors. */
  spellColors?: string[];
  /** "...you own": a permanent its controller also owns. */
  owner?: "you";
  /** "Target triggered ability or colorless spell": a triggered ability on the stack counts too. */
  orTriggered?: boolean;
  /** The printed phrase, shown to players, e.g. "target creature an opponent controls". */
  label: string;
  /** What the spell or ability that targets is (its colors, artifact or not): protection can stop it from targeting. */
  source?: SourceQuality;
}

/**
 * A continuous effect printed on a permanent: "Enchanted creature gets +2/+2 and has flying", "Creatures you control
 * get +1/+1". It is not stored anywhere: it is worked out from the battlefield whenever it matters.
 */
export interface StaticEffect {
  scope: "enchanted" | "yours" | "opponents" | "all" | "self";
  /** A Class's ability: it only works once the Class has reached this level. */
  level?: number;
  /** "Attacking creatures you control get +1/+0". */
  attackingOnly?: boolean;
  /** "Other Goblin creatures you control attack each combat if able." */
  mustAttack?: boolean;
  /** "As long as you've drawn two or more cards this turn" / "as long as this Aura entered this turn". */
  cond?: { artifactCreatureOrPlan?: boolean; powerAtMost?: number; selfCounteredThisTurn?: boolean; yardCreatures?: number; drawnAtLeast?: number; lifeAtLeast?: number; yourTurn?: boolean; enteredThisTurn?: boolean; controls?: string; attacking?: boolean; lostLife?: boolean; /** Four or more card types among the cards in its controller's graveyard. */ delirium?: boolean; /** Threshold: this many cards in its controller's graveyard. */ yardAtLeast?: number; /** Hellbent: its controller has no cards in hand. */ handEmpty?: boolean; /** Metalcraft: its controller controls this many artifacts. */ artifactsAtLeast?: number };
  /** "Tapped creatures you control have hexproof." */
  tappedOnly?: boolean;
  /** "Other untapped creatures you control have hexproof." */
  untappedOnly?: boolean;
  /** "Gets +1/+1 for each enchantment you control": the power and toughness are multiplied by this count. */
  per?: CountSpec;
  /** "Each creature you control that you've put one or more +1/+1 counters on this turn has hexproof": the creature it applies to. */
  targetCounteredThisTurn?: boolean;
  /** "Attacking creature tokens you control have first strike": only tokens. */
  tokensOnly?: boolean;
  /** "Creatures you control with +1/+1 counters on them have trample": only creatures with a +1/+1 counter. */
  withCounters?: boolean;
  /** "Other creatures you control with infect get +1/+1": only creatures with this keyword. */
  withKeyword?: Keyword;
  /** "...and is all creature types." */
  allTypes?: boolean;
  /** "...and is an Angel in addition to its other types." */
  addSubtypes?: string[];
  /** "...has lifelink and ward {2}." */
  ward?: string;
  /** "Can't be blocked" while it applies. */
  unblockable?: boolean;
  /** "...and have mountainwalk": the land types it gives walking over (it can't be blocked while the defending player controls one). */
  landwalk?: string[];
  /** "Other creatures you control": not the permanent itself. */
  other?: boolean;
  /** "Other Minotaur creatures you control get +1/+1": only creatures with one of these types. */
  subtypes?: string[];
  power: number;
  toughness: number;
  keywords: Keyword[];
  cantAttack?: boolean;
  cantBlock?: boolean;
  noUntap?: boolean;
  /** "Its activated abilities can't be activated unless they're mana abilities." */
  noActivated?: boolean;
}

/**
 * What a "*" power and toughness is counted from: "equal to the number of creatures you control", "...cards in your hand".
 * It is recomputed every time it matters, so it always follows the board.
 */
export type CountSpec =
  | { kind: "permanents"; what: "creature" | "land" | "artifact" | "enchantment" | "landType" | "subtype"; landType?: string; subtype?: string; nontoken?: boolean; other?: boolean; scope: "you" | "opponents" | "all" }
  | { kind: "hand" }
  | { kind: "graveyard"; creaturesOnly: boolean; spellsOnly?: boolean; adventures?: boolean } // `adventures`: "and/or have an Adventure" counts too
  | { kind: "attackers"; subtype?: string; other?: boolean } // creatures you control that are attacking
  | { kind: "yardsAll"; cardType: string } // the cards of that type in all graveyards ("the number of sorcery cards in all graveyards")
  | { kind: "attackingYou" } // the creatures attacking you (not a planeswalker of yours)
  | { kind: "toughnessGtPower" } // creatures you control with toughness greater than power
  | { kind: "opponents" } // the number of opponents you have
  | { kind: "selfPower" } // the power of the permanent the ability belongs to
  | { kind: "selfCounters" } // counters on it
  | { kind: "excessDamage" } // the excess of the damage the same spell or ability just dealt
  | { kind: "greatestMV"; what: "artifact" | "subtype"; subtype?: string } // the greatest mana value among the artifacts (or Elementals) you control
  | { kind: "greatestMVYard" } // the greatest mana value among the cards in your graveyard
  | { kind: "cavesAndYard" } // the Caves you control and the Cave cards in your graveyard
  | { kind: "discardedThisTurn" } // cards you've discarded this turn
  | { kind: "selfToughness" } // the toughness of the permanent the ability belongs to
  | { kind: "equipmentOnSelf" } // the Equipment attached to the permanent the ability belongs to
  | { kind: "ifTargetSubtype"; i: number; subtype: string; notSelf?: boolean; yes: number; no: number } // "if that creature is another Hero, two instead"
  | { kind: "handDeficit"; to: number } // ten minus the cards in your hand
  | { kind: "x" } // the X of the spell or ability: for "whenever you discard one or more cards", the number discarded
  | { kind: "targetPower"; i: number } // the power of the i-th target
  | { kind: "otherToughness" } // the toughness of "that creature" (the one that entered)
  | { kind: "otherPower" }
  | { kind: "ifOtherSubtype"; subtype: string; yes: number; no: number } // "put a counter on it. If it's a Unicorn, two instead"
  | { kind: "totalPower" } // the total power of creatures you control
  | { kind: "greatestPower" } // the greatest power among creatures you control
  | { kind: "devotion"; color: string } // your devotion to a color: its mana symbols among the mana costs of permanents you control
  | { kind: "destroyedThisWay"; yours?: boolean }; // the creatures the same spell just destroyed (`yours`: only the ones you controlled)

/** One choice of a "Choose one —" spell or ability: its effects, and what it targets. */
export interface ModeSpec {
  effects: Effect[];
  targets: TargetSpec[];
  /** The printed text of the mode, shown on its button. */
  text: string;
}

export interface SpellAbility {
  effects: Effect[];
  targets: TargetSpec[];
  /** "Choose one —" (min 1, max 1) or "Choose one or both —" (min 1, max 2). The effects and targets above are then empty. */
  modal?: { min: number; max: number; modes: ModeSpec[]; /** "Choose one. If this spell was cast using teamwork, choose both instead." */ bothIfKicked?: boolean };
}

export interface TriggeredAbility {
  /** "When this enters, choose one —": the mode is chosen when the ability triggers. */
  modes?: ModeSpec[];
  /** "When this enters, if it was kicked, ...": only triggers when it was cast kicked. */
  ifKicked?: boolean;
  event: "oppPermTapped" | "youTapOpp" | "oppArtifactAbility" | "enters" | "dies" | "attacks" | "noncreatureSpell" | "instantOrSorcery" | "landfall" | "lifeGained" | "allyEnters" | "combatDamagePlayer" | "blocks" | "blocked" | "damagedDies" | "drawCard" | "drawSecond" | "battalion" | "attackTwo" | "becomesTarget"
    | "youSacrifice" | "anySacrifice"
    | "upkeep" | "upkeepEach" | "endStep" | "endStepEach" | "beginCombat" | "allyLeaves" | "anyCreatureEnters" | "youCast" | "opponentCasts" | "anyCasts" | "oppCreatureDies" | "youAttack" | "hostDamagesPlayer" | "drawFifth" | "enchantedDies"
    | "allyDies" | "allyCountersAdded" | "allyAttacks" | "allyTargeted" | "youDiscard" | "excessDamage" | "damaged" | "anyDies" | "teamworkTap" | "attacksAlone" | "selfTapped" | "hostTapped" | "allyTapped" | "tokenEnters" | "yourAbilityTargets" | "anyDrawSecond" | "allyDamaged" | "hostUpkeep" | "discardedByOpp" | "damageOpp";
  /** An "intervening if": the trigger only happens when this is true as the event occurs. */
  cond?: {
    lifeGainedAtLeast?: number;
    lifeAtLeast?: number;
    controlsTypes?: string[];
    enchantedUntapped?: boolean;
    attackPowerAtLeast?: number;
    wasCreature?: boolean;
    /** "If an opponent lost life this turn" / "if you attacked this turn" (raid). */
    opponentLostLife?: boolean;
    /** Knight of the Ebon Legion: "if a player lost 4 or more life this turn". */
    anyLostLifeAtLeast?: number;
    attackedThisTurn?: boolean;
    /** "If you control another Elf". */
    controlsOther?: string;
    /** "If you control three or more creatures". */
    creaturesAtLeast?: number;
    /** "Whenever ~ attacks, draw a card if her power is 4 or greater" / "if he's equipped". */
    selfPowerAtLeast?: number;
    selfEquipped?: boolean;
    /** "If you have fewer than ten cards in hand". */
    handBelow?: number;
    /** Threshold (seven or more cards in your graveyard), hellbent (no cards in hand), metalcraft (three or more artifacts) and morbid (a creature died this turn). */
    yardAtLeast?: number;
    handEmpty?: boolean;
    artifactsAtLeast?: number;
    creatureDied?: boolean;
    /** "If it has greater power or toughness than ~": the creature that entered. */
    enteringGreater?: boolean;
    /** A Case's "if unsolved, solve at the beginning of your end step". */
    unsolved?: boolean;
    /** "If a Pirate and a Vehicle attacked this combat": each of these types is among the attackers. */
    attackersInclude?: string[];
    /** "When this creature enters, if you cast it": it came from a spell. */
    cast?: boolean;
  };
  /** "Whenever you cast a noncreature or Dragon spell": a creature spell of this type counts too. */
  orSpellSubtype?: string;
  /** For "allyCountersAdded": "another non-Hydra creature you control". */
  notSubtype?: string;
  /** For "allyCountersAdded": "whenever you put one or more +1/+1 counters on this creature". */
  selfOnly?: boolean;
  /** For "allyEnters": "whenever an enchantment you control enters" (eerie). */
  enchantments?: boolean;
  /** For "allyEnters": "whenever ~ or another creature or artifact you control enters": artifacts count too. */
  artifacts?: boolean;
  /** "Choose one that hasn't been chosen —": each mode can be chosen once for this permanent. */
  unchosenOnly?: boolean;
  /** "Tap X target creatures": the one target is repeated X times, where X is what was paid for the permanent. */
  xTargets?: boolean;
  /** "Whenever another nontoken creature you control enters". */
  nontoken?: boolean;
  /** "Whenever another Angel or Cleric you control enters": only creatures of these types. */
  subtypes?: string[];
  /** "...becomes the target of a spell or ability an opponent controls". */
  byOpponent?: boolean;
  /** "...becomes the target of a spell" (not an ability). */
  bySpell?: boolean;
  /** "Whenever another Villain and/or artifact you control enters": an artifact counts as well as the types in `subtypes`. */
  orArtifact?: boolean;
  /** "Whenever you cast a spell that targets a creature you control" / "...one or more creatures". */
  spellTargets?: "ownCreature" | "creatures" | "self";
  /** "...if it's the first time that creature has become tapped this turn". */
  firstTapOnly?: boolean;
  /** "Whenever one or more creatures you control become tapped": once for all that were tapped together. */
  batch?: boolean;
  /** Only on the controller's own turn ("during your turn"). */
  yourTurnOnly?: boolean;
  /** "Whenever equipped creature attacks": only the creature this Equipment is attached to counts. */
  hostOnly?: boolean;
  /** "Whenever an equipped creature you control attacks": the creature has an Equipment attached. */
  equippedOnly?: boolean;
  /** "Whenever one or more Goblins you control attack": the attackers must include one of these types. */
  attackerSubtypes?: string[];
  /** "Whenever you cast a red spell" / "a Lesson spell": for "youCast", only a spell of this color (W U B R G) or of this subtype counts. */
  spellColor?: string;
  spellSubtype?: string;
  /** "Whenever you cast a kicked spell": only when the spell was cast with its kicker paid. */
  spellKicked?: boolean;
  /** "Whenever you cast a creature spell with infect": only a creature spell (with this keyword). */
  spellCreature?: boolean;
  spellKeyword?: Keyword;
  /** "Whenever you cast a spell during an opponent's turn" / "your first spell during each opponent's turn". */
  opponentTurnOnly?: boolean;
  firstOnly?: boolean;
  /** Flurry: "whenever you cast your second spell each turn". */
  secondOnly?: boolean;
  /** "This ability triggers only once each turn." */
  oncePerTurn?: boolean;
  /** "Whenever you sacrifice a token": only a token counts. */
  tokenOnly?: boolean;
  /** A Class's ability: it only works once the Class has reached this level. */
  level?: number;
  /** The effects say "that creature" (the other side of a block): such a trigger happens once per blocker, others once per attacker. */
  usesOther?: boolean;
  /** For "allyEnters": "another creature you control" (not itself), and "with power 2 or less". */
  other?: boolean;
  maxPower?: number;
  /** "Whenever a creature you control with power 4 or greater enters". */
  minPower?: number;
  /** Undying: only if it had no +1/+1 counters on it as it died. */
  ifNoCounters?: boolean;
  /** Persist: only if it had no -1/-1 counters on it as it died. */
  ifNoMinusCounters?: boolean;
  effects: Effect[];
  targets: TargetSpec[];
  text: string;
}

export interface LoyaltyAbility {
  /** What it does to loyalty: +1, 0, -3. */
  cost: number;
  effects: Effect[];
  targets: TargetSpec[];
  text: string;
}

export interface ActivatedAbility {
  /** "{T}, Sacrifice this land: ..." : the permanent is sacrificed as part of the cost. */
  sacrifice?: boolean;
  /** "Activate only as a sorcery." */
  sorceryOnly?: boolean;
  /** "Activate only if you have at least 7 life more than your starting life total": the life needed. */
  minLife?: number;
  /** "Exile two cards from your graveyard" as a cost. */
  exileFromYard?: number;
  /** "Tap two untapped creatures you control that share a creature type" as a cost. */
  tapTwoSharing?: boolean;
  /** "Activate only if there are two or more creature cards in your graveyard." */
  needYardCreatures?: number;
  /** "Activate only if you control a creature with toughness 4 or greater." */
  needToughness?: number;
  /** "Activate only if you control two or more black permanents." */
  needColored?: { color: string; n: number };
  /** "Activate only during your turn." */
  yourTurnOnly?: boolean;
  /** "..., before attackers are declared." */
  beforeAttackers?: boolean;
  /** The ability works from the hand or the graveyard ("{1}{U}, discard this card: ..."), not from the battlefield. */
  zone?: "hand" | "graveyard";
  /** "Discard a card" or "Sacrifice a creature" as part of the cost: the player chooses which card when activating. */
  costCard?: { kind: "discard" | "sacrifice" | "sacArtifactOrDiscardNonland"; filter?: CardFilter; other?: boolean; label: string };
  /** Costs of such abilities: discard this card / exile this card from your graveyard / pay life. */
  discardSelf?: boolean;
  exileSelf?: boolean;
  payLife?: number;
  /** "Activate only once each turn." */
  oncePerTurn?: boolean;
  /** "Activate only once." (ever, for this permanent) */
  onceOnly?: boolean;
  /** A Case's "Solved — ..." ability: only once the Case is solved. */
  solvedOnly?: boolean;
  /** "Power-up - {4}{B}: ...": once only, and the cost is reduced by the card's mana cost if it entered this turn. */
  powerUp?: boolean;
  /** A Class's "{1}{B}: Level 2": gains that level, only from the level before it (and as a sorcery). */
  levelUp?: number;
  /** A Class's ability: it only works once the Class has reached this level. */
  level?: number;
  /** Channel: "This ability costs {1} less to activate for each legendary creature you control." */
  lessPerLegendary?: number;
  /** Tap the permanent as part of the cost ({T}). */
  tap: boolean;
  /** Mana to pay, as printed, e.g. "{1}{R}". Empty string = none. */
  mana: string;
  effects: Effect[];
  targets: TargetSpec[];
  text: string;
}

/** Everything the engine understood on a card. `ok` is false if any printed text was not understood. */
export interface ParsedCard {
  ok: boolean;
  /** Echo: the permanent owes its echo cost at its controller's next upkeep. */
  echo?: boolean;
  spell?: SpellAbility;
  triggers: TriggeredAbility[];
  activated: ActivatedAbility[];
  /** "{T}: Add {G} or {W}": the permanent can be tapped for one mana of any of these colors. */
  manaColors?: ManaColor[];
  /** "This creature can't block." */
  cantBlock?: boolean;
  /** "This creature can't be blocked." */
  cantBeBlocked?: boolean;
  /** "This land enters tapped." */
  entersTapped?: boolean;
  /** "~'s power and toughness are each equal to ...": a creature printed with * / *. */
  dynamicStats?: CountSpec;
  /** Planeswalker abilities: "+1: ...", "-3: ...", "0: ...". */
  loyaltyAbilities?: LoyaltyAbility[];
  /** "Crew 3": a Vehicle. Tapping creatures with total power 3 or more makes it a creature until end of turn. */
  crew?: number;
  /** "Ward {2}": whoever targets this with a spell or ability pays this or it is countered. "Ward—Pay 3 life": `wardLife`, with an empty `ward`. */
  ward?: string;
  wardLife?: number;
  /** "Toxic 2": a player this deals combat damage to also gets that many poison counters. */
  toxic?: number;
  /** "Protection from red": colors, and whether it is also protected from artifacts. */
  protection?: { colors: string[]; artifacts: boolean };
  /** "Flashback {2}{R}": the cost to cast this from the graveyard. "Flashback—Sacrifice a Mountain": no mana ("{0}"), and a permanent of that type is sacrificed. */
  flashback?: string;
  flashbackSacrifice?: string;
  /** "Harmonize {4}{U}": the cost to cast this from the graveyard (then it is exiled). A creature may be tapped to pay {X} of it, X being its power. */
  harmonize?: string;
  /** An Adventure card's spell (the second half of "Hearth Elemental // Stoke Genius"): cast from the hand, then exiled; the creature may be cast from exile. */
  adventure?: CardDef;
  /** "Players can't gain life." / "Damage can't be prevented." */
  noLifeGain?: boolean;
  damageUnpreventable?: boolean;
  /** "Replicate {1}": paid any number of times as the spell is cast, each time for a copy of it (with its own targets). */
  replicate?: string;
  /** "Plot {1}{R}": pay this to exile the card from your hand; it may be cast without paying its mana cost, as a sorcery, on a later turn. */
  plot?: string;
  /** A shock land: "As ~ enters, you may pay 2 life. If you don't, it enters tapped." The life. */
  shock?: number;
  /** "If you would put one or more counters on a permanent you control, put that many plus one of each of those kinds instead." */
  countersPlusOne?: boolean;
  /** "Your opponents can't cast spells during your turn." */
  noOppSpellsOnYourTurn?: boolean;
  /** "Prevent all damage that would be dealt to ~." */
  preventDamageToSelf?: boolean;
  /** "You may activate abilities of creatures you control as though those creatures had haste." */
  hasteForAbilities?: boolean;
  /** "You have no maximum hand size." / "Your maximum hand size is ten." */
  maxHandSize?: number;
  /** A Saga: its chapters, and the last one (it is sacrificed once that chapter's ability has left the stack). */
  saga?: { final: number; chapters: { numbers: number[]; effects: Effect[]; targets: TargetSpec[]; text: string }[] };
  /** A Plan enchantment: when this many plan counters are on it, it is sacrificed and these effects happen (a reflexive trigger, with its own targets). */
  plan?: { threshold: number; effects: Effect[]; targets: TargetSpec[]; text: string };
  /** "Teamwork 3": as an additional cost the caster may tap creatures with total power 3 or more. Doing so counts as kicking the spell. */
  teamwork?: number;
  /** Delve: each card exiled from the graveyard while casting it pays for {1}. */
  delve?: true;
  /** "Kicker {2}": the extra mana that may be paid when casting. Offspring is a kicker by another name (`kickerName`). */
  kicker?: string;
  kickerName?: "offspring" | "waterbend" | "buyback";
  /** Convoke: creatures tapped while casting it pay for {1} or a mana of their color each. */
  convoke?: boolean;
  /** Storm: a copy of the spell for each spell cast before it this turn. */
  storm?: boolean;
  /** Cascade: how many times it has it. */
  cascade?: number;
  /** "Bloodthirst 2": it enters with this many +1/+1 counters if an opponent was dealt damage this turn. */
  bloodthirst?: number;
  /** "Affinity for artifacts": it costs {1} less for each of these you control (artifacts, lands, or a creature type). */
  affinity?: string;
  /** "As an additional cost to cast this spell, you may blight 1": the -1/-1 counters put on a creature you control. Paying it counts as kicking. */
  blight?: number;
  /** "Warp {W}": the cost to cast it from hand, after which it is exiled at the next end step. */
  warp?: string;
  /** "Creatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. Ward abilities of those creatures don't trigger." */
  ignoresHexproof?: boolean;

  /** "If this creature was kicked, it enters with two +1/+1 counters on it." */
  kickedCounters?: number;
  /** "This spell can't be countered." */
  cantBeCountered?: boolean;
  /** "This creature enters prepared." */
  entersPrepared?: boolean;
  /** A preparation card's spell (the second half of "Quill-Blade Laureate // Twofold Intent"): a copy of it can be cast while the creature is prepared. */
  prepare?: CardDef;
  /** "This creature attacks each combat if able." */
  mustAttack?: boolean;
  /** "Swampwalk" etc.: unblockable while the defender controls a land of this type ("swamp"). */
  landwalk?: string[];
  /** "As an additional cost to cast this, sacrifice a creature." */
  extraSacrifice?: boolean;
  /** "...sacrifice an artifact or creature": an artifact will do too. */
  extraSacrificeOrArtifact?: boolean;
  /** Paradigm: the spell is exiled as it resolves, and a copy of it may be cast at the beginning of each of its owner's first main phases. */
  paradigm?: boolean;
  /** "As this enters, choose a color (other than blue)." */
  chooseColor?: { except?: string };
  /** "As this land enters, choose a creature type." */
  chooseType?: boolean;
  /** "Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control": the type. */
  othersEnterWithCounters?: string;
  /** "{T}: Add {U} or one mana of the chosen color." */
  manaChosen?: boolean;
  /** "Can't be blocked except by walls and/or creatures with flying": only these can block it. */
  blockedOnlyBy?: { subtypes: string[]; keywords: Keyword[]; colors: string[]; artifact: boolean };
  /** "This land enters tapped unless ...": the conditions under which it enters untapped. */
  entersTappedUnless?: { /** "enters tapped if it's not your turn" */ yourTurn?: boolean; basics?: number; otherLands?: number; fewerOtherLands?: number; planeswalker?: boolean; lifeAtMost?: number; opponentLands?: number; never?: boolean; /** "unless you control a Forest or an Island" */ landTypes?: string[] };
  /** "Can't be blocked by creatures with power 2 or less / 4 or greater." */
  cantBeBlockedByPower?: { n: number; op: "max" | "min" };
  /** "This creature can't attack unless defending player controls an Island." */
  attackOnlyIfDefenderControls?: string;
  /** "All creatures able to block this creature do so." */
  lureAll?: boolean;
  /** "Spells your opponents cast that target this cost {2} more to cast." */
  targetTax?: number;
  /** "Enchanted creature has 'Whenever you gain life, put that many +1/+1 counters on this creature'." */
  hostGainLifeCounters?: boolean;
  /** "You control enchanted creature" (Mind Control, Confiscate): the Aura's controller controls what it enchants. */
  hostControl?: boolean;
  /** "Prevent all noncombat damage that would be dealt to you and creatures you control." */
  preventNoncombat?: boolean;
  /** "If a source would deal damage to you, prevent 1 of that damage" (Urza's Armor): how much of every hit to its controller is prevented. */
  reduceDamageToYou?: number;
  /** "Whenever enchanted creature deals damage, you gain that much life" (Spirit Link): the Aura's controller gains life equal to the damage the creature it enchants deals. */
  hostDamageLife?: boolean;
  /** "If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead." */
  drawDouble?: boolean;
  /** "If you would gain life, you gain that much life plus 1 / twice that much instead." */
  lifeGainPlus?: number;
  lifeGainDouble?: boolean;
  /** "~ costs {1} less to cast if you control a Wizard" / "for each spell your opponents have cast this turn" / "if you control a creature with flying". */
  /** `ifTargetsTapped`: "if it targets a tapped permanent" (so the cost depends on the targets chosen). */
  /** `ifTargetsColor`: "if it targets a blue spell" (the color's letter). */
  costReduction?: { n: number; ifYardCreatures?: number; ifTargetsAttacking?: boolean; ifControl?: string; ifFlyer?: boolean; perOpponentSpell?: boolean; per?: CountSpec; ifTargetsTapped?: boolean; ifTargetsColor?: string };
  /** Permanents that make your spells cost less: "Goblin spells you cast cost {1} less", "during turns other than yours...". */
  /** "White spells you cast cost {W} more to cast" (the Leech cycle): one more mana of that color for each spell of that color the controller casts. */
  spellTax?: { color: string; extra: string }[];
  costMods?: { n: number; subtype?: string; minMV?: number; otherTurn?: boolean; /** "...cost {X} less to cast, where X is ~'s power" */ nFromPower?: boolean; instantSorceryOnly?: boolean }[];
  /** "Spells you cast with mana value 5 or greater can't be countered." */
  uncounterableMinMV?: number;
  /** "As an additional cost to cast this spell, sacrifice a Goblin." */
  extraSacrificeType?: string;
  /** "As an additional cost to cast this spell, discard a card." */
  extraDiscard?: boolean;
  /** "As an additional cost to cast this spell, sacrifice a creature or pay {3}{B}": the mana paid instead of sacrificing. */
  extraSacrificeOrPay?: string;
  /** "Enchanted creature loses all abilities and is a black Skeleton creature with base power and toughness 1/1." */
  hostBecomes?: { subtype: string; color: string; power: number; toughness: number };
  /** "Can't attack unless you control more creatures than defending player" / "can't block unless ...". */
  attackIfMoreCreatures?: boolean;
  blockIfMoreCreatures?: boolean;
  /** "Can't be blocked by red creatures." */
  cantBeBlockedByColors?: string[];
  /** "This creature can block only creatures with flying." */
  blocksOnlyFlying?: boolean;
  /** "This creature can't attack or block alone." */
  cantAttackAlone?: boolean;
  /** "All creatures able to block this creature do so." */
  lure?: boolean;
  /** "This creature can't be blocked by more than one creature." */
  maxBlockers?: number;
  /** "Cycling {2}": the mana to pay to discard this card from hand and draw a card. */
  cycling?: string;
  /** "Basic landcycling {1}{G}": pay, discard, and search for a basic land card. */
  landcycling?: string;
  /** "Plainscycling {2}": the same, but the card searched for must be of this basic land type. */
  landcyclingType?: string;
  /** "~ enters with two -1/-1 counters on it." */
  entersWithMinus?: number;
  /** "~ enters tapped with three stun counters on it". */
  entersWithStun?: number;
  /** "~ enters with two +1/+1 counters on it" (or X). */
  entersWithCounters?: number | "X";
  /** "Enchant creature": the card is an Aura and needs a target when it is cast. */
  aura?: TargetSpec;
  statics?: StaticEffect[];
  /** Lines of rules text that were not understood (empty when `ok`). */
  unsupported: string[];
}

// ───────── the stack ─────────

/** A choice of target made by a player. */
export type TargetChoice =
  | { kind: "player"; id: PlayerId }
  | { kind: "permanent"; iid: string }
  | { kind: "card"; iid: string } // a card in a graveyard
  | { kind: "stack"; id: string }
  | { kind: "none" }; // "up to one" target: chosen nothing

export type StackItem =
  | {
      kind: "spell";
      id: string;
      controller: PlayerId;
      card: CardInstance;
      effects: Effect[];
      targets: TargetChoice[];
      specs: TargetSpec[];
      /** The X chosen for the spell (0 when its cost has no X). */
      x: number;
      /** Cast with its kicker paid. */
      kicked?: boolean;
      /** Cast from the graveyard with flashback: it is exiled afterwards, not put back in the graveyard. */
      flashback?: boolean;
      /** A copy of a spell (a prepared creature's spell): it ceases to exist when it leaves the stack. */
      copy?: boolean;
      /** Paid with mana that gives it haste ("if that mana is spent on a Dragon creature spell, it gains haste until end of turn"). */
      haste?: boolean;
      /** Cast for its warp cost: the permanent is exiled at the beginning of the next end step. */
      warped?: boolean;
      /** An Adventure: it goes to exile as it resolves, and the creature may be cast from there. */
      adventure?: boolean;
      /** The mana spent to cast it. */
      manaSpent?: number;
    }
  | {
      kind: "ability";
      id: string;
      controller: PlayerId;
      /** The permanent (or card) that the ability came from. */
      source: string;
      sourceName: string;
      effects: Effect[];
      targets: TargetChoice[];
      specs: TargetSpec[];
      text: string;
      /** "That creature" for a block trigger: the creature on the other side of the block. */
      other?: string;
      /** A number remembered when the ability was activated (the power of a creature that was sacrificed as its cost). */
      x?: number;
      /** A "when this dies" ability: the creature as it last was. */
      died?: LastKnown;
      /** A triggered ability (not one a player activated). */
      trigger?: true;
      /** The toughness of the creature sacrificed to pay for it. */
      sacToughness?: number;
    };

/** An open round of priority: `holder` may respond or pass. When both pass in a row, the top item resolves. */
export interface PriorityRound {
  holder: PlayerId;
  /** Consecutive passes so far. */
  passes: number;
  /** What to do when the stack is empty and both players pass: carry on with combat damage. */
  then: "afterBlockers" | "afterAttackers" | null;
}

/**
 * A choice among cards, waiting for a player: which card to discard, which of the top cards to keep, which basic
 * land to fetch, or the order of the top of the library. The game stands still until it is answered.
 */
export interface PendingPick {
  /** Who chooses. */
  player: PlayerId;
  /** The card the choice comes from. A resolving spell is already in the graveyard, so this is how both players see what is going on. */
  source?: { iid: string; name: string; defId?: string };
  prompt: string;
  kind: "discard" | "bounceOwn" | "tapSome" | "topBottom" | "rummage" | "mayPay" | "tax" | "toggle" | "toHand" | "toGraveyard" | "searchLand" | "searchAny" | "revealToHand" | "arrange" | "scry" | "surveil" | "ward" | "crew" | "mode" | "color" | "creatureType" | "handExile" | "exileToPlay" | "handToField" | "mayCost" | "legend" | "look" | "playExile" | "keepTop" | "learn" | "discardDraw" | "fromYard" | "sacrificeOwn";
  /** The cards to choose between (instance ids). They are shown to the chooser. */
  options: string[];
  /** The player may decline (eye spy, a search that finds nothing). */
  optional: boolean;
  /** Whose hand (discard) or library (look, search, arrange) the cards are in. */
  owner: PlayerId;
  /** How many more cards are to be chosen (discard two cards). */
  remaining: number;
  /** Arrange: the cards already placed, top first. Discard: the cards discarded so far. */
  ordered: string[];
  /** Ward: the spell or ability on the stack that is countered unless the cost is paid, and the cost. */
  wardItem?: string;
  wardCost?: string;
  /** "You may pay 2 life": the life paid with (or instead of) `wardCost`. */
  payLife?: number;
  /** A shock land: the land that enters tapped if the life isn't paid. */
  tapIfNot?: string;
  /** To hand: then one of the others is exiled to play this turn, the last goes to the bottom (Expressive Iteration). */
  thenExile?: boolean;
  /** Discard: the cards are discarded because of an opponent's spell or ability (Guerrilla Tactics). */
  byOpp?: boolean;
  /** To hand: then one of the others stays on top of the library, the last goes to the bottom (Telling Time). */
  thenTop?: boolean;
  /** Crew: the Vehicle being crewed. */
  vehicle?: string;
  /** Connive: the creature that gets a +1/+1 counter if the discarded card is not a land. */
  conniver?: string;
  /** Color / creature type: the permanent that is choosing it as it enters. */
  colorFor?: string;
  /** Search: the land enters tapped. */
  entersTapped?: boolean;
  /** Discard: one card of this type is enough ("discard two cards unless you discard an artifact card"). */
  enoughType?: "artifact" | "creature";
  /** Hand to field: the card enters tapped (entersTapped), and an Equipment is attached to this permanent. */
  attachHolder?: string;
  /** Hand to field: if the player declines, they draw a card. */
  elseDraw?: boolean;
  /** MayPay ("unless you pay"): what happens when the cost isn't paid. */
  elseEffects?: Effect[];
  /** Cards the chooser looks at that can't be chosen (the lands in a hand being looked at). */
  seen?: string[];
  /** Hand exile: the permanent that keeps the card until it leaves the battlefield. */
  holder?: string;
  /** Exile to play (Lightstall Inquisitor): what a spell cast from there costs more, and whether a land played from there enters tapped. */
  playTax?: number;
  playLandTapped?: boolean;
  /** Search or look, to hand: the card text reveals the chosen card, so the opponent may learn its name. */
  reveal?: boolean;
  /** Reveal-to-hand / tutor: where the card goes, and what happens to the rest of the looked-at cards. */
  bottomIids?: string[];
  randomBottom?: boolean;
  restToGraveyard?: boolean;
  /** MayPay / mayDiscard: the effects that happen if the cost is paid or a card is discarded. Tax: who draws if it isn't. */
  thenEffects?: Effect[];
  thenCtx?: RunContext;
  thenSpecs?: TargetSpec[];
  /** What the effects that follow do, said while their targets are chosen (otherwise "when you paid"). */
  thenText?: string;
  taxFor?: PlayerId;
  /** Toggle: the permanent that may be tapped or untapped. */
  toggleIid?: string;
  /** Color: the chosen color is floating mana ("add one mana of any color"), not a permanent's color. */
  poolColor?: boolean;
  /** Mode: the choices (the options are their indexes as text) and the ability waiting for one. */
  modes?: ModeSpec[];
  /** Mode: "choose one that hasn't been chosen": the choice is remembered on the source permanent. */
  modeUnchosen?: boolean;
  modeItem?: Extract<StackItem, { kind: "ability" }>;
  /** From the graveyard: where the chosen card goes, and whether it gets a finality counter. */
  yardTo?: "hand" | "battlefield";
  finality?: boolean;
  /** Rummage: how many cards are drawn for the discarded one. */
  drawN?: number;
  /** The effects that come after this choice on the same card ("Scry 2, then draw a card"), run once it is answered. */
  rest?: Effect[];
  ctx?: RunContext;
}

/** A triggered ability that needs its controller to choose targets before it goes on the stack. */
export interface PendingChoice {
  player: PlayerId;
  item: Extract<StackItem, { kind: "ability" }>;
  specs: TargetSpec[];
}
