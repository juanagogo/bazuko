import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';
const point = (x, z) => [STREET_X.world(x / 2), STREET_Z.world(z / 2)];
import { rng } from '../src/world/bogota/textures.js';

let realisticCreates = 0;
let realisticDisposals = 0;
let fullLookChanges = 0;
// La navegación y los NPC son reales; solo se sustituye la carga de modelos GLB.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async (_look, { lod } = {}) => {
    realisticCreates++;
    return {
      group: new THREE.Group(), lod, update() {},
      setLook: async () => { fullLookChanges++; },
      dispose: () => { realisticDisposals++; }
    };
  },
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { Npc } = await import('../src/entities/Npc.js');
const { NPC_LOD, NPC_VOICE_BANK } = await import('../src/entities/Npc.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');

function district() {
  const city = new Bogota();
  city.map = city._layout();
  city.reserved = { shop: { x: STREET_X.world(34), z: STREET_Z.world(29) } };
  city.scene = new THREE.Scene();
  return city;
}

test('las rutas rodean edificios sin diagonales y no atraviesan componentes aislados', () => {
  const map = [
    ['sidewalk', 'sidewalk', 'sidewalk', 'wall', 'sidewalk'],
    ['sidewalk', 'building', 'sidewalk', 'wall', 'sidewalk'],
    ['sidewalk', 'sidewalk', 'sidewalk', 'wall', 'sidewalk']
  ];
  const nav = new PedestrianNavigation(map, 2);
  for (let seed = 1; seed <= 30; seed++) {
    const route = nav.createRoute(new THREE.Vector3(), rng(seed));
    assert.ok(route.length > 1);
    for (let i = 0; i < route.length; i++) {
      const point = route[i];
      assert.ok(point.x <= 4);
      assert.ok(nav.isWalkableAt(point.x, point.z));
      if (i) assert.equal(Math.abs(point.x - route[i - 1].x) + Math.abs(point.z - route[i - 1].z), 2);
    }
  }
  const isolated = new PedestrianNavigation([['sidewalk']], 2);
  assert.deepEqual(isolated.createRoute(new THREE.Vector3()), []);
  assert.deepEqual(nav.createRoute(new THREE.Vector3(-100, 0, 0)), []);
});

test('en Bogotá los recorridos usan andenes y cruces, evitan la tienda y pasan bajo la estación elevada', () => {
  const city = district();
  const nav = city._createPedestrianNavigation();
  assert.equal(nav.isWalkableAt(...point(68, 58)), false);
  assert.equal(nav.isWalkableAt(...point(48, 42)), true); // El bus y la estación quedan arriba.
  assert.equal(nav.isWalkableAt(...point(12, 40)), false); // Carril fuera de un cruce.
  assert.equal(nav.isWalkableAt(...point(12, 22)), true); // Cruce de Carrera 15.
  let crossingCount = 0;
  for (const start of [[36, 22], [42, 32], [56, 38], [16, 54], [68, 86]]) {
    for (let seed = 1; seed <= 20; seed++) {
      const route = nav.createRoute(nav.nearestPoint(...point(...start)), rng(seed));
      assert.ok(route.length > 1);
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], b = route[i];
        assert.equal(Math.abs(a.x - b.x) + Math.abs(a.z - b.z), 2);
        for (let fraction = 0; fraction <= 1; fraction += 0.1) {
          assert.ok(nav.isWalkableAt(a.x + (b.x - a.x) * fraction, a.z + (b.z - a.z) * fraction));
        }
        if (['road', 'busway'].includes(city.map[b.z / 2][b.x / 2])) crossingCount++;
      }
      const last = route.at(-1);
      assert.ok(!['road', 'busway'].includes(city.map[last.z / 2][last.x / 2]));
    }
  }
  assert.ok(crossingCount > 0);
});

test('los peatones avanzan fuera de cámara, siguen nuevas rutas y ajustan su altura', async () => {
  const nav = new PedestrianNavigation([Array(14).fill('sidewalk')], 2, {
    groundHeight: (x) => x < 8 ? 0.12 : 0
  });
  let routes = 0;
  const original = nav.createRoute.bind(nav);
  nav.createRoute = (position) => { routes++; return original(position, () => 0.9); };
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(0, 0.12, 0), {
    navigation: nav, groundHeight: nav.groundHeight,
    isWalkable: (x, z) => nav.isWalkableAt(x, z), speed: 1.1, look: {}
  });
  await npc.ready;
  let maximumX = 0;
  for (let frame = 0; frame < 2400; frame++) {
    const before = npc.position.clone();
    npc.update(0.05, { frustum: { intersectsSphere: () => false } });
    assert.ok(Math.hypot(npc.position.x - before.x, npc.position.z - before.z) <= 1.1 * 0.05 + 1e-8);
    assert.equal(npc.position.y, nav.groundHeight(npc.position.x));
    assert.ok(nav.isWalkableAt(npc.position.x, npc.position.z));
    maximumX = Math.max(maximumX, npc.position.x);
  }
  assert.ok(maximumX > 16);
  assert.ok(routes >= 3);
  assert.equal(npc.root.visible, false);
  npc.dispose();
});

test('la población incluye peatones junto al inicio y mantiene quietos a los vendedores', async () => {
  const city = district();
  city._spawnPeople();
  await Promise.all(city.npcs.map(npc => npc.ready));
  assert.equal(city.npcs.length, 108);
  assert.ok(city.npcs.some(npc => npc.position.distanceTo(new THREE.Vector3(STREET_X.world(20), 0, STREET_Z.world(11))) < 5));
  const starts = city.npcs.map(npc => npc.position.clone());
  for (let frame = 0; frame < 100; frame++) for (const npc of city.npcs) npc.update(0.05);
  for (let i = 0; i < city.npcs.length; i++) {
    assert.ok(city.npcs[i].position.distanceTo(starts[i]) > 0.5);
    assert.ok(city.pedestrianNavigation.isWalkableAt(city.npcs[i].position.x, city.npcs[i].position.z));
  }
  const vendor = new Npc(city.scene, new THREE.Vector3(5, 0.12, 5), { look: {}, isWalkable: () => false });
  await vendor.ready;
  for (let frame = 0; frame < 100; frame++) vendor.update(0.1);
  assert.deepEqual(vendor.position.toArray(), [5, 0.12, 5]);
  vendor.dispose();
  city.dispose(city.scene);
});

test('un peatón lejano sigue caminando sin animar y recupera la animación al acercarse', async () => {
  const nav = new PedestrianNavigation([Array(80).fill('sidewalk')], 2);
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(80, 0, 0), {
    look: {}, navigation: nav, speed: 1, isWalkable: (x, z) => nav.isWalkableAt(x, z)
  });
  await npc.ready;
  let animated = 0;
  npc.character.update = () => { animated++; };
  npc.target = new THREE.Vector3(90, 0, 0);
  for (let i = 0; i < 60; i++) npc.update(1 / 60, { player: new THREE.Vector3(), frustum: { intersectsSphere: () => true } });
  assert.ok(npc.position.x > 80.5);
  assert.equal(animated, 0);
  npc.update(1 / 60, { player: npc.position.clone().add(new THREE.Vector3(15, 0, 0)) });
  assert.equal(animated, 1);
  npc.dispose();
});

test('la precarga de peatones conserva el LOD bajo y limita los modelos completos simultáneos', async () => {
  const scene = new THREE.Scene();
  const npcs = Array.from({ length: NPC_LOD.maxFull + 2 }, (_, index) =>
    new Npc(scene, new THREE.Vector3(index * 0.2, 0, 0), { look: {} }));
  await Promise.all(npcs.map(npc => npc.ready));
  const beforePreload = realisticCreates;
  await Promise.all(npcs.map(npc => npc.preload()));
  assert.equal(realisticCreates - beforePreload, 0);
  assert.ok(npcs.every(npc => npc.lodChar?.lod));
  assert.ok(npcs.every(npc => !npc.fullChar));

  const player = new THREE.Vector3();
  const beforeFullLoads = realisticCreates;
  for (const npc of npcs) npc.update(1 / 60, { player, frustum: { intersectsSphere: () => true } });
  await Promise.all(npcs.map(npc => npc._fullLoading).filter(Boolean));
  assert.equal(npcs.filter(npc => npc.fullChar).length, NPC_LOD.maxFull);
  assert.equal(realisticCreates - beforeFullLoads, NPC_LOD.maxFull);

  player.set(100, 0, 100);
  for (const npc of npcs) npc.update(1 / 60, { player, frustum: { intersectsSphere: () => false } });
  assert.ok(npcs.every(npc => !npc.fullChar));
  player.set(0, 0, 0);
  for (const npc of npcs) npc.update(1 / 60, { player, frustum: { intersectsSphere: () => true } });
  await Promise.all(npcs.map(npc => npc._fullLoading).filter(Boolean));
  assert.equal(npcs.filter(npc => npc.fullChar).length, NPC_LOD.maxFull);
  assert.equal(realisticCreates - beforeFullLoads, NPC_LOD.maxFull);
  assert.equal(fullLookChanges, NPC_LOD.maxFull);
  for (const npc of npcs) npc.dispose();
});

test('un NPC fuera de combate libera sus modelos y reaparece en su punto sin alterar la población', async () => {
  const scene = new THREE.Scene();
  const home = new THREE.Vector3(4, 0, 6);
  const npc = new Npc(scene, home, { look: {}, groundHeight: () => 0.25 });
  await npc.ready;
  const createdBefore = realisticCreates;
  const disposedBefore = realisticDisposals;

  npc.applyDamage(npc.maxHp);
  assert.equal(npc.hp, 0);
  npc.update(3.5, { player: new THREE.Vector3(100, 0, 100), frustum: { intersectsSphere: () => false } });
  assert.equal(npc.root.visible, false);
  assert.equal(npc.lodChar, null);
  assert.equal(npc.character, null);
  assert.equal(realisticDisposals, disposedBefore + 1);
  assert.ok(scene.children.includes(npc.root));

  npc.update(8);
  await npc._respawnLoading;
  assert.equal(npc.hp, npc.maxHp);
  assert.equal(npc.root.visible, true);
  assert.deepEqual(npc.position.toArray(), [home.x, 0.25, home.z]);
  assert.equal(realisticCreates, createdBefore + 1);
  assert.ok(scene.children.includes(npc.root));
  npc.dispose();
});

test('al quedar fuera de combate los NPC usan únicamente sus clips de derrota', async () => {
  const scene = new THREE.Scene();
  const heard = [];
  const npc = new Npc(scene, new THREE.Vector3(), { look: {} });
  await npc.ready;
  npc.audio = { playNpcVoice: (path, owner, options) => { heard.push({ path, owner, options }); return true; } };
  npc.say = () => {};
  npc.applyDamage(npc.maxHp);
  assert.equal(heard.length, 1);
  assert.ok(['/audio/derrota.mp3', '/audio/ahh.mp3'].includes(heard[0].path));
  assert.equal(heard[0].owner, npc);
  assert.deepEqual(heard[0].options, { allowKnockedOut: true });
  npc.dispose();
});

test('las voces ambientales salen al pasar cerca, filtran las voces femeninas y evitan repetir', async () => {
  const scene = new THREE.Scene();
  const player = new THREE.Vector3();
  const heard = [];
  const makeWalker = async sexo => {
    const npc = new Npc(scene, new THREE.Vector3(2.5, 0, 0), { look: { real: { sexo } } });
    await npc.ready;
    npc.moving = true;
    npc.audio = { playNpcVoice: path => { heard.push(path); return true; } };
    npc.say = () => {};
    return npc;
  };
  const woman = await makeWalker('mujer');
  const ambientVoices = NPC_VOICE_BANK.ambient;
  NPC_VOICE_BANK.ambient = ambientVoices.filter(entry => entry.gender === 'mujer');
  try {
    woman._updateSpeech(1 / 60, { player });
    woman._updateSpeech(1 / 60, { player });
    assert.equal(heard.length, 1);
    assert.ok(['/audio/asqueroso.mp3', '/audio/petrista.mp3'].includes(heard[0]));
  } finally {
    NPC_VOICE_BANK.ambient = ambientVoices;
  }

  const man = await makeWalker('hombre');
  man._updateSpeech(1 / 60, { player });
  assert.equal(heard.length, 2);
  assert.ok(['/audio/locohp.mp3', '/audio/hedor.mp3'].includes(heard[1]));
  assert.notEqual(heard[0], heard[1]);
  woman.dispose();
  man.dispose();
});

test('encuerenrata se reserva para los NPC que persiguen tras un robo', async () => {
  const scene = new THREE.Scene(), player = { position: new THREE.Vector3(20, 0, 0) };
  const robberyVictim = new Npc(scene, new THREE.Vector3(), { look: {} });
  await robberyVictim.ready;
  const robberyCategories = [];
  robberyVictim.speakScenario = category => robberyCategories.push(category);
  robberyVictim.onRobbed(player);
  robberyVictim.combatAI.update(1 / 60);
  assert.deepEqual(robberyCategories, ['theftChase', 'theftChase']);

  const ordinaryCombatant = new Npc(scene, new THREE.Vector3(), { look: {} });
  await ordinaryCombatant.ready;
  const ordinaryCategories = [];
  ordinaryCombatant.speakScenario = category => ordinaryCategories.push(category);
  ordinaryCombatant.beginAssault(player);
  ordinaryCombatant.combatAI.update(1 / 60);
  assert.deepEqual(ordinaryCategories, ['mob']);
  robberyVictim.dispose();
  ordinaryCombatant.dispose();
});

test('la voz Peste es femenina y solo está disponible durante persecuciones por robo', async () => {
  const scene = new THREE.Scene();
  const heard = [];
  const femaleTheftVoice = NPC_VOICE_BANK.theftChase.find(entry => entry.audio === '/audio/peste.mp3');
  assert.equal(femaleTheftVoice?.gender, 'mujer');
  const theftVoices = NPC_VOICE_BANK.theftChase;
  NPC_VOICE_BANK.theftChase = [femaleTheftVoice];
  try {
    for (const sexo of ['mujer', 'hombre']) {
      const npc = new Npc(scene, new THREE.Vector3(), { look: { real: { sexo } } });
      await npc.ready;
      npc.say = () => {};
      npc.audio = { playNpcVoice: path => { heard.push(path); return true; } };
      npc.speakScenario('theftChase', true);
      npc.dispose();
    }
    assert.deepEqual(heard, ['/audio/peste.mp3']);
  } finally {
    NPC_VOICE_BANK.theftChase = theftVoices;
  }
});
