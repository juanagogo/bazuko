// Las cajas de colisión de los vehículos: tan ajustadas a la malla que se camina pegado a un carro o a una moto, y no se los atraviesa.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { MOTO_COLLIDERS, MOTO_SIZES } from '../src/world/bogota/motos.js';

const RADIUS = .4;

function vehicle({ yaw = 0, x = 0, z = 0, length = 4.34, width = 1.82, kind = 'carro', variant = null } = {}) {
  const group = new THREE.Group();
  group.rotation.y = yaw;
  const v = { group, position: new THREE.Vector3(x, 0, z), length, width, kind };
  if (variant !== null) Object.assign(v, { isMoto: true, kind: 'moto', length: MOTO_SIZES[variant].length, width: MOTO_SIZES[variant].width, collider: MOTO_COLLIDERS[variant] });
  group.position.copy(v.position);
  return v;
}

const world = (...vehicles) => { const collisions = new CollisionSystem(); collisions.setVehicles(vehicles); return collisions; };
/** Camina de a pasos desde `from` a lo largo de `delta` y devuelve dónde queda. */
function walk(collisions, from, delta, steps = 40) {
  const p = from.clone(), step = delta.clone().divideScalar(steps);
  for (let i = 0; i < steps; i++) collisions.resolveMove(p, step, RADIUS, p);
  return p;
}
/** Hacia dónde apunta el vehículo (el frente es +x local) y su costado, en el suelo. */
const axes = (yaw) => ({ front: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), side: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)) });

test('un carro girado cualquier ángulo deja pasar pegado a su costado y no se lo atraviesa de frente', () => {
  for (const yaw of [0, .1, .35, .7, Math.PI / 4, 1.2, Math.PI / 2, 2.5, -.6]) {
    const car = vehicle({ yaw, x: 20, z: 10 }), { front, side } = axes(yaw), c = car.position;
    const collisions = world(car);
    // por el costado a medio metro de la carrocería: libre de punta a punta
    const gap = car.width / 2 + RADIUS + .25;
    const start = c.clone().addScaledVector(side, gap).addScaledVector(front, -6), run = front.clone().multiplyScalar(12);
    const end = walk(collisions, start, run);
    assert.ok(end.distanceTo(start.clone().add(run)) < 1e-6, `yaw ${yaw}: el costado queda libre`);
    // de frente al centro: se frena en el parachoques
    const head = c.clone().addScaledVector(front, -6), through = walk(collisions, head, front.clone().multiplyScalar(12));
    assert.ok(through.clone().sub(c).dot(front) < -car.length / 2 + .05, `yaw ${yaw}: no atraviesa`);
  }
});

test('la caja del carro girado no bloquea a lo largo de sus esquinas vacías (antes quedaba cruzada)', () => {
  const car = vehicle({ yaw: .3, x: 0, z: 0 }), { front, side } = axes(.3);
  const collisions = world(car);
  const point = new THREE.Vector3().addScaledVector(side, 1.9).addScaledVector(front, 1.8);
  assert.deepEqual(collisions.resolveMove(point, new THREE.Vector3(.1, 0, 0), RADIUS), point.clone().add(new THREE.Vector3(.1, 0, 0)));
});

test('a una moto se le camina pegado al lado, por delante y por detrás, sin que bloquee estando lejos', () => {
  for (let variant = 0; variant < MOTO_COLLIDERS.length; variant++) {
    for (const yaw of [0, .4, Math.PI / 2, 2.2]) {
      const moto = vehicle({ variant, yaw, x: 30, z: -5 }), { front, side } = axes(yaw), box = MOTO_COLLIDERS[variant];
      const collisions = world(moto);
      const mid = moto.position.clone().addScaledVector(front, (box.x0 + box.x1) / 2);
      const gap = box.hw + RADIUS + .25;
      for (const s of [1, -1]) {
        const start = mid.clone().addScaledVector(side, s * gap).addScaledVector(front, -5), run = front.clone().multiplyScalar(10);
        assert.ok(walk(collisions, start, run).distanceTo(start.clone().add(run)) < 1e-6, `variante ${variant} yaw ${yaw}: libre a ${gap.toFixed(2)} m del eje`);
      }
      // tras la rueda y delante del manubrio ya no hay nada
      const behind = moto.position.clone().addScaledVector(front, box.x0 - RADIUS - .25), cross = side.clone().multiplyScalar(6);
      const start = behind.clone().addScaledVector(side, -3);
      assert.ok(walk(collisions, start, cross).distanceTo(start.clone().add(cross)) < 1e-6, 'se cruza por detrás de la moto');
      // de costado al centro de la moto: no se atraviesa
      const from = mid.clone().addScaledVector(side, -3), across = walk(collisions, from, side.clone().multiplyScalar(6));
      assert.ok(across.clone().sub(mid).dot(side) < -box.hw + .02, `variante ${variant} yaw ${yaw}: no atraviesa de lado`);
      const nose = moto.position.clone().addScaledVector(front, 4), tail = walk(collisions, nose, front.clone().multiplyScalar(-8));
      assert.ok(tail.clone().sub(moto.position).dot(front) > box.x1 - .02, 'de frente tampoco');
    }
  }
});

test('la caja de la moto mide lo que su malla: más corta que el dibujo y centrada en él, no en el eje', () => {
  for (let variant = 0; variant < MOTO_COLLIDERS.length; variant++) {
    const box = MOTO_COLLIDERS[variant], size = MOTO_SIZES[variant];
    assert.ok(box.x1 - box.x0 <= size.length + .3 && box.x1 - box.x0 >= 1.7, 'el largo de la malla');
    assert.ok(box.hw * 2 <= size.width && box.hw >= .3, 'más angosta que la moto con espejos');
    assert.ok(box.x0 < 0 && box.x1 > 0, 'el eje queda dentro');
  }
  const moto = vehicle({ variant: 3, x: 10, z: 10 });
  const collisions = world(moto), entry = collisions.dynamicColliders[0];
  assert.ok(entry.obb, 'la moto va con caja orientada aun alineada');
  assert.ok(Math.abs(entry.obb.center.x - (10 + (MOTO_COLLIDERS[3].x0 + MOTO_COLLIDERS[3].x1) / 2)) < 1e-9);
});
