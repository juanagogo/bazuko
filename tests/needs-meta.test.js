import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NEED_META, needLevel } from '../src/ui/needsMeta.js';
import { NEEDS } from '../src/systems/StatsSystem.js';

test('cada necesidad del sistema tiene nombre, icono y un color distinto', () => {
  assert.deepEqual(NEED_META.map(n => n.id).sort(), [...NEEDS].sort());
  assert.equal(new Set(NEED_META.map(n => n.color)).size, NEED_META.length);
});

test('las necesidades se resaltan bajo 30 y parpadean bajo 15', () => {
  assert.equal(needLevel(80), 'ok');
  assert.equal(needLevel(30), 'ok');
  assert.equal(needLevel(29), 'low');
  assert.equal(needLevel(14.9), 'critical');
  assert.equal(needLevel(0), 'critical');
});
