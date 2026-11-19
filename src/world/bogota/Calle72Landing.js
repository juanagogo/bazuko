import * as THREE from 'three';
import { MeshKit, rgb, shade } from './MeshKit.js';

// El remate oriental cae en X 81, en el extremo de la cebra de Z 87.
// Todas las piezas quedan a la cota .06 del separador existente.
const HEIGHT = .06;
const SECTIONS = [
  [85.2, 88.8, 79, 81, 79, 81],
  [88.8, 103.5, 79, 80.8, 79, 80.8],
  [103.5, 107.5, 79, 80.8, 77.95, 79.75],
  [107.5, 109.9, 77.95, 79.75, 77.95, 79.75],
  [109.9, 115.1, 75.84, 79.75, 75.84, 79.75],
];

export function onCalle72Landing(x, z, radius = 0) {
  if (x + radius < 75.84 || x - radius >= 81 || z + radius < 85.2 || z - radius > 115.1) return false;
  return SECTIONS.some(([startZ, endZ, left, right, endLeft, endRight]) => {
    const from = Math.max(startZ, z - radius), to = Math.min(endZ, z + radius);
    if (from > to) return false;
    const a = (from - startZ) / (endZ - startZ), b = (to - startZ) / (endZ - startZ);
    const minX = Math.min(THREE.MathUtils.lerp(left, endLeft, a), THREE.MathUtils.lerp(left, endLeft, b));
    const maxX = Math.max(THREE.MathUtils.lerp(right, endRight, a), THREE.MathUtils.lerp(right, endRight, b));
    return x + radius >= minX && x - radius <= maxX;
  });
}

export function buildCalle72Landing(floor) {
  const kit = new MeshKit();
  const joint = rgb('#8e8b81'), panel = rgb('#d5d1c6'), brick = rgb('#a9816e');
  const up = [0, 1, 0];
  kit.uvOf = ([x, , z]) => [x / 6, z / 6];

  for (const [startZ, endZ, startLeft, startRight, endLeft, endRight] of SECTIONS) {
    const length = endZ - startZ, rows = Math.ceil(length / 1.08);
    const band = (z0, z1, x0, x1, color) => {
      const a = (z0 - startZ) / length, b = (z1 - startZ) / length;
      const leftA = THREE.MathUtils.lerp(startLeft, endLeft, a), rightA = THREE.MathUtils.lerp(startRight, endRight, a);
      const leftB = THREE.MathUtils.lerp(startLeft, endLeft, b), rightB = THREE.MathUtils.lerp(startRight, endRight, b);
      kit.quad([THREE.MathUtils.lerp(leftA, rightA, x0), HEIGHT, z0], [THREE.MathUtils.lerp(leftA, rightA, x1), HEIGHT, z0],
        [THREE.MathUtils.lerp(leftB, rightB, x1), HEIGHT, z1], [THREE.MathUtils.lerp(leftB, rightB, x0), HEIGHT, z1], color, { facing: up });
    };

    // Una hilada de ladrillo al ras limita las losas prefabricadas y la junta queda oscura.
    const width = startRight - startLeft;
    const edging = .14 / width, midJoint = .013 / width;
    for (let row = 0; row < rows; row++) {
      const z = startZ + row * length / rows, next = startZ + (row + 1) * length / rows;
      const divide = z + .015;
      band(z, divide, 0, 1, joint);
      band(divide, next, 0, edging, shade(brick, row % 2 ? .92 : 1.04));
      band(divide, next, edging, .5 - midJoint, shade(panel, row % 3 === 0 ? .94 : 1));
      band(divide, next, .5 - midJoint, .5 + midJoint, joint);
      band(divide, next, .5 + midJoint, 1 - edging, shade(panel, row % 3 === 1 ? .94 : 1));
      band(divide, next, 1 - edging, 1, shade(brick, row % 2 ? 1.02 : .92));
    }
  }
  const end = 81;
  kit.quad([end, 0, 85.2], [end, 0, 88.8], [end, HEIGHT, 88.8], [end, HEIGHT, 85.2], joint,
    { facing: [1, 0, 0], uv: [[0, 0], [.6, 0], [.6, .01], [0, .01]] });
  kit.quad([end, 0, 85.2], [end, HEIGHT, 85.2], [79, HEIGHT, 85.2], [79, 0, 85.2], joint,
    { facing: [0, 0, -1] });

  const material = new THREE.MeshStandardMaterial({ map: floor.map, bumpMap: floor.bumpMap, bumpScale: .016,
    roughness: .85, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  material.name = 'Losa prefabricada del acceso a Calle 72';
  const mesh = new THREE.Mesh(kit.geometry(), material);
  mesh.name = 'Andén peatonal de Calle 72';
  mesh.receiveShadow = true;
  mesh.userData.noMerge = true;
  return mesh;
}
