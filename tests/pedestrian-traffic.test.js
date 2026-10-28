import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { VehicleAudio } from '../src/systems/VehicleAudio.js';
import { planDetour } from '../src/systems/TrafficDetour.js';
import { hornReason } from '../src/systems/HornBehavior.js';
import * as textures from '../src/world/bogota/textures.js';
import { TrafficRoute } from '../src/world/bogota/TrafficRoute.js';
import { BusService } from '../src/world/bogota/BusService.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
mock.module('../src/world/bogota/textures.js', { namedExports: { ...textures, radialSprite: () => new THREE.Texture() } });
const { TrafficSystem } = await import('../src/systems/TrafficSystem.js');

let nextId = 0;
class FakeHowl {
  constructor() { this.voices = new Map(); this.starts = 0; }
  state() { return 'loaded'; }
  play(sprite) {
    if (typeof sprite === 'number') return sprite;
    const id = ++nextId;
    this.voices.set(id, { playing: true, sprite }); this.starts++; return id;
  }
  playing(id) { return this.voices.get(id)?.playing; }
  pause(id) { this.voices.get(id).playing = false; }
  stop(id) { const voice = this.voices.get(id); if (voice) voice.playing = false; }
  volume() {} rate() {} seek() {}
  duration() { return 7.8; }
}
const bank = () => Object.fromEntries(['carIdle', 'carDrive', 'busIdle', 'busDrive', 'horn1', 'horn2', 'horn3'].map(key => [key, new FakeHowl()]));

/** Recta de 230 m hacia +X en Z 0; el carril izquierdo queda hacia −Z. */
function street({ cars = 1, random = () => .5, isDrivable } = {}) {
  const route = new TrafficRoute(0, 240, 0, 240, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: cars, random });
  if (isDrivable) traffic.setStreetQueries({ isDrivable });
  return { route, traffic };
}
function place(vehicle, x) {
  vehicle.distance = x - 3.2; vehicle.routeTimer = 1e9; vehicle.speed = 0;
  vehicle.route.sample(vehicle.distance, vehicle.car.position, new THREE.Vector3());
  vehicle.car.group.rotation.y = 0;
}
// Separación entre la carrocería y una persona; negativa si la atraviesa.
function gap(vehicle, person) {
  const { car } = vehicle, hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
  const dx = person.x - car.position.x, dz = person.z - car.position.z;
  return Math.max(Math.abs(dx * hx + dz * hz) - car.length / 2, Math.abs(-dx * hz + dz * hx) - car.width / 2);
}
const hornStarts = sounds => sounds.horn1.starts + sounds.horn2.starts + sounds.horn3.starts;

test('con vía libre, quien se planta frente al carro recibe pitadas insistentes y luego es rodeado sin contacto', () => {
  const { traffic } = street(), vehicle = traffic.vehicles[0];
  place(vehicle, 20);
  const player = new THREE.Vector3(45, 0, 0), sounds = bank(), audio = new VehicleAudio(sounds, () => .5);
  let minimumGap = Infinity, honksBeforeDetour = 0, maxLateral = 0, detoured = false, maxYaw = 0;
  for (let frame = 0; frame < 1200; frame++) {
    traffic.update(.05, { player });
    audio.update(.05, player, traffic.vehicles);
    minimumGap = Math.min(minimumGap, gap(vehicle, player));
    if (vehicle.detour) {
      detoured = true;
      maxLateral = Math.max(maxLateral, Math.abs(vehicle.car.position.z));
      maxYaw = Math.max(maxYaw, Math.abs(vehicle.car.group.rotation.y));
    }
    else if (!detoured) honksBeforeDetour = hornStarts(sounds);
  }
  assert.ok(detoured, 'Tras esperar según su paciencia, el conductor rodea a la persona');
  assert.ok(honksBeforeDetour >= 2, `Antes de rodear insiste con el claxon: ${honksBeforeDetour}`);
  assert.ok(minimumGap > .35, `Nunca toca a la persona: ${minimumGap.toFixed(2)} m`);
  assert.ok(maxLateral > 1.5 && maxLateral < 2.3, 'Se desplaza lo justo dentro de la calzada');
  assert.ok(maxYaw < .65, 'El giro es progresivo, sin maniobras imposibles');
  assert.ok(vehicle.car.position.x > player.x + 10 || vehicle.car.position.z > 1, 'Sigue su camino');
  assert.equal(vehicle.detour, null);
  traffic.dispose();
});

test('sin espacio para rodear el conductor sigue esperando y protestando, sin invadir ni tocar a nadie', () => {
  // Calzada estrecha: ningún desplazamiento lateral cabe.
  const { traffic } = street({ isDrivable: (_x, z) => Math.abs(z) < 1.3 }), vehicle = traffic.vehicles[0];
  place(vehicle, 20);
  const player = new THREE.Vector3(45, 0, 0), sounds = bank(), audio = new VehicleAudio(sounds, () => .5);
  for (let frame = 0; frame < 1600; frame++) {
    traffic.update(.05, { player });
    audio.update(.05, player, traffic.vehicles);
    assert.equal(vehicle.detour, null);
  }
  assert.equal(vehicle.speed, 0);
  assert.ok(gap(vehicle, player) > 1);
  assert.ok(hornStarts(sounds) >= 6, 'Después de 80 s sigue recordando que espera');
  traffic.dispose();
});

test('un vehículo que viene de frente impide el rodeo hasta que pasa', () => {
  const sample = (s, position, direction) => { position.x = 20 + s; position.z = 0; direction.x = 1; direction.z = 0; };
  const car = { length: 4.3, width: 1.8 }, person = { x: 26.5, z: 0 };
  assert.ok(planDetour({ sample, car, person }));
  const oncoming = { x: 70, z: -2.5, hx: -1, hz: 0, length: 4.3, width: 1.8, speed: 10 };
  const both = { x: 30, z: 2.5, hx: -1, hz: 0, length: 4.3, width: 1.8, speed: 0 };
  assert.equal(planDetour({ sample, car, person, others: [oncoming, both] }), null, 'Ninguna alternativa es segura');
  const passed = { ...oncoming, x: 5 };
  assert.ok(planDetour({ sample, car, person, others: [passed, both] }), 'Ya pasó: el lado izquierdo queda libre');
  // Si la calzada no alcanza por la izquierda, rodea por la derecha cuando sí cabe.
  // Al girar, la cola de la carrocería barre hacia el lado contrario: también debe caber.
  const right = planDetour({ sample, car, person, isDrivable: (_x, z) => z > -2.2 && z < 4 });
  assert.ok(right.offset < 0);
});

test('con la persona pegada al parachoques retrocede un poco antes de rodear', () => {
  const { traffic } = street(), vehicle = traffic.vehicles[0];
  place(vehicle, 40);
  const player = new THREE.Vector3(40 + vehicle.car.length / 2 + .9, 0, 0);
  let reversed = false, minimumGap = Infinity, backmost = Infinity;
  for (let frame = 0; frame < 900; frame++) {
    traffic.update(.05, { player });
    reversed ||= vehicle.detour?.phase === 'reverse';
    minimumGap = Math.min(minimumGap, gap(vehicle, player));
    backmost = Math.min(backmost, vehicle.car.position.x);
  }
  assert.ok(reversed, 'Sin espacio para girar, primero retrocede');
  assert.ok(backmost > 40 - 3.1, 'El retroceso es corto');
  assert.ok(vehicle.car.position.x > player.x + 5, 'Luego rodea y sigue');
  assert.ok(minimumGap > .3);
  traffic.dispose();
});

test('con la persona pegada a la trompa y otro carro detrás, el de atrás cede espacio y el primero rodea', () => {
  // Un rojo forma la fila; luego alguien se planta contra cada esquina o el centro de la trompa.
  let roomGiven = 0;
  for (const [lateral, front] of [[-.5, .3], [.5, .3], [0, .4], [0, 1.2]]) {
    const { traffic } = street({ cars: 3, isDrivable: (_x, z) => z > -8.8 && z < 2.9 });
    const [leader, follower, last] = traffic.vehicles;
    place(leader, 40); place(follower, 30); place(last, 20);
    follower.evadePatience = last.evadePatience = Infinity;
    let red = true;
    traffic.signals = { blocks: point => red && point.x > 44 && point.x < 47 };
    for (let frame = 0; frame < 200; frame++) traffic.update(.05);
    red = false;
    const player = new THREE.Vector3(leader.car.position.x + leader.car.length / 2 + front, 0, lateral);
    const startGap = gap(leader, player);
    let minimumGap = Infinity, minimumCars = Infinity, gaveRoom = false;
    for (let frame = 0; frame < 900 && leader.car.position.x < player.x + 6; frame++) {
      traffic.update(.05, { player });
      gaveRoom ||= !!follower.giveRoom;
      minimumGap = Math.min(minimumGap, gap(leader, player), gap(follower, player));
      for (const [a, b] of [[leader, follower], [follower, last]]) minimumCars = Math.min(minimumCars, a.car.position.distanceTo(b.car.position));
    }
    roomGiven += gaveRoom;
    assert.ok(leader.car.position.x > player.x + 6, `El primero logra rodear (lateral ${lateral}, frente ${front})`);
    // Pasa a unos 30 cm del cuerpo, o a la distancia que ya tenía si estaba más cerca.
    assert.ok(minimumGap >= Math.min(startGap, .7) - .06, `No se acerca de más: ${minimumGap.toFixed(2)} de ${startGap.toFixed(2)}`);
    assert.ok(minimumCars > leader.car.length + .3, `Nadie se choca: ${minimumCars.toFixed(2)}`);
    traffic.dispose();
  }
  // Girar hacia el andén con alguien pegado exige retroceder más de lo que deja el carro de atrás.
  assert.ok(roomGiven >= 1, 'Cuando hace falta, el de atrás retrocede un poco');
});

test('la fila detenida por la misma persona protesta, cada conductor a su ritmo', () => {
  const random = (() => { let value = 11; return () => (value = (value * 16807) % 2147483647) / 2147483647; })();
  const { traffic } = street({ cars: 4, random });
  traffic.vehicles.forEach((vehicle, i) => { place(vehicle, 60 - i * 7); vehicle.evadePatience = Infinity; vehicle.temper = .3 + i * .15; });
  const player = new THREE.Vector3(72, 0, 0), sounds = bank(), audio = new VehicleAudio(sounds, random);
  const first = new Map();
  for (let frame = 0; frame < 900; frame++) {
    traffic.update(.05, { player });
    audio.update(.05, new THREE.Vector3(50, 0, 0), traffic.vehicles);
    for (const vehicle of traffic.vehicles) if (audio.instances.get(vehicle.car)?.horn && !first.has(vehicle)) first.set(vehicle, frame * .05);
  }
  assert.ok(traffic.vehicles.every(vehicle => vehicle.speed === 0));
  assert.ok(first.has(traffic.vehicles[0]), 'El primero protesta');
  const followers = traffic.vehicles.slice(1).filter(vehicle => first.has(vehicle));
  assert.ok(followers.length >= 2, `También protestan los de atrás: ${followers.length}`);
  const times = [...first.values()].sort((a, b) => a - b);
  assert.ok(times.slice(1).every((time, i) => time - times[i] > .3), `No suenan sincronizados: ${times.join(', ')}`);
  assert.ok(hornStarts(sounds) < 45, 'La protesta no se vuelve un ruido continuo');
  traffic.dispose();
});

test('los de atrás, al ver a otro rodear a la misma persona, se deciden antes', () => {
  const { traffic } = street({ cars: 2 }), [leader, follower] = traffic.vehicles;
  place(leader, 40); place(follower, 30);
  follower.evadePatience = 30;
  const player = new THREE.Vector3(55, 0, 0);
  let leaderAt = null, followerAt = null, minimumGap = Infinity;
  for (let frame = 0; frame < 1600; frame++) {
    traffic.update(.05, { player });
    if (leader.detour && leaderAt === null) leaderAt = frame * .05;
    if (follower.detour && followerAt === null) followerAt = frame * .05;
    minimumGap = Math.min(minimumGap, gap(follower, player), gap(leader, player));
  }
  assert.ok(leaderAt !== null && followerAt !== null);
  // Mientras el primero rodea, el de atrás no lo sigue a ciegas hasta la persona.
  assert.ok(minimumGap > .3, `Nadie toca a la persona: ${minimumGap.toFixed(2)} m`);
  assert.ok(follower.car.position.x > player.x + 5 || follower.car.position.z > 1);
  assert.ok(followerAt - leaderAt < 30, `El seguidor no espera su paciencia completa: ${followerAt - leaderAt}s`);
  traffic.dispose();
});

test('con rojo para los carros, el peatón que cruza la cebra está en su derecho: nadie pita ni lo rodea', () => {
  const { traffic } = street(), vehicle = traffic.vehicles[0];
  place(vehicle, 20);
  const stop = new THREE.Vector3(36, 0, 0);
  traffic.signals = { blocks: point => point.x > stop.x - .3 && point.x < stop.x + 6 };
  traffic.setStreetQueries({ isCrosswalk: x => x > 30 && x < 34 });
  const walker = { position: new THREE.Vector3(32, 0, 6) }, sounds = bank(), audio = new VehicleAudio(sounds, () => .5);
  for (let frame = 0; frame < 600; frame++) {
    // Cruza despacio, se detiene a mitad de la cebra y luego termina de pasar.
    if (frame < 200 || frame > 400) walker.position.z -= .05 * .8;
    traffic.update(.05, { pedestrians: [walker] });
    audio.update(.05, vehicle.car.position, traffic.vehicles);
    assert.equal(vehicle.detour, null);
  }
  assert.equal(hornStarts(sounds), 0);
  traffic.dispose();
});

test('quien se atraviesa en plena recta recibe una protesta proporcionada; quien cruza la cebra, paciencia', () => {
  const crossing = crosswalk => {
    const { traffic } = street(), vehicle = traffic.vehicles[0];
    place(vehicle, 20);
    traffic.setStreetQueries({ isCrosswalk: () => crosswalk });
    const walker = { position: new THREE.Vector3(30, 0, 3) }, sounds = bank(), audio = new VehicleAudio(sounds, () => .5);
    const reasons = new Set();
    for (let frame = 0; frame < 400; frame++) {
      walker.position.z -= .05 * .7;
      traffic.update(.05, { pedestrians: [walker] });
      audio.update(.05, vehicle.car.position, traffic.vehicles);
      const reason = hornReason(vehicle);
      if (reason) reasons.add(reason);
    }
    traffic.dispose();
    return { honks: hornStarts(sounds), reasons };
  };
  const jaywalk = crossing(false), zebra = crossing(true);
  assert.ok(jaywalk.reasons.has('jaywalk'));
  assert.ok(zebra.reasons.has('pedestrian') && !zebra.reasons.has('jaywalk'));
  assert.ok(jaywalk.honks >= 1 && jaywalk.honks <= 4, `Protesta sin exagerar: ${jaywalk.honks}`);
  assert.ok(zebra.honks < jaywalk.honks);
});

test('el bus insiste ante alguien en su carril con la vía libre y espera sin pitar tanto con rojo', () => {
  const bus = new BusService({ x: 10, startZ: 100, endZ: 0, stationZ: null });
  bus.position.z = 80;
  bus.update(.05, { player: new THREE.Vector3(10, 0, 70) });
  assert.equal(hornReason(bus), 'blocking');
  bus.signals = { busClearance: () => 0 };
  bus.update(.05, { player: new THREE.Vector3(10, 0, bus.position.z - bus.length / 2 - .9) });
  assert.equal(hornReason(bus), 'person');
  bus.dispose();
});

test('en Bogotá los carriles tienen calzada a ambos lados para rodear y las cebras se reconocen', async () => {
  const { Bogota } = await import('../src/world/districts/Bogota.js');
  const city = new Bogota();
  city.map = city._layout();
  const position = new THREE.Vector3(), direction = new THREE.Vector3();
  let samples = 0, lane = 0, room = 0;
  for (const route of city.getTrafficRoutes()) {
    for (let s = 0; s < route.length; s += 3) {
      route.sample(s, position, direction);
      samples++;
      if (!city.isDrivable(position.x, position.z)) continue;
      lane++;
      const ok = side => city.isDrivable(position.x + direction.z * side, position.z - direction.x * side);
      if (ok(2.8) && ok(-2.8)) room++;
    }
  }
  assert.ok(lane / samples > .97, `El centro del carril es calzada: ${(lane / samples).toFixed(3)}`);
  assert.ok(room / lane > .8, `Hay margen lateral en casi todo el recorrido: ${(room / lane).toFixed(3)}`);
  const crosswalks = city.map.flatMap((row, z) => row.map((_type, x) => city.isCrosswalk(x * 2, z * 2))).filter(Boolean).length;
  assert.ok(crosswalks > 50);
  assert.equal(city.isDrivable(-50, -50), false);
});

test('al rodear, la colisión sigue la carrocería girada y no arrastra a quien se rodea', () => {
  const { traffic } = street(), vehicle = traffic.vehicles[0];
  place(vehicle, 20);
  const collisions = new CollisionSystem(), player = new THREE.Vector3(45, 0, 0), zero = new THREE.Vector3();
  let detoured = false, maxYaw = 0;
  for (let frame = 0; frame < 1200; frame++) {
    traffic.update(.05, { player });
    collisions.setVehicles([vehicle.car]);
    // El jugador quieto solo se mueve si una carrocería lo empuja.
    player.copy(collisions.resolveMove(player, zero, .4));
    if (vehicle.detour) { detoured = true; maxYaw = Math.max(maxYaw, Math.abs(vehicle.car.group.rotation.y)); }
  }
  assert.ok(detoured && maxYaw > .2, 'El carro rodea girando la carrocería');
  assert.ok(vehicle.car.position.x > 55, 'Sigue su camino');
  assert.ok(player.distanceTo(new THREE.Vector3(45, 0, 0)) < .02, `El jugador no es empujado: ${player.toArray().map(v => v.toFixed(2))}`);
  // Una carrocería girada ocupa su caja real: a un costado, fuera de ella, nadie es empujado.
  const car = vehicle.car;
  car.position.set(0, 0, 0); car.group.rotation.y = .5; collisions.setVehicles([car]);
  const side = new THREE.Vector3(Math.sin(.5), 0, Math.cos(.5)).multiplyScalar(car.width / 2 + .45);
  assert.ok(collisions.resolveMove(side, zero, .4).distanceTo(side) < 1e-9);
  const inside = new THREE.Vector3(Math.sin(.5), 0, Math.cos(.5)).multiplyScalar(car.width / 2 + .2);
  assert.ok(collisions.resolveMove(inside, zero, .4).distanceTo(inside) > .1, 'Si la toca, sí la aparta');
  traffic.dispose();
});

test('a 1–2 m o junto a un faro, con el perro al lado, el carro rodea pronto al grupo sin quedarse pitando', () => {
  for (const [front, lateral] of [[1, 0], [2, 0], [.5, .6], [.5, -.6], [.3, .75], [.3, -.75]]) {
    const { traffic } = street({ isDrivable: (_x, z) => z > -8.8 && z < 2.9 }), vehicle = traffic.vehicles[0];
    place(vehicle, 40);
    // Primero frena ante el jugador; luego este camina hasta la trompa y su perro se queda al lado.
    const player = new THREE.Vector3(60, 0, 0), dog = { position: new THREE.Vector3() };
    const sounds = bank(), audio = new VehicleAudio(sounds, () => .5);
    let goal = null, arrived = null, detourAt = null, minimumGap = Infinity;
    for (let frame = 0; frame < 1200 && vehicle.car.position.x < 70; frame++) {
      if (!goal && frame > 20 && vehicle.speed === 0 && vehicle.blockingPerson === player) {
        goal = new THREE.Vector3(vehicle.car.position.x + vehicle.car.length / 2 + front + .4, 0, -lateral);
      }
      if (goal) {
        const step = goal.clone().sub(player), remaining = step.length();
        if (remaining > .01) player.addScaledVector(step.normalize(), Math.min(remaining, 1.3 * .05));
        else arrived ??= frame * .05;
      }
      dog.position.set(player.x + .6, 0, player.z + 1);
      traffic.update(.05, { player, pedestrians: [dog] });
      audio.update(.05, player, traffic.vehicles);
      if (vehicle.detour && detourAt === null) detourAt = frame * .05;
      if (arrived !== null) minimumGap = Math.min(minimumGap, gap(vehicle, player), gap(vehicle, dog.position));
    }
    assert.ok(detourAt !== null && detourAt - arrived < 8, `Rodea pronto (frente ${front}, lateral ${lateral}): ${detourAt === null ? 'nunca' : (detourAt - arrived).toFixed(1) + ' s'}`);
    assert.ok(vehicle.car.position.x > 70, 'Termina de pasar');
    assert.ok(minimumGap > .3, `Sin tocar al jugador ni al perro: ${minimumGap.toFixed(2)}`);
    assert.ok(hornStarts(sounds) <= 4, `No se queda pitando: ${hornStarts(sounds)}`);
    traffic.dispose();
  }
});

test('con El Chato a 2,4 m del jugador, donde se detiene al seguirlo, el carro rodea a los dos', () => {
  // El perro se queda a 2,4 m o algo más: a un costado, en diagonal junto al faro izquierdo o entre
  // el jugador y el carro. Con el andén cerca, pasar por la derecha deja la trompa volando sobre el sardinel.
  for (const [dx, dz] of [[0, -2.4], [-1.6, -2], [-1.4, -2.4], [1.7, -1.7], [0, 2.4], [-2.4, 0]]) {
    const { traffic } = street({ isDrivable: (_x, z) => z > -8.8 && z < 2.9 }), vehicle = traffic.vehicles[0];
    place(vehicle, 40);
    const player = new THREE.Vector3(60, 0, 0), dog = { position: new THREE.Vector3(60 + dx, 0, dz) };
    let stopped = null, detourAt = null, minimumGap = Infinity;
    for (let frame = 0; frame < 1200 && vehicle.car.position.x < 70; frame++) {
      traffic.update(.05, { player, pedestrians: [dog] });
      if (stopped === null && vehicle.speed === 0) stopped = frame * .05;
      if (vehicle.detour && detourAt === null) detourAt = frame * .05;
      minimumGap = Math.min(minimumGap, gap(vehicle, player), gap(vehicle, dog.position));
    }
    assert.ok(detourAt !== null && detourAt - stopped < 8, `Rodea con el perro en (${dx}, ${dz}): ${detourAt === null ? 'nunca' : (detourAt - stopped).toFixed(1) + ' s'}`);
    assert.ok(vehicle.car.position.x > 70, 'Termina de pasar');
    assert.ok(minimumGap > .5, `Sin tocar al jugador ni al perro: ${minimumGap.toFixed(2)}`);
    traffic.dispose();
  }
});

test('un carro de otra ruta detrás de uno que rodea no pierde de vista a la persona rodeada', () => {
  // Dos rutas que comparten el carril: quien sigue al que rodea no puede tomarlo como cola y
  // acelerar hacia la persona que ese carro le tapaba.
  for (const gapBehind of [10, 16, 24]) {
    const first = new TrafficRoute(0, 240, 0, 240, 3.2), second = new TrafficRoute(0, 240, 0, 240, 3.2);
    const traffic = new TrafficSystem(new THREE.Scene(), [first, second], { carsPerRoute: 1, random: () => .5 });
    traffic.setStreetQueries({ isDrivable: (_x, z) => z > -8.8 && z < 2.9 });
    const [leader, follower] = traffic.vehicles;
    place(leader, 40); place(follower, 40 - gapBehind);
    follower.cruiseSpeed = 7;
    const player = new THREE.Vector3(60, 0, 0), dog = { position: new THREE.Vector3(58.4, 0, -1.8) };
    const hits = [];
    let minimumGap = Infinity;
    for (let frame = 0; frame < 1600 && follower.car.position.x < 70; frame++) {
      traffic.update(.05, { player, pedestrians: [dog], onPlayerHit: hit => hits.push(hit) });
      minimumGap = Math.min(minimumGap, gap(leader, player), gap(follower, player));
    }
    assert.equal(hits.length, 0, `Nadie atropella al jugador (seguidor a ${gapBehind} m)`);
    assert.ok(minimumGap > .5, `Margen con el jugador: ${minimumGap.toFixed(2)}`);
    assert.ok(follower.car.position.x > 70, 'El de atrás también termina pasando');
    traffic.dispose();
  }
});

test('cuando el primero de la fila consigue rodear, los demás aprovechan el hueco uno tras otro', () => {
  let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const route = new TrafficRoute(0, 400, 0, 240, 3.2);
  const traffic = new TrafficSystem(new THREE.Scene(), [route], { carsPerRoute: 5, random });
  traffic.setStreetQueries({ isDrivable: (_x, z) => z > -8.8 && z < 2.9 });
  traffic.vehicles.forEach((vehicle, i) => place(vehicle, 100 - i * 9));
  const sounds = bank(), audio = new VehicleAudio(sounds, random);
  const player = new THREE.Vector3(118, 0, 0), dog = { position: new THREE.Vector3(118.6, 0, .9) };
  const passed = [], times = [], honks = new Map();
  let minimumGap = Infinity, minimumCars = Infinity;
  for (let frame = 0; frame < 2400 && passed.length < 5; frame++) {
    traffic.update(.05, { player, pedestrians: [dog] });
    audio.update(.05, player, traffic.vehicles);
    traffic.vehicles.forEach((vehicle, i) => {
      if (vehicle.car.position.x > player.x + 6 && !passed.includes(i)) { passed.push(i); times.push(frame * .05); }
      const state = audio.instances.get(vehicle.car);
      if (state?.horn && !state.counted) honks.set(i, (honks.get(i) ?? 0) + 1);
      if (state) state.counted = !!state.horn;
      if (vehicle.car.position.x < player.x + 8) minimumGap = Math.min(minimumGap, gap(vehicle, player), gap(vehicle, dog.position));
      for (const other of traffic.vehicles.slice(i + 1)) minimumCars = Math.min(minimumCars, other.car.position.distanceTo(vehicle.car.position));
    });
  }
  assert.deepEqual(passed, [0, 1, 2, 3, 4], 'Pasan en orden');
  const gaps = times.slice(1).map((time, i) => time - times[i]);
  assert.ok(Math.max(...gaps) < 8, `Cada uno aprovecha el hueco del anterior: ${gaps.map(g => g.toFixed(1)).join(', ')} s`);
  assert.ok([...honks.values()].every(count => count <= 2), 'Nadie repite el ciclo completo de pitadas');
  assert.ok(minimumGap > .5 && minimumCars > 4.5, `Sin contactos: persona ${minimumGap.toFixed(2)}, carros ${minimumCars.toFixed(2)}`);
  traffic.dispose();
});
