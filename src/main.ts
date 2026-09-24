import * as THREE from 'three';
import { HandTracker } from './tracking/handTracker';
import type { HandState, Handedness } from './tracking/types';
import { HandProjector } from './interaction/handProjector';
import { HeightManipulator } from './interaction/heightInterpreter';
import { WidthManipulator } from './interaction/widthInterpreter';
import { InteractionStateMachine, type InteractionMode } from './interaction/interactionStateMachine';
import { TransformEngine } from './interaction/transformEngine';
import { classifyZone } from './interaction/spatialContext';
import { GestureClassifier, type HandGesture } from './gestures/gestureClassifier';
import { RotationDetector, PalmYawDetector } from './gestures/rotationDetector';
import { HandPoseDetector } from './gestures/handPoseDetector';
import type { HandPose } from './tracking/landmarkUtils';
import { BladeTool } from './interaction/bladeTool';
import { CurlTool } from './interaction/curlTool';
import { TwoHandRound } from './gestures/twoHandRound';
import { roundedBoxPositions, smallestHalfExtent } from './sculpt/rounding';
import { cutObject, isCutPiece, setCutPieceSculptMode } from './sculpt/meshCutter';
import { StrokeDeformer, type StrokeUpdateResult } from './sculpt/strokeDeformer';
import { MeshDeformer } from './sculpt/meshDeformer';
import { CommandHistory } from './modeling/commandHistory';
import { CutCommand, MeshEditCommand, RotateCommand } from './modeling/commands';
import { EditableMesh } from './modeling/editableMesh';
import { SelectionManager, type SelectionMode } from './modeling/selectionManager';
import { EditManipulator, type EditUpdateResult } from './modeling/editManipulator';
import { smoothGeometry } from './sculpt/meshSmoothing';
import { createSculptableObject, rebuildSculptableObject, syncPointsGeometry } from './modeling/objectFactory';
import { MATERIAL_LIBRARY } from './modeling/materialLibrary';
import { createScene } from './scene/scene';
import { CameraRig } from './scene/camera';
import { createRenderer, resizeRendererToDisplaySize } from './scene/renderer';
import { LightingRig } from './scene/lighting';
import { RaycasterService, type SurfaceHit } from './scene/raycaster';
import { drawHandSkeleton, drawViewportOverlay, type PointerVisual } from './ui/handOverlay';
import { updateVertexHighlight } from './ui/meshOverlay';
import { StatusPanel } from './ui/status';
import { RightPanel } from './ui/rightPanel';
import { EventLog } from './ui/eventLog';
import { GestureRecorder } from './ui/gestureRecorder';
import { setupCameraToggle, setupDebugToggle } from './ui/toolbar';
import { downloadFile } from './export/download';
import { exportOBJ } from './export/objExporter';
import { exportMeshJSON } from './export/jsonExporter';
import { exportPython } from './export/pythonExporter';
import { exportSVGProjection } from './export/svgProjectionExporter';
import { INTERACTION_CONFIG } from './config/interactionConfig';

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

type PointerId = 'Left' | 'Right' | 'Mouse';
const POINTER_IDS: PointerId[] = ['Left', 'Right', 'Mouse'];

/** Everything one pointer (a hand, or the mouse) needs to carry across frames. Rebuilt whenever the geometry is rebuilt. */
interface PointerRuntime {
  stateMachine: InteractionStateMachine;
  strokeDeformer: StrokeDeformer;
  editManipulator: EditManipulator;
  heightManipulator: HeightManipulator;
  widthManipulator: WidthManipulator;
  rotationDetector: RotationDetector;
  /** Vertical-blade rotation (palm turning around its own vertical axis) — used instead of rotationDetector when ROTATING was engaged by a blade, not a pinch. */
  palmYawDetector: PalmYawDetector;
  /** HORIZONTAL blade multi-tool: cut / round corners / tilt view. */
  bladeTool: BladeTool;
  /** CURLED pinch multi-tool: zoom in / zoom out / push in. */
  curlTool: CurlTool;
  /** Undo step for an in-progress ROUND CORNERS (recomputed from its before-snapshot every frame). */
  cornerEdit: MeshEditCommand | null;
  /** Has the engaged pose tool changed anything yet? Gates the pose handoff in the state machine. */
  toolDirty: boolean;
  /** Last frame this pointer was tracked — for the blade tracking-grace window. */
  lastSeenMs: number;
  rotationBaselineY: number;
  previousMode: InteractionMode;
  /** This pointer's gesture as of the last frame it was present — read by applyModeTransition at release time, since the classifier has usually already returned to NONE by then. */
  activeGesture: HandGesture;
}

function main(): void {
  const viewport = required<HTMLDivElement>('viewport');
  const canvas = required<HTMLCanvasElement>('sceneCanvas');
  const interactionOverlay = required<HTMLCanvasElement>('interactionOverlay');
  const video = required<HTMLVideoElement>('webcamVideo');
  const webcamOverlay = required<HTMLCanvasElement>('webcamOverlay');
  const debugPanel = required<HTMLElement>('debugPanel');

  const scene = createScene();
  const cameraRig = new CameraRig(viewport.clientWidth / Math.max(viewport.clientHeight, 1));
  const renderer = createRenderer(canvas);
  const lighting = new LightingRig(scene);

  let currentSegmentCount: number = INTERACTION_CONFIG.geometry.defaultSubdivisions;
  let object = createSculptableObject(scene, currentSegmentCount);
  let deformer = new MeshDeformer(object.geometry);
  let history = new CommandHistory();
  let transformEngine = new TransformEngine(object.group);
  let editableMesh = new EditableMesh(object.geometry.getAttribute('position') as THREE.BufferAttribute, object.topology.quads);
  const selectionManager = new SelectionManager();
  let editModeActive = false;
  let hasSculpted = false;
  let formFrozen = false;
  let selectedMaterial = MATERIAL_LIBRARY[0];

  const pointerRuntimes = new Map<PointerId, PointerRuntime>();
  const rebuildPointerRuntimes = () => {
    pointerRuntimes.clear();
    for (const id of POINTER_IDS) {
      pointerRuntimes.set(id, {
        stateMachine: new InteractionStateMachine(),
        strokeDeformer: new StrokeDeformer(object.geometry, deformer, history),
        editManipulator: new EditManipulator(editableMesh, selectionManager, deformer, history, object.geometry, object.topology),
        heightManipulator: new HeightManipulator(),
        widthManipulator: new WidthManipulator(),
        rotationDetector: new RotationDetector(),
        palmYawDetector: new PalmYawDetector(),
        bladeTool: new BladeTool(),
        curlTool: new CurlTool(),
        cornerEdit: null,
        toolDirty: false,
        lastSeenMs: 0,
        rotationBaselineY: 0,
        previousMode: 'IDLE',
        activeGesture: 'NONE',
      });
    }
  };
  rebuildPointerRuntimes();

  const handProjector = new HandProjector();
  const raycaster = new RaycasterService();
  const gestureClassifier = new GestureClassifier();
  const handPoseDetector = new HandPoseDetector();
  const twoHandRound = new TwoHandRound();
  let roundEdit: MeshEditCommand | null = null;

  // Cut-line preview: the hand's path across the object while CUTTING, drawn on top of everything.
  const cutPreviewMaterial = new THREE.LineBasicMaterial({ color: 0xff2d7a, depthTest: false, transparent: true });
  const cutPreviewLine = new THREE.Line(new THREE.BufferGeometry(), cutPreviewMaterial);
  cutPreviewLine.renderOrder = 10;
  cutPreviewLine.frustumCulled = false;
  cutPreviewLine.visible = false;
  scene.add(cutPreviewLine);

  const setCutPiecesSculptMode = (sculpting: boolean) => {
    for (const child of object.group.children) if (isCutPiece(child)) setCutPieceSculptMode(child, sculpting);
  };
  const tracker = new HandTracker(video);
  const eventLog = new EventLog(required('eventLog'));
  eventLog.push('SESSION_INIT');
  const recorder = new GestureRecorder(required('recorderLog'), required('recorderCountReadout'));

  const applyFinishMaterial = () => {
    object.finishMaterial.color.setHex(selectedMaterial.color);
    object.finishMaterial.metalness = selectedMaterial.metalness;
    object.finishMaterial.roughness = Math.max(0.03, selectedMaterial.roughness - lighting.specularRoughnessBias);
  };

  const rightPanel = new RightPanel({
    onSmooth: () => {
      const before = deformer.snapshotPositions();
      smoothGeometry(object.geometry, 0.5);
      const cmd = new MeshEditCommand(deformer, before);
      cmd.captureAfter();
      if (cmd.hasChange) history.push(cmd);
      eventLog.push('LAPLACIAN_SMOOTH');
    },
    onReset: () => {
      object = rebuildSculptableObject(scene, object, currentSegmentCount);
      deformer = new MeshDeformer(object.geometry);
      transformEngine = new TransformEngine(object.group);
      editableMesh = new EditableMesh(object.geometry.getAttribute('position') as THREE.BufferAttribute, object.topology.quads);
      selectionManager.clear();
      history.clear();
      rebuildPointerRuntimes();
      hasSculpted = false;
      rightPanel.lockResolution(false);
      applyFinishMaterial();
      eventLog.push('MESH_RESET');
    },
    onFreeze: () => {
      formFrozen = true;
      object.setSculptMode(false);
      setCutPiecesSculptMode(false);
      applyFinishMaterial();
      rightPanel.setMode('FINISH');
      eventLog.push('FORM_FROZEN → FINISH');
    },
    onBack: () => {
      formFrozen = false;
      object.setSculptMode(true);
      setCutPiecesSculptMode(true);
      rightPanel.setMode('SCULPT');
      eventLog.push('RETURN_TO_SCULPT');
    },
    onResolutionChange: (segments) => {
      if (hasSculpted) return; // guarded by disabling the slider too — belt and suspenders
      currentSegmentCount = segments;
      object = rebuildSculptableObject(scene, object, segments);
      deformer = new MeshDeformer(object.geometry);
      transformEngine = new TransformEngine(object.group);
      editableMesh = new EditableMesh(object.geometry.getAttribute('position') as THREE.BufferAttribute, object.topology.quads);
      selectionManager.clear();
      history.clear();
      rebuildPointerRuntimes();
      applyFinishMaterial();
      eventLog.push('MESH_RESOLUTION := ' + segments);
    },
    onAppModeChange: (mode) => {
      editModeActive = mode === 'EDIT';
      eventLog.push('APP_MODE := ' + mode);
    },
    onSelectionModeChange: (mode) => {
      selectionManager.setMode(mode);
      eventLog.push('SELECTION_MODE := ' + mode);
    },
    onMaterialSelect: (index) => {
      selectedMaterial = MATERIAL_LIBRARY[index];
      applyFinishMaterial();
      eventLog.push('MATERIAL := ' + selectedMaterial.code);
    },
    onLightingChange: (partial) => {
      lighting.update(partial);
      applyFinishMaterial();
    },
    onHeightManualDelta: (deltaWorld) => {
      const before = deformer.snapshotPositions();
      deformer.applyHeightDelta(object.topology.heightFraction, deltaWorld);
      deformer.finalizeFrame();
      const cmd = new MeshEditCommand(deformer, before);
      cmd.captureAfter();
      if (cmd.hasChange) history.push(cmd);
      hasSculpted = true;
      rightPanel.lockResolution(true);
    },
    onExportSvg: () => {
      downloadFile('product-projection.svg', exportSVGProjection(object.geometry), 'image/svg+xml');
      eventLog.push('EXPORT SVG');
    },
    onExportPy: () => {
      downloadFile('sculpted_product.py', exportPython(object.geometry));
      eventLog.push('EXPORT PY');
    },
    onExportJson: () => {
      downloadFile(
        'sculpted_product.json',
        JSON.stringify(exportMeshJSON(object.geometry, selectedMaterial, lighting.params), null, 2),
        'application/json'
      );
      eventLog.push('EXPORT JSON');
    },
    onExportObj: () => {
      downloadFile('sculpted_product.obj', exportOBJ(object.geometry));
      eventLog.push('EXPORT OBJ');
    },
  });
  applyFinishMaterial();

  const status = new StatusPanel({
    stateReadout: required('stateReadout'),
    trackingReadout: required('trackingReadout'),
    activityReadout: required('activityReadout'),
    segReadout: required('segReadout'),
    statHands: required('statHands'),
    statFps: required('statFps'),
    statVertices: required('statVertices'),
    statTriangles: required('statTriangles'),
    statSegments: required('statSegments'),
    debugOutput: required('debugOutput'),
  });

  setupCameraToggle(required('cameraToggle'), tracker, () => {
    if (tracker.status !== 'active') drawHandSkeleton(webcamOverlay, []);
  });
  setupDebugToggle(required('debugToggle'), debugPanel);

  const recordToggle = required<HTMLButtonElement>('recordToggle');
  recordToggle.addEventListener('click', () => {
    if (recorder.isRecording) {
      recorder.stop();
      eventLog.push(`REC_STOP (${recorder.count} episódios)`);
    } else {
      recorder.start();
      eventLog.push('REC_START');
    }
    recordToggle.textContent = recorder.isRecording ? '■ STOP' : '● REC';
    recordToggle.classList.toggle('btn-primary', !recorder.isRecording);
    recordToggle.classList.toggle('btn-secondary', recorder.isRecording);
  });
  required<HTMLButtonElement>('recordClear').addEventListener('click', () => {
    recorder.clear();
    eventLog.push('REC_CLEAR');
  });
  required<HTMLButtonElement>('recordExportJson').addEventListener('click', () => {
    downloadFile('gesture-session.json', recorder.exportJSON(), 'application/json');
    eventLog.push('REC_EXPORT_JSON');
  });
  required<HTMLButtonElement>('recordExportMd').addEventListener('click', () => {
    downloadFile('gesture-session.md', recorder.exportMarkdown(), 'text/markdown');
    eventLog.push('REC_EXPORT_MD');
  });

  const onResize = () => resizeRendererToDisplaySize(renderer, cameraRig.getCamera(), viewport);
  window.addEventListener('resize', onResize);
  onResize();

  window.addEventListener('keydown', (e) => {
    if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      if (!formFrozen && history.undo()) eventLog.push('UNDO');
    }
    if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      if (!formFrozen && history.redo()) eventLog.push('REDO');
    }
  });

  // ---------- mouse fallback: same StrokeDeformer/state-machine pipeline as hands ----------
  // Tracked continuously (not just while a button is held) so hover/brush-preview works with
  // the mouse too — button-down is this pointer's "pinch" (ENGAGE), matching the hand model.
  let mouseNdc: THREE.Vector2 | null = null;
  let mouseButtonDown = false;
  let mouseShiftHeld = false;
  let mouseAltHeld = false;
  let mouseOrbiting = false;
  let lastMouseScreen = { x: 0, y: 0 };
  // ALT+drag freezes the raycast cursor (no tangential motion) and instead feeds vertical
  // movement in as `depthDelta` — the mouse's substitute for the hand's genuinely separate Z
  // channel (see handProjector.ts / INTERACTION_CONFIG.sculpt.mouseDepthSensitivity), needed to
  // drive INFLATE/DEFLATE and Phase 3's EXTRUDE/INSET/BEVEL without hand-tracking hardware.
  let mouseScreenY: number | null = null;
  let prevMouseScreenY: number | null = null;

  const updateMouseNdc = (e: PointerEvent) => {
    const rect = viewport.getBoundingClientRect();
    mouseNdc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
  };

  viewport.addEventListener('pointerdown', (e) => {
    viewport.setPointerCapture(e.pointerId);
    updateMouseNdc(e);
    lastMouseScreen = { x: e.clientX, y: e.clientY };
    mouseScreenY = e.clientY;
    if (e.shiftKey) {
      mouseOrbiting = true;
    } else {
      mouseButtonDown = true;
    }
  });
  viewport.addEventListener('pointermove', (e) => {
    mouseShiftHeld = e.shiftKey;
    mouseAltHeld = e.altKey;
    if (mouseOrbiting) {
      cameraRig.orbit((e.clientX - lastMouseScreen.x) * 0.008, (e.clientY - lastMouseScreen.y) * 0.005);
      lastMouseScreen = { x: e.clientX, y: e.clientY };
    } else if (mouseAltHeld) {
      mouseScreenY = e.clientY;
    } else {
      updateMouseNdc(e);
      mouseScreenY = e.clientY;
    }
  });
  viewport.addEventListener('pointerenter', updateMouseNdc);
  const endMouseDrag = () => {
    mouseButtonDown = false;
    mouseOrbiting = false;
    mouseScreenY = null;
    prevMouseScreenY = null;
  };
  viewport.addEventListener('pointerup', endMouseDrag);
  viewport.addEventListener('pointerleave', () => {
    endMouseDrag();
    mouseNdc = null;
  });
  viewport.addEventListener('contextmenu', (e) => e.preventDefault());
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cameraRig.zoom(e.deltaY * 0.0035);
    },
    { passive: false }
  );

  // ---------- render loop ----------
  let frameCount = 0;
  let lastFpsSample = performance.now();
  let fps = 0;

  const topZoneWorld = new THREE.Vector3();
  const topZoneNdc = new THREE.Vector2();
  const centerWorld = new THREE.Vector3();
  const centerNdc = new THREE.Vector2();

  function computeTopZoneNdc(camera: THREE.Camera): THREE.Vector2 {
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox!;
    topZoneWorld.set(0, box.max.y, 0);
    object.shadeMesh.localToWorld(topZoneWorld);
    const ndc = topZoneWorld.clone().project(camera);
    return topZoneNdc.set(ndc.x, ndc.y);
  }

  /** Screen projection of the object's own local-space origin — WIDTH's reference point, mirroring computeTopZoneNdc for HEIGHT. */
  function computeCenterNdc(camera: THREE.Camera): THREE.Vector2 {
    centerWorld.set(0, 0, 0);
    object.shadeMesh.localToWorld(centerWorld);
    const ndc = centerWorld.clone().project(camera);
    return centerNdc.set(ndc.x, ndc.y);
  }

  interface FrameResult {
    id: PointerId;
    hand: HandState | null;
    present: boolean;
    mode: InteractionMode;
    hit: SurfaceHit | null;
    stroke: StrokeUpdateResult | null;
    edit: EditUpdateResult | null;
  }

  function loop(nowMs: number): void {
    requestAnimationFrame(loop);
    const camera = cameraRig.getCamera();

    const hands = tracker.update(nowMs);
    drawHandSkeleton(webcamOverlay, hands);
    const roundFrame = formFrozen ? { candidate: false, active: false, started: false, ended: false, amount: 0 } : twoHandRound.update(hands);

    const topNdc = formFrozen ? null : computeTopZoneNdc(camera);
    const centerNdcThisFrame = formFrozen ? null : computeCenterNdc(camera);
    const brush = rightPanel.brushSettings;
    const results: FrameResult[] = [];
    let cutPreview: THREE.Vector3[] | null = null;

    for (const id of POINTER_IDS) {
      const runtime = pointerRuntimes.get(id)!;
      const hand = id === 'Mouse' ? null : (hands.find((h) => h.handedness === id) ?? null);

      // Orbiting is a deliberate, separate camera action (shift+drag) — the mouse pointer was
      // never a sculpt/height/rotate candidate for this gesture, so skip it entirely rather than
      // reporting a misleading TRACKING_LOST for a pointer that was already idle.
      if (id === 'Mouse' && mouseOrbiting) continue;

      const present = id === 'Mouse' ? mouseNdc != null : hand != null;
      if (present) runtime.lastSeenMs = nowMs;

      // A blade gesture (cut sweep especially) moves fast enough that MediaPipe drops the hand for
      // a few frames — hold the engaged mode through a short gap instead of going TRACKING_LOST.
      if (
        !present &&
        runtime.stateMachine.engageSource === 'BLADE' &&
        (['BLADE_TOOL', 'CURL_TOOL', 'ROTATING', 'HEIGHT_EDIT', 'WIDTH_EDIT'] as InteractionMode[]).includes(runtime.previousMode) &&
        nowMs - runtime.lastSeenMs < INTERACTION_CONFIG.blade.trackingGraceMs
      ) {
        results.push({ id, hand: null, present: false, mode: runtime.previousMode, hit: null, stroke: null, edit: null });
        continue;
      }

      if (!present) {
        if (hand == null && id !== 'Mouse') {
          handProjector.reset(id);
          gestureClassifier.reset(id as Handedness);
        }
        const mode = runtime.stateMachine.update(
          { present: false, isPinching: false, zone: 'ROTATE', editModeActive, blade: 'NONE', engagedPristine: !runtime.toolDirty },
          nowMs
        );
        applyModeTransition(id, runtime, mode, null, null, null, null, null, nowMs, 'NONE');
        results.push({ id, hand: null, present: false, mode, hit: null, stroke: null, edit: null });
        continue;
      }

      let cursorNdc: THREE.Vector2;
      let depthDelta = 0;
      let isPinching: boolean;
      // Mouse has no fingers to grip with — it's always the PINCH gesture (or nothing). Real
      // hands go through GestureClassifier, which tells a full 5-finger grip apart from an
      // index+thumb pinch (see gestures/gestureClassifier.ts — "pegada grande", Phase 4).
      let gesture: HandGesture = 'NONE';
      // Flat-hand blade (cut / palm-yaw rotate) — hand-only, and never while a pinch/grip is on.
      let blade: HandPose = 'NONE';
      let palmNdc: THREE.Vector2 | null = null;

      if (id === 'Mouse') {
        cursorNdc = mouseNdc!;
        isPinching = mouseButtonDown && !mouseShiftHeld;
        gesture = isPinching ? 'PINCH' : 'NONE';
        if (mouseAltHeld && mouseButtonDown && mouseScreenY != null && prevMouseScreenY != null) {
          depthDelta = ((prevMouseScreenY - mouseScreenY) / Math.max(1, viewport.clientHeight)) * INTERACTION_CONFIG.sculpt.mouseDepthSensitivity;
        }
        prevMouseScreenY = mouseScreenY;
      } else {
        const projected = handProjector.projectHand(id, hand!.indexTip, hand!.indexTip.z, hand!.handSpan);
        cursorNdc = projected.ndc;
        depthDelta = projected.depthDelta;
        gesture = gestureClassifier.update(hand!);
        const confirmedBlade = handPoseDetector.update(hand!, nowMs);
        // The beak poses (DOWN height, SIDE width) have the thumb on the fingertips and the CURLED
        // pose's closed state IS a pinch, so the pinch detector fires on all three — while any of
        // them is the raw or confirmed pose, the pinch is ignored and the pose drives its own tool.
        // Exception: a pinch that has ALREADY engaged is kept alive until the pose confirms, so the
        // state machine can hand it off — dropping it first would release into a cooldown and the
        // pose could never engage (seen on the zoom-in reference: pinch fires 1 frame before CURLED).
        const pinchLike: HandPose[] = ['DOWN', 'SIDE', 'CURLED'];
        const keepPinch = runtime.stateMachine.engagedByPinch && !pinchLike.includes(confirmedBlade);
        if (!keepPinch && (pinchLike.includes(hand!.pose) || pinchLike.includes(confirmedBlade))) gesture = 'NONE';
        // Two flat hands = the two-hand ROUND gesture; neither hand may start its own tool meanwhile.
        if (roundFrame.candidate || roundFrame.active) gesture = 'NONE';
        isPinching = gesture !== 'NONE';
        blade = isPinching || roundFrame.candidate || roundFrame.active ? 'NONE' : confirmedBlade;
        // A frozen (finished) form can't be cut, rounded or pushed any more.
        if (formFrozen && (blade === 'HORIZONTAL' || blade === 'SIDE' || blade === 'DOWN')) blade = 'NONE';
        // The cut line follows the middle of the hand, not the index tip at the end of the blade.
        palmNdc = new THREE.Vector2((1 - hand!.palmCenter.x) * 2 - 1, 1 - hand!.palmCenter.y * 2);
      }

      // Mouse has no fingers to orient — WIDTH is a hand-only zone.
      const isHorizontal = id !== 'Mouse' && (hand?.isHorizontal ?? false);
      const pointingDown = id !== 'Mouse' && (hand?.pointingDown ?? false);
      // CURLED still needs the surface under the cursor (PUSH); the other poses act on the whole object.
      const needsHit = blade === 'NONE' || blade === 'CURLED';
      const hit = formFrozen || isHorizontal || !needsHit ? null : raycaster.pickSurface(cursorNdc.x, cursorNdc.y, camera, object.shadeMesh);
      const { zone } = classifyZone(cursorNdc, hit, topNdc, isHorizontal, pointingDown);
      const mode = runtime.stateMachine.update({ present: true, isPinching, zone, editModeActive, blade, engagedPristine: !runtime.toolDirty }, nowMs);

      applyModeTransition(id, runtime, mode, hand, cursorNdc, centerNdcThisFrame, transformEngine.getRotationY(), hit, nowMs, runtime.activeGesture);
      runtime.activeGesture = gesture;

      let stroke: StrokeUpdateResult | null = null;
      let edit: EditUpdateResult | null = null;
      switch (mode) {
        case 'SCULPTING':
          if (hit) {
            stroke =
              gesture === 'GRIP'
                ? runtime.strokeDeformer.updateGrip(hit.point, hit.normal, nowMs)
                : runtime.strokeDeformer.update(hit.point, hit.normal, depthDelta, brush, nowMs);
            hasSculpted = hasSculpted || stroke.displaced;
            if (stroke.displaced) runtime.toolDirty = true;
          }
          break;
        case 'EDITING':
          if (hit) {
            edit = runtime.editManipulator.update(hit, depthDelta);
            hasSculpted = hasSculpted || edit.moved;
            if (edit.moved) runtime.toolDirty = true;
          }
          break;
        case 'HEIGHT_EDIT': {
          const dy = runtime.heightManipulator.update(cursorNdc);
          if (dy !== 0) {
            deformer.applyHeightDelta(object.topology.heightFraction, dy);
            hasSculpted = true;
            runtime.toolDirty = true;
          }
          break;
        }
        case 'WIDTH_EDIT': {
          if (centerNdcThisFrame) {
            const dw = runtime.widthManipulator.update(cursorNdc, centerNdcThisFrame);
            if (dw !== 0) {
              deformer.applyWidthDelta(dw);
              hasSculpted = true;
              runtime.toolDirty = true;
            }
          }
          break;
        }
        case 'ROTATING': {
          const rot = INTERACTION_CONFIG.rotation;
          if (runtime.stateMachine.engageSource === 'BLADE') {
            const delta = runtime.palmYawDetector.delta(hand!);
            if (Math.abs(delta) > rot.palmYawDeadZone) {
              transformEngine.setRotationY(runtime.rotationBaselineY + delta * rot.palmYawSensitivity);
              runtime.toolDirty = true;
            }
          } else {
            const delta = runtime.rotationDetector.delta(hand!);
            if (Math.abs(delta) > rot.deadZone) {
              transformEngine.setRotationY(runtime.rotationBaselineY + delta * rot.sensitivity);
              runtime.toolDirty = true;
            }
          }
          break;
        }
        case 'BLADE_TOOL': {
          if (!palmNdc || !hand) break;
          const blade = runtime.bladeTool.update(hand, palmNdc, camera, object);
          if (blade.preview) cutPreview = blade.preview;

          if (blade.tiltDelta !== 0) {
            cameraRig.orbit(0, blade.tiltDelta);
            runtime.toolDirty = true;
          }

          if (blade.cornerAmount != null) {
            // Recomputed from the before-snapshot every frame (absolute, not additive), so raising
            // and lowering the fingers grows and shrinks the fillets without drift.
            runtime.cornerEdit ??= new MeshEditCommand(deformer, deformer.snapshotPositions());
            const before = runtime.cornerEdit.beforePositions;
            const radius = blade.cornerAmount * INTERACTION_CONFIG.bladeTool.cornerMaxRadiusFraction * smallestHalfExtent(before);
            roundedBoxPositions(before, object.geometry.getAttribute('position').array as Float32Array, radius);
            object.geometry.getAttribute('position').needsUpdate = true;
            if (radius > 0) {
              runtime.toolDirty = true;
              hasSculpted = true;
            }
          }

          if (blade.cutReady && !runtime.bladeTool.cut.completed) {
            const controller = runtime.bladeTool.cut;
            const cutHeight = controller.buildCutFunction();
            const result = cutObject(object, (v) => cutHeight(controller.sOfLocal(v, object)), INTERACTION_CONFIG.cut.separationGap);
            history.push(
              new CutCommand(
                deformer,
                object.topology,
                object.group,
                result.piece,
                result.beforePositions,
                result.beforeHeightFraction,
                result.afterPositions,
                result.afterHeightFraction
              )
            );
            controller.markDone();
            hasSculpted = true;
            runtime.toolDirty = true;
            eventLog.push('CUT');
          }
          break;
        }
        case 'CURL_TOOL': {
          if (!hand) break;
          const curl = runtime.curlTool.update(hand, cursorNdc, centerNdcThisFrame);
          if (curl.zoomDelta !== 0) {
            cameraRig.zoom(curl.zoomDelta);
            runtime.toolDirty = true;
          }
          if (curl.sub === 'PUSH' && hit && !formFrozen) {
            stroke = runtime.strokeDeformer.updatePush(hit.point, hit.normal, curl.pushAmount, brush);
            if (stroke.displaced) {
              hasSculpted = true;
              runtime.toolDirty = true;
            }
          }
          break;
        }
        default:
          break;
      }

      const showHit = hit && (mode === 'SCULPTING' || mode === 'HOVER_MESH' || mode === 'EDITING' || mode === 'HOVER_EDIT');
      results.push({ id, hand, present: true, mode, hit: showHit ? hit : null, stroke, edit });
    }

    // Two-hand ROUND: recomputed from the snapshot taken when it started, like ROUND CORNERS.
    if (roundFrame.started) roundEdit = new MeshEditCommand(deformer, deformer.snapshotPositions());
    if (roundEdit && roundFrame.active) {
      const before = roundEdit.beforePositions;
      roundedBoxPositions(before, object.geometry.getAttribute('position').array as Float32Array, roundFrame.amount * smallestHalfExtent(before));
      object.geometry.getAttribute('position').needsUpdate = true;
      if (roundFrame.amount > 0) hasSculpted = true;
    }
    if (roundFrame.ended) {
      // Hands still flat/vertical after the two-hand gesture must not immediately start a rotation.
      for (const r of pointerRuntimes.values()) r.stateMachine.requireRelease();
    }
    if (roundEdit && (roundFrame.ended || formFrozen)) {
      roundEdit.captureAfter();
      if (roundEdit.hasChange) {
        history.push(roundEdit);
        eventLog.push('ROUND_FORM');
      }
      roundEdit = null;
    }

    cutPreviewLine.visible = cutPreview != null && cutPreview.length > 1;
    if (cutPreviewLine.visible) cutPreviewLine.geometry.setFromPoints(cutPreview!);

    if (hasSculpted) rightPanel.lockResolution(true);
    syncPointsGeometry(object);

    if (!formFrozen) {
      deformer.finalizeFrame();
      const influenceSets = results
        .filter((r) => r.mode === 'SCULPTING')
        .map((r) => pointerRuntimes.get(r.id)!.strokeDeformer.getLastInfluence());
      updateVertexHighlight(object.points.geometry, influenceSets);
    }

    const pointerVisuals: PointerVisual[] = results.map((r) => {
      let selectionCenter: THREE.Vector3 | null = null;
      if (r.mode === 'EDITING') {
        selectionCenter = pointerRuntimes.get(r.id)!.editManipulator.getSelectionCenter(new THREE.Vector3());
      } else if (r.mode === 'HOVER_EDIT' && r.hit) {
        selectionCenter = selectionManager.previewAtHit(r.hit, editableMesh, new THREE.Vector3());
      }
      return {
        handedness: r.hand?.handedness ?? null,
        landmarks: r.hand?.landmarks ?? null,
        hit: r.hit,
        brushRadius: r.stroke?.effectiveRadius ?? brush.radius,
        operator: brush.operator,
        mode: r.mode,
        selectionCenter,
        selectionMode: editModeActive ? selectionManager.getMode() : null,
      };
    });
    drawViewportOverlay(interactionOverlay, camera, object.shadeMesh, pointerVisuals);
    renderer.render(scene, camera);

    frameCount += 1;
    if (nowMs - lastFpsSample > 700) {
      fps = Math.round((frameCount * 1000) / (nowMs - lastFpsSample));
      frameCount = 0;
      lastFpsSample = nowMs;
    }

    const position = object.geometry.getAttribute('position') as THREE.BufferAttribute;
    const triangleCount = object.geometry.index ? object.geometry.index.count / 3 : position.count / 3;

    const editOperator = rightPanel.editSettings.operator;
    status.update({
      stateLabel: formFrozen ? 'FORM_FROZEN' : roundFrame.active ? 'ROUNDING' : dominantMode(results),
      activityLabel: formFrozen
        ? 'FORM_FROZEN'
        : roundFrame.active
          ? `ROUND · ${Math.round(roundFrame.amount * 100)}%`
          : contextualLabel(results, brush.operator, selectionManager.getMode(), editOperator),
      trackingStatus: tracker.status,
      handsCount: hands.length,
      fps,
      vertices: position.count,
      triangles: Math.round(triangleCount),
      segments: currentSegmentCount,
      debugVisible: !debugPanel.hidden,
      debugLines: buildDebugLines(results, hands, fps, brush.operator, selectionManager.getMode(), editOperator),
    });
  }

  /** Fires the begin/end lifecycle exactly once on each transition — this is what makes "pinch" mean ENGAGE and nothing else. Also the one place that segments the GestureRecorder's episodes, since it already has the exact begin/end edges. */
  function applyModeTransition(
    id: PointerId,
    runtime: PointerRuntime,
    mode: InteractionMode,
    hand: HandState | null,
    cursorNdc: THREE.Vector2 | null,
    centerNdc: THREE.Vector2 | null,
    currentRotationY: number | null,
    hit: SurfaceHit | null,
    nowMs: number,
    lastGesture: HandGesture
  ): void {
    if (mode === runtime.previousMode) return;

    if (runtime.previousMode === 'SCULPTING') {
      runtime.strokeDeformer.endStroke();
      const label = lastGesture === 'GRIP' ? 'GRIP' : rightPanel.brushSettings.operator;
      recorder.endEpisode(id, nowMs, `SCULPT · ${label}`);
    }
    if (runtime.previousMode === 'EDITING') {
      runtime.editManipulator.endEdit();
      const es = rightPanel.editSettings;
      const falloffNote = es.falloffRadius > 0 ? ` · falloff=${es.falloffRadius.toFixed(2)}` : '';
      recorder.endEpisode(id, nowMs, `EDIT · ${es.operator} · sel=${selectionManager.getMode()}${falloffNote}`);
    }
    if (runtime.previousMode === 'HEIGHT_EDIT') {
      runtime.heightManipulator.end();
      recorder.endEpisode(id, nowMs, 'HEIGHT_EDIT');
    }
    if (runtime.previousMode === 'WIDTH_EDIT') {
      runtime.widthManipulator.end();
      recorder.endEpisode(id, nowMs, 'WIDTH_EDIT');
    }
    if (runtime.previousMode === 'BLADE_TOOL') {
      const sub = runtime.bladeTool.subTool;
      const label =
        sub === 'CORNERS' ? 'ROUND_CORNERS' : sub === 'TILT' ? 'TILT_VIEW' : runtime.bladeTool.cut.completed ? 'CUT' : `BLADE · ${sub.toLowerCase()}`;
      if (runtime.cornerEdit) {
        runtime.cornerEdit.captureAfter();
        if (runtime.cornerEdit.hasChange) {
          history.push(runtime.cornerEdit);
          eventLog.push('ROUND_CORNERS');
        }
        runtime.cornerEdit = null;
      }
      runtime.bladeTool.end();
      recorder.endEpisode(id, nowMs, label);
    }
    if (runtime.previousMode === 'CURL_TOOL') {
      const sub = runtime.curlTool.subTool;
      runtime.strokeDeformer.endStroke();
      runtime.curlTool.end();
      recorder.endEpisode(id, nowMs, sub === 'UNDECIDED' ? 'CURL · nada' : sub);
    }
    if (runtime.previousMode === 'ROTATING') {
      runtime.rotationDetector.end();
      runtime.palmYawDetector.end();
      const after = currentRotationY ?? transformEngine.getRotationY();
      if (after !== runtime.rotationBaselineY) {
        history.push(new RotateCommand(object.group, runtime.rotationBaselineY, after));
      }
      const deltaDeg = ((after - runtime.rotationBaselineY) * 180) / Math.PI;
      const via = runtime.stateMachine.engageSource === 'BLADE' ? ' · palma' : '';
      recorder.endEpisode(id, nowMs, `ROTATE${via} · Δ=${deltaDeg.toFixed(1)}°`);
    }

    if (mode === 'SCULPTING') {
      runtime.strokeDeformer.beginStroke();
      recorder.beginEpisode(id, mode, nowMs);
    }
    // EDITING only exists inside the MESH zone, which requires a raycast hit — see classifyZone.
    if (mode === 'EDITING' && hit) {
      runtime.editManipulator.beginEdit(hit, rightPanel.editSettings);
      recorder.beginEpisode(id, mode, nowMs);
    }
    if (mode === 'HEIGHT_EDIT' && cursorNdc) {
      runtime.heightManipulator.begin(cursorNdc);
      recorder.beginEpisode(id, mode, nowMs);
    }
    if (mode === 'WIDTH_EDIT' && cursorNdc && centerNdc) {
      runtime.widthManipulator.begin(cursorNdc, centerNdc);
      recorder.beginEpisode(id, mode, nowMs);
    }
    if (mode === 'BLADE_TOOL' && hand) {
      runtime.bladeTool.begin(hand, cameraRig.getCamera(), object);
      recorder.beginEpisode(id, mode, nowMs);
    }
    if (mode === 'CURL_TOOL' && hand && cursorNdc) {
      runtime.curlTool.begin(hand, cursorNdc, centerNdc);
      // Opens an undo step; a zoom-only gesture changes no vertices, so endStroke pushes nothing.
      runtime.strokeDeformer.beginStroke();
      recorder.beginEpisode(id, mode, nowMs);
    }
    if (mode === 'ROTATING' && hand && currentRotationY != null) {
      if (runtime.stateMachine.engageSource === 'BLADE') runtime.palmYawDetector.begin(hand);
      else runtime.rotationDetector.begin(hand);
      runtime.rotationBaselineY = currentRotationY;
      recorder.beginEpisode(id, mode, nowMs);
    }

    runtime.toolDirty = false;
    runtime.previousMode = mode;
  }

  requestAnimationFrame(loop);
}

function dominantMode(results: Array<{ mode: InteractionMode }>): string {
  const priority: InteractionMode[] = [
    'SCULPTING',
    'EDITING',
    'HEIGHT_EDIT',
    'WIDTH_EDIT',
    'ROTATING',
    'BLADE_TOOL',
    'CURL_TOOL',
    'TRACKING_LOST',
    'COOLDOWN',
    'HOVER_MESH',
    'HOVER_EDIT',
    'HOVER_HEIGHT',
    'HOVER_WIDTH',
    'HOVER_ROTATE',
  ];
  for (const mode of priority) {
    if (results.some((r) => r.mode === mode)) return mode;
  }
  return results.length ? 'IDLE' : 'NO_HAND';
}

function contextualLabel(
  results: Array<{ mode: InteractionMode; stroke: StrokeUpdateResult | null }>,
  operator: string,
  selectionMode: SelectionMode,
  editOperator: string
): string {
  const sculpting = results.find((r) => r.mode === 'SCULPTING');
  if (sculpting) return `SCULPT · ${operator}`;
  if (results.some((r) => r.mode === 'EDITING')) return `EDIT · ${editOperator} · ${selectionMode}`;
  if (results.some((r) => r.mode === 'HEIGHT_EDIT')) return 'HEIGHT · ↕';
  if (results.some((r) => r.mode === 'WIDTH_EDIT')) return 'WIDTH · ↔';
  if (results.some((r) => r.mode === 'ROTATING')) return 'ROTATE · ↻';
  if (results.some((r) => r.mode === 'BLADE_TOOL')) return 'BLADE · corte / cantos / inclinar';
  if (results.some((r) => r.mode === 'CURL_TOOL')) return 'PINÇA · zoom / empurrar';
  if (results.some((r) => r.mode === 'TRACKING_LOST')) return 'TRACKING LOST';
  if (results.some((r) => r.mode === 'COOLDOWN')) return 'COOLDOWN';
  if (results.some((r) => r.mode === 'HOVER_MESH')) return 'HOVER · MESH';
  if (results.some((r) => r.mode === 'HOVER_EDIT')) return `HOVER · EDIT ${selectionMode}`;
  if (results.some((r) => r.mode === 'HOVER_HEIGHT')) return 'HOVER · HEIGHT ZONE';
  if (results.some((r) => r.mode === 'HOVER_WIDTH')) return 'HOVER · WIDTH ZONE';
  if (results.some((r) => r.mode === 'HOVER_ROTATE')) return 'HOVER · ROTATE ZONE';
  return results.length ? 'TRACKING' : 'NO_HAND';
}

function buildDebugLines(
  results: Array<{ id: PointerId; hand: HandState | null; mode: InteractionMode; stroke: StrokeUpdateResult | null; edit: EditUpdateResult | null }>,
  hands: HandState[],
  fps: number,
  operator: string,
  selectionMode: SelectionMode,
  editOperator: string
): string[] {
  const lines: string[] = [`fps: ${fps}`, `handCount: ${hands.length}`, `operator: ${operator}`, `selectionMode: ${selectionMode}`, `editOperator: ${editOperator}`, ''];
  for (const hand of hands) {
    lines.push(`[${hand.handedness}] confidence=${hand.confidence.toFixed(2)} pinchNormalized=${hand.pinchNormalized.toFixed(3)}`);
  }
  lines.push('');
  for (const r of results) {
    lines.push(`[${r.id}] mode=${r.mode}`);
    if (r.stroke) {
      lines.push(`  displaced=${r.stroke.displaced} activeVertices=${r.stroke.activeVertexCount} radius=${r.stroke.effectiveRadius.toFixed(3)}`);
      lines.push(`  velocity=${r.stroke.velocity.toFixed(3)} turningAngle=${r.stroke.turningAngle.toFixed(3)} sharpness=${r.stroke.sharpness.toFixed(2)}`);
    }
    if (r.edit) {
      lines.push(`  moved=${r.edit.moved} activeVertices=${r.edit.activeVertexCount}`);
    }
  }
  return lines;
}

main();
