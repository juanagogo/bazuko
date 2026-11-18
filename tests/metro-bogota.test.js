import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { Player } from '../src/entities/Player.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { ZONA_NOMBRES } from '../src/ui/ZonaAviso.js';
import { cityLandmarks } from '../src/world/bogota/CityMapRaster.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { METRO, METRO_STATIONS, buildMetroBogota, metroSurface } from '../src/world/bogota/MetroBogota.js';

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

test('MetroBogota: constantes y geometría del viaducto elevado', () => {
  assert.equal(METRO.x, 75, 'Eje central sobre la Avenida Caracas');
  assert.equal(METRO.trackHeight, 12.5, 'Cota de vía elevada a 12.5 metros');
  assert.ok(METRO.zEnd > METRO.zStart, 'Viaducto con longitud válida');
  assert.ok(METRO.deckWidth > 8, 'Ancho para doble vía');
});

test('MetroBogota: buildMetroBogota genera viaducto, tren, estaciones y colisiones', () => {
  const metroGroup = buildMetroBogota();

  assert.equal(metroGroup.name, 'MetroBogota');
  assert.ok(metroGroup.children.length > 0, 'Contiene elementos 3D');

  // Estaciones elevadas
  const st72 = metroGroup.getObjectByName('EstacionMetroCalle72');
  const st26 = metroGroup.getObjectByName('EstacionMetroCalle26');
  assert.ok(st72, 'Estación Calle 72 debe existir');
  assert.ok(st26, 'Estación Calle 26 debe existir');

  // Colisionadores para pilas
  const colliders = metroGroup.userData.colliders;
  assert.ok(Array.isArray(colliders) && colliders.length > 0, 'Debe registrar colisionadores para las pilas');
  for (const c of colliders) {
    assert.ok(c.box, 'Cada colisionador debe tener una Box3');
    assert.equal(c.box.min.x < c.box.max.x, true);
    assert.equal(c.box.min.z < c.box.max.z, true);
  }
});

test('MetroBogota: aviso de zona registrado y puntos en el mapa', () => {
  assert.ok(ZONA_NOMBRES.metro, 'La zona "metro" debe tener nombre asignado');
  assert.match(ZONA_NOMBRES.metro, /Metro de Bogotá/);

  const landmarks = cityLandmarks();
  const metroLandmarks = landmarks.filter(l => l.name.includes('Metro de Bogotá'));
  assert.ok(metroLandmarks.length >= 2, 'Deben registrarse al menos dos hitos del Metro en el mapa');
});
