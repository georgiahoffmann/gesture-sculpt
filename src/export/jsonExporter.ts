import * as THREE from 'three';
import type { MaterialPreset } from '../modeling/materialLibrary';
import type { LightingParams } from '../scene/lighting';

export interface ExportedMeshJSON {
  generator: string;
  units: string;
  type: 'freeform_mesh';
  created: string;
  metrics: { vertices: number; triangles: number };
  vertices: number[][];
  faces: number[][];
  material: { code: string; name: string; roughness: number; metalness: number; color: string };
  light: LightingParams;
}

/** Exports the real BufferGeometry data — the mesh actually on screen, not a profile assumption. */
export function exportMeshJSON(
  geometry: THREE.BufferGeometry,
  material: MaterialPreset,
  light: LightingParams
): ExportedMeshJSON {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.index;

  const vertices: number[][] = [];
  for (let i = 0; i < position.count; i++) {
    vertices.push([
      +(position.getX(i) * 100).toFixed(3),
      +(position.getY(i) * 100).toFixed(3),
      +(position.getZ(i) * 100).toFixed(3),
    ]);
  }

  const faces: number[][] = [];
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      faces.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
    }
  }

  return {
    generator: 'GESTURE_SCULPT v0.2',
    units: 'mm',
    type: 'freeform_mesh',
    created: new Date().toISOString(),
    metrics: { vertices: vertices.length, triangles: faces.length },
    vertices,
    faces,
    material: {
      code: material.code,
      name: material.name,
      roughness: material.roughness,
      metalness: material.metalness,
      color: '#' + material.color.toString(16).padStart(6, '0'),
    },
    light,
  };
}
