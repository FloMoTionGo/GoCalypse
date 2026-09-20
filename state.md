# GoCalypse: Current State

Snapshot as of **2026-09-20** (working tree, on top of commit `765936d`).
What's built, where it runs, how it's tested, and what's missing. Plans and
open design questions are in [`ideas.md`](ideas.md); setup instructions are in
[`README.md`](README.md).

---

## 1. In one paragraph

GoCalypse is a 4-player online Go variant with custom two-front captures,
drawn as a cozy 5-color pixel scene: a wooden pier standing in a lantern-lit
river. Players earn **fireflies** by playing and, after their 5th move, can
spend them at the **Night Market**, which stocks 5 of the 7 powerups a night.
Every 20 turns a die decides the weather, and a six brings a **thunderstorm**
that sets fire to the board. It's live and playable, but matches never end,
nothing is saved between matches, and there's no Flame/progression system yet.

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
- **A group with no liberties dies, whoever filled them.** Every group is
  judged on its own front, so a ring of solid white stones kills a grey dots
  group, and your own stone can smother your own group on the other front.
  The mover is credited with every stone that comes off. (Until 2026-09-20
  captures were only ever checked on the *placed stone's* front, so groups
  sat on the board with no liberties — the bug that prompted this pass.)
- Suicide — the group the new stone *joins* having no liberties — is still
  checked only on that stone's own front, and is refused rather than removed.

### Fireflies and the Night Market
- **Earning:** +3 per stone placed, +5 per stone captured, +3 consolation per
  stone of yours removed by someone else's item or by a fire. Fireflies last
  one match.
- **Market:** opens for each player after their **5th placed stone** and stays
  open. Buying never takes your turn; **using** an item does. A use on an
  invalid target is refused, explained, and the item is kept.
- **Five stalls a night:** the market stocks 5 of the 7 items, of which at
  most **1 is a removal ("powerful") item**, drawn fresh per match
  (`marketStock()`). The other two aren't sold that match at all.
- **Satchel:** 5 items at once, of which **1 powerful**; buying past either
  cap is refused with a notice. Removal items are still once per match.
- There's no free starting kit.

### Weather
- Every **20 turns** (`GoState.turnCount`) the room rolls a die. On a **6** a
  thunderstorm breaks; the roll is kept in `GoState.storm` either way.
- Up to **3 bolts** hit random points — never a warded one or one already
  alight. Each lights a **fire** effect for **3 rounds**.
- A burning point **can't be played on** (by a stone, driftwood or a lily
  pad). It still counts as an empty liberty: fire can't strangle a group.
- Whatever stood on a struck point **burns away when the fire goes out**, and
  its owner is paid the 3-firefly consolation. Nobody scores it.
- The client plays the storm as a 10-second scene: dusk, cloud, rain, then the
  bolts at 2.4 / 4.4 / 6.4 s, each lighting its fire as it lands.
- **Every stone on the board goes one colour for the full 3 rounds**, not just
  the 10-second flash: while `GoState.turnCount` is below `GoState.storm.until`
  (set the moment a storm breaks, synced to every client), black, white and
  every pattern-stone design all render as the same shape in one dithered
  tone exactly between ink and slate (`G.stormStoneSprite()`), so the storm
  erases whose stone is whose, not just how it's coloured. A client that
  joins mid-storm gets this without ever seeing the cloudburst. Driftwood
  keeps its own look; it isn't anyone's stone. Sidebar icons, satchel and
  market are unaffected — only stones already on the board go dark.
- `go_debug` rooms roll every **6** turns so storms can be watched in testing.

| Item | Price | What it does |
|---|---|---|
| Driftwood | 15 | A neutral log on an empty point: a wall on both fronts, owned by no one, uncapturable. Floats away after 3 rounds. Refused if it would leave a group with no liberties — neutral pieces never capture, which also keeps a 15-firefly log from doing Gust's 90-firefly job. |
| Lily Pad | 20 | Reserves an empty point for 3 rounds: only you may place there. Expires at the start of your own turn 3 rounds later, so you get 2 own turns to use it. |
| Lantern Ward | 30 | Your group can't be captured or removed until your next turn. If it has no liberties when the ward lapses, it's removed (credited to no one). |
| Turn the Lantern | 40 | Flips one of your stones between solid and grey. Captures count on the new front, and a former group-mate the flip strands is captured too. Refused only if the flipped stone itself would have no liberties. |
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
`debug.html` shows 4 real clients (**820x860** panels — wide enough for the
board at 2x plus the sidebar, with no inner scrollbar) that auto-join a
**`go_debug`** room: same rules, separate matchmaking pool, everyone starts
with **600 fireflies**, and the weather die is rolled every **6** turns
instead of 20. The 5-move gate still applies. Both debug values live in a
server subclass (`GoDebugRoom`), so a client can't request them. The panels
share `localStorage`, so the first-visit welcome screen opens in panel 1 only
(hash param `nowelcome` on the others).

## 4. Look & feel

- **Palette (5 colors):** ink `#1f1a24`, cream `#f4e8c8`, amber `#d49040`,
  teal `#2e6b73`, slate `#767d88`. In-between tones are ordered dithering.
  The page UI uses the same five colors.
- **Scene:** 254x284 native pixels. The deck is a **pier standing in the
  river**: water runs all the way around it (a channel above, one down each
  side, the wide river below), with a far bank at the top carrying the lantern
  garland and a near bank at the bottom. Board spacing is 16 native px, stones
  15 px. Floating lanterns ride the current right along the top, down the
  right-hand channel and out along the river. There are hanging lanterns, a
  stone lantern, reeds, lily pads and fireflies. The playing surface is never
  lit, so stones stay readable.
- **Size:** the canvas is drawn at the largest **whole number of device
  pixels** per native pixel that leaves room for the sidebar and the lines
  under the board (`sizeCanvas` in `main.js`, 1x–6x). A 1080p window gets 3x
  (762x852 CSS px), a 1440p one 4x; the 820px debug panels get 2x.
- **Pattern stones** are see-through in one of four designs — **Plain**
  (default: white, black, grey, transparent, no glyph at all — dots and
  stripes render pixel-identical), **Glass** (cream pattern inlaid in a
  clear marble), **Paper** (pale wash, grey pattern), **Wash** (frosted
  body, pattern cut out). `GoSprites.setPatternStyle`, the header's *Stones*
  button, `#stones=` in the URL, or the preview page. In glass/paper/wash,
  dots are three fat pips, stripes three broad diagonal bands, and the body
  is kept clear of the mark so it reads at 15 px.
- **Board UI:** pixel coordinates 0–12. Hovering shows a half solid / half
  pattern ghost stone and highlights that row and column (never over a burning
  point). A glowing ember marks the last move. Lily pads show a mini split
  stone in the owner's colors. Warded stones get a turning ring of light and a
  small lantern. Burning points get a bed of embers and a flame.
- **Animations:** placement (drop, squash, ripple) and capture (shiver, flash,
  rises as a lantern). Each item has its own: driftwood splashes down and later
  drifts off, the lily pad unfurls, ward lanterns drop in, the flipped stone
  turns edge-on, Gust sweeps a stone away, Snipe sights close in, Firework
  bursts. A burnt stone shrivels and goes up as smoke (`burnAway`), never as a
  captured lantern. `prefers-reduced-motion` freezes ambience, shortens effects
  and drops the rain (dusk and bolts stay).
- **Storm:** dusk over the whole scene (a dithered shade ramp), painted cloud
  masses drifting across, slanting rain, and per bolt a jagged cream channel
  from the top of the scene to the struck point, with two passes of the light
  ramp blowing the sky out to cream for a frame. Fires are drawn *over* the
  weather, since they're the one thing the storm doesn't dim.
- **Performance:** a full calm frame renders in about 0.5 ms; a storm frame
  adds two full-surface passes. The client redraws at up to 30 fps and pauses
  in hidden tabs.

## 5. Code map

```
server/src/
  index.ts               defines rooms "go_custom" and "go_debug"
  rooms/GoRoom.ts        join/leave, turn order, moves, market, items, timed effects,
                         the weather roll; GoDebugRoom (600 fireflies, storms every 6 turns)
  rules/goRules.ts       two-front captures, suicide, driftwood, flipStone, canPlaceNeutral
  rules/goRules.test.ts  18 rule tests (npm test)
  rules/storm.ts         when to roll, what a 6 means, where the bolts land
  rules/storm.test.ts    5 weather tests
  powerups/definitions.ts  the 7 items (price, removal flag, apply) + marketStock()
  powerups/definitions.test.ts  5 market-stock tests
  powerups/types.ts      PowerupContext / PowerupDefinition
  state/GoState.ts       synced schema
web/
  index.html, style.css  game page (5-color theme)
  main.js                client: state -> scene, input, sidebar, market, satchel, storms
  sprites.js             palette, sprites, pattern-stone designs, fonts, icons, rasterizer
  pixelScene.js          scene renderer, effect timelines, weather, diffTurn (browser + Node)
  debug.html             4 clients in one tab (go_debug), 820x860 panels
  pixel-preview.html     every sprite and animation, storm demo, design switcher; no server
```

**Board codes:** `0` empty · `1–4` a player's solid stone · `5–8` that
player's grey pattern stone (player + 4) · `9` driftwood.

**Synced state (`GoState`):** `size`, `board`, `players` (in join order),
`turnIndex` (an index into `players`), `status`, `turnCount`, `lastEvent`,
`shopAfter`, `satchelLimit`, `powerfulLimit`, `market` (the 5 items on sale),
`effects` (timed wards, lily pads, driftwood timers and lightning fires, each
ending when `turnCount` reaches `until`), `action` (the last move or item use,
which the client uses to pick animations) and `storm`. `StormState` holds
`seq` (bumped only when a storm breaks — the client's trigger), `roll`,
`rolledAt`, `until`, `strikes` and the three `strike0..2` board indices; plain
fields rather than an array, to stay clear of the ArraySchema patching quirks.
`PlayerState` has `sessionId`, `name`, `color`, `connected`, `score`,
`fireflies`, `moves`, `powerups` (owned items) and `bought`.

**Messages:** client to server `move {x, y, axis}`, `buy {id}`,
`usePowerup {id, target: {x, y}}`. Server to client: `notice` (text
explaining a refused action). Every handler validates its payload, and the room
defines `onUncaughtException`, so a bad message can't crash the process.

## 6. Testing

**In the repo:** `npm test` in `server/`: **28** tests (Node's built-in test
runner, no extra dependency) — 18 rules, 5 weather, 5 market stock.

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
- **2026-09-20 run** (`play.js`, 8 checks, all passing): four clients in one
  room; a pattern stone ringed by base stones dies; a storm breaks and lights
  fires; a burning point refuses a stone; the fires go out on time; the board
  scales to fit with the sidebar beside it; no scrolling inside a panel; the
  market stocks five items. A second script (`burn.js`) plays ~130 turns of
  spread-out stones until a bolt lands on one, and checks it burns away three
  rounds later and its owner is paid. `preview.js` drives
  `pixel-preview.html` for storm and pattern-design screenshots.

All of the above passed locally on 2026-09-20 (production not yet redeployed).

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
- **Balance is untuned:** prices and earn rates are first guesses. The new
  liberty rule makes captures much more common (a bot filling points
  sequentially now loses nearly everything it places), and storms add a second
  source of losses — both want playtesting.
- **Desktop only:** pattern stones need a right click (no touch equivalent),
  and the layout assumes about 800 px of width.
- **The pattern-stone design is per browser, not per player:** the *Stones*
  button is a local preference, not something the room knows about, and it
  isn't remembered between visits.
- **Name vs theme:** "GoCalypse" and the cozy lantern theme still disagree.

## 8. Recent history

| Commit | What changed |
|---|---|
| (working tree) | Liberty rule fixed (any 0-liberty group dies); thunderstorms and fire; see-through pattern stones in 3 designs; market cut to 5 items / 1 powerful and a 5-item satchel; river all around the board; board scales to the screen |
| `765936d` | Deal color/pattern combos at random each game |
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
  server process once silently served old code. `npm run build` overwrites
  `build/`, but a *running* `node build/index.js` keeps the old code in
  memory — kill it and restart, or the test measures the previous version.
- **Draw fires after the weather, not before.** The storm's shade ramp is
  applied to the whole surface, and shading ink gives ink: anything drawn
  before it that was meant to glow simply disappears.
- **A light ramp only warms by one step** (ink -> amber, amber -> cream). A
  lightning flash needs two passes to blow the scene out to cream; one pass
  just makes everything look sunlit.
