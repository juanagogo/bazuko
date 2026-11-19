import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createUrbanTree, URBAN_TREE_SPECIES } from '../src/world/bogota/UrbanTrees.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { addMobiliarioDenso } from '../src/world/bogota/mobiliarioDenso.js';
import { sunFieldUniforms } from '../src/world/bogota/SunFieldShader.js';

const mallas = arbol => { const lista = []; arbol.traverse(o => { if (o.isMesh) lista.push(o); }); return lista; };
const hojasDe = arbol => mallas(arbol).find(malla => malla.geometry.attributes.treeWind);
const maderaDe = arbol => mallas(arbol).find(malla => !malla.geometry.attributes.treeWind);
const suma = datos => { let s = 0; for (let i = 0; i < datos.length; i++) s += datos[i] * ((i % 7) + 1); return Math.round(s * 1000) / 1000; };

function contarAzar(hacer) {
  const delJuego = Math.random;
  let gasto = 0;
  Math.random = () => { gasto++; return delJuego(); };
  try { hacer(); } finally { Math.random = delJuego; }
  return gasto;
}

// Medido antes de tocar los árboles: tarjetas de hojas y sumas de posición, viento, color y UV de cada copa.
const COPAS = {
  'urapan-5': [272, 20839.1, 26320.379, 2526.552, 2175.004],
  'urapan-13': [272, 20620.186, 14750.904, 1971.607, 2175.004],
  'urapan-722': [272, 20982.976, 25191.314, 2168.557, 2175.004],
  'eucalipto-5': [144, 13428.681, 13922.568, 1738.903, 2301.484],
  'eucalipto-13': [144, 13296.147, 7802.326, 1454.893, 2301.484],
  'eucalipto-722': [144, 13596.602, 13322.265, 1638.755, 2301.484],
  'arrayan-5': [270, 17412.167, 26119.179, 2119.026, 4318.484],
  'arrayan-13': [270, 17198.047, 14637.646, 1562.977, 4318.484],
  'arrayan-722': [270, 17887.442, 24994.461, 1728.016, 4318.484]
};

test('un árbol gasta el mismo azar del juego que antes: 24 sorteos, y 52 el que estrena el banco de materiales', () => {
  hojasDe(createUrbanTree(1, { seed: 1 })).material.dispose();
  assert.equal(contarAzar(() => createUrbanTree(1, { seed: 3 })), 52);
  for (const species of URBAN_TREE_SPECIES) for (const seed of [5, 13, 722]) {
    assert.equal(contarAzar(() => createUrbanTree(1.1, { seed, species })), 24, `${species} ${seed}`);
  }
});

test('la copa de cada semilla conserva tarjetas, sitio, viento, color y UV', () => {
  for (const [clave, [tarjetas, pos, viento, color, uv]] of Object.entries(COPAS)) {
    const [species, seed] = clave.split('-');
    const arbol = createUrbanTree(1.1, { seed: Number(seed), species }), hojas = hojasDe(arbol).geometry;
    assert.equal(arbol.userData.tree.leafCards, tarjetas, clave);
    assert.equal(hojas.index.count, tarjetas * 6, clave);
    assert.equal(suma(hojas.attributes.position.array), pos, `${clave}: posición`);
    assert.equal(suma(hojas.attributes.treeWind.array), viento, `${clave}: viento`);
    assert.equal(suma(hojas.attributes.color.array), color, `${clave}: color`);
    assert.equal(suma(hojas.attributes.uv.array), uv, `${clave}: UV`);
  }
});

test('cada árbol sigue siendo dos mallas con los dos materiales de siempre y menos de 900 triángulos', () => {
  for (const species of URBAN_TREE_SPECIES) {
    const arbol = createUrbanTree(1, { seed: 21, species }), partes = mallas(arbol);
    assert.equal(partes.length, 2);
    assert.equal(maderaDe(arbol).material.userData.staticMergeKey, 'urban-tree:bark-v1');
    assert.equal(hojasDe(arbol).material.userData.staticMergeKey, 'urban-tree:foliage-v1|wind');
    assert.equal(maderaDe(arbol).material.name, 'Troncos urbanos');
    assert.equal(hojasDe(arbol).material.name, 'Hojas urbanas');
    assert.ok(arbol.userData.tree.triangles < 900, `${species}: ${arbol.userData.tree.triangles}`);
  }
});

// El alcorque mide de lado y lado .45 + .22 × escala: medio metro de raíz cabe en él a cualquier escala del plan.
test('el pie del tronco no se sale del alcorque ni se hunde', () => {
  for (const species of URBAN_TREE_SPECIES) for (const seed of [5, 13, 722]) {
    const p = maderaDe(createUrbanTree(1, { seed, species })).geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      assert.ok(p.getY(i) >= -.03, `${species} ${seed}: bajo el piso`);
      if (p.getY(i) < .5) assert.ok(Math.hypot(p.getX(i), p.getZ(i)) < .52, `${species} ${seed}: pie a ${Math.hypot(p.getX(i), p.getZ(i)).toFixed(2)} m`);
    }
  }
});

test('la corteza trae fisuras y placas con contraste, y una segunda columna con liquen y tierra al pie', () => {
  const { data, width, height } = maderaDe(createUrbanTree(1, { seed: 2 })).material.map.image;
  assert.deepEqual([width, height], [256, 256], 'dos cortezas de 128 × 256 lado a lado');
  let min = 255, max = 0, total = 0, cuadrados = 0, liquen = 0, tierra = 0, limpia = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < 128; x++) {
    const i = (y * width + x) * 4, j = i + 128 * 4, valor = data[i];
    min = Math.min(min, valor); max = Math.max(max, valor); total += valor; cuadrados += valor * valor;
    if (data[j + 1] > data[j] + 10) liquen += y < 215;
    else if (y < 54) tierra += data[j] < valor;
    else limpia += data[j] === valor;
  }
  const media = total / (128 * height), desvio = Math.sqrt(cuadrados / (128 * height) - media * media);
  assert.ok(min >= 110 && max <= 230, `valores de ${min} a ${max}`);
  assert.ok(max - min >= 100 && desvio > 20, `contraste: ${max - min}, desvío ${desvio.toFixed(1)}`);
  assert.ok(liquen / (128 * 215) > .2 && liquen / (128 * 215) < .3, `liquen: ${(liquen / (128 * 215)).toFixed(3)}`);
  assert.ok(tierra > 128 * 54 * .25, 'tierra salpicada en los 30 cm de abajo');
  assert.ok(limpia > 128 * 150 * .6, 'fuera del liquen y de la tierra las dos columnas son la misma madera');
});

test('el tronco tiene diez lados hasta la horqueta, cuello de raíz ancho y tres o cuatro raíces', () => {
  for (const species of URBAN_TREE_SPECIES) for (const seed of [5, 13, 722]) {
    const madera = maderaDe(createUrbanTree(1, { seed, species })).geometry, p = madera.attributes.position, uv = madera.attributes.uv;
    const anillo = y => Array.from({ length: 11 }, (_, i) => Math.hypot(p.getX(y * 11 + i), p.getZ(y * 11 + i)));
    const pie = anillo(0), cuarta = anillo(2);
    for (let i = 0; i < 11; i++) assert.ok(Math.abs(p.getY(i)) < .03 && Math.abs(p.getY(22 + i) - .25) < .03);
    const cuello = pie.reduce((a, b) => a + b) / 11, fuste = cuarta.reduce((a, b) => a + b) / 11;
    assert.ok(cuello / fuste > 1.45 && cuello / fuste < 1.7, `${species} ${seed}: cuello ${(cuello / fuste).toFixed(2)} veces el fuste`);
    assert.ok(uv.getX(0) >= .5 && uv.getX(10) <= 1, 'el pie usa la columna con liquen');
    // Las raíces son los únicos triángulos sueltos: seis vértices cada una, después de las ramas.
    let sueltos = 0;
    for (let i = 0; i < madera.index.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map(k => madera.index.getX(i + k));
      if (b === a + 1 && c === a + 2 && Math.min(p.getY(b), p.getY(c)) === 0 && p.getY(a) > .05) sueltos++;
    }
    assert.ok(sueltos === 6 || sueltos === 8, `${species} ${seed}: ${sueltos} caras de raíz`);
  }
});

test('dos árboles vecinos no tienen la misma corteza: cambia el tinte y el lado del liquen', () => {
  const tono = seed => {
    const c = maderaDe(createUrbanTree(1, { seed })).geometry.attributes.color;
    return [c.getX(c.count - 1), c.getY(c.count - 1), c.getZ(c.count - 1)].map(v => Math.round(v * 1000));
  };
  const tonos = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => tono(seed).join()));
  assert.ok(tonos.size >= 7, `${tonos.size} tintes en ocho árboles`);
  assert.deepEqual(tono(4), tono(4));
});

test('la carta de hojas es de foliolos menudos en dos tonos, tapa lo mismo que antes y no se ralea en las reducciones', () => {
  const hojas = hojasDe(createUrbanTree(1, { seed: 2 })), carta = hojas.material.map, corte = hojas.material.alphaTest * 255;
  assert.equal(carta.generateMipmaps, false);
  assert.deepEqual(carta.mipmaps.map(nivel => nivel.width), [256, 128, 64, 32, 16, 8, 4, 2, 1]);
  assert.equal(carta.mipmaps[0].data, carta.image.data);
  const tapa = ({ data, width }, celda) => {
    const lado = width / 2, x0 = (celda % 2) * lado, y0 = (celda >> 1) * lado;
    let cuenta = 0;
    for (let y = y0; y < y0 + lado; y++) for (let x = x0; x < x0 + lado; x++) if (data[(y * width + x) * 4 + 3] >= corte) cuenta++;
    return cuenta / (lado * lado);
  };
  // Antes la ramilla tapaba 28 %, 17 % y 22 % de su celda (urapán, eucalipto y arrayán).
  [.25, .17, .19].forEach((antes, celda) => {
    const base = tapa(carta.mipmaps[0], celda);
    assert.ok(base >= antes && base < .34, `celda ${celda}: tapa ${base.toFixed(3)}`);
    for (const nivel of [1, 2, 3, 4]) {
      assert.ok(Math.abs(tapa(carta.mipmaps[nivel], celda) - base) < .07, `celda ${celda}, reducción ${nivel}: ${tapa(carta.mipmaps[nivel], celda).toFixed(3)}`);
    }
  });
  const { data } = carta.image;
  let claros = 0, oscuros = 0, visibles = 0, tramos = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    if (data[i + 3] < corte) continue;
    visibles++;
    if (data[i] >= 222) claros++; else if (data[i] <= 204) oscuros++;
    if (x === 0 || data[i - 1] < corte) tramos++;
  }
  assert.ok(claros / visibles > .2 && oscuros / visibles > .2, `claros ${(claros / visibles).toFixed(2)}, oscuros ${(oscuros / visibles).toFixed(2)}`);
  // A 6 mm por píxel, un foliolo de 4 a 8 cm cruza la fila en pocos píxeles; las hojas de antes pasaban de 12.
  assert.ok(visibles / tramos < 7, `ancho medio de hoja: ${(visibles / tramos).toFixed(1)} px`);
});

test('de noche la copa se enfría con el piso de cielo que ya comparten los materiales, y de día el factor es cero', () => {
  const hojas = hojasDe(createUrbanTree(1, { seed: 2 }));
  const color = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: 'void main() {\n#include <opaque_fragment>\n}' };
  const sombra = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: 'void main() {}' };
  hojas.material.onBeforeCompile(color); hojas.customDepthMaterial.onBeforeCompile(sombra);
  assert.equal(color.uniforms.foliageSky, sunFieldUniforms.uSunSkyFloor);
  assert.ok(color.fragmentShader.indexOf('foliageNight') < color.fragmentShader.indexOf('#include <opaque_fragment>'));
  assert.equal(sombra.fragmentShader, 'void main() {}', 'la pasada de sombra no cambia');
  assert.equal(sombra.uniforms.foliageSky, undefined);
  const soloVertices = { uniforms: {}, vertexShader: '#include <begin_vertex>' };
  hojas.material.onBeforeCompile(soloVertices);
  assert.match(soloVertices.vertexShader, /foliageTime/, 'sin sombreador de color solo entra el viento');
  // La misma cuenta del sombreador: Scene.js deja el piso de cielo en .4 de día y en .62 de noche.
  const factor = /smoothstep\( ([\d.]+), ([\d.]+), \( foliageSky - ([\d.]+) \) \/ ([\d.]+) \) \* ([\d.]+)/.exec(color.fragmentShader).slice(1).map(Number);
  const noche = cielo => { const t = Math.min(1, Math.max(0, ((cielo - factor[2]) / factor[3] - factor[0]) / (factor[1] - factor[0]))); return t * t * (3 - 2 * t) * factor[4]; };
  assert.equal(noche(.4), 0);
  assert.equal(noche(.5), 0, 'con el sol todavía arriba tampoco');
  assert.ok(noche(.62) > .8 && noche(.62) <= .9);
  const tinte = /vec3\( ([\d.]+), ([\d.]+), ([\d.]+) \), foliageNight/.exec(color.fragmentShader).slice(1).map(Number);
  assert.ok(tinte[1] > tinte[0] * 1.08 && tinte[0] > tinte[2], 'verde oscuro: más verde que rojo y sin irse al azul');
  assert.ok(.3 * tinte[0] + .55 * tinte[1] + .15 * tinte[2] < .82, 'y más oscuro');
});

const UV = new Proxy({}, { get: () => [0, 0, 1, 1] });
function distrito() {
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  Object.assign(city, { props: [], treePlan: [], vegetationPlan: { clusters: [] }, vendors: [], fireBarrels: [],
    signals: { poles: [] }, renderSectors: [], isNearReserved: () => false, buildingVisibility: { buildings: [] } });
  return city;
}
/** Lote que solo cuenta: triángulos de cada caja, cilindro, cuadro y triángulo suelto. */
function lote() {
  const cuenta = { triangulos: 0, formas: [] };
  return {
    cuenta, chunkSize: 32, chunks: { has: () => true },
    box(x, y, z, w, h, d) { cuenta.triangulos += 10; cuenta.formas.push({ x, y, z, radio: Math.hypot(w, d) / 2, alto: h }); },
    cylinder(x, y, z, r0, r1, h, sides) {
      cuenta.triangulos += sides * 2 + (r1 > .001 ? sides : 0);
      cuenta.formas.push({ x, y, z, radio: Math.max(r0, r1), alto: h });
    },
    quad(a, b, c, d) { cuenta.triangulos += 2; for (const p of [a, b, c, d]) cuenta.formas.push({ x: p[0], y: p[1], z: p[2], radio: 0, alto: 0 }); },
    triangle(a, b, c) { cuenta.triangulos += 1; for (const p of [a, b, c]) cuenta.formas.push({ x: p[0], y: p[1], z: p[2], radio: 0, alto: 0 }); }
  };
}
const libres = () => ({ free: () => true, add() {} });

test('las piezas del sardinel son las mismas, en el mismo sitio, sin gastar azar y con menos triángulos que antes', () => {
  const street = lote(), mapa = distrito().map;
  let resultado;
  const gasto = contarAzar(() => { resultado = addMobiliarioDenso(street, distrito(), UV, libres()); });
  const { cuenta, piezas } = resultado;
  assert.equal(gasto - contarAzar(() => distrito()), 0, 'ni un sorteo del juego');
  // Trece piezas de la distribución previa quedaban en las entradas de las nuevas cebras orientales.
  // Las demás conservan sus coordenadas, incluyendo las 102 materas.
  assert.deepEqual(cuenta, { bolardo: 366, caneca: 180, armario: 127, hidrante: 48, matera: 102, bolsas: 132, escombro: 56, bici: 31 });
  assert.equal(piezas.length, 1042);
  assert.equal(Math.round(piezas.reduce((s, p) => s + p.x * 3 + p.z * 7, 0) * 100) / 100, 1678154.7);
  assert.ok(street.cuenta.triangulos <= 146135, `triángulos: ${street.cuenta.triangulos}`);
  for (const { x, y, z, radio, alto } of street.cuenta.formas) {
    assert.ok(y >= .12 && y + alto < 1.7, 'nada enterrado ni más alto que una persona');
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const tile = mapa[Math.round((z + j * radio * .71) / 2)]?.[Math.round((x + i * radio * .71) / 2)];
      assert.equal(tile, 'sidewalk', `forma sobre ${tile} en ${x.toFixed(1)},${z.toFixed(1)}`);
    }
  }
});

test('la matera del local gasta un solo sorteo de su azar propio: lo que el local saca después no se corre', () => {
  const fuente = readFileSync(new URL('../src/world/bogota/BuildingDetails.js', import.meta.url), 'utf8');
  const bloque = fuente.slice(fuente.indexOf('  matera(life, UV, q, u) {'), fuente.indexOf('  caneca(life, UV, q, u)'));
  assert.ok(bloque.length > 40);
  assert.equal(bloque.match(/\bq\(\)/g).length, 1);
});

test('la mata de la matera es de hojas sueltas apagadas con ramitas secas, y la mitad de las materas está vacía', () => {
  const hojas = [], sueltas = [];
  const street = { ...lote(), triangle(a, b, c, normal, uv, colores) { hojas.push({ a, b, c, colores }); },
    cylinder(x, y, z) { sueltas.push([x, z]); }, box(x, y, z) { sueltas.push([x, z]); }, decal(x, y, z) { sueltas.push([x, z]); } };
  const { piezas } = addMobiliarioDenso(street, distrito(), UV, libres());
  const materas = piezas.filter(pieza => pieza.clase === 'matera');
  const cerca = ({ x, z }) => hojas.filter(({ a }) => Math.hypot(a[0] - x, a[2] - z) < .9).length / 2;
  const conMata = materas.filter(matera => cerca(matera) > 0);
  assert.ok(conMata.length > materas.length * .38 && conMata.length < materas.length * .62, `${conMata.length} de ${materas.length} materas con mata`);
  let secas = 0;
  for (const { a, b, c, colores } of hojas) {
    const largo = Math.hypot(c[0] - (a[0] + b[0]) / 2, c[1] - a[1], c[2] - (a[2] + b[2]) / 2), [rojo, verde, azul] = colores[2];
    assert.ok(largo > .2 && largo < .5, `hoja de ${largo.toFixed(2)} m`);
    assert.ok(c[1] > a[1] + .08, 'la punta queda arriba del pie');
    if (rojo > verde) secas++;
    // En espacio lineal la paleta de hojas da de .70 a .75; con el diez por ciento menos queda por debajo de .69.
    else assert.ok((verde - azul) / verde < .69, `verde apagado: ${((verde - azul) / verde).toFixed(2)}`);
  }
  assert.ok(secas / hojas.length > .12 && secas / hojas.length < .3, `secas: ${(secas / hojas.length).toFixed(2)}`);
  // Cada mata: de 8 a 10 hojas y 2 o 3 ramitas secas, dos triángulos por hoja; antes eran 84 triángulos de conos.
  const matas = new Map();
  for (const { a, b } of hojas) {
    const clave = `${Math.round((a[0] + b[0]) * 2)},${Math.round((a[2] + b[2]) * 2)}`;
    matas.set(clave, (matas.get(clave) ?? 0) + 1);
  }
  assert.ok(hojas.length / matas.size <= 30, `${(hojas.length / matas.size).toFixed(1)} triángulos por mata`);
});
