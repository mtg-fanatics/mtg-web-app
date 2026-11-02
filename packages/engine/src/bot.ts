import { applyAction, getDamageAssignments, getForcedBlocks, getPossibleAttackers, getPossibleBlockers, getRequiredBlocks, MAX_HAND_SIZE, suggestDamageAssignment } from "./actions.js";
import type { Action, Block } from "./actions.js";
import { getActivatable, getCastable, getLoyaltyAbilities, getPlottable } from "./stack.js";
import { entersTappedNow, exilePlayable, legalTargets, playerToAct, powerOf, staticEffectsOn, toughnessOf } from "./core.js";
import { landManaColors, manaSources } from "./mana.js";
import { hasKeyword } from "./keywords.js";
import type { Keyword } from "./keywords.js";
import { parseCard } from "./oracle.js";
import { BACK_SUFFIX } from "./oracle/doubleFaced.js";
import type { Effect, TargetChoice, TargetSpec } from "./effects.js";
import type { CardDef, GameState, Permanent, PlayerId } from "./types.js";

/**
 * A computer opponent.
 *
 * It plays by the same rules and sees only what a player could see: give it the view from `viewFor(state, seat)`
 * and it never learns the other hand. It thinks in three layers:
 *   1. Rules of thumb for the decisions that are about judgement: which opening hands to keep, who attacks, who blocks,
 *      what to discard, which target a spell should take.
 *   2. A score for a game position (life, creatures with their abilities, lands, cards in hand, and how exposed it
 *      would be to a counter-attack).
 *   3. Lookahead: for every spell or ability it could use now, it tries it on a copy of the game, lets the stack
 *      resolve, and keeps the move that scores best. Attacks are tried the same way, against the blocks it would
 *      itself choose as the defender. Combat tricks and responses are tried by playing the rest of the combat out.
 */

const OPP: Record<PlayerId, PlayerId> = { p1: "p2", p2: "p1" };

/** Thinking is capped: whatever the best move is when the time is up gets played. */
const THINK_MS = 700;
let deadline = 0;
const timeUp = () => Date.now() > deadline;
type Rng = () => number;

// ───────── looking at cards ─────────
const defOf = (s: GameState, p: Permanent) => s.cards[p.card.defId];
const isCreature = (s: GameState, p: Permanent) => defOf(s, p)?.type === "creature" || p.crewed === true;

function has(s: GameState, p: Permanent, keyword: string): boolean {
  const d = defOf(s, p);
  if (d && hasKeyword(d, keyword as Keyword)) return true;
  if ((p.tempKeywords as string[] | undefined)?.includes(keyword)) return true;
  return staticEffectsOn(s, p).some((st) => (st.keywords as string[]).includes(keyword));
}

const power = (s: GameState, p: Permanent) => Math.max(0, powerOf(s, p));
const toughness = (s: GameState, p: Permanent) => toughnessOf(s, p);

/** How much a creature is worth to its owner: size, evasion, abilities. */
function creatureValue(s: GameState, p: Permanent): number {
  const d = defOf(s, p);
  const pw = power(s, p);
  const th = Math.max(0, toughness(s, p));
  let v = pw * 1.6 + th * 1.0 + (d?.cost ?? 0) * 0.4 + 1;
  if (has(s, p, "flying")) v += pw * 0.9 + 1;
  if (has(s, p, "first strike")) v += pw * 0.5 + 0.5;
  if (has(s, p, "double strike")) v += pw * 1.5;
  if (has(s, p, "deathtouch")) v += 2.5;
  if (has(s, p, "lifelink")) v += pw * 0.6;
  if (has(s, p, "infect")) v += pw * 0.8; // ten poison counters kill: each point of power counts double
  if (has(s, p, "trample")) v += pw * 0.3;
  if (has(s, p, "menace")) v += 0.6;
  if (has(s, p, "vigilance")) v += 0.4;
  if (has(s, p, "haste")) v += 0.3;
  if (has(s, p, "reach")) v += 0.3;
  if (has(s, p, "hexproof")) v += 1;
  if (has(s, p, "indestructible")) v += th * 0.8 + 2;
  if (has(s, p, "defender")) v -= pw * 1.2;
  if (d?.text && /\{t\}|whenever|when |at the beginning|:/i.test(d.text)) v += 1.2;
  return v;
}

function permValue(s: GameState, p: Permanent): number {
  const d = defOf(s, p);
  if (!d) return 1;
  if (isCreature(s, p)) return creatureValue(s, p);
  if (d.type === "land") return 1.2;
  if (d.type === "planeswalker") return 3 + (p.loyalty ?? 0) * 0.8;
  // a Class is worth what was paid for its levels too
  return 1 + (d.cost ?? 0) * 0.6 + ((p.classLevel ?? 1) - 1) * 1.5;
}

const lifeScore = (life: number) => (life <= 0 ? -500 : life - Math.max(0, 8 - life) * 0.9);
/** A poison counter is worth about two life, more as the tenth gets close. */
const poisonScore = (poison: number) => (poison >= 10 ? 500 : poison * 2 + Math.max(0, poison - 6) * 1.8);
/** How much a creature's hit is worth in life: infect damage is poison counters. */
const hitValue = (s: GameState, p: Permanent) => power(s, p) * (has(s, p, "infect") ? 2 : 1);

function handValue(s: GameState, id: PlayerId): number {
  const pl = s.players[id];
  const lands = pl.battlefield.filter((p) => defOf(s, p)?.type === "land").length;
  let handLands = 0;
  let v = 0;
  for (const c of pl.hand) {
    const d = s.cards[c.defId];
    if (d?.type === "land") {
      handLands++;
      v += lands + handLands <= 6 ? 0.55 : 0.1; // a land is worth less once there are plenty
    } else v += 0.9 + Math.min(d?.cost ?? 0, 6) * 0.05;
  }
  return v;
}

/** How good the position is for `me`. Higher is better; a won game is huge. */
export function evaluate(s: GameState, me: PlayerId): number {
  if (s.winner) return s.winner === me ? 1e6 : s.winner === "draw" ? 0 : -1e6;
  const opp = OPP[me];
  let v = lifeScore(s.players[me].life) - lifeScore(s.players[opp].life) - poisonScore(s.players[me].poison ?? 0) + poisonScore(s.players[opp].poison ?? 0);
  for (const p of s.players[me].battlefield) v += permValue(s, p);
  for (const p of s.players[opp].battlefield) v -= permValue(s, p) * 1.05;
  v += handValue(s, me) - s.players[opp].hand.length * 0.8 + exiledForMe(s, me) * 0.5;
  if (s.players[me].library.length <= 2) v -= 6; // about to run out of cards
  return v;
}

/** Creature cards exiled with a permanent of mine (Ghost Vacuum): it can put them onto the battlefield later. */
function exiledForMe(s: GameState, me: PlayerId): number {
  const mine = new Set(s.players[me].battlefield.map((p) => p.card.iid));
  return Object.values(s.players).reduce((n, p) => n + p.exile.filter((c) => c.exiledBy && mine.has(c.exiledBy) && s.cards[c.defId]?.type === "creature").length, 0);
}

/** Danger of the counter-attack: creatures that attacked stay tapped, so they can't block on the other player's turn. */
function exposure(s: GameState, me: PlayerId): number {
  const life = Math.min(s.players[me].life, (10 - (s.players[me].poison ?? 0)) * 2);
  const theirs = s.players[OPP[me]].battlefield
    .filter((p) => isCreature(s, p) && !has(s, p, "defender"))
    .map((p) => hitValue(s, p))
    .sort((a, b) => b - a);
  const blockers = s.players[me].battlefield.filter((p) => isCreature(s, p) && !p.tapped).length;
  const damage = theirs.slice(blockers).reduce((a, b) => a + b, 0);
  if (damage >= life) return 400;
  return Math.max(0, damage - life * 0.35) * 0.9;
}

/** The position once this turn's "until end of turn" effects have worn off: what a combat trick really changed. */
function lasting(s: GameState): GameState {
  const strip = (p: Permanent): Permanent => ({ ...p, powerBonus: 0, toughnessBonus: 0, tempKeywords: [], tempBase: undefined, crewed: false });
  return { ...s, players: { p1: { ...s.players.p1, battlefield: s.players.p1.battlefield.map(strip) }, p2: { ...s.players.p2, battlefield: s.players.p2.battlefield.map(strip) } } };
}

// ───────── combat tricks ─────────
const branches = (e: Effect): Effect[] => (e.type === "ifKicked" || e.type === "ifNow" ? [...e.then, ...(e.otherwise ?? [])] : [e]);

/** Help for a creature that wears off at end of turn ("gets +2/+2 and gains hexproof", "becomes a 1/1 artifact creature"). */
const boost = (e: Effect): boolean =>
  e.type === "ifKicked" || e.type === "ifNow"
    ? branches(e).every(boost)
    : (e.type === "pump" && e.power >= 0 && e.toughness >= 0) || e.type === "grant" || e.type === "untargetable" || e.type === "becomeCreatureNow" || e.type === "setBase";

/** A boost that has to come before combat to matter: haste to attack, or a land that becomes a creature to attack with. */
const enablesAttack = (e: Effect): boolean => branches(e).some((b) => (b.type === "grant" && b.keyword === "haste") || b.type === "becomeCreatureNow");

/** A spell or ability that only boosts a creature until end of turn, and whether it can be used at instant speed. */
function boostOf(s: GameState, me: PlayerId, action: Action): { effects: Effect[]; instant: boolean } | null {
  const pl = s.players[me];
  if (action.type === "castSpell" && !action.modes) {
    const card = [...pl.hand, ...pl.graveyard, ...pl.exile].find((c) => c.iid === action.iid);
    const def = card ? s.cards[card.defId] : undefined;
    const effects = def ? parseCard(def).spell?.effects : undefined;
    return def && effects?.length && effects.every(boost) ? { effects, instant: def.type === "instant" || hasKeyword(def, "flash") } : null;
  }
  if (action.type === "activateAbility") {
    const perm = find(s, action.iid);
    const ability = perm ? parseCard(defOf(s, perm)).activated[action.index] : undefined;
    return ability?.effects.length && ability.effects.every(boost) ? { effects: ability.effects, instant: !ability.sorceryOnly } : null;
  }
  return null;
}

/**
 * Held for combat: a boost that can wait is cast once the blockers are known, so it isn't used in a main phase, nor before blocks.
 * After combat (the second main phase) no boost is worth anything this turn.
 */
function heldForCombat(s: GameState, me: PlayerId, action: Action): boolean {
  const b = boostOf(s, me, action);
  if (!b) return false;
  if (s.phase === "main2") return true;
  return b.instant && !b.effects.some(enablesAttack);
}

// ───────── fights ─────────
const lethal = (s: GameState, att: Permanent, def: Permanent): boolean => {
  if (has(s, def, "indestructible")) return false;
  const dmg = power(s, att) * (has(s, att, "double strike") ? 2 : 1);
  if (dmg <= 0) return false;
  return has(s, att, "deathtouch") || dmg >= toughness(s, def) - def.damage;
};

/** One attacker against one blocker: who dies. */
function duel(s: GameState, a: Permanent, b: Permanent): { aDies: boolean; bDies: boolean } {
  const fa = has(s, a, "first strike") || has(s, a, "double strike");
  const fb = has(s, b, "first strike") || has(s, b, "double strike");
  if (fa && !fb && lethal(s, a, b)) return { aDies: false, bDies: true };
  if (fb && !fa && lethal(s, b, a)) return { aDies: true, bDies: false };
  return { aDies: lethal(s, b, a), bDies: lethal(s, a, b) };
}

/** Can this creature block that attacker at all (the engine has the final say)? */
function canBlock(s: GameState, b: Permanent, a: Permanent): boolean {
  if (has(s, a, "flying") && !has(s, b, "flying") && !has(s, b, "reach")) return false;
  if (has(s, a, "shadow") !== has(s, b, "shadow")) return false;
  if (has(s, a, "horsemanship") && !has(s, b, "horsemanship")) return false;
  if (has(s, a, "menace")) return false; // needs two blockers: handled as a pair
  return true;
}

const find = (s: GameState, iid: string): Permanent | undefined => [...s.players.p1.battlefield, ...s.players.p2.battlefield].find((p) => p.card.iid === iid);

/** Which of the attackers each creature should block. */
function chooseBlocks(s: GameState, who: PlayerId): Block[] {
  if (!s.combat) return [];
  const lured = getForcedBlocks(s);
  const forced = [...lured, ...getRequiredBlocks(s, lured.map((f) => f.blocker))]; // "must be blocked if able" too
  const used = new Set(forced.map((f) => f.blocker));
  const blocks: Block[] = [...forced];
  const attackers = s.combat.attackers.map((a) => find(s, a.attacker)).filter((p): p is Permanent => !!p);
  const mine = getPossibleBlockers(s).map((iid) => find(s, iid)).filter((p): p is Permanent => !!p);
  const blockedAlready = new Set(forced.map((f) => f.attacker));
  const unblocked = attackers.filter((a) => !blockedAlready.has(a.card.iid));
  // what is left if nothing else is blocked: life, and poison counters still to go (infect)
  let lifeLeft = s.players[who].life - unblocked.filter((a) => !has(s, a, "infect")).reduce((n, a) => n + power(s, a), 0);
  let poisonLeft = 10 - (s.players[who].poison ?? 0) - unblocked.filter((a) => has(s, a, "infect")).reduce((n, a) => n + power(s, a), 0);
  const lethalThreat = lifeLeft <= 0 || poisonLeft <= 0;
  const spare = (a: Permanent, ap: number) => (has(s, a, "infect") ? (poisonLeft += ap) : (lifeLeft += ap));
  const low = (n: number) => Math.min(lifeLeft, poisonLeft * 2) <= n;

  for (const a of [...attackers].sort((x, y) => power(s, y) - power(s, x))) {
    if (blockedAlready.has(a.card.iid)) continue;
    const ap = power(s, a);
    const options = mine.filter((b) => !used.has(b.card.iid) && canBlock(s, b, a)).map((b) => ({ b, v: creatureValue(s, b), r: duel(s, a, b) }));
    const cheapest = (list: typeof options) => [...list].sort((x, y) => x.v - y.v)[0];
    const good = cheapest(options.filter((o) => o.r.aDies && !o.r.bDies)); // kills it and lives
    const wall = ap >= 1 ? cheapest(options.filter((o) => !o.r.bDies)) : undefined; // stops it and lives
    const trade = cheapest(options.filter((o) => o.r.aDies && o.r.bDies));
    let pick = good ?? wall;
    if (!pick && trade && (creatureValue(s, a) >= trade.v * 0.8 || low(6) || lethalThreat)) pick = trade;
    if (!pick && options.length > 0 && (lethalThreat || low(2)) && ap > 0) pick = cheapest(options); // chump block to stay alive
    if (pick) {
      blocks.push({ blocker: pick.b.card.iid, attacker: a.card.iid });
      used.add(pick.b.card.iid);
      spare(a, ap);
      continue;
    }
    // two creatures together kill it, and it can kill only one of them
    const free = options.slice().sort((x, y) => x.v - y.v);
    for (let i = 0; i < free.length && !pick; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const [x, y] = [free[i], free[j]];
        const together = power(s, x.b) + power(s, y.b);
        const kills = together >= toughness(s, a) - a.damage || has(s, x.b, "deathtouch") || has(s, y.b, "deathtouch");
        const losesOne = ap < toughness(s, x.b) + toughness(s, y.b);
        if (kills && losesOne && creatureValue(s, a) >= Math.min(x.v, y.v) * 0.9) {
          blocks.push({ blocker: x.b.card.iid, attacker: a.card.iid }, { blocker: y.b.card.iid, attacker: a.card.iid });
          used.add(x.b.card.iid);
          used.add(y.b.card.iid);
          spare(a, ap);
          pick = x;
          break;
        }
      }
    }
  }
  return blocks;
}

// ───────── playing a position out (the lookahead) ─────────
const quiet = (s: GameState) => !s.priority && s.stack.length === 0 && !s.pendingChoice && !s.pendingPick && s.triggerQueue.length === 0;

/** Rank the targets a spell or ability could take: harmful effects go at the enemy, helpful ones at us. */
function isHarmful(text: string): boolean {
  const t = text.toLowerCase();
  const bad = /deals? (\d+|x) damage|destroy|exile|gets? -\d|-\d+\/-\d+|loses? |tap target|can't block|sacrifice|return target [^.]* to its owner's hand|counter target|fights?|mill/.test(t);
  const good = /gets? \+\d|\+\d+\/\+\d+|gains? |regenerate|indestructible|hexproof|untap|protection|you gain|draw/.test(t);
  return bad && !(good && !/destroy|exile|deals?/.test(t));
}

function targetScore(s: GameState, t: TargetChoice, me: PlayerId, harmful: boolean): number {
  if (t.kind === "none") return -1;
  if (t.kind === "player") return harmful ? (t.id === me ? -50 : 20 + (s.players[t.id].life <= 6 ? 30 : 0)) : t.id === me ? 5 : -50;
  if (t.kind === "stack") {
    const item = s.stack.find((i) => i.id === t.id);
    return item && item.controller !== me ? 10 : -10;
  }
  if (t.kind === "card") return 0;
  const p = find(s, t.iid);
  if (!p) return 0;
  const mine = s.players[me].battlefield.includes(p);
  const v = permValue(s, p);
  return harmful ? (mine ? -50 : v) : mine ? v : -50;
}

function targetCombos(s: GameState, specs: TargetSpec[], me: PlayerId, text: string): TargetChoice[][] {
  const harmful = isHarmful(text);
  const distinct = specs.filter((spec) => spec.distinct).length;
  const lists = specs.map((spec) => {
    const opts = legalTargets(s, spec, me);
    // the best few for the intended use, and the best few for the opposite use (the lookahead decides between them)
    const byUse = [...opts].sort((a, b) => targetScore(s, b, me, harmful) - targetScore(s, a, me, harmful)).slice(0, spec.distinct ? 3 + distinct : 3);
    const other = [...opts].sort((a, b) => targetScore(s, b, me, !harmful) - targetScore(s, a, me, !harmful))[0];
    return [...new Set(other ? [...byUse, other] : byUse)];
  });
  if (lists.some((l) => l.length === 0)) return [];
  // "X target creatures": a different one for each
  const taken = (c: TargetChoice[], t: TargetChoice) => c.some((u, j) => specs[j].distinct && JSON.stringify(u) === JSON.stringify(t));
  let combos: TargetChoice[][] = [[]];
  for (const [i, list] of lists.entries()) combos = combos.flatMap((c) => list.filter((t) => !specs[i].distinct || !taken(c, t)).map((t) => [...c, t])).slice(0, 10);
  return combos;
}

/** The action the game takes for whoever has to act when nobody is thinking: answer choices simply, pass, block sensibly. */
function plainAction(s: GameState): Action | null {
  const who = playerToAct(s);
  if (s.pendingPick) {
    const p = s.pendingPick;
    return p.optional || p.options.length === 0 ? { type: "pick" } : { type: "pick", iid: p.options[0] };
  }
  if (s.pendingChoice) {
    const { specs, item } = s.pendingChoice;
    const targets: TargetChoice[] = [];
    for (const spec of specs) {
      const t = legalTargets(s, spec, item.controller).find((o) => !spec.distinct || !targets.some((u, j) => specs[j].distinct && JSON.stringify(u) === JSON.stringify(o)));
      if (t) targets.push(t);
    }
    return { type: "chooseTargets", targets };
  }
  if (s.priority) return { type: "passPriority" };
  switch (s.phase) {
    case "mulligan":
      if (s.opening?.shuffled && !s.opening.shuffled[who]) return { type: "shuffleDeck" };
      return { type: "keepHand", bottom: [] };
    case "cleanup": {
      const hand = s.players[who].hand;
      return { type: "discard", iids: hand.slice(0, Math.max(0, hand.length - MAX_HAND_SIZE)).map((c) => c.iid) };
    }
    case "damage":
      return { type: "assignDamage", assignments: getDamageAssignments(s).flatMap((d) => Object.entries(suggestDamageAssignment(s, d.attacker)).map(([blocker, amount]) => ({ attacker: d.attacker, blocker, amount }))) };
    case "blockers":
      return { type: "declareBlockers", blocks: chooseBlocks(s, who) };
    default:
      return { type: "passPhase" };
  }
}

/** Plays the game on with `plainAction` until `stop` says so. Returns null if the engine refuses something. */
function rollout(start: GameState, stop: (s: GameState) => boolean, maxSteps = 60): GameState {
  let s = start;
  for (let i = 0; i < maxSteps && !s.winner && !stop(s); i++) {
    const who = playerToAct(s);
    let action = plainAction(s);
    let r = action ? applyAction(s, who, action) : null;
    if (!r?.ok && s.phase === "blockers") {
      const lured = getForcedBlocks(s);
      r = applyAction(s, who, { type: "declareBlockers", blocks: [...lured, ...getRequiredBlocks(s, lured.map((f) => f.blocker))] });
    }
    if (!r?.ok) r = applyAction(s, who, s.priority ? { type: "passPriority" } : { type: "passPhase" });
    if (!r?.ok) break;
    s = r.state;
  }
  return s;
}

/** The position after doing `action` and letting everything on the stack resolve; null if the move is not allowed. */
function after(s: GameState, me: PlayerId, action: Action): GameState | null {
  const r = applyAction(s, me, action);
  return r.ok ? rollout(r.state, quiet) : null;
}

// ───────── deciding ─────────
const landCount = (s: GameState, id: PlayerId) => s.players[id].battlefield.filter((p) => defOf(s, p)?.type === "land").length;

function keepValue(s: GameState, id: PlayerId, defId: string): number {
  const d = s.cards[defId];
  if (!d) return 1;
  if (d.type === "land") return landCount(s, id) < 6 ? 3 : 0.5;
  return 2 + (d.type === "creature" ? 1 : 0) - Math.max(0, (d.cost ?? 0) - 5) * 0.8;
}

function chooseMulligan(s: GameState, me: PlayerId): Action {
  if (s.opening?.shuffled && !s.opening.shuffled[me]) return { type: "shuffleDeck" }; // first, shuffle the other player's library
  const hand = s.players[me].hand;
  const taken = s.opening?.taken[me] ?? 0;
  const lands = hand.filter((c) => s.cards[c.defId]?.type === "land").length;
  const fine = lands >= 2 && lands <= Math.max(4, Math.ceil(hand.length * 0.7));
  if (!fine && taken < 2) return { type: "mulligan" };
  const bottom = [...hand].sort((a, b) => keepValue(s, me, a.defId) - keepValue(s, me, b.defId)).slice(0, taken).map((c) => c.iid);
  return { type: "keepHand", bottom };
}

function chooseDiscard(s: GameState, me: PlayerId): Action {
  const hand = s.players[me].hand;
  const excess = Math.max(0, hand.length - MAX_HAND_SIZE);
  const worst = [...hand].sort((a, b) => keepValue(s, me, a.defId) - keepValue(s, me, b.defId)).slice(0, excess);
  return { type: "discard", iids: worst.map((c) => c.iid) };
}

/** A shock land: 2 life for it to be untapped, worth it only when that mana lets another spell be cast this turn. */
function shockWorthPaying(s: GameState, me: PlayerId, land: string): boolean {
  if (s.active !== me || s.players[me].life <= 7) return false;
  const open: GameState = { ...s, pendingPick: null };
  const shut = structuredClone(open);
  const perm = find(shut, land);
  if (!perm) return false;
  perm.tapped = true;
  return getCastable(open, me).length > getCastable(shut, me).length;
}

const libraryDef = (s: GameState, me: PlayerId, iid: string) => s.cards[s.players[me].library.find((c) => c.iid === iid)?.defId ?? ""];

/** Of the cards looked at, the one to play this turn: a land while no land was played yet, else the biggest spell the untapped mana pays for. */
function playNow(s: GameState, me: PlayerId, iids: string[]): string {
  const land = s.players[me].landsPlayedThisTurn === 0 ? iids.find((iid) => libraryDef(s, me, iid)?.type === "land") : undefined;
  if (land) return land;
  const mana = manaSources(s, me).filter((m) => !m.tapped && !m.sick).reduce((n, m) => n + m.amount, 0);
  const cost = (iid: string) => libraryDef(s, me, iid)?.cost ?? 0;
  const spells = iids.filter((iid) => libraryDef(s, me, iid)?.type !== "land");
  return [...spells].filter((iid) => cost(iid) <= mana).sort((a, b) => cost(b) - cost(a))[0] ?? [...iids].sort((a, b) => keepValue(s, me, libraryDef(s, me, a)?.id ?? "") - keepValue(s, me, libraryDef(s, me, b)?.id ?? ""))[0];
}

function choosePick(s: GameState, me: PlayerId): Action {
  const p = s.pendingPick!;
  if (p.kind === "mayPay" && p.tapIfNot) return { type: "pick", ...(shockWorthPaying(s, me, p.tapIfNot) ? { iid: "pay" } : {}) };
  if (p.kind === "searchLand") {
    const best = [...p.options].sort((a, b) => landScore(s, me, libraryDef(s, me, b)) - landScore(s, me, libraryDef(s, me, a)))[0];
    return { type: "pick", ...(best ? { iid: best } : {}) };
  }
  // Expressive Iteration: the card to play this turn is exiled next, so the hand gets the best of the others.
  if (p.kind === "toHand" && p.thenExile) {
    const exiled = playNow(s, me, p.options);
    const keep = p.options.filter((iid) => iid !== exiled).sort((a, b) => keepValue(s, me, libraryDef(s, me, b)?.id ?? "") - keepValue(s, me, libraryDef(s, me, a)?.id ?? ""))[0];
    return { type: "pick", iid: keep ?? exiled };
  }
  if (p.kind === "playExile") return { type: "pick", iid: playNow(s, me, p.options) };
  if (p.kind === "color" && p.poolColor) return { type: "pick", iid: neededColor(s, me, p.options) };
  // scry / surveil: the pick is the card to send away (the bottom of the library, the graveyard)
  if (p.kind === "scry" || p.kind === "surveil") {
    const lands = landCount(s, me) + s.players[me].hand.filter((c) => s.cards[c.defId]?.type === "land").length;
    for (const iid of p.options) {
      const card = s.players[me].library.find((c) => c.iid === iid);
      const d = card && s.cards[card.defId];
      if (!d) continue;
      if (d.type === "land" && lands >= 5) return { type: "pick", iid };
      if (d.type !== "land" && lands < 3 && (d.cost ?? 0) >= 4) return { type: "pick", iid };
    }
    return { type: "pick" };
  }
  const options: (string | undefined)[] = [...p.options, ...(p.optional ? [undefined] : [])];
  let best: { iid?: string; v: number } | null = null;
  for (const iid of options) {
    if (best && timeUp()) break;
    const end = after(s, me, { type: "pick", ...(iid ? { iid } : {}) });
    if (!end) continue;
    const v = evaluate(end, me) + (iid === undefined ? 0.01 : 0); // on a tie, do nothing
    if (!best || v > best.v) best = { iid, v };
  }
  return { type: "pick", ...(best?.iid ? { iid: best.iid } : {}) };
}

function chooseTrigger(s: GameState, me: PlayerId): Action {
  const choice = s.pendingChoice!;
  const text = choice.item.text;
  const combos = targetCombos(s, choice.specs, choice.item.controller, text);
  let best: { targets: TargetChoice[]; v: number } | null = null;
  for (const targets of combos.length ? combos : [[]]) {
    const end = after(s, me, { type: "chooseTargets", targets });
    if (!end) continue;
    const v = evaluate(end, me);
    if (!best || v > best.v) best = { targets, v };
  }
  return { type: "chooseTargets", targets: best?.targets ?? [] };
}

/** Every spell and ability that could be used now, with sensible choices filled in. */
function candidates(s: GameState, me: PlayerId): Action[] {
  const out: Action[] = [];
  const pl = s.players[me];
  const cardText = (iid: string) => {
    const c = [...pl.hand, ...pl.graveyard, ...pl.exile].find((x) => x.iid === iid);
    const prepared = pl.battlefield.find((p) => p.card.iid === iid)?.prepared;
    if (prepared) return s.cards[prepared]?.text ?? "";
    return c ? (s.cards[c.defId]?.text ?? "") : "";
  };
  const cheapestCreature = (iids: string[]) =>
    [...iids].sort((a, b) => {
      const pa = find(s, a);
      const pb = find(s, b);
      return (pa ? permValue(s, pa) : 0) - (pb ? permValue(s, pb) : 0);
    })[0];

  // "Flashback—Sacrifice a Mountain": one that was already tapped for mana
  const tappedFirst = (iids: string[]) => [...iids].sort((a, b) => Number(!!find(s, b)?.tapped) - Number(!!find(s, a)?.tapped))[0];
  const worstCard = (iids: string[]) => {
    const hand = s.players[me].hand;
    return [...iids].sort((a, b) => keepValue(s, me, hand.find((c) => c.iid === a)?.defId ?? "") - keepValue(s, me, hand.find((c) => c.iid === b)?.defId ?? ""))[0];
  };

  for (const c of getCastable(s, me)) {
    const modes = c.modal ? c.modal.modes.flatMap((m, i) => (m.available ? [{ i, specs: m.specs }] : [])) : [{ i: -1, specs: c.specs }];
    const xs = c.maxX === undefined ? [undefined] : [...new Set([c.maxX, Math.max(1, Math.floor(c.maxX / 2))])];
    const kicks = c.kicker !== undefined || c.blight ? [false, true] : [undefined];
    // An additional cost: the card to discard, or the creature to sacrifice (or "pay" the mana instead).
    const extras = c.discard ? [worstCard(c.discard)] : c.sacrifice && c.zone === "graveyard" ? [tappedFirst(c.sacrifice)] : c.sacrifice ? [...(c.sacrifice.length > 0 ? [cheapestCreature(c.sacrifice)] : []), ...(c.orPay ? ["pay"] : [])] : [undefined];
    // Warp: the cheap way that only lasts until the end step, or (when the mana is there) the normal way.
    const warps = c.warp ? (c.warpOnly ? [true] : [false, true]) : [false];
    // Harmonize: tap the creature that matters least, unless the mana alone pays.
    const harmonizeTap = c.harmonize && !c.harmonize.free ? cheapestCreature(c.harmonize.options) : undefined;
    for (const m of modes) {
      for (const targets of targetCombos(s, m.specs, me, cardText(c.iid)).length || m.specs.length === 0 ? (m.specs.length === 0 ? [[]] : targetCombos(s, m.specs, me, cardText(c.iid))) : []) {
        for (const x of xs) {
          for (const kicked of kicks) {
            // "You may blight 1": the -1/-1 counter goes on the creature that matters least.
            const blight = kicked && c.blight ? cheapestCreature(c.blight.options) : undefined;
            for (const extra of blight ? [blight] : extras) {
              for (const warp of warps) {
                out.push({
                  type: "castSpell",
                  iid: c.iid,
                  targets,
                  ...(x !== undefined ? { x } : {}),
                  ...(kicked ? { kicked: true } : {}),
                  ...(c.zone ? { from: c.zone } : {}),
                  ...(extra ? { sacrifice: extra } : {}),
                  ...(m.i >= 0 ? { modes: [m.i] } : {}),
                  ...(warp ? { warp: true } : {}),
                  ...(c.adventure ? { adventure: true } : {}),
                  ...(harmonizeTap ? { harmonizeTap } : {}),
                });
              }
            }
          }
        }
      }
    }
    // Replicate: a copy for each further target worth hitting (copies on the same target do nothing); the lookahead judges each count.
    if (c.replicate && c.replicate.max > 0 && !c.modal && c.specs.length > 0) {
      const combos = targetCombos(s, c.specs, me, cardText(c.iid));
      for (let n = 1; n <= Math.min(c.replicate.max, combos.length - 1); n++) {
        out.push({ type: "castSpell", iid: c.iid, targets: combos.slice(0, n + 1).flat(), replicate: n, ...(c.zone ? { from: c.zone } : {}) });
      }
    }
  }
  for (const a of getActivatable(s, me)) {
    const text = (() => {
      const p = find(s, a.iid);
      return p ? (defOf(s, p)?.text ?? "") : cardText(a.iid);
    })();
    const combos = a.specs.length === 0 ? [[]] : targetCombos(s, a.specs, me, text);
    for (const targets of combos) out.push({ type: "activateAbility", iid: a.iid, index: a.index, targets, ...(a.maxX !== undefined ? { x: a.maxX } : {}), ...(a.costChoices ? { payWith: cheapestCreature(a.costChoices) ?? a.costChoices[0] } : {}) });
  }
  for (const a of getLoyaltyAbilities(s, me)) {
    const combos = a.specs.length === 0 ? [[]] : targetCombos(s, a.specs, me, a.text);
    for (const targets of combos) out.push({ type: "loyalty", iid: a.iid, index: a.index, targets });
  }
  return out;
}

/** How much a land helps: the colors the hand needs and the table does not yet make, less one if it would enter tapped (half for a shock land's 2 life). */
function landScore(s: GameState, me: PlayerId, land: CardDef | undefined): number {
  if (!land) return 0;
  const pl = s.players[me];
  const need: Record<string, number> = {};
  for (const c of pl.hand) {
    const d = s.cards[c.defId];
    for (const sym of (d?.manaCost ?? "").matchAll(/\{([WUBRG])\}/g)) need[sym[1]] = (need[sym[1]] ?? 0) + 1;
  }
  const have: Record<string, number> = {};
  for (const p of pl.battlefield) {
    const d = defOf(s, p);
    for (const color of d ? landManaColors(d) : []) have[color] = (have[color] ?? 0) + 1;
  }
  const tapped = entersTappedNow(s, me, land) ? -1 : /\bpay 2 life\b/i.test(land.text ?? "") ? -0.5 : 0;
  return landManaColors(land).reduce((n, c) => n + (need[c] ?? 0) * 2 - (have[c] ?? 0) * 0.5, 0) + tapped;
}

/** "Add one mana of any color": the color the hand asks for most that the lands don't already make. */
function neededColor(s: GameState, me: PlayerId, options: string[]): string {
  const pl = s.players[me];
  const need = (color: string) => {
    const asked = pl.hand.reduce((n, c) => n + ((s.cards[c.defId]?.manaCost ?? "").match(new RegExp(`\\{${color}\\}`, "g"))?.length ?? 0), 0);
    const made = pl.battlefield.filter((p) => !p.tapped && defOf(s, p) && (landManaColors(defOf(s, p)!) as string[]).includes(color)).length;
    return asked - made * 0.5;
  };
  return [...options].sort((a, b) => need(b) - need(a))[0];
}

/** The best land to play (from the hand, or one exiled that may be played): the one that gives a color the hand needs and the table does not yet make. */
function chooseLand(s: GameState, me: PlayerId): Action | null {
  const pl = s.players[me];
  if (pl.landsPlayedThisTurn >= 1) return null;
  const lands = [...pl.hand, ...exilePlayable(s, me)].filter((c) => s.cards[c.defId]?.type === "land");
  if (lands.length === 0) return null;
  // A modal land (a Pathway) is played with whichever face helps more.
  const faces = lands.flatMap((c) => {
    const back = s.cards[`${c.defId}${BACK_SUFFIX}`];
    return [{ iid: c.iid, def: s.cards[c.defId], back: false }, ...(back?.type === "land" ? [{ iid: c.iid, def: back, back: true }] : [])];
  });
  const pick = [...faces].sort((a, b) => landScore(s, me, b.def) - landScore(s, me, a.def))[0];
  return { type: "playLand", iid: pick.iid, ...(pick.back ? { back: true } : {}) };
}

/** A permanent's ability that is worth using whenever it can be: a fetch land (while life allows), or "draw a card at the next upkeep" for free. */
function chooseUpkeep(s: GameState, me: PlayerId): Action | null {
  for (const a of getActivatable(s, me)) {
    const perm = find(s, a.iid);
    const ability = perm ? parseCard(defOf(s, perm)).activated[a.index] : undefined;
    if (!ability || ability.mana) continue;
    const fetch = ability.effects[0]?.type === "search" && ability.effects[0].to === "battlefield" && s.players[me].life > 5;
    const freeDraw = ability.effects.some((e) => e.type === "upkeepDraw");
    if (fetch || freeDraw) return { type: "activateAbility", iid: a.iid, index: a.index, targets: a.specs.map((): TargetChoice => ({ kind: "player", id: me })) };
  }
  return null;
}

/** Use the move that makes the position best, if any is worth it. */
function chooseMain(s: GameState, me: PlayerId): Action {
  const land = chooseLand(s, me) ?? chooseUpkeep(s, me);
  if (land) return land;
  const base = evaluate(rollout(s, quiet), me);
  let best: { action: Action; gain: number } | null = null;
  for (const action of candidates(s, me)) {
    if (best && timeUp()) break;
    if (heldForCombat(s, me, action)) continue;
    const end = after(s, me, action);
    if (!end) continue;
    const gain = evaluate(end, me) - base - (action.type === "loyalty" ? -0.5 : 0);
    if (!best || gain > best.gain) best = { action, gain };
  }
  if (best && best.gain > 0.35) return best.action;
  // Plot with the mana left after combat: the card is cast for free on a later turn.
  const plot = s.phase === "main2" ? getPlottable(s, me)[0] : undefined;
  return plot ? { type: "plot", iid: plot.iid } : { type: "passPhase" };
}

/** Which creatures attack: every plan is played out against the blocks the other player would choose. */
function chooseAttack(s: GameState, me: PlayerId): Action {
  const possible = getPossibleAttackers(s);
  if (possible.length === 0) return { type: "passPhase" };
  const perms = possible.map((iid) => find(s, iid)!).filter(Boolean);
  const forced = perms.filter((p) => { const d = defOf(s, p); return (d ? !!parseCard(d).mustAttack : false) || staticEffectsOn(s, p).some((st) => st.mustAttack === true); }).map((p) => p.card.iid);
  const opp = s.players[OPP[me]];
  const blockers = opp.battlefield.filter((p) => isCreature(s, p) && !p.tapped);
  const safe = (a: Permanent) => !blockers.some((b) => canBlock(s, b, a) && duel(s, a, b).aDies);
  const evasive = (a: Permanent) => blockers.every((b) => !canBlock(s, b, a));

  const sorted = [...perms].sort((a, b) => creatureValue(s, b) - creatureValue(s, a));
  const sets = new Map<string, string[]>();
  const add = (list: Permanent[]) => {
    const ids = [...new Set([...forced, ...list.map((p) => p.card.iid)])];
    sets.set([...ids].sort().join("|"), ids);
  };
  add([]);
  add(sorted);
  add(sorted.filter(safe));
  add(sorted.filter(evasive));
  for (let k = 1; k <= Math.min(sorted.length, 5); k++) add(sorted.slice(0, k));
  if (sorted.length <= 4) {
    for (let mask = 1; mask < 1 << sorted.length; mask++) add(sorted.filter((_, i) => mask & (1 << i)));
  } else for (const p of sorted) add([p]);

  const t0 = s.turn;
  const endOfCombat = (st: GameState) => st.turn !== t0 || (!st.combat && !["attackers", "blockers", "damage"].includes(st.phase) && quiet(st));
  let best: { ids: string[]; v: number } | null = null;
  for (const ids of sets.values()) {
    if (best && timeUp()) break;
    let v: number;
    if (ids.length === 0) v = evaluate(s, me) - exposure(s, me);
    else {
      const r = applyAction(s, me, { type: "declareAttackers", attackers: ids });
      if (!r.ok) continue;
      const end = rollout(r.state, endOfCombat);
      v = evaluate(end, me) - exposure(end, me) + ids.length * 0.05; // a little push to be the aggressor
    }
    if (!best || v > best.v) best = { ids, v };
  }
  if (!best || best.ids.length === 0) return { type: "passPhase" };
  return { type: "declareAttackers", attackers: best.ids };
}

/** The other player has cast something, or combat is about to be decided: answer with an instant if that plays out better. */
function chooseResponse(s: GameState, me: PlayerId): Action {
  const pass: Action = { type: "passPriority" };
  const cands = getCastable(s, me).length || getActivatable(s, me).length ? candidates(s, me) : [];
  if (cands.length === 0) return pass;
  const t0 = s.turn;
  // play the rest of this combat (or just the stack) out
  const stop = (st: GameState) => st.turn !== t0 || (quiet(st) && !st.combat) || (quiet(st) && !["blockers", "damage"].includes(st.phase) && st.phase !== "attackers");
  // Scored once the boosts have worn off: a trick is worth the damage it added, the creature it saved or the one it killed.
  const score = (st: GameState) => evaluate(lasting(st), me);
  const baseAfter = applyAction(s, me, pass);
  const base = baseAfter.ok ? score(rollout(baseAfter.state, stop)) : score(s);
  // The attackers are declared but not the blockers yet: a trick waits until it is known who blocks whom, unless it answers the opponent (a removal spell).
  const beforeBlocks = s.priority?.then === "afterAttackers" && s.stack.every((item) => item.controller === me);
  let best: { action: Action; gain: number } | null = null;
  for (const action of cands) {
    if (best && timeUp()) break;
    if (beforeBlocks && boostOf(s, me, action)?.instant) continue;
    const r = applyAction(s, me, action);
    if (!r.ok) continue;
    const gain = score(rollout(r.state, stop)) - base;
    if (!best || gain > best.gain) best = { action, gain };
  }
  return best && best.gain > 0.8 ? best.action : pass;
}

function decide(s: GameState, me: PlayerId): Action {
  if (s.pendingPick) return choosePick(s, me);
  if (s.pendingChoice) return chooseTrigger(s, me);
  if (s.priority) return chooseResponse(s, me);
  switch (s.phase) {
    case "mulligan":
      return chooseMulligan(s, me);
    case "cleanup":
      return chooseDiscard(s, me);
    case "damage":
    case "blockers":
      return plainAction(s) ?? { type: "passPhase" };
    case "attackers":
      return chooseAttack(s, me);
    case "main1":
    case "main2":
      return chooseMain(s, me);
    default:
      return { type: "passPhase" };
  }
}

/**
 * The bot's next move, or null when it is not its turn to act (or the game is over).
 * Pass the bot's own view of the game (`viewFor(state, seat)`) so it plays with no more information than a person has.
 */
export function botAction(state: GameState, seat: PlayerId): Action | null {
  if (state.winner || playerToAct(state) !== seat) return null;
  deadline = Date.now() + THINK_MS;
  const tries: (Action | null)[] = [];
  try {
    tries.push(decide(state, seat));
  } catch {
    // a bug in the thinking must never freeze a game: fall through to the plain moves
  }
  tries.push(plainAction(state));
  for (const action of tries) {
    if (action && applyAction(state, seat, action).ok) return action;
  }
  // the last resorts
  for (const action of [state.priority ? ({ type: "passPriority" } as Action) : ({ type: "passPhase" } as Action), { type: "declareBlockers", blocks: [] } as Action]) {
    if (applyAction(state, seat, action).ok) return action;
  }
  return null;
}
