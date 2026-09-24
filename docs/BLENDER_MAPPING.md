# Blender → GESTURE_SCULPT mapping

The Blender source (github.com/blender/blender, shallow clone) was used as a
**reference only**. It is not part of this repository: clone it anywhere
outside the project if you need it again. Nothing in this app imports from
it, bundles it, or depends on it at runtime or build time. It exists so we can study how a
mature modeler solves problems and then write our own independent
TypeScript/Three.js implementation — never a port, never a translation of GPL
code.

Concrete things read in the Blender source (`source/blender/`) before writing the code
in this repo (see git history / PR description for the exact commands):

- `bmesh/bmesh_class.hh` — `BMVert`/`BMEdge`/`BMLoop`/`BMFace`. The loop is
  the key idea: it's the "corner" object that carries vert+edge+face
  together, linked via `next/prev` (face cycle) and `radial_next/prev`
  (edge↔face cycle). That's a half-edge mesh.
- `editors/transform/transform.hh` — `TransInfo`, the modal-transform struct.
  Holds `mode`, `TransCon` (axis constraint), `TransSnap`, `prop_size`
  (proportional-editing radius), `center_global` (pivot), `eTState`
  (running/canceled/finished).
- `blenkernel/BKE_modifier.hh` — `ModifierTypeInfo.deform_verts(md, ctx,
  mesh, positions)`: a modifier is a pure function over a position buffer,
  chained functionally. Confirms the modifier stack is just
  `positions = modifiers.reduce((p, m) => m.evaluate(p), basePositions)`.

## Mapping table

| Blender concept | This project |
|---|---|
| `BMesh` (verts/edges/loops/faces) | `modeling/editableMesh.ts` — `EditableMesh` (Phase 2, this PR — adjacency layer over the box's quad grid, not a full BMesh) |
| `TransInfo` modal transform | `interaction/transformEngine.ts` — `TransformEngine` (Phase 1, this PR) |
| Modal operator (`invoke`/`modal`/`confirm`/`cancel`) | `modeling/modelingCommand.ts` — `ModelingCommand` begin/update/commit/cancel (Phase 1, this PR) |
| Operator undo stack | `modeling/commandHistory.ts` — `CommandHistory` (Phase 1, this PR; replaces the old per-feature `sculpt/meshHistory.ts`, since it's a strict superset — same snapshot primitives, plus rotation, plus redo) |
| `ModifierTypeInfo.deform_verts` pipeline | `modeling/modifierStack.ts` — `Modifier.evaluate(mesh)` (Phase 4) |
| Proportional editing (`prop_size` + falloff) | `modeling/editManipulator.ts`'s MOVE operator, via `sculpt/sculptBrush.ts`'s `computeBrushInfluence` (Phase 3, this PR) |
| Vertex/Edge/Face select modes | `modeling/selectionManager.ts` — `SelectionManager` (Phase 2, this PR) |
| Extrude/Inset/Bevel/Subdivide operators | `modeling/meshTopologyOps.ts` — `extrudeFace`/`insetFace`/`bevelEdge`/`subdivideFace` (Phase 3, this PR) |
| Snapping (`TransSnap`) | `SnapEngine` (Phase 5) |
| Principled BSDF | `THREE.MeshPhysicalMaterial` presets (Phase 5) |

## What Phase 1 (this change) actually does

The audit found the exact coupling the brief described: `main.ts`'s render
loop directly wrote `object.group.rotation.y = ...` and called
`deformer.applyHeightDelta(...)` inline, with no seam between "gesture
produced a delta" and "geometry changed". Sculpt strokes already went
through `MeshHistory` snapshots (undo worked), but rotation and height edits
were **not** undoable and had no command boundary at all.

Phase 1 introduces the missing seam without changing observable behavior:

```
gesture delta  →  TransformEngine.rotateY() / translateY()  →  object mutation
gesture delta  →  ModelingCommand (begin/update/commit/cancel)  →  CommandHistory
```

- `TransformEngine` (`interaction/transformEngine.ts`) is the only thing
  that writes to `object.group.rotation` now — main.ts hands it a normalized
  delta, it decides how that maps to the transform.
- `CommandHistory` + `ModelingCommand` (`modeling/commandHistory.ts`,
  `modeling/modelingCommand.ts`) formalize begin/update/commit/cancel and
  give rotation and height edits real undo, which they didn't have before.
  `Cmd/Ctrl+Z` now undoes the *last command of any kind* (sculpt stroke,
  rotation, or height edit), not just sculpt strokes.
- The gesture state machine (`interaction/interactionStateMachine.ts`,
  already existed from the previous iteration) gained a `COOLDOWN` state:
  a brief window after a commit where a fresh engage is ignored, so a
  slightly-too-slow pinch release can't be misread as two operations.

Not touched in this pass (later phases, per the brief's own phase gating):
`EditableMesh`, `SelectionManager`, extrude/bevel/subdivide, the modifier
stack, snapping, PBR material presets.

## What Phase 2 actually does

Adds `EditableMesh` + `SelectionManager` + a new EDIT app mode, without
touching the sculpt pipeline (SCULPT mode is byte-for-byte the same code
path as before).

- **`sculpt/meshTopology.ts`** now also derives `quads: Uint32Array[]` — 4
  vertex indices per box grid-cell face. `THREE.BoxGeometry` always emits
  exactly two triangles per grid cell, in a fixed order, across all six
  sides (verified by reading its `buildPlane` source), and welding preserves
  triangle order — so triangle pair `[6q..6q+5]` of the final index buffer
  is always quad `q`. No separate grid-position math needed; verified with a
  synthetic test (54/96-quad counts, zero degenerate/non-planar quads, Euler
  characteristic V−E+F=2 for the derived adjacency).
- **`modeling/editableMesh.ts`** — `EditableMesh`: adjacency (edges,
  vertex↔face, vertex↔edge) built once from those quads. This is a topology
  *layer* over the SAME position buffer everything else already uses — not
  a parallel mesh with its own copy of positions, and not a full BMesh clone
  (no loops/radial cycles, no non-manifold support). Exposes exactly what
  selection+move needs: `triangleToFace`, `nearestVertexOfFace`,
  `nearestEdgeOfFace`, `verticesFor(element, index)`, `moveVertices`.
- **`modeling/selectionManager.ts`** — `SelectionManager`: OBJECT/VERTEX/
  EDGE/FACE modes. A raycast only ever gives a triangle, so VERTEX/EDGE
  picking resolves as "nearest vertex/edge OF that triangle's face to the
  hit point" (Blender does the same face-assisted resolution for click
  picking) rather than a global nearest-element scan.
- **`modeling/editManipulator.ts`** — `EditManipulator`, one per pointer,
  the EDIT-mode counterpart to `StrokeDeformer`: on engage, resolves +
  selects the target under the hit and captures a `MeshEditCommand`
  before-snapshot; each frame, moves the selection's vertices uniformly by
  the tangential component of the pointer's own frame-to-frame motion (same
  projection math as the GRAB operator); on release, captures the after-
  snapshot and pushes to the SAME `CommandHistory` sculpt strokes use — Edit
  moves are undoable/redoable exactly like a sculpt stroke.
- **`interactionStateMachine.ts`** gained an `EDITING` engaged mode and
  `HOVER_EDIT` hover mode, both reachable only from the MESH zone, chosen
  over `SCULPTING`/`HOVER_MESH` by a new `editModeActive` flag on
  `StateMachineInput` — HEIGHT/ROTATE zones are unaffected by edit mode,
  since those act on the whole object either way. Gesture locking and
  COOLDOWN apply to EDITING exactly as they already did to SCULPTING.
- **UI**: a MODE toggle (SCULPT/EDIT) and, when EDIT is active, a
  VERT/EDGE/FACE/OBJ selection-mode row, added inside the existing
  `04 · FORM_PARAMETERS` block (no panel restructuring — that's Phase 5).
  The viewport overlay draws a crosshair at the cursor plus a square marker
  (hollow while hovering, filled once selected/engaged) at the resolved
  vertex/edge/face, in a distinct color from the round sculpt-brush ring.

Deliberately deferred to Phase 3 per the brief's own phase gating: extrude,
inset, bevel, subdivide, proportional/falloff-based editing, and moving a
selection along its normal (EDIT mode currently only supports tangential
drag — the same restriction GRAB already has).

## What Phase 3 actually does

Every Phase 1/2 module up to this point assumed topology never changes —
only vertex *positions* move (`EditableMesh`'s adjacency was "built once and
stays valid," `MeshEditCommand`'s undo was a fixed-length position snapshot,
`object.topology.heightFraction` was a fixed-length array). Phase 3's real
work was teaching the mesh how to grow, not the four operators themselves.

- **`sculpt/meshTopology.ts`** gained `quadsToIndex`, the inverse of
  `deriveQuads` — regenerates the geometry's triangle index buffer from the
  `quads` array. `quads` is now the single source of truth for topology:
  every operator below only ever appends vertices/faces or reassigns an
  existing face's 4 corner indices, never deletes, so nothing needs index
  compaction and `triangleToFace = floor(i/2)` keeps holding after a growth.
- **`modeling/editableMesh.ts`**: `vertexCount` is now a live getter (was a
  fixed field); `applyTopologyResult(geometry, positions, quads)` is the one
  place a vertex/face-count change actually lands — swaps in a freshly sized
  position `BufferAttribute`, regenerates the index, rebuilds adjacency from
  scratch. Also gained `moveVerticesWeighted` (proportional MOVE) and
  `setVertexPosition` (absolute, not additive — what INSET/BEVEL's live drag
  needs to avoid drift).
- **`modeling/meshTopologyOps.ts`** (new): pure functions — no THREE scene,
  no `EditableMesh`, no undo — each taking a `(positions, quads,
  heightFraction)` snapshot and returning a grown one:
  - `extrudeFace`: duplicates a face's ring in place, reassigns the face to
    the new ring, stitches 4 side quads to the untouched old ring. Never
    opens a hole — every edge keeps exactly 2 adjacent faces.
  - `insetFace`: same shape as extrude, but the new ring is lerped toward
    the face centroid by a fraction instead of duplicated in place.
  - `subdivideFace`: splits one quad into 4 via a new center vertex + 4
    edge-midpoint vertices. Deliberately does not touch neighboring faces —
    can show a visible seam against an unsubdivided neighbor, matching
    Blender's own behavior subdividing a partial face selection.
  - `bevelEdge`: for each of an edge's (normally 2) adjacent faces, offsets
    that face's copy of the edge's endpoints toward the face's own opposite
    corners, then bridges the two new parallel edges with a new quad.
    Degrades to trimming one face (no bridge) if the edge only has one
    neighbor — not expected on this app's watertight base mesh, but a real
    possibility next to a SUBDIVIDE seam. New/moved geometry's winding is
    verified against the source faces' own (known-good) normals rather than
    assumed from the combinatorics — an early version of the bevel bridge
    quad had its winding backwards (invisible under backface culling, not a
    crash) until that check caught it.
- **`modeling/commands.ts`**: new `TopologyEditCommand` — `MeshEditCommand`'s
  fixed-length position snapshot can't undo a vertex/face-*count* change, so
  this captures the full `{positions, quads, heightFraction}` triple before
  and after and replays it through `applyTopologyResult` on undo/redo,
  keeping `heightFraction` in lockstep so a HEIGHT_EDIT after an undo/redo
  never reads past a stale array length (the actual bug this guards against:
  Phase 3's very first version left `heightFraction` fixed-length, which
  would have injected `NaN` into every new vertex on the next height edit).
- **`modeling/editManipulator.ts`**: engage now dispatches on the selected
  `EditOperator`. For the four topology operators the mesh surgery runs
  ONCE, immediately, on engage (not on drag) and the selection retargets to
  whatever the operator just created; the drag that follows only adjusts an
  *amount* — EXTRUDE pushes along the face normal captured at engage (normal-
  only, like INFLATE), INSET/BEVEL recompute their fraction absolutely each
  frame from a fixed anchor (not additive, to avoid drift), SUBDIVIDE is
  one-shot. MOVE itself gained the two literal Phase 3 asks: a normal
  component (from the same depth signal INFLATE uses) combined with the
  existing tangential drag, and, opt-in via a nonzero falloff radius, a
  proportional move using `sculptBrush.ts`'s `computeBrushInfluence` around
  the selection center — 0 falloff reproduces the exact pre-Phase-3 behavior.
- **Mouse fallback**: ALT+drag now feeds `depthDelta` (previously always 0
  for the mouse — `HandProjector.projectMouse` was a dead stub). Freezes the
  raycast cursor for the duration (so the tangential component that a normal
  mouse drag would otherwise also inject stays ~0) and maps vertical
  movement to depth, driving INFLATE/DEFLATE too, not just Phase 3's new
  operators.
- **UI**: an EDIT_OPERATOR row (MOVE/EXTRUDE/INSET/BEVEL/SUBDIVIDE) next to
  the existing selection-mode row, with EXTRUDE/INSET/SUBDIVIDE disabled
  outside FACE selection and BEVEL disabled outside EDGE selection (same
  disabling mechanism already used for SCULPT-only controls in EDIT mode);
  and a FALLOFF_RADIUS slider for MOVE's proportional editing.

Not touched: multi-element selection (still exactly one vertex/edge/face at
a time, per `SelectionManager`'s existing constraint), and the panel
restructuring / snapping / PBR presets still deferred to Phase 5.

## What Phase 4 actually does

Driven by the GESTURE_RECORDER built at the end of Phase 3: the user
recorded real attempts at several gestures and worked out, session by
session, what each one should physically look like and produce. See
`docs/GESTURE_GUIDE.md` for the resulting gesture log — this section is
about the implementation.

**HEIGHT zone bug** (the reason this phase started): `interaction/
spatialContext.ts`'s `classifyZone` checked `if (hit) return MESH` before
checking proximity to the top zone. `topZoneNdc` is the screen projection of
`(0, box.max.y, 0)` — the center of the object's own top FACE, i.e. a point
ON the mesh. Reaching for "the top of the object" therefore reliably
raycasts onto the mesh itself, so the HEIGHT branch was checked only after
MESH had already claimed it — HEIGHT was effectively unreachable. Recorded
sessions that explicitly attempted a height gesture and got zero
`HEIGHT_EDIT` episodes confirmed it. Fixed by checking top-zone proximity
FIRST; the cost is a `topZoneRadius` ring at the top of the object where
sculpting is no longer reachable (HEIGHT wins there instead) — an
intentional trade the radius already implied.

**PINCH vs GRIP** ("pegada grande"): `tracking/landmarkUtils.ts` gained
`gripDistanceOf` (average thumb-to-{middle,ring,pinky} tip distance,
deliberately excluding index, the pinch pair), populated into `HandState` as
`gripNormalized` the same way `pinchNormalized` already was. New
`gestures/gestureClassifier.ts` replaces the old binary `PinchDetector`
(deleted): classifies each hand per frame as `NONE`/`PINCH`/`GRIP`, same
two-threshold hysteresis + confirm-frames debounce shape, generalized to
three mutually-exclusive states — GRIP wins on `gripNormalized` alone (a
real grasp closes index+thumb too, so `pinchNormalized` doesn't need
checking); PINCH additionally requires `gripNormalized` to stay above
`grip.separationRatio` (the other fingers still spread), which is what
keeps a real grip from also reading as a pinch. Both still mean ENGAGE for
`InteractionStateMachine` — only the SCULPTING dispatch in `main.ts` reads
the gesture type, to route to `StrokeDeformer.updateGrip` instead of
`update`.

**GRIP → region scale-from-center**: `MeshDeformer.applyRadialScale` (new,
sibling to `applyConvergence` — same per-vertex-computed-direction shape,
just relative to a point instead of an axis line) pushes each vertex along
its own direction from the object's local-space origin. `StrokeDeformer.
updateGrip` (new, not a `SculptOperator` — this is gesture-selected, not
panel-selected) decomposes the stroke's frame-to-frame travel into a
component toward/away from that origin (drives `applyRadialScale` — grows
the region moving away, shrinks it moving closer) and a tangential
remainder (drives the existing `applyDisplacement`, so a diagonal pull does
both at once). Uses a wider `grip.brushRadius` than a pinch stroke — "pegada
grande" grabs more.

**SMOOTH operator** ("curva"): `MeshDeformer.applySmoothing` (new) blends
each influenced vertex toward the average position of the OTHER influenced
vertices in the same brush stamp — the stamp's own influence set doubles as
a cheap local neighborhood, avoiding `meshSmoothing.ts`'s real (but
expensive to rebuild every frame) triangle-adjacency Laplacian pass. Added
as a fourth `SculptOperator`, selected via the OPERATOR row exactly like
GRAB/INFLATE/CREASE — the "curved hand motion" the user described is simply
what using a rounding brush looks like; this phase didn't build separate
stroke-curvature detection to auto-select it.

**BEVEL: trace-distance instead of depth**: previously BEVEL's fraction (how
much it rounds) was driven by push/pull depth, same as INSET. Per the user's
description ("arredondar bordas" should visibly grow as the hand traces
along the edge), `EditManipulator.updateBevel` now tracks the edge-tangent
component of the stroke's own motion instead — the first frame of real
tangential motion after engage fixes a reference direction
(`bevelState.traceDir`), and every subsequent frame's signed projection onto
that direction accumulates into the fraction, so continuing that way grows
it and backtracking shrinks it (the same live, reversible feel every other
drag-to-adjust operator already has). INSET is untouched (still depth-
driven) — the user only asked to change BEVEL.

**Wider EDGE picking**: `nearestEdgeOfFace` only ever considered the 4 edges
of whichever face the raycast happened to land on — a cursor a little off
the intended face couldn't reach an edge on the neighbor. New `EditableMesh.
nearestEdgeNear(point, radius)` scans every edge in the mesh within `radius`
and returns the closest, falling back to `nearestEdgeOfFace` if nothing is
in range (so EDGE selection still always resolves to *something*, same
guarantee as before). `SelectionManager` uses it for EDGE mode with a new
`edit.edgePickRadius` — ~20% more forgiving than the implicit per-face
tolerance, per the user's direct ask after testing.

Deferred to its own future phase (confirmed with the user, given the size):
**`cortar forma`** — cutting the object into two genuinely independent,
separately-transformable pieces. Needs the app to support more than one
object, which today's `SculptableObject`/raycasting/undo/export/
`EditableMesh` all assume is exactly one. See `docs/GESTURE_GUIDE.md`'s
Deferred section for the full gesture description.

## Phase 4 fixes (from live testing)

Live testing (real hands, not the mouse fallback) surfaced two real bugs in
the above and one more gesture, all fixed in the same phase:

- **GestureClassifier's dead zone**: the first version required PINCH to
  additionally hold `gripNormalized` above a `grip.separationRatio` (the
  other fingers "still spread") to rule out a grip. In practice an ordinary
  pinch's resting fingers are often only partly spread — landing
  `gripNormalized` in the gap between that threshold and GRIP's own
  `startRatio` satisfied neither condition, so the gesture silently
  resolved to `NONE`. Since ROTATE/SCULPT/EDIT/HEIGHT all still run on
  plain PINCH, this broke ordinary use broadly, not just GRIP itself (the
  user's report: rotating the hand no longer rotated the object at all).
  Fixed by dropping the separation requirement entirely — PINCH is
  evaluated purely on `pinchNormalized`, exactly like the pre-Phase-4
  `PinchDetector` did — and instead making GRIP's own `startRatio` tight
  enough on its own to not fire during an ordinary pinch. Also made GRIP's
  *release* an OR of both signals opening (previously only
  `gripNormalized`), since relying on one noisy metric alone was leaving
  GRIP stuck engaged after the hand had visibly opened (the user's other
  report: the sculpture kept deforming after releasing pegada grande).
- **WIDTH** (new zone/gesture — "aumentar/diminuir as paredes laterais"):
  the X/Z counterpart to HEIGHT, but deliberately triggered by hand
  ORIENTATION rather than position. A position-based zone (mirroring
  HEIGHT's "near the top point") doesn't work for the sides — unlike the
  top, "near the side" is already deep inside normal MESH-zone territory
  (touching the side to sculpt or grip), so it would constantly fight those
  interactions — this was the user's own diagnosis. `tracking/
  landmarkUtils.ts` gained `isHandHorizontal` (wrist->middle-knuckle vector
  more horizontal than vertical in image space, stateless per-frame, no
  calibration constant), stored on `HandState.isHorizontal`.
  `spatialContext.ts`'s `classifyZone` checks it FIRST, before HEIGHT and
  the mesh hit — mouse pointer excluded (no fingers to orient), so WIDTH is
  hand-only. New `interaction/widthInterpreter.ts` (`WidthManipulator`)
  mirrors `HeightManipulator` exactly, but tracks NDC distance from the
  object's own projected center (new `computeCenterNdc` in `main.ts`,
  alongside the existing `computeTopZoneNdc`) instead of raw NDC-Y — moving
  away from center grows the distance (grows the object), moving closer
  shrinks it. New `MeshDeformer.applyWidthDelta` scales every vertex's X/Z
  by `(1 + deltaScale)` around the origin (Y untouched) — multiplicative,
  unlike height's additive model, since there's no "side" to anchor against
  the way height anchors at the base; defensively clamped so one
  pathological frame can't flip the footprint through zero and invert it.
  New `InteractionMode`s `WIDTH_EDIT`/`HOVER_WIDTH`, `Zone` value `WIDTH`,
  wired through `InteractionStateMachine` exactly like `HEIGHT`/`HEIGHT_EDIT`.
