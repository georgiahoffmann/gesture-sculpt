import * as THREE from 'three';
import type { HandState } from '../tracking/types';
import type { SculptableObject } from '../modeling/modelingTypes';
import { CutController } from './cutController';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export type BladeSubTool = 'UNDECIDED' | 'CUT' | 'CORNERS' | 'TILT';

export interface BladeToolFrame {
  sub: BladeSubTool;
  /** Cut-line preview (world points) while the tool could still be a cut. */
  preview: THREE.Vector3[] | null;
  /** The sweep covered the object — perform the cut now (once). */
  cutReady: boolean;
  /** ROUND CORNERS progress 0..1 (finger elevation rise), else null. */
  cornerAmount: number | null;
  /** TILT: view pitch change for THIS frame (radians), else 0. */
  tiltDelta: number;
}

const DEG = Math.PI / 180;

/**
 * The HORIZONTAL-blade multi-tool. The same flat, palm-down hand starts
 * three different recorded gestures; the first motion decides which one it
 * is, and that choice is locked until release:
 *
 *   sweep sideways across the object       -> CUT (via CutController)
 *   fingers arc up toward vertical         -> ROUND CORNERS
 *   palm rocks in place (pitch)            -> TILT the view (see top/bottom)
 *
 * The cut samples the hand's path from the very first frame, so a sweep
 * that crosses the object before any other threshold still cuts.
 */
export class BladeTool {
  readonly cut = new CutController();
  private sub: BladeSubTool = 'UNDECIDED';
  private elevation0 = 0;
  private pitch0 = 0;
  private lastPitch = 0;
  private pitchSign = 1;
  private x0 = 0;
  private cornerPeak = 0;

  begin(hand: HandState, camera: THREE.Camera, object: SculptableObject): void {
    this.sub = 'UNDECIDED';
    this.elevation0 = hand.fingerElevation;
    this.pitch0 = this.lastPitch = hand.palmPitch;
    // The palm normal's cross product flips between hands — normalize so "tilt" means the same motion for both.
    this.pitchSign = hand.handedness === 'Right' ? 1 : -1;
    this.x0 = hand.palmCenter.x;
    this.cornerPeak = 0;
    this.cut.begin(camera, object);
  }

  update(hand: HandState, palmNdc: THREE.Vector2, camera: THREE.Camera, object: SculptableObject): BladeToolFrame {
    const cfg = INTERACTION_CONFIG.bladeTool;
    const elevationRise = (hand.fingerElevation - this.elevation0) / DEG;
    const pitchChange = ((hand.palmPitch - this.pitch0) * this.pitchSign) / DEG;
    const travel = Math.abs(hand.palmCenter.x - this.x0);

    let preview: THREE.Vector3[] | null = null;
    let cutReady = false;
    if (this.sub === 'UNDECIDED' || this.sub === 'CUT') {
      const frame = this.cut.update(palmNdc, camera, object);
      preview = frame.preview;
      cutReady = frame.ready;
    }

    if (this.sub === 'UNDECIDED') {
      if (cutReady || travel > cfg.cutLockTravel) this.sub = 'CUT';
      else if (elevationRise > cfg.cornerStartDeg) this.sub = 'CORNERS';
      else if (
        Math.abs(pitchChange) > cfg.tiltStartDeg &&
        elevationRise < cfg.tiltMaxElevationDeg &&
        Math.abs(this.pitch0) < cfg.tiltMaxStartPitchDeg * DEG
      )
        this.sub = 'TILT';
    }

    let tiltDelta = 0;
    if (this.sub === 'TILT') tiltDelta = (hand.palmPitch - this.lastPitch) * this.pitchSign * cfg.tiltSensitivity;
    this.lastPitch = hand.palmPitch;

    // Peak, not current: the hand drops away at the end of the arc, and that must not undo the rounding.
    if (this.sub === 'CORNERS') this.cornerPeak = Math.max(this.cornerPeak, Math.min(1, Math.max(0, elevationRise / cfg.cornerFullDeg)));
    const cornerAmount = this.sub === 'CORNERS' ? this.cornerPeak : null;
    return { sub: this.sub, preview: this.sub === 'CUT' || this.sub === 'UNDECIDED' ? preview : null, cutReady, cornerAmount, tiltDelta };
  }

  get subTool(): BladeSubTool {
    return this.sub;
  }

  end(): void {
    this.cut.end();
    this.sub = 'UNDECIDED';
  }
}
