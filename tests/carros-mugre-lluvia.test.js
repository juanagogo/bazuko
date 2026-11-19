import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeVehicle, CAR_MODEL_IDS } from '../src/world/bogota/vehicles.js';
import { CAR_MODELS } from '../src/world/bogota/carModels.js';
import { getCarBody } from '../src/world/bogota/VehicleBody.js';
import { pintarUso, mugreDe } from '../src/world/bogota/carUso.js';

const firma = texto => { let h = 2166136261; for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619); return h >>> 0; };
const azarGastado = fn => {
  const real = Math.random; let cuenta = 0;
  Math.random = () => { cuenta++; return real(); };
  try { fn(); } finally { Math.random = real; }
  return cuenta;
};

// Va primero: el lienzo del polvo se crea una sola vez por proceso y aquí se cuentan sus gotas.
test('capó, techo y tapa llevan gotas secas de 4 a 8 mm en el polvo, con azar propio y sin tocar el color', () => {
  const spec = CAR_MODELS.citadino, body = getCarBody('citadino'), W = 1024, H = 512, L = spec.L;
  const ty = z => H - (.72 + .28 * z / body.chartZ) * H;
  const carta = { sx: x => (x - body.xTail) / L * W, sy: y => H - .7 * y / body.chartH * H, tx: x => (x - body.xTail) / L * W, ty, pxX: W / L, pxY: .7 * H / body.chartH, W, H };
  const pxZ = Math.abs(ty(0) - ty(1)), techoFin = ty(0);
  const nada = () => {};
  const lienzo = (trazos, fondo) => ({
    fillRect: nada, beginPath: nada, arc: nada, fill: nada, stroke: nada, moveTo: nada, lineTo: nada, quadraticCurveTo: nada,
    save: nada, restore: nada, translate: nada, scale: nada, ellipse: (...a) => trazos.push(a),
    createLinearGradient: () => ({ addColorStop: nada }), createRadialGradient: () => ({ addColorStop: nada }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(fondo) }), putImageData: nada,
  });
  const color = [], velo = [];
  globalThis.document = { createElement: () => ({ getContext: () => lienzo(velo, 255) }) };
  let gastado;
  try { gastado = azarGastado(() => pintarUso(lienzo(color, 0), spec, body, carta)); } finally { delete globalThis.document; }
  assert.equal(gastado, 0, 'las gotas gastan azar del juego');
  const gotas = velo.filter(([, , rx]) => rx < .0045 * carta.pxX);
  assert.ok(gotas.length > 2000, `solo ${gotas.length} gotas`);
  for (const [x, y, rx, ry] of gotas) {
    assert.ok(y >= 0 && y <= techoFin && x >= -1 && x <= W + 1, 'una gota cae fuera de capó, techo y tapa');
    assert.ok(rx >= .002 * carta.pxX - 1e-9 && rx <= .004 * carta.pxX + 1e-9 && Math.abs(ry / rx - pxZ / carta.pxX) < 1e-9, 'gota de otro tamaño');
  }
  assert.ok(color.every(([, y]) => y > techoFin), 'las gotas no se pintan en el color del esmalte');
});

const FLOTA = [];
for (let seed = 0; seed < 48; seed++) FLOTA.push(['carro', seed]);
for (let seed = 0; seed < 12; seed++) FLOTA.push(['taxi', seed], ['police', seed], ['buseta', seed]);
for (const model of CAR_MODEL_IDS) FLOTA.push(['carro', 3, model]);

test('la flota gasta el mismo azar del juego, con las mismas medidas, mallas, programas y mapas', () => {
  const vehiculos = [];
  const gastado = azarGastado(() => {
    for (const [kind, seed, model] of FLOTA) vehiculos.push(makeVehicle(kind, seed, { beams: false, model, parked: seed % 3 === 0 }));
  });
  const medidas = vehiculos.map(v => `${v.model}:${v.length.toFixed(3)}x${v.width.toFixed(3)}x${v.height.toFixed(3)}`);
  const mallas = vehiculos.map(v => { let n = 0; v.group.traverse(o => { if (o.isMesh) n++; }); return n; });
  const programas = new Set(), mapas = new Set();
  for (const v of vehiculos) {
    for (const m of v.wetMaterials) programas.add(m.customProgramCacheKey());
    if (v.wetMaterials[0].map) mapas.add(v.wetMaterials[0].map);
  }
  const huella = {
    gastado,
    medidas: firma(medidas.join('|')),
    mallas: mallas.reduce((a, b) => a + b, 0),
    programas: [...programas].sort().join(','),
    mapas: mapas.size,
  };
  for (const v of vehiculos) v.dispose();
  assert.deepEqual(huella, HUELLA);
});

test('pintar el uso de cada modelo no gasta azar del juego y dibuja lo mismo dos veces', () => {
  const lienzo = (trazos, fondo) => {
    const nada = () => {};
    const ctx = {
      fillRect: (...a) => trazos.push(['rect', ...a]), beginPath: nada, arc: nada, ellipse: (...a) => trazos.push(['elipse', ...a]),
      fill: () => trazos.push(['fill', ctx.fillStyle]), stroke: () => trazos.push(['stroke', ctx.strokeStyle]), moveTo: nada,
      lineTo: nada, quadraticCurveTo: nada, save: nada, restore: nada, translate: nada, scale: nada,
      createLinearGradient: () => ({ addColorStop: nada }), createRadialGradient: () => ({ addColorStop: nada }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(fondo) }), putImageData: (img) => { trazos.imagen = img; },
      set fillStyle(v) { this._f = v; }, get fillStyle() { return this._f; },
    };
    return ctx;
  };
  for (const id of CAR_MODEL_IDS) {
    const spec = CAR_MODELS[id], body = getCarBody(id);
    const W = 64, H = 32, L = spec.L;
    const carta = { sx: x => (x - body.xTail) / L * W, sy: y => H - .7 * y / body.chartH * H, tx: x => (x - body.xTail) / L * W, ty: z => H * .28 * (1 - z / body.chartZ), pxX: W / L, pxY: .7 * H / body.chartH, W, H };
    const pintar = () => {
      const trazos = [], velo = [];
      globalThis.document = { createElement: () => ({ getContext: () => lienzo(velo, 255) }) };
      try { pintarUso(lienzo(trazos, 0), spec, body, carta); } finally { delete globalThis.document; }
      return trazos.length;
    };
    let primera;
    assert.equal(azarGastado(() => { primera = pintar(); }), 0, `${id}: gasta azar del juego`);
    assert.equal(pintar(), primera, `${id}: no dibuja igual dos veces`);
  }
});



test('hasta el carro recién lavado lleva su película de calle, y los hay de cuatro niveles', () => {
  const niveles = [...new Set(Array.from({ length: 64 }, (_, i) => mugreDe(i << 23)))].sort((a, b) => a - b);
  assert.deepEqual(niveles, [.9, 1.1, 1.25, 1.5]);
});

const HUELLA = { gastado: 7800, medidas: 2270706608, mallas: 806, programas: 'reflejo-calle-polvo-matiz|campo-sol,vidrio-con-sombra-reflejo-panoramico|campo-sol', mapas: 13 };
