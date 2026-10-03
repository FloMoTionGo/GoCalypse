// findings B7, B8, B10 (was findings-tests/scene-storm.cjs): under the storm's
// grey nothing on the board may tell one player's stones from another's.
// Method: render a state, render it again with every stone and owner turned to
// the next player's colour, and require the two to be byte-identical under the
// grey -- and different outside it, so each check can fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const n = 13, T = 1000;
const scene = P.createScene({ size: n });
const CODES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13]; // base, pattern and twin stones of all four players
const rot = (c) => (c >= 1 && c <= 4 ? (c % 4) + 1 : c >= 5 && c <= 8 ? ((c - 4) % 4) + 5 : c >= 10 && c <= 13 ? ((c - 9) % 4) + 10 : c);
const diff = (s1, s2) => {
  const a = scene.render(s1).slice(), b = scene.render(s2);
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
};
const STORM = { turnCount: 100, roundLength: 4, stormUntil: 108 }; // two full rounds of grey left
const CALM = { turnCount: 100, roundLength: 4, stormUntil: 0 };
const common = { myColor: 1, ambientTime: 5, time: T, overlays: [], effects: [] };
const with_ = (...parts) => Object.assign({}, ...parts);

test("storm grey: settled stones of all 12 codes can't be told apart (and can outside the storm)", () => {
  const board = new Array(n * n).fill(0);
  CODES.forEach((c, i) => (board[(2 + (i >> 2) * 2) * n + 2 + (i & 3) * 2] = c));
  const s = with_(common, { board }), t = with_(common, { board: board.map(rot) });
  assert.equal(diff(with_(s, STORM), with_(t, STORM)), 0);
  assert.ok(diff(with_(s, CALM), with_(t, CALM)) > 0);
});

for (const reducedMotion of [false, true]) {
  test(`storm grey (B7): stones in flight show no colour, reducedMotion ${reducedMotion}`, () => {
    let worst = null, sensitive = 0;
    for (const code of CODES) {
      for (const kind of P.EFFECT_KINDS) {
        for (let el = 0.005; el < 1.2; el += 0.02) {
          const e = P.makeEffect(kind, 5, 5, { code, from: code <= 4 ? code + 4 : code <= 8 ? code - 4 : code, owner: 2 }, T - el);
          const f = with_(e, { code: rot(e.code), from: rot(e.from), owner: rot(e.owner) });
          const s = with_(common, { board: new Array(n * n).fill(0), reducedMotion });
          const d = diff(with_(s, STORM, { effects: [e] }), with_(s, STORM, { effects: [f] }));
          if (d && !worst) worst = `${kind} code ${code} at ${el.toFixed(3)} s: ${d} px`;
          if (el < 0.1) sensitive += diff(with_(s, CALM, { effects: [e] }), with_(s, CALM, { effects: [f] }));
        }
      }
    }
    assert.equal(worst, null);
    assert.ok(sensitive > 0);
  });
}

test("storm grey (B8): owner marks on wards, lily pads, seeds and the lily bloom are hidden; timers stay", () => {
  const board = new Array(n * n).fill(0);
  board[3 * n + 3] = 3;
  board[3 * n + 4] = 3;
  const overlays = [
    { kind: "ward", x: 3, y: 3, owner: 3, until: 108 }, { kind: "ward", x: 4, y: 3, owner: 3, until: 108 },
    { kind: "lily", x: 6, y: 6, owner: 2, until: 110 }, { kind: "seed", x: 8, y: 8, owner: 4, until: 106, axis: "base" },
    { kind: "seed", x: 9, y: 5, owner: 1, until: 106, axis: "pattern" },
  ];
  const s = with_(common, { board, overlays, effects: [P.makeEffect("lily", 10, 10, { owner: 2 }, T - 0.3)] });
  const t = with_(common, {
    board: board.map(rot),
    overlays: overlays.map((o) => with_(o, { owner: rot(o.owner) })),
    effects: [P.makeEffect("lily", 10, 10, { owner: 3 }, T - 0.3)],
  });
  assert.equal(diff(with_(s, STORM), with_(t, STORM)), 0);
  assert.ok(diff(with_(s, CALM), with_(t, CALM)) > 0);
  const noTimers = with_(s, STORM, { overlays: overlays.map((o) => with_(o, { until: undefined })) });
  assert.ok(diff(with_(s, STORM), noTimers) > 0, "rounds-left timers still drawn under the grey");
});

test("storm weather (B10): no firefly halos while it lasts", () => {
  const ramp = G.Surface.prototype.ramp;
  let halos = 0;
  G.Surface.prototype.ramp = function (table, cx, cy, radius, ...rest) {
    if (radius === 3.5) halos++; // firefly halos are the only lights of radius 3.5
    return ramp.call(this, table, cx, cy, radius, ...rest);
  };
  const board = new Array(n * n).fill(0);
  const count = (weather) => {
    halos = 0;
    for (let t = 0; t < 20; t += 0.1) scene.render(with_(common, weather, { board, time: t, ambientTime: t }));
    return halos;
  };
  try {
    const calm = count(CALM), stormy = count(STORM);
    assert.ok(calm > 0, `calm ${calm}`);
    assert.equal(stormy, 0);
  } finally {
    G.Surface.prototype.ramp = ramp;
  }
});
