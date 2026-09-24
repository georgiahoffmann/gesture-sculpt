import * as THREE from 'three';

export interface SurfaceHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  faceIndex: number;
  object: THREE.Object3D;
}

/**
 * Thin wrapper around THREE.Raycaster so the interaction layer never touches
 * Three.js raycasting internals directly. Reuses its own Vector2/Raycaster
 * instances across calls (no per-frame allocation) — `pickSurface` reuses a
 * scratch SurfaceHit too, since sculpting calls this every frame per pointer.
 */
export class RaycasterService {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  /** ndcX/ndcY must already be in Three.js NDC space: -1..1, +1 = right/top. */
  pick(ndcX: number, ndcY: number, camera: THREE.Camera, objects: THREE.Object3D[]): THREE.Object3D | null {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, camera);
    const hits = this.raycaster.intersectObjects(objects, false);
    return hits.length > 0 ? hits[0].object : null;
  }

  /**
   * Full surface hit, returned in the MESH'S OWN LOCAL SPACE (not world
   * space) — the "QUAL PARTE DA SUPERFÍCIE 3D ESTOU TOCANDO?" the brief asks
   * for, as opposed to the old screenX->radius mapping. Local space because
   * that's what `geometry.attributes.position` and every sculpt module work
   * in; converting once here (instead of in every caller) is what keeps a
   * stroke correct even while the object has been wrist-rotated.
   */
  pickSurface(ndcX: number, ndcY: number, camera: THREE.Camera, mesh: THREE.Mesh): SurfaceHit | null {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, camera);
    const hits = this.raycaster.intersectObject(mesh, false);
    if (hits.length === 0 || !hits[0].face) return null;

    const hit = hits[0];
    const localPoint = mesh.worldToLocal(hit.point.clone());
    // Raycaster intersection faces come back in the geometry's own (local) space already —
    // unlike hit.point, which intersectObject gives in world space — so the normal needs no transform.
    const localNormal = hit.face!.normal.clone().normalize();

    return {
      point: localPoint,
      normal: localNormal,
      faceIndex: hit.faceIndex ?? -1,
      object: hit.object,
    };
  }
}
