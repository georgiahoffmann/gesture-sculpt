import * as THREE from 'three';

const BASE_COLOR = new THREE.Color(0x1a1a1a);
const BASE: [number, number, number] = [BASE_COLOR.r, BASE_COLOR.g, BASE_COLOR.b];
/** The app's lime green (--accent-green, #39ff14) — the one selection color. THREE.Color converts the hex to the linear space vertex colors use. */
export const SELECTION_GREEN_COLOR = new THREE.Color(0x39ff14);
const SELECTION_GREEN: [number, number, number] = [SELECTION_GREEN_COLOR.r, SELECTION_GREEN_COLOR.g, SELECTION_GREEN_COLOR.b];

/**
 * Colors the vertex dots — and, through the shared color attribute, the
 * wireframe — by selection weight (0..1 per vertex): 0 stays
 * the base dark gray, 1 is full lime green, in between blends — so the
 * user sees exactly which points the current gesture is acting on, and how
 * strongly (brush falloff, height fraction, ...).
 */
export function updateVertexHighlight(pointsGeometry: THREE.BufferGeometry, weights: Float32Array): void {
  const color = pointsGeometry.getAttribute('color') as THREE.BufferAttribute;
  const array = color.array as Float32Array;
  const count = Math.min(color.count, weights.length);
  for (let i = 0; i < color.count; i++) {
    const w = i < count ? Math.min(1, Math.max(0, weights[i])) : 0;
    for (let c = 0; c < 3; c++) array[i * 3 + c] = BASE[c] + (SELECTION_GREEN[c] - BASE[c]) * w;
  }
  color.needsUpdate = true;
}
