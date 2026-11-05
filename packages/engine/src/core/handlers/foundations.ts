import { getCard } from "../../cards.js";
import type { CardInstance, Permanent, PlayerId } from "../../types.js";
import { CREATURE_TYPES } from "../../creatureTypes.js";
import { OPPONENT } from "../../types.js";
import { findPermanentOrNull, isCreature, isPlaneswalker, nameOf, playerLabel, subtypesOf, toughnessOf } from "../permanents.js";
import { dealDamage } from "./shared.js";
import { changeLife, drawCards, isToken, makeToken, putCounters, removeFromBattlefield, sacrificePermanent } from "../zones.js";
import { keywordsSupported, type Keyword } from "../../keywords.js";
import { cardsDiscarded } from "../triggers.js";
import { subjectsOf } from "../targets.js";
import { shuffle } from "../../state.js";
import { payMana } from "../../mana.js";
import { enterBattlefield } from "../../stack/resolve.js";
import type { EffectHandlers } from "./shared.js";

/** Effects that came with Foundations (the cards of that set that had no place in the older decks). */
export const FDN_EFFECTS = {
  /** "Each opponent discards their hand" / "Each player discards their hand, then draws seven cards." */
  discardHands({ state, ctx, events, say }, effect) {
    const players = subjectsOf(state, effect.who, ctx).flatMap((s): PlayerId[] => (s.k === "player" ? [s.id] : []));
    for (const id of players) {
      const hand = state.players[id].hand;
      const iids = hand.map((c) => c.iid);
      state.players[id].graveyard.push(...hand.splice(0));
      cardsDiscarded(state, id, iids, events);
      say(`${playerLabel(id)} discards their hand.`);
    }
    if (effect.thenDraw) for (const id of players) drawCards(state, id, effect.thenDraw, events);
  },
  /** "An opponent gains control of ~." */
  giftControl({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const to = OPPONENT[s.owner];
      const from = state.players[s.owner].battlefield;
      from.splice(from.indexOf(s.perm), 1);
      s.perm.summoningSick = true;
      state.players[to].battlefield.push(s.perm);
      say(`${playerLabel(to)} gains control of ${getCard(state, s.perm.card.defId).name}.`);
      void nameOf;
    }
  },
  /** "Return all creature cards with mana value 2 or less from your graveyard to the battlefield." */
  reanimateAll({ state, ctx, events, say }, effect) {
    const yards = effect.fromAll ? Object.values(state.players).map((p) => p.graveyard) : [state.players[ctx.controller].graveyard];
    const found = yards.flatMap((yard) => yard.filter((c) => getCard(state, c.defId).type === "creature" && getCard(state, c.defId).cost <= effect.maxMV).map((card) => ({ yard, card })));
    for (const { yard, card } of found) {
      yard.splice(yard.indexOf(card), 1);
      enterBattlefield(state, card, ctx.controller, events);
      say(`${getCard(state, card.defId).name} returns to the battlefield.`);
    }
  },
  /** "If target player has exactly 10 life, ~ deals 10 damage to that player." */
  damageIfLife({ state, ctx, say, nested }, effect) {
    for (const s of subjectsOf(state, effect.who, ctx)) {
      if (s.k !== "player") continue;
      if (state.players[s.id].life !== effect.life) {
        say(`${playerLabel(s.id)} does not have exactly ${effect.life} life.`);
        continue;
      }
      nested([{ type: "damage", amount: effect.amount, to: effect.who }]);
    }
  },
  /** "Exile target card from a graveyard." (up to the cards chosen; `ifCreature` runs when at least one was a creature card) */
  exileFromYards({ state, ctx, say, nested }, effect) {
    let creature = false;
    for (const ref of effect.what) {
      for (const s of subjectsOf(state, ref, ctx)) {
        if (s.k !== "card") continue;
        const yard = state.players[s.owner].graveyard;
        const at = yard.indexOf(s.card);
        if (at < 0) continue;
        yard.splice(at, 1);
        state.players[s.owner].exile.push(s.card);
        const def = getCard(state, s.card.defId);
        if (def.type === "creature") creature = true;
        say(`${def.name} is exiled from ${playerLabel(s.owner)}'s graveyard.`);
      }
    }
    if (creature && effect.ifCreature) nested(effect.ifCreature);
  },
  /** "Exile another target creature you own. Return it to the battlefield under your control at the beginning of the next end step." */
  blinkEndStep({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      const card = removeFromBattlefield(state, s.perm, s.owner);
      if (!card) continue;
      state.players[card.owner].exile.push(card);
      (state.delayedReturns ??= []).push({ iid: card.iid, controller: effect.underYou ? ctx.controller : card.owner });
      say(`${getCard(state, card.defId).name} is exiled until the next end step.`);
    }
  },
  returnDelayed({ state, events, say }, effect) {
    for (const owner of Object.values(state.players)) {
      const at = owner.exile.findIndex((c) => c.iid === effect.iid);
      if (at < 0) continue;
      const [card] = owner.exile.splice(at, 1);
      enterBattlefield(state, card, effect.controller, events);
      if (effect.named) {
        const back = state.players[effect.controller].battlefield.find((p) => p.card.iid === card.iid);
        if (back) back.named = { ...effect.named };
      }
      say(`${getCard(state, card.defId).name} returns to the battlefield.`);
    }
  },
  /** Dread Summons. */
  dreadSummons({ state, ctx, events, say, value, nested }, effect) {
    const n = Math.max(0, value(effect.amount));
    let creatures = 0;
    for (const p of Object.values(state.players)) {
      const milled = p.library.splice(0, n);
      p.graveyard.push(...milled);
      creatures += milled.filter((c) => getCard(state, c.defId).type === "creature").length;
      if (milled.length) events.push({ type: "effect", text: `${playerLabel(p.id)} mills ${milled.length} card${milled.length === 1 ? "" : "s"}.` });
    }
    say(`${creatures} creature card${creatures === 1 ? "" : "s"} milled.`);
    if (creatures > 0) nested([{ type: "createToken", amount: creatures, token: { name: "Zombie", type: "creature", power: 2, toughness: 2, colors: ["B"], subtypes: "Zombie", keywords: [], text: "", tapped: true } }]);
  },
  /** Nine-Lives Familiar: back at the beginning of the next end step with one fewer revival counter. */
  reviveLater({ state, ctx, say }, effect) {
    const had = ctx.died?.named?.[effect.name] ?? 0;
    for (const owner of Object.values(state.players)) {
      const at = owner.graveyard.findIndex((c) => c.iid === ctx.sourceId);
      if (at < 0) continue;
      const [card] = owner.graveyard.splice(at, 1);
      owner.exile.push(card);
      (state.delayedReturns ??= []).push({ iid: card.iid, controller: owner.id, named: { [effect.name]: Math.max(0, had - 1) } });
      say(`${getCard(state, card.defId).name} will return at the beginning of the next end step.`);
    }
  },
  /** Maze's End. */
  winIfGates({ state, ctx, events }, effect) {
    const names = new Set(state.players[ctx.controller].battlefield.filter((p) => (getCard(state, p.card.defId).typeLine ?? "").includes("Gate")).map((p) => getCard(state, p.card.defId).name));
    if (names.size >= effect.n) {
      state.winner = ctx.controller;
      events.push({ type: "gameWon", player: ctx.controller });
    }
  },
  /** Venom Connoisseur. */
  venom({ state, ctx, nested }) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (!self) return;
    self.venomCount = (self.venomCount ?? 0) + 1;
    nested([{ type: "grant", keyword: "deathtouch", what: { t: "self" } }]);
    if (self.venomCount === 2) nested([{ type: "grant", keyword: "deathtouch", what: { t: "allCreatures", scope: "yours" } }]);
  },
  /** The opponent chooses: lose life, or pay with a card or a permanent. */
  loseUnless({ state, ctx, events, startPick }, effect) {
    if (state.pendingPick) return;
    const foe = state.players[OPPONENT[ctx.controller]];
    const options = [...(effect.discard ? foe.hand.map((c) => c.iid) : []), ...(effect.sacrifice ? foe.battlefield.filter((p) => getCard(state, p.card.defId).type !== "land").map((p) => p.card.iid) : [])];
    if (options.length === 0) {
      changeLife(state, foe.id, -effect.amount, events);
      return;
    }
    const what = effect.sacrifice && effect.discard ? "sacrifice a nonland permanent or discard a card" : "discard a card";
    startPick({ player: foe.id, prompt: `Lose ${effect.amount} life unless you ${what}: choose a card to pay with (or decline and lose the life)`, kind: "ransom", options, optional: true, owner: foe.id, remaining: 1, ordered: [], lose: effect.amount });
  },
  /** Chandra: exile the top cards, choose one to play (the others return to the bottom of the library). */
  exileChoosePlay({ state, ctx, startPick }, effect) {
    if (state.pendingPick) return;
    const top = state.players[ctx.controller].library.slice(0, effect.n);
    if (top.length === 0) return;
    startPick({ player: ctx.controller, prompt: `Choose a card to exile: you may play it ${effect.next ? "through your next turn" : "this turn"}. The others go to the bottom of your library.`, kind: "playExile", options: top.map((c) => c.iid), optional: false, owner: ctx.controller, remaining: 1, ordered: [], ...(effect.next ? { playNext: true } : {}) });
  },
  /** Gutless Plunderer: look at the top cards; one may stay on top, the rest go to the graveyard. */
  topOrYard({ state, ctx, startPick }, effect) {
    if (state.pendingPick) return;
    const top = state.players[ctx.controller].library.slice(0, effect.n);
    if (top.length === 0) return;
    startPick({ player: ctx.controller, prompt: "You may keep one card on top of your library; the rest go to your graveyard", kind: "keepTop", options: top.map((c) => c.iid), optional: true, owner: ctx.controller, remaining: 1, ordered: [], restToGraveyard: true });
  },
  /** Kaito's emblem. */
  ninjaEmblem({ state, ctx, say }) {
    state.players[ctx.controller].ninjaEmblem = true;
    say(`${playerLabel(ctx.controller)} gets an emblem: whenever a player casts a spell, they create a 2/1 Ninja.`);
  },
  /** "~ deals 8 damage divided as you choose among any number of target creatures and/or planeswalkers" (lethal damage to each in the order chosen; what is left goes to the last). */
  damageDivided({ state, ctx, events, trait }, effect) {
    const targets = effect.to.flatMap((ref) => subjectsOf(state, ref, ctx)).filter((s): s is Extract<ReturnType<typeof subjectsOf>[number], { k: "perm" }> => s.k === "perm");
    let left = effect.amount;
    targets.forEach((s, i) => {
      if (left <= 0) return;
      const lethal = isPlaneswalker(state, s.perm) ? Math.max(1, s.perm.loyalty ?? 1) : Math.max(1, toughnessOf(state, s.perm) - s.perm.damage);
      const give = i === targets.length - 1 ? left : Math.min(left, lethal);
      left -= give;
      dealDamage(state, trait, s, give, events);
    });
  },
  /** Liliana, Dreadhorde General -9 (the opponent's choices are made for them: the most expensive permanent of each type stays). */
  keepOnePerType({ state, ctx, events, say }) {
    const foe = state.players[OPPONENT[ctx.controller]];
    const hasType = (p: Permanent, type: string) => (getCard(state, p.card.defId).typeLine ?? getCard(state, p.card.defId).type).split("—")[0].toLowerCase().includes(type);
    const keep = new Set<Permanent>();
    for (const type of ["artifact", "creature", "enchantment", "land", "planeswalker", "battle"]) {
      const of = foe.battlefield.filter((p) => hasType(p, type));
      if (of.length === 0 || of.some((p) => keep.has(p))) continue;
      keep.add(of.reduce((best, p) => (getCard(state, p.card.defId).cost > getCard(state, best.card.defId).cost ? p : best)));
    }
    const doomed = foe.battlefield.filter((p) => !keep.has(p));
    say(`${playerLabel(foe.id)} keeps ${keep.size} permanents and sacrifices ${doomed.length}.`);
    for (const p of doomed) sacrificePermanent(state, p, foe.id, events);
  },
  /** Soulstone Sanctuary: "~ becomes a 3/3 creature with vigilance and all creature types. It's still a land." */
  becomeCreatureForever({ state, ctx, say }, effect) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (!self) return;
    self.animated = true;
    self.baseOverride = { power: effect.power, toughness: effect.toughness };
    self.kwCounters = [...new Set([...(self.kwCounters ?? []), ...effect.keywords])];
    if (effect.allTypes) self.addedSubtypes = [...new Set([...(self.addedSubtypes ?? []), ...CREATURE_TYPES])];
    say(`${nameOf(state, self)} becomes a ${effect.power}/${effect.toughness} creature.`);
  },
  /** Valkyrie's Call: "return that card to the battlefield under its owner's control with a +1/+1 counter on it. It has flying and is an Angel." */
  returnDiedWith({ state, ctx, events, say }, effect) {
    for (const owner of Object.values(state.players)) {
      const at = owner.graveyard.findIndex((c) => c.iid === ctx.other);
      if (at < 0) continue;
      const [card] = owner.graveyard.splice(at, 1);
      enterBattlefield(state, card, owner.id, events);
      const back = owner.battlefield.find((p) => p.card.iid === card.iid);
      if (back) {
        back.addedSubtypes = [...(back.addedSubtypes ?? []), effect.subtype];
        back.kwCounters = [...(back.kwCounters ?? []), effect.keyword];
        putCounters(state, back, owner.id, effect.counters);
      }
      say(`${getCard(state, card.defId).name} returns to the battlefield.`);
    }
  },
  /** Spinner of Souls: reveal until a creature card; it goes to the hand and the rest to the bottom in a random order. */
  revealUntilCreature({ state, ctx, events, say }) {
    const me = state.players[ctx.controller];
    let revealed: CardInstance[] = [];
    let found: CardInstance | null = null;
    while (me.library.length > 0) {
      const card = me.library.shift()!;
      if (getCard(state, card.defId).type === "creature") {
        found = card;
        break;
      }
      revealed.push(card);
    }
    if (found) {
      me.hand.push(found);
      say(`${playerLabel(ctx.controller)} reveals ${revealed.length + 1} cards and puts ${getCard(state, found.defId).name} into their hand.`);
    }
    if (revealed.length > 1) [revealed, state.rng] = shuffle(revealed, state.rng);
    me.library.push(...revealed);
    void events;
  },
  copyNextSpell({ state, ctx, say }) {
    state.players[ctx.controller].copyNextSpell = true;
    say(`${playerLabel(ctx.controller)}'s next instant or sorcery spell this turn will be copied.`);
  },
  extraCombat({ state, say }) {
    state.extraCombats = (state.extraCombats ?? 0) + 1;
    say("There is an additional combat phase after this one.");
  },
  /** Genesis Wave: every permanent card with mana value X or less enters (choosing them all is never worse); the rest go to the graveyard. */
  genesisWave({ state, ctx, events, say, value }, effect) {
    const x = Math.max(0, value(effect.amount));
    const me = state.players[ctx.controller];
    const revealed = me.library.splice(0, x);
    say(`${playerLabel(ctx.controller)} reveals ${revealed.length} card${revealed.length === 1 ? "" : "s"}.`);
    for (const card of revealed) {
      const def = getCard(state, card.defId);
      if (def.type !== "instant" && def.type !== "sorcery" && def.cost <= x) enterBattlefield(state, card, ctx.controller, events);
      else me.graveyard.push(card);
    }
  },
  /** Finale of Revelation. */
  finale({ state, ctx, events, say, value }, effect) {
    const x = Math.max(0, value(effect.amount));
    const me = state.players[ctx.controller];
    if (x >= 10) {
      me.library.push(...me.graveyard.splice(0));
      [me.library, state.rng] = shuffle(me.library, state.rng);
      drawCards(state, ctx.controller, x, events);
      let untapped = 0;
      for (const p of me.battlefield) if (untapped < 5 && p.tapped && getCard(state, p.card.defId).type === "land") ((p.tapped = false), untapped++);
      me.noHandLimit = true;
      say(`${playerLabel(ctx.controller)} shuffles their graveyard into their library, draws ${x} cards, untaps ${untapped} lands and has no maximum hand size.`);
    } else drawCards(state, ctx.controller, x, events);
  },
  /** Time Stop: everything on the stack is exiled and the turn goes to its cleanup step. */
  endTurn({ state, ctx, events, say }) {
    for (const item of [...state.stack]) {
      if (item.kind === "spell" && item.id !== ctx.stackId && !item.copy) state.players[item.card.owner].exile.push(item.card);
    }
    state.stack = state.stack.filter((i) => i.id === ctx.stackId);
    state.triggerQueue = [];
    state.combat = null;
    state.extraCombats = undefined;
    state.extraStep = undefined;
    state.extraResume = undefined;
    state.phase = "end";
    events.push({ type: "phaseChanged", phase: "end" });
    say("The turn ends.");
  },
  /** Desecration Demon: any opponent may sacrifice a creature; if they do, the Demon taps and grows. */
  demonTax({ state, ctx, startPick }) {
    if (state.pendingPick) return;
    const foe = state.players[OPPONENT[ctx.controller]];
    const options = foe.battlefield.filter((p) => isCreature(state, p)).map((p) => p.card.iid);
    if (options.length === 0) return;
    startPick({ player: foe.id, prompt: "You may sacrifice a creature: Desecration Demon taps and gets a +1/+1 counter", kind: "ransom", options, optional: true, owner: foe.id, remaining: 1, ordered: [], lose: 0, thenEffects: [{ type: "tap", what: { t: "self" } }, { type: "addCounters", amount: 1, what: { t: "self" } }], thenCtx: ctx });
  },
  /** Exile the top card of your library: you may play it this turn. */
  exileTopTurn({ state, ctx, say }) {
    const me = state.players[ctx.controller];
    const card = me.library.shift();
    if (!card) return;
    me.exile.push(card);
    me.mayPlay = [...(me.mayPlay ?? []), { iid: card.iid, source: "thisTurn", throughTurn: state.turn }];
    say(`${playerLabel(ctx.controller)} exiles ${getCard(state, card.defId).name}; they may play it this turn.`);
  },
  exiledWithToHand({ state, ctx, say }) {
    for (const owner of Object.values(state.players)) {
      for (const card of owner.exile.filter((c) => c.exiledBy === ctx.sourceId)) {
        owner.exile.splice(owner.exile.indexOf(card), 1);
        state.players[card.owner].hand.push({ iid: card.iid, defId: card.defId, owner: card.owner });
        say(`${getCard(state, card.defId).name} goes to its owner's hand.`);
      }
    }
  },
  sacIfHostCounters({ state, ctx, events, nested }, effect) {
    const aura = findPermanentOrNull(state, ctx.sourceId);
    const host = aura?.perm.attachedTo ? findPermanentOrNull(state, aura.perm.attachedTo) : null;
    if (!aura || !host || (host.perm.counters ?? 0) < effect.n) return;
    sacrificePermanent(state, aura.perm, aura.owner.id, events);
    nested(effect.then);
  },
  yardCastTarget({ state, ctx, say }, effect) {
    const me = state.players[ctx.controller];
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "card") continue;
      me.yardCastable = [...new Set([...(me.yardCastable ?? []), s.card.iid])];
      say(`${getCard(state, s.card.defId).name} can be cast from the graveyard this turn.`);
    }
  },
  doubleCountersOn({ state, ctx, say }, effect) {
    for (const ref of effect.what) {
      for (const s of subjectsOf(state, ref, ctx)) {
        if (s.k !== "perm") continue;
        const p = s.perm;
        if ((p.counters ?? 0) > 0) putCounters(state, p, s.owner, p.counters!);
        if ((p.minusCounters ?? 0) > 0) p.minusCounters = p.minusCounters! * 2;
        if ((p.loyalty ?? 0) > 0 && isPlaneswalker(state, p)) p.loyalty = p.loyalty! * 2;
        if (p.named) p.named = Object.fromEntries(Object.entries(p.named).map(([k, v]) => [k, v * 2]));
        say(`The counters on ${nameOf(state, p)} are doubled.`);
      }
    }
  },
  kellan({ state, ctx, say }, effect) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (!self) return;
    const stage = self.named?.stage ?? 0;
    if (effect.step === 1 && stage === 0 && subtypesOf(state, self).includes("scout")) {
      self.named = { ...self.named, stage: 1 };
      self.subtypesOverride = ["human", "faerie", "detective"];
      say(`${nameOf(state, self)} becomes a Human Faerie Detective.`);
    } else if (effect.step === 2 && stage === 1) {
      self.named = { ...self.named, stage: 2 };
      self.subtypesOverride = ["human", "faerie", "rogue"];
      self.baseOverride = { power: 3, toughness: 2 };
      say(`${nameOf(state, self)} becomes a 3/2 Human Faerie Rogue with double strike.`);
    }
  },
  digCreature({ state, ctx, events, say }, effect) {
    const me = state.players[ctx.controller];
    const lands = me.battlefield.filter((p) => getCard(state, p.card.defId).type === "land").length;
    const top = me.library.splice(0, effect.n);
    const fits = top.filter((c) => getCard(state, c.defId).type === "creature" && getCard(state, c.defId).cost <= lands);
    const best = fits.reduce<CardInstance | null>((b, c) => (!b || getCard(state, c.defId).cost > getCard(state, b.defId).cost ? c : b), null);
    let rest = top.filter((c) => c !== best);
    if (rest.length > 1) [rest, state.rng] = shuffle(rest, state.rng);
    me.library.push(...rest);
    if (best) {
      enterBattlefield(state, best, ctx.controller, events);
      say(`${getCard(state, best.defId).name} enters the battlefield.`);
    }
  },
  etali({ state, ctx, say }) {
    const me = state.players[ctx.controller];
    for (const p of Object.values(state.players)) {
      const card = p.library.shift();
      if (!card) continue;
      me.exile.push(card);
      const def = getCard(state, card.defId);
      if (def.type !== "land") me.mayPlay = [...(me.mayPlay ?? []), { iid: card.iid, source: "etali", throughTurn: state.turn, payGeneric: 0 }];
      say(`${def.name} is exiled from ${playerLabel(p.id)}'s library${def.type === "land" ? "" : "; it can be cast without paying its mana cost"}.`);
    }
  },
  returnOnDeath({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.returnOnDeath = ctx.controller;
      say(`${nameOf(state, s.perm)} will return if it dies this turn.`);
    }
  },
  grantFlashback({ state, ctx, say }, effect) {
    const me = state.players[ctx.controller];
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "card") continue;
      me.grantedFlashback = [...new Set([...(me.grantedFlashback ?? []), s.card.iid])];
      say(`${getCard(state, s.card.defId).name} has flashback until end of turn.`);
    }
  },
  curator({ state, ctx, startPick }, effect) {
    if (state.pendingPick) return;
    const top = state.players[ctx.controller].library.slice(0, effect.n);
    if (top.length === 0) return;
    startPick({ player: ctx.controller, prompt: "Pile split: pick the cards for the face-up pile (the rest are face down); decline when done.", kind: "pileSplit", options: top.map((c) => c.iid), optional: true, owner: ctx.controller, remaining: 1, ordered: [] });
  },
  payXCounters({ state, ctx, startPick }) {
    if (state.pendingPick) return;
    const options: string[] = [];
    for (let x = 1; x <= 12 && payMana(state, ctx.controller, { generic: x, colored: {} }).ok; x++) options.push(String(x));
    if (options.length === 0) return;
    startPick({ player: ctx.controller, prompt: `${ctx.sourceName}: you may pay {X} to put X +1/+1 counters on it. Choose X (or decline)`, kind: "payX", options, optional: true, owner: ctx.controller, remaining: 1, ordered: [], thenEffects: [{ type: "addCounters", amount: "X", what: { t: "self" } }], thenCtx: ctx });
  },
  baitFish({ state, ctx, say, nested }) {
    const self = findPermanentOrNull(state, ctx.sourceId)?.perm;
    if (!self || (self.named?.bait ?? 0) <= 0) return;
    self.named = { ...self.named, bait: self.named!.bait - 1 };
    if (self.named.bait === 0) delete self.named.bait;
    say(`${nameOf(state, self)} loses a bait counter.`);
    nested([{ type: "createToken", amount: 1, token: { name: "Fish", type: "creature", power: 1, toughness: 1, colors: ["U"], subtypes: "Fish", keywords: [], text: "" } }]);
  },
  stashDiscard({ state, ctx, say }) {
    const me = state.players[ctx.controller];
    for (const owner of Object.values(state.players)) {
      const at = owner.graveyard.findIndex((c) => c.iid === ctx.other);
      if (at < 0) continue;
      const [card] = owner.graveyard.splice(at, 1);
      me.exile.push(card);
      me.mayPlay = [...(me.mayPlay ?? []), { iid: card.iid, source: "stash", via: ctx.sourceId }];
      say(`${getCard(state, card.defId).name} is exiled with a stash counter.`);
    }
  },
  /** Abyssal Harvester: exile the creature card, make a Nightmare token copy of it, then exile the other Nightmare tokens. */
  harvest({ state, ctx, events, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "card") continue;
      const yard = state.players[s.owner].graveyard;
      const at = yard.indexOf(s.card);
      if (at < 0) continue;
      yard.splice(at, 1);
      state.players[s.owner].exile.push(s.card);
      const def = getCard(state, s.card.defId);
      const subtypes = ((def.typeLine ?? "").split("—")[1] ?? "").trim();
      const keywords = (def.keywords ?? []).filter((k) => keywordsSupported({ ...def, keywords: [k] })).map((k) => k.toLowerCase()) as Keyword[];
      const made = makeToken(state, { name: def.name, type: "creature", power: def.power, toughness: def.toughness, colors: def.colors ?? [], subtypes: `${subtypes} Nightmare`.trim(), keywords, text: def.text ?? "" }, ctx.controller, events);
      for (const p of [...state.players[ctx.controller].battlefield]) {
        if (p.card.iid !== made && isToken(p.card) && subtypesOf(state, p).includes("nightmare")) removeFromBattlefield(state, p, ctx.controller);
      }
      say(`${ctx.sourceName} exiles ${def.name} and creates a Nightmare token copy of it.`);
    }
  },
  /** "Shuffle your graveyard into your library." */
  shuffleYard({ state, ctx, events, say }) {
    const me = state.players[ctx.controller];
    me.library.push(...me.graveyard.splice(0));
    [me.library, state.rng] = shuffle(me.library, state.rng);
    events.push({ type: "libraryShuffled", player: ctx.controller });
    say(`${playerLabel(ctx.controller)} shuffles their graveyard into their library.`);
  },
  /** "You lose the game." (Demonic Pact) */
  loseGame({ state, ctx, events }) {
    state.winner = OPPONENT[ctx.controller];
    events.push({ type: "gameWon", player: OPPONENT[ctx.controller] });
  },
  /** "Prevent all combat damage that would be dealt to it this turn." */
  preventCombatTo({ state, ctx, say }, effect) {
    for (const s of subjectsOf(state, effect.what, ctx)) {
      if (s.k !== "perm") continue;
      s.perm.noCombatDamage = true;
      say(`Combat damage that would be dealt to ${nameOf(state, s.perm)} is prevented this turn.`);
    }
  },
  /** "Each opponent loses X life. You gain life equal to the life lost this way." */
  drainLife({ state, ctx, events, value }, effect) {
    const amount = Math.max(0, value(effect.amount));
    const foe = state.players[OPPONENT[ctx.controller]];
    const before = foe.life;
    changeLife(state, foe.id, -amount, events);
    const lost = Math.max(0, before - foe.life);
    if (lost > 0) changeLife(state, ctx.controller, lost, events);
  },
  /** "...then discard a card unless you attacked this turn." */
  discardUnlessAttacked({ state, ctx, nested }) {
    if (state.players[ctx.controller].attackedThisTurn) return;
    nested([{ type: "discard", who: { t: "you" }, amount: 1, chooser: "victim" }]);
  },
} satisfies EffectHandlers;
