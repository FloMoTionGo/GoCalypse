# Constraints

Last reviewed: 2026-10-03 by @FloMoTionGo

The quality bar for GoCalypse, as a contract. Read it before writing code, and
don't weaken it to make a change pass: the floor guard
(`tests/lib/floor-guard.mjs`) checks every commit for the moves that lower it.
How the tests are run and written is in [tests/README.md](tests/README.md).

## Floor (always enforced, no setup required)

- Red first: a test for new behaviour lands red, listed in `tests/pending.json`, in a commit before the code that makes it pass
- Every change to shipped code (`server/src`, `web/`) comes with a test change
- No skipped, todo or `.only` tests: a test written ahead of its feature goes in `tests/pending.json`
- No existing test listed as pending, no test file deleted, no assertion removed from a test that stays
- No new suppression comments in code: `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `istanbul ignore`
- No unfinished work in code: a stub that throws "not implemented", an empty `catch {}`, a TODO or FIXME
- This file does not get weakened to make a change pass

A finding that is right after all goes through with a commit message trailer,
`Constraint-Exception: <reason>` (floor) or `Test-Exempt: <reason>` (red first),
so the reason stays in the history.

## Enforced with numbers

| Dimension | Rule | Checked by | Runs at |
|-----------|------|-----------|---------|
| Types | Zero type errors in the server | `tsc -p server/tsconfig.json` (first step of `tests/run.mjs`) | every commit, CI |
| Unit: server | Every test passes (rules, bots, items, rooms, persistence) | `node tests/run.mjs server` | every commit, CI |
| Unit: web | Every test passes (sprites, scene, pixels in the palette) | `node tests/run.mjs web web-slow` | every commit (`web-slow` on master), CI |
| Integration | Every test passes against a real server over HTTP and WebSockets | `node tests/run.mjs integration` | commits on master, pushes to master, CI |
| GUI | Every test passes in headless Edge/Chrome against a real server | `node tests/run.mjs gui` | commits on master, pushes to master, CI |
| Clean console | Zero console errors, uncaught exceptions or failed requests on the page, beyond the expected `/rejoin` 404 | `assertClean()` in `tests/gui/*.test.mjs` | as GUI |
| Accessibility | Zero reachable controls on the home screen without an accessible name | `tests/gui/home.test.mjs` | as GUI |
| Pending | Every test in `tests/pending.json` fails; none passes while still listed | `node tests/run.mjs` | every run |
| The gate itself | Every guard scenario passes | `node tests/run.mjs tools` | every commit, CI |
| Security: deps | Nothing at high or above in the server's production dependencies | `node tests/lib/audit.mjs` (npm audit) | CI |

Every row names the command that produces the verdict. The quick profile
(`server`, `web`, `tools`) runs before every commit on a branch; the full
profile (every tier) before every commit, merge and push on master, and in CI
for every push. Pages only deploys after the full profile is green.

## Measured, not yet enforced

| Metric | Today | Direction |
|--------|-------|-----------|
| Tests in the full profile | 361 | must not fall |
| Quick profile, wall time | 13 s | must not grow past 20 s |
| Full profile, wall time | 85 s | must not grow past 180 s |

## Exceptions

| ID | Rule | Path | Reason | Owner | Expires |
|----|------|------|--------|-------|---------|
| W1 | deps-high | nanoid (via colyseus) | nanoid < 3.3.8 in colyseus 0.16 (predictable ids for non-integer sizes only; colyseus passes integers). The fix is the colyseus 0.18 major upgrade | @FloMoTionGo | 2027-01-01 |
