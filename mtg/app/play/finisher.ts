import type { PlayerId } from "@mtg/engine";
import { animationsEnabled, scaled } from "@/lib/motion";
import { playSound, primeFinisherAudio } from "@/lib/sound";
import { liteMode } from "./perfTier";

/**
 * The finishing move: when a game is won, the Grim Reaper's hands rise over the winner's playmat, wind the scythe back, and bring it round in one heavy
 * slash; the slash tears the loser's playmat open (a dimensional rift: a gash of void with the slash's lightning along its edge), the mat reels, and the
 * rift closes. Then the result comes up.
 *
 * The Reaper is built from separate pieces cut from the artist's picture (cloak, scythe with fists, two forearms), each moved as what it is: see "the rig".
 *
 * The pictures are the artist's (public/finisher-animation/grim-reaper/): the hands with the scythe, and the slash, cut out of the green screen.
 */

const REAPER = "/finisher-animation/grim-reaper/reaper.webp";
const SLASH = "/finisher-animation/grim-reaper/slash.webp";
/** The pictures' sizes (their own pixels). */
const REAPER_W = 1043;
const REAPER_H = 555;
const SLASH_W = 1212;
const SLASH_H = 434;
/** The point (in the Reaper picture) the scythe swings about, between the two sleeves; and the middle of the cloak's lower edge (it grows and sinks from there). */
const PIVOT = { x: 465, y: 452 };
const BASE = { x: 470, y: 555 };
/** The scythe turns about the middle between the two fists (so the blade goes round on a circle, the path of the slash); and the blade's tip. */
const ROT = { x: 468, y: 325 };
const TIP = { x: 1000, y: 90 };
/** The upright line the body turns about when it spins: the middle of the whole picture (so that it turns on the spot and does not jump to one side). */
const AXIS = REAPER_W / 2;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, scaled(ms)));

function rectOf(id: PlayerId | null, fallback: Rect): Rect {
  const el = id ? document.querySelector<HTMLElement>(`[data-mat="${id}"]`) : null;
  const r = el?.getBoundingClientRect();
  return r && r.width > 40 && r.height > 40 ? { left: r.left, top: r.top, width: r.width, height: r.height } : fallback;
}

function el(parent: HTMLElement, style: Partial<CSSStyleDeclaration>, tag: "div" | "img" = "div", src = ""): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e.style, { position: "absolute", pointerEvents: "none", willChange: "transform, opacity", ...style });
  if (tag === "img") {
    const img = e as HTMLImageElement;
    img.src = src;
    img.draggable = false;
    img.alt = "";
  }
  parent.appendChild(e);
  return e;
}

/** The pictures are fetched ahead of time (when the deck step opens, and when a match starts), so the finisher starts at once. */
let warmed = false;
export function warmFinisher(): void {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  // The pictures are fetched, decoded and kept (so playing does not wait for them or decode them), and the slash's pictures are made, all in idle moments a few seconds
  // after the match starts, and not in the middle of the finisher: that start-up work was what dropped frames.
  const idle = (fn: () => void, ms: number) => window.setTimeout(() => ("requestIdleCallback" in window ? (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(fn) : fn()), ms);
  for (const [i, src] of [SCYTHE, FIST_L, SLASH].entries()) idle(() => void loadImage(src), 400 + i * 300);
  idle(() => void slashBands(), 1800);
  idle(() => warmShaders(), 2400);
  idle(() => primeFinisherAudio(), 3000);
}

// ───────────────────────────── the rig ─────────────────────────────
//
// The Reaper is two pieces cut from the artist's picture, drawn by the graphics chip: the scythe (with the fist that holds it at the right, one rigid piece turned about
// the middle of the hands and carried by the lunge, the fingers clenching a little) and the left fist. There is no cloak and no arms: free-floating hands can swing
// the weapon as far as it likes without anything stretching.

const SCYTHE = "/finisher-animation/grim-reaper/scythe.webp";
const FIST_L = "/finisher-animation/grim-reaper/fistL.webp";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 1 inside [a, b], falling to 0 over `soft` pixels outside it. */
const band = (x: number, a: number, b: number, soft: number) => 1 - smooth(0, soft, Math.max(a - x, x - b, 0));

/** The fists (left, right) in the picture: x0, y0, x1, y1. The fingers are curled in these boxes. */
const FISTS: [number, number, number, number][] = [
  [232, 322, 362, 420],
  [572, 222, 722, 332],
];

interface Grid {
  px: Float32Array;
  py: Float32Array;
  uv: Float32Array;
  index: Uint16Array;
}
function gridMesh(nx: number, ny: number): Grid {
  const n = (nx + 1) * (ny + 1);
  const m: Grid = { px: new Float32Array(n), py: new Float32Array(n), uv: new Float32Array(n * 2), index: new Uint16Array(nx * ny * 6) };
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      m.px[k] = (i / nx) * REAPER_W;
      m.py[k] = (j / ny) * REAPER_H;
      m.uv[k * 2] = i / nx;
      m.uv[k * 2 + 1] = j / ny;
    }
  }
  let q = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      m.index.set([a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1], q);
      q += 6;
    }
  }
  return m;
}
/** A grid over a part of the picture (x0, y0, w, h in its own pixels), with texture coordinates 0..1 over that part. */
function gridRect(nx: number, ny: number, x0: number, y0: number, w: number, h: number): Grid {
  const g = gridMesh(nx, ny);
  for (let i = 0; i < g.px.length; i++) {
    g.px[i] = x0 + g.uv[i * 2] * w;
    g.py[i] = y0 + g.uv[i * 2 + 1] * h;
  }
  return g;
}
/** What the body is doing at an instant (all set by the timeline). */
interface Pose {
  /** How far it is below its place (a part of its height), and its size. */
  rise: number;
  scale: number;
  /** The scythe's turn IN THE HANDS (degrees, relative to the body), and the body's own twist (degrees, about the cloak's lower edge): together they are the scythe's turn. */
  rot: number;
  torso: number;
  /** How far the scythe is carried (in the picture's own pixels): the lunge. */
  dx: number;
  dy: number;
  /** The fists' grip, 0 (open) to 1 (clenched), and how much the shaft shudders after the blow. */
  grip: number;
  shudder: number;
  /** The cloak's ripple. */
  ripple: number;
  /** How far the left hand has sunk into its sleeve (0 holding the scythe, 1 gone), and how far the right elbow is bent out. */
  hide: number;
  bend: number;
  /** The body's turn about its upright axis, in degrees (0 facing us with the blade on the right, 180 turned right round with the blade on the left), and how high the hands are lifted. */
  yaw: number;
  lift: number;
  alpha: number;
  /** A white-hot flash of the whole picture at the blow. */
  flash: number;
  t: number;
}

interface Placement {
  s: number;
  ox: number;
  oy: number;
  px: number;
  py: number;
  flip: number;
}

/** The pieces' vertices (x, y, u, v for each), as the graphics chip wants them. */
interface Verts {
  scythe: Float32Array;
  fist: Float32Array;
}
const makeVerts = (scythe: Grid, fist: Grid): Verts => ({
  scythe: new Float32Array(scythe.px.length * 4),
  fist: new Float32Array(fist.px.length * 4),
});

/** The body's own place and size (it grows from its lower edge and rises out of the mat), then to the screen. */
function put(x: number, y: number, p: Pose, k: Placement, out: Float32Array, o: number): void {
  const rx = BASE.x + (x - BASE.x) * p.scale;
  const ry = BASE.y + (y - BASE.y) * p.scale + p.rise * REAPER_H;
  out[o] = k.px + (rx - PIVOT.x) * k.flip * k.s - k.ox;
  out[o + 1] = k.py + (ry - PIVOT.y) * k.flip * k.s - k.oy;
}

/** A point of the scythe's side of the body: turned in the hands (about the middle of the grips), carried by the lunge, twisted with the body, lifted, and turned with it. */
function viaHands(x: number, y: number, p: Pose, c: Trig, o: number[]): void {
  const dx = x - ROT.x;
  const dy = y - ROT.y;
  const hx = ROT.x + dx * c.ca - dy * c.sa + p.dx;
  const hy = ROT.y + dx * c.sa + dy * c.ca + p.dy;
  const tx = hx - BASE.x;
  const ty = hy - BASE.y;
  o[0] = AXIS + (BASE.x + tx * c.cb - ty * c.sb - AXIS) * c.cy;
  o[1] = BASE.y + tx * c.sb + ty * c.cb - p.lift * c.sy;
}
interface Trig {
  ca: number;
  sa: number;
  cb: number;
  sb: number;
  /** The turn about the upright axis: how wide the body shows (negative: seen from behind, mirrored), and how far through the half turn it is. */
  cy: number;
  sy: number;
}
const trigOf = (p: Pose): Trig => ({ ca: Math.cos((p.rot * Math.PI) / 180), sa: Math.sin((p.rot * Math.PI) / 180), cb: Math.cos((p.torso * Math.PI) / 180), sb: Math.sin((p.torso * Math.PI) / 180), cy: Math.cos((p.yaw * Math.PI) / 180), sy: Math.abs(Math.sin((p.yaw * Math.PI) / 180)) });
const tmp2 = [0, 0];

/** The scythe and the fists, one rigid piece (the right fist clenches a little, the shaft shudders after the blow). */
function poseScythe(m: Grid, p: Pose, out: Float32Array, k: Placement): void {
  const c = trigOf(p);
  const ph = p.t * 0.011;
  for (let v = 0; v < m.px.length; v++) {
    let x = m.px[v];
    let y = m.py[v];
    for (let h = 1; h < 2; h++) {
      const [x0, y0, x1, y1] = FISTS[h];
      const f = band(x, x0, x1, 6) * band(y, y0, y1, 6);
      if (f > 0) {
        const u = (x - (x0 + x1) / 2) / ((x1 - x0) / 2);
        const t = clamp01((y - y0) / (y1 - y0));
        const cc = p.grip * (1 + 0.22 * Math.sin(u * 8 + ph * 3 + h * 2));
        const idle = 0.5 + 0.5 * Math.sin(ph * 2.6 + u * 5 + h * 1.7);
        x -= f * u * (cc * 3.2 + idle * 0.8) * (1 - t * 0.6);
        y += f * ((cc * 4.5 + idle * 1.2) * (1 - t) - cc * 1.2 * t);
      }
    }
    if (p.shudder > 0 && x > 420) y += p.shudder * 5 * clamp01((x - 420) / 500) * Math.sin(ph * 14 - x * 0.012);
    viaHands(x, y, p, c, tmp2);
    put(tmp2[0], tmp2[1], p, k, out, v * 4);
    out[v * 4 + 2] = m.uv[v * 2];
    out[v * 4 + 3] = m.uv[v * 2 + 1];
  }
}

/** The left fist: it holds the scythe, so it goes with it. */
function poseFist(m: Grid, p: Pose, out: Float32Array, k: Placement): void {
  const c = trigOf(p);
  for (let v = 0; v < m.px.length; v++) {
    viaHands(m.px[v], m.py[v], p, c, tmp2);
    put(tmp2[0], tmp2[1], p, k, out, v * 4);
    out[v * 4 + 2] = m.uv[v * 2];
    out[v * 4 + 3] = m.uv[v * 2 + 1];
  }
}

const VERT = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  uniform vec2 u_view;
  varying vec2 v_uv;
  void main() {
    gl_Position = vec4(a_pos.x / u_view.x * 2.0 - 1.0, 1.0 - a_pos.y / u_view.y * 2.0, 0.0, 1.0);
    v_uv = a_uv;
  }`;
const FRAG = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_tex;
  uniform float u_alpha;
  uniform float u_flash;
  uniform vec3 u_tint;
  void main() {
    vec4 c = texture2D(u_tex, v_uv);
    c.rgb = c.rgb * u_tint + c.a * vec3(u_flash);
    gl_FragColor = vec4(min(c.rgb, c.a), c.a) * u_alpha;
  }`;

interface Renderer {
  /** Draws with a share of the pixels (the picture is stretched back up by the browser): for a computer that cannot keep up. */
  scaleTo: (k: number) => void;
  begin: () => void;
  /** Draws mesh `mesh` (its index list, given when the renderer was made) with picture `tex`. */
  draw: (mesh: number, tex: number, verts: Float32Array, alpha: number, flash: number, tint: [number, number, number]) => void;
  dispose: () => void;
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
/** A picture, fetched and decoded once and kept (the next time it is wanted it is there already). */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  let pr = imageCache.get(src);
  if (!pr) {
    pr = new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => (img.decode ? img.decode().then(() => resolve(img), () => resolve(img)) : resolve(img));
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, pr);
  }
  return pr;
}

async function makeRenderer(parent: HTMLElement, images: string[], indices: Uint16Array[], left: number, top: number, w: number, h: number, ratio: number): Promise<Renderer | null> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  Object.assign(canvas.style, { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, pointerEvents: "none" });
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const loaded = await Promise.all(images.map(loadImage));
  if (loaded.some((i) => !i)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const ibs = indices.map((idx) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    return b;
  });
  const aPos = gl.getAttribLocation(prog, "a_pos");
  const aUv = gl.getAttribLocation(prog, "a_uv");
  gl.enableVertexAttribArray(aPos);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
  gl.uniform2f(gl.getUniformLocation(prog, "u_view"), w, h);
  const uAlpha = gl.getUniformLocation(prog, "u_alpha");
  const uFlash = gl.getUniformLocation(prog, "u_flash");
  const uTint = gl.getUniformLocation(prog, "u_tint");
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const texs = loaded.map((img) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img!);
    return t;
  });
  parent.appendChild(canvas);
  return {
    scaleTo(k) {
      canvas.width = Math.max(32, Math.round(w * ratio * k));
      canvas.height = Math.max(32, Math.round(h * ratio * k));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    begin() {
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    draw(mesh, tex, verts, alpha, flash, tint) {
      gl.bindTexture(gl.TEXTURE_2D, texs[tex]);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibs[mesh]);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.uniform1f(uAlpha, alpha);
      gl.uniform1f(uFlash, flash);
      gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
      gl.drawElements(gl.TRIANGLES, indices[mesh].length, gl.UNSIGNED_SHORT, 0);
    },
    dispose() {
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

// ───────────────────────────── the timeline ─────────────────────────────

const T_RISE = 560; // the hands come up out of the mat
const T_WIND = 520; // the scythe is drawn back (it keeps moving until the swing: there is no held pose)
const T_HOLD = 0;
const T_SWING = 190; // the swing itself
const T_FOLLOW = 260; // the follow-through
const T_SINK = 1150; // the scythe drops back and the hands sink away
const T_SWING_AT = T_RISE + T_WIND + T_HOLD;
const T_HIT = T_SWING_AT + T_SWING;
const T_END = T_HIT + T_FOLLOW + T_SINK;
const T_RIFT = 1650; // how long the rift stays open

const easeOutBack = (k: number) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);

function timeline(t: number): Pose {
  const p: Pose = { rise: 0, scale: 1, rot: 0, torso: 0, dx: 0, dy: 0, grip: 0.12, shudder: 0, ripple: 0.15, hide: 0, bend: 0, yaw: 0, lift: 0, alpha: 1, flash: 0, t };
  if (t < T_RISE) {
    // the Reaper rises out of the mat
    const k = clamp01(t / T_RISE);
    const e = easeOutBack(k);
    p.rise = (1 - e) * 0.72;
    p.scale = 0.92 + 0.08 * e;
    p.alpha = clamp01(k * 3.5);
    p.ripple = 0.8 * (1 - k) + 0.15;
  } else if (t < T_RISE + T_WIND) {
    // the wind-up: the hands draw the scythe back and low to the right, the blade dipping, and it gathers
    const kk = clamp01((t - T_RISE) / T_WIND);
    const k = 0.45 * smooth(0, 1, kk) + 0.55 * kk; // (eased at the start only: it is still moving when the swing begins)
    const trem = Math.sin(t * 0.16) * 1.4 * smooth(0.55, 1, kk);
    p.rot = 34 * k + trem;
    p.dx = 46 * k + trem;
    p.dy = 26 * k;
    p.scale = 1 + 0.05 * k;
    p.rise = 0.012 * k;
    p.grip = lerp(0.12, 1, k);
  } else if (t < T_SWING_AT) {
    // a held breath: it trembles
    p.rot = 34 + Math.sin(t * 0.14) * 1.2;
    p.dx = 46 + Math.sin(t * 0.11) * 1.5;
    p.dy = 26;
    p.scale = 1.05;
    p.rise = 0.012;
    p.grip = 1;
    p.ripple = 0.35;
  } else if (t < T_HIT) {
    // the swing: one heavy sweep from low on the right, up and over the top, to the left. It gathers speed and is fastest over the top, and the hands are thrown up and
    // across with it, and the weapon grows as it comes at us
    const ks = clamp01((t - T_SWING_AT) / T_SWING);
    const e = Math.pow(ks, 1.7); // (it gathers speed and is fastest at the end, where it hits)
    p.rot = lerp(34, -128, e);
    p.dx = lerp(46, -54, e);
    p.dy = lerp(26, -62, Math.sin(ks * Math.PI * 0.5));
    p.scale = lerp(1.05, 1.2, e);
    p.rise = lerp(0.012, -0.05, e);
    p.grip = 1;
    p.ripple = 0.35 + 0.9 * ks;
  } else {
    // the blow and the follow-through: the blade does not stop; it glides on and slows smoothly, the weapon drifting with it as it lets go and fades
    const u = t - T_HIT;
    const o = 1 - Math.exp(-u / 120); // 0 at the blow, towards 1: the speed dies away smoothly
    const k = clamp01((t - T_HIT - T_FOLLOW) / T_SINK);
    p.rot = -128 - 34 * o;
    p.dx = -54 - 26 * o;
    p.dy = -62 + 16 * o + 60 * smooth(0.3, 1, k);
    p.scale = lerp(1.2, 1.1, o);
    p.rise = lerp(-0.05, -0.02, o) + 0.5 * smooth(0.5, 1, k);
    p.grip = 1;
    p.shudder = Math.max(0, 1 - u / 700);
    p.flash = Math.max(0, 0.3 * (1 - u / T_FOLLOW));
    p.alpha = 1 - smooth(0.12, 0.7, k);
  }
  return p;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** A trace of opacity: a layer that first shows at the blow is given it a little before, so that the browser draws it then and not at the blow (one at a time, so no frame has them all). */
const FAINT = "0.012";

// ───────────────────────────── the slash ─────────────────────────────

/** The slash's picture, laid level (the artist drew it rising to the right) and trimmed, as two pictures: the lightning and the dark between worlds. */
let bandsCache: Promise<{ light: HTMLCanvasElement; dark: HTMLCanvasElement } | null> | null = null;
/** The slash's two pictures, made once and kept. */
function slashBands(): Promise<{ light: HTMLCanvasElement; dark: HTMLCanvasElement } | null> {
  bandsCache ??= makeSlashBands();
  return bandsCache;
}
async function makeSlashBands(): Promise<{ light: HTMLCanvasElement; dark: HTMLCanvasElement } | null> {
  try {
    const img = await loadImage(SLASH);
    if (!img) return null;
    const ang = Math.atan2(0.93 * SLASH_H, 0.94 * SLASH_W); // (the streak rises this far to the right)
    const W2 = Math.ceil(SLASH_W * Math.cos(ang) + SLASH_H * Math.sin(ang));
    const H2 = Math.ceil(SLASH_W * Math.sin(ang) + SLASH_H * Math.cos(ang));
    const big = document.createElement("canvas");
    big.width = W2;
    big.height = H2;
    const g = big.getContext("2d", { willReadFrequently: true })!;
    g.translate(W2 / 2, H2 / 2);
    g.rotate(ang);
    g.drawImage(img, -SLASH_W / 2, -SLASH_H / 2);
    // trim to what is drawn
    const data = g.getImageData(0, 0, W2, H2).data;
    let x0 = W2;
    let x1 = 0;
    let y0 = H2;
    let y1 = 0;
    for (let y = 0; y < H2; y += 2) {
      for (let x = 0; x < W2; x += 2) {
        if (data[(y * W2 + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const cw = Math.max(16, x1 - x0 + 2);
    const ch = Math.max(16, y1 - y0 + 2);
    const light = document.createElement("canvas");
    light.width = cw;
    light.height = ch;
    light.getContext("2d")!.drawImage(big, x0, y0, cw, ch, 0, 0, cw, ch);
    // the dark between worlds: the same shape, a little thicker, filled with night and a few stars
    const dark = document.createElement("canvas");
    dark.width = cw;
    dark.height = ch;
    const d = dark.getContext("2d")!;
    for (const [ox, oy] of [[0, 0], [0, -6], [0, 6], [-5, 0], [5, 0]]) d.drawImage(light, ox, oy);
    d.globalCompositeOperation = "source-in";
    const grad = d.createRadialGradient(cw / 2, ch / 2, 10, cw / 2, ch / 2, cw / 2);
    grad.addColorStop(0, "#5b1a9a");
    grad.addColorStop(0.5, "#1a0536");
    grad.addColorStop(1, "#000");
    d.fillStyle = grad;
    d.fillRect(0, 0, cw, ch);
    d.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 60; i++) {
      d.fillStyle = `rgba(255,255,255,${rnd(0.5, 1)})`;
      d.fillRect(rnd(0, cw), rnd(0, ch), rnd(1, 2.6), rnd(1, 2.6));
    }
    return { light, dark };
  } catch {
    return null;
  }
}

const ARC_VERT = `
  attribute vec2 a_pos;
  attribute vec2 a_norm;
  attribute vec2 a_uv;
  uniform vec2 u_view;
  uniform float u_thick;
  uniform float u_shift;
  varying vec2 v_uv;
  void main() {
    vec2 p = a_pos + a_norm * ((a_uv.y - 0.5) * u_thick + u_shift);
    gl_Position = vec4(p.x / u_view.x * 2.0 - 1.0, 1.0 - p.y / u_view.y * 2.0, 0.0, 1.0);
    v_uv = a_uv;
  }`;
const ARC_FRAG = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_tex;
  uniform float u_alpha;
  uniform float u_reveal;
  uniform float u_head;
  uniform float u_time;
  uniform float u_warp;
  uniform float u_add;
  uniform float u_mode;   // 0: the lightning picture, 1: the rift (a cut that opens on another world)
  uniform vec3 u_tint;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    // it is drawn in from its first end, with a white-hot head that goes in front
    float shown = smoothstep(u_reveal, u_reveal - 0.05, v_uv.x);
    if (u_mode > 0.5) {
      // the rift: a lens-shaped cut, pointed at both ends; its edge is white-hot, and inside it is another world: a purple and blue void full of slowly turning cloud and stars
      float d = abs(v_uv.y - 0.5) * 2.0;
      float w = pow(max(sin(3.14159 * clamp(v_uv.x, 0.0, 1.0)), 0.0), 0.8);
      float inside = smoothstep(w, w - 0.1, d);
      float rim = smoothstep(w - 0.16, w - 0.01, d) * inside;
      float t = u_time * 0.0006;
      vec2 q = vec2(v_uv.x * 7.0 + t * 3.0, v_uv.y * 3.0);
      float n = 0.5 + 0.5 * sin(q.x * 2.0 + sin(q.y * 3.0 + t * 7.0) * 1.6) * sin(q.y * 4.0 - q.x + t * 5.0);
      vec3 col = mix(vec3(0.03, 0.0, 0.09), vec3(0.28, 0.05, 0.55), n * (1.0 - d * 0.6));
      col += vec3(0.0, 0.18, 0.5) * pow(n, 3.0) * (1.0 - d);
      vec2 g = floor(vec2(v_uv.x * 260.0, v_uv.y * 70.0));
      float star = step(0.985, hash(g)) * (0.55 + 0.45 * sin(u_time * 0.01 + hash(g + 3.0) * 30.0));
      col += star * vec3(0.9, 0.85, 1.0);
      col += rim * vec3(1.0, 0.72, 1.0) * 1.5;
      float a = inside * shown * u_alpha;
      gl_FragColor = vec4(min(col, vec3(1.0)) * a, a);
      return;
    }
    // the lightning crawls along the slash (the picture is waved a little, and it flickers)
    vec2 uv = v_uv;
    uv.y += sin(uv.x * 34.0 + u_time * 0.05) * u_warp * 0.014 + sin(uv.x * 71.0 - u_time * 0.09) * u_warp * 0.007;
    vec4 c = texture2D(u_tex, uv);
    float flick = 1.0 + 0.24 * sin(u_time * 0.07 + v_uv.x * 19.0) + 0.14 * sin(u_time * 0.13 - v_uv.x * 43.0);
    float head = smoothstep(0.12, 0.0, abs(v_uv.x - u_reveal + 0.025)) * u_head;
    c.rgb = min(c.rgb * u_tint * flick + c.a * vec3(1.0, 0.85, 1.0) * head * 1.4, c.a * 1.6);
    // both ends fade into points (so the picture never ends in a hard edge)
    float ends = smoothstep(0.0, 0.14, v_uv.x) * smoothstep(1.0, 0.86, v_uv.x);
    float k = shown * u_alpha * ends;
    gl_FragColor = u_add > 0.5 ? vec4(c.rgb * k, 0.0) : c * k;
  }`;

// the flames: soft teardrops of fire, as points
const FLAME_VERT = `
  attribute vec4 a_f;     // x, y, size, life
  uniform vec2 u_view;
  varying float v_life;
  varying float v_seed;
  void main() {
    gl_Position = vec4(a_f.x / u_view.x * 2.0 - 1.0, 1.0 - a_f.y / u_view.y * 2.0, 0.0, 1.0);
    gl_PointSize = a_f.z;
    v_life = a_f.w;
    v_seed = fract(a_f.x * 0.0137 + a_f.y * 0.0071);   // (each flame has its own shape and its own flicker)
  }`;
// A flame with texture: a tongue that narrows to a flickering tip, its edge torn ragged by moving noise, bands of heat running up it, and a white-hot core that
// cools through pink and magenta to violet. All of it is a few sines, so it is cheap to draw even hundreds of times over.
const FLAME_FRAG = `
  precision mediump float;
  varying float v_life;
  varying float v_seed;
  uniform float u_alpha;
  uniform float u_time;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float h = 0.5 - 0.5 * p.y;                        // 0 at the foot, 1 at the tip
    float t = u_time * 0.011 + v_seed * 40.0;
    // the tongue sways and licks, more towards its tip
    float sway = sin(p.y * 4.5 - t * 1.7) * 0.2 * h + sin(p.y * 9.0 + t * 2.6) * 0.07 * h;
    float x = p.x + sway;
    float width = mix(0.82, 0.07, pow(h, 0.8));
    float body = 1.0 - abs(x) / width;
    // ragged edge and bands of heat running up the flame
    float n1 = sin(p.y * 13.0 - t * 3.1 + x * 5.0) * 0.5 + 0.5;
    float n2 = sin(p.y * 27.0 - t * 5.3 - x * 9.0 + v_seed * 20.0) * 0.5 + 0.5;
    float tex = 0.6 * n1 + 0.4 * n2;
    body -= (0.22 + 0.2 * h) * tex;
    body = clamp(body * 1.5, 0.0, 1.0);
    float foot = smoothstep(1.0, 0.7, p.y);          // (it fades out under its foot)
    float edge = 1.0 - smoothstep(0.55, 1.0, max(abs(p.x), abs(p.y)));   // (and before the edge of its square, so that nothing is cut off)
    float a = body * foot * edge * (0.5 + 0.6 * tex);
    float core = pow(clamp(body, 0.0, 1.0), 3.0) * (1.0 - h * 0.6);
    // colour by age and by heat: white-hot at the core, pink, magenta, violet, blue at the edge of the dying flame
    vec3 hot = mix(vec3(1.0, 0.95, 1.0), vec3(1.0, 0.4, 0.95), smoothstep(0.0, 0.4, v_life));
    vec3 col = mix(hot, vec3(0.5, 0.12, 1.0), smoothstep(0.25, 0.85, v_life));
    col = mix(col, vec3(1.0, 0.8, 1.0), core * 0.5);
    col = mix(col, vec3(0.3, 0.2, 1.0), (1.0 - body) * 0.55 * smoothstep(0.2, 0.7, v_life));
    float fade = (1.0 - smoothstep(0.55, 1.0, v_life)) * smoothstep(0.0, 0.07, v_life);
    gl_FragColor = vec4(col * a * fade * u_alpha * 0.85, 0.0);
  }`;

/** What the slash looks like at an instant. */
interface SlashFrame {
  /** How far the slash is drawn in (0 to about 1), how bright it is, how much of the dark between worlds shows, and the white-hot head. */
  reveal: number;
  light: number;
  dark: number;
  head: number;
  /** The time in milliseconds (the lightning crawls with it), how far the rift is open (0 to 1), the colour split's width in pixels, the glow's strength, and the echo cut's strength. */
  time: number;
  open: number;
  chroma: number;
  bloom: number;
  echo: number;
  /** How strong the flames along the slash are. */
  flame: number;
}

interface ArcRenderer {
  draw: (f: SlashFrame) => void;
  scaleTo: (k: number) => void;
  dispose: () => void;
}

/**
 * The slash is drawn as a band bent along a circle (a mesh again, drawn by the graphics chip): `centre` and `radius` are the circle, `from` / `to` the angles
 * it runs between (degrees clockwise from straight up), `thick` the band's thickness. `turned` flips it over when the loser is below.
 */
function makeArcRenderer(
  parent: HTMLElement,
  bands: { light: HTMLCanvasElement; dark: HTMLCanvasElement },
  geo: { pts: [number, number][]; thick: number },
  box: { left: number; top: number; w: number; h: number },
): ArcRenderer | null {
  const canvas = document.createElement("canvas");
  const BASEK = 0.8;
  canvas.width = Math.round(box.w * BASEK);
  canvas.height = Math.round(box.h * BASEK);
  Object.assign(canvas.style, { position: "absolute", left: `${box.left}px`, top: `${box.top}px`, width: `${box.w}px`, height: `${box.h}px`, pointerEvents: "none" });
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, ARC_VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, ARC_FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    return null;
  }
  gl.useProgram(prog);
  // the band: along the blade's path, two vertices each (its two sides)
  const N = geo.pts.length - 1;
  const data = new Float32Array((N + 1) * 2 * 6);
  const idx = new Uint16Array(N * 6);
  const nrm: [number, number][] = [];
  let mx = 0;
  let my = 0;
  for (const [x, y] of geo.pts) {
    mx += x / geo.pts.length;
    my += y / geo.pts.length;
  }
  for (let i = 0; i <= N; i++) {
    const [x, y] = geo.pts[i];
    const [ax, ay] = geo.pts[Math.max(0, i - 1)];
    const [bx, by] = geo.pts[Math.min(N, i + 1)];
    let tx = bx - ax;
    let ty = by - ay;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    let nx = ty;
    let ny = -tx;
    // (the side of the band that faces away from the middle of the path is its outside)
    if (nx * (x - mx) + ny * (y - my) < 0) {
      nx = -nx;
      ny = -ny;
    }
    nrm.push([nx, ny]);
    for (let side = 0; side < 2; side++) data.set([x - box.left, y - box.top, nx, ny, i / N, side], (i * 2 + side) * 6);
    if (i < N) idx.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], i * 6);
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  for (const [name, size, off] of [["a_pos", 2, 0], ["a_norm", 2, 8], ["a_uv", 2, 16]] as const) {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, off);
  }
  gl.uniform2f(gl.getUniformLocation(prog, "u_view"), box.w, box.h);
  const uThick = gl.getUniformLocation(prog, "u_thick");
  const uAlpha = gl.getUniformLocation(prog, "u_alpha");
  const uReveal = gl.getUniformLocation(prog, "u_reveal");
  const uHead = gl.getUniformLocation(prog, "u_head");
  const uShift = gl.getUniformLocation(prog, "u_shift");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uWarp = gl.getUniformLocation(prog, "u_warp");
  const uAdd = gl.getUniformLocation(prog, "u_add");
  const uTint = gl.getUniformLocation(prog, "u_tint");
  const uMode = gl.getUniformLocation(prog, "u_mode");
  const makeTex = (c: HTMLCanvasElement) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    return t;
  };
  const texLight = makeTex(bands.light);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  // the flames: their own little program, and a few particles that live along the cut
  const fprog = gl.createProgram()!;
  gl.attachShader(fprog, compile(gl.VERTEX_SHADER, FLAME_VERT));
  gl.attachShader(fprog, compile(gl.FRAGMENT_SHADER, FLAME_FRAG));
  gl.linkProgram(fprog);
  const flamesOk = !!gl.getProgramParameter(fprog, gl.LINK_STATUS);
  const fbuf = gl.createBuffer();
  const NF = flamesOk ? Math.min(150, Math.max(50, Math.round(geo.pts.length * 2.4))) : 0;
  const part = Array.from({ length: NF }, (_, i) => ({
    u: (i + Math.random()) / Math.max(1, NF),
    side: Math.random() * 2 - 1,
    off: 0.25 + Math.random() * 0.75,
    rise: 0.5 + Math.random() * 1.1,
    sway: Math.random() * 2 - 1,
    speed: 0.7 + Math.random() * 0.9,
    phase0: Math.random(),
    size: 0.6 + Math.random() * 0.9,
  }));
  const fdata = new Float32Array(NF * 4);
  const drawFlames = (f: SlashFrame) => {
    if (!flamesOk || f.flame <= 0.003) return;
    const ratio = canvas.width / box.w;
    let n = 0;
    for (const q of part) {
      if (q.u > f.reveal || q.u < 0.1) continue; // (the flames start where the cut has got to)
      const cyc = (f.time * 0.0011 * q.speed + q.phase0) % 1; // 0 at the birth of this flame, 1 at its end
      const fi = q.u * (geo.pts.length - 1);
      const i0 = Math.floor(fi);
      const i1 = Math.min(geo.pts.length - 1, i0 + 1);
      const fr = fi - i0;
      const [ax, ay] = geo.pts[i0];
      const [bx, by] = geo.pts[i1];
      const [nx0, ny0] = nrm[i0];
      const rw = geo.thick * (0.06 + 0.3 * f.open) * 0.5; // (half the width of the rift)
      const rise = geo.thick * 0.9 * q.rise * cyc;
      const x = ax + (bx - ax) * fr - box.left + nx0 * q.side * rw * q.off + Math.sin(cyc * 7 + q.sway * 5) * geo.thick * 0.07 * q.sway;
      const y = ay + (by - ay) * fr - box.top + ny0 * q.side * rw * q.off - rise;
      const sz = geo.thick * 0.42 * q.size * (0.55 + 0.9 * Math.sin(Math.PI * Math.min(1, cyc * 1.15))) * (0.15 + 0.85 * Math.min(1, (q.u - 0.1) / 0.4));
      fdata[n * 4] = x;
      fdata[n * 4 + 1] = y;
      fdata[n * 4 + 2] = Math.max(4, Math.min(120, sz * ratio));
      fdata[n * 4 + 3] = cyc;
      n++;
    }
    if (n === 0) return;
    gl.useProgram(fprog);
    gl.bindBuffer(gl.ARRAY_BUFFER, fbuf);
    gl.bufferData(gl.ARRAY_BUFFER, fdata.subarray(0, n * 4), gl.DYNAMIC_DRAW);
    const loc = gl.getAttribLocation(fprog, "a_f");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 16, 0);
    gl.uniform2f(gl.getUniformLocation(fprog, "u_view"), box.w, box.h);
    gl.uniform1f(gl.getUniformLocation(fprog, "u_alpha"), f.flame);
    gl.uniform1f(gl.getUniformLocation(fprog, "u_time"), f.time);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // (the flame program's attribute shares an index with one of the band's: the band's three are set up again)
    for (const [name, size, off] of [["a_pos", 2, 0], ["a_norm", 2, 8], ["a_uv", 2, 16]] as const) {
      const bl = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(bl);
      gl.vertexAttribPointer(bl, size, gl.FLOAT, false, 24, off);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  };
  parent.appendChild(canvas);
  return {
    scaleTo(k) {
      canvas.width = Math.max(32, Math.round(box.w * BASEK * k));
      canvas.height = Math.max(32, Math.round(box.h * BASEK * k));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    draw(f) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pass = (tex: WebGLTexture | null, thick: number, shift: number, alpha: number, reveal: number, head: number, warp: number, add: boolean, tint: [number, number, number]) => {
        if (alpha <= 0.003) return;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1f(uThick, thick);
        gl.uniform1f(uShift, shift);
        gl.uniform1f(uAlpha, alpha);
        gl.uniform1f(uReveal, reveal);
        gl.uniform1f(uHead, head);
        gl.uniform1f(uTime, f.time);
        gl.uniform1f(uWarp, warp);
        gl.uniform1f(uAdd, add ? 1 : 0);
        gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      };
      const T = geo.thick;
      gl.uniform1f(uMode, 1);
      // 1. the rift: a cut that tears open (pointed at both ends) on another world, its edge white-hot
      pass(texLight, T * (0.06 + 0.3 * f.open), 0, f.dark, f.reveal - 0.04, 0, 0, false, [1, 1, 1]);
      gl.uniform1f(uMode, 0);
      // 2. the glow round the cut (light that adds to what is behind it)
      pass(texLight, T * 0.8, 0, 0.3 * f.bloom, f.reveal, 0, 1.4, true, [1, 0.4, 1]);
      // 3. the lightning of the slash, thinner now: it is the energy along the lips of the cut
      pass(texLight, T * 0.4, 0, 0.75 * f.light, f.reveal, f.head, 1, false, [1, 1, 1]);
      // 4. the flames that burn and rise all along the cut
      drawFlames(f);
    },
    dispose() {
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** The mat on fire: the same flames as the slash's, burning all over a rectangle (the opponent's mat), catching from the point the blade hit and spreading out from it. */
interface FlameField {
  draw: (ms: number, strength: number) => void;
  scaleTo: (k: number) => void;
  dispose: () => void;
}
function makeFlameField(parent: HTMLElement, mat: Rect, origin: [number, number], vw: number, vh: number, lite: boolean): FlameField | null {
  // (room above the mat for the flames to rise into)
  const head = mat.height * 0.95;
  void head;
  const left = 0; // (as big as the screen: the flames are never cut off by the edge of a box)
  const top = 0;
  const w = vw;
  const h = vh;
  const canvas = document.createElement("canvas");
  const BASEK = lite ? 0.45 : 0.55; // (flames are soft: they are drawn with about a third of the pixels and stretched up by the browser)
  canvas.width = Math.round(w * BASEK);
  canvas.height = Math.round(h * BASEK);
  Object.assign(canvas.style, { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, pointerEvents: "none" });
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, FLAME_VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FLAME_FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const N = lite ? 80 : 140;
  const far = Math.hypot(Math.max(origin[0] - mat.left, mat.left + mat.width - origin[0]), Math.max(origin[1] - mat.top, mat.top + mat.height - origin[1])) || 1;
  const part = Array.from({ length: N }, () => {
    const x = mat.left + Math.random() * mat.width;
    const y = mat.top + mat.height * (0.15 + Math.random() * 0.85);
    return { x, y, ignite: (Math.hypot(x - origin[0], y - origin[1]) / far) * 0.55, speed: 0.55 + Math.random() * 0.8, phase0: Math.random(), size: 0.6 + Math.random() * 0.9, sway: Math.random() * 2 - 1, rise: 0.7 + Math.random() * 1.1 };
  });
  const data = new Float32Array(N * 4);
  const buf = gl.createBuffer();
  const loc = gl.getAttribLocation(prog, "a_f");
  gl.enableVertexAttribArray(loc);
  gl.uniform2f(gl.getUniformLocation(prog, "u_view"), w, h);
  const uAlpha = gl.getUniformLocation(prog, "u_alpha");
  const uTime = gl.getUniformLocation(prog, "u_time");
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  parent.appendChild(canvas);
  return {
    scaleTo(k) {
      canvas.width = Math.max(32, Math.round(w * BASEK * k));
      canvas.height = Math.max(32, Math.round(h * BASEK * k));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    draw(ms, strength) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (strength <= 0.003) return;
      const ratio = canvas.width / w;
      let n = 0;
      for (const q of part) {
        // (the flames catch one by one, nearest the blow first)
        const burn = Math.max(0, Math.min(1, (ms / 900 - q.ignite) * 3));
        if (burn <= 0) continue;
        const cyc = (ms * 0.0011 * q.speed + q.phase0) % 1;
        const rise = mat.height * 0.55 * q.rise * cyc;
        const sz = mat.height * 0.5 * q.size * (0.55 + 0.9 * Math.sin(Math.PI * Math.min(1, cyc * 1.15))) * burn;
        data[n * 4] = q.x - left + Math.sin(cyc * 7 + q.sway * 5) * mat.height * 0.05 * q.sway;
        data[n * 4 + 1] = q.y - top - rise;
        data[n * 4 + 2] = Math.max(4, Math.min(150, sz * ratio));
        data[n * 4 + 3] = cyc;
        n++;
      }
      if (n === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 4), gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 16, 0);
      gl.uniform1f(uAlpha, strength);
      gl.uniform1f(uTime, ms);
      gl.drawArrays(gl.POINTS, 0, n);
    },
    dispose() {
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** Compiles the finisher's shaders once on a throwaway canvas, so that the driver has them ready when the real ones are made (compiling is slow, and was done mid-play). */
function warmShaders(): void {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return;
    for (const [v, f] of [[VERT, FRAG], [ARC_VERT, ARC_FRAG], [FLAME_VERT, FLAME_FRAG]]) {
      const prog = gl.createProgram()!;
      for (const [type, src] of [[gl.VERTEX_SHADER, v], [gl.FRAGMENT_SHADER, f]] as const) {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        gl.attachShader(prog, sh);
      }
      gl.linkProgram(prog);
      gl.getProgramParameter(prog, gl.LINK_STATUS); // (asking makes the driver finish)
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* (nothing to warm) */
  }
}

// ───────────────────────────── the finisher ─────────────────────────────

/** Plays the finisher. `winner` / `loser` are the players whose mats it goes between (null: the preview, which has no mats). Resolves when it is over. */
export async function playFinisher(winner: PlayerId | null, loser: PlayerId | null): Promise<void> {
  if (typeof document === "undefined" || !animationsEnabled()) return;
  warmFinisher();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = rectOf(winner, { left: vw * 0.2, top: vh * 0.55, width: vw * 0.6, height: vh * 0.3 });
  const l = rectOf(loser, { left: vw * 0.2, top: vh * 0.1, width: vw * 0.6, height: vh * 0.3 });
  const lite = liteMode();
  const above = l.top + l.height / 2 < w.top + w.height / 2; // the loser's mat is above the winner's (the usual way round)
  const flip = above ? 1 : -1;
  const matEl = loser ? document.querySelector<HTMLElement>(`[data-mat="${loser}"]`) : null;

  const root = el(document.body, { position: "fixed", inset: "0", zIndex: "9990", overflow: "hidden", willChange: "auto" }); // (fixed: it floats over the whole screen, over everything, wherever the page is scrolled)
  // everything the finisher draws is on one stage, so the blow can shake all of it at once (shaking the page itself would redraw the whole table)
  const stage = el(root, { inset: "0" });
  const run: Animation[] = [];
  const go = (target: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation => {
    const a = target.animate(frames, { fill: "both", ...opts });
    run.push(a);
    return a;
  };
  // Everything is made BEFORE it is shown, and the animations are only started at their moments: making elements and animations while the picture is
  // moving (at the blow, above all) is what makes a frame late. Animations that are given ready-made (paused) are started by `fire`.
  const queued: Record<string, (() => void)[]> = {};
  const later = (when: "intro" | "hit" | "leave", fn: () => void) => (queued[when] ??= []).push(fn);
  const fire = (when: "intro" | "hit" | "leave") => {
    for (const fn of queued[when] ?? []) fn();
    queued[when] = [];
  };
  let raf = 0;
  const promoted: HTMLElement[] = []; // elements made graphics layers of their own ahead of the blow (given back at the end)

  try {
    // ── where the Reaper stands: it is as wide as the winner's mat and may stand taller than it (it is a presence, not a token) ──
    const rw = Math.min(Math.max(w.width * 0.62, w.height * 2.2), vw * 0.8, 640, Math.max(300, (w.top + w.height * 0.62 - vh * 0.1) * 1.9)); // (small enough that the sweep over the top stays on the screen)
    const s = rw / REAPER_W;
    const px = w.left + w.width / 2; // where the pivot is on the screen
    const py = w.top + w.height * (above ? 0.62 : 0.38);
    const grids = { scythe: gridMesh(lite ? 28 : 40, lite ? 14 : 20), fist: gridRect(8, 6, 224, 316, 146, 108) };
    // the canvas is only as big as the places the Reaper can reach (found by trying the extremes of the swing): a smaller picture to put together
    const probe = makeVerts(grids.scythe, grids.fist);
    const K0: Placement = { s, ox: 0, oy: 0, px, py, flip };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [rot, rise, scale, dx, dy] of [[0, 0.72, 1, 0, 0], [0, 0, 1, 0, 0], [34, 0.012, 1.05, 46, 26], [-40, -0.02, 1.12, 20, -30], [-90, -0.04, 1.18, -10, -60], [-128, -0.05, 1.2, -54, -62], [-150, -0.02, 1.1, -70, -20]]) {
      const tp: Pose = { ...timeline(0), rot, torso: 0, rise, scale, dx, dy, grip: 1, shudder: 1, ripple: 1, bend: 1 };
      poseScythe(grids.scythe, tp, probe.scythe, K0);
      poseFist(grids.fist, tp, probe.fist, K0);
      for (const arr of [probe.scythe, probe.fist]) {
        for (let i = 0; i < arr.length; i += 4) {
          x0 = Math.min(x0, arr[i]);
          x1 = Math.max(x1, arr[i]);
          y0 = Math.min(y0, arr[i + 1]);
          y1 = Math.max(y1, arr[i + 1]);
        }
      }
    }
    const left = Math.max(0, Math.floor(x0 - 28));
    const top = Math.max(0, Math.floor(y0 - 28));
    const cw = Math.max(64, Math.min(vw, Math.ceil(x1 + 28)) - left);
    const ch = Math.max(64, Math.min(vh, Math.ceil(y1 + 28)) - top);

    // the table dims towards the edges, so that the eye goes to the middle (it comes up with the Reaper and goes when it does)
    const dim = el(stage, { inset: "-40px", background: "radial-gradient(ellipse at 50% 55%, rgba(24,0,48,.04) 24%, rgba(8,0,20,.84) 100%)", opacity: "0" });
    const aura = el(stage, {
      left: `${px - rw * 0.75}px`,
      top: `${py - REAPER_H * s * 0.55}px`,
      width: `${rw * 1.5}px`,
      height: `${REAPER_H * s * 1.3}px`,
      background: "radial-gradient(ellipse at 50% 60%, rgba(168,85,247,.55), rgba(88,28,135,.25) 45%, transparent 70%)",
      opacity: "0",
    });
    const renderer = await makeRenderer(stage, [SCYTHE, FIST_L], [grids.scythe.index, grids.fist.index], left, top, cw, ch, 1);
    const verts = makeVerts(grids.scythe, grids.fist);
    const trail = lite ? null : new Float32Array(grids.scythe.px.length * 4);
    const K: Placement = { s, ox: left, oy: top, px, py, flip };
    // (without WebGL, the picture itself is turned about its pivot)
    const flat = renderer ? null : el(stage, { left: `${px - PIVOT.x * s}px`, top: `${py - PIVOT.y * s}px`, width: `${rw}px`, height: `${REAPER_H * s}px`, transformOrigin: `${PIVOT.x * s}px ${PIVOT.y * s}px` }, "img", REAPER);

    // ── the slash: it follows the path the tip of the blade takes through the swing (worked out with the same skeleton the picture is moved by) ──
    const K0b: Placement = { s, ox: 0, oy: 0, px, py, flip };
    // The blade's path from the start of the swing to the end of the follow-through; the slash begins where the tip FIRST HITS the opponent's mat (the moment of
    // contact) and follows the tip from there, so nothing is drawn before the blade gets there.
    const T_PATH0 = T_SWING_AT;
    const T_PATH1 = T_HIT + T_FOLLOW;
    const NS = 80;
    const all: [number, number][] = [];
    const tipOut = new Float32Array(4);
    const tipC = { ca: 1, sa: 0, cb: 1, sb: 0, cy: 1, sy: 0 };
    for (let i = 0; i <= NS; i++) {
      const tp = timeline(T_PATH0 + (T_PATH1 - T_PATH0) * (i / NS));
      Object.assign(tipC, trigOf(tp));
      viaHands(TIP.x, TIP.y, tp, tipC, tmp2);
      put(tmp2[0], tmp2[1], tp, K0b, tipOut, 0);
      all.push([tipOut[0], tipOut[1]]);
    }
    let i0 = all.findIndex(([x, y]) => x >= l.left && x <= l.left + l.width && y >= l.top && y <= l.top + l.height);
    if (i0 < 0) {
      // (the tip never enters the mat: it is where it comes closest to the middle of it)
      let best = Infinity;
      all.forEach(([x, y], i) => {
        const d = Math.hypot(x - (l.left + l.width / 2), y - (l.top + l.height / 2));
        if (d < best) [best, i0] = [d, i];
      });
    }
    i0 = Math.max(0, Math.min(i0, NS - 8));
    const T_C = T_PATH0 + (T_PATH1 - T_PATH0) * (i0 / NS); // the moment of first contact
    const pts = all.slice(i0);
    let plen = 0;
    for (let i = 1; i < pts.length; i++) plen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const bands = await slashBands();
    const thick = bands ? (bands.light.height / bands.light.width) * plen * 1.05 : plen * 0.25;
    let ax0 = Infinity;
    let ay0 = Infinity;
    let ax1 = -Infinity;
    let ay1 = -Infinity;
    for (const [x, y] of pts) {
      ax0 = Math.min(ax0, x);
      ax1 = Math.max(ax1, x);
      ay0 = Math.min(ay0, y);
      ay1 = Math.max(ay1, y);
    }
    // (room all round for the flames, which rise above the slash and would be cut off at the edge of a tight box)
    void ax0;
    void ax1;
    void ay0;
    void ay1;
    const arcBox = { left: 0, top: 0, w: vw, h: vh }; // (the whole screen: the slash and its flames are never cut off)
    const arcR = bands ? makeArcRenderer(stage, bands, { pts, thick }, arcBox) : null;
    // where the blade first hits (the blow's flash, shards and ring come from there)
    const cx = pts[0][0];
    const cy = pts[0][1];
    // the opponent's mat burns in the slash's own purple flames, from where the blade hit, and chars under them
    const T_BURN = 4000;
    const matFire = makeFlameField(stage, l, [Math.max(l.left, Math.min(l.left + l.width, cx)), Math.max(l.top, Math.min(l.top + l.height, cy))], vw, vh, lite);
    const heat = el(stage, { left: `${l.left - l.width * 0.2}px`, top: `${l.top - l.height * 0.7}px`, width: `${l.width * 1.4}px`, height: `${l.height * 2.2}px`, background: "radial-gradient(closest-side at 50% 68%, rgba(236,72,220,.55), rgba(124,58,237,.22) 50%, rgba(124,58,237,0) 100%)", opacity: "0" });
    const char = el(stage, { left: `${l.left - l.width * 0.15}px`, top: `${l.top - l.height * 0.3}px`, width: `${l.width * 1.3}px`, height: `${l.height * 1.6}px`, background: "radial-gradient(closest-side at 50% 58%, rgba(40,0,64,.78) 45%, rgba(40,0,64,0) 100%)", opacity: "0" });

    const veil = el(stage, { left: `${l.left - l.width * 0.15}px`, top: `${l.top - l.height * 0.3}px`, width: `${l.width * 1.3}px`, height: `${l.height * 1.6}px`, background: "radial-gradient(closest-side at 50% 58%, rgba(88,28,135,0) 20%, rgba(40,0,70,.75) 70%, rgba(20,0,40,0) 100%)", opacity: "0" });
    const flash = el(stage, { inset: "-40px", background: "radial-gradient(ellipse at 50% 55%, #fff 0%, #e9d5ff 35%, rgba(168,85,247,.6) 80%)", opacity: "0" });
    // the shock ring is made at its full size and grows from nothing (so it is drawn once, not again at every size)
    const RING = 640;
    const ring = el(stage, { left: `${cx - RING / 2}px`, top: `${cy - RING / 2}px`, width: `${RING}px`, height: `${RING}px`, borderRadius: "50%", border: "8px solid rgba(233,213,255,.95)", boxShadow: "0 0 36px 8px rgba(168,85,247,.8)", opacity: "0" });
    let degraded = false; // the computer cannot keep up: the decorations go (see the clock)

    // souls: motes of light rise from the cloak while the Reaper gathers itself
    const motes: Animation[] = [];
    const baseY = py + (BASE.y - PIVOT.y) * s * flip;
    for (let i = 0; i < (lite ? 5 : 11); i++) {
      const size = rnd(5, 13);
      const mote = el(stage, { left: `${px + rnd(-0.42, 0.42) * rw - size / 2}px`, top: `${baseY - size / 2}px`, width: `${size}px`, height: `${size}px`, borderRadius: "50%", background: "radial-gradient(circle, #fff 0%, #f0abfc 40%, rgba(168,85,247,0) 72%)", opacity: "0" });
      const rise = rnd(90, 300) * (above ? -1 : 1);
      const frames: Keyframe[] = [{ opacity: 0, transform: "translate(0,0) scale(.4)" }, { opacity: 0.95, transform: `translate(${rnd(-30, 30)}px, ${rise * 0.4}px) scale(1)`, offset: 0.25 }, { opacity: 0, transform: `translate(${rnd(-70, 70)}px, ${rise}px) scale(.3)` }];
      const dur = rnd(1300, 2600);
      const delay = rnd(0, 2300);
      later("intro", () => motes.push(go(mote, frames, { duration: dur, delay, easing: "ease-out" })));
    }

    // shards of the broken air: made now, flung out of the top of the slash at the blow and drawn back into the rift
    for (let i = 0; i < (lite ? 4 : 8); i++) {
      const a = rnd(0, Math.PI * 2);
      const dist = rnd(140, 420);
      const size = rnd(12, 32);
      const shard = el(stage, { left: `${cx - size * 0.3}px`, top: `${cy - size / 2}px`, width: `${size * 0.6}px`, height: `${size}px`, background: "linear-gradient(160deg, #fff, #e879f9 55%, #7c3aed)", clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)", opacity: "0" });
      const ox = Math.cos(a) * dist;
      const oy = Math.sin(a) * dist * 0.7;
      const spin = rnd(-540, 540);
      const frames: Keyframe[] = [{ opacity: 0, transform: "translate(0,0) rotate(0deg) scale(.3)" }, { opacity: 1, transform: `translate(${ox}px, ${oy}px) rotate(${spin * 0.5}deg) scale(1)`, offset: 0.3 }, { opacity: 1, transform: `translate(${ox * 0.9}px, ${oy * 0.9 + 16}px) rotate(${spin * 0.6}deg) scale(1)`, offset: 0.55 }, { opacity: 0, transform: `translate(${ox * 0.05}px, ${oy * 0.05}px) rotate(${spin}deg) scale(.2)` }];
      const dur = rnd(1000, 1500);
      // (made paused, and played at the blow)
      const sa = shard.animate(frames, { duration: dur, easing: "cubic-bezier(.2,.7,.3,1)", fill: "both" });
      sa.pause();
      run.push(sa);
      later("hit", () => sa.play());
    }

    // sparks: bright streaks thrown off the cut, one by one as the blade passes (made now, paused, and played at the contact)
    for (let i = 0; i < (lite ? 6 : 12); i++) {
      const f = Math.random();
      const idx = Math.min(pts.length - 2, Math.floor(f * (pts.length - 1)));
      const [x, y] = pts[idx];
      const [nx0, ny0] = pts[idx + 1];
      let tx = nx0 - x;
      let ty = ny0 - y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const side = Math.random() < 0.5 ? -1 : 1;
      const dist = rnd(50, 190);
      const ox = -ty * side * dist + tx * rnd(-30, 60);
      const oy = tx * side * dist + ty * rnd(-30, 60) + rnd(10, 50);
      const len = rnd(10, 26);
      const ang = (Math.atan2(oy, ox) * 180) / Math.PI;
      const spark = el(stage, { left: `${x - len / 2}px`, top: `${y - 1.5}px`, width: `${len}px`, height: "3px", borderRadius: "2px", background: "linear-gradient(90deg, rgba(255,255,255,0), #fff 60%, #f0abfc)", boxShadow: "0 0 8px 2px rgba(217,70,239,.9)", opacity: "0" });
      const sa = spark.animate([{ opacity: 0, transform: `translate(0,0) rotate(${ang}deg) scaleX(.4)` }, { opacity: 1, transform: `translate(${ox * 0.35}px,${oy * 0.35}px) rotate(${ang}deg) scaleX(1.4)`, offset: 0.2 }, { opacity: 0, transform: `translate(${ox}px,${oy}px) rotate(${ang}deg) scaleX(.5)` }], { duration: rnd(450, 900), delay: f * (T_PATH1 - T_C), easing: "cubic-bezier(.1,.7,.3,1)", fill: "both" });
      sa.pause();
      run.push(sa);
      later("hit", () => sa.play());
    }

    // the cards nearest the tear on the loser's mat are dragged towards it and let go (their places are measured now, before anything moves)
    if (matEl) {
      const cards = Array.from(matEl.querySelectorAll<HTMLElement>("[data-card-iid]"))
        .map((c) => {
          const b = c.getBoundingClientRect();
          return { c, vx: cx - (b.left + b.width / 2), vy: cy - (b.top + b.height / 2) };
        })
        .sort((a, b) => Math.hypot(a.vx, a.vy) - Math.hypot(b.vx, b.vy))
        .slice(0, lite ? 4 : 8);
      for (const { c } of cards) promoted.push(c);
      for (const { c, vx, vy } of cards) {
        const d = Math.hypot(vx, vy) || 1;
        const amp = Math.min(30, 10 + 2600 / (d + 60));
        const ux = (vx / d) * amp;
        const uy = (vy / d) * amp;
        // (made paused, and played at the blow)
        const a = c.animate([{ transform: "translate(0px,0px)" }, { transform: `translate(${ux}px,${uy}px)`, offset: 0.18 }, { transform: `translate(${ux * 0.7}px,${uy * 0.7}px)`, offset: 0.7 }, { transform: "translate(0px,0px)" }], { duration: 1500, composite: "add", easing: "ease-in-out" });
        a.pause();
        run.push(a);
        later("hit", () => a.play());
      }
    }

    // letterbox bars: it is a scene
    const barH = Math.round(vh * 0.075);
    const barTop = el(stage, { left: "-40px", top: "0", width: "calc(100% + 80px)", height: `${barH}px`, background: "#000", transform: "translateY(-100%)" });
    const barBottom = el(stage, { left: "-40px", bottom: "0", width: "calc(100% + 80px)", height: `${barH}px`, background: "#000", transform: "translateY(100%)" });

    // the blow lands: the world reacts (the picture is never stopped: the blade goes straight through)
    const blow = () => {
      go(flash, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 380, easing: "ease-out" });
      go(ring, [{ opacity: 1, transform: "scale(.05)" }, { opacity: 0, transform: "scale(1)" }], { duration: 650, easing: "cubic-bezier(.1,.7,.2,1)" });
      go(heat, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0.85, offset: 0.8 }, { opacity: 0 }], { duration: T_BURN + 300, easing: "ease-in-out" });
      go(char, [{ opacity: 0 }, { opacity: 0.95, offset: 0.12 }, { opacity: 0.85, offset: 0.8 }, { opacity: 0 }], { duration: T_BURN + 300, easing: "ease-in-out" });
      go(veil, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.85, offset: 0.7 }, { opacity: 0 }], { duration: T_RIFT, easing: "ease-in-out" });
      // the blow shakes the stage
      const shake: Keyframe[] = [];
      for (let i = 0; i <= 16; i++) {
        const k = i / 16;
        const a = Math.pow(1 - k, 2) * (lite ? 12 : 20);
        shake.push({ transform: `translate(${(Math.sin(k * 46) * a).toFixed(1)}px, ${(Math.cos(k * 37) * a * 0.7).toFixed(1)}px)` });
      }
      go(stage, shake, { duration: 750, easing: "linear" });
      // the mat reels (it is only moved a little: that is done by the graphics chip, and the mat is not drawn again)
      if (matEl) go(matEl, [{ transform: "none" }, { transform: "translate(-8px,4px)", offset: 0.1 }, { transform: "translate(7px,-3px)", offset: 0.25 }, { transform: "translate(-4px,2px)", offset: 0.45 }, { transform: "translate(1px,-1px)", offset: 0.7 }, { transform: "none" }], { duration: 1400, easing: "ease-out" });
      go(aura, [{ opacity: 1 }, { opacity: 0 }], { duration: T_SINK, easing: "ease-in", delay: T_FOLLOW });
      if (!degraded) fire("hit"); // (on a computer that is struggling, the shards and the cards pulled to the tear are left out)
    };

    later("intro", () => {
      // the mat and the cards that are about to be moved by the blow become graphics layers NOW (while the Reaper is still rising), not at the blow, which is when the
      // browser would otherwise have to draw them again from scratch (that was the hitch at the moment of contact)
      if (matEl) promoted.push(matEl);
      for (const e of promoted) e.style.willChange = "transform";
      go(dim, [{ opacity: 0 }, { opacity: 1 }], { duration: 650, easing: "ease-out" });
      go(aura, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: "ease-out" });
      go(barTop, [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }], { duration: 450, easing: "cubic-bezier(.2,.8,.2,1)" });
      go(barBottom, [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 450, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
    later("leave", () => {
      go(dim, [{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: "ease-in" });
      go(barTop, [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], { duration: 700, easing: "ease-in" });
      go(barBottom, [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], { duration: 700, easing: "ease-in" });
    });

    // ── the clock: one timeline drives the skeleton and starts each effect at its moment ──
    // (two frames are given to the browser first, to put every layer together before anything moves)
    if (renderer) {
      renderer.begin();
      renderer.draw(0, 0, verts.scythe, 0, 0, [1, 1, 1]);
      renderer.draw(1, 1, verts.fist, 0, 0, [1, 1, 1]);
    }
    matFire?.draw(900, 0.4);
    matFire?.draw(0, 0);
    arcR?.draw({ reveal: 1, light: 0.5, dark: 0.5, head: 0, time: 0, open: 1, chroma: 4, bloom: 0.5, echo: 0.5, flame: 0.5 }); // (the slash's pictures are sent to the graphics chip now, not at the blow)
    arcR?.draw({ reveal: 0, light: 0, dark: 0, head: 0, time: 0, open: 0, chroma: 0, bloom: 0, echo: 0, flame: 0 });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    fire("intro");
    const rate = 1000 / scaled(1000); // the speed setting
    const trails = lite ? 0 : 3;
    const started = new Set<string>();
    const once = (key: string, fn: () => void) => {
      if (!started.has(key)) {
        started.add(key);
        fn();
      }
    };
    let clock = 0;
    let last = performance.now();
    // (when each big layer is drawn for the first time, in timeline milliseconds)
    const warm: [number, HTMLElement | null][] = [[250, ring], [450, veil], [650, flash]];
    let warmed = 0;
    let lastReal = performance.now();
    let late = 0; // how many screen refreshes in a row came late
    const T_STOP = Math.max(T_END, T_C + T_BURN + 120);
    await new Promise<void>((resolve) => {
      const frame = () => {
        // If the computer cannot keep up, the decorations go first (the souls, the shards, the ghost copies of the scythe), then it is drawn with fewer pixels.
        const realNow = performance.now();
        const gap = realNow - lastReal;
        lastReal = realNow;
        if (clock > 250 && !degraded) {
          late = gap > 24 ? late + 1 : Math.max(0, late - 1);
          if (late >= 4) {
            degraded = true;
            for (const m of motes) m.cancel();
            renderer?.scaleTo(0.7);
            arcR?.scaleTo(0.7);
            matFire?.scaleTo(0.7);
          }
        }
        const now = performance.now();
        const dt = now - last;
        last = now;
        clock += dt * rate;
        const t = clock;
        const p = timeline(t);
        while (warmed < warm.length && t >= warm[warmed][0]) {
          const e = warm[warmed++][1];
          if (e) {
            e.style.opacity = FAINT;
            window.setTimeout(() => (e.style.opacity = "0"), 90); // (drawn once, then left alone)
          }
        }
        once("rise", () => playSound("reaperRise"));
        if (t >= T_RISE + 120) once("charge", () => playSound("reaperCharge"));
        if (t >= T_SWING_AT - 20) once("swingsound", () => playSound("reaperSwing"));
        // the sounds of the blow are made a moment BEFORE it (while the Reaper holds its breath) and set to start at it: making sounds takes the browser a little while
        if (t >= T_SWING_AT - 140) {
          once("blowsound", () => {
            const d = Math.max(0, (T_C - t) / rate / 1000);
            playSound("riftTear", d);
            playSound("riftFire", d + 0.1);
          });
        }
        if (t >= T_C) {
          once("hit", () => {
            blow();
          });
        }
        if (t >= T_HIT + T_FOLLOW) once("leave", () => fire("leave"));
        // the slash is drawn in along its arc as the blade goes round it, stays while the rift is open, and goes
        if (matFire) {
          const km = t - T_C;
          matFire.draw(Math.max(0, km), km < 0 ? 0 : smooth(0, 200, km) * (1 - smooth(T_BURN - 1400, T_BURN, km)));
        }
        if (arcR) {
          const kc = t - T_C;
          const reveal = clamp01(kc / (T_PATH1 - T_C)) * 1.06;
          const fade = kc < 0 ? 0 : 1 - smooth(T_RIFT * 0.62, T_RIFT, kc);
          const open = smooth(0, 150, kc) * (1 - 0.94 * smooth(T_RIFT * 0.5, T_RIFT, kc)); // the rift tears open at once and then slowly closes
          const chroma = Math.max(0, 15 * (1 - smooth(0, 520, kc))) * (kc < 0 ? 0 : 1);
          const bloom = kc < 0 ? 0 : fade * (1 - 0.6 * smooth(0, 700, kc)) * (0.85 + 0.15 * Math.sin(t * 0.05));
          const echo = kc < 0 ? 0 : fade * smooth(40, 200, kc);
          arcR.draw({ reveal, light: fade, dark: fade, head: kc < 0 || t >= T_PATH1 ? 0 : 1, time: t, open, chroma, bloom, echo, flame: fade });
        }
        if (renderer) {
          poseScythe(grids.scythe, p, verts.scythe, K);
          poseFist(grids.fist, p, verts.fist, K);
          renderer.begin();
          const swinging = t >= T_SWING_AT - 20 && t < T_HIT + 150;
          if (trail && swinging && !degraded) {
            // ghosts of the scythe a few moments ago, fainter the further back
            for (let g = trails; g >= 1; g--) {
              poseScythe(grids.scythe, timeline(Math.max(0, t - g * 22)), trail, K);
              renderer.draw(0, 0, trail, [0, 0.5, 0.3, 0.16][g] * p.alpha, 0.4, [1.2, 0.9, 1.35]);
            }
          }
          renderer.draw(0, 0, verts.scythe, p.alpha, p.flash, [1, 1, 1]);
          renderer.draw(1, 1, verts.fist, p.alpha, p.flash, [1, 1, 1]);
        } else if (flat) {
          flat.style.opacity = String(p.alpha);
          flat.style.transform = `translateY(${p.rise * REAPER_H * s * flip}px) rotate(${(above ? 0 : 180) + p.rot}deg) scale(${p.scale})`;
        }
        if (t >= T_STOP) return resolve();
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
    await wait(120);
    for (const a of run) if (a.playState !== "finished") a.finish();
    renderer?.dispose();
    arcR?.dispose();
    matFire?.dispose();
  } finally {
    cancelAnimationFrame(raf);
    for (const e of promoted) e.style.willChange = "";
    for (const a of run) {
      try {
        a.cancel();
      } catch {
        /* (already gone) */
      }
    }
    root.remove();
  }
}
