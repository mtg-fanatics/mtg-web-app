"use client";

import { useState } from "react";
import { joinRoom } from "@/lib/online/session";
import type { LobbyRoomInfo, Stage } from "@/lib/online/protocol";
import type { OnlineState } from "@/lib/online/session";
import { RowSkeletons } from "../Skeleton";
import { Cross, Padlock, Scroll } from "../Icons";
import WatchButton from "./WatchButton";

const STATUS: Record<Stage, { label: string; chip: string }> = {
  waiting: { label: "A chair is free", chip: "bg-[#6b9a7f]/20 text-[#bfe0cb] ring-[#6b9a7f]/50" },
  vote: { label: "Choosing decks", chip: "bg-[#e8dcc0]/10 text-[#e8dcc0] ring-[#c8b28a]/40" },
  decks: { label: "Choosing decks", chip: "bg-[#e8dcc0]/10 text-[#e8dcc0] ring-[#c8b28a]/40" },
  coin: { label: "Tossing the coin", chip: "bg-[#e8dcc0]/10 text-[#e8dcc0] ring-[#c8b28a]/40" },
  playing: { label: "Under way", chip: "bg-[#b3392b]/30 text-[#f6cdbf] ring-[#d9694f]/60" },
  over: { label: "Finished", chip: "bg-black/20 text-slate-300 ring-slate-400/30" },
};

/** The list of rooms, updated live: who is waiting for an opponent, and which matches are being played right now. */
export default function LiveMatches({ online, inRoom }: { online: OnlineState; inRoom: boolean }) {
  const rooms = [...online.rooms].sort((a, b) => Number(b.status === "playing") - Number(a.status === "playing") || a.name.localeCompare(b.name));
  const live = rooms.filter((r) => r.status === "playing").length;

  return (
    <section aria-label="Live matches" className="book-tip-r panel-glass flex max-h-[min(26rem,52dvh)] flex-col gap-3 p-5 text-white">
      <header className="flex items-center gap-2.5">
        <span className={`h-3 w-3 rounded-[40%_60%_50%_50%] border-2 border-[#120c07] ${online.lobby === "on" ? "bg-[#6b9a7f]" : online.lobby === "connecting" ? "animate-pulse bg-[#d8c8a2]" : "bg-[#b3392b]"}`} aria-hidden="true" />
        <h2 className="text-2xl text-[#e8dcc0]">Tonight&apos;s tables</h2>
        <span className="count-chip ml-auto">{live === 0 ? "no duels yet" : live === 1 ? "one duel under way" : `${live} duels under way`}</span>
      </header>

      {/* "off" with no error is just the moment before the first connection starts */}
      {(online.lobby === "connecting" || (online.lobby === "off" && !online.error)) && <RowSkeletons count={2} className="h-[62px]" label="Connecting to the game server" />}
      {online.lobby === "off" && online.error && <p className="empty-note px-3 py-2 text-[16px]">The innkeeper isn&apos;t answering. Check your connection and try again.</p>}

      {online.lobby === "on" && rooms.length === 0 && (
        <div className="empty-note flex flex-col items-center gap-1 px-4 py-4 text-[16px]">
          <Scroll width={28} height={28} className="ink-icon text-[#d9694f]" />
          <b className="font-normal text-[18px] text-[#e8dcc0]">Every chair is empty.</b>
          <span>Open a table and the first friend through the door gets the other seat.</span>
        </div>
      )}

      <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5">
        {rooms.map((r) => (
          <RoomRow key={r.roomId} room={r} canJoin={!inRoom} />
        ))}
      </ul>
    </section>
  );
}

function RoomRow({ room, canJoin }: { room: LobbyRoomInfo; canJoin: boolean }) {
  const status = STATUS[room.status] ?? STATUS.waiting;
  const open = room.status === "waiting" && room.clients < room.maxClients && !room.bot;
  const [asking, setAsking] = useState(false); // a locked room: the password box is open
  const [password, setPassword] = useState("");

  async function join() {
    if (room.locked && !asking) {
      setAsking(true);
      return;
    }
    if (!(await joinRoom(room.roomId, room.locked ? password : undefined))) return; // the reason shows under the list
    setAsking(false);
    setPassword("");
  }

  return (
    <li className="deck-row !flex-col !items-stretch !gap-2 !py-2.5" style={{ "--accent": room.status === "playing" ? "#d9694f" : room.status === "waiting" ? "#6b9a7f" : "#8c7455" } as React.CSSProperties}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">
            {room.locked && <Padlock width={14} height={14} className="ink-icon mr-1 inline-block align-[-2px] text-[#d8c8a2]" aria-label="Needs a word at the door" />}
            {room.name}
          </div>
          <div className="truncate text-sm text-slate-300">
            {room.players.length > 0 ? room.players.join(" against ") : `Set by ${room.host}`}
            {room.bot ? " · with the clockwork" : ""}
            {room.status === "playing" && room.turn > 0 ? ` · turn ${room.turn}` : ""}
            {room.spectators > 0 ? ` · ${room.spectators} looking on` : ""}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${status.chip}`}>
          {status.label}
        </span>
        {room.status === "playing" && <WatchButton roomId={room.roomId} name={room.name} locked={room.locked} disabled={!canJoin} title={canJoin ? undefined : "You already have a seat somewhere"} />}
        {open && !asking && (
          <button
            onClick={() => void join()}
            disabled={!canJoin}
            title={canJoin ? "Take the free chair" : "You already have a seat somewhere"}
            className="btn-gold shrink-0"
          >
            Take a seat
          </button>
        )}
      </div>
      {open && asking && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
          className="flex items-center gap-2"
        >
          <input
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={40}
            autoComplete="off"
            placeholder="The word at the door"
            aria-label={`Password for ${room.name}`}
            className="tool-field min-w-0 flex-1 !py-1.5 text-[15px]"
          />
          <button type="submit" disabled={!canJoin || !password} className="btn-gold shrink-0">
            Sit
          </button>
          <button
            type="button"
            onClick={() => {
              setAsking(false);
              setPassword("");
            }}
            aria-label="Cancel"
            className="btn-ghost shrink-0 !px-2.5"
          >
            <Cross width={16} height={16} />
          </button>
        </form>
      )}
    </li>
  );
}
