import * as THREE from 'three';

/**
 * Desglose del render para medir: memoria de la GPU según Three, el último cuadro, el descarte y lo
 * que dibujaría la cámara actual, por categoría. Solo bajo demanda (consola, benchmark), nunca por
 * cuadro: recorre la escena entera y crea objetos.
 *
 * Las pasadas se replican como las hace WebGLRenderer (visible, capas, frustumCulled y la esfera de
 * cada malla), con el descarte por grupos aplicado igual que en Renderer.render y restaurado al final.
 */
export function renderBreakdown(game) {
  const renderer = game?.renderer, gl = renderer?.instance, info = gl?.info;
  const out = {
    memoria: { geometrias: info?.memory?.geometries ?? 0, texturas: info?.memory?.textures ?? 0, programas: info?.programs?.length ?? 0 },
    ultimoCuadro: { llamadas: info?.render?.calls ?? 0, triangulos: info?.render?.triangles ?? 0 },
    descarte: null
  };
  const scene = game?.sceneMgr?.scene, camera = game?.cameraRig?.camera;
  if (!scene || !camera) return out;

  const sun = game.sceneMgr.sun;
  const shadowLights = gl?.shadowMap?.enabled && sun ? [sun] : [];
  const categories = categoryRoots(game);
  const culling = renderer?.culling;
  let main, shadow = null;
  culling?.apply(camera, shadowLights);
  if (culling) out.descarte = { entradas: culling.entries.length, ...culling.stats };
  try {
    main = walk(scene, camera, false, categories);
    if (shadowLights.length && sun.castShadow && sun.visible) shadow = walk(scene, sun.shadow.camera, true, categories);
  } finally { culling?.restore(); }

  out.escena = { nodosRecorridos: main.nodes, pruebasFrustum: main.tests, mallasDibujadas: main.meshes, llamadas: main.items, transparentes: main.transparent, porCategoria: main.byCategory, nodosPorCategoria: main.nodesByCategory };
  out.sombraSol = shadow && { nodosRecorridos: shadow.nodes, pruebasFrustum: shadow.tests, llamadas: shadow.items, porCategoria: shadow.byCategory };
  const skeletons = new Set([...main.skeletons, ...(shadow?.skeletons ?? [])]);
  // Three sube la textura de huesos una vez por esqueleto y por cuadro en que algo suyo se dibuja.
  out.conPiel = { mallas: main.skinned, esqueletos: main.skeletons.size, esqueletosConSombra: skeletons.size };
  const npcs = game.world?.active?.npcs ?? [];
  out.peatones = {
    total: npcs.length,
    completosArmados: npcs.filter(npc => npc.fullChar).length,
    viendoCompleto: npcs.filter(npc => npc.character && npc.character === npc.fullChar).length,
    viendoLiviano: npcs.filter(npc => npc.character && npc.character === npc.lodChar).length
  };
  return out;
}

function categoryRoots(game) {
  const roots = new Map();
  const add = (object, name) => { if (object?.isObject3D) roots.set(object, name); };
  add(game.world?.active?.group, 'ciudad');
  add(game.player?.root, 'jugador');
  for (const npc of game.world?.active?.npcs ?? []) add(npc.root, 'peatones');
  for (const car of game.cars ?? []) add(car.group, 'vehiculos');
  for (const vehicle of game.traffic?.vehicles ?? []) add(vehicle.car?.group, 'vehiculos');
  for (const bus of game.world?.active?.busServices ?? []) add(bus.group, 'vehiculos');
  add(game.dog?.group, 'perro');
  return roots;
}

const frustum = new THREE.Frustum(), projection = new THREE.Matrix4();

function walk(root, camera, shadow, categories) {
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const result = { nodes: 0, tests: 0, meshes: 0, items: 0, transparent: 0, skinned: 0, skeletons: new Set(), byCategory: {}, nodesByCategory: {} };
  const visit = (object, category) => {
    if (!object.visible) return;
    category = categories.get(object) ?? category;
    result.nodes++;
    result.nodesByCategory[category] = (result.nodesByCategory[category] ?? 0) + 1;
    if ((object.isMesh || object.isLine || object.isPoints || object.isSprite) && object.layers.test(camera.layers) && (!shadow || object.castShadow)) {
      let inside = !object.frustumCulled;
      if (!inside) {
        result.tests++;
        inside = object.isSprite ? frustum.intersectsSprite(object) : frustum.intersectsObject(object);
      }
      if (inside) {
        const items = drawItems(object, result);
        if (items) {
          result.meshes++;
          result.items += items;
          result.byCategory[category] = (result.byCategory[category] ?? 0) + items;
          if (object.isSkinnedMesh && object.skeleton) { result.skinned++; result.skeletons.add(object.skeleton); }
        }
      }
    }
    for (const child of object.children) visit(child, category);
  };
  visit(root, 'otros');
  return result;
}

function drawItems(object, result) {
  const material = object.material;
  if (Array.isArray(material)) {
    let items = 0;
    for (const group of object.geometry?.groups ?? []) {
      const part = material[group.materialIndex];
      if (part?.visible) { items++; if (part.transparent) result.transparent++; }
    }
    return items;
  }
  if (!material?.visible) return 0;
  if (material.transparent) result.transparent++;
  return 1;
}
