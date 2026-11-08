"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardDef } from "@mtg/engine";
import { CARDS_PAGE_SIZE, cardImageUrl } from "@/lib/cards";
import type { CardSearch } from "@/lib/cards";
import { loadCardPage, useCardSearch } from "./useCardSearch";

/** Cards on one page of the album: a 3 x 3 grid. */
export const ALBUM_PAGE_CARDS = 9;
// The server still pages in 36s. One server page is four album pages (two spreads), so the cache, the prefetch and the search do not change.
const PER_SERVER = CARDS_PAGE_SIZE / ALBUM_PAGE_CARDS;

type Filters = Omit<CardSearch, "page">;

/** Resolves when every picture has loaded (or failed), or after `ms`, whichever comes first: a turn never waits longer than that for art. */
export function imagesReady(urls: string[], ms: number): Promise<void> {
  if (urls.length === 0 || typeof Image === "undefined") return Promise.resolve();
  const loads = urls.map(
    (u) =>
      new Promise<void>((done) => {
        const img = new Image();
        img.onload = img.onerror = () => done();
        img.src = u;
      }),
  );
  return Promise.race([Promise.all(loads).then(() => undefined), new Promise<void>((done) => setTimeout(done, ms))]);
}

/**
 * The cards of a card album, by album page (nine cards each), on top of the Library's own search: the current server page comes from `useCardSearch`
 * (debounce, loading flag and errors as before) and the neighbouring ones are fetched ahead of a turn, so a page turning over already has its art.
 */
export function useAlbumPages(filters: Filters, index: number) {
  const serverPage = Math.floor(index / PER_SERVER);
  const { result, loading } = useCardSearch({ ...filters, page: serverPage });
  const colors = filters.colors?.join("") ?? "";
  const fk = JSON.stringify({ q: filters.query, t: filters.type, p: filters.playableOnly, c: colors, s: filters.set, st: filters.standardOnly, l: filters.legendary });
  const cache = useRef(new Map<string, CardDef[]>());
  const fkRef = useRef(fk);
  const [version, setVersion] = useState(0);
  const [total, setTotal] = useState(0);

  if (fkRef.current !== fk) {
    fkRef.current = fk;
    cache.current.clear(); // another search or filter: nothing from before applies
  }

  useEffect(() => {
    if (!result || loading || result.error) return;
    cache.current.set(`${fk}:${serverPage}`, result.cards);
    setTotal(result.total);
    setVersion((v) => v + 1);
  }, [result, loading, fk, serverPage]);

  /** The cards of album page `i`, or null while its server page has not arrived. */
  // (the same array comes back for the same page every time, so a page whose cards have not changed can be left alone)
  const slices = useRef(new WeakMap<CardDef[], Map<number, CardDef[]>>());
  const cardsOf = useCallback(
    (i: number): CardDef[] | null => {
      void version;
      const all = cache.current.get(`${fkRef.current}:${Math.floor(i / PER_SERVER)}`);
      if (!all) return null;
      const from = (i % PER_SERVER) * ALBUM_PAGE_CARDS;
      let byFrom = slices.current.get(all);
      if (!byFrom) slices.current.set(all, (byFrom = new Map()));
      let page = byFrom.get(from);
      if (!page) byFrom.set(from, (page = all.slice(from, from + ALBUM_PAGE_CARDS)));
      return page;
    },
    [version],
  );

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  /** Makes sure these album pages are in memory with their art loaded (art for at most `ms`). */
  const ensure = useCallback(async (pages: number[], ms = 300): Promise<void> => {
    const key = fkRef.current;
    const wanted = [...new Set(pages.filter((p) => p >= 0).map((p) => Math.floor(p / PER_SERVER)))];
    await Promise.all(
      wanted.map(async (sp) => {
        if (cache.current.has(`${key}:${sp}`)) return;
        try {
          const r = await loadCardPage({ ...filtersRef.current, page: sp });
          if (fkRef.current === key) {
            cache.current.set(`${key}:${sp}`, r.cards);
            setVersion((v) => v + 1);
          }
        } catch {
          // a page that cannot be fetched is simply not shown; the turn goes ahead without it
        }
      }),
    );
    const urls = pages.flatMap((p) => {
      const all = cache.current.get(`${key}:${Math.floor(p / PER_SERVER)}`);
      const from = (p % PER_SERVER) * ALBUM_PAGE_CARDS;
      return (all ?? []).slice(from, from + ALBUM_PAGE_CARDS).flatMap((d) => (d.image ? [cardImageUrl(d.image)] : []));
    });
    await imagesReady(urls, ms);
  }, []);

  return { cardsOf, ensure, total, loading, error: result?.error, serverPage, ready: result !== null };
}
