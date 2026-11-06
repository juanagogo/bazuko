import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BURBUJAS, Burbujas, Hablante } from '../src/ui/burbujaVoz.js';
import { GESTO_HABLAR, gestoHablar } from '../src/character/gestoHablar.js';
import { decirFrase } from '../src/systems/voces/hablar.js';

/** Un documento mínimo: solo lo que la burbuja usa. */
function documento() {
  const hijos = [];
  const contenedor = { appendChild(el) { hijos.push(el); el.remove = () => hijos.splice(hijos.indexOf(el), 1); } };
  return { hijos, doc: { getElementById: id => (id === 'npc-bubbles-container' ? contenedor : null), createElement: () => ({ style: {}, offsetWidth: 120, offsetHeight: 30 }) } };
}

test('quien no es peatón (la patrulla, el bus, un carro) tiene su subtítulo, que lo sigue y se va solo', () => {
  const { doc, hijos } = documento();
  const patrulla = { position: new THREE.Vector3(1, 0, 2) };
  const hablante = new Hablante(patrulla, { doc, offsetY: 1.2 });
  assert.equal(hablante.decir('¡Quieto ahí!', 1), true);
  assert.equal(hijos.length, 1);
  assert.equal(hijos[0].textContent, '¡Quieto ahí!');
  assert.equal(hijos[0].className, 'npc-bubble');
  assert.equal(hablante.position.y, 1.2);
  patrulla.position.x = 5;
  hablante.update(.5);
  assert.equal(hablante.position.x, 5, 'sigue a quien habla');
  hablante.update(1.1); // nunca menos de 1,5 s
  assert.equal(hijos.length, 0);
  assert.equal(hablante.hablando, false);
});

test('a lo sumo tres subtítulos: uno por fuente y, si sobra, se va el más viejo', () => {
  const { doc, hijos } = documento();
  const burbujas = new Burbujas({ doc });
  const fuentes = Array.from({ length: 4 }, (_, i) => ({ position: new THREE.Vector3(i, 0, 0) }));
  for (const fuente of fuentes) burbujas.decir(fuente, `frase ${fuente.position.x}`, 2);
  assert.equal(burbujas.vivos, BURBUJAS.maximo);
  assert.deepEqual(hijos.map(el => el.textContent), ['frase 1', 'frase 2', 'frase 3']);
  // La misma fuente reemplaza lo que decía.
  burbujas.decir(fuentes[3], 'otra', 2);
  assert.equal(burbujas.vivos, 3);
  assert.equal(hijos.filter(el => el.textContent.startsWith('frase 3')).length, 0);
  burbujas.update(3);
  assert.equal(burbujas.vivos, 0);
  assert.equal(hijos.length, 0);
  burbujas.decir(fuentes[0], 'hola', 2);
  burbujas.clear();
  assert.equal(hijos.length, 0);
  assert.equal(burbujas.decir({}, 'sin sitio', 2), false);
});

test('hallazgo 13: la burbuja del peatón sale cuando la voz empieza y dura lo que dura la grabación', () => {
  const dichos = [];
  const npc = { say: (text, seconds) => dichos.push({ text, seconds }) };
  let inicio = null;
  npc.audio = { playNpcVoice: (_path, _owner, opts) => { inicio = opts.onStart; return false; }, lastRefusal: 'espera' };
  const entry = { audio: '/audio/voces/senora_robado_1.mp3', text: '¡Me robaron!', voz: 'senora' };
  assert.equal(decirFrase(npc, entry, 'robbed'), true);
  assert.equal(dichos.length, 0, 'mientras carga no hay burbuja');
  inicio(2.6);
  assert.deepEqual(dichos, [{ text: '¡Me robaron!', seconds: 3 }]);
  assert.equal(npc._vozOida, true);
  assert.ok(npc._hablaHasta - npc._hablaDesde === 2600);
  // Una frase corta deja la burbuja al menos 1,5 s.
  dichos.length = 0;
  npc.audio = { playNpcVoice: (_p, _o, opts) => { opts.onStart(.4); return true; } };
  decirFrase(npc, entry, 'robbed');
  assert.deepEqual(dichos.map(d => d.seconds), [1.5]);
});

test('hallazgo 13: si otra voz pesa más, el peatón no deja burbuja muda; lejos o sin audio sí queda el subtítulo', () => {
  const dichos = [];
  const npc = { say: (text, seconds) => dichos.push(seconds) };
  const entry = { audio: '/audio/voces/senora_ambiente_1.mp3', text: 'Ay, Dios.' };
  const pidio = [];
  npc.audio = { playNpcVoice: (_p, _o, opts) => { pidio.push(opts.priority); return false; }, lastRefusal: 'ocupado' };
  assert.equal(decirFrase(npc, entry, 'ambient'), false);
  assert.deepEqual(dichos, []);
  assert.deepEqual(pidio, [20], 'pide el canal con el peso de su situación');
  npc.audio.lastRefusal = 'lejos';
  assert.equal(decirFrase(npc, entry, 'ambient'), true);
  assert.deepEqual(dichos, [3.5]);
  npc.audio = null;
  delete npc.audio;
  assert.equal(decirFrase(npc, entry, 'ambient'), true);
  assert.deepEqual(dichos, [3.5, 3.5]);
});

test('la cabeza se mueve solo mientras habla, de cerca y con el modelo completo', () => {
  const cuerpo = {};
  const npc = { character: cuerpo, fullChar: cuerpo, _playerDist: 3, vozSemilla: 1234, _hablaDesde: 1000, _hablaHasta: 2000 };
  assert.equal(gestoHablar(npc, 900), 0, 'antes de hablar');
  assert.equal(gestoHablar(npc, 2100), 0, 'después de hablar');
  assert.equal(gestoHablar(npc, 1000), 0, 'entra desde cero');
  let maximo = 0;
  for (let t = 1000; t <= 2000; t += 5) maximo = Math.max(maximo, Math.abs(gestoHablar(npc, t)));
  assert.ok(maximo > .02 && maximo <= GESTO_HABLAR.amplitud, `un vaivén leve (${maximo.toFixed(3)} rad)`);
  assert.equal(gestoHablar({ ...npc, _playerDist: 12 }, 1500), 0, 'lejos no se nota: no se calcula');
  assert.equal(gestoHablar({ ...npc, character: {} }, 1500), 0, 'con el modelo liviano no hay cabeza que mover');
  assert.equal(gestoHablar({}, 1500), 0);
  assert.equal(gestoHablar(null, 1500), 0);
});
