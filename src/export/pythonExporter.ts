import * as THREE from 'three';

/**
 * Generates a Blender bpy script that rebuilds the mesh from its REAL
 * vertices/faces. The first version generated a profile + 360° spin, which
 * only worked because that mesh WAS a solid of revolution — this one isn't,
 * so this exporter writes the actual (possibly asymmetric) vertex/face data.
 */
export function exportPython(geometry: THREE.BufferGeometry): string {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.index;

  const verts: string[] = [];
  for (let i = 0; i < position.count; i++) {
    verts.push(
      `(${(position.getX(i) * 0.001 * 100).toFixed(5)}, ${(position.getZ(i) * 0.001 * 100).toFixed(5)}, ${(position.getY(i) * 0.001 * 100).toFixed(5)})`
    );
  }

  const faces: string[] = [];
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      faces.push(`(${index.getX(i)}, ${index.getX(i + 1)}, ${index.getX(i + 2)})`);
    }
  }

  return [
    '# GESTURE_SCULPT export · real freeform mesh (vertices + faces, not a profile spin)',
    '# Blender 3.x+ / bpy · units: millimeters (scaled 0.001)',
    'import bpy',
    '',
    `VERTS = [${verts.join(', ')}]`,
    `FACES = [${faces.join(', ')}]`,
    '',
    'mesh = bpy.data.meshes.new("SculptedProduct")',
    'mesh.from_pydata(VERTS, [], FACES)',
    'mesh.update()',
    'obj = bpy.data.objects.new("SculptedProduct", mesh)',
    'bpy.context.collection.objects.link(obj)',
    'bpy.ops.object.select_all(action="DESELECT")',
    'obj.select_set(True)',
    'bpy.context.view_layer.objects.active = obj',
    'bpy.ops.object.shade_smooth()',
  ].join('\n');
}
