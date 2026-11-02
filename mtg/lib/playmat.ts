"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { PlayerId } from "@mtg/engine";

// What each player picks for the table, kept in this browser only:
//   Card sleeves: the back of their cards (library, the draw animation).
//   Playmat: the surface their half of the battlefield is drawn on.
// A choice is stored as "preset:<id>" or as a data: URL for a picture from the computer. Empty = the player's default.

export interface Look {
  id: string;
  name: string;
  /** Mats only: the picture this mat is made of (the others are drawn in CSS). A picture can be moved and zoomed. */
  picture?: string;
  /** A CSS `background` value (layers allowed). */
  css: string;
  /** Sleeves only: the color of the thin frame drawn inside the card back. */
  edge?: string;
}

const grain = "repeating-linear-gradient(115deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 8px)";
const dots = "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1.5px) 0 0 / 14px 14px";
const felt = (a: string, b: string, glow: string) => `radial-gradient(ellipse at 50% 0%, ${glow}, transparent 60%), ${grain}, linear-gradient(165deg, ${a}, ${b})`;

/**
 * Pictures prepared in public/cardsleeves and public/playermats. To add one: put the file in that folder and add a line here
 * (an id nobody else uses, a name for the list, the file name).
 */
const picture = (folder: string, file: string) => `center / cover url("/${folder}/${encodeURIComponent(file)}")`;
/**
 * A playmat picture: it fills the whole mat and is cropped to fit (never stretched, tiled or mirrored). `x` and `y` (percent) say which
 * part of the picture stays in view; the zoom is applied by the mat layer itself (see matLayerStyle).
 */
const fitted = (url: string, x = 50, y = 50) => `${x}% ${y}% / cover no-repeat url("${url}")`;
const SLEEVE_PICTURES: [string, string, string][] = [
  ["pic-s0", "Sleeve 1", "MTG CARD SLEEVE.jpg"],
  ["pic-s1", "Sleeve 2", "MGT CARD SLEEVE 1.jpg"],
  ["pic-s2", "Sleeve 3", "MGT CARD SLEEVE 2.jpg"],
  ["pic-s3", "Sleeve 4", "MGT CARD SLEEVE 3.jpg"],
  ["pic-s4", "Sleeve 5", "MGT CARD SLEEVE 4.jpg"],
  ["pic-s5", "Sleeve 6", "MGT CARD SLEEVE 5.jpg"],
  ["pic-s6", "Sleeve 7", "MGT CARD SLEEVE 6.jpg"],
  ["pic-s7", "Sleeve 8", "MGT CARD SLEEVE 7.jpg"],
  ["pic-s8", "Sleeve 9", "MGT CARD SLEEVE 8.jpg"],
];
const MAT_PICTURES: [string, string, string][] = [
  ["pic-m0", "Mat 1", "fit/mtg player mat.jpg"], // (trimmed copies of two pictures that sat on a white backdrop; the originals are in the folder above)
  ["pic-m1", "Mat 2", "fit/mtg player mat 2.jpg"],
  ["pic-m2", "Mat 3", "MGT player mat 1.png"],
  ["pic-m3", "Mat 4", "mgt player mat 2.jpg"],
  ["pic-m4", "Mat 5", "mgt player mat 3.jpg"],
  ["pic-m5", "Mat 6", "mgt palyer mat 4.jpg"],
];

export const SLEEVES: Look[] = [
  ...SLEEVE_PICTURES.map(([id, name, file]): Look => ({ id, name, edge: "rgba(255,255,255,.28)", css: picture("cardsleeves", file) })),
  { id: "classic", name: "Classic gold", edge: "rgba(252,211,77,.55)", css: "linear-gradient(135deg,#b45309,#78350f 55%,#1c1917)" },
  { id: "crimson", name: "Crimson", edge: "rgba(254,202,202,.6)", css: "repeating-linear-gradient(45deg, rgba(255,255,255,.08) 0 5px, transparent 5px 10px), linear-gradient(135deg,#dc2626,#7f1d1d 60%,#1c0a0a)" },
  { id: "azure", name: "Azure", edge: "rgba(186,230,253,.6)", css: "repeating-linear-gradient(-45deg, rgba(255,255,255,.08) 0 5px, transparent 5px 10px), linear-gradient(135deg,#38bdf8,#1d4ed8 55%,#0b1437)" },
  { id: "emerald", name: "Emerald", edge: "rgba(187,247,208,.6)", css: "radial-gradient(circle at 50% 50%, rgba(255,255,255,.12) 0 18%, transparent 19%) 0 0 / 16px 16px, linear-gradient(135deg,#22c55e,#14532d 60%,#052e16)" },
  { id: "violet", name: "Violet", edge: "rgba(221,214,254,.6)", css: "repeating-linear-gradient(45deg, rgba(255,255,255,.07) 0 4px, transparent 4px 9px), linear-gradient(135deg,#a78bfa,#5b21b6 55%,#1e0a3c)" },
  { id: "obsidian", name: "Obsidian", edge: "rgba(250,204,21,.7)", css: "repeating-linear-gradient(135deg, rgba(250,204,21,.12) 0 1px, transparent 1px 9px), linear-gradient(135deg,#27272a,#09090b)" },
  { id: "silver", name: "Silver", edge: "rgba(255,255,255,.8)", css: "linear-gradient(135deg,#e2e8f0,#64748b 55%,#1e293b)" },
  { id: "dragon", name: "Dragon scale", edge: "rgba(253,186,116,.65)", css: "radial-gradient(circle at 50% 0, transparent 40%, rgba(0,0,0,.35) 42% 50%, transparent 52%) 0 0 / 15px 12px, linear-gradient(160deg,#f97316,#b91c1c 55%,#2a0707)" },
  { id: "wheel", name: "Mana wheel", edge: "rgba(255,255,255,.65)", css: "radial-gradient(circle at 50% 50%, #0b0f1a 0 22%, transparent 23%), conic-gradient(from 0deg, #fde68a, #60a5fa, #a78bfa, #fb7185, #4ade80, #fde68a)" },
];

// ───────── Inkfall's own mats: made of CSS and tiny SVG noise, no pictures. They fill any size without a seam. ─────────
const svgNoise = (freq: string, matrix: string, size = 240) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='${matrix}'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
const grainDark = svgNoise(".85", "0 0 0 0 .2 0 0 0 0 .13 0 0 0 0 .07 0 0 0 .5 -.12");
const grainPale = svgNoise(".7", "0 0 0 0 .95 0 0 0 0 .85 0 0 0 0 .65 0 0 0 .16 -.03");
const mottle = svgNoise(".012 .018", "0 0 0 0 .35 0 0 0 0 .24 0 0 0 0 .1 0 0 0 .75 -.28", 420);
const cloud = svgNoise(".006 .009", "0 0 0 0 .05 0 0 0 0 .04 0 0 0 0 .03 0 0 0 1.6 -.55", 600);
const fibre = svgNoise(".02 .6", "0 0 0 0 .9 0 0 0 0 .8 0 0 0 0 .6 0 0 0 .22 -.06", 300);
const INK_MATS: Look[] = [
  { id: "ink-parchment", name: "Aged parchment", css: `${grainDark} 0 0 / 240px 240px, ${mottle} 0 0 / 420px 420px, radial-gradient(ellipse at 18% 8%, rgba(255,240,200,.55), transparent 55%), radial-gradient(ellipse at 90% 100%, rgba(110,70,25,.38), transparent 60%), linear-gradient(160deg, #dccaa0, #bba478)` },
  { id: "ink-felt", name: "Dark felt", css: `${grainPale} 0 0 / 240px 240px, ${fibre} 0 0 / 300px 300px, radial-gradient(ellipse at 50% 0%, rgba(255,226,170,.1), transparent 60%), linear-gradient(165deg, #3a2f26, #1d1611)` },
  { id: "ink-slate", name: "Slate", css: `${grainPale} 0 0 / 240px 240px, repeating-linear-gradient(98deg, rgba(255,255,255,.035) 0 1px, transparent 1px 37px), radial-gradient(ellipse at 30% 10%, rgba(210,220,225,.18), transparent 55%), linear-gradient(170deg, #4a4f52, #2b2e30)` },
  { id: "ink-wash", name: "Ink wash", css: `${cloud} 0 0 / 600px 600px, ${grainPale} 0 0 / 240px 240px, radial-gradient(ellipse at 25% 20%, rgba(150,120,85,.32), transparent 58%), radial-gradient(ellipse at 80% 85%, rgba(20,14,9,.55), transparent 62%), linear-gradient(155deg, #4a3d30, #241b14)` },
];
/** The four mats Inkfall draws itself: the table's own defaults. */
export const INK_MAT_IDS = INK_MATS.map((m) => m.id);

export const MATS: Look[] = [
  ...INK_MATS,
  ...MAT_PICTURES.map(([id, name, file]): Look => {
    const picture = `/playermats/${file.split("/").map(encodeURIComponent).join("/")}`;
    return { id, name, picture, css: fitted(picture) };
  }),
  { id: "azure", name: "Azure felt", css: felt("#1e3a8a", "#0b1437", "rgba(125,211,252,.28)") },
  { id: "crimson", name: "Crimson felt", css: felt("#991b1b", "#2a0707", "rgba(253,164,175,.26)") },
  { id: "forest", name: "Forest", css: felt("#166534", "#052e16", "rgba(134,239,172,.26)") },
  { id: "plains", name: "Plains", css: felt("#a8873f", "#4a3a14", "rgba(254,243,199,.35)") },
  { id: "island", name: "Island", css: felt("#0e7490", "#082f49", "rgba(165,243,252,.3)") },
  { id: "swamp", name: "Swamp", css: felt("#4c1d95", "#150a2e", "rgba(196,181,253,.24)") },
  { id: "mountain", name: "Mountain", css: felt("#c2410c", "#3b0f06", "rgba(253,186,116,.3)") },
  { id: "obsidian", name: "Obsidian", css: `repeating-linear-gradient(135deg, rgba(250,204,21,.07) 0 1px, transparent 1px 22px), ${dots}, linear-gradient(160deg,#18181b,#020202)` },
  { id: "walnut", name: "Walnut table", css: "repeating-linear-gradient(90deg, rgba(0,0,0,.12) 0 3px, transparent 3px 11px), repeating-linear-gradient(90deg, rgba(255,255,255,.04) 0 1px, transparent 1px 37px), linear-gradient(180deg,#7c4a21,#3b200c)" },
  { id: "wheel", name: "Mana wheel", css: "radial-gradient(circle at 50% 50%, rgba(5,8,22,.88) 0 20%, transparent 21%), conic-gradient(from 20deg, #78350f, #1e3a8a, #4c1d95, #7f1d1d, #14532d, #78350f)" },
];

/** What each player gets until they choose something else. */
export const DEFAULT_MAT: Record<PlayerId, string> = { p1: "pic-m0", p2: "ink-felt" }; // (the second seat, and so the computer, sits at dark felt)
export const DEFAULT_SLEEVE = "pic-s0";

const key = (kind: "sleeve" | "mat", who: PlayerId) => `mtg-${kind}-${who}`;
const mineKey = (kind: "sleeve" | "mat") => `mtg-${kind}-me`;
function read(k: string): string {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
function write(k: string, v: string): boolean {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** The look for a stored choice (or the default), as a CSS background and the sleeve's frame color. */
export function resolve(kind: "sleeve" | "mat", stored: string, who: PlayerId): { css: string; edge: string; id: string | null; /** Mats: which part of the picture is in view, and the zoom. */ fx: MatFocus; /** Mats: this one is a picture, so it can be moved and zoomed. */ movable: boolean; /** Where this mat's focus is kept. */ focusKey: string } {
  const list = kind === "sleeve" ? SLEEVES : MATS;
  if (stored.startsWith("data:")) {
    const focusKey = `upload:${stored.length}:${stored.slice(-24)}`;
    const fx = kind === "mat" ? matFocus(focusKey) : DEFAULT_FOCUS;
    return { css: kind === "mat" ? fitted(stored, fx.x, fx.y) : `center / cover url("${stored}")`, edge: "rgba(255,255,255,.55)", id: null, fx, movable: kind === "mat", focusKey };
  }
  const id = stored.startsWith("preset:") ? stored.slice(7) : kind === "sleeve" ? DEFAULT_SLEEVE : DEFAULT_MAT[who];
  const look = list.find((l) => l.id === id) ?? list[0];
  const fx = kind === "mat" && look.picture ? matFocus(look.id) : DEFAULT_FOCUS;
  return { css: kind === "mat" && look.picture ? fitted(look.picture, fx.x, fx.y) : look.css, edge: look.edge ?? "rgba(255,255,255,.5)", id: look.id, fx, movable: kind === "mat" && Boolean(look.picture), focusKey: look.id };
}

// ───────── where a mat picture sits in its panel: kept in this browser for each mat, never sent to the other player ─────────
export interface MatFocus {
  /** Percent from the left / top of the picture that stays in view (50 = the middle). */
  x: number;
  y: number;
  /** 1 to 2. */
  zoom: number;
}
export const DEFAULT_FOCUS: MatFocus = { x: 50, y: 50, zoom: 1 };
const FOCUS_KEY = "mtg-matfx";
let focusVersion = 0;
const focusListeners = new Set<() => void>();
const clampFocus = (f: MatFocus): MatFocus => ({ x: Math.min(100, Math.max(0, f.x)), y: Math.min(100, Math.max(0, f.y)), zoom: Math.min(2, Math.max(1, f.zoom)) });
function focusMap(): Record<string, MatFocus> {
  try {
    return JSON.parse(localStorage.getItem(FOCUS_KEY) ?? "{}") as Record<string, MatFocus>;
  } catch {
    return {};
  }
}
/** The saved focal point and zoom of a mat (its id, or the key resolve() gives for an uploaded picture). */
export function matFocus(key: string): MatFocus {
  if (typeof localStorage === "undefined") return DEFAULT_FOCUS;
  const f = focusMap()[key];
  return f ? clampFocus({ ...DEFAULT_FOCUS, ...f }) : DEFAULT_FOCUS;
}
export function setMatFocus(key: string, fx: MatFocus): void {
  const map = focusMap();
  const next = clampFocus(fx);
  if (next.x === 50 && next.y === 50 && next.zoom === 1) delete map[key];
  else map[key] = next;
  write(FOCUS_KEY, Object.keys(map).length ? JSON.stringify(map) : "");
  focusVersion++;
  focusListeners.forEach((l) => l());
}
/** Re-renders the caller when any mat's focus changes (so every mat on the screen follows). */
export function useMatFocusVersion(): number {
  return useSyncExternalStore(
    (cb) => (focusListeners.add(cb), () => void focusListeners.delete(cb)),
    () => focusVersion,
    () => 0,
  );
}
/** The style of the layer that draws a mat: the zoom is a scale around the focal point (a picture only). */
export function matLayerStyle(css: string, fx: MatFocus): CSSProperties {
  return { background: css, ...(fx.zoom !== 1 ? { transform: `scale(${fx.zoom})`, transformOrigin: `${fx.x}% ${fx.y}%` } : {}) };
}

// The draw animation is plain DOM outside React, so the sleeves are also kept where it can read them.
const live: Record<PlayerId, { css: string; edge: string }> = { p1: { css: SLEEVES[0].css, edge: SLEEVES[0].edge! }, p2: { css: SLEEVES[0].css, edge: SLEEVES[0].edge! } };
export const sleeveOf = (who: PlayerId) => live[who];

/** What THIS player prefers for any match they play online (their seat is only known once they are in a room). */
export const myLook = {
  read: (kind: "sleeve" | "mat") => read(mineKey(kind)),
  write: (kind: "sleeve" | "mat", value: string) => write(mineKey(kind), value),
};

/** A random preset, for dressing the computer's table. */
export function randomLook(): { sleeve: string; mat: string } {
  const pick = (list: Look[]) => `preset:${list[Math.floor(Math.random() * list.length)].id}`;
  return { sleeve: pick(SLEEVES), mat: `preset:${INK_MAT_IDS[Math.floor(Math.random() * INK_MAT_IDS.length)]}` }; // (the computer sits at one of Inkfall's own mats)
}

/** Shrinks a picture to `maxWidth` pixels wide and returns it as a JPEG data URL, so it fits in browser storage. */
function shrink(file: File, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not a picture the browser can open."));
    };
    img.src = url;
  });
}

type Stored = Record<PlayerId, string>;

/**
 * Both players' sleeves and playmats, with ways to change them. Online, `remote` holds what each player chose before the match:
 * those are shown (to everyone, spectators too) and can't be changed during it.
 */
export function useAppearance(remote?: Record<PlayerId, { sleeve: string; mat: string }> | null) {
  useMatFocusVersion(); // (moving a mat in the picker moves it on the board too)
  const [sleeves, setSleeves] = useState<Stored>(() => ({ p1: read(key("sleeve", "p1")), p2: read(key("sleeve", "p2")) }));
  const [mats, setMats] = useState<Stored>(() => ({ p1: read(key("mat", "p1")), p2: read(key("mat", "p2")) }));
  const [error, setError] = useState<string | null>(null);
  const shownSleeves = useMemo<Stored>(() => (remote ? { p1: remote.p1.sleeve, p2: remote.p2.sleeve } : sleeves), [remote, sleeves]);
  const shownMats = useMemo<Stored>(() => (remote ? { p1: remote.p1.mat, p2: remote.p2.mat } : mats), [remote, mats]);

  useEffect(() => {
    for (const who of ["p1", "p2"] as const) {
      const s = resolve("sleeve", shownSleeves[who], who);
      live[who] = { css: s.css, edge: s.edge };
    }
  }, [shownSleeves]);

  const set = useCallback((kind: "sleeve" | "mat", who: PlayerId, value: string) => {
    setError(null);
    (kind === "sleeve" ? setSleeves : setMats)((cur) => ({ ...cur, [who]: value }));
    if (!write(key(kind, who), value)) setError("The browser could not save that (storage is full or blocked).");
  }, []);

  const upload = useCallback(
    async (kind: "sleeve" | "mat", who: PlayerId, file: File) => {
      try {
        set(kind, who, await shrink(file, kind === "sleeve" ? 360 : 1600));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not use that picture.");
      }
    },
    [set],
  );

  return {
    sleeve: (who: PlayerId) => resolve("sleeve", shownSleeves[who], who),
    mat: (who: PlayerId) => resolve("mat", shownMats[who], who),
    storedSleeve: shownSleeves,
    storedMat: shownMats,
    /** Chosen before an online match: can't be changed now. */
    locked: Boolean(remote),
    choose: set,
    upload,
    error,
  };
}
