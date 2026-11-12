"use client";

import { useEffect } from "react";

const MODAL = '[role="dialog"][aria-modal="true"], [role="alertdialog"]';
const shown = (e: Element) => {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/**
 * The Back button of the installed app. An installed app has no browser chrome, so the Android Back button and the iPhone edge swipe are the only way out of a
 * pop-up, and one press must close the pop-up on top, not leave the page. While any window (a dialog, a sheet, the card shown big) is open there is one extra
 * history entry; Back uses it up and the topmost window is closed as if Escape had been pressed. A window that closes by itself gives the entry back.
 * During a duel (the play screen sets data-duel on the page) Back with nothing open opens the duel menu instead of walking out of the match.
 */
export default function BackGuard() {
  useEffect(() => {
    let pushedAt: string | null = null; // the address the extra entry was made on (null: there is none)
    let ignore = 0; // pop events that are our own doing

    const push = () => {
      history.pushState({ ...(history.state ?? {}), __ink: Date.now() }, "", location.href);
    };
    const modals = () => [...document.querySelectorAll(MODAL)].filter(shown);

    let settle = 0;
    // The page itself is moving on (the match began: the table's window closes as the match screen opens). The window's extra entry is left alone then: the
    // navigation can take longer than the wait below on a phone, and undoing the entry before it lands would send the player straight back to the lobby.
    let navUntil = 0;
    const moving = () => {
      navUntil = Date.now() + 20000;
      window.clearTimeout(settle);
      pushedAt = null;
    };
    const sync = () => {
      if (Date.now() < navUntil) return;
      const any = modals().length > 0;
      if (any) {
        window.clearTimeout(settle);
        if (pushedAt === null) {
          push();
          pushedAt = location.pathname + location.search;
        }
      } else if (pushedAt !== null) {
        // A window that is gone may have gone because the page is being left (a button in it navigates). The navigation needs a moment to show in the address, and
        // undoing the entry before that would undo the navigation, so look again a little later.
        window.clearTimeout(settle);
        settle = window.setTimeout(() => {
          if (pushedAt === null || modals().length > 0) return;
          const same = pushedAt === location.pathname + location.search;
          pushedAt = null;
          if (same && history.state?.__ink) {
            ignore++;
            history.back();
          }
        }, 400);
      }
    };

    const closeTop = () => {
      const list = modals();
      const top = list[list.length - 1] as HTMLElement | undefined;
      if (!top) return;
      const target = (document.activeElement as HTMLElement | null) ?? document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      window.setTimeout(() => {
        if (!top.isConnected || !shown(top)) return;
        // it did not listen for Escape: its own close or cancel button, else the backdrop
        const close = top.querySelector<HTMLElement>('[aria-label^="Close" i], [aria-label^="Cancel" i], [data-close]');
        if (close) close.click();
        else top.click();
      }, 120);
    };

    const onPop = () => {
      if (ignore > 0) {
        ignore--;
        return;
      }
      if (pushedAt !== null) {
        pushedAt = null; // (the browser has used the extra entry up)
        closeTop();
        return;
      }
      if (document.documentElement.dataset.duel) {
        push(); // stay on the match
        window.dispatchEvent(new Event("ink:duel-back"));
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", onPop);
    window.addEventListener("ink:navigating", moving);
    return () => {
      observer.disconnect();
      window.clearTimeout(settle);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("ink:navigating", moving);
    };
  }, []);
  return null;
}
