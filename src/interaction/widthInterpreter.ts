import * as THREE from 'three';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

/**
 * Width manipulation while WIDTH_EDIT is engaged (Phase 4) — mirrors
 * HeightManipulator's begin/update/end shape exactly, but tracks the
 * cursor's NDC DISTANCE FROM THE OBJECT'S PROJECTED CENTER instead of raw
 * NDC-Y: moving away from center grows that distance (grows the object),
 * moving toward it shrinks the distance (shrinks the object) — "hand
 * moving away from/toward the center" per the gesture's own description.
 */
export class WidthManipulator {
  private lastDistance: number | null = null;

  begin(cursorNdc: THREE.Vector2, centerNdc: THREE.Vector2): void {
    this.lastDistance = cursorNdc.distanceTo(centerNdc);
  }

  /** Scale delta for THIS frame only (incremental — feed straight into MeshDeformer.applyWidthDelta each frame). */
  update(cursorNdc: THREE.Vector2, centerNdc: THREE.Vector2): number {
    const distance = cursorNdc.distanceTo(centerNdc);
    if (this.lastDistance == null) {
      this.lastDistance = distance;
      return 0;
    }
    const rawDelta = distance - this.lastDistance;
    this.lastDistance = distance;
    if (Math.abs(rawDelta) < INTERACTION_CONFIG.width.deadZone) return 0;
    return rawDelta * INTERACTION_CONFIG.width.sensitivity;
  }

  end(): void {
    this.lastDistance = null;
  }
}
