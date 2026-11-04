"use client";

import { useLayoutEffect, useRef } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.7;
/** The contents only grow when they can get this much bigger. */
const GROW = 0.04;
/** While the sizes keep changing, the board is refitted at most this often (ms). */
const MIN_GAP = 140;
/** One fit looks at the height of the board at most this many times (each look is a whole layout) before it goes on in the next frame. */
const LOOKS = 4;

/**
 * Uses all of the space it has, without scrolling: the contents are sized to the largest size that still fits.
 * With few cards they grow to fill the space; with many they shrink (never below half) until everything is on screen.
 */
export default function FitToHeight({
  children,
  className = "",
  innerClassName = "flex flex-col gap-1",
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  /** The smallest the contents may get (0.5 = half size). */
  minZoom?: number;
  /** The biggest: 1 means "never larger than normal", only shrink to fit. */
  maxZoom?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const refit = useRef<() => void>(null);
  const counted = useRef(0);

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    let frame = 0;
    let current = 1;
    // What the last fit found: the contents were this tall in this much room, at a size that fits and one step more would not.
    let settledHeight = -1;
    let settledRoom = -1;
    // The height the contents take on screen at a given zoom.
    const heightAt = (zoom: number) => {
      content.style.zoom = String(zoom);
      return content.getBoundingClientRect().height;
    };
    const fit = () => {
      const pad = getComputedStyle(box);
      const room = box.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom);
      if (room <= 0) return;
      // Most of the time nothing needed to change: the size in use still fits, and the next size worth moving to (GROW bigger: smaller
      // gains are not worth the cards jumping about) would not. Each look at the height is a whole layout of the board, so that is
      // settled with as few as possible: one, when simple arithmetic can say it would not fit (a bigger zoom never makes the contents
      // shorter than the same contents scaled up, only taller when rows wrap).
      const now = heightAt(current);
      if (now <= room) {
        if (Math.abs(now - settledHeight) < 0.5 && room === settledRoom) return; // (the same contents in the same room: still settled)
        if (current >= maxZoom - 0.001 || now * ((current + GROW) / current) > room || heightAt(Math.min(maxZoom, current + GROW)) > room) {
          // (the size in use is put back without measuring it again: `now` is what it measured, and the layout this would force is done anyway when the screen is drawn)
          content.style.zoom = String(current);
          settledHeight = now;
          settledRoom = room;
          return;
        }
      }
      // Otherwise the size changes. The contents are about as tall as the zoom is big, so the answer is guessed from the height just measured and corrected
      // from what each look shows. A search keeps the biggest size known to fit and the smallest known not to; when rows wrap differently the guesses miss,
      // and every miss is a layout of the whole board, so one call makes at most LOOKS of them, keeps the biggest size known to fit, and carries on in a moment
      // (the board is never left too big, and no single frame pays for a long search).
      const minStep = Math.round(minZoom * 50);
      const maxStep = Math.round(maxZoom * 50);
      let fits = 0; // the biggest step known to fit (0: none yet)
      let fitsHeight = 0;
      let tooBig = maxStep + 1; // the smallest step known not to fit
      const note = (st: number, h: number) => {
        if (h <= room) {
          if (st > fits) {
            fits = st;
            fitsHeight = h;
          }
        } else if (st < tooBig) tooBig = st;
      };
      note(Math.round(current * 50), now);
      let at = Math.round(current * 50);
      let seen = now;
      let looks = 0;
      while (tooBig - fits > 1 && looks < LOOKS) {
        const lowest = Math.max(fits + 1, minStep);
        let guess = Math.floor((at * room) / seen + 1e-6);
        // (a guess outside what is still open falls back to the middle of it)
        if (guess < lowest || guess >= tooBig) guess = Math.floor((Math.max(fits, minStep - 1) + tooBig) / 2);
        guess = Math.min(Math.max(guess, lowest), tooBig - 1);
        if (guess < minStep) break;
        const h = heightAt(guess / 50);
        looks++;
        note(guess, h);
        at = guess;
        seen = h;
        if (fits === 0 && guess <= minStep) break; // nothing smaller is allowed
      }
      const unfinished = tooBig - fits > 1 && fits >= minStep;
      const step = fits >= minStep ? fits : minStep;
      const height = fits >= minStep ? fitsHeight : heightAt(minStep / 50);
      if (unfinished) window.setTimeout(() => later(), 0);
      // Only a real change is written back, so the size observers below do not wake themselves up again.
      const next = now <= room && Math.abs(step / 50 - current) < GROW ? current : step / 50;
      // the height at the size chosen: it is already known when that is the last size looked at
      if (next === step / 50) {
        current = next;
        content.style.zoom = String(current);
        settledHeight = height;
      } else {
        current = next;
        settledHeight = heightAt(current);
      }
      settledRoom = unfinished ? -1 : room; // (an unfinished search must not be taken for a settled board)
    };
    // The observers wake this up on every frame in which the room or the contents change size (a panel that slides open, a label that appears): each fit
    // costs two to five layouts of the whole board, so while the sizes keep changing it runs at most once every MIN_GAP ms, and once more when they settle.
    let last = 0;
    let timer = 0;
    const run = () => {
      last = performance.now();
      fit();
    };
    const later = () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      const wait = last + MIN_GAP - performance.now();
      if (wait <= 0) frame = requestAnimationFrame(run);
      else timer = window.setTimeout(() => (frame = requestAnimationFrame(run)), wait);
    };
    counted.current = content.querySelectorAll("[data-card-iid]").length;
    fit();
    refit.current = fit;
    const watch = new ResizeObserver(later);
    watch.observe(box);
    watch.observe(content);
    return () => {
      refit.current = null;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      watch.disconnect();
    };
  }, [minZoom, maxZoom]);

  // A card that comes or goes is fitted before the screen is drawn, so the animations that follow it find everything where it will stay (the
  // observers above only notice a frame later, and the layout they ask for is then done twice). Counting the cards costs no layout. (Only cards are
  // counted: the labels, hints and chips that come and go in combat do not change how many rows fit, and if they do change the size the observers above
  // still notice it. Counting every element refitted the whole board, several layouts each time, whenever a label appeared.)
  useLayoutEffect(() => {
    const count = inner.current?.querySelectorAll("[data-card-iid]").length ?? 0;
    if (count === counted.current) return;
    counted.current = count;
    refit.current?.();
  });

  return (
    <div ref={outer} className={`min-h-0 min-w-0 overflow-hidden ${className}`}>
      <div ref={inner} className={innerClassName}>
        {children}
      </div>
    </div>
  );
}
