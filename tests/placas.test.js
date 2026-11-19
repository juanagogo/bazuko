import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeVehicle } from '../src/world/bogota/vehicles.js';
import { LAMP } from '../src/world/bogota/carModels.js';
import * as THREE from 'three';
import { ATLAS_HEIGHT, ATLAS_SIZE, PRIVATE_PLATES, PUBLIC_PLATES, RECT, plateCell } from '../src/world/bogota/carAtlas.js';

const contarTiradas = crear => {
  const delJuego = Math.random;
  let veces = 0;
  Math.random = () => { veces++; return delJuego(); };
  try { return [crear(), veces]; } finally { Math.random = delJuego; }
};

// Una fila fija de vehículos de todas las clases, parqueados y de tráfico, armada en frío como la primera vez del juego.
const FILA = Array.from({ length: 60 }, (_, i) => ({
  kind: ['carro', 'taxi', 'carro', 'buseta', 'carro', 'police', 'carro', 'taxi', 'carro', 'carro'][i % 10],
  seed: i * 53 + (i % 7), parked: i % 4 === 1, model: i % 13 === 6 ? 'furgon' : i % 17 === 9 ? 'buseta' : null,
}));

const mallas = object => { let n = 0; object.traverse(child => { if (child.isMesh) n++; }); return n; };

// Medido antes de repartir las placas por turno: si cambia, el tráfico sembrado recibe otras tiradas, o cambian la caja que
// choca o las piezas que se dibujan.
const TIRADAS = [
  272, 64, 236, 248, 260, 200, 224, 92, 96, 52, 104, 108, 96, 28, 280, 92, 248, 48, 96, 96, 96, 28, 96, 96, 96, 72, 92, 92, 96, 52,
  92, 92, 92, 28, 96, 92, 96, 28, 240, 92, 96, 28, 96, 92, 96, 72, 92, 92, 92, 28, 96, 92, 96, 28, 92, 92, 92, 28, 92, 92,
];
const CAJAS = [
  'citadino 3.640 1.600 1.520', 'citadino 3.640 1.600 1.520', 'sedanDeportivo 4.460 1.790 1.440', 'buseta 7.600 2.300 3.000',
  'suv 4.340 1.820 1.680', 'sedanPopular 4.350 1.730 1.520', 'furgon 4.050 1.600 1.900', 'citadino 3.640 1.600 1.520',
  'citadino 3.640 1.600 1.520', 'buseta 7.600 2.300 3.000', 'sedanPopular 4.350 1.730 1.520', 'sedanPopular 4.350 1.730 1.520',
  'suv 4.340 1.820 1.680', 'buseta 7.600 2.300 3.000', 'pickup 5.300 1.850 1.800', 'sedanPopular 4.350 1.730 1.520',
  'cajaSetentera 3.670 1.510 1.550', 'sedanPopular 4.350 1.730 1.520', 'sedanPopular 4.350 1.730 1.520', 'furgon 4.050 1.600 1.900',
  'citadino 3.640 1.600 1.520', 'citadino 3.640 1.600 1.520', 'sedanDeportivo 4.460 1.790 1.440', 'buseta 7.600 2.300 3.000',
  'pickup 5.300 1.850 1.800', 'suv 4.340 1.820 1.680', 'buseta 7.600 2.300 3.000', 'citadino 3.640 1.600 1.520',
  'sedanPopular 4.350 1.730 1.520', 'citadino 3.640 1.600 1.520', 'citadino 3.640 1.600 1.520', 'sedanPopular 4.350 1.730 1.520',
  'furgon 4.050 1.600 1.900', 'buseta 7.600 2.300 3.000', 'citadino 3.640 1.600 1.520', 'suv 4.340 1.820 1.680',
  'sedanDeportivo 4.460 1.790 1.440', 'citadino 3.640 1.600 1.520', 'hatchPopular 4.060 1.730 1.550', 'sedanDeportivo 4.460 1.790 1.440',
  'sedanPopular 4.350 1.730 1.520', 'citadino 3.640 1.600 1.520', 'suv 4.340 1.820 1.680', 'buseta 7.600 2.300 3.000',
  'suv 4.340 1.820 1.680', 'furgon 4.050 1.600 1.900', 'sedanPopular 4.350 1.730 1.520', 'citadino 3.640 1.600 1.520',
  'suv 4.340 1.820 1.680', 'citadino 3.640 1.600 1.520', 'suv 4.340 1.820 1.680', 'citadino 3.640 1.600 1.520',
  'cajaSetentera 3.670 1.510 1.550', 'buseta 7.600 2.300 3.000', 'suv 4.340 1.820 1.680', 'suv 4.340 1.820 1.680',
  'suv 4.340 1.820 1.680', 'sedanPopular 4.350 1.730 1.520', 'furgon 4.050 1.600 1.900', 'citadino 3.640 1.600 1.520',
];
// Vértices de la malla que reúne ópticas, placas y rótulos. Incluye el capacete del taxi y el techo iluminado de la buseta.
const MALLAS = [
  '12/364', '5/483', '12/232', '12/322', '12/212', '5/306', '12/266', '12/483', '12/364', '5/322', '12/214', '12/333', '12/212', '5/322', '12/244',
  '12/306', '12/140', '5/333', '12/214', '12/266', '12/364', '5/483', '12/232', '12/322', '12/244', '5/304', '12/322', '12/483', '12/214', '5/364',
  '12/364', '12/333', '12/266', '5/322', '12/364', '12/304', '12/232', '5/483', '12/188', '12/232', '12/214', '5/483', '12/212', '12/322', '12/212',
  '5/358', '12/214', '12/483', '12/212', '5/364', '12/212', '12/483', '12/140', '5/322', '12/212', '12/304', '12/212', '5/333', '12/266', '12/364',
];

test('armar la flota gasta el mismo azar y deja las mismas cajas y piezas', () => {
  const tiradas = [], cajas = [], piezas = [];
  for (const { kind, seed, parked, model } of FILA) {
    const [v, veces] = contarTiradas(() => makeVehicle(kind, seed, { parked, model, beams: !parked }));
    tiradas.push(veces);
    cajas.push(`${v.model} ${v.length.toFixed(3)} ${v.width.toFixed(3)} ${v.height.toFixed(3)}`);
    const lampara = v.bodyVisual.children.find(mesh => mesh.name === 'Lámparas y placas');
    const { position, lamp } = lampara.geometry.attributes;
    piezas.push(`${mallas(v.group)}/${position.count}`);
    if (v.model === 'buseta') {
      const verticesDePlaca = lamp.array.filter(canal => canal === LAMP.PLATE).length;
      assert.equal(verticesDePlaca, 28, `buseta ${seed}: placas y rótulos que usan su celda`);
    }
    v.dispose();
  }
  assert.deepEqual(tiradas, TIRADAS);
  assert.deepEqual(cajas, CAJAS);
  assert.deepEqual(piezas, MALLAS);
});

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

const armar = (kind, seed, opciones = {}) => {
  const v = makeVehicle(kind, seed, { beams: false, ...opciones }), placa = placaDe(v);
  v.dispose();
  return placa;
};

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

test('ninguna placa se repite entre los vehículos de un arranque: 44 particulares, la camioneta de la limpieza y 13 públicos', () => {
  const particulares = [], publicos = [];
  const publicosKinds = ['taxi', 'taxi', 'buseta', 'taxi', 'police', 'taxi', 'buseta', 'taxi', 'police', 'taxi', 'taxi', 'taxi', 'taxi'];
  for (let i = 0; i < 44; i++) {
    particulares.push(armar('carro', 1000 + i * 31, { parked: i < 5 }));
    if (i % 4 === 3 && publicosKinds.length) publicos.push(armar(publicosKinds.pop(), 2000 + i * 17));
    if (i === 20) particulares.push(armar('carro', 0, { model: 'camionetaNegra', ownMaterials: true }));
  }
  while (publicosKinds.length) publicos.push(armar(publicosKinds.pop(), 3000 + publicosKinds.length));
  assert.equal(particulares.length, 45);
  assert.equal(publicos.length, 13);
  assert.ok(particulares.every(Boolean) && publicos.every(Boolean), 'cada vehículo apunta a una celda con placa');
  assert.equal(new Set(particulares).size, particulares.length, 'particulares sin placa repetida');
  assert.equal(new Set(publicos).size, publicos.length, 'públicos sin placa repetida');
  assert.ok(particulares.every(code => PRIVATE_PLATES.some(p => p.code === code)), 'los particulares llevan placa amarilla');
  assert.ok(publicos.every(code => PUBLIC_PLATES.some(p => p.code === code)), 'taxis, busetas y patrullas llevan placa blanca');
  // Una buseta armada como particular sigue llevando placa de servicio público.
  const deBuseta = armar('carro', 5, { model: 'buseta' });
  assert.ok(PUBLIC_PLATES.some(p => p.code === deBuseta));
});

test('con más vehículos que placas la vuelta empieza de nuevo, sin dos iguales seguidas, y no gasta azar', () => {
  armar('carro', 77, { model: 'citadino', parked: true });
  const [placas, veces] = contarTiradas(() => Array.from({ length: 100 }, () => armar('carro', 77, { model: 'citadino', parked: true })));
  for (let i = 1; i < placas.length; i++) assert.notEqual(placas[i], placas[i - 1], `seguidas ${i}`);
  assert.equal(new Set(placas.slice(0, 48)).size, 48);
  for (let i = 48; i < placas.length; i++) assert.equal(placas[i], placas[i - 48], 'la vuelta repite el mismo orden');
  // La misma semilla y el mismo modelo, cien veces: lo único que cambia es la placa.
  const [, unaVez] = contarTiradas(() => armar('carro', 77, { model: 'citadino', parked: true }));
  assert.equal(veces, unaVez * 100, 'cada vehículo gasta lo mismo: la placa no tira del azar');
  const publicos = Array.from({ length: 40 }, (_, i) => armar(i % 2 ? 'taxi' : 'buseta', 9));
  for (let i = 1; i < publicos.length; i++) assert.notEqual(publicos[i], publicos[i - 1]);
  for (let i = 16; i < publicos.length; i++) assert.equal(publicos[i], publicos[i - 16]);
});

