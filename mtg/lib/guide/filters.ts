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
  subtypes: string[]; // creature kinds on the type line: "Angel", "Elf"
  order?: "cost_desc" | "cost_asc" | "power_desc"; // "the most expensive", "the cheapest", "the strongest"
}

// creature kinds a player may ask for, in the plural or singular ("elves" is Elf, "wolves" is Wolf)
const SUBTYPES: [RegExp, string][] = [
  [/\bangels?\b/, "Angel"], [/\bdragons?\b/, "Dragon"], [/\b(elf|elves)\b/, "Elf"], [/\bgoblins?\b/, "Goblin"], [/\bzombies?\b/, "Zombie"], [/\bvampires?\b/, "Vampire"],
  [/\bhumans?\b/, "Human"], [/\bwizards?\b/, "Wizard"], [/\bmerfolk\b/, "Merfolk"], [/\bbirds?\b/, "Bird"], [/\bdinosaurs?\b/, "Dinosaur"], [/\bdemons?\b/, "Demon"],
  [/\belementals?\b/, "Elemental"], [/\bknights?\b/, "Knight"], [/\bsoldiers?\b/, "Soldier"], [/\bwarriors?\b/, "Warrior"], [/\bbeasts?\b/, "Beast"], [/\brogues?\b/, "Rogue"],
  [/\bclerics?\b/, "Cleric"], [/\bshamans?\b/, "Shaman"], [/\bspirits?\b/, "Spirit"], [/\bwerewol(f|ves)\b/, "Werewolf"], [/\bsquirrels?\b/, "Squirrel"], [/\brats?\b/, "Rat"],
  [/\bbats?\b/, "Bat"], [/\bfrogs?\b/, "Frog"], [/\blizards?\b/, "Lizard"], [/\botters?\b/, "Otter"], [/\bbears?\b/, "Bear"], [/\b(wolf|wolves)\b/, "Wolf"], [/\bhorrors?\b/, "Horror"],
  [/\bgiants?\b/, "Giant"], [/\bhydras?\b/, "Hydra"], [/\bsphinx(es)?\b/, "Sphinx"], [/\bskeletons?\b/, "Skeleton"], [/\bpirates?\b/, "Pirate"], [/\bdwarf|dwarves\b/, "Dwarf"],
  [/\btreefolk\b/, "Treefolk"], [/\bphyrexians?\b/, "Phyrexian"], [/\bconstructs?\b/, "Construct"], [/\bgolems?\b/, "Golem"], [/\bdruids?\b/, "Druid"], [/\bmonks?\b/, "Monk"],
  [/\bsamurai\b/, "Samurai"], [/\bninjas?\b/, "Ninja"], [/\bslivers?\b/, "Sliver"], [/\beldrazi\b/, "Eldrazi"], [/\bgods?\b/, "God"], [/\bscouts?\b/, "Scout"], [/\bheroes|hero\b/, "Hero"],
  [/\bvillains?\b/, "Villain"], [/\bartificers?\b/, "Artificer"], [/\bmice|mouse\b/, "Mouse"], [/\brabbits?\b/, "Rabbit"], [/\braccoons?\b/, "Raccoon"], [/\bcats?\b/, "Cat"],
];

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
  [/\bdraw(?:s|ing)? (?:a |an |two |three |some |extra |more |your |cards? )?cards?\b|\bcard draw\b/, "draw", "%draw%card%"],
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

/** The names a list question gives to its colours and effects (so a narrowed list can drop the ones it replaced). */
export const COLOR_NAMES = new Set(["white", "blue", "black", "red", "green", "colorless"]);
export const EFFECT_NAMES = new Set(["draw", "removal", "exile", "counterspell", "ramp", "lifegain", "damage", "tokens", "discard", "mill", "graveyard", "sacrifice", "tutor", "bounce", "board wipe"]);

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'");

// The words a question about cards is built from. A word that is nearly one of these ("legenadary", "creatuers", "pictuers") is read as it.
const VOCABULARY = [
  "legendary", "standard", "legal", "creature", "creatures", "instant", "instants", "sorcery", "sorceries", "artifact", "artifacts", "enchantment", "enchantments",
  "planeswalker", "planeswalkers", "land", "lands", "spells", "cards", "colorless", "colourless", "white", "blue", "black", "green", "removal", "counterspell", "counterspells",
  "image", "images", "picture", "pictures", "photo", "photos", "artwork", "playable", "rulings", "ruling", "printed", "reprint", "printings", "common", "uncommon", "mythic",
  "graveyard", "tokens", "discard", "sacrifice", "proliferate", "mention", "mentions", "cheap", "expensive", "foundations", "everything", "others", "another", "continue",
  ...KEYWORDS,
];
const VOCABULARY_SET = new Set(VOCABULARY);
const levenshtein = (a: string, b: string): number => {
  // letters apart, a swap of two neighbouring letters ("creatuers") counting as one slip
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
};

/** A set named with a spelling slip ("foundatons", "kaladesch"): a word of the question that is nearly the one word of a set's name. */
export function fuzzySet(question: string): (typeof CARD_SETS)[number] | undefined {
  let best: { set: (typeof CARD_SETS)[number]; d: number } | undefined;
  for (const raw of question.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 8) continue;
    for (const s of CARD_SETS) {
      const name = s.name.toLowerCase();
      if (name.includes(" ") || name[0] !== raw[0] || Math.abs(name.length - raw.length) > 2) continue;
      const d = levenshtein(raw, name);
      if (d > 0 && d <= (raw.length <= 9 ? 1 : 2) && (!best || d < best.d || (d === best.d && s.year > best.set.year))) best = { set: s, d };
    }
  }
  return best?.set;
}

/** The question with its misspelled card words put right (only words of the vocabulary above, and only when they are close and start the same way). */
export function fixTypos(question: string): string {
  // the small words people mistype most (the longer card words are matched against the vocabulary below)
  const slips: Record<string, string> = { wich: "which", whcih: "which", whihc: "which", waht: "what", whta: "what", wat: "what", teh: "the", shwo: "show", gimme: "give me", lemme: "let me", sets: "sets", standrd: "standard", standar: "standard", legl: "legal", legall: "legal" };
  question = question.replace(/\b[A-Za-z]{3,8}\b/g, (w) => slips[w.toLowerCase()] ?? w);
  return question.replace(/[A-Za-z]{7,}/g, (word) => {
    const w = word.toLowerCase();
    if (VOCABULARY_SET.has(w)) return word;
    let best: string | undefined;
    let bestD = Infinity;
    for (const v of VOCABULARY) {
      if (v[0] !== w[0] || Math.abs(v.length - w.length) > 2) continue;
      const d = levenshtein(w, v);
      if (d < bestD) (best = v, (bestD = d));
    }
    return best && bestD <= (w.length <= 9 ? 1 : 2) ? best : word;
  });
}

export function parseFilters(question: string): CardFilter & { named: string[] } {
  const q = norm(fixTypos(question));
  const f: CardFilter & { named: string[] } = { colors: [], colorless: false, types: [], keywords: [], text: [], standard: false, legendary: false, playable: false, subtypes: [], named: [] };
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
  for (const [re, kind] of SUBTYPES) if (re.test(q)) (f.subtypes.push(kind), f.named.push(kind.toLowerCase() + "s"));
  if (/\b(most expensive|priciest|highest cost|costliest)\b/.test(q)) (f.order = "cost_desc", f.named.push("most expensive first"));
  else if (/\b(cheapest|lowest cost)\b/.test(q)) (f.order = "cost_asc", f.named.push("cheapest first"));
  else if (/\b(strongest|most powerful|highest power|biggest|largest)\b/.test(q) && !/\bbig (score|dumb)\b/.test(q)) {
    f.order = "power_desc";
    f.named.push("strongest first");
    if (f.types.length === 0) f.types.push("creature");
  }
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
      // a code in capitals ("FDN"), or in small letters when the question says "set" or "in the fdn"
      const written = word === word.toUpperCase() || /\bset\b/i.test(question) || new RegExp(`\\b(in|from|of|within) (the )?${word}\\b`, "i").test(question);
      const s = word.length >= 3 && written && !/^(the|and|for|one|war|all|its|set|can|use|you|are|was|who|how|why)$/i.test(word) ? CARD_SETS.find((x) => x.code === word.toLowerCase()) : undefined;
      if (s) best = s;
    }
  }
  if (!best) best = fuzzySet(question);
  if (best) (f.set = best.code, f.named.push(`from ${best.name}`));
  return f;
}

/** How many separate conditions the question gave. */
export function filterCount(f: CardFilter): number {
  return f.colors.length + Number(f.colorless) + f.types.length + f.keywords.length + f.text.length + Number(f.maxCost !== undefined || f.minCost !== undefined) + Number(Boolean(f.rarity)) + Number(Boolean(f.set)) + Number(f.standard) + Number(f.legendary) + Number(f.playable) + f.subtypes.length + Number(Boolean(f.order));
}

/** Does the question read as a request for a list of cards? */
export function wantsList(question: string): boolean {
  const q = norm(fixTypos(question));
  const noun = /\b(cards?|creatures?|instants?|sorcer(y|ies)|spells|lands?|artifacts?|enchantments?|planeswalkers?|removal|counterspells?|flyers?|fliers?|legends?|tokens?)\b/.test(q) || SUBTYPES.some(([re]) => re.test(q));
  const verb = /^(which|what|show|list|find|give|any|are there|name|suggest|recommend|search|i want|i need|looking for|top)\b|\b(cards?|creatures?) (that|which|with|in|from|for|of)\b|\bare there\b|\bdo you know\b|\b(give|show|list|find|get) (me )?(the |all |some |every )?|\b(can|could|would) you (please )?(give|show|list|find|get)\b/.test(q);
  return noun && verb;
}

/** The conditions in words, for the answer: "white creatures with Flying that are Standard legal". */
export function describeFilter(f: ReturnType<typeof parseFilters>): string {
  const bits = f.named.filter((n, i) => f.named.indexOf(n) === i);
  const types = f.types.length ? f.types.map((t) => t + "s").join(" or ") : "cards";
  return `${types} (${bits.join(", ") || "any"})`;
}
