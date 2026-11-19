import * as THREE from 'three';

// Centros y radios de grupos de rizos sobre la coronilla. Coordenadas relativas a la mata de pelo.
const CLUSTERS = [
  [-.59, .32, .57], [.05, .43, .51], [.61, .21, .56],
  [-.45, -.36, .54], [.19, -.44, .59], [.63, -.45, .41]
];
const MAX_RELIEF = .0125; // la cresta deja como máximo unos 16 mm sobre la forma original
const shapedGeometry = new WeakMap();

/** Añade volumen a las capas grandes que conservó el recorte. Se genera una vez por malla de reposo. */
export function curlVolume(geometry, toRest) {
  if (shapedGeometry.has(geometry)) return shapedGeometry.get(geometry);
  const { index, attributes: { position, normal } } = geometry;
  if (!index || !position || !normal) return geometry;
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const used = new Set(index.array);
  for (const vertex of used) bounds.expandByPoint(point.fromBufferAttribute(position, vertex).applyMatrix4(toRest));
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);
  if (size.x < .001 || size.z < .001) return geometry;

  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) result.setAttribute(name, attribute);
  result.setIndex(index);
  const vertices = position.clone(), normals = normal.clone();
  const fromRest = toRest.clone().invert();
  const normalToRest = new THREE.Matrix3().getNormalMatrix(toRest);
  const normalFromRest = new THREE.Matrix3().getNormalMatrix(fromRest);
  const n = new THREE.Vector3(), gradient = new THREE.Vector3();
  const smooth = THREE.MathUtils.smoothstep;
  for (const vertex of used) {
    point.fromBufferAttribute(position, vertex).applyMatrix4(toRest);
    const x = (point.x - center.x) / size.x, z = (point.z - center.z) / size.z;
    // El relieve se deshace hacia sienes, nuca y frente para conservar la implantación.
    const crown = smooth(point.y, bounds.max.y - .053, bounds.max.y - .015);
    const amplitude = MAX_RELIEF * crown * (1 - smooth(z, .37, .84) * .84);
    if (!amplitude) continue;

    let relief = 0, slopeX = 0, slopeZ = 0;
    for (const [cx, cz, radius] of CLUSTERS) {
      const dx = x - cx, dz = z - cz;
      const round = Math.max(0, 1 - (dx * dx + dz * dz) / (radius * radius));
      const bulge = round * round;
      if (bulge <= relief) continue;
      relief = bulge;
      const slope = -4 * round / (radius * radius);
      slopeX = slope * dx / size.x;
      slopeZ = slope * dz / size.z;
    }

    n.fromBufferAttribute(normal, vertex).applyMatrix3(normalToRest).normalize();
    point.addScaledVector(n, (relief - .28) * amplitude).applyMatrix4(fromRest);
    vertices.setXYZ(vertex, point.x, point.y, point.z);
    // Pendiente tangente al pelo. La normal original sigue orientando las láminas en el borde.
    gradient.set(slopeX * amplitude, 0, slopeZ * amplitude);
    gradient.addScaledVector(n, -gradient.dot(n));
    gradient.clampLength(0, .36);
    n.sub(gradient).applyMatrix3(normalFromRest).normalize();
    normals.setXYZ(vertex, n.x, n.y, n.z);
  }

  result.setAttribute('position', vertices);
  result.setAttribute('normal', normals);
  result.computeBoundingBox();
  result.computeBoundingSphere();
  shapedGeometry.set(geometry, result);
  return result;
}
