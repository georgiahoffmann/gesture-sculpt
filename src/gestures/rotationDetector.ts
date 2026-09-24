import type { HandState } from '../tracking/types';
import { LM } from '../tracking/landmarkUtils';

/**
 * Wrist "roll" angle in the image plane, from the wrist to the middle-finger
 * knuckle. This approximates turning the hand like a doorknob — a single,
 * stable, intuitive axis to start rotation with (per the brief: prioritize one
 * axis that works well over several axes that fight each other).
 */
export function computeHandRoll(hand: HandState): number {
  const wrist = hand.landmarks[LM.WRIST];
  const middleMcp = hand.landmarks[LM.MIDDLE_MCP];
  return Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x);
}

function shortestAngleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Tracks rotation as a DELTA from the angle captured at the moment a grab begins. */
export class RotationDetector {
  private referenceAngle: number | null = null;

  begin(hand: HandState): void {
    this.referenceAngle = computeHandRoll(hand);
  }

  delta(hand: HandState): number {
    if (this.referenceAngle == null) return 0;
    return shortestAngleDelta(computeHandRoll(hand), this.referenceAngle);
  }

  end(): void {
    this.referenceAngle = null;
  }
}

/**
 * Palm yaw — the recorded vertical-blade ROTATE gesture: the flat hand stays
 * upright and turns around its own vertical axis (palm to camera -> edge-on
 * -> back of hand). Measured from the index->pinky knuckle vector in the
 * horizontal (x, z) plane, converted to the viewer's frame (x mirrored like
 * the webcam preview, z flipped so "toward the camera" is +Z like the
 * scene), so a positive delta turns the object the same way the palm turned
 * when seen from above.
 */
export function computePalmYaw(hand: HandState): number {
  const a = hand.landmarks[LM.INDEX_MCP];
  const b = hand.landmarks[LM.PINKY_MCP];
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

/**
 * Same begin/delta/end shape as RotationDetector, but ACCUMULATES frame-to-
 * frame deltas instead of comparing against the start angle — a full palm
 * turn goes well past 180°, where a single start-vs-now difference would
 * wrap around and snap the object backwards.
 */
export class PalmYawDetector {
  private lastAngle: number | null = null;
  private accumulated = 0;

  begin(hand: HandState): void {
    this.lastAngle = computePalmYaw(hand);
    this.accumulated = 0;
  }

  delta(hand: HandState): number {
    if (this.lastAngle == null) return 0;
    const angle = computePalmYaw(hand);
    this.accumulated += shortestAngleDelta(angle, this.lastAngle);
    this.lastAngle = angle;
    return this.accumulated;
  }

  end(): void {
    this.lastAngle = null;
    this.accumulated = 0;
  }
}
