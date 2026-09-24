import * as THREE from 'three';

/** Exports the ACTUAL current vertex/face buffers — WYSIWYG, no assumption of symmetry or revolution. */
export function exportOBJ(geometry: THREE.BufferGeometry): string {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.index;

  let out = '# GESTURE_SCULPT · mm · freeform mesh\no SculptedProduct\n';
  for (let i = 0; i < position.count; i++) {
    out += `v ${(position.getX(i) * 100).toFixed(4)} ${(position.getY(i) * 100).toFixed(4)} ${(position.getZ(i) * 100).toFixed(4)}\n`;
  }
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      out += `f ${index.getX(i) + 1} ${index.getX(i + 1) + 1} ${index.getX(i + 2) + 1}\n`;
    }
  }
  return out;
}
