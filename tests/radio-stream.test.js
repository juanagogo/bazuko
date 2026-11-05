// tests/radio-stream.test.js
// La radio también sintoniza emisoras reales: aquí se prueba el enganche de la señal en vivo
// sin tocar la red, con un elemento de audio de mentira en lugar del navegador.
import test from 'node:test';
import assert from 'node:assert/strict';

import { RadioSystem, STATIONS } from '../src/systems/RadioSystem.js';

const VIVO = STATIONS.filter((s) => s.kind === 'stream');
const emisora = (id) => STATIONS.find((s) => s.id === id);

/** Un <audio> de mentira: lo que se mira es lo que la radio le pide. */
function audioFalso({ hlsNativo = false, fallaPlay = false } = {}) {
  return {
    src: null, volume: 1, muted: false, preload: null, crossOrigin: null,
    reproducir: 0, pausas: 0, cargas: 0, quitados: [], oyentes: {},
    canPlayType: (tipo) => (hlsNativo && tipo === 'application/vnd.apple.mpegurl' ? 'maybe' : ''),
    addEventListener(tipo, fn) { (this.oyentes[tipo] ??= []).push(fn); },
    removeEventListener(tipo, fn) { this.oyentes[tipo] = (this.oyentes[tipo] ?? []).filter((f) => f !== fn); },
    play() { this.reproducir++; return fallaPlay ? Promise.reject(new Error('sin permiso')) : Promise.resolve(); },
    pause() { this.pausas++; },
    removeAttribute(nombre) { this.quitados.push(nombre); if (nombre === 'src') this.src = null; },
    load() { this.cargas++; },
    emitir(tipo) { for (const fn of [...(this.oyentes[tipo] ?? [])]) fn(); },
  };
}

const navegador = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

/** Un DOM mínimo: lo que la radio usa para crear el elemento y avisar por pantalla. */
function conDom({ hlsNativo = false, online = true, fallanLosPrimeros = 0 } = {}) {
  const creados = [];
  const sucesos = [];
  globalThis.document = { createElement: () => { const el = audioFalso({ hlsNativo, fallaPlay: creados.length < fallanLosPrimeros }); creados.push(el); return el; } };
  globalThis.window = { dispatchEvent: (e) => { sucesos.push(e); return true; } };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: online }, configurable: true });
  return { creados, sucesos };
}

function limpiar() {
  delete globalThis.document;
  delete globalThis.window;
  if (navegador) Object.defineProperty(globalThis, 'navigator', navegador);
  else delete globalThis.navigator;
}

/** La radio ya prendida dentro de un DOM de mentira; al terminar la prueba se apaga y se limpia. */
function montar(t, opciones = {}) {
  const dom = conDom(opciones);
  const radio = new RadioSystem();
  t.after(() => { radio.destroy(); limpiar(); });
  radio.turnOn();
  return { radio, ...dom };
}

test('Emisoras en vivo: datos completos, con la frecuencia que puede repetirse entre regiones', () => {
  assert.equal(VIVO.length, 14);
  assert.equal(STATIONS.length, 18);
  const ids = new Set();
  for (const st of VIVO) {
    assert.ok(!ids.has(st.id), st.id);
    ids.add(st.id);
    assert.match(st.url, /^https:\/\//, st.id);
    assert.ok(['MP3', 'AAC', 'AAC+', 'HLS'].includes(st.codec), `${st.id}: ${st.codec}`);
    assert.match(st.homepage, /^https:\/\//, st.id);
    assert.ok(st.name.length > 0 && st.region.length > 0, st.id);
    assert.equal(st.band, 'FM', st.id);
    assert.ok(st.freq >= 88 && st.freq <= 108, st.id);
  }
  // Dentro de la ciudad no se repite una frecuencia: los choques son entre ciudades.
  const bogota = STATIONS.filter((s) => s.region === 'Bogotá');
  assert.equal(new Set(bogota.map((s) => s.freq)).size, bogota.length);
  assert.equal(emisora('unradio-bogota').freq, 98.5, 'UN Radio conserva el 98,5 de verdad');
  assert.equal(emisora('rock').freq, 97.4, 'La Gotera le dejó el 98,5 a la emisora real');
});

test('Sintonizar una emisora en vivo engancha su señal en el elemento de audio', (t) => {
  const { radio, creados } = montar(t);
  assert.equal(creados.length, 0, 'una emisora inventada no descarga nada');

  radio.setStation(emisora('unradio-bogota'));
  const el = creados.at(-1);
  assert.equal(el.src, 'https://radio.unal.edu.co/streaming/bogota/');
  assert.equal(el.preload, 'none', 'no se descarga hasta que suene');
  assert.equal(el.crossOrigin, null, 'sin CORS: el elemento va pelado');
  assert.equal(el.reproducir, 1);
});

test('Volumen y silencio de la señal en vivo siguen al juego', (t) => {
  const { radio, creados } = montar(t);
  radio.setStation(emisora('javeriana'));
  const el = creados.at(-1);

  radio.setVolume(0.5);
  radio.setMasterVolume(0.8);
  assert.equal(el.volume, 0.4, 'volumen de la radio por el general');
  assert.equal(el.muted, false);

  radio.setMasterVolume(1, true);
  assert.equal(el.muted, true);
  radio.setMasterVolume(1, false);
  radio.setPaused(true);
  assert.equal(el.muted, true, 'la pausa también lo calla');
  radio.setPaused(false);
  assert.equal(el.muted, false);
  assert.equal(el.volume, 0.5);

  // Al sintonizar una emisora inventada se suelta la señal, y volver a una en vivo recupera el volumen.
  radio.setStation(emisora('rock'));
  assert.equal(radio._audioEl, null);
  radio.setStation(emisora('univalle'));
  assert.equal(creados.at(-1).volume, 0.5);
  assert.equal(creados.at(-1).muted, false);
});

test('Cambiar de emisora o apagar suelta el elemento: nada sigue descargando', (t) => {
  const { radio, creados } = montar(t);

  radio.setStation(emisora('unradio-bogota'));
  const primero = creados.at(-1);
  radio.setStation(emisora('univalle'));
  assert.equal(creados.length, 2);
  assert.equal(primero.pausas, 1);
  assert.equal(primero.src, null);
  assert.ok(primero.quitados.includes('src'));
  assert.equal(primero.cargas, 1, 'load() corta la descarga');
  assert.equal(radio._audioEl, creados.at(-1));

  const segundo = creados.at(-1);
  radio.turnOff();
  assert.equal(segundo.pausas, 1);
  assert.equal(segundo.src, null);
  assert.equal(radio._audioEl, null);
});

test('Si la señal falla queda la estática, avisa y no reintenta sola', (t) => {
  const { radio, creados, sucesos } = montar(t);
  radio.setStation(emisora('unradio-medellin'));
  const el = creados.at(-1);

  el.emitir('error');
  assert.equal(radio.isStreamDown(), true);
  assert.equal(radio._audioEl, null);
  assert.equal(el.src, null);
  assert.equal(creados.length, 1, 'no se reintenta solo');
  assert.ok(sucesos.some((e) => e.type === 'toast' && /estática/.test(e.detail.text)));

  radio.setStation(emisora('unicauca'));
  assert.equal(radio.isStreamDown(), false);
  radio.setStation(emisora('unradio-medellin'));
  assert.equal(creados.length, 3, 'volver a sintonizarla sí reintenta');
});

test('Un corte que no es error también deja la estática', (t) => {
  const { radio, creados } = montar(t);
  radio.setStation(emisora('uninorte'));
  const el = creados.at(-1);

  el.emitir('ended');
  assert.equal(radio.isStreamDown(), true);
  assert.equal(radio._audioEl, null);
  assert.equal(el.src, null);
});

test('Un parón que se recupera no tumba la emisora, y sin sonar quince segundos sí', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { radio, creados } = montar(t);
  radio.setStation(emisora('unradio-bogota'));
  const el = creados.at(-1);

  // `stalled` es de lo más normal en vivo: mientras la señal vuelva, la emisora sigue.
  el.emitir('stalled');
  t.mock.timers.tick(14_000);
  assert.equal(radio.isStreamDown(), false, 'catorce segundos de parón se perdonan');
  el.emitir('timeupdate');
  t.mock.timers.tick(60_000);
  assert.equal(radio.isStreamDown(), false);
  assert.equal(radio._audioEl, el);

  // Y `playing` también lo cancela, no solo `timeupdate`.
  el.emitir('waiting');
  t.mock.timers.tick(14_000);
  el.emitir('playing');
  t.mock.timers.tick(60_000);
  assert.equal(radio.isStreamDown(), false);
  assert.equal(radio._audioEl, el);
});

test('Un aviso de estancamiento no corre un plazo que ya va andando', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { radio, creados } = montar(t);
  radio.setStation(emisora('univalle'));
  const el = creados.at(-1);

  el.emitir('waiting');
  t.mock.timers.tick(10_000);
  assert.equal(radio.isStreamDown(), false, 'diez segundos se perdonan');
  el.emitir('stalled');
  el.emitir('waiting');
  t.mock.timers.tick(4_000);
  assert.equal(radio.isStreamDown(), false, 'quince segundos desde el play, no desde el último aviso');
  t.mock.timers.tick(1_000);
  assert.equal(radio.isStreamDown(), true);
  assert.equal(radio._audioEl, null);
  assert.equal(el.src, null);
});

test('Sin llegar a sonar en quince segundos, la emisora queda en la estática', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { radio, creados } = montar(t);
  radio.setStation(emisora('unicauca'));
  const el = creados.at(-1);

  t.mock.timers.tick(15_000);
  assert.equal(radio.isStreamDown(), true, 'quince segundos sin sonar');
  assert.equal(radio._audioEl, null);
  assert.equal(el.src, null);
});

test('Apagar la radio cancela el plazo de la señal', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { radio, sucesos } = montar(t);
  radio.setStation(emisora('unicauca'));

  const armado = radio._streamTimer;
  const cancelados = t.mock.method(globalThis, 'clearTimeout');
  radio.turnOff();
  assert.equal(cancelados.mock.calls[0]?.arguments[0], armado, 'apagar cancela el plazo armado');

  t.mock.timers.tick(60_000);
  assert.equal(sucesos.some((e) => e.type === 'toast' && /estática/.test(e.detail.text)), false);
});

test('Volver a pulsar la emisora caída la reintenta; apagar y prender también', (t) => {
  const { radio, creados } = montar(t);
  radio.setStation(emisora('univalle'));
  creados.at(-1).emitir('error');
  assert.equal(radio.isStreamDown(), true);

  radio.setStation(emisora('univalle'));
  assert.equal(radio.isStreamDown(), false);
  assert.equal(creados.length, 2);

  creados.at(-1).emitir('error');
  radio.turnOff();
  radio.turnOn();
  assert.equal(creados.length, 3, 'apagar y prender vuelve a intentar');
});

test('Si el navegador rechaza la reproducción, queda la estática', async (t) => {
  const { radio, creados, sucesos } = montar(t, { fallanLosPrimeros: 1 });
  radio.setStation(emisora('unradio-bogota'));
  await new Promise((listo) => setImmediate(listo));

  assert.equal(radio.isStreamDown(), true);
  assert.equal(radio._audioEl, null);
  assert.equal(creados.at(-1).src, null);
  assert.ok(sucesos.some((e) => e.type === 'toast' && /estática/.test(e.detail.text)));
});

test('La promesa de una señal que ya se cambió no tumba a la nueva', async (t) => {
  // El primer elemento queda con un play() que rechaza; para cuando se resuelve, esa emisora ya volvió a sonar.
  const { radio, creados } = montar(t, { fallanLosPrimeros: 1 });
  radio.setStation(emisora('unradio-bogota'));
  radio.setStation(emisora('unicauca'));
  radio.setStation(emisora('unradio-bogota'));
  await new Promise((listo) => setImmediate(listo));

  assert.equal(radio.isStreamDown(), false);
  assert.equal(radio._audioEl, creados.at(-1));
});

test('Si hls.js no se puede cargar, queda la estática', async (t) => {
  const { radio, creados } = montar(t);
  radio._hlsLoader = () => Promise.reject(new Error('sin módulo'));
  radio.setStation(emisora('radionica'));
  await new Promise((listo) => setImmediate(listo));

  assert.equal(radio.isStreamDown(), true);
  assert.equal(radio._audioEl, null);
  assert.equal(creados.at(-1).src, null);
});

test('Sin conexión no se descarga nada: directo a la estática', (t) => {
  const { radio, creados, sucesos } = montar(t, { online: false });
  radio.setStation(emisora('unradio-bogota'));

  assert.equal(creados.length, 0);
  assert.equal(radio.isStreamDown(), true);
  assert.ok(sucesos.some((e) => e.type === 'toast' && /estática/.test(e.detail.text)));
});

test('HLS: hls.js entra solo cuando el navegador no lo reproduce, y se destruye al soltar', async (t) => {
  const { radio, creados } = montar(t);
  const creadosHls = [];
  class HlsFalso {
    static Events = { ERROR: 'hlsError' };
    static isSupported() { return true; }
    constructor() { creadosHls.push(this); }
    attachMedia(el) { this.el = el; }
    loadSource(url) { this.url = url; }
    on(tipo, fn) { this.tipo = tipo; this.fn = fn; }
    destroy() { this.destruido = true; }
  }
  radio._hlsLoader = () => Promise.resolve({ default: HlsFalso });
  radio.setStation(emisora('radionacional-bogota'));
  const el = creados.at(-1);

  await new Promise((listo) => setImmediate(listo));
  assert.equal(creadosHls.length, 1);
  assert.equal(creadosHls[0].el, el);
  assert.equal(creadosHls[0].url, emisora('radionacional-bogota').url);
  assert.equal(creadosHls[0].tipo, 'hlsError');
  assert.equal(el.src, null, 'la lista de reproducción la maneja hls.js');
  assert.equal(el.reproducir, 1);

  radio.turnOff();
  assert.equal(creadosHls[0].destruido, true);
});

test('HLS nativo: el elemento va pelado y no se carga hls.js', (t) => {
  const { radio, creados } = montar(t, { hlsNativo: true });
  radio._hlsLoader = () => { throw new Error('no debe cargarse hls.js'); };
  radio.setStation(emisora('radionica'));
  const el = creados.at(-1);

  assert.equal(el.src, emisora('radionica').url);
  assert.equal(el.reproducir, 1);
});

test('Un hls.js que tarda no gasta el plazo de la emisora', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { radio } = montar(t);
  let resolver;
  radio._hlsLoader = () => new Promise((listo) => { resolver = listo; });
  radio.setStation(emisora('radionacional-bogota'));

  t.mock.timers.tick(120_000);
  assert.equal(radio.isStreamDown(), false, 'la descarga del módulo no es un parón de la emisora');

  const creadosHls = [];
  class HlsFalso {
    static Events = { ERROR: 'hlsError' };
    static isSupported() { return true; }
    constructor() { creadosHls.push(this); }
    attachMedia() {}
    loadSource() {}
    on() {}
    destroy() {}
  }
  resolver({ default: HlsFalso });
  await new Promise((listo) => setImmediate(listo));
  assert.equal(creadosHls.length, 1);

  t.mock.timers.tick(15_000);
  assert.equal(radio.isStreamDown(), true, 'pero sin sonar quince segundos desde el play, cae');
});

test('Frecuencia repetida: manda la emisora elegida a mano; el dial suelto vuelve a la primera', (t) => {
  const { radio } = montar(t);
  radio._hlsLoader = () => Promise.reject(new Error('no hace falta hls.js aquí'));

  radio.setFrequency(98.5);
  assert.equal(radio.getStationInfo().station.id, 'unradio-bogota', 'sin elegir, la de la ciudad');
  assert.equal(radio.getStationInfo().signal, 1);

  radio.setStation(emisora('reconciliacion-bojaya'));
  assert.equal(radio.getStationInfo().station.id, 'reconciliacion-bojaya');
  assert.equal(radio.getStationInfo().signal, 1);

  radio.setFrequency(98.5);
  assert.equal(radio.getStationInfo().station.id, 'unradio-bogota', 'mover el dial suelta la elegida');
});
