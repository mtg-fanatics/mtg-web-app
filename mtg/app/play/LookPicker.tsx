"use client";

import type { PlayerId } from "@mtg/engine";
import { MATS, resolve, SLEEVES, useMatFocusVersion } from "@/lib/playmat";
import { SleeveBack } from "./AppearanceDialog";
import MatPreview from "./MatPreview";

/**
 * Choose the card sleeve and the playmat for one player, with a preview of the table. `sleeve` and `mat` are the stored
 * choices ("preset:<id>", or empty for the player's default); `who` only decides which default mat is shown.
 * `large`: bigger pictures, for a pop-up with room (the deck step of a room).
 */
export default function LookPicker({
  who,
  sleeve,
  mat,
  onSleeve,
  onMat,
  disabled = false,
  large = false,
}: {
  who: PlayerId;
  sleeve: string;
  mat: string;
  onSleeve: (value: string) => void;
  onMat: (value: string) => void;
  disabled?: boolean;
  large?: boolean;
}) {
  useMatFocusVersion(); // (moving the mat redraws the preview)
  const s = resolve("sleeve", sleeve, who);
  const m = resolve("mat", mat, who);
  const ring = (on: boolean) => (on ? "border-[#fcd34d] ring-2 ring-[#fcd34d]" : "border-white/25 hover:border-white/70");
  const cardH = large ? 88 : 68;
  const cardW = large ? 62 : 48;

  return (
    <div className={`flex flex-col text-left ${large ? "gap-3" : "gap-2.5"}`}>
      {/* the table as it will look: the mat, with a stack of sleeved cards */}
      <MatPreview css={m.css} fx={m.fx} focusKey={m.focusKey} movable={m.movable} disabled={disabled} className={large ? "h-36" : "h-24"}>
        <div className="absolute inset-0 bg-black/15 pointer-events-none" />
        <div className="absolute inset-x-3 bottom-2 top-2 rounded-lg border border-dashed border-white/30" />
        <div className="absolute right-6 top-1/2 -translate-y-1/2" style={{ height: cardH, width: cardW }}>
          {[3, 2, 1, 0].map((i) => (
            <div key={i} className="absolute" style={{ left: (3 - i) * 2, top: -(3 - i) * 2 }}>
              <SleeveBack css={s.css} edge={s.edge} style={{ height: cardH, width: cardW }} />
            </div>
          ))}
        </div>
      </MatPreview>

      <div>
        <span className={`field-label ${large ? "!text-sm" : ""}`}>Card sleeve</span>
        <div className={`mt-1.5 flex flex-wrap overflow-y-auto pr-1 ${large ? "gap-2.5" : "max-h-[7.2rem] gap-1.5"}`}>
          {SLEEVES.map((x) => (
            <button key={x.id} type="button" disabled={disabled} onClick={() => onSleeve(`preset:${x.id}`)} title={x.name} aria-label={`Sleeve: ${x.name}`} aria-pressed={s.id === x.id} className="transition hover:-translate-y-0.5 disabled:opacity-50">
              <SleeveBack css={x.css} edge={x.edge ?? "#fff"} className={`border-2 ${ring(s.id === x.id)} ${large ? "h-[62px] w-[45px]" : "h-[46px] w-[33px]"}`} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className={`field-label ${large ? "!text-sm" : ""}`}>Playmat</span>
        <div className={`mt-1.5 flex flex-wrap overflow-y-auto pr-1 ${large ? "gap-2.5" : "max-h-[7.2rem] gap-1.5"}`}>
          {MATS.map((x) => (
            <button key={x.id} type="button" disabled={disabled} onClick={() => onMat(`preset:${x.id}`)} title={x.name} aria-label={`Playmat: ${x.name}`} aria-pressed={m.id === x.id} className="transition hover:-translate-y-0.5 disabled:opacity-50">
              <span className={`block rounded-md border-2 ${ring(m.id === x.id)} ${large ? "h-[44px] w-[68px]" : "h-[34px] w-[52px]"}`} style={{ background: x.css }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
