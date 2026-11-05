"use client";

import { useState, useSyncExternalStore } from "react";
import { iosHintSeen, isIosSafari, isStandalone, markIosHintSeen, useInstall } from "@/lib/install";

/**
 * Two quiet ways to install, shown on the front room only (never in a duel):
 *   - iPhone Safari: a one-time note, "Tap Share, then Add to Home Screen" (the only way there is), gone for good once closed
 *   - Chrome and Android: an "Install Inkfall" button, only while the browser says the app can be installed
 */
export default function InstallHint() {
  const { canInstall, install } = useInstall();
  // (read in the browser only; the server and the first render show nothing)
  const wanted = useSyncExternalStore(
    () => () => {},
    () => isIosSafari() && !isStandalone() && !iosHintSeen(),
    () => false,
  );
  const [closed, setClosed] = useState(false);
  const ios = wanted && !closed;

  if (ios) {
    return (
      <div role="note" className="install-hint">
        <span className="min-w-0 flex-1">
          Install Inkfall: tap <b>Share</b> <span aria-hidden="true">⬆︎</span>, then <b>Add to Home Screen</b>.
        </span>
        <button
          type="button"
          aria-label="Close this hint"
          onClick={() => {
            markIosHintSeen();
            setClosed(true);
          }}
          className="install-hint-x"
        >
          ×
        </button>
      </div>
    );
  }
  if (canInstall) {
    return (
      <div className="install-hint">
        <span className="min-w-0 flex-1">Keep Inkfall on your home screen, full screen.</span>
        <button type="button" className="install-hint-go" onClick={() => void install()}>
          Install Inkfall
        </button>
      </div>
    );
  }
  return null;
}
