import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FrustumCulling } from '../src/core/FrustumCulling.js';
import { LightHalos } from '../src/core/LightHalos.js';
import { createRenderSectors } from '../src/world/bogota/StaticGeometry.js';
import { Renderer } from '../src/core/Renderer.js';

function camera() {
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -10);
  return camera;
}
function box(x, z, width = 2) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 4, 2), new THREE.MeshBasicMaterial());
  mesh.position.set(x, 2, z);
  return mesh;
}

test('descarta grupos detrás y fuera de los lados; girar la cámara los recupera en el mismo cuadro', () => {
  const scene = new THREE.Scene(), culling = new FrustumCulling(), view = camera();
  const front = box(0, -10), behind = box(0, 10), side = box(40, -10);
  scene.add(front, behind, side);
  for (const object of scene.children) culling.register(object);
  culling.apply(view);
  assert.equal(front.visible, true);
  assert.equal(behind.visible, false);
  assert.equal(side.visible, false);
  assert.equal(culling.stats.culled, 2);
  view.lookAt(0, 2, 10);
  culling.apply(view);
  assert.equal(front.visible, false);
  assert.equal(behind.visible, true);
  culling.restore();
  assert.ok(scene.children.every(o => o.visible));
});

test('comprueba el volumen completo y mantiene los objetos parcialmente visibles en el borde', () => {
  const culling = new FrustumCulling(), view = camera();
  // Su centro está fuera del frustum, pero la parte izquierda entra en pantalla.
  const wide = box(10, -10, 16);
  culling.register(wide);
  culling.apply(view);
  assert.equal(wide.visible, true);
  assert.equal(culling.stats.visible, 1);
});

test('vehículos fuera de cámara siguen desplazándose y reaparecen sin reiniciar su estado', () => {
  const culling = new FrustumCulling(), view = camera(), car = box(0, 10);
  culling.register(car, { dynamic: true, margin: .5 });
  culling.apply(view);
  assert.equal(car.visible, false);
  culling.restore();
  car.position.z = -10;
  car.rotation.y = Math.PI / 3;
  culling.apply(view);
  assert.equal(car.visible, true);
  assert.equal(car.position.z, -10);
  culling.clear();
  assert.equal(culling.entries.length, 0);
});

test('conserva sombras fuera de pantalla y respeta objetos ocultos por el juego', () => {
  const scene = new THREE.Scene(), culling = new FrustumCulling(), view = camera();
  const caster = box(0, 8), far = box(80, 8), hidden = box(0, -8);
  caster.castShadow = far.castShadow = true;
  hidden.visible = false;
  const sun = new THREE.DirectionalLight();
  sun.position.set(0, 20, 0);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, far: 50 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target, caster, far, hidden);
  for (const object of [caster, far, hidden]) culling.register(object);
  culling.apply(view, [sun]);
  assert.equal(caster.visible, true);
  assert.equal(culling.stats.shadowOnly, 1);
  assert.equal(far.visible, false);
  assert.equal(hidden.visible, false);
  culling.restore();
  assert.equal(hidden.visible, false);
  culling.apply(view); // sin sombras puede omitir también el edificio posterior
  assert.equal(caster.visible, false);
  culling.restore();
});

test('sectorizar conserva transformaciones, referencias y ramas animadas', () => {
  const root = new THREE.Group();
  root.position.set(20, 0, 10);
  root.rotation.y = .4;
  const a = box(1, -10), b = box(3, -12), far = box(100, -10), bus = box(2, -8), animated = box(1, -9);
  animated.userData.update = () => {};
  root.add(a, b, far, bus, animated);
  root.updateMatrixWorld(true);
  const before = new Map([a, b, far, bus, animated].map(o => [o, o.matrixWorld.clone()]));
  const sectors = createRenderSectors(root, new Set([bus]));
  assert.equal(sectors.length, 2);
  assert.equal(a.parent, b.parent);
  assert.equal(bus.parent, root);
  assert.equal(animated.parent, root);
  root.updateMatrixWorld(true);
  for (const [object, matrix] of before) assert.ok(object.matrixWorld.equals(matrix));
});

test('halos fuera de cámara no ocupan instancias; un halo parcialmente visible permanece', () => {
  const scene = new THREE.Scene(), halos = new LightHalos(scene), view = camera();
  view.position.set(0, 6, 0);
  view.lookAt(0, 0, -10);
  const light = new THREE.PointLight(0xff8800, 3, 8);
  const entries = [-10, 10, -15].map(z => ({ light, position: new THREE.Vector3(0, 2, z) }));
  halos.update(entries, new THREE.Vector3(), () => 0, view);
  assert.equal(halos.mesh.count, 2);
  view.lookAt(0, 0, 10);
  halos.update(entries, new THREE.Vector3(), () => 0, view);
  assert.equal(halos.mesh.count, 1);
  halos.dispose();
});

test('un error de render no deja sectores ocultos para la simulación o la siguiente cámara', () => {
  const culling = new FrustumCulling(), mesh = box(0, 10), scene = new THREE.Scene();
  scene.add(mesh);
  culling.register(mesh);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    culling, instance: { info: { reset() {} }, shadowMap: { enabled: false }, render() {
      assert.equal(mesh.visible, false);
      throw new Error('render falló');
    } }
  });
  assert.throws(() => renderer.render(scene, camera()), /render falló/);
  assert.equal(mesh.visible, true);
});

test('los objetos pequeños dejan de proyectar sombra más allá de su alcance sin dejar de verse', () => {
  const scene = new THREE.Scene(), culling = new FrustumCulling(), view = camera();
  const near = box(0, -10), far = box(0, -80);
  near.castShadow = far.castShadow = true;
  scene.add(near, far);
  culling.register(near, { shadowRange: 40 });
  culling.register(far, { shadowRange: 40 });
  view.far = 200;
  view.updateProjectionMatrix();
  culling.apply(view);
  assert.equal(near.castShadow, true);
  assert.equal(far.visible, true, 'sigue dibujándose en la vista');
  assert.equal(far.castShadow, false, 'su sombra lejana se omite');
  view.position.z = -70;
  culling.apply(view);
  assert.equal(far.castShadow, true, 'al acercarse vuelve a proyectar sombra');
  assert.equal(near.castShadow, false);
});
