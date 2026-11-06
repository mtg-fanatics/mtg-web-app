"use client";

import { useState, useSyncExternalStore } from "react";
import { isIosSafari, isStandalone, useInstall } from "@/lib/install";

type Device = "iphone" | "ipad" | "android" | "computer";

/** What the player is on, from the browser itself. */
function detectDevice(): Device {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ipad";
  if (/Android/i.test(ua)) return "android";
  return "computer";
}

const NAMES: Record<Device, string> = { iphone: "iPhone", ipad: "iPad", android: "phone", computer: "computer" };

/**
 * "Install on this phone/computer" on the front room. The browser's own install prompt is opened with one press where it exists
 * (Chrome, Edge, Brave, Android). iPhone and iPad have no such prompt, so there it says exactly where to tap. Hidden once installed.
 */
export default function InstallButton() {
  const { canInstall, install } = useInstall();
  const standalone = useSyncExternalStore(() => () => {}, () => isStandalone(), () => true);
  const device = useSyncExternalStore(() => () => {}, () => detectDevice(), () => "computer" as Device);
  const safari = useSyncExternalStore(() => () => {}, () => isIosSafari(), () => false);
  const [help, setHelp] = useState(false);
  if (standalone) return null;

  const apple = device === "iphone" || device === "ipad";
  const note = apple
    ? safari
      ? "Tap the Share button, then “Add to Home Screen”."
      : "Open this page in Safari, tap Share, then “Add to Home Screen”."
    : device === "android"
      ? "Open the browser menu (⋮) and choose “Install app” or “Add to Home screen”."
      : (navigator as Navigator & { brave?: unknown }).brave
        ? "In Brave: open the menu (☰), choose “Save and share”, then “Install Inkfall…”. If it is not there yet, wait a few seconds on this page and open the menu again."
        : "Use the install icon at the right of the address bar, or the browser menu (Cast, save and share, then “Install Inkfall”).";

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        className="hero-btn"
        onClick={() => (canInstall ? void install() : setHelp((h) => !h))}
        aria-expanded={canInstall ? undefined : help}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M4 20h16" />
        </svg>
        Install on this {NAMES[device]}
      </button>
      {help && !canInstall && (
        <p role="note" className="max-w-xs rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-center text-sm leading-snug text-[#e8dcc0]">
          {note}
        </p>
      )}
    </div>
  );
}
