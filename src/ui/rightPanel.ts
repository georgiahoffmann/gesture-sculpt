import { MATERIAL_LIBRARY } from '../modeling/materialLibrary';
import type { LightingParams } from '../scene/lighting';
import type { SculptOperator } from '../sculpt/strokeDeformer';
import type { SelectionMode } from '../modeling/selectionManager';
import type { EditOperator } from '../modeling/editManipulator';

export type AppMode = 'SCULPT' | 'EDIT';

/** Which selection mode each EDIT operator needs to be usable — see docs/BLENDER_MAPPING.md Phase 3. */
const EDIT_OPERATOR_REQUIRES: Record<EditOperator, SelectionMode | null> = {
  MOVE: null,
  EXTRUDE: 'FACE',
  INSET: 'FACE',
  SUBDIVIDE: 'FACE',
  BEVEL: 'EDGE',
};

export interface RightPanelCallbacks {
  onSmooth(): void;
  onReset(): void;
  onFreeze(): void;
  onBack(): void;
  onResolutionChange(segments: number): void;
  onMaterialSelect(index: number): void;
  onLightingChange(partial: Partial<LightingParams>): void;
  onHeightManualDelta(deltaWorld: number): void;
  onAppModeChange(mode: AppMode): void;
  onSelectionModeChange(mode: SelectionMode): void;
  onExportSvg(): void;
  onExportPy(): void;
  onExportJson(): void;
  onExportObj(): void;
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

/**
 * Restores the first version's right-hand panel structure (04 · FORM_PARAMETERS
 * / 05 · CONFIRMAÇÃO while sculpting, 06 · MATERIAL / 07 · STUDIO_LIGHT /
 * 08 · EXPORT after freezing) against the new sculpt model's controls.
 */
export class RightPanel {
  private sculptPanel = el<HTMLElement>('sculptPanel');
  private finishPanel = el<HTMLElement>('finishPanel');

  private resolutionSlider = el<HTMLInputElement>('resolutionSlider');
  private resolutionLabel = el<HTMLElement>('resolutionLabel');
  private resolutionNote = el<HTMLElement>('resolutionNote');
  private brushRadiusSlider = el<HTMLInputElement>('brushRadiusSlider');
  private brushRadiusLabel = el<HTMLElement>('brushRadiusLabel');
  private brushStrengthSlider = el<HTMLInputElement>('brushStrengthSlider');
  private brushStrengthLabel = el<HTMLElement>('brushStrengthLabel');
  private brushHardnessSlider = el<HTMLInputElement>('brushHardnessSlider');
  private brushHardnessLabel = el<HTMLElement>('brushHardnessLabel');
  private heightSlider = el<HTMLInputElement>('heightSlider');
  private heightLabel = el<HTMLElement>('heightLabel');
  private operatorButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#operatorGroup .btn-toggle'));
  private selectedOperator: SculptOperator = 'GRAB';

  private appModeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#appModeGroup .btn-toggle'));
  private selectionModeField = el<HTMLElement>('selectionModeField');
  private selectionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#selectionGroup .btn-toggle'));
  private selectedAppMode: AppMode = 'SCULPT';
  private selectedSelectionMode: SelectionMode = 'VERTEX';

  private editOperatorField = el<HTMLElement>('editOperatorField');
  private editOperatorButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#editOperatorGroup .btn-toggle'));
  private selectedEditOperator: EditOperator = 'MOVE';
  private falloffField = el<HTMLElement>('falloffField');
  private falloffSlider = el<HTMLInputElement>('falloffSlider');
  private falloffLabel = el<HTMLElement>('falloffLabel');

  private materialList = el<HTMLElement>('materialList');
  private materialCode = el<HTMLElement>('materialCode');
  private materialButtons: HTMLButtonElement[] = [];

  private keyIntensitySlider = el<HTMLInputElement>('keyIntensitySlider');
  private keyIntensityLabel = el<HTMLElement>('keyIntensityLabel');
  private keyAzimuthSlider = el<HTMLInputElement>('keyAzimuthSlider');
  private keyAzimuthLabel = el<HTMLElement>('keyAzimuthLabel');
  private fillSlider = el<HTMLInputElement>('fillSlider');
  private fillLabel = el<HTMLElement>('fillLabel');
  private shadowSlider = el<HTMLInputElement>('shadowSlider');
  private shadowLabel = el<HTMLElement>('shadowLabel');
  private specularSlider = el<HTMLInputElement>('specularSlider');
  private specularLabel = el<HTMLElement>('specularLabel');

  private lastHeightPercent = 0;

  constructor(private callbacks: RightPanelCallbacks) {
    this.resolutionSlider.addEventListener('change', () => {
      this.callbacks.onResolutionChange(+this.resolutionSlider.value);
    });
    this.resolutionSlider.addEventListener('input', () => {
      this.resolutionLabel.textContent = this.resolutionSlider.value;
    });

    this.brushRadiusSlider.addEventListener('input', () => {
      this.brushRadiusLabel.textContent = (+this.brushRadiusSlider.value).toFixed(2);
    });
    this.brushStrengthSlider.addEventListener('input', () => {
      this.brushStrengthLabel.textContent = (+this.brushStrengthSlider.value).toFixed(2);
    });
    this.brushHardnessSlider.addEventListener('input', () => {
      this.brushHardnessLabel.textContent = hardnessLabel(+this.brushHardnessSlider.value);
    });
    this.brushHardnessLabel.textContent = hardnessLabel(+this.brushHardnessSlider.value);

    this.operatorButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedOperator = (button.dataset.operator as SculptOperator) ?? 'GRAB';
        this.updateOperatorButtons();
      });
    });
    this.updateOperatorButtons();

    this.appModeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedAppMode = (button.dataset.appMode as AppMode) ?? 'SCULPT';
        this.updateAppModeButtons();
        this.callbacks.onAppModeChange(this.selectedAppMode);
      });
    });
    this.updateAppModeButtons();

    this.selectionButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedSelectionMode = (button.dataset.selection as SelectionMode) ?? 'VERTEX';
        this.updateSelectionButtons();
        this.updateEditOperatorButtons();
        this.callbacks.onSelectionModeChange(this.selectedSelectionMode);
      });
    });
    this.updateSelectionButtons();

    this.editOperatorButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const operator = button.dataset.editOperator as EditOperator;
        const requires = EDIT_OPERATOR_REQUIRES[operator];
        if (requires && requires !== this.selectedSelectionMode) return; // disabled, but belt-and-suspenders
        this.selectedEditOperator = operator;
        this.updateEditOperatorButtons();
      });
    });
    this.updateEditOperatorButtons();

    this.falloffSlider.addEventListener('input', () => {
      this.falloffLabel.textContent = (+this.falloffSlider.value).toFixed(2);
    });
    this.falloffLabel.textContent = (+this.falloffSlider.value).toFixed(2);

    this.heightSlider.addEventListener('input', () => {
      const percent = +this.heightSlider.value;
      this.heightLabel.textContent = `${percent}%`;
      const delta = ((percent - this.lastHeightPercent) / 100) * 1.2; // slider spans -50%..50% of ~1.2 world units of headroom
      this.lastHeightPercent = percent;
      this.callbacks.onHeightManualDelta(delta);
    });

    el<HTMLButtonElement>('smoothButton').addEventListener('click', () => this.callbacks.onSmooth());
    el<HTMLButtonElement>('resetButton').addEventListener('click', () => {
      this.heightSlider.value = '0';
      this.heightLabel.textContent = '0%';
      this.lastHeightPercent = 0;
      this.callbacks.onReset();
    });
    el<HTMLButtonElement>('freezeButton').addEventListener('click', () => this.callbacks.onFreeze());
    el<HTMLButtonElement>('backButton').addEventListener('click', () => this.callbacks.onBack());

    el<HTMLButtonElement>('exportSvgButton').addEventListener('click', () => this.callbacks.onExportSvg());
    el<HTMLButtonElement>('exportPyButton').addEventListener('click', () => this.callbacks.onExportPy());
    el<HTMLButtonElement>('exportJsonButton').addEventListener('click', () => this.callbacks.onExportJson());
    el<HTMLButtonElement>('exportObjButton').addEventListener('click', () => this.callbacks.onExportObj());

    this.buildMaterialList();
    this.wireLightingSlider(this.keyIntensitySlider, this.keyIntensityLabel, (v) => ({ keyIntensity: v }), (v) => v.toFixed(2));
    this.wireLightingSlider(this.keyAzimuthSlider, this.keyAzimuthLabel, (v) => ({ keyAzimuthDeg: v }), (v) => `${v}°`);
    this.wireLightingSlider(this.fillSlider, this.fillLabel, (v) => ({ fillIntensity: v }), (v) => v.toFixed(2));
    this.wireLightingSlider(this.shadowSlider, this.shadowLabel, (v) => ({ shadowSoftness: v }), (v) => v.toFixed(2));
    this.wireLightingSlider(this.specularSlider, this.specularLabel, (v) => ({ specular: v }), (v) => v.toFixed(2));
  }

  private wireLightingSlider(
    slider: HTMLInputElement,
    label: HTMLElement,
    toPartial: (v: number) => Partial<LightingParams>,
    format: (v: number) => string
  ): void {
    label.textContent = format(+slider.value);
    slider.addEventListener('input', () => {
      const v = +slider.value;
      label.textContent = format(v);
      this.callbacks.onLightingChange(toPartial(v));
    });
  }

  private updateOperatorButtons(): void {
    this.operatorButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.operator === this.selectedOperator);
    });
  }

  private updateAppModeButtons(): void {
    this.appModeButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.appMode === this.selectedAppMode);
    });
    const editActive = this.selectedAppMode === 'EDIT';
    this.selectionModeField.hidden = !editActive;
    this.editOperatorField.hidden = !editActive;
    this.falloffField.hidden = !editActive;
    this.operatorButtons.forEach((button) => (button.disabled = editActive));
  }

  private updateSelectionButtons(): void {
    this.selectionButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.selection === this.selectedSelectionMode);
    });
  }

  private updateEditOperatorButtons(): void {
    let fellBack = false;
    this.editOperatorButtons.forEach((button) => {
      const operator = button.dataset.editOperator as EditOperator;
      const requires = EDIT_OPERATOR_REQUIRES[operator];
      const usable = !requires || requires === this.selectedSelectionMode;
      button.disabled = !usable;
      if (!usable && operator === this.selectedEditOperator) fellBack = true;
    });
    if (fellBack) this.selectedEditOperator = 'MOVE';
    this.editOperatorButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.editOperator === this.selectedEditOperator);
    });
  }

  private buildMaterialList(): void {
    this.materialList.innerHTML = '';
    this.materialButtons = MATERIAL_LIBRARY.map((material, index) => {
      const button = document.createElement('button');
      button.className = 'material-item';
      button.innerHTML = `<span class="material-swatch" style="background:${material.swatch}"></span><span class="material-name">${material.name}</span><span class="material-dot" hidden></span>`;
      button.addEventListener('click', () => this.selectMaterial(index));
      this.materialList.appendChild(button);
      return button;
    });
    this.selectMaterial(0);
  }

  private selectMaterial(index: number): void {
    this.materialButtons.forEach((button, i) => {
      button.classList.toggle('selected', i === index);
      const dot = button.querySelector('.material-dot') as HTMLElement;
      dot.hidden = i !== index;
    });
    this.materialCode.textContent = MATERIAL_LIBRARY[index].code;
    this.callbacks.onMaterialSelect(index);
  }

  setMode(mode: 'SCULPT' | 'FINISH'): void {
    this.sculptPanel.hidden = mode !== 'SCULPT';
    this.finishPanel.hidden = mode !== 'FINISH';
  }

  lockResolution(locked: boolean): void {
    this.resolutionSlider.disabled = locked;
    this.resolutionNote.textContent = locked
      ? 'Travado após o primeiro traço — mudar a resolução agora reconstruiria a malha e perderia o que já foi esculpido.'
      : '';
  }

  get brushSettings() {
    return {
      radius: +this.brushRadiusSlider.value,
      strength: +this.brushStrengthSlider.value,
      hardness: +this.brushHardnessSlider.value,
      operator: this.selectedOperator,
    };
  }

  get editSettings() {
    return {
      operator: this.selectedEditOperator,
      falloffRadius: +this.falloffSlider.value,
    };
  }
}

function hardnessLabel(v: number): string {
  if (v < 0.2) return 'SOFT';
  if (v < 0.45) return 'SOFT-MED';
  if (v < 0.65) return 'MEDIUM';
  if (v < 0.85) return 'MED-HARD';
  return 'HARD';
}
