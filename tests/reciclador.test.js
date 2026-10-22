import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { RECICLADORES, INSULTOS_RECICLADOR } from '../src/data/zorra.js';

// Los recicladores son NPC reales; solo se sustituye la carga de modelos GLB.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { Reciclador } = await import('../src/entities/Reciclador.js');

beforeEach(() => { globalThis.window = new EventTarget(); });

const bolsa = (x, z, used = false) => ({ used, position: new THREE.Vector3(x, 0, z) });

function reciclador(opts = {}) {
  const navigation = new PedestrianNavigation([Array(12).fill('sidewalk')], 2);
  return new Reciclador(new THREE.Scene(), new THREE.Vector3(0, 0, 0), {
    navigation,
    groundHeight: navigation.groundHeight,
    isWalkable: (x, z) => navigation.isWalkableAt(x, z),
    canecas: () => [],
    jugadorTieneZorra: () => false,
    alRobar: () => {},
    alForcejear: () => {},
    crearModelo: () => new THREE.Group(),
    random: () => 0.5,
    ...opts
  });
}

test('el reciclador va a la bolsa libre más cercana y cambia de meta si la usan', () => {
  const libre = bolsa(10, 0), usada = bolsa(4, 0, true);
  const r = reciclador({ canecas: () => [usada, libre] });
  r._walk(RECICLADORES.intervaloCaneca[1]);
  assert.equal(r.caneca, libre);
  libre.used = true;
  r._walk(0.1);
  assert.notEqual(r.caneca, libre);
});

test('una zorra descuidada se puede robar y el reciclador insulta al volver', () => {
  let robos = 0, toast = null;
  window.addEventListener('toast', (e) => { toast = e.detail.text; });
  const r = reciclador({ random: () => 0.01, alRobar: () => robos++ });
  r._llegarACaneca();
  assert.equal(r.zorra.interactable, true);
  assert.equal(r.interactable, false);
  r.zorra.interactuar();
  assert.equal(robos, 1);
  r.estado.avanzar(RECICLADORES.duracionDescuido);
  r._volverAZorra();
  assert.ok(INSULTOS_RECICLADOR.includes(toast));
});

test('si el jugador ya tiene zorra no puede robarla ni forcejear', () => {
  let forcejeos = 0;
  const r = reciclador({ jugadorTieneZorra: () => true, alForcejear: () => forcejeos++ });
  r.interactuar();
  assert.equal(forcejeos, 0);
  assert.equal(r.prompt, 'Ya tienes zorra');
});

test('tras el robo, el reciclador sin zorra visita bolsas sin descuidar ni insultar', () => {
  const toasts = [];
  window.addEventListener('toast', (e) => toasts.push(e.detail.text));
  const r = reciclador({ random: () => 0.01 });
  r._llegarACaneca();
  r.zorra.interactuar();
  r.estado.avanzar(RECICLADORES.duracionDescuido);
  r._volverAZorra();
  toasts.length = 0;
  r._llegarACaneca();
  assert.equal(r.estado.zorraDescuidada, false);
  for (let t = 0; t < RECICLADORES.duracionDescuido + 1; t += 0.1) r._walk(0.1);
  assert.deepEqual(toasts, []);
  assert.equal(r.zorra, null);
  assert.equal(r.interactable, false);
});
