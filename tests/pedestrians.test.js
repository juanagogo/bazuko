import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { STREET_X, STREET_Z } from '../src/world/bogota/StreetLayout.js';
const point = (x, z) => [STREET_X.world(x / 2), STREET_Z.world(z / 2)];
import { rng } from '../src/world/bogota/textures.js';

// La navegación y los NPC son reales; solo se sustituye la carga de modelos GLB.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { Npc } = await import('../src/entities/Npc.js');
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

test('de un cruce se sale por el lado más corto, y se espera en el centro de una baldosa de andén', () => {
  const road = x => (x >= 2 && x <= 4 ? 'road' : 'sidewalk');
  const nav = new PedestrianNavigation([0, 1, 2].map(() => [0, 1, 2, 3, 4, 5, 6].map(road)), 2, { isCrossing: x => x >= 2 && x <= 4 });
  assert.equal(nav.nodes[nav.nodeAt(4, 2)].crossing, true);
  const corner = nav.routeToRest(new THREE.Vector3(4.3, 0, 2.5));
  assert.deepEqual(corner.map(p => [p.x, p.z]), [[2, 2]], 'sale al andén que tiene al lado, sin cruzar toda la calle');
  assert.equal(nav.isRestingAt(corner[0]), true);
  const other = nav.routeToRest(new THREE.Vector3(8, 0, 2));
  assert.deepEqual(other.map(p => [p.x, p.z]), [[10, 2]]);
  const onWalk = nav.routeToRest(new THREE.Vector3(.7, 0, 2.6));
  assert.deepEqual(onWalk.map(p => [p.x, p.z]), [[0, 2]], 'en el andén solo va al centro');
  assert.equal(nav.isRestingAt(new THREE.Vector3(.7, 0, 2.6)), false);
  assert.equal(nav.isRestingAt(new THREE.Vector3(4, 0, 2)), false, 'el centro de un cruce no sirve');
  assert.equal(nav.isRestingAt(new THREE.Vector3(-20, 0, 0)), false);
  const fuera = nav.routeToRest(new THREE.Vector3(-3, 0, 2));
  assert.deepEqual([fuera[0].x, fuera[0].z], [0, 2], 'fuera de la red vuelve a ella');
  const sinAnden = new PedestrianNavigation([['road']], 2, { isCrossing: () => true });
  assert.deepEqual(sinAnden.routeToRest(new THREE.Vector3()), []);
});

test('una banca corta los tramos que le pasan por encima, aunque no tenga colisión', () => {
  const row = Array(6).fill('sidewalk');
  const nav = new PedestrianNavigation([row, row, row], 2);
  const none = { queryStatic: (a, b, c, d, out) => { out.length = 0; return out; } };
  // Banca entre los centros (4, 2) y (6, 2); los tramos de los lados siguen.
  nav.cutSolidEdges(none, .2, [{ minX: 4.7, maxX: 5.3, minZ: 1.17, maxZ: 2.83 }]);
  const at = (x, z) => nav.nodes[nav.nodeAt(x, z)];
  assert.ok(!at(4, 2).neighbors.includes(nav.nodeAt(6, 2)));
  assert.ok(!at(6, 2).neighbors.includes(nav.nodeAt(4, 2)));
  assert.ok(at(4, 0).neighbors.includes(nav.nodeAt(6, 0)), 'sigue por el lado');
  assert.ok(at(4, 2).neighbors.includes(nav.nodeAt(4, 0)));
});

test('los tramos que atraviesan algo sólido se cortan, sin tocar los cruces ni dejar a nadie encerrado', () => {
  const row = ['sidewalk', 'sidewalk', 'sidewalk', 'road', 'sidewalk'];
  const nav = new PedestrianNavigation([row, row, row], 2, { isCrossing: x => x === 3 });
  const solids = [
    { box: new THREE.Box3(new THREE.Vector3(.9, 0, -1), new THREE.Vector3(1.1, 4, 1)) }, // entre (0,0) y (2,0)
    { box: new THREE.Box3(new THREE.Vector3(.9, 0, 3), new THREE.Vector3(1.1, .3, 5)) }, // un bordillo bajo: se pasa por encima
    { box: new THREE.Box3(new THREE.Vector3(4.9, 0, 3), new THREE.Vector3(5.1, 4, 5)) }  // junto a un cruce: los cruces no se tocan
  ];
  const collisions = { queryStatic: (a, b, c, d, out) => { out.length = 0; out.push(...solids); return out; } };
  const id = (x, z) => nav.nodeAt(x, z);
  nav.cutSolidEdges(collisions);
  assert.ok(!nav.nodes[id(0, 0)].neighbors.includes(id(2, 0)));
  assert.ok(!nav.nodes[id(2, 0)].neighbors.includes(id(0, 0)), 'de ida y de vuelta');
  assert.ok(nav.nodes[id(0, 2)].neighbors.includes(id(2, 2)), 'se sigue pasando por al lado');
  assert.ok(nav.nodes[id(0, 4)].neighbors.includes(id(2, 4)), 'lo bajo no estorba');
  assert.ok(nav.nodes[id(4, 4)].neighbors.includes(id(6, 4)), 'el cruce sigue igual');
  const around = nav.routeTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 0, 0));
  assert.ok(around.length >= 3, 'da la vuelta');
  // Una columna encima de una baldosa la deja suelta: quien esté ahí sale a la más cercana.
  const alone = new PedestrianNavigation([row, row, row], 2, { isCrossing: x => x === 3 });
  const column = [{ box: new THREE.Box3(new THREE.Vector3(1.9, 0, -.1), new THREE.Vector3(2.1, 4, .1)) }];
  alone.cutSolidEdges({ queryStatic: (a, b, c, d, out) => { out.length = 0; out.push(...column); return out; } });
  assert.equal(alone.nodes[alone.nodeAt(2, 0)].neighbors.length, 0);
  const route = alone.createRoute(new THREE.Vector3(2, 0, 0), () => .5);
  assert.ok(route.length > 1, 'no se queda parado para siempre');
  assert.notDeepEqual([route[0].x, route[0].z], [2, 0]);
  assert.notEqual(alone.routeTo(new THREE.Vector3(2, 0, 0), new THREE.Vector3(8, 0, 4)).length, 0);
  assert.equal(alone.isRestingAt(new THREE.Vector3(0, 0, 0)), true);
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

test('un tramo de la red no salva más que un escalón, ni siquiera en un cruce', () => {
  const steps = { 2: .5, 8: 7.8, 10: 7.3 };
  const row = ['sidewalk', 'sidewalk', 'sidewalk', 'sidewalk', 'road', 'sidewalk'];
  const nav = new PedestrianNavigation([row], 2, { isCrossing: () => true, groundHeight: x => steps[x] ?? 0 });
  const linked = (a, b) => nav.nodes[nav.nodeAt(a, 0)].neighbors.includes(nav.nodeAt(b, 0));
  assert.ok(linked(0, 2), 'medio metro es un escalón');
  assert.ok(!linked(6, 8) && !linked(8, 6), 'siete metros no, en ningún sentido, aunque sea de cruce');
  assert.ok(linked(8, 10), 'arriba sigue siendo un tramo normal');
  for (let seed = 1; seed <= 20; seed++) {
    assert.ok(nav.createRoute(new THREE.Vector3(0, 0, 0), rng(seed)).every(p => p.x <= 6), 'una ruta no sube');
  }
});

test('quien cae en un bolsillo suelto sale a la red principal por el camino más corto', () => {
  const big = Array(8).fill('sidewalk');
  const map = [big, big, big, Array(8).fill('wall'), ['sidewalk', 'sidewalk', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall']];
  const nav = new PedestrianNavigation(map, 2);
  const pocket = new THREE.Vector3(2, 0, 8);
  assert.equal(nav.nodes[nav.nodeAt(2, 8)].main, false);
  assert.equal(nav.nodes[nav.nodeAt(0, 0)].main, true);
  const route = nav.createRoute(pocket, () => .5);
  assert.ok(route.length > 1);
  assert.ok(route.every(p => nav.nodes[nav.nodeAt(p.x, p.z)].main), 'todos sus puntos están en la red principal');
  assert.equal(route[0].z, 4, 'arranca del nodo de la principal más cercano');
  const home = nav.routeTo(pocket, new THREE.Vector3(14, 0, 0));
  assert.ok(home.length > 1, 'también puede volver a un sitio de la principal');
  assert.ok(home.slice(0, -1).every(p => nav.nodes[nav.nodeAt(p.x, p.z)].main));
  assert.equal(nav.nodes[nav.nodeAt(nav.routeToRest(pocket)[0].x, nav.routeToRest(pocket)[0].z)].main, true);
  // Se calcula otra vez después de cortar: un corte puede dejar un bolsillo donde antes no lo había.
  const none = { queryStatic: (a, b, c, d, out) => { out.length = 0; return out; } };
  const row = Array(6).fill('sidewalk'), cut = new PedestrianNavigation([row], 2);
  cut.cutSolidEdges(none, .2, [{ minX: 3.9, maxX: 4.1, minZ: -1, maxZ: 1 }]);
  assert.equal(cut.nodes[cut.nodeAt(0, 0)].main, false);
  assert.equal(cut.nodes[cut.nodeAt(10, 0)].main, true);
  const alone = new PedestrianNavigation([['sidewalk']], 2);
  assert.deepEqual(alone.routeToRest(new THREE.Vector3()), [], 'sin red principal con tramos no hay a dónde ir');
});

test('en el puente del lago se anda por debajo: el tablero es del bus y sobre el agua no hay nodos', () => {
  const city = district();
  const nav = city._createPedestrianNavigation(), T = nav.tileSize;
  const height = node => nav.groundHeight(node.x * T, node.z * T);
  for (const [id, node] of nav.nodes.entries()) {
    assert.ok(height(node) < 1.2, `nodo alto en ${node.x * T}, ${node.z * T}`);
    for (const next of node.neighbors) assert.ok(Math.abs(height(node) - height(nav.nodes[next])) <= .6, `tramo ${id}-${next}`);
    if (city.map[node.z][node.x] === 'busway') assert.equal(city.getWaterInfo(node.x * T, node.z * T), null, `calzada sobre el agua en ${node.x * T}, ${node.z * T}`);
  }
  // La calle sigue en su sitio: donde antes daba 7,82 ahora da el piso, y el resto de la ciudad no cambió.
  assert.equal(nav.groundHeight(94, 220), .12);
  assert.ok(city.getGroundHeight(94, 220) > 7, 'la cota del tablero sigue para el bus y para el jugador');
  assert.equal(nav.groundHeight(40, 40), city.getGroundHeight(40, 40));
  // Al norte y al sur del lago se cruza de un lado al otro pasando bajo el tablero, sin dar la vuelta al parque.
  for (const [ax, bx, z] of [[74, 112, 224], [60, 94, 296]]) {
    const route = nav.routeTo(new THREE.Vector3(ax, 0, z), new THREE.Vector3(bx, 0, z));
    assert.ok(route.length > 1 && route.length < (bx - ax) / T + 8, `de ${ax} a ${bx} en Z ${z}: ${route.length} tramos`);
    assert.ok(route.every(p => p.y < 1));
    assert.ok(route.some(p => nav.nodes[nav.nodeAt(p.x, p.z)]?.underDeck), 'pasa por debajo');
  }
  // Donde el tablero ya viene bajando no cabe una persona, y el GPS no se entera de esta regla.
  assert.equal(nav.isWalkableAt(74, 310), false);
  assert.equal(city._pedestrianRules().isBlocked(37, 155), false);
  // Nadie arranca arriba.
  city._spawnPeople();
  assert.ok(city.npcs.filter(npc => npc.navigation).every(npc => npc.position.y < 1.2));
  city.dispose(city.scene);
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
  assert.equal(city.npcs.length, 80); // 66 del centro y 14 de los barrios del oriente.
  assert.ok(city.npcs.some(npc => npc.position.distanceTo(new THREE.Vector3(STREET_X.world(20), 0, STREET_Z.world(11))) < 5));
  const starts = city.npcs.map(npc => npc.position.clone()), moved = city.npcs.map(() => 0);
  // Una parada dura a lo sumo 20 s: en 25 s todos los que caminan han salido, y quien se queda en su sitio ahí sigue.
  for (let frame = 0; frame < 500; frame++) city.npcs.forEach((npc, i) => {
    npc.update(0.05);
    moved[i] = Math.max(moved[i], npc.position.distanceTo(starts[i]));
  });
  for (let i = 0; i < city.npcs.length; i++) {
    const npc = city.npcs[i];
    if (npc.fijo) { assert.equal(moved[i], 0); continue; }
    assert.ok(moved[i] > 0.5);
    assert.ok(city.pedestrianNavigation.isWalkableAt(npc.position.x, npc.position.z));
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
