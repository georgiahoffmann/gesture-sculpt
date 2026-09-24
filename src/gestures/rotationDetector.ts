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
