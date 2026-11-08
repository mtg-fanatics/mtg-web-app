import { helpFor } from "@/app/play/glossary";
import { basicHelp } from "./rules";
import type { CardSource, GuideCard } from "./answer";

// What the Scribe makes of a picture a player sends. The picture is read in the browser (it is never uploaded): the words on it are
// read with OCR, and it counts as part of the game only when those words are a card of the game or the rules text of one.

export const NOT_GAME = "Sorry, cannot answer your question as that image is not part of the game.";

// phrases that appear on cards and in game screens, not in everyday pictures
const GAME_PHRASES = [
  /\btarget (creature|player|opponent|permanent|spell|land|artifact|enchantment)\b/i,
  /\benters (the battlefield|tapped)\b/i,
  /\b(graveyard|library|battlefield|your hand|exile)\b/i,
  /\buntil end of turn\b/i,
  /\b(draw|discard|sacrifice|destroy|exile|scry|surveil|mill) (a|an|two|three|target|each|that|up to)\b/i,
  /\b(flying|trample|haste|vigilance|deathtouch|lifelink|first strike|double strike|menace|reach|hexproof|indestructible|flash|defender|ward|prowess)\b/i,
  /\b(creature|instant|sorcery|enchantment|artifact|planeswalker|legendary|basic land)\b/i,
  /\b(power|toughness|mana|life total|combat damage|counters?)\b/i,
  /\b(tap|untap|cast|spell|stack|priority)\b/i,
  /\bwizards of the coast\b|\b(common|uncommon|rare|mythic)\b.*\b(en|fdn|dft|dsk|blb)\b/i,
  /\{[WUBRGCTX0-9/]+\}/,
];

const clean = (s: string) => s.replace(/[^A-Za-z0-9',\- ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => clean(s).toLowerCase().split(" ").filter((w) => w.length > 3);

/** How much of a card's own words (its name and rules text) are on the picture, 0 to 1. */
function agreement(card: GuideCard, seen: Set<string>): number {
  const own = new Set(words(`${card.name} ${card.oracle_text ?? ""} ${card.type_line ?? ""}`));
  if (own.size === 0) return 0;
  let hit = 0;
  for (const w of own) if (seen.has(w)) hit++;
  return hit / Math.min(own.size, 12); // (a long text only needs a good share of its words)
}

export interface Seen {
  card?: GuideCard;
  /** Rules text was on the picture but no card could be matched. */
  rulesText?: string;
  game: boolean;
}

/** Is the picture a card of the game, or the rules text of an effect, or neither? `ocr` is the text read from it. */
export async function identify(ocr: string, source: CardSource): Promise<Seen> {
  const lines = ocr.split("\n").map(clean).filter((l) => l.length >= 4 && /[A-Za-z]{3}/.test(l));
  const seen = new Set(words(ocr));
  const phrases = GAME_PHRASES.filter((re) => re.test(ocr)).length;

  // 0. a basic land is named on its type line ("Basic Land — Plains"), whatever the name line read as
  const land = /basic (?:snow )?land\W+(plains|island|swamp|mountain|forest)\b/i.exec(ocr);
  if (land) {
    const cards = await source.byWords([land[1].toLowerCase()], 12).catch(() => [] as GuideCard[]);
    const basic = cards.find((c) => c.name.toLowerCase() === land[1].toLowerCase());
    if (basic) return { card: basic, game: true };
  }

  // 1. a card: its name is one of the first lines, and its own words are on the picture too
  let best: { card: GuideCard; score: number } | undefined;
  const tried = new Set<string>();
  for (const line of lines.slice(0, 6)) {
    const ws = line.toLowerCase().split(" ").filter((w) => w.length >= 2);
    for (const run of [ws, ws.slice(0, -1), ws.slice(1), ws.slice(0, 4)]) {
      const key = run.join(" ");
      if (run.length === 0 || key.length < 4 || tried.has(key)) continue;
      tried.add(key);
      let cards: GuideCard[] = [];
      try {
        cards = await source.byWords(run.map((w) => w.replace(/'/g, "")), 6);
      } catch {
        continue;
      }
      for (const card of cards) {
        const name = clean(card.name.split(" // ")[0]).toLowerCase();
        const nameWords = name.split(" ");
        const onPicture = nameWords.filter((w) => w.length < 3 || ocr.toLowerCase().includes(w)).length / nameWords.length;
        if (onPicture < 0.99) continue; // every word of its name must be on the picture
        const score = agreement(card, seen) + (key === name ? 0.5 : 0);
        if (!best || score > best.score) best = { card, score };
      }
    }
    if (best && best.score >= 0.9) break;
  }
  // a name alone (a basic land, a vanilla creature) is enough when it is all the picture shows of the card; otherwise the card's text must agree
  if (best && (best.score >= 0.35 || (!best.card.oracle_text && phrases >= 1))) return { card: best.card, game: true };

  // 2. the rules text of an effect, with no card to go with it
  if (phrases >= 3 || (phrases >= 2 && (helpFor(ocr, 1).length > 0 || basicHelp(ocr, 1).length > 0))) return { rulesText: ocr, game: true };
  // a card whose name could not be read, but with the printed marks of a card (the copyright line, the set code and language)
  if (phrases >= 2 && /wizards of the coast|\b[A-Z0-9]{3}\s*[•*·.+-]\s*EN\b/.test(ocr)) return { rulesText: ocr, game: true };

  return { game: false };
}

/** The effects found in some rules text, in plain words. */
export function explainText(text: string): string[] {
  return [...new Set([...basicHelp(text, 4), ...helpFor(text, 4)])].slice(0, 4);
}
