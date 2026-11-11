// The lobby board's stones: every point of the setup board wears one of the 16
// two-look combinations (sprites.js, lobbyStoneCode), drawn once per page load.
// Plain script, no dependencies besides sprites.js: `window.GoLobbyStones` in the
// browser, `module.exports` in Node, so the draw can be tested outside a browser.
//
// The board is grown from its tengen (centre point) outwards:
//  - A board with no centre row or column (an even size) gets a spare one for the
//    draw, below or to the right, and is cropped back afterwards.
//  - The tengen's stone is drawn with equal chance out of the 16.
//  - Each further point is drawn next to the stone it grew from (its source): a
//    stone sharing at least one look with the source is 50 % more likely
//    (weight 1.5 against 1).
//  - No two stones match side by side or above each other. Diagonals may.
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const G = isNode ? require("./sprites.js") : root.GoSprites;
  const api = factory(G);
  if (isNode) module.exports = api;
  else root.GoLobbyStones = api;
})(typeof self !== "undefined" ? self : this, function (G) {
  "use strict";

  const SHARE_BOOST = 1.5;
  const CODES = G.LOBBY_STONE_CODES;

  const shares = (a, b) => {
    const looks = G.lobbyStoneLooks(b);
    return G.lobbyStoneLooks(a).some((look) => looks.includes(look));
  };

  /**
   * The stones a point may take, each with its weight: every one of the 16 that is
   * not in `taken`, 1.5 for those sharing a look with `source` (0 for no source).
   */
  function stoneWeights(source, taken) {
    return CODES.filter((code) => !taken.has(code)).map((code) => ({ code, weight: source && shares(code, source) ? SHARE_BOOST : 1 }));
  }

  /** One weighted draw; `random` gives numbers in [0, 1). */
  function draw(weights, random) {
    let roll = random() * weights.reduce((sum, w) => sum + w.weight, 0);
    for (const w of weights) {
      roll -= w.weight;
      if (roll < 0) return w.code;
    }
    return weights[weights.length - 1].code;
  }

  /**
   * Draws a stone for every point of a cols x rows board. Returns { grid, tengen }: grid[row][col]
   * is the stone's code, tengen the centre point { col, row } (floor of half each way).
   */
  function growStones({ cols, rows, random = Math.random }) {
    const w = cols + (cols % 2 === 0 ? 1 : 0), h = rows + (rows % 2 === 0 ? 1 : 0);
    const tengen = { col: w >> 1, row: h >> 1 };
    const grid = Array.from({ length: h }, () => Array(w).fill(0));
    const place = (col, row, source) => {
      const taken = new Set();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const near = (grid[row + dr] || [])[col + dc];
        if (near) taken.add(near);
      }
      grid[row][col] = draw(stoneWeights(source, taken), random);
    };
    place(tengen.col, tengen.row, 0);
    const queue = [[tengen.col, tengen.row]], seen = new Set([`${tengen.col},${tengen.row}`]);
    while (queue.length) {
      const [col, row] = queue.shift();
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const c = col + dc, r = row + dr;
        if (c < 0 || r < 0 || c >= w || r >= h || seen.has(`${c},${r}`)) continue;
        seen.add(`${c},${r}`);
        place(c, r, grid[row][col]);
        queue.push([c, r]);
      }
    }
    return { grid: grid.slice(0, rows).map((line) => line.slice(0, cols)), tengen };
  }

  return { SHARE_BOOST, stoneWeights, growStones };
});
