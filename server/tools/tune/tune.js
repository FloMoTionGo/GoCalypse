// Offline weight search for the three recruits, by self-play on 13x13.
//
// Nothing here runs on the server and nothing learns while a game is on. This
// is a search: it plays a lot of matches, finds integer weights that do better
// than the ones in bots/styles.ts, and prints them for a human to paste in. The
// honesty note at the top of styles.ts stays true -- a move is still a few
// hundred integer additions, written by hand, and now chosen by measurement.
//
// It is a (1 + lambda) hill climb. Each generation perturbs the current best a
// few weights at a time, plays every mutant against the three shipped recruits
// in all four seats, and keeps a mutant only if it beats the incumbent. The
// seeds are fixed, so a run is reproducible and a claimed gain can be re-checked.
//
// What it does NOT tune: `shopping`, `itemBias`, `prefers`, `variation` and
// `judgement`. The self-play driver has no Night Market (see bots/selfplay.ts),
// so item weights are not exercised and any number it found for them would be
// noise. `prefers` and the item weights are also what make the three read as
// three different players, which is the point of having three.
//
// A word on noise, because it decides whether any of this means anything. One
// match is worth a few points of margin either way, so a candidate measured on
// too few of them is measured mostly on luck. Against disjoint seed sets the
// same unchanged Reed scores with a standard deviation of about 3.2 margin
// points over 12 matches, 2.4 over 24, and 1.1 over 48. Picking the best of
// lambda mutants then adds selection bias on top: on 12 matches a do-nothing
// search "improves" by 8 points in one generation. So:
//
//  - every candidate in a generation is played on the SAME seeds as the
//    incumbent, which pairs the comparison and cancels most of the spread;
//  - the default is 12 seeds, i.e. 48 matches a candidate;
//  - a mutant that wins its generation must win AGAIN on seeds neither it nor
//    the incumbent has seen, and those change every generation. Without that,
//    four generations running won the training seeds by 3.5 to 5.0 and lost the
//    confirmation every time;
//  - and the winner is finally replayed on several DISJOINT held-out blocks, so
//    the gain comes with a spread. It is kept only if it clears that spread.
//    A single block cannot tell a small gain from a lucky one: one block once
//    put Reed at "+0.34, holds up", and five blocks put the same weights at
//    -0.48 with a spread of 1.45.
//
// So far this has found nothing that clears the bar. That is a result: the
// hand-written weights sit close enough to a local optimum that this search, at
// an affordable number of matches, cannot show daylight. Run it again with more
// seeds, more generations or a cleverer mutation if you want to push further.
//
//   node tools/tune/tune.js [--style reed|tanuki|magpie] [--generations N]
//                           [--lambda N] [--seeds N] [--holdout N] [--blocks N]
//                           [--size N] [--workers N]
//
// Run `npm run build` first: the workers play the compiled server.

const { Worker } = require("node:worker_threads");
const os = require("node:os");
const path = require("node:path");

const BUILD = path.join(__dirname, "..", "..", "build");
const styles = require(path.join(BUILD, "bots", "styles.js"));

// The board terms, and only those. Each is in hundredths of a point.
const TUNABLE = [
  "capture",
  "save",
  "atari",
  "connect",
  "cut",
  "contact",
  "locality",
  "extension",
  "line",
  "selfAtari",
  "hemmed",
  "axisBias",
];

/**
 * What each recruit must stay, however the search goes. Three styles that
 * converge on one set of numbers are one style wearing three names, so each
 * keeps the trait it is named for. `floor` and `ceiling` are inclusive.
 */
const GUARDS = {
  reed: {}, // the plain board player: every term is free
  tanuki: { capture: { floor: 1400 }, cut: { floor: 350 }, contact: { floor: 150 } },
  magpie: { capture: { floor: 1100 }, locality: { floor: 300 } },
};

const RECRUITS = { reed: styles.reed, tanuki: styles.tanuki, magpie: styles.magpie };

function parseArgs(argv) {
  const args = {
    style: "reed",
    generations: 16,
    lambda: 8,
    seeds: 12, // x 4 seats = 48 matches a candidate; see the note on noise above
    holdout: 12, // seeds per out-of-sample block
    blocks: 5, // disjoint blocks of them, so the gain can be given a spread
    size: 13,
    workers: Math.max(1, Math.min(os.cpus().length - 1, 12)),
  };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in args)) throw new Error(`unknown option ${argv[i]}`);
    args[key] = key === "style" ? argv[i + 1] : Number(argv[i + 1]);
  }
  if (!RECRUITS[args.style]) throw new Error(`unknown style ${args.style}`);
  return args;
}

// A small deterministic generator, so a run with the same options repeats.
function rng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

function clampToGuard(name, key, value) {
  const guard = (GUARDS[name] || {})[key];
  if (!guard) return value;
  if (guard.floor !== undefined && value < guard.floor) return guard.floor;
  if (guard.ceiling !== undefined && value > guard.ceiling) return guard.ceiling;
  return value;
}

/** A mutant: one to three weights moved by 10-25%, kept whole and non-negative. */
function mutate(style, name, random) {
  const next = { ...style };
  const count = 1 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const key = TUNABLE[Math.floor(random() * TUNABLE.length)];
    const step = 0.1 + random() * 0.15;
    const scaled = style[key] * (random() < 0.5 ? 1 - step : 1 + step);
    // A weight sitting at zero can never grow by a percentage, so give it a
    // floor to climb off. axisBias is the one that starts there for most.
    const moved = Math.abs(style[key]) < 50 ? (random() < 0.5 ? 0 : 100) : scaled;
    next[key] = clampToGuard(name, key, Math.max(0, Math.round(moved)));
  }
  return next;
}

function pool(size, seeds, boardSize) {
  const workers = [];
  for (let i = 0; i < size; i++) {
    workers.push(
      new Worker(path.join(__dirname, "worker.js"), { workerData: { seeds, size: boardSize } })
    );
  }
  let next = 0;
  const waiting = new Map();
  for (const w of workers) {
    w.on("message", (msg) => {
      const resolve = waiting.get(msg.id);
      waiting.delete(msg.id);
      resolve(msg);
    });
    w.on("error", (err) => {
      console.error(err);
      process.exit(1);
    });
  }
  let id = 0;
  return {
    score(style) {
      const jobId = id++;
      const worker = workers[next++ % workers.length];
      return new Promise((resolve) => {
        waiting.set(jobId, resolve);
        worker.postMessage({ id: jobId, style });
      });
    },
    async close() {
      await Promise.all(workers.map((w) => w.terminate()));
    },
  };
}

/** Margin first, then average place: better is a bigger margin, or a lower place. */
function better(a, b) {
  if (!b) return true;
  if (a.margin !== b.margin) return a.margin > b.margin;
  return a.place < b.place;
}

async function main() {
  const args = parseArgs(process.argv);
  const seeds = Array.from({ length: args.seeds }, (_, i) => 1000 + i * 7919);
  const baseline = RECRUITS[args.style]();
  const random = rng(0xc0ffee ^ args.style.length);

  console.log(
    `tuning ${baseline.name} on ${args.size}x${args.size}: ` +
      `${args.generations} generations x ${args.lambda} mutants, ` +
      `${seeds.length} seeds x 4 seats = ${seeds.length * 4} matches each, ` +
      `${args.workers} workers`
  );

  const workers = pool(args.workers, seeds, args.size);
  let best = baseline;
  let bestScore = await workers.score(baseline);
  const start = bestScore;
  console.log(`  baseline  margin ${start.margin.toFixed(2)}  place ${start.place.toFixed(2)}`);

  for (let gen = 1; gen <= args.generations; gen++) {
    const mutants = Array.from({ length: args.lambda }, () => mutate(best, args.style, random));
    const scored = await Promise.all(
      mutants.map(async (m, i) => {
        const score = await workers.score(m);
        // Per mutant, as it lands: without this a slow generation and a hung
        // one look exactly alike from outside, which cost an hour once.
        process.stdout.write(
          `    [${gen}.${i}] ${(score.ms / 1000).toFixed(0)}s` +
            `${score.unfinished ? ` ${score.unfinished} unfinished` : ""}` +
            `  margin ${score.margin.toFixed(2)}\n`
        );
        return { style: m, score };
      })
    );
    scored.sort((a, b) => (better(a.score, b.score) ? -1 : 1));
    const top = scored[0];

    // Winning the generation is not enough. The best of eight noisy draws beats
    // the incumbent on luck alone often enough to walk the search uphill on
    // nothing -- a first run of this tool "improved" Reed by 5.5 points on the
    // training seeds and gave 3.2 of them back out of sample. So the winner has
    // to beat the incumbent a second time, on seeds neither has been scored on,
    // and those seeds are different every generation.
    let took = better(top.score, bestScore);
    let note = "--";
    if (took) {
      const confirmSeeds = Array.from({ length: args.seeds }, (_, i) => 400_000 + gen * 31 + i * 7919);
      const jury = pool(2, confirmSeeds, args.size);
      const [heldBest, heldTop] = await Promise.all([jury.score(best), jury.score(top.style)]);
      await jury.close();
      took = better(heldTop, heldBest);
      if (!took) {
        note =
          `won by ${(top.score.margin - bestScore.margin).toFixed(2)}, then lost the ` +
          `confirmation by ${(heldTop.margin - heldBest.margin).toFixed(2)} -- dropped`;
      }
    }
    if (took) {
      const changed = TUNABLE.filter((k) => top.style[k] !== best[k])
        .map((k) => `${k} ${best[k]}->${top.style[k]}`)
        .join(", ");
      best = top.style;
      bestScore = top.score;
      console.log(
        `  gen ${String(gen).padStart(3)}  margin ${bestScore.margin.toFixed(2)}  ` +
          `place ${bestScore.place.toFixed(2)}  ${changed}`
      );
    } else {
      console.log(`  gen ${String(gen).padStart(3)}  ${note}`);
    }
  }

  await workers.close();

  console.log(
    `\n${baseline.name} on the training seeds: ` +
      `margin ${start.margin.toFixed(2)} -> ${bestScore.margin.toFixed(2)}, ` +
      `place ${start.place.toFixed(2)} -> ${bestScore.place.toFixed(2)}`
  );

  // The only numbers worth believing: seeds neither the search nor the
  // incumbent has been scored on.
  //
  // Several disjoint blocks of them, not one. A single held-out block gives one
  // difference and no way to tell a small gain from a lucky one -- an earlier
  // version of this check reported Reed "+0.34, holds up" on one block, and
  // five blocks put the same weights at -0.48 with a spread of 1.45. One number
  // cannot say that; a handful can.
  const diffs = [];
  console.log(`\n${baseline.name} out of sample, ${args.blocks} disjoint blocks:`);
  for (let block = 0; block < args.blocks; block++) {
    const seeds = Array.from({ length: args.holdout }, (_, i) => 700_000 + block * 50_000 + i * 7919);
    const jury = pool(2, seeds, args.size);
    const [was, is] = await Promise.all([jury.score(baseline), jury.score(best)]);
    await jury.close();
    diffs.push(is.margin - was.margin);
    console.log(
      `  block ${block}: ${seeds.length * 4} matches  ` +
        `baseline ${was.margin.toFixed(2)}  tuned ${is.margin.toFixed(2)}  ` +
        `diff ${(is.margin - was.margin).toFixed(2)}`
    );
  }

  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length);
  console.log(`  mean ${mean.toFixed(2)}  sd ${sd.toFixed(2)}`);

  // A gain has to clear its own spread to count. Anything smaller is a result
  // about these seeds, not about these weights.
  const real = mean - sd > 0;
  console.log(
    real
      ? `\n  KEEP: +${mean.toFixed(2)} out of sample, clear of a spread of ${sd.toFixed(2)}.\n`
      : `\n  DISCARD: +${mean.toFixed(2)} does not clear a spread of ${sd.toFixed(2)}. ` +
          `Keep the shipped weights.\n`
  );
  if (!real) return;
  for (const key of TUNABLE) {
    const mark = best[key] === baseline[key] ? "  " : "* ";
    console.log(`${mark}${key}: ${best[key]},${best[key] === baseline[key] ? "" : ` // was ${baseline[key]}`}`);
  }
}

main();
