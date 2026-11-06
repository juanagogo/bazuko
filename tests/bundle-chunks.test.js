import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import config, { BLOQUES_DE_LIBRERIAS, SOLO_A_DEMANDA } from '../vite.config.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));

/** El primer bloque cuyo `test` acepta el módulo, como hace rolldown con grupos de igual prioridad. */
const bloqueDe = id => BLOQUES_DE_LIBRERIAS.find(grupo => grupo.test(id))?.name ?? null;

test('las librerías a demanda no caen en un bloque del arranque', () => {
  assert.equal(bloqueDe('/p/node_modules/hls.js/dist/hls.mjs'), null);
  assert.equal(bloqueDe('/p/node_modules/three/examples/jsm/loaders/FBXLoader.js'), null);
  assert.equal(bloqueDe('/p/node_modules/three/examples/jsm/libs/fflate.module.js'), null);
  assert.equal(bloqueDe('/p/node_modules/three/examples/jsm/curves/NURBSCurve.js'), null);
  assert.equal(bloqueDe('C:\\p\\node_modules\\hls.js\\dist\\hls.mjs'), null);
  assert.equal(bloqueDe('/p/node_modules/three/build/three.core.js'), 'three');
  assert.equal(bloqueDe('/p/node_modules/three/examples/jsm/loaders/GLTFLoader.js'), 'three');
  assert.equal(bloqueDe('/p/node_modules/howler/dist/howler.js'), 'vendor');
  assert.equal(bloqueDe('/p/node_modules/cannon-es/dist/cannon-es.js'), 'vendor');
  assert.equal(bloqueDe('/p/src/core/game.js'), null);
  assert.ok(SOLO_A_DEMANDA.test('/p/node_modules/hls.js/dist/hls.light.mjs'));
});

test('al compilar, hls.js y el cargador FBX quedan fuera de lo que baja el arranque', { timeout: 120_000 }, async () => {
  const salida = await build({
    configFile: false, root: raiz, logLevel: 'silent', publicDir: false,
    build: { ...config.build, write: false, emptyOutDir: false, reportCompressedSize: false }
  });
  const bloques = (Array.isArray(salida) ? salida : [salida]).flatMap(resultado => resultado.output)
    .filter(archivo => archivo.type === 'chunk');
  const porNombre = new Map(bloques.map(bloque => [bloque.fileName, bloque]));
  const contiene = (bloque, patron) => bloque.moduleIds.some(id => patron.test(id));

  // Lo que baja el arranque: la página, game.js (main.js lo pide antes del primer cuadro) y sus imports estáticos.
  const arranque = new Set();
  const visitar = bloque => {
    if (!bloque || arranque.has(bloque.fileName)) return;
    arranque.add(bloque.fileName);
    for (const nombre of bloque.imports) visitar(porNombre.get(nombre));
  };
  const entrada = bloques.find(bloque => bloque.isEntry && contiene(bloque, /src[\\/]main\.js$/));
  const juego = bloques.find(bloque => contiene(bloque, /src[\\/]core[\\/]game\.js$/));
  assert.ok(entrada && juego, 'no se encontró la entrada ni el bloque del juego');
  visitar(entrada);
  visitar(juego);

  const hls = bloques.find(bloque => contiene(bloque, /node_modules[\\/]hls\.js[\\/]/));
  const fbx = bloques.find(bloque => contiene(bloque, /examples[\\/]jsm[\\/]loaders[\\/]FBXLoader/));
  assert.ok(hls && fbx);
  assert.ok(!arranque.has(hls.fileName), `${hls.fileName} baja al arrancar`);
  assert.ok(!arranque.has(fbx.fileName), `${fbx.fileName} baja al arrancar`);
  // El bloque a demanda es el código mismo, no una reexportación de otro bloque.
  assert.ok(hls.code.length > 100_000, `hls: ${hls.code.length} bytes`);
  assert.ok(fbx.code.length > 20_000, `FBXLoader: ${fbx.code.length} bytes`);
  for (const nombre of arranque) {
    const bloque = porNombre.get(nombre);
    assert.ok(!contiene(bloque, SOLO_A_DEMANDA), `${nombre} trae una librería a demanda`);
  }
  // Las librerías del arranque siguen en sus bloques de caché.
  assert.ok([...arranque].some(nombre => nombre.startsWith('assets/three-')));
  assert.ok([...arranque].some(nombre => nombre.startsWith('assets/vendor-')));
});
