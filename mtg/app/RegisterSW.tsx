"use client";

import { useEffect, useState } from "react";
import "@/lib/install"; // (starts listening for the browser's install offer on every page, so it is never missed before the Install button is on screen)

/**
 * Starts the service worker (public/sw.js) that keeps card pictures and the card catalogue on this device, and tells the player when a new edition of the app is
 * waiting. The new edition never takes over by itself: the page only changes when the button is pressed (it is the player's moment to choose, not the middle of a duel).
 * Built app only: in `next dev` a service worker would serve stale files.
 */
export default function RegisterSW() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;
    let reloading = false;
    const watch = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const next = r.installing;
        next?.addEventListener("statechange", () => {
          if (next.state === "installed" && navigator.serviceWorker.controller) setWaiting(next);
        });
      });
    };
    navigator.serviceWorker
      .register("/sw.js")
      .then((r) => {
        reg = r;
        watch(r);
      })
      .catch(() => {});
    // the new edition has taken over (the button was pressed): load the page again, once
    const onChange = () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    // a phone keeps an installed app alive for days: look for a new edition whenever it comes back to the front
    const check = () => document.visibilityState === "visible" && void reg?.update().catch(() => {});
    document.addEventListener("visibilitychange", check);
    const hourly = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(hourly);
    };
  }, []);

  if (!waiting || dismissed) return null;
  return (
    <div role="status" className="update-toast">
      <span>A new edition is ready.</span>
      <button type="button" className="update-toast-go" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>
        Reload
      </button>
      <button type="button" className="update-toast-x" aria-label="Close this notice, reload later" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
