import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Bogota } from '../src/world/districts/Bogota.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { buildD69Store } from '../src/world/bogota/D69Store.js';

test('D69 reserva la fachada señalada y conserva el andén y la avenida', () => {
  const city = new Bogota(); city.map = city._layout();
  assert.equal(city.map[81][26], 'storeD69');
  assert.equal(city.map[81][27], 'sidewalk');
  assert.equal(city.map[81][29], 'road');
  const collisions = new CollisionSystem(); city._buildCollisions(city.map, collisions);
  assert.ok(collisions.colliders.some(({ box }) => box.containsPoint(new THREE.Vector3(52, 1, 162))));
  assert.ok(!collisions.colliders.some(({ box }) => box.containsPoint(new THREE.Vector3(54, 1, 162))));
});

test('los avisos del mercado miran a ambos andenes y el edificio no invade la calle', () => {
  const signs = [];
  const model = buildD69Store({ createSign: options => { signs.push(options); return new THREE.Texture(); } });
  assert.equal(signs.length, 2);
  assert.ok(signs.every(o => o.title === 'DOÑA INÉS'));
  const bounds = new THREE.Box3().setFromObject(model);
  assert.ok(bounds.max.x < 53.4);
  assert.ok(bounds.min.z > 158.5);
  assert.ok(bounds.max.y < 5.2);
});

test('en el paño superior se ven envases a distintas profundidades y espacio hasta el fondo', () => {
  const store = buildD69Store({ createSign: () => new THREE.Texture() });
  store.updateMatrixWorld(true);
  const opaque = store.getObjectByName('Edificio D69'), glazing = store.getObjectByName('Vidrio oriental de Doña Inés');
  const origin = new THREE.Vector3(), intoTheStore = new THREE.Vector3(-1, 0, 0);
  const ray = new THREE.Raycaster(origin, intoTheStore, 0, 4);
  const merchandiseDepths = new Set();
  let gaps = 0;
  for (let i = 0; i < 10; i++) {
    ray.set(origin.set(55, 2.255, 165.55 + .29 * i), intoTheStore);
    const [glass] = ray.intersectObject(glazing), [stock] = ray.intersectObject(opaque);
    const depth = glass.point.x - stock.point.x;
    assert.ok(depth > .16 && depth < .74, `profundidad ${depth.toFixed(3)} m`);
    if (depth > .6) gaps++;
    else merchandiseDepths.add(Math.round(depth * 100));
  }
  assert.ok(merchandiseDepths.size >= 4);
  assert.ok(gaps >= 2);

  ray.set(origin.set(55, .825, 161.03), intoTheStore);
  const [door] = ray.intersectObject(glazing), [cashier] = ray.intersectObject(opaque);
  assert.ok(door.point.x - cashier.point.x > .26 && door.point.x - cashier.point.x < .4);
  ray.set(origin.set(55, .825, 162.71), intoTheStore);
  const [back] = ray.intersectObject(opaque);
  assert.ok(door.point.x - back.point.x > .7);
});

test('las jambas de la puerta y la vitrina empatan el marco con el muro sin caras superpuestas', () => {
  const store = buildD69Store({ createSign: () => new THREE.Texture() });
  const { attributes: { position }, index } = store.getObjectByName('Edificio D69').geometry;
  for (const center of [161.8, 166.9]) for (const side of [-1, 1]) {
    const plane = center + side * 2.95 / 2, spans = new Map();
    for (let i = 0; i < index.count; i += 3) {
      const triangle = index.array.subarray(i, i + 3);
      if (!triangle.every(j => Math.abs(position.getZ(j) - plane) < 2e-5 &&
        position.getX(j) > 51.915 && position.getX(j) < 52.64 && position.getY(j) > .15 && position.getY(j) < 3.056)) continue;
      const x = Array.from(triangle, j => position.getX(j));
      const lo = Math.min(...x), hi = Math.max(...x);
      spans.set(lo, hi);
    }
    assert.equal(spans.size, 2);
    const [lining, frame] = [...spans].sort(([a], [b]) => a - b);
    assert.ok(Math.abs(lining[1] - frame[0]) < 1e-5);
  }
});

test('las canastas tienen huecos y las veinte ruedas tocan el piso del nicho', () => {
  const store = buildD69Store({ createSign: () => new THREE.Texture() });
  store.updateMatrixWorld(true);
  const opaque = store.getObjectByName('Edificio D69');
  const origin = new THREE.Vector3(), throughCart = new THREE.Vector3(-1, 0, 0);
  const ray = new THREE.Raycaster(origin, throughCart, 0, .74);
  let openings = 0, wires = 0;
  // Por dentro de la baranda exterior. El barrido toma el lateral y el extremo libre de la fila.
  for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
    ray.set(origin.set(52.82, .65 + row * .03, 171 + col * .061), throughCart);
    if (ray.intersectObject(opaque).length) wires++;
    else openings++;
  }
  assert.ok(openings >= 55 && wires >= 20, `${openings} huecos y ${wires} alambres`);

  const { position, color } = opaque.geometry.attributes;
  const contacts = [];
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(color.getW(i) - .12) < 1e-5 && Math.abs(position.getY(i) - .16) < 1e-5) {
      contacts.push([position.getX(i), position.getZ(i)]);
    }
  }
  for (let cart = 0; cart < 5; cart++) for (const side of [-1, 1]) {
    const z = 171.3 - cart * .44;
    for (const [axle, offset] of [[.122, -.27], [.214, .272]]) {
      const x = 52.36 + side * axle;
      assert.ok(contacts.some(([px, pz]) => Math.abs(px - x) < .03 && Math.abs(pz - (z + offset)) < .018),
        `rueda de carrito ${cart} en ${x}, ${z + offset}`);
    }
  }
});
