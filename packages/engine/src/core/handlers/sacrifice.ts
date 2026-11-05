import { getCard } from "../../cards.js";
import type { CardDef } from "../../types.js";
import { hasKeyword } from "../../keywords.js";
import { floatingMana } from "../../mana.js";
import { parseCard } from "../../oracle.js";
import { cardMatches, findPermanentOrNull, newId, playerLabel } from "../permanents.js";
import { makeTokenCopy, removeFromBattlefield } from "../zones.js";
import { creatureEntered, queueTriggers, spellCast } from "../triggers.js";
import { subjectsOf } from "../targets.js";
import { plural, type EffectHandlers } from "./shared.js";

/** Effects that came with the Jund Sacrifice deck: revolt, Classes, learn, transforming Sagas, floating mana, paradigm. */
export const SACRIFICE_EFFECTS = {
  destroyIfMV({ state, ctx, nested }, effect) {
    // Revolt: "if a permanent left the battlefield under your control this turn", as the spell resolves.
    const revolt = effect.revoltMax !== undefined && (state.players[ctx.controller].leftThisTurn ?? 0) > 0;
    const most = revolt ? effect.revoltMax! : effect.max;
    const fits = subjectsOf(state, effect.what, ctx).some((s) => s.k === "perm" && getCard(state, s.perm.card.defId).cost <= most);
    if (fits) nested([{ type: "destroy", what: effect.what }]);
  },
  ifSacrificedToughness({ ctx, nested }, effect) {
    nested((ctx.sacToughness ?? 0) >= effect.atLeast ? effect.then : effect.otherwise);
  },
  levelUp({ state, ctx, say }, effect) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (!self) return;
    self.classLevel = effect.level;
    say(`${ctx.sourceName} reaches level ${effect.level}.`);
  },
  fromYard({ state, ctx, startPick }, effect) {
    const yard = state.players[ctx.controller].graveyard;
    const options = yard.filter((c) => cardMatches(getCard(state, c.defId), effect.filter)).map((c) => c.iid);
    if (options.length === 0 || state.pendingPick) return;
    const kinds = [...(effect.filter.types ?? [])].join(" or ") || "card";
    startPick({
      player: ctx.controller,
      prompt: `Choose a ${kinds} card in your graveyard to return to ${effect.to === "hand" ? "your hand" : `the battlefield${effect.finality ? " with a finality counter on it" : ""}`}`,
      kind: "fromYard",
      options,
      optional: false,
      owner: ctx.controller,
      remaining: 1,
      ordered: [],
      yardTo: effect.to,
      ...(effect.finality ? { finality: true } : {}),
    });
  },
  discardUpToDraw({ state, ctx, startPick }, effect) {
    const hand = state.players[ctx.controller].hand;
    if (hand.length === 0 || state.pendingPick) return;
    startPick({
      player: ctx.controller,
      prompt: `You may discard up to ${plural(effect.n, "card")}, then draw that many: choose one, or stop`,
      kind: "discardDraw",
      options: hand.map((c) => c.iid),
      optional: true,
      owner: ctx.controller,
      remaining: effect.n,
      ordered: [],
    });
  },
  exileReturnTransformed({ state, ctx, events, say }) {
    // "Exile this Saga, then return it to the battlefield transformed": a new permanent, its back face, under your control.
    const found = findPermanentOrNull(state, ctx.sourceId);
    if (!found) return;
    const card = removeFromBattlefield(state, found.perm, found.owner.id);
    if (!card) return;
    const backId = `${card.defId}//back`;
    if (!state.cards[backId]) {
      state.players[card.owner].exile.push(card);
      return;
    }
    const back = { iid: card.iid, defId: backId, owner: card.owner, printed: card.defId };
    state.players[ctx.controller].battlefield.push({ card: back, tapped: false, summoningSick: true, damage: 0, enteredTurn: state.turn });
    events.push({ type: "permanentEntered", player: ctx.controller, iid: back.iid });
    say(`${ctx.sourceName} is exiled and returns transformed: ${getCard(state, backId).name}.`);
    queueTriggers(state, back, ctx.controller, "enters");
    creatureEntered(state, back, ctx.controller);
  },
  copyTokenOf({ state, ctx, events, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const base = getCard(state, s.perm.card.defId);
      // "except it has haste": part of what the copy is, not a bonus that wears off
      const def: CardDef = effect.haste && !hasKeyword(base, "haste") ? { ...base, id: `${base.id}+haste`, keywords: [...(base.keywords ?? []), "haste"] } : base;
      const iid = makeTokenCopy(state, def, ctx.controller, events, false);
      const token = findPermanentOrNull(state, iid)?.perm;
      if (token && effect.sacAtEnd) token.sacAtEnd = true;
      say(`${ctx.sourceName}: a token copy of ${base.name} enters${effect.haste ? " with haste" : ""}${effect.sacAtEnd ? "; it is sacrificed at the beginning of the next end step" : ""}.`);
    }
  },
  learn({ state, ctx, startPick }) {
    const me = state.players[ctx.controller];
    const lessons = (me.sideboard ?? []).filter((c) => /\bLesson\b/.test(getCard(state, c.defId).typeLine ?? ""));
    const options = [...lessons, ...me.hand].map((c) => c.iid);
    if (options.length === 0 || state.pendingPick) return;
    startPick({
      player: ctx.controller,
      prompt: "Learn: choose a Lesson from outside the game to put into your hand, or a card in your hand to discard and draw a card (or neither)",
      kind: "learn",
      options,
      optional: true,
      owner: ctx.controller,
      remaining: 1,
      ordered: [],
    });
  },
  addMana({ state, ctx, say, startPick }, effect) {
    const me = state.players[ctx.controller];
    const live = new Set(floatingMana(state, ctx.controller).map((m) => m.at));
    me.pool = [...(me.pool ?? []).filter((_, at) => live.has(at)), ...effect.mana.map((color) => ({ color, turn: state.turn, phase: state.phase, ...(effect.combat ? { combat: true } : {}), ...(effect.allTurn ? { allTurn: true } : {}) }))];
    if (effect.mana.length > 0) say(`${playerLabel(ctx.controller)} adds ${effect.mana.map((c) => `{${c}}`).join("")}${effect.combat ? "; it lasts until end of combat" : ""}.`);
    if (!effect.anyColor || state.pendingPick) return;
    startPick({ player: ctx.controller, prompt: "Add one mana of any color: choose the color", kind: "color", options: ["W", "U", "B", "R", "G"], optional: false, owner: ctx.controller, remaining: effect.anyColor, ordered: [], poolColor: true });
  },
  deathLifeThisTurn({ state, ctx, say }) {
    const me = state.players[ctx.controller];
    me.deathLife = (me.deathLife ?? 0) + 1;
    say(`This turn, whenever a creature dies, ${playerLabel(ctx.controller)} gains 1 life.`);
  },
  castCopy({ state, ctx, events }, effect) {
    const def = getCard(state, effect.defId);
    const spell = parseCard(def).spell;
    if (!spell) return;
    const card = { iid: `copy${state.nextId++}`, defId: def.id, owner: ctx.controller };
    state.stack.push({ kind: "spell", id: newId(state), controller: ctx.controller, card, effects: spell.effects, targets: ctx.targets, specs: ctx.specs, x: 0, copy: true });
    events.push({ type: "spellCast", player: ctx.controller, iid: card.iid, tapped: [], targets: ctx.targets, copyOf: def.id });
    spellCast(state, ctx.controller, def, ctx.targets, 0, false);
  },
} satisfies EffectHandlers;
