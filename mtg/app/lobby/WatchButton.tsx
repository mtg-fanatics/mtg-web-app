"use client";

import { useState } from "react";
import { spectateRoom } from "@/lib/online/session";
import { Eye } from "../Icons";

/**
 * "Watch": join a match as a spectator. Free in an open match; in a locked one the password box opens first.
 * Used by the list of rooms and by the friends list. When it works, the lobby takes the browser to the match.
 */
export default function WatchButton({
  roomId,
  name,
  locked,
  disabled = false,
  title,
}: {
  roomId: string;
  name: string;
  locked: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    const ok = await spectateRoom(roomId, locked ? password : undefined); // a refusal (wrong password...) shows in the message under the lists
    setBusy(false);
    if (ok) {
      setAsking(false);
      setPassword("");
    }
  }

  if (asking) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (password) void go();
        }}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <input
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={40}
          autoComplete="off"
          placeholder="Password to watch"
          aria-label={`Password to watch ${name}`}
          className="tool-field min-w-0 flex-1 !py-1.5 text-[15px]"
        />
        <button
          type="submit"
          disabled={busy || !password}
          className="btn-gold shrink-0"
        >
          {busy ? "…" : "Watch"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAsking(false);
            setPassword("");
          }}
          aria-label="Cancel"
          className="btn-ghost shrink-0 !px-2.5 !text-base leading-none"
        >
          ×
        </button>
      </form>
    );
  }

  return (
    <button
      onClick={() => (locked ? setAsking(true) : void go())}
      disabled={disabled || busy}
      title={
        title ??
        (locked ? "Watch this match (it needs a password)" : "Watch this match")
      }
      className="btn-ghost shrink-0"
      aria-label={`Watch ${name}`}
    >
      <Eye width={15} height={15} />
      Watch{locked && <span aria-hidden="true"> 🔒</span>}
    </button>
  );
}
