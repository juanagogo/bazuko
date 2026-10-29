import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { Player } from '../src/entities/Player.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { buildColpatriaViaduct, viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';

const city = new Bogota();
city.map = city._layout();
const collisions = new CollisionSystem();
city._buildCollisions(city.map, collisions);
const bridge = buildColpatriaViaduct(city.map);
for (const box of bridge.userData.colliders) collisions.colliders.push({ box, layered: true });

function fixture(x, y, z) {
  const input = {
    axis: { x: 0, z: 0 }, isRunning: false, jump: false,
    consumePress(key) {
      if (key !== 'Space' || !this.jump) return false;
      this.jump = false;
      return true;
    }
  };
  const player = new Player(new THREE.Scene(), input);
  player.position.set(x, y, z);
  player.root.position.copy(player.position);
  const game = Object.assign(Object.create(Game.prototype), {
    player, input, collisions, world: { active: city }, cameraRig: { camera: null }
  });
  return { player, input, tick: (dt = 1 / 60) => game._updatePlayerMovement(dt) };
}

test('el bucle de movimiento conserva el salto y aterriza en la calle', () => {
  const ground = city.getGroundHeight(112.98, 97.84);
  const { player, input, tick } = fixture(112.98, ground, 97.84);
  input.jump = true;
  let peak = ground;
  for (let frame = 0; frame < 90; frame++) {
    tick();
    peak = Math.max(peak, player.position.y);
    assert.equal(player.root.position.y, player.position.y);
  }
  assert.ok(peak > ground + .6, `altura máxima: ${peak}`);
  assert.equal(player.position.y, ground);
  assert.equal(player.isGrounded, true);
});

for (const dt of [1 / 60, .1]) {
  test(`se sube y baja la rampa norte sin caer a la calle, dt=${dt}`, () => {
    const { player, input, tick } = fixture(75, .02, 14.5);
    input.axis.z = 1;
    for (let time = 0; time < 13; time += dt) {
      const before = player.position.y;
      tick(dt);
      assert.ok(player.position.y >= before - .12);
      assert.equal(player.isGrounded, true);
    }
    assert.ok(player.position.z > 50);
    assert.ok(Math.abs(player.position.y - 7.82) < 1e-7);
    input.axis.z = -1;
    for (let time = 0; time < 14; time += dt) {
      tick(dt);
      assert.equal(player.isGrounded, true);
    }
    assert.ok(player.position.z < 15.43);
    assert.ok(player.position.y < .2);
    assert.equal(player.groundSurface.layer, 'ground');
  });
}

test('la rampa sur permite llegar desde el parque al tablero y regresar', () => {
  const { player, input, tick } = fixture(75, .02, 319);
  input.axis.z = -1;
  for (let frame = 0; frame < 950; frame++) {
    tick();
    assert.equal(player.isGrounded, true);
  }
  assert.ok(player.position.z < 280);
  assert.ok(Math.abs(player.position.y - 7.82) < 1e-7);
  input.axis.z = 1;
  for (let frame = 0; frame < 960; frame++) {
    tick();
    assert.equal(player.isGrounded, true);
  }
  assert.ok(player.position.z > 318);
  assert.ok(player.position.y < .2);
});

test('un salto sobre el viaducto vuelve a su tablero, también al avanzar por la rampa', () => {
  for (const [x, z, moving] of [[75, 50, false], [75, 25, true]]) {
    const ground = viaductSurface(x, z);
    const { player, input, tick } = fixture(x, ground, z);
    tick(); // Reconoce la capa antes de despegar.
    input.jump = true;
    input.axis.z = moving ? 1 : 0;
    let peakAboveDeck = 0;
    for (let frame = 0; frame < 90; frame++) {
      tick();
      peakAboveDeck = Math.max(peakAboveDeck, player.position.y - viaductSurface(player.position.x, player.position.z));
    }
    assert.ok(peakAboveDeck > .3);
    assert.equal(player.isGrounded, true);
    assert.equal(player.groundSurface.layer, 'viaduct');
    assert.ok(Math.abs(player.position.y - viaductSurface(player.position.x, player.position.z)) < 1e-7);
  }
});

test('saltar bajo el tablero o una rampa no cambia a la capa superior', () => {
  for (const z of [50, 18.5]) {
    const ground = city.getMovementGroundHeight(75, z, .02);
    const { player, input, tick } = fixture(75, ground, z);
    input.jump = true;
    for (let frame = 0; frame < 90; frame++) {
      tick();
      assert.equal(player.groundSurface.layer, 'ground');
    }
    assert.equal(player.isGrounded, true);
    assert.equal(player.position.y, ground);
  }
});

for (const [name, startZ, uphill] of [['norte', 25, 1], ['sur', 300, -1]]) {
  for (const direction of [uphill, -uphill]) {
    for (const dt of [1 / 60, .1]) {
      test(`saltar corriendo en rampa ${name}, ${direction === uphill ? 'subida' : 'bajada'}, dt=${dt}, vuelve al tablero`, () => {
        const { player, input, tick } = fixture(75, viaductSurface(75, startZ), startZ);
        tick(dt);
        input.axis.z = direction;
        input.isRunning = true;
        input.jump = true;
        let leftGround = false;
        for (let time = 0; time < 1.5; time += dt) {
          tick(dt);
          leftGround ||= !player.isGrounded;
          assert.equal(player.groundSurface.layer, 'viaduct');
          assert.ok(player.position.y >= viaductSurface(player.position.x, player.position.z) - 1e-7);
        }
        assert.equal(leftGround, true);
        assert.equal(player.isGrounded, true);
        assert.equal(player.jumpVelocity, 0);
        assert.ok(Math.abs(player.position.y - viaductSurface(player.position.x, player.position.z)) < 1e-7);
      });
    }
  }
}

test('caer desde fuera y volver por debajo del tablero no teletransporta al jugador hacia arriba', () => {
  const { player, tick } = fixture(75, 7.82, 52);
  tick();
  // Un empujón externo sacó al jugador de la plataforma y después lo devuelve
  // bajo ella mientras conserva la capa del salto o caída anterior.
  player.position.x = 83;
  for (let frame = 0; frame < 25; frame++) tick();
  assert.ok(player.position.y < 7);
  player.position.x = 75;
  const before = player.position.y;
  tick();
  assert.ok(player.position.y < before);
  for (let frame = 0; frame < 100; frame++) tick();
  assert.equal(player.isGrounded, true);
  assert.equal(player.groundSurface.layer, 'ground');
  assert.ok(player.position.y < .2);
});

test('una posición fuera del tablero cae con gravedad en lugar de teletransportarse al suelo', () => {
  const { player, tick } = fixture(83, 7.82, 52);
  tick();
  assert.equal(player.isGrounded, false);
  assert.ok(player.position.y > 7.7 && player.position.y < 7.82);
  for (let frame = 0; frame < 120; frame++) tick();
  assert.equal(player.isGrounded, true);
  assert.ok(player.position.y < .2);
  assert.equal(player.groundSurface.layer, 'ground');
});

test('las barreras layered frenan sobre el puente y permiten pasar por debajo', () => {
  const above = fixture(75, 7.82, 52);
  above.input.axis.x = 1;
  for (let frame = 0; frame < 200; frame++) above.tick();
  assert.ok(above.player.position.x < 82);
  assert.ok(Math.abs(above.player.position.y - 7.82) < 1e-7);

  const below = fixture(66, city.getGroundHeight(66, 52), 52);
  below.input.axis.x = 1;
  for (let frame = 0; frame < 340; frame++) below.tick();
  assert.ok(below.player.position.x > 82);
  assert.ok(below.player.position.y < .2);
});

test('reiniciar el apoyo tras recuperar al jugador elimina el salto y la capa anteriores', () => {
  const { player, input, tick } = fixture(75, 7.82, 50);
  input.jump = true;
  tick();
  player.position.set(112.98, city.getGroundHeight(112.98, 97.84), 97.84);
  player.resetGrounding();
  tick();
  assert.equal(player.isGrounded, true);
  assert.equal(player.jumpVelocity, 0);
  assert.equal(player.groundSurface.layer, 'ground');
  assert.equal(player.position.y, city.getGroundHeight(112.98, 97.84));
});
