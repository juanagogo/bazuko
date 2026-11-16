import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { WitnessSystem, WITNESS } from '../src/systems/WitnessSystem.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';
import { Npc } from '../src/entities/Npc.js';
import { Game } from '../src/core/game.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { DiseaseSystem } from '../src/systems/DiseaseSystem.js';

let toasts;
beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
  globalThis.document ??= {
    getElementById() { return null; },
    createElement() { return { className: '', textContent: '', style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
  toasts = [];
  window.addEventListener('toast', (e) => toasts.push(e.detail.text));
});

// Un peatón de verdad, de pie en la calle: los testigos usan su propio `witness`, `update` y `takeHit`.
function peaton(scene, x, z) {
  const npc = new Npc(scene, new THREE.Vector3(x, 0, z), { look: {} });
  npc.target = null; npc.route = [];
  npc.say = (t) => { (npc.dichos ??= []).push(t); };
  return npc;
}

function juego(npcs, { collisions = null } = {}) {
  const dispatched = [];
  return {
    dispatched,
    player: { position: new THREE.Vector3(0, 0, 0) },
    world: { active: { npcs } },
    collisions,
    steal: { buscado: 1, _calma: 50 },
    traffic: { wantedLevel: 1, dispatchTo: (p) => { dispatched.push(p.clone()); return true; } },
  };
}

// Como en el juego: el sistema de testigos y luego cada peatón, con el jugador quieto donde esté.
function correr(sys, game, segundos, { quietos = [] } = {}) {
  for (let t = 0; t < segundos; t += .1) {
    sys.update(.1);
    for (const n of game.world.active.npcs) if (!quietos.includes(n)) n.update(.1, { player: game.player.position });
  }
}

test('quien ve el robo llama, otro graba y el resto huye gritando', () => {
  const scene = new THREE.Scene();
  const npcs = [peaton(scene, 3, 0), peaton(scene, 5, 0), peaton(scene, 7, 0), peaton(scene, 40, 0)];
  const sys = new WitnessSystem(juego(npcs), { random: () => 0 });
  assert.equal(sys.report('robo'), 3, 'el de 40 m no alcanza a ver');
  assert.equal(npcs[0].witnessing, 'llamar');
  assert.equal(npcs[1].witnessing, 'grabar');
  assert.ok(npcs[2].fleeTimer > 0);
  assert.equal(npcs[3].fleeTimer, 0);
  assert.equal(npcs[2].dichos.length, 1, 'el que huye grita');
  assert.ok(toasts.some((t) => t.startsWith('Alguien está llamando a la Policía')));
  sys.dispose();
});

test('la llamada que termina sube el fichaje una sola vez y manda una patrulla al sitio', () => {
  const scene = new THREE.Scene();
  const npcs = [peaton(scene, 8, 0)];
  const game = juego(npcs);
  const sys = new WitnessSystem(game, { random: () => 0 });
  sys.report('robo');
  game.player.position.set(12, 0, 0); // se aleja sin ir por quien llama
  correr(sys, game, WITNESS.callSeconds + .5);
  assert.equal(npcs[0].witnessing, null, 'colgó y vuelve a caminar');
  assert.equal(game.steal.buscado, 2);
  assert.equal(game.traffic.wantedLevel, 2);
  assert.equal(game.dispatched.length, 1);
  assert.equal(game.dispatched[0].x, 0, 'la patrulla va adonde fue el robo');
  assert.ok(toasts.includes('Un testigo llamó a la Policía'));
  correr(sys, game, 20);
  assert.equal(game.steal.buscado, 2, 'la misma llamada no vuelve a contar');
  assert.equal(game.dispatched.length, 1);
  sys.dispose();
});

test('llegar hasta quien llama le hace colgar: no sube el fichaje', () => {
  const scene = new THREE.Scene();
  const npcs = [peaton(scene, 8, 0)];
  const game = juego(npcs);
  const sys = new WitnessSystem(game, { random: () => 0 });
  sys.report('robo');
  correr(sys, game, 1);
  game.player.position.set(7, 0, 0);
  correr(sys, game, WITNESS.callSeconds);
  assert.equal(game.steal.buscado, 1);
  assert.equal(game.dispatched.length, 0);
  assert.ok(npcs[0].fleeTimer > 0);
  assert.ok(toasts.includes('Le hice colgar'));
  sys.dispose();
});

test('un muro tapa la vista: nadie del otro lado es testigo', () => {
  const collisions = new CollisionSystem();
  collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(2, 0, -20), new THREE.Vector3(2.4, 4, 20)) });
  const npcs = [peaton(new THREE.Scene(), 5, 0)];
  const sys = new WitnessSystem(juego(npcs, { collisions }), { random: () => 0 });
  assert.equal(sys.report('pelea'), 0);
  assert.equal(npcs[0].witnessing, null);
  sys.dispose();
});

test('una pelea larga arma una sola escena cada 4 s, no una por puño', () => {
  const scene = new THREE.Scene();
  const npcs = [peaton(scene, 3, 0), peaton(scene, 4, 0), peaton(scene, 5, 0), peaton(scene, 6, 0)];
  const game = juego(npcs);
  const sys = new WitnessSystem(game, { random: () => .99 });
  const puño = () => window.dispatchEvent(new CustomEvent('street-fight', { detail: {} }));
  for (let i = 0; i < 10; i++) { puño(); sys.update(.39); }
  const gritos = () => npcs.reduce((n, p) => n + (p.dichos?.length ?? 0), 0);
  assert.equal(gritos(), 1, '10 puños en 3,9 s: un solo grito');
  for (const n of npcs) n.fleeTimer = 0;
  sys.update(.2);
  puño();
  assert.equal(gritos(), 2, 'pasados 4 s, el puño siguiente sí arma escena');
  sys.dispose();
});

test('el video terminado deja el fichaje sin bajar', () => {
  const scene = new THREE.Scene();
  const npcs = [peaton(scene, 5, 0)];
  const game = juego(npcs);
  const tiradas = [.9, 0]; // no llama, sí graba
  const sys = new WitnessSystem(game, { random: () => tiradas.shift() ?? .9 });
  sys.report('robo');
  assert.equal(npcs[0].witnessing, 'grabar');
  correr(sys, game, WITNESS.filmSeconds + .5);
  assert.equal(npcs[0].witnessing, null);
  assert.equal(game.steal._calma, 0);
  assert.equal(game.steal.buscado, 1, 'grabar no sube el fichaje');
  sys.dispose();
});

test('el testigo suelta el celular con un golpe, un carro, un susto o al quedar noqueado', () => {
  const scene = new THREE.Scene();
  for (const [corta, enElActo] of [
    [(n) => n.takeHit({ damage: 5, attacker: null }), true],        // un carro: golpe sin atacante
    [(n) => n.takeHit({ damage: 5, attacker: { position: new THREE.Vector3() } }), true],
    [(n) => n._fleeFrom(new THREE.Vector3()), false],
    [(n) => { n.koState = 'down'; }, false],
  ]) {
    const npc = peaton(scene, 5, 0);
    const game = juego([npc]);
    const sys = new WitnessSystem(game, { random: () => 0 });
    sys.report('robo');
    assert.equal(npc.witnessing, 'llamar');
    corta(npc);
    if (enElActo) assert.equal(npc.witnessing, null, 'el golpe le tumba el celular en el acto');
    correr(sys, game, WITNESS.callSeconds + 2);
    assert.equal(npc.witnessing, null);
    assert.equal(sys.calls.length, 0);
    assert.equal(game.steal.buscado, 1, 'una llamada cortada no cuenta');
    sys.dispose();
  }
});

test('ningún testigo queda quieto para siempre: sale del mundo o deja de actualizarse', () => {
  const scene = new THREE.Scene();
  const fuera = peaton(scene, 5, 0);
  const game = juego([fuera]);
  const sys = new WitnessSystem(game, { random: () => 0 });
  sys.report('robo');
  fuera.dispose();
  sys.update(.1);
  assert.equal(sys.calls.length, 0, 'sacado del mundo: se suelta enseguida');
  assert.equal(fuera.witnessing, null);

  const quieto = peaton(scene, 5, 0);
  game.world.active.npcs = [quieto];
  sys._cooldown = 0;
  sys.report('robo');
  correr(sys, game, WITNESS.callSeconds + WITNESS.slack + .2, { quietos: [quieto] });
  assert.equal(quieto.witnessing, null, 'sin su propia actualización, el sistema lo suelta igual');
  assert.equal(sys.calls.length, 0);
  assert.equal(game.steal.buscado, 1);
  assert.equal(game.dispatched.length, 0);
  sys.dispose();
});

test('morir, caer preso o cerrar la partida sueltan a los testigos y no dejan llamadas a medias', () => {
  const scene = new THREE.Scene();
  const llama = peaton(scene, 3, 0), graba = peaton(scene, 5, 0);
  const fake = juego([llama, graba]);
  const witnesses = new WitnessSystem(fake, { random: () => 0 });
  witnesses.report('robo');
  assert.equal(llama.witnessing, 'llamar');
  assert.equal(graba.witnessing, 'grabar');
  const game = Object.assign(Object.create(Game.prototype), { witnesses, player: {}, steal: null });
  game._resetAfterRelocation();
  assert.equal(llama.witnessing, null);
  assert.equal(graba.witnessing, null);
  correr(witnesses, fake, 10);
  assert.equal(fake.steal.buscado, 1);
  assert.equal(fake.dispatched.length, 0);

  game.stop();
  window.dispatchEvent(new CustomEvent('street-fight', { detail: {} }));
  assert.equal(llama.witnessing, null, 'cerrada la partida, una pelea ya no arma escena');
});

test('guardar con una llamada en curso no guarda nada de ella, y al cargar nadie queda con el celular', () => {
  const scene = new THREE.Scene();
  const llama = peaton(scene, 3, 0);
  const fake = juego([llama]);
  const witnesses = new WitnessSystem(fake, { random: () => 0 });
  witnesses.report('robo');
  let saved = null;
  const sistema = { serialize: () => ({}) };
  const game = Object.assign(Object.create(Game.prototype), {
    witnesses, save: { save: (d) => { saved = d; } },
    stats: sistema, clock: sistema, inventory: sistema, talents: sistema, diseases: sistema,
    player: { position: new THREE.Vector3(), equippedWeapon: null }, world: { active: null },
  });
  game._save();
  assert.doesNotMatch(JSON.stringify(saved), /llamar|witness|testigo/i);
  // Cargar arranca la partida de cero: peatones nuevos y un sistema sin llamadas.
  const nuevo = peaton(scene, 3, 0);
  assert.equal(nuevo.witnessing, null);
  assert.equal(new WitnessSystem(juego([nuevo])).calls.length, 0);
  witnesses.dispose();
});

// Azar con semilla fija (mulberry32): las mismas peleas en cada corrida.
function semilla(n) {
  return () => {
    n = (n + 0x6D2B79F5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// El jugador le pega a quien tiene a 1 m, con dos mirones a 6 y 9 m: como en el juego, primero el golpe y luego el aviso.
function pelea(scene) {
  const golpeado = peaton(scene, 1, 0), mirones = [peaton(scene, 6, 0), peaton(scene, 0, 9)];
  const game = juego([golpeado, ...mirones]);
  game.steal.buscado = 0;
  const golpe = () => {
    golpeado.takeHit({ damage: 5, attacker: { position: game.player.position } });
    window.dispatchEvent(new CustomEvent('street-fight', { detail: { hits: [golpeado] } }));
  };
  return { golpeado, mirones, game, golpe };
}

test('en una pelea el golpeado, aunque sea el más cercano, no es testigo: llama un mirón', () => {
  const { golpeado, mirones, game, golpe } = pelea(new THREE.Scene());
  const sys = new WitnessSystem(game, { random: () => 0 });
  golpe();
  assert.equal(golpeado.witnessing, null, 'no saca el celular en pleno golpe');
  assert.equal(mirones[0].witnessing, 'llamar');
  correr(sys, game, WITNESS.callSeconds + .5);
  assert.equal(game.steal.buscado, 1);
  assert.equal(game.dispatched.length, 1);
  sys.dispose();
});

test('en 300 peleas con azar de semilla fija el golpeado nunca es testigo y casi siempre alguien llama', (t) => {
  t.mock.method(Math, 'random', semilla(59));
  const { golpeado, mirones, game, golpe } = pelea(new THREE.Scene());
  const sys = new WitnessSystem(game, { random: semilla(7) });
  const sitios = [[1, 0], [6, 0], [0, 9]];
  let llamadas = 0;
  const peleas = 300;
  for (let i = 0; i < peleas; i++) {
    sys.reset();
    game.steal.buscado = 0;
    [golpeado, ...mirones].forEach((n, k) => {
      Object.assign(n, { health: n.maxHealth, staggerTimer: 0, fleeTimer: 0, _hitReactionRemaining: 0, koState: null, target: null, route: [], _witness: null });
      n.position.set(sitios[k][0], 0, sitios[k][1]);
    });
    golpe();
    assert.equal(golpeado.witnessing, null, `pelea ${i}: el golpeado sacó el celular`);
    correr(sys, game, WITNESS.callSeconds + .5);
    if (game.steal.buscado > 0) llamadas++;
  }
  // Con dos mirones que llaman con 0,7 cada uno: 1 − 0,3² = 0,91.
  assert.ok(llamadas / peleas >= .85, `llamaron en ${llamadas} de ${peleas}`);
  sys.dispose();
});

test('ve quien está a menos de 16 m y en la misma planta: a 17 m o 2 m más arriba, no', () => {
  const scene = new THREE.Scene();
  const cerca = peaton(scene, 15, 0), lejos = peaton(scene, 0, 17), arriba = peaton(scene, 0, 4);
  arriba.position.y = 2;
  const sys = new WitnessSystem(juego([cerca, lejos, arriba]), { random: () => .99 });
  assert.equal(sys.report('robo'), 1);
  assert.ok(cerca.fleeTimer > 0);
  assert.equal(lejos.fleeTimer, 0, 'a 17 m no alcanza a ver');
  assert.equal(arriba.fleeTimer, 0, 'en el puente, 2 m más arriba, tampoco');
  sys.dispose();
});

test('una sola llamada a la vez: un robo nuevo mientras alguien llama no pone a otro a llamar', () => {
  const scene = new THREE.Scene();
  const primero = peaton(scene, 3, 0), segundo = peaton(scene, 5, 0);
  const game = juego([primero, segundo]);
  const sys = new WitnessSystem(game, { random: () => 0 });
  sys.report('robo', segundo);
  assert.equal(primero.witnessing, 'llamar');
  sys._cooldown = 0;
  sys.report('robo', primero);
  assert.notEqual(segundo.witnessing, 'llamar');
  assert.equal(sys.calls.length, 1);
  correr(sys, game, WITNESS.callSeconds + .5);
  assert.equal(game.steal.buscado, 2, 'una llamada, un nivel');
  sys.dispose();
});

test('dormir o viajar en bus sueltan a los testigos y la llamada no cuenta', (t) => {
  t.mock.method(globalThis, 'setTimeout', () => 0);
  for (const salir of [
    (game) => game.sleep(),
    (game) => game.relocatePlayer({ x: 200, z: 200 }, { fade: false }),
  ]) {
    const scene = new THREE.Scene();
    const llama = peaton(scene, 3, 0);
    const fake = juego([llama]);
    const witnesses = new WitnessSystem(fake, { random: () => 0 });
    witnesses.report('robo');
    assert.equal(llama.witnessing, 'llamar');
    const game = Object.assign(Object.create(Game.prototype), {
      witnesses, isSleeping: false, built: { base: true }, dog: null, steal: null, world: { active: null },
      player: { position: new THREE.Vector3(), root: { position: new THREE.Vector3() }, playAction() {} },
      clock: { isNight: true, hour: 22, day: 1 }, stats: new StatsSystem(), inventory: new InventorySystem(),
      diseases: new DiseaseSystem(), cameraRig: { follow() {} }, interaction: {}, input: { keys: {}, endFrame() {} },
      _save() {},
    });
    salir(game);
    assert.equal(llama.witnessing, null);
    assert.equal(witnesses.calls.length, 0);
    correr(witnesses, fake, 10);
    assert.equal(fake.steal.buscado, 1);
    witnesses.dispose();
  }
});
