import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELOS_SIN_USO } from '../vite.config.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));

/** Rutas de archivo de una carpeta, con sus subcarpetas. */
function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entrada => {
    const ruta = path.join(dir, entrada.name);
    return entrada.isDirectory() ? archivos(ruta) : [ruta];
  });
}

/** Todo texto donde el juego puede nombrar un recurso: su código, la página y los .json de public/. */
const texto = [
  ...archivos(path.join(raiz, 'src')).filter(f => /\.(js|json)$/.test(f)),
  ...archivos(path.join(raiz, 'public')).filter(f => f.endsWith('.json')),
  path.join(raiz, 'index.html')
].map(f => fs.readFileSync(f, 'utf8')).join('\n');

/** Falla si el juego nombra un recurso que MODELOS_SIN_USO retira de dist/; la búsqueda es literal. */
test('ningún recurso que el juego carga queda fuera de dist/', () => {
  for (const modelo of MODELOS_SIN_USO) {
    const ruta = path.join(raiz, 'public', modelo);
    assert.ok(fs.existsSync(ruta), `${modelo} ya no está en public/`);
    const nombres = fs.statSync(ruta).isDirectory()
      ? [modelo, `${path.basename(modelo)}/`]
      : [path.basename(modelo)];
    for (const nombre of nombres) {
      assert.ok(!texto.includes(nombre), `el juego nombra ${nombre}, que se retira de dist/`);
    }
  }
});
