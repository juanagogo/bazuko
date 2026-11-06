import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Caleta, CALETA } from '../src/systems/Caleta.js';
import { OBJECTIVES } from '../src/data/objectives.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('guardar y sacar mueven la plata sin crearla ni perderla', () => {
  const c = new Caleta({ target: new EventTarget() });
  const stats = { dinero: 12000 };
  assert.equal(c.guardar(stats, 5000), 5000);
  assert.deepEqual([stats.dinero, c.plata], [7000, 5000]);
  assert.equal(c.guardar(stats), 7000);
  assert.deepEqual([stats.dinero, c.plata], [0, 12000]);
  assert.equal(c.guardar(stats), 0);
  assert.equal(c.sacar(stats, 99999), 12000);
  assert.deepEqual([stats.dinero, c.plata], [12000, 0]);
  assert.equal(c.guardar(stats, -50), 0);
});

test('el ladrón se lleva una parte y se guarda en la partida', () => {
  const c = new Caleta({ target: new EventTarget() });
  c.deserialize({ plata: 10000 });
  assert.equal(c.robar(), 10000 * CALETA.roboNocturno);
  assert.equal(c.plata, 10000 * (1 - CALETA.roboNocturno));
  const d = new Caleta({ target: new EventTarget() });
  d.deserialize(c.serialize());
  assert.equal(d.plata, c.plata);
  d.deserialize(null); assert.equal(d.plata, 0);
  d.deserialize({ plata: 'nada' }); assert.equal(d.plata, 0);
});

test('avisa cuando cambia', () => {
  const target = new EventTarget();
  const seen = [];
  target.addEventListener('caleta', (e) => seen.push(e.detail.plata));
  const c = new Caleta({ target });
  c.guardar({ dinero: 300 });
  assert.deepEqual(seen, [300]);
});

test('ahorrar cuenta también lo guardado en la caleta', () => {
  const ahorrar = OBJECTIVES.find((o) => o.id === 'ahorrar');
  assert.equal(ahorrar.progress({ stats: { dinero: 5000 }, caleta: { plata: 15000 } }), 20000);
  assert.match(src('src/systems/EncargoSystem.js'), /caleta\?\.plata/);
  assert.match(src('src/data/encargos.js'), /caleta\?\.plata/);
});

test('el arresto no toca la caleta; el ladrón nocturno sí, y se guarda en la partida', () => {
  const game = src('src/core/game.js');
  const arresto = game.slice(game.indexOf('_finishArrest() {'), game.indexOf('_finishArrest() {') + 1500);
  assert.doesNotMatch(arresto, /caleta/);
  assert.match(game, /robbedCaleta = this\.caleta\?\.robar\(\)/);
  assert.match(game, /caleta: this\.caleta\?\.serialize\(\)/);
  assert.match(game, /this\.caleta\?\.deserialize\(data\.caleta\)/);
  const menus = src('src/ui/placeMenus.js');
  assert.match(menus, /caletaRow\(game\)/);
  assert.doesNotMatch(menus.slice(menus.indexOf('function caletaRow')), /\b(tienes|guarda tu|puedes)\b/i);
});
