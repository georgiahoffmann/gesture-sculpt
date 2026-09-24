import type { Handedness, HandState } from '../tracking/types';
import type { BladePose } from '../tracking/landmarkUtils';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

interface BladeTracking {
  pose: BladePose;
  candidate: BladePose;
  candidateFrames: number;
  lastSeenMs: number;
}

/**
 * Debounces the raw per-frame `hand.bladePose` into a confirmed pose, one
 * track per hand — same idea as GestureClassifier's confirm frames, but
 * asymmetric: a pose must hold `confirmFrames` to engage and must be gone
 * for `releaseFrames` to release. The release side is longer on purpose:
 * while the vertical blade turns edge-on to the camera the landmarks get
 * noisy for a few frames, and that must not drop an ongoing rotation.
 */
export class BladeDetector {
  private tracking = new Map<Handedness, BladeTracking>();

  update(hand: HandState, nowMs: number): BladePose {
    const cfg = INTERACTION_CONFIG.blade;
    let state = this.tracking.get(hand.handedness);
    // Short tracking dropouts (fast sweeps) keep the debounce state; a real absence starts fresh.
    if (!state || nowMs - state.lastSeenMs > cfg.trackingGraceMs) {
      state = { pose: 'NONE', candidate: 'NONE', candidateFrames: 0, lastSeenMs: nowMs };
    }
    state.lastSeenMs = nowMs;
    const raw = hand.bladePose;

    if (raw === state.pose) {
      state.candidateFrames = 0;
    } else {
      if (raw !== state.candidate) {
        state.candidate = raw;
        state.candidateFrames = 0;
      }
      state.candidateFrames += 1;
      // Leaving a confirmed pose (to NONE or to the other orientation) uses the longer release window.
      const needed =
        state.pose !== 'NONE'
          ? cfg.releaseFrames
          : raw === 'DOWN'
            ? cfg.downConfirmFrames
            : raw === 'HORIZONTAL'
              ? cfg.horizontalConfirmFrames
              : cfg.confirmFrames;
      if (state.candidateFrames >= needed) {
        state.pose = raw;
        state.candidateFrames = 0;
      }
    }

    this.tracking.set(hand.handedness, state);
    return state.pose;
  }

  reset(handedness?: Handedness): void {
    if (handedness) this.tracking.delete(handedness);
    else this.tracking.clear();
  }
}
