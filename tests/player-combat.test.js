import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Input } from '../src/core/Input.js';
import { Player } from '../src/entities/Player.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { PUNCH } from '../src/data/combat.js';
import { hasMeleeLine } from '../src/systems/MeleeCombat.js';
import { Game } from '../src/core/game.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { busPathX } from '../src/world/bogota/Colpatria.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function fixture() {
  const input = new Input();
  const audio = { swings: 0, hits: 0, playWhoosh() { this.swings++; }, playPunchHit() { this.hits++; } };
  const player = new Player(new THREE.Scene(), input, { salud: 100, dinero: 0, higiene: 100 }, audio);
  player.position.set(0, 0, 0); player.root.position.copy(player.position); player.root.rotation.y = 0;
  return { player, audio, input,
    key(code, type = 'keydown') { window.dispatchEvent(Object.assign(new Event(type), { code })); },
    step(dt, npcs = [], collisions = null) { player.update(dt, null, collisions, null, npcs); input.endFrame(); }
  };
}

const target = (x = 0, y = 0, z = 1) => ({ position: new THREE.Vector3(x, y, z), hits: 0,
  takePunch() { this.hits++; return 300; } });

test('el puñetazo prepara el brazo antes del impacto y conecta una sola vez por pulsación', () => {
  const f = fixture(), npc = target();
  f.key('KeyG'); f.step(.05, [npc]);
  assert.equal(f.player.action, 'golpear');
  assert.equal(f.audio.swings, 1);
  assert.equal(npc.hits, 0);
  f.step(PUNCH.impactTime - .01, [npc]);
  assert.equal(npc.hits, 0);
  f.step(.02, [npc]);
  assert.equal(npc.hits, 1);
  assert.equal(f.audio.hits, 1);
  assert.equal(f.player.stats.dinero, 300);
  for (let i = 0; i < 15; i++) f.step(.05, [npc]);
  assert.equal(f.player.action, null);
  assert.equal(npc.hits, 1, 'Mantener la tecla no repite golpes');
  f.key('KeyG', 'keyup'); f.key('KeyG'); f.step(.05, [npc]); f.step(.23, [npc]);
  assert.equal(npc.hits, 2, 'Una pulsación nueva permite golpear tras recuperarse');
  f.player.dispose();
});

test('el impacto alcanza solo al peatón más cercano al frente y en la misma altura', () => {
  const f = fixture(), far = target(0, 0, 1.7), near = target(0, 0, 1), behind = target(0, 0, -.7), elevated = target(0, 7.82, .5);
  const npcs = [far, behind, elevated, near];
  f.player.punch(npcs); f.step(PUNCH.impactTime, npcs);
  assert.deepEqual(npcs.map(npc => npc.hits), [0, 0, 0, 1]);
  f.player.dispose();
});

test('el golpe falla si el peatón sale del alcance durante la preparación', () => {
  const f = fixture(), npc = target();
  f.player.punch([npc]); npc.position.z = 3; f.step(.23, [npc]);
  assert.equal(npc.hits, 0);
  assert.equal(f.audio.hits, 0);
  f.player.dispose();
});

test('un muro entre el jugador y el peatón impide conectar el golpe', () => {
  const f = fixture(), npc = target(), collisions = new CollisionSystem();
  const wall = new THREE.Object3D(); wall.position.set(0, 0, .5);
  collisions.add(wall, new THREE.Vector3(3, 3, .15));
  f.player.punch([npc]); f.step(.23, [npc], collisions);
  assert.equal(npc.hits, 0);
  f.player.dispose();
});

test('el golpe diagonal no rodea una esquina y respeta las cajas orientadas de los buses', () => {
  const f = fixture(), npc = target(1, 0, 1), collisions = new CollisionSystem();
  const wall = new THREE.Object3D(); wall.position.set(.5, 0, .5);
  collisions.add(wall, new THREE.Vector3(.3, 3, .3));
  f.player.root.rotation.y = Math.PI / 4;
  f.player.punch([npc]); f.step(.23, [npc], collisions);
  assert.equal(npc.hits, 0);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const obb = { center: new THREE.Vector3(0, 1.5, 0), halfSize: new THREE.Vector3(.2, 1.5, 2),
    quaternion, inverse: quaternion.clone().invert() };
  const bus = { dynamicColliders: [{ obb, box: new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 3, 2)) }] };
  assert.equal(hasMeleeLine(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), bus), false);
  assert.equal(hasMeleeLine(new THREE.Vector3(1.5, 0, -1.8), new THREE.Vector3(1.8, 0, -1.5), bus), true,
    'Una esquina vacía de la envolvente no bloquea el golpe');
  f.player.dispose();
});

test('recibir un golpe cancela el ataque pendiente y muestra reacción sin atravesar paredes', () => {
  const f = fixture(), npc = target(), collisions = new CollisionSystem();
  const wall = new THREE.Object3D(); wall.position.set(0, 0, -.5);
  collisions.add(wall, new THREE.Vector3(3, 3, .1));
  f.player.punch([npc]);
  assert.equal(f.player.receivePunch(npc, 6), true);
  assert.equal(f.player.stats.salud, 94);
  assert.equal(f.player.action, 'recibirGolpe');
  assert.equal(f.player.receivePunch(npc, 6), false, 'No acumula impactos en el mismo instante');
  for (let i = 0; i < 10; i++) f.step(.05, [npc], collisions);
  assert.equal(npc.hits, 0);
  assert.ok(f.player.position.z >= -.051, 'El retroceso conserva la colisión del jugador');
  assert.equal(f.player.action, null);
  f.player.dispose();
});

test('los golpes lejanos o desde otro nivel no dañan al jugador y recuperar limpia el ataque', () => {
  const f = fixture(), npc = target();
  assert.equal(f.player.receivePunch(target(0, 0, 4)), false);
  assert.equal(f.player.receivePunch(target(0, 7.82, 1)), false);
  assert.equal(f.player.stats.salud, 100);
  f.player.punch([npc]); f.player.clearVehicleImpact(); f.step(.3, [npc]);
  assert.equal(npc.hits, 0);
  f.player.dispose();
});

test('recibir un golpe bajo el viaducto conserva la calle inferior durante toda la reacción', () => {
  const f = fixture(), city = new Bogota(); city.map = city._layout();
  const x = busPathX(224, 75), z = 224;
  const lower = city.getMovementGroundHeight(x, z, .02);
  assert.ok(city.getGroundHeight(x, z) > lower + 5);
  f.player.position.set(x, lower, z);
  const game = { player: f.player, world: { active: city } };
  assert.equal(f.player.receivePunch({ position: new THREE.Vector3(x, lower, z - 1) }), true);
  for (let i = 0; i < 12; i++) {
    f.player.update(.05, null, null, (px, pz) => Game.prototype._playerGroundHeight.call(game, px, pz));
    assert.ok(Math.abs(f.player.position.y - lower) < 0.01, 'El retroceso no sube al jugador al tablero');
  }
  f.player.dispose();
});
