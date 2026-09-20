# GoCalypse

A 4-player custom Go variant, played online and synced live across all players.

**Play now:** [flomotiongo.github.io/GoCalypse](https://flomotiongo.github.io/GoCalypse/)
(client, hosted on GitHub Pages) — connects to the live server at
`wss://gocalypse.fly.dev`. Open 4 tabs to fill a room.

**Debugging:** `web/debug.html` fills one tab with all 4 players at once —
each a real independent client in its own `<iframe>` in a 2x2 grid,
auto-joining the same room with staggered delays so they don't race into
separate rooms. They join `go_debug` rooms: same rules, separate matchmaking,
everyone starts with 1200 fireflies so the whole market can be tried, and the
weather die is rolled every 6 turns instead of 20.
`?server=...` in `debug.html`'s own URL overrides which server all 4 point at.

**Art:** a 5-colour pixel scene (a wooden pier standing in a lantern river,
water on all four sides) rendered in software from sprites defined in code:
`web/sprites.js` (palette, sprites, icons) and `web/pixelScene.js` (scene,
animations, weather). The board is drawn at the largest whole pixel scale
that still fits the window, so it fills the screen without ever blurring.
`web/pixel-preview.html` shows every sprite and animation without a server,
and can fire a thunderstorm on demand.

**Four stones:** black, white, gray and transparent. Black and white are
solid, gray is solid slate, and transparent is an ink ring with a glint and
nothing inside, so the board and its grid lines show through it. Each player
holds two of them, one of black/white and one of gray/transparent. The player
boxes beside the board show both at full board size with their names.

Not standard Go rules — this is a free-for-all variant with four kinds of
stone (black, white, gray and transparent), and powerups bought at a
Night Market with fireflies earned in play (see below). Guests get a random
display name if not registered.

Each player has an identity along two axes, one of four combos. The combos
are dealt at random each game (never twice in one room), and turns go in
combo order, so black and white alternate and whoever gets combo 1 starts:

| Combo | Left click | Right click |
|-------|------------|-------------|
| 1     | black      | gray        |
| 2     | white      | gray        |
| 3     | black      | transparent |
| 4     | white      | transparent |

But a stone doesn't carry both axes at once — each move, the player picks
which front that particular stone fights on:

- **Left click** — their black or white stone, fighting only in the **base
  view**: black vs white, the other front irrelevant.
- **Right click** — their gray or transparent stone, fighting only in the
  **pattern view** (the code's name for this second front): gray vs
  transparent, base irrelevant.

The two views are independent, simultaneous 2-team Go games sharing the
same board. A stone is **neutral on the axis it didn't commit to** — it
still occupies the cell (blocking a liberty there), but it never merges
into a group or gets captured on that other view, i.e. it's a wall. Since
two players always share the *other* axis (e.g. players 1 and 3 are both
black), stones from different players merge into one group when they share
a view's value — a black stone from player 1 and a black stone from player
3 fight the base war together.

**Liberties are liberties, whoever fills them.** The front a stone commits
to decides who it *merges* with and who it can be captured *with* — not who
can suffocate it. A group is always judged on its own front, so a wall of
solid white stones kills a gray group by taking its last free point,
even though neither fights the other's war. That includes your own stones on
your other front. The one exception is the group the new stone joins: that
isn't a capture but suicide, which is still checked only on the one view the
stone participates in. See `server/src/rules/goRules.test.ts` for the exact
mechanics.

### Ko

No move may **bring back a board position that has stood before** (positional
superko). Plain ko is not enough with four seats: a capture can be answered two
or three stones later by someone else, and the same board comes round again. Only the
stones count, not whose turn it is. A refused move says so (`rules/ko.ts`,
checked in `GoRoom.applyMove`); bots never offer such a move. Positions are not
part of a saved snapshot, so after a server restart the rule remembers from the
restored board on.

### Ending the game & scoring

On your turn you can **pass** (the *Pass* button in the header) instead of
placing a stone. When **all four players pass in a row** the game ends; a stone
or an item played in between starts the count again.

The board is then scored the normal Go way (**area scoring**), once on each
front:

- every stone counts one point for its side (black, white, gray or transparent),
- and so does every empty point whose empty region touches only that side's
  stones.

A stone that is a wall on a front (its owner committed it to the other front,
or it is driftwood) counts for no one there and doesn't spoil a region for
anyone, like the edge of the board. Nothing is removed first, since nobody is
there to agree what is dead: capture what should go before you pass. Stones
standing on a burning point still count.

That leaves four totals: black, white, gray and transparent. Every player
belongs to one side on each front (player 1, black + gray, to black and to gray), so
each has two totals of their own. **A player's final score is the lower of the
two; the higher one only breaks ties.** Players who share a side share its
total, and players level on both numbers share a place. The welcome screen
explains this too, and a *Results* window opens when the game ends.

Bots pass by judgement: a bot with nothing left worth playing (no capture, no
rescue, no threat, no growth of its own area, or a move that is plain self-atari)
passes rather than fill in its own territory. The drifter, the fallback that
keeps a stalled table moving, never passes while a legal point exists.

### Fireflies & the Night Market

Placing a stone earns **3 fireflies**, capturing earns **5 per stone**, and
losing a stone to someone's item — or to a lightning fire — pays you **3** as
consolation. A player's **Night Market** opens after their **5th move**.
Buying never takes your turn; using an item does. Items that fail (bad
target) aren't used up.

Items come in three **tiers**, and the market stocks **six per match: 3 of
tier 1, 2 of tier 2 and 1 of tier 3**, drawn fresh each match. The stall is one
per room, so every player and bot at the table shops from the same six. Only
tier 3 holds powerful (removal) items, so **at most one** is ever on sale. Your
**satchel holds five items** and only **one powerful item** at a time; a
purchase past either limit is refused with a notice.

Some items are **free**: they don't take your turn, you still move afterwards.
Prices grow with the tier: tier 1 costs 25-40, tier 2 45-80, tier 3 130-400.

**Tier 1**

| Item | Price | Effect |
|---|---|---|
| Firefly Jar | 25 | Free. Your captures earn double fireflies for the rest of this turn and your next 3. |
| Seedling | 30 | Plant a seed on an empty point. After 2 rounds, if the point is still empty and the stone would have a liberty, it grows into your stone. |
| Mist | 30 | Free. Your next stone is hidden in a mist until the end of the round: the others can't see which front it fights on. (The mist is drawn by the client; the game state still holds the stone.) |
| Driftwood | 30 | Neutral log on an empty point: a wall on both fronts, owned by no one, uncapturable. Floats away after 3 rounds. Can't smother a group. |
| Lily Pad | 40 | Reserves an empty point for 3 rounds: only you may play there. |

**Tier 2**

| Item | Price | Effect |
|---|---|---|
| Kite | 45 | Free. Fly it over an enemy stone: only you see what its player is holding and how many fireflies they have. |
| Ferry | 50 | Move one of your stones one step to an empty point beside it (pick the stone, then the point). Captures are judged as if you had played it there. |
| Lantern Ward | 60 | One of your groups can't be captured or removed until your next turn. If it has no liberties when the ward lapses, it's removed. |
| Twin Wick | 70 | Free. Your next stone fights on **both** fronts: it joins and captures on both, but is lost if either of its groups runs out of liberties. Can't be turned over. |
| Turn the Lantern | 80 | Flips one of your stones to your other front (black/white <-> gray/transparent); captures count on the new front, and a former group-mate left with no liberties is captured too. Refused only if the flipped stone itself would have none. |

**Tier 3**

| Item | Price | Effect |
|---|---|---|
| River Current | 130 | Washes away one enemy stone on the edge of the board. Once per match. |
| Echo Chime | 160 | Place a stone, and the chime places another for you on the opposite side of the centre point, if that point is free and legal. |
| Gust | 180 | Removes one enemy stone whose group is in atari. Once per match. |
| Stepping Stones | 200 | Free. Place two stones this turn: your next move doesn't end your turn. |
| Snipe | 280 | Removes any single enemy stone. Once per match. |
| Firework | 400 | Clears a 3x3 area (your stones and driftwood too; warded stones are spared). Once per match. |

The bots don't use the new items yet: they shop from their own lists, which only
name the older ones, so they simply skip what isn't on sale.

### Thunderstorms

Every **20 turns** the room rolls a **D20** out of sight and adds **1 for
every calm roll** since the last storm. At **20 or more** a storm breaks: the
night darkens, rain sweeps the board for about ten seconds, and
**up to three bolts** come down on random points (never on a warded point or
one already alight). Whatever stands there catches fire and **burns away
three rounds later** — its owner gets the usual 3-firefly consolation — and
**nobody may play on a burning point** until the fire goes out. Fires don't
take liberties: a burning point counts as empty for the purposes of staying
alive, it just can't be filled.

The chance of a storm at each roll starts at **5%** and grows **5% with every
calm roll**, then starts over after a storm. The sidebar's **storm forecast**
says so in words (5–10% *unlikely*, 15–25% *likely*, 30% and up *very likely*)
and counts down to the next roll.

The storm also **lasts for its full 3 rounds**, not just the ten-second
cloudburst: behind it a much weaker copy of the same weather (a faint dusk,
thin cloud, sparse rain) hangs over the river and banks and eases out through
the last round; the board gets a lighter share of it. For the storm's full three
rounds **every player stone is drawn the same slate grey**, so nobody can see whose
is whose. The rules do not change: captures and suicide still run on the real
colours, and players have to remember what they cannot see. The grey comes in with the
cloudburst and eases out through the last round. It is driven by `GoState.storm.until` versus `GoState.turnCount`, so
a client joining mid-storm sees it too (`stormLinger` in `web/pixelScene.js`).

`go_debug` rooms roll every **6** turns instead, so a storm can actually be
watched in a test session (`src/rules/storm.ts`, `GoDebugRoom`).

Board code 9 is driftwood and codes 10-13 are Twin Wick stones (see `goRules.ts`). Timed markers (wards, lily pads,
driftwood timers, lightning fires) are `GoState.effects`; `GoState.action`
records the last move or item so clients can play the matching animation, and
`GoState.storm` carries the last die roll, the forecast (`calm`, `chance`,
`level`, `every`) and its strike points.

### Reading the board

Anything that doesn't last shows a small **timer**: the rounds it has left (a
lily pad, driftwood, a ward or a fire; a ward covers a whole group, but only
its first stone carries the tag). It turns amber in the last round. A lily pad
or ward also carries its **owner's mark**, their two stones side by side, so you
can see whose it is. In the scene a little **boat** drifts along the river with
a sign showing the round being played ("R3", one round = every seat has moved once): scenery on its own clock, there
only for orientation.

### Playing with bots

Bots can be brought along from the **home screen** (a *Play with bots* menu
above the Join button; bringing bots starts a table of your own instead of
matching you with strangers), or added while a room is still waiting for its
fourth player: the welcome screen (it opens by itself on a first visit;
**Add bots** in the header reopens it) has the same menu. Pick up to **three of
each kind**, but **no more than three bots in all** (the server enforces this
too). Two of a kind are numbered ("Reed", "Reed 2"). The lanterns beside each
name show how much of the Night Market it uses.

| Bot | Plays | Night Market |
|---|---|---|
| Reed | Pure Go: stones only | Never buys, never uses an item |
| Tanuki | A fighter that goes looking for contact | Some: buys a ward or a removal item when it pays |
| Magpie | Market shark | Max: spends turns on items whenever one can do anything, and shops down the whole list |

Bots are strictly opt-in: nobody is ever seated at a table that didn't ask for
one. The one other time a bot plays is a seat whose player never came back
within the 60 s grace period, so the table doesn't stall. A table with no
humans left closes itself.

They are not AI in the machine-learning sense: nothing is trained and nothing
learns. Each is a hand-written scorer over the board (capture, saving stones,
ataris, cuts, shape) with different weights, taken from GoSequencer's classic
player, whose list of things to look at comes from Leela, Gian-Carlo
Pascutto's Go engine (https://github.com/gcp/Leela, MIT). No Leela source or
data is copied, and its search and neural networks are left out.

## Architecture

- `server/` — authoritative game server ([Colyseus](https://colyseus.io/)),
  holds the canonical board state per room and syncs it to all connected
  clients over WebSockets.
  - `src/state/GoState.ts` — synced schema (board, players, turn, etc).
  - `src/rules/goRules.ts` — hand-rolled capture/liberty/suicide rules,
    including the two-view model above (not a general Go rules library).
  - `src/rules/endgame.ts` — end-of-game area scoring and the per-player
    final score / tie-break / place, pure functions with their own tests.
  - `src/rules/storm.ts` — when the D20 is rolled, what a roll plus the calm
    bonus means, the forecast, and where the bolts land, kept apart from room
    state so it can be tested.
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
One machine is kept running (`min_machines_running = 1`, about $2/month):
letting Fly autostop an idle machine dropped players sitting in a lobby.

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
