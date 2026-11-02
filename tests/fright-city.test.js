// Los sustos en la ciudad de verdad: la gente fija huye por la red y no atraviesa sólidos.
import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

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
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { TERMINAL } = await import('../src/world/bogota/TransitTerminal.js');

const city = new Bogota(), scene = new THREE.Scene(), collisions = new CollisionSystem();
city.build(scene, collisions);
after(() => city.dispose(scene));
const nav = city.pedestrianNavigation, T = nav.tileSize;
const fixed = city.npcs.filter(npc => npc.fijo && !npc.isVendor);
const onPlatform = npc => npc.position.z < 0;
const FAR = new THREE.Vector3(600, 0, 600);

beforeEach(() => { globalThis.window = new EventTarget(); });

const solidAt = (x, y, z, r = .15) => collisions.queryStatic(x - r, z - r, x + r, z + r, []).some(({ box }) =>
  box.max.y > y + .5 && box.min.y < y + 1.2 && x > box.min.x - r && x < box.max.x + r && z > box.min.z - r && z < box.max.z + r);

test('bajo el puente del lago ningún tramo atraviesa un pilar', () => {
  const under = nav.nodes.filter(node => node.underDeck);
  assert.ok(under.length > 100);
  const cuts = new Set(under.map(node => nav.nodes.indexOf(node)).filter(id => !nav.nodes[id].neighbors.length));
  assert.ok(cuts.size > 0, 'hay un pilar encima de alguna baldosa');
  const pillars = collisions.colliders.filter(({ box }) => box.max.x - box.min.x < 1.5 && box.max.z - box.min.z < 1.5 && box.max.y > 2 && box.min.y < 1 && box.min.z > 222 && box.max.z < 310).map(({ box }) => box);
  assert.ok(pillars.length > 0);
  for (const node of under) for (const next of node.neighbors) {
    const other = nav.nodes[next];
    const minX = Math.min(node.x, other.x) * T, maxX = Math.max(node.x, other.x) * T, minZ = Math.min(node.z, other.z) * T, maxZ = Math.max(node.z, other.z) * T;
    assert.ok(!pillars.some(box => box.max.x > minX && box.min.x < maxX && box.max.z > minZ && box.min.z < maxZ), `tramo en ${node.x * T}, ${node.z * T}`);
  }
});

test('de los nodos fuera de la red principal se sale caminando, y a los fijos no les cambia su sitio', () => {
  const outside = nav.nodes.filter(node => !node.main);
  assert.ok(nav.nodes.filter(node => node.main).length > 15000);
  assert.ok(outside.length < 100, `${outside.length} sueltos`);
  // (384,278) queda dentro de una torre: nadie puede entrar ahí, porque la huida no se mete en lo sólido.
  const stuck = [];
  for (const node of outside) {
    const x = node.x * T, z = node.z * T, goal = nav.nodes[nav._nearestNode(x, z)];
    assert.ok(goal.main);
    const dx = goal.x * T - x, dz = goal.z * T - z, steps = Math.ceil(Math.hypot(dx, dz) / .05);
    let free = true;
    for (let i = 0; i <= steps && free; i++) free = nav.isWalkableAt(x + dx * i / steps, z + dz * i / steps);
    if (!free) stuck.push(`${x},${z}`);
  }
  assert.deepEqual(stuck, ['384,278']);
  assert.ok(solidAt(384, nav.groundHeight(384, 278), 278));
  // El bolsillo que encontró la revisión.
  for (const [x, z] of [[382, 282], [382, 284], [380, 284], [384, 280]]) {
    const route = nav.createRoute(new THREE.Vector3(x, 0, z), () => .5);
    assert.ok(route.length > 1, `${x}, ${z}`);
    assert.ok(route.every(p => nav.nodes[nav.nodeAt(p.x, p.z)].main));
  }
  for (const npc of fixed.filter(npc => !onPlatform(npc))) {
    const back = nav.routeTo(new THREE.Vector3(npc.home.x + .1, 0, npc.home.z), npc.home);
    assert.ok(back.length, `${npc.fijo.stance} en ${npc.home.x}, ${npc.home.z} tiene cómo volver`);
    assert.deepEqual(back.at(-1).toArray(), npc.home.toArray());
  }
});

test('la huida va por la red: fuera de ella ni a un metro de su sitio', () => {
  for (const npc of fixed.filter(npc => !onPlatform(npc))) {
    const where = `${npc.fijo.stance} en ${npc.home.x.toFixed(1)}, ${npc.home.z.toFixed(1)}`;
    for (let a = 0; a < 16; a++) for (const r of [1, 2, 3, 3.9]) {
      const x = npc.home.x + Math.cos(a / 16 * Math.PI * 2) * r, z = npc.home.z + Math.sin(a / 16 * Math.PI * 2) * r;
      assert.equal(npc.isWalkable(x, z), nav.isWalkableAt(x, z), `${where}: ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
    assert.ok(npc.fijo.reach > 0, 'el último tramo de regreso sí puede salirse');
  }
});

test('nadie se mete en un sólido huyendo, y todos vuelven', () => {
  const dt = 1 / 15, ctx = { player: FAR };
  for (const npc of fixed) {
    const partner = npc.fijo.pareja;
    npc.fijo.pareja = null;
    for (let k = 0; k < 8; k++) {
      const angle = k / 8 * Math.PI * 2 + .3;
      Object.assign(npc.fijo, { out: false, fails: 0 });
      npc.position.copy(npc.home); npc.stance = npc.fijo.stance; npc.target = null; npc.route = []; npc.fleeTimer = 0;
      npc._fleeFrom(new THREE.Vector3(npc.position.x - Math.sin(angle), npc.position.y, npc.position.z - Math.cos(angle)));
      let inside = 0;
      for (let i = 0; i < 8 * 15; i++) {
        npc.update(dt, ctx);
        const started = npc.position.distanceTo(npc.home) < 1.2; // quien sale de la banca arranca dentro de ella
        if (npc.moving && npc.fleeTimer > 0 && !started && solidAt(npc.position.x, npc.position.y, npc.position.z)) inside += dt;
      }
      const where = `${npc.fijo?.stance} en ${npc.home.x.toFixed(1)}, ${npc.home.z.toFixed(1)}, rumbo ${k}`;
      assert.equal(inside, 0, `${where}: ${inside.toFixed(1)} s dentro de un sólido`);
      for (let i = 0; i < 90 * 15 && npc.fijo.out; i++) npc.update(dt, ctx);
      assert.equal(npc.fijo?.out, false, `${where}: no volvió`);
      assert.deepEqual(npc.position.toArray(), npc.home.toArray());
    }
    npc.fijo.pareja = partner;
  }
});

test('en la red no queda ningún tramo de andén que atraviese un sólido, y sigue siendo una sola', () => {
  const r = .2;
  let edges = 0;
  for (const [id, node] of nav.nodes.entries()) {
    for (const other of node.neighbors) {
      const next = nav.nodes[other];
      assert.ok(next.neighbors.includes(id), 'los tramos siguen siendo de ida y vuelta');
      if (other < id || node.crossing || next.crossing) continue;
      edges++;
      const minX = Math.min(node.x, next.x) * T - r, maxX = Math.max(node.x, next.x) * T + r, minZ = Math.min(node.z, next.z) * T - r, maxZ = Math.max(node.z, next.z) * T + r;
      const low = Math.min(nav.groundHeight(node.x * T, node.z * T), nav.groundHeight(next.x * T, next.z * T));
      const solid = collisions.queryStatic(minX, minZ, maxX, maxZ, []).find(({ box }) => box.max.x > minX && box.min.x < maxX && box.max.z > minZ && box.min.z < maxZ && box.max.y > low + .5 && box.min.y < low + 1.2);
      assert.equal(solid, undefined, `tramo ${node.x},${node.z} a ${next.x},${next.z}`);
    }
  }
  assert.ok(edges > 15000);
  // La gente sigue pudiendo ir a todas partes.
  const main = new Set(), queue = [nav.nodeAt(112, 96)];
  main.add(queue[0]);
  while (queue.length) for (const next of nav.nodes[queue.pop()].neighbors) if (!main.has(next)) { main.add(next); queue.push(next); }
  assert.ok(main.size / nav.nodes.length > .99, `${main.size} de ${nav.nodes.length}`);
  for (const npc of city.npcs) {
    if (!npc.navigation) continue;
    const id = nav.nodeAt(npc.position.x, npc.position.z);
    if (npc.fijo?.stance !== 'banca' || nav.nodes[id].neighbors.length) assert.ok(main.has(id), `nadie queda en una isla: ${npc.position.x}, ${npc.position.z}`);
    assert.ok(nav.routeTo(npc.position, npc.home).length > 0 || npc.position.distanceTo(npc.home) < .01, `sin camino: ${npc.home.x}, ${npc.home.z}`);
  }
});

test('ningún tramo pasa por encima de una banca, y dar la vuelta cuesta poco', () => {
  assert.ok(city.benchSpots.length >= 20);
  const hops = (from, to) => {
    const seen = new Map([[from, 0]]), queue = [from];
    while (queue.length) {
      const id = queue.shift();
      if (id === to) return seen.get(id);
      for (const next of nav.nodes[id].neighbors) if (!seen.has(next)) { seen.set(next, seen.get(id) + 1); queue.push(next); }
    }
    return Infinity;
  };
  for (const { x, z, rot } of city.benchSpots) {
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)), hx = c * .83 + s * .3, hz = s * .83 + c * .3;
    for (const [id, node] of nav.nodes.entries()) {
      if (Math.abs(node.x * T - x) > 4 || Math.abs(node.z * T - z) > 4) continue;
      for (const other of node.neighbors) {
        const next = nav.nodes[other];
        if (node.crossing || next.crossing) continue;
        const crosses = Math.max(node.x, next.x) * T > x - hx && Math.min(node.x, next.x) * T < x + hx && Math.max(node.z, next.z) * T > z - hz && Math.min(node.z, next.z) * T < z + hz;
        assert.ok(!crosses, `banca en ${x}, ${z}: tramo ${node.x * T},${node.z * T} a ${next.x * T},${next.z * T}`);
      }
      // Los que quedaron a cada lado de la banca se siguen encontrando sin ir a dar la vuelta a la manzana.
      if (Math.abs(node.x * T - x) > 2 || Math.abs(node.z * T - z) > 2 || !node.neighbors.length) continue;
      for (const [dx, dz] of [[2, 0], [0, 2], [-2, 0], [0, -2]]) {
        const across = nav.nodeAt(node.x * T + dx * 2, node.z * T + dz * 2), middle = nav.nodeAt(node.x * T + dx, node.z * T + dz);
        if (across < 0 || middle < 0 || nav.nodes[middle].neighbors.length || !nav.nodes[across].neighbors.length) continue;
        assert.ok(hops(id, across) <= 14, `banca en ${x}, ${z} parte el camino`);
      }
    }
  }
});

test('en la ciudad el sitio de espera siempre queda lejos de los carriles', () => {
  const lanes = [];
  const point = new THREE.Vector3(), direction = new THREE.Vector3(), routes = city.getTrafficRoutes();
  for (const route of [...routes, ...routes.alternatives]) for (let d = 0; d < route.length; d += .5) { route.sample(d, point, direction); if (point.y < 2) lanes.push([point.x, point.z]); }
  // Muchos cruces acaban en el mismo andén: cada sitio de espera se mide una sola vez.
  const nearest = new Map();
  const toLane = end => {
    const key = `${end.x},${end.z}`;
    if (!nearest.has(key)) nearest.set(key, Math.sqrt(lanes.reduce((best, [x, z]) => Math.min(best, (x - end.x) ** 2 + (z - end.z) ** 2), Infinity)));
    return nearest.get(key);
  };
  let measured = 0;
  for (const node of nav.nodes) {
    if (!node.crossing) continue;
    const route = nav.routeToRest(new THREE.Vector3(node.x * T + .4, 0, node.z * T - .3));
    if (!route.length) continue;
    const end = route.at(-1), near = toLane(end);
    measured++;
    assert.ok(near > 2.5, `espera en ${end.x}, ${end.z}, a ${near.toFixed(2)} m de un carril`);
    assert.ok(nav.isRestingAt(end));
  }
  assert.ok(measured > 1000, `${measured} cruces`);
});

test('la cubierta del Portal y la marquesina de la gasolinera son techo; la calle y el andén descubierto no', () => {
  assert.equal(city.isRoofedAt(75, -16.3), true);
  assert.equal(city.isRoofedAt(154, 100), true);
  assert.equal(city.isRoofedAt(154, 112), false, 'la tienda de la gasolinera queda fuera de la marquesina');
  assert.equal(city.isRoofedAt(TERMINAL.x, -30), true);
  assert.equal(city.isRoofedAt(75, -55), false, 'el andén sigue más allá de la cubierta');
  assert.equal(city.isRoofedAt(75, -5), false);
  assert.equal(city.isRoofedAt(112.98, 97.84), false);
});

test('la ciudad le avisa a la gente de las patrullas en persecución, también a las que van de regreso', () => {
  const contexts = [];
  const person = { position: FAR, update(dt, ctx) { contexts.push([...ctx.chasers]); } };
  const everyone = city.npcs;
  city.npcs = [person];
  const car = { position: new THREE.Vector3(700, 0, 700), group: { rotation: { y: 0 } } };
  const a = { car, state: 'chase' }, b = { car, state: 'patrol', rejoinTarget: {} }, c = { car, state: 'patrol' };
  try {
    city.update(.016, FAR, null, [a, b, c]);
    city.update(.016, FAR, null, [c]);
  } finally {
    city.npcs = everyone;
  }
  assert.deepEqual(contexts[0], [a, b]);
  assert.deepEqual(contexts[1], []);
});
