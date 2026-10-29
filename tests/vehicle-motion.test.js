import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';

mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { Car } = await import('../src/entities/Car.js');
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const makeCar = (kind = 'carro', traffic = true) => new Car(new THREE.Scene(), new THREE.Vector3(12, 7.82, 20), .7, { kind, traffic, variant: 3 });
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);

function visualState(car) {
  const v = car.vehicle;
  return {
    wheels: v.wheels.map(wheel => wheel.rotation.z),
    steering: v.frontWheelPivots.map(pivot => pivot.rotation.y),
    body: [v.bodyVisual.position.y, v.bodyVisual.rotation.x, v.bodyVisual.rotation.z],
    wipers: v.wipers.map(wiper => wiper.rotation.z),
    signals: [v.signalMaterials.left.emissiveIntensity, v.signalMaterials.right.emissiveIntensity],
    police: v.policeLights ? [v.policeLights.blue.color.getHex(), v.policeLights.red.color.getHex()] : null,
  };
}

test('las ruedas ruedan según su radio y distancia firmada, sin desplazar la raíz física', () => {
  const car = makeCar(), position = car.position.clone(), rotation = car.group.quaternion.clone();
  const wheels = car.vehicle.wheels;
  wheels[0].userData.radius = .5;
  wheels[1].userData.radius = .25;
  car.animateDrive(1, false);
  near(wheels[0].rotation.z, -2);
  near(wheels[1].rotation.z, -4);
  for (const wheel of wheels) assert.ok(wheel.rotation.z < 0, 'Avanzar hacia +X rueda en −Z');
  car.animateDrive(-1, false);
  for (const wheel of wheels) near(wheel.rotation.z, 0);
  assert.ok(position.equals(car.position) && rotation.equals(car.group.quaternion));
  car.dispose();
});

test('dirección, patrulla, intermitentes y limpiaparabrisas usan el mismo tiempo a 30/60/120 Hz y se congelan en pausa', () => {
  const states = [];
  for (const fps of [30, 60, 120]) {
    const car = makeCar('police');
    car.setNight(true, true);
    for (let frame = 0; frame < fps; frame++) car.animateDrive(5 / fps, false,
      { dt: 1 / fps, speed: 5, acceleration: 0, steering: .3, turnSignal: 'left' });
    states.push(visualState(car));
    const before = visualState(car);
    car.update(0);
    car.animateDrive(0, false, { dt: 0, speed: 5, steering: .3, turnSignal: 'left' });
    assert.deepEqual(visualState(car), before);
    car.dispose();
  }
  for (const state of states.slice(1)) {
    states[0].wheels.forEach((value, i) => near(value, state.wheels[i]));
    states[0].steering.forEach((value, i) => near(value, state.steering[i]));
    states[0].wipers.forEach((value, i) => near(value, state.wipers[i]));
    assert.deepEqual(state.signals, states[0].signals);
    assert.deepEqual(state.police, states[0].police);
    state.body.forEach((value, i) => near(value, states[0].body[i], .001));
  }
});

test('suspensión y dirección entran suavemente, regresan al reposo y conservan altura/caja del vehículo', () => {
  const car = makeCar(), v = car.vehicle;
  const position = car.position.clone(), orientation = car.group.quaternion.clone();
  const dimensions = [car.length, car.width];
  car.animateDrive(.25, true, { dt: .05, speed: 5, acceleration: -3, steering: .34 });
  assert.ok(v.frontWheelPivots.every(pivot => pivot.rotation.y > 0 && pivot.rotation.y < .34));
  assert.ok(v.bodyVisual.rotation.z < 0, 'Frenar baja el frente local +X');
  const roofDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(v.bodyVisual.quaternion);
  assert.ok(roofDirection.z > 0, 'Al girar a la izquierda local −Z el techo carga el exterior +Z');
  car.animateDrive(.25, false, { dt: .05, speed: 5, steering: NaN });
  assert.ok(v.frontWheelPivots.every(pivot => pivot.quaternion.toArray().every(Number.isFinite)));
  assert.ok(v.bodyVisual.quaternion.toArray().every(Number.isFinite));
  for (let i = 0; i < 100; i++) car.animateDrive(0, true, { dt: .05, speed: 0, acceleration: 0 });
  near(v.bodyVisual.rotation.x, 0); near(v.bodyVisual.rotation.z, 0);
  near(v.frontWheelPivots[0].rotation.y, 0); near(v.bodyVisual.position.y, 0);
  assert.ok(position.equals(car.position) && orientation.equals(car.group.quaternion));
  assert.deepEqual([car.length, car.width], dimensions);
  car.dispose();
});

test('frenos y direccionales son independientes entre lados y carros; la lluvia termina el barrido al secar', () => {
  const a = makeCar(), b = makeCar();
  const original = b.vehicle.tailMat.color.clone();
  a.animateDrive(.4, true, { dt: .2, speed: 2, turnSignal: 'left' });
  assert.ok(a.vehicle.tailMat.color.r > b.vehicle.tailMat.color.r);
  assert.ok(b.vehicle.tailMat.color.equals(original));
  assert.ok(a.vehicle.signalMaterials.left.emissiveIntensity > a.vehicle.signalMaterials.right.emissiveIntensity);
  assert.equal(b.vehicle.signalMaterials.left.emissiveIntensity, .12);
  const dry = a.vehicle.wetMaterials.map(material => material.roughness);
  const otherDry = b.vehicle.wetMaterials.map(material => material.roughness);
  a.setNight(false, true);
  a.setNight(false, true);
  a.vehicle.wetMaterials.forEach((material, i) => near(material.roughness, dry[i] * .75));
  assert.deepEqual(b.vehicle.wetMaterials.map(material => material.roughness), otherDry);
  assert.ok(a.vehicle.headlightMaterial.emissiveIntensity > b.vehicle.headlightMaterial.emissiveIntensity);
  a.animateDrive(0, true, { dt: .25, speed: 0 });
  assert.ok(a.vehicle.wipers.every(wiper => wiper.rotation.z > wiper.userData.restAngle));
  a.setNight(false, false);
  assert.deepEqual(a.vehicle.wetMaterials.map(material => material.roughness), dry);
  for (let i = 0; i < 30; i++) a.animateDrive(0, true, { dt: .05, speed: 0 });
  for (const wiper of a.vehicle.wipers) near(wiper.rotation.z, wiper.userData.restAngle);
  a.dispose(); b.dispose();
});

test('precarga mantiene carrocería, conductor que entra/sale y los únicos dos espejos robables; libera recursos una sola vez', async () => {
  const car = makeCar(), v = car.vehicle, driver = car.driver;
  const resources = new Map();
  for (const owned of [car.driver, ...car.mirrors, car.marker]) owned.traverse(object => {
    for (const resource of [object.geometry, ...[object.material].flat()]) {
      if (!resource || resources.has(resource)) continue;
      resources.set(resource, 0);
      resource.addEventListener('dispose', () => resources.set(resource, resources.get(resource) + 1));
    }
  });
  await car.preloadModel();
  assert.equal(car.vehicle, v);
  assert.equal(car.driver, driver);
  assert.equal(car.driver.visible, true);
  car.setDriverInside(false); assert.equal(driver.visible, false);
  car.setDriverInside(true); assert.equal(driver.visible, true);
  const door = car.driverDoor();
  near(door.y, car.position.y);
  assert.ok(door.distanceTo(car.position) > car.width / 2);
  assert.equal(car.mirrors.length, 2);
  for (let i = 0; i < 2; i++) assert.ok(car.mirrors[i].position.equals(v.mirrorAnchors[i]));
  assert.ok(car.steal());
  assert.ok(car.mirrors.every(mirror => !mirror.visible));
  assert.equal(driver.visible, true);
  car.dispose(); car.dispose();
  assert.ok([...resources.values()].every(count => count === 1));
});

test('el tráfico anticipa el giro, orienta ruedas sin cambiar la ruta y enciende stops solo al frenar o esperar', () => {
  const route = new TrafficRoute(0, 60, 0, 60, 6);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0], direction = new THREE.Vector3();
  vehicle.distance = 20; vehicle.speed = 2;
  route.sample(vehicle.distance, vehicle.car.position, direction);
  traffic.update(.1);
  assert.ok(vehicle.speed > 2);
  assert.equal(vehicle.car._braking, false, 'Arrancar por debajo del 70% de crucero no activa stops');
  vehicle.distance = route.segments[0].length + 2;
  route.sample(vehicle.distance, vehicle.car.position, direction);
  traffic.update(.1);
  assert.ok(vehicle.car.vehicle.frontWheelPivots.every(pivot => pivot.rotation.y < 0));
  assert.equal(vehicle.car._turnSignal, 'right');
  const expected = new THREE.Vector3();
  route.sample(vehicle.distance, expected, direction);
  assert.ok(vehicle.car.position.equals(expected));
  near(vehicle.car.group.rotation.y, Math.atan2(-direction.z, direction.x));
  const pedestrian = { position: new THREE.Vector3() };
  route.sample(vehicle.distance + 15, pedestrian.position, direction);
  for (let i = 0; i < 240; i++) traffic.update(.05, { pedestrians: [pedestrian] });
  assert.equal(vehicle.speed, 0); assert.equal(vehicle.car._braking, true);
  const state = visualState(vehicle.car), time = traffic._time;
  traffic.update(0);
  assert.deepEqual(visualState(vehicle.car), state); assert.equal(traffic._time, time);
  traffic.dispose();
});
