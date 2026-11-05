import { parseCard } from "./oracle.js";
import type { CardDef, GameState, Permanent, PlayerId } from "./types.js";
import { getCard } from "./cards.js";
import { hasKeyword } from "./keywords.js";
import { CREATURE_TYPES, defSubtypes } from "./creatureTypes.js";
import { powerOf } from "./core/permanents.js";

export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
export const MANA_COLORS: readonly ManaColor[] = ["W", "U", "B", "R", "G", "C"];

export const COLOR_NAMES: Record<ManaColor, string> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
};

export interface ManaCost {
  /** Any mana, from any land. */
  generic: number;
  /** Mana that must come from a land of that color. */
  colored: Partial<Record<ManaColor, number>>;
  /** How many {X} the cost has. X is chosen when the spell is cast and paid as generic mana. */
  x?: number;
  /** Hybrid symbols like {W/U}: each is paid with either color. */
  hybrid?: [ManaColor, ManaColor][];
  /** Phyrexian symbols like {G/P}: each is paid with that color, or with 2 life. */
  phyrexian?: ManaColor[];
  /** How many of the Phyrexian symbols the player chose to pay with life even where mana could pay them. */
  phyrexianLife?: number;
  /** Symbols like {2/W}: each is paid with that color, or with 2 generic mana. */
  twoOrColor?: ManaColor[];
}

/** Two costs added together (the base cost plus a kicker, say). */
export function addCosts(a: ManaCost, b: ManaCost): ManaCost {
  const colored: ManaCost["colored"] = { ...a.colored };
  for (const [color, n] of Object.entries(b.colored)) colored[color as ManaColor] = (colored[color as ManaColor] ?? 0) + (n ?? 0);
  return {
    generic: a.generic + b.generic,
    colored,
    ...((a.x ?? 0) + (b.x ?? 0) > 0 ? { x: (a.x ?? 0) + (b.x ?? 0) } : {}),
    ...((a.hybrid ?? []).length + (b.hybrid ?? []).length > 0 ? { hybrid: [...(a.hybrid ?? []), ...(b.hybrid ?? [])] } : {}),
    ...((a.phyrexian ?? []).length + (b.phyrexian ?? []).length > 0 ? { phyrexian: [...(a.phyrexian ?? []), ...(b.phyrexian ?? [])] } : {}),
    ...((a.twoOrColor ?? []).length + (b.twoOrColor ?? []).length > 0 ? { twoOrColor: [...(a.twoOrColor ?? []), ...(b.twoOrColor ?? [])] } : {}),
  };
}

/** The cost with X filled in: every {X} becomes `x` generic mana. */
export function withX(cost: ManaCost, x: number): ManaCost {
  return { ...cost, generic: cost.generic + (cost.x ?? 0) * x, x: 0 };
}

/** Delve: the cost with `n` of its generic mana paid by cards exiled from the graveyard. */
/**
 * Convoke: each creature tapped pays for {1} or for one mana of one of its colors (a color the cost still asks for is used first).
 * Creatures beyond what the cost needs pay nothing.
 */
export function withConvoke(cost: ManaCost, creatures: { colors: string[] }[]): ManaCost {
  const colored = { ...cost.colored } as Record<string, number>;
  let generic = cost.generic;
  for (const c of creatures) {
    const color = c.colors.find((col) => (colored[col] ?? 0) > 0);
    if (color) colored[color]--;
    else if (generic > 0) generic--;
  }
  return { ...cost, generic, colored: colored as ManaCost["colored"] };
}

export function withDelve(cost: ManaCost, n: number): ManaCost {
  return n > 0 ? { ...cost, generic: Math.max(0, cost.generic - n) } : cost;
}

/** The cost with `n` of its Phyrexian symbols paid with life, as the player chose. Null when it has fewer than `n`. */
export function withPhyrexianLife(cost: ManaCost, n: number): ManaCost | null {
  if (!Number.isInteger(n) || n < 0 || n > (cost.phyrexian ?? []).length) return null;
  return n > 0 ? { ...cost, phyrexianLife: n } : cost;
}

/**
 * Parses a printed cost like "{2}{G}{G}". Returns null if it contains anything the engine
 * can't pay yet (snow, three-way hybrid...), so such cards are treated as unplayable.
 */
export function parseManaCost(text: string): ManaCost | null {
  const cost: ManaCost = { generic: 0, colored: {} };
  let rest = text.trim();
  while (rest) {
    const m = /^\{([^}]+)\}/.exec(rest);
    if (!m) return null;
    const symbol = m[1];
    if (/^\d+$/.test(symbol)) cost.generic += Number(symbol);
    else if (symbol === "X") cost.x = (cost.x ?? 0) + 1;
    else if (/^[WUBRG]\/[WUBRG]$/.test(symbol)) (cost.hybrid ??= []).push([symbol[0] as ManaColor, symbol[2] as ManaColor]);
    else if (/^[WUBRG]\/P$/.test(symbol)) (cost.phyrexian ??= []).push(symbol[0] as ManaColor);
    else if (/^2\/[WUBRG]$/.test(symbol)) (cost.twoOrColor ??= []).push(symbol[2] as ManaColor);
    else if ((MANA_COLORS as readonly string[]).includes(symbol)) {
      const color = symbol as ManaColor;
      cost.colored[color] = (cost.colored[color] ?? 0) + 1;
    } else return null;
    rest = rest.slice(m[0].length);
  }
  return cost;
}

/** The cost to cast a card. Hand-made cards without a printed cost just cost `cost` generic mana. */
export function manaCostOf(def: CardDef): ManaCost | null {
  if (def.manaCost === undefined) return { generic: def.cost, colored: {} };
  return parseManaCost(def.manaCost.split(" // ")[0]); // a two-part card is cast as its first half
}

const BASIC_LAND_COLOR: Record<string, ManaColor> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
  Wastes: "C",
};

/** The one color of mana a basic land taps for (Forest -> G). Undefined for lands the engine can't use yet. */
export function landColor(def: CardDef): ManaColor | undefined {
  if (def.type !== "land") return undefined;
  const subtype = def.typeLine?.split("—")[1]?.trim().split(/\s+/)[0] ?? def.name.replace(/^Snow-Covered /, "");
  return BASIC_LAND_COLOR[subtype];
}

const ALL_FIVE: ManaColor[] = ["W", "U", "B", "R", "G"];

/**
 * "{T}: Add {G}", "{T}: Add {G} or {W}", "{T}: Add {B}, {R}, or {G}", "{T}: Add one mana of any color": the colors the
 * permanent can be tapped for (one mana per tap). Undefined when the card has no such ability. Abilities that make
 * two mana, cost extra, or hurt you are not matched, so those cards stay unplayable.
 */
export function manaAbilityColors(def: CardDef): ManaColor[] | undefined {
  const info = manaAbility(def);
  return info && info.colors.length > 0 ? info.colors : undefined;
}

/** Does a "{T}: Add ... one mana of the chosen color" ability exist? (The color is chosen as the permanent enters.) */
export function manaAbilityUsesChosenColor(def: CardDef): boolean {
  return manaAbility(def)?.chosen === true;
}

/** How much mana one tap makes: "{T}: Add {C}{C}" makes two. */
export function manaAbilityAmount(def: CardDef): number {
  return manaAbility(def)?.amount ?? 1;
}

/** "{T}, Sacrifice this artifact: Add one mana of any color." (a Treasure): the permanent is sacrificed when it is tapped for mana. */
export function manaAbilitySacrifices(def: CardDef): boolean {
  return /^\{t\}, sacrifice (?:~|this [a-z]+): add /m.test((def.text ?? "").replace(/\([^)]*\)/g, "").toLowerCase());
}

/** "{T}: Add {C}. Spend this mana only to cast an instant or sorcery spell.": the restriction, if there is one. */
export function manaAbilityRestriction(def: CardDef): "instantOrSorcery" | undefined {
  return /\bspend this mana only to cast an instant or sorcery spell\b/i.test(def.text ?? "") ? "instantOrSorcery" : undefined;
}

/** "{T}: Add {R}. If that mana is spent on a Dragon creature spell, it gains haste until end of turn.": the creature type. */
export function manaAbilityHasteFor(def: CardDef): string | undefined {
  return /\bif that mana is spent on an? ([a-z]+) creature spell, it gains haste until end of turn\b/i.exec(def.text ?? "")?.[1].toLowerCase();
}

/** "{T}: Add {G} for each Elf you control.": the creature type counted. */
function manaAbilityPerSubtype(def: CardDef): string | undefined {
  return /^\{t\}: add \{[wubrgc]\} for each ([a-z]+) you control\.?$/im.exec((def.text ?? "").replace(/\([^)]*\)/g, ""))?.[1].toLowerCase();
}

/** An Aura such as New Horizons: 'Enchanted land has "{T}: Add two mana of any one color."' */
export const grantsTwoOfOneColor = (def: CardDef): boolean => /^enchanted land has "\{t\}: add two mana of any one color\.?"\.?$/im.test(def.text ?? "");

/** "Activate only if this land entered this turn or if you control a basic land." (the Marvel dual lands) / "...if you control an Island or a Mountain." (the Verges) */
const GATE = /\.? ?activate only if (?:(?:this land|~) entered this turn or if you control a basic land|you control an? [a-z]+ or an? [a-z]+)\.?/gi;
const GATE_TYPES = /activate only if you control an? ([a-z]+) or an? ([a-z]+)/i;

/** "{T}, Pay 1 life: Add {U} or {R}.": the life each tap costs. */
export const manaAbilityLife = (def: CardDef): number => manaAbility(def)?.life ?? 0;

function manaAbility(def: CardDef): { colors: ManaColor[]; amount: number; chosen: boolean; gated: ManaColor[]; gateTypes?: string[]; life: number } | undefined {
  const text = (def.text ?? "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\.? ?spend this mana only to cast an instant or sorcery spell\.?/gi, "")
    .replace(/^\{t\}: add [^\n]*?\. (?:spend this mana only to|this mana can't be spent to) [^\n]*$/gim, "") // restricted lines: see restrictedMana
    .replace(/\. when that mana is spent to cast a red instant or sorcery spell, copy that spell and you may choose new targets for the copy/gi, "") // Pyromancer's Goggles
    .replace(/\.? ?if that mana is spent on an? [a-z]+ creature spell, it gains haste until end of turn\.?/gi, "")
    .toLowerCase();
  const found = new Set<ManaColor>();
  const gated = new Set<ManaColor>();
  let amount = 1;
  let chosen = false;
  let life = 0;
  let gateTypes: string[] | undefined;
  for (const rawLine of text.split("\n")) {
    const isGated = rawLine.search(GATE) >= 0;
    const typed = GATE_TYPES.exec(rawLine);
    if (typed) gateTypes = [typed[1], typed[2]];
    const raw = rawLine.replace(GATE, "");
    const pain = /^(\{t\}), pay (\d+) life(: add .+)$/.exec(raw.trim());
    if (pain) life = Number(pain[2]);
    const m = /^\{t\}(?:, sacrifice (?:~|this [a-z]+))?: add (.+?)\.?$/.exec(pain ? `${pain[1]}${pain[3]}` : raw.trim());
    if (!m) continue;
    if (isGated) {
      // "{T}: Add {G} or {W}. Activate only if ...": the colors only count while the condition holds
      for (const piece of m[1].split(/, or |, | or /)) {
        const c = /^\{([wubrgc])\}$/.exec(piece.trim());
        if (c) gated.add(c[1].toUpperCase() as ManaColor);
      }
      continue;
    }
    // "{T}: Add X mana of any one color, where X is ...'s power" / "...two mana of any one color": one color, chosen as it is spent
    if (/^(?:two|x) mana of any one color(?:, where x is [^,]+)?$/.test(m[1])) {
      ALL_FIVE.forEach((c) => found.add(c));
      continue;
    }
    const perType = /^(\{[wubrgc]\}) for each [a-z]+ you control$/.exec(m[1]);
    if (perType) {
      found.add(perType[1][1].toUpperCase() as ManaColor);
      continue;
    }
    const twice = /^(\{[wubrgc]\})\1+$/.exec(m[1]); // "{c}{c}": two mana of one color
    if (twice) {
      found.add(twice[1][1].toUpperCase() as ManaColor);
      amount = Math.max(amount, m[1].length / 3);
      continue;
    }
    if (m[1] === "one mana of any color") {
      ALL_FIVE.forEach((c) => found.add(c));
      continue;
    }
    const pieces = m[1].split(/, or |, | or /).map((p) => p.trim());
    // "one mana of the chosen color" is a color that is only known once the permanent has entered
    const fixed = pieces.filter((p) => p !== "one mana of the chosen color").map((p) => /^\{([wubrgc])\}$/.exec(p));
    if (pieces.includes("one mana of the chosen color")) chosen = true;
    if (fixed.every(Boolean) && (fixed.length > 0 || chosen)) fixed.forEach((p) => found.add(p![1].toUpperCase() as ManaColor));
    else if (pieces.includes("one mana of the chosen color")) chosen = false;
  }
  return found.size > 0 || gated.size > 0 || chosen ? { colors: [...new Set([...found, ...gated])], amount, chosen, gated: [...gated].filter((c) => !found.has(c)), ...(gateTypes ? { gateTypes } : {}), life } : undefined;
}

/** "{T}: Add X mana of any one color": how many mana one tap makes (2, or the permanent's power), if the card has such a line. */
function oneColorAmount(def: CardDef): "two" | "power" | undefined {
  const text = (def.text ?? "").replace(/\([^)]*\)/g, "").toLowerCase();
  if (/^\{t\}: add two mana of any one color\b/m.test(text)) return "two";
  if (/^\{t\}: add x mana of any one color, where x is [^\n]*power/m.test(text)) return "power";
  return undefined;
}

/** "{1}, {T}: Add one mana of any color." / "{4}, {T}: Add four mana in any combination of colors.": pays n and makes n mana of any colors. */
export function filterAbility(def: CardDef): number | undefined {
  const m = /^\{(\d+)\}, \{t\}: add (?:one mana of any color|[a-z]+ mana in any combination of colors)\b/im.exec((def.text ?? "").replace(/\([^)]*\)/g, ""));
  return m ? Number(m[1]) : undefined;
}

/** Every color a land can tap for: its basic land types ("Land — Forest Plains") and any "{T}: Add ..." line. */
export function landManaColors(def: CardDef): ManaColor[] {
  if (def.type !== "land") return [];
  const sub = def.typeLine?.split("—")[1]?.trim();
  const subtypes = sub ? sub.split(/\s+/) : [def.name.replace(/^Snow-Covered /, "")]; // "Basic Land" alone: Wastes
  const colors = new Set<ManaColor>(manaAbilityColors(def) ?? []);
  for (const s of subtypes) if (BASIC_LAND_COLOR[s]) colors.add(BASIC_LAND_COLOR[s]);
  return [...colors];
}

/** Is the condition of "Activate only if this land entered this turn or if you control a basic land" (or "...an Island or a Mountain") met? */
function gateOpen(state: GameState, perm: Permanent, gateTypes?: string[]): boolean {
  const owner = Object.values(state.players).find((p) => p.battlefield.includes(perm));
  if (gateTypes) return !!owner?.battlefield.some((p) => defSubtypes(getCard(state, p.card.defId)).some((t) => gateTypes.includes(t)));
  if (perm.enteredTurn === state.turn) return true;
  return !!owner?.battlefield.some((p) => /\bBasic\b/.test(getCard(state, p.card.defId).typeLine ?? ""));
}

/**
 * The colors this permanent can currently be tapped for (empty: it can't make mana right now).
 * `forSpell`: the spell the mana is for; `forAbility`: the permanent whose ability is being paid for. Restricted mana only counts for those.
 */
function manaColorsOf(state: GameState, perm: Permanent, forSpell?: CardDef, forAbility?: CardDef): ManaColor[] {
  const def = getCard(state, perm.card.defId);
  // Restricted mana can only pay for the kind of spell it names.
  if (manaAbilityRestriction(def) === "instantOrSorcery" && !(forSpell && (forSpell.type === "instant" || forSpell.type === "sorcery"))) return [];
  const chosen = manaAbilityUsesChosenColor(def) && perm.chosenColor ? [perm.chosenColor] : [];
  const only = forSpell
    ? restrictedMana(def).filter((r) => restrictionAllows(r, perm, forSpell)).flatMap((r) => r.colors)
    : forAbility
      ? restrictedMana(def).filter((r) => abilityAllows(r, forAbility)).flatMap((r) => r.colors)
      : [];
  const gate = manaAbility(def)?.gated ?? [];
  const open = gate.length === 0 || gateOpen(state, perm, manaAbility(def)?.gateTypes);
  const withChosen = (colors: ManaColor[]) => [...new Set([...(open ? colors : colors.filter((c) => !gate.includes(c))), ...chosen, ...only])];
  if (def.type === "land") return perm.crewed && perm.summoningSick && !hasKeyword(def, "haste") && !(perm.tempKeywords ?? []).includes("haste") ? [] : withChosen(landManaColors(def)); // a land that became a creature this turn is summoning sick
  if (def.type === "artifact") return withChosen(manaAbilityColors(def) ?? []); // artifacts aren't "summoning sick"
  if (def.type === "creature" && (!perm.summoningSick || hasKeyword(def, "haste"))) return withChosen(manaAbilityColors(def) ?? []);
  return [];
}

export type PayResult =
  /** `life` is what Phyrexian mana costs in life (0 when it was paid with mana). `made`: each mana spent, and the permanent it came from. */
  | { ok: true; tap: string[]; life: number; made: { iid: string; color: ManaColor }[] }
  | { ok: false; missing: ManaColor | "generic" | "life" };

interface Source {
  iid: string;
  colors: ManaColor[];
  /** A filter land's slot: it costs this many other sources when used. */
  filter?: number;
  /** "{T}, Pay 1 life: Add ...": the life it costs to use. */
  life?: number;
}

/** One tap makes several mana of ONE color, chosen as they are spent: an enchanted land ("two mana of any one color"), Shang-Chi, Doc Samson. */
function makesOneColorMana(state: GameState, perm: Permanent): boolean {
  const def = getCard(state, perm.card.defId);
  if (oneColorAmount(def)) return true;
  if (def.type !== "land") return false;
  return Object.values(state.players).some((pl) => pl.battlefield.some((aura) => aura.attachedTo === perm.card.iid && grantsTwoOfOneColor(getCard(state, aura.card.defId))));
}

/** How many mana one tap of this permanent makes ("{T}: Add {G} for each Elf you control" counts the controller's Elves). */
function manaAmountOf(state: GameState, player: PlayerId, perm: Permanent): number {
  const def = getCard(state, perm.card.defId);
  const per = manaAbilityPerSubtype(def);
  if (!per) {
    const one = oneColorAmount(def);
    if (one === "two") return 2;
    if (one === "power") return Math.max(0, powerOf(state, perm));
    return makesOneColorMana(state, perm) ? 2 : manaAbilityAmount(def);
  }
  const isType = (p: Permanent) => {
    const line = (getCard(state, p.card.defId).typeLine ?? "").split(" // ")[0].toLowerCase();
    return line.includes("creature") && (p.subtypesOverride ?? line.split("—")[1]?.trim().split(/\s+/) ?? []).includes(per);
  };
  return state.players[player].battlefield.filter(isType).length;
}

/**
 * Chooses which untapped permanents to tap for `cost`. Every colored requirement needs its own source that can make
 * that color (a matching problem: a Forest/Plains dual may pay for either, but only one of them). Generic mana is
 * then paid from what is left, single-color sources of the most plentiful color first, so scarce colors and the
 * flexible multi-color sources stay untapped for the next spell.
 */
export function payMana(state: GameState, player: PlayerId, cost: ManaCost, forSpell?: CardDef, forAbility?: CardDef): PayResult {
  const plain = payFrom(state, player, cost, forSpell, forAbility, false);
  if (plain.ok) return plain;
  // A filter land ("{1}, {T}: Add one mana of any color") only helps when the plain sources can't pay.
  const hasFilter = state.players[player].battlefield.some((p) => !p.tapped && filterAbility(getCard(state, p.card.defId)) !== undefined);
  if (!hasFilter) return plain;
  const filtered = payFrom(state, player, cost, forSpell, forAbility, true);
  return filtered.ok ? filtered : plain;
}

/** Pays for a permanent's ability with its other mana sources when they can: a creature land that animates itself stays untapped to attack. */
export function payForAbility(state: GameState, player: PlayerId, cost: ManaCost, def: CardDef, sourceIid?: string): PayResult {
  const me = state.players[player];
  const others = sourceIid ? payMana({ ...state, players: { ...state.players, [player]: { ...me, spareMana: [...(me.spareMana ?? []), sourceIid] } } }, player, cost, undefined, def) : null;
  return others?.ok ? others : payMana(state, player, cost, undefined, def);
}

/** A payment source standing for floating mana: "pool:" and its place in the player's pool. */
export const POOL = "pool:";
const COMBAT_PHASES = ["attackers", "blockers", "damage"];

/** Floating mana the player can spend right now (with its place in the pool): made this phase, or this combat for firebending. */
export function floatingMana(state: GameState, player: PlayerId): { at: number; color: ManaColor }[] {
  return (state.players[player].pool ?? []).flatMap((m, at) => (m.turn === state.turn && (m.allTurn || (m.combat ? COMBAT_PHASES.includes(state.phase) : m.phase === state.phase)) ? [{ at, color: m.color }] : []));
}

function payFrom(state: GameState, player: PlayerId, cost: ManaCost, forSpell: CardDef | undefined, forAbility: CardDef | undefined, useFilters: boolean): PayResult {
  // Floating mana is spent before anything is tapped.
  const sources: Source[] = floatingMana(state, player).map((m) => ({ iid: `${POOL}${m.at}`, colors: [m.color] }));
  const spare = state.players[player].spareMana ?? [];
  // Lands come first, so a creature or artifact that makes mana is only used when the lands can't pay; a land that costs life comes after the others.
  // Mana that gives the spell haste (Carnelian Orb of Dragonkind on a Dragon) goes before everything.
  const rank = (p: Permanent) => {
    const def = getCard(state, p.card.defId);
    if (forSpell && hasteFrom(state, p.card.iid, forSpell)) return -1;
    if (def.type !== "land") return 1;
    return manaAbilityLife(def) > 0 ? 0.5 : 0;
  };
  const order = [...state.players[player].battlefield].sort((a, b) => rank(a) - rank(b));
  const oneColor: string[] = [];
  for (const perm of order) {
    if (perm.tapped || spare.includes(perm.card.iid)) continue;
    const filter = useFilters ? filterAbility(getCard(state, perm.card.defId)) : undefined;
    if (filter !== undefined) {
      // pays {n} and makes n mana of any colors: it can stand in for n colored requirements, at the price of n other sources
      for (let i = 0; i < filter; i++) sources.push({ iid: perm.card.iid, colors: ALL_FIVE, filter });
      continue;
    }
    const stashed = forSpell !== undefined && (state.players[player].mayPlay ?? []).some((e) => e.via && state.players[player].exile.some((c) => c.iid === e.iid && c.defId === forSpell.id)); // Tinybones: mana of any type
    const anyType = stashed || (forSpell?.type === "creature" && state.players[player].battlefield.some((p) => parseCard(getCard(state, p.card.defId)).castCreaturesFromTop)); // Vizier: mana of any type pays for creature spells
    const colors = manaColorsOf(state, perm, forSpell, forAbility).length > 0 && anyType ? ALL_FIVE : manaColorsOf(state, perm, forSpell, forAbility);
    // A source that makes two mana counts twice; tapping it once pays for both.
    const amount = colors.length > 0 ? manaAmountOf(state, player, perm) : 0;
    if (amount > 0 && makesOneColorMana(state, perm)) oneColor.push(perm.card.iid);
    const life = manaAbilityLife(getCard(state, perm.card.defId));
    for (let i = 0; i < amount; i++) sources.push({ iid: perm.card.iid, colors: oneColor.includes(perm.card.iid) ? ALL_FIVE : colors, ...(life > 0 ? { life } : {}) });
  }
  if (oneColor.length === 0) return paySources(state, player, cost, sources, forSpell);
  // "Two mana of any one color": try each color for each such land, keeping the payment that taps the fewest permanents.
  let best: PayResult | undefined;
  const tryColors = (i: number, picked: ManaColor[]) => {
    if (i === oneColor.length) {
      const fixed = sources.map((src) => (oneColor.includes(src.iid) ? { ...src, colors: [picked[oneColor.indexOf(src.iid)]] } : src));
      const paid = paySources(state, player, cost, fixed, forSpell);
      if (paid.ok && (!best?.ok || paid.tap.length < best.tap.length)) best = paid;
      else best ??= paid;
      return;
    }
    for (const c of ALL_FIVE) tryColors(i + 1, [...picked, c]);
  };
  tryColors(0, []);
  return best!;
}

interface RestrictedMana {
  colors: ManaColor[];
  /** "...to cast a creature spell" / "...an artifact spell" / "...an Angel spell" / "...a creature spell of the chosen type". */
  creature?: boolean;
  cardType?: string;
  subtype?: string;
  chosenType?: boolean;
  /** "This mana can't be spent to cast a nonartifact spell": spells must be artifacts; abilities are fine. */
  onlyArtifactSpells?: boolean;
  /** "...or to activate an ability of a Villain source" / "...activate abilities of creature sources" / any ability. */
  abilitySubtype?: string;
  abilityCreature?: boolean;
  abilityAny?: boolean;
}

/**
 * Mana lines that may only pay for some spells or abilities: "{T}: Add {B}. Spend this mana only to cast a creature spell.", "...an Angel spell.",
 * "{T}: Add one mana of any color. Spend this mana only to cast a Villain spell or to activate an ability of a Villain source.",
 * "{T}: Add two mana of any one color. Spend this mana only to activate abilities of creature sources.",
 * "{T}: Add {U}. This mana can't be spent to cast a nonartifact spell."
 * (A creature of the chosen type's abilities are paid without it.) A line with a restriction that isn't understood is not returned.
 */
const restrictedCache = new WeakMap<CardDef, RestrictedMana[]>();
export function restrictedMana(def: CardDef): RestrictedMana[] {
  const known = restrictedCache.get(def);
  if (known) return known;
  const out = parseRestrictedMana(def);
  restrictedCache.set(def, out);
  return out;
}

function parseRestrictedMana(def: CardDef): RestrictedMana[] {
  const out: RestrictedMana[] = [];
  const text = (def.text ?? "").replace(/\([^)]*\)/g, "").toLowerCase();
  for (const m of text.matchAll(/^\{t\}: add (\{[wubrgc]\}|one mana of any color|two mana of any one color)\. (?:spend this mana only to (.+?)|(this mana can't be spent to cast a nonartifact spell))\.?$/gm)) {
    const colors = m[1].startsWith("{") ? [m[1][1].toUpperCase() as ManaColor] : [...ALL_FIVE];
    if (m[3]) {
      out.push({ colors, onlyArtifactSpells: true, abilityAny: true });
      continue;
    }
    const r: RestrictedMana = { colors };
    let understood = true;
    for (const part of m[2].split(/ or (?=to |cast |activate )/)) {
      const clause = part.replace(/^to /, "");
      let c: RegExpExecArray | null;
      if (clause === "cast a creature spell of the chosen type") Object.assign(r, { creature: true, chosenType: true });
      else if (clause === "activate an ability of a creature source of the chosen type") continue; // paid without it
      else if (clause === "cast a creature spell") r.creature = true;
      else if ((c = /^cast an? ([a-z]+) spell$/.exec(clause))) {
        if (SPELL_TYPES.includes(c[1])) r.cardType = c[1];
        else if (CREATURE_TYPES.includes(c[1])) r.subtype = c[1];
        else understood = false;
      } else if ((c = /^activate an ability of an? ([a-z]+) source$/.exec(clause)) && CREATURE_TYPES.includes(c[1])) r.abilitySubtype = c[1];
      else if (clause === "activate abilities of creature sources") r.abilityCreature = true;
      else understood = false;
    }
    if (understood) out.push(r);
  }
  return out;
}

/** Card types a restriction may name ("Spend this mana only to cast an artifact spell"). */
export const SPELL_TYPES = ["artifact", "enchantment", "planeswalker", "instant", "sorcery"];

const restrictionAllows = (r: RestrictedMana, perm: Permanent, spell: CardDef): boolean => {
  if (r.onlyArtifactSpells) return (spell.typeLine ?? spell.type).toLowerCase().split("—")[0].includes("artifact");
  if (!r.creature && !r.cardType && !r.subtype && !r.chosenType) return false; // ability-only mana
  return (
    (!r.creature || spell.type === "creature") &&
    (!r.cardType || (spell.typeLine ?? spell.type).toLowerCase().split("—")[0].includes(r.cardType)) &&
    (!r.subtype || defSubtypes(spell).includes(r.subtype)) &&
    (!r.chosenType || (!!perm.chosenType && defSubtypes(spell).includes(perm.chosenType)))
  );
};

/** May this restricted mana pay for an ability of `source`? */
const abilityAllows = (r: RestrictedMana, source: CardDef): boolean =>
  r.abilityAny === true || (r.abilityCreature === true && source.type === "creature") || (r.abilitySubtype !== undefined && defSubtypes(source).includes(r.abilitySubtype));

/** Was this permanent's mana the kind that gives `spell` haste? */
export function hasteFrom(state: GameState, iid: string, spell: CardDef): boolean {
  const perm = Object.values(state.players).flatMap((pl) => pl.battlefield).find((p) => p.card.iid === iid);
  const type = perm ? manaAbilityHasteFor(getCard(state, perm.card.defId)) : undefined;
  if (!type) return false;
  const line = (spell.typeLine ?? "").split(" // ")[0].toLowerCase();
  return line.includes("creature") && (line.split("—")[1] ?? "").trim().split(/\s+/).includes(type);
}

function paySources(state: GameState, player: PlayerId, cost: ManaCost, given: Source[], forSpell?: CardDef): PayResult {
  // A colored requirement is paid by the LEAST flexible source that can: a Forest pays {G} before a {G}/{W} land does, so the land that makes
  // either color stays untapped for the next spell. (Floating mana and mana that gives haste still go first; a land that costs life goes last.)
  const flexibility = (src: Source) => (src.iid.startsWith(POOL) || (forSpell && hasteFrom(state, src.iid, forSpell)) ? -1 : (src.life ? 100 : 0) + src.colors.length);
  const sources = [...given].sort((a, b) => flexibility(a) - flexibility(b));
  // Every requirement lists the colors that can pay it: a plain {R} is [R], a hybrid {W/U} is [W, U].
  const needs: ManaColor[][] = [
    ...MANA_COLORS.flatMap((c) => Array<ManaColor[]>(cost.colored[c] ?? 0).fill([c])),
    ...(cost.hybrid ?? []).map(([a, b]): ManaColor[] => [a, b]),
  ];
  // Kuhn's algorithm: give each need a source, moving earlier choices around when that frees one up.
  const owner: (number | undefined)[] = Array(sources.length).fill(undefined); // source -> need
  const place = (need: number, seen: Set<number>): boolean => {
    for (let s = 0; s < sources.length; s++) {
      if (seen.has(s) || !sources[s].colors.some((c) => needs[need].includes(c))) continue;
      seen.add(s);
      if (owner[s] === undefined || place(owner[s]!, seen)) {
        owner[s] = need;
        return true;
      }
    }
    return false;
  };
  for (let need = 0; need < needs.length; need++) {
    if (!place(need, new Set())) return { ok: false, missing: needs[need][0] };
  }
  // Phyrexian and {2/W} symbols: paid with mana when that is possible (and the player didn't choose life), otherwise with life or two generic mana.
  let life = 0;
  let extraGeneric = 0;
  let byMana = (cost.phyrexian ?? []).length - (cost.phyrexianLife ?? 0);
  for (const color of cost.phyrexian ?? []) {
    needs.push([color]);
    if (byMana > 0 && place(needs.length - 1, new Set())) {
      byMana -= 1;
      continue;
    }
    needs.pop();
    life += 2;
  }
  for (const color of cost.twoOrColor ?? []) {
    needs.push([color]);
    if (!place(needs.length - 1, new Set())) {
      needs.pop();
      extraGeneric += 2;
    }
  }
  const tap = [...new Set(sources.filter((_, s) => owner[s] !== undefined).map((src) => src.iid))];
  // A filter land that was used pays its {n} with n other sources (it makes n mana in return, so it adds nothing to the generic pool).
  const filterUsed = new Map<string, number>();
  sources.forEach((src, s) => src.filter !== undefined && owner[s] !== undefined && filterUsed.set(src.iid, src.filter));
  const filterCost = [...filterUsed.values()].reduce((n, c) => n + c, 0);
  const rest = sources.filter((src, s) => owner[s] === undefined && src.filter === undefined);
  const plenty = new Map<ManaColor, number>();
  for (const src of rest) if (src.colors.length === 1) plenty.set(src.colors[0], (plenty.get(src.colors[0]) ?? 0) + 1);
  rest.sort((a, b) => {
    const rank = (src: Source) => (src.iid.startsWith(POOL) || (forSpell && hasteFrom(state, src.iid, forSpell)) ? -Infinity : (src.life ? 5000 : 0) + (src.colors.length === 1 ? -(plenty.get(src.colors[0]) ?? 0) : 1000 + src.colors.length));
    return rank(a) - rank(b);
  });
  if (rest.length < cost.generic + extraGeneric + filterCost) return { ok: false, missing: "generic" };
  const generic = rest.slice(0, cost.generic + extraGeneric + filterCost);
  for (const src of generic) if (!tap.includes(src.iid)) tap.push(src.iid);
  // A land that costs life to tap ("{T}, Pay 1 life: Add {U} or {R}")
  life += tap.reduce((n, iid) => n + (sources.find((src) => src.iid === iid)?.life ?? 0), 0);
  if (life > state.players[player].life) return { ok: false, missing: "life" };
  const made = [
    ...sources.flatMap((src, s) => (owner[s] === undefined ? [] : [{ iid: src.iid, color: src.colors.find((c) => needs[owner[s]!].includes(c)) ?? src.colors[0] }])),
    ...generic.map((src) => ({ iid: src.iid, color: src.colors[0] ?? ("C" as const) })),
  ];
  return { ok: true, tap, life, made };
}

/**
 * Permanents in a payment that are worth asking about before they are tapped: a creature (it could attack or block
 * instead) or anything that is sacrificed for its mana. Lands and plain mana artifacts are tapped without asking.
 */
export function manaSourcesToConfirm(state: GameState, player: PlayerId, tap: string[]): string[] {
  return tap.filter((iid) => {
    const perm = state.players[player].battlefield.find((p) => p.card.iid === iid);
    const def = perm ? getCard(state, perm.card.defId) : undefined;
    return !!def && def.type !== "land" && (def.type === "creature" || manaAbilitySacrifices(def));
  });
}

/** Mana the player could produce right now, per color. */
export interface ManaSource {
  iid: string;
  name: string;
  colors: ManaColor[];
  amount: number;
  tapped: boolean;
  /** A creature that makes mana but just arrived: it can be tapped for mana from its controller's next turn. */
  sick: boolean;
}

/** A player's permanents that make mana, tapped or not: what each makes and how much. */
export function manaSources(state: GameState, player: PlayerId): ManaSource[] {
  const floating = floatingMana(state, player).map((m): ManaSource => ({ iid: `${POOL}${m.at}`, name: "Floating mana", colors: [m.color], amount: 1, tapped: false, sick: false }));
  return [...floating, ...state.players[player].battlefield.flatMap((perm): ManaSource[] => {
    const def = getCard(state, perm.card.defId);
    const colors = makesOneColorMana(state, perm) ? ALL_FIVE : manaColorsOf(state, perm);
    if (colors.length > 0) return [{ iid: perm.card.iid, name: def.name, colors, amount: manaAmountOf(state, player, perm), tapped: perm.tapped, sick: false }];
    const later = def.type === "creature" && perm.summoningSick ? (manaAbilityColors(def) ?? []) : [];
    return later.length > 0 ? [{ iid: perm.card.iid, name: def.name, colors: later, amount: manaAbilityAmount(def), tapped: perm.tapped, sick: true }] : [];
  })];
}

export function availableMana(state: GameState, player: PlayerId): Record<ManaColor, number> {
  const pool: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const m of floatingMana(state, player)) pool[m.color] += 1;
  for (const perm of state.players[player].battlefield) {
    if (perm.tapped) continue;
    const colors = makesOneColorMana(state, perm) ? ALL_FIVE : manaColorsOf(state, perm);
    for (const color of colors) pool[color] += manaAmountOf(state, player, perm);
  }
  return pool;
}
