// Keeps what never changes on the device, so a return visit does not wait for the network.
//   - card pictures (Scryfall and our own storage): kept until the cache is full
//   - the app's built scripts and styles (/_next/static, named by content): kept for good
//   - the card catalogue and the official decks from the database: fresh for 30 minutes (which cards the game can play changes as the rules engine learns more cards)
// Pages themselves, your own decks, matches and logins are never touched here.

const VERSION = "v4"; // changing this makes every browser drop what an older version kept
const IMAGES = `mtg-images-${VERSION}`;
const STATIC = `mtg-static-${VERSION}`;
const DATA = `mtg-data-${VERSION}`;
const MAX_IMAGES = 900;
const DATA_FRESH_MS = 30 * 60 * 1000;

// A new version waits until the page says so (the "A new edition is ready" button): it must never take over in the middle of a duel.
// The first install has nothing to wait for and starts at once.
self.addEventListener("install", () => {});
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("mtg-") && ![IMAGES, STATIC, DATA].includes(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

const isCardImage = (url) =>
  url.hostname === "cards.scryfall.io" || (url.pathname.startsWith("/storage/v1/object/public/card-art/") && url.hostname.endsWith(".supabase.co"));

// Public catalogue only: every card, and the official decks (never the ones you own).
const isCatalogue = (url) =>
  url.hostname.endsWith(".supabase.co") &&
  (url.pathname === "/rest/v1/cards" || (url.pathname === "/rest/v1/decks" && url.searchParams.get("official") === "eq.true"));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // A page that cannot be fetched: the themed "ink has run dry" page. The network always comes first (pages, sign-in and the game are never kept here).
  if (req.mode === "navigate" && url.origin === self.location.origin) return event.respondWith(fetch(req).catch(() => offlinePage()));

  if (req.destination === "image" && isCardImage(url)) return event.respondWith(cardImage(req));
  // our own icons and fonts never change under the same name
  if (url.origin === self.location.origin && (url.pathname.startsWith("/icons/") || url.pathname === "/inkfall-seal.svg" || /\.(woff2?|ttf)$/.test(url.pathname))) return event.respondWith(cacheFirst(STATIC, req));
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) return event.respondWith(cacheFirst(STATIC, req));
  if (isCatalogue(url)) return event.respondWith(freshData(req));
});

async function cacheFirst(name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) void cache.put(req, res.clone());
  return res;
}

/** A card picture: the saved copy at once, otherwise fetched (as a readable response, so it is cheap to store) and saved. */
async function cardImage(req) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  let res;
  try {
    res = await fetch(req.url, { mode: "cors", credentials: "omit" });
  } catch {
    return fetch(req); // not readable cross-origin: show it, just don't keep it
  }
  if (res.ok) {
    void cache.put(req.url, res.clone()).then(() => trim(cache));
  }
  return res;
}

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(key); // oldest first
  } finally {
    trimming = false;
  }
}

/** Database reads that hardly change: the saved copy while it is under 12 hours old, else the network (the saved copy if offline). */
async function freshData(req) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(req.url);
  const age = hit ? Date.now() - Number(hit.headers.get("x-cached-at") || 0) : Infinity;
  if (hit && age < DATA_FRESH_MS) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set("x-cached-at", String(Date.now()));
      // A page of results comes back as 206 (a range), which the cache refuses to store: keep it as a 200, the headers (with the total count) stay.
      const copy = new Response(await res.clone().blob(), { status: 200, headers });
      void cache.put(req.url, copy).catch(() => {});
    }
    return res;
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
}


/** What shows when the page cannot be loaded and there is no connection: no scripts, nothing to fetch, the look of the book. */
function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#070b19"><title>Inkfall</title>
<style>
html,body{margin:0;height:100%;background:#0b1120;color:#e8dcc0;font-family:Georgia,'Times New Roman',serif}
body{display:grid;place-items:center;padding:max(1.5rem,env(safe-area-inset-top)) max(1.5rem,env(safe-area-inset-right)) max(1.5rem,env(safe-area-inset-bottom)) max(1.5rem,env(safe-area-inset-left))}
main{max-width:26rem;text-align:center;padding:2rem 1.5rem;border-radius:.6rem;background:#efe3c2;color:#2a1c10;box-shadow:0 18px 50px rgba(0,0,0,.6)}
svg{width:4.5rem;height:4.5rem}
h1{font-size:1.7rem;margin:.6rem 0 .4rem;letter-spacing:.04em}
p{font-size:1.1rem;line-height:1.45;margin:.4rem 0 1.2rem}
button{min-height:48px;padding:.6rem 1.4rem;font:inherit;font-weight:700;color:#fff;background:#a8322a;border:2px solid #4a120c;border-radius:.4rem}
</style></head><body><main><svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#b3392b" stroke="#4a120c" stroke-width="2" d="M32 3.5c6 0 8.5 3.2 13.5 4.4 5.2 1.2 8.4 4.2 10 9.6 1.2 4.1 4.8 6.9 3.8 12.2-1 5.2-3.3 8.5-4.1 12.6-1 5-4.500 9.2-9.700 11.300-4.400 1.800-7.400 5.500-13.500 5.400-6 0-8.900-3.400-13.200-5.300C14.600 52.200 11.600 48 10.600 43c-.9-4.500-4.800-7.400-3.800-12.400 1-5 4.600-7.700 5.700-12 1.300-5 4.500-8.300 9.600-9.600C26.600 7.900 26 3.500 32 3.500z"/><path fill="#e8dcc0" d="M32 15.500c4.600 6 8.400 10 8.400 14.800a8.400 8.400 0 0 1-16.800 0c0-4.800 3.800-8.800 8.400-14.800z"/></svg>
<h1>The ink has run dry</h1><p>Reconnect to keep playing.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
