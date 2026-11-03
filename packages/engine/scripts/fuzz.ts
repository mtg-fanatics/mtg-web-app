// Plays lots of random games with REAL cards and checks that the rules engine never breaks:
//   no crash, no card lost or duplicated, no stuck game, nothing left in an impossible state.
// Run from packages/engine:   npx tsx scripts/fuzz.ts [games=200] [firstSeed=1] [maxActions=900]
// It needs the card cache from the importer (mtg/.import-cache), so it is not part of `npm test`.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  applyAction,
  getActivatable,
  getCastable,
  getCrewable,
  getCyclable,
  getDamageAssignments,
  getForcedBlocks,
  getLoyaltyAbilities,
  getPossibleAttackers,
  getPossibleBlockers,
  isSupportedCard,
  legalTargets,
  parseCard,
  playerToAct,
  createGame,
  staticEffectsOn,
  handLimit,
  suggestDamageAssignment,
  toughnessOf,
  MAX_HAND_SIZE,
} from "../src/index.js";
import type { Action, CardDef, GameEvent, GameState, PlayerId, TargetChoice } from "../src/index.js";

const [games = 200, firstSeed = 1, maxActions = 900] = process.argv.slice(2).map(Number);

// ───────── real cards ─────────
const cacheDir = path.resolve("../../mtg/.import-cache");
const file = fs.readdirSync(cacheDir).filter((f) => f.startsWith("oracle-cards") && f.endsWith(".jsonl.gz")).sort().pop()!;
const lines = zlib.gunzipSync(fs.readFileSync(path.join(cacheDir, file))).toString("utf8").split("\n").filter(Boolean);
const TYPES = [["Land", "land"], ["Creature", "creature"], ["Planeswalker", "planeswalker"], ["Instant", "instant"], ["Sorcery", "sorcery"], ["Enchantment", "enchantment"], ["Artifact", "artifact"], ["Battle", "battle"]] as const;
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const defs: Record<string, CardDef> = {};
const setOf = new Map<string, string>(); // card id -> set code (FUZZ_SET=msh plays only that set's cards)
for (const line of lines) {
  const c = JSON.parse(line);
  if (c.layout !== "normal" || c.card_faces) continue;
  const front = (c.type_line as string).split("—")[0];
  const type = TYPES.find(([w]) => front.includes(w))?.[1] ?? "other";
  const def: CardDef = {
    id: slug(c.name),
    name: c.name,
    type,
    cost: Math.round(c.cmc),
    power: /^\d+$/.test(c.power ?? "") ? Number(c.power) : undefined,
    toughness: /^\d+$/.test(c.toughness ?? "") ? Number(c.toughness) : undefined,
      loyalty: /^\d+$/.test(c.loyalty ?? "") ? Number(c.loyalty) : undefined,
    typeLine: c.type_line,
    manaCost: c.mana_cost ?? "",
    text: c.oracle_text ?? "",
    colors: c.colors ?? [],
    keywords: (c.keywords ?? []).map((k: string) => k.toLowerCase()),
  };
  if (["land", "creature", "artifact", "enchantment", "planeswalker", "instant", "sorcery"].includes(type) && isSupportedCard(def)) {
    defs[def.id] = def;
    setOf.set(def.id, String(c.set));
  }
}
const all = Object.values(defs);
console.log(`${all.length} playable real cards loaded (${lines.length} in the cache)`);

// ───────── random numbers ─────────
function rngFrom(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T,>(rng: Rng, xs: T[]): T => xs[Math.floor(rng() * xs.length)];

// FUZZ_SPELLS=1: decks made of instants, sorceries, auras and artifacts (with plenty of counterspells), and a bot that casts whenever it can.
const SPELLFEST = process.env.FUZZ_SPELLS === "1";

// FUZZ_JUMPSTART=1: every deck is two real Jumpstart packs (20 cards each) put together, using only packs the engine can fully play.
const JUMPSTART = process.env.FUZZ_JUMPSTART === "1";
const slugOf = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const jumpstartPacks: { name: string; cards: string[]; whole: boolean }[] = [];
if (JUMPSTART) {
  const dir = path.resolve("../../mtg/.import-cache/decks");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (d.type !== "Jumpstart") continue;
    const cards = (d.mainBoard ?? []).flatMap((c: { name: string; count: number }) => Array<string>(c.count).fill(slugOf(String(c.name).split(" // ")[0])));
    const playable = cards.filter((id: string) => defs[id]);
    if (playable.length > 0) jumpstartPacks.push({ name: d.name, cards: playable, whole: playable.length === cards.length });
  }
  console.log(`${jumpstartPacks.length} Jumpstart packs have playable cards (${jumpstartPacks.filter((p) => p.whole).length} are completely playable). Each game: two packs, only their playable cards, topped up with basic lands.`);
}

/** FUZZ_COVER=1: game n is built around the n-th playable non-land card (4 copies in each deck), so every card gets played. */
let focus: CardDef | null = null;
const coverList = process.env.FUZZ_COVER ? all.filter((d) => d.type !== "land" && (!process.env.FUZZ_SET || setOf.get(d.id) === process.env.FUZZ_SET)) : [];

function buildDeck(rng: Rng): string[] {
  if (JUMPSTART) {
    const deck = [...pick(rng, jumpstartPacks).cards, ...pick(rng, jumpstartPacks).cards];
    const basicOf: Record<string, string> = { W: "plains", U: "island", B: "swamp", R: "mountain", G: "forest" };
    const colors = [...new Set(deck.flatMap((id) => defs[id].colors ?? []))].filter((c) => basicOf[c] && defs[basicOf[c]]);
    const basics = colors.length ? colors.map((c) => basicOf[c]) : ["plains"];
    while (deck.length < 40) deck.push(pick(rng, basics));
    return deck;
  }
  const mustHave = (focus?.colors ?? []).filter((c) => "WUBRG".includes(c));
  const colors = [...new Set([...mustHave, ...["W", "U", "B", "R", "G"].sort(() => rng() - 0.5)])].slice(0, Math.max(2, mustHave.length));
  const fits = (d: CardDef) => (d.colors ?? []).every((c) => colors.includes(c));
  let spells = all.filter((d) => d.type !== "land" && fits(d));
  if (SPELLFEST) {
    const nonCreature = spells.filter((d) => d.type !== "creature");
    const counters = nonCreature.filter((d) => /counter target spell/i.test(d.text ?? ""));
    const someCreatures = spells.filter((d) => d.type === "creature").slice(0, 40);
    spells = [...nonCreature, ...nonCreature, ...counters, ...counters, ...counters, ...someCreatures];
  }
  const basics = colors.map((c) => ({ W: "plains", U: "island", B: "swamp", R: "mountain", G: "forest" })[c]!).filter((id) => defs[id]);
  const lands = all.filter((d) => d.type === "land" && !basics.includes(d.id) && (d.typeLine ?? "").includes("Land —") === false);
  const deck: string[] = focus ? Array<string>(4).fill(focus.id) : [];
  const copies = new Map<string, number>(focus ? [[focus.id, 4]] : []);
  while (deck.length < 24) {
    const d = pick(rng, spells);
    if ((copies.get(d.id) ?? 0) >= 3) continue;
    copies.set(d.id, (copies.get(d.id) ?? 0) + 1);
    deck.push(d.id);
  }
  for (let i = 0; i < 4 && lands.length; i++) deck.push(pick(rng, lands).id);
  while (deck.length < 40) deck.push(pick(rng, basics));
  return deck;
}

// ───────── the bot: some legal action, chosen at random ─────────
function randomTargets(s: GameState, specs: { kind: string }[], controller: PlayerId, rng: Rng): TargetChoice[] | null {
  const out: TargetChoice[] = [];
  for (const spec of specs) {
    const options = legalTargets(s, spec as never, controller);
    if (options.length === 0) return null;
    out.push(pick(rng, options));
  }
  return out;
}

function choose(s: GameState, rng: Rng): { player: PlayerId; action: Action } {
  const player = playerToAct(s);
  const go = (action: Action) => ({ player, action });

  if (s.pendingPick) {
    const p = s.pendingPick;
    if (p.optional && rng() < 0.3) return go({ type: "pick" });
    return go({ type: "pick", iid: pick(rng, p.options) });
  }
  if (s.pendingChoice) {
    const targets = randomTargets(s, s.pendingChoice.specs, s.pendingChoice.item.controller, rng) ?? [];
    return go({ type: "chooseTargets", targets });
  }

  const options: Action[] = [];
  const addCasts = () => {
    for (const c of getCastable(s, player)) {
      // "Choose one —": pick a mode that can be done; the targets are those of the chosen mode
      let specs = c.specs;
      let modes: number[] | undefined;
      if (c.modal) {
        const open = c.modal.modes.map((m, i) => (m.available ? i : -1)).filter((i) => i >= 0);
        modes = c.modal.max > 1 && open.length > 1 && rng() < 0.5 ? open.slice(0, 2) : [pick(rng, open)];
        specs = modes.flatMap((m) => c.modal!.modes[m].specs);
      }
      const targets = randomTargets(s, specs, player, rng);
      if (!targets) continue;
      options.push({
        type: "castSpell",
        iid: c.iid,
        targets,
        ...(c.maxX !== undefined ? { x: Math.floor(rng() * (c.maxX + 1)) } : {}),
        ...(c.kicker !== undefined && rng() < 0.5 ? { kicked: true } : {}),
        ...(c.zone ? { from: c.zone } : {}),
        ...(c.sacrifice ? { sacrifice: pick(rng, c.sacrifice) } : {}),
        ...(modes ? { modes } : {}),
      });
    }
    for (const a of getLoyaltyAbilities(s, player)) {
      const targets = randomTargets(s, a.specs, player, rng);
      if (targets) options.push({ type: "loyalty", iid: a.iid, index: a.index, targets });
    }
    for (const c of getCrewable(s, player)) options.push({ type: "crew", iid: c.iid });
    for (const a of getActivatable(s, player)) {
      const targets = randomTargets(s, a.specs, player, rng);
      if (targets) options.push({ type: "activateAbility", iid: a.iid, index: a.index, targets, ...(a.costChoices ? { payWith: pick(rng, a.costChoices) } : {}) });
    }
    for (const c of getCyclable(s, player)) options.push({ type: "cycle", iid: c.iid });
  };

  if (s.priority) {
    addCasts();
    if (options.length > 0 && rng() < (SPELLFEST ? 0.9 : 0.4)) return go(pick(rng, options));
    return go({ type: "passPriority" });
  }

  switch (s.phase) {
    case "mulligan":
      return go({ type: "keepHand", bottom: [] });
    case "cleanup": {
      const hand = s.players[player].hand;
      const excess = hand.length - handLimit(s, player);
      return go({ type: "discard", iids: hand.slice(0, excess).map((c) => c.iid) });
    }
    case "damage": {
      const assignments = getDamageAssignments(s).flatMap((d) => {
        const plan = suggestDamageAssignment(s, d.attacker);
        return Object.entries(plan).map(([blocker, amount]) => ({ attacker: d.attacker, blocker, amount }));
      });
      return go({ type: "assignDamage", assignments });
    }
    case "blockers": {
      const attackers = s.combat?.attackers.map((a) => a.attacker) ?? [];
      const forced = getForcedBlocks(s);
      const blocks = getPossibleBlockers(s).filter((b) => !forced.some((f) => f.blocker === b) && rng() < 0.6 && attackers.length > 0).map((blocker) => ({ blocker, attacker: pick(rng, attackers) }));
      // some random blocks are illegal (flying, menace...): try them, and fall back to the blocks the rules force
      return go({ type: "declareBlockers", blocks: [...forced, ...blocks] });
    }
    case "attackers": {
      const possible = getPossibleAttackers(s);
      const forced = possible.filter((id) => parseCard(s.cards[[...s.players.p1.battlefield, ...s.players.p2.battlefield].find((x) => x.card.iid === id)!.card.defId]).mustAttack);
      const can = [...new Set([...possible.filter(() => rng() < 0.6), ...forced])];
      // sometimes attack a planeswalker instead of the player
      const walkers = s.players[player === "p1" ? "p2" : "p1"].battlefield.filter((p) => s.cards[p.card.defId].type === "planeswalker").map((p) => p.card.iid);
      const targets = walkers.length > 0 ? Object.fromEntries(can.filter(() => rng() < 0.5).map((a) => [a, pick(rng, walkers)])) : undefined;
      if (can.length > 0 && (forced.length > 0 || rng() < 0.8)) return go({ type: "declareAttackers", attackers: can, ...(targets && Object.keys(targets).length ? { targets } : {}) });
      return go({ type: "passPhase" });
    }
    default: {
      for (const card of s.players[player].hand) if (s.cards[card.defId].type === "land") options.push({ type: "playLand", iid: card.iid });
      addCasts();
      if (options.length > 0 && rng() < (SPELLFEST ? 0.97 : 0.85)) return go(pick(rng, options));
      return go({ type: "passPhase" });
    }
  }
}

const toughnessOfPerm = (s: GameState, perm: GameState["players"]["p1"]["battlefield"][number]) => toughnessOf(s, perm);

// ───────── what must always be true ─────────
function invariants(s: GameState, initial: Record<PlayerId, number>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const count: Record<PlayerId, number> = { p1: 0, p2: 0 };
  const note = (iid: string, owner: PlayerId, where: string) => {
    if (seen.has(iid)) problems.push(`card ${iid} is in two places (second: ${where})`);
    seen.add(iid);
    if (!iid.startsWith("tok") && !iid.startsWith("gen")) count[owner]++; // (tokens and conjured cards are not cards of the deck) // tokens aren't cards of the deck
  };
  for (const p of Object.values(s.players)) {
    p.library.forEach((c) => note(c.iid, c.owner, "library"));
    p.hand.forEach((c) => note(c.iid, c.owner, "hand"));
    p.graveyard.forEach((c) => note(c.iid, c.owner, "graveyard"));
    p.exile.forEach((c) => note(c.iid, c.owner, "exile"));
    p.battlefield.forEach((x) => note(x.card.iid, x.card.owner, "battlefield"));
  }
  for (const item of s.stack) if (item.kind === "spell" && !item.copy) note(item.card.iid, item.card.owner, "stack"); // (a copy of a spell is not a card)
  for (const id of ["p1", "p2"] as const) if (count[id] !== initial[id]) problems.push(`${id} has ${count[id]} cards, started with ${initial[id]}`);

  const onBoard = new Set(Object.values(s.players).flatMap((p) => p.battlefield.map((x) => x.card.iid)));
  for (const p of Object.values(s.players)) {
    for (const perm of p.battlefield) {
      if (perm.attachedTo && !onBoard.has(perm.attachedTo)) problems.push(`aura ${perm.card.iid} is attached to something that is gone`);
      if (perm.damage < 0) problems.push(`negative damage on ${perm.card.iid}`);
      if (s.cards[perm.card.defId].type === "planeswalker" && (perm.loyalty ?? 0) <= 0) problems.push(`a planeswalker with no loyalty is still on the battlefield (${perm.card.iid})`);
      if (s.cards[perm.card.defId].type === "creature" && toughnessOfPerm(s, perm) <= 0) problems.push(`a creature with no toughness is still on the battlefield: ${s.cards[perm.card.defId].name} (${perm.card.iid}, base ${s.cards[perm.card.defId].toughness}, counters ${perm.counters ?? 0}, bonus ${perm.toughnessBonus ?? 0}, auras/anthems ${staticEffectsOn(s, perm).map((st) => st.toughness).join("+")})`);
      if (!Number.isFinite(perm.damage)) problems.push(`bad damage on ${perm.card.iid}`);
    }
    if (!Number.isFinite(p.life)) problems.push(`${p.id} has a bad life total`);
  }
  if (s.combat) {
    for (const a of s.combat.attackers) {
      if (s.phase !== "attackers" && !onBoard.has(a.attacker) && s.phase !== "damage") problems.push(`attacker ${a.attacker} is in combat but not on the battlefield`);
    }
  }
  if (s.pendingPick) {
    const p = s.pendingPick;
    const where = new Set(Object.values(s.players).flatMap((pl) => [...pl.hand, ...pl.library, ...pl.graveyard, ...pl.exile, ...pl.battlefield.map((x) => x.card)]).map((c) => c.iid));
    // ward ("pay"), mode (an index), color and creature type picks are not cards
    if (!["ward", "mode", "color", "creatureType", "mayPay", "tax", "toggle", "topBottom"].includes(p.kind)) for (const o of p.options) if (!where.has(o)) problems.push(`a pick offers ${o}, which is in no zone`);
  }
  if (s.priority && s.stack.length === 0 && !s.priority.then && !s.pendingPick && !s.pendingChoice) problems.push("priority is open with an empty stack and nothing to do next");
  return problems;
}

// ───────── what an action must have done: checks that compare the state before and after with the events ─────────
function transition(before: GameState, after: GameState, events: GameEvent[], action: Action): string[] {
  const problems: string[] = [];
  const all = (s: GameState) => Object.values(s.players).flatMap((p) => p.battlefield);

  // 1. Life totals follow from the events: damage, life lost, life gained. (changeLife also writes a "damage" event, so only lifeLost and combat damage count.)
  if (action.type !== "concede") {
    for (const id of ["p1", "p2"] as const) {
      let delta = 0;
      for (const e of events) {
        if (e.type === "lifeGained" && e.player === id) delta += e.amount;
        else if (e.type === "lifeLost" && e.player === id) delta -= e.amount;
        else if (e.type === "combatDamage" && e.target === id && !e.infect) delta -= e.amount; // (infect damage to a player is poison counters, not life)
      }
      const real = after.players[id].life - before.players[id].life;
      if (real !== delta) problems.push(`${id}'s life changed by ${real} but the events say ${delta} (${action.type})`);
    }
  }

  // 2. A player at 0 life or less has lost.
  for (const p of Object.values(after.players)) if (p.life <= 0 && !after.winner) problems.push(`${p.id} is at ${p.life} life and the game is not over`);

  // 3. After everything has settled, no creature stays on the battlefield with lethal damage (unless indestructible or protected by regeneration).
  if (!after.pendingPick && !after.pendingChoice && after.phase !== "damage") {
    for (const perm of all(after)) {
      const def = after.cards[perm.card.defId];
      if (def.type !== "creature" && !perm.crewed) continue;
      const tough = toughnessOf(after, perm);
      const indestructible = (def.keywords ?? []).includes("indestructible") || (perm.tempKeywords ?? []).includes("indestructible") || (perm.kwCounters ?? []).includes("indestructible") || staticEffectsOn(after, perm).some((st) => st.keywords.includes("indestructible"));
      if (perm.damage >= tough && !indestructible && tough > 0 && after.stack.length === 0 && !after.priority) problems.push(`${def.name} has ${perm.damage} damage on ${tough} toughness and is still alive`);
    }
  }

  // 4. Counters stay whole numbers >= 0, and the damage marked on a creature is a whole number.
  for (const perm of all(after)) {
    if ((perm.counters ?? 0) < 0 || !Number.isInteger(perm.counters ?? 0)) problems.push(`${perm.card.iid} has ${perm.counters} counters`);
    if (!Number.isInteger(perm.damage)) problems.push(`${perm.card.iid} has ${perm.damage} damage`);
  }

  // 5. Mana really was paid: every permanent the cast says it tapped is tapped or gone (a sacrificed Treasure).
  for (const e of events) {
    if (e.type === "creatureCast" || e.type === "spellCast") {
      for (const iid of e.tapped) {
        const perm = all(after).find((x) => x.card.iid === iid);
        // (if the spell already resolved, an "untap target land" effect may have untapped it again)
        if (perm && !perm.tapped && after.stack.length > 0) problems.push(`${iid} was used to pay for a spell but is untapped`);
      }
    }
  }

  // 6. A creature that died is in its owner's graveyard (or it was a token, or it came back / was exiled by a later effect).
  for (const e of events) {
    if (e.type === "creatureDied" && !e.iid.startsWith("tok")) {
      const owner = after.players[e.iid.split("-")[0] as PlayerId];
      const somewhere = [...owner.graveyard, ...owner.exile, ...owner.hand, ...owner.library].some((c) => c.iid === e.iid) || all(after).some((x) => x.card.iid === e.iid);
      if (!somewhere) problems.push(`${e.iid} died and is nowhere`);
    }
  }

  // 7. Stack items belong to someone and spell cards are not also in a zone.
  for (const item of after.stack) {
    if (item.kind === "spell" && Object.values(after.players).some((p) => [...p.hand, ...p.graveyard, ...p.library, ...p.exile].some((c) => c.iid === item.card.iid))) problems.push(`spell ${item.card.iid} is on the stack and also in a zone`);
  }

  // 8. No two permanents are attached to something that is not there; a land is never damaged; the planeswalker loyalty is whole.
  for (const perm of all(after)) {
    if (after.cards[perm.card.defId].type === "land" && perm.damage > 0 && !perm.crewed) problems.push(`a land (${perm.card.iid}) has damage marked on it`);
  }
  return problems;
}

// ───────── run ─────────
let crashes = 0;
let broken = 0;
let stuck = 0;
let finished = 0;
let turnsTotal = 0;
const seenProblems = new Map<string, { count: number; example: string }>();
const record = (kind: string, msg: string, example: string) => {
  const key = `${kind}: ${msg.replace(/\d+/g, "N").replace(/[a-z]-\d+/g, "x")}`;
  const e = seenProblems.get(key) ?? { count: 0, example };
  e.count++;
  seenProblems.set(key, e);
};
const eventTally = new Map<string, number>();
const used = new Map<string, number>(); // how often each card was actually in a game that ended normally

for (let g = 0; g < games; g++) {
  const seed = firstSeed + g;
  const rng = rngFrom(seed);
  // FUZZ_DECK=file.json (a list of card ids): both players play exactly that deck, to test one official deck.
  const fixed: string[] | null = process.env.FUZZ_DECK ? JSON.parse(fs.readFileSync(process.env.FUZZ_DECK, "utf8")) : null;
  focus = coverList.length ? coverList[(seed - 1) % coverList.length] : null;
  if (process.env.FUZZ_PROGRESS) fs.appendFileSync(process.env.FUZZ_PROGRESS, `game ${g + 1}: ${focus ? focus.name : "random"}
`);
  const decks = fixed ? { p1: [...fixed], p2: [...fixed] } : { p1: buildDeck(rng), p2: buildDeck(rng) };
  let state: GameState;
  try {
    state = createGame(decks, seed * 7919, defs, { startingPlayer: rng() < 0.5 ? "p1" : "p2" });
  } catch (e) {
    record("createGame", String(e), `seed ${seed}`);
    crashes++;
    continue;
  }
  const initial = { p1: decks.p1.length, p2: decks.p2.length };
  let failedInARow = 0;
  let steps = 0;
  const trail: string[] = [];
  for (; steps < maxActions && !state.winner; steps++) {
    // a card that doubles itself every turn (Troubling Tribbles) makes every move slower than the last: after this many permanents the game is called too long
    if (state.players.p1.battlefield.length + state.players.p2.battlefield.length > 250) break;
    const { player, action } = choose(state, rng);
    let result;
    const before = state;
    try {
      result = applyAction(state, player, action);
    } catch (e) {
      crashes++;
      record("CRASH", String(e instanceof Error ? e.message : e).slice(0, 140), `seed ${seed}, after ${trail.slice(-3).join(" | ")}, action ${JSON.stringify(action)}`);
      break;
    }
    trail.push(`${player}:${action.type}`);
    if (!result.ok) {
      // The bot may try something illegal (a random block that breaks flying, say): that is fine. Fall back to the safe move.
      failedInARow++;
      if (failedInARow > 25) {
        stuck++;
        if (process.env.FUZZ_DEBUG) for (const who of ["p1", "p2"] as const) for (const pm of state.players[who].battlefield) if (parseCard(state.cards[pm.card.defId]).statics?.some((st) => st.mustAttack)) console.log("SOURCE:", who, state.cards[pm.card.defId].name, "|", state.cards[pm.card.defId].text);
        if (process.env.FUZZ_DEBUG) for (const pm of state.players[player].battlefield) { const d = state.cards[pm.card.defId]; if (parseCard(d).mustAttack || staticEffectsOn(state, pm).some((st) => st.mustAttack)) console.log("FORCED:", d.name, "own:", parseCard(d).mustAttack, "text:", d.text?.slice(0, 120), "| statics:", JSON.stringify(staticEffectsOn(state, pm).filter((st) => st.mustAttack))); }
        record("STUCK", `${result.error}`, `seed ${seed}, phase ${state.phase}, needs ${player}, last ${JSON.stringify(action)}, ${player} controls: ${state.players[player].battlefield.map((p) => state.cards[p.card.defId]?.name).join(", ")}`);
        break;
      }
      const safe: Action | null =
        state.pendingPick || state.pendingChoice ? null : state.priority ? { type: "passPriority" } : state.phase === "blockers" ? { type: "declareBlockers", blocks: getForcedBlocks(state) } : state.phase === "attackers" ? (getPossibleAttackers(state).length > 0 ? { type: "declareAttackers", attackers: getPossibleAttackers(state) } : { type: "passPhase" }) /* attacking with everything is always allowed: nothing can be forced out */ : state.phase === "damage" ? null : { type: "passPhase" };
      if (safe) {
        const r2 = applyAction(state, playerToAct(state), safe);
        if (r2.ok) {
          state = r2.state;
          failedInARow = 0;
        }
      }
      continue;
    }
    failedInARow = 0;
    for (const e of result.events) eventTally.set(e.type, (eventTally.get(e.type) ?? 0) + 1);
    if (process.env.FUZZ_SELFTEST === "1" && result.events.some((e) => e.type === "combatDamage")) result.state.players.p1.life += 1; // a deliberate bug: the checks must notice
    state = result.state;
    const bad = [...invariants(state, initial), ...transition(before, state, result.events, action)];
    if (bad.length > 0) {
      broken++;
      for (const b of bad) record("BROKEN", b, `seed ${seed}, after ${trail.slice(-4).join(" | ")} -- ${b}`);
      break;
    }
  }
  if (state.winner) {
    finished++;
    turnsTotal += state.turn;
    for (const id of new Set([...decks.p1, ...decks.p2])) used.set(id, (used.get(id) ?? 0) + 1);
  } else if (steps >= maxActions) {
    record("LONG", "game did not end", `seed ${seed}, turn ${state.turn}, phase ${state.phase}${focus ? `, built around ${focus.name}: ${focus.text?.split(String.fromCharCode(10)).join(' / ').slice(0, 160)}` : ""}`);
  }
}

console.log(`\n${games} games: ${finished} finished (average ${(turnsTotal / Math.max(1, finished)).toFixed(1)} turns), ${crashes} crashed, ${broken} broke a rule of bookkeeping, ${stuck} got stuck`);
for (const [key, v] of [...seenProblems].sort((a, b) => b[1].count - a[1].count)) console.log(`  ×${v.count}  ${key}\n        e.g. ${v.example}`);
console.log("\nwhat happened in these games:", [...eventTally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
console.log(`\n${used.size} different real cards were in games that finished.`);
process.exit(crashes + broken + stuck > 0 ? 1 : 0);
