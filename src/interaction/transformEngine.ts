import * as THREE from 'three';

/**
 * The ONLY thing allowed to write to the sculptable object's transform.
 * Gestures hand it normalized deltas (already resolved to a baseline +
 * delta by the caller); this decides how that becomes an actual Three.js
 * transform. Conceptually mirrors Blender's `TransInfo` (mode + pivot +
 * constraint) — scoped down to what this app currently needs (rotation
 * around Y, with an optional snap step), with room to grow into
 * translate/scale/constraints/pivot later without new call sites having to
 * know about it.
 */
export class TransformEngine {
  constructor(private target: THREE.Object3D) {}

  getRotationY(): number {
    return this.target.rotation.y;
  }

  /**
   * Absolute rotation.y write. `snapDegrees` (0 = disabled) rounds to the
   * nearest increment — the hook for Blender-style rotation snapping
   * (section 14), off by default so it doesn't change today's feel until a
   * caller opts in.
   */
  setRotationY(value: number, snapDegrees = 0): void {
    if (snapDegrees > 0) {
      const step = (snapDegrees * Math.PI) / 180;
      value = Math.round(value / step) * step;
    }
    this.target.rotation.y = value;
  }
}
