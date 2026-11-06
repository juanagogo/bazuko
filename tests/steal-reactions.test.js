// tests/steal-reactions.test.js
// La víctima con el cuerpo de verdad (Npc real, modelo de mentira): se voltea, se queda quieta, se palpa,
// huye después, y siempre se suelta sola. Y el cuerpo del jugador: el raponazo llega una vez al bolso.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';

const character = () => ({
  group: new THREE.Group(), props: new Map(),
  update(dt, params) { this.last = params; },
  snapPose() {}, hold() { return true; }, setPropVisible() {}, motionState() { return {}; }, applyMotion() {},
  setSmoking() {}, dispose() {}
});
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => character(), loadCatalog: async () => ({}),
  normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });
const { Npc } = await import('../src/entities/Npc.js');
const { CoreografiaDeHurto, hablarRobo, alarmarVictima, armarContragolpe, tipoDeTiron } = await import('../src/features/stealReactions.js');
const { HURTO, CONTACTO_RAPONAZO } = await import('../src/character/hurto.js');

beforeEach(() => { globalThis.window = new EventTarget(); });

function street() {
  const row = Array.from({ length: 40 }, () => 'sidewalk');
  return new PedestrianNavigation([row, row, row], 2);
}
async function person(id = 'oficinista', at = [30, 0, 2]) {
  const navigation = street();
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(...at), {
    arquetipo: id, navigation, facing: 0, groundHeight: () => 0, isWalkable: (x, z) => navigation.isWalkableAt(x, z)
  });
  await npc.ready;
  npc.fullChar = character();
  return npc;
}
const yawError = (npc, target) => Math.abs(Math.atan2(Math.sin(Math.atan2(target.x - npc.position.x, target.z - npc.position.z) - npc.root.rotation.y),
  Math.cos(Math.atan2(target.x - npc.position.x, target.z - npc.position.z) - npc.root.rotation.y)));
const run = (npc, seconds, player, step = .05) => { for (let t = 0; t < seconds - 1e-9; t += step) npc.update(step, { player }); };

test('pillado: se voltea hacia el ladrón con las manos arriba, se queda quieta y después huye', async () => {
  const npc = await person();
  const player = new THREE.Vector3(31, 0, 2);
  const coreo = new CoreografiaDeHurto({ player: { position: player } });
  const before = yawError(npc, player);
  assert.equal(coreo.reaccionar(npc, 'sobresalto', { segundos: .5 }), true);
  npc.alarmedByTheft(player);
  run(npc, .3, player);
  assert.equal(npc.moving, false, 'quieta mientras se asusta');
  assert.equal(npc.character.last.hurto?.fase, 'sobresalto');
  assert.ok(yawError(npc, player) < before - .3, 'se voltea a mirar al ladrón');
  run(npc, .5, player);
  assert.equal(npc.scriptedHold, undefined);
  run(npc, .3, player);
  assert.equal(npc.moving, true, 'después huye');
  assert.ok(npc.fleeTimer > 0);
});

test('la pose que tenía la víctima vuelve tal cual, también si no tenía ninguna', async () => {
  const npc = await person();
  const player = new THREE.Vector3(31, 0, 2);
  const coreo = new CoreografiaDeHurto({ player: { position: player } });
  assert.equal(Object.prototype.hasOwnProperty.call(npc, 'poseParams') ? npc.poseParams : undefined, undefined);
  coreo.reaccionar(npc, 'mirar', { segundos: .2 });
  assert.ok(npc.poseParams);
  run(npc, .4, player);
  assert.equal(npc.poseParams, undefined);
  const propia = { stance: 'celular' };
  npc.poseParams = propia;
  coreo.reaccionar(npc, 'sobresalto', { segundos: .2 });
  assert.equal(npc.poseParams.stance, 'celular', 'conserva su postura durante el susto');
  run(npc, .4, player);
  assert.equal(npc.poseParams, propia);
});

test('un golpe durante el susto la suelta, y la quietud se acaba sola aunque nadie actualice el robo', async () => {
  const npc = await person();
  const player = new THREE.Vector3(31, 0, 2);
  const coreo = new CoreografiaDeHurto({ player: { position: player } });
  coreo.reaccionar(npc, 'helado', { segundos: 5 });
  npc.takeHit({ damage: 5, knockback: 1, attacker: { position: player, stats: { salud: 100 } } });
  coreo.update(1 / 60);
  assert.equal(npc.scriptedHold, undefined, 'el golpe manda');
  const solo = await person('senora', [20, 0, 2]);
  coreo.reaccionar(solo, 'sobresalto', { segundos: .4 });
  run(solo, .6, player);
  assert.equal(solo.scriptedHold, undefined, 'sin CoreografiaDeHurto.update también se suelta');
});

test('sentados o en el piso no se paran a hacer teatro', async () => {
  const npc = await person();
  npc.stance = 'banca';
  const coreo = new CoreografiaDeHurto({ player: { position: new THREE.Vector3() } });
  assert.equal(coreo.reaccionar(npc, 'sobresalto'), false);
  assert.equal(npc.scriptedHold, undefined);
});

test('descubrir tarde: se palpa, dice algo y solo si el ladrón sigue cerca lo ve', async () => {
  for (const [distancia, esperado] of [[3, 'cerca'], [20, 'lejos']]) {
    const npc = await person();
    const player = new THREE.Vector3(30 + distancia, 0, 2);
    const coreo = new CoreografiaDeHurto({ player: { position: player } });
    const dicho = [], llamadas = [];
    npc.say = (text) => dicho.push(text);
    coreo.programarDescubrimiento(npc, .1, { cerca: () => llamadas.push('cerca'), lejos: () => llamadas.push('lejos') });
    coreo.update(.2);
    assert.equal(coreo.pendientes, 0);
    assert.equal(npc.poseParams?.hurto?.fase, 'palparse');
    run(npc, .7, player);
    assert.equal(npc.moving, false, 'buscando en el bolsillo no anda');
    assert.equal(dicho.length, 1, 'dice algo al darse cuenta');
    run(npc, .5, player);
    assert.deepEqual(llamadas, [esperado], `a ${distancia} m`);
    if (esperado === 'lejos') assert.equal(npc.fleeTimer, 0, 'de lejos no sale corriendo');
    run(npc, 1, player);
    assert.equal(npc.scriptedHold, undefined);
  }
});

test('pegados después del robo, el radio vuelve despacio: el jugador no sale disparado', () => {
  const player = { position: new THREE.Vector3(), root: { rotation: { y: 0 } }, stealPose: null };
  const victima = { position: new THREE.Vector3(0, 0, .5) };
  const coreo = new CoreografiaDeHurto({ player });
  coreo.jugador('meter', 1, { victima });
  coreo.jugador('sacar');
  coreo.update(1);
  assert.equal(victima.radius, .1, 'todavía pegados: no empuja');
  let antes = victima.radius;
  for (let i = 0; i < 4 * 60; i++) {
    coreo.update(1 / 60);
    if (victima.radius === undefined) break;
    assert.ok(victima.radius - antes < .01, 'crece de a poco');
    antes = victima.radius;
  }
  for (let i = 0; i < 4 * 60; i++) coreo.update(1 / 60);
  assert.equal(victima.radius, undefined);
});

test('el raponazo del jugador llega una vez al bolso y el cuerpo vuelve al clip', () => {
  const player = { position: new THREE.Vector3(), root: { rotation: { y: 0 } }, stealPose: null };
  const victima = { position: new THREE.Vector3(0, 0, 1) };
  const coreo = new CoreografiaDeHurto({ player });
  let contactos = 0, alContactoT = null;
  coreo.jugador('raponazo', 1, { victima, alContacto: () => { contactos++; alContactoT = player.stealPose.t; } });
  assert.equal(player.stealPose.fase, 'raponazo');
  assert.ok(player.stealPose.objetivo, 'apunta al bolso');
  for (let t = 0; t < 3; t += 1 / 60) coreo.update(1 / 60);
  assert.equal(contactos, 1);
  assert.ok(alContactoT >= CONTACTO_RAPONAZO && alContactoT < CONTACTO_RAPONAZO + .02);
  assert.equal(player.stealPose, null);
  assert.equal(victima.radius, undefined, 'el radio de la víctima vuelve a ser el de siempre');
});

test('meter la mano deja arrimarse, anda despacio y suelta al cancelar; cambiar de fase no salta', () => {
  const player = { position: new THREE.Vector3(), root: { rotation: { y: 0 } }, velocity: new THREE.Vector3(), stealPose: null, faceTowards() {} };
  const victima = { position: new THREE.Vector3(0, 0, 1.4), radius: .4 };
  const coreo = new CoreografiaDeHurto({ player, input: { axis: { x: 0, z: 0 } } });
  coreo.jugador('meter', 1, { victima });
  assert.equal(player.stealPose.velocidad, coreo.ajustes.velocidadConLaMano);
  assert.ok(victima.radius < .4, 'se deja encimar');
  coreo.update(1 / 60);
  assert.ok(player.velocity.z > .5, 'da el paso que falta');
  coreo.hondura = 1;
  for (let i = 0; i < 30; i++) coreo.update(1 / 60);
  assert.ok(player.stealPose.hondura > .9);
  coreo.jugador('sacar');
  assert.equal(player.stealPose.desde?.fase, 'meter', 'sale de donde quedó la mano');
  coreo.update(1 / 60);
  assert.equal(victima.radius, .4, 'apartados, el radio vuelve');
  for (let i = 0; i < 70; i++) coreo.update(1 / 60);
  assert.equal(player.stealPose, null);
});

test('la frase grabada cuadra con el robo; sin una que cuadre no dice ninguna', () => {
  const speaker = (voz, sexo) => ({ _voz: voz, look: { real: { sexo } }, dicho: [], say(t) { this.dicho.push(t); } });
  const senora = speaker('senora', 'mujer');
  for (let i = 0; i < 10; i++) assert.equal(hablarRobo(senora, 'pillado'), true);
  assert.ok(senora.dicho.every(t => !/mi bolso/.test(t)), senora.dicho.join(' | '));
  const estudiante = speaker('estudiante_h', 'hombre');
  assert.equal(hablarRobo(estudiante, 'pillado'), false, 'pillado con la mano adentro no dice «me robó el celular»');
  assert.equal(hablarRobo(estudiante, 'descubre'), true);
  const conductor = speaker('conductor', 'hombre');
  assert.equal(hablarRobo(conductor, 'pillado'), true);
  assert.match(conductor.dicho[0], /Quite la mano/);
  assert.equal(hablarRobo(conductor, 'descubre'), false);
  // Solo el tirón que se llevó un bolso dice «mi bolso»: ni el del bolsillo, ni el que falló, ni quien se palpa después.
  const dichoEn = tipo => {
    const s = speaker('senora', 'mujer'), azar = Math.random;
    try { for (let i = 0; i < 40; i++) { Math.random = () => (i + .5) / 40; hablarRobo(s, tipo); } } finally { Math.random = azar; }
    return s.dicho;
  };
  assert.ok(dichoEn('raponazo-sin-bolso').every(t => !/bolso/i.test(t)), 'sin bolso no lo nombra');
  assert.ok(dichoEn('descubre').every(t => !/bolso/i.test(t)), 'el cosquilleo fue al bolsillo');
  assert.ok(dichoEn('raponazo').some(t => /mi bolso/i.test(t)), 'con el bolso arrancado sí');
  assert.deepEqual([tipoDeTiron('bolso'), tipoDeTiron('bolsa'), tipoDeTiron('maletin'), tipoDeTiron(null)],
    ['raponazo', 'raponazo-sin-bolso', 'raponazo-sin-bolso', 'raponazo-sin-bolso']);
  // Al tirón que agarró puro aire nadie le dice «me robó», «suelte» ni «quite la mano».
  const fallo = /me robó|bolso|devuélvamelo|quite la mano|suelte|suélteme/i;
  for (const [voz, sexo] of [['senora', 'mujer'], ['estudiante', 'mujer'], ['conductor', 'hombre'], ['nera', 'mujer'], ['busetero', 'hombre'], ['abuelo', 'hombre'], ['nero_pelado', 'hombre']]) {
    const s = speaker(voz, sexo);
    for (let i = 0; i < 10; i++) hablarRobo(s, 'raponazo-fallido');
    assert.ok(s.dicho.every(t => !fallo.test(t)), `${voz}: ${s.dicho.join(' | ')}`);
  }
});

test('alarmar a la víctima usa la frase del robo y deja speakScenario como estaba', async () => {
  const npc = await person();
  const dicho = [];
  npc.say = (t) => dicho.push(t);
  npc._voz = 'conductor';
  npc.look = { ...npc.look, real: { ...npc.look?.real, sexo: 'hombre' } };
  alarmarVictima(npc, new THREE.Vector3(31, 0, 2), 'pillado');
  assert.ok(npc.fleeTimer > 0, 'huye como siempre');
  assert.match(dicho.at(-1), /Quite la mano/);
  assert.equal(Object.prototype.hasOwnProperty.call(npc, 'speakScenario'), false);
});

test('el contragolpe del robo es la defensa animada de Npc, con el daño del robo directo', async () => {
  const npc = await person();
  const atacante = { position: new THREE.Vector3(30.8, 0, 2), stats: { salud: 100 } };
  assert.equal(armarContragolpe(npc, atacante, 13), true);
  assert.equal(npc._counter.damage, 13);
  assert.equal(atacante.stats.salud, 100, 'todavía no pega: se anuncia');
  // Uno que ya se defendió en una pelea igual se defiende del robo.
  const otro = await person('senora', [20, 0, 2]);
  otro._defenseUsed = true;
  assert.equal(armarContragolpe(otro, atacante, 7), true);
  assert.equal(otro._counter.damage, 7);
  for (let t = 0; t < 1; t += .05) npc.update(.05, { player: atacante.position });
  assert.equal(atacante.stats.salud, 87, 'quieto al lado, el puño llega');
  assert.equal(armarContragolpe({}, atacante, 5), false, 'sin defensa (mocks) no hace nada');
});

// ——— A dónde va la mano: la cadera de verdad, la bolsa, y seguir a quien camina ———
const { manosOcupadas } = await import('../src/features/stealReactions.js');

/** Un peatón de mentira con modelo: la cadera a `cadera` m del piso y, si se pide, una bolsa en la mano izquierda. */
function conModelo({ cadera = 1, bolsa = null, at = [0, 0, 1.4] } = {}) {
  const group = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'mixamorigHips'; hips.position.y = cadera; group.add(hips);
  if (bolsa) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .1), new THREE.MeshBasicMaterial());
    mesh.name = `prop-${bolsa}`;
    mesh.position.set(.25, cadera - .3, 0); // a su izquierda (+X), a la altura de la mano
    hips.add(mesh);
  }
  const character = { group };
  const npc = { position: new THREE.Vector3(...at), radius: .4, character, fullChar: character, root: { rotation: { y: 0 } } };
  group.position.copy(npc.position);
  group.updateMatrixWorld(true);
  return npc;
}
const jugadorDe = () => ({ position: new THREE.Vector3(), root: { rotation: { y: 0 } }, velocity: new THREE.Vector3(), stealPose: null, faceTowards() {} });

test('el bolsillo de quien está sentado se mide desde su cadera, y el jugador se agacha para llegar', () => {
  const player = jugadorDe();
  const sentada = conModelo({ cadera: .6 });
  const coreo = new CoreografiaDeHurto({ player, input: { axis: { x: 0, z: 0 } } });
  coreo.jugador('meter', 1, { victima: sentada });
  assert.ok(Math.abs(player.stealPose.objetivo.y - .66) < .02, `a la cadera: ${player.stealPose.objetivo.y}`);
  for (let i = 0; i < 60; i++) coreo.update(1 / 60);
  assert.ok(player.stealPose.agachar > .7, `se agacha: ${player.stealPose.agachar}`);
  // De pie, sin agacharse.
  const otro = jugadorDe(), parada = conModelo({ cadera: 1 });
  const c2 = new CoreografiaDeHurto({ player: otro, input: { axis: { x: 0, z: 0 } } });
  c2.jugador('meter', 1, { victima: parada });
  for (let i = 0; i < 60; i++) c2.update(1 / 60);
  assert.ok(otro.stealPose.agachar < .05, `de pie no se agacha: ${otro.stealPose.agachar}`);
  // Sin modelo cargado, la estatura de siempre.
  const sinModelo = { position: new THREE.Vector3(0, 0, 1.4), radius: .4 };
  const c3 = new CoreografiaDeHurto({ player: jugadorDe(), input: { axis: { x: 0, z: 0 } } });
  assert.ok(Math.abs(c3.jugador('meter', 1, { victima: sinModelo }).objetivo.y - 1.08) < .01);
});

test('el raponazo va a la bolsa que carga, con la mano de ese lado; sin bolsa, al bolsillo y no al pecho', () => {
  const player = jugadorDe();
  const conBolsa = conModelo({ bolsa: 'bolsa' });
  const coreo = new CoreografiaDeHurto({ player, input: { axis: { x: 0, z: 0 } } });
  const pose = coreo.jugador('raponazo', 1, { victima: conBolsa, alContacto() {} });
  const bolsa = conBolsa.character.group.getObjectByName('prop-bolsa').getWorldPosition(new THREE.Vector3());
  assert.ok(pose.objetivo.distanceTo(bolsa) < .12, `a la bolsa: ${pose.objetivo.toArray()} vs ${bolsa.toArray()}`);
  // Los dos miran a +Z (la tiene de espaldas): la izquierda de ella (+X) también le queda a su izquierda.
  assert.equal(pose.lado, -1, 'con la mano del lado de la bolsa');
  const player2 = jugadorDe();
  const sinBolsa = conModelo({ cadera: 1 });
  const c2 = new CoreografiaDeHurto({ player: player2, input: { axis: { x: 0, z: 0 } } });
  const p2 = c2.jugador('raponazo', 1, { victima: sinBolsa, alContacto() {} });
  assert.ok(p2.objetivo.y < 1.1, `al bolsillo, no al pecho: ${p2.objetivo.y}`);
});

test('con la mano adentro sigue a la víctima que camina, al paso de ella', () => {
  const player = jugadorDe();
  const victima = { position: new THREE.Vector3(0, 0, .6), radius: .4 };
  const coreo = new CoreografiaDeHurto({ player, input: { axis: { x: 0, z: 0 } } });
  coreo.jugador('meter', 1, { victima });
  for (let i = 0; i < 180; i++) {
    victima.position.z += 1.3 / 60;
    coreo.update(1 / 60);
    // Player.update frena la inercia sin entrada: avanza un poco menos de lo pedido.
    player.position.addScaledVector(player.velocity, (1 / 60) * .8);
  }
  const d = player.position.distanceTo(victima.position);
  assert.ok(d < .7, `pegado a 1,3 m/s: ${d.toFixed(2)}`);
  assert.equal(coreo.seFue, false);
  assert.ok(Math.abs(player.stealPose.objetivo.z - victima.position.z) < .2, 'la mano va con ella');
  // Si el jugador manda, no lo arrastra: y si se queda, se le va.
  coreo.game.input.axis = { x: 1, z: 0 };
  player.velocity.set(0, 0, 0);
  for (let i = 0; i < 60; i++) { victima.position.z += 1.3 / 60; coreo.update(1 / 60); }
  assert.equal(player.velocity.length(), 0);
  assert.equal(coreo.seFue, true);
});

test('el paraguas, el bastón o la bolsa ocupan una mano: el susto y el palparse van con la otra', async () => {
  assert.deepEqual(manosOcupadas({ umbrella: { visible: true } }), { derecha: true, izquierda: false });
  assert.deepEqual(manosOcupadas({ look: { real: { accesorios: [{ id: 'bolsa' }] } } }), { derecha: false, izquierda: true });
  assert.deepEqual(manosOcupadas({ look: { real: { accesorios: [{ id: 'bolso' }, { id: 'morral' }] } } }), { derecha: false, izquierda: false }, 'lo del hombro no ocupa la mano');
  const npc = await person();
  // El oficinista sale con maletín a veces: aquí empieza con las manos libres.
  npc.look = { ...npc.look, real: { ...npc.look?.real, accesorios: [] } };
  const player = new THREE.Vector3(31, 0, 2);
  const coreo = new CoreografiaDeHurto({ player: { position: player } });
  npc.umbrella = { visible: true };
  coreo.reaccionar(npc, 'helado', { segundos: .5 });
  assert.deepEqual([npc.poseParams.hurto.lado, npc.poseParams.hurto.unaMano], [-1, true]);
  coreo.soltarVictima(npc);
  npc.look = { ...npc.look, real: { ...npc.look?.real, accesorios: [{ id: 'bolsa' }] } };
  coreo.reaccionar(npc, 'palparse', { segundos: .5 });
  assert.equal(npc.poseParams.hurto, null, 'con las dos manos ocupadas solo se voltea');
  coreo.soltarVictima(npc);
  npc.umbrella = { visible: false };
  coreo.reaccionar(npc, 'palparse', { segundos: .5 });
  assert.deepEqual([npc.poseParams.hurto.lado, npc.poseParams.hurto.unaMano], [1, true], 'la bolsa en la izquierda: se palpa con la derecha');
});

// ——— La frase de la víctima va por el canal único de voces, con el peso del robo (ver voces/prioridad.js) ———

let howlId = 0;
class FakeHowl {
  constructor(options) { this.options = options; this.voices = new Map(); }
  state() { return 'loaded'; }
  play() { const id = ++howlId; this.voices.set(id, { playing: true }); return id; }
  playing(id) { return id === undefined ? [...this.voices.values()].some(v => v.playing) : !!this.voices.get(id)?.playing; }
  stop(id) { for (const [key, v] of this.voices) if (id === undefined || key === id) v.playing = false; }
  pause(id) { this.stop(id); }
  volume() {} pos() {} rate() {} seek() {} once() {} unload() {}
  duration() { return 2; }
}
async function canalDeVoz() {
  const { AudioSystem } = await import('../src/systems/AudioSystem.js');
  const audio = new AudioSystem({ HowlClass: FakeHowl, howler: { volume() {} }, eventTarget: new EventTarget() });
  audio.vehicles.random = () => .5;
  audio.updateWorld(.1, new THREE.Vector3(), null, []);
  const gestos = [];
  audio.vocalizador = { decir: (_npc, gesto) => { gestos.push(gesto); return true; } };
  return { audio, gestos };
}
async function victimaConVoz(audio, voz = 'senora', sexo = 'mujer') {
  const npc = await person('senora', [1, 0, 0]);
  npc.audio = audio;
  npc._voz = voz;
  npc.look = { ...npc.look, real: { ...npc.look?.real, sexo } };
  npc.burbujas = [];
  npc.say = t => npc.burbujas.push(t);
  return npc;
}
const ladron = new THREE.Vector3(1.6, 0, 0);

test('la frase del robo pesa 90: la turba que grita detrás no se la pisa y la cabeza acompaña', async () => {
  const { PRIORIDAD_VOZ } = await import('../src/systems/voces/prioridad.js');
  const { decirFrase } = await import('../src/systems/voces/hablar.js');
  const { NPC_VOICE_BANK } = await import('../src/data/npcVoices.js');
  const { audio } = await canalDeVoz();
  const npc = await victimaConVoz(audio);
  alarmarVictima(npc, ladron, 'pillado');
  const voz = audio._npcVoice;
  assert.equal(voz?.owner, npc, 'suena la víctima');
  assert.equal(voz.priority, PRIORIDAD_VOZ.robbed);
  assert.equal(npc.burbujas.length, 1);
  assert.ok(npc._hablaHasta > npc._hablaDesde, 'el gesto de la cabeza mientras habla');
  // _triggerCrowdConsequence: el primero de la turba grita «theftChase» (85) en el mismo cuadro.
  const turba = { position: new THREE.Vector3(2, 0, 0), hp: 100, audio, say() {} };
  assert.equal(decirFrase(turba, NPC_VOICE_BANK.theftChase[0], 'theftChase'), false);
  assert.equal(audio._npcVoice, voz);
  assert.equal(voz.sound.playing(voz.id), true, 'la víctima se sigue oyendo');
  audio.dispose();
});

test('la frase del robo calla la charla de la calle; si el canal lo tiene otra igual de pesada, no deja burbuja muda', async () => {
  const { audio } = await canalDeVoz();
  const calle = new FakeHowl({ src: ['calle.mp3'] });
  const id = calle.play();
  audio.streetVoices._voice = { sound: calle, id, npc: {} };
  assert.equal(audio._voicePriority(), 30);
  const npc = await victimaConVoz(audio);
  alarmarVictima(npc, ladron, 'pillado');
  assert.equal(audio._npcVoice?.owner, npc);
  assert.equal(calle.playing(id), false, 'la charla se calla');
  assert.equal(npc.burbujas.length, 1);
  // Otra víctima gritando (90): esta no se oiría, así que ni burbuja ni una sin grabar en su lugar.
  const otra = await victimaConVoz(audio);
  alarmarVictima(otra, ladron, 'pillado');
  assert.equal(audio._npcVoice.owner, npc);
  assert.deepEqual(otra.burbujas, []);
  assert.ok(otra.fleeTimer > 0, 'huye igual');
  audio.dispose();
});

test('sin grabación que cuadre, la víctima hace su «¡ey!» y dice una sin grabar', async () => {
  const { audio, gestos } = await canalDeVoz();
  const npc = await victimaConVoz(audio, 'estudiante_h', 'hombre');
  alarmarVictima(npc, ladron, 'pillado');
  assert.deepEqual(gestos, ['ey']);
  assert.equal(npc.burbujas.length, 1);
  assert.match(npc.burbujas[0], /Quieto|La mano/);
  audio.dispose();
});

test('el grito que sale en el aviso va con el robo: el tirón y el palparse no dicen «quite la mano» ni «el bolsillo»', async () => {
  const gritos = tipo => {
    const vistos = new Set();
    for (let i = 0; i < 60; i++) {
      globalThis.window = new EventTarget();
      const textos = [];
      window.addEventListener('toast', e => textos.push(e.detail.text));
      const npc = { position: new THREE.Vector3(), alarmedByTheft: Npc.prototype.alarmedByTheft, _fleeFrom() {}, _scream: Npc.prototype._scream, speakScenario() {} };
      const azar = Math.random;
      Math.random = () => (i + .5) / 60;
      try { alarmarVictima(npc, new THREE.Vector3(), tipo); } finally { Math.random = azar; }
      for (const t of textos) if (/^¡¡/.test(t)) vistos.add(t);
    }
    return [...vistos];
  };
  const pocket = /QUITE LA MANO|BOLSILLO|ME QUIEREN ROBAR|ME ESTÁ ROBANDO/;
  const tiron = gritos('raponazo'), despues = gritos('descubre'), pillado = gritos('pillado'), aire = gritos('raponazo-fallido');
  assert.ok(tiron.length >= 3 && despues.length >= 2, JSON.stringify({ tiron, despues }));
  assert.deepEqual(tiron.filter(t => pocket.test(t)), [], 'el tirón ya se llevó lo suyo');
  assert.deepEqual(despues.filter(t => pocket.test(t)), [], 'quien se palpa después ya no tiene a nadie encima');
  assert.ok(aire.length >= 2, JSON.stringify(aire));
  // Al intento sí le cabe «me quieren robar»; no la mano, el bolsillo ni lo que no se llevó.
  assert.deepEqual(aire.filter(t => /QUITE LA MANO|BOLSILLO|ME ESTÁ ROBANDO|ROBARON|SACÓ/.test(t)), [], 'el que agarró puro aire no la tocó ni se llevó nada');
  // Con la mano adentro sí: el grito de siempre.
  assert.ok(pillado.some(t => /QUITE LA MANO|BOLSILLO/.test(t)), JSON.stringify(pillado));
});
