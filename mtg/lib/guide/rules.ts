// The everyday rules words, in plain English, for the Scribe (the glossary in app/play/glossary.ts covers the rarer abilities).

interface Entry {
  match: RegExp;
  help: string;
}

const BASICS: Entry[] = [
  { match: /\bflying\b/i, help: "Flying: this creature can only be blocked by creatures with flying or reach." },
  { match: /\breach\b/i, help: "Reach: this creature can block creatures with flying." },
  { match: /\btrample\b/i, help: "Trample: if this creature is blocked, it assigns just enough damage to the blocker to kill it and the rest goes to the player (or planeswalker) it attacks." },
  { match: /\bhaste\b/i, help: "Haste: this creature can attack and use {T} abilities the turn it comes under your control." },
  { match: /\bvigilance\b/i, help: "Vigilance: attacking doesn't make this creature tap, so it can still block on your opponent's turn." },
  { match: /\bdeathtouch\b/i, help: "Deathtouch: any amount of damage this creature deals to a creature is enough to destroy it." },
  { match: /\blifelink\b/i, help: "Lifelink: damage this deals also gains you that much life." },
  { match: /\bfirst strike\b/i, help: "First strike: this creature deals combat damage before creatures without first strike, so it can win a fight before the other one hits back." },
  { match: /\bdouble strike\b/i, help: "Double strike: this creature deals combat damage twice, once with the first strikers and once with everyone else." },
  { match: /\bmenace\b/i, help: "Menace: this creature can't be blocked except by two or more creatures." },
  { match: /\bdefender\b/i, help: "Defender: this creature can't attack." },
  { match: /\bindestructible\b/i, help: "Indestructible: it isn't destroyed by lethal damage or by “destroy” effects. It can still be exiled, sacrificed, or shrunk to 0 toughness." },
  { match: /\bflash\b/i, help: "Flash: you may cast this spell any time you could cast an instant, even on your opponent's turn." },
  { match: /\bsummoning sick(ness)?\b/i, help: "Summoning sickness: a creature can't attack or use {T} abilities until you have controlled it since the start of your turn (unless it has haste)." },
  { match: /\bthe stack\b|\bwhat is (the )?stack\b/i, help: "The stack: spells and abilities wait there before they do anything. The last one put on resolves first, and both players can respond before it does." },
  { match: /\bpriority\b/i, help: "Priority: the right to cast a spell or use an ability. The player whose turn it is gets it first; when both pass in a row, the top of the stack resolves (or the game moves on if the stack is empty)." },
  { match: /\bmana value\b|\bconverted mana cost\b|\bcmc\b/i, help: "Mana value: the total amount of mana in a card's mana cost. {2}{R}{R} has mana value 4 (X counts as 0 on the battlefield)." },
  { match: /\blegend(ary)?( rule)?\b/i, help: "Legendary: you can control only one permanent with the same name. If you control two, you choose one and the other goes to the graveyard." },
  { match: /\bmulligan\b/i, help: "Mulligan: if you don't like your opening hand you may shuffle it back and draw a new seven; then you put a card on the bottom of your library for each time you took one." },
  { match: /\bstandard\b.*\b(format|mean|what)\b|\bwhat is standard\b/i, help: "Standard: the format that only allows cards from the most recent sets. When a set rotates out, its cards stop being legal in Standard." },
  { match: /\btoken\b/i, help: "Token: a permanent that isn't a card. It's created by an effect, and if it leaves the battlefield it ceases to exist." },
  { match: /\bcounter(s)?\b.*\b(\+1\/\+1|plus)\b|\+1\/\+1 counter/i, help: "+1/+1 counter: a marker that makes the creature 1 bigger in both power and toughness for as long as it stays on it." },
  { match: /\betb\b|\benters tapped\b/i, help: "Enters tapped: the permanent arrives turned sideways, so it can't be tapped for mana or attack until it untaps." },
  { match: /\bsorcery speed\b/i, help: "Sorcery speed: only in your own main phase, with an empty stack." },
  { match: /\binstant speed\b/i, help: "Instant speed: any time you have priority, even on your opponent's turn or in response to something." },
];

// Questions about how the game is played, answered when they are asked in that way (these words also appear on cards, so they are not matched on card text).
const HOW_IT_WORKS: Entry[] = [
  { match: /^(?!.*\b(water|dance|shoes?|beer|keg|phone|screen|pocket)\b).*\b(what does|what is|what s|whats|how does|explain)\b.*\b(tap|tapping|tapped)\b|\bwhat does tap mean\b/, help: "Tap: turn a card sideways. You tap a land to get mana, and a creature taps when it attacks (unless it has vigilance) or uses an ability with the {T} symbol. A tapped card stays tapped until it untaps in your untap step." },
  { match: /\b(untap|untapping)\b/, help: "Untap: at the start of each of your turns all your tapped cards turn upright again (the untap step), so your lands and creatures are ready to use." },
  { match: /\bland drop\b|\bplay (a|another|more than one) land\b|\bhow many lands?\b.*\b(turn|each|per|play)\b|\bcan i play (a|two|more)? ?lands?\b/, help: "You may play one land each turn, from your hand, in your main phase while the stack is empty. Only an effect that says so lets you play more." },
  { match: /\bhow many cards\b.*\bdeck\b|\bdeck size\b|\bminimum deck\b|\bhow (big|large) .*\bdeck\b|\bdeck (has|must have)\b/, help: "A Standard deck has at least 60 cards, with no more than four copies of any card except basic lands, and may have a sideboard of up to 15 cards. A Commander deck has exactly 100." },
  { match: /\b(turn structure|steps of (a|the) turn|phases of (a|the) turn|what happens (in|during) (a|my|the) turn|turn order|parts of a turn)\b/, help: "A turn goes: untap, upkeep, draw, first main phase (play a land, cast spells), combat (attackers, blockers, damage), second main phase, end step, cleanup." },
  { match: /\bhow (does )?combat work\b|\bcombat (steps|phases)\b|\bhow (do i|to) attack\b|\bhow (does )?attacking work\b/, help: "Combat: in your combat phase you choose which creatures attack (they tap, unless they have vigilance). The defending player chooses which of their untapped creatures block. Then damage is dealt: an unblocked creature hurts the player, a blocked one fights its blocker." },
  { match: /^(?!.*\b(insurance|expectancy|left|years|live|lives|age|span|coach|style|hack)\b).*(\bstarting life\b|\bhow much life\b|\blife total\b)/, help: "Each player starts with 20 life. A player at 0 life or less loses the game." },
  { match: /^(?!.*\b(argument|arguments|lottery|bet|election|case|fight|war|race|contest|lawsuit|debate|prize|money|friends?|love)\b).*(\bhow (do i|to|can i) win\b|\bwin(ning)? the game\b|\bwinning condition\b)/, help: "You win by reducing your opponent's life to 0 (usually by attacking with creatures), or when they have to draw from an empty library, or when a card says you win." },
  { match: /^(?=.*\b(game|cards?|magic|mtg|turn|discard)\b).*(\bhand size\b|\bmaximum hand\b|\bhow many cards .*\bhand\b)/, help: "You start with seven cards. At the end of your turn, if you hold more than seven, you discard down to seven." },
  { match: /^(?!.*\b(cost|costs|value|cmc|much)\b).*\b(what is|what s|whats|how does|explain)\b.*\bmana\b|\bgeneric mana\b/, help: "Mana pays for spells and abilities. Lands make it when you tap them: white {W}, blue {U}, black {B}, red {R}, green {G}, or colourless {C}. A number like {2} in a cost is generic: any mana can pay it." },
  { match: /\b(best|good|strongest|top) (deck|decks)\b|\bwhat deck should\b|\bwhich deck\b.*\b(best|play|use)\b/, help: "I can't say which deck is best: it depends on how you like to play. I can help you build one, though: ask me for cards by colour, kind or effect, such as “green creatures with trample” or “cheap removal”." },
];

/** The answer to a question about how the game is played, when that is what was asked. */
export function howItWorks(question: string): string | undefined {
  return HOW_IT_WORKS.find((e) => e.match.test(question))?.help;
}

/** Plain-English help for the everyday rules words found in `text`. */
export function basicHelp(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const e of BASICS) {
    if (e.match.test(text) && !out.includes(e.help)) out.push(e.help);
    if (out.length >= max) break;
  }
  return out;
}
