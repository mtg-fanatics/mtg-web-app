import type { LoyaltyAbility, ParsedCard, StaticEffect, TargetSpec, TriggeredAbility } from "../effects.js";
import { parseManaCost } from "../mana.js";
import { forEachCount, keywordList, toNumber } from "./words.js";
import { newCtx } from "./targets.js";
import { parseEffectText } from "./effectText.js";

// Parts of a permanent's lines: static effects, trigger conditions and loyalty abilities.

export type TriggerCond = NonNullable<TriggeredAbility["cond"]>;

/** An "intervening if" a trigger checks: "if you gained 3 or more life this turn", "if you attacked this turn", "if you control another Elf". */
export function interveningCond(text: string): TriggerCond | null {
  let m: RegExpExecArray | null;
  if ((m = /^you gained (\d+|two|three|four|five) or more life this turn$/.exec(text))) return { lifeGainedAtLeast: toNumber(m[1]) ?? 0 };
  if ((m = /^you have (\d+) or more life$/.exec(text))) return { lifeAtLeast: Number(m[1]) };
  if ((m = /^you have fewer than (ten|\d+) cards in hand$/.exec(text))) return { handBelow: m[1] === "ten" ? 10 : Number(m[1]) };
  if (text === "enchanted creature is untapped") return { enchantedUntapped: true };
  if (text === "an opponent lost life this turn") return { opponentLostLife: true };
  if ((m = /^a player lost (\d+|two|three|four|five) or more life this turn$/.exec(text))) return { anyLostLifeAtLeast: toNumber(m[1]) ?? 0 };
  if (text === "you attacked this turn") return { attackedThisTurn: true };
  if ((m = /^you control an? (artifact or enchantment|artifact|enchantment)$/.exec(text))) return { controlsTypes: m[1].split(" or ") };
  if ((m = /^you control another ([a-z]+)$/.exec(text))) return { controlsOther: m[1] };
  if ((m = /^you control (two|three|four|five|\d+) or more creatures$/.exec(text))) return { creaturesAtLeast: toNumber(m[1]) ?? 0 };
  if ((m = /^an? ([a-z]+) and an? ([a-z]+) attacked this combat$/.exec(text))) return { attackersInclude: [m[1], m[2]] };
  if (text === "you cast it") return { cast: true };
  if (/^(?:there are seven or more cards in your graveyard|seven or more cards are in your graveyard)$/.test(text)) return { yardAtLeast: 7 };
  if (text === "you have no cards in hand") return { handEmpty: true };
  if (text === "you control three or more artifacts") return { artifactsAtLeast: 3 };
  if (text === "a creature died this turn") return { creatureDied: true };
  return null;
}

export const AURA_TARGETS: Record<string, TargetSpec> = {
  "enchant creature": { kind: "creature", label: "creature" },
  "enchant creature you control": { kind: "creature", controller: "you", label: "creature you control" },
  "enchant creature an opponent controls": { kind: "creature", controller: "opponent", label: "creature an opponent controls" },
  "enchant land": { kind: "land", label: "land" },
  "enchant permanent": { kind: "permanent", label: "permanent" },
};

/** "Enchanted creature gets +2/+2 and has flying", "Creatures you control get +1/+1", "...can't attack or block". */
export function parseStatic(line: string): StaticEffect | null {
  const m = /^(enchanted creature|enchanted permanent|equipped creature|other creatures you control|creatures you control|creatures your opponents control|creatures you don't control|all creatures) (.+)$/.exec(line);
  if (!m) return null;
  const scope = m[1] === "enchanted creature" || m[1] === "enchanted permanent" || m[1] === "equipped creature" ? "enchanted" : m[1].includes("you control") ? "yours" : m[1] === "all creatures" ? "all" : "opponents";
  const st: StaticEffect = { scope, power: 0, toughness: 0, keywords: [] };
  if (m[1].startsWith("other")) st.other = true;
  let rest = m[2].trim();
  // "... and is an Angel in addition to its other types"
  const typed = /(?:^|,? and )is an? ([a-z]+) in addition to its other types$/.exec(rest);
  if (typed) {
    st.addSubtypes = [typed[1]];
    rest = rest.slice(0, typed.index);
    if (rest === "") return st;
  }
  const pt = /^gets? ([+-]\d+)\/([+-]\d+)(?: for each (.+?))?(?:,? and |, |$)/.exec(rest);
  if (pt) {
    st.power = Number(pt[1]);
    st.toughness = Number(pt[2]);
    if (pt[3] !== undefined) {
      // "gets +1/+1 for each enchantment you control": counted for the controller of the Aura or anthem
      const per = forEachCount(pt[3]);
      if (!per || !["permanents", "hand", "graveyard"].includes(per.kind)) return null;
      st.per = per;
    }
    rest = rest.slice(pt[0].length);
    if (rest === "") return st;
  }
  const has = /^(?:has|have) (.+)$/.exec(rest);
  if (has) {
    // "has lifelink and ward {2}": ward is kept apart from the keywords
    const parts = has[1].split(/, and |, | and /).map((w) => w.trim());
    const ward = parts.map((w) => /^ward ((?:\{[^}]+\})+)$/.exec(w)?.[1]).find(Boolean);
    const keywords = keywordList(parts.filter((w) => !w.startsWith("ward ")).join(", "));
    if (ward && !parseManaCost(ward)) return null;
    if (ward && parts.length === 1) return { ...st, ward };
    if (!keywords) return null;
    st.keywords = keywords;
    if (ward) st.ward = ward;
    return st;
  }
  if (/^can't attack or block, and its activated abilities can't be activated(?: unless they're mana abilities)?$/.test(rest)) return { ...st, cantAttack: true, cantBlock: true, noActivated: true };
  if (rest === "can't attack or block") return { ...st, cantAttack: true, cantBlock: true };
  if (rest === "can't attack") return { ...st, cantAttack: true };
  if (rest === "can't block") return { ...st, cantBlock: true };
  if (rest === "doesn't untap during its controller's untap step") return { ...st, noUntap: true };
  return null;
}

/** "~ gets +1/+1", "~ has flying", "~ gets +2/+0 and has first strike": a static about the permanent itself. */
export function selfStatic(text: string): StaticEffect | null {
  const m = /^~ (gets? .+|has .+)$/.exec(text);
  const st = m ? parseStatic(`creatures you control ${m[1].replace(/^has /, "have ").replace(/^gets /, "get ")}`) : null;
  return st ? { ...st, scope: "self" } : null;
}

/** "+1: Draw a card.", "-3: Destroy target creature.", "0: ...": a planeswalker's loyalty abilities. */
export function parseLoyalty(line: string, out: ParsedCard): boolean {
  const m = /^([+-]?\d+): (.+)$/.exec(line);
  if (!m) return false;
  const ctx = newCtx(true);
  const effects = parseEffectText(m[2], ctx);
  if (!effects || effects.length === 0) {
    out.unsupported.push(line);
    return true;
  }
  const ability: LoyaltyAbility = { cost: Number(m[1]), effects, targets: ctx.targets, text: line };
  (out.loyaltyAbilities ??= []).push(ability);
  return true;
}
