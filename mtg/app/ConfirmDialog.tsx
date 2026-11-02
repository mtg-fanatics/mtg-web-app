"use client";

import { useEffect, useRef, useState } from "react";
import { animationsEnabled } from "@/lib/motion";
import { holdWallpaper } from "./LiveWallpaper";
import { Binned, Query } from "./Icons";

/**
 * A "are you sure?" pop-up in the game's own style, instead of the browser's plain box.
 * Esc, the backdrop and the safe button all cancel; the safe button has the focus first, so a stray Enter never deletes anything.
 */
export default function ConfirmDialog({
  title,
  subject,
  message,
  confirmLabel,
  cancelLabel = "Keep it",
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** The name of the thing being acted on, shown in a pill. */
  subject?: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** May be async: the buttons are locked until it finishes. A thrown error is shown in the pop-up. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safe = useRef<HTMLButtonElement>(null);

  useEffect(() => holdWallpaper(), []);
  useEffect(() => safe.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
      setBusy(false);
    }
  }

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text" onClick={() => !busy && onCancel()} className="confirm-backdrop">
      <div onClick={(e) => e.stopPropagation()} className={`confirm-card ${danger ? "confirm-danger" : ""} ${animationsEnabled() ? "confirm-pop" : ""}`}>
        <div className="confirm-icon" aria-hidden="true">
          {danger ? <Binned width={30} height={30} /> : <Query width={30} height={30} />}
        </div>
        <h2 id="confirm-title" className="confirm-title">
          {title}
        </h2>
        {subject && <p className="confirm-subject">{subject}</p>}
        <p id="confirm-text" className="confirm-text">
          {message}
        </p>
        {error && (
          <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-[#f0bfb0]">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button ref={safe} type="button" disabled={busy} onClick={onCancel} className="btn-ghost !px-5 !py-2.5">
            {cancelLabel}
          </button>
          <button type="button" disabled={busy} onClick={() => void confirm()} className={`${danger ? "btn-danger-solid" : "btn-gold"} !px-5 !py-2.5`}>
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
