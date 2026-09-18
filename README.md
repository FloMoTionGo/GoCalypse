# GoCalypse

A 4-player custom Go variant, played online and synced live across all players.

**Play now:** [flomotiongo.github.io/GoCalypse](https://flomotiongo.github.io/GoCalypse/)
(client, hosted on GitHub Pages) — connects to the live server at
`wss://gocalypse.fly.dev`. Open 4 tabs to fill a room.

**Debugging:** `web/debug.html` fills one tab with all 4 players at once —
each a real independent client in its own `<iframe>`, scaled down into a 2x2
grid, auto-joining the same room with staggered delays so they don't race
into separate rooms. `?server=...` in `debug.html`'s own URL overrides which
server all 4 point at.

Not standard Go rules — this is a free-for-all variant with black/white
stones distinguished by pattern (dots or stripes), and powerups that trigger
board-altering actions (bombs, sniping enemy stones, etc). Guests get a
random display name if not registered.

Each player's stone has two identity axes:

| Player | Base  | Pattern |
|--------|-------|---------|
| 1      | black | dots    |
| 2      | white | dots    |
| 3      | black | stripes |
| 4      | white | stripes |

The two axes run as **two independent, simultaneous team splits** over the
same board, each exactly like a normal 2-color Go game:

- **Base view** — black (1, 3) vs white (2, 4). White captures black and
  vice versa; pattern is irrelevant to this view.
- **Pattern view** — dots (1, 2) vs stripes (3, 4). Dots captures stripes
  and vice versa; base is irrelevant to this view.

A stone's group and liberties are computed separately per view (grouping by
that view's value only — e.g. a black+dots stone merges with an adjacent
black+stripes stone for base-view liberties, but they're separate groups
for pattern-view liberties), and **a stone dies if either view's rules
would capture it** — each view is a fully independent, self-contained
ruleset; having plenty of liberties on one view never rescues a group
that's dead on the other. Since any two distinct colors differ on at least
one axis, every pair of distinct players is a rival on at least one view —
there's no more "fully allied" color pair. See
`server/src/rules/goRules.test.ts` for the exact mechanics, including the
no-cross-view-rescue case.

## Architecture

- `server/` — authoritative game server ([Colyseus](https://colyseus.io/)),
  holds the canonical board state per room and syncs it to all connected
  clients over WebSockets.
  - `src/state/GoState.ts` — synced schema (board, players, turn, etc).
  - `src/rules/goRules.ts` — hand-rolled capture/liberty/suicide rules,
    including the two-view model above (not a general Go rules library).
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

The client (`web/`) deploys to GitHub Pages via
`.github/workflows/pages.yml`, which publishes on every push to `master`
that touches `web/`. GitHub Pages requires a public repo on the free plan,
which is why this repo is public.
