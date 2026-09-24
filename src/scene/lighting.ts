import * as THREE from 'three';

export interface LightingParams {
  keyIntensity: number;
  keyAzimuthDeg: number;
  fillIntensity: number;
  shadowSoftness: number;
  specular: number;
}

export const DEFAULT_LIGHTING_PARAMS: LightingParams = {
  keyIntensity: 1.7,
  keyAzimuthDeg: 40,
  fillIntensity: 0.5,
  shadowSoftness: 0.6,
  specular: 0.35,
};

/** Studio lighting rig — restored from the first version's STUDIO_LIGHT panel, now update()-able at runtime. */
export class LightingRig {
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  params: LightingParams = { ...DEFAULT_LIGHTING_PARAMS };

  constructor(scene: THREE.Scene) {
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 0.5));

    this.key = new THREE.DirectionalLight(0xffffff, this.params.keyIntensity);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.left = -3;
    this.key.shadow.camera.right = 3;
    this.key.shadow.camera.top = 3;
    this.key.shadow.camera.bottom = -3;
    scene.add(this.key);

    this.fill = new THREE.DirectionalLight(0xffffff, this.params.fillIntensity);
    scene.add(this.fill);

    this.apply();
  }

  update(partial: Partial<LightingParams>): void {
    this.params = { ...this.params, ...partial };
    this.apply();
  }

  /** Specular is read by whoever owns the finish material — exposed here since it's a lighting-panel control. */
  get specularRoughnessBias(): number {
    return this.params.specular * 0.35;
  }

  private apply(): void {
    const angle = (this.params.keyAzimuthDeg * Math.PI) / 180;
    this.key.position.set(Math.sin(angle) * 4, 4.2, Math.cos(angle) * 4);
    this.key.intensity = this.params.keyIntensity;
    this.fill.intensity = this.params.fillIntensity;
    this.key.shadow.radius = 1 + this.params.shadowSoftness * 8;
  }
}
