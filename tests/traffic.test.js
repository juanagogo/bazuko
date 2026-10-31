import { CALLES } from '../src/world/bogota/StreetLayout.js';
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';

// Usa los carros reales, sustituyendo solo las texturas de Canvas por texturas vacías.
mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');
const { Car } = await import('../src/entities/Car.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { TrafficSignals } = await import('../src/world/bogota/TrafficSignals.js');
const { BusService } = await import('../src/world/bogota/BusService.js');

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
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 1 });
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
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(14, 44, 26, 60)], { random: () => 0.7 });
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
    const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 240, 0, 240)], { carsPerRoute: 1, random: () => 0.5 });
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
  first.vehicle.wheels[0].geometry.addEventListener('dispose', () => { sharedDisposed = true; });
  first.vehicle.group.children[0].geometry.addEventListener('dispose', () => { bodyDisposed = true; });
  first.dispose();
  assert.equal(sharedDisposed, false);
  assert.equal(bodyDisposed, true);
  assert.ok(scene.children.includes(second.group));
  assert.equal(second.marker.visible, true);
  assert.ok(second.steal());
  second.dispose();
});

test('las alternativas aleatorias mantienen toda la carrocería en calles y cruces transitables', () => {
  const city = new Bogota(), map = city._layout();
  const routes = city.getTrafficRoutes();
  assert.equal(routes.length, 6);
  assert.equal(routes.alternatives.length, 75);
  const position = new THREE.Vector3(), direction = new THREE.Vector3();
  for (const route of routes.alternatives) for (let distance = 0; distance < route.length; distance += .5) {
    route.sample(distance, position, direction);
    for (const front of [-2.15, 2.15]) for (const side of [-.88, .88]) {
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
  assert.equal(traffic.vehicles.length, 24);
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
    assert.ok(claims.length <= 1, 'No se conceden trayectorias que se cortan');
    for (const vehicle of traffic.vehicles) {
      if (traffic._overlapsNode(vehicle.car, node)) entered.add(vehicle);
      else if (entered.has(vehicle)) cleared.add(vehicle);
    }
  }
  assert.equal(cleared.size, 2);
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

test('el contacto al frenar a baja velocidad también registra el atropello', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 240, 0, 240, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0], direction = new THREE.Vector3();
  placeOnStraight(vehicle, 20, 0, 1, 0);
  vehicle.speed = 0.8;
  vehicle.route.sample(vehicle.distance, vehicle.car.position, direction);
  const player = vehicle.car.position.clone().addScaledVector(direction, vehicle.car.length / 2 + 0.55);
  const hits = [];

  traffic._checkPlayerImpact(vehicle, player, vehicle.distance, 0.02, hit => hits.push(hit));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].speed, 0.8);
  assert.ok(vehicle.impactStop);
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

test('el tráfico acelera hasta la nueva velocidad en una recta libre', () => {
  const traffic = new TrafficSystem(new THREE.Scene(), [new TrafficRoute(0, 240, 0, 240, 3.2)], { carsPerRoute: 1, random: () => .5 });
  const vehicle = traffic.vehicles[0];
  placeOnStraight(vehicle, 15, 0, 1, 0);
  for (let frame = 0; frame < 120; frame++) traffic.update(.1);
  assert.ok(vehicle.speed > 11.9 && vehicle.speed <= 12);
  traffic.dispose();
});

test('los 24 carros siguen circulando durante diez minutos sin bloqueos permanentes', () => {
  let seed = 12345;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const traffic = new TrafficSystem(new THREE.Scene(), new Bogota().getTrafficRoutes(), { random });
  const signals = traffic.signals = new TrafficSignals();
  const travel = traffic.vehicles.map(() => 0), stoppedFor = travel.slice();
  for (let frame = 0; frame < 6000; frame++) {
    signals.update(frame * .1); traffic.update(.1);
    traffic.vehicles.forEach((vehicle, index) => {
      travel[index] += vehicle.speed * .1;
      stoppedFor[index] = vehicle.speed < .05 ? stoppedFor[index] + .1 : 0;
      assert.ok(stoppedFor[index] < 48, 'No debe permanecer bloqueado durante más de 48 segundos');
    });
  }
  assert.ok(travel.every(distance => distance > 500));
  traffic.dispose();
});
