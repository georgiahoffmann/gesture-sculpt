import * as THREE from 'three';
import type { SurfaceHit } from '../scene/raycaster';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export type Zone = 'MESH' | 'HEIGHT' | 'WIDTH' | 'ROTATE';

export interface SpatialContext {
  zone: Zone;
  hit: SurfaceHit | null;
}

/**
 * ZONE FIRST, GESTURE SECOND: this is "where is the hand" — computed BEFORE
 * any pinch/engage decision, from a raycast hit, the object's projected top
 * point, and (Phase 4) the hand's own ORIENTATION. The same pinch means
 * something different depending only on which zone it happens in (see
 * InteractionStateMachine).
 *
 *   pinch hanging down, above top   -> HEIGHT (checked FIRST — see classifyZone)
 *   hand held horizontally          -> WIDTH  (see below)
 *   near the object's top           -> HEIGHT
 *   raycast hits the mesh           -> MESH   (sculpt)
 *   anywhere else (off the piece)   -> ROTATE (the brief's explicit fallback —
 *                                      any pinch outside the silhouette rotates;
 *                                      no further "is this really intentional"
 *                                      filtering beyond the pinch hysteresis itself)
 *
 * HEIGHT is checked BEFORE the mesh hit, not after: `topZoneNdc` is the
 * screen projection of `(0, box.max.y, 0)` — the center of the object's own
 * top FACE, i.e. a point ON the mesh. Reaching for "the top of the object"
 * therefore reliably raycasts onto the mesh itself; checking `hit` first
 * (as an earlier version of this function did) made HEIGHT effectively
 * unreachable, since any cursor close enough to the top point to be inside
 * `topZoneRadius` was already hitting the mesh and returning MESH first —
 * confirmed against recorded gesture sessions that attempted a height
 * gesture and got zero HEIGHT_EDIT episodes. The cost is a `topZoneRadius`
 * ring right at the top of the object where sculpting is no longer
 * reachable (HEIGHT wins there instead) — an intentional trade already
 * implied by the radius existing at all.
 *
 * WIDTH (Phase 4) resizes the object's X/Z footprint instead of its height,
 * and is deliberately disambiguated by ORIENTATION rather than position —
 * unlike HEIGHT's top point, there's no position "near the side" that
 * isn't already deep inside normal MESH-zone territory (touching the side
 * to sculpt or grip), so a position-based zone would constantly fight
 * those. Checked before everything else: whenever the hand is held
 * horizontally, it's WIDTH regardless of where it is, mouse pointer
 * (`isHandHorizontal` always false — no fingers to orient) excluded.
 */
export function classifyZone(
  cursorNdc: THREE.Vector2,
  hit: SurfaceHit | null,
  topZoneNdc: THREE.Vector2 | null,
  isHandHorizontal: boolean,
  isPointingDown: boolean
): SpatialContext {
  // "Pull a thread from above" (recorded HEIGHT gesture): fingers hanging down, hand at or
  // above the object's top. Checked BEFORE orientation — that pose bends the wrist so the
  // hand also reads as horizontal, which used to send it to WIDTH and resize the footprint.
  if (isPointingDown && topZoneNdc && cursorNdc.y > topZoneNdc.y - INTERACTION_CONFIG.height.topZoneRadius) {
    return { zone: 'HEIGHT', hit: null };
  }
  if (isHandHorizontal) return { zone: 'WIDTH', hit: null };
  if (topZoneNdc && cursorNdc.distanceTo(topZoneNdc) < INTERACTION_CONFIG.height.topZoneRadius) {
    return { zone: 'HEIGHT', hit: null };
  }
  if (hit) return { zone: 'MESH', hit };
  return { zone: 'ROTATE', hit: null };
}
