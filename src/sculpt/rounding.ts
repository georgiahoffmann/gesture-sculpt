/**
 * Rounded-box projection: writes into `out` the vertices of `source`
 * (flat xyz array, object-local) rounded with the given radius around the
 * source's own bounding box. Used by both rounding gestures:
 *
 *  - ROUND CORNERS: radius a fraction of the smallest half-extent — edges
 *    and corners become fillets, flat faces stay flat.
 *  - two-hand ROUND: radius up to the full smallest half-extent — a cube
 *    becomes a sphere, a tall block a capsule.
 *
 * Standard rounded-box math: q = p clamped to the box shrunk by `radius`;
 * vertices where p - q has two or more non-zero axes (the edge/corner
 * regions) are moved to q + r·normalize(p - q). Vertices in the face
 * regions (at most one axis outside the shrunk box) are left exactly where
 * they are, so sculpted detail on the faces survives the rounding.
 */
export function roundedBoxPositions(source: Float32Array, out: Float32Array, radius: number): void {
  const count = source.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = source[i * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  const center = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
  const inner = [0, 1, 2].map((a) => Math.max(0, (max[a] - min[a]) / 2 - radius));

  const d = [0, 0, 0];
  const q = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    let outside = 0;
    let len2 = 0;
    for (let a = 0; a < 3; a++) {
      const p = source[i * 3 + a] - center[a];
      q[a] = Math.max(-inner[a], Math.min(inner[a], p));
      d[a] = p - q[a];
      if (Math.abs(d[a]) > 1e-6) outside++;
      len2 += d[a] * d[a];
    }
    if (outside < 2 || len2 < 1e-12) {
      out[i * 3] = source[i * 3];
      out[i * 3 + 1] = source[i * 3 + 1];
      out[i * 3 + 2] = source[i * 3 + 2];
      continue;
    }
    const s = radius / Math.sqrt(len2);
    for (let a = 0; a < 3; a++) out[i * 3 + a] = center[a] + q[a] + d[a] * s;
  }
}

/** Smallest half-extent of the source's bounding box — the radius at which rounding becomes fully round. */
export function smallestHalfExtent(source: Float32Array): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < source.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = source[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return Math.min(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
}
