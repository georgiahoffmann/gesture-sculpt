import * as THREE from 'three';
import type { BrushInfluence } from './sculptBrush';

/**
 * Low-level mutator for the live (already-sculpted) vertex buffer. Every
 * write here is INCREMENTAL — added on top of whatever the mesh currently
 * is — unlike the old global roundness model, which always recomputed from a
 * pristine base. That's the correct model for a drag/paint brush: real
 * sculpting tools accumulate strokes on the live mesh; only an explicit
 * undo (CommandHistory) should ever discard a stroke.
 *
 * Callers apply as many stroke stamps as needed in a frame (one per active
 * hand/mouse pointer) and then call `finalizeFrame()` once — normals and the
 * bounding sphere are recomputed once per frame, not once per stamp.
 */
export class MeshDeformer {
  constructor(private geometry: THREE.BufferGeometry) {}

  /** Nudges each influenced vertex by `displacement * weight`, clamped per-vertex to avoid a single bad frame spiking the mesh. */
  applyDisplacement(influence: BrushInfluence[], displacement: THREE.Vector3, maxPerVertex: number): void {
    if (influence.length === 0 || (displacement.x === 0 && displacement.y === 0 && displacement.z === 0)) return;
    const position = this.position;
    const array = position.array as Float32Array;

    for (const { index, weight } of influence) {
      let dx = displacement.x * weight;
      let dy = displacement.y * weight;
      let dz = displacement.z * weight;
      const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (mag > maxPerVertex && mag > 1e-9) {
        const s = maxPerVertex / mag;
        dx *= s;
        dy *= s;
        dz *= s;
      }
      array[index * 3] += dx;
      array[index * 3 + 1] += dy;
      array[index * 3 + 2] += dz;
    }
    position.needsUpdate = true;
  }

  /**
   * CREASE operator: pulls each influenced vertex toward the line through
   * `axisPoint` along `axisDir` (the touch point and the surface normal at
   * it), proportional to its brush weight and `strength * dt`. This is what
   * lets a stroke converge material into a point/ridge instead of only ever
   * being able to push a smooth bump — the brief is explicit that inflate
   * alone tends to produce rounded surfaces, and this is the fix for that.
   */
  applyConvergence(
    influence: BrushInfluence[],
    axisPoint: THREE.Vector3,
    axisDir: THREE.Vector3,
    amount: number,
    maxPerVertex: number
  ): void {
    if (influence.length === 0 || amount === 0) return;
    const position = this.position;
    const array = position.array as Float32Array;

    for (const { index, weight } of influence) {
      const px = array[index * 3] - axisPoint.x;
      const py = array[index * 3 + 1] - axisPoint.y;
      const pz = array[index * 3 + 2] - axisPoint.z;
      const alongAxis = px * axisDir.x + py * axisDir.y + pz * axisDir.z;
      // radial = vector from vertex to the axis line, perpendicular to axisDir
      const rx = px - alongAxis * axisDir.x;
      const ry = py - alongAxis * axisDir.y;
      const rz = pz - alongAxis * axisDir.z;

      let dx = -rx * amount * weight;
      let dy = -ry * amount * weight;
      let dz = -rz * amount * weight;
      const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (mag > maxPerVertex && mag > 1e-9) {
        const s = maxPerVertex / mag;
        dx *= s;
        dy *= s;
        dz *= s;
      }
      array[index * 3] += dx;
      array[index * 3 + 1] += dy;
      array[index * 3 + 2] += dz;
    }
    position.needsUpdate = true;
  }

  /**
   * GRIP operator ("pegada grande", Phase 4): pushes each influenced vertex
   * along its OWN direction from `center` (unlike `applyDisplacement`, which
   * shares one direction across every vertex) — positive `amount` grows the
   * gripped region outward, negative shrinks it inward. Same per-vertex-
   * direction shape as `applyConvergence`, just relative to a point instead
   * of an axis line.
   */
  applyRadialScale(influence: BrushInfluence[], center: THREE.Vector3, amount: number, maxPerVertex: number): void {
    if (influence.length === 0 || amount === 0) return;
    const position = this.position;
    const array = position.array as Float32Array;

    for (const { index, weight } of influence) {
      const px = array[index * 3] - center.x;
      const py = array[index * 3 + 1] - center.y;
      const pz = array[index * 3 + 2] - center.z;
      const mag = Math.sqrt(px * px + py * py + pz * pz);
      if (mag < 1e-9) continue;

      let dx = (px / mag) * amount * weight;
      let dy = (py / mag) * amount * weight;
      let dz = (pz / mag) * amount * weight;
      const dmag = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dmag > maxPerVertex && dmag > 1e-9) {
        const s = maxPerVertex / dmag;
        dx *= s;
        dy *= s;
        dz *= s;
      }
      array[index * 3] += dx;
      array[index * 3 + 1] += dy;
      array[index * 3 + 2] += dz;
    }
    position.needsUpdate = true;
  }

  /**
   * SMOOTH operator ("curva", Phase 4): blends each influenced vertex toward
   * the average position of the OTHER influenced vertices in the same brush
   * stamp — the stamp's own influence set doubles as a cheap local
   * neighborhood, unlike `meshSmoothing.ts`'s global Laplacian pass (real
   * triangle adjacency, rebuilt from scratch), which is too expensive to
   * call every frame of a live stroke.
   */
  applySmoothing(influence: BrushInfluence[], amount: number, maxPerVertex: number): void {
    if (influence.length < 2 || amount === 0) return;
    const position = this.position;
    const array = position.array as Float32Array;

    let cx = 0, cy = 0, cz = 0;
    for (const { index } of influence) {
      cx += array[index * 3];
      cy += array[index * 3 + 1];
      cz += array[index * 3 + 2];
    }
    cx /= influence.length;
    cy /= influence.length;
    cz /= influence.length;

    for (const { index, weight } of influence) {
      // Neighborhood average excluding this vertex itself, recovered algebraically from the
      // precomputed sum — avoids an O(n) inner loop per vertex.
      const n = influence.length - 1;
      if (n <= 0) continue;
      const nx = (cx * influence.length - array[index * 3]) / n;
      const ny = (cy * influence.length - array[index * 3 + 1]) / n;
      const nz = (cz * influence.length - array[index * 3 + 2]) / n;

      let dx = (nx - array[index * 3]) * amount * weight;
      let dy = (ny - array[index * 3 + 1]) * amount * weight;
      let dz = (nz - array[index * 3 + 2]) * amount * weight;
      const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (mag > maxPerVertex && mag > 1e-9) {
        const s = maxPerVertex / mag;
        dx *= s;
        dy *= s;
        dz *= s;
      }
      array[index * 3] += dx;
      array[index * 3 + 1] += dy;
      array[index * 3 + 2] += dz;
    }
    position.needsUpdate = true;
  }

  /**
   * Height edit: shifts every vertex along Y by `deltaY * heightFraction[i]`
   * — 0 at the base (anchored), up to 1 at the original top — so the object
   * stretches/compresses from the base up instead of a blind uniform
   * `mesh.scale.y`, and every existing local sculpt detail rides along
   * coherently instead of being reset.
   */
  applyHeightDelta(heightFraction: Float32Array, deltaY: number): void {
    if (deltaY === 0) return;
    const position = this.position;
    const array = position.array as Float32Array;
    const count = position.count;
    for (let i = 0; i < count; i++) {
      array[i * 3 + 1] += deltaY * heightFraction[i];
    }
    position.needsUpdate = true;
  }

  /**
   * Width edit (Phase 4 — WIDTH zone, "hand horizontal" gesture): scales
   * every vertex's X/Z by `(1 + deltaScale)`, Y untouched. Unlike height
   * (anchored at the base, asymmetric), width is a uniform scale around the
   * object's own central vertical axis — there's no "side" to anchor
   * against, the whole footprint should grow/shrink together — so this
   * needs no precomputed per-vertex fraction the way `applyHeightDelta`
   * does. Unlike height's additive model, this is MULTIPLICATIVE (there's
   * no natural "anchor" to measure an additive footprint delta from), so a
   * single pathological frame with `deltaScale <= -1` would flip the
   * footprint through zero and invert it rather than just flatten it —
   * clamped defensively since that failure mode has no height equivalent.
   */
  applyWidthDelta(deltaScale: number): void {
    if (deltaScale === 0) return;
    const position = this.position;
    const array = position.array as Float32Array;
    const count = position.count;
    const factor = 1 + Math.max(-0.9, deltaScale);
    for (let i = 0; i < count; i++) {
      array[i * 3] *= factor;
      array[i * 3 + 2] *= factor;
    }
    position.needsUpdate = true;
  }

  /** Call once per frame after all pointers have applied their stamps. */
  finalizeFrame(): void {
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  snapshotPositions(): Float32Array {
    return Float32Array.from(this.position.array as Float32Array);
  }

  restorePositions(snapshot: Float32Array): void {
    (this.position.array as Float32Array).set(snapshot);
    this.position.needsUpdate = true;
    this.finalizeFrame();
  }

  private get position(): THREE.BufferAttribute {
    return this.geometry.getAttribute('position') as THREE.BufferAttribute;
  }
}
