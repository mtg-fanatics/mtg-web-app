import type { GameEvent } from "../actions.js";
import { getCard } from "../cards.js";
import {
  bindSpecs,
  cardMatches,
  cardsDiscarded,
  changeLife,
  checkStateBasedActions,
  colorsOfPerm,
  countFor,
  exilePlayable,
  exilePlayTerms,
  findPermanentOrNull,
  forbidden,
  isArtifactDef,
  isCreature,
  isPermanentCard,
  kw,
  newId,
  playerLabel,
  powerOf,
  removeFromBattlefield,
  sacrificePermanent,
  spellCast,
  queueTriggers,
  queueWard,
  shiftTargets,
  subtypesOf,
  tapPerm,
  toughnessOf,
} from "../core.js";
import type { CardFilter, Effect, TargetChoice, TargetSpec } from "../effects.js";
import { addCosts, COLOR_NAMES, withConvoke, hasteFrom, manaCostOf, parseManaCost, payForAbility, payMana, withDelve, withPhyrexianLife, withX } from "../mana.js";
import { parseCard } from "../oracle.js";
import { OPPONENT } from "../types.js";
import type { CardDef, CardInstance, GameState, Permanent, PlayerId } from "../types.js";
import type { ManaCost } from "../mana.js";
import { abilityHaste, abilityManaCost, abilityNeed, applyPayment, canCastNow, checkTargets, holdsPriority, inSorceryWindow, levelLock, openRound, sorceryTiming, timingError } from "./shared.js";

// Casting spells and activating abilities: each puts something on the stack and opens a round of priority.

/**
 * What a card costs to cast right now: the printed cost, less what its own text gives ("costs {1} less if you control a Wizard",
 * "for each spell your opponents have cast this turn") and what the caster's permanents give ("Goblin spells you cast cost {1} less").
 * `targets`: the ones chosen, for "costs {3} less to cast if it targets a tapped permanent" (no discount while they aren't known).
 */
export function castCostOf(state: GameState, player: PlayerId, def: CardDef, targets?: TargetChoice[]): ReturnType<typeof manaCostOf> {
  let base = manaCostOf(def);
  if (!base) return base;
  const alt = parseCard(def).altCostIfCreatures;
  if (alt && Object.values(state.players).reduce((n, pl) => n + pl.battlefield.filter((p) => isCreature(state, p)).length, 0) >= alt.n) base = parseManaCost(alt.cost) ?? base; // Blasphemous Edict
  const me = state.players[player];
  if (me.battlefield.some((p) => parseCard(getCard(state, p.card.defId)).castFree)) return { generic: 0, colored: {} }; // Omniscience
  const flashPay = parseCard(def).flashPay;
  if (flashPay !== undefined && !inSorceryWindow(state, player)) base = { ...base, generic: base.generic + flashPay }; // Harbinger of the Tides cast at instant speed
  const spellTypes = ((def.typeLine ?? "").split("—")[1] ?? "").toLowerCase().split(/\s+/);
  // "The next red or green creature spell you cast this turn can be cast without paying its mana cost."
  if (me.freeNext && def.type === "creature" && (def.colors ?? []).some((c) => me.freeNext!.colors.includes(c))) return { generic: 0, colored: {} };
  let less = 0;
  // "Artifact spells you cast this turn cost {1} less to cast."
  for (const d of me.costLessThisTurn ?? []) if (d.spell === "artifact" && (def.typeLine ?? "").split("—")[0].includes("Artifact")) less += d.n;
  const own = parseCard(def).costReduction;
  if (own) {
    if (own.ifControl && me.battlefield.some((p) => subtypesOf(state, p).includes(own.ifControl!))) less += own.n;
    if (own.ifFlyer && me.battlefield.some((p) => isCreature(state, p) && kw(state, p, "flying"))) less += own.n;
    if (own.perOpponentSpell) less += own.n * (state.players[OPPONENT[player]].spellsCastThisTurn ?? 0);
    if (own.per) less += own.n * countFor(state, player, own.per);
    if (own.ifLifeGained !== undefined && (me.lifeGainedThisTurn ?? 0) >= own.ifLifeGained) less += own.n;
    if (own.ifYardCreatures !== undefined && me.graveyard.filter((c) => getCard(state, c.defId).type === "creature").length >= own.ifYardCreatures) less += own.n;
    if (own.ifTargetsAttacking && targets?.some((t) => t.kind === "permanent" && state.combat?.attackers.some((a) => a.attacker === t.iid))) less += own.n;
    if (own.ifTargetsTapped && targets?.some((t) => t.kind === "permanent" && findPermanentOrNull(state, t.iid)?.perm.tapped)) less += own.n;
    if (own.ifTargetsColor && targets?.some((t) => t.kind === "stack" && targetedSpellColors(state, t.id).includes(own.ifTargetsColor!))) less += own.n;
  }
  for (const perm of me.battlefield) {
    for (const mod of parseCard(getCard(state, perm.card.defId)).costMods ?? []) {
      if (mod.subtype && !(def.type === "creature" && spellTypes.includes(mod.subtype))) continue;
      if (mod.subtypes && !(def.type === "creature" && mod.subtypes.some((t) => spellTypes.includes(t)))) continue;
      if (mod.minMV !== undefined && def.cost < mod.minMV) continue;
      if (mod.otherTurn && state.active === player) continue;
      if (mod.instantSorceryOnly && def.type !== "instant" && def.type !== "sorcery") continue;
      less += mod.nFromPower ? Math.max(0, powerOf(state, perm)) : mod.n;
    }
  }
  // Affinity: {1} less for each artifact (land, creature of that type) you control.
  const affinity = parseCard(def).affinity;
  if (affinity) {
    const word = affinity === "artifacts" ? "artifact" : affinity;
    less += me.battlefield.filter((p) => (word === "artifact" ? isArtifactDef(getCard(state, p.card.defId)) : word === "lands" ? getCard(state, p.card.defId).type === "land" : subtypesOf(state, p).some((t) => t === word || `${t}s` === word))).length;
  }
  const cost = less > 0 ? { ...base, generic: Math.max(0, base.generic - less) } : base;
  // "White spells you cast cost {W} more to cast": one more colored mana for each such permanent you control.
  let taxed = cost;
  for (const perm of me.battlefield) {
    for (const tax of parseCard(getCard(state, perm.card.defId)).spellTax ?? []) {
      if (!(def.colors ?? []).includes(tax.color)) continue;
      const colored = { ...taxed.colored } as Record<string, number>;
      colored[tax.extra] = (colored[tax.extra] ?? 0) + 1;
      taxed = { ...taxed, colored };
    }
  }
  return taxed;
}

const targetedSpellColors = (state: GameState, id: string): string[] => {
  const item = state.stack.find((i) => i.id === id);
  return item?.kind === "spell" ? (getCard(state, item.card.defId).colors ?? []) : [];
};

/**
 * Replicate: a copy of the spell for each payment, on the stack above it, each with its own targets. Storm: `copies` copies with the spell's targets.
 * Copies aren't cast, so nothing triggers on them.
 */
function pushCopies(state: GameState, player: PlayerId, card: CardInstance, effects: Effect[], specs: TargetSpec[], copyTargets: TargetChoice[], events: GameEvent[], why: "replicate" | "storm", x = 0, copies = specs.length > 0 ? copyTargets.length / specs.length : 0): void {
  for (let i = 0; i < copies; i++) {
    const targets = why === "storm" ? copyTargets : copyTargets.slice(i * specs.length, (i + 1) * specs.length);
    state.stack.push({ kind: "spell", id: newId(state), controller: player, card: { ...card, iid: `copy${state.nextId++}` }, effects, targets, specs, x, copy: true });
    queueWard(state, state.stack[state.stack.length - 1]);
  }
  if (copies > 0) events.push({ type: "effect", text: `${getCard(state, card.defId).name} is copied ${copies === 1 ? "once" : `${copies} times`} (${why}).` });
}

/** Harmonize: untapped creatures that could be tapped to pay {X} of the cost, X being the creature's power. */
export const harmonizers = (state: GameState, player: PlayerId) => state.players[player].battlefield.filter((p) => !p.tapped && isCreature(state, p) && powerOf(state, p) > 0);

/** Targets with the limit that teamwork waives taken off ("exile target creature with mana value 3 or less. If cast using teamwork, instead exile target creature"). */
export const liftedSpecs = (specs: TargetSpec[]): TargetSpec[] => specs.map((s) => (s.liftedWhenKicked ? { ...s, mv: undefined, power: undefined, toughness: undefined, liftedWhenKicked: undefined } : s));

/**
 * Delve when the player didn't choose: as many graveyard cards as can pay for the generic mana (`generic`), saving the mana.
 * Lands go first, then other spells, creatures last.
 */
export function delveChoice(state: GameState, player: PlayerId, spellIid: string, generic: number): string[] {
  const rank = (c: CardInstance) => ({ land: 0, creature: 2 })[getCard(state, c.defId).type as string] ?? 1;
  return state.players[player].graveyard.filter((c) => c.iid !== spellIid).sort((a, b) => rank(a) - rank(b)).slice(0, generic).map((c) => c.iid);
}

/** Untapped creatures that could be tapped to pay convoke (summoning-sick ones too: it is not a {T} cost). */
export const convokePool = (state: GameState, player: PlayerId): Permanent[] => state.players[player].battlefield.filter((p) => !p.tapped && isCreature(state, p));

/** Untapped creatures that could be tapped to pay teamwork (summoning-sick ones too: it is not a {T} cost). */
export const teamworkers = (state: GameState, player: PlayerId) => state.players[player].battlefield.filter((p) => !p.tapped && isCreature(state, p));

export function castSpell(state: GameState, player: PlayerId, iid: string, targets: TargetChoice[], events: GameEvent[], x = 0, kicked = false, from: "hand" | "graveyard" | "exile" | "prepared" | "library" = "hand", modes?: number[], sacrifice?: string, warp = false, teamwork?: string[], phyrexianLife = 0, delve?: string[], replicate = 0, adventure = false, harmonizeTap?: string, convoke?: string[]): string | null {
  const me = state.players[player];
  // A prepared creature: a copy of its spell is cast (`iid` is the creature).
  const prepared = from === "prepared" ? me.battlefield.find((p) => p.card.iid === iid && p.prepared) : undefined;
  const zone = from === "graveyard" ? me.graveyard : from === "exile" ? me.exile : from === "prepared" ? (prepared ? [{ iid, defId: prepared.prepared!, owner: player }] : []) : from === "library" ? me.library.slice(0, 1) : me.hand;
  const idx = zone.findIndex((c) => c.iid === iid);
  if (from === "library" && !(idx === 0 && getCard(state, zone[0].defId).type === "creature" && me.battlefield.some((p) => parseCard(getCard(state, p.card.defId)).castCreaturesFromTop))) return "You can only cast the top creature card of your library with Vizier of the Menagerie.";
  if (idx < 0) return from === "graveyard" ? "That card is not in your graveyard." : from === "exile" ? "That card is not in exile." : from === "prepared" ? "That creature isn't prepared." : "That card is not in your hand.";
  if (from === "exile" && !exilePlayable(state, player).some((c) => c.iid === iid)) return "You can't play that exiled card right now: attack with the creature that exiled it first.";
  // An Adventure card: its Adventure spell is cast instead of the creature (from the hand only).
  const whole = getCard(state, zone[idx].defId);
  const adventureDef = adventure ? parseCard(whole).adventure : undefined;
  if (adventure && (!adventureDef || from !== "hand")) return `${whole.name} has no Adventure to cast${adventureDef ? " from there" : ""}.`;
  const def = adventureDef ?? whole;
  if (def.type === "land") return "Lands are played, not cast.";
  if (!isPermanentCard(def) && def.type !== "instant" && def.type !== "sorcery") return `${def.name} can't be cast yet.`;
  const parsed = parseCard(def);
  let cost = castCostOf(state, player, def, targets);
  // A creature card that may be cast from the graveyard this turn (Case of the Uneaten Feast) costs what it always does.
  const wurmCounters = parsed.graveyardCastCounters ?? 0;
  const wurm = from === "graveyard" && def.type === "creature" && wurmCounters > 0 && creatureCounters(state, player).reduce((n, p) => n + (p.counters ?? 0), 0) >= wurmCounters;
  const fromYard = from === "graveyard" && def.type === "creature" && ((me.yardCastable ?? []).includes(iid) || wurm);
  if (from === "graveyard" && !fromYard) {
    // Flashback (or harmonize): only instants and sorceries, for that cost instead of the mana cost.
    const alternative = parsed.flashback ?? parsed.harmonize ?? ((me.grantedFlashback ?? []).includes(iid) ? def.manaCost : undefined);
    if (!alternative || (def.type !== "instant" && def.type !== "sorcery")) return `${def.name} doesn't have flashback.`;
    cost = parseManaCost(alternative);
  }
  if (warp) {
    // Warp: from the hand only, for the warp cost; the permanent is exiled at the beginning of the next end step.
    if (!parsed.warp || from !== "hand") return `${def.name} can't be cast for a warp cost${parsed.warp ? " from there" : ""}.`;
    cost = parseManaCost(parsed.warp);
  }
  if (!parsed.ok || !cost) return `${def.name} can't be played yet.`;
  // Harmonize: an untapped creature you control is tapped to pay {X} of the cost, X being its power.
  const harmonizer = harmonizeTap ? harmonizers(state, player).find((p) => p.card.iid === harmonizeTap) : undefined;
  if (harmonizeTap && (from !== "graveyard" || !parsed.harmonize || parsed.flashback)) return `${def.name} isn't being cast with harmonize.`;
  if (harmonizeTap && !harmonizer) return `${def.name}: harmonize taps an untapped creature you control with power 1 or more.`;
  if (harmonizer) cost = { ...cost, generic: Math.max(0, cost.generic - powerOf(state, harmonizer)) };
  if (from === "exile") {
    const terms = exilePlayTerms(state, player, iid);
    if (terms.sorcery && !sorceryTiming(state, player)) return `${def.name} was plotted: it can only be cast as a sorcery, in your main phase with nothing on the stack.`;
    // airbend: {2} rather than the mana cost; otherwise "each spell cast this way costs {1} more"
    cost = terms.payGeneric !== undefined ? (parseManaCost(`{${terms.payGeneric}}`) ?? cost) : { ...cost, generic: cost.generic + terms.tax };
  }
  if (!canCastNow(state, player, def)) return timingError(state, def);

  // Teamwork: "you may tap any number of creatures you control with total power N or more". Doing so counts as kicking the spell.
  let teamed: Permanent[] = [];
  if (teamwork && teamwork.length > 0) {
    if (parsed.teamwork === undefined) return `${def.name} has no teamwork.`;
    const ids = [...new Set(teamwork)];
    const picked = ids.map((id) => me.battlefield.find((p) => p.card.iid === id));
    if (picked.some((p) => !p || p.tapped || !isCreature(state, p))) return `${def.name}: teamwork taps untapped creatures you control.`;
    const power = picked.reduce((n, p) => n + Math.max(0, powerOf(state, p!)), 0);
    if (power < parsed.teamwork) return `${def.name}: teamwork ${parsed.teamwork} needs creatures with total power ${parsed.teamwork} or more (the ones chosen have ${power}).`;
    teamed = picked as Permanent[];
  }
  const wasKicked = kicked || teamed.length > 0;
  let specs = parsed.spell?.targets ?? [];
  let effects = parsed.spell?.effects ?? [];
  const modal = parsed.spell?.modal;
  if (teamed.length > 0) specs = liftedSpecs(specs);
  if (modal) {
    // "Choose one —": the effects and targets are those of the chosen mode(s), in printed order.
    const chosen = [...new Set(modes ?? [])].sort((a, b) => a - b);
    const most = modal.bothIfKicked && teamed.length > 0 ? 2 : modal.max;
    if (chosen.length < modal.min || chosen.length > most || chosen.some((m) => !modal.modes[m])) {
      return `${def.name}: choose ${most === 1 ? "one mode" : "one or both modes"}.`;
    }
    specs = [];
    effects = [];
    for (const m of chosen) {
      effects.push(...shiftTargets(modal.modes[m].effects, specs.length));
      specs.push(...modal.modes[m].targets);
    }
  } else if (modes && modes.length > 0) {
    return `${def.name} has no modes.`;
  }
  // Replicate: each copy has targets of its own, chosen after the spell's.
  if (!Number.isInteger(replicate) || replicate < 0 || (replicate > 0 && !parsed.replicate)) return `${def.name} has no replicate.`;
  const copySpecs = Array.from({ length: replicate }, () => specs).flat();
  const targetError = checkTargets(state, [...specs, ...copySpecs], targets, player, def.name);
  if (targetError) return targetError;

  if (!Number.isInteger(x) || x < 0) return "X must be a whole number, 0 or more.";
  if (!cost.x && x > 0) return `${def.name} has no X in its cost.`;
  const kickerCost = parsed.kicker ? parseManaCost(parsed.kicker) : null;
  if (kicked && !kickerCost && !parsed.blight) return `${def.name} has no kicker.`;
  // "As an additional cost to cast this spell, you may blight 1": paid (as `kicked`) with -1/-1 counters on a creature you control (`sacrifice`).
  const blighted = parsed.blight && kicked ? (sacrifice ? findPermanentOrNull(state, sacrifice) : null) : null;
  if (parsed.blight && kicked && (!blighted || blighted.owner.id !== player || !isCreature(state, blighted.perm))) return `${def.name}: choose a creature you control to blight.`;
  // "As an additional cost to cast this, sacrifice a creature." / "...sacrifice a creature or pay {3}{B}" ("pay") / "...discard a card" (`sacrifice` is the card)
  let sacrificed: ReturnType<typeof findPermanentOrNull> = null;
  const payInstead = parsed.extraSacrificeOrPay !== undefined && sacrifice === "pay" ? parseManaCost(parsed.extraSacrificeOrPay) : null;
  // "Flashback—Sacrifice a Mountain"
  const flashbackSac = from === "graveyard" && !fromYard ? parsed.flashbackSacrifice : undefined;
  if (flashbackSac) {
    sacrificed = sacrifice ? findPermanentOrNull(state, sacrifice) : null;
    if (!sacrificed || sacrificed.owner.id !== player || !subtypesOf(state, sacrificed.perm).includes(flashbackSac)) return `${def.name}: choose a ${flashbackSac} you control to sacrifice (its flashback cost).`;
  } else if (parsed.extraDiscard) {
    if (!sacrifice || sacrifice === iid || !me.hand.some((c) => c.iid === sacrifice)) return `${def.name}: choose a card to discard (an additional cost).`;
  } else if (parsed.extraSacrifice || (parsed.extraSacrificeOrPay !== undefined && !payInstead)) {
    sacrificed = sacrifice ? findPermanentOrNull(state, sacrifice) : null;
    const typed = parsed.extraSacrificeType;
    const what = typed ?? (parsed.extraSacrificeOrArtifact ? "artifact or creature" : "creature");
    if (!sacrificed || sacrificed.owner.id !== player || !extraSacrificeFits(state, parsed, sacrificed.perm)) return `${def.name}: choose a${/^[aeiou]/.test(what) ? "n" : ""} ${what} you control to sacrifice${parsed.extraSacrificeOrPay ? `, or pay ${parsed.extraSacrificeOrPay}` : ""}.`;
  } else if (sacrifice && !payInstead && !blighted) {
    return `${def.name} has no sacrifice cost.`;
  }
  // "Spells your opponents cast that target this cost {2} more to cast."
  let tax = 0;
  for (const t of targets) {
    const hit = t.kind === "permanent" ? findPermanentOrNull(state, t.iid) : null;
    if (hit && hit.owner.id !== player) tax += parseCard(getCard(state, hit.perm.card.defId)).targetTax ?? 0;
  }
  const taxed = tax > 0 ? { ...cost, generic: cost.generic + tax } : cost;
  const replicateCosts = replicate > 0 ? Array.from({ length: replicate }, () => parseManaCost(parsed.replicate!)) : [];
  // Waterbend: artifacts and creatures tapped to pay for part of it, each one {1}
  const bent = kicked && kickerCost && parsed.kickerName === "waterbend" ? waterbendTaps(state, player, withX(taxed, x), kickerCost, def) : [];
  if (bent === null) return `Not enough mana: ${def.name} costs ${def.manaCost} + waterbend ${parsed.kicker}, even tapping your artifacts and creatures.`;
  const kickerPaid = kickerCost && bent.length > 0 ? { ...kickerCost, generic: kickerCost.generic - bent.length } : kickerCost;
  const extra = [kicked ? kickerPaid : null, payInstead, ...replicateCosts].filter((c): c is NonNullable<typeof c> => c !== null);
  const full = withPhyrexianLife(withX(extra.reduce(addCosts, taxed), x), phyrexianLife);
  if (!full) return `${def.name} doesn't have that many Phyrexian mana symbols to pay with life.`;
  const delved = parsed.delve ? (delve ? [...new Set(delve)] : delveChoice(state, player, iid, full.generic)) : [];
  if (delve && delve.length > 0 && !parsed.delve) return `${def.name} doesn't have delve.`;
  if (delved.length > full.generic) return `${def.name}: delve can only pay for the generic mana in its cost ({${full.generic}}).`;
  if (delved.some((id) => id === iid || !me.graveyard.some((c) => c.iid === id))) return `${def.name}: delve exiles cards from your graveyard.`;
  // Convoke: untapped creatures you control, each paying for {1} or a mana of one of its colors.
  let convoked: Permanent[] = [];
  if (convoke && convoke.length > 0 && !parsed.convoke) return `${def.name} doesn't have convoke.`;
  if (parsed.convoke) {
    const pool = convokePool(state, player);
    const rest = withDelve(full, delved.length);
    const colorsOf = (list: Permanent[]) => list.map((p) => ({ colors: colorsOfPerm(state, p) }));
    if (convoke) {
      const chosen = [...new Set(convoke)].map((id) => pool.find((p) => p.card.iid === id));
      if (chosen.some((p) => !p)) return `${def.name}: convoke taps untapped creatures you control.`;
      convoked = chosen as Permanent[];
    } else if (!payMana(state, player, rest, def).ok) {
      // not told which: tap as many as it takes
      for (const p of pool) {
        convoked.push(p);
        if (payMana(state, player, withConvoke(rest, colorsOf(convoked)), def).ok) break;
      }
    }
  }
  for (const p of [...teamed, ...(harmonizer ? [harmonizer] : []), ...bent, ...convoked]) tapPerm(state, p, player); // paid as part of the cost, before the mana (they can't also be tapped for mana)
  const paid = payMana(state, player, withConvoke(withDelve(full, delved.length), convoked.map((p) => ({ colors: colorsOfPerm(state, p) }))), def);
  if (!paid.ok) {
    const price = warp ? `warp ${parsed.warp}` : from === "graveyard" && !fromYard ? (parsed.flashback ? `flashback ${flashbackSac ? `(sacrifice a ${flashbackSac})` : parsed.flashback}` : `harmonize ${parsed.harmonize}`) : (cost.x ? `${def.manaCost} with X = ${x}` : (def.manaCost ?? String(def.cost))) + (kicked ? ` + kicker ${parsed.kicker}` : "") + (payInstead ? ` + ${parsed.extraSacrificeOrPay}` : "");
    return paid.missing === "life"
      ? `Not enough life to pay for ${def.name} (${price}).`
      : paid.missing === "generic"
        ? `Not enough mana: ${def.name} costs ${price}.`
        : `Not enough ${COLOR_NAMES[paid.missing]} mana: ${def.name} costs ${price}.`;
  }
  applyPayment(state, player, paid, events);
  // "Deals damage equal to the sacrificed creature's power": its power is remembered as the spell's X.
  const sacrificedPower = sacrificed && !flashbackSac ? Math.max(0, powerOf(state, sacrificed.perm)) : undefined;
  if (sacrificed) {
    sacrificePermanent(state, sacrificed.perm, player, events); // paid as part of the cost
    checkStateBasedActions(state, events); // an Aura on the sacrificed creature falls off right away
  }

  if (blighted) {
    blighted.perm.minusCounters = (blighted.perm.minusCounters ?? 0) + parsed.blight!;
    events.push({ type: "effect", text: `${def.name}: ${getCard(state, blighted.perm.card.defId).name} gets ${parsed.blight === 1 ? "a -1/-1 counter" : `${parsed.blight} -1/-1 counters`} (blight).` });
    checkStateBasedActions(state, events);
  }
  if (fromYard && wurm && !(me.yardCastable ?? []).includes(iid)) {
    // remove the counters, the most loaded creatures first
    let toRemove = wurmCounters;
    for (const p of creatureCounters(state, player)) {
      const take = Math.min(toRemove, p.counters ?? 0);
      p.counters = (p.counters ?? 0) - take;
      toRemove -= take;
      if (toRemove === 0) break;
    }
  }
  if (fromYard) me.yardCastable = (me.yardCastable ?? []).filter((id) => id !== iid);
  if (me.freeNext && def.type === "creature" && (def.colors ?? []).some((c) => me.freeNext!.colors.includes(c))) me.freeNext = undefined; // used up
  const [taken] = zone.splice(idx, 1);
  if (from === "library") me.library.shift();
  if (delved.length > 0) {
    me.exile.push(...me.graveyard.filter((c) => delved.includes(c.iid)));
    me.graveyard = me.graveyard.filter((c) => !delved.includes(c.iid));
    events.push({ type: "effect", text: `${def.name}: delve exiled ${delved.length} card${delved.length === 1 ? "" : "s"} from the graveyard to pay for it.` });
  }
  if (parsed.extraDiscard && sacrifice) {
    me.graveyard.push(me.hand.splice(me.hand.findIndex((c) => c.iid === sacrifice), 1)[0]);
    cardsDiscarded(state, player, [sacrifice], events);
  }
  // Mana from Carnelian Orb of Dragonkind spent on a Dragon creature spell: it gains haste.
  const haste = paid.tap.some((src) => hasteFrom(state, src, def));
  if (from === "exile") me.mayPlay = (me.mayPlay ?? []).filter((e) => e.iid !== iid);
  if (prepared) prepared.prepared = undefined; // casting the copy unprepares it
  if (adventureDef) state.cards[adventureDef.id] ??= adventureDef; // on the stack it is only its Adventure (it goes back to being the whole card as it leaves)
  const card = prepared ? { ...taken, iid: `copy${state.nextId++}` } : adventureDef ? { ...taken, defId: adventureDef.id } : taken;
  const manaSpent = paid.made.length;
  for (const p of teamed) queueTriggers(state, p.card, player, "teamworkTap");
  const own = targets.slice(0, specs.length);
  const spellX = cost.x ? x : (sacrificedPower ?? x);
  state.stack.push({ kind: "spell", id: newId(state), controller: player, card, effects, targets: own, specs, x: spellX, manaSpent, ...(wasKicked ? { kicked: true } : {}), ...(haste ? { haste } : {}), ...(from === "graveyard" && !fromYard ? { flashback: true } : {}), ...(prepared ? { copy: true } : {}), ...(warp ? { warped: true } : {}), ...(adventureDef ? { adventure: true } : {}) });
  events.push(
    def.type === "creature"
      ? { type: "creatureCast", player, iid: card.iid, tapped: paid.tap }
      : { type: "spellCast", player, iid: card.iid, tapped: paid.tap, targets: own, ...(prepared ? { copyOf: card.defId } : {}) },
  );
  if (kicked && parsed.kickerName === "waterbend") events.push({ type: "effect", text: waterbendPaid(state, player, def, parsed.kicker!, bent) });
  queueWard(state, state.stack[state.stack.length - 1]);
  pushCopies(state, player, card, effects, specs, targets.slice(specs.length), events, "replicate");
  // Storm (Ral's emblem): a copy for each spell cast before it this turn, by either player.
  const castBefore = (state.players.p1.spellsCastThisTurn ?? 0) + (state.players.p2.spellsCastThisTurn ?? 0);
  if ((me.stormEmblem || parsed.storm) && (def.type === "instant" || def.type === "sorcery")) pushCopies(state, player, card, effects, specs, own, events, "storm", spellX, castBefore);
  if (def.type === "instant" || def.type === "sorcery") {
    // Thousand-Year Storm: a copy for each other instant and sorcery spell you cast before it this turn
    if (me.battlefield.some((p) => parseCard(getCard(state, p.card.defId)).copyPerSpell)) pushCopies(state, player, card, effects, specs, own, events, "storm", spellX, me.instSorcCastThisTurn ?? 0);
    // Teach by Example: the next one is copied
    if (me.copyNextSpell) {
      me.copyNextSpell = undefined;
      pushCopies(state, player, card, effects, specs, own, events, "storm", spellX, 1);
    }
    // Pyromancer's Goggles: mana from it paid for a red instant or sorcery
    if ((def.colors ?? []).includes("R") && paid.tap.some((src) => me.battlefield.some((p) => p.card.iid === src && parseCard(getCard(state, p.card.defId)).copyRedSpellMana))) pushCopies(state, player, card, effects, specs, own, events, "storm", spellX, 1);
    me.instSorcCastThisTurn = (me.instSorcCastThisTurn ?? 0) + 1;
  }
  // Cascade: when it is cast, a trigger above it exiles cards until a cheaper spell turns up.
  for (let n = 0; n < (parsed.cascade ?? 0); n++) {
    state.triggerQueue.push({ specs: [], item: { kind: "ability", id: newId(state), controller: player, source: card.iid, sourceName: def.name, effects: [{ type: "cascade", mv: def.cost }], targets: [], specs: [], text: `Cascade: exile cards from the top of your library until you exile a nonland card that costs less than ${def.cost}. You may cast it without paying its mana cost.` } });
  }
  spellCast(state, player, def, targets, manaSpent, wasKicked);
  openRound(state, OPPONENT[player]);
  return null;
}

/** Quilled Greatwurm: +1/+1 counters spread over the creatures you control (the most loaded first). */
export const creatureCounters = (state: GameState, player: PlayerId): Permanent[] => state.players[player].battlefield.filter((p) => isCreature(state, p) && (p.counters ?? 0) > 0).sort((a, b) => (b.counters ?? 0) - (a.counters ?? 0));

/** Untapped creatures you control of a creature type, other than one permanent ("Tap ten untapped Elves you control"). */
export function untappedOf(state: GameState, player: PlayerId, subtype: string, except: string): Permanent[] {
  return state.players[player].battlefield.filter((p) => p.card.iid !== except && !p.tapped && isCreature(state, p) && subtypesOf(state, p).includes(subtype));
}

/** Two untapped creatures you control that share a creature type (to pay "Tap two untapped creatures that share a creature type"). */
export function tapPair(state: GameState, player: PlayerId): [Permanent, Permanent] | null {
  const mine = state.players[player].battlefield.filter((p) => isCreature(state, p) && !p.tapped);
  const types = (p: Permanent) => subtypesOf(state, p);
  for (let i = 0; i < mine.length; i++) {
    for (let j = i + 1; j < mine.length; j++) if (types(mine[i]).some((t) => types(mine[j]).includes(t))) return [mine[i], mine[j]];
  }
  return null;
}

/** "Player 1 paid waterbend {4} for Ruinous Waterbending: tapped Witch's Oven and Witch's Oven ({1} each) and {2} of mana." */
function waterbendPaid(state: GameState, player: PlayerId, def: CardDef, kicker: string, bent: Permanent[]): string {
  const paid = `${playerLabel(player)} paid waterbend ${kicker} for ${def.name}`;
  if (bent.length === 0) return `${paid} with mana.`;
  const names = bent.map((p) => getCard(state, p.card.defId).name);
  const tapped = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const rest = (parseManaCost(kicker)?.generic ?? 0) - bent.length;
  return `${paid}: tapped ${tapped} ({1} each)${rest > 0 ? ` and {${rest}} of mana` : ""}.`;
}

/**
 * Waterbend: "while paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}."
 * The ones it costs nothing to tap go first (artifacts that aren't creatures, creatures that couldn't attack this turn anyway);
 * then mana; then, only if the mana runs short, creatures that could still attack. Null when it can't be paid at all.
 */
export function waterbendTaps(state: GameState, player: PlayerId, base: ManaCost, kicker: ManaCost, def: CardDef): Permanent[] | null {
  const me = state.players[player];
  const couldAttack = state.active === player && state.phase === "main1";
  const rank = (p: Permanent) => (!isCreature(state, p) ? 0 : p.summoningSick || !couldAttack ? 1 : 2);
  const pool = me.battlefield
    .filter((p) => !p.tapped && getCard(state, p.card.defId).type !== "land" && (isCreature(state, p) || isArtifactDef(getCard(state, p.card.defId))))
    .sort((a, b) => rank(a) - rank(b));
  const taps = pool.filter((p) => rank(p) < 2).slice(0, kicker.generic);
  const payable = () => {
    // (a Treasure tapped to waterbend can't also be sacrificed for mana)
    taps.forEach((p) => (p.tapped = true));
    const ok = payMana(state, player, addCosts(base, { ...kicker, generic: kicker.generic - taps.length }), def).ok;
    taps.forEach((p) => (p.tapped = false));
    return ok;
  };
  for (const p of pool.filter((p) => rank(p) === 2)) {
    if (taps.length >= kicker.generic || payable()) break;
    taps.push(p);
  }
  return payable() ? taps : null;
}

/** "As an additional cost to cast this spell, sacrifice a creature" (or "a Goblin", or "an artifact or creature"): can this permanent pay it? */
export function extraSacrificeFits(state: GameState, parsed: { extraSacrificeType?: string; extraSacrificeOrArtifact?: boolean }, perm: Permanent): boolean {
  const kind = isCreature(state, perm) || (parsed.extraSacrificeOrArtifact === true && isArtifactDef(getCard(state, perm.card.defId)));
  return kind && (!parsed.extraSacrificeType || subtypesOf(state, perm).includes(parsed.extraSacrificeType));
}

/** The cards that could pay a "discard a card" / "sacrifice a creature" cost. */
export function costChoices(state: GameState, player: PlayerId, ability: { costCard?: { kind: "discard" | "sacrifice" | "sacArtifactOrDiscardNonland"; filter?: CardFilter; other?: boolean } }, sourceIid: string): string[] {
  const cost = ability.costCard;
  if (!cost) return [];
  const me = state.players[player];
  if (cost.kind === "discard") return me.hand.filter((c) => c.iid !== sourceIid).map((c) => c.iid);
  if (cost.kind === "sacArtifactOrDiscardNonland") {
    return [
      ...me.battlefield.filter((p) => isArtifactDef(getCard(state, p.card.defId))).map((p) => p.card.iid),
      ...me.hand.filter((c) => c.iid !== sourceIid && getCard(state, c.defId).type !== "land").map((c) => c.iid),
    ];
  }
  return me.battlefield
    .filter((p) => !(cost.other && p.card.iid === sourceIid))
    .filter((p) => {
      const def = getCard(state, p.card.defId);
      const f = cost.filter;
      // a creature type or basic land type is matched against the type line; a card type against the card
      return !f || f.all || cardMatches(def, f) || (f.types?.includes("creature") === true && isCreature(state, p));
    })
    .map((p) => p.card.iid);
}

export function activateAbility(state: GameState, player: PlayerId, iid: string, index: number, targets: TargetChoice[], events: GameEvent[], payWith?: string, chosenX?: number, phyrexianLife = 0): string | null {
  const onBoard = findPermanentOrNull(state, iid);
  // A card in the hand or graveyard can have an ability that works from there.
  const zoneCard = onBoard ? undefined : [...state.players[player].hand, ...state.players[player].graveyard].find((c) => c.iid === iid);
  if ((!onBoard || onBoard.owner.id !== player) && !zoneCard) return "You can only use abilities of your own permanents.";
  const cardDefId = onBoard ? onBoard.perm.card.defId : zoneCard!.defId;
  const def = getCard(state, cardDefId);
  const ability = parseCard(def).activated[index];
  if (!ability) return `${def.name} has no such ability.`;
  if (zoneCard) {
    const inHand = state.players[player].hand.some((c) => c.iid === iid);
    if (ability.zone !== (inHand ? "hand" : "graveyard")) return `${def.name}'s ability can't be used from there.`;
  } else if (ability.zone) {
    return `${def.name}'s ability only works from your ${ability.zone}.`;
  }
  // (a card that isn't on the battlefield has no permanent: stand in a blank one for the checks below)
  const found = onBoard ?? { perm: { card: zoneCard!, tapped: false, summoningSick: false, damage: 0 } as Permanent, owner: state.players[player] };
  if (!holdsPriority(state, player)) return "You can only do that when you have priority.";
  if (ability.sorceryOnly && !sorceryTiming(state, player)) return `${def.name}'s ability can only be activated as a sorcery: in your main phase with nothing on the stack.`;
  if (ability.oncePerTurn && found.perm.usedAbilities?.includes(index)) return `${def.name}'s ability can only be activated once each turn.`;
  if (ability.onceOnly && found.perm.usedOnce?.includes(index)) return `${def.name}'s ability can only be activated once.`;
  if (ability.yourTurnOnly && state.active !== player) return `${def.name}'s ability can only be activated during your turn.`;
  if (ability.beforeAttackers && !(state.phase === "main1" || (state.phase === "attackers" && !state.combat))) return `${def.name}'s ability can only be activated during your turn, before attackers are declared.`;
  const needed = abilityNeed(state, player, ability);
  if (needed) return `${def.name}'s ability can't be used: ${needed}.`;
  if (ability.solvedOnly && !found.perm.solved) return `${def.name} isn't solved yet.`;
  const level = levelLock(found.perm, ability);
  if (level) return `${def.name}'s ability can't be used: ${level}.`;
  if (ability.minLife !== undefined && state.players[player].life < ability.minLife) return `${def.name}'s ability needs you to have at least ${ability.minLife} life.`;
  if (forbidden(state, found.perm, "noActivated")) return `${def.name}'s abilities can't be activated.`;

  if (ability.tap) {
    if (found.perm.tapped) return `${def.name} is tapped.`;
    if (isCreature(state, found.perm) && found.perm.summoningSick && !kw(state, found.perm, "haste") && !abilityHaste(state, player)) {
      return `${def.name} just arrived and can't use an ability that taps it.`;
    }
  }
  const abilitySpecs = bindSpecs(ability.targets, iid);
  const targetError = checkTargets(state, abilitySpecs, targets, player, def.name);
  if (targetError) return targetError;

  let paidX: number | undefined;
  if (ability.mana) {
    const cost = abilityManaCost(state, found.perm, ability);
    if (!cost) return `${def.name}'s ability can't be used yet.`;
    // "{X}{R}, {T}, Sacrifice ~: It deals X damage": the player chooses X, and pays that much more.
    const x = cost.x ? Math.max(0, Math.floor(chosenX ?? 0)) : 0;
    const full = withPhyrexianLife(cost.x ? withX(cost, x) : cost, phyrexianLife);
    if (!full) return `${def.name}'s ability doesn't have that many Phyrexian mana symbols to pay with life.`;
    const paid = payForAbility(state, player, full, def, onBoard ? iid : undefined);
    if (!paid.ok) return `Not enough mana for ${def.name}'s ability (${ability.mana}${cost.x ? ` with X = ${x}` : ""}).`;
    paidX = cost.x ? x : undefined;
    applyPayment(state, player, paid, events);
  }
  let sacToughness: number | undefined;
  if (ability.costCard) {
    if (!payWith || !costChoices(state, player, ability, iid).includes(payWith)) return `${def.name}: choose ${ability.costCard.label}.`;
    if (ability.costCard.kind === "discard" || (ability.costCard.kind === "sacArtifactOrDiscardNonland" && state.players[player].hand.some((c) => c.iid === payWith))) {
      const hand = state.players[player].hand;
      state.players[player].graveyard.push(hand.splice(hand.findIndex((c) => c.iid === payWith), 1)[0]);
      cardsDiscarded(state, player, [payWith], events);
    } else {
      const victim = findPermanentOrNull(state, payWith);
      if (victim) {
        // Witch's Oven: "if the sacrificed creature's toughness was 4 or greater"
        if (isCreature(state, victim.perm)) sacToughness = toughnessOf(state, victim.perm);
        sacrificePermanent(state, victim.perm, player, events); // paid as part of the cost
        checkStateBasedActions(state, events);
      }
    }
  }
  if (ability.tapTwoSharing) {
    const pair = tapPair(state, player);
    if (!pair) return `${def.name}: you need two untapped creatures that share a creature type.`;
    pair.forEach((p) => (p.tapped = true));
  }
  if (ability.tapHost) {
    const host = state.players[player].battlefield.find((p) => p.card.iid === found.perm.attachedTo);
    if (!host || host.tapped || !isCreature(state, host)) return `${def.name}: the equipped creature has to be untapped.`;
    tapPerm(state, host, player);
  }
  if (ability.costCounters) {
    if ((found.perm.counters ?? 0) < ability.costCounters) return `${def.name}: it needs ${ability.costCounters} +1/+1 counters.`;
    found.perm.counters = (found.perm.counters ?? 0) - ability.costCounters;
  }
  if (ability.tapSubtype) {
    const pool = untappedOf(state, player, ability.tapSubtype.subtype, iid);
    if (pool.length < ability.tapSubtype.n) return `${def.name}: you need ${ability.tapSubtype.n} other untapped ${ability.tapSubtype.subtype}s.`;
    pool.slice(0, ability.tapSubtype.n).forEach((p) => (p.tapped = true));
  }
  if (ability.exileFromYard) {
    // "Exile two cards from your graveyard": the oldest ones go.
    const yard = state.players[player].graveyard;
    if (yard.length < ability.exileFromYard) return `${def.name}: you need ${ability.exileFromYard} cards in your graveyard.`;
    state.players[player].exile.push(...yard.splice(0, ability.exileFromYard));
  }
  if (ability.costNamed) {
    const have = found.perm.named?.[ability.costNamed.name] ?? 0;
    if (!ability.costNamed.put && have < ability.costNamed.n) return `${def.name} has no ${ability.costNamed.name} counter to remove.`;
    found.perm.named = { ...found.perm.named, [ability.costNamed.name]: ability.costNamed.put ? have + ability.costNamed.n : have - ability.costNamed.n };
    if (found.perm.named[ability.costNamed.name] === 0) delete found.perm.named[ability.costNamed.name];
    if (ability.costNamed.put) queueTriggers(state, found.perm.card, player, "namedLimit");
  }
  if (ability.payLife) {
    if (state.players[player].life < ability.payLife) return `Not enough life to pay ${ability.payLife}.`;
    changeLife(state, player, -ability.payLife, events);
  }
  if (zoneCard && ability.discardSelf) {
    const hand = state.players[player].hand;
    state.players[player].graveyard.push(hand.splice(hand.findIndex((c) => c.iid === iid), 1)[0]);
    cardsDiscarded(state, player, [iid], events);
  }
  if (zoneCard && ability.exileSelf) {
    const yard = state.players[player].graveyard;
    state.players[player].exile.push(yard.splice(yard.findIndex((c) => c.iid === iid), 1)[0]);
  }
  if (ability.tap) tapPerm(state, found.perm, player);
  // "...or an opponent activates an artifact's ability without {T} in its activation cost" (Powerleech)
  if (!ability.tap && onBoard && isArtifactDef(def)) {
    const against = player === "p1" ? "p2" : "p1";
    for (const watcher of state.players[against].battlefield) queueTriggers(state, watcher.card, against, "oppArtifactAbility");
  }
  if (ability.oncePerTurn) found.perm.usedAbilities = [...(found.perm.usedAbilities ?? []), index];
  if (ability.onceOnly) found.perm.usedOnce = [...(found.perm.usedOnce ?? []), index];
  // "Sacrifice this permanent" is part of the cost: it is gone before the ability goes on the stack.
  const sacrificedPower = ability.sacrifice && onBoard ? Math.max(0, powerOf(state, found.perm)) : undefined;
  if (ability.sacrifice) {
    sacrificePermanent(state, found.perm, player, events);
    if (ability.exileCost) {
      const yard = state.players[found.owner.id].graveyard;
      const at = yard.findIndex((c) => c.iid === iid);
      if (at >= 0) state.players[found.owner.id].exile.push(...yard.splice(at, 1));
    }
    checkStateBasedActions(state, events);
  }

  if (ability.returnSelfCost && onBoard) {
    const back = removeFromBattlefield(state, found.perm, found.owner.id);
    if (back) state.players[back.owner].hand.push(back);
  }

  state.stack.push({
    kind: "ability",
    id: newId(state),
    controller: player,
    source: iid,
    sourceName: def.name,
    effects: ability.effects,
    targets,
    specs: abilitySpecs,
    text: ability.text,
    ...(paidX !== undefined ? { x: paidX } : sacrificedPower !== undefined ? { x: sacrificedPower } : {}),
    ...(sacToughness !== undefined ? { sacToughness } : {}),
  });
  events.push({ type: "abilityActivated", player, iid, name: def.name, text: ability.text, ...(targets.length > 0 ? { targets } : {}) });
  queueWard(state, state.stack[state.stack.length - 1]);
  openRound(state, OPPONENT[player]);
  return null;
}

/** Activates a loyalty ability: loyalty goes up or down as the cost, then the ability goes on the stack. */
export function activateLoyalty(state: GameState, player: PlayerId, iid: string, index: number, targets: TargetChoice[], events: GameEvent[]): string | null {
  const perm = state.players[player].battlefield.find((p) => p.card.iid === iid);
  if (!perm || getCard(state, perm.card.defId).type !== "planeswalker") return "You can only use the loyalty abilities of your own planeswalkers.";
  const def = getCard(state, perm.card.defId);
  const ability = parseCard(def).loyaltyAbilities?.[index];
  if (!ability) return `${def.name} has no such ability.`;
  if (!sorceryTiming(state, player)) return "Loyalty abilities can only be activated in your main phase with an empty stack.";
  if (perm.loyaltyUsed) return `${def.name} already used a loyalty ability this turn.`;
  if (ability.cost < 0 && (perm.loyalty ?? 0) < -ability.cost) return `${def.name} doesn't have enough loyalty (${perm.loyalty ?? 0}).`;
  const targetError = checkTargets(state, ability.targets, targets, player, def.name);
  if (targetError) return targetError;
  perm.loyalty = (perm.loyalty ?? 0) + ability.cost;
  perm.loyaltyUsed = true;
  state.stack.push({ kind: "ability", id: newId(state), controller: player, source: iid, sourceName: def.name, effects: ability.effects, targets, specs: ability.targets, text: ability.text });
  events.push({ type: "abilityActivated", player, iid, name: def.name, text: ability.text, ...(targets.length > 0 ? { targets } : {}) });
  queueWard(state, state.stack[state.stack.length - 1]);
  openRound(state, OPPONENT[player]);
  checkStateBasedActions(state, events); // a walker that paid its last loyalty is gone, but its ability still resolves
  return null;
}

/** Untapped creatures that could crew (any creature you control, summoning-sick ones too). */
export const crewers = (state: GameState, player: PlayerId, vehicle: string) =>
  state.players[player].battlefield.filter((p) => p.card.iid !== vehicle && !p.tapped && isCreature(state, p));

/** Starts crewing: the player now chooses which creatures to tap (see pickCard). */
export function crewVehicle(state: GameState, player: PlayerId, iid: string): string | null {
  if (!holdsPriority(state, player)) return "You can only crew when you have priority.";
  const perm = state.players[player].battlefield.find((p) => p.card.iid === iid);
  if (!perm) return "You can only crew your own Vehicles.";
  const def = getCard(state, perm.card.defId);
  const crew = parseCard(def).crew;
  if (crew === undefined) return `${def.name} can't be crewed.`;
  const options = crewers(state, player, iid);
  if (options.reduce((n, c) => n + Math.max(0, powerOf(state, c)), 0) < crew) return `You don't have enough untapped creatures to crew ${def.name} (total power ${crew} needed).`;
  state.pendingPick = {
    player,
    prompt: `Crew ${crew}: tap creatures with total power ${crew} or more`,
    kind: "crew",
    options: options.map((c) => c.card.iid),
    optional: true,
    owner: player,
    remaining: crew,
    ordered: [],
    vehicle: iid,
    source: { iid, name: def.name, defId: perm.card.defId },
  };
  return null;
}

/** Plot: pay the plot cost and exile the card from your hand. It may be cast without paying its mana cost, as a sorcery, on a later turn. */
export function plotCard(state: GameState, player: PlayerId, iid: string, events: GameEvent[]): string | null {
  if (!sorceryTiming(state, player)) return "You can only plot a card in your main phase with nothing on the stack.";
  const me = state.players[player];
  const idx = me.hand.findIndex((c) => c.iid === iid);
  if (idx < 0) return "That card is not in your hand.";
  const def = getCard(state, me.hand[idx].defId);
  const plot = parseCard(def).plot;
  const cost = plot ? parseManaCost(plot) : null;
  if (!plot || !cost) return `${def.name} can't be plotted.`;
  const paid = payMana(state, player, cost, def);
  if (!paid.ok) return `Not enough mana to plot ${def.name} (${plot}).`;
  applyPayment(state, player, paid, events);
  const [card] = me.hand.splice(idx, 1);
  me.exile.push(card);
  me.mayPlay = [...(me.mayPlay ?? []), { iid, source: "plot", fromTurn: state.turn + 1, payGeneric: 0, sorcery: true }];
  events.push({ type: "effect", text: `${playerLabel(player)} plots ${def.name}: it is exiled face up, and they may cast it without paying its mana cost on a later turn.` });
  return null;
}

/** Cycling: pay the cost and discard the card; the ability to draw a card goes on the stack. */
export function cycleCard(state: GameState, player: PlayerId, iid: string, events: GameEvent[]): string | null {
  if (!holdsPriority(state, player)) return "You can only cycle a card when you have priority.";
  const me = state.players[player];
  const idx = me.hand.findIndex((c) => c.iid === iid);
  if (idx < 0) return "That card is not in your hand.";
  const def = getCard(state, me.hand[idx].defId);
  const parsed = parseCard(def);
  const landcycle = parsed.cycling === undefined && parsed.landcycling !== undefined;
  const cycling = parsed.cycling ?? parsed.landcycling;
  const cost = cycling ? parseManaCost(cycling) : null;
  if (!cycling || !cost) return `${def.name} doesn't have cycling.`;
  const paid = payMana(state, player, cost);
  if (!paid.ok) return `Not enough mana to cycle ${def.name} (${cycling}).`;
  applyPayment(state, player, paid, events);
  const [card] = me.hand.splice(idx, 1);
  me.graveyard.push(card); // discarding is part of the cost
  cardsDiscarded(state, player, [iid], events);
  const landType = parsed.landcyclingType; // "Plainscycling {2}": a Plains card; plain "Basic landcycling": any basic land
  const landName = landType ? `${landType.charAt(0).toUpperCase()}${landType.slice(1)}` : null;
  events.push({ type: "abilityActivated", player, iid, name: def.name, text: landcycle ? (landName ? `${landName}cycling ${cycling}: search for a ${landName} card.` : `Basic landcycling ${cycling}: search for a basic land card.`) : `Cycling ${cycling}: draw a card.` });
  state.stack.push({
    kind: "ability",
    id: newId(state),
    controller: player,
    source: iid,
    sourceName: def.name,
    effects: landcycle ? [landType ? { type: "search", for: "any", to: "hand", reveal: true, filters: [{ basic: true, subtypes: [landType] }], label: `${landName} card` } : { type: "search", for: "basicLand", to: "hand", reveal: true }] : [{ type: "draw", amount: 1, who: { t: "you" } }],
    targets: [],
    specs: [],
    text: landcycle ? (landName ? `${landName}cycling: search for a ${landName} card` : "Basic landcycling: search for a basic land card") : "Cycling: draw a card",
  });
  openRound(state, OPPONENT[player]);
  return null;
}
