import * as THREE from 'three';

/**
 * Instancias por celdas, adaptadas de chunkInstancedMesh en scene-culling.js de Slop New York (MIT).
 *
 * Un modelo repetido (farol, poste…) se dibuja como un InstancedMesh por malla del modelo y por
 * celda del mapa: comparte geometría y material (el mismo programa) y cada celda se descarta por el
 * frustum de la vista y de cada cascada. Antes cada copia era un dibujo en cada pasada.
 */
/** Celda por omisión de los lotes instanciados (faroles, postes): su descarte necesita ser más fino que el de las sombras. */
export const INSTANCE_CELL = 64;
const relative = new THREE.Matrix4();
const world = new THREE.Matrix4();

/** `transforms` son matrices de mundo de cada copia; se conserva la transformación propia de `model`. */
export function instanceModelByCells(model, transforms, { cell = INSTANCE_CELL, name = 'Instancias por celdas' } = {}) {
  model.updateMatrixWorld(true);
  const inverse = model.parent ? model.parent.matrixWorld.clone().invert() : new THREE.Matrix4(), parts = [];
  model.traverse(o => {
    if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh) parts.push({ mesh: o, matrix: new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld) });
  });
  const cells = new Map();
  for (const matrix of transforms) {
    const key = `${Math.floor(matrix.elements[12] / cell)},${Math.floor(matrix.elements[14] / cell)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(matrix);
  }
  const group = new THREE.Group();
  group.name = name;
  group.userData.noMerge = true;
  for (const [key, matrices] of cells) for (const { mesh, matrix } of parts) {
    const chunk = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
    matrices.forEach((m, i) => chunk.setMatrixAt(i, world.multiplyMatrices(m, relative.copy(matrix))));
    chunk.instanceMatrix.needsUpdate = true;
    chunk.name = `${mesh.name || 'malla'} · celda ${key}`;
    chunk.castShadow = mesh.castShadow;
    chunk.receiveShadow = mesh.receiveShadow;
    chunk.matrixAutoUpdate = false;
    chunk.computeBoundingSphere();
    chunk.computeBoundingBox();
    group.add(chunk);
  }
  group.updateMatrixWorld(true);
  return group;
}
