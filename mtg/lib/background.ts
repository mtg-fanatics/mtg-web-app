"use client";

import { useCallback, useState } from "react";

// The picture behind the battlefield. Three ways to get one:
//   1. Nothing chosen: the game looks for the file  mtg/public/backgrounds/battlefield.jpg  (and shows none if it is missing).
//   2. A picture chosen from the computer in the game (kept in this browser only; it is shrunk to fit).
//   3. One of the built-in looks below.

const KEY = "mtg-bg";
const DIM_KEY = "mtg-bg-dim";
export const DEFAULT_IMAGE = "/backgrounds/battlefield.jpg";

export interface Preset {
  id: string;
  name: string;
  /** A CSS background-image value. */
  css: string;
}

export const PRESETS: Preset[] = [
  { id: "forest", name: "Forest", css: "radial-gradient(ellipse at 20% 10%, #4d7c0f 0%, #14532d 45%, #052e16 100%)" },
  { id: "dusk", name: "Dusk", css: "linear-gradient(180deg, #312e81 0%, #7c3aed 45%, #f59e0b 100%)" },
  { id: "ocean", name: "Ocean", css: "radial-gradient(ellipse at 80% 0%, #0ea5e9 0%, #1d4ed8 50%, #172554 100%)" },
  { id: "ember", name: "Ember", css: "radial-gradient(ellipse at 50% 100%, #f97316 0%, #b91c1c 45%, #450a0a 100%)" },
  { id: "parchment", name: "Parchment", css: "linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #d6b370 100%)" },
  { id: "slate", name: "Slate", css: "linear-gradient(160deg, #475569 0%, #1e293b 100%)" },
];

/** What is stored: "preset:<id>", or a data: URL for a picture from the computer. Empty = the default file. */
function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string): boolean {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false; // storage full or blocked
  }
}

/** The CSS value for the stored choice. */
export function backgroundCss(stored: string): string {
  if (stored.startsWith("preset:")) return PRESETS.find((p) => p.id === stored.slice(7))?.css ?? "var(--fibres)";
  if (stored.startsWith("data:")) return `url("${stored}")`;
  return "var(--fibres)"; // Inkfall: a worn paper cloth, until licensed art is chosen (a preset, a picture from this computer, or your own CSS here)
}

/** Shrinks a picture to at most 1920 pixels wide and returns it as a JPEG data URL, so it fits in browser storage. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1920 / img.width);
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

/** The chosen battlefield picture and how much it is washed out (0 = full picture, 0.8 = very faint). */
export function useBattlefieldBackground() {
  // Read when the game screen is first created (the picture is only drawn once a game has started, so nothing differs on the server).
  const [stored, setStored] = useState(() => read(KEY));
  const [dim, setDimState] = useState(() => {
    const saved = read(DIM_KEY);
    const d = Number(saved);
    return saved !== "" && Number.isFinite(d) ? Math.min(0.85, Math.max(0, d)) : 0.45;
  });
  const [error, setError] = useState<string | null>(null);

  const choose = useCallback((value: string) => {
    setError(null);
    setStored(value);
    if (!write(KEY, value)) setError("The browser could not save that background (storage is full or blocked).");
  }, []);

  const upload = useCallback(
    async (file: File) => {
      try {
        choose(await shrink(file));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not use that picture.");
      }
    },
    [choose],
  );

  const setDim = useCallback((value: number) => {
    setDimState(value);
    write(DIM_KEY, String(value));
  }, []);

  return { stored, css: backgroundCss(stored), dim, setDim, choose, upload, error, usingFile: stored.startsWith("data:"), usingPreset: stored.startsWith("preset:") ? stored.slice(7) : null };
}
