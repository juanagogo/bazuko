// La voz de quien recibe un popó: qué frase grita cada voz, cuándo se pide su audio, a quién corta y a quién espera,
// y que el peatón hace lo mismo de siempre (mancha, huida y monedas) con voz o sin ella.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { FRASES, frasesDe } from '../src/data/vocesCalle.js';
import { PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { DIRECTOR, VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { vocesDelJuego } from '../src/systems/voces/acceso.js';
import { PoopSystem } from '../src/systems/PoopSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { ITEMS } from '../src/data/items.js';
import { Npc } from '../src/entities/Npc.js';

let eventos;
beforeEach(() => {
  eventos = [];
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
  for (const tipo of ['toast', 'npc-dropped-loot']) window.addEventListener(tipo, e => eventos.push(e));
});
const avisos = () => eventos.filter(e => e.type === 'toast').map(e => e.detail.text);

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

function director({ cargado = true } = {}) {
  const d = new VoiceDirector({ load: file => { const h = new FakeHowl({ file }); h.loaded = cargado; return h; }, random: () => .5, now: () => 0 });
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

test('hay una frase de popó por voz: doce voces, doce frases', () => {
  const lista = FRASES.filter(f => f.situacion === 'popo');
  assert.equal(lista.length, 12);
  assert.equal(new Set(lista.map(f => f.voz)).size, 12);
  assert.deepEqual(frasesDe('popo', 'vendedora'), [], 'la vendedora no tiene: grita en texto');
});

test('a quien le cae popó lo grita con su voz y su burbuja, con el peso del popó', () => {
  const d = director();
  const senora = persona('senora');
  assert.equal(d.decirPopo(senora), true);
  assert.equal(d.ultima.id, 'senora_popo_1');
  assert.deepEqual(senora.dichos, [['¡Ay, qué asco! ¡Cochino!', 2.4]]);
  assert.equal(d._voz.prioridad, PRIORIDAD_VOZ.poop);
  assert.equal(PRIORIDAD_VOZ.poop, 60);
  assert.equal(d._voz.rango, DIRECTOR.rango);
});

test('corta a la gente al pasar y a la calle; espera a la víctima de un robo, a un testigo y a otro popó', () => {
  const d = director();
  const abuelo = persona('abuelo'), senora = persona('senora');
  d.precargar(abuelo);
  assert.equal(d.decir(abuelo), true);
  assert.equal(d.decirPopo(senora), true, 'corta lo que decía alguien al pasar');
  assert.equal(d.decirPopo(persona('estudiante')), false, 'a igual peso, la que ya suena sigue');
  d.cancel();
  let callo = 0;
  d.pesoOtraVoz = () => 30; d.callarOtras = () => callo++;
  assert.equal(d.decirPopo(senora), true);
  assert.equal(callo, 1, 'calla la frase de la calle');
  d.cancel(); d.pesoOtraVoz = () => 0;
  const victima = { ...persona('senora'), look: { real: { accesorios: [] } } };
  d.prepararRobo(victima);
  assert.equal(d.decirRobo(victima, 'raponazo-sin-bolso'), true);
  assert.equal(d.decirPopo(persona('abuelo')), false, 'la víctima de un robo pesa más');
  d.cancel();
  const testigo = persona('conductora');
  d.prepararTestigo(testigo);
  assert.equal(d.decirTestigo(testigo, 'llamar'), true);
  assert.equal(d.decirPopo(persona('abuelo')), false, 'el testigo que llama pesa más');
});

test('sin audio cargado, sin frase para su voz, lejos o en pausa no suena y devuelve false', () => {
  const sinCargar = director({ cargado: false });
  assert.equal(sinCargar.decirPopo(persona('senora')), false);
  assert.deepEqual(archivos(sinCargar), ['senora_popo_1.mp3'], 'pero queda pedido');
  const d = director();
  assert.equal(d.decirPopo(persona('vendedora')), false);
  assert.equal(d.decirPopo(persona('senora', [DIRECTOR.rango + 1, 0, 0])), false);
  d.setPaused(true);
  assert.equal(d.decirPopo(persona('senora')), false);
  assert.equal(d.decirPopo(null), false);
});

test('al lanzar el popó se piden las voces de quienes están a menos de 14 m, y solo las de popó', () => {
  const d = director({ cargado: false });
  const inventory = new InventorySystem();
  inventory.add(ITEMS.popo, 1);
  const cerca = persona('abuelo', [10, 0, 16]), lejos = persona('senora', [10, 0, 30]);
  const sistema = new PoopSystem(new THREE.Scene(), { voces: d }, inventory, null, { active: { npcs: [cerca, lejos], getGroundHeight: () => 0 } });
  assert.deepEqual(archivos(d), [], 'nada antes de lanzar');
  assert.equal(sistema.throwPoop({ position: new THREE.Vector3(10, 0, 10), root: new THREE.Group() }), true);
  assert.deepEqual(archivos(d), ['abuelo_popo_1.mp3']);
  // Sin audio (pruebas, sala) lanza igual.
  inventory.add(ITEMS.popo, 1);
  const mudo = new PoopSystem(new THREE.Scene(), null, inventory, null, { active: { npcs: [cerca], getGroundHeight: () => 0 } });
  assert.equal(mudo.throwPoop({ position: new THREE.Vector3(10, 0, 10), root: new THREE.Group() }), true);
});

test('con un peatón de verdad: con su voz no sale el grito en texto, y la mancha, la huida, las monedas y el azar son los mismos', () => {
  const scene = new THREE.Scene();
  const correr = (voces) => {
    eventos.length = 0;
    window.__game = voces ? { audio: { voces } } : undefined;
    const npc = new Npc(scene, new THREE.Vector3(2, 0, 0), { look: {} });
    const tiradas = contarAzar(.1, () => npc.hitByPoop(new THREE.Vector3()));
    return { npc, tiradas, huye: npc.fleeTimer, mancha: !!npc.splatMesh && npc.isSplatted, gritos: avisos(),
      monedas: eventos.filter(e => e.type === 'npc-dropped-loot').map(e => e.detail.amount) };
  };
  const deSiempre = correr(null);
  assert.equal(vocesDelJuego(), null);
  assert.equal(deSiempre.gritos.length, 1);
  const llamados = [];
  const conVoz = correr({ decirPopo(npc) { llamados.push(npc); return true; } });
  assert.equal(llamados.length, 1);
  assert.equal(llamados[0], conVoz.npc);
  assert.deepEqual(conVoz.gritos, [], 'ya lo dijo con su voz y su burbuja');
  assert.equal(conVoz.mancha, true);
  assert.equal(conVoz.huye, deSiempre.huye);
  assert.ok(conVoz.huye > 0);
  assert.deepEqual(conVoz.monedas, deSiempre.monedas);
  assert.equal(conVoz.tiradas, deSiempre.tiradas, 'la voz no gasta ni ahorra azar del juego');
  // Si su voz no tiene frase lista, el grito de siempre.
  const sinFrase = correr({ decirPopo: () => false });
  assert.equal(sinFrase.gritos.length, 1);
  assert.equal(sinFrase.tiradas, deSiempre.tiradas);
});
