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
