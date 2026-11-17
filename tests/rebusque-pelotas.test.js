// Las pelotas de los malabares: tres, que salen de una mano, suben y caen en la otra con el reloj del show. Tres mallas
// propias sin sombras, nada sin show, ocultas al terminar y liberadas en dispose.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { RebusqueVisual } from '../src/systems/rebusque/RebusqueVisual.js';
import { BEAT, VUELO, ALTURA } from '../src/systems/rebusque/ritmo.js';

/** Un personaje con huesos de mano Mixamo (y su dedo medio) frente al +Z, en el origen. */
function personaje() {
  const group = new THREE.Group();
  const inst = new THREE.Group();
  group.add(inst);
  for (const [lado, x] of [['Right', -.25], ['Left', .25]]) {
    const mano = new THREE.Bone(); mano.name = `mixamorig${lado}Hand`; mano.position.set(x, 1.2, .3);
    const dedo = new THREE.Bone(); dedo.name = `mixamorig${lado}HandMiddle1`; dedo.position.set(0, 0, .08);
    mano.add(dedo); inst.add(mano);
  }
  const root = new THREE.Group(); root.add(group);
  root.updateMatrixWorld(true);
  return { group, root, inst };
}

/** Las mallas que el visual cuelga en la escena. */
const mallasEn = scene => { let n = 0; scene.traverse(o => { if (o.isMesh) n++; }); return n; };

function montar() {
  const scene = new THREE.Scene();
  const ch = personaje();
  scene.add(ch.root);
  const game = { player: { position: new THREE.Vector3(), root: ch.root, character: { group: ch.group }, modelScale: 1 }, rebusque: { trabajo: null } };
  return { scene, game, ch, visual: new RebusqueVisual(scene, game) };
}

test('sin show no hay ninguna malla', () => {
  const { visual, scene } = montar();
  for (let i = 0; i < 10; i++) visual.update();
  assert.equal(mallasEn(scene), 0);
  assert.equal(visual.group, null);
  assert.equal(scene.getObjectByName('Rebusque: pelotas'), undefined);
});

test('tres pelotas que salen de una mano, suben y caen en la otra; al terminar el show se ocultan', () => {
  const { visual, game, scene } = montar();
  const trabajo = { tiempo: 0 };
  game.rebusque.trabajo = trabajo;
  visual.update();
  // Antes del primer lanzamiento la tercera espera encima de la primera, no en el mismo punto.
  assert.ok(visual._bolas[0].mesh.position.distanceTo(visual._bolas[2].mesh.position) > .05);
  let alto = 0;
  for (let t = 0; t < 4.6; t += 1 / 60) {
    trabajo.tiempo = t;
    visual.update();
    for (const b of visual._bolas) {
      assert.ok(b.mesh.visible);
      const p = b.mesh.position;
      assert.ok(Math.hypot(p.x, p.z - .34) < .5, `pelota cerca de las manos: ${p.toArray()}`);
      assert.ok(p.y >= 1.15 && p.y < 1.25 + ALTURA + .1, `altura ${p.y}`);
      if (b.k >= 0 && t - b.k * BEAT < VUELO) alto = Math.max(alto, p.y);
    }
    if (t > 4 * BEAT) assert.equal(new Set(visual._bolas.map(b => b.k)).size, 3, 'cada pelota en su lanzamiento');
  }
  assert.ok(alto > 1.2 + ALTURA * .9, `arco ${alto}`);
  assert.equal(mallasEn(scene), 3);
  assert.ok(visual.group.children.every(m => !m.castShadow && !m.receiveShadow));
  game.rebusque.trabajo = null;
  visual.update();
  assert.equal(visual.group.visible, false, 'sin show no se ven');
});

test('las manos se vuelven a buscar si el modelo se reconstruye; sin huesos, delante del pecho; dispose lo libera todo', () => {
  const { visual, game, ch, scene } = montar();
  game.rebusque.trabajo = { tiempo: 0 };
  visual.update();
  const vieja = visual._manos[0];
  assert.equal(vieja.name, 'mixamorigRightHand');
  ch.group.remove(ch.inst);
  const nuevo = personaje().inst;
  ch.group.add(nuevo);
  visual.update();
  assert.notEqual(visual._manos[0], vieja);
  assert.ok(nuevo.children.includes(visual._manos[0]));
  // El muñeco procedural no tiene huesos de mano: las pelotas salen de delante del pecho.
  ch.group.remove(nuevo);
  visual.update();
  assert.equal(visual._manos[0], null);
  assert.ok(visual._bolas.every(b => b.mesh.position.z > .2 && b.mesh.position.y > .9));
  const liberados = [];
  for (const b of visual._bolas) {
    const { geometry, material } = b.mesh;
    geometry.addEventListener('dispose', () => liberados.push(geometry));
    material.addEventListener('dispose', () => liberados.push(material));
  }
  visual.dispose();
  assert.equal(new Set(liberados).size, 4, 'la geometría compartida y los tres materiales');
  assert.equal(mallasEn(scene), 0);
  assert.equal(scene.getObjectByName('Rebusque: pelotas'), undefined);
});
