import * as THREE from 'three';
import { StrokeTracker } from '../interaction/strokeTracker';
import { computeBrushInfluence, type BrushInfluence } from './sculptBrush';
import type { MeshDeformer } from './meshDeformer';
import type { CommandHistory } from '../modeling/commandHistory';
import { MeshEditCommand } from '../modeling/commands';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export type SculptOperator = 'GRAB' | 'INFLATE_DEFLATE' | 'CREASE' | 'SMOOTH';

export interface BrushSettings {
  radius: number;
  strength: number;
  /** 0 (soft, broad, gentle) .. 1 (hard, concentrated, abrupt) — replaces exposing a raw falloff exponent. */
  hardness: number;
  operator: SculptOperator;
}

export interface StrokeUpdateResult {
  displaced: boolean;
  effectiveRadius: number;
  activeVertexCount: number;
  velocity: number;
  turningAngle: number;
  sharpness: number;
}

const IDLE_RESULT: StrokeUpdateResult = {
  displaced: false,
  effectiveRadius: 0,
  activeVertexCount: 0,
  velocity: 0,
  turningAngle: 0,
  sharpness: 0,
};

const scratchTangential = new THREE.Vector3();
const scratchDepth = new THREE.Vector3();
const scratchStamp = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchGripToCenter = new THREE.Vector3();
const scratchGripTangential = new THREE.Vector3();
const scratchGripDir = new THREE.Vector3();
const ORIGIN = new THREE.Vector3(0, 0, 0);

/**
 * One instance per pointer (left hand, right hand, mouse). Called ONLY while
 * the InteractionStateMachine has this pointer locked into SCULPTING —
 * engagement/release are the caller's job now (beginStroke/endStroke), this
 * class just turns "where am I touching, and how is that moving" into a
 * displacement, applied every frame as it happens.
 *
 * Four operators (mutually exclusive per stroke, per the brief's A/B/C, plus
 * Phase 4's SMOOTH):
 *  - GRAB: tangential-only drag — width, curves, dragged volumes.
 *  - INFLATE_DEFLATE: normal-only push/pull — bumps, dents, thickness.
 *  - CREASE: tangential drag PLUS a continuous convergence pull toward the
 *    touch axis — this is what makes points/ridges/creases possible instead
 *    of only ever rounding things off.
 *  - SMOOTH ("curva", Phase 4): rounds off whatever's under the brush,
 *    anywhere on the surface, live as the stroke moves — see
 *    MeshDeformer.applySmoothing.
 *
 * `updateGrip` is a separate entry point (not a fifth SculptOperator, since
 * it's gesture-selected — GestureClassifier's GRIP — not one of the panel's
 * OPERATOR buttons): "pegada grande", a wider-influence stroke that scales
 * its gripped region toward/away from the object's own center.
 */
export class StrokeDeformer {
  private tracker = new StrokeTracker();
  private influenceScratch: BrushInfluence[] = [];
  private lastInfluence: BrushInfluence[] = [];
  private lastWorldPoint: THREE.Vector3 | null = null;
  private activeEdit: MeshEditCommand | null = null;

  constructor(
    private geometry: THREE.BufferGeometry,
    private deformer: MeshDeformer,
    private history: CommandHistory
  ) {}

  /** Call exactly once when the state machine transitions this pointer into SCULPTING. */
  beginStroke(): void {
    this.tracker.reset();
    this.lastWorldPoint = null;
    this.lastInfluence = [];
    this.activeEdit = new MeshEditCommand(this.deformer, this.deformer.snapshotPositions());
  }

  /** Call exactly once when the state machine releases this pointer out of SCULPTING. */
  endStroke(): void {
    this.tracker.reset();
    this.lastWorldPoint = null;
    this.lastInfluence = [];
    if (this.activeEdit) {
      this.activeEdit.captureAfter();
      if (this.activeEdit.hasChange) this.history.push(this.activeEdit);
      this.activeEdit = null;
    }
  }

  update(hitPoint: THREE.Vector3, hitNormal: THREE.Vector3, depthDelta: number, brush: BrushSettings, nowMs: number): StrokeUpdateResult {
    const cfg = INTERACTION_CONFIG.sculpt;
    const features = this.tracker.addSample(hitPoint, hitNormal, nowMs);

    const sharpFactor = features.sharpness * cfg.sharpnessSensitivity;
    const hardnessFalloff = lerp(cfg.hardnessMinFalloff, cfg.hardnessMaxFalloff, brush.hardness);
    const hardnessRadiusMul = lerp(cfg.hardnessMinRadiusMultiplier, cfg.hardnessMaxRadiusMultiplier, brush.hardness);
    const effectiveRadius = brush.radius * hardnessRadiusMul * lerp(1, 0.45, sharpFactor);
    const effectiveStrength = brush.strength * lerp(1, 1.8, sharpFactor);
    const effectiveFalloff = hardnessFalloff;

    if (!features.hasContinuity || !this.lastWorldPoint) {
      this.lastWorldPoint = hitPoint.clone();
      this.lastInfluence = [];
      return IDLE_RESULT;
    }

    const totalTravel = features.frameDelta.length();
    const spacing = Math.max(0.01, effectiveRadius * cfg.strokeSpacingFactor);
    const steps = Math.min(cfg.maxStrokeSubsteps, Math.max(1, Math.ceil(totalTravel / spacing)));

    // Divide the frame's total movement across substeps up front — each stamp
    // gets its FAIR SHARE of the displacement, not the full frame's worth
    // applied `steps` times (which would make fast strokes over-deform).
    const perStepFrameDelta = features.frameDelta.clone().divideScalar(steps);
    const perStepDepth = depthDelta / steps;
    const tangentialAllowed = features.velocity > cfg.minStrokeVelocity;

    let anyDisplaced = false;
    let lastInfluenceThisFrame: BrushInfluence[] = [];
    const start = this.lastWorldPoint;

    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const stampPoint = scratchStamp.copy(start).lerp(hitPoint, t);

      const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
      const influence = computeBrushInfluence(position, stampPoint, effectiveRadius, effectiveFalloff, this.influenceScratch);
      lastInfluenceThisFrame = influence;

      const displaced = this.applyOperator(
        brush.operator,
        influence,
        perStepFrameDelta,
        hitNormal,
        perStepDepth,
        effectiveStrength,
        stampPoint,
        tangentialAllowed
      );
      anyDisplaced = anyDisplaced || displaced;
    }

    this.lastInfluence = lastInfluenceThisFrame;
    this.lastWorldPoint = hitPoint.clone();

    return {
      displaced: anyDisplaced,
      effectiveRadius,
      activeVertexCount: lastInfluenceThisFrame.length,
      velocity: features.velocity,
      turningAngle: features.turningAngle,
      sharpness: features.sharpness,
    };
  }

  private applyOperator(
    operator: SculptOperator,
    influence: BrushInfluence[],
    perStepFrameDelta: THREE.Vector3,
    hitNormal: THREE.Vector3,
    stepDepthDelta: number,
    strength: number,
    stampPoint: THREE.Vector3,
    tangentialAllowed: boolean
  ): boolean {
    const cfg = INTERACTION_CONFIG.sculpt;

    if (operator === 'INFLATE_DEFLATE') {
      if (Math.abs(stepDepthDelta) <= cfg.depthDeadzone) return false;
      const depth = scratchDepth.copy(hitNormal).multiplyScalar(applyGain(stepDepthDelta) * cfg.depthSensitivity * strength);
      this.deformer.applyDisplacement(influence, depth, cfg.maxVertexDisplacement);
      return true;
    }

    // GRAB and CREASE both use the tangential component of the stroke's own movement.
    let displaced = false;
    if (tangentialAllowed) {
      const normalComponent = perStepFrameDelta.dot(hitNormal);
      const tangential = scratchTangential.copy(perStepFrameDelta).addScaledVector(hitNormal, -normalComponent);
      const tangentialMag = tangential.length();
      if (tangentialMag > 1e-6) {
        const gained = applyGain(tangentialMag) * cfg.lateralSensitivity * strength;
        const dir = scratchDir.copy(tangential).normalize().multiplyScalar(gained);
        this.deformer.applyDisplacement(influence, dir, cfg.maxVertexDisplacement);
        displaced = true;
      }
    }

    if (operator === 'CREASE') {
      const dt = 1 / 60; // stamps within a frame share the frame's dt; good enough for a continuous, frame-rate-tolerant pull
      this.deformer.applyConvergence(influence, stampPoint, hitNormal, cfg.creaseStrength * dt, cfg.maxVertexDisplacement);
      displaced = true;
    }

    if (operator === 'SMOOTH') {
      const dt = 1 / 60;
      this.deformer.applySmoothing(influence, cfg.creaseStrength * dt * strength, cfg.maxVertexDisplacement);
      displaced = true;
    }

    return displaced;
  }

  /**
   * GRIP operator ("pegada grande", Phase 4) — called instead of `update()`
   * when this pointer's GestureClassifier reading is GRIP rather than
   * PINCH. Decomposes the stroke's own frame-to-frame travel (same
   * StrokeTracker every other operator uses) into a component toward/away
   * from the object's local-space origin (the box is authored centered
   * there) and a tangential remainder: the radial part grows/shrinks the
   * gripped region via `applyRadialScale`, the remainder drags it directly
   * via `applyDisplacement` — so a purely radial pull scales the region,
   * and a diagonal pull does both at once, matching what was asked for.
   */
  updateGrip(hitPoint: THREE.Vector3, hitNormal: THREE.Vector3, nowMs: number): StrokeUpdateResult {
    const cfg = INTERACTION_CONFIG;
    const features = this.tracker.addSample(hitPoint, hitNormal, nowMs);

    if (!features.hasContinuity || features.velocity <= cfg.sculpt.minStrokeVelocity) {
      this.lastInfluence = [];
      return IDLE_RESULT;
    }

    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const influence = computeBrushInfluence(position, hitPoint, cfg.grip.brushRadius, cfg.sculpt.hardnessMinFalloff, this.influenceScratch);
    this.lastInfluence = influence;
    if (influence.length === 0) return IDLE_RESULT;

    const toCenter = scratchGripToCenter.subVectors(hitPoint, ORIGIN);
    const centerDist = toCenter.length();
    let displaced = false;

    if (centerDist > 1e-6) {
      toCenter.divideScalar(centerDist); // now a unit direction, hitPoint -> away from center
      const radialComponent = features.frameDelta.dot(toCenter);
      const tangential = scratchGripTangential.copy(features.frameDelta).addScaledVector(toCenter, -radialComponent);

      if (Math.abs(radialComponent) > 1e-6) {
        const radialAmount = applyGain(radialComponent) * cfg.grip.radialSensitivity;
        this.deformer.applyRadialScale(influence, ORIGIN, radialAmount, cfg.sculpt.maxVertexDisplacement);
        displaced = true;
      }

      if (tangential.lengthSq() > 1e-12) {
        const gained = applyGain(tangential.length()) * cfg.grip.tangentialSensitivity;
        const dir = scratchGripDir.copy(tangential).normalize().multiplyScalar(gained);
        this.deformer.applyDisplacement(influence, dir, cfg.sculpt.maxVertexDisplacement);
        displaced = true;
      }
    }

    return {
      displaced,
      effectiveRadius: cfg.grip.brushRadius,
      activeVertexCount: influence.length,
      velocity: features.velocity,
      turningAngle: features.turningAngle,
      sharpness: features.sharpness,
    };
  }

  /**
   * PUSH (recorded "voltar o pinch para dentro da forma"): a closed curled
   * pinch moving toward the object pushes the vertices under it back INTO
   * the form, along the inverse surface normal, with the panel's brush
   * radius. Needs beginStroke/endStroke around it like any stroke, so the
   * whole push is one undo step.
   */
  updatePush(hitPoint: THREE.Vector3, hitNormal: THREE.Vector3, amount: number, brush: BrushSettings): StrokeUpdateResult {
    const cfg = INTERACTION_CONFIG.sculpt;
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const falloff = lerp(cfg.hardnessMinFalloff, cfg.hardnessMaxFalloff, brush.hardness);
    const influence = computeBrushInfluence(position, hitPoint, brush.radius, falloff, this.influenceScratch);
    this.lastInfluence = influence;
    if (influence.length === 0 || amount <= 0) return { ...IDLE_RESULT, effectiveRadius: brush.radius };
    const displacement = scratchDepth.copy(hitNormal).normalize().multiplyScalar(-amount * brush.strength);
    this.deformer.applyDisplacement(influence, displacement, cfg.maxVertexDisplacement);
    return { ...IDLE_RESULT, displaced: true, effectiveRadius: brush.radius, activeVertexCount: influence.length };
  }

  getLastInfluence(): BrushInfluence[] {
    return this.lastInfluence;
  }
}

/** Two-segment gain: fine control near zero, moderate (not runaway) gain past a small threshold — never naive 1:1 mapping. */
function applyGain(magnitude: number): number {
  const cfg = INTERACTION_CONFIG.sculpt;
  const sign = Math.sign(magnitude);
  const abs = Math.abs(magnitude);
  const gained =
    abs <= cfg.gainFineThreshold ? abs * cfg.gainFine : cfg.gainFineThreshold * cfg.gainFine + (abs - cfg.gainFineThreshold) * cfg.gainCoarse;
  return sign * gained;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
