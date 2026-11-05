import { getCard } from "../cards.js";
import { bindSpecs, colorsOfPerm, exilePlayable, exilePlayTerms, forbidden, isCreature, isPermanentCard, kw, legalTargets, powerOf, subtypesOf } from "../core.js";
import type { TargetSpec } from "../effects.js";
import { addCosts, parseManaCost, payMana, withConvoke, withDelve, withX } from "../mana.js";
import type { ManaCost } from "../mana.js";
import { parseCard } from "../oracle.js";
import type { CardDef, GameState, Permanent, PlayerId } from "../types.js";
import { abilityHaste, abilityManaCost, abilityNeed, canCastNow, holdsPriority, levelLock, sorceryTiming } from "./shared.js";
import { castCostOf, convokePool, costChoices, crewers, delveChoice, extraSacrificeFits, waterbendTaps, harmonizers, liftedSpecs, tapPair, teamworkers } from "./cast.js";

// What a player could do right now (for the screen and for auto-passing).

export interface Castable {
  iid: string;
  specs: TargetSpec[];
  /** The spell has X in its cost: the most the player can pay for X right now (0 or more). Missing when it has no X. */
  maxX?: number;
  /** Set when the card is in the graveyard and can be cast from there with flashback, in exile, or is a prepared creature's spell (`iid` is the creature). */
  zone?: "graveyard" | "exile" | "prepared";
  /** "Sacrifice a creature" is an additional cost: the creatures that could be sacrificed. */
  sacrifice?: string[];
  /** "...sacrifice a creature or pay {3}{B}": the mana that may be paid instead (answered as `sacrifice: "pay"`), when it can be paid. */
  orPay?: string;
  /** "Discard a card" is an additional cost: the cards that could be discarded (answered as `sacrifice`). */
  discard?: string[];
  /** A "Choose one —" spell: each mode with what it targets and whether it could be chosen right now. */
  modal?: { min: number; max: number; bothIfKicked?: boolean; modes: { text: string; specs: TargetSpec[]; available: boolean }[] };
  /** The spell has a kicker the player could pay on top of the cost right now: its printed cost, e.g. "{2}". Offspring is one (`kickerName`). */
  kicker?: string;
  kickerName?: "offspring" | "waterbend" | "buyback";
  /** Waterbend: the artifacts and creatures that would be tapped to help pay it (each one {1}); the rest is mana. */
  waterbendTaps?: string[];
  /** "You may blight 1" as an additional cost: how many -1/-1 counters, and the creatures they could go on (answered as `kicked` and `sacrifice`). */
  blight?: { n: number; options: string[] };
  /** It can be cast from hand for this warp cost right now. `warpOnly`: only that way (the mana cost can't be paid). */
  warp?: string;
  warpOnly?: boolean;
  /** Teamwork: the player may tap creatures with total power `n` or more (any of `options`) as an additional cost; the spell then counts as kicked. */
  teamwork?: { n: number; options: string[] };
  /** Delve: graveyard cards that may be exiled to pay {1} each (best ones to give up first), at least `min` of them for the rest to be payable, at most `max`. */
  delve?: { min: number; max: number; options: string[] };
  /** Convoke: the creatures that may be tapped to pay for {1} (or a mana of their color) each: at least `min` of them for the rest to be payable, at most `max`. */
  convoke?: { min: number; max: number; options: string[] };
  /** Replicate: its cost, and the most times it can be paid right now (each payment is a copy, with targets of its own). */
  replicate?: { cost: string; max: number };
  /** An Adventure card in hand: this is its Adventure spell (cast with `adventure: true`). */
  adventure?: boolean;
  /** Harmonize (from the graveyard): the creatures that could be tapped to pay part of the cost, and whether it can be paid without one. */
  harmonize?: { options: string[]; free: boolean };
}

/** Cards in hand the player could cast right now: right timing, enough mana, and a legal target for each need. */
/** How a card (or a prepared creature's spell, `def`) could be cast right now, or null if it can't. */
function castableAs(state: GameState, player: PlayerId, iid: string, def: CardDef, zone?: Castable["zone"]): Castable | null {
  if (!isPermanentCard(def) && def.type !== "instant" && def.type !== "sorcery") return null;
  const parsed = parseCard(def);
  const printed = castCostOf(state, player, def);
  const terms = zone === "exile" ? exilePlayTerms(state, player, iid) : null;
  const tax = terms?.tax ?? 0;
  const cost = terms?.payGeneric !== undefined ? (parseManaCost(`{${terms.payGeneric}}`) ?? printed) : printed && tax > 0 ? { ...printed, generic: printed.generic + tax } : printed; // airbend: {2} rather than the mana cost
  if (!parsed.ok || !cost || !canCastNow(state, player, def)) return null;
  if (terms?.sorcery && !sorceryTiming(state, player)) return null; // plotted
  const warpCost = parsed.warp && zone === undefined ? parseManaCost(parsed.warp) : null;
  const canWarp = warpCost !== null && payMana(state, player, warpCost, def).ok;
  // Delve: cards in the graveyard can pay for the generic mana.
  const yard = parsed.delve ? delveChoice(state, player, iid, Infinity) : [];
  // Convoke: creatures can pay for part of it.
  const tappers = parsed.convoke ? convokePool(state, player) : [];
  const tapColors = tappers.map((p) => ({ colors: colorsOfPerm(state, p) }));
  const afford = (c: ManaCost) => payMana(state, player, withConvoke(withDelve(c, yard.length), tapColors), def).ok;
  const canNormal = afford(withX(cost, 0));
  // "Costs {3} less to cast if it targets a tapped permanent" / "...a blue spell": when only that price can be paid, only such targets are offered.
  const reduction = parsed.costReduction;
  const discount = reduction?.ifTargetsTapped || reduction?.ifTargetsColor ? reduction.n : 0;
  const discountOnly = !canNormal && discount > 0 && afford(withX({ ...cost, generic: Math.max(0, cost.generic - discount) }, 0));
  if (!canNormal && !canWarp && !discountOnly) return null;
  const warpPart = canWarp ? { warp: parsed.warp, ...(canNormal ? {} : { warpOnly: true }) } : {};
  const narrowed = (spec: TargetSpec): TargetSpec => (reduction?.ifTargetsColor ? { ...spec, spellColor: reduction.ifTargetsColor } : { ...spec, filter: "tapped" });
  const specs = (parsed.spell?.targets ?? []).map((spec) => (discountOnly && !canWarp ? narrowed(spec) : spec));
  const modal = parsed.spell?.modal;
  const modeInfo = modal ? modal.modes.map((m) => ({ text: m.text, specs: m.targets, available: m.targets.every((spec) => legalTargets(state, spec, player).length > 0) })) : undefined;
  // Teamwork: creatures that could be tapped for it, and whether they are enough (then the spell may have fewer limits on its targets).
  const teamOptions = parsed.teamwork !== undefined ? teamworkers(state, player) : [];
  const canTeam = parsed.teamwork !== undefined && teamOptions.reduce((n, p) => n + Math.max(0, powerOf(state, p)), 0) >= parsed.teamwork;
  const reachable = canTeam ? liftedSpecs(specs) : specs;
  if (modeInfo ? !modeInfo.some((m) => m.available) : reachable.some((spec) => legalTargets(state, spec, player).length === 0)) return null;
  const teamPart = canTeam ? { teamwork: { n: parsed.teamwork!, options: teamOptions.map((p) => p.card.iid) } } : {};
  const kickerCost = parsed.kicker ? parseManaCost(parsed.kicker) : null;
  const bent = kickerCost !== null && parsed.kickerName === "waterbend" ? waterbendTaps(state, player, withX(cost, 0), kickerCost, def) : null;
  const canKick = kickerCost !== null && (parsed.kickerName === "waterbend" ? bent !== null : afford(addCosts(cost, kickerCost)));
  const kickable = canKick ? { kicker: parsed.kicker, ...(parsed.kickerName ? { kickerName: parsed.kickerName } : {}), ...(bent ? { waterbendTaps: bent.map((p) => p.card.iid) } : {}) } : {};
  const blightOptions = parsed.blight ? state.players[player].battlefield.filter((p) => isCreature(state, p)).map((p) => p.card.iid) : [];
  const blightPart = blightOptions.length > 0 ? { blight: { n: parsed.blight!, options: blightOptions } } : {};
  const modalPart = modal && modeInfo ? { modal: { min: modal.min, max: modal.max, ...(modal.bothIfKicked ? { bothIfKicked: true } : {}), modes: modeInfo } } : {};
  if (parsed.extraSacrifice || parsed.extraSacrificeOrPay !== undefined) {
    const options = state.players[player].battlefield.filter((p) => extraSacrificeFits(state, parsed, p)).map((p) => p.card.iid);
    const instead = parsed.extraSacrificeOrPay !== undefined ? parseManaCost(parsed.extraSacrificeOrPay) : null;
    const canPay = instead !== null && afford(addCosts(withX(cost, 0), instead));
    if (options.length === 0 && !canPay) return null;
    Object.assign(modalPart, { sacrifice: options, ...(canPay ? { orPay: parsed.extraSacrificeOrPay } : {}) });
  }
  if (parsed.extraDiscard) {
    const options = state.players[player].hand.filter((c) => c.iid !== iid).map((c) => c.iid);
    if (options.length === 0) return null;
    Object.assign(modalPart, { discard: options });
  }
  const zonePart = zone ? { zone, ...delveOf(state, player, def, withX(cost, 0), yard) } : delveOf(state, player, def, withX(cost, 0), yard);
  if (parsed.convoke && tappers.length > 0) {
    const need = withDelve(withX(cost, 0), 0);
    const max = Math.min(tappers.length, need.generic + Object.values(need.colored).reduce((n, v) => n + (v ?? 0), 0));
    let min = 0;
    while (min < max && !payMana(state, player, withConvoke(need, tapColors.slice(0, min)), def).ok) min++;
    if (max > 0) Object.assign(zonePart, { convoke: { min, max, options: tappers.map((p) => p.card.iid) } });
  }
  const replicateCost = parsed.replicate ? parseManaCost(parsed.replicate) : null;
  if (replicateCost) {
    let max = 0;
    while (max < 10 && afford(withX(Array.from({ length: max + 1 }, () => replicateCost).reduce(addCosts, cost), 0))) max++;
    Object.assign(modalPart, { replicate: { cost: parsed.replicate!, max } });
  }
  if (!cost.x) return { iid, specs, ...kickable, ...blightPart, ...teamPart, ...warpPart, ...modalPart, ...zonePart };
  let maxX = 0;
  while (maxX < 30 && afford(withX(cost, maxX + 1))) maxX++;
  return { iid, specs, maxX, ...kickable, ...blightPart, ...teamPart, ...warpPart, ...modalPart, ...zonePart };
}

/** Delve's part of a Castable: how many of the graveyard cards (`yard`) must and may be exiled to pay for `cost`. */
function delveOf(state: GameState, player: PlayerId, def: CardDef, cost: ManaCost, yard: string[]): Pick<Castable, "delve"> {
  const max = Math.min(yard.length, cost.generic);
  if (max === 0) return {};
  let min = 0;
  while (min < max && !payMana(state, player, withDelve(cost, min), def).ok) min++;
  return { delve: { min, max, options: yard } };
}

export function getCastable(state: GameState, player: PlayerId): Castable[] {
  const out: Castable[] = [];
  const fromExile = new Set(exilePlayable(state, player).map((c) => c.iid)); // "you may play that card" (Goblin Researcher)
  for (const card of [...state.players[player].hand, ...exilePlayable(state, player)]) {
    const castable = castableAs(state, player, card.iid, getCard(state, card.defId), fromExile.has(card.iid) ? "exile" : undefined);
    if (castable) out.push(castable);
  }
  // Adventure cards in hand: the Adventure spell may be cast instead of the creature.
  for (const card of state.players[player].hand) {
    const adventure = parseCard(getCard(state, card.defId)).adventure;
    const castable = adventure ? castableAs(state, player, card.iid, adventure) : null;
    if (castable) out.push({ ...castable, adventure: true });
  }
  // Prepared creatures: a copy of each one's spell.
  for (const perm of state.players[player].battlefield) {
    const castable = perm.prepared ? castableAs(state, player, perm.card.iid, getCard(state, perm.prepared), "prepared") : null;
    if (castable) out.push(castable);
  }
  // Creature cards that may be cast from the graveyard this turn.
  for (const card of state.players[player].graveyard) {
    if (!(state.players[player].yardCastable ?? []).includes(card.iid)) continue;
    const castable = castableAs(state, player, card.iid, getCard(state, card.defId), "graveyard");
    if (castable) out.push(castable);
  }
  // Flashback (and harmonize): instants and sorceries in the graveyard, for that cost.
  for (const card of state.players[player].graveyard) {
    const def = getCard(state, card.defId);
    if (def.type !== "instant" && def.type !== "sorcery") continue;
    const parsed = parseCard(def);
    const alternative = parsed.flashback ?? parsed.harmonize;
    const cost = alternative ? parseManaCost(alternative) : null;
    if (!parsed.ok || !cost || !canCastNow(state, player, def)) continue;
    const free = payMana(state, player, cost, def).ok;
    const tappers = parsed.harmonize && !parsed.flashback ? harmonizers(state, player).filter((p) => payMana(state, player, { ...cost, generic: Math.max(0, cost.generic - powerOf(state, p)) }, def).ok) : [];
    if (!free && tappers.length === 0) continue;
    const specs = parsed.spell?.targets ?? [];
    if (parsed.spell?.modal || specs.some((spec) => legalTargets(state, spec, player).length === 0)) continue;
    // "Flashback—Sacrifice a Mountain": the permanents that could be sacrificed
    const sacType = parsed.flashbackSacrifice;
    const sacrifice = sacType ? state.players[player].battlefield.filter((p) => subtypesOf(state, p).includes(sacType)).map((p) => p.card.iid) : [];
    if (sacType && sacrifice.length === 0) continue;
    out.push({ iid: card.iid, specs, zone: "graveyard", ...(sacType ? { sacrifice } : {}), ...(parsed.harmonize && !parsed.flashback ? { harmonize: { options: tappers.map((p) => p.card.iid), free } } : {}) });
  }
  return out;
}

export interface LoyaltyOption {
  iid: string;
  index: number;
  cost: number;
  text: string;
  specs: TargetSpec[];
}

/** The loyalty abilities the player could activate right now (one per planeswalker per turn, at sorcery speed). */
export function getLoyaltyAbilities(state: GameState, player: PlayerId): LoyaltyOption[] {
  if (!sorceryTiming(state, player)) return [];
  const out: LoyaltyOption[] = [];
  for (const perm of state.players[player].battlefield) {
    if (perm.loyaltyUsed || getCard(state, perm.card.defId).type !== "planeswalker") continue;
    parseCard(getCard(state, perm.card.defId)).loyaltyAbilities?.forEach((ability, index) => {
      if (ability.cost < 0 && (perm.loyalty ?? 0) < -ability.cost) return;
      if (ability.targets.some((spec) => legalTargets(state, spec, player).length === 0)) return;
      out.push({ iid: perm.card.iid, index, cost: ability.cost, text: ability.text, specs: ability.targets });
    });
  }
  return out;
}

export interface Crewable {
  iid: string;
  /** The total power that must be tapped. */
  crew: number;
}

/** Vehicles the player could crew right now: they have priority and enough untapped creature power. */
export function getCrewable(state: GameState, player: PlayerId): Crewable[] {
  if (!holdsPriority(state, player)) return [];
  const out: Crewable[] = [];
  for (const perm of state.players[player].battlefield) {
    const crew = parseCard(getCard(state, perm.card.defId)).crew;
    if (crew === undefined || perm.crewed) continue;
    if (crewers(state, player, perm.card.iid).reduce((n, c) => n + Math.max(0, powerOf(state, c)), 0) >= crew) out.push({ iid: perm.card.iid, crew });
  }
  return out;
}

export interface Cyclable {
  iid: string;
  /** The printed cycling cost, e.g. "{2}". */
  cost: string;
}

/** Cards in hand the player can cycle right now (they hold priority and can pay). */
/** Cards in hand that could be plotted right now, with their plot cost. */
export function getPlottable(state: GameState, player: PlayerId): { iid: string; cost: string }[] {
  if (!sorceryTiming(state, player)) return [];
  return state.players[player].hand.flatMap((card) => {
    const def = getCard(state, card.defId);
    const plot = parseCard(def).plot;
    const cost = plot ? parseManaCost(plot) : null;
    return plot && cost && parseCard(def).ok && payMana(state, player, cost, def).ok ? [{ iid: card.iid, cost: plot }] : [];
  });
}

export function getCyclable(state: GameState, player: PlayerId): Cyclable[] {
  if (!holdsPriority(state, player)) return [];
  const out: Cyclable[] = [];
  for (const card of state.players[player].hand) {
    const parsed = parseCard(getCard(state, card.defId));
    const cycling = parsed.cycling ?? parsed.landcycling;
    const cost = cycling ? parseManaCost(cycling) : null;
    if (cycling && cost && payMana(state, player, cost).ok) out.push({ iid: card.iid, cost: cycling });
  }
  return out;
}

export interface Activatable {
  iid: string;
  index: number;
  text: string;
  specs: TargetSpec[];
  /** For a cost like "Sacrifice a creature": the cards the player may choose to pay with, and what to call the choice. */
  costChoices?: string[];
  costLabel?: string;
  /** The cost has an X ("{X}{R}"): the most the player can pay for it right now. */
  maxX?: number;
}

/** Abilities of the player's permanents they could use right now. */
export function getActivatable(state: GameState, player: PlayerId): Activatable[] {
  if (!holdsPriority(state, player)) return [];
  const out: Activatable[] = [];
  // Abilities that work from the hand or graveyard ("{1}{U}, discard this card: ...").
  for (const [zone, cards] of [["hand", state.players[player].hand], ["graveyard", state.players[player].graveyard]] as const) {
    for (const card of cards) {
      parseCard(getCard(state, card.defId)).activated.forEach((ability, index) => {
        if (ability.zone !== zone) return;
        if (ability.mana) {
          const cost = abilityManaCost(state, { card }, ability);
          if (!cost || !payMana(state, player, cost).ok) return;
        }
        if (ability.payLife && state.players[player].life < ability.payLife) return;
        if (bindSpecs(ability.targets, card.iid).some((spec) => legalTargets(state, spec, player).length === 0)) return;
        if (ability.sorceryOnly && !sorceryTiming(state, player)) return;
        if (ability.yourTurnOnly && state.active !== player) return;
        if (ability.costCard && costChoices(state, player, ability, card.iid).length === 0) return;
        out.push({ iid: card.iid, index, text: ability.text, specs: ability.targets, ...(ability.costCard ? { costChoices: costChoices(state, player, ability, card.iid), costLabel: ability.costCard.label } : {}) });
      });
    }
  }
  for (const perm of state.players[player].battlefield) {
    const def = getCard(state, perm.card.defId);
    parseCard(def).activated.forEach((ability, index) => {
      if (ability.zone) return;
      if (ability.tap && (perm.tapped || (isCreature(state, perm) && perm.summoningSick && !kw(state, perm, "haste") && !abilityHaste(state, player)))) return;
      if (ability.mana) {
        const cost = abilityManaCost(state, perm, ability);
        if (!cost || !payMana(state, player, cost, undefined, def).ok) return;
      }
      if (bindSpecs(ability.targets, perm.card.iid).some((spec) => legalTargets(state, spec, player).length === 0)) return;
      if (ability.sorceryOnly && !sorceryTiming(state, player)) return;
      if (ability.oncePerTurn && perm.usedAbilities?.includes(index)) return;
      if (ability.onceOnly && perm.usedOnce?.includes(index)) return;
      if (ability.yourTurnOnly && state.active !== player) return;
      if (ability.beforeAttackers && !(state.phase === "main1" || (state.phase === "attackers" && !state.combat))) return;
      if (abilityNeed(state, player, ability)) return;
      if (ability.solvedOnly && !perm.solved) return;
      if (levelLock(perm, ability)) return;
      if (ability.minLife !== undefined && state.players[player].life < ability.minLife) return;
      if (ability.exileFromYard && state.players[player].graveyard.length < ability.exileFromYard) return;
      if (ability.tapTwoSharing && !tapPair(state, player)) return;
      if (forbidden(state, perm, "noActivated")) return;
      if (ability.costCard && costChoices(state, player, ability, perm.card.iid).length === 0) return;
      if (ability.costNamed && !ability.costNamed.put && (perm.named?.[ability.costNamed.name] ?? 0) < ability.costNamed.n) return;
      if (ability.needLands !== undefined && state.players[player].battlefield.filter((p) => getCard(state, p.card.defId).type === "land").length < ability.needLands) return;
      const xCost = ability.mana ? abilityManaCost(state, perm, ability) : null;
      let maxX: number | undefined;
      if (xCost?.x) {
        maxX = 0;
        while (maxX < 30 && payMana(state, player, withX(xCost, maxX + 1), undefined, def).ok) maxX++;
      }
      out.push({ iid: perm.card.iid, index, text: ability.text, specs: bindSpecs(ability.targets, perm.card.iid), ...(maxX !== undefined ? { maxX } : {}), ...(ability.costCard ? { costChoices: costChoices(state, player, ability, perm.card.iid), costLabel: ability.costCard.label } : {}) });
    });
  }
  return out;
}

/**
 * Why an ability of one of the player's permanents can't be used right now, in words for the player (null when it can).
 * It follows the same checks as getActivatable, in the same order, so the list of usable abilities and the reasons for
 * the locked ones never disagree.
 */
export function abilityLockReason(state: GameState, player: PlayerId, perm: Permanent, index: number): string | null {
  const def = getCard(state, perm.card.defId);
  const ability = parseCard(def).activated[index];
  if (!ability || ability.zone) return null;
  if (ability.tap && perm.tapped) return "it is tapped";
  if (ability.tap && isCreature(state, perm) && perm.summoningSick && !kw(state, perm, "haste") && !abilityHaste(state, player)) return "it just arrived (summoning sick)";
  if (ability.mana) {
    const cost = abilityManaCost(state, perm, ability);
    if (!cost || !payMana(state, player, cost, undefined, def).ok) return "not enough mana";
  }
  if (bindSpecs(ability.targets, perm.card.iid).some((spec) => legalTargets(state, spec, player).length === 0)) return "there is nothing it could target right now";
  if (ability.sorceryOnly && !sorceryTiming(state, player)) return "only in your main phase with an empty stack";
  if (ability.oncePerTurn && perm.usedAbilities?.includes(index)) return "already used this turn";
  if (ability.onceOnly && perm.usedOnce?.includes(index)) return "it can only be used once";
  if (ability.yourTurnOnly && state.active !== player) return "only during your turn";
  const needed = abilityNeed(state, player, ability);
  if (needed) return needed;
  if (ability.solvedOnly && !perm.solved) return "the Case isn't solved yet";
  const level = levelLock(perm, ability);
  if (level) return level;
  const life = state.players[player].life;
  if (ability.minLife !== undefined && life < ability.minLife) return `you need at least ${ability.minLife} life (you have ${life})`;
  const yard = state.players[player].graveyard.length;
  if (ability.exileFromYard && yard < ability.exileFromYard) return `it needs ${ability.exileFromYard} cards in your graveyard (you have ${yard})`;
  if (ability.tapTwoSharing && !tapPair(state, player)) return "it needs two untapped creatures that share a creature type";
  if (forbidden(state, perm, "noActivated")) return "something stops its abilities from being used";
  if (ability.costCard && costChoices(state, player, ability, perm.card.iid).length === 0) return `you have nothing to pay it with (${ability.costCard.label})`;
  if (ability.costNamed && !ability.costNamed.put && (perm.named?.[ability.costNamed.name] ?? 0) < ability.costNamed.n) return `it has no ${ability.costNamed.name} counter to remove`;
  if (ability.needLands !== undefined && state.players[player].battlefield.filter((p) => getCard(state, p.card.defId).type === "land").length < ability.needLands) return `it needs ${ability.needLands} lands`;
  return null;
}

/** Does the player have anything to do with priority? If not they are passed automatically. */
export function hasResponse(state: GameState, player: PlayerId): boolean {
  return getCastable(state, player).length > 0 || getActivatable(state, player).length > 0;
}
