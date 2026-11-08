// Pruebas de la protesta: la máquina de estados, la probabilidad y el enfriamiento, los topes del grupo de gente,
// el cartón del suelo y la recuperación tras morir o recargar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { PROTEST, ProtestSystem, protestChance } from '../src/systems/ProtestSystem.js';
import { straightRoute } from '../src/systems/LimpiezaSocialSystem.js';
import { fakePool } from './fakePool.js';

const route = () => straightRoute(new THREE.Vector3(40, 0, -100), new THREE.Vector3(0, 0, 1), 200);

async function build({ crowd = 40, police = 24, random = () => .5 } = {}) {
  const people = await fakePool(crowd), cops = await fakePool(police);
  const player = { position: new THREE.Vector3(0, 0, 0) };
  const stats = { salud: 100 };
  const system = new ProtestSystem(new THREE.Scene(), { player, stats, people, cops, random });
  const traffic = [], registered = [], closures = [];
  const vehicles = { closeSegment: (x, z, radius) => closures.push({ x, z, radius }), openSegment: () => closures.push(null) };
  system.setup({ getGroundHeight: () => 0 }, [route()], traffic, { vehicles, interaction: { register: t => registered.push(t), unregister: t => registered.splice(registered.indexOf(t), 1) } });
  system.elapsed = PROTEST.grace;
  system.cooldown = 0;
  return { system, people, cops, player, stats, traffic, registered, closures };
}

const run = (system, seconds, ctx = {}, dt = .25) => { for (let t = 0; t < seconds; t += dt) system.update(dt, ctx); };

test('la probabilidad es mayor de día y en las zonas de plaza, nunca pasa del máximo y de madrugada casi no hay', () => {
  assert.ok(protestChance({ hour: 12, zone: 'parque' }) > protestChance({ hour: 12, zone: 'barrio' }));
  assert.ok(protestChance({ hour: 12 }) > protestChance({ hour: 20 }));
  assert.ok(protestChance({ hour: 20 }) > protestChance({ hour: 3 }));
  assert.ok(protestChance({ hour: 12, zone: 'desconocida' }) <= PROTEST.maxChance);
});

test('no arranca en la gracia de partida nueva, con enfriamiento, bloqueada ni dentro del cambuche', async () => {
  const { system } = await build();
  system.elapsed = PROTEST.grace - 1;
  assert.equal(system.canStart(), false);
  system.elapsed = PROTEST.grace;
  system.cooldown = 10;
  assert.equal(system.canStart(), false);
  system.cooldown = 0;
  assert.equal(system.canStart({ blocked: true }), false);
  assert.equal(system.canStart({ allowSpawn: false }), false);
  assert.equal(system.canStart(), true);
});

test('en reposo la tirada solo ocurre cada checkEvery y no dibuja nada', async () => {
  const hits = [];
  const { system } = await build({ random: () => 0 });
  system.trigger = () => { hits.push(1); };
  run(system, PROTEST.checkEvery - 1, { hour: 12, zone: 'parque' });
  assert.equal(hits.length, 0);
  run(system, 2, { hour: 12, zone: 'parque' });
  assert.equal(hits.length, 1);
  assert.equal(system.root.visible, false);
});

test('la protesta recorre todos los estados en orden y la calle queda limpia al final', async () => {
  const { system, people, cops, traffic } = await build();
  assert.equal(system.trigger(), true);
  assert.equal(system.state, 'gathering');
  assert.equal(system.trigger(), false, 'una sola a la vez');
  const seen = [system.state];
  for (let t = 0; t < 400 && system.active; t += .25) {
    system.update(.25, {});
    if (seen.at(-1) !== system.state && system.active) seen.push(system.state);
  }
  assert.deepEqual(seen, ['gathering', 'faceoff', 'clash', 'dispersal', 'aftermath', 'cleanup']);
  assert.equal(system.state, 'idle');
  assert.equal(people.inUse + cops.inUse, 0);
  assert.equal(traffic.length, 0);
  assert.equal(system.counts.scraps, 0);
  assert.equal(system.root.visible, false);
  assert.ok(system.cooldown > 0);
});

test('la gente y los tombos salen del grupo con sus topes y los carros los respetan', async () => {
  const { system, people, cops, traffic } = await build({ crowd: 5, police: 3 });
  system.trigger();
  assert.equal(people.inUse, 5);
  assert.equal(cops.inUse, 3);
  assert.equal(traffic.length, PROTEST.crowd + 3, 'la gente instanciada completa la multitud y también cuenta para los carros');
  const full = await build();
  full.system.trigger();
  assert.equal(full.people.inUse, PROTEST.protesters);
  assert.equal(full.cops.inUse, PROTEST.cops);
});

test('es un tumulto: de 40 a 60 personas con muchas pancartas, gente en los andenes y una línea de tombos de dos filas', async () => {
  const { system } = await build();
  system.trigger();
  const crowd = system.actors.filter(a => a.kind === 'protester'), cops = system.actors.filter(a => a.kind === 'cop');
  assert.ok(crowd.length >= 40 && crowd.length <= 60, `${crowd.length} manifestantes`);
  assert.ok(cops.length >= 16 && cops.length <= 24, `${cops.length} antimotines`);
  assert.equal(crowd.filter(a => a.figure).length, PROTEST.protesters, 'adelante van personas reales y atrás las instanciadas');
  assert.equal(system.cheap.length, crowd.length - PROTEST.protesters);
  const side = system._side(), lateral = a => Math.abs((a.goal.x - system.center.x) * side.x + (a.goal.z - system.center.z) * side.z);
  assert.ok(crowd.filter(a => lateral(a) > 6).length >= 10, 'hay gente en los andenes');
  const banners = crowd.filter(a => a.sign || a.cheap?.slogan >= 0).length;
  assert.ok(banners >= 14, `${banners} pancartas`);
  const along = a => (a.goal.x - system.center.x) * system.axis.x + (a.goal.z - system.center.z) * system.axis.z;
  const ranks = new Set(cops.map(a => along(a).toFixed(1)).filter(d => Math.abs(d - PROTEST.gap) < 1.6));
  assert.equal(ranks.size, 2, 'dos filas de escudos');
  assert.ok(cops.filter(a => along(a) > PROTEST.gap + 3).length >= 3, 'y unos cuantos detrás');
  system.update(.25, {});
  assert.equal(system.torsos.count, system.cheap.length);
  assert.ok(system.boards.reduce((n, mesh) => n + mesh.count, 0) > 5, 'las pancartas instanciadas se dibujan');
});

test('con la protesta la calle se cierra al tráfico y se abre cuando la gente ya se fue', async () => {
  const { system, closures } = await build();
  system.trigger();
  assert.equal(closures.length, 1);
  assert.equal(closures[0].radius, PROTEST.closeRadius);
  assert.ok(Math.hypot(closures[0].x - system.center.x, closures[0].z - system.center.z) < .01);
  assert.equal(system.cues.group.visible, true, 'se ven las señales del cierre');
  while (system.state !== 'dispersal') system.update(.25, {});
  assert.equal(closures.length, 1, 'sigue cerrada con gente en la calle');
  while (system.state === 'dispersal') system.update(.25, {});
  assert.deepEqual(closures.at(-1), null, 'se abre al terminar la dispersión');
  assert.equal(system.cues.group.visible, false);
});

test('morir o recargar en plena protesta también abre la calle', async () => {
  const { system, closures } = await build();
  system.trigger();
  system.reset();
  assert.deepEqual(closures.at(-1), null);
});

test('en el enfrentamiento vuelan piedras y los tombos tiran gas; quien se queda en la nube se enferma', async () => {
  const { system, player, stats } = await build();
  system.trigger();
  run(system, PROTEST.phases.gathering + PROTEST.phases.faceoff + 1);
  assert.equal(system.state, 'clash');
  run(system, 8);
  assert.ok(system.rocks.length + system.bitsData.length > 0, 'se lanzaron piedras');
  assert.ok(system.clouds.length > 0, 'hay gas');
  const cloud = system.clouds[0];
  player.position.set(cloud.x, 0, cloud.z);
  const before = stats.salud;
  run(system, 3);
  assert.ok(stats.salud < before, 'el gas le quita salud');
});

test('una piedra que pasa por el jugador le pega y le quita salud', async () => {
  const { system, player, stats } = await build();
  system.trigger();
  player.position.set(5, 0, 5);
  system.rocks.push({ kind: 'rock', x: 5, y: 1.2, z: 5, vx: 0, vz: 0, vy: 0, landed: false, hit: false });
  system.update(.016, {});
  assert.ok(stats.salud < 100 && stats.salud >= 100 - PROTEST.rockDamage[1]);
  const once = stats.salud;
  system.update(.016, {});
  assert.equal(stats.salud, once, 'la misma piedra no pega dos veces');
});

test('quien se pega a la fila de tombos llama a la patrulla', async () => {
  const { system, player } = await build();
  let calls = 0;
  system.onProvoked = () => calls++;
  system.trigger();
  run(system, PROTEST.phases.gathering + 1);
  assert.equal(system.state, 'faceoff');
  const cop = system.actors.find(a => a.kind === 'cop');
  player.position.copy(cop.pos);
  run(system, PROTEST.provokeTime + 1);
  assert.ok(calls >= 1);
});

test('tras la dispersión quedan cartones que se recogen una sola vez y se pueden devolver si no caben', async () => {
  const { system, registered } = await build();
  system.trigger();
  while (system.state !== 'aftermath') system.update(.5, {});
  assert.equal(registered.length, PROTEST.scraps);
  const scrap = registered[0];
  const first = scrap.harvest();
  assert.ok(first.items.includes('carton'));
  assert.equal(scrap.harvest(), null);
  scrap.returnUncollected(['carton']);
  assert.ok(scrap.harvest(), 'si no cabía queda en el suelo');
  assert.ok(system.sheetsData.length > PROTEST.scraps, 'además hay pancartas y cartón suelto');
  assert.ok(system.bitsData.some(b => b.kind === 'stick'));
});

test('al limpiar, los cartones dejan de poder recogerse y todo se desvanece', async () => {
  const { system, registered } = await build();
  system.trigger();
  while (system.state !== 'cleanup') system.update(.5, {});
  run(system, PROTEST.phases.cleanup * .5);
  assert.equal(registered.length, 0);
  run(system, PROTEST.phases.cleanup);
  assert.equal(system.active, false);
  assert.equal(system.bits.count + system.sheets.count, 0);
});

test('morir o recargar en plena protesta devuelve a todos al grupo y deja calma', async () => {
  const { system, people, cops, traffic, stats } = await build();
  system.trigger();
  run(system, 30);
  assert.ok(people.inUse > 0);
  system.reset();
  assert.equal(system.state, 'idle');
  assert.equal(people.inUse + cops.inUse, 0);
  assert.equal(traffic.length, 0);
  assert.ok(system.cooldown >= PROTEST.afterReset);
  system.trigger = ProtestSystem.prototype.trigger;
  system.cooldown = 0;
  system.trigger();
  stats.salud = 0;
  system.update(.1, {});
  assert.equal(system.state, 'idle');
  assert.equal(people.inUse + cops.inUse, 0);
});

test('sin calles cerca, el truco arma la protesta en una recta cerca del jugador', async () => {
  const { system, people } = await build();
  system.routes = [];
  assert.equal(system.trigger(), false);
  assert.equal(system.trigger({ force: true }), true);
  assert.ok(people.inUse > 0);
  const d = Math.hypot(system.center.x, system.center.z);
  assert.ok(d >= 20 && d <= 70);
});
