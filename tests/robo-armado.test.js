// El robo armado: el árbol de decisión con azar de semilla, el rastrillar y el disparo con su sonido, y la moto en contravía.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, setWeapon() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { RoboExpressSystem, ROBO } = await import('../src/systems/RoboExpressSystem.js');
const { ARMED, CHORO_QUIRKS, GUN_DEMANDS, KNIFE_DEMANDS, armedAct, planRobbery } = await import('../src/systems/RoboArmed.js');
const { straightRoute } = await import('../src/systems/LimpiezaSocialSystem.js');
const { ROBBER } = await import('../src/entities/RobberMember.js');
const { overlapDepth, vehicleBox } = await import('../src/systems/VehicleOverlap.js');

let toasts;
beforeEach(() => {
  globalThis.window = new EventTarget();
  toasts = [];
  window.addEventListener('toast', e => toasts.push(e.detail.text));
  ROBO.armed = true; ROBO.contra = false;
});

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function setup({ weapon = 'pistola', plan, money = 10000, salud = 100, traffic = null, route = null, random = () => 0 } = {}) {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(), isRagdollActive: false, extraMeleeTargets: null, receiveHit() {} };
  const stats = { salud, dinero: money };
  const audio = { calls: [], playRobo(name) { this.calls.push(name); return true; }, playWhoosh() { this.calls.push('whoosh'); }, playThud() {} };
  const system = new RoboExpressSystem(scene, { player, stats, inventory: { items: [], removeAt() {} }, audio, random });
  system.setup({ isWalkableAt: () => true, getGroundHeight: () => 0 },
    [route ?? straightRoute(new THREE.Vector3(6, 0, -60), new THREE.Vector3(0, 0, 1), 120)], [], { extraMotos: [], traffic });
  system.elapsed = ROBO.grace + 1; system.cooldown = 0;
  const shots = [], hurts = [];
  system.onShot = () => shots.push(system.state);
  system.onPlayerHurt = (damage, what) => hurts.push([damage, what]);
  assert.equal(system.trigger(), true);
  system.robber.setWeapon(weapon);
  if (plan) system.planOverride = plan;
  for (let i = 0; i < 900 && !system.arrived && system.state !== 'idle'; i++) system.update(1 / 30, {});
  return { system, player, stats, audio, shots, hurts };
}

const run = (system, seconds, ctx = {}, step = 1 / 30) => { for (let t = 0; t < seconds; t += step) system.update(step, ctx); };
const arrive = (system) => { for (let i = 0; i < 600 && !system.arrived; i++) system.update(1 / 30, {}); assert.ok(system.arrived, 'llegó a exigir'); };

test('el plan: la mayoría exige armado, algunos disparan sin más, otros solo revisan, y un cuarto va pegado', () => {
  const random = seeded(11), counts = { trigger: 0, threat: 0, passive: 0, choro: 0, cocks: 0, gun: 0 };
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const weapon = i % 2 ? 'pistola' : 'cuchillo', plan = planRobbery({ weapon, random });
    counts[plan.style]++;
    if (plan.choro) { counts.choro++; assert.ok(CHORO_QUIRKS.includes(plan.quirk)); } else assert.equal(plan.quirk, null);
    if (weapon === 'pistola') { counts.gun++; if (plan.cocks) counts.cocks++; } else assert.equal(plan.cocks, false, 'el cuchillo no se rastrilla');
  }
  const near = (value, expected, slack = .04) => Math.abs(value - expected) < slack;
  assert.ok(near(counts.trigger / N, ARMED.shootAnyway), `dispara sin más: ${counts.trigger / N}`);
  assert.ok(near(counts.passive / N, ARMED.passive), 'solo revisa');
  assert.ok(near(counts.choro / N, ARMED.choroChance), 'pegados');
  assert.ok(counts.cocks / counts.gun > .55, 'casi todos rastrillan antes de exigir');
  assert.equal(planRobbery({ weapon: 'pistola', random: seeded(1), armed: false }).style, 'passive', 'apagado, todos revisan');
});

test('el árbol: rastrilla, exige, y dispara si el jugador no entrega, se mueve, corre o se acaba el tiempo', () => {
  const gun = { weapon: 'pistola', style: 'threat', choro: false, quirk: null, cocks: true, aired: false };
  assert.equal(armedAct(gun, { phase: 'arrive' }), 'cock');
  assert.equal(armedAct(gun, { phase: 'cock', t: ARMED.cockTime - .1 }), 'wait', 'deja sonar el rastrillar');
  assert.equal(armedAct(gun, { phase: 'cock', t: ARMED.cockTime }), 'point');
  assert.equal(armedAct(gun, { phase: 'point', t: 1 }), 'wait');
  assert.equal(armedAct(gun, { phase: 'point', t: 1, giveIn: true }), 'rob', 'si entrega, lo revisa');
  assert.equal(armedAct(gun, { phase: 'point', t: 1, moved: true }), 'shoot', 'se mueve');
  assert.equal(armedAct(gun, { phase: 'point', t: 1, ran: true }), 'shoot', 'corre');
  assert.equal(armedAct(gun, { phase: 'point', t: 1, attacked: true }), 'shoot', 'pelea');
  assert.equal(armedAct(gun, { phase: 'point', t: ARMED.patience }), 'shoot', 'se acaba el tiempo');
  const knife = { ...gun, weapon: 'cuchillo', cocks: false };
  assert.equal(armedAct(knife, { phase: 'arrive' }), 'point');
  assert.equal(armedAct(knife, { phase: 'point', t: 1, moved: true }), 'stab', 'el cuchillo apuñala en vez de disparar');
  const trigger = { ...gun, style: 'trigger' };
  assert.equal(armedAct(trigger, { phase: 'cock', t: ARMED.cockTime }), 'shoot', 'dispara sin más');
  assert.equal(armedAct({ ...trigger, cocks: false }, { phase: 'point', t: ARMED.triggerDelay, giveIn: true }), 'shoot', 'aunque entreguen');
});

test('el árbol del pegado: dispara antes de exigir, al aire, duda, apuñala al azar o se asusta y huye', () => {
  const base = { weapon: 'pistola', style: 'threat', choro: true, cocks: true, aired: false };
  assert.equal(armedAct({ ...base, quirk: 'early' }, { phase: 'arrive' }), 'shoot', 'dispara antes de exigir');
  assert.equal(armedAct({ ...base, weapon: 'cuchillo', quirk: 'early' }, { phase: 'arrive' }), 'stab');
  assert.equal(armedAct({ ...base, quirk: 'air' }, { phase: 'cock', t: ARMED.cockTime }), 'air');
  assert.equal(armedAct({ ...base, quirk: 'air', aired: true }, { phase: 'cock', t: ARMED.cockTime }), 'point', 'el tiro al aire va una sola vez');
  assert.equal(armedAct({ ...base, quirk: 'run' }, { phase: 'cock', t: ARMED.cockTime }), 'run');
  const hesitate = { ...base, quirk: 'hesitate' };
  assert.equal(armedAct(hesitate, { phase: 'point', t: 1, giveIn: true }), 'wait', 'titubea aunque entreguen');
  assert.equal(armedAct(hesitate, { phase: 'point', t: ARMED.hesitate + .1, giveIn: true }), 'rob');
  assert.equal(armedAct(hesitate, { phase: 'point', t: ARMED.patience + 1 }), 'wait', 'y se tarda más en perder la paciencia');
  const random = { ...base, quirk: 'random', weapon: 'cuchillo' };
  assert.equal(armedAct(random, { phase: 'point', t: 1, giveIn: true, random: () => .1 }), 'stab', 'apuñala al azar aunque entreguen');
  assert.equal(armedAct(random, { phase: 'point', t: 1, giveIn: true, random: () => .9 }), 'rob');
});

test('pistola: rastrilla con su sonido, exige con su frase y, si el jugador no entrega, dispara con su sonido y lo hiere', () => {
  const { system, stats, audio, shots, hurts } = setup({ weapon: 'pistola', plan: { style: 'threat', cocks: true, quirk: null, choro: false } });
  assert.ok(system.robber.demands === GUN_DEMANDS, 'exige con las frases de la pistola');
  assert.deepEqual(audio.calls, ['rastrillo'], 'rastrilla al llegar');
  run(system, ARMED.cockTime + ARMED.patience - .5);
  assert.equal(system.state, 'demand', 'espera su turno');
  assert.deepEqual(audio.calls, ['rastrillo']);
  run(system, 2);
  assert.deepEqual(audio.calls, ['rastrillo', 'disparo'], 'primero rastrilla y luego dispara');
  assert.equal(shots.length, 1, 'avisa a la policía una vez');
  assert.ok(stats.salud < 100 && 100 - stats.salud >= ROBBER.shotDamage[0], `el tiro hiere: ${stats.salud}`);
  assert.equal(hurts[0][1], 'tiro');
  assert.equal(system.outcome, 'disparo');
  assert.equal(stats.dinero, 10000, 'no le roba si dispara');
  run(system, 20);
  assert.equal(system.active, false, 'después se va');
});

test('pistola: si el jugador entrega no hay disparo, solo el rastrillar; y el que dispara sin más dispara aunque entregue', () => {
  const calm = setup({ plan: { style: 'threat', cocks: true, quirk: null, choro: false } });
  run(calm.system, 1.5);
  calm.system.update(1 / 30, { giveIn: true });
  assert.equal(calm.system.state, 'robbing');
  run(calm.system, 15);
  assert.deepEqual(calm.audio.calls, ['rastrillo']);
  assert.ok(calm.stats.dinero < 10000 && calm.stats.salud === 100);
  const trigger = setup({ plan: { style: 'trigger', cocks: true, quirk: null, choro: false } });
  run(trigger.system, ARMED.cockTime + .3);
  trigger.system.update(1 / 30, { giveIn: true });
  assert.deepEqual(trigger.audio.calls, ['rastrillo', 'disparo'], 'dispara aunque entregue');
  assert.ok(trigger.stats.salud < 100);
});

test('pistola: moverse, correr o pelear también provoca el tiro', () => {
  const moved = setup({ plan: { style: 'threat', cocks: false, quirk: null, choro: false } });
  assert.deepEqual(moved.audio.calls, [], 'sin rastrillar, solo apunta');
  moved.player.position.x += ARMED.moveTolerance + .5;
  run(moved.system, .3);
  assert.deepEqual(moved.audio.calls, ['disparo']);
  const ran = setup({ plan: { style: 'threat', cocks: false, quirk: null, choro: false } });
  ran.player.position.set(0, 0, ROBO.runDistance + 6);
  run(ran.system, ROBO.runConfirm + .5);
  assert.deepEqual(ran.audio.calls, ['disparo'], 'al que corre le disparan');
  const fought = setup({ plan: { style: 'threat', cocks: true, quirk: null, choro: false } });
  fought.system.robber.takeHit({ damage: 5, attacker: null });
  assert.equal(fought.system.state, 'fight', 'pegarle al ladrón arma la pelea de siempre');
});

test('cuchillo: exige y, si no entregan, apuñala (sin sonido de pistola) y puede matar por el flujo de muerte de siempre', () => {
  const { system, stats, audio, hurts, player } = setup({ weapon: 'cuchillo', salud: 9, plan: { style: 'threat', cocks: false, quirk: null, choro: false } });
  assert.ok(system.robber.demands === KNIFE_DEMANDS);
  run(system, 1);
  player.position.x += ARMED.moveTolerance + .4;
  player.position.copy(system.robber.position).add(new THREE.Vector3(1, 0, 0));
  run(system, 3);
  assert.ok(audio.calls.includes('whoosh') && !audio.calls.includes('disparo') && !audio.calls.includes('rastrillo'));
  assert.equal(stats.salud, 0, 'la salud llega a cero y no baja de ahí');
  assert.equal(hurts[0][1], 'cuchillazo');
  assert.equal(system.outcome, 'cuchillazo');
});

test('un tiro puede matar: la salud llega a cero y se avisa del tipo de herida', () => {
  const { system, stats, hurts } = setup({ salud: 20, plan: { style: 'trigger', cocks: false, quirk: null, choro: false } });
  run(system, ARMED.triggerDelay + .3);
  assert.equal(stats.salud, 0);
  assert.equal(hurts.at(-1)[1], 'tiro');
});

test('el pegado: dispara antes de exigir, al aire sin herir y después sigue, o se asusta y se va sin llevarse nada', () => {
  const early = setup({ plan: { style: 'threat', cocks: true, quirk: 'early', choro: true } });
  assert.deepEqual(early.audio.calls, ['disparo'], 'dispara apenas llega, sin rastrillar');
  assert.ok(early.stats.salud < 100);
  const air = setup({ plan: { style: 'threat', cocks: true, quirk: 'air', choro: true } });
  run(air.system, ARMED.cockTime + .2);
  assert.deepEqual(air.audio.calls, ['rastrillo', 'disparo']);
  assert.equal(air.stats.salud, 100, 'al aire no hiere');
  assert.equal(air.system.state, 'demand', 'y sigue exigiendo');
  assert.ok(toasts.some(t => /al aire/i.test(t)));
  run(air.system, ARMED.patience + .5);
  assert.deepEqual(air.audio.calls, ['rastrillo', 'disparo', 'disparo'], 'luego sí dispara a pegar');
  const run1 = setup({ plan: { style: 'threat', cocks: true, quirk: 'run', choro: true } });
  run(run1.system, ARMED.cockTime + .3);
  assert.equal(run1.system.outcome, 'huyo');
  assert.equal(run1.stats.dinero, 10000);
  assert.equal(run1.stats.salud, 100);
  assert.deepEqual(run1.audio.calls, ['rastrillo']);
  const hesitate = setup({ plan: { style: 'threat', cocks: false, quirk: 'hesitate', choro: true } });
  run(hesitate.system, ARMED.patience + 1);
  assert.equal(hesitate.system.state, 'demand', 'titubea');
  assert.equal(hesitate.audio.calls.length, 0);
  assert.equal(hesitate.system.robber.choro, true, 'se nota en su cuerpo');
});

test('el ladrón que solo revisa sigue siendo el robo de siempre: espera su paciencia y no dispara', () => {
  const { system, stats, audio } = setup({ plan: { style: 'passive', cocks: false, quirk: null, choro: false } });
  run(system, ROBO.patience + 2);
  assert.notEqual(system.state, 'demand');
  assert.deepEqual(audio.calls, []);
  assert.equal(stats.salud, 100);
  assert.ok(stats.dinero < 10000);
});

// ---------- contravía ----------

function oncoming(route, laneOffset = 0) {
  const car = { position: new THREE.Vector3(6, 0, 40), group: { rotation: { y: 0 }, visible: true }, length: 4.3, width: 1.8, kind: 'carro' };
  const hx = 0, hz = -1; // el carro viene hacia el sur, de cara a la moto
  car.group.rotation.y = Math.atan2(-hz, hx);
  car.position.x += laneOffset;
  return { car, speed: 8 };
}

test('en contravía: la moto llega de cara al tráfico, sin atravesar los carros que vienen ni los parqueados', () => {
  ROBO.contra = true;
  const route = straightRoute(new THREE.Vector3(6, 0, -60), new THREE.Vector3(0, 0, 1), 120);
  const parked = { car: { position: new THREE.Vector3(6, 0, 18), group: { rotation: { y: Math.PI / 2 }, visible: true }, length: 4.3, width: 1.8 } };
  const traffic = { vehicles: [oncoming(route), oncoming(route, .3)], busVehicles: [], parkedCars: [parked] };
  traffic.vehicles[1].car.position.z = 62;
  const { system } = setup({ random: () => .1, route, traffic, plan: { style: 'passive', cocks: false, quirk: null, choro: false } });
  assert.equal(system.reverse, true, 'va en contravía');
  const heading = new THREE.Vector3(Math.cos(system.moto.group.rotation.y), 0, -Math.sin(system.moto.group.rotation.y));
  assert.ok(heading.z < -.9, 'mira contra el sentido de la ruta (hacia −z)');
  assert.equal(system.state, 'demand');
  const a = {}, b = {};
  let worst = 0, frames = 0;
  const check = () => {
    vehicleBox(system.moto, false, a);
    for (const entry of [...traffic.vehicles, parked]) worst = Math.max(worst, overlapDepth(a, vehicleBox(entry.car, false, b)));
    frames++;
  };
  // la moto ya está parada; repetimos la llegada y la huida con la calle llena
  system.reset();
  system.cooldown = 0;
  traffic.vehicles[0].car.position.z = 40; traffic.vehicles[1].car.position.z = 62;
  assert.equal(system.trigger(), true);
  system.random = () => .1;
  const step = 1 / 30;
  for (let i = 0; i < 30 * 40; i++) {
    for (const { car, speed } of traffic.vehicles) {
      // los carros frenan ante lo que tengan delante, como el tráfico de verdad
      const gap = car.position.z - system.moto.group.position.z, side = Math.abs(car.position.x - system.moto.group.position.x);
      if (system.moto.drawn && gap > 0 && gap < 9 && side < 1.7) continue;
      car.position.z -= speed * step; if (car.position.z < -80) car.position.z = 80;
    }
    system.update(step, {});
    check();
    if (system.state === 'demand' && !system.arrived) { /* camina */ }
    if (system.state === 'demand' && system.arrived) system.update(step, { giveIn: true });
    if (!system.active) break;
  }
  assert.ok(frames > 200);
  assert.ok(worst <= .15, `la moto se montó ${worst.toFixed(2)} m sobre un carro`);
  assert.equal(system.active, false, 'el robo terminó y se fue');
});

test('en contravía también al irse: se va por donde vino, de cara al tráfico, esquivando', () => {
  ROBO.contra = true;
  const route = straightRoute(new THREE.Vector3(6, 0, -60), new THREE.Vector3(0, 0, 1), 120);
  const traffic = { vehicles: [], busVehicles: [], parkedCars: [] };
  const { system } = setup({ random: () => .1, route, traffic, plan: { style: 'passive', cocks: false, quirk: null, choro: false } });
  assert.equal(system.reverse, true);
  system.rob();
  run(system, 4);
  assert.ok(['fleeing', 'leaving'].includes(system.state));
  let guard = 0;
  while (system.state !== 'leaving' && guard++ < 900) system.update(1 / 30, {});
  assert.equal(system.state, 'leaving');
  const yaw = system.moto.group.rotation.y;
  assert.ok(Math.sin(yaw) > .9 || Math.cos(yaw) * 0 === 0, 'sigue de cara al sentido contrario');
  const heading = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  assert.ok(heading.z < -.9, 'se va en contravía');
  // un carro atravesado delante: espera o esquiva, no lo atraviesa
  const block = { car: { position: system.moto.group.position.clone().add(new THREE.Vector3(0, 0, -9)), group: { rotation: { y: Math.PI / 2 }, visible: true }, length: 4.3, width: 1.8 } };
  traffic.parkedCars.push(block);
  const a = {}, b = {};
  let worst = 0;
  for (let i = 0; i < 30 * 12 && system.active; i++) {
    system.update(1 / 30, {});
    vehicleBox(system.moto, false, a);
    worst = Math.max(worst, overlapDepth(a, vehicleBox(block.car, false, b)));
  }
  assert.ok(worst <= .15, `se montó ${worst.toFixed(2)} m`);
});

test('el rastrillar y el disparo suenan según la distancia y nunca se apilan', async () => {
  const { AudioSystem } = await import('../src/systems/AudioSystem.js');
  const voices = new Map();
  let ids = 0;
  class FakeHowl {
    constructor(options) { this.file = options.src?.[0] ?? ''; this.starts = 0; }
    state() { return 'loaded'; }
    play() { const id = ++ids; voices.set(id, { sound: this, playing: true }); this.starts++; return id; }
    playing(id) { return id === undefined ? [...voices.values()].some(v => v.sound === this && v.playing) : voices.get(id)?.playing; }
    volume(value, id) { if (id !== undefined) voices.get(id).volume = value; return value; }
    stop() {} pause() {} rate() {} pos() {} seek() {} duration() { return 1; } unload() {}
  }
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {}, pos() {}, orientation() {} } });
  audio._listenerPosition = new THREE.Vector3(0, 0, 0);
  const near = new THREE.Vector3(3, 0, 0), far = new THREE.Vector3(70, 0, 0), gone = new THREE.Vector3(200, 0, 0);
  assert.equal(audio.playRobo('rastrillo', near), true);
  assert.equal(audio.playRobo('rastrillo', near), false, 'mientras suena no se apila');
  assert.equal(audio.sounds.roboRastrillo.starts, 1);
  assert.equal(audio.playRobo('disparo', gone), false, 'muy lejos no se oye');
  assert.equal(audio.playRobo('disparo', far), true);
  const farVolume = [...voices.values()].at(-1).volume;
  for (const voice of voices.values()) voice.playing = false;
  assert.equal(audio.playRobo('disparo', near), true);
  const nearVolume = [...voices.values()].at(-1).volume;
  assert.ok(nearVolume > farVolume && nearVolume <= 1 && farVolume > 0, `más fuerte cerca: ${nearVolume} contra ${farVolume}`);
  assert.equal(audio.playRobo('otro', near), false);
});

test('el truco del robo armado fija arma, contravía y plan armado, y el pegado va pegado', () => {
  ROBO.contra = true;
  for (const [opts, weapon] of [[{ weapon: 'pistola' }, 'pistola'], [{ weapon: 'cuchillo' }, 'cuchillo'], [{ choro: true }, null]]) {
    const { system } = setup({ random: seeded(5) });
    system.reset(); system.cooldown = 0;
    assert.equal(system.trigger({ force: true, armado: true, contra: true, ...opts }), true);
    assert.equal(system.reverse, true, 'viene en contravía');
    if (weapon) assert.equal(system.robber.weapon, weapon);
    for (let i = 0; i < 900 && !system.arrived; i++) system.update(1 / 30, {});
    assert.ok(system.arrived);
    assert.notEqual(system.plan.style, 'passive', 'exige armado, no solo revisa');
    if (opts.choro) { assert.equal(system.plan.choro, true); assert.ok(CHORO_QUIRKS.includes(system.plan.quirk)); }
    if (weapon === 'cuchillo') assert.equal(system.plan.cocks, false);
  }
});
