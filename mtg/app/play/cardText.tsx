"use client";

import { countFor, toughnessOf } from "@mtg/engine";
import type { CardDef, Effect, GameState, PlayerId, StackItem, TargetChoice } from "@mtg/engine";
import { helpFor } from "./glossary";
import { playerName } from "./players";
import { isCreatureNow, nameWithStats } from "./stats";

/** A short plain-English explanation of what some rules text does (see glossary.ts). */
export function Help({ text, max = 3, large }: { text: string; max?: number; large?: boolean }) {
  const lines = helpFor(text, max);
  if (lines.length === 0) return null;
  return (
    <span className={large ? "mt-1.5 block text-[15px] font-normal leading-relaxed text-zinc-700" : "mt-1 block text-xs font-normal leading-snug text-zinc-500"}>
      {lines.map((l, i) => (
        <span key={`${i}-${l}`} className="block">
          ⓘ {l}
        </span>
      ))}
    </span>
  );
}

/** Name of something a spell or ability can point at. */
export const targetKey = (t: TargetChoice) => (t.kind === "player" || t.kind === "stack" ? `${t.kind}:${t.id}` : t.kind === "none" ? "none" : `${t.kind}:${t.iid}`);

export function targetName(state: GameState, t: TargetChoice): string {
  if (t.kind === "none") return "No target (skip)";
  if (t.kind === "player") return playerName(t.id);
  if (t.kind === "stack") {
    const item = state.stack.find((i) => i.id === t.id);
    return item ? `${itemName(state, item)} (on the stack)` : "a spell";
  }
  for (const p of Object.values(state.players)) {
    const perm = p.battlefield.find((x) => x.card.iid === t.iid);
    if (perm) return `${nameWithStats(state, perm)} (${playerName(p.id)})`;
    const dead = p.graveyard.find((x) => x.iid === t.iid);
    if (dead) return `${state.cards[dead.defId].name} (in ${playerName(p.id)}'s graveyard)`;
  }
  return t.iid;
}

export function itemName(state: GameState, item: StackItem): string {
  return item.kind === "spell" ? state.cards[item.card.defId].name : `${item.sourceName} ability`;
}

const SELF = /\bthis (?:creature|artifact|token|enchantment|land|vehicle|permanent|card)\b/gi;

/** The card's own wording of a line the engine reads in lower case, so it keeps its capitals ("Blood tokens", "-X/-X", "Activate only as a sorcery"). */
export function printedLine(text: string, def: CardDef | undefined): string {
  if (!def?.text) return text;
  const self = (s: string) => s.replace(SELF, "~").split(def.name).join("~");
  const plain = (s: string) => self(s).replace(/\.$/, "").toLowerCase();
  const line = def.text
    .split("\n")
    .map((l) => l.replace(/\s*\([^)]*\)/g, "").trim())
    .find((l) => plain(l) === plain(text));
  return line ? self(line).replace(/\.$/, "") : text;
}

/** A card by its name: for an ability whose source is gone (a sacrificed Blood token). */
export const defNamed = (state: GameState, name: string): CardDef | undefined => Object.values(state.cards).find((d) => d.name === name);

/** The card a permanent, or a card in a hand or graveyard, is, and who has it. */
export function cardAt(state: GameState, iid: string): { def: CardDef; player: PlayerId } | null {
  for (const p of Object.values(state.players)) {
    const card = [...p.battlefield.map((x) => x.card), ...p.hand, ...p.graveyard].find((c) => c.iid === iid);
    if (card) return { def: state.cards[card.defId], player: p.id };
  }
  return null;
}

/** A pump "for each" of something, worked out as things stand: "Right now: -2/-2 (Blood ×1)", or "...: it would do nothing" with none. */
export function pumpNow(state: GameState, controller: PlayerId, effects: Effect[]): string | null {
  const pump = effects.find((e) => e.type === "pump" && e.per !== undefined);
  if (pump?.type !== "pump" || !pump.per) return null;
  const n = countFor(state, controller, pump.per);
  const signed = (each: number) => `${each < 0 ? "-" : "+"}${Math.abs(each * n)}`;
  const per = pump.per;
  const what = per.kind !== "permanents" ? null : per.what === "subtype" ? per.subtype : per.what === "landType" ? per.landType : per.what;
  return `Right now: ${signed(pump.power)}/${signed(pump.toughness)}${what ? ` (${what.charAt(0).toUpperCase()}${what.slice(1)} ×${n})` : ""}${n === 0 ? ": it would do nothing" : ""}`;
}

/** Witch's Oven ("if the sacrificed creature's toughness was 4 or greater, create two Food tokens instead"): what sacrificing a creature this tough makes. */
export function madeFor(effects: Effect[], toughness: number): string | null {
  const branch = effects.find((e) => e.type === "ifSacrificedToughness");
  if (branch?.type !== "ifSacrificedToughness") return null;
  const made = (toughness >= branch.atLeast ? branch.then : branch.otherwise).flatMap((e) => (e.type === "createToken" && typeof e.amount === "number" ? [`${e.amount} ${e.token.name}`] : []));
  return made.length > 0 ? made.join(" and ") : null;
}

/** A card or permanent that could pay a cost, told apart from the others: "Hill Giant 3/3 → 1 Food", "Food (tapped)". */
export function payWithLabel(state: GameState, iid: string, effects: Effect[]): string {
  const perm = Object.values(state.players).flatMap((p) => p.battlefield).find((p) => p.card.iid === iid);
  if (!perm) return cardAt(state, iid)?.def.name ?? "a card";
  const made = isCreatureNow(state, perm) ? madeFor(effects, toughnessOf(state, perm)) : null;
  return `${nameWithStats(state, perm)}${perm.tapped ? " (tapped)" : ""}${made ? ` → ${made}` : ""}`;
}

/** What a spell does only when its optional extra cost (waterbend, kicker) was paid: "Whenever a creature dies this turn, you gain 1 life." */
export function paidPart(text: string): string | null {
  const m = /if this spell's additional cost was paid, ([^.]+\.)/i.exec(text);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : null;
}

/** Artifact token types the engine reads in lower case, named as the cards do: "a Food", "Treasure tokens". */
export const tokenNames = (text: string) => text.replace(/\b(food|treasure|blood|clue)(s?)\b/g, (_, t: string, s: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}${s}`);

/** Rules text as the engine reads it ("~", lowercase) made readable: the card's name back in, first letter capital. */
export function readable(text: string, cardName: string): string {
  const t = tokenNames(text.replace(/(gain "you may cast )~/gi, "$1this card").replace(/~/g, cardName).replace(/\{([a-z0-9]+)\}/g, (_, x: string) => `{${x.toUpperCase()}}`));
  return t.charAt(0).toUpperCase() + t.slice(1);
}
