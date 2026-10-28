/**
 * Seeded pseudo-random generator (mulberry32). Its whole state is one 32-bit
 * integer, so it is saved with the simulation and replays exactly.
 */
export class Rng {
  private s: number;

  constructor(seedOrState: number) {
    this.s = seedOrState >>> 0;
  }

  get state(): number {
    return this.s;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}
