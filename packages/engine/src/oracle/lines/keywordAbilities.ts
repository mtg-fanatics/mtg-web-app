import type { Effect, ParsedCard } from "../../effects.js";
import { newCtx } from "../targets.js";
import { parseEffectText } from "../effectText.js";

// Keywords that are a triggered ability in disguise: bushido, renown, extort, heroic (and bloodthirst and affinity, which change how a card enters or is cast).

/** A trigger whose effect is read from text, about the permanent itself. */
function trigger(out: ParsedCard, line: string, event: ParsedCard["triggers"][number]["event"], body: string, extra: Partial<ParsedCard["triggers"][number]> = {}): true {
  const ctx = newCtx(true);
  const effects = parseEffectText(body, ctx);
  if (effects && effects.length > 0) out.triggers.push({ event, effects, targets: ctx.targets, text: line, ...extra });
  else out.unsupported.push(line);
  return true;
}

/** "Bushido 2": whenever it blocks or becomes blocked, it gets +2/+2 until end of turn. */
export function readBushido(line: string, out: ParsedCard): boolean {
  const m = /^bushido (\d+)$/.exec(line);
  if (!m) return false;
  const body = `~ gets +${m[1]}/+${m[1]} until end of turn`;
  const text = `Bushido ${m[1]}: whenever this creature blocks or becomes blocked, it gets +${m[1]}/+${m[1]} until end of turn.`;
  trigger(out, text, "blocks", body);
  trigger(out, text, "blocked", body);
  return true;
}

/** "Renown 2": when it deals combat damage to a player, if it isn't renowned, put two +1/+1 counters on it and it becomes renowned. */
export function readRenown(line: string, out: ParsedCard): boolean {
  const m = /^renown (\d+)$/.exec(line);
  if (!m) return false;
  const effects: Effect[] = [{ type: "renown", n: Number(m[1]) }];
  out.triggers.push({ event: "combatDamagePlayer", effects, targets: [], text: `Renown ${m[1]}: when this creature deals combat damage to a player, if it isn't renowned, put ${m[1]} +1/+1 counter${m[1] === "1" ? "" : "s"} on it and it becomes renowned.` });
  return true;
}

/** "Extort": whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life. */
export function readExtort(line: string, out: ParsedCard): boolean {
  if (line !== "extort") return false;
  return trigger(out, "Extort: whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.", "youCast", "you may pay {W/B}. if you do, each opponent loses 1 life and you gain 1 life");
}

/** "Heroic — Whenever you cast a spell that targets ~, ...". */
export function readHeroic(line: string, out: ParsedCard): boolean {
  const m = /^whenever you cast a spell that targets ~,? (.+)$/.exec(line);
  if (!m) return false;
  return trigger(out, line, "youCast", m[1].replace(/ on it$/, " on ~"), { spellTargets: "self" });
}

/** "Bloodthirst 2": it enters with two +1/+1 counters if an opponent was dealt damage this turn. */
export function readBloodthirst(line: string, out: ParsedCard): boolean {
  const m = /^bloodthirst (\d+)$/.exec(line);
  if (!m) return false;
  out.bloodthirst = Number(m[1]);
  return true;
}

/** "Affinity for artifacts": it costs {1} less for each artifact you control. */
export function readAffinity(line: string, out: ParsedCard): boolean {
  const m = /^affinity for ([a-z]+)$/.exec(line);
  if (!m) return false;
  out.affinity = m[1];
  return true;
}
