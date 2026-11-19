import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NpcConversations } from '../src/systems/NpcConversations.js';
import { NPC_CONVERSATIONS } from '../src/data/npcConversations.js';
import { audioMetadata } from './helpers/audio-file.js';

class FakeSound {
  constructor(file) { this.file = file; this.id = 0; this.playingId = null; this.pausedId = null; this.volumes = []; this.unloaded = false; this.loadState = 'loaded'; }
  state() { return this.loadState; }
  play(id) {
    if (id === this.pausedId) { this.pausedId = null; this.playingId = id; }
    else this.playingId = ++this.id;
    return this.playingId;
  }
  playing(id) { return this.playingId === id; }
  pause(id) { if (this.playingId === id) { this.playingId = null; this.pausedId = id; } }
  stop(id) {
    if (this.playingId === id) this.playingId = null;
    if (this.pausedId === id) this.pausedId = null;
  }
  volume(value) { this.volumes.push(value); }
  duration() { return 1.5; }
  unload() { this.unloaded = true; }
  finish() { this.playingId = null; }
}

const CONVERSATION = {
  id: 'prueba',
  hablantes: { A: { voz: 'conductora', sexo: 'mujer', edad: 'adulto' }, B: { voz: 'conductor', sexo: 'hombre', edad: 'mayor' } },
  lineas: [
    { hablante: 'A', texto: 'Uno.', file: 'a1.mp3' },
    { hablante: 'B', texto: 'Dos.', file: 'b1.mp3' },
    { hablante: 'A', texto: 'Tres.', file: 'a2.mp3' }
  ]
};
const ENTRE_MUJERES = {
  id: 'mujeres',
  hablantes: { A: { voz: 'conductora', sexo: 'mujer', edad: 'adulto' }, B: { voz: 'conductora', sexo: 'mujer', edad: 'adulto' } },
  lineas: [{ hablante: 'A', texto: 'Hola.', file: 'm1.mp3' }, { hablante: 'B', texto: 'Quiubo.', file: 'm2.mp3' }]
};

const person = (x, sexo, edad = 'adulto', extra = {}) => ({
  position: { x, y: 0, z: 0 }, person: {}, look: { real: { sexo, edad } }, talk: null, moving: false, dichos: [],
  navigation: { isSidewalkAt: () => true },
  say(text) { this.dichos.push(text); this.frase = text; },
  callar(text) { if (this.frase === text) this.frase = null; }, ...extra
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

test('el encargado del mercado termina su turno aun cuando cambia la postura de las manos', () => {
  for (const stance of ['manos-atras', 'mirar-derecha']) {
    const { system } = fixture(NPC_CONVERSATIONS);
    const encargado = person(2, 'mujer', 'adulto', {
      stance, walkVisit: { stance: 'atender' }, wait: 9, _atVisit() { return this.wait > 0; },
    });
    const vecino = person(4.4, 'hombre');
    system.update(listener, [encargado, vecino], 0);
    assert.equal(system.busy, false, stance);
    encargado.wait = 0;
    system.update(listener, [encargado, vecino], 2100);
    assert.equal(encargado.talk?.partner, vecino, 'durante su paseo sí puede acercarse a conversar');
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

test('si un audio no carga, el interlocutor conserva su turno y su subtítulo', () => {
  const { system, loaded } = fixture();
  const ella = person(2, 'mujer'), el = person(3, 'hombre');
  system.update(listener, [ella, el], 0);
  loaded[1].loadState = 'loading';
  loaded[1].loadFailed = true;
  system.update(listener, [ella, el], 10);
  system.update(listener, [ella, el], 610);
  assert.equal(playing(loaded), loaded[0]);
  loaded[0].finish();
  system.update(listener, [ella, el], 700);
  system.update(listener, [ella, el], 1050);
  assert.equal(el.frase, 'Dos.');
  assert.equal(playing(loaded), undefined);
  system.update(listener, [ella, el], 3100);
  assert.equal(el.frase, null);
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

test('la persona que escucha reconoce el final de una pregunta antes de contestar', () => {
  const [first, ...others] = CONVERSATION.lineas;
  const { system, loaded } = fixture([{ ...CONVERSATION, lineas: [{ ...first, texto: '¿Uno?' }, ...others] }]);
  const ella = person(2, 'mujer'), el = person(3, 'hombre');
  startTalking(system, ella, el);
  playing(loaded).finish();
  system.update(listener, [ella, el], 1010);
  assert.equal(ella.frase, null);
  system.update(listener, [ella, el], 1260);
  assert.equal(ella.talk.nod, 0);
  assert.ok(el.talk.nod > .05, 'el que escuchó asiente mientras prepara la respuesta');
  system.update(listener, [ella, el], 1390);
  assert.equal(playing(loaded), undefined);
  system.update(listener, [ella, el], 1510);
  assert.equal(playing(loaded).file, 'b1.mp3');
  assert.equal(el.talk.nod, 0);
});

test('la pareja abre paso y retoma el mismo turno cuando el jugador cruza', () => {
  const { system, loaded } = fixture();
  const route = [{ x: 6, y: 0, z: 0 }];
  const ella = person(2, 'mujer', 'adulto', { route, target: route[0] }), el = person(3.1, 'hombre');
  const pair = [ella, el];
  startTalking(system, ...pair);
  const sound = playing(loaded), id = sound.playingId;
  system.update({ x: 2.55, y: 0, z: 1.02 }, pair, 1100);
  assert.equal(system.active, true);
  system.update({ x: 2.55, y: 0, z: .87 }, pair, 1200);
  assert.ok(ella.talk.yielding && el.talk.yielding, 'se anticipan a quien camina por medio');
  assert.ok(ella.talk.spot.x < 2 && el.talk.spot.x > 3.1);
  assert.equal(ella.talk.attention.position.z, .87);
  assert.equal(system.active, false);
  assert.equal(sound.pausedId, id);
  assert.equal(ella.frase, null);
  arrive(...pair);
  system.update({ x: 2.55, y: 0, z: 0 }, pair, 1310);
  const across = { x: 2.55, y: 0, z: -1.2 };
  system.update(across, pair, 1600);
  assert.equal(system.active, false, 'esperan un momento con el paso libre');
  system.update(across, pair, 1870);
  system.update(across, pair, 1880);
  assert.equal(ella.talk.yielding, false);
  assert.equal(ella.talk.attention, null);
  assert.equal(sound.playingId, id, 'no empieza de nuevo la grabación');
  assert.equal(ella.frase, 'Uno.');
  assert.equal(ella.route, route);
  assert.equal(ella.target, route[0]);
  sound.finish();
  system.update(across, pair, 1890);
  system.update(across, pair, 2240);
  assert.equal(playing(loaded).file, 'b1.mp3');
});

test('la charla se disuelve si el paso sigue ocupado y nadie retoma una voz vieja', () => {
  const { system, loaded } = fixture();
  const ella = person(2, 'mujer'), el = person(3.1, 'hombre');
  startTalking(system, ella, el);
  const blocking = { x: 2.55, y: 0, z: 0 };
  system.update(blocking, [ella, el], 1100);
  assert.ok(ella.talk.yielding);
  arrive(ella, el);
  system.update(blocking, [ella, el], 5200);
  assert.equal(system.busy, false);
  assert.equal(ella.talk, null);
  assert.equal(el.talk, null);
  assert.equal(ella.frase, null);
  assert.ok(loaded.every(sound => !sound.pausedId && !sound.playingId && sound.unloaded));
});

test('varios cruces seguidos aprovechan el mismo hueco', () => {
  const { system } = fixture();
  const ella = person(2, 'mujer'), el = person(3.1, 'hombre');
  startTalking(system, ella, el);
  const through = { x: 2.55, y: 0, z: 0 };
  const clear = { x: 2.55, y: 0, z: 1.5 };
  for (const at of [1100, 2000, 2900]) {
    system.update(through, [ella, el], at);
    assert.ok(ella.talk.yielding);
    arrive(ella, el);
    assert.ok(el.position.x - ella.position.x <= 2.001, 'el espacio no crece con cada persona de paso');
    system.update(clear, [ella, el], at + 600);
    system.update(clear, [ella, el], at + 620);
    assert.ok(system.active);
  }
});

test('si un tercero espera en el andén, nadie deja el andén o el puesto para abrir hueco', () => {
  const { system, loaded } = fixture();
  const fija = person(2, 'mujer', 'adulto', { fijo: { out: false } });
  const el = person(3.1, 'hombre', 'adulto', { navigation: { isSidewalkAt: p => p.x <= 3.38 } });
  startTalking(system, fija, el);
  const third = person(2.55, 'mujer', 'adulto', { target: { x: 2.55, y: 0, z: -2 }, mind: { blockerGroup: true, sideLockAgent: el } });
  third.position.z = 1.1;
  system.update(listener, [fija, el, third], 1100);
  assert.equal(fija.talk.spot, null);
  assert.equal(el.talk.spot, null, 'el borde no deja retroceder');
  assert.equal(el.talk.attention, third);
  assert.equal(playing(loaded), undefined);
  third.position.z = -2;
  third.mind.blockerGroup = false;
  system.update(listener, [fija, el, third], 1690);
  system.update(listener, [fija, el, third], 1700);
  assert.equal(playing(loaded).file, 'a1.mp3');
});

test('pausa, pérdida de interlocutor o una reacción limpian la línea y liberan la pareja', () => {
  for (const interruption of ['pausa', 'lista', 'dispose', 'reacción', 'voz prioritaria', 'distancia']) {
    const { system, loaded } = fixture();
    const ella = person(2, 'mujer'), el = person(3.1, 'hombre');
    const pair = [ella, el];
    startTalking(system, ...pair);
    assert.equal(ella.frase, 'Uno.');
    let position = listener;
    if (interruption === 'pausa') system.setPaused(true);
    if (interruption === 'lista') pair.pop();
    if (interruption === 'dispose') el._disposed = true;
    if (interruption === 'reacción') el.mind = { busy: () => true };
    if (interruption === 'voz prioritaria') system.externalVoiceActive = () => true;
    if (interruption === 'distancia') position = { x: -16, y: 0, z: 0 };
    system.update(position, pair, 1100);
    assert.equal(system.busy, false, interruption);
    assert.equal(ella.frase, null, interruption);
    assert.equal(ella.talk, null, interruption);
    assert.equal(el.talk, null, interruption);
    assert.ok(loaded.every(sound => !sound.playingId && sound.unloaded), interruption);
  }
});

test('cortar una charla preserva lo que el personaje dijo después de ese turno', () => {
  const { system } = fixture();
  const ella = person(2, 'mujer'), el = person(3.1, 'hombre');
  startTalking(system, ella, el);
  ella.say('¡Un momento!');
  el.talk.leave();
  assert.equal(system.busy, false);
  assert.equal(ella.frase, '¡Un momento!');
});

test('la pareja necesita verse desde el mismo piso y en el mismo lado de la calzada', () => {
  for (const obstacle of ['piso', 'muro', 'calzada']) {
    const { system, loaded } = fixture();
    const ella = person(2, 'mujer'), el = person(3.1, 'hombre');
    if (obstacle === 'piso') el.position.y = 2;
    if (obstacle === 'muro') ella.collisions = { queryStatic: () => [{ box: { min: { x: 2.4, y: 0, z: -.4 }, max: { x: 2.6, y: 2.5, z: .4 } } }] };
    if (obstacle === 'calzada') el.navigation = ella.navigation = { isSidewalkAt: ({ x }) => x < 2.3 || x > 2.8 };
    system.update(listener, [ella, el], 0);
    assert.equal(system.busy, false, obstacle);
    assert.equal(loaded.length, 0, obstacle);
  }
});

test('el tema corresponde al clima, la hora y el sitio de la pareja', () => {
  const contextual = { ...CONVERSATION, id: 'contexto', contexto: { lluvia: true, noche: true, lugar: 'paradero' },
    lineas: CONVERSATION.lineas.map(line => ({ ...line, file: `sitio-${line.file}` })) };
  for (const [lluvia, noche, near, selected] of [[true, true, true, 'sitio-a1.mp3'], [false, true, true, 'a1.mp3'], [true, false, true, 'a1.mp3'], [true, true, false, 'a1.mp3']]) {
    const { system, loaded } = fixture([CONVERSATION, contextual]);
    const ella = person(2, 'mujer'), el = person(3, 'hombre', 'mayor');
    system.update(listener, [ella, el], 0, { lluvia, noche, sitioCerca: (place, point) => near && place === 'paradero' && point.x === 2.5 });
    assert.equal(loaded[0].file, selected);
  }
});

test('el diálogo de un oficio corresponde a quien lo tiene', () => {
  const { system, loaded } = fixture([{ ...CONVERSATION, hablantes: { ...CONVERSATION.hablantes,
    A: { ...CONVERSATION.hablantes.A, arquetipo: 'reciclador' } } }]);
  const ella = person(2, 'mujer'), el = person(3, 'hombre');
  system.update(listener, [ella, el], 0);
  assert.equal(loaded.length, 0);
  ella.person.arquetipo = 'reciclador';
  system.update(listener, [ella, el], 2100);
  assert.equal(playing(loaded), undefined);
  assert.equal(ella.talk.partner, el);
});

test('la charla del cartón usa sus cuatro tomas con la pareja fija del parque', () => {
  const carton = NPC_CONVERSATIONS.find(escena => escena.id === 'carton');
  const { system, loaded } = fixture([carton]);
  const ella = person(2, 'mujer', 'adulto', { voiceRole: 'vecina_parque', person: { arquetipo: 'senora' } });
  const el = person(3.1, 'hombre', 'mayor', { voiceRole: 'vecino_parque', person: { arquetipo: 'abuelo' } });
  const contexto = { sitioCerca: lugar => lugar === 'parque' };
  system.update(listener, [ella, el], 0, contexto);
  assert.equal(loaded.length, 0, 'dos caminantes no toman el papel de la pareja');

  ella.fijo = { pareja: el };
  el.fijo = { pareja: ella };
  system.update(listener, [ella, el], 2100, { sitioCerca: () => false });
  assert.equal(loaded.length, 0, 'la pareja habla del cartón en el parque');
  system.update(listener, [ella, el], 4200, contexto);
  system.update(listener, [ella, el], 4210, contexto);

  const personas = { A: ella, B: el };
  let now = 4710;
  for (const line of carton.lineas) {
    const mp3 = readFileSync(new URL(`../public/audio/conversaciones/${line.file}`, import.meta.url));
    assert.ok(audioMetadata(mp3).duration > 1, line.file);
    system.update(listener, [ella, el], now, contexto);
    assert.equal(playing(loaded)?.file, line.file);
    assert.equal(personas[line.hablante].frase, line.texto);
    playing(loaded).finish();
    system.update(listener, [ella, el], ++now, contexto);
    assert.equal(personas[line.hablante].frase, null);
    now += 500;
  }
  system.update(listener, [ella, el], now, contexto);
  assert.equal(system.busy, false);
});
