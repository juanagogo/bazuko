import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Fiado, FIADO, cupoDeFiado } from '../src/systems/Fiado.js';

const fama = (valor) => ({ valor, sumar(d) { this.valor += d; } });
const nuevo = (valor) => new Fiado({ reputation: fama(valor), target: new EventTarget() });

test('Doña Rosa solo le fía a los conocidos, y más a los queridos', () => {
  assert.equal(cupoDeFiado(0), 0);
  assert.equal(cupoDeFiado(-60), 0);
  assert.equal(cupoDeFiado(FIADO.desdeFama), FIADO.cupoConocido);
  assert.equal(cupoDeFiado(FIADO.queridoFama), FIADO.cupoQuerido);
  assert.equal(nuevo(0).puedeFiar(1000, 1), false);
});

test('fía hasta el cupo y la deuda se paga con lo que cargue', () => {
  const f = nuevo(30);
  assert.ok(f.fiar(3000, 1));
  assert.equal(f.fiar(3000, 1), false);
  assert.ok(f.fiar(2000, 2));
  assert.equal(f.deuda, FIADO.cupoConocido);
  const stats = { dinero: 1500 };
  assert.equal(f.pagar(stats, 2), 1500);
  assert.deepEqual([stats.dinero, f.deuda], [0, 3500]);
  stats.dinero = 9000;
  assert.equal(f.pagar(stats, 3), 3500);
  assert.deepEqual([stats.dinero, f.deuda, f.desde], [5500, 0, null]);
  assert.equal(f.reputation.valor, 30 + FIADO.famaPagar);
});

test('pasado el plazo baja la fama una vez por día y no fía más', () => {
  const target = new EventTarget();
  const toasts = [];
  target.addEventListener('toast', (e) => toasts.push(e.detail.text));
  const f = new Fiado({ reputation: fama(30), target });
  f.fiar(1000, 1);
  f.update(1 + FIADO.plazoDias);
  assert.equal(f.reputation.valor, 30);
  const tarde = 2 + FIADO.plazoDias;
  f.update(tarde); f.update(tarde);
  assert.equal(f.reputation.valor, 30 + FIADO.famaMoroso);
  assert.equal(toasts.length, 1);
  assert.equal(f.puedeFiar(500, tarde), false);
  f.update(tarde + 1);
  assert.equal(f.reputation.valor, 30 + 2 * FIADO.famaMoroso);
  f.pagar({ dinero: 5000 }, tarde + 1);
  assert.equal(f.reputation.valor, 30 + 2 * FIADO.famaMoroso, 'pagar tarde no premia');
  for (const t of toasts) assert.doesNotMatch(t, /\b(tú|tienes|debes|paga)\b/i);
});

test('la deuda se guarda en la partida', () => {
  const f = nuevo(60);
  f.fiar(4000, 5);
  const g = nuevo(60);
  g.deserialize(JSON.parse(JSON.stringify(f.serialize())));
  assert.deepEqual([g.deuda, g.desde], [4000, 5]);
  g.deserialize({ deuda: 'x' });
  assert.deepEqual([g.deuda, g.desde], [0, null]);
});

test('el juego y la tienda usan el fiado', () => {
  const game = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(game, /fiado: this\.fiado\?\.serialize\(\)/);
  assert.match(game, /this\.fiado\?\.update\(/);
  const menus = readFileSync(new URL('../src/ui/placeMenus.js', import.meta.url), 'utf8');
  assert.match(menus, /fiado\.fiar\(s\.price/);
  assert.match(menus, /Pagar lo fiado/);
});
