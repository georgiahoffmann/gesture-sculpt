import * as THREE from 'three';
import type { HandState } from '../tracking/types';
import type { SurfaceHit } from '../scene/raycaster';
import type { InteractionMode } from '../interaction/interactionStateMachine';
import type { SculptOperator } from '../sculpt/strokeDeformer';
import type { SelectionMode } from '../modeling/selectionManager';

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function resizeToDisplay(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    canvas.width = Math.max(rect.width, 4);
    canvas.height = Math.max(rect.height, 4);
  }
}

/** Small webcam-thumbnail skeleton — preserved from the first version. */
export function drawHandSkeleton(canvas: HTMLCanvasElement, hands: HandState[]): void {
  resizeToDisplay(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!hands.length) return;

  ctx.lineWidth = 1;
  for (const hand of hands) {
    const lm = hand.landmarks;
    ctx.strokeStyle = 'rgba(26,26,26,0.45)';
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo((1 - lm[a].x) * canvas.width, lm[a].y * canvas.height);
      ctx.lineTo((1 - lm[b].x) * canvas.width, lm[b].y * canvas.height);
    }
    ctx.stroke();

    ctx.fillStyle = '#ff8a1a';
    ctx.beginPath();
    ctx.arc((1 - lm[4].x) * canvas.width, lm[4].y * canvas.height, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#19c1ff';
    ctx.beginPath();
    ctx.arc((1 - lm[8].x) * canvas.width, lm[8].y * canvas.height, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface PointerVisual {
  handedness: 'Left' | 'Right' | null;
  landmarks: HandState['landmarks'] | null;
  /** Present whenever the ray is hitting the mesh, whether just hovering or actively sculpting/editing — brush/selection preview needs it either way. */
  hit: SurfaceHit | null;
  brushRadius: number;
  operator: SculptOperator;
  mode: InteractionMode;
  /** Local-space center of the selected (or, while hovering, would-be-selected) vertex/edge/face — null outside EDIT mode or when nothing resolves. */
  selectionCenter: THREE.Vector3 | null;
  /** Current SelectionManager mode, only while EDIT mode is active — drives the marker shape/label in EDITING/HOVER_EDIT. */
  selectionMode: SelectionMode | null;
}

/**
 * Main-viewport overlay implementing the brief's progressive-feedback ladder:
 * thin hollow ring = hover/preview (nothing is happening yet), filled disc =
 * engaged/locked (a manipulation is actively committing), color = which zone
 * (mesh/height/rotate), small label = which operator when sculpting. Hand
 * skeleton(s) drawn directly over the object so the user can see "my hand is
 * here and will affect THIS region" without looking away to the webcam
 * thumbnail.
 */
export function drawViewportOverlay(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  mesh: THREE.Object3D,
  pointers: PointerVisual[]
): void {
  resizeToDisplay(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const pointer of pointers) {
    if (pointer.landmarks) drawSkeletonOnViewport(ctx, canvas, pointer.landmarks);

    if (pointer.mode === 'TRACKING_LOST') continue; // no cursor to show — hand isn't tracked

    if (!pointer.hit) continue;

    const worldPoint = mesh.localToWorld(pointer.hit.point.clone());
    const screenPoint = worldToScreen(worldPoint, camera, canvas);
    if (!screenPoint) continue;

    const isEditFamily = pointer.mode === 'EDITING' || pointer.mode === 'HOVER_EDIT';
    const engaged = pointer.mode === 'SCULPTING' || pointer.mode === 'EDITING';
    const color = zoneColor(pointer.mode);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = engaged ? 2 : 1.2;
    if (!engaged) ctx.setLineDash([3, 3]);

    if (!isEditFamily) {
      // brush influence ring: hollow while hovering (○), filled edge while engaged (◉)
      const screenRadius = projectedRadius(worldPoint, pointer.brushRadius, camera, canvas);
      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, screenRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, engaged ? 4 : 2.5, 0, Math.PI * 2);
      if (engaged) ctx.fill();
      else ctx.stroke();

      if (engaged) {
        ctx.font = '9px monospace';
        ctx.fillText(operatorLabel(pointer.operator), screenPoint.x + 12, screenPoint.y + 3);
      }
      continue;
    }
    ctx.setLineDash([]);

    // EDIT mode: small crosshair at the raw cursor point, plus a square marker at the
    // resolved vertex/edge/face — hollow while only hovering (nothing selected yet),
    // filled once actually selected/engaged. Square (not round) distinguishes this from
    // the sculpt brush ring at a glance.
    ctx.beginPath();
    ctx.moveTo(screenPoint.x - 5, screenPoint.y);
    ctx.lineTo(screenPoint.x + 5, screenPoint.y);
    ctx.moveTo(screenPoint.x, screenPoint.y - 5);
    ctx.lineTo(screenPoint.x, screenPoint.y + 5);
    ctx.stroke();

    if (pointer.selectionCenter) {
      const selWorld = mesh.localToWorld(pointer.selectionCenter.clone());
      const selScreen = worldToScreen(selWorld, camera, canvas);
      if (selScreen) {
        const half = engaged ? 5 : 3.5;
        ctx.beginPath();
        ctx.rect(selScreen.x - half, selScreen.y - half, half * 2, half * 2);
        if (engaged) ctx.fill();
        else ctx.stroke();

        ctx.font = '9px monospace';
        ctx.fillText(pointer.selectionMode ?? '', selScreen.x + half + 5, selScreen.y + 3);
      }
    }
  }
}

function operatorLabel(operator: SculptOperator): string {
  switch (operator) {
    case 'GRAB':
      return 'GRAB';
    case 'INFLATE_DEFLATE':
      return 'INFLATE';
    case 'CREASE':
      return 'CREASE';
    case 'SMOOTH':
      return 'SMOOTH';
  }
}

function zoneColor(mode: InteractionMode): string {
  switch (mode) {
    case 'SCULPTING':
    case 'HOVER_MESH':
      return 'rgba(57,255,20,0.85)';
    case 'EDITING':
    case 'HOVER_EDIT':
      return 'rgba(200,60,255,0.85)';
    case 'HEIGHT_EDIT':
    case 'HOVER_HEIGHT':
      return 'rgba(25,193,255,0.85)';
    case 'WIDTH_EDIT':
    case 'HOVER_WIDTH':
      return 'rgba(255,214,25,0.85)';
    case 'ROTATING':
    case 'HOVER_ROTATE':
      return 'rgba(255,138,26,0.85)';
    default:
      return 'rgba(26,26,26,0.5)';
  }
}

function drawSkeletonOnViewport(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  lm: HandState['landmarks']
): void {
  ctx.strokeStyle = 'rgba(26,26,26,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    ctx.moveTo((1 - lm[a].x) * canvas.width, lm[a].y * canvas.height);
    ctx.lineTo((1 - lm[b].x) * canvas.width, lm[b].y * canvas.height);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(26,26,26,0.55)';
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc((1 - p.x) * canvas.width, p.y * canvas.height, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function worldToScreen(world: THREE.Vector3, camera: THREE.Camera, canvas: HTMLCanvasElement): { x: number; y: number } | null {
  const ndc = world.clone().project(camera);
  if (ndc.z > 1 || ndc.z < -1) return null;
  return { x: ((ndc.x + 1) / 2) * canvas.width, y: ((1 - ndc.y) / 2) * canvas.height };
}

const scratchRight = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();

function projectedRadius(worldCenter: THREE.Vector3, radius: number, camera: THREE.Camera, canvas: HTMLCanvasElement): number {
  camera.updateMatrixWorld();
  scratchRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  scratchOffset.copy(worldCenter).addScaledVector(scratchRight, radius);

  const centerScreen = worldToScreen(worldCenter, camera, canvas);
  const offsetScreen = worldToScreen(scratchOffset, camera, canvas);
  if (!centerScreen || !offsetScreen) return 0;
  return Math.hypot(offsetScreen.x - centerScreen.x, offsetScreen.y - centerScreen.y);
}
