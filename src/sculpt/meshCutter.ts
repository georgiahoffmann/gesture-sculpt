import * as THREE from 'three';
import type { SculptableObject } from '../modeling/modelingTypes';

export interface CutResult {
  beforePositions: Float32Array;
  beforeHeightFraction: Float32Array;
  afterPositions: Float32Array;
  afterHeightFraction: Float32Array;
  /** The detached upper piece — already added to `object.group`, so it rotates with the object. */
  piece: THREE.Group;
}

/**
 * Splits the sculptable object along a cut surface given as "cut height at
 * this vertex". Rather than slicing triangles (which would break the quad
 * topology EditableMesh, undo and the brushes all rely on), each piece is
 * the full mesh with its vertices CLAMPED to its side of the surface:
 *
 *  - lower piece (stays THE sculptable object): y = min(y, cut)
 *  - upper piece (new, detached):              y = max(y, cut)
 *
 * Everything past the cut collapses flat onto the cut surface, which gives
 * each piece a closed, flat cap along exactly the hand's path — both stay
 * watertight, vertex/quad counts never change. heightFraction is recomputed
 * from the lower piece's new shape so later HEIGHT edits stretch the cut
 * piece evenly instead of crumpling its collapsed cap.
 */
export function cutObject(object: SculptableObject, cutHeightAt: (local: THREE.Vector3) => number, separationGap: number): CutResult {
  const position = object.geometry.getAttribute('position') as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  const beforePositions = Float32Array.from(array);
  // Kept as-is and replaced (not mutated): TopologyEditCommand holds heightFraction arrays by reference.
  const beforeHeightFraction = object.topology.heightFraction;
  const upper = Float32Array.from(array);

  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const cut = cutHeightAt(v);
    upper[i * 3 + 1] = Math.max(v.y, cut);
    array[i * 3 + 1] = Math.min(v.y, cut);
  }
  position.needsUpdate = true;

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const y = array[i * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const range = Math.max(1e-6, maxY - minY);
  const heightFraction = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) heightFraction[i] = (array[i * 3 + 1] - minY) / range;
  object.topology.heightFraction = heightFraction;

  const pieceGeometry = new THREE.BufferGeometry();
  pieceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(upper, 3));
  pieceGeometry.setIndex(object.geometry.index!.clone());
  pieceGeometry.computeVertexNormals();

  const piece = createCutPiece(object, pieceGeometry);
  piece.position.y = separationGap;
  object.group.add(piece);

  return {
    beforePositions,
    beforeHeightFraction,
    afterPositions: Float32Array.from(array),
    afterHeightFraction: heightFraction,
    piece,
  };
}

/** Same sculpt/finish visual split as the main object (see modelingTypes.ts), sharing its materials so material/finish changes apply to every piece. */
function createCutPiece(object: SculptableObject, geometry: THREE.BufferGeometry): THREE.Group {
  const shade = new THREE.Mesh(geometry, object.shadeMesh.material);
  shade.renderOrder = object.shadeMesh.renderOrder;
  const wire = new THREE.Mesh(geometry, object.wireMesh.material);
  wire.renderOrder = object.wireMesh.renderOrder;
  const finish = new THREE.Mesh(geometry, object.finishMaterial);
  finish.castShadow = true;
  finish.receiveShadow = true;

  const piece = new THREE.Group();
  piece.add(shade, wire, finish);
  piece.userData.cutPiece = { shade, wire, finish };
  setCutPieceSculptMode(piece, object.shadeMesh.visible);
  return piece;
}

export function setCutPieceSculptMode(piece: THREE.Object3D, sculpting: boolean): void {
  const parts = piece.userData.cutPiece as { shade: THREE.Mesh; wire: THREE.Mesh; finish: THREE.Mesh } | undefined;
  if (!parts) return;
  parts.shade.visible = sculpting;
  parts.wire.visible = sculpting;
  parts.finish.visible = !sculpting;
}

export function isCutPiece(obj: THREE.Object3D): boolean {
  return obj.userData.cutPiece != null;
}
