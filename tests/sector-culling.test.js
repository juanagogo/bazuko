import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { FrustumCulling } from '../src/core/FrustumCulling.js';
import { branchBounds, registerSectorChildren } from '../src/core/SectorCulling.js';

// La ciudad real, armada entera; solo se sustituyen las texturas y la carga de modelos (como en fixed-people).
const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });

function sun() {
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  Object.assign(light.shadow.camera, { near: 1, far: 200, left: -45, right: 45, top: 45, bottom: -45 });
  light.shadow.camera.updateProjectionMatrix();
  return light;
}

function aimSun(light, x, z) {
  light.position.set(x + 30, 80, z + 20);
  light.target.position.set(x, 0, z);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  light.shadow.updateMatrices(light);
}

const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
/** Réplica de projectObject (pasada principal) y de la pasada de sombras de WebGLRenderer. */
function walk(root, camera, shadow = false) {
  frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const drawn = new Set();
  let nodes = 0;
  const visit = object => {
    if (!object.visible) return;
    nodes++;
    if ((object.isMesh || object.isLine || object.isPoints) && (!shadow || object.castShadow)
      && (!object.frustumCulled || frustum.intersectsObject(object))) drawn.add(object);
    for (const child of object.children) visit(child);
  };
  visit(root);
  return { drawn, nodes };
}

const worldBox = new THREE.Box3();
function outside(mesh, test) {
  worldBox.setFromObject(mesh);
  return !test.intersectsBox(worldBox);
}

test('un sector con hijos: se oculta el de afuera, se queda el que proyecta sombra en cámara', () => {
  const scene = new THREE.Scene(), culling = new FrustumCulling(), light = sun();
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.set(0, 2, 0); camera.lookAt(0, 2, -10); camera.updateMatrixWorld();
  scene.add(light, light.target);
  const sector = new THREE.Group();
  const building = (x, z, castShadow = false) => {
    const group = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      mesh.position.set(x + i * .2, .5, z);
      mesh.castShadow = castShadow;
      group.add(mesh);
    }
    sector.add(group);
    return group;
  };
  const inside = building(0, -10), away = building(0, 20), shadowing = building(-25, 0, true), small = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  small.position.set(0, 0, 30);
  sector.add(small);
  scene.add(sector);
  scene.updateMatrixWorld(true);
  aimSun(light, 0, 0);
  culling.register(sector);
  assert.equal(registerSectorChildren(culling, [sector]), 3, 'el hijo de un solo nodo no se registra');
  culling.apply(camera, [light]);
  assert.equal(inside.visible, true);
  assert.equal(away.visible, false);
  assert.equal(shadowing.visible, true, 'proyecta sombra dentro del frustum del sol');
  assert.equal(culling.stats.shadowOnly, 1);
  culling.restore();
  assert.ok([inside, away, shadowing, sector].every(object => object.visible));

  // Con el sector oculto, sus hijos ni se cuentan.
  camera.lookAt(0, 2, 10); camera.position.set(0, 2, 200); camera.lookAt(0, 2, 400); camera.updateMatrixWorld();
  culling.apply(camera, []);
  assert.equal(sector.visible, false);
  assert.equal(culling.stats.total, 1);
  culling.restore();
});

test('la caja de una rama contiene la esfera de cada malla y rechaza lo que se mueve', () => {
  const group = new THREE.Group();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  group.add(quad);
  group.updateMatrixWorld(true);
  const bounds = branchBounds(group);
  // Un plano acostado tiene caja de alto cero; su esfera (la que prueba Three) no.
  assert.ok(bounds.max.y - bounds.min.y > 1.9);

  const moving = new THREE.Group();
  moving.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  moving.children[0].userData.update = () => {};
  assert.equal(branchBounds(moving), null);
  const unculled = new THREE.Group();
  unculled.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  unculled.children[0].frustumCulled = false;
  assert.equal(branchBounds(unculled), null);
  const far = new THREE.Group(), farMaterial = new THREE.MeshBasicMaterial();
  farMaterial.userData.pastFar = true;
  far.add(new THREE.Mesh(new THREE.BoxGeometry(), farMaterial));
  far.children[0].frustumCulled = false;
  assert.ok(branchBounds(far), 'la bruma lejana se descarta por los lados, como su sector');
  const skinned = new THREE.Group();
  skinned.add(new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  assert.equal(branchBounds(skinned), null);
  assert.equal(branchBounds(new THREE.Group().add(new THREE.Sprite())), null);
});

test('ciudad real: el descarte por hijos dibuja lo mismo y recorre mucho menos', async () => {
  const { Bogota } = await import('../src/world/districts/Bogota.js');
  const city = new Bogota(), scene = new THREE.Scene(), collisions = new CollisionSystem();
  city.build(scene, collisions);
  after(() => city.dispose(scene));
  await Promise.all(city.npcs.map(npc => npc.ready));
  const light = sun();
  scene.add(light, light.target);
  scene.updateMatrixWorld(true);

  const register = culling => {
    for (const sector of city.renderSectors) culling.register(sector);
    if (city.signals) culling.register(city.signals.group);
    for (const object of city.animated) culling.register(object, { margin: 1 });
  };
  const coarse = new FrustumCulling(), fine = new FrustumCulling();
  register(coarse);
  for (const sector of city.renderSectors) fine.register(sector);
  const added = registerSectorChildren(fine, city.renderSectors);
  if (city.signals) fine.register(city.signals.group);
  for (const object of city.animated) fine.register(object, { margin: 1 });
  assert.ok(added > 300, `${added} hijos registrados`);

  const camera = new THREE.PerspectiveCamera(55, 16 / 10, .1, 300);
  const views = { inicio: [112.98, 97.84], colpatria: [105, 200], lago: [78.5, 280], terminal: [75, -30] };
  const pastFar = new THREE.Frustum();
  const totals = { coarse: 0, fine: 0 };
  let inicio = null;
  for (const [name, [x, z]] of Object.entries(views)) {
    for (let step = 0; step < 9; step++) {
      // Ocho giros en tercera persona y uno isométrico.
      if (step < 8) {
        const yaw = step * Math.PI / 4;
        camera.position.set(x + Math.sin(yaw) * 6, 4, z + Math.cos(yaw) * 6);
        camera.lookAt(x - Math.sin(yaw) * 10, 1.2, z - Math.cos(yaw) * 10);
      } else {
        camera.position.set(x + 12, 16, z + 12);
        camera.lookAt(x, 1.5, z);
      }
      camera.updateMatrixWorld();
      aimSun(light, x, z);
      const passes = {};
      for (const [label, culling] of [['coarse', coarse], ['fine', fine]]) {
        culling.apply(camera, [light]);
        passes[label] = { main: walk(scene, camera), shadow: walk(scene, light.shadow.camera, true) };
        culling.restore();
      }
      pastFar.copy(coarse.frustum);
      pastFar.planes[4].constant = Infinity;
      const shadowFrustum = light.shadow.getFrustum();
      for (const pass of ['main', 'shadow']) {
        const before = passes.coarse[pass].drawn, now = passes.fine[pass].drawn;
        for (const mesh of now) assert.ok(before.has(mesh), `${name} ${step} ${pass}: ${mesh.name} aparece de más`);
        for (const mesh of before) {
          if (now.has(mesh)) continue;
          // Solo puede faltar lo que de todos modos queda fuera del frustum de esa pasada.
          const materials = [mesh.material].flat();
          const test = pass === 'shadow' ? shadowFrustum : materials.some(m => m?.userData?.pastFar) ? pastFar : coarse.frustum;
          assert.ok(outside(mesh, test), `${name} ${step} ${pass}: falta ${mesh.name || mesh.parent?.name || mesh.uuid}`);
        }
      }
      totals.coarse += passes.coarse.main.nodes + passes.coarse.shadow.nodes;
      totals.fine += passes.fine.main.nodes + passes.fine.shadow.nodes;
      if (name === 'inicio' && step === 0) inicio = { coarse: passes.coarse.main.nodes, fine: passes.fine.main.nodes };
    }
  }
  assert.ok(inicio.fine <= inicio.coarse * .7, `inicio: ${inicio.coarse} → ${inicio.fine} nodos`);
  assert.ok(totals.fine < totals.coarse * .75, `${totals.coarse} → ${totals.fine} nodos`);
  assert.ok(city.renderSectors.every(sector => sector.visible));
});
