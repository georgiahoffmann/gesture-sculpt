import * as THREE from 'three';
import type { SculptableObject } from './modelingTypes';
import { createSculptableBoxTopology } from '../sculpt/meshTopology';
import { MATERIAL_LIBRARY } from './materialLibrary';

let nextId = 1;

/**
 * Builds the one sculptable object: a welded, subdivided box (see
 * meshTopology.ts — a real editable 3D mesh, not a profile/Lathe and not a
 * single global roundness parameter). Starts life looking exactly like a box;
 * every subsequent visual change (rounding a corner, pulling a point, adding
 * a dent) comes from real vertex edits via MeshDeformer, never from swapping
 * to a different primitive.
 */
export function createSculptableObject(scene: THREE.Scene, segments: number): SculptableObject {
  const topology = createSculptableBoxTopology(1, segments);
  const geometry = topology.geometry;

  const shadeMaterial = new THREE.MeshStandardMaterial({
    color: 0xeef0f2,
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const shadeMesh = new THREE.Mesh(geometry, shadeMaterial);
  shadeMesh.renderOrder = 0;

  const wireMaterial = new THREE.MeshBasicMaterial({
    color: 0x1a1a1a,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
  });
  const wireMesh = new THREE.Mesh(geometry, wireMaterial);
  wireMesh.renderOrder = 1;

  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute('position', geometry.getAttribute('position'));
  const vertexCount = (geometry.getAttribute('position') as THREE.BufferAttribute).count;
  pointsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3), 3));
  const pointsMaterial = new THREE.PointsMaterial({ size: 0.02, vertexColors: true });
  const points = new THREE.Points(pointsGeometry, pointsMaterial);
  points.renderOrder = 2;
  resetPointColors(pointsGeometry);

  const firstMaterial = MATERIAL_LIBRARY[0];
  const finishMaterial = new THREE.MeshStandardMaterial({
    color: firstMaterial.color,
    roughness: firstMaterial.roughness,
    metalness: firstMaterial.metalness,
  });
  const finishMesh = new THREE.Mesh(geometry, finishMaterial);
  finishMesh.castShadow = true;
  finishMesh.receiveShadow = true;
  finishMesh.visible = false;

  const group = new THREE.Group();
  group.position.set(0, 0.5, 0);
  group.add(shadeMesh, wireMesh, points, finishMesh);
  scene.add(group);

  const object: SculptableObject = {
    id: `object-${nextId++}`,
    group,
    geometry,
    topology,
    shadeMesh,
    wireMesh,
    points,
    pointsMaterial,
    finishMesh,
    finishMaterial,
    setSculptMode(sculpting: boolean) {
      shadeMesh.visible = sculpting;
      wireMesh.visible = sculpting;
      points.visible = sculpting;
      finishMesh.visible = !sculpting;
    },
  };

  return object;
}

/**
 * Re-shares `object.points`' position attribute with the main geometry and
 * resizes its `color` attribute to match — needed after a Phase 3 topology
 * op (extrude/inset/bevel/subdivide) swaps in a bigger position buffer via
 * `EditableMesh.applyTopologyResult`, which the points geometry doesn't
 * otherwise hear about. Idempotent (checked by vertex count) so it's cheap
 * to call unconditionally once a frame rather than threading a
 * "topology changed this frame" event through the render loop.
 */
export function syncPointsGeometry(object: SculptableObject): void {
  const position = object.geometry.getAttribute('position') as THREE.BufferAttribute;
  const pointsGeometry = object.points.geometry;
  const color = pointsGeometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (color && color.count === position.count) return;

  pointsGeometry.setAttribute('position', position);
  pointsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3));
  resetPointColors(pointsGeometry);
}

const BASE_POINT_COLOR: [number, number, number] = [0.1, 0.1, 0.1];

export function resetPointColors(pointsGeometry: THREE.BufferGeometry): void {
  const color = pointsGeometry.getAttribute('color') as THREE.BufferAttribute;
  const array = color.array as Float32Array;
  for (let i = 0; i < color.count; i++) {
    array[i * 3] = BASE_POINT_COLOR[0];
    array[i * 3 + 1] = BASE_POINT_COLOR[1];
    array[i * 3 + 2] = BASE_POINT_COLOR[2];
  }
  color.needsUpdate = true;
}

/**
 * Rebuilds the sculptable object at a new resolution. Only safe to call
 * BEFORE the first stroke — see the UI note next to MESH_RESOLUTION — since
 * there is no remeshing-with-detail-preservation here, only a fresh base box.
 */
export function rebuildSculptableObject(scene: THREE.Scene, previous: SculptableObject, segments: number): SculptableObject {
  scene.remove(previous.group);
  previous.geometry.dispose();
  const next = createSculptableObject(scene, segments);
  next.finishMaterial.copy(previous.finishMaterial);
  next.group.rotation.y = previous.group.rotation.y;
  return next;
}
