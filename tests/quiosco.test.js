import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildShopGeometry } from '../src/entities/shopModel.js';
import { Shop } from '../src/entities/Shop.js';

// Los letreros se pintan en un lienzo: en Node basta uno que acepte cualquier llamada.
const paintedText = new WeakMap();
globalThis.document ??= { createElement() {
  const words = [];
  const pencil = new Proxy({ fillText(text) { words.push(text); } }, { get: (target, key) => target[key] ?? (() => {}), set: () => true });
  const canvas = { width: 0, height: 0, getContext: () => pencil };
  paintedText.set(canvas, words);
  return canvas;
} };

const contarAzar = crear => {
  const original = Math.random;
  let veces = 0;
  Math.random = () => { veces++; return original(); };
  try { return [crear(), veces]; } finally { Math.random = original; }
};

test('armar La Esquinita gasta el mismo azar de siempre', t => {
  const [, enLaCaseta] = contarAzar(() => buildShopGeometry());
  assert.equal(enLaCaseta, 4);
  const [shop, enLaTienda] = contarAzar(() => new Shop(new THREE.Scene(), new THREE.Vector3()));
  t.after(() => shop.dispose());
  assert.equal(enLaTienda, 88);
});

test('La Esquinita sigue en su sitio, con su caja de choque, su letrero y sus mallas', t => {
  const juego = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.match(juego, /this\.collisions\.add\(\s*this\.shop\.group,\s*new THREE\.Vector3\(2\.4, 2, 1\.5\),\s*new THREE\.Vector3\(0, 1, -0\.7\)\s*\)/);
  assert.match(juego, /district\.reserved\?\.shop\?\.x \?\? 24, 0,\s*district\.reserved\?\.shop\?\.z \?\? 28/);
  const shop = new Shop(new THREE.Scene(), new THREE.Vector3());
  t.after(() => shop.dispose());
  const sign = shop.group.children.find(item => paintedText.get(item.material?.map?.image)?.includes('LA ESQUINITA'));
  assert.ok(sign, 'el letrero sobre el techo se pinta en la caseta');
  assert.deepEqual(paintedText.get(sign.material.map.image), ['LA ESQUINITA', 'TIENDA · MISCELÁNEA']);
  assert.deepEqual([sign.geometry.parameters.width, sign.geometry.parameters.height, ...sign.position.toArray()], [2.6, .65, 0, 3.14, -.04]);
  let mallas = 0, luces = 0;
  shop.group.traverse(o => { if (o.isMesh) mallas++; if (o.isLight) luces++; });
  assert.equal(mallas, 4);
  assert.equal(luces, 1);
  // La caseta no crece: nada sale de la caja que tenía.
  const geometry = buildShopGeometry();
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const antes = { min: [-1.3707, 0, -1.53], max: [1.3717, 3.49, 1.1001] };
  min.toArray().forEach((v, i) => assert.ok(v >= antes.min[i] - 1e-3, `mínimo ${i}: ${v}`));
  max.toArray().forEach((v, i) => assert.ok(v <= antes.max[i] + 1e-3, `máximo ${i}: ${v}`));
  // A lo sumo un 10 % más de triángulos que los 4944 de antes.
  assert.ok(geometry.index.count / 3 <= 5438, `${geometry.index.count / 3} triángulos`);
});

test('lo que brilla de noche en La Esquinita queda igual', () => {
  const geometry = buildShopGeometry();
  const pos = geometry.attributes.position, col = geometry.attributes.color;
  const porBrillo = new Map();
  for (let i = 0; i < pos.count; i++) {
    const brillo = +col.getW(i).toFixed(3);
    if (brillo <= 0) continue;
    const suma = porBrillo.get(brillo) ?? { n: 0, p: [0, 0, 0], c: [0, 0, 0] };
    suma.n++;
    [pos.getX(i), pos.getY(i), pos.getZ(i)].forEach((v, k) => { suma.p[k] += v; });
    [col.getX(i), col.getY(i), col.getZ(i)].forEach((v, k) => { suma.c[k] += v; });
    porBrillo.set(brillo, suma);
  }
  // Brillo: [vértices, suma de posiciones, suma de colores (solo donde el color no puede cambiar)].
  const esperado = {
    .35: [144, [-105.491, 187.920, -26.539]],
    .42: [4, [0, 6.960, -5.260]],
    .5: [3066, [540.972, 5732.749, -3617.655]],
    .55: [4, [0.002, 10.039, 2.191], [2.800, 1.617, 0.335]],
    .85: [4, [3.160, 4.400, -0.044], [2.690, 3.420, 3.652]],
    .9: [168, [132.720, 193.360, -0.504], [112.297, 88.623, 65.394]],
    1.7: [105, [0.350, 230.632, 110.260], [105.000, 60.646, 12.552]],
    3: [24, [-7.200, 62.640, -16.800], [24.000, 21.510, 16.139]]
  };
  assert.deepEqual([...porBrillo.keys()].sort((a, b) => a - b), Object.keys(esperado).map(Number).sort((a, b) => a - b));
  for (const [brillo, [n, p, c]] of Object.entries(esperado)) {
    const suma = porBrillo.get(Number(brillo));
    assert.equal(suma.n, n, `vértices con brillo ${brillo}`);
    p.forEach((v, k) => assert.ok(Math.abs(suma.p[k] - v) < 2e-3, `posición ${k} con brillo ${brillo}: ${suma.p[k]}`));
    c?.forEach((v, k) => assert.ok(Math.abs(suma.c[k] - v) < 2e-3, `color ${k} con brillo ${brillo}: ${suma.c[k]}`));
  }
});

// Color de cada vértice en sRGB (matiz, saturación y luz) con su posición, sin lo que brilla.
const verticesApagados = geometry => {
  const pos = geometry.attributes.position, col = geometry.attributes.color, list = [];
  const hsl = { h: 0, s: 0, l: 0 }, color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    if (col.getW(i) > 0) continue;
    color.setRGB(col.getX(i), col.getY(i), col.getZ(i)).getHSL(hsl, THREE.SRGBColorSpace);
    list.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), ...hsl, clave: [col.getX(i), col.getY(i), col.getZ(i)].map(v => v.toFixed(3)).join() });
  }
  return list;
};

test('el toldo es lona vieja: apagado, manchado y con la cenefa raída', () => {
  const toldo = verticesApagados(buildShopGeometry()).filter(v => v.y > 2.1 && v.z > .25 && v.l > .2);
  assert.ok(toldo.length > 300, `${toldo.length} vértices`);
  // Azul pizarra y blanco hueso: nada pasa de 0,42 de saturación (antes, 0,58 el azul y 0,41 el crema).
  const masVivo = Math.max(...toldo.map(v => v.s));
  assert.ok(masVivo <= .42, `saturación ${masVivo.toFixed(3)}`);
  // Velo de sol, parche, manchas y mugre: muchos tonos, no dos.
  assert.ok(new Set(toldo.map(v => v.clave)).size >= 60, `${new Set(toldo.map(v => v.clave)).size} tonos`);
  // Arriba, junto a la pared, la lona azul está más lavada que en el borde.
  const azul = toldo.filter(v => v.h > .5 && v.h < .7 && v.s > .08);
  const arriba = azul.filter(v => v.y > 2.62), abajo = azul.filter(v => v.y < 2.45 && v.y > 2.36);
  const media = list => list.reduce((sum, v) => sum + v.s, 0) / list.length;
  assert.ok(arriba.length && abajo.length && media(arriba) < media(abajo) - .04, `${media(arriba)} contra ${media(abajo)}`);
  // La cenefa no termina en una línea recta de puntas iguales.
  const puntas = verticesApagados(buildShopGeometry()).filter(v => v.y < 2.3 && v.y > 2.1 && v.z > .9);
  const alturas = [...new Set(puntas.map(v => v.y.toFixed(3)))];
  assert.ok(alturas.length >= 8, `${alturas.length} alturas de borde`);
});

test('canastas caladas y empolvadas, silla sucia y mesa apagada', () => {
  const todo = verticesApagados(buildShopGeometry());
  const geometry = buildShopGeometry(), normal = geometry.attributes.normal;
  // Las canastas van del suelo a 1,1 m en la esquina izquierda del frente (sin las botellas de encima ni la fruta).
  const canastas = todo.filter(v => v.z > .17 && v.y > .1 && ((v.x < -.83 && v.x > -1.22 && v.y < 1.095) ||
    (v.x >= -.83 && v.x < -.45 && v.z > .27 && v.y < .61)));
  assert.ok(canastas.length > 400, `${canastas.length} vértices`);
  const vivo = Math.max(...canastas.map(v => v.s));
  assert.ok(vivo <= .6, `saturación de las canastas ${vivo.toFixed(3)}`);
  // Huecos oscuros en el frente: seis canastas, cuatro hileras cada una.
  let huecos = 0;
  const pos = geometry.attributes.position, col = geometry.attributes.color, hsl = { h: 0, s: 0, l: 0 }, color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    if (pos.getX(i) > -.45 || pos.getZ(i) < .55 || pos.getY(i) > 1.095 || normal.getZ(i) < .9) continue;
    color.setRGB(col.getX(i), col.getY(i), col.getZ(i)).getHSL(hsl, THREE.SRGBColorSpace);
    if (hsl.l < .3) huecos++;
  }
  assert.ok(huecos >= 80, `${huecos} vértices de hueco`);
  // Polvo en la base: abajo, la canasta del suelo es más gris que a media altura.
  const media = list => list.reduce((sum, v) => sum + v.s, 0) / list.length;
  const base = canastas.filter(v => v.y < .14 && v.l > .2), mitad = canastas.filter(v => v.y > .25 && v.y < .33 && v.l > .2);
  assert.ok(media(base) < media(mitad) - .05, `${media(base)} contra ${media(mitad)}`);
  // La silla ya no es blanca de estreno y el asiento tiene mugre gris.
  const silla = todo.filter(v => v.x > .7 && v.x < 1.2 && v.z > .25 && v.z < .76 && v.y > .1 && v.y < 1.1);
  assert.ok(silla.length > 100);
  assert.ok(Math.max(...silla.map(v => v.l)) <= .84, `luz de la silla ${Math.max(...silla.map(v => v.l))}`);
  const asiento = silla.filter(v => Math.abs(v.y - (.12 + .42 + .0175)) < .002);
  assert.ok(Math.min(...asiento.map(v => v.l)) < .66, `asiento ${Math.min(...asiento.map(v => v.l))}`);
  // La mesa en rojo quemado.
  const mesa = todo.filter(v => v.x > .35 && v.x < .73 && v.z > .34 && v.z < .72 && v.y > .13 && v.y < .59 && v.s > .3);
  assert.ok(mesa.length > 50);
  assert.ok(Math.max(...mesa.map(v => v.s)) <= .52, `saturación de la mesa ${Math.max(...mesa.map(v => v.s))}`);
});

test('mostrador, muros, fruta y mercancía sin colores de juguete', () => {
  const geometry = buildShopGeometry(), pos = geometry.attributes.position, col = geometry.attributes.color;
  const color = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
  let apagado = 0, estante = 0;
  for (let i = 0; i < pos.count; i++) {
    const brillo = col.getW(i);
    if (brillo !== 0 && brillo !== .5) continue;
    color.setRGB(col.getX(i), col.getY(i), col.getZ(i)).getHSL(hsl, THREE.SRGBColorSpace);
    if (brillo === 0) apagado = Math.max(apagado, hsl.s); else estante = Math.max(estante, hsl.s);
  }
  // Antes: 0,85 lo de afuera (las canastas amarillas) y 0,80 la mercancía de la estantería.
  assert.ok(apagado <= .65, `saturación de lo apagado ${apagado.toFixed(3)}`);
  assert.ok(estante <= .55, `saturación de la estantería ${estante.toFixed(3)}`);
  // El frente del mostrador: barro abajo, más limpio a media altura, y ningún tramo igual a otro.
  const frente = verticesApagados(geometry).filter(v => Math.abs(v.z - .01) < .002 && v.x > -1.11 && v.x < .43 && v.y < .95);
  const abajo = frente.filter(v => v.y < .25), medio = frente.filter(v => Math.abs(v.y - .69) < .01);
  const luz = list => list.reduce((sum, v) => sum + v.l, 0) / list.length;
  assert.ok(abajo.length >= 6 && medio.length >= 6);
  assert.ok(luz(abajo) < luz(medio) - .12, `${luz(abajo)} contra ${luz(medio)}`);
  assert.ok(new Set(abajo.map(v => v.clave)).size >= 5);
});

test('la sombrilla naranja y azul de la calle va en los tonos gastados del toldo', () => {
  const ventas = readFileSync(new URL('../src/world/bogota/ventasCalle.js', import.meta.url), 'utf8');
  const lonas = ventas.slice(ventas.indexOf('const LONAS = ['), ventas.indexOf('];', ventas.indexOf('const LONAS = [')));
  const vistos = new Set(lonas.match(/#[0-9a-f]{6}/g));
  assert.equal(vistos.size, 6);
  assert.ok(lonas.includes("['#a66a42', '#406382']"), lonas);
  assert.ok(!vistos.has('#33689f') && !vistos.has('#b87a3e'), [...vistos].join());
});
