import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { ITEMS } from '../src/data/items.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { PoopSystem } from '../src/systems/PoopSystem.js';
import { StatsSystem } from '../src/systems/StatsSystem.js';

// El contrato de combate no necesita cargar GLTF, texturas ni el catálogo remoto.
const character = () => ({ group: new THREE.Group(), update(dt, params) { this.last = params; },
  setWeapon(id) { this.weapon = id; }, dispose() {} });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => character(), loadCatalog: async () => ({}),
  normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1
} });
const { Npc, NPC_COMBAT, NPC_HIT_REACTION_DURATION } = await import('../src/entities/Npc.js');

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
});

async function fixture({ cls = Npc, look = {}, isWalkable = () => true, ...opts } = {}) {
  const scene = new THREE.Scene();
  const npc = new cls(scene, new THREE.Vector3(0, 0, 1), { look, isWalkable, groundHeight: () => 0,
    defenseResolve: 1, ...opts });
  await npc.ready;
  npc.fullChar = npc.lodChar;
  const attacker = { position: new THREE.Vector3(), root: new THREE.Group() };
  return { npc, scene, attacker };
}

const tick = (npc, time, ctx = {}) => {
  for (let elapsed = 0; elapsed < time - 1e-8; elapsed += .01) npc.update(Math.min(.01, time - elapsed), ctx);
};

test('cada ID de combo se acepta una vez por atacante sin inmunidad temporal global', async () => {
  const { npc, attacker } = await fixture();
  assert.ok(npc.takeHit({ damage: 10, attacker, attackId: 1 }) >= 200);
  const other = { position: attacker.position.clone() };
  assert.equal(npc.takeHit({ damage: 10, attacker, attackId: 1 }), false);
  assert.equal(npc.health, 90);
  assert.equal(npc.takeHit({ damage: 10, attacker, attackId: 2 }), 0);
  assert.equal(npc.takeHit({ damage: 10, attacker: other, attackId: 1 }), 0);
  assert.equal(npc.health, 70, 'dos IDs distintos y otro atacante son contactos legítimos');
  assert.equal(npc.takeHit({ damage: 10, attacker: other, id: 1 }), false);
  assert.equal(npc.takeHit({ damage: 10, id: 'ambiente' }), 0);
  assert.equal(npc.takeHit({ damage: 10, id: 'ambiente' }), false);
  npc.dispose();
});

test('takePunch conserva el contrato legacy y cada llamada representa un contacto independiente', async () => {
  const { npc, attacker } = await fixture();
  assert.equal(npc.takePunch(null), false);
  assert.ok(npc.takePunch(attacker) > 0);
  const health = npc.health;
  assert.equal(npc.takePunch(attacker), 0);
  assert.ok(npc.health < health);
  npc.dispose();
  assert.equal(npc.takePunch(attacker), false);
});

test('la muerte cancela actividades, queda tendida y cruza a cero exactamente una vez', async () => {
  const { npc, attacker, scene } = await fixture();
  const deaths = [], at = npc.position.clone();
  window.addEventListener('npc-death', ({ detail }) => {
    deaths.push(detail);
    assert.equal(npc.takeHit({ damage: 500, attacker, attackId: 3 }), false);
  });
  let leftTalk = 0;
  npc.talk = { leave() { npc.talk = null; leftTalk++; } };
  npc._witness = { mode: 'llamar', time: 1 };
  npc.walkVisit = { spot: npc.position.clone() };
  const reward = npc.takeHit({ damage: 100, attacker, attackId: 1 });
  assert.ok(reward > 0); assert.equal(npc.health, 0); assert.equal(npc.isKnockedOut, true);
  assert.equal(npc.state, 'dead');
  assert.equal(npc.witnessing, null);
  assert.equal(npc.walkVisit, null);
  assert.equal(leftTalk, 1);
  assert.equal(npc.witness('llamar', 1), false);
  npc.alarmedByTheft(attacker.position); npc.say('hola');
  assert.equal(npc._bubbleEl, null);
  assert.equal(npc.takeHit({ damage: 100, attacker, attackId: 2 }), false);
  assert.equal(deaths.length, 1);
  assert.equal(deaths[0].victim, npc);
  assert.equal(deaths[0].attacker, attacker);
  assert.equal(deaths[0].attackId, 1);
  assert.equal(deaths[0].previousHealth, 100);
  assert.equal(deaths[0].health, 0);
  assert.deepEqual(deaths[0].position.toArray(), at.toArray());
  assert.notEqual(deaths[0].position, npc.position);
  tick(npc, NPC_COMBAT.fall + .1);
  assert.equal(npc._koBlend, 1);
  assert.equal(npc.character.last.ko, 1);
  assert.ok(scene.children.includes(npc.root));
  const alternate = character(); npc._show(alternate);
  npc.update(.016);
  assert.equal(npc.character.last.ko, 1, 'el KO sigue al cambio de detalle');
  tick(npc, 15, { player: attacker.position, hygiene: 0, isRaining: true });
  assert.ok(npc.isDead && npc.deathSettled);
  assert.equal(npc.looted, true); assert.equal(npc.fleeTimer, 0);
  assert.equal(npc.character.last.ko, 1);
  assert.equal(npc.takeHit({ damage: 1, attacker, attackId: 4 }), false);
  assert.equal(deaths.length, 1);
  npc.dispose();
});

test('carga una muerte antes de que lleguen las mallas, preserva rumbo y pose y no repite el incidente', async () => {
  const scene = new THREE.Scene(), npc = new Npc(scene, new THREE.Vector3(2, 0, 3), { look: {} });
  const signals = [];
  for (const type of ['npc-death', 'npc-dropped-loot', 'toast']) window.addEventListener(type, () => signals.push(type));
  npc.restoreDeath({ facing: .8, plan: 'muro', from: null });
  await npc.preload();
  npc.update(1 / 60, { player: npc.position });
  assert.equal(npc._koPlan, 'muro');
  assert.equal(npc.root.rotation.y, .8);
  assert.equal(npc.character.last.ko, 1);
  assert.equal(npc.looted, true);
  assert.equal(npc.takeHit({ damage: 20 }), false);
  assert.deepEqual(signals, []);
  npc.dispose();
});

test('el proyectil que pasa sobre un caído sigue hasta el suelo o el próximo peatón de pie', async t => {
  const { npc, scene, attacker: player } = await fixture();
  npc.position.set(0, 0, 4);
  npc.takeHit({ damage: npc.maxHealth });
  tick(npc, NPC_COMBAT.fall + .1);
  assert.equal(npc._koBlend, 1);
  const stats = new StatsSystem(), inventory = new InventorySystem();
  const voz = t.mock.fn(() => true);
  const audio = { voces: { decirPopo: voz } };
  const world = { active: { npcs: [npc], getGroundHeight: () => 0 } };
  const sistema = new PoopSystem(scene, audio, inventory, stats, world);
  t.after(() => { sistema.dispose(); npc.dispose(); });
  window.__game = { audio };
  let monedas = 0;
  window.addEventListener('npc-dropped-loot', e => { monedas += e.detail.amount; });
  t.mock.method(Math, 'random', () => .1);
  function lanzar() {
    inventory.add(ITEMS.popo, 1);
    assert.ok(sistema.throwPoop(player));
    for (let frame = 0; frame < 120 && sistema.activeProjectiles.length; frame++) sistema.update(1 / 60);
    assert.equal(sistema.activeProjectiles.length, 0);
  }
  lanzar();
  assert.equal(sistema.groundPoops.length, 1);
  assert.equal(npc.isSplatted, false);
  assert.equal(voz.mock.callCount(), 0);
  assert.equal(monedas, 0);
  assert.equal(stats.xp, 0);

  const dePie = new Npc(scene, new THREE.Vector3(0, 0, 7), { look: {} });
  await dePie.ready;
  t.after(() => dePie.dispose());
  world.active.npcs.push(dePie);
  lanzar();
  assert.ok(dePie.isSplatted && dePie.fleeTimer > 0);
  assert.equal(voz.mock.calls[0].arguments[0], dePie);
  assert.equal(monedas, 500);
  assert.equal(stats.xp, 5);
});

test('reacción usa ActionPose una vez: inmóvil, progreso y huida, sin inclinar también el grupo', async () => {
  const { npc, attacker } = await fixture();
  const initial = npc.position.clone();
  npc.takeHit({ damage: 1, knockback: 0, attacker, attackId: 1 });
  npc.update(.12);
  assert.equal(npc.action, 'recibirGolpe'); assert.equal(npc.state, 'recibirGolpe');
  assert.equal(npc.character.last.action, 'recibirGolpe');
  assert.ok(npc.character.last.actionProgress > 0 && npc.character.last.actionProgress < 1);
  assert.ok(npc.position.equals(initial));
  assert.equal(npc.character.group.rotation.x, 0);
  assert.equal(npc.root.rotation.x, 0); assert.equal(npc.root.rotation.z, 0);
  tick(npc, .5);
  assert.equal(npc.action, null); assert.equal(npc.state, 'flee');
  assert.ok(npc.position.distanceTo(initial) > 0);
  npc.dispose();
});

test('el empuje es estable por tiempo y no atraviesa un obstáculo ni un desnivel alto', async () => {
  const a = await fixture(), b = await fixture();
  for (const { npc } of [a, b]) npc.takeHit({ damage: 1, dir: { x: 1, z: 0 }, knockback: 1 });
  a.npc._updateReaction(NPC_COMBAT.stagger);
  for (let i = 0; i < 14; i++) b.npc._updateReaction(.02);
  assert.ok(Math.abs(a.npc.position.x - b.npc.position.x) < 1e-8);
  assert.ok(Math.abs(a.npc.position.x - 1) < 1e-8);
  const wall = await fixture({ isWalkable: x => x < .35 || x > .65 });
  wall.npc.takeHit({ damage: 1, dir: { x: 1, z: 0 }, knockback: 1 });
  wall.npc._updateReaction(.28);
  assert.ok(wall.npc.position.x < .35);
  const ledge = await fixture(); ledge.npc.groundHeight = x => x > .3 ? 8 : 0;
  ledge.npc.takeHit({ damage: 1, dir: { x: 1, z: 0 }, knockback: 1 });
  ledge.npc._updateReaction(.28);
  assert.equal(ledge.npc.position.y, 0);
  for (const f of [a, b, wall, ledge]) f.npc.dispose();
});

test('la defensa anuncia el golpe antes del daño y no se repite tras otro contacto', async () => {
  const { npc, attacker } = await fixture({ look: { real: { edad: 'adulto' } } });
  attacker.stats = { salud: 100 };
  npc.takeHit({ damage: 1, attacker, attackId: 1 });
  assert.equal(attacker.stats.salud, 100);
  npc.update(NPC_HIT_REACTION_DURATION);
  assert.equal(attacker.stats.salud, 100);
  assert.equal(npc.character.last.combatGuard, true);
  tick(npc, NPC_COMBAT.counterWarning);
  assert.equal(npc.action, 'golpear'); assert.equal(npc.character.last.attack.phase, 'windup');
  tick(npc, NPC_COMBAT.counterWindup - .02);
  assert.equal(attacker.stats.salud, 100);
  tick(npc, .03);
  assert.ok(attacker.stats.salud >= 84 && attacker.stats.salud <= 90);
  const health = attacker.stats.salud;
  npc.takeHit({ damage: 1, attacker, attackId: 2 });
  tick(npc, 2);
  assert.equal(attacker.stats.salud, health, 'interrumpir recuperación no duplica el contacto defensivo');
  npc.dispose();
});

test('si la defensa del peatón me mata, queda anotado que fue a golpes', async () => {
  const { npc, attacker } = await fixture({ look: { real: { edad: 'adulto' } } });
  attacker.stats = { salud: 5, danoPor: 'sed' };
  npc.takeHit({ damage: 1, attacker, attackId: 1 });
  npc.update(NPC_HIT_REACTION_DURATION);
  tick(npc, NPC_COMBAT.counterWarning + NPC_COMBAT.counterWindup + .01);
  assert.equal(attacker.stats.salud, 0);
  assert.equal(attacker.stats.danoPor, 'pelea');
  npc.dispose();
});

test('un peatón ya saqueado puede defenderse en otro encuentro sin volver a soltar plata', async () => {
  const { npc, attacker } = await fixture({ carriesKnife: false });
  npc.health = 85;
  npc.looted = true;
  attacker.stats = { salud: 100 };
  try {
    for (const attackId of [1, 2]) {
      const before = attacker.stats.salud;
      attacker.position.copy(npc.position);
      attacker.position.z += 1;
      assert.equal(npc.takeHit({ damage: 2, attacker, attackId }), 0);
      assert.equal(attacker.stats.salud, before);
      tick(npc, 2);
      assert.ok(attacker.stats.salud < before);
      tick(npc, NPC_COMBAT.flee + 1);
    }
  } finally {
    npc.dispose();
  }
});

test('el cuchillo del rival se ve antes del contacto, también al cambiar de LOD; la salud baja solo una vez', async () => {
  for (const frames of [[1/30], [1/60], [1/144], [.21, .016, .09, .023]]) {
    const { npc, attacker } = await fixture({ carriesKnife: true });
    attacker.stats = { salud: 100 };
    const hits = [], contact = event => hits.push(event.detail);
    window.addEventListener('npc-player-hit', contact);
    npc.takeHit({ damage: 1, attacker });
    npc.update(NPC_HIT_REACTION_DURATION + .9);
    assert.equal(npc.character.weapon, 'cuchillo');
    assert.equal(npc.character.last.combatGuard, true);
    assert.equal(attacker.stats.salud, 100, 'el cuadro del aviso nunca daña');
    const other = character();
    npc.fullChar = other;
    npc.update(0);
    assert.equal(other.weapon, 'cuchillo');
    let clock = 0;
    for (let frame = 0; clock < 2; frame++) {
      const dt = frames[frame % frames.length];
      clock += dt;
      npc.update(dt);
      if (clock < NPC_COMBAT.knifeWarning + NPC_COMBAT.counterWindup - 1e-8) assert.equal(attacker.stats.salud, 100);
    }
    assert.equal(hits.length, 1);
    assert.equal(attacker.stats.salud, 72);
    assert.equal(hits[0].health, 72);
    assert.equal(hits[0].previousHealth, 100);
    assert.equal(hits[0].damage, 28);
    assert.equal(hits[0].weapon, 'cuchillo');
    assert.equal(hits[0].attacker, npc); assert.equal(hits[0].victim, attacker);
    assert.equal(npc.character.weapon, null);
    window.removeEventListener('npc-player-hit', contact);
    npc.dispose();
  }
});

test('un golpe durante el aviso interrumpe el cuchillo, y llevarlo no obliga a mostrarlo', async () => {
  for (const [resolve, damage] of [[1, 1], [0, 1], [1, 75]]) {
    const { npc, attacker } = await fixture({ carriesKnife: true, defenseResolve: resolve });
    attacker.stats = { salud: 100 };
    npc.takeHit({ damage, attacker, attackId: 1 });
    npc.update(NPC_HIT_REACTION_DURATION);
    if (resolve && damage === 1) {
      assert.equal(npc.character.weapon, 'cuchillo');
      npc.takeHit({ damage: 1, attacker, attackId: 2 });
      assert.equal(npc.character.weapon, null);
    } else assert.equal(npc._counter, null);
    tick(npc, 1.5);
    assert.equal(attacker.stats.salud, 100);
    npc.dispose();
  }
});

test('el empuje conserva la capa elevada y no lleva al peatón desde la orilla al agua', async () => {
  const bridge = await fixture();
  bridge.npc.position.y = 7.82;
  bridge.npc.groundHeight = (_x, _z, currentY) => currentY > 2 ? 7.82 : 0;
  bridge.npc.getWaterInfo = () => ({ surfaceY: -.18 });
  bridge.npc.takeHit({ damage: 1, dir: { x: 1, z: 0 }, knockback: 1 });
  bridge.npc._updateReaction(.28);
  assert.equal(bridge.npc.position.y, 7.82);
  assert.ok(bridge.npc.position.x > .9, 'el agua inferior no bloquea el tablero');
  const shore = await fixture();
  shore.npc.groundHeight = x => x > .3 ? -.2 : 0;
  shore.npc.getWaterInfo = x => x > .3 ? { surfaceY: -.18 } : null;
  shore.npc.takeHit({ damage: 1, dir: { x: 1, z: 0 }, knockback: 1 });
  shore.npc._updateReaction(.28);
  assert.ok(shore.npc.position.x <= .3);
  assert.equal(shore.npc.position.y, 0);
  bridge.npc.dispose(); shore.npc.dispose();
});

test('la defensa falla si el atacante se aleja, salta, entra en agua o se oculta tras una pared', async () => {
  for (const escape of [
    attacker => attacker.position.set(0, 0, -4),
    attacker => { attacker.position.y = 2; },
    attacker => { attacker.inWater = true; },
    attacker => { attacker._lastCollisions = { colliders: [{ box: new THREE.Box3(new THREE.Vector3(-1, 0, .3), new THREE.Vector3(1, 3, .6)) }] }; }
  ]) {
    const { npc, attacker } = await fixture({ look: { real: { edad: 'adulto' } } });
    attacker.stats = { salud: 100 };
    npc.takeHit({ damage: 1, attacker, attackId: 1 });
    npc.update(NPC_HIT_REACTION_DURATION); escape(attacker);
    tick(npc, 1);
    assert.equal(attacker.stats.salud, 100);
    npc.dispose();
  }
});

test('un KO antes del contraataque lo cancela y no golpea durante la recuperación', async () => {
  const { npc, attacker } = await fixture({ look: { real: { edad: 'adulto' } } });
  attacker.stats = { salud: 100 };
  npc.takeHit({ damage: 1, attacker, attackId: 1 });
  npc.update(NPC_HIT_REACTION_DURATION);
  npc.takeHit({ damage: 200, attacker, attackId: 2 });
  tick(npc, 10);
  assert.equal(attacker.stats.salud, 100); assert.equal(npc._counter, null);
  npc.dispose();
});

test('la base conserva state, action y poseParams de las IA derivadas sin combate propio', async () => {
  class Actor extends Npc { _walk() { this.moving = true; } }
  const { npc } = await fixture({ cls: Actor });
  npc.state = 'chase'; npc.action = 'apuntar';
  const attack = { weapon: 'botella_picada', phase: 'windup', progress: .4 };
  npc.poseParams = { attack, gazeTarget: new THREE.Vector3(1, 2, 3), pointing: true };
  npc.update(.05);
  assert.equal(npc.state, 'chase'); assert.equal(npc.action, 'apuntar');
  assert.equal(npc.character.last.attack, attack);
  assert.equal(npc.character.last.gazeTarget, npc.poseParams.gazeTarget);
  assert.equal(npc.character.last.pointing, true);
  npc.dispose();
});

test('al pillarlo robando huye y grita por el robo, sin mancha ni quejas de popó', async () => {
  const { npc } = await fixture();
  const toasts = [];
  window.addEventListener('toast', event => toasts.push(event.detail.text));
  npc.alarmedByTheft(new THREE.Vector3(-2, 0, 1));
  assert.equal(npc.fleeTimer, 8);
  assert.ok(npc.fleeDir.x > .9, 'Se aleja de quien le mete la mano');
  assert.ok(!npc.isSplatted && !npc.splatMesh, 'Sin mancha');
  assert.equal(toasts.length, 1);
  assert.doesNotMatch(toasts[0], /MOJÓN|POPÓ|MIERDA|COCHINADA|PESTILENCIA|EMBARRARON/);
  toasts.length = 0;
  npc.hitByPoop(new THREE.Vector3());
  assert.ok(npc.isSplatted && npc.splatMesh, 'El popó sigue dejando su mancha');
  assert.equal(toasts.length, 1);
});
