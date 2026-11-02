import { getCard } from "../../cards.js";
import { parseManaCost, payMana } from "../../mana.js";
import { parseCard } from "../../oracle.js";
import { OPPONENT, type CardInstance, type GameState, type PlayerId } from "../../types.js";
import { defSubtypes, findPermanentOrNull, hasDelirium, isCreature, playerLabel, powerOf, subtypesOf } from "../permanents.js";
import { counterStackItem, spellLeavesStack } from "../zones.js";
import { subjectsOf } from "../targets.js";
import { cardAnywhere, type EffectHandlers, type EffectOf } from "./shared.js";
import { exileCopiesOf } from "./theme.js";

const creatureCount = (state: GameState, player: PlayerId) => state.players[player].battlefield.filter((p) => isCreature(state, p)).length;

/** The conditions an "if ..." checks as the spell resolves. A spell resolves in the phase it was cast in: the stack has to be empty for the game to move on. */
const NOW_CONDS: Record<EffectOf<"ifNow">["cond"], (state: GameState, me: PlayerId) => boolean> = {
  yourMainPhase: (state, me) => state.active === me && (state.phase === "main1" || state.phase === "main2"),
  landEntered: (state, me) => (state.players[me].landsEnteredThisTurn ?? 0) > 0,
  delirium: hasDelirium,
  instantAndSorcery: (state, me) => ["instant", "sorcery"].every((type) => state.players[me].graveyard.some((c) => getCard(state, c.defId).type === type)),
  ferocious: (state, me) => state.players[me].battlefield.some((p) => isCreature(state, p) && powerOf(state, p) >= 4),
  lessLife: (state, me) => state.players[me].life < state.players[OPPONENT[me]].life,
  fewerCreatures: (state, me) => creatureCount(state, me) < creatureCount(state, OPPONENT[me]),
};

/** Countering, optional payments, and effects that depend on how the spell was cast. */
export const STACK_EFFECTS = {
  counterUnlessPay({ state, ctx, events, say, startPick }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "stack") continue;
      const item = s.item;
      const cost = parseManaCost(effect.cost);
      if (!cost || state.pendingPick) continue;
      const name = item.kind === "spell" ? getCard(state, item.card.defId).name : item.sourceName;
      if (!payMana(state, item.controller, cost).ok) {
        say(`${playerLabel(item.controller)} can't pay ${effect.cost}: ${name} is countered.`);
        counterStackItem(state, item, events, ctx.sourceName);
        continue;
      }
      startPick({
        player: item.controller,
        prompt: `${ctx.sourceName}: pay ${effect.cost}, or ${name} is countered`,
        kind: "ward",
        options: ["pay"],
        optional: true,
        owner: item.controller,
        remaining: 1,
        ordered: [],
        wardItem: item.id,
        wardCost: effect.cost,
      });
    }
  },
  mayPay({ state, ctx, startPick }, effect) {
    // "You may pay {1}. If you do, ...": nothing to ask when the cost can't be paid.
    const cost = parseManaCost(effect.cost);
    if (!cost || state.pendingPick || !payMana(state, ctx.controller, cost).ok || (effect.life ?? 0) > state.players[ctx.controller].life) return;
    startPick({
      player: ctx.controller,
      prompt: effect.prompt ?? `${ctx.sourceName}: pay ${[effect.cost, effect.life ? `${effect.life} life` : ""].filter(Boolean).join(" and ")}?`,
      kind: "mayPay",
      options: ["pay"],
      optional: true,
      owner: ctx.controller,
      remaining: 1,
      ordered: [],
      wardCost: effect.cost,
      ...(effect.life ? { payLife: effect.life } : {}),
      thenEffects: effect.then,
      thenCtx: ctx,
      ...(effect.thenSpecs ? { thenSpecs: effect.thenSpecs } : {}),
      ...(effect.thenText ? { thenText: effect.thenText } : {}),
    });
  },
  mayDiscard({ state, ctx, startPick }, effect) {
    // "You may discard a card. When you do, ...": nothing to ask with an empty hand.
    const hand = state.players[ctx.controller].hand;
    if (state.pendingPick || hand.length === 0) return;
    startPick({
      player: ctx.controller,
      prompt: `${ctx.sourceName}: you may discard a card`,
      kind: "discard",
      options: hand.map((c) => c.iid),
      optional: true,
      owner: ctx.controller,
      remaining: 1,
      ordered: [],
      thenEffects: effect.then,
      thenCtx: ctx,
      ...(effect.thenSpecs ? { thenSpecs: effect.thenSpecs } : {}),
    });
  },
  wardCheck({ state, ctx, events, say, startPick }, effect) {
    const item = state.stack.find((i) => i.id === effect.itemId);
    const cost = parseManaCost(effect.cost);
    if (!item || !cost) return;
    const name = item.kind === "spell" ? getCard(state, item.card.defId).name : item.sourceName;
    const price = [effect.cost, effect.life ? `${effect.life} life` : ""].filter(Boolean).join(" and ");
    // Life can be paid only by a player who has at least that much (rule 119.4).
    if (!payMana(state, item.controller, cost).ok || (effect.life ?? 0) > state.players[item.controller].life) {
      say(`${playerLabel(item.controller)} can't pay ${price}: ${name} is countered.`);
      counterStackItem(state, item, events, `ward (${ctx.sourceName})`);
      return;
    }
    startPick({
      player: item.controller,
      prompt: `Ward—pay ${price}, or ${name} is countered`,
      kind: "ward",
      options: ["pay"],
      optional: true,
      owner: item.controller,
      remaining: 1,
      ordered: [],
      wardItem: item.id,
      wardCost: effect.cost,
      ...(effect.life ? { payLife: effect.life } : {}),
    });
  },
  ifKicked({ ctx, nested }, effect) {
    nested(ctx.kicked ? effect.then : (effect.otherwise ?? []));
  },
  ifNow({ state, ctx, nested }, effect) {
    nested(NOW_CONDS[effect.cond](state, ctx.controller) ? effect.then : (effect.otherwise ?? []));
  },
  ifManaSpent({ ctx, nested }, effect) {
    if ((ctx.x ?? 0) >= effect.n) nested(effect.then);
  },
  emblem({ state, ctx, say }, effect) {
    const me = state.players[ctx.controller];
    me.emblems = [...(me.emblems ?? []), { text: effect.text, static: effect.static }];
    say(`${playerLabel(ctx.controller)} gets an emblem: ${effect.text}`);
  },
  stormEmblem({ state, ctx, say }) {
    state.players[ctx.controller].stormEmblem = true;
    say(`${playerLabel(ctx.controller)} gets an emblem: instant and sorcery spells they cast have storm.`);
  },
  ifControlledTarget({ ctx, nested }, effect) {
    // Who controlled it as the spell began to resolve: a bounced permanent has no controller any more.
    const t = ctx.targets[effect.i];
    if (t?.kind === "permanent" && ctx.lki?.[t.iid] === ctx.controller) nested(effect.then);
  },
  ifLifeGained({ state, ctx, nested }, effect) {
    if ((state.players[ctx.controller].lifeGainedThisTurn ?? 0) >= effect.atLeast) nested(effect.then);
  },
  ifSelfPower({ state, ctx, nested }, effect) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (self && powerOf(state, self) === effect.n) nested(effect.then);
  },
  ifControlOther({ state, ctx, nested }, effect) {
    const mine = state.players[ctx.controller].battlefield;
    if (mine.some((p) => p.card.iid !== ctx.sourceId && defSubtypes(getCard(state, p.card.defId)).includes(effect.subtype))) nested(effect.then);
  },
  ifSubtype({ state, ctx, nested }, effect) {
    // "If it's a Zombie card, ...": the card is looked at wherever the spell put it.
    const t = effect.what.t === "target" ? ctx.targets[effect.what.i] : undefined;
    const iid = t?.kind === "card" || t?.kind === "permanent" ? t.iid : undefined;
    const onField = iid ? findPermanentOrNull(state, iid)?.perm : undefined;
    const card = iid ? cardAnywhere(state, iid) : undefined;
    const types = onField ? subtypesOf(state, onField) : card ? defSubtypes(getCard(state, card.defId)) : [];
    if (types.includes(effect.subtype)) nested(effect.then);
  },
  counter({ state, ctx, events, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "stack") continue;
      const shielded = s.item.kind === "spell" && state.players[s.item.controller].battlefield.some((p) => {
        const min = parseCard(getCard(state, p.card.defId)).uncounterableMinMV;
        return min !== undefined && getCard(state, (s.item as { card: CardInstance }).card.defId).cost >= min;
      });
      if (s.item.kind === "spell" && (shielded || parseCard(getCard(state, s.item.card.defId)).cantBeCountered)) {
        say(`${getCard(state, s.item.card.defId).name} can't be countered.`);
        if (effect.exileCopies) exileCopiesOf(state, s.item.controller, getCard(state, s.item.card.defId).name, events, say);
        continue;
      }
      const named = s.item.kind === "spell" ? { controller: s.item.controller, name: getCard(state, s.item.card.defId).name } : null;
      counterStackItem(state, s.item, events, ctx.sourceName);
      if (effect.exileCopies && named) exileCopiesOf(state, named.controller, named.name, events, say); // Counterbore
    }
  },
} satisfies EffectHandlers;
