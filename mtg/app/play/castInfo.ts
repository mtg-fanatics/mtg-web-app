import { addCosts, castCostOf, colorsOfPerm, manaSourcesToConfirm, parseCard, parseManaCost, payForAbility, payMana, powerOf, withConvoke, withDelve, withPhyrexianLife } from "@mtg/engine";
import type { Action, CardDef, Castable, GameState, ManaColor, ManaCost, PlayerId } from "@mtg/engine";

/** A spell being cast step by step: creature or Adventure, teamwork, modes, then the kicker, then X, then delve, then replicate, then harmonize, then an additional cost, then targets. */
export interface CastPlan {
  iid: string;
  name: string;
  from?: "graveyard" | "exile" | "prepared";
  castable: Castable;
  /** A card with an Adventure that can be cast either way: the Adventure's castable, until the player chooses. */
  adventureCastable?: Castable;
  /** The Adventure was chosen. */
  adventure?: boolean;
  /** Harmonize: the creature tapped to pay {X} of the cost ("" = none). */
  harmonizeTap?: string;
  modes?: number[];
  kicked?: boolean;
  /** Teamwork: the creatures tapped as an additional cost ([] = cast without it). */
  teamwork?: string[];
  x?: number;
  sacrifice?: string;
  /** Cast for its warp cost. */
  warp?: boolean;
  /** Delve: the graveyard cards exiled to pay for it ([] = none). */
  delve?: string[];
  /** Convoke: the creatures tapped to pay for part of the cost ([] = none). */
  convoke?: string[];
  /** Replicate: how many copies are paid for (0 = none). */
  replicate?: number;
}

/** Flashback's cost, or harmonize's less the power of the creature tapped for it. */
function graveyardCost(state: GameState, def: CardDef, action: Action): ManaCost | null {
  const parsed = parseCard(def);
  const cost = parseManaCost(parsed.flashback ?? parsed.harmonize ?? "");
  const tapped = action.type === "castSpell" && action.harmonizeTap ? Object.values(state.players).flatMap((p) => p.battlefield).find((p) => p.card.iid === action.harmonizeTap) : undefined;
  return cost && tapped ? { ...cost, generic: Math.max(0, cost.generic - powerOf(state, tapped)) } : cost;
}

/** The mana cost of a spell or ability being used, and for a permanent's ability the card (paid like the engine pays it). */
function costOf(state: GameState, action: Action, who: PlayerId): { cost: ManaCost | null; ability: { def: CardDef; iid?: string } | null } {
  const me = state.players[who];
  if (action.type === "castSpell" || action.type === "castCreature") {
    const fromYard = action.type === "castSpell" && action.from === "graveyard";
    const prepared = action.type === "castSpell" && action.from === "prepared" ? me.battlefield.find((p) => p.card.iid === action.iid)?.prepared : undefined;
    const card = (fromYard ? me.graveyard : me.hand).find((c) => c.iid === action.iid);
    const base = prepared ? state.cards[prepared] : card ? state.cards[card.defId] : undefined;
    const def = base && action.type === "castSpell" && action.adventure ? parseCard(base).adventure : base;
    const printed = def ? (fromYard ? graveyardCost(state, def, action) : castCostOf(state, who, def, action.type === "castSpell" ? action.targets : undefined)) : null;
    // Replicate: its cost once more for each copy.
    const each = def && action.type === "castSpell" && action.replicate ? parseManaCost(parseCard(def).replicate ?? "") : null;
    const cost = printed && each ? Array.from({ length: action.type === "castSpell" ? (action.replicate ?? 0) : 0 }, () => each).reduce(addCosts, printed) : printed;
    const delved = cost && action.type === "castSpell" && action.delve ? withDelve(cost, action.delve.length) : cost;
    const tapped = action.type === "castSpell" && action.convoke ? me.battlefield.filter((p) => action.convoke!.includes(p.card.iid)).map((p) => ({ colors: colorsOfPerm(state, p) })) : [];
    return { cost: delved && tapped.length > 0 ? withConvoke(delved, tapped) : delved, ability: null };
  }
  if (action.type !== "activateAbility") return { cost: null, ability: null };
  const source = [...me.battlefield.map((p) => p.card), ...me.hand, ...me.graveyard].find((c) => c.iid === action.iid);
  const used = source ? parseCard(state.cards[source.defId]).activated[action.index] : undefined;
  const ability = source ? { def: state.cards[source.defId], ...(me.battlefield.some((p) => p.card.iid === source.iid) ? { iid: source.iid } : {}) } : null;
  return { cost: used?.mana ? parseManaCost(used.mana) : null, ability };
}

/** The mana an action costs, as text ("{2}{G}"), for the player to see while choosing the lands to pay with. Empty when it costs no mana. */
export function costLabel(state: GameState, action: Action, who: PlayerId): string {
  const base = costOf(state, action, who).cost;
  if (!base) return "";
  const cost = base.x ? { ...base } : base;
  let out = cost.generic > 0 ? `{${cost.generic}}` : "";
  for (const c of ["W", "U", "B", "R", "G", "C"] as const) out += `{${c}}`.repeat(cost.colored[c] ?? 0);
  for (const [a, b] of cost.hybrid ?? []) out += `{${a}/${b}}`;
  for (const c of cost.phyrexian ?? []) out += `{${c}/P}`;
  return out;
}

/**
 * What paying for this action involves: the life it costs (Phyrexian mana with no mana to match, or paid with life by choice), the
 * creatures it would tap for mana, and which permanent would make which mana.
 */
export function paymentOf(state: GameState, action: Action, who: PlayerId, spare: string[]): { ok: boolean; life: number; ask: string[]; made: { iid: string; color: ManaColor }[] } {
  const { cost, ability } = costOf(state, action, who);
  if (!cost) return { ok: true, life: 0, ask: [], made: [] };
  const chosen = withPhyrexianLife(cost, action.type === "castSpell" || action.type === "activateAbility" ? (action.phyrexianLife ?? 0) : 0);
  if (!chosen) return { ok: false, life: 0, ask: [], made: [] };
  const me = state.players[who];
  const held = spare.length > 0 ? { ...state, players: { ...state.players, [who]: { ...me, spareMana: spare } } } : state;
  const paid = ability ? payForAbility(held, who, chosen, ability.def, ability.iid) : payMana(held, who, chosen);
  return paid.ok ? { ok: true, life: paid.life, ask: manaSourcesToConfirm(state, who, paid.tap), made: paid.made } : { ok: false, life: 0, ask: [], made: [] };
}

/**
 * The ways to pay a cost with Phyrexian mana ({B/P}: black mana or 2 life) when the player has the mana for some of it:
 * each with the life it costs and the mana it still takes. Empty when there is nothing to choose.
 */
export function phyrexianChoices(state: GameState, action: Action, who: PlayerId, spare: string[]): { action: Action; life: number; mana: string }[] {
  if ((action.type !== "castSpell" && action.type !== "activateAbility") || action.phyrexianLife !== undefined) return [];
  const symbols = costOf(state, action, who).cost?.phyrexian ?? [];
  const choices: { action: Action; life: number; mana: string }[] = [];
  for (let n = 0; n <= symbols.length; n++) {
    const choice = { ...action, phyrexianLife: n };
    const pay = paymentOf(state, choice, who, spare);
    if (!pay.ok || choices.some((c) => c.life === pay.life)) continue;
    choices.push({ action: choice, life: pay.life, mana: symbols.slice(0, symbols.length - pay.life / 2).map((c) => `{${c}}`).join("") });
  }
  return choices.length > 1 ? choices : [];
}

/** A prepared creature of the player's: the spell a copy of which may be cast, and the creature's own name. */
export function preparedSpell(state: GameState, player: PlayerId, iid: string): { spell: CardDef; creature: string } | null {
  const perm = state.players[player].battlefield.find((p) => p.card.iid === iid);
  if (!perm?.prepared || !state.cards[perm.prepared]) return null;
  return { spell: state.cards[perm.prepared], creature: state.cards[perm.card.defId].name.split(" // ")[0] };
}

/** The name of a card wherever it is: on the battlefield, or in a hand or graveyard (some abilities work from there). */
export function cardNameAnywhere(state: GameState, iid: string): string {
  for (const p of Object.values(state.players)) {
    const card = [...p.battlefield.map((x) => x.card), ...p.hand, ...p.graveyard].find((c) => c.iid === iid);
    if (card) return state.cards[card.defId].name;
  }
  return "a card";
}
