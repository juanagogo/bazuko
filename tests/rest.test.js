import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { Player } from '../src/entities/Player.js';
import { Input } from '../src/core/Input.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { DailyMissionSystem } from '../src/systems/DailyMissionSystem.js';
import { BENCH_SLEEP_DURATION } from '../src/character/BenchSleep.js';
import { BENCH_SIDE, benchSeatPoint } from '../src/world/bogota/benchSeats.js';
import { RESIDENCIA, BANCA, restMapInfo } from '../src/systems/Rest.js';
import { ITEMS } from '../src/data/items.js';
import { textoDelPrompt } from '../src/ui/HUD.js';
import { pasarTexto } from '../src/ui/pictos.js';

test.beforeEach(() => { globalThis.window = new EventTarget(); });

function fixture() {
  const stats = new StatsSystem();
  Object.assign(stats, { dinero: 9000, energia: 10, salud: 60, animo: 20, higiene: 40 });
  const input = new Input(), player = new Player(new THREE.Scene(), input, stats);
  player.position.set(0, 0, 0); player.root.position.copy(player.position);
  const banca = { kind: 'bench', position: new THREE.Vector3(), spot: { x: 0, y: 0, z: 0, rot: Math.PI / 2 } };
  const residencia = { kind: 'residencia', position: new THREE.Vector3(20, 0, 0) };
  const game = Object.assign(Object.create(Game.prototype), {
    stats, player, built: {}, input, benches: [banca], street: { residencia },
    world: { active: { npcs: [] } }, inventory: new InventorySystem(),
    clock: { hour: 22, day: 1, isNight: true },
    _save() { this.saved = { stats: this.stats.serialize(), clock: { ...this.clock },
      inventory: this.inventory.serialize(), dailyMissions: this.dailyMissions?.serialize() }; }
  });
  player.game = game;
  return { game, player, stats, banca, residencia, input };
}

test('la residencia cobra una vez por ocho horas, conserva pertenencias y guarda al despertar', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0); // en un cuarto de pago no hay tirada de robo
  const { game, player, stats, residencia } = fixture();
  player.position.copy(residencia.position);
  game.inventory.add(ITEMS.porro, 1); game.inventory.add(ITEMS.cuchillo, 1);
  const before = JSON.stringify(game.inventory.serialize());
  assert.equal(game.sleep({ residencia }), true);
  assert.equal(stats.dinero, 9000 - RESIDENCIA.precio);
  assert.equal(game.sleep({ residencia }), false);
  assert.equal(stats.dinero, 1000);
  assert.equal(game.clock.hour, 6); assert.equal(game.clock.day, 2);
  assert.equal(stats.energia, 90); assert.equal(stats.higiene, 65);
  assert.equal(player.root.visible, false);
  assert.equal(JSON.stringify(game.inventory.serialize()), before);
  t.mock.timers.tick(1200);
  assert.equal(player.root.visible, true); assert.equal(game.isSleeping, false);
  assert.equal(player.action, null); assert.equal(game.saved.stats.dinero, 1000);
  assert.ok(player.position.equals(residencia.position));
});

test('la banca deja dormir sin base: recuperación menor y robo local, aunque el cambuche tenga paredes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0);
  const { game, player, stats, banca } = fixture();
  game.built = { paredes: true, cama: true, techo: true, fogon: true };
  game.street.caleta = { robOnSleep() { assert.fail('la banca no expone la caleta'); } };
  game.inventory.add(ITEMS.carton, 2);
  player.position.z = -.5;
  const ground = player.position.y;
  assert.equal(game.sleep({ banca }), true);
  assert.equal(stats.dinero, 7200);
  assert.equal(stats.energia, 10 + BANCA.energia);
  assert.equal(stats.salud, 60); assert.equal(stats.higiene, 35);
  assert.equal(game.inventory.count('carton'), 2);
  assert.equal(player.root.visible, true); assert.equal(player.sleepingOnBench, true);
  const seated = player.position.clone();
  for (let i = 0; i < 125; i++) game._updateSleepAnimation(1 / 60);
  const newspaper = player.root.getObjectByName('periodico-banca');
  assert.equal(newspaper.visible, true);
  assert.ok(newspaper.scale.x > 1);
  assert.ok(Math.abs(player.character.group.position.x + BENCH_SIDE) < .001, 'el cuerpo se centra visualmente en el asiento');
  assert.ok(Math.abs(player.character.ragdollRig.hips.rotation.z) > 1.5);
  assert.ok(player.position.equals(seated)); assert.equal(player.position.y, ground);
  assert.equal(player.benchSeat.target, banca);
  assert.equal(game.clock.hour, 1); assert.equal(game.clock.day, 2);
  t.mock.timers.tick(1200);
  assert.equal(game.isSleeping, true, 'la animación visible determina cuándo termina el descanso');
  for (let i = 0; i < 120; i++) game._updateSleepAnimation(1 / 60);
  assert.equal(game.isSleeping, false); assert.equal(player.sleepingOnBench, false);
  assert.equal(player.action, null); assert.equal(player.benchSeat.target, banca);
  assert.equal(newspaper.visible, false);
  assert.equal(player.character.group.position.x, 0);
  game.input.keys.KeyW = true;
  player.update(1 / 60, null, null, () => 0, []);
  assert.equal(player.benchSeat, null, 'puede levantarse y caminar después');
});

test('una banca tiene dos plazas separadas, y el jugador toma el extremo libre', () => {
  const { game, player, banca } = fixture();
  const spot = banca.spot;
  const npc = side => {
    const { x, z } = benchSeatPoint(spot, side);
    return { position: new THREE.Vector3(x, 0, z), fijo: { benchSeat: { spot, side }, out: false } };
  };
  const left = npc(BENCH_SIDE), right = npc(-BENCH_SIDE);
  const npcs = game.world.active.npcs;
  npcs.push(left);
  player.position.copy(left.position);
  assert.equal(player.sitOnBench(banca), true);
  assert.equal(player.benchSeat.side, -BENCH_SIDE);
  assert.ok(Math.abs(player.position.distanceTo(left.position) - 2 * BENCH_SIDE) < 1e-8);
  assert.match(game.restBlocked({ banca }), /ocupada/);
  player.standFromBench();
  npcs.push(right);
  assert.equal(player.sitOnBench(banca), false);
  assert.equal(player.benchSeat, null);
  assert.equal(textoDelPrompt({ player, currentTarget: banca, currentTargetType: 'bench' }), 'Banca ocupada');
  left.fijo.out = true;
  assert.equal(player.sitOnBench(banca), false, 'el peatón aún está levantándose en su plaza');
  left.position.x += 1;
  assert.equal(player.sitOnBench(banca), true);
  assert.equal(player.benchSeat.side, BENCH_SIDE);
});

test('sin dinero, lejos, montado, en el aire o con banca ocupada no cobra ni adelanta el reloj', () => {
  const changes = [
    f => { f.stats.dinero = RESIDENCIA.precio - 1; },
    f => { f.player.position.x = 100; },
    f => { f.player.bicycle = {}; },
    f => { f.player.isGrounded = false; },
    f => { f.player.isSwimming = true; },
    f => { f.game._deathPending = true; },
  ];
  for (const change of changes) {
    const f = fixture(); f.player.position.copy(f.residencia.position); change(f);
    const cash = f.stats.dinero;
    assert.equal(f.game.sleep({ residencia: f.residencia }), false);
    assert.equal(f.stats.dinero, cash); assert.equal(f.game.clock.hour, 22);
    assert.equal(f.game.isSleeping, undefined);
  }
  const f = fixture();
  f.game.world.active.npcs.push({ position: f.banca.position.clone() });
  assert.match(f.game.restBlocked({ banca: f.banca }), /ocupada/);
  assert.equal(f.game.sleep({ banca: f.banca }), false);
  assert.equal(f.game.sleep({ banca: { ...f.banca } }), false);
});

test('el descanso diurno completa y guarda la misión de descanso después de entregar el premio', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => .99);
  const { game, banca } = fixture();
  game.clock.hour = 12; game.clock.isNight = false;
  const missions = new DailyMissionSystem(game); game.dailyMissions = missions;
  missions.init(1);
  try {
    assert.equal(game.sleep({ banca }), true);
    game._updateSleepAnimation(BENCH_SLEEP_DURATION);
    assert.equal(missions.missions.find(m => m.type === 'noche').claimed, true);
    assert.equal(game.saved.dailyMissions.missions.find(m => m.type === 'noche').claimed, true);
    assert.equal(game.saved.stats.dinero, 11500);
  } finally { missions.dispose(); }
});

test('mapa y radar diferencian alojamiento gratuito y pagado con dibujos y nombres propios', () => {
  const { game, residencia } = fixture();
  game.street.hogar = { position: new THREE.Vector3(40, 0, 0) };
  const pois = game._getPOIs();
  const free = pois.find(p => /Hogar de paso/.test(p.name));
  const paid = pois.find(p => /Residencia El Descanso/.test(p.name));
  assert.match(free.name, /gratis/); assert.match(paid.name, /8\.000/);
  assert.notEqual(pasarTexto(free.icon), pasarTexto(paid.icon), 'también son distintos en la letra del juego');
  assert.notEqual(free.color, paid.color);
  assert.equal(paid.x, residencia.position.x); assert.equal(paid.z, residencia.position.z);
  assert.equal(paid.fijo, true); assert.equal(free.fijo, true);
  assert.equal(paid.rest.type, 'residencia'); assert.equal(free.rest.type, 'refugio');
  assert.match(textoDelPrompt({ currentTarget: residencia, currentTargetType: 'residencia' }), /8\.000/);
  assert.match(textoDelPrompt({ currentTarget: {}, currentTargetType: 'bench' }), /\[Q\] Dormir/);
});

test('las condiciones del mapa siguen la construcción, el horario y el cupo del hogar', () => {
  assert.equal(restMapInfo('cambuche').status, 'build');
  assert.equal(restMapInfo('cambuche', { built: { base: true } }).status, 'ready');
  assert.equal(restMapInfo('refugio', { hour: 12, day: 1 }).status, 'closed');
  assert.equal(restMapInfo('refugio', { hour: 22, day: 1 }).status, 'ready');
  assert.equal(restMapInfo('residencia').price, RESIDENCIA.precio);
});

test('pasar medianoche completa el descanso pendiente y guarda las misiones del nuevo día', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => .99);
  const { game, banca } = fixture();
  const missions = new DailyMissionSystem(game); game.dailyMissions = missions;
  missions.init(1);
  const previous = missions.missions.find(m => m.type === 'noche');
  try {
    assert.equal(game.sleep({ banca }), true);
    game._updateSleepAnimation(BENCH_SLEEP_DURATION);
    assert.equal(previous.claimed, true);
    assert.equal(game.saved.stats.dinero, 11500);
    assert.equal(game.saved.dailyMissions.currentDay, 2);
    assert.equal(game.saved.dailyMissions.missions.some(m => m.id === previous.id), false);
  } finally { missions.dispose(); }
});
