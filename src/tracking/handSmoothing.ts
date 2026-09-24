import type { Point3D } from './types';

/**
 * Exponential (lerp) smoothing of a hand's 21 landmarks, keyed by handedness so
 * left/right hands keep independent smoothing history. Deliberately isolated
 * behind this small class so the technique (currently simple lerp) can be
 * swapped later — e.g. for a One-Euro filter — without touching call sites.
 */
export class HandSmoothing {
  private history = new Map<string, Point3D[]>();

  constructor(private factor: number) {}

  setFactor(factor: number): void {
    this.factor = factor;
  }

  smooth(key: string, raw: Point3D[]): Point3D[] {
    const previous = this.history.get(key);
    if (!previous || previous.length !== raw.length) {
      const seeded = raw.map((p) => ({ ...p }));
      this.history.set(key, seeded);
      return seeded;
    }

    const next = raw.map((p, i) => {
      const q = previous[i];
      return {
        x: q.x + (p.x - q.x) * this.factor,
        y: q.y + (p.y - q.y) * this.factor,
        z: q.z + (p.z - q.z) * this.factor,
      };
    });
    this.history.set(key, next);
    return next;
  }

  reset(key?: string): void {
    if (key) this.history.delete(key);
    else this.history.clear();
  }
}
