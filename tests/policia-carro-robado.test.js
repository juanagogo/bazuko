// La Policía ve y captura al que maneja un carro robado, y la patrulla de una llamada cuenta desde que llega.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { hasClearCombatLine } from '../src/systems/CombatGeometry.js';

mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { Car } = await import('../src/entities/Car.js');

beforeEach(() => { globalThis.window = new EventTarget(); });

/** Patrulla en el origen con rumbo +X y, si se pide, un carro robado con el jugador adentro. */
function setup({ stolenAt = null, heading = 0 } = {}) {
  const scene = new THREE.Scene(), collisions = new CollisionSystem();
  const traffic = new TrafficSystem(scene, [new TrafficRoute(0, 40, 0, 40)], { carsPerRoute: 0, policeCount: 1, random: () => .2 });
  traffic.setEnvironment({ collisions, getGroundHeight: (_x, _z, y) => y });
  const patrol = traffic.vehicles[0];
  patrol.car.position.set(0, 0, 0);
  patrol.car.group.rotation.y = 0;
  const parked = [];
  const stolen = stolenAt ? new Car(scene, new THREE.Vector3(...stolenAt), heading, { kind: 'carro', variant: 1 }) : null;
  if (stolen) parked.push(stolen);
  // Como Game._syncVehicleColliders: el carro que se maneja también tiene caja.
  const sync = () => collisions.setVehicles([...parked, ...traffic.vehicles.map(v => v.car)]);
  sync();
  let arrests = 0, escapes = 0, reason = null;
  window.addEventListener('police-arrest', () => arrests++);
  window.addEventListener('police-escaped', e => { escapes++; reason = e.detail?.reason; });
  return { scene, collisions, traffic, patrol, stolen, parked, sync,
    get arrests() { return arrests; }, get escapes() { return escapes; }, get reason() { return reason; } };
}

function wall(collisions, min, max) {
  collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)) });
  collisions.invalidateStaticIndex?.();
}

test('desde el carro robado la patrulla ve el robo, lo persigue y lo captura', () => {
  const state = setup({ stolenAt: [6, 0, 0] });
  const { traffic, stolen, sync } = state;
  traffic.playerVehicle = stolen;
  const player = stolen.position; // CarjackSystem._syncPlayer: el jugador va en el centro del carro
  assert.equal(traffic.witnessesTheft(player), true);
  assert.equal(traffic.alertForTheft(player), true);
  let seen = 0;
  for (let i = 0; i < 30; i++) { sync(); traffic.update(.1, { player }); if (traffic._seen) seen++; }
  assert.equal(state.arrests, 1);
  assert.equal(state.escapes, 0);
  assert.ok(seen >= 25, `lo tuvo a la vista ${seen} de 30 cuadros`);
  traffic.dispose();
});

test('sin decirle cuál carro maneja el jugador, su propia caja le tapaba la vista a la patrulla (control)', () => {
  const state = setup({ stolenAt: [6, 0, 0] });
  const { traffic, stolen } = state;
  assert.equal(traffic.alertForTheft(stolen.position), false);
  traffic.dispose();
});

test('la patrulla que llega por detrás de un carro largo alcanza a capturarlo', () => {
  // Mismo rumbo, carro quieto delante: la caja del robado no deja que los centros queden a 3 m.
  const state = setup({ stolenAt: [12, 0, 0] });
  const { traffic, stolen, sync, patrol } = state;
  traffic.playerVehicle = stolen;
  traffic._startChase(patrol);
  for (let i = 0; i < 80 && !state.arrests; i++) { sync(); traffic.update(.1, { player: stolen.position }); }
  assert.equal(state.arrests, 1);
  assert.ok(patrol.car.position.distanceTo(stolen.position) > 3, 'lo capturó desde la cola, sin meterse en el carro');
  traffic.dispose();
});

test('un muro entre la patrulla y el carro robado sigue tapando la vista y la captura', () => {
  const state = setup({ stolenAt: [6, 0, 0] });
  const { traffic, stolen, sync, collisions, patrol } = state;
  wall(collisions, [3.3, 0, -30], [3.5, 4, 30]);
  traffic.playerVehicle = stolen;
  assert.equal(traffic.alertForTheft(stolen.position), false);
  traffic._startChase(patrol);
  for (let i = 0; i < 40; i++) { sync(); traffic.update(.1, { player: stolen.position }); }
  assert.equal(state.arrests, 0);
  traffic.dispose();
});

test('el carro robado sigue tapando a quien está detrás de él para otras líneas de vista', () => {
  const state = setup({ stolenAt: [6, 0, 0] });
  const { traffic, stolen, collisions, patrol } = state;
  traffic.playerVehicle = stolen;
  const behind = new THREE.Vector3(9, 0, 0);
  assert.equal(hasClearCombatLine({ from: patrol.car.position, to: behind, collisions, ignoreVehicle: patrol.car }), false);
  // Sin nadie al volante (se bajó), la patrulla no ve a través de él.
  traffic.playerVehicle = null;
  assert.equal(traffic._seesInChase(patrol, behind), false);
  traffic.dispose();
});

test('la patrulla de una llamada de noche llega al sitio antes de darlo por perdido', () => {
  const state = setup();
  const { traffic, collisions, patrol } = state;
  traffic.franja = { policiaPierde: .8, policiaVista: 1 };
  traffic.wantedLevel = 1;
  wall(collisions, [-30, 0, 9.6], [80, 4, 10]);
  assert.equal(traffic.dispatchTo(new THREE.Vector3(50, 0, 0)), true);
  const player = new THREE.Vector3(50, 0, 14); // detrás del muro
  let escapedAt = null, maxLostIn = 0;
  window.addEventListener('police-escaped', () => { escapedAt ??= patrol.car.position.x; });
  for (let i = 0; i < 400 && escapedAt === null; i++) {
    traffic.update(.1, { player });
    if (traffic.pursuitInfo) maxLostIn = Math.max(maxLostIn, traffic.pursuitInfo.lostIn);
  }
  assert.equal(state.reason, 'vista');
  assert.ok(escapedAt >= 44, `desistió en x ${escapedAt?.toFixed(1)}, antes de llegar a la llamada`);
  assert.ok(maxLostIn <= traffic.lostSightSeconds + 1e-9, 'el HUD nunca cuenta más que lostSightSeconds');
  traffic.dispose();
});

test('la patrulla de la llamada que no puede llegar desiste igual, sin quedarse persiguiendo para siempre', () => {
  const state = setup();
  const { traffic, collisions } = state;
  traffic.wantedLevel = 1;
  // Un muro que la patrulla no puede rodear antes de la llamada.
  wall(collisions, [8, 0, -60], [8.4, 4, 60]);
  assert.equal(traffic.dispatchTo(new THREE.Vector3(40, 0, 0)), true);
  const player = new THREE.Vector3(40, 0, 30);
  let t = 0;
  for (; t < 60 && traffic.inPursuit; t += .1) traffic.update(.1, { player });
  assert.equal(traffic.inPursuit, false);
  assert.ok(t < 20, `desistió a los ${t.toFixed(1)} s`);
  traffic.dispose();
});

test('una patrulla encajonada que lo ve pero no avanza desiste, sin quedarse parada hasta el tiempo máximo', () => {
  const state = setup();
  const { traffic, collisions, patrol } = state;
  // Cajas bajas pegadas a la patrulla por los cuatro lados: no tapan la vista (están bajo el pecho) pero no la dejan moverse.
  wall(collisions, [2.25, 0, -3], [2.6, .6, 3]);
  wall(collisions, [-2.6, 0, -3], [-2.25, .6, 3]);
  wall(collisions, [-3, 0, 1.05], [3, .6, 1.4]);
  wall(collisions, [-3, 0, -1.4], [3, .6, -1.05]);
  traffic.wantedLevel = 3; // tiempo máximo de persecución: 70 s
  const player = new THREE.Vector3(12, 0, 0);
  traffic._startChase(patrol);
  let t = 0;
  for (; t < 80 && traffic.inPursuit; t += .1) traffic.update(.1, { player });
  assert.equal(traffic.inPursuit, false);
  assert.ok(traffic._seen, 'lo tenía a la vista');
  assert.ok(t > 14 && t < 20, `desistió a los ${t.toFixed(1)} s`);
  assert.equal(state.arrests, 0);
  // No lo despistó él: la huida tiene su propio aviso y no paga el encargo de despistar.
  assert.equal(state.reason, 'trancada');
  traffic.dispose();
});

test('la huida por patrulla trancada tiene su aviso y no cuenta para el encargo de despistar', async () => {
  const { textoDeEscape } = await import('../src/ui/HUD.js');
  const { ENCARGOS } = await import('../src/data/encargos.js');
  const { ObjectiveSystem } = await import('../src/systems/ObjectiveSystem.js');
  assert.equal(textoDeEscape('trancada'), 'La patrulla se quedó trancada');
  assert.equal(textoDeEscape('lejos'), 'Los despisté');
  const objective = new ObjectiveSystem([ENCARGOS.despistar.hacer(1, 0)]);
  assert.equal(objective.notify('police-escaped', { reason: 'trancada' }), false);
  for (const reason of ['lejos', 'vista', 'escondido']) assert.equal(objective.notify('police-escaped', { reason }), true, reason);
});
