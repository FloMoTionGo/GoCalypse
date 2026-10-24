// The Seedling's seed grows in three steps, one round each (ideas.md §11.5):
//   1 seed     anyone may play on it, and their stone tramples it
//   2 sprout   only its planter may play there (their stone ends it early)
//   3 sapling  as the sprout; at the turn change after it, it grows
// web/pixelScene.js mirrors seedStep to draw the right picture.

export const SEED_ROUNDS = 3;

/**
 * The step (1, 2 or 3) of a seed that grows at `until`, at `turnCount`, with
 * `seats` turns to a round. Worked out from the turns it has left, as the
 * timers are; a seed waiting out a ko past its time stays a sapling.
 */
export function seedStep(until: number, turnCount: number, seats: number): number {
  const roundsLeft = Math.ceil((until - turnCount) / Math.max(1, seats));
  return Math.min(SEED_ROUNDS, Math.max(1, SEED_ROUNDS + 1 - roundsLeft));
}
