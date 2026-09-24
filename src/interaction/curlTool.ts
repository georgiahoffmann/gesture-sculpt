import * as THREE from 'three';
import type { HandState } from '../tracking/types';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export type CurlSubTool = 'UNDECIDED' | 'ZOOM_IN' | 'ZOOM_OUT' | 'PUSH';

export interface CurlToolFrame {
  sub: CurlSubTool;
  /** Camera distance change for THIS frame (negative = closer / zoom in). */
  zoomDelta: number;
  /** PUSH: world units to push the touched vertices inward THIS frame. */
  pushAmount: number;
}

/** Thumb-gap wobble ignored by the zoom ratchet — without it, noise that only ever counts one way would creep the zoom. */
const RATCHET_BAND = 0.08;

/**
 * The CURLED-pose multi-tool (index + thumb, other fingers curled):
 *
 *   starts OPEN               -> ZOOM OUT: each closing zooms out, openings reset
 *   starts closed, opens      -> ZOOM IN:  each opening zooms in, closings reset
 *   starts closed, moves in   -> PUSH the touched vertices into the form
 *
 * Zoom is a ratchet because both recorded zoom videos repeat the motion
 * (open, close, open...): a plain "gap = zoom level" mapping would undo
 * every stroke on the way back.
 */
export class CurlTool {
  private sub: CurlSubTool = 'UNDECIDED';
  private anchor = 0;
  private minGap = 0;
  private startDistance = 0;
  private lastDistance = 0;

  begin(hand: HandState, cursorNdc: THREE.Vector2, centerNdc: THREE.Vector2 | null): void {
    const gap = hand.thumbIndexGap;
    this.sub = gap > INTERACTION_CONFIG.curl.openGap ? 'ZOOM_OUT' : 'UNDECIDED';
    this.anchor = this.minGap = gap;
    this.startDistance = this.lastDistance = centerNdc ? cursorNdc.distanceTo(centerNdc) : 0;
  }

  update(hand: HandState, cursorNdc: THREE.Vector2, centerNdc: THREE.Vector2 | null): CurlToolFrame {
    const cfg = INTERACTION_CONFIG.curl;
    const gap = hand.thumbIndexGap;
    const distance = centerNdc ? cursorNdc.distanceTo(centerNdc) : this.lastDistance;

    if (this.sub === 'UNDECIDED') {
      this.minGap = Math.min(this.minGap, gap);
      if (gap - this.minGap > cfg.zoomStartDelta) {
        this.sub = 'ZOOM_IN';
        this.anchor = this.minGap;
      } else if (this.startDistance - distance > cfg.pushStartTravel) {
        this.sub = 'PUSH';
      }
    }

    let zoomDelta = 0;
    if (this.sub === 'ZOOM_IN') {
      if (gap > this.anchor + RATCHET_BAND) {
        zoomDelta = -(gap - this.anchor) * cfg.zoomSensitivity;
        this.anchor = gap;
      } else if (gap < this.anchor - RATCHET_BAND) {
        this.anchor = gap;
      }
    } else if (this.sub === 'ZOOM_OUT') {
      if (gap < this.anchor - RATCHET_BAND) {
        zoomDelta = (this.anchor - gap) * cfg.zoomSensitivity;
        this.anchor = gap;
      } else if (gap > this.anchor + RATCHET_BAND) {
        this.anchor = gap;
      }
    }

    let pushAmount = 0;
    if (this.sub === 'PUSH') {
      const approach = this.lastDistance - distance;
      if (approach > 0) pushAmount = approach * cfg.pushSensitivity;
    }
    this.lastDistance = distance;

    return { sub: this.sub, zoomDelta, pushAmount };
  }

  get subTool(): CurlSubTool {
    return this.sub;
  }

  end(): void {
    this.sub = 'UNDECIDED';
  }
}
