import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';

// HitLean se carga dentro de cada prueba: así las del Player fallan por lo que hace el cuerpo, no por un import.
const hitLean = () => import('../src/character/HitLean.js');

beforeEach(() => { globalThis.window = new EventTarget(); });

function player() {
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: () => false, isDown: () => false };
  const p = new Player(new THREE.Scene(), input, { dinero: 0, energia: 100, salud: 100 }, {});
  p.position.set(0, 0, 0); p.root.rotation.y = 0;
  return p;
}

/**
 * Hacia dónde se va la cabeza en el mundo: el eje vertical del cuerpo, tal como se dibuja.
 * x = cuánto se va hacia su frente y z = cuánto hacia su derecha (rad, ≈ ángulo), con el rumbo `yaw`;
 * `world` es el mismo desplazamiento en el mundo (x, z).
 */
function headLean(p, yaw = p.root.rotation.y) {
  p.root.updateMatrixWorld(true);
  const e = p.character.group.matrixWorld.elements, up = new THREE.Vector3(e[4], e[5], e[6]).normalize();
  return {
    x: up.x * Math.sin(yaw) + up.z * Math.cos(yaw),
    z: -(up.x * Math.cos(yaw) - up.z * Math.sin(yaw)),
    world: { x: up.x, z: up.z }
  };
}

/** Golpe del conductor bravo (fuerza 2,2) que no tumba, y la inclinación cuadro a cuadro durante `seconds`. */
function hit(push, { yaw = 0, fps = 60, seconds = 2, strength = 2.2, salud = 90 } = {}) {
  const p = player();
  p.root.rotation.y = yaw;
  p.receiveHit(new THREE.Vector3(push.x, 0, push.z), strength, { salud });
  const frames = [];
  for (let i = 1; i <= Math.round(seconds * fps); i++) {
    p.update(1 / fps, null, null, () => 0);
    frames.push({ t: i / fps, ...headLean(p, yaw) });
  }
  const minZ = Math.min(...frames.map(f => f.z)), maxZ = Math.max(...frames.map(f => f.z));
  const minX = Math.min(...frames.map(f => f.x)), maxX = Math.max(...frames.map(f => f.x));
  const tilted = frames.filter(f => Math.abs(f.x) > .0035 || Math.abs(f.z) > .0035); // más de 0,2°
  return { p, frames, minZ, maxZ, minX, maxX, settle: tilted.length ? tilted.at(-1).t : 0 };
}

test('el golpe que no tumba inclina hacia el lado del empujón, no siempre hacia el mismo', () => {
  // Mirando a +Z, su izquierda es +X: empujado hacia allá, la cabeza va a +X (rotation.z negativa).
  const left = hit({ x: 1, z: 0 });
  assert.ok(left.minZ < -.1, `hacia su izquierda: ${left.minZ.toFixed(3)} rad`);
  assert.ok(left.maxZ < .02, `sin irse al otro lado: ${left.maxZ.toFixed(3)} rad`);
  const right = hit({ x: -1, z: 0 });
  assert.ok(right.maxZ > .1, `hacia su derecha: ${right.maxZ.toFixed(3)} rad`);
  assert.ok(right.minZ > -.02, `sin irse al otro lado: ${right.minZ.toFixed(3)} rad`);
});

test('de frente lo dobla hacia atrás y por detrás hacia adelante', () => {
  const front = hit({ x: 0, z: -1 });
  assert.ok(front.minX < -.1 && front.maxX < .03, `de frente: ${front.minX.toFixed(3)} rad`);
  const back = hit({ x: 0, z: 1 });
  assert.ok(back.maxX > .1 && back.minX > -.03, `por detrás: ${back.maxX.toFixed(3)} rad`);
});

test('con cualquier rumbo y desde cualquier lado, la cabeza se va hacia donde lo empujan', () => {
  // Semilla fija: los cuatro lados y las diagonales con ocho rumbos, más 200 pares al azar.
  let seed = 20261115;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cases = [];
  for (let k = 0; k < 8; k++) for (let j = 0; j < 8; j++) cases.push([k * Math.PI / 4, j * Math.PI / 4]);
  for (let i = 0; i < 200; i++) cases.push([random() * Math.PI * 2 - Math.PI, random() * Math.PI * 2]);
  const worst = { cos: 1 };
  for (const [yaw, angle] of cases) {
    const push = { x: Math.cos(angle), z: Math.sin(angle) };
    const { frames } = hit(push, { yaw, seconds: .4 });
    const peak = frames.reduce((a, f) => (Math.hypot(f.world.x, f.world.z) > Math.hypot(a.world.x, a.world.z) ? f : a));
    const size = Math.hypot(peak.world.x, peak.world.z);
    const cos = size > 0 ? (peak.world.x * push.x + peak.world.z * push.z) / size : -1;
    if (cos < worst.cos) Object.assign(worst, { cos, yaw, angle, size });
  }
  assert.ok(worst.cos > .95, `peor caso: coseno ${worst.cos.toFixed(3)} con rumbo ${(worst.yaw * 180 / Math.PI).toFixed(0)}° y empujón a ${(worst.angle * 180 / Math.PI).toFixed(0)}°`);
});

test('cede poco a poco, sin pasar de unos 10° ni ladearse de un cuadro a otro', () => {
  const { frames, minZ } = hit({ x: 1, z: 0 });
  assert.ok(Math.abs(frames[0].z) < .05, `primer cuadro: ${frames[0].z.toFixed(3)} rad`);
  assert.ok(minZ > -.18, `pico ${minZ.toFixed(3)} rad`);
  for (let i = 1; i < frames.length; i++) assert.ok(Math.abs(frames[i].z - frames[i - 1].z) < .04, `salto en ${frames[i].t.toFixed(3)} s`);
});

test('vuelve a derecho en menos de un segundo y sin dejar el cuerpo torcido', () => {
  for (const push of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }, { x: .6, z: -.8 }]) {
    const { p, settle } = hit(push);
    assert.ok(settle > .3 && settle < 1, `vuelve a los ${settle.toFixed(2)} s`);
    assert.equal(p.root.rotation.z, 0);
    assert.equal(p.root.rotation.x, 0);
    assert.deepEqual(p.character.group.rotation.toArray(), [0, 0, 0, 'XYZ']);
    assert.equal(p.hitLean.active, false);
  }
});

test('la inclinación y lo que tarda en volver son los mismos a 30, 60 y 144 imágenes por segundo', () => {
  const runs = [30, 60, 144].map(fps => ({ fps, ...hit({ x: 1, z: 0 }, { fps }) }));
  const peaks = runs.map(r => Math.max(-r.minZ, r.maxZ));
  assert.ok(Math.max(...peaks) - Math.min(...peaks) < .002, `picos ${peaks.map(v => v.toFixed(4)).join(', ')} rad`);
  const settles = runs.map(r => r.settle);
  assert.ok(Math.max(...settles) - Math.min(...settles) <= 1 / 30 + 1e-9, `vuelve a los ${settles.join(', ')} s`);
});

test('quitar y volver a sumar cada cuadro no acumula la inclinación', async () => {
  const { HitLean } = await hitLean();
  const lean = new HitLean(), body = new THREE.Object3D();
  body.rotation.set(.07, .4, -.05);
  lean.kick({ x: .3, z: 1 }, .4, 1);
  for (let i = 0; i < 120; i++) { lean.remove(body); assert.deepEqual(body.rotation.toArray(), [.07, .4, -.05, 'XYZ']); lean.update(1 / 60); lean.apply(body); }
  assert.equal(lean.active, false);
  lean.remove(body);
  assert.deepEqual(body.rotation.toArray(), [.07, .4, -.05, 'XYZ']);
});

test('nunca pasa del tope, ni con el golpe más fuerte', async () => {
  const { HitLean, HIT_LEAN } = await hitLean();
  const lean = new HitLean();
  for (let i = 0; i < 4; i++) lean.kick({ x: 1, z: 1 }, 0, 5);
  for (let i = 0; i < 120; i++) {
    lean.update(1 / 60);
    assert.ok(Math.abs(lean.pitch) <= HIT_LEAN.max && Math.abs(lean.roll) <= HIT_LEAN.max);
  }
});

test('el carro sigue acostándolo de lado y corta el tambaleo de un golpe anterior', () => {
  for (const ragdoll of [true, false]) {
    // El atropello interrumpe el empujón anterior incluso con la salud baja.
    const p = player();
    if (!ragdoll) p.ragdoll.start = () => false; // sin caída articulada, el ladeo de siempre
    p.receiveHit(new THREE.Vector3(0, 0, 1), 2.2, { salud: 90 });
    for (let i = 0; i < 6; i++) p.update(1 / 60, null, null, () => 0);
    assert.ok(headLean(p).x > .05);
    p.stats.salud = 30;
    p.receiveVehicleImpact(new THREE.Vector3(0, 0, 1), 8);
    assert.equal(p.ragdoll.active, ragdoll);
    assert.equal(p.hitLean.active, false);
    assert.equal(p.hitLean.applied, false);
    assert.deepEqual(p.character.group.rotation.toArray(), [0, 0, 0, 'XYZ']);
    if (ragdoll) continue;
    // Igual, cuadro a cuadro, que uno al que solo le llegó el carro.
    const twin = player();
    twin.ragdoll.start = () => false;
    twin.receiveVehicleImpact(new THREE.Vector3(0, 0, 1), 8);
    for (let i = 0; i < 30; i++) {
      p.update(1 / 60, null, null, () => 0); twin.update(1 / 60, null, null, () => 0);
      assert.ok(p.root.rotation.z > .3 * (1 - i / 60));
      assert.equal(p.root.rotation.z, twin.root.rotation.z);
      assert.equal(p.root.rotation.x, twin.root.rotation.x);
      assert.deepEqual(p.character.group.quaternion.toArray(), twin.character.group.quaternion.toArray());
    }
  }
  const car = player();
  car.ragdoll.start = () => false;
  car.receiveVehicleImpact(new THREE.Vector3(1, 0, 0), 4);
  car.update(1 / 60, null, null, () => 0);
  assert.ok(car.root.rotation.z > .6);
  assert.equal(car.root.rotation.x, 0);
  // Un golpe leve encima del atropello no le suma inclinación.
  car.receiveHit(new THREE.Vector3(0, 0, 1), 2.2, { salud: 90 });
  assert.equal(car.hitLean.active, false);
});

test('sin golpe, nada se activa y el cuerpo queda igual', () => {
  const p = player();
  p.input.axis = { x: 1, z: 0 };
  for (let i = 0; i < 60; i++) p.update(1 / 60, null, null, () => 0);
  assert.equal(p.hitLean.active, false);
  assert.equal(p.hitLean.applied, false);
  assert.deepEqual(p.character.group.rotation.toArray(), [0, 0, 0, 'XYZ']);
});

test('un empujón infinito o sin número se ignora y no deja el cuerpo roto', async () => {
  const { HitLean } = await hitLean();
  for (const push of [{ x: Infinity, z: 0 }, { x: NaN, z: 1 }, { x: 1, z: -Infinity }]) {
    const lean = new HitLean(), body = new THREE.Object3D();
    lean.kick(push, 0, 1);
    lean.kick({ x: 1, z: 0 }, 0, Infinity);
    assert.equal(lean.active, false);
    lean.update(1 / 60); lean.apply(body);
    assert.deepEqual(body.rotation.toArray(), [0, 0, 0, 'XYZ']);
  }
});

test('al cambiar de cuerpo en pleno golpe, el que sale queda derecho', async () => {
  // El cuerpo realista tarda en cargar; mientras tanto llega un golpe y se inclina el sencillo.
  const p = player(), simple = p.procedural;
  let loaded;
  p._realisticPromise = new Promise((resolve) => { loaded = resolve; });
  const realistic = { group: new THREE.Group(), update() {}, setWeapon() {}, setSmoking() {}, setBasuco() {}, clearSleepPose() {}, sleepWeight: 0 };
  const swap = p.setModel('realista');
  p.receiveHit(new THREE.Vector3(1, 0, 0), 2.2, { salud: 90 });
  for (let i = 0; i < 6; i++) p.update(1 / 60, null, null, () => 0);
  assert.ok(Math.abs(simple.group.rotation.z) > .05, 'el sencillo está inclinado al cambiar');
  loaded(realistic); await swap;
  assert.deepEqual(simple.group.rotation.toArray(), [0, 0, 0, 'XYZ']);
  for (let i = 0; i < 120; i++) p.update(1 / 60, null, null, () => 0);
  assert.deepEqual(simple.group.rotation.toArray(), [0, 0, 0, 'XYZ']);
  assert.deepEqual(realistic.group.rotation.toArray(), [0, 0, 0, 'XYZ']);
  await p.setModel('procedural');
  assert.deepEqual(p.character.group.rotation.toArray(), [0, 0, 0, 'XYZ']);
});
