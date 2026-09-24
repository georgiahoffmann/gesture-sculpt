import * as THREE from 'three';
import type { ModelingCommand } from './modelingCommand';
import type { MeshDeformer } from '../sculpt/meshDeformer';
import type { EditableMesh } from './editableMesh';
import type { MeshTopology } from '../sculpt/meshTopology';

export interface TopologySnapshot {
  positions: Float32Array;
  quads: Uint32Array[];
  heightFraction: Float32Array;
}

/**
 * Undo for anything that touches the vertex buffer — sculpt strokes,
 * smoothing, height edits. Captures a full before-snapshot when the
 * operation starts and an after-snapshot when it commits, so undo/redo are
 * just restoring one buffer or the other.
 */
export class MeshEditCommand implements ModelingCommand {
  readonly type = 'MESH_EDIT';
  private after: Float32Array | null = null;

  constructor(
    private deformer: MeshDeformer,
    private before: Float32Array
  ) {}

  /** The positions this edit started from — read-only use (tools that recompute from it every frame). */
  get beforePositions(): Float32Array {
    return this.before;
  }

  captureAfter(): void {
    this.after = this.deformer.snapshotPositions();
  }

  /** True once captureAfter() has run and something actually changed — callers should skip pushing a no-op command. */
  get hasChange(): boolean {
    if (!this.after) return false;
    for (let i = 0; i < this.before.length; i++) {
      if (this.before[i] !== this.after[i]) return true;
    }
    return false;
  }

  undo(): void {
    this.deformer.restorePositions(this.before);
  }

  redo(): void {
    if (this.after) this.deformer.restorePositions(this.after);
  }
}

/**
 * Undo for anything that changes topology (extrude/inset/bevel/subdivide) —
 * MeshEditCommand's position-only before/after snapshot doesn't work here
 * since vertex/face COUNT changes, not just positions. Captures the full
 * `{positions, quads, heightFraction}` triple before and after (mirroring
 * what `EditableMesh.applyTopologyResult` needs to restore a topology
 * state), plus a live reference to `topology` (see meshTopology.ts) so
 * `heightFraction` — otherwise a fixed-length array that would desync from
 * the grown vertex count — gets swapped back in lockstep with undo/redo.
 */
export class TopologyEditCommand implements ModelingCommand {
  readonly type = 'TOPOLOGY_EDIT';
  private after: TopologySnapshot | null = null;

  constructor(
    private editableMesh: EditableMesh,
    private geometry: THREE.BufferGeometry,
    private topology: MeshTopology,
    private before: TopologySnapshot
  ) {}

  captureAfter(): void {
    this.after = this.snapshot();
  }

  /** True once captureAfter() has run and the operation actually grew the mesh — callers should skip pushing a no-op command. */
  get hasChange(): boolean {
    return this.after != null && this.after.quads.length !== this.before.quads.length;
  }

  private snapshot(): TopologySnapshot {
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    return {
      positions: Float32Array.from(position.array as Float32Array),
      quads: this.editableMesh.getQuadsSnapshot(),
      heightFraction: Float32Array.from(this.topology.heightFraction),
    };
  }

  undo(): void {
    this.editableMesh.applyTopologyResult(this.geometry, this.before.positions, this.before.quads);
    this.topology.quads = this.before.quads;
    this.topology.heightFraction = this.before.heightFraction;
  }

  redo(): void {
    if (!this.after) return;
    this.editableMesh.applyTopologyResult(this.geometry, this.after.positions, this.after.quads);
    this.topology.quads = this.after.quads;
    this.topology.heightFraction = this.after.heightFraction;
  }
}

/** Undo for a committed rotation — a single scalar, no vertex snapshot needed. */
export class RotateCommand implements ModelingCommand {
  readonly type = 'ROTATE';

  constructor(
    private target: THREE.Object3D,
    private before: number,
    private after: number
  ) {}

  undo(): void {
    this.target.rotation.y = this.before;
  }

  redo(): void {
    this.target.rotation.y = this.after;
  }
}

/**
 * Undo for a CUT (see sculpt/meshCutter.ts): restores the lower piece's
 * positions AND heightFraction (the cut recomputes it) and detaches/
 * reattaches the upper piece. Vertex count never changes on a cut, so no
 * topology snapshot is needed.
 */
export class CutCommand implements ModelingCommand {
  readonly type = 'CUT';

  constructor(
    private deformer: MeshDeformer,
    private topology: MeshTopology,
    private parent: THREE.Object3D,
    private piece: THREE.Object3D,
    private beforePositions: Float32Array,
    private beforeHeightFraction: Float32Array,
    private afterPositions: Float32Array,
    private afterHeightFraction: Float32Array
  ) {}

  undo(): void {
    this.deformer.restorePositions(this.beforePositions);
    this.topology.heightFraction = this.beforeHeightFraction;
    this.parent.remove(this.piece);
  }

  redo(): void {
    this.deformer.restorePositions(this.afterPositions);
    this.topology.heightFraction = this.afterHeightFraction;
    this.parent.add(this.piece);
  }
}
