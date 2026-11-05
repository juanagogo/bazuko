import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

// Aquí se prueba lo que Npc y Player le piden al cuerpo; el cuerpo tiene sus propias pruebas.
const character = () => ({ group: new THREE.Group(), update(dt, params) { this.last = params; }, snapPose() { this.snapped = (this.snapped ?? 0) + 1; }, dispose() {} });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => character(), loadCatalog: async () => ({}),
  normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1
} });
const { Npc, NPC_COMBAT } = await import('../src/entities/Npc.js');
const { Player, pickGesture, PLAYER_GAIT } = await import('../src/entities/Player.js');
const { GAIT_FAMILIES } = await import('../src/character/gaitFamilies.js');
const { STANCE_NAMES } = await import('../src/character/stances.js');

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
});

async function npcFixture(options = {}) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(0, 0, 1), { look: {}, isWalkable: () => true, groundHeight: () => 0, ...options });
  await npc.ready;
  npc.fullChar = npc.lodChar;
  return npc;
}

const lastParams = npc => (npc.character ?? npc.lodChar).last;

test('un peatón pide su postura y su estilo a su modelo, y puede cambiarlos en marcha', async () => {
  const style = { stoop: .4, swing: .6 };
  const npc = await npcFixture({ stance: 'bolsillos', style, andar: 'cansado' });
  assert.equal(npc.andar, 'cansado');
  npc.update(.05, {});
  assert.equal(lastParams(npc).stance, 'bolsillos');
  assert.equal(lastParams(npc).style, style);
  npc.stance = 'celular';
  npc.update(.05, {});
  assert.equal(lastParams(npc).stance, 'celular');
  npc.stance = null;
  npc.style = null;
  npc.update(.05, {});
  assert.equal(lastParams(npc).stance, null);
  assert.equal(lastParams(npc).style, null);
  npc.dispose();
});

test('`poseParams` manda sobre la postura fija del peatón', async () => {
  const npc = await npcFixture({ stance: 'bolsillos' });
  npc.poseParams = { stance: 'hablar', style: { headDown: .5 } };
  npc.update(.05, {});
  assert.equal(lastParams(npc).stance, 'hablar');
  assert.deepEqual(lastParams(npc).style, { headDown: .5 });
  npc.dispose();
});

test('huir pone el cuerpo asustado solo mientras corre, y después vuelve su postura', async () => {
  const npc = await npcFixture({ stance: 'bolsillos' });
  npc.fleeTimer = 5;
  npc.moving = true;
  npc._walk = () => {};
  npc.update(.05, {});
  assert.equal(lastParams(npc).stance, 'huir');
  assert.equal(lastParams(npc).running, true);
  npc.moving = false;
  npc.update(.05, {});
  assert.equal(lastParams(npc).stance, 'bolsillos', 'quieto, aunque asustado, no corre en el sitio');
  npc.fleeTimer = 0;
  npc.update(.05, {});
  assert.equal(lastParams(npc).stance, 'bolsillos');
  npc.dispose();
});

test('el KO pasa su avance al cuerpo: sube al caer, llega a 1 tendido y baja al levantarse', async () => {
  const npc = await npcFixture();
  npc.health = 8;
  const seen = [];
  const attacker = { position: new THREE.Vector3(0, 0, 0), root: new THREE.Group() };
  npc.takeHit({ damage: 500, attacker, attackId: 1 });
  assert.equal(npc.koState, 'down');
  for (let elapsed = 0; elapsed < NPC_COMBAT.fall + .1; elapsed += .02) {
    npc.update(.02, {});
    seen.push(lastParams(npc).ko);
  }
  const body = npc.character ?? npc.lodChar;
  body.last = null;
  npc.update(.02, {});
  assert.equal(body.last, null, 'ya tendido no se anima más');
  assert.ok(seen[0] < .1, `empieza de pie: ${seen[0]}`);
  assert.ok(seen.some(ko => ko > .3 && ko < .7), 'pasa por en medio: el cuerpo tiene con qué doblarse');
  assert.equal(seen.at(-1), 1);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1]);
  npc.dispose();
});

test('al entrar en pantalla o cambiar de modelo, la postura aparece puesta y el tendido se vuelve a posar', async () => {
  const npc = await npcFixture({ stance: 'sentado' });
  npc._koBlend = 1; npc.koState = 'down'; npc.koTimer = 99;
  npc.update(.05, {});
  const first = lastParams(npc);
  assert.equal(first.ko, 1);
  const body = npc.character ?? npc.lodChar;
  body.last = null;
  npc.update(.05, {});
  assert.equal(body.last, null, 'tendido y sin novedades, no anima');
  npc._poseStale = true;
  npc.update(.05, {});
  assert.ok(body.last, 'con la pose vencida vuelve a pedirla una vez');
  assert.equal(npc._poseStale, false);
  body.last = null;
  npc.update(.05, {});
  assert.equal(body.last, null);
  npc.dispose();
});

function playerFixture({ energia = 100, hambre = 100, isFreezing = false, raining = false } = {}) {
  const input = { axis: { x: 0, z: 0 }, isRunning: false, consumePress: () => false, isDown: () => false };
  const stats = { energia, hambre, higiene: 100, salud: 100, isFreezing, update() {} };
  const player = new Player(new THREE.Scene(), input, stats, null);
  player.character = Object.assign(character(), { root: new THREE.Group() });
  player.character.group = player.character.group ?? new THREE.Group();
  player.game = { weather: { isRaining: raining } };
  const tick = (seconds, dt = .1) => { for (let t = 0; t < seconds - 1e-9; t += dt) player.update(dt, null, null); };
  return { player, input, tick, last: () => player.character.last };
}

test('el jugador usa un andar de la lista y sus gestos existen como posturas', () => {
  assert.ok(Object.hasOwn(GAIT_FAMILIES, PLAYER_GAIT));
  const states = [{}, { cold: true }, { hungry: true }, { tired: true }, { raining: true }, { cold: true, hungry: true, tired: true, raining: true }];
  for (const state of states) {
    for (let roll = 0; roll < 1; roll += .02) assert.ok(STANCE_NAMES.includes(pickGesture(state, () => roll)), `${JSON.stringify(state)} ${roll}`);
  }
});

test('el frío y el hambre pesan en el gesto', () => {
  const count = (state, name) => {
    let hits = 0;
    for (let roll = 0; roll < 1; roll += .01) if (pickGesture(state, () => roll) === name) hits++;
    return hits;
  };
  assert.equal(count({}, 'frotarse'), 0);
  assert.equal(count({}, 'barriga'), 0);
  assert.ok(count({ cold: true }, 'frotarse') > 30);
  assert.ok(count({ hungry: true }, 'barriga') > 30);
});

test('quieto un rato hace un gesto; al moverse se corta en el mismo cuadro', t => {
  // Con este azar el gesto dura 4 s y el siguiente tarda otros 6.
  t.mock.method(Math, 'random', () => .5);
  const { player, input, tick, last } = playerFixture({ hambre: 20 });
  tick(5.9);
  assert.equal(player.gesture, null, 'antes de 6 s quieto no hace nada');
  assert.equal(last().stance, null);
  tick(.2);
  assert.ok(player.gesture, 'a los 6 s le toca su gesto');
  assert.equal(last().stance, player.gesture);
  const gesture = player.gesture;
  tick(3.7);
  assert.equal(last().stance, gesture, 'lo sostiene mientras dura');
  tick(.4);
  assert.equal(player.gesture, null, 'se acaba solo');
  assert.equal(last().stance, null);
  tick(5.7);
  assert.equal(last().stance, null, 'descansa antes del siguiente');
  tick(.4);
  assert.ok(player.gesture, 'y vuelve a empezar');
  assert.equal(last().stance, player.gesture);
  input.axis.x = 1;
  player.update(.016, null, null);
  assert.equal(player.gesture, null, 'moverse lo corta en el mismo cuadro');
  assert.notEqual(last().stance, 'barriga');
  assert.equal(last().stance, null);
  assert.ok(player.speed > 0, 'el control no esperó a nada');
});

test('la energía y el clima se notan en el cuerpo, y el cuerpo no cambia ninguna regla', () => {
  const rested = playerFixture({ energia: 100 });
  const worn = playerFixture({ energia: 10 });
  rested.tick(.2); worn.tick(.2);
  assert.equal(rested.last().style.stoop, 0);
  assert.equal(rested.last().style.swing, 1);
  assert.ok(worn.last().style.stoop > .4);
  assert.ok(worn.last().style.headDown > .2);
  assert.ok(worn.last().style.swing < 1);
  const wet = playerFixture({ raining: true });
  wet.tick(.2);
  assert.ok(wet.last().style.stoop > 0);
  assert.equal(wet.last().stance, 'encogido', 'bajo la lluvia, quieto, se encoge');
  wet.player.action = 'buscar';
  wet.tick(.1);
  assert.notEqual(wet.last().stance, 'encogido', 'buscar basura manda sobre encogerse');
  wet.player.action = null;
  // A la misma energía, la velocidad es la que diga el juego, no el cuerpo.
  rested.input.axis.x = 1; worn.input.axis.x = 1;
  rested.tick(1); worn.tick(1);
  assert.ok(rested.player.speed > 0 && worn.player.speed > 0);
});
