import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeAudioContext } from './helpers/fake-audio-context.js';
import { GESTO_POR_CATEGORIA } from '../src/data/vocesReuso.js';
import { GESTOS_AMBIENTE, VOZ_TIMBRE, azarDe, perfilVocal, planVocalizacion } from '../src/systems/voces/gestosVocales.js';
import { LIMITE, VOCALIZADOR, Vocalizador, perfilDe, vocalizarFaltante } from '../src/systems/voces/Vocalizador.js';

const GESTOS = ['ay', 'ay_fuerte', 'ey', 'uy', 'uf', 'jaja', 'mmm', 'mmm_no', 'murmullo', 'ronquido'];

test('cada gesto sale igual con la misma semilla y dura poco: las reacciones menos de un segundo y medio', () => {
  const perfil = perfilVocal({ seed: 42, sexo: 'mujer' });
  for (const gesto of GESTOS) {
    const a = planVocalizacion(gesto, perfil, azarDe(7)), b = planVocalizacion(gesto, perfil, azarDe(7));
    assert.deepEqual(a, b, `${gesto} es repetible`);
    assert.ok(a.dur > .2, gesto);
    assert.ok(a.dur <= (GESTOS_AMBIENTE.has(gesto) ? 3 : 1.2), `${gesto}: ${a.dur} s`);
    assert.ok(a.ganancia > 0 && a.ganancia <= .6, gesto);
    for (const canal of ['pitch', 'formantes', 'amp', 'aire', 'friccion']) {
      const puntos = a[canal];
      for (let i = 1; i < puntos.length; i++) assert.ok(puntos[i][0] >= puntos[i - 1][0], `${gesto}.${canal} en orden`);
      for (const [t] of puntos) assert.ok(t >= 0 && t <= a.dur + 1e-9, `${gesto}.${canal} dentro de la toma`);
    }
    // Ni empieza ni termina de golpe.
    for (const canal of ['amp', 'aire']) {
      assert.equal(a[canal][0][1], 0, `${gesto}.${canal} entra desde cero`);
      assert.equal(a[canal].at(-1)[1], 0, `${gesto}.${canal} se apaga`);
    }
  }
  assert.equal(planVocalizacion('cantar', perfil), null);
});

test('el tono es el de cada quien: su voz del reparto, su sexo y su edad', () => {
  for (let seed = 1; seed < 60; seed++) {
    const mujer = perfilVocal({ seed, sexo: 'mujer' }), hombre = perfilVocal({ seed, sexo: 'hombre' });
    assert.ok(mujer.f0 >= 180 * .97 && mujer.f0 <= 240 * 1.03, `mujer ${mujer.f0}`);
    assert.ok(hombre.f0 >= 100 * .97 && hombre.f0 <= 140 * 1.03, `hombre ${hombre.f0}`);
    assert.ok(mujer.formantes > hombre.formantes);
  }
  const senora = perfilVocal({ seed: 3, voz: 'senora', sexo: 'mujer' });
  assert.ok(Math.abs(senora.f0 / VOZ_TIMBRE.senora - 1) <= .03, 'la señora se queja en su tono');
  const mayor = perfilVocal({ seed: 3, voz: 'senora', sexo: 'mujer', edad: 'mayor' });
  assert.ok(mayor.f0 < senora.f0 && mayor.temblor > senora.temblor);
  // La misma persona suena siempre igual: la semilla se queda con ella.
  const npc = { person: { id: 'p-17' }, look: { real: { sexo: 'mujer', edad: 'adulto' } } };
  assert.deepEqual(perfilDe(npc), perfilDe(npc));
  assert.ok(Number.isFinite(npc.vozSemilla));
  // Un ay de mujer es más agudo que uno de hombre.
  const ay = sexo => planVocalizacion('ay', perfilVocal({ seed: 5, sexo })).pitch[0][1];
  assert.ok(ay('mujer') > ay('hombre') * 1.3);
});

/** Un AudioSystem de mentira con el contexto falso de Howler. */
function montar({ state = 'running', voices = 1 } = {}) {
  const fake = createFakeAudioContext();
  fake.ctx.state = state;
  fake.ctx.createStereoPanner = () => { const n = { kind: 'panner', pan: { value: 0 }, connections: [], connect(t) { this.connections.push(t); return t; }, disconnect() { this.connections = []; } }; fake.created.push(n); return n; };
  const audio = {
    _paused: false, muted: false, howler: { ctx: fake.ctx, masterGain: fake.master },
    _listenerPosition: { x: 0, y: 0, z: 0 }, _camera: null, hablando: false,
    _level: () => voices, _voiceActive() { return this.hablando; },
  };
  const voc = new Vocalizador({ audio, random: () => .5 });
  return { voc, audio, ...fake };
}
const alguien = (x = 2, sexo = 'mujer') => ({ position: { x, y: 0, z: 0 }, look: { real: { sexo } } });

test('el grafo sale por el maestro de Howler, nunca directo a los parlantes, y se suelta entero al terminar', () => {
  const { voc, master, destination, created } = montar();
  assert.equal(voc.decir(alguien(), 'ay'), true);
  assert.equal(voc.activos, 1);
  const directos = created.filter(n => n.connections.includes(destination));
  assert.deepEqual(directos, [], 'nadie se conecta a ctx.destination');
  const bus = created.find(n => n.connections.includes(master));
  assert.ok(bus, 'el canal de voces va al maestro');
  assert.ok(created.some(n => n.kind === 'oscillator' && n.started));
  voc.callar();
  assert.equal(voc.activos, 0);
  const sueltos = created.filter(n => n !== bus && n.connections.length);
  assert.deepEqual(sueltos.map(n => n.kind), [], 'cada nodo de la toma quedó desconectado');
  voc.dispose();
  assert.equal(bus.connections.length, 0);
});

test('no suena sin Web Audio corriendo, en pausa, en silencio ni apagado; el canal sigue el volumen de Voces', () => {
  const dormido = montar({ state: 'suspended' });
  assert.equal(dormido.voc.decir(alguien(), 'ay'), false);
  assert.equal(dormido.created.length, 0, 'nada se construye con el contexto suspendido');
  const { voc, audio, created, master } = montar({ voices: .5 });
  audio._paused = true;
  assert.equal(voc.decir(alguien(), 'ay'), false);
  audio._paused = false; audio.muted = true;
  assert.equal(voc.decir(alguien(), 'ay'), false);
  audio.muted = false;
  VOCALIZADOR.activo = false;
  try { assert.equal(voc.decir(alguien(), 'ay'), false); } finally { VOCALIZADOR.activo = true; }
  assert.equal(voc.decir(alguien(), 'ay'), true);
  const bus = created.find(n => n.connections.includes(master));
  assert.equal(bus.gain.value, .5);
  audio._paused = true;
  voc.update();
  assert.equal(voc.activos, 0, 'la pausa calla lo que sonaba');
  voc.dispose();
});

test('nunca más de lo que cabe: dos reacciones, un sonido de ambiente, y la misma persona espera', () => {
  const { voc, audio } = montar();
  assert.equal(LIMITE.reactivos, 2);
  const [a, b, c] = [alguien(1), alguien(2), alguien(3)];
  assert.deepEqual([voc.decir(a, 'ay'), voc.decir(b, 'ey'), voc.decir(c, 'uy')], [true, true, false]);
  assert.equal(voc.decir(c, 'murmullo'), true, 'el ambiente tiene su propio cupo');
  assert.equal(voc.decir(alguien(4), 'ronquido'), false, 'y es de a uno');
  voc.callar();
  assert.equal(voc.decir(a, 'ay'), false, 'la misma persona espera 1,2 s entre gesto y gesto');
  // Con una frase grabada sonando, el ambiente calla y la reacción va más bajo.
  audio.hablando = true;
  assert.equal(voc.decir(alguien(5), 'murmullo'), false);
  assert.equal(voc.decir(alguien(6), 'ay'), true);
  // Lejos no suena.
  assert.equal(voc.decir(alguien(30), 'ay'), false);
  voc.dispose();
});

test('quien habla mueve la cabeza mientras dura su gesto', () => {
  const { voc } = montar();
  const npc = alguien(2);
  voc.decir(npc, 'ay_fuerte');
  assert.ok(npc._hablaHasta > npc._hablaDesde);
  const ronca = alguien(3);
  voc.decir(ronca, 'ronquido');
  assert.equal(ronca._hablaDesde, undefined, 'roncando no habla');
  voc.dispose();
});

test('a quien no tiene frase grabada le toca su gesto: una mujer golpeada dice «¡ay!»', () => {
  const dichos = [];
  const npc = { audio: { vocalizador: { decir: (n, gesto) => { dichos.push(gesto); return true; } } } };
  assert.equal(vocalizarFaltante(npc, 'hit'), true);
  assert.equal(vocalizarFaltante(npc, 'witnessFilm'), true);
  assert.equal(vocalizarFaltante(npc, 'ambient'), false, 'lo de ambiente no se rellena con gestos');
  assert.deepEqual(dichos, ['ay', 'jaja']);
  assert.equal(GESTO_POR_CATEGORIA.begNo, 'mmm_no');
  assert.equal(vocalizarFaltante({}, 'hit'), false, 'sin audio no pasa nada');
});
