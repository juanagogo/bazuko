import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { JornadaSystem, FRANJAS, franjaDe } from '../src/systems/JornadaSystem.js';
import { WitnessSystem, WITNESS } from '../src/systems/WitnessSystem.js';

test('cada hora cae en su franja', () => {
  assert.equal(franjaDe(3), FRANJAS.madrugada);
  assert.equal(franjaDe(6), FRANJAS.manana);
  assert.equal(franjaDe(11.9), FRANJAS.manana);
  assert.equal(franjaDe(12), FRANJAS.tarde);
  assert.equal(franjaDe(20), FRANJAS.noche);
  assert.equal(franjaDe(24), FRANJAS.madrugada);
  assert.equal(franjaDe(-1), FRANJAS.noche);
});

test('de día la Policía ve más; de noche hay más botín y más riesgo', () => {
  const { manana, noche, madrugada } = FRANJAS;
  assert.ok(manana.policiaVista > noche.policiaVista && noche.policiaVista > madrugada.policiaVista);
  assert.ok(noche.botin > manana.botin && madrugada.botin > noche.botin);
  assert.ok(noche.golpe > manana.golpe);
  assert.ok(noche.testigosRadio < manana.testigosRadio);
  assert.ok(madrugada.limosna < manana.limosna);
});

test('avisa una sola vez al cambiar de franja, y sincronizar no avisa', () => {
  const target = new EventTarget();
  const toasts = [];
  target.addEventListener('toast', (e) => toasts.push(e.detail.text));
  const clock = { hour: 19.5 };
  const j = new JornadaSystem(clock, { target });
  j.update();
  assert.equal(toasts.length, 0);
  clock.hour = 20.1; j.update(); j.update();
  assert.deepEqual(toasts, [FRANJAS.noche.aviso]);
  clock.hour = 8; j.sincronizar(); j.update();
  assert.equal(toasts.length, 1);
  assert.equal(j.franja, FRANJAS.manana);
});

test('los avisos no tutean ni llevan emojis', () => {
  for (const f of Object.values(FRANJAS)) {
    assert.doesNotMatch(f.aviso, /\b(tú|tienes|puedes|vete|corre)\b/i);
    assert.doesNotMatch(f.aviso, /\p{Extended_Pictographic}/u);
  }
});

test('de noche menos gente alcanza a ver el robo', () => {
  globalThis.window = new EventTarget();
  const pos = (x) => ({ x, y: 0, z: 0 });
  const npc = (x) => ({ position: pos(x), hp: 10 });
  const lejos = WITNESS.radius * .9;
  const game = { player: { position: pos(0) }, world: { active: { npcs: [npc(lejos), npc(2)] } } };
  const w = new WitnessSystem(game);
  assert.equal(w._witnesses(game.player.position).length, 2);
  game.jornada = { franja: FRANJAS.noche };
  assert.equal(w._witnesses(game.player.position).length, 1);
  w.dispose();
});

test('la patrulla ve menos de noche y el juego le pasa la franja', () => {
  const traffic = readFileSync(new URL('../src/systems/TrafficSystem.js', import.meta.url), 'utf8');
  assert.match(traffic, /franja\?\.policiaVista/);
  assert.match(traffic, /franja\?\.policiaPierde/);
  const game = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(game, /this\.traffic\.franja = this\.jornada/);
});
