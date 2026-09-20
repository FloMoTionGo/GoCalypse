# GoCalypse: Ideas & Open Design Decisions

Working notes for turning GoCalypse into a **cozy, pixel-sprite, lantern-themed**
4-player Go variant. The game should reward bold play and never punish players:
risk earns more, and failing costs less than you'd expect. The cutthroat layer
(stealing, targeting leaders, betrayal) is **deliberately parked for later**
(see section 8).

What's actually built and live is described in [`state.md`](state.md). This
file is the plan: ideas, and the decisions still to make.

Status legend: ✅ live in the game · 💡 idea only

*Last updated 2026-09-19.*

---

## 1. Design pillars

1. **Cozy first.** Warm lantern light, a gentle river, soft sounds. Nothing
   screams at you. Losing a group looks like lanterns floating away.
2. **Rewarding, not punishing.** Every finished match pays out something.
   Currency and levels are never taken away. Stones removed by items give their
   owner a small consolation payment (✅ live: +3 per stone).
3. **Risk is the fun.** Bold moves (self-atari, invasions, playing the harder
   pattern axis) fill a push-your-luck meter that multiplies what you earn.
4. **Removal is rare and precious.** Items that delete stones are the most
   expensive in the shop, work only once, and are limited per match (✅ live).
5. **Readable at a glance.** Pixel art must never make the four stone looks
   (solid black, solid white, grey+dots, grey+stripes) hard to tell apart.

---

## 2. Progress system: Flame, Fireflies & the Lantern Path

Three layers, from short-term to long-term:

| Layer | What it is | Lifetime | Status |
|---|---|---|---|
| **Flame** 🔥 | Push-your-luck risk meter, 0–10+ | One match | 💡 |
| **Fireflies** ✨ | Soft currency, spent at the Night Market | Designed: permanent. Live: one match | ✅ in-match only |
| **Lantern Path** 🏮 | Account level, earned from total fireflies ever earned | Permanent, never goes down | 💡 |

### 2.1 Flame: rewarding risky play 💡

Each player has a Flame meter during a match. Risky plays raise it:

| Risky play | Flame | How the server detects it |
|---|---|---|
| **Brave stone**: your placed stone's group has exactly 1 liberty on its own axis (self-atari) | +2 | `findGroup` on the placed stone's axis after captures |
| **...and it survives** until your next turn | +2 more | Recheck that group at the start of your next turn |
| **Close quarters**: the stone touches ≥ 2 opposing stones on its axis | +1 | Neighbor scan |
| **Pattern capture**: a capture made with a grey (pattern-axis) stone | +1 per stone | `axisOf(placedCode)` in `handleMove` |
| **Front switch**: a capture on the other axis than your previous move | +1 | Store the last axis per player |
| **Underdog wind**: you're last in score | all Flame gains ×1.5 | Compare scores |

**What Flame does:** firefly income from captures is multiplied by
`1 + Flame / 10`, so a Flame of 10 doubles your capture income.

**Banking (the push-your-luck part):** at the start of your turn you can
**Light the lantern**, a free action that converts Flame into fireflies
(`Flame × 3`) and resets the meter to 0. Keep it burning for a bigger multiplier,
or bank it while it's safe.

**Setbacks, not punishment:**
- If a brave stone gets captured, Flame drops by **half** (rounded down), never
  to zero, and you still get **+1 firefly** for the attempt.
- Banked fireflies can never be lost.
- At match end, unbanked Flame auto-banks at **50%** ("the lantern still glows").

### 2.2 Firefly income

**Live today ✅ (in-match economy):**

| Source | Fireflies |
|---|---|
| Placing a stone | 3 |
| Each stone you capture (by a move or by Turn the Lantern) | 5 |
| Your stone removed by someone else's item (consolation) | 3 |

At 3 per move, the cheapest item (15) is affordable exactly when the market
opens after 5 moves. The most expensive (200) takes about 67 moves without
captures, fewer with them.

**Designed 💡 (per-match payouts, once matches can end, see D-G5):**

| Source | Fireflies |
|---|---|
| Finishing a match (any placement) | 20 |
| Placement bonus: 1st / 2nd / 3rd / 4th | 30 / 20 / 15 / 10 (a narrow spread on purpose) |
| Each captured stone | 2 × Flame multiplier |
| Banked Flame | Flame × 3 |
| First match of the day | +25 |

Target: a typical match pays **~60–100 fireflies**, so a tier-1 item costs
about a quarter of a match and the most expensive removal item costs 2–3
matches. The live and designed numbers don't fit together yet (D-G6).

### 2.3 Lantern Path (levels) 💡

- XP = total fireflies ever **earned**. Spending doesn't reduce it, so buying
  things never slows your progress.
- Each level lights one more lantern along a river path (a cozy progress screen).
- Level rewards, never raw board power:
  - Lv 2: Satchel slot 3 · Lv 3: Night Market "Tonight's special" stall
  - Lv 5: first stone skin · Lv 7: Twin Wick appears in the market
  - Lv 10: second board skin · Lv 12: removal items unlock in the market
  - Every few levels: cosmetics (capture effects, lantern colors, weather)
- End-of-match **Lantern Release**: every stone you captured becomes a lantern
  you release onto the river. This is where the payout is shown.

---

## 3. The Night Market (shop)

**Live today ✅:** an **in-match** market in the sidebar. It opens for each
player after their **5th placed stone** and stays open. Buying never takes your
turn; using an item does. Bought items sit in your **Satchel** (a grid of icons)
until used; nothing carries over to the next match. Each removal item can be
bought once per match. Items are consumed **only when successfully used**; a
refused use explains why and keeps the item.

**Designed 💡 (needs persistence, D-T1):** a riverside stall run by a keeper
character (D-N3), visited **between matches**. Purchases go into a permanent
inventory, and you pack up to **3 powerups into your Satchel** before each
match (more with upgrades). Unused Satchel items return to the inventory after
the match.

- A daily rotating **Tonight's special**: one item at 30% off. 💡
- No real-money purchases (D-M1).

**Market tabs (designed):**
1. **Satchel goods**: consumable powerups (section 4). ✅ in-match version live
2. **Keepsakes**: permanent upgrades (section 5). 💡
3. **Trinkets**: cosmetics (section 6). 💡

---

## 4. Powerups (consumables)

Seven items are live ✅ with prices, rules and pixel animations: the five new
ones (Driftwood, Lily Pad, Lantern Ward, Turn the Lantern, Gust) plus Snipe and
the old Bomb (renamed Firework), repriced as removal items. The free starting
kit is gone. Prices below are the live ones; the rest are still ideas.

### 4.1 Cozy & constructive (tier 1: 15–30 ✨)

| Item | Effect | Price | Status |
|---|---|---|---|
| **Driftwood** | A neutral log on an empty point: a wall on both fronts, owned by no one, uncapturable. Floats away after 3 rounds. Refused if it would leave any group without liberties. Animation: splashes down; drifts off downstream when it expires. | 15 | ✅ |
| **Lantern Light** | For one turn, highlights every group in atari (1 liberty) on both axes, for you only. A learning aid. | 15 | 💡 |
| **Lily Pad** | Reserves an empty point for 3 rounds: only you may place there (a guaranteed liberty or eye). Animation: unfurls with sparkles and shows a mini stone in the owner's colors. | 20 | ✅ |
| **Firefly Jar** | Your captures earn double fireflies for your next 3 turns. | 20 | 💡 |
| **Tea Break** | Pass your turn and bank your Flame at ×1.5. | 20 | 💡 (needs Flame) |
| **Seedling** | Plant a seed on an empty point. After 2 rounds, if the point is still empty and has a liberty, it grows into your stone (axis chosen when planting). | 25 | 💡 |
| **Lantern Ward** | Your group can't be captured or removed until your next turn. If it has no liberties when the ward lapses, it's removed. Animation: rings of light bloom and lanterns drop onto the stones; warded stones keep a turning ring. | 30 | ✅ |
| **Lucky Koi** | Your next risky play earns double Flame. | 30 | 💡 (needs Flame) |
| **Mist** | Your next stone's axis stays hidden from others until the end of the round (needs per-player state filtering). | 30 | 💡 |

### 4.2 Tactical & axis play (tier 2: 35–70 ✨)

These use GoCalypse's unique two-axis rule, where each stone fights on the
base front (black vs white) or the pattern front (dots vs stripes).

| Item | Effect | Price | Status |
|---|---|---|---|
| **Ferry** | Move one of your stones one step to an adjacent empty point. Captures are checked afterward. (Needs a two-step target UI.) | 35 | 💡 |
| **Anchor Stone** | One of your stones becomes immune to removal items for the rest of the match. The counter to Snipe. | 35 | 💡 |
| **Turn the Lantern** | Flips one of your stones between solid and grey. Captures count on the new front. Refused if it would leave the stone or a former group-mate without liberties. Animation: the stone lifts, turns edge-on and lands showing its other face. | 40 | ✅ |
| **Lantern Bridge** | Two of your diagonal stones count as connected for 3 rounds. | 40 | 💡 |
| **Stepping Stones** | Place two stones this turn. | 45 | 💡 |
| **Twin Wick** | Your next stone fights on **both** axes: it merges and captures on both fronts, but it's also vulnerable on both. High risk: +3 Flame. | 60 | 💡 |

### 4.3 Removal (tier 3: 90–200 ✨, once per match each)

The victim always gets **+3 fireflies per removed stone** ✅. Warded stones
can't be removed ✅.

| Item | Effect | Price | Status |
|---|---|---|---|
| **Gust** | Removes one enemy stone whose group is in atari (only that stone). Animation: wind sweeps in and the stone tumbles away. | 90 | ✅ |
| **River Current** | Washes away one enemy stone on the board edge. | 120 | 💡 |
| **Snipe** | Removes any single enemy stone. Animation: sights close in, then it rises as a lantern. | 140 | ✅ |
| **Firework** (was Bomb) | Clears a 3x3 area, including your own stones and driftwood; warded stones are spared; refused on an empty area. Animation: flash, ring and starburst. | 200 | ✅ |

### 4.4 Even more ideas (parking lot) 💡
- **Moonlit Swap**: swap the positions of one of your stones and an adjacent empty point.
- **Heron's Patience**: skip your turn and gain one free tier-1 item next match.
- **Rain Shower**: all driftwood and lily pads on the board dissolve.
- **Echo Chime**: after your move, place a free stone mirrored across tengen, if that point is empty and legal.
- **Kite**: look at which items an opponent packed in their Satchel.

---

## 5. Keepsakes (permanent upgrades) 💡

Principle (see D-G2): **no permanent board power**. Keepsakes improve the
economy, the Flame meter or convenience, never stones or liberties, so a
level-1 player and a level-30 player play the same game on the board.
All of these need persistence (D-T1).

| Keepsake | Effect | Price |
|---|---|---|
| **Warm Welcome** | First market purchase each day is 20% off. | 150 |
| **Deep Pockets I / II / III** | +5% fireflies per tier. | 150 / 300 / 500 |
| **Bigger Satchel I / II** | +1 Satchel slot per tier (3 → 5). | 200 / 400 |
| **Steady Flame** | A captured brave stone only costs 1/3 of your Flame instead of 1/2. | 250 |
| **Lantern Collector** | Unbanked Flame auto-banks at 75% instead of 50% at match end. | 250 |
| **Ember Start** | Start every match with 2 Flame. | 300 |
| **Keeper's Favor** | At match start, choose one free tier-1 item from 3 random ones. | 400 |

---

## 6. Trinkets (cosmetics) 💡

- **Stone skins**: river pebble, jade, paper lantern, frosted glass. They must
  keep the black / white / grey+dots / grey+stripes readability rule.
- **Board skins**: kaya deck (default ✅), bamboo raft, lotus-pond pier, snowy jetty.
- **Placement trails**: petals, sparks, water ripples.
- **Capture effects**: rising lanterns (default ✅), koi splashing away, a firefly swarm.
- **Weather / time of day**: dusk, full moon, gentle rain, first snow, festival fireworks.
- **Player spirit (avatar)**: frog, fox, tanuki, heron, otter.
- **Nameplate lantern color** and a small emote set (bow, tea, cheer, sleepy).

---

## 7. Design decisions

Ticked = decided and live. Where there's a recommendation it's marked **Rec**.
Ticked items can still be revisited; they just describe what's live now.

### 7.1 Art direction

- [x] **D-A1 Reference style.** *Stardew Valley* + *Duelyst*: Stardew for the
      warm scene and ambient life, Duelyst for crisp ink outlines and snappy
      animations with anticipation and follow-through.
- [x] **D-A2 Palette size.** **5 colors total** (the strict reading), with
      in-between tones from dithering. You approved the preview built this way.
- [x] **D-A3 The 5 colors.** Ink `#1f1a24`, cream `#f4e8c8`, amber `#d49040`,
      teal `#2e6b73`, slate `#767d88`. Grey got its own slot (instead of moss)
      because dots and stripes on an ink+cream dither were too noisy. The cost:
      grass and lily pads are teal or dark, never green.
- [x] **D-A4 Native resolution & scale.** 16 native px per grid spacing,
      15 px stones. The scale is no longer fixed at 2x: the client picks the
      largest whole number of *device* pixels per native pixel that still fits
      the window beside the sidebar (1x–6x), so the board fills the screen and
      every sprite pixel stays square.
- [x] **D-A5 Perspective.** Straight top-down.
- [x] **D-A6 Outline style.** Ink outlines on stones and props; the scene
      itself is mostly outline-free.
- [x] **D-A7 Lighting.** Dithered light pools around lanterns and fireflies;
      the playing surface is never lit.
- [x] **D-A8 Scene composition.** The board is a wooden pier standing *in*
      the river: water runs all the way round it (a channel above, one down
      each side, the wide river below), with a far bank at the top carrying
      the lantern garland and a near bank at the bottom. Floating lanterns
      ride the current along the top, down the right-hand channel and out
      along the river. Hanging lanterns, a stone lantern, reeds, lily pads,
      fireflies.
- [ ] **D-A9 Time of day.** Fixed night today. A slow cycle during a match
      (dusk → night → festival) is open. Weather now varies within a match
      (see D-G7), which is a first step toward it.
- [x] **D-A13 Pattern stones.** The grey pattern stones are **see-through**,
      so the grid reads straight through them and they can never be taken for
      a solid stone. Four designs ship — **Plain** (white, black, grey,
      transparent, no glyph at all, **the default** as of 2026-09-20; dots and
      stripes render pixel-identical, which trades away telling the two
      pattern teams apart by colour), **Glass** (cream pattern inlaid in a
      clear marble), **Paper** (pale wash, grey pattern) and **Wash** (frosted
      body, pattern cut out) — switchable from the header, the URL or the
      preview page. Open: whether to keep all four, and whether the choice
      should be remembered per browser.
- [ ] **D-A10 UI chrome.** The sidebar uses the 5 colors with a system font;
      only the board has a pixel font. Open: pixel font for all UI, wooden
      panels, paper-lantern buttons.
- [ ] **D-A11 Cursor & hover.** Live: split half/half hover preview and
      highlighted coordinate tags. Open: a pixel cursor.
- [ ] **D-A12 Wood grain.** The kaya grain is drawn as dotted cream lines,
      which can read as scratches. Keep, soften, or drop?

### 7.2 Readability & player identity

- [ ] **D-R1 Owner marks.** Stones from teammates on an axis look identical
      (players 1 & 3 both place solid black). Add a tiny owner pip, or keep
      them identical on purpose?
- [ ] **D-R2 Player identity.** Live: each player is shown by a pair of mini
      stones (base + pattern), which is unique per player and also marks lily
      pads. Open: spirits/avatars, nameplate lanterns.
- [x] **D-R3 Last-move marker.** A glowing ember on the stone.
- [ ] **D-R4 Accessibility.** Live: `prefers-reduced-motion` freezes ambience
      and shortens effects. Open: a high-contrast stone mode, a color-blind
      check of the palette.

### 7.3 Motion & feel

- [x] **D-F1 Animation frame rate.** Frame-based pixel animation (ambience at
      10 fps, effects on millisecond timelines), redrawn at up to 30 fps.
- [x] **D-F2 Placement animation.** Drop, squash, ripple. (Sound: see D-S1.)
- [x] **D-F3 Capture animation.** Captured stones pop into lanterns that rise
      and fade. Driftwood drifts downstream; Gust blows its stone away.
- [x] **D-F4 Powerup animations.** Every live item has its own (section 4).
- [x] **D-F5 Performance budget.** ~0.5 ms per frame, so 4 animated clients in
      `debug.html` are no problem; hidden tabs pause.

### 7.4 Audio

- [ ] **D-S1 Soundscape.** Lo-fi ambient loop, river water, crickets, a wooden
      stone clack, soft chimes for purchases and captures.
- [ ] **D-S2 Mute & volume UI**, and whether sound is on by default.

### 7.5 Narrative & naming

- [ ] **D-N1 The name.** "GoCalypse" vs a cozy lantern theme is a real
      tension. Options: rename (e.g. *Lantern Go*, *Riverlight*), or lean into
      it ("after the world ended, people float lanterns and play Go").
- [ ] **D-N2 Setting.** One match = one festival night on the river?
- [ ] **D-N3 Market keeper.** A character who runs the Night Market (an old
      toad, a tanuki, a heron?) and is the voice of tutorials and tips.
- [ ] **D-N4 Currency names.** "Fireflies" is in use; Flame and Lantern Path
      are still proposals.

### 7.6 Game & economy

- [x] **D-G1 When can you shop?** Live: **in-match**, after a player's 5th
      move, buying anytime, as you asked. Once persistence exists, decide
      whether a between-match market replaces or adds to it.
- [ ] **D-G2 Permanent power.** Rec: keepsakes never affect the board, only
      the economy and convenience, so matches stay fair.
- [x] **D-G3 Removal limits.** Tightened on 2026-09-20: the market stocks
      **five of the seven items, at most one of them a removal item** (drawn
      fresh per match, so Gust, Snipe and Firework take turns), and a player's
      satchel holds **five items with only one powerful one** at a time. Each
      removal item is still once per match on top of that. Open: whether a
      fixed nightly stock would be better than a random draw.
- [x] **D-G4 Firework hits your own stones.** Kept as a risk element; warded
      stones are spared. Open: give Flame for it once Flame exists.
- [x] **D-G5 Match end condition.** All four players passing in a row ends the
      match (`GoRoom.applyPass` / `finishGame`). The board is scored with area
      scoring on each front and a player's score is the lower of their two
      sides, the higher one breaking ties (`rules/endgame.ts`). Still open:
      payouts, rankings and progression need wiring to `PlayerState.place`;
      bots never pass by choice (only when they have no legal move); no rematch.
- [ ] **D-G6 Numbers.** Tune the live economy (3 / 5 / 3, prices 15–200,
      market after 5 moves) and the designed Flame and payout tables after
      playtests, and make the two fit together.
- [x] **D-G7 Free starting kit.** Removed; everything is bought.
- [x] **D-G8 Players who leave mid-game.** A bot takes over the seat once the
      60 s reconnect grace runs out (`GoRoom.onLeave`); the seat still shows as
      the player's. Bots can also be seated up front from the welcome screen.
      Still open: what a returning player gets back if they arrive after the
      takeover (D-T7 covers reconnecting at all).
- [ ] **D-G9 Lily Pad timing.** It expires as its owner's third turn begins, so
      the owner gets 2 turns to use it. Extend it through that third turn?
- [ ] **D-G10 Gust scope.** It removes only the targeted stone of a group in
      atari. Should it take the whole group (much stronger, maybe pricier)?
- [x] **D-G11 Liberties.** A group dies when it has no liberties, **whoever
      filled them** — a wall of one colour smothers a pattern group, and your
      own stone can smother your own group on the other front. Before
      2026-09-20 captures were only checked on the placed stone's own front,
      which left dead groups sitting on the board. Suicide (the group the new
      stone joins) is still refused rather than removed.
- [x] **D-G12 Weather.** Every 20 turns the room rolls a die; a six brings a
      **thunderstorm**: up to 3 bolts set fire to random points, a burning
      point can't be played on for 3 rounds, and whatever stood there burns
      away when the fire dies (3 fireflies consolation, no score). Fires don't
      take liberties. For those same 3 rounds every stone on the board also
      loses its colour, rendering as one shared dithered tone between ink and
      slate regardless of team or pattern-stone design (added 2026-09-20,
      tied to `GoState.storm.until` so it outlasts the ~10s cloud/rain
      animation and survives a client joining mid-storm). Open: should a
      storm also *end* something (a round bonus?), are three bolts on a
      13x13 board too many, and does blacking out every stone (rather than
      just the pattern ones) make a storm too disorienting in a long game?
- [ ] **D-G11 Consolation for item captures.** Stones captured by Turn the
      Lantern pay no consolation (they count as normal captures). Keep?

### 7.7 Tech & persistence

- [ ] **D-T1 Where progress lives.** There are no accounts, only guests. Items
      affect multiplayer matches, so the **server** must own inventories
      (otherwise anyone could edit localStorage and get infinite Snipes). Rec:
      an anonymous device token in localStorage + SQLite on a Fly.io volume
      (fits the existing single-machine setup).
- [ ] **D-T2 Accounts later?** Optional sign-in to carry progress across devices.
- [x] **D-T3 Rendering approach.** Sprites defined in code, rendered into a
      native-resolution pixel buffer and scaled up with
      `image-rendering: pixelated`. The same code renders PNGs in Node for tests.
- [x] **D-T4 Animation loop.** A `requestAnimationFrame` loop capped at 30 fps.
- [ ] **D-T5 Hidden information.** Mist and Kite need per-player state
      filtering (Colyseus `StateView` / filters). Worth it, or cut those items?
- [x] **D-T6 Layout.** The scene is 480x558 CSS px next to a 220 px sidebar;
      `debug.html` panels are 760x860 so nothing scrolls inside them.
- [ ] **D-T7 Reconnect.** The server holds a dropped player's seat for 60 s,
      but the client can't reconnect (a refresh is a new session). Add
      `client.reconnect()` with the stored reconnection token.
- [ ] **D-T8 Touch & mobile.** Pattern stones need a right click, which touch
      screens don't have (long-press? a front toggle?), and the layout assumes
      ~760 px of width.
- [ ] **D-T9 Tests in the repo.** The integration, room, pixel and headless-
      browser tests that verified the market live outside the repo and will be
      lost. Move them into the repo (and CI?).

### 7.8 Monetization

- [ ] **D-M1 Real money.** Rec: none in the market (fireflies are earned only).
      If money is ever needed, cosmetic-only, or the unobtrusive ads mentioned
      at hosting time.

---

## 8. Parked for later: the cutthroat layer

Intentionally **not** designed yet. Ideas to revisit:
- Stealing Flame or fireflies from other players.
- Bounties on the leading player.
- Temporary alliances with betrayal payouts.
- Items that target a specific player instead of a board point.
- Ranked mode, where keepsake balance and removal limits would need another look.

---

## 9. Implementation notes (for whoever builds next)

- **Adding an item:** define it in `server/src/powerups/definitions.ts`
  (price, `removal`, `apply`) and add it to `REGISTRY`; the market fills
  itself from that list. The client needs an icon in `powerupIcon()`
  (`web/sprites.js`) and, for a custom animation, a timeline in
  `web/pixelScene.js` plus a case in `diffTurn`. Items currently all target one
  board point and take the turn when used.
- **Timed board markers** (like wards, lily pads, driftwood) are
  `GoState.effects` entries that end when `turnCount` reaches `until`;
  `addEffect(kind, x, y, owner, rounds)` and `expireEffects()` in `GoRoom.ts`
  handle them.
- **Flame detection** fits into `GoRoom.handleMove`: after `applyCaptures`, run
  `findGroup(rawBoard, size, x, y, axisOf(code))` for the liberty count, and
  store a per-player "brave stones to recheck" list for the next turn.
- **Neutral pieces** exist: board code 9 is driftwood, and `goRules.ts`
  treats any non-player code as a wall on both views (`isPlayerStone`).
- **Twin Wick** needs another code range that's valid on both views, with
  `axisOf()` returning "both" and `applyCaptures`/`isSuicide`/`flipStone`
  checking both views. Extend the code helpers first, with tests.
- **Turn order** is derived from colors (`turnOrder()`); `players` stays in
  join order. Don't reorder or splice-insert into `ArraySchema` (see
  `state.md`, section 9).
- **Never trust client input:** handlers validate payloads, and gameplay
  values must not come from create/join options.
