import type { Ref, TargetSpec } from "../effects.js";
import { CREATURE_TYPES } from "../creatureTypes.js";
import { CARD_TYPES, COLOR_OF, isKeyword, singularType } from "./words.js";

// What a sentence points at: targets ("target creature an opponent controls") and references ("it", "that player").

export interface Ctx {
  /** In triggers and activated abilities "it" is the permanent itself; in a spell it is the last thing targeted. */
  allowSelf?: boolean;
  targets: TargetSpec[];
  /** The same phrase twice in one text ("target creature ... that creature") is one target. */
  phrases: Map<string, number>;
  /** A block trigger: "that creature" is the creature on the other side of the block. */
  hasOther?: boolean;
  /** In an ally-enters trigger, "it" is the creature that entered (not the permanent itself). */
  itIsOther?: boolean;
  usedOther?: boolean;
}

const SPELL_KINDS: Record<string, NonNullable<TargetSpec["spellKind"]>> = {
  creature: "creature",
  noncreature: "noncreature",
  "artifact or creature": "artifactOrCreature",
  "creature or enchantment": "creatureOrEnchantment",
  "artifact or enchantment": "artifactOrEnchantment",
};

/** A target phrase: "target creature", "another target creature you control", "target creature with mana value 2 or greater". */
export function targetSpec(phrase: string): TargetSpec | null {
  const nonType = /^target non-([a-z]+) creature( you control| an opponent controls)?$/.exec(phrase);
  if (nonType) {
    const inner = targetSpecBase(`target creature${nonType[2] ?? ""}`);
    return inner ? { ...inner, notSubtype: nonType[1], label: phrase } : null;
  }
  if (phrase === "target creature you control that's attacking alone") return { kind: "creature", controller: "you", filter: "attackingAlone", label: phrase };
  if (phrase === "target spell or permanent") return { kind: "permanent", orSpell: true, label: phrase };
  if (phrase === "target spell or creature") return { kind: "permanent", types: ["creature"], orSpell: true, label: phrase };
  if (phrase.startsWith("another ")) {
    const inner = targetSpec(phrase.slice(8));
    return inner ? { ...inner, other: true, label: phrase } : null;
  }
  const stat = / with (power|toughness|mana value) (\d+) or (less|greater)/.exec(phrase);
  if (stat) {
    const inner = targetSpecBase(phrase.replace(stat[0], ""));
    if (!inner) return null;
    const f = { n: Number(stat[2]), op: stat[3] === "less" ? ("max" as const) : ("min" as const) };
    return { ...inner, ...(stat[1] === "power" ? { power: f } : stat[1] === "toughness" ? { toughness: f } : { mv: f }), label: phrase };
  }
  // "target 1/1 creature"
  const exactPT = /^target (\d+)\/(\d+) creature(.*)$/.exec(phrase);
  if (exactPT) {
    const inner = targetSpecBase(`target creature${exactPT[3]}`);
    return inner ? { ...inner, power: { n: Number(exactPT[1]), op: "eq" }, toughness: { n: Number(exactPT[2]), op: "eq" }, label: phrase } : null;
  }
  const exactMV = / with mana value (\d+)$/.exec(phrase);
  if (exactMV) {
    const inner = targetSpecBase(phrase.slice(0, exactMV.index));
    return inner ? { ...inner, mv: { n: Number(exactMV[1]), op: "eq" }, label: phrase } : null;
  }
  return targetSpecBase(phrase);
}

function targetSpecBase(phrase: string): TargetSpec | null {
  // "target Goblin you control": a creature of that type
  const ofType = /^target ([a-z]+) you control$/.exec(phrase);
  if (ofType && !/^(creature|land|artifact|enchantment|permanent|planeswalker|player|opponent|spell|nonland)$/.test(ofType[1])) {
    return { kind: "creature", subtype: ofType[1], controller: "you", label: phrase };
  }
  // Olivia Voldaren: "target Vampire"
  const anyOfType = /^target ([a-z]+)$/.exec(phrase);
  if (anyOfType && CREATURE_TYPES.includes(anyOfType[1])) return { kind: "creature", subtype: anyOfType[1], label: phrase };
  // "target creature or enchantment", "target artifact or enchantment an opponent controls", "target creature or enchantment you own"
  const kinds = /^target ((?:creature|artifact|enchantment|land|planeswalker)(?:(?:, | or |, or )(?:creature|artifact|enchantment|land|planeswalker))+)( you control| an opponent controls| you own)?$/.exec(phrase);
  if (kinds && !/^target (?:artifact or land|artifact or enchantment|creature or planeswalker)$/.test(phrase)) {
    const whose = kinds[2]?.trim();
    return { kind: "permanent", types: kinds[1].split(/, or |, | or /), ...(whose === "you own" ? { controller: "you" as const, owner: "you" as const } : whose ? { controller: whose === "you control" ? ("you" as const) : ("opponent" as const) } : {}), label: phrase };
  }
  if (phrase === "any target") return { kind: "any", label: phrase };
  if (phrase === "any other target") return { kind: "any", other: true, label: phrase };
  if (phrase === "target creature or player" || phrase === "target player or creature") return { kind: "any", label: phrase };
  if (phrase === "target player or planeswalker") return { kind: "playerOrPlaneswalker", label: phrase };
  if (phrase === "target creature or planeswalker") return { kind: "creatureOrPlaneswalker", label: phrase };
  if (phrase === "target planeswalker") return { kind: "planeswalker", label: phrase };
  if (phrase === "target spell") return { kind: "spell", label: phrase };
  if (phrase === "target colorless spell") return { kind: "spell", colorless: true, label: phrase };
  if (phrase === "target triggered ability or colorless spell") return { kind: "spell", colorless: true, orTriggered: true, label: phrase };
  if (phrase === "target creature that crewed it this turn") return { kind: "creature", crewedIt: true, label: phrase };
  // Cut Down
  const totalPT = /^target creature with total power and toughness (\d+) or less$/.exec(phrase);
  if (totalPT) return { kind: "creature", totalPTMax: Number(totalPT[1]), label: phrase };
  if (phrase === "target player") return { kind: "player", label: phrase };
  if (phrase === "target opponent") return { kind: "player", opponentOnly: true, label: phrase };
  if (phrase === "target permanent") return { kind: "permanent", label: phrase };
  const nonland = /^target nonland permanent( you control| an opponent controls)?$/.exec(phrase);
  if (nonland) return { kind: "permanent", nonland: true, ...(nonland[1] ? { controller: nonland[1].trim() === "you control" ? ("you" as const) : ("opponent" as const) } : {}), label: phrase };
  const spellKind = /^target (creature|noncreature|artifact or creature|creature or enchantment|artifact or enchantment) spell$/.exec(phrase);
  if (spellKind) return { kind: "spell", spellKind: SPELL_KINDS[spellKind[1]], label: phrase };
  // "target red or green spell"
  const spellColors = /^target (white|blue|black|red|green) or (white|blue|black|red|green) spell$/.exec(phrase);
  if (spellColors) return { kind: "spell", spellColors: [COLOR_OF[spellColors[1]], COLOR_OF[spellColors[2]]], label: phrase };
  // Celestial Purge: "target black or red permanent"
  const permColors = /^target (white|blue|black|red|green) or (white|blue|black|red|green) permanent$/.exec(phrase);
  if (permColors) return { kind: "permanent", colorsAny: [COLOR_OF[permColors[1]], COLOR_OF[permColors[2]]], label: phrase };
  if (phrase === "target card from a graveyard") return { kind: "graveyardCard", label: phrase };
  if (phrase === "target land") return { kind: "land", label: phrase };
  if (phrase === "target artifact or land") return { kind: "artifactOrLand", label: phrase };
  if (phrase === "target artifact") return { kind: "artifact", label: phrase };
  if (phrase === "target noncreature artifact") return { kind: "artifact", noncreature: true, label: phrase };
  if (phrase === "target noncreature artifact or noncreature enchantment") return { kind: "artifactOrEnchantment", noncreature: true, label: phrase };
  if (phrase === "target enchantment") return { kind: "enchantment", label: phrase };
  if (phrase === "target artifact or enchantment") return { kind: "artifactOrEnchantment", label: phrase };
  if (phrase === "target creature or vehicle") return { kind: "permanent", types: ["creature", "vehicle"], label: phrase };
  const fromYard = graveyardCardSpec(phrase);
  if (fromYard) return fromYard;
  if (phrase === "target artifact, enchantment, or creature with flying") return { kind: "permanent", types: ["artifact", "enchantment", "creature"], creatureWith: "flying", label: phrase };
  const creatureOrWalker = /^target creature or planeswalker (you don't control|an opponent controls)$/.exec(phrase);
  if (creatureOrWalker) return { kind: "creatureOrPlaneswalker", controller: "opponent", label: phrase };
  // "target nonartifact, nonblack creature with flying an opponent controls": any mix of these parts
  const m = /^target ((?:non[a-z]+(?:,? (?:and )?| ))*)(tapped |attacking |blocking |attacking or blocking )?creature(?: (with|without) ([a-z ]+?))?(?: with power (\d+) or (less|greater))?(?: (you control|an opponent controls|you don't control|your opponents control|defending player controls))?$/.exec(phrase);
  if (m) {
    const spec: TargetSpec = { kind: "creature", label: phrase };
    for (const non of m[1].match(/non([a-z]+)/g) ?? []) {
      const word = non.slice(3);
      if (word === "artifact") spec.notArtifact = true;
      else if (word === "legendary") spec.nonlegendary = true;
      else if (COLOR_OF[word]) spec.notColors = [...(spec.notColors ?? []), COLOR_OF[word]];
      else return null;
    }
    if (m[2]) spec.filter = m[2].trim() === "tapped" ? "tapped" : m[2].trim() === "attacking" ? "attacking" : m[2].trim() === "blocking" ? "blocking" : "attackingOrBlocking";
    if (m[3]) {
      if (!isKeyword(m[4])) return null;
      spec.keyword = { name: m[4], has: m[3] === "with" };
    }
    if (m[5]) spec.power = { n: Number(m[5]), op: m[6] === "less" ? "max" : "min" };
    if (m[7]) spec.controller = m[7] === "you control" ? "you" : "opponent"; // (a defending player is the opponent)
    return spec;
  }
  return null;
}

/**
 * A card in your graveyard: "target creature card", "target Zombie creature card", "target nonland permanent card", "target instant or sorcery card",
 * "target non-Bear creature card with mana value less than or equal to ~'s power", "target Bat, Lizard, Rat, or Squirrel card".
 */
function graveyardCardSpec(phrase: string): TargetSpec | null {
  const label = phrase;
  const byPower = phrase.includes(" with mana value less than or equal to ~'s power ");
  phrase = phrase.replace(" with mana value less than or equal to ~'s power ", " ");
  const extra: Partial<TargetSpec> = byPower ? { mvAtMostPower: true } : {};
  const m = /^target (non-([a-z]+) )?(?:(?!nonland )([a-z]+ ))?(creature|permanent|nonland permanent|instant or sorcery|sorcery|instant) card from your graveyard$/.exec(phrase);
  if (m) {
    if ((m[3] && (m[4] !== "creature" || CARD_TYPES.includes(m[3].trim()))) || (m[2] && m[4] !== "creature")) return null;
    const spec: TargetSpec = { kind: m[4] === "creature" ? "graveyardCreature" : /^(instant or sorcery|sorcery|instant)$/.test(m[4]) ? "graveyardSpell" : "graveyardPermanent", controller: "you", label, ...extra, ...(m[4] === "sorcery" || m[4] === "instant" ? { types: [m[4]] } : {}) };
    if (m[4] === "nonland permanent") spec.nonland = true;
    if (m[2]) spec.notSubtype = m[2];
    return m[3] ? { ...spec, subtype: m[3].trim() } : spec;
  }
  // "target artifact or enchantment card from your graveyard"
  const permTypes = /^target (artifact|enchantment|land|artifact or enchantment) card from your graveyard$/.exec(phrase);
  if (permTypes) return { kind: "graveyardPermanent", controller: "you", types: permTypes[1].split(" or "), label };
  const typed = /^target ((?:[a-z]+, )+or [a-z]+|[a-z]+ or [a-z]+|[a-z]+) card from your graveyard$/.exec(phrase);
  if (!typed || byPower) return null;
  const subtypes = typed[1].split(/, or |, | or /);
  if (subtypes.some((t) => CARD_TYPES.includes(t))) return null;
  return { kind: "graveyardCard", controller: "you", subtypes, label };
}

/** A phrase naming who or what an effect applies to: a target, "you", "each opponent", "each creature"... */
export function refFor(phrase: string, ctx: Ctx): Ref | null {
  switch (phrase) {
    case "you":
      return { t: "you" };
    case "~":
      return { t: "self" };
    case "each opponent":
    case "your opponents":
    case "defending player": // (a two-player game: the defender is the opponent)
      return { t: "opp" };
    case "each player":
      return { t: "eachPlayer" };
    case "enchanted creature":
    case "enchanted permanent":
    case "equipped creature":
      return { t: "enchanted" };
    case "its owner":
    case "that creature's owner":
    case "its controller":
    case "that creature's controller": {
      if (ctx.targets.length === 0) return null;
      return { t: phrase.endsWith("owner") ? "ownerOf" : "controllerOf", i: ctx.targets.length - 1 };
    }
    case "it":
    case "that creature":
    case "that permanent":
      if (ctx.targets.length > 0) return { t: "target", i: ctx.targets.length - 1 };
      if (phrase === "it" && ctx.hasOther && ctx.itIsOther) return { t: "other" };
      if (phrase === "that creature" && ctx.hasOther) {
        ctx.usedOther = true;
        return { t: "other" };
      }
      return ctx.allowSelf ? { t: "self" } : null;
    case "that player": {
      // "Target player discards two cards. Then exile that player's graveyard."
      let i = ctx.targets.length - 1;
      while (i >= 0 && ctx.targets[i].kind !== "player") i--;
      return i >= 0 ? { t: "target", i } : null;
    }
    case "attacking creatures":
    case "attacking creatures you control":
    case "each attacking creature":
      return { t: "attackingCreatures" };
    case "each creature that player controls": {
      const player = ctx.phrases.get("target player");
      return player === undefined ? null : { t: "creaturesOf", i: player };
    }
    case "each creature":
    case "all creatures":
      return { t: "allCreatures", scope: "all" };
    case "each creature you control":
    case "all creatures you control":
    case "creatures you control":
    case "those creatures":
      return { t: "allCreatures", scope: "yours" };
    case "other attacking creatures you control":
      return { t: "attackingCreatures", other: true };
    case "each other creature you control":
      if (ctx.targets.length > 0) return { t: "allCreatures", scope: "yours", except: ctx.targets.length - 1 };
      return ctx.allowSelf ? { t: "allCreatures", scope: "yours", notSelf: true } : null; // "when ~ enters, put a +1/+1 counter on each other creature you control"
    case "all other creatures":
    case "each other creature":
      return ctx.allowSelf ? { t: "allCreatures", scope: "all", notSelf: true } : null;
    case "all lands":
      return { t: "allLands" };
    case "all creatures that attacked this turn":
      return { t: "allCreatures", scope: "all", attacked: true };
    case "each creature with flying":
      return { t: "allCreatures", scope: "all", flying: true };
    case "all creatures without flying":
    case "each creature without flying":
      return { t: "allCreatures", scope: "all", noFlying: true };
    case "all tapped creatures":
    case "each tapped creature":
      return { t: "allCreatures", scope: "all", tapped: true };
    case "all untapped creatures":
    case "each untapped creature":
      return { t: "allCreatures", scope: "all", tapped: false };
    case "each creature you don't control":
    case "each creature your opponents control":
    case "all creatures you don't control":
    case "creatures you don't control":
    case "creatures your opponents control":
      return { t: "allCreatures", scope: "opponents" };
  }
  // Cordial Vampire: "each Vampire you control"
  const eachOfType = /^each ([a-z]+) you control$/.exec(phrase);
  if (eachOfType && CREATURE_TYPES.includes(eachOfType[1])) return { t: "allCreatures", scope: "yours", subtype: eachOfType[1] };
  const eachOther = /^each other ([a-z]+) you control$/.exec(phrase);
  if (eachOther && !/^(creature|land|artifact|enchantment|permanent)$/.test(eachOther[1])) return { t: "allCreatures", scope: "yours", subtype: eachOther[1], notSelf: true };
  const nonType = /^(?:each non-([a-z]+) creature|all non-([a-z]+) creatures)$/.exec(phrase);
  if (nonType) return { t: "allCreatures", scope: "all", notSubtype: nonType[1] ?? nonType[2] };
  const known = ctx.phrases.get(phrase);
  if (known !== undefined) return { t: "target", i: known };
  // "Goblin creatures you control"
  const typedCreatures = /^([a-z]+) creatures you control$/.exec(phrase);
  if (typedCreatures && CREATURE_TYPES.includes(typedCreatures[1])) return { t: "allCreatures", scope: "yours", subtype: typedCreatures[1] };
  const groupOfType = /^([a-z]+) you control$/.exec(phrase);
  if (groupOfType && !/^(creatures|lands|artifacts|enchantments|permanents|planeswalkers|spells)$/.test(groupOfType[1]) && groupOfType[1].endsWith("s")) return { t: "allCreatures", scope: "yours", subtype: singularType(groupOfType[1]) };
  const spec = targetSpec(phrase);
  if (!spec) return null;
  ctx.targets.push(spec);
  ctx.phrases.set(phrase, ctx.targets.length - 1);
  return { t: "target", i: ctx.targets.length - 1 };
}

export const isCreatureRef = (r: Ref, ctx: Ctx) =>
  r.t === "allCreatures" || r.t === "attackingCreatures" || r.t === "other" || r.t === "creaturesOf" || r.t === "enchanted" || r.t === "self" || (r.t === "target" && (ctx.targets[r.i].kind === "creature" || ctx.targets[r.i].kind === "creatureOrPlaneswalker"));
/** Something that can be destroyed: a creature, or a targeted land / artifact. */
export const isPermanentRef = (r: Ref, ctx: Ctx) =>
  isCreatureRef(r, ctx) || r.t === "allLands" || (r.t === "target" && ["permanent", "land", "artifact", "artifactOrLand", "enchantment", "artifactOrEnchantment", "planeswalker"].includes(ctx.targets[r.i].kind));
export const isPlayerRef = (r: Ref, ctx: Ctx) =>
  r.t === "you" || r.t === "opp" || r.t === "eachPlayer" || r.t === "ownerOf" || r.t === "controllerOf" || (r.t === "target" && (ctx.targets[r.i].kind === "player" || ctx.targets[r.i].kind === "playerOrPlaneswalker"));


export const newCtx = (allowSelf = false): Ctx => ({ allowSelf, targets: [], phrases: new Map() });
