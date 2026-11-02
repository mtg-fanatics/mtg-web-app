"use client";

import { useEffect, useState } from "react";
import { Cross, Padlock, Quill } from "../Icons";

/** Before a room is opened: open to anyone, or locked with a password. */
export default function CreateRoomDialog({ busy, ready, error, onCreate, onClose }: { busy: boolean; ready: boolean; error: string | null; onCreate: (password: string) => void; onClose: () => void }) {
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const missing = locked && password.trim() === "";
  return (
    <div role="dialog" aria-modal="true" aria-label="Open a table" className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing) onCreate(locked ? password : "");
        }}
        className="leather flex w-full max-w-md flex-col gap-4 p-6 text-white sm:p-7"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-3xl text-[#e8dcc0]"><Quill width={26} height={26} className="ink-icon text-[#d9694f]" />Open a table</h2>
            <p className="italic-note mt-1 text-[17px] text-slate-300">Set the cloth. A friend pulls up a chair, or the clockwork opponent takes the other seat.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-ghost !h-10 !w-10 !px-0">
            <Cross width={18} height={18} />
          </button>
        </header>

        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Who may sit down</legend>
          {[
            { value: false, title: "An open table", text: "Anyone who walks past may take the other chair." },
            { value: true, title: "A locked table", text: "Only those who know the word at the door may sit." },
          ].map((o) => (
            <label key={String(o.value)} className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3 ${locked === o.value ? "border-[#d9694f] bg-[#b3392b]/20" : "border-[#c8b28a]/30 bg-white/5 hover:bg-white/10"}`}>
              <input type="radio" name="room-lock" checked={locked === o.value} onChange={() => setLocked(o.value)} className="mt-1 h-4 w-4 accent-[#b3392b]" />
              <span>
                <span className="flex items-center gap-1.5 font-bold">{o.value && <Padlock width={16} height={16} />}{o.title}</span>
                <span className="block text-sm text-slate-300">{o.text}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {locked && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[15px] font-bold text-slate-200">The word at the door</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={40}
              autoFocus
              autoComplete="off"
              placeholder="Pick a word"
              aria-label="Room password"
              className="auth-input"
            />
          </label>
        )}

        {error && (
          <p role="alert" className="rounded-lg border-2 border-[#b3392b] bg-[#b3392b]/20 px-3 py-2 text-[15px] text-[#f0bfb0]">
            {error}
          </p>
        )}
        {!ready && <p className="italic-note text-[15px] text-[#d8c8a2]">Waking the innkeeper…</p>}

        <button type="submit" disabled={!ready || busy || missing} aria-busy={busy} className="btn-gold !w-full !py-3 !text-lg">
          {busy ? "Laying the cloth…" : locked ? "Set a locked table" : "Set the table"}
        </button>
      </form>
    </div>
  );
}
