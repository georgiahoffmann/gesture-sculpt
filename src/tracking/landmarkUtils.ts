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

export type HandPose = 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'DOWN' | 'SIDE' | 'CURLED' | 'TRIPOD';

export interface PoseThresholds {
  extendRatio: number;
  togetherRatio: number;
  minThumbGapRatio: number;
  bladeThumbGapRatio: number;
  sideThumbGapRatio: number;
  sideMaxElevationDeg: number;
  orientationDominance: number;
  curledIndexMin: number;
  curledOthersMax: number;
  tripodMiddleMin: number;
}

/** wrist->tip / wrist->PIP per finger (index, middle, ring, pinky): >1 extended, <1 curled. Rotation-invariant (3D). */
export function fingerExtensions(landmarks: Point3D[]): [number, number, number, number] {
  const wrist = landmarks[LM.WRIST];
  const ratio = (tip: number, pip: number) => distance3D(wrist, landmarks[tip]) / Math.max(1e-6, distance3D(wrist, landmarks[pip]));
  return [ratio(LM.INDEX_TIP, LM.INDEX_PIP), ratio(LM.MIDDLE_TIP, LM.MIDDLE_PIP), ratio(LM.RING_TIP, LM.RING_PIP), ratio(LM.PINKY_TIP, LM.PINKY_PIP)];
}

/** Index-to-pinky knuckle width in 3D — the normalizer for every pose ratio (survives the palm turning edge-on). */
export function knuckleWidth3D(landmarks: Point3D[]): number {
  return Math.max(1e-4, distance3D(landmarks[LM.INDEX_MCP], landmarks[LM.PINKY_MCP]));
}

/** Thumb-tip-to-index-tip distance / knuckle width (3D): ~0.1-0.4 pinched, ~2-2.6 in a wide "L". */
export function thumbIndexGapOf(landmarks: Point3D[]): number {
  return distance3D(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) / knuckleWidth3D(landmarks);
}

/** Thumb tip to the midpoint of index + middle tips / knuckle width — the TRIPOD (zoom out) pinch's open/close signal. */
export function tripodGapOf(landmarks: Point3D[]): number {
  const kw = knuckleWidth3D(landmarks);
  return (distance3D(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) + distance3D(landmarks[LM.THUMB_TIP], landmarks[LM.MIDDLE_TIP])) / (2 * kw);
}

/** Average knuckle->tip direction of the four fingers, as an elevation angle in image space: 0 = sideways, +90° = up, -90° = down. */
export function fingerElevationOf(landmarks: Point3D[]): number {
  let dx = 0;
  let dy = 0;
  for (const [tip, mcp] of [
    [LM.INDEX_TIP, LM.INDEX_MCP],
    [LM.MIDDLE_TIP, LM.MIDDLE_MCP],
    [LM.RING_TIP, LM.RING_MCP],
    [LM.PINKY_TIP, LM.PINKY_MCP],
  ]) {
    dx += landmarks[tip].x - landmarks[mcp].x;
    dy += landmarks[tip].y - landmarks[mcp].y;
  }
  // Image y grows downward, so "up" is -dy.
  return Math.atan2(-dy, Math.abs(dx));
}

/**
 * Palm tilt around the finger axis: asin of the palm normal's vertical
 * component (normal = wrist->index knuckle x wrist->pinky knuckle). Only
 * its CHANGE is meaningful — the cross product's sign flips between left
 * and right hands, which callers correct for with the handedness.
 */
export function palmPitchOf(landmarks: Point3D[]): number {
  const w = landmarks[LM.WRIST];
  const a = landmarks[LM.INDEX_MCP];
  const b = landmarks[LM.PINKY_MCP];
  const ax = a.x - w.x, ay = a.y - w.y, az = a.z - w.z;
  const bx = b.x - w.x, by = b.y - w.y, bz = b.z - w.z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz);
  return len < 1e-9 ? 0 : Math.asin(Math.max(-1, Math.min(1, ny / len)));
}

/** All four fingers extended and held together — the "flat hand" shared by every blade pose and by the two-hand ROUND gesture. */
export function isFlatHand(landmarks: Point3D[], extendRatio: number, togetherRatio: number): boolean {
  if (fingerExtensions(landmarks).some((e) => e < extendRatio)) return false;
  return distance3D(landmarks[LM.INDEX_TIP], landmarks[LM.PINKY_TIP]) / knuckleWidth3D(landmarks) <= togetherRatio;
}

/**
 * Hand poses from the recorded reference gestures (gestures-ref/). Each one
 * engages a tool on its own, with no pinch (see InteractionStateMachine):
 *
 *   TRIPOD     thumb + index + middle, ring and pinky curled            = zoom out
 *   CURLED     index + thumb, other three fingers curled into the palm  = zoom in / push-in
 *   DOWN       flat, fingers hanging down ("beak", thumb on the tips)    = pull height
 *   SIDE       flat, fingers sideways, thumb ON the fingertips          = pull width
 *   HORIZONTAL flat, fingers sideways, thumb away (palm-down blade)     = cut / round corners / tilt view
 *   VERTICAL   flat, fingers up, thumb away                             = rotate by turning the palm
 *
 * Finger direction (knuckle->tip) decides orientation, not wrist->knuckle:
 * the "beak" poses bend the wrist so wrist->knuckle reads sideways. The
 * thumb gap splits SIDE from HORIZONTAL, with a dead band between them so a
 * thumb drifting across the boundary reads NONE instead of flipping tools.
 * Every ratio is 3D and normalized by the knuckle width.
 */
export function handPoseOf(landmarks: Point3D[], t: PoseThresholds): HandPose {
  const [index, middle, ring, pinky] = fingerExtensions(landmarks);
  // Three-finger pinch (thumb + index + middle), ring and pinky curled — the zoom-out gesture.
  if (index >= t.curledIndexMin && middle >= t.tripodMiddleMin && ring <= t.curledOthersMax && pinky <= t.curledOthersMax) return 'TRIPOD';
  if (index >= t.curledIndexMin && middle <= t.curledOthersMax && ring <= t.curledOthersMax && pinky <= t.curledOthersMax) return 'CURLED';

  if (!isFlatHand(landmarks, t.extendRatio, t.togetherRatio)) return 'NONE';

  const elevation = fingerElevationOf(landmarks);
  const dominance = Math.atan(1 / t.orientationDominance); // angle below which "sideways" dominates
  if (elevation < -(Math.PI / 2 - dominance)) return 'DOWN';

  const thumbGap = thumbIndexGapOf(landmarks);
  if (Math.abs(elevation) < dominance) {
    if (thumbGap < t.sideThumbGapRatio) return Math.abs(elevation) <= (t.sideMaxElevationDeg * Math.PI) / 180 ? 'SIDE' : 'NONE';
    if (thumbGap >= t.bladeThumbGapRatio) return 'HORIZONTAL';
    return 'NONE';
  }
  if (elevation > Math.PI / 2 - dominance && thumbGap >= t.minThumbGapRatio) return 'VERTICAL';
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
