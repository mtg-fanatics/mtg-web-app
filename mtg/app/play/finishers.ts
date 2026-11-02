// The finishing moves a player can pick from, and the one that is picked. The pick is kept on this computer (it is the move this player sees when they win).
import type { PlayerId } from "@mtg/engine";
import { primeFinisherAudio } from "@/lib/sound";
import { playFinisher, warmFinisher } from "./finisher";
import { playFx, warmFx } from "./finisherFx";

export type FinisherId = "reaper" | "judgment" | "void" | "meteor" | "zero" | "random";

export const FINISHERS: { id: FinisherId; name: string; blurb: string }[] = [
  { id: "reaper", name: "Grim Reaper", blurb: "The Reaper's scythe tears the mat open in purple fire." },
  { id: "judgment", name: "Heaven's Judgment", blurb: "The sky goes dark and a giant bolt of lightning crashes down." },
  { id: "void", name: "Void Collapse", blurb: "A black hole swallows the cards, then detonates." },
  { id: "meteor", name: "Meteor Strike", blurb: "A burning meteor hits the mat and leaves a glowing crater." },
  { id: "zero", name: "Absolute Zero", blurb: "Frost freezes the mat, then it shatters like glass." },
  { id: "random", name: "Random", blurb: "A different finishing move each time." },
];

const KEY = "mtg-finisher";
let lastRandom: Exclude<FinisherId, "random"> = "reaper";

export function getFinisher(): FinisherId {
  try {
    const v = localStorage.getItem(KEY);
    return FINISHERS.some((f) => f.id === v) ? (v as FinisherId) : "reaper";
  } catch {
    return "reaper";
  }
}

export function setFinisher(id: FinisherId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // the pick just won't be remembered
  }
}

/** Gets the chosen finisher ready (pictures, shaders, sounds) in idle moments. */
export function warmFinishers(id: FinisherId = getFinisher()): void {
  if (id === "reaper" || id === "random") warmFinisher();
  window.setTimeout(() => warmFx(), 500); // (the textures: the Reaper's flames and scar use them too)
  window.setTimeout(() => primeFinisherAudio(), 1500);
}

/** Plays a finisher between two mats (null, null: the preview, which has no mats). Resolves when the result may come up. */
export function playChosenFinisher(winner: PlayerId | null, loser: PlayerId | null, id: FinisherId = getFinisher()): Promise<void> {
  let pick: Exclude<FinisherId, "random"> = id === "random" ? lastRandom : id;
  if (id === "random") {
    const options = FINISHERS.filter((f) => f.id !== "random" && f.id !== lastRandom);
    pick = options[Math.floor(Math.random() * options.length)].id as Exclude<FinisherId, "random">;
    lastRandom = pick; // (never the same one twice in a row)
  }
  return pick === "reaper" ? playFinisher(winner, loser) : playFx(pick, loser);
}
