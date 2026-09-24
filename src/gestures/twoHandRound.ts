import type { HandState } from '../tracking/types';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export interface TwoHandRoundFrame {
  /** Both hands flat THIS frame (unconfirmed) — single-hand pose tools are suppressed while true, so neither hand starts its own tool first. */
  candidate: boolean;
  active: boolean;
  started: boolean;
  ended: boolean;
  /** Roundness 0..1 from how far the hands have traced around the object. */
  amount: number;
}

/**
 * Two-hand ROUND (recorded "esculpir em formato arredondado"): both hands
 * flat and slightly cupped around the object, tracing it. Debounced like
 * the single-hand poses; while active, the amount grows with the path both
 * palms have traced (in hand spans, so distance to the camera doesn't
 * matter) — trace more, get rounder. Hands are matched frame to frame by
 * image x, not handedness, since MediaPipe sometimes labels both hands the
 * same.
 */
export class TwoHandRound {
  private active = false;
  private frames = 0;
  private traced = 0;
  private lastPalms: Array<{ x: number; y: number }> | null = null;

  update(hands: HandState[]): TwoHandRoundFrame {
    const cfg = INTERACTION_CONFIG.round;
    const pair = hands.length >= 2 ? [...hands].slice(0, 2).sort((a, b) => a.palmCenter.x - b.palmCenter.x) : null;
    const candidate = pair != null && pair[0].flat && pair[1].flat;

    let started = false;
    let ended = false;
    if (candidate === this.active) {
      this.frames = 0;
    } else {
      this.frames += 1;
      if (this.frames >= (this.active ? cfg.releaseFrames : cfg.confirmFrames)) {
        this.active = candidate;
        this.frames = 0;
        started = this.active;
        ended = !this.active;
        this.traced = 0;
        this.lastPalms = null;
      }
    }

    if (this.active && pair) {
      const palms = pair.map((h) => ({ x: h.palmCenter.x, y: h.palmCenter.y }));
      if (this.lastPalms) {
        let sum = 0;
        for (let i = 0; i < 2; i++) sum += Math.hypot(palms[i].x - this.lastPalms[i].x, palms[i].y - this.lastPalms[i].y) / pair[i].handSpan;
        this.traced += sum / 2;
      }
      this.lastPalms = palms;
    }

    return { candidate, active: this.active, started, ended, amount: Math.min(1, this.traced / cfg.fullTraceSpans) };
  }
}
