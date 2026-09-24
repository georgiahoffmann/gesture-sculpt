/**
 * Pure mesh-surgery functions for Phase 3's topology-changing EDIT operators
 * (extrude/inset/subdivide/bevel) — see docs/BLENDER_MAPPING.md. No THREE
 * scene, EditableMesh, or undo concerns here on purpose: each function takes
 * a `(positions, quads, heightFraction)` snapshot plus a target, and returns
 * a GROWN snapshot of the same three arrays. The caller (EditManipulator) is
 * responsible for committing the result via `EditableMesh.applyTopologyResult`
 * and pushing a `TopologyEditCommand`.
 *
 * `quads` is always the authoritative topology — vertices/faces are only
 * ever appended, and an existing face's quad entry may be reassigned to new
 * vertices (extrude/inset "move" a face to a new ring while leaving its old
 * ring in place as a wall), but no face is ever deleted, so nothing needs
 * index compaction.
 *
 * `heightFraction` (see meshTopology.ts) must grow 1:1 with new vertices —
 * skipping this would leave HEIGHT_EDIT reading past the array's end (NaN)
 * the next time it runs. Every new vertex here inherits its
 * source/neighboring vertex's fraction, which keeps a subsequent height
 * stretch behave sensibly.
 */

function appendVertex(positions: number[], xyz: readonly [number, number, number]): number {
  const index = positions.length / 3;
  positions.push(xyz[0], xyz[1], xyz[2]);
  return index;
}

function quadNormal(positions: readonly number[], quad: Uint32Array): [number, number, number] {
  const [q0, q1, , q3] = quad;
  const abx = positions[q1 * 3] - positions[q0 * 3];
  const aby = positions[q1 * 3 + 1] - positions[q0 * 3 + 1];
  const abz = positions[q1 * 3 + 2] - positions[q0 * 3 + 2];
  const adx = positions[q3 * 3] - positions[q0 * 3];
  const ady = positions[q3 * 3 + 1] - positions[q0 * 3 + 1];
  const adz = positions[q3 * 3 + 2] - positions[q0 * 3 + 2];
  return [aby * adz - abz * ady, abz * adx - abx * adz, abx * ady - aby * adx];
}

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lerp3(positions: readonly number[], from: number, to: number, t: number): [number, number, number] {
  return [
    positions[from * 3] + (positions[to * 3] - positions[from * 3]) * t,
    positions[from * 3 + 1] + (positions[to * 3 + 1] - positions[from * 3 + 1]) * t,
    positions[from * 3 + 2] + (positions[to * 3 + 2] - positions[from * 3 + 2]) * t,
  ];
}

/**
 * Shared shape of EXTRUDE and INSET: both duplicate a face's ring into a new
 * ring (at the same spot for extrude, pulled toward the centroid for inset),
 * reassign the face to the new ring, and stitch 4 side quads connecting the
 * new ring back to the untouched old ring — which is what keeps the mesh
 * watertight (every edge still touches exactly 2 faces) instead of opening a
 * hole, so later bevels never need to special-case a boundary edge.
 */
function ringToRing(
  positions: Float32Array,
  quads: readonly Uint32Array[],
  heightFraction: Float32Array,
  faceIndex: number,
  computeNewPosition: (vx: number, vy: number, vz: number, cx: number, cy: number, cz: number) => [number, number, number]
): { positions: Float32Array; quads: Uint32Array[]; heightFraction: Float32Array; faceIndex: number; newVerts: [number, number, number, number] } {
  const pos = Array.from(positions);
  const hf = Array.from(heightFraction);
  const newQuads = quads.map((q) => Uint32Array.from(q));
  const face = newQuads[faceIndex];

  let cx = 0, cy = 0, cz = 0;
  for (const v of face) {
    cx += pos[v * 3];
    cy += pos[v * 3 + 1];
    cz += pos[v * 3 + 2];
  }
  cx /= 4;
  cy /= 4;
  cz /= 4;

  const newVerts: number[] = [];
  for (const v of face) {
    const xyz = computeNewPosition(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], cx, cy, cz);
    newVerts.push(appendVertex(pos, xyz));
    hf.push(heightFraction[v]);
  }

  for (let i = 0; i < 4; i++) {
    const a = face[i];
    const b = face[(i + 1) % 4];
    newQuads.push(Uint32Array.of(a, b, newVerts[(i + 1) % 4], newVerts[i]));
  }
  newQuads[faceIndex] = Uint32Array.from(newVerts);

  return {
    positions: Float32Array.from(pos),
    quads: newQuads,
    heightFraction: Float32Array.from(hf),
    faceIndex,
    newVerts: newVerts as [number, number, number, number],
  };
}

export interface ExtrudeResult {
  positions: Float32Array;
  quads: Uint32Array[];
  heightFraction: Float32Array;
  faceIndex: number;
  /** The 4 relocated vertices — what the follow-up normal drag should move. */
  activeVerts: [number, number, number, number];
}

/** Duplicates the face's ring in place (offset 0) — the follow-up drag (EditManipulator) pushes `activeVerts` along the captured hit normal. */
export function extrudeFace(positions: Float32Array, quads: readonly Uint32Array[], heightFraction: Float32Array, faceIndex: number): ExtrudeResult {
  const r = ringToRing(positions, quads, heightFraction, faceIndex, (x, y, z) => [x, y, z]);
  return { positions: r.positions, quads: r.quads, heightFraction: r.heightFraction, faceIndex: r.faceIndex, activeVerts: r.newVerts };
}

export interface InsetResult {
  positions: Float32Array;
  quads: Uint32Array[];
  heightFraction: Float32Array;
  faceIndex: number;
  /** New inner-ring vertices (the new selection), loop-order-matched with `outerVerts`. */
  innerVerts: [number, number, number, number];
  /** Original (untouched) outer-ring vertices — the drag's fixed anchor; the inner ring is re-lerped toward their live centroid each frame. */
  outerVerts: [number, number, number, number];
}

export function insetFace(positions: Float32Array, quads: readonly Uint32Array[], heightFraction: Float32Array, faceIndex: number, fraction: number): InsetResult {
  const outerVerts = Array.from(quads[faceIndex]) as [number, number, number, number];
  const r = ringToRing(positions, quads, heightFraction, faceIndex, (x, y, z, cx, cy, cz) => [
    x + (cx - x) * fraction,
    y + (cy - y) * fraction,
    z + (cz - z) * fraction,
  ]);
  return { positions: r.positions, quads: r.quads, heightFraction: r.heightFraction, faceIndex: r.faceIndex, innerVerts: r.newVerts, outerVerts };
}

export interface SubdivideResult {
  positions: Float32Array;
  quads: Uint32Array[];
  heightFraction: Float32Array;
  faceIndex: number;
}

/**
 * Splits the selected face into 4 sub-quads via a new center vertex + 4
 * edge-midpoint vertices — standard quad subdivision. Deliberately does NOT
 * touch neighboring faces, which still reference the original (now
 * half-unused) edge; this can show as a visible seam against an
 * unsubdivided neighbor, matching Blender's own behavior when subdividing a
 * partial face selection rather than the whole mesh. One-shot: no
 * drag-to-adjust phase.
 */
export function subdivideFace(positions: Float32Array, quads: readonly Uint32Array[], heightFraction: Float32Array, faceIndex: number): SubdivideResult {
  const pos = Array.from(positions);
  const hf = Array.from(heightFraction);
  const newQuads = quads.map((q) => Uint32Array.from(q));
  const [a, b, c, d] = newQuads[faceIndex];

  const midpoint = (i: number, j: number): number => {
    const idx = appendVertex(pos, [(pos[i * 3] + pos[j * 3]) / 2, (pos[i * 3 + 1] + pos[j * 3 + 1]) / 2, (pos[i * 3 + 2] + pos[j * 3 + 2]) / 2]);
    hf.push((heightFraction[i] + heightFraction[j]) / 2);
    return idx;
  };

  const mAB = midpoint(a, b);
  const mBC = midpoint(b, c);
  const mCD = midpoint(c, d);
  const mDA = midpoint(d, a);
  const center = appendVertex(
    pos,
    [(pos[a * 3] + pos[b * 3] + pos[c * 3] + pos[d * 3]) / 4, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2] + pos[d * 3 + 2]) / 4]
  );
  hf.push((heightFraction[a] + heightFraction[b] + heightFraction[c] + heightFraction[d]) / 4);

  newQuads[faceIndex] = Uint32Array.of(a, mAB, center, mDA);
  newQuads.push(Uint32Array.of(mAB, b, mBC, center), Uint32Array.of(center, mBC, c, mCD), Uint32Array.of(mDA, center, mCD, d));

  return { positions: Float32Array.from(pos), quads: newQuads, heightFraction: Float32Array.from(hf), faceIndex };
}

export interface BevelResult {
  positions: Float32Array;
  quads: Uint32Array[];
  heightFraction: Float32Array;
  /** New face bridging the two trimmed neighbors (the new selection) — or one of the trimmed faces themselves if the edge only had one neighbor. */
  resultFaceIndex: number;
  /** Each new offset vertex, plus the two existing vertices its live position is re-lerped between each drag frame (`from` = the original edge endpoint, `to` = that face's opposite corner). */
  pairs: Array<{ active: number; from: number; to: number }>;
}

/**
 * Replaces the selected edge with a trimmed strip: for each of its (normally
 * 2) adjacent faces, offsets that face's copy of the edge's two endpoints
 * toward the face's own opposite corners by `fraction`, then bridges the two
 * faces' new parallel edges with a new quad. Degrades to trimming a single
 * face (no bridge) if the edge only has one adjacent face — defensive, not
 * expected on this app's always-watertight base mesh, but avoids assuming
 * exactly 2 neighbors.
 */
export function bevelEdge(
  positions: Float32Array,
  quads: readonly Uint32Array[],
  heightFraction: Float32Array,
  edgeVertices: readonly [number, number],
  edgeFaces: readonly number[],
  fraction: number
): BevelResult {
  const pos = Array.from(positions);
  const hf = Array.from(heightFraction);
  const newQuads = quads.map((q) => Uint32Array.from(q));
  const [v0, v1] = edgeVertices;

  const perFace: Array<{ newForV0: number; newForV1: number }> = [];
  const pairs: Array<{ active: number; from: number; to: number }> = [];
  let refNormal: [number, number, number] = [0, 0, 0];

  for (const faceIndex of edgeFaces) {
    const quad = newQuads[faceIndex];
    const n = quadNormal(pos, quad);
    refNormal = [refNormal[0] + n[0], refNormal[1] + n[1], refNormal[2] + n[2]];
    let i = -1;
    for (let k = 0; k < 4; k++) {
      const a = quad[k];
      const b = quad[(k + 1) % 4];
      if ((a === v0 && b === v1) || (a === v1 && b === v0)) {
        i = k;
        break;
      }
    }
    if (i === -1) continue;

    const ea = quad[i];
    const eb = quad[(i + 1) % 4];
    const oppEa = quad[(i + 3) % 4];
    const oppEb = quad[(i + 2) % 4];

    const newEa = appendVertex(pos, lerp3(pos, ea, oppEa, fraction));
    hf.push(heightFraction[ea]);
    pairs.push({ active: newEa, from: ea, to: oppEa });

    const newEb = appendVertex(pos, lerp3(pos, eb, oppEb, fraction));
    hf.push(heightFraction[eb]);
    pairs.push({ active: newEb, from: eb, to: oppEb });

    newQuads[faceIndex] = Uint32Array.from(quad, (v) => (v === ea ? newEa : v === eb ? newEb : v));
    perFace.push({ newForV0: ea === v0 ? newEa : newEb, newForV1: ea === v1 ? newEa : newEb });
  }

  let resultFaceIndex: number;
  if (perFace.length === 2) {
    const [A, B] = perFace;
    // Winding of the two source faces at this edge doesn't reliably predict which loop order
    // keeps the bridge outward-facing (verified empirically, not just derived) — so pick a
    // candidate, then flip it if its normal disagrees with the two adjacent faces' own (known-
    // good) normals rather than trusting a combinatorial rule.
    const candidate = Uint32Array.of(A.newForV0, A.newForV1, B.newForV1, B.newForV0);
    const candidateNormal = quadNormal(pos, candidate);
    const bridge = dot3(candidateNormal, refNormal) >= 0 ? candidate : Uint32Array.of(A.newForV0, B.newForV0, B.newForV1, A.newForV1);
    newQuads.push(bridge);
    resultFaceIndex = newQuads.length - 1;
  } else {
    resultFaceIndex = edgeFaces[0] ?? 0;
  }

  return { positions: Float32Array.from(pos), quads: newQuads, heightFraction: Float32Array.from(hf), resultFaceIndex, pairs };
}
