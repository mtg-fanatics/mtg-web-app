const KEY = "mtg-sound";

/** Sound effects are on unless the player turns them off with the switch in the top bar. */
export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true; // storage blocked, or running on the server
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // ignore: the switch just won't be remembered
  }
}

const VOLUME_KEY = "mtg-sound-volume";
const DEFAULT_VOLUME = 0.8;
const LOUDEST = 0.6; // the effects' master gain at full volume

export function soundVolume(): number {
  try {
    const saved = localStorage.getItem(VOLUME_KEY);
    const v = Number(saved);
    return saved !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function setSoundVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    // ignore: the setting just won't be remembered
  }
  out?.out.gain.setTargetAtTime(v * LOUDEST, out.ctx.currentTime, 0.05);
}

export type Sound =
  | "draw"
  | "shuffle"
  | "land"
  | "creature"
  | "cast"
  | "ability"
  | "attack"
  | "charge"
  | "block"
  | "hit"
  | "clash"
  | "die"
  | "lifeGain"
  | "lifeLoss"
  | "burn"
  | "counter"
  | "discard"
  | "turn"
  | "notify"
  | "win"
  | "lose"
  | "reaperRise"
  | "reaperCharge"
  | "reaperSwing"
  | "riftTear"
  | "riftFire"
  | "judgment"
  | "voidCollapse"
  | "meteor"
  | "absoluteZero"
  | "cardKnock"
  | "cardSlam"
  | "riftCrackle1"
  | "riftCrackle2"
  | "riftCrackle3";

// Every sound is synthesized with the Web Audio API: no files to load, and it works offline.
interface Out {
  ctx: AudioContext;
  out: GainNode;
}

let ctx: AudioContext | null = null;
let out: Out | null = null;
let noise1s: AudioBuffer | null = null;

/** The page's one audio context, shared by the sound effects and the music. Null where there is no audio. */
export function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    // Browsers keep audio suspended until the page has been clicked; resume() starts it once that has happened.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One second of white noise, made once and reused. */
export function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise1s) {
    noise1s = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noise1s.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise1s;
}

function audio(): Out | null {
  if (!soundEnabled()) return null;
  const c = audioContext();
  if (!c) return null;
  if (!out) {
    const master = c.createGain();
    master.gain.value = soundVolume() * LOUDEST;
    master.connect(c.destination);
    out = { ctx: c, out: master };
  }
  return out;
}

let reverb: { input: GainNode; ctx: AudioContext } | null = null;
/** A big dark room, made once: two seconds of noise that dies away (stereo, a little different in each ear). Sounds sent to it ring on after they stop. */
function reverbFor(a: Out): GainNode {
  if (!reverb || reverb.ctx !== a.ctx) {
    const len = Math.floor(a.ctx.sampleRate * 2.2);
    const ir = a.ctx.createBuffer(2, len, a.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = a.ctx.createConvolver();
    conv.buffer = ir;
    const input = a.ctx.createGain();
    const dark = a.ctx.createBiquadFilter();
    dark.type = "lowpass";
    dark.frequency.value = 3200; // (a dark room: the high end dies first)
    const wetOut = a.ctx.createGain();
    wetOut.gain.value = 0.9;
    input.connect(conv).connect(dark).connect(wetOut).connect(a.out);
    reverb = { input, ctx: a.ctx };
  }
  return reverb.input;
}

/** A quick rise to `gain`, then an exponential fade to silence over `dur` seconds. `wet` sends some of it to the reverb as well. */
function envelope(a: Out, t: number, dur: number, gain: number, wet = 0, att = 0.008): GainNode {
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + att);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  env.connect(a.out);
  if (wet > 0) {
    const send = a.ctx.createGain();
    send.gain.value = wet;
    env.connect(send).connect(reverbFor(a));
  }
  return env;
}

interface ToneOpts {
  freq: number;
  /** Slides the pitch to this by the end. */
  to?: number;
  type?: OscillatorType;
  at?: number;
  dur?: number;
  gain?: number;
  /** How much of it also goes to the reverb. */
  wet?: number;
  /** Seconds to rise to full loudness (a swell is slow). */
  att?: number;
}

function tone(a: Out, { freq, to, type = "sine", at = 0, dur = 0.2, gain = 0.2, wet = 0, att }: ToneOpts) {
  const t = a.ctx.currentTime + at;
  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  osc.connect(envelope(a, t, dur, gain, wet, att));
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

interface NoiseOpts {
  /** Where the filter sits; it slides to `to` by the end. */
  freq: number;
  to?: number;
  filter?: BiquadFilterType;
  q?: number;
  at?: number;
  dur?: number;
  gain?: number;
  wet?: number;
  att?: number;
  /** A tremble in its loudness: how fast (Hz) and how deep (0 to 1): the flutter of a flame. */
  flutter?: [number, number];
}

/** Filtered white noise: high and narrow it is a swish, low it is a thud. */
function noise(a: Out, { freq, to, filter = "bandpass", q = 1, at = 0, dur = 0.15, gain = 0.2, wet = 0, flutter, att }: NoiseOpts) {
  const t = a.ctx.currentTime + at;
  const src = a.ctx.createBufferSource();
  src.buffer = noiseBuffer(a.ctx);
  src.loop = true; // (the noise is one second long: the long sounds, like the fire, go round it)
  const f = a.ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  let last: AudioNode = f;
  if (flutter) {
    // the loudness trembles: a slow oscillator moves a gain up and down (fast and deep is a roaring flame, slow and shallow is wind)
    const m = a.ctx.createGain();
    m.gain.value = 1 - flutter[1] * 0.5;
    const lfo = a.ctx.createOscillator();
    lfo.frequency.value = flutter[0];
    const depth = a.ctx.createGain();
    depth.gain.value = flutter[1] * 0.5;
    lfo.connect(depth).connect(m.gain);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    f.connect(m);
    last = m;
  }
  src.connect(f);
  last.connect(envelope(a, t, dur, gain, wet, att));
  src.start(t);
  src.stop(t + dur + 0.05);
}

const notes = (a: Out, freqs: number[], step: number, opts: Omit<ToneOpts, "freq" | "at">, at = 0) =>
  freqs.forEach((freq, i) => tone(a, { ...opts, freq, at: at + i * step }));

/** Short hands for writing a long sound by its numbers: a tone and a noise, each (pitch, slide to, length, loudness, delay, ...). */
function shims(a: Out, base: number) {
  const T = (freq: number, to: number, dur: number, gain: number, d = 0, type: OscillatorType = "sine", wet = 0, att?: number) => tone(a, { freq, to, dur, gain, at: base + d, type, wet, att });
  const N = (freq: number, to: number, dur: number, gain: number, d = 0, filter: BiquadFilterType = "bandpass", q = 1, wet = 0, att?: number) => noise(a, { freq, to, dur, gain, at: base + d, filter, q, wet, att });
  return [T, N] as const;
}

/** A few clusters of crackles and pops over `span` seconds starting at `at`; `from` is how far into the fire's life that is (later ones are quieter). */
function crackles(a: Out, at: number, span: number, from: number): void {
  for (let c = 0; c < 5; c++) {
    const k = Math.random();
    const when = at + k * span;
    const loud = 1 - Math.min(1, (from + k * span) / 4.1) * 0.8;
    const n = 1 + Math.floor(Math.random() * 4);
    for (let j = 0; j < n; j++) {
      noise(a, { freq: 1800 + Math.random() * 4200, to: 500 + Math.random() * 900, filter: "bandpass", q: 2.5, dur: 0.025 + Math.random() * 0.07, gain: (0.25 + Math.random() * 0.35) * loud, at: when + j * (0.02 + Math.random() * 0.05), wet: 0.35 });
    }
  }
}

const RECIPES: Record<Sound, (a: Out, at: number) => void> = {
  // a card sliding off the library
  draw: (a, at) => noise(a, { freq: 1800, to: 4800, q: 0.8, dur: 0.13, gain: 0.22, at }),
  shuffle: (a, at) => {
    for (let i = 0; i < 7; i++) noise(a, { freq: 2600 + (i % 3) * 500, q: 1.2, dur: 0.05, gain: 0.16, at: at + i * 0.045 });
  },
  land: (a, at) => {
    tone(a, { freq: 120, to: 50, dur: 0.24, gain: 0.45, at });
    noise(a, { freq: 500, filter: "lowpass", dur: 0.09, gain: 0.18, at });
  },
  creature: (a, at) => {
    tone(a, { freq: 190, to: 70, type: "triangle", dur: 0.28, gain: 0.4, at });
    noise(a, { freq: 900, filter: "lowpass", dur: 0.12, gain: 0.2, at });
    notes(a, [330, 494], 0.06, { dur: 0.35, gain: 0.07 }, at + 0.04);
  },
  // a shimmer rising
  cast: (a, at) => {
    notes(a, [660, 880, 1320], 0.05, { dur: 0.38, gain: 0.1 }, at);
    noise(a, { freq: 6000, filter: "highpass", dur: 0.32, gain: 0.05, at });
  },
  ability: (a, at) => tone(a, { freq: 520, to: 820, dur: 0.14, gain: 0.14, at }),
  // war drums
  attack: (a, at) => {
    tone(a, { freq: 95, to: 60, type: "triangle", dur: 0.22, gain: 0.5, at });
    tone(a, { freq: 110, to: 65, type: "triangle", dur: 0.3, gain: 0.55, at: at + 0.16 });
    noise(a, { freq: 300, filter: "lowpass", dur: 0.12, gain: 0.25, at: at + 0.16 });
  },
  // the whoosh of a creature charging
  charge: (a, at) => noise(a, { freq: 350, to: 1900, q: 0.7, dur: 0.34, gain: 0.26, at }),
  block: (a, at) => {
    tone(a, { freq: 260, to: 190, type: "triangle", dur: 0.16, gain: 0.25, at });
    noise(a, { freq: 700, filter: "lowpass", dur: 0.08, gain: 0.2, at });
  },
  // a punch landing on the player
  hit: (a, at) => {
    tone(a, { freq: 170, to: 40, dur: 0.26, gain: 0.6, at });
    noise(a, { freq: 1400, to: 200, filter: "lowpass", dur: 0.16, gain: 0.4, at });
  },
  // two creatures crashing into each other
  clash: (a, at) => {
    noise(a, { freq: 3200, q: 7, dur: 0.22, gain: 0.3, at });
    notes(a, [587, 831], 0, { type: "triangle", dur: 0.26, gain: 0.08 }, at);
    tone(a, { freq: 150, to: 50, dur: 0.2, gain: 0.4, at });
  },
  die: (a, at) => {
    tone(a, { freq: 300, to: 55, type: "sawtooth", dur: 0.5, gain: 0.08, at });
    noise(a, { freq: 700, to: 90, filter: "lowpass", dur: 0.42, gain: 0.18, at });
  },
  lifeGain: (a, at) => notes(a, [784, 988, 1175, 1568], 0.06, { dur: 0.32, gain: 0.1 }, at),
  lifeLoss: (a, at) => tone(a, { freq: 230, to: 170, dur: 0.26, gain: 0.2, at }),
  // a crackle of fire
  burn: (a, at) => {
    noise(a, { freq: 1000, to: 280, q: 1.5, dur: 0.32, gain: 0.3, at });
    tone(a, { freq: 210, to: 80, type: "sawtooth", dur: 0.22, gain: 0.06, at });
  },
  counter: (a, at) => {
    notes(a, [620, 310], 0.09, { type: "square", dur: 0.16, gain: 0.05 }, at);
    noise(a, { freq: 2000, to: 500, dur: 0.2, gain: 0.12, at });
  },
  discard: (a, at) => noise(a, { freq: 1300, to: 600, dur: 0.16, gain: 0.2, at }),
  // a bell: your turn
  turn: (a, at) => {
    tone(a, { freq: 880, dur: 0.9, gain: 0.12, at });
    tone(a, { freq: 1320, dur: 0.9, gain: 0.1, at: at + 0.14 });
  },
  // a new notification: two short rising notes, softer than the turn bell
  notify: (a, at) => notes(a, [988, 1319], 0.11, { type: "sine", dur: 0.4, gain: 0.13 }, at),
  win: (a, at) => {
    notes(a, [523, 659, 784], 0.12, { type: "triangle", dur: 0.3, gain: 0.18 }, at);
    tone(a, { freq: 1047, type: "triangle", dur: 0.9, gain: 0.2, at: at + 0.36 });
  },
  lose: (a, at) => notes(a, [392, 330, 262], 0.22, { type: "triangle", dur: 0.55, gain: 0.15 }, at),
  // The Grim Reaper finisher. It rises: a deep swell under a cold wind, in a big dark room.
  reaperRise: (a, at) => {
    tone(a, { freq: 48, to: 96, type: "sawtooth", dur: 1.2, gain: 0.12, at, wet: 0.5 });
    tone(a, { freq: 73, to: 146, type: "triangle", dur: 1.2, gain: 0.1, at, wet: 0.5 });
    noise(a, { freq: 300, to: 1800, q: 0.7, dur: 1.1, gain: 0.2, at, wet: 0.6, flutter: [5, 0.5] });
    tone(a, { freq: 880, to: 1320, type: "sine", dur: 1.0, gain: 0.03, at: at + 0.2, wet: 1 });
  },
  // It gathers itself: a rising, trembling tension with a whispering shimmer on top.
  reaperCharge: (a, at) => {
    tone(a, { freq: 90, to: 360, type: "sawtooth", dur: 0.9, gain: 0.1, at, wet: 0.3 });
    tone(a, { freq: 135, to: 540, type: "square", dur: 0.9, gain: 0.04, at, wet: 0.3 });
    noise(a, { freq: 500, to: 4200, q: 1.4, dur: 0.9, gain: 0.22, at, wet: 0.4, flutter: [14, 0.6] });
    for (let i = 0; i < 7; i++) tone(a, { freq: 1400 + i * 260, to: 900 + i * 200, type: "sine", dur: 0.22, gain: 0.035, at: at + 0.12 + i * 0.1, wet: 1 });
  },
  // The swing: a heavy whoosh that rises past you and falls away, with a body to it.
  reaperSwing: (a, at) => {
    noise(a, { freq: 300, to: 4800, q: 1.0, dur: 0.2, gain: 0.4, at, wet: 0.35 });
    noise(a, { freq: 4800, to: 500, q: 0.8, dur: 0.3, gain: 0.3, at: at + 0.18, wet: 0.5 });
    tone(a, { freq: 150, to: 50, type: "sawtooth", dur: 0.45, gain: 0.14, at, wet: 0.3 });
    noise(a, { freq: 900, to: 220, filter: "lowpass", dur: 0.4, gain: 0.45, at: at + 0.1 });
  },
  // The cut: a crack, a boom that shakes, glass-like shimmer, and the room ringing after it as the world tears.
  riftTear: (a, at) => {
    noise(a, { freq: 5200, to: 900, filter: "highpass", q: 0.7, dur: 0.2, gain: 0.7, at, wet: 0.6 });
    tone(a, { freq: 120, to: 30, type: "sine", dur: 1.2, gain: 0.95, at, wet: 0.5 });
    noise(a, { freq: 260, to: 60, filter: "lowpass", dur: 1.0, gain: 0.95, at, wet: 0.6 });
    tone(a, { freq: 62, to: 28, type: "sine", dur: 1.6, gain: 0.5, at: at + 0.04, wet: 0.3 });
    tone(a, { freq: 78, to: 38, type: "sawtooth", dur: 0.7, gain: 0.16, at, wet: 0.4 });
    for (let i = 0; i < 8; i++) tone(a, { freq: 1500 + i * 430, to: 700 + i * 210, type: "triangle", dur: 0.9, gain: 0.05, at: at + 0.03 + i * 0.045, wet: 1.2 });
    noise(a, { freq: 2600, to: 400, q: 2, dur: 1.2, gain: 0.16, at: at + 0.12, wet: 1 });
    tone(a, { freq: 44, to: 40, type: "sine", dur: 2.2, gain: 0.2, at: at + 0.1, wet: 0.2 });
  },
  // The fire: a roaring body that flutters, a bright hiss, a deep draught, and crackles and pops in clusters, all through the room.
  riftFire: (a, at) => {
    const T = 4.1;
    noise(a, { freq: 300, to: 700, filter: "lowpass", q: 0.8, dur: 1.2, gain: 1.5, at, wet: 0.2, flutter: [9, 0.5] });
    noise(a, { freq: 700, to: 200, filter: "lowpass", q: 0.8, dur: T - 0.9, gain: 1.15, at: at + 0.9, wet: 0.25, flutter: [7, 0.55] });
    noise(a, { freq: 1500, to: 900, filter: "bandpass", q: 0.6, dur: T - 0.5, gain: 0.24, at: at + 0.3, wet: 0.3, flutter: [11, 0.5] });
    noise(a, { freq: 6000, to: 3500, filter: "highpass", q: 0.6, dur: T - 0.7, gain: 0.07, at: at + 0.2, flutter: [18, 0.7] }); // (the hiss)
    tone(a, { freq: 62, to: 46, type: "sawtooth", dur: T, gain: 0.1, at, wet: 0.2 });
  },
  // the fire's crackles arrive in little clusters, as real fire's do, and thin out as it dies. They are three sounds, each its own stretch of the fire's four seconds, so that they can
  // be made one at a time in different frames (they are a great many audio nodes: all together they dropped a frame)
  riftCrackle1: (a, at) => crackles(a, at + 0.05, 1.4, 0),
  riftCrackle2: (a, at) => crackles(a, at + 1.45, 1.35, 1.4),
  riftCrackle3: (a, at) => crackles(a, at + 2.8, 0.75, 2.75),
  // ── the four finishers: Heaven's Judgment, Void Collapse, Meteor Strike, Absolute Zero (each is timed to its animation, from the moment it starts) ──
  judgment: (a, at) => {
    const [T, N] = shims(a, at);
    T(48, 120, 0.95, 0.14, 0, "sawtooth", 0.4, 0.4); T(72, 180, 0.95, 0.1, 0, "triangle", 0.4, 0.4);
    N(200, 3500, 0.9, 0.22, 0, "bandpass", 1, 0.5, 0.5);
    N(7000, 1500, 0.2, 0.75, 0.9, "highpass"); T(2400, 90, 0.2, 0.2, 0.9, "sawtooth");
    N(500, 60, 2.6, 0.85, 0.92, "lowpass", 0.7, 0.6); T(115, 26, 1.9, 0.8, 0.9, "sine", 0.4);
    N(1800, 200, 1.4, 0.35, 1.0, "bandpass", 0.8, 0.8);
    N(160, 55, 2.4, 0.5, 2.0, "lowpass", 0.7, 0.7, 0.5); T(70, 32, 2.0, 0.28, 2.1, "sine", 0.5, 0.4); // the thunder rolls on
    N(6000, 1200, 0.15, 0.4, 1.18, "highpass"); N(300, 50, 1.2, 0.4, 1.2, "lowpass", 0.7, 0.5);
    N(3500, 2600, 2.4, 0.07, 1.0, "bandpass", 4); T(120, 118, 2.6, 0.05, 1.0, "square");
    for (let i = 0; i < 20; i++) N(2500 + Math.random() * 4500, 500 + Math.random() * 1000, 0.03 + Math.random() * 0.06, 0.12 + Math.random() * 0.26, 1.05 + Math.pow(Math.random(), 1.3) * 2.6, "bandpass", 3, 0.3);
  },
  voidCollapse: (a, at) => {
    const [T, N] = shims(a, at);
    T(40, 62, 4.4, 0.34, 0.2, "sawtooth", 0.4, 1.2); T(60, 480, 3.4, 0.16, 0.6, "triangle", 0.9, 1.8);
    N(200, 2400, 2.8, 0.34, 1.1, "bandpass", 0.8, 0.5, 1.6);
    // a heartbeat that gets faster as the hole grows
    for (let k = 0, tt = 1.0; tt < 3.55; k++) {
      T(58, 34, 0.22, 0.34 + k * 0.012, tt, "sine", 0.25);
      T(52, 32, 0.2, 0.24 + k * 0.012, tt + 0.16, "sine", 0.2);
      tt += Math.max(0.3, 0.78 - k * 0.07);
    }
    N(4000, 150, 0.8, 0.34, 3.5, "bandpass", 1, 0.2, 0.5);
    T(95, 22, 2.4, 0.95, 4.3, "sine", 0.5); N(1900, 80, 2.2, 0.8, 4.3, "lowpass", 0.7, 0.7); N(6000, 900, 0.25, 0.6, 4.3, "highpass");
    for (let i = 0; i < 9; i++) T(1000 + i * 360, 500 + i * 160, 1.1, 0.045, 4.36 + i * 0.05, "triangle", 1.2);
    N(150, 80, 1.6, 0.25, 4.9, "lowpass", 0.6, 0.6);
  },
  meteor: (a, at) => {
    const [T, N] = shims(a, at);
    for (let i = 0; i < 3; i++) T(240, 240, 0.12, 0.1, 0.1 + i * 0.35, "square", 0.2);
    N(300, 3200, 0.95, 0.34, 0.4, "bandpass", 0.8, 0.2, 0.5); T(60, 150, 0.95, 0.22, 0.4, "sawtooth", 0.2, 0.5);
    T(105, 20, 2.4, 0.78, 1.3, "sine", 0.4); N(1100, 60, 2.2, 0.78, 1.3, "lowpass", 0.7, 0.6); N(5000, 800, 0.3, 0.5, 1.3, "highpass");
    N(2400, 300, 0.7, 0.4, 1.34, "bandpass", 0.8, 0.8);
    for (let i = 0; i < 14; i++) N(300 + Math.random() * 1100, 150 + Math.random() * 350, 0.04 + Math.random() * 0.08, 0.2 + Math.random() * 0.3, 1.5 + Math.random() * 1.8, "bandpass", 2, 0.3);
    N(600, 280, 3.2, 0.3, 1.6, "lowpass", 0.8, 0.3, 0.4);
  },
  absoluteZero: (a, at) => {
    const [T, N] = shims(a, at);
    N(380, 900, 5.6, 0.32, 0, "bandpass", 0.5, 0.4, 0.8);
    // the ice groans and creaks as it strains, just before it breaks
    T(78, 46, 0.9, 0.2, 2.3, "sawtooth", 0.5, 0.4); T(120, 70, 0.7, 0.12, 2.5, "triangle", 0.5, 0.3);
    for (let i = 0; i < 5; i++) N(700 + Math.random() * 500, 260, 0.2, 0.18, 2.4 + i * 0.16, "bandpass", 5, 0.4);
    for (let i = 0; i < 7; i++) T(1800 + Math.random() * 1500, 1500 + Math.random() * 1300, 0.8, 0.045, 0.3 + i * 0.32, "sine", 1.2);
    for (let i = 0; i < 30; i++) N(4500 + Math.random() * 4500, 3000 + Math.random() * 3000, 0.02 + Math.random() * 0.03, 0.07 + Math.random() * 0.13, 0.6 + Math.random() * 2.3, "bandpass", 5, 0.5);
    T(700, 3600, 0.75, 0.08, 2.6, "sine", 0.6, 0.4);
    N(3500, 700, 0.3, 0.6, 2.9, "highpass", 1, 0.4); T(90, 55, 0.5, 0.35, 2.9, "sine");
    for (let i = 0; i < 4; i++) N(4000 + Math.random() * 4000, 1500, 0.1, 0.4, 3.0 + i * 0.1, "highpass");
    N(5200, 2200, 0.55, 0.85, 3.4, "highpass", 1, 0.5); T(80, 26, 1.5, 0.75, 3.4, "sine", 0.3);
    for (let i = 0; i < 40; i++) N(3000 + Math.random() * 6500, 2000 + Math.random() * 4000, 0.03 + Math.random() * 0.05, 0.12 + Math.random() * 0.22, 3.42 + Math.pow(Math.random(), 1.4) * 1.1, "bandpass", 6, 0.6);
    for (let i = 0; i < 10; i++) T(2200 + Math.random() * 2000, 1800 + Math.random() * 1700, 0.7, 0.04, 3.6 + Math.random() * 1.4, "sine", 1.3);
  },
  // a card knocking on the table (a light tick), and one slamming down or hit hard
  cardKnock: (a, at) => {
    noise(a, { freq: 1500, to: 500, q: 1.2, dur: 0.05, gain: 0.2 + Math.random() * 0.08, at });
    tone(a, { freq: 190 + Math.random() * 60, to: 90, type: "triangle", dur: 0.07, gain: 0.12, at });
  },
  cardSlam: (a, at) => {
    noise(a, { freq: 1000, to: 200, filter: "lowpass", dur: 0.13, gain: 0.36, at });
    tone(a, { freq: 150, to: 58, type: "sine", dur: 0.16, gain: 0.28, at });
    noise(a, { freq: 2200, to: 800, q: 2, dur: 0.04, gain: 0.14, at });
  },
};

/** Makes the audio context and its noise ahead of the first sound: creating them is the slow part of a first sound (a pause of several frames in the middle of the game). */
export function primeAudio(): void {
  const a = audio();
  if (a) noiseBuffer(a.ctx);
}

/** Builds the finisher's reverb room ahead of time (making it takes a few milliseconds, which would otherwise be taken in the middle of the finisher). */
export function primeFinisherAudio(): void {
  const a = audio();
  if (a) reverbFor(a);
}

/** Plays `sound`, `at` seconds from now. Does nothing when sound is off or the browser has no audio. */
export function playSound(sound: Sound, at = 0): void {
  const a = audio();
  if (!a) return;
  try {
    RECIPES[sound](a, at);
  } catch {
    // a sound that fails to play should never interrupt the game
  }
}
