import type { TrackingStatus } from '../tracking/handTracker';

export interface StatusElements {
  stateReadout: HTMLElement;
  trackingReadout: HTMLElement;
  activityReadout: HTMLElement;
  segReadout: HTMLElement;
  statHands: HTMLElement;
  statFps: HTMLElement;
  statVertices: HTMLElement;
  statTriangles: HTMLElement;
  statSegments: HTMLElement;
  debugOutput: HTMLElement;
}

export interface StatusUpdateInput {
  stateLabel: string;
  activityLabel: string;
  trackingStatus: TrackingStatus;
  handsCount: number;
  fps: number;
  vertices: number;
  triangles: number;
  segments: number;
  debugVisible: boolean;
  debugLines: string[];
}

/** Direct, targeted DOM text updates — each field only written when it actually changed. */
export class StatusPanel {
  private lastValues = new Map<string, string>();

  constructor(private els: StatusElements) {}

  private setText(el: HTMLElement, key: string, value: string): void {
    if (this.lastValues.get(key) === value) return;
    this.lastValues.set(key, value);
    el.textContent = value;
  }

  update(input: StatusUpdateInput): void {
    this.setText(this.els.stateReadout, 'state', input.stateLabel);
    this.setText(this.els.trackingReadout, 'tracking', trackingStatusLabel(input.trackingStatus));
    this.setText(this.els.activityReadout, 'activity', `STATUS: ${input.activityLabel}`);
    this.setText(this.els.segReadout, 'seg', `SEG: ${input.segments}`);
    this.setText(this.els.statHands, 'hands', String(input.handsCount));
    this.setText(this.els.statFps, 'fps', String(input.fps));
    this.setText(this.els.statVertices, 'vertices', String(input.vertices));
    this.setText(this.els.statTriangles, 'triangles', String(input.triangles));
    this.setText(this.els.statSegments, 'segments', String(input.segments));

    if (!input.debugVisible) return;
    this.setText(this.els.debugOutput, 'debug', input.debugLines.join('\n'));
  }
}

function trackingStatusLabel(status: TrackingStatus): string {
  switch (status) {
    case 'active':
      return 'TRACKING_ACTIVE';
    case 'requesting':
      return 'REQUESTING';
    case 'denied':
      return 'CAM_DENIED';
    case 'error':
      return 'ERROR';
    case 'unsupported':
      return 'UNSUPPORTED';
    default:
      return 'OFFLINE';
  }
}
