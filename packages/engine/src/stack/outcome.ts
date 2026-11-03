import { getCard } from "../cards.js";
import { isCreature, keywordsNow, powerOf, toughnessOf } from "../core.js";
import { SUPPORTED_KEYWORDS } from "../keywords.js";
import type { GameState, Permanent, PlayerId } from "../types.js";

// What a spell or ability did, found by comparing the game just before it resolved with the game just after, so the players
// can be told every part of it ("Glistener Elf gets +2/+2 and gains hexproof") without each effect reporting itself.

/** One thing a spell or ability changed. Permanents are named as they are (or as they last were, for one that left). */
export type Outcome =
  | { k: "pump"; iid: string; name: string; dp: number; dt: number; power: number; toughness: number }
  | { k: "counters"; iid: string; name: string; plus: number; minus: number; power: number; toughness: number }
  | { k: "keywords"; iid: string; name: string; gained: string[]; lost: string[] }
  | { k: "shielded"; iid: string; name: string; from: PlayerId }
  | { k: "animated"; iid: string; name: string; power: number; toughness: number }
  | { k: "tapped" | "untapped"; iid: string; name: string }
  | { k: "damaged"; iid: string; name: string; n: number }
  | { k: "entered"; iid: string; name: string; player: PlayerId }
  | { k: "left"; iid: string; name: string; to: "graveyard" | "exile" | "hand" | "library" | "gone" }
  | { k: "control"; iid: string; name: string; player: PlayerId }
  | { k: "life" | "poison"; player: PlayerId; from: number; to: number }
  | { k: "drew"; player: PlayerId; n: number };

interface Seen {
  name: string;
  player: PlayerId;
  creature: boolean;
  power: number;
  toughness: number;
  plus: number;
  minus: number;
  keywords: string[];
  shielded: PlayerId[];
  tapped: boolean;
  damage: number;
}

export interface Snapshot {
  perms: Map<string, Seen>;
  players: Record<PlayerId, { life: number; poison: number; library: Set<string> }>;
}

function see(state: GameState, perm: Permanent, player: PlayerId): Seen {
  const creature = isCreature(state, perm);
  return {
    name: getCard(state, perm.card.defId).name,
    player,
    creature,
    power: creature ? powerOf(state, perm) : 0,
    toughness: creature ? toughnessOf(state, perm) : 0,
    plus: perm.counters ?? 0,
    minus: perm.minusCounters ?? 0,
    keywords: creature ? keywordsNow(state, perm, SUPPORTED_KEYWORDS) : [],
    shielded: perm.untargetableBy ?? [],
    tapped: perm.tapped,
    damage: perm.damage,
  };
}

export function snapshot(state: GameState): Snapshot {
  const perms = new Map<string, Seen>();
  for (const p of Object.values(state.players)) for (const perm of p.battlefield) perms.set(perm.card.iid, see(state, perm, p.id));
  const player = (id: PlayerId) => ({ life: state.players[id].life, poison: state.players[id].poison ?? 0, library: new Set(state.players[id].library.map((c) => c.iid)) });
  return { perms, players: { p1: player("p1"), p2: player("p2") } };
}

function whereNow(state: GameState, iid: string): Extract<Outcome, { k: "left" }>["to"] {
  for (const p of Object.values(state.players)) {
    if (p.graveyard.some((c) => c.iid === iid)) return "graveyard";
    if (p.exile.some((c) => c.iid === iid)) return "exile";
    if (p.hand.some((c) => c.iid === iid)) return "hand";
    if (p.library.some((c) => c.iid === iid)) return "library";
  }
  return "gone";
}

function permanentChanges(iid: string, was: Seen, now: Seen): Outcome[] {
  const out: Outcome[] = [];
  const { name, power, toughness } = now;
  if (now.player !== was.player) out.push({ k: "control", iid, name, player: now.player });
  if (now.creature && !was.creature) out.push({ k: "animated", iid, name, power, toughness });
  const plus = now.plus - was.plus;
  const minus = now.minus - was.minus;
  if (plus !== 0 || minus !== 0) out.push({ k: "counters", iid, name, plus, minus, power, toughness });
  // The size change the counters don't explain: a pump ("+2/+2 until end of turn"), or a lord arriving or leaving.
  const dp = now.power - was.power - (plus - minus);
  const dt = now.toughness - was.toughness - (plus - minus);
  if (now.creature && was.creature && (dp !== 0 || dt !== 0)) out.push({ k: "pump", iid, name, dp, dt, power, toughness });
  const gained = now.keywords.filter((k) => !was.keywords.includes(k));
  const lost = was.keywords.filter((k) => !now.keywords.includes(k));
  if (gained.length > 0 || lost.length > 0) out.push({ k: "keywords", iid, name, gained, lost });
  for (const from of now.shielded) if (!was.shielded.includes(from)) out.push({ k: "shielded", iid, name, from });
  if (now.tapped !== was.tapped) out.push({ k: now.tapped ? "tapped" : "untapped", iid, name });
  if (now.damage > was.damage) out.push({ k: "damaged", iid, name, n: now.damage - was.damage });
  return out;
}

/** Everything that changed since `before`: on the battlefield first, then life, poison and cards drawn. */
export function outcomeSince(state: GameState, before: Snapshot): Outcome[] {
  const out: Outcome[] = [];
  const now = snapshot(state);
  for (const [iid, seen] of now.perms) {
    const was = before.perms.get(iid);
    if (!was) out.push({ k: "entered", iid, name: seen.name, player: seen.player });
    else out.push(...permanentChanges(iid, was, seen));
  }
  for (const [iid, was] of before.perms) if (!now.perms.has(iid)) out.push({ k: "left", iid, name: was.name, to: whereNow(state, iid) });
  for (const id of ["p1", "p2"] as const) {
    const was = before.players[id];
    const is = now.players[id];
    if (is.life !== was.life) out.push({ k: "life", player: id, from: was.life, to: is.life });
    if (is.poison !== was.poison) out.push({ k: "poison", player: id, from: was.poison, to: is.poison });
    const drew = state.players[id].hand.filter((c) => was.library.has(c.iid)).length;
    if (drew > 0) out.push({ k: "drew", player: id, n: drew });
  }
  return out;
}
