// La voz de alguien a quien el jugador le pega: quién tiene frase, cuándo se pide su audio, a quién corta, cada cuánto
// puede gritar, y que el peatón hace lo mismo de siempre (daño, huida, azar) con voz o sin ella.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { FRASES } from '../src/data/vocesCalle.js';
import { PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { GOLPEADO, VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { esElJugador } from '../src/systems/voces/acceso.js';
import { Npc } from '../src/entities/Npc.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
});

let nextId = 0;
class FakeHowl {
  constructor(options = {}) { this.options = options; this.voices = new Map(); this.loaded = true; }
  state() { return this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.voices.set(id, { playing: this.loaded }); return id; }
  playing(id) { return !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  acabar() { for (const v of this.voices.values()) v.playing = false; }
  volume() {} once() {} rate() {} stereo() {} unload() {}
  duration() { return 2; }
}

function director({ cargado = true } = {}) {
  let ahora = 0;
  const d = new VoiceDirector({ load: file => { const h = new FakeHowl({ file }); h.loaded = cargado; return h; }, random: () => .5, now: () => ahora });
  const oyente = new THREE.Vector3();
  d.update(oyente, []);
  return { d, pasar(ms, gente = []) { for (let t = 0; t < ms; t += 100) { ahora += 100; d.update(oyente, gente); } },
    acabar() { for (const h of d._sounds.values()) h.acabar(); }, archivos: () => [...d._sounds.keys()].map(f => f.replace(/^voces\//, '')).sort() };
}
const persona = (voz, at = [1, 0, 0]) => ({ _voz: voz, position: new THREE.Vector3(...at), dichos: [], say(text, s) { this.dichos.push([text, s]); }, callar() {} });

/** Corre `fn` contando las tiradas de Math.random, todas con el mismo valor. */
function contarAzar(valor, fn) {
  const real = Math.random; let tiradas = 0;
  Math.random = () => { tiradas++; return valor; };
  try { fn(); } finally { Math.random = real; }
  return tiradas;
}

test('solo el ñero viejo y el reciclador tienen qué gritar cuando les pegan, y pesa más que los testigos', () => {
  const porId = new Map(FRASES.map(f => [f.id, f]));
  assert.deepEqual(GOLPEADO.frases.map(id => porId.get(id).text), ['¡Lleguen, lleguen, que aquí hay un sapo!', '¡Quieto, patrón, que eso no es así!']);
  assert.equal(GOLPEADO.cada, 8000);
  assert.equal(PRIORIDAD_VOZ.hit, 80);
  assert.ok(PRIORIDAD_VOZ.hit > PRIORIDAD_VOZ.policeShout && PRIORIDAD_VOZ.hit < PRIORIDAD_VOZ.robbed);
  const { d } = director();
  assert.deepEqual(d.frasesGolpeado(persona('nero_viejo')).map(f => f.id), ['nero_viejo_pelea_1'], 'no «¡Denle, denle, que es rata!»');
  assert.deepEqual(d.frasesGolpeado(persona('reciclador')).map(f => f.id), ['reciclador_pelea_1']);
  for (const voz of ['nera', 'nero_pelado', 'senora', 'abuelo', 'conductor']) assert.deepEqual(d.frasesGolpeado(persona(voz)), [], voz);
});

test('a quien le pegan lo grita con su voz y su burbuja, a lo sumo una vez cada ocho segundos', () => {
  const m = director();
  const reciclador = persona('reciclador');
  assert.equal(m.d.decirGolpeado(reciclador), true);
  assert.equal(m.d.ultima.id, 'reciclador_pelea_1');
  assert.deepEqual(reciclador.dichos, [['¡Quieto, patrón, que eso no es así!', 2.4]]);
  assert.equal(m.d._voz.prioridad, 80);
  m.acabar();
  m.pasar(7900);
  assert.equal(m.d.decirGolpeado(reciclador), false, 'gritó hace poco: pone su texto');
  m.pasar(200);
  assert.equal(m.d.decirGolpeado(reciclador), true);
  // Quien no tiene frase, o sin audio cargado, no suena.
  assert.equal(m.d.decirGolpeado(persona('senora')), false);
  assert.equal(m.d.decirGolpeado(null), false);
  const sinCargar = director({ cargado: false });
  const nero = persona('nero_viejo');
  assert.equal(sinCargar.d.decirGolpeado(nero), false);
  assert.deepEqual(sinCargar.archivos(), ['nero_viejo_pelea_1.mp3'], 'pero queda pedido');
  for (const h of sinCargar.d._sounds.values()) h.loaded = true;
  assert.equal(sinCargar.d.decirGolpeado(nero), true, 'y no gastó su pausa sin sonar');
});

test('corta a la gente al pasar; espera a la víctima de un robo; y el testigo de la pelea habla después de él', () => {
  const m = director();
  const pasa = persona('abuelo');
  m.d.precargar(pasa);
  assert.equal(m.d.decir(pasa), true);
  assert.equal(m.d.decirGolpeado(persona('nero_viejo')), true);
  assert.equal(m.d.ultima.id, 'nero_viejo_pelea_1');
  // El testigo de la pelea espera su turno y habla en cuanto el golpeado termina.
  const testigo = persona('senora', [3, 0, 0]);
  assert.equal(m.d.decirTestigo(testigo, 'pelea'), true);
  assert.deepEqual(testigo.dichos, []);
  m.acabar(); m.pasar(100);
  assert.equal(m.d.ultima.id, 'senora_testigo_pelea_1');
  assert.equal(testigo.dichos.length, 1);
  m.acabar();
  const victima = { ...persona('senora'), look: { real: { accesorios: [] } } };
  assert.equal(m.d.decirRobo(victima, 'raponazo-sin-bolso'), true);
  assert.equal(m.d.decirGolpeado(persona('reciclador')), false, 'la víctima de un robo pesa más');
});

test('el audio de lo que gritaría se pide con la persona ya cerca, junto con lo que dice al pasar', () => {
  const m = director({ cargado: false });
  const lejos = persona('reciclador', [9, 0, 0]);
  m.pasar(1100, [lejos]);
  assert.deepEqual(m.archivos(), []);
  lejos.position.x = 4;
  m.pasar(1100, [lejos]);
  assert.ok(m.archivos().includes('reciclador_pelea_1.mp3'));
});

test('con un peatón de verdad: si le pega el jugador y tiene voz, no sale la queja en texto; lo demás y el azar, igual', () => {
  const scene = new THREE.Scene();
  const correr = (voces, { quienPega = 'jugador' } = {}) => {
    const jugador = { position: new THREE.Vector3(0, 0, 0) };
    window.__game = { player: jugador, audio: voces ? { voces } : undefined };
    const npc = new Npc(scene, new THREE.Vector3(1, 0, 0), { look: {} });
    const textos = [];
    npc.say = (texto, s) => textos.push([texto, s]);
    const attacker = quienPega === 'jugador' ? jugador : quienPega === 'otro' ? { position: new THREE.Vector3(0, 0, 0) } : null;
    const tiradas = contarAzar(.1, () => npc.takeHit({ damage: 5, attacker, attackId: 1 }));
    return { npc, textos, tiradas, salud: npc.health, huye: npc.fleeTimer, burbuja: npc._bubbleTimer };
  };
  const deSiempre = correr(null);
  assert.equal(deSiempre.textos.length, 1);
  assert.equal(deSiempre.textos[0][1], 4);
  const gritos = [];
  const conVoz = correr({ decirGolpeado(npc) { gritos.push(npc); return true; } });
  assert.deepEqual(gritos, [conVoz.npc]);
  assert.deepEqual(conVoz.textos, [], 'ya lo dijo con su voz y su burbuja');
  assert.equal(conVoz.burbuja, 4, 'y no vuelve a quejarse antes que con la burbuja de texto');
  assert.equal(conVoz.salud, deSiempre.salud);
  assert.equal(conVoz.huye, deSiempre.huye);
  assert.equal(conVoz.tiradas, deSiempre.tiradas, 'la voz no gasta ni ahorra azar del juego');
  // Sin frase para su voz, o si no fue el jugador (otro, o un carro), la queja de siempre.
  const sinFrase = correr({ decirGolpeado: () => false });
  assert.deepEqual(sinFrase.textos, deSiempre.textos);
  assert.equal(sinFrase.tiradas, deSiempre.tiradas);
  for (const quienPega of ['otro', 'carro']) {
    const ajeno = correr({ decirGolpeado() { throw new Error('no debe pedir la voz'); } }, { quienPega });
    assert.equal(ajeno.textos.length, 1, quienPega);
  }
  assert.equal(esElJugador(null), false);
  window.__game = undefined;
  assert.equal(esElJugador({}), false);
});
