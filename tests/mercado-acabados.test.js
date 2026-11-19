import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildMarket } from '../src/world/bogota/EastLandmarks.js';
import { marketCrate, marketRect, marketSackOnSide } from '../src/world/bogota/MarketFinish.js';
import { Batch } from '../src/world/bogota/ZoneGeometry.js';

const shopMesh = market => market.group.children.find(mesh => mesh.name === 'Puestos de mercado');

test('los seis toldos tienen paños distintos en un material sin emisión ni cambios al material del barrio', () => {
  const paint = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, {
    get: (ctx, key) => ctx[key] ?? (() => {}), set: () => true
  });
  const base = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), emissiveMap: new THREE.Texture() });
  const compile = base.onBeforeCompile, emissive = base.emissiveMap;
  const originalDocument = globalThis.document, random = Math.random;
  let market, draws = 0;
  try {
    globalThis.document = { createElement: () => ({ getContext: () => paint }) };
    Math.random = () => { draws++; return random(); };
    market = buildMarket({ detail: base });
  } finally {
    Math.random = random;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }

  const { geometry, material, userData } = shopMesh(market);
  assert.equal(draws, 12);
  assert.ok(userData.visualOnly && material !== base && material.map?.isCanvasTexture);
  assert.equal(base.onBeforeCompile, compile);
  assert.equal(base.emissiveMap, emissive);
  assert.equal(material.emissiveMap, null);
  assert.equal(material.emissive.getHex(), 0);
  const finishes = [marketRect('redStripe', 0), marketRect('greenTarp'), marketRect('blueStripe'),
    marketRect('blueTarp'), marketRect('orangeTarp'), marketRect('redStripe', 1)];
  const { position, uv } = geometry.attributes;
  for (const [{ x, z }, [u0, v0, u1, v1]] of market.colliders.map((box, i) => [box, finishes[i]])) {
    let panel = 0, expected = 0;
    for (let i = 0; i < position.count; i++) {
      const away = Math.abs(position.getZ(i) - z);
      if (position.getY(i) < 2.46 || Math.abs(position.getX(i) - x) > 2.11 || away < .2 || away > 1.45) continue;
      panel++;
      const u = uv.getX(i), v = uv.getY(i);
      if (u >= u0 - 1e-6 && u <= u1 + 1e-6 && v >= v0 - 1e-6 && v <= v1 + 1e-6) expected++;
    }
    assert.ok(panel > 45 && expected / panel > .6, `falta el paño principal del puesto en ${x}, ${z}`);
  }
});

function makePiece(add) {
  const batch = new Batch(), material = new THREE.MeshStandardMaterial(), group = new THREE.Group();
  add(batch, material);
  batch.finish(group);
  return group.children[0];
}

test('entre los listones queda aire y la canastilla moldeada incorpora nervios sin tapar el asa', () => {
  const crate = plastic => makePiece((batch, material) => {
    marketCrate(batch.frame(4), material, 0, 0, 0, .7, .24, .38, 0, 'woodDark', plastic);
  });
  const wood = crate(null), plastic = crate('doorBlue');
  const hit = (mesh, origin, direction) => new THREE.Raycaster(
    new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(mesh)[0];
  for (const mesh of [wood, plastic]) {
    assert.ok(hit(mesh, [.08, .035, .7], [0, 0, -1]), 'debe haber un larguero inferior');
    assert.equal(hit(mesh, [.08, .125, .7], [0, 0, -1]), undefined, 'la ranura debe dejar pasar el rayo');
    assert.ok(Math.abs(hit(mesh, [0, .4, 0], [0, -1, 0]).point.y - .21) < 1e-6);
  }
  assert.equal(hit(wood, [0, .125, .7], [0, 0, -1]), undefined);
  assert.ok(hit(plastic, [0, .125, .7], [0, 0, -1]), 'nervio del centro de canastilla');
  assert.ok(hit(plastic, [.8, .194, 0], [-1, 0, 0]), 'puente del asa');
  assert.equal(hit(plastic, [.8, .167, 0], [-1, 0, 0]), undefined, 'luz bajo el asa');
});

test('el costal recostado tiene base apoyada, superficie suave y una boca de menor altura', () => {
  const piece = makePiece((batch, material) => marketSackOnSide(batch, material, 0, .12, 0, .8, .37, .48, 0, 0, 'burlap'));
  const { boundingBox, attributes } = piece.geometry;
  const { normal, position } = attributes, contact = new Set();
  let mouth = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i);
    if (Math.abs(y - .12) < 1e-6) contact.add(x);
    if (x > .347) mouth = Math.max(mouth, y);
    assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(normal, i).lengthSq() - 1) < 1e-6);
  }
  assert.ok(Math.abs(boundingBox.min.y - .12) < 1e-6 && contact.size >= 2);
  assert.ok(boundingBox.max.y > .48 && mouth > .2 && mouth < .28);
});
