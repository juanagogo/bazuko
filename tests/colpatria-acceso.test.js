import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildColpatria } from '../src/world/bogota/Colpatria.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

const armar = () => {
  const textos = [];
  const torre = buildColpatria({ createSign: opciones => { const map = new THREE.Texture(); textos.push({ ...opciones, map }); return map; } });
  torre.updateMatrixWorld(true);
  const letreros = torre.children.filter(o => o.geometry?.type === 'PlaneGeometry');
  return { torre, textos, letreros };
};

test('armar la torre con sus letreros gasta el mismo azar, no estrena mallas ni materiales y no registra choques', () => {
  const real = Math.random; let llamadas = 0;
  Math.random = () => { llamadas++; return real(); };
  let torre;
  try { ({ torre } = armar()); } finally { Math.random = real; }
  assert.equal(llamadas, 2612);
  let mallas = 0; const materiales = new Set();
  torre.traverse(o => { if (o.isMesh) { mallas++; materiales.add(o.material); } });
  assert.deepEqual([mallas, materiales.size], [318, 10]);
  assert.equal(torre.userData.colliders, undefined);
});

test('ningún letrero queda detrás de una costilla, columna, faja o marquesina', () => {
  const { torre, letreros } = armar();
  assert.equal(letreros.length, 3);
  const detras = [];
  for (const letrero of letreros) {
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(letrero.getWorldQuaternion(new THREE.Quaternion()));
    const eje = Math.abs(normal.x) > .5 ? 'x' : 'z', otro = eje === 'x' ? 'z' : 'x', signo = Math.sign(normal[eje]);
    const plano = new THREE.Box3().setFromObject(letrero), frente = letrero.getWorldPosition(new THREE.Vector3())[eje] * signo;
    torre.traverse(pieza => {
      if (!pieza.isMesh || letreros.includes(pieza)) return;
      const caja = new THREE.Box3().setFromObject(pieza);
      const cruza = a => Math.min(caja.max[a], plano.max[a]) - Math.max(caja.min[a], plano.min[a]) > .01;
      if (!cruza('y') || !cruza(otro)) return;
      const suFrente = signo > 0 ? caja.max[eje] : -caja.min[eje];
      if (suFrente > frente - .005) detras.push(`${letrero.material.map?.name || letrero.position.toArray().join(',')}: ${pieza.name || pieza.material.color?.getHexString()}`);
    });
  }
  assert.deepEqual(detras, []);
});

test('los letreros reciben la luz de la escena y de noche se prenden con las franjas, con sus textos de siempre', () => {
  const { torre, textos, letreros } = armar();
  assert.deepEqual(textos.map(t => [t.title, t.sub, t.bg, t.fg, t.border, t.w, t.h]), [
    ['TORRE COLPATRIA', 'ACCESO PRINCIPAL', '#a9aaa5', '#273137', false, 768, 192],
    ['TORRE COLPATRIA', 'EDIFICIO ANEXO', '#a9aaa5', '#273137', false, 768, 192],
    ['LOCALES', 'CAFÉ · SERVICIOS', '#a9aaa5', '#273137', false, 768, 192]
  ]);
  assert.deepEqual(letreros.map(l => l.geometry.parameters.width), [8, 7, 6]);
  const franjas = torre.userData.lightMaterials;
  for (const [i, letrero] of letreros.entries()) {
    const m = letrero.material;
    assert.ok(m.isMeshStandardMaterial, 'el letrero recibe luz');
    assert.equal(m.map, textos[i].map);
    for (const f of franjas) f.emissiveIntensity = 1.8;
    m.onBeforeRender?.();
    assert.ok(m.emissiveIntensity > 0 && m.emissiveIntensity < 1, `de noche se prende tenue: ${m.emissiveIntensity}`);
    for (const f of franjas) f.emissiveIntensity = .05;
    m.onBeforeRender?.();
    assert.equal(m.emissiveIntensity, 0);
  }
});

test('cada letrero da a la calle: un metro por delante no hay casa ni muro', () => {
  const { letreros } = armar();
  const ciudad = new Bogota(); ciudad.map = ciudad._layout();
  const choques = new CollisionSystem(); ciudad._buildCollisions(ciudad.map, choques);
  for (const letrero of letreros) {
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(letrero.quaternion);
    const delante = letrero.position.clone().addScaledVector(normal, 1);
    assert.ok(!choques.colliders.some(({ box }) => box.containsPoint(delante)), `${letrero.position.toArray()} mira a un sólido`);
  }
});

test('el acceso se arma con las cajas de siempre: marquesina, vestíbulo de vidrio entre las costillas y dinteles de puerta', () => {
  const { torre } = armar();
  const caja = o => new THREE.Box3().setFromObject(o);
  const marquesina = caja(torre.getObjectByName('Marquesina de acceso')).getSize(new THREE.Vector3());
  assert.deepEqual(marquesina.toArray().map(v => +v.toFixed(2)), [8, .3, 1.6]);
  const vestibulo = torre.getObjectByName('Vestíbulo de acceso'), v = caja(vestibulo);
  assert.equal(vestibulo.material, torre.getObjectByName('Cuerpo de la torre').material);
  // Detrás del frente de las costillas (Z 154,76) y delante de la fachada (Z 155), del piso al primer travesaño.
  assert.ok(v.min.z > 154.76 && v.max.z < 155 && Math.abs(v.min.y) < 1e-6 && v.max.y < 4.92 && v.min.x < 77 && v.max.x > 85, JSON.stringify(v));
  const dinteles = torre.children.filter(o => o.name === 'Dintel de puerta').map(caja);
  assert.equal(dinteles.length, 2);
  for (const d of dinteles) assert.ok(d.min.y > 2 && d.max.y < 3 && d.min.z < v.min.z && d.max.x - d.min.x > 2);
});
