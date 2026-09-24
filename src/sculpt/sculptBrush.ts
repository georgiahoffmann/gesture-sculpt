import * as THREE from 'three';

export interface BrushInfluence {
  index: number;
  weight: number;
}

/**
 * Finds every vertex within `radius` of `center` (measured against the
 * mesh's CURRENT — possibly already-sculpted — positions, since that's the
 * surface the user is actually touching) and assigns it a smooth falloff
 * weight: 1 at the center, tapering to 0 at the edge of the brush.
 *
 * A plain linear scan over all vertices — no spatial index. At the vertex
 * counts this app uses (a few thousand), this is comfortably faster than one
 * animation frame; see the perf note in the PR description before reaching
 * for a spatial hash.
 */
export function computeBrushInfluence(
  position: THREE.BufferAttribute,
  center: THREE.Vector3,
  radius: number,
  falloffExponent: number,
  out: BrushInfluence[] = []
): BrushInfluence[] {
  out.length = 0;
  const count = position.count;
  const array = position.array as Float32Array;
  const r2 = radius * radius;

  for (let i = 0; i < count; i++) {
    const dx = array[i * 3] - center.x;
    const dy = array[i * 3 + 1] - center.y;
    const dz = array[i * 3 + 2] - center.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;

    const t = Math.sqrt(d2) / radius; // 0 at center .. 1 at edge
    const shaped = Math.pow(1 - t, falloffExponent);
    out.push({ index: i, weight: shaped });
  }

  return out;
}
