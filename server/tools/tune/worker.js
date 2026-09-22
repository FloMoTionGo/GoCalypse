// One worker: plays the matches it is handed and reports a fitness.
//
// It runs against the compiled server (../../build), so `npm run build` has to
// have happened first. See README.md in this folder.

const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");

const BUILD = path.join(__dirname, "..", "..", "build");
const { playMatch } = require(path.join(BUILD, "bots", "selfplay.js"));
const styles = require(path.join(BUILD, "bots", "styles.js"));

const FIELD = [styles.reed, styles.tanuki, styles.magpie];

/**
 * A candidate's fitness against the three shipped recruits.
 *
 * Every match is played four times over, with the candidate in each of the four
 * seats in turn, because the seats are not alike: combo 1 moves first, and the
 * four combos hold different pairs of sides. Rotating cancels both out, so what
 * is left is the weights.
 *
 * The margin is the candidate's final score less the mean of the other three.
 * Place breaks ties, so two candidates that win by the same margin are told
 * apart by how often they win at all.
 */
function fitness(style, seeds, size) {
  let margin = 0;
  let places = 0;
  let matches = 0;
  let unfinished = 0;
  const started = Date.now();

  for (const seed of seeds) {
    for (let seat = 0; seat < 4; seat++) {
      const lineup = [];
      let take = 0;
      for (let i = 0; i < 4; i++) {
        lineup.push(i === seat ? style : FIELD[take++ % FIELD.length]());
      }
      // A finished game ends on four passes in about 300 turns. One that is
      // still going at three stones per point is a candidate that cannot bring
      // a game to a close, which is a defect and not a slow win -- cut it off
      // and score it as a loss, rather than letting it eat the whole search.
      const match = playMatch(seed, lineup, { size, turnCap: 3 * size * size });
      const mine = match.results[seat];
      const others = match.results.filter((_, i) => i !== seat);
      if (match.finished) {
        margin += mine.score - others.reduce((sum, r) => sum + r.score, 0) / others.length;
        places += mine.place;
      } else {
        unfinished += 1;
        margin += -100;
        places += 4;
      }
      matches += 1;
    }
  }

  return {
    margin: margin / matches,
    place: places / matches,
    matches,
    unfinished,
    ms: Date.now() - started,
  };
}

parentPort.on("message", (job) => {
  const scored = fitness(job.style, workerData.seeds, workerData.size);
  parentPort.postMessage({ id: job.id, ...scored });
});
