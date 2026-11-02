"use client";

// Inkfall has no moving wallpaper: the page is the desk (a flat, grained brown set in inkfall.css on the body).
// Your own licensed art goes in later: put a picture in mtg/public/backgrounds/ and point --app-background-image at it
// (globals.css) or put it on the home page here. These exports stay so the pages that ask for a wallpaper still work.

let holds = 0;
/** Kept for the pop-ups that used to freeze the wallpaper: there is nothing to freeze, so this only counts. */
export function holdWallpaper() {
  holds++;
  return () => {
    holds--;
  };
}

export default function LiveWallpaper({ name = "home" }: { name?: string }) {
  void name;
  void holds;
  return null;
}
