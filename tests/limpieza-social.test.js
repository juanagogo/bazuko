import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';

// La IA y la camioneta son reales; solo se sustituye la carga de modelos GLB.
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, setWeapon() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [{ id: 'test' }]
} });
const { LimpiezaSocialSystem, LIMPIEZA, straightRoute } = await import('../src/systems/LimpiezaSocialSystem.js');
const { SQUAD, squadLook, THUG_INSULTS } = await import('../src/entities/SquadMember.js');
const { TrafficRoute } = await import('../src/world/bogota/TrafficRoute.js');
const { MASK_FIT } = await import('../src/character/props.js');
const { Player } = await import('../src/entities/Player.js');
const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');

let toasts;
beforeEach(() => {
  globalThis.window = new EventTarget();
  toasts = [];
  window.addEventListener('toast', e => toasts.push(e.detail.text));
});

function setup({ routes = [straightRoute(new THREE.Vector3(7, 0, -40), new THREE.Vector3(0, 0, 1), 80)], random = () => .5 } = {}) {
  const scene = new THREE.Scene();
  const player = {
    position: new THREE.Vector3(), hits: 0,
    receiveHit() { this.hits++; }
  };
  const stats = { salud: 100 };
  const people = [];
  const system = new LimpiezaSocialSystem(scene, { player, stats, random });
  system.setup({ isWalkableAt: () => true, getGroundHeight: () => 0 }, routes, people);
  return { system, player, stats, people, scene };
}

function run(system, seconds, ctx = {}, onStep = null, step = 1 / 30) {
  for (let t = 0; t < seconds; t += step) {
    onStep?.(step);
    system.update(step, ctx);
  }
}

function deploy(system) {
  assert.equal(system.trigger(), true);
  system.distance = system.stopAt;
  system._place();
  system._dropOff();
}

test('la camioneta llega por la calle y frena junto al jugador', () => {
  const { system, player } = setup();
  assert.equal(system.trigger(), true);
  assert.equal(system.state, 'arriving');
  const start = system.suv.group.position.clone();
  assert.ok(start.distanceTo(player.position) > 30, 'arranca lejos');
  run(system, 10, {}, null);
  assert.ok(['out', 'stopped'].includes(system.state));
  const suv = system.suv.group.position;
  assert.ok(Math.hypot(suv.x - player.position.x, suv.z - player.position.z) < 9, 'frena cerca del jugador');
});

test('se bajan tres: el jefe señala y da la orden, los otros dos persiguen', () => {
  const { system, people } = setup();
  system.trigger();
  for (let i = 0; i < 300 && system.state !== 'out'; i++) system.update(1 / 30);
  run(system, .6);
  assert.equal(system.state, 'out');
  const [jefe, ...matones] = system.members;
  assert.equal(jefe.role, 'jefe');
  assert.equal(jefe.state, 'order');
  assert.equal(jefe.poseParams.point, 1);
  assert.equal(matones.length, 2);
  assert.ok(matones.every(m => ['chase', 'windup', 'strike', 'recover'].includes(m.state)));
  assert.equal(people.length, 3, 'los carros los respetan mientras están en la calle');
  assert.ok(toasts.some(t => /limpieza social/i.test(t)));
});

test('todos de negro con pasamontañas; el jefe además con gorra', () => {
  const jefe = squadLook('jefe'), maton = squadLook('maton');
  assert.ok(jefe.uniforme && new THREE.Color(jefe.uniforme).getHSL({}).l < .15, 'uniforme negro');
  assert.deepEqual(jefe.accesorios, ['pasamontanas', 'gorra']);
  assert.deepEqual(maton.accesorios, ['pasamontanas']);
  assert.equal(maton.real.calzado, 'botas');
  assert.ok(MASK_FIT.eyes[1] > MASK_FIT.eyes[0]);
  assert.ok(THUG_INSULTS.some(line => /chirrete hijueputa/i.test(line)));
});

test('si lo alcanzan, los cachazos siguen hasta matarlo', () => {
  const { system, player, stats } = setup();
  let hurt = 0;
  system.onPlayerHurt = () => { hurt++; };
  system.trigger();
  run(system, 20); // el jugador se queda quieto
  assert.equal(stats.salud, 0);
  assert.ok(hurt >= 4);
  assert.ok(player.hits >= 4);
  const [min, max] = SQUAD.damage;
  assert.ok(min >= 15 && max <= 35);
});

test('corriendo se les escapa: se cansan, vuelven y la camioneta se va', () => {
  const { system, player, stats, people } = setup();
  system.trigger();
  run(system, 30, {}, (dt) => { if (system.state === 'out') player.position.x -= 6 * dt; });
  assert.ok(stats.salud > 0, 'corriendo a 6 m/s no lo alcanzan');
  assert.ok(toasts.some(t => /cansaron/.test(t)));
  run(system, 90);
  assert.equal(system.active, false);
  assert.equal(system.suv.group.visible, false);
  assert.equal(people.length, 0);
  assert.ok(system.members.every(m => !m.active));
});

test('solo de noche, con probabilidad y con espera entre visitas', () => {
  const { system } = setup({ random: () => 0 });
  run(system, LIMPIEZA.cooldown + LIMPIEZA.checkEvery * 2, { isNight: false });
  assert.equal(system.active, false, 'de día no vienen');
  run(system, LIMPIEZA.checkEvery + 1, { isNight: true, allowSpawn: false });
  assert.equal(system.active, false, 'junto al cambuche no vienen');
  run(system, LIMPIEZA.checkEvery + 1, { isNight: true });
  assert.equal(system.active, true);
  system.reset();
  run(system, LIMPIEZA.checkEvery + 1, { isNight: true });
  assert.equal(system.active, false, 'la siguiente visita espera el enfriamiento');
});

test('en un circuito de tráfico frena en el carril más cercano y sin pisar al jugador', () => {
  const route = new TrafficRoute(0, 100, 0, 100, 3.2);
  const { system, player } = setup({ routes: [route] });
  player.position.set(50, 0, 4); // a 4 m del carril superior (z = 0)
  assert.equal(system.trigger(), true);
  run(system, 10);
  const suv = system.suv.group.position;
  assert.ok(Math.abs(suv.z) < .5, 'va por el carril');
  assert.ok(Math.abs(suv.x - 50) < 4);
});

test('lejos de toda calle no llega', () => {
  const { system, player } = setup();
  player.position.set(-60, 0, 0);
  assert.equal(system.trigger(), false);
});

test('la recuperación los sube a todos y la camioneta desaparece', () => {
  const { system, people } = setup();
  system.trigger();
  run(system, 8);
  system.reset();
  assert.equal(system.active, false);
  assert.equal(people.length, 0);
  assert.equal(system.suv.group.visible, false);
});

for (const [weapon, blows] of [['punos', 8], ['cuchillo', 4]]) {
  test(`vence al jefe con ${blows} contactos de ${weapon}, se retiran los escoltas y la victoria sobrevive a la carga`, async () => {
    const { scene, system, people, stats } = setup();
    Object.assign(stats, { energia: 100, dinero: 0, higiene: 100 });
    const input = { axis: {}, consumePress: () => false };
    const player = new Player(scene, input, stats);
    player.game = { steal: { buscado: 0 } };
    player.position.set(0, 0, 0);
    player.equipWeapon(weapon);
    system.player = player;
    deploy(system);
    await Promise.all(system.members.map(m => m.ready));
    const jefe = system.leader;
    player.position.copy(jefe.position);
    player.position.x += 1.1;
    player.root.rotation.y = -Math.PI / 2;
    // Una pared de la esquina separa al jefe de los escoltas mientras ambos intentan alcanzar al jugador.
    const z = (jefe.position.z + system.thugs[0].position.z) / 2;
    const collisions = new CollisionSystem();
    collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-20, 0, z - .05), new THREE.Vector3(20, 2.5, z + .05)) });
    system.collisions = collisions;
    for (const m of system.members) m.collisions = collisions;
    const deaths = [], outcomes = [], hits = [];
    window.addEventListener('npc-death', e => deaths.push(e.detail));
    window.addEventListener('limpieza-outcome', e => outcomes.push(e.detail.outcome));
    window.addEventListener('street-fight', e => hits.push(...e.detail.results));
    let accepted = 0;
    for (let frame = 0; frame < 600 && !system.outcome; frame++) {
      if (accepted < blows && player.punch()) accepted++;
      player.update(1 / 60, null, collisions, () => 0, people);
      system.update(1 / 60);
    }
    assert.equal(accepted, blows);
    assert.equal(hits.length, blows);
    assert.equal(hits.at(-1).health, 0);
    assert.equal(hits.at(-1).damage, hits.at(-1).previousHealth);
    assert.equal(jefe.isDead, true);
    assert.equal(stats.energia, 68);
    assert.equal(stats.dinero, 0);
    assert.equal(player.game.steal.buscado, 0);
    assert.deepEqual(outcomes, ['victoria']);
    assert.equal(deaths.length, 1);
    assert.deepEqual([deaths[0].victim, deaths[0].attacker, deaths[0].wasAggressor], [jefe, player, true]);
    assert.equal(deaths[0].attackId, hits.at(-1).attackId);
    assert.equal(jefe.takeHit({ attacker: player, damage: 100 }), false);
    assert.equal(system.thugs.some(m => m.isAttacking), false);
    run(system, 25);
    assert.equal(system.active, false);
    assert.equal(jefe.deathSettled, true);
    assert.equal(jefe.root.visible, true, 'el cuerpo sigue a la vista después de irse el coche');
    assert.ok(!jefe.emergencyReported);
    jefe.emergencyReported = true;
    const saved = JSON.parse(JSON.stringify(system.getSaveData()));
    const restored = setup().system;
    restored.loadSaveData(saved);
    assert.equal(restored.outcome, 'victoria');
    assert.equal(restored.trigger(), false);
    assert.equal(restored.leader.deathSettled, true);
    assert.equal(restored.leader.emergencyReported, true);
    assert.deepEqual(restored.leader.position, jefe.position);
    assert.equal(deaths.length, 1, 'la carga no reemite el incidente');
    player.position.set(200, 0, 200);
    system.update(.1);
    assert.equal(jefe.bodyReleased, true);
    assert.equal(system.getSaveData().fallen[0].bodyReleased, true);
    system.dispose(); restored.dispose(); player.dispose();
  });
}

test('el regreso deja partir el vehículo con un sobreviviente bloqueado y cancela los ataques ya preparados', async () => {
  const { system, player, stats } = setup();
  deploy(system);
  await Promise.all(system.members.map(m => m.ready));
  const [jefe, primero, segundo] = system.members;
  player.position.copy(primero.position);
  for (const m of [primero, segundo]) {
    m.position.copy(player.position);
    m.position.x += .7;
    m.state = 'strike';
    m.stateTimer = .001;
  }
  segundo.isWalkable = () => false;
  jefe.takeHit({ damage: 100, attackId: 9 });
  system.update(.1);
  assert.equal(system.outcome, 'victoria');
  assert.equal(stats.salud, 100);
  assert.equal(segundo.state, 'return');
  assert.equal(segundo.takeHit({ damage: 100 }), false);
  run(system, SQUAD.returnTimeout + 12);
  assert.equal(system.suv.group.visible, false);
  assert.equal(segundo.state, 'surrendered');
  assert.equal(segundo.root.visible, true, 'quedó en la calle donde se rindió');
  assert.equal(jefe.isDead, true);
});

test('cada cachazo anuncia su propia ventana y alternan cuando ambos están a alcance', () => {
  const { system, player, stats } = setup();
  deploy(system);
  for (const [i, m] of system.thugs.entries()) {
    m.position.copy(player.position); m.position.z = .9 + i * .05;
    m.root.rotation.y = Math.PI;
  }
  let elapsed = 0;
  const hits = [], outcomes = [];
  window.addEventListener('npc-player-hit', e => hits.push({ at: elapsed, ...e.detail }));
  window.addEventListener('limpieza-outcome', e => outcomes.push(e.detail.outcome));
  run(system, 15, {}, dt => { elapsed += dt; });
  assert.deepEqual(hits.map(h => h.attacker), [system.thugs[0], system.thugs[1], system.thugs[0], system.thugs[1]]);
  assert.ok(hits.slice(1).every((h, i) => h.at - hits[i].at >= SQUAD.groupInterval - .04));
  assert.ok(hits.every(h => h.previousHealth - h.health === h.damage && h.victim === player));
  assert.equal(stats.salud, 0);
  assert.deepEqual(outcomes, ['derrota']);
});

test('el cruce a cero es único incluso con reentrada; una baja parcial sigue ausente en la siguiente visita', () => {
  const { system, player } = setup();
  deploy(system);
  const thug = system.thugs[0];
  const contact = { attacker: player, damage: 85, attackId: 100 };
  assert.equal(thug.takeHit(contact), 0);
  assert.equal(thug.health, 15);
  assert.equal(thug.takeHit(contact), false);
  let deaths = 0;
  window.addEventListener('npc-death', () => { deaths++; assert.equal(thug.takeHit({ damage: 30 }), false); });
  assert.equal(thug.takeHit({ ...contact, attackId: 101 }), 0);
  assert.equal(deaths, 1);
  const saved = system.getSaveData();
  const restored = new LimpiezaSocialSystem(new THREE.Scene(), { player, stats: { salud: 100 } });
  restored.loadSaveData(saved);
  restored.setup(null, system.routes, []);
  deploy(restored);
  assert.equal(restored.thugs[0].isDead, true);
  assert.deepEqual(restored.thugs[0].position, thug.position);
  assert.equal(restored._people.length, 2);
  assert.equal(restored.thugs[1].isAttacking, true);
  assert.equal(deaths, 1);
  system.dispose(); restored.dispose();
});

test('el guardado dentro del último golpe conserva la victoria cuando el otro escolta ya se retiraba', () => {
  const { system } = setup();
  deploy(system);
  system.thugs[0].retreat();
  let snapshot;
  window.addEventListener('npc-death', () => { snapshot = system.getSaveData(); }, { once: true });
  system.thugs[1].takeHit({ damage: 100 });
  assert.equal(snapshot.outcome, 'victoria');
  const restored = setup().system;
  restored.loadSaveData(snapshot);
  assert.equal(restored.trigger(), false);
  system.update(.05);
  assert.equal(system.outcome, 'victoria');
  system.dispose(); restored.dispose();
});

test('el escolta herido con G conserva sus 88 de salud al cargar el golpe y bajar en la siguiente visita', () => {
  const { scene, system, people, stats } = setup();
  Object.assign(stats, { energia: 100, dinero: 0, higiene: 100 });
  let pressed = true;
  const input = { axis: {}, consumePress(key) {
    if (key !== 'KeyG' || !pressed) return false;
    pressed = false;
    return true;
  } };
  const player = new Player(scene, input, stats);
  player.position.set(0, 0, 0);
  system.player = player;
  deploy(system);
  const escolta = system.thugs[0];
  player.position.copy(escolta.position); player.position.z -= 1;
  player.root.rotation.y = 0;
  let saved;
  window.addEventListener('street-fight', ({ detail }) => {
    assert.equal(detail.hits[0], escolta);
    saved = JSON.parse(JSON.stringify(system.getSaveData()));
  }, { once: true });
  for (let i = 0; i < 30 && !saved; i++) {
    player.update(1 / 60, null, null, () => 0, people);
    system.update(1 / 60);
  }
  assert.equal(escolta.health, 88);
  assert.ok(saved);
  const restored = setup().system;
  restored.loadSaveData(saved);
  assert.equal(restored.thugs[0].health, 88);
  assert.equal(restored.trigger(), true);
  for (let i = 0; i < 600 && restored.state !== 'out'; i++) restored.update(1 / 60);
  assert.equal(restored.state, 'out');
  assert.equal(restored.thugs[0].stableId, escolta.stableId);
  assert.deepEqual(restored.members.map(member => member.health), [100, 88, 100]);
  assert.equal(restored.thugs[0].isAttacking, true);
  system.dispose(); restored.dispose(); player.dispose();
});
