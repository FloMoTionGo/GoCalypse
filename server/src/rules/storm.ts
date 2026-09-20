// Weather. Every so many turns the room rolls a D20 out of sight and adds one
// for every calm roll since the last storm; a total of 20 breaks a
// thunderstorm over the board (see rooms/GoRoom.ts for the timers and
// web/pixelScene.js for what it looks like). So the first roll is a 1-in-20
// chance and every calm roll after it adds another 5%, until a storm resets it.
//
// The decisions live here, away from room state, so they can be tested
// without a server: when to roll, what the roll means, how likely the next one
// is, and where the bolts land.

export const STORM_EVERY_TURNS = 20;
export const STORM_DIE_FACES = 20;
export const STORM_TARGET = 20; // a roll plus the calm rolls before it must reach this
export const STORM_MAX_STRIKES = 3;
export const FIRE_ROUNDS = 3;

export type StormLevel = "unlikely" | "likely" | "very likely";

/** A die is rolled every `every` turns -- never on turn 0, the empty board. */
export function isRollTurn(turnCount: number, every: number = STORM_EVERY_TURNS): boolean {
  return turnCount > 0 && every > 0 && turnCount % every === 0;
}

export function rollDie(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * STORM_DIE_FACES);
}

/** A storm breaks when the roll, plus one per calm roll since the last storm, reaches the target. */
export function isStormRoll(roll: number, calmRolls: number = 0): boolean {
  return roll + calmRolls >= STORM_TARGET;
}

/** The chance (0..1) that the next roll breaks a storm, after `calmRolls` calm ones in a row. */
export function stormChance(calmRolls: number): number {
  const lowestWinningFace = Math.max(1, STORM_TARGET - Math.max(0, calmRolls));
  return (STORM_DIE_FACES - lowestWinningFace + 1) / STORM_DIE_FACES;
}

/** The forecast shown to players: 5-10% unlikely, 15-25% likely, 30% and up very likely. */
export function stormLevel(calmRolls: number): StormLevel {
  const chance = stormChance(calmRolls);
  if (chance < 0.15) return "unlikely";
  if (chance < 0.3) return "likely";
  return "very likely";
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
