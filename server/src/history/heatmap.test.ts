import { test } from "node:test";
import assert from "node:assert/strict";
import { Heatmap } from "./heatmap";

// history/heatmap.ts: which games teach the haiku where the board is quiet
// (tasks/security_fixes T9). Debug tables (go_debug: every item from the first
// turn) play nothing like a match, so they are not counted.

const game = (room: string) => ({ room, size: 13, frames: [{ d: [0, 1, 1, 2] }] });

test("the heat counts go_custom games only", () => {
  const heat = new Heatmap();
  heat.add(game("go_debug"));
  assert.equal(heat.games(13), 0, "a debug game teaches nothing");
  heat.add(game("go_custom"));
  assert.equal(heat.games(13), 1);
  heat.add({ size: 13, frames: [{ d: [2, 1] }] }); // a record saved before rooms were written down: a match
  assert.equal(heat.games(13), 2);
});

test("the heat skips a game nobody human played", () => {
  const heat = new Heatmap();
  const seats = (bot: boolean) => [1, 2, 3, 4].map((color) => ({ name: `B${color}`, color, bot, place: 1, finalScore: 0, tiebreak: 0, captures: 0 }));
  heat.add({ ...game("go_custom"), players: seats(true) } as any);
  assert.equal(heat.games(13), 0, "four bots teach nothing");
  heat.add({ ...game("go_custom"), players: [{ ...seats(true)[0], bot: false }, ...seats(true).slice(1)] } as any);
  assert.equal(heat.games(13), 1, "one person at the table makes it a match");
});
