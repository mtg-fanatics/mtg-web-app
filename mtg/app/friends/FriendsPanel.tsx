"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useCached, writeCached } from "@/lib/dashCache";
import { holdWallpaper } from "../LiveWallpaper";
import { RowSkeletons } from "../Skeleton";
import {
  acceptRequest,
  displayName,
  listLinks,
  NotSetUp,
  removeLink,
  searchPeople,
  sendRequest,
} from "@/lib/friends";
import type { Link, Person } from "@/lib/friends";
import { loadMe, clipName } from "@/lib/profile";
import { inviteFriend, useOnline, watchFriends } from "@/lib/online/session";
import type { FriendStatus } from "@/lib/online/protocol";
import WatchButton from "../lobby/WatchButton";
import { Chev, Lens, Minus, Plus } from "../Icons";

const icon = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** A round picture, or the first letter of the name. A picture that can't be loaded falls back to the letter. */
function Face({ person, size = 36 }: { person: Person; size?: number }) {
  const [broken, setBroken] = useState(false);
  const name = displayName(person);
  return person.avatar && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={person.avatar}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full object-cover ring-2 ring-white/30"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-600 font-extrabold text-black ring-2 ring-white/30"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Online / offline / in a room / playing: the words, and the color of the dot on the friend's picture. */
function describe(st: FriendStatus | undefined): { text: string; dot: string } {
  if (!st || !st.online) return { text: "Offline", dot: "#64748b" };
  if (st.match?.status === "playing")
    return {
      text: st.match.bot ? "Dueling the clockwork" : "In a match",
      dot: "#d9694f",
    };
  if (st.match) return { text: "At a table", dot: "#d9694f" };
  return { text: "Online", dot: "#6b9a7f" };
}

function Names({ person, line }: { person: Person; line?: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[15px] font-bold leading-tight">
        {displayName(person)}
      </span>
      {person.nickname && (
        <span className="block truncate text-xs text-slate-300">
          @{person.username}
        </span>
      )}
      {line && (
        <span className="block truncate text-xs font-semibold text-slate-200">
          {line}
        </span>
      )}
    </span>
  );
}

/** Under the profile chip: your friends, the requests waiting for you, and a way to find more people. */
export default function FriendsPanel() {
  const [me, setMe] = useState<string | null>(null);
  const [meName, setMeName] = useState("Player"); // names the room an invitation opens
  const [invited, setInvited] = useState<string[]>([]); // friends invited a moment ago
  const [inviting, setInviting] = useState<string | null>(null);
  const [links, setLinks] = useState<Link[] | null>(null);
  const cachedLinks = useCached<Link[]>("friends"); // the list as it was last time: shown at once while the fresh one loads
  const shown = links ?? cachedLinks;
  const [problem, setProblem] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  // wide screens show the list; on a small screen it starts folded, so the page isn't pushed down (until the player opens it)
  const wide = useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(min-width: 1280px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1280px)").matches,
    () => true,
  );
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [sheet, setSheet] = useState(false); // a phone: the list is a pop-up, opened from the button beside the bell
  const open = sheet || (chosen ?? wide);
  useEffect(() => {
    const show = () => setSheet(true);
    window.addEventListener("mtg-open-friends", show);
    return () => window.removeEventListener("mtg-open-friends", show);
  }, []);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null); // a friend about to be removed
  const net = useOnline();

  const load = useCallback(async (id: string) => {
    try {
      const fresh = await listLinks(id);
      setLinks(fresh);
      writeCached("friends", fresh);
      setProblem(null);
      setSetup(false);
    } catch (e) {
      if (e instanceof NotSetUp) setSetup(true);
      else
        setProblem(
          e instanceof Error ? e.message : "Could not load your friends.",
        );
      setLinks((l) => l ?? []);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void loadMe().then((m) => {
      if (!alive || !m) return;
      setMe(m.id);
      setMeName(m.nickname ?? m.name);
      void load(m.id);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // new requests show up without a reload
  useEffect(() => {
    if (!me || setup) return;
    const again = () => !document.hidden && void load(me);
    const timer = setInterval(again, 30_000);
    window.addEventListener("focus", again);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", again);
    };
  }, [me, setup, load]);

  // the server answers about these friends (and counts this player as online while asking)
  const friendKey = (shown ?? [])
    .filter((l) => l.relation === "friend")
    .map((l) => l.person.id)
    .join(",");
  useEffect(() => {
    watchFriends(friendKey ? friendKey.split(",") : []);
  }, [friendKey]);

  const friends = (shown ?? []).filter((l) => l.relation === "friend");
  const incoming = (shown ?? []).filter((l) => l.relation === "incoming");
  const outgoing = (shown ?? []).filter((l) => l.relation === "outgoing");

  /** "Invite to match": opens a room (or uses the one this player waits in) and sends the friend an invitation. */
  async function invite(friendId: string) {
    setInviting(friendId);
    try {
      if (await inviteFriend(friendId, `${clipName(meName)}'s room`)) {
        setInvited((list) => [...list, friendId]);
        setTimeout(() => setInvited((list) => list.filter((id) => id !== friendId)), 6000);
      }
    } finally {
      setInviting(null);
    }
  }

  async function act(job: () => Promise<void>) {
    if (!me) return; // still finding out who this is
    setProblem(null);
    try {
      await job();
      await load(me);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not work.");
    }
  }

  return (
    <>
      {sheet && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setSheet(false)} aria-hidden="true" />}
      <section
        aria-label="Friends"
        className={`panel-glass z-10 flex w-full max-w-[20rem] flex-col gap-2.5 self-start p-3.5 text-white ${
          sheet ? "max-md:fixed max-md:inset-x-3 max-md:top-14 max-md:z-50 max-md:max-h-[80dvh] max-md:w-auto max-md:!max-w-none max-md:overflow-y-auto max-md:!bg-[#0b1020] max-md:!backdrop-blur-none" : "max-md:hidden"
        } xl:fixed xl:left-4 xl:top-[7.6rem] xl:max-h-[calc(100dvh-9rem)]`}
      >
        <header className="flex items-center gap-2">
          <button
            onClick={() => setChosen(!open)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Chev width={16} height={16} className={`ink-icon transition ${open ? "rotate-90" : ""}`} />
            <h2 className="font-title text-xl text-[#e8dcc0]">
              Your company
            </h2>
            <span className="count-chip !px-2 !py-0.5 !text-xs">
              {friends.length}
            </span>
            {incoming.length > 0 && (
              <span
                className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-extrabold text-white"
                title="Friend requests waiting for you"
              >
                {incoming.length} new
              </span>
            )}
          </button>
          <button
            onClick={() => setAdding(true)}
            className="btn-gold !px-3 !py-1.5"
            aria-label="Add or search for friends"
            disabled={setup}
          >
            <Plus width={14} height={14} />
            Find
          </button>
          {sheet && (
            <button onClick={() => setSheet(false)} aria-label="Close the friends list" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-2xl leading-none md:hidden">
              ×
            </button>
          )}
        </header>

        {open && (
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5">
            {setup && (
              <p className="empty-note text-sm">
                Friends are not set up yet. Run <b>supabase/05-friends.sql</b>{" "}
                once in the Supabase SQL editor.
              </p>
            )}
            {problem && (
              <p
                role="alert"
                className="rounded-xl border border-red-400/40 bg-red-950/50 px-3 py-2 text-sm text-[#f0bfb0]"
              >
                {problem}
              </p>
            )}
            {shown === null && (
              <RowSkeletons
                count={3}
                className="h-[46px]"
                gap="gap-1.5"
                label="Loading friends"
              />
            )}

            {incoming.length > 0 && (
              <>
                <h3 className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-300">
                  Requests
                </h3>
                {incoming.map((l) => (
                  <div
                    key={l.rowId}
                    className="deck-row !gap-2 !px-3 !py-2"
                    style={{ "--accent": "#d9694f" } as React.CSSProperties}
                  >
                    <Face person={l.person} size={32} />
                    <Names person={l.person} />
                    <button
                      onClick={() => void act(() => acceptRequest(l.rowId))}
                      className="btn-gold !px-2.5 !py-1"
                      aria-label={`Accept ${displayName(l.person)}`}
                      title="Accept"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => void act(() => removeLink(l.rowId))}
                      className="btn-danger !px-2.5 !py-1"
                      aria-label={`Decline ${displayName(l.person)}`}
                      title="Decline"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </>
            )}

            {friends.length === 0 &&
              links !== null &&
              !setup &&
              incoming.length === 0 && (
                <div className="empty-note !py-4 text-sm">
                  Nobody has pulled up a chair yet.
                  <br />
                  <button
                    onClick={() => setAdding(true)}
                    className="mt-1 font-semibold text-[#e8dcc0] underline"
                  >
                    Go looking for company
                  </button>
                </div>
              )}

            {friends.map((l) => (
              <div
                key={l.rowId}
                className="deck-row !gap-2 !px-3 !py-2"
                style={{ "--accent": "#6b9a7f" } as React.CSSProperties}
              >
                <span className="relative shrink-0">
                  <Face person={l.person} size={34} />
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-slate-900"
                    style={{
                      background: describe(net.friends[l.person.id]).dot,
                    }}
                  />
                </span>
                <Names
                  person={l.person}
                  line={describe(net.friends[l.person.id]).text}
                />
                {confirming !== l.rowId && net.friends[l.person.id]?.online && !net.friends[l.person.id]?.match && (
                  <button
                    onClick={() => void invite(l.person.id)}
                    disabled={inviting === l.person.id || invited.includes(l.person.id)}
                    className="btn-gold !px-3 !py-1 !text-xs"
                    title={`Invite ${displayName(l.person)} to a match: opens a room and sends the invitation`}
                    aria-label={`Invite ${displayName(l.person)} to match`}
                  >
                    {invited.includes(l.person.id) ? "Invited ✓" : inviting === l.person.id ? "…" : "Invite"}
                  </button>
                )}
                {confirming === l.rowId ? (
                  <>
                    <button
                      onClick={() => (
                        setConfirming(null),
                        void act(() => removeLink(l.rowId))
                      )}
                      className="btn-danger !px-2.5 !py-1"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="btn-ghost !px-2.5 !py-1"
                      aria-label="Keep this friend"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirming(l.rowId)}
                    className="btn-ghost !px-2 !py-1 opacity-60 hover:opacity-100"
                    aria-label={`Remove ${displayName(l.person)} from your friends`}
                    title="Remove friend"
                  >
                    <Minus width={14} height={14} />
                  </button>
                )}
                {net.friends[l.person.id]?.match?.status === "playing" && (
                  <div className="flex basis-full flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                      {net.friends[l.person.id]!.match!.players.join(" vs ")}
                      {net.friends[l.person.id]!.match!.spectators > 0
                        ? ` · 👁 ${net.friends[l.person.id]!.match!.spectators}`
                        : ""}
                    </span>
                    <WatchButton
                      roomId={net.friends[l.person.id]!.match!.roomId}
                      name={net.friends[l.person.id]!.match!.name}
                      locked={net.friends[l.person.id]!.match!.locked}
                      disabled={net.snapshot !== null}
                      title={
                        net.snapshot !== null
                          ? "You already have a seat somewhere"
                          : undefined
                      }
                    />
                  </div>
                )}
              </div>
            ))}

            {outgoing.length > 0 && (
              <>
                <h3 className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-300">
                  Sent
                </h3>
                {outgoing.map((l) => (
                  <div
                    key={l.rowId}
                    className="deck-row !gap-2 !px-3 !py-2"
                    style={{ "--accent": "#94a3b8" } as React.CSSProperties}
                  >
                    <Face person={l.person} size={30} />
                    <Names person={l.person} />
                    <span className="chip chip-meta">Waiting</span>
                    <button
                      onClick={() => void act(() => removeLink(l.rowId))}
                      className="btn-ghost !px-2 !py-1"
                      aria-label={`Cancel the request to ${displayName(l.person)}`}
                      title="Cancel request"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </section>

      {adding && me && (
        <AddFriends
          me={me}
          links={shown ?? []}
          onChanged={() => load(me)}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

/** The search pop-up: type a name, then ask, accept or see where you stand with each person. */
function AddFriends({
  me,
  links,
  onChanged,
  onClose,
}: {
  me: string;
  links: Link[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => holdWallpaper(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [text, setText] = useState("");
  const [found, setFound] = useState<{ q: string; list: Person[] } | null>(
    null,
  ); // the answer, with the text it was for
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const latest = useRef(0);

  const q = text.trim();
  const short = q.length < 2;
  const people = !short && found?.q === q ? found.list : null; // null: still waiting for this text's answer

  useEffect(() => {
    if (q.length < 2) return;
    const run = ++latest.current;
    const timer = setTimeout(() => {
      searchPeople(me, q)
        .then(
          (list) =>
            run === latest.current && (setFound({ q, list }), setProblem(null)),
        )
        .catch((e: Error) => run === latest.current && setProblem(e.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, me]);

  const linkOf = (id: string) => links.find((l) => l.person.id === id);

  async function ask(p: Person) {
    setBusy(p.id);
    setProblem(null);
    try {
      await sendRequest(me, p.id);
      await onChanged();
    } catch (e) {
      setProblem(
        e instanceof Error ? e.message : "Could not send the request.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function accept(l: Link) {
    setBusy(l.person.id);
    try {
      await acceptRequest(l.rowId);
      await onChanged();
    } catch (e) {
      setProblem(
        e instanceof Error ? e.message : "Could not accept the request.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add friends"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 p-4 pt-[14vh]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel-glass flex max-h-[76dvh] w-full max-w-lg flex-col gap-4 p-5 text-white"
      >
        <header className="flex items-center gap-3">
          <h2 className="page-title !text-2xl">Find friends</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost ml-auto !px-3 !text-lg leading-none"
          >
            ×
          </button>
        </header>
        <label className="tool-field !rounded-2xl !py-3">
          <Lens />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={40}
            autoComplete="off"
            placeholder="Search by name or nickname"
            aria-label="Search for a player"
            className="w-full"
          />
        </label>

        {problem && (
          <p
            role="alert"
            className="rounded-xl border border-red-400/40 bg-red-950/50 px-3 py-2 text-sm text-[#f0bfb0]"
          >
            {problem}
          </p>
        )}

        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5">
          {short && (
            <p className="empty-note text-sm">
              Type at least two letters of a player&apos;s name.
            </p>
          )}
          {!short && people === null && !problem && (
            <RowSkeletons
              count={3}
              className="h-[56px]"
              gap="gap-2"
              label="Searching"
            />
          )}
          {people !== null && people.length === 0 && (
            <p className="empty-note text-sm">
              No players found with that name.
            </p>
          )}
          {people?.map((p) => {
            const link = linkOf(p.id);
            return (
              <div
                key={p.id}
                className="deck-row !gap-3 !px-3 !py-2.5"
                style={
                  {
                    "--accent":
                      link?.relation === "friend" ? "#6b9a7f" : "#d9694f",
                  } as React.CSSProperties
                }
              >
                <Face person={p} size={38} />
                <Names person={p} />
                {link?.relation === "friend" ? (
                  <span className="chip chip-ok">Keeps your company</span>
                ) : link?.relation === "outgoing" ? (
                  <span className="chip chip-meta">Request sent</span>
                ) : link?.relation === "incoming" ? (
                  <button
                    onClick={() => void accept(link)}
                    disabled={busy === p.id}
                    className="btn-gold"
                  >
                    Accept
                  </button>
                ) : (
                  <button
                    onClick={() => void ask(p)}
                    disabled={busy === p.id}
                    className="btn-gold"
                  >
                    {busy === p.id ? "Sealing the letter…" : "Send word"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
