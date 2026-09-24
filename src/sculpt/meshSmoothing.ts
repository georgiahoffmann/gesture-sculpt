import * as THREE from 'three';

/**
 * One pass of Laplacian smoothing (average each vertex toward its real
 * triangle-adjacency neighbors) — an explicit, user-triggered action (the
 * SUAVIZAR button), never applied automatically after a stroke, per the
 * brief: automatic smoothing would erase intentional points/creases.
 */
export function smoothGeometry(geometry: THREE.BufferGeometry, amount: number): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  const count = position.count;
  const index = geometry.index;
  if (!index) return;

  const neighbors: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    neighbors[a].add(b);
    neighbors[a].add(c);
    neighbors[b].add(a);
    neighbors[b].add(c);
    neighbors[c].add(a);
    neighbors[c].add(b);
  }

  const next = Float32Array.from(array);
  for (let i = 0; i < count; i++) {
    const set = neighbors[i];
    if (set.size === 0) continue;
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const n of set) {
      ax += array[n * 3];
      ay += array[n * 3 + 1];
      az += array[n * 3 + 2];
    }
    ax /= set.size;
    ay /= set.size;
    az /= set.size;

    next[i * 3] = array[i * 3] + (ax - array[i * 3]) * amount;
    next[i * 3 + 1] = array[i * 3 + 1] + (ay - array[i * 3 + 1]) * amount;
    next[i * 3 + 2] = array[i * 3 + 2] + (az - array[i * 3 + 2]) * amount;
  }

  array.set(next);
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}
