// The four canvas finishers: Heaven's Judgment, Void Collapse, Meteor Strike and Absolute Zero.
//
// Each is drawn on ONE screen-sized canvas that floats over the whole table (at a lower resolution than the screen, and stretched), by a single animation loop on the
// real clock (so a late frame never slows the show, it only skips ahead). Everything has a TEXTURE: the fire, smoke, dust, lightning plasma and ice are soft pictures made
// from layered noise (made once, kept, and turned and scaled when drawn: a few hundred of them cost less than gradients), the scorch, the crater and the scar are noisy decals
// with glowing veins, the clouds drift, the shards are cut out of an ice texture or out of the real card's art.
// The loser's real cards are moved with the individual transform properties and put back at the end: they are thrown (with a height, so they fly up, tumble in 3D, fall, bounce and
// slide to a stop), scorched, set alight, frozen, pulled in and stretched, or shattered, depending on the finisher. Only the loser's mat is shaken (shaking the page would redraw
// the whole table). If frames come late, the sparks and smoke are thinned out and the picture is drawn smaller.
import { playSound } from "@/lib/sound";
import type { Sound } from "@/lib/sound";
import { animationsEnabled, scaled } from "@/lib/motion";
import { liteMode } from "./perfTier";
import { World, createBox, toDegrees } from "./physics";
import type { Body, Pose } from "./physics";

export type FxKind = "judgment" | "void" | "meteor" | "zero";

const TAU = Math.PI * 2;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sm = (a: number, b: number, x: number) => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

type Pt = [number, number];

// ───────────────────────────── textures: noise, made once and kept

function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, s: number, per = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x1 = per ? (xi + 1) % per : xi + 1;
  const y1 = per ? (yi + 1) % per : yi + 1;
  const x0 = per ? ((xi % per) + per) % per : xi;
  const y0 = per ? ((yi % per) + per) % per : yi;
  return lerp(lerp(hash(x0, y0, s), hash(x1, y0, s), u), lerp(hash(x0, y1, s), hash(x1, y1, s), u), v);
}
/** Layered noise, 0 to about 0.94. */
function fbm(x: number, y: number, s: number, oct = 4): number {
  let a = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    a += amp * vnoise(x * f, y * f, s + i * 17);
    f *= 2;
    amp *= 0.5;
  }
  return a;
}
/** The same, but it repeats every `cells` cells (a picture that tiles and can drift without a seam). */
function tfbm(u: number, v: number, cells: number, s: number, oct = 4): number {
  let a = 0;
  let amp = 0.5;
  let c = cells;
  for (let i = 0; i < oct; i++) {
    a += amp * vnoise(u * c, v * c, s + i * 17, c);
    c *= 2;
    amp *= 0.5;
  }
  return a;
}
/** Ridged noise: thin bright lines where the noise crosses its middle: cracks, veins, crystals. */
const ridge = (x: number, y: number, s: number, oct = 4) => 1 - Math.abs(fbm(x, y, s, oct) * 2 - 1);

function makeImage(w: number, h: number, fn: (x: number, y: number, o: number[]) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  const o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      o[0] = o[1] = o[2] = o[3] = 0;
      fn(x, y, o);
      const i = (y * w + x) * 4;
      img.data[i] = o[0];
      img.data[i + 1] = o[1];
      img.data[i + 2] = o[2];
      img.data[i + 3] = o[3];
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

type Pal = "fire" | "plasma" | "violet" | "smoke" | "dust" | "ice";
type Stop = [number, number, number, number, number];
const PAL: Record<Pal, Stop[]> = {
  fire: [[0, 120, 20, 0, 0], [0.25, 220, 60, 10, 0.5], [0.55, 255, 140, 30, 0.85], [0.8, 255, 210, 120, 1], [1, 255, 250, 230, 1]],
  plasma: [[0, 20, 30, 120, 0], [0.3, 60, 90, 255, 0.5], [0.6, 120, 170, 255, 0.85], [0.85, 210, 230, 255, 1], [1, 255, 255, 255, 1]],
  violet: [[0, 60, 10, 110, 0], [0.3, 130, 40, 220, 0.5], [0.6, 200, 100, 255, 0.85], [0.85, 245, 200, 255, 1], [1, 255, 255, 255, 1]],
  smoke: [[0, 30, 26, 28, 0], [0.4, 48, 42, 44, 0.5], [1, 84, 76, 78, 0.92]],
  dust: [[0, 120, 96, 72, 0], [0.4, 150, 120, 90, 0.5], [1, 196, 166, 130, 0.85]],
  ice: [[0, 120, 180, 220, 0], [0.4, 170, 220, 245, 0.55], [0.8, 230, 248, 255, 0.9], [1, 255, 255, 255, 1]],
};
const ADD_PAL: Record<Pal, boolean> = { fire: true, plasma: true, violet: true, ice: true, smoke: false, dust: false };

function ramp(stops: Stop[], v: number, o: number[]): void {
  v = clamp(v);
  let i = 0;
  while (i < stops.length - 2 && v > stops[i + 1][0]) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const k = clamp((v - a[0]) / (b[0] - a[0]));
  o[0] = lerp(a[1], b[1], k);
  o[1] = lerp(a[2], b[2], k);
  o[2] = lerp(a[3], b[3], k);
  o[3] = lerp(a[4], b[4], k) * 255;
}

/** A wisp or puff: a round falloff broken up by noise, coloured by the palette (hot in the thick middle, thin and dark at the edge). */
function makePuff(pal: Pal, seed: number): HTMLCanvasElement {
  const stops = PAL[pal];
  return makeImage(96, 96, (x, y, o) => {
    const d = Math.hypot((x - 47.5) / 48, (y - 47.5) / 48);
    const fall = Math.max(0, 1 - d);
    const n = fbm(x * 0.06 + seed * 13.7, y * 0.06 + seed * 3.1, seed, 4);
    ramp(stops, (n * 1.4 - 0.12) * Math.pow(fall, 0.8) * 1.55, o);
  });
}

interface Tex {
  puff: Record<Pal, HTMLCanvasElement[]>;
  flare: HTMLCanvasElement;
  scorch: HTMLCanvasElement; // blue-white veins in black
  crater: HTMLCanvasElement; // orange veins in brown-black
  scar: HTMLCanvasElement; // purple veins in black
  cloud: HTMLCanvasElement;
  cloudLit: HTMLCanvasElement;
  disk: HTMLCanvasElement;
  ball: HTMLCanvasElement;
  rocks: HTMLCanvasElement[];
  ice: HTMLCanvasElement;
  icePat: CanvasPattern | null;
}
const tex = {} as Partial<Tex>;

/** A noisy dark decal with a ragged edge and glowing veins (veins are drawn again, added, to make them glow). */
function makeDecal(dark: [number, number, number], vein: [number, number, number], seed: number): HTMLCanvasElement {
  return makeImage(192, 192, (x, y, o) => {
    const dx = (x - 95.5) / 96;
    const dy = (y - 95.5) / 96;
    const d = Math.hypot(dx, dy);
    const edge = 0.82 + (fbm(x * 0.05, y * 0.05, seed, 4) - 0.45) * 0.55;
    const mask = clamp((edge - d) / 0.28);
    if (mask <= 0) return;
    const v = Math.pow(ridge(x * 0.035, y * 0.035, seed + 5, 4), 9) * clamp(1.15 - d * 0.9);
    const grain = 0.75 + 0.5 * fbm(x * 0.12, y * 0.12, seed + 2, 3);
    o[0] = dark[0] * grain + vein[0] * v;
    o[1] = dark[1] * grain + vein[1] * v;
    o[2] = dark[2] * grain + vein[2] * v;
    o[3] = clamp(mask * 0.95 + v * 0.4) * 255;
  });
}

const BUILD: (() => void)[] = [
  () => {
    tex.puff = { fire: [], plasma: [], violet: [], smoke: [], dust: [], ice: [] };
    for (const p of ["fire", "plasma", "violet"] as const) for (let i = 0; i < 3; i++) tex.puff![p].push(makePuff(p, i + 1));
  },
  () => {
    for (const p of ["smoke", "dust", "ice"] as const) for (let i = 0; i < 3; i++) tex.puff![p].push(makePuff(p, i + 4));
  },
  () => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.translate(64, 64);
    const glowG = g.createRadialGradient(0, 0, 0, 0, 0, 64);
    glowG.addColorStop(0, "rgba(255,255,255,1)");
    glowG.addColorStop(0.12, "rgba(255,255,255,.85)");
    glowG.addColorStop(0.4, "rgba(255,255,255,.18)");
    glowG.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glowG;
    g.fillRect(-64, -64, 128, 128);
    for (const a of [0, Math.PI / 2]) {
      g.save();
      g.rotate(a);
      g.scale(1, 0.045);
      g.fillStyle = glowG;
      g.fillRect(-64, -64, 128, 128);
      g.restore();
    }
    tex.flare = c;
  },
  () => {
    tex.scorch = makeDecal([6, 8, 18], [140, 200, 255], 3);
  },
  () => {
    tex.crater = makeDecal([22, 10, 6], [255, 120, 30], 9);
  },
  () => {
    tex.scar = makeDecal([4, 0, 10], [190, 110, 255], 15);
  },
  () => {
    const cloud = (rgb: [number, number, number], s: number) =>
      makeImage(256, 256, (x, y, o) => {
        const n = tfbm(x / 256, y / 256, 4, s, 5);
        const a = clamp((n - 0.32) * 2.3);
        o[0] = rgb[0] * (0.7 + 0.5 * n);
        o[1] = rgb[1] * (0.7 + 0.5 * n);
        o[2] = rgb[2] * (0.7 + 0.5 * n);
        o[3] = a * 255;
      });
    tex.cloud = cloud([34, 26, 70], 21);
    tex.cloudLit = cloud([150, 165, 255], 21);
  },
  () => {
    // the accretion disc: a ring with a hole in the middle, swirled, hot (white and orange) near the hole and purple further out
    tex.disk = makeImage(256, 256, (x, y, o) => {
      const dx = (x - 127.5) / 128;
      const dy = (y - 127.5) / 128;
      const r = Math.hypot(dx, dy);
      if (r > 1 || r < 0.1) return;
      const th = Math.atan2(dy, dx);
      const prof = clamp((r - 0.2) / 0.1) * clamp((1 - r) / 0.45);
      const swirl = fbm(Math.cos(th + r * 5) * 2.2 + r * 6, Math.sin(th + r * 5) * 2.2 + r * 3, 31, 4);
      const v = clamp(prof * (0.25 + 1.3 * swirl) * 1.5);
      const heat = clamp(1 - (r - 0.2) / 0.5);
      o[0] = lerp(160, 255, heat) + v * 40;
      o[1] = lerp(70, 190, heat) + v * 60;
      o[2] = lerp(255, 110, heat) + v * 40;
      o[3] = v * 255;
    });
  },
  () => {
    // the meteor: a lit rock ball with glowing cracks
    tex.ball = makeImage(128, 128, (x, y, o) => {
      const dx = (x - 63.5) / 64;
      const dy = (y - 63.5) / 64;
      const r2 = dx * dx + dy * dy;
      if (r2 >= 1) return;
      const nz = Math.sqrt(1 - r2);
      const lit = clamp(-dx * 0.45 - dy * 0.45 + nz * 0.75);
      const grain = 0.55 + 0.9 * fbm(x * 0.09, y * 0.09, 41, 4);
      const v = Math.pow(ridge(x * 0.05, y * 0.05, 47, 4), 8);
      o[0] = 58 * grain * (0.35 + lit) + 255 * v;
      o[1] = 36 * grain * (0.35 + lit) + 120 * v;
      o[2] = 28 * grain * (0.35 + lit) + 30 * v;
      o[3] = clamp((1 - r2) * 9) * 255;
    });
    tex.rocks = [];
    for (let s = 0; s < 3; s++) {
      tex.rocks.push(
        makeImage(64, 64, (x, y, o) => {
          const dx = (x - 31.5) / 32;
          const dy = (y - 31.5) / 32;
          const d = Math.hypot(dx, dy);
          const th = Math.atan2(dy, dx);
          const lim = 0.62 + 0.34 * vnoise(Math.cos(th) * 1.6 + s * 5, Math.sin(th) * 1.6, 60 + s, 0);
          if (d > lim) return;
          const lit = clamp(0.55 - dx * 0.4 - dy * 0.4 + 0.5 * (fbm(x * 0.12, y * 0.12, 70 + s, 3) - 0.4));
          const rim = clamp((d - lim * 0.78) / (lim * 0.22));
          o[0] = 70 * lit + 230 * rim * 0.5;
          o[1] = 46 * lit + 90 * rim * 0.5;
          o[2] = 36 * lit + 30 * rim * 0.5;
          o[3] = clamp((lim - d) * 24) * 255;
        }),
      );
    }
  },
  () => {
    tex.ice = makeImage(256, 256, (x, y, o) => {
      const n = fbm(x * 0.02, y * 0.02, 81, 5);
      const crack = Math.pow(ridge(x * 0.035, y * 0.035, 87, 4), 12);
      const facet = Math.pow(ridge(x * 0.012 + 3, y * 0.012, 93, 3), 6);
      o[0] = lerp(110, 205, n) + crack * 150 + facet * 25;
      o[1] = lerp(180, 236, n) + crack * 100 + facet * 20;
      o[2] = lerp(228, 255, n);
      o[3] = 255;
    });
    tex.icePat = tex.ice.getContext("2d")!.createPattern(tex.ice, "repeat");
  },
];
let built = 0;

/** Makes whatever textures are not made yet (a few milliseconds each; `warmFx` does it ahead of time, one a moment). */
function ensureTex(): Tex {
  while (built < BUILD.length) BUILD[built++]();
  return tex as Tex;
}

/** The textures all four finishers use, made ahead of time in idle moments (one at a time, so no frame has to make them). */
export function warmFx(): void {
  if (typeof document === "undefined") return;
  const next = () => {
    if (built >= BUILD.length) return;
    BUILD[built++]();
    window.setTimeout(next, 60);
  };
  window.setTimeout(next, 0);
}

// ───────────────────────────── particles

interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  age: number;
  life: number;
  r: number;
  r1: number | null;
  col: string;
  a: number;
  /** "puff": a textured wisp of `pal` (turning at `vr`); "flare": a bright star; "streak": a spark's line; "glow": a plain soft light. */
  kind: "glow" | "puff" | "streak" | "flare";
  fade: number;
  pal: Pal;
  tex: number;
  rot: number;
  vr: number;
  /** A fixed random number: when there is more to draw than the budget allows, the ones with the highest numbers are the ones left out (the same ones every frame, so nothing flickers). */
  keep: number;
  /** Made again every frame: thinned out when frames are late. */
  drop?: boolean;
  /** A spark that is pulled in to (tx, ty). */
  pull?: boolean;
  tx?: number;
  ty?: number;
}

interface Card {
  el: HTMLElement;
  cx: number;
  cy: number;
  w: number;
  h: number;
  // how it is moved: sideways (ox, oy), up off the table (z), spun flat (rot), tumbled in 3D (tx, ty), grown or squeezed (sc, sx, sy), and faded (op)
  ox: number;
  oy: number;
  z: number;
  rot: number;
  tx: number;
  ty: number;
  sc: number;
  sx: number;
  sy: number;
  op: number;
  /** Its body in the physics engine (see physics.ts). */
  body: Body;
  /** Void Collapse: where the pull began for it. */
  pull?: { d0: number; t0: number };
  hidden: boolean;
  /** Drawn on the canvas from its art (the real card is hidden): moving a real card costs the browser a lot in every frame; a picture on the canvas costs almost nothing. */
  sprite?: boolean;
  /** Has been tilted in 3D (and then keeps its tilt transform, even at rest: switching it off would move the card to another layer in mid-motion). */
  tilted?: boolean;
  last: string;
  /** What it already had on it (a tapped card is turned, an attacker is raised): kept, and the finisher's movement is added to it. */
  base: { x: number; y: number; rot: number; scale: number };
  art: HTMLImageElement | null;
  saved: Record<"translate" | "rotate" | "scale" | "transform" | "opacity" | "filter" | "transition" | "visibility" | "willChange", string>;
}

// The state of the one finisher that is playing (only one plays at a time, so these are module-wide).
let ctx: CanvasRenderingContext2D;
let W = 0;
let H = 0;
let curRes = 1;
// the part of the page the canvas covers (all of it, or, for the Reaper's aftermath, the loser's mat and the room round it: a canvas a third of the size costs a third as much)
let offX = 0;
let offY = 0;
let regW = 0;
let regH = 0;
let P: Part[] = [];
let cards: Card[] = [];
let mat = { x: 0, y: 0, w: 0, h: 0 };
let T = { x: 0, y: 0 };
let shake = 0;
let quality = 1;
let matEl: HTMLElement | null = null;

const kick = (a: number) => (shake = Math.max(shake, a));

function emit(o: Partial<Part>): void {
  if (o.drop && quality < 1 && Math.random() > quality) return;
  P.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, age: 0, life: 1, r: 4, r1: null, col: "255,255,255", a: 1, kind: "glow", fade: 1, pal: "fire", tex: (Math.random() * 3) | 0, rot: rnd(0, TAU), vr: rnd(-1.2, 1.2), keep: Math.random(), ...o });
}

function stepP(dt: number): void {
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    p.age += dt;
    if (p.age >= p.life) {
      P[i] = P[P.length - 1];
      P.pop();
      continue;
    }
    const dr = Math.exp(-p.drag * dt);
    p.vx *= dr;
    p.vy = p.vy * dr + p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  }
}

/** A picture drawn turned about its middle and `r` wide on each side (the canvas is put back to its usual scale after). */
function stamp(img: HTMLCanvasElement, x: number, y: number, r: number, rot: number, a: number): void {
  ctx.globalAlpha = a;
  const c = Math.cos(rot) * curRes;
  const s = Math.sin(rot) * curRes;
  ctx.setTransform(c, s, -s, c, (x - offX) * curRes, (y - offY) * curRes);
  ctx.drawImage(img, -r, -r, r * 2, r * 2);
  ctx.setTransform(curRes, 0, 0, curRes, -offX * curRes, -offY * curRes);
}

/** A soft round light in `col` ("r,g,b") (a plain gradient, for the small sparks and halos). */
const glows = new Map<string, HTMLCanvasElement>();
function glow(x: number, y: number, r: number, col: string, a = 1): void {
  let c = glows.get(col);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.2, `rgba(${col},.9)`);
    gr.addColorStop(0.55, `rgba(${col},.25)`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glows.set(col, c);
  }
  ctx.globalAlpha = a;
  ctx.drawImage(c, x - r, y - r, r * 2, r * 2);
}

/** How much the textured puffs may cover in one frame, in screens (the cost of a frame is mostly how many pixels are painted, so this keeps it bounded however many are made). */
let overdraw = 2.4;

function drawP(): void {
  const t = tex as Tex;
  // the budget: if the puffs would cover more than `overdraw` screens, the ones with the highest `keep` fade out (the others are drawn as usual)
  let area = 0;
  for (const p of P) {
    if (p.kind !== "puff") continue;
    const r = lerp(p.r, p.r1 ?? p.r, p.age / p.life);
    area += r * r * 4;
  }
  const ratio = area > 0 ? Math.min(1, (regW * regH * overdraw) / area) : 1;
  ctx.globalCompositeOperation = "source-over";
  for (const p of P) {
    if (p.kind !== "puff" || ADD_PAL[p.pal]) continue;
    const k = p.age / p.life;
    const f = clamp(1 + (ratio - p.keep) * 6);
    if (f <= 0) continue;
    stamp(t.puff[p.pal][p.tex], p.x, p.y, lerp(p.r, p.r1 ?? p.r, k), p.rot, p.a * f * Math.pow(1 - k, p.fade) * Math.min(1, k * 7));
  }
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const p of P) {
    const k = p.age / p.life;
    const a = p.a * Math.pow(1 - k, p.fade);
    const r = lerp(p.r, p.r1 ?? p.r, k);
    if (p.kind === "puff") {
      const f = clamp(1 + (ratio - p.keep) * 6);
      if (ADD_PAL[p.pal] && f > 0) stamp(t.puff[p.pal][p.tex], p.x, p.y, r, p.rot, a * f * Math.min(1, k * 7));
    } else if (p.kind === "streak") {
      ctx.globalAlpha = a;
      ctx.strokeStyle = `rgb(${p.col})`;
      ctx.lineWidth = r;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
      ctx.stroke();
    } else if (p.kind === "flare") {
      stamp(t.flare, p.x, p.y, r, p.rot * 0.2, a);
    } else glow(p.x, p.y, r, p.col, a);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** A jagged line between two points (the middle of each piece is pushed sideways, again and again): lightning, cracks. */
function jag(x0: number, y0: number, x1: number, y1: number, disp: number, depth: number): Pt[] {
  let pts: Pt[] = [[x0, y0], [x1, y1]];
  for (let d = 0; d < depth; d++) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push(a, [(a[0] + b[0]) / 2 + rnd(-disp, disp), (a[1] + b[1]) / 2 + rnd(-disp, disp)]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
    disp *= 0.56;
  }
  return pts;
}

/** A glowing line: a wide faint stroke, a narrower one, and a white-hot core, added to what is behind. */
function strokePath(pts: Pt[], widths: number[], alphas: number[], col: string, core = "255,255,255"): void {
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let k = 0; k < widths.length; k++) {
    ctx.globalAlpha = alphas[k];
    ctx.lineWidth = widths[k];
    ctx.strokeStyle = `rgb(${k === widths.length - 1 ? core : col})`;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function flashRect(a: number, col = "255,255,255"): void {
  if (a <= 0.003) return;
  ctx.fillStyle = `rgba(${col},${a})`;
  ctx.fillRect(0, 0, W, H);
}

/** A ring lying flat on the table (a circle squashed to `sy` tall). */
function ring(x: number, y: number, r: number, sy: number, w: number, col: string, a: number): void {
  if (a <= 0.003 || r < 1) return;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = a;
  ctx.strokeStyle = `rgb(${col})`;
  ctx.lineWidth = Math.max(0.5, w);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * sy, 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** A decal lying on the table: a picture `r` wide on each side, squashed to `sy` tall. */
function decal(img: HTMLCanvasElement, x: number, y: number, r: number, sy: number, a: number, add = false): void {
  if (a <= 0.003 || r < 1) return;
  ctx.globalCompositeOperation = add ? "lighter" : "source-over";
  ctx.globalAlpha = a;
  ctx.setTransform(curRes, 0, 0, curRes * sy, (x - offX) * curRes, y * curRes * sy - offY * curRes);
  ctx.drawImage(img, -r, -r, r * 2, r * 2);
  ctx.setTransform(curRes, 0, 0, curRes, -offX * curRes, -offY * curRes);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// ───────────────────────────── the loser's cards

function applyCards(): void {
  for (const c of cards) {
    if (c.sprite) {
      if (c.last !== "sprite") {
        c.last = "sprite";
        c.el.style.visibility = "hidden"; // (its picture is on the canvas now)
      }
      continue;
    }
    const key = `${c.ox.toFixed(2)}|${c.oy.toFixed(2)}|${c.z.toFixed(2)}|${c.rot.toFixed(2)}|${c.tx.toFixed(2)}|${c.ty.toFixed(2)}|${c.sc.toFixed(4)}|${c.sx.toFixed(3)}|${c.sy.toFixed(3)}|${c.op.toFixed(2)}|${c.hidden}`;
    if (key === c.last) continue; // (nothing moved: nothing is written)
    c.last = key;
    const st = c.el.style;
    const lift = 1 + c.z * 0.0011; // (higher is nearer to us: bigger)
    const s = c.base.scale * c.sc * lift;
    st.translate = `${(c.base.x + c.ox).toFixed(2)}px ${(c.base.y + c.oy - c.z * 0.25).toFixed(2)}px`;
    st.rotate = `${(c.base.rot + c.rot).toFixed(2)}deg`;
    st.scale = `${(s * c.sx).toFixed(4)} ${(s * c.sy).toFixed(4)}`;
    if (c.tx || c.ty) c.tilted = true;
    if (c.tilted) st.transform = `perspective(700px) rotateX(${c.tx.toFixed(2)}deg) rotateY(${c.ty.toFixed(2)}deg)`;
    st.opacity = c.op.toFixed(2);
    st.visibility = c.hidden ? "hidden" : c.saved.visibility;
  }
}

// The cards are bodies in our own physics engine (physics.ts): thrown, they fly up, tumble, land, bounce, rock on their edges, knock into each other and the screen's edges and
// slide to a stop; or a force pulls them. The engine works in small fixed steps; what is drawn is interpolated between them, so it is smooth whatever the frame rate.
let world: World | null = null;
const pose: Pose = { x: 0, y: 0, angle: 0, z: 0, tx: 0, ty: 0 };

function buildWorld(): void {
  world = new World();
  // the table the cards stay on: the mat and a little room round it (not the whole screen: thrown cards used to end up in the corner of the screen, out of sight)
  const x0 = Math.max(0, mat.x - 90);
  const y0 = Math.max(0, mat.y - 60);
  const x1 = Math.min(W, mat.x + mat.w + 90);
  const y1 = Math.min(H, mat.y + mat.h + 70);
  world.addWalls(x1 - x0, y1 - y0, x0, y0);
  for (const c of cards) world.add(c.body);
  let lastKnock = 0;
  world.onImpact = (v) => {
    const now = performance.now();
    if (now - lastKnock < 80) return; // (a pile of cards is a few sounds, not a roar)
    lastKnock = now;
    playSound(v > 520 ? "cardSlam" : "cardKnock");
  };
}

/** Moves the world on and puts every card where its body is. */
function cardsPhys(dt: number): void {
  if (!world) return;
  world.update(dt);
  for (const c of cards) {
    if (c.body.kinematic) continue;
    world.pose(c.body, pose);
    c.ox = pose.x - c.cx;
    c.oy = pose.y - c.cy;
    c.z = pose.z;
    c.rot = pose.angle * toDegrees;
    c.tx = pose.tx;
    c.ty = pose.ty;
  }
  drawCards();
}

/** Throws every card away from the target (the nearer, the harder), up into the air and spinning and tumbling. */
function blast(strength: number, squash = 0.6): void {
  for (const c of cards) if (c.art) c.sprite = true; // (from here on they are pictures on the canvas)
  world?.blast(T.x, T.y, strength, squash);
}

/** A knock to one card: speed (pixels a second), spin (radians a second), tilt speed (degrees a second). */
function jolt(c: Card, k: { vx?: number; vy?: number; vz?: number; w?: number; vtx?: number; vty?: number }): void {
  world?.kick(c.body, k);
}

/**
 * Scorches the cards: a colour is laid over each one on the canvas (following the card as it flies), fading in. (A CSS filter on the cards would make the browser redraw every
 * flying card in every frame, which is what costs the most on a computer that is struggling; this is one flat fill per card.)
 */
let tint: { rgb: string; a: number; start: number } | null = null;
function setTint(rgb: string, a: number): void {
  tint = { rgb, a, start: performance.now() };
}
/**
 * Draws the cards that have left the table's DOM: each is its own art (cut to the card's shape, as the page shows it), with its shadow on the table (which stays under it as it
 * flies up: the higher, the fainter and wider), tipped on its edge when it tumbles, and the scorch colour over it. A card that has no art to draw (it is a plain frame) stays a
 * real card, and gets the scorch colour laid over it.
 */
function drawCards(): void {
  const ta = tint ? tint.a * Math.min(1, (performance.now() - tint.start) / 220) : 0;
  for (const c of cards) {
    if (c.hidden || c.op < 0.03) continue;
    if (!c.sprite && !ta) continue;
    const lift = 1 + c.z * 0.0011;
    const sx = c.base.scale * c.sc * lift * c.sx;
    const sy = c.base.scale * c.sc * lift * c.sy;
    const px = c.cx + c.ox + c.base.x;
    const py = c.cy + c.oy + c.base.y;
    if (c.sprite && c.z > 1) {
      // the shadow on the table
      ctx.globalAlpha = c.op * 0.32 * (1 - clamp(c.z / 260) * 0.7);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(px, py + c.h * 0.08, (c.w / 2) * (1 + c.z * 0.002) * 0.95, (c.h / 2) * 0.9 * (1 + c.z * 0.002), 0, 0, TAU);
      ctx.fill();
    }
    ctx.save();
    ctx.globalAlpha = c.op;
    ctx.translate(px, py - c.z * 0.25);
    ctx.rotate(((c.base.rot + c.rot) * Math.PI) / 180);
    ctx.scale(sx, sy * Math.cos((Math.min(70, Math.abs(c.tx)) * Math.PI) / 180)); // (a card tipped on its edge is shorter)
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-c.w / 2, -c.h / 2, c.w, c.h, c.w * 0.06);
    else ctx.rect(-c.w / 2, -c.h / 2, c.w, c.h);
    if (c.sprite && c.art) {
      ctx.save();
      ctx.clip();
      const iw = c.art.naturalWidth || c.art.width;
      const ih = c.art.naturalHeight || c.art.height;
      const k = Math.max(c.w / iw, c.h / ih); // (cut to the card as the page does: cover, centred)
      ctx.drawImage(c.art, (iw - c.w / k) / 2, (ih - c.h / k) / 2, c.w / k, c.h / k, -c.w / 2, -c.h / 2, c.w, c.h);
      if (ta) {
        ctx.fillStyle = `rgba(${tint!.rgb},${ta})`;
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,.45)";
      ctx.lineWidth = 1.5 / Math.max(0.5, sx);
      ctx.stroke();
    } else if (ta) {
      ctx.fillStyle = `rgba(${tint!.rgb},${ta})`;
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ───────────────────────────── the finishers

interface Fx {
  dur: number;
  /** Played when it starts (null: the caller makes its own sounds). */
  sound: Sound | null;
  setup: () => void;
  /** Draws anything that is only made for this finisher (the pieces of the shattering mat) once, nearly invisible, so the graphics chip has them before the first real frame. */
  warm?: () => void;
  frame: (t: number, dt: number) => void;
}

function judgment(): Fx {
  let st = { lastBolt: 0, bolt: null as Pt[] | null, branches: [] as Pt[][], arcs: [] as { pts: Pt[]; age: number; life: number }[], nextArc: 1050, hit: false, hit2: false, flash: 0, lit: 0 };
  /** Storm clouds drifting across the top of the screen (dark, and lit from inside by the lightning). */
  const clouds = (alpha: number, lit: number, t: number) => {
    const t2 = tex as Tex;
    const w = Math.max(W, 900) * 0.8;
    const h = H * 0.62;
    for (const [a, speed, y] of [[alpha, 0.012, -h * 0.1], [alpha * 0.7, 0.03, -h * 0.28]] as const) {
      const off = (t * speed * w * 0.05) % w;
      for (let x = -off; x < W; x += w) {
        ctx.globalAlpha = a;
        ctx.drawImage(t2.cloud, x, y, w, h);
      }
    }
    if (lit > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      const off = (t * 0.012 * w * 0.05) % w;
      for (let x = -off; x < W; x += w) {
        ctx.globalAlpha = Math.min(1, lit * alpha);
        ctx.drawImage(t2.cloudLit, x, -h * 0.1, w, h);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
  };
  return {
    dur: 5400,
    sound: "judgment",
    setup() {
      st = { lastBolt: 0, bolt: null, branches: [], arcs: [], nextArc: 1050, hit: false, hit2: false, flash: 0, lit: 0 };
    },
    frame(t, dt) {
      const t2 = tex as Tex;
      // the sky goes dark and cold, and the storm clouds roll in
      const sky = sm(0, 800, t) * (1 - sm(3200, 4800, t));
      ctx.fillStyle = `rgba(5,4,24,${0.62 * sky})`;
      ctx.fillRect(0, 0, W, H);
      if (sky > 0.01) clouds(0.85 * sky, st.lit, t);
      const ox = T.x;
      // power gathers: sparks fly in to a turning ball of plasma above the target
      if (t < 920) {
        const k = sm(0, 900, t);
        for (let i = 0; i < 3; i++) {
          const a = rnd(0, TAU);
          const r = rnd(160, 340) * (1.1 - k * 0.2);
          emit({ x: ox + Math.cos(a) * r, y: 40 + Math.sin(a) * r * 0.6, life: 0.5, r: rnd(3, 7), col: "150,170,255", a: 0.9, pull: true, tx: ox, ty: 40, drop: true });
        }
        const rr = lerp(6, 70, k * k) * (0.9 + 0.1 * Math.sin(t * 0.09));
        ctx.globalCompositeOperation = "lighter";
        stamp(t2.puff.plasma[0], ox, 40, rr * 2.6, t * 0.004, 0.85);
        stamp(t2.puff.plasma[1], ox, 40, rr * 1.7, -t * 0.007, 0.9);
        stamp(t2.flare, ox, 40, rr * 2.2, 0, 0.9 * k);
        glow(ox, 40, rr * 0.6, "255,255,255", 1);
        ctx.globalCompositeOperation = "source-over";
        ring(T.x, T.y, 70 + 30 * Math.sin(t * 0.012), 0.5, 2, "160,170,255", 0.5 * k);
      }
      for (const p of P) {
        if (p.pull) {
          const k = p.age / p.life;
          p.x = lerp(p.x, p.tx!, 0.12 + k * 0.1);
          p.y = lerp(p.y, p.ty!, 0.12 + k * 0.1);
        }
      }
      // the strike
      if (!st.hit && t >= 900) {
        st.hit = true;
        st.flash = 1;
        kick(26);
        blast(950);
        setTint("8,10,26", 0.5);
        for (let i = 0; i < 70; i++) {
          const a = rnd(0, TAU);
          const s = rnd(120, 800);
          emit({ x: T.x, y: T.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7 - 260, g: 700, drag: 0.6, life: rnd(0.5, 1.5), r: rnd(2, 5), col: i % 3 ? "170,200,255" : "255,255,255", kind: "streak" });
        }
        for (let i = 0; i < 12; i++) {
          const a = rnd(0, TAU);
          const s = rnd(40, 300);
          emit({ x: T.x, y: T.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5, drag: 2.5, life: rnd(0.35, 0.7), r: rnd(40, 70), r1: rnd(90, 150), pal: "plasma", a: 0.9, kind: "puff" }); // a ball of lightning
        }
        for (let i = 0; i < 14; i++) emit({ x: T.x + rnd(-40, 40), y: T.y + rnd(-10, 10), vy: -rnd(30, 120), vx: rnd(-80, 80), drag: 1, life: rnd(1, 2), r: 40, r1: 100, pal: "smoke", a: 0.5, kind: "puff" });
        for (let i = 0; i < 10; i++) emit({ x: T.x + rnd(-60, 60), y: T.y + rnd(-20, 20), vx: rnd(-200, 200), vy: rnd(-200, 100), drag: 2, life: rnd(0.2, 0.5), r: rnd(16, 36), kind: "flare", a: 1 });
      }
      if (!st.hit2 && t >= 1180) {
        st.hit2 = true;
        st.flash = Math.max(st.flash, 0.45);
        kick(14);
        for (const c of cards) {
          if (c.z < 40) jolt(c, { vz: rnd(200, 420), w: rnd(-2.8, 2.8) }); // the second blow throws them up again
        }
      }
      st.lit = st.flash * 1.2;
      if (t >= 900 && t < 1500) {
        // the bolt flickers: it is made again every few frames
        if (!st.bolt || t - st.lastBolt > 40) {
          st.lastBolt = t;
          const pts = jag(T.x + rnd(-40, 40), -30, T.x, T.y, 130, 6);
          st.bolt = pts;
          st.branches = [];
          for (let b = 0; b < 4; b++) {
            const i = Math.floor(rnd(0.15, 0.85) * pts.length);
            const a = rnd(-1, 1) + (Math.random() < 0.5 ? 0.6 : -0.6) + Math.PI / 2;
            const [bx, by] = pts[i];
            st.branches.push(jag(bx, by, bx + Math.cos(a) * rnd(130, 280), by + Math.sin(a) * rnd(120, 240), 40, 4));
          }
        }
        const a = t < 1150 ? 1 : Math.max(0.25, 1 - (t - 1150) / 350) * (1 - sm(1300, 1500, t));
        st.lit = Math.max(st.lit, a * 0.9);
        strokePath(st.bolt, [34, 14, 5], [0.16 * a, 0.5 * a, a], "120,130,255");
        for (const br of st.branches) strokePath(br, [14, 6, 2.2], [0.14 * a, 0.5 * a, a], "130,150,255");
        ctx.globalCompositeOperation = "lighter";
        stamp(t2.flare, T.x, T.y, 230 * a, 0, a);
        ctx.globalCompositeOperation = "source-over";
      }
      if (st.hit) {
        const k = (t - 900) / 1000;
        // the ground: a scorch that spreads (a ragged black decal with blue-white veins that crackle), and a bright core that cools
        const sr = lerp(0, 215, sm(0, 0.35, k));
        const fade = 1 - sm(3000, 4600, t);
        decal(t2.scorch, T.x, T.y, sr, 0.55, fade);
        decal(t2.scorch, T.x, T.y, sr, 0.55, 0.9 * fade * (1 - sm(0, 2.4, k)) * (0.7 + 0.3 * Math.sin(t * 0.05)), true);
        const core = 1 - sm(0, 1.6, k);
        glow(T.x, T.y, 130 * core + 8, "160,180,255", 0.8 * core);
        // shockwaves
        ring(T.x, T.y, sm(0, 0.9, k) * 520, 0.5, lerp(26, 2, sm(0, 0.9, k)), "170,190,255", 1 - sm(0.1, 0.9, k));
        ring(T.x, T.y, sm(0.08, 1, k) * 340, 0.5, lerp(14, 1, sm(0.08, 1, k)), "255,255,255", 0.8 * (1 - sm(0.2, 1, k)));
        // electricity crawling over the mat, and jumping from card to card (a card it jumps to is jolted)
        if (t >= st.nextArc && t < 3700) {
          st.nextArc = t + rnd(35, 75) / (quality < 1 ? 0.7 : 1);
          const hop = Math.random() < 0.45 && cards.length > 0;
          const c = cards[Math.floor(Math.random() * cards.length)];
          const a = rnd(0, TAU);
          const L = rnd(100, 300);
          const sx = hop ? c.cx + c.ox : T.x;
          const sy = hop ? c.cy + c.oy : T.y;
          st.arcs.push({ pts: jag(sx, sy, hop ? T.x : T.x + Math.cos(a) * L, hop ? T.y : T.y + Math.sin(a) * L * 0.55, 26, 4), age: 0, life: rnd(0.1, 0.2) });
          if (hop && c.z < 4) {
            jolt(c, { vz: rnd(120, 260), w: rnd(-3.5, 3.5), vtx: rnd(-300, 300), vx: rnd(-80, 80), vy: rnd(-50, 50) }); // jolted into the air
            for (let i = 0; i < 4; i++) emit({ x: c.cx + c.ox, y: c.cy + c.oy, vx: rnd(-200, 200), vy: rnd(-260, 0), g: 600, drag: 1, life: rnd(0.3, 0.7), r: 2.5, col: "170,210,255", kind: "streak" });
          }
        }
        for (let i = st.arcs.length - 1; i >= 0; i--) {
          const A = st.arcs[i];
          A.age += dt;
          if (A.age > A.life) {
            st.arcs.splice(i, 1);
            continue;
          }
          const a = 1 - A.age / A.life;
          strokePath(A.pts, [10, 3.5, 1.4], [0.18 * a, 0.6 * a, a], "100,190,255");
        }
        cardsPhys(dt);
        if (t < 3600 && Math.random() < 0.6) for (const c of cards) if (Math.random() < 0.15) emit({ x: c.cx + c.ox + rnd(-30, 30), y: c.cy + c.oy + rnd(-45, 45), life: 0.2, r: rnd(10, 22), kind: "flare", a: 0.9, drop: true });
      }
      stepP(dt);
      drawP();
      st.flash *= Math.exp(-6 * dt);
      flashRect(st.flash * 0.7, "230,235,255");
    },
  };
}

function voidCollapse(): Fx {
  type Dot = { a: number; r: number; s: number };
  let st = { disk: [] as Dot[], boom: false, flash: 0 };
  let voidNow = 0;
  return {
    dur: 6400,
    sound: "voidCollapse",
    setup() {
      st = { disk: [], boom: false, flash: 0 };
      voidNow = 0;
      if (world) {
        // the hole's pull on every card that has started to fall, applied in every fixed step
        world.onStep = () => {
          for (const c of cards) {
            if (!c.pull || c.hidden) continue;
            const b = c.body;
            const tau = (voidNow - c.pull.t0) / 1000;
            const dx = T.x - b.x;
            const dy = T.y - b.y;
            const d = Math.hypot(dx, dy) || 1;
            const k = 500 + 3000 * sm(0, 1.2, tau) + 9000 * Math.max(0, tau - 0.9) ** 2; // (it grows, so every card does arrive)
            const sw = 0.5 * (1 - sm(0.7, 1.6, tau)); // the sideways swirl, which fades
            b.fx += (dx / d) * k + (-dy / d) * k * sw - b.vx * 1.1;
            b.fy += (dy / d) * k + (dx / d) * k * sw - b.vy * 1.1;
            const orbit = ((b.x - T.x) * b.vy - (b.y - T.y) * b.vx) / (d * d); // how fast it goes round the hole: it spins with it
            b.w += (orbit * 0.9 - b.w) * 0.05;
          }
        };
      }
    },
    frame(t, dt) {
      const t2 = tex as Tex;
      // the world darkens round it
      const dk = sm(500, 2400, t) * (1 - sm(4700, 6100, t));
      if (dk > 0.01) {
        const g = ctx.createRadialGradient(T.x, T.y, 80, T.x, T.y, Math.max(W, H) * 0.7);
        g.addColorStop(0, `rgba(10,0,20,${0.15 * dk})`);
        g.addColorStop(1, `rgba(2,0,8,${0.78 * dk})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      // the hole's size: born small, swells, then is crushed down just before it blows
      const R = t < 3600 ? lerp(2, 78, sm(300, 3000, t)) * (1 + 0.03 * Math.sin(t * 0.03)) : lerp(78, 3, Math.pow(sm(3600, 4300, t), 2.2));
      if (t < 4300) kick(sm(500, 3600, t) * 3.2 * (t > 3600 ? 2 : 1));
      const tilt = -0.2;
      const sq = 0.36;
      const crush = t > 3600 ? 1 + 4 * sm(3600, 4300, t) : 1;
      // matter spirals in: a few sparks, as well as the swirled disc
      if (t > 500 && t < 4250) for (let i = 0; i < Math.round(3 * quality); i++) st.disk.push({ a: rnd(0, TAU), r: rnd(150, 340) * (0.5 + 0.5 * sm(500, 2200, t)), s: rnd(0.8, 1.2) });
      for (let i = st.disk.length - 1; i >= 0; i--) {
        const d = st.disk[i];
        d.a += (320 / Math.pow(d.r, 1.12)) * dt * 1.6 * d.s * crush;
        d.r -= (28 + 150 * Math.pow(1 - clamp(d.r / 340), 1.4)) * dt * crush;
        if (d.r < R * 0.7) st.disk.splice(i, 1);
      }
      const dots = (back: boolean) => {
        ctx.globalCompositeOperation = "lighter";
        const ct = Math.cos(tilt);
        const sn = Math.sin(tilt);
        for (const d of st.disk) {
          if (Math.sin(d.a) < 0 !== back) continue;
          const x = Math.cos(d.a) * d.r;
          const y = Math.sin(d.a) * d.r * sq;
          const near = 1 - clamp((d.r - R) / 260);
          glow(T.x + x * ct - y * sn, T.y + x * sn + y * ct, 2 + near * 5, near > 0.55 ? "255,190,120" : "170,100,255", 0.35 + near * 0.65);
        }
        ctx.globalCompositeOperation = "source-over";
      };
      /** The disc's picture, turning, flattened and tilted; `back` is its far half (above the hole), the other half passes in front. */
      const disk = (vis: number, back: boolean) => {
        const S = R * 5;
        ctx.save();
        ctx.beginPath();
        if (back) ctx.rect(0, 0, W, T.y);
        else ctx.rect(0, T.y, W, H - T.y);
        ctx.clip();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.95 * vis;
        const ct = Math.cos(tilt);
        const sn = Math.sin(tilt);
        const sp = t * 0.0009 * crush;
        // turn about the middle, then flatten: (tilt) * (squash) * (spin)
        const c1 = Math.cos(sp);
        const s1 = Math.sin(sp);
        ctx.setTransform(curRes * ct * c1 - curRes * sn * sq * s1, curRes * sn * c1 + curRes * ct * sq * s1, -curRes * ct * s1 - curRes * sn * sq * c1, -curRes * sn * s1 + curRes * ct * sq * c1, T.x * curRes, T.y * curRes);
        ctx.drawImage(t2.disk, -S, -S, S * 2, S * 2);
        ctx.restore();
        ctx.setTransform(curRes, 0, 0, curRes, 0, 0);
      };
      if (t > 450 && t < 4400) {
        const vis = sm(450, 1100, t) * (1 - sm(4200, 4380, t));
        ctx.globalCompositeOperation = "lighter";
        stamp(t2.puff.violet[0], T.x, T.y, R * 4.2, t * 0.0004, 0.7 * vis); // a violet haze turning round it
        stamp(t2.puff.violet[1], T.x, T.y, R * 3.0, -t * 0.0007, 0.6 * vis);
        ctx.globalCompositeOperation = "source-over";
        disk(vis, true);
        dots(true);
        // the hole itself and its bright edge
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(T.x, T.y, R, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "rgb(255,215,170)";
        ctx.globalAlpha = 0.9 * vis;
        ctx.lineWidth = Math.max(1.5, R * 0.07);
        ctx.beginPath();
        ctx.arc(T.x, T.y, R * 1.04, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = "rgb(190,110,255)";
        ctx.globalAlpha = 0.4 * vis;
        ctx.lineWidth = Math.max(3, R * 0.22);
        ctx.beginPath();
        ctx.arc(T.x, T.y, R * 1.12, 0, TAU);
        ctx.stroke();
        // light bent round the hole
        ctx.globalAlpha = 0.28 * vis;
        ctx.strokeStyle = "rgb(255,200,150)";
        ctx.lineWidth = Math.max(1, R * 0.05);
        ctx.beginPath();
        ctx.ellipse(T.x, T.y, R * 1.45, R * 1.2, tilt, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        disk(vis, false);
        dots(false);
      }
      // the cards: they tremble and rise off the table (held up by the script), then the hole's PULL takes them. The pull is a real force (grows, swirls, drag) applied to their
      // bodies in the physics engine, so they curve in, knock into each other, spin as they fall, and are stretched thin as they come close.
      voidNow = t;
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const b = c.body;
        const t0 = 1300 + i * 230;
        const rise = sm(t0 - 450, t0, t);
        if (rise <= 0 || c.hidden) continue;
        if (c.art) c.sprite = true;
        if (t < t0) {
          b.kinematic = true;
          c.ox = Math.sin(t * 0.05 + i) * 3 * rise;
          c.oy = Math.cos(t * 0.06 + i * 2) * 3 * rise;
          c.z = rise * 46 + Math.sin(t * 0.006 + i) * 6 * rise;
          c.tx = Math.sin(t * 0.004 + i) * 16 * rise;
          c.ty = Math.cos(t * 0.005 + i * 1.7) * 16 * rise;
          c.rot = Math.sin(t * 0.01 + i) * 4 * rise;
          continue;
        }
        if (!c.pull) {
          // the pull begins, from where it hangs
          c.pull = { d0: Math.max(120, Math.hypot(c.cx + c.ox - T.x, c.cy + c.oy - T.y)), t0: t };
          b.kinematic = false;
          b.hover = true;
          b.asleep = false;
          b.x = b.px = c.cx + c.ox;
          b.y = b.py = c.cy + c.oy;
          b.angle = b.pa = (c.rot * Math.PI) / 180;
          b.vx = b.vy = b.w = 0;
          b.vtx = b.vty = 0;
          b.tx = b.ptx = c.tx;
          b.ty = b.pty = c.ty;
          b.z = b.pz = c.z;
        }
      }
      if (world) {
        world.update(dt);
        for (const c of cards) {
          if (!c.pull || c.hidden) continue;
          const b = c.body;
          world.pose(b, pose);
          c.ox = pose.x - c.cx;
          c.oy = pose.y - c.cy;
          c.rot = pose.angle * toDegrees;
          const d = Math.hypot(pose.x - T.x, pose.y - T.y);
          const e = clamp(1 - (d - R) / Math.max(1, c.pull.d0 - R));
          const e2 = e * e;
          b.z = 46 * (1 - e2 * 0.7) + Math.sin(t * 0.006 + c.cx) * 5 * (1 - e);
          c.z = b.z;
          c.tx = pose.tx * (1 - e);
          c.ty = pose.ty * (1 - e);
          c.sc = 1 - e2 * 0.92;
          c.sy = 1 + e2 * 1.1; // stretched as it is pulled in
          c.sx = 1 - e2 * 0.5;
          c.op = 1 - sm(0.8, 1, e);
          if (Math.random() < 0.5) emit({ x: pose.x, y: pose.y, life: 0.5, r: rnd(14, 26), pal: "violet", a: 0.8, kind: "puff", vx: rnd(-20, 20), vy: rnd(-20, 20), drag: 0, drop: true });
          if (d < R * 0.9 + 6 && t - c.pull.t0 > 900) c.hidden = true; // (gone into the hole)
          else if (t > 3700) c.hidden = true;
        }
      }
      drawCards();
      // the end of it: a flash, rings, rays, and everything thrown outward
      if (!st.boom && t >= 4300) {
        st.boom = true;
        st.flash = 1;
        kick(28);
        st.disk.length = 0;
        for (const c of cards) c.hidden = true;
        for (let i = 0; i < 100; i++) {
          const a = rnd(0, TAU);
          const s = rnd(200, 1100);
          emit({ x: T.x, y: T.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, drag: 1.3, life: rnd(0.6, 1.6), r: rnd(2, 4.5), col: i % 2 ? "220,170,255" : "255,255,255", kind: "streak" });
        }
        for (let i = 0; i < 26; i++) {
          const a = rnd(0, TAU);
          const s = rnd(60, 420);
          emit({ x: T.x, y: T.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, drag: 1.6, life: rnd(0.8, 2), r: 30, r1: rnd(80, 150), pal: "violet", a: 0.75, kind: "puff" });
        }
        for (let i = 0; i < 8; i++) emit({ x: T.x + rnd(-30, 30), y: T.y + rnd(-10, 10), vx: rnd(-120, 120), vy: rnd(-120, 40), drag: 2, life: rnd(0.3, 0.6), r: rnd(30, 60), kind: "flare", a: 1 });
      }
      if (st.boom) {
        const k = (t - 4300) / 1000;
        const ray = 1 - sm(0, 0.7, k);
        if (ray > 0.01) {
          // rays of light, fading along their length
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = ray;
          const L = 120 + 800 * sm(0, 0.5, k);
          const rg = ctx.createRadialGradient(T.x, T.y, 0, T.x, T.y, L);
          rg.addColorStop(0, "rgba(235,215,255,.75)");
          rg.addColorStop(0.5, "rgba(190,140,255,.22)");
          rg.addColorStop(1, "rgba(160,100,255,0)");
          ctx.fillStyle = rg;
          ctx.beginPath();
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * TAU + 0.1 + k * 0.25;
            const w = 0.035;
            ctx.moveTo(T.x, T.y);
            ctx.lineTo(T.x + Math.cos(a - w) * L, T.y + Math.sin(a - w) * L);
            ctx.lineTo(T.x + Math.cos(a + w) * L, T.y + Math.sin(a + w) * L);
            ctx.closePath();
          }
          ctx.fill();
          stamp(t2.flare, T.x, T.y, 280 * ray, 0, ray);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
        }
        ring(T.x, T.y, sm(0, 1.0, k) * 760, 0.62, lerp(34, 2, sm(0, 1, k)), "190,130,255", 1 - sm(0.05, 1, k));
        ring(T.x, T.y, sm(0.06, 1.1, k) * 520, 0.62, lerp(18, 1, sm(0.06, 1.1, k)), "255,255,255", 0.85 * (1 - sm(0.1, 1.1, k)));
        ring(T.x, T.y, sm(0.14, 1.2, k) * 340, 0.62, 8 * (1 - sm(0.14, 1.2, k)) + 1, "120,70,230", 0.7 * (1 - sm(0.2, 1.2, k)));
        // the scar left in the mat: a ragged black decal with glowing purple veins
        const sc = sm(0, 0.3, k) * (1 - sm(1.4, 2.4, k));
        decal(t2.scar, T.x, T.y, 190 * sm(0, 0.4, k), 0.55, sc);
        decal(t2.scar, T.x, T.y, 190 * sm(0, 0.4, k), 0.55, 0.9 * sc * (1 - sm(0, 1.6, k)) * (0.75 + 0.25 * Math.sin(t * 0.04)), true);
        ring(T.x, T.y, 70 + 30 * k, 0.55, 3, "200,140,255", 0.7 * (1 - sm(0.1, 1.2, k)));
      }
      stepP(dt);
      drawP();
      st.flash *= Math.exp(-5 * dt);
      flashRect(st.flash * 0.9, "245,235,255");
    },
  };
}

function meteor(): Fx {
  type Rock = { x: number; y: number; z: number; vx: number; vy: number; vz: number; rot: number; vr: number; sz: number; age: number; v: number };
  let st = { hit: false, flash: 0, cracks: [] as Pt[][], debris: [] as Rock[], start: { x: 0, y: 0 }, smokeT: 0, burnT: 0, mx: undefined as number | undefined, my: 0, mr: 0 };
  return {
    dur: 5800,
    sound: "meteor",
    setup() {
      const cracks: Pt[][] = [];
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * TAU + rnd(-0.2, 0.2);
        const L = rnd(140, 340);
        cracks.push(jag(T.x, T.y, T.x + Math.cos(a) * L, T.y + Math.sin(a) * L * 0.55, 20, 4));
      }
      st = { hit: false, flash: 0, cracks, debris: [], start: { x: T.x + W * 0.5, y: -140 }, smokeT: 0, burnT: 0, mx: undefined, my: 0, mr: 0 };
    },
    frame(t, dt) {
      const t2 = tex as Tex;
      const sky = sm(0, 700, t) * (1 - sm(2600, 5000, t));
      ctx.fillStyle = `rgba(40,6,4,${0.42 * sky})`;
      ctx.fillRect(0, 0, W, H);
      // the target marker
      if (t < 1330) {
        const a = sm(0, 300, t);
        const pulse = 0.55 + 0.45 * Math.sin(t * 0.02);
        const s = 1 - sm(300, 1300, t) * 0.35;
        ring(T.x, T.y, 150 * s, 0.5, 3, "255,60,40", a * pulse);
        ring(T.x, T.y, 90 * s, 0.5, 2, "255,120,80", a);
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "rgb(255,80,60)";
        ctx.globalAlpha = a * 0.8;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          ctx.moveTo(T.x + dx * 60 * s, T.y + dy * 30 * s);
          ctx.lineTo(T.x + dx * 190 * s, T.y + dy * 95 * s);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      // the meteor falls (it grows as it comes at us) and leaves a trail of textured fire and smoke
      if (t >= 420 && !st.hit) {
        const u = clamp((t - 420) / 880);
        const e = Math.pow(u, 1.55);
        const x = lerp(st.start.x, T.x, e);
        const y = lerp(st.start.y, T.y, e);
        const r = lerp(12, 66, e);
        for (let i = 0; i < 3; i++) {
          emit({ x: x + rnd(-r, r) * 0.5, y: y + rnd(-r, r) * 0.5, vx: rnd(-30, 60), vy: rnd(-60, 20), life: rnd(0.4, 0.75), r: r * 1.5, r1: 6, pal: "fire", a: 0.95, kind: "puff", drop: true });
          if (i < 2) emit({ x: x + rnd(-r, r) * 0.5, y: y + rnd(-r, r) * 0.5, vx: rnd(-10, 40), vy: rnd(-30, 10), life: rnd(0.9, 1.5), r: r * 1.2, r1: r * 3, pal: "smoke", a: 0.55, kind: "puff", drop: true });
        }
        st.mx = x;
        st.my = y;
        st.mr = r;
      }
      if (st.mx !== undefined && !st.hit) {
        const x = st.mx;
        const y = st.my;
        const r = st.mr;
        ctx.globalCompositeOperation = "lighter";
        stamp(t2.puff.fire[0], x, y, r * 3.2, t * 0.003, 0.8);
        stamp(t2.puff.fire[1], x, y, r * 2.2, -t * 0.005, 0.9);
        ctx.globalCompositeOperation = "source-over";
        stamp(t2.ball, x, y, r * 0.78, t * 0.004, 1); // the rock, turning, with glowing cracks
        ctx.globalCompositeOperation = "lighter";
        stamp(t2.ball, x, y, r * 0.78, t * 0.004, 0.35);
        stamp(t2.flare, x, y, r * 1.5, 0, 0.7);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      // impact
      if (!st.hit && t >= 1300) {
        st.hit = true;
        st.flash = 1;
        kick(30);
        blast(1050, 0.7);
        setTint("60,22,6", 0.5);
        for (let i = 0; i < 34; i++) {
          const a = rnd(0, TAU);
          const s = rnd(120, 640);
          emit({ x: T.x, y: T.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.55 - 120, drag: 2.2, life: rnd(0.5, 1.2), r: rnd(50, 90), r1: 14, pal: "fire", a: 0.9, kind: "puff" });
        }
        for (let i = 0; i < 24; i++) {
          const a = rnd(0, TAU);
          const s = rnd(60, 360);
          emit({ x: T.x, y: T.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5 - rnd(20, 100), drag: 1.2, life: rnd(1.6, 3), r: 40, r1: rnd(100, 170), pal: "smoke", a: 0.7, kind: "puff" });
        }
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU + rnd(-0.2, 0.2);
          emit({ x: T.x, y: T.y, vx: Math.cos(a) * rnd(380, 560), vy: Math.sin(a) * rnd(200, 300), drag: 2.4, life: rnd(0.9, 1.6), r: 30, r1: rnd(90, 130), pal: "dust", a: 0.7, kind: "puff" }); // the dust ring
        }
        for (let i = 0; i < 90; i++) {
          const a = rnd(0, TAU);
          const s = rnd(160, 900);
          emit({ x: T.x, y: T.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6 - rnd(200, 600), g: 900, drag: 0.5, life: rnd(0.8, 2), r: rnd(2, 4.5), col: "255,170,70", kind: "streak" });
        }
        for (let i = 0; i < 20; i++) {
          const a = rnd(0, TAU);
          const s = rnd(200, 760);
          st.debris.push({ x: T.x, y: T.y, z: 0, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.45, vz: rnd(300, 900), rot: rnd(0, TAU), vr: rnd(-8, 8), sz: rnd(10, 26), age: 0, v: (Math.random() * 3) | 0 });
        }
        st.mx = undefined;
      }
      if (st.hit) {
        const k = (t - 1300) / 1000;
        // the crater: a ragged dark decal with glowing lava veins that pulse, and cool
        const cr = sm(0, 0.25, k);
        const fadeC = 1 - sm(3800, 5500, t);
        const hot = 1 - sm(0, 2.6, k);
        decal(t2.crater, T.x, T.y, 175 * cr, 0.5, 0.95 * fadeC);
        decal(t2.crater, T.x, T.y, 175 * cr, 0.5, (0.35 + 0.65 * hot) * fadeC * (0.8 + 0.2 * Math.sin(t * 0.03)), true);
        glow(T.x, T.y, 130 * cr, "255,80,20", (0.25 + 0.5 * hot) * fadeC * (0.85 + 0.15 * Math.sin(t * 0.03)));
        ctx.globalAlpha = 1;
        // cracks that glow, then cool
        const cg = sm(0, 0.35, k) * (1 - sm(2, 3.8, k));
        if (cg > 0.01) {
          for (const c of st.cracks) {
            const n = Math.max(2, Math.floor(c.length * sm(0, 0.35, k)));
            strokePath(c.slice(0, n), [9, 3.2, 1.2], [0.2 * cg, 0.7 * cg, cg], "255,100,25", "255,220,150");
          }
        }
        ring(T.x, T.y, sm(0, 0.8, k) * 420, 0.5, lerp(22, 2, sm(0, 0.8, k)), "255,190,120", 0.9 * (1 - sm(0.05, 0.8, k)));
        // flying rock (textured, lit, with a hot edge)
        for (const d of st.debris) {
          d.age += dt;
          d.vz -= 1500 * dt;
          d.z += d.vz * dt;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          d.rot += d.vr * dt;
          if (d.z < 0) {
            d.z = 0;
            d.vz *= -0.3;
            d.vx *= 0.6;
            d.vy *= 0.6;
            d.vr *= 0.5;
          }
          const a = 1 - sm(1.4, 2.4, d.age);
          if (a <= 0.01) continue;
          ctx.globalAlpha = a * 0.45;
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.ellipse(d.x, d.y + 3, d.sz * 0.7, d.sz * 0.3, 0, 0, TAU);
          ctx.fill();
          stamp(t2.rocks[d.v], d.x, d.y - d.z * 0.55, d.sz * (1 + d.z * 0.0008), d.rot, a);
        }
        ctx.globalAlpha = 1;
        // smoke and embers keep rising off the crater
        if (t < 3800) {
          st.smokeT += dt;
          if (st.smokeT > 0.05) {
            st.smokeT = 0;
            emit({ x: T.x + rnd(-40, 40), y: T.y + rnd(-10, 10), vx: rnd(-20, 20), vy: -rnd(70, 150), drag: 0.4, life: rnd(1.4, 2.4), r: 34, r1: rnd(90, 140), pal: "smoke", a: 0.6, kind: "puff", drop: true });
          }
          if (Math.random() < 0.7) emit({ x: T.x + rnd(-80, 80), y: T.y + rnd(-20, 20), vx: rnd(-30, 30), vy: -rnd(60, 220), drag: 0.8, life: rnd(0.6, 1.4), r: rnd(2, 5), col: "255,150,50", a: 1, drop: true });
        }
        // the cards are on fire: flames follow them as they slide, and smoke rises off them
        if (t < 3300) {
          st.burnT += dt;
          if (st.burnT > 0.045) {
            st.burnT = 0;
            for (const c of cards) {
              emit({ x: c.cx + c.ox + rnd(-c.w * 0.3, c.w * 0.3), y: c.cy + c.oy - c.z * 0.25 + rnd(-c.h * 0.2, c.h * 0.3), vx: rnd(-15, 15), vy: -rnd(40, 110), life: rnd(0.4, 0.8), r: rnd(16, 28), r1: 4, pal: "fire", a: 0.9, kind: "puff", drop: true });
              if (Math.random() < 0.25) emit({ x: c.cx + c.ox, y: c.cy + c.oy - c.z * 0.25, vy: -rnd(50, 100), vx: rnd(-10, 10), life: rnd(0.9, 1.5), r: 14, r1: 44, pal: "smoke", a: 0.5, kind: "puff", drop: true });
            }
          }
        }
        cardsPhys(dt);
      }
      stepP(dt);
      drawP();
      st.flash *= Math.exp(-6.5 * dt);
      ctx.globalCompositeOperation = "lighter";
      if (st.flash > 0.05) stamp(t2.flare, T.x, T.y, 420 * st.flash, 0, st.flash);
      ctx.globalCompositeOperation = "source-over";
      flashRect(st.flash * 0.9, "255,240,215");
    },
  };
}

function zero(): Fx {
  type Seg = { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; w: number };
  type Shard = { cx: number; cy: number; ox: number; oy: number; rot: number; vx: number; vy: number; vr: number; sc: number; dz: number; img: HTMLCanvasElement; bx: number; by: number };
  const frost = (out: Seg[], x: number, y: number, ang: number, len: number, depth: number, t0: number): void => {
    const dur = len * 4.2;
    const x1 = x + Math.cos(ang) * len;
    const y1 = y + Math.sin(ang) * len * 0.8;
    out.push({ x0: x, y0: y, x1, y1, t0, dur, w: 1 + depth * 0.7 });
    if (depth <= 0) return;
    frost(out, lerp(x, x1, 0.55), lerp(y, y1, 0.55), ang + (Math.random() < 0.5 ? -1 : 1) * rnd(0.6, 1.1), len * 0.5, depth - 1, t0 + dur * 0.55);
    frost(out, x1, y1, ang + rnd(-0.45, -0.15), len * 0.74, depth - 1, t0 + dur);
    frost(out, x1, y1, ang + rnd(0.15, 0.45), len * 0.74, depth - 1, t0 + dur);
  };
  /** A rectangle broken into a jittered grid of triangles, each one cut out (once, now) as its own little picture by `paint`. */
  const tris = (r: { x: number; y: number; w: number; h: number }, cols: number, rows: number, paint: (g: CanvasRenderingContext2D) => void): Shard[] => {
    const pts: Pt[][] = [];
    for (let j = 0; j <= rows; j++) {
      pts.push([]);
      for (let i = 0; i <= cols; i++) {
        const edge = i === 0 || j === 0 || i === cols || j === rows;
        pts[j].push([r.x + (i / cols) * r.w + (edge ? 0 : (rnd(-0.35, 0.35) * r.w) / cols), r.y + (j / rows) * r.h + (edge ? 0 : (rnd(-0.35, 0.35) * r.h) / rows)]);
      }
    }
    const out: Shard[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = pts[j][i];
        const b = pts[j][i + 1];
        const c = pts[j + 1][i];
        const d = pts[j + 1][i + 1];
        for (const tri of Math.random() < 0.5 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]]) {
          const minx = Math.floor(Math.min(tri[0][0], tri[1][0], tri[2][0])) - 3;
          const miny = Math.floor(Math.min(tri[0][1], tri[1][1], tri[2][1])) - 3;
          const w = Math.ceil(Math.max(tri[0][0], tri[1][0], tri[2][0])) - minx + 3;
          const h = Math.ceil(Math.max(tri[0][1], tri[1][1], tri[2][1])) - miny + 3;
          const cv = document.createElement("canvas");
          cv.width = Math.max(4, w);
          cv.height = Math.max(4, h);
          const g = cv.getContext("2d")!;
          g.translate(-minx, -miny);
          g.beginPath();
          g.moveTo(tri[0][0], tri[0][1]);
          g.lineTo(tri[1][0], tri[1][1]);
          g.lineTo(tri[2][0], tri[2][1]);
          g.closePath();
          g.save();
          g.clip();
          paint(g);
          const hi = g.createLinearGradient(minx, miny, minx + w, miny + h);
          hi.addColorStop(0, `rgba(255,255,255,${rnd(0.05, 0.3)})`);
          hi.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = hi;
          g.fillRect(minx, miny, w, h);
          g.restore();
          g.strokeStyle = "rgba(255,255,255,.8)";
          g.lineWidth = 1.5;
          g.lineJoin = "round";
          g.stroke();
          const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
          const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          out.push({ cx, cy, ox: 0, oy: 0, rot: 0, vx: 0, vy: 0, vr: rnd(-4, 4), sc: 1, dz: rnd(0.4, 1.6), img: cv, bx: minx - cx, by: miny - cy });
        }
      }
    }
    return out;
  };
  let st = { segs: [] as Seg[], cracks: [] as Pt[][], shards: [] as Shard[], snowT: 0, mistT: 0, shattered: false, hidden: false, flash: 0, frostEnd: 0, frostCv: null as HTMLCanvasElement | null };
  const strokeFrost = (g: CanvasRenderingContext2D, tt: number, dx: number, dy: number): void => {
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const [w, a, col] of [[7, 0.16, "120,200,255"], [2.2, 0.9, "225,248,255"]] as const) {
      g.globalAlpha = a;
      g.strokeStyle = `rgb(${col})`;
      g.beginPath();
      for (const q of st.segs) {
        const k = clamp((tt - q.t0) / q.dur);
        if (k <= 0) continue;
        g.lineWidth = q.w * (w > 3 ? 3 : 1);
        g.moveTo(q.x0 + dx, q.y0 + dy);
        g.lineTo(lerp(q.x0, q.x1, k) + dx, lerp(q.y0, q.y1, k) + dy);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  };
  return {
    dur: 6200,
    sound: "absoluteZero",
    setup() {
      const t2 = ensureTex();
      const segs: Seg[] = [];
      for (let i = 0; i < 7; i++) frost(segs, T.x, T.y, (i / 7) * TAU + rnd(-0.2, 0.2), 78, 4, 500 + rnd(0, 150));
      const corners: [number, number, number][] = [[mat.x, mat.y, 0.7], [mat.x + mat.w, mat.y, 2.4], [mat.x, mat.y + mat.h, -0.7], [mat.x + mat.w, mat.y + mat.h, -2.4]];
      for (const [x, y, a] of corners) {
        frost(segs, x, y, a, 70, 4, 400 + rnd(0, 300));
        frost(segs, x, y, a + rnd(-0.6, 0.6), 60, 3, 500 + rnd(0, 300));
      }
      const cracks: Pt[][] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + rnd(-0.25, 0.25);
        cracks.push(jag(T.x, T.y, T.x + Math.cos(a) * rnd(180, 420), T.y + Math.sin(a) * rnd(110, 210), 24, 4));
      }
      // the pieces: the mat is cut out of the ice texture, and every card is cut out of its own art (the real card breaks)
      const cols = Math.max(5, Math.min(10, Math.round(mat.w / 80)));
      const rows = Math.max(3, Math.min(5, Math.round(mat.h / 60)));
      const shards = tris(mat, cols, rows, (g) => {
        g.fillStyle = t2.icePat ?? "#9fd8f5";
        g.fillRect(mat.x - 4, mat.y - 4, mat.w + 8, mat.h + 8);
      });
      for (const c of cards.slice(0, 14)) {
        const x = c.cx - c.w / 2;
        const y = c.cy - c.h / 2;
        shards.push(
          ...tris({ x, y, w: c.w, h: c.h }, 3, 4, (g) => {
            if (c.art) g.drawImage(c.art, x, y, c.w, c.h);
            else {
              g.fillStyle = "#3a4a7a";
              g.fillRect(x, y, c.w, c.h);
            }
            g.fillStyle = "rgba(150,215,255,.32)"; // frozen
            g.fillRect(x, y, c.w, c.h);
            g.globalAlpha = 0.3;
            g.fillStyle = t2.icePat ?? "#fff";
            g.fillRect(x, y, c.w, c.h);
            g.globalAlpha = 1;
          }),
        );
      }
      for (const s of shards) {
        const dx = s.cx - T.x;
        const dy = s.cy - T.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = 620 / (1 + d / 200) + rnd(60, 200);
        s.vx = (dx / d) * sp;
        s.vy = (dy / d) * sp * 0.6 - rnd(100, 300);
      }
      st = { segs, cracks, shards, snowT: 0, mistT: 0, shattered: false, hidden: false, flash: 0, frostEnd: Math.max(...segs.map((q) => q.t0 + q.dur)), frostCv: null };
      // the fully grown frost, drawn into a picture now (before the show starts), so that no frame has to do it
      const fc = document.createElement("canvas");
      fc.width = Math.ceil(mat.w);
      fc.height = Math.ceil(mat.h);
      const g = fc.getContext("2d")!;
      g.beginPath();
      g.rect(0, 0, fc.width, fc.height);
      g.clip();
      strokeFrost(g, 1e9, -mat.x, -mat.y);
      st.frostCv = fc;
    },
    warm() {
      for (const sh of st.shards) ctx.drawImage(sh.img, 0, 0, 4, 4);
    },
    frame(t, dt) {
      const t2 = tex as Tex;
      const cold = sm(0, 700, t) * (1 - sm(4600, 6000, t));
      ctx.fillStyle = `rgba(10,40,80,${0.3 * cold})`;
      ctx.fillRect(0, 0, W, H);
      if (!st.shattered) {
        // the mat is covered with ice: the ice texture over it (fading in), and frost crystals growing across it
        const ice = sm(700, 2700, t);
        ctx.save();
        ctx.beginPath();
        ctx.rect(mat.x, mat.y, mat.w, mat.h);
        ctx.clip();
        if (t2.icePat) {
          ctx.globalAlpha = 0.78 * ice;
          ctx.fillStyle = t2.icePat;
          ctx.fillRect(mat.x, mat.y, mat.w, mat.h);
        }
        const g = ctx.createRadialGradient(T.x, T.y, 20, T.x, T.y, mat.w * 0.55);
        g.addColorStop(0, `rgba(175,225,255,${0.3 * ice})`);
        g.addColorStop(1, `rgba(90,170,235,${0.3 * ice})`);
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(mat.x, mat.y, mat.w, mat.h);
        ctx.restore();
        // the frozen cards get a crust of the same ice
        if (t2.icePat) {
          ctx.fillStyle = t2.icePat;
          ctx.globalAlpha = 0.6 * sm(900, 2500, t);
          for (const c of cards) ctx.fillRect(c.cx + c.ox - c.w / 2, c.cy + c.oy - c.h / 2, c.w, c.h);
          ctx.globalAlpha = 1;
        }
        // the frost: while it grows it is drawn line by line; once it has finished growing, the picture that was made ahead (in setup) is put down each frame instead
        if (t >= st.frostEnd && st.frostCv) {
          ctx.drawImage(st.frostCv, mat.x, mat.y, mat.w, mat.h);
        } else {
          ctx.save();
          ctx.beginPath();
          ctx.rect(mat.x, mat.y, mat.w, mat.h);
          ctx.clip();
          strokeFrost(ctx, t, 0, 0);
          ctx.restore();
        }
        // cold mist creeps along the mat
        st.mistT += dt;
        if (st.mistT > 0.09 && t > 500) {
          st.mistT = 0;
          emit({ x: rnd(mat.x, mat.x + mat.w), y: rnd(mat.y + mat.h * 0.3, mat.y + mat.h), vx: rnd(-25, 25), vy: -rnd(5, 25), life: rnd(1.4, 2.4), r: rnd(50, 90), r1: rnd(100, 150), pal: "ice", a: 0.3, kind: "puff", drop: true });
        }
        // the cracks that run through it just before it goes
        const ck = sm(2850, 3350, t);
        if (ck > 0.01) for (const c of st.cracks) strokePath(c.slice(0, Math.max(2, Math.floor(c.length * ck))), [10, 3.5, 1.3], [0.25, 0.7, 1], "150,220,255");
        if (t > 2800 && t < 3400) kick(2 + (t - 2800) / 200);
        if (t > 2800) {
          for (const c of cards) {
            c.ox = Math.sin(t * 0.09 + c.cx) * 1.8; // the frozen cards tremble, and lift a little as the ice strains
            c.z = sm(2800, 3400, t) * 8;
          }
        }
      }
      if (!st.shattered && t >= 3400) {
        st.shattered = true;
        st.flash = 0.9;
        kick(22);
        for (let i = 0; i < 120; i++) {
          const a = rnd(0, TAU);
          const s = rnd(100, 900);
          emit({ x: T.x + rnd(-mat.w * 0.3, mat.w * 0.3), y: T.y + rnd(-mat.h * 0.3, mat.h * 0.3), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6 - rnd(100, 300), g: 380, drag: 0.8, life: rnd(0.8, 2.2), r: rnd(3, 8), col: "200,235,255", fade: 0.6, kind: i % 3 ? "glow" : "flare" });
        }
        for (let i = 0; i < 18; i++) emit({ x: T.x + rnd(-mat.w * 0.4, mat.w * 0.4), y: T.y + rnd(-mat.h * 0.3, mat.h * 0.3), vx: rnd(-90, 90), vy: -rnd(10, 90), drag: 1, life: rnd(1.2, 2.4), r: 50, r1: 130, pal: "ice", a: 0.55, kind: "puff" });
      }
      if (st.shattered && !st.hidden && t >= 3440) {
        st.hidden = true; // (the shards are already over the mat: it is hidden a frame or two later, so the work of the shatter is not all in one frame)
        if (matEl) matEl.style.visibility = "hidden";
        for (const c of cards) {
          c.hidden = true;
          c.ox = 0;
          c.z = 0;
        }
      }
      if (st.shattered) {
        const k = (t - 3400) / 1000;
        ring(T.x, T.y, sm(0, 0.9, k) * 700, 0.55, lerp(24, 2, sm(0, 0.9, k)), "190,235,255", 1 - sm(0.05, 0.9, k));
        const a = 1 - sm(1.4, 2.5, k);
        for (const s of st.shards) {
          s.vy += 760 * dt;
          s.ox += s.vx * dt;
          s.oy += s.vy * dt;
          s.rot += s.vr * dt;
          s.vx *= Math.exp(-0.9 * dt);
          s.sc = 1 + 0.35 * Math.min(1, k * 2) * s.dz * (1 - sm(0.6, 2, k));
          const al = s.cy + s.oy < H + 60 ? a : 0;
          if (al <= 0.01) continue;
          const cs = Math.cos(s.rot) * s.sc * curRes;
          const sn = Math.sin(s.rot) * s.sc * curRes;
          ctx.globalAlpha = al;
          ctx.setTransform(cs, sn, -sn, cs, (s.cx + s.ox) * curRes, (s.cy + s.oy) * curRes);
          ctx.drawImage(s.img, s.bx, s.by);
        }
        ctx.setTransform(curRes, 0, 0, curRes, 0, 0);
        ctx.globalAlpha = 1;
      }
      // snow and drifting ice all the while
      st.snowT += dt;
      if (st.snowT > 0.02 && t < 5200) {
        st.snowT = 0;
        for (let i = 0; i < 2; i++) emit({ x: rnd(-100, W + 100), y: -20, vx: rnd(-120, -40), vy: rnd(80, 190), life: rnd(4, 6), r: rnd(1.5, 3.6), col: "225,245,255", a: 0.85, fade: 0.4, drop: true });
      }
      stepP(dt);
      drawP();
      st.flash *= Math.exp(-6 * dt);
      ctx.globalCompositeOperation = "lighter";
      if (st.flash > 0.05) stamp(t2.flare, T.x, T.y, 380 * st.flash, 0, st.flash);
      ctx.globalCompositeOperation = "source-over";
      flashRect(st.flash * 0.85, "225,245,255");
    },
  };
}

/**
 * The Grim Reaper's aftermath (the Reaper itself is drawn by finisher.ts; this is what the cut does to the loser's table): from the moment the blade first touches the mat, the
 * rift's edge (`path`) licks up in textured purple flames and embers, the mat is scarred, and every card on it is thrown (from the place the blade hit) and set alight in the same
 * purple fire, tumbling, bouncing and knocking into each other through the physics engine.
 */
function reaperFx(origin: Pt, path: Pt[]): Fx {
  let st = { hit: false, flash: 0, lickT: 0, burnT: 0 };
  return {
    dur: 4000,
    sound: null,
    setup() {
      st = { hit: false, flash: 0, lickT: 0, burnT: 0 };
    },
    frame(t, dt) {
      const t2 = tex as Tex;
      const ox = clamp(origin[0], mat.x, mat.x + mat.w);
      const oy = clamp(origin[1], mat.y, mat.y + mat.h);
      const rim = path.length ? path : [[ox, oy] as Pt];
      if (!st.hit) {
        st.hit = true;
        st.flash = 0.8;
        blast(1000, 0.7);
        setTint("38,0,66", 0.55);
        // the first burst of the cut: flames thrown up all along it, sparks, flares, a little smoke
        for (let i = 0; i < 10; i++) {
          const [x, y] = rim[Math.floor(Math.random() * rim.length)];
          emit({ x: x + rnd(-14, 14), y: y + rnd(-14, 14), vx: rnd(-90, 90), vy: -rnd(40, 240), drag: 1.6, life: rnd(0.5, 1.0), r: rnd(30, 56), r1: rnd(10, 22), pal: "violet", a: 0.8, kind: "puff" });
        }
        for (let i = 0; i < 70; i++) {
          const [x, y] = rim[Math.floor(Math.random() * rim.length)];
          const a = rnd(0, TAU);
          const sp = rnd(120, 780);
          emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - rnd(60, 300), g: 800, drag: 0.6, life: rnd(0.5, 1.6), r: rnd(2, 4.5), col: i % 3 ? "232,121,249" : "255,255,255", kind: "streak" });
        }
        for (let i = 0; i < 10; i++) {
          const [x, y] = rim[Math.floor(Math.random() * rim.length)];
          emit({ x, y, vx: rnd(-100, 100), vy: rnd(-160, 20), drag: 2, life: rnd(0.3, 0.6), r: rnd(24, 54), kind: "flare", a: 1 });
        }
        for (let i = 0; i < 7; i++) {
          const [x, y] = rim[Math.floor(Math.random() * rim.length)];
          emit({ x, y, vx: rnd(-60, 60), vy: -rnd(30, 120), drag: 1, life: rnd(1.4, 2.6), r: 40, r1: rnd(90, 150), pal: "smoke", a: 0.5, kind: "puff" });
        }
      }
      // the mat is scarred under the cut: a ragged black decal with glowing purple veins that pulse, and fade
      const k = t / 1000;
      const sc = sm(0, 0.35, k) * (1 - sm(2.2, 3.6, k));
      const r = mat.w * 0.36 * sm(0, 0.5, k);
      decal(t2.scar, mat.x + mat.w / 2, mat.y + mat.h / 2, r, (mat.h / mat.w) * 0.95, 0.9 * sc);
      decal(t2.scar, mat.x + mat.w / 2, mat.y + mat.h / 2, r, (mat.h / mat.w) * 0.95, sc * (1 - sm(0, 2.4, k)) * (0.7 + 0.3 * Math.sin(t * 0.035)), true);
      // flames keep licking up along the rift while it is open, and the embers rise
      if (t < 3000) {
        st.lickT += dt;
        if (st.lickT > 0.12) {
          st.lickT = 0;
          const [x, y] = rim[Math.floor(Math.random() * rim.length)];
          const life = 1 - sm(1800, 3000, t);
          emit({ x: x + rnd(-10, 10), y: y + rnd(-6, 6), vx: rnd(-25, 25), vy: -rnd(60, 170), drag: 0.7, life: rnd(0.5, 0.95), r: rnd(22, 40) * (0.6 + 0.4 * life), r1: rnd(6, 14), pal: "violet", a: 0.55 * (0.4 + 0.6 * life), kind: "puff", drop: true });
          if (Math.random() < 0.6) emit({ x: x + rnd(-20, 20), y, vx: rnd(-40, 40), vy: -rnd(80, 240), drag: 0.8, life: rnd(0.7, 1.5), r: rnd(2, 4.5), col: "232,121,249", a: 1, drop: true });
        }
      }
      // the cards burn in it: flames follow them as they slide, smoke rises off them
      if (t < 3000) {
        st.burnT += dt;
        if (st.burnT > 0.045) {
          st.burnT = 0;
          for (const c of cards) {
            emit({ x: c.cx + c.ox + rnd(-c.w * 0.3, c.w * 0.3), y: c.cy + c.oy - c.z * 0.25 + rnd(-c.h * 0.2, c.h * 0.3), vx: rnd(-15, 15), vy: -rnd(40, 110), life: rnd(0.4, 0.8), r: rnd(16, 28), r1: 4, pal: "violet", a: 0.9, kind: "puff", drop: true });
            if (Math.random() < 0.2) emit({ x: c.cx + c.ox, y: c.cy + c.oy - c.z * 0.25, vy: -rnd(50, 100), vx: rnd(-10, 10), life: rnd(0.9, 1.5), r: 14, r1: 44, pal: "smoke", a: 0.5, kind: "puff", drop: true });
          }
        }
      }
      cardsPhys(dt);
      stepP(dt);
      drawP();
      st.flash *= Math.exp(-6 * dt);
      ctx.globalCompositeOperation = "lighter";
      if (st.flash > 0.05) stamp(t2.flare, ox, oy, 360 * st.flash, 0, st.flash);
      ctx.globalCompositeOperation = "source-over";
      flashRect(st.flash * 0.35, "245,215,255");
    },
  };
}

const MAKERS: Record<FxKind, () => Fx> = { judgment, void: voidCollapse, meteor, zero };

// ───────────────────────────── playing one

const artCache = new Map<string, Promise<HTMLImageElement | null>>();
/** A card's art (it is the card's background picture: the browser already has it), for cutting into shards. */
function loadArt(el: HTMLElement): Promise<HTMLImageElement | null> {
  const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(el).backgroundImage);
  if (!m) return Promise.resolve(null);
  let pr = artCache.get(m[1]);
  if (!pr) {
    pr = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => (img.decode ? img.decode().then(() => resolve(img), () => resolve(img)) : resolve(img)); // (decoded now, not at the first time it is drawn)
      img.onerror = () => resolve(null);
      img.src = m[1];
    });
    artCache.set(m[1], pr);
  }
  return pr;
}

const num = (s: string, fallback: number) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : fallback;
};

/** A finisher that is made ready (pictures, bodies, canvas) and waiting to be started. */
export interface FxRun {
  /** Starts it, at `rate` times the normal speed. Resolves a little before the picture has fully faded, so that the result can come up over its last moments. */
  start: (rate?: number) => Promise<void>;
  /** Puts everything back at once (whether it has started or not). */
  cancel: () => void;
  /** The computer cannot keep up: the sparks and smoke are thinned out and it is drawn smaller. */
  degrade: () => void;
}

export interface FxOptions {
  /** Where the canvas goes (default: over the whole page). */
  parent?: HTMLElement;
  /** The Reaper's aftermath: where the blade first touches the mat, and the line of the cut. */
  origin?: Pt;
  path?: Pt[];
  /** The part of the page the canvas covers (default: all of it). */
  region?: { x: number; y: number; w: number; h: number };
}

/**
 * Makes one of the finishers ready on `loser`'s mat (null: the preview, which has no mats), without starting it: everything that takes time (textures, the cards' bodies, the
 * canvas, the pieces of the shattering mat) is done here, so that `start` has nothing to do but run.
 */
export async function prepareFx(kind: FxKind | "reaper", loser: string | null, o: FxOptions = {}): Promise<FxRun | null> {
  if (typeof document === "undefined" || !animationsEnabled()) return null;
  const lite = liteMode();
  W = window.innerWidth;
  H = window.innerHeight;
  let res = lite ? 0.5 : kind === "reaper" ? 0.55 : 0.7; // (the Reaper has a lot else to draw)
  curRes = res;
  const reg = o.region ?? { x: 0, y: 0, w: W, h: H };
  offX = reg.x;
  offY = reg.y;
  regW = reg.w;
  regH = reg.h;
  const cv = document.createElement("canvas");
  cv.width = Math.round(regW * res);
  cv.height = Math.round(regH * res);
  Object.assign(cv.style, o.parent ? { position: "absolute", left: `${reg.x}px`, top: `${reg.y}px`, width: `${reg.w}px`, height: `${reg.h}px`, pointerEvents: "none" } : { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "9990" });
  const c2 = cv.getContext("2d", { alpha: true });
  if (!c2) return null;
  ctx = c2;
  ensureTex();

  // where the loser's mat is, and its cards (measured before anything moves)
  matEl = loser ? document.querySelector<HTMLElement>(`[data-mat="${loser}"]`) : null;
  const r = matEl?.getBoundingClientRect();
  mat = r && r.width > 40 && r.height > 40 ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: W * 0.2, y: H * 0.1, w: W * 0.6, h: H * 0.3 };
  T = { x: mat.x + mat.w / 2, y: mat.y + mat.h * 0.52 };
  const found = matEl ? [...matEl.querySelectorAll<HTMLElement>("[data-card-iid]")] : [];
  cards = found
    .filter((e) => !found.some((x) => x !== e && x.contains(e)))
    .slice(0, 40)
    .map((el): Card => {
      const b = el.getBoundingClientRect();
      const s = el.style;
      const cs = getComputedStyle(el);
      const tr = cs.translate === "none" ? [] : cs.translate.split(" ");
      const sc = cs.scale === "none" ? [] : cs.scale.split(" ");
      return {
        el, cx: b.left + b.width / 2, cy: b.top + b.height / 2, w: b.width, h: b.height,
        ox: 0, oy: 0, z: 0, rot: 0, tx: 0, ty: 0, sc: 1, sx: 1, sy: 1, op: 1, body: createBox(b.left + b.width / 2, b.top + b.height / 2, b.width * 0.94, b.height * 0.94, { asleep: true }), hidden: false, last: "",
        base: { x: num(tr[0] ?? "0", 0), y: num(tr[1] ?? "0", 0), rot: cs.rotate === "none" ? 0 : num(cs.rotate, 0), scale: num(sc[0] ?? "1", 1) },
        art: null,
        saved: { translate: s.translate, rotate: s.rotate, scale: s.scale, transform: s.transform, opacity: s.opacity, filter: s.filter, transition: s.transition, visibility: s.visibility, willChange: s.willChange },
      };
    })
    .filter((c) => c.w > 8 && c.h > 8);
  for (const c of cards) {
    c.el.style.transition = "none"; // (a transition on the card would make every frame's move lag behind)
    if (kind === "zero") c.el.style.willChange = "transform, translate, rotate, scale"; // (these stay real cards until they break)
  }
  // The cards' art (it is already in the browser: this takes a moment at most): Absolute Zero cuts the cards into pieces of it, and the others draw each flying card from it
  await Promise.race([Promise.all(cards.map(async (c) => (c.art = await loadArt(c.el)))), new Promise((ok) => setTimeout(ok, 300))]);
  if (kind === "zero") for (const c of cards) c.sprite = false;
  buildWorld();
  const savedMat = matEl ? { translate: matEl.style.translate, willChange: matEl.style.willChange } : null;
  if (matEl) matEl.style.willChange = "translate";

  P = [];
  tint = null;
  shake = 0;
  quality = lite ? 0.6 : 1;
  overdraw = lite ? 1.4 : kind === "reaper" ? 1.6 : 2.4;
  const fx = kind === "reaper" ? reaperFx(o.origin ?? [mat.x + mat.w / 2, mat.y], o.path ?? []) : MAKERS[kind]();
  fx.setup();
  (o.parent ?? document.body).appendChild(cv);
  // Every picture is drawn once, nearly invisible, and a frame is let through: the first time a picture is drawn it is sent to the graphics chip, which took a few frames' time
  // in the middle of the show (the hitches at the first flash and at the shatter). Now that happens here, before anything is shown.
  {
    const t = tex as Tex;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.02;
    for (const list of Object.values(t.puff)) for (const img of list) ctx.drawImage(img, 0, 0, 4, 4);
    for (const img of [t.flare, t.scorch, t.crater, t.scar, t.cloud, t.cloudLit, t.disk, t.ball, t.ice, ...t.rocks]) ctx.drawImage(img, 0, 0, 4, 4);
    fx.warm?.();
    for (const c of cards) if (c.art) ctx.drawImage(c.art, 0, 0, 4, 4);
    ctx.globalAlpha = 1;
    await new Promise<void>((ok) => requestAnimationFrame(() => ok()));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
  }

  let started = false;
  let done = false;
  let raf = 0;
  let resolveStart: (() => void) | null = null;
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    cv.remove();
    for (const c of cards) Object.assign(c.el.style, c.saved);
    if (matEl && savedMat) {
      matEl.style.translate = savedMat.translate;
      matEl.style.willChange = savedMat.willChange;
      matEl.style.visibility = "";
    }
    cards = [];
    world = null;
    P = [];
    matEl = null;
    resolveStart?.();
  };
  const degrade = () => {
    quality = Math.min(quality, 0.5);
    overdraw = Math.max(1, overdraw * 0.8);
    if (res > 0.42) {
      res = Math.max(0.42, res * 0.8);
      curRes = res;
      cv.width = Math.round(regW * res);
      cv.height = Math.round(regH * res);
    }
  };
  const start = (rate = 1) =>
    new Promise<void>((resolve) => {
      if (started || done) return resolve();
      started = true;
      resolveStart = resolve;
      if (fx.sound) playSound(fx.sound);
      const t0 = performance.now();
      let last = t0;
      let sdt = 1 / 60; // (the frame time, eased: one slow frame does not make the motion lurch)
      let late = 0;
      let resolved = false;
      const tick = (now: number) => {
        if (done) return;
        const t = Math.max(0, now - t0) * rate;
        const raw = (now - last) / 1000;
        sdt = lerp(sdt, clamp(raw, 0.004, 0.05), 0.4);
        const dt = sdt * rate;
        last = now;
        if (raw > 0.026) late++;
        else late = Math.max(0, late - 0.5);
        if (late >= 5) {
          late = 0;
          degrade(); // frames are late: thinned out, and drawn smaller (it is cleared and drawn whole each frame, so this costs nothing)
        }
        ctx.setTransform(res, 0, 0, res, -offX * res, -offY * res);
        ctx.clearRect(offX, offY, regW, regH);
        ctx.save();
        fx.frame(t, dt);
        ctx.restore();
        shake *= Math.exp(-4.2 * dt);
        if (matEl) {
          // smooth waves of two speeds (random jumps look like a glitch, waves look like an impact)
          const sx = (Math.sin(t * 0.085) + 0.6 * Math.sin(t * 0.21 + 1.3)) / 1.6;
          const sy = (Math.sin(t * 0.1 + 2) + 0.6 * Math.sin(t * 0.26)) / 1.6;
          matEl.style.translate = shake > 0.15 ? `${(sx * shake).toFixed(2)}px ${(sy * shake).toFixed(2)}px` : savedMat!.translate;
        }
        applyCards();
        if (t >= fx.dur) return finish();
        if (t >= fx.dur - 700 && !resolved) {
          resolved = true;
          resolve();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
  return { start, cancel: finish, degrade };
}

/** Plays one of the canvas finishers on `loser`'s mat (null: the preview). Resolves a little before the picture has fully faded. */
export async function playFx(kind: FxKind, loser: string | null): Promise<void> {
  const run = await prepareFx(kind, loser);
  if (run) await run.start(1000 / scaled(1000)); // (the speed setting)
}
