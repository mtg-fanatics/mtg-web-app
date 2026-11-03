"use client";

import { useAnimationsOn } from "@/lib/motion";
import "./book.css";

/**
 * A big open book lying on the dark table, drawn in SVG (no pictures): a leather cover with stitching, stacks of page edges, two cream pages that dip
 * into a curved gutter shadow, faint ink (a ruled margin, paragraphs of scribble that say nothing, crossed-out lines, blots, a small sketch) and a woven
 * ribbon bookmark with a frayed tail. The panels of a screen float above it.
 *
 * It is one fixed layer behind everything (it takes no clicks and never moves the layout). Wide screens get the two-page spread, stretched to fill the
 * screen so the side panels stand on the pages; a narrow one gets a single page. With the game's Motion switch off, or the system asking for reduced
 * motion, it is completely still.
 *
 * Use it once per screen, as the first thing inside the page's <main>.
 */

// All the handwriting is worked out once, from fixed seeds, so the book is the same on the server, in the browser and on every visit.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A line of handwriting that is not a language: little up-and-down strokes, with gaps where the words end. */
function scribble(r: () => number, x: number, y: number, len: number, amp = 3.6): string {
  let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
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

interface Paragraph {
  lines: string[];
  strikes: string[];
  rotate: string;
}

/**
 * A paragraph: lines of different lengths (the last one short), a little uneven in spacing, the whole block slanted a degree or so. `strike` names
 * lines that are crossed out with a stroke or two.
 */
function paragraph(r: () => number, x: number, y: number, width: number, count: number, o: { gap?: number; slant?: number; indent?: number; strike?: number[] } = {}): Paragraph {
  const gap = o.gap ?? 30;
  const lines: string[] = [];
  const strikes: string[] = [];
  let at = y;
  for (let i = 0; i < count; i++) {
    const indent = i === 0 ? (o.indent ?? 0) : 0;
    const len = (width - indent) * (i === count - 1 ? 0.28 + r() * 0.34 : 0.76 + r() * 0.24);
    lines.push(scribble(r, x + indent, at, len, 3.2 + r() * 1.2));
    if (o.strike?.includes(i)) {
      const a = x + indent - 4;
      const b = x + indent + len + 4;
      strikes.push(`M${a.toFixed(1)} ${(at + 1).toFixed(1)}L${b.toFixed(1)} ${(at - 4 - r() * 2).toFixed(1)}`);
      if (r() < 0.7) strikes.push(`M${(a + 6).toFixed(1)} ${(at - 7).toFixed(1)}L${(b - 8).toFixed(1)} ${(at + 3).toFixed(1)}`);
    }
    at += gap + (r() - 0.5) * 4;
  }
  return { lines, strikes, rotate: `rotate(${o.slant ?? 0} ${x} ${y})` };
}

/** A heading line: bigger strokes, with a wavy underline. */
function heading(r: () => number, x: number, y: number, len: number): string[] {
  return [scribble(r, x, y, len, 5.2), `M${x} ${y + 10}q${len * 0.25} ${-3} ${len * 0.5} 0t${len * 0.5} -1`];
}

const GRAIN = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .22 0 0 0 0 .15 0 0 0 0 .08 0 0 0 .5 -.12'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";
// soft patches of age on the pages (x, y, rx, ry), the same set mirrored on the other page
const BLOTCHES: [number, number, number, number][] = [[210, 250, 190, 120], [560, 420, 230, 150], [330, 720, 220, 130], [690, 800, 170, 110], [120, 560, 110, 160], [520, 130, 200, 90]];

const r = rng(2417);
const LEFT = {
  head: heading(r, 100, 372, 230),
  a: paragraph(r, 88, 410, 640, 8, { gap: 30, slant: -0.6, indent: 22, strike: [3] }),
  b: paragraph(r, 88, 690, 620, 4, { gap: 31, slant: 0.5, strike: [1] }),
  c: paragraph(r, 96, 826, 640, 2, { gap: 30, slant: -0.3, indent: 24 }),
};
const RIGHT = {
  head: heading(r, 1252, 392, 190),
  a: paragraph(r, 920, 440, 620, 7, { gap: 30, slant: 0.7, indent: 20, strike: [2, 5] }),
  b: paragraph(r, 920, 690, 600, 5, { gap: 30, slant: -0.5 }),
  c: paragraph(r, 880, 828, 660, 2, { gap: 31, slant: 0.4, indent: 26 }),
};
const RULES = Array.from({ length: 21 }, (_, i) => 150 + i * 36);

// The ribbon's frayed tail: a few loose threads, none the same.
const fr = rng(611);
const THREADS = Array.from({ length: 9 }, (_, i) => {
  const x = 854 + i * 2.6;
  return `M${x.toFixed(1)} ${(982 + fr() * 3).toFixed(1)}q${((fr() - 0.5) * 6).toFixed(1)} ${(5 + fr() * 4).toFixed(1)} ${((fr() - 0.5) * 9).toFixed(1)} ${(8 + fr() * 8).toFixed(1)}`;
});

// Page edges: a few sheets sticking out past the top page, each a little different.
const STACK = [6, 5, 4, 3, 2, 1].map((k) => {
  const j = rng(900 + k);
  return { k, a: (j() - 0.5) * 2.4, b: (j() - 0.5) * 2.4, shade: k % 2 ? "var(--book-edge-a)" : "var(--book-edge-b)" };
});

// The pages dip toward the gutter at x = 820: the top edge sags a little, the bottom edge lifts.
const LEFT_PAGE = "M46 60C280 50 600 56 820 78V872C600 892 280 894 46 888Z";
const RIGHT_PAGE = "M820 78C1040 56 1360 50 1594 60V888C1360 894 1040 892 820 872Z";
const RIBBON = "M832 52C858 250 810 470 842 690S880 850 858 960";

function Ink({ p }: { p: Paragraph }) {
  return (
    <g transform={p.rotate}>
      {p.lines.map((d, i) => (
        <path key={i} d={d} strokeOpacity="0.3" strokeWidth="1.7" />
      ))}
      {p.strikes.map((d, i) => (
        <path key={`s${i}`} d={d} strokeOpacity="0.36" strokeWidth="1.8" />
      ))}
    </g>
  );
}

export default function BookBackdrop() {
  const live = useAnimationsOn();
  return (
    <div className={`book-layer ${live ? "book-live" : ""}`} aria-hidden="true">
      {/* the two-page spread, stretched to the screen */}
      <svg className="book-spread book-settle" viewBox="0 0 1640 1000" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="bk-cover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#47301f" />
            <stop offset="1" stopColor="#24160d" />
          </linearGradient>
          <linearGradient id="bk-left" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--book-page-hi)" />
            <stop offset="0.6" stopColor="var(--book-page)" />
            <stop offset="0.92" stopColor="var(--book-page-lo)" />
            <stop offset="1" stopColor="var(--book-gutter)" />
          </linearGradient>
          <linearGradient id="bk-right" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="var(--book-page-hi)" />
            <stop offset="0.6" stopColor="var(--book-page)" />
            <stop offset="0.92" stopColor="var(--book-page-lo)" />
            <stop offset="1" stopColor="var(--book-gutter)" />
          </linearGradient>
          {/* the curved gutter shadow: dark in the crease, fading out across the page along a bowed edge */}
          <linearGradient id="bk-dip-l" gradientUnits="userSpaceOnUse" x1="820" y1="0" x2="672" y2="0">
            <stop offset="0" stopColor="#2a1608" stopOpacity="0.42" />
            <stop offset="0.2" stopColor="#3a2010" stopOpacity="0.3" />
            <stop offset="0.5" stopColor="#3a2010" stopOpacity="0.12" />
            <stop offset="0.8" stopColor="#3a2010" stopOpacity="0.03" />
            <stop offset="1" stopColor="#3a2010" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="bk-dip-r" gradientUnits="userSpaceOnUse" x1="820" y1="0" x2="968" y2="0">
            <stop offset="0" stopColor="#2a1608" stopOpacity="0.42" />
            <stop offset="0.2" stopColor="#3a2010" stopOpacity="0.3" />
            <stop offset="0.5" stopColor="#3a2010" stopOpacity="0.12" />
            <stop offset="0.8" stopColor="#3a2010" stopOpacity="0.03" />
            <stop offset="1" stopColor="#3a2010" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="bk-stain" cx="0.5" cy="0.5" r="0.72">
            <stop offset="0.55" stopColor="#7a4b1c" stopOpacity="0" />
            <stop offset="1" stopColor="#7a4b1c" stopOpacity="0.42" />
          </radialGradient>
          <linearGradient id="bk-ribbon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6a2820" />
            <stop offset="0.5" stopColor="#8a3328" />
            <stop offset="1" stopColor="#632019" />
          </linearGradient>
          {/* the writing fades out, softly and only here, round the title: an ellipse of mask, never a box */}
          <radialGradient id="bk-title-fade-g" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#000" />
            <stop offset="0.55" stopColor="#000" />
            <stop offset="1" stopColor="#fff" />
          </radialGradient>
          <mask id="bk-title-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="1640" height="1000"><rect width="1640" height="1000" fill="#fff" /><ellipse cx="820" cy="520" rx="300" ry="250" fill="url(#bk-title-fade-g)" /></mask>
          <clipPath id="bk-clip-l"><path d={LEFT_PAGE} /></clipPath>
          <clipPath id="bk-clip-r"><path d={RIGHT_PAGE} /></clipPath>
          {/* the grain is one small tile (drawn once and repeated), not noise worked out over the whole page: a filter this big is the slowest thing on a weak graphics chip */}
          <pattern id="bk-grain-p" width="240" height="240" patternUnits="userSpaceOnUse"><image href={GRAIN} width="240" height="240" /></pattern>
          {/* a patch of age on the paper: a soft brown that fades to nothing at its edge (no blur filter) */}
          <radialGradient id="bk-blotch" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#8a5a22" stopOpacity="0.2" /><stop offset="1" stopColor="#8a5a22" stopOpacity="0" /></radialGradient>
          <radialGradient id="bk-smudge-g" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#2f2014" stopOpacity="0.16" /><stop offset="1" stopColor="#2f2014" stopOpacity="0" /></radialGradient>
        </defs>

        {/* the book's shadow on the table (there is no cover showing: the pages lie straight on the table) */}
        {[0, 1, 2, 3].map((k) => (
          <rect key={k} x={40 - k * 5} y={60 + k * 4} width={1566 + k * 10} height={842 + k * 8} rx={20 + k * 6} fill="#000" opacity="0.16" />
        ))}

        {/* page edges: sheets sticking out past the top page on the left, right and bottom, none quite the same */}
        {STACK.map(({ k, a, b, shade }) => (
          <g key={k} stroke="rgba(70,45,20,0.55)" strokeWidth="0.9" fill={shade}>
            <path d={`M${46 - k * 3.2 + a} ${60 + k * 2}C280 ${52 + k * 2} 600 ${58 + k * 2} 820 ${80 + k * 2}V${872 + k * 2.2 + b}C600 ${892 + k * 2} 280 ${894 + k * 2} ${46 - k * 3.2 + a} ${888 + k * 2.4}Z`} />
            <path d={`M${1594 + k * 3.2 + b} ${60 + k * 2}C1360 ${52 + k * 2} 1040 ${58 + k * 2} 820 ${80 + k * 2}V${872 + k * 2.2 + a}C1040 ${892 + k * 2} 1360 ${894 + k * 2} ${1594 + k * 3.2 + b} ${888 + k * 2.4}Z`} />
          </g>
        ))}

        {/* the two pages */}
        <path d={LEFT_PAGE} fill="url(#bk-left)" />
        <path d={RIGHT_PAGE} fill="url(#bk-right)" />
        <g clipPath="url(#bk-clip-l)">
          <rect className="book-grain" x="40" y="40" width="790" height="870" fill="url(#bk-grain-p)" opacity="0.6" />
          {BLOTCHES.map((q, i) => <ellipse key={i} className="book-grain" cx={q[0]} cy={q[1]} rx={q[2]} ry={q[3]} fill="url(#bk-blotch)" />)}
          <path d={LEFT_PAGE} fill="url(#bk-stain)" />
          <rect x="672" y="40" width="148" height="870" fill="url(#bk-dip-l)" />
        </g>
        <g clipPath="url(#bk-clip-r)">
          <rect className="book-grain" x="820" y="40" width="790" height="870" fill="url(#bk-grain-p)" opacity="0.6" />
          {BLOTCHES.map((q, i) => <ellipse key={i} className="book-grain" cx={1640 - q[0]} cy={q[1]} rx={q[2]} ry={q[3]} fill="url(#bk-blotch)" />)}
          <path d={RIGHT_PAGE} fill="url(#bk-stain)" />
          <rect x="820" y="40" width="148" height="870" fill="url(#bk-dip-r)" />
        </g>

        {/* the faint ink: ruled lines, a margin, paragraphs of handwriting that says nothing (with a heading and a few crossings-out), blots and a small sketch */}
        <g clipPath="url(#bk-clip-l)" mask="url(#bk-title-fade)" fill="none" stroke="var(--book-ink)" strokeLinecap="round" strokeLinejoin="round">
          {RULES.map((y) => (
            <path key={y} d={`M110 ${y}H800`} strokeOpacity="0.09" strokeWidth="1" />
          ))}
          <path d="M96 56V890" stroke="var(--book-margin)" strokeOpacity="0.34" strokeWidth="1.8" />
          <path d="M103 56V890" stroke="var(--book-margin)" strokeOpacity="0.2" strokeWidth="1" />
          {LEFT.head.map((d, i) => (
            <path key={i} d={d} strokeOpacity={i ? 0.24 : 0.36} strokeWidth={i ? 1.3 : 2.5} />
          ))}
          <Ink p={LEFT.a} />
          <Ink p={LEFT.b} />
          <Ink p={LEFT.c} />
          <g fill="var(--book-ink)" stroke="none">
            <ellipse cx="404" cy="672" rx="9" ry="7" opacity="0.3" />
            <circle cx="420" cy="684" r="3" opacity="0.28" />
            <circle cx="252" cy="868" r="4.5" opacity="0.22" />
          </g>
          <ellipse cx="300" cy="640" rx="86" ry="34" fill="url(#bk-smudge-g)" stroke="none" />
        </g>
        <g clipPath="url(#bk-clip-r)" mask="url(#bk-title-fade)" fill="none" stroke="var(--book-ink)" strokeLinecap="round" strokeLinejoin="round">
          {RULES.map((y) => (
            <path key={y} d={`M840 ${y}H1530`} strokeOpacity="0.09" strokeWidth="1" />
          ))}
          <path d="M1544 56V890" stroke="var(--book-margin)" strokeOpacity="0.34" strokeWidth="1.8" />
          <path d="M1537 56V890" stroke="var(--book-margin)" strokeOpacity="0.2" strokeWidth="1" />
          {RIGHT.head.map((d, i) => (
            <path key={i} d={d} strokeOpacity={i ? 0.24 : 0.36} strokeWidth={i ? 1.3 : 2.5} />
          ))}
          <g transform="translate(1500 396)" strokeOpacity="0.28" strokeWidth="1.6">
            <circle r="26" />
            <circle r="8" />
            <path d="M0 -38V-26M0 26V38M-38 0H-26M26 0H38M-26 -26L-19 -19M26 26L19 19M26 -26L19 -19M-26 26L-19 19" />
            <path d="M-5 -4C-2 -9 6 -7 5 -2S-2 5 -4 1" />
          </g>
          <Ink p={RIGHT.a} />
          <Ink p={RIGHT.b} />
          <Ink p={RIGHT.c} />
          <g fill="var(--book-ink)" stroke="none">
            <ellipse cx="1470" cy="790" rx="11" ry="8" opacity="0.3" />
            <circle cx="1488" cy="804" r="3.4" opacity="0.26" />
            <circle cx="1100" cy="866" r="4" opacity="0.22" />
          </g>
          <ellipse cx="1380" cy="640" rx="88" ry="32" fill="url(#bk-smudge-g)" stroke="none" />
        </g>

        {/* the gutter: a dark crease, and the ribbon bookmark trailing out of it a little off centre */}
        <path d="M820 78V872" stroke="#2a1a0c" strokeOpacity="0.6" strokeWidth="2.6" />
        <g>
          <path d={RIBBON} fill="none" stroke="rgba(0,0,0,0.36)" strokeWidth="20" transform="translate(4 5)" />
          <path d={RIBBON} fill="none" stroke="url(#bk-ribbon)" strokeWidth="20" />
          {/* the woven edges: a dark selvedge and a row of tiny pale stitches along each side, and a soft sheen down the middle */}
          <path d={RIBBON} fill="none" stroke="#3d100b" strokeOpacity="0.6" strokeWidth="1.6" transform="translate(-9 0)" />
          <path d={RIBBON} fill="none" stroke="#3d100b" strokeOpacity="0.6" strokeWidth="1.6" transform="translate(9 0)" />
          <path d={RIBBON} fill="none" stroke="#d29a86" strokeOpacity="0.4" strokeWidth="1.3" strokeDasharray="2.4 2.4" transform="translate(-6.5 0)" />
          <path d={RIBBON} fill="none" stroke="#d29a86" strokeOpacity="0.4" strokeWidth="1.3" strokeDasharray="2.4 2.4" transform="translate(6.5 0)" />
          <path d={RIBBON} fill="none" stroke="#d9a894" strokeOpacity="0.16" strokeWidth="3" />
          {/* the tail below the book: a swallow-tail cut, and the threads coming loose */}
          <path d="M848 957L870 957L873 988L861 977L847 990Z" fill="#6f281f" stroke="#3d100b" strokeOpacity="0.5" strokeWidth="1" />
          <g fill="none" stroke="#7d2c22" strokeWidth="1.2" strokeLinecap="round" opacity="0.85">
            {THREADS.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
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
