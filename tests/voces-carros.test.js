// La voz de quien maneja: el pito de quien no puede pasar y el reclamo por el espejo, con su voz grabada y la burbuja
// encima del carro. Entran al mismo sorteo que las grabaciones de siempre, que siguen sonando, y no gastan más azar.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { FRASES, frasesDe } from '../src/data/vocesCalle.js';
import { PRIORIDAD_CANAL, PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { CARRO, VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { VehicleAudio } from '../src/systems/VehicleAudio.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
});

let nextId = 0;
class FakeHowl {
  constructor(options = {}) { this.options = options; this.voices = new Map(); this.loaded = true; this.starts = 0; }
  state() { return this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.voices.set(id, { playing: this.loaded }); this.starts++; return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  pause(id) { this.stop(id); }
  volume(value, id) { if (value === undefined) return this.voices.get(id)?.volume; if (this.voices.has(id)) this.voices.get(id).volume = value; }
  once() {} on() {} off() {} rate() {} stereo() {} fade() {} loop() {} pos() {}
  seek() { return 0; }
  duration() { return 2; }
  unload() {}
}

/** El director con audios falsos; `azar` sortea la voz del carro (menos de .5, conductora) y lo demás. */
function director({ cargado = true, azar = .6 } = {}) {
  const burbujas = [];
  let ahora = 0;
  const d = new VoiceDirector({
    load: file => { const h = new FakeHowl({ file }); h.loaded = cargado; return h; },
    burbuja: (quien, text, s) => burbujas.push([quien, text, s]), random: () => azar, now: () => ahora,
  });
  d.update(new THREE.Vector3(), []);
  return { d, burbujas, pasar: ms => { ahora += ms; }, archivos: () => [...d._sounds.keys()].map(f => f.replace(/^voces\//, '')).sort() };
}
const carro = (x = 2, extra = {}) => ({ position: new THREE.Vector3(x, 0, 0), traffic: true, ...extra });
const vehiculo = (x = 2, extra = {}) => ({ car: carro(x), speed: 0, ...extra });
const persona = (voz, at = [1, 0, 0]) => ({ _voz: voz, position: new THREE.Vector3(...at), say() {} });

test('el mismo conductor conserva el timbre en la cabina, a pie y tras cargar; un asiento vacío guarda silencio', () => {
  const { d, pasar, archivos } = director();
  const oyente = new THREE.Vector3();
  const car = carro(2, { driverId: 'conductor:1' });
  d.precargarCarros(oyente, [{ car }]);
  const conductor = { stableId: car.driverId, position: oyente.clone() };
  d.vincularConductor(conductor, car, conductor.stableId);
  const timbre = d.vozDeCarro(car);
  assert.equal(timbre, 'conductora');
  assert.equal(d.vozDe(conductor), timbre);
  assert.equal(director({ azar: .95 }).d.vozDeCarro(carro(5, { driverId: conductor.stableId })), timbre);
  conductor.active = true;
  car.driverInside = false;
  assert.equal(d.decirEspejo(car), false);
  assert.equal(d.decirConductor(car, 'semaforo_si'), false);
  assert.equal(d.decirTestigo(conductor, 'auxilio'), true);
  assert.equal(d.ultima.id, 'conductora_auxilio_1');
  d.cancel();
  car.driverInside = true;
  car.driverId = 'conductor:2';
  pasar(CARRO.precarga.cada);
  d.precargarCarros(oyente, [{ car }]);
  assert.equal(d.vozDeCarro(car), 'conductor');
  assert.ok(archivos().includes('conductor_robo_espejo_1.mp3'));
  assert.equal(d.vozDe(conductor), timbre, 'la voz de la primera persona sigue siendo suya');
});

test('la lista trae 12 pitos (4 por conductor, conductora y busetero) y 6 reclamos por el espejo (3 y 3)', () => {
  assert.equal(FRASES.filter(f => f.situacion === 'pito').length, 12);
  assert.equal(FRASES.filter(f => f.situacion === 'robo_espejo').length, 6);
  assert.deepEqual(['conductor', 'conductora', 'busetero'].map(v => frasesDe('pito', v).length), [4, 4, 4]);
  assert.deepEqual(['conductor', 'conductora', 'busetero'].map(v => frasesDe('robo_espejo', v).length), [3, 3, 0]);
});

test('pesan lo mismo que las grabaciones de siempre: el pito como el reclamo de paso y el espejo como el del carro', () => {
  assert.equal(PRIORIDAD_VOZ.pito, PRIORIDAD_CANAL.reclamo);
  assert.equal(PRIORIDAD_VOZ.espejo, PRIORIDAD_CANAL.carro);
  assert.deepEqual([CARRO.pito.rango, CARRO.pito.nivel, CARRO.espejo.rango, CARRO.espejo.nivel], [8, .7, 12, .75]);
});

test('el pito sale con la voz de quien maneja y la burbuja encima del carro; no corta a nadie y se calla a 8 m', () => {
  const { d, burbujas } = director();
  const car = carro(2), buseta = carro(3, { kind: 'buseta' });
  assert.equal(d.listasCarro(car, 'pito'), 0, 'sin pedir, ninguna lista');
  assert.equal(d.decirPito(car), false);
  d.prepararCarro(car); d.prepararCarro(buseta);
  assert.equal(d.listasCarro(car, 'pito'), 4);
  assert.equal(d.decirPito(car), true);
  assert.equal(d.ultima.voz, 'conductor');
  assert.match(d.ultima.id, /^conductor_pito_\d$/);
  assert.deepEqual(burbujas, [[car, d.ultima.text, 2.4]]);
  assert.equal(d._voz.prioridad, 30);
  assert.equal(d.decirPito(buseta), false, 'no habla encima de otra frase');
  d.cancel();
  assert.equal(d.decirPito(buseta), true);
  assert.equal(d.ultima.voz, 'busetero');
  d.cancel();
  const alguien = persona('abuelo');
  d.precargar(alguien); assert.equal(d.decir(alguien), true);
  assert.equal(d.decirPito(car), false, 'ni corta a quien dice algo al pasar');
  d.cancel();
  d.otraVoz = () => true;
  assert.equal(d.decirPito(car), false, 'ni a otra voz del juego');
  d.otraVoz = () => false;
  car.position.x = 8;
  assert.equal(d.decirPito(car), false, 'a 8 m ya no empieza');
});

test('el pito y el espejo bajan en línea recta como las grabaciones de siempre: plenos a 2 m y mudos en su alcance', () => {
  const { d } = director();
  const car = carro(2);
  d.prepararCarro(car);
  assert.equal(d.decirPito(car), true);
  const pleno = d._voz.sound.volume(undefined, d._voz.id);
  car.position.x = 5; d.update(new THREE.Vector3(), []);
  assert.ok(Math.abs(d._voz.sound.volume(undefined, d._voz.id) / pleno - .5) < 1e-9, 'a 5 m, la mitad');
  d.cancel(); car.position.x = 2;
  assert.equal(d.decirEspejo(car), true);
  const plenoEspejo = d._voz.sound.volume(undefined, d._voz.id);
  assert.ok(Math.abs(plenoEspejo / pleno - .75 / .7) < 1e-9);
  car.position.x = 7; d.update(new THREE.Vector3(), []);
  assert.ok(Math.abs(d._voz.sound.volume(undefined, d._voz.id) / plenoEspejo - .5) < 1e-9, 'a 7 m, la mitad');
  car.position.x = 12.5; d.update(new THREE.Vector3(), []);
  assert.equal(d.active, false, 'pasados los 12 m se calla');
});

test('el reclamo por el espejo reemplaza cualquier otra frase, hasta la de la víctima de un robo', () => {
  const { d, burbujas } = director({ azar: .2 });
  const car = carro(2);
  d.prepararCarro(car);
  const victima = { ...persona('senora'), look: { real: { accesorios: [] } } };
  d.prepararRobo(victima);
  assert.equal(d.decirRobo(victima, 'raponazo-sin-bolso'), true);
  let todas = null;
  d.callarOtras = t => { todas = t; };
  assert.equal(d.decirEspejo(car), true);
  assert.equal(todas, true, 'calla también el reclamo de siempre');
  assert.equal(d.ultima.voz, 'conductora');
  assert.match(d.ultima.id, /^conductora_robo_espejo_\d$/);
  assert.equal(burbujas.at(-1)[0], car);
  assert.equal(d._voz.prioridad, 90);
  assert.equal(d.duracion, 2);
  assert.equal(d.decirEspejo(carro(2, { kind: 'buseta' })), false, 'el busetero no tiene: suena el de siempre');
});

test('las frases de un carro se piden cuando está a menos de 14 m, una vez por carro, una vez por segundo; las patrullas no', () => {
  const { d, archivos, pasar } = director({ cargado: false });
  const cerca = vehiculo(13), lejos = vehiculo(15), patrulla = vehiculo(3, { police: true });
  d.precargarCarros(new THREE.Vector3(), [cerca, lejos, patrulla]);
  assert.equal(archivos().length, 7, 'cuatro pitos y tres reclamos de quien maneja el carro cercano');
  assert.ok(archivos().every(f => /^conductor_(pito|robo_espejo)_\d\.mp3$/.test(f)));
  lejos.car.position.x = 5;
  d.precargarCarros(new THREE.Vector3(), [cerca, lejos, patrulla]);
  assert.equal(d._carros.has(lejos.car), false, 'antes de un segundo no vuelve a mirar');
  pasar(1000);
  d.precargarCarros(new THREE.Vector3(), [cerca, lejos, patrulla]);
  assert.equal(d._carros.has(lejos.car), true);
  assert.equal(d._carros.has(patrulla.car), false);
  d.precargarCarros(null, [cerca]);
});

/** VehicleAudio solo, con un carro bloqueado a 2 m y doce frases de siempre. */
function conPitos({ azar, listas = 4, dice = true, police = false } = {}) {
  const banco = Object.fromEntries(['carIdle', 'carDrive', 'busIdle', 'busDrive', 'horn1', 'horn2', 'horn3'].map(k => [k, new FakeHowl({ k })]));
  const deSiempre = Array.from({ length: 12 }, (_, i) => new FakeHowl({ i }));
  let tiradas = 0;
  const audio = new VehicleAudio(banco, () => { tiradas++; return azar; }, deSiempre);
  const pedidos = [];
  if (listas !== null) audio.vocesPito = { listas: () => listas, decir: car => { pedidos.push(car); return dice; } };
  const v = vehiculo(2, { police });
  audio.update(.1, new THREE.Vector3(), [v]);
  const state = audio.instances.get(v.car);
  v.personBlocked = true; state.patience = 0;
  tiradas = 0;
  audio.update(.1, new THREE.Vector3(), [v]);
  return { state, pedidos, v, deSiempre, tiradas };
}

test('en una patrulla se oye el pito sin ponerle a un policía la voz de otro conductor', () => {
  const patrulla = conPitos({ azar: .8, police: true });
  assert.ok(patrulla.state.horn);
  assert.equal(patrulla.state.remark, undefined);
  assert.deepEqual(patrulla.pedidos, []);
});

test('el juego de verdad: el carro bloqueado cerca pita con su voz y, al robarle el espejo, lo reclama con su voz', () => {
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  const burbujas = [];
  audio.voces.burbuja = (quien, text) => burbujas.push([quien, text]);
  audio.voces.random = () => .6;
  const v = vehiculo(2), oyente = new THREE.Vector3();
  audio.vehicles.random = () => .5;
  audio.updateWorld(.1, oyente, null, [v], null, []);
  assert.equal(audio.voces.listasCarro(v.car, 'pito'), 4, 'con el carro cerca ya se pidieron sus frases');
  const state = audio.vehicles.instances.get(v.car);
  v.personBlocked = true; state.patience = 0;
  audio.vehicles.random = () => .99;
  audio.updateWorld(.1, oyente, null, [v], null, []);
  assert.match(audio.voces.ultima.id, /^conductor_pito_\d$/);
  assert.equal(audio.voces.active, true);
  assert.equal(state.remark, undefined);
  assert.deepEqual(burbujas, [[v.car, audio.voces.ultima.text]]);
  assert.equal(audio.vehicles.externalVoiceActive(), true, 'mientras tanto nadie más empieza una frase de carro');
  // Cambiar el azar de la selección no cambia al intérprete del volante.
  state.cooldown = 0;
  for (const random of [.99, .3, 0]) {
    audio.vehicles.random = () => random;
    assert.equal(audio.playMovingTheft(v.car), true);
    assert.match(audio.voces.ultima.id, /^conductor_robo_espejo_/);
    assert.equal(audio._theftVoiceActive(), false);
    assert.equal(burbujas.at(-1)[0], v.car);
    assert.equal(state.cooldown, 2.5);
  }
  const roberto = carro(2, { driverId: 'conductor:11' });
  assert.equal(audio.playMovingTheft(roberto), true);
  assert.equal(audio._theftVoices.get(roberto).sound.options.src[0], '/audio/roberto_robo_espejo_n1.mp3');
  audio.dispose();
});
