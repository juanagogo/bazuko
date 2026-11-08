// Pruebas del robo express: probabilidad, enfriamiento y puertas, y los tres desenlaces (entregar, correr, pelear).
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, setWeapon() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { RoboExpressSystem, ROBO, robberyChance, ZONE_RISK } = await import('../src/systems/RoboExpressSystem.js');
const { straightRoute } = await import('../src/systems/LimpiezaSocialSystem.js');
const { ROBBER, DEMANDS } = await import('../src/entities/RobberMember.js');

let toasts;
beforeEach(() => {
  ROBO.armed = false; ROBO.contra = false;
  globalThis.window = new EventTarget();
  toasts = [];
  window.addEventListener('toast', e => toasts.push(e.detail.text));
});

function setup({ random = () => .3, money = 10000, items = [], salud = 100 } = {}) {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(), isRagdollActive: false, extraMeleeTargets: null, receiveHit() {} };
  const stats = { salud, dinero: money };
  const inventory = {
    items: items.map(name => ({ name, qty: 1 })),
    removeAt(i) { this.items.splice(i, 1); }
  };
  const people = [], extras = [];
  const system = new RoboExpressSystem(scene, { player, stats, inventory, random });
  system.setup({ isWalkableAt: () => true, getGroundHeight: () => 0 },
    [straightRoute(new THREE.Vector3(6, 0, -60), new THREE.Vector3(0, 0, 1), 120)], people, { extraMotos: extras });
  return { system, player, stats, inventory, people, extras };
}

const run = (system, seconds, ctx = {}, step = 1 / 30) => { for (let t = 0; t < seconds; t += step) system.update(step, ctx); };
function untilDemand(system) {
  system.elapsed = ROBO.grace + 1; system.cooldown = 0;
  assert.equal(system.trigger(), true);
  for (let i = 0; i < 600 && !system.awaitingAnswer; i++) system.update(1 / 30, {});
  assert.equal(system.awaitingAnswer, true);
}

test('la probabilidad sube de noche, en zonas pobres y con más plata encima, y nunca pasa del tope', () => {
  const base = robberyChance({ hour: 12, zone: 'andenes', money: 0 });
  assert.ok(base > 0 && base < .05, 'es raro');
  assert.ok(robberyChance({ hour: 23, zone: 'andenes', money: 0 }) > base * 2);
  assert.ok(robberyChance({ hour: 3, zone: 'andenes', money: 0 }) > base * 2);
  assert.ok(robberyChance({ hour: 19, zone: 'andenes', money: 0 }) > base);
  assert.ok(ZONE_RISK.cartucho > ZONE_RISK.andenes && ZONE_RISK.barrio > ZONE_RISK.andenes && ZONE_RISK.andenes > ZONE_RISK.chapinero);
  assert.ok(robberyChance({ hour: 12, zone: 'cartucho', money: 0 }) > robberyChance({ hour: 12, zone: 'chapinero', money: 0 }));
  assert.ok(robberyChance({ hour: 12, zone: 'andenes', money: 30000 }) > robberyChance({ hour: 12, zone: 'andenes', money: 1000 }));
  assert.ok(robberyChance({ hour: 23, zone: 'cartucho', money: 1e9 }) <= ROBO.maxChance);
});

test('nada empieza en los primeros minutos, durante el enfriamiento, en el cambuche, en escenas ni con otro robo en curso', () => {
  const { system } = setup();
  assert.equal(system.canStart({}), false, 'partida nueva: gracia');
  system.elapsed = ROBO.grace;
  system.cooldown = 0;
  assert.equal(system.canStart({}), true);
  assert.equal(system.canStart({ blocked: true }), false, 'escena, sueño, muerte o arresto');
  assert.equal(system.canStart({ allowSpawn: false }), false, 'cerca del cambuche');
  system.cooldown = 5;
  assert.equal(system.canStart({}), false, 'enfriamiento');
  system.cooldown = 0;
  system.trigger();
  assert.equal(system.canStart({}), false, 'ya hay uno en curso');
});

test('la tirada dispara el robo según la probabilidad y deja el enfriamiento puesto', () => {
  let roll = 0;
  const { system } = setup({ random: () => roll });
  system.elapsed = ROBO.grace; system.cooldown = 0;
  roll = .9;
  run(system, ROBO.checkEvery + 1, { hour: 23, zone: 'cartucho' });
  assert.equal(system.active, false, 'tirada alta: no pasa nada');
  roll = 0;
  run(system, ROBO.checkEvery + 1, { hour: 23, zone: 'cartucho' });
  assert.equal(system.active, true, 'tirada baja: sale la moto');
  assert.equal(system.cooldown, ROBO.cooldown);
});

test('con el robo en curso no cuesta nada que no haya moto: quieto no mueve ni dibuja', () => {
  const { system, extras, player } = setup();
  run(system, 5, { hour: 12 });
  assert.equal(system.active, false);
  assert.equal(extras.length, 0);
  assert.equal(system.moto.drawn, false);
  assert.equal(system.robber.root.visible, false);
  assert.equal(player.extraMeleeTargets, null);
});

test('la moto frena junto al jugador, se baja el parrillero y exige', () => {
  const { system, player, people, extras } = setup();
  system.elapsed = ROBO.grace + 1; system.cooldown = 0;
  system.trigger();
  assert.equal(system.state, 'arriving');
  assert.equal(extras.length, 1, 'el lote de motos la dibuja');
  assert.ok(system.moto.group.position.distanceTo(player.position) > 30, 'arranca lejos');
  run(system, 12);
  assert.ok(['demand'].includes(system.state));
  assert.equal(system.moto.occupancy[0], true, 'el conductor sigue en la moto');
  assert.equal(system.moto.occupancy[2], false, 'el parrillero se bajó');
  assert.ok(system.robber.position.distanceTo(player.position) < 3, 'llegó a exigir');
  assert.ok(['cuchillo', 'pistola'].includes(system.robber.weapon));
  assert.ok(people.includes(system.robber));
  assert.ok(player.extraMeleeTargets.includes(system.robber), 'se le puede pegar');
  assert.ok(toasts.some(t => /atraco/i.test(t)));
});

test('entregar: pierde una parte de la plata, sin heridas, y se van', () => {
  const { system, stats } = setup({ money: 10000 });
  untilDemand(system);
  assert.equal(system.rob(), true);
  assert.equal(system.outcome, 'entrego');
  assert.ok(stats.dinero < 10000 && stats.dinero >= 10000 * (1 - ROBO.lootShare[1]) - 100, `quedó ${stats.dinero}`);
  assert.equal(stats.salud, 100, 'sin heridas');
  assert.ok(toasts.some(t => /robaron \$/i.test(t)));
  run(system, 15);
  assert.equal(system.active, false, 'se fueron y la calle quedó limpia');
  assert.equal(system.moto.drawn, false);
});

test('entregar sin plata se lleva un objeto del costal; sin nada, solo un empujón', () => {
  const a = setup({ money: 200, items: ['Lata de atún', 'Pan'] });
  untilDemand(a.system);
  a.system.rob();
  assert.equal(a.inventory.items.length, 1, 'se llevó un objeto');
  assert.equal(a.stats.dinero, 200);
  assert.ok(toasts.some(t => /quitaron del costal/i.test(t)));
  const b = setup({ money: 0, items: [] });
  untilDemand(b.system);
  b.system.rob();
  assert.equal(b.stats.dinero, 0);
  assert.equal(b.stats.salud, 100);
});

test('si el jugador se queda quieto, el parrillero lo revisa solo tras su paciencia', () => {
  const { system, stats } = setup({ money: 8000 });
  untilDemand(system);
  run(system, ROBO.patience - 1);
  assert.equal(system.state, 'demand');
  run(system, 3);
  assert.notEqual(system.state, 'demand');
  assert.ok(stats.dinero < 8000);
});

test('correr: se devuelven a la moto sin quitarle nada, y a veces lo persiguen un rato', () => {
  const quiet = setup({ random: () => .9, money: 5000 });
  untilDemand(quiet.system);
  quiet.player.position.set(0, 0, 30);
  run(quiet.system, 1.2);
  assert.equal(quiet.system.outcome, 'huyo');
  run(quiet.system, 15);
  assert.equal(quiet.system.active, false);
  assert.equal(quiet.stats.dinero, 5000);
  assert.equal(quiet.stats.salud, 100);

  const chaser = setup({ random: () => .1, money: 5000 });
  untilDemand(chaser.system);
  chaser.player.position.set(0, 0, 25);
  let chased = false;
  for (let i = 0; i < 30 * 40; i++) { chaser.system.update(1 / 30, {}); if (chaser.system.state === 'chase') chased = true; if (!chaser.system.active) break; }
  assert.equal(chased, true, 'hubo persecución en moto');
  assert.equal(chaser.system.active, false, 'la persecución es breve');
  assert.equal(chaser.stats.dinero, 5000);
});

test('pelear: pegarle al ladrón lo pone a atacar; el cuchillo hiere dentro de su rango', () => {
  const { system, stats, player } = setup({ random: () => .3 });
  untilDemand(system);
  assert.equal(system.robber.weapon, 'cuchillo');
  system.robber.takeHit({ damage: 5, attacker: null });
  assert.equal(system.state, 'fight');
  assert.equal(system.outcome, 'peleo');
  let hurt = 0;
  system.onPlayerHurt = d => { hurt += d; };
  run(system, 6);
  assert.ok(stats.salud < 100, 'el cuchillo hirió');
  assert.ok(100 - stats.salud >= ROBBER.knifeDamage[0], 'al menos un cuchillazo completo');
  assert.equal(100 - stats.salud, hurt);
  assert.ok(toasts.some(t => /cuchillo/i.test(t)));
  assert.equal(player.extraMeleeTargets?.includes(system.robber), true);
});

test('pelear con pistola: dispara, avisa a la policía y a veces acierta', () => {
  const { system, stats } = setup({ random: () => .9 });
  untilDemand(system);
  assert.equal(system.robber.weapon, 'pistola');
  let shots = 0;
  system.onShot = () => { shots++; };
  system.robber.takeHit({ damage: 5, attacker: null });
  run(system, 12);
  assert.ok(shots >= 2, `disparos: ${shots}`);
  assert.ok(stats.salud < 100 || toasts.some(t => /zumbando/.test(t)));
});

test('el ladrón herido de gravedad huye y deja la calle limpia; la salud nunca baja de cero', () => {
  const { system, stats } = setup({ salud: 12 });
  untilDemand(system);
  system.robber.takeHit({ damage: 5 });
  run(system, 20);
  assert.ok(stats.salud >= 0);
  const second = setup({});
  untilDemand(second.system);
  second.system.robber.takeHit({ damage: 5 });
  second.system.robber.health = 0;
  run(second.system, 25);
  assert.equal(second.system.active, false);
  assert.ok(toasts.some(t => /salió corriendo/.test(t)));
});

test('al morir o recargar todo vuelve a la calma: moto fuera, nadie a la vista y con enfriamiento', () => {
  const { system, player, people, extras } = setup();
  untilDemand(system);
  system.cooldown = 0;
  system.reset();
  assert.equal(system.state, 'idle');
  assert.equal(system.moto.drawn, false);
  assert.equal(system.moto.occupancy[2], true, 'la moto queda lista con su parrillero');
  assert.equal(extras.length, 0);
  assert.equal(people.includes(system.robber), false);
  assert.equal(player.extraMeleeTargets, null);
  assert.equal(system.robber.root.visible, false);
  assert.ok(system.cooldown >= ROBO.afterReset, 'unos minutos de calma');
  system.reset();
  assert.equal(system.state, 'idle');
  system.elapsed = ROBO.grace + 1;
  assert.equal(system.canStart({}), false, 'sigue el enfriamiento');
  run(system, ROBO.afterReset + 1);
  assert.equal(system.canStart({}), true);
  assert.equal(system.trigger(), true, 'y puede volver a pasar');
});

test('morirse en pleno robo lo deshace solo', () => {
  const { system, stats } = setup();
  untilDemand(system);
  stats.salud = 0;
  system.update(1 / 30, { blocked: true });
  assert.equal(system.active, false);
});

test('el truco lo dispara ya, aunque no haya calle cerca ni cooldown', () => {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(500, 0, 500), extraMeleeTargets: null };
  const system = new RoboExpressSystem(scene, { player, stats: { salud: 100, dinero: 0 }, random: () => .5 });
  system.setup({}, [], [], { extraMotos: [] });
  assert.equal(system.trigger(), false);
  assert.equal(system.trigger({ force: true }), true);
  assert.equal(system.state, 'arriving');
  assert.equal(system.trigger({ force: true }), false, 'uno a la vez');
});

test('lo que grita el parrillero es corto y de calle', () => {
  assert.ok(DEMANDS.length >= 5 && DEMANDS.every(l => l.length < 40));
  assert.ok(DEMANDS.some(l => /gonorrea/.test(l)) && DEMANDS.some(l => /celular/.test(l)) && DEMANDS.some(l => /plata/.test(l)));
});
