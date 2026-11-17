import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FrustumCulling } from '../src/core/FrustumCulling.js';
import { renderBreakdown } from '../src/core/RenderBreakdown.js';

function fakeGame() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.set(0, 2, 0); camera.lookAt(0, 2, -10); camera.updateMatrixWorld();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 200 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.position.set(10, 50, 10);
  scene.add(sun, sun.target);

  const city = new THREE.Group();
  const block = (x, z) => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.position.set(x, 1, z);
    mesh.castShadow = true;
    group.add(mesh);
    city.add(group);
    return group;
  };
  const front = block(0, -10), behind = block(0, 40);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
  glass.position.set(1, 1, -8);
  city.add(glass);
  scene.add(city);

  // Un peatón con dos mallas con piel y un solo esqueleto, como tras shareSkeletons.
  const npcRoot = new THREE.Group();
  npcRoot.position.set(0, 0, -6);
  const bone = new THREE.Bone();
  npcRoot.add(bone);
  const skeleton = new THREE.Skeleton([bone]);
  for (let i = 0; i < 2; i++) {
    const geometry = new THREE.BoxGeometry(.5, 1.7, .3);
    const count = geometry.attributes.position.count;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(.25), 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.bind(skeleton);
    npcRoot.add(mesh);
  }
  scene.add(npcRoot);
  const fullChar = { group: npcRoot };
  scene.updateMatrixWorld(true);

  const culling = new FrustumCulling();
  culling.register(front); culling.register(behind);
  const game = {
    renderer: { instance: { info: { memory: { geometries: 7, textures: 3 }, programs: [{}, {}], render: { calls: 12, triangles: 400 } }, shadowMap: { enabled: true } }, culling },
    sceneMgr: { scene, sun }, cameraRig: { camera },
    world: { active: { group: city, npcs: [{ root: npcRoot, fullChar, lodChar: null, character: fullChar }] } }
  };
  return { game, front, behind, scene };
}

test('desglose: memoria, descarte, categorías y esqueletos, sin dejar nada oculto', () => {
  const { game, front, behind, scene } = fakeGame();
  const report = renderBreakdown(game);
  assert.deepEqual(report.memoria, { geometrias: 7, texturas: 3, programas: 2 });
  assert.deepEqual(report.ultimoCuadro, { llamadas: 12, triangulos: 400 });
  assert.equal(report.descarte.entradas, 2);
  assert.equal(report.descarte.culled, 1, 'el bloque de atrás se descarta durante el recorrido');
  assert.equal(report.escena.mallasDibujadas, 4);
  assert.deepEqual(report.escena.porCategoria, { ciudad: 2, peatones: 2 });
  assert.equal(report.escena.transparentes, 1);
  assert.deepEqual(report.conPiel, { mallas: 2, esqueletos: 1, esqueletosConSombra: 1 });
  assert.deepEqual(report.peatones, { total: 1, completosArmados: 1, viendoCompleto: 1, viendoLiviano: 0 });
  assert.ok(report.sombraSol.llamadas >= 1);
  // El descarte se restaura: la escena queda como el render la dejó.
  assert.equal(front.visible, true);
  assert.equal(behind.visible, true);
  let hidden = 0;
  scene.traverse(object => { if (!object.visible) hidden++; });
  assert.equal(hidden, 0);
});

test('desglose sin escena ni cámara: solo memoria y último cuadro', () => {
  const report = renderBreakdown({ renderer: { instance: { info: { memory: { geometries: 1, textures: 2 }, render: { calls: 3, triangles: 4 } } } } });
  assert.deepEqual(report.memoria, { geometrias: 1, texturas: 2, programas: 0 });
  assert.equal(report.descarte, null);
  assert.equal(report.escena, undefined);
});
