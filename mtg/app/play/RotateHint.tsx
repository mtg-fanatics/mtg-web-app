"use client";

import { useEffect, useState } from "react";
import { useMedia } from "./useMedia";

const KEY = "inkfall.landscape-hint";

/**
 * A phone held upright: a duel is roomier sideways (both fields and the hand fit, and the buttons are under the thumbs), so say so once. It is a small notice that can be
 * closed and never comes back, not a wall: the upright layout is fully playable.
 */
export default function RotateHint() {
  const upright = useMedia("(orientation: portrait) and (max-width: 600px) and (pointer: coarse)");
  const [gone, setGone] = useState(true);
  useEffect(() => {
    try {
      setGone(localStorage.getItem(KEY) === "1");
    } catch {
      setGone(false);
    }
  }, []);
  // it goes by itself after a few seconds (it sat over the other player's name until it was closed)
  useEffect(() => {
    if (!upright || gone) return;
    const t = setTimeout(() => setGone(true), 7000);
    return () => clearTimeout(t);
  }, [upright, gone]);
  if (!upright || gone) return null;
  const close = () => {
    setGone(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* (no storage: it will show again next time) */
    }
  };
  return (
    <div role="status" className="landscape-hint">
      <span aria-hidden="true">📱</span>
      <span className="min-w-0 flex-1">Tip: landscape is roomier.</span>
      <button type="button" onClick={close} aria-label="Close this hint" className="landscape-hint-x">
        ×
      </button>
    </div>
  );
}
