# GoCalypse

A 4-player custom Go variant, played online and synced live across all players.

Not standard Go rules — this is a free-for-all variant with 4 stone colors,
custom captures, and powerups that trigger board-altering actions
(bombs, sniping enemy stones, etc). Guests get a random display name if not
registered.

## Architecture

- `server/` — authoritative game server ([Colyseus](https://colyseus.io/)),
  holds the canonical board state per room and syncs it to all connected
  clients over WebSockets.
  - `src/state/GoState.ts` — synced schema (board, players, turn, etc).
  - `src/rules/goRules.ts` — hand-rolled capture/liberty/suicide rules for
    the N-color board (not a general Go rules library).
  - `src/powerups/` — pluggable powerup registry (`definitions.ts`); add a
    new powerup by implementing `PowerupDefinition` and registering it.
  - `src/rooms/GoRoom.ts` — room lifecycle: join/leave, turn order, move
    validation, powerup dispatch.
- `web/` — minimal browser client, plain HTML/CSS/JS (no build step, no
  framework), using `colyseus.js` from a CDN `<script>` tag. Renders the
  board, player list, and powerup buttons straight off the synced room
  state (`room.onStateChange`).

## Running locally

Server:

```
cd server
npm install
npm run dev
```

Server listens on `ws://localhost:2567`. Health check at `/healthz`.

Client — just serve `web/` as static files, e.g.:

```
cd web
npx serve .
```

Open it, leave the server field as `ws://localhost:2567` (or point it at a
deployed Fly.io server, e.g. `wss://gocalypse.fly.dev`), optionally enter a
name, and join. Open 4 browser tabs to fill a room and start a game.

## Deploying

Deploys to [Fly.io](https://fly.io) via the included `Dockerfile` and
`fly.toml` (`fly launch` / `fly deploy` from `server/`). Scales to zero when
idle (`min_machines_running = 0`), so no cost while no game is running.
