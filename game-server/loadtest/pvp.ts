// Many pairs of virtual accounts play each other, person against person, start to finish. Start the server with DEV_AUTH=1, then:
//   HOST=localhost:2598 npx tsx loadtest/pvp.ts 25 150      (25 pairs = 50 accounts, watched for up to 150 seconds)
// It checks every match really finishes, both players agree on the result, nothing gets stuck, and prints how late the server was.
import { Client } from "@colyseus/sdk";
import { getCastable, getDamageAssignments, getForcedBlocks, getPossibleAttackers, legalTargets, MAX_HAND_SIZE, playerToAct, suggestDamageAssignment } from "@mtg/engine";
import type { Action, GameState, PlayerId } from "@mtg/engine";

const HOST = process.env.HOST ?? "localhost:2567";
const PAIRS = Number(process.argv[2] ?? 20);
const SECONDS = Number(process.argv[3] ?? 120);
const deckOf = (land: string, creature: string) => [...Array(24).fill(land), ...Array(36).fill(creature)];
const tag = Date.now().toString(36);

function choose(s: GameState, seat: PlayerId): Action | null {
  if (playerToAct(s) !== seat) return null;
  if (s.pendingPick) return s.pendingPick.optional ? { type: "pick" } : { type: "pick", iid: s.pendingPick.options[0] };
  if (s.pendingChoice) return { type: "chooseTargets", targets: s.pendingChoice.specs.flatMap((spec) => legalTargets(s, spec, s.pendingChoice!.item.controller).slice(0, 1)) };
  if (s.priority) return { type: "passPriority" };
  const me = s.players[seat];
  switch (s.phase) {
    case "mulligan":
      return s.opening?.shuffled && !s.opening.shuffled[seat] ? { type: "shuffleDeck" } : { type: "keepHand", bottom: [] };
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

const stats = { started: 0, moves: 0, ended: 0, agree: 0, disagree: 0, errors: 0, failed: 0 };
const results = new Map<number, PlayerId[]>();

async function pair(i: number) {
  const seats = ["host", "guest"] as const;
  const clients = seats.map(() => new Client(`ws://${HOST}`));
  const host = await clients[0].create("match", { name: `pvp ${i}`, token: `dev:${tag}h${i}` });
  const guest = await clients[1].joinById(host.roomId, { token: `dev:${tag}g${i}` });
  for (const [k, room] of [host, guest].entries()) {
    let view: GameState | null = null;
    let seat: PlayerId = k === 0 ? "p1" : "p2";
    let ended = false;
    const act = () => {
      if (!view || ended) return;
      if (view.winner) {
        ended = true;
        stats.ended++;
        (results.get(i) ?? results.set(i, []).get(i)!).push(view.winner);
        return;
      }
      const a = choose(view, seat);
      if (a) (stats.moves++, room.send("action", { action: a }));
    };
    room.onMessage("room", (s: { stage: string; you: PlayerId; coin: { winner: PlayerId | null; call: string | null; chose: string | null } | null }) => {
      seat = s.you;
      if (s.stage === "decks") room.send("deck", { name: "x", ids: k === 0 ? deckOf("mountain", "agent-of-atlas") : deckOf("forest", "advance-scout") });
      if (s.stage === "coin" && s.coin && !s.coin.call && k === 1) room.send("call", { side: "heads" });
      if (s.stage === "coin" && s.coin?.winner === seat && !s.coin.chose) room.send("order", { first: i % 2 === 0 });
    });
    room.onMessage("start", (m: { view: GameState }) => ((view = m.view), k === 0 && stats.started++, act()));
    room.onMessage("update", (m: { view: GameState }) => ((view = m.view), act()));
    room.onMessage("error", () => stats.errors++);
    room.onMessage("*" as never, () => {});
    room.onLeave(() => {});
  }
  host.send("format", { bestOf: 1 }); guest.send("format", { bestOf: 1 });
  setTimeout(() => host.send("startVote"), 400);
}

const load = async () => (await fetch(`http://${HOST}/load`)).json() as Promise<{ rooms: number; players: number; eventLoopDelay: { p50: number; p99: number; max: number } }>;
await load().catch(() => (console.error(`No server at ${HOST}.`), process.exit(1)));
console.log(`${PAIRS} pairs (${PAIRS * 2} accounts) playing each other, for up to ${SECONDS} s`);
for (let i = 0; i < PAIRS; i++) {
  pair(i).catch((e) => (stats.failed++, console.log(`pair ${i} failed: ${e instanceof Error ? e.message : e}`)));
  await new Promise((r) => setTimeout(r, 150));
}
const worst = { p99: 0, max: 0 };
for (let t = 0; t < SECONDS; t += 5) {
  await new Promise((r) => setTimeout(r, 5000));
  const l = await load();
  worst.p99 = Math.max(worst.p99, l.eventLoopDelay.p99);
  worst.max = Math.max(worst.max, l.eventLoopDelay.max);
  console.log(`t=${t + 5}s rooms ${l.rooms} started ${stats.started} ended(player views) ${stats.ended}/${PAIRS * 2} moves ${stats.moves} late p50 ${l.eventLoopDelay.p50} p99 ${l.eventLoopDelay.p99} ms`);
  if (stats.ended >= PAIRS * 2) break;
}
for (const winners of results.values()) winners.length === 2 && winners[0] === winners[1] ? stats.agree++ : stats.disagree++;
console.log(`matches finished with both players agreeing: ${stats.agree}/${PAIRS}; disagreeing: ${stats.disagree}; never finished: ${PAIRS - results.size}; server errors sent: ${stats.errors}; pairs that failed to start: ${stats.failed}`);
console.log(`worst server delay: p99 ${worst.p99} ms, max ${worst.max} ms`);
process.exit(stats.agree === PAIRS ? 0 : 1);
