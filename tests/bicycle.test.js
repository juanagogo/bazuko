import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Bicycle, BicycleStation } from '../src/entities/Bicycle.js';
import { Player } from '../src/entities/Player.js';
import { Input } from '../src/core/Input.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { Game } from '../src/core/game.js';
import { GpsNavigation } from '../src/systems/GpsNavigation.js';
import { textoDelPrompt } from '../src/ui/HUD.js';
import { DailyMissionSystem } from '../src/systems/DailyMissionSystem.js';
import { BICYCLE } from '../src/data/bicycle.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';

test('E elige la estación, luego conserva la bici montada como único objetivo', () => {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    const f = sceneFor();
    f.player.position.set(0, 0, 1.6); f.collisions.setBicycles(f.bikes);
    f.input.pressedThisFrame.add('KeyE');
    f.interaction.update(1 / 60, f.input, { totalHours: 0 });
    const bike = f.player.bicycle;
    assert.ok(bike); assert.equal(f.station.bikes.length, 3);
    // Alejarse del rack para probar bajarse sin devolver automáticamente la bici.
    f.player.position.z += 5; bike.position.copy(f.player.position);
    f.interaction.update(1 / 60, f.input, { totalHours: 0 });
    assert.ok(f.interaction.currentTarget === bike);
    f.input.pressedThisFrame.add('KeyE');
    f.interaction.update(1 / 60, f.input, { totalHours: 0 });
    assert.equal(f.player.bicycle, null);
    f.input.pressedThisFrame.add('KeyE');
    f.interaction.update(1 / 60, f.input, { totalHours: 0 });
    assert.ok(f.player.bicycle === bike);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

const sceneFor = () => {
  const scene = new THREE.Scene(), input = new Input();
  const player = new Player(scene, input), collisions = new CollisionSystem();
  player.position.set(0, 0, 0);
  const station = new BicycleStation(scene, { id: 'station', x: 0, z: 0, capacity: 4 });
  const bikes = Array.from({ length: 4 }, (_, i) => {
    const bike = new Bicycle(scene, station.dockPosition(i), 0, { id: `bike-${i}`, stationId: station.id });
    station.addBike(bike); bike.dockSlot = i; return bike;
  });
  const stats = { dinero: 10000 };
  player.game = Object.assign(Object.create(Game.prototype), {
    collisions, bikeStations: [station], bicycles: bikes, player, stats,
    gps: new GpsNavigation({ width: 60, zMin: -10, zMax: 80, cost: () => 1 }),
    _syncGpsBeacon() {},
    _save() { this.saved = { cash: stats.dinero, bicycleId: player.bicycle?.id ?? null,
      bicycles: bikes.map(b => b.saveState()), dailyMissions: this.dailyMissions?.serialize() }; }
  });
  const interaction = new InteractionSystem(player, { items: [] }, stats);
  interaction.register(station); bikes.forEach(b => interaction.register(b));
  const step = (dt = 1 / 60, groundHeight = () => 0) => {
    collisions.setBicycles(bikes, player.bicycle);
    player.update(dt, null, collisions, groundHeight);
    bikes.forEach(b => b.update(dt, player)); input.endFrame();
  };
  return { scene, player, input, station, bikes, collisions, interaction, stats, step };
};

test('la bici y el ciclista se inclinan con el apoyo de las ruedas en las rampas del viaducto', () => {
  const f = sceneFor(), bike = f.bikes[0];
  const city = new Bogota();
  city.map = city._layout();
  const ground = city.getPlayerGroundSurface.bind(city);
  assert.ok(bike.mount(f.player));

  for (const [z, sign] of [[27, -1], [300, 1], [60, 0]]) {
    f.player.position.set(75, viaductSurface(75, z), z);
    for (let i = 0; i < 40; i++) f.step(1 / 60, ground);
    assert.equal(f.player.groundSurface.layer, 'viaduct');
    const pitch = bike.visual.rotation.x;
    assert.ok(sign ? pitch * sign > .2 : Math.abs(pitch) < .001, `inclinación en Z ${z}: ${pitch}`);
    assert.equal(f.player.character.group.rotation.x, pitch);
    assert.equal(f.player.character.group.position.y, bike.visual.position.y);
    assert.equal(f.player.root.rotation.x, 0);
    assert.equal(f.player.position.y, viaductSurface(75, z));
    for (const along of [-BICYCLE.wheelbase / 2, BICYCLE.wheelbase / 2]) {
      const tread = bike.visual.localToWorld(new THREE.Vector3(0, 0, along));
      assert.ok(Math.abs(tread.y - viaductSurface(tread.x, tread.z)) < .015, 'la rueda sigue el asfalto');
    }
  }

  f.player.position.set(75, viaductSurface(75, 27), 27);
  for (let i = 0; i < 40; i++) f.step(1 / 60, ground);
  f.input.pressedThisFrame.add('Space');
  for (let i = 0; i < 12; i++) f.step(1 / 60, ground);
  assert.equal(f.player.isGrounded, false);
  assert.ok(Math.abs(bike.visual.rotation.x) < .01, 'en el aire deja de seguir la pendiente');
  for (let i = 0; i < 60; i++) f.step(1 / 60, ground);
  assert.ok(bike.visual.rotation.x < -.2, 'al aterrizar vuelve a seguir la rampa');
  assert.ok(bike.dismount(f.player));
  assert.equal(f.player.character.group.rotation.x, 0);
  assert.equal(f.player.character.group.position.y, 0);

  const street = ground(75, 27, { grounded: false });
  bike.position.set(75, street.height, 27);
  f.player.position.copy(bike.position);
  assert.ok(bike.mount(f.player));
  for (let i = 0; i < 40; i++) f.step(1 / 60, ground);
  assert.equal(f.player.groundSurface.layer, 'ground');
  assert.ok(Math.abs(bike.visual.rotation.x) < .001, 'debajo del puente sigue la calle inferior');
});

function withEvents(run) {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  try { run(); } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test('alquilar cobra 1000 solo al montar, marca el origen y paga 2000 una sola vez al regresar', () => withEvents(() => {
  const f = sceneFor(); f.player.position.set(0, 0, 1.6);
  assert.ok(f.interaction._rentBicycle(f.station));
  const bike = f.player.bicycle;
  assert.equal(f.stats.dinero, 9000);
  assert.equal(f.player.game.saved.cash, 9000);
  assert.equal(bike.rentalOrigin, f.station.id);
  assert.match(f.player.game.gps.waypoint.name, /Origen del alquiler/);
  const origin = f.player.game._getPOIs().find(p => p.rentalOrigin === f.station.id);
  assert.equal(origin.x, f.station.position.x); assert.equal(origin.z, f.station.position.z);
  f.player.game.clearGpsWaypoint();
  assert.ok(f.player.game._getPOIs().some(p => p.rentalOrigin === f.station.id), 'la marca persiste aunque se quite la ruta');
  f.interaction.currentTarget = bike; f.interaction.currentTargetType = 'bicycle';
  assert.match(textoDelPrompt(f.interaction), /2\.000/);
  assert.ok(f.interaction._interactBicycle(bike));
  assert.equal(f.stats.dinero, 11000);
  assert.equal(bike.rentalPaid, false);
  assert.equal(f.player.game._getPOIs().some(p => p.rentalOrigin), false);
  assert.equal(f.interaction._returnBicycle(f.station), false);
  assert.equal(f.stats.dinero, 11000);
}));

test('dinero insuficiente o salida bloqueada no cobran ni crean un alquiler o una marca', () => withEvents(() => {
  const f = sceneFor(); f.stats.dinero = 999;
  assert.equal(f.interaction._rentBicycle(f.station), false);
  assert.equal(f.stats.dinero, 999); assert.equal(f.player.bicycle, null);
  assert.equal(f.station.bikes.length, 4); assert.equal(f.player.game.gps.waypoint, null);
  f.stats.dinero = 1000;
  f.collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 3, 10)) });
  assert.equal(f.interaction._rentBicycle(f.station), false);
  assert.equal(f.stats.dinero, 1000); assert.equal(f.bikes.some(b => b.rentalPaid), false);
}));

test('la misión diaria exige alquiler pagado y devolución al origen; su premio entra en el autoguardado', () => withEvents(() => {
  const f = sceneFor(), missions = new DailyMissionSystem(f.player.game);
  f.player.game.dailyMissions = missions; missions.init(1);
  const mission = () => missions.missions.find(m => m.type === 'bicicleta');
  try {
    f.stats.dinero = 999;
    assert.equal(f.interaction._rentBicycle(f.station), false);
    assert.equal(mission().progress, 0);
    f.stats.dinero = 10000;
    assert.ok(f.interaction._rentBicycle(f.station));
    assert.equal(mission().progress, 0, 'alquilar sin devolver no completa el recorrido');
    const bike = f.player.bicycle;
    f.player.position.z += 5; bike.position.copy(f.player.position);
    assert.ok(f.interaction._interactBicycle(bike));
    assert.equal(mission().progress, 0, 'dejarla en la calle no cuenta');
    assert.ok(f.interaction._interactBicycle(bike));
    f.player.position.copy(f.station.position).add(new THREE.Vector3(0, 0, 2.4));
    bike.position.copy(f.player.position);
    assert.ok(f.interaction._returnBicycle(f.station));
    assert.equal(mission().completed, true); assert.equal(mission().claimed, true);
    assert.equal(f.stats.dinero, 12000, 'alquiler -1000, honestidad +2000, misión +1000');
    assert.equal(f.player.game.saved.cash, 12000);
    assert.equal(f.player.game.saved.dailyMissions.missions.find(m => m.type === 'bicicleta').claimed, true);
    assert.equal(f.interaction._returnBicycle(f.station), false);
    assert.equal(f.stats.dinero, 12000);
  } finally { missions.dispose(); }
}));

test('el contrato y la marca sobreviven desmontaje y guardado sin cobrar otra vez', () => withEvents(() => {
  const f = sceneFor(); assert.ok(f.interaction._rentBicycle(f.station));
  const bike = f.player.bicycle;
  f.player.position.z += 5; bike.position.copy(f.player.position);
  assert.ok(f.interaction._interactBicycle(bike));
  assert.equal(f.player.game.saved.bicycleId, null, 'bajarse guarda de inmediato');
  assert.deepEqual(f.player.game.saved.bicycles.find(b => b.id === bike.id).z, bike.position.z);
  assert.equal(f.player.game.saved.bicycles.find(b => b.id === bike.id).status, 'parked');
  assert.ok(f.interaction._interactBicycle(bike));
  assert.equal(f.player.game.saved.bicycleId, bike.id, 'volver a montar también guarda el vínculo');
  assert.equal(f.stats.dinero, 9000);
  const state = JSON.parse(JSON.stringify(bike.saveState()));
  const next = sceneFor(); next.stats.dinero = 9000;
  const restored = next.bikes[0]; next.station.removeBike(restored); restored.loadState(state);
  assert.equal(restored.rentalPaid, true);
  assert.ok(next.player.game._getPOIs().some(p => p.rentalOrigin === next.station.id));
  assert.ok(next.interaction._interactBicycle(restored));
  next.player.position.copy(next.station.position).add(new THREE.Vector3(0, 0, 2.4));
  restored.position.copy(next.player.position);
  assert.ok(next.interaction._returnBicycle(next.station));
  assert.equal(next.stats.dinero, 11000);
}));

test('devolver en otra estación o devolver una bici robada cierra sin recompensa', () => withEvents(() => {
  let completed = 0;
  window.addEventListener('bicycle-rental-completed', () => completed++);
  const f = sceneFor(); f.interaction._rentBicycle(f.station);
  const other = new BicycleStation(f.scene, { id: 'other', x: 20, z: 0, capacity: 4 });
  f.player.game.bikeStations.push(other);
  const bike = f.player.bicycle;
  f.player.position.set(20, 0, 2.4); bike.position.copy(f.player.position);
  assert.ok(f.interaction._returnBicycle(other));
  assert.equal(f.stats.dinero, 9000); assert.equal(bike.rentalPaid, false);
  assert.equal(f.player.game.gps.waypoint, null);
  assert.equal(f.player.game._getPOIs().some(p => p.rentalOrigin), false);
  f.player.position.copy(f.station.position);
  const stolen = f.station.availableBike();
  assert.ok(f.interaction._stealBicycle(stolen, f.station));
  assert.ok(f.interaction._returnBicycle(f.station));
  assert.equal(f.stats.dinero, 9000);
  assert.equal(completed, 0, 'ni otra estación ni una bicicleta robada completan la misión');
}));

test('dejar un alquiler permite alquilar o robar otra bici sin perder el contrato anterior', () => withEvents(() => {
  for (const replacement of ['rent', 'steal']) {
    const f = sceneFor();
    f.player.game.steal = { buscado: 0 };
    assert.ok(f.interaction._rentBicycle(f.station));
    const first = f.player.bicycle;
    f.player.position.z += 6; first.position.copy(f.player.position);
    assert.ok(f.interaction._interactBicycle(first));
    const parkedPosition = first.position.clone();
    f.player.position.copy(f.station.position).add(new THREE.Vector3(0, 0, 2.4));
    assert.ok(replacement === 'rent' ? f.interaction._rentBicycle(f.station)
      : f.interaction._stealBicycle(f.station.availableBike(), f.station));
    const second = f.player.bicycle;
    assert.notEqual(first, second);
    assert.ok(first.position.equals(parkedPosition));
    assert.equal(first.rider, null); assert.equal(first.rentalPaid, true);
    assert.equal(first.rentalOrigin, f.station.id);
    assert.equal(f.player.game.steal.buscado, replacement === 'steal' ? 1 : 0);
    assert.equal(f.stats.dinero, replacement === 'rent' ? 8000 : 9000);
    assert.equal(f.player.game.saved.bicycles.filter(b => b.rental?.paid).length, replacement === 'rent' ? 2 : 1);
    assert.ok(f.interaction._returnBicycle(f.station));
    assert.ok(f.player.game._getPOIs().some(p => p.rentalOrigin === f.station.id), 'el primer alquiler mantiene el origen marcado');
    const beforeRemount = f.stats.dinero;
    assert.ok(f.interaction._interactBicycle(first));
    assert.equal(f.stats.dinero, beforeRemount, 'retomar la primera no cobra');
    f.player.position.copy(f.station.position).add(new THREE.Vector3(0, 0, 2.4));
    first.position.copy(f.player.position);
    assert.ok(f.interaction._returnBicycle(f.station));
    assert.equal(f.stats.dinero, beforeRemount + 2000);
    assert.equal(f.player.game._getPOIs().some(p => p.rentalOrigin), false);
  }
}));

test('Shift impulsa y aumenta la velocidad al pedalear, conservando una reversa lenta', () => {
  const speeds = [];
  for (const sprint of [false, true]) {
    const f = sceneFor(); f.bikes[0].mount(f.player); f.input.keys.KeyW = true;
    f.input.keys.ShiftLeft = sprint;
    for (let i = 0; i < 300; i++) f.step();
    speeds.push(f.bikes[0].speed);
    f.input.keys.KeyW = false; f.input.keys.KeyS = true;
    for (let i = 0; i < 300; i++) f.step();
    assert.ok(f.bikes[0].speed >= -1.6);
  }
  assert.ok(speeds[1] > speeds[0] + 1, `${speeds}`);
});

test('montar desde el rack, impulsar, girar, frenar, saltar y volver a montar conserva un único ciclista', () => {
  const f = sceneFor(), bike = f.bikes[0];
  f.collisions.setBicycles(f.bikes);
  assert.ok(bike.mount(f.player));
  assert.equal(f.station.bikes.length, 3);
  assert.ok(f.player.position.z > 2, 'sale fuera del rack');
  assert.equal(bike.mount(f.player), false, 'doble montaje rechazado');
  f.input.keys.KeyW = true;
  for (let i = 0; i < 150; i++) f.step();
  assert.ok(bike.speed > 3, `acelera más que caminar: ${bike.speed}`);
  const before = f.player.position.clone(), speed = bike.speed;
  f.input.keys.KeyW = false; f.input.keys.KeyD = true;
  for (let i = 0; i < 30; i++) f.step();
  assert.ok(f.player.position.distanceTo(before) > 1, 'conserva impulso');
  assert.ok(bike.speed < speed && bike.speed > 1);
  assert.ok(bike.group.rotation.y < -.1, 'D gira a la derecha durante la inercia');
  f.input.keys.KeyD = false;
  f.input.pressedThisFrame.add('Space'); f.step();
  assert.equal(f.player.isGrounded, false);
  assert.ok(f.player.position.y > 0);
  assert.equal(bike.dismount(f.player), false, 'no se baja en el aire');
  for (let i = 0; i < 70; i++) f.step();
  assert.equal(f.player.isGrounded, true); assert.equal(bike.position.y, 0);
  f.input.keys.KeyS = true;
  for (let i = 0; i < 90 && bike.speed > 0; i++) f.step();
  f.input.keys.KeyS = false;
  assert.equal(bike.speed, 0); assert.equal(f.player.bicycle, bike);
  assert.equal(bike.rider, f.player);
  assert.ok(bike.dismount(f.player));
  assert.equal(f.player.bicycle, null); assert.equal(bike.rider, null);
  assert.ok(bike.mount(f.player));
  assert.equal(f.player.bicycle, bike);
});

test('un rack encerrado o ambos costados tapados no dejan estados de montaje a medias', () => {
  const f = sceneFor(), bike = f.bikes[0];
  f.collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 3, 10)) });
  const p = f.player.position.clone();
  assert.equal(bike.mount(f.player), false);
  assert.equal(f.player.bicycle, null); assert.equal(bike.rider, null);
  assert.equal(f.station.bikes.length, 4); assert.ok(f.player.position.equals(p));
  f.collisions.clear(); assert.ok(bike.mount(f.player));
  f.collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 3, 10)) });
  assert.equal(bike.dismount(f.player), false); assert.equal(f.player.bicycle, bike);
});

test('una bici robada se puede retomar después de un impacto, sin repetir el robo', () => {
  const f = sceneFor(), bike = f.bikes[0];
  assert.ok(bike.mount(f.player, true));
  f.player.receiveVehicleImpact(new THREE.Vector3(1, 0, 0), 3);
  assert.equal(bike.rider, null); assert.equal(f.player.bicycle, null);
  f.player.clearVehicleImpact(); f.player.position.copy(bike.position);
  assert.ok(f.interaction._interactBicycle(bike));
  assert.equal(bike.status, 'stolen'); assert.equal(f.player.bicycle, bike);
});

test('el impulso y la reversa son comparables a 30, 60 y 144 FPS', () => {
  const distances = [], reversed = [];
  for (const fps of [30, 60, 144]) {
    const f = sceneFor(); f.bikes[0].mount(f.player); f.input.keys.KeyW = true;
    const z = f.player.position.z;
    for (let i = 0; i < fps * 3; i++) f.step(1 / fps);
    distances.push(f.player.position.z - z);
    f.input.keys.KeyW = false; f.input.keys.KeyS = true;
    const reverseStart = f.player.position.z;
    for (let i = 0; i < fps * 2; i++) f.step(1 / fps);
    assert.ok(f.bikes[0].speed < -.2 && f.bikes[0].speed >= -1.6);
    reversed.push(f.player.position.z - reverseStart);
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) < .3, `${distances}`);
  assert.ok(Math.max(...reversed) - Math.min(...reversed) < .2, `${reversed}`);
});

test('S frena antes de retroceder; en reversa empuja con los pies y con W vuelve a pedalear', () => {
  const f = sceneFor(), bike = f.bikes[0]; bike.mount(f.player);
  f.input.keys.KeyW = true;
  for (let i = 0; i < 120; i++) f.step();
  f.input.keys.KeyW = false; f.input.keys.KeyS = true;
  for (let i = 0; i < 120 && bike.speed > 0; i++) {
    f.step(); assert.ok(bike.speed >= 0, 'se detiene antes de cambiar de sentido');
  }
  assert.equal(bike.speed, 0);
  const stopped = f.player.position.clone(), wheel = bike._wheelPhase, crank = bike.pedalPhase;
  for (let i = 0; i < 90; i++) f.step();
  assert.ok(f.player.position.z < stopped.z - .4);
  assert.ok(bike.lookBack > .95);
  assert.ok(f.player.character.ragdollRig.head.rotation.y > 1.6);
  assert.ok(bike._wheelPhase < wheel && bike.reversePhase > 0);
  assert.equal(bike.pedalPhase, crank, 'en reversa usa el suelo, no gira las bielas con los pies');
  assert.ok(bike.reverseFoot > .95);
  assert.equal(f.player.root.rotation.y, 0, 'mirar atrás no voltea el vehículo');
  f.input.keys.KeyS = false; f.input.keys.KeyW = true;
  for (let i = 0; i < 120; i++) f.step();
  assert.ok(bike.speed > 1 && bike.lookBack < .01);
  assert.ok(bike.reverseFoot < .01 && bike.supportFoot < .01);
  assert.ok(Math.abs(f.player.character.ragdollRig.head.rotation.y) < .05);
});

test('detenerse apoya un pie y arrancar lo recoge sin bloquear el movimiento ni el salto', () => {
  const f = sceneFor(), bike = f.bikes[0]; bike.mount(f.player);
  const stopped = f.player.position.clone();
  for (let i = 0; i < 90; i++) f.step();
  assert.ok(bike.supportFoot > .99 && bike.reverseFoot < .01);
  assert.ok(f.player.position.equals(stopped));
  f.input.keys.KeyW = true;
  const weight = bike.supportFoot;
  f.step();
  assert.ok(bike.supportFoot > 0 && bike.supportFoot < weight, 'la transición es gradual');
  for (let i = 0; i < 90; i++) f.step();
  assert.ok(bike.supportFoot < .01 && bike.pedalPhase > 0 && bike.speed > 1);
  assert.ok(f.player.position.distanceTo(stopped) > 1);
  f.input.keys.KeyW = false; f.input.keys.KeyS = true;
  for (let i = 0; i < 120; i++) f.step();
  assert.ok(bike.reverseFoot > .99);
  f.input.pressedThisFrame.add('Space'); f.step();
  for (let i = 0; i < 14; i++) f.step();
  assert.equal(f.player.isGrounded, false);
  assert.ok(bike.reverseFoot < .1 && bike.supportFoot < .01, 'en el aire recoge ambos pies');
});

test('la dirección se invierte en reversa y una pared trasera frena ambas ruedas', () => {
  const f = sceneFor(), bike = f.bikes[0]; bike.mount(f.player);
  f.player.position.set(0, 0, 10); bike.position.copy(f.player.position);
  f.input.keys.KeyS = true; f.input.keys.KeyD = true;
  for (let i = 0; i < 70; i++) f.step();
  assert.ok(bike.group.rotation.y > .05, 'D orienta la cabrilla a la derecha y el frente gira hacia la izquierda al retroceder');
  f.input.keys.KeyD = false;
  bike.group.rotation.y = f.player.root.rotation.y = 0; bike.steerAngle = 0;
  f.collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-10, 0, 5), new THREE.Vector3(10, 3, 6)) });
  for (let i = 0; i < 360; i++) f.step();
  assert.ok(f.player.position.z >= 6.89, `la rueda trasera no atraviesa la pared: ${f.player.position.z}`);
  assert.ok(Math.abs(bike.speed) < .5 && bike.lookBack < .1);
});

test('A/D maniobran hacia la izquierda/derecha del ciclista desde cualquier rumbo', () => {
  const up = new THREE.Vector3(0, 1, 0);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const [key, expected] of [['KeyA', -1], ['KeyD', 1]]) {
      const f = sceneFor(), bike = f.bikes[0]; bike.mount(f.player);
      f.player.position.set(150, 0, 150); bike.position.copy(f.player.position);
      bike.group.rotation.y = f.player.root.rotation.y = yaw;
      f.input.keys.KeyW = true;
      for (let i = 0; i < 120; i++) f.step();
      const before = f.player.position.clone();
      const right = new THREE.Vector3(-1, 0, 0).applyAxisAngle(up, yaw);
      f.input.keys[key] = true;
      for (let i = 0; i < 24; i++) f.step();
      const heading = new THREE.Vector3(0, 0, 1).applyAxisAngle(up, f.player.root.rotation.y);
      const movement = f.player.position.clone().sub(before);
      assert.ok(heading.dot(right) * expected > .05, `${key} apunta al lado correcto con rumbo ${yaw}`);
      assert.ok(movement.dot(right) * expected > .01, `${key} desplaza al lado correcto con rumbo ${yaw}`);
      const handleDirection = new THREE.Vector3(0, 0, 1).applyAxisAngle(up, yaw + bike._visual.steering.rotation.y);
      assert.ok(handleDirection.dot(right) * expected > .05, `${key}: la cabrilla acompaña el giro`);
    }
  }
});

test('las colisiones frenan al ciclista y el guardado recupera bicis sin serializar objetos visuales', () => {
  const f = sceneFor(); const bike = f.bikes[0]; bike.mount(f.player);
  f.collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-10, 0, 6), new THREE.Vector3(10, 3, 7)) });
  f.input.keys.KeyW = true;
  for (let i = 0; i < 200; i++) f.step();
  assert.ok(f.player.position.z <= 5.61);
  assert.ok(bike.speed < .5);
  const state = JSON.parse(JSON.stringify(bike.saveState()));
  assert.equal('rider' in state, false);
  const restored = new Bicycle(f.scene, new THREE.Vector3(), 0, { id: bike.id });
  restored.loadState(state);
  assert.equal(restored.status, 'parked'); assert.ok(restored.position.equals(bike.position));
});
