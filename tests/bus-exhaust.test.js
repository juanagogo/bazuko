// Pruebas del humo de las busetas viejas: quién humea, cuánto según cómo maneje y el presupuesto de partículas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BusExhaust, MAX_PARTICLES, PUFF_COUNT, exhaustRate, isOldBus } from '../src/systems/BusExhaust.js';

function sceneWithFog() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a222d, 50, 180);
  return scene;
}

function buseta(x = 0, z = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  return { car: { kind: 'buseta', group }, speed: 0, acceleration: 0 };
}

function other(kind, x = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, 0);
  return { car: { kind, group }, speed: 5, acceleration: 1.6 };
}

/** Cámara parada en (x, z) mirando en la dirección (dx, dz). */
function camera(x, z = 0, dx = 1, dz = 0) {
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(x, 2, z);
  cam.lookAt(x + dx * 10, 2, z + dz * 10);
  cam.updateMatrixWorld(true);
  return cam;
}

const run = (smoke, vehicles, cam, frames = 1, wind = null) => {
  for (let i = 0; i < frames; i++) smoke.update(.1, { vehicles, camera: cam, wind });
  return smoke.geometry.instanceCount;
};

test('una de cada tres busetas es vieja, siempre la misma', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(isOldBus), [true, false, false, true, false, false]);
});

test('solo humea la buseta vieja entre busetas', () => {
  const smoke = new BusExhaust(sceneWithFog());
  const buses = [buseta(0), buseta(40), buseta(80)];
  for (const bus of buses) { bus.speed = 5; bus.acceleration = 1.6; }
  run(smoke, buses, camera(-30), 20);
  const centers = smoke.centers.array;
  assert.ok(smoke.geometry.instanceCount > 0, 'la primera buseta debe humear');
  // La vieja es la primera: todo el humo nace junto a su escape, no junto a las otras dos.
  for (let i = 0; i < smoke.geometry.instanceCount; i++) assert.ok(centers[i * 3] < 20, `partícula ${i} ajena`);
  smoke.dispose();
});

test('carros y motos no humean', () => {
  const smoke = new BusExhaust(sceneWithFog());
  assert.equal(run(smoke, [other('carro', 0), other('moto', 20)], camera(-30), 30), 0);
  smoke.dispose();
});

test('la emisión crece de parejo a acelerar y a arrancar, y es cero detenido', () => {
  assert.equal(exhaustRate(0, 2), 0, 'detenida no humea aunque acelere');
  const cruising = exhaustRate(6, 0);
  const climbing = exhaustRate(5, 1);
  const pullingAway = exhaustRate(1, 1.6);
  assert.ok(cruising > 0, 'yendo parejo deja un hilo');
  assert.ok(climbing > cruising, 'subiendo humea más que parejo');
  assert.ok(pullingAway > climbing, 'arrancando es lo que más humea');
});

test('arrancar de un semáforo suelta una bocanada', () => {
  const smoke = new BusExhaust(sceneWithFog());
  const bus = buseta(0);
  const cam = camera(-30);
  assert.equal(run(smoke, [bus], cam, 10), 0, 'parada no humea');
  bus.speed = .5; bus.acceleration = 1.5;
  const puff = run(smoke, [bus], cam);
  assert.ok(puff >= PUFF_COUNT, `la bocanada debe soltar al menos ${PUFF_COUNT} partículas y soltó ${puff}`);
  // Con la misma aceleración sostenida ya no repite la bocanada.
  const steady = run(smoke, [bus], cam);
  assert.ok(steady < puff + PUFF_COUNT, 'la bocanada no se repite cuadro a cuadro');
  smoke.dispose();
});

test('una arrancada que sube de a poco suelta una sola bocanada', () => {
  const smoke = new BusExhaust(sceneWithFog());
  const bus = buseta(0);
  const cam = camera(-30);
  let count = 0;
  for (let frame = 0; frame < 6; frame++) {
    bus.speed = frame * .25; bus.acceleration = frame * .3;  // la aceleración real sube de a poco
    count = run(smoke, [bus], cam);
  }
  assert.ok(count >= PUFF_COUNT, `faltó la bocanada: ${count}`);
  assert.ok(count < PUFF_COUNT + 12, `se repitió la bocanada: ${count}`);
  smoke.dispose();
});

test('la nube nunca pasa del presupuesto y no reserva memoria de nuevo', () => {
  const smoke = new BusExhaust(sceneWithFog());
  const centers = smoke.centers.array, params = smoke.params.array;
  const buses = Array.from({ length: 90 }, (_, i) => buseta((i % 30) * 5 - 70, Math.floor(i / 30) * 12));
  for (const bus of buses) { bus.speed = 4; bus.acceleration = 1.6; }
  const cam = camera(-80);
  let topped = 0;
  for (let i = 0; i < 400; i++) {
    const count = run(smoke, buses, cam);
    assert.ok(count <= MAX_PARTICLES, `el dibujo pidió ${count} partículas`);
    if (count === MAX_PARTICLES) topped++;
  }
  assert.ok(topped > 0, 'la prueba debe llenar la nube');
  assert.equal(smoke.centers.array, centers, 'el arreglo de centros se reutiliza');
  assert.equal(smoke.params.array, params, 'el arreglo de parámetros se reutiliza');
  assert.equal(centers.length, MAX_PARTICLES * 3);
  assert.equal(params.length, MAX_PARTICLES * 2);
  smoke.dispose();
});

test('no gasta partículas en lo que no se ve', () => {
  // Sistema nuevo en cada caso: la primera buseta que ve un sistema es la vieja, así que siempre es la que humea.
  const alone = (cam, frames) => {
    const smoke = new BusExhaust(sceneWithFog());
    const bus = buseta(0);
    bus.speed = 6; bus.acceleration = 1.6;
    const count = run(smoke, [bus], cam, frames);
    smoke.dispose();
    return count;
  };
  assert.equal(alone(camera(220)), 0, 'más allá de la niebla no humea');
  assert.equal(alone(camera(30), 5), 0, 'detrás de la cámara no humea');
  const smoke = new BusExhaust(sceneWithFog());
  const bus = buseta(0);
  bus.speed = 6; bus.acceleration = 1.6;
  bus.car.group.visible = false;
  assert.equal(run(smoke, [bus], camera(-30), 20), 0, 'una buseta que no se dibuja no humea');
  bus.car.group.visible = true;
  assert.ok(run(smoke, [bus], camera(-30), 20) > 0, 'delante y cerca sí humea');
  smoke.dispose();
});

test('el humo sale por el escape, que va detrás, gire como gire la buseta', () => {
  const smoke = new BusExhaust(sceneWithFog());
  const bus = buseta(0);
  // Frente local +X girado para avanzar hacia +Z: la cola y el escape quedan en Z negativo.
  bus.car.group.rotation.y = Math.atan2(-1, 0);
  bus.speed = 6; bus.acceleration = 1.6;
  run(smoke, [bus], camera(0, -30, 0, 1), 20);
  const centers = smoke.centers.array;
  assert.ok(smoke.geometry.instanceCount > 0);
  for (let i = 0; i < smoke.geometry.instanceCount; i++) {
    assert.ok(centers[i * 3 + 2] < 0, `partícula ${i} delante de la buseta`);
    assert.ok(Math.abs(centers[i * 3] - .82) < 2, `partícula ${i} fuera del escape`);
  }
  smoke.dispose();
});

test('el viento inclina la columna', () => {
  const random = Math.random;
  Math.random = () => .5;
  try {
    const still = new BusExhaust(sceneWithFog()), windy = new BusExhaust(sceneWithFog());
    const a = buseta(0), b = buseta(0);
    a.speed = b.speed = 2; a.acceleration = b.acceleration = 1.6;
    const cam = camera(-30);
    run(still, [a], cam, 20, { x: 0, y: 0 });
    run(windy, [b], cam, 20, { x: 12, y: 0 });
    const sum = (smoke) => {
      const centers = smoke.centers.array;
      let total = 0;
      for (let i = 0; i < smoke.geometry.instanceCount; i++) total += centers[i * 3];
      return total;
    };
    assert.ok(sum(windy) > sum(still) + 1, 'el humo debe irse con el viento');
    still.dispose(); windy.dispose();
  } finally {
    Math.random = random;
  }
});
