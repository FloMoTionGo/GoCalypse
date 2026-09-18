# GoCalypse: Ideas & Open Design Decisions

Working notes for turning GoCalypse into a **cozy, pixel-sprite, lantern-themed**
4-player Go variant. The game should reward bold play and never punish players:
risk earns more, and failing costs less than you'd expect. The cutthroat layer
(stealing, targeting leaders, betrayal) is **deliberately parked for later**
(see the last section).

Status legend: ✅ exists in code · 🧪 in the pixel preview prototype · 💡 idea only

---

## 1. Design pillars

1. **Cozy first.** Warm lantern light, a gentle river, soft sounds. Nothing
   screams at you. Losing a group looks like lanterns floating away.
2. **Rewarding, not punishing.** Every finished match pays out something.
   Currency and levels are never taken away. Stones removed by items give their
   owner a small consolation payment.
3. **Risk is the fun.** Bold moves (self-atari, invasions, playing the harder
   pattern axis) fill a push-your-luck meter that multiplies what you earn.
4. **Removal is rare and precious.** Items that delete stones are the most
   expensive in the shop, work only once, and are limited per match.
5. **Readable at a glance.** Pixel art must never make the four stone looks
   (solid black, solid white, grey+dots, grey+stripes) hard to tell apart.

---

## 2. Progress system: Flame, Fireflies & the Lantern Path

Three layers, from short-term to long-term:

| Layer | What it is | Lifetime |
|---|---|---|
| **Flame** 🔥 | Push-your-luck risk meter, 0–10+ | One match |
| **Fireflies** ✨ | Soft currency, spent at the Night Market | Permanent (only goes down when you spend it) |
| **Lantern Path** 🏮 | Account level, earned from total fireflies ever earned | Permanent, never goes down |

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

### 2.2 Firefly income per match 💡

| Source | Fireflies |
|---|---|
| Finishing a match (any placement) | 20 |
| Placement bonus: 1st / 2nd / 3rd / 4th | 30 / 20 / 15 / 10 (a narrow spread on purpose) |
| Each captured stone | 2 × Flame multiplier |
| Banked Flame | Flame × 3 |
| First match of the day | +25 |
| Your stone removed by someone's item (consolation) | +3 per stone |

Target: a typical match pays **~60–100 fireflies**, so a tier-1 item costs
about a quarter of a match and the most expensive removal item costs 2–3 matches.

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

## 3. The Night Market (shop) 💡

A riverside night-market stall run by a keeper character (see decision D-N3).
You shop **between matches**. Purchases go into your inventory, and you pack up
to **3 powerups into your Satchel** before each match (more with upgrades).

**Rules that keep it rewarding:**
- Items are consumed **only when successfully used**. This matches the current
  server behavior (`apply()` returns `false` → not consumed).
- Unused Satchel items return to your inventory after the match. Nothing is lost.
- **Removal items**: one-time use, highest prices, max **1 per player per match**.
- A daily rotating **Tonight's special**: one item at 30% off.
- No real-money purchases (see D-M1).

**Market tabs:**
1. **Satchel goods**: consumable powerups (section 4)
2. **Keepsakes**: permanent upgrades (section 5)
3. **Trinkets**: cosmetics (section 6)

---

## 4. Powerups (consumables)

Existing today ✅: **Bomb** (clears a 3x3 area, including your own stones) and
**Snipe** (removes one enemy stone). Right now every player gets one of each
free at the start of every match (`STARTING_POWERUPS` in `GoRoom.ts`). Under
this design they move into the market as expensive removal items.

### 4.1 Cozy & constructive (tier 1: 15–30 ✨)

| Item | Effect | Price |
|---|---|---|
| **Lantern Light** | For one turn, highlights every group in atari (1 liberty) on both axes, for you only. A learning aid. | 15 |
| **Driftwood** | Places a neutral log on an empty point: a wall on both axes, owned by no one, can't be captured, floats away after 3 rounds. | 20 |
| **Firefly Jar** | Your captures earn double fireflies for your next 3 turns. | 20 |
| **Tea Break** | Pass your turn and bank your Flame at ×1.5. | 20 |
| **Lily Pad** | Marks an empty point that only you may play on for 3 rounds (a guaranteed liberty or eye). | 25 |
| **Seedling** | Plant a seed on an empty point. After 2 rounds, if the point is still empty and has a liberty, it grows into your stone (axis chosen when planting). | 25 |
| **Lucky Koi** | Your next risky play earns double Flame. | 30 |
| **Paper Lantern Ward** | One of your groups can't be captured until your next turn. | 30 |
| **Mist** | Your next stone's axis stays hidden from others until the end of the round (needs per-player state filtering). | 30 |

### 4.2 Tactical & axis play (tier 2: 35–70 ✨)

These use GoCalypse's unique two-axis rule, where each stone fights on the
base front (black vs white) or the pattern front (dots vs stripes).

| Item | Effect | Price |
|---|---|---|
| **Ferry** | Move one of your stones one step to an adjacent empty point. Captures are checked afterward. | 35 |
| **Anchor Stone** | One of your stones becomes immune to removal items for the rest of the match. The counter to Snipe. | 35 |
| **Turn the Lantern** | Flip one of your stones to the other axis (solid ↔ grey pattern). Captures are checked on the new axis. | 40 |
| **Lantern Bridge** | Two of your diagonal stones count as connected for 3 rounds. | 40 |
| **Stepping Stones** | Place two stones this turn. | 45 |
| **Twin Wick** | Your next stone fights on **both** axes: it merges and captures on both fronts, but it's also vulnerable on both. High risk: +3 Flame. | 60 |

### 4.3 Removal (tier 3: 100–220 ✨, one-time use, max 1 per match)

The victim always gets **+3 fireflies per removed stone**, and removed stones
visibly float away down the river instead of vanishing.

| Item | Effect | Price |
|---|---|---|
| **Gust** | Removes one enemy stone that is currently in atari. | 100 |
| **River Current** | Washes away one enemy stone on the board edge. | 120 |
| **Snipe** ✅ | Removes any single enemy stone. Can't target warded or anchored stones. | 150 |
| **Firework Blossom** (today's Bomb ✅) | Clears a 3x3 area, including your own stones (see D-G4). | 220 |

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
- **Board skins**: kaya deck (default), bamboo raft, lotus-pond pier, snowy jetty.
- **Placement trails**: petals, sparks, water ripples.
- **Capture effects**: rising lanterns (default), koi splashing away, a firefly swarm.
- **Weather / time of day**: dusk, full moon, gentle rain, first snow, festival fireworks.
- **Player spirit (avatar)**: frog, fox, tanuki, heron, otter.
- **Nameplate lantern color** and a small emote set (bow, tea, cheer, sleepy).

---

## 7. Design decisions to make

Tick them off as they're decided. Where I have a recommendation it's marked **Rec**.
The pixel preview prototype (`web/pixel-preview.html`, being built now) uses
provisional defaults for the art decisions. Changing them later is cheap.

### 7.1 Art direction

- [ ] **D-A1 Reference style.** Given: *Stardew Valley* (warm, soft, readable,
      lots of ambient life) + *Duelyst* (crisp silhouettes, dark outlines,
      snappy animations with anticipation and follow-through). Decide how the
      two blend: e.g. Stardew for the scene and ambience, Duelyst for stones
      and animation punch.
- [ ] **D-A2 Palette size.** Given: "simple color scale, 5 colors maximum".
      Decide whether that means **5 colors total** (the strict reading, which
      the prototype uses, getting in-between tones by dithering) or **5 shades
      per hue ramp** (much more room).
- [ ] **D-A3 The 5 colors.** Prototype default: ink (near-black), warm cream,
      wood amber, river teal, deep night/moss. Open question: does grey (for
      pattern stones) get its own slot or come from an ink+cream dither?
- [ ] **D-A4 Native resolution & scale.** Prototype: 16 native px per grid
      spacing, stones ~15 px, rendered at an integer 2x (3x optional).
- [ ] **D-A5 Perspective.** Straight top-down (prototype) vs a slight 3/4
      tilt of the board (more Stardew-like depth, harder hit-testing).
- [ ] **D-A6 Outline style.** Full dark outlines everywhere (Duelyst) vs
      outlines only on stones and props, with the scene outline-free.
- [ ] **D-A7 Lighting.** How lantern glow is drawn with only 5 colors
      (dithered light pools?), and guaranteeing the board area stays evenly lit.
- [ ] **D-A8 Scene composition.** Which sides the river runs along, the
      direction it flows, and how the board meets it (deck on stilts, stone
      shore, floating raft). Props: reeds, lily pads, stone lanterns (tōrō),
      floating paper lanterns, fireflies, a small bridge?
- [ ] **D-A9 Time of day.** Fixed dusk/night vs a slow cycle during a match
      (dusk → night → festival).
- [ ] **D-A10 UI chrome.** Wooden panels, paper-lantern buttons, pixel font
      for all UI or just the board. Font choice/licensing (a hand-made pixel
      font avoids licensing).
- [ ] **D-A11 Cursor & hover.** Pixel cursor? Keep the split half/half hover
      preview (yes), and decide how the highlighted coordinates look in pixel form.

### 7.2 Readability & player identity

- [ ] **D-R1 Owner marks.** Stones from teammates on an axis look identical
      today (players 1 & 3 both place solid black). Add a tiny owner pip
      (a lantern color per player) or keep them identical on purpose?
- [ ] **D-R2 Player colors.** 4 players need identities beyond black/white/
      dots/stripes (nameplate lanterns, avatars). With a 5-color palette these
      can't be 4 new hues, so maybe they're shapes or spirits instead.
- [ ] **D-R3 Last-move marker.** Glowing ember pip (prototype) vs a ring.
- [ ] **D-R4 Accessibility.** A high-contrast stone mode, reduced motion
      (prototype honors `prefers-reduced-motion`), color-blind check of the palette.

### 7.3 Motion & feel

- [ ] **D-F1 Animation frame rate.** Pixel animations at ~8–12 fps,
      independent of game state (prototype), vs smooth tweening.
- [ ] **D-F2 Placement animation.** Drop + squash + ripple (prototype). Add a
      wooden "clack" sound?
- [ ] **D-F3 Capture animation.** Stones become lanterns that rise and fade
      (prototype), or they slide into the river and float away. Maybe both:
      captures rise, removal items float away.
- [ ] **D-F4 Powerup animations.** Each item needs a small signature effect
      (Firework Blossom = a pixel firework, Driftwood = a log bobbing in).
- [ ] **D-F5 Performance budget.** `debug.html` runs 4 animated clients in one
      tab. Throttle ambient animation in background/unfocused iframes?

### 7.4 Audio

- [ ] **D-S1 Soundscape.** Lo-fi ambient loop, river water, crickets, a wooden
      stone clack, soft chimes for Flame and banking.
- [ ] **D-S2 Mute & volume UI**, and whether sound is on by default.

### 7.5 Narrative & naming

- [ ] **D-N1 The name.** "GoCalypse" vs a cozy lantern theme is a real
      tension. Options: rename (e.g. *Lantern Go*, *Riverlight*), or lean into
      it ("after the world ended, people float lanterns and play Go").
- [ ] **D-N2 Setting.** One match = one festival night on the river?
- [ ] **D-N3 Market keeper.** A character who runs the Night Market (an old
      toad, a tanuki, a heron?) and is the voice of tutorials and tips.
- [ ] **D-N4 Currency names.** Fireflies / Flame / Lantern Path are proposals.

### 7.6 Game & economy

- [ ] **D-G1 When can you shop?** Between matches only (Rec: simplest and
      fair), or also a mini-market mid-match every N rounds.
- [ ] **D-G2 Permanent power.** Rec: keepsakes never affect the board, only
      the economy and convenience, so matches stay fair.
- [ ] **D-G3 Removal limits.** One removal item per player per match (Rec),
      or a shared pool per room.
- [ ] **D-G4 Bomb hits your own stones?** Today yes. Keep it as a risk element
      (and give Flame for it?) or make it enemy-only?
- [ ] **D-G5 Match end condition.** There isn't one yet: the `"finished"`
      status exists in `GoState` but nothing sets it, and there's no pass move,
      so turns run forever. Payouts need an ending: a fixed number of rounds?
      First to N captures? All four players passing in a row?
- [ ] **D-G6 Flame numbers.** Tune the values in 2.1 and the income table in
      2.2 after playtests.
- [ ] **D-G7 Free starting kit.** Remove the free Bomb + Snipe everyone gets
      today (Rec, since they become expensive items), or keep a free tier-1 item.

### 7.7 Tech & persistence

- [ ] **D-T1 Where progress lives.** There are no accounts, only guests. Items
      bought in the market affect multiplayer matches, so the **server** must
      own inventories (otherwise anyone could edit localStorage and get infinite
      Snipes). Rec: an anonymous device token in localStorage + SQLite on a
      Fly.io volume (fits the existing single-machine setup).
- [ ] **D-T2 Accounts later?** Optional sign-in to carry progress across devices.
- [ ] **D-T3 Rendering approach.** The prototype renders sprites defined in code
      into a native-resolution pixel buffer, scaled up with
      `image-rendering: pixelated`. The same code can render PNGs in Node for
      tests. Alternative: PNG sprite sheets drawn in an editor (e.g. Aseprite).
- [ ] **D-T4 Animation loop.** Today the board only redraws on state changes.
      Pixel ambience needs a `requestAnimationFrame` loop. Pause it when the
      tab is hidden.
- [ ] **D-T5 Hidden information.** Mist and Kite need per-player state
      filtering (Colyseus `StateView` / filters). Worth it, or cut those items?
- [ ] **D-T6 Layout.** The scene (board + river) is bigger than today's board.
      It must still fit the `debug.html` panels (760x700) next to the sidebar.

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

## 9. Implementation notes (for whoever builds it)

- **Flame detection** fits into `GoRoom.handleMove`: after `applyCaptures`, run
  `findGroup(rawBoard, size, x, y, axisOf(code))` for the liberty count, and
  store a per-player "brave stones to recheck" list for the next turn.
- **New state fields**: `PlayerState.flame`, `PlayerState.fireflies` (match
  earnings), a Satchel instead of today's free `powerups`, and timed board
  effects (driftwood, lily pads, wards) with a round countdown.
- **Neutral stones** (Driftwood) need a new board code outside 1–8, and
  `goRules.ts` must handle it explicitly. Today `axisOf`/`ownerOf` assume
  codes ≤ 8: a code of 9 would be read as a pattern stone of a nonexistent
  "player 5" (`STONE_PATTERN[5]` is `undefined`, not `null`), which makes it
  capturable instead of a wall. `viewValue()` must return `null` for neutral codes.
- **Twin Wick** needs another new code range that's valid on both views,
  with `axisOf()` returning "both" and `applyCaptures`/`isSuicide` checking
  both views. Same caveat: extend the code helpers first, with tests.
- **Market & inventory** are server endpoints plus persistence (D-T1). The
  client never decides what you own.
