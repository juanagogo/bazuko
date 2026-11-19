// El rap en el vagón: el ritmo, el juicio de cada golpe, el flow, lo que paga la gente, la sesión entera con un reloj
// de mentiras y el viaje que lo envuelve. La escena se prueba en el navegador (tests/e2e/rap.spec.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RITMO, POSICIONES, armarCancion, duracionCompas, elegirEstrofas, flowDe, juzgar, marcarPerdidos, nivelDe,
  partirPedazo, posicion, rachaDe, saludoPara, trabada,
} from '../src/systems/rap/ritmo.js';
import {
  PAGO, EFECTOS_RAP, avisoDelRap, cobrar, elegirPasajeros, esRepetido, gestoDurante, interes, videoDelEstudiante,
} from '../src/systems/rap/pago.js';
import {
  ESTROFAS, PASAJEROS, SALUDOS, TRABADAS, VEREDICTOS, CIERRE, GRITOS_RACHA, SILENCIOS, REPETIDO,
} from '../src/data/rapLetras.js';
import { hasIcon } from '../src/ui/icons.js';
import { RapEnElBus } from '../src/ui/RapEnElBus.js';
import { StreetLife } from '../src/systems/StreetLife.js';
import { PASAJE, travelMinutes } from '../src/systems/Transit.js';
import { getGamepadContext } from '../src/core/Gamepad.js';

/** Azar repetible (Park-Miller). */
const semilla = (s = 7) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const fija = (v) => () => v;

// ---------- la canción ----------

test('la canción: dos compases de saludo sin golpes, dos estrofas distintas y el cierre', () => {
  const c = armarCancion({ random: semilla(3), hora: 20 });
  assert.equal(c.compases.length, 2 + 4 + 4 + 1);
  assert.deepEqual(c.compases.slice(0, 2).map((x) => [x.tipo, x.golpes.length]), [['intro', 0], ['intro', 0]]);
  assert.equal(c.compases[0].texto, SALUDOS.noches);
  const [a, b] = [c.compases[2].estrofa, c.compases[6].estrofa];
  assert.notEqual(a, b, 'dos estrofas distintas');
  assert.deepEqual(c.compases[10].pedazos, CIERRE);
  // La segunda estrofa pide un golpe más en su primera y tercera línea.
  assert.deepEqual(c.compases.slice(2).map((x) => x.golpes.length), [2, 2, 2, 2, 3, 2, 3, 2, 2]);
  assert.equal(c.golpes.length, 20);
  // Los golpes van en orden, en la caja (el 2 y el 4), y cada uno sabe su compás y su pedazo.
  for (let i = 1; i < c.golpes.length; i++) assert.ok(c.golpes[i].t > c.golpes[i - 1].t);
  assert.deepEqual(POSICIONES[2], [0.25, 0.75]);
  const g = c.golpes[0];
  assert.deepEqual([g.compas, g.pedazo], [2, 0]);
  assert.ok(Math.abs(g.t - 2.25 * c.compas) < 1e-9);
  assert.ok(Math.abs(c.fin - 11 * c.compas) < 1e-9);
});

test('la marca cruza la barra una vez por compás: menos de 0,5 Hz, como pide la identidad', () => {
  assert.ok(1 / duracionCompas(RITMO.bpm) < 0.5, `${(1 / duracionCompas(RITMO.bpm)).toFixed(2)} Hz`);
  // Y el rap entero dura lo que un video corto.
  const c = armarCancion({ random: semilla() });
  assert.ok(c.fin + RITMO.previa > 25 && c.fin + RITMO.previa < 35, `${c.fin.toFixed(1)} s`);
});

test('el saludo va con la hora: días hasta las 12, tardes hasta las 7, y noches', () => {
  assert.equal(saludoPara(4), SALUDOS.noches);
  assert.equal(saludoPara(5), SALUDOS.dias);
  assert.equal(saludoPara(11.9), SALUDOS.dias);
  assert.equal(saludoPara(12), SALUDOS.tardes);
  assert.equal(saludoPara(18.99), SALUDOS.tardes);
  assert.equal(saludoPara(19), SALUDOS.noches);
  assert.equal(saludoPara(25), SALUDOS.noches, 'después de medianoche da la vuelta');
});

test('partir un pedazo: por el espacio más cercano a la mitad, y entero si no tiene espacios', () => {
  assert.deepEqual(partirPedazo('pero rimada y completa.'), ['pero rimada', 'y completa.']);
  assert.deepEqual(partirPedazo('fantástico.'), ['fantástico.']);
  for (const e of ESTROFAS) for (const [, b] of e.lineas) assert.equal(partirPedazo(b).join(' '), b);
});

test('las dos estrofas siempre son distintas, con cualquier azar', () => {
  for (const v of [0, 0.1, 0.5, 0.86, 0.9999]) {
    const [a, b] = elegirEstrofas(fija(v));
    assert.notEqual(a.id, b.id, `azar ${v}`);
  }
  const vistas = new Set();
  const r = semilla(11);
  for (let i = 0; i < 300; i++) for (const e of elegirEstrofas(r)) vistas.add(e.id);
  assert.equal(vistas.size, ESTROFAS.length, 'todas salen alguna vez');
});

test('rapear otra vez: no repito las estrofas del rap anterior mientras queden otras', () => {
  const r = semilla(4);
  for (let i = 0; i < 200; i++) {
    const [a, b] = elegirEstrofas(r, ESTROFAS, ['cambuche', 'chato']);
    assert.ok(!['cambuche', 'chato'].includes(a.id) && !['cambuche', 'chato'].includes(b.id), `${a.id} ${b.id}`);
    assert.notEqual(a.id, b.id);
  }
  // Si evitar deja menos de dos, se elige entre todas.
  const todasMenosUna = ESTROFAS.slice(1).map((e) => e.id);
  const [a, b] = elegirEstrofas(fija(0.5), ESTROFAS, todasMenosUna);
  assert.notEqual(a.id, b.id);
  const c = armarCancion({ random: semilla(9), evitar: ['fama', 'clima'] });
  assert.ok(!c.compases.some((x) => x.estrofa === 'fama' || x.estrofa === 'clima'));
});

test('la racha: cuenta desde el último golpe juzgado hacia atrás, buenos o malos', () => {
  const c = armarCancion({ random: semilla() });
  assert.deepEqual(rachaDe(c, []), { buenos: 0, malos: 0 });
  assert.deepEqual(rachaDe(c, ['justo', 'bien', 'justo']), { buenos: 3, malos: 0 });
  assert.deepEqual(rachaDe(c, ['justo', 'fuera', 'justo', 'bien']), { buenos: 2, malos: 0 });
  assert.deepEqual(rachaDe(c, ['justo', 'fuera', 'fuera', 'fuera']), { buenos: 0, malos: 3 });
  // Los gritos caben en una canción: el último sale antes del cierre.
  const cuentas = Object.keys(GRITOS_RACHA).map(Number);
  assert.ok(Math.max(...cuentas) <= c.golpes.length - 2, 'el último grito alcanza a salir');
  assert.ok(SILENCIOS.length >= 2);
});

// ---------- el juicio ----------

test('juzgar: justo, bien o nada; el golpe más cercano sin juzgar, y nunca dos veces el mismo', () => {
  const c = armarCancion({ random: semilla() });
  const r = [];
  const t0 = c.golpes[0].t;
  assert.equal(juzgar(c, r, t0 + 0.03).calidad, 'justo');
  assert.equal(juzgar(c, r, t0 - 0.12).calidad, 'bien');
  assert.equal(juzgar(c, r, t0 + RITMO.ventanaBien + 0.01), null, 'lejos no cuenta');
  r[0] = 'justo';
  assert.equal(juzgar(c, r, t0), null, 'ese golpe ya se juzgó');
  const t1 = c.golpes[1].t;
  assert.equal(juzgar(c, r, t1 - 0.01).indice, 1);
});

test('lo que pasa sin pulsación queda fuera, una sola vez', () => {
  const c = armarCancion({ random: semilla() });
  const r = [];
  assert.deepEqual(marcarPerdidos(c, r, c.golpes[0].t + RITMO.ventanaBien - 0.01), []);
  assert.deepEqual(marcarPerdidos(c, r, c.golpes[1].t + RITMO.ventanaBien + 0.01), [0, 1]);
  assert.deepEqual(marcarPerdidos(c, r, c.golpes[1].t + 1), []);
  assert.deepEqual(r.slice(0, 2), ['fuera', 'fuera']);
});

test('el flow y el nivel: todo justo es durísimo, todo bien es bien, nada es que me bajen', () => {
  const c = armarCancion({ random: semilla() });
  const todo = (v) => c.golpes.map(() => v);
  assert.equal(flowDe(c, todo('justo')), 1);
  assert.equal(nivelDe(1), 'durisimo');
  assert.ok(Math.abs(flowDe(c, todo('bien')) - 0.6) < 1e-9);
  assert.equal(nivelDe(flowDe(c, todo('bien'))), 'bien');
  assert.equal(flowDe(c, todo('fuera')), 0);
  assert.equal(nivelDe(0), 'bajado');
  assert.equal(nivelDe(0.5), 'regular');
  assert.equal(nivelDe(0.2), 'mal');
  // Mientras va, cuenta solo lo juzgado; sin nada juzgado, la gente está a la mitad.
  assert.equal(flowDe(c, [], 0, { soloJuzgados: true }), 0.5);
  assert.equal(flowDe(c, ['justo'], 0, { soloJuzgados: true }), 1);
});

test('machacar la tecla no sirve: cada pulsación sin golpe cerca resta', () => {
  const c = armarCancion({ random: semilla() });
  const r = [];
  let extras = 0;
  for (let t = -1; t < c.fin; t += 0.1) {
    if (juzgar(c, r, t)) { const j = juzgar(c, r, t); r[j.indice] = j.calidad; } else extras++;
    marcarPerdidos(c, r, t);
  }
  const flow = flowDe(c, r, extras);
  assert.ok(['bajado', 'mal'].includes(nivelDe(flow)), `machacando: ${nivelDe(flow)} (${flow.toFixed(2)})`);
});

test('trabarse: no sale la misma trabada dos veces seguidas', () => {
  const r = fija(0);
  const a = trabada(r);
  assert.notEqual(trabada(r, a), a);
  assert.ok(TRABADAS.includes(trabada(semilla())));
});

// ---------- la gente y la plata ----------

test('los datos: cada pasajero tiene dibujo, gesto bueno y malo y qué decir en cada nivel', () => {
  assert.equal(new Set(PASAJEROS.map((p) => p.id)).size, PASAJEROS.length);
  for (const p of PASAJEROS) {
    assert.ok(hasIcon(p.dibujo), `${p.id}: el dibujo ${p.dibujo} existe`);
    assert.ok(p.durante.bueno && p.durante.malo, p.id);
    assert.ok(p.gusto > 0 && p.gusto < 2, p.id);
    for (const nivel of ['durisimo', 'bien', 'regular', 'mal']) {
      for (const dio of ['da', 'nada']) {
        assert.ok(p.dichos[nivel]?.[dio]?.length, `${p.id}: ${nivel} ${dio}`);
        for (const d of p.dichos[nivel][dio]) assert.ok((d.dice ?? d.hace)?.length > 3 && !(d.dice && d.hace), `${p.id}: ${nivel} ${dio}`);
      }
      // «Tome» o una moneda solo cuando da.
      for (const d of p.dichos[nivel].nada) assert.doesNotMatch(d.dice ?? d.hace, /\btome\b|me dio|me pasó/i, `${p.id}: ${nivel} sin plata no dice que da`);
    }
  }
  for (const e of ESTROFAS) {
    assert.equal(e.lineas.length, 4, e.id);
    for (const l of e.lineas) assert.ok(l.length === 2 && l.every((p) => p.trim().length > 2), e.id);
  }
  assert.ok(VEREDICTOS.durisimo && VEREDICTOS.cancelado && VEREDICTOS.bajado);
  assert.equal(new Set(TRABADAS).size, TRABADAS.length);
});

test('cinco pasajeros distintos, y el azar cambia quién va', () => {
  const a = elegirPasajeros(semilla(1)).map((p) => p.id);
  const b = elegirPasajeros(semilla(99)).map((p) => p.id);
  assert.equal(a.length, PAGO.pasajeros);
  assert.equal(new Set(a).size, a.length);
  assert.notDeepEqual(a, b);
});

test('las ganas de cada uno siguen el flow y su gusto; el gesto cambia de malo a bueno a la mitad', () => {
  const abuela = PASAJEROS.find((p) => p.id === 'abuela'), dulces = PASAJEROS.find((p) => p.id === 'dulces');
  assert.equal(interes(abuela, 0.5), 0.5);
  assert.ok(interes(abuela, 1) > interes(dulces, 1), 'a la abuela le gusta más que al de los dulces');
  assert.ok(interes(abuela, 0) < 0.5);
  assert.equal(gestoDurante(abuela, 0.9), abuela.durante.bueno);
  assert.equal(gestoDurante(abuela, 0.1), abuela.durante.malo);
});

test('cobrar: múltiplos de $ 100 dentro de lo de cada nivel, el billete solo si me luzco y con mal olor dan menos', () => {
  const todos = PASAJEROS;
  const siempre = cobrar({ pasajeros: todos, nivel: 'bien', random: fija(0) });
  for (const f of siempre.filas) {
    assert.equal(f.pesos % 100, 0);
    assert.ok(f.pesos >= PAGO.porNivel.bien.min && f.pesos <= PAGO.porNivel.bien.max);
    assert.equal(f.billete, false, 'en bien no hay billete');
  }
  assert.equal(siempre.total, siempre.filas.reduce((s, f) => s + f.pesos, 0));
  const lucido = cobrar({ pasajeros: todos, nivel: 'durisimo', random: fija(0) });
  assert.deepEqual(lucido.filas.filter((f) => f.billete).map((f) => f.pasajero.id).sort(), ['corbata', 'turista']);
  assert.ok(lucido.filas.filter((f) => f.billete).every((f) => f.pesos === PAGO.billete));
  assert.equal(cobrar({ pasajeros: todos, nivel: 'bajado', random: fija(0) }).total, 0, 'si me bajan, nadie da');
  // Con mal olor la probabilidad baja a la mitad.
  const r = 0.5;
  const limpio = cobrar({ pasajeros: todos, nivel: 'durisimo', random: fija(r) }).pagaron;
  const sucio = cobrar({ pasajeros: todos, nivel: 'durisimo', malOlor: true, random: fija(r) }).pagaron;
  assert.ok(sucio < limpio, `${sucio} < ${limpio}`);
});

test('la plata en promedio: lucirse paga más que el pasaje; un rap regular no llega ni a la mitad', () => {
  const promedio = (nivel, malOlor = false) => {
    const r = semilla(nivel.length * 31 + (malOlor ? 7 : 0));
    let suma = 0;
    for (let i = 0; i < 4000; i++) suma += cobrar({ pasajeros: elegirPasajeros(r), nivel, malOlor, random: r }).total;
    return suma / 4000;
  };
  const durisimo = promedio('durisimo'), bien = promedio('bien'), regular = promedio('regular'), mal = promedio('mal');
  assert.ok(durisimo > PASAJE && durisimo < 8000, `durísimo: ${durisimo.toFixed(0)}`);
  assert.ok(bien > 1000 && bien < durisimo / 2, `bien: ${bien.toFixed(0)}`);
  assert.ok(regular < PASAJE / 2, `regular: ${regular.toFixed(0)}`);
  assert.ok(mal < 200, `mal: ${mal.toFixed(0)}`);
  assert.ok(promedio('durisimo', true) < durisimo * 0.7, 'con mal olor dan bastante menos');
});

test('lo que dice cada uno cuadra con lo que dio', () => {
  const r = semilla(23);
  for (let i = 0; i < 400; i++) {
    for (const nivel of ['durisimo', 'bien', 'regular', 'mal', 'bajado']) {
      for (const f of cobrar({ pasajeros: elegirPasajeros(r), nivel, random: r }).filas) {
        const lista = f.pasajero.dichos[nivel === 'bajado' ? 'mal' : nivel][f.pesos > 0 ? 'da' : 'nada'];
        assert.ok(lista.includes(f.dicho), `${f.pasajero.id} ${nivel} ${f.pesos}`);
      }
    }
  }
});

test('el aviso al llegar dice lo que me hice, o que me bajaron, o que me callé', () => {
  assert.equal(avisoDelRap({ nivel: 'bien', total: 2300, destino: 'Portal del Centro', minutos: 12 }),
    'Llegué a Portal del Centro en 12 min. Rapeando en el vagón me hice $ 2.300.');
  assert.match(avisoDelRap({ nivel: 'mal', total: 0, destino: 'X', minutos: 9 }), /nadie me dio nada/);
  assert.match(avisoDelRap({ nivel: 'bajado', total: 0, destino: 'X', minutos: 21 }), /^Me bajaron antes y llegué a pie a X en 21 min\.$/);
  assert.match(avisoDelRap({ nivel: 'cancelado', total: 0, destino: 'X', minutos: 9 }), /no rapeé/);
});

test('si ya rapeé hace poco, dan menos; a las tres horas se les olvida', () => {
  assert.equal(esRepetido(undefined, 10), false);
  assert.equal(esRepetido(10, 10.5), true);
  assert.equal(esRepetido(10, 10 + PAGO.repetirHoras), false);
  assert.equal(esRepetido(12, 10), false, 'una hora vieja de otra partida no cuenta');
  const total = (repetido) => {
    const r = semilla(21);
    let suma = 0;
    for (let i = 0; i < 400; i++) suma += cobrar({ pasajeros: elegirPasajeros(r), nivel: 'bien', repetido, random: r }).total;
    return suma;
  };
  assert.ok(total(true) < total(false) * 0.8, 'la segunda vez la gente se sabe la canción');
});

test('el video del estudiante: solo si va en el vagón, y si me lucí o hice el oso', () => {
  const con = PASAJEROS.filter((p) => p.id === 'estudiante');
  const sin = PASAJEROS.filter((p) => p.id !== 'estudiante').slice(0, 5);
  assert.equal(videoDelEstudiante(sin, 'durisimo', fija(0.5)), null);
  assert.equal(videoDelEstudiante(con, 'bien', fija(0.5)), null);
  assert.match(videoDelEstudiante(con, 'durisimo', fija(0)), /^El estudiante ya lo subió: 300 vistas/);
  assert.match(videoDelEstudiante(con, 'mal', fija(0.999)), /memes: 8\.99\d vistas\.$/, 'con punto de miles');
});

// ---------- la sesión, sin página ----------

/** Una sesión sin página, con el reloj en la mano y sin audio. */
function sesion({ random = semilla(5), malOlor = false, repetido = false } = {}) {
  let ahora = 100;
  const sonidos = [];
  const game = { audio: { play: (n) => sonidos.push(n) } };
  const audio = { listo: () => false, parar() {}, fallo() { sonidos.push('fallo'); }, grito() { sonidos.push('grito'); }, dispose() {} };
  const rap = new RapEnElBus(game, { audio, random, doc: null, ahora: () => ahora });
  let terminado = null;
  rap.empezar({ hacia: { name: 'Portal del Centro' }, sistema: 'TransMilenio', hora: 9, malOlor, repetido, onTermina: (r) => { terminado = r; } });
  return {
    rap, game, sonidos, get terminado() { return terminado; },
    reloj: (t) => { ahora = t; }, enCancion: (t) => { ahora = rap._inicio + t; },
    arrancar: () => new Promise((r) => setTimeout(r, 5)).then(() => rap._arrancar()),
  };
}

test('la sesión entera: quieto el juego, pegando cada golpe me luzco, y al bajarme llega el resultado', async () => {
  const s = sesion();
  assert.equal(s.game._traveling, true, 'el viaje pausa el juego desde el principio');
  assert.equal(s.rap.estado, 'fundiendo');
  await s.arrancar();
  assert.equal(s.rap.estado, 'cantando');
  assert.equal(s.rap.golpe(), null, 'antes de la caja no cuenta');
  assert.equal(s.rap.extras, 0, 'ni resta');
  for (const g of s.rap.cancion.golpes) {
    s.enCancion(g.t + 0.02);
    assert.equal(s.rap.golpe()?.calidad, 'justo');
  }
  s.enCancion(s.rap.cancion.fin + 0.5);
  s.rap._cuadro();
  assert.equal(s.rap.estado, 'cuenta');
  assert.equal(s.rap.resultado.nivel, 'durisimo');
  assert.equal(s.rap.resultado.flow, 1);
  assert.equal(s.rap.resultado.filas.length, 5);
  assert.equal(s.terminado, null, 'la cuenta espera a que me baje');
  s.rap.mando('confirm');
  assert.equal(s.rap.estado, 'cuenta', 'machacando no se salta la cuenta');
  s.rap._cuentaDesde -= 1000;
  s.rap.mando('confirm');
  assert.equal(s.rap.estado, 'apagado');
  assert.equal(s.terminado.nivel, 'durisimo');
  if (s.terminado.total > 0) assert.ok(s.sonidos.includes('sell'));
});

test('la racha en la sesión: el vagón grita cada cuenta una vez, y se queda callado si me trabo tres veces', async () => {
  const s = sesion();
  await s.arrancar();
  const gritos = [];
  const pintar = s.rap._pintarRacha.bind(s.rap);
  s.rap._pintarRacha = (texto, tipo) => { if (texto) gritos.push([texto, tipo]); pintar(texto, tipo); };
  const golpes = s.rap.cancion.golpes;
  for (const g of golpes.slice(0, 8)) { s.enCancion(g.t); s.rap.golpe(); }
  assert.deepEqual(gritos, [[GRITOS_RACHA[4], 'grito'], [GRITOS_RACHA[8], 'grito']]);
  assert.equal(s.sonidos.filter((x) => x === 'grito').length, 2, 'con su corneta');
  // Tres perdidos seguidos: silencio.
  s.enCancion(golpes[10].t + 0.5);
  s.rap._cuadro();
  assert.equal(gritos.length, 3, JSON.stringify(gritos));
  assert.equal(gritos[2][1], 'silencio');
  assert.ok(SILENCIOS.includes(gritos[2][0]));
  // Vuelvo a pegar cuatro: el ¡Eso! ya salió y no se repite.
  for (const g of golpes.slice(11, 15)) { s.enCancion(g.t); s.rap.golpe(); }
  assert.equal(gritos.length, 3, JSON.stringify(gritos));
});

test('el resultado trae las estrofas que canté, si me conocían y el video', async () => {
  const s = sesion({ repetido: true, random: semilla(8) });
  await s.arrancar();
  for (const g of s.rap.cancion.golpes) { s.enCancion(g.t); s.rap.golpe(); }
  s.enCancion(s.rap.cancion.fin + 0.5);
  s.rap._cuadro();
  const r = s.rap.resultado;
  assert.equal(r.repetido, true);
  assert.equal(r.estrofas.length, 2);
  assert.deepEqual(r.estrofas, [s.rap.cancion.compases[2].estrofa, s.rap.cancion.compases[6].estrofa]);
  const conEstudiante = s.rap.pasajeros.some((p) => p.id === 'estudiante');
  assert.equal(Boolean(r.video), conEstudiante);
  assert.ok(REPETIDO.length > 0);
});

test('sin oprimir nada: cada golpe se pierde, suena el fallo y me bajan del bus', async () => {
  const s = sesion();
  await s.arrancar();
  s.enCancion(s.rap.cancion.fin + 0.5);
  s.rap._cuadro();
  assert.equal(s.sonidos.filter((x) => x === 'fallo').length, s.rap.cancion.golpes.length);
  assert.equal(s.rap.resultado.nivel, 'bajado');
  assert.equal(s.rap.resultado.total, 0);
});

test('callarme con Esc o B: no cobro, y la cuenta lo dice', async () => {
  const s = sesion();
  await s.arrancar();
  s.enCancion(s.rap.cancion.golpes[0].t);
  s.rap.golpe();
  s.rap.mando('back');
  assert.equal(s.rap.resultado.nivel, 'cancelado');
  assert.deepEqual([s.rap.resultado.total, s.rap.resultado.filas.length], [0, 0]);
  s.rap.continuar();
  assert.equal(s.terminado.nivel, 'cancelado');
});

test('otra pestaña: el rap espera y retoma desde el principio del compás en que iba', async () => {
  const s = sesion();
  await s.arrancar();
  const doc = { hidden: false };
  s.rap.doc = doc;
  const golpes = s.rap.cancion.golpes;
  // Pego los dos golpes del primer compás y el primero del segundo; me voy de la pestaña.
  for (const g of golpes.slice(0, 3)) { s.enCancion(g.t); s.rap.golpe(); }
  s.enCancion(golpes[2].t + 0.05);
  doc.hidden = true;
  s.rap._cambioDeVisibilidad();
  assert.equal(s.rap._pausado, true);
  // Pasan dos minutos: nada se pierde mientras tanto.
  s.reloj(s.rap._inicio + golpes[2].t + 120);
  s.rap._cuadro();
  assert.equal(s.rap.estado, 'cantando');
  doc.hidden = false;
  s.rap._cambioDeVisibilidad();
  assert.equal(s.rap._pausado, false);
  // El compás 3 se vuelve a jugar; el 2 queda como estaba.
  assert.deepEqual(s.rap.resultados.slice(0, 2), ['justo', 'justo']);
  assert.equal(s.rap.resultados[2], undefined);
  const t = s.rap.tiempo();
  assert.ok(Math.abs(t - (golpes[2].compas * s.rap.cancion.compas - RITMO.previa)) < 1e-6, 'vuelve con la previa');
});

// ---------- el viaje ----------

function viaje({ energia = 100, dinero = 10000, nivel = 'bien', total = 2400, pagaron = 3, random } = {}) {
  const avisos = [], eventos = [];
  globalThis.window ??= new EventTarget();
  const escuchar = (e) => (e.type === 'toast' ? avisos : eventos).push(e);
  for (const n of ['toast', 'transit-trip', 'transit-rap']) globalThis.window.addEventListener(n, escuchar);
  let empezo = null, relocado = null;
  const game = {
    stats: { dinero, energia, sed: 80, animo: 50, higiene: 90, tieneMalOlor: () => false, addXP(x) { this.xp = (this.xp ?? 0) + x; } },
    steal: { buscado: 0 }, clock: { hour: 21 },
    rapBus: { empezar: (o) => { empezo = o; } },
    relocatePlayer: (to, o) => { relocado = { to, ...o }; },
    world: { active: null }, collisions: null,
  };
  const street = Object.assign(Object.create(StreetLife.prototype), { game, guard: { cancel() {} } });
  const from = { id: 'portal', name: 'Portal del Centro', sistema: 'TransMilenio', x: 74, z: -8 };
  const to = { id: 'metro72', name: 'Metro, Estación Calle 72', sistema: 'Metro', x: 75, z: 112 };
  const fin = () => { for (const n of ['toast', 'transit-trip', 'transit-rap']) globalThis.window.removeEventListener(n, escuchar); };
  return { game, street, from, to, avisos, eventos, fin, get empezo() { return empezo; }, get relocado() { return relocado; },
    terminar: (r = { nivel, total, pagaron, flow: 0.7 }) => empezo.onTermina(r) };
}

test('viajar rapeando: paga el pasaje al subir, el rap decide la plata y llega con su aviso', () => {
  const v = viaje();
  const r = v.street.travel(v.from, v.to, { modo: 'pagar', rapear: true, pedir: true });
  assert.equal(r.rapeando, true);
  assert.equal(v.game.stats.dinero, 10000 - PASAJE, 'el pasaje se paga al entrar');
  assert.equal(v.empezo.hacia, v.to);
  assert.equal(v.empezo.sistema, 'TransMilenio', 'se sube en la estación de salida');
  assert.equal(v.empezo.hora, 21);
  assert.equal(v.relocado, null, 'mientras rapea no ha llegado');
  v.terminar();
  const st = v.game.stats;
  assert.equal(st.dinero, 10000 - PASAJE + 2400, 'pedir no suma: rapear lo reemplaza');
  assert.deepEqual([st.energia, st.sed, st.animo], [100 - EFECTOS_RAP.energia, 80 - EFECTOS_RAP.sed, 50 + EFECTOS_RAP.animo.bien]);
  assert.equal(st.xp, EFECTOS_RAP.xpPorPasajero * 3);
  assert.equal(v.relocado.minutes, travelMinutes(v.from, v.to));
  assert.equal(v.relocado.fade, true);
  assert.equal(v.avisos.at(-1).detail.text, `Llegué a Metro, Estación Calle 72 en ${travelMinutes(v.from, v.to)} min. Rapeando en el vagón me hice $ 2.400.`);
  assert.deepEqual(v.eventos.map((e) => e.type), ['transit-trip', 'transit-rap']);
  assert.equal(v.eventos[0].detail.rap, 'bien');
  assert.equal(v.eventos[1].detail.ganado, 2400);
  v.fin();
});

test('si me bajan llego a pie y más tarde; si me callo no gasto la voz', () => {
  const a = viaje({ nivel: 'bajado', total: 0, pagaron: 0 });
  a.street.travel(a.from, a.to, { modo: 'pagar', rapear: true });
  a.terminar();
  assert.equal(a.relocado.minutes, travelMinutes(a.from, a.to) + EFECTOS_RAP.minutosBajado);
  assert.equal(a.game.stats.animo, 50 + EFECTOS_RAP.animo.bajado);
  a.fin();
  const b = viaje({ nivel: 'cancelado', total: 0, pagaron: 0 });
  b.street.travel(b.from, b.to, { modo: 'pagar', rapear: true });
  b.terminar();
  assert.deepEqual([b.game.stats.energia, b.game.stats.sed], [100, 80], 'callado no cansa ni da sed');
  b.fin();
});

test('el vagón se acuerda: rapear otra vez al rato da menos y cambia las estrofas; callarme no cuenta', () => {
  const v = viaje();
  v.game.totalGameHours = 30;
  v.street.travel(v.from, v.to, { modo: 'pagar', rapear: true });
  assert.equal(v.empezo.repetido, false, 'la primera vez nadie me conoce');
  assert.deepEqual(v.empezo.evitar, []);
  v.terminar({ nivel: 'bien', total: 1000, pagaron: 1, flow: 0.7, estrofas: ['chato', 'clima'] });
  v.game.totalGameHours = 31;
  v.street.travel(v.to, v.from, { modo: 'pagar', rapear: true });
  assert.equal(v.empezo.repetido, true);
  assert.deepEqual(v.empezo.evitar, ['chato', 'clima']);
  v.terminar({ nivel: 'cancelado', total: 0, pagaron: 0, flow: 0 });
  v.game.totalGameHours = 30 + PAGO.repetirHoras + 0.5;
  v.street.travel(v.from, v.to, { modo: 'pagar', rapear: true });
  assert.equal(v.empezo.repetido, false, 'a las tres horas se les olvidó; el rap callado no renovó nada');
  v.fin();
});

test('sin energía no se rapea: el viaje sale normal y lo dice', () => {
  const v = viaje({ energia: EFECTOS_RAP.energiaMin - 1 });
  assert.equal(v.street.canRap(), false);
  const r = v.street.travel(v.from, v.to, { modo: 'pagar', rapear: true });
  assert.equal(r.rapeando, undefined);
  assert.equal(v.empezo, null);
  assert.ok(v.relocado, 'viaja callado');
  assert.ok(v.avisos.some((e) => /muy cansado para rapear/.test(e.detail.text)));
  v.fin();
});

test('sin escena (sin página) la estación no ofrece rapear', () => {
  const v = viaje();
  v.game.rapBus = null;
  assert.equal(v.street.rapAvailable(), false);
  assert.equal(v.street.canRap(), false);
  v.fin();
});

test('con el mando, el rap es su propio contexto: A rima y B se calla aunque el juego esté quieto', () => {
  const acciones = [];
  const game = { paused: true, rapBus: { activo: true, root: {}, mando: (a) => acciones.push(a) } };
  const ctx = getGamepadContext(game, null);
  assert.equal(ctx.kind, 'rap');
  ctx.action('confirm');
  ctx.action('back');
  assert.deepEqual(acciones, ['confirm', 'back']);
  game.rapBus.activo = false;
  assert.equal(getGamepadContext(game, null).kind, 'blocked');
});
