# GoCalypse rules

Every rule, item and bot. The game's own *How to play* covers the same ground
with pictures. [Back to the README](../README.md)

## Stones and fronts

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

## Ko

No move may **bring back a board position that has stood before** (positional
superko). Plain ko is not enough with four seats: a capture can be answered two
or three stones later by someone else, and the same board comes round again. Only the
stones count, not whose turn it is. A refused move says so (`rules/ko.ts`,
checked in `GoRoom.applyMove`); bots never offer such a move. Positions are not
part of a saved snapshot, so after a server restart the rule remembers from the
restored board on.

Superko alone still lets a ko go round the table: the seats in between put
stones down elsewhere, so the retake is never quite a repeat. So **a ko is held
for a full round**: once a single stone is taken by a lone stone left on one
liberty, nobody may take that stone straight back until the player who took it
has moved again, which gives them the turn to fill the ko. Bots price the same
thing: a capture that leaves their stone in atari counts as a self-atari, unless
it is a held ko they can fill.

## Ending the game & scoring

On your turn you can **pass** (the *Pass* button in the header) instead of
placing a stone. When **all four players pass in a row** the game ends; a stone
or an item played in between starts the count again.

The board is then counted the **Japanese way — territory only**, once on each
front:

- **a stone is worth nothing in itself**, only the ground it surrounds,
- every **empty** point whose empty region touches only one side's stones counts
  one point for that side.

A stone that is a wall on a front (its owner committed it to the other front,
or it is driftwood) counts for no one there and doesn't spoil a region for
anyone, like the edge of the board. Nothing is removed as dead first, since
nobody is there to agree what is dead: **capture what should go before you
pass**, or it lives and keeps its ground. Stones standing on a burning point
still wall a region in.

On top of its side's territory each player counts its own **prisoners**: the
stones *it* captured on that front over the match. Territory belongs to a side,
so the two seats holding it share it; prisoners belong to whoever played the
capturing move, the same way fireflies do — so take the capture rather than
leave it to the ally who shares your front. Stones the storm burns or a river
creature takes are not prisoners: their owner is already paid consolation
fireflies, and nobody surrounded them. Nor are stones **smothered** across the fronts: a group killed by
a stone of the other front (black filling a gray group's last liberty) leaves the
board and still pays the capture fireflies, but scores no prisoner; Results shows
how many each player smothered.

**Never more prisoners than territory:** on each front, prisoners count only up
to the territory your side holds there. With 4 points of ground and 9 stones
taken on a front, 4 of them count; with no ground there, none do. A front is
worth at most twice its ground, so fighting pays only as far as you also hold
land (`countedPrisoners` in `rules/endgame.ts`).

That gives every player two totals, territory + counted prisoners on each of its two
fronts. **A player's final score is the lower of the two; the higher one only
breaks ties.** Players level on both numbers share a place. The welcome screen
explains this too, and a *Results* window opens when the game ends, showing each
front as its total over `territory + captured` (`4 territory + 4 of 9 captured`
when some prisoners did not count).

## Scoring modes

A table picks how it counts on the lobby board, default GoCalypse. Every mode
counts per front, the lower front is your score and the higher breaks ties.
**GoCalypse**: territory plus your prisoners, never more prisoners than
territory; whatever stands is alive. **Japanese**: territory plus every
prisoner. **Chinese**: territory plus your side's stones, no prisoners. Japanese
and Chinese take dead groups off first (`server/src/rules/deadStones.ts`): only a
group with too few eyes, inside ground only the other side touches, around which
that side lives. When in doubt, a group stands.

## How bots play it out

Bots play the board out and then stop. A move is worth a turn when it takes
stones that still count under the cap, or saves stones, when it raises the bot's score (the lower of its two fronts), or
when it is simply still open or contested ground. That last one is what fills
every dame: a bot keeps playing to the very end rather than passing on a board
that still has something on it.

What it won't do is spend a turn on **settled territory** — a small region
walled in by a single side. Its own, because under this count filling your own
ground just hands the point back; anyone else's, because a stone dropped into a
surrounded region is a gift, and a prisoner for them on top.

"Small" is doing real work there. By the letter of the rule a single stone on an
empty board walls in every point it faces, so a bot reading the count literally
believes the game is already decided and passes on move two. A region only
counts as territory once it is no bigger than two rows (`isSettled` in
`rules/endgame.ts`). It's the one number in the endgame not derived from the
rules — nothing in the scoring depends on it, only a bot's decision to stop.

And whatever is still legal, a bot that comes to a table where every other seat
has passed in a row **passes too**, so the game ends there — the drifter, the
fallback that keeps a stalled table moving, included (`everyoneElsePassed` in
`bots/index.ts`).

## Fireflies & the Night Market

Placing a stone earns **3 fireflies**, capturing earns **5 per stone**, and
losing a stone to a lightning fire or a river creature pays you **3** as
consolation. The **Night Market** opens for everyone at the **start of round 6**.
Buying never takes your turn; using an item does. Items that fail (bad
target) aren't used up.

Items come in three **tiers**, and the market stocks **six per match: 3 of
tier 1, 2 of tier 2 and 1 of tier 3**, drawn fresh each match, and beside them
the **Bait**'s stall, there every match (the answer to the river creatures,
below). The market is one per room, so every player and bot at the table shops
from the same stalls. **No item takes another player's stones off the board**:
the game stays cozy, and the only things that lift a stone are a capture by the
rules, the storm's fire and the river creatures. Your **hand holds five
cards**; a purchase past that is refused with a notice. The hand is a row of
portrait cards under the board: a bought item flies in from its stall as a
card, and on your turn you pick a card to use it.

Some items are **free**: they don't take your turn, you still move afterwards.
Prices grow with the tier: tier 1 costs 25-40, tier 2 45-80, tier 3 130-400. (Within a tier the tables below read in the order the stall shows them, cheap to dear.)

**Tier 1**

| Item | Price | Effect |
|---|---|---|
| Firefly Jar | 25 | Free. Your captures earn double fireflies for the rest of this turn and your next 3. |
| Seedling | 30 | Plant a seed on an empty point; it grows into your stone after 3 rounds, as a seed, a sprout and a sapling. In its first round anyone's stone tramples it; after that only you may play there. Left click plants a solid seed, right click a gray or transparent one (Esc cancels). |
| Mist | 30 | Free. Your next stone is hidden in a mist until the end of the round: the others can't see which front it fights on. (The server doesn't send the others that stone at all, only you get it.) |
| Bait | 30 | Free, and on sale every match. Toss it onto an edge point: the river crab or spirit nearer to it along the edge walks over and takes its stones from there when its timer runs out. Only defensive: refused (and kept) when the new reach holds another player's stone, with no creature out, or on the point it already faces. |
| Fog | 35 | Rolls a fog over a 3x3 area for 2 rounds: stones inside can't be captured or removed (like a ward over the whole area), and nobody can see them, the caster and the stones' owners included, and the move recall strip leaves them out too (the server sends nobody the stones under it). No stone can be placed inside it (moves, Ferry, Skiff, Echo Chime and growing seeds are all refused there). |
| Driftwood | 30 | Neutral log on an empty point: a wall on both fronts, owned by no one, uncapturable. Floats away after 3 rounds. Can't smother a group. |
| Lily Pad | 40 | Reserves an empty point for 3 rounds: only you may play there. |

**Tier 2**

| Item | Price | Effect |
|---|---|---|
| Kite | 45 | Free. Fly it over an enemy stone: only you see what its player is holding and how many fireflies they have. |
| Ferry | 50 | Move one of your stones one step to an empty point beside it (pick the stone, then the point). Captures are judged as if you had played it there. |
| Skiff | 65 | Send one of your stones gliding along its row or column to an empty point, as far as the way is clear (pick the stone, then the point). |
| Lantern Ward | 60 | One of your groups can't be captured or removed until the end of your next turn. If it has no liberties when the ward lapses, it's removed. |
| Twin Wick | 70 | Free. Your next stone fights on **both** fronts: it joins and captures on both, but is lost if either of its groups runs out of liberties. Can't be turned over. |
| Turn the Lantern | 80 | Flips one of your stones to your other front (black/white <-> gray/transparent); captures count on the new front, and a former group-mate left with no liberties is captured too. Refused only if the flipped stone itself would have none. |

A stone the Ferry, the Skiff or the 川 haiku moves **crosses the board on a
raft**: it never vanishes and reappears, which used to read as a stone killed by
its own colour. A raft slides out under it, the ferryman's lantern lights, the
raft sails from the old point to the new with a wake of foam behind it, and the
stone settles with a ripple as the raft sinks away. The event line names the
crossing and what it took, `Ko used Ferry, moving a stone from (9, 7) to (9, 6),
captured 1`, and so does the event log (see *Reading the board*).

**Tier 3**

| Item | Price | Effect |
|---|---|---|
| Echo Chime | 160 | Place a stone, and the chime places another for you on the opposite side of the centre point, if that point is free and legal. |
| Stepping Stones | 200 | Free. Place two stones this turn: your next move doesn't end your turn. |

The bots don't use the new items yet: they shop from their own lists, which only
name the older ones, so they simply skip what isn't on sale.

## The Kata (型)

Every player starts with an empty **Kata** (型, "a set form"; it was called the
Stone Card, and is still `stone_card` on the wire and in saved games) in their hand, taking one of
its five places: a 3x3 go board. The mouse buttons are fixed: **left click**
puts your solid stone on a point, **right click** your gray or transparent one;
hovering an empty point shows both, see-through and split down the middle. The
**first stone is free**, the next costs **100**, each one after it **25 more**
(100, 125 … 275; 1,500 for all nine). Clicking a stone with **its own button**
again **takes it off** (no refund: the next stone then costs what that one did);
the **other button switches** it to your other stone for free. None of this takes
your turn, and it works while others move too. The card is small in the hand,
so hovering it shows a **400% copy** standing on it that you can click just the
same. While you can pay for the next stone the card glows, with *UPGRADABLE*
under it.

Playing the card takes your turn: pick it, and a see-through copy of its stones
follows the pointer over the board (never rotated). The point you click takes
the centre stone. The stones then land centre first, then the ring clockwise
from its top-left, each like a stone of its own: captures count and pay, but a
stone whose point is taken, burning, fogged, under someone else's lily pad, off
the board or without liberties is simply **not placed**, and whatever stands
there is left alone. A card that would land nothing, or bring back an earlier
board (ko), or an empty card, is refused and kept. Everyone can see everyone's card beside their
name. Every bot takes the free first stone; after that bots add only their solid
stone, on a random point, as their purse habits allow (Honte never pays; Atsumi
keeps as much again in reserve), up to **5 stones of 9**
(a full 3x3 block is a clump, not a shape). They play the card once it has those
5, or if it pays for none (Honte plays its free one), or once the table starts passing
(`rules/stoneCard.ts`, `bots/card.ts`).

## Thunderstorms

Every **20 turns** the room rolls a **D20** out of sight and adds **1 for
every calm roll** since the last storm. At **20 or more** a storm breaks: the
night darkens, rain sweeps the board for about ten seconds, and
**up to three bolts** (six on 19×19, eleven on 25×25) come down on random points (never on a warded point or
one already alight). Whatever stands there catches fire and **burns away
three rounds later** — its owner gets the usual 3-firefly consolation — and
**nobody may play on a burning point** until the fire goes out. Fires don't
take liberties: a burning point counts as empty for the purposes of staying
alive, it just can't be filled.

The chance of a storm at each roll starts at **5%** and grows **5% with every
calm roll**, then starts over after a storm. The **sky over the far bank** is
the forecast: it clouds over and darkens as the odds climb, and its name stands
beside the moon. The **garland** counts the turns, a lantern for each turn
between rolls, going out one by one until the next.

The storm also **lasts for its full 3 rounds**, not just the ten-second
cloudburst: behind it a much weaker copy of the same weather (a faint dusk,
thin cloud, sparse rain) hangs over the river and banks and eases out through
the last round; the board gets a lighter share of it. For the storm's full three
rounds **every player stone is drawn the same slate grey**, so nobody can see whose
is whose. The rules do not change: captures and suicide still run on the real
colours, and players have to remember what they cannot see. The grey comes in with the
cloudburst and eases out through the last round. It is driven by `GoState.storm.until` versus `GoState.turnCount`, so
a client joining mid-storm sees it too (`stormLinger` in `web/pixelScene.js`).
Nothing else gives the colours away while it lasts: stones still moving (placed,
flipped, captured, carried on a raft, blown or burnt away) are grey too, the boards you step back
to with the recall arrows are grey, the owner marks on wards, lily pads and seeds
are hidden, and an item that targets your own stone no longer marks your stones
with embers -- you pick yours from memory. The server keeps this too: while the
grey lasts it sends every client each player stone as one grey code, so the
colours aren't in the browser to be read.

`go_debug` rooms roll every **6** turns instead, so a storm can actually be
watched in a test session (`src/rules/storm.ts`, `GoDebugRoom`).

## The river crab and the river spirit

Once the Night Market is open for the whole table (turn 20 at four seats), the
room rolls a **D6 every 5 turns**. On a **5 or 6** a creature climbs out of the
river onto the board's wooden frame, in front of a random edge point (any of
the 52, on all four sides): the **river crab** two times in three, the **river
spirit** one time in three. At most one of each is out at a time: a roll for
one already out brings nothing, and a second creature only comes up where its
reach doesn't touch the first one's. A 1 to 4 brings nothing, and the next roll
has the same odds (no build-up, unlike the storm).

Its **reach** is three points of the outer ring: the one it faces and that
point's two neighbours along the ring (turning the corner at a corner), ringed
with turning dots. A **timer over its head** counts down **3 rounds** (12 turns
at four seats). When it runs out the creature acts and goes back into the water:
the **crab pinches one** stone in its reach, picked at random; the **spirit
steals every one**. Warded and fogged stones are safe, it can't see a stone
under a mist, and driftwood isn't a stone. Owners get the usual 3-firefly
consolation per stone, and nobody gets a prisoner. A **Bait** tossed onto an
edge point lures the nearer creature there, its timer unchanged. The crab can be lured onto
anyone's stones, the spirit only away from other players'; a game that ends while one is out sends it back.

The scene animates each one climbing out of the water onto the frame, idling
there (the crab snapping its claws and shuffling, the spirit bobbing with its
wisps swaying), taking its stones (the crab's claw, the spirit's tendrils of
mist), walking along the frame to a Bait and catching it, and going back into
the water. Bots buy a Bait when a creature has one of their stones in reach,
lure it away to a clear edge point when its timer runs out before their next
turn, and rank points in a reach a capture lower.

`go_debug` rooms roll the river's D6 every **2** turns instead
(`src/rules/river.ts`, `GoDebugRoom`). `GoState.river` carries the last roll,
what it brought (`came`) and both creatures: where each faces, its reach, the
turn its timer runs out (`by`), and as it leaves the stones it took and whether
it was fed.

## Board sizes and haiku

The lobby board's line above Start picks a 9×9,
13×13 (the default), 19×19 or 25×25 table; Quick join only finds tables of that
size. A 9×9 table is pure Go: no Night Market, Kata, haiku, river creatures or
storm. Every other match lays three haiku (月 moon, 川 river, 木 tree) line by line on the
least played points; a stone on a line collects it, the haiku's card comes to
the hand and levels up with each line, and is played once at its level (see
*How to play*, Haiku).

Every point of the lobby board wears its own stone, one of the 16 two-look combinations (black, white, gray and transparent, left | right, in both orders), drawn fresh at each page load from the centre point outwards: a stone that shares a colour with the one it grew from is 50 % more likely, and no two alike sit side by side or above each other. An empty point shows its stone as the game's hover stone; a placed stone shows nothing on hover. The row under Start is free: stones played there change nothing, and give the board a centre row.

## Reading the board

Anything that doesn't last shows a small **timer**: the rounds it has left (a
lily pad, driftwood, a ward or a fire; a ward covers a whole group, but only
its first stone carries the tag). It turns amber in the last round. A lily pad
or ward also carries its **owner's mark**, their two stones side by side, so you
can see whose it is. In the scene a little **boat** drifts along the river with
a sign showing the round being played ("R3", one round = every seat has moved once): scenery on its own clock, there
only for orientation.

The line under the board says what just happened (`Seme played (9, 5), captured
1`). The **event log** keeps the last ten of those lines: open it with the LOG
plank in the header, by clicking the line itself, or with the L key; Esc or its
x closes it. Each entry carries the round it happened in ("R19"), the newest
first. Like the move recall strip it lives in the browser, so it starts afresh
when the page is reloaded.

## Playing with bots

Bots can be brought along from the **home screen** (a *Play with bots* menu
above the Join button; bringing bots starts a table of your own instead of
matching you with strangers), or added while a room is still waiting for its
fourth player: the welcome screen (it opens by itself on a first visit;
**Add bots** in the header reopens it) has the same menu. Pick up to **three of
each kind**, but **no more than three bots in all** (the server enforces this
too). Two of a kind are numbered ("Honte", "Honte 2"). The lanterns beside each
name show how much of the Night Market it uses.

| Bot | Plays | Night Market |
|---|---|---|
| Honte | Pure Go: stones only | Never buys, never uses an item |
| Atsumi | Careful builder: keeps its stones together, fights only for something real | Few: spends slowly and keeps a reserve |
| Moyo | Pattern fighter: reaches for its gray or transparent stones first, builds with walls | Some |
| Seme | A fighter that goes looking for contact | Some: buys a trick when it pays |
| Tenuki | Item player: plays the market as much as the board | Many: logs, lily pads, seeds, the odd chime |
| Ko | Market shark | Max: spends turns on items whenever one can do anything, and shops down the whole list |

Bots are strictly opt-in: nobody is ever seated at a table that didn't ask for
one. The one other time a bot plays is a seat whose player never came back
within the 60 s grace period, so the table doesn't stall. A table with no
humans left closes itself.

They are not AI in the machine-learning sense: nothing is trained and nothing
learns. Each is a hand-written scorer over the board (capture, saving stones,
ataris, cuts, shape, ground) with different weights, taken from GoSequencer's classic
player, whose list of things to look at comes from Leela, Gian-Carlo
Pascutto's Go engine (https://github.com/gcp/Leela, MIT). No Leela source or
data is copied, and its search and neural networks are left out.

The bots build rather than brawl. A capture is paid only for the stones that
still fit under the prisoner cap, judged against the ground the bot can expect
to hold on that front. Every move is paid for the ground it claims: a rough
estimate gives each empty point to the side whose stones are nearest on that
front, within three steps (`estimateArea` in `bots/scoring.ts`), capped at 10
points a move. A stone that leaves its group on two liberties is penalised:
three seats move before its owner does again, and any stone fills a liberty.
In 280 self-play matches on 13x13 this cut the stones captured per match from
120 to about 57, ko retakes from 22 to 4, and raised the territory held at the
end by about 6%.

## Replays

Every game of 50 turns or more is saved by the server when it ends, with no action needed from
anyone: played to the end, or abandoned after that many turns (everyone
left). **Replays** on the home screen lists them, newest first, with who
finished where. From / To dates (or *Today*, *7 days*, *30 days*, *All*)
narrow the list to the days the games ended. Pick one to play it back:
step with the buttons or the arrow keys, jump with Home / End or the slider,
or press Play (Space). A replay shows the whole board, fog and mist included,
so a game appears there only once it is over.

Finished games stay on the server with the names at the table, the newest
500 (`HISTORY_MAX`); the Replays dialog and the welcome screen say so.
