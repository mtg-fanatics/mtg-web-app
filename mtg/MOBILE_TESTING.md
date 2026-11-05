# Testing Inkfall as an installed app on a phone

A phone cannot install the app, or run its service worker, from `http://<your-PC-address>`: that is not a secure context. `localhost` is secure (Android over USB), and any `https://` address is. Two ways:

## A. HTTPS tunnel (iPhone and Android)

The page and the game server each need an https address, because the page asks for a `wss://` connection to the game server.

1. Install `cloudflared` (Windows: `winget install Cloudflare.cloudflared`). No account is needed for quick tunnels.
2. Start the game server: `cd game-server && npm start` (leave it running).
3. Open a tunnel to it: `cloudflared tunnel --url http://localhost:2567`. Copy the `https://….trycloudflare.com` address it prints and change `https` to `wss` (this is `GAME_WSS`).
4. Build the site so that it knows where the game server is: `cd mtg && set NEXT_PUBLIC_GAME_SERVER_URL=GAME_WSS && npm run build && npm start` (PowerShell: `$env:NEXT_PUBLIC_GAME_SERVER_URL="GAME_WSS"`). It listens on port 3000.
5. Open a second tunnel: `cloudflared tunnel --url http://localhost:3000`. Open that `https://….trycloudflare.com` address on the phone.

Quick tunnel addresses change each time you start them; run the build again when the game-server address changes.

## B. Android over USB (no tunnel)

1. Phone: Settings, Developer options, USB debugging on; connect the cable.
2. PC Chrome: `chrome://inspect/#devices`, Port forwarding: add `3000 -> localhost:3000` and `2567 -> localhost:2567`, tick "Enable port forwarding".
3. Phone Chrome: open `http://localhost:3000`. (`localhost` counts as secure, so install and the service worker work. The game server is reached at `ws://localhost:2567`, which also works.)

Install: Chrome menu, "Install app" (or "Add to Home screen"). iPhone: Safari, Share, "Add to Home Screen".

Production build only: the service worker and the update notice do not run under `npm run dev`.
