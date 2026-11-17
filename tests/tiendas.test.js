import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Shop } from '../src/entities/Shop.js';
import { D69_STORE, paintD69Store, buildD69Store } from '../src/world/bogota/D69Store.js';

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
  // El sólido real del juego va de x −1,2 a 1,2 y de z −0,75 a 0,75: `CollisionSystem.add` no usa el
  // desplazamiento que le pasa `game.js`. Lo que se apoya en el andén (canastas, silla, mesita, fruta) queda
  // dentro, para que nadie pueda pararse encima; hacia atrás la caseta llega a −1,5, como la estantería de
  // antes. El toldo y los bombillos sí vuelan sobre el andén, por encima de quien pasa.
  let top = 0;
  for (const mesh of meshesOf(shop.group)) {
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.attributes.position, point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      top = Math.max(top, point.y);
      if (point.y > 2.05) continue;
      assert.ok(Math.abs(point.x) <= 1.22 && point.z >= -1.55 && point.z <= .76, `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`);
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

test('Doña Inés es una sola malla más sus dos avisos, sin luces y dentro de su lote', () => {
  assert.deepEqual({ ...D69_STORE }, { x0: 43, x1: 53, z0: 159, z1: 173, height: 5, name: 'Doña Inés' });
  assert.equal(typeof paintD69Store, 'function');
  const signs = [];
  const model = buildD69Store({ createSign: options => { signs.push(options); return new THREE.Texture(); } });
  assert.equal(model.name, 'Tienda D69');
  assert.equal(signs.length, 2);
  // Antes eran veinte cajas con cinco materiales.
  const meshes = meshesOf(model);
  assert.equal(meshes.length, 3);
  assert.ok(trianglesOf(model) <= 6000, `${trianglesOf(model)} triángulos`);
  assert.equal(lightsOf(model).length, 0);
  const building = meshes.find(mesh => mesh.material.emissive);
  // Fuera de la fusión de la ciudad: su material cambia con la hora.
  assert.equal(building.userData.noMerge, true);
  building.onBeforeRender(null, day);
  assert.equal(building.material.emissiveIntensity, 0);
  building.onBeforeRender(null, night);
  assert.equal(building.material.emissiveIntensity, 1);
  // Nada sube más que el antepecho ni se sale del lote más que el alero y la marquesina.
  const bounds = new THREE.Box3().setFromObject(model);
  assert.ok(bounds.min.x > 42.5 && bounds.max.x < 53.4);
  assert.ok(bounds.min.z > 158.5 && bounds.max.z < 173.5);
  assert.ok(bounds.max.y < 5.2);
  // El lote es sólido hasta x = 53. Carritos, fruta y bolardos quedan dentro, pegados a la fachada, y el vidrio
  // a medio metro del borde: lo que se ve coincide con donde uno choca. Solo el alero y la marquesina vuelan.
  const spot = building.geometry.attributes.position, glow = building.geometry.attributes.color;
  let glassAt = 0, brightest = 0;
  for (let i = 0; i < spot.count; i++) {
    brightest = Math.max(brightest, glow.getW(i));
    if (spot.getZ(i) < 159.5 || spot.getZ(i) > 172.5) continue;
    if (spot.getY(i) < 2.5) assert.ok(spot.getX(i) <= 53.1, `x ${spot.getX(i).toFixed(2)} a ${spot.getY(i).toFixed(2)} m`);
    if (glow.getW(i) > 2) glassAt = Math.max(glassAt, spot.getX(i) < 53 && spot.getY(i) < 3 ? spot.getX(i) : 0);
  }
  assert.ok(glassAt > 52.4 && glassAt < 52.9, `vidrio en x ${glassAt}`);
  // De noche las vitrinas se ven encendidas, no quemadas.
  assert.ok(brightest <= 3, `brillo ${brightest}`);
  // Hay techo con equipos: algo sobresale de la losa, que queda hundida tras el antepecho.
  const position = building.geometry.attributes.position;
  let onRoof = 0;
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > 4.7 && position.getX(i) > 43.6 && position.getX(i) < 52.4 && position.getZ(i) > 159.6 && position.getZ(i) < 172.4) onRoof++;
  }
  assert.ok(onRoof > 50, `${onRoof} vértices sobre la losa`);
});
