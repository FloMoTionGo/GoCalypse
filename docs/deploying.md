# Deploying GoCalypse

[Back to the README](../README.md)

Live at `wss://gocalypse.fly.dev`. Deploys to [Fly.io](https://fly.io) via
the included `Dockerfile` and `fly.toml` (`fly deploy` from `server/`).
One machine is kept running (`min_machines_running = 1`, about $2/month):
letting Fly autostop an idle machine dropped players sitting in a lobby.

**Abuse limits** (`src/util/limits.ts`): one address may hold 16 live tables
and 32 sockets, and make 32 matchmake calls inside 15 seconds; a refused join
says why. One client may send 20 messages a second (a burst of 40); past that,
messages are dropped and the first drop is answered with a notice. The caps
are read once at start from `GOCALYPSE_MAX_ROOMS_PER_IP`,
`GOCALYPSE_MAX_SOCKETS_PER_IP` and `GOCALYPSE_MAX_RESERVATIONS_PER_IP`
(`fly.toml [env]` to change them without a code change). `/rejoin` takes ten
calls a minute per address (429 with `Retry-After` beyond that) and finds a
seat by an index the rooms keep, not by a scan. Behind Fly the address is
`Fly-Client-IP`, the one header a client cannot write (`src/util/net.ts`).

The image is `node:24-alpine`, installed with `npm ci` from the lockfile. It
starts as root only to make the data volume the `node` user's, then the
server drops to `node` before it opens a port (`RUN_AS=node` in the
Dockerfile; `src/util/privileges.ts`). Without `RUN_AS`, as locally and in
the tests, it runs as whoever started it.

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

## Saved games

**Removing a game:** on the machine that holds the data,
`DATA_DIR=/data node build/tools/forgetGame.js <game id>` deletes it (the id
is the one in the replay's URL and in `GET /history`). A server that is
running keeps the game in its list until its next restart.

**Test noise is not kept:** a game from a debug table, or one nobody human
played (every seat filled by the server; a person who left before the end
still played), is never saved and never teaches the
haiku where the board is quiet. Games saved before this rule are cleared with
`DATA_DIR=/data node build/tools/purgeHistory.js --dry-run` (lists what would
go and why), then without `--dry-run`; `--any-bot` also drops the games where
only some seats were bots. Same restart note as above.

**Short games are not kept:** a game of fewer than 50 turns, counted across the
whole table (`HISTORY_MIN_TURNS`), is never saved. Games saved before this rule
are cleared with the same tool and `--short` instead of `--any-bot`, which
removes those games and nothing else.
