import type { Amount, Effect } from "../effects.js";
import { isKeyword, toAmount } from "./words.js";
import type { Keyword } from "../keywords.js";
import { refFor } from "./targets.js";
import type { Ctx } from "./targets.js";

// Sentences of the cards of Foundations that no older deck had.

type SentenceParser = (s: string, ctx: Ctx) => Effect[] | null;

const WORD_N: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// the counters that other parts of the engine already know by name
const KNOWN_COUNTERS = /^(?:stun|loyalty|lore|poison|finality|plan|invasion|age|level|time|oil|shield|flying|first|double|deathtouch|lifelink|menace|trample|vigilance|haste|reach|indestructible|hexproof)$/;

const itself = (what: string, ctx: Ctx): boolean => what === "~" || (what === "it" && !!ctx.allowSelf && !ctx.itIsOther);

/** "Put a bait counter on ~." / "put that many incubation counters on it" / "remove three incubation counters from ~". */
const namedCounters: SentenceParser = (s, ctx) => {
  const put = /^put (a|an|one|two|three|four|five|that many) ([a-z]+) counters? on (~|it)$/.exec(s);
  if (put && !KNOWN_COUNTERS.test(put[2]) && itself(put[3], ctx)) {
    const amount: Amount = put[1] === "that many" ? { count: { kind: "x" } } : (WORD_N[put[1]] ?? 1);
    return [{ type: "namedCounters", name: put[2], amount, what: { t: "self" } }];
  }
  const take = /^remove (a|an|one|two|three|four|five) ([a-z]+) counters? from (~|it)$/.exec(s);
  if (take && !KNOWN_COUNTERS.test(take[2]) && itself(take[3], ctx)) return [{ type: "namedCounters", name: take[2], amount: WORD_N[take[1]] ?? 1, what: { t: "self" }, remove: true }];
  return null;
};

/** "Each opponent discards their hand." / "Each player discards their hand, then draws seven cards." */
const discardHands: SentenceParser = (s, ctx) => {
  const m = /^(each opponent|each player|target player|target opponent) discards their hand(?:, then draws? (a|one|two|three|four|five|six|seven|\d+) cards?)?$/.exec(s);
  const who = m ? refFor(m[1], ctx) : null;
  if (!m || !who) return null;
  const draw = m[2] ? toAmount(m[2]) : null;
  return [{ type: "discardHands", who, ...(typeof draw === "number" ? { thenDraw: draw } : {}) }];
};

/** "An opponent gains control of ~." (Wishclaw Talisman) */
const giftControl: SentenceParser = (s) => (s === "an opponent gains control of ~" ? [{ type: "giftControl", what: { t: "self" } }] : null);

/** "Each opponent loses life equal to the number of soul counters on ~." (read as: the counters it had as it was sacrificed, which is the X of the ability) */
const lifeLossPerCounters: SentenceParser = (s, ctx) => {
  const m = /^each opponent loses life equal to the number of ([a-z]+) counters on ~$/.exec(s);
  if (!m) return null;
  void ctx;
  return [{ type: "loseLife", amount: { count: { kind: "x" } }, who: { t: "opp" } }];
};

/** "Until end of turn, creatures you control get +1/+1 and gain haste." (Heroic Reinforcements) */
const teamPumpAndGain: SentenceParser = (s) => {
  const m = /^until end of turn, creatures you control get \+(\d+)\/\+(\d+) and gain ([a-z ]+)$/.exec(s);
  if (!m || !isKeyword(m[3])) return null;
  const what = { t: "allCreatures" as const, scope: "yours" as const };
  return [{ type: "pump", power: Number(m[1]), toughness: Number(m[2]), what }, { type: "grant", keyword: m[3] as Keyword, what }];
};

/** "Other creatures you control get +1/+1 until end of turn." (Syr Alin) */
const otherTeamPump: SentenceParser = (s) => {
  const m = /^other creatures you control get \+(\d+)\/\+(\d+) until end of turn$/.exec(s);
  return m ? [{ type: "pump", power: Number(m[1]), toughness: Number(m[2]), what: { t: "allCreatures", scope: "yours", notSelf: true } }] : null;
};

/** "Another target creature you control gains trample and gets +X/+X until end of turn, where X is ~'s power." (Ashroot Animist) */
const ashroot: SentenceParser = (s, ctx) => {
  if (s !== "another target creature you control gains trample and gets +x/+x until end of turn, where x is ~'s power") return null;
  ctx.targets.push({ kind: "creature", controller: "you", other: true, label: "another target creature you control" });
  const what = { t: "target" as const, i: ctx.targets.length - 1 };
  return [{ type: "grant", keyword: "trample", what }, { type: "pump", power: 1, toughness: 1, what, per: { kind: "selfPower" } }];
};

/** "Double target creature's power until end of turn." (Bulk Up) */
const doublePower: SentenceParser = (s, ctx) => {
  if (s !== "double target creature's power until end of turn") return null;
  ctx.targets.push({ kind: "creature", label: "target creature" });
  const i = ctx.targets.length - 1;
  return [{ type: "pump", power: 1, toughness: 0, what: { t: "target", i }, per: { kind: "targetPower", i } }];
};

/** "Return all attacking creatures to their owner's hand." (Aetherize) */
const bounceAttackers: SentenceParser = (s) => (s === "return all attacking creatures to their owner's hand" ? [{ type: "bounce", what: { t: "attackingCreatures" } }] : null);

/** "Return up to one other target permanent you control to its owner's hand." (Mischievous Pup) */
const bounceOwnOther: SentenceParser = (s, ctx) => {
  if (s !== "return up to one other target permanent you control to its owner's hand") return null;
  ctx.targets.push({ kind: "permanent", controller: "you", other: true, optional: true, label: "up to one other target permanent you control" });
  return [{ type: "bounce", what: { t: "target", i: ctx.targets.length - 1 } }];
};

/** "You may have it fight target creature you don't control." (Affectionate Indrik: "it" is the creature that entered) */
const mayFight: SentenceParser = (s, ctx) => {
  if (s !== "you may have it fight target creature you don't control" || !ctx.allowSelf) return null;
  ctx.targets.push({ kind: "creature", controller: "opponent", label: "target creature you don't control" });
  return [{ type: "fight", a: { t: "self" }, b: { t: "target", i: ctx.targets.length - 1 } }];
};

const discardUnlessAttacked: SentenceParser = (s) => (s === "discard a card unless you attacked this turn" ? [{ type: "discardUnlessAttacked" }] : null);

/** "Return all creature cards with mana value 2 or less from your graveyard to the battlefield." (Raise the Past) */
const raiseThePast: SentenceParser = (s) => {
  const m = /^return all creature cards with mana value (\d+) or less from your graveyard to the battlefield$/.exec(s);
  return m ? [{ type: "reanimateAll", maxMV: Number(m[1]) }] : null;
};

/** "If target player has exactly 10 life, ~ deals 10 damage to that player." (Hidetsugu's Second Rite) */
const exactLifeBurn: SentenceParser = (s, ctx) => {
  const m = /^if target player has exactly (\d+) life, ~ deals (\d+) damage to that player$/.exec(s);
  if (!m) return null;
  const who = refFor("target player", ctx);
  return who ? [{ type: "damageIfLife", who, life: Number(m[1]), amount: Number(m[2]) }] : null;
};

/** "Draw a card for each different mana value among nonland permanents you control." (Lunar Insight) */
const drawPerMV: SentenceParser = (s) => (s === "draw a card for each different mana value among nonland permanents you control" ? [{ type: "draw", amount: { count: { kind: "distinctMV" } }, who: { t: "you" } }] : null);

/** "Target opponent loses X life, where X is the amount of life you gained this turn." (Midnight Snack) */
const lifeGainedDrain: SentenceParser = (s, ctx) => {
  if (s !== "target opponent loses x life, where x is the amount of life you gained this turn") return null;
  const who = refFor("target opponent", ctx);
  return who ? [{ type: "loseLife", amount: { count: { kind: "lifeGainedThisTurn" } }, who }] : null;
};

/** "You gain that much life" / "you draw that many cards": the amount is the one the trigger carried. */
const thatMuch: SentenceParser = (s) => {
  if (s === "you gain that much life") return [{ type: "gainLife", amount: { count: { kind: "x" } }, who: { t: "you" } }];
  if (s === "you draw that many cards") return [{ type: "draw", amount: { count: { kind: "x" } }, who: { t: "you" } }];
  return null;
};

/** "You may put a +1/+1 counter on ~" (taking the counter is never worse, so it is always taken). */
const mayCounter: SentenceParser = (s) => (s === "you may put a +1/+1 counter on ~" ? [{ type: "addCounters", amount: 1, what: { t: "self" } }] : null);

/** "Each opponent loses X life. You gain life equal to the life lost this way." (rewritten to one token) */
const drainLife: SentenceParser = (s) => {
  const m = /^@@drain (x|\d+)@@$/.exec(s);
  return m ? [{ type: "drainLife", amount: m[1] === "x" ? "X" : Number(m[1]) }] : null;
};

/** "Return all nonland permanents target player controls to their owner's hand." (River's Rebuke) */
const bounceNonland: SentenceParser = (s, ctx) => {
  if (s !== "return all nonland permanents target player controls to their owner's hand") return null;
  const who = refFor("target player", ctx);
  return who?.t === "target" ? [{ type: "bounce", what: { t: "creaturesOf", i: who.i, nonland: true } }] : null;
};

/** "Put all creature cards from all graveyards onto the battlefield under your control." (Rise of the Dark Realms) */
const riseAll: SentenceParser = (s) => (s === "put all creature cards from all graveyards onto the battlefield under your control" ? [{ type: "reanimateAll", maxMV: 999, fromAll: true }] : null);

/** "Return up to two target creature cards from your graveyard to your hand." (Macabre Waltz, Sanguine Indulgence) */
const returnCreatures: SentenceParser = (s, ctx) => {
  const m = /^return up to (one|two|three) target creature cards? from your graveyard to your hand$/.exec(s);
  if (!m) return null;
  const n = WORD_N[m[1]];
  const out: Effect[] = [];
  for (let i = 0; i < n; i++) {
    ctx.targets.push({ kind: "graveyardCreature", controller: "you", optional: true, distinct: true, label: `up to ${n} target creature cards from your graveyard` });
    out.push({ type: "reanimate", what: { t: "target", i: ctx.targets.length - 1 }, to: "hand" });
  }
  return out;
};

/** Fleeting Flight: a counter, flying, and no combat damage to the creature this turn. */
const fleeting: SentenceParser = (s, ctx) => {
  if (s !== "@@fleeting@@") return null;
  ctx.targets.push({ kind: "creature", label: "target creature" });
  const what = { t: "target" as const, i: ctx.targets.length - 1 };
  return [{ type: "addCounters", amount: 1, what }, { type: "grant", keyword: "flying", what }, { type: "preventCombatTo", what }];
};

/** "Put X +1/+1 counters on ~, where X is its power." (Heroes' Bane) / "Draw cards equal to its power." (Prime Speaker Zegana) */
const byOwnPower: SentenceParser = (s) => {
  if (/^put x \+1\/\+1 counters on ~, where x is its power$/.test(s)) return [{ type: "addCounters", amount: { count: { kind: "selfPower" } }, what: { t: "self" } }];
  if (s === "draw cards equal to its power") return [{ type: "draw", amount: { count: { kind: "selfPower" } }, who: { t: "you" } }];
  return null;
};

/** "Target opponent gains control of target permanent you control." (Harmless Offering) */
const harmlessOffering: SentenceParser = (s, ctx) => {
  if (s !== "target opponent gains control of target permanent you control") return null;
  ctx.targets.push({ kind: "permanent", controller: "you", label: "target permanent you control" });
  return [{ type: "giftControl", what: { t: "target", i: ctx.targets.length - 1 } }];
};

/** Primal Might: "Target creature you control gets +X/+X until end of turn. Then it fights up to one target creature you don't control." */
const primalMight: SentenceParser = (s, ctx) => {
  if (s === "target creature you control gets +x/+x until end of turn") {
    ctx.targets.push({ kind: "creature", controller: "you", label: "target creature you control" });
    return [{ type: "pump", power: 1, toughness: 1, what: { t: "target", i: ctx.targets.length - 1 }, per: { kind: "x" } }];
  }
  if (s === "it fights up to one target creature you don't control" && ctx.targets.length === 1) {
    ctx.targets.push({ kind: "creature", controller: "opponent", optional: true, label: "up to one target creature you don't control" });
    return [{ type: "fight", a: { t: "target", i: 0 }, b: { t: "target", i: 1 } }];
  }
  return null;
};

/** Exiling cards from graveyards: Scavenging Ooze, Ambush Wolf, Soul-Shackled Zombie, Immersturm Predator. */
const exileYards: SentenceParser = (s, ctx) => {
  const add = (optional: boolean, label: string) => {
    ctx.targets.push({ kind: "graveyardCard", ...(optional ? { optional: true } : {}), label });
    return { t: "target" as const, i: ctx.targets.length - 1 };
  };
  if (s === "@@exileyard ooze@@") {
    return [{ type: "exileFromYards", what: [add(false, "target card from a graveyard")], ifCreature: [{ type: "addCounters", amount: 1, what: { t: "self" } }, { type: "gainLife", amount: 1, who: { t: "you" } }] }];
  }
  if (s === "@@exileyard zombie@@") {
    return [{ type: "exileFromYards", what: [add(true, "up to two target cards from a graveyard"), add(true, "up to two target cards from a graveyard")], ifCreature: [{ type: "loseLife", amount: 2, who: { t: "opp" } }, { type: "gainLife", amount: 2, who: { t: "you" } }] }];
  }
  if (s === "@@exileyard immersturm@@") return [{ type: "exileFromYards", what: [add(true, "up to one target card from a graveyard")] }, { type: "addCounters", amount: 1, what: { t: "self" } }];
  if (s === "exile up to one target card from a graveyard") return [{ type: "exileFromYards", what: [add(true, "up to one target card from a graveyard")] }];
  return null;
};

/** Halana and Alena: counters equal to ~'s power on another creature, which gains haste. */
const halana: SentenceParser = (s, ctx) => {
  if (s !== "@@halana@@") return null;
  ctx.targets.push({ kind: "creature", controller: "you", other: true, label: "another target creature you control" });
  const what = { t: "target" as const, i: ctx.targets.length - 1 };
  return [{ type: "addCounters", amount: { count: { kind: "selfPower" } }, what }, { type: "grant", keyword: "haste", what }];
};

/** Mossborn Hydra: "double the number of +1/+1 counters on ~". */
const doubleCounters: SentenceParser = (s) => (s === "double the number of +1/+1 counters on ~" ? [{ type: "addCounters", amount: { count: { kind: "selfCounters" } }, what: { t: "self" } }] : null);

/** Small one-sentence effects. */
const smallOnes: SentenceParser = (s) => {
  if (s === "shuffle your graveyard into your library") return [{ type: "shuffleYard" }];
  if (s === "you lose the game") return [{ type: "loseGame" }];
  return null;
};

/** Divine Resilience: one creature, or (kicked) every creature of yours (any number of targets, all of them wanted). */
const divine: SentenceParser = (s, ctx) => {
  if (s !== "@@divine@@") return null;
  ctx.targets.push({ kind: "creature", controller: "you", label: "target creature you control" });
  return [{ type: "ifKicked", then: [{ type: "grant", keyword: "indestructible", what: { t: "allCreatures", scope: "yours" } }], otherwise: [{ type: "grant", keyword: "indestructible", what: { t: "target", i: ctx.targets.length - 1 } }] }];
};

/** Charming Prince, Kykar: a creature leaves for a moment and returns at the next end step. */
const blinkEnd: SentenceParser = (s, ctx) => {
  const m = /^@@blinkend (own|control) (your|its owner's)@@$/.exec(s);
  if (!m) return null;
  ctx.targets.push({ kind: "creature", controller: "you", other: true, label: `another target creature you ${m[1]}` });
  return [{ type: "blinkEndStep", what: { t: "target", i: ctx.targets.length - 1 }, ...(m[2] === "your" ? { underYou: true } : {}) }];
};

/** Dread Summons. */
const dread: SentenceParser = (s) => {
  const m = /^@@dread (x|\d+)@@$/.exec(s);
  return m ? [{ type: "dreadSummons", amount: m[1] === "x" ? "X" : Number(m[1]) }] : null;
};

/** Demolition Field: "That land's controller may search their library for a basic land card, put it onto the battlefield, then shuffle." */
const searchTheirsUntapped: SentenceParser = (s, ctx) => {
  const m = /^that land's controller may search their library for a basic land card, put (?:that card|it) onto the battlefield( tapped)?, then shuffle$/.exec(s);
  if (!m || ctx.targets.length === 0) return null;
  return [{ type: "search", tapped: m[1] !== undefined, who: { t: "controllerOf", i: ctx.targets.length - 1 } }];
};

/** Grow from the Ashes: "...search for a basic land card... If this spell was kicked, instead search for two basic land cards." */
const grow: SentenceParser = (s) =>
  s === "@@grow@@" ? [{ type: "ifKicked", then: [{ type: "search", tapped: false, count: 2 }], otherwise: [{ type: "search", tapped: false }] }] : null;

/** Circuitous Route: up to two basic lands and/or Gates. */
const circuitous: SentenceParser = (s) =>
  s === "search your library for up to two basic land cards and/or gate cards, put them onto the battlefield tapped, then shuffle"
    ? [{ type: "search", for: "any", to: "battlefield", tapped: true, count: 2, filters: [{ basic: true, types: ["land"] }, { subtypes: ["gate"] }], label: "basic land or Gate card" }]
    : null;

/** Maze's End. */
const mazesEnd: SentenceParser = (s) => {
  if (s === "search your library for a gate card, put it onto the battlefield, then shuffle") return [{ type: "search", for: "any", to: "battlefield", tapped: false, filters: [{ subtypes: ["gate"] }], label: "Gate card" }];
  if (s === "if you control ten or more gates with different names, you win the game") return [{ type: "winIfGates", n: 10 }];
  return null;
};

/** "Add {W}{W}{U}{U}..." (Ramos, Savage Ventmaw) */
const addColors: SentenceParser = (s) => {
  const m = /^add ((?:\{[WUBRG]\})+)$/.exec(s);
  return m ? [{ type: "addMana", mana: [...m[1].matchAll(/\{([WUBRG])\}/g)].map((x) => x[1] as "W") }] : null;
};

/** Chandra, Strongbox Raider, Gutless Plunderer, Kaito. */
const pickEffects: SentenceParser = (s) => {
  let m = /^@@exilechoose (\d)( next)?@@$/.exec(s);
  if (m) return [{ type: "exileChoosePlay", n: Number(m[1]), ...(m[2] ? { next: true } : {}) }];
  m = /^@@toporyard (\d)@@$/.exec(s);
  if (m) return [{ type: "topOrYard", n: Number(m[1]) }];
  if (s === "@@ninjaemblem@@") return [{ type: "ninjaEmblem" }];
  return null;
};

/** Chandra, Flameshaper -4. */
const chandraDivided: SentenceParser = (s, ctx) => {
  if (s !== "~ deals 8 damage divided as you choose among any number of target creatures and/or planeswalkers") return null;
  const refs: { t: "target"; i: number }[] = [];
  for (let n = 0; n < 4; n++) {
    ctx.targets.push({ kind: "permanent", types: ["creature", "planeswalker"], ...(n > 0 ? { optional: true } : {}), distinct: true, label: "target creature or planeswalker (up to four)" });
    refs.push({ t: "target", i: ctx.targets.length - 1 });
  }
  return [{ type: "damageDivided", amount: 8, to: refs }];
};

/** Uncharted Voyage. */
const voyage: SentenceParser = (s, ctx) => {
  if (s !== "target creature's owner puts it on their choice of the top or bottom of their library") return null;
  ctx.targets.push({ kind: "creature", label: "target creature" });
  return [{ type: "libraryChoice", what: { t: "target", i: ctx.targets.length - 1 } }];
};

export const FDN_SENTENCES: SentenceParser[] = [
  (s, ctx) => {
    if (s !== "@@harvest@@") return null;
    ctx.targets.push({ kind: "graveyardCreature", thisTurn: true, label: "target creature card from a graveyard that was put there this turn" });
    return [{ type: "harvest", what: { t: "target", i: ctx.targets.length - 1 } }];
  },
  (s) => (s === "@@curator@@" ? [{ type: "curator", n: 5 }] : null),
  (s, ctx) => {
    if (s !== "@@grantflashback@@") return null;
    ctx.targets.push({ kind: "graveyardSpell", controller: "you", label: "target instant or sorcery card in your graveyard" });
    return [{ type: "grantFlashback", what: { t: "target", i: ctx.targets.length - 1 } }];
  },
  (s, ctx) => {
    if (!/^until end of turn, target creature gets \+2\/\+0 and gains "when ~ dies, return it to the battlefield tapped under its owner's control and you create a treasure token\.?"$/.test(s)) return null;
    ctx.targets.push({ kind: "creature", label: "target creature" });
    const what = { t: "target" as const, i: ctx.targets.length - 1 };
    return [{ type: "pump", power: 2, toughness: 0, what }, { type: "returnOnDeath", what }];
  },
  (s) => (s === "exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs" ? [{ type: "etali" }] : null),
  (s, ctx) => {
    if (s !== "you may cast target zombie creature card from your graveyard this turn") return null;
    ctx.targets.push({ kind: "graveyardCreature", controller: "you", subtype: "zombie", label: "target Zombie creature card from your graveyard" });
    return [{ type: "yardCastTarget", what: { t: "target", i: ctx.targets.length - 1 } }];
  },
  (s0) => { const s = s0.replace(/^you may /, ""); return (s === "search your library for an artifact card, exile it, then shuffle" ? [{ type: "search", for: "any", to: "exile", filters: [{ types: ["artifact"] }], label: "artifact card" }] : s === "put the exiled card into its owner's hand" ? [{ type: "exiledWithToHand" }] : null); },
  (s) => (s.replace(/\.?"$/, "") === `create two 1/1 black rat creature tokens with "~ can't block` ? [{ type: "createToken", amount: 2, token: { name: "Rat", type: "creature", power: 1, toughness: 1, colors: ["B"], subtypes: "Rat", keywords: [], text: "This creature can't block." } }] : null),
  (s) => (s === "@@exiletopturn@@" ? [{ type: "exileTopTurn" }] : null),
  (s) => (s === "@@finale@@" ? [{ type: "finale", amount: "X" }] : s === "@@genesis@@" ? [{ type: "genesisWave", amount: "X" }] : s === "end the turn" ? [{ type: "endTurn" }] : null),
  (s) => (s === "@@copynext@@" ? [{ type: "copyNextSpell" }] : null),voyage, 
  (s) => (s === "each opponent chooses a permanent they control of each permanent type and sacrifices the rest" ? [{ type: "keepOnePerType" }] : null),chandraDivided, pickEffects, addColors, mazesEnd, searchTheirsUntapped, grow, circuitous, dread, blinkEnd, divine, smallOnes, doubleCounters, halana, exileYards, fleeting, byOwnPower, harmlessOffering, primalMight, drainLife, bounceNonland, riseAll, returnCreatures, thatMuch, mayCounter, namedCounters, discardHands, giftControl, lifeLossPerCounters, teamPumpAndGain, otherTeamPump, ashroot, doublePower, bounceAttackers, bounceOwnOther, mayFight, discardUnlessAttacked, raiseThePast, exactLifeBurn, drawPerMV, lifeGainedDrain];
