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

/** Plain-English help for the everyday rules words found in `text`. */
export function basicHelp(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const e of BASICS) {
    if (e.match.test(text) && !out.includes(e.help)) out.push(e.help);
    if (out.length >= max) break;
  }
  return out;
}
