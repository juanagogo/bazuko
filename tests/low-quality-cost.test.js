import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import * as realistic from '../src/character/RealisticCharacter.js';
import * as textures from '../src/world/bogota/textures.js';

// El costo de un cuadro en calidad baja: qué se deja de dibujar y qué sigue funcionando igual.
const character = () => ({ group: new THREE.Group(), calls: 0, update() { this.calls++; }, dispose() {} });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  ...realistic, createRealisticCharacter: async () => character(), loadCatalog: async () => ({}),
  normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1
} });
mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });

const { Npc, NPC_LOD } = await import('../src/entities/Npc.js');
const { Pickup } = await import('../src/entities/Pickup.js');
const { GRAPHICS_PROFILES } = await import('../src/core/GraphicsQuality.js');
const { Game } = await import('../src/core/game.js');
const { PhotoMode } = await import('../src/ui/PhotoMode.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { TrafficSignals } = await import('../src/world/bogota/TrafficSignals.js');
const { FAR_SIGNAL_DISTANCE, LENS, createFarSignalGeometry, createSignalGeometry } = await import('../src/world/bogota/SignalModel.js');
const { BuildingVisibility, CLOSED_CHUNK_SIZE, createBuildingShell } = await import('../src/world/bogota/BuildingVisibility.js');
const { STATIC_CHUNK_SIZE, createRenderSectors, geometryChunk } = await import('../src/world/bogota/StaticGeometry.js');

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
});

const bag = (position = new THREE.Vector3()) => new Pickup(new THREE.Scene(), position);
const settle = (pickup, seconds = 3) => { for (let t = 0; t < seconds; t += .05) pickup.update(.05); };

test('los aros de la bolsa siguen de dos caras, pero se dibujan en una sola pasada', () => {
  const pickup = bag();
  for (const ring of [pickup.marker, pickup.aura]) {
    assert.equal(ring.material.side, THREE.DoubleSide);
    assert.equal(ring.material.forceSinglePass, true);
  }
});

test('el aura apagada no se dibuja y vuelve con el boost, sin tocar los flags de la cosecha', () => {
  const pickup = bag();
  assert.equal(pickup.aura.material.visible, false, 'nace apagada');
  pickup.update(.05);
  assert.equal(pickup.aura.material.visible, false);
  pickup.setBoost(true);
  pickup.update(.05);
  assert.equal(pickup.aura.material.visible, true, 'se ve desde el primer cuadro del boost');
  settle(pickup);
  assert.ok(pickup.aura.material.opacity > .65);
  pickup.setBoost(false);
  settle(pickup);
  assert.equal(pickup.aura.material.visible, false, 'se apaga al terminar el desvanecido');
  assert.equal(pickup.aura.visible, true, 'ese flag es de la cosecha y la reaparición');
  pickup.harvest();
  assert.equal(pickup.aura.visible, false);
  settle(pickup, pickup.refillSeconds + 1);
  assert.equal(pickup.aura.visible, true, 'la bolsa repuesta recupera su flag');
  pickup.setBoost(true);
  pickup.update(.05);
  assert.equal(pickup.aura.material.visible, true, 'y el boost vuelve a prender el aura');
});

test('la bolsa lejana deja de dibujarse con margen, sin dejar de ser una bolsa', () => {
  const pickup = bag(new THREE.Vector3(100, 0, 0)), viewer = new THREE.Vector3();
  pickup.limitDrawDistance(viewer, 90);
  assert.equal(pickup.group.visible, false);
  pickup.limitDrawDistance(viewer, 98);
  assert.equal(pickup.group.visible, false, 'oculta: no prende hasta quedar dentro del todo');
  pickup.limitDrawDistance(viewer, 100);
  assert.equal(pickup.group.visible, true);
  pickup.limitDrawDistance(viewer, 98);
  assert.equal(pickup.group.visible, true, 'dibujada: aguanta el margen, no parpadea en el borde');
  pickup.limitDrawDistance(viewer, 90);
  pickup.limitDrawDistance(viewer, Infinity);
  assert.equal(pickup.group.visible, true, 'sin límite siempre se dibuja');
  pickup.limitDrawDistance(viewer, 90);
  assert.ok(pickup.mesh.visible && pickup.marker.visible && !pickup.used, 'la cosecha no se entera');
  assert.ok(pickup.position.equals(new THREE.Vector3(100, 0, 0)));
});

test('la partida limita cada bolsa con la distancia del distrito', () => {
  const calls = [];
  const pickups = [{ update(dt) { calls.push(['update', dt]); }, limitDrawDistance(viewer, limit) { calls.push(['limite', viewer, limit]); } }];
  const player = { position: new THREE.Vector3(1, 0, 2) };
  Game.prototype._updatePickups.call({ pickups, player, world: { active: { farDetailDistance: 120 } } }, .1);
  assert.deepEqual(calls, [['update', .1], ['limite', player.position, 120]]);
  calls.length = 0;
  Game.prototype._updatePickups.call({ pickups, player, world: { active: null } }, .1);
  assert.equal(calls[1][2], Infinity, 'sin distrito no hay límite');
});

async function pedestrian(wander = 0) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(0, 0, 1), { look: {}, wander, isWalkable: () => true, groundHeight: () => 0 });
  await npc.ready;
  npc.fullChar = npc.lodChar;
  return npc;
}
const away = distance => new THREE.Vector3(0, 0, 1 + distance);

test('el peatón lejano deja de dibujarse con margen; sin límite (media y alta) se dibuja', async () => {
  const npc = await pedestrian(), player = away(100);
  npc.update(.01, { player });
  assert.equal(npc.root.visible, true, 'sin límite de dibujo');
  npc.update(.01, { player, drawDistance: 100 - NPC_LOD.drawMargin / 2 });
  assert.equal(npc.root.visible, true, 'dibujado: aguanta el margen');
  npc.update(.01, { player, drawDistance: 100 - NPC_LOD.drawMargin - 1 });
  assert.equal(npc.root.visible, false);
  npc.update(.01, { player, drawDistance: 100 - NPC_LOD.drawMargin / 2 });
  assert.equal(npc.root.visible, false, 'oculto: no prende dentro del margen');
  npc.update(.01, { player, drawDistance: 100 });
  assert.equal(npc.root.visible, true);
  npc.dispose();
});

test('oculto por el límite camina igual que uno a la vista y no gasta en su pose', async t => {
  t.mock.method(Math, 'random', () => .25);
  const seen = await pedestrian(8), hidden = await pedestrian(8), player = away(30);
  const start = seen.position.clone(), posesSeen = seen.character.calls, posesHidden = hidden.character.calls;
  for (let i = 0; i < 300; i++) {
    seen.update(.05, { player });
    hidden.update(.05, { player, drawDistance: 10, skipHiddenMatrices: true });
  }
  assert.ok(seen.position.distanceTo(start) > .5, 'el peatón de la prueba camina');
  assert.deepEqual(hidden.position.toArray(), seen.position.toArray());
  assert.equal(hidden.target?.x, seen.target?.x);
  assert.equal(seen.root.visible, true);
  assert.equal(hidden.root.visible, false);
  assert.equal(hidden.character.calls, posesHidden, 'nadie lo ve: no se anima');
  assert.ok(seen.character.calls > posesSeen);
  seen.dispose(); hidden.dispose();
});

test('el render se salta las matrices del oculto solo si el distrito lo pide', async () => {
  const npc = await pedestrian(), far = away(100), near = away(2);
  npc.update(.01, { player: far, drawDistance: 50, skipHiddenMatrices: true });
  assert.equal(npc.root.matrixWorldAutoUpdate, false);
  npc.update(.01, { player: near, drawDistance: 50, skipHiddenMatrices: true });
  assert.equal(npc.root.matrixWorldAutoUpdate, true, 'vuelve a salir donde está en el mismo cuadro');
  npc.update(.01, { player: far, drawDistance: 50 });
  assert.equal(npc.root.matrixWorldAutoUpdate, true, 'los demás actores no cambian');
  npc.dispose();
});

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} frente a ${b}`);

test('el límite de dibujo sigue a la niebla y solo existe si la calidad lo pide', () => {
  const contexts = [], details = [];
  const camera = new THREE.PerspectiveCamera(); camera.position.set(3, 2, 1);
  const district = {
    t: 0, animated: [], npcs: [{ update(_dt, ctx) { contexts.push(ctx); } }], buildingVisibility: { update() {} },
    signals: { update() {}, updateDetail(position, allowFar) { details.push([position, allowFar]); } },
    scene: { fog: new THREE.Fog(0, 100, 200) }, farDetailFog: .6
  };
  const run = () => Bogota.prototype.update.call(district, .016, new THREE.Vector3(), camera, []);
  run();
  near(contexts.at(-1).drawDistance, 160);
  near(district.farDetailDistance, 160);
  assert.equal(contexts.at(-1).skipHiddenMatrices, true);
  assert.deepEqual(details.at(-1), [camera.position, true]);
  district.scene.fog.near = 40; district.scene.fog.far = 130;
  run();
  near(contexts.at(-1).drawDistance, 94);
  district.farDetailFog = 0;
  run();
  assert.equal(contexts.at(-1).drawDistance, Infinity);
  assert.equal(district.farDetailDistance, Infinity);
  assert.deepEqual(details.at(-1), [camera.position, false], 'media y alta: todos los postes completos');
});

test('solo la calidad baja pide el límite, y se lo avisa al distrito al cambiar de calidad', () => {
  assert.ok(GRAPHICS_PROFILES.baja.farDetailFog > 0 && GRAPHICS_PROFILES.baja.farDetailFog < 1);
  assert.equal(GRAPHICS_PROFILES.media.farDetailFog, undefined);
  assert.equal(GRAPHICS_PROFILES.alta.farDetailFog, undefined);
  const district = {};
  const game = Object.assign(Object.create(Game.prototype), {
    _effectiveQuality: 'media',
    renderer: { effectiveQuality: 'baja', render() {}, resolution: { resetWindow() {} } },
    sceneMgr: { scene: new THREE.Scene(), sun: new THREE.DirectionalLight(), setQuality() {} },
    cameraRig: { camera: new THREE.PerspectiveCamera(55) },
    player: { position: new THREE.Vector3(), root: new THREE.Group() },
    world: { active: district }, localLights: { update() {} }, collisions: {},
    performanceHUD: { update() { return false; } }
  });
  game._renderFrame(1000, true);
  assert.equal(district.farDetailFog, GRAPHICS_PROFILES.baja.farDetailFog);
  game.renderer.effectiveQuality = 'alta';
  game._renderFrame(1016, true);
  assert.equal(district.farDetailFog, 0);
});

test('en la foto el peatón oculto vuelve a salir donde está y los postes van completos', () => {
  const details = [], root = new THREE.Group();
  root.visible = false; root.matrixWorldAutoUpdate = false;
  const camera = new THREE.PerspectiveCamera(55, 1, .1, 200);
  const game = {
    world: { active: { npcs: [{ root, position: new THREE.Vector3(0, 0, -20) }],
      signals: { updateDetail(position, allowFar) { details.push([position, allowFar]); } } } },
    cameraRig: { camera }, player: { position: new THREE.Vector3() }
  };
  PhotoMode.prototype._syncCameraView.call({ game, _frustum: new THREE.Frustum(), _projection: new THREE.Matrix4(), _npcBounds: new THREE.Sphere(new THREE.Vector3(), 1.2) });
  assert.equal(root.visible, true);
  assert.equal(root.matrixWorldAutoUpdate, true);
  assert.deepEqual(details, [[camera.position, false]]);
});

const triangles = geometry => geometry.index.count / 3;
// Las calcomanías (DECAL_SET en adelante) no llegan a un píxel de lejos; las luces sí.
const lensCodes = geometry => [...new Set(geometry.attributes.signalLens.array)].filter(code => code <= LENS.RETRO).sort((a, b) => a - b);

const lensCenter = (geometry, code) => {
  const { position, signalLens } = geometry.attributes, sum = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < position.count; i++) if (signalLens.getX(i) === code) { sum.add(new THREE.Vector3().fromBufferAttribute(position, i)); count++; }
  return sum.divideScalar(count);
};

test('el poste completo gasta menos y el liviano conserva las mismas luces y la misma silueta', () => {
  const { geometry } = createSignalGeometry(), far = createFarSignalGeometry();
  assert.ok(triangles(geometry) <= 2000, `${triangles(geometry)} triángulos de cerca`);
  assert.ok(triangles(far) <= 350, `${triangles(far)} triángulos de lejos`);
  assert.deepEqual(lensCodes(far), lensCodes(geometry));
  for (const key of ['signalSurface', 'signalLensUv', 'color', 'uv', 'normal']) assert.ok(far.attributes[key], `el liviano usa el mismo material: ${key}`);
  // Cada luz queda donde estaba: el conductor lee el mismo semáforo.
  for (const code of lensCodes(far).filter(code => code !== LENS.NONE && code !== LENS.RETRO)) {
    const gap = lensCenter(geometry, code).distanceTo(lensCenter(far, code));
    assert.ok(gap < .04, `la lente ${code} se mueve ${gap.toFixed(3)} m`);
  }
  geometry.computeBoundingBox(); far.computeBoundingBox();
  for (const corner of ['min', 'max']) for (const axis of ['x', 'y', 'z']) {
    const gap = Math.abs(geometry.boundingBox[corner][axis] - far.boundingBox[corner][axis]);
    assert.ok(gap < .12, `${corner}.${axis} se mueve ${gap.toFixed(3)} m`);
  }
});

test('cada lote de postes cambia de modelo con margen, conservando fase y descarte', async () => {
  const signals = new TrafficSignals();
  await signals.preloadModel();
  assert.ok(signals.poleMeshes.length <= 24, `${signals.poleMeshes.length} lotes`);
  const [mesh] = signals.poleMeshes, halo = signals.haloMeshes[0];
  const { nearGeometry, farGeometry } = mesh.userData;
  assert.equal(mesh.geometry, nearGeometry, 'nace completo');
  assert.equal(farGeometry.getAttribute('trafficAxis'), nearGeometry.getAttribute('trafficAxis'));
  assert.equal(halo.geometry.getAttribute('trafficAxis'), nearGeometry.getAttribute('trafficAxis'));
  assert.equal(farGeometry.boundingSphere, nearGeometry.boundingSphere);
  assert.ok(triangles(farGeometry) < triangles(nearGeometry) / 4);
  const center = mesh.boundingBox.getCenter(new THREE.Vector3());
  const at = distance => new THREE.Vector3(mesh.boundingBox.max.x + distance, center.y, center.z);
  signals.updateDetail(at(FAR_SIGNAL_DISTANCE + 2));
  assert.equal(mesh.geometry, nearGeometry, 'dentro del margen sigue completo');
  signals.updateDetail(at(FAR_SIGNAL_DISTANCE + 10));
  assert.equal(mesh.geometry, farGeometry);
  signals.updateDetail(at(FAR_SIGNAL_DISTANCE + 2));
  assert.equal(mesh.geometry, farGeometry, 'dentro del margen sigue liviano');
  signals.updateDetail(at(FAR_SIGNAL_DISTANCE - 1));
  assert.equal(mesh.geometry, nearGeometry);
  signals.updateDetail(at(FAR_SIGNAL_DISTANCE + 10), false);
  assert.equal(mesh.geometry, nearGeometry, 'sin permiso (media, alta, foto) siempre completo');
  let disposed = 0;
  for (const geometry of [nearGeometry, farGeometry]) geometry.addEventListener('dispose', () => disposed++);
  signals.dispose();
  assert.equal(disposed, 2);
});

const cube = (x, material) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.position.set(x, 0, 10);
  return mesh;
};
const closedMeshes = shells => {
  const visibility = new BuildingVisibility();
  for (const shell of shells) visibility.register(shell);
  return visibility.buildClosedView().children.length;
};

test('los lotes cerrados de una misma cuadra se agrupan sin mover los edificios', () => {
  assert.ok(CLOSED_CHUNK_SIZE > STATIC_CHUNK_SIZE);
  const material = new THREE.MeshStandardMaterial();
  const house = x => createBuildingShell(new THREE.BoxGeometry(8, 12, 6), Array(6).fill(material), { x, z: 20, height: 12, interiorMaterial: material });
  assert.equal(closedMeshes([house(10), house(50)]), closedMeshes([house(10)]), 'dos casas a 40 m comparten lote');
  assert.equal(closedMeshes([house(10), house(CLOSED_CHUNK_SIZE + 10)]), closedMeshes([house(10)]) * 2, 'en otro trozo, otro lote');
});

test('la fusión estática y los sectores agrupan con el tamaño pedido', () => {
  const material = new THREE.MeshStandardMaterial();
  const merged = new THREE.Group();
  for (const x of [10, 50]) merged.add(cube(x, material));
  Bogota.prototype._mergeStatic.call({ group: merged });
  let meshes = 0, triangleCount = 0;
  merged.traverse(o => { if (o.isMesh) { meshes++; triangleCount += o.geometry.index.count / 3; } });
  assert.equal(meshes, 1, 'dos piezas a 40 m van en un lote');
  assert.equal(triangleCount, 24);
  const box = new THREE.BoxGeometry(1, 1, 1);
  assert.equal(geometryChunk(box, new THREE.Matrix4().makeTranslation(50, 0, 0)), '1,0');
  assert.equal(geometryChunk(box, new THREE.Matrix4().makeTranslation(50, 0, 0), 64), '0,0');
  const root = new THREE.Group();
  for (const x of [10, 50, 70]) root.add(cube(x, material));
  const sectors = createRenderSectors(root, undefined, 64);
  assert.deepEqual(sectors.map(sector => [sector.name, sector.children.length]), [['Sector 0,0', 2], ['Sector 1,0', 1]]);
});

function bodyGame({ insideBody, photo = false } = {}) {
  const root = new THREE.Group(), seen = [];
  const game = Object.assign(Object.create(Game.prototype), {
    _effectiveQuality: 'media',
    renderer: { effectiveQuality: 'media', render(_scene, _camera, _root, _lights, silhouette) { seen.push({ visible: root.visible, silhouette }); }, resolution: { resetWindow() {} } },
    sceneMgr: { scene: new THREE.Scene(), sun: new THREE.DirectionalLight() },
    cameraRig: { camera: new THREE.PerspectiveCamera(55), insideBody },
    player: { position: new THREE.Vector3(), root },
    world: { active: {} }, localLights: { update() {} }, collisions: { mayOccludePlayer: () => true },
    performanceHUD: { update() { return false; } }, photoMode: { active: photo }
  });
  return { game, root, seen };
}

test('con la cámara dentro del cuerpo no se dibuja, y queda visible para todo lo demás', () => {
  const { game, root, seen } = bodyGame({ insideBody: true });
  game._renderFrame(1000, true);
  assert.deepEqual(seen, [{ visible: false, silhouette: false }]);
  assert.equal(root.visible, true);
  const clear = bodyGame({ insideBody: false });
  clear.game._renderFrame(1000, true);
  assert.deepEqual(clear.seen, [{ visible: true, silhouette: true }]);
  const photo = bodyGame({ insideBody: true, photo: true });
  photo.game._renderFrame(1000, true);
  assert.equal(photo.seen[0].visible, false, 'En la foto, contra una pared, tampoco se ve la cabeza por dentro');
});

test('el intervalo entre cuadros sale del sello de rAF y no del reloj al entrar', () => {
  const stamps = [];
  const game = Object.assign(Object.create(Game.prototype), {
    _effectiveQuality: 'media', _frameStamp: 5000,
    renderer: { effectiveQuality: 'media', render() {}, resolution: { resetWindow() {} } },
    sceneMgr: { scene: new THREE.Scene(), sun: new THREE.DirectionalLight() },
    cameraRig: { camera: new THREE.PerspectiveCamera(55) },
    player: { position: new THREE.Vector3(), root: new THREE.Group() },
    world: { active: {} }, localLights: { update() {} }, collisions: {},
    performanceHUD: { update(now) { stamps.push(now); return false; } }
  });
  game._renderFrame(5003.7, true);
  assert.deepEqual(stamps, [5000]);
});
