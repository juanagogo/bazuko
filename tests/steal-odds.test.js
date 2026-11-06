// tests/steal-odds.test.js
// Por dónde se le llega a alguien, lo que se nota, lo que dice el aviso y lo que carga cada quien.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { ROBO_ODDS, ventajaDeRobo, probabilidadDeAviso, avisoDeRobo, BOTIN_POR_ARQUETIPO, botinDe, esDeLosSuyos, manoMult, zonaDeCosquilleo } from '../src/features/stealOdds.js';
import { ITEMS } from '../src/data/items.js';
import { piezasDelPrompt, piezasParaElDedo } from '../src/ui/HUD.js';

const victim = (extra = {}) => ({ position: new THREE.Vector3(), root: { rotation: { y: 0 } }, ...extra });

test('de espaldas, de frente o de lado según hacia dónde mira la víctima', () => {
  assert.equal(ventajaDeRobo(new THREE.Vector3(0, 0, -1), victim()).posicion, 'espalda');
  assert.equal(ventajaDeRobo(new THREE.Vector3(0, 0, 1), victim()).posicion, 'frente');
  assert.equal(ventajaDeRobo(new THREE.Vector3(1, 0, 0), victim()).posicion, 'lado');
  assert.equal(ventajaDeRobo(new THREE.Vector3(1, 0, 0), { position: new THREE.Vector3() }).posicion, 'lado', 'sin raíz cuenta como de lado');
  // Mirando hacia +X, quien está en -X le queda a la espalda.
  assert.equal(ventajaDeRobo(new THREE.Vector3(-1, 0, 0), victim({ root: { rotation: { y: Math.PI / 2 } } })).posicion, 'espalda');
});

test('la zona y el aviso cambian con la posición, la distracción y la carrera', () => {
  const espalda = ventajaDeRobo(new THREE.Vector3(0, 0, -1), victim());
  assert.equal(espalda.zonaMult, ROBO_ODDS.espalda.zona);
  assert.equal(espalda.avisoExtra, ROBO_ODDS.espalda.aviso);
  assert.equal(espalda.marcadorMult, ROBO_ODDS.espalda.marcador);
  const frente = ventajaDeRobo(new THREE.Vector3(0, 0, 1), victim());
  assert.ok(frente.zonaMult < 1 && frente.avisoExtra > 0);
  assert.equal(ventajaDeRobo(new THREE.Vector3(1, 0, 0), victim({ moving: true })).distraida, true, 'andando va en lo suyo');
  assert.equal(ventajaDeRobo(new THREE.Vector3(1, 0, 0), victim({ witnessing: 'grabar' })).distraida, true, 'grabando también');
  const corriendo = ventajaDeRobo(new THREE.Vector3(1, 0, 0), victim(), { playerSpeed: 4 });
  assert.equal(corriendo.corriendo, true);
  assert.equal(corriendo.zonaMult, ROBO_ODDS.corriendo.zona);
});

test('la mano que roba es la del lado donde queda la víctima', () => {
  // Jugador mirando a +Z: su izquierda es +X.
  assert.equal(ventajaDeRobo(new THREE.Vector3(), victim({ position: new THREE.Vector3(1, 0, .3) }), { playerYaw: 0 }).lado, -1);
  assert.equal(ventajaDeRobo(new THREE.Vector3(), victim({ position: new THREE.Vector3(-1, 0, .3) }), { playerYaw: 0 }).lado, 1);
  assert.equal(ventajaDeRobo(new THREE.Vector3(), victim({ position: new THREE.Vector3(0, 0, 1) }), { playerYaw: 0 }).lado, 1, 'al frente, la derecha');
});

test('«Mano suave» por fin cuenta en el cosquilleo, con piso y techo', () => {
  const base = { alerta: .6, ventaja: { posicion: 'lado', avisoExtra: 0 } };
  const sin = probabilidadDeAviso(base), con = probabilidadDeAviso({ ...base, talento: .8 });
  assert.ok(Math.abs(con - sin * .8) < 1e-9, `${con} = ${sin} × 0,8`);
  assert.equal(probabilidadDeAviso({ alerta: 0, ventaja: { posicion: 'espalda', avisoExtra: -.2 } }), ROBO_ODDS.avisoMinEspalda);
  assert.equal(probabilidadDeAviso({ alerta: 0, ventaja: { posicion: 'lado', avisoExtra: -.2 } }), ROBO_ODDS.avisoMin);
  assert.equal(probabilidadDeAviso({ alerta: 1, fama: .3, franja: .2, ventaja: { posicion: 'frente', avisoExtra: .2 } }), ROBO_ODDS.avisoMax);
  assert.ok(probabilidadDeAviso({ alerta: .6, perro: .3 }) < probabilidadDeAviso({ alerta: .6 }), 'El Chato distrae');
});

test('el aviso empieza por el cosquilleo, termina en la Q y con el dedo deja solo las teclas', () => {
  for (const posicion of ['espalda', 'frente', 'lado']) {
    for (const distraida of [false, true]) {
      const texto = avisoDeRobo({ posicion, distraida });
      assert.match(texto, /^\[E\] Cosquilleo/);
      assert.match(texto, /\[Q\] Robo directo$/);
      const piezas = piezasDelPrompt(texto);
      assert.deepEqual(piezasParaElDedo(piezas).map(p => p.tecla), ['E', 'Q'], texto);
    }
  }
  assert.match(avisoDeRobo({ posicion: 'espalda' }), /de espaldas/);
  assert.match(avisoDeRobo({ posicion: 'frente' }), /me está viendo/);
  assert.match(avisoDeRobo({ posicion: 'lado', distraida: true }), /va en lo suyo/);
});

test('cada quien carga lo suyo: el habitante de calle casi nada, y todo existe en el costal', () => {
  assert.ok(botinDe({ person: { arquetipo: 'habitante' } }).plata < botinDe({ person: { arquetipo: 'oficinista' } }).plata);
  for (const [id, b] of Object.entries(BOTIN_POR_ARQUETIPO)) {
    assert.ok(b.plata > 0 && b.plata <= 1, id);
    for (const item of b.objetos) assert.ok(ITEMS[item], `${id}: ${item}`);
  }
  assert.deepEqual(botinDe({}, ['pan']), { plata: 1, objetos: ['pan'] }, 'sin arquetipo, lo de siempre');
  assert.equal(esDeLosSuyos({ person: { arquetipo: 'reciclador' } }), true);
  assert.equal(esDeLosSuyos({ person: { arquetipo: 'senora' } }), false);
});

test('la práctica agranda la zona hasta un 12 % y la zona respeta sus topes', () => {
  assert.equal(manoMult(0), 1);
  assert.equal(manoMult(5), 1.05);
  assert.equal(manoMult(50), 1.12);
  assert.equal(manoMult(NaN), 1);
  assert.equal(zonaDeCosquilleo(.3, { zonaMult: 10 }), ROBO_ODDS.zonaMax);
  assert.equal(zonaDeCosquilleo(.18, { zonaMult: .1 }), ROBO_ODDS.zonaMin);
});

test('el aviso de cada cuadro no crea objetos: la ventaja reusa el suyo y el texto es siempre el mismo', () => {
  const out = {};
  const a = ventajaDeRobo(new THREE.Vector3(0, 0, -1), victim(), { out });
  assert.equal(a, out);
  assert.equal(a.posicion, 'espalda');
  const b = ventajaDeRobo(new THREE.Vector3(0, 0, 1), victim(), { out });
  assert.equal(b, out, 'el mismo objeto');
  assert.equal(b.posicion, 'frente', 'con los datos nuevos');
  assert.notEqual(ventajaDeRobo(new THREE.Vector3(0, 0, 1), victim()), ventajaDeRobo(new THREE.Vector3(0, 0, 1), victim()), 'sin out, uno nuevo');
  for (const v of [{ posicion: 'espalda' }, { posicion: 'frente' }, { posicion: 'lado', distraida: true }, null]) {
    assert.equal(avisoDeRobo(v), avisoDeRobo(v ? { ...v } : null));
  }
});
