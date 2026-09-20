// xorshift32. A seed names a bot's game exactly, on any machine and after a
// reload, which is what lets a test replay a whole 4-bot match from one number
// (see bots.test.ts). Integer only: no Math.random anywhere below the room.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** The next 32-bit value. */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s;
  }

  /** A uniform integer in [0, n). */
  below(n: number): number {
    return n > 0 ? this.next() % n : 0;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.below(items.length)];
  }
}
