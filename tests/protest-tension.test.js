// Pruebas de la tensión de la protesta: el genio al azar, lo que hace el jugador, que las pacíficas no carguen, la basura según la gravedad y el audio.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { PROTEST, ProtestSystem, rollTemper } from '../src/systems/ProtestSystem.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { straightRoute } from '../src/systems/LimpiezaSocialSystem.js';
import { fakePool } from './fakePool.js';

const route = () => straightRoute(new THREE.Vector3(40, 0, -100), new THREE.Vector3(0, 0, 1), 200);

async function build({ random = () => .5, audio = null } = {}) {
  const people = await fakePool(PROTEST.protesters), cops = await fakePool(24);
  const player = { position: new THREE.Vector3(0, 0, 0) };
  const stats = { salud: 100 };
  const system = new ProtestSystem(new THREE.Scene(), { player, stats, people, cops, random, audio });
  const registered = [], wrecks = [];
  const vehicles = { closeSegment() {}, openSegment() {}, setWreckLevel: level => wrecks.push(level), removeWrecks() {} };
  system.setup({ getGroundHeight: () => 0 }, [route()], [], { vehicles, interaction: { register: t => registered.push(t), unregister: t => registered.splice(registered.indexOf(t), 1) } });
  system.elapsed = PROTEST.grace;
  system.cooldown = 0;
  return { system, player, stats, registered, wrecks };
}

const start = (system, temper, kind = 'normal') => system.trigger({ force: true, kind, temper });
const until = (system, done, seconds = 900, dt = .25) => { for (let t = 0; t < seconds && !done(); t += dt) system.update(dt, {}); return done(); };
const toFaceoff = system => assert.ok(until(system, () => system.state === 'faceoff'));
const kinds = system => system.bitsData.reduce((n, b) => ({ ...n, [b.kind]: (n[b.kind] ?? 0) + 1 }), {});

test('el genio se tira al azar: un tercio pacífico, un tercio tenso y un tercio pelea; los paros se inclinan al conflicto', () => {
  const count = paro => {
    const n = { peaceful: 0, tense: 0, fight: 0, short: 0 };
    for (let i = 0; i < 1000; i++) {
      const r = rollTemper(() => (i + .5) / 1000, paro);
      n[r.temper]++;
      if (r.shortClash) n.short++;
    }
    return n;
  };
  const normal = count(false), paro = count(true);
  assert.ok(Math.abs(normal.peaceful - 340) <= 2 && Math.abs(normal.tense - 330) <= 2 && Math.abs(normal.fight - 330) <= 2, JSON.stringify(normal));
  assert.ok(normal.short > 100 && normal.short < normal.tense, 'de las tensas, unas con choque corto y otras sin choque');
  assert.ok(paro.fight > normal.fight && paro.peaceful < normal.peaceful);
  assert.ok(paro.fight >= 550);
  assert.equal(rollTemper(() => 0).temper, 'peaceful');
  assert.equal(rollTemper(() => .99).temper, 'fight');
});

test('al arrancar, la protesta tira el genio y lo guarda con su tensión inicial; el truco lo puede forzar', async () => {
  for (const [random, temper] of [[.1, 'peaceful'], [.5, 'tense'], [.9, 'fight']]) {
    const { system } = await build({ random: () => random });
    assert.equal(system.trigger({ force: true, kind: 'normal' }), true);
    assert.equal(system.plan.temper, temper);
    assert.equal(system.tension, PROTEST.tension.start);
  }
  const { system } = await build({ random: () => .9 });
  start(system, 'peaceful');
  assert.equal(system.plan.temper, 'peaceful');
  assert.ok(system.plan.cap < PROTEST.tension.tenseAt, 'una pacífica nunca llega sola a tensa');
});

test('una pacífica nunca carga: ni choque, ni última advertencia, ni piedras; todo se enfría y la gente se va caminando', async () => {
  const { system, registered } = await build();
  start(system, 'peaceful');
  const seen = new Set();
  let charged = false, maxTension = 0, fled = false, walked = false;
  for (let t = 0; t < 1500 && system.active; t += .25) {
    system.update(.25, {});
    seen.add(system.state);
    maxTension = Math.max(maxTension, system.tension);
    if (system.charge.phase !== 'idle' || system.actors.some(a => a.mode === 'charge') || system.rocks.length) charged = true;
    if (system.state === 'dispersal') for (const a of system.actors) if (a.kind === 'protester') { if (a.stance === 'huir') fled = true; else walked = true; }
  }
  assert.equal(system.state, 'idle');
  assert.ok(seen.has('faceoff') && seen.has('dispersal') && seen.has('aftermath'));
  assert.equal(seen.has('clash'), false);
  assert.equal(charged, false);
  assert.ok(maxTension < PROTEST.tension.tenseAt, `tensión máxima ${maxTension}`);
  assert.equal(fled, false);
  assert.equal(walked, true);
  assert.equal(system.clashes, 0);
  assert.equal(registered.length, 0, 'al limpiar ya no quedan cartones');
});

test('una tensa sin choque se calienta, prende un par de llantas y se va sin llegar a cargar', async () => {
  const { system } = await build({ random: () => .5 });
  start(system, 'tense');
  assert.equal(system.plan.shortClash, false);
  let clashed = false, aftermath = null;
  for (let t = 0; t < 1500 && system.active; t += .25) {
    system.update(.25, {});
    if (system.state === 'clash') clashed = true;
    if (system.state === 'aftermath' && !aftermath) aftermath = { outcome: system.outcome, tires: system.tireN, kinds: kinds(system), sheets: system.sheetsData.length };
  }
  assert.equal(clashed, false);
  assert.ok(system.peak >= PROTEST.tension.tenseAt && system.peak < PROTEST.tension.threshold);
  assert.equal(aftermath.outcome, 'tense');
  assert.equal(aftermath.tires, 2);
  assert.ok(aftermath.kinds.rock > 0 && aftermath.kinds.stick > 0 && aftermath.kinds.burnt === 2);
});

test('una tensa con choque corto lo tiene una sola vez y dura una fracción del choque completo', async () => {
  const { system } = await build({ random: () => .3 });
  start(system, 'tense');
  assert.equal(system.plan.shortClash, true);
  let outcome = null;
  for (let t = 0; t < 1500 && system.active; t += .25) {
    system.update(.25, {});
    if (system.state === 'aftermath' && !outcome) outcome = system.outcome;
  }
  assert.equal(system.clashes, 1);
  assert.ok(system.clashTime < PROTEST.phases.clash * .5, `el choque corto duró ${system.clashTime}`);
  assert.equal(outcome, 'tense');
});

test('una pelea llega sola al umbral y tras un choque se enfría para volver a reventar', async () => {
  const { system } = await build({ random: () => .9 });
  start(system, 'fight');
  toFaceoff(system);
  assert.ok(until(system, () => system.state === 'clash', 120), 'la pelea estalla en el cara a cara');
  assert.ok(system.tension >= PROTEST.tension.threshold);
  assert.ok(until(system, () => system.state === 'faceoff', 200));
  assert.ok(system.tension <= PROTEST.tension.afterClash + .1, 'tras el choque baja');
  assert.ok(until(system, () => system.state === 'clash', 200), 'y vuelve a reventar');
  assert.ok(system.clashes >= 2);
});

test('pegarle a un tombo sube la tensión rápido: dos puños y viene la carga; antes no hay última advertencia', async () => {
  const { system, player } = await build();
  start(system, 'peaceful');
  toFaceoff(system);
  until(system, () => false, 30);
  const calm = system.tension, cop = system.actors.find(a => a.kind === 'cop' && a.rank === 0);
  assert.ok(calm < PROTEST.tension.tenseAt);
  assert.ok(player.extraMeleeTargets.includes(cop.proxy), 'el tombo es un blanco del puño');
  assert.equal(cop.proxy.takeHit({ damage: 10 }), 0);
  assert.ok(system.tension >= calm + PROTEST.tension.hitCop - 1e-9);
  system.update(.25, {});
  assert.equal(system.state, 'faceoff', 'con un puño todavía no revienta');
  assert.equal(system.charge.phase, 'idle');
  assert.equal(system.actors.some(a => a.mode === 'charge'), false);
  assert.ok(system.tireN >= 2, 'ya hay llantas ardiendo');
  system.actors.find(a => a.kind === 'cop' && a.rank === 1).proxy.takeHit({ damage: 10 });
  system.update(.25, {});
  assert.equal(system.state, 'clash');
  assert.ok(until(system, () => system.charge.phase === 'warn', 10), 'ahora sí, la última advertencia');
  assert.ok(until(system, () => system.charge.phase === 'run', 10));
  assert.equal(system.outcome, null);
});

test('tirarle popó a un tombo también calienta la cosa, a un manifestante menos; el proyectil se gasta al pegar', async () => {
  const { system } = await build();
  start(system, 'peaceful');
  toFaceoff(system);
  const cop = system.actors.find(a => a.kind === 'cop'), person = system.actors.find(a => a.kind === 'protester' && a.arrived);
  const shot = at => ({ alive: true, position: new THREE.Vector3(at.pos.x, .9, at.pos.z), disposed: 0, dispose() { this.disposed++; } });
  const before = system.tension, p1 = shot(person);
  system.noteThrown(p1);
  system.update(.1, {});
  const afterPerson = system.tension;
  assert.ok(afterPerson - before >= PROTEST.tension.poopProtester - .01 && afterPerson - before < PROTEST.tension.poopCop);
  assert.equal(p1.disposed, 1);
  assert.equal(p1.alive, false);
  const p2 = shot(cop);
  system.noteThrown(p2);
  system.update(.1, {});
  assert.ok(system.tension - afterPerson >= PROTEST.tension.poopCop - .01);
  const miss = { alive: true, position: new THREE.Vector3(300, 1, 300), dispose() {} };
  system.noteThrown(miss);
  const t = system.tension;
  system.update(.1, {});
  assert.ok(system.tension - t < .05, 'un tiro perdido no calienta');
});

test('pegarle a los manifestantes empeora la cosa y los vuelve contra el jugador: los tombos van por él en la carga', async () => {
  const { system, player } = await build();
  start(system, 'peaceful');
  toFaceoff(system);
  until(system, () => false, 20);
  const calm = system.tension;
  const people = system.actors.filter(a => a.kind === 'protester' && a.arrived && a.mode === 'stand').slice(0, 3);
  for (const p of people) p.proxy.takeHit({ damage: 8 });
  assert.ok(system.tension > calm + PROTEST.tension.hitProtester * 2 - 1e-9);
  assert.ok(system.hostile > PROTEST.tension.hostileLimit);
  player.position.copy(system.center).addScaledVector(system.axis, -20);
  system.tension = PROTEST.tension.threshold;
  assert.ok(until(system, () => system.charge.phase === 'run', 30));
  assert.ok(system.actors.filter(a => a.target === player).length >= 3, 'más de dos tombos van por el jugador');
});

test('la basura crece con la gravedad: más y más tiempo de limpieza; los cartones se recogen siempre y solo el choque deja carros destrozados', async () => {
  const outcomes = {};
  for (const [name, temper, random] of [['peaceful', 'peaceful', .5], ['tense', 'tense', .5], ['clash', 'fight', .9]]) {
    const { system, registered, wrecks } = await build({ random: () => random });
    start(system, temper);
    assert.ok(until(system, () => system.state === 'aftermath', 1500));
    const scraps = registered.slice();
    const harvested = scraps[0].harvest();
    outcomes[name] = {
      outcome: system.outcome, sheets: system.sheetsData.length, bits: system.bitsData.length, kinds: kinds(system), tires: system.tireN,
      aftermath: system.phases.aftermath, cleanup: system.phases.cleanup, scraps: scraps.length, items: harvested?.items ?? [], wreck: Math.max(0, ...wrecks.filter(Number.isFinite))
    };
  }
  const { peaceful, tense, clash } = outcomes;
  assert.deepEqual([peaceful.outcome, tense.outcome, clash.outcome], ['peaceful', 'tense', 'clash']);
  assert.ok(peaceful.sheets > 0 && peaceful.kinds.trash > 0, 'hasta la pacífica deja volantes, cartones y algo de basura');
  assert.equal(peaceful.tires, 0);
  assert.equal(peaceful.kinds.rock ?? 0, 0);
  assert.equal(peaceful.kinds.stick ?? 0, 0);
  assert.ok(tense.kinds.rock > 0 && tense.kinds.stick > 0 && tense.tires === 2 && tense.kinds.burnt === 2);
  assert.equal(clash.tires, PROTEST.tires);
  assert.ok(clash.kinds.burnt >= 6 && clash.kinds.stick >= 24 && (clash.kinds.canister ?? 0) > 0);
  assert.ok(peaceful.sheets < tense.sheets && tense.sheets <= clash.sheets);
  assert.ok(peaceful.bits < tense.bits && tense.bits < clash.bits, JSON.stringify([peaceful.bits, tense.bits, clash.bits]));
  assert.ok(peaceful.aftermath < tense.aftermath && tense.aftermath < clash.aftermath);
  assert.ok(peaceful.cleanup < tense.cleanup && tense.cleanup < clash.cleanup);
  for (const o of [peaceful, tense, clash]) { assert.equal(o.scraps, PROTEST.scraps); assert.ok(o.items.includes('carton')); }
  assert.equal(peaceful.wreck, 0);
  assert.equal(tense.wreck, 0);
  assert.ok(clash.wreck > 0);
});

test('una pacífica y una pelea terminan con la calle limpia después de su limpieza', async () => {
  for (const [temper, random] of [['peaceful', .5], ['fight', .9]]) {
    const { system } = await build({ random: () => random });
    start(system, temper);
    assert.ok(until(system, () => !system.active, 2500));
    assert.equal(system.bits.count, 0);
    assert.equal(system.tires.count, 0);
    assert.equal(system.tireN, 0);
    assert.equal(system.player.extraMeleeTargets ?? null, null);
  }
});

const fakeAudio = () => {
  const audio = { calls: [], starts: [], playing: new Set(), stops: 0, state: () => null };
  audio.playProtest = (name, distance) => {
    audio.calls.push([name, distance]);
    if (audio.playing.has(name)) return false;
    audio.playing.add(name);
    audio.starts.push([name, audio.state()]);
    return true;
  };
  audio.updateProtest = () => {};
  audio.stopProtest = () => { audio.stops++; audio.playing.clear(); };
  return audio;
};

test('audio: el grito suena en la concentración y el cara a cara, se repite al terminar, no suena en el choque y calla al acabar', async () => {
  const audio = fakeAudio();
  const { system } = await build({ audio, random: () => .9 });
  audio.state = () => system.state;
  start(system, 'fight');
  const chants = () => audio.starts.filter(([name]) => name === 'chant');
  system.update(.25, {});
  assert.equal(chants().length, 0, 'primero espera un momento');
  until(system, () => chants().length >= 1, 10);
  assert.equal(chants().length, 1);
  assert.deepEqual(chants()[0], ['chant', 'gathering']);
  for (let i = 0; i < 40; i++) system.update(.25, {});
  assert.equal(chants().length, 1, 'mientras suena no se apila otro');
  audio.playing.delete('chant');
  assert.ok(until(system, () => chants().length >= 2, PROTEST.chantGap[1] + 1), 'cuando termina, se repite después de una pausa');
  let silent = true;
  for (let t = 0; t < 400 && system.state !== 'aftermath'; t += .25) {
    const before = audio.starts.length, state = system.state;
    system.update(.25, {});
    audio.playing.delete('chant');
    if (state === 'clash' && audio.starts.slice(before).some(([name]) => name === 'chant')) silent = false;
  }
  assert.equal(silent, true);
  assert.ok(audio.starts.filter(([name, state]) => name === 'chant' && state !== 'clash').every(([, state]) => state === 'gathering' || state === 'faceoff'));
  assert.ok(audio.stops >= 1, 'al llegar el desastre se corta todo');
  assert.equal(audio.playing.size, 0);
});

test('audio: la sirena suena cuando los tombos forman la fila y cuando cargan, a distancia del jugador', async () => {
  const audio = fakeAudio();
  const { system, player } = await build({ audio, random: () => .9 });
  audio.state = () => system.state;
  start(system, 'fight', 'normal');
  const sirens = () => audio.starts.filter(([name]) => name === 'siren');
  assert.equal(sirens().length, 0);
  toFaceoff(system);
  assert.equal(sirens().length, 1);
  assert.equal(sirens()[0][1], 'faceoff');
  audio.playing.delete('siren');
  assert.ok(until(system, () => system.charge.phase === 'run', 300));
  assert.equal(sirens().length, 2, 'otra en la carga');
  const [, distance] = audio.calls.filter(([name]) => name === 'siren').at(-1);
  assert.ok(Math.abs(distance - Math.hypot(player.position.x - system.center.x, player.position.z - system.center.z)) < 1e-6);
});

test('audio: en un paro la sirena se repite cada tanto', async () => {
  const audio = fakeAudio();
  const { system } = await build({ audio, random: () => .9 });
  start(system, 'peaceful', 'paro');
  let count = 0;
  for (let t = 0; t < PROTEST.sirenGap[1] * 4 + 120; t += .5) {
    system.update(.5, {});
    audio.playing.delete('siren');
    count = audio.starts.filter(([name]) => name === 'siren').length;
  }
  assert.ok(count >= 3, `sirenas en el paro: ${count}`);
});

test('audio: sin protesta no suena nada, y morir o recargar corta lo que suene', async () => {
  const audio = fakeAudio();
  const { system } = await build({ audio });
  for (let i = 0; i < 400; i++) system.update(.25, { hour: 3 });
  assert.equal(audio.calls.length, 0);
  start(system, 'fight');
  until(system, () => audio.playing.size > 0, 30);
  assert.ok(audio.playing.size > 0);
  system.reset();
  assert.equal(audio.playing.size, 0);
});

test('audio: el sistema de sonido arranca una sola copia, baja con la distancia, no suena lejos ni en pausa', () => {
  class FakeHowl {
    constructor(options) { this.options = options; this.voices = new Map(); this.starts = 0; }
    state() { return 'loaded'; }
    play() { const id = this.voices.size + 1; this.voices.set(id, { playing: true }); this.starts++; return id; }
    playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
    stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
    pause() {} seek() {} rate() {} pos() {} duration() { return 4; }
    volume(value, id) { if (id !== undefined) this.voices.get(id).volume = value; }
    unload() {}
  }
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: null });
  const chant = audio.sounds.protestChant, siren = audio.sounds.protestSiren;
  assert.match(chant.options.src[0], /protesta_pueblo_unido\.mp3$/);
  assert.match(siren.options.src[0], /protesta_paro_sirena\.mp3$/);
  assert.equal(audio.playProtest('chant', 20), true);
  assert.equal(audio.playProtest('chant', 20), false);
  for (let i = 0; i < 20; i++) audio.playProtest('chant', 20);
  assert.equal(chant.starts, 1, 'nunca apila copias');
  const near = chant.voices.get(1).volume;
  audio.updateProtest(70);
  assert.ok(chant.voices.get(1).volume < near && chant.voices.get(1).volume > 0);
  assert.equal(audio.playProtest('siren', 12), true);
  assert.equal(siren.starts, 1);
  assert.equal(audio.playProtest('siren', 12), false);
  audio.stopProtest();
  assert.equal(chant.playing(), false);
  assert.equal(siren.playing(), false);
  assert.equal(audio.playProtest('chant', 500), false, 'lejos no se oye');
  assert.equal(chant.starts, 1);
  assert.equal(audio.playProtest('chant', 30), true, 'tras parar puede volver a sonar');
  audio.setPaused(true);
  assert.equal(chant.playing(), false, 'en pausa calla');
  assert.equal(audio.playProtest('chant', 30), false);
  assert.equal(audio.playProtest('mariachi', 10), false);
});

test('audio: los dos archivos de la protesta existen en public/audio', () => {
  for (const file of ['protesta_pueblo_unido.mp3', 'protesta_paro_sirena.mp3']) assert.ok(existsSync(new URL(`../public/audio/${file}`, import.meta.url)), file);
});
