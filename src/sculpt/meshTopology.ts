import * as THREE from 'three';

/**
 * A real, editable 3D mesh — replaces the old profile/Lathe and the even more
 * limited global-roundness model. `THREE.BoxGeometry` is NOT sculpt-ready out
 * of the box: it emits 6 independent face grids that don't share vertices at
 * the edges/corners, so dragging a vertex near an edge would tear the mesh
 * open. `weldBoxGeometry` merges coincident vertices into a single indexed,
 * watertight buffer so a local brush stroke that crosses an edge stays
 * continuous.
 */
export interface MeshTopology {
  geometry: THREE.BufferGeometry;
  /** Vertex count after welding (fewer than the raw BoxGeometry due to merged seams). */
  vertexCount: number;
  triangleCount: number;
  /** Rest-state (pre-sculpt) vertex positions, local space. Used as the height-fraction reference — never mutated. */
  restPositions: Float32Array;
  /** Precomputed 0 (base) .. 1 (top) height fraction per vertex, from REST geometry — stable even as the mesh deforms. */
  heightFraction: Float32Array;
  halfExtent: number;
  /**
   * Quad faces, 4 vertex indices each (a,b,c,d loop order), one per grid cell
   * of the box. `THREE.BoxGeometry` always emits exactly two triangles per
   * grid cell — (a,b,d) then (b,c,d) — in a fixed, uninterrupted sequence
   * across all six sides (see `buildPlane` in three's BoxGeometry source),
   * and welding preserves triangle order while only remapping indices. So
   * triangle pair [6q..6q+5] of the FINAL geometry's index buffer is always
   * exactly quad q — no separate grid-position math needed to recover it.
   * This is what lets EditableMesh have real faces (for FACE/EDGE selection)
   * instead of only raw triangles.
   */
  quads: Uint32Array[];
}

export function createSculptableBoxTopology(size: number, segments: number): MeshTopology {
  const raw = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
  const welded = weldGeometry(raw);
  raw.dispose();

  const position = welded.getAttribute('position') as THREE.BufferAttribute;
  const vertexCount = position.count;
  const halfExtent = size / 2;

  const restPositions = Float32Array.from(position.array as Float32Array);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const y = restPositions[i * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const range = Math.max(1e-6, maxY - minY);
  const heightFraction = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    heightFraction[i] = (restPositions[i * 3 + 1] - minY) / range;
  }

  welded.computeVertexNormals();
  const triangleCount = welded.index ? welded.index.count / 3 : vertexCount / 3;
  const quads = deriveQuads(welded.index!);

  return { geometry: welded, vertexCount, triangleCount, restPositions, heightFraction, halfExtent, quads };
}

/**
 * Inverse of `deriveQuads`: rebuilds a triangle index buffer from an
 * authoritative quads array, in the SAME (a,b,d),(b,c,d) per-quad order —
 * this is what keeps `EditableMesh.triangleToFace = floor(i/2)` valid after
 * topology mutation (extrude/inset/bevel/subdivide), since those ops mutate
 * `quads` and then fully regenerate the index buffer from it rather than
 * patching the index buffer directly.
 */
export function quadsToIndex(quads: readonly Uint32Array[]): Uint32Array {
  const index = new Uint32Array(quads.length * 6);
  quads.forEach((quad, q) => {
    const [a, b, c, d] = quad;
    const o = q * 6;
    index[o] = a;
    index[o + 1] = b;
    index[o + 2] = d;
    index[o + 3] = b;
    index[o + 4] = c;
    index[o + 5] = d;
  });
  return index;
}

function deriveQuads(index: THREE.BufferAttribute): Uint32Array[] {
  const quadCount = Math.floor(index.count / 6);
  const quads: Uint32Array[] = new Array(quadCount);
  for (let q = 0; q < quadCount; q++) {
    const o = q * 6;
    // tri0 = (a,b,d), tri1 = (b,c,d) -> loop order a,b,c,d
    const a = index.getX(o);
    const b = index.getX(o + 1);
    const d = index.getX(o + 2);
    const c = index.getX(o + 4);
    quads[q] = Uint32Array.of(a, b, c, d);
  }
  return quads;
}

/**
 * Merges vertices that occupy (near-)identical positions into single, shared
 * vertices, remapping the index buffer accordingly. Standard "weld" pass —
 * kept as a small local implementation rather than pulling in
 * three/examples/jsm/utils/BufferGeometryUtils, whose deep-import path isn't
 * guaranteed stable across three.js versions/bundlers.
 */
function weldGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = source.getAttribute('position') as THREE.BufferAttribute;
  const srcArray = position.array as Float32Array;
  const srcCount = position.count;

  const precision = 1e4; // ~4 decimal places — enough to merge exact seam duplicates without merging distinct nearby verts
  const keyToIndex = new Map<string, number>();
  const remap = new Int32Array(srcCount);
  const weldedPositions: number[] = [];

  for (let i = 0; i < srcCount; i++) {
    const x = srcArray[i * 3];
    const y = srcArray[i * 3 + 1];
    const z = srcArray[i * 3 + 2];
    const key = `${Math.round(x * precision)}_${Math.round(y * precision)}_${Math.round(z * precision)}`;

    let welded = keyToIndex.get(key);
    if (welded === undefined) {
      welded = weldedPositions.length / 3;
      keyToIndex.set(key, welded);
      weldedPositions.push(x, y, z);
    }
    remap[i] = welded;
  }

  const sourceIndex = source.index;
  const newIndex: number[] = [];
  if (sourceIndex) {
    for (let i = 0; i < sourceIndex.count; i++) newIndex.push(remap[sourceIndex.getX(i)]);
  } else {
    for (let i = 0; i < srcCount; i++) newIndex.push(remap[i]);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(weldedPositions, 3));
  result.setIndex(newIndex);
  return result;
}
