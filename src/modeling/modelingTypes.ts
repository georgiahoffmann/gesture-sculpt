import * as THREE from 'three';
import type { MeshTopology } from '../sculpt/meshTopology';

/**
 * The one sculptable object. Several render objects share the SAME geometry
 * (and, for `points`, the exact same position BufferAttribute instance) so a
 * single MeshDeformer write is visible everywhere at once with no copying:
 *
 *  - shadeMesh + wireMesh: sculpt-mode visual (faint solid + wireframe on top)
 *  - points: one dot per vertex, sculpt-mode only
 *  - finishMesh: solid-material visual, MATERIAL_FINISH mode only
 *
 * Exactly one of {shadeMesh+wireMesh+points} vs {finishMesh} is visible at a
 * time; freezing/unfreezing only toggles `.visible`, it never rebuilds or
 * swaps geometry — the sculpted shape is always the single source of truth.
 */
export interface SculptableObject {
  id: string;
  /** Parent of every render object below — rotate THIS (not the individual meshes) so wire/points/solid always agree. */
  group: THREE.Group;
  geometry: THREE.BufferGeometry;
  topology: MeshTopology;

  shadeMesh: THREE.Mesh;
  wireMesh: THREE.Mesh;
  points: THREE.Points;
  pointsMaterial: THREE.PointsMaterial;

  finishMesh: THREE.Mesh;
  finishMaterial: THREE.MeshStandardMaterial;

  setSculptMode(sculpting: boolean): void;
}
