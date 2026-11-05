"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// The installed app already has the whole screen (or its own window with no browser bars), so the page's own full screen is only for a browser tab.
const installed = () => typeof window !== "undefined" && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches);
const supported = () => typeof document !== "undefined" && document.fullscreenEnabled === true && !installed();
const enter = () =>
  document.documentElement.requestFullscreen({ navigationUI: "hide" }).then(() => {
    // A phone in full screen can also be held to portrait (the battle is laid out for it); browsers that cannot just carry on.
    if (matchMedia("(hover: none) and (pointer: coarse)").matches) void (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("portrait")?.catch(() => undefined);
  });

/**
 * Takes the page full screen while a battle is on, on any screen size, and leaves it when the player goes elsewhere.
 * Browsers only allow it right after a click or key press, so it is tried at once (the click that started the match counts)
 * and, if the browser says no, on the first click or key press after that. Pressing Esc leaves full screen for good: it is
 * not forced back, but `useFullscreen` gives a button to go in again.
 */
export function useBattleFullscreen(active: boolean): void {
  const leftByPlayer = useRef(false);
  useEffect(() => {
    if (!active || !supported()) return;
    const retry = () => {
      if (!document.fullscreenElement && !leftByPlayer.current) void enter().catch(() => undefined);
    };
    const onChange = () => {
      if (!document.fullscreenElement) leftByPlayer.current = true;
    };
    document.addEventListener("fullscreenchange", onChange);
    const later = () => {
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
    };
    if (!document.fullscreenElement) {
      // only ask while the browser counts a recent click or key press (else it refuses, and logs it): otherwise wait for the next one
      if (navigator.userActivation?.isActive === false) later();
      else enter().catch(later);
    }
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      if (document.fullscreenElement && !matchMedia("(hover: none) and (pointer: coarse)").matches) void document.exitFullscreen().catch(() => undefined);
    };
  }, [active]);
}

/** Is the page full screen right now, and a way to switch (for a button). `available` is false where the browser can't do it. */
export function useFullscreen(): { on: boolean; available: boolean; toggle: () => void } {
  const on = useSyncExternalStore(
    (callback) => {
      document.addEventListener("fullscreenchange", callback);
      return () => document.removeEventListener("fullscreenchange", callback);
    },
    () => document.fullscreenElement !== null,
    () => false,
  );
  const available = useSyncExternalStore(
    () => () => undefined,
    supported,
    () => false,
  );
  return {
    on,
    available,
    toggle: () => void (document.fullscreenElement ? document.exitFullscreen() : enter()).catch(() => undefined),
  };
}
