/**
 * The installed app's manifest. It is a route, not a fixed file, because the right window depends on the device that asks:
 *   a computer (laptop or desktop): the app opens full screen, like a game (display "fullscreen"; a browser that cannot do that falls back to the plain app window)
 *   a phone or tablet: the app window with its own status bar (display "standalone"), which keeps the clock and the battery and the safe areas right
 * The browser says which it is in the Sec-CH-UA-Mobile header (and the User-Agent as a second opinion), so the answer is asked for per request and never shared between the two.
 */
const MOBILE = /Android|iPhone|iPad|iPod|Mobile|Tablet/i;

export function GET(request: Request) {
  const hint = request.headers.get("sec-ch-ua-mobile");
  const mobile = hint === "?1" || (hint === null && MOBILE.test(request.headers.get("user-agent") ?? ""));
  const manifest = {
    id: "/",
    name: "Inkfall",
    short_name: "Inkfall",
    description: "A game of two hands and a table. Write a deck, take a seat, and duel.",
    start_url: "/",
    scope: "/",
    display: mobile ? "standalone" : "fullscreen",
    // (tried in this order: the first one the browser can do is used)
    display_override: mobile ? ["standalone"] : ["fullscreen", "standalone"],
    orientation: "any",
    theme_color: "#070b19",
    background_color: "#0b1120",
    categories: ["games"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/inkfall-seal.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    screenshots: [
      { src: "/screenshots/duel-portrait.webp", sizes: "780x1688", type: "image/webp", form_factor: "narrow", label: "A duel, held upright" },
      { src: "/screenshots/duel-landscape.webp", sizes: "1688x780", type: "image/webp", form_factor: "wide", label: "A duel, held sideways" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json",
      vary: "Sec-CH-UA-Mobile, User-Agent",
      "cache-control": "no-cache", // (an installed app looks again, so a change here reaches it)
    },
  });
}
