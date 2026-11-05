import { getCard } from "../../cards.js";
import { parseCard } from "../../oracle.js";
import { findPermanentOrNull, newId, nameOf } from "../permanents.js";
import { makeToken, putCounters, sacrificePermanent } from "../zones.js";
import { subjectsOf } from "../targets.js";
import { cardMatches } from "../permanents.js";
import { defSubtypes } from "../../creatureTypes.js";
import { drawCards } from "../zones.js";
import { isArtifactDef, isCreature, powerOf, subtypesOf, toughnessOf, yardCreatureCards } from "../permanents.js";
import type { EffectHandlers } from "./shared.js";

const COLOR_NAME: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

const MAY_COST_PROMPT = {
  artifactOrCard: "You may sacrifice an artifact or discard a card",
  artifactOrNonland: "You may sacrifice an artifact or discard a nonland card",
  otherCreature: "You may sacrifice another creature",
  otherCreatureOrArtifact: "You may sacrifice another creature or an artifact",
  threeOtherNonland: "You may sacrifice three other nonland permanents: choose the first (or stop, and sacrifice none)",
  vampire: "You may sacrifice a Vampire",
  land: "You may sacrifice a land",
} as const;

/** Effects of the Marvel Super Heroes set: keyword counters, Plan counters and the like. */
export const MARVEL_EFFECTS = {
  // "Until end of turn, double its power and toughness": it gets +P/+T where P and T are what they are now.
  // "You may sacrifice an artifact or discard a card. If you do, ...": the player picks the artifact or the card (or declines).
  mayCost({ state, ctx, startPick }, effect) {
    if (state.pendingPick) return;
    const me = state.players[ctx.controller];
    const artifacts = me.battlefield.filter((p) => isArtifactDef(getCard(state, p.card.defId))).map((p) => p.card.iid);
    const others = me.battlefield.filter((p) => p.card.iid !== ctx.sourceId && isCreature(state, p)).map((p) => p.card.iid);
    const cards = me.hand.filter((c) => effect.cost === "artifactOrCard" || getCard(state, c.defId).type !== "land").map((c) => c.iid);
    const otherNonland = me.battlefield.filter((p) => p.card.iid !== ctx.sourceId && getCard(state, p.card.defId).type !== "land").map((p) => p.card.iid);
    const vampires = me.battlefield.filter((p) => isCreature(state, p) && subtypesOf(state, p).includes("vampire")).map((p) => p.card.iid);
    const options =
      effect.cost === "land" ? me.battlefield.filter((p) => getCard(state, p.card.defId).type === "land").map((p) => p.card.iid)
      : effect.cost === "vampire" ? vampires
      : effect.cost === "otherCreature" ? others
      : effect.cost === "otherCreatureOrArtifact" ? [...new Set([...others, ...artifacts.filter((iid) => iid !== ctx.sourceId)])]
      : effect.cost === "threeOtherNonland" ? otherNonland
      : [...artifacts, ...cards];
    const count = effect.cost === "threeOtherNonland" ? 3 : 1;
    if (options.length < count) return;
    startPick({
      player: ctx.controller,
      prompt: MAY_COST_PROMPT[effect.cost],
      kind: "mayCost",
      options,
      optional: true,
      owner: ctx.controller,
      remaining: count,
      ordered: [],
      thenEffects: effect.then,
      thenCtx: ctx,
      ...(effect.thenSpecs ? { thenSpecs: effect.thenSpecs } : {}),
    });
  },
  // Alien Invasion: a 1/1 red Alien token with haste that must attack, with a +1/+1 counter for each invasion counter; then an invasion counter.
  invasion({ state, ctx, events, say }) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (!self) return;
    const counters = self.invasion ?? 0;
    makeToken(state, { name: "Alien", type: "creature", power: 1, toughness: 1, colors: ["R"], subtypes: "Alien", keywords: ["haste"], text: "This creature attacks each combat if able." }, ctx.controller, events);
    const token = state.players[ctx.controller].battlefield[state.players[ctx.controller].battlefield.length - 1];
    if (counters > 0) putCounters(state, token, ctx.controller, counters);
    self.invasion = counters + 1;
    say(`${ctx.sourceName}: an Alien enters with ${counters} +1/+1 counters; it now has ${self.invasion} invasion counters.`);
  },
  discardUnless({ state, ctx, startPick }, effect) {
    const hand = state.players[ctx.controller].hand;
    if (state.pendingPick || hand.length === 0) return;
    startPick({
      player: ctx.controller,
      prompt: `Discard two cards, unless you discard ${effect.cardType === "artifact" ? "an artifact" : "a creature"} card`,
      kind: "discard",
      options: hand.map((c) => c.iid),
      optional: false,
      owner: ctx.controller,
      remaining: Math.min(2, hand.length),
      ordered: [],
      enoughType: effect.cardType,
    });
  },
  transform({ state, ctx, say }) {
    const found = findPermanentOrNull(state, ctx.sourceId);
    if (!found) return;
    const perm = found.perm;
    if (perm.card.defId.endsWith("//back")) {
      const front = perm.card.printed;
      if (!front) return;
      perm.card = { iid: perm.card.iid, defId: front, owner: perm.card.owner };
    } else {
      const backId = `${perm.card.defId}//back`;
      if (!state.cards[backId]) return;
      perm.card = { ...perm.card, defId: backId, printed: perm.card.printed ?? perm.card.defId };
    }
    say(`${ctx.sourceName} transforms into ${nameOf(state, perm)}.`);
  },
  extraCombatIfAttacking({ state, ctx, say }) {
    const found = findPermanentOrNull(state, ctx.sourceId);
    if (!found || !state.combat?.attackers.some((a) => a.attacker === ctx.sourceId)) return;
    found.perm.tapped = false;
    state.extraCombats = (state.extraCombats ?? 0) + 1;
    say(`${ctx.sourceName} untaps, and there is an additional combat phase after this one.`);
  },
  becomeCreatureNow({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.crewed = true; // a creature until end of turn (it stops at the cleanup, like a crewed Vehicle)
      if (effect.subtypes) s.perm.tempSubtypes = effect.subtypes;
      if (effect.color) s.perm.tempColors = [effect.color];
      if (effect.nonartifact) s.perm.tempNonartifact = true;
      const words = [effect.color ? COLOR_NAME[effect.color] : "", ...(effect.subtypes ?? []).map((t) => t.charAt(0).toUpperCase() + t.slice(1)), effect.nonartifact ? "" : "artifact", "creature"].filter(Boolean);
      say(`${nameOf(state, s.perm)} is a ${words.join(" ")} until end of turn.`);
    }
  },
  powerFromHand({ state, ctx, say }) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (!self) return;
    self.powerFromHand = true;
    say(`${ctx.sourceName}'s base power is the number of cards in its controller's hand until end of turn.`);
  },
  ifYardCreatures({ state, ctx, nested }, effect) {
    nested(yardCreatureCards(state, ctx.controller) >= effect.n ? effect.then : (effect.otherwise ?? []));
  },
  doublePT({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const p = powerOf(state, s.perm);
      const t = toughnessOf(state, s.perm);
      s.perm.powerBonus = (s.perm.powerBonus ?? 0) + p;
      s.perm.toughnessBonus = (s.perm.toughnessBonus ?? 0) + t;
      say(`${nameOf(state, s.perm)}'s power and toughness are doubled until end of turn.`);
    }
  },
  costLess({ state, ctx, say }, effect) {
    const me = state.players[ctx.controller];
    me.costLessThisTurn = [...(me.costLessThisTurn ?? []), { n: effect.n, spell: effect.spell }];
    say(`${effect.spell === "artifact" ? "Artifact" : "Your"} spells cost {${effect.n}} less to cast this turn.`);
  },
  freeNext({ state, ctx, say }, effect) {
    state.players[ctx.controller].freeNext = { colors: effect.colors };
    say(`The next creature spell of that color ${ctx.controller === "p1" ? "Player 1 casts" : "Player 2 casts"} this turn costs nothing.`);
  },
  putFromHand({ state, ctx, events, say, startPick }, effect) {
    const me = state.players[ctx.controller];
    const options = me.hand.filter((c) => {
      const def = getCard(state, c.defId);
      if (effect.cardType === "artifact") return isArtifactDef(def);
      if (effect.cardType === "land") return def.type === "land";
      return def.type === "creature" && defSubtypes(def).includes(effect.subtype) && def.cost <= effect.maxMV;
    });
    if (options.length === 0 || state.pendingPick) {
      if (effect.elseDraw) drawCards(state, ctx.controller, 1, events);
      return;
    }
    void cardMatches;
    say(`${ctx.sourceName}: you may put a ${effect.subtype} from your hand onto the battlefield.`);
    startPick({
      player: ctx.controller,
      prompt: effect.cardType ? `You may put ${effect.cardType === "land" ? "a land" : "an artifact"} card from your hand onto the battlefield${effect.tapped ? " tapped" : ""}` : `You may put a ${effect.subtype} creature card${effect.maxMV < 99 ? ` with mana value ${effect.maxMV} or less` : ""} from your hand onto the battlefield${effect.elseDraw ? " (if you don't, draw a card)" : ""}`,
      kind: "handToField",
      ...(effect.tapped ? { entersTapped: true } : {}),
      ...(effect.attach ? { attachHolder: ctx.sourceId } : {}),
      options: options.map((c) => c.iid),
      optional: true,
      owner: ctx.controller,
      remaining: 1,
      ordered: [],
      ...(effect.elseDraw ? { elseDraw: true } : {}),
    });
  },
  addKeywordCounter({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.kwCounters = [...new Set([...(s.perm.kwCounters ?? []), effect.keyword])];
      say(`${nameOf(state, s.perm)} gets a ${effect.keyword} counter.`);
    }
  },
  // A plan counter. When the card's threshold is reached it is sacrificed, and "when you do" the rest of its text happens as a new ability.
  planCounter({ state, ctx, events, say }) {
    const found = findPermanentOrNull(state, ctx.sourceId);
    if (!found) return;
    const perm = found.perm;
    perm.planCounters = (perm.planCounters ?? 0) + 1;
    say(`${ctx.sourceName} gets a plan counter (${perm.planCounters}).`);
    const plan = parseCard(getCard(state, perm.card.defId)).plan;
    if (!plan || perm.planCounters !== plan.threshold) return;
    const controller = found.owner.id;
    sacrificePermanent(state, perm, controller, events);
    say(`${ctx.sourceName} is sacrificed.`);
    if (plan.effects.length === 0) return;
    state.triggerQueue.push({
      specs: plan.targets,
      item: { kind: "ability", id: newId(state), controller, source: perm.card.iid, sourceName: ctx.sourceName, effects: plan.effects, targets: [], specs: plan.targets, text: plan.text },
    });
  },
} satisfies EffectHandlers;
