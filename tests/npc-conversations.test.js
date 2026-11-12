import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NpcConversations } from '../src/systems/NpcConversations.js';
import { NPC_CONVERSATIONS } from '../src/data/npcConversations.js';

class FakeSound {
  constructor(file) { this.file = file; this.id = 0; this.playingId = null; this.volumes = []; this.unloaded = false; this.loadState = 'loaded'; }
  state() { return this.loadState; }
  play() { this.playingId = ++this.id; return this.playingId; }
  playing(id) { return this.playingId === id; }
  stop(id) { if (this.playingId === id) this.playingId = null; }
  volume(value) { this.volumes.push(value); }
  duration() { return 1.5; }
  unload() { this.unloaded = true; }
  finish() { this.playingId = null; }
}

const CONVERSATION = {
  id: 'prueba',
  hablantes: { A: { sexo: 'mujer', edad: 'adulto' }, B: { sexo: 'hombre', edad: 'mayor' } },
  lineas: [
    { hablante: 'A', texto: 'Uno.', file: 'a1.mp3' },
    { hablante: 'B', texto: 'Dos.', file: 'b1.mp3' },
    { hablante: 'A', texto: 'Tres.', file: 'a2.mp3' }
  ]
};
const ENTRE_MUJERES = {
  id: 'mujeres',
  hablantes: { A: { sexo: 'mujer', edad: 'adulto' }, B: { sexo: 'mujer', edad: 'adulto' } },
  lineas: [{ hablante: 'A', texto: 'Hola.', file: 'm1.mp3' }, { hablante: 'B', texto: 'Quiubo.', file: 'm2.mp3' }]
};

const person = (x, sexo, edad = 'adulto', extra = {}) => ({
  position: { x, y: 0, z: 0 }, person: {}, look: { real: { sexo, edad } }, talk: null, moving: false, dichos: [],
  navigation: { isSidewalkAt: () => true },
  say(text) { this.dichos.push(text); }, ...extra
});

function fixture(conversations = [CONVERSATION]) {
  const loaded = [];
  const system = new NpcConversations({ conversations, random: () => 0, load: file => { const s = new FakeSound(file); loaded.push(s); return s; } });
  return { system, loaded };
}

const listener = { x: 0, y: 0, z: 0 };
const playing = loaded => loaded.find(sound => sound.playingId);
/** Lo que haría Npc._converse: llegar a su sitio. */
const arrive = (...people) => { for (const npc of people) { if (npc.talk.spot) Object.assign(npc.position, npc.talk.spot); npc.talk.ready = true; } };
/** Empieza una charla entre los dos y deja que lleguen a su sitio y digan la primera frase. */
function startTalking(system, a, b) {
  system.update(listener, [a, b], 0);
  arrive(a, b);
  system.update(listener, [a, b], 10);
  system.update(listener, [a, b], 1000);
}

test('los datos del juego: dos hablantes de sexo conocido y cada línea con su audio', () => {
  assert.ok(NPC_CONVERSATIONS.length > 0);
  for (const conversation of NPC_CONVERSATIONS) {
    const roles = Object.keys(conversation.hablantes);
    assert.equal(roles.length, 2, conversation.id);
    for (const role of roles) assert.ok(['hombre', 'mujer'].includes(conversation.hablantes[role].sexo), conversation.id);
    for (const line of conversation.lineas) {
      assert.ok(roles.includes(line.hablante), `${conversation.id}: ${line.hablante}`);
      assert.match(line.file, /^conv_[a-z0-9_]+\.mp3$/);
      assert.ok(line.texto.trim());
    }
  }
});

test('se acercan a distancia de charla y no hablan hasta estar frente a frente', () => {
  const { system, loaded } = fixture();
  const ella = person(1, 'mujer'), el = person(4, 'hombre', 'mayor');
  system.update(listener, [ella, el], 0);
  assert.equal(ella.talk.partner, el);
  assert.equal(el.talk.partner, ella);
  const gap = Math.abs(el.talk.spot.x - ella.talk.spot.x);
  assert.ok(Math.abs(gap - 1.1) < 1e-9, `quedan a 1,1 m (${gap})`);
  assert.equal(ella.talk.spot.x + el.talk.spot.x, 5, 'se encuentran a mitad de camino');
  system.update(listener, [ella, el], 2000);
  assert.equal(playing(loaded), undefined, 'mientras caminan nadie habla');
  arrive(ella, el);
  system.update(listener, [ella, el], 2010);
  system.update(listener, [ella, el], 2200);
  assert.equal(playing(loaded), undefined, 'una pausa breve ya de frente antes de empezar');
  system.update(listener, [ella, el], 2500);
  assert.equal(playing(loaded).file, 'a1.mp3');
});

test('dicen las líneas por turnos: quien habla gesticula y quien escucha espera', () => {
  const { system, loaded } = fixture();
  const ella = person(2, 'mujer'), el = person(3, 'hombre', 'mayor');
  startTalking(system, ella, el);
  assert.equal(playing(loaded).file, 'a1.mp3');
  assert.deepEqual(ella.dichos, ['Uno.']);
  assert.equal(ella.talk.stance, 'hablar');
  assert.equal(el.talk.stance, el.talk.listen);
  assert.ok(el.talk.listen, 'escucha con una postura de espera');
  playing(loaded).finish();
  system.update(listener, [ella, el], 1010);
  assert.equal(ella.talk.stance, ella.talk.listen, 'terminado su turno vuelve a escuchar');
  system.update(listener, [ella, el], 1400);
  assert.equal(playing(loaded).file, 'b1.mp3', 'el turno del hombre lo dice él');
  assert.equal(el.talk.stance, 'hablar');
  playing(loaded).finish();
  system.update(listener, [ella, el], 1410);
  system.update(listener, [ella, el], 1800);
  playing(loaded).finish();
  system.update(listener, [ella, el], 1810);
  system.update(listener, [ella, el], 2200);
  assert.equal(system.busy, false, 'al terminar suelta el canal');
  assert.equal(ella.talk, null);
  assert.equal(el.talk, null);
  assert.ok(loaded.every(sound => sound.unloaded), 'libera sus audios');
});

test('quien carga algo conversa sin gesticular ni cruzar los brazos', () => {
  const { system } = fixture();
  const ella = person(2, 'mujer', 'adulto', { person: { style: { carry: 'derecha' } } }), el = person(3, 'hombre');
  startTalking(system, ella, el);
  assert.equal(ella.talk.stance, null);
  assert.equal(ella.talk.listen, null);
});

test('dos que esperan juntas ganan a quien está más cerca del jugador pero de paso', () => {
  const { system } = fixture([CONVERSATION, ENTRE_MUJERES]);
  const pasa = person(.5, 'hombre', 'mayor', { moving: true });
  const una = person(1.5, 'mujer'), otra = person(2.6, 'mujer');
  system.update(listener, [pasa, una, otra], 0);
  assert.equal(una.talk?.partner, otra);
  assert.equal(pasa.talk, null);
});

test('nadie sentado, pidiendo, con el celular o fumando entra en una charla', () => {
  for (const stance of ['banca', 'sentado', 'pedir', 'acurrucado', 'telefono', 'celular', 'fumar-quieto']) {
    const { system } = fixture();
    const ella = person(2, 'mujer', 'adulto', { stance }), el = person(3, 'hombre');
    system.update(listener, [ella, el], 0);
    assert.equal(system.busy, false, stance);
  }
});

test('el fijo no se mueve: el otro va hacia él y queda a distancia de charla', () => {
  const { system } = fixture();
  const fija = person(2, 'mujer', 'adulto', { fijo: { out: false } }), el = person(5, 'hombre');
  system.update(listener, [fija, el], 0);
  assert.equal(fija.talk.spot, null);
  assert.equal(fija.talk.ready, true);
  assert.ok(Math.abs(el.talk.spot.x - 3.1) < 1e-9);
});

test('un sitio fuera del andén no se pisa: se queda donde está', () => {
  const { system } = fixture();
  const nav = { isSidewalkAt: (p) => p.x === 5 }; // donde está sí es andén; su sitio de charla (x 4,05) no
  const ella = person(2, 'mujer', 'adulto', { navigation: { isSidewalkAt: () => true } }), el = person(5, 'hombre', 'adulto', { navigation: nav });
  system.update(listener, [ella, el], 0);
  assert.equal(el.talk.spot, null, 'su sitio cae en la calzada');
  assert.equal(el.talk.ready, true);
});

test('sin la pareja de sexos de alguna conversación, nadie se para', () => {
  const { system, loaded } = fixture();
  const a = person(2, 'mujer'), b = person(3, 'mujer');
  system.update(listener, [a, b], 0);
  assert.equal(system.busy, false);
  assert.equal(loaded.length, 0);
  assert.equal(a.talk, null);
});

test('lejos uno del otro, lejos del jugador, en la calzada o asustado no empiezan', () => {
  const casos = [
    [person(2, 'mujer'), person(8, 'hombre')],
    [person(10, 'mujer'), person(11, 'hombre')],
    [person(2, 'mujer', 'adulto', { navigation: { isSidewalkAt: () => false } }), person(3, 'hombre')],
    [person(2, 'mujer', 'adulto', { fleeTimer: 3 }), person(3, 'hombre')],
    [person(2, 'mujer', 'adulto', { fijo: { out: true } }), person(3, 'hombre')],
    [person(2, 'mujer', 'adulto', { person: null }), person(3, 'hombre')]
  ];
  for (const pareja of casos) {
    const { system } = fixture();
    system.update(listener, pareja, 0);
    assert.equal(system.busy, false);
  }
});

test('si no llegan a su sitio a tiempo, desisten sin dejar a nadie parado', () => {
  const { system } = fixture();
  const ella = person(1, 'mujer'), el = person(4, 'hombre');
  system.update(listener, [ella, el], 0);
  system.update(listener, [ella, el], 6000);
  assert.equal(system.busy, false);
  assert.equal(ella.talk, null);
  assert.equal(el.talk, null);
});

test('un susto a mitad de la charla la corta y los suelta', () => {
  const { system, loaded } = fixture();
  const ella = person(2, 'mujer'), el = person(3, 'hombre');
  startTalking(system, ella, el);
  assert.ok(playing(loaded));
  el.fleeTimer = 4;
  system.update(listener, [ella, el], 1100);
  assert.equal(system.busy, false);
  assert.equal(playing(loaded), undefined, 'la línea calla');
  assert.equal(ella.talk, null);
  assert.equal(el.talk, null);
});

test('otra voz en curso no la deja empezar y el reclamo por robo la corta', () => {
  const { system } = fixture();
  const ella = person(2, 'mujer'), el = person(3, 'hombre');
  system.externalVoiceActive = () => true;
  system.update(listener, [ella, el], 0);
  assert.equal(system.busy, false);
  system.externalVoiceActive = () => false;
  system.update(listener, [ella, el], 0);
  assert.equal(system.busy, true);
  system.cancel();
  assert.equal(system.busy, false);
  assert.equal(ella.talk, null);
});

test('se oye clara al lado, murmullo a pocos metros y se corta al alejarse', () => {
  const { system, loaded } = fixture();
  const ella = person(2, 'mujer'), el = person(3, 'hombre');
  startTalking(system, ella, el);
  const sound = playing(loaded);
  assert.equal(sound.volumes.at(-1), .6, 'de cerca, más bajo que una voz dirigida al jugador');
  system.update({ x: -4, y: 0, z: 0 }, [ella, el], 1100);
  const lejos = sound.volumes.at(-1);
  assert.ok(lejos > 0 && lejos < .15, `a 6 m ya es un murmullo (${lejos})`);
  system.update({ x: -12, y: 0, z: 0 }, [ella, el], 1200);
  assert.equal(system.busy, false, 'a más de 12 m de los dos la charla se corta');
});

test('la misma conversación y las mismas personas esperan antes de repetir', () => {
  const { system } = fixture();
  const ella = person(2, 'mujer'), el = person(3, 'hombre');
  system.update(listener, [ella, el], 0);
  system.cancel();
  system.update(listener, [ella, el], 100000);
  assert.equal(system.busy, false, 'a los 100 s todavía no');
  const otra = person(2.5, 'mujer'), otro = person(3.5, 'hombre');
  system.update(listener, [otra, otro], 100000);
  assert.equal(system.busy, false, 'la conversación sigue en su enfriamiento');
});

test('si un audio no carga, desiste sin dejar a nadie parado', () => {
  const { system, loaded } = fixture();
  const ella = person(2, 'mujer'), el = person(3, 'hombre');
  system.update(listener, [ella, el], 0);
  loaded[1].loadState = 'loading';
  loaded[1].loadFailed = true;
  system.update(listener, [ella, el], 10);
  assert.equal(system.busy, false);
  assert.equal(ella.talk, null);
});

test('una pareja fija que ya conversaba con gestos es la primera en ponerle voz, aunque esté en el prado', () => {
  const { system } = fixture([CONVERSATION, ENTRE_MUJERES]);
  const prado = { isSidewalkAt: () => false };
  const senora = person(4, 'mujer', 'adulto', { fijo: { out: false }, navigation: prado });
  const abuelo = person(5, 'hombre', 'mayor', { fijo: { out: false, pareja: senora }, navigation: prado });
  senora.fijo.pareja = abuelo;
  const una = person(1, 'mujer'), otra = person(2, 'mujer');
  system.update(listener, [una, otra, senora, abuelo], 0);
  assert.equal(senora.talk?.partner, abuelo);
  assert.equal(una.talk, null);
  assert.equal(senora.talk.spot, null, 'ninguno de los dos se mueve de su sitio');
  assert.equal(abuelo.talk.spot, null);
});
