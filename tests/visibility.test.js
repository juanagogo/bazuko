import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BuildingVisibility, createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { PlayerSilhouette } from '../src/core/PlayerSilhouette.js';

function fixture() {
  const scene = new THREE.Scene();
  const visibility = new BuildingVisibility();
  const shared = new THREE.MeshStandardMaterial({ color: 'red' });
  const make = (x = 0) => {
    const shell = createBuildingShell(new THREE.BoxGeometry(4, 8, 4), Array(6).fill(shared), {
      x, z: 0, height: 8, interiorMaterial: new THREE.MeshStandardMaterial({ color: '#675e50' })
    });
    scene.add(shell.root);
    return visibility.register(shell);
  };
  const building = make();
  const other = make(15);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const player = new THREE.Vector3(0, 0, -5);
  camera.position.set(0, 6, 9);
  camera.lookAt(player.clone().add(new THREE.Vector3(0, 1.1, 0)));
  camera.updateMatrixWorld(true);
  camera.userData.cameraMode = 'isometric';
  const advance = (frames = 60) => { for (let i = 0; i < frames; i++) visibility.update(1 / 60, player, camera); };
  return { scene, visibility, shared, building, other, camera, player, advance };
}

test('oculta las paredes que bloquean al jugador y el techo, conservando muros bajos y casas vecinas', () => {
  const f = fixture();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), f.shared);
  ground.rotation.x = -Math.PI / 2;
  f.scene.add(ground);
  f.advance();
  assert.equal(f.building.roof.visible, false);
  assert.equal(f.building.walls.get(4).visible, false);
  assert.equal(f.building.walls.get(5).visible, false);
  assert.equal(f.building.walls.get(0).visible, true);
  assert.equal(f.building.walls.get(1).visible, true);
  assert.equal(f.building.base.visible, true);
  assert.ok(f.other.parts.every(part => part.opacity === 1));
  assert.equal(ground.material.opacity, 1);
  assert.equal(f.shared.opacity, 1);
  assert.equal(f.shared.onBeforeCompile.toString().includes('discard'), false);
});

test('las transiciones son graduales y una esquina no hace reaparecer la pared por un solo cuadro', () => {
  const f = fixture();
  f.advance(1);
  assert.ok(f.building.roofPart.opacity > 0 && f.building.roofPart.opacity < 1);
  f.advance();
  f.camera.position.x = 40;
  f.camera.lookAt(f.player);
  f.camera.updateMatrixWorld(true);
  f.advance(1);
  assert.equal(f.building.roofPart.opacity, 0);
  f.advance(13);
  assert.ok(f.building.roofPart.opacity > 0 && f.building.roofPart.opacity < 1);
  f.advance();
  assert.ok(f.building.parts.every(part => part.opacity === 1 && part.object.visible));
});

test('volver a tercera persona restaura inmediatamente todas las piezas y mantiene sus materiales aislados', () => {
  const f = fixture();
  f.advance();
  f.camera.userData.cameraMode = 'third-person';
  f.advance(1);
  assert.equal(f.visibility.enabled, false);
  assert.ok(f.building.parts.every(part => part.object.visible && part.opacity === 1));
  for (const part of f.building.parts) for (const material of part.materials) {
    assert.notEqual(material, f.shared);
    assert.equal(material.transparent, false);
    assert.equal(material.depthWrite, true);
  }
});

test('la versión agrupada conserva triángulos y alterna sin duplicar edificios ni perder el recorte', () => {
  const f = fixture();
  const count = objects => {
    let total = 0;
    for (const object of objects) object.traverse(o => { if (o.isMesh) total += o.geometry.index.count; });
    return total;
  };
  const parts = f.visibility.buildings.flatMap(building => building.parts.map(p => p.object));
  const indices = count(parts);
  const batch = f.visibility.buildClosedView();
  f.scene.add(batch);
  assert.equal(count([batch]), indices);
  const originalBounds = new THREE.Box3();
  for (const part of parts) originalBounds.union(new THREE.Box3().setFromObject(part));
  assert.ok(new THREE.Box3().setFromObject(batch).equals(originalBounds));
  f.camera.userData.cameraMode = 'third-person';
  f.advance(1);
  assert.equal(batch.visible, true);
  assert.ok(parts.every(p => !p.visible));
  f.camera.userData.cameraMode = 'isometric';
  f.advance();
  assert.equal(batch.visible, false);
  assert.equal(f.building.roofPart.opacity, 0);
  f.camera.userData.cameraMode = 'third-person';
  f.advance(1);
  assert.ok(parts.every(p => !p.visible));
  assert.equal(batch.visible, true);
  batch.traverse(o => { if (o.isMesh) assert.equal(o.material.opacity, 1); });
});

test('el techo y las paredes separadas conservan altura, normales y un piso interior cerrado', () => {
  const f = fixture();
  const before = new THREE.Box3().setFromObject(f.building.root);
  assert.deepEqual(before.min.toArray(), [-2, 0, -2]);
  assert.deepEqual(before.max.toArray(), [2, 8, 2]);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
  const floor = ray.intersectObject(f.building.base, true);
  assert.ok(floor.length >= 1);
  assert.ok(Math.abs(floor[0].point.y - 0.65) < 1e-6);
  f.advance();
  assert.ok(f.building.base.children.every(mesh => mesh.geometry.attributes.normal && mesh.geometry.attributes.uv));
});

test('los tabiques de casas contiguas no se superponen al mostrar sus caras interiores', () => {
  const f = fixture();
  const neighbour = createBuildingShell(new THREE.BoxGeometry(4, 8, 4), Array(6).fill(f.shared), {
    x: 4, z: 0, height: 8, interiorMaterial: f.shared
  });
  f.scene.add(neighbour.root);
  f.scene.updateMatrixWorld(true);
  const first = new THREE.Box3().setFromObject(f.building.walls.get(0));
  const second = new THREE.Box3().setFromObject(neighbour.walls.get(1));
  assert.ok(second.min.x - first.max.x > 0.02);
});

test('la cara interior de la fachada muestra ladrillo y conserva su escala, sin rótulos invertidos', () => {
  const brick = new THREE.MeshStandardMaterial({ color: 'red' });
  const facade = new THREE.MeshStandardMaterial({ color: 'blue' });
  const materials = Array(6).fill(brick);
  materials[4] = facade;
  const shell = createBuildingShell(new THREE.BoxGeometry(4, 8, 4), materials, {
    x: 0, z: 0, height: 8, interiorMaterial: brick,
    facadeFace: 4, wallInteriorMaterial: brick, wallInteriorUV: [2, 2]
  });
  const visibility = new BuildingVisibility();
  visibility.register(shell);
  const wall = shell.walls.get(4);
  const outside = new THREE.Raycaster(new THREE.Vector3(0, 3, 5), new THREE.Vector3(0, 0, -1));
  const inside = new THREE.Raycaster(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 0, 1));
  assert.ok(outside.intersectObject(wall, true)[0].object.material.color.equals(facade.color));
  assert.ok(inside.intersectObject(wall, true)[0].object.material.color.equals(brick.color));
  const uv = wall.children[1].geometry.attributes.uv;
  assert.equal(Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getY(i))), 4);
});

test('la silueta utiliza el modelo animado, solo detrás de obstáculos, sin alterar el render normal', () => {
  const overlay = new PlayerSilhouette();
  const scene = new THREE.Scene();
  const background = scene.background = new THREE.Color('#112233');
  const camera = new THREE.PerspectiveCamera();
  const light = new THREE.DirectionalLight();
  scene.add(light);
  const player = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  player.add(mesh);
  scene.add(player);
  const renderer = {
    autoClear: true, shadowMap: { autoUpdate: true }, calls: 0,
    render(s, c) {
      this.calls++;
      assert.equal(s.overrideMaterial, this.calls % 2 === 1 ? overlay.material : null);
      assert.equal(s.background, null);
      assert.equal(c.layers.mask, 2);
      assert.equal(this.autoClear, false);
      assert.equal(this.shadowMap.autoUpdate, false);
      assert.equal(light.layers.mask, 3);
    }
  };
  const material = mesh.material;
  overlay.render(renderer, scene, camera, player);
  assert.equal(renderer.calls, 2);
  assert.equal(overlay.material.depthFunc, THREE.GreaterDepth);
  assert.equal(overlay.material.depthWrite, false);
  assert.equal(mesh.material, material);
  assert.equal(mesh.layers.mask, 3);
  assert.equal(camera.layers.mask, 1);
  assert.equal(scene.overrideMaterial, null);
  assert.equal(scene.background, background);
  assert.equal(renderer.autoClear, true);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(light.layers.mask, 1);
  const loadedLater = new THREE.Mesh(new THREE.BoxGeometry(), material);
  player.add(loadedLater);
  overlay.render(renderer, scene, camera, player);
  assert.equal(loadedLater.layers.mask, 3);
});

test('la silueta usa una escena propia y estable para no recompilar los shaders del jugador', () => {
  const overlay = new PlayerSilhouette();
  const scene = new THREE.Scene();
  scene.environment = new THREE.Texture();scene.fog = new THREE.Fog('black', 1, 100);scene.environmentIntensity = .4;
  const camera = new THREE.PerspectiveCamera();
  const player = new THREE.Group();
  player.add(new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  const light = new THREE.PointLight();
  scene.add(player, light, new THREE.Mesh());
  const children = scene.children, used = [];
  const renderer = { autoClear: true, shadowMap: { autoUpdate: true }, render(s) {
    used.push(s);
    assert.notEqual(s, scene);
    assert.deepEqual(s.children, [player, light]);
    assert.equal(s.environment, scene.environment);assert.equal(s.fog, scene.fog);assert.equal(s.environmentIntensity, .4);
    assert.equal(s.background, null);assert.equal(s.matrixWorldAutoUpdate, false);
  } };
  overlay.render(renderer, scene, camera, player);
  overlay.render(renderer, scene, camera, player);
  assert.equal(used.length, 4);
  assert.ok(used.every(s => s === used[0]));
  assert.equal(scene.children, children);
  assert.equal(scene.overrideMaterial, null);
  assert.equal(player.parent, scene);
});
