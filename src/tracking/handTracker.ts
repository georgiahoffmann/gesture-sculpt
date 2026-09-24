import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { createHandLandmarker } from './mediapipe';
import { HandSmoothing } from './handSmoothing';
import { LM, distance2D, isFingerExtended, clamp01, palmCenterOf, handSpanOf, handWidthOf, gripDistanceOf, isHandHorizontal } from './landmarkUtils';
import type { HandState, Handedness, Point3D } from './types';
import { INTERACTION_CONFIG } from '../config/interactionConfig';

export type TrackingStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported' | 'error';

/**
 * Owns the webcam <video> element, the MediaPipe HandLandmarker instance, and
 * the per-frame detection call. This is pull-based: `update()` is called once
 * per Three.js render frame from main.ts, rather than running its own
 * independent loop — that keeps webcam inference and 3D rendering on a single
 * clock instead of two competing rAF loops.
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private smoothing = new HandSmoothing(INTERACTION_CONFIG.smoothing.landmarkFactor);
  private lastVideoTime = -1;
  private latestStates: HandState[] = [];

  status: TrackingStatus = 'idle';

  constructor(private video: HTMLVideoElement) {}

  async start(): Promise<void> {
    if (this.status === 'active' || this.status === 'requesting') return;
    this.status = 'requesting';
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        this.status = 'unsupported';
        throw new Error('getUserMedia unavailable (page must be served over HTTPS or localhost)');
      }
      // Ask for the camera first so the permission prompt appears immediately,
      // then load the (slower) model. The landmarker is reused across restarts.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
      });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      this.landmarker ??= await createHandLandmarker(INTERACTION_CONFIG.tracking.maxHands);
      this.status = 'active';
    } catch (err) {
      console.error('[HandTracker] failed to start', err);
      if (this.stream) this.stop();
      if (this.status !== 'unsupported') {
        this.status = (err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'error';
      }
      throw err;
    }
  }

  stop(): void {
    this.status = 'idle';
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.latestStates = [];
    this.smoothing.reset();
    this.lastVideoTime = -1;
  }

  /**
   * Runs inference at most once per new video frame and returns the latest
   * smoothed hand states. Safe to call every render frame — it's a no-op
   * (returns cached result) when the video hasn't produced a new frame yet.
   */
  update(nowMs: number): HandState[] {
    if (this.status !== 'active' || !this.landmarker) return this.latestStates;
    if (this.video.readyState < 2) return this.latestStates;
    if (this.video.currentTime === this.lastVideoTime) return this.latestStates;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, nowMs);
    const states: HandState[] = [];
    const count = Math.min(result.landmarks.length, result.handedness.length);

    for (let i = 0; i < count; i++) {
      const category = result.handedness[i][0];
      if (!category) continue;
      const confidence = category.score;
      if (confidence < INTERACTION_CONFIG.tracking.minConfidence) continue;

      const handedness = category.categoryName as Handedness;
      const raw: Point3D[] = result.landmarks[i].map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const landmarks = this.smoothing.smooth(handedness, raw);
      states.push(buildHandState(handedness, confidence, landmarks));
    }

    this.latestStates = states;
    return states;
  }
}

function buildHandState(handedness: Handedness, confidence: number, landmarks: Point3D[]): HandState {
  const thumbTip = landmarks[LM.THUMB_TIP];
  const indexTip = landmarks[LM.INDEX_TIP];
  const wrist = landmarks[LM.WRIST];
  const pinchDistance = distance2D(thumbTip, indexTip);
  const palmCenter = palmCenterOf(landmarks);
  const handSpan = handSpanOf(landmarks);
  const handWidth = handWidthOf(landmarks);
  const pinchNormalized = pinchDistance / handWidth;
  const pinchStrength = clamp01(1 - pinchNormalized);
  const gripNormalized = gripDistanceOf(landmarks) / handWidth;
  const pointing = isFingerExtended(landmarks, LM.INDEX_TIP, LM.INDEX_PIP);
  const isHorizontal = isHandHorizontal(landmarks);

  return {
    handedness,
    confidence,
    landmarks,
    indexTip,
    thumbTip,
    wrist,
    palmCenter,
    handSpan,
    handWidth,
    pinchDistance,
    pinchNormalized,
    pinchStrength,
    gripNormalized,
    pointing,
    isHorizontal,
  };
}
