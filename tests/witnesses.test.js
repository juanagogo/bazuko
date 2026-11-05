import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { WitnessSystem, WITNESS } from '../src/systems/WitnessSystem.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

let toasts;
beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
  toasts = [];
  window.addEventListener('toast', (e) => toasts.push(e.detail.text));
});

// Un peatón de prueba con la misma interfaz de testigo que Npc.
function persona(x, z) {
  return {
    position: new THREE.Vector3(x, 0, z), stance: 'caminar', fleeTimer: 0, hp: 100, dichos: [],
    _witness: null,
    witness(mode, seconds) { this._witness = { mode, time: seconds }; this._witnessFinished = false; return true; },
    stopWitness() { this._witness = null; },
    get witnessing() { return this._witness?.mode ?? null; },
    tick(dt) {
      if (!this._witness) return;
      if (this.fleeTimer > 0) { this._witness = null; return; }
      if ((this._witness.time -= dt) <= 0) { this._witness = null; this._witnessFinished = true; }
    },
    _fleeFrom() { this.fleeTimer = 8; this._witness = null; },
    say(t) { this.dichos.push(t); },
  };
}

function juego(npcs, { collisions = null } = {}) {
  const dispatched = [];
  return {
    dispatched,
    player: { position: new THREE.Vector3(0, 0, 0) },
    world: { active: { npcs } },
    collisions,
    steal: { buscado: 1, _calma: 50 },
    traffic: { wantedLevel: 1, dispatchTo: (p) => { dispatched.push(p.clone()); return true; } },
  };
}

function correr(sys, npcs, segundos) {
  for (let t = 0; t < segundos; t += .1) { for (const n of npcs) n.tick(.1); sys.update(.1); }
}

test('quien ve el robo llama, otro graba y el resto huye gritando', () => {
  const npcs = [persona(3, 0), persona(5, 0), persona(7, 0), persona(40, 0)];
  const game = juego(npcs);
  const sys = new WitnessSystem(game, { random: () => 0 });
  assert.equal(sys.report('robo'), 3, 'el de 40 m no alcanza a ver');
  assert.equal(npcs[0].witnessing, 'llamar');
  assert.equal(npcs[1].witnessing, 'grabar');
  assert.ok(npcs[2].fleeTimer > 0);
  assert.equal(npcs[3].fleeTimer, 0);
  assert.ok(npcs[2].dichos.length === 1);
  sys.dispose();
});

test('la llamada que termina sube el fichado y manda una patrulla al sitio', () => {
  const npcs = [persona(8, 0)];
  const game = juego(npcs);
  const sys = new WitnessSystem(game, { random: () => 0 });
  sys.report('robo');
  game.player.position.set(12, 0, 0); // se aleja sin ir por quien llama
  correr(sys, npcs, WITNESS.callSeconds + .5);
  assert.equal(game.steal.buscado, 2);
  assert.equal(game.traffic.wantedLevel, 2);
  assert.equal(game.dispatched.length, 1);
  assert.equal(game.dispatched[0].x, 0, 'la patrulla va adonde fue el robo');
  assert.ok(toasts.includes('Un testigo llamó a la Policía'));
  sys.dispose();
});

test('llegar hasta quien llama le hace colgar: no sube el fichado', () => {
  const npcs = [persona(8, 0)];
  const game = juego(npcs);
  const sys = new WitnessSystem(game, { random: () => 0 });
  sys.report('robo');
  correr(sys, npcs, 1);
  game.player.position.set(7, 0, 0);
  correr(sys, npcs, WITNESS.callSeconds);
  assert.equal(game.steal.buscado, 1);
  assert.equal(game.dispatched.length, 0);
  assert.ok(npcs[0].fleeTimer > 0);
  assert.ok(toasts.includes('Le hice colgar'));
  sys.dispose();
});

test('un muro tapa la vista: nadie del otro lado es testigo', () => {
  const collisions = new CollisionSystem();
  collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(2, 0, -20), new THREE.Vector3(2.4, 4, 20)) });
  const npcs = [persona(5, 0)];
  const sys = new WitnessSystem(juego(npcs, { collisions }), { random: () => 0 });
  assert.equal(sys.report('pelea'), 0);
  assert.equal(npcs[0].witnessing, null);
  sys.dispose();
});

test('una pelea a golpes no arma una escena nueva en cada puño', () => {
  const npcs = [persona(3, 0), persona(4, 0), persona(5, 0)];
  const sys = new WitnessSystem(juego(npcs), { random: () => .99 });
  window.dispatchEvent(new CustomEvent('street-fight', { detail: {} }));
  window.dispatchEvent(new CustomEvent('street-fight', { detail: {} }));
  assert.equal(npcs.filter((n) => n.dichos.length).length, 1, 'un solo grito por escena');
  sys.dispose();
});

test('el video terminado deja el fichado sin bajar', () => {
  const npcs = [persona(5, 0)];
  const game = juego(npcs);
  const sys = new WitnessSystem(game);
  npcs[0].witness('grabar', WITNESS.filmSeconds);
  sys.films.push({ npc: npcs[0] });
  correr(sys, npcs, WITNESS.filmSeconds + .5);
  assert.equal(game.steal._calma, 0);
  sys.dispose();
});
