import type { ParsedCard, StaticEffect, TriggeredAbility } from "../../effects.js";
import { newCtx } from "../targets.js";
import { parseEffectText } from "../effectText.js";
import type { Keyword } from "../../keywords.js";
import { COLOR_OF, isKeyword, singularType } from "../words.js";
import { parseCreatureLine } from "../lines.js";
import { selfStatic } from "../abilities.js";

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
  // Elenda: two sentences on one line, each a static of its own
  const two = /^(as long as your life total is greater than your starting life total, ~ gets .+?)\. (~ gets an additional .+)$/.exec(line);
  if (two) return selfConditional(two[1], out) && selfConditional(two[2], out);
  // Tempest Djinn: "~ gets +1/+0 for each basic island you control"
  if (/^~ gets [+-]\d+\/[+-]\d+ for each [a-z ]+$/.test(line)) {
    const st = selfStatic(line);
    if (st) {
      (out.statics ??= []).push(st);
      return true;
    }
  }
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

/** A trigger whose effects are read from the sentence after the comma. */
function trigger(out: ParsedCard, line: string, event: TriggeredAbility["event"], body: string, extra: Partial<TriggeredAbility> = {}, tweak?: (ctx: ReturnType<typeof newCtx>) => void): true {
  const ctx = newCtx(true);
  const effects = parseEffectText(body, ctx);
  if (effects && effects.length > 0) {
    tweak?.(ctx);
    out.triggers.push({ event, effects, targets: ctx.targets, text: line, ...extra });
  } else out.unsupported.push(line);
  return true;
}

/** Mazemind Tome: "When there are four or more page counters on this artifact, exile it. If you do, you gain 4 life." */
function counterLimit(line: string, out: ParsedCard): boolean {
  const m = /^when there are (two|three|four|five|six|seven|\d+) or more ([a-z]+) counters on ~, exile it\. if you do, you gain (\d+) life$/.exec(line);
  if (!m) return false;
  out.triggers.push({ event: "namedLimit", cond: { namedAtLeast: { name: m[2], n: num(m[1]) } }, effects: [{ type: "exile", what: { t: "self" } }, { type: "gainLife", amount: Number(m[3]), who: { t: "you" } }], targets: [], text: line });
  return true;
}

/** Triggers of Foundations cards about combat and attacking. */
function combatTriggers(line: string, out: ParsedCard): boolean {
  // Trygon Predator: "you may destroy target artifact or enchantment that player controls" (the player who was hit is the opponent)
  let m = /^whenever ~ deals combat damage to a player, you may destroy target artifact or enchantment that player controls$/.exec(line);
  if (m) return trigger(out, line, "combatDamagePlayer", "destroy target artifact or enchantment an opponent controls", {}, (ctx) => (ctx.targets[0] = { ...ctx.targets[0], optional: true }));
  // Goldvein Pick: "whenever equipped creature deals combat damage to a player, create a Treasure token"
  m = /^whenever equipped creature deals combat damage to a player, (.+)$/.exec(line);
  if (m) return trigger(out, line, "hostDamagesPlayer", m[1]);
  // Linden: "whenever a white creature you control attacks, you gain 1 life"
  m = /^whenever an? (white|blue|black|red|green) creature you control attacks, (.+)$/.exec(line);
  if (m) return trigger(out, line, "allyAttacks", m[2], { spellColor: COLOR_OF[m[1]] });
  // Armasaur Guide: "whenever you attack with three or more creatures, put a +1/+1 counter on target creature you control"
  m = /^whenever you attack with (three|four|\d+) or more creatures, (.+)$/.exec(line);
  if (m) return trigger(out, line, "attackTwo", m[2], { cond: { attackersAtLeast: num(m[1]) } });
  // Courageous Goblin, Ruby: "whenever ~ attacks while you control a creature with power 4 or greater, ~ gets +1/+0 and gains menace until end of turn"
  m = /^whenever ~ attacks while you control a creature with power (\d+) or greater, (.+)$/.exec(line);
  if (m) return trigger(out, line, "attacks", m[2], { cond: { creaturePowerAtLeast: Number(m[1]) } });
  return false;
}

export function readFoundations(line: string, out: ParsedCard): boolean {
  return entersWithNamed(line, out) || counterLimit(line, out) || combatTriggers(line, out) || hexproofFrom(line, out) || selfConditional(line, out) || cantBeBlockedBy(line, out) || gameRules(line, out);
}
