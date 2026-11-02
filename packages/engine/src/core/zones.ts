import { getCard } from "../cards.js";
import type { GameEvent } from "../actions.js";
import type { StackItem, TokenSpec } from "../effects.js";
import { parseCard } from "../oracle.js";
import { OPPONENT, type CardDef, type CardInstance, type GameState, type Permanent, type PlayerId } from "../types.js";
import { findPermanentOrNull, isArtifactDef, isCreature, nameOf, newId, powerOf, subtypesOf } from "./permanents.js";
import { creatureEntered, creatureMoved, queueTriggers } from "./triggers.js";

// Life, drawing, counters, and cards leaving the battlefield or the stack.

export function changeLife(state: GameState, player: PlayerId, delta: number, events: GameEvent[]): void {
  if (delta === 0) return;
  // "Players can't gain life."
  if (delta > 0 && Object.values(state.players).some((p) => p.battlefield.some((perm) => parseCard(getCard(state, perm.card.defId)).noLifeGain))) return;
  if (delta > 0) {
    // "If you would gain life, you gain that much life plus 1" / "twice that much": the player's permanents change the amount.
    for (const perm of state.players[player].battlefield) {
      const parsed = parseCard(getCard(state, perm.card.defId));
      if (parsed.lifeGainDouble) delta *= 2;
    }
    for (const perm of state.players[player].battlefield) delta += parseCard(getCard(state, perm.card.defId)).lifeGainPlus ?? 0;
    state.players[player].lifeGainedThisTurn = (state.players[player].lifeGainedThisTurn ?? 0) + delta;
    // "Enchanted creature has 'Whenever you gain life, put that many +1/+1 counters on this creature'" (Light of Promise)
    for (const aura of [...state.players.p1.battlefield, ...state.players.p2.battlefield]) {
      if (!aura.attachedTo || !parseCard(getCard(state, aura.card.defId)).hostGainLifeCounters) continue;
      const host = state.players[player].battlefield.find((p) => p.card.iid === aura.attachedTo);
      if (host) putCounters(state, host, player, delta);
    }
  }
  state.players[player].life += delta;
  if (delta < 0) state.players[player].lifeLostThisTurn = (state.players[player].lifeLostThisTurn ?? 0) - delta;
  events.push(delta > 0 ? { type: "lifeGained", player, amount: delta } : { type: "lifeLost", player, amount: -delta });
  if (delta > 0) onLifeGained(state, player);
}

/** Poison counters: from infect and toxic damage, and from "target opponent gets a poison counter". */
export function addPoison(state: GameState, player: PlayerId, amount: number, events: GameEvent[]): void {
  if (amount <= 0) return;
  state.players[player].poison = (state.players[player].poison ?? 0) + amount;
  events.push({ type: "poisoned", player, amount });
}

/** "Whenever you gain life, ...": the player's permanents with that trigger queue it. */
export function onLifeGained(state: GameState, player: PlayerId): void {
  for (const perm of state.players[player].battlefield) queueTriggers(state, perm.card, player, "lifeGained");
}

export function drawCards(state: GameState, player: PlayerId, count: number, events: GameEvent[], drawStep = false): void {
  const p = state.players[player];
  // "If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead."
  if (!drawStep && p.battlefield.some((perm) => parseCard(getCard(state, perm.card.defId)).drawDouble)) count *= 2;
  for (let i = 0; i < count; i++) {
    const card = p.library.shift();
    if (!card) {
      p.drewFromEmpty = true; // loses the game when state-based actions are next checked
      return;
    }
    p.hand.push(card);
    events.push({ type: "cardDrawn", player, iid: card.iid });
    p.drawnThisTurn = (p.drawnThisTurn ?? 0) + 1;
    for (const perm of p.battlefield) {
      queueTriggers(state, perm.card, player, "drawCard");
      if (p.drawnThisTurn === 2) queueTriggers(state, perm.card, player, "drawSecond");
      if (p.drawnThisTurn === 5) queueTriggers(state, perm.card, player, "drawFifth");
    }
    // "Whenever a player draws their second card each turn" (any player's permanents)
    if (p.drawnThisTurn === 2) for (const owner of Object.values(state.players)) for (const perm of owner.battlefield) queueTriggers(state, perm.card, owner.id, "anyDrawSecond");
  }
}


/** Regeneration: instead of being destroyed the creature is tapped, healed and taken out of combat (rule 701.15). */
export function regenerateInstead(state: GameState, perm: Permanent): boolean {
  if ((perm.regenShield ?? 0) <= 0 || perm.noRegen) return false;
  perm.regenShield = (perm.regenShield ?? 0) - 1;
  perm.tapped = true;
  perm.damage = 0;
  perm.deathtouched = false;
  if (state.combat) {
    state.combat.attackers = state.combat.attackers.filter((a) => a.attacker !== perm.card.iid);
    for (const a of state.combat.attackers) a.blockers = a.blockers.filter((b) => b !== perm.card.iid);
  }
  return true;
}

/** Tokens only exist on the battlefield: anywhere else they cease to exist (rule 111.7). */
export const isToken = (card: CardInstance) => (card.printed ?? card.defId).startsWith("token-");

/** Off the battlefield a card is its printed self again (it stops being a copy, or an enchantment instead of a creature). */
const printedCard = (card: CardInstance): CardInstance => (card.printed ? { iid: card.iid, defId: card.printed, owner: card.owner } : card);

/** A creature dies: it goes to its owner's graveyard and its "when this dies" abilities trigger. */
export function putIntoGraveyard(state: GameState, perm: Permanent, controller: PlayerId, events: GameEvent[], sacrificed = false): void {
  const battlefield = state.players[controller].battlefield;
  const at = battlefield.indexOf(perm);
  if (at < 0) return;
  // "If that creature would die this turn, exile it instead." / a finality counter
  if ((perm.exileOnDeath && isCreature(state, perm)) || perm.finality) {
    const card = removeFromBattlefield(state, perm, controller);
    if (card) state.players[card.owner].exile.push(card);
    events.push({ type: "effect", text: `${nameOf(state, perm)} is exiled instead of dying.` });
    return;
  }
  const creature = isCreature(state, perm);
  const types = creature ? subtypesOf(state, perm) : [];
  const lki = { power: creature ? powerOf(state, perm) : 0, counters: perm.counters ?? 0, minusCounters: perm.minusCounters ?? 0 };
  battlefield.splice(at, 1);
  leftBattlefield(state, controller);
  leaveCombat(state, perm);
  creatureMoved(state, perm, controller, "leaves");
  releaseHeld(state, perm);
  if (!isToken(perm.card)) state.players[perm.card.owner].graveyard.push(printedCard(perm.card));
  events.push({ type: "creatureDied", player: controller, iid: perm.card.iid, name: getCard(state, perm.card.defId).name, ...(creature ? {} : { noncreature: true as const }), ...(sacrificed ? { sacrificed: true as const } : {}) });
  queueTriggers(state, perm.card, controller, "dies", { died: lki }); // as it was on the battlefield ("if it was a creature")
  // "Whenever a Vampire you control dies" / "whenever this creature or another creature you control dies": the dying creature looks back too.
  if (creature) for (const other of [perm, ...battlefield]) queueTriggers(state, other.card, controller, "allyDies", { subtypes: types, self: other === perm });
  // "Whenever this creature or another nontoken creature dies" (any player's): the dying creature looks back too.
  if (creature) {
    for (const owner of Object.values(state.players)) {
      for (const other of owner.id === controller ? [perm, ...battlefield] : owner.battlefield) queueTriggers(state, other.card, owner.id, "anyDies", { self: other === perm, token: isToken(perm.card) });
    }
    // "Whenever a creature an opponent controls dies"
    for (const watcher of state.players[OPPONENT[controller]].battlefield) queueTriggers(state, watcher.card, OPPONENT[controller], "oppCreatureDies");
  }
  if (creature) {
    state.creatureDied = true; // morbid
    queueDeathLife(state);
  }
  if (perm.diesReturn) {
    const text = "When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it.";
    state.triggerQueue.push({ specs: [], item: { kind: "ability", id: newId(state), controller, source: perm.card.iid, sourceName: nameOf(state, perm), effects: [{ type: "returnSelfToBattlefield", tapped: true, counters: 1 }], targets: [], specs: [], text } });
  }
  // "When enchanted creature dies, ...": the Auras that were on it (they fall off as state-based actions are checked).
  for (const owner of Object.values(state.players)) {
    for (const aura of owner.battlefield) if (aura.attachedTo === perm.card.iid) queueTriggers(state, aura.card, owner.id, "enchantedDies");
  }
  // "Whenever a creature dealt damage by ~ this turn dies": the permanents that damaged it get the trigger.
  if (perm.damagedBy?.length) {
    for (const owner of Object.values(state.players)) {
      for (const other of owner.battlefield) {
        if (perm.damagedBy.includes(other.card.iid)) queueTriggers(state, other.card, owner.id, "damagedDies");
      }
    }
  }
}

/** A creature that leaves the battlefield is no longer an attacker. (A blocker that leaves stays listed: its attacker remains blocked.) */
function leaveCombat(state: GameState, perm: Permanent): void {
  if (state.combat) state.combat.attackers = state.combat.attackers.filter((a) => a.attacker !== perm.card.iid);
}

const atEndStep = (state: GameState) => state.phase === "end" || state.phase === "cleanup";

/** The turn whose end step is the player's next one: this turn if it is theirs and the end step hasn't begun, else their next turn. */
export function nextEndStepTurn(state: GameState, player: PlayerId): number {
  if (state.active !== player) return state.turn + 1;
  return atEndStep(state) ? state.turn + 2 : state.turn;
}

/** Cards in exile the player may play right now ("During any turn you attacked with ~, you may play that card"). */
export function exilePlayable(state: GameState, player: PlayerId): CardInstance[] {
  const me = state.players[player];
  return (me.mayPlay ?? []).flatMap((entry) => {
    const card = me.exile.find((c) => c.iid === entry.iid);
    if (entry.always) return card ? [card] : []; // airbend: for as long as it stays exiled
    if (entry.throughTurn !== undefined) return card && state.turn <= entry.throughTurn ? [card] : []; // "until the end of your next turn"
    if (entry.fromTurn !== undefined) return card && state.turn >= entry.fromTurn ? [card] : []; // warp: "on a later turn"
    if (entry.untilTurn !== undefined) return card && (state.turn < entry.untilTurn || (state.turn === entry.untilTurn && !atEndStep(state))) ? [card] : [];
    const source = findPermanentOrNull(state, entry.source)?.perm;
    return source?.attackedThisTurn && card ? [card] : [];
  });
}

/** Playing an exiled card: what a spell cast from there costs more (Lightstall Inquisitor's {1}) and whether a land enters tapped. */
export function exilePlayTerms(state: GameState, player: PlayerId, iid: string): { tax: number; tappedLand: boolean; payGeneric?: number; sorcery?: boolean } {
  const entry = state.players[player].mayPlay?.find((e) => e.iid === iid);
  return { tax: entry?.tax ?? 0, tappedLand: entry?.tappedLand ?? false, ...(entry?.payGeneric !== undefined ? { payGeneric: entry.payGeneric } : {}), ...(entry?.sorcery ? { sorcery: true } : {}) };
}

/** "For as long as you control Olivia Voldaren": what it took goes back once it leaves. */
function returnControlled(state: GameState, source: Permanent): void {
  for (const holder of Object.values(state.players)) {
    for (const taken of holder.battlefield.filter((p) => p.controlledWhile?.source === source.card.iid)) {
      const back = taken.controlledWhile!.owner;
      delete taken.controlledWhile;
      if (back === holder.id) continue;
      holder.battlefield.splice(holder.battlefield.indexOf(taken), 1);
      state.players[back].battlefield.push(taken);
    }
  }
}

/** "Until this leaves the battlefield": what it was keeping in exile comes back under its owner's control (a card from a hand goes back to the hand). */
function releaseHeld(state: GameState, perm: Permanent): void {
  returnControlled(state, perm);
  for (const card of perm.heldFromHand ?? []) {
    const owner = state.players[card.owner];
    const at = owner.exile.findIndex((c) => c.iid === card.iid);
    if (at >= 0) owner.hand.push(...owner.exile.splice(at, 1));
  }
  perm.heldFromHand = undefined;
  for (const card of perm.held ?? []) {
    const owner = state.players[card.owner];
    const at = owner.exile.findIndex((c) => c.iid === card.iid);
    if (at < 0) continue;
    owner.exile.splice(at, 1);
    owner.battlefield.push({ card, tapped: false, summoningSick: true, damage: 0 });
    queueTriggers(state, card, card.owner, "enters");
    creatureEntered(state, card, card.owner);
  }
  perm.held = undefined;
}

/** Takes a permanent off the battlefield. Returns its card, or null for a token (which simply vanishes) or if it was gone. */
export function removeFromBattlefield(state: GameState, perm: Permanent, controller: PlayerId): CardInstance | null {
  const battlefield = state.players[controller].battlefield;
  const at = battlefield.indexOf(perm);
  if (at < 0) return null;
  battlefield.splice(at, 1);
  leftBattlefield(state, controller);
  leaveCombat(state, perm);
  creatureMoved(state, perm, controller, "leaves");
  releaseHeld(state, perm);
  return isToken(perm.card) ? null : printedCard(perm.card);
}

/** Revolt: "if a permanent left the battlefield under your control this turn". */
function leftBattlefield(state: GameState, controller: PlayerId): void {
  const p = state.players[controller];
  p.leftThisTurn = (p.leftThisTurn ?? 0) + 1;
}

/** Ruinous Waterbending: "whenever a creature dies this turn, you gain 1 life", for each player who cast it this turn. */
function queueDeathLife(state: GameState): void {
  for (const p of Object.values(state.players)) {
    for (let i = 0; i < (p.deathLife ?? 0); i++) {
      const text = "Whenever a creature dies this turn, you gain 1 life.";
      state.triggerQueue.push({ specs: [], item: { kind: "ability", id: newId(state), controller: p.id, source: `deathlife-${p.id}`, sourceName: "Ruinous Waterbending", effects: [{ type: "gainLife", amount: 1, who: { t: "you" } }], targets: [], specs: [], text, trigger: true } });
    }
  }
}

/**
 * A permanent is sacrificed: it goes to its owner's graveyard, then "whenever you sacrifice a permanent / a token" and
 * "whenever a player sacrifices a permanent" trigger. The sacrificed permanent looks back too (Mayhem Devil sacrificed itself).
 */
export function sacrificePermanent(state: GameState, perm: Permanent, controller: PlayerId, events: GameEvent[]): void {
  const token = isToken(perm.card);
  const watchers = Object.values(state.players).flatMap((pl) => pl.battlefield.map((p) => ({ card: p.card, owner: pl.id })));
  putIntoGraveyard(state, perm, controller, events, true);
  for (const { card, owner } of watchers) {
    queueTriggers(state, card, owner, "anySacrifice");
    if (owner === controller) queueTriggers(state, card, owner, "youSacrifice", { token });
  }
}

/** Makes a token and puts it onto the battlefield under `controller`. */
export function makeToken(state: GameState, spec: TokenSpec, controller: PlayerId, events: GameEvent[]): string {
  const keywords: string[] = spec.changeling ? [...spec.keywords, "changeling"] : spec.keywords;
  const defId = `token-${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${spec.power ?? 0}-${spec.toughness ?? 0}-${spec.colors.join("")}-${keywords.join("-")}`;
  state.cards[defId] ??= {
    id: defId,
    name: spec.name,
    type: spec.type,
    cost: 0,
    power: spec.power,
    toughness: spec.toughness,
    typeLine: `Token ${spec.artifact && spec.type === "creature" ? "Artifact Creature" : spec.type === "creature" ? "Creature" : "Artifact"} — ${spec.subtypes}`,
    text: spec.text,
    colors: spec.colors,
    keywords,
    playable: false, // never in a deck
  };
  const card: CardInstance = { iid: `tok${state.nextId++}`, defId, owner: controller };
  state.players[controller].battlefield.push({ card, tapped: spec.tapped === true, summoningSick: spec.type === "creature", damage: 0 });
  events.push({ type: "permanentEntered", player: controller, iid: card.iid });
  for (const p of state.players[controller].battlefield) queueTriggers(state, p.card, controller, "tokenEnters"); // "whenever one or more tokens you control enter"
  if (spec.hasteThisTurn) state.players[controller].battlefield[state.players[controller].battlefield.length - 1].tempKeywords = ["haste"];
  // "...tapped and attacking": the token joins the attack that is going on.
  if (spec.tappedAttacking && state.combat && spec.type === "creature") {
    const perm = state.players[controller].battlefield[state.players[controller].battlefield.length - 1];
    perm.tapped = true;
    state.combat.attackers.push({ attacker: card.iid, blockers: [] });
  }
  if (spec.type === "creature") creatureEntered(state, card, controller);
  return card.iid;
}

/** A token that is a copy of a card, with base power and toughness 1/1 (offspring) unless `small` is false. */
export function makeTokenCopy(state: GameState, def: CardDef, controller: PlayerId, events: GameEvent[], small = true): string {
  const defId = small ? `token-copy-${def.id}-1-1` : def.id.startsWith("token-copy-") ? def.id : `token-copy-${def.id}`;
  state.cards[defId] ??= { ...def, id: defId, ...(small ? { power: 1, toughness: 1 } : {}), playable: false };
  const card: CardInstance = { iid: `tok${state.nextId++}`, defId, owner: controller };
  state.players[controller].battlefield.push({ card, tapped: false, summoningSick: true, damage: 0 });
  events.push({ type: "permanentEntered", player: controller, iid: card.iid });
  queueTriggers(state, card, controller, "enters");
  creatureEntered(state, card, controller);
  return card.iid;
}

/** Removes a spell or ability from the stack without it resolving. A countered spell goes to its owner's graveyard (exile, for flashback). */
/**
 * A spell that resolved or left the stack goes to its owner's graveyard (or the hand). A copy simply ceases to exist.
 * A flashback spell is exiled wherever it would go, even back to the hand (rule 702.34a).
 * An Adventure that resolved (`to` "adventure") is exiled, and its owner may cast the creature from there.
 */
export function spellLeavesStack(state: GameState, item: Extract<StackItem, { kind: "spell" }>, to: "graveyard" | "hand" | "adventure" = "graveyard"): void {
  if (item.copy) return;
  const owner = state.players[item.card.owner];
  const card = item.adventure ? { ...item.card, defId: item.card.defId.replace(/\/\/adventure$/, "") } : item.card;
  if (to === "adventure") {
    owner.exile.push(card);
    owner.mayPlay = [...(owner.mayPlay ?? []), { iid: card.iid, source: "adventure", always: true }];
    return;
  }
  owner[item.flashback ? "exile" : to === "hand" ? "hand" : "graveyard"].push(card);
}

export function counterStackItem(state: GameState, item: StackItem, events: GameEvent[], by?: string): void {
  state.stack.splice(state.stack.indexOf(item), 1);
  if (item.kind === "spell") spellLeavesStack(state, item);
  const name = item.kind === "spell" ? getCard(state, item.card.defId).name : `${item.sourceName}'s ability`;
  events.push({ type: "countered", name, controller: item.controller, iid: item.kind === "spell" ? item.card.iid : item.source, ...(by ? { by } : {}) });
}


/** Taps a permanent: "whenever ~ becomes tapped" (and "whenever equipped creature / a creature you control becomes tapped") triggers happen if it was untapped. */
export function tapPerm(state: GameState, perm: Permanent, controller: PlayerId): void {
  if (perm.tapped) return;
  perm.tapped = true;
  const first = !perm.tappedThisTurn;
  perm.tappedThisTurn = true;
  queueTriggers(state, perm.card, controller, "selfTapped");
  // "Whenever an Island an opponent controls becomes tapped" (Thoughtleech), "an artifact an opponent controls" (Powerleech): the other player's permanents notice
  const kinds = [...subtypesOf(state, perm), ...(isArtifactDef(getCard(state, perm.card.defId)) ? ["artifact"] : [])];
  const against = controller === "p1" ? "p2" : "p1";
  for (const watcher of state.players[against].battlefield) queueTriggers(state, watcher.card, against, "oppPermTapped", { subtypes: kinds });
  for (const host of state.players[controller].battlefield) if (host.attachedTo === perm.card.iid) queueTriggers(state, host.card, controller, "hostTapped", { other: perm.card.iid });
  if (isCreature(state, perm)) for (const other of state.players[controller].battlefield) queueTriggers(state, other.card, controller, "allyTapped", { other: perm.card.iid, firstTap: first, self: other === perm });
}

/** Puts +1/+1 counters on a permanent: "whenever one or more +1/+1 counters are put on another creature you control" triggers. */
export function putCounters(state: GameState, perm: Permanent, controller: PlayerId, n: number): void {
  if (n <= 0) return;
  // "If you would put one or more counters on a permanent you control, put that many plus one instead." (Doc Samson)
  if (state.players[controller].battlefield.some((p) => parseCard(getCard(state, p.card.defId)).countersPlusOne)) n += 1;
  perm.counters = (perm.counters ?? 0) + n;
  perm.countersThisTurn = (perm.countersThisTurn ?? 0) + n;
  if (!isCreature(state, perm)) return;
  const types = subtypesOf(state, perm);
  for (const other of state.players[controller].battlefield) queueTriggers(state, other.card, controller, "allyCountersAdded", { subtypes: types, self: other === perm });
}
