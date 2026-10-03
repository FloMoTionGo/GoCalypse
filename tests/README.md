# GoCalypse tests

Every part of the game has tests at the lowest level that can show it works:
rules and rooms as unit tests on the server, the pixel renderer as unit tests
in Node, the server's network side against a real server, and the page itself
in a real browser. One runner, granular tiers, and a git gate in front of
`master`. The quality bar these hold the code to is [CONSTRAINTS.md](../CONSTRAINTS.md).

## Setup (once per clone)

```
cd server && npm ci        # the server, and the TypeScript compiler
cd ../tests && npm ci      # colyseus.js, for the live tiers
git config core.hooksPath .githooks   # or: npm run setup (in tests/)
```

The GUI tier needs Edge or Chrome. It finds them in the usual places; elsewhere,
set `GOCALYPSE_BROWSER` to the executable.

## Running

```
node tests/run.mjs                 # everything (the full profile)
node tests/run.mjs quick           # server + web + tools: ~13 s
node tests/run.mjs gui             # one tier
node tests/run.mjs server web      # several
node tests/run.mjs gui --grep "Stone Card"   # only the tests whose name matches
node tests/run.mjs --reporter dot  # quieter output
```

The runner compiles the server first (a type error stops everything), runs each
tier, then judges the results against `tests/pending.json` (below).

| Tier | Where | What it covers | Time |
|------|-------|----------------|------|
| `server` | `server/src/**/*.test.ts` | Go rules, ko, the storm, endgame scoring, every item, the bots, the Stone Card; the room's turns, market, visibility (B5), effects, seats, bots and snapshots; persistence; names | ~3 s |
| `web` | `tests/web/*.test.mjs` | `sprites.js` and `pixelScene.js` in Node: the palette, every sprite and animation, item icons for every server item, layout and hit-testing, rendering in the palette only, board diffs to animations, storm timing | <1 s |
| `web-slow` | `tests/web/*.slow.test.mjs` | Exhaustive render checks: nothing in the storm's grey tells one player's stones from another's (B7, B8, B10) | ~45 s |
| `integration` | `tests/integration/` | A real server: `/healthz`, CORS, `/rejoin`; whole matches over WebSockets (B1, B3, B22, scoring); what each client is sent (B5, storms); a kill and restart mid-game (B5, B11); junk input and protocol abuse | ~7 s |
| `gui` | `tests/gui/` | `index.html` in headless Edge/Chrome against a real server: the home screen and lobby board (mouse and keyboard), joining with bots, playing stones with both buttons, the sidebar, market, hand and Stone Card, recall, Leave and rejoin (B2, B4, B18), the storm's grey in the client (B6, B8, B9), Results; no console errors, accessible names, board pixels in the palette | ~20 s |
| `tools` | `tests/tools/` | The commit checks themselves: the floor guard and red first, on scratch repositories | ~8 s |

Profiles: `quick` = `server`, `web`, `tools`. `full` = all of them (the default).

### The gate

| When | What runs |
|------|-----------|
| commit on a branch | `quick` (`.githooks/pre-commit`; only Markdown staged: nothing) |
| commit on `master` | `full` |
| every commit | the floor guard and red first (`.githooks/commit-msg`) |
| merge into `master` | `full` (`.githooks/pre-merge-commit`) |
| push to `master` | both guards on every new commit, and `full` unless that exact tree already passed (`.githooks/pre-push`) |
| CI, every push and pull request | the guards per commit, the dependency audit, `quick`, then `full` (`.github/workflows/tests.yml`) |
| Pages deploy | only after the CI tests pass (`.github/workflows/pages.yml`) |

`GOCALYPSE_GATE=full git commit ...` runs the full profile on a branch too.
`git commit --no-verify` skips the local hooks, but CI judges every commit all
the same.

## Red first: a new feature starts as failing tests

Tests for something new are written **before** it exists, and are committed
while they fail, so the history shows they could fail. The mechanics:

1. **Write the tests** for the feature at every level it touches: a server test
   for a rule, an integration test for what goes over the wire, a GUI test for
   what the player sees and does. Give each a literal, unique name.
2. **List them** in `tests/pending.json`:
   ```json
   { "pending": [
     { "test": "a Lantern Kite reveals the hand of the player it lands on", "feature": "lantern-kite", "tier": "server", "since": "2026-10-04" }
   ] }
   ```
3. **Run** `node tests/run.mjs`. The listed tests must fail. The summary shows
   them as *red as expected*, and everything else must still pass. **Commit**
   the tests and the list together, with no feature code.
4. **Implement** until they pass. The runner now fails with *pending test(s) now
   pass: take them off tests/pending.json*. Remove the entries and commit the
   feature.

The gate holds this in place:

- The runner fails if a pending test passes, if a pending entry names no test,
  or if any test is skipped (`.skip`, `.todo`).
- `red-first.mjs` refuses a commit that changes shipped code (`server/src`,
  `web/`) with no test change, and one that adds new test names in the same
  commit as the code.
- `floor-guard.mjs` refuses a commit that lists an *existing* test as pending
  (that would hide a red test), deletes a test file, removes an assertion,
  skips a test, or adds a suppression or a stub.

A bug fix works the same way: first a test that shows the bug (pending, red),
then the fix.

A commit is judged by the rules its parent had, so history from before the
gate (and the commit that brought it in) isn't held to them. A merge commit
isn't judged as a whole: each commit it brings in was judged on its own.

Escapes, for when a finding is wrong: a commit message trailer line
`Test-Exempt: <reason>` (a pure refactor, a cosmetic CSS change) or
`Constraint-Exception: <reason>`. The reason stays in the history, and CI
reads it from there.

## Writing tests

- **Server units** sit next to the code, `server/src/<area>/<name>.test.ts`,
  using `node:test` and `node:assert/strict`. Room tests import
  `rooms/room.testkit.ts` first: it gives you a real `GoRoom` without a server
  (`makeRoom`, `startedRoom`, `move`, `passAround`, `stock`, `put`...). The clock
  never ticks, so bot turns are run by hand with `room.runBotTurn()`.
- **Web units** load `web/sprites.js` and `web/pixelScene.js` through
  `loadWeb()` (`tests/lib/paths.mjs`). Anything slow goes in a
  `*.slow.test.mjs`.
- **Integration** tests start their own server with `startServer()`
  (`tests/lib/harness.mjs`). It runs on a free port with its own data folder;
  pass the same `dataDir` to a second start to test a restart. Clients come
  from `colyseus()`. Close them with `leaveQuietly()`, because a dropped room's
  `leave()` never settles.
- **GUI** tests use `guiRig()` (`tests/gui/page.mjs`): a server, `web/` served
  statically, and a headless browser. The page's own state (`room`,
  `lastState`, `myPlayer`, `board`, `scene` and so on) can be read with
  `b.ev(...)`. Act through real input (`rig.clickBoard`, `rig.clickLobby`,
  `b.key`) and check the DOM and that state. End with `rig.assertClean()`:
  console errors fail the test. The colyseus.js the page loads from its CDN is
  served from `tests/node_modules`, so the GUI tier runs offline.
- Tests in one file share their server and page and run in order. Keep each
  file's set-up in `before()`.

## Files

- `run.mjs`: the runner
- `pending.json`: tests ahead of their feature
- `lib/`: the harness and paths, the reporter, the guards (`floor-guard.mjs`, `red-first.mjs`, `git.mjs`) and the dependency audit (`audit.mjs`)
- `web/`, `integration/`, `gui/`, `tools/`: the tiers outside `server/`

The old one-off scripts in `../findings-tests/` are folded into these tiers.
`smoke-stonecard.cjs` there still checks a live deploy by hand.
