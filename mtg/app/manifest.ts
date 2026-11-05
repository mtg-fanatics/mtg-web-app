import type { MetadataRoute } from "next";

/** The installed app. The colours are the dark leather of the top bar and the page behind it, so a launch never flashes white. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Inkfall",
    short_name: "Inkfall",
    description: "A game of two hands and a table. Write a deck, take a seat, and duel.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any", // (not locked: the player turns the phone as they like)
    theme_color: "#070b19",
    background_color: "#0b1120",
    categories: ["games"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/inkfall-seal.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    // for the richer install sheet: a duel held upright and held sideways
    screenshots: [
      { src: "/screenshots/duel-portrait.webp", sizes: "780x1688", type: "image/webp", form_factor: "narrow", label: "A duel, held upright" },
      { src: "/screenshots/duel-landscape.webp", sizes: "1688x780", type: "image/webp", form_factor: "wide", label: "A duel, held sideways" },
    ],
  };
}
