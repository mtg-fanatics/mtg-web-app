"use client";

import type { ReactNode } from "react";
import { useAnimationsOn } from "@/lib/motion";
import "./ledger.css";

/**
 * A built-in sleeve or playmat shown as a chip in a picker: the colours are muted like aged dye on cloth, with a little grain over them,
 * and the one in use is circled with a loose ink ring that is drawn in when it is chosen. (Your own pictures and card-art mats are not put through this.)
 */
export default function Swatch({ on, raw = false, children, className = "" }: { on: boolean; /** a picture (card art): shown exactly as it is, only circled when chosen */ raw?: boolean; children: ReactNode; className?: string }) {
  const draw = useAnimationsOn();
  return (
    <span className={`swatch relative inline-block align-top ${raw ? "swatch-raw" : ""} ${className}`} data-on={on ? "yes" : "no"}>
      <span className="swatch-art block">{children}</span>
      <svg className="swatch-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-draw={draw ? "on" : "off"}>
        <path pathLength={1} d="M7 5c22-3 63-4 87-1 3 24 4 57 0 91-25 3-64 4-88 0-3-31-3-60 1-90z" />
      </svg>
    </span>
  );
}
