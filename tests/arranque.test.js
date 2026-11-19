// La carga de verdad, sin navegador: el constructor de Game entero y _initialize hasta construir la ciudad.
// startup.test.js cambia _spawnEntities por una función vacía; esta prueba corre la de verdad.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';

// Lo que importa game.js, salvo three, se cambia por un doble que acepta cualquier uso
// (clase, función, objeto o número): así el constructor corre sin DOM ni WebGL.
const doble = new Proxy(function () {}, {
  get: (_, key) => key === Symbol.toPrimitive ? () => 0 : key === 'then' ? () => doble : doble,
  set: () => true,
  apply: () => doble,
  construct: () => doble
});
const gameUrl = new URL('../src/core/game.js', import.meta.url);
const modulos = new Map();
for (const [, nombres, desde] of readFileSync(gameUrl, 'utf8').matchAll(/^import \{([^}]*)\} from '([^']+)';/gm)) {
  const namedExports = modulos.get(desde) ?? {};
  for (const nombre of nombres.split(',')) {
    const importado = nombre.trim().split(/\s+as\s+/)[0];
    if (importado) namedExports[importado] = doble;
  }
  modulos.set(desde, namedExports);
}
for (const [desde, namedExports] of modulos) mock.module(new URL(desde, gameUrl).href, { namedExports });
globalThis.window = new EventTarget();
const { Game } = await import('../src/core/game.js');

test('el constructor prepara las alucinaciones, el comedor y las bicicletas antes de cargar la ciudad', () => {
  const game = new Game(doble);
  assert.ok(game.randomHallucinations);
  assert.equal(game.lastComedorTimestamp, null);
  assert.deepEqual(game.bicycles, []);
  assert.equal(game.bikeFence, null);
});
