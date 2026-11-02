import { isSupportedCard } from "@mtg/engine";
import { fetchCardsByIds } from "@/lib/cards";
import { createClient } from "@/lib/supabase/client";

type Color = "W" | "U" | "B" | "R" | "G";
const COLORS: Color[] = ["W", "U", "B", "R", "G"];
const COLOR_WORD: Record<Color, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const BASIC: Record<Color, string> = { W: "plains", U: "island", B: "swamp", R: "mountain", G: "forest" };

interface Candidate {
  id: string;
  type: string;
  colors: string[] | null;
}

const pickOne = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A random sample of cheap cards the game can play: a few pages of the playable cards, each starting at a random place in id order.
 * (It used to count all of them first and page at a random offset: with thousands of playable cards that count timed out the database.
 * Starting at a random id needs no count and no offset, so it stays fast however many cards become playable.)
 */
async function sampleSpells(): Promise<Candidate[]> {
  const supabase = createClient();
  const page = (start: string) =>
    supabase.from("cards").select("id, type, colors").eq("playable", true).in("type", ["creature", "instant", "sorcery"]).lte("cost", 5).gte("id", start).order("id").limit(250);
  const hex = () => Array.from({ length: 3 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const pages = await Promise.all(Array.from({ length: 4 }, () => page(hex())));
  const seen = new Map<string, Candidate>();
  for (const page of pages) {
    if (page.error) throw new Error(page.error.message);
    for (const row of page.data as Candidate[]) seen.set(row.id, row);
  }
  // the stored "playable" flag can lag behind the rules engine, so the engine checks each card too
  const defs = await fetchCardsByIds([...seen.keys()]);
  return [...seen.values()].filter((c) => defs[c.id] && isSupportedCard(defs[c.id]));
}

const RANDOM_NAME = /^Random (.+ deck)$/;
/** Was this deck built by buildRandomDeck? Only those are offered to be kept after a match. */
export const isRandomDeck = (name: string) => RANDOM_NAME.test(name);
/** The name a kept random deck gets: "Random Red/Green deck" becomes "Red/Green deck". */
export const keptDeckName = (name: string) => name.replace(RANDOM_NAME, "$1");

/**
 * A random, legal deck of `size` cards (about 40% basic lands, the rest creatures and spells in one or two colors,
 * at most 3 copies each). Returns one card id per copy, and a name such as "Random Red/Green deck".
 */
export async function buildRandomDeck(size: number): Promise<{ ids: string[]; name: string }> {
  const pool = await sampleSpells();
  const landCount = Math.round(size * 0.4);
  const spellCount = size - landCount;

  for (let attempt = 0; attempt < 30; attempt++) {
    const colors = shuffled(COLORS).slice(0, attempt < 20 ? 2 : 3);
    const fits = pool.filter((c) => (c.colors ?? []).every((x) => colors.includes(x as Color)));
    const creatures = shuffled(fits.filter((c) => c.type === "creature"));
    const others = shuffled(fits.filter((c) => c.type !== "creature"));
    // Roughly two thirds creatures; each distinct card goes in up to 3 times.
    const wantCreatures = Math.round(spellCount * 0.65);
    if (new Set([...creatures, ...others].map((c) => c.id)).size * 3 < spellCount) continue;

    const spells: string[] = [];
    const add = (list: Candidate[], limit: number) => {
      for (const c of list) {
        if (spells.length >= limit) return;
        const copies = Math.min(1 + Math.floor(Math.random() * 3), limit - spells.length);
        for (let i = 0; i < copies; i++) spells.push(c.id);
      }
    };
    add(creatures, wantCreatures);
    add(others, spellCount);
    if (spells.length < spellCount) add(creatures.filter((c) => !spells.includes(c.id)), spellCount);
    if (spells.length < spellCount) continue;

    // Basic lands, split between the colors that the chosen spells actually use.
    const used = colors.filter((c) => pool.some((p) => spells.includes(p.id) && (p.colors ?? []).includes(c)));
    const landColors = used.length ? used : [pickOne(colors)];
    const lands = Array.from({ length: landCount }, (_, i) => BASIC[landColors[i % landColors.length]]);
    return { ids: shuffled([...spells, ...lands]), name: `Random ${landColors.map((c) => COLOR_WORD[c]).join("/")} deck` };
  }
  throw new Error("Could not build a random deck. Try again.");
}
