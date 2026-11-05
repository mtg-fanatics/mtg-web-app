"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerId } from "@mtg/engine";
import { ChatPanel } from "./SidePanels";
import type { ChatMessage } from "./SidePanels";

const KEY = "inkfall.chat-bubble";
const TAP = 6; // px of travel before a press on the bubble is a drag and not a tap

/**
 * The chat on a phone: a small round button that floats over the battle, so nobody has to go into the menu to talk. Tap it and the messages open over the board, with the
 * box to write in; tap it again (or outside) and they fold away. A number on it says how many lines from the other player have not been read. It can be dragged out of the
 * way of whatever is under it, and it stays where it was put. While the keyboard is up the panel sits just above it.
 */
export default function ChatFloat({ messages, as, onSend }: { messages: ChatMessage[]; as: PlayerId; onSend: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(true); // the panel opens above the bubble when the bubble is in the lower half of the screen
  const [seen, setSeen] = useState(0);
  const [keyboard, setKeyboard] = useState(0);
  const bubble = useRef<HTMLButtonElement>(null);
  const offset = useRef({ x: 0, y: 0 });
  const drag = useRef<{ id: number; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const dragged = useRef(false); // the click that follows letting go of a drag is not a tap

  const place = () => {
    const el = bubble.current;
    if (el) el.style.transform = `translate(${offset.current.x}px, ${offset.current.y}px)`;
  };
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { x: number; y: number } | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) offset.current = saved;
    } catch {
      /* (no saved place: the default one) */
    }
    place();
    // a turned phone, or a smaller window: keep the bubble on the screen
    const keep = () => {
      const el = bubble.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = Math.min(0, window.innerWidth - 4 - r.right) + Math.max(0, 4 - r.left);
      const dy = Math.min(0, window.innerHeight - 4 - r.bottom) + Math.max(0, 4 - r.top);
      if (dx || dy) {
        offset.current = { x: offset.current.x + dx, y: offset.current.y + dy };
        place();
      }
    };
    keep();
    window.addEventListener("resize", keep);
    return () => window.removeEventListener("resize", keep);
  }, []);

  // the on-screen keyboard covers the foot of the page without moving it: the panel is lifted by as much as it covers
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const sync = () => setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, [open]);

  const unread = open ? 0 : messages.slice(seen).filter((m) => m.from !== as).length;

  // (what was on screen when the panel folds away has been read)
  const close = () => {
    setSeen(messages.length);
    setOpen(false);
  };
  const toggle = () => {
    if (open) return close();
    setAbove((bubble.current?.getBoundingClientRect().top ?? 0) > window.innerHeight / 2);
    setOpen(true);
  };

  return (
    <div className="chat-float">
      <button
        ref={bubble}
        type="button"
        className="chat-bubble"
        aria-label={unread > 0 ? `Chat, ${unread} new` : "Chat"}
        aria-expanded={open}
        onPointerDown={(e) => {
          drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY, ox: offset.current.x, oy: offset.current.y, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || e.pointerId !== d.id) return;
          if (!d.moved && Math.hypot(e.clientX - d.px, e.clientY - d.py) < TAP) return;
          d.moved = true;
          const el = bubble.current;
          if (!el) return;
          // where the bubble would be: kept inside the screen
          const r = el.getBoundingClientRect();
          const nx = d.ox + (e.clientX - d.px);
          const ny = d.oy + (e.clientY - d.py);
          const dx = nx - offset.current.x;
          const dy = ny - offset.current.y;
          const clampX = Math.min(Math.max(r.left + dx, 4), window.innerWidth - 4 - r.width) - r.left;
          const clampY = Math.min(Math.max(r.top + dy, 4), window.innerHeight - 4 - r.height) - r.top;
          offset.current = { x: offset.current.x + clampX, y: offset.current.y + clampY };
          place();
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || e.pointerId !== d.id) return;
          if (d.moved) {
            dragged.current = true;
            try {
              localStorage.setItem(KEY, JSON.stringify(offset.current));
            } catch {
              /* (it just will not be remembered) */
            }
          }
        }}
        onPointerCancel={() => (drag.current = null)}
        // a tap is the click (also for the keyboard): opening on the release itself put the dimmed backdrop under the finger in time to catch the click that follows
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          toggle();
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {unread > 0 && <span className="chat-bubble-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="chat-float-backdrop" aria-hidden="true" onClick={close} />
          <div
            role="dialog"
            aria-label="Chat"
            className="chat-float-panel"
            data-above={above ? "yes" : "no"}
            style={keyboard > 0 ? { top: "auto", bottom: keyboard + 8 } : undefined}
            onKeyDown={(e) => e.key === "Escape" && close()}
          >
            <button type="button" className="chat-float-close" aria-label="Close the chat" onClick={close}>
              ×
            </button>
            <ChatPanel messages={messages} as={as} onSend={onSend} />
          </div>
        </>
      )}
    </div>
  );
}
