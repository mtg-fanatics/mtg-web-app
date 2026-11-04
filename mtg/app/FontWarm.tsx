"use client";

import { useEffect } from "react";

/**
 * The mana symbols are a font that the browser fetches and decodes the first time one is drawn, which is when a match opens: that is the busiest moment of the whole
 * game, and the font arrives in the middle of it and makes every symbol on the screen lay out again. Asked for here, a moment after the front room has settled, it is
 * already in memory by then.
 */
export default function FontWarm() {
  useEffect(() => {
    const ask = () => void document.fonts?.load('16px "Mana"', "\ue600\ue601").catch(() => undefined);
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = idle ? idle(ask, { timeout: 2500 }) : window.setTimeout(ask, 1200);
    return () => {
      if (!idle) window.clearTimeout(id);
    };
  }, []);
  return null;
}
