"use client";

import { useEffect } from "react";
import { applyPerfClass } from "./play/perfTier";

/**
 * A phone gets the cheaper way of drawing everywhere, not only in a duel (flat paper instead of layered grain, no big filters), and the page stops its decorative motion
 * while the app is hidden (a phone keeps an installed app alive in the background; nothing should be animating there).
 */
export default function PhoneTier() {
  useEffect(() => {
    if (matchMedia("(hover: none) and (pointer: coarse)").matches) applyPerfClass();
    const root = document.documentElement;
    const sync = () => {
      if (document.visibilityState === "hidden") root.dataset.hidden = "1";
      else delete root.dataset.hidden;
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return null;
}
