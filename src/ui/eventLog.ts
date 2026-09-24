export interface EventLogRow {
  t: string;
  message: string;
}

/** Restored from the first version's EVENT_LOG panel. Renders itself immediately on every push — callers never need to remember to call render(). */
export class EventLog {
  private rows: EventLogRow[] = [];

  constructor(
    private container: HTMLElement,
    private maxRows = 6
  ) {}

  push(message: string): void {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    this.rows.unshift({ t, message });
    if (this.rows.length > this.maxRows) this.rows.length = this.maxRows;
    this.render();
  }

  private render(): void {
    const container = this.container;
    container.innerHTML = '';
    for (const row of this.rows) {
      const line = document.createElement('div');
      line.className = 'log-row';
      const t = document.createElement('span');
      t.className = 'log-t';
      t.textContent = row.t;
      const m = document.createElement('span');
      m.className = 'log-m';
      m.textContent = row.message;
      line.appendChild(t);
      line.appendChild(m);
      container.appendChild(line);
    }
  }
}
