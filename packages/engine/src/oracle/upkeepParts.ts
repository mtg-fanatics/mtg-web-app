import type { Effect, ParsedCard } from "../effects.js";
import type { Ctx } from "./targets.js";

// Echo, cumulative upkeep, and "sacrifice ~ unless you pay ...".

type SentenceParser = (s: string, ctx: Ctx) => Effect[] | null;

const MANA = "(?:\{[^}]+\})+";

/** "Sacrifice ~ unless you pay {1}{G}." (at the beginning of your upkeep, as a trigger's sentence) */
const sacrificeUnlessPay: SentenceParser = (s) => {
  const m = new RegExp(`^sacrifice (?:~|it) unless you pay (${MANA})$`).exec(s);
  return m ? [{ type: "unlessPay", cost: m[1], otherwise: [{ type: "sacrifice", what: { t: "self" } }] }] : null;
};

/** "Amass 2" / "Amass Orcs 2". */
const amass: SentenceParser = (s) => {
  const m = /^amass (?:([a-z]+?)s? )?(\d+)$/.exec(s);
  return m ? [{ type: "amass", n: Number(m[2]), ...(m[1] ? { subtype: m[1] } : {}) }] : null;
};

export const UPKEEP_SENTENCES: SentenceParser[] = [sacrificeUnlessPay, amass];

/** "Echo {2}{R}": at the beginning of your next upkeep, pay it or sacrifice the permanent (only the first time). */
export function readEcho(line: string, out: ParsedCard): boolean {
  const m = new RegExp(`^echo (${MANA})$`).exec(line);
  if (!m) return false;
  out.triggers.push({ event: "upkeep", effects: [{ type: "unlessPay", cost: m[1], echo: true, otherwise: [{ type: "sacrifice", what: { t: "self" } }] }], targets: [], text: `Echo ${m[1]}: pay it or sacrifice this.` });
  out.echo = true;
  return true;
}

/** "Cumulative upkeep {1}": each upkeep it gets an age counter, and its controller pays the cost for each of them or sacrifices it. */
export function readCumulativeUpkeep(line: string, out: ParsedCard): boolean {
  const m = new RegExp(`^cumulative upkeep (${MANA})$`).exec(line);
  if (!m) return false;
  out.triggers.push({ event: "upkeep", effects: [{ type: "unlessPay", cost: m[1], cumulative: true, otherwise: [{ type: "sacrifice", what: { t: "self" } }] }], targets: [], text: `Cumulative upkeep ${m[1]}: pay it for each age counter or sacrifice this.` });
  return true;
}
