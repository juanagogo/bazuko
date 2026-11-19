import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

test('el interruptor apagado no carga Rapier y reproduce exactamente la maniobra de e704d59', async t => {
  const cargas = new Int32Array(new SharedArrayBuffer(4));
  const observador = `
    let cargas;
    export function initialize(datos) { cargas = datos; }
    export function resolve(ruta, contexto, siguiente) {
      if (ruta.includes('@dimforge/rapier3d-compat')) Atomics.add(cargas, 0, 1);
      return siguiente(ruta, contexto);
    }
  `;
  register('data:text/javascript,' + encodeURIComponent(observador), { parentURL: import.meta.url, data: cargas });
  await import('../src/core/game.js');
  const { escenario, carroDePrueba, subir, manejar, entrada, estado } = await import('./helpers/carjack-fisica.js');
  const suelo = (x, z) => .04 * x - .02 * z;
  const maniobra = [
    [3, 30, entrada(1)], [.5, 60, entrada(1, 1)], [.5, 144, entrada(0, -1)],
    [.5, 30, entrada(0, 0, true)], [2, 60, entrada(-1)], [1, 144, entrada(-1, 1)], [.5, 60, entrada(1)]
  ];
  // Posición XYZ, rumbo y velocidad al final de cada tramo en e704d59.
  const referencia = [
    [29.05077991514195, 1.4041139538354306, -12.104137861487631, .37, 15],
    [33.75775252156133, 1.7019255633634025, -17.580773125047465, 1.32, 15],
    [38.45184083372479, 1.9949007317269658, -22.841354918898716, .3700000000000002, 14.299999999999955],
    [42.70636128750697, 2.1980849849689217, -24.491526673432148, .3700000000000002, 4.599999999999957],
    [38.16908666818791, 1.9813971666131591, -22.731684994282148, .3700000000000002, -5],
    [34.60360789889191, 1.8861731100709238, -25.101439705762377, -1.530000000000001, -5],
    [34.56858377048819, 1.9019328543948126, -25.959475178764254, -1.530000000000001, .8500000000000023]
  ];
  for (const opciones of [{}, { fisica: false }]) {
    const carro = carroDePrueba({ x: 3, y: suelo(3, -2), z: -2, rumbo: .37 });
    const escena = escenario(t, { opciones, suelo, carro });
    subir(escena);
    const muestras = [];
    for (const [segundos, hz, mando] of maniobra) {
      manejar(escena, segundos, mando, hz);
      muestras.push(estado(escena));
    }
    await escena.sistema.fisicaLista;
    assert.deepEqual(muestras, referencia);
  }
  assert.equal(Atomics.load(cargas, 0), 0, 'ningún módulo intentó importar Rapier');
});
