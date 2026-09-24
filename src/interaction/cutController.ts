import * as THREE from 'three';
import type { SculptableObject } from '../modeling/modelingTypes';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

const UP = new THREE.Vector3(0, 1, 0);

export interface CutFrame {
  /** World-space points of the hand's path across the object so far — drawn as the cut-line preview. */
  preview: THREE.Vector3[];
  /** True once the blade has swept far enough across the object for the cut to happen (and it hasn't happened yet). */
  ready: boolean;
}

/**
 * Turns the horizontal-blade sweep (the recorded CUT gesture) into a cut
 * SURFACE that follows the hand: while CUTTING is engaged, every frame the
 * blade's cursor is projected onto a vertical plane through the object's
 * center, facing the camera. Each sample is (s, y): s = position along the
 * screen-horizontal axis, y = object-local height. When the samples span
 * enough of the object's width, the path is binned into a height-per-s
 * function and handed to meshCutter — so a straight sweep cuts flat and a
 * tilted or wavy sweep cuts along that same path.
 */
export class CutController {
  private samples: Array<{ s: number; y: number; world: THREE.Vector3 }> = [];
  private center = new THREE.Vector3();
  private right = new THREE.Vector3();
  private plane = new THREE.Plane();
  private raycaster = new THREE.Raycaster();
  private sMin = 0;
  private sMax = 0;
  private yMin = 0;
  private yMax = 0;
  private done = false;

  begin(camera: THREE.Camera, object: SculptableObject): void {
    this.samples = [];
    this.done = false;

    object.shadeMesh.updateMatrixWorld();
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox!;
    this.yMin = box.min.y;
    this.yMax = box.max.y;
    box.getCenter(this.center);
    object.shadeMesh.localToWorld(this.center);

    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    normal.y = 0;
    if (normal.lengthSq() < 1e-6) normal.set(0, 0, -1);
    normal.normalize();
    this.right.crossVectors(normal, UP).normalize();
    this.plane.setFromNormalAndCoplanarPoint(normal, this.center);

    this.sMin = Infinity;
    this.sMax = -Infinity;
    const position = object.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      const s = this.sOfLocal(v.fromBufferAttribute(position, i), object);
      if (s < this.sMin) this.sMin = s;
      if (s > this.sMax) this.sMax = s;
    }
  }

  update(cursorNdc: THREE.Vector2, camera: THREE.Camera, object: SculptableObject): CutFrame {
    this.raycaster.setFromCamera(cursorNdc, camera);
    const world = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (world) {
      const y = object.shadeMesh.worldToLocal(world.clone()).y;
      // Only the part of the sweep that actually passes through the object's height counts.
      if (y >= this.yMin && y <= this.yMax) {
        this.samples.push({ s: world.clone().sub(this.center).dot(this.right), y, world });
      }
    }
    return { preview: this.samples.map((p) => p.world), ready: !this.done && this.coversObject() };
  }

  /** Horizontal position of an object-local point along the sweep axis — same measure the samples use. */
  sOfLocal(local: THREE.Vector3, object: SculptableObject): number {
    return object.shadeMesh.localToWorld(local.clone()).sub(this.center).dot(this.right);
  }

  /**
   * The hand's path as a cut-height function: samples averaged into
   * `cut.pathBins` bins across the object's width (smooths tracking
   * jitter), empty bins filled by interpolation, clamped away from the
   * object's bottom/top so neither piece is degenerate.
   */
  buildCutFunction(): (s: number) => number {
    const { pathBins, edgeMargin } = INTERACTION_CONFIG.cut;
    const width = Math.max(1e-6, this.sMax - this.sMin);
    const sums = new Float64Array(pathBins);
    const counts = new Uint32Array(pathBins);
    for (const p of this.samples) {
      const b = Math.min(pathBins - 1, Math.max(0, Math.floor(((p.s - this.sMin) / width) * pathBins)));
      sums[b] += p.y;
      counts[b] += 1;
    }

    const margin = (this.yMax - this.yMin) * edgeMargin;
    const lo = this.yMin + margin;
    const hi = this.yMax - margin;
    const heights: Array<number | null> = Array.from(counts, (c, b) => (c > 0 ? sums[b] / c : null));
    const filled = heights.map((h, b) => {
      if (h != null) return h;
      let l = b - 1;
      while (l >= 0 && heights[l] == null) l--;
      let r = b + 1;
      while (r < pathBins && heights[r] == null) r++;
      if (l < 0) return heights[r] as number;
      if (r >= pathBins) return heights[l] as number;
      const t = (b - l) / (r - l);
      return (heights[l] as number) * (1 - t) + (heights[r] as number) * t;
    });
    const clamped = filled.map((h) => Math.min(hi, Math.max(lo, h)));

    const sMin = this.sMin;
    return (s: number) => {
      const f = ((s - sMin) / width) * pathBins - 0.5;
      if (f <= 0) return clamped[0];
      if (f >= pathBins - 1) return clamped[pathBins - 1];
      const i = Math.floor(f);
      const t = f - i;
      return clamped[i] * (1 - t) + clamped[i + 1] * t;
    };
  }

  /** Whether this sweep already produced its cut — one cut per blade engage. */
  get completed(): boolean {
    return this.done;
  }

  markDone(): void {
    this.done = true;
  }

  end(): void {
    this.samples = [];
    this.done = false;
  }

  private coversObject(): boolean {
    if (this.samples.length < 2) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of this.samples) {
      if (p.s < lo) lo = p.s;
      if (p.s > hi) hi = p.s;
    }
    const slack = ((1 - INTERACTION_CONFIG.cut.sweepCoverage) / 2) * (this.sMax - this.sMin);
    return lo <= this.sMin + slack && hi >= this.sMax - slack;
  }
}
