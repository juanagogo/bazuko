import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

// El contrato de combate no necesita cargar GLTF, texturas ni el catálogo remoto.
const character = () => ({ group: new THREE.Group(), update(dt, params) { this.last = params; }, dispose() {} });
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

async function fixture({ cls = Npc, look = {}, isWalkable = () => true } = {}) {
  const scene = new THREE.Scene();
  const npc = new cls(scene, new THREE.Vector3(0, 0, 1), { look, isWalkable, groundHeight: () => 0 });
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

test('KO conserva modelo, rechaza impactos y recupera salud sin renovar el botín', async () => {
  const { npc, attacker, scene } = await fixture();
  const reward = npc.takeHit({ damage: 100, attacker, attackId: 1 });
  assert.ok(reward > 0); assert.equal(npc.health, 0); assert.equal(npc.isKnockedOut, true);
  const timer = npc.koTimer;
  assert.equal(npc.takeHit({ damage: 100, attacker, attackId: 2 }), false);
  assert.equal(npc.koTimer, timer);
  tick(npc, NPC_COMBAT.fall + .1);
  assert.equal(npc._koBlend, 1);
  assert.equal(npc.character.last.ko, 1);
  assert.ok(scene.children.includes(npc.root));
  const alternate = character(); npc._show(alternate);
  npc.update(.016);
  assert.equal(npc.character.last.ko, 1, 'el KO sigue al cambio de detalle');
  tick(npc, NPC_COMBAT.downMin + NPC_COMBAT.downExtra + NPC_COMBAT.rise + .5);
  assert.equal(npc.isKnockedOut, false); assert.equal(npc.health, npc.maxHealth);
  assert.equal(npc.looted, true); assert.ok(npc.fleeTimer > 0);
  assert.equal(npc.character.last.ko, 0);
  assert.equal(npc.takeHit({ damage: 1, attacker, attackId: 3 }), 0);
  assert.equal(npc.takeHit({ damage: 1, attacker, attackId: 1 }), false, 'recuperarse no repite IDs aceptados');
  npc.dispose();
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
