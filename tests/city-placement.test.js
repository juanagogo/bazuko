import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { CHURCH_STEPS, FOUNTAIN, PLAZA, TOWERS, insideTower, towerColliderBoxes } from '../src/world/bogota/EastZones.js';
import { crossings } from '../src/world/bogota/StreetMarkings.js';
import { TrafficSignals } from '../src/world/bogota/TrafficSignals.js';

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

// Todo lo que pasa por _add, con el lugar que le dieron.
const placed = [], originalAdd = Bogota.prototype._add;
Bogota.prototype._add = function (object, x, z, ...rest) {
  placed.push({ x, z });
  return originalAdd.call(this, object, x, z, ...rest);
};
const city = new Bogota(), scene = new THREE.Scene(), collisions = new CollisionSystem();
city.build(scene, collisions);
Bogota.prototype._add = originalAdd;
after(() => city.dispose(scene));

const tileAt = (x, z) => city.map[Math.round(z / 2)]?.[Math.round(x / 2)];
const R = .4;

/** ¿Un cuerpo en ese punto queda metido en una caja estática? Misma regla de altura que el movimiento. */
function bodyInsideStatic(x, y, z, radius) {
  return collisions.queryStatic(x - radius, z - radius, x + radius, z + radius, []).some(({ box, layered }) => {
    if (layered && (y > box.max.y || y + 1.6 < box.min.y)) return false;
    return x > box.min.x - radius && x < box.max.x + radius && z > box.min.z - radius && z < box.max.z + radius;
  });
}

/** Camina en pasos cortos con el mismo resolveMove y la misma cota del jugador; devuelve dónde se detuvo. */
function walk(x0, z0, x1, z1) {
  const position = new THREE.Vector3(x0, city.getMovementGroundHeight(x0, z0, 0), z0), out = new THREE.Vector3();
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / .08);
  const delta = new THREE.Vector3((x1 - x0) / steps, 0, (z1 - z0) / steps);
  for (let i = 0; i < steps; i++) {
    collisions.resolveMove(position, delta, R, out);
    position.x = out.x; position.z = out.z;
    position.y = city.getMovementGroundHeight(position.x, position.z, position.y);
  }
  return position;
}

/** Alturas de todo lo dibujado en la vertical de un punto, con la geometría real de la ciudad. */
function drawnHeightsAt(x, z) {
  const heights = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), probe = new THREE.Vector3();
  city.group.updateMatrixWorld(true);
  city.group.traverse(mesh => {
    const position = mesh.isMesh && !mesh.isInstancedMesh ? mesh.geometry?.attributes?.position : null;
    if (!position) return;
    mesh.geometry.boundingBox || mesh.geometry.computeBoundingBox();
    probe.set(x, 0, z).applyMatrix4(mesh.matrixWorld.clone().invert());
    const { min, max } = mesh.geometry.boundingBox;
    if (probe.x < min.x - .01 || probe.x > max.x + .01 || probe.z < min.z - .01 || probe.z > max.z + .01) return;
    const index = mesh.geometry.index, count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
      const area = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(area) < 1e-9) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / area, v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / area;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) heights.push(u * a.y + v * b.y + (1 - u - v) * c.y);
    }
  });
  return heights;
}

test('ningún vendedor ni objeto de _add queda sobre la calzada, y los carriles no pasan por encima de un puesto', () => {
  assert.ok(placed.length > 50);
  // Sin excepciones: si algún objeto necesita ir en la calle, se justifica aquí, uno por uno.
  const exceptions = [];
  for (const { x, z } of placed) {
    if (exceptions.some(e => e.x === x && e.z === z)) continue;
    assert.ok(!['road', 'busway'].includes(tileAt(x, z)), `objeto en la calzada: ${x},${z}`);
  }
  const lanes = [], point = new THREE.Vector3(), direction = new THREE.Vector3();
  const routes = city.getTrafficRoutes();
  for (const route of [...routes, ...routes.alternatives]) {
    for (let d = 0; d < route.length; d += .5) { route.sample(d, point, direction); lanes.push([point.x, point.z]); }
  }
  // Media buseta y el margen de _personInCar: a esa distancia nadie frena por el vendedor.
  const clearance = 1.15 + .55;
  assert.ok(city.vendors.length >= 8);
  for (const { position, title } of city.vendors) {
    assert.ok(!['road', 'busway'].includes(tileAt(position.x, position.z)), `${title} en la calzada`);
    const person = city.npcs.find(npc => npc.position.distanceTo(new THREE.Vector3(position.x, npc.position.y, position.z)) < 1);
    assert.ok(person, `${title} sin quien atienda`);
    for (const [x, z] of lanes) {
      assert.ok(Math.hypot(x - person.position.x, z - person.position.z) > clearance, `${title} a un carril: ${x},${z}`);
    }
  }
});

test('al vendedor de la plaza se llega a pie y por GPS, sin chocar con fuente, bancas ni faroles', () => {
  const stall = city.vendors.find(vendor => vendor.title === 'Tinto de la plaza');
  assert.ok(stall);
  const { x, z } = stall.position;
  assert.equal(tileAt(x, z), 'plaza');
  assert.ok(z < PLAZA.z1 * 2 + 1, 'dentro de la plaza');
  assert.ok(Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) > FOUNTAIN.radius + 3);
  assert.ok(!bodyInsideStatic(x, .12, z, 1), 'el puesto no pisa ninguna caja');
  // Desde el centro de la plaza se llega hasta el mostrador; el puesto mira hacia allí.
  const front = walk(FOUNTAIN.x - 8, FOUNTAIN.z + 8, x, z - 1);
  assert.ok(Math.hypot(front.x - x, front.z - (z - 1)) < .05, `se detuvo en ${front.x},${front.z}`);
  const gps = city.createGpsNavigation();
  assert.equal(gps.setWaypoint({ x, z }, { x: 112.98, z: 97.84 }, 0), true);
  assert.ok(gps.routeLength > 100);
  const end = gps.route.at(-1);
  assert.ok(Math.hypot(end.x - x, end.z - z) < 4, 'la ruta termina junto al puesto');
});

test('la portada y las torres de la iglesia son sólidas y las gradas se pisan a su altura', () => {
  // Las torres salen .9 m de los tiles de la nave; el zócalo, otros 10 cm. El cuerpo se detiene antes.
  for (const z of [48, 55, 62]) {
    const stop = walk(310, z, 325, z);
    assert.ok(stop.x + R <= 318.01, `en Z ${z} el cuerpo llega a X ${stop.x + R}`);
    assert.ok(stop.x > 317.3, `en Z ${z} para demasiado lejos: ${stop.x}`);
  }
  const [low, high] = CHURCH_STEPS;
  assert.equal(city.getGroundHeight(314, 55), .12);
  assert.equal(city.getGroundHeight(315.5, 55), low.top);
  assert.equal(city.getGroundHeight(317.5, 55), high.top);
  assert.equal(city.getMovementGroundHeight(317.5, 55, .3), high.top);
  assert.equal(city.getPlayerGroundSurface(317.5, 55, {}).height, high.top);
  assert.equal(city.getPlayerGroundSurface(315.5, 55, {}).height, low.top);
  // Al costado del atrio sigue el piso de la plaza.
  assert.equal(city.getGroundHeight(317.5, 44), .12);
  assert.equal(walk(310, 55, 325, 55).y, high.top);
});

test('el muro de las torres curvas detiene el cuerpo, sin paredes invisibles de un tile', () => {
  // Todo punto del muro detiene el cuerpo.
  let walls = 0;
  for (const { cx, cz, radius } of TOWERS) {
    for (let x = cx - radius; x <= cx + radius; x += .5) for (let z = cz - radius; z <= cz + radius; z += .5) {
      if (!TOWERS.some(tower => insideTower(tower, x, z))) continue;
      walls++;
      assert.ok(bodyInsideStatic(x, .12, z, R), `se puede pisar el muro en ${x},${z}`);
    }
  }
  assert.ok(walls > 100);
  // Las cajas siguen la planta: cada esquina queda a menos de 65 cm de un punto del muro, lejos de los 1,4 m de un tile.
  const wallWithin = (tower, x, z, distance) => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) for (const k of [0, .25, .5, .75, 1]) {
      if (insideTower(tower, x + Math.cos(a) * distance * k, z + Math.sin(a) * distance * k)) return true;
    }
    return false;
  };
  for (const tower of TOWERS) for (const { x, z, w, d } of towerColliderBoxes(tower)) {
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      assert.ok(wallWithin(tower, x + dx * w / 2, z + dz * d / 2, .65), `caja que sobra en ${x},${z}`);
    }
  }
  // Y ya no hay cajas de tile sobre sus tiles: esas iban por filas de 2 m de fondo, las nuevas son tiras de medio metro.
  for (const { box } of collisions.colliders) {
    if (box.max.x - box.min.x < 2 || box.max.z - box.min.z !== 2) continue;
    const z = (box.min.z + box.max.z) / 2;
    for (let x = box.min.x + 1; x < box.max.x; x += 2) {
      if (tileAt(x, z) !== 'building') continue; // el muro del borde sigue entero, aunque la torre llegue hasta él
      assert.ok(!TOWERS.some(tower => insideTower(tower, x, z)), `caja de tile en ${x},${z}`);
    }
  }
  // El cuerpo se detiene donde se dibuja el muro, no en la esquina del tile.
  const stop = walk(368, 311, 380, 311);
  assert.ok(stop.x + R <= 374.2 && stop.x + R > 373.5, `para en X ${stop.x}`);
  assert.equal(city.getGroundHeight(374.2, 311), .12);
});

test('la fuente frena a un cuerpo antes de su borde redondo, y rodearla pegado no lo traba', () => {
  const center = new THREE.Vector2(FOUNTAIN.x, FOUNTAIN.z), rim = FOUNTAIN.radius + .55;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    const from = [FOUNTAIN.x + Math.cos(a) * 9, FOUNTAIN.z + Math.sin(a) * 9];
    const stop = walk(...from, FOUNTAIN.x + Math.cos(a) * 2, FOUNTAIN.z + Math.sin(a) * 2);
    const distance = center.distanceTo(new THREE.Vector2(stop.x, stop.z));
    // Se detiene en cuanto toca o resbala por la caja: el centro del cuerpo no entra al escalón de la base.
    assert.ok(distance >= rim, `dentro del borde: ${distance.toFixed(2)} en ${a.toFixed(2)} rad`);
  }
  // Una sola caja: el cuerpo resbala por sus caras. Varias cruzadas forman esquinas cóncavas donde camina en el sitio.
  const position = new THREE.Vector3(FOUNTAIN.x + 8, .12, FOUNTAIN.z), delta = new THREE.Vector3(), out = new THREE.Vector3();
  const seconds = 40, step = 1 / 60, speed = 3, inward = 30 * Math.PI / 180;
  let stuck = 0, turned = 0, angle = 0;
  for (let i = 0; i < seconds / step; i++) {
    const heading = Math.atan2(position.z - FOUNTAIN.z, position.x - FOUNTAIN.x) + Math.PI / 2 + inward;
    collisions.resolveMove(position, delta.set(Math.cos(heading) * speed * step, 0, Math.sin(heading) * speed * step), R, out);
    if (out.distanceTo(position) < speed * step * .15) stuck += step;
    position.copy(out);
    const next = Math.atan2(position.z - FOUNTAIN.z, position.x - FOUNTAIN.x);
    turned += Math.atan2(Math.sin(next - angle), Math.cos(next - angle));
    angle = next;
  }
  assert.ok(stuck < 1, `caminó en el sitio ${stuck.toFixed(1)} s`);
  assert.ok(turned / (Math.PI * 2) > 2, `dio ${(turned / (Math.PI * 2)).toFixed(2)} vueltas`);
});

test('el carril del bus queda libre hasta la lámina del cierre, y las barreras siguen deteniendo al peatón', () => {
  const lane = walk(75, 310, 75, 325);
  assert.ok(Math.abs(lane.z - (319 - R)) < .1, `se detuvo en Z ${lane.z}`);
  const street = walk(19, 10, 19, -2);
  assert.ok(Math.abs(street.z - (3.4 + R)) < .1, `las barreras no lo detienen: Z ${street.z}`);
  // Lo que ahora se pisa tiene suelo dibujado a la altura de los pies, de orilla a orilla del carril.
  for (const x of [68.5, 75, 81.5]) for (const z of [317.2, 317.8, 318.2, 318.6, 318.95]) {
    const y = city.getMovementGroundHeight(x, z, 0), top = drawnHeightsAt(x, z).filter(height => height < 1.5);
    assert.ok(top.some(height => Math.abs(height - y) < .06), `sin suelo en ${x},${z}: pies en ${y}, dibujado ${top.join(' ')}`);
  }
});

test('junto a los estribos del puente del lago y bajo su rampa hay suelo donde se apoyan los pies', () => {
  for (const x of [67.2, 67.5, 75, 82.5, 82.9]) for (const z of [294, 300, 306, 312, 316, 317.2, 318.5]) {
    const feet = city.getMovementGroundHeight(x, z, 0);
    assert.ok(drawnHeightsAt(x, z).some(height => Math.abs(height - feet) < .06), `sin suelo en X ${x} Z ${z}, pies a ${feet}`);
  }
});

test('entre ese suelo y lo que tiene alrededor, más alto, no queda rendija: un rayo rasante choca con algo', () => {
  const ray = new THREE.Raycaster(), origin = new THREE.Vector3(), target = new THREE.Vector3();
  city.group.updateMatrixWorld(true);
  const hits = (fromX, fromZ, toX, toZ) => {
    origin.set(fromX, .05, fromZ);
    ray.set(origin, target.set(toX, .01, toZ).sub(origin).normalize());
    ray.far = 4;
    const found = [];
    city.group.traverse(mesh => { if (mesh.isMesh && !mesh.isInstancedMesh) mesh.raycast(ray, found); });
    return found.length;
  };
  for (const [x, grassX] of [[67.6, 66], [82.4, 84]]) for (const z of [296, 306, 316]) assert.ok(hits(x, z, grassX, z), `por X ${x} Z ${z} se ve el cielo`);
  // Al norte lo que queda más alto es el terreno del lago.
  for (const x of [67.5, 75, 82.5]) assert.ok(hits(x, 295, x, 292), `al norte de X ${x} se ve el cielo`);
});

test('quien está junto a un poste del separador de la terminal tiene ruta, y esos tiles se pueden marcar', () => {
  const gps = city.createGpsNavigation();
  for (const [x, z] of [[70, -46], [70.4, -45.3], [80, -30], [70, -14], [80, -14], [70, -30]]) {
    assert.equal(gps.setWaypoint({ x: 290, z: 60 }, { x, z }, 0), true, `sin ruta desde ${x},${z}`);
    gps.clear();
    assert.equal(gps.setWaypoint({ x, z }, { x: 112.98, z: 97.84 }, 0), true, `sin ruta hacia ${x},${z}`);
    gps.clear();
  }
});

function crossingRamps() {
  const ramps = [];
  const tile = tileAt, RAISED = new Set(['sidewalk', 'plaza', 'floor']), ROADS = new Set(['road', 'busway']);
  const ramp = (x, z, dx, dz) => { if (RAISED.has(tile(x - dx, z - dz)) && ROADS.has(tile(x + dx, z + dz))) ramps.push({ x, z, dx, dz }); };
  for (const { x0, x1, z0, z1 } of crossings()) {
    for (const z of [z0 - 2, z1 + 2]) { ramp(x0, z, 1, 0); ramp(x1, z, -1, 0); }
    for (const x of [x0 - 2, x1 + 2]) { ramp(x, z0, 0, 1); ramp(x, z1, 0, -1); }
  }
  return ramps;
}

test('ningún poste de la calle queda sobre la rampa de una cebra', () => {
  const ramps = crossingRamps();
  assert.ok(ramps.length > 100);
  assert.ok(city.streetPoles.length > 200);
  for (const pole of city.streetPoles) for (const { x, z, dx, dz } of ramps) {
    const along = (pole.x - x) * dz + (pole.z - z) * dx, into = (pole.x - x) * dx + (pole.z - z) * dz;
    assert.ok(Math.abs(along) >= 1.1 || into <= -1.2 || into >= .6, `poste ${pole.x},${pole.z} sobre la rampa ${x},${z}`);
  }
});

test('nada del mobiliario de la calle asoma sobre la rampa de una cebra', () => {
  const near = new Map(), point = new THREE.Vector3();
  for (const ramp of crossingRamps()) {
    const key = `${Math.round(ramp.x / 4)},${Math.round(ramp.z / 4)}`;
    near.set(key, [...near.get(key) ?? [], ramp]);
  }
  city.group.updateMatrixWorld(true);
  city.group.traverse(mesh => {
    if (!mesh.isMesh || mesh.name !== 'Calle') return;
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (point.y < .3 || point.y > 2) continue;
      const cx = Math.round(point.x / 4), cz = Math.round(point.z / 4);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const { x, z, dx, dz } of near.get(`${cx + a},${cz + b}`) ?? []) {
        const along = (point.x - x) * dz + (point.z - z) * dx, into = (point.x - x) * dx + (point.z - z) * dz;
        assert.ok(Math.abs(along) >= .95 || into <= -1.2 || into >= .6, `objeto en ${point.x.toFixed(2)}, ${point.z.toFixed(2)}, ${point.y.toFixed(2)} m, sobre la rampa ${x},${z}`);
      }
    }
  });
});

test('la rejilla de aparición no deja puntos donde un cuerpo no cabe', () => {
  const grid = city.getSpawnGrid();
  assert.ok(grid.length > 1000);
  for (const { x, z } of grid) assert.ok(!bodyInsideStatic(x, city.getGroundHeight(x, z), z, R), `punto ${x}, ${z}`);
});

test('el carril X 66 hacia el norte tiene un semáforo a la vista, fuera de la calzada y de la torre', () => {
  const signals = new TrafficSignals();
  const own = signals.poles.filter(pole => pole.laneSignal);
  assert.equal(own.length, 1);
  const [pole] = own;
  assert.equal(pole.hz, -1);
  assert.equal(pole.axis, 1);
  assert.equal(pole.onRoadway, false);
  assert.ok(!['road', 'busway'].includes(tileAt(pole.x, pole.z)), `tile ${tileAt(pole.x, pole.z)}`);
  assert.ok(!bodyInsideStatic(pole.x, 0, pole.z, .1), 'no sale de un edificio');
  // Del punto de parada del carril al poste: menos de 20 m, con el cruce de por medio.
  const stopLine = { x: 66, z: 156 };
  assert.ok(Math.hypot(pole.x - stopLine.x, pole.z - stopLine.z) < 20);
});
