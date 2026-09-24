import * as THREE from 'three';

/**
 * Orthographic front-view projection of the REAL mesh. Deliberately draws
 * every unique edge (an actual wireframe projection) rather than trying to
 * compute a silhouette outline via a convex hull: this mesh can be concave
 * (that's the whole point of local sculpting), and a hull would visually
 * paper over any concavity facing the camera — an edge-accurate wireframe is
 * the version of "WYSIWYG" that doesn't quietly lie about the shape.
 */
export function exportSVGProjection(geometry: THREE.BufferGeometry): string {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.index;

  const scale = 100; // local units -> mm
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) * scale;
    const y = position.getY(i) * scale;
    points.push(new THREE.Vector2(x, y));
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const edges = new Set<string>();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      edges.add(edgeKey(a, b));
      edges.add(edgeKey(b, c));
      edges.add(edgeKey(c, a));
    }
  }

  const pad = 20;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const toSvgY = (y: number) => height - pad - (y - minY); // flip: SVG y grows downward, mesh y grows upward

  let lines = '';
  for (const key of edges) {
    const [aStr, bStr] = key.split('_');
    const a = points[Number(aStr)];
    const b = points[Number(bStr)];
    lines += `<line x1="${(a.x - minX + pad).toFixed(2)}" y1="${toSvgY(a.y).toFixed(2)}" x2="${(b.x - minX + pad).toFixed(2)}" y2="${toSvgY(b.y).toFixed(2)}" stroke="#1a1a1a" stroke-width="0.4"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(1)}" height="${height.toFixed(1)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}">` +
    `<rect width="100%" height="100%" fill="#f4f4f4"/>` +
    `<text x="8" y="14" font-family="monospace" font-size="7" fill="#1a1a1a">ORTHOGRAPHIC WIREFRAME PROJECTION · FRONT · MM</text>` +
    lines +
    `</svg>`
  );
}
