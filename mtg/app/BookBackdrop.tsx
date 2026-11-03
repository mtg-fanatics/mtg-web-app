"use client";

import { useAnimationsOn } from "@/lib/motion";
import "./book.css";

/**
 * A big open book lying on the dark table, drawn in SVG (no pictures): a leather cover with stitching, stacks of page edges, two cream pages that curve
 * down into the gutter, faint ink (a ruled margin, scribble that says nothing, blots, a small sketch) and a ribbon bookmark. The panels of a screen float above it.
 *
 * It is one fixed layer behind everything (it takes no clicks and never moves the layout). Wide screens get the two-page spread; a narrow one gets a single page.
 * With the game's Motion switch off, or the system asking for reduced motion, it is completely still.
 *
 * Use it once per screen, as the first thing inside the page's <main>.
 */

// The scribble and the blots are worked out once, from fixed seeds, so the book is the same on the server, in the browser and on every visit.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A line of handwriting that is not a language: little up-and-down strokes with gaps where the words end. */
function scribble(r: () => number, x: number, y: number, len: number, amp = 3.6): string {
  let d = `M${x} ${y}`;
  let at = 0;
  while (at < len) {
    const w = 5 + r() * 9;
    d += ` q${(w / 2).toFixed(1)} ${(-amp * 0.9 + (r() - 0.5) * amp * 2).toFixed(1)} ${w.toFixed(1)} ${((r() - 0.5) * 2).toFixed(1)}`;
    at += w;
    if (r() < 0.2) {
      d += " m9 0";
      at += 9;
    }
  }
  return d;
}

const r = rng(2417);
const LEFT_LINES = [0, 1, 2, 3, 4, 5].map((i) => scribble(r, 176, 706 + i * 36, 330 + r() * 250));
const RIGHT_LINES = [0, 1, 2, 3].map((i) => scribble(r, 946, 768 + i * 36, 300 + r() * 220));
const NOTE_LINES = [scribble(r, 1180, 186, 190, 3), scribble(r, 1180, 214, 120, 3)];
const RULES = Array.from({ length: 20 }, (_, i) => 168 + i * 40);

// Page edges: a few sheets sticking out past the top page, each a little different.
const STACK = [6, 5, 4, 3, 2, 1].map((k) => {
  const j = rng(900 + k);
  return { k, a: (j() - 0.5) * 2.2, b: (j() - 0.5) * 2.2, shade: k % 2 ? "var(--book-edge-a)" : "var(--book-edge-b)" };
});

const LEFT_PAGE = "M96 100C330 88 640 94 850 112V960C640 978 330 972 96 962Z";
const RIGHT_PAGE = "M850 112C1060 94 1370 88 1604 100V962C1370 972 1060 978 850 960Z";

export default function BookBackdrop() {
  const live = useAnimationsOn();
  return (
    <div className={`book-layer ${live ? "book-live" : ""}`} aria-hidden="true">
      {/* the two-page spread */}
      <svg className="book-spread book-settle" viewBox="26 26 1648 1008" preserveAspectRatio="xMidYMid meet" focusable="false">
        <defs>
          <linearGradient id="bk-cover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#47301f" />
            <stop offset="1" stopColor="#24160d" />
          </linearGradient>
          <linearGradient id="bk-left" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--book-page-hi)" />
            <stop offset="0.6" stopColor="var(--book-page)" />
            <stop offset="0.9" stopColor="var(--book-page-lo)" />
            <stop offset="1" stopColor="var(--book-gutter)" />
          </linearGradient>
          <linearGradient id="bk-right" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="var(--book-page-hi)" />
            <stop offset="0.6" stopColor="var(--book-page)" />
            <stop offset="0.9" stopColor="var(--book-page-lo)" />
            <stop offset="1" stopColor="var(--book-gutter)" />
          </linearGradient>
          {/* the stain along the edges of a page, where hands and years have been */}
          <radialGradient id="bk-stain" cx="0.5" cy="0.5" r="0.72">
            <stop offset="0.55" stopColor="#7a4b1c" stopOpacity="0" />
            <stop offset="1" stopColor="#7a4b1c" stopOpacity="0.42" />
          </radialGradient>
          <linearGradient id="bk-ribbon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8f2f23" />
            <stop offset="0.5" stopColor="#b3392b" />
            <stop offset="1" stopColor="#7d2219" />
          </linearGradient>
          <clipPath id="bk-clip-l"><path d={LEFT_PAGE} /></clipPath>
          <clipPath id="bk-clip-r"><path d={RIGHT_PAGE} /></clipPath>
          <filter id="bk-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14" /></filter>
          <filter id="bk-smudge" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" /></filter>
          {/* paper fibre and grain: noise turned into a faint brown speckle, laid over each page once */}
          <filter id="bk-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.24  0 0 0 0 0.12  0 0 0 0.55 -0.12" />
          </filter>
          <filter id="bk-mottle" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="3" seed="21" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0 0.12  0 0 0 0.7 -0.22" />
          </filter>
        </defs>

        {/* the book's shadow on the table */}
        <rect x="64" y="70" width="1600" height="960" rx="30" fill="#000" opacity="0.55" filter="url(#bk-blur)" />

        {/* the leather cover, with the tooled line and the stitching just inside its edge */}
        <rect x="50" y="50" width="1600" height="960" rx="26" fill="url(#bk-cover)" stroke="#120a05" strokeWidth="3" />
        <rect x="50" y="50" width="1600" height="960" rx="26" fill="none" stroke="var(--book-leather-hi)" strokeOpacity="0.22" strokeWidth="2" transform="translate(1 1)" />
        <rect x="64" y="64" width="1572" height="932" rx="18" fill="none" stroke="var(--book-thread)" strokeOpacity="0.5" strokeWidth="2.2" strokeDasharray="10 8" strokeLinecap="round" />
        <rect x="76" y="76" width="1548" height="908" rx="12" fill="none" stroke="#120a05" strokeOpacity="0.5" strokeWidth="1.4" />
        {/* worn corners: the leather rubbed pale where the book has been carried */}
        <path d="M50 76C50 62 62 50 76 50H132L50 132Z" fill="var(--book-leather-hi)" opacity="0.38" />
        <path d="M1650 934V984C1650 998 1638 1010 1624 1010H1566Z" fill="var(--book-leather-hi)" opacity="0.34" />
        <path d="M1650 76C1650 62 1638 50 1624 50H1590L1650 100Z" fill="var(--book-leather-hi)" opacity="0.2" />

        {/* page edges: sheets sticking out past the top page on the left, right and bottom, none quite the same */}
        {STACK.map(({ k, a, b, shade }) => (
          <g key={k} stroke="rgba(70,45,20,0.55)" strokeWidth="0.9" fill={shade}>
            <path d={`M${96 - k * 3.4 + a} ${100 + k * 2.2}C330 ${92 + k * 2} 640 ${98 + k * 2} 850 ${114 + k * 2}V${962 + k * 2.4 + b}C640 ${980 + k * 2} 330 ${974 + k * 2} ${96 - k * 3.4 + a} ${964 + k * 2.6}Z`} />
            <path d={`M${1604 + k * 3.4 + b} ${100 + k * 2.2}C1370 ${90 + k * 2} 1060 ${96 + k * 2} 850 ${114 + k * 2}V${962 + k * 2.4 + a}C1060 ${980 + k * 2} 1370 ${974 + k * 2} ${1604 + k * 3.4 + b} ${964 + k * 2.6}Z`} />
          </g>
        ))}

        {/* the two pages, curving down into the gutter */}
        <path d={LEFT_PAGE} fill="url(#bk-left)" />
        <path d={RIGHT_PAGE} fill="url(#bk-right)" />
        <g clipPath="url(#bk-clip-l)">
          <rect className="book-grain" x="90" y="80" width="770" height="910" filter="url(#bk-grain)" opacity="0.55" />
          <rect className="book-grain" x="90" y="80" width="770" height="910" filter="url(#bk-mottle)" opacity="0.5" />
          <path d={LEFT_PAGE} fill="url(#bk-stain)" />
        </g>
        <g clipPath="url(#bk-clip-r)">
          <rect className="book-grain" x="850" y="80" width="770" height="910" filter="url(#bk-grain)" opacity="0.55" />
          <rect className="book-grain" x="850" y="80" width="770" height="910" filter="url(#bk-mottle)" opacity="0.5" />
          <path d={RIGHT_PAGE} fill="url(#bk-stain)" />
        </g>

        {/* the faint ink: ruled lines, a margin, handwriting that says nothing, a few blots and a small sketch */}
        <g clipPath="url(#bk-clip-l)" fill="none" stroke="var(--book-ink)" strokeLinecap="round" strokeLinejoin="round">
          {RULES.map((y) => (
            <path key={y} d={`M150 ${y}H820`} strokeOpacity="0.1" strokeWidth="1" />
          ))}
          <path d="M148 100V962" stroke="var(--book-margin)" strokeOpacity="0.34" strokeWidth="1.8" />
          <path d="M155 100V962" stroke="var(--book-margin)" strokeOpacity="0.2" strokeWidth="1" />
          {LEFT_LINES.map((d, i) => (
            <path key={i} d={d} strokeOpacity="0.3" strokeWidth="1.7" />
          ))}
          <g transform="translate(700 820)" strokeOpacity="0.28" strokeWidth="1.6">
            <circle r="28" />
            <circle r="9" />
            <path d="M0 -40V-28M0 28V40M-40 0H-28M28 0H40M-28 -28L-20 -20M28 28L20 20M28 -28L20 -20M-28 28L-20 20" />
            <path d="M-6 -4C-2 -10 6 -8 5 -2S-2 5 -4 1" />
          </g>
          <g fill="var(--book-ink)" stroke="none">
            <ellipse cx="610" cy="640" rx="9" ry="7" opacity="0.3" />
            <circle cx="626" cy="652" r="3" opacity="0.28" />
            <circle cx="340" cy="930" r="5" opacity="0.22" />
          </g>
          <ellipse cx="420" cy="620" rx="64" ry="30" fill="var(--book-ink)" stroke="none" opacity="0.07" filter="url(#bk-smudge)" />
        </g>
        <g clipPath="url(#bk-clip-r)" fill="none" stroke="var(--book-ink)" strokeLinecap="round" strokeLinejoin="round">
          {RULES.map((y) => (
            <path key={y} d={`M880 ${y}H1550`} strokeOpacity="0.1" strokeWidth="1" />
          ))}
          <path d="M1552 100V962" stroke="var(--book-margin)" strokeOpacity="0.34" strokeWidth="1.8" />
          <path d="M1545 100V962" stroke="var(--book-margin)" strokeOpacity="0.2" strokeWidth="1" />
          {RIGHT_LINES.map((d, i) => (
            <path key={i} d={d} strokeOpacity="0.3" strokeWidth="1.7" />
          ))}
          {NOTE_LINES.map((d, i) => (
            <path key={i} d={d} strokeOpacity="0.24" strokeWidth="1.5" />
          ))}
          <g fill="var(--book-ink)" stroke="none">
            <ellipse cx="1420" cy="880" rx="11" ry="8" opacity="0.3" />
            <circle cx="1438" cy="894" r="3.4" opacity="0.26" />
            <circle cx="1180" cy="930" r="4" opacity="0.22" />
          </g>
          <ellipse cx="1330" cy="740" rx="70" ry="26" fill="var(--book-ink)" stroke="none" opacity="0.06" filter="url(#bk-smudge)" />
        </g>

        {/* the gutter: a dark crease, and the ribbon bookmark trailing out of it a little off centre */}
        <path d="M850 112V960" stroke="#2a1a0c" strokeOpacity="0.55" strokeWidth="2.4" />
        <g>
          <path d="M886 104C896 300 862 520 900 760S912 960 902 1058" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="18" transform="translate(4 5)" />
          <path d="M886 104C896 300 862 520 900 760S912 960 902 1058" fill="none" stroke="url(#bk-ribbon)" strokeWidth="18" />
          <path d="M886 104C896 300 862 520 900 760S912 960 902 1058" fill="none" stroke="#e8896f" strokeOpacity="0.28" strokeWidth="2" transform="translate(-5 0)" />
        </g>
      </svg>

      {/* a narrow screen: one page, the gutter shadow down its left edge */}
      <svg className="book-single book-settle" viewBox="0 0 400 800" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="bk-one" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--book-gutter)" />
            <stop offset="0.16" stopColor="var(--book-page-lo)" />
            <stop offset="0.4" stopColor="var(--book-page)" />
            <stop offset="1" stopColor="var(--book-page-hi)" />
          </linearGradient>
          <radialGradient id="bk-one-stain" cx="0.5" cy="0.5" r="0.75">
            <stop offset="0.6" stopColor="#7a4b1c" stopOpacity="0" />
            <stop offset="1" stopColor="#7a4b1c" stopOpacity="0.4" />
          </radialGradient>
        </defs>
        <rect width="400" height="800" fill="#2a190f" />
        <path d="M0 0H386V790H0Z" fill="var(--book-edge-b)" stroke="rgba(70,45,20,0.55)" />
        <path d="M0 0H392V794H0Z" fill="var(--book-edge-a)" stroke="rgba(70,45,20,0.55)" />
        <path d="M0 0H397V797H0Z" fill="url(#bk-one)" />
        <path d="M0 0H397V797H0Z" fill="url(#bk-one-stain)" />
        <path d="M44 0V797" stroke="var(--book-margin)" strokeOpacity="0.3" strokeWidth="1.6" />
        <path d="M0 0V800" stroke="#2a1a0c" strokeOpacity="0.5" strokeWidth="3" />
      </svg>

      {/* lamplight: a warm pool toward the middle, and the corners darkened */}
      <div className="book-glow" />
      <div className="book-vignette" />
    </div>
  );
}
