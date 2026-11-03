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

/** Slim top bar shown only while signed in. */
export default function UserBar() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const shown = useShownName() ?? username; // the nickname, or the login name until it arrives
  const [animations, setAnimations] = useState(animationsEnabled);
  const [speed, setSpeed] = useState(animationSpeed);
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
        className="bar-btn"
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
          className={`bar-btn ${animations ? "" : "opacity-45"}`}
        >
          <Hourglass width={17} height={17} className="ink-icon mr-1 inline-block align-[-3px]" /> <span className="max-[479px]:hidden">Pace: </span>
          <span className="font-semibold text-[#8fc4a5]">{SPEEDS.find((x) => x.id === speed)?.label}</span>
        </button>
      )}
      <AudioMenu />
      <span className="hidden min-w-[4.5rem] max-w-[18rem] items-baseline gap-1 sm:flex">
        <span className="shrink-0 max-lg:hidden">Written in as</span>
        <span className="min-w-0 truncate font-semibold text-white" title={shown ?? undefined}>{shown}</span>
      </span>
      <button onClick={signOut} className="bar-btn">
        Close the book
      </button>
    </div>
  );
}
