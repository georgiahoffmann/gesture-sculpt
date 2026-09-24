import type { Handedness, HandState } from '../tracking/types';
import type { HandPose } from '../tracking/landmarkUtils';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

interface BladeTracking {
  pose: HandPose;
  candidate: HandPose;
  candidateFrames: number;
  lastSeenMs: number;
}

/**
 * Debounces the raw per-frame `hand.pose` into a confirmed pose, one
 * track per hand — same idea as GestureClassifier's confirm frames, but
 * asymmetric: a pose must hold `confirmFrames` to engage and must be gone
 * for `releaseFrames` to release. The release side is longer on purpose:
 * while the vertical blade turns edge-on to the camera the landmarks get
 * noisy for a few frames, and that must not drop an ongoing rotation.
 */
export class HandPoseDetector {
  private tracking = new Map<Handedness, BladeTracking>();

  update(hand: HandState, nowMs: number): HandPose {
    const cfg = INTERACTION_CONFIG.blade;
    let state = this.tracking.get(hand.handedness);
    // Short tracking dropouts (fast sweeps) keep the debounce state; a real absence starts fresh.
    if (!state || nowMs - state.lastSeenMs > cfg.trackingGraceMs) {
      state = { pose: 'NONE', candidate: 'NONE', candidateFrames: 0, lastSeenMs: nowMs };
    }
    state.lastSeenMs = nowMs;
    const raw = hand.pose;

    if (raw === state.pose) {
      state.candidateFrames = 0;
    } else {
      if (raw !== state.candidate) {
        state.candidate = raw;
        state.candidateFrames = 0;
      }
      state.candidateFrames += 1;
      // Dropping to NONE uses the longer release window (bridges noisy/occluded frames); moving to
      // another pose uses that pose's own confirm window, so e.g. a blade flowing into a beak hands
      // off as fast as the beak would have engaged from rest.
      const releaseFrames = state.pose === 'VERTICAL' || state.pose === 'HORIZONTAL' ? cfg.rotationReleaseFrames : cfg.releaseFrames;
      const needed = state.pose !== 'NONE' && raw === 'NONE' ? releaseFrames : confirmFramesFor(raw);
      if (state.candidateFrames >= needed) {
        state.pose = raw;
        state.candidateFrames = 0;
      }
    }

    this.tracking.set(hand.handedness, state);
    return state.pose;
  }

  /** The confirmed pose right now, without advancing the debounce. */
  current(handedness: Handedness): HandPose {
    return this.tracking.get(handedness)?.pose ?? 'NONE';
  }

  reset(handedness?: Handedness): void {
    if (handedness) this.tracking.delete(handedness);
    else this.tracking.clear();
  }
}

function confirmFramesFor(pose: HandPose): number {
  const cfg = INTERACTION_CONFIG.blade;
  switch (pose) {
    case 'DOWN':
      return cfg.downConfirmFrames;
    case 'SIDE':
      return cfg.sideConfirmFrames;
    case 'CURLED':
      return cfg.curledConfirmFrames;
    case 'TRIPOD':
      return cfg.tripodConfirmFrames;
    case 'HORIZONTAL':
      return cfg.horizontalConfirmFrames;
    default:
      return cfg.confirmFrames;
  }
}
