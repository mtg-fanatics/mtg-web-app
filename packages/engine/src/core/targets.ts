import { getCard } from "../cards.js";
import type { Ref, RunContext, StackItem, TargetChoice, TargetSpec } from "../effects.js";
import { manaCostOf } from "../mana.js";
import { parseCard } from "../oracle.js";
import { OPPONENT } from "../types.js";
import type { CardInstance, GameState, Permanent, PlayerId } from "../types.js";
import {
  colorsOfPerm,
  defSubtypes,
  findPermanentOrNull,
  isArtifactDef,
  isCreature,
  isEnchantmentDef,
  isPermanentCard,
  isPlaneswalker,
  isProtectedFrom,
  kw,
  powerOf,
  subtypesOf,
  toughnessOf,
} from "./permanents.js";

// Legal targets, and the players, permanents and cards an effect applies to.

/** "Creatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof." */
export function ignoresHexproof(state: GameState, player: PlayerId): boolean {
  return state.players[player].battlefield.some((p) => parseCard(getCard(state, p.card.defId)).ignoresHexproof);
}

/** Can `choice` be a target for `spec` of something controlled by `controller`? `ignoreStackId` excludes the spell itself. */
export function isLegalTarget(state: GameState, spec: TargetSpec, choice: TargetChoice, controller: PlayerId, ignoreStackId?: string): boolean {
  switch (choice.kind) {
    case "player":
      if (choice.id !== controller && state.players[choice.id].battlefield.some((p) => parseCard(getCard(state, p.card.defId)).youHexproof)) return false; // "You have hexproof"
      return (spec.kind === "player" || spec.kind === "any" || spec.kind === "playerOrPlaneswalker") && (!spec.opponentOnly || choice.id !== controller);
    case "permanent": {
      const found = findPermanentOrNull(state, choice.iid);
      if (!found) return false;
      const def = getCard(state, found.perm.card.defId);
      // Protection: it can't be targeted by spells or abilities with the quality it is protected from.
      if (spec.source && isProtectedFrom(state, found.perm, spec.source)) return false;
      // Hexproof: only its controller can target it (unless the targeting player has Nowhere to Run).
      if (found.owner.id !== controller && kw(state, found.perm, "hexproof") && !ignoresHexproof(state, controller)) return false;
      // "Hexproof from white": spells and abilities of that color (or kind) an opponent controls can't target it
      const hexFrom = parseCard(def).hexproofFrom;
      if (hexFrom && found.owner.id !== controller && spec.source && (spec.source.colors.some((c) => hexFrom.includes(c)) || (spec.source.type !== undefined && hexFrom.includes(spec.source.type)))) return false;
      if (kw(state, found.perm, "shroud")) return false; // shroud: nobody can target it, not even its controller
      if (found.perm.untargetableBy?.includes(controller)) return false; // "can't be the target of spells or abilities your opponents control this turn"
      if (spec.except && spec.except === choice.iid) return false; // "another target creature"
      if (spec.crewOf && !findPermanentOrNull(state, spec.crewOf)?.perm.crewedBy?.includes(choice.iid)) return false;
      if (spec.subtype && !subtypesOf(state, found.perm).includes(spec.subtype)) return false;
      if (spec.notSubtype && subtypesOf(state, found.perm).includes(spec.notSubtype)) return false;
      if (!mvFits(spec, def.cost)) return false;
      if (spec.colorsAny && !spec.colorsAny.some((c) => colorsOfPerm(state, found.perm).includes(c))) return false;
      if (spec.filter === "tapped" && !found.perm.tapped) return false;
      if (spec.kind === "permanent") {
        // "enchant permanent", or "target nonland permanent an opponent controls", or "target creature or enchantment"
        if (spec.nonland && def.type === "land") return false;
        const creatureFits = () => (def.type === "creature" || found.perm.crewed === true) && (!spec.creatureWith || kw(state, found.perm, spec.creatureWith)); // "or creature with flying"
        const fits = (t: string) => (t === "creature" ? creatureFits() : t === "artifact" ? isArtifactDef(def) || animatedArtifact(found.perm) : t === "enchantment" ? isEnchantmentDef(def) : t === "vehicle" ? defSubtypes(def).includes("vehicle") : def.type === t);
        if (spec.types && !spec.types.some(fits)) return false;
        if (spec.controller === "you" && found.owner.id !== controller) return false;
        if (spec.controller === "opponent" && found.owner.id === controller) return false;
        return spec.owner !== "you" || found.perm.card.owner === controller;
      }
      if (spec.kind === "land") return def.type === "land";
      const walker = def.type === "planeswalker";
      if (spec.kind === "planeswalker") return walker;
      if (spec.kind === "playerOrPlaneswalker") return walker;
      if (walker) return (spec.kind === "any" || spec.kind === "creatureOrPlaneswalker") && !(spec.controller === "you" && found.owner.id !== controller) && !(spec.controller === "opponent" && found.owner.id === controller);
      if (spec.kind === "enchantment") return isEnchantmentDef(def);
      if (spec.kind === "artifactOrEnchantment") return (isArtifactDef(def) || isEnchantmentDef(def)) && !(spec.noncreature && def.type === "creature");
      if (spec.kind === "artifact") return (isArtifactDef(def) || animatedArtifact(found.perm)) && !(spec.noncreature && (def.type === "creature" || found.perm.crewed === true));
      if (spec.kind === "artifactOrLand") return def.type === "land" || isArtifactDef(def);
      if (spec.kind !== "creature" && spec.kind !== "any" && spec.kind !== "creatureOrPlaneswalker") return false;
      if (def.type !== "creature" && !found.perm.crewed) return false;
      if (spec.controller === "you" && found.owner.id !== controller) return false;
      if (spec.controller === "opponent" && found.owner.id === controller) return false;
      if (spec.toughness && !statFits(spec.toughness, toughnessOf(state, found.perm))) return false;
      if (spec.notArtifact && isArtifactDef(def)) return false;
      if (spec.nonlegendary && /\bLegendary\b/.test(def.typeLine ?? "")) return false;
      if (spec.power && !statFits(spec.power, powerOf(state, found.perm))) return false;
      if (spec.totalPTMax !== undefined && powerOf(state, found.perm) + toughnessOf(state, found.perm) > spec.totalPTMax) return false;
      if (spec.keyword && kw(state, found.perm, spec.keyword.name) !== spec.keyword.has) return false;
      if (spec.stunned && !found.perm.stun) return false;
      if (spec.filter && spec.filter !== "tapped") {
        const attacking = state.combat?.attackers.some((a) => a.attacker === choice.iid) ?? false;
        const blocking = state.combat?.attackers.some((a) => a.blockers.includes(choice.iid)) ?? false;
        if (spec.filter === "notAttacking") {
          if (attacking) return false;
        } else if (spec.filter === "attackingAlone") {
          if (!attacking || state.combat?.attackers.length !== 1) return false;
        } else if (spec.filter === "attacking" ? !attacking : spec.filter === "blocking" ? !blocking : !(attacking || blocking)) return false;
      }
      return !spec.notColors?.some((c) => colorsOfPerm(state, found.perm).includes(c));
    }
    case "card": {
      if (spec.kind !== "graveyardCreature" && spec.kind !== "graveyardSpell" && spec.kind !== "graveyardPermanent" && spec.kind !== "graveyardCard") return false;
      const owner = Object.values(state.players).find((p) => p.graveyard.some((c) => c.iid === choice.iid));
      const card = owner?.graveyard.find((c) => c.iid === choice.iid);
      if (!owner || !card || spec.except === choice.iid) return false;
      const def = getCard(state, card.defId);
      const fits = spec.kind === "graveyardCreature" ? def.type === "creature" : spec.kind === "graveyardPermanent" ? isPermanentCard(def) || def.type === "land" : spec.kind === "graveyardCard" ? true : def.type === "instant" || def.type === "sorcery";
      if (!fits || (spec.subtype && !defSubtypes(def).includes(spec.subtype))) return false;
      if (spec.kind === "graveyardSpell" && spec.types && !spec.types.includes(def.type)) return false; // "target sorcery card"
      if (spec.kind === "graveyardPermanent" && spec.types && !spec.types.some((t) => (t === "artifact" ? isArtifactDef(def) : t === "enchantment" ? isEnchantmentDef(def) : def.type === t))) return false;
      if (spec.subtypes && !spec.subtypes.some((t) => defSubtypes(def).includes(t))) return false;
      if (spec.notSubtype && defSubtypes(def).includes(spec.notSubtype)) return false;
      if (spec.nonland && def.type === "land") return false;
      if (!mvFits(spec, def.cost)) return false;
      return spec.controller !== "you" || owner.id === controller;
    }
    case "none":
      return spec.optional === true;
    case "stack": {
      const item = state.stack.find((i) => i.id === choice.id && i.id !== ignoreStackId);
      if (!item) return false;
      if (item.kind === "ability") return spec.orTriggered === true && item.trigger === true;
      if (spec.orSpell) return true; // "target spell or permanent": any spell on the stack
      if (spec.kind !== "spell") return false;
      const def = getCard(state, item.card.defId);
      if (!mvFits(spec, def.cost + (manaCostOf(def)?.x ?? 0) * item.x)) return false; // on the stack, X is the number chosen
      if (spec.colorless && (def.colors ?? []).length > 0) return false;
      if (spec.spellColor && !(def.colors ?? []).includes(spec.spellColor)) return false;
      if (spec.spellColors && !spec.spellColors.some((c) => (def.colors ?? []).includes(c))) return false;
      if (!spec.spellKind) return true;
      const creature = def.type === "creature";
      if (spec.spellKind === "creatureOrEnchantment") return creature || isEnchantmentDef(def);
      if (spec.spellKind === "artifactOrEnchantment") return isArtifactDef(def) || isEnchantmentDef(def);
      return spec.spellKind === "creature" ? creature : spec.spellKind === "noncreature" ? !creature : creature || isArtifactDef(def);
    }
  }
}

/** "With mana value 2 or less / 2 or greater / 2". */
/** "All creatures with power 4 or greater" / "with mana value 3 or less". */
function statsFit(state: GameState, perm: Permanent, ref: Extract<Ref, { t: "allCreatures" }>): boolean {
  if (ref.power && !statFits(ref.power, powerOf(state, perm))) return false;
  return !ref.mv || statFits(ref.mv, getCard(state, perm.card.defId).cost);
}

function mvFits(spec: TargetSpec, mv: number): boolean {
  return spec.mv ? statFits(spec.mv, mv) : true;
}

/** "Power 2 or less", "toughness 4 or greater", a 1/1 creature (exactly 1). */
function statFits(f: { n: number; op: "min" | "max" | "eq" }, value: number): boolean {
  return f.op === "min" ? value >= f.n : f.op === "max" ? value <= f.n : value === f.n;
}

/** Everything that could be chosen for `spec`. */
export function legalTargets(state: GameState, spec: TargetSpec, controller: PlayerId, ignoreStackId?: string): TargetChoice[] {
  const out: TargetChoice[] = [];
  for (const id of ["p1", "p2"] as const) {
    const choice: TargetChoice = { kind: "player", id };
    if (isLegalTarget(state, spec, choice, controller, ignoreStackId)) out.push(choice);
  }
  for (const player of Object.values(state.players)) {
    for (const perm of player.battlefield) {
      const choice: TargetChoice = { kind: "permanent", iid: perm.card.iid };
      if (isLegalTarget(state, spec, choice, controller, ignoreStackId)) out.push(choice);
    }
    for (const card of player.graveyard) {
      const choice: TargetChoice = { kind: "card", iid: card.iid };
      if (isLegalTarget(state, spec, choice, controller, ignoreStackId)) out.push(choice);
    }
  }
  for (const item of state.stack) {
    const choice: TargetChoice = { kind: "stack", id: item.id };
    if (isLegalTarget(state, spec, choice, controller, ignoreStackId)) out.push(choice);
  }
  if (spec.optional) out.push({ kind: "none" }); // "up to one": choosing nothing is always possible
  return out;
}

/** A crewed Vehicle or an animated Inkmoth Nexus is an artifact creature; an animated Treetop Village is just a creature. */
const animatedArtifact = (p: Permanent) => p.crewed === true && !p.tempNonartifact;

type Subject =
  | { k: "player"; id: PlayerId }
  | { k: "perm"; perm: Permanent; owner: PlayerId }
  | { k: "card"; card: CardInstance; owner: PlayerId } // a card in a graveyard
  | { k: "stack"; item: StackItem };

const creaturesOfPlayer = (state: GameState, owner: PlayerId): Subject[] =>
  state.players[owner].battlefield.filter((perm) => isCreature(state, perm)).map((perm): Subject => ({ k: "perm", perm, owner }));

export function subjectsOf(state: GameState, ref: Ref, ctx: RunContext): Subject[] {
  switch (ref.t) {
    case "you":
      return [{ k: "player", id: ctx.controller }];
    case "opp":
      return [{ k: "player", id: OPPONENT[ctx.controller] }];
    case "eachPlayer":
      return [{ k: "player", id: "p1" }, { k: "player", id: "p2" }];
    case "self": {
      const found = findPermanentOrNull(state, ctx.sourceId);
      return found ? [{ k: "perm", perm: found.perm, owner: found.owner.id }] : [];
    }
    case "allCreatures": {
      const skip = ref.except !== undefined && ctx.targets[ref.except]?.kind === "permanent" ? (ctx.targets[ref.except] as { iid: string }).iid : undefined;
      return Object.values(state.players)
        .filter((p) => ref.scope === "all" || (ref.scope === "yours") === (p.id === ctx.controller))
        .flatMap((p) => p.battlefield.filter((perm) => isCreature(state, perm) && perm.card.iid !== skip && !(ref.notSelf && perm.card.iid === ctx.sourceId) && !(ref.noFlying && kw(state, perm, "flying")) && !(ref.flying && !kw(state, perm, "flying")) && !(ref.attacked && !perm.attackedThisTurn) && (ref.tapped === undefined || perm.tapped === ref.tapped) && (!ref.subtype || subtypesOf(state, perm).includes(ref.subtype)) && (!ref.notSubtype || !subtypesOf(state, perm).includes(ref.notSubtype)) && statsFit(state, perm, ref)).map((perm): Subject => ({ k: "perm", perm, owner: p.id })));
    }
    case "allLands":
      return Object.values(state.players).flatMap((p) => p.battlefield.filter((perm) => getCard(state, perm.card.defId).type === "land").map((perm): Subject => ({ k: "perm", perm, owner: p.id })));
    case "allPlaneswalkers":
      return Object.values(state.players).flatMap((p) => p.battlefield.filter((perm) => isPlaneswalker(state, perm)).map((perm): Subject => ({ k: "perm", perm, owner: p.id })));
    case "ownerOf":
    case "controllerOf": {
      const choice = ctx.targets[ref.i];
      if (choice?.kind !== "permanent" && choice?.kind !== "card") return [];
      const iid = choice.iid;
      const now = findPermanentOrNull(state, iid);
      const controller = ctx.lki?.[iid] ?? now?.owner.id;
      const owner = now?.perm.card.owner ?? (iid.startsWith("p1-") ? "p1" : iid.startsWith("p2-") ? "p2" : controller);
      const who = ref.t === "ownerOf" ? owner : (controller ?? owner);
      return who ? [{ k: "player", id: who }] : [];
    }
    case "enchanted": {
      const source = findPermanentOrNull(state, ctx.sourceId)?.perm;
      const host = source?.attachedTo ? findPermanentOrNull(state, source.attachedTo) : null;
      return host ? [{ k: "perm", perm: host.perm, owner: host.owner.id }] : [];
    }
    case "other": {
      const found = ctx.other ? findPermanentOrNull(state, ctx.other) : null;
      return found ? [{ k: "perm", perm: found.perm, owner: found.owner.id }] : [];
    }
    case "attackingCreatures":
      return (state.combat?.attackers ?? []).filter((a) => !(ref.other && a.attacker === ctx.sourceId)).flatMap((a) => {
        const found = findPermanentOrNull(state, a.attacker);
        return found ? [{ k: "perm", perm: found.perm, owner: found.owner.id } as Subject] : [];
      });
    case "creaturesOf": {
      const choice = ctx.targets[ref.i];
      const spec = ctx.specs[ref.i];
      if (!choice || !spec || choice.kind !== "player" || !isLegalTarget(state, spec, choice, ctx.controller, ctx.stackId)) return [];
      return creaturesOfPlayer(state, choice.id);
    }
    case "target": {
      const choice = ctx.targets[ref.i];
      const spec = ctx.specs[ref.i];
      // A target that is no longer legal (it died, left, or was countered) is simply skipped.
      if (!choice || !spec || choice.kind === "none" || !isLegalTarget(state, spec, choice, ctx.controller, ctx.stackId)) return [];
      if (choice.kind === "player") return [{ k: "player", id: choice.id }];
      if (choice.kind === "card") {
        const owner = Object.values(state.players).find((p) => p.graveyard.some((c) => c.iid === choice.iid));
        const card = owner?.graveyard.find((c) => c.iid === choice.iid);
        return owner && card ? [{ k: "card", card, owner: owner.id }] : [];
      }
      if (choice.kind === "permanent") {
        const found = findPermanentOrNull(state, choice.iid);
        return found ? [{ k: "perm", perm: found.perm, owner: found.owner.id }] : [];
      }
      const item = state.stack.find((i) => i.id === choice.id);
      return item ? [{ k: "stack", item }] : [];
    }
  }
}
