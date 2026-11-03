// Many people playing the computer at once. Start the server with DEV_AUTH=1, then:
//   npx tsx loadtest/botgames.ts 20 40        (20 games at once, watched for 40 seconds)
// It prints how late the server is to answer (the event-loop delay): the lower, the better. Compare with BOT_WORKERS=0
// (the bot thinking on the main thread) to see what the worker threads buy.
import { Client } from "@colyseus/sdk";
import { getCastable, getDamageAssignments, getForcedBlocks, getPossibleAttackers, legalTargets, MAX_HAND_SIZE, playerToAct, suggestDamageAssignment } from "@mtg/engine";
import type { Action, GameState, PlayerId } from "@mtg/engine";

const HOST = process.env.HOST ?? "localhost:2567";
const GAMES = Number(process.argv[2] ?? 20);
const SECONDS = Number(process.argv[3] ?? 40);
const deckOf = (land: string, creature: string) => [...Array(24).fill(land), ...Array(36).fill(creature)];

/** A person who plays quickly and simply (nothing here is expensive: the load must come from the server's bot). */
/** The opening: first each player shuffles the other's library, then they keep their hand. */
const openingMove = (s: GameState): Action => (s.opening?.shuffled && !(s.opening.shuffled.p1 && s.opening.shuffled.p2) ? { type: "shuffleDeck" } : { type: "keepHand", bottom: [] });

function choose(s: GameState, seat: PlayerId): Action | null {
  if (playerToAct(s) !== seat) return null;
  if (s.pendingPick) return s.pendingPick.optional ? { type: "pick" } : { type: "pick", iid: s.pendingPick.options[0] };
  if (s.pendingChoice) return { type: "chooseTargets", targets: s.pendingChoice.specs.flatMap((spec) => legalTargets(s, spec, s.pendingChoice!.item.controller).slice(0, 1)) };
  if (s.priority) return { type: "passPriority" };
  const me = s.players[seat];
  switch (s.phase) {
    case "mulligan":
      return openingMove(s);
    case "cleanup":
      return { type: "discard", iids: me.hand.slice(0, me.hand.length - MAX_HAND_SIZE).map((c) => c.iid) };
    case "damage":
      return { type: "assignDamage", assignments: getDamageAssignments(s).flatMap((d) => Object.entries(suggestDamageAssignment(s, d.attacker)).map(([blocker, amount]) => ({ attacker: d.attacker, blocker, amount }))) };
    case "blockers":
      return { type: "declareBlockers", blocks: getForcedBlocks(s) };
    case "attackers": {
      const can = getPossibleAttackers(s);
      return can.length > 0 ? { type: "declareAttackers", attackers: can } : { type: "passPhase" };
    }
    default: {
      const land = me.hand.find((c) => s.cards[c.defId]?.type === "land");
      if (land && me.landsPlayedThisTurn < 1) return { type: "playLand", iid: land.iid };
      const cast = getCastable(s, seat).find((c) => c.specs.length === 0 && !c.modal && c.maxX === undefined && !c.sacrifice);
      if (cast) return { type: "castSpell", iid: cast.iid, targets: [] };
      return { type: "passPhase" };
    }
  }
}

const stats = { started: 0, moves: 0, over: 0, errors: 0 };

async function play(i: number) {
  const client = new Client(`ws://${HOST}`);
  const room = await client.create("match", { name: `load ${i}`, token: `dev:load${i}` });
  let view: GameState | null = null;
  let seat: PlayerId = "p1";
  const act = () => {
    if (!view) return;
    if (view.winner) return void stats.over++;
    const a = choose(view, seat);
    if (a) (stats.moves++, room.send("action", { action: a }));
  };
  room.onMessage("room", (s: { stage: string; you: PlayerId; coin: { winner: PlayerId | null } | null }) => {
    seat = s.you;
    if (s.stage === "waiting") room.send("addBot");
    if (s.stage === "decks") room.send("deck", { name: "Reds", ids: deckOf("mountain", "agent-of-atlas"), botDeck: { name: "Greens", ids: deckOf("forest", "advance-scout") } });
    if (s.stage === "coin" && s.coin?.winner === "p1") room.send("order", { first: true });
  });
  room.onMessage("start", (m: { view: GameState }) => ((view = m.view), stats.started++, act()));
  room.onMessage("update", (m: { view: GameState }) => ((view = m.view), act()));
  room.onMessage("error", (m: { message?: string }) => { stats.errors++; if (process.env.SHOW_ERRORS && stats.errors < 4) console.log("error from server:", m?.message); });
  room.onMessage("*" as never, () => {});
  room.send("format", { bestOf: 1 });
  setTimeout(() => room.send("startVote"), 500);
  room.onMessage("closed", () => {});
}

const load = async () => (await fetch(`http://${HOST}/load`)).json() as Promise<{ rooms: number; players: number; bot: { workers: number; busy: number; waiting: number }; eventLoopDelay: { p50: number; p99: number; max: number } }>;

await load().catch(() => (console.error(`No server at ${HOST}. Start it first (DEV_AUTH=1).`), process.exit(1)));
console.log(`${GAMES} games against the bot, for ${SECONDS} s`);
for (let i = 0; i < GAMES; i++) {
  play(i).catch((e) => console.log(`game ${i} failed to start: ${e instanceof Error ? e.message : e}`));
  await new Promise((r) => setTimeout(r, 120));
}
const worst = { p99: 0, max: 0, waiting: 0 };
for (let t = 0; t < SECONDS; t += 4) {
  await new Promise((r) => setTimeout(r, 4000));
  const l = await load();
  worst.p99 = Math.max(worst.p99, l.eventLoopDelay.p99);
  worst.max = Math.max(worst.max, l.eventLoopDelay.max);
  worst.waiting = Math.max(worst.waiting, l.bot.waiting);
  console.log(`t=${t + 4}s rooms ${l.rooms}  started ${stats.started}  moves ${stats.moves}  server late by p50 ${l.eventLoopDelay.p50} ms / p99 ${l.eventLoopDelay.p99} ms / max ${l.eventLoopDelay.max} ms  bot workers busy ${l.bot.busy}/${l.bot.workers}, waiting ${l.bot.waiting}`);
}
console.log(`worst: p99 ${worst.p99} ms, max ${worst.max} ms, most bot moves waiting at once ${worst.waiting}; errors ${stats.errors}`);
process.exit(0);
