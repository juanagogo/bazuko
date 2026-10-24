import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { STREET_PRESETS, applyStreetPreset } from '../src/character/presets.js';
import { ACCESSORIES, DEFAULT_LOOK, PALETTES, WEAR_LEVELS, normalizeLook } from '../src/character/look.js';

const catalog = JSON.parse(readFileSync(new URL('../public/models/personaje/catalogo.json', import.meta.url), 'utf8'));
const source = JSON.parse(readFileSync(new URL('../tools/personaje/catalogo.json', import.meta.url), 'utf8'));
const optionsFor = (cat, sexo, cat2 = catalog) => cat2.piezas[cat].filter((p) => !p.sexo || p.sexo === sexo);

test('cada estilo de calle usa piezas exportadas para su cuerpo', () => {
  assert.ok(STREET_PRESETS.length >= 6);
  assert.equal(new Set(STREET_PRESETS.map((p) => p.id)).size, STREET_PRESETS.length);
  for (const preset of STREET_PRESETS) {
    const { real } = preset.look;
    const body = catalog.cuerpos.find((c) => c.sexo === real.sexo && c.edad === real.edad);
    assert.ok(body, `${preset.id}: cuerpo ${real.sexo}-${real.edad}`);
    for (const cat of ['pelo', 'barba', 'ropa', 'calzado']) {
      assert.ok(optionsFor(cat, real.sexo).some((o) => o.id === real[cat]), `${preset.id}: ${cat} ${real[cat]}`);
      const piece = body.piezas[real[cat]];
      assert.ok(!piece || piece.file || !piece.oculta?.length, `${preset.id}: ${cat} sin archivo`);
    }
    assert.ok(preset.look.piel >= 0 && preset.look.piel < PALETTES.piel.length);
    assert.ok(preset.look.peloColor >= 0 && preset.look.peloColor < PALETTES.pelo.length);
    assert.ok(preset.look.desgaste >= 0 && preset.look.desgaste < WEAR_LEVELS.length);
    // los sombreros pueden no estar exportados todavía: se validan contra el catálogo fuente
    if (real.cabeza) assert.ok(optionsFor('cabeza', real.sexo, source).some((o) => o.id === real.cabeza), `${preset.id}: cabeza ${real.cabeza}`);
    for (const id of preset.look.accesorios ?? []) assert.ok(ACCESSORIES.some((a) => a.id === id), `${preset.id}: accesorio ${id}`);
  }
});

test('aplicar un estilo conserva el nombre y el origen', () => {
  const look = { ...DEFAULT_LOOK, nombre: 'Don Chepe', origen: 'desplazado' };
  const next = applyStreetPreset(look, STREET_PRESETS[0]);
  assert.equal(next.nombre, 'Don Chepe');
  assert.equal(next.origen, 'desplazado');
  assert.deepEqual(next.real, STREET_PRESETS[0].look.real);
  assert.equal(next.desgaste, STREET_PRESETS[0].look.desgaste);
});

test('el desgaste se normaliza y las partidas viejas quedan sucias', () => {
  assert.equal(normalizeLook({ v: 2 }).desgaste, DEFAULT_LOOK.desgaste);
  assert.equal(DEFAULT_LOOK.desgaste, WEAR_LEVELS.length - 1);
  assert.equal(normalizeLook({ v: 2, desgaste: 0 }).desgaste, 0);
  assert.equal(normalizeLook({ v: 2, desgaste: 9 }).desgaste, DEFAULT_LOOK.desgaste);
  assert.equal(normalizeLook({ v: 2, desgaste: '1' }).desgaste, DEFAULT_LOOK.desgaste);
});

test('la luminancia del pelo ignora lo transparente y trabaja en espacio lineal', async () => {
  const { averageLinearLuminance } = await import('../src/character/weathering.js');
  const white = [255, 255, 255, 255], black = [0, 0, 0, 255], hole = [255, 255, 255, 0];
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);
  near(averageLinearLuminance(new Uint8ClampedArray([...white, ...hole])), 1);
  near(averageLinearLuminance(new Uint8ClampedArray([...white, ...black])), 0.5);
  assert.ok(Math.abs(averageLinearLuminance(new Uint8ClampedArray([128, 128, 128, 255])) - 0.2158) < 0.001);
  assert.equal(averageLinearLuminance(new Uint8ClampedArray([...hole])), 0);
});

test('los accesorios se limpian: solo ids conocidos y sin repetir', () => {
  assert.deepEqual(normalizeLook({ v: 2 }).accesorios, []);
  assert.deepEqual(normalizeLook({ v: 2, accesorios: ['baston', 'baston', 'cohete', 3] }).accesorios, ['baston']);
  assert.deepEqual(normalizeLook({ v: 2, accesorios: 'mochila' }).accesorios, []);
  const look = applyStreetPreset({ ...DEFAULT_LOOK, accesorios: ['mochila'] }, STREET_PRESETS.find((p) => !p.look.accesorios));
  assert.deepEqual(look.accesorios, []);
});

test('el catálogo fuente y el exportado comparten ids de piezas sin choques entre categorías', () => {
  for (const cat2 of [source, catalog]) {
    const ids = Object.values(cat2.piezas).flat().map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  for (const [cat, items] of Object.entries(catalog.piezas)) {
    for (const item of items) assert.ok(source.piezas[cat].some((p) => p.id === item.id), `${cat}: ${item.id} falta en la fuente`);
  }
  assert.ok(catalog.piezas.calzado.some((p) => p.id === 'descalzo'));
});
