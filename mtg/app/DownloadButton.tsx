"use client";

import { useState, useSyncExternalStore } from "react";
import { isIosSafari, isStandalone, useInstall } from "@/lib/install";

/**
 * "Download the app" on the front room. Where the browser can install Inkfall (Chrome, Edge, Brave, Android) it does so with one press;
 * anywhere else (iPhone, Safari, Firefox) the button says how, in a line. Hidden once the app is installed and running as an app.
 */
export default function DownloadButton() {
  const { canInstall, install } = useInstall();
  const standalone = useSyncExternalStore(() => () => {}, () => isStandalone(), () => true);
  const ios = useSyncExternalStore(() => () => {}, () => isIosSafari(), () => false);
  const [help, setHelp] = useState(false);
  if (standalone) return null;
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
        Download the app
      </button>
      {help && !canInstall && (
        <p role="note" className="max-w-xs rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-center text-sm leading-snug text-[#e8dcc0]">
          {ios
            ? "Tap Share, then Add to Home Screen."
            : "Open the browser menu and choose Install Inkfall (or Add to Home screen). In Chrome, Edge and Brave there is also an install icon at the right of the address bar."}
        </p>
      )}
    </div>
  );
}
