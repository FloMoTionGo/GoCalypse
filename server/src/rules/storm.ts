// Weather. Every so many turns the room rolls a die out of sight; a six
// breaks a thunderstorm over the board (see rooms/GoRoom.ts for the timers
// and web/pixelScene.js for what it looks like).
//
// The decisions live here, away from room state, so they can be tested
// without a server: when to roll, what the roll means, and where the bolts
// land.

export const STORM_EVERY_TURNS = 20;
export const STORM_DIE_FACES = 6;
export const STORM_ON_ROLL = 6;
export const STORM_MAX_STRIKES = 3;
export const FIRE_ROUNDS = 3;

/** A die is rolled every `every` turns -- never on turn 0, the empty board. */
export function isRollTurn(turnCount: number, every: number = STORM_EVERY_TURNS): boolean {
  return turnCount > 0 && every > 0 && turnCount % every === 0;
}

export function rollDie(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * STORM_DIE_FACES);
}

export function isStormRoll(roll: number): boolean {
  return roll === STORM_ON_ROLL;
}

/**
 * Where the lightning hits: up to STORM_MAX_STRIKES distinct board cells
 * drawn from `candidates` (the caller leaves out anything warded or already
 * alight). Fewer candidates than bolts simply means fewer bolts.
 */
export function pickStrikes(
  candidates: number[],
  random: () => number = Math.random,
  maxStrikes: number = STORM_MAX_STRIKES
): number[] {
  const pool = candidates.slice();
  const wanted = Math.min(1 + Math.floor(random() * maxStrikes), pool.length);
  const struck: number[] = [];
  for (let k = 0; k < wanted; k++) {
    struck.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return struck;
}
