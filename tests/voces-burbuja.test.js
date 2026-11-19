// La burbuja de quien habla desde un vehículo sale encima de su techo: la de la buseta, más arriba que la de un carro.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeVehicle } from '../src/world/bogota/vehicles.js';
import { CAR_MODELS } from '../src/world/bogota/carModels.js';
import { ALTO_FRASE, actualizarFrases } from '../src/ui/frases.js';
import { altoDeFrase, fraseSuelta } from '../src/ui/fraseSuelta.js';
import { VoiceDirector } from '../src/systems/voces/VoiceDirector.js';

test('cada vehículo dice cuánto mide, y la burbuja va 30 cm sobre su techo, nunca más abajo que la de una persona', () => {
  assert.equal(ALTO_FRASE, 2.05);
  const buseta = makeVehicle('carro', 1, { beams: false, model: 'buseta' }), sedan = makeVehicle('carro', 1, { beams: false, model: 'sedanPopular' });
  assert.equal(buseta.height, CAR_MODELS.buseta.H);
  assert.equal(buseta.height, 3);
  assert.equal(sedan.height, 1.52);
  assert.ok(Math.abs(altoDeFrase({ vehicle: buseta }) - 3.3) < 1e-9);
  assert.equal(altoDeFrase({ vehicle: sedan }), 2.05, 'sobre un carro queda donde estaba');
  assert.equal(altoDeFrase({}), 2.05);
  assert.equal(altoDeFrase(null), 2.05);
  assert.ok(Math.abs(altoDeFrase({ vehicle: sedan }, 3.15) - 3.45) < 1e-9, 'la medida que se le pase manda (el bus)');
});

test('en pantalla la burbuja de la buseta sale encima del techo y la de un carro donde siempre', () => {
  const previo = { document: globalThis.document, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight, getComputedStyle: globalThis.getComputedStyle };
  const puestas = [];
  globalThis.document = {
    getElementById: () => null, querySelectorAll: () => [],
    createElement: () => { const el = { style: {}, offsetWidth: 120, offsetHeight: 24, remove() { el.quitada = true; } }; puestas.push(el); return el; },
    body: { appendChild() {} },
  };
  globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
  try {
    const camara = new THREE.PerspectiveCamera(60, 1280 / 720, .1, 200);
    camara.position.set(0, 1.6, 12); camara.lookAt(0, 1.6, 0); camara.updateMatrixWorld(true);
    const arriba = (vehicle, alto) => {
      const quien = { position: new THREE.Vector3(0, 0, 0), vehicle };
      fraseSuelta(quien, '¡Hágale, hágale, que voy de afán!', 2, alto);
      actualizarFrases(camara, camara.position, 1e9 + puestas.length);
      const el = puestas.at(-1);
      assert.equal(el.style.display, 'block');
      const pie = parseFloat(el.style.top) + 24; // la burbuja se apoya en su punto por abajo
      fraseSuelta(quien, null);
      assert.equal(el.quitada, true, 'sin texto se quita la que tenía');
      return pie;
    };
    // A 12 m con 60° de campo, un metro son 720 / (2 · 12 · tan 30°) píxeles.
    const pxPorMetro = 720 / (2 * 12 * Math.tan(Math.PI / 6));
    const carro = arriba({ height: 1.52 }), buseta = arriba({ height: 3 }), bus = arriba(undefined, 3.15);
    assert.ok(Math.abs(carro - (360 - (2.05 - 1.6) * pxPorMetro)) < 1.5, `carro ${carro}`);
    assert.ok(Math.abs(buseta - (360 - (3.3 - 1.6) * pxPorMetro)) < 1.5, `buseta ${buseta}`);
    assert.ok(Math.abs(bus - (360 - (3.45 - 1.6) * pxPorMetro)) < 1.5, `bus ${bus}`);
    assert.ok(buseta < 360 - (3 - 1.6) * pxPorMetro, 'por encima del techo de la buseta, no en las ventanas');
    // Pegado a la buseta su techo se sale por arriba: la burbuja se queda en el borde. La de un carro no cambia.
    camara.position.set(0, 1.6, 2.5); camara.lookAt(0, 1.6, 0); camara.updateMatrixWorld(true);
    assert.equal(arriba({ height: 3 }), 6 + 24, 'en el borde de arriba');
    assert.ok(arriba({ height: 1.52 }) > 6 + 24, 'la del carro sigue en su punto');
  } finally {
    Object.assign(globalThis, previo);
  }
});

test('el cartel de zona deja legible el saludo desde el cuadro en que entra', () => {
  const previo = { document: globalThis.document, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight, getComputedStyle: globalThis.getComputedStyle };
  const cartel = { hidden: true, textContent: 'El Cartucho', offsetTop: 310,
    getBoundingClientRect: () => ({ left: 500, top: 240, width: 280, height: 50 }) };
  const burbuja = { style: {}, offsetWidth: 160, offsetHeight: 24, remove() {} };
  const quien = { position: new THREE.Vector3() };
  const camara = new THREE.PerspectiveCamera(60, 1280 / 720, .1, 200);
  camara.position.set(0, 1.6, 12); camara.lookAt(0, 1.6, 0); camara.updateMatrixWorld(true);
  Object.assign(globalThis, {
    document: {
      getElementById: id => id === 'zona-cartel' ? cartel : null,
      querySelectorAll: selector => selector.includes('#zona-cartel') ? [cartel] : [],
      createElement: () => burbuja,
      body: { appendChild() {} }
    },
    innerWidth: 1280, innerHeight: 720,
    getComputedStyle: () => ({ visibility: 'visible', opacity: '0' })
  });
  try {
    fraseSuelta(quien, '¿Qué más, parcero? ¿Todo bien?', 2);
    actualizarFrases(camara, camara.position, 2e9);
    const original = parseFloat(burbuja.style.top);
    assert.ok(original < 360 && original + 24 > 310, 'la posición normal coincide con el cartel');

    cartel.hidden = false;
    actualizarFrases(camara, camara.position, 2e9 + 16);
    assert.equal(burbuja.style.display, 'block');
    assert.ok(parseFloat(burbuja.style.top) >= 365, 'pasa debajo del recorrido del cartel antes de que acabe la animación');
    assert.ok(parseFloat(burbuja.style.top) - original < 60, 'usa el sitio libre más cerca de quien habló');

    cartel.hidden = true;
    actualizarFrases(camara, camara.position, 2e9 + 32);
    assert.equal(parseFloat(burbuja.style.top), original);
  } finally {
    fraseSuelta(quien, null);
    Object.assign(globalThis, previo);
  }
});

test('el director le pasa a la burbuja la altura de quien no es un vehículo', () => {
  const burbujas = [];
  const d = new VoiceDirector({ load: () => null, burbuja: (...a) => burbujas.push(a) });
  const carro = { position: new THREE.Vector3() }, bus = { position: new THREE.Vector3() };
  d.desde(carro).say('a', 2);
  d.desde(bus, 3.15).say('b', 2);
  assert.deepEqual(burbujas, [[carro, 'a', 2], [bus, 'b', 2, 3.15]]);
  assert.equal(d.desde(bus), d.desde(bus, 3.15), 'cada quien tiene un solo sitio');
});
