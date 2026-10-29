import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';

// Solo se sustituye la descarga de modelos; IA, golpes y colisiones son reales.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, setWeapon() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { AngryDriver, ROAD_RAGE } = await import('../src/entities/AngryDriver.js');
const { SquadMember, SQUAD } = await import('../src/entities/SquadMember.js');
const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');
const { RoadRageSystem } = await import('../src/systems/RoadRageSystem.js');
const { LimpiezaSocialSystem } = await import('../src/systems/LimpiezaSocialSystem.js');
const point = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const water = () => ({ surfaceY: 0, depth: 6, bottomY: -6 });

function actor(Type, options = {}, origin = point()) {
  const enemy = new Type(new THREE.Scene(), { isWalkable: () => true, groundHeight: () => origin.y, ...options });
  if (Type === SquadMember) enemy.exitCar(origin, point(1, origin.y));
  else enemy.exitCar({}, origin);
  enemy.attackTimer = 0;
  return enemy;
}
function think(enemy, player, dt = .01) {
  return enemy.think(dt, { player, door: point(), canChase: true });
}
function wall() {
  const collisions = new CollisionSystem();
  collisions.colliders.push({ box: new THREE.Box3(point(.45, 0, -2), point(.55, 4, 2)), layered: true });
  return collisions;
}

for (const Type of [AngryDriver, SquadMember]) {
  test(`${Type.name}: avisa y conecta al mismo nivel; rechaza puente, fondo y muros`, () => {
    const near = point(1);
    const enemy = actor(Type);
    assert.equal(think(enemy, near), 'swing');
    think(enemy, near, .5);
    assert.equal(think(enemy, near, .2), 'hit');
    for (const y of [7.82, -2]) assert.equal(think(actor(Type), point(1, y)), null);
    assert.equal(think(actor(Type, { collisions: wall() }), near), null);
  });

  test(`${Type.name}: revalida al impactar si aparece un muro o cambia el piso`, () => {
    for (const obstacle of ['wall', 'floor', 'water']) {
      const enemy = actor(Type);
      const target = point(1);
      assert.equal(think(enemy, target), 'swing');
      if (obstacle === 'wall') enemy.collisions = wall();
      else if (obstacle === 'floor') target.y = 7.82;
      else { enemy.getWaterInfo = water; target.y = -.4; }
      think(enemy, target, .5);
      assert.equal(think(enemy, target, .2), 'miss');
    }
  });

  test(`${Type.name}: el bus diagonal bloquea el golpe por su OBB y no por su envolvente`, () => {
    const collisions = new CollisionSystem();
    const bus = { width: 2, length: 6, position: point(), group: new THREE.Group() };
    bus.group.rotation.y = Math.PI / 4;
    collisions.setVehicles([], bus);
    // Las puntas quedan a ambos lados de la esquina real del bus.
    assert.equal(think(actor(Type, { collisions }, point(.9, 0, -1.4)), point(.9, 0, -.2)), null);
    assert.equal(think(actor(Type, { collisions }, point(2.5, 0, -2)), point(2.7, 0, -2)), 'swing');
  });

  test(`${Type.name}: no ataca sumergido ni entra al agua al perseguir`, () => {
    assert.equal(think(actor(Type, { getWaterInfo: water }, point(0, -.4)), point(1, -.4)), null);
    const getWaterInfo = (x) => x >= 1 && x <= 2 ? water() : null;
    const enemy = actor(Type, { getWaterInfo });
    enemy._moveTowards(point(5), 5, 1, 0);
    assert.ok(enemy.position.x < 1, `${enemy.position.x}`);
    const deck = actor(Type, { getWaterInfo }, point(0, 7.82));
    assert.equal(think(deck, point(.5, 7.82)), 'swing');
  });

  test(`${Type.name}: la persecución respeta colisiones, cota y tiempo de abandono`, () => {
    const enemy = actor(Type, { collisions: wall() });
    enemy._moveTowards(point(5), 5, 1, 0);
    assert.ok(enemy.position.x < .14);
    enemy.collisions = null;
    enemy.groundHeight = () => 7.82;
    const before = enemy.position.clone();
    enemy._moveTowards(point(5), 5, 1, 0);
    assert.deepEqual(enemy.position, before);
    const duration = Type === SquadMember ? SQUAD.giveUpTime : ROAD_RAGE.giveUpTime;
    enemy.timer = duration - .01;
    assert.equal(think(enemy, point(5), 0), null);
    assert.equal(enemy.timer, duration - .01, 'la pausa no consume el temporizador');
    assert.equal(think(enemy, point(5), .02), 'giveup');
    assert.equal(enemy.state, 'return');
  });
}

test('el matón distingue golpe rechazado de impacto válido sin recompensa', () => {
  const enemy = actor(SquadMember);
  const attacker = { position: point(1, 7.82) };
  assert.equal(enemy.takeHit({ attacker }), false);
  assert.equal(enemy.health, 100);
  attacker.position.y = 0;
  enemy.collisions = wall();
  assert.equal(enemy.takeHit({ attacker }), false);
  assert.equal(enemy.health, 100);
  enemy.collisions = null;
  assert.equal(enemy.takeHit({ attacker }), 0);
  assert.ok(enemy.health < 100);
  enemy.enterCar();
  assert.equal(enemy.takeHit({ attacker }), false);
});

test('los sistemas conectan cota inferior y vuelven a comprobar el golpe antes de descontar salud', () => {
  const scene = new THREE.Scene();
  const player = { position: point(1), isSwimming: false, receiveHit() {} };
  const stats = { salud: 100 };
  const district = { isWalkableAt: () => true, getGroundHeight: () => 7.82,
    getMovementGroundHeight: (x, z, y) => y > 7 ? 7.82 : 0, getWaterInfo: () => null };
  const collisions = new CollisionSystem();
  const car = { traffic: true, position: point(), driverDoor: out => out.set(0, 0, 0), setDriverInside() {} };
  const vehicle = { car, speed: 0 };
  const road = new RoadRageSystem(scene, { player, stats, random: () => 0 });
  road.setup(district, { hold: () => vehicle }, [], { collisions });
  road.trigger(car);
  road.update(.01);
  assert.equal(road.driver.position.y, 0);
  const squad = new LimpiezaSocialSystem(scene, { player, stats, random: () => 0 });
  squad.setup(district, [], [], { collisions });
  squad.suv.group.position.set(0, 0, 0);
  squad.suv.group.updateMatrixWorld();
  assert.equal(squad._doorPoint(0, point()).y, 0);
  const member = squad.thugs[0];
  member.exitCar(point(), player.position);
  for (const hit of [() => road._hitPlayer(), () => squad._hitPlayer(member)]) {
    for (const y of [7.82, -2]) { player.position.y = y; hit(); assert.equal(stats.salud, 100); }
    player.position.y = 0;
    player.isSwimming = true;
    hit(); assert.equal(stats.salud, 100);
    player.isSwimming = false;
    collisions.colliders = wall().colliders;
    hit(); assert.equal(stats.salud, 100);
    collisions.colliders = [];
    hit(); assert.ok(stats.salud < 100, 'un impacto válido conserva el daño');
    stats.salud = 100;
  }
});
