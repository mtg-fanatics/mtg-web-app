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

/** A quick rise to `gain`, then an exponential fade to silence over `dur` seconds. */
function envelope(a: Out, t: number, dur: number, gain: number): GainNode {
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  env.connect(a.out);
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
}

function tone(a: Out, { freq, to, type = "sine", at = 0, dur = 0.2, gain = 0.2 }: ToneOpts) {
  const t = a.ctx.currentTime + at;
  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  osc.connect(envelope(a, t, dur, gain));
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
}

/** Filtered white noise: high and narrow it is a swish, low it is a thud. */
function noise(a: Out, { freq, to, filter = "bandpass", q = 1, at = 0, dur = 0.15, gain = 0.2 }: NoiseOpts) {
  const t = a.ctx.currentTime + at;
  const src = a.ctx.createBufferSource();
  src.buffer = noiseBuffer(a.ctx);
  src.loop = true; // (the noise is one second long: the long sounds, like the fire, go round it)
  const f = a.ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  src.connect(f).connect(envelope(a, t, dur, gain));
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
  // The Grim Reaper finisher. It rises: a deep swell under a breath of wind.
  reaperRise: (a, at) => {
    tone(a, { freq: 48, to: 96, type: "sawtooth", dur: 1.1, gain: 0.12, at });
    tone(a, { freq: 73, to: 146, type: "triangle", dur: 1.1, gain: 0.1, at });
    noise(a, { freq: 300, to: 1600, q: 0.7, dur: 1.0, gain: 0.16, at });
  },
  // It gathers itself: a rising, trembling tension.
  reaperCharge: (a, at) => {
    tone(a, { freq: 90, to: 360, type: "sawtooth", dur: 0.85, gain: 0.1, at });
    tone(a, { freq: 135, to: 540, type: "square", dur: 0.85, gain: 0.04, at });
    noise(a, { freq: 500, to: 4200, q: 1.4, dur: 0.85, gain: 0.2, at });
    for (let i = 0; i < 6; i++) tone(a, { freq: 1400 + i * 260, to: 900 + i * 200, type: "sine", dur: 0.2, gain: 0.03, at: at + 0.15 + i * 0.11 });
  },
  // The swing: a heavy whoosh that falls away after it passes.
  reaperSwing: (a, at) => {
    noise(a, { freq: 350, to: 4200, q: 1.1, dur: 0.22, gain: 0.34, at });
    noise(a, { freq: 4200, to: 600, q: 0.9, dur: 0.26, gain: 0.24, at: at + 0.2 });
    tone(a, { freq: 140, to: 55, type: "sawtooth", dur: 0.42, gain: 0.12, at });
  },
  // The cut: a crack, a boom that shakes, and glass-like shimmer as the world tears.
  riftTear: (a, at) => {
    noise(a, { freq: 5200, to: 900, filter: "highpass", q: 0.7, dur: 0.18, gain: 0.4, at });
    tone(a, { freq: 120, to: 32, type: "sine", dur: 0.9, gain: 0.5, at });
    noise(a, { freq: 260, to: 70, filter: "lowpass", dur: 0.7, gain: 0.5, at });
    tone(a, { freq: 78, to: 40, type: "sawtooth", dur: 0.6, gain: 0.14, at });
    for (let i = 0; i < 7; i++) tone(a, { freq: 1500 + i * 430, to: 700 + i * 210, type: "triangle", dur: 0.7, gain: 0.05, at: at + 0.03 + i * 0.045 });
    noise(a, { freq: 2600, to: 400, q: 2, dur: 0.9, gain: 0.14, at: at + 0.12 });
  },
  // The fire: a low roar that swells and dies away, with crackles and pops all through it.
  riftFire: (a, at) => {
    const T = 4.1;
    noise(a, { freq: 300, to: 700, filter: "lowpass", q: 0.8, dur: 1.2, gain: 1.1, at });
    noise(a, { freq: 700, to: 200, filter: "lowpass", q: 0.8, dur: T - 0.9, gain: 0.8, at: at + 0.9 });
    noise(a, { freq: 1500, to: 900, filter: "bandpass", q: 0.6, dur: T - 0.5, gain: 0.22, at: at + 0.3 });
    tone(a, { freq: 62, to: 46, type: "sawtooth", dur: T, gain: 0.1, at });
    for (let i = 0; i < 38; i++) {
      const k = Math.random();
      const when = at + 0.05 + k * (T - 0.5);
      const loud = 1 - k * 0.8; // (the crackling thins out as the fire dies)
      noise(a, { freq: 1800 + Math.random() * 4200, to: 500 + Math.random() * 900, filter: "bandpass", q: 2.5, dur: 0.03 + Math.random() * 0.07, gain: (0.25 + Math.random() * 0.35) * loud, at: when });
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
