import { getCard } from "../cards.js";
import { CREATURE_TYPES, defSubtypes } from "../creatureTypes.js";
import type { CardFilter, CountSpec, SourceQuality, StaticEffect, TargetSpec } from "../effects.js";
import { isBasicLand } from "../deck.js";
import { hasKeyword } from "../keywords.js";
import type { Keyword } from "../keywords.js";
import { parseCard } from "../oracle.js";
import { OPPONENT } from "../types.js";
import type { CardDef, GameState, Permanent, PlayerId, PlayerState } from "../types.js";
import { isToken } from "./zones.js";

// Reading cards and permanents: types, subtypes, static effects, power and toughness, keywords.

export const playerLabel = (id: PlayerId) => (id === "p1" ? "Player 1" : "Player 2");

export const isCreature = (s: GameState, p: Permanent) => getCard(s, p.card.defId).type === "creature" || p.crewed === true;

/** Artifacts, including artifact creatures ("Artifact Creature — Construct"). */
/** Does a land with "enters tapped unless ..." enter tapped, given what its controller has on the battlefield right now? */
export function entersTappedNow(state: GameState, controller: PlayerId, def: CardDef): boolean {
  const parsed = parseCard(def);
  if (parsed.entersTapped) return true;
  const unless = parsed.entersTappedUnless;
  if (!unless) return false;
  if (unless.never) return true;
  if (unless.yourTurn) return state.active !== controller;
  const mine = state.players[controller].battlefield.filter((p) => getCard(state, p.card.defId).type === "land");
  const foe = state.players[OPPONENT[controller]];
  const untapped =
    (unless.basics !== undefined && mine.filter((p) => isBasicLand(getCard(state, p.card.defId))).length >= unless.basics) ||
    (unless.otherLands !== undefined && mine.length >= unless.otherLands) ||
    (unless.fewerOtherLands !== undefined && mine.length <= unless.fewerOtherLands) ||
    (unless.planeswalker === true && state.players[controller].battlefield.some((p) => getCard(state, p.card.defId).type === "planeswalker")) ||
    (unless.lifeAtMost !== undefined && Object.values(state.players).some((p) => p.life <= unless.lifeAtMost!)) ||
    (unless.landTypes !== undefined && mine.some((p) => unless.landTypes!.some((t) => defSubtypes(getCard(state, p.card.defId)).includes(t)))) ||
    (unless.opponentLands !== undefined && foe.battlefield.filter((p) => getCard(state, p.card.defId).type === "land").length >= unless.opponentLands);
  return !untapped;
}

/** Does this card fit a "reveal a ... card" filter (a type, a creature type, or "nonland")? */
export function cardMatches(def: CardDef, filter: CardFilter): boolean {
  if (filter.basic && !isBasicLand(def)) return false;
  if (filter.maxMV !== undefined && def.cost > filter.maxMV) return false;
  if (filter.maxPower !== undefined && !(def.power !== undefined && def.power <= filter.maxPower)) return false;
  if (filter.all) return true;
  if (filter.nonland) return def.type !== "land";
  const line = (def.typeLine ?? def.type).toLowerCase();
  if (filter.types?.some((t) => def.type === t || line.split("—")[0].includes(t))) return true;
  if (filter.colors?.some((c) => (def.colors ?? []).includes(c))) return true;
  return filter.subtypes?.some((s) => defSubtypes(def).includes(s)) ?? false;
}

/** Mode effects count their targets from 0; when several modes are chosen (or one target is repeated X times) the later ones are shifted. */
export function shiftTargets<T>(value: T, offset: number): T {
  if (offset === 0) return value;
  if (Array.isArray(value)) return value.map((v) => shiftTargets(v, offset)) as T;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ((o.t === "target" || o.t === "creaturesOf") && typeof o.i === "number") return { ...o, i: o.i + offset } as T;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shiftTargets(v, offset)])) as T;
  }
  return value;
}

/** "Another target creature": fill in which permanent that means (the one the ability belongs to). */
export const bindSpecs = (specs: TargetSpec[], sourceIid: string): TargetSpec[] =>
  specs.some((x) => x.other || x.crewedIt) ? specs.map((x) => ({ ...x, ...(x.other ? { except: sourceIid } : {}), ...(x.crewedIt ? { crewOf: sourceIid } : {}) })) : specs;

export const isArtifactDef = (def: CardDef) => def.type === "artifact" || (def.typeLine ?? "").split("—")[0].includes("Artifact");

/** Cards that are put onto the battlefield when they resolve, instead of doing something and going to the graveyard. */
export const isPermanentCard = (def: CardDef) => def.type === "creature" || def.type === "artifact" || def.type === "enchantment" || def.type === "planeswalker";

export const isPlaneswalker = (s: GameState, p: Permanent) => getCard(s, p.card.defId).type === "planeswalker";

/** Enchantments, including enchantment creatures. */
export const isEnchantmentDef = (def: CardDef) => def.type === "enchantment" || (def.typeLine ?? "").split("—")[0].includes("Enchantment");

/** What protection looks at: the colors of a source, and whether it is an artifact. */
export const qualityOfDef = (def: CardDef): SourceQuality => ({ colors: def.colors ?? [], artifact: isArtifactDef(def) });
/** A permanent's colors now: its card's, unless something made it another color until end of turn. */
export const colorsOfPerm = (s: GameState, p: Permanent): string[] => p.tempColors ?? getCard(s, p.card.defId).colors ?? [];
export const qualityOfPerm = (s: GameState, p: Permanent): SourceQuality => ({ colors: colorsOfPerm(s, p), artifact: isArtifactDef(getCard(s, p.card.defId)) });

/** Is this permanent protected from sources with these qualities? ("Protection from red") */
/** Can damage be prevented right now? Not this turn after "damage can't be prevented this turn", nor while a permanent says "Damage can't be prevented." */
export function canPrevent(s: GameState): boolean {
  return !s.noPrevention && !Object.values(s.players).some((p) => p.battlefield.some((perm) => parseCard(getCard(s, perm.card.defId)).damageUnpreventable));
}

export function isProtectedFrom(s: GameState, perm: Permanent, source: SourceQuality): boolean {
  const protection = parseCard(getCard(s, perm.card.defId)).protection;
  if (!protection) return false;
  return source.colors.some((c) => protection.colors.includes(c)) || (source.artifact && protection.artifacts);
}

export { defSubtypes };

const controllerOf = (s: GameState, p: Permanent): PlayerId => (s.players.p1.battlefield.includes(p) ? "p1" : "p2");


/** A permanent's creature types (lowercase): the printed ones, plus any an Aura on it adds ("is an Angel in addition to its other types"). */
export function subtypesOf(s: GameState, p: Permanent): string[] {
  // A prepare card is its creature face on the battlefield: the spell's type line after " // " isn't part of it.
  // "~ becomes a Werewolf" replaces its creature types (unless an Aura has since made it something else).
  const override = p.card.defId.includes("@becomes-") ? undefined : p.subtypesOverride;
  const own = override ?? defSubtypes(getCard(s, p.card.defId));
  const printed = p.tempSubtypes || p.addedSubtypes ? [...own, ...(p.tempSubtypes ?? []), ...(p.addedSubtypes ?? [])] : own;
  const added = Object.values(s.players).flatMap((owner) =>
    owner.battlefield.filter((aura) => aura.attachedTo === p.card.iid).flatMap((aura) => (parseCard(getCard(s, aura.card.defId)).statics ?? []).flatMap((st) => (st.scope === "enchanted" ? (st.addSubtypes ?? []) : []))),
  );
  // "As long as there are two or more creature cards in your graveyard, this creature ... is all creature types."
  const def = getCard(s, p.card.defId);
  const owner = s.players.p1.battlefield.includes(p) ? "p1" : "p2";
  const everyType = (parseCard(def).statics ?? []).some((st) => st.allTypes && st.scope === "self" && (st.cond?.yardCreatures === undefined || yardCreatureCards(s, owner) >= st.cond.yardCreatures));
  const all = everyType ? [...new Set([...printed, ...added, ...CREATURE_TYPES])] : added.length ? [...printed, ...added] : printed;
  return p.tempLostSubtypes ? all.filter((t) => !p.tempLostSubtypes!.includes(t)) : all;
}

/** How many creature cards are in a player's graveyard. */
export const yardCreatureCards = (s: GameState, player: PlayerId): number => s.players[player].graveyard.filter((c) => getCard(s, c.defId).type === "creature").length;

const CARD_TYPE_WORDS = ["artifact", "battle", "creature", "enchantment", "instant", "kindred", "land", "planeswalker", "sorcery"];

/** The card types among the cards in a player's graveyard ("Artifact Creature" counts both). */
export function yardCardTypes(s: GameState, player: PlayerId): string[] {
  const seen = new Set<string>();
  for (const c of s.players[player].graveyard) {
    const def = getCard(s, c.defId);
    const line = (def.typeLine ?? def.type).split(" // ")[0].split("—")[0].toLowerCase().replace(/\btribal\b/, "kindred");
    for (const t of CARD_TYPE_WORDS) if (new RegExp(`\\b${t}\\b`).test(line)) seen.add(t);
  }
  return CARD_TYPE_WORDS.filter((t) => seen.has(t));
}

/** Metalcraft: the artifacts a player controls. */
export const artifactCount = (s: GameState, player: PlayerId): number => s.players[player].battlefield.filter((p) => isArtifactDef(getCard(s, p.card.defId)) || (p.crewed === true && !p.tempNonartifact)).length;

/** Delirium: four or more card types among the cards in the player's graveyard. */
export const hasDelirium = (s: GameState, player: PlayerId): boolean => yardCardTypes(s, player).length >= 4;

/** The continuous effects (auras, "creatures you control get +1/+1") that apply to `target` right now. */
export function staticEffectsOn(s: GameState, target: Permanent): StaticEffect[] {
  const out: StaticEffect[] = [];
  const controller = controllerOf(s, target);
  const creature = isCreature(s, target);
  for (const owner of Object.values(s.players)) {
    for (const source of owner.battlefield) {
      for (const st of parseCard(getCard(s, source.card.defId)).statics ?? []) {
        if (st.cond?.yourTurn && s.active !== owner.id) continue;
        if (st.level && (source.classLevel ?? 1) < st.level) continue;
        if (st.attackingOnly && !s.combat?.attackers.some((a) => a.attacker === target.card.iid)) continue;
        if (st.cond?.drawnAtLeast !== undefined && (s.players[owner.id].drawnThisTurn ?? 0) < st.cond.drawnAtLeast) continue;
        if (st.cond?.lifeAtLeast !== undefined && s.players[owner.id].life < st.cond.lifeAtLeast) continue;
        if (st.cond?.lostLife && !(s.players[owner.id].lifeLostThisTurn ?? 0)) continue;
        if (st.tokensOnly && !isToken(target.card)) continue;
        if (st.withCounters && !((target.counters ?? 0) > 0)) continue;
        if (st.withKeyword && !ownKeyword(s, target, st.withKeyword)) continue;
        if (st.cond?.artifactCreatureOrPlan && !s.players[owner.id].battlefield.some((p) => { const d = getCard(s, p.card.defId); return (isArtifactDef(d) && d.type === "creature") || defSubtypes(d).includes("plan"); })) continue;
        if (st.cond?.powerAtMost !== undefined && basePT(s, source, "power") + (source.counters ?? 0) - (source.minusCounters ?? 0) + (source.powerBonus ?? 0) > st.cond.powerAtMost) continue;
        if (st.cond?.selfCounteredThisTurn && !(source.countersThisTurn ?? 0)) continue;
        if (st.targetCounteredThisTurn && !(target.countersThisTurn ?? 0)) continue;
        if (st.cond?.yardCreatures !== undefined && yardCreatureCards(s, owner.id) < st.cond.yardCreatures) continue;
        if (st.cond?.delirium && !hasDelirium(s, owner.id)) continue;
        if (st.cond?.yardAtLeast !== undefined && s.players[owner.id].graveyard.length < st.cond.yardAtLeast) continue; // threshold
        if (st.cond?.handEmpty && s.players[owner.id].hand.length > 0) continue; // hellbent
        if (st.cond?.artifactsAtLeast !== undefined && artifactCount(s, owner.id) < st.cond.artifactsAtLeast) continue; // metalcraft
        if (st.cond?.enteredThisTurn && source.enteredTurn !== s.turn) continue;
        if (st.cond?.controls && !s.players[owner.id].battlefield.some((p) => subtypesOf(s, p).includes(st.cond!.controls!))) continue;
        if (st.cond?.attacking && !s.combat?.attackers.some((a) => a.attacker === source.card.iid)) continue;
        if (st.tappedOnly && !target.tapped) continue;
        if (st.untappedOnly && target.tapped) continue;
        if (st.subtypes) {
          const line = subtypesOf(s, target);
          if (!st.subtypes.some((t) => line.includes(t))) continue;
        }
        const counted = st.per ? { ...st, power: st.power * countFor(s, owner.id, st.per, source.card.iid), toughness: st.toughness * countFor(s, owner.id, st.per, source.card.iid) } : st;
        if (st.scope === "self") {
          if (source === target) out.push(counted);
          continue;
        }
        if (st.scope === "enchanted") {
          if (source.attachedTo === target.card.iid) out.push(counted);
          continue;
        }
        if (!creature || (st.other && source === target)) continue;
        if (st.scope === "yours" && owner.id !== controller) continue;
        if (st.scope === "opponents" && owner.id === controller) continue;
        out.push(counted);
      }
    }
  }
  if (creature) for (const emblem of s.players[controller].emblems ?? []) out.push(emblem.static);
  return out;
}

/** Does a continuous effect forbid this? ("Enchanted creature can't attack or block.") */
export const forbidden = (s: GameState, p: Permanent, what: "cantAttack" | "cantBlock" | "noUntap" | "noActivated") =>
  staticEffectsOn(s, p).some((st) => st[what] === true) || (what === "cantBlock" && p.cantBlockTurn === true);
export const nameOf = (s: GameState, p: Permanent) => getCard(s, p.card.defId).name;

// "Until end of turn" bonuses count, so a pumped creature really is bigger.
/** How many things a "*" power and toughness counts right now. */
export function dynamicCount(s: GameState, p: Permanent, spec: CountSpec): number {
  return countFor(s, controllerOf(s, p), spec);
}

const creaturesOf = (s: GameState, me: PlayerId) => s.players[me].battlefield.filter((p) => isCreature(s, p));
/** The mana symbols of a card's cost: "{1}{G}{G}" -> ["{1}", "{G}", "{G}"] (a hybrid "{R/G}" counts for both colors). */
const manaSymbols = (def: CardDef) => def.manaCost?.match(/\{[^}]+\}/g) ?? [];

/** The count for a player: "the number of Mountains you control". */
export function countFor(s: GameState, me: PlayerId, spec: CountSpec, sourceIid?: string): number {
  if (spec.kind === "hand") return s.players[me].hand.length;
  if (spec.kind === "graveyard") {
    return s.players[me].graveyard.filter((c) => {
      const def = getCard(s, c.defId);
      if (spec.adventures && /\bAdventure\b/.test(def.typeLine ?? "")) return true;
      return spec.spellsOnly ? def.type === "instant" || def.type === "sorcery" : !spec.creaturesOnly || def.type === "creature";
    }).length;
  }
  if (spec.kind === "attackers") {
    return (s.combat?.attackers ?? []).filter((a) => {
      const perm = s.players[me].battlefield.find((p) => p.card.iid === a.attacker);
      if (!perm || (spec.other && perm.card.iid === sourceIid)) return false;
      return !spec.subtype || subtypesOf(s, perm).includes(spec.subtype);
    }).length;
  }
  if (spec.kind === "yardsAll") return Object.values(s.players).reduce((n, p) => n + p.graveyard.filter((c) => getCard(s, c.defId).type === spec.cardType).length, 0);
  if (spec.kind === "attackingYou") return (s.combat?.attackers ?? []).filter((a) => !a.target && s.players[OPPONENT[me]].battlefield.some((p) => p.card.iid === a.attacker)).length;
  if (spec.kind === "opponents") return 1;
  if (spec.kind === "discardedThisTurn") return s.players[me].discardedThisTurn ?? 0;
  if (spec.kind === "handDeficit") return Math.max(0, spec.to - s.players[me].hand.length);
  if (spec.kind === "greatestMVYard") return Math.max(0, ...s.players[me].graveyard.map((c) => getCard(s, c.defId).cost));
  if (spec.kind === "cavesAndYard") {
    const isCave = (defId: string) => new RegExp(String.fromCharCode(92)+"bCave"+String.fromCharCode(92)+"b").test(getCard(s, defId).typeLine ?? "");
    return s.players[me].battlefield.filter((p) => isCave(p.card.defId)).length + s.players[me].graveyard.filter((c) => isCave(c.defId)).length;
  }
  if (spec.kind === "greatestMV") {
    const counted = s.players[me].battlefield.filter((p) => (spec.what === "subtype" ? subtypesOf(s, p).includes(spec.subtype ?? "?") : isArtifactDef(getCard(s, p.card.defId))));
    return Math.max(0, ...counted.map((p) => getCard(s, p.card.defId).cost));
  }
  if (spec.kind === "totalPower") return creaturesOf(s, me).reduce((n, p) => n + Math.max(0, powerOf(s, p)), 0);
  if (spec.kind === "greatestPower") return Math.max(0, ...creaturesOf(s, me).map((p) => powerOf(s, p)));
  if (spec.kind === "devotion") return s.players[me].battlefield.reduce((n, p) => n + manaSymbols(getCard(s, p.card.defId)).filter((sym) => sym.includes(spec.color)).length, 0);
  if (spec.kind === "toughnessGtPower") return s.players[me].battlefield.filter((p) => isCreature(s, p) && toughnessOf(s, p) > powerOf(s, p)).length;
  if (spec.kind !== "permanents") return 0; // the other kinds need the context of the effect (see runEffects)
  let n = 0;
  for (const owner of Object.values(s.players)) {
    if (spec.scope === "you" && owner.id !== me) continue;
    if (spec.scope === "opponents" && owner.id === me) continue;
    for (const perm of owner.battlefield) {
      const def = getCard(s, perm.card.defId);
      if (spec.other && perm.card.iid === sourceIid) continue;
      if (spec.nontoken && isToken(perm.card)) continue;
      if (spec.what === "subtype") {
        if (subtypesOf(s, perm).includes(spec.subtype ?? "?")) n++;
        continue;
      }
      if (spec.what === "creature" ? def.type === "creature" : spec.what === "land" ? def.type === "land" : spec.what === "artifact" ? isArtifactDef(def) : spec.what === "enchantment" ? isEnchantmentDef(def) : def.type === "land" && (def.typeLine ?? "").includes(spec.landType ?? "?")) n++;
    }
  }
  return n;
}

/** Printed power or toughness; a "*" is worked out from the board. */
function basePT(s: GameState, p: Permanent, which: "power" | "toughness"): number {
  if (p.tempBase) return p.tempBase[which]; // "becomes a 4/4 until end of turn"
  if (p.baseOverride) return p.baseOverride[which]; // "is a 1/1 Spirit in addition to its other types"
  if (which === "power" && p.powerFromHand) return s.players[s.players.p1.battlefield.includes(p) ? "p1" : "p2"].hand.length;
  const def = getCard(s, p.card.defId);
  const printed = def[which];
  if (printed !== undefined) return printed;
  const dyn = parseCard(def).dynamicStats;
  return dyn ? dynamicCount(s, p, dyn) : 0;
}

// Continuous effects from Auras and anthems count too.
export const powerOf = (s: GameState, p: Permanent) =>
  basePT(s, p, "power") + (p.counters ?? 0) - (p.minusCounters ?? 0) + (p.powerBonus ?? 0) + staticEffectsOn(s, p).reduce((n, st) => n + st.power, 0);
export const toughnessOf = (s: GameState, p: Permanent) =>
  basePT(s, p, "toughness") + (p.counters ?? 0) - (p.minusCounters ?? 0) + (p.toughnessBonus ?? 0) + staticEffectsOn(s, p).reduce((n, st) => n + st.toughness, 0);

/** Printed keywords plus ones granted until end of turn. */
/** The most cards a player keeps in hand at the end of the turn: seven, or what a permanent of theirs says. */
export function handLimit(s: GameState, player: PlayerId): number {
  let limit = 7;
  for (const p of s.players[player].battlefield) {
    const own = parseCard(getCard(s, p.card.defId)).maxHandSize;
    if (own !== undefined) limit = Math.max(limit === 7 ? 0 : limit, own);
  }
  return limit;
}

/** A keyword the permanent has without counting static effects (which would ask this again). */
const ownKeyword = (s: GameState, p: Permanent, keyword: Keyword) =>
  hasKeyword(getCard(s, p.card.defId), keyword) || (p.tempKeywords ?? []).includes(keyword) || (p.kwCounters ?? []).includes(keyword);

export const kw = (s: GameState, p: Permanent, keyword: Keyword) =>
  !(keyword === "defender" && p.tempNoDefender) && (
  hasKeyword(getCard(s, p.card.defId), keyword) || (p.tempKeywords ?? []).includes(keyword) || (p.kwCounters ?? []).includes(keyword) || staticEffectsOn(s, p).some((st) => st.keywords.includes(keyword)));

/** Keywords the permanent has right now that its card doesn't print and that don't wear off this turn: from counters and static effects (delirium, anthems, Equipment). */
export function gainedKeywords(s: GameState, p: Permanent): Keyword[] {
  const def = getCard(s, p.card.defId);
  const gained = new Set<Keyword>([...(p.kwCounters ?? []), ...staticEffectsOn(s, p).flatMap((st) => st.keywords)]);
  return [...gained].filter((k) => !hasKeyword(def, k) && !(p.tempKeywords ?? []).includes(k));
}

export function findPermanentOrNull(state: GameState, iid: string): { owner: PlayerState; perm: Permanent } | null {
  for (const owner of Object.values(state.players)) {
    const perm = owner.battlefield.find((p) => p.card.iid === iid);
    if (perm) return { owner, perm };
  }
  return null;
}

export function findPermanent(state: GameState, iid: string): { owner: PlayerState; perm: Permanent } {
  const found = findPermanentOrNull(state, iid);
  if (!found) throw new Error(`No permanent ${iid} on the battlefield`);
  return found;
}

export const onBoard = (state: GameState, iid: string) => findPermanentOrNull(state, iid) !== null;

/** Damage that is lethal to `blocker` from `attacker`: 1 is enough if the attacker has deathtouch. */
export function lethalFor(s: GameState, attacker: Permanent, blocker: Permanent): number {
  if (kw(s, attacker, "deathtouch")) return 1;
  return Math.max(0, toughnessOf(s, blocker) - blocker.damage);
}

export const newId = (state: GameState): string => `s${state.nextId++}`;

/** The player who must act right now. */
export function playerToAct(state: GameState): PlayerId {
  if (state.pendingPick) return state.pendingPick.player;
  if (state.pendingChoice) return state.pendingChoice.player;
  if (state.priority) return state.priority.holder;
  if (state.phase === "mulligan" && state.opening) {
    // Starting player decides first (rule 103.5), then the other player.
    const order = [state.startingPlayer, OPPONENT[state.startingPlayer]];
    // Before that, each player shuffles the other's library, the starting player first.
    const shuffled = state.opening.shuffled;
    if (shuffled && !(shuffled.p1 && shuffled.p2)) return order.find((p) => !shuffled[p]) ?? state.active;
    return order.find((p) => !state.opening!.kept[p]) ?? state.active;
  }
  return state.phase === "blockers" ? OPPONENT[state.active] : state.active;
}
