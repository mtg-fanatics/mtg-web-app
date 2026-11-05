import type { ParsedCard, StaticEffect, TriggeredAbility } from "../../effects.js";
import { newCtx } from "../targets.js";
import { parseEffectText } from "../effectText.js";
import type { Keyword } from "../../keywords.js";
import { COLOR_OF, isKeyword, singularType } from "../words.js";
import { parseCreatureLine } from "../lines.js";
import { selfStatic } from "../abilities.js";

// Lines of the cards of Foundations that no older deck had: one reader for each kind of line, tried before the general ones.

const KNOWN_COUNTERS = /^(?:stun|loyalty|lore|poison|finality|plan|invasion|age|level|time|oil|shield|flying|first|double|deathtouch|lifelink|menace|trample|vigilance|haste|reach|indestructible|hexproof)$/;
const NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w: string) => NUMBER[w] ?? Number(w);
const self = (st: Partial<StaticEffect> & Pick<StaticEffect, "keywords" | "power" | "toughness">): StaticEffect => ({ scope: "self", ...st });

/** "This artifact enters with three wish counters on it." / "~ enters with eight revival counters on it if you cast it." */
function entersWithNamed(line: string, out: ParsedCard): boolean {
  const m = /^~ enters with (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([a-z]+) counters? on it( if you cast it( from your hand)?)?$/.exec(line);
  if (!m || KNOWN_COUNTERS.test(m[2])) return false;
  out.entersWithNamed = { name: m[2], n: num(m[1]), ...(m[3] ? { ifCast: true } : {}) };
  return true;
}

/** Adaptive Automaton: "~ is the chosen type in addition to its other types." */
function chosenTypeSelf(line: string, out: ParsedCard): boolean {
  if (line !== "~ is the chosen type in addition to its other types") return false;
  out.isChosenType = true;
  return true;
}

/** Valkyrie's Call, Spinner of Souls, Hare Apparent's deck rule, Soulstone Sanctuary, Crawling Barrens. */
function oddOnes(line: string, out: ParsedCard): boolean {
  if (line === "whenever a nontoken, non-angel creature you control dies, return that card to the battlefield under its owner's control with a +1/+1 counter on it. it has flying and is an angel in addition to its other types") {
    out.triggers.push({ event: "allyDies", nontoken: true, notSubtype: "angel", effects: [{ type: "returnDiedWith", counters: 1, keyword: "flying", subtype: "angel" }], targets: [], text: line });
    return true;
  }
  if (line === "whenever another nontoken creature you control dies, you may reveal cards from the top of your library until you reveal a creature card. put that card into your hand and the rest on the bottom of your library in a random order") {
    out.triggers.push({ event: "allyDies", other: true, nontoken: true, effects: [{ type: "revealUntilCreature" }], targets: [], text: line });
    return true;
  }
  if (line === "a deck can have any number of cards named ~") return true;
  if (line === "when you sacrifice ~, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle") return true; // (part of the Ordeal trigger above)
  let m = /^(\{[^}]+\}(?:\{[^}]+\})*): ~ becomes a (\d+)\/(\d+) creature with vigilance and all creature types\. it's still a land$/.exec(line);
  if (m) {
    out.activated.push({ tap: false, mana: m[1], effects: [{ type: "becomeCreatureForever", power: Number(m[2]), toughness: Number(m[3]), keywords: ["vigilance"], allTypes: true }], targets: [], text: line });
    return true;
  }
  m = /^(\{[^}]+\}(?:\{[^}]+\})*): put two \+1\/\+1 counters on ~\. then you may have it become a 0\/0 elemental creature until end of turn\. it's still a land$/.exec(line);
  if (m) {
    const what = { t: "self" as const };
    out.activated.push({ tap: false, mana: m[1], effects: [{ type: "addCounters", amount: 2, what }, { type: "becomeCreatureNow", what, subtypes: ["elemental"], nonartifact: true }, { type: "setBase", what, power: 0, toughness: 0 }], targets: [], text: line });
    return true;
  }
  return false;
}

/** Spell copiers: Thousand-Year Storm, Pyromancer's Goggles. */
function copiers(line: string, out: ParsedCard): boolean {
  if (line === "whenever you cast an instant or sorcery spell, copy it for each other instant and sorcery spell you've cast before it this turn. you may choose new targets for the copies") return ((out.copyPerSpell = true), true);
  if (line.toLowerCase() === "{t}: add {r}. when that mana is spent to cast a red instant or sorcery spell, copy that spell and you may choose new targets for the copy") return ((out.copyRedSpellMana = true), true);
  return false;
}

/** Ordeal of Nylea: counters on the creature it enchants, then it is sacrificed for two lands. */
function ordeal(line: string, out: ParsedCard): boolean {
  if (line !== "whenever enchanted creature attacks, put a +1/+1 counter on it. then if it has three or more +1/+1 counters on it, sacrifice ~") return false;
  out.triggers.push({ event: "hostAttacks", effects: [{ type: "addCounters", amount: 1, what: { t: "enchanted" } }, { type: "sacIfHostCounters", n: 3, then: [{ type: "search", tapped: true, count: 2 }] }], targets: [], text: line });
  return true;
}

/** Desecration Demon. */
function desecration(line: string, out: ParsedCard): boolean {
  if (line !== "at the beginning of each combat, any opponent may sacrifice a creature of their choice. if a player does, tap ~ and put a +1/+1 counter on it") return false;
  out.triggers.push({ event: "beginCombatEach", effects: [{ type: "demonTax" }], targets: [], text: line });
  return true;
}

/** Zimone, Kellan, Loot, Banner of Kinship. */
function lateOnes(rawLine: string, out: ParsedCard): boolean {
  const line = rawLine.toLowerCase();
  let m = /^(\{[^}]+\}(?:\{[^}]+\})*), \{t\}: double the number of each kind of counter on up to two target creatures and\/or artifacts you control$/i.exec(line);
  if (m) {
    const ctx = newCtx(true);
    ctx.targets.push({ kind: "permanent", types: ["creature", "artifact"], controller: "you", optional: true, distinct: true, label: "up to two target creatures and/or artifacts you control" }, { kind: "permanent", types: ["creature", "artifact"], controller: "you", optional: true, distinct: true, label: "up to two target creatures and/or artifacts you control" });
    out.activated.push({ tap: true, mana: m[1].toUpperCase(), effects: [{ type: "doubleCountersOn", what: [{ t: "target", i: 0 }, { t: "target", i: 1 }] }], targets: ctx.targets, text: line });
    return true;
  }
  if (line === "{1}{r}: if ~ is a scout, it becomes a human faerie detective and gains \"whenever ~ deals combat damage to a player, exile the top card of your library. you may play that card this turn.\"") {
    out.activated.push({ tap: false, mana: "{1}{R}", effects: [{ type: "kellan", step: 1 }], targets: [], text: line });
    out.triggers.push({ event: "combatDamagePlayer", cond: { namedAtLeast: { name: "stage", n: 1 } }, effects: [{ type: "exileTopTurn" }], targets: [], text: "Whenever Kellan deals combat damage to a player, exile the top card of your library. You may play that card this turn." });
    return true;
  }
  if (line === "{2}{r}: if ~ is a detective, it becomes a 3/2 human faerie rogue and gains double strike") {
    out.activated.push({ tap: false, mana: "{2}{R}", effects: [{ type: "kellan", step: 2 }], targets: [], text: line });
    (out.statics ??= []).push({ scope: "self", power: 0, toughness: 0, keywords: ["double strike"], cond: { selfNamedAtLeast: { name: "stage", n: 2 } } });
    return true;
  }
  if (/^enchanted creature loses all abilities and is a green and white citizen creature with base power and toughness 1\/1 named /.test(line)) return ((out.witnessProtection = true), true);
  if (line === "as ~ enters, look at an opponent's hand, then choose any card name") return ((out.chooseName = true), true);
  if (line === "activated abilities of sources with the chosen name can't be activated unless they're mana abilities") return ((out.spyglass = true), true);
  if (line === "you may look at the top card of your library any time" || line === "you can spend mana of any type to cast creature spells") return true;
  if (line === "you may cast creature spells from the top of your library") return ((out.castCreaturesFromTop = true), true);
  if (line === "you may play an additional land on each of your turns") return ((out.extraLandDrops = 1), true);
  m = /^(\{[^}]+\}(?:\{[^}]+\})*), \{t\}: look at the top six cards of your library\. you may reveal a creature card with mana value less than or equal to the number of lands you control from among them and put it onto the battlefield\. put the rest on the bottom in a random order$/i.exec(line);
  if (m) {
    out.activated.push({ tap: true, mana: m[1].toUpperCase(), effects: [{ type: "digCreature", n: 6 }], targets: [], text: line });
    return true;
  }
  if (line === "as ~ enters, choose a creature type. ~ enters with a fellowship counter on it for each creature you control of the chosen type") return ((out.chooseType = true), (out.fellowship = true), true);
  if (line === "~ enters with a fellowship counter on it for each creature you control of the chosen type") return ((out.fellowship = true), true);
  return false;
}

/** Tinybones, Bauble Burglar. */
function tinybones(line: string, out: ParsedCard): boolean {
  if (line === "whenever an opponent discards a card, exile it from their graveyard with a stash counter on it") {
    out.triggers.push({ event: "oppDiscards", effects: [{ type: "stashDiscard" }], targets: [], text: line });
    return true;
  }
  if (line === "during your turn, you may play cards you don't own with stash counters on them from exile, and mana of any type can be spent to cast those spells") return true;
  return false;
}

/** Fishing Pole. */
function pole(rawLine: string, out: ParsedCard): boolean {
  const line = rawLine.toLowerCase();
  const m = /^equipped creature has "(\{[^}]+\}(?:\{[^}]+\})*), \{t\}, tap ~: put a bait counter on ~\.?"$/.exec(line);
  if (m) {
    out.activated.push({ tap: true, tapHost: true, mana: m[1].toUpperCase(), effects: [{ type: "namedCounters", name: "bait", amount: 1, what: { t: "self" } }], targets: [], text: rawLine });
    return true;
  }
  if (line === "whenever equipped creature becomes untapped, remove a bait counter from ~. if you do, create a 1/1 blue fish creature token") {
    out.triggers.push({ event: "hostUntapped", hostOnly: true, effects: [{ type: "baitFish" }], targets: [], text: rawLine });
    return true;
  }
  return false;
}

/** Wildborn Preserver. */
function preserver(rawLine: string, out: ParsedCard): boolean {
  if (rawLine.toLowerCase() !== "whenever another non-human creature you control enters, you may pay {x}. when you do, put x +1/+1 counters on ~") return false;
  out.triggers.push({ event: "allyEnters", other: true, notSubtype: "human", effects: [{ type: "payXCounters" }], targets: [], text: rawLine });
  return true;
}

/** Quilled Greatwurm. */
function wurm(line: string, out: ParsedCard): boolean {
  if (line === "whenever a creature you control deals combat damage during your turn, put that many +1/+1 counters on it") {
    out.triggers.push({ event: "allyDealsDamage", yourTurnOnly: true, effects: [{ type: "addCounters", amount: { count: { kind: "x" } }, what: { t: "other" } }], targets: [], text: line });
    return true;
  }
  if (line === "you may cast ~ from your graveyard by removing six counters from among creatures you control in addition to paying its other costs") return ((out.graveyardCastCounters = 6), true);
  return false;
}

/** Leyline Axe. */
function leyline(line: string, out: ParsedCard): boolean {
  if (line !== "if ~ is in your opening hand, you may begin the game with it on the battlefield") return false;
  out.beginsOnBattlefield = true;
  return true;
}

/** Aurelia, the Warleader. */
function aurelia(line: string, out: ParsedCard): boolean {
  if (line !== "whenever ~ attacks for the first time each turn, untap all creatures you control. after this phase, there is an additional combat phase") return false;
  out.triggers.push({ event: "attacks", oncePerTurn: true, effects: [{ type: "untap", what: { t: "allCreatures", scope: "yours" } }, { type: "extraCombat" }], targets: [], text: line });
  return true;
}

/** Gate Colossus. */
function gateColossus(line: string, out: ParsedCard): boolean {
  if (line !== "whenever a gate you control enters, you may put ~ from your graveyard on top of your library") return false;
  out.triggers.push({ event: "gateEnters", fromYard: true, effects: [{ type: "topOfLibrary", what: { t: "self" } }], targets: [], text: line });
  return true;
}

/** Infernal Vessel: comes back once, as a Demon with two +1/+1 counters. */
function vesselReturn(line: string, out: ParsedCard): boolean {
  if (line !== "when ~ dies, if it wasn't a demon, return it to the battlefield under its owner's control with two +1/+1 counters on it. it's a demon in addition to its other types") return false;
  out.triggers.push({ event: "dies", diedNotSubtype: "demon", effects: [{ type: "returnSelfToBattlefield", counters: 2, addSubtype: "demon" }], targets: [], text: line });
  return true;
}

/** Wilt-Leaf Liege: put onto the battlefield instead when an opponent makes you discard it. */
function liegeDiscard(line: string, out: ParsedCard): boolean {
  if (line !== "if a spell or ability an opponent controls causes you to discard ~, put it onto the battlefield instead of putting it into your graveyard") return false;
  out.triggers.push({ event: "discardedByOpp", effects: [{ type: "returnSelfToBattlefield" }], targets: [], text: line });
  return true;
}

/** Nine-Lives Familiar. */
function revival(line: string, out: ParsedCard): boolean {
  if (line !== "when ~ dies, if it had a revival counter on it, return it to the battlefield with one fewer revival counter on it at the beginning of the next end step") return false;
  out.triggers.push({ event: "dies", diedHadNamed: "revival", effects: [{ type: "reviveLater", name: "revival" }], targets: [], text: line });
  return true;
}

/** Replacement effects on where cards go. */
function graveyardRules(line: string, out: ParsedCard): boolean {
  if (/^if ~ would be put into a graveyard from anywhere, reveal ~ and shuffle it into its owner's library instead$/.test(line)) return ((out.shuffleInstead = true), true);
  if (line === "if an instant or sorcery card would be put into a graveyard from anywhere, exile it instead") return ((out.exileSpellsInstead = true), true);
  if (line === "protection from everything") return ((out.protection = { colors: ["W", "U", "B", "R", "G"], artifacts: true, everything: true }), true);
  return false;
}

/** Authority of the Consuls, Goblin Boarders. */
function enterRules(line: string, out: ParsedCard): boolean {
  if (line === "creatures your opponents control enter tapped") return ((out.oppCreaturesEnterTapped = true), true);
  const m = /^(?:raid — )?~ enters with a \+1\/\+1 counter on it if you attacked this turn$/.exec(line);
  if (m) return ((out.entersWithCounterIfAttacked = 1), true);
  const o = /^whenever a creature an opponent controls enters, (.+)$/.exec(line);
  if (o) return trigger(out, line, "oppCreatureEnters", o[1]);
  return false;
}

/** Prime Speaker Zegana: "~ enters with X +1/+1 counters on it, where X is the greatest power among other creatures you control." */
function entersWithGreatest(line: string, out: ParsedCard): boolean {
  if (line !== "~ enters with x +1/+1 counters on it, where x is the greatest power among other creatures you control") return false;
  out.entersWithGreatestPower = true;
  return true;
}

/** Tragic Banshee: "Morbid — When ~ enters, target creature an opponent controls gets -1/-1 until end of turn. If a creature died this turn, that creature gets -13/-13 until end of turn instead." */
function morbidShrink(line: string, out: ParsedCard): boolean {
  const m = /^(?:morbid — )?when ~ enters, target creature an opponent controls gets -1\/-1 until end of turn\. if a creature died this turn, that creature gets -(\d+)\/-(\d+) until end of turn instead$/.exec(line);
  if (!m) return false;
  const ctx = newCtx(true);
  ctx.targets.push({ kind: "creature", controller: "opponent", label: "target creature an opponent controls" });
  const what = { t: "target" as const, i: 0 };
  out.triggers.push({
    event: "enters",
    effects: [{ type: "ifNow", cond: "morbid", then: [{ type: "pump", power: -Number(m[1]), toughness: -Number(m[2]), what }], otherwise: [{ type: "pump", power: -1, toughness: -1, what }] }],
    targets: ctx.targets,
    text: line,
  });
  return true;
}

/** "Hexproof from white" / "Lifelink, hexproof from instants". */
function hexproofFrom(line: string, out: ParsedCard): boolean {
  const m = /^(?:(.+), )?hexproof from (white|blue|black|red|green|instants|sorceries)$/.exec(line);
  if (!m) return false;
  if (m[1]) parseCreatureLine(m[1], out);
  (out.hexproofFrom ??= []).push(COLOR_OF[m[2]] ?? singularType(m[2]).replace("sorcerie", "sorcery"));
  return true;
}

/** Statics about the permanent itself that depend on how it is right now. */
function selfConditional(line: string, out: ParsedCard): boolean {
  // Elenda: two sentences on one line, each a static of its own
  const two = /^(as long as your life total is greater than your starting life total, ~ gets .+?)\. (~ gets an additional .+)$/.exec(line);
  if (two) return selfConditional(two[1], out) && selfConditional(two[2], out);
  // Tempest Djinn: "~ gets +1/+0 for each basic island you control"
  if (/^~ gets [+-]\d+\/[+-]\d+ for each [a-z ]+$/.test(line)) {
    const st = selfStatic(line);
    if (st) {
      (out.statics ??= []).push(st);
      return true;
    }
  }
  let m = /^~ gets \+(\d+)\/\+(\d+) as long as any player controls an? (white|blue|black|red|green) permanent$/.exec(line);
  if (m) {
    (out.statics ??= []).push(self({ power: Number(m[1]), toughness: Number(m[2]), keywords: [], cond: { colorPermAny: COLOR_OF[m[3]] } }));
    return true;
  }
  m = /^~ has ([a-z ]+?) as long as it has an? ([a-z]+) counter on it$/.exec(line);
  if (m && isKeyword(m[1]) && !KNOWN_COUNTERS.test(m[2])) {
    (out.statics ??= []).push(self({ power: 0, toughness: 0, keywords: [m[1] as Keyword], cond: { selfNamedAtLeast: { name: m[2], n: 1 } } }));
    return true;
  }
  m = /^as long as ~ has (two|three|four|five|\d+) or more \+1\/\+1 counters on it, it has ([a-z ]+?) and is an? ([a-z]+) in addition to its other types$/.exec(line);
  if (m && isKeyword(m[2])) {
    (out.statics ??= []).push(self({ power: 0, toughness: 0, keywords: [m[2] as Keyword], addSubtypes: [m[3]], cond: { selfCountersAtLeast: num(m[1]) } }));
    return true;
  }
  // Elenda: "As long as your life total is greater than your starting life total, ~ gets +1/+1 and has menace." / "~ gets an additional +5/+5 as long as your life total is at least 10 greater than your starting life total."
  m = /^as long as your life total is greater than your starting life total, ~ gets \+(\d+)\/\+(\d+) and has ([a-z ]+)$/.exec(line);
  if (m && isKeyword(m[3])) {
    (out.statics ??= []).push(self({ power: Number(m[1]), toughness: Number(m[2]), keywords: [m[3] as Keyword], cond: { lifeAtLeast: 21 } }));
    return true;
  }
  m = /^~ gets an additional \+(\d+)\/\+(\d+) as long as your life total is at least (\d+) greater than your starting life total$/.exec(line);
  if (m) {
    (out.statics ??= []).push(self({ power: Number(m[1]), toughness: Number(m[2]), keywords: [], cond: { lifeAtLeast: 20 + Number(m[3]) } }));
    return true;
  }
  // Ghitu Lavarunner
  m = /^as long as there are (two|three|\d+) or more instant and\/or sorcery cards in your graveyard, ~ gets \+(\d+)\/\+(\d+) and has ([a-z ]+)$/.exec(line);
  if (m && isKeyword(m[4])) {
    (out.statics ??= []).push(self({ power: Number(m[2]), toughness: Number(m[3]), keywords: [m[4] as Keyword], cond: { yardInstSorcAtLeast: num(m[1]) } }));
    return true;
  }
  // Cephalid Inkmage: "Threshold — ~ can't be blocked as long as there are seven or more cards in your graveyard."
  m = /^~ can't be blocked as long as there are (seven|\d+) or more cards in your graveyard$/.exec(line);
  if (m) {
    (out.statics ??= []).push(self({ power: 0, toughness: 0, keywords: [], unblockable: true, cond: { yardAtLeast: num(m[1]) } }));
    return true;
  }
  return false;
}

/** "~ can't be blocked by Humans." / "by Walls." */
function cantBeBlockedBy(line: string, out: ParsedCard): boolean {
  const m = /^~ can't be blocked by ([a-z]+)$/.exec(line);
  if (!m || /^(creatures|power)/.test(m[1])) return false;
  (out.cantBeBlockedBySubtypes ??= []).push(singularType(m[1]));
  return true;
}

/** Rules that change how the game treats damage, spells and players while the permanent is in play. */
function gameRules(line: string, out: ParsedCard): boolean {
  if (line === "prevent all combat damage that would be dealt to and dealt by ~") return ((out.fogSelf = true), true);
  if (line === "instant and sorcery spells you control can't be countered") return ((out.spellsUncounterable = true), true);
  if (line === "you have hexproof") return ((out.youHexproof = true), true);
  if (line === "you can't lose the game and your opponents can't win the game") return ((out.cantLose = true), true);
  if (line === "if a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead") return ((out.damageDoubler = { creaturesOnly: false, opponentSideOnly: true }), true);
  if (line === "if a creature you control would deal damage to a permanent or player, it deals double that damage instead") return ((out.damageDoubler = { creaturesOnly: true, opponentSideOnly: false }), true);
  if (line === "if an effect would create one or more tokens under your control, it creates twice that many of those tokens instead") return ((out.doubleTokens = true), true);
  if (line === "if an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead") return ((out.doubleCounters = true), true);
  if (line === "you may cast spells from your hand without paying their mana costs") return ((out.castFree = true), true);
  if (line === "you may cast spells as though they had flash") return ((out.flashAll = true), true);
  if (line === "at the beginning of each player's draw step, that player draws an additional card") return ((out.extraDraw = true), true);
  if (line === "prevent all noncombat damage that would be dealt to other creatures you control") return ((out.preventNoncombatOthers = true), true);
  return false;
}

/** A trigger whose effects are read from the sentence after the comma. */
function trigger(out: ParsedCard, line: string, event: TriggeredAbility["event"], body: string, extra: Partial<TriggeredAbility> = {}, tweak?: (ctx: ReturnType<typeof newCtx>) => void): true {
  const ctx = newCtx(true);
  const effects = parseEffectText(body, ctx);
  if (effects && effects.length > 0) {
    tweak?.(ctx);
    out.triggers.push({ event, effects, targets: ctx.targets, text: line, ...extra });
  } else out.unsupported.push(line);
  return true;
}

/** Mazemind Tome: "When there are four or more page counters on this artifact, exile it. If you do, you gain 4 life." */
function counterLimit(line: string, out: ParsedCard): boolean {
  const m = /^when there are (two|three|four|five|six|seven|\d+) or more ([a-z]+) counters on ~, exile it\. if you do, you gain (\d+) life$/.exec(line);
  if (!m) return false;
  out.triggers.push({ event: "namedLimit", cond: { namedAtLeast: { name: m[2], n: num(m[1]) } }, effects: [{ type: "exile", what: { t: "self" } }, { type: "gainLife", amount: Number(m[3]), who: { t: "you" } }], targets: [], text: line });
  return true;
}

/** Triggers of Foundations cards about combat and attacking. */
function combatTriggers(line: string, out: ParsedCard): boolean {
  // Trygon Predator: "you may destroy target artifact or enchantment that player controls" (the player who was hit is the opponent)
  let m = /^whenever ~ deals combat damage to a player, you may destroy target artifact or enchantment that player controls$/.exec(line);
  if (m) return trigger(out, line, "combatDamagePlayer", "destroy target artifact or enchantment an opponent controls", {}, (ctx) => (ctx.targets[0] = { ...ctx.targets[0], optional: true }));
  // Goldvein Pick: "whenever equipped creature deals combat damage to a player, create a Treasure token"
  m = /^whenever equipped creature deals combat damage to a player, (.+)$/.exec(line);
  if (m) return trigger(out, line, "hostDamagesPlayer", m[1]);
  // Linden: "whenever a white creature you control attacks, you gain 1 life"
  m = /^whenever an? (white|blue|black|red|green) creature you control attacks, (.+)$/.exec(line);
  if (m) return trigger(out, line, "allyAttacks", m[2], { spellColor: COLOR_OF[m[1]] });
  // Armasaur Guide: "whenever you attack with three or more creatures, put a +1/+1 counter on target creature you control"
  m = /^whenever you attack with (three|four|\d+) or more creatures, (.+)$/.exec(line);
  if (m) return trigger(out, line, "attackTwo", m[2], { cond: { attackersAtLeast: num(m[1]) } });
  // Courageous Goblin, Ruby: "whenever ~ attacks while you control a creature with power 4 or greater, ~ gets +1/+0 and gains menace until end of turn"
  m = /^whenever ~ attacks while you control a creature with power (\d+) or greater, (.+)$/.exec(line);
  if (m) return trigger(out, line, "attacks", m[2], { cond: { creaturePowerAtLeast: Number(m[1]) } });
  return false;
}

/** Sanguine Indulgence: "This spell costs {3} less to cast if you've gained 3 or more life this turn." */
function costLessIfLife(line: string, out: ParsedCard): boolean {
  const m = /^~ costs \{(\d+)\} less to cast if you've gained (\d+) or more life this turn$/.exec(line);
  if (!m) return false;
  out.costReduction = { n: Number(m[1]), ifLifeGained: Number(m[2]) };
  return true;
}

/** Triggers that watch what happens to the opponent, and spells they cast. */
function watchers(line: string, out: ParsedCard): boolean {
  let m = /^whenever an opponent loses life, (you gain that much life)$/.exec(line);
  if (m) return trigger(out, line, "oppLosesLife", m[1]);
  m = /^whenever a source you control deals noncombat damage to an opponent, you draw that many cards$/.exec(line);
  if (m) return trigger(out, line, "oppNoncombatDamage", "you draw that many cards");
  m = /^whenever an opponent draws a card, that player loses (\d+) life$/.exec(line);
  if (m) return trigger(out, line, "oppDraws", `each opponent loses ${m[1]} life`);
  m = /^whenever an opponent casts an? (white|blue|black|red|green) or (white|blue|black|red|green) (instant or sorcery )?spell, (.+)$/.exec(line);
  if (m) {
    const body = m[4].replace("that player", "each opponent");
    return trigger(out, line, "opponentCasts", body, { spellColorsAny: [COLOR_OF[m[1]], COLOR_OF[m[2]]], ...(m[3] ? { spellInstantSorcery: true } : {}) });
  }
  m = /^whenever a creature you control with deathtouch deals combat damage to a player, that player gets (a|one|two|three) poison counters?$/.exec(line);
  if (m) return trigger(out, line, "allyDeathtouchHits", `each opponent gets ${m[1]} poison counter${m[1] === "a" || m[1] === "one" ? "" : "s"}`);
  if (line === "whenever another creature you control dies, draw a card if it was attacking. otherwise, ~ deals 1 damage to each opponent") {
    trigger(out, line, "allyDies", "draw a card", { other: true, diedAttacking: true });
    return trigger(out, line, "allyDies", "~ deals 1 damage to each opponent", { other: true, diedAttacking: false });
  }
  if (line === "whenever you cast a spell, put a +1/+1 counter on ~ for each of that spell's colors") {
    out.triggers.push({ event: "youCast", xFrom: "colors", effects: [{ type: "addCounters", amount: { count: { kind: "x" } }, what: { t: "self" } }], targets: [], text: line });
    return true;
  }
  m = /^whenever ~ attacks, if there are (seven|\d+) or more cards in your graveyard, you may create scion of the deep, a legendary 8\/8 blue octopus creature token$/.exec(line);
  if (m) return trigger(out, line, "attacks", "create an 8/8 blue octopus creature token", { cond: { yardAtLeast: num(m[1]) } });
  m = /^(?:formidable — )?at the beginning of combat on your turn, if creatures you control have total power (\d+) or greater, (target creature you control gains haste until end of turn)$/.exec(line);
  if (m) return trigger(out, line, "beginCombat", m[2], { yourTurnOnly: true, cond: { totalPowerAtLeast: Number(m[1]) } });
  if (/^alliance — whenever another creature you control enters, ~ gains deathtouch until end of turn\. if this is the second time this ability has resolved this turn, all creatures you control gain deathtouch until end of turn$/.test(line)) {
    out.triggers.push({ event: "allyEnters", other: true, effects: [{ type: "venom" }], targets: [], text: line });
    return true;
  }
  if (line === "whenever ~ attacks, ~ deals 4 damage to any target and 3 damage to each of up to two other targets") {
    const ctx = newCtx(true);
    ctx.targets.push({ kind: "any", distinct: true, label: "any target" }, { kind: "any", optional: true, distinct: true, label: "up to two other targets" }, { kind: "any", optional: true, distinct: true, label: "up to two other targets" });
    out.triggers.push({ event: "attacks", effects: [{ type: "damage", amount: 4, to: { t: "target", i: 0 } }, { type: "damage", amount: 3, to: { t: "target", i: 1 } }, { type: "damage", amount: 3, to: { t: "target", i: 2 } }], targets: ctx.targets, text: line });
    return true;
  }
  if (line === "whenever an opponent casts a spell, that player loses 5 life unless they discard a card") {
    out.triggers.push({ event: "opponentCasts", effects: [{ type: "loseUnless", amount: 5, discard: true, sacrifice: false }], targets: [], text: line });
    return true;
  }
  m = /^(?:raid — )?at the beginning of your end step, if you attacked this turn, each opponent loses (\d+) life unless that player sacrifices a nonland permanent of their choice or discards a card$/.exec(line);
  if (m) {
    out.triggers.push({ event: "endStep", cond: { attackedThisTurn: true }, effects: [{ type: "loseUnless", amount: Number(m[1]), discard: true, sacrifice: true }], targets: [], text: line });
    return true;
  }
  if (line === "whenever a creature you control deals combat damage to a player, put a loyalty counter on ~") {
    return trigger(out, line, "allyDamagesPlayer", "put a loyalty counter on ~");
  }
  if (line === "whenever you cast a noncreature spell, create x 1/1 red phyrexian goblin creature tokens, where x is the mana value of that spell. they gain haste until end of turn") {
    out.triggers.push({ event: "noncreatureSpell", xFrom: "mv", effects: [{ type: "createToken", amount: { count: { kind: "x" } }, token: { name: "Phyrexian Goblin", type: "creature", power: 1, toughness: 1, colors: ["R"], subtypes: "Phyrexian Goblin", keywords: ["haste"], text: "" } }], targets: [], text: line });
    return true;
  }
  m = /^whenever you cast a spell of the chosen color, (.+)$/.exec(line);
  if (m) return trigger(out, line, "youCast", m[1], { spellChosenColor: true });
  m = /^whenever you gain life for the first time during each of your turns, (.+)$/.exec(line);
  if (m) return trigger(out, line, "lifeGained", m[1], { firstLifeGain: true, yourTurnOnly: true });
  // Nessian Hornbeetle, Halana and Alena: at the beginning of combat on your turn, if you control another creature with power 4 or greater, ...
  m = /^(?:ferocious — )?at the beginning of combat on your turn, if you control (another|a) creature with power (\d+) or greater, (.+)$/.exec(line);
  if (m) return trigger(out, line, "beginCombat", m[3], { yourTurnOnly: true, ...(/from your graveyard/.test(m[3]) ? { fromYard: true } : {}), cond: { creaturePowerAtLeast: Number(m[2]), ...(m[1] === "another" ? { creaturePowerOther: true } : {}) } });
  return false;
}

export function readFoundations(line: string, out: ParsedCard): boolean {
  return tinybones(line, out) || pole(line, out) || preserver(line, out) || wurm(line, out) || lateOnes(line, out) || leyline(line, out) || ordeal(line, out) || desecration(line, out) || aurelia(line, out) || gateColossus(line, out) || copiers(line, out) || oddOnes(line, out) || liegeDiscard(line, out) || revival(line, out) || vesselReturn(line, out) || graveyardRules(line, out) || chosenTypeSelf(line, out) || enterRules(line, out) || entersWithGreatest(line, out) || morbidShrink(line, out) || entersWithNamed(line, out) || counterLimit(line, out) || combatTriggers(line, out) || hexproofFrom(line, out) || selfConditional(line, out) || cantBeBlockedBy(line, out) || gameRules(line, out) || watchers(line, out) || costLessIfLife(line, out);
}
