import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Shop } from '../src/entities/Shop.js';

// Los letreros se pintan en un lienzo: en Node basta uno que acepte cualquier llamada.
const pencil = new Proxy({}, { get: () => () => {}, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => pencil }) };

const meshesOf = root => { const list = []; root.traverse(o => { if (o.isMesh) list.push(o); }); return list; };
const trianglesOf = root => meshesOf(root).reduce((sum, mesh) =>
  sum + (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3, 0);
const lightsOf = root => { const list = []; root.traverse(o => { if (o.isLight) list.push(o); }); return list; };
const night = { userData: { environmentDay: 0 } }, day = { userData: { environmentDay: 1 } };

test('La Esquinita conserva su interfaz y se dibuja con pocas mallas', t => {
  const scene = new THREE.Scene();
  const shop = new Shop(scene, new THREE.Vector3(108, 0, 70));
  t.after(() => shop.dispose());
  assert.equal(shop.kind, 'shop');
  assert.equal(shop.position, shop.group.position);
  assert.deepEqual(shop.position.toArray(), [108, 0, 70]);
  assert.equal(typeof shop.update, 'function');
  assert.equal(shop.group.parent, scene);
  // Antes era una malla por cajita (33); ahora caseta y mercancía van juntas y solo los letreros van aparte.
  assert.ok(meshesOf(shop.group).length <= 5, `${meshesOf(shop.group).length} mallas`);
  assert.ok(meshesOf(shop.group).filter(mesh => mesh.castShadow).length <= 1);
  assert.ok(trianglesOf(shop.group) <= 6000, `${trianglesOf(shop.group)} triángulos`);
  // La misma luz de siempre y ninguna más.
  const lights = lightsOf(shop.group);
  assert.equal(lights.length, 1);
  assert.ok(lights[0].isPointLight);
  assert.deepEqual([lights[0].color.getHex(), lights[0].intensity, lights[0].distance, ...lights[0].position.toArray()], [0xffd9a0, 3, 7, 0, 2, 0.4]);
});

test('lo que pisa el andén en La Esquinita no se sale de su sitio', t => {
  const shop = new Shop(new THREE.Scene(), new THREE.Vector3());
  t.after(() => shop.dispose());
  // El colisionador del juego va de x −1,2 a 1,2 y de z −1,45 a 0,05. Por debajo de la cabeza nada se aleja
  // más de medio metro; el toldo y los bombillos sí vuelan sobre el andén, por encima de quien pasa.
  let top = 0;
  for (const mesh of meshesOf(shop.group)) {
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.attributes.position, point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      top = Math.max(top, point.y);
      if (point.y > 2.05) continue;
      assert.ok(Math.abs(point.x) <= 1.7 && point.z >= -1.55 && point.z <= .5, `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`);
    }
  }
  assert.ok(top > 3 && top < 3.8, `altura ${top}`);
});

test('La Esquinita se enciende de noche y al cerrar lo libera todo', () => {
  const scene = new THREE.Scene();
  const shop = new Shop(scene, new THREE.Vector3());
  const glowing = meshesOf(shop.group).filter(mesh => mesh.material.emissive);
  assert.equal(glowing.length, 1);
  glowing[0].onBeforeRender(null, day);
  const atNoon = glowing[0].material.emissiveIntensity;
  glowing[0].onBeforeRender(null, night);
  assert.ok(glowing[0].material.emissiveIntensity > atNoon + .5);
  const owned = new Set();
  for (const mesh of meshesOf(shop.group)) { owned.add(mesh.geometry); owned.add(mesh.material); if (mesh.material.map) owned.add(mesh.material.map); }
  const freed = new Set();
  for (const item of owned) item.addEventListener('dispose', () => freed.add(item));
  shop.dispose();
  assert.equal(shop.group.parent, null);
  assert.equal(freed.size, owned.size);
});
