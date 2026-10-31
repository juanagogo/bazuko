import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShopSignAtlas } from '../src/world/bogota/ShopSignAtlas.js';

function withCanvas(run) {
  const draws = [];
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (...args) => draws.push(args) }) }) };
  try { return run(draws); } finally { delete globalThis.document; }
}
const source = () => Object.assign(new THREE.Texture(), { image: { getContext() {} } });

test('los rótulos repetidos comparten casilla y los distintos comparten el material del atlas', () => {
  withCanvas(draws => {
    const atlas = new ShopSignAtlas(() => source());
    const a = atlas.get({ title: 'TIENDA', sub: 'PACHO', bg: '#fff', fg: '#000' });
    assert.equal(atlas.get({ title: 'TIENDA', sub: 'PACHO', bg: '#fff', fg: '#000' }), a);
    const b = atlas.get({ title: 'MINUTOS', sub: 'A TODO OPERADOR', bg: '#fff', fg: '#000' });
    assert.equal(a.material, b.material);
    assert.notDeepEqual(a.uv, b.uv);
    assert.equal(draws.length, 2);
    for (const slot of [a, b]) assert.ok(slot.uv[0] >= 0 && slot.uv[2] <= 1 && slot.uv[1] >= 0 && slot.uv[3] <= 1 && slot.uv[0] < slot.uv[2] && slot.uv[1] < slot.uv[3]);
    atlas.dispose();
  });
});

test('pasada la capacidad de un atlas se abre otro y la malla recorre solo su casilla', () => {
  withCanvas(() => {
    const atlas = new ShopSignAtlas(() => source());
    for (let i = 0; i < 65; i++) atlas.get({ title: 'R' + i, sub: '', bg: '#fff', fg: '#000' });
    assert.equal(atlas.atlases.length, 2);
    const mesh = atlas.mesh({ title: 'R3', sub: '', bg: '#fff', fg: '#000' }, 2);
    const [u0, v0, u1, v1] = atlas.get({ title: 'R3', sub: '', bg: '#fff', fg: '#000' }).uv, uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) { assert.ok(uv.getX(i) === u0 || uv.getX(i) === u1); assert.ok(uv.getY(i) === v0 || uv.getY(i) === v1); }
    assert.equal(mesh.material, atlas.atlases[0].material);
    atlas.dispose();
  });
});

test('sin lienzo cae a una textura propia y sin textura no hay rótulo', () => {
  const atlas = new ShopSignAtlas(() => new THREE.Texture());
  const slot = atlas.get({ title: 'X', sub: '', bg: '#fff', fg: '#000' });
  assert.deepEqual(slot.uv, [0, 0, 1, 1]);
  assert.equal(new ShopSignAtlas(() => null).mesh({ title: 'X' }, 2), null);
  atlas.dispose();
});
