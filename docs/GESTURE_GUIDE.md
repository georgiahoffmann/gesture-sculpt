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

See **Deferred** below for `cortar forma` (object cut/split), which this
phase intentionally does not implement.

## Deferred

**`cortar forma`** (cut shape): a flat, straight-fingered hand swiping a
horizontal or vertical line across the object should cut it there; a
follow-up "push" gesture should then drag the cut-off piece away from or
back into the rest, as a genuinely separate, independently transformable
piece — confirmed with the user as the real split, not a connected-mesh
visual approximation. Not built in Phase 4: the whole app currently assumes
exactly one `SculptableObject` (raycasting, undo, export, `EditableMesh` all
built around a singleton) — supporting a second independently-movable piece
needs that assumption unwound first (multiple objects in the scene, per-
object selection/raycasting, a real mesh-bisect algorithm that partitions
triangles crossing the cut plane). Sized similarly to, or larger than, the
entire rest of this phase — needs its own phase.

Recorded reference (`Screen Recording 2026-09-16 at 17.54.56.mov`, screen
capture, no camera view of the hand itself — read from the app's own
state/overlay readouts frame-by-frame, no video playback available in this
environment): the demonstrated motion is (1) hand reaches toward the object
with fingers spread (briefly registers `HOVER · MESH`), (2) hand flattens —
fingers straight and together, held roughly horizontal near shoulder/head
height — and sweeps across in front of the object at around its vertical
midpoint, (3) hand continues moving away to the side, fingers no longer
flat (`HOVER · ROTATE ZONE`). Matches the user's own description: straight/
flat fingers, horizontal orientation, traced across the object.

**Conflict to resolve when this gets built**: step (2) of that exact
motion — hand flattened to horizontal, in front of the object — is now
*also* exactly what triggers Phase 4's WIDTH zone (`isHandHorizontal` in
`tracking/landmarkUtils.ts`), confirmed by this same recording: the app
(already running Phase 4 at capture time) read that segment as
`HOVER · WIDTH ZONE`. A flat horizontal hand alone can't disambiguate
"resize width" from "cut" — whatever implements `cortar forma` will need a
second signal on top of orientation, e.g. the hand's MOTION (a fast lateral
swipe vs. a held approach/retreat from center), position (near the object's
silhouette vs. hovering at its center), or a distinct hand shape (fingers
fully together/blade-like vs. just "flatter than usual"). Not resolved
here — flagging it now so it isn't rediscovered the hard way later.
