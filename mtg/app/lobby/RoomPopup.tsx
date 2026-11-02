"use client";

import { useEffect } from "react";
import { holdWallpaper } from "../LiveWallpaper";
import { leaveRoom, send } from "@/lib/online/session";
import type { RoomSnapshot } from "@/lib/online/protocol";
import { Cross } from "../Icons";

// the two seats are two wax seals: moss for the one who set the table, wax red for the guest
const SEAT_COLOR = { p1: "bg-[#4f7a62]", p2: "bg-[#b3392b]" } as const;

/** The pop-up shown to everyone in a room: the room's name and host, who is in, and (for the host) the Vote button. */
export default function RoomPopup({ room }: { room: RoomSnapshot }) {
  useEffect(() => holdWallpaper(), []);

  const iAmHost = room.you === room.host;
  const host = room.players.find((p) => p.seat === room.host);
  const full = room.players.length === 2;
  const votes = room.players.map((p) => p.voted);
  const agreed = full && votes.every((v) => v !== null) && new Set(votes).size === 1;
  const MODES = [1, 3, 5] as const;
  const modeName = (n: number) => (n === 1 ? "One game" : `Best of ${n}`);
  const mine = room.players.find((p) => p.seat === room.you)?.voted ?? null;
  const status = !full
    ? "Mark how long you'll play. Whoever sits down next marks theirs."
    : agreed
      ? `Settled: ${modeName(votes[0] as number).toLowerCase()}.`
      : votes.every((v) => v === null)
        ? "Each of you marks how long to play."
        : votes.some((v) => v === null)
          ? `Still waiting on ${room.players.filter((p) => p.voted === null).map((p) => p.name).join(" and ")}.`
          : "You marked different lengths. Settle on one to go on.";

  return (
    <div role="dialog" aria-modal="true" aria-label={`Room ${room.name}`} className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="leather flex w-full max-w-xl flex-col gap-5 p-7 text-white">
        {/* the room's name and its host */}
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="caps text-slate-300">The table</p>
            <h2 className="truncate text-4xl text-[#e8dcc0]">{room.name}</h2>
            <p className="mt-1 text-[16px] text-slate-200">
              Set by <span className="font-bold text-[#e8d9b5]">{host?.name ?? "…"}</span>
              {iAmHost && <span className="ml-1 text-slate-300">(that&apos;s you)</span>}
            </p>
            {room.locked && <p className="italic-note mt-0.5 text-[15px] text-slate-300">There is a word at the door.</p>}
          </div>
          <button
            onClick={() => leaveRoom()}
            aria-label={iAmHost ? "Pack up the table" : "Leave the table"}
            title={iAmHost ? "Pack up the table" : "Leave the table"}
            className="btn-ghost !h-10 !w-10 !px-0"
          >
            <Cross width={18} height={18} />
          </button>
        </header>

        {/* the players */}
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Players">
          {(["p1", "p2"] as const).map((seat) => {
            const p = room.players.find((x) => x.seat === seat);
            return (
              <div key={seat} className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 ${p ? "border-[#120c07] bg-[#3a2d21]" : "border-dashed border-[#c8b28a]/40 bg-white/5"}`}>
                <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[46%_54%_50%_50%] border-2 border-[#120c07] font-title text-2xl text-[#e8dcc0] shadow-md ${p ? SEAT_COLOR[seat] : "bg-white/10"}`}>
                  {p ? (p.bot ? "⚙" : p.name.charAt(0).toUpperCase()) : "?"}
                  {p?.avatar && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
                  )}
                </div>
                <div className="min-w-0">
                  {p ? (
                    <>
                      <div className="truncate text-lg font-bold">{p.bot ? "The Clockwork" : p.name}</div>
                      <div className="text-sm text-slate-300">
                        {p.bot ? "A tin opponent" : seat === room.host ? "Set the table" : "Guest"}
                        {p.seat === room.you ? " · you" : ""}
                        {p.bot && iAmHost && (
                          <button onClick={() => send("removeBot")} className="ml-2 underline hover:text-white">
                            send it off
                          </button>
                        )}
                      </div>
                    </>
                  ) : iAmHost ? (
                    <>
                      <div className="italic-note text-lg text-slate-200">An empty chair</div>
                      <button onClick={() => send("addBot")} className="btn-ghost mt-1 !whitespace-normal !px-3 !py-1 !text-left !leading-tight">
                        Seat the clockwork
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="italic-note text-lg text-slate-200">An empty chair</div>
                      <div className="text-sm text-slate-300">for whoever arrives</div>
                    </>
                  )}
                </div>
                {p && iAmHost && seat !== room.host && !p.bot && <KickButton name={p.name} />}
              </div>
            );
          })}
        </section>

        {/* the game mode: both players vote, and they have to agree */}
        <section aria-label="Game mode" className="flex flex-col gap-2">
          <h3 className="text-xl text-[#e8dcc0]">How long will you play?</h3>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((n) => (
              <button
                key={n}
                onClick={() => send("format", { bestOf: n })}
                aria-pressed={mine === n}
                className={mine === n ? "paper !px-2 !py-2.5 text-[16px] font-extrabold" : "btn-ghost !px-2 !py-2.5 !text-[16px]"}
              >
                {modeName(n)}
              </button>
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-200">
            {room.players.map((p) => (
              <li key={p.seat}>
                <span className="font-semibold">{p.name}</span>: {p.voted === null ? "hasn’t marked one yet" : modeName(p.voted).toLowerCase()}
              </li>
            ))}
          </ul>
          <p className={`italic-note text-[16px] ${agreed ? "text-[#a9d4b9]" : "text-[#e8d9b5]"}`}>{status}</p>
        </section>

        {/* only the host moves the room on to choosing decks */}
        <footer className="flex flex-col items-center gap-2">
          {iAmHost ? (
            <>
              <button
                onClick={() => send("startVote")}
                disabled={!full || !agreed}
                className="btn-gold !w-full !px-8 !py-3 !text-lg sm:!w-auto"
              >
                Pick your decks
              </button>
              <p className="text-sm text-slate-300">{!full ? "Waits for a second player, or seat the clockwork opponent." : agreed ? "Each of you brings a deck of sixty cards." : "Opens once you both mark the same length."}</p>
            </>
          ) : (
            <p className="italic-note rounded-lg bg-white/10 px-4 py-2 text-[16px] text-slate-100">{host?.name ?? "Whoever set the table"} will call for decks when you are both ready.</p>
          )}
        </footer>
      </div>
    </div>
  );
}

/** The host removes the guest. The guest can't join this room again. */
export function KickButton({ name }: { name: string }) {
  return (
    <button
      onClick={() => send("kick")}
      title={`Show ${name} the door. They can't sit at this table again.`}
      className="btn-danger ml-auto shrink-0 !px-3 !py-1"
    >
      Show the door
    </button>
  );
}
