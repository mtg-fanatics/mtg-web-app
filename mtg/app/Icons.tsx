import type { SVGProps } from "react";

/**
 * Inkfall's own little pictures, drawn by hand in the same ink as the rest of the game: uneven strokes, corners that don't quite meet,
 * a second faint stroke where the ink bled. They all take the text color (currentColor) and are drawn at 24 x 24.
 * `InkFilters` (once, in the layout) gives them and the big titles their slightly ragged print.
 */

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "ink-icon",
} as const;

/** The hidden filters the whole site draws its rough edges with: `ink-rough` for titles, `ink-rough-sm` for icons. */
export function InkFilters() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }} focusable="false">
      <filter id="ink-rough" x="-4%" y="-8%" width="108%" height="116%">
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="11" result="t" />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="ink-rough-sm" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.11" numOctaves="2" seed="3" result="t" />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="1.1" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      {/* the slight bleed of ink into paper at the edge of a letter: a faint blurred copy, then the rough edge (small headings only, never animated) */}
      <filter id="ink-bleed" x="-3%" y="-10%" width="106%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="5" result="t" />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="1.3" xChannelSelector="R" yChannelSelector="G" result="rough" />
        <feGaussianBlur in="rough" stdDeviation="0.55" result="soft" />
        <feMerge><feMergeNode in="soft" /><feMergeNode in="rough" /></feMerge>
      </filter>
    </svg>
  );
}

/** A quill: write something new (create a room). */
export function Quill(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20.4 3.2c-5.9.7-10.6 4.4-12.8 10.9L5.9 19l4.5-1.9c6.1-2.2 10-6.7 10-13.9z" />
      <path d="M5 20.6 14.6 9.4" />
      <path d="M11.6 12.2c1.5.1 2.6.5 3.7 1.4M9.5 14.9c1.2 0 2 .3 2.8 1" opacity=".55" />
    </svg>
  );
}

/** A tome with a strap: decks. */
export function Tome(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5.2 4.4c3.9-.4 8.3-.3 11.4 0 1.3.1 2 .9 2 2.2V19H7.4a2.2 2.2 0 0 1-2.2-2.2z" />
      <path d="M5.3 16.9c.1-1.3 1-2 2.3-2.1h11" />
      <path d="M9 8.2c1.7-.2 3.6-.2 5.2 0M9 11c1.3-.1 2.6-.1 3.7 0" opacity=".6" />
      <path d="M15.6 4.5v4.2l1.1-.9 1.1.9V4.6" opacity=".8" />
    </svg>
  );
}

/** Three cards fanned out: the card browser. */
export function Fan(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5.1 8.4c-.4-1 .1-2 1.1-2.4l4.4-1.6c1-.4 2 .1 2.4 1.1l2.6 7.2c.4 1-.1 2-1.1 2.4l-4.4 1.6c-1 .4-2-.1-2.4-1.1z" transform="rotate(-8 9 10)" opacity=".7" />
      <path d="M9.4 6.6c0-1 .8-1.9 1.9-1.9h4.7c1 0 1.9.8 1.9 1.9v8.1c0 1-.8 1.9-1.9 1.9h-4.7c-1 0-1.9-.8-1.9-1.9z" transform="rotate(9 14 11)" />
      <path d="M12.2 9.4c1 .6 1.9.6 2.8 0M13.6 11.7v2" opacity=".6" transform="rotate(9 14 11)" />
      <path d="M4.6 20c4.5 1.4 10.5 1.4 15 0" opacity=".45" />
    </svg>
  );
}

/** Two heads together: friends. */
export function Pair(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8.6" cy="8.1" r="2.9" />
      <path d="M3.4 19.4c.3-3.6 2.4-5.4 5.2-5.4s4.9 1.8 5.2 5.4z" />
      <circle cx="16.6" cy="9.3" r="2.3" opacity=".8" />
      <path d="M14.9 14.2c3-.7 5.4.7 5.9 4.6" opacity=".8" />
    </svg>
  );
}

/** A hand bell: notifications. */
export function Handbell(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.2v1.6" />
      <path d="M6.3 17c.2-6.2 1.7-9.4 5.7-9.4s5.5 3.2 5.7 9.4z" />
      <path d="M4.9 17.1h14.3" />
      <path d="M10.4 19.9c.9 1 2.3 1 3.2 0" />
    </svg>
  );
}

/** A horn: sound. */
export function Horn(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10.1v3.9h3.1l5.9 3.9V6.2L7.1 10.1z" />
      <path d="M16.2 9.6c1.4 1.3 1.4 3.5 0 4.8" />
      <path d="M18.7 7.2c2.7 2.6 2.7 7 0 9.6" opacity=".6" />
    </svg>
  );
}

/** A drop of ink: animations. */
export function InkDrop(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.1c3.4 4.4 6.1 7.4 6.1 10.5a6.1 6.1 0 0 1-12.2 0C5.9 10.5 8.6 7.5 12 3.1z" />
      <path d="M9 14.2c.2 1.6 1.1 2.6 2.5 2.9" opacity=".6" />
    </svg>
  );
}

/** An hourglass: speed. */
export function Hourglass(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.8 3.6h10.4M6.8 20.4h10.4" />
      <path d="M7.9 3.7c.1 3.9 3 4.9 4.2 8.3-1.1 3.4-4.1 4.4-4.2 8.3M16.1 3.7c-.1 3.9-3 4.9-4.2 8.3 1.1 3.4 4.1 4.4 4.2 8.3" />
      <path d="M10 18.2c1.3-.6 2.7-.6 4 0" opacity=".6" />
    </svg>
  );
}

/** A door ajar: leave. */
export function Door(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.2 20.4V4.3c2.8-.4 6-.3 9.2.1v16" />
      <path d="M3.8 20.5h16.4" />
      <path d="M12.9 12.3v.2" strokeWidth="2.6" />
    </svg>
  );
}

/** A rolled scroll: matches under way. */
export function Scroll(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.2 4.6h11.4v11.1a3 3 0 0 0 3 3H9.2a3 3 0 0 1-3-3z" />
      <path d="M6.2 4.6a2 2 0 0 0-2 2v1.2h2" />
      <path d="M9.6 8.6h5.4M9.6 11.6h5.4" opacity=".6" />
    </svg>
  );
}

/** An inked cross, for closing. */
export function Cross(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.2 6.4c4 3.6 7.6 7.4 11.6 11.2M17.6 6.2c-4.2 3.8-7.4 7.6-11.2 11.6" />
    </svg>
  );
}

/** A padlock: a room with a password. */
export function Padlock(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5.8 11h12.5v8.6H5.8z" />
      <path d="M8.4 11V8.2a3.6 3.6 0 0 1 7.2 0V11" />
      <path d="M12 14.6v1.6" />
    </svg>
  );
}

/** A hand-drawn wobbly line under a heading. `className` sets the color (it uses currentColor). */
export function Scribble({ className = "", width = 220 }: { className?: string; width?: number }) {
  return (
    <svg viewBox="0 0 220 12" width={width} height={(width / 220) * 12} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true" className={`scribble ${className}`} style={{ filter: "url(#ink-rough-sm)" }}>
      <path d="M3 7.5c22-4.6 41 3.4 66-.4s48-4.4 78 .2 45-3.4 70-.8" />
    </svg>
  );
}

/** A pen stroke pointing back: return to the front room. */
export function Back(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14.8 5.2c-1.6 2.2-3.6 4.4-5.6 6.7 2.1 2.1 3.9 4.2 5.7 6.1" />
      <path d="M9.6 12h9.4" opacity=".6" />
    </svg>
  );
}

/** A magnifying lens. */
export function Lens(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10.6 4.2a6.4 6.5 0 1 0 .1 12.9 6.4 6.5 0 0 0-.1-12.9z" />
      <path d="m15.4 15.8 4.6 4.3" />
      <path d="M7.6 8.6c.8-1.3 2-1.9 3.2-1.9" opacity=".55" />
    </svg>
  );
}

/** A plus, as if scratched with a nib. */
export function Plus(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12.1 4.6c-.2 4.8.1 9.6-.1 14.8M4.8 12.2c4.8-.3 9.7.1 14.6-.2" />
    </svg>
  );
}

/** A single stroke: take away. */
export function Minus(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12.3c4.6-.5 9.6.3 14.2-.2" />
    </svg>
  );
}

/** An eye: looking on. */
export function Eye(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.8 12.2c2.4-4.2 5.5-6.4 9.2-6.4s6.9 2.2 9.2 6.4c-2.3 4-5.5 6.2-9.2 6.2s-6.8-2.2-9.2-6.2z" />
      <circle cx="12" cy="12.1" r="2.7" />
    </svg>
  );
}

/** A little arrow-stroke for opening and closing a list. */
export function Chev(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9.2 6.2c1.9 1.9 3.7 3.8 5.4 5.9-1.7 2-3.6 3.9-5.5 5.7" />
    </svg>
  );
}

/** A waste bin, for throwing things away. */
export function Binned(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.2 6.6h15.6M9 6.4V4.3h6v2.1M6.3 6.7l.9 13.2h9.6l.9-13.2" />
      <path d="M10 10.4v6.2M14 10.4v6.2" opacity=".6" />
    </svg>
  );
}

/** A question in a seal: "are you sure?" */
export function Query(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 9.2c0-2 1.4-3.2 3.2-3.2s3 1.1 3 2.8c0 2.4-3.2 2.4-3.2 5" />
      <path d="M12 18.4v.1" strokeWidth="2.6" />
    </svg>
  );
}


/** A heart: life. */
export function Heart(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 20.100c-4.800-3.500-7.900-6.400-7.900-10 0-2.400 1.800-4.100 4-4.100 1.700 0 3.100.9 3.900 2.400.8-1.500 2.200-2.400 3.900-2.400 2.200 0 4.100 1.700 4.100 4.100 0 3.600-3.200 6.500-8 10z" />
      <path d="M7.400 9.600c.2-1 .9-1.600 1.800-1.700" opacity=".6" />
    </svg>
  );
}

/** An open hand: the cards held. */
export function Hand(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8.200 12.200V6.600a1.300 1.300 0 0 1 2.600 0v4.400M10.800 10.800V4.700a1.300 1.300 0 0 1 2.600 0v6M13.400 10.800V5.600a1.300 1.300 0 0 1 2.600 0V12M16 12V8.600a1.300 1.300 0 0 1 2.600 0v5.700c0 4-2.700 6.500-6.100 6.500-2.500 0-3.900-1.200-5.200-3.100l-2.600-4c-.6-1 .5-2 1.500-1.200l1.800 1.500" />
    </svg>
  );
}

/** A heater shield: damage that is stopped. */
export function Shield(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.200l7 2.400v5.500c0 4.400-3 7.800-7 9.700-4-1.900-7-5.300-7-9.700V5.600z" />
      <path d="M12 6.800v10.200" opacity=".55" />
    </svg>
  );
}

/** A skull: poison. */
export function Skull(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.500c-4 0-7 2.600-7 6.400 0 2.300 1.100 3.800 2.600 4.700v3c0 .8.600 1.400 1.400 1.400h6c.8 0 1.400-.6 1.400-1.400v-3c1.500-.9 2.600-2.400 2.600-4.700 0-3.800-3-6.400-7-6.400z" />
      <circle cx="9.300" cy="10.600" r="1.500" />
      <circle cx="14.700" cy="10.600" r="1.500" />
      <path d="M10.500 17.800v2M13.500 17.800v2" opacity=".6" />
    </svg>
  );
}

/** A four-point spark: an emblem, something lasting. */
export function Spark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.400c.6 4.400 1.800 5.800 6.600 8.600-4.800 2.800-6 4.200-6.600 8.600-.6-4.400-1.800-5.800-6.600-8.600C10.200 9.200 11.400 7.800 12 3.400z" />
    </svg>
  );
}

/** Two swords crossed: attack. */
export function Swords(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 4.600l10.600 10.600M19 4.600L8.400 15.200M3.900 14.300l5.400 5.400M3.600 20.400l2.500-2.500M20.100 14.300l-5.400 5.400M20.400 20.400l-2.500-2.500" />
    </svg>
  );
}

/** A jagged burst: damage. */
export function Burst(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l1.800 5.200 5.200-1.700-2.200 5 4.200 3.300-5.300.2L14.200 20 12 15.200 9.800 20l-.5-5-5.300-.2 4.200-3.300-2.200-5 5.200 1.700z" />
    </svg>
  );
}

/** A leaf: the main phase, a quiet turn to build in. */
export function Leaf(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 19.200C5 11 10.200 5.600 19 4.800c0 9-5.100 14.400-13.200 14.400" />
      <path d="M5.200 19l8-8.200" opacity=".7" />
    </svg>
  );
}

/** A tick, written in one stroke. */
export function Tick(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.400 12.900c2.200 1.700 3.700 3.500 4.900 5.700 2.700-5.600 6.100-9.500 10.300-12.500" />
    </svg>
  );
}
