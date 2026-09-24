import * as THREE from 'three';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export interface StrokeSample {
  atMs: number;
  worldPoint: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface StrokeFeatures {
  /** False when the previous touch is too stale to diff against — this frame starts a fresh segment (no jump delta). */
  hasContinuity: boolean;
  /** World-space movement of the touch point since the previous sample (zero if !hasContinuity). */
  frameDelta: THREE.Vector3;
  /** World units/sec. */
  velocity: number;
  /** Radians turned this frame relative to the recent travel direction. 0 if not enough history. */
  turningAngle: number;
  /**
   * 0..1, continuous — how sharply the stroke is currently turning, per the
   * brief's "S is smooth, Z is angular" principle: NOT a shape classifier,
   * just a running measure of direction-change rate. Smoothed so a single
   * noisy sample doesn't spike it.
   */
  sharpness: number;
}

const EMPTY_DELTA = new THREE.Vector3();

/**
 * Per-pointer (one per hand, plus one for the mouse) rolling short-term
 * memory of the touch point. This is what lets a stroke's own motion —
 * not a pose, not a letter — drive the deformation: curvature and turning
 * rate come from here.
 */
export class StrokeTracker {
  private samples: StrokeSample[] = [];
  private lastDirection: THREE.Vector3 | null = null;
  private sharpnessEma = 0;
  private scratchDelta = new THREE.Vector3();
  private scratchDir = new THREE.Vector3();

  addSample(worldPoint: THREE.Vector3, normal: THREE.Vector3, nowMs: number): StrokeFeatures {
    const cfg = INTERACTION_CONFIG;
    const last = this.samples[this.samples.length - 1];
    const hasContinuity = !!last && nowMs - last.atMs <= cfg.sculpt.strokeContinuityGraceMs;

    let frameDelta = EMPTY_DELTA;
    let velocity = 0;
    let turningAngle = 0;

    if (hasContinuity && last) {
      const dt = Math.max(1e-4, (nowMs - last.atMs) / 1000);
      frameDelta = this.scratchDelta.subVectors(worldPoint, last.worldPoint);
      velocity = frameDelta.length() / dt;

      if (velocity > cfg.sculpt.minStrokeVelocity) {
        const dir = this.scratchDir.copy(frameDelta).normalize();
        if (this.lastDirection) {
          turningAngle = Math.acos(clamp(this.lastDirection.dot(dir), -1, 1));
        }
        this.lastDirection = this.lastDirection ? this.lastDirection.copy(dir) : dir.clone();
      }
    } else {
      this.lastDirection = null;
    }

    const dtSec = hasContinuity && last ? Math.max(1e-4, (nowMs - last.atMs) / 1000) : 1 / 60;
    const turningRate = turningAngle / dtSec; // rad/sec
    const targetSharpness = clamp01(turningRate / cfg.sculpt.sharpnessReferenceRate);
    this.sharpnessEma = lerp(this.sharpnessEma, targetSharpness, 0.35);

    this.samples.push({ atMs: nowMs, worldPoint: worldPoint.clone(), normal: normal.clone() });
    const cutoff = nowMs - INTERACTION_CONFIG.strokeHistory.windowMs;
    while (this.samples.length > 0 && this.samples[0].atMs < cutoff) this.samples.shift();
    while (this.samples.length > INTERACTION_CONFIG.strokeHistory.maxSamples) this.samples.shift();

    return {
      hasContinuity,
      frameDelta: hasContinuity ? frameDelta.clone() : new THREE.Vector3(),
      velocity,
      turningAngle,
      sharpness: this.sharpnessEma,
    };
  }

  reset(): void {
    this.samples = [];
    this.lastDirection = null;
    this.sharpnessEma = 0;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
