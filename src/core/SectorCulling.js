import * as THREE from 'three';

const sphere = new THREE.Sphere();
const sphereBox = new THREE.Box3();

/**
 * Caja que contiene la esfera de cada malla de la rama, tal como la prueba Three contra el frustum
 * (`Frustum.intersectsObject`). Si cualquiera de esas esferas toca un frustum, la caja también: el
 * descarte de la rama nunca oculta algo que Three habría dibujado. Devuelve null si la rama no se
 * puede descartar entera: algo se mueve, tiene piel, es un sprite o se dibuja sin descarte propio.
 */
export function branchBounds(root, target = new THREE.Box3()) {
  target.makeEmpty();
  let ok = true;
  root.traverse(object => {
    if (!ok) return;
    if (object.userData?.update || object.isSkinnedMesh || object.isSprite) { ok = false; return; }
    if (!(object.isMesh || object.isLine || object.isPoints)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const pastFar = materials.some(material => material?.userData?.pastFar);
    // Lo que Three dibuja sin probar el frustum solo se admite si es de bruma lejana: el descarte lo
    // trata aparte, sin el plano lejano, como ya hace con los sectores.
    if (object.frustumCulled === false && !pastFar) { ok = false; return; }
    const source = object.isInstancedMesh || object.isBatchedMesh ? object : object.geometry;
    if (!source) { ok = false; return; }
    if (source.boundingSphere === null) source.computeBoundingSphere();
    if (!source.boundingSphere) { ok = false; return; }
    sphere.copy(source.boundingSphere).applyMatrix4(object.matrixWorld);
    if (!Number.isFinite(sphere.radius) || sphere.radius < 0) { ok = false; return; }
    target.union(sphere.getBoundingBox(sphereBox));
  });
  return ok && !target.isEmpty() ? target : null;
}

const countNodes = object => {
  let count = 1;
  for (const child of object.children) count += countNodes(child);
  return count;
};

/**
 * Descarte de dos niveles: además de cada sector de 64 m, registra sus hijos con `minNodes` nodos o
 * más (edificios, lotes, árboles agrupados). La entrada de un hijo se salta sola cuando su sector ya
 * quedó oculto, porque los sectores se registran antes. Los hijos de los sectores son estáticos
 * (`freezeStaticTransforms`); lo que se mueve no se registra y lo sigue cubriendo su sector.
 * El margen cubre el vaivén de las copas, que el shader mueve fuera de la geometría.
 * Devuelve cuántas entradas añadió.
 */
export function registerSectorChildren(culling, sectors, { minNodes = 6, margin = .25, exclude = null } = {}) {
  let added = 0;
  for (const sector of sectors) {
    sector.updateWorldMatrix(true, true);
    for (const child of sector.children) {
      if (exclude?.has(child) || countNodes(child) < minNodes) continue;
      const bounds = branchBounds(child);
      if (!bounds) continue;
      if (culling.register(child, { margin, bounds })) added++;
    }
  }
  return added;
}
