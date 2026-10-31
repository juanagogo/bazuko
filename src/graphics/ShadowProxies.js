import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Sustitutos de sombra por celdas, adaptados de scene-culling.js de Slop New York (MIT).
 *
 * Las cascadas del sol vuelven a dibujar cada malla que proyecta sombra: de día la pasada de
 * sombras costaba más llamadas que la vista. Los inmuebles estáticos se copian como solo
 * posiciones, unidas por celda y por lado de cara, en una capa que únicamente ven las cámaras
 * de las cascadas; los originales dejan de proyectar. Cada celda cuesta un dibujo por cascada.
 */
export const SHADOW_PROXY_LAYER = 3;
// Celdas amplias, como las de 500 m de Slop New York: cada celda cuesta un dibujo por cascada y sus triángulos son pocos.
export const SHADOW_PROXY_CELL = 160;

const proxyMaterials = new Map();
const toParent = new THREE.Matrix4();
const center = new THREE.Vector3();

/**
 * Solo se sustituye lo que no mueve vértices ni recorta huecos al proyectar sombra. `allowFade`
 * acepta las piezas que se atenúan en isométrica: su sombra pasa a ser la del edificio completo.
 */
export function proxyableMaterial(material, { allowFade = false } = {}) {
  return !!material && !Array.isArray(material) && material.visible !== false && !material.transparent &&
    !(material.alphaTest > 0) && !material.alphaMap && (allowFade || !material.alphaHash) && !material.displacementMap &&
    !material.positionNode && !material.castShadowNode && !material.castShadowPositionNode && !material.maskNode &&
    (allowFade || !material.userData?.visibilityFade);
}

function proxyMaterial(side, shadowSide) {
  const key = `${side}|${shadowSide}`;
  let material = proxyMaterials.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color: 0x000000, side });
    material.shadowSide = shadowSide;
    material.name = 'Sombra · sustituto';
    proxyMaterials.set(key, material);
  }
  return material;
}

function proxyable(mesh, allowFade) {
  const geometry = mesh.geometry;
  return mesh.isMesh && !mesh.isSkinnedMesh && !mesh.isInstancedMesh && !mesh.isBatchedMesh && mesh.castShadow &&
    !mesh.morphTargetInfluences && proxyableMaterial(mesh.material, { allowFade }) && geometry?.attributes.position &&
    geometry.drawRange.start === 0 && geometry.drawRange.count === Infinity;
}

/**
 * Crea los sustitutos de `sources` como hijos de `parent` (heredan su visibilidad) y quita la
 * sombra a los originales sustituidos. Devuelve el grupo y cuántas mallas reemplazó.
 */
export function buildShadowProxies(sources, parent, { cell = SHADOW_PROXY_CELL, name = 'Sustitutos de sombra', allowFade = false } = {}) {
  parent.updateWorldMatrix(true, false);
  const inverse = parent.matrixWorld.clone().invert(), buckets = new Map();
  for (const mesh of sources) {
    if (!proxyable(mesh, allowFade)) continue;
    mesh.updateWorldMatrix(true, false);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', mesh.geometry.attributes.position.clone());
    if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
    geometry.applyMatrix4(toParent.multiplyMatrices(inverse, mesh.matrixWorld));
    geometry.computeBoundingBox();
    geometry.boundingBox.getCenter(center);
    const { side, shadowSide } = mesh.material;
    const key = `${side}|${shadowSide}|${!!geometry.index}|${Math.floor(center.x / cell)},${Math.floor(center.z / cell)}`;
    const bucket = buckets.get(key) ?? { side, shadowSide, geometries: [], sources: [] };
    buckets.set(key, bucket);
    bucket.geometries.push(geometry);
    bucket.sources.push(mesh);
  }
  const group = new THREE.Group();
  group.name = name;
  group.userData.noMerge = true;
  let replaced = 0;
  for (const { side, shadowSide, geometries, sources: meshes } of buckets.values()) {
    const merged = mergeGeometries(geometries);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue; // los originales siguen proyectando sombra
    const proxy = new THREE.Mesh(merged, proxyMaterial(side, shadowSide));
    proxy.name = 'Sustituto de sombra';
    proxy.layers.set(SHADOW_PROXY_LAYER);
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.matrixAutoUpdate = false;
    proxy.userData.shadowProxy = true;
    merged.computeBoundingSphere();
    group.add(proxy);
    for (const mesh of meshes) mesh.castShadow = false;
    replaced += meshes.length;
  }
  group.updateMatrixWorld(true);
  parent.add(group);
  return { group, replaced, proxies: group.children.length };
}

/** Las cámaras de sombra deben ver la capa de los sustitutos; la cámara de la vista nunca la ve. */
export function enableShadowProxyLayer(light) {
  const shadow = light?.shadow;
  if (!shadow) return;
  const count = typeof shadow.getViewportCount === 'function' && typeof shadow.getCamera === 'function' ? shadow.getViewportCount() : 0;
  for (let i = 0; i < count; i++) shadow.getCamera(i)?.layers.enable(SHADOW_PROXY_LAYER);
  shadow.camera?.layers.enable(SHADOW_PROXY_LAYER);
}
