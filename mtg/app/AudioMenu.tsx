"use client";

import { useEffect, useRef, useState } from "react";
import { MUSIC_EVENT, TRACKS, musicEnabled, musicTrack, musicVolume, playingTrack, setMusicEnabled, setMusicTrack, setMusicVolume } from "@/lib/music";
import { playSound, setSoundEnabled, setSoundVolume, soundEnabled, soundVolume } from "@/lib/sound";
import { Chev, Horn } from "./Icons";

const HINT_KEY = "mtg-music-hint";
const HINT_MS = 9000;

const seenHint = () => {
  try {
    return localStorage.getItem(HINT_KEY) === "seen";
  } catch {
    return true;
  }
};
const markHint = () => {
  try {
    localStorage.setItem(HINT_KEY, "seen");
  } catch {
    // ignore: the hint may show once more
  }
};

const heading = "font-title text-base text-[#e8dcc0]";

function Volume({ label, value, onChange, onDone, disabled }: { label: string; value: number; onChange: (v: number) => void; onDone?: () => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}>
      <span className="w-14 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={onDone}
        onKeyUp={onDone}
        className="min-w-0 flex-1 accent-[#b3392b]"
      />
      <span className="w-10 shrink-0 text-right tabular-nums">{Math.round(value * 100)}%</span>
    </label>
  );
}

/** The music and sound menu in the top bar: which tune plays, and how loud the music and the sound effects are. */
export default function AudioMenu() {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(false);
  const [, setVersion] = useState(0); // re-read the settings when the music starts, stops or changes
  const [volume, setVolume] = useState(musicVolume);
  const [effects, setEffects] = useState(soundEnabled);
  const [effectsVolume, setEffectsVolume] = useState(soundVolume);
  const root = useRef<HTMLDivElement>(null);

  // The first time the music starts, say where to change it.
  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      setVersion((n) => n + 1);
      if (!playingTrack() || seenHint()) return;
      markHint();
      setHint(true);
      hide = setTimeout(() => setHint(false), HINT_MS);
    };
    window.addEventListener(MUSIC_EVENT, onChange);
    return () => {
      window.removeEventListener(MUSIC_EVENT, onChange);
      clearTimeout(hide);
    };
  }, []);

  // the hint goes at the first touch anywhere
  useEffect(() => {
    if (!hint) return;
    const gone = () => setHint(false);
    window.addEventListener("pointerdown", gone, { once: true });
    return () => window.removeEventListener("pointerdown", gone);
  }, [hint]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const on = musicEnabled();
  const track = musicTrack();
  const playing = playingTrack();

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => {
          setOpen(!open);
          setHint(false);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Change the music, or the music and sound volume"
        className="bar-btn flex items-center gap-1.5"
      >
        <Horn width={17} height={17} className="ink-icon" />
        <span className="font-semibold max-[479px]:hidden">{on ? track.name : "Quiet"}</span>
        <Chev width={13} height={13} className="ink-icon rotate-90 max-[479px]:hidden" />
      </button>

      {hint && !open && (
        <div role="status" className="absolute right-0 top-full z-50 mt-2 w-64 max-md:fixed max-md:inset-x-3 max-md:top-[3.4rem] max-md:mt-0 max-md:w-auto paper p-2.5 text-[14px] max-md:py-2">
          <div className="absolute -top-2 right-6 h-3 w-3 rotate-45 border-l-2 border-t-2 border-[#2a1d12] bg-[#e8dcc0]" aria-hidden="true" />
          <p>
            Playing <span className="font-semibold">{track.name}</span>. Tap here to change the tune or the volume.
          </p>
        </div>
      )}

      {open && (
        <div role="dialog" aria-label="Music and sound" className="absolute right-0 top-full z-50 mt-2 flex w-80 flex-col gap-3 max-md:fixed max-md:inset-x-3 max-md:top-[3rem] max-md:mt-0 max-md:max-h-[calc(100dvh-4rem)] max-md:w-auto max-md:overflow-y-auto leather !rounded-xl p-4 text-slate-100">
          <section className="flex flex-col gap-1.5">
            <h2 className={heading}>Music</h2>
            <div role="radiogroup" aria-label="Music" className="flex flex-col gap-1">
              {TRACKS.map((t) => {
                const chosen = on && t.id === track.id;
                return (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={chosen}
                    onClick={() => setMusicTrack(t.id)}
                    className={`rounded-lg border px-2.5 py-1.5 text-left transition ${chosen ? "border-amber-400 bg-amber-400/20" : "border-white/15 bg-white/5 hover:bg-white/10"}`}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      {t.name}
                      {chosen && playing?.id === t.id && <span className="rounded bg-amber-400 px-1.5 text-[10px] font-extrabold uppercase text-black">Playing</span>}
                    </span>
                    <span className="block text-xs text-slate-300">{t.blurb}</span>
                  </button>
                );
              })}
              <button
                role="radio"
                aria-checked={!on}
                onClick={() => setMusicEnabled(false)}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-sm font-semibold transition ${!on ? "border-amber-400 bg-amber-400/20" : "border-white/15 bg-white/5 hover:bg-white/10"}`}
              >
                No music
              </button>
            </div>
            <Volume
              label="Volume"
              value={volume}
              disabled={!on}
              onChange={(v) => {
                setVolume(v);
                setMusicVolume(v);
              }}
            />
          </section>

          <section className="flex flex-col gap-1.5 border-t border-white/15 pt-3">
            <div className="flex items-center justify-between">
              <h2 className={heading}>Sound effects</h2>
              <button
                onClick={() => {
                  setSoundEnabled(!effects);
                  setEffects(!effects);
                  if (!effects) playSound("draw");
                }}
                aria-pressed={effects}
                className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-sm transition hover:bg-white/20"
              >
                <span className={effects ? "font-semibold text-[#8fc4a5]" : "font-semibold text-slate-400"}>{effects ? "On" : "Off"}</span>
              </button>
            </div>
            <Volume
              label="Volume"
              value={effectsVolume}
              disabled={!effects}
              onChange={(v) => {
                setEffectsVolume(v);
                setSoundVolume(v);
              }}
              onDone={() => playSound("hit")}
            />
          </section>
        </div>
      )}
    </div>
  );
}
