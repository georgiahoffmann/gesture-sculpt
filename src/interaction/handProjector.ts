import * as THREE from 'three';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export interface ProjectedCursor {
  ndc: THREE.Vector2;
  /** Filtered, hand-scale-normalized, per-frame depth motion — never raw MediaPipe Z. 0 for pointers with no depth channel (mouse). */
  depthDelta: number;
}

/**
 * The ONE place mirroring is applied, and the ONE place raw MediaPipe Z
 * becomes a usable depth signal. Every other module (raycasting, brush,
 * overlay drawing) consumes the result of this and never touches raw
 * landmark coordinates directly — this is what guarantees the webcam,
 * MediaPipe, viewport and raycaster all agree on "left" and "near/far",
 * instead of each doing its own ad hoc flip.
 *
 * Depth normalization: raw z is divided by the hand's own span (wrist to
 * middle-knuckle) so the same physical hand movement produces a comparable
 * signal regardless of how close the user is standing to the webcam, then
 * the frame-to-frame delta of THAT is smoothed with its own EMA — raw Z is
 * one of MediaPipe's noisiest channels, so it gets its own filter rather
 * than reusing the landmark-smoothing pass.
 */
export class HandProjector {
  private prevNormalizedZ = new Map<string, number>();
  private depthDeltaEma = new Map<string, number>();

  /** Hand cursor: mirrors x so it matches the mirrored webcam preview the user is looking at. */
  projectHand(id: string, point2D: { x: number; y: number }, rawZ: number, handSpan: number): ProjectedCursor {
    const ndc = new THREE.Vector2((1 - point2D.x) * 2 - 1, 1 - point2D.y * 2);
    return { ndc, depthDelta: this.computeDepthDelta(id, rawZ, handSpan) };
  }

  /** Mouse cursor: pixel-space NDC, no mirroring (mouse input isn't mirrored), no depth channel. */
  projectMouse(ndcX: number, ndcY: number): ProjectedCursor {
    return { ndc: new THREE.Vector2(ndcX, ndcY), depthDelta: 0 };
  }

  private computeDepthDelta(id: string, rawZ: number, handSpan: number): number {
    const normalizedZ = rawZ / Math.max(1e-4, handSpan);
    const prev = this.prevNormalizedZ.get(id);
    this.prevNormalizedZ.set(id, normalizedZ);
    const rawDelta = prev == null ? 0 : normalizedZ - prev;

    const prevEma = this.depthDeltaEma.get(id) ?? 0;
    const filtered = prevEma + (rawDelta - prevEma) * INTERACTION_CONFIG.featureSmoothing.velocityFactor;
    this.depthDeltaEma.set(id, filtered);
    return filtered;
  }

  reset(id: string): void {
    this.prevNormalizedZ.delete(id);
    this.depthDeltaEma.delete(id);
  }
}
