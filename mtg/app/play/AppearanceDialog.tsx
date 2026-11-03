"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerId } from "@mtg/engine";
import { MATS, SLEEVES } from "@/lib/playmat";
import type { useAppearance } from "@/lib/playmat";
import { playerName } from "./log";
import MatPreview from "./MatPreview";
import Swatch from "./Swatch";

type Appearance = ReturnType<typeof useAppearance>;

/** A card back drawn with the given sleeve. */
export function SleeveBack({ css, edge, className = "", style }: { css: string; edge: string; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`relative overflow-hidden rounded-[5px] border border-black/70 shadow ${className}`} style={{ background: css, ...style }}>
      <div className="absolute inset-[3px] rounded-[3px] border" style={{ borderColor: edge }} />
    </div>
  );
}

/** Pick the card sleeves and the playmat for each player. */
export default function AppearanceDialog({ look, cursor, onClose, first = "p1" }: { look: Appearance; cursor?: { on: boolean; set: (on: boolean) => void }; onClose: () => void; first?: PlayerId }) {
  const [who, setWho] = useState<PlayerId>(first);
  const sleeveFile = useRef<HTMLInputElement>(null);
  const matFile = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sleeve = look.sleeve(who);
  const mat = look.mat(who);
  const storedSleeve = look.storedSleeve[who];
  const storedMat = look.storedMat[who];
  const ring = (on: boolean) => (on ? "border-[#d9694f] ring-2 ring-[#d9694f]" : "border-white/30 hover:border-white/70");

  return (
    <div role="dialog" aria-modal="true" aria-label="Sleeves and playmat" onClick={onClose} className="game-modal fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-2xl border border-white/25 bg-slate-950/80 p-5 text-white shadow-2xl ring-1 ring-inset ring-white/10 backdrop-blur-xl"
      >
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl font-bold tracking-wide">Sleeves &amp; playmat</h2>
          <div className="ml-4 flex gap-1 rounded-xl bg-white/10 p-1">
            {(["p1", "p2"] as const).map((p) => (
              <button key={p} onClick={() => setWho(p)} className={`rounded-lg px-4 py-1 text-sm font-semibold transition ${who === p ? "bg-amber-400 text-black" : "text-slate-200 hover:bg-white/15"}`}>
                {playerName(p)}
              </button>
            ))}
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-lg border border-white/30 bg-white/10 px-3 py-1 text-lg leading-none hover:bg-white/20">
            ×
          </button>
        </div>

        {look.locked ? (
          <p className="rounded-xl border border-white/20 bg-white/5 p-3 text-sm text-slate-300">Sleeves and playmats were chosen before the match: both players see the same table. They can&apos;t be changed during an online match.</p>
        ) : (
          <>
        {/* Preview: the mat with a stack of sleeved cards */}
        <MatPreview css={mat.css} fx={mat.fx} focusKey={mat.focusKey} movable={mat.movable} disabled={look.locked} className="h-36">
          <div className="absolute inset-0 bg-black/10 pointer-events-none" />
          <div className="absolute inset-x-4 bottom-3 top-3 rounded-lg border border-dashed border-white/30" />
          <div className="absolute right-6 top-1/2 flex -translate-y-1/2 gap-3">
            <div className="relative h-24 w-[68px]">
              {[3, 2, 1, 0].map((i) => (
                <div key={i} className="absolute" style={{ left: (3 - i) * 1.5, top: -(3 - i) * 1.5 }}>
                  <SleeveBack css={sleeve.css} edge={sleeve.edge} className="h-24 w-[68px]" />
                </div>
              ))}
            </div>
          </div>
          <span className="absolute left-6 top-1/2 -translate-y-1/2 font-display text-lg font-bold tracking-widest text-white/80 drop-shadow">{playerName(who).toUpperCase()}</span>
        </MatPreview>

        <section>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="font-display text-sm font-bold uppercase tracking-widest text-slate-300">Card sleeves</h3>
            <button onClick={() => sleeveFile.current?.click()} className="rounded-lg bg-amber-400 px-3 py-1 text-xs font-bold text-black hover:bg-[#d9694f]">
              Use my own picture…
            </button>
            <input ref={sleeveFile} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void look.upload("sleeve", who, f); e.target.value = ""; }} />
            {storedSleeve && (
              <button onClick={() => look.choose("sleeve", who, "")} className="text-xs text-slate-300 underline hover:text-white">
                back to default
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-3 p-1">
            {SLEEVES.map((s) => (
              <button key={s.id} onClick={() => look.choose("sleeve", who, `preset:${s.id}`)} title={s.name} className="group flex flex-col items-center gap-1">
                <Swatch on={sleeve.id === s.id} raw={s.css.includes("url(")} className="transition group-hover:-translate-y-0.5">
                  <SleeveBack css={s.css} edge={s.edge ?? "#fff"} className="h-[84px] w-[60px]" />
                </Swatch>
                <span className="text-[10px] text-slate-300">{s.name}</span>
              </button>
            ))}
            {storedSleeve.startsWith("data:") && (
              <div className="flex flex-col items-center gap-1">
                <SleeveBack css={sleeve.css} edge={sleeve.edge} className="h-[84px] w-[60px] border-2 border-[#d9694f] ring-2 ring-[#d9694f]" />
                <span className="text-[10px] text-slate-300">Your picture</span>
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Shown on each player&apos;s library and when they draw a card. Tall pictures (5:7, like a card) fit best.</p>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="font-display text-sm font-bold uppercase tracking-widest text-slate-300">Playmat</h3>
            <button onClick={() => matFile.current?.click()} className="rounded-lg bg-amber-400 px-3 py-1 text-xs font-bold text-black hover:bg-[#d9694f]">
              Use my own picture…
            </button>
            <input ref={matFile} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void look.upload("mat", who, f); e.target.value = ""; }} />
            {storedMat && (
              <button onClick={() => look.choose("mat", who, "")} className="text-xs text-slate-300 underline hover:text-white">
                back to default
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 p-1 sm:grid-cols-5">
            {MATS.map((m) => (
              <button key={m.id} onClick={() => look.choose("mat", who, `preset:${m.id}`)} title={m.name} className="group flex flex-col items-center gap-1">
                <Swatch on={mat.id === m.id} raw={m.css.includes("url(")} className="w-full transition group-hover:-translate-y-0.5">
                  <span className="block h-14 w-full" style={{ background: m.css }} />
                </Swatch>
                <span className="text-[10px] text-slate-300">{m.name}</span>
              </button>
            ))}
            {storedMat.startsWith("data:") && (
              <div className="flex flex-col items-center gap-1">
                <span className="h-14 w-full rounded-lg border-2 border-[#d9694f] ring-2 ring-[#d9694f]" style={{ background: mat.css }} />
                <span className="text-[10px] text-slate-300">Your picture</span>
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">The surface under this player&apos;s creatures and lands. Wide pictures work best. Saved in this browser only.</p>
        </section>

          </>
        )}

        {cursor && (
          <section className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/5 p-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-sm font-bold uppercase tracking-widest text-slate-300">Mouse cursor</h3>
              <p className="text-[11px] text-slate-400">A gilded Magic arrow on the play screen, lit up with the five mana colors over anything you can click.</p>
            </div>
            <button
              onClick={() => cursor.set(!cursor.on)}
              aria-pressed={cursor.on}
              className={`rounded-lg border px-4 py-1.5 text-sm font-semibold transition ${cursor.on ? "border-amber-300 bg-amber-400 text-black" : "border-white/30 bg-white/10 text-white hover:bg-white/20"}`}
            >
              {cursor.on ? "On" : "Off"}
            </button>
          </section>
        )}

        {look.error && <p className="text-sm text-[#fca5a5]">{look.error}</p>}
      </div>
    </div>
  );
}
