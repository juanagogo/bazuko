import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Bogota, CollisionSystem } from './helpers/traffic-world.js';

const { planCulatas, planPilares, agregarCulatas } = await import('../src/world/bogota/Culatas.js');
const { PIEZAS, TEXTOS, ANCHO, ALTO, uvDe } = await import('../src/world/bogota/culatasAtlas.js');

const lote = (x0, x1, z0, z1, alto, ciegas = [0, 1, 4, 5]) => ({ x0, x1, z0, z1, alto, ciegas });

test('una medianera sobre el vecino más bajo se pinta por encima de su techo', () => {
  // Veinte parejas de casa alta y vecina baja, separadas entre sí: el sorteo pinta algunas.
  const cuadra = Array.from({ length: 20 }, (_, i) => [lote(0, 8, i * 40, i * 40 + 10, 15, [0]), lote(8, 16, i * 40, i * 40 + 10, 6, [])]).flat();
  const piezas = planCulatas(cuadra);
  assert.ok(piezas.length >= 4 && piezas.length <= 16, `piezas: ${piezas.length}`);
  for (const pieza of piezas) {
    assert.equal(pieza.cara, 0);
    assert.ok(pieza.x > 8 && pieza.x < 8.05, 'va a dos centímetros del muro');
    assert.ok(pieza.y - pieza.alto / 2 >= 6.3, 'no baja del techo del vecino');
    assert.ok(pieza.y + pieza.alto / 2 <= 15 - .4, 'no pasa del remate');
    assert.ok(pieza.z - pieza.ancho / 2 >= pieza.lote.z0 && pieza.z + pieza.ancho / 2 <= pieza.lote.z1, 'cabe en el muro');
  }
});

test('no se pinta la fachada, ni un muro tapado, ni contra algo construido', () => {
  assert.deepEqual(planCulatas([lote(0, 8, 0, 10, 15, [])]), []);
  assert.deepEqual(planCulatas([lote(0, 8, 0, 10, 9, [0]), lote(8, 16, 0, 10, 9, [])]), [], 'vecino de la misma altura');
  assert.deepEqual(planCulatas([lote(0, 8, 0, 10, 15, [0])], () => true), [], 'pegado a un edificio que no es casa');
  assert.deepEqual(planCulatas([lote(0, 8, 0, 10, 15, [0]), lote(9.5, 16, 0, 10, 15, [])]), [], 'callejón sin vista');
});

test('un muro grande que da a un patio siempre lleva una pieza, y el plan no cambia entre corridas', () => {
  const patio = [lote(0, 6, 0, 12, 9, [0]), lote(20, 26, 30, 44, 12, [1])];
  const piezas = planCulatas(patio);
  for (const casa of patio) assert.ok(piezas.some((pieza) => pieza.lote === casa && PIEZAS[pieza.nombre].tipo !== 'firmas'));
  for (const pieza of piezas) assert.ok(pieza.y - pieza.alto / 2 >= 1, 'el zócalo queda libre');
  assert.deepEqual(planCulatas(patio).map(({ lote: _, ...resto }) => resto), piezas.map(({ lote: _, ...resto }) => resto));
});

test('los pilares llevan carteles en dos caras opuestas', () => {
  const pilares = Array.from({ length: 12 }, (_, i) => ({ x: 40, z: 50 + i * 14, lado: 1.3, base: 0 }));
  const piezas = planPilares(pilares);
  assert.ok(piezas.length >= 12 && piezas.length % 2 === 0);
  for (let i = 0; i < piezas.length; i += 2) {
    assert.equal(piezas[i].nx + piezas[i + 1].nx, 0);
    assert.equal(piezas[i].nz + piezas[i + 1].nz, 0);
    assert.equal(Math.abs(piezas[i].nx) + Math.abs(piezas[i].nz), 1);
    assert.ok(piezas[i].ancho < 1.3 && piezas[i].y - piezas[i].alto / 2 > .3);
  }
  assert.deepEqual(planPilares([{ x: 40, z: 50, lado: 1.3, base: -3 }]), [], 'el pilar hundido en el lago no lleva');
});

test('la carta no se pisa y no escribe marcas ni teléfonos', () => {
  const celdas = Object.values(PIEZAS).map(({ celda }) => celda);
  for (const [x, y, w, h] of celdas) assert.ok(x >= 0 && y >= 0 && x + w <= ANCHO && y + h <= ALTO);
  celdas.forEach((a, i) => celdas.slice(i + 1).forEach((b) => {
    assert.ok(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1], 'dos celdas se pisan');
  }));
  const [u0, v0, u1, v1] = uvDe('carteles');
  assert.ok(u0 < u1 && v0 < v1 && u1 <= 1 && v1 <= 1);
  const escrito = Object.values(TEXTOS).flat(2).join(' ');
  assert.doesNotMatch(escrito, /\d/, 'sin teléfonos');
  assert.doesNotMatch(escrito, /coca|pepsi|bavaria|postob|claro|movistar|éxito|exito|ara\b|d1\b/i);
});

test('en la ciudad: culatas pintadas sin gastar el azar del juego, lejos de las fachadas y recogidas con su pared', () => {
  const city = new Bogota();
  city.build(new THREE.Scene(), new CollisionSystem());
  const raices = [];
  city.group.traverse((o) => { if (o.name === 'Culatas') raices.push(o); });
  assert.equal(raices.length, 1);
  const [raiz] = raices, piezas = raiz.userData.piezas;
  assert.ok(city.animated.includes(raiz), 'sigue a sus paredes cada cuadro');
  const enMuros = piezas.filter((pieza) => pieza.lote), enPilares = piezas.filter((pieza) => !pieza.lote);
  assert.ok(enMuros.length >= 25 && enMuros.length <= 220, `piezas en muros: ${enMuros.length}`);
  assert.ok(enPilares.length >= 4, `carteles en pilares: ${enPilares.length}`);
  assert.ok(new Set(enMuros.map((pieza) => pieza.nombre)).size >= 6, 'hay variedad');
  for (const pieza of enMuros) {
    const pared = pieza.lote.edificio.walls.get(pieza.cara);
    assert.equal(pared.children.length, 1, 'el muro no tiene ventanas ni avisos');
    assert.ok(pieza.parte && pieza.parte.object === pared, 'cada pieza conoce su pared');
    assert.ok(pieza.y + pieza.alto / 2 < pieza.lote.alto);
  }
  const triangulos = raiz.children.reduce((n, malla) => n + malla.geometry.index.count / 3, 0);
  assert.equal(triangulos, piezas.length * 2);
  assert.ok(raiz.children.length <= 40, `mallas: ${raiz.children.length}`);
  // La pared se atenúa: la pieza se recoge en un punto; vuelve la pared y vuelve la pieza.
  const malla = raiz.children.find((m) => m.userData.piezas.some((pieza) => pieza.parte));
  const i = malla.userData.piezas.findIndex((pieza) => pieza.parte), pieza = malla.userData.piezas[i];
  const posicion = malla.geometry.attributes.position, antes = Array.from(posicion.array.slice(i * 12, i * 12 + 12));
  pieza.parte.opacity = 0;
  raiz.userData.update(0, 0);
  const recogida = Array.from(posicion.array.slice(i * 12, i * 12 + 12));
  for (let k = 3; k < 12; k++) assert.equal(recogida[k], recogida[k % 3]);
  pieza.parte.opacity = 1;
  raiz.userData.update(0, 0);
  assert.deepEqual(Array.from(posicion.array.slice(i * 12, i * 12 + 12)), antes);
  // Volver a pintar no toca el azar del juego.
  const otra = { group: new THREE.Group(), animated: [], map: city.map, buildingVisibility: city.buildingVisibility };
  const delJuego = Math.random;
  let sorteos = 0;
  Math.random = () => { sorteos++; return delJuego(); };
  try { agregarCulatas(otra); }
  finally { Math.random = delJuego; }
  assert.equal(sorteos, 0);
  console.log(`culatas: ${enMuros.length} en muros, ${enPilares.length} en pilares, ${raiz.children.length} mallas`,
    Object.fromEntries([...new Set(piezas.map((p) => p.nombre))].map((n) => [n, piezas.filter((p) => p.nombre === n).length])));
});
