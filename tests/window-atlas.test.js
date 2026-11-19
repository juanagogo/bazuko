import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { addBuildingDetails } from '../src/world/bogota/BuildingDetails.js';
import { createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { atlasDeVentanas, celdaDelVano, celdaVentana, columnaSinReja, COLUMNAS, FILAS, FILA, LUZ_LISA } from '../src/world/bogota/WindowAtlas.js';

test('las celdas del atlas de ventanas caben en el mapa y no se pisan', () => {
  const celdas = [];
  for (let fila = 0; fila < FILAS; fila++) for (let columna = 0; columna < COLUMNAS; columna++) celdas.push(celdaVentana(columna, fila));
  for (const [u0, v0, u1, v1] of celdas) assert.ok(u0 >= 0 && v0 >= 0 && u1 <= 1 && v1 <= 1 && u0 < u1 && v0 < v1);
  for (let a = 0; a < celdas.length; a++) for (let b = a + 1; b < celdas.length; b++) {
    const [p, q] = [celdas[a], celdas[b]];
    assert.ok(p[2] <= q[0] || q[2] <= p[0] || p[3] <= q[1] || q[3] <= p[1], `las celdas ${a} y ${b} se pisan`);
  }
  // El recorte a lo ancho se queda dentro de su celda: la cortina corrida no muestra la de al lado.
  const entera = celdaVentana(5, FILA.cortina), trozo = celdaVentana(5, FILA.cortina, .6, 1);
  assert.ok(trozo[0] > entera[0] && trozo[2] === entera[2] && trozo[1] === entera[1] && trozo[3] === entera[3]);
  const lisa = celdaVentana(7, FILA.luz);
  assert.ok(LUZ_LISA[0] > lisa[0] && LUZ_LISA[2] < lisa[2] && LUZ_LISA[1] > lisa[1] && LUZ_LISA[3] < lisa[3]);
});

test('cada vano saca su celda de su semilla: la fila dice qué es y la columna, qué reja lleva', () => {
  const columnas = new Set();
  for (let semilla = 1; semilla < 4000; semilla += 7) {
    const s = Math.imul(semilla, 2246822519) >>> 0;
    assert.deepEqual(celdaDelVano('vidrio', s), celdaDelVano('vidrio', s));
    const [columna, fila] = celdaDelVano('vidrio', s);
    assert.ok(columna >= 0 && columna < COLUMNAS && (fila === FILA.vidrio || fila === FILA.velo));
    assert.equal(celdaDelVano('luz', s)[1], FILA.luz);
    assert.equal(celdaDelVano('cortina', s)[1], FILA.cortina);
    assert.equal(celdaDelVano('luz', s)[0], columna, 'la cortina corrida y su vano comparten columna, o sea reja');
    columnas.add(columna);
  }
  assert.equal(columnas.size, COLUMNAS);
  for (let columna = 0; columna < COLUMNAS; columna++) assert.equal(columnaSinReja(columna) % 4, 3);
});

test('los vidrios, cortinas y luces de una fachada caen en sus filas del atlas', () => {
  const material = new THREE.MeshStandardMaterial();
  const shell = createBuildingShell(new THREE.BoxGeometry(12, 30, 12), Array(6).fill(material), { x: 10, z: 20, height: 30, interiorMaterial: material });
  addBuildingDetails({ shell, width: 12, depth: 12, height: 30, floors: 10, face: 4, seed: 44, neighborhood: 'comercio' });
  const filas = mesh => {
    const uv = mesh.geometry.attributes.uv, vistas = new Set();
    for (let i = 0; i < uv.count; i++) vistas.add(Math.floor((1 - uv.getY(i)) * FILAS));
    return [...vistas].sort();
  };
  const detalles = shell.walls.get(4).children.filter(m => m.userData.buildingDetails);
  assert.deepEqual(filas(detalles.find(m => m.material.userData.windowGlow)), [FILA.luz]);
  assert.deepEqual(filas(detalles.find(m => m.material.roughness === .94)), [FILA.cortina]);
  assert.ok(filas(detalles.find(m => m.material.roughness === .3)).every(fila => fila === FILA.vidrio || fila === FILA.velo));
});

test('pintar el atlas de ventanas no gasta el azar sembrado de la ciudad', async () => {
  assert.equal(atlasDeVentanas(), null, 'sin lienzo no hay atlas y los vanos quedan con su color');
  const nada = () => {}, degradado = { addColorStop: nada };
  const ctx = new Proxy({}, { get: (_, clave) => /^create.*Gradient$/.test(String(clave)) ? () => degradado : nada, set: () => true });
  const delJuego = Math.random, antes = globalThis.document;
  let gastados = 0;
  Math.random = () => { gastados++; return delJuego(); };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  try {
    const fresco = await import('../src/world/bogota/WindowAtlas.js?con-lienzo');
    const atlas = fresco.atlasDeVentanas();
    assert.ok(atlas.color.isTexture && atlas.luz.isTexture);
    assert.equal(fresco.atlasDeVentanas(), atlas, 'se pinta una sola vez');
    assert.deepEqual([atlas.color.image.width, atlas.color.image.height, atlas.luz.image.width, atlas.luz.image.height], [1024, 512, 512, 256]);
    assert.equal(gastados, 0);
  } finally { Math.random = delJuego; globalThis.document = antes; }
});
