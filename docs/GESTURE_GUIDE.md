# Gesture → Result Guide

The goal of this doc: for every physical hand gesture the app recognizes,
know exactly what result it produces. The app can tell you precisely what
interaction result came out of a gesture (mode, operator, selection,
duration) — it has no idea what the hand physically did to produce it. That
half only the person performing the gesture can supply. This doc is where
the two get joined.

## Workflow

1. `npm run dev`, open the app, ativar câmera.
2. Left panel → **03 · GESTURE_RECORDER** → click **● REC**.
3. Perform ONE gesture (engage → hold/move → release), then pause. A new
   numbered row appears in the recorder log the moment you release —
   `#N [Pointer] <result detail> (<duration>ms)`.
4. Either:
   - narrate it right after it happens (open this file, add a row: episode
     #N → description of what your hand just did), or
   - keep going through a whole batch of gestures, click **■ STOP**, then
     **EXPORT MD** (downloads `gesture-session.md` — one row per episode,
     `Gesture` column blank) or **EXPORT JSON** (same data, machine-
     readable) and fill in the physical description per row afterward.
5. Fold finished rows into the table at the bottom of this file. **LIMPAR**
   clears the recorder's buffer between sessions (doesn't touch this file).

Only complete engage→release cycles are recorded — the recorder segments on
the exact same begin/end edges the interaction state machine already uses
(see `interaction/interactionStateMachine.ts`), one episode per pointer per
cycle, multiple pointers (both hands + mouse) can be open at once.

## Reference: what a "result detail" string means

**Zone** (where the pinch lands — decided before the pinch, see
`interaction/spatialContext.ts`):

| Zone | How it's triggered |
|---|---|
| `WIDTH` | The hand is held horizontally (checked first, regardless of position — see below). Hand-only, not reachable with the mouse. |
| `MESH` | The pointer's ray is currently hitting the sculpt object's surface. |
| `HEIGHT` | No mesh hit, but the pointer is near the object's projected top point. |
| `ROTATE` | Anywhere else off the piece — the fallback zone. |

**Mode / result detail** (what a pinch in each zone does, and the
`<result detail>` string the recorder logs for it):

| Mode | Zone | Result detail format | Meaning |
|---|---|---|---|
| `SCULPTING` | MESH, SCULPT app-mode | `SCULPT · GRAB` / `INFLATE_DEFLATE` / `CREASE` / `SMOOTH` / `GRIP` | Brush stroke. GRAB = tangential drag, INFLATE_DEFLATE = push/pull along the surface normal (depth), CREASE = drag + converge toward a point/ridge, SMOOTH = rounds off whatever's under the brush ("curva", Phase 4). GRIP is different from the other four: it's not an OPERATOR-row choice, it's what happens automatically when the *gesture itself* is a full 5-finger grip instead of an index+thumb pinch ("pegada grande", Phase 4) — see the PINCH vs GRIP row below. |
| `EDITING` | MESH, EDIT app-mode | `EDIT · <operator> · sel=<VERTEX/EDGE/FACE/OBJECT>[· falloff=N]` | Select+act on the current selection element. operator = MOVE / EXTRUDE / INSET / BEVEL / SUBDIVIDE (see docs/BLENDER_MAPPING.md Phase 3). `falloff=N` appears only when MOVE's proportional-editing radius is >0. |
| `HEIGHT_EDIT` | HEIGHT | `HEIGHT_EDIT` | Stretches/compresses the object from its base along Y. |
| `WIDTH_EDIT` | WIDTH | `WIDTH_EDIT` | Scales the object's whole X/Z footprint around its own center. |
| `ROTATING` | ROTATE | `ROTATE · Δ=N°` | Spins the object around Y by N degrees (wrist roll). |
| `ROTATING` | any (vertical blade) | `ROTATE · palma · Δ=N°` | Spins the object around Y following the flat upright palm turning around its own vertical axis. |
| `HEIGHT_EDIT` | any ("beak" down) | `HEIGHT_EDIT` | Same height stretch, engaged by the pull-from-above pose instead of a pinch. |
| `CUTTING` | any (horizontal blade) | `CUT` / `CUT · incompleto` | Splits the object along the hand's path once the sweep crosses ≥80% of its width. |

**Hand poses** (`tracking/landmarkUtils.ts` `bladePoseOf`, debounced by
`gestures/bladeDetector.ts`): four fingers extended and held together.
The finger direction (knuckle→tip) picks the tool, and a pose engages on
its own, with no pinch and in any zone:

| Pose | Fingers point | Engages |
|---|---|---|
| `HORIZONTAL` blade | sideways, palm down, thumb away | `CUTTING` |
| `VERTICAL` blade | up, thumb away | `ROTATING` (palm yaw) |
| `DOWN` "beak" | down, thumb on the fingertips | `HEIGHT_EDIT` (overrides the pinch detector, which flickers on this pose) |

Thresholds were checked by running MediaPipe on the recorded reference
videos (`gestures-ref/`, gitignored).

**PINCH vs GRIP** (Phase 4 — see `gestures/gestureClassifier.ts`): every ENGAGE used to mean one gesture (index+thumb pinch). Now a real hand is classified as one of `PINCH` (index+thumb close — no condition on the other fingers, same as before Phase 4) or `GRIP` (all four non-thumb fingers tightly converged — a real full grasp), mutually exclusive, GRIP checked first. Both still count as ENGAGE for zone purposes; the gesture type only changes what happens once SCULPTING starts (GRIP = the region scale-from-center below; every other mode/zone treats PINCH and GRIP identically). Mouse has no fingers, so it's always PINCH.

**Pointer**: `Left` / `Right` (real hand landmarks) or `Mouse` (fallback —
button-down = pinch, never grip; ALT+drag maps vertical mouse movement to
the "depth" signal INFLATE/DEFLATE, EXTRUDE and INSET's amount use, since
the mouse has no Z channel of its own — BEVEL no longer uses depth, see the
table below).

## Gesture log

Fill in as sessions are recorded — one row per distinct *gesture*, not
necessarily one row per raw episode (multiple episodes of the same physical
gesture should collapse into one row once the mapping is confirmed).

| Gesture (physical description) | Zone | Mode / operator | Result | Notes |
|---|---|---|---|---|
| Wrist roll, hand outside the object | ROTATE | `ROTATING` | Spins the object around Y. | Was broken by a GestureClassifier dead zone (see Phase 4 fixes in `docs/BLENDER_MAPPING.md`) — fixed, needs re-confirming live. |
| Hand near the object's top, drag up/down | HEIGHT | `HEIGHT_EDIT` | Stretches/compresses the object from the base. | Was unreachable before this phase (HEIGHT zone bug) — fixed, needs re-confirming live. |
| Hand held horizontally, drag away from / toward the object's center | WIDTH | `WIDTH_EDIT` | Scales the object's X/Z footprint out/in around its center. | New — orientation-based, not position-based, specifically to avoid overlapping with touch/grip on the sides (the user's own diagnosis of why copying HEIGHT's mechanism wouldn't work here). Needs live confirmation. |
| 5-finger grip ("pegada grande" — all 4 non-thumb fingers pinch against the thumb, not just index) on the mesh, hand moves away from the object's center | MESH | `SCULPTING` · `GRIP` | The gripped region grows outward. | Was getting stuck engaged after release (GestureClassifier bug) — fixed, needs re-confirming live. |
| Same grip, hand moves toward the object's center | MESH | `SCULPTING` · `GRIP` | The gripped region shrinks inward. | |
| Same grip, diagonal motion | MESH | `SCULPTING` · `GRIP` | Region follows the hand directly (not purely radial). | |
| Curved hand trace along an edge | MESH, EDIT mode, EDGE selection | `EDITING` · `BEVEL` | Rounds that edge; amount grows the farther the hand traces along it, shrinks on backtrack. | Edge picking is intentionally forgiving (~20% wider than a plain per-face pick) since a curved trace won't land pixel-perfect on the edge line. Reported as "not possible" — most likely the same GestureClassifier dead zone that broke ROTATE (ENGAGE itself wasn't firing), now fixed; needs re-confirming live. |
| Curved hand trace anywhere on the surface | MESH, SCULPT mode, `SMOOTH` operator selected | `SCULPTING` · `SMOOTH` | Rounds off whatever's under the brush, live. | Selected via the OPERATOR row like GRAB/INFLATE/CREASE, not auto-detected from the trace shape — flagged as a scope simplification. Also likely affected by the same dead-zone bug; needs re-confirming live, and confirming whether manual operator selection is acceptable or auto-detection is actually needed. |

| Flat hand, fingers together and pointing down ("beak", thumb on the fingertips), raised above the head and pulled up | any | `HEIGHT_EDIT` (DOWN pose) | Object grows taller from the base. | Reference: `Movie on 24-09-26 at 08.57 #2.mov`. Used to land in WIDTH: the bent wrist makes wrist→knuckle read horizontal, and the pinch distance flickered 0.16–0.97 mid-pull. Now a pose of its own, confirmed across the whole recorded pull. |
| Flat upright hand, fingers together, turning around its vertical axis (palm → edge → back of hand) | any | `ROTATING` (VERTICAL blade) | Object turns around Y with the palm. | Reference: `Movie on 24-09-26 at 08.57 #3.mov`. Accumulates frame-to-frame yaw, so turns past 180° don't wrap. The ~0.4s edge-on stretch (ring/pinky occluded) is bridged by `blade.releaseFrames`. Direction untested live: flip `rotation.palmYawSensitivity` if it feels mirrored. |
| Flat horizontal hand, palm down, fingers together, swept across the object | any | `CUTTING` (HORIZONTAL blade) | Object splits along the hand's path. The lower piece stays sculptable and the upper one is lifted off as a separate piece. Undoable. | Reference: `Movie on 24-09-26 at 08.57.mov`. See **Cut** below. |

## Cut

The implementation lives in `interaction/cutController.ts` and `sculpt/meshCutter.ts`.
While `CUTTING`, the palm center is projected onto a vertical plane
through the object facing the camera. Samples inside the object's height
are binned along the sweep into a cut-height curve, so a tilted or wavy
sweep cuts along that path. Each piece is the full mesh with its vertices
clamped to its side of that surface. Both pieces stay watertight and keep
the quad topology, and only the lower one stays sculptable. The upper piece
is a child of the object group: it rotates with the object and shares its
materials. It is not yet independently movable, sculptable or exported,
and there is no follow-up "push" gesture yet. The sweep survives MediaPipe
dropping the blurred hand for up to `blade.trackingGraceMs`.
