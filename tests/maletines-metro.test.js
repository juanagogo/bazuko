import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildMetroBogota } from '../src/world/bogota/MetroBogota.js';

// Lienzo falso: acepta cualquier trazo y no pinta nada.
const degradado = { addColorStop() {} };
const ctx = new Proxy({}, { get: (_, clave) => /^create(Linear|Radial)Gradient$/.test(clave) ? () => degradado : () => {}, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const maletines = grupo => grupo.children.filter(o => o.isMesh && /^Maletin/.test(o.material.name));

// Medido sobre c100418: x, y, z y si es naranja (1) o blanco (0).
const SITIOS = [[71.6,0.38,58,0],[71.6,0.38,60.4,0],[71.6,0.38,62.8,1],[71.6,0.38,65.2,1],[71.6,0.38,67.6,0],[71.6,0.38,70,0],[71.6,0.38,88,0],[71.6,0.38,90.4,0],[71.6,0.38,92.8,1],[71.6,0.38,95.2,1],[71.6,0.38,97.6,0],[71.6,0.38,100,0],[71.6,0.38,118,0],[71.6,0.38,120.4,0],[71.6,0.38,122.8,1],[71.6,0.38,125.2,1],[71.6,0.38,127.6,0],[71.6,0.38,130,0],[71.6,0.38,153,0],[71.6,0.38,155.4,0],[71.6,0.38,157.8,1],[71.6,0.38,160.2,1],[71.6,0.38,162.6,0],[71.6,0.38,165,0],[71.6,0.38,193,0],[71.6,0.38,195.4,0],[71.6,0.38,197.8,1],[71.6,0.38,200.2,1],[71.6,0.38,202.6,0],[71.6,0.38,205,0]];
// Se conserva la huella de paso. La pila suelta en Z136 se acorta y la de Z160 sale de la Torre.
const PILAS = [[73.9,0,14.9,76.1,12.5,17.1],[73.9,0,38.9,76.1,12.5,41.1],[73.9,0,62.9,76.1,12.5,65.1],[73.9,0,86.9,76.1,12.5,89.1],[73.9,0,110.9,76.1,12.5,113.1],[73.9,0,134.9,76.1,3.43,137.1],[73.9,0,182.9,76.1,12.5,185.1],[73.9,0,206.9,76.1,12.5,209.1],[73.9,0,230.9,76.1,12.5,233.1],[73.9,0,254.9,76.1,12.5,257.1],[73.9,0,278.9,76.1,12.5,281.1],[73.9,0,302.9,76.1,12.5,305.1]];

test('los maletines del Metro siguen siendo los mismos, en el mismo sitio, sin choque y sin gastar más azar', () => {
  const real = Math.random; let llamadas = 0;
  Math.random = () => { llamadas++; return real(); };
  let grupo;
  try { grupo = buildMetroBogota(); } finally { Math.random = real; }
  assert.equal(llamadas, 736, 'el Metro gasta el mismo azar sembrado que antes');

  const lista = maletines(grupo);
  assert.equal(lista.length, SITIOS.length);
  lista.forEach((m, i) => {
    const [x, y, z, naranja] = SITIOS[i];
    assert.deepEqual([m.position.x, m.position.y, m.position.z], [x, y, z], `maletín ${i}`);
    assert.equal(m.material.name, naranja ? 'MaletinNaranja' : 'MaletinBlanco', `maletín ${i}`);
  });

  let mallas = 0;
  grupo.traverse(o => { if (o.isMesh && !o.userData.visualOnly) mallas++; });
  assert.equal(mallas, 99, 'la obra y la segunda cabina comparten la geometría base y añaden lotes propios');

  const choques = grupo.userData.colliders;
  assert.deepEqual(choques.map(c => [...c.box.min.toArray(), ...c.box.max.toArray()]), PILAS);
  assert.ok(choques.every(c => !lista.includes(c.mesh)), 'ningún maletín tiene caja de choque');
});

test('cada maletín es una barrera de plástico de 78 triángulos con las mismas piezas, dentro de la caja de antes', () => {
  const lista = maletines(buildMetroBogota());
  const [primero] = lista;
  const g = primero.geometry;
  assert.equal(g.index.count / 3, 78);
  for (const m of lista) for (const nombre of ['position', 'normal', 'uv']) assert.equal(m.geometry.attributes[nombre], g.attributes[nombre]);
  assert.ok(lista.every(m => m.geometry.index === g.index));
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  [min.x, max.x, min.z, max.z].forEach((v, i) => assert.ok(Math.abs(v - [-.25, .25, -.6, .6][i]) < 1e-6, 'misma huella en planta'));
  assert.ok(Math.abs(min.y + .375) < 1e-6 && Math.abs(max.y - .375) < 1e-6, 'misma altura y apoyado donde se apoyaba la caja');
  // Cintura angosta y hombro: la barrera no es una caja.
  const p = g.attributes.position, ancho = alto => {
    let w = 0;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) + .375 - alto) < 1e-6 && Math.abs(p.getZ(i)) < .55) w = Math.max(w, Math.abs(p.getX(i)) * 2);
    return w;
  };
  assert.ok(Math.abs(ancho(0) - .5) < 1e-6 && Math.abs(ancho(.3) - .3) < 1e-6 && ancho(.6) > ancho(.3));
  // Cada cara mira hacia afuera y las normales son suaves (de largo uno).
  const n = g.attributes.normal, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cara = new THREE.Vector3(), suave = new THREE.Vector3();
  for (let t = 0; t < g.index.count; t += 3) {
    const [i, j, k] = [0, 1, 2].map(o => g.index.getX(t + o));
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, j); c.fromBufferAttribute(p, k);
    cara.subVectors(b, a).cross(c.sub(a));
    if (cara.lengthSq() < 1e-12) continue;
    suave.set(0, 0, 0);
    for (const v of [i, j, k]) suave.add(new THREE.Vector3().fromBufferAttribute(n, v));
    assert.ok(cara.dot(suave) > 0, `triángulo ${t / 3} vuelto hacia adentro`);
  }
  for (let i = 0; i < n.count; i++) assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(n, i).length() - 1) < 1e-6);
});

test('los maletines siguen con sus dos materiales Lambert, pintados en un solo lienzo pequeño, cada uno en su mitad', () => {
  const lista = maletines(buildMetroBogota());
  const naranja = lista.find(m => m.material.name === 'MaletinNaranja').material;
  const blanco = lista.find(m => m.material.name === 'MaletinBlanco').material;
  for (const material of [naranja, blanco]) {
    assert.ok(material.isMeshLambertMaterial && material.map?.isTexture, material.name);
    assert.equal(material.emissive.getHex(), 0, 'de noche no brillan');
  }
  assert.equal(naranja.map.source, blanco.map.source, 'una sola imagen');
  const { width, height } = naranja.map.image;
  assert.ok(width <= 256 && height <= 256);
  assert.deepEqual([naranja.map.repeat.y, blanco.map.repeat.y, naranja.map.offset.y, blanco.map.offset.y], [.5, .5, .5, 0]);
  assert.equal(maletines(buildMetroBogota())[0].material.map, lista[0].material.map, 'el lienzo se pinta una vez');
});

test('uno de cada cuatro maletines, más o menos, queda corrido entre 10 y 20° sobre su eje, siempre los mismos', () => {
  const giros = maletines(buildMetroBogota()).map(m => {
    assert.equal(m.rotation.x, 0); assert.equal(m.rotation.z, 0);
    return Math.round(m.rotation.y * 180 / Math.PI);
  });
  assert.deepEqual(giros, [12,0,-10,0,0,0,0,0,0,-17,0,0,0,-20,-17,0,0,0,0,0,0,0,0,0,0,0,0,0,-14,13]);
  assert.deepEqual(maletines(buildMetroBogota()).map(m => m.rotation.y), maletines(buildMetroBogota()).map(m => m.rotation.y));
});
