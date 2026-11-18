// tests/hallucinations.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { RandomHallucinationSystem } from '../src/systems/RandomHallucinationSystem.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

test('RandomHallucinationSystem inicializa temporizador y estado inactivo', () => {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(10, 0, 10), paranoia: 0 };
  const stats = { animo: 100, hambre: 100, isFreezing: false };
  const system = new RandomHallucinationSystem(scene, player, stats, null, null);

  assert.equal(system.active, false);
  assert.equal(system.current, null);
  assert.ok(system.timer > 0);

  system.dispose();
});

test('Alucinación de sombra: crea figura espectral que se desvanece al acercarse', () => {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(0, 0, 0), paranoia: 0 };
  const system = new RandomHallucinationSystem(scene, player, {}, null, null);

  system.trigger('sombra');
  assert.equal(system.active, true);
  assert.equal(system.current.type, 'sombra');
  assert.ok(system.current.group);
  assert.equal(scene.children.includes(system.current.group), true);

  // Acercar al jugador a menos de 4 metros
  player.position.copy(system.current.group.position);
  system.update(0.1, player, null, null, {});
  assert.equal(system.current.dissolving, true, 'la sombra se disuelve al aproximarse');

  // Dejar que termine de disolverse
  for (let i = 0; i < 20; i++) {
    system.update(0.1, player, null, null, {});
  }
  assert.equal(system.active, false);
  assert.equal(system.current, null);

  system.dispose();
});

test('Alucinación de voces: activa susurros y paranoia momentánea', () => {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(0, 0, 0), paranoia: 0 };
  let whisperPlayed = false;
  const audio = { playPsychosisWhisper() { whisperPlayed = true; } };

  let toastReceived = null;
  window.addEventListener('toast', (e) => { toastReceived = e.detail; });

  const system = new RandomHallucinationSystem(scene, player, {}, audio, null);
  system.trigger('voces');

  assert.equal(whisperPlayed, true);
  assert.ok(toastReceived);
  assert.ok(player.paranoia > 0, 'eleva la paranoia del personaje');

  system.dispose();
});

test('Alucinación de espejismo: genera objeto tentador que desaparece al llegar', () => {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(0, 0, 0), root: new THREE.Group() };
  const system = new RandomHallucinationSystem(scene, player, {}, null, null);

  system.trigger('espejismo');
  assert.equal(system.active, true);
  assert.equal(system.current.type, 'espejismo');
  assert.ok(system.current.group);

  // El jugador corre hacia el espejismo
  player.position.copy(system.current.group.position);
  system.update(0.1, player, null, null, {});

  assert.equal(system.active, false, 'se esfuma al alcanzar la posición');
  assert.equal(system.current, null);

  system.dispose();
});

test('Alucinación de vértigo: modula el fov de la cámara suavemente y lo restaura', () => {
  const scene = new THREE.Scene();
  const cameraRig = {
    camera: new THREE.PerspectiveCamera(55, 1, 0.1, 100),
    baseFov: 55
  };
  const system = new RandomHallucinationSystem(scene, null, {}, null, null);

  system.trigger('vertigo');
  assert.equal(system.active, true);

  system.update(1.0, null, cameraRig, null, {});
  assert.notEqual(cameraRig.camera.fov, 55, 'el fov oscila levemente durante el vértigo');

  // Al finalizar la duración
  system.update(3.0, null, cameraRig, null, {});
  assert.equal(cameraRig.camera.fov, 55, 'el fov regresa al baseFov al concluir');
  assert.equal(system.active, false);

  system.dispose();
});

test('Temporizador automático de alucinaciones aleatorias', () => {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(0, 0, 0), paranoia: 0 };
  const system = new RandomHallucinationSystem(scene, player, { animo: 20 }, null, null);

  system.timer = 0.1;
  system.update(0.15, player, null, { isNight: true }, { animo: 20 });

  assert.equal(system.active, true, 'se dispara una alucinación cuando expira el temporizador');
  assert.ok(system.timer > 0, 'se programa el siguiente temporizador');

  system.dispose();
});
