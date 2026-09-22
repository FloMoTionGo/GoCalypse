# Tuning the recruits

An offline search for better board weights for Reed, Tanuki and Magpie, by
self-play on 13x13 with all four combos.

**Nothing here ships and nothing here learns.** It runs on a developer's
machine, prints integers, and a human pastes the ones that earned their place
into `src/bots/styles.ts`. The server still plays a move with a few hundred
integer additions, written by hand. There is no model, no training data and no
neural network anywhere in GoCalypse.

```sh
npm run build                       # the workers play the compiled server
node tools/tune/tune.js --style reed
node tools/tune/tune.js --style tanuki  --generations 24
node tools/tune/tune.js --style magpie  --workers 8
```

## How a candidate is scored

The candidate takes one seat against the three shipped recruits, and the whole
thing is replayed with it in **each of the four seats** — the seats are not
alike (combo 1 moves first, and the four combos hold different pairs of sides),
so rotating cancels that out and leaves the weights.

Fitness is the candidate's final score less the mean of the other three, with
average place as the tiebreak. The search is a (1 + lambda) hill climb: perturb
one to three weights by 10–25%, play every mutant, keep one only if it beats the
incumbent.

## Noise, and why the held-out check is not optional

One match is worth a few points of margin either way. The same **unchanged**
Reed, scored against disjoint seed sets, comes out at:

| matches per candidate | standard deviation of margin |
|---|---|
| 12 | 3.18 |
| 24 | 2.40 |
| 48 | 1.12 |

Selection bias sits on top of that: take the best of 8 mutants on 12 matches and
a search that changes nothing "improves" by 8 points in one generation. The
first smoke run of this tool did exactly that.

Three things keep it honest:

1. Every candidate in a generation plays the **same seeds** as the incumbent,
   which pairs the comparison and cancels most of the spread.
2. A mutant that wins its generation must win **again** on seeds neither it nor
   the incumbent has seen, and those change every generation. Without this,
   Reed's run won four generations running by 3.5–5.0 points and failed the
   confirmation every single time.
3. The winner is replayed on **several disjoint held-out blocks**, so the gain
   arrives with a spread, and is kept only if it clears that spread. One block
   is not enough to tell a small gain from a lucky one.

## What the runs actually found: nothing that holds up

| style | training margin | out of sample |
|---|---|---|
| Reed | −0.23 → 3.39 | −0.48, spread 1.45 over 5 blocks — **discarded** |
| Tanuki | 5.06 → 8.07 | −0.23 on one block — **discarded** |
| Magpie | 3.41 → 3.41 | nothing was ever accepted |

Reed is the cautionary tale. Its winner (`capture` 1400→1143, `line` 200→162)
cleared a single held-out block at +0.34 and an earlier version of this tool
called that a gain, because it only checked the sign. Five blocks put the same
weights at **−0.48 with a spread of 1.45**: the weights were slightly *worse*,
and the +0.34 was the block, not the player.

That is the current result: **the hand-written weights sit close enough to a
local optimum that this search, at an affordable number of matches, cannot show
daylight.** `styles.ts` is unchanged. To push further you need a bigger match
budget (the spread falls as sqrt(matches), so halving it costs 4x the compute),
a smarter mutation than a random 10–25% nudge, or a stronger opponent field than
three copies of the thing you are trying to beat.

## What it does not tune

`shopping`, `itemBias`, `prefers`, `variation` and `judgement`.

The self-play driver has no Night Market (see `src/bots/selfplay.ts`). Bots have
planners for only 7 of the 18 items, and those need the room's effect
bookkeeping — wards, lily pads, driftwood timers — to behave. So a match here is
stones only. It models the board play the tunable weights actually govern, and
says nothing about shopping; any number the search produced for `itemBias` would
be noise. Writing planners for the other 11 items is a separate piece of work.

`prefers` and the item weights are also most of what makes the three recruits
read as three different players, which is the point of having three. Each style
additionally keeps a floor on the terms it is named for (`GUARDS` in
`tune.js`) — Tanuki stays a fighter rather than drifting into Heron.

## Caveat on what "stronger" means

Self-play only. No external judge is possible: KataGo and friends cannot
evaluate a two-front four-seat variant with a Night Market. So these weights are
stronger **against these three opponents**, which is not the same as stronger in
general, and a change that beats the field here can still lose to a human who
plays differently. Say so in the commit message.
