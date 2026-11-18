import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Npc } from '../src/entities/Npc.js';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';
import { seededRandom } from '../src/character/people.js';

function street() {
  // Andén (z 0-1), calzada (z 2-5) y andén de enfrente (z 6-7), en baldosas de 2 m.
  const rows = [];
  for (let z = 0; z < 8; z++) rows.push(Array(10).fill(z < 2 || z > 5 ? 'sidewalk' : 'road'));
  const navigation = new PedestrianNavigation(rows, 2);
  const collisions = { queryStatic: () => [] };
  return { navigation, collisions };
}

test('quien cruza por la mitad de la cuadra llega al andén de enfrente en línea recta', async () => {
  const { navigation, collisions } = street();
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(10, 0, 2), { look: {}, person: null, navigation, collisions, isWalkable: (x, z) => navigation.isWalkableAt(x, z) });
  npc.person = {}; npc.stance = null;
  await npc.ready;
  const original = Math.random; Math.random = () => .9;
  npc.position.set(10, 0, 2.5);
  const started = npc._startJaywalk();
  Math.random = original;
  assert.equal(started, true);
  assert.ok(npc._jay.z > 11, `cruza hacia ${npc._jay.z}`);
  let onRoad = false;
  for (let frame = 0; frame < 600 && npc._jay; frame++) { npc._walkJay(.05, 1); if (!navigation.isWalkableAt(npc.position.x, npc.position.z)) onRoad = true; }
  assert.equal(npc._jay, null);
  assert.ok(onRoad, 'pisó la calzada');
  assert.ok(navigation.isWalkableAt(npc.position.x, npc.position.z));
  npc.dispose();
});

test('el que cruza con calma espera a que pase el carro en marcha', async () => {
  const { navigation, collisions } = street();
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(10, 0, 2.5), { look: {}, navigation, collisions, isWalkable: (x, z) => navigation.isWalkableAt(x, z) });
  await npc.ready;
  npc._jay = { x: 10, z: 14, hurry: false, patience: 12 };
  const group = new THREE.Group(); group.rotation.y = 0;
  npc._vehicles = [{ speed: 8, car: { position: new THREE.Vector3(0, 0, 3.5), group } }];
  const before = npc.position.clone();
  npc._walkJay(.1, 1);
  assert.ok(npc.position.equals(before), 'espera el hueco');
  npc._vehicles = [{ speed: 0, car: { position: new THREE.Vector3(0, 0, 3.5), group } }];
  npc._walkJay(.1, 1);
  assert.ok(!npc.position.equals(before), 'con el carro parado pasa');
  npc.dispose();
});

test('el carro que ya no alcanza a frenar tumba al peatón que cruza sin mirar y se detiene', () => {
  const route = new TrafficRoute(0, 100, 0, 60, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, policeCount: 0, random: () => .5 });
  const vehicle = traffic.vehicles[0];
  route.sample(20, vehicle.car.position, traffic._direction);
  vehicle.distance = 20; vehicle.speed = 9;
  vehicle.car.group.rotation.y = Math.atan2(-traffic._direction.z, traffic._direction.x);
  const hx = Math.cos(vehicle.car.group.rotation.y), hz = -Math.sin(vehicle.car.group.rotation.y);
  const hits = [];
  const person = { position: new THREE.Vector3(vehicle.car.position.x + hx * 1.5, 0, vehicle.car.position.z + hz * 1.5), runoverDoom: true, takeHit: hit => hits.push(hit) };
  const calm = { position: person.position.clone(), runoverDoom: false, takeHit: hit => hits.push(hit) };
  traffic._buildSpatialIndex([calm]);
  traffic._checkRunovers(vehicle);
  assert.equal(hits.length, 0, 'quien va protegido no se toca');
  traffic._buildSpatialIndex([person]);
  traffic._checkRunovers(vehicle);
  assert.equal(hits.length, 1);
  assert.equal(vehicle.impactStop, true);
  assert.equal(person.runoverDoom, false);
  traffic.dispose();
});

test('con tráfico de verdad, quien cruza por la mitad de la cuadra nunca se mete dentro de un carro o una moto', async () => {
  const original = Math.random, random = seededRandom('cruces-esquivan');
  Math.random = random;
  try {
    // Andén (z 0-7), calzada (z 8-13) por donde corre el circuito, andén de enfrente (z 14-21).
    const rows = [];
    for (let z = 0; z < 12; z++) rows.push(Array(60).fill(z >= 4 && z <= 6 ? 'road' : 'sidewalk'));
    const navigation = new PedestrianNavigation(rows, 2);
    const collisions = { queryStatic: () => [] };
    const route = new TrafficRoute(0, 110, 11, 80, 3.2);
    const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 8, policeCount: 0, random });
    const npcs = [];
    for (let i = 0; i < 6; i++) {
      const npc = new Npc(new THREE.Scene(), new THREE.Vector3(20 + i * 12, 0, 6), { look: {}, navigation, collisions, isWalkable: (x, z) => navigation.isWalkableAt(x, z) });
      npc.person = {}; npc.stance = null;
      await npc.ready;
      npc._vehicles = traffic.vehicles;
      npcs.push(npc);
    }
    let crossings = 0, onRoadFrames = 0, waits = 0, closest = Infinity;
    const dt = .05;
    for (let frame = 0; frame < 4000; frame++) {
      traffic.update(dt, { pedestrians: npcs });
      for (const npc of npcs) {
        if (!npc._jay) {
          if (!npc._startJaywalk()) npc.position.z = npc.position.z > 10 ? 16 : 6;
          else { npc.runoverDoom = false; npc._jay.hurry = frame % 2 === 0; }
          continue;
        }
        const before = npc.position.clone();
        npc._walkJay(dt, npc._jay.hurry ? 1.5 : 1);
        if (npc.position.equals(before)) waits++;
        if (!navigation.isWalkableAt(npc.position.x, npc.position.z)) onRoadFrames++;
        if (!npc._jay && npc.position.z > 12.5) crossings++;
        for (const { car } of traffic.vehicles) {
          const ox = npc.position.x - car.position.x, oz = npc.position.z - car.position.z;
          const hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
          const forward = ox * hx + oz * hz, sideways = -ox * hz + oz * hx;
          closest = Math.min(closest, Math.hypot(Math.max(0, Math.abs(forward) - car.length / 2), Math.max(0, Math.abs(sideways) - car.width / 2)));
          assert.ok(!(Math.abs(forward) < car.length / 2 && Math.abs(sideways) < car.width / 2), `frame ${frame}: un peatón quedó dentro de ${car.isMoto ? 'una moto' : 'un carro'}`);
        }
      }
    }
    assert.ok(onRoadFrames > 100, 'sí pisaron la calzada');
    assert.ok(waits > 20, 'esperaron o se hicieron a un lado por los vehículos');
    assert.ok(crossings >= 1, 'cruzaron');
    assert.ok(closest < 3, 'los carros pasaron cerca: la prueba no es trivial');
    traffic.dispose();
    for (const npc of npcs) npc.dispose();
  } finally {
    Math.random = original;
  }
});
