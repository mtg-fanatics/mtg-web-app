"use client";

import { useEffect } from "react";

/**
 * Keeps the screen awake while `active` (a duel in progress). Where the browser has no Screen Wake Lock this does nothing. The lock is let go whenever the page
 * is hidden, so it is asked for again when the app comes back to the front.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> } }).wakeLock;
    if (!active || !api) return;
    let sentinel: WakeLockSentinel | null = null;
    let gone = false;
    const ask = async () => {
      if (gone || document.visibilityState !== "visible" || sentinel) return;
      try {
        sentinel = await api.request("screen");
        sentinel.addEventListener("release", () => (sentinel = null));
      } catch {
        /* (refused: low battery, or no permission: the screen may dim, nothing else) */
      }
    };
    const onVisible = () => void ask();
    void ask();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
