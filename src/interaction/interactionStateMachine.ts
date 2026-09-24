import type { Zone } from './spatialContext';
import type { BladePose } from '../tracking/landmarkUtils';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export type InteractionMode =
  | 'IDLE'
  | 'HOVER_MESH'
  | 'HOVER_EDIT'
  | 'HOVER_HEIGHT'
  | 'HOVER_WIDTH'
  | 'HOVER_ROTATE'
  | 'SCULPTING'
  | 'EDITING'
  | 'HEIGHT_EDIT'
  | 'WIDTH_EDIT'
  | 'ROTATING'
  | 'CUTTING'
  | 'TRACKING_LOST'
  | 'COOLDOWN';

const ENGAGED_MODES: ReadonlySet<InteractionMode> = new Set(['SCULPTING', 'EDITING', 'HEIGHT_EDIT', 'WIDTH_EDIT', 'ROTATING', 'CUTTING']);

/** What engaged the current mode: a pinch/grip in a zone, or a blade pose (which needs no zone). */
export type EngageSource = 'PINCH' | 'BLADE';

export interface StateMachineInput {
  /** Is this pointer's hand currently tracked at all this frame? Always true for the mouse pointer while over the viewport. */
  present: boolean;
  /** Pinch means ENGAGE/GRAB/CLUTCH — nothing more specific. For the mouse pointer this is simply "button held down". */
  isPinching: boolean;
  zone: Zone;
  /**
   * Whether the app is in EDIT mode (select+move vertex/edge/face) rather
   * than SCULPT mode (brush strokes). Only changes what a pinch in the MESH
   * zone means — HEIGHT/ROTATE zones behave the same either way, since
   * height and rotation act on the whole object, not the selection.
   */
  editModeActive: boolean;
  /**
   * Debounced blade pose (flat hand, fingers together). Engages on its own,
   * without a pinch and regardless of zone: HORIZONTAL = CUTTING, VERTICAL =
   * ROTATING (palm-yaw), DOWN = HEIGHT_EDIT. Always 'NONE' for the mouse.
   */
  blade: BladePose;
}

/**
 * One instance per pointer (Left hand, Right hand, Mouse). This is the ONLY
 * place that decides what a pointer is doing — no competing if/else chains
 * elsewhere. Two rules make this behave like a real tool instead of a
 * twitchy gesture classifier:
 *
 *  GESTURE LOCKING: once pinch engages a mode from a zone, that mode is
 *  locked until pinch releases — zone changes, pinch-distance wobble, or
 *  brief tracking hiccups mid-grab never retarget SCULPTING to ROTATING etc.
 *
 *  TRACKING LOST: if the hand disappears while engaged, we go to
 *  TRACKING_LOST immediately (no extrapolation) and require an explicit
 *  fresh pinch (release observed, then a new engage) before manipulating
 *  again — a pinch that was merely still being held when tracking resumes
 *  does NOT silently resume the old stroke.
 *
 *  COOLDOWN: releasing out of an engaged mode doesn't drop straight back to
 *  hover — it passes through a brief COOLDOWN window first, during which a
 *  fresh engage is ignored. This is what stops "a slightly-too-slow pinch
 *  release" from being misread as a release-then-immediately-re-engage
 *  (two operations instead of one). Same as TRACKING_LOST, resuming after
 *  COOLDOWN requires an observed release edge, not just "pinch is up now".
 */
export class InteractionStateMachine {
  private mode: InteractionMode = 'IDLE';
  private awaitingRelease = false;
  private cooldownUntil: number | null = null;
  private source: EngageSource = 'PINCH';
  private engagedBlade: BladePose = 'NONE';

  update(input: StateMachineInput, nowMs: number): InteractionMode {
    if (!input.present) {
      // TRACKING_LOST means "this pointer was mid-manipulation and vanished" —
      // only an engaged mode has anything to freeze/lose. A pointer that was
      // merely hovering (or already idle/lost) just goes straight to IDLE.
      // COOLDOWN keeps counting down even through a momentary tracking blip.
      if (ENGAGED_MODES.has(this.mode)) {
        this.awaitingRelease = true;
        this.mode = 'TRACKING_LOST';
      } else if (this.mode !== 'COOLDOWN') {
        this.mode = 'IDLE';
      }
      return this.mode;
    }

    if (this.mode === 'COOLDOWN') {
      if (nowMs < (this.cooldownUntil ?? 0)) return this.mode;
      this.cooldownUntil = null;
      // Timer elapsed — fall through. awaitingRelease is still true from when
      // COOLDOWN started, so the branches below won't re-engage until an
      // actual release-then-press edge is observed, not just "not pinching now".
    }

    const wantsEngage = input.isPinching || input.blade !== 'NONE';

    if (ENGAGED_MODES.has(this.mode)) {
      // LOCKED: only a release can change this, regardless of zone or pinch wobble. A
      // blade-engaged mode releases when THAT blade pose ends, a pinch-engaged one on unpinch.
      const held = this.source === 'BLADE' ? input.blade === this.engagedBlade : input.isPinching;
      if (!held) {
        this.awaitingRelease = true;
        this.cooldownUntil = nowMs + INTERACTION_CONFIG.cooldown.durationMs;
        this.mode = 'COOLDOWN';
      }
      return this.mode;
    }

    if (this.awaitingRelease) {
      if (!wantsEngage) this.awaitingRelease = false;
      this.mode = hoverModeFor(input.zone, input.editModeActive);
      return this.mode;
    }

    if (input.blade !== 'NONE') {
      this.source = 'BLADE';
      this.engagedBlade = input.blade;
      this.mode = input.blade === 'HORIZONTAL' ? 'CUTTING' : input.blade === 'VERTICAL' ? 'ROTATING' : 'HEIGHT_EDIT';
      return this.mode;
    }

    if (input.isPinching) {
      this.source = 'PINCH';
      this.engagedBlade = 'NONE';
      this.mode = engagedModeFor(input.zone, input.editModeActive);
      return this.mode;
    }

    this.mode = hoverModeFor(input.zone, input.editModeActive);
    return this.mode;
  }

  get current(): InteractionMode {
    return this.mode;
  }

  /** What engaged the current (or most recent) engaged mode — main.ts uses it to pick wrist-roll vs palm-yaw rotation. */
  get engageSource(): EngageSource {
    return this.source;
  }

  reset(): void {
    this.mode = 'IDLE';
    this.awaitingRelease = false;
    this.cooldownUntil = null;
    this.source = 'PINCH';
    this.engagedBlade = 'NONE';
  }
}

function engagedModeFor(zone: Zone, editModeActive: boolean): InteractionMode {
  switch (zone) {
    case 'MESH':
      return editModeActive ? 'EDITING' : 'SCULPTING';
    case 'HEIGHT':
      return 'HEIGHT_EDIT';
    case 'WIDTH':
      return 'WIDTH_EDIT';
    case 'ROTATE':
      return 'ROTATING';
  }
}

function hoverModeFor(zone: Zone, editModeActive: boolean): InteractionMode {
  switch (zone) {
    case 'MESH':
      return editModeActive ? 'HOVER_EDIT' : 'HOVER_MESH';
    case 'HEIGHT':
      return 'HOVER_HEIGHT';
    case 'WIDTH':
      return 'HOVER_WIDTH';
    case 'ROTATE':
      return 'HOVER_ROTATE';
  }
}
