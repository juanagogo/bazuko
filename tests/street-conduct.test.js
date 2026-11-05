import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';

// Las conductas son de Npc: el cuerpo solo se mira a través de lo que se le pide.
const character = () => ({
  group: new THREE.Group(), snaps: 0, holds: [],
  update(dt, params) { this.last = params; this.updates = (this.updates ?? 0) + 1; },
  snapPose() { this.snaps++; },
  hold(object) { this.holds.push(object); return true; },
  setSmoking(on) { this.smoking = on; },
  dispose() {}
});
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => character(), loadCatalog: async () => ({}),
  normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });
const { Npc, NPC_COMBAT, randomStreetLook } = await import('../src/entities/Npc.js');
const { LOW_STANCES } = await import('../src/character/archetypes.js');
const { PigeonFlock } = await import('../src/entities/PigeonFlock.js');

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
});

/** Andén recto de 40 baldosas con un cruce en la mitad. */
function street() {
  const row = Array.from({ length: 40 }, (_, x) => (x === 20 ? 'road' : 'sidewalk'));
  return new PedestrianNavigation([row, row, row], 2, { isCrossing: (x) => x === 20 });
}

async function person(id, { at = [10, 0, 2], navigation = street(), fijo, ...opts } = {}) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(...at), {
    arquetipo: id, navigation, fijo, facing: opts.facing ?? 0, groundHeight: () => 0,
    isWalkable: (x, z) => !navigation || navigation.isWalkableAt(x, z) || Math.hypot(x - at[0], z - at[2]) < 2, ...opts
  });
  await npc.ready;
  npc.fullChar = character();
  return npc;
}
const run = (npc, seconds, ctx = {}, step = .05) => { for (let t = 0; t < seconds; t += step) npc.update(step, { player: new THREE.Vector3(500, 0, 500), ...ctx }); };

test('al terminar un recorrido hace una parada de su arquetipo, de 4 a 20 s', async () => {
  const npc = await person('oficinista');
  npc.person.pausa = 1;
  const stops = new Set();
  for (let i = 0; i < 80; i++) {
    npc.position.set(10, 0, 2);
    npc.action = null;
    npc._takeStop();
    stops.add(npc.stance ?? npc.action);
    assert.ok(npc.wait >= 4 && npc.wait <= 20, `parada de ${npc.wait} s`);
    assert.ok(!LOW_STANCES.has(npc.stance));
  }
  for (const stance of stops) assert.ok(stance in npc.person.paradas, stance);
  assert.ok(stops.size >= 3, 'no siempre hace lo mismo');
  npc.dispose();
});

test('nunca se queda parado en un cruce ni fuera de la red: ahí solo toma aire', async () => {
  const nav = street(), npc = await person('oficinista', { navigation: nav });
  npc.person.pausa = 1;
  for (const [x, z] of [[40, 2], [-50, 2], [10, 90]]) {
    npc.position.set(x, 0, z);
    for (let i = 0; i < 30; i++) {
      npc.stance = 'bolsillos';
      npc._takeStop();
      assert.equal(npc.stance, null, `${x},${z}`);
      assert.equal(npc.action, null);
      assert.ok(npc.wait < 2, `${npc.wait} s en ${x},${z}`);
    }
  }
  npc.dispose();
});

test('caminando de verdad por la red, nadie se detiene en el cruce con una postura', async () => {
  const nav = street();
  const people = await Promise.all(['oficinista', 'estudiante', 'senora', 'obrero', 'reciclador', 'habitante', 'abuelo', 'vendedor']
    .map((id, i) => person(id, { navigation: nav, at: [8 + i * 8, 0, 2] })));
  let stops = 0, moves = 0;
  for (let t = 0; t < 180; t += .1) {
    for (const npc of people) {
      npc.update(.1, { player: new THREE.Vector3(500, 0, 500) });
      if (npc.moving) moves++;
      const stopped = !npc.target && !npc.moving && (npc.stance || npc.action);
      if (!stopped) continue;
      stops++;
      const node = nav.nodes[nav.nodeAt(npc.position.x, npc.position.z)];
      assert.ok(node && !node.crossing, `${npc.person.arquetipo} se paró en ${npc.position.x}, ${npc.position.z}`);
    }
  }
  assert.ok(stops > 200, `se paran: ${stops}`);
  assert.ok(moves > 1000, `andan: ${moves}`);
  for (const npc of people) npc.dispose();
});

test('parte de los caminantes empieza la partida ya en lo suyo', async () => {
  const nav = street();
  const people = Array.from({ length: 200 }, () => new Npc(new THREE.Scene(), new THREE.Vector3(10, 0, 2), { arquetipo: 'estudiante', navigation: nav }));
  const stopped = people.filter(npc => npc.wait > 0 && (npc.stance || npc.action)).length;
  assert.ok(stopped > 15 && stopped < 110, `${stopped} de 200`);
  await Promise.all(people.map(npc => npc.ready));
  for (const npc of people) npc.dispose();
});

test('el recorrido prefiere volver a su zona cuando se alejó', async () => {
  const npc = await person('senora');
  npc.home.set(0, 0, 0);
  npc.position.set(400, 0, 0);
  const calls = [[new THREE.Vector3(450, 0, 0)], [new THREE.Vector3(350, 0, 0)]];
  npc.navigation = { createRoute: () => calls.shift() };
  assert.equal(npc._chooseRoute()[0].x, 350);
  npc.position.set(10, 0, 0);
  npc.navigation = { createRoute: () => [new THREE.Vector3(20, 0, 0)] };
  assert.equal(npc._chooseRoute()[0].x, 20, 'cerca de casa, cualquiera');
  npc.dispose();
});

test('un fijo no se mueve ni cambia de postura en toda la partida', async () => {
  const npc = await person('habitante', { fijo: { stance: 'dormido' }, facing: 1.2 });
  const start = npc.position.clone();
  run(npc, 120);
  assert.deepEqual(npc.position.toArray(), start.toArray());
  assert.equal(npc.stance, 'dormido');
  assert.equal(npc.character.last.stance, 'dormido');
  assert.equal(npc.character.last.speed, 0);
  assert.ok(Math.abs(npc.root.rotation.y - 1.2) < 1e-6);
  assert.equal(npc.style, null);
  npc.dispose();
});

test('quien conversa alterna sus posturas sin moverse', async () => {
  const stances = ['hablar', 'brazos-cruzados', 'bolsillos'];
  const npc = await person('estudiante', { fijo: { stance: 'hablar', alternas: stances } });
  const seen = new Set();
  for (let t = 0; t < 240; t += .25) { npc.update(.25, { player: new THREE.Vector3(500, 0, 500) }); seen.add(npc.stance); }
  assert.deepEqual([...seen].sort(), [...stances].sort());
  assert.equal(npc.fijo.out, false);
  npc.dispose();
});

test('un fijo atacado se levanta, huye y, pasado el susto, vuelve a su sitio y a su postura', async () => {
  const npc = await person('habitante', { fijo: { stance: 'sentado' } });
  const home = npc.position.clone();
  const attacker = { position: home.clone().add(new THREE.Vector3(0, 0, -1)) };
  assert.ok(npc.takeHit({ damage: 10, attacker, attackId: 1 }));
  assert.equal(npc.fijo.out, true);
  assert.notEqual(npc.stance, 'sentado', 'lo primero es levantarse');
  run(npc, NPC_COMBAT.flee);
  assert.ok(npc.position.distanceTo(home) > 2, 'huyó como cualquiera');
  assert.ok(npc.character.last.running || npc.fleeTimer <= 0);
  run(npc, 60);
  assert.deepEqual(npc.position.toArray(), home.toArray(), 'de vuelta en su punto exacto');
  assert.equal(npc.fijo.out, false);
  assert.equal(npc.stance, 'sentado');
  assert.equal(npc.style, null);
  npc.dispose();
});

test('con el jugador encima no vuelve todavía', async () => {
  const npc = await person('habitante', { fijo: { stance: 'sentado' } });
  const home = npc.position.clone();
  npc.takeHit({ damage: 10, attacker: { position: home.clone().add(new THREE.Vector3(0, 0, -1)) }, attackId: 1 });
  const close = (t) => { for (let i = 0; i < t / .05; i++) npc.update(.05, { player: npc.position.clone().add(new THREE.Vector3(3, 0, 0)) }); };
  close(30);
  assert.equal(npc.fijo.out, true);
  assert.ok(npc.position.distanceTo(home) > 1);
  run(npc, 60);
  assert.equal(npc.fijo.out, false);
  npc.dispose();
});

test('noqueado cae como cualquiera y al recuperarse también vuelve', async () => {
  const npc = await person('reciclador', { fijo: { stance: 'dormido' } });
  const home = npc.position.clone();
  npc.takeHit({ damage: 1000, attacker: { position: home.clone().add(new THREE.Vector3(1, 0, 0)) }, attackId: 1 });
  assert.equal(npc.koState, 'down');
  run(npc, NPC_COMBAT.fall + NPC_COMBAT.downMin + NPC_COMBAT.downExtra + NPC_COMBAT.rise + .2);
  assert.equal(npc.koState, null);
  assert.equal(npc.health, npc.maxHealth);
  run(npc, 60);
  assert.deepEqual(npc.position.toArray(), home.toArray());
  assert.equal(npc.stance, 'dormido');
  npc.dispose();
});

test('sigue defendiéndose: un fijo devuelve el golpe igual que un caminante', async () => {
  const attacker = { position: new THREE.Vector3(), stats: { salud: 100 } };
  let counters = 0, tries = 0;
  for (; tries < 60 && !counters; tries++) {
    const npc = await person('obrero', { fijo: { stance: 'brazos-cruzados' } });
    attacker.position.copy(npc.position).add(new THREE.Vector3(0, 0, -1));
    npc.takeHit({ damage: 10, attacker, attackId: 1 });
    assert.equal(npc.fijo.out, true);
    if (npc._counter) counters++;
    npc.dispose();
  }
  assert.ok(counters > 0, 'alguno se defendió');
});

test('si se roban algo o le lanzan algo, también se levanta y luego vuelve', async () => {
  const npc = await person('habitante', { fijo: { stance: 'acurrucado' } });
  const home = npc.position.clone();
  npc.alarmedByTheft(home.clone().add(new THREE.Vector3(.5, 0, 0)));
  run(npc, 1);
  assert.equal(npc.fijo.out, true);
  assert.ok(npc.position.distanceTo(home) > .5);
  run(npc, 80);
  assert.deepEqual(npc.position.toArray(), home.toArray());
  assert.equal(npc.stance, 'acurrucado');
  npc.dispose();
});

test('si asustan a uno de la pareja, el otro no se queda ahí parado y los dos regresan', async () => {
  const nav = street();
  const a = await person('senora', { navigation: nav, at: [10, 0, 2], fijo: { stance: 'hablar' } });
  const b = await person('abuelo', { navigation: nav, at: [11, 0, 2], fijo: { stance: 'hablar' } });
  a.fijo.pareja = b; b.fijo.pareja = a;
  a.takeHit({ damage: 10, attacker: { position: new THREE.Vector3(9, 0, 2) }, attackId: 1 });
  run(a, .1); run(b, .1);
  assert.ok(b.fleeTimer > 0);
  for (let t = 0; t < 90; t += .05) { a.update(.05, { player: new THREE.Vector3(500, 0, 500) }); b.update(.05, { player: new THREE.Vector3(500, 0, 500) }); }
  assert.deepEqual(a.position.toArray(), [10, 0, 2]);
  assert.deepEqual(b.position.toArray(), [11, 0, 2]);
  assert.equal(a.stance, 'hablar');
  assert.equal(b.stance, 'hablar');
  a.dispose(); b.dispose();
});

test('sin camino a casa sigue como cualquier peatón en vez de quedarse trabado', async () => {
  const nav = new PedestrianNavigation([['sidewalk', 'sidewalk', 'wall', 'sidewalk', 'sidewalk']], 2);
  const npc = await person('habitante', { navigation: nav, at: [0, 0, 0], fijo: { stance: 'sentado' } });
  npc._leaveSpot();
  npc.position.set(6, 0, 0);
  run(npc, 12);
  assert.equal(npc.fijo, null);
  run(npc, 30);
  npc.dispose();
});

test('en el andén vuelve en línea recta, sin red, y no se baja', async () => {
  const onPlatform = (x, z) => x >= 73.5 && x <= 76.5 && z >= -57 && z <= -3;
  const npc = await person('senora', { navigation: null, at: [76.42, 0, -19.76], isWalkable: onPlatform, fijo: { stance: 'banca', techo: true } });
  const home = npc.position.clone();
  npc.takeHit({ damage: 10, attacker: { position: new THREE.Vector3(75.4, 0, -19.7) }, attackId: 1 });
  for (let t = 0; t < 8; t += .05) {
    npc.update(.05, { player: new THREE.Vector3(500, 0, 500) });
    assert.ok(onPlatform(npc.position.x, npc.position.z), `${npc.position.x}, ${npc.position.z}`);
  }
  run(npc, 40);
  assert.deepEqual(npc.position.toArray(), home.toArray());
  assert.equal(npc.stance, 'banca');
  npc.dispose();
});

test('el vendedor atiende, alterna posturas y nunca deja su puesto, ni a golpes', async () => {
  const npc = await person('vendedor', { fijo: { stance: 'atender', alternas: ['atender', 'brazos-cruzados'] } });
  npc.isVendor = true;
  const home = npc.position.clone();
  run(npc, 3);
  assert.equal(npc.character.last.stance, npc.stance);
  npc.takeHit({ damage: 10, attacker: { position: home.clone().add(new THREE.Vector3(0, 0, -1)) }, attackId: 1 });
  assert.equal(npc.fijo.out, false);
  const after = npc.position.clone();
  run(npc, 8);
  assert.deepEqual(npc.position.toArray(), after.toArray(), 'no anda');
  assert.ok(after.distanceTo(home) < .5);
  assert.ok(['atender', 'brazos-cruzados'].includes(npc.stance));
  npc.dispose();
});

test('mira al jugador cercano solo con el modelo completo y sin girar la cabeza más de la cuenta', async () => {
  const npc = await person('oficinista', { fijo: { stance: 'brazos-cruzados' }, facing: 0 });
  npc._show(npc.fullChar);
  const near = (x, z) => ({ player: npc.position.clone().add(new THREE.Vector3(x, 0, z)) });
  const glance = (ctx, stance = 'brazos-cruzados') => { npc._updateConduct(.01, ctx); return npc._glanceAt(ctx, stance); };
  assert.ok(Math.abs(glance(near(1, 3)) - Math.atan2(1, 3)) < 1e-6);
  assert.ok(glance(near(-1, 3)) < 0);
  assert.equal(glance(near(3, 0)), 1.1, 'hasta donde da el cuello');
  assert.equal(glance(near(0, -3)), 0, 'a sus espaldas no lo ve');
  assert.equal(glance(near(0, 5)), 0, 'lejos no');
  assert.equal(glance(near(1, 3), 'dormido'), 0, 'dormido no mira');
  assert.equal(glance(near(1, 3), 'celular'), 0);
  assert.equal(glance({ player: { x: undefined, z: undefined } }), 0, 'en la sala no hay posición que mirar');
  npc._show(npc.lodChar);
  assert.equal(glance(near(1, 3)), 0, 'el liviano no gira la cabeza');
  npc.dispose();
});

test('con el jugador sucio al lado se tapa la nariz un rato; limpio o lejos, no', async () => {
  const npc = await person('oficinista', { navigation: null, fijo: { stance: 'brazos-cruzados' } });
  const player = npc.position.clone().add(new THREE.Vector3(1.5, 0, 0));
  npc._noseCooldown = 0;
  npc._updateConduct(.01, { player, hygiene: 90 });
  assert.notEqual(npc._stanceNow(), 'nariz');
  npc._updateConduct(.01, { player: new THREE.Vector3(500, 0, 500), hygiene: 5 });
  assert.notEqual(npc._stanceNow(), 'nariz');
  npc._updateConduct(.01, { player, hygiene: 5 });
  assert.equal(npc._stanceNow(), 'nariz');
  // Se le pasa, y no vuelve enseguida.
  npc._updateConduct(5, { player, hygiene: 5 });
  assert.notEqual(npc._stanceNow(), 'nariz');
  npc._updateConduct(.01, { player, hygiene: 5 });
  assert.notEqual(npc._stanceNow(), 'nariz');
  const asleep = await person('habitante', { navigation: null, fijo: { stance: 'dormido' } });
  asleep._noseCooldown = 0;
  asleep._updateConduct(.01, { player: asleep.position.clone(), hygiene: 5 });
  assert.equal(asleep._stanceNow(), 'dormido');
  const cane = await person('abuelo', { navigation: null, fijo: { stance: 'brazos-cruzados' } });
  cane.person.nariz = false; // lleva el bastón en esa mano
  cane._noseCooldown = 0;
  cane._updateConduct(.01, { player: cane.position.clone(), hygiene: 5 });
  assert.notEqual(cane._stanceNow(), 'nariz');
  npc.dispose(); asleep.dispose(); cane.dispose();
});

test('bajo la lluvia, quien tiene paraguas lo saca y lo comparte; quien no, se cubre y apura el paso', async () => {
  const a = await person('oficinista'), b = await person('oficinista'), c = await person('reciclador');
  a.person.paraguas = 1; b.person.paraguas = 1; c.person.paraguas = null;
  c.person.lluvia = 'encogido'; c.person.correr = 1.3;
  const ctx = { isRaining: true, player: new THREE.Vector3(500, 0, 500) };
  for (const npc of [a, b, c]) npc.update(.05, ctx);
  assert.equal(a._stanceNow(), 'paraguas');
  assert.equal(a.umbrella.visible, true);
  assert.ok(a.character.holds.includes(a.umbrella), 'en la mano');
  assert.equal(a.umbrella.geometry, b.umbrella.geometry);
  assert.equal(a.umbrella.material, b.umbrella.material);
  assert.notEqual(a.umbrella, b.umbrella);
  assert.equal(a._paceNow(), a.walkSpeed);
  c.moving = true;
  assert.equal(c._stanceNow(), 'encogido');
  assert.ok(Math.abs(c._paceNow() - c.walkSpeed * 1.3) < 1e-9);
  assert.equal(c.umbrella, null);
  // Escampó: se guarda.
  a.update(.05, { player: new THREE.Vector3(500, 0, 500) });
  assert.equal(a.umbrella.visible, false);
  // Liberar a uno no toca lo de los demás.
  let disposed = 0;
  b.umbrella.material.addEventListener('dispose', () => { disposed++; });
  a.dispose();
  assert.equal(disposed, 0);
  assert.ok(b.umbrella);
  b.dispose(); c.dispose();
});

test('sin paraguas no se queda parado bajo el aguacero; bajo techo sí', async () => {
  const wet = await person('reciclador');
  wet.person.paraguas = null;
  wet.target = null; wet.route = []; wet.wait = 15; wet.stance = 'barriga';
  wet._updateConduct(.05, { isRaining: true });
  assert.ok(wet.wait <= 2);
  const roof = await person('oficinista', { navigation: null, fijo: { stance: 'celular', techo: true } });
  roof.person.paraguas = 2;
  roof._updateConduct(.05, { isRaining: true });
  assert.equal(roof._stanceNow(), 'celular');
  roof.update(.05, { isRaining: true, player: new THREE.Vector3(500, 0, 500) });
  assert.equal(roof.umbrella, null);
  // Ya no está bajo techo si salió corriendo.
  roof.fijo.out = true;
  assert.equal(roof._stanceNow(), 'paraguas');
  const sitting = await person('abuelo', { navigation: null, fijo: { stance: 'banca' } });
  sitting.person.paraguas = 2;
  sitting._updateConduct(.05, { isRaining: true });
  assert.equal(sitting._stanceNow(), 'banca', 'sentado se queda como está');
  wet.dispose(); roof.dispose(); sitting.dispose();
});

test('el celular y el cigarrillo aparecen con la postura y solo de cerca', async () => {
  const npc = await person('oficinista', { fijo: { stance: 'telefono' } });
  npc._show(npc.lodChar);
  npc._updateHeld('telefono');
  assert.equal(npc.phone, null, 'de lejos no se crea');
  npc._show(npc.fullChar);
  npc._updateHeld('telefono');
  assert.equal(npc.phone.visible, true);
  assert.ok(npc.fullChar.holds.includes(npc.phone));
  npc._updateHeld('brazos-cruzados');
  assert.equal(npc.phone.visible, false);
  npc._updateHeld('fumar-quieto');
  assert.equal(npc.fullChar.smoking, true);
  npc._updateHeld(null);
  assert.equal(npc.fullChar.smoking, false);
  npc.dispose();
});

test('lejos, quieto y sin animar, toma la postura nueva de una y una sola vez', async () => {
  const npc = await person('oficinista', { navigation: null, fijo: { stance: 'bolsillos' } });
  const player = npc.position.clone().add(new THREE.Vector3(60, 0, 0));
  run(npc, 1, { player });
  const before = npc.character.updates ?? 0, snaps = npc.character.snaps;
  run(npc, 1, { player });
  assert.equal(npc.character.updates ?? 0, before, 'congelado');
  npc.stance = 'brazos-cruzados';
  npc.update(.05, { player });
  assert.equal(npc.character.updates, before + 1);
  assert.equal(npc.character.snaps, snaps + 1);
  assert.equal(npc.character.last.stance, 'brazos-cruzados');
  run(npc, 1, { player });
  assert.equal(npc.character.updates, before + 1);
  npc.dispose();
});

test('anda a la velocidad de su arquetipo: los del paso cansado no corren, y con la talla el paso no patina', async () => {
  const office = await person('oficinista'), old = await person('abuelo');
  assert.equal(office.andar, 'firme');
  assert.equal(old.andar, 'lento');
  assert.ok(old.walkSpeed < office.walkSpeed);
  office.look.real = { ...office.look.real, talla: { alto: 1.05, ancho: 1 } };
  office.moving = false;
  office.target = new THREE.Vector3(30, 0, 2);
  office.wait = 0;
  office.stance = null;
  office.action = null;
  office.update(.05, { player: office.position.clone().add(new THREE.Vector3(3, 0, 0)) });
  assert.ok(Math.abs(office.character.last.speed - office.walkSpeed / (1.08 * 1.05)) < 1e-6, `${office.character.last.speed}`);
  office.dispose(); old.dispose();
});

test('sin arquetipo no hay conductas: un `look` dado y los subtipos siguen como antes', async () => {
  class Squad extends Npc {}
  const given = new Npc(new THREE.Scene(), new THREE.Vector3(), { look: {}, isWalkable: () => false });
  const squad = new Squad(new THREE.Scene(), new THREE.Vector3(), { isWalkable: () => false });
  await Promise.all([given.ready, squad.ready]);
  assert.equal(given.person, null);
  assert.equal(squad.person, null);
  given.update(.05, { isRaining: true, hygiene: 5, player: new THREE.Vector3(1, 0, 0) });
  assert.equal(given.umbrella, null);
  assert.equal(given.stance, null);
  given.dispose(); squad.dispose();
});

test('gastada sigue queriendo decir habitante de calle y lo demás es un transeúnte sin carga', async () => {
  const street = new Npc(new THREE.Scene(), new THREE.Vector3(), { gastada: true, isWalkable: () => false });
  await street.ready;
  assert.equal(street.person.arquetipo, 'habitante');
  assert.equal(street.look.desgaste, 2);
  const worn = await randomStreetLook({ gastada: true });
  assert.equal(worn.real.desgaste, 2);
  assert.deepEqual(worn.real.accesorios, []);
  for (let i = 0; i < 40; i++) {
    const look = await randomStreetLook();
    assert.notEqual(look.real.desgaste, 2);
    assert.deepEqual(look.real.accesorios, []);
  }
  street.dispose();
});

test('las palomas no le temen a quien duerme en el parque', async () => {
  const scene = new THREE.Scene();
  const flock = new PigeonFlock(scene, { x0: 0, x1: 10, z0: 0, z1: 10 }, { count: 2 });
  const npc = await person('abuelo', { navigation: null, at: [flock.birds[0].position.x, 0, flock.birds[0].position.z], fijo: { stance: 'banca' } });
  for (let i = 0; i < 10; i++) flock.update(.1, new THREE.Vector3(40, 0, 40), [npc]);
  assert.ok(flock.birds.every(bird => bird.state !== 'flying' && bird.state !== 'startled'));
  flock.dispose(); npc.dispose();
});
