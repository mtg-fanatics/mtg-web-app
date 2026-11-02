import type { Amount, CountSpec } from "../effects.js";
import { SUPPORTED_KEYWORDS } from "../keywords.js";
import type { Keyword } from "../keywords.js";
import type { CardDef } from "../types.js";
import type { Ctx } from "./targets.js";

// Words and phrases every part of the reader shares: numbers, keywords, colors, card types and counts.

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export const toAmount = (word: string): number | "X" | null => (word === "x" ? "X" : toNumber(word));
export const toNumber = (word: string): number | null => (/^\d+$/.test(word) ? Number(word) : (NUMBERS[word] ?? null));

const KEYWORD_SET = new Set<string>(SUPPORTED_KEYWORDS);
export const isKeyword = (word: string): word is Keyword => KEYWORD_SET.has(word);

export const COLOR_OF: Record<string, string> = { black: "B", white: "W", blue: "U", red: "R", green: "G" };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reminder text removed, the card's own name replaced by "~", and everything lower-cased. Lines are kept apart. */
export function normalizeText(def: CardDef): string {
  let text = (def.text ?? "").replace(/\([^)]*\)/g, "");
  // "Thrun, the Last Troll" is "Thrun" in its text; so is "Sharae" in Sharae of Numbing Depths.
  const short = /\bLegendary\b/.test(def.typeLine ?? "") && !def.name.includes(",") ? /^([A-Z][a-z]+) (?:of|the) /.exec(def.name)?.[1] : undefined; // ("Arcanis the Omnipotent" is "Arcanis" in its text)
  for (const name of new Set([def.name, def.name.split(",")[0], ...(short ? [short] : [])])) {
    if (name.length >= 3) text = text.replace(new RegExp(escapeRegex(name), "gi"), "~");
  }
  text = text.replace(/\bthis (creature|permanent|spell|artifact|enchantment|land|aura|equipment|vehicle|card|token|saga)\b/gi, "~").toLowerCase();
  text = text.replace(/(^|, |\. )(?:he|she) (deals|gets|gains|loses|connives|explores|fights|has) /g, "$1~ $2 "); // "When Momo enters, he deals 4 damage to ..."
  text = text.replace(/(^|, |\. )(?:he|she) (connives|explores)(?=\.?\s*$)/gm, "$1~ $2"); // "Whenever Kang attacks, he connives."
  text = text.replace(/ on (?:him|her)(?=\.?\s*$)/gm, " on ~"); // "put a +1/+1 counter on her"
  text = text.replace(/\{([^}]+)\}/g, (_, symbol: string) => `{${symbol.toUpperCase()}}`).replace(/\u2212/g, "-"); // a real minus sign in loyalty costs
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** "the number of goblins you control", "that creature's power", "~'s power": a number worked out when the effect happens. */
export function amountOf(phrase: string, ctx: Ctx): Amount | null {
  let m: RegExpExecArray | null;
  if (phrase === "the excess damage dealt this way") return { count: { kind: "excessDamage" } }; // Razor Rings
  if ((m = /^the number of (.+)$/.exec(phrase))) {
    const c = parseCount(m[1]);
    return c ? { count: c } : null;
  }
  if (phrase === "the greatest mana value among artifacts you control") return { count: { kind: "greatestMV", what: "artifact" } };
  if (phrase === "~'s power" || (phrase === "its power" && ctx.targets.length === 0 && ctx.allowSelf)) return { count: { kind: "selfPower" } };
  if ((phrase === "that creature's power" || phrase === "its power") && ctx.targets.length > 0) return { count: { kind: "targetPower", i: ctx.targets.length - 1 } };
  if (phrase === "that creature's toughness" && ctx.hasOther) return { count: { kind: "otherToughness" } };
  if (phrase === "that creature's power" && ctx.hasOther) return { count: { kind: "otherPower" } };
  return null;
}

/** "for each attacking creature you control": singular phrase to a count. */
export function forEachCount(phrase: string): CountSpec | null {
  if (phrase === "card discarded this way") return { kind: "x" };
  if (phrase === "card you've discarded this turn") return { kind: "discardedThisTurn" };
  const otherTyped = /^other ([a-z]+) you control$/.exec(phrase);
  if (otherTyped && !/^(creature|artifact|land|enchantment)$/.test(otherTyped[1])) return { kind: "permanents", what: "subtype", subtype: otherTyped[1], other: true, scope: "you" };
  const atk = /^(other )?attacking ([a-z]+)$/.exec(phrase);
  if (atk && atk[2] !== "creature") return { kind: "attackers", subtype: atk[2], ...(atk[1] ? { other: true } : {}) };
  if (phrase === "attacking creature") return { kind: "attackers" };
  if (phrase === "creature attacking you") return { kind: "attackingYou" };
  const plural = phrase
    .replace(/^attacking creature you control$/, "attacking creatures you control")
    .replace(/^other creature you control$/, "other creatures you control")
    .replace(/^nontoken creature you control$/, "nontoken creatures you control")
    .replace(/^([a-z]+) you control$/, (all, w: string) => (w === "creature" || w === "artifact" || w === "land" || w === "enchantment" ? `${w}s you control` : `${w}s you control`));
  return parseCount(plural);
}

/** "flying", "flying and lifelink", "flying, first strike and lifelink": every word must be a supported keyword. */
export function keywordList(text: string): Keyword[] | null {
  const words = text.split(/, and |, | and /).map((w) => w.trim());
  return words.length > 0 && words.every(isKeyword) ? (words as Keyword[]) : null;
}

/**
 * Whole spells that ask the player to choose cards. Each is matched as a whole, because a choice needs the game to
 * stop and wait, so these can't be mixed with other effects.
 */
export const NUMBER_WORDS = "two|three|four|five|six|seven";
export const CARD_TYPES = ["creature", "land", "instant", "sorcery", "artifact", "enchantment", "planeswalker"];

/** "the number of creatures you control", "cards in your hand", "forests you control"... */
/** Plural creature-type words to the type: "goblins" -> "goblin", "pegasi" -> "pegasus". */
export const singularType = (w: string) => (({ pegasi: "pegasus", elves: "elf", wolves: "wolf", dwarves: "dwarf", mice: "mouse" } as Record<string, string>)[w] ?? w.replace(/s$/, ""));

export function parseCount(phrase: string): CountSpec | null {
  if (phrase === "cards in your hand") return { kind: "hand" };
  if (phrase === "instant and sorcery cards in your graveyard") return { kind: "graveyard", creaturesOnly: false, spellsOnly: true };
  if (phrase === "attacking creatures you control" || phrase === "attacking creatures") return { kind: "attackers" };
  if (phrase === "nontoken creatures you control") return { kind: "permanents", what: "creature", nontoken: true, scope: "you" };
  if (phrase === "other creatures you control") return { kind: "permanents", what: "creature", other: true, scope: "you" };
  if (phrase === "counters on ~") return { kind: "selfCounters" };
  if (phrase === "opponents you have") return { kind: "opponents" };
  // a creature type: "goblins you control"
  const typed = /^([a-z]+) you control$/.exec(phrase);
  if (typed && !/^(creatures|lands|artifacts|enchantments|plains|islands|swamps|mountains|forests)$/.test(typed[1])) return { kind: "permanents", what: "subtype", subtype: singularType(typed[1]), scope: "you" };
  const inAllYards = /^(creature|sorcery|instant|land|artifact|enchantment) cards in all graveyards$/.exec(phrase);
  if (inAllYards) return { kind: "yardsAll", cardType: inAllYards[1] };
  if (phrase === "cards in your graveyard") return { kind: "graveyard", creaturesOnly: false };
  if (phrase === "creature cards in your graveyard") return { kind: "graveyard", creaturesOnly: true };
  const m = /^(creatures|lands|artifacts|enchantments|plains|islands|swamps|mountains|forests) (you control|your opponents control|on the battlefield)$/.exec(phrase);
  if (!m) return null;
  const scope = m[2] === "you control" ? "you" : m[2] === "on the battlefield" ? "all" : "opponents";
  const landTypes: Record<string, string> = { plains: "Plains", islands: "Island", swamps: "Swamp", mountains: "Mountain", forests: "Forest" };
  if (landTypes[m[1]]) return { kind: "permanents", what: "landType", landType: landTypes[m[1]], scope };
  const what = { creatures: "creature", lands: "land", artifacts: "artifact", enchantments: "enchantment" }[m[1]] as "creature" | "land" | "artifact" | "enchantment";
  return { kind: "permanents", what, scope };
}
