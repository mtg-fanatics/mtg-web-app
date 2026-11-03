"use client";

import { clipName } from "@/lib/profile";

import { useEffect, useMemo, useRef, useState } from "react";
import { playSound } from "@/lib/sound";
import { acceptRequest, displayName, listLinks, removeLink } from "@/lib/friends";
import type { Link, Person } from "@/lib/friends";
import { dismissCameOnline, dismissInvite, inviteFriend, joinRoom, liveInvites, useOnline } from "@/lib/online/session";
import { Handbell } from "../Icons";

const REFRESH_MS = 15_000; // how often to look for new friend requests
const TOAST_MS = 8000;

type Item =
  | { key: string; kind: "invite"; roomId: string; from: string; fromId: string; roomName: string; locked: boolean }
  | { key: string; kind: "request"; rowId: string; person: Person }
  | { key: string; kind: "online"; person: Person };

function Face({ person }: { person: { username: string; nickname: string | null; avatar: string | null } }) {
  return person.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={person.avatar} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/30" />
  ) : (
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600 text-sm font-extrabold text-black">
      {displayName(person).slice(0, 1).toUpperCase()}
    </span>
  );
}

const iconProps = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/**
 * A bell beside the profile button. It collects what needs the player's attention: friends asking to be friends, friends
 * who just came online (with a way to invite them to a match), and invitations to a friend's match.
 */
export default function NotificationBell({ meId, meName }: { meId: string; meName: string }) {
  const online = useOnline();
  const [links, setLinks] = useState<Link[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [toastGone, setToastGone] = useState<string | null>(null);
  const drag = useRef<{ x: number; dx: number } | null>(null); // a finger on the toast: where it started, how far it moved
  const [sent, setSent] = useState<Set<string>>(new Set()); // friends invited from here
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const [loaded, setLoaded] = useState(false); // the friend requests have been looked up at least once
  const heard = useRef<Set<string> | null>(null); // the notifications already known, so only a new one makes a sound
  const [version, setVersion] = useState(0); // bumped after accepting or declining, to look again at once
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listLinks(meId)
        .then((l) => alive && (setLinks(l), setLoaded(true)))
        .catch(() => undefined); // friends are not set up, or the network is down: no requests to show
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [meId, version]);

  // the panel closes on a click outside it, or Esc
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const friends = useMemo(() => new Map(links.filter((l) => l.relation === "friend").map((l) => [l.person.id, l.person])), [links]);

  const items: Item[] = [
    ...liveInvites(online.invites).map((i): Item => {
      const known = friends.get(i.fromId);
      return { key: `invite:${i.roomId}:${i.fromId}:${i.at}`, kind: "invite", roomId: i.roomId, from: known ? displayName(known) : i.from, fromId: i.fromId, roomName: i.roomName, locked: i.locked };
    }),
    ...links.filter((l) => l.relation === "incoming").map((l): Item => ({ key: `request:${l.rowId}`, kind: "request", rowId: l.rowId, person: l.person })),
    ...Object.entries(online.cameOnline).flatMap(([id, at]): Item[] => {
      const person = friends.get(id);
      return person ? [{ key: `online:${id}:${at}`, kind: "online", person }] : [];
    }),
  ];
  const unseen = items.filter((i) => !seen.has(i.key));

  // a sound for each new notification (not for the ones already waiting when the page opened)
  useEffect(() => {
    if (!loaded) return;
    const keys = items.map((i) => i.key);
    if (heard.current === null) {
      heard.current = new Set(keys);
      return;
    }
    const fresh = keys.filter((k) => !heard.current!.has(k));
    keys.forEach((k) => heard.current!.add(k));
    if (fresh.length > 0) playSound("notify");
  });

  // the tab says how many are new, so it can be noticed from another tab: "(2) Inkfall"
  const count = unseen.length;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [count]);
  const newest = unseen[0];

  // a small bubble says what just arrived, for a few seconds
  const newestKey = newest?.key;
  useEffect(() => {
    if (!newestKey) return;
    const timer = setTimeout(() => setToastGone(newestKey), TOAST_MS);
    return () => clearTimeout(timer);
  }, [newestKey]);

  const summary = (i: Item) =>
    i.kind === "invite" ? `${i.from} invited you to a match` : i.kind === "request" ? `${displayName(i.person)} sent you a friend request` : `Your friend ${displayName(i.person)} is online`;

  function toggle() {
    if (!open) setSeen(new Set(items.map((i) => i.key))); // opening the panel reads everything in it
    setOpen(!open);
  }

  async function run(key: string, job: () => Promise<unknown>) {
    setBusy(key);
    try {
      await job();
    } finally {
      setBusy(null);
    }
  }

  const inRoom = online.snapshot !== null;

  return (
    <div ref={box} className="relative">
      <button
        onClick={toggle}
        aria-label={unseen.length > 0 ? `Notifications: ${unseen.length} new` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
        className="relative grid h-[60px] w-[60px] place-items-center rounded-2xl border border-white/25 bg-slate-950/55 text-white shadow-xl shadow-black/40 ring-1 ring-inset ring-white/10 transition hover:-translate-y-0.5 hover:bg-slate-900/70"
      >
        <Handbell width={26} height={26} className={`ink-icon ${unseen.length > 0 ? "text-[#d9694f]" : ""}`} />
        {unseen.length > 0 && (
          <span className="absolute -right-2 -top-2 grid h-6 min-w-6 place-items-center">
            <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-red-500/60" />
            <span className="relative grid h-6 min-w-6 place-items-center rounded-full bg-red-500 px-1.5 text-[13px] font-extrabold leading-none text-white shadow-lg ring-2 ring-slate-950">
              {unseen.length > 9 ? "9+" : unseen.length}
            </span>
          </span>
        )}
      </button>

      {newest && !open && toastGone !== newest.key && (
        <div
          role="status"
          style={{ touchAction: "pan-y" }}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, dx: 0 };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            d.dx = e.clientX - d.x;
            e.currentTarget.style.transform = `translateX(${d.dx}px)`;
            e.currentTarget.style.opacity = String(1 - Math.min(1, Math.abs(d.dx) / 220));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (!d) return;
            if (Math.abs(d.dx) > 60 || Math.abs(d.dx) < 6) setToastGone(newest.key); // swiped away, or tapped
            else {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.opacity = "";
            }
          }}
          onPointerCancel={(e) => ((drag.current = null), (e.currentTarget.style.transform = ""), (e.currentTarget.style.opacity = ""))}
          className="absolute left-0 top-full z-30 mt-2 w-max max-w-[18rem] cursor-pointer select-none max-md:fixed max-md:inset-x-3 max-md:top-14 max-md:mt-0 max-md:w-auto max-md:max-w-none rounded-xl border border-amber-300/60 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-amber-100 shadow-xl shadow-black/40">
          🔔 {summary(newest)}
        </div>
      )}

      {open && (
        <div role="dialog" aria-label="Notifications" className="panel-glass absolute left-0 top-full z-30 mt-2 flex max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] max-md:fixed max-md:inset-x-3 max-md:top-14 max-md:mt-0 max-md:w-auto flex-col gap-2 overflow-y-auto p-3 text-white">
          <h2 className="px-1 font-title text-xs font-extrabold uppercase tracking-[0.2em] text-[#e8dcc0]">Messages</h2>
          {items.length === 0 && <p className="empty-note px-1 py-3 text-center text-[15px]">No letters tonight.</p>}
          {items.map((i) => (
            <div key={i.key} className="flex items-start gap-3 rounded-xl border border-white/15 bg-white/[0.06] p-2.5">
              {i.kind === "invite" ? (
                <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-500/30 text-lg ring-1 ring-violet-300/50">
                  ⚔
                </span>
              ) : (
                <Face person={i.person} />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-snug">
                  {i.kind === "invite" && (
                    <>
                      <b>{i.from}</b> invited you to a match{i.locked ? " (no password needed)" : ""}.
                    </>
                  )}
                  {i.kind === "request" && (
                    <>
                      <b>{displayName(i.person)}</b> sent you a friend request.
                    </>
                  )}
                  {i.kind === "online" && (
                    <>
                      Your friend <b>{displayName(i.person)}</b> is online. Invite them to a match?
                    </>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {i.kind === "invite" && (
                    <>
                      <button
                        disabled={busy === i.key || inRoom}
                        title={inRoom ? "Leave your current table first" : undefined}
                        onClick={() => void run(i.key, async () => ((await joinRoom(i.roomId)) ? setOpen(false) : undefined))}
                        className="btn-gold !px-3 !py-1.5"
                      >
                        Join match
                      </button>
                      <button onClick={() => dismissInvite(i.roomId)} className="btn-ghost !px-3 !py-1.5">
                        Not now
                      </button>
                    </>
                  )}
                  {i.kind === "request" && (
                    <>
                      <button disabled={busy === i.key} onClick={() => void run(i.key, async () => (await acceptRequest(i.rowId), refresh()))} className="btn-gold !px-3 !py-1.5">
                        Accept
                      </button>
                      <button disabled={busy === i.key} onClick={() => void run(i.key, async () => (await removeLink(i.rowId), refresh()))} className="btn-ghost !px-3 !py-1.5">
                        Decline
                      </button>
                    </>
                  )}
                  {i.kind === "online" && (
                    <>
                      {online.friends[i.person.id]?.match ? (
                        <span className="self-center text-sm text-slate-300">They are in a match right now.</span>
                      ) : (
                        <button
                          disabled={busy === i.key || sent.has(i.person.id)}
                          onClick={() => void run(i.key, async () => ((await inviteFriend(i.person.id, `${clipName(meName)}'s room`)) ? setSent((s) => new Set(s).add(i.person.id)) : undefined))}
                          className="btn-gold !px-3 !py-1.5"
                        >
                          {sent.has(i.person.id) ? "Invitation sent ✓" : "Invite to a match"}
                        </button>
                      )}
                      <button onClick={() => dismissCameOnline(i.person.id)} className="btn-ghost !px-3 !py-1.5">
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {online.error && (
            <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-[#f0bfb0]">
              {online.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
