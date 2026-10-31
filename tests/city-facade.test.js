import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyFacadeAttributes, facadeTone, createCityFacadeMaterial, FACADE_ATTRIBUTES } from '../src/graphics/CityFacade.js';

test('los datos de fachada viajan en los vértices y el tono sigue el estilo', () => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const tone = facadeTone('ladrillo', () => 0);
  applyFacadeAttributes(geometry, { width: 8, floors: 3, style: 'ruina', seed: 412, tone });
  const params = geometry.attributes.facadeParams, colors = geometry.attributes.facadeTone;
  assert.equal(params.count, geometry.attributes.position.count);
  assert.deepEqual([...params.array.slice(0, 4)], [8, 3, 2, 412]);
  assert.deepEqual([...colors.array.slice(0, 3)].map(v => +v.toFixed(4)), [tone.r, tone.g, tone.b].map(v => +v.toFixed(4)));
  assert.ok(facadeTone('pintada', () => .99) instanceof THREE.Color);
});

test('todas las casas comparten un material cuyo grafo declara los atributos que necesita la fusión', () => {
  const a = createCityFacadeMaterial(), b = createCityFacadeMaterial();
  assert.equal(a.colorNode, b.colorNode, 'el grafo TSL se comparte entre materiales');
  assert.deepEqual(a.userData.vertexAttributes, [...FACADE_ATTRIBUTES]);
  assert.equal(a.userData.cityFacade, true);
  const copy = a.clone();
  assert.equal(copy.colorNode, a.colorNode, 'la copia por pared del corte isométrico no crea otro grafo');
  assert.deepEqual(copy.userData.vertexAttributes, [...FACADE_ATTRIBUTES]);
});
