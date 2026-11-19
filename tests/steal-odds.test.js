// tests/steal-odds.test.js
// Por dónde se le llega a alguien, lo que se nota, lo que dice el aviso y lo que carga cada quien.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { ventajaDeRobo, probabilidadDeAviso, avisoDeRobo, BOTIN_POR_ARQUETIPO, botinDe, manoMult, zonaDeCosquilleo } from '../src/features/stealOdds.js';
import { ITEMS } from '../src/data/items.js';
import { piezasDelPrompt, piezasParaElDedo } from '../src/ui/HUD.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≈ ${b}`);
const victim = (extra = {}) => ({ position: new THREE.Vector3(), root: { rotation: { y: 0 } }, ...extra });

test('de espaldas, de frente o de lado según hacia dónde mira la víctima', () => {
  assert.equal(ventajaDeRobo(new THREE.Vector3(0, 0, -1), victim()).posicion, 'espalda');
  assert.equal(ventajaDeRobo(new THREE.Vector3(0, 0, 1), victim()).posicion, 'frente');
  assert.equal(ventajaDeRobo(new THREE.Vector3(1, 0, 0), victim()).posicion, 'lado');
  assert.equal(ventajaDeRobo(new THREE.Vector3(1, 0, 0), { position: new THREE.Vector3() }).posicion, 'lado', 'sin raíz cuenta como de lado');
  // Mirando hacia +X, quien está en -X le queda a la espalda.
  assert.equal(ventajaDeRobo(new THREE.Vector3(-1, 0, 0), victim({ root: { rotation: { y: Math.PI / 2 } } })).posicion, 'espalda');
  // El borde: coseno −0,4 ya es de espaldas; −0,3, de lado. Lo mismo de frente con 0,4 y 0,3.
  const desde = c => new THREE.Vector3(Math.sqrt(1 - c * c), 0, c);
  assert.equal(ventajaDeRobo(desde(-.4), victim()).posicion, 'espalda');
  assert.equal(ventajaDeRobo(desde(-.3), victim()).posicion, 'lado');
  assert.equal(ventajaDeRobo(desde(.4), victim()).posicion, 'frente');
  assert.equal(ventajaDeRobo(desde(.3), victim()).posicion, 'lado');
});

test('quien duerme o está acurrucado no ve a nadie: cuenta como de espaldas por cualquier lado', () => {
  for (const stance of ['dormido', 'acurrucado']) {
    for (const p of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)]) {
      const v = ventajaDeRobo(p, victim({ stance }));
      assert.equal(v.posicion, 'espalda', `${stance} desde ${p.toArray()}`);
      close(v.zonaMult, 1.35); close(v.avisoExtra, -.2);
      assert.match(avisoDeRobo(v), /de espaldas, ni me ve/);
    }
  }
  // Sentado, en la banca o pidiendo sí mira hacia donde tiene el cuerpo.
  for (const stance of ['sentado', 'banca', 'pedir']) assert.equal(ventajaDeRobo(new THREE.Vector3(0, 0, 1), victim({ stance })).posicion, 'frente', stance);
});

test('la zona y el aviso cambian con la posición, la distracción y la carrera', () => {
  const espalda = ventajaDeRobo(new THREE.Vector3(0, 0, -1), victim());
  close(espalda.zonaMult, 1.35); close(espalda.avisoExtra, -.2); close(espalda.marcadorMult, .85);
  const frente = ventajaDeRobo(new THREE.Vector3(0, 0, 1), victim());
  close(frente.zonaMult, .7); close(frente.avisoExtra, .2); close(frente.marcadorMult, 1.15);
  const andando = ventajaDeRobo(new THREE.Vector3(1, 0, 0), victim({ moving: true }));
  assert.equal(andando.distraida, true, 'andando va en lo suyo');
  close(andando.zonaMult, 1.15, 'zona a quien camina'); close(andando.avisoExtra, -.1, 'aviso de quien camina');
  const corriendo = ventajaDeRobo(new THREE.Vector3(1, 0, 0), victim(), { playerSpeed: 4 });
  close(corriendo.zonaMult, .75, 'zona llegando a la carrera'); close(corriendo.avisoExtra, .15, 'aviso llegando a la carrera');
  const caminando = ventajaDeRobo(new THREE.Vector3(1, 0, 0), victim(), { playerSpeed: 3 });
  close(caminando.zonaMult, 1, 'caminando a 3 m/s no es carrera');
});

test('«Mano suave» por fin cuenta en el cosquilleo, con piso y techo', () => {
  const base = { alerta: .6, ventaja: { posicion: 'lado', avisoExtra: 0 } };
  const sin = probabilidadDeAviso(base), con = probabilidadDeAviso({ ...base, talento: .8 });
  assert.ok(Math.abs(con - sin * .8) < 1e-9, `${con} = ${sin} × 0,8`);
  assert.equal(probabilidadDeAviso({ alerta: 0, ventaja: { posicion: 'espalda', avisoExtra: -.2 } }), .12, 'piso de espaldas');
  assert.equal(probabilidadDeAviso({ alerta: 0, ventaja: { posicion: 'lado', avisoExtra: -.2 } }), .2, 'piso');
  assert.equal(probabilidadDeAviso({ alerta: 1, ventaja: { posicion: 'frente', avisoExtra: .2 } }), .95, 'techo');
  assert.ok(probabilidadDeAviso({ alerta: .6, perro: .3 }) < probabilidadDeAviso({ alerta: .6 }), 'El Chato distrae');
  assert.equal(probabilidadDeAviso({ ...base, talento: NaN }), sin, 'un talento sin número no cambia nada');
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
  assert.match(avisoDeRobo({ posicion: 'espalda' }), /de espaldas, ni me ve/);
  assert.match(avisoDeRobo({ posicion: 'frente' }), /de frente: me está viendo/);
  assert.match(avisoDeRobo({ posicion: 'lado', distraida: true }), /va en lo suyo/);
  assert.equal(avisoDeRobo({ posicion: 'lado' }), '[E] Cosquilleo · [Q] Robo directo');
});

test('cada quien carga lo suyo: el habitante de calle casi nada, y todo existe en el costal', () => {
  assert.ok(botinDe({ person: { arquetipo: 'habitante' } }).plata < botinDe({ person: { arquetipo: 'oficinista' } }).plata);
  for (const [id, b] of Object.entries(BOTIN_POR_ARQUETIPO)) {
    assert.ok(b.plata > 0 && b.plata <= 1, id);
    for (const item of b.objetos) assert.ok(ITEMS[item], `${id}: ${item}`);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(BOTIN_POR_ARQUETIPO).map(([k, b]) => [k, b.plata])),
    { oficinista: 1, senora: .9, obrero: .85, abuelo: .8, estudiante: .7, reciclador: .45, habitante: .3 });
  assert.deepEqual(botinDe({}, ['pan']), { plata: 1, objetos: ['pan'] }, 'sin arquetipo, lo de siempre');
});

test('la práctica agranda la zona hasta un 12 % y la zona respeta sus topes', () => {
  assert.equal(manoMult(0), 1);
  assert.equal(manoMult(5), 1.05);
  assert.equal(manoMult(12), 1.12);
  assert.equal(manoMult(50), 1.12);
  assert.equal(manoMult(Number.MAX_SAFE_INTEGER), 1.12, 'una cuenta enorme no da más');
  for (const raro of [NaN, -3, 'x', null, undefined, Infinity * 0]) assert.equal(manoMult(raro), 1, String(raro));
  assert.equal(zonaDeCosquilleo(.3, { zonaMult: 10 }), .5, 'tope de la zona');
  assert.equal(zonaDeCosquilleo(.18, { zonaMult: .1 }), .14, 'piso de la zona');
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
