"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import { matLayerStyle, setMatFocus } from "@/lib/playmat";
import type { MatFocus } from "@/lib/playmat";

/**
 * A mat as it will look on the board, for the pickers. A picture mat can be moved (drag it) and zoomed (1x to 2x); the choice is kept
 * for that mat in this browser. `children` sit over the mat (the stack of sleeved cards, the name).
 */
export default function MatPreview({
  css,
  fx,
  focusKey,
  movable,
  disabled = false,
  className = "",
  children,
}: {
  css: string;
  fx: MatFocus;
  focusKey: string;
  movable: boolean;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; start: MatFocus } | null>(null);
  const can = movable && !disabled;
  const slider = `mat-zoom-${focusKey.replace(/\W+/g, "").slice(0, 16)}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={box}
        className={`relative overflow-hidden rounded-xl border border-white/25 shadow-inner ${can ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${className}`}
        onPointerDown={(e) => {
          if (!can) return;
          drag.current = { x: e.clientX, y: e.clientY, start: fx };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const r = box.current?.getBoundingClientRect();
          if (!d || !r) return;
          // dragging the picture right shows more of its left side: the focal point moves the other way
          const k = 100 / Math.max(1, d.start.zoom);
          setMatFocus(focusKey, { ...d.start, x: d.start.x - ((e.clientX - d.x) / r.width) * k, y: d.start.y - ((e.clientY - d.y) / r.height) * k });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        aria-label={can ? "Your mat: drag to move the picture" : "Preview of your table"}
      >
        <div className="absolute inset-0" style={matLayerStyle(css, fx)} />
        {children}
      </div>
      {movable && (
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span id={`${slider}-l`} className="shrink-0">Reposition mat</span>
          <input
            type="range"
            min={1}
            max={2}
            step={0.05}
            value={fx.zoom}
            disabled={disabled}
            aria-labelledby={`${slider}-l`}
            title="Zoom the picture, then drag it to choose what stays in view"
            onChange={(e) => setMatFocus(focusKey, { ...fx, zoom: Number(e.target.value) })}
            className="min-w-0 flex-1 accent-[#b3392b]"
          />
          <button type="button" disabled={disabled || (fx.x === 50 && fx.y === 50 && fx.zoom === 1)} onClick={() => setMatFocus(focusKey, { x: 50, y: 50, zoom: 1 })} className="underline disabled:opacity-40">
            Centre
          </button>
        </div>
      )}
    </div>
  );
}
