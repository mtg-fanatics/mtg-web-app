import type { ParsedCard, StaticEffect } from "../../effects.js";
import type { Keyword } from "../../keywords.js";
import { COLOR_OF, isKeyword, singularType } from "../words.js";
import { parseCreatureLine } from "../lines.js";

// Lines of the cards of Foundations that no older deck had: one reader for each kind of line, tried before the general ones.

const KNOWN_COUNTERS = /^(?:stun|loyalty|lore|poison|finality|plan|invasion|age|level|time|oil|shield|flying|first|double|deathtouch|lifelink|menace|trample|vigilance|haste|reach|indestructible|hexproof)$/;
const NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w: string) => NUMBER[w] ?? Number(w);
const self = (st: Partial<StaticEffect> & Pick<StaticEffect, "keywords" | "power" | "toughness">): StaticEffect => ({ scope: "self", ...st });

/** "This artifact enters with three wish counters on it." / "~ enters with eight revival counters on it if you cast it." */
function entersWithNamed(line: string, out: ParsedCard): boolean {
  const m = /^~ enters with (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([a-z]+) counters? on it( if you cast it( from your hand)?)?$/.exec(line);
  if (!m || KNOWN_COUNTERS.test(m[2])) return false;
  out.entersWithNamed = { name: m[2], n: num(m[1]), ...(m[3] ? { ifCast: true } : {}) };
  return true;
}

/** "Hexproof from white" / "Lifelink, hexproof from instants". */
function hexproofFrom(line: string, out: ParsedCard): boolean {
  const m = /^(?:(.+), )?hexproof from (white|blue|black|red|green|instants|sorceries)$/.exec(line);
  if (!m) return false;
  if (m[1]) parseCreatureLine(m[1], out);
  (out.hexproofFrom ??= []).push(COLOR_OF[m[2]] ?? singularType(m[2]).replace("sorcerie", "sorcery"));
  return true;
}

/** Statics about the permanent itself that depend on how it is right now. */
function selfConditional(line: string, out: ParsedCard): boolean {
  let m = /^~ gets \+(\d+)\/\+(\d+) as long as any player controls an? (white|blue|black|red|green) permanent$/.exec(line);
  if (m) {
    (out.statics ??= []).push(self({ power: Number(m[1]), toughness: Number(m[2]), keywords: [], cond: { colorPermAny: COLOR_OF[m[3]] } }));
    return true;
  }
  m = /^~ has ([a-z ]+?) as long as it has an? ([a-z]+) counter on it$/.exec(line);
  if (m && isKeyword(m[1]) && !KNOWN_COUNTERS.test(m[2])) {
    (out.statics ??= []).push(self({ power: 0, toughness: 0, keywords: [m[1] as Keyword], cond: { selfNamedAtLeast: { name: m[2], n: 1 } } }));
    return true;
  }
  m = /^as long as ~ has (two|three|four|five|\d+) or more \+1\/\+1 counters on it, it has ([a-z ]+?) and is an? ([a-z]+) in addition to its other types$/.exec(line);
  if (m && isKeyword(m[2])) {
    (out.statics ??= []).push(self({ power: 0, toughness: 0, keywords: [m[2] as Keyword], addSubtypes: [m[3]], cond: { selfCountersAtLeast: num(m[1]) } }));
    return true;
  }
  // Elenda: "As long as your life total is greater than your starting life total, ~ gets +1/+1 and has menace." / "~ gets an additional +5/+5 as long as your life total is at least 10 greater than your starting life total."
  m = /^as long as your life total is greater than your starting life total, ~ gets \+(\d+)\/\+(\d+) and has ([a-z ]+)$/.exec(line);
  if (m && isKeyword(m[3])) {
    (out.statics ??= []).push(self({ power: Number(m[1]), toughness: Number(m[2]), keywords: [m[3] as Keyword], cond: { lifeAtLeast: 21 } }));
    return true;
  }
  m = /^~ gets an additional \+(\d+)\/\+(\d+) as long as your life total is at least (\d+) greater than your starting life total$/.exec(line);
  if (m) {
    (out.statics ??= []).push(self({ power: Number(m[1]), toughness: Number(m[2]), keywords: [], cond: { lifeAtLeast: 20 + Number(m[3]) } }));
    return true;
  }
  // Cephalid Inkmage: "Threshold — ~ can't be blocked as long as there are seven or more cards in your graveyard."
  m = /^~ can't be blocked as long as there are (seven|\d+) or more cards in your graveyard$/.exec(line);
  if (m) {
    (out.statics ??= []).push(self({ power: 0, toughness: 0, keywords: [], unblockable: true, cond: { yardAtLeast: num(m[1]) } }));
    return true;
  }
  return false;
}

/** "~ can't be blocked by Humans." / "by Walls." */
function cantBeBlockedBy(line: string, out: ParsedCard): boolean {
  const m = /^~ can't be blocked by ([a-z]+)$/.exec(line);
  if (!m || /^(creatures|power)/.test(m[1])) return false;
  (out.cantBeBlockedBySubtypes ??= []).push(singularType(m[1]));
  return true;
}

/** Rules that change how the game treats damage, spells and players while the permanent is in play. */
function gameRules(line: string, out: ParsedCard): boolean {
  if (line === "prevent all combat damage that would be dealt to and dealt by ~") return ((out.fogSelf = true), true);
  if (line === "instant and sorcery spells you control can't be countered") return ((out.spellsUncounterable = true), true);
  if (line === "you have hexproof") return ((out.youHexproof = true), true);
  if (line === "you can't lose the game and your opponents can't win the game") return ((out.cantLose = true), true);
  if (line === "if a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead") return ((out.damageDoubler = { creaturesOnly: false, opponentSideOnly: true }), true);
  if (line === "if a creature you control would deal damage to a permanent or player, it deals double that damage instead") return ((out.damageDoubler = { creaturesOnly: true, opponentSideOnly: false }), true);
  if (line === "prevent all noncombat damage that would be dealt to other creatures you control") return ((out.preventNoncombatOthers = true), true);
  return false;
}

export function readFoundations(line: string, out: ParsedCard): boolean {
  return entersWithNamed(line, out) || hexproofFrom(line, out) || selfConditional(line, out) || cantBeBlockedBy(line, out) || gameRules(line, out);
}
