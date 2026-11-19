import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeVehicle } from '../src/world/bogota/vehicles.js';
import { LAMP } from '../src/world/bogota/carModels.js';
import { PLACAS_MOTO, makeParkedMotos } from '../src/world/bogota/motos.js';
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

// Los diez grupos que arma el juego: de una a tres motos.
function gruposDelJuego() {
  const motos = [];
  for (let grupo = 1; grupo <= 10; grupo++) {
    const cuantas = 1 + (grupo * 7) % 3;
    for (let i = 0; i < cuantas; i++) motos.push({ x: grupo * 20 + i * .95, z: 0, rot: .22, seed: motos.length * 3 + grupo, group: grupo });
  }
  return motos;
}

test('las motos siguen con un lote por grupo, la misma geometría y el mismo azar', () => {
  const [root, veces] = contarTiradas(() => makeParkedMotos(gruposDelJuego()));
  assert.equal(veces, 204, 'la primera vez arma el modelo y el material');
  assert.equal(root.children.length, 10);
  assert.deepEqual(root.children.map(lote => lote.count), [2, 3, 1, 2, 3, 1, 2, 3, 1, 2]);
  assert.equal(mallas(root), 15, 'diez lotes y cinco de cajones: ningún pedido de dibujo nuevo');
  const [primero] = root.children;
  for (const lote of root.children) {
    assert.equal(lote.geometry, primero.geometry, 'geometría compartida');
    assert.equal(lote.material, primero.material, 'material compartido');
  }
  root.dispose();
});

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

test('las motos llevan placas distintas: cada una de un lote con la suya y en la ciudad dan la vuelta', () => {
  assert.ok(PLACAS_MOTO.length >= 6);
  assert.equal(new Set(PLACAS_MOTO).size, PLACAS_MOTO.length);
  for (const placa of PLACAS_MOTO) assert.match(placa, /^[A-Z]{3} \d\d[A-Z]$/, placa);
  const root = makeParkedMotos(gruposDelJuego());
  const placaDeMoto = (lote, i) => Math.floor((lote.instanceColor.array[i * 3] * 4096 % 1) * PLACAS_MOTO.length);
  const vistas = [];
  for (const lote of root.children) {
    const placas = Array.from({ length: lote.count }, (_, i) => placaDeMoto(lote, i));
    assert.equal(new Set(placas).size, placas.length, 'en una fila no se repite la placa');
    vistas.push(...placas);
  }
  assert.equal(new Set(vistas).size, PLACAS_MOTO.length, 'en la ciudad salen todas');
  for (let i = 1; i < vistas.length; i++) assert.notEqual(vistas[i], vistas[i - 1]);
  // El sombreador conoce los trazos de cada placa y esconde los que no van.
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  root.children[0].material.onBeforeCompile(shader, {});
  const tabla = shader.vertexShader.match(/const int MOTO_PLACAS\[(\d+)\] = int\[\]\(([^)]*)\)/);
  assert.ok(tabla, 'tabla de trazos en el sombreador');
  assert.equal(Number(tabla[1]), PLACAS_MOTO.length * 6);
  const mascaras = tabla[2].split(',').map(Number);
  assert.ok(mascaras.every(m => Number.isInteger(m) && m > 0 && m < 32), 'cada carácter tiene trazos');
  assert.equal(new Set(PLACAS_MOTO.map((_, p) => mascaras.slice(p * 6, p * 6 + 6).join())).size, PLACAS_MOTO.length, 'ninguna placa se dibuja igual a otra');
  // Una fila de tres, como la de la vitrina: tres placas distintas.
  const fila = makeParkedMotos([0, 1, 2].map(i => ({ x: i * .95, z: 0, rot: .22, seed: i })));
  assert.equal(new Set([0, 1, 2].map(i => placaDeMoto(fila.children[0], i))).size, 3);
  root.dispose(); fila.dispose();
});
