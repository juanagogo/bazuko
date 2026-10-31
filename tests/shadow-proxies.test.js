import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildShadowProxies, enableShadowProxyLayer, proxyableMaterial, SHADOW_PROXY_LAYER } from '../src/graphics/ShadowProxies.js';

const box = (x, z, material = new THREE.MeshStandardMaterial()) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), material);
  mesh.position.set(x, 3, z);mesh.castShadow = true;
  return mesh;
};

test('los inmuebles se sustituyen por celdas en la capa de sombra y dejan de proyectar', () => {
  const root = new THREE.Group();root.position.set(10, 0, 0);
  const a = box(1, 1), b = box(20, 5), far = box(200, 0), glass = box(3, 3, new THREE.MeshStandardMaterial({ transparent: true }));
  const moving = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());moving.castShadow = true;
  root.add(a, b, far, glass, moving);
  const { group, replaced, proxies } = buildShadowProxies([a, b, far, glass, moving], root, { cell: 64 });
  assert.equal(replaced, 3);assert.equal(proxies, 2, 'a y b comparten celda; far va aparte');
  assert.deepEqual([a, b, far].map(m => m.castShadow), [false, false, false]);
  assert.equal(glass.castShadow, true, 'lo transparente sigue proyectando por sí mismo');
  assert.equal(moving.castShadow, true, 'lo animado no se sustituye');
  assert.equal(group.parent, root);
  for (const proxy of group.children) {
    assert.equal(proxy.layers.mask, 1 << SHADOW_PROXY_LAYER);
    assert.equal(proxy.castShadow, true);assert.equal(proxy.receiveShadow, false);
    assert.deepEqual(Object.keys(proxy.geometry.attributes), ['position']);
  }
  // Mismas posiciones en el mundo que los originales, aunque el padre tenga transformación.
  root.updateMatrixWorld(true);
  const original = new THREE.Box3().setFromObject(a).union(new THREE.Box3().setFromObject(b));
  const cellProxy = group.children.find(p => p.geometry.attributes.position.count === 48);
  const proxyBox = new THREE.Box3().setFromObject(cellProxy);
  assert.ok(proxyBox.min.distanceTo(original.min) < 1e-5 && proxyBox.max.distanceTo(original.max) < 1e-5);
});

test('las cámaras de la sombra ven la capa de sustitutos y la vista no', () => {
  const light = new THREE.DirectionalLight();
  enableShadowProxyLayer(light);
  assert.equal(light.shadow.camera.layers.isEnabled(SHADOW_PROXY_LAYER), true);
  assert.equal(new THREE.PerspectiveCamera().layers.isEnabled(SHADOW_PROXY_LAYER), false);
  const cams = [new THREE.OrthographicCamera(), new THREE.OrthographicCamera()];
  enableShadowProxyLayer({ shadow: { getViewportCount: () => 2, getCamera: i => cams[i] } });
  assert.ok(cams.every(c => c.layers.isEnabled(SHADOW_PROXY_LAYER) && c.layers.isEnabled(0)));
  assert.equal(proxyableMaterial(new THREE.MeshStandardMaterial({ alphaTest: .5 })), false);
});

test('las piezas que se atenúan llevan su sustituto como hijo y desaparecen juntos', () => {
  const wall = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  material.userData.visibilityFade = true;
  const a = box(0, 0, material), b = box(5, 0, material);
  wall.add(a, b);
  assert.equal(buildShadowProxies([a, b], wall).replaced, 0, 'sin permiso no se tocan las piezas atenuables');
  const { group, replaced, proxies } = buildShadowProxies([a, b], wall, { cell: Infinity, allowFade: true });
  assert.equal(replaced, 2);assert.equal(proxies, 1);assert.equal(group.parent, wall);
  wall.visible = false;
  let drawn = false;wall.traverseVisible(o => { if (o.userData.shadowProxy) drawn = true; });
  assert.equal(drawn, false, 'una pared oculta tampoco proyecta su sombra');
});
