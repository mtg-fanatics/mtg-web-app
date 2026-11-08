import { CARD_SETS } from "@/lib/sets";

// Reading a list question ("white creatures with flying that are Standard legal", "cheap removal", "legendary lands in Foundations") into
// filters on the card database. Pure: the Scribe turns the filters into a query.

export interface CardFilter {
  colors: string[]; // W U B R G: the card has at least one of them (a "white blue" question wants either)
  colorless: boolean;
  types: string[]; // creature, instant, ...
  keywords: string[]; // Scryfall's keyword names: "Flying", "First strike"
  text: string[]; // phrases of the rules text, % standing for anything
  maxCost?: number;
  minCost?: number;
  rarity?: string;
  set?: string; // a set's code
  standard: boolean;
  legendary: boolean;
  playable: boolean;
}

const COLORS: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const TYPES: [RegExp, string[]][] = [
  [/\bcreatures?\b/, ["creature"]],
  [/\b(instants?)\b/, ["instant"]],
  [/\b(sorcery|sorceries)\b/, ["sorcery"]],
  [/\blands?\b/, ["land"]],
  [/\bartifacts?\b/, ["artifact"]],
  [/\benchantments?\b/, ["enchantment"]],
  [/\bplaneswalkers?\b/, ["planeswalker"]],
  [/\bspells\b/, ["instant", "sorcery"]],
];
const KEYWORDS = ["flying", "trample", "haste", "vigilance", "deathtouch", "lifelink", "first strike", "double strike", "menace", "reach", "hexproof", "indestructible", "flash", "defender", "ward", "prowess", "cycling", "flashback", "kicker", "scry", "surveil", "proliferate", "convoke", "delve", "storm", "affinity", "toxic", "infect", "equip", "crew", "landfall", "adventure", "explore", "amass"];
// what a player may say, and the rules text that means it
const EFFECTS: [RegExp, string, string][] = [
  [/\b(draw|draws|card draw)\b/, "draw", "%draw%card%"],
  [/\b(removal|destroy|kill|kills)\b/, "removal", "%destroy target%"],
  [/\b(exile|exiles)\b/, "exile", "%exile target%"],
  [/\bcounter ?spells?\b|\bcounters? (a |target )?spell/, "counterspell", "%counter target%spell%"],
  [/\b(ramp|mana)\b.*\b(accelerat|produc|add)\w*|\bramp\b/, "ramp", "%add {%"],
  [/\b(gain|gains) life\b|\blife ?gain\b/, "lifegain", "%gain%life%"],
  [/\b(burn|damage)\b/, "damage", "%deals%damage%"],
  [/\b(tokens?)\b/, "tokens", "%create%token%"],
  [/\bdiscard\b/, "discard", "%discard%"],
  [/\bmill\b/, "mill", "%mill%"],
  [/\b(recursion|reanimat\w*|graveyard)\b/, "graveyard", "%from your graveyard%"],
  [/\bsacrifice\b/, "sacrifice", "%sacrifice%"],
  [/\b(tutor|search your library)\b/, "tutor", "%search your library%"],
  [/\bbounce\b/, "bounce", "%return target%to its owner%hand%"],
  [/\bboards? wipes?\b|\bwraths?\b|\bsweepers?\b/, "board wipe", "%destroy all%"],
];

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'");

export function parseFilters(question: string): CardFilter & { named: string[] } {
  const q = norm(question);
  const f: CardFilter & { named: string[] } = { colors: [], colorless: false, types: [], keywords: [], text: [], standard: false, legendary: false, playable: false, named: [] };
  for (const [word, letter] of Object.entries(COLORS)) if (new RegExp(`\\b${word}\\b`).test(q)) (f.colors.push(letter), f.named.push(word));
  if (/\bcolou?rless\b/.test(q)) (f.colorless = true, f.named.push("colorless"));
  for (const [re, types] of TYPES) if (re.test(q)) for (const t of types) if (!f.types.includes(t)) f.types.push(t);
  for (const k of KEYWORDS) if (new RegExp(`\\b${k}\\b`).test(q)) (f.keywords.push(k[0].toUpperCase() + k.slice(1)), f.named.push(k));
  if (/\bflyers?\b|\bfliers?\b/.test(q) && !f.keywords.includes("Flying")) (f.keywords.push("Flying"), f.named.push("flying"));
  for (const [re, name, pattern] of EFFECTS) if (re.test(q) && !f.text.includes(pattern)) (f.text.push(pattern), f.named.push(name));
  // text the player quoted, or "that say / mention X"
  const quoted = /["“]([^"”]{3,})["”]/.exec(question) ?? /\b(?:that|which)?\s*(?:mention|mentions|say|says|contain|contains)\s+(.{3,40}?)(?:\s+(?:in|from|that|and)\b|\?|$)/i.exec(question);
  if (quoted && !KEYWORDS.includes(quoted[1].trim().toLowerCase())) (f.text.push(`%${quoted[1].trim().replace(/[%_]/g, "")}%`), f.named.push(`“${quoted[1].trim()}”`));
  // cost
  const m =
    /\b(?:cost|costs|mana value|mv|cmc)\s*(?:of\s*)?(\d+)\s*(or less|or fewer|or under|or more|or greater|or higher)?/.exec(q) ??
    /\b(\d+)\s*(?:mana|drop|cmc|mv)\b\s*(or less|or fewer|or more|or greater)?/.exec(q) ??
    /\b(?:under|below|less than)\s*(\d+)\s*(?:mana|cost|cmc)?/.exec(q);
  if (m) {
    const n = Number(m[1]);
    if (/under|below|less than/.test(m[0]) && !m[2]) (f.maxCost = n - 1, f.named.push(`cost under ${n}`));
    else if (m[2] && /more|greater|higher/.test(m[2])) (f.minCost = n, f.named.push(`cost ${n}+`));
    else if (m[2]) (f.maxCost = n, f.named.push(`cost ${n} or less`));
    else (f.minCost = f.maxCost = n, f.named.push(`cost ${n}`));
  } else if (/\b(cheap|low cost|low-cost)\b/.test(q)) (f.maxCost = 2, f.named.push("cheap (cost 2 or less)"));
  else if (/\b(expensive|big|high cost)\b/.test(q) && !/\bbig (?:score|dumb)\b/.test(q)) (f.minCost = 6, f.named.push("expensive (cost 6+)"));
  const rarity = /\b(mythic|rare|uncommon|common)s?\b/.exec(q);
  if (rarity) (f.rarity = rarity[1], f.named.push(rarity[1]));
  if (/\blegendary\b|\blegends?\b/.test(q)) (f.legendary = true, f.named.push("legendary"));
  if (/\bstandard\b/.test(q) && /\b(legal|in standard|allowed|playable in)\b|\bstandard[- ](legal|cards)\b/.test(q)) (f.standard = true, f.named.push("Standard legal"));
  if (/\b(in the game|the game can play|playable in (this|the) game|implemented|supported)\b/.test(q)) (f.playable = true, f.named.push("playable in the game"));
  // a set, by code ("in FDN") or by name ("in Lorwyn Eclipsed"): the longest name wins
  let best: (typeof CARD_SETS)[number] | undefined;
  for (const s of CARD_SETS) if (norm(question).includes(s.name.toLowerCase()) && (!best || s.name.length > best.name.length)) best = s;
  if (!best) {
    for (const word of question.split(/[^A-Za-z0-9]+/)) {
      const s = word.length >= 3 && word === word.toUpperCase() ? CARD_SETS.find((x) => x.code === word.toLowerCase()) : undefined;
      if (s) best = s;
    }
  }
  if (best) (f.set = best.code, f.named.push(`from ${best.name}`));
  return f;
}

/** How many separate conditions the question gave. */
export function filterCount(f: CardFilter): number {
  return f.colors.length + Number(f.colorless) + f.types.length + f.keywords.length + f.text.length + Number(f.maxCost !== undefined || f.minCost !== undefined) + Number(Boolean(f.rarity)) + Number(Boolean(f.set)) + Number(f.standard) + Number(f.legendary) + Number(f.playable);
}

/** Does the question read as a request for a list of cards? */
export function wantsList(question: string): boolean {
  const q = norm(question);
  const noun = /\b(cards?|creatures?|instants?|sorcer(y|ies)|spells|lands?|artifacts?|enchantments?|planeswalkers?|removal|counterspells?|flyers?|fliers?|legends?|tokens?)\b/.test(q);
  const verb = /^(which|what|show|list|find|give|any|are there|name|suggest|recommend|search|i want|i need|looking for|top)\b|\b(cards?|creatures?) (that|which|with|in|from|for|of)\b|\bare there\b|\bdo you know\b|\b(give|show|list|find|get) (me )?(the |all |some |every )?|\b(can|could|would) you (please )?(give|show|list|find|get)\b/.test(q);
  return noun && verb;
}

/** The conditions in words, for the answer: "white creatures with Flying that are Standard legal". */
export function describeFilter(f: ReturnType<typeof parseFilters>): string {
  const bits = f.named.filter((n, i) => f.named.indexOf(n) === i);
  const types = f.types.length ? f.types.map((t) => t + "s").join(" or ") : "cards";
  return `${types} (${bits.join(", ") || "any"})`;
}
