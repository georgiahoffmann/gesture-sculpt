import * as THREE from 'three';
import type { BrushInfluence } from '../sculpt/sculptBrush';

const BASE = 0.1;
const HIGHLIGHT = 0.95;

/**
 * Temporarily brightens the vertex dots currently under a brush, so the
 * user can see exactly which points are about to move — monochrome
 * (brightness only, no color coding), matching the rest of the UI.
 */
export function updateVertexHighlight(pointsGeometry: THREE.BufferGeometry, influenceSets: BrushInfluence[][]): void {
  const color = pointsGeometry.getAttribute('color') as THREE.BufferAttribute;
  const array = color.array as Float32Array;
  const count = color.count;

  for (let i = 0; i < count; i++) {
    array[i * 3] = BASE;
    array[i * 3 + 1] = BASE;
    array[i * 3 + 2] = BASE;
  }

  for (const influences of influenceSets) {
    for (const { index, weight } of influences) {
      const v = BASE + weight * (HIGHLIGHT - BASE);
      if (v > array[index * 3]) {
        array[index * 3] = v;
        array[index * 3 + 1] = v;
        array[index * 3 + 2] = v;
      }
    }
  }

  color.needsUpdate = true;
}
