import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { insideTower } from '../src/world/bogota/EastZones.js';

// La ciudad real, armada entera; solo se sustituyen las texturas y la carga de modelos.
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
const { LOW_STANCES } = await import('../src/character/archetypes.js');

const city = new Bogota(), scene = new THREE.Scene(), collisions = new CollisionSystem();
city.build(scene, collisions);
after(() => city.dispose(scene));

const everyone = city.npcs;
const vendors = everyone.filter(npc => npc.isVendor);
const fixed = everyone.filter(npc => npc.fijo && !npc.isVendor);
const walkers = everyone.filter(npc => !npc.fijo);
const nav = city.pedestrianNavigation;
const onPlatform = npc => npc.position.z < 0;
// Quien está en una banca queda, a propósito, dentro de la caja de la banca.
const onBench = npc => npc.fijo.stance === 'banca';

const lanes = [];
{
  const point = new THREE.Vector3(), direction = new THREE.Vector3();
  const routes = city.getTrafficRoutes();
  for (const route of [...routes, ...routes.alternatives]) {
    for (let d = 0; d < route.length; d += .5) { route.sample(d, point, direction); lanes.push([point.x, point.z]); }
  }
}
const toLane = (x, z) => lanes.reduce((best, [lx, lz]) => Math.min(best, Math.hypot(lx - x, lz - z)), Infinity);

function bodyInsideStatic(x, y, z, radius) {
  return collisions.queryStatic(x - radius, z - radius, x + radius, z + radius, []).some(({ box, layered }) => {
    if (layered && (y > box.max.y || y + 1.6 < box.min.y)) return false;
    return x > box.min.x - radius && x < box.max.x + radius && z > box.min.z - radius && z < box.max.z + radius;
  });
}

test('siguen siendo 88 personas: 8 vendedores y, de los otros 80, entre 15 y 20 se quedan en su sitio', () => {
  assert.equal(everyone.length, 88);
  assert.equal(vendors.length, 8);
  assert.ok(fixed.length >= 15 && fixed.length <= 20, `${fixed.length} fijos`);
  assert.equal(walkers.length + fixed.length, 80);
  assert.ok(new Set(fixed.map(npc => npc.fijo.stance)).size >= 5, 'hay sentados, dormidos, quien pide, quien conversa…');
  assert.ok(fixed.filter(onBench).length >= 3);
  assert.ok(fixed.some(npc => npc.fijo.stance === 'dormido'));
  assert.ok(fixed.some(npc => npc.fijo.stance === 'pedir'));
  assert.ok(fixed.some(npc => npc.fijo.pareja));
  assert.ok(fixed.some(onPlatform), 'el andén del Portal no se queda vacío');
  for (const npc of [...fixed, ...walkers]) assert.ok(npc.person, 'cada uno es alguien');
  for (const vendor of vendors) assert.equal(vendor.person.arquetipo, 'vendedor');
});

test('nadie fijo queda en la calzada, en un cruce ni donde un carro lo pise', () => {
  assert.ok(lanes.length > 1000, 'la prueba de verdad ve los carriles');
  for (const npc of fixed) {
    const { x, z } = npc.position, where = `${npc.fijo.stance} en ${x.toFixed(1)}, ${z.toFixed(1)}`;
    const node = nav.nodes[nav.nodeAt(x, z)];
    assert.ok(!node?.crossing, `${where}: en un cruce`);
    assert.ok(!['road', 'busway'].includes(city.tileTypeAt(Math.round(x / 2), Math.round(z / 2))) || onPlatform(npc), `${where}: en la calzada`);
    // Media buseta y el margen de _personInCar: a esa distancia nadie frena por él.
    assert.ok(toLane(x, z) > 1.15 + .55, `${where}: a ${toLane(x, z).toFixed(2)} m de un carril`);
    assert.equal(insideTower(x, z), false, where);
  }
});

test('nadie fijo queda dentro de un muro y quien espera en el andén no frena al bus', () => {
  for (const npc of fixed) {
    const { x, y, z } = npc.position, where = `${npc.fijo.stance} en ${x.toFixed(1)}, ${z.toFixed(1)}`;
    assert.ok(Number.isFinite(y) && y >= -.01 && y < 1.3, `${where}: a ${y} de altura`);
    if (!onBench(npc)) assert.equal(bodyInsideStatic(x, y, z, .25), false, `${where}: dentro de algo`);
    if (onPlatform(npc)) {
      // El carril está en 78,5 y 71,5 y el bus mide 2,5 de ancho: se detiene a menos de 0,55 m de alguien.
      assert.ok(Math.abs(x - 78.5) >= 1.25 + .56 && Math.abs(x - 71.5) >= 1.25 + .56, where);
      for (const [px, pz] of [[73.2, -30], [76.8, -30], [75, -1], [75, -60]]) assert.equal(npc.isWalkable(px, pz), false, 'no se baja del andén');
    }
  }
});

test('quien se sienta en una banca está en una banca, de frente y sobre el asiento', () => {
  for (const npc of fixed.filter(onBench)) {
    if (onPlatform(npc)) continue;
    const bench = city.benchSpots.find(spot => Math.hypot(spot.x - npc.position.x, spot.z - npc.position.z) < .6);
    assert.ok(bench, `banca en ${npc.position.x}, ${npc.position.z}`);
    assert.equal(npc.root.rotation.y, bench.rot);
  }
  assert.ok(city.benchSpots.length >= 20, 'el distrito sabe dónde puso sus bancas');
});

test('no tapan un paso angosto: quitar su baldosa no parte la red', () => {
  for (const npc of fixed) {
    const id = nav.nodeAt(npc.position.x, npc.position.z);
    if (id < 0 || !nav.nodes[id].neighbors.length) continue; // la banca sobre su baldosa ya la sacó de la red; lo mira fright-city
    const { neighbors } = nav.nodes[id];
    // Sus vecinos siguen conectados entre sí sin pasar por él, sin tener que dar la vuelta a la manzana.
    const seen = new Set([id, neighbors[0]]), queue = [{ node: neighbors[0], steps: 0 }];
    while (queue.length) {
      const { node, steps } = queue.shift();
      if (steps >= 14) continue;
      for (const next of nav.nodes[node].neighbors) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push({ node: next, steps: steps + 1 });
      }
    }
    for (const other of neighbors) assert.ok(seen.has(other), `${npc.fijo.stance} en ${npc.position.x}, ${npc.position.z} parte la red`);
  }
});

test('no estorban puertas, puestos ni lugares del juego', () => {
  const places = Object.entries(city.reserved ?? {}).filter(([, place]) => Number.isFinite(place?.x) && Number.isFinite(place?.z));
  assert.ok(places.length >= 5, 'la prueba de verdad ve los lugares');
  for (const npc of fixed) {
    const { x, z } = npc.position, where = `${npc.fijo.stance} en ${x.toFixed(1)}, ${z.toFixed(1)}`;
    for (const [name, place] of places) assert.ok(Math.hypot(place.x - x, place.z - z) > 1.2, `${where}: encima de ${name}`);
    for (const vendor of vendors) assert.ok(Math.hypot(vendor.position.x - x, vendor.position.z - z) > 2, `${where}: encima de un puesto`);
    for (const other of fixed) {
      if (other !== npc) assert.ok(Math.hypot(other.position.x - x, other.position.z - z) > .7, `${where}: encima de otro`);
    }
  }
});

test('cada quien sabe volver a su sitio', () => {
  const start = new THREE.Vector3(150, 0, 110);
  for (const npc of fixed.filter(npc => !onPlatform(npc))) {
    const { x, z } = npc.home, where = `${npc.fijo.stance} en ${x.toFixed(1)}, ${z.toFixed(1)}`;
    const route = nav.routeTo(nav.nearestPoint(start.x, start.z), npc.home);
    assert.ok(route.length > 1, `${where}: sin camino`);
    assert.deepEqual(route.at(-1).toArray(), npc.home.toArray());
    // Todos los tramos los deja andar su `isWalkable`, también el último, fuera de la red.
    const [last, before] = [route.at(-1), route.at(-2)];
    const steps = Math.ceil(last.distanceTo(before) / .1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      assert.ok(npc.isWalkable(before.x + (last.x - before.x) * t, before.z + (last.z - before.z) * t), `${where}: el último tramo se corta`);
    }
  }
  for (const npc of fixed.filter(onPlatform)) assert.equal(npc.navigation, null, 'en el andén vuelve en línea recta');
});

test('los caminantes arrancan en la red, con el reparto de su zona', () => {
  for (const npc of walkers) {
    const node = nav.nodes[nav.nodeAt(npc.position.x, npc.position.z)];
    assert.ok(node && !node.crossing, `caminante en ${npc.position.x}, ${npc.position.z}`);
  }
  assert.equal(city._zoneAt(40, 55), 'cartucho');
  assert.equal(city._zoneAt(108, 100), 'parque');
  assert.equal(city._zoneAt(294, 55), 'candelaria');
  assert.equal(city._zoneAt(300, 300), 'chapinero');
  assert.equal(city._zoneAt(60, 40), 'andenes');
  assert.equal(city._zoneAt(150, 300), 'barrio');
  const inCartucho = walkers.filter(npc => city._zoneAt(npc.home.x, npc.home.z) === 'cartucho');
  assert.ok(inCartucho.length >= 4);
});

test('un fijo de postura baja entra ya sentado: no se le ve sentándose al cargar la ciudad', () => {
  for (const npc of fixed.filter(npc => LOW_STANCES.has(npc.fijo.stance))) {
    assert.equal(npc.stance, npc.fijo.stance);
    assert.equal(npc.style, null, 'su forma de andar no le cambia la postura');
    assert.equal(npc.fijo.low, true);
  }
});

test('lo que ocupa sitio sin detener a nadie está anotado para quien cae, y no estorba al caminar', () => {
  const room = (x, z) => collisions.queryFallObstacles(x - .01, z - .01, x + .01, z + .01, []).filter(({ box }) => x > box.min.x && x < box.max.x && z > box.min.z && z < box.max.z);
  for (const bench of city.benchSpots) assert.ok(room(bench.x, bench.z).length, `banca en ${bench.x}, ${bench.z}`);
  for (const { position } of [...city.vendors, ...city.fireBarrels]) assert.ok(room(position.x, position.z).length, `puesto o caneca en ${position.x}, ${position.z}`);
  for (const tree of city.treePlan) assert.ok(room(tree.x, tree.z).length, `árbol en ${tree.x}, ${tree.z}`);
  for (const pole of city.signals.poles) assert.ok(room(pole.x, pole.z).length, `semáforo en ${pole.x}, ${pole.z}`);
  const all = [];
  for (const bucket of collisions._fallGrid.cells.values()) for (const entry of bucket) all.push(entry);
  const unique = [...new Set(all)], size = ({ box }) => box.max.x - box.min.x;
  assert.ok(unique.every(({ box }) => [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite) && box.max.y > box.min.y), 'cajas medidas');
  // Los objetos grandes se miden antes de fundirse con la geometría estática.
  const big = unique.filter(entry => size(entry) > 1.5 && size(entry) < 3.5 && entry.box.max.y - entry.box.min.y > 1);
  assert.ok(big.length >= 9, `${big.length} zorras y cambuches`);
  assert.ok(unique.filter(entry => Math.abs(size(entry) - .16) < .001 && Math.abs(entry.box.max.y - entry.box.min.y - .86) < .001).length >= 8, 'bolardos');
  // Quien huye sabe dónde hay agua.
  assert.ok(walkers.every(npc => typeof npc.getWaterInfo === 'function') && fixed.every(npc => typeof npc.getWaterInfo === 'function'), 'agua');
  // Nada de eso cuenta para caminar ni para la cámara.
  const bench = city.benchSpots[0];
  assert.equal(collisions.queryStatic(bench.x, bench.z, bench.x, bench.z, []).some(({ box }) => bench.y + .3 > box.min.y && bench.y + .3 < box.max.y && bench.x > box.min.x && bench.x < box.max.x && bench.z > box.min.z && bench.z < box.max.z), false);
});
