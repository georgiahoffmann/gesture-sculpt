import * as THREE from 'three';

/** Grid + ground only — lighting is owned by LightingRig (scene/lighting.ts) so the studio-light panel can adjust it live. */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();

  const grid = new THREE.GridHelper(8, 32, 0xc4c9ce, 0xdfe3e7);
  grid.position.y = -0.001;
  scene.add(grid);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return scene;
}
