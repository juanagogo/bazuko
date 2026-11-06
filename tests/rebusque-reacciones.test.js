// Reacciones de los conductores y balance del semáforo: reparto, modificadores, paga por show, techo por minuto y
// la furia (una vez al día, solo tras un parabrisas no pedido).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { pesosReaccion, elegirReaccion, valorEsperado, montoDe } from '../src/systems/rebusque/reacciones.js';
import { PESOS_REACCION, PROPINA, VOZ_REACCION, clavesVoz } from '../src/data/rebusqueReacciones.js';
import { REBUSQUE } from '../src/data/rebusque.js';
import { RebusqueSystem } from '../src/systems/RebusqueSystem.js';
import { frasesDe } from '../src/data/vocesCalle.js';

let eventos;
beforeEach(() => {
  eventos = [];
  globalThis.CustomEvent ??= class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } };
  globalThis.window = { dispatchEvent: e => eventos.push(e), addEventListener() {}, removeEventListener() {} };
});
const suma = w => Object.values(w).reduce((a, b) => a + b, 0);

test('las probabilidades suman 1 con cualquier contexto, y lo hostil no pasa de su base salvo de noche o quemado', () => {
  const contextos = [{}, { calidad: 1, fama: 1, franja: { limosna: 1.2, golpe: 1 } }, { calidad: 0, fama: -1, franja: { limosna: .4, golpe: 1.5 } },
    { sucio: true, lluvia: true, repeticion: 9, quemado: true, cansado: true }, { tipoCarro: 'moto' }, { tipoCarro: 'taxi' }, { calidad: NaN, fama: NaN }];
  for (const id of ['malabares', 'vidrios', 'dulces']) for (const c of contextos) {
    const w = pesosReaccion({ ...c, id });
    assert.ok(Math.abs(suma(w) - 1) < 1e-9, `${id} ${JSON.stringify(c)}: ${suma(w)}`);
    assert.ok(Object.values(w).every(p => p >= 0 && Number.isFinite(p)));
  }
  assert.equal(pesosReaccion({ id: 'cuidar' }), null);
  // Sin modificadores es exactamente la tabla.
  for (const [id, base] of Object.entries(PESOS_REACCION)) for (const [tipo, p] of Object.entries(base)) {
    assert.ok(Math.abs(pesosReaccion({ id })[tipo] - p) < 1e-9, `${id}.${tipo}`);
  }
  // Una moto no sube vidrio: el que no quiere, no mira.
  const moto = pesosReaccion({ id: 'malabares', tipoCarro: 'moto' });
  assert.equal(moto.ventana, undefined);
  assert.ok(moto.ignora > PESOS_REACCION.malabares.ignora);
});

test('los modificadores mueven lo que deben', () => {
  const base = pesosReaccion({ id: 'malabares' });
  const bueno = pesosReaccion({ id: 'malabares', calidad: 1 });
  assert.ok(bueno.paga > base.paga && bueno.propina > base.propina, 'un buen show paga más');
  assert.ok(pesosReaccion({ id: 'malabares', calidad: 0 }).paga < base.paga);
  assert.ok(pesosReaccion({ id: 'malabares', fama: 1 }).insulto < base.insulto, 'la fama baja los insultos');
  assert.ok(pesosReaccion({ id: 'malabares', fama: -1 }).insulto > base.insulto);
  assert.ok(pesosReaccion({ id: 'malabares', sucio: true }).paga < base.paga * .55, 'el olor espanta');
  assert.ok(pesosReaccion({ id: 'vidrios', lluvia: true }).paga < pesosReaccion({ id: 'vidrios' }).paga * .45, 'con lluvia nadie quiere el vidrio');
  assert.ok(pesosReaccion({ id: 'malabares', repeticion: 3 }).paga < base.paga, 'la misma esquina se cansa');
  assert.ok(pesosReaccion({ id: 'malabares', repeticion: 50 }).paga >= base.paga * .6 - 1e-9, 'con piso');
  const quemado = pesosReaccion({ id: 'malabares', quemado: true });
  assert.ok(quemado.paga < base.paga * .35 && quemado.insulto > base.insulto * 1.9, 'donde me vieron robando');
  assert.ok(pesosReaccion({ id: 'malabares', cansado: true }).paga < base.paga, 'molido rinde menos');
  const noche = pesosReaccion({ id: 'vidrios', franja: { limosna: .4, golpe: 1.5 } });
  assert.ok(noche.bravo > PESOS_REACCION.vidrios.bravo && noche.paga < PESOS_REACCION.vidrios.paga);
  // El tope: ni con todo a favor se dispara lo positivo.
  const top = pesosReaccion({ id: 'malabares', calidad: 1, fama: 1, franja: { limosna: 5 } });
  assert.ok(top.paga <= PESOS_REACCION.malabares.paga * 1.4 + 1e-9);
});

test('la tirada: paga primero, y con la misma semilla la misma reacción', () => {
  const def = REBUSQUE.malabares;
  assert.deepEqual(elegirReaccion({}, def, () => 0), { tipo: 'paga', pesos: Math.round(def.paga[0] * .9 + def.paga[0] * .2 * .5), item: null });
  assert.equal(elegirReaccion({}, def, () => .999).tipo, 'insulto');
  const vistos = new Set();
  for (let i = 0; i < 1000; i++) vistos.add(elegirReaccion({}, def, Math.random).tipo);
  for (const tipo of Object.keys(PESOS_REACCION.malabares)) assert.ok(vistos.has(tipo), tipo);
  // Dulces: comprar es al precio, la propina es «quédese con las vueltas».
  assert.equal(montoDe('compra', REBUSQUE.dulces), 1000);
  assert.equal(montoDe('propina', REBUSQUE.dulces), PROPINA.dulce);
  assert.equal(montoDe('propina', REBUSQUE.vidrios, { r2: 0 }), PROPINA.billete);
  assert.equal(elegirReaccion({}, REBUSQUE.malabares, (() => { const s = [.36, .9]; return () => s.shift() ?? 0; })()).item, 'refresco');
  // Las voces nuevas tienen respaldo en las de siempre. El insulto solo tiene voz en el parabrisas (ver abajo).
  for (const [tipo, claves] of Object.entries(VOZ_REACCION)) {
    if (!claves.length || tipo === 'insulto') continue; // no mirar, subir el vidrio o pitar no tienen voz
    assert.ok(claves.some(c => frasesDe(c).length > 0), `${tipo} tiene voz`);
  }
});

test('voz del insulto: la frase del vidrio solo en el parabrisas; en malabares y dulces habla el siguiente conductor', () => {
  assert.ok(frasesDe('semaforo_bravo').every(f => /vidrio|carro/i.test(f.texto ?? f.text ?? String(f))), 'semaforo_bravo es del vidrio');
  for (const trabajo of ['malabares', 'dulces']) assert.ok(!clavesVoz('insulto', trabajo).includes('semaforo_bravo'), trabajo);
  assert.ok(clavesVoz('insulto', 'vidrios').includes('semaforo_bravo'));
  const dichas = [];
  const r = new RebusqueSystem({ audio: { playDriverLine: (car, clave) => dichas.push([car, clave]) } });
  const a = {}, b = {};
  // Un show con un insulto y un pago: habla el que pagó, nunca «no me limpie el vidrio».
  r._vozReaccion([{ car: a, tipo: 'insulto' }, { car: b, tipo: 'paga' }], false, 'malabares');
  assert.deepEqual(dichas, [[b, 'semaforo_si']]);
  // Solo insultos en malabares: el aviso cita el insulto y nadie dice la frase del vidrio.
  dichas.length = 0;
  r._vozReaccion([{ car: a, tipo: 'insulto' }], false, 'dulces');
  assert.deepEqual(dichas, []);
  // En el parabrisas sí: el que no pidió la limpiada.
  r._vozReaccion([{ car: a, tipo: 'insulto' }, { car: b, tipo: 'paga' }], false, 'vidrios');
  assert.deepEqual(dichas, [[a, 'semaforo_bravo']]);
  r.dispose?.();
});

test('balance: un show de malabares deja unos $1.000-1.200 y un parabrisas unos $650', () => {
  const show = valorEsperado({}, REBUSQUE.malabares) * REBUSQUE.malabares.carros;
  assert.ok(show >= 900 && show <= 1200, `show a cuatro carros: ${show}`);
  assert.ok(show * 1.15 <= 1200, `frente al primero: ${show * 1.15}`);
  const vidrio = valorEsperado({}, REBUSQUE.vidrios);
  assert.ok(vidrio >= 550 && vidrio <= 800, `parabrisas: ${vidrio}`);
  const dulces = valorEsperado({}, REBUSQUE.dulces) * REBUSQUE.dulces.carros;
  assert.ok(dulces <= 1200, `dulces: ${dulces}`);
  // No hacer nada (calidad 0,5) paga como antes del mini-juego; hacerlo bien paga más, sin dispararse.
  const perfecto = valorEsperado({ calidad: 1 }, REBUSQUE.malabares) * 4;
  assert.ok(perfecto > show && perfecto < show * 1.5, `${perfecto}`);
});

/** Un juego de dobles con carros "de verdad" y un reloj de semáforos, para el techo por minuto. */
function juegoSemaforo(random) {
  const carros = [];
  for (let i = 0; i < 4; i++) carros.push({ position: { x: -6.5 * (i % 2), y: 0, z: 3.5 * Math.floor(i / 2) }, group: { rotation: { y: 0 } }, length: 4.2, width: 1.8, mirrors: [{}], kind: 'carro' });
  const vehicles = carros.map(car => ({ car, speed: 0, stopped: true, state: 'patrol' }));
  const g = {
    player: { position: { x: 3.2, y: 0, z: 0 } },
    stats: { dinero: 0, energia: 1e9, animo: 50, higiene: 100, addXP() {} },
    inventory: { count: () => 1, remove() {}, add: () => true },
    clock: { day: 1, hour: 10 },
    reputation: { factor: 1, sumar() {} },
    jornada: { franja: { limosna: 1.2, golpe: 1 } },
    traffic: { vehicles, signals: { time: 20, nodes: [] }, hold() {},
      stoppedAtRed: p => vehicles.map(v => ({ vehicle: v, car: v.car, distance: Math.hypot(v.car.position.x - p.x, v.car.position.z - p.z) })).sort((a, b) => a.distance - b.distance) }
  };
  return { g, r: new RebusqueSystem(g, { random }) };
}

test('techo: ni el mejor caso pasa de $3.000 en un minuto real (salvo el billete del primero)', () => {
  // Siempre paga el máximo y siempre hay un rojo largo: un show de malabares cada vez que se puede, con fama alta.
  const { g, r } = juegoSemaforo(() => .3);
  r._sitio = (def, lugares) => ({ cars: lugares.slice(0, def.carros), nariz: true });
  r._impedimento = () => null;
  r._libre = () => true;
  let peor = 0;
  const cobros = [];
  for (let t = 0; t < 600; t += .1) {
    g.traffic.signals.time = 20; // rojo eterno
    if (!r.activo) r.intentar();
    const antes = g.stats.dinero;
    r.update(.1);
    if (g.stats.dinero > antes) cobros.push([t, g.stats.dinero - antes]);
  }
  for (const [t] of cobros) peor = Math.max(peor, cobros.filter(([s]) => s > t - 60 && s <= t).reduce((n, [, p]) => n + p, 0));
  assert.ok(cobros.length >= 10, `${cobros.length}`);
  assert.ok(peor <= 3000, `peor minuto: ${peor}`);
  assert.ok(peor >= 2000, `el techo se toca: ${peor}`);
  assert.ok(eventos.some(e => e.type === 'toast' && /Nadie me dio nada|carros me dieron|Me dieron/.test(e.detail.text)));
});

test('furia: solo tras un parabrisas no pedido, una vez al día, con RoadRage libre y sin patrulla cerca', () => {
  // random fijo en la cola de la tabla de vidrios: siempre sale «furia».
  const { g, r } = juegoSemaforo(() => .9999);
  const disparos = [];
  g.roadRage = { state: 'idle', trigger(car) { disparos.push(car); this.state = 'stopping'; return true; } };
  r._impedimento = () => null;
  r._libre = () => true;
  r._sitio = (def, lugares) => ({ cars: lugares.slice(0, 1), nariz: false });
  g.inventory.count = id => (id === 'limpiavidrios' ? 1 : 0);
  const correr = () => { r.intentar(); for (let i = 0; i < 80 && r.activo; i++) r.update(.1); };
  correr();
  assert.equal(disparos.length, 1, 'se bajó con la varilla');
  assert.ok(eventos.some(e => e.type === 'toast' && /varilla/.test(e.detail.text)));
  assert.equal(r.jornada.furiaHoy, true);
  g.roadRage.state = 'idle';
  correr();
  assert.equal(disparos.length, 1, 'una sola vez por día: el segundo solo insulta');
  assert.equal(r.escena.reacciones[0].tipo, 'insulto');
  // Al día siguiente vuelve a poder, pero no con una patrulla al lado.
  g.clock.day = 2;
  g.traffic.vehicles.push({ car: { position: { x: 10, y: 0, z: 0 } }, police: true, state: 'patrol', speed: 0 });
  correr();
  assert.equal(disparos.length, 1, 'con la patrulla cerca nadie se baja');
  // Los malabares y los dulces nunca traen furia.
  for (const id of ['malabares', 'dulces']) assert.equal(PESOS_REACCION[id].furia, undefined);
});
