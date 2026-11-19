import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { FRASES, REPARTO, VOCES_LUFS, vozPara } from '../src/data/vocesCalle.js';
import { REUSO } from '../src/data/vocesReuso.js';
import { BANCO_TESTIGOS, TESTIGO_A_CATEGORIA, frasesDeTestigo } from '../src/systems/voces/testigos.js';
import { PRIORIDAD_CANAL, PRIORIDAD_VOZ } from '../src/systems/voces/prioridad.js';
import { DIRECTOR, VoiceDirector } from '../src/systems/voces/VoiceDirector.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { GRITOS, WITNESS, WitnessSystem } from '../src/systems/WitnessSystem.js';
import { Npc } from '../src/entities/Npc.js';
import { loudnessGain } from '../src/systems/StreetVoices.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
  globalThis.document ??= {
    getElementById() { return null; },
    createElement() { return { className: '', textContent: '', style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
});

let nextId = 0;
class FakeHowl {
  constructor(options = {}) { this.options = options; this.voices = new Map(); this.loaded = true; this.listeners = {}; this.plays = 0; }
  state() { return this.unloaded ? 'unloaded' : this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.plays++; this.voices.set(id, { playing: this.loaded }); return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  pause(id) { this.stop(id); }
  volume(value, id) { if (this.voices.has(id)) this.voices.get(id).volume = value; }
  once(event, fn) { (this.listeners[event] ??= []).push(fn); }
  emit(event) { for (const fn of this.listeners[event] ?? []) fn(); this.listeners[event] = []; }
  rate() {} stereo() {}
  duration() { return 2; }
  unload() { this.unloaded = true; }
  on() {} off() {}
}

// Una persona con la voz dada ya decidida (la del reparto de su arquetipo; ver voces-calle.test.js).
function persona(voz, at = [1, 0, 0]) {
  return { _voz: voz, position: new THREE.Vector3(...at), dichos: [], say(text, s) { this.dichos.push([text, s]); } };
}

function director({ cargado = true } = {}) {
  const cargados = [];
  let t = 0;
  const d = new VoiceDirector({
    load: file => { const h = new FakeHowl({ file }); h.loaded = cargado; cargados.push(h); return h; },
    random: () => .5, now: () => t,
  });
  return { d, cargados, archivos: () => cargados.map(h => h.options.file.replace(/^voces\//, '')).sort() };
}

const callar = cargados => cargados.forEach(h => h.stop());
const archivo = id => `${id}.mp3`;

// Un peatón de verdad (los testigos usan su `witness` y su `_fleeFrom`) con la voz dada.
function peaton(scene, x, z, voz) {
  const npc = new Npc(scene, new THREE.Vector3(x, 0, z), { look: {} });
  npc.target = null; npc.route = [];
  npc._voz = voz;
  npc.dichos = [];
  npc.say = (t, s) => { npc.dichos.push([t, s]); };
  return npc;
}

function juego(npcs, voces) {
  return {
    player: { position: new THREE.Vector3(0, 0, 0) },
    world: { active: { npcs } },
    steal: { buscado: 1, _calma: 50, targetNpc: null },
    traffic: { wantedLevel: 1, dispatchTo: () => true },
    audio: { voces },
  };
}

function audioSystem() {
  return new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
}

test('trae las frases de emergencia, de testigo y de la turba, con los ids de las grabaciones, y solo de voces que hablan', () => {
  const deTestigos = [...new Set(Object.values(BANCO_TESTIGOS).flat().map(f => f.id))].filter(id => !/_ambiente_/.test(id)).sort();
  assert.deepEqual(deTestigos, [
    'abuelo_testigo_pelea_1', 'busetero_persecucion_1', 'busetero_testigo_pelea_1',
    'conductor_auxilio_1', 'conductor_testigo_cuelga_1', 'conductor_testigo_llama_1', 'conductor_testigo_robo_1',
    'conductora_auxilio_1', 'conductora_testigo_cuelga_1', 'conductora_testigo_llama_1', 'conductora_testigo_robo_1',
    'estudiante_h_testigo_graba_1', 'estudiante_testigo_graba_1', 'estudiante_testigo_graba_2', 'estudiante_testigo_llama_1',
    'nera_pelea_1', 'nera_pelea_2', 'nero_pelado_pelea_1', 'nero_viejo_pelea_2', 'reciclador_pelea_1',
    'senora_auxilio_1', 'senora_testigo_cuelga_1', 'senora_testigo_llama_1', 'senora_testigo_pelea_1', 'vecina_parque_auxilio_1', 'vecina_parque_hallazgo_1',
  ]);
  const porId = new Map(FRASES.map(f => [f.id, f]));
  assert.equal(porId.get('nero_viejo_pelea_2').text, '¡Denle, denle, que es rata!', 'el número fijado');
  assert.equal(porId.get('estudiante_testigo_graba_2').text, 'Lo tengo grabado, ¿oyó? Grabado.');
  assert.equal(porId.get('busetero_persecucion_1').text, '¡Agarren a ese man, que no se vuele!');
  // Cada frase reusada existe.
  const reusadas = new Set(Object.values(REUSO).flat());
  for (const id of reusadas) assert.ok(porId.has(id), id);
  // Toda frase de testigo es de una voz que alguien de la calle tiene.
  const voces = new Set(['vecina_parque']);
  for (const arquetipo of ['habitante', 'reciclador', 'senora', 'abuelo', 'oficinista', 'estudiante', 'obrero', 'vendedor', null]) {
    for (const sexo of ['hombre', 'mujer']) for (const edad of ['joven', 'adulto', 'mayor']) for (const r of [.1, .9]) {
      voces.add(vozPara({ arquetipo, sexo, edad }, () => r));
    }
  }
  for (const lista of Object.values(BANCO_TESTIGOS)) for (const f of lista) assert.ok(voces.has(f.voz) && REPARTO[f.voz], f.id);
});

test('cada situación de los testigos tiene su categoría y sus frases por voz', () => {
  assert.deepEqual(Object.keys(TESTIGO_A_CATEGORIA).sort(), Object.keys(GRITOS).sort(), 'las situaciones que existen');
  const tabla = Object.fromEntries(Object.entries(BANCO_TESTIGOS).map(([c, l]) => [c, l.map(f => f.id).sort()]));
  assert.deepEqual(tabla, {
    witnessAid: ['conductor_auxilio_1', 'conductora_auxilio_1', 'senora_auxilio_1', 'vecina_parque_auxilio_1'],
    witnessBody: ['conductor_auxilio_1', 'conductora_auxilio_1', 'vecina_parque_hallazgo_1'],
    witnessCall: ['conductor_testigo_llama_1', 'conductora_testigo_llama_1', 'estudiante_testigo_llama_1', 'senora_testigo_llama_1'],
    witnessFilm: ['estudiante_h_testigo_graba_1', 'estudiante_testigo_graba_1', 'estudiante_testigo_graba_2', 'nero_pelado_ambiente_3'],
    witnessHangUp: ['conductor_testigo_cuelga_1', 'conductora_testigo_cuelga_1', 'senora_testigo_cuelga_1'],
    witnessTheft: ['abuelo_testigo_pelea_1', 'busetero_persecucion_1', 'conductor_testigo_robo_1', 'conductora_testigo_robo_1',
      'nera_pelea_2', 'nero_pelado_pelea_1', 'nero_viejo_pelea_2', 'reciclador_pelea_1'],
    witnessFight: ['abuelo_testigo_pelea_1', 'busetero_testigo_pelea_1', 'nera_pelea_1', 'nero_pelado_pelea_1', 'reciclador_pelea_1',
      'senora_testigo_pelea_1'],
  });
  assert.deepEqual(frasesDeTestigo('witnessCall', 'senora').map(f => f.id), ['senora_testigo_llama_1']);
  assert.deepEqual(frasesDeTestigo('witnessCall', 'nero_viejo'), []);
});

test('con el canal ocupado, una llamada sin audio muestra su texto y conserva el turno de quien sí tiene grabación', () => {
  for (const falla of [false, true]) {
    const { d, cargados } = director({ cargado: false });
    const graba = persona('estudiante');
    d.prepararTestigo(graba);
    const video = cargados.find(h => h.options.file === 'voces/estudiante_testigo_graba_1.mp3');
    video.loaded = true;
    d.pesoOtraVoz = () => PRIORIDAD_CANAL.carro;
    assert.equal(d.decirTestigo(graba, 'grabar'), true);

    const llama = peaton(new THREE.Scene(), 3, 0, 'senora');
    d.prepararTestigo(llama);
    const toma = cargados.find(h => h.options.file === 'voces/senora_testigo_llama_1.mp3');
    if (falla) toma.emit('loaderror');
    const sys = new WitnessSystem(juego([llama], d), { random: () => 0 });
    sys.report('robo');
    assert.equal(llama.witnessing, 'llamar');
    assert.equal(llama.dichos.length, 1, 'la burbuja aparece en el mismo cuadro');
    assert.ok(GRITOS.llamar.includes(llama.dichos[0][0]));
    assert.equal(d._enEspera?.source, graba, 'la llamada pesa más, pero carece de audio');

    if (!falla) toma.loaded = true;
    d.pesoOtraVoz = () => 0;
    d.update(sys.game.player.position);
    assert.equal(d._voz?.source, graba);
    assert.equal(video.plays, 1);
    callar(cargados);
    d.update(sys.game.player.position);
    assert.equal(d._enEspera, null);
    assert.equal(toma.plays, 0);
    assert.equal(llama.dichos.length, 1, 'el texto se muestra una sola vez');
    sys.dispose();
    d.dispose();
  }
});

test('quién corta a quién entre el testigo y la gente al pasar, y entre testigos', () => {
  // El testigo corta lo que dice la gente al pasar.
  const { d, cargados } = director();
  const pasa = persona('senora');
  assert.equal(d.decir(pasa), true);
  const ambiente = d._voz;
  assert.equal(d.decirTestigo(persona('conductor'), 'robo'), true);
  assert.equal(ambiente.sound.playing(ambiente.id), false, 'el ambiente se calla');
  assert.equal(d.ultima.id, 'conductor_testigo_robo_1');
  // Mientras grita el testigo, nadie dice nada al pasar.
  assert.equal(d.decir(persona('abuelo')), false);
  d._nextAmbient = 0;
  d.update(new THREE.Vector3(), [persona('abuelo', [2, 0, 0])]);
  assert.equal(d.ultima.id, 'conductor_testigo_robo_1', 'el ambiente espera');
  // A igual peso o menos, la que suena sigue; la que pesa más corta.
  assert.equal(d.decirTestigo(persona('senora'), 'llamar'), false, 'llamar pesa igual que el robo');
  assert.equal(d.decirTestigo(persona('senora'), 'colgar'), false, 'colgar pesa menos');
  callar(cargados);
  assert.equal(d.decirTestigo(persona('estudiante'), 'grabar'), true);
  const graba = d._voz;
  assert.equal(d.decirTestigo(persona('senora'), 'pelea'), true, 'la pelea pesa más que grabar');
  assert.equal(graba.sound.playing(graba.id), false);
  callar(cargados);
  assert.equal(d.decirTestigo(persona('estudiante'), 'grabar'), true);
  assert.equal(d.decirTestigo(persona('senora'), 'colgar'), false, 'colgar pesa igual que grabar');
  // Los pesos de la gente de la calle no se mueven aunque la tabla gane renglones de otras voces.
  const { robbed, witnessCall, witnessTheft, witnessFight, semaforo, witnessHangUp, witnessFilm, ambient } = PRIORIDAD_VOZ;
  assert.deepEqual({ robbed, witnessCall, witnessTheft, witnessFight, semaforo, witnessHangUp, witnessFilm, ambient },
    { robbed: 90, witnessCall: 70, witnessTheft: 70, witnessFight: 65, semaforo: 50, witnessHangUp: 45, witnessFilm: 45, ambient: 20 });
  assert.deepEqual(PRIORIDAD_CANAL, { carro: 90, reclamo: 30, calle: 30 });
});

test('con las voces que ya había: el testigo corta la calle, las conversaciones y los conductores, y espera al reclamo por robo', () => {
  const audio = audioSystem();
  const senora = persona('senora');
  // Las cinco frases de la calle.
  const calle = audio.streetVoiceSounds.carechimba;
  audio.streetVoices._voice = { sound: calle, id: calle.play(), npc: senora, gain: 1 };
  assert.equal(audio.voces.pesoOtraVoz(), PRIORIDAD_CANAL.calle);
  assert.equal(audio.voces.decirTestigo(persona('conductor'), 'robo'), true);
  assert.equal(audio.streetVoices.active, false, 'StreetVoices se calla');
  // Mientras grita el testigo, las demás esperan y el tráfico baja.
  assert.equal(audio.streetVoices.externalVoiceActive(), true);
  assert.equal(audio.conversations.externalVoiceActive(), true);
  assert.equal(audio.vehicles.externalVoiceActive(), true);
  assert.equal(audio._voiceActive(), true);
  // El reclamo por el espejo robado lo corta.
  const { sound, id } = audio.voces._voz;
  assert.equal(audio.playMovingTheft({ traffic: true, driverId: 'conductor:11', position: new THREE.Vector3() }), true);
  assert.equal(sound.playing(id), false);
  // Y mientras reclaman, el testigo no habla: texto de siempre.
  assert.equal(audio.voces.pesoOtraVoz(), PRIORIDAD_CANAL.carro);
  assert.equal(audio.voces.decirTestigo(persona('senora'), 'llamar'), false);
  audio._theftVoices.clear();
  // Una conversación: el testigo la corta.
  let cortada = 0;
  Object.defineProperty(audio.conversations, 'busy', { get: () => cortada === 0, configurable: true });
  audio.conversations.cancel = () => { cortada++; };
  assert.equal(audio.voces.pesoOtraVoz(), PRIORIDAD_CANAL.calle);
  assert.equal(audio.voces.decirTestigo(persona('senora'), 'llamar'), true);
  assert.equal(cortada, 1);
  audio.voces._cortar();
  // Un conductor que pita: el testigo lo corta.
  let pitando = true;
  audio.vehicles.remarkPlaying = () => pitando;
  audio.vehicles.stopRemarks = () => { pitando = false; };
  assert.equal(audio.voces.pesoOtraVoz(), PRIORIDAD_CANAL.reclamo);
  assert.equal(audio.voces.decirTestigo(persona('estudiante'), 'grabar'), true);
  assert.equal(pitando, false);
  // La gente al pasar, en cambio, sigue esperando a todas (como en el #116).
  audio.voces._cortar();
  audio.vehicles.remarkPlaying = () => true;
  assert.equal(audio.voces.decir(persona('senora')), false);
  audio.dispose();
});

test('los audios de testigos se piden con alguien a tiro de robo o al ver el robo, nunca al arrancar', () => {
  const scene = new THREE.Scene();
  const howls = [];
  class Registro extends FakeHowl { constructor(o) { super(o); howls.push(this); } }
  const audio = new AudioSystem({ HowlClass: Registro, howler: { volume() {} }, eventTarget: new EventTarget() });
  const voces = () => howls.filter(h => /audio\/voces\//.test(h.options.src[0])).map(h => h.options.src[0].split('/').pop()).sort();
  const victima = peaton(scene, 1, 0, 'abuelo'), cerca = peaton(scene, 6, 0, 'senora'), lejos = peaton(scene, 30, 0, 'conductor');
  const game = juego([victima, cerca, lejos], audio.voces);
  const sys = new WitnessSystem(game, { random: () => .99 }); // nadie llama ni graba: el primero grita y el otro calla
  for (let i = 0; i < 20; i++) sys.update(.1);
  assert.deepEqual(voces(), [], 'nada al arrancar ni andando sin nadie a tiro');
  // A tiro de robo: las de quien lo vería, no las de la víctima ni las del que está lejos.
  game.steal.targetNpc = victima;
  sys.update(.1);
  const deSenora = ['senora_auxilio_1.mp3', 'senora_testigo_cuelga_1.mp3', 'senora_testigo_llama_1.mp3', 'senora_testigo_pelea_1.mp3'];
  assert.deepEqual(voces(), deSenora);
  // Una vez por segundo como mucho.
  let llamadas = 0;
  const preparar = audio.voces.prepararTestigo.bind(audio.voces);
  audio.voces.prepararTestigo = npc => { llamadas++; preparar(npc); };
  for (let i = 0; i < 9; i++) sys.update(.1);
  assert.equal(llamadas, 0);
  sys.update(.11);
  assert.equal(llamadas, 1);
  game.steal.targetNpc = null;
  audio.voces.prepararTestigo = preparar;
  // Al ver el robo, las de cada testigo, también las del que huye callado.
  lejos.position.set(8, 0, 0);
  sys.report('robo', victima);
  assert.deepEqual(voces(), [...deSenora, 'conductor_auxilio_1.mp3', 'conductor_testigo_cuelga_1.mp3', 'conductor_testigo_llama_1.mp3', 'conductor_testigo_robo_1.mp3'].sort());
  sys.dispose();
  audio.dispose();
});
