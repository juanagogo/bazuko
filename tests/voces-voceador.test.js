// El voceador del bus (voces/VocesDelMundo.js): vocea una vez por parada, con el bus detenido y el jugador cerca, sin
// hablar encima de nadie y con la burbuja encima del bus.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { frasesDe } from '../src/data/vocesCalle.js';
import { PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { VOCEADOR_BUS, VocesDelMundo } from '../src/systems/voces/VocesDelMundo.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
});

let nextId = 0;
class FakeHowl {
  constructor(options = {}) { this.options = options; this.voices = new Map(); this.loaded = true; }
  state() { return this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.voices.set(id, { playing: this.loaded }); return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  pause(id) { this.stop(id); }
  volume(value, id) { if (value === undefined) return this.voices.get(id)?.volume; if (this.voices.has(id)) this.voices.get(id).volume = value; }
  once() {} on() {} off() {} rate() {} stereo() {} fade() {} loop() {} pos() {}
  seek() { return 0; }
  duration() { return 2; }
  unload() {}
}

const bus = (x, dwell = 0) => ({ position: new THREE.Vector3(x, 0, 0), group: { visible: true }, dwellRemaining: dwell, speed: 0 });

function montar({ cargado = true } = {}) {
  const burbujas = [];
  const voces = new VoiceDirector({
    load: file => { const h = new FakeHowl({ file }); h.loaded = cargado; return h; },
    burbuja: (...a) => burbujas.push(a), random: () => .5, now: () => 0,
  });
  const mundo = new VocesDelMundo({ voces, eventTarget: window, random: () => .5 });
  const oyente = new THREE.Vector3();
  voces.update(oyente, []);
  const pasar = (buses, veces = 1) => { for (let i = 0; i < veces; i++) { voces.update(oyente, []); mundo.update(.1, oyente, [], buses); } };
  return { voces, mundo, burbujas, pasar, callar: () => voces.cancel(), archivos: () => [...voces._sounds.keys()].map(f => f.replace(/^voces\//, '')).sort() };
}

test('la lista trae las cuatro frases del voceador y pesa menos que todo, menos la gente al pasar', () => {
  assert.equal(frasesDe('voceador', 'busetero').length, 4);
  assert.equal(PRIORIDAD_VOZ.busCaller, 25);
  assert.ok(PRIORIDAD_VOZ.busCaller > PRIORIDAD_VOZ.ambient && PRIORIDAD_VOZ.busCaller < PRIORIDAD_VOZ.dealerWhisper);
  assert.deepEqual(VOCEADOR_BUS, { rango: 20, nivel: .85, precarga: 30, alto: 3.15 });
});

test('el bus que para cerca vocea una vez por parada, con la burbuja encima del bus', () => {
  const m = montar();
  const b = bus(12);
  m.pasar(b, 5);
  assert.equal(m.voces.ultima, null, 'andando no vocea');
  b.dwellRemaining = 4;
  m.pasar(b);
  assert.match(m.voces.ultima.id, /^busetero_voceador_\d$/);
  assert.deepEqual(m.burbujas, [[b, m.voces.ultima.text, 2.4, 3.15]], 'a la altura del techo del bus');
  assert.equal(m.voces._voz.prioridad, 25);
  assert.equal(m.voces._voz.rango, 20);
  assert.equal(m.voces._voz.nivel, .85);
  m.callar();
  m.pasar(b, 30);
  assert.equal(m.burbujas.length, 1, 'en la misma parada no repite');
  // Arranca y vuelve a parar: otra parada, otra voceada, con otra frase.
  b.dwellRemaining = 0; m.pasar(b);
  b.dwellRemaining = 4; m.pasar(b);
  assert.equal(m.burbujas.length, 2);
  assert.notEqual(m.burbujas[1][1], m.burbujas[0][1]);
});

test('lejos, escondido o con alguien hablando no vocea; si se desocupa el canal mientras sigue parado, sí', () => {
  const lejos = montar();
  const b = bus(31, 4);
  lejos.pasar(b, 3);
  assert.deepEqual(lejos.archivos(), [], 'a más de 30 m ni se pide su audio');
  b.position.x = 25;
  lejos.pasar(b, 3);
  assert.equal(lejos.archivos().length, 4);
  assert.equal(lejos.voces.ultima, null, 'a más de 20 m no vocea');
  b.position.x = 19; b.group.visible = false;
  lejos.pasar(b, 3);
  assert.equal(lejos.voces.ultima, null, 'un bus que no se ve no vocea');
  b.group.visible = true;
  lejos.pasar(b);
  assert.equal(lejos.voces.ultima.voz, 'busetero');

  const ocupado = montar();
  const pasa = { _voz: 'abuelo', position: new THREE.Vector3(1, 0, 0), say() {} };
  ocupado.voces.precargar(pasa);
  assert.equal(ocupado.voces.decir(pasa), true);
  const otro = bus(10, 4);
  ocupado.pasar(otro, 5);
  assert.equal(ocupado.voces.ultima.voz, 'abuelo', 'no habla encima de quien dice algo al pasar');
  ocupado.callar();
  ocupado.pasar(otro);
  assert.equal(ocupado.voces.ultima.voz, 'busetero');
  // Varios buses: vocea cada uno en su parada, de a uno.
  const dos = montar();
  const b1 = bus(8, 4), b2 = bus(-9, 4);
  dos.pasar([b1, b2]);
  assert.equal(dos.burbujas.length, 1);
  assert.equal(dos.burbujas[0][0], b1);
  dos.callar();
  dos.pasar([b1, b2]);
  assert.equal(dos.burbujas.length, 2);
  assert.equal(dos.burbujas[1][0], b2);
  // Sin bus no pasa nada.
  dos.pasar(null); dos.pasar(undefined);
});

test('el juego de verdad: el audio general le pasa el bus a la pieza', () => {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  const burbujas = [];
  audio.voces.burbuja = (...a) => burbujas.push(a);
  const b = bus(15, 4), oyente = new THREE.Vector3();
  audio.updateWorld(.1, oyente, null, [], b, []);
  audio.updateWorld(.1, oyente, null, [], b, []);
  assert.equal(audio.voces.ultima?.voz, 'busetero');
  assert.match(audio.voces.ultima.id, /^busetero_voceador_\d$/);
  assert.equal(burbujas[0][0], b);
  assert.equal(burbujas[0][3], 3.15);
  audio.dispose();
});
