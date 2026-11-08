import type { CardDef, CardType } from "@mtg/engine";
import { createClient } from "@/lib/supabase/client";

interface CardRow {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  power: number | null;
  toughness: number | null;
  image_path: string | null;
  type_line: string | null;
  mana_cost: string | null;
  colors: string[] | null;
  oracle_text: string | null;
  rarity: string | null;
  playable: boolean;
  scryfall_id: string | null;
  keywords: string[] | null;
}

// The database has ~35k cards: never select them all. PostgREST returns at most 1000 rows anyway.
const COLUMNS = "id, name, type, cost, power, toughness, image_path, type_line, mana_cost, colors, oracle_text, rarity, playable, scryfall_id, keywords";

function rowToDef(row: CardRow): CardDef {
  const def: CardDef = { id: row.id, name: row.name, type: row.type, cost: row.cost, playable: row.playable };
  if (row.power !== null) def.power = row.power;
  if (row.toughness !== null) def.toughness = row.toughness;
  if (row.type === "planeswalker" && row.toughness !== null) def.loyalty = row.toughness; // loyalty is stored in the toughness column
  if (row.image_path) def.image = row.image_path;
  if (row.type_line) def.typeLine = row.type_line;
  if (row.mana_cost) def.manaCost = row.mana_cost;
  if (row.oracle_text) def.text = row.oracle_text;
  if (row.colors?.length) def.colors = row.colors;
  if (row.rarity) def.rarity = row.rarity;
  if (row.scryfall_id) def.scryfallId = row.scryfall_id;
  if (row.keywords?.length) def.keywords = row.keywords.map((k) => k.toLowerCase());
  return def;
}

/** Definitions for specific cards (e.g. the ones in a deck), keyed by id. */
// Cards already fetched in this tab: the deck lists, the profile and the deck pickers all ask for the same cards, so each card is
// downloaded and parsed once, and the chunks of a big deck go out together instead of one after the other.
const known = new Map<string, CardDef>();
const KNOWN_LIMIT = 6000;
const asking = new Map<string, Promise<void>>(); // the same chunk asked twice at once is asked once

export async function fetchCardsByIds(ids: string[]): Promise<Record<string, CardDef>> {
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => !known.has(id));
  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += 200) chunks.push(missing.slice(i, i + 200));
  await Promise.all(
    chunks.map((chunk) => {
      const key = chunk.join(",");
      let pending = asking.get(key);
      if (!pending) {
        pending = (async () => {
          const { data, error } = await createClient().from("cards").select(COLUMNS).in("id", chunk);
          if (error) throw new Error(error.message);
          if (known.size > KNOWN_LIMIT) known.clear();
          for (const row of data as CardRow[]) known.set(row.id, rowToDef(row));
        })().finally(() => asking.delete(key));
        asking.set(key, pending);
      }
      return pending;
    }),
  );
  const out: Record<string, CardDef> = {};
  for (const id of unique) {
    const def = known.get(id);
    if (def) out[id] = def;
  }
  return out;
}

export const CARDS_PAGE_SIZE = 36;

export interface CardSearch {
  query: string;
  type: "all" | CardType;
  playableOnly: boolean;
  colors?: string[]; // only cards a deck of these colors can play: no other color (colorless cards fit any deck)
  set?: string; // only cards printed in this set (its code, e.g. "fdn"); needs supabase/07-card-filters.sql
  standardOnly?: boolean; // only cards legal in Standard today; needs supabase/07-card-filters.sql
  page: number; // 0-based
}

/** One page of search results plus the total number of matches. */
export async function searchCards({ query, type, playableOnly, colors, set, standardOnly, page }: CardSearch): Promise<{ cards: CardDef[]; total: number }> {
  let q = createClient().from("cards").select(COLUMNS, { count: "exact" });
  const text = query.trim().replace(/[%_\\]/g, "\\$&");
  if (text) q = q.ilike("name", `%${text}%`);
  if (type !== "all") q = q.eq("type", type);
  if (playableOnly) q = q.eq("playable", true);
  if (set) q = q.contains("printings", [set]);
  if (standardOnly) q = q.eq("standard_legal", true);
  if (colors?.length) q = q.or(`colors.cd.{${colors.join(",")}},colors.is.null`);
  const from = page * CARDS_PAGE_SIZE;
  const { data, count, error } = await q.order("name").range(from, from + CARDS_PAGE_SIZE - 1);
  if (error) throw new Error((set || standardOnly) && /does not exist/.test(error.message) ? "The set and Standard filters need the database update first (supabase/07-card-filters.sql, then npm run import:cards)." : error.message);
  return { cards: (data as CardRow[]).map(rowToDef), total: count ?? 0 };
}

/** Public URL of a card's art in the "card-art" storage bucket. */
export function cardImageUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/card-art/${path}`;
}

/**
 * High-resolution image hosted by Scryfall (linking to it is allowed):
 * "normal" is 488x680, "large" is 672x936. Null for hand-made cards.
 */
export function cardDetailImageUrl(def: CardDef, size: "normal" | "large" = "normal"): string | null {
  const id = def.scryfallId;
  return id ? `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg` : null;
}
