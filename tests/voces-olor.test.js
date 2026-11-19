// La voz de quien se tapa la nariz por el olor del jugador: qué frase dice cada voz, que sale por sorteo, a quién
// corta y a quién espera, y que el peatón hace lo mismo de siempre (taparse, huir, esperar) con voz o sin ella.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { FRASES, frasesDe } from '../src/data/vocesCalle.js';
import { PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { DIRECTOR, OLOR, VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { Npc } from '../src/entities/Npc.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
});

let nextId = 0;
class FakeHowl {
  constructor(options = {}) { this.options = options; this.voices = new Map(); this.loaded = true; }
  state() { return this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.voices.set(id, { playing: this.loaded }); return id; }
  playing(id) { return !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  volume(value, id) { if (this.voices.has(id)) this.voices.get(id).volume = value; }
  once() {} rate() {} stereo() {}
  duration() { return 2; }
  unload() {}
}

function director({ cargado = true, azar = 0 } = {}) {
  const d = new VoiceDirector({ load: file => { const h = new FakeHowl({ file }); h.loaded = cargado; return h; }, random: () => azar, now: () => 0 });
  d.update(new THREE.Vector3(), []);
  return d;
}
const persona = (voz, at = [1, 0, 0]) => ({ _voz: voz, position: new THREE.Vector3(...at), dichos: [], say(text, s) { this.dichos.push([text, s]); } });
const archivos = d => [...d._sounds.keys()].map(f => f.replace(/^voces\//, '')).sort();

/** Corre `fn` contando las tiradas de Math.random, todas con el mismo valor. */
function contarAzar(valor, fn) {
  const real = Math.random; let tiradas = 0;
  Math.random = () => { tiradas++; return valor; };
  try { fn(); } finally { Math.random = real; }
  return tiradas;
}

test('hay una frase de olor para nueve voces', () => {
  const lista = FRASES.filter(f => f.situacion === 'olor');
  assert.equal(lista.length, 9);
  assert.equal(new Set(lista.map(f => f.voz)).size, 9);
  assert.deepEqual(frasesDe('olor', 'vendedora'), [], 'la vendedora no tiene: se queja en texto');
});

test('quien se tapa la nariz lo dice con su voz y su burbuja, con el peso del olor', () => {
  const d = director();
  const abuelo = persona('abuelo');
  assert.equal(d.decirOlor(abuelo), true);
  assert.equal(d.ultima.id, 'abuelo_olor_1');
  assert.deepEqual(abuelo.dichos.map(([texto]) => texto), ['Uy, mijo, vaya báñese, por Dios.']);
  assert.equal(d._voz.prioridad, PRIORIDAD_VOZ.smell);
  assert.equal(PRIORIDAD_VOZ.smell, 40);
  assert.equal(d._voz.rango, DIRECTOR.rango);
});

test('sale por sorteo, 55 de cada 100 veces, y el sorteo es del director', () => {
  assert.equal(OLOR.azar, .55);
  const sale = director({ azar: .54 }), noSale = director({ azar: .55 });
  assert.equal(sale.decirOlor(persona('senora')), true);
  const callada = persona('senora');
  assert.equal(contarAzar(.1, () => assert.equal(noSale.decirOlor(callada), false)), 0, 'no toca el azar del juego');
  assert.deepEqual(callada.dichos, []);
  // Sin frase para su voz ni siquiera sortea.
  let tiradas = 0;
  const d = new VoiceDirector({ load: file => new FakeHowl({ file }), random: () => { tiradas++; return 0; }, now: () => 0 });
  d.update(new THREE.Vector3(), []);
  assert.equal(d.decirOlor(persona('vendedora')), false);
  assert.equal(tiradas, 0);
});

test('corta a la gente al pasar y a la calle; espera al popó, al semáforo, a los testigos y a otro olor', () => {
  const d = director();
  const abuelo = persona('abuelo'), senora = persona('senora');
  d.precargar(abuelo);
  assert.equal(d.decir(abuelo), true);
  assert.equal(d.decirOlor(senora), true, 'corta lo que decía alguien al pasar');
  assert.equal(d.decirOlor(persona('estudiante')), false, 'a igual peso, la que ya suena sigue');
  d.cancel();
  let callo = 0;
  d.pesoOtraVoz = () => 30; d.callarOtras = () => callo++;
  assert.equal(d.decirOlor(senora), true);
  assert.equal(callo, 1, 'calla la frase de la calle');
  d.cancel();
  d.pesoOtraVoz = () => 90;
  assert.equal(d.decirOlor(senora), false, 'el reclamo por el espejo pesa más');
  d.pesoOtraVoz = () => 0;
  assert.equal(d.decirPopo(persona('abuelo')), true);
  assert.equal(d.decirOlor(senora), false, 'el popó pesa más');
  d.cancel();
  const testigo = persona('estudiante');
  d.prepararTestigo(testigo);
  assert.equal(d.decirTestigo(testigo, 'grabar'), true);
  assert.equal(d.decirOlor(senora), false, 'el testigo que graba pesa más');
});

test('sin audio cargado, lejos o en pausa no suena y devuelve false; el audio queda pedido', () => {
  const sinCargar = director({ cargado: false });
  assert.equal(sinCargar.decirOlor(persona('senora')), false);
  assert.deepEqual(archivos(sinCargar), ['senora_olor_1.mp3']);
  const d = director();
  d.prepararOlor(persona('nera'));
  assert.deepEqual(archivos(d), ['nera_olor_1.mp3']);
  assert.equal(d.decirOlor(persona('senora', [DIRECTOR.rango + 1, 0, 0])), false);
  d.setPaused(true);
  assert.equal(d.decirOlor(persona('senora')), false);
  assert.equal(d.decirOlor(null), false);
});

test('con un peatón de verdad: su audio se pide al acercarse sucio, y con voz no sale la queja en texto', () => {
  const scene = new THREE.Scene();
  const correr = (voces) => {
    window.__game = voces ? { audio: { voces } } : undefined;
    const npc = new Npc(scene, new THREE.Vector3(2, 0, 0), { look: {} });
    const textos = [];
    npc.say = texto => textos.push(texto);
    npc._noseCooldown = 0;
    const jugador = npc.position.clone().add(new THREE.Vector3(1.5, 0, 0));
    const tiradas = contarAzar(.1, () => npc._updateConduct(.01, { player: jugador, hygiene: 5 }));
    return { npc, textos, tiradas, nariz: npc._noseTimer, espera: npc._noseCooldown, huye: npc.fleeTimer };
  };
  const deSiempre = correr(null);
  assert.equal(deSiempre.textos.length, 1);
  assert.ok(deSiempre.nariz > 0);
  const pedidos = [], dichos = [];
  const conVoz = correr({ prepararOlor: npc => pedidos.push(npc), decirOlor(npc) { dichos.push(npc); return true; } });
  assert.deepEqual(pedidos, [conVoz.npc]);
  assert.deepEqual(dichos, [conVoz.npc]);
  assert.deepEqual(conVoz.textos, [], 'ya lo dijo con su voz y su burbuja');
  assert.equal(conVoz.nariz, deSiempre.nariz);
  assert.equal(conVoz.espera, deSiempre.espera);
  assert.equal(conVoz.huye, deSiempre.huye);
  assert.equal(conVoz.tiradas, deSiempre.tiradas, 'la voz no gasta ni ahorra azar del juego');
  // Si el sorteo no sale o su voz no tiene frase, la queja de siempre.
  const sinFrase = correr({ decirOlor: () => false });
  assert.deepEqual(sinFrase.textos, deSiempre.textos);
  assert.equal(sinFrase.tiradas, deSiempre.tiradas);
});

test('el audio del olor se pide una sola vez por persona, y solo con el jugador sucio a menos de 9 m', () => {
  const pedidos = [];
  window.__game = { audio: { voces: { prepararOlor: npc => pedidos.push(npc), decirOlor: () => false } } };
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(2, 0, 0), { look: {} });
  npc.say = () => {};
  npc._noseCooldown = 99;
  const a = metros => npc.position.clone().add(new THREE.Vector3(metros, 0, 0));
  npc._updateConduct(.01, { player: a(5), hygiene: 90 });
  npc._updateConduct(.01, { player: a(10), hygiene: 5 });
  assert.equal(pedidos.length, 0, 'limpio o lejos no se pide');
  npc._updateConduct(.01, { player: a(8), hygiene: 5 });
  npc._updateConduct(.01, { player: a(4), hygiene: 5 });
  assert.equal(pedidos.length, 1);
});
