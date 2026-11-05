"use client";

import Logo from "./Logo";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { animationSpeed, animationsEnabled, setAnimationSpeed, setAnimationsEnabled, SPEEDS } from "@/lib/motion";
import { connectSocial, disconnectSocial } from "@/lib/online/session";
import { clearCached } from "@/lib/dashCache";
import AudioMenu from "./AudioMenu";
import { Hourglass, InkDrop } from "./Icons";
import { useShownName } from "@/lib/profile";
import { useInstall } from "@/lib/install";

/** Slim top bar shown only while signed in. */
export default function UserBar() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const shown = useShownName() ?? username; // the nickname, or the login name until it arrives
  const [animations, setAnimations] = useState(animationsEnabled);
  const [speed, setSpeed] = useState(animationSpeed);
  const [menu, setMenu] = useState(false);
  const { canInstall, install } = useInstall();
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      setUsername(session ? ((session.user.user_metadata.username as string | undefined) ?? "player") : null);
      // signed in: friends can see this player is online, on whatever page they are
      if (session) void connectSocial();
      else {
        disconnectSocial();
        clearCached(); // the next person on this computer must not see this player's name
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!username) return null;

  async function signOut() {
    clearCached();
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="topbar">
      <Link href="/" className="flex items-center gap-2" aria-label="Inkfall, back to the front room">
        <Logo size={26} />
        <span className="brand">Inkfall</span>
      </Link>
      <span className="flex-1" />
      <button
        onClick={() => {
          setAnimationsEnabled(!animations);
          setAnimations(!animations);
        }}
        aria-pressed={animations}
        title="Let the ink move (attacks, confetti and the rest), or keep the page still"
        aria-label={`Animations: ${animations ? "on" : "off"}`}
        className="bar-btn bar-full"
      >
        <InkDrop width={17} height={17} className={`ink-icon mr-1 inline-block align-[-3px] min-[480px]:hidden ${animations ? "" : "opacity-40"}`} /><span className="max-[479px]:hidden">Motion: </span><span className={`max-[479px]:hidden ${animations ? "font-semibold text-[#8fc4a5]" : "font-semibold text-slate-400"}`}>{animations ? "Lively" : "Still"}</span>
      </button>
      {(
        <button
          disabled={!animations}
          onClick={() => {
            const next = SPEEDS[(SPEEDS.findIndex((x) => x.id === speed) + 1) % SPEEDS.length].id;
            setAnimationSpeed(next);
            setSpeed(next);
          }}
          title="How quickly the cards and spells move: Normal, Fast or Faster"
          aria-label={`Animation speed: ${speed}`}
          className={`bar-btn bar-full ${animations ? "" : "opacity-45"}`}
        >
          <Hourglass width={17} height={17} className="ink-icon mr-1 inline-block align-[-3px]" /> <span className="max-[479px]:hidden">Pace: </span>
          <span className="font-semibold text-[#8fc4a5]">{SPEEDS.find((x) => x.id === speed)?.label}</span>
        </button>
      )}
      <AudioMenu />
      <span className="bar-full hidden min-w-[4.5rem] max-w-[18rem] items-baseline gap-1 sm:flex">
        <span className="shrink-0 max-lg:hidden">Written in as</span>
        <span className="min-w-0 truncate font-semibold text-white" title={shown ?? undefined}>{shown}</span>
      </span>
      <button onClick={signOut} className="bar-btn bar-full">
        Close the book
      </button>
      {/* a phone: the rest of the bar is one menu */}
      <button type="button" onClick={() => setMenu(true)} className="bar-btn bar-menu-btn" aria-label="Menu: motion, pace, reload, close the book" aria-haspopup="dialog">
        <span aria-hidden="true" className="text-lg leading-none">☰</span>
      </button>
      {menu && (
        <>
          <div className="bar-sheet-backdrop" aria-hidden="true" onClick={() => setMenu(false)} />
          <div role="dialog" aria-modal="true" aria-label="Menu" className="bar-sheet">
            <div className="bar-sheet-head">
              <span className="font-title text-lg text-[#e8dcc0]">Menu</span>
              <button type="button" aria-label="Close the menu" onClick={() => setMenu(false)} className="bar-sheet-x">
                ×
              </button>
            </div>
            <p className="px-1 text-sm text-slate-300">
              Written in as <b className="text-white">{shown}</b>
            </p>
            <button
              type="button"
              className="bar-sheet-row"
              aria-pressed={animations}
              onClick={() => {
                setAnimationsEnabled(!animations);
                setAnimations(!animations);
              }}
            >
              <span>Motion</span>
              <b>{animations ? "Lively" : "Still"}</b>
            </button>
            <button
              type="button"
              className="bar-sheet-row"
              disabled={!animations}
              onClick={() => {
                const next = SPEEDS[(SPEEDS.findIndex((x) => x.id === speed) + 1) % SPEEDS.length].id;
                setAnimationSpeed(next);
                setSpeed(next);
              }}
            >
              <span>Pace</span>
              <b>{SPEEDS.find((x) => x.id === speed)?.label}</b>
            </button>
            {canInstall && (
              <button type="button" className="bar-sheet-row" onClick={() => void install().then(() => setMenu(false))}>
                <span>Install Inkfall</span>
                <b>Add to home screen</b>
              </button>
            )}
            <button type="button" className="bar-sheet-row" onClick={() => location.reload()}>
              <span>Reload</span>
              <b>↻</b>
            </button>
            <button type="button" className="bar-sheet-row bar-sheet-danger" onClick={signOut}>
              <span>Close the book</span>
              <b>Sign out</b>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
