import type { ParsedCard, TargetSpec, TriggeredAbility } from "./effects.js";
import { keywordsSupported } from "./keywords.js";
import { landManaColors, manaAbilityUsesChosenColor, manaCostOf, parseManaCost } from "./mana.js";
import type { CardDef } from "./types.js";
import { COLOR_OF, normalizeText, parseCount, singularType, toNumber } from "./oracle/words.js";
import { newCtx } from "./oracle/targets.js";
import { parseClause, parseEffectText, parseModes } from "./oracle/effectText.js";
import { parseCreatureLine } from "./oracle/lines.js";
import { readDiscardedByOpponent } from "./oracle/lines/theme.js";
import { doubleFaces } from "./oracle/doubleFaced.js";
import { rewriteTeamwork, stripModeName, TEAMWORK_HEADER } from "./oracle/teamwork.js";

// Reads a card's rules text and turns it into structured effects (see effects.ts).
// The reader is strict on purpose: if any line of a card is not fully understood, the card is reported as
// not ok and stays unplayable. A half-understood card would behave wrongly, which is worse than missing.

export { normalizeText } from "./oracle/words.js";

const cache = new WeakMap<CardDef, ParsedCard>();

type Faces = { front: CardDef; spell: CardDef; kind: "prepare" | "adventure" };
const faceCache = new WeakMap<CardDef, Faces | null>();
const manaValueOf = (cost: string) => (cost.match(/\{[^}]+\}/g) ?? []).reduce((n, sym) => n + (/^\{\d+\}$/.test(sym) ? Number(sym.slice(1, -1)) : sym === "{X}" ? 0 : 1), 0);

/**
 * A preparation card ("Quill-Blade Laureate // Twofold Intent") or an Adventure card ("Hearth Elemental // Stoke Genius") is stored
 * as one card with both halves: the creature, then " // " and its spell. Splits it into the creature and the spell. Null for any other card.
 */
export function prepareFaces(def: CardDef): Faces | null {
  const hit = faceCache.get(def);
  if (hit !== undefined) return hit;
  const names = def.name.split(" // ");
  const types = (def.typeLine ?? "").split(" // ");
  const costs = (def.manaCost ?? "").split(" // ");
  const texts = (def.text ?? "").split("\n//\n");
  const adventure = /^(instant|sorcery) — adventure$/.exec(types[1]?.trim().toLowerCase() ?? "");
  const spellType = adventure ? adventure[1] : types[1]?.trim().toLowerCase();
  const halves = names.length === 2 && types.length === 2 && costs.length === 2 && texts.length === 2 && (spellType === "instant" || spellType === "sorcery");
  const kind: Faces["kind"] = adventure ? "adventure" : "prepare";
  const faces = halves && (adventure || /\bprepared\b/i.test(texts[0]))
    ? {
        kind,
        front: { ...def, name: names[0], typeLine: types[0], manaCost: costs[0], text: texts[0] },
        spell: {
          id: `${def.id}//${kind}`,
          name: names[1],
          type: spellType as "instant" | "sorcery",
          cost: manaValueOf(costs[1]),
          manaCost: costs[1],
          typeLine: types[1],
          text: texts[1],
          colors: ["W", "U", "B", "R", "G"].filter((c) => new RegExp(`\\{[^}]*${c}[^}]*\\}`).test(costs[1])),
          keywords: [],
          ...(def.image ? { image: def.image } : {}),
          ...(def.scryfallId ? { scryfallId: def.scryfallId } : {}),
        },
      }
    : null;
  faceCache.set(def, faces);
  return faces;
}

/** Understands the card's rules text. Cached per card definition. */
export function parseCard(def: CardDef): ParsedCard {
  const hit = cache.get(def);
  if (hit) return hit;
  const dfc = doubleFaces(def);
  if (dfc) {
    // A transforming card is playable when both of its faces are understood.
    const front = parseCard(dfc.front);
    const back = parseCard(dfc.back);
    const whole: ParsedCard = { ...front, ok: front.ok && back.ok, unsupported: [...front.unsupported, ...back.unsupported] };
    cache.set(def, whole);
    return whole;
  }
  const faces = prepareFaces(def);
  if (faces) {
    // The creature half is the card; its spell must be understood too.
    const front = parseCard(faces.front);
    const spell = parseCard(faces.spell);
    const whole: ParsedCard = spell.ok && spell.spell ? { ...front, [faces.kind]: faces.spell } : { ...front, ok: false, unsupported: [...front.unsupported, ...spell.unsupported] };
    cache.set(def, whole);
    return whole;
  }

  const result: ParsedCard = { ok: true, triggers: [], activated: [], unsupported: [] };
  // "Cycling {2}" can sit on any kind of card: take it out first, the rest of the text is read as usual.
  const text = normalizeText(def)
    .split("\n")
    .filter((line) => {
      // Guerrilla Tactics: a spell with an ability of its own that works from the graveyard of the one who discards it
      if (readDiscardedByOpponent(line.replace(/\.$/, ""), result)) return false;
      if (line === "~ can't be countered" || line === "~ can't be countered.") {
        result.cantBeCountered = true;
        return false;
      }
      if (line === "as an additional cost to cast ~, sacrifice a creature" || line === "as an additional cost to cast ~, sacrifice a creature.") {
        result.extraSacrifice = true;
        return false;
      }
      if (/^as an additional cost to cast ~, sacrifice an artifact or creature\.?$/.test(line)) {
        result.extraSacrifice = true;
        result.extraSacrificeOrArtifact = true;
        return false;
      }
      // Waterbend {4}: an optional extra cost, paid with mana or by tapping artifacts and creatures (see stack/cast.ts)
      const waterbend = /^as an additional cost to cast ~, you may waterbend (\{\d+\})\.?$/.exec(line);
      if (waterbend) {
        result.kicker = waterbend[1];
        result.kickerName = "waterbend";
        return false;
      }
      // Paradigm: after the spell resolves it is exiled, and a copy may be cast at the beginning of each of your first main phases.
      if (line === "paradigm" && (def.type === "instant" || def.type === "sorcery")) {
        result.paradigm = true;
        return false;
      }
      const flashback = /^flashback (\{[^}]+\}(?:\{[^}]+\})*)\.?$/.exec(line);
      if (flashback && parseManaCost(flashback[1])) {
        result.flashback = flashback[1];
        return false;
      }
      // "Flashback—Sacrifice a Mountain": no mana, a permanent of that type instead
      const flashbackSac = /^flashback—sacrifice an? ([a-z]+)\.?$/.exec(line);
      if (flashbackSac) {
        result.flashback = "{0}";
        result.flashbackSacrifice = flashbackSac[1];
        return false;
      }
      const plot = /^plot (\{[^}]+\}(?:\{[^}]+\})*)\.?$/.exec(line);
      if (plot && parseManaCost(plot[1])) {
        result.plot = plot[1];
        return false;
      }
      const kicker = /^kicker (\{[^}]+\}(?:\{[^}]+\})*)\.?$/.exec(line);
      if (kicker && parseManaCost(kicker[1])) {
        result.kicker = kicker[1];
        return false;
      }
      // Offspring is a kicker whose payment makes a 1/1 token copy as the creature enters (rule 702.175).
      const offspring = /^offspring (\{[^}]+\}(?:\{[^}]+\})*)\.?$/.exec(line);
      if (offspring && parseManaCost(offspring[1]) && def.type === "creature") {
        result.kicker = offspring[1];
        result.kickerName = "offspring";
        result.triggers.push({ event: "enters", ifKicked: true, effects: [{ type: "offspringCopy" }], targets: [], text: "Offspring: when this creature enters, create a 1/1 token copy of it." });
        return false;
      }
      if (line === "delve") {
        result.delve = true;
        return false;
      }
      const teamwork = /^teamwork (\d+)$/.exec(line);
      if (teamwork && (def.type === "instant" || def.type === "sorcery")) {
        result.teamwork = Number(teamwork[1]);
        return false;
      }
      const warp = /^warp (\{[^}]+\}(?:\{[^}]+\})*)\.?$/.exec(line);
      if (warp && parseManaCost(warp[1])) {
        result.warp = warp[1];
        return false;
      }
      const blight = /^as an additional cost to cast ~, you may blight (\d+)\.?$/.exec(line);
      if (blight) {
        result.blight = Number(blight[1]);
        return false;
      }
      const reduction = /^~ costs \{(\d+)\} less to cast if you control an? ([a-z]+)\.?$/.exec(line);
      if (reduction && reduction[2] !== "creature") {
        result.costReduction = { n: Number(reduction[1]), ifControl: reduction[2] };
        return false;
      }
      const perCard = /^~ costs \{(\d+)\} less to cast for each (instant and sorcery card in your graveyard)\.?$/.exec(line);
      if (perCard) {
        result.costReduction = { n: Number(perCard[1]), per: parseCount(perCard[2].replace("card", "cards"))! };
        return false;
      }
      const caves = /^~ costs \{(\d+)\} less to cast for each cave you control and each cave card in your graveyard\.?$/.exec(line);
      if (caves) {
        result.costReduction = { n: Number(caves[1]), per: { kind: "cavesAndYard" } };
        return false;
      }
      const yardDiscount = /^~ costs \{(\d+)\} less to cast if there are (two|three|\d+) or more creature cards in your graveyard\.?$/.exec(line);
      if (yardDiscount) {
        result.costReduction = { n: Number(yardDiscount[1]), ifYardCreatures: toNumber(yardDiscount[2]) ?? 2 };
        return false;
      }
      const ifAttacking = /^~ costs \{(\d+)\} less to cast if it targets an attacking creature\.?$/.exec(line);
      if (ifAttacking) {
        result.costReduction = { n: Number(ifAttacking[1]), ifTargetsAttacking: true };
        return false;
      }
      const perSpell = /^~ costs \{(\d+)\} less to cast for each spell your opponents have cast this turn\.?$/.exec(line);
      if (perSpell) {
        result.costReduction = { n: Number(perSpell[1]), perOpponentSpell: true };
        return false;
      }
      const ifTapped = /^~ costs \{(\d+)\} less to cast if it targets a tapped (?:permanent|creature)\.?$/.exec(line);
      if (ifTapped) {
        result.costReduction = { n: Number(ifTapped[1]), ifTargetsTapped: true };
        return false;
      }
      const ifColor = /^~ costs \{(\d+)\} less to cast if it targets an? (white|blue|black|red|green) spell\.?$/.exec(line);
      if (ifColor) {
        result.costReduction = { n: Number(ifColor[1]), ifTargetsColor: COLOR_OF[ifColor[2]] };
        return false;
      }
      const harmonize = /^harmonize ((?:\{[^}]+\})+)\.?$/.exec(line);
      if (harmonize && parseManaCost(harmonize[1])) {
        result.harmonize = harmonize[1];
        return false;
      }
      // "This spell costs {X} less to cast, where X is the greatest mana value among Elementals you control."
      const greatest = /^~ costs \{X\} less to cast, where x is the greatest mana value among ([a-z]+) you control\.?$/.exec(line);
      if (greatest) {
        result.costReduction = { n: 1, per: { kind: "greatestMV", what: "subtype", subtype: singularType(greatest[1]) } };
        return false;
      }
      if (/^~ costs \{X\} less to cast, where x is the number of cards in your graveyard that are instant cards, sorcery cards, and\/or have an adventure\.?$/.test(line)) {
        result.costReduction = { n: 1, per: { kind: "graveyard", creaturesOnly: false, spellsOnly: true, adventures: true } };
        return false;
      }
      const replicate = /^replicate ((?:\{[^}]+\})+)\.?$/.exec(line);
      if (replicate) {
        result.replicate = replicate[1];
        return false;
      }
      const ifFlyer = /^~ costs \{(\d+)\} less to cast if you control a creature with flying\.?$/.exec(line);
      if (ifFlyer) {
        result.costReduction = { n: Number(ifFlyer[1]), ifFlyer: true };
        return false;
      }
      if (/^as an additional cost to cast ~, discard a card\.?$/.test(line)) {
        result.extraDiscard = true;
        return false;
      }
      const sacOrPay = /^as an additional cost to cast ~, sacrifice a creature or pay ((?:\{[^}]+\})+)\.?$/.exec(line);
      if (sacOrPay && parseManaCost(sacOrPay[1])) {
        result.extraSacrificeOrPay = sacOrPay[1];
        return false;
      }
      const typedSac = /^as an additional cost to cast ~, sacrifice an? ([a-z]+)\.?$/.exec(line);
      if (typedSac && typedSac[1] !== "creature") {
        result.extraSacrifice = true;
        result.extraSacrificeType = typedSac[1];
        return false;
      }
      const landcycling = /^(?:basic landcycling|(plains|island|swamp|mountain|forest)cycling) (\{[^}]+\}(?:\{[^}]+\})*)\.?$/.exec(line);
      if (landcycling && parseManaCost(landcycling[2])) {
        result.landcycling = landcycling[2];
        if (landcycling[1]) result.landcyclingType = landcycling[1];
        return false;
      }
      const cycling = /^cycling (\{[^}]+\}(?:\{[^}]+\})*)\.?$/.exec(line);
      if (cycling && parseManaCost(cycling[1])) result.cycling = cycling[1];
      return !cycling || !parseManaCost(cycling[1]);
    })
    .join("\n");

  const lines = text.split("\n");
  const header = /^choose (one|one or both) —$/.exec(lines[0] ?? "");
  const teamHeader = result.teamwork !== undefined && TEAMWORK_HEADER.test(lines[0] ?? "");
  if ((def.type === "instant" || def.type === "sorcery") && (header || teamHeader) && lines.length >= 3 && lines.slice(1).every((l) => l.startsWith("• "))) {
    const modes = parseModes(lines.slice(1).map((l) => stripModeName(l.slice(2))), false);
    if (modes) result.spell = { effects: [], targets: [], modal: { min: 1, max: header && header[1] !== "one" ? 2 : 1, modes, ...(teamHeader ? { bothIfKicked: true } : {}) } };
    else result.unsupported.push(text);
  } else if (def.type === "instant" || def.type === "sorcery") {
    const ctx = newCtx();
    const rewritten = result.teamwork !== undefined ? rewriteTeamwork(text.replace(/\n/g, " ")) : null;
    const effects = text ? parseEffectText(rewritten ? rewritten.text : text.replace(/\n/g, " "), ctx) : null;
    if (rewritten?.lift && effects && ctx.targets.length > 0) ctx.targets[0] = { ...ctx.targets[0], liftedWhenKicked: true };
    // A spell has no permanent to act on: "Return ~ to its owner's hand" would silently do nothing, so it stays unplayable.
    if (effects && effects.length > 0 && !JSON.stringify(effects).includes('"t":"self"')) result.spell = { effects, targets: ctx.targets };
    else result.unsupported.push(text || "(no text)");
  } else if (def.type === "creature" || def.type === "land" || def.type === "artifact" || def.type === "enchantment" || def.type === "planeswalker") {
    const creatureLines = text.split("\n").filter(Boolean);
    let classLevel = 1;
    for (let i = 0; i < creatureLines.length; i++) {
      // A Class: "{1}{B}: Level 2", and the abilities after it are those of level 2.
      const level = /^((?:\{[^}]+\})+): level (\d+)$/.exec(creatureLines[i]);
      if (level && parseManaCost(level[1])) {
        classLevel = Number(level[2]);
        result.activated.push({ tap: false, mana: level[1], effects: [{ type: "levelUp", level: classLevel }], targets: [], text: `${level[1]}: Level ${classLevel}`, sorceryOnly: true, levelUp: classLevel });
        continue;
      }
      if (classLevel > 1) {
        readAtLevel(creatureLines[i], result, classLevel);
        continue;
      }
      // "When ~ enters, choose one —" / "Whenever ~ deals combat damage to a player, choose one that hasn't been chosen —" / "Whenever ~ attacks or blocks, choose one —", then one bullet line per mode
      const modal = /^when(?:ever)? ~ (enters(?: the battlefield)?|deals combat damage to a player|attacks or blocks),? choose one( that hasn't been chosen)? —$/.exec(creatureLines[i]);
      if (modal) {
        const bullets: string[] = [];
        while (i + 1 < creatureLines.length && creatureLines[i + 1].startsWith("• ")) bullets.push(creatureLines[++i].slice(2));
        const modes = bullets.length >= 2 ? parseModes(bullets, true) : null;
        const entering = modal[1].startsWith("enters");
        const events: TriggeredAbility["event"][] = entering ? ["enters"] : modal[1] === "attacks or blocks" ? ["attacks", "blocks"] : ["combatDamagePlayer"];
        const text = `${entering ? "When this enters" : `Whenever this ${modal[1]}`}, choose one${modal[2] ?? ""}`;
        if (modes) result.triggers.push(...events.map((event) => ({ event, effects: [], targets: [], modes, text, ...(modal[2] ? { unchosenOnly: true } : {}) })));
        else result.unsupported.push(creatureLines[i]);
        continue;
      }
      // "When ~ enters, create a Food token or a Treasure token": the player chooses
      const orToken = /^when ~ enters, create an? ([a-z]+) token or an? ([a-z]+) token\.?$/.exec(creatureLines[i]);
      if (orToken) {
        const modes = parseModes([`create a ${orToken[1]} token`, `create a ${orToken[2]} token`], true);
        if (modes) result.triggers.push({ event: "enters", effects: [], targets: [], modes, text: "When this enters, choose one" });
        else result.unsupported.push(creatureLines[i]);
        continue;
      }
      // "Whenever another nontoken Hero you control enters, choose one —" (then one bullet line per mode)
      const allyModal = /^whenever another nontoken ([a-z]+) you control enters, choose one —$/.exec(creatureLines[i]);
      if (allyModal) {
        const bullets: string[] = [];
        while (i + 1 < creatureLines.length && creatureLines[i + 1].startsWith("• ")) bullets.push(creatureLines[++i].slice(2));
        const modes = bullets.length >= 2 ? parseModes(bullets.map(stripModeName), true) : null;
        if (modes) result.triggers.push({ event: "allyEnters", other: true, nontoken: true, subtypes: [allyModal[1]], effects: [], targets: [], modes, text: `Whenever another nontoken ${allyModal[1]} you control enters, choose one` });
        else result.unsupported.push(creatureLines[i]);
        continue;
      }
      parseCreatureLine(creatureLines[i], result);
    }
  } else if (text) {
    result.unsupported.push(...text.split("\n"));
  }

  if (def.keywords?.includes("prowess")) {
    result.triggers.push({ event: "noncreatureSpell", effects: [{ type: "pump", power: 1, toughness: 1, what: { t: "self" } }], targets: [], text: "Prowess" });
  }
  // An Aura is cast with a target: the spell has no effects of its own, only the thing it will be attached to.
  if (result.aura) result.spell = { effects: [], targets: [result.aura] };
  else if (def.type === "enchantment" && (def.typeLine ?? "").includes("Aura")) result.unsupported.push("(an Aura without an \"Enchant\" line)");
  // Protection looks at what is targeting: remember this card's colors on every target it can choose.
  const source = { colors: def.colors ?? [], artifact: def.type === "artifact" || (def.typeLine ?? "").split("—")[0].includes("Artifact") };
  const stamp = (specs: TargetSpec[]) => specs.map((spec) => ({ ...spec, source }));
  if (result.spell) result.spell = { ...result.spell, targets: stamp(result.spell.targets) };
  result.triggers = result.triggers.map((t) => ({ ...t, targets: stamp(t.targets) }));
  result.activated = result.activated.map((a) => ({ ...a, targets: stamp(a.targets) }));
  if (result.aura) result.aura = stamp([result.aura])[0];
  result.ok = result.unsupported.length === 0;
  cache.set(def, result);
  return result;
}

/** A line of a Class's level: what it adds works only once the Class has reached that level. */
function readAtLevel(line: string, result: ParsedCard, level: number): void {
  const before = { triggers: result.triggers.length, activated: result.activated.length, statics: result.statics?.length ?? 0 };
  parseCreatureLine(line, result);
  for (let i = before.triggers; i < result.triggers.length; i++) result.triggers[i] = { ...result.triggers[i], level };
  for (let i = before.activated; i < result.activated.length; i++) result.activated[i] = { ...result.activated[i], level };
  for (let i = before.statics; i < (result.statics?.length ?? 0); i++) result.statics![i] = { ...result.statics![i], level };
}

/** For tooling: the individual sentences of a card's text that were not understood (empty if the card is ok). */
export function failedSentences(def: CardDef): string[] {
  const out: string[] = [];
  for (const line of parseCard(def).unsupported) {
    // Look inside the line: after "When ~ enters," or after a cost such as "{T}:".
    const body = line.replace(/^when(?:ever)? ~ (?:enters(?: the battlefield)?|dies|attacks),? /, "").replace(/^[^:]*\{[^:]*: /, "");
    for (const sentence of body.replace(/\n/g, " ").split(/\.(?:\s+|$)/).map((x) => x.trim()).filter(Boolean)) {
      if (!parseClause(sentence, newCtx())) out.push(sentence);
    }
  }
  return out;
}

/** Can the engine play this card today? Its cost, keywords and every line of its rules text must be understood. */
export function isSupportedCard(def: CardDef): boolean {
  // A land needs a way to make mana, or an ability of its own (Evolving Wilds).
  if (def.type === "land") return (landManaColors(def).length > 0 || manaAbilityUsesChosenColor(def) || parseCard(def).activated.length > 0) && keywordsSupported(def) && parseCard(def).ok;
  if (def.type === "planeswalker") {
    return (def.loyalty ?? def.toughness) !== undefined && (parseCard(def).loyaltyAbilities?.length ?? 0) > 0 && manaCostOf(def) !== null && keywordsSupported(def) && parseCard(def).ok;
  }
  if (def.type === "creature" || def.type === "artifact" || def.type === "enchantment" || def.type === "instant" || def.type === "sorcery") {
    // A creature with a "*" power must have a line that says what it is counted from.
    if (def.type === "creature" && (def.power === undefined || def.toughness === undefined) && !parseCard(def).dynamicStats) return false;
    return manaCostOf(def) !== null && keywordsSupported(def) && parseCard(def).ok;
  }
  return false;
}
