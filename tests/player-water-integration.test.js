import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';

const city = new Bogota(); city.map = city._layout();
const collisions = new CollisionSystem(); city._buildCollisions(city.map, collisions);
function fixture(x, y, z, energy = 100) {
  const input = { axis: { x: 0, z: 0 }, isRunning: false, jump: false,
    consumePress(code) { if (code !== 'Space' || !this.jump) return false; this.jump = false; return true; } };
  const player = new Player(new THREE.Scene(), input, { energia: energy, dinero: 0 });
  player.position.set(x, y, z); player.root.position.copy(player.position);
  const tick = (dt = 1 / 60) => player.update(dt, null, collisions,
    (px, pz, context) => city.getPlayerGroundSurface(px, pz, context), [],
    (px, pz) => city.getWaterInfo(px, pz));
  return { player, input, tick };
}

for (const dt of [1 / 60, .1]) {
  test(`caminar de la orilla al lago y regresar conserva apoyo y flotación, dt=${dt}`, () => {
    const { player, input, tick } = fixture(22, city.getGroundHeight(22, 262), 262);
    input.axis.x = 1;
    let sawWading = false, sawSwimming = false;
    for (let t = 0; t < 13; t += dt) {
      tick(dt);
      sawWading ||= player.inWater && !player.isSwimming;
      sawSwimming ||= player.isSwimming;
      if (player.isSwimming) assert.ok(player.position.y > -2, 'flota cerca de superficie, no camina por el fondo');
    }
    assert.ok(sawWading && sawSwimming);
    assert.ok(player.position.x > 40);
    input.axis.x = -1;
    for (let t = 0; t < 15; t += dt) tick(dt);
    assert.ok(player.position.x < 25, 'puede alcanzar tierra usando WASD');
    assert.equal(player.inWater, false);
    assert.equal(player.isSwimming, false);
    assert.equal(player.isGrounded, true);
    assert.ok(Math.abs(player.position.y - city.getGroundHeight(player.position.x, player.position.z)) < 1e-6);
    player.dispose();
  });
}

test('caer desde altura al lago termina flotando y no aterriza en su fondo', () => {
  const { player, tick } = fixture(45, 7.82, 262);
  player.isGrounded = false;
  let minimum = Infinity;
  for (let i = 0; i < 240; i++) { tick(); minimum = Math.min(minimum, player.position.y); }
  assert.equal(player.isSwimming, true);
  assert.equal(player.isGrounded, false);
  assert.ok(minimum > -2, `mínimo ${minimum}`);
  assert.ok(Math.abs(player.position.y - (city.getWaterInfo(45, 262).surfaceY - 1.05)) < .01);
  assert.equal(player.state, 'tread');
  player.dispose();
});

test('el tablero y sus saltos conservan prioridad sobre el agua inferior', () => {
  const x = 78.5, z = 262, height = viaductSurface(x, z);
  assert.ok(height > 7);
  const { player, input, tick } = fixture(x, height, z);
  tick(); input.jump = true;
  for (let i = 0; i < 120; i++) {
    tick(); assert.equal(player.isSwimming, false); assert.equal(player.inWater, false);
  }
  assert.equal(player.isGrounded, true);
  assert.equal(player.groundSurface.layer, 'viaduct');
  assert.ok(Math.abs(player.position.y - height) < 1e-6);
  player.dispose();
});

test('el nadador agotado se mueve y resetGrounding limpia el estado al recuperar', () => {
  const water = city.getWaterInfo(45, 262);
  const { player, input, tick } = fixture(45, water.surfaceY - 1.05, 262, 0);
  input.isRunning = true; input.axis.z = 1;
  for (let i = 0; i < 90; i++) tick();
  assert.equal(player.isSwimming, true);
  assert.ok(player.position.z > 263);
  assert.equal(player.stats.energia, 0);
  assert.equal(player.punch(), false, 'no usa golpes terrestres al nadar');
  player.resetGrounding();
  assert.equal(player.waterMovement.state, 'dry');
  assert.equal(player.inWater, false);
  assert.equal(player.isSwimming, false);
  player.dispose();
});

test('la animación recibe vuelo y aterrizaje reales en vez de un temporizador fijo', () => {
  const { player, input, tick } = fixture(112.98, city.getGroundHeight(112.98, 97.84), 97.84);
  const states = [];
  player.character.update = (_dt, args) => states.push({ ...args, movement: { ...args.movement } });
  input.axis.x = 1; input.isRunning = true; input.jump = true;
  for (let i = 0; i < 70; i++) tick();
  assert.ok(states.some(state => state.action === 'saltar' && state.speed > 1 && state.movement.verticalVelocity > 0));
  assert.ok(states.some(state => state.action === 'saltar' && state.movement.verticalVelocity < 0));
  assert.ok(states.some(state => state.movement.landing === 1 && state.movement.grounded));
  player.dispose();
});
