"use client";

import { Quill } from "../Icons";

/** The home page's main button: opens the "Open a table" window (the lobby on this page listens for it). */
export default function CreateRoomButton() {
  return (
    <button onClick={() => window.dispatchEvent(new Event("mtg-create-room"))} className="hero-btn hero-btn-primary">
      <Quill />
      Open a table
    </button>
  );
}
