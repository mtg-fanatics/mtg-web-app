"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { useRouter } from "next/navigation";
import type { GameEvent, GameState, PlayerId } from "@mtg/engine";
import { onGameUpdate, tryReconnect, useOnline } from "@/lib/online/session";
import { attackersIn, playCombat } from "./combatFx";
import { handDraws } from "./pileFx";
import type { Draw } from "./pileFx";

type Commit = (r: { state: GameState; events: GameEvent[] }) => Promise<void>;

/**
 * Online: keeps the screen in step with the match on the game server. The refs point at the game on screen and at
 * the function that shows a change, both as of the last render.
 */
export function useOnlineMatch(online: boolean, game: GameState | null, seat: PlayerId | null, gameRef: RefObject<GameState | null>, commitRef: RefObject<Commit>, openingDeal: (hand: Draw[], greet: boolean, start?: GameState) => void) {
  const net = useOnline();
  const router = useRouter();
  const dealt = useRef(false);

  // The opening hand is hidden before it is ever painted, then flies in from the library.
  useLayoutEffect(() => {
    if (!online || !game || !net.game || dealt.current) return;
    dealt.current = true;
    if (!net.game.fresh) return;
    openingDeal(handDraws(game, seat), net.game.spectator !== true, game); // a spectator is not greeted
  });

  // Every change to the game arrives from the server, one at a time, in order.
  useEffect(() => {
    if (!online) return;
    let chain: Promise<void> = Promise.resolve();
    const off = onGameUpdate((u) => {
      chain = chain.then(async () => {
        for (let i = 0; i < 100 && !gameRef.current; i++) await new Promise((r) => setTimeout(r, 50)); // the opening deal comes first
        // Combat damage: play the attack on the board as it is now, then show the result.
        const fought = attackersIn(gameRef.current, u.events);
        if (fought.length > 0) await playCombat(u.events, fought);
        await commitRef.current({ state: u.view, events: u.events });
      });
    });
    return off;
  }, [online, gameRef, commitRef]);

  // A page that was just refreshed picks its seat up again.
  useEffect(() => {
    if (online) void tryReconnect();
  }, [online]);

  // No match (the page was opened directly, or the room closed): back to the lobby.
  useEffect(() => {
    if (!online || net.snapshot || net.game) return;
    const timer = setTimeout(() => (window.dispatchEvent(new Event("ink:navigating")), router.replace("/")), 2500);
    return () => clearTimeout(timer);
  }, [online, net.snapshot, net.game, router]);
}
