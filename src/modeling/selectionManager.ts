import * as THREE from 'three';
import type { EditableMesh, SelectionElement } from './editableMesh';
import type { SurfaceHit } from '../scene/raycaster';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export type SelectionMode = 'OBJECT' | SelectionElement;

/**
 * OBJECT/VERTEX/EDGE/FACE selection, per the brief's SelectionManager. A
 * raycast hit only ever gives a triangle (face) — VERTEX/FACE picking is
 * resolved as "nearest vertex OF that face to the hit point" / "that face
 * itself", standard practice (Blender does the same face-assisted
 * resolution for click-picking) and cheap. EDGE picking (Phase 4) instead
 * does a radius-based scan across every edge in the mesh, not just the hit
 * face's 4 — see `EditableMesh.nearestEdgeNear` — since hand-tracking
 * precision made the face-only version too easy to miss ("arredondar
 * bordas" needed ~20% more forgiving edge catchment, confirmed by testing).
 * OBJECT mode has no per-element selection; it exists so gesture/UI code has
 * one consistent mode value even when nothing mesh-level is being edited.
 */
export class SelectionManager {
  private mode: SelectionMode = 'VERTEX';
  private selectedIndex: number | null = null;

  getMode(): SelectionMode {
    return this.mode;
  }

  setMode(mode: SelectionMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.selectedIndex = null;
  }

  getSelectedIndex(): number | null {
    return this.selectedIndex;
  }

  clear(): void {
    this.selectedIndex = null;
  }

  /** Pure resolution of `hit` to a vertex/edge/face index per the current mode — does NOT change the selection. Used for hover preview (see `previewAtHit`) and by `pickAtHit`. */
  private resolveAtHit(hit: SurfaceHit, mesh: EditableMesh): number | null {
    if (this.mode === 'OBJECT') return null;
    const faceIndex = mesh.triangleToFace(hit.faceIndex);
    if (this.mode === 'FACE') return faceIndex;
    if (this.mode === 'VERTEX') return mesh.nearestVertexOfFace(faceIndex, hit.point);
    const near = mesh.nearestEdgeNear(hit.point, INTERACTION_CONFIG.edit.edgePickRadius);
    return near ?? mesh.nearestEdgeOfFace(faceIndex, hit.point);
  }

  /** Resolves `hit` to a vertex/edge/face per the current mode and selects it (commits). No-op in OBJECT mode. Returns the resolved index, or null. */
  pickAtHit(hit: SurfaceHit, mesh: EditableMesh): number | null {
    this.selectedIndex = this.resolveAtHit(hit, mesh);
    return this.selectedIndex;
  }

  /** Direct retarget, no raycast involved — used after a topology op (extrude/inset/bevel/subdivide) to select the element the op just created, e.g. an inset's new inner face. */
  setSelection(mode: SelectionMode, index: number): void {
    this.mode = mode;
    this.selectedIndex = index;
  }

  /** What WOULD be selected if the pointer engaged right now — for hover feedback (hollow-ring style, same idea as the sculpt brush preview) without committing a selection. */
  previewAtHit(hit: SurfaceHit, mesh: EditableMesh, target: THREE.Vector3): THREE.Vector3 | null {
    const index = this.resolveAtHit(hit, mesh);
    if (index == null) return null;
    if (this.mode === 'VERTEX') return mesh.getVertexPosition(index, target);
    if (this.mode === 'EDGE') return mesh.getEdgeMidpoint(index, target);
    return mesh.getFaceCenter(index, target);
  }

  /** Vertex indices the current selection should move as a group — empty if nothing (or OBJECT) is selected. */
  getSelectedVertexIndices(mesh: EditableMesh): number[] {
    if (this.mode === 'OBJECT' || this.selectedIndex == null) return [];
    return mesh.verticesFor(this.mode, this.selectedIndex);
  }

  /** World-space (well, local-space — caller transforms) position for drawing a highlight, or null if nothing selected. */
  getSelectionCenter(mesh: EditableMesh, target: THREE.Vector3): THREE.Vector3 | null {
    if (this.mode === 'OBJECT' || this.selectedIndex == null) return null;
    if (this.mode === 'VERTEX') return mesh.getVertexPosition(this.selectedIndex, target);
    if (this.mode === 'EDGE') return mesh.getEdgeMidpoint(this.selectedIndex, target);
    return mesh.getFaceCenter(this.selectedIndex, target);
  }
}
