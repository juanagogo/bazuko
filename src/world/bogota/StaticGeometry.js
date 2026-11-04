import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const STATIC_CHUNK_SIZE = 32;
const center = new THREE.Vector3();

export function geometryChunk(geometry, matrix = null, chunkSize = STATIC_CHUNK_SIZE) {
  geometry.computeBoundingBox();
  geometry.boundingBox.getCenter(center);
  if (matrix) center.applyMatrix4(matrix);
  return `${Math.floor(center.x / chunkSize)},${Math.floor(center.z / chunkSize)}`;
}

/** Mantiene geometría localizable por el frustum, sin una malla que cubra toda la ciudad. */
export function mergeByChunk(geometries, material, { castShadow = false, receiveShadow = false } = {}) {
  const group = new THREE.Group(), buckets = new Map();
  for (const geometry of geometries) {
    const key = geometryChunk(geometry);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(geometry);
  }
  for (const list of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(list), material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.geometry.computeBoundingSphere();
    group.add(mesh);
  }
  for (const geometry of geometries) geometry.dispose();
  return group;
}

/** Solo inmuebles: conserva matrices de bus, llamas, ropa tendida y otros animados. */
export function freezeStaticTransforms(root, dynamicRoot = null) {
  root.updateMatrixWorld(true);
  const visit = object => {
    if (object === dynamicRoot || dynamicRoot?.has?.(object) || object.userData.update) return;
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
    for (const child of object.children) visit(child);
  };
  visit(root);
}

/** Agrupa ramas completas sin alterar transformaciones locales ni referencias de edificios. */
export function createRenderSectors(root, excluded = new Set(), chunkSize = STATIC_CHUNK_SIZE) {
  root.updateWorldMatrix(true, true);
  const sectors = new Map(), bounds = new THREE.Box3();
  const inverse = root.matrixWorld.clone().invert();
  for (const child of [...root.children]) {
    if (excluded.has(child) || child.userData.update) continue;
    bounds.setFromObject(child);
    if (bounds.isEmpty()) continue;
    bounds.getCenter(center).applyMatrix4(inverse);
    const key = `${Math.floor(center.x / chunkSize)},${Math.floor(center.z / chunkSize)}`;
    if (!sectors.has(key)) {
      const sector = new THREE.Group();
      sector.name = `Sector ${key}`;
      sectors.set(key, sector);
      root.add(sector);
    }
    // El nuevo padre tiene transformación identidad respecto al anterior.
    sectors.get(key).add(child);
  }
  return [...sectors.values()];
}

/** Instancias de mobiliario ya cargado: mantiene luces y referencias en sus raíces. */
export function instanceStaticModels(roots, parent) {
  parent.updateWorldMatrix(true, false);
  const inverse = parent.matrixWorld.clone().invert(), buckets = new Map();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverseVisible(mesh => {
      if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.morphTargetInfluences) return;
      const matrix = inverse.clone().multiply(mesh.matrixWorld);
      // InstancedMesh no admite escalas reflejadas.
      if (matrix.determinant() <= 0) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some(material => material.transparent)) return;
      const key = `${mesh.geometry.uuid}|${materials.map(material => material.uuid).join(',')}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.layers.mask}|${mesh.renderOrder}|${geometryChunk(mesh.geometry, matrix)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ mesh, matrix });
    });
  }
  const group = new THREE.Group();
  group.name = 'Mobiliario importado instanciado';
  group.userData.noMerge = true;
  for (const entries of buckets.values()) {
    const source = entries[0].mesh;
    const batch = new THREE.InstancedMesh(source.geometry, source.material, entries.length);
    batch.castShadow = source.castShadow;
    batch.receiveShadow = source.receiveShadow;
    batch.layers.mask = source.layers.mask;
    batch.renderOrder = source.renderOrder;
    for (let i = 0; i < entries.length; i++) {
      batch.setMatrixAt(i, entries[i].matrix);
      entries[i].mesh.visible = false;
    }
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    group.add(batch);
  }
  return group;
}
