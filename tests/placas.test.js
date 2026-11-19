import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { ATLAS_HEIGHT, ATLAS_SIZE, PRIVATE_PLATES, PUBLIC_PLATES, RECT, plateCell } from '../src/world/bogota/carAtlas.js';

const contarTiradas = crear => {
  const delJuego = Math.random;
  let veces = 0;
  Math.random = () => { veces++; return delJuego(); };
  try { return [crear(), veces]; } finally { Math.random = delJuego; }
};

// Una fila fija de vehículos de todas las clases, parqueados y de tráfico, armada en frío como la primera vez del juego.

const mallas = object => { let n = 0; object.traverse(child => { if (child.isMesh) n++; }); return n; };

// Medido antes de repartir las placas por turno: si cambia, el tráfico sembrado recibe otras tiradas, o cambian la caja que
// choca o las piezas que se dibujan.


// Los diez grupos que arma el juego: de una a tres motos.
function gruposDelJuego() {
  const motos = [];
  for (let grupo = 1; grupo <= 10; grupo++) {
    const cuantas = 1 + (grupo * 7) % 3;
    for (let i = 0; i < cuantas; i++) motos.push({ x: grupo * 20 + i * .95, z: 0, rot: .22, seed: motos.length * 3 + grupo, group: grupo });
  }
  return motos;
}


/** La placa que lleva un vehículo, leída del desplazamiento que su material aplica a la celda de placa. */
function placaDe(vehiculo) {
  const material = vehiculo.bodyVisual.children.find(mesh => mesh.name === 'Lámparas y placas').material;
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
  material.onBeforeCompile(shader);
  const { x, y } = shader.uniforms.uPlateOffset.value, punto = `${Math.round(x * ATLAS_SIZE)},${Math.round(-y * ATLAS_HEIGHT)}`;
  for (const [clase, lista] of [['publico', PUBLIC_PLATES], ['carro', PRIVATE_PLATES]]) {
    const i = lista.findIndex((_, k) => plateCell(clase, k).join() === punto);
    if (i >= 0) return lista[i].code;
  }
  return null;
}


test('hay 48 placas particulares y 16 públicas, todas distintas, inventadas y con el formato de siempre', () => {
  assert.equal(PRIVATE_PLATES.length, 48);
  assert.equal(PUBLIC_PLATES.length, 16);
  const todas = [...PUBLIC_PLATES, ...PRIVATE_PLATES];
  assert.equal(new Set(todas.map(p => p.code)).size, 64);
  for (const { code, city } of todas) {
    assert.match(code, /^[A-Z]{3} [1-9]\d\d$/, code);
    assert.ok(['BOGOTÁ D.C.', 'SOACHA', 'CHÍA', 'ENVIGADO', 'MEDELLÍN'].includes(city), `${code}: ${city}`);
  }
  // Las de siempre siguen ahí, con su ciudad.
  for (const code of ['WDD 512', 'VEP 384', 'WPD 204', 'FKB 719', 'KLY 672', 'NCX 803']) assert.ok(todas.some(p => p.code === code), code);
});

test('las placas caben en una rejilla de 16 × 4 celdas y las públicas dejan paralelas la puerta y el techo del taxi', () => {
  const celdas = [...PUBLIC_PLATES.map((_, i) => plateCell('publico', i)), ...PRIVATE_PLATES.map((_, i) => plateCell('carro', i))];
  assert.equal(new Set(celdas.map(c => c.join())).size, 64, 'una celda por placa');
  for (const [x, y] of celdas) assert.ok(x % 64 === 0 && y % 32 === 0 && x < 1024 && y < 128, `${x},${y}`);
  assert.deepEqual(RECT.plate, [0, 0, 64, 32]);
  for (let i = 0; i < PUBLIC_PLATES.length; i++) {
    const [x, y] = plateCell('publico', i);
    assert.ok(x % 128 === 0 && y % 64 === 0, 'las públicas van a paso de 128 × 64, como las calcomanías de puerta y techo');
  }
  // Lo que queda debajo de las placas no se pisa con ninguna celda.
  for (const [nombre, [rx, ry, rw, rh]] of Object.entries({ taxiEmpresa0: RECT.taxiEmpresa0, taxiEmpresa1: RECT.taxiEmpresa1, busConduzco: RECT.busConduzco })) {
    assert.ok(ry >= 128 && ry + rh <= RECT.door[1], nombre);
    for (const [ox, oy, ow, oh] of [RECT.taxiEmpresa0, RECT.taxiEmpresa1, RECT.busConduzco]) {
      if (ox === rx && oy === ry) continue;
      assert.ok(ox >= rx + rw || rx >= ox + ow || oy >= ry + rh || ry >= oy + oh, `${nombre} no se monta con otro rótulo`);
    }
  }
  assert.equal(RECT.door[1] + 2 * 64, RECT.roof[1], 'dos filas de puertas, para 16 públicas');
});
