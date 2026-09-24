import type { InteractionMode } from '../interaction/interactionStateMachine';

export type RecordedPointerId = 'Left' | 'Right' | 'Mouse';

export interface GestureEpisode {
  id: number;
  ts: string;
  pointerId: RecordedPointerId;
  mode: InteractionMode;
  durationMs: number;
  /** What the app actually did — operator/selection/rotation-delta, whatever applyModeTransition had on hand at release. Not a description of the physical gesture: that has to come from whoever performed it, matched up afterward by episode # / timestamp. */
  detail: string;
}

interface OpenEpisode {
  mode: InteractionMode;
  startedAtMs: number;
  ts: string;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * Builds a gesture -> result guideline the way the app can actually help
 * with: it has no idea what physical hand motion a person just made, but it
 * knows EXACTLY what interaction result came out of it. So it segments each
 * pointer's engage/release cycle (the same ENGAGED_MODES the state machine
 * already tracks) into a numbered, timestamped "episode" while recording is
 * on — the idea is one gesture at a time, then match "episode #N at HH:MM:SS"
 * to whatever the person says they just did, either live or from the export.
 */
export class GestureRecorder {
  private _isRecording = false;
  private episodes: GestureEpisode[] = [];
  private open = new Map<RecordedPointerId, OpenEpisode>();
  private nextId = 1;

  constructor(
    private logContainer: HTMLElement,
    private countReadout: HTMLElement
  ) {
    this.render();
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  get count(): number {
    return this.episodes.length;
  }

  start(): void {
    this._isRecording = true;
  }

  stop(): void {
    this._isRecording = false;
    this.open.clear();
  }

  clear(): void {
    this.episodes = [];
    this.open.clear();
    this.nextId = 1;
    this.render();
  }

  /** Call when a pointer enters an engaged mode (SCULPTING/EDITING/HEIGHT_EDIT/ROTATING). No-op unless recording. */
  beginEpisode(pointerId: RecordedPointerId, mode: InteractionMode, nowMs: number): void {
    if (!this._isRecording) return;
    this.open.set(pointerId, { mode, startedAtMs: nowMs, ts: timestamp() });
  }

  /** Call when that same pointer releases. No-op unless recording (or if there was no matching begin — e.g. recording started mid-gesture). */
  endEpisode(pointerId: RecordedPointerId, nowMs: number, detail: string): void {
    if (!this._isRecording) return;
    const started = this.open.get(pointerId);
    this.open.delete(pointerId);
    if (!started) return;

    this.episodes.unshift({
      id: this.nextId++,
      ts: started.ts,
      pointerId,
      mode: started.mode,
      durationMs: Math.round(nowMs - started.startedAtMs),
      detail,
    });
    this.render();
  }

  getEpisodes(): readonly GestureEpisode[] {
    return this.episodes;
  }

  exportJSON(): string {
    return JSON.stringify({ exportedAt: new Date().toISOString(), episodes: [...this.episodes].reverse() }, null, 2);
  }

  /** A fill-in-the-blank draft — one row per episode, GESTURE column left empty for whoever performed it to describe, before folding the finished rows into docs/GESTURE_GUIDE.md. */
  exportMarkdown(): string {
    const rows = [...this.episodes].reverse();
    const lines = [
      '# Gesture recording session',
      '',
      `Exported ${new Date().toISOString()} — fill in GESTURE (the physical hand motion), then fold into docs/GESTURE_GUIDE.md.`,
      '',
      '| # | Time | Pointer | Mode | Duration (ms) | Result detail | Gesture (describe the hand motion) |',
      '|---|---|---|---|---|---|---|',
      ...rows.map((e) => `| ${e.id} | ${e.ts} | ${e.pointerId} | ${e.mode} | ${e.durationMs} | ${e.detail} | |`),
      '',
    ];
    return lines.join('\n');
  }

  private render(): void {
    this.countReadout.textContent = String(this.episodes.length);
    this.logContainer.innerHTML = '';
    for (const e of this.episodes) {
      const row = document.createElement('div');
      row.className = 'log-row';
      const t = document.createElement('span');
      t.className = 'log-t';
      t.textContent = e.ts;
      const m = document.createElement('span');
      m.className = 'log-m';
      m.textContent = `#${e.id} [${e.pointerId}] ${e.detail} (${e.durationMs}ms)`;
      row.appendChild(t);
      row.appendChild(m);
      this.logContainer.appendChild(row);
    }
  }
}
