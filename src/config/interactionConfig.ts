/**
 * Single source of truth for every interaction/sculpt tuning parameter.
 * Nothing in tracking/interaction/sculpt should hard-code a magic number.
 */
export const INTERACTION_CONFIG = {
  tracking: {
    maxHands: 2,
    minConfidence: 0.6,
  },

  /** Raw-landmark smoothing (removes MediaPipe jitter). Kept separate from mesh smoothing (there is none automatic). */
  smoothing: {
    landmarkFactor: 0.35,
  },

  featureSmoothing: {
    velocityFactor: 0.25,
  },

  /**
   * Pinch means exactly one thing everywhere: ENGAGE/GRAB/CLUTCH. It no
   * longer has separate open/mid/tight bands meaning sculpt/zoom/height —
   * WHERE the pinch happens (see SpatialContext) decides what gets grabbed.
   * Distances are normalized by the hand's own width (indexMCP-pinkyMCP), not
   * raw image-space distance, so pinch recognition holds up whether the user
   * is close to or far from the webcam.
   */
  pinch: {
    /** Normalized (pinch distance / hand width) ratio that STARTS an engage. */
    startRatio: 0.35,
    /** Must open back past this ratio to END an engage (hysteresis band). */
    releaseRatio: 0.5,
    /** Consecutive frames a pinch candidate must hold before flipping state, to reject 1-frame noise. */
    confirmFrames: 3,
  },

  /**
   * GRIP: the "pegada grande" gesture (Phase 4) — all four non-thumb
   * fingertips converged toward the thumb, as opposed to PINCH (index+thumb
   * only). `startRatio` is deliberately TIGHTER than `pinch.startRatio`
   * (0.35) — GRIP is checked first and requires gripNormalized alone to
   * cross it, with no condition on pinchNormalized, so it must demand a
   * clearly more-closed hand than an ordinary pinch's resting fingers ever
   * produce, or every pinch would misread as a grip. See
   * gestures/gestureClassifier.ts for why PINCH itself has no matching
   * condition on gripNormalized (a `separationRatio` gate used to be here;
   * it created a dead zone that broke ordinary pinches).
   */
  grip: {
    startRatio: 0.25,
    releaseRatio: 0.4,
    confirmFrames: 3,

    /** "pegada grande" grabs a WIDER region than a pinch stroke — see sculpt.brushRadius. */
    brushRadius: 0.55,
    /** How strongly the radial (toward/away from the object's center) component of hand motion grows/shrinks the gripped region. */
    radialSensitivity: 1,
    /** How strongly the leftover tangential component (the part of the motion NOT toward/away from center) drags the region — "diagonal motion is followed directly". */
    tangentialSensitivity: 1,
  },

  geometry: {
    /** Segments per axis on the sculptable box at startup. Locked once the first stroke is applied — see UI note. */
    defaultSubdivisions: 16,
    minSubdivisions: 8,
    maxSubdivisions: 40,
  },

  sculpt: {
    /** World-space radius of influence around the touched surface point. */
    brushRadius: 0.35,
    minBrushRadius: 0.08,
    maxBrushRadius: 0.9,

    /** Overall multiplier on displacement magnitude. */
    brushStrength: 1,
    minBrushStrength: 0.2,
    maxBrushStrength: 3,

    /**
     * HARDNESS (0 soft .. 1 hard) is the user-facing control — it's what the
     * old raw "FALLOFF" slider becomes. Internally it still drives a falloff
     * exponent (soft = broad/gentle, hard = concentrated/abrupt), plus a
     * slight radius concentration at the hard end, since a hard tool should
     * feel narrower as well as steeper.
     */
    hardnessMinFalloff: 1.2,
    hardnessMaxFalloff: 5,
    hardnessMinRadiusMultiplier: 1,
    hardnessMaxRadiusMultiplier: 0.65,

    /** Below this world-space speed, a stroke sample is treated as noise, not intent (velocity dead zone). */
    minStrokeVelocity: 0.015,

    /** MediaPipe Z depth motion -> displacement along the surface normal (INFLATE/DEFLATE operator). */
    depthSensitivity: 1.6,
    depthDeadzone: 0.006,
    /** Mouse has no Z channel — INFLATE/DEFLATE maps vertical mouse drag to depth instead, at this sensitivity. */
    mouseDepthSensitivity: 1.2,

    /** GRAB operator (tangential-only drag) sensitivity. */
    lateralSensitivity: 1,

    /** CREASE operator: how strongly nearby vertices converge toward the touch axis per second, while held. */
    creaseStrength: 0.9,

    /** How much a sharp turn in the stroke narrows the brush and boosts strength (0 = no effect, 1 = full effect). Continuous, not a shape classifier. */
    sharpnessSensitivity: 0.7,
    /** Turning rate (rad/sec) at which sharpness saturates to 1. */
    sharpnessReferenceRate: 14,

    /** Per-frame vertex displacement clamp, to keep a single bad frame from spiking the mesh. */
    maxVertexDisplacement: 0.05,

    /** How long (ms) a raycast can miss mid-stroke before the NEXT hit is treated as a fresh stroke start (no jump delta). */
    strokeContinuityGraceMs: 120,

    /** Stroke interpolation: a fast stroke gets sub-stamped every `brushRadius * strokeSpacingFactor` world units instead of jumping. */
    strokeSpacingFactor: 0.22,
    maxStrokeSubsteps: 12,

    /** Two-segment gain curve on stroke movement: fine control near zero, moderate (not runaway) gain past the threshold. */
    gainFineThreshold: 0.01,
    gainFine: 0.6,
    gainCoarse: 1.15,
  },

  /**
   * EDIT-mode operators (Phase 3 — see docs/BLENDER_MAPPING.md). Deliberately
   * separate from `sculpt.*`: a select+move/extrude/inset/bevel tool should
   * feel more deliberate/precise than a brush stroke, not share its tuning.
   */
  edit: {
    /** MOVE proportional falloff radius (world units) — 0 disables it and reproduces the pre-Phase-3 exact-selection-only behavior. */
    falloffRadius: 0,
    minFalloffRadius: 0,
    maxFalloffRadius: 0.6,
    falloffExponent: 2,

    /** MediaPipe Z depth motion -> displacement along the selection's normal (MOVE's normal component, and EXTRUDE's push distance). */
    normalSensitivity: 1.2,
    depthDeadzone: 0.006,

    /** INSET/BEVEL amount (0..1 fraction of the face/edge's own size) driven by accumulated depth motion, absolutely recomputed each frame (not additive, to avoid drift). */
    insetFractionDefault: 0.15,
    insetFractionMin: 0.02,
    insetFractionMax: 0.9,
    bevelFractionDefault: 0.15,
    bevelFractionMin: 0.02,
    bevelFractionMax: 0.45,
    /** How fast accumulated depth motion moves the INSET fraction (BEVEL no longer uses depth — see bevelTraceSensitivity). */
    fractionDepthSensitivity: 0.8,
    /** BEVEL's amount instead tracks how far the hand has traced tangentially along the edge since engage (Phase 4) — this converts that accumulated world-space distance into fraction. */
    bevelTraceSensitivity: 1.2,

    /** Per-frame vertex displacement clamp for EXTRUDE's push (same idea as sculpt.maxVertexDisplacement). */
    maxVertexDisplacement: 0.05,

    /** EDGE-mode picking (Phase 4): scans every edge within this radius of the hit point, not just the 4 edges of whichever face the raycast happened to land on — ~20% more forgiving than the plain per-face pick it falls back to. See EditableMesh.nearestEdgeNear. */
    edgePickRadius: 0.12,
  },

  /**
   * BLADE: flat hand, four fingers extended and held together (see
   * landmarkUtils.bladePoseOf). HORIZONTAL = cut, VERTICAL = rotate, DOWN =
   * height pull. Ratios are 3D and normalized by the index-to-pinky knuckle
   * width. Thresholds were checked against MediaPipe runs on the recorded
   * reference videos (gestures-ref/).
   */
  blade: {
    /** A finger counts as extended when wrist->tip is at least this multiple of wrist->PIP. */
    extendRatio: 1.1,
    /** Index-tip-to-pinky-tip distance / knuckle width must stay BELOW this (fingers together, not spread). */
    togetherRatio: 1.5,
    /** Thumb-tip-to-index-tip distance / knuckle width must stay ABOVE this (not a pinch). */
    minThumbGapRatio: 0.5,
    /** How much one image axis must dominate the other (wrist->middle knuckle) to call the hand horizontal/vertical. */
    orientationDominance: 1.2,
    /**
     * Consecutive frames HORIZONTAL/VERTICAL must hold before engaging — long enough that a hand
     * briefly passing through an upright flat pose (e.g. rising to do the height gesture) doesn't
     * start a rotation. Measured on the reference videos: those transients last ~4 frames at 30fps.
     */
    confirmFrames: 9,
    /** DOWN ("beak" height pull) is unambiguous and has to win the race against the ordinary pinch detector (3 frames), so it confirms faster. */
    downConfirmFrames: 3,
    /** HORIZONTAL (cut) is a fast sweep — at 9 frames the reference sweep was already over before it confirmed. */
    horizontalConfirmFrames: 4,
    /**
     * A fast sweep blurs the hand and MediaPipe drops it for a few frames (up to ~330ms in the
     * reference video). A blade-engaged mode survives a loss this short instead of going to
     * TRACKING_LOST, and the pose debounce isn't reset by it.
     */
    trackingGraceMs: 400,
    /**
     * Consecutive frames the pose must be LOST before it releases. In the rotate reference video the
     * back of the hand turns edge-on for ~0.4s and ring/pinky get occluded — this must bridge that.
     */
    releaseFrames: 16,
  },

  cut: {
    /** Fraction of the object's width (along the screen-horizontal axis) the blade must sweep across for the cut to happen. */
    sweepCoverage: 0.8,
    /** The cut height is kept at least this fraction of the object's height away from its bottom/top, so neither piece is degenerate. */
    edgeMargin: 0.06,
    /** Bins the hand's path is averaged into along the sweep — more bins = the cut follows the hand more closely, but noisier. */
    pathBins: 16,
    /** How far (object-local units) the upper piece is lifted off the lower one after the cut, so the split is visible. */
    separationGap: 0.12,
  },

  strokeHistory: {
    windowMs: 500,
    maxSamples: 40,
  },

  rotation: {
    sensitivity: 1,
    /** Radians of wrist-roll delta ignored before rotation starts applying (dead zone). */
    deadZone: 0.02,
    /** Vertical-blade rotation: object turns this many radians per radian the palm turns. Flip the sign if it feels mirrored. */
    palmYawSensitivity: 1,
    /** Radians of accumulated palm yaw ignored before vertical-blade rotation applies. */
    palmYawDeadZone: 0.06,
  },

  height: {
    sensitivity: 1.4,
    /** NDC-Y movement ignored before it changes height (dead zone). */
    deadZone: 0.01,
    /** How close (NDC units) the cursor must be to the object's projected top point to count as the height zone. */
    topZoneRadius: 0.18,
    minHeightFraction: 0.35,
    maxHeightFraction: 2.5,
  },

  /**
   * WIDTH: the X/Z counterpart to `height` (Phase 4) — triggered by hand
   * ORIENTATION (see spatialContext.ts) rather than position, so it has no
   * `topZoneRadius`-style proximity threshold to tune. `sensitivity` maps
   * NDC-distance-from-the-object's-center delta to a scale delta, same
   * shape as `height.sensitivity` mapping NDC-Y delta.
   */
  width: {
    sensitivity: 1.4,
    /** NDC-distance-from-center movement ignored before it changes width (dead zone). */
    deadZone: 0.01,
  },

  trackingLost: {
    /** A pointer with no hand data for longer than this is considered lost (kept short — freezing immediately is the point). */
    timeoutMs: 60,
  },

  cooldown: {
    /** How long (ms) after releasing an engaged mode before a fresh engage is even considered — absorbs a slightly-too-slow release so it isn't misread as two operations. */
    durationMs: 150,
  },
} as const;
