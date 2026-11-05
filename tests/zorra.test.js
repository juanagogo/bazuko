import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originEffect } from '../src/data/origins.js';
import { ZORRA, FORCEJEO } from '../src/data/zorra.js';
import { ZorraSystem, movimientoJugador, haySobrepeso, precioZorra, ofertaZorra, objetosADescartar } from '../src/systems/ZorraSystem.js';
import { fuerzaJugador, crearForcejeo, pulsarForcejeo, avanzarForcejeo, cancelarForcejeo, botinForcejeo } from '../src/systems/Forcejeo.js';
import { RecicladorEstado } from '../src/systems/RecicladorEstado.js';

test('el origen reciclador abarata la zorra y da fuerza en el forcejeo', () => {
  assert.equal(originEffect('reciclador', 'zorraDiscount'), 0.75);
  assert.equal(originEffect('reciclador', 'forcejeoBonus'), 1.2);
  assert.equal(originEffect('migrante', 'zorraDiscount'), 1);
  assert.equal(originEffect('reciclador', 'extraLoot', 0), 1);
});

test('la calibración del forcejeo gana con 4 pulsaciones por segundo y no con 3', () => {
  const neta = (p) => FORCEJEO.empuje * p - FORCEJEO.tironNpc;
  assert.ok(neta(3) <= 1e-9);
  assert.ok((1 - FORCEJEO.barraInicial) / neta(4) <= FORCEJEO.duracion);
  assert.equal(ZORRA.bonoPeso, 40);
});

test('empujar suma 40 kg, multiplica la velocidad por 0,7 y quita correr', () => {
  const z = new ZorraSystem();
  assert.equal(z.bonoPeso(), 0);
  assert.equal(z.obtener(), true);
  assert.equal(z.obtener(), false);
  assert.equal(z.bonoPeso(), 40);
  assert.deepEqual(movimientoJugador({ empujando: true }), { mult: 0.7, puedeCorrer: false });
  assert.equal(z.soltar([1, 0, 2], 0.5), true);
  assert.equal(z.bonoPeso(), 0);
  assert.equal(z.tieneZorra(), true);
  assert.deepEqual(movimientoJugador({ empujando: false }), { mult: 1, puedeCorrer: true });
  assert.equal(z.agarrar(), true);
  assert.equal(z.pos, null);
});

test('con sobrepeso o forcejeando el jugador no se mueve', () => {
  assert.equal(haySobrepeso(50, 40), true);
  assert.equal(haySobrepeso(40, 40), false);
  assert.deepEqual(movimientoJugador({ empujando: false, sobrepeso: true }), { mult: 0, puedeCorrer: false });
  assert.equal(movimientoJugador({ empujando: true, forcejeando: true }).mult, 0);
});

test('la compra cuesta 40.000 y 30.000 para el reciclador, y no se compra dos veces', () => {
  assert.equal(precioZorra(null), 40000);
  assert.equal(precioZorra('reciclador'), 30000);
  assert.deepEqual(ofertaZorra({ dinero: 50000, tieneZorra: false, originId: null }), { precio: 40000, disponible: true, motivo: null });
  assert.equal(ofertaZorra({ dinero: 50000, tieneZorra: true, originId: null }).motivo, 'tiene');
  assert.equal(ofertaZorra({ dinero: 35000, tieneZorra: false, originId: null }).motivo, 'dinero');
  assert.equal(ofertaZorra({ dinero: 35000, tieneZorra: false, originId: 'reciclador' }).disponible, true);
});

test('al morir se descarta desde lo más pesado hasta caber sin la zorra', () => {
  const items = [{ id: 'lata', weight: 0.2, qty: 10 }, { id: 'chatarra', weight: 1, qty: 30 }];
  assert.deepEqual(objetosADescartar(items, 20), [['chatarra', 12]]);
  assert.deepEqual(objetosADescartar(items, 100), []);
  assert.equal(items[1].qty, 30);
});

test('el guardado conserva la zorra y las partidas antiguas cargan sin zorra', () => {
  const z = new ZorraSystem();
  z.obtener(); z.soltar([3, 0, 4], 1.2);
  const copia = new ZorraSystem();
  copia.deserialize(JSON.parse(JSON.stringify(z.serialize())));
  assert.deepEqual(copia.serialize(), { state: 'dropped', pos: [3, 0, 4], rot: 1.2 });
  const vieja = new ZorraSystem();
  vieja.deserialize(undefined);
  assert.equal(vieja.estado, 'none');
  const rara = new ZorraSystem();
  rara.deserialize({ state: 'volando' });
  assert.equal(rara.estado, 'none');
  const sinPos = new ZorraSystem();
  sinPos.deserialize({ state: 'dropped', pos: null });
  assert.equal(sinPos.estado, 'pushing');
});

const simular = (porSegundo, fuerza = 1) => {
  const f = crearForcejeo(fuerza);
  const dt = 1 / 60;
  let acumulado = 0;
  while (!f.resultado) {
    acumulado += porSegundo * dt;
    while (acumulado >= 1) { pulsarForcejeo(f); acumulado -= 1; }
    avanzarForcejeo(f, dt);
  }
  return f;
};

test('un jugador descansado gana a 4-5 pulsaciones por segundo y pierde a 3 por tiempo', () => {
  assert.equal(simular(4.5).resultado, 'victoria');
  const lento = simular(3);
  assert.equal(lento.resultado, 'derrota');
  assert.ok(lento.tiempo >= 6 - 1e-9);
});

test('sin pulsar, la barra llega a 0 antes de los 6 s', () => {
  const f = simular(0);
  assert.equal(f.resultado, 'derrota');
  assert.equal(f.barra, 0);
  assert.ok(f.tiempo < 6);
});

test('la fuerza baja con cansancio y abstinencia y sube con el origen', () => {
  assert.equal(fuerzaJugador({ energia: 80, enAbstinencia: false }), 1);
  assert.equal(fuerzaJugador({ energia: 29, enAbstinencia: false }), 0.6);
  assert.equal(fuerzaJugador({ energia: 80, enAbstinencia: true }), 0.5);
  assert.ok(Math.abs(fuerzaJugador({ energia: 10, enAbstinencia: true, origenMult: 1.2 }) - 0.36) < 1e-9);
  assert.equal(simular(4.5, 0.6).resultado, 'derrota');
});

test('rendirse cuenta como derrota y el botín trae de 2 a 4 materiales', () => {
  const f = crearForcejeo(1);
  cancelarForcejeo(f);
  assert.equal(f.resultado, 'derrota');
  assert.equal(botinForcejeo(() => 0).length, 2);
  assert.equal(botinForcejeo(() => 0.999).length, 4);
  for (const id of botinForcejeo()) assert.ok(['lata', 'botella', 'carton', 'chatarra'].includes(id));
});

test('en el 10 % de las paradas deja la zorra 8 s y al volver nota el robo', () => {
  const r = new RecicladorEstado(() => 0.05);
  assert.equal(r.llegarACaneca(), 'descuidar');
  assert.equal(r.puedeForcejear, false);
  assert.equal(r.avanzar(7.9), null);
  assert.equal(r.robarZorra(), true);
  assert.equal(r.avanzar(0.2), 'regresar');
  assert.equal(r.recogerZorra(), false);
  assert.equal(new RecicladorEstado(() => 0.5).llegarACaneca(), 'rebuscar');
});

test('sin zorra recupera una nueva a los 5 minutos', () => {
  const r = new RecicladorEstado();
  r.iniciarForcejeo(); r.jugadorGana();
  assert.equal(r.puedeForcejear, false);
  assert.equal(r.avanzar(299), null);
  assert.equal(r.avanzar(1), 'recupera');
  assert.equal(r.puedeForcejear, true);
});

test('tras perder un forcejeo no acepta otro durante 2 minutos', () => {
  const r = new RecicladorEstado();
  r.iniciarForcejeo(); r.jugadorPierde();
  assert.equal(r.enojado, true);
  r.avanzar(119);
  assert.equal(r.puedeForcejear, false);
  r.avanzar(1);
  assert.equal(r.puedeForcejear, true);
});

test('sin zorra, la parada en la caneca nunca es un descuido', () => {
  const r = new RecicladorEstado(() => 0.01);
  r.tieneZorra = false;
  assert.equal(r.llegarACaneca(), 'rebuscar');
  assert.equal(r.zorraDescuidada, false);
  assert.equal(r.fase, 'parada');
});
