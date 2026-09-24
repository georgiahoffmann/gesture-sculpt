/**
 * Our own normalized hand representation, decoupled from MediaPipe's wire format.
 * The tracking layer is the only place that should ever import `@mediapipe/tasks-vision`
 * types directly — everything downstream (gestures, interaction, scene) speaks HandState.
 */
export type Handedness = 'Left' | 'Right';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface HandState {
  handedness: Handedness;
  /** Handedness classification confidence, 0..1. */
  confidence: number;
  /** All 21 landmarks, smoothed, in MediaPipe's normalized image space (x,y in 0..1, z relative to wrist). */
  landmarks: Point3D[];
  indexTip: Point3D;
  thumbTip: Point3D;
  wrist: Point3D;
  /** Stable palm center (avg of wrist + 4 MCP joints) — the primary point used for sculpting, not any single fingertip. */
  palmCenter: Point3D;
  /** Wrist-to-middle-knuckle distance — a per-hand size reference for scale-normalizing other metrics. */
  handSpan: number;
  /** Index-knuckle-to-pinky-knuckle distance — the hand-width reference pinch is normalized against. */
  handWidth: number;
  /** Raw normalized distance between thumb tip and index tip (image space — NOT scale-invariant, prefer pinchNormalized). */
  pinchDistance: number;
  /** pinchDistance / handWidth — stays meaningful whether the hand is close to or far from the webcam. This is what GestureClassifier uses. */
  pinchNormalized: number;
  /** 0..1 normalized pinch closedness, for UI/feedback only — gesture logic uses pinchNormalized + hysteresis. */
  pinchStrength: number;
  /** gripDistanceOf(landmarks) / handWidth — the GRIP signal (all non-index fingers converged toward the thumb), same normalization idea as pinchNormalized. Used by GestureClassifier to tell a full grip apart from an index+thumb pinch. */
  gripNormalized: number;
  /** Heuristic: is the index finger extended (pointing) rather than curled. */
  pointing: boolean;
  /** Wrist->middle-knuckle vector is more horizontal than vertical in image space — the WIDTH zone's trigger (Phase 4), see landmarkUtils.isHandHorizontal. */
  isHorizontal: boolean;
}
