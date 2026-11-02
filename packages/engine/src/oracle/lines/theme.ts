import type { ParsedCard } from "../../effects.js";

// Lines of the older theme decks.

/** Urza's Armor: "If a source would deal damage to you, prevent 1 of that damage." */
export function readReduceDamage(line: string, out: ParsedCard): boolean {
  const m = /^if a source would deal damage to you, prevent (\d+) of that damage$/.exec(line);
  if (!m) return false;
  out.reduceDamageToYou = Number(m[1]);
  return true;
}

/** Spirit Link: "Whenever enchanted creature deals damage, you gain that much life." */
export function readHostDamageLife(line: string, out: ParsedCard): boolean {
  if (line !== "whenever enchanted creature deals damage, you gain that much life") return false;
  out.hostDamageLife = true;
  return true;
}

/** Mind Control / Confiscate: "You control enchanted creature." / "You control enchanted permanent." */
export function readHostControl(line: string, out: ParsedCard): boolean {
  if (line !== "you control enchanted creature" && line !== "you control enchanted permanent") return false;
  out.hostControl = true;
  return true;
}

/** Goblin King: "Other Goblins get +1/+1 and have mountainwalk." (every other Goblin, whoever controls it) */
export function readGoblinKing(line: string, out: ParsedCard): boolean {
  const m = /^other ([a-z]+)s get \+(\d+)\/\+(\d+) and have (plains|island|swamp|mountain|forest)walk$/.exec(line);
  if (!m) return false;
  (out.statics ??= []).push({ scope: "all", other: true, subtypes: [m[1]], power: Number(m[2]), toughness: Number(m[3]), keywords: [], landwalk: [m[4]] });
  return true;
}

/** Guerrilla Tactics: "When a spell or ability an opponent controls causes you to discard ~, it deals 4 damage to any target." */
export function readDiscardedByOpponent(line: string, out: ParsedCard): boolean {
  const m = /^when a spell or ability an opponent controls causes you to discard ~, it deals (\d+) damage to any target$/.exec(line);
  if (!m) return false;
  out.triggers.push({ event: "discardedByOpp", effects: [{ type: "damage", amount: Number(m[1]), to: { t: "target", i: 0 } }], targets: [{ kind: "any", label: "any target" }], text: line });
  return true;
}
