import { CALLES } from '../src/world/bogota/StreetLayout.js';
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

// Usa los carros reales, sustituyendo solo las texturas de Canvas por texturas vacías.
const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { Car } = await import('../src/entities/Car.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { TrafficSignals, signalState } = await import('../src/world/bogota/TrafficSignals.js');
const { CAR_MODELS, PRIVATE_MIX } = await import('../src/world/bogota/carModels.js');
const { BusService } = await import('../src/world/bogota/BusService.js');
const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');
const { parkedCarOffset, parkedCarShift } = await import('../src/world/bogota/parkedCars.js');

test('el bus completa el desvío de Colpatria con tráfico y semáforos durante diez minutos', () => {
  let seed = 12345;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const city = new Bogota(), bus = new BusService(city.getBusRoute());
  const traffic = new TrafficSystem(new THREE.Scene(), city.getTrafficRoutes(), { random });
  const signals = traffic.signals = new TrafficSignals();
  bus.signals = signals; traffic.setBus(bus);
  let cycles = 0, stopped = 0;
  for (let frame = 0; frame < 6000; frame++) {
    signals.update(frame * .1); traffic.update(.1);
    const before = bus.position.z;
    bus.update(.1, { vehicles: traffic.vehicles });
    if (bus.position.z > before) cycles++;
    stopped = bus.speed < .05 ? stopped + .1 : 0;
    assert.ok(stopped < 60, `Reservas: ${JSON.stringify([...signals.reservations].filter(([n,s])=>s.busBlocked).map(([n,s])=>({n,owners:[...s.owners.keys()].map(v=>({x:v.car.position.x,z:v.car.position.z,speed:v.speed}))})))} Bus bloqueado en ${bus.position.x}, ${bus.position.z}: ${JSON.stringify(traffic.vehicles.filter(v=>v.car.position.distanceTo(bus.position)<25).map(v=>({x:v.car.position.x,z:v.car.position.z,speed:v.speed,yaw:v.car.group.rotation.y})))}`);
  }
  assert.ok(cycles >= 2, `Recorridos completos: ${cycles}`);
  traffic.dispose(); bus.dispose();
});

test('descartar peatones lejanos mantiene el mismo frenado en rectas y giros', () => {
  const route = new TrafficRoute(0, 30, 0, 30);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, policeCount: 0 });
  const vehicle = traffic.vehicles[0], direction = new THREE.Vector3();
  const pedestrians = [];
  for (let x = -4; x <= 34; x += 2) for (let z = -4; z <= 34; z += 2) {
    pedestrians.push({ position: new THREE.Vector3(x, 0, z) });
  }
  for (let distance = 0; distance < route.length; distance += .75) {
    vehicle.distance = distance;
    vehicle.speed = 5;
    route.sample(distance, vehicle.car.position, direction);
    const actual = traffic._clearance(vehicle, null, pedestrians);
    const lookAhead = Math.max(7, vehicle.speed ** 2 / (2 * vehicle.braking) + vehicle.speed * .8 + 2);
    let expected = Infinity;
    for (let ahead = 0; ahead <= lookAhead; ahead += .5) {
      route.sample(distance + ahead, traffic._probePosition, traffic._probeDirection);
      if (pedestrians.some(p => traffic._personInCar(p.position, vehicle.car))) {
        expected = Math.max(0, ahead - .5);
        break;
      }
    }
    assert.equal(actual, expected);
  }
  let probes = 0;
  const check = traffic._personInCar.bind(traffic);
  traffic._personInCar = (...args) => { probes++; return check(...args); };
  traffic._clearance(vehicle, null, [{ position: new THREE.Vector3(500, 0, 500) }]);
  assert.equal(probes, 0);
  traffic.dispose();
});

test('los circuitos son continuos y toda la carrocería permanece en la calzada', () => {
  const city = new Bogota(), map = city._layout();
  const position = new THREE.Vector3(), direction = new THREE.Vector3();
  for (const route of city.getTrafficRoutes()) {
    for (let distance = 0; distance < route.length; distance += 0.1) {
      route.sample(distance, position, direction);
      assert.ok(Math.abs(direction.length() - 1) < 1e-8);
      for (const forward of [-2.15, -1, 0, 1, 2.15]) for (const sideways of [-0.88, 0, 0.88]) {
        const x = position.x + direction.x * forward - direction.z * sideways;
        const z = position.z + direction.z * forward + direction.x * sideways;
        assert.equal(map[Math.round(z / 2)]?.[Math.round(x / 2)], 'road', `carro fuera del carril: ${x},${z}`);
      }
    }
    const first = new THREE.Vector3(), end = new THREE.Vector3();
    route.sample(0, first, direction);
    route.sample(route.length, end, direction);
    assert.ok(first.distanceTo(end) < 1e-8);
    route.sample(route.length - 0.001, end, direction);
    assert.ok(first.distanceTo(end) < 0.002);
  }
});

test('el tráfico recorre vueltas completas, gira las ruedas y mantiene la distancia', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(14, 44, 26, 60)], { random: () => 0.7, policeCount: 0 });
  traffic.vehicles[1].cruiseSpeed = 1.4;
  const starts = traffic.vehicles.map(vehicle => vehicle.distance);
  let passedSeam = false;
  for (let frame = 0; frame < 1500; frame++) {
    const previous = traffic.vehicles.map(vehicle => vehicle.distance);
    traffic.update(0.1);
    for (let i = 0; i < traffic.vehicles.length; i++) {
      const vehicle = traffic.vehicles[i];
      if (vehicle.distance < previous[i]) passedSeam = true;
      for (const other of traffic.vehicles) {
        if (other === vehicle) continue;
        const gap = (other.distance - vehicle.distance + vehicle.route.length) % vehicle.route.length;
        assert.ok(gap >= (vehicle.car.length + other.car.length) / 2 + 1.8 - 1e-6);
      }
      assert.ok(vehicle.speed >= 0 && vehicle.speed <= vehicle.cruiseSpeed + 1e-6);
    }
  }
  assert.ok(passedSeam);
  for (let i = 0; i < traffic.vehicles.length; i++) {
    assert.notEqual(traffic.vehicles[i].distance, starts[i]);
    assert.ok(traffic.vehicles[i].car.vehicle.wheels[0].rotation.z < 0);
    assert.equal(traffic.vehicles[i].car.marker.visible, false);
    const car = traffic.vehicles[i].car, stolen = car.steal();
    assert.ok(stolen.items.includes('retrovisor'));
    assert.equal(stolen.items.includes('radio'), false);
    assert.equal(car.steal(), null, 'El mismo carro no se puede saquear de nuevo durante el enfriamiento');
    car.update(1000);
    assert.equal(car.marker.visible, false, 'Un carro de tráfico no muestra el marcador de estacionado');
  }
  traffic.dispose();
});

test('con distancia suficiente los carros frenan ante el jugador o un peatón y reanudan la marcha', () => {
  for (const type of ['player', 'pedestrian']) {
    const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 240, 0, 240)], { carsPerRoute: 1, policeCount: 0, random: () => 0.5 });
    const vehicle = traffic.vehicles[0];
    vehicle.distance = 2;
    vehicle.speed = vehicle.cruiseSpeed;
    const actor = new THREE.Vector3(), direction = new THREE.Vector3();
    vehicle.route.sample(vehicle.distance + 60, actor, direction);
    const context = type === 'player' ? { player: actor } : { pedestrians: [{ position: actor }] };
    for (let frame = 0; frame < 500; frame++) traffic.update(0.1, context);
    assert.equal(vehicle.speed, 0);
    assert.ok(vehicle.car.position.distanceTo(actor) >= vehicle.car.length / 2 + 0.55);
    const stopped = vehicle.distance;
    for (let frame = 0; frame < 40; frame++) traffic.update(0.1);
    assert.ok(vehicle.distance > stopped + 3);
    traffic.dispose();
  }
});

function sequence(...values) {
  let index = 0;
  return () => values[index++ % values.length];
}

test('las patrullas usan el modelo policial y circulan como el resto del tráfico', () => {
  const routes = [
    new TrafficRoute(0, 40, 0, 40),
    new TrafficRoute(50, 90, 0, 40),
    new TrafficRoute(0, 40, 50, 90),
  ];
  const traffic = new TrafficSystem(new THREE.Scene(), routes, { carsPerRoute: 0, policeCount: 2, random: sequence(0.1, 0.8, 0.5, 0.3) });
  assert.equal(traffic.vehicles.length, 2);
  for (const vehicle of traffic.vehicles) {
    assert.equal(vehicle.police, true);
    assert.equal(vehicle.car.kind, 'police');
    assert.ok(vehicle.car.vehicle.policeLights);
    assert.equal(vehicle.car.steal(), null);
  }
  // Los cambios de recorrido usan el mismo `_chooseRoute` que los carros civiles.
  const starts = traffic.vehicles.map(vehicle => vehicle.distance);
  for (let frame = 0; frame < 20; frame++) traffic.update(0.1);
  assert.ok(traffic.vehicles.every((vehicle, i) => vehicle.distance !== starts[i]));
  traffic.dispose();
});

test('una patrulla cercana o de frente presencia el robo', () => {
  const route = new TrafficRoute(0, 40, 0, 40);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 0, policeCount: 1, random: () => 0.2 });
  const vehicle = traffic.vehicles[0];
  vehicle.route.sample(5, vehicle.car.position, new THREE.Vector3());
  vehicle.car.group.rotation.y = 0;
  assert.equal(traffic.witnessesTheft(new THREE.Vector3(8, 0, 0)), true);
  assert.equal(traffic.witnessesTheft(new THREE.Vector3(8, 0, 20)), false);
  assert.equal(traffic.witnessesTheft(new THREE.Vector3(-5, 0, 0)), true);
  assert.equal(traffic.witnessesTheft(new THREE.Vector3(80, 0, 80)), false);
  traffic.dispose();
});

test('al ver un robo la patrulla pasa a persecución y solo captura al alcanzar', () => {
  const route = new TrafficRoute(0, 40, 0, 40);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 0, policeCount: 1, random: () => 0.2 });
  const vehicle = traffic.vehicles[0];
  vehicle.route.sample(5, vehicle.car.position, new THREE.Vector3());
  vehicle.car.group.rotation.y = 0;
  const player = new THREE.Vector3(10, 0, 0);
  assert.equal(vehicle.state, 'patrol');
  assert.equal(traffic.alertForTheft(player), true);
  assert.equal(vehicle.state, 'chase');
  assert.equal(vehicle.car.pursuit, true);
  assert.equal(traffic.inPursuit, true);

  let arrests = 0;
  window.addEventListener('police-arrest', () => arrests++);
  for (let frame = 0; frame < 40; frame++) {
    player.x = vehicle.car.position.x + 8;
    traffic.update(0.1, { player });
    assert.equal(arrests, 0);
    assert.equal(vehicle.state, 'chase');
  }
  assert.ok(vehicle.car.position.x > 5);

  player.copy(vehicle.car.position);
  for (let frame = 0; frame < 30 && arrests === 0; frame++) {
    traffic.update(0.1, { player });
  }
  assert.equal(arrests, 1);
  traffic.endPursuit();
  assert.equal(vehicle.state, 'patrol');
  assert.equal(vehicle.car.pursuit, false);
  assert.equal(traffic.inPursuit, false);
  traffic.dispose();
});

test('si te alejas lo suficiente la patrulla vuelve a rondar', () => {
  const route = new TrafficRoute(0, 40, 0, 40);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 0, policeCount: 1, random: () => 0.2 });
  const vehicle = traffic.vehicles[0];
  vehicle.route.sample(5, vehicle.car.position, new THREE.Vector3());
  vehicle.car.group.rotation.y = 0;
  assert.equal(traffic.alertForTheft(new THREE.Vector3(8, 0, 0)), true);
  let escaped = 0;
  window.addEventListener('police-escaped', () => escaped++);
  traffic.update(0.1, { player: new THREE.Vector3(200, 0, 200) });
  assert.equal(vehicle.state, 'patrol');
  assert.equal(escaped, 1);
  assert.equal(traffic.inPursuit, false);
  traffic.dispose();
});

test('el parqueo queda fuera de los circuitos y eliminar un carro conserva recursos compartidos', () => {
  const city = new Bogota();
  city.map = city._layout();
  const spots = city.getParkingSpots();
  assert.ok(spots.length >= 5);
  assert.ok(spots.every(spot => spot.z < (CALLES[0][0] - 2) * 2 || spot.z > (CALLES[1][1] + 2) * 2));
  const scene = new THREE.Scene();
  const first = new Car(scene, new THREE.Vector3());
  const second = new Car(scene, new THREE.Vector3(10, 0, 0));
  let sharedDisposed = false, bodyDisposed = false;
  // Las ruedas de un parqueado van en sus molduras, también compartidas por modelo.
  first.vehicle.bodyVisual.children[0].geometry.addEventListener('dispose', () => { sharedDisposed = true; });
  first.vehicle.group.children[0].geometry.addEventListener('dispose', () => { bodyDisposed = true; });
  first.dispose();
  assert.equal(sharedDisposed, false);
  // La carrocería también es compartida por modelo: el otro carro la sigue usando.
  assert.equal(bodyDisposed, false);
  assert.ok(scene.children.includes(second.group));
  second.update(.5, second.position);
  assert.equal(second.marker.visible, true);
  assert.ok(second.steal());
  second.dispose();
});

test('las alternativas aleatorias mantienen toda la carrocería en calles y cruces transitables', () => {
  const city = new Bogota(), map = city._layout();
  const routes = city.getTrafficRoutes();
  assert.equal(routes.length, 8);
  assert.equal(routes.alternatives.length, 79);
  const position = new THREE.Vector3(), direction = new THREE.Vector3();
  for (const route of routes.alternatives) for (let distance = 0; distance < route.length; distance += .5) {
    route.sample(distance, position, direction);
    // La huella más grande que circula es la de la buseta: 7,6 × 2,3 m.
    for (const front of [-3.8, 3.8]) for (const side of [-1.15, 1.15]) {
      const x = position.x + direction.x * front - direction.z * side;
      const z = position.z + direction.z * front + direction.x * side;
      assert.equal(map[Math.round(z / 2)]?.[Math.round(x / 2)], 'road');
    }
  }
});

test('cada carro cambia de recorrido sin teletransportarse, invertir rumbo ni aumentar la población', () => {
  let seed = 12345;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const traffic = new TrafficSystem(new THREE.Scene(), new Bogota().getTrafficRoutes(), { random });
  const signals = traffic.signals = new TrafficSignals();
  const before = new THREE.Vector3(), after = new THREE.Vector3(), oldDirection = new THREE.Vector3(), newDirection = new THREE.Vector3();
  for (const vehicle of traffic.vehicles) {
    vehicle.route.sample(vehicle.distance, before, oldDirection);
    if (!traffic._chooseRoute(vehicle)) continue;
    vehicle.route.sample(vehicle.distance, after, newDirection);
    assert.ok(before.distanceTo(after) < 1e-8);
    assert.ok(oldDirection.distanceTo(newDirection) < 1e-8);
  }
  for (let frame = 0; frame < 1800; frame++) {
    signals.update(frame * .1);
    const positions = traffic.vehicles.map(vehicle => vehicle.car.position.clone());
    traffic.update(.1);
    traffic.vehicles.forEach((vehicle, index) => {
      assert.ok(vehicle.car.position.distanceTo(positions[index]) <= vehicle.cruiseSpeed * .1 + 1e-6);
      assert.ok(Number.isFinite(vehicle.distance));
    });
  }
  assert.equal(traffic.vehicles.length, 32);
  assert.ok(traffic.vehicles.reduce((sum, vehicle) => sum + vehicle.routeChanges, 0) > 20);
  assert.ok(traffic.vehicles.some(vehicle => vehicle.speed > 0));
  traffic.dispose();
});

test('los carros que comparten tramo se frenan aunque pertenezcan a recorridos distintos', () => {
  const a = new TrafficRoute(0, 40, 0, 40), b = new TrafficRoute(0, 60, 0, 60);
  const traffic = new TrafficSystem(new THREE.Scene(), [a, b], { carsPerRoute: 1, random: () => .5 });
  const [first, second] = traffic.vehicles;
  first.distance = 9; second.distance = 17;
  for (const vehicle of traffic.vehicles) {
    vehicle.route.sample(vehicle.distance, traffic._position, traffic._direction);
    vehicle.car.position.copy(traffic._position);
    vehicle.car.group.rotation.y = Math.atan2(-traffic._direction.z, traffic._direction.x);
    vehicle.speed = 5;
  }
  assert.ok(traffic._clearance(first, null, []) < 4);
  assert.equal(traffic._clearance(second, null, []), Infinity);
  const bus = { position: new THREE.Vector3(second.car.position.x + 8, 0, second.car.position.z),
    group: new THREE.Group(), length: 18.2, width: 2.52 };
  traffic.setBus(bus);
  assert.ok(traffic._clearance(second, null, []) < 12);
  bus.position.z += 30;
  assert.equal(traffic._clearance(second, null, []), Infinity);
  traffic.dispose();
});

test('los carros del tráfico respetan la caja de un carro estacionado y no lo atraviesan', () => {
  const route = new TrafficRoute(0, 240, 0, 240, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0]; placeOnStraight(vehicle, 10, 0, 1, 0);
  const parked = new Car(new THREE.Scene(), new THREE.Vector3(35, 0, 0));
  traffic.setParkedCars([parked]);
  for (let frame = 0; frame < 200; frame++) {
    traffic.update(.1);
    assert.ok(vehicle.car.position.x + vehicle.car.length / 2 < parked.position.x - parked.length / 2);
  }
  assert.equal(vehicle.speed, 0);
  const stopped = vehicle.distance; parked.position.z = 20;
  for (let frame = 0; frame < 50; frame++) traffic.update(.1);
  assert.ok(vehicle.distance > stopped + 5);
  traffic.dispose(); parked.dispose();
});

test('cuatro carros que llegan desde vías distintas despejan un cruce del barrio nuevo sin bloquearse', () => {
  const city = new Bogota(), signals = new TrafficSignals();
  const node = signals.nodes.find(node => node.x0 === 167 && node.z0 === 143);
  assert.ok(node);
  const cx = (node.x0 + node.x1) / 2, cz = (node.z0 + node.z1) / 2;
  const entries = [
    [node.x0 - 7, cz + 3, 1, 0], [node.x1 + 7, cz - 3, -1, 0],
    [cx - 3, node.z0 - 7, 0, 1], [cx + 3, node.z1 + 7, 0, -1]
  ];
  const point = new THREE.Vector3(), direction = new THREE.Vector3();
  const starts = entries.map(([x, z, hx, hz]) => {
    for (const route of city.getTrafficRoutes().alternatives) for (let distance = 0; distance < route.length; distance += .25) {
      route.sample(distance, point, direction);
      if (Math.hypot(point.x - x, point.z - z) < .13 && direction.x * hx + direction.z * hz > .999) return { route, distance };
    }
    assert.fail('Falta una ruta de acceso al cruce');
  });
  const traffic = new TrafficSystem(new THREE.Scene(), starts.map(start => start.route), { carsPerRoute: 1, random: () => .5 });
  traffic.signals = signals;
  traffic.vehicles.forEach((vehicle, index) => {
    vehicle.distance = starts[index].distance;
    vehicle.routeTimer = 1000;
    vehicle.route.sample(vehicle.distance, vehicle.car.position, direction);
    vehicle.car.group.rotation.y = Math.atan2(-direction.z, direction.x);
  });
  const entered = new Set(), cleared = new Set();
  for (let frame = 0; frame < 1200 && cleared.size < 4; frame++) {
    signals.update(frame * .1);
    traffic.update(.1);
    for (const vehicle of traffic.vehicles) {
      if (traffic._overlapsNode(vehicle.car, node)) entered.add(vehicle);
      else if (entered.has(vehicle)) cleared.add(vehicle);
    }
  }
  assert.equal(cleared.size, 4);
  traffic.dispose();
});

function placeOnStraight(vehicle, x, z, hx, hz) {
  let start = 0;
  for (const segment of vehicle.route.segments) {
    const along = (x - segment.x) * hx + (z - segment.z) * hz;
    if (!segment.radius && segment.dx === hx && segment.dz === hz && along >= 0 && along <= segment.length &&
      Math.abs((x - segment.x) * -hz + (z - segment.z) * hx) < 1e-6) {
      vehicle.distance = start + along; vehicle.routeTimer = 1000;
      vehicle.car.position.set(x, 0, z); vehicle.car.group.rotation.y = Math.atan2(-hz, hx);
      return;
    }
    start += segment.length;
  }
  assert.fail('El punto debe pertenecer al tramo recto');
}

test('los sentidos opuestos y los seguidores del mismo carril cruzan juntos con verde', () => {
  const east = new TrafficRoute(-30, 30, 3, 40, 3.2), west = new TrafficRoute(-30, 30, -40, -3, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [east, east, west], { carsPerRoute: 1, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  const node = { x0: -7, x1: 7, z0: -7, z1: 7 }; signals.nodes = [node];
  placeOnStraight(traffic.vehicles[0], -15, 3, 1, 0);
  placeOnStraight(traffic.vehicles[1], -24, 3, 1, 0);
  placeOnStraight(traffic.vehicles[2], 15, -3, -1, 0);
  traffic._coordinateIntersections();
  assert.equal(signals.reservations.get(node).owners.size, 3);
  let simultaneous = false;
  for (let frame = 0; frame < 100; frame++) {
    traffic.update(.1);
    const [leader, follower, opposite] = traffic.vehicles;
    const routeGap = (leader.distance - follower.distance + east.length) % east.length;
    assert.ok(routeGap >= leader.car.length + 1.8 - 1e-6);
    if (traffic._overlapsNode(leader.car, node) && traffic._overlapsNode(opposite.car, node)) simultaneous = true;
  }
  assert.ok(simultaneous, 'No debe esperar a que salga todo el carro del carril contrario');
  traffic.dispose();
});

test('los giros que cortan otra trayectoria esperan y luego despejan sin atascarse', () => {
  const turn = new TrafficRoute(-30, 3, -3, 40, 3.2), west = new TrafficRoute(-30, 30, -40, 3, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [turn, west], { carsPerRoute: 1, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  const node = { x0: -7, x1: 7, z0: -7, z1: 7 }; signals.nodes = [node];
  placeOnStraight(traffic.vehicles[0], -15, -3, 1, 0);
  placeOnStraight(traffic.vehicles[1], 15, 3, -1, 0);
  traffic._coordinateIntersections();
  assert.equal(signals.reservations.get(node).owners.size, 1);
  const entered = new Set(), cleared = new Set();
  for (let frame = 0; frame < 240; frame++) {
    traffic.update(.1);
    const claims = [...signals.reservations.get(node).owners.values()];
    // Dos pueden tener permiso a la vez solo si lo que le falta a cada uno ya no se corta con lo del otro.
    const pending = claim => claim.plan.points.slice(claim.from ?? 0);
    if (claims.length === 2) assert.ok(!pending(claims[0]).some(p => pending(claims[1]).some(q => Math.hypot(p.x - q.x, p.z - q.z) < (claims[0].plan.width + claims[1].plan.width) / 2 + .5)), 'No se conceden trayectorias que se cortan');
    assert.ok(claims.length <= 2);
    for (const vehicle of traffic.vehicles) {
      if (traffic._overlapsNode(vehicle.car, node)) entered.add(vehicle);
      else if (entered.has(vehicle)) cleared.add(vehicle);
    }
  }
  assert.equal(cleared.size, 2);
  traffic.dispose();
});

function poseCars(traffic, poses) {
  poses.forEach(({ x, z, hx, hz, length = 4.3, width = 1.76 }, index) => {
    const { car } = traffic.vehicles[index];
    car.length = length; car.width = width;
    car.position.set(x, 0, z); car.group.rotation.y = Math.atan2(-hz, hx);
  });
}

function probeFrom(traffic, index) {
  const { car } = traffic.vehicles[index], yaw = car.group.rotation.y;
  traffic._probePosition.copy(car.position);
  traffic._probeDirection.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

test('quien dobla no espera al que lo sigue aunque ya no vayan paralelos', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 40, 0, 40, 3.2)], { carsPerRoute: 2, random: () => .5 });
  poseCars(traffic, [{ x: .9, z: 1, hx: Math.SQRT1_2, hz: -Math.SQRT1_2 }, { x: 0, z: 5, hx: 0, hz: -1 }]);
  const [turning, follower] = traffic.vehicles;
  probeFrom(traffic, 0);
  assert.equal(traffic._carInPath(follower, turning.car), false);
  probeFrom(traffic, 1);
  assert.equal(traffic._carInPath(turning, follower.car), true, 'El de atrás sí espera al de adelante');
  traffic.dispose();
});

test('una buseta del carril contrario no frena a quien sale de la curva, y una en su camino sí', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 40, 0, 40, 3.2)], { carsPerRoute: 2, random: () => .5 });
  const turning = { x: 0, z: 0, hx: -.6, hz: -.8 }, bus = { hx: 0, hz: 1, length: 7.6, width: 2.3 };
  poseCars(traffic, [turning, { ...bus, x: -5.5, z: -2.5 }]);
  probeFrom(traffic, 0);
  assert.equal(traffic._carInPath(traffic.vehicles[1], traffic.vehicles[0].car), false);
  poseCars(traffic, [turning, { ...bus, x: -3, z: -4 }]);
  probeFrom(traffic, 0);
  assert.equal(traffic._carInPath(traffic.vehicles[1], traffic.vehicles[0].car), true);
  traffic.dispose();
});

test('en el cruce ancho del desvío solo se reserva lo que falta, y lo de la carrera vecina lo arbitra ella', () => {
  const routes = [new TrafficRoute(-60, 40, 3, 60, 3.2), new TrafficRoute(-30, 9, -40, 40, 3.2), new TrafficRoute(-60, -25, -40, 40, 3.2)];
  const traffic = new TrafficSystem(new THREE.Scene(), routes, { carsPerRoute: 1, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  const wide = { x0: -40, x1: 10, z0: -6, z1: 6 }, narrow = { x0: 6, x1: 18, z0: -6, z1: 6 };
  signals.nodes = [wide, narrow];
  const [along, neighbour, far] = traffic.vehicles;
  placeOnStraight(along, 0, 3, 1, 0);
  placeOnStraight(neighbour, 9, -15, 0, 1);
  placeOnStraight(far, -25, -15, 0, 1);
  const alongPlan = traffic._crossingPlan(along, wide), neighbourPlan = traffic._crossingPlan(neighbour, wide), farPlan = traffic._crossingPlan(far, wide);
  // Va por la carrera vecina: en el cruce ancho no tiene con quién cruzarse, pero conserva su eje.
  assert.equal(neighbourPlan.points.length, 0);
  assert.equal(neighbourPlan.axis, 1);
  assert.ok(alongPlan.points.at(-1).x < narrow.x0, 'Su trayectoria en el cruce ancho termina antes de la carrera');
  assert.equal(traffic._crossingPlan(along, narrow).points.some(point => point.x > narrow.x0), true, 'El cruce angosto sí la arbitra');
  // Ya pasó el punto donde se cortan: esperar un rojo más adelante no le estorba a quien cruza detrás.
  assert.equal(traffic._pathsConflict(farPlan, alongPlan), true);
  const claim = { entered: true, plan: alongPlan, from: traffic._planProgress(along.car, alongPlan) };
  assert.equal(traffic._claimConflict(farPlan, claim), false);
  placeOnStraight(along, -25, 3, 1, 0);
  claim.from = traffic._planProgress(along.car, alongPlan);
  assert.equal(traffic._claimConflict(farPlan, claim), true, 'Mientras lo tenga encima, sigue reservado');
  traffic.dispose();
});

test('la salida y el frenado son progresivos y el conductor tarda en reaccionar al despejarse', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 240, 0, 240, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0];
  placeOnStraight(vehicle, 10, 0, 1, 0);
  for (let frame = 0; frame < 80; frame++) {
    const acceleration = vehicle.acceleration;
    traffic.update(.05);
    assert.ok(Math.abs(vehicle.acceleration - acceleration) <= 3 * .05 + 1e-6);
    assert.ok(vehicle.acceleration <= vehicle.accelerationLimit + 1e-6);
  }
  const player = vehicle.car.position.clone().add(new THREE.Vector3(60, 0, 0));
  for (let frame = 0; frame < 500; frame++) {
    const acceleration = vehicle.acceleration;
    traffic.update(.05, { player });
    assert.ok(Math.abs(vehicle.acceleration - acceleration) <= 3 * .05 + 1e-6);
    assert.ok(vehicle.acceleration >= -vehicle.braking - 1e-6);
  }
  assert.equal(vehicle.speed, 0);
  const stopped = vehicle.distance;
  traffic.update(.1);
  assert.equal(vehicle.distance, stopped, 'La salida no es instantánea al quitar el obstáculo');
  for (let frame = 0; frame < 50; frame++) traffic.update(.05);
  assert.ok(vehicle.distance > stopped + 1);
  traffic.dispose();
});

test('un cruce repentino provoca atropello sin eliminar la velocidad de frenado', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 240, 0, 240, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0]; placeOnStraight(vehicle, 20, 0, 1, 0); vehicle.speed = 12;
  const player = new THREE.Vector3(20 + vehicle.car.length / 2 + .6, 0, 0), hits = [];
  const context = { player, onPlayerHit: hit => hits.push(hit) };
  traffic.update(.05, context);
  assert.ok(vehicle.speed >= 12 - vehicle.braking * .05, 'El peatón no puede frenar el carro en seco');
  assert.ok(vehicle.car.position.x > 20.5);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].speed > 11);
  assert.ok(hits[0].direction.x > .99);
  let stopped = false;
  for (let frame = 0; frame < 180; frame++) {
    traffic.update(.05, context);
    stopped ||= vehicle.speed === 0;
  }
  assert.equal(hits.length, 1, 'Un mismo contacto no aplica daño en cada cuadro');
  assert.ok(stopped, 'El conductor sigue frenando después del impacto hasta detenerse');
  traffic.dispose();
});

test('el carro consigue detenerse sin atropellar si ve al jugador con suficiente anticipación', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 240, 0, 240, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0]; placeOnStraight(vehicle, 20, 0, 1, 0); vehicle.speed = 12;
  const player = new THREE.Vector3(80, 0, 0), hits = [];
  for (let frame = 0; frame < 600; frame++) traffic.update(.05, { player, onPlayerHit: hit => hits.push(hit) });
  assert.equal(hits.length, 0);
  assert.equal(vehicle.speed, 0);
  assert.ok(player.x - vehicle.car.position.x >= vehicle.car.length / 2 + .4);
  traffic.dispose();
});

test('el volumen recorrido detecta atropellos en curvas sin dañar a quien está fuera de la calzada', () => {
  const route = new TrafficRoute(0, 40, 0, 40, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0]; vehicle.speed = 12;
  const player = new THREE.Vector3(), heading = new THREE.Vector3(), hits = [];
  const start = route.segments[0].length - 5;
  route.sample(start + 9, player, heading);
  traffic._checkPlayerImpact(vehicle, player, start, 18, hit => hits.push(hit));
  assert.equal(hits.length, 1, 'No puede saltarse al peatón entre los extremos del movimiento');
  vehicle.playerContact = false;
  player.set(20, 0, 5);
  traffic._checkPlayerImpact(vehicle, player, 10, 18, hit => hits.push(hit));
  assert.equal(hits.length, 1, 'Una persona lateral fuera de la carrocería no recibe daño');
  vehicle.speed = 0;
  route.sample(start, player, heading);
  traffic._checkPlayerImpact(vehicle, player, start, 0, hit => hits.push(hit));
  assert.equal(hits.length, 1, 'Un carro parado no atropella');
  traffic.dispose();
});

test('el bus comparte el cruce con carriles paralelos y espera las trayectorias que lo atraviesan', () => {
  const route = new TrafficRoute(-4, 30, -30, 30, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  const node = { x0: -7, x1: 7, z0: -7, z1: 7 }; signals.nodes = [node]; signals.update(25);
  const bus = { position: new THREE.Vector3(0, 0, 14), group: new THREE.Group(), length: 18.2, width: 2.52 };
  traffic.setBus(bus);
  const vehicle = traffic.vehicles[0];
  placeOnStraight(vehicle, -4, 15, 0, -1);
  traffic._coordinateIntersections();
  assert.ok(traffic._overlapsNode(bus, node, traffic.busVehicle.heading), 'El frente del bus ya está en el cruce');
  assert.equal(signals.reservations.get(node).owners.size, 1);
  assert.equal(signals.busClearance(bus.position, bus.length), Infinity);
  // Un carro que ya atravesaba la troncal conserva prioridad aunque cambie la luz.
  signals.reservations.clear();
  vehicle.route = new TrafficRoute(-30, 30, 3, 40, 3.2);
  placeOnStraight(vehicle, -2, 3, 1, 0);
  bus.position.z = 24;
  traffic._coordinateIntersections();
  assert.ok(Number.isFinite(signals.busClearance(bus.position, bus.length)));
  placeOnStraight(vehicle, 20, 3, 1, 0);
  traffic._coordinateIntersections();
  assert.equal(signals.busClearance(bus.position, bus.length), Infinity);
  traffic.dispose();
});

test('el bus con el frente ya dentro despeja el cruce; con el frente afuera espera en la línea', () => {
  const signals = new TrafficSignals();
  const node = { x0: -7, x1: 7, z0: -7, z1: 7 }, length = 18.2, half = length / 2;
  signals.nodes = [node];
  const at = (z, direction = -1) => signals.busClearance(new THREE.Vector3(0, 0, z), length, direction);
  const check = () => {
    // Rumbo −Z: el frente va en z − half y la línea queda .8 m antes del borde z1.
    assert.ok(Math.abs(at(node.z1 + half + .8 + 5) - 5) < 1e-9);
    assert.ok(at(node.z1 + half + .8) < 1e-9);
    assert.equal(at(node.z1 + half + .3), 0, 'Pasó un poco la línea, sin entrar: sigue esperando');
    assert.equal(at(node.z1 + half - .1), Infinity, 'Con el frente dentro no se queda atravesado');
    assert.equal(at(node.z1 + 1), Infinity);
    // Rumbo +Z, igual desde el otro borde.
    assert.ok(Math.abs(at(node.z0 - half - .8 - 5, 1) - 5) < 1e-9);
    assert.equal(at(node.z0 - half - .3, 1), 0);
    assert.equal(at(node.z0 - half + .1, 1), Infinity);
  };
  signals.update(0);
  assert.notEqual(signalState(signals.time, 1), 0, 'Rojo de su eje');
  check();
  // Con verde, lo mismo cuando alguien con reserva le corta el paso.
  signals.update(18);
  assert.equal(signalState(signals.time, 1), 0);
  assert.equal(at(node.z1 + half + 2), Infinity);
  signals.reservations.set(node, { busBlocked: true });
  check();
});

test('una patrulla que nace justo delante de una buseta no las deja esperándose en el cruce', () => {
  const scene = new THREE.Scene(), route = new TrafficRoute(-60, 60, 3, 60, 3.2);
  const traffic = new TrafficSystem(scene, [route], { carsPerRoute: 0, policeCount: 0, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  const node = { x0: -7, x1: 7, z0: -7, z1: 7 };
  signals.nodes = [node];
  // La flota sale por conteo: el duodécimo es buseta.
  traffic._spawnCount = 11;
  traffic._spawn(scene, route, 0, false);
  traffic._spawn(scene, route, 0, true);
  const [buseta, patrol] = traffic.vehicles;
  assert.equal(buseta.car.kind, 'buseta');
  placeOnStraight(buseta, -18, 3, 1, 0);
  placeOnStraight(patrol, -16, 3, 1, 0);
  // Cada plan empieza según la huella de su carro: el mismo carril da inicios a más de 1,2 m.
  const planA = traffic._crossingPlan(buseta, node), planB = traffic._crossingPlan(patrol, node);
  assert.ok(Math.hypot(planA.points[0].x - planB.points[0].x, planA.points[0].z - planB.points[0].z) > 1.2);
  assert.equal(traffic._pathsConflict(planA, planB), false);
  const entered = new Set(), cleared = new Set();
  for (let frame = 0; frame < 900 && cleared.size < 2; frame++) {
    signals.update(frame * .1);
    traffic.update(.1);
    for (const vehicle of traffic.vehicles) {
      if (traffic._overlapsNode(vehicle.car, node)) entered.add(vehicle);
      else if (entered.has(vehicle)) cleared.add(vehicle);
    }
  }
  assert.equal(cleared.size, 2, `Buseta en X ${buseta.car.position.x.toFixed(1)}, patrulla en X ${patrol.car.position.x.toFixed(1)}`);
  traffic.dispose();
});

// La patrulla que vuelve al carril no entra a las reservas hasta llegar: la cola del cruce la recibe de última.
for (const [label, sharedLane] of [['en la misma ruta', false], ['en otra ruta que comparte el carril', true]]) {
  test(`quien queda delante en el carril va primero en la cola del cruce, ${label}`, () => {
    const lane = new TrafficRoute(-30, 30, -40, 3, 3.2), turn = new TrafficRoute(-30, 3, -3, 40, 3.2);
    const routes = [lane, turn, sharedLane ? new TrafficRoute(-30, 40, -40, 3, 3.2) : lane];
    const traffic = new TrafficSystem(new THREE.Scene(), routes, { carsPerRoute: 1, random: () => .5 });
    const signals = traffic.signals = new TrafficSignals();
    const node = { x0: -7, x1: 7, z0: -7, z1: 7 }; signals.nodes = [node];
    const [behind, crossing, ahead] = traffic.vehicles;
    placeOnStraight(behind, 20, 3, -1, 0);
    placeOnStraight(crossing, -15, -3, 1, 0);
    placeOnStraight(ahead, 12, 3, -1, 0);
    signals.update(0);
    ahead.rejoinTarget = ahead.car.position.clone();
    traffic._coordinateIntersections();
    // Las comparaciones van por índice: el mensaje de error de dos carros enteros tarda minutos en armarse.
    const queue = () => signals.reservations.get(node).queue.map(vehicle => traffic.vehicles.indexOf(vehicle));
    assert.deepEqual(queue(), [0, 1]);
    ahead.rejoinTarget = null;
    traffic._coordinateIntersections();
    assert.equal(queue()[0], 2, 'Primero el de adelante');
    // Con la cola al revés nadie cede: el de atrás tiene la reserva y lo tapa el de adelante, que espera al que dobla,
    // y este espera la reserva del de atrás. Pasan los ciclos de semáforo y siguen ahí.
    const entered = new Set(), cleared = new Set();
    for (let frame = 0; frame < 1200 && cleared.size < 3; frame++) {
      signals.update(frame * .1);
      traffic.update(.1);
      for (const vehicle of traffic.vehicles) {
        if (traffic._overlapsNode(vehicle.car, node)) entered.add(vehicle);
        else if (entered.has(vehicle)) cleared.add(vehicle);
      }
    }
    assert.equal(cleared.size, 3, `Quedan en X ${traffic.vehicles.map(vehicle => vehicle.car.position.x.toFixed(1)).join(', ')}`);
    traffic.dispose();
  });
}

test('la cola solo reordena a quien va delante en el mismo carril', () => {
  const lane = new TrafficRoute(-30, 30, -40, 3, 3.2), other = new TrafficRoute(-30, 40, -40, 3, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [lane, other], { carsPerRoute: 1, random: () => .5 });
  const [a, b] = traffic.vehicles;
  placeOnStraight(a, 20, 3, -1, 0);
  placeOnStraight(b, 12, 3, -1, 0);
  assert.equal(traffic._aheadInLane(a, b), true);
  assert.equal(traffic._aheadInLane(b, a), false, 'No va delante quien viene detrás');
  b.car.position.z = 6;
  assert.equal(traffic._aheadInLane(a, b), false, 'El carril de al lado no cuenta');
  b.car.position.z = 3; b.car.group.rotation.y += Math.PI / 2;
  assert.equal(traffic._aheadInLane(a, b), false, 'Un rumbo cruzado no cuenta');
  traffic.dispose();
});

test('la patrulla que deja de perseguir dentro de un cruce vuelve a un punto fuera de él', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(-60, 60, 3, 60, 3.2)], { carsPerRoute: 0, policeCount: 1, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  const node = { x0: -7, x1: 7, z0: -7, z1: 7 }; signals.nodes = [node];
  traffic.setEnvironment({});
  const [patrol] = traffic.vehicles;
  traffic._startChase(patrol);
  patrol.car.position.set(-2, 0, 1);
  traffic.endPursuit();
  assert.equal(patrol.state, 'patrol');
  assert.ok(patrol.rejoinTarget, 'Vuelve manejando');
  assert.equal(patrol.rejoinTarget.z, 3, 'A su carril');
  assert.ok(patrol.rejoinTarget.x >= node.x1 + 4, `Vuelve en X ${patrol.rejoinTarget.x}`);
  assert.ok(patrol.rejoinTarget.x < node.x1 + 8, 'Justo adelante, sin saltarse media ruta');
  const expected = new THREE.Vector3();
  patrol.route.sample(patrol.distance, expected, new THREE.Vector3());
  assert.ok(expected.distanceTo(patrol.rejoinTarget) < 1e-9, 'Su distancia en la ruta es la del punto de regreso');
  traffic.dispose();
});

test('un regreso que lleva 6 s sin avanzar entra a su carril en un punto sin cruce ni vehículos cerca', () => {
  const scene = new THREE.Scene(), route = new TrafficRoute(-100, 100, 3, 60, 3.2);
  const traffic = new TrafficSystem(scene, [route], { carsPerRoute: 1, policeCount: 1, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  // Desde el punto de regreso, X −30, cada estorbo aleja el siguiente punto libre: el parqueado hasta X −21, el cruce
  // hasta X −1 y el carro detenido hasta X 12.
  signals.nodes = [{ x0: -20, x1: -5, z0: -9, z1: 9 }];
  const parked = new Car(scene, new THREE.Vector3(-28, 0, 7));
  traffic.setParkedCars([parked]);
  const [waiting, patrol] = traffic.vehicles;
  placeOnStraight(waiting, 3, 3, 1, 0);
  waiting.hold = true;
  // Una caja lo encierra del todo: no hay rumbo posible y no se mueve de ahí.
  const wall = new THREE.Box3(new THREE.Vector3(-50, -1, -20), new THREE.Vector3(-10, 5, 1));
  traffic.setEnvironment({ collisions: { colliders: [{ box: wall }] }, getGroundHeight: () => 0 });
  traffic._startChase(patrol);
  patrol.car.position.set(-30, 0, -2);
  traffic.endPursuit();
  assert.ok(patrol.rejoinTarget, 'Vuelve manejando');
  const trapped = patrol.car.position.clone();
  for (let frame = 0; frame < 58; frame++) traffic.update(.1);
  assert.ok(patrol.rejoinTarget, 'Antes del tope sigue intentando');
  assert.ok(patrol.car.position.distanceTo(trapped) < 1e-9);
  for (let frame = 0; frame < 4; frame++) traffic.update(.1);
  assert.equal(patrol.rejoinTarget, null, 'Con el tope deja de manejar a ojo');
  const { x, z } = patrol.car.position;
  assert.equal(z, 3, 'Sobre su carril');
  assert.ok(x >= 12, `Entra en X ${x}`);
  assert.ok(x < 20, 'En el primer punto libre, no al otro lado de la ciudad');
  assert.ok(Math.abs(patrol.car.group.rotation.y) < 1e-9, 'Con el rumbo del carril');
  assert.equal(patrol.speed, 0);
  // Y desde ahí sigue como un carro más.
  const lane = patrol.distance;
  for (let frame = 0; frame < 30; frame++) traffic.update(.1);
  assert.ok(patrol.distance > lane + 5, 'Arranca por su ruta');
  assert.ok(patrol.car.position.distanceTo(waiting.car.position) > 9);
  traffic.dispose(); parked.dispose();
});

test('sin ningún punto libre en la ruta sigue esperando y no cae encima de otro', () => {
  const scene = new THREE.Scene(), route = new TrafficRoute(-30, 30, 3, 30, 3.2);
  const traffic = new TrafficSystem(scene, [route], { carsPerRoute: 0, policeCount: 1, random: () => .5 });
  const signals = traffic.signals = new TrafficSignals();
  signals.nodes = [{ x0: -60, x1: 60, z0: -60, z1: 60 }];
  const [patrol] = traffic.vehicles;
  const wall = new THREE.Box3(new THREE.Vector3(-90, -1, -90), new THREE.Vector3(90, 5, 90));
  traffic.setEnvironment({ collisions: { colliders: [{ box: wall }] }, getGroundHeight: () => 0 });
  traffic._startChase(patrol);
  patrol.car.position.set(0, 0, -1);
  traffic.endPursuit();
  const trapped = patrol.car.position.clone();
  for (let frame = 0; frame < 100; frame++) traffic.update(.1);
  assert.ok(patrol.rejoinTarget, 'Sigue de regreso');
  assert.ok(patrol.car.position.distanceTo(trapped) < 1e-9);
  traffic.dispose();
});

test('un regreso largo que sí avanza no salta aunque pase de 6 s', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(-200, 200, 3, 200, 3.2)], { carsPerRoute: 0, policeCount: 1, random: () => .5 });
  traffic.setEnvironment({ getGroundHeight: () => 0 });
  const [patrol] = traffic.vehicles;
  traffic._startChase(patrol);
  patrol.car.position.set(0, 0, 90);
  traffic.endPursuit();
  assert.ok(patrol.rejoinTarget);
  let seconds = 0;
  while (patrol.rejoinTarget && seconds < 30) {
    const before = patrol.car.position.clone();
    traffic.update(.1);
    seconds += .1;
    assert.ok(patrol.car.position.distanceTo(before) <= 7.5 * .1 + 1e-6, 'Sin saltos');
  }
  assert.equal(patrol.rejoinTarget, null);
  assert.ok(seconds > 8, `Llegó en ${seconds.toFixed(1)} s`);
  assert.equal(patrol.car.position.z, 3);
  traffic.dispose();
});

test('la misma entrada se mide de lado: un carril paralelo o una trayectoria que corta siguen siendo otra cosa', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 40, 0, 40)], { carsPerRoute: 0, policeCount: 0 });
  const straight = (x, z, length) => ({ width: 1.8, hx: 1, hz: 0, points: Array.from({ length }, (_, i) => ({ x: x + i * .75, z })) });
  // Mismo carril con inicios distintos: se siguen.
  assert.equal(traffic._pathsConflict(straight(0, 0, 20), straight(2, 0, 20)), false);
  // Carril de al lado, con holgura: no se tocan.
  assert.equal(traffic._pathsConflict(straight(0, 0, 20), straight(0, 3, 20)), false);
  // Carril de al lado que dobla sobre el primero: se cortan aunque ambos entren con el mismo rumbo.
  const turning = straight(0, 3, 8);
  for (let i = 1; i <= 8; i++) turning.points.push({ x: 5.25, z: 3 - i * .75 });
  assert.equal(traffic._pathsConflict(straight(0, 0, 20), turning), true);
  traffic.dispose();
});

test('con el empuje real ningún puesto de parqueo frena a la buseta en su carril', () => {
  const city = new Bogota();
  city.map = city._layout();
  const spots = city.getParkingSpots(), routes = city.getTrafficRoutes();
  assert.ok(spots.length > 1000);
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 40, 0, 40)], { carsPerRoute: 0, policeCount: 0 });
  // Los carriles, por celdas, para no comparar cada puesto con toda la red.
  const CELL = 12, cells = new Map(), point = new THREE.Vector3(), direction = new THREE.Vector3();
  for (const route of [...routes, ...routes.alternatives]) {
    for (let distance = 0; distance < route.length; distance++) {
      route.sample(distance, point, direction);
      const key = `${Math.floor(point.x / CELL)},${Math.floor(point.z / CELL)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ x: point.x, z: point.z, dx: direction.x, dz: direction.z });
    }
  }
  const buseta = CAR_MODELS.buseta;
  const parkedModels = [...new Set([...PRIVATE_MIX.map(([id]) => id), 'citadino', 'sedanPopular'])];
  const self = { position: new THREE.Vector3(), group: { rotation: { y: 0 } }, length: buseta.L, width: buseta.W };
  let alongside = 0;
  for (const spot of spots) {
    for (const id of parkedModels) {
      const { W, L } = CAR_MODELS[id], offset = parkedCarOffset(spot, W);
      const parked = { car: { position: new THREE.Vector3(spot.x + offset.x, 0, spot.z + offset.z), width: W, length: L, group: { rotation: { y: spot.rot } } } };
      const cx = Math.floor(parked.car.position.x / CELL), cz = Math.floor(parked.car.position.z / CELL);
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) {
        for (const lane of cells.get(`${a},${b}`) ?? []) {
          // El carro va un metro antes del punto que explora, y a ese punto llega su frenado.
          traffic._probePosition.set(lane.x, 0, lane.z);
          traffic._probeDirection.set(lane.dx, 0, lane.dz);
          self.position.set(lane.x - lane.dx, 0, lane.z - lane.dz);
          self.group.rotation.y = Math.atan2(-lane.dz, lane.dx);
          assert.ok(!traffic._carInPath(parked, self), `${id} en ${spot.x},${spot.z} frena a la buseta en ${lane.x.toFixed(1)},${lane.z.toFixed(1)}`);
          if (Math.hypot(lane.x - parked.car.position.x, lane.z - parked.car.position.z) < 3) alongside++;
        }
      }
    }
  }
  assert.ok(alongside > 1000, `${alongside} carriles junto a un puesto`);
  traffic.dispose();
});

test('el empuje aparta del andén lo que cabe; el carro más ancho pisa como mucho 20 cm de sardinel', () => {
  const MARK_TO_CURB = .6;
  const parkedModels = [...new Set([...PRIVATE_MIX.map(([id]) => id), 'citadino', 'sedanPopular'])];
  assert.ok(parkedModels.some(id => CAR_MODELS[id].W >= 1.85));
  for (const id of parkedModels) {
    const { W } = CAR_MODELS[id], shift = parkedCarShift(W);
    assert.ok(shift >= 0 && shift <= .425, `${id}: ${shift}`);
    assert.ok(W / 2 - shift - MARK_TO_CURB <= .2 + 1e-9, `${id} pisa ${(W / 2 - shift - MARK_TO_CURB).toFixed(2)} m`);
  }
  // Siempre hacia afuera del andén, que es el lado al que la marca está corrida.
  assert.ok(parkedCarOffset({ x: 10.4, z: 30, rot: Math.PI / 2 }, 1.6).x < 0);
  assert.ok(parkedCarOffset({ x: 9.6, z: 30, rot: Math.PI / 2 }, 1.6).x > 0);
  assert.ok(parkedCarOffset({ x: 10, z: 30.4, rot: 0 }, 1.6).z < 0);
  assert.ok(parkedCarOffset({ x: 10, z: 29.6, rot: 0 }, 1.6).z > 0);
  assert.deepEqual(parkedCarOffset({ x: 10, z: 30.4, rot: 0 }, 1.6), { x: 0, z: -parkedCarShift(1.6) });
});

test('el tráfico acelera hasta la nueva velocidad en una recta libre', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 240, 0, 240, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0];
  placeOnStraight(vehicle, 15, 0, 1, 0);
  for (let frame = 0; frame < 120; frame++) traffic.update(.1);
  assert.ok(vehicle.speed > 11.9 && vehicle.speed <= 12);
  traffic.dispose();
});

test('las redes del centro y del oriente no comparten carril', () => {
  const all = new Bogota().getTrafficRoutes();
  const isEast = route => Number(route.key.split(':')[0]) >= 240;
  const networks = [false, true].map(east => {
    const routes = all.filter(route => isEast(route) === east);
    routes.alternatives = all.alternatives.filter(route => isEast(route) === east);
    return routes;
  });
  assert.deepEqual(networks.map(routes => routes.length), [6, 2]);
  assert.ok(networks[0].alternatives.every(route => Number(route.key.split(':')[1]) < 240));
});

/** Monta el tráfico como Game al poblar Bogotá, con el azar sembrado, y lo corre con city.update como Game._loop. */
async function runLikeTheGame(randomSeed, minutes, { chases = false } = {}) {
  const original = Math.random;
  let state = Math.imul(randomSeed + 1, 2654435761) >>> 0;
  Math.random = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    const scene = new THREE.Scene(), collisions = new CollisionSystem(), city = new Bogota();
    city.build(scene, collisions);
    await Promise.all(city.npcs.map(npc => npc.ready));
    const parking = city.getParkingSpots();
    for (let i = parking.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [parking[i], parking[j]] = [parking[j], parking[i]];
    }
    const placed = [], parked = [];
    for (let i = 0; i < Math.round(5 * city.populationScale); i++) {
      const spot = parking.find(p => placed.every(q => Math.hypot(p.x - q.x, p.z - q.z) > 8));
      if (!spot) break;
      placed.push(spot);
      const car = new Car(scene, new THREE.Vector3(spot.x, 0, spot.z), spot.rot);
      const offset = parkedCarOffset(spot, car.width);
      car.position.x += offset.x; car.position.z += offset.z;
      parked.push(car);
    }
    const traffic = new TrafficSystem(scene, city.getTrafficRoutes(), { policeCount: 2 });
    traffic.setParkedCars(parked);
    traffic.signals = city.signals;
    traffic.setBus(city.busServices);
    const pedestrians = [...city.npcs, { position: new THREE.Vector3(city.reserved.bed.x + 2, 0, city.reserved.bed.z + 3) }];
    const player = new THREE.Vector3(112.98, 0, 97.84);
    const stoppedFor = new Map(), travel = new Map();
    let worst = { seconds: 0 };
    // El jugador aparece junto a una patrulla y corre por la calle; al acabar la persecución vuelve al inicio.
    let chasing = false, nextChase = 20, started = 0, heading = [1, 0], time = 0;
    const patrols = traffic.vehicles.filter(vehicle => vehicle.police), moved = new THREE.Vector3(), step = new THREE.Vector3();
    if (chases) {
      traffic.setEnvironment({ collisions, getGroundHeight: (x, z, y) => city.getMovementGroundHeight(x, z, y), getWaterInfo: (x, z) => city.getWaterInfo(x, z) });
      const finish = () => { chasing = false; nextChase = time + 30; traffic.endPursuit(); player.set(112.98, 0, 97.84); };
      window.addEventListener('police-arrest', finish);
      window.addEventListener('police-escaped', finish);
    }
    for (let frame = 0; frame < minutes * 600; frame++) {
      time = frame * .1;
      if (chases) {
        if (!chasing && time >= nextChase) {
          const patrol = patrols[started++ % patrols.length], { x, z } = patrol.car.position;
          player.set(x + 6, city.getGroundHeight(x + 6, z), z);
          traffic._startChase(patrol);
          chasing = true;
          heading = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
        }
        if (chasing) {
          collisions.resolveMove(player, step.set(heading[0] * .5, 0, heading[1] * .5), .35, moved);
          if (moved.distanceTo(player) > .25 && city.isWalkableAt(moved.x, moved.z)) player.set(moved.x, city.getGroundHeight(moved.x, moved.z), moved.z);
          else heading = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
        }
        collisions.setVehicles([...parked, ...traffic.vehicles.map(vehicle => vehicle.car)], city.busServices);
      }
      city.update(.1, player, null, traffic.vehicles);
      traffic.update(.1, { player, pedestrians });
      for (const vehicle of traffic.vehicles) {
        travel.set(vehicle, (travel.get(vehicle) ?? 0) + vehicle.speed * .1);
        const seconds = vehicle.speed < .05 ? (stoppedFor.get(vehicle) ?? 0) + .1 : 0;
        stoppedFor.set(vehicle, seconds);
        if (seconds > worst.seconds) worst = { seconds, kind: vehicle.car.kind, x: vehicle.car.position.x, z: vehicle.car.position.z };
      }
    }
    const shortest = Math.min(...traffic.vehicles.map(vehicle => travel.get(vehicle)));
    city.dispose(scene);
    return { parked: parked.length, npcs: city.npcs.length, vehicles: traffic.vehicles.length, worst, shortest, chases: started };
  } finally {
    Math.random = original;
  }
}

// Cinco minutos por semilla para no alargar la suite. Los atascos de la flota se cierran antes: con el vendedor en la
// calzada o el empuje sin límite ya hay quien lleva más de 200 s a esa altura. El tope sale de medir 48 semillas de
// diez minutos en este montaje (peor tiempo, entre 110 y 114 s): a 200 s solo llega un bloqueo.
for (const seed of [1, 3, 11, 22, 29]) {
  test(`una sola flota con parqueados y NPC circula sin bloqueos, semilla ${seed}`, async () => {
    const { parked, npcs, vehicles, worst, shortest } = await runLikeTheGame(seed, 5);
    assert.equal(parked, 23);
    assert.ok(npcs >= 80, `${npcs} NPC`);
    assert.equal(vehicles, 34);
    assert.ok(worst.seconds < 200, `${worst.kind} parado ${worst.seconds.toFixed(0)} s en ${worst.x?.toFixed(1)},${worst.z?.toFixed(1)}`);
    assert.ok(shortest > 300, `El que menos anduvo recorrió ${shortest.toFixed(0)} m`);
  });
}

// Las persecuciones repetidas son donde la patrulla se trababa al volver al carril y dejaba la red atascada. En esta
// semilla, sin los arreglos, a los cinco minutos hay quien lleva más de 200 s parado; con ellos, en 72 semillas de diez
// minutos nadie pasa de 159 s, y en 60 de cinco el que menos anda recorre 432 m.
test('con persecuciones repetidas la patrulla vuelve a su carril y el tráfico no se traba', async () => {
  const { worst, shortest, chases } = await runLikeTheGame(55, 5, { chases: true });
  assert.ok(chases >= 5, `${chases} persecuciones`);
  assert.ok(worst.seconds < 200, `${worst.kind} parado ${worst.seconds.toFixed(0)} s en ${worst.x?.toFixed(1)},${worst.z?.toFixed(1)}`);
  assert.ok(shortest > 300, `El que menos anduvo recorrió ${shortest.toFixed(0)} m`);
});

test('la patrulla conserva su carrocería con luces al precargar modelos', async () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 40, 0, 40)], { carsPerRoute: 0, policeCount: 1, random: () => 0.3 });
  const { car } = traffic.vehicles[0];
  await car.preloadModel();
  assert.ok(car.vehicle.policeLights);
  assert.equal(car.importedModel, undefined);
  traffic.dispose();
});

/** Patrulla encerrada de regreso a su carril: no hay rumbo posible y solo el tope la saca de ahí. */
function trappedPatrol() {
  const scene = new THREE.Scene(), route = new TrafficRoute(-100, 100, 3, 60, 3.2);
  const traffic = new TrafficSystem(scene, [route], { carsPerRoute: 0, policeCount: 1, random: () => .5 });
  const [patrol] = traffic.vehicles;
  const wall = new THREE.Box3(new THREE.Vector3(-50, -1, -20), new THREE.Vector3(-10, 5, 1));
  traffic.setEnvironment({ collisions: { colliders: [{ box: wall }] }, getGroundHeight: () => 0 });
  traffic._startChase(patrol);
  patrol.car.position.set(-30, 0, -2);
  traffic.endPursuit();
  assert.ok(patrol.rejoinTarget);
  return { traffic, patrol };
}

test('a la vista del jugador la patrulla trabada no se esfuma enseguida, pero tampoco se queda para siempre', () => {
  const { traffic, patrol } = trappedPatrol();
  const player = new THREE.Vector3(-30, 0, -32);
  const trapped = patrol.car.position.clone();
  for (let frame = 0; frame < 290; frame++) traffic.update(.1, { player });
  assert.ok(patrol.rejoinTarget, 'A 30 m del jugador sigue intentando a los 29 s');
  assert.ok(patrol.car.position.distanceTo(trapped) < 1e-9);
  for (let frame = 0; frame < 15; frame++) traffic.update(.1, { player });
  assert.equal(patrol.rejoinTarget, null, 'Pasado el tope entra igual');
  assert.equal(patrol.car.position.z, 3, 'Sobre su carril');
});

test('lejos del jugador entra a los 6 s, y en un punto fuera de su vista', () => {
  const { traffic, patrol } = trappedPatrol();
  // A 50 m del origen, de pie justo donde estaría el primer punto libre de la ruta.
  const player = new THREE.Vector3(-30, 0, 48);
  const first = trappedPatrol();
  for (let frame = 0; frame < 65; frame++) first.traffic.update(.1);
  assert.equal(first.patrol.rejoinTarget, null);
  player.x = first.patrol.car.position.x; player.z = first.patrol.car.position.z + 45;
  for (let frame = 0; frame < 65; frame++) traffic.update(.1, { player });
  assert.equal(patrol.rejoinTarget, null, 'Lejos no espera más que los 6 s');
  const { x, z } = patrol.car.position;
  assert.ok(Math.hypot(x - player.x, z - player.z) >= 40, `Cae a ${Math.hypot(x - player.x, z - player.z)} m`);
});

test('con un bus parado contra ella la patrulla no aguanta los 30 s, aunque el jugador la vea', () => {
  const player = new THREE.Vector3(-30, 0, -32);
  const withBus = bus => {
    const trapped = trappedPatrol();
    trapped.traffic.setBus({ group: { visible: true }, position: new THREE.Vector3(-30, 0, -8), length: 18, width: 2.6, speed: 0, ...bus });
    for (let frame = 0; frame < 65; frame++) trapped.traffic.update(.1, { player });
    return trapped.patrol;
  };
  assert.equal(withBus({}).rejoinTarget, null, 'El bus parado adelanta el salto');
  assert.ok(withBus({ speed: 5 }).rejoinTarget, 'Un bus que sigue andando no le estorba');
  assert.ok(withBus({ position: new THREE.Vector3(-30, 6, -8) }).rejoinTarget, 'Ni uno que para en otro nivel');
  assert.ok(withBus({ position: new THREE.Vector3(-30, 0, -40) }).rejoinTarget, 'Ni uno que para lejos');
});

test('la patrulla no entra encima de una persona', () => {
  const { traffic: free, patrol: freePatrol } = trappedPatrol();
  for (let frame = 0; frame < 65; frame++) free.update(.1);
  const spot = freePatrol.car.position.clone();
  const { traffic, patrol } = trappedPatrol();
  const pedestrians = [{ position: spot }];
  for (let frame = 0; frame < 65; frame++) traffic.update(.1, { pedestrians });
  assert.equal(patrol.rejoinTarget, null);
  assert.ok(patrol.car.position.distanceTo(spot) >= 4, `A ${patrol.car.position.distanceTo(spot)} m del peatón`);
});

test('ningún puesto de parqueo deja el carro con la carrocería sobre el pasto', () => {
  const city = new Bogota();
  city.map = city._layout();
  const spots = city.getParkingSpots();
  assert.ok(spots.length > 1000, `${spots.length} puestos`);
  const tile = (x, z) => city.map[Math.round(z / 2)]?.[Math.round(x / 2)];
  for (const { x, z, rot } of spots) {
    const [ax, az] = rot ? [0, 1] : [1, 0];
    for (const along of [-2.7, 2.7]) for (const across of [-1.15, 1.15]) {
      const ground = tile(x + ax * along + az * across, z + az * along + ax * across);
      assert.ok(ground === 'road' || ground === 'sidewalk', `(${x}; ${z}) pisa ${ground}`);
    }
  }
  assert.ok(!spots.some(spot => spot.z === 220 && [13.6, 24.4, 121.6, 132.4, 167.6, 178.4, 211.6, 222.4].includes(spot.x)), 'Los culs-de-sac de Z 220');
});
