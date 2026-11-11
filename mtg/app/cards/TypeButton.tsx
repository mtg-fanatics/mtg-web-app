"use client";

import type { CardType } from "@mtg/engine";
import Tip from "../play/Tip";

// Icon names in the mana-font icon font. "multiple" is its "any type" icon.
const ICON: Record<"all" | CardType, string> = {
  all: "multiple",
  creature: "creature",
  land: "land",
  instant: "instant",
  sorcery: "sorcery",
  enchantment: "enchantment",
  artifact: "artifact",
  planeswalker: "planeswalker",
  battle: "battle",
  other: "multiple",
};

/** A card-type filter shown as just its icon. The name appears when you hover over it. */
export default function TypeButton({ type, active, onClick, glass = false }: { type: "all" | CardType; active: boolean; onClick: () => void; glass?: boolean }) {
  const label = type === "all" ? "All types" : type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <Tip text={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={
          glass
            ? undefined // styled by the surrounding .icon-seg
            : `flex h-9 w-9 max-md:h-11 max-md:w-11 items-center justify-center rounded text-xl ${active ? "bg-amber-500 text-black" : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"}`
        }
      >
        <i className={`ms ms-${ICON[type]}`} aria-hidden="true" />
      </button>
    </Tip>
  );
}
