// El turno de las voces: en un robo con testigo se oyen las dos, primero el grito de la víctima y enseguida el testigo,
// sin que ninguna arranque y se corte y sin burbuja de algo que no suena. También lo que le pasa a la burbuja de una
// voz cuando otra le quita el canal, y que entre testigos todo sigue como antes.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { DIRECTOR, VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { StealSystem } from '../src/features/steal.js';
import { GRITOS, WitnessSystem } from '../src/systems/WitnessSystem.js';
import { Npc } from '../src/entities/Npc.js';

let eventos;
beforeEach(() => {
  eventos = [];
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
  window.addEventListener('toast', e => eventos.push(e.detail.text));
});

let nextId = 0;
/** Cada audio anota cuándo arrancó y si lo cortaron: `orden` y `cortadas` son de todo el director. */
function howls(orden, cortadas) {
  return class FakeHowl {
    constructor(file) { this.file = file.replace(/^voces\//, '').replace(/\.mp3$/, ''); this.voices = new Map(); this.loaded = true; }
    state() { return this.loaded ? 'loaded' : 'loading'; }
    play() { const id = ++nextId; this.voices.set(id, { playing: true }); orden.push(this.file); return id; }
    playing(id) { return !!this.voices.get(id)?.playing; }
    stop(id) { const v = this.voices.get(id); if (v?.playing) { v.playing = false; cortadas.push(this.file); } }
    acabar() { for (const v of this.voices.values()) v.playing = false; } // la frase termina sola
    volume() {} once() {} rate() {} stereo() {} unload() {}
    duration() { return 2; }
  };
}

function director({ cargado = true } = {}) {
  const orden = [], cortadas = [], quitadas = [], burbujas = [];
  const Howl = howls(orden, cortadas);
  let ahora = 0;
  const d = new VoiceDirector({
    load: file => { const h = new Howl(file); h.loaded = cargado; return h; },
    burbuja: (cosa, text) => burbujas.push([cosa, text]), callarBurbuja: cosa => quitadas.push(cosa),
    random: () => .5, now: () => ahora,
  });
  const oyente = new THREE.Vector3();
  d.update(oyente, []);
  return {
    d, orden, cortadas, quitadas, burbujas,
    pasar(ms, cada = 100) { for (let t = 0; t < ms; t += cada) { ahora += cada; d.update(oyente, []); } },
    acabar() { for (const h of d._sounds.values()) h.acabar(); },
  };
}

/** Una persona de mentira con su voz: anota lo que dice su burbuja y cuándo se la quitan. */
const persona = (voz, at = [1, 0, 0]) => ({
  _voz: voz, position: new THREE.Vector3(...at), dichos: [], calladas: [], look: { real: { accesorios: [] } },
  say(text) { this.dichos.push(text); }, callar(text) { this.calladas.push(text); },
});

/** Un peatón de verdad con la voz dada; su burbuja se anota en vez de pintarse. */
function peaton(scene, x, voz) {
  const npc = new Npc(scene, new THREE.Vector3(x, 0, 0), { look: {} });
  npc.target = null; npc.route = [];
  npc._voz = voz; npc.dichos = []; npc.calladas = [];
  npc.say = text => npc.dichos.push(text);
  npc.callar = text => npc.calladas.push(text);
  return npc;
}

/** El robo y los testigos de verdad sobre el director; quien ve el robo llama a la Policía (azar 0). */
function robo(voces, npcs) {
  const game = {
    player: { position: new THREE.Vector3() }, stats: { dinero: 0, salud: 100 }, inventory: { add: () => true },
    world: { active: { npcs } }, input: { consumePress: () => false }, interaction: {},
    traffic: { wantedLevel: 1, dispatchTo: () => true }, audio: { voces },
  };
  const documento = globalThis.document;
  delete globalThis.document;
  try { game.steal = new StealSystem(game); } finally { globalThis.document = documento; }
  game.witnesses = new WitnessSystem(game, { random: () => 0 });
  return game;
}
const conAzar = (valor, fn) => { const real = Math.random; Math.random = () => valor; try { return fn(); } finally { Math.random = real; } };

const LLAMA = 'conductora_testigo_llama_1', TEXTO_LLAMA = '¿Aló, Policía? Aquí hay un man robando, vengan rápido.';

test('raponazo con testigo: primero grita la víctima y, cuando acaba, el testigo que llama; ninguna arranca y se corta', () => {
  const scene = new THREE.Scene();
  const m = director();
  const victima = peaton(scene, 1, 'senora'), testigo = peaton(scene, 4, 'conductora');
  const game = robo(m.d, [victima, testigo]);
  conAzar(.9, () => game.steal.executeRoboDirecto(victima));
  assert.equal(m.orden.length, 1, 'solo arrancó una voz');
  assert.match(m.orden[0], /^senora_robado_\d$/);
  assert.equal(testigo.witnessing, 'llamar', 'el testigo llama igual');
  assert.ok(eventos.some(t => /Alguien está llamando a la Policía/.test(t)), 'y el aviso de la llamada sale igual');
  assert.deepEqual(testigo.dichos, [], 'sin burbuja mientras no se le oiga');
  assert.equal(victima.dichos.length, 1);
  m.pasar(1500);
  assert.equal(m.orden.length, 1, 'mientras grita la víctima, el testigo espera');
  assert.deepEqual(testigo.dichos, []);
  m.acabar();
  m.pasar(100);
  assert.deepEqual(m.orden.slice(1), [LLAMA], 'enseguida el testigo');
  assert.deepEqual(testigo.dichos, [TEXTO_LLAMA], 'con su burbuja, ahora que suena');
  assert.deepEqual(m.cortadas, [], 'a ninguna la cortaron');
  assert.deepEqual([victima.calladas, testigo.calladas], [[], []]);
  assert.equal(m.d._voz.prioridad, PRIORIDAD_VOZ.witnessCall);
  game.witnesses.dispose();
});

test('cosquilleo pillado con testigo: lo mismo, la víctima primero y el testigo enseguida', () => {
  const scene = new THREE.Scene();
  const m = director();
  const victima = peaton(scene, 1, 'conductor'), testigo = peaton(scene, 4, 'conductora');
  const game = robo(m.d, [victima, testigo]);
  victima.alerta = 1;
  conAzar(.5, () => game.steal.startCosquilleo(victima));
  conAzar(0, () => game.steal._endMinigame(false, 'play'));
  assert.deepEqual(m.orden, ['conductor_robado_1']);
  assert.ok(eventos.some(t => /Me pillaron/.test(t)));
  assert.equal(testigo.witnessing, 'llamar');
  assert.deepEqual(testigo.dichos, [], 'ni su voz ni su texto de siempre encima del grito');
  m.pasar(1000);
  m.acabar();
  m.pasar(100);
  assert.deepEqual(m.orden, ['conductor_robado_1', LLAMA]);
  assert.deepEqual(testigo.dichos, [TEXTO_LLAMA]);
  assert.deepEqual(m.cortadas, []);
  game.witnesses.dispose();
});

test('si la víctima no tiene voz, el testigo habla al instante siguiente; y sin audio listo, pone su texto de siempre', () => {
  const scene = new THREE.Scene();
  {
    const m = director();
    const victima = peaton(scene, 1, 'vendedora'), testigo = peaton(scene, 4, 'conductora');
    const game = robo(m.d, [victima, testigo]);
    conAzar(.9, () => game.steal.executeRoboDirecto(victima));
    assert.deepEqual(m.orden, [], 'la vendedora grita en texto');
    m.pasar(100);
    assert.deepEqual(m.orden, [LLAMA]);
    assert.deepEqual(testigo.dichos, [TEXTO_LLAMA]);
    game.witnesses.dispose();
  }
  {
    const m = director({ cargado: false });
    const victima = peaton(scene, 1, 'senora'), testigo = peaton(scene, 4, 'conductora');
    const game = robo(m.d, [victima, testigo]);
    conAzar(.9, () => game.steal.executeRoboDirecto(victima));
    assert.equal(testigo.dichos.length, 1);
    assert.ok(GRITOS.llamar.includes(testigo.dichos[0]), 'el texto de siempre, como antes');
    assert.equal(m.d._enEspera, null, 'y no queda esperando');
    game.witnesses.dispose();
  }
});

test('una llamada interrumpida suelta su voz y su burbuja, aunque ya hubiera tomado el turno', () => {
  const scene = new THREE.Scene();
  for (const empieza of [false, true]) {
    const m = director();
    const victima = peaton(scene, 1, 'conductor'), testigo = peaton(scene, 4, 'conductora');
    const game = robo(m.d, [victima, testigo]);
    conAzar(.9, () => game.steal.executeRoboDirecto(victima));
    assert.equal(m.d._enEspera?.source, testigo);
    if (empieza) { m.acabar(); m.pasar(100); }
    // Lo mismo que hace Awareness si el susto lo hace retroceder.
    testigo.stopWitness();
    game.witnesses.update(.1);
    assert.equal(game.witnesses.calls.length, 0);
    assert.equal(m.d._enEspera, null);
    assert.deepEqual(m.cortadas, empieza ? [LLAMA] : []);
    assert.deepEqual(testigo.calladas, empieza ? [TEXTO_LLAMA] : []);
    m.acabar(); m.pasar(6_100);
    assert.deepEqual(testigo.dichos, empieza ? [TEXTO_LLAMA] : [], 'sin llamada tardía ni texto del teléfono');
    game.witnesses.dispose();
  }
});

test('el testigo espera seis segundos y conserva su texto de respaldo mientras esté consciente', () => {
  assert.deepEqual(DIRECTOR.turno, { espera: 6000, recien: 1000 });
  const m = director();
  const victima = persona('senora'), testigo = persona('conductora', [4, 0, 0]);
  const sinTurno = () => testigo.say('su texto de siempre');
  assert.equal(m.d.decirRobo(victima, 'raponazo-sin-bolso'), true);
  assert.equal(m.d.decirTestigo(testigo, 'llamar', { sinTurno }), true, 'queda esperando');
  m.pasar(5900);
  assert.deepEqual(testigo.dichos, [], 'mientras espera, nada');
  m.pasar(200);
  assert.deepEqual(testigo.dichos, ['su texto de siempre'], 'se le pasó el turno: no se queda mudo');
  m.acabar(); m.pasar(100);
  assert.equal(m.orden.length, 1, 'y ya no lo dice con voz');
  assert.equal(testigo.dichos.length, 1, 'ni repite el texto');
  // Una caída lo interrumpe antes de que le toque la frase.
  assert.equal(m.d.decirRobo(victima, 'raponazo-sin-bolso'), true);
  assert.equal(m.d.decirTestigo(testigo, 'llamar', { sinTurno }), true);
  testigo.koState = 'down';
  m.pasar(100);
  assert.equal(testigo.dichos.length, 1);
  m.acabar(); m.pasar(100);
  assert.equal(m.orden.length, 2);
  testigo.koState = null;
  // Quien ya no está en el mundo no pone nada.
  assert.equal(m.d.decirRobo(victima, 'raponazo-sin-bolso'), true);
  assert.equal(m.d.decirTestigo(testigo, 'llamar', { sinTurno }), true);
  testigo._disposed = true;
  m.acabar(); m.pasar(100);
  assert.equal(testigo.dichos.length, 1);
  assert.equal(m.orden.length, 3);
  testigo._disposed = false;
  // Lejos del jugador no espera: no se le oiría.
  assert.equal(m.d.decirRobo(victima, 'raponazo-sin-bolso'), true);
  assert.equal(m.d.decirTestigo(persona('conductora', [DIRECTOR.rango, 0, 0]), 'llamar'), false);
  // Si vuelve a hablar, lo que esperaba decir se olvida: cuelga y ya no dice que llama.
  assert.equal(m.d.decirTestigo(testigo, 'llamar'), true);
  m.acabar();
  assert.equal(m.d.decirTestigo(testigo, 'colgar'), true);
  assert.equal(m.orden.at(-1), 'conductora_testigo_cuelga_1');
  m.acabar(); m.pasar(200);
  assert.equal(m.orden.at(-1), 'conductora_testigo_cuelga_1', 'no vuelve con la llamada');
});

test('con el robo de verdad: el testigo al que no le llega el turno pone su texto de siempre, y una pausa no le gasta la espera', () => {
  const scene = new THREE.Scene();
  const armar = () => {
    const m = director();
    const victima = peaton(scene, 1, 'senora'), testigo = peaton(scene, 4, 'conductora');
    const game = robo(m.d, [victima, testigo]);
    conAzar(.9, () => game.steal.executeRoboDirecto(victima));
    assert.equal(m.orden.length, 1, 'grita la víctima');
    assert.deepEqual(testigo.dichos, [], 'y el testigo espera');
    return { m, testigo, game };
  };
  { // La víctima sigue gritando más de seis segundos.
    const { m, testigo, game } = armar();
    m.pasar(6100);
    assert.equal(testigo.dichos.length, 1, 'sale su burbuja de texto');
    assert.ok(GRITOS.llamar.includes(testigo.dichos[0]), testigo.dichos[0]);
    m.acabar(); m.pasar(200);
    assert.equal(m.orden.length, 1, 'ya no lo dice con voz');
    assert.equal(testigo.dichos.length, 1);
    game.witnesses.dispose();
  }
  { // Lo tumban mientras espera.
    const { m, testigo, game } = armar();
    m.pasar(500);
    testigo.takeHit({ damage: testigo.maxHealth });
    assert.equal(testigo.koState, 'down');
    m.pasar(100);
    assert.deepEqual(testigo.dichos, [], 'aun antes de que vuelvan a actualizarse los testigos, el caído ya se calló');
    assert.equal(m.orden.length, 1);
    game.witnesses.dispose();
  }
  { // Pausa de ocho segundos justo después del robo: al volver le queda su turno entero y habla con su voz.
    const { m, testigo, game } = armar();
    m.pasar(300);
    m.d.setPaused(true);
    m.pasar(8000);
    assert.deepEqual(testigo.dichos, [], 'en pausa no pasa nada');
    m.d.setPaused(false);
    m.pasar(100);
    assert.deepEqual(m.orden.slice(1), [LLAMA]);
    assert.deepEqual(testigo.dichos, [TEXTO_LLAMA]);
    game.witnesses.dispose();
  }
  { // La pausa no alarga la espera más de la cuenta: 3 s antes, pausa y 3,1 s después son 6,1 s de espera.
    const m = director();
    const testigo = persona('conductora', [4, 0, 0]);
    assert.equal(m.d.decirRobo(persona('senora'), 'raponazo-sin-bolso'), true);
    m.d._voz.enPausa = true; // una voz que la pausa no calla, para que el canal siga ocupado
    assert.equal(m.d.decirTestigo(testigo, 'llamar', { sinTurno: () => testigo.say('texto') }), true);
    m.pasar(3000);
    m.d.setPaused(true); m.pasar(20000); m.d.setPaused(false);
    m.pasar(2900);
    assert.deepEqual(testigo.dichos, []);
    m.pasar(200);
    assert.deepEqual(testigo.dichos, ['texto']);
  }
});

test('hay un solo puesto de espera: lo tiene quien pesa más y, a igual peso, quien llegó antes; los demás ponen su texto', () => {
  const m = director();
  assert.equal(m.d.decirRobo(persona('senora'), 'raponazo-sin-bolso'), true);
  const graba = persona('estudiante'), llama = persona('conductora'), grita = persona('conductor');
  assert.equal(m.d.decirTestigo(graba, 'grabar', { sinTurno: () => graba.say('me quitaron el puesto') }), true);
  assert.equal(m.d.decirTestigo(llama, 'llamar'), true, 'quien llama pesa más y se queda con el puesto');
  assert.deepEqual(graba.dichos.splice(0), ['me quitaron el puesto'], 'a quien le quitan el puesto pone su texto');
  assert.equal(m.d.decirTestigo(grita, 'robo'), false, 'a igual peso, el que ya esperaba');
  assert.equal(m.d.decirTestigo(graba, 'grabar'), false);
  m.acabar(); m.pasar(100);
  assert.equal(m.orden.at(-1), LLAMA);
  assert.deepEqual([graba.dichos, grita.dichos], [[], []]);
});

test('entre testigos todo sigue como antes: al que ya habla no se le espera ni se le corta por igual peso', () => {
  const m = director();
  const llama = persona('conductora'), graba = persona('estudiante'), grita = persona('conductor');
  assert.equal(m.d.decirTestigo(llama, 'llamar'), true);
  assert.equal(m.orden.at(-1), LLAMA, 'fuera de un robo arranca en el acto');
  assert.equal(m.d.decirTestigo(graba, 'grabar'), false, 'quien graba pone su texto');
  assert.equal(m.d.decirTestigo(grita, 'robo'), false);
  assert.equal(m.d._enEspera, null);
  // Uno que pesa más corta al que graba, sin dejarlo en espera, y le quita la burbuja.
  m.acabar();
  assert.equal(m.d.decirTestigo(graba, 'grabar'), true);
  assert.equal(m.d.decirTestigo(grita, 'robo'), true);
  assert.equal(graba.calladas.length, 1);
  assert.equal(graba.calladas[0], graba.dichos[0]);
  assert.equal(m.d._enEspera, null);
});

test('la voz que otra corta se lleva su burbuja; y si era un testigo que apenas empezaba, lo dice entero después', () => {
  const m = director();
  // Popó contra la gente al pasar: a quien hablaba se le quita la burbuja.
  const pasa = persona('abuelo');
  m.d.precargar(pasa);
  assert.equal(m.d.decir(pasa), true);
  assert.equal(m.d.decirPopo(persona('senora')), true);
  assert.deepEqual(pasa.calladas, pasa.dichos, 'la burbuja de lo que ya no suena se quita');
  assert.equal(m.d._enEspera, null, 'la gente al pasar no espera turno');
  m.acabar();
  // Popó contra el testigo que graba y apenas empezaba: se calla, sin burbuja, y lo dice después.
  const graba = persona('estudiante');
  assert.equal(m.d.decirTestigo(graba, 'grabar'), true);
  m.pasar(500);
  assert.equal(m.d.decirPopo(persona('abuelo')), true);
  assert.equal(graba.calladas.length, 1);
  m.pasar(1000);
  assert.equal(graba.dichos.length, 1);
  m.acabar(); m.pasar(100);
  assert.equal(graba.dichos.length, 2, 'vuelve a decirlo entero');
  assert.equal(graba.dichos[1], graba.dichos[0]);
  // Si ya llevaba más de un segundo hablando, solo se calla.
  m.pasar(1500);
  assert.equal(m.d.decirPopo(persona('senora')), true);
  assert.equal(graba.calladas.length, 2);
  m.acabar(); m.pasar(200);
  assert.equal(graba.dichos.length, 2);
  // Un carro: al conductor que contestaba lo corta la víctima de un robo y su burbuja se quita.
  const car = { kind: 'carro', position: new THREE.Vector3(3, 0, 0) };
  m.d.prepararConductor(car);
  assert.equal(m.d.decirConductor(car, 'semaforo_si'), true);
  assert.equal(m.d.decirRobo(persona('senora'), 'raponazo-sin-bolso'), true);
  assert.deepEqual(m.quitadas, [car]);
  // Cuando una frase acaba sola, o al pausar, nadie le quita la burbuja: se va a su tiempo.
  const otra = persona('nera');
  m.acabar();
  m.d.precargar(otra);
  assert.equal(m.d.decir(otra), true);
  m.d.setPaused(true); m.d.setPaused(false);
  assert.deepEqual(otra.calladas, []);
});

test('la Policía contra los testigos: el testigo espera a que la patrulla termine de gritar y habla enseguida', () => {
  const m = director();
  const patrulla = { position: new THREE.Vector3(8, 0, 0) };
  const grito = [{ id: 'policia_a_grito_1', audio: '/audio/voces/policia_a_grito_1.mp3', text: '¡Alto, Policía!', voz: 'policia_a' }];
  assert.equal(m.d.decirDesde(m.d.desde(patrulla), grito, { prioridad: PRIORIDAD_VOZ.policeShout, clave: 'grito', rango: 26, pleno: 0 }), true);
  const testigo = persona('conductora');
  assert.equal(m.d.decirTestigo(testigo, 'llamar'), true);
  assert.deepEqual(testigo.dichos, []);
  m.pasar(1000);
  assert.equal(m.orden.length, 1);
  m.acabar(); m.pasar(100);
  assert.deepEqual(m.orden, ['policia_a_grito_1', LLAMA]);
  assert.deepEqual(m.cortadas, []);
});

test('una pelea no es un robo: el testigo grita en el acto, como siempre', () => {
  const scene = new THREE.Scene();
  const m = director();
  const golpeado = peaton(scene, 1, 'senora'), testigo = peaton(scene, 4, 'conductora');
  const game = robo(m.d, [golpeado, testigo]);
  assert.equal(game.witnesses.report('pelea', [golpeado]), 1);
  assert.equal(m.orden.at(-1), LLAMA, 'sin esperar al siguiente cuadro');
  game.witnesses.dispose();
});

test('el peatón de verdad se quita la burbuja solo si todavía dice lo que se cortó', () => {
  const previo = globalThis.document;
  const puestas = [];
  globalThis.document = {
    getElementById: () => null, body: { appendChild() {} },
    createElement: () => { const el = { style: {}, remove() { el.quitada = true; } }; puestas.push(el); return el; },
  };
  try {
    const npc = new Npc(new THREE.Scene(), new THREE.Vector3(1, 0, 0), { look: {} });
    npc.say('¿Aló, Policía?', 3);
    npc.callar('otra cosa');
    assert.equal(puestas[0].quitada, undefined);
    assert.ok(npc._bubbleTimer > 0);
    npc.callar('¿Aló, Policía?');
    assert.equal(puestas[0].quitada, true);
    assert.equal(npc._bubbleEl, null);
    assert.equal(npc._bubbleTimer, 0);
    npc.callar('¿Aló, Policía?');
  } finally {
    globalThis.document = previo;
  }
});
