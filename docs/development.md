# Developing GoCalypse

[Back to the README](../README.md)

## Running locally

Server:

```
cd server
npm install
npm run dev
```

Server listens on `ws://localhost:2567`. Health check at `/healthz`;
`GET /tables` says who is waiting (people per board size at public tables
with a free seat), which the home screen polls every 4 s for its
"Waiting now" line and the Play label.

Tests: `node tests/run.mjs` runs every tier: server units, web units,
integration against a live server, and the GUI in headless Edge/Chrome.
`node tests/run.mjs quick` runs the fast ones. They use Node's built-in test
runner; the only extra dependency is `colyseus.js` in `tests/`. Git hooks run
them before commits, merges and pushes to master, and CI runs them on every
push (enable the hooks once with `git config core.hooksPath .githooks`). New
features start as red tests: see [tests/README.md](../tests/README.md) and the
quality bar in [CONSTRAINTS.md](../CONSTRAINTS.md).

Client — just serve `web/` as static files, e.g.:

```
cd web
npx serve .
```

The server field defaults to the deployed `wss://gocalypse.fly.dev` — point
it at `ws://localhost:2567` instead if you're running the server locally.
Optionally enter a name, then join. Open 4 browser tabs to fill a room and
start a game.

## Debug tables

`web/debug.html` fills one tab with all 4 players at once —
each a real independent client in its own `<iframe>` in a 2x2 grid,
auto-joining the same room with staggered delays so they don't race into
separate rooms. They join `go_debug` rooms: same rules, separate matchmaking,
everyone starts with 1200 fireflies so the whole market can be tried, and the
weather die is rolled every 6 turns instead of 20.
`?server=...` in `debug.html`'s own URL overrides which server all 4 point at.
Debug tables exist on local servers and on staging (`DEBUG_ROOMS = "on"` in
`fly.staging.toml`); production has none, so no 1200-firefly game lands in
the public replays or teaches the haiku where the board is quiet.

## Art

A 5-colour pixel scene (a wooden pier standing in a lantern river,
water on all four sides) rendered in software from sprites defined in code:
`web/sprites.js` (palette, sprites, icons) and `web/pixelScene.js` (scene,
animations, weather). The board is drawn at the largest whole pixel scale
that still fits the window, so it fills the screen without ever blurring; on
a laptop screen where 2 doesn't fit it takes the half step, 1.5, rather than
leave most of the window empty.
`web/pixel-preview.html` shows every sprite and animation without a server,
and can fire a thunderstorm on demand.

## Architecture

- `server/` — authoritative game server ([Colyseus](https://colyseus.io/)),
  holds the canonical board state per room and syncs it to all connected
  clients over WebSockets.
  - `src/state/GoState.ts` — synced schema (board, players, turn, etc).
    **What each client is sent:** the true `board` never leaves the server
    (`@view(SERVER_ONLY)`); clients get `seen`, rebuilt before every patch
    (`GoRoom.refreshSeen`): fogged points and stones under someone's Mist read
    0, and during a storm's grey every player stone reads `GREY_STONE` (14). A
    player's fireflies, satchel, bought list, lit items and their own misted
    stones (`misted`) are `@view()` fields that reach only that player through
    their `StateView`, and everyone once the game is over. Bots, rules, scoring
    and snapshots all read the true board.
  - `src/rules/goRules.ts` — hand-rolled capture/liberty/suicide rules,
    including the two-view model in [the rules](rules.md) (not a general Go rules library).
  - `src/rules/endgame.ts` — end-of-game area scoring and the per-player
    final score / tie-break / place, pure functions with their own tests.
  - `src/rules/storm.ts` — when the D20 is rolled, what a roll plus the calm
    bonus means, the forecast, and where the bolts land, kept apart from room
    state so it can be tested.
  - `src/rules/river.ts` — the river crab and the river spirit: their D6,
    which creature comes, where it stands and what it reaches, its 3-round
    timer and what it takes, likewise apart from room state.
  - `src/powerups/` — the Night Market's stock (`definitions.ts`); add a
    powerup by implementing `PowerupDefinition` (with a price) and adding it
    to the registry. The client needs a sprite/icon for new ids
    (`web/sprites.js` `powerupIcon`).
  - `src/bots/` — the bots: `scoring.ts` values every point on both fronts,
    `items.ts` decides what to buy and use, `styles.ts` holds the weights that
    make each bot different (and the three seatable ones), `index.ts` picks a
    stone or an item. Plain functions over a plain board, tested without a
    room in `bots.test.ts`. A client seats them with the `addBots` message.
  - `src/rooms/GoRoom.ts` — room lifecycle: join/leave, turn order, move
    validation, powerup dispatch.
  - `src/rooms/tables.ts` — the matchmaker's listings summed into who is
    waiting at which board size, for `GET /tables` and the home screen.
  - `src/history/` — replays. `recorder.ts` keeps a frame per stone, item,
    pass or storm (only the cells that changed); it rides in the room's
    snapshot while the game is on and goes to `store.ts` when it ends: one
    JSON file per game in `DATA_DIR/history`, the newest 500 kept
    (`HISTORY_MAX`). `routes.ts` serves `GET /history?from=&to=&limit=`
    (summaries, newest first; times in ms) and `GET /history/:id`. On by
    default; `HISTORY=off` records nothing.
- `web/` — browser client, plain HTML/CSS/JS (no build step, no framework),
  with `colyseus.js` vendored in `web/vendor/` (the version `tests/package.json`
  pins; `tests/web/page.test.mjs` keeps the two equal) under a Content Security
  Policy that allows only the site's own scripts. The footer's Server field
  remembers a typed endpoint and names any server that isn't the usual one; the
  seat secret a tab holds is kept per server host, so a link's `#server=` can
  never collect the key for the usual server. `main.js` renders the pixel
  scene, player list, Night Market and the hand of item cards
  under the board straight off the synced room state (`room.onStateChange`).
  `replay.js` (pure, tested in Node) and `replayView.js` (the Replays dialog)
  list and play back saved games. `errorCopy.js` (pure, tested in Node) words
  every failure the page shows: what happened and what to do, never a status
  or close code; the server's own refusals at the door are shown as they are.

## Board codes and timed state

Board code 9 is driftwood and codes 10-13 are Twin Wick stones (see `goRules.ts`). Timed markers (wards, lily pads,
driftwood timers, lightning fires) are `GoState.effects`; `GoState.action`
records the last move or item so clients can play the matching animation, and
`GoState.storm` carries the last die roll, the forecast (`calm`, `chance`,
`level`, `every`) and its strike points.
