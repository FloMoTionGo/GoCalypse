# GoCalypse: Current State

Snapshot as of **2026-09-19** (commit `03bc966`). What's built, where it runs,
how it's tested, and what's missing. Plans and open design questions are in
[`ideas.md`](ideas.md); setup instructions are in [`README.md`](README.md).

---

## 1. In one paragraph

GoCalypse is a 4-player online Go variant with custom two-front captures,
drawn as a cozy 5-color pixel scene: a wooden board on a riverbank at a
lantern festival. Players earn **fireflies** by playing and, after their 5th
move, can spend them at the **Night Market** on 7 powerups, each with its own
pixel animation. It's live and playable, but matches never end, nothing is
saved between matches, and there's no Flame/progression system yet.

## 2. Where it runs

| What | Where |
|---|---|
| Game (client) | https://flomotiongo.github.io/GoCalypse/ |
| 4-player debug view | https://flomotiongo.github.io/GoCalypse/debug.html |
| Sprite & animation preview | https://flomotiongo.github.io/GoCalypse/pixel-preview.html |
| Game server | `wss://gocalypse.fly.dev` (health: `/healthz`) |
| Repo (public) | https://github.com/FloMoTionGo/GoCalypse |

- **Client:** GitHub Pages, deployed by `.github/workflows/pages.yml` on every
  push to `master` that touches `web/`. The repo is public because free Pages
  requires it.
- **Server:** Fly.io app `gocalypse`, region `fra`, **one machine only**, which
  scales to zero when idle (`fly deploy` from `server/`). Room state lives in
  memory, so a second machine breaks matchmaking; after a from-scratch deploy
  run `fly scale count 1 -a gocalypse`.
- **On this PC:** Node is at `C:\Program Files\nodejs` and flyctl at
  `C:\Users\flori\.fly\bin\flyctl.exe`; neither is on PATH in Claude's shells.

## 3. How the game works today

### Players, board, turns
- 13x13 board, exactly 4 players. The game starts when the 4th joins; the
  room then locks so strangers can't take a departed player's seat.
- Each player holds one of four combos ("colors" in the code): **1**
  black+dots, **2** white+dots, **3** black+stripes, **4** white+stripes.
  Combos are **dealt at random** as players join, from those nobody in the
  room holds yet, so every game shuffles the pairings and no combo appears
  twice.
- Turns go by combo **1 → 2 → 3 → 4**, so black and white alternate; whoever
  is dealt black+dots moves first (so the first mover is random too).
- Guests get a random name; names are capped at 24 characters.

### Two fronts
- **Left click** places a solid stone in your base color (black/white). It
  fights only the base war: black vs white.
- **Right click** places a grey stone with your pattern (dots/stripes). It
  fights only the pattern war: dots vs stripes.
- On the front it didn't choose, a stone is a **wall**: it blocks a liberty
  there but never joins a group or gets captured on that front.
- Stones of different players merge when they share a value on that front
  (players 1 and 3 fight the base war together as black).
- Suicide is checked only on the placed stone's own front.

### Fireflies and the Night Market
- **Earning:** +3 per stone placed, +5 per stone captured, +3 consolation per
  stone of yours removed by someone else's item. Fireflies last one match.
- **Market:** opens for each player after their **5th placed stone** and stays
  open. Buying never takes your turn; **using** an item does. A use on an
  invalid target is refused, explained, and the item is kept.
- **Removal items** (Gust, Snipe, Firework) can each be bought once per match.
- There's no free starting kit.

| Item | Price | What it does |
|---|---|---|
| Driftwood | 15 | A neutral log on an empty point: a wall on both fronts, owned by no one, uncapturable. Floats away after 3 rounds. Refused if it would leave a group with no liberties. |
| Lily Pad | 20 | Reserves an empty point for 3 rounds: only you may place there. Expires at the start of your own turn 3 rounds later, so you get 2 own turns to use it. |
| Lantern Ward | 30 | Your group can't be captured or removed until your next turn. If it has no liberties when the ward lapses, it's removed (credited to no one). |
| Turn the Lantern | 40 | Flips one of your stones between solid and grey. Captures count on the new front. Refused if it would leave the stone or a former group-mate without liberties. |
| Gust | 90 | Removes one enemy stone whose group is in atari (only that stone). |
| Snipe | 140 | Removes any single enemy stone. |
| Firework | 200 | Clears a 3x3 area, including your own stones and driftwood. Warded stones are spared. Refused on an empty area. |

### Welcome screen
On a player's first join (per browser), a welcome window explains the game:
their own color and pattern, left vs right click, walls, the fireflies economy,
and every market item with its icon, price and description (taken from the
server's market, so it can't drift). Clicking anywhere outside it, the small ×,
or Esc closes it; a click outside never places a stone. Once closed it's
remembered in `localStorage` (`gocalypse.welcomeSeen`), and the **How to play**
button in the game header reopens it.

### Debug rooms
`debug.html` shows 4 real clients (760x860 panels) that auto-join a
**`go_debug`** room: same rules, separate matchmaking pool, everyone starts
with **600 fireflies** (enough for all 7 items at 535). The 5-move gate still
applies. The start amount lives in a server subclass (`GoDebugRoom`), so a
client can't request it. The panels share `localStorage`, so the first-visit
welcome screen opens in panel 1 only (hash param `nowelcome` on the others).

## 4. Look & feel

- **Palette (5 colors):** ink `#1f1a24`, cream `#f4e8c8`, amber `#d49040`,
  teal `#2e6b73`, slate `#767d88`. In-between tones are ordered dithering.
  The page UI uses the same five colors.
- **Scene:** 240x279 native pixels shown at an integer 2x (480x558 CSS px).
  Board spacing is 16 native px, stones 15 px. A river runs along the bottom
  and a stream down the right, both touching the deck. There are floating and
  hanging lanterns, a stone lantern, reeds, lily pads and fireflies. The
  playing surface is never lit, so stones stay readable.
- **Board UI:** pixel coordinates 0–12. Hovering shows a half solid / half
  pattern ghost stone and highlights that row and column. A glowing ember
  marks the last move. Lily pads show a mini split stone in the owner's colors.
  Warded stones get a turning ring of light and a small lantern.
- **Animations:** placement (drop, squash, ripple) and capture (shiver, flash,
  rises as a lantern). Each item has its own: driftwood splashes down and later
  drifts off, the lily pad unfurls, ward lanterns drop in, the flipped stone
  turns edge-on, Gust sweeps a stone away, Snipe sights close in, Firework
  bursts. `prefers-reduced-motion` freezes ambience and shortens effects.
- **Performance:** a full frame renders in about 0.5 ms. The client redraws at
  up to 30 fps and pauses in hidden tabs.

## 5. Code map

```
server/src/
  index.ts               defines rooms "go_custom" and "go_debug"
  rooms/GoRoom.ts        join/leave, turn order, moves, market, items, timed effects;
                         GoDebugRoom (600 starting fireflies)
  rules/goRules.ts       two-front captures, suicide, driftwood, flipStone, canPlaceNeutral
  rules/goRules.test.ts  14 rule tests (npm test)
  powerups/definitions.ts  the 7 items (price, removal flag, apply)
  powerups/types.ts      PowerupContext / PowerupDefinition
  state/GoState.ts       synced schema
web/
  index.html, style.css  game page (5-color theme)
  main.js                client: state -> scene, input, sidebar, market, satchel
  sprites.js             palette, sprites, fonts, icons, rasterizer (browser + Node)
  pixelScene.js          scene renderer, effect timelines, diffTurn (browser + Node)
  debug.html             4 clients in one tab (go_debug)
  pixel-preview.html     every sprite and animation, no server needed
```

**Board codes:** `0` empty · `1–4` a player's solid stone · `5–8` that
player's grey pattern stone (player + 4) · `9` driftwood.

**Synced state (`GoState`):** `size`, `board`, `players` (in join order),
`turnIndex` (an index into `players`), `status`, `turnCount`, `lastEvent`,
`shopAfter`, `market` (the 7 items), `effects` (timed wards, lily pads and
driftwood timers, each ending when `turnCount` reaches `until`), and `action`
(the last move or item use, which the client uses to pick animations).
`PlayerState` has `sessionId`, `name`, `color`, `connected`, `score`,
`fireflies`, `moves`, `powerups` (owned items) and `bought`.

**Messages:** client to server `move {x, y, axis}`, `buy {id}`,
`usePowerup {id, target: {x, y}}`. Server to client: `notice` (text
explaining a refused action). Every handler validates its payload, and the room
defines `onUncaughtException`, so a bad message can't crash the process.

## 6. Testing

**In the repo:** `npm test` in `server/`: 14 rule tests (Node's built-in test
runner, no extra dependency).

**Outside the repo (temporary!):** everything below lives in Claude's session
scratch folder and **will be lost**. It should be moved into the repo (see
ideas.md, D-T9).
- Market & powerups integration test: 4 real clients, 42 checks (gating,
  prices, once-per-match, every item's board effect, consolation).
- Combo shuffle test: 40 games, every game deals 4 distinct combos, each
  player gets varied combos, combo 1 always moves first, rejoins never
  double a combo.
- Room tests: pre-game leave / color reuse / turn order, locked rooms,
  reconnect-window fragmentation, malformed messages.
- Pixel suite: 15 checks (palette purity, readable stone looks, hit-testing,
  animations finishing, reduced motion).
- Real-browser tests in headless Edge, driven over the DevTools protocol with
  Node's built-in WebSocket. Plays a full game with real mouse clicks through
  all 7 items, whatever combo the browser is dealt (19 checks), exercises the
  welcome screen (17 checks: opens on first join, closes on outside click / × /
  Esc without placing a stone, one scrollbar, stays closed on the next join),
  and loads `debug.html` (7 checks: one room, welcome in panel 1 only, the
  four names, layout, no scrolling inside panels). Each run uses a fresh Edge
  profile and kills every process started with it (killing only Edge's
  launcher leaves the browser, and its game connections, alive).
  Screenshots were reviewed by eye.

All of the above passed locally and against production on 2026-09-19.

## 7. Known gaps and limits

- **Matches never end.** `status: "finished"` is never set and there's no
  pass move. This blocks payouts, rankings and progression.
- **Leavers stall the game.** Turns still go to disconnected players, so the
  game waits forever if someone leaves for good.
- **No real reconnect.** The server holds a dropped player's seat for 60 s, but
  the client has no reconnect code: refreshing creates a new session, which
  can't enter the locked room.
- **Nothing persists.** No accounts, no database; fireflies and items vanish
  when the match (or server) ends. The server also scales to zero when idle.
- **Not built yet:** Flame risk meter, Lantern Path levels, keepsakes,
  cosmetics, sound, match-end payouts.
- **Balance is untuned:** prices and earn rates are first guesses.
- **Desktop only:** pattern stones need a right click (no touch equivalent),
  and the layout assumes about 760 px of width.
- **Name vs theme:** "GoCalypse" and the cozy lantern theme still disagree.

## 8. Recent history

| Commit | What changed |
|---|---|
| `03bc966` | Fixed a server crash from payload-less messages; duplicate colors after a pre-game leave; turn order by color; name validation |
| `4026f0b` | Pixel client live; fireflies, Night Market, 5 new items; debug room |
| `e3c4a84` | `ideas.md` and the standalone pixel preview |
| `bb81776` | Fixed room fragmentation (pre-game leaves, room locking) |
| `1809d53` | Split hover preview; coordinate label ghosting |
| `7258abd` | Each move chooses its front: left click color, right click pattern |

## 9. Gotchas learned the hard way

- **Colyseus merges client options into `onCreate` options.** Never read
  gameplay values (like starting fireflies) from them; use a room subclass.
- **Handler errors crash the server** unless the room defines
  `onUncaughtException`: an error in a message handler escapes into the
  WebSocket event loop.
- **`ArraySchema` can't `splice`-insert,** and `sort()` in the same patch as a
  `push()` corrupts client state. Keep `players` in join order and derive turn
  order instead.
- **`npx serve` 301-redirects** `/index.html?...` and drops the query string;
  `debug.html` passes parameters in the URL hash for that reason.
- **Check what's on port 2567** before trusting a local test run: a stale
  server process once silently served old code.
