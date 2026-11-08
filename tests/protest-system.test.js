// Pruebas de la protesta: la máquina de estados, la probabilidad y el enfriamiento, los topes del grupo de gente,
// el cartón del suelo y la recuperación tras morir o recargar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CAUSES, PROTEST, ProtestSystem, pickCause, protestChance } from '../src/systems/ProtestSystem.js';
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
  for (let t = 0; t < 900 && system.active; t += .25) {
    system.update(.25, {});
    if (seen.at(-1) !== system.state && system.active) seen.push(system.state);
  }
  assert.deepEqual(seen.slice(0, 3), ['gathering', 'faceoff', 'clash']);
  assert.deepEqual(seen.slice(-3), ['dispersal', 'aftermath', 'cleanup']);
  assert.ok(seen.filter(state => state === 'clash').length >= 2, 'los choques van y vienen');
  assert.ok(seen.every((state, i) => i === 0 || state !== seen[i - 1]));
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

const withWindow = async fn => {
  const before = globalThis.window;
  globalThis.window = new EventTarget();
  try { return await fn(globalThis.window); } finally { globalThis.window = before; }
};

const COMMON = [
  'Paro de taxistas por el precio de la gasolina',
  'Paro camionero por los peajes',
  'Paro de mototaxistas por el pico y placa',
  'Los estudiantes de la pública marchan por la matrícula',
  'Los vendedores ambulantes protestan porque los sacaron del andén',
  'Están votando para tumbar al presidente en plena calle',
  'Cacerolazo porque se fue la luz en todo el país',
  'Protesta porque adelantaron el reloj una hora y nadie sabe qué hora es',
  'Cacerolazo porque prohibieron el tinto después de las seis'
];
const norm = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

test('las causas son los paros de aquí y las absurdas de siempre, cada una con su cartel y sus consignas', () => {
  assert.ok(CAUSES.length >= 9 && CAUSES.length <= 13);
  for (const text of COMMON) {
    const words = norm(text).split(/[^a-z0-9]+/).filter(w => w.length > 3);
    assert.ok(CAUSES.some(c => words.every(w => norm(c.hint).includes(w.slice(0, 5)))), text);
  }
  for (const c of CAUSES) {
    assert.ok(c.alert.length <= 66, c.alert);
    assert.match(c.alert, /^(PARO|PROTESTA|MARCHA|CACEROLAZO|VOTACIÓN)/);
    assert.ok(c.slogans.length >= 4 && c.chants.length >= 2);
  }
  const seen = new Set(CAUSES.map((_, i) => pickCause(() => (i + .5) / CAUSES.length)));
  assert.equal(seen.size, CAUSES.length, 'todas pueden salir');
});

test('al arrancar una protesta sale el cartel de arriba con su causa y las pancartas dicen lo mismo', async () => {
  await withWindow(async win => {
    const alerts = [];
    win.addEventListener('protest-alert', e => alerts.push(e.detail.text));
    const { system } = await build({ random: () => .02 });
    system.trigger({ force: true });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0], system.cause.alert);
    assert.deepEqual(alerts, [CAUSES[0].alert]);
    assert.equal(system.chants, CAUSES[0].chants);
    system.reset();
    system.cooldown = 0;
    system.trigger({ force: true });
    assert.equal(alerts.length, 2, 'una protesta nueva avisa de nuevo, sin tope por día');
  });
});

test('una protesta normal dura un par de horas de juego y sigue el reloj del juego', async () => {
  const { system } = await build();
  system.trigger({ force: true, kind: 'normal' });
  const hours = PROTEST.normalHours * 150;
  assert.equal(system.plan.total, hours);
  const measure = (clockSpeed, dt) => {
    let start = null, end = null, t = 0;
    while (system.active && end === null) {
      system.update(dt, { clockSpeed });
      t += dt;
      if (start === null && system.state === 'faceoff') start = t;
      if (system.state === 'dispersal') end = t;
    }
    return end - start;
  };
  const normal = measure(1, .5);
  assert.ok(normal >= hours - 2 && normal <= hours + PROTEST.phases.faceoff + PROTEST.phases.clash, `${normal} s`);
  system.reset();
  system.cooldown = 0;
  system.trigger({ force: true, kind: 'normal' });
  const fast = measure(4, .5);
  assert.ok(fast < normal / 3, 'con el reloj acelerado dura menos tiempo real');
});

test('un paro grande mantiene la calle cerrada un día de juego entero, con la multitud que se afloja y se llena y las llantas ardiendo', async () => {
  const { system, closures } = await build();
  system.trigger({ force: true, kind: 'paro' });
  assert.equal(system.plan.kind, 'paro');
  assert.equal(system.plan.total, 24 * 150);
  let t = 0, hiddenMax = 0, hiddenNow = 0, refilled = false, clashes = 0, last = '';
  while (system.state !== 'dispersal' && t < 5000) {
    system.update(1, {});
    t++;
    if (system.state === 'clash' && last !== 'clash') clashes++;
    last = system.state;
    hiddenNow = system.cheap.filter(a => a.hidden).length;
    if (hiddenNow < hiddenMax) refilled = true;
    hiddenMax = Math.max(hiddenMax, hiddenNow);
    if (t % 600 === 0) {
      assert.equal(closures.at(-1)?.radius, PROTEST.closeRadius, 'la calle sigue cerrada');
      assert.equal(system.fire.visible, true, 'las llantas siguen ardiendo');
    }
  }
  assert.ok(t >= 24 * 150 && t < 24 * 150 + 200, `${t} s de juego`);
  assert.ok(hiddenMax >= 10, 'la multitud se afloja');
  assert.ok(refilled, 'y se vuelve a llenar');
  assert.ok(clashes >= 10, `${clashes} choques que van y vienen`);
  while (system.state === 'dispersal') system.update(.5, {});
  assert.equal(closures.at(-1), null, 'la calle se abre al terminar la dispersión');
});

test('las llantas: de tres a seis montones que se prenden en el cara a cara, humean en el desastre y se van con la limpieza', async () => {
  const { system } = await build();
  system.trigger();
  assert.ok(system.piles.length >= 3 && system.piles.length <= 6);
  assert.equal(system.tires.count, system.piles.length * 3);
  system.update(.25, {});
  assert.equal(system.fire.visible, false, 'aún sin prender');
  while (system.state === 'gathering') system.update(.5, {});
  system.update(.25, {});
  assert.equal(system.fire.visible, true);
  const alpha = system.fire.geometry.attributes.aAlpha.array;
  assert.ok(alpha.some(a => a > .3), 'hay llama y humo');
  while (system.state !== 'aftermath') system.update(.5, {});
  system.update(.25, {});
  assert.equal(system.fire.visible, true, 'sigue humeando');
  while (system.state !== 'idle') system.update(.5, {});
  assert.equal(system.piles.length, 0);
  assert.equal(system.tires.count, 0);
  assert.equal(system.fire.visible, false);
});
