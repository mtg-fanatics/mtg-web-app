"use client";

import { useSyncExternalStore } from "react";

/**
 * Installing the app. Chrome and Android offer an install prompt that the page may keep and show when it likes (beforeinstallprompt); iPhone Safari has no such thing,
 * only Share, then Add to Home Screen, so there the page can only explain. Both are hidden once the app is installed and running as an app, and never shown in a duel.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // (the browser's own mini bar is not shown: the page offers it, quietly, where it fits)
    deferred = e as InstallPromptEvent;
    tell();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    tell();
  });
}

/** Running as the installed app (no browser bars): the display-mode query, or the older iPhone flag. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone or iPad Safari, the one place with no install prompt (other browsers on iOS cannot add the app, and a desktop browser has its own way). */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Whether the browser is ready to install the app now (and the app is not installed yet), and the way to ask. */
export function useInstall(): { canInstall: boolean; install: () => Promise<void> } {
  const ready = useSyncExternalStore(subscribe, () => deferred !== null && !installed, () => false);
  return {
    canInstall: ready && !isStandalone(),
    install: async () => {
      const e = deferred;
      if (!e) return;
      deferred = null; // (a prompt can only be used once)
      tell();
      await e.prompt();
      const choice = await e.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") installed = true;
      tell();
    },
  };
}

const HINT_KEY = "inkfall.ios-install-hint";
export const iosHintSeen = (): boolean => {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true; // (no storage: better silent than shown on every visit)
  }
};
export const markIosHintSeen = (): void => {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* (it may show once more) */
  }
};
