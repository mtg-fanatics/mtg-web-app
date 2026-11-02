"use client";

import { useEffect, useMemo, useState } from "react";
import { useAnimationsOn } from "@/lib/motion";
import { DEFAULT_FOCUS, matLayerStyle } from "@/lib/playmat";
import type { MatFocus } from "@/lib/playmat";

// The playmat as a sheet of paper. As its player loses life it tears away from the edges, bite by ragged bite, leaving a worn
// paper rim and the dark table underneath, until at 0 life nothing is left.
//
// The mat picture is drawn once and never changes. The torn-away parts are flat-coloured shapes laid over it, one set for each stage of
// the tear, with their shapes fixed; going from one stage to the next fades the next set in (or the last one out). Only opacity
// moves, so a tear costs next to nothing: animating the shape of the mat itself repaints the whole picture on every frame.

const PER_EDGE = 16; // points along each side of the mat
const TEAR_FROM = 12; // life at which the first tears start
/** The life totals at which the tear takes another bite. */
const STAGES = [11, 9, 7, 5, 4, 3, 2, 1, 0];
const TABLE = "#0b0a0f"; // what shows where the mat has gone

function random(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far the tear has got, from 0 (whole) to 1 (gone), for a life total. */
export const tearOf = (life: number) => Math.min(1, Math.max(0, (TEAR_FROM - life) / TEAR_FROM));

interface Bite {
  /** The tear reaches this point once the mat is this torn (0 to 1): the weak spots go first. */
  starts: number;
  /** How ragged: how much of the way in this point goes before the whole thing goes. */
  reach: number;
}

/** The weak spots and ragged depths all around the mat: the same every time for the same seed, so the tear grows where it began. */
function bites(seed: number): Bite[] {
  const rnd = random(seed);
  const n = PER_EDGE * 4;
  // clumps of weakness: a few bites that start early and tear deep, with calmer stretches between them
  const centers = Array.from({ length: 6 }, () => rnd() * n);
  return Array.from({ length: n }, (_, i) => {
    const near = Math.min(...centers.map((c) => Math.min(Math.abs(i - c), n - Math.abs(i - c))));
    const weak = Math.max(0, 1 - near / 4.5); // 1 at the heart of a weak spot
    return { starts: Math.max(0, 0.7 * (1 - weak) * (0.45 + 0.55 * rnd()) - 0.04), reach: 0.42 + 0.58 * (0.35 + 0.65 * rnd()) * (0.55 + 0.45 * weak) };
  });
}

/** The outline (as polygon points) of a mat torn this much. `shrink` pulls the edge in a little less (the paper rim sticks out past the mat). */
function outline(list: Bite[], tear: number, shrink = 1): string[] {
  return list.map((b, i) => {
    const eaten = Math.max(0, Math.min(1, (tear - b.starts) / (1 - b.starts || 1)));
    // ragged until the very end, when every point runs into the middle and nothing is left
    const finish = Math.pow(tear, 7);
    const depth = 50 * (Math.pow(eaten, 0.85) * b.reach + (1 - b.reach) * finish * eaten) * shrink * (tear >= 1 ? 1.08 : 1); // (past the middle at the very end, so nothing is left)
    const edge = Math.floor(i / PER_EDGE);
    const f = (i % PER_EDGE) / PER_EDGE; // how far along that side
    const wiggle = ((i * 7919) % 13) / 13; // a little sideways jitter, so the torn edge is not a neat staircase
    const along = Math.max(0, Math.min(100, f * 100 + (wiggle - 0.5) * 1.2 * (eaten > 0 ? 1 : 0)));
    switch (edge) {
      case 0:
        return `${along}% ${depth}%`; // top, left to right: the tear goes down
      case 1:
        return `${100 - depth}% ${along}%`; // right, top to bottom: the tear goes left
      case 2:
        return `${100 - along}% ${100 - depth}%`; // bottom, right to left: the tear goes up
      default:
        return `${depth}% ${100 - along}%`; // left, bottom to top: the tear goes right
    }
  });
}

const poly = (points: string[]) => `polygon(${points.join(", ")})`;
/** The points along one side of an outline (and the first point of the next side, so the corners are covered). */
const side = (outline: string[], e: number) => [...outline.slice(e * PER_EDGE, (e + 1) * PER_EDGE), outline[((e + 1) * PER_EDGE) % outline.length]];
/** What lies between two outlines (the second inside the first), as one simple shape for each side of the mat: no holes, so no seams. */
const strips = (outer: string[], inner: string[]) => [0, 1, 2, 3].map((e) => poly([...side(outer, e), ...side(inner, e).reverse()]));

/**
 * The surface of a playmat, in place of its plain background: put it inside the mat (which must be `relative`), under the cards.
 * `seed` makes each player's mat tear in its own places.
 */
export function MatTear({ life, mat, seed, fx = DEFAULT_FOCUS }: { life: number; mat: string; seed: number; fx?: MatFocus }) {
  const on = useAnimationsOn();
  // For each stage: where the table shows through, and the paper rim along the tear.
  const stages = useMemo(() => {
    const list = bites(seed);
    const whole = outline(list, 0); // the edge of the mat itself
    return STAGES.map((at) => {
      const tear = tearOf(at);
      const rim = outline(list, tear, 0.93);
      return { at, gap: strips(whole, rim), rim: at === 0 ? [] : strips(rim, outline(list, tear)) }; // (at the very end nothing is left, not even a rim)
    });
  }, [seed]);
  const fade = on ? "opacity 1.6s ease-in-out" : "none";
  // A stage is only put on the page once the tear reaches it (at full life there is nothing of it at all, and a hundred shapes that
  // never show would cost every layout and style pass of the board). It starts see-through and is faded in a moment later; a stage that
  // has been shown stays, so it can fade back out when life goes up again.
  const reached = STAGES.filter((at) => life <= at).length;
  const [shown, setShown] = useState(reached);
  const [lit, setLit] = useState(reached);
  if (reached > shown) setShown(reached);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => (second = requestAnimationFrame(() => setLit(reached))));
    return () => (cancelAnimationFrame(first), cancelAnimationFrame(second));
  }, [reached]);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-2xl">
      <div className="absolute inset-0" style={matLayerStyle(`linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.2)), ${mat}`, fx)} />
      {stages.slice(0, shown).map((s, index) => {
        const torn = index < lit ? 1 : 0;
        return (
          // each stage fades as one: its strips are the same colour, so where they overlap nothing shows
          <div key={s.at} className="absolute inset-0">
            <div className="absolute inset-0" style={{ opacity: torn * 0.9, transition: fade }}>
              {s.rim.map((clip, i) => (
                <div key={i} className="absolute inset-0" style={{ background: "linear-gradient(135deg, #cdbfa0, #8f8468)", clipPath: clip }} />
              ))}
            </div>
            <div className="absolute inset-0" style={{ opacity: torn, transition: fade }}>
              {s.gap.map((clip, i) => (
                <div key={i} className="absolute inset-0" style={{ background: TABLE, clipPath: clip }} />
              ))}
            </div>
          </div>
        );
      })}
      {/* a worried red glow at the edge of what is left */}
      {life <= TEAR_FROM - 4 && <div className={`mat-lowlife ${on ? "mat-lowlife-moving" : ""}`} data-stage={life <= 2 ? 3 : life <= 5 ? 2 : 1} />}
    </div>
  );
}
