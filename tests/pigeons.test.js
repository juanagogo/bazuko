import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { PigeonFlock } from '../src/entities/PigeonFlock.js';

function fixture(count = 10) {
  let seed = 847;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const scene = new THREE.Scene(), bounds = { x0: -10, x1: 10, z0: -10, z1: 10 };
  const flock = new PigeonFlock(scene, bounds, { count, random, groundHeight: () => .06 });
  return { scene, flock };
}

test('diez palomas comparten cinco lotes de dibujo y material, sin luces ni física', () => {
  const { flock } = fixture();
  assert.equal(flock.birds.length, 10); assert.equal(flock.group.children.length, 5);
  assert.ok(flock.meshes.every(mesh => mesh.isInstancedMesh && mesh.count === 10));
  assert.equal(new Set(flock.meshes.map(mesh => mesh.material)).size, 1);
  flock.group.traverse(node => { assert.equal(!!node.isLight, false); });
  for (const bird of flock.birds) { assert.equal(bird.position.y, .06); assert.equal(bird.state, 'idle'); }
  flock.dispose();
});

test('el cuello baja el pico por instancia y la siguiente paloma conserva la pose erguida', () => {
  const { flock } = fixture(2);
  flock.birds[0].phase = (Math.PI / 2 + .75) / .52;
  flock.birds[1].phase = (Math.PI * 1.5 + .75) / .52;
  flock._paint();
  const [body] = flock.meshes;
  const { position, pigeonDip, pigeonDippedPosition } = body.geometry.attributes;
  assert.ok(pigeonDip.getX(0) > .99);
  assert.equal(pigeonDip.getX(1), 0);
  let bill = 0;
  for (let i = 1; i < position.count; i++) if (position.getZ(i) > position.getZ(bill)) bill = i;
  const dipped = pigeonDippedPosition.getY(bill);
  assert.ok(position.getY(bill) > .35 && dipped > 0 && dipped < .08);
  assert.ok(body.castShadow && body.receiveShadow);
  assert.equal(body.morphTexture, null);
  for (const [material, base] of [[body.material, THREE.ShaderLib.standard], [body.customDepthMaterial, THREE.ShaderLib.depth]]) {
    const shader = { ...base, uniforms: {} };
    material.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /transformed = mix\(transformed, pigeonDippedPosition, pigeonDip\);/);
  }
  flock.dispose();
});

test('modelar las aves conserva las 80 tiradas globales de una bandada', () => {
  const real = Math.random;
  let draws = 0, result;
  // La escena se crea fuera del contador de la bandada.
  const scene = new THREE.Scene();
  Math.random = () => { draws++; return real(); };
  try { result = new PigeonFlock(scene, { x0: 0, x1: 10, z0: 0, z1: 10 }, { random: () => .42 }); }
  finally { Math.random = real; }
  assert.equal(draws, 80);
  result.dispose();
});

test('caminan sin salir del parque y descansan cuando el jugador no las asusta', () => {
  const { flock } = fixture(), before = flock.birds.map(bird => bird.position.clone());
  const observer = new THREE.Vector3(25, 0, 25);
  let walking = false;
  for (let i = 0; i < 600; i++) {
    flock.update(1 / 30, observer);
    for (const bird of flock.birds) {
      assert.ok(flock._inside(bird.position.x, bird.position.z));
      assert.ok(Math.abs(bird.position.y - .06) < 1e-9);
      walking ||= bird.state === 'walking';
    }
  }
  assert.ok(walking); assert.ok(flock.birds.some((bird, i) => bird.position.distanceTo(before[i]) > .5));
  flock.dispose();
});

test('la pila aparta sólo los puntos que caen dentro de su huella, con las mismas tiradas', () => {
  const bounds = { x0: -8, x1: 8, z0: -8, z1: 8 }, groundHeight = () => .12;
  const samples = [.5, .5, .3, .4, .2, .6, .8, .6, .2, .2, .8, .6];
  const create = groundCutout => {
    let draws = 0;
    const flock = new PigeonFlock(new THREE.Scene(), bounds, {
      count: 2, random: () => samples[draws++], groundHeight, groundCutout,
    });
    return { flock, draws };
  };
  const base = create(null), withFountain = create({ x: 0, z: 0, radius: 2 });
  assert.equal(base.draws, withFountain.draws);
  assert.deepEqual(base.flock.birds[0].position.toArray(), [0, .12, 0]);
  assert.deepEqual(withFountain.flock.birds[0].position.toArray(), [2.015, .12, 0]);
  assert.deepEqual(base.flock.birds[1].position, withFountain.flock.birds[1].position);
  assert.ok(withFountain.flock._inside(2.01, 0));
  assert.ok(!withFountain.flock._inside(1.99, 0));
  base.flock.dispose(); withFountain.flock.dispose();
});

test('las palomas cruzan sobre la pila en vuelo y se detienen en el borde al caminar', () => {
  const samples = [.1875, .5, .3, .4, .2, .6, .5, .5, .3, .4];
  const flock = new PigeonFlock(new THREE.Scene(), { x0: -8, x1: 8, z0: -8, z1: 8 }, {
    count: 1, random: () => samples.shift() ?? .5, groundHeight: () => .12,
    groundCutout: { x: 0, z: 0, radius: 2 },
  });
  const [bird] = flock.birds, observer = new THREE.Vector3(-15, 0, 0);
  flock._takeOff(bird, new THREE.Vector3(-10, 0, 0));
  assert.ok(bird.target.x > 2, 'un destino dentro de la pila termina en el pavimento');
  let crossed = false;
  for (let frame = 0; frame < 150 && bird.state === 'flying'; frame++) {
    flock.update(1 / 30, observer);
    if (Math.abs(bird.position.x) < 2) {
      assert.ok(bird.position.y > .12);
      crossed = true;
    }
  }
  assert.ok(crossed);
  assert.equal(bird.state, 'idle');
  assert.ok(bird.position.distanceTo(bird.target) < 1e-9);
  bird.state = 'walking';
  bird.position.set(-2.1, .12, 0);
  bird.target.set(4, .12, 0);
  for (let i = 0; i < 15; i++) {
    flock.update(1 / 30, observer);
    assert.ok(bird.position.x <= -2);
  }
  assert.equal(bird.state, 'idle');
  flock.dispose();
});

test('la proximidad provoca despegue, aleteo y aterrizaje en un punto alejado', () => {
  const { flock } = fixture(1), bird = flock.birds[0], player = bird.position.clone();
  const matrix = new THREE.Matrix4();
  flock.meshes[1].getMatrixAt(0, matrix); const before = matrix.clone();
  for (let i = 0; i < 15; i++) flock.update(1 / 30, player);
  assert.equal(bird.state, 'flying'); assert.ok(bird.position.y > .06);
  flock.meshes[1].getMatrixAt(0, matrix); assert.notDeepEqual(matrix.elements, before.elements);
  assert.ok(bird.target.distanceTo(player) > 8);
  for (let i = 0; i < 600; i++) flock.update(1 / 30, new THREE.Vector3(25, 0, 25));
  assert.notEqual(bird.state, 'flying'); assert.equal(bird.position.y, .06);
  assert.ok(flock._inside(bird.position.x, bird.position.z));
  flock.dispose();
});

test('el vuelo mantiene coordenadas válidas bajo persecución prolongada y se suspende lejos', () => {
  const { flock } = fixture(3);
  for (let i = 0; i < 3000; i++) {
    const chase = flock.birds[0].position.clone(); flock.update(1 / 30, chase);
    for (const bird of flock.birds) {
      assert.ok(Number.isFinite(bird.position.length()));
      assert.ok(flock._inside(bird.position.x, bird.position.z));
      assert.ok(bird.position.y >= .059 && bird.position.y < 5);
    }
  }
  const positions = flock.birds.map(bird => bird.position.toArray());
  for (let i = 0; i < 30; i++) flock.update(.1, new THREE.Vector3(500, 0, 500));
  assert.equal(flock.group.visible, false);
  assert.deepEqual(flock.birds.map(bird => bird.position.toArray()), positions);
  flock.dispose();
});

test('descartar una bandada libera cada recurso compartido una sola vez', () => {
  const { scene, flock } = fixture(); let geometries = 0, materials = 0;
  for (const geometry of new Set(flock.meshes.map(mesh => mesh.geometry))) geometry.addEventListener('dispose', () => geometries++);
  flock.meshes[0].material.addEventListener('dispose', () => materials++);
  flock.dispose(); flock.dispose();
  assert.equal(scene.children.length, 0); assert.equal(geometries, 4); assert.equal(materials, 1);
});

test('un NPC cercano también provoca vuelo alejándose de él aunque el jugador esté lejos', () => {
  const { flock } = fixture(1), bird = flock.birds[0];
  const npc = { position: bird.position.clone() }, player = new THREE.Vector3(25, 0, 25);
  for (let i = 0; i < 15; i++) flock.update(1 / 30, player, [npc]);
  assert.equal(bird.state, 'flying'); assert.ok(bird.position.y > .06);
  assert.ok(bird.target.distanceTo(npc.position) > 8);
  assert.deepEqual(bird.threat, npc.position);
  flock.dispose();
});

test('descarta NPC lejanos y detecta a quienes entran al parque sin revisar toda la ciudad por ave', () => {
  const { flock } = fixture(1), bird = flock.birds[0], player = new THREE.Vector3(25, 0, 25);
  const npcs = Array.from({ length: 72 }, () => ({ position: new THREE.Vector3(100, 0, 100) }));
  flock.update(.1, player, npcs);
  assert.equal(flock._people.length, 0); assert.notEqual(bird.state, 'flying');
  npcs[0].position.copy(bird.position);
  for (let i = 0; i < 5; i++) flock.update(.1, player, npcs);
  assert.equal(flock._people.length, 1); assert.equal(bird.state, 'flying');
  flock.dispose();
});

test('una paloma pegada a la cámara no se dibuja: tan cerca, se vería como una mole', () => {
  const { flock } = fixture(3);
  const bird = flock.birds[0], far = new THREE.Vector3(40, 0, 40), camera = new THREE.PerspectiveCamera();
  const paintedAt = (offset, cam = camera) => {
    camera.position.copy(bird.position).add(offset);
    flock.update(.016, far, [], cam);
    const matrix = new THREE.Matrix4();
    flock.meshes[0].getMatrixAt(0, matrix);
    return Math.hypot(...matrix.elements.slice(0, 3)) > .01;
  };
  assert.equal(paintedAt(new THREE.Vector3(0, 3, 0)), true);
  assert.equal(paintedAt(new THREE.Vector3(.5, .6, 0)), false, 'a menos de 1,2 m se oculta');
  assert.equal(paintedAt(new THREE.Vector3(1.5, .6, 0)), true);
  // Sin cámara se pinta como siempre, y volar cerca no cambia nada más: la paloma sigue su camino.
  assert.equal(paintedAt(new THREE.Vector3(.1, .1, 0), null), true);
  flock.dispose();
});

test('quien está sentado o dormido en su sitio no espanta a las palomas; si se levanta y anda, sí', () => {
  const { flock } = fixture(1);
  const bird = flock.birds[0], far = new THREE.Vector3(40, 0, 40);
  const person = { position: bird.position.clone(), fijo: { out: false } };
  for (let i = 0; i < 20; i++) {
    person.position.copy(bird.position);
    flock.update(.05, far, [person]);
    assert.ok(bird.state === 'idle' || bird.state === 'walking', bird.state);
  }
  person.fijo.out = true;
  for (let i = 0; i < 6; i++) flock.update(.05, far, [person]);
  assert.ok(bird.state === 'startled' || bird.state === 'flying', bird.state);
  flock.dispose();
});
