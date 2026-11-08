# GoCalypse

A free-for-all Go variant for four players, online and synced live.

**[Play now](https://flomotiongo.github.io/GoCalypse/)** · [Full rules](docs/rules.md)

## The game

Each player holds two stones: black or white on the left mouse button, gray or
transparent on the right. A stone fights on one of two **fronts**, black against
white or gray against transparent. The fronts are two Go games sharing one
board. On the front it doesn't fight on, a stone is only a wall, and the two
players who share a colour fight that front together.

When all four players pass in a row, each front is counted. **Your score is the
lower of your two fronts**, so you have to hold both.

Around the Go:

- **Night Market:** fireflies earned in play buy items from round 6. No item
  takes another player's stones off the board.
- **Kata:** a 3x3 shape you build up over the game and play in a single turn.
- **Thunderstorms:** lightning burns stones away, and for three rounds every
  stone looks the same grey.
- **River crab and river spirit:** they climb onto the board's edge and take
  stones within reach.
- **Haiku:** lines laid on the least played points. Collect them for a card
  that levels up.

Tables come in 9×9, 13×13 (the default), 19×19 and 25×25; 9×9 is pure Go, with
none of the above. A table scores the GoCalypse way, Japanese or Chinese. Games
of 50 turns or more can be watched under *Replays*.

## Bots

Bots are opt-in: up to three at a table, in six styles from pure Go to market
shark.

**They are not AI.** Each is a hand-written scorer over the board, with no
neural network, no model and no training data, and nothing learns while it
plays. Some weights were tuned offline by self-play and pasted in as fixed
numbers. What the bots look at comes from GoSequencer's classic player, which
draws on [Leela](https://github.com/gcp/Leela) by Gian-Carlo Pascutto (MIT). No
Leela source or data is copied.

## Run it locally

The server is TypeScript on [Colyseus](https://colyseus.io/). The client is
plain HTML, CSS and JS with no build step.

```
cd server
npm install
npm run dev
```

```
cd web
npx serve .
```

Set the Server field in the page's footer to `ws://localhost:2567`, since it
defaults to the live server. Open 4 tabs to fill a room, or
`debug.html#server=ws://localhost:2567` to get all four players in one tab.

`node tests/run.mjs` runs every test tier and `node tests/run.mjs quick` the
fast ones. Turn on the git hooks once with `git config core.hooksPath .githooks`.

## More

| Page | What's in it |
|---|---|
| [docs/rules.md](docs/rules.md) | Every rule, item, price and bot |
| [docs/development.md](docs/development.md) | Architecture, debug tables, art, running and testing |
| [docs/deploying.md](docs/deploying.md) | Fly.io and GitHub Pages, abuse limits, saved games (*Removing a game*, *Test noise is not kept*) |
| [tests/README.md](tests/README.md) | How the tests work and the red-first workflow |
| [CONSTRAINTS.md](CONSTRAINTS.md) | The quality bar |
