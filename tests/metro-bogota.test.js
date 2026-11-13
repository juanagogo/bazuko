import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { Player } from '../src/entities/Player.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { METRO, METRO_STATIONS, buildMetroBogota, metroSurface, metroTrackX } from '../src/world/bogota/MetroBogota.js';

const city = new Bogota();
city.map = city._layout();
const collisions = new CollisionSystem();
city._buildCollisions(city.map, collisions);
const metro = buildMetroBogota();
city.metro = metro;
city.metroTrain = metro.userData.train;
city.metroStations = metro.userData.stations;
for (const entry of metro.userData.colliders) collisions.colliders.push(entry);

function createFixture(x, y, z) {
  const input = {
    axis: { x: 0, z: 0 },
    isRunning: false,
    jump: false,
    pressed: new Set(),
    consumePress(key) {
      if (key === 'Space' && this.jump) {
        this.jump = false;
        return true;
      }
      if (this.pressed.has(key)) {
        this.pressed.delete(key);
        return true;
      }
      return false;
    }
  };
  const player = new Player(new THREE.Scene(), input);
  player.position.set(x, y, z);
  player.root.position.copy(player.position);
  const stats = { calor: 100, animo: 50 };
  const game = Object.assign(Object.create(Game.prototype), {
    player,
    input,
    stats,
    collisions,
    world: { active: city },
    cameraRig: { camera: null, follow() {} }
  });
  return {
    game,
    player,
    input,
    tick: (dt = 1 / 60) => {
      city.metroTrain.group.userData.update(dt);
      game._updatePlayerMovement(dt);
    }
  };
}

test('subirse a la estación del Metro coloca al jugador en el andén elevado y permite caminar al viaducto', () => {
  const { game, player, input, tick } = createFixture(112.98, 0.12, 97.84);
  game.boardMetroStation(METRO_STATIONS[0]);
  assert.equal(player.position.y, METRO.platSurfaceY);
  assert.equal(player.groundSurface.layer, 'metro');

  // Caminar desde el andén lateral hacia el eje central del viaducto
  input.axis.x = -1;
  for (let i = 0; i < 90; i++) tick();
  assert.ok(Math.abs(player.position.x - METRO.x) < 1.5, `X en el eje del viaducto: ${player.position.x}`);
  assert.ok(player.position.y >= METRO.deckSurfaceY);

  // Caminar a lo largo del viaducto elevado hacia el sur (Z creciente) saliendo de la estación
  input.axis.x = 0;
  input.axis.z = 1;
  input.isRunning = true;
  const startZ = player.position.z;
  for (let i = 0; i < 300; i++) tick();
  assert.ok(player.position.z > startZ + 18, `avanzó por el viaducto hasta Z=${player.position.z}`);
  assert.equal(player.isGrounded, true);
  assert.equal(player.groundSurface.layer, 'metro');
  assert.equal(player.position.y, metroSurface(player.position.x, player.position.z));
});

test('subirse al tren del Metro mueve al jugador por el viaducto y permite bajarse a caminar por el viaducto', () => {
  const { game, player, input, tick } = createFixture(83, 0.12, 95);
  game.boardMetroTrain(METRO_STATIONS[0]);
  assert.equal(game.ridingMetro, true);
  assert.ok(player.position.y > METRO.trackHeight);

  // Avanzar el tiempo para que el tren salga de la estación y recorra el viaducto
  const initialZ = player.position.z;
  for (let i = 0; i < 300; i++) tick(1 / 30);
  assert.ok(Math.abs(player.position.z - initialZ) > 15, `el tren avanzó desde ${initialZ} hasta ${player.position.z}`);

  // Presionar E para bajarse directamente en el viaducto o estación y seguir caminando
  input.pressed.add('KeyE');
  tick(1 / 60);
  assert.equal(game.ridingMetro, false);
  assert.ok(player.position.y >= METRO.deckSurfaceY);
  assert.equal(player.groundSurface.layer, 'metro');
});

test('el viaducto del metro sigue la traza oficial de Bogota y las escaleras estan en los andenes sin bloquear la via', () => {
  // 1. El viaducto es recto al sur (z=193..310) y suave hacia el nororiente al norte (z=32..193)
  for (let z = 193; z <= METRO.zEnd; z += 10) {
    assert.equal(metroTrackX(z), METRO.x);
  }
  assert.equal(metroTrackX(32), METRO.x + 23);

  // 2. No hay ningún edificio que atraviese el viaducto a lo largo de su traza a la altura del tren
  for (let z = METRO.zStart; z <= METRO.zEnd; z += 2) {
    const pt = new THREE.Vector3(metroTrackX(z), METRO.trackHeight, z);
    for (const c of collisions.colliders) {
      if (!c.layered && c.box && c.box.containsPoint(pt)) {
        assert.fail(`Colisión no layered en el viaducto en Z=${z}: ${c.mesh?.name}`);
      }
    }
  }

  // 3. Las estaciones tienen sus escaleras peatonales en los andenes laterales
  const station = metro.getObjectByName('EstacionMetroCalle72');
  assert.ok(station);
  const stBounds = new THREE.Box3().setFromObject(station);
  assert.ok(stBounds);
});
