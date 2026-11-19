// tests/plano-carton.test.js
// Lo que el radar y el mapa grande dibujan además de los tiles: el lago, las copas, las cebras, las plazas y los cierres.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { LAKE_PARK } from '../src/world/bogota/LakePark.js';
import { pedestrianCrossings } from '../src/world/bogota/StreetCrossings.js';

mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { cityMapPlan } = await import('../src/world/bogota/CityMapRaster.js');
const { prepararPlano, trazarPlano, FINO_DESDE, CEBRAS_DESDE } = await import('../src/ui/planoRadar.js');

// En Node no hay Path2D: uno de mentira que solo anota lo que le piden.
class Trazo {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(['M', x, y]); }
  lineTo(x, y) { this.ops.push(['L', x, y]); }
  quadraticCurveTo(a, b, x, y) { this.ops.push(['Q', x, y]); }
  rect(x, y, w, h) { this.ops.push(['R', x, y, w, h]); }
  ellipse(x, y, rx, ry) { this.ops.push(['E', x, y, rx, ry]); }
  addPath(path) { this.ops.push(...path.ops); }
  closePath() { this.ops.push(['Z']); }
  cuenta(tipo) { return this.ops.filter(op => op[0] === tipo).length; }
}

const city = new Bogota();
city.map = city._layout();
city.treePlan = [{ x: 150, z: 150, scale: 1 }, { x: 40, z: 70, scale: 1.3 }, { x: 300, z: 60 }];
const tiles = cityMapPlan(city).tiles();

test('el plano recibe el óvalo del lago, las copas y los cruces', () => {
  assert.deepEqual(tiles.lago, { x: LAKE_PARK.lakeX, z: LAKE_PARK.lakeZ, rx: LAKE_PARK.radiusX, rz: LAKE_PARK.radiusZ });
  assert.deepEqual(tiles.arboles, [[150, 150, 1], [40, 70, 1.3], [300, 60, 1]]);
  assert.deepEqual(tiles.cruces.map(({ piedra, ...paso }) => paso), pedestrianCrossings(city.map));
  assert.ok(tiles.cruces.some(c => c.piedra) && tiles.cruces.some(c => !c.piedra));
  assert.equal(cityMapPlan(city).tiles().cruces.length, tiles.cruces.length, 'cada plan arma los suyos');
});

test('sin Path2D no hay plano', () => {
  assert.equal(prepararPlano(tiles), null);
});

test('el plano dibuja el lago como un óvalo, las copas, las cebras, las plazas y los cierres', (t) => {
  globalThis.Path2D = Trazo;
  t.after(() => { delete globalThis.Path2D; });
  const plano = prepararPlano(tiles);
  // El agua es un solo óvalo, no una escalera de cuadros: su relleno es el mismo trazo de la orilla, y lleva su ribera.
  assert.equal(plano.agua.cuenta('R'), 0);
  assert.deepEqual(plano.agua.ops, plano.orilla.ops);
  assert.ok(plano.orilla.cuenta('Q') >= 20 && plano.ribera.cuenta('M') >= 6);
  for (const [, x, z] of plano.orilla.ops) {
    const radio = Math.hypot((x - LAKE_PARK.lakeX) / LAKE_PARK.radiusX, (z - LAKE_PARK.lakeZ) / LAKE_PARK.radiusZ);
    assert.ok(radio > .93 && radio < 1.07, `la orilla sigue al lago (${radio})`);
  }
  // Las olas no se salen del óvalo.
  for (const [, x, z] of plano.olas.ops) assert.ok(Math.hypot((x - LAKE_PARK.lakeX) / LAKE_PARK.radiusX, (z - LAKE_PARK.lakeZ) / LAKE_PARK.radiusZ) < .95);
  assert.equal(plano.copas.cuenta('M'), 3, 'una copa por árbol');
  assert.ok(plano.cebras.cuenta('M') > 200, 'cebras en los cruces');
  assert.ok(plano.puntos.cuenta('M') > 300, 'plazas y paseo punteados');
  assert.ok(plano.barrera.cuenta('M') > 20 && plano.fleco.cuenta('M') > 40, 'cierres con equis y fleco');
  assert.equal(plano.bordesTablero.cuenta('M'), 2, 'los dos bordes de la troncal');
  assert.deepEqual([plano.fueraDelTablero.cuenta('R'), plano.fueraDelTablero.cuenta('Z')], [1, 1], 'el plano menos la franja de la troncal');
  // Toda rayita de cebra empieza y termina sobre calzada.
  const tipo = (x, z) => tiles.tipo(Math.round(x / tiles.T), Math.round(z / tiles.T));
  for (const [, x, z] of plano.cebras.ops) assert.ok(['road', 'busway'].includes(tipo(x, z)), `cebra fuera de la calzada en ${x}, ${z}`);
  // Ninguna barrera queda lejos del borde de la ciudad.
  const ancho = tiles.ancho * tiles.T, sur = tiles.hastaZ * tiles.T;
  for (const [, x, z] of plano.barrera.ops) assert.ok(x < 4 || x > ancho - 6 || z < 4 || z > sur - 4, `barrera lejos del borde en ${x}, ${z}`);
  // La reja de los parques también va pegada al borde, y hay más de un tramo.
  assert.ok(plano.reja.cuenta('M') > 60, 'reja en el borde de los parques');
  for (const [, x, z] of plano.reja.ops) assert.ok(x < 3 || x > ancho - 5 || z < 3 || z > sur - 3, `reja lejos del borde en ${x}, ${z}`);
  // El mismo plano sale igual cada vez.
  assert.deepEqual(prepararPlano(tiles).copas.ops, plano.copas.ops);
});

test('el radar no pinta copas ni cebras; el mapa grande, copas, y las cebras solo de cerca y apagadas', (t) => {
  globalThis.Path2D = Trazo;
  t.after(() => { delete globalThis.Path2D; });
  const plano = prepararPlano(tiles);
  const lienzo = () => {
    const pintado = [];
    const nada = () => {};
    const ctx = { pintado, alfa: new Map(), globalAlpha: 1, save: nada, restore: nada, clip: nada, setLineDash: nada,
      fill: (path) => pintado.push(path), stroke: (path) => { pintado.push(path); ctx.alfa.set(path, ctx.globalAlpha); } };
    return ctx;
  };
  // El mapa grande abre a 2,2 px por metro: así se ve la ciudad entera, y ahí las cebras parecían una vía férrea.
  const radar = lienzo(), mapa = lienzo(), cerca = lienzo();
  trazarPlano(radar, plano, 1.26);
  trazarPlano(mapa, plano, 2.2);
  trazarPlano(cerca, plano, CEBRAS_DESDE);
  assert.ok(FINO_DESDE <= 2.2 && CEBRAS_DESDE > 2.2);
  for (const pieza of ['copas', 'cebras']) assert.ok(!radar.pintado.includes(plano[pieza]), `${pieza} en el radar`);
  assert.ok(mapa.pintado.includes(plano.copas), 'copas en el mapa');
  assert.ok(!mapa.pintado.includes(plano.cebras), 'sin cebras en el mapa entero');
  assert.ok(cerca.pintado.includes(plano.cebras), 'cebras de cerca');
  assert.ok(cerca.alfa.get(plano.cebras) < cerca.alfa.get(plano.puntos), 'y más apagadas que las plazas');
  for (const pieza of ['orilla', 'ribera', 'puntos', 'barrera', 'fleco', 'reja', 'bordesTablero']) {
    assert.ok(radar.pintado.includes(plano[pieza]) && mapa.pintado.includes(plano[pieza]), pieza);
  }
});
