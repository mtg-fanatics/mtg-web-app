"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clipName, useShownName } from "@/lib/profile";
import { connectLobby, createRoom, disconnectLobby, tryReconnect, useOnline } from "@/lib/online/session";
import { Skeleton } from "../Skeleton";
import LiveMatches from "./LiveMatches";
import RoomPopup from "./RoomPopup";
import VotePopup from "./VotePopup";
import CreateRoomDialog from "./CreateRoomDialog";

const ASIDE = "z-10 order-last flex w-full max-w-md flex-col gap-3 xl:order-none xl:fixed xl:right-12 xl:top-[6.2rem] xl:w-[min(24rem,calc(100vw-2rem))] xl:max-w-none";

/** The live matches panel and the Create room button, in their shapes, until it is known who is signed in. */
function LobbySkeleton() {
  return (
    <aside role="status" aria-label="Loading the live matches" className={ASIDE}>
      <div className="panel-glass flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-2.5 w-2.5 !rounded-full" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="ml-auto h-6 w-24 !rounded-full" />
        </div>
        <Skeleton className="h-[62px] !rounded-xl" />
        <Skeleton className="h-[62px] !rounded-xl" />
      </div>
      <Skeleton className="h-[52px] !rounded-2xl" />
      <Skeleton className="h-[56px] !rounded-2xl" />
    </aside>
  );
}

/**
 * The online side of the home page: the live matches (top right), the Create room button under them, and the pop-ups
 * that walk two players from an open room to the first turn.
 */
/** Off to the match screen. BackGuard is told first, so it does not undo the window's history entry while the screen is still on its way. */
function toMatch(router: ReturnType<typeof useRouter>) {
  window.dispatchEvent(new Event("ink:navigating"));
  router.push("/play/online");
}

export default function Lobby() {
  const router = useRouter();
  const online = useOnline();
  const [username, setUsername] = useState<string | null>(null);
  const shown = useShownName(); // the nickname (or the login name): what the room is called after
  const [creating, setCreating] = useState(false); // the "Create room" window is open
  const [opening, setOpening] = useState(false); // "Return to your match" was pressed and the match screen is on its way
  const room = online.snapshot;

  // Who am I? Then listen to the lobby for as long as this page is open.
  useEffect(() => {
    let alive = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!alive || !data.user) return;
        setUsername((data.user.user_metadata.username as string | undefined) ?? data.user.email?.split("@")[0] ?? "player");
        void connectLobby();
        void tryReconnect(); // a refreshed page goes back to the match it was in
      });
    return () => {
      alive = false;
      disconnectLobby();
    };
  }, []);

  // The Create room button on the home page: open the window (or, with a match going on, go back to it).
  const inMatch = room?.stage === "playing" || room?.stage === "over";
  const hasRoom = room !== null;
  useEffect(() => {
    if (inMatch) router.prefetch("/play/online"); // (the match screen is fetched while the button waits, so pressing it is quick)
  }, [inMatch, router]);
  useEffect(() => {
    const open = () => (inMatch ? toMatch(router) : hasRoom ? undefined : setCreating(true));
    window.addEventListener("mtg-create-room", open);
    return () => window.removeEventListener("mtg-create-room", open);
  }, [inMatch, hasRoom, router]);
  const [hadRoom, setHadRoom] = useState(hasRoom);
  if (hasRoom !== hadRoom) {
    setHadRoom(hasRoom);
    if (hasRoom) setCreating(false); // (the window has done its job: the room's own pop-up takes over)
  }

  // When the match begins, both players go to the play screen: once per match, as soon as both the room update and the game itself have arrived.
  const sent = useRef(false);
  useEffect(() => {
    const stage = room?.stage ?? null;
    if (stage !== "playing") {
      if (stage !== "over") sent.current = false; // a new match later may send them again
      return;
    }
    if (online.game && !sent.current) {
      sent.current = true;
      toMatch(router);
    }
  }, [room?.stage, online.game, router]);

  if (!username) return <LobbySkeleton />;

  return (
    <>
      <aside className={ASIDE}>
        <LiveMatches online={online} inRoom={room !== null} />

        {inMatch ? (
          <button
            onClick={() => {
              setOpening(true);
              toMatch(router);
              setTimeout(() => setOpening(false), 8000); // (if it has not opened by then, it can be pressed again)
            }}
            disabled={opening}
            aria-busy={opening}
            className="btn-live"
          >
            {opening ? "Opening the match…" : `▶ ${room?.spectating ? "Return to the match you are watching" : "Return to your match"}`}
          </button>
        ) : null}

        {online.reconnecting && (
          <p role="status" className="rounded-xl border border-amber-300/40 bg-slate-950/70 px-3 py-2 text-[15px] text-amber-100">
            ⟳ Reconnecting to your room…
          </p>
        )}
        {online.error && (
          <p role="alert" className="rounded-xl border border-red-300/40 bg-red-950/70 px-3 py-2 text-[15px] text-[#f0bfb0]">
            {online.error}
          </p>
        )}
      </aside>

      {creating && room === null && (
        <CreateRoomDialog
          busy={online.creating}
          ready={online.lobby === "on"}
          error={online.error}
          onClose={() => setCreating(false)}
          onCreate={(password) => {
            void createRoom(`${clipName(shown ?? username ?? "Player")}'s room`, password);
          }}
        />
      )}
      {room?.stage === "waiting" && <RoomPopup room={room} />}
      {room && (room.stage === "vote" || room.stage === "decks" || room.stage === "coin") && <VotePopup room={room} />}
    </>
  );
}
