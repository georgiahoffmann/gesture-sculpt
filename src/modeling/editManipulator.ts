import * as THREE from 'three';
import type { EditableMesh } from './editableMesh';
import type { SelectionManager } from './selectionManager';
import type { MeshDeformer } from '../sculpt/meshDeformer';
import type { CommandHistory } from './commandHistory';
import type { MeshTopology } from '../sculpt/meshTopology';
import { MeshEditCommand, TopologyEditCommand, type TopologySnapshot } from './commands';
import type { SurfaceHit } from '../scene/raycaster';
import { computeBrushInfluence, type BrushInfluence } from '../sculpt/sculptBrush';
import { extrudeFace, insetFace, subdivideFace, bevelEdge } from './meshTopologyOps';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export type EditOperator = 'MOVE' | 'EXTRUDE' | 'INSET' | 'BEVEL' | 'SUBDIVIDE';

export interface EditSettings {
  operator: EditOperator;
  /** World-space proportional-editing radius for MOVE — 0 reproduces the pre-Phase-3 exact-selection-only behavior. Ignored by every other operator (each of those already has its own selection-derived scope). */
  falloffRadius: number;
}

export interface EditUpdateResult {
  moved: boolean;
  activeVertexCount: number;
}

interface InsetDragState {
  innerVerts: number[];
  outerVerts: number[];
  fraction: number;
}

interface BevelDragState {
  pairs: Array<{ active: number; from: number; to: number }>;
  fraction: number;
  /** Fixed reference direction the fraction is measured against — captured from the first frame of tangential motion, so tracing further along it grows the fraction and backtracking shrinks it (Phase 4: BEVEL's amount tracks how far the hand has traced along the edge, not push/pull depth). */
  traceDir: THREE.Vector3 | null;
}

const scratchDelta = new THREE.Vector3();
const scratchTangential = new THREE.Vector3();
const scratchCentroid = new THREE.Vector3();
const scratchVertex = new THREE.Vector3();
const scratchTarget = new THREE.Vector3();
const scratchNew = new THREE.Vector3();

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Select+act for VERTEX/EDGE/FACE elements — the EDIT-mode counterpart to
 * StrokeDeformer, one instance per pointer. A single engage both resolves
 * the selection (same as SCULPT never needing a separate "pick" step) and,
 * for the four topology operators, performs the mesh surgery immediately;
 * the drag that follows only adjusts the *amount* (push distance, inset/
 * bevel fraction), never re-runs the surgery. See docs/BLENDER_MAPPING.md
 * for what each operator does and why (Phase 3).
 */
export class EditManipulator {
  private operator: EditOperator = 'MOVE';
  private lastPoint: THREE.Vector3 | null = null;
  private planeNormal = new THREE.Vector3();

  // MOVE
  private activeVertexIndices: number[] = [];
  private moveInfluence: BrushInfluence[] | null = null;
  private activeEdit: MeshEditCommand | null = null;

  // EXTRUDE/INSET/BEVEL/SUBDIVIDE
  private topologyEdit: TopologyEditCommand | null = null;
  private insetState: InsetDragState | null = null;
  private bevelState: BevelDragState | null = null;

  constructor(
    private mesh: EditableMesh,
    private selection: SelectionManager,
    private deformer: MeshDeformer,
    private history: CommandHistory,
    private geometry: THREE.BufferGeometry,
    private topology: MeshTopology
  ) {}

  /** Call exactly once when the state machine transitions this pointer into EDITING. `hit` is guaranteed non-null here — EDITING only exists inside the MESH zone, which requires a hit. */
  beginEdit(hit: SurfaceHit, settings: EditSettings): void {
    this.operator = settings.operator;
    this.lastPoint = hit.point.clone();
    this.planeNormal.copy(hit.normal);
    this.activeVertexIndices = [];
    this.moveInfluence = null;
    this.activeEdit = null;
    this.topologyEdit = null;
    this.insetState = null;
    this.bevelState = null;

    if (settings.operator === 'MOVE') {
      this.beginMove(hit, settings);
    } else {
      this.beginTopologyOp(hit, settings.operator);
    }
  }

  private beginMove(hit: SurfaceHit, settings: EditSettings): void {
    this.selection.pickAtHit(hit, this.mesh);
    this.activeVertexIndices = this.selection.getSelectedVertexIndices(this.mesh);
    if (this.activeVertexIndices.length === 0) return;

    if (settings.falloffRadius > 0) {
      const center = this.selection.getSelectionCenter(this.mesh, scratchCentroid);
      if (center) {
        const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
        this.moveInfluence = computeBrushInfluence(position, center, settings.falloffRadius, INTERACTION_CONFIG.edit.falloffExponent);
      }
    }

    this.activeEdit = new MeshEditCommand(this.deformer, this.deformer.snapshotPositions());
  }

  private beginTopologyOp(hit: SurfaceHit, operator: Exclude<EditOperator, 'MOVE'>): void {
    const requiredMode = operator === 'BEVEL' ? 'EDGE' : 'FACE';
    const resolvedIndex = this.selection.pickAtHit(hit, this.mesh);
    if (resolvedIndex == null || this.selection.getMode() !== requiredMode) return;

    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = position.array as Float32Array;
    const quads = this.mesh.getQuadsSnapshot();
    const heightFraction = this.topology.heightFraction;

    const before: TopologySnapshot = {
      positions: Float32Array.from(positions),
      quads: this.mesh.getQuadsSnapshot(),
      heightFraction: Float32Array.from(heightFraction),
    };
    const edit = new TopologyEditCommand(this.mesh, this.geometry, this.topology, before);

    switch (operator) {
      case 'EXTRUDE': {
        const result = extrudeFace(positions, quads, heightFraction, resolvedIndex);
        this.commitTopology(result.positions, result.quads, result.heightFraction);
        this.selection.setSelection('FACE', result.faceIndex);
        this.activeVertexIndices = [...result.activeVerts];
        break;
      }
      case 'INSET': {
        const fraction = INTERACTION_CONFIG.edit.insetFractionDefault;
        const result = insetFace(positions, quads, heightFraction, resolvedIndex, fraction);
        this.commitTopology(result.positions, result.quads, result.heightFraction);
        this.selection.setSelection('FACE', result.faceIndex);
        this.insetState = { innerVerts: [...result.innerVerts], outerVerts: [...result.outerVerts], fraction };
        break;
      }
      case 'SUBDIVIDE': {
        const result = subdivideFace(positions, quads, heightFraction, resolvedIndex);
        this.commitTopology(result.positions, result.quads, result.heightFraction);
        this.selection.setSelection('FACE', result.faceIndex);
        break;
      }
      case 'BEVEL': {
        const edgeVertices = this.mesh.getEdgeVertices(resolvedIndex);
        const edgeFaces = this.mesh.getEdgeFaces(resolvedIndex);
        const fraction = INTERACTION_CONFIG.edit.bevelFractionDefault;
        const result = bevelEdge(positions, quads, heightFraction, edgeVertices, edgeFaces, fraction);
        this.commitTopology(result.positions, result.quads, result.heightFraction);
        this.selection.setSelection('FACE', result.resultFaceIndex);
        this.bevelState = { pairs: result.pairs, fraction, traceDir: null };
        break;
      }
    }

    this.topologyEdit = edit;
  }

  private commitTopology(positions: Float32Array, quads: Uint32Array[], heightFraction: Float32Array): void {
    this.mesh.applyTopologyResult(this.geometry, positions, quads);
    this.topology.quads = quads;
    this.topology.heightFraction = heightFraction;
  }

  /** Call every frame this pointer stays in EDITING. `depthDelta` is the same hand/mouse push-pull signal StrokeDeformer's INFLATE operator uses. */
  update(hit: SurfaceHit, depthDelta: number): EditUpdateResult {
    switch (this.operator) {
      case 'MOVE':
        return this.updateMove(hit, depthDelta);
      case 'EXTRUDE':
        return this.updateExtrude(depthDelta);
      case 'INSET':
        return this.updateInset(depthDelta);
      case 'BEVEL':
        return this.updateBevel(hit);
      case 'SUBDIVIDE':
        return { moved: false, activeVertexCount: 0 };
    }
  }

  private updateMove(hit: SurfaceHit, depthDelta: number): EditUpdateResult {
    if (!this.lastPoint || this.activeVertexIndices.length === 0) {
      this.lastPoint = hit.point.clone();
      return { moved: false, activeVertexCount: this.activeVertexIndices.length };
    }

    scratchDelta.subVectors(hit.point, this.lastPoint);
    this.lastPoint.copy(hit.point);

    const normalComponent = scratchDelta.dot(this.planeNormal);
    scratchTangential.copy(scratchDelta).addScaledVector(this.planeNormal, -normalComponent);

    const cfg = INTERACTION_CONFIG.edit;
    if (Math.abs(depthDelta) > cfg.depthDeadzone) {
      scratchTangential.addScaledVector(this.planeNormal, depthDelta * cfg.normalSensitivity);
    }

    if (scratchTangential.lengthSq() < 1e-12) {
      return { moved: false, activeVertexCount: this.activeVertexIndices.length };
    }

    if (this.moveInfluence) {
      this.mesh.moveVerticesWeighted(this.moveInfluence, scratchTangential);
      return { moved: true, activeVertexCount: this.moveInfluence.length };
    }
    this.mesh.moveVertices(this.activeVertexIndices, scratchTangential);
    return { moved: true, activeVertexCount: this.activeVertexIndices.length };
  }

  /** Normal-only push, like StrokeDeformer's INFLATE — the extruded cap's own drag axis is unambiguous, so (unlike MOVE) there's no tangential component to combine it with. */
  private updateExtrude(depthDelta: number): EditUpdateResult {
    const cfg = INTERACTION_CONFIG.edit;
    if (Math.abs(depthDelta) <= cfg.depthDeadzone || this.activeVertexIndices.length === 0) {
      return { moved: false, activeVertexCount: this.activeVertexIndices.length };
    }
    scratchDelta.copy(this.planeNormal).multiplyScalar(depthDelta * cfg.normalSensitivity);
    const mag = scratchDelta.length();
    if (mag > cfg.maxVertexDisplacement) scratchDelta.multiplyScalar(cfg.maxVertexDisplacement / mag);
    this.mesh.moveVertices(this.activeVertexIndices, scratchDelta);
    return { moved: true, activeVertexCount: this.activeVertexIndices.length };
  }

  private updateInset(depthDelta: number): EditUpdateResult {
    const cfg = INTERACTION_CONFIG.edit;
    if (!this.insetState || Math.abs(depthDelta) <= cfg.depthDeadzone) {
      return { moved: false, activeVertexCount: this.insetState?.innerVerts.length ?? 0 };
    }

    this.insetState.fraction = clamp(this.insetState.fraction + depthDelta * cfg.fractionDepthSensitivity, cfg.insetFractionMin, cfg.insetFractionMax);
    const { innerVerts, outerVerts, fraction } = this.insetState;

    scratchCentroid.set(0, 0, 0);
    for (const v of outerVerts) scratchCentroid.add(this.mesh.getVertexPosition(v, scratchVertex));
    scratchCentroid.divideScalar(outerVerts.length);

    for (let i = 0; i < innerVerts.length; i++) {
      this.mesh.getVertexPosition(outerVerts[i], scratchVertex);
      scratchNew.copy(scratchVertex).lerp(scratchCentroid, fraction);
      this.mesh.setVertexPosition(innerVerts[i], scratchNew);
    }

    return { moved: true, activeVertexCount: innerVerts.length };
  }

  /**
   * BEVEL's amount tracks how far the hand has traced tangentially along
   * the edge since engage (Phase 4 — "arredondar bordas" should visibly
   * grow as the hand traces further, not respond to push/pull depth like
   * INSET still does). The trace direction is captured from the first
   * frame of real tangential motion and stays fixed for the rest of the
   * drag, so continuing that way keeps growing the fraction and
   * backtracking shrinks it — the same live, reversible feel every other
   * drag-to-adjust operator already has.
   */
  private updateBevel(hit: SurfaceHit): EditUpdateResult {
    if (!this.bevelState) return { moved: false, activeVertexCount: 0 };

    if (!this.lastPoint) {
      this.lastPoint = hit.point.clone();
      return { moved: false, activeVertexCount: this.bevelState.pairs.length };
    }

    scratchDelta.subVectors(hit.point, this.lastPoint);
    this.lastPoint.copy(hit.point);

    const normalComponent = scratchDelta.dot(this.planeNormal);
    scratchTangential.copy(scratchDelta).addScaledVector(this.planeNormal, -normalComponent);
    if (scratchTangential.lengthSq() < 1e-12) {
      return { moved: false, activeVertexCount: this.bevelState.pairs.length };
    }

    if (!this.bevelState.traceDir) {
      this.bevelState.traceDir = scratchTangential.clone().normalize();
    }
    const signedDistance = scratchTangential.dot(this.bevelState.traceDir);

    const cfg = INTERACTION_CONFIG.edit;
    this.bevelState.fraction = clamp(this.bevelState.fraction + signedDistance * cfg.bevelTraceSensitivity, cfg.bevelFractionMin, cfg.bevelFractionMax);
    const { pairs, fraction } = this.bevelState;

    for (const { active, from, to } of pairs) {
      this.mesh.getVertexPosition(from, scratchVertex);
      this.mesh.getVertexPosition(to, scratchTarget);
      scratchNew.copy(scratchVertex).lerp(scratchTarget, fraction);
      this.mesh.setVertexPosition(active, scratchNew);
    }

    return { moved: true, activeVertexCount: pairs.length };
  }

  /** Call exactly once when the state machine releases this pointer out of EDITING. */
  endEdit(): void {
    this.lastPoint = null;
    this.activeVertexIndices = [];
    this.moveInfluence = null;
    this.insetState = null;
    this.bevelState = null;

    if (this.activeEdit) {
      this.activeEdit.captureAfter();
      if (this.activeEdit.hasChange) this.history.push(this.activeEdit);
      this.activeEdit = null;
    }
    if (this.topologyEdit) {
      this.topologyEdit.captureAfter();
      if (this.topologyEdit.hasChange) this.history.push(this.topologyEdit);
      this.topologyEdit = null;
    }
  }

  /** Center of the current selection for overlay highlighting, or null if nothing is selected in the current mode. */
  getSelectionCenter(target: THREE.Vector3): THREE.Vector3 | null {
    return this.selection.getSelectionCenter(this.mesh, target);
  }
}
