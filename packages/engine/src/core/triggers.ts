import type { GameEvent } from "../actions.js";
import { getCard } from "../cards.js";
import type { LastKnown, StackItem, TargetChoice, TriggeredAbility } from "../effects.js";
import { parseCard } from "../oracle.js";
import { OPPONENT } from "../types.js";
import type { CardDef, CardInstance, GameState, Permanent, PlayerId } from "../types.js";
import {
  artifactCount,
  bindSpecs,
  findPermanentOrNull,
  isArtifactDef,
  isCreature,
  isEnchantmentDef,
  nameOf,
  newId,
  powerOf,
  shiftTargets,
  staticEffectsOn,
  subtypesOf,
  toughnessOf,
} from "./permanents.js";
import { ignoresHexproof, legalTargets } from "./targets.js";
import { isToken, putCounters } from "./zones.js";

// Entering the battlefield and triggered abilities: which triggers fire, and putting them in the queue.

/** Does an "intervening if" (and a spell-cast trigger's timing rules) hold right now? */
function triggerCondHolds(state: GameState, controller: PlayerId, trigger: TriggeredAbility, extra?: { castCount?: number; byOpponent?: boolean; bySpell?: boolean; attackers?: string[] }, sourceIid?: string): boolean {
  const p = state.players[controller];
  const c = trigger.cond;
  if (c?.opponentLostLife && (state.players[OPPONENT[controller]].lifeLostThisTurn ?? 0) === 0) return false;
  if (c?.anyLostLifeAtLeast !== undefined && !Object.values(state.players).some((pl) => (pl.lifeLostThisTurn ?? 0) >= c.anyLostLifeAtLeast!)) return false;
  if (c?.attackedThisTurn && !p.attackedThisTurn) return false;
  if (c?.controlsOther && !p.battlefield.some((perm) => perm.card.iid !== sourceIid && subtypesOf(state, perm).includes(c.controlsOther!))) return false;
  if (c?.creaturesAtLeast !== undefined && p.battlefield.filter((perm) => isCreature(state, perm)).length < c.creaturesAtLeast) return false;
  if (c?.lifeGainedAtLeast !== undefined && (p.lifeGainedThisTurn ?? 0) < c.lifeGainedAtLeast) return false;
  if (c?.lifeAtLeast !== undefined && p.life < c.lifeAtLeast) return false;
  if (c?.handBelow !== undefined && p.hand.length >= c.handBelow) return false;
  if (c?.yardAtLeast !== undefined && p.graveyard.length < c.yardAtLeast) return false;
  if (c?.handEmpty && p.hand.length > 0) return false;
  if (c?.artifactsAtLeast !== undefined && artifactCount(state, controller) < c.artifactsAtLeast) return false;
  if (c?.creatureDied && !state.creatureDied) return false;
  if (c?.selfPowerAtLeast !== undefined) {
    const me = sourceIid ? findPermanentOrNull(state, sourceIid)?.perm : undefined;
    if (!me || powerOf(state, me) < c.selfPowerAtLeast) return false;
  }
  if (c?.selfEquipped && !Object.values(state.players).some((pl) => pl.battlefield.some((e) => e.attachedTo === sourceIid && subtypesOf(state, e).includes("equipment")))) return false;
  if (c?.unsolved && (!sourceIid || findPermanentOrNull(state, sourceIid)?.perm.solved)) return false;
  if (c?.cast && !(sourceIid && findPermanentOrNull(state, sourceIid)?.perm.cast)) return false;
  if (c?.enchantedUntapped) {
    const host = sourceIid ? findPermanentOrNull(state, sourceIid)?.perm.attachedTo : undefined;
    const hostPerm = host ? findPermanentOrNull(state, host)?.perm : undefined;
    if (!hostPerm || hostPerm.tapped) return false;
  }
  if (c?.controlsTypes && !p.battlefield.some((perm) => c.controlsTypes!.some((t) => (t === "artifact" ? isArtifactDef(getCard(state, perm.card.defId)) : t === "enchantment" ? isEnchantmentDef(getCard(state, perm.card.defId)) : getCard(state, perm.card.defId).type === t)))) return false;
  if (trigger.opponentTurnOnly && state.active === controller) return false;
  if (trigger.firstOnly && (extra?.castCount ?? 1) !== 1) return false;
  if (trigger.secondOnly && extra?.castCount !== 2) return false;
  if (trigger.byOpponent && !extra?.byOpponent) return false;
  if (trigger.bySpell && !extra?.bySpell) return false;
  if (c?.attackPowerAtLeast !== undefined && (extra?.attackers ?? []).reduce((n, iid) => n + Math.max(0, (() => { const p = findPermanentOrNull(state, iid)?.perm; return p ? powerOf(state, p) : 0; })()), 0) < c.attackPowerAtLeast) return false;
  const typesOf = (iid: string): string[] => {
    const perm = findPermanentOrNull(state, iid)?.perm;
    return perm ? subtypesOf(state, perm) : [];
  };
  const attackers = extra?.attackers ?? [];
  if (trigger.attackerSubtypes && !attackers.some((iid) => trigger.attackerSubtypes!.some((t) => typesOf(iid).includes(t)))) return false;
  if (c?.attackersInclude && !c.attackersInclude.every((t) => attackers.some((iid) => typesOf(iid).includes(t)))) return false;
  return true;
}

/** A creature was dealt damage: "whenever ~ is dealt damage" and "whenever a creature you control is dealt damage" (X is the amount). */
export function creatureDamaged(state: GameState, perm: Permanent, controller: PlayerId, amount: number): void {
  queueTriggers(state, perm.card, controller, "damaged");
  for (const other of state.players[controller].battlefield) queueTriggers(state, other.card, controller, "allyDamaged", { count: amount });
}

/** A Saga's chapter abilities for the lore counters it has now: they go on the stack as triggered abilities. */
export function queueChapters(state: GameState, perm: Permanent, controller: PlayerId): void {
  const def = getCard(state, perm.card.defId);
  const saga = parseCard(def).saga;
  if (!saga) return;
  for (const chapter of saga.chapters) {
    if (!chapter.numbers.includes(perm.lore ?? 0)) continue;
    const specs = bindSpecs(chapter.targets, perm.card.iid);
    state.triggerQueue.push({ specs, item: { kind: "ability", id: newId(state), controller, source: perm.card.iid, sourceName: def.name, effects: chapter.effects, targets: [], specs, text: chapter.text } });
  }
}

/** "Whenever another creature you control enters": the controller's other permanents with such a trigger. */
export function creatureEntered(state: GameState, card: CardInstance, controller: PlayerId): void {
  const entering = state.players[controller].battlefield.find((p) => p.card.iid === card.iid);
  if (entering) addEnteringCounters(state, entering, controller);
  if (entering) creatureMoved(state, entering, controller, "enters");
  for (const perm of state.players[controller].battlefield) {
    const def = getCard(state, perm.card.defId);
    for (const [n, trigger] of parseCard(def).triggers.entries()) {
      if (trigger.event !== "allyEnters") continue;
      if (trigger.other && perm.card.iid === card.iid) continue;
      if (!levelReached(state, perm.card.iid, trigger.level)) continue;
      if (trigger.enchantments) {
        if (!isEnchantmentDef(getCard(state, card.defId))) continue; // eerie: "whenever an enchantment you control enters"
      } else if (trigger.artifacts) {
        if (!(entering && isCreature(state, entering)) && !isArtifactDef(getCard(state, card.defId))) continue; // "another creature or artifact you control"
      } else if (!trigger.subtypes && !(entering && isCreature(state, entering))) continue; // plain "another creature enters" is about creatures
      if (trigger.nontoken && isToken(card)) continue;
      if (trigger.orArtifact && !(isArtifactDef(getCard(state, card.defId)) || (entering && trigger.subtypes?.some((t) => subtypesOf(state, entering).includes(t))))) continue;
      // ("another artifact you control enters": "artifact" is a card type here, not a creature type)
      const enteringDef = getCard(state, card.defId);
      if (trigger.subtypes && !trigger.orArtifact && !trigger.subtypes.some((t) => (t === "artifact" ? isArtifactDef(enteringDef) : t === "enchantment" ? isEnchantmentDef(enteringDef) : (entering ? subtypesOf(state, entering) : []).includes(t)))) continue;
      if (trigger.maxPower !== undefined && entering && powerOf(state, entering) > trigger.maxPower) continue;
      if (trigger.minPower !== undefined && !(entering && powerOf(state, entering) >= trigger.minPower)) continue;
      if (trigger.cond?.enteringGreater && !(entering && (powerOf(state, entering) > powerOf(state, perm) || toughnessOf(state, entering) > toughnessOf(state, perm)))) continue;
      if (trigger.oncePerTurn && !claimOncePerTurn(perm, n)) continue;
      state.triggerQueue.push({
        specs: bindSpecs(trigger.targets, perm.card.iid),
        ...(trigger.modes ? { modes: trigger.modes } : {}),
        item: { kind: "ability", id: newId(state), controller, source: perm.card.iid, sourceName: def.name, effects: trigger.effects, targets: [], specs: bindSpecs(trigger.targets, perm.card.iid), text: trigger.text, other: card.iid },
      });
    }
  }
}

/** Giada: "Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control." */
function addEnteringCounters(state: GameState, perm: Permanent, controller: PlayerId): void {
  const others = state.players[controller].battlefield.filter((p) => p !== perm);
  const types = subtypesOf(state, perm);
  for (const source of others) {
    const type = parseCard(getCard(state, source.card.defId)).othersEnterWithCounters;
    if (!type || !types.includes(type)) continue;
    putCounters(state, perm, controller, others.filter((p) => subtypesOf(state, p).includes(type)).length);
  }
}

/** "Whenever another creature enters" (any controller) and "whenever another creature you control leaves the battlefield". */
export function creatureMoved(state: GameState, perm: Permanent, controller: PlayerId, kind: "enters" | "leaves"): void {
  if (!isCreature(state, perm)) return;
  if (kind === "enters") {
    for (const owner of Object.values(state.players)) {
      for (const other of owner.battlefield) if (other.card.iid !== perm.card.iid) queueTriggers(state, other.card, owner.id, "anyCreatureEnters");
    }
  } else {
    for (const other of state.players[controller].battlefield) if (other.card.iid !== perm.card.iid) queueTriggers(state, other.card, controller, "allyLeaves");
  }
}

/** A spell was cast (a copy cast from exile too): prowess and every other "whenever you cast" / "whenever an opponent casts" ability. */
export function spellCast(state: GameState, player: PlayerId, def: CardDef, targets: TargetChoice[], manaSpent: number, kicked: boolean): void {
  const me = state.players[player];
  // "Whenever you cast a noncreature spell" ("...a noncreature or Dragon spell" counts Dragon creature spells too).
  const spellTypes = ((def.typeLine ?? "").split(" // ")[0].split("—")[1] ?? "").toLowerCase().split(/\s+/);
  for (const perm of me.battlefield) queueTriggers(state, perm.card, player, "noncreatureSpell", def.type === "creature" ? { subtypes: spellTypes } : undefined);
  if (def.type === "instant" || def.type === "sorcery") for (const perm of me.battlefield) queueTriggers(state, perm.card, player, "instantOrSorcery", { count: manaSpent });
  me.spellsCastThisTurn = (me.spellsCastThisTurn ?? 0) + 1;
  const aimedAt = (iid: string) => findPermanentOrNull(state, iid);
  const targetedCreatures = targets.flatMap((t) => (t.kind === "permanent" && aimedAt(t.iid) && isCreature(state, aimedAt(t.iid)!.perm) ? [aimedAt(t.iid)!] : []));
  for (const perm of me.battlefield) {
    queueTriggers(state, perm.card, player, "youCast", {
      castCount: me.spellsCastThisTurn,
      spellColors: def.colors ?? [],
      spellSubtypes: spellTypes,
      spellKicked: kicked,
      spellCreature: def.type === "creature",
      spellKeywords: def.keywords ?? [],
      targetsOwnCreature: targetedCreatures.some((f) => f.owner.id === player),
      targetsCreature: targetedCreatures.length > 0,
      targetedIids: targets.flatMap((t) => (t.kind === "permanent" ? [t.iid] : [])),
    });
  }
  for (const perm of state.players[OPPONENT[player]].battlefield) queueTriggers(state, perm.card, OPPONENT[player], "opponentCasts");
  // "Whenever a player casts a red spell"
  for (const watcher of Object.values(state.players)) for (const perm of watcher.battlefield) queueTriggers(state, perm.card, watcher.id, "anyCasts", { spellColors: def.colors ?? [] });
}

/** A Class's ability works once the Class has reached its level (a card that has left the battlefield looks back at it as it was). */
function levelReached(state: GameState, iid: string, level?: number): boolean {
  if (!level || level <= 1) return true;
  return (findPermanentOrNull(state, iid)?.perm.classLevel ?? 1) >= level;
}

/** "This ability triggers only once each turn": remembered like an ability used this turn (keys above 1000 are triggers). False when it already triggered. */
function claimOncePerTurn(perm: Permanent | undefined, n: number): boolean {
  if (perm?.usedAbilities?.includes(1000 + n)) return false;
  if (perm) perm.usedAbilities = [...(perm.usedAbilities ?? []), 1000 + n];
  return true;
}

/**
 * Queues the card's triggered abilities for `event`. They go on the stack when the game next settles.
 * `subtypes`: the creature types of what the event is about (a creature spell cast, a creature that died or got counters); `self`: it is this card.
 */
export function queueTriggers(state: GameState, card: CardInstance, controller: PlayerId, event: TriggeredAbility["event"], extra?: { firstTap?: boolean; targetedIids?: string[]; targetsOwnCreature?: boolean; targetsCreature?: boolean; spellColors?: string[]; spellSubtypes?: string[]; spellKicked?: boolean; spellCreature?: boolean; spellKeywords?: string[]; castCount?: number; other?: string; onlyOther?: boolean; byOpponent?: boolean; bySpell?: boolean; attackers?: string[]; subtypes?: string[]; self?: boolean; died?: LastKnown; count?: number; token?: boolean }): void {
  const def = getCard(state, card.defId);
  const triggers = parseCard(def).triggers;
  for (let n = 0; n < triggers.length; n++) {
    const trigger = triggers[n];
    if (trigger.event !== event) continue;
    // A creature spell only counts for "a noncreature or Dragon spell" when it is a Dragon.
    if (event === "noncreatureSpell" && extra?.subtypes && !(trigger.orSpellSubtype && extra.subtypes.includes(trigger.orSpellSubtype))) continue;
    // "Whenever you cast a red spell" / "a Lesson spell"
    if (trigger.spellColor && !(extra?.spellColors ?? []).includes(trigger.spellColor)) continue;
    if (trigger.spellSubtype && !(extra?.spellSubtypes ?? []).includes(trigger.spellSubtype)) continue;
    if (trigger.spellKicked && !extra?.spellKicked) continue; // "whenever you cast a kicked spell"
    if (trigger.spellCreature && !extra?.spellCreature) continue; // "whenever you cast a creature spell (with infect)"
    if (trigger.spellKeyword && !(extra?.spellKeywords ?? []).some((k) => k.toLowerCase() === trigger.spellKeyword)) continue;
    if ((event === "anyDies" || event === "allyDies") && trigger.nontoken && extra?.token) continue; // "another nontoken creature"
    if (trigger.tokenOnly && !extra?.token) continue; // "whenever you sacrifice a token"
    if (trigger.ifNoCounters && (extra?.died?.counters ?? 0) > 0) continue; // undying
    if (trigger.ifNoMinusCounters && (extra?.died?.minusCounters ?? 0) > 0) continue; // persist
    if (!levelReached(state, card.iid, trigger.level)) continue;
    if (trigger.other && extra?.self) continue;
    if (trigger.selfOnly && !extra?.self) continue;
    // "Whenever you cast a spell that targets a creature you control / one or more creatures"
    if (trigger.spellTargets === "ownCreature" && !extra?.targetsOwnCreature) continue;
    if (trigger.spellTargets === "creatures" && !extra?.targetsCreature) continue;
    if (trigger.spellTargets === "self" && !(extra?.targetedIids ?? []).includes(card.iid)) continue; // heroic
    // "Whenever a creature you control becomes tapped during your turn, if it's the first time ..."
    if (trigger.yourTurnOnly && state.active !== controller) continue;
    if (trigger.firstTapOnly && !extra?.firstTap) continue;
    // "Whenever you put a +1/+1 counter on one or more other Heroes": only creatures of these types
    if (event === "allyCountersAdded" && trigger.subtypes && !trigger.subtypes.some((t) => extra?.subtypes?.includes(t))) continue;
    // "Whenever one or more creatures you control become tapped": once for all of them
    if (trigger.batch && state.triggerQueue.some((q) => q.item.source === card.iid && q.item.text === trigger.text)) continue;
    if (trigger.equippedOnly && !(extra?.other && state.players[controller].battlefield.some((p) => p.attachedTo === extra.other && subtypesOf(state, p).includes("equipment")))) continue;
    if (trigger.hostOnly && (!extra?.other || findPermanentOrNull(state, card.iid)?.perm.attachedTo !== extra.other)) continue;
    if ((event === "allyDies" || event === "allyAttacks" || event === "oppPermTapped") && trigger.subtypes && !trigger.subtypes.some((t) => extra?.subtypes?.includes(t))) continue;
    if (trigger.notSubtype && extra?.subtypes?.includes(trigger.notSubtype)) continue;
    if (trigger.ifKicked && !findPermanentOrNull(state, card.iid)?.perm.kicked) continue;
    if (trigger.cond?.wasCreature && def.type !== "creature") continue; // "if it was a creature": as it last was on the battlefield
    if (!triggerCondHolds(state, controller, trigger, extra, card.iid)) continue;
    if (extra?.onlyOther && !trigger.usesOther) continue;
    if (trigger.oncePerTurn && !claimOncePerTurn(findPermanentOrNull(state, card.iid)?.perm, n)) continue;
    let { effects, targets } = trigger;
    if (trigger.xTargets) {
      // "Tap X target creatures": X copies of the target, and of the effects for each.
      const x = findPermanentOrNull(state, card.iid)?.perm.xPaid ?? 0;
      if (x === 0) continue;
      // X different targets are needed: with fewer creatures than that the ability has no legal targets and is removed (rule 603.3d)
      if (legalTargets(state, bindSpecs([trigger.targets[0]], card.iid)[0], controller).length < x) continue;
      targets = Array.from({ length: x }, (_, i) => ({ ...trigger.targets[0], label: `${trigger.targets[0].label} (${i + 1} of ${x})` }));
      effects = Array.from({ length: x }, (_, i) => shiftTargets(trigger.effects, i)).flat();
    }
    // "With mana value less than or equal to this creature's power": its power as it died.
    // "With mana value less than or equal to this creature's power": its power now, or as it died.
    const died = extra?.died;
    if (targets.some((t) => t.mvAtMostPower)) {
      const self = findPermanentOrNull(state, card.iid)?.perm;
      const power = died?.power ?? (self ? powerOf(state, self) : 0);
      targets = targets.map((t) => (t.mvAtMostPower ? { ...t, mv: { n: power, op: "max" as const } } : t));
    }
    if (extra?.other && targets.some((t) => t.notOther)) targets = targets.map((t) => (t.notOther ? { ...t, except: extra.other } : t));
    state.triggerQueue.push({
      specs: bindSpecs(targets, card.iid),
      ...(trigger.modes ? { modes: trigger.modes } : {}),
      ...(trigger.unchosenOnly ? { unchosen: true } : {}),
      item: {
        kind: "ability",
        id: newId(state),
        controller,
        source: card.iid,
        sourceName: def.name,
        effects,
        targets: [],
        specs: bindSpecs(targets, card.iid),
        text: trigger.text,
        ...(extra?.other ? { other: extra.other } : {}),
        ...(died ? { died } : {}),
        ...(extra?.count !== undefined ? { x: extra.count } : event === "enters" && !trigger.xTargets && findPermanentOrNull(state, card.iid)?.perm.xPaid ? { x: findPermanentOrNull(state, card.iid)!.perm.xPaid } : {}), // ("When this enters, draw X cards": the X that was paid)
      },
    });
  }
}

/**
 * "Whenever one or more creatures your opponents control are dealt excess noncombat damage": `victim` controls the creature.
 * Damage dealt by one spell or ability is dealt at the same time, so a trigger already waiting in the queue isn't added again.
 */
export function excessDamageDealt(state: GameState, victim: PlayerId): void {
  const player = OPPONENT[victim];
  for (const perm of state.players[player].battlefield) {
    const texts = parseCard(getCard(state, perm.card.defId)).triggers.filter((t) => t.event === "excessDamage").map((t) => t.text);
    if (texts.length === 0 || state.triggerQueue.some((q) => q.item.source === perm.card.iid && texts.includes(q.item.text))) continue;
    queueTriggers(state, perm.card, player, "excessDamage");
  }
}

/** "Whenever that creature deals combat damage to a player this turn, you draw a card": the draws given to it this turn. */
export function queueDamageDraws(state: GameState, perm: Permanent): void {
  for (const draw of perm.damageDraws ?? []) {
    const text = "Whenever that creature deals combat damage to a player this turn, you draw a card.";
    state.triggerQueue.push({ specs: [], item: { kind: "ability", id: newId(state), controller: draw.player, source: perm.card.iid, sourceName: draw.source, effects: [{ type: "draw", amount: 1, who: { t: "you" } }], targets: [], specs: [], text } });
  }
}

/** A player discarded cards: the event, and their "whenever you discard one or more cards" triggers, once for the whole batch ("that many" is its X). */
export function cardsDiscarded(state: GameState, player: PlayerId, iids: string[], events: GameEvent[], byOpponent = false): void {
  if (iids.length === 0) return;
  // "When a spell or ability an opponent controls causes you to discard ~" (Guerrilla Tactics): the discarded card itself triggers
  if (byOpponent) for (const card of state.players[player].graveyard.filter((c) => iids.includes(c.iid))) queueTriggers(state, card, player, "discardedByOpp");
  events.push({ type: "cardsDiscarded", player, iids });
  state.players[player].discardedThisTurn = (state.players[player].discardedThisTurn ?? 0) + iids.length;
  for (const perm of state.players[player].battlefield) queueTriggers(state, perm.card, player, "youDiscard", { count: iids.length });
}

/** "As this enters, choose a color" / "choose a creature type": starts the choice (nothing to ask when only one color is allowed). */
export function askAsEnters(state: GameState, perm: Permanent, controller: PlayerId): void {
  const parsed = parseCard(getCard(state, perm.card.defId));
  if (parsed.shock !== undefined && !state.pendingPick) return askShock(state, perm, controller, parsed.shock);
  if (parsed.chooseType && !state.pendingPick) return askCreatureType(state, perm, controller);
  const choose = parsed.chooseColor;
  if (!choose || state.pendingPick) return;
  const options = (["W", "U", "B", "R", "G"] as const).filter((c) => c !== choose.except);
  if (options.length === 1) {
    perm.chosenColor = options[0];
    return;
  }
  state.pendingPick = {
    player: controller,
    prompt: `${nameOf(state, perm)}: choose a color${choose.except ? ` other than ${choose.except}` : ""}`,
    kind: "color",
    options: [...options],
    optional: false,
    owner: controller,
    remaining: 1,
    ordered: [],
    colorFor: perm.card.iid,
    source: { iid: perm.card.iid, name: nameOf(state, perm), defId: perm.card.defId },
  };
}

/** A shock land: "As ~ enters, you may pay 2 life. If you don't, it enters tapped." */
function askShock(state: GameState, perm: Permanent, controller: PlayerId, life: number): void {
  if (state.players[controller].life < life) {
    perm.tapped = true;
    return;
  }
  state.pendingPick = {
    player: controller,
    prompt: `pay ${life} life, or it enters tapped`,
    kind: "mayPay",
    options: ["pay"],
    optional: true,
    owner: controller,
    remaining: 1,
    ordered: [],
    wardCost: "",
    payLife: life,
    tapIfNot: perm.card.iid,
    source: { iid: perm.card.iid, name: nameOf(state, perm), defId: perm.card.defId },
  };
}

/**
 * "As this land enters, choose a creature type": the types among the player's own cards, most common first
 * (choosing a type none of their cards have would do nothing).
 */
function askCreatureType(state: GameState, perm: Permanent, controller: PlayerId): void {
  const p = state.players[controller];
  const counts = new Map<string, number>();
  for (const card of [...p.library, ...p.hand, ...p.graveyard, ...p.exile, ...p.battlefield.map((b) => b.card)]) {
    const def = getCard(state, card.defId);
    if (!/\bcreature\b/i.test(def.typeLine ?? def.type)) continue;
    // the printed types only: a changeling would count as every type
    for (const t of ((def.typeLine ?? "").split(" // ")[0].split("—")[1] ?? "").toLowerCase().split(/\s+/).filter(Boolean)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const options = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  if (options.length <= 1) {
    perm.chosenType = options[0] ?? "human";
    return;
  }
  state.pendingPick = {
    player: controller,
    prompt: `${nameOf(state, perm)}: choose a creature type`,
    kind: "creatureType",
    options,
    optional: false,
    owner: controller,
    remaining: 1,
    ordered: [],
    colorFor: perm.card.iid,
    source: { iid: perm.card.iid, name: nameOf(state, perm), defId: perm.card.defId },
  };
}

/** Landfall: a land entered under `player`'s control, so their permanents with "whenever a land you control enters" trigger. */
export function landEntered(state: GameState, player: PlayerId): void {
  state.players[player].landsEnteredThisTurn = (state.players[player].landsEnteredThisTurn ?? 0) + 1;
  for (const perm of state.players[player].battlefield) queueTriggers(state, perm.card, player, "landfall");
}

/** Ward: after a spell or ability is put on the stack, each opposing permanent with ward that it targets gets a trigger. */
export function queueWard(state: GameState, item: StackItem): void {
  const wardsOff = ignoresHexproof(state, item.controller); // "Ward abilities of those creatures don't trigger."
  item.targets.forEach((target) => {
    if (target.kind !== "permanent") return;
    const found = findPermanentOrNull(state, target.iid);
    // "Whenever a player or permanent becomes the target of an ability you control, ..."
    if (item.kind === "ability") for (const p of state.players[item.controller].battlefield) queueTriggers(state, p.card, item.controller, "yourAbilityTargets");
    // "When this becomes the target of a spell or ability, ...": a trigger for the permanent's controller.
    if (found) queueTriggers(state, found.perm.card, found.owner.id, "becomesTarget", { byOpponent: item.controller !== found.owner.id });
    // "Whenever a creature you control becomes the target of a spell or ability an opponent controls, ...": every permanent of its controller.
    if (found && isCreature(state, found.perm)) {
      for (const p of state.players[found.owner.id].battlefield) queueTriggers(state, p.card, found.owner.id, "allyTargeted", { byOpponent: item.controller !== found.owner.id, bySpell: item.kind === "spell", other: found.perm.card.iid });
    }
    const ward = found ? wardOf(state, found.perm) : null;
    if (!found || !ward || found.owner.id === item.controller || (wardsOff && isCreature(state, found.perm))) return;
    const name = getCard(state, found.perm.card.defId).name;
    state.triggerQueue.push({
      specs: [],
      item: { kind: "ability", id: newId(state), controller: found.owner.id, source: found.perm.card.iid, sourceName: name, effects: [{ type: "wardCheck", cost: ward.cost, itemId: item.id, ...(ward.life ? { life: ward.life } : {}) }], targets: [], specs: [], text: ward.text },
    });
  });
}

/** A permanent's ward, printed or given by another permanent: what it costs to target it ("{2}", and/or life), and "Ward {2}" to show. Null without ward. */
export function wardOf(state: GameState, perm: Permanent): { cost: string; life?: number; text: string } | null {
  const parsed = parseCard(getCard(state, perm.card.defId));
  const cost = parsed.ward ?? staticEffectsOn(state, perm).find((st) => st.ward)?.ward;
  if (cost === undefined) return null;
  const life = parsed.wardLife;
  return life ? { cost, life, text: `Ward—${cost ? `${cost}, ` : ""}Pay ${life} life` } : { cost, text: `Ward ${cost}` };
}
