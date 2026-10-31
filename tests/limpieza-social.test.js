import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

// La IA y la camioneta son reales; solo se sustituye la carga de modelos GLB.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, setWeapon() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { LimpiezaSocialSystem, LIMPIEZA, straightRoute } = await import('../src/systems/LimpiezaSocialSystem.js');
const { SQUAD, squadLook, THUG_INSULTS } = await import('../src/entities/SquadMember.js');
const { TrafficRoute } = await import('../src/world/bogota/TrafficRoute.js');
const { MASK_FIT } = await import('../src/character/props.js');

let toasts;
beforeEach(() => {
  globalThis.window = new EventTarget();
  toasts = [];
  window.addEventListener('toast', e => toasts.push(e.detail.text));
});

function setup({ routes = [straightRoute(new THREE.Vector3(7, 0, -40), new THREE.Vector3(0, 0, 1), 80)], random = () => .5 } = {}) {
  const scene = new THREE.Scene();
  const player = {
    position: new THREE.Vector3(), hits: 0,
    receiveHit() { this.hits++; }
  };
  const stats = { salud: 100 };
  const people = [];
  const system = new LimpiezaSocialSystem(scene, { player, stats, random });
  system.setup({ isWalkableAt: () => true, getGroundHeight: () => 0 }, routes, people);
  return { system, player, stats, people, scene };
}

function run(system, seconds, ctx = {}, onStep = null, step = 1 / 30) {
  for (let t = 0; t < seconds; t += step) {
    onStep?.(step);
    system.update(step, ctx);
  }
}

test('la camioneta llega por la calle y frena junto al jugador', () => {
  const { system, player } = setup();
  assert.equal(system.trigger(), true);
  assert.equal(system.state, 'arriving');
  const start = system.suv.group.position.clone();
  assert.ok(start.distanceTo(player.position) > 30, 'arranca lejos');
  run(system, 10, {}, null);
  assert.ok(['out', 'stopped'].includes(system.state));
  const suv = system.suv.group.position;
  assert.ok(Math.hypot(suv.x - player.position.x, suv.z - player.position.z) < 9, 'frena cerca del jugador');
});

test('se bajan tres: el jefe señala y da la orden, los otros dos persiguen', () => {
  const { system, people } = setup();
  system.trigger();
  run(system, 8);
  assert.equal(system.state, 'out');
  const [jefe, ...matones] = system.members;
  assert.equal(jefe.role, 'jefe');
  assert.equal(jefe.state, 'order');
  assert.equal(jefe.poseParams.point, 1);
  assert.equal(matones.length, 2);
  assert.ok(matones.every(m => ['chase', 'windup', 'strike', 'recover'].includes(m.state)));
  assert.equal(people.length, 3, 'los carros los respetan mientras están en la calle');
  assert.ok(toasts.some(t => /limpieza social/i.test(t)));
});

test('todos de negro con pasamontañas; el jefe además con gorra', () => {
  const jefe = squadLook('jefe'), maton = squadLook('maton');
  assert.ok(jefe.uniforme && new THREE.Color(jefe.uniforme).getHSL({}).l < .15, 'uniforme negro');
  assert.deepEqual(jefe.accesorios, ['pasamontanas', 'gorra']);
  assert.deepEqual(maton.accesorios, ['pasamontanas']);
  assert.equal(maton.real.calzado, 'botas');
  assert.ok(MASK_FIT.eyes[1] > MASK_FIT.eyes[0]);
  assert.ok(THUG_INSULTS.some(line => /chirrete hijueputa/i.test(line)));
});

test('si lo alcanzan, los cachazos siguen hasta matarlo', () => {
  const { system, player, stats } = setup();
  let hurt = 0;
  system.onPlayerHurt = () => { hurt++; };
  system.trigger();
  run(system, 20); // el jugador se queda quieto
  assert.equal(stats.salud, 0);
  assert.ok(hurt >= 4);
  assert.ok(player.hits >= 4);
  const [min, max] = SQUAD.damage;
  assert.ok(min >= 15 && max <= 35);
});

test('corriendo se les escapa: se cansan, vuelven y la camioneta se va', () => {
  const { system, player, stats, people } = setup();
  system.trigger();
  run(system, 30, {}, (dt) => { if (system.state === 'out') player.position.x -= 6 * dt; });
  assert.ok(stats.salud > 0, 'corriendo a 6 m/s no lo alcanzan');
  assert.ok(toasts.some(t => /cansaron/.test(t)));
  run(system, 90);
  assert.equal(system.active, false);
  assert.equal(system.suv.group.visible, false);
  assert.equal(people.length, 0);
  assert.ok(system.members.every(m => !m.active));
});

test('solo de noche, con probabilidad y con espera entre visitas', () => {
  const { system } = setup({ random: () => 0 });
  run(system, LIMPIEZA.cooldown + LIMPIEZA.checkEvery * 2, { isNight: false });
  assert.equal(system.active, false, 'de día no vienen');
  run(system, LIMPIEZA.checkEvery + 1, { isNight: true, allowSpawn: false });
  assert.equal(system.active, false, 'junto al cambuche no vienen');
  run(system, LIMPIEZA.checkEvery + 1, { isNight: true });
  assert.equal(system.active, true);
  system.reset();
  run(system, LIMPIEZA.checkEvery + 1, { isNight: true });
  assert.equal(system.active, false, 'la siguiente visita espera el enfriamiento');
});

test('en un circuito de tráfico frena en el carril más cercano y sin pisar al jugador', () => {
  const route = new TrafficRoute(0, 100, 0, 100, 3.2);
  const { system, player } = setup({ routes: [route] });
  player.position.set(50, 0, 4); // a 4 m del carril superior (z = 0)
  assert.equal(system.trigger(), true);
  run(system, 10);
  const suv = system.suv.group.position;
  assert.ok(Math.abs(suv.z) < .5, 'va por el carril');
  assert.ok(Math.abs(suv.x - 50) < 4);
});

test('lejos de toda calle no llega', () => {
  const { system, player } = setup();
  player.position.set(-60, 0, 0);
  assert.equal(system.trigger(), false);
});

test('la recuperación los sube a todos y la camioneta desaparece', () => {
  const { system, people } = setup();
  system.trigger();
  run(system, 8);
  system.reset();
  assert.equal(system.active, false);
  assert.equal(people.length, 0);
  assert.equal(system.suv.group.visible, false);
});
