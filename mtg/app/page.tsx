import Logo from "./Logo";
import Link from "next/link";
import LiveWallpaper from "./LiveWallpaper";
import Lobby from "./lobby/Lobby";
import FriendsPanel from "./friends/FriendsPanel";
import ProfileButton from "./profile/ProfileButton";
import CreateRoomButton from "./lobby/CreateRoomButton";
import { Fan, Scribble, Tome } from "./Icons";

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-7 overflow-x-clip p-5 text-white max-md:justify-start max-md:gap-5 max-md:pt-3 sm:p-8">
      <LiveWallpaper />
      <ProfileButton />
      <FriendsPanel />
      <Lobby />
      <section className="hero-page relative flex flex-col items-center gap-5 text-center">
        {/* on a phone the seal and the title give way to the buttons (the name is in the top bar) */}
        <div className="flex flex-col items-center gap-3 max-md:hidden">
          <div className="hero-scrim" aria-hidden="true" />
          <Logo size={112} glow className="hero-rise" />
          <p className="hero-eyebrow hero-rise caps !text-[0.78rem] !not-italic" style={{ animationDelay: "0.04s" }}>
            A game for two hands
          </p>
          <h1 className="hero-rise font-title" style={{ animationDelay: "0.08s" }}>
            <span className="hero-title">Inkfall</span>
          </h1>
          <Scribble width={260} className="hero-rise -mt-2" />
          <p className="hero-sub hero-rise" style={{ animationDelay: "0.16s" }}>
            Write a deck. Take a seat. The ink is still wet.
          </p>
        </div>
        <div className="hero-rise mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-3" style={{ animationDelay: "0.24s" }}>
          <CreateRoomButton />
          <Link href="/decks" className="hero-btn">
            <Tome />
            Your decks
          </Link>
          <Link href="/cards" className="hero-btn">
            <Fan />
            The card library
          </Link>
        </div>
      </section>
    </main>
  );
}
