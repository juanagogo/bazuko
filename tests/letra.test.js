// La letra sale de un generador del repositorio: se comprueba lo que trae, lo que mide y que nada se le escape.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerCmap, leerAvances, tablas } from '../tools/fuente/woff.mjs';
import { caracteresDelJuego } from '../tools/fuente/textos.mjs';
import { DIBUJOS } from '../src/ui/fuentes/dibujos.js';
import { PICTOS } from '../src/ui/pictos.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const FUENTES = path.join(RAIZ, 'src/ui/fuentes');
const CORTES = ['grueso', 'fino'];
const woff = (corte) => fs.readFileSync(path.join(FUENTES, `dios-le-pague-${corte}.woff`));
const manifiesto = JSON.parse(fs.readFileSync(path.join(FUENTES, 'manifiesto.json'), 'utf8'));
const expandir = (rangos) => rangos.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));

test('el manifiesto dice exactamente lo que traen los .woff', () => {
  for (const corte of CORTES) assert.deepEqual(expandir(manifiesto[corte]), leerCmap(woff(corte)), corte);
});

test('las cifras miden lo mismo en todas sus formas, para que una columna no baile', () => {
  for (const corte of CORTES) {
    const avances = leerAvances(woff(corte));
    const formas = manifiesto.cifras[corte];
    assert.equal(formas.length, 30, `${corte}: diez cifras con tres formas`);
    const medidas = new Set(formas.map((c) => avances.get(c)));
    assert.equal(medidas.size, 1, `${corte}: ${[...medidas]}`);
  }
});

test('cada dibujo existe en los dos cortes', () => {
  for (const corte of CORTES) {
    const cmap = new Set(leerCmap(woff(corte)));
    for (const [nombre, ch] of Object.entries(DIBUJOS)) assert.ok(cmap.has(ch.codePointAt(0)), `${corte}: falta ${nombre}`);
  }
});

test('ningún carácter de los textos del juego cae en silencio a una letra del sistema', () => {
  const grueso = new Set(leerCmap(woff('grueso')));
  const fino = new Set(leerCmap(woff('fino')));
  const faltan = [];
  // La sala de pruebas no es parte del juego: es un banco de trabajo con su propia botonera.
  for (const [ch, donde] of caracteresDelJuego(RAIZ, { excluir: ['src/sala'] })) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20) continue; // saltos y tabuladores
    if (grueso.has(cp) && fino.has(cp)) continue;
    if (Object.hasOwn(PICTOS, ch)) continue;
    faltan.push(`U+${cp.toString(16).toUpperCase()} ${ch} en ${donde}`);
  }
  assert.deepEqual(faltan, [], 'añádelo a la letra (tools/fuente) o a la tabla de src/ui/pictos.js');
});

test('la prueba de cobertura sí ve lo que hay en cadenas, plantillas y hojas', () => {
  const textos = caracteresDelJuego(RAIZ, { excluir: ['src/sala'] });
  for (const ch of ['🔥', 'ñ', '¿', '✓']) assert.ok(textos.has(ch), ch);
  assert.ok(![...textos.keys()].includes('\uD83D'), 'lee por punto de código, no por mitades');
});

test('letra y marcas pesan 200 KB o menos', () => {
  const peso = CORTES.reduce((s, c) => s + woff(c).length, 0) + fs.statSync(path.join(RAIZ, 'src/ui/css/marcas.css')).size;
  assert.ok(peso <= 200 * 1024, `${peso} bytes`);
});

const generar = (salida) => {
  execFileSync(process.execPath, [path.join(RAIZ, 'tools/fuente/dibujar.mjs'), salida], { stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(RAIZ, 'tools/fuente/marcas.mjs'), path.join(salida, 'marcas.css')], { stdio: 'pipe' });
};

test('el generador da lo mismo que está en el repositorio', () => {
  const salida = fs.mkdtempSync(path.join(os.tmpdir(), 'letra-'));
  try {
    generar(salida);
    for (const f of fs.readdirSync(FUENTES)) {
      const [hay, sale] = [path.join(FUENTES, f), path.join(salida, f)].map((r) => fs.readFileSync(r));
      if (!f.endsWith('.woff')) { assert.ok(hay.equals(sale), f); continue; }
      // El compresor no da los mismos bytes en todos los procesadores: los .woff se comparan por dentro.
      const [a, b] = [tablas(hay), tablas(sale)];
      assert.deepEqual(Object.keys(a), Object.keys(b), f);
      for (const t of Object.keys(a)) assert.ok(a[t].equals(b[t]), `${f}: ${t}`);
    }
    assert.ok(fs.readFileSync(path.join(RAIZ, 'src/ui/css/marcas.css')).equals(fs.readFileSync(path.join(salida, 'marcas.css'))), 'marcas.css');
  } finally {
    fs.rmSync(salida, { recursive: true, force: true });
  }
});

test('repetir el generador da los mismos bytes', () => {
  const [uno, dos] = ['uno', 'dos'].map((n) => fs.mkdtempSync(path.join(os.tmpdir(), `letra-${n}-`)));
  try {
    generar(uno); generar(dos);
    for (const f of fs.readdirSync(uno)) assert.ok(fs.readFileSync(path.join(uno, f)).equals(fs.readFileSync(path.join(dos, f))), f);
  } finally {
    for (const r of [uno, dos]) fs.rmSync(r, { recursive: true, force: true });
  }
});

test('el generador no depende de rutas de nadie ni de un navegador', () => {
  for (const f of fs.readdirSync(path.join(RAIZ, 'tools/fuente'))) {
    const src = fs.readFileSync(path.join(RAIZ, 'tools/fuente', f), 'utf8');
    assert.doesNotMatch(src, /\/Users\/|\/private\/|\/tmp\/|playwright/i, f);
  }
});
