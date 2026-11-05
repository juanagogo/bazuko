import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handDrawnRing, markSeed } from '../src/world/groundMarks.js';

const radii = (geometry) => {
  const p = geometry.getAttribute('position');
  const out = [];
  for (let i = 0; i < p.count; i++) out.push(Math.hypot(p.getX(i), p.getY(i)));
  return out;
};

test('la marca a mano ocupa el sitio del aro que reemplaza, sin salirse', () => {
  for (const [inner, outer] of [[.36, .4], [.5, .6], [1, 1.3], [1.2, 1.5], [1.9, 2.1]]) {
    const r = radii(handDrawnRing(inner, outer, 3));
    assert.ok(Math.min(...r) > inner * .85, `por dentro a ${inner}`);
    assert.ok(Math.max(...r) < outer * 1.15, `por fuera a ${outer}`);
    const p = handDrawnRing(inner, outer, 3).getAttribute('position');
    for (let i = 0; i < p.count; i++) assert.equal(p.getZ(i), 0, 'plana: se acuesta como un aro');
  }
});

test('el mismo sitio dibuja el mismo trazo y otro sitio otro', () => {
  const a = handDrawnRing(1, 1.3, markSeed(41, 55)).getAttribute('position').array;
  const b = handDrawnRing(1, 1.3, markSeed(41, 55)).getAttribute('position').array;
  const c = handDrawnRing(1, 1.3, markSeed(8, 8)).getAttribute('position').array;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('da la vuelta completa y un poco más, con índices válidos', () => {
  const g = handDrawnRing(1, 1.3, 5);
  const count = g.getAttribute('position').count;
  assert.ok(g.index.array.every(i => i < count));
  assert.equal(g.getAttribute('uv').count, count);
  assert.equal(g.getAttribute('normal').count, count);
});
