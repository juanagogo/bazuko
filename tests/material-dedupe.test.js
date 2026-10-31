import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { materialSignature, MaterialDeduper, VertexColorCarriers, bakeVertexColor, isPlainSurface } from '../src/world/bogota/StaticGeometry.js';

test('dos materiales idénticos comparten firma y uno distinto en cualquier valor visible no', () => {
  const map = new THREE.Texture();
  const a = new THREE.MeshStandardMaterial({ color: '#a5aaa5', roughness: .8, map });
  const b = new THREE.MeshStandardMaterial({ color: '#a5aaa5', roughness: .8, map });
  b.name = 'otro nombre';
  assert.equal(materialSignature(a), materialSignature(b));
  for (const change of [m => m.color.set('#a5aaa6'), m => { m.roughness = .7; }, m => { m.map = new THREE.Texture(); },
    m => { m.transparent = true; }, m => { m.side = THREE.DoubleSide; }, m => { m.userData.visibilityFade = true; }]) {
    const c = a.clone(); change(c);
    assert.notEqual(materialSignature(c), materialSignature(a));
  }
  assert.notEqual(materialSignature(new THREE.MeshLambertMaterial()), materialSignature(new THREE.MeshStandardMaterial()));
});

test('la unificación respeta los materiales vivos y libera solo las copias sin uso', () => {
  const live = new THREE.MeshStandardMaterial({ color: 'red' });
  const a = new THREE.MeshStandardMaterial({ color: 'red' }), b = new THREE.MeshStandardMaterial({ color: 'red' }), c = new THREE.MeshStandardMaterial({ color: 'red' });
  const deduper = new MaterialDeduper(new Set([live]));
  assert.equal(deduper.resolve(a), a);
  assert.equal(deduper.resolve(b), a);
  assert.equal(deduper.resolve(live), live, 'un material que el juego cambia en partida sigue siendo único');
  assert.equal(deduper.resolve(c), a);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), a), new THREE.Mesh(new THREE.BoxGeometry(), c));
  let disposed = 0;b.addEventListener('dispose', () => disposed++);c.addEventListener('dispose', () => disposed += 10);
  assert.equal(deduper.disposeUnused(root), 1);
  assert.equal(disposed, 1, 'c sigue en uso y no se libera');
});

test('los materiales lisos de distinto tono comparten un portador con el color en los vértices', () => {
  const carriers = new VertexColorCarriers();
  const a = new THREE.MeshStandardMaterial({ color: '#a5aaa5', roughness: .8 }), b = new THREE.MeshStandardMaterial({ color: '#e0a800', roughness: .8 });
  const rough = new THREE.MeshStandardMaterial({ color: '#a5aaa5', roughness: .4 });
  const first = carriers.resolve(a), second = carriers.resolve(b);
  assert.equal(first.material, second.material);
  assert.equal(first.material.vertexColors, true);
  assert.equal(first.material.color.getHex(), 0xffffff);
  assert.equal(first.color, a.color);
  assert.notEqual(carriers.resolve(rough).material, first.material);
  assert.equal(carriers.carriers.size, 2);
  const geometry = new THREE.BoxGeometry();
  bakeVertexColor(geometry, b.color);
  assert.equal(geometry.attributes.color.count, geometry.attributes.position.count);
  assert.deepEqual([...geometry.attributes.color.array.slice(0, 3)].map(v => +v.toFixed(4)), [+b.color.r.toFixed(4), +b.color.g.toFixed(4), +b.color.b.toFixed(4)]);
});

test('texturas, emisión, transparencia, datos propios y materiales vivos nunca pasan a color por vértice', () => {
  const live = new THREE.MeshStandardMaterial({ color: '#888888' });
  const carriers = new VertexColorCarriers(new Set([live]));
  assert.equal(carriers.resolve(live), null);
  for (const make of [() => new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), () => new THREE.MeshStandardMaterial({ emissive: '#ff0000' }),
    () => new THREE.MeshStandardMaterial({ transparent: true, opacity: .5 }), () => { const m = new THREE.MeshStandardMaterial(); m.userData.visibilityFade = true; return m; },
    () => new THREE.MeshLambertMaterial(), () => new THREE.MeshStandardMaterial({ flatShading: true })]) {
    assert.equal(isPlainSurface(make()), false);
    assert.equal(carriers.resolve(make()), null);
  }
});
