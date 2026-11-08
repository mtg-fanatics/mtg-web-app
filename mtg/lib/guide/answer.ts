import { CARD_SETS } from "@/lib/sets";
import type { CardSet } from "@/lib/sets";
import { helpFor } from "@/app/play/glossary";
import { basicHelp } from "./rules";
import { describeFilter, filterCount, parseFilters, wantsList } from "./filters";
import { explainText, identify, NOT_GAME } from "./image";
import type { CardFilter } from "./filters";

// The Scribe: answers questions about cards, sets and rules from what the game itself knows (the card database, the set list and the
// rules glossary). No outside AI service: it reads the question, works out what is being asked and looks it up, so it is free and
// never makes anything up. Pure apart from `source`, which fetches cards, so it can be tested without a database.

export interface GuideCard {
  id: string;
  name: string;
  type: string;
  type_line: string | null;
  mana_cost: string | null;
  oracle_text: string | null;
  rarity: string | null;
  playable: boolean;
  printings: string[] | null;
  standard_legal: boolean | null;
  image_path: string | null;
  scryfall_id: string | null;
}

export interface CardSource {
  /** Cards whose name contains every one of these words (any case), shortest names first, at most `limit`. */
  byWords(words: string[], limit: number): Promise<GuideCard[]>;
  /** The cards that fit the filters (the first `limit` by name) and how many there are in all. */
  search(filter: CardFilter, limit: number, offset?: number): Promise<{ cards: GuideCard[]; total: number }>;
  /** The official rulings written for a card (Scryfall), as plain sentences; empty when there are none or they can't be reached. */
  rulings(card: GuideCard): Promise<string[]>;
}

export interface Reply {
  text: string;
  /** A card to show beside the answer. */
  card?: GuideCard;
  /** Things to ask next (shown as buttons). */
  chips?: string[];
  /** A page to open, as a button ("See them in the library"). */
  link?: { label: string; href: string };
  /** Cards to show as pictures (when the player asked to see them). */
  images?: GuideCard[];
  /** What was asked about a card (so "and what about Shock?" asks the same of Shock). */
  intent?: Intent;
  /** The list this answer showed: what was asked and how far it got, so "more" and "only the red ones" can carry on from it. */
  list?: { filter: ListFilter; offset: number; total: number };
  /** The set (its code) this answer was about, so a follow-up ("those cards of that set") knows what "that" is. */
  set?: string;
  /** The cards this answer listed, so a follow-up ("show me their pictures") knows which ones. */
  listed?: GuideCard[];
}

export type Intent = "describe" | "legal" | "playable" | "printings" | "rulings" | "image";
export type ListFilter = ReturnType<typeof parseFilters>;
const PAGE = 10;

/** A card with only what a picture and a name need (kept small in the saved conversation). */
export const lite = (c: GuideCard): GuideCard => ({ id: c.id, name: c.name, type: c.type, type_line: c.type_line, mana_cost: c.mana_cost, oracle_text: null, rarity: c.rarity, playable: c.playable, printings: null, standard_legal: c.standard_legal, image_path: c.image_path, scryfall_id: c.scryfall_id });

const IMAGE_WORDS = /\b(image|images|picture|pictures|pic|pics|photo|photos|artwork|illustration|looks? like)\b/;

export const STARTERS = ["Is Lightning Bolt Standard legal?", "Which sets are Standard legal?", "What does flashback mean?", "Is KLD Standard legal?"];

// ───────── reading the question ─────────
const FILLER = new Set(
  ("what whats what's who how why when where which does do did doing is are was were can could will would should the a an it its this that these those " +
    "tell me about explain info information show give please i you my we to for with on in at by and or if so then there here any some " +
    "mean means meaning work works working effect effects ability abilities rule rules text say says read reads use used " +
    "standard legal legality rotate rotated rotation format playable play played playing printed print reprint reprinted reprints " +
    "set sets card cards game still currently now today anymore yet also really actually exactly ruling rulings image images picture pictures pic pics photo photos artwork illustration look looks like their theirs them those these each interact interacts interaction combine combo synergy synergize happen happens").split(" "),
);
const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const squash = (s: string) => norm(s).replace(/'/g, "");

/** Plain-English help for the rules words in some text: the everyday words first, then the glossary of rarer abilities. */
const termsIn = (text: string | null | undefined, max: number) => [...new Set([...basicHelp(text ?? "", max), ...helpFor(text, max)])].slice(0, max);

const setName = (s: CardSet) => `${s.name} (${s.code.toUpperCase()})`;
const STANDARD_SETS = CARD_SETS.filter((s) => s.standard);
const BY_CODE = new Map(CARD_SETS.map((s) => [s.code, s]));
const NOT_CODES = new Set(["the", "and", "for", "one", "war", "all", "its", "set", "can", "use", "you", "are", "was", "who", "how", "why"]);

/** The set a question is about: its name ("Lorwyn Eclipsed", the longest wins) or its code written like one ("KLD"). */
function findSet(question: string): CardSet | undefined {
  const q = " " + norm(question) + " ";
  let best: CardSet | undefined;
  for (const s of CARD_SETS) {
    const name = " " + norm(s.name) + " ";
    if (q.includes(name) && (!best || s.name.length > best.name.length)) best = s;
  }
  if (best) return best;
  for (const word of question.split(/[^A-Za-z0-9]+/)) {
    const set = BY_CODE.get(word.toLowerCase());
    if (set && word.length >= 3 && !NOT_CODES.has(word.toLowerCase()) && (word === word.toUpperCase() || /\bset\b/i.test(question))) return set;
  }
  return undefined;
}

/** The words that may be a card's name: the question without its question words at the start and end. Quoted text is taken as it is. */
function nameWords(question: string): string[] {
  const quoted = /["“]([^"”]+)["”]/.exec(question);
  const words = norm(quoted ? quoted[1] : question).split(" ").filter(Boolean);
  let from = 0;
  let to = words.length;
  if (!quoted) {
    while (from < to && (FILLER.has(words[from]) || words[from] === "of")) from++;
    while (to > from && FILLER.has(words[to - 1])) to--;
  }
  return words.slice(from, to);
}

const same = (a: string, b: string) => squash(a) === squash(b);
const frontOf = (name: string) => name.split(" // ")[0];

/** The card a question names: an exact match, or the best match for the words (otherwise the likely ones to ask about). */
/** How many letters apart two spellings are (a typo is one or two). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** A card named with a typo ("lightnig bolt"): the beginnings of the words find the candidates, the spelling picks the closest. */
async function fuzzyCard(words: string[], source: CardSource): Promise<GuideCard | undefined> {
  const phrase = squash(words.join(" "));
  if (phrase.length < 4) return undefined;
  const starts = words.filter((w) => w.length >= 3).map((w) => w.replace(/'/g, "").slice(0, 3));
  if (starts.length === 0) return undefined;
  const near = await source.byWords(starts, 40);
  let best: { card: GuideCard; d: number } | undefined;
  for (const c of near) {
    for (const name of [squash(c.name), squash(frontOf(c.name))]) {
      const d = distance(name, phrase);
      if (!best || d < best.d) best = { card: c, d };
    }
  }
  return best && best.d <= Math.max(2, Math.floor(phrase.length * 0.2)) ? best.card : undefined;
}

async function findCard(words: string[], source: CardSource, fuzzy = true): Promise<{ card?: GuideCard; exact?: boolean; typo?: boolean; maybe: GuideCard[] }> {
  if (words.length === 0) return { maybe: [] };
  const phrase = words.join(" ");
  const tryWords = async (w: string[]) => (w.length === 0 ? [] : source.byWords(w.map((x) => x.replace(/'/g, "")), 8));
  const exact = (cards: GuideCard[]) => cards.find((c) => same(c.name, phrase) || same(frontOf(c.name), phrase));
  let found = await tryWords(words);
  const hit = exact(found);
  if (hit) return { card: hit, exact: true, maybe: [] };
  if (found.length === 0 && fuzzy) {
    const typo = await fuzzyCard(words, source);
    if (typo) return { card: typo, typo: true, maybe: [] };
  }
  // other words crept in: try shorter runs of the words (longest first), but never a single short word
  for (let len = words.length - 1; len >= 2 && found.length === 0; len--) {
    for (let at = 0; at + len <= words.length && found.length === 0; at++) {
      found = await tryWords(words.slice(at, at + len));
      const near = found.find((c) => same(c.name, words.slice(at, at + len).join(" ")) || same(frontOf(c.name), words.slice(at, at + len).join(" ")));
      if (near) return { card: near, exact: true, maybe: [] }; // (the name was in the question with other words round it)
    }
  }
  if (found.length === 0 && words.length > 1) {
    const longest = [...words].sort((a, b) => b.length - a.length)[0];
    if (longest.length >= 6) found = await tryWords([longest]);
  }
  if (found.length === 1) return { card: found[0], maybe: [] };
  const ranked = [...found].sort((a, b) => Number(squash(b.name).startsWith(squash(phrase))) - Number(squash(a.name).startsWith(squash(phrase))) || a.name.length - b.name.length);
  return { maybe: ranked.slice(0, 4) };
}

// ───────── composing answers ─────────
function printedIn(card: GuideCard): CardSet[] {
  return (card.printings ?? []).map((c) => BY_CODE.get(c)).filter((s): s is CardSet => Boolean(s));
}

function legalityOf(card: GuideCard): string {
  if (card.standard_legal === null || card.standard_legal === undefined) return `I don't know yet whether ${card.name} is Standard legal (the card list needs its next update).`;
  if (card.standard_legal) {
    const sets = printedIn(card).filter((s) => s.standard).slice(0, 4);
    return `Yes, ${card.name} is legal in Standard right now${sets.length ? ` (it is in ${sets.map(setName).join(", ")})` : ""}.`;
  }
  return `No, ${card.name} is not legal in Standard right now.`;
}

function printingsOf(card: GuideCard): string {
  const sets = printedIn(card);
  if (sets.length === 0) return `I don't have the sets ${card.name} was printed in.`;
  const shown = sets.slice(0, 8).map(setName).join(", ");
  return `${card.name} was printed in ${sets.length} ${sets.length === 1 ? "set" : "sets"}: ${shown}${sets.length > 8 ? `, and ${sets.length - 8} more` : ""}.`;
}

function describe(card: GuideCard): string {
  const lines = [`${card.name}${card.mana_cost ? `  ${card.mana_cost}` : ""}`, card.type_line ?? card.type];
  if (card.oracle_text) lines.push("", card.oracle_text);
  const help = termsIn(card.oracle_text, 5);
  if (help.length) lines.push("", "In plain words:", ...help.map((h) => `• ${h}`));
  lines.push("", legalityOf(card));
  lines.push(card.playable ? "The game can play this card." : "The game can't play this card yet.");
  return lines.join("\n");
}

function setAnswer(set: CardSet): Reply {
  return set.standard
    ? { text: `Yes, ${setName(set)}, from ${set.year}, is Standard legal right now.`, chips: ["Which sets are Standard legal?", `Legendary cards in ${set.name}`], set: set.code }
    : {
        text: `No, ${setName(set)}, from ${set.year}, is not Standard legal. A few of its cards can still be legal if they were reprinted in a Standard set: search the set in the library and turn on “Standard legal” to see which.`,
        chips: ["Which sets are Standard legal?", `Legendary cards in ${set.name}`],
        set: set.code,
      };
}

// ───────── the one entry point ─────────
/** What the conversation so far was about, so "and is it Standard legal?" can follow "what does Lightning Bolt do?". */
export interface Context {
  card?: GuideCard;
  /** The set the conversation was last about (its code). */
  set?: string;
  /** The cards the last list showed. */
  listed?: GuideCard[];
  /** What the last list was (its filters and how far it got). */
  list?: Reply["list"];
  /** What was last asked about a card. */
  intent?: Intent;
  /** What the Scribe has already said in this conversation, so it never says the same thing twice. */
  previous?: string[];
  /** What the player has already asked (a suggestion that was already asked is not offered again). */
  asked?: string[];
}

/** The answer, unless the Scribe has already said exactly that in this conversation: then it says so and offers something new instead. */
export async function ask(question: string, source: CardSource, context?: Context): Promise<Reply> {
  const reply = await answer(question, source, context);
  const key = (s: string) => squash(s);
  const said = new Set((context?.previous ?? []).map(key));
  const askedBefore = new Set((context?.asked ?? []).map(key));
  const fresh = (chips?: string[]) => chips?.filter((c) => !askedBefore.has(key(c)) && !said.has(key(c)));
  if (!said.has(key(reply.text))) return { ...reply, chips: fresh(reply.chips) };
  const card = reply.card ?? context?.card;
  const front = card ? frontOf(card.name) : "";
  const angles = card ? [`Is ${front} Standard legal?`, `Which sets is ${front} in?`, `How does ${front} work?`, `What does ${front} do?`] : (reply.chips ?? STARTERS);
  const more = fresh(angles) ?? [];
  return {
    text: `I already answered that, a little way up. ${more.length ? (card ? `Something new about ${card.name}?` : "Try one of these instead?") : "Ask me about a different card, set or rule."}`,
    chips: more.slice(0, 3),
  };
}

async function answer(question: string, source: CardSource, context?: Context): Promise<Reply> {
  const q = question.trim();
  if (!q) return { text: "Ask me about a card, a set or a rule." };
  const lower = norm(q);

  if (/^(hi|hello|hey|yo|help|what can you do|who are you)\b/.test(lower)) {
    return { text: "I'm the Scribe. I know the cards, the sets and the rules of this game. Ask me what a card does, what a word like “flashback” means, whether a card or a set is Standard legal, or which sets are in Standard.", chips: STARTERS };
  }

  // which sets are in Standard
  if (/\b(which|what|list|show|name)\b.*\bsets?\b.*\bstandard\b|\bstandard\b.*\b(sets|rotation)\b|\bwhat s in standard\b/.test(lower)) {
    return { text: `Standard right now has ${STANDARD_SETS.length} sets:\n${STANDARD_SETS.map((s) => `• ${s.name} (${s.code.toUpperCase()}), ${s.year}`).join("\n")}`, chips: ["Is Foundations Standard legal?"] };
  }

  const followed = await followUp(q, lower, source, context);
  if (followed) return followed;

  const words = nameWords(q);
  const set = findSet(q);
  const asksLegal = /\b(legal|standard|rotat\w*|allowed|banned)\b/.test(lower);
  const filters = parseFilters(q);
  const wantsImage = IMAGE_WORDS.test(lower) || (/^(show|display)\b/.test(lower) && !wantsList(q));
  const pointsBack = /\b(that|this|the same|those|these|it|its|them)\b/.test(lower);
  // a follow-up about "that set" ("can you give me the legendary cards of that set?"): the set the talk was about
  const contextSet = context?.set ? CARD_SETS.find((s) => s.code === context.set) : undefined;
  if (!filters.set && contextSet && (pointsBack || /\bset\b/.test(lower)) && (wantsList(q) || filterCount(filters) >= 1)) {
    filters.set = contextSet.code;
    filters.named.push(`from ${contextSet.name}`);
  }
  const listing = (wantsList(q) && filterCount(filters) >= 1) || (filterCount(filters) >= 2 && (filters.types.length > 0 || filters.text.length > 0));

  // two cards together ("how does Lightning Bolt work with Shock?")
  if (!listing) {
    const pair = await findPair(words, source);
    if (pair) return interaction(pair[0], pair[1], q, source);
  }

  // "show me their pictures" right after a list: those cards
  if (!listing && wantsImage && context?.listed?.length && /\b(them|those|these|the cards|their|each|all)\b/.test(lower)) {
    return { text: `Here they are (${Math.min(6, context.listed.length)} of the ${context.listed.length} I listed).`, images: context.listed.slice(0, 6) };
  }

  let card = await findCard(words, source, !listing);
  // a follow-up that points back at the card just talked about ("is it Standard legal?", "what are its rulings?")
  if ((!card.card || !card.exact) && context?.card && (/\b(it|its|this|that|this card|that card|the card)\b/.test(lower) || wantsImage) && !listing) card = { card: context.card, exact: true, maybe: [] };

  // a list of cards ("white creatures with flying", "cheap removal", "legendary lands in Foundations")
  if (listing && !card.exact) return listAnswer(filters, source, wantsImage, lower);

  // "is it Standard legal?" right after a set was talked about: the set
  if (!card.card && !set && contextSet && asksLegal && pointsBack) return setAnswer(contextSet);

  // "show me their pictures" after a list
  if (!card.card && wantsImage && context?.listed?.length && /\b(them|those|these|the cards|their|each|all)\b/.test(lower)) {
    return { text: `Here they are (${Math.min(6, context.listed.length)} of the ${context.listed.length} I listed).`, images: context.listed.slice(0, 6) };
  }

  // a set as a whole ("is KLD standard legal?"), unless a card has that exact name
  if (set && (!card.card || !card.exact) && (asksLegal || /\bset\b/.test(lower) || squash(words.join(" ")) === squash(set.name) || words.join(" ") === set.code)) return setAnswer(set);

  // a rules word that is also a card's name ("what does flashback mean?"): the rule, unless the card was asked for
  if (card.card && card.exact && !/\bcard\b/.test(lower) && termsIn(words.join(" "), 1).length > 0) {
    return { text: termsIn(q, 3).join("\n\n"), chips: [`Show the card ${card.card.name}`] };
  }

  if (card.card) {
    const c = card.card;
    const read = card.typo ? `I read that as ${c.name}.\n\n` : "";
    // what is being asked of the card; a bare follow-up ("and Shock?", "what about Shock?") asks what was asked before
    const detected: Intent | null = wantsImage
      ? "image"
      : /\bplayable\b|\bin (this|the) game\b|\bimplemented\b|\bsupported\b|\bcan i (play|use)\b/.test(lower) && !asksLegal
        ? "playable"
        : asksLegal
          ? "legal"
          : /\b(which|what|where)\b.*\b(sets?|printings?|printed|from)\b|\breprint/.test(lower)
            ? "printings"
            : RULINGS_WORDS.test(lower)
              ? "rulings"
              : null;
    const bare = !detected && words.length > 0 && (/^(what|how) about\b|^and\b|^also\b|^same\b/.test(lower) || squash(q) === squash(words.join(" ")));
    const intent: Intent = detected ?? (bare ? context?.intent : undefined) ?? "describe";
    const front = frontOf(c.name);
    const chips = [`Is ${front} Standard legal?`, `Which sets is ${front} in?`, `How does ${front} work?`, `Show me ${front}`];
    const base = { card: c, intent, chips: chips.filter((x) => !(intent === "legal" && x.startsWith("Is ")) && !(intent === "printings" && x.startsWith("Which")) && !(intent === "rulings" && x.startsWith("How")) && !(intent === "image" && x.startsWith("Show"))).slice(0, 3) };
    if (intent === "image") return { images: [c], intent, text: `${read}Here's ${c.name}.`, chips: [`What does ${front} do?`, `Is ${front} Standard legal?`] };
    if (intent === "playable") return { ...base, text: read + (c.playable ? `Yes, the game can play ${c.name}.` : `Not yet: the game can't play ${c.name} yet, so it can't go in a deck.`) };
    if (intent === "legal") return { ...base, text: read + legalityOf(c) };
    if (intent === "printings") return { ...base, text: read + printingsOf(c) };
    if (intent === "rulings") {
      const rulings = rank(await source.rulings(c), q, 3);
      return { ...base, text: read + describe(c) + "\n\n" + (rulings.length ? `Official rulings:\n${rulings.map((r) => `• ${r}`).join("\n")}` : "There are no official rulings for this card.") };
    }
    return { ...base, text: read + describe(c) };
  }

  // a word or effect of the rules ("what does flashback mean?")
  const help = termsIn(q, 4);
  if (help.length) return { text: help.join("\n\n"), chips: ["What does ward mean?", "What does trample do?"] };

  if (set) return setAnswer(set);

  if (card.maybe.length > 0) return { text: "I'm not sure which card you mean. Did you mean one of these?", chips: card.maybe.map((c) => c.name) };
  return { text: "I couldn't find that. Try the card's name, a set code like FDN, or a rules word like “trample”. I can also list cards: “white creatures with flying”.", chips: STARTERS };
}

// ───────── lists, rulings and two cards together ─────────
const RULINGS_WORDS = /\b(how does|how do|how would|how is|work|works|working|ruling|rulings|what happens|trigger|triggers|stack|respond|interact\w*)\b/;

/** The sentences that share the most words with the question first. */
function rank(sentences: string[], question: string, keep: number): string[] {
  const want = new Set(norm(question).split(" ").filter((w) => w.length > 3 && !FILLER.has(w)));
  return sentences
    .map((s, i) => ({ s, i, score: norm(s).split(" ").filter((w) => want.has(w)).length }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, keep)
    .map((x) => x.s);
}

/** Two cards named in one question, split at "with", "and", "vs" and the like: both must be exact names. */
async function findPair(words: string[], source: CardSource): Promise<[GuideCard, GuideCard] | undefined> {
  for (let i = 1; i < words.length - 1; i++) {
    if (!/^(with|and|vs|versus|on|against|plus|when|if)$/.test(words[i])) continue;
    // the question words around the "with" ("how does X work with Y?") are not part of the names
    let left = words.slice(0, i);
    let right = words.slice(i + 1);
    while (left.length > 1 && FILLER.has(left[left.length - 1])) left = left.slice(0, -1);
    while (right.length > 1 && FILLER.has(right[0])) right = right.slice(1);
    const [a, b] = await Promise.all([findCard(left, source, false), findCard(right, source, false)]);
    if (a.exact && b.exact && a.card && b.card && a.card.id !== b.card.id) return [a.card, b.card];
  }
  return undefined;
}

async function interaction(a: GuideCard, b: GuideCard, question: string, source: CardSource): Promise<Reply> {
  const [ra, rb] = await Promise.all([source.rulings(a), source.rulings(b)]);
  const about = (rules: string[], other: GuideCard) => rules.filter((r) => norm(r).includes(norm(frontOf(other.name))));
  const shared = [...about(ra, b), ...about(rb, a)];
  const lines = [`${a.name}${a.mana_cost ? `  ${a.mana_cost}` : ""}\n${a.oracle_text ?? ""}`, `${b.name}${b.mana_cost ? `  ${b.mana_cost}` : ""}\n${b.oracle_text ?? ""}`];
  const general = rank([...ra, ...rb], question, 2);
  const out = [...lines];
  if (shared.length) out.push(`Official rulings about them together:\n${shared.slice(0, 3).map((r) => `• ${r}`).join("\n")}`);
  else if (general.length) out.push(`No ruling covers exactly these two. The closest official rulings:\n${general.map((r) => `• ${r}`).join("\n")}`);
  else out.push("There are no official rulings for either card, so read the two texts above together: when each ability triggers or is cast decides the order, and the last one put on the stack resolves first.");
  return { text: out.join("\n\n"), chips: [`How does ${frontOf(a.name)} work?`, `How does ${frontOf(b.name)} work?`] };
}

/** The library page that shows the same cards, when the library can filter by everything that was asked. */
function libraryLink(f: CardFilter): { label: string; href: string } | undefined {
  if (f.colors.length || f.colorless || f.keywords.length || f.text.length || f.maxCost !== undefined || f.minCost !== undefined || f.rarity || f.types.length > 1) return undefined;
  const p = new URLSearchParams();
  if (f.types[0]) p.set("type", f.types[0]);
  if (f.set) p.set("set", f.set);
  if (f.standard) p.set("standard", "1");
  if (f.legendary) p.set("legendary", "1");
  if (f.playable) p.set("playable", "1");
  return { label: "See them in the library", href: `/cards?${p.toString()}` };
}

const ALL_TYPES = ["creature", "artifact", "enchantment", "planeswalker", "land", "instant", "sorcery"];
const TYPE_LABEL: Record<string, string> = { creature: "Creatures", artifact: "Artifacts", enchantment: "Enchantments", planeswalker: "Planeswalkers", land: "Lands", instant: "Instants", sorcery: "Sorceries" };

async function listAnswer(f: ListFilter, source: CardSource, wantsImage = false, lower = "", offset = 0): Promise<Reply> {
  const name = (c: GuideCard) => `• ${c.name}${c.mana_cost ? `  ${c.mana_cost}` : ""}`;
  const where = f.set ? CARD_SETS.find((s) => s.code === f.set) : undefined;

  // legendary cards "of every kind" ("the legendary cards, artifacts, enchantments etc. of that set"): the cards of each type, one after the other
  if (f.legendary && f.types.length !== 1 && offset === 0) {
    const everyType = f.types.length === 0 || /\betc\b|\band more\b|\bevery\b|\ball\b|\bany\b|\bother\b/.test(lower);
    const types = everyType ? ALL_TYPES : f.types;
    const found = await Promise.all(types.map(async (t) => ({ t, ...(await source.search({ ...f, types: [t] }, 6)) })));
    const kinds = found.filter((x) => x.total > 0);
    if (kinds.length === 0) return { text: `I couldn't find any ${describeFilter(f)}. Try fewer conditions.`, chips: STARTERS, ...(where ? { set: where.code } : {}) };
    const all = kinds.reduce((n, x) => n + x.total, 0);
    const sections = kinds.map((x) => `${TYPE_LABEL[x.t] ?? x.t} (${x.total.toLocaleString()}):\n${x.cards.map(name).join("\n")}${x.total > x.cards.length ? `\n…and ${x.total - x.cards.length} more` : ""}`);
    const listed = kinds.flatMap((x) => x.cards);
    return {
      text: `${all.toLocaleString()} legendary cards${where ? ` in ${where.name} (${where.code.toUpperCase()})` : ""}${f.standard ? " that are Standard legal" : ""}, by kind:\n\n${sections.join("\n\n")}`,
      chips: ["Show me their pictures", `Only the ${kinds[0].t}s`, ...listed.slice(0, 1).map((c) => `What does ${frontOf(c.name)} do?`)],
      link: libraryLink({ ...f, types: [] }),
      listed: listed.map(lite),
      list: { filter: f, offset: -1, total: all }, // (every kind at once: "more" asks for one kind)
      ...(wantsImage ? { images: listed.slice(0, 6).map(lite) } : {}),
      ...(where ? { set: where.code } : {}),
    };
  }

  const { cards, total } = await source.search(f, PAGE, Math.max(0, offset));
  const what = describeFilter(f);
  if (total === 0) return { text: `I couldn't find any ${what}. Try fewer conditions.`, chips: STARTERS, ...(where ? { set: where.code } : {}) };
  if (cards.length === 0) return { text: `That was all of them: ${total.toLocaleString()} ${what}.`, chips: ["Show me their pictures"], set: where?.code, list: { filter: f, offset, total } };
  const head = offset > 0 ? `The next ${cards.length} (${offset + 1}–${offset + cards.length} of ${total.toLocaleString()}) ${what}:` : `${total.toLocaleString()} ${what}${total > cards.length ? `. The first ${cards.length}, by name:` : ":"}`;
  const more = offset + cards.length < total;
  return {
    text: `${head}\n${cards.map(name).join("\n")}`,
    chips: [...(more ? ["Show me more"] : []), "Show me their pictures", ...cards.slice(0, 1).map((c) => `What does ${frontOf(c.name)} do?`)],
    link: libraryLink(f),
    listed: cards.map(lite),
    list: { filter: f, offset, total },
    ...(wantsImage ? { images: cards.slice(0, 6).map(lite) } : {}),
    ...(where ? { set: where.code } : {}),
  };
}

// ───────── follow-up questions ─────────
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const ORDINAL_RE = /\b(?:the |a )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th)|number \d+|no\.? ?\d+|#\d+)(?! (?:strike|main|turn|player|time|step|phase|mulligan))(?: one| card| creature| artifact| enchantment| land)?\b/i;
const MORE_RE = /^(more|next|others?|another|what else|anything else|any more|show more|show me more|continue|keep going)\b|\b(more of them|the rest|the next (?:ones|ten|10|page))\b/;
const REFINE_RE = /^(and|only|just|but|now|also|what about|how about|any|which of (?:them|those|these)|of (?:them|those|these)|among (?:them|those))\b|\b(of them|of those|among them|the ones|those ones|instead)\b/;

/** Narrow a list: what was asked before, with the new conditions on top (a new colour or kind replaces the old one). */
function mergeFilters(base: ListFilter, f: ListFilter): ListFilter {
  const union = <T,>(a: T[], b: T[]) => [...new Set([...a, ...b])];
  return {
    ...base,
    colors: f.colors.length ? f.colors : base.colors,
    colorless: f.colors.length ? false : base.colorless || f.colorless,
    types: f.types.length ? f.types : base.types,
    keywords: union(base.keywords, f.keywords),
    text: union(base.text, f.text),
    maxCost: f.maxCost ?? base.maxCost,
    minCost: f.minCost ?? base.minCost,
    rarity: f.rarity ?? base.rarity,
    set: f.set ?? base.set,
    standard: base.standard || f.standard,
    legendary: base.legendary || f.legendary,
    playable: base.playable || f.playable,
    named: union(base.named, f.named),
  };
}

/** Questions that only make sense after the one before: "the second one", "more", "only the red ones". Null when the question stands on its own. */
async function followUp(q: string, lower: string, source: CardSource, context?: Context): Promise<Reply | null> {
  // "tell me about the second one", "is the last one Standard legal?"
  const ord = context?.listed?.length ? ORDINAL_RE.exec(q) : null;
  if (ord && context?.listed) {
    const word = ord[1].toLowerCase();
    const n = word === "last" ? context.listed.length : (ORDINALS[word] ?? Number(/\d+/.exec(word)?.[0]));
    const item = context.listed[n - 1];
    if (item) {
      const front = frontOf(item.name);
      const rest = q.replace(ORDINAL_RE, front);
      const asked = squash(rest) === squash(front) ? `What does ${front} do?` : rest;
      return answer(asked, source, { ...context, listed: undefined, list: undefined });
    }
    return { text: `I only listed ${context.listed.length}, so there is no number ${n}.` };
  }

  // "more", "what else?": the next page of the last list
  if (context?.list && MORE_RE.test(lower)) {
    if (context.list.offset < 0) return { text: "That was every kind at once. Ask for one kind to see more of it, for example “only the creatures”.", chips: ["Only the creatures"], list: context.list };
    return listAnswer(context.list.filter, source, false, lower, context.list.offset + PAGE);
  }

  // "only the red ones", "and the cheap ones?", "which of them are creatures?": the last list, narrowed
  if (context?.list && REFINE_RE.test(lower)) {
    const f = parseFilters(q);
    if (filterCount(f) >= 1) return listAnswer(mergeFilters(context.list.filter, f), source, false, lower);
  }
  return null;
}

// ───────── a picture sent with (or instead of) a question ─────────
/** `ocr` is the text read from the picture. A card of the game is answered about as if it had been named; anything else is turned away. */
export async function askWithPicture(question: string, ocr: string, source: CardSource, context?: Context): Promise<Reply> {
  const seen = await identify(ocr, source);
  if (!seen.game) return { text: NOT_GAME };
  if (seen.card) {
    const c = seen.card;
    const subject = frontOf(c.name);
    const q = question.trim();
    const asked = q ? (/\b(this|that|it)\b/i.test(q) ? q.replace(/\b(this card|that card|this|that|it)\b/gi, subject) : `${q} ${subject}`) : `What does ${subject} do?`;
    const reply = await ask(asked, source, { ...context, card: c });
    return { ...reply, text: `That's ${c.name}.\n\n${reply.text}`, card: reply.card ?? c };
  }
  const help = explainText(seen.rulesText ?? "");
  return {
    text: help.length
      ? `I can't tell which card that is, but its text mentions:\n\n${help.join("\n\n")}\n\nType the card's name and I'll look it up.`
      : "That looks like game text, but I can't tell which card it is. Type the card's name and I'll look it up.",
    chips: STARTERS,
  };
}
