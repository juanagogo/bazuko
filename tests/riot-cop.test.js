import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';

// Esqueleto mínimo de pie: caderas, cabeza y las dos manos, con los nombres del cuerpo real.
function fakeCharacter() {
  const group = new THREE.Group();
  const bone = (name, x, y, z, parent) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; };
  const hips = bone('mixamorigHips', 0, 1, 0, group);
  bone('mixamorigHead', 0, .7, 0, hips);
  bone('mixamorigLeftHand', .25, -.1, .05, hips);
  bone('mixamorigRightHand', -.25, -.1, .05, hips);
  return { group, update() {}, snapPose() {}, dispose() {} };
}
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => fakeCharacter(), loadCatalog: async () => ({}), normalizeReal: (_catalog, look) => look, REALISTIC_SCALE: 1
} });
const { riotCopFigure } = await import('../src/entities/RiotCop.js');

const props = (figure) => {
  const found = [];
  figure.group.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) found.push(o); });
  return found;
};
const hasBoneAncestor = (o) => { for (let p = o.parent; p; p = p.parent) if (p.isBone) return true; return false; };

test('casco, visor, escudo y bolillo cuelgan de huesos y no del grupo', async () => {
  const figure = await riotCopFigure();
  const found = props(figure);
  assert.equal(found.length, 4);
  for (const mesh of found) assert.ok(hasBoneAncestor(mesh), 'una pieza quedó suelta en el grupo');
});

test('si el antimotín cae, el equipo cae con él', async () => {
  const figure = await riotCopFigure();
  figure.group.updateMatrixWorld(true);
  const before = props(figure).map(m => m.getWorldPosition(new THREE.Vector3()));
  const hips = figure.group.getObjectByName('mixamorigHips');
  hips.rotation.x = -Math.PI / 2;
  hips.position.set(0, .2, 0);
  figure.group.updateMatrixWorld(true);
  props(figure).forEach((m, i) => assert.ok(m.getWorldPosition(new THREE.Vector3()).distanceTo(before[i]) > .5, 'la pieza se quedó en el aire'));
});

test('el escudo es policarbonato translúcido y está en la mano izquierda', async () => {
  const figure = await riotCopFigure();
  figure.group.updateMatrixWorld(true);
  const shield = props(figure).find(m => m.geometry.parameters?.height === 1.1);
  assert.ok(shield.material.transparent && shield.material.opacity < 1);
  const hand = figure.group.getObjectByName('mixamorigLeftHand');
  assert.ok(shield.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3())) < .7);
  assert.equal(shield.parent, hand);
});

test('las piezas comparten geometría y material entre antimotines', async () => {
  const [a, b] = [await riotCopFigure(), await riotCopFigure()];
  props(a).forEach((m, i) => { const n = props(b)[i]; assert.equal(m.geometry, n.geometry); assert.equal(m.material, n.material); });
});
