// tests/psychosis.test.js
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { PsychosisSystem, ATAQUE, MOTO_SOMBRA } from '../src/systems/PsychosisSystem.js';
import { SOMBRAS, cantidadOla } from '../src/systems/ShadowPeople.js';
import { seededRandom } from '../src/character/people.js';
import { Player } from '../src/entities/Player.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

function figuraFalsa() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: SOMBRAS.opacidad, depthWrite: false });
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.3), material));
  return { group, material, character: { update() {}, dispose() {} } };
}

function conReserva(psychosis) {
  psychosis.fabrica = async () => figuraFalsa();
  for (let i = 0; i < SOMBRAS.max; i++) psychosis.reserva.push(figuraFalsa());
  return psychosis;
}

test('cálculo progresivo de abstinencia y umbrales de severidad', () => {
  const stats = new StatsSystem();

  // 1. Estado satisfecho inicial
  stats.vicio = 80;
  assert.equal(stats.abstinencia, 0);
  assert.equal(stats.inWithdrawal, false);
  assert.equal(stats.isHighWithdrawal, false);
  assert.equal(stats.isCriticalWithdrawal, false);

  // 2. Umbral de entrada en abstinencia (vicio < 20)
  stats.vicio = 15;
  assert.equal(stats.inWithdrawal, true);
  assert.equal(stats.abstinencia, 25);
  assert.equal(stats.isHighWithdrawal, false);

  // 3. Abstinencia alta (vicio <= 10 -> abstinencia >= 50%)
  stats.vicio = 8;
  assert.equal(stats.abstinencia, 60);
  assert.equal(stats.isHighWithdrawal, true);
  assert.equal(stats.isCriticalWithdrawal, false);

  // 4. Abstinencia crítica / psicosis severa (vicio <= 4 -> abstinencia >= 80%)
  stats.vicio = 2;
  assert.equal(stats.abstinencia, 90);
  assert.equal(stats.isHighWithdrawal, true);
  assert.equal(stats.isCriticalWithdrawal, true);

  // 5. Vicio totalmente en 0 -> abstinencia 100%
  stats.vicio = 0;
  assert.equal(stats.abstinencia, 100);
});

test('la abstinencia alta penaliza la velocidad y multiplica el desgaste mental', () => {
  const normal = new StatsSystem();
  normal.vicio = 80;
  normal.animo = 100;

  const highWithdrawal = new StatsSystem();
  highWithdrawal.vicio = 5; // 75% abstinencia
  highWithdrawal.animo = 100;

  assert.ok(highWithdrawal.getSpeedMultiplier() < normal.getSpeedMultiplier());

  // Simular 60 segundos de desgaste
  for (let f = 0; f < 60 * 60; f++) {
    normal.update(1 / 60, null);
    highWithdrawal.update(1 / 60, null);
  }

  // El ánimo en abstinencia alta decae mucho más rápido
  assert.ok(highWithdrawal.animo < normal.animo);
});

test('PsychosisSystem se activa con abstinencia alta y se limpia al recuperar el vicio', () => {
  const scene = new THREE.Scene();
  const stats = new StatsSystem();
  stats.vicio = 80; // normal
  const player = { position: new THREE.Vector3(10, 0, 10), playAction() {} };
  const cameraRig = { camera: new THREE.PerspectiveCamera(55, 1, 0.1, 100), baseFov: 55 };

  const psychosis = conReserva(new PsychosisSystem(scene, player, stats, null, { active: { getGroundHeight: () => 0 } }));

  // Con vicio normal, no está activo
  psychosis.update(0.1, cameraRig);
  assert.equal(psychosis.active, false);

  // Con abstinencia alta (vicio = 4 -> 80% abstinencia), se activa
  stats.vicio = 4;
  psychosis.update(0.1, cameraRig);
  assert.equal(psychosis.active, true);

  // Puede generar sombras fantasma
  psychosis._clearShadowPeople();
  const shadow = psychosis._createShadowPerson(new THREE.Vector3(20, 0, 20));
  assert.ok(shadow);
  psychosis.shadowPeople.push(shadow);
  assert.equal(psychosis.shadowPeople.length, 1);
  assert.equal(scene.children.includes(shadow.group), true);

  // Al consumir una sustancia y recuperar vicio, la psicosis se desactiva y limpia las sombras
  stats.vicio = 50;
  psychosis.update(0.1, cameraRig);
  assert.equal(psychosis.active, false);
  assert.equal(psychosis.shadowPeople.length, 0);
  assert.equal(scene.children.includes(shadow.group), false);
});

function hallucinating({ doses = 3, salud = 100 } = {}) {
  const scene = new THREE.Scene();
  const stats = new StatsSystem();
  stats.salud = salud;
  const hits = [];
  const player = {
    position: new THREE.Vector3(10, 0, 10),
    playAction() {},
    receiveHit(dir, strength, info) { hits.push({ dir, strength, info }); }
  };
  const cameraRig = { camera: new THREE.PerspectiveCamera(55, 1, 0.1, 100), baseFov: 55 };
  const psychosis = conReserva(new PsychosisSystem(scene, player, stats, null, { active: { getGroundHeight: () => 0 } }));
  for (let i = 0; i < doses; i++) psychosis.induce(50, 0.8);
  const tick = (seconds, dt = 0.05) => { for (let t = 0; t < seconds - 1e-9; t += dt) psychosis.update(dt, cameraRig); };
  const attackers = () => psychosis.shadowPeople.filter((sp) => sp.ataca);
  return { scene, stats, player, psychosis, tick, attackers, hits };
}

test('el nivel de ataque exige varias dosis seguidas, y sobrio no hay hombres sombra', () => {
  const sober = hallucinating({ doses: 0 });
  sober.tick(10);
  assert.equal(sober.psychosis.active, false);
  assert.equal(sober.psychosis.shadowPeople.length, 0);

  for (const doses of [1, 2]) {
    const light = hallucinating({ doses });
    light.tick(30);
    assert.equal(light.psychosis.ataque, false, `${doses} dosis solo vigilan`);
    assert.equal(light.attackers().length, 0);
  }

  const heavy = hallucinating({ doses: ATAQUE.dosis });
  heavy.tick(0.1);
  assert.equal(heavy.psychosis.ataque, true);
  assert.ok(heavy.psychosis.induced.severity > 0.8, 'cada dosis sube la intensidad');

  const abstinence = hallucinating({ doses: 0 });
  abstinence.stats.vicio = 0;
  abstinence.tick(30);
  assert.equal(abstinence.psychosis.ataque, false, 'la abstinencia sola no ataca');
  assert.equal(abstinence.attackers().length, 0);
});

test('los hombres sombra se acercan, golpean con daño moderado y respetan el respiro', () => {
  const { psychosis, stats, tick, attackers, hits } = hallucinating();
  tick(30);
  assert.ok(attackers().length >= 1 && attackers().length <= SOMBRAS.max);
  assert.ok(stats.salud < 100, 'al menos un golpe llegó');
  assert.ok(100 - stats.salud >= ATAQUE.danoMin, 'daño real');
  const first = hits.length;
  assert.ok(hits.length * ATAQUE.danoMax >= 100 - stats.salud);
  assert.ok(100 - stats.salud <= hits.length * ATAQUE.danoMax, 'cada golpe es modesto');
  assert.ok(psychosis.shadowPeople.filter((sp) => sp.ataca).length <= SOMBRAS.max);
  assert.ok(first <= 30 / ATAQUE.respiro + 1, 'no encadenan golpes sin respiro');
});

test('no golpean con el modo sin daño, ni por debajo de la salud mínima, ni tras una pared', () => {
  const god = hallucinating();
  god.stats.invulnerable = true;
  god.tick(30);
  assert.equal(god.stats.salud, 100);
  assert.equal(god.hits.length, 0);

  const weak = hallucinating({ salud: ATAQUE.saludMinima + 3 });
  weak.tick(60);
  assert.ok(weak.stats.salud >= ATAQUE.saludMinima, 'lastiman, no matan');

  const walled = hallucinating();
  walled.player._lastCollisions = [{ box: { min: { x: 8, y: 0, z: 8 }, max: { x: 12, y: 3, z: 12 } } }];
  walled.player.position.set(10, 0, 10);
  walled.tick(30);
  assert.equal(walled.hits.length, 0, 'sin línea libre no hay golpe');
});

test('un golpe del jugador disuelve a la sombra sin tocar dinero ni búsqueda, y se puede huir', () => {
  const { psychosis, scene, player, tick, attackers } = hallucinating();
  tick(8);
  const sp = attackers()[0];
  assert.ok(sp, 'hay un atacante');
  assert.equal(sp.takeHit({ damage: 10 }), 0);
  assert.equal(sp.takeHit({ damage: 10 }), false, 'ya se está disolviendo');
  tick(1);
  assert.equal(psychosis.shadowPeople.includes(sp), false, 'se desvaneció');
  assert.equal(scene.children.includes(sp.group), false);

  const runner = hallucinating();
  runner.tick(8);
  const chaser = runner.attackers()[0];
  runner.player.position.set(10 + ATAQUE.rendicion + 5, 0, 10);
  runner.tick(0.5);
  assert.equal(runner.psychosis.shadowPeople.includes(chaser), false, 'si se escapa, se rinden');
});

test('el jugador real golpea al hombre sombra y no suma dinero ni búsqueda', () => {
  const scene = new THREE.Scene();
  const stats = { dinero: 5 };
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress() { return false; }, isDown() { return false; } };
  const player = new Player(scene, input, stats, {});
  player.game = { steal: { buscado: 0 } };
  player.position.set(0, 0, 0);
  const sombra = conReserva(new PsychosisSystem(scene, player, new StatsSystem(), null, { active: { getGroundHeight: () => 0 } }));
  const sp = sombra._createShadowMan(new THREE.Vector3(0, 0, 1));
  sombra.shadowPeople.push(sp);
  player.extraMeleeTargets = [sp];
  player.root.rotation.y = 0;
  player.punch();
  for (let t = 0; t < 1; t += 0.05) player.update(0.05, null, null, () => 0, []);
  assert.equal(sp.dissolving, true, 'el golpe la alcanzó');
  assert.equal(stats.dinero, 5);
  assert.equal(player.game.steal.buscado, 0);
});

test('al apagarse la paranoia se limpian los hombres sombra y sus blancos', () => {
  const { psychosis, scene, player, tick, attackers } = hallucinating();
  tick(10);
  const sp = attackers()[0];
  assert.ok(sp);
  assert.ok(player.extraMeleeTargets?.length);
  psychosis.induced.left = 0.01;
  tick(0.1);
  assert.equal(psychosis.active, false);
  assert.equal(psychosis.ataque, false);
  assert.equal(psychosis.shadowPeople.length, 0);
  assert.equal(scene.children.includes(sp.group), false);
  assert.equal(player.extraMeleeTargets, null);
});

test('al bajar de nivel las sombras que atacaban se disuelven aunque siga la abstinencia', () => {
  const { psychosis, stats, tick, attackers } = hallucinating();
  tick(10);
  assert.ok(attackers().length);
  stats.vicio = 0;
  psychosis.induced.left = 5;
  tick(2);
  assert.equal(psychosis.ataque, false);
  assert.equal(attackers().length, 0);
});

test('las motos sombra solo cruzan en el nivel de ataque, no hacen daño y se limpian al apagarse', () => {
  const sober = hallucinating({ doses: 0 });
  sober.tick(30);
  assert.equal(sober.psychosis.motosSombra.length, 0);
  const light = hallucinating({ doses: 2 });
  light.tick(30);
  assert.equal(light.psychosis.motosSombra.length, 0, 'con pocas dosis no hay motos');

  const { psychosis, scene, player, stats, tick, hits } = hallucinating();
  const health = stats.salud;
  let seen = 0, most = 0;
  // Solo las motos: sin los hombres sombra, que sí golpean, nada debe tocar al jugador.
  psychosis.ataque = true;
  for (let t = 0; t < 40; t += 0.05) {
    psychosis._updateMotosSombra(0.05, player.position);
    seen += psychosis.motosSombra.length ? 1 : 0;
    most = Math.max(most, psychosis.motosSombra.length);
  }
  assert.ok(seen > 0, 'cruzan motos');
  assert.ok(most <= MOTO_SOMBRA.maxSimultaneas, 'una o dos a la vez');
  assert.equal(hits.length, 0, 'nunca golpean');
  assert.equal(stats.salud, health);
  assert.equal(psychosis.motosSombra.every(m => !m.ataca && !m.takeHit), true, 'no son blancos ni atacan');

  tick(1);
  psychosis.ataque = false;
  const moto = psychosis.motosSombra[0];
  for (let t = 0; t < 2; t += 0.05) psychosis._updateMotosSombra(0.05, player.position);
  assert.equal(psychosis.motosSombra.length, 0, 'al caer el ataque se disuelven');
  if (moto) assert.equal(scene.children.includes(moto.group), false);
});

test('el número de hombres sombra por ola es aleatorio e independiente: casi siempre 1 a 3, a veces 4 o 5, rara vez hasta 7', () => {
  const random = seededRandom('olas-sombra');
  const cuenta = Array(SOMBRAS.max + 1).fill(0);
  const N = 20000;
  for (let i = 0; i < N; i++) cuenta[cantidadOla(random)]++;
  assert.equal(cuenta[0], 0, 'nunca cero');
  const parte = (desde, hasta) => cuenta.slice(desde, hasta + 1).reduce((a, b) => a + b, 0) / N;
  assert.ok(parte(1, 3) > 0.7 && parte(1, 3) < 0.85, 'mayoría de 1 a 3');
  assert.ok(parte(4, 5) > 0.1 && parte(4, 5) < 0.25, 'a veces 4 o 5');
  assert.ok(parte(6, 7) > 0.01 && parte(6, 7) < 0.09, 'rara vez 6 o 7');
  assert.ok(cuenta[SOMBRAS.max] > 0, 'a veces llega al tope');
  for (let n = 1; n <= SOMBRAS.max; n++) assert.ok(cuenta[n] > 0, `sale ${n}`);
  const vistos = new Set();
  for (let i = 0; i < 200; i++) vistos.add(cantidadOla(random));
  assert.ok(vistos.size >= 5, 'varía de una ola a otra, no es siempre dos');
});

test('los hombres sombra son negros, a medio transparentar, sin escribir en profundidad, y nunca pasan del tope', () => {
  const { psychosis, scene, tick } = hallucinating();
  psychosis.induced.left = 1e6;
  let maximo = 0;
  for (let i = 0; i < 4000; i++) {
    psychosis.update(0.05, { camera: new THREE.PerspectiveCamera(55, 1, 0.1, 100), baseFov: 55 });
    maximo = Math.max(maximo, psychosis.shadowPeople.length);
    assert.ok(psychosis.shadowPeople.length + psychosis.reserva.length <= SOMBRAS.max, 'las figuras se reusan, no se crean de más');
  }
  assert.ok(maximo >= 2, 'aparecen varias');
  assert.ok(maximo <= SOMBRAS.max, 'nunca más del tope');
  for (const sp of psychosis.shadowPeople) {
    assert.equal(sp.figura.material.color.getHex(), 0x000000);
    assert.equal(sp.figura.material.transparent, true);
    assert.equal(sp.figura.material.depthWrite, false);
    assert.ok(sp.figura.material.opacity > 0 && sp.figura.material.opacity <= 0.6);
  }
  assert.ok(SOMBRAS.opacidad >= 0.5 && SOMBRAS.opacidad <= 0.6);
  const antes = scene.children.length;
  psychosis._clearShadowPeople();
  assert.equal(psychosis.reserva.length, SOMBRAS.max, 'al limpiar, las figuras vuelven a la reserva');
  assert.ok(scene.children.length <= antes);
});

test('las motos sombra van a menos de la mitad de la velocidad anterior', () => {
  assert.ok(MOTO_SOMBRA.velocidad[1] <= 14 && MOTO_SOMBRA.velocidad[0] >= 8, 'de 9 a 13 m/s, antes de 20 a 30');
});
