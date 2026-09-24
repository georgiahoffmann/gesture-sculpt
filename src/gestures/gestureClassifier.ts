import type { Handedness, HandState } from '../tracking/types';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export type HandGesture = 'NONE' | 'PINCH' | 'GRIP';

interface GestureTracking {
  gesture: HandGesture;
  candidateFrames: number;
}

/**
 * Classifies each hand's gesture per frame as NONE / PINCH / GRIP —
 * mutually exclusive, replacing the old binary PinchDetector now that
 * "pegada grande" (Phase 4) needs the app to tell a full 5-finger grasp
 * apart from an index+thumb pinch. Same hysteresis + confirm-frames
 * debounce shape PinchDetector used for its single boolean, just evaluated
 * against whichever transition the CURRENT confirmed state allows (mirrors
 * PinchDetector's `wantsOn`/`wantsOff` two-branch structure, generalized to
 * three states) so a reading that doesn't match the pending transition
 * resets the counter instead of accumulating toward the wrong target.
 *
 * GRIP is checked first and requires `gripNormalized` alone to drop below
 * its OWN (tighter) `grip.startRatio` — a real grasp inherently also closes
 * index+thumb. PINCH is then just `pinchNormalized` on its own, exactly
 * like the old PinchDetector, with NO requirement on the other fingers —
 * an earlier version required `gripNormalized` to stay above a
 * `separationRatio` to count as a pinch, which created a dead zone: a
 * completely ordinary pinch, with the resting fingers only partly (not
 * fully) spread, could satisfy neither condition and register as no
 * gesture at all — breaking ROTATE/SCULPT/EDIT/HEIGHT, which all still run
 * on plain PINCH. GRIP releases on EITHER signal opening back up
 * (`gripNormalized` OR `pinchNormalized` past its release ratio) rather
 * than requiring both, so a real hand's noisy landmarks can't leave it
 * stuck engaged after the fingers have clearly opened.
 */
export class GestureClassifier {
  private tracking = new Map<Handedness, GestureTracking>();

  update(hand: HandState): HandGesture {
    const pinchCfg = INTERACTION_CONFIG.pinch;
    const gripCfg = INTERACTION_CONFIG.grip;
    const state = this.tracking.get(hand.handedness) ?? { gesture: 'NONE' as HandGesture, candidateFrames: 0 };

    let desired: HandGesture;
    if (state.gesture === 'GRIP') {
      desired = hand.gripNormalized > gripCfg.releaseRatio || hand.pinchNormalized > pinchCfg.releaseRatio ? 'NONE' : 'GRIP';
    } else if (state.gesture === 'PINCH') {
      desired = hand.pinchNormalized > pinchCfg.releaseRatio ? 'NONE' : 'PINCH';
    } else if (hand.gripNormalized < gripCfg.startRatio) {
      desired = 'GRIP';
    } else if (hand.pinchNormalized < pinchCfg.startRatio) {
      desired = 'PINCH';
    } else {
      desired = 'NONE';
    }

    if (desired === state.gesture) {
      state.candidateFrames = 0;
    } else {
      state.candidateFrames += 1;
      if (state.candidateFrames >= Math.max(pinchCfg.confirmFrames, gripCfg.confirmFrames)) {
        state.gesture = desired;
        state.candidateFrames = 0;
      }
    }

    this.tracking.set(hand.handedness, state);
    return state.gesture;
  }

  reset(handedness?: Handedness): void {
    if (handedness) this.tracking.delete(handedness);
    else this.tracking.clear();
  }
}
