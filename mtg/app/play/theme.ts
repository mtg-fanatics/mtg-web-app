// One look for the whole play screen. Every color means something, so a player can read the board at a glance:
//   blue = Player 1, rose = Player 2        green = what you can do / your hand      violet = the stack and effects
//   red = attack and damage                 sky = blocking                           amber = the main action, warnings
//   Full class names are written out (not built from pieces) so Tailwind can find them.
import type { PlayerId } from "@mtg/engine";

export const PLAYER_STYLE: Record<PlayerId, { chip: string; border: string; borderL: string; soft: string; text: string; gradient: string; bar: string; glow: string }> = {
  p1: {
    chip: "bg-sky-100 text-sky-800 ring-1 ring-sky-300",
    border: "border-sky-300",
    borderL: "border-l-sky-500",
    soft: "bg-sky-50/70",
    text: "text-sky-700",
    gradient: "from-sky-400 to-blue-600",
    bar: "bg-sky-500",
    glow: "shadow-sky-300/60",
  },
  p2: {
    chip: "bg-rose-100 text-rose-800 ring-1 ring-rose-300",
    border: "border-rose-300",
    borderL: "border-l-rose-500",
    soft: "bg-rose-50/70",
    text: "text-rose-700",
    gradient: "from-rose-400 to-red-600",
    bar: "bg-rose-500",
    glow: "shadow-rose-300/60",
  },
};

export type BannerMode = "main" | "attack" | "block" | "damage" | "stack" | "choice" | "mulligan" | "cleanup";

/** The colored "what to do now" strip. */
export const BANNER: Record<BannerMode, { box: string; icon: "leaf" | "swords" | "shield" | "burst" | "hourglass" | "quill" | "fan" | "binned"; label: string }> = {
  main: { box: "border-emerald-300 bg-emerald-50 text-emerald-900", icon: "leaf", label: "Your main phase" },
  attack: { box: "border-red-300 bg-red-50 text-red-900", icon: "swords", label: "Attack" },
  block: { box: "border-sky-300 bg-sky-50 text-sky-900", icon: "shield", label: "Block" },
  damage: { box: "border-orange-300 bg-orange-50 text-orange-900", icon: "burst", label: "Damage" },
  stack: { box: "border-violet-300 bg-violet-50 text-violet-900", icon: "hourglass", label: "Respond" },
  choice: { box: "border-rose-300 bg-rose-50 text-rose-900", icon: "quill", label: "Make a choice" },
  mulligan: { box: "border-indigo-300 bg-indigo-50 text-indigo-900", icon: "fan", label: "Opening hand" },
  cleanup: { box: "border-slate-300 bg-slate-50 text-slate-900", icon: "binned", label: "End of turn" },
};

/** Colors for the life bar: green while healthy, amber when low, red when close to losing. */
export const lifeColor = (life: number) => (life <= 5 ? "bg-red-500" : life <= 10 ? "bg-amber-500" : "bg-emerald-500");
