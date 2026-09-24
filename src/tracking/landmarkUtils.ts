import type { Point3D } from './types';

/** MediaPipe Hands landmark indices (same layout in both the legacy Solutions API and Tasks Vision). */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export function distance2D(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distance3D(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function midpoint(a: Point3D, b: Point3D): Point3D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/**
 * Heuristic finger-extended test: in image space (y grows downward), an
 * extended finger's tip sits above (smaller y) its PIP joint. Cheap and good
 * enough for an upright hand; not rotation-invariant, which is an accepted
 * simplification for this milestone.
 */
export function isFingerExtended(landmarks: Point3D[], tipIndex: number, pipIndex: number): boolean {
  return landmarks[tipIndex].y < landmarks[pipIndex].y;
}

/**
 * Hand orientation from a single rigid reference vector (wrist -> middle
 * knuckle — stable regardless of finger curl, unlike a fingertip). WIDTH
 * (Phase 4) uses this to tell "hand held horizontally" apart from the
 * app's normal (upright-ish) hand pose, in IMAGE space — dx/dy dominance,
 * no calibration constant needed. Deliberately stateless/per-frame, like
 * `classifyZone` itself; if this flickers right at the 45° boundary in
 * practice, that's a real candidate for its own small hysteresis wrapper
 * (see GestureClassifier for the pattern) — not attempted here yet.
 */
export function isHandHorizontal(landmarks: Point3D[]): boolean {
  const wrist = landmarks[LM.WRIST];
  const middleMcp = landmarks[LM.MIDDLE_MCP];
  return Math.abs(middleMcp.x - wrist.x) > Math.abs(middleMcp.y - wrist.y);
}

export type BladePose = 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'DOWN';

export interface BladeThresholds {
  extendRatio: number;
  togetherRatio: number;
  minThumbGapRatio: number;
  orientationDominance: number;
}

/**
 * Flat-hand poses from the recorded reference gestures — all four non-thumb
 * fingers extended AND held together (not spread). Which way the FINGERS
 * point picks the tool:
 *
 *   HORIZONTAL (fingers sideways, palm down)  = cut
 *   VERTICAL   (fingers up)                   = rotate by turning the palm
 *   DOWN       (fingers hanging down, "beak") = pull height from above
 *
 * HORIZONTAL/VERTICAL also require the thumb away from the index tip (not a
 * pinch); DOWN does not — in the recorded height gesture the thumb touches
 * the fingertips, and that pinch distance flickers across the PINCH
 * threshold mid-pull, which is why a plain pinch was an unreliable trigger
 * for it. Finger direction (knuckle->tip), not wrist->knuckle, is what
 * matters: the "beak" bends the wrist so wrist->knuckle reads horizontal.
 * Distances are 3D and normalized by the knuckle width so the test survives
 * the palm turning edge-on to the camera mid-rotation.
 */
export function bladePoseOf(landmarks: Point3D[], t: BladeThresholds): BladePose {
  const wrist = landmarks[LM.WRIST];
  const fingers: Array<[number, number, number]> = [
    [LM.INDEX_TIP, LM.INDEX_PIP, LM.INDEX_MCP],
    [LM.MIDDLE_TIP, LM.MIDDLE_PIP, LM.MIDDLE_MCP],
    [LM.RING_TIP, LM.RING_PIP, LM.RING_MCP],
    [LM.PINKY_TIP, LM.PINKY_PIP, LM.PINKY_MCP],
  ];
  let dx = 0;
  let dy = 0;
  for (const [tip, pip, mcp] of fingers) {
    if (distance3D(wrist, landmarks[tip]) < distance3D(wrist, landmarks[pip]) * t.extendRatio) return 'NONE';
    dx += landmarks[tip].x - landmarks[mcp].x;
    dy += landmarks[tip].y - landmarks[mcp].y;
  }
  const knuckleWidth = Math.max(1e-4, distance3D(landmarks[LM.INDEX_MCP], landmarks[LM.PINKY_MCP]));
  if (distance3D(landmarks[LM.INDEX_TIP], landmarks[LM.PINKY_TIP]) / knuckleWidth > t.togetherRatio) return 'NONE';

  // Image y grows downward: fingers pointing up is a negative dy.
  if (dy > Math.abs(dx) * t.orientationDominance) return 'DOWN';

  if (distance3D(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) / knuckleWidth < t.minThumbGapRatio) return 'NONE';
  if (Math.abs(dx) > Math.abs(dy) * t.orientationDominance) return 'HORIZONTAL';
  if (-dy > Math.abs(dx) * t.orientationDominance) return 'VERTICAL';
  return 'NONE';
}

/**
 * "Pulling a thread from above" (the recorded HEIGHT gesture): index and
 * thumb tips both hang BELOW the index knuckle in image space. That pose
 * bends the wrist so the wrist->middle-knuckle vector reads as horizontal —
 * which is exactly why it used to fall into the WIDTH zone instead of
 * HEIGHT. spatialContext checks this before orientation.
 */
export function isPointingDown(landmarks: Point3D[]): boolean {
  const knuckleY = landmarks[LM.INDEX_MCP].y;
  return landmarks[LM.INDEX_TIP].y > knuckleY && landmarks[LM.THUMB_TIP].y > knuckleY;
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * A stable "center of the palm", used instead of any single fingertip as the
 * primary interaction point — averaging five joints that stay roughly rigid
 * relative to each other (unlike fingertips, which move a lot on their own).
 */
export function palmCenterOf(landmarks: Point3D[]): Point3D {
  const joints = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const j of joints) {
    x += landmarks[j].x;
    y += landmarks[j].y;
    z += landmarks[j].z;
  }
  return { x: x / joints.length, y: y / joints.length, z: z / joints.length };
}

/**
 * Wrist-to-middle-knuckle distance: a stable per-hand size reference used to
 * normalize scale-sensitive metrics (openness, hand-to-hand distance) so the
 * interaction feels consistent regardless of how close the user is standing
 * to the webcam.
 */
export function handSpanOf(landmarks: Point3D[]): number {
  return Math.max(1e-4, distance2D(landmarks[LM.WRIST], landmarks[LM.MIDDLE_MCP]));
}

/** Average distance from the palm center to the four non-thumb fingertips, in raw (un-normalized) units. */
export function averageFingertipSpread(landmarks: Point3D[], palmCenter: Point3D): number {
  const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  let sum = 0;
  for (const t of tips) sum += distance2D(landmarks[t], palmCenter);
  return sum / tips.length;
}

/**
 * Index-knuckle-to-pinky-knuckle distance: the hand-width reference pinch is
 * normalized against, so "how far apart are thumb and index" reads the same
 * whether the hand is close to or far from the webcam.
 */
export function handWidthOf(landmarks: Point3D[]): number {
  return Math.max(1e-4, distance2D(landmarks[LM.INDEX_MCP], landmarks[LM.PINKY_MCP]));
}

/**
 * Average thumb-to-{middle,ring,pinky} tip distance — deliberately excludes
 * the index finger, which is the PINCH pair. This is the GRIP signal: a full
 * 5-finger grasp brings all three of these close to the thumb at once, while
 * an index+thumb pinch alone leaves them spread apart. See
 * `gestures/gestureClassifier.ts`, which uses this (normalized by
 * `handWidthOf`, same as `pinchNormalized`) to tell the two gestures apart.
 */
export function gripDistanceOf(landmarks: Point3D[]): number {
  const thumb = landmarks[LM.THUMB_TIP];
  const tips = [LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  let sum = 0;
  for (const t of tips) sum += distance2D(thumb, landmarks[t]);
  return sum / tips.length;
}
