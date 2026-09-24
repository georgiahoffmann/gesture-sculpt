import type { HandTracker } from '../tracking/handTracker';

/**
 * Wires the camera on/off button. Primary (green) = "activate", Secondary
 * (gray) = "deactivate" — matches the two-state button pattern from the
 * previous prototype, preserved here rather than redesigned.
 */
export function setupCameraToggle(button: HTMLButtonElement, tracker: HandTracker, onChange: () => void): void {
  const render = () => {
    const active = tracker.status === 'active';
    button.textContent = active
      ? 'DESATIVAR CÂMERA'
      : tracker.status === 'requesting'
        ? 'CONECTANDO...'
        : tracker.status === 'denied'
          ? 'PERMISSÃO NEGADA — TENTAR NOVAMENTE'
          : tracker.status === 'unsupported'
            ? 'CÂMERA INDISPONÍVEL (USE HTTPS)'
            : tracker.status === 'error'
              ? 'ERRO — TENTAR NOVAMENTE'
              : 'ATIVAR CÂMERA';
    button.classList.toggle('btn-primary', !active);
    button.classList.toggle('btn-secondary', active);
  };

  button.addEventListener('click', async () => {
    if (tracker.status === 'active') {
      tracker.stop();
      render();
      onChange();
      return;
    }
    render();
    try {
      await tracker.start();
    } catch {
      // status already reflects denied/error; render() below picks it up.
    }
    render();
    onChange();
  });

  render();
}

export function setupDebugToggle(button: HTMLButtonElement, panel: HTMLElement): void {
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.classList.toggle('btn-primary', !panel.hidden);
  });
}
