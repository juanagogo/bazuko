import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSkinSupport, groundMixamoClips, MixamoGroundContact } from '../src/character/mixamoGrounding.js';

function rig() {
  const root = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'mixamorigHips'; hips.position.y = 1;
  const foot = new THREE.Bone(); foot.name = 'mixamorigLeftFoot'; foot.position.y = -1;
  root.add(hips); hips.add(foot);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.2, 0, 0, .2, 0, 0, 0, .4, .2, 0, -100, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, .7, .3, 0, 0, 1, 0, 0, 0], 4));
  geometry.setIndex([0, 1, 2]); // El cuarto vértice quedó oculto por una prenda.
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  root.add(mesh); root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([hips, foot]));
  return { root, hips, foot, mesh };
}

function visibleMinimum(root, mesh) {
  root.updateMatrixWorld(true); mesh.skeleton.update();
  let low = Infinity;
  for (const index of new Set(mesh.geometry.index.array)) {
    const vertex = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    low = Math.min(low, root.worldToLocal(vertex).y);
  }
  return low;
}

test('soporte optimizado coincide con skin de Three y solo usa los vértices visibles', () => {
  const { root, hips, foot, mesh } = rig();
  root.position.set(4, 2, -7); root.scale.setScalar(1.08); root.rotation.y = .7;
  const support = createSkinSupport(root);
  assert.equal(support.vertexCount, 3);
  for (const rotation of [0, .4, -.6, 1.2]) {
    hips.rotation.z = rotation; foot.rotation.x = rotation * .5;
    assert.ok(Math.abs(support.minimumY() - visibleMinimum(root, mesh)) < 1e-8);
  }
});

test('grounding hornea pelvis sin mutar clips/rig y conserva los fotogramas elevados', () => {
  const { root, hips, mesh } = rig();
  const clip = new THREE.AnimationClip('idle', 1, [new THREE.VectorKeyframeTrack(`${hips.name}.position`, [0, .5, 1], [0, 1.5, 0, 0, .5, 0, 0, 1.5, 0])]);
  const original = clip.tracks[0].values.slice(), pose = hips.position.clone();
  const grounded = groundMixamoClips(root, { idle: clip }).idle;
  assert.deepEqual(clip.tracks[0].values, original);
  assert.ok(hips.position.equals(pose));
  assert.equal(grounded.duration, clip.duration);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(grounded).setLoop(THREE.LoopOnce, 1).play(); action.clampWhenFinished = true;
  for (let i = 0; i <= 60; i++) {
    mixer.setTime(i / 60);
    assert.ok(visibleMinimum(root, mesh) >= .004 - 1e-6, `frame ${i}`);
  }
  mixer.setTime(0);
  assert.ok(Math.abs(hips.position.y - 1.5) < 1e-7, 'no baja un fotograma de vuelo hasta el piso');
});

test('corrección tras mezcla no se acumula, se restaura y se desactiva durante vuelo', () => {
  const { root, hips, mesh } = rig();
  hips.position.y = .7;
  const original = hips.position.clone(), rootOriginal = root.position.clone();
  const contact = new MixamoGroundContact(root);
  for (let i = 0; i < 180; i++) {
    contact.restore();
    assert.ok(hips.position.equals(original));
    contact.apply(true);
    assert.ok(Math.abs(visibleMinimum(root, mesh) - .004) < 1e-7);
    assert.ok(root.position.equals(rootOriginal));
  }
  contact.apply(false);
  assert.ok(hips.position.equals(original), 'el vuelo conserva la pose original');
  hips.position.y = 2;
  contact.apply(true);
  assert.equal(hips.position.y, 2, 'no se baja una fase aérea de correr');
});
