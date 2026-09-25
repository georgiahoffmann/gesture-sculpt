# Gesture Sculpt

Hand-tracked 3D sculpting in the browser. Shape a mesh with your hands in front of a webcam: pinch to sculpt, pull to stretch, slice, round, rotate and zoom, with no controller and no install.

**Live demo:** https://gesture-sculpt.vercel.app

Built with [Three.js](https://threejs.org) and [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker), written in TypeScript and bundled with Vite.

## Gestures

| Gesture | Result |
|---|---|
| Pinch on the surface and drag | Sculpt (grab / inflate / crease / smooth, chosen in the panel) |
| Full-hand grip on the surface | Grow or shrink the gripped region |
| "Beak" pointing down, pulled up | Change height |
| "Beak" pointing sideways, pulled out | Change width |
| Flat upright hand, turning the palm | Rotate the object (continuous while you keep turning) |
| Flat palm-down hand, rocking | Tilt the view to see top / bottom faces |
| Flat palm-down hand swept across | Cut the form along the hand's path |
| Flat hand arcing from horizontal to vertical | Round the nearest corner |
| Both hands cupped around the form | Round the whole form |
| Index + thumb opening into an "L" | Zoom in |
| Thumb + index + middle closing | Zoom out |
| Closed index + thumb moving toward the form | Push vertices back in |

The mouse works too: drag to sculpt, <kbd>Shift</kbd>+drag to orbit, scroll to zoom, <kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd> to undo.

See [docs/GESTURE_GUIDE.md](docs/GESTURE_GUIDE.md) for how each gesture is detected and tuned.

## Getting started

Requires Node.js 18+ and a webcam. The browser must allow camera access, which requires `localhost` or HTTPS.

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check only |

## Project structure

```
src/
├── main.ts          App wiring and the render/interaction loop
├── config/          Every tuning threshold in one place (interactionConfig.ts)
├── tracking/        Webcam + MediaPipe → normalized hand state and poses
├── gestures/        Pinch/grip classification, pose debouncing, rotation, two-hand round
├── interaction/     State machine, zones, and the gesture tools (cut, blade, curl, height, width)
├── sculpt/          Mesh deformation: brushes, smoothing, cutting, rounding
├── modeling/        Editable mesh, selection, edit operators, undo/redo commands
├── scene/           Three.js scene, camera, lights, raycasting
├── export/          OBJ / JSON / Python (Blender) / SVG exporters
├── ui/              Panels, overlays, status, gesture recorder
└── styles/
docs/
├── GESTURE_GUIDE.md     Gesture → result reference and detection notes
└── BLENDER_MAPPING.md   How the edit tools map to Blender concepts
```

## How it works

1. **Tracking**: MediaPipe detects 21 landmarks per hand. They are smoothed and turned into scale-invariant measurements such as finger extension, thumb gap, finger direction and palm pitch.
2. **Poses and gestures**: each hand is classified into a pinch, grip or one of several flat-hand poses, then debounced so a single noisy frame never triggers a tool.
3. **State machine**: every pointer (left hand, right hand, mouse) goes through hover, then engaged, then cooldown. Once a tool engages it stays locked until release, and some poses resolve into a specific tool from the hand's first motion.
4. **Mesh**: a welded, subdivided box is edited vertex by vertex. Every edit is undoable, and the form is kept inside the viewport.

Thresholds were tuned by replaying recorded reference videos through the real pipeline (MediaPipe → classifier → state machine → tools).

## Deployment

Pushes to `main` deploy to production on Vercel automatically.

## License

[MIT](LICENSE) © Georgia Hoffmann
