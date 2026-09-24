import * as THREE from 'three';

/**
 * Perspective camera fixed at a soft isometric-style angle, matching the
 * previous prototype's presentation.
 *
 * Why Perspective and not Orthographic for this milestone: the brief's depth
 * (Z-axis) gesture relies on the object visually growing/shrinking as it
 * moves toward/away from the camera as feedback that depth manipulation is
 * happening. An orthographic camera removes that size cue entirely, which
 * would make the hardest-to-calibrate gesture even harder to read. `CameraRig`
 * only exposes `getCamera()` / `frame()` so a future orthographic or
 * front/side/top mode can be added later without touching call sites.
 */
export class CameraRig {
  private camera: THREE.PerspectiveCamera;
  private theta = Math.PI / 4;
  private phi = Math.atan(1 / Math.SQRT2);
  private distance = 6.5;
  private target = new THREE.Vector3(0, 0.5, 0);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(32, aspect, 0.1, 100);
    this.updatePosition();
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  private updatePosition(): void {
    this.camera.position.set(
      this.distance * Math.cos(this.phi) * Math.sin(this.theta),
      this.distance * Math.sin(this.phi) + this.target.y,
      this.distance * Math.cos(this.phi) * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }

  orbit(deltaTheta: number, deltaPhi: number): void {
    this.theta -= deltaTheta;
    this.phi = Math.max(-0.4, Math.min(1.3, this.phi + deltaPhi));
    this.updatePosition();
  }

  zoom(deltaDistance: number): void {
    this.distance = Math.min(14, Math.max(3, this.distance + deltaDistance));
    this.updatePosition();
  }
}
