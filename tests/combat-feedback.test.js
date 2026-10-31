import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3, Box3 } from 'three';
import { Player } from '../src/entities/Player.js';
import { Npc } from '../src/entities/Npc.js';
import { NpcCombat } from '../src/systems/NpcCombat.js';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';
import { StealSystem } from '../src/features/steal.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

test('un muro entre los personajes impide el daño; un suelo debajo no lo impide', () => {
  const collisions = new CollisionSystem();
  const p = new Player(new Scene(), { axis: {} }, { salud: 100 });
  p.position.set(0, 0, 0); p._lastCollisions = collisions;
  const n = { position: new Vector3(0, 0, 1.4), hp: 100, takePunch() { this.hp -= 4; } };
  const wall = { box: new Box3(new Vector3(-1, 0, .6), new Vector3(1, 3, .8)) };
  collisions.colliders.push(wall);
  assert.equal(collisions.hasClearStrike(p.position, n.position), false);
  p.combat.begin(p, [n]); p.combat.update(.2);
  assert.equal(n.hp, 100);
  p.combat.dispose();
  collisions.clear();
  collisions.colliders.push({ box: new Box3(new Vector3(-2, -1, -2), new Vector3(2, 0, 2)) });
  assert.equal(collisions.hasClearStrike(p.position, n.position), true);
  p.combat.begin(p, [n], 'jab'); p.combat.update(.2);
  assert.equal(n.hp, 96);
});

test('mantener O conserva la guardia, reduce daño una sola vez y soltar permite reaccionar', () => {
  let held = true;
  const input = { axis: {}, isDown: key => held && key === 'KeyO', consumePress: () => false };
  const p = new Player(new Scene(), input, { salud: 100 });
  p.update(.016, null, null);
  const sequence = p.actionSequence;
  for (let i = 0; i < 120; i++) p.update(1 / 60, null, null);
  assert.equal(p.action, 'bloquear');
  assert.equal(p.actionSequence, sequence, 'La guardia no reinicia su clip en bucle');
  assert.equal(p.receiveAssaultHit(new Vector3(0, 0, 1), 5), 2);
  assert.equal(p.stats.salud, 98);
  assert.equal(p.actionSequence, sequence, 'Un impacto bloqueado no baja los brazos');
  held = false;
  p.update(.016, null, null);
  assert.equal(p.isBlocking, false);
  p.receiveAssaultHit(new Vector3(1, 0, 0), 5);
  assert.equal(p.stats.salud, 93);
  assert.equal(p.action, 'reaccion_pecho');
  const reaction = p.actionSequence;
  p.receiveAssaultHit(new Vector3(1, 0, 0), 5);
  assert.equal(p.actionSequence, reaction + 1, 'Golpes consecutivos vuelven a animar la reacción');
  assert.equal(p.ragdoll.active, false);
});

test('recibir daño interrumpe el jab del NPC y mantiene visible su reacción', () => {
  const npc = Object.assign(Object.create(Npc.prototype), {
    hp: 100, maxHp: 100, valentia: 1, velocity: new Vector3(),
    applyDamage(damage) { this.hp -= damage; }, speakScenario() {}
  });
  npc.combatAI = new NpcCombat(npc);
  const player = { position: new Vector3(), stats: { salud: 100 } };
  npc.combatAI.entrarEnCombate(player, true);
  npc.combatAI.state = 'golpear'; npc.combatAI.timer = .01;
  npc.takePunch(player, { dmg: 4, tipo: 'jab' });
  assert.equal(npc.hp, 96);
  assert.equal(npc.assaultAction, 'reaccion_pecho');
  assert.equal(npc.combatAI.state, 'acercarse');
  assert.ok(npc.reactionTimer > 0);
  assert.equal(player.stats.salud, 100);
});

test('la persecución rodea una pared y abandona el objetivo después del límite', () => {
  const map = Array.from({ length: 7 }, () => Array(7).fill('sidewalk'));
  for (let z = 0; z < 4; z++) map[z][3] = 'building';
  const nav = new PedestrianNavigation(map, 1);
  const npc = {
    hp: 100, position: new Vector3(2, 0, 1), root: { rotation: { y: 0 } },
    _direction: new Vector3(), _nextPosition: new Vector3(), navigation: nav,
    isWalkable: (x, z) => nav.isWalkableAt(x, z), groundHeight: () => 0
  };
  const p = { position: new Vector3(5, 0, 1), stats: { salud: 100 } };
  const ai = new NpcCombat(npc);
  ai.entrarEnCombate(p); ai.state = 'acercarse';
  for (let i = 0; i < 600 && ai.state === 'acercarse'; i++) {
    ai.update(1 / 60);
    assert.ok(nav.isWalkableAt(npc.position.x, npc.position.z));
  }
  assert.ok(npc.position.distanceTo(p.position) <= 1.55, 'Llega al otro lado del obstáculo');
  ai.update(26);
  assert.equal(ai.state, 'libre');
  assert.equal(ai.objetivo, null);
});

test('el robo convoca a los vivos más cercanos sin atraer otro piso ni causar daño remoto', () => {
  const calls = [];
  const makeNpc = (x, y = 0, hp = 100) => ({ position: new Vector3(x, y, 0), hp,
    beginAssault(p) { calls.push(this); this.combatAI = { objetivo: p, state: 'acercarse' }; } });
  const victim = makeNpc(1);
  const npcs = [victim, makeNpc(2, 0, 0), makeNpc(2, 5), ...[10, 9, 8, 7, 6, 5, 4].map(x => makeNpc(x))];
  const game = { player: { position: new Vector3() }, stats: { salud: 100 }, world: { active: { npcs } } };
  const steal = new StealSystem(game);
  steal._triggerCrowdConsequence(victim, 'robo directo');
  assert.deepEqual(calls.map(n => n.position.x), [1, 4, 5, 6, 7, 8]);
  steal._updateAssaultScene(1);
  assert.equal(game.stats.salud, 100);
});
