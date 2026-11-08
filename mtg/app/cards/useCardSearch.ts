"use client";

import { useEffect, useRef, useState } from "react";
import type { CardDef } from "@mtg/engine";
import { searchCards } from "@/lib/cards";
import { CARDS_PAGE_SIZE, cardImageUrl } from "@/lib/cards";
import { preloadImage, remember } from "@/lib/prefetch";
import type { CardSearch } from "@/lib/cards";

export interface CardSearchResult {
  key: string;
  cards: CardDef[];
  total: number;
  error?: string;
}

const cachedSearch = (search: CardSearch) => remember(`cards:${JSON.stringify(search)}`, () => searchCards(search), 60_000);

/** A page of results, from the cache when it is fresh (the album fetches the neighbouring pages with this before a page turns). */
export const loadCardPage = (search: CardSearch) => cachedSearch(search);

/** Fetches a page of results ahead of time (the next page, or the one a pager button points at). */
export function prefetchCardPage(search: CardSearch): Promise<void> {
  return cachedSearch(search).then(
    (r) => r.cards.slice(0, 12).forEach((def) => def.image && preloadImage(cardImageUrl(def.image))),
    () => undefined,
  );
}

/** Debounced, paged card search against the database. `loading` is true while results are stale. */
export function useCardSearch(search: CardSearch) {
  const { query, type, playableOnly, set, standardOnly, page } = search;
  const colors = search.colors?.join("") ?? ""; // a string, so a new array with the same colors doesn't search again
  const [result, setResult] = useState<CardSearchResult | null>(null);
  const key = JSON.stringify({ query, type, playableOnly, colors, set, standardOnly, page });
  const lastQuery = useRef(query);

  useEffect(() => {
    let cancelled = false;
    // Small delay so typing doesn't fire a request per keystroke; changing the page or a filter needs none.
    const typing = lastQuery.current !== query;
    lastQuery.current = query;
    const timer = setTimeout(() => {
      cachedSearch({ query, type, playableOnly, colors: [...colors], set, standardOnly, page })
        .then((r) => {
          if (cancelled) return;
          setResult({ key, ...r });
          if ((page + 1) * CARDS_PAGE_SIZE < r.total) void prefetchCardPage({ query, type, playableOnly, colors: [...colors], set, standardOnly, page: page + 1 }); // the likely next click
        })
        .catch((e: Error) => !cancelled && setResult({ key, cards: [], total: 0, error: e.message }));
    }, typing ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, query, type, playableOnly, colors, set, standardOnly, page]);

  return { result, loading: result?.key !== key };
}
