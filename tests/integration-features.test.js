import assert from 'node:assert/strict';
import { beforeEach, test, mock } from 'node:test';
import * as THREE from 'three';
import { Renderer } from '../src/core/Renderer.js';
import { AdaptiveResolution } from '../src/core/AdaptiveResolution.js';
import { SceneManager } from '../src/core/Scene.js';
import { CameraRig } from '../src/core/Camera.js';
import { CompanionNavigation } from '../src/systems/CompanionNavigation.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { Dog } from '../src/entities/Dog.js';
import { Player } from '../src/entities/Player.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { ITEMS } from '../src/data/items.js';
import { Game } from '../src/core/game.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  window.innerWidth = 1200; window.innerHeight = 800; window.devicePixelRatio = 2;
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
});

test('los perfiles respetan su límite de resolución incluso después de la adaptación automática', () => {
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    resolution: new AdaptiveResolution(2), culling: { apply() {}, restore() {} }, silhouette: { render() {} },
    instance: { shadowMap: {}, info: { reset() {} }, render() {}, setPixelRatio(value) { this.ratio = value; } }
  });
  // El lienzo solo cambia de resolución al dibujar el cuadro siguiente.
  const drawnRatio = () => { renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera()); return renderer.instance.ratio; };
  for (const [quality, cap] of [['baja', 0.85], ['media', 1.25], ['alta', 1.5]]) {
    renderer.setQuality(quality);
    assert.equal(drawnRatio(), cap);
    for (let i = 0; i < 300; i++) renderer.adaptResolution(40);
    assert.ok(drawnRatio() < cap);
    for (let i = 0; i < 4000; i++) renderer.adaptResolution(10);
    assert.ok(drawnRatio() <= cap);
    assert.equal(renderer.instance.shadowMap.enabled, quality !== 'baja');
    assert.equal(localStorage.getItem('bazuko.graphics_quality'), quality);
  }
});

test('el ciclo de iluminación mantiene la calidad elegida y libera el mapa de sombras al redimensionarlo', () => {
  const manager = new SceneManager(); let disposed = 0;
  manager.sun.shadow.map = { dispose() { disposed++; } };
  manager.setQuality('media');
  assert.equal(disposed, 1);
  assert.equal(manager.sun.shadow.map, null);
  assert.equal(manager.sun.shadow.mapSize.x, 1024);
  for (let hour = 0; hour < 24; hour++) {
    manager.setTimeOfDay(hour);
    assert.ok(manager.scene.fog.far <= 160);
  }
  manager.setQuality('baja'); manager.setTimeOfDay(12);
  assert.equal(manager.sun.castShadow, false);
  assert.ok(manager.scene.fog.far <= 130);
  manager.setQuality('alta');
  assert.equal(manager.sun.shadow.mapSize.x, 2048);
  assert.equal(manager.sun.castShadow, true);
  assert.ok(manager.scene.fog.far > 160);
  assert.equal(manager.sun.shadow.normalBias, .035);
});

test('Pointer Lock procesa una sola rotación y libera el cursor en menús, Escape y cambio de cámara', () => {
  const canvas = new EventTarget(); let releases = 0;
  globalThis.document = new EventTarget();
  document.exitPointerLock = () => { releases++; document.pointerLockElement = null; };
  canvas.requestPointerLock = () => { document.pointerLockElement = canvas; return Promise.resolve(); };
  const rig = new CameraRig(new THREE.Scene(), canvas);
  const down = new Event('pointerdown'); Object.assign(down, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  canvas.dispatchEvent(down);
  const yaw = rig.yaw;
  for (const type of ['pointermove', 'mousemove']) {
    const e = new Event(type); Object.assign(e, { movementX: 10, movementY: 0 }); window.dispatchEvent(e);
  }
  assert.ok(Math.abs(rig.yaw - (yaw - .05)) < 1e-9);
  rig.releaseControls(); assert.equal(releases, 1);
  document.pointerLockElement = canvas;
  const escape = new Event('keydown'); escape.code = 'Escape'; window.dispatchEvent(escape);
  assert.equal(document.pointerLockElement, null);
  document.pointerLockElement = canvas; rig.toggle(); assert.equal(document.pointerLockElement, null);
  delete globalThis.document;
});

test('El Chato rodea una pared, respeta las cajas de vehículos y no corta esquinas', () => {
  const collisions = new CollisionSystem();
  collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(5, -1, 0), new THREE.Vector3(7, 5, 11)) });
  const district = {
    map: Array.from({ length: 10 }, () => Array(10).fill('walkable')),
    isWalkableAt: (x, z) => x >= 0 && z >= 0 && x <= 18 && z <= 18,
    getGroundHeight: () => .04
  };
  const navigation = new CompanionNavigation(district, collisions);
  const from = new THREE.Vector3(2, .04, 4), to = new THREE.Vector3(12, .04, 4);
  const route = navigation.route(from, to);
  assert.ok(route.some(point => point.z >= 12));
  let previous = from;
  for (const point of route) { assert.ok(navigation.clearLine(previous, point)); previous = point; }
  const dog = new Dog(new THREE.Scene(), from); dog.navigation = navigation; dog.befriend();
  for (let i = 0; i < 800; i++) {
    dog.update(1 / 60, to);
    assert.ok(navigation.isOpen(dog.position.x, dog.position.z), 'No atraviesa la pared al seguir la ruta');
  }
  assert.ok(dog.position.distanceTo(to) < 2.6);
  const vehicle = { position: new THREE.Vector3(4, 0, 16), length: 4.3, width: 1.76, group: new THREE.Group() };
  collisions.setVehicles([vehicle]);
  dog.resetNear(new THREE.Vector3(0, 0, 16));
  for (let i = 0; i < 120; i++) dog.update(1 / 60, new THREE.Vector3(10, 0, 16));
  assert.ok(dog.position.x < 2);
  dog.destroy();
});

test('alimentar al perro consume comida real del inventario y las caricias tienen enfriamiento', () => {
  const dog = new Dog(new THREE.Scene()), inventory = new InventorySystem(), stats = new StatsSystem();
  stats.saludMental = 40; inventory.add(ITEMS.pan, 1); inventory.add(ITEMS.lata, 1);
  const interaction = new InteractionSystem({}, inventory, stats);
  interaction._interactDog(dog);
  assert.equal(dog.isFriend, true); assert.equal(inventory.count('pan'), 0); assert.equal(inventory.count('lata'), 1);
  assert.equal(stats.saludMental, 55);
  interaction._interactDog(dog); assert.equal(stats.saludMental, 60);
  interaction._interactDog(dog); assert.equal(stats.saludMental, 60);
  dog.update(21, dog.position); interaction._interactDog(dog); assert.equal(stats.saludMental, 65);
  dog.restAt(new THREE.Vector3(2, 0, 2)); assert.equal(dog.sleeping, true); assert.equal(dog._posture.lie, 1);
  const restingPosition = dog.position.clone(); dog.update(1, new THREE.Vector3(50, 0, 50));
  assert.deepEqual(dog.position, restingPosition);
  dog.wake(); assert.equal(dog.sleeping, false); assert.equal(dog.group.scale.y, 1);
  dog.destroy();
});

test('el olfato ignora bolsas y canecas vacías y la amistad se incluye en el guardado', () => {
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3()); dog.befriend();
  let barks = 0; window.addEventListener('dog-bark', () => barks++);
  dog._barkTimer = 11; dog.update(.1, dog.position, [{ used: true, position: new THREE.Vector3(1, 0, 1) }]);
  assert.equal(barks, 0);
  dog._barkTimer = 11; dog.update(.1, dog.position, [{ used: false, position: new THREE.Vector3(1, 0, 1) }]);
  assert.equal(barks, 1);
  const serializable = () => ({ serialize: () => ({}) }); let saved;
  const game = Object.assign(Object.create(Game.prototype), {
    stats: serializable(), clock: serializable(), inventory: serializable(), talents: serializable(), diseases: serializable(),
    player: { position: new THREE.Vector3() }, world: {}, dog, save: { save: data => { saved = data; } }
  });
  game._save(); assert.equal(saved.dog.isFriend, true); assert.deepEqual(saved.dog.look, dog.look); dog.destroy();
});

test('inventario y paneles existentes pausan la simulación y los POI usan la ubicación real del cambuche', () => {
  const game = Object.assign(Object.create(Game.prototype), {
    menu: { isOpen: false }, creator: { isOpen: false }, hud: {}, inventoryUI: { isOpen: false },
    cambuche: { position: new THREE.Vector3(112.98, 0, 94.64) }
  });
  assert.equal(game.paused, false);
  game.inventoryUI.isOpen = true; assert.equal(game.paused, true); game.inventoryUI.isOpen = false;
  game.hud._talentOpen = true; assert.equal(game.paused, true);
  assert.equal(game._getPOIs()[0].x, 112.98);
  assert.equal(game._getPOIs()[0].z, 94.64);
});

test('dormir con El Chato suma quince de ánimo y lo despierta al terminar la siesta', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const run = friend => {
      const dog = new Dog(new THREE.Scene()); if (friend) dog.befriend();
      const stats = new StatsSystem(); stats.saludMental = 20;
      const game = Object.assign(Object.create(Game.prototype), {
        built: { base: true }, clock: { hour: 12, day: 1, isNight: false }, stats,
        player: { position: new THREE.Vector3(), playAction() {} }, dog, _save() {}, inventory: new InventorySystem()
      });
      game.sleep(); return game;
    };
    const alone = run(false), accompanied = run(true);
    assert.equal(accompanied.stats.saludMental - alone.stats.saludMental, 15);
    assert.equal(accompanied.dog.sleeping, true);
    mock.timers.tick(1200);
    assert.equal(accompanied.dog.sleeping, false); assert.equal(accompanied.isSleeping, false);
    alone.dog.destroy(); accompanied.dog.destroy();
  } finally { mock.timers.reset(); }
});

test('dormir acuesta el cuerpo con la simulación quieta, le quita lo que tenía en las manos y al despertar queda de pie', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const scene = new THREE.Scene();
    const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: () => false, isDown: () => false };
    const stats = new StatsSystem();
    const player = new Player(scene, input, stats, null);
    const game = Object.assign(Object.create(Game.prototype), {
      built: { base: true, paredes: true }, clock: { hour: 12, day: 1, isNight: false }, stats,
      player, dog: null, _save() {}, inventory: new InventorySystem()
    });
    const tick = frames => { for (let i = 0; i < frames; i++) player.update(1 / 60, null, null, () => 0, []); };
    const height = () => { scene.updateMatrixWorld(true); return new THREE.Box3().setFromObject(player.character.group, true).max.y; };
    player.equipWeapon('cuchillo');
    tick(30);
    assert.equal(player.startSmoking('cigarrillo'), true);
    tick(1);
    const standing = height(), weapon = player.character.group.getObjectByName('weapon-cuchillo');
    assert.equal(weapon.visible, true);

    game.sleep();
    assert.equal(player.smoking, null, 'no se duerme fumando');
    const before = player.position.clone();
    for (let i = 0; i < 60; i++) player.updateSleepPose(1 / 60);
    assert.ok(height() < standing * .6, `acostado ${height()} de ${standing}`);
    assert.equal(weapon.visible, false, 'el arma no queda en la mano de quien duerme');
    assert.ok(player.position.equals(before), 'la pose no mueve al jugador');
    assert.equal(player.action, 'dormir');

    mock.timers.tick(1200);
    assert.equal(game.isSleeping, false);
    assert.equal(player.action, null, 'despierto no sigue acostado');
    tick(90);
    assert.ok(height() > standing * .95, `de pie ${height()} de ${standing}`);
    assert.equal(weapon.visible, true);
    player.updateSleepPose(1 / 60);
    assert.equal(player.actionProgress, 0, 'despierto, la pose ya no hace nada');
  } finally { mock.timers.reset(); }
});

test('quien se acuesta corriendo se endereza y al despertar no resbala', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const scene = new THREE.Scene();
    const input = { axis: { x: 0, z: -1 }, isRunning: true, consumePress: () => false, isDown: () => false };
    const stats = new StatsSystem();
    const player = new Player(scene, input, stats, null);
    const game = Object.assign(Object.create(Game.prototype), {
      built: { base: true, paredes: true }, clock: { hour: 12, day: 1, isNight: false }, stats,
      player, dog: null, _save() {}, inventory: new InventorySystem()
    });
    const tick = frames => { for (let i = 0; i < frames; i++) player.update(1 / 60, null, null, () => 0, []); };
    tick(60);
    assert.ok(player.velocity.length() > 5, `corría a ${player.velocity.length()} m/s`);
    assert.ok(player.root.rotation.x > .05, 'corriendo se inclina');
    player.landing = 1;
    player.receiveHit(new THREE.Vector3(1, 0, 0), 2);

    game.sleep();
    Object.assign(input, { axis: { x: 0, z: 0 }, isRunning: false });
    assert.equal(player.velocity.length(), 0);
    assert.equal(player.landing, 0, 'no se despierta aterrizando');
    assert.equal(player.isStunned, false, 'el golpe no sigue empujando al despertar');
    for (let i = 0; i < 60; i++) player.updateSleepPose(1 / 60);
    assert.ok(player.root.rotation.x < .001, `acostado derecho: ${player.root.rotation.x}`);
    scene.updateMatrixWorld(true);
    const visible = new THREE.Box3();
    player.character.group.traverseVisible(node => { if (node.isMesh) visible.expandByObject(node, true); });
    assert.ok(visible.min.y > -.02, `no cruza el piso: ${visible.min.y}`);

    mock.timers.tick(1200);
    const awake = player.position.clone();
    tick(30);
    assert.ok(player.position.equals(awake), 'sin teclas no se mueve');
    assert.equal(player.speed, 0);
  } finally { mock.timers.reset(); }
});

test('al levantarse voltea solo lo que ya se enderezó: acostado no barre el piso', () => {
  const input = { axis: { x: 0, z: 0 }, isRunning: true, consumePress: () => false, isDown: () => false };
  const player = new Player(new THREE.Scene(), input, new StatsSystem(), null);
  const tick = frames => { for (let i = 0; i < frames; i++) player.update(1 / 60, null, null, () => 0, []); };
  tick(10);
  input.axis = { x: 1, z: 0 };
  tick(1);
  const standing = player.root.rotation.y;
  assert.ok(standing > .3, `de pie voltea: ${standing}`);
  assert.ok(player.root.rotation.z < -.02 && player.root.rotation.x > .01, 'y se inclina');

  input.axis = { x: 0, z: 0 };
  player.root.rotation.set(0, 0, 0);
  player.playAction('dormir', 1.6);
  for (let i = 0; i < 90; i++) player.updateSleepPose(1 / 60);
  assert.ok(player.character.sleepWeight > .99, `acostado: ${player.character.sleepWeight}`);
  player.action = null;
  input.axis = { x: 1, z: 0 };
  tick(1);
  assert.ok(player.root.rotation.y < standing * .02, `acostado no voltea: ${player.root.rotation.y}`);
  assert.ok(Math.abs(player.root.rotation.z) < .001 && Math.abs(player.root.rotation.x) < .001, 'ni se inclina');
  tick(60);
  assert.ok(player.character.sleepWeight < .001, `ya se levantó: ${player.character.sleepWeight}`);
  assert.ok(Math.abs(player.root.rotation.y - Math.PI / 2) < .01, `y terminó de voltear: ${player.root.rotation.y}`);
});

test('el ladrón de la noche se lleva el material, no el arma que está en la mano', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const random = mock.method(Math, 'random', () => 0);
  try {
    const inventory = new InventorySystem();
    inventory.add(ITEMS.arma, 1); inventory.add(ITEMS.cuchillo, 1); inventory.add(ITEMS.lata, 1);
    const game = Object.assign(Object.create(Game.prototype), {
      built: { base: true }, clock: { hour: 22, day: 1, isNight: true }, stats: new StatsSystem(),
      player: { position: new THREE.Vector3(), playAction() {}, equippedWeapon: 'arma' }, dog: null, _save() {}, inventory
    });
    game.sleep();
    assert.deepEqual(['arma', 'cuchillo', 'lata'].map(id => inventory.count(id)), [1, 0, 0]);
  } finally { random.mock.restore(); mock.timers.reset(); }
});

test('con E junto al cambuche El Chato se queda cuidando y con otra E vuelve a seguirme; cuidar va en la partida', () => {
  const dog = new Dog(new THREE.Scene(), new THREE.Vector3(1, 0, 0)), inventory = new InventorySystem(), stats = new StatsSystem();
  const interaction = new InteractionSystem({}, inventory, stats);
  const toasts = [], atendido = [];
  window.addEventListener('toast', e => toasts.push(e.detail.text));
  window.addEventListener('dog-interacted', e => atendido.push(e.detail.action));
  // Sin ser amigo, junto al cambuche solo se deja acariciar.
  dog.cambucheCerca = true;
  interaction._interactDog(dog);
  assert.equal(dog.guarding, null);
  dog.befriend();
  // Lejos del cambuche, la E sigue siendo la caricia.
  dog.cambucheCerca = false; dog._petCooldown = 0; stats.saludMental = 40;
  interaction._interactDog(dog);
  assert.equal(dog.guarding, null); assert.equal(stats.saludMental, 45);
  // Junto al cambuche se queda cuidando, en su rincón de siempre; no da ánimo ni depende del enfriamiento de la caricia.
  dog.cambucheCerca = true;
  interaction._interactDog(dog);
  assert.deepEqual(dog.guarding.toArray(), dog.home.toArray());
  assert.notEqual(dog.guarding, dog.home, 'guarda una copia del sitio');
  assert.equal(stats.saludMental, 45);
  assert.equal(toasts.at(-1), 'Le pedí a El Chato que cuidara el cambuche. De noche espanta a los ladrones.');
  const serializable = () => ({ serialize: () => ({}) }); let saved;
  const game = Object.assign(Object.create(Game.prototype), {
    stats: serializable(), clock: serializable(), inventory: serializable(), talents: serializable(), diseases: serializable(),
    player: { position: new THREE.Vector3() }, world: {}, dog, save: { save: data => { saved = data; } }
  });
  game._save(); assert.equal(saved.dog.cuida, true);
  // Otra E lo llama, esté yo junto al cambuche o no.
  interaction._interactDog(dog);
  assert.equal(dog.guarding, null);
  assert.equal(toasts.at(-1), 'Llamé a El Chato y ya me acompaña otra vez.');
  game._save(); assert.equal(saved.dog.cuida, false);
  assert.deepEqual(atendido, ['pet', 'pet', 'guard', 'call'], 'dejarlo cuidando y llamarlo también cuentan como atenderlo');
  dog.destroy();
});

test('al cargar la partida El Chato vuelve a cuidar solo si sigue habiendo cambuche', () => {
  const sinDatos = () => ({ deserialize() {} });
  const cargar = (perro, built) => {
    const dog = new Dog(new THREE.Scene(), new THREE.Vector3(1, 0, 0));
    const game = Object.assign(Object.create(Game.prototype), {
      stats: sinDatos(), clock: sinDatos(), inventory: { deserialize() {}, count: () => 0 }, talents: sinDatos(), diseases: sinDatos(),
      player: { position: new THREE.Vector3() }, world: {}, dog
    });
    game._aplicarPartida({ built, dog: perro });
    const estado = { amigo: dog.isFriend, cuida: !!dog.guarding };
    dog.destroy();
    return estado;
  };
  assert.deepEqual(cargar({ isFriend: true, cuida: true }, { base: true }), { amigo: true, cuida: true });
  assert.deepEqual(cargar({ isFriend: true, cuida: false }, { base: true }), { amigo: true, cuida: false });
  assert.deepEqual(cargar({ isFriend: true }, { base: true }), { amigo: true, cuida: false }, 'una partida de antes no lo deja cuidando');
  assert.deepEqual(cargar({ isFriend: true, cuida: true }, {}), { amigo: true, cuida: false }, 'sin cambuche no hay qué cuidar');
  assert.deepEqual(cargar({ isFriend: false, cuida: true }, { base: true }), { amigo: false, cuida: false });
});

test('El Chato cuidando o durmiendo al lado espanta al ladrón de la noche: ni plata, ni material, ni caleta', async () => {
  const { Caleta } = await import('../src/systems/Caleta.js');
  mock.timers.enable({ apis: ['setTimeout'] });
  let azar = 0;
  const random = mock.method(Math, 'random', () => azar);
  try {
    const noche = ({ perro, hora = 22, paredes = false, lejos = 40, energia = null } = {}) => {
      const stats = new StatsSystem(); stats.dinero = 1000;
      if (energia !== null) stats.energia = energia;
      const antes = stats.energia;
      const inventory = new InventorySystem(); inventory.add(ITEMS.lata, 4);
      const caleta = new Caleta(); caleta.items.push({ id: 'carton', qty: 4 });
      const dog = perro ? new Dog(new THREE.Scene(), new THREE.Vector3(lejos, 0, 0)) : null;
      if (perro && perro !== 'ajeno') dog.befriend();
      if (perro === 'cuida') dog.guard(dog.position);
      const toasts = []; const oir = e => toasts.push(e.detail.text);
      window.addEventListener('toast', oir);
      const game = Object.assign(Object.create(Game.prototype), {
        built: { base: true, paredes }, clock: { hour: hora, day: 1, isNight: hora >= 19 || hora < 6 }, stats,
        player: { position: new THREE.Vector3(), playAction() {} }, dog, _save() {}, inventory, street: { caleta }
      });
      game.sleep();
      mock.timers.tick(1200);
      window.removeEventListener('toast', oir);
      dog?.destroy();
      return { dinero: stats.dinero, latas: inventory.count('lata'), caleta: caleta.count('carton'), toasts, dog, durmio: stats.energia > antes };
    };
    const robado = { dinero: 600, latas: 2, caleta: 2 }, intacto = { dinero: 1000, latas: 4, caleta: 4 };
    const pierde = ({ dinero, latas, caleta }) => ({ dinero, latas, caleta });

    // Sin perro, lo de siempre: 40 % de la plata, la mitad del material y la mitad de la caleta.
    const solo = noche();
    assert.deepEqual(pierde(solo), robado);
    assert.deepEqual(solo.toasts, ['Me robaron mientras dormía ($ 400 y material). Unas paredes ayudarían.',
      'También encontraron la caleta: se llevaron Cartón ×2.']);
    // El Chato sin ser amigo no cuida nada, ni rondando a dos pasos de la cama.
    assert.deepEqual(pierde(noche({ perro: 'ajeno' })), robado);
    assert.deepEqual(pierde(noche({ perro: 'ajeno', lejos: 2 })), robado);

    // Cuidando el cambuche, aunque yo esté lejos de él: no se pierde nada y avisa.
    const cuidando = noche({ perro: 'cuida' });
    assert.deepEqual(pierde(cuidando), intacto);
    assert.deepEqual(cuidando.toasts, ['El Chato espantó a un ladrón mientras dormía.']);
    assert.equal(cuidando.dog.sleeping, false, 'el que cuida no se echa a dormir');
    assert.equal(cuidando.dog.position.x, 40, 'ni lo traen a mi lado');
    // De amigo y sin cuidar, duerme a mi lado y también lo espanta.
    const alLado = noche({ perro: 'amigo' });
    assert.deepEqual(pierde(alLado), intacto);
    assert.deepEqual(alLado.toasts, ['El Chato espantó a un ladrón mientras dormía.']);

    // Si esa noche no venía nadie, no hay aviso; y en la siesta de día nunca hay ladrón.
    azar = .99;
    assert.deepEqual(noche({ perro: 'cuida' }).toasts, []);
    assert.deepEqual(pierde(noche()), intacto);
    // Cansado, para que la siesta de mediodía sí ocurra: descansado no se duerme de día.
    azar = 0;
    const siesta = noche({ perro: 'cuida', hora: 12, energia: 20 }), siestaSolo = noche({ hora: 12, energia: 20 });
    assert.ok(siesta.durmio && siestaSolo.durmio, 'la siesta ocurrió');
    assert.deepEqual(siesta.toasts, []);
    assert.deepEqual(pierde(siestaSolo), intacto);
    // Con paredes no entra nadie: El Chato no tiene a quién espantar.
    assert.deepEqual(noche({ perro: 'cuida', paredes: true }).toasts, []);
  } finally { random.mock.restore(); mock.timers.reset(); }
});
