import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { FRASES, REPARTO, frasesDe, sinEtiquetas, vozPara } from '../src/data/vocesCalle.js';
import { CATEGORIA_DE_SITUACION, NPC_VOICE_BANK } from '../src/data/npcVoices.js';
import { Npc, getRandomVoice } from '../src/entities/Npc.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { WitnessSystem } from '../src/systems/WitnessSystem.js';
import { BUS_CALLER, DEALER_WHISPER, POLICE_RADIO, POLICE_SHOUT } from '../src/systems/WorldVoices.js';
import { audioMetadata } from './helpers/audio-file.js';

let nextId = 0;
class FakeHowl {
  constructor(options) { this.options = options; this.voices = new Map(); this.starts = 0; this.loaded = true; }
  state() { return this.unloaded ? 'unloaded' : this.loaded ? 'loaded' : 'loading'; }
  play() { const id = ++nextId; this.voices.set(id, { playing: true }); this.starts++; return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(voice => voice.playing) : !!this.voices.get(id)?.playing; }
  pause(id) { this.voices.get(id).playing = false; }
  stop(id) { for (const [key, voice] of this.voices) if (id === undefined || key === id) voice.playing = false; }
  volume(value, id) { if (id !== undefined && this.voices.has(id)) this.voices.get(id).volume = value; }
  rate() {}
  seek() {}
  duration() { return 2; }
  unload() { this.unloaded = true; }
}
const src = sound => sound.options.src[0];

function fixture() {
  const events = new EventTarget();
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: events });
  audio.vehicles.random = () => .5;
  return { audio, events };
}
const origin = new THREE.Vector3();
const run = (audio, seconds, vehicles = [], bus = null, step = .1) => {
  for (let t = 0; t < seconds - 1e-9; t += step) audio.updateWorld(step, origin, null, vehicles, bus);
};
const endVoice = audio => { audio._npcVoice?.sound.stop(); };

test('las 155 frases tienen su mp3 mono en public/audio/voces y la carpeta no trae nada más', () => {
  assert.equal(FRASES.length, 155);
  assert.equal(new Set(FRASES.map(frase => frase.id)).size, FRASES.length);
  const dir = new URL('../public/audio/voces/', import.meta.url);
  assert.deepEqual(readdirSync(dir).sort(), FRASES.map(frase => `${frase.id}.mp3`).sort());
  for (const frase of FRASES) {
    assert.equal(frase.audio, `/audio/voces/${frase.id}.mp3`);
    assert.ok(REPARTO[frase.voz], `${frase.id}: voz del reparto`);
    assert.equal(frase.gender, REPARTO[frase.voz].sexo);
    assert.equal(frase.text, sinEtiquetas(frase.dicho));
    assert.doesNotMatch(frase.text, /\[|\]/, 'la burbuja va sin etiquetas de dirección');
    const bytes = readFileSync(new URL(`${frase.id}.mp3`, dir));
    const { duration } = audioMetadata(bytes);
    assert.ok(duration > .5 && duration < 7, `${frase.id}: ${duration} s`);
    // MPEG: el modo de canal está en los bits 6-7 del cuarto byte de la cabecera (3 = mono).
    let offset = bytes.toString('ascii', 0, 3) === 'ID3'
      ? 10 + ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) + ((bytes[8] & 127) << 7) + (bytes[9] & 127) : 0;
    while ((bytes.readUInt16BE(offset) & 0xffe0) !== 0xffe0) offset++;
    assert.equal(bytes[offset + 3] >> 6, 3, `${frase.id} es mono`);
  }
});

test('cada persona de la calle tiene una voz de su sexo y todas saben decir algo al pasar', () => {
  const arquetipos = ['habitante', 'reciclador', 'senora', 'abuelo', 'oficinista', 'estudiante', 'obrero', 'vendedor', 'conductor'];
  for (const arquetipo of arquetipos) for (const sexo of ['hombre', 'mujer']) for (const edad of ['joven', 'adulto', 'mayor']) {
    for (const r of [.1, .9]) {
      const voz = vozPara({ arquetipo, sexo, edad }, () => r);
      assert.ok(REPARTO[voz], `${arquetipo} ${sexo} ${edad}`);
      assert.equal(REPARTO[voz].sexo, sexo);
      assert.ok(frasesDe('ambiente', voz).length >= 2, `${voz} tiene frases de ambiente`);
    }
  }
  assert.equal(vozPara({ arquetipo: 'habitante', sexo: 'hombre', edad: 'joven' }), 'nero_pelado');
  assert.equal(vozPara({ arquetipo: 'habitante', sexo: 'hombre', edad: 'mayor' }), 'nero_viejo');
  assert.equal(vozPara({ arquetipo: 'habitante', sexo: 'hombre', edad: 'adulto' }, () => .2), 'nero_pelado');
  assert.equal(vozPara({ arquetipo: 'habitante', sexo: 'hombre', edad: 'adulto' }, () => .8), 'nero_viejo');
  assert.equal(vozPara({ arquetipo: 'vendedor' }), null, 'sin sexo todavía no se decide');
  assert.equal(vozPara({ arquetipo: 'escuadron', sexo: 'hombre' }), null);
});

test('el banco de peatones recibe las situaciones de la calle con su voz y su sexo', () => {
  for (const frase of FRASES) {
    const category = CATEGORIA_DE_SITUACION[frase.situacion];
    if (!category) continue;
    const entry = NPC_VOICE_BANK[category].find(item => item.audio === frase.audio);
    assert.deepEqual(entry, { audio: frase.audio, text: frase.text, gender: frase.gender, voz: frase.voz });
  }
  for (const category of ['robbed', 'poop', 'smell', 'witnessCall', 'witnessFilm', 'witnessHangUp', 'witnessTheft', 'witnessFight']) {
    assert.ok(NPC_VOICE_BANK[category].length > 0, category);
  }
});

test('quien tiene voz dice solo las suyas; sin ellas, alguna sin voz marcada, nunca la de otro', () => {
  for (let i = 0; i < 12; i++) {
    const entry = getRandomVoice('poop', 'mujer', 'senora');
    if (entry) assert.equal(entry.voz, 'senora');
  }
  // El conductor no tiene frases de golpe: dice las de siempre, que no tienen voz.
  const hit = getRandomVoice('hit', 'hombre', 'conductor');
  assert.ok(hit && !hit.voz);
  // La ñera tampoco, y no hay de golpe sin voz para mujer: se queda callada en vez de hablar con otra voz.
  assert.equal(getRandomVoice('hit', 'mujer', 'nera'), null);
});

async function streetPerson({ vozArquetipo, sexo, edad = 'adulto' }) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(1, 0, 0), { look: { real: { sexo, edad } } });
  await npc.ready;
  npc.vozArquetipo = vozArquetipo;
  const heard = [], said = [];
  npc.audio = { playNpcVoice: path => { heard.push(path); return true; } };
  npc.say = text => said.push(text);
  return { npc, heard, said };
}

test('el vendedor habla con su voz, le cae popó con su voz y el carro que casi lo pisa no le hace decir popó', async () => {
  const { npc, heard, said } = await streetPerson({ vozArquetipo: 'vendedor', sexo: 'hombre' });
  assert.equal(npc.speakScenario('ambient', true), true);
  assert.equal(npc._voz, 'vendedor');
  assert.ok(frasesDe('ambiente', 'vendedor').some(frase => frase.audio === heard[0]));
  assert.ok(frasesDe('ambiente', 'vendedor').some(frase => frase.text === said[0]));
  npc.hitByPoop(new THREE.Vector3(3, 0, 0));
  assert.equal(heard.at(-1), frasesDe('popo', 'vendedor')[0].audio);
  const before = heard.length;
  npc.hitByPoop(new THREE.Vector3(3, 0, 0), { voz: false });
  assert.equal(heard.length, before);
  npc.dispose();
});

test('a quien le roban grita con su voz y la señora huele al jugador con la suya', async () => {
  const victim = await streetPerson({ vozArquetipo: 'estudiante', sexo: 'mujer' });
  victim.npc.alarmedByTheft(new THREE.Vector3(2, 0, 0));
  assert.ok(frasesDe('robado', 'estudiante').some(frase => frase.audio === victim.heard[0]));
  victim.npc.dispose();
  const lady = await streetPerson({ vozArquetipo: 'senora', sexo: 'mujer' });
  assert.equal(lady.npc.speakScenario('smell', true), true);
  assert.equal(lady.heard[0], frasesDe('olor', 'senora')[0].audio);
  lady.npc.dispose();
});

test('el vendedor en su puesto ofrece a quien pasa cerca, cada tanto y no a quien está lejos', async () => {
  const { npc, heard } = await streetPerson({ vozArquetipo: 'vendedor', sexo: 'mujer' });
  npc.isVendor = true;
  npc._callOutIn = 0;
  npc._playerDist = 12; npc._updateCallOut(.1);
  assert.equal(heard.length, 0);
  npc._playerDist = 3; npc._updateCallOut(.1);
  assert.equal(heard.length, 1);
  assert.ok(frasesDe('ambiente', 'vendedora').some(frase => frase.audio === heard[0]));
  npc._bubbleTimer = 0; npc._lastVoiceTime = 0;
  npc._updateCallOut(.1);
  assert.equal(heard.length, 1, 'espera antes de volver a ofrecer');
  npc.dispose();
});

test('los testigos hablan con su voz si tienen frase y si no dejan solo la burbuja', () => {
  const said = [], spoken = [];
  const npc = (voiced, x) => ({
    position: new THREE.Vector3(x, 0, 0), hp: 100, witnessing: null,
    witness(mode) { this.witnessing = mode; return true; }, stopWitness() { this.witnessing = null; },
    _fleeFrom() {}, say: text => said.push(text),
    speakScenario: category => { spoken.push(category); return voiced; }
  });
  const caller = npc(true, 2), filmer = npc(false, 3), runner = npc(true, 4);
  const game = { player: { position: new THREE.Vector3() }, world: { active: { npcs: [caller, filmer, runner] } } };
  const witnesses = new WitnessSystem(game, { random: () => 0 });
  witnesses.report('pelea');
  assert.deepEqual(spoken, ['witnessCall', 'witnessFilm', 'witnessFight']);
  assert.equal(said.length, 1, 'quien graba sin frase propia deja la burbuja');
  witnesses.update(.1);
  assert.deepEqual(spoken.slice(3), ['witnessHangUp'], 'llegarle al que llama le hace colgar con su voz');
  witnesses.dispose();
});

test('las voces nuevas se cargan al pedirlas, esperan a cargar y solo las recientes quedan en memoria', () => {
  const { audio } = fixture();
  assert.ok([...audio._npcSounds.keys()].every(file => !file.startsWith('voces/')), 'nada de voces/ precargado');
  const owner = { position: new THREE.Vector3(2, 0, 0), hp: 100 };
  audio.updateWorld(.1, origin, null, []);
  const path = frasesDe('ambiente', 'senora')[0].audio;
  // La primera vez no está cargada: queda esperando y suena apenas cargue.
  audio._npcSoundFactory = (file, options) => { const howl = new FakeHowl({ src: [`/audio/${file}`], ...options }); howl.loaded = false; return howl; };
  assert.equal(audio.playNpcVoice(path, owner), false);
  const sound = audio._npcSounds.get('voces/senora_ambiente_1.mp3');
  assert.equal(src(sound), '/audio/voces/senora_ambiente_1.mp3');
  audio.updateWorld(.1, origin, null, []);
  assert.equal(audio._npcVoice, null);
  sound.loaded = true;
  audio.updateWorld(.1, origin, null, []);
  assert.equal(audio._npcVoice?.sound, sound);
  endVoice(audio);
  // Si tarda demasiado, la frase ya no sale.
  const late = frasesDe('ambiente', 'senora')[1].audio;
  audio.updateWorld(.1, origin, null, []);
  audio.playNpcVoice(late, owner);
  run(audio, 1.5);
  audio._npcSounds.get('voces/senora_ambiente_2.mp3').loaded = true;
  audio.updateWorld(.1, origin, null, []);
  assert.equal(audio._npcVoice, null);
  // Con muchas frases distintas se descargan las más viejas.
  const lazy = FRASES.slice(0, 60).map(frase => frase.audio.replace('/audio/', ''));
  for (const file of lazy) audio._voiceSound(file);
  const kept = [...audio._npcSounds.keys()].filter(file => file.startsWith('voces/'));
  assert.equal(kept.length, 40);
  assert.ok(kept.includes(lazy.at(-1)) && !kept.includes(lazy[0]));
  audio.dispose();
});

test('el robo de espejo lo reclama el conductor de ese carro con su voz', () => {
  const { audio } = fixture();
  for (const voice of ['conductora', 'valentina', 'conductor']) {
    const vehicle = { car: { position: new THREE.Vector3(2, 0, 0), group: new THREE.Group(), traffic: true }, speed: 0 };
    audio.vehicles.driverVoice(vehicle.car, voice);
    audio.updateWorld(.1, origin, null, [vehicle]);
    assert.equal(audio.playMovingTheft(vehicle.car), true);
    const said = src(audio._theftVoices.get(vehicle.car).sound);
    const owner = voice === 'valentina' ? 'conductora' : voice;
    assert.ok(frasesDe('robo_espejo', owner).some(frase => frase.audio === said), `${voice}: ${said}`);
  }
  audio.dispose();
});

test('en el semáforo el conductor responde con su voz y en el bus responde el busetero', () => {
  const { audio } = fixture();
  const vehicle = { car: { position: new THREE.Vector3(2, 0, 0), group: new THREE.Group() }, speed: 0 };
  audio.vehicles.driverVoice(vehicle.car, 'roberto');
  audio.updateWorld(.1, origin, null, [vehicle]);
  assert.equal(audio.playDriverLine(vehicle.car, 'semaforo_si'), true);
  assert.equal(src(audio._theftVoices.get(vehicle.car).sound), frasesDe('semaforo_si', 'conductor')[0].audio,
    'Roberto no tiene frases de rebusque: dice las del conductor');
  const bus = { position: new THREE.Vector3(4, 0, 0), group: new THREE.Group(), speed: 0 };
  assert.equal(audio.playDriverLine(bus, 'semaforo_no', { bus: true }), true);
  assert.equal(src(audio._theftVoices.get(bus).sound), frasesDe('semaforo_no', 'busetero')[0].audio);
  assert.equal(audio.playDriverLine(bus, 'semaforo_bravo', { bus: true }), false, 'el busetero no tiene esa');
  audio.dispose();
});

test('el bus tiene busetero: pita con su voz cuando alguien no se quita y vocea una vez en cada parada', () => {
  const { audio } = fixture();
  const bus = { position: new THREE.Vector3(5, 0, 0), group: new THREE.Group(), speed: 0, personBlocked: true, dwellRemaining: 0 };
  audio.updateWorld(.1, origin, null, [], bus);
  assert.equal(audio.vehicles.driverVoice(bus), 'busetero');
  const state = audio.vehicles.instances.get(bus);
  state.patience = 0;
  audio.updateWorld(.1, origin, null, [], bus);
  assert.ok(frasesDe('pito', 'busetero').some(frase => frase.audio === src(state.remark.sound)));
  state.remark.sound.stop(); state.remark = null; bus.personBlocked = false;
  bus.dwellRemaining = 3;
  run(audio, .5, [], bus);
  assert.ok(frasesDe('voceador', 'busetero').some(frase => frase.audio === src(audio._npcVoice.sound)));
  endVoice(audio);
  run(audio, 1, [], bus);
  assert.equal(audio._npcVoice, null, 'una vez por parada');
  bus.dwellRemaining = 0; run(audio, .2, [], bus);
  bus.dwellRemaining = 3; run(audio, .2, [], bus);
  assert.ok(audio._npcVoice, 'en la siguiente parada vuelve a vocear');
  endVoice(audio);
  bus.position.x = BUS_CALLER.range + 5; bus.dwellRemaining = 0; run(audio, .2, [], bus);
  bus.dwellRemaining = 3; run(audio, .5, [], bus);
  assert.equal(audio._npcVoice, null, 'de lejos no se oye');
  audio.dispose();
});

const patrol = (x, chasing = true) => ({ police: true, state: chasing ? 'chase' : 'patrol', speed: 0,
  car: { position: new THREE.Vector3(x, 0, 0), group: new THREE.Group(), pursuit: chasing } });

test('la patrulla que persigue grita con una de las dos voces y de lejos usa el megáfono', () => {
  const { audio } = fixture();
  const near = patrol(5);
  run(audio, POLICE_SHOUT.first + .2, [near]);
  const first = src(audio._npcVoice.sound);
  assert.ok(frasesDe('grito', 'policia_a').some(frase => frase.audio === first), first);
  endVoice(audio);
  run(audio, 1, [near]);
  assert.equal(audio._npcVoice, null, 'espera unos segundos antes del siguiente grito');
  const other = patrol(4);
  assert.equal(audio.worldVoices.patrolVoice(other.car), 'policia_b', 'la siguiente patrulla tiene la otra voz');
  audio.vehicles.random = () => .1; // debajo de la probabilidad del megáfono
  near.car.position.x = 20;
  run(audio, POLICE_SHOUT.min + POLICE_SHOUT.extra, [near]);
  assert.equal(src(audio._npcVoice.sound), frasesDe('megafono', 'policia_a')[0].audio);
  endVoice(audio);
  const idle = patrol(5, false);
  audio.worldVoices._shoutIn = 0;
  run(audio, 3, [idle]);
  assert.equal(audio._npcVoice, null, 'la que patrulla no grita');
  audio.dispose();
});

test('la radio: pedir refuerzo, la llamada del testigo, la fuga y el arresto se oyen desde la patrulla cercana', () => {
  const { audio, events } = fixture();
  const car = patrol(6);
  audio.worldVoices._shoutIn = 99;
  audio.updateWorld(.1, origin, null, [car]);
  events.dispatchEvent(new CustomEvent('police-radio', { detail: { reason: 'refuerzo' } }));
  run(audio, POLICE_RADIO.gap + .2, [car]);
  assert.equal(src(audio._npcVoice.sound), '/audio/voces/policia_a_radio_1.mp3');
  endVoice(audio);
  run(audio, POLICE_RADIO.gap + .2, [car]);
  assert.equal(src(audio._npcVoice.sound), '/audio/voces/operadora_radio_3.mp3');
  endVoice(audio);
  events.dispatchEvent(new CustomEvent('police-radio', { detail: { reason: 'llamada' } }));
  run(audio, POLICE_RADIO.gap + .2, [car]);
  assert.equal(src(audio._npcVoice.sound), '/audio/voces/operadora_radio_2.mp3');
  endVoice(audio);
  car.state = 'patrol'; car.car.pursuit = false;
  events.dispatchEvent(new CustomEvent('police-escaped', { detail: { reason: 'vista' } }));
  run(audio, POLICE_RADIO.gap + .2, [car]);
  assert.match(src(audio._npcVoice.sound), /policia_a_(escape_1|radio_2)\.mp3$/);
  endVoice(audio);
  run(audio, POLICE_RADIO.gap + .2, [car]);
  assert.equal(src(audio._npcVoice.sound), '/audio/voces/operadora_radio_4.mp3');
  // El arresto entra aunque otra voz esté sonando.
  const owner = { position: new THREE.Vector3(1, 0, 0), hp: 100 };
  endVoice(audio); audio.updateWorld(.1, origin, null, [car]);
  audio.playNpcVoice('/audio/derrota.mp3', owner);
  events.dispatchEvent(new CustomEvent('police-arrest', { detail: { reason: 'chase' } }));
  assert.equal(src(audio._npcVoice.sound), '/audio/voces/policia_a_arresto_1.mp3');
  // Sin patrulla cerca nadie oye la radio.
  endVoice(audio);
  car.car.position.x = POLICE_RADIO.range + 5;
  events.dispatchEvent(new CustomEvent('police-radio', { detail: { reason: 'llamada' } }));
  run(audio, 1, [car]);
  assert.equal(audio._npcVoice, null);
  audio.dispose();
});

test('el jíbaro solo susurra de noche y a quien está cerca', () => {
  const { audio } = fixture();
  const dealer = { position: new THREE.Vector3(3, 0, 0), isNight: false };
  audio.worldVoices.dealer = dealer;
  run(audio, DEALER_WHISPER.min + DEALER_WHISPER.extra);
  assert.equal(audio._npcVoice, null, 'de día no ofrece');
  dealer.isNight = true;
  run(audio, DEALER_WHISPER.min * .3 + .2);
  assert.ok(frasesDe('ofrece', 'jibaro').some(frase => frase.audio === src(audio._npcVoice.sound)));
  endVoice(audio);
  dealer.position.x = DEALER_WHISPER.range + 2;
  run(audio, DEALER_WHISPER.min + DEALER_WHISPER.extra);
  assert.equal(audio._npcVoice, null, 'lejos no se le oye');
  audio.dispose();
});
