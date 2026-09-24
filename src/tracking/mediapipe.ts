import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

/**
 * MediaPipe Tasks Vision setup. This is the ONLY file that talks to the
 * `@mediapipe/tasks-vision` package directly — everything else consumes the
 * normalized `HandState` produced by `handTracker.ts`.
 *
 * The wasm runtime and the .task model are fetched from CDN at runtime rather
 * than bundled, so the Vite build stays small and deployable as a static site.
 * The wasm version MUST match the installed npm package exactly (package.json
 * pins it) — a JS/wasm mismatch makes createFromOptions fail.
 */
const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export async function createHandLandmarker(maxHands: number): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  const create = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_ASSET_URL,
        delegate,
      },
      runningMode: 'VIDEO',
      numHands: maxHands,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
  try {
    return await create('GPU');
  } catch (err) {
    console.warn('[mediapipe] GPU delegate failed, falling back to CPU', err);
    return create('CPU');
  }
}
