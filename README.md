# GoCalypse

A 4-player custom Go variant, played online and synced live across all players.

Not standard Go rules — this is a free-for-all variant with black/white
stones distinguished by pattern (dots or stripes), alliance-based captures,
and powerups that trigger board-altering actions (bombs, sniping enemy
stones, etc). Guests get a random display name if not registered.

Each player's stone has two identity axes — a base tone (black/white) and a
pattern (dots/stripes) — and stones ally for liberties/captures if they
share *either* axis:

| Player | Base  | Pattern |
|--------|-------|---------|
| 1      | black | dots    |
| 2      | white | dots    |
| 3      | black | stripes |
| 4      | white | stripes |

So 1↔2 (share dots), 1↔3 (share black), 2↔4 (share white), and 3↔4 (share
stripes) merge into the same group and share liberties. Only the diagonal
opposites — 1↔4 and 2↔3 — are true enemies for capture purposes; each player
has exactly one rival and is allied with the other two. Because alliance
isn't transitive (1 allies with both 2 and 3, but 2 and 3 are enemies of
each other), a mixed allied group can be wiped out as collateral damage by
either rival — see the "collateral damage" test in
`server/src/rules/goRules.test.ts`.

## Architecture

- `server/` — authoritative game server ([Colyseus](https://colyseus.io/)),
  holds the canonical board state per room and syncs it to all connected
  clients over WebSockets.
  - `src/state/GoState.ts` — synced schema (board, players, turn, etc).
  - `src/rules/goRules.ts` — hand-rolled capture/liberty/suicide rules,
    including the alliance model above (not a general Go rules library).
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

Rules tests: `npm test` (from `server/`) — uses Node's built-in test runner,
no extra dependency.

Client — just serve `web/` as static files, e.g.:

```
cd web
npx serve .
```

The server field defaults to the deployed `wss://gocalypse.fly.dev` — point
it at `ws://localhost:2567` instead if you're running the server locally.
Optionally enter a name, then join. Open 4 browser tabs to fill a room and
start a game.

## Deploying

Live at `wss://gocalypse.fly.dev`. Deploys to [Fly.io](https://fly.io) via
the included `Dockerfile` and `fly.toml` (`fly deploy` from `server/`).
Scales to zero when idle (`min_machines_running = 0`), so no cost while no
game is running.

**Single instance only.** Room state lives in each machine's memory with no
shared backend (Redis, etc), so a client's WebSocket must land on the same
machine that reserved its seat. Fly's default HA behavior spins up a second
machine on the first deploy from zero, which breaks this ("seat reservation
expired" errors) — after a from-scratch deploy, run
`fly scale count 1 -a gocalypse` once. Redeploys to existing machines
(`fly deploy`) are unaffected.
