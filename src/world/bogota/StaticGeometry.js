import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const STATIC_CHUNK_SIZE = 96;
const center = new THREE.Vector3();

export function geometryChunk(geometry, matrix = null) {
  geometry.computeBoundingBox();
  geometry.boundingBox.getCenter(center);
  if (matrix) center.applyMatrix4(matrix);
  return `${Math.floor(center.x / STATIC_CHUNK_SIZE)},${Math.floor(center.z / STATIC_CHUNK_SIZE)}`;
}

/**
 * Firma de todo lo que cambia el aspecto de un material: dos materiales con la misma firma se
 * dibujan igual. Ante un valor que no sabe comparar devuelve null (no se unifica).
 */
export function materialSignature(material) {
  const parts = [material.type];
  for (const key of Object.keys(material).sort()) {
    if (/^(uuid|id|name|version|userData|_.*)$/.test(key)) continue;
    const value = material[key];
    if (value === null || value === undefined) parts.push(`${key}:-`);
    else if (typeof value === 'function') continue;
    else if (value.isColor) parts.push(`${key}:${value.getHex()}`);
    else if (value.isTexture) parts.push(`${key}:t${value.id}`);
    else if (value.isVector2 || value.isVector3 || value.isEuler) parts.push(`${key}:${value.toArray().join(',')}`);
    else if (typeof value !== 'object') parts.push(`${key}:${value}`);
    else if (value.isNode || value.isPlane || Array.isArray(value)) return null;
    else try { parts.push(`${key}:${JSON.stringify(value)}`); } catch { return null; }
  }
  try { parts.push(`userData:${JSON.stringify(material.userData)}`); } catch { return null; }
  return parts.join('|');
}

/**
 * Los constructores crean un material por objeto aunque sean idénticos; así casi nada comparte
 * material y la fusión estática no puede juntar mallas. Devuelve un material canónico por firma,
 * salvo los `protectedMaterials`, que el juego modifica en partida y deben seguir siendo únicos.
 */
export class MaterialDeduper {
  constructor(protectedMaterials = new Set()) {
    this.protected = protectedMaterials;
    this.canonical = new Map();
    this.replaced = new Set();
  }

  resolve(material) {
    if (this.protected.has(material)) return material;
    const signature = materialSignature(material);
    if (signature === null) return material;
    const canonical = this.canonical.get(signature);
    if (!canonical) { this.canonical.set(signature, material); return material; }
    if (canonical !== material) this.replaced.add(material);
    return canonical;
  }

  /** Libera las copias que ya nadie dibuja; las texturas son compartidas y no se tocan. */
  disposeUnused(root) {
    const used = new Set();
    root.traverse(o => { for (const m of [o.material].flat()) if (m) used.add(m); });
    let disposed = 0;
    for (const material of this.replaced) if (!used.has(material)) { material.dispose(); disposed++; }
    return disposed;
  }
}

/**
 * Materiales lisos (sin mapas, emisión ni transparencia) que solo difieren en el color: la ciudad
 * tenía un material, y con él un dibujo por chunk, por cada tono. Se dibujan con un material
 * portador por clase de acabado y el tono viaja en un atributo de color por vértice (como en la
 * ciudad de Slop New York, donde el color es dato y no un programa distinto).
 */
export function isPlainSurface(material) {
  return !!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial && !material.isNodeMaterial
    && !material.map && !material.emissiveMap && !material.normalMap && !material.bumpMap && !material.alphaMap
    && !material.aoMap && !material.roughnessMap && !material.metalnessMap && !material.vertexColors
    && !material.transparent && material.opacity === 1 && !material.alphaTest && !material.flatShading
    && material.emissive.getHex() === 0 && Object.keys(material.userData).length === 0;
}

export class VertexColorCarriers {
  constructor(protectedMaterials = new Set()) {
    this.protected = protectedMaterials;
    this.carriers = new Map();
  }

  /** `{ material, color }` con el material portador y el color a hornear, o null si no aplica. */
  resolve(material) {
    if (this.protected.has(material) || !isPlainSurface(material)) return null;
    const key = `${material.type}|${material.roughness}|${material.metalness}|${material.side}`;
    let carrier = this.carriers.get(key);
    if (!carrier) {
      carrier = material.clone();
      carrier.color.set(0xffffff);
      carrier.vertexColors = true;
      carrier.name = material.name ? `${material.name} · color por vértice` : 'color por vértice';
      this.carriers.set(key, carrier);
    }
    return { material: carrier, color: material.color };
  }
}

/** Añade al clon el atributo `color` con el tono del material de origen. */
export function bakeVertexColor(geometry, color) {
  const count = geometry.attributes.position.count, array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { array[i * 3] = color.r; array[i * 3 + 1] = color.g; array[i * 3 + 2] = color.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
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

const baseUpdateMatrixWorld = THREE.Object3D.prototype.updateMatrixWorld;

/**
 * Three recorre todos los descendientes en cada fotograma aunque ninguna matriz cambie: en la ciudad
 * son miles de nodos congelados. Una rama completamente estática solo se recorre si algo la marca
 * como modificada, si un ancestro fuerza la actualización o si se le añadieron hijos después de congelarla.
 */
function updateWhenChanged(force) {
  if (force || this.matrixWorldNeedsUpdate || this.children.length !== this.userData.frozenChildren) {
    if (this.children.length !== this.userData.frozenChildren) delete this.updateMatrixWorld;
    baseUpdateMatrixWorld.call(this, force);
  }
}

/** Solo inmuebles: conserva matrices de bus, llamas, ropa tendida y otros animados. */
export function freezeStaticTransforms(root, dynamicRoot = null) {
  root.updateMatrixWorld(true);
  const visit = object => {
    if (object === dynamicRoot || dynamicRoot?.has?.(object) || object.userData.update) return false;
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
    let frozen = true;
    for (const child of object.children) if (!visit(child)) frozen = false;
    if (frozen && object.children.length) {
      object.userData.frozenChildren = object.children.length;
      object.updateMatrixWorld = updateWhenChanged;
    }
    return frozen;
  };
  visit(root);
}

/** Agrupa ramas completas sin alterar transformaciones locales ni referencias de edificios. */
export function createRenderSectors(root, excluded = new Set()) {
  root.updateWorldMatrix(true, true);
  const sectors = new Map(), bounds = new THREE.Box3();
  const inverse = root.matrixWorld.clone().invert();
  for (const child of [...root.children]) {
    if (excluded.has(child) || child.userData.update) continue;
    bounds.setFromObject(child);
    if (bounds.isEmpty()) continue;
    bounds.getCenter(center).applyMatrix4(inverse);
    const key = `${Math.floor(center.x / STATIC_CHUNK_SIZE)},${Math.floor(center.z / STATIC_CHUNK_SIZE)}`;
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
