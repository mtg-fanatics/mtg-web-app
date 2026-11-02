"use client";
import { Pair } from "../Icons";

/** A phone has no room for the friends list on the page: this button (beside the bell) opens it as a pop-up. */
export default function FriendsButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("mtg-open-friends"))}
      aria-label="Open your friends"
      title="Friends"
      className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-slate-950/55 text-white shadow-xl shadow-black/40 ring-1 ring-inset ring-white/10 transition hover:bg-slate-900/70 md:hidden"
    >
      <Pair width={28} height={28} />
    </button>
  );
}
