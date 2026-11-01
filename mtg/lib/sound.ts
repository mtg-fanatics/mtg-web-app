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
  | "riftFire";

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
function envelope(a: Out, t: number, dur: number, gain: number, wet = 0): GainNode {
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
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
}

function tone(a: Out, { freq, to, type = "sine", at = 0, dur = 0.2, gain = 0.2, wet = 0 }: ToneOpts) {
  const t = a.ctx.currentTime + at;
  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  osc.connect(envelope(a, t, dur, gain, wet));
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
  /** A tremble in its loudness: how fast (Hz) and how deep (0 to 1): the flutter of a flame. */
  flutter?: [number, number];
}

/** Filtered white noise: high and narrow it is a swish, low it is a thud. */
function noise(a: Out, { freq, to, filter = "bandpass", q = 1, at = 0, dur = 0.15, gain = 0.2, wet = 0, flutter }: NoiseOpts) {
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
  last.connect(envelope(a, t, dur, gain, wet));
  src.start(t);
  src.stop(t + dur + 0.05);
}

const notes = (a: Out, freqs: number[], step: number, opts: Omit<ToneOpts, "freq" | "at">, at = 0) =>
  freqs.forEach((freq, i) => tone(a, { ...opts, freq, at: at + i * step }));

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
    noise(a, { freq: 5200, to: 900, filter: "highpass", q: 0.7, dur: 0.2, gain: 0.45, at, wet: 0.6 });
    tone(a, { freq: 120, to: 30, type: "sine", dur: 1.1, gain: 0.55, at, wet: 0.5 });
    noise(a, { freq: 260, to: 60, filter: "lowpass", dur: 0.9, gain: 0.55, at, wet: 0.6 });
    tone(a, { freq: 78, to: 38, type: "sawtooth", dur: 0.7, gain: 0.16, at, wet: 0.4 });
    for (let i = 0; i < 8; i++) tone(a, { freq: 1500 + i * 430, to: 700 + i * 210, type: "triangle", dur: 0.9, gain: 0.05, at: at + 0.03 + i * 0.045, wet: 1.2 });
    noise(a, { freq: 2600, to: 400, q: 2, dur: 1.2, gain: 0.16, at: at + 0.12, wet: 1 });
    tone(a, { freq: 44, to: 40, type: "sine", dur: 2.2, gain: 0.2, at: at + 0.1, wet: 0.2 });
  },
  // The fire: a roaring body that flutters, a bright hiss, a deep draught, and crackles and pops in clusters, all through the room.
  riftFire: (a, at) => {
    const T = 4.1;
    noise(a, { freq: 300, to: 700, filter: "lowpass", q: 0.8, dur: 1.2, gain: 1.1, at, wet: 0.2, flutter: [9, 0.5] });
    noise(a, { freq: 700, to: 200, filter: "lowpass", q: 0.8, dur: T - 0.9, gain: 0.85, at: at + 0.9, wet: 0.25, flutter: [7, 0.55] });
    noise(a, { freq: 1500, to: 900, filter: "bandpass", q: 0.6, dur: T - 0.5, gain: 0.24, at: at + 0.3, wet: 0.3, flutter: [11, 0.5] });
    noise(a, { freq: 6000, to: 3500, filter: "highpass", q: 0.6, dur: T - 0.7, gain: 0.07, at: at + 0.2, flutter: [18, 0.7] }); // (the hiss)
    tone(a, { freq: 62, to: 46, type: "sawtooth", dur: T, gain: 0.1, at, wet: 0.2 });
    // crackles arrive in little clusters, as real fire's do, and thin out as it dies
    for (let c = 0; c < 15; c++) {
      const k = Math.random();
      const when = at + 0.05 + k * (T - 0.6);
      const loud = 1 - k * 0.8;
      const n = 1 + Math.floor(Math.random() * 4);
      for (let j = 0; j < n; j++) {
        noise(a, { freq: 1800 + Math.random() * 4200, to: 500 + Math.random() * 900, filter: "bandpass", q: 2.5, dur: 0.025 + Math.random() * 0.07, gain: (0.25 + Math.random() * 0.35) * loud, at: when + j * (0.02 + Math.random() * 0.05), wet: 0.35 });
      }
    }
  },
};

/** Makes the audio context and its noise ahead of the first sound: creating them is the slow part of a first sound (a pause of several frames in the middle of the game). */
export function primeAudio(): void {
  const a = audio();
  if (a) noiseBuffer(a.ctx);
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
