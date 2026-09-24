import * as THREE from 'three';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

/**
 * Height manipulation while HEIGHT_EDIT is engaged. Zone detection and
 * engage/release hysteresis now live in InteractionStateMachine (gated by
 * pinch) — this class only turns continuous cursor Y motion into a height
 * delta, mirroring RotationDetector's begin/update/end lifecycle so both
 * "zone tools" have the same shape.
 *
 * Moving away from the object (up, since the hand is already above it)
 * grows it; moving back down shrinks it. The base stays anchored —
 * MeshDeformer.applyHeightDelta weights this by each vertex's height
 * fraction, never a uniform `mesh.scale.y`.
 */
export class HeightManipulator {
  private lastNdcY: number | null = null;

  begin(cursorNdc: THREE.Vector2): void {
    this.lastNdcY = cursorNdc.y;
  }

  /** World-space Y delta for THIS frame only (incremental — feed straight into MeshDeformer.applyHeightDelta each frame). */
  update(cursorNdc: THREE.Vector2): number {
    if (this.lastNdcY == null) {
      this.lastNdcY = cursorNdc.y;
      return 0;
    }
    const rawDelta = cursorNdc.y - this.lastNdcY;
    this.lastNdcY = cursorNdc.y;
    if (Math.abs(rawDelta) < INTERACTION_CONFIG.height.deadZone) return 0;
    return rawDelta * INTERACTION_CONFIG.height.sensitivity;
  }

  end(): void {
    this.lastNdcY = null;
  }
}
