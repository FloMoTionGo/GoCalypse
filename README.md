# GoCalypse

A 4-player custom Go variant, played online and synced live across all players.

**Play now:** [flomotiongo.github.io/GoCalypse](https://flomotiongo.github.io/GoCalypse/)
(client, hosted on GitHub Pages) — connects to the live server at
`wss://gocalypse.fly.dev`. Open 4 tabs to fill a room.

**Debugging:** `web/debug.html` fills one tab with all 4 players at once —
each a real independent client in its own `<iframe>` in a 2x2 grid,
auto-joining the same room with staggered delays so they don't race into
separate rooms. They join `go_debug` rooms: same rules, separate matchmaking,
and everyone starts with 600 fireflies so the whole market can be tried.
`?server=...` in `debug.html`'s own URL overrides which server all 4 point at.

**Art:** a 5-colour pixel scene (a board by a lantern river) rendered in
software from sprites defined in code: `web/sprites.js` (palette, sprites,
icons) and `web/pixelScene.js` (scene, animations). `web/pixel-preview.html`
shows every sprite and animation without a server.

**Project docs:** `state.md` is a snapshot of what's built, live and missing;
`ideas.md` holds the plans and open design decisions.

Not standard Go rules — this is a free-for-all variant with black/white
stones distinguished by pattern (dots or stripes), and powerups bought at a
Night Market with fireflies earned in play (see below). Guests get a random
display name if not registered.

Each player has a fixed identity along two axes:

| Player | Base  | Pattern |
|--------|-------|---------|
| 1      | black | dots    |
| 2      | white | dots    |
| 3      | black | stripes |
| 4      | white | stripes |

But a stone doesn't carry both axes at once — each move, the player picks
which front that particular stone fights on:

- **Left click** — a solid stone in their base color (black/white), fighting
  only in the **base view**: black vs white, pattern irrelevant.
- **Right click** — a grey stone in their pattern (dots/stripes), fighting
  only in the **pattern view**: dots vs stripes, base irrelevant.

The two views are independent, simultaneous 2-team Go games sharing the
same board. A stone is **neutral on the axis it didn't commit to** — it
still occupies the cell (blocking a liberty there), but it never merges
into a group or gets captured on that other view, i.e. it's a wall. Since
two players always share the *other* axis (e.g. players 1 and 3 are both
black), stones from different players merge into one group when they share
a view's value — a black stone from player 1 and a black stone from player
3 fight the base war together. See `server/src/rules/goRules.test.ts` for
the exact mechanics, including the wall behavior and why suicide is only
ever checked on the one view a stone actually participates in.

### Fireflies & the Night Market

Placing a stone earns **3 fireflies**, capturing earns **5 per stone**, and
losing a stone to someone's item pays you **3** as consolation. A player's
**Night Market** opens after their **5th move**. Buying never takes your turn;
using an item does. Items that fail (bad target) aren't used up.

| Item | Price | Effect |
|---|---|---|
| Driftwood | 15 | Neutral log on an empty point: a wall on both fronts, owned by no one, uncapturable. Floats away after 3 rounds. Can't smother a group. |
| Lily Pad | 20 | Reserves an empty point for 3 rounds: only you may play there. |
| Lantern Ward | 30 | One of your groups can't be captured or removed until your next turn. If it has no liberties when the ward lapses, it's removed. |
| Turn the Lantern | 40 | Flips one of your stones to your other front (solid <-> grey pattern); captures count on the new front. Refused if it would leave it or a former group-mate without liberties. |
| Gust | 90 | Removes one enemy stone whose group is in atari. Once per match. |
| Snipe | 140 | Removes any single enemy stone. Once per match. |
| Firework | 200 | Clears a 3x3 area (your stones and driftwood too; warded stones are spared). Once per match. |

Board code 9 is driftwood (see `goRules.ts`). Timed markers (wards, lily pads,
driftwood timers) are `GoState.effects`; `GoState.action` records the last move
or item so clients can play the matching animation.

## Architecture

- `server/` — authoritative game server ([Colyseus](https://colyseus.io/)),
  holds the canonical board state per room and syncs it to all connected
  clients over WebSockets.
  - `src/state/GoState.ts` — synced schema (board, players, turn, etc).
  - `src/rules/goRules.ts` — hand-rolled capture/liberty/suicide rules,
    including the two-view model above (not a general Go rules library).
  - `src/powerups/` — the Night Market's stock (`definitions.ts`); add a
    powerup by implementing `PowerupDefinition` (with a price) and adding it
    to the registry. The client needs a sprite/icon for new ids
    (`web/sprites.js` `powerupIcon`).
  - `src/rooms/GoRoom.ts` — room lifecycle: join/leave, turn order, move
    validation, powerup dispatch.
- `web/` — browser client, plain HTML/CSS/JS (no build step, no framework),
  using `colyseus.js` from a CDN `<script>` tag. `main.js` renders the pixel
  scene, player list, Satchel and Night Market straight off the synced room
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
