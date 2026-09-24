import * as THREE from 'three';
import { quadsToIndex } from '../sculpt/meshTopology';
import type { BrushInfluence } from '../sculpt/sculptBrush';

export type SelectionElement = 'VERTEX' | 'EDGE' | 'FACE';

interface EMEdge {
  v0: number;
  v1: number;
  faces: number[];
}

/**
 * Topology layer (adjacency: vertex/edge/face relationships) over the SAME
 * position buffer every other module already reads/writes — this is not a
 * parallel mesh with its own copy of positions. Blender's BMesh is the
 * inspiration (see docs/BLENDER_MAPPING.md) but this is the minimum needed
 * for selection + picking + moving a vertex/edge/face; it does not attempt
 * BMesh's full loop/radial-cycle generality. Faces start as quads (4 verts)
 * derived once from the box's quad grid (see `meshTopology.ts`); adjacency
 * (edges, vertex->faces, vertex->edges) is built from `quads` and rebuilt
 * from scratch (`applyTopologyResult`) whenever a Phase 3 operator
 * (extrude/inset/bevel/subdivide) grows the mesh — `quads` is the only
 * source of truth for topology, so a rebuild is always correct even after
 * vertices/faces were appended or an existing face's corners were
 * reassigned.
 */
export class EditableMesh {
  private edgeList: EMEdge[] = [];
  private edgeKeyToIndex = new Map<string, number>();
  private vertexToFaces: number[][] = [];
  private vertexToEdges: number[][] = [];
  private faceToEdges: [number, number, number, number][] = [];

  constructor(
    private position: THREE.BufferAttribute,
    private quads: Uint32Array[]
  ) {
    this.initAdjacency();
  }

  get vertexCount(): number {
    return this.position.count;
  }

  /**
   * Commits a topology mutation (extrude/inset/bevel/subdivide, or an
   * undo/redo restoring a prior topology snapshot): swaps in a freshly sized
   * position buffer and regenerates the geometry's triangle index from
   * `quads` (the only source of truth for topology — never patched in
   * place), then rebuilds adjacency from scratch. This is the one place a
   * vertex/face count change actually lands.
   */
  applyTopologyResult(geometry: THREE.BufferGeometry, positions: Float32Array, quads: Uint32Array[]): void {
    this.position = new THREE.BufferAttribute(positions, 3);
    this.quads = quads;
    geometry.setAttribute('position', this.position);
    geometry.setIndex(new THREE.Uint32BufferAttribute(quadsToIndex(quads), 1));
    this.initAdjacency();
  }

  private initAdjacency(): void {
    this.edgeList = [];
    this.edgeKeyToIndex.clear();
    this.vertexToFaces = Array.from({ length: this.vertexCount }, () => []);
    this.vertexToEdges = Array.from({ length: this.vertexCount }, () => []);
    this.faceToEdges = new Array(this.quads.length) as [number, number, number, number][];
    this.buildAdjacency();
  }

  private buildAdjacency(): void {
    this.quads.forEach((quad, faceIndex) => {
      for (const v of quad) this.vertexToFaces[v].push(faceIndex);
      const edgeIndices: number[] = [];
      for (let i = 0; i < 4; i++) {
        const v0 = quad[i];
        const v1 = quad[(i + 1) % 4];
        edgeIndices.push(this.getOrCreateEdge(v0, v1, faceIndex));
      }
      this.faceToEdges[faceIndex] = edgeIndices as [number, number, number, number];
    });
  }

  private getOrCreateEdge(v0: number, v1: number, faceIndex: number): number {
    const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
    let index = this.edgeKeyToIndex.get(key);
    if (index === undefined) {
      index = this.edgeList.length;
      this.edgeKeyToIndex.set(key, index);
      this.edgeList.push({ v0, v1, faces: [] });
      this.vertexToEdges[v0].push(index);
      this.vertexToEdges[v1].push(index);
    }
    this.edgeList[index].faces.push(faceIndex);
    return index;
  }

  get faceCount(): number {
    return this.quads.length;
  }

  get edgeCount(): number {
    return this.edgeList.length;
  }

  /** Triangle index (from a raycast hit, 3 indices per triangle) -> its parent quad face. See meshTopology.ts's `quads` doc for why this is a plain division. */
  triangleToFace(triangleIndex: number): number {
    return Math.floor(triangleIndex / 2);
  }

  getFaceVertices(faceIndex: number): Uint32Array {
    return this.quads[faceIndex];
  }

  /** Deep-cloned quads array — for a TopologyEditCommand's before/after undo snapshot, which must survive later mutation of the live `quads`. */
  getQuadsSnapshot(): Uint32Array[] {
    return this.quads.map((q) => Uint32Array.from(q));
  }

  getEdgeVertices(edgeIndex: number): [number, number] {
    const e = this.edgeList[edgeIndex];
    return [e.v0, e.v1];
  }

  getFaceEdges(faceIndex: number): readonly number[] {
    return this.faceToEdges[faceIndex];
  }

  /** Faces adjacent to an edge — normally 2 on this app's always-watertight base mesh, occasionally 1 for an edge bordering a not-yet-manifold seam (e.g. next to a single-face SUBDIVIDE). Used by BEVEL. */
  getEdgeFaces(edgeIndex: number): readonly number[] {
    return this.edgeList[edgeIndex].faces;
  }

  getVertexPosition(index: number, target: THREE.Vector3): THREE.Vector3 {
    return target.set(this.position.getX(index), this.position.getY(index), this.position.getZ(index));
  }

  getFaceCenter(faceIndex: number, target: THREE.Vector3): THREE.Vector3 {
    target.set(0, 0, 0);
    const scratch = new THREE.Vector3();
    for (const v of this.quads[faceIndex]) target.add(this.getVertexPosition(v, scratch));
    return target.divideScalar(4);
  }

  getEdgeMidpoint(edgeIndex: number, target: THREE.Vector3): THREE.Vector3 {
    const [v0, v1] = this.getEdgeVertices(edgeIndex);
    const scratch = new THREE.Vector3();
    target.copy(this.getVertexPosition(v0, scratch));
    return target.add(this.getVertexPosition(v1, scratch)).multiplyScalar(0.5);
  }

  /** Nearest vertex to `point` among a face's 4 corners — used to resolve VERTEX-mode picking from a raycast hit (which only gives a triangle/face). */
  nearestVertexOfFace(faceIndex: number, point: THREE.Vector3): number {
    let best = -1;
    let bestDist = Infinity;
    const scratch = new THREE.Vector3();
    for (const v of this.quads[faceIndex]) {
      const d = this.getVertexPosition(v, scratch).distanceToSquared(point);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  }

  /** Nearest edge to `point` among a face's 4 edges — used to resolve EDGE-mode picking from a raycast hit. */
  nearestEdgeOfFace(faceIndex: number, point: THREE.Vector3): number {
    let best = -1;
    let bestDist = Infinity;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const closest = new THREE.Vector3();
    for (const edgeIndex of this.faceToEdges[faceIndex]) {
      const [v0, v1] = this.getEdgeVertices(edgeIndex);
      this.getVertexPosition(v0, a);
      this.getVertexPosition(v1, b);
      closestPointOnSegment(point, a, b, closest);
      const d = closest.distanceToSquared(point);
      if (d < bestDist) {
        bestDist = d;
        best = edgeIndex;
      }
    }
    return best;
  }

  /**
   * Nearest edge to `point` within `radius`, scanning EVERY edge in the mesh
   * — not just the 4 belonging to whichever face the raycast happened to
   * land on, like `nearestEdgeOfFace`. This is what makes EDGE picking (and
   * so BEVEL, Phase 4's "arredondar bordas") reachable from a slightly-off
   * cursor near a face boundary instead of only from directly on the
   * intended face. Returns null if nothing is within radius — callers
   * should fall back to `nearestEdgeOfFace` for the old always-resolves
   * behavior.
   */
  nearestEdgeNear(point: THREE.Vector3, radius: number): number | null {
    let best: number | null = null;
    let bestDist = radius * radius;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const closest = new THREE.Vector3();
    for (let edgeIndex = 0; edgeIndex < this.edgeList.length; edgeIndex++) {
      const [v0, v1] = this.getEdgeVertices(edgeIndex);
      this.getVertexPosition(v0, a);
      this.getVertexPosition(v1, b);
      closestPointOnSegment(point, a, b, closest);
      const d = closest.distanceToSquared(point);
      if (d < bestDist) {
        bestDist = d;
        best = edgeIndex;
      }
    }
    return best;
  }

  /** Vertex indices that a move/select operation on this element should act on. */
  verticesFor(element: SelectionElement, index: number): number[] {
    switch (element) {
      case 'VERTEX':
        return [index];
      case 'EDGE':
        return [...this.getEdgeVertices(index)];
      case 'FACE':
        return Array.from(this.getFaceVertices(index));
    }
  }

  /** Adds `delta` (local space) to each listed vertex's position, in place. Caller still owns recomputing normals/bounding sphere (once per frame, not once per call — see MeshDeformer.finalizeFrame). */
  moveVertices(indices: readonly number[], delta: THREE.Vector3): void {
    for (const i of indices) {
      this.position.setXYZ(i, this.position.getX(i) + delta.x, this.position.getY(i) + delta.y, this.position.getZ(i) + delta.z);
    }
    this.position.needsUpdate = true;
  }

  /** Absolute set (not additive) — INSET/BEVEL re-derive their new ring/strip position from a fixed anchor every drag frame instead of accumulating deltas, to avoid drift. */
  setVertexPosition(index: number, position: THREE.Vector3): void {
    this.position.setXYZ(index, position.x, position.y, position.z);
    this.position.needsUpdate = true;
  }

  /** Proportional-editing counterpart to `moveVertices`: each vertex gets `delta * weight` instead of the full delta — same shape as MeshDeformer.applyDisplacement, for EDIT-mode MOVE with a nonzero falloff radius. */
  moveVerticesWeighted(influence: readonly BrushInfluence[], delta: THREE.Vector3): void {
    for (const { index, weight } of influence) {
      this.position.setXYZ(
        index,
        this.position.getX(index) + delta.x * weight,
        this.position.getY(index) + delta.y * weight,
        this.position.getZ(index) + delta.z * weight
      );
    }
    this.position.needsUpdate = true;
  }
}

const segScratch = new THREE.Vector3();
function closestPointOnSegment(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  segScratch.subVectors(b, a);
  const len2 = segScratch.lengthSq();
  if (len2 < 1e-12) return target.copy(a);
  let t = (point.dot(segScratch) - a.dot(segScratch)) / len2;
  t = Math.max(0, Math.min(1, t));
  return target.copy(a).addScaledVector(segScratch, t);
}
