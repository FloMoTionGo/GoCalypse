# GoCalypse

A 4-player custom Go variant, played online and synced live across all players.

**Play now:** [flomotiongo.github.io/GoCalypse](https://flomotiongo.github.io/GoCalypse/)
(client, hosted on GitHub Pages) — connects to the live server at
`wss://gocalypse.fly.dev`. Open 4 tabs to fill a room.

**Debugging:** `web/debug.html` fills one tab with all 4 players at once —
each a real independent client in its own `<iframe>` in a 2x2 grid,
auto-joining the same room with staggered delays so they don't race into
separate rooms. They join `go_debug` rooms: same rules, separate matchmaking,
everyone starts with 600 fireflies so the whole market can be tried, and the
weather die is rolled every 6 turns instead of 20.
`?server=...` in `debug.html`'s own URL overrides which server all 4 point at.

**Art:** a 5-colour pixel scene (a wooden pier standing in a lantern river,
water on all four sides) rendered in software from sprites defined in code:
`web/sprites.js` (palette, sprites, icons) and `web/pixelScene.js` (scene,
animations, weather). The board is drawn at the largest whole pixel scale
that still fits the window, so it fills the screen without ever blurring.
`web/pixel-preview.html` shows every sprite and animation without a server,
and can fire a thunderstorm on demand.

**Pattern stones** (the grey, pattern-axis pieces) are see-through, in one of
four designs. **Plain** (default) uses just white, black, grey and
transparent, no glyph at all — dots and stripes render pixel-identical.
**Glass** inlays the pattern in bright cream on a clear marble, **Paper**
prints it in grey on a pale wash, and **Wash** cuts it clean out of a frosted
body. Switch with the *Stones* button in the header,
`#stones=plain|glass|paper|wash` in the URL, or the preview page.

**Project docs:** `state.md` is a snapshot of what's built, live and missing;
`ideas.md` holds the plans and open design decisions.

Not standard Go rules — this is a free-for-all variant with black/white
stones distinguished by pattern (dots or stripes), and powerups bought at a
Night Market with fireflies earned in play (see below). Guests get a random
display name if not registered.

Each player has an identity along two axes, one of four combos. The combos
are dealt at random each game (never twice in one room), and turns go in
combo order, so black and white alternate and whoever gets combo 1 starts:

| Combo | Base  | Pattern |
|-------|-------|---------|
| 1     | black | dots    |
| 2     | white | dots    |
| 3     | black | stripes |
| 4     | white | stripes |

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
3 fight the base war together.

**Liberties are liberties, whoever fills them.** The front a stone commits
to decides who it *merges* with and who it can be captured *with* — not who
can suffocate it. A group is always judged on its own front, so a wall of
solid white stones kills a grey dots group by taking its last free point,
even though neither fights the other's war. That includes your own stones on
your other front. The one exception is the group the new stone joins: that
isn't a capture but suicide, which is still checked only on the one view the
stone participates in. See `server/src/rules/goRules.test.ts` for the exact
mechanics.

### Ending the game & scoring

On your turn you can **pass** (the *Pass* button in the header) instead of
placing a stone. When **all four players pass in a row** the game ends; a stone
or an item played in between starts the count again.

The board is then scored the normal Go way (**area scoring**), once on each
front:

- every stone counts one point for its side (black, white, dots or stripes),
- and so does every empty point whose empty region touches only that side's
  stones.

A stone that is a wall on a front (its owner committed it to the other front,
or it is driftwood) counts for no one there and doesn't spoil a region for
anyone, like the edge of the board. Nothing is removed first, since nobody is
there to agree what is dead: capture what should go before you pass. Stones
standing on a burning point still count.

That leaves four totals: black, white, dots and stripes. Every player belongs
to one side on each front (player 1, black + dots, to black and to dots), so
each has two totals of their own. **A player's final score is the lower of the
two; the higher one only breaks ties.** Players who share a side share its
total, and players level on both numbers share a place. The welcome screen
explains this too, and a *Results* window opens when the game ends.

Bots only pass when the board leaves them no legal move, so at a table with
bots the humans can't end the game on their own.

### Fireflies & the Night Market

Placing a stone earns **3 fireflies**, capturing earns **5 per stone**, and
losing a stone to someone's item — or to a lightning fire — pays you **3** as
consolation. A player's **Night Market** opens after their **5th move**.
Buying never takes your turn; using an item does. Items that fail (bad
target) aren't used up.

The market stocks **five of the seven items** per match, of which **at most
one is a powerful (removal) item** — which one is drawn fresh each match, so
Gust, Snipe and Firework take turns. Your **satchel holds five items** and
only **one powerful item** at a time; a purchase past either limit is refused
with a notice.

| Item | Price | Effect |
|---|---|---|
| Driftwood | 15 | Neutral log on an empty point: a wall on both fronts, owned by no one, uncapturable. Floats away after 3 rounds. Can't smother a group. |
| Lily Pad | 20 | Reserves an empty point for 3 rounds: only you may play there. |
| Lantern Ward | 30 | One of your groups can't be captured or removed until your next turn. If it has no liberties when the ward lapses, it's removed. |
| Turn the Lantern | 40 | Flips one of your stones to your other front (solid <-> grey pattern); captures count on the new front, and a former group-mate left with no liberties is captured too. Refused only if the flipped stone itself would have none. |
| Gust | 90 | Removes one enemy stone whose group is in atari. Once per match. |
| Snipe | 140 | Removes any single enemy stone. Once per match. |
| Firework | 200 | Clears a 3x3 area (your stones and driftwood too; warded stones are spared). Once per match. |

### Thunderstorms

Every **20 turns** the room rolls a die out of sight. On a **six** a storm
breaks: the night darkens, rain sweeps the board for about ten seconds, and
**up to three bolts** come down on random points (never on a warded point or
one already alight). Whatever stands there catches fire and **burns away
three rounds later** — its owner gets the usual 3-firefly consolation — and
**nobody may play on a burning point** until the fire goes out. Fires don't
take liberties: a burning point counts as empty for the purposes of staying
alive, it just can't be filled.

For those same **3 rounds** — not just the ten-second flash — **every stone
on the board loses its colour**: black, white and every pattern-stone design
all render as one shared dithered tone exactly between ink and slate, so the
storm erases whose stone is whose, not just how it's drawn. This is driven by
`GoState.storm.until` versus `GoState.turnCount`, so it survives past the
animation and a client joining mid-storm sees it too (`GoSprites.stormStoneSprite`
in `web/sprites.js`). Driftwood keeps its own look; sidebar, satchel and
market icons are unaffected — only stones already on the board go dark.

`go_debug` rooms roll every **6** turns instead, so a storm can actually be
watched in a test session (`src/rules/storm.ts`, `GoDebugRoom`).

Board code 9 is driftwood (see `goRules.ts`). Timed markers (wards, lily pads,
driftwood timers, lightning fires) are `GoState.effects`; `GoState.action`
records the last move or item so clients can play the matching animation, and
`GoState.storm` carries the last die roll and its strike points.

### Playing with bots

While a room is still waiting for its fourth player, the welcome screen (it
opens by itself on a first visit; **Add bots** in the header reopens it) has a
**Play with bots** menu: seat up to three bots, each playing differently. The
lanterns beside each name show how much of the Night Market it uses.

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
  - `src/rules/storm.ts` — when the weather die is rolled, what a six means
    and where the bolts land, kept apart from room state so it can be tested.
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
