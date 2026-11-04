// Lo que hace una persona cuando la asustan: dónde espera, cómo se levanta, qué pasa con lo que lleva en la mano.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { PedestrianNavigation } from '../src/world/bogota/PedestrianNavigation.js';

const character = () => ({
  group: new THREE.Group(), snaps: 0, props: new Map(), motions: [],
  update(dt, params) { this.last = params; this.updates = (this.updates ?? 0) + 1; },
  snapPose() { this.snaps++; },
  hold(object) { this.holder ??= new THREE.Group(); this.holder.add(object); object.heldAgain = true; return true; },
  grab(object, pose) {
    this.holder ??= new THREE.Group();
    this.holder.add(object);
    this.grabbed = pose;
    const here = { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() };
    return { from: here, to: { position: here.position.clone().add(new THREE.Vector3(0, .3, 0)), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) } };
  },
  setPropVisible(id, on) { this.props.set(id, on); },
  motionState() { return { from: this }; },
  applyMotion(state) { this.motions.push(state); },
  setSmoking() {},
  dispose() {}
});
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => character(), loadCatalog: async () => ({}),
  normalizeReal: (_catalog, look) => look, optionsFor: () => [], REALISTIC_SCALE: 1.08
} });
const { Npc, NPC_COMBAT, NPC_LOD } = await import('../src/entities/Npc.js');
const { KO_HAND_DOWN } = await import('../src/character/BodyLanguage.js');
const { LOW_STANCES } = await import('../src/character/archetypes.js');
const { RISE_TIME, smooth } = await import('../src/character/BodyLanguage.js');
const { Player, pickGesture } = await import('../src/entities/Player.js');
const { AngryDriver } = await import('../src/entities/AngryDriver.js');
const { StealSystem } = await import('../src/features/steal.js');
const { CollisionSystem } = await import('../src/systems/CollisionSystem.js');

beforeEach(() => {
  globalThis.window = new EventTarget();
});

/** Andén recto de 40 baldosas con un cruce en la mitad (x = 40). */
function street() {
  const row = Array.from({ length: 40 }, (_, x) => (x === 20 ? 'road' : 'sidewalk'));
  return new PedestrianNavigation([row, row, row], 2, { isCrossing: (x) => x === 20 });
}

async function person(id, { at = [30, 0, 2], navigation = street(), fijo, ...opts } = {}) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(...at), {
    arquetipo: id, navigation, fijo, facing: opts.facing ?? 0, groundHeight: () => 0,
    isWalkable: (x, z) => !navigation || navigation.isWalkableAt(x, z), ...opts
  });
  await npc.ready;
  npc.fullChar = character();
  return npc;
}
const far = () => new THREE.Vector3(500, 0, 500);
const run = (npc, seconds, ctx = {}, step = .05) => { for (let t = 0; t < seconds; t += step) npc.update(step, { player: far(), ...ctx }); };
const isCrossing = (npc) => npc.navigation.nodes[npc.navigation.nodeAt(npc.position.x, npc.position.z)]?.crossing;
const hurt = (npc, damage = 12) => npc.takeHit({ damage, knockback: 1.6, attacker: { position: npc.position.clone().add(new THREE.Vector3(1, 0, 0)), stats: { salud: 100 } } });

test('al acabar de huir en un cruce sale de la calle aunque el jugador siga al lado, y espera de pie en el andén', async () => {
  const npc = await person('oficinista', { fijo: { stance: 'brazos-cruzados' } });
  // Termina la huida en plena calzada con el jugador a 5 m.
  npc._leaveSpot();
  npc.position.set(40, 0, 2.3);
  npc.fijo.returnIn = 0;
  assert.ok(isCrossing(npc));
  const player = new THREE.Vector3(36, 0, 2);
  run(npc, 3, { player });
  assert.equal(npc.fijo.out, true, 'con el jugador cerca no vuelve todavía');
  assert.ok(!isCrossing(npc), 'no se quedó en el cruce');
  assert.ok(npc.navigation.isRestingAt(npc.position), `espera en el centro de una baldosa: ${npc.position.toArray()}`);
  assert.equal(npc.moving, false);
  assert.ok(['mirar-izquierda', 'mirar-derecha', 'brazos-cruzados', 'cambiar-peso'].includes(npc.stance), `de pie y en algo: ${npc.stance}`);
  // Se va el jugador: vuelve a su sitio y a lo que hacía.
  run(npc, 40);
  assert.equal(npc.fijo.out, false);
  assert.deepEqual(npc.position.toArray(), npc.home.toArray());
  assert.equal(npc.stance, 'brazos-cruzados');
});

test('tampoco se queda en el borde de una baldosa: el centro está lejos del carril', async () => {
  const npc = await person('oficinista', { fijo: { stance: 'brazos-cruzados' } });
  npc._leaveSpot();
  npc.position.set(38.9, 0, 3.1);
  npc.fijo.returnIn = 0;
  run(npc, 2, { player: new THREE.Vector3(34, 0, 2) });
  assert.ok(npc.navigation.isRestingAt(npc.position));
});

test('un susto a mitad de camino no lo deja esperando donde quedó', async () => {
  const npc = await person('oficinista', { fijo: { stance: 'brazos-cruzados' } });
  npc.alarmedByTheft(new THREE.Vector3(26, 0, 2));
  const player = new THREE.Vector3(26, 0, 2);
  run(npc, 3, { player });
  npc.alarmedByTheft(new THREE.Vector3(npc.position.x - 1, 0, 2));
  run(npc, 12, { player });
  assert.ok(npc.navigation.isRestingAt(npc.position) || npc.fijo.out === false || npc.moving);
  assert.ok(!isCrossing(npc));
});

test('si le ocupan el sitio espera a un paso, sin metérsele encima al jugador', async () => {
  const npc = await person('oficinista', { fijo: { stance: 'brazos-cruzados' } });
  npc.alarmedByTheft(new THREE.Vector3(26, 0, 2));
  run(npc, 5);
  assert.equal(npc.fijo.out, true);
  const player = npc.home.clone().add(new THREE.Vector3(.3, 0, .2));
  // Lo deja acercarse con el jugador lejos y se para encima de su sitio cuando ya viene llegando.
  for (let i = 0; i < 1200 && !npc.fijo.out === false; i++) {
    const nearSpot = npc.position.distanceTo(npc.home) < 4;
    npc.update(.05, { player: nearSpot ? player : far() });
    if (!npc.fijo.out) break;
  }
  assert.equal(npc.fijo.out, true, 'no llegó a su sitio con el jugador parado ahí');
  const gap = npc.position.distanceTo(npc.home);
  assert.ok(gap > .8 && gap <= 1.25, `espera a un paso: ${gap}`);
  assert.equal(npc.moving, false);
  run(npc, 3);
  assert.equal(npc.fijo.out, false, 'se quitó el jugador y volvió');
});

test('quien está en el piso se levanta antes de dar un paso, y lo hace rápido', async () => {
  for (const stance of LOW_STANCES) {
    const npc = await person('habitante', { navigation: street(), fijo: { stance } });
    const start = npc.position.clone();
    npc.alarmedByTheft(new THREE.Vector3(26, 0, 2));
    npc.update(.05, { player: far() });
    assert.ok(npc.stance === null);
    let t = .05;
    for (; t < RISE_TIME - .06; t += .05) {
      npc.update(.05, { player: far() });
      assert.deepEqual(npc.position.toArray(), start.toArray(), `${stance} se movió a los ${t} s`);
      assert.equal(npc.moving, false);
      if (npc.character.last) assert.equal(npc.character.last.rising, true);
    }
    run(npc, .4);
    assert.ok(npc.position.distanceTo(start) > .1, `${stance} ya salió corriendo`);
    assert.equal(npc.character.last.rising, false);
  }
  assert.ok(RISE_TIME >= .3 && RISE_TIME <= .4);
});

test('quien se estaba parando con calma y lo asustan tampoco sale deslizándose', async () => {
  const npc = await person('habitante');
  npc.stance = 'pedir';
  npc.action = null; // si arranca rebuscando, primero suelta eso
  npc.target = null;
  npc.wait = 0;
  npc.update(.05, { player: far() });
  assert.equal(npc.stance, null, 'empezó a pararse');
  assert.ok(npc.wait > RISE_TIME, 'y le falta');
  const start = npc.position.clone();
  npc.alarmedByTheft(new THREE.Vector3(26, 0, 2));
  for (let t = .05; t < RISE_TIME - .06; t += .05) {
    npc.update(.05, { player: far() });
    assert.deepEqual(npc.position.toArray(), start.toArray(), `se movió a los ${t} s`);
  }
  run(npc, .4);
  assert.ok(npc.position.distanceTo(start) > .1, 'ya salió corriendo');
  // Solo vale para esa levantada: un susto después, ya de pie, sale de una.
  const up = await person('habitante');
  up.stance = 'pedir';
  up.action = null; // si arranca rebuscando, a los 1,5 s todavía se está parando
  up.target = null;
  up.wait = 0;
  up.update(.05, { player: far() });
  run(up, 1.5);
  up.stance = null; // ya anda, o paró en otra cosa: lo que se mira es que no le quede la levantada de antes
  const from = up.position.clone();
  up.alarmedByTheft(new THREE.Vector3(from.x - 4, 0, from.z));
  up.update(.05, { player: far() });
  assert.ok(up.position.distanceTo(from) > 0, 'ya estaba de pie');
});

test('de la banca sale por delante o de lado: el espaldar no se atraviesa', async () => {
  for (const facing of [0, Math.PI / 2, -Math.PI / 2]) {
    const fx = Math.sin(facing), fz = Math.cos(facing);
    for (const side of [.3, -.3, 0]) {
      const npc = await person('senora', { fijo: { stance: 'banca', facing }, facing, at: [30, 0, 3] });
      npc.fijo.facing = facing;
      // El susto viene de frente: huir derecho sería pasar por encima del espaldar.
      const from = npc.position.clone().add(new THREE.Vector3(fx + fz * side, 0, fz - fx * side));
      npc.alarmedByTheft(from);
      let deepest = 0, farthest = 0;
      // Hasta dejar la banca atrás: más allá, el andén de la prueba es angosto y la hace rebotar.
      for (let t = 0; t < 2 && farthest <= 1; t += .05) {
        npc.update(.05, { player: far() });
        deepest = Math.min(deepest, (npc.position.x - 30) * fx + (npc.position.z - 3) * fz);
        farthest = Math.max(farthest, npc.position.distanceTo(new THREE.Vector3(30, 0, 3)));
      }
      assert.ok(deepest > -.01, `facing ${facing}, lado ${side}: se fue ${deepest} m hacia atrás del asiento`);
      assert.ok(farthest > 1, 'igual salió corriendo');
    }
  }
  // Una patrulla encima no da para escoger.
  const npc = await person('senora', { fijo: { stance: 'banca', facing: 0 }, facing: 0, at: [30, 0, 3] });
  npc.fijo.facing = 0;
  const car = { position: new THREE.Vector3(24, 0, 3.8), group: { rotation: { y: 0 } }, width: 2 }; // va hacia +x, por delante del asiento
  npc.update(.05, { player: far(), chasers: [{ car, speed: 6 }] });
  assert.ok(npc.fleeTimer > 0 && npc.fleeDir.z < -.99, 'se quita hacia atrás');
  run(npc, 1);
  assert.ok(npc.position.z < 2.6, `pasó detrás de la banca: ${npc.position.z}`);
});

test('un golpe en el piso no lo empuja, no lo hace girar de un tirón y no devuelve el golpe', async () => {
  const npc = await person('habitante', { fijo: { stance: 'dormido' }, facing: 1 });
  npc.look = { real: { edad: 'adulto' } };
  const start = npc.position.clone();
  hurt(npc);
  assert.equal(npc._counter, null, 'desde el piso nadie devuelve el golpe');
  npc.update(.05, { player: far() });
  assert.equal(npc.character.last.rising, true);
  assert.ok(Math.abs(npc.root.rotation.y - 1) < 1e-9, 'mientras se para no gira');
  run(npc, NPC_COMBAT.stagger);
  assert.deepEqual(npc.position.toArray(), start.toArray(), 'el golpe no lo saca rodando');
  // De pie sí.
  const up = await person('oficinista', { fijo: { stance: 'brazos-cruzados' } });
  up.look = { real: { edad: 'adulto' } };
  const from = up.position.clone();
  hurt(up);
  assert.ok(up._counter, 'de pie sí se defiende');
  run(up, NPC_COMBAT.stagger);
  assert.ok(up.position.distanceTo(from) > .1);
});

test('una patrulla en persecución que le viene encima lo hace quitarse de lado, también desde la banca', async () => {
  const npc = await person('senora', { fijo: { stance: 'banca' } });
  const car = { position: new THREE.Vector3(30, 0, -6), group: { rotation: { y: -Math.PI / 2 } }, width: 2 }; // hacia +z, encima de él
  const chasers = [{ car, speed: 6 }];
  npc.update(.05, { player: far(), chasers: [] });
  assert.equal(npc.fleeTimer, 0, 'sin patrulla sigue en lo suyo');
  npc.update(.05, { player: far(), chasers });
  assert.ok(npc.fleeTimer > 0, 'se quita');
  assert.ok(Math.abs(npc.fleeDir.z) < 1e-6 && Math.abs(npc.fleeDir.x) > .99, 'de lado, no por delante del carro');
  run(npc, 1.5, { chasers });
  assert.ok(npc.fijo.out && Math.abs(npc.position.x - 30) > 1.5, `salió del camino: ${npc.position.x}`);
});

test('la patrulla que ya pasó, va despacio o va por otro lado no le mueve a nadie; al vendedor tampoco', async () => {
  const carAt = (x, z, yaw) => ({ position: new THREE.Vector3(x, 0, z), group: { rotation: { y: yaw } }, width: 2 });
  for (const chaser of [
    { car: carAt(30, 8, -Math.PI / 2), speed: 6 },  // ya pasó
    { car: carAt(30, -6, -Math.PI / 2), speed: .5 }, // casi parada
    { car: carAt(36, -6, -Math.PI / 2), speed: 6 },  // por otra línea
    { car: carAt(30, -40, -Math.PI / 2), speed: 6 }  // lejos
  ]) {
    const npc = await person('senora', { fijo: { stance: 'banca' } });
    npc.update(.05, { player: far(), chasers: [chaser] });
    assert.equal(npc.fleeTimer, 0);
  }
  const vendor = await person('senora', { fijo: { stance: 'atender' } });
  vendor.isVendor = true;
  vendor.update(.05, { player: far(), chasers: [{ car: carAt(30, -6, -Math.PI / 2), speed: 6 }] });
  assert.equal(vendor.fleeTimer, 0);
});

test('huyendo bajo la lluvia sigue con el paraguas en la mano', async () => {
  const npc = await person('oficinista', { fijo: null });
  npc.person.paraguas = 1;
  const seen = new THREE.Vector3(30, 0, 14); // lo bastante cerca para que se anime
  npc.update(.05, { player: seen, isRaining: true });
  assert.equal(npc.umbrella.visible, true);
  npc.alarmedByTheft(new THREE.Vector3(26, 0, 2));
  run(npc, .5, { player: seen, isRaining: true });
  assert.equal(npc.moving, true);
  assert.equal(npc.character.last.stance, 'paraguas');
  assert.equal(npc.character.last.running, true);
  assert.equal(npc.umbrella.visible, true);
  // Sin lluvia, huir es huir.
  const dry = await person('oficinista', { fijo: null });
  dry.alarmedByTheft(new THREE.Vector3(26, 0, 2));
  run(dry, .5, { player: seen });
  assert.equal(dry.character.last.stance, 'huir');
});

/** Punto más bajo de la malla en coordenadas de mundo. */
function lowest(mesh) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) min = Math.min(min, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).y);
  return min;
}

test('al caer noqueado el paraguas cae al piso sin atravesarlo, y al levantarse vuelve a la mano', async () => {
  const npc = await person('oficinista', { fijo: null, groundHeight: () => .15 });
  npc.position.y = .15;
  npc.person.paraguas = 2;
  npc.update(.05, { player: far(), isRaining: true });
  const umbrella = npc.umbrella;
  const material = umbrella.material, geometry = umbrella.geometry;
  assert.ok(npc.character.holder.children.includes(umbrella));
  assert.ok(npc.takeHit({ damage: 999, attacker: { position: new THREE.Vector3(26, 0, 2) } }) !== false);
  assert.equal(umbrella.parent, npc.scene, 'ya no cuelga de la mano');
  assert.equal(umbrella.visible, true);
  const top = umbrella.position.y;
  run(npc, .5, { isRaining: true });
  assert.ok(umbrella.position.y < top, 'cayó');
  assert.equal(umbrella.visible, true, 'sigue ahí, en el piso');
  const low = lowest(umbrella);
  assert.ok(Math.abs(low - .15) < .02, `se apoya en el piso sin hundirse ni flotar: ${low}`);
  assert.ok(Math.hypot(umbrella.position.x - npc.position.x, umbrella.position.z - npc.position.z) < 1.3, 'queda a su lado');
  assert.equal(umbrella.material, material, 'sin material nuevo');
  assert.equal(umbrella.geometry, geometry, 'sin geometría nueva');
  run(npc, NPC_COMBAT.fall + NPC_COMBAT.downMin + NPC_COMBAT.downExtra + NPC_COMBAT.rise + .2, { isRaining: true });
  assert.equal(npc.koState, null);
  assert.notEqual(umbrella.parent, npc.scene, 'lo recogió');
  assert.equal(umbrella.visible, true);
  assert.equal(npc.character.last.stance, 'paraguas');
  assert.equal(npc._dropped.length, 0);
});

test('el bastón cae al piso al noquearlo, sale de la mano en los dos modelos y lo recupera al levantarse', async () => {
  const npc = await person('oficinista', { fijo: null });
  npc.person.real = { accesorios: [{ id: 'baston-calle', color: '#3a2a1a' }] };
  const other = await person('oficinista', { fijo: null });
  other.person.real = { accesorios: [{ id: 'baston-calle', color: '#3a2a1a' }] };
  run(npc, .1);
  assert.equal(npc._fallenCane, null, 'de pie no gasta nada');
  npc.takeHit({ damage: 999, attacker: { position: new THREE.Vector3(26, 0, 2) } });
  other.takeHit({ damage: 999, attacker: { position: new THREE.Vector3(26, 0, 2) } });
  const cane = npc._fallenCane;
  assert.equal(npc.lodChar.props.get('baston-calle'), false);
  assert.equal(npc.fullChar.props.get('baston-calle'), false);
  assert.equal(cane.parent, npc.scene);
  run(npc, .5);
  assert.ok(lowest(cane) >= -.001 && lowest(cane) < .06, `tendido en el piso: ${lowest(cane)}`);
  assert.equal(cane.geometry, other._fallenCane.geometry, 'geometría compartida');
  assert.equal(cane.material, other._fallenCane.material, 'material compartido');
  // El modelo completo que llega con el bastón ya en el piso tampoco lo trae en la mano.
  npc.fullChar = null;
  await npc._loadFull();
  assert.equal(npc.fullChar.props.get('baston-calle'), false);
  run(npc, NPC_COMBAT.fall + NPC_COMBAT.downMin + NPC_COMBAT.downExtra + NPC_COMBAT.rise + .2);
  assert.equal(npc.koState, null);
  assert.equal(cane.parent, null, 'lo recogió');
  assert.equal(npc.lodChar.props.get('baston-calle'), true);
  assert.equal(npc.fullChar.props.get('baston-calle'), true);
  npc.dispose();
  assert.equal(npc._fallenCane, null);
});

// ---------- lo que se le cae, con el empuje de verdad ----------

/** Cajas sólidas como las de la ciudad. */
const solids = (...boxes) => {
  const list = boxes.map(([x0, z0, x1, z1, y0 = 0, y1 = 3]) => ({ box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)) }));
  return { colliders: list, dynamicColliders: [],
    // Como en la ciudad: el cuerpo no llega a tocar lo sólido.
    resolveMove(from, _delta, radius, out) {
      if (list.some(({ box }) => out.x > box.min.x - radius && out.x < box.max.x + radius && out.z > box.min.z - radius && out.z < box.max.z + radius)) out.copy(from);
    },
    queryStatic(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    for (const entry of list) if (entry.box.max.x > minX && entry.box.min.x < maxX && entry.box.max.z > minZ && entry.box.min.z < maxZ) out.push(entry);
    return out;
  } };
};
const open = () => true;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const carrier = async (what, opts = {}) => {
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, ...opts });
  if (what === 'paraguas') {
    npc.person.paraguas = 2;
    npc.update(.05, { player: far(), isRaining: true });
  } else npc.person.real = { accesorios: [{ id: 'baston-calle', color: '#3a2a1a' }] };
  npc.target = null; npc.wait = 1e9; npc.stance = null;
  return npc;
};
const dropMesh = (npc, what) => (what === 'paraguas' ? npc.umbrella : npc._fallenCane);
/** Distancia del punto a la línea del cuerpo acostado: de los pies a la cabeza, como esté mirando. */
const toBody = (npc, mesh) => {
  const yaw = npc.root.rotation.y, bx = -Math.sin(yaw), bz = -Math.cos(yaw);
  const dx = mesh.position.x - npc.position.x, dz = mesh.position.z - npc.position.z;
  const along = Math.max(0, Math.min(1.75, dx * bx + dz * bz));
  return Math.hypot(dx - bx * along, dz - bz * along);
};
const KO = { damage: 999 };

for (const what of ['paraguas', 'baston']) test(`${what}: con cualquier empuje queda junto al cuerpo, en el piso, y ahí se queda hasta que llega la mano`, async () => {
  for (const knockback of [0, .9, 1.62, 2.88]) {
    const npc = await carrier(what);
    npc.takeHit({ ...KO, knockback, dir: { x: 1, z: 0 }, attacker: { position: new THREE.Vector3(29, 0, 2) } });
    const from = npc.position.x;
    run(npc, NPC_COMBAT.fall + .1, { isRaining: what === 'paraguas' }, 1 / 60);
    assert.ok(npc.position.x - from > knockback * .95 - .01, `el golpe lo empujó ${npc.position.x - from}`);
    const mesh = dropMesh(npc, what);
    const rest = mesh.position.clone();
    assert.ok(toBody(npc, mesh) < .55, `empuje ${knockback}: a ${toBody(npc, mesh).toFixed(2)} m del cuerpo`);
    assert.ok(Math.hypot(rest.x - npc.position.x, rest.z - npc.position.z) < .7, `al alcance: ${rest.toArray()}`);
    assert.equal(mesh.parent, npc.scene);
    // Tendido y a media subida sigue quieto en el piso: no sube solo.
    npc.koTimer = .01;
    for (let i = 0; i < 400 && (1 - smooth(npc._koBlend)) < KO_HAND_DOWN - .02; i++) {
      npc.update(1 / 60, { player: far(), isRaining: what === 'paraguas' });
      assert.ok(mesh.position.distanceTo(rest) < 1e-6, `se movió solo a ${mesh.position.toArray()}, subida ${npc._koBlend}`);
    }
    assert.equal(npc.koState, 'rising');
    // Llega la mano: cuelga de ella sin moverse de donde estaba, y en un momento queda como se lleva.
    const world = mesh.position.clone();
    npc.update(1 / 60, { player: far(), isRaining: what === 'paraguas' });
    npc.update(1 / 60, { player: far(), isRaining: what === 'paraguas' });
    assert.equal(mesh.parent, npc.character.holder, 'ya va en la mano');
    assert.equal(npc.character.grabbed, what === 'paraguas' ? 'paraguas' : 'prop-baston-calle');
    assert.ok(mesh.position.distanceTo(world) < .05, 'sin saltos al agarrarlo');
    for (let i = 0; i < 120; i++) {
      npc.update(1 / 60, { player: far(), isRaining: what === 'paraguas' });
      if (what === 'paraguas') assert.equal(mesh.visible, true, 'ya recogido no desaparece mientras se para');
    }
    assert.equal(npc.koState, null);
    assert.equal(npc._dropped.length + npc._picking.length, 0);
    if (what === 'paraguas') assert.equal(mesh.visible, true, 'sigue con él');
    else assert.equal(npc.fullChar.props.get('baston-calle'), true);
    assert.equal(mesh.parent === npc.scene, false);
    npc.dispose();
  }
});

for (const what of ['paraguas', 'baston']) test(`${what}: no queda dentro de un sólido ni en otro piso`, async () => {
  // Una caja donde caería, en cada lado: busca otro sitio y nunca el interior.
  const inside = (npc, mesh, collisions) => collisions.colliders.some(({ box }) => mesh.position.x > box.min.x && mesh.position.x < box.max.x && mesh.position.z > box.min.z && mesh.position.z < box.max.z);
  for (const side of [-1, 1]) {
    const collisions = solids([30 + side * .15, 1.7, 30 + side * 1.5, 2.6]);
    const npc = await carrier(what, { collisions });
    npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 5) } });
    run(npc, 1, {}, 1 / 60);
    const mesh = dropMesh(npc, what);
    assert.ok(!inside(npc, mesh, collisions), `lado ${side}: ${mesh.position.toArray()}`);
    assert.ok(Math.hypot(mesh.position.x - npc.position.x, mesh.position.z - npc.position.z) < .9);
  }
  // Borde de un andén alto, en el lado donde caería: se queda arriba, a la altura del cuerpo.
  for (const [edgeX, y] of [[29.6, .92], [30.4, .92]]) {
    const groundHeight = (x) => ((edgeX < 30 ? x < edgeX : x > edgeX) ? .02 : .92);
    const npc = await carrier(what, { at: [30, y, 2], groundHeight });
    npc.position.y = y;
    npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, y, 5) } });
    run(npc, 1, {}, 1 / 60);
    const mesh = dropMesh(npc, what);
    assert.ok(Math.abs(mesh.position.y - .92) < .35, `borde en ${edgeX}: quedó en y ${mesh.position.y}`);
  }
});

test('el empuje lo lleva junto a un muro: el objeto ya cae apuntando a donde va a caber, sin cambiar a medio camino', async () => {
  const collisions = solids([32.4, -5, 34, 9]); // libre donde recibe el golpe, tapado donde termina
  const npc = await carrier('paraguas', { collisions, at: [30, 0, 2] });
  npc.root.rotation.y = Math.PI / 2; // mira hacia el muro
  npc.takeHit({ ...KO, knockback: 1.62, dir: { x: 1, z: 0 }, attacker: { position: new THREE.Vector3(29, 0, 2) } });
  const drop = npc._dropped[0], aim = drop.standing.clone();
  assert.ok(Math.abs(aim.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2))) > 1, 'no apunta al muro');
  run(npc, .5, {}, 1 / 60);
  assert.ok(npc.position.x > 31.5, `lo empujó: ${npc.position.x}`);
  assert.ok(drop.standing.angleTo(aim) < 1e-6, 'y no cambió a medio camino');
});

test('el paraguas abierto que no cabe como cayó, contra un muro, queda apuntando para otro lado y no a los pies', async () => {
  const collisions = solids([20, 2.5, 40, 3.5]); // el muro a .5 m por delante
  const npc = await carrier('paraguas', { collisions, facing: 0, at: [30, 0, 2] });
  npc.root.rotation.y = 0;
  npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 1) } });
  const drop = npc._dropped[0];
  const yaw = 2 * Math.atan2(drop.standing.y, drop.standing.w);
  assert.ok(Math.abs(Math.sin(yaw)) > .9, `gira a un lado: ${yaw}`);
  assert.ok(Math.hypot(drop.x, drop.z) > .1, 'sigue a mano, no a los pies');
  run(npc, .5, {}, 1 / 60);
  assert.ok(npc.umbrella.quaternion.angleTo(drop.lying) < 1e-3, 'y así queda en el piso');
});

// ---------- caer con algo detrás ----------

const lieRoom = (npc, collisions) => {
  const yaw = npc.root.rotation.y, bx = -Math.sin(yaw), bz = -Math.cos(yaw);
  for (let d = 0; d <= 1.8; d += .1) {
    const x = npc.position.x + bx * d, z = npc.position.z + bz * d;
    if (collisions.colliders.some(({ box }) => x > box.min.x - .1 && x < box.max.x + .1 && z > box.min.z - .1 && z < box.max.z + .1)) return false;
  }
  return true;
};

test('con un muro detrás cae hacia otro lado, y el giro es de a poco', async () => {
  // Mira hacia +z: detrás, a 1 m, hay un muro largo.
  const collisions = solids([20, .9, 40, 1.4]);
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, collisions, facing: 0 });
  npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  assert.equal(npc._koPlan, 'espalda');
  let last = npc.root.rotation.y, biggest = 0;
  for (let t = 0; t < NPC_COMBAT.fall + .1; t += 1 / 60) {
    npc.update(1 / 60, { player: far() });
    biggest = Math.max(biggest, Math.abs(npc.root.rotation.y - last));
    last = npc.root.rotation.y;
  }
  assert.ok(lieRoom(npc, collisions), `acostado no entra en el muro: mira a ${npc.root.rotation.y}`);
  assert.ok(biggest < .15, `sin giros de un cuadro: ${biggest}`);
});

test('también si el empuje es el que lo lleva contra el muro', async () => {
  const collisions = solids([20, .4, 40, 1], [20, 4.6, 40, 5]);
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, collisions, facing: 0, at: [30, 0, 2.2] });
  npc.takeHit({ ...KO, knockback: 1.62, dir: { x: 0, z: -1 }, attacker: { position: new THREE.Vector3(30, 0, 3.2) } });
  run(npc, NPC_COMBAT.fall + .1, {}, 1 / 60);
  assert.ok(npc.position.z < 1.7, `el golpe lo llevó: ${npc.position.z}`);
  assert.ok(lieRoom(npc, collisions), `mira a ${npc.root.rotation.y}, en ${npc.position.toArray()}`);
});

test('sin espacio por ningún lado se escurre donde está; desde el piso no da vueltas', async () => {
  const collisions = solids([28, 1.2, 28.9, 2.8], [31.1, 1.2, 32, 2.8], [28, .8, 32, 1.2], [28, 2.8, 32, 3.2]);
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, collisions, facing: 0 });
  npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  assert.equal(npc._koPlan, 'muro');
  const near = () => new THREE.Vector3(npc.position.x + 15, 0, npc.position.z);
  run(npc, .3, { player: near() });
  assert.equal(npc.character.last.koPlan, 'muro', 'el cuerpo sabe cómo cae');
  const low = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, collisions: solids([20, .9, 40, 1.4]), facing: 0 });
  low.stance = 'sentado';
  low.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  assert.equal(low._koPlan, 'muro-bajo');
  assert.equal(low._koTurn, null);
  const free = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, facing: 0 });
  free.stance = 'sentado';
  free.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  assert.equal(free._koPlan, 'bajo');
  run(free, .2, { player: new THREE.Vector3(45, 0, 2) });
  assert.equal(free.character.last.koFrom, 'sentado', 'el cuerpo sabe desde dónde cae');
  // Lejos los demás congelan la animación; quien cae, no: si no, se quedaría de pie.
  const distant = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, facing: 0 });
  distant.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  run(distant, .3, { player: far() });
  assert.ok(distant.character.last.ko > 0, 'lejos también se ve caer');
});

test('un andén que se acaba detrás cuenta como no tener espacio', async () => {
  const groundHeight = (_x, z) => (z < 1.5 ? .02 : .92);
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, groundHeight, facing: 0, at: [30, .92, 2.2] });
  npc.position.y = .92;
  npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, .92, 4) } });
  run(npc, NPC_COMBAT.fall + .1, {}, 1 / 60);
  const yaw = npc.root.rotation.y;
  for (let d = 0; d <= 1.8; d += .2) assert.ok(groundHeight(0, npc.position.z - Math.cos(yaw) * d) > .9, `cuerpo sobre el andén: mira a ${yaw}`);
});

// ---------- lo que no detiene a nadie también ocupa sitio ----------

/** Calle con una banca, un bolardo, una zorra... solo para quien cae: nadie choca con ellos. */
const roomFor = (...boxes) => {
  const collisions = new CollisionSystem();
  for (const [x0, z0, x1, z1, y0 = 0, y1 = 1] of boxes) collisions.addFallObstacle(x0, z0, x1, z1, y0, y1);
  return collisions;
};
/** Puntos del cuerpo acostado, con un brazo de cada lado. */
const lying = npc => {
  const yaw = npc.root.rotation.y, bx = -Math.sin(yaw), bz = -Math.cos(yaw), out = [];
  for (let d = 0; d <= 1.8; d += .1) for (const side of [-.38, 0, .38]) out.push([npc.position.x + bx * d - bz * side, npc.position.z + bz * d + bx * side]);
  return out;
};
// La prueba mira las cajas directamente: si la consulta del juego dejara de verlas, el cuerpo caería dentro y aquí se notaría.
const inside = (points, collisions) => {
  const boxes = [...collisions.queryFallObstacles(0, -10, 60, 20, []), ...collisions.dynamicColliders];
  return points.filter(([x, z]) => boxes.some(({ box }) => x > box.min.x && x < box.max.x && z > box.min.z && z < box.max.z));
};
const knockedDown = async (collisions, { at = [30, 0, 2], ...extra } = {}, hit = {}) => {
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, collisions, facing: 0, at, ...extra });
  npc.position.set(...at);
  npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(at[0], 0, at[2] + 1) }, ...hit });
  run(npc, NPC_COMBAT.fall + .2, {}, 1 / 60);
  return npc;
};

for (const [name, box] of [['una banca', [28.5, 1, 31.5, 1.5, 0, .9]], ['un bolardo', [29.9, .8, 30.1, 1, .12, .98]], ['una zorra', [29, -.5, 31, 1, 0, 1.3]]]) {
  test(`con ${name} detrás cae hacia otro lado`, async () => {
    const collisions = roomFor(box), npc = await knockedDown(collisions);
    assert.equal(npc._koPlan, 'espalda');
    assert.deepEqual(inside(lying(npc), collisions), [], `mira a ${npc.root.rotation.y}`);
  });
}

test('con un carro parqueado detrás o al lado no se acuesta dentro de él, ni con un brazo', async () => {
  const car = (x, z, yaw = 0) => ({ position: new THREE.Vector3(x, 0, z), group: { rotation: { y: yaw } }, length: 4.3, width: 1.8 });
  // De frente, de costado y a lo largo del cuerpo: en este último solo el brazo llegaría a la puerta.
  for (const parked of [car(30, .2), car(32.2, 1.4, Math.PI / 2), car(30.4, -.6, Math.PI / 2), car(31.2, -.5, Math.PI / 2)]) {
    const collisions = new CollisionSystem();
    collisions.setVehicles([parked]);
    const npc = await knockedDown(collisions);
    assert.deepEqual(inside(lying(npc), collisions), [], `mira a ${npc.root.rotation.y}`);
  }
});

test('un sardinel detrás cuenta como que el piso se acaba, sin que una pendiente suave moleste', async () => {
  const curb = (_x, z) => (z < 1.2 ? 0 : .12);
  const npc = await knockedDown(new CollisionSystem(), { groundHeight: curb, at: [30, .12, 2] });
  const yaw = npc.root.rotation.y;
  for (let d = 0; d <= 1.8; d += .1) assert.equal(curb(0, npc.position.z - Math.cos(yaw) * d), .12, `no queda atravesado: mira a ${yaw}`);
  const slope = await knockedDown(new CollisionSystem(), { groundHeight: (_x, z) => z * .08, at: [30, .16, 2] });
  assert.equal(slope._koPlan, 'espalda');
  assert.equal(slope._koTurn, null);
  assert.ok(Math.abs(wrap(slope.root.rotation.y)) < .01, 'sigue de espaldas en la pendiente');
});

test('sin sitio para acostarse se escurre mirando hacia donde le caben las piernas', async () => {
  // Abierto solo hacia +x: un pasillo corto, tapado a 1,2 m.
  const collisions = roomFor([28, .5, 31.3, 1.3], [28, 2.7, 31.3, 3.5], [28, 1.3, 29.1, 2.7], [31.4, 1, 32, 3]);
  const npc = await knockedDown(collisions);
  assert.equal(npc._koPlan, 'muro');
  const yaw = npc.root.rotation.y;
  for (let d = .2; d <= .85; d += .05) {
    assert.deepEqual(inside([[npc.position.x + Math.sin(yaw) * d, npc.position.z + Math.cos(yaw) * d]], collisions), [], `piernas hacia ${yaw}`);
  }
});

test('desde el piso no gira, aunque se escurra', async () => {
  const collisions = roomFor([28.5, 1, 31.5, 1.5, 0, .9]);
  const low = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, collisions, facing: 0 });
  low.stance = 'sentado';
  low.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  assert.equal(low._koPlan, 'muro-bajo');
  assert.equal(low._koTurn, null);
});

test('el empuje se queda antes de lo que no detiene a nadie, y deja irse a quien estaba pegado', async () => {
  const collisions = roomFor([29, -.4, 31, 0, 0, .9]);
  const npc = await knockedDown(collisions, {}, { knockback: 2.88, dir: { x: 0, z: -1 } });
  assert.ok(npc.position.z > .2, `no entró: ${npc.position.z}`);
  assert.ok(npc.position.z < 1.6, `pero el golpe lo movió: ${npc.position.z}`);
  const away = await knockedDown(roomFor([29, 2.1, 31, 2.5, 0, .9]), {}, { knockback: 1, dir: { x: 0, z: -1 } });
  assert.ok(away.position.z < 1.2, `se va: ${away.position.z}`);
});

test('ni el bastón ni el paraguas quedan dentro de lo que ocupa sitio', async () => {
  const npc = await carrier('baston', { collisions: roomFor([29, 1, 31, 3, 0, .9]) });
  assert.equal(npc._dropFits(npc.position, 30, 2, 30, 2.5), false, 'dentro de la banca');
  assert.equal(npc._dropFits(npc.position, 33, 2, 33, 2.5), true, 'al lado cabe');
});

test('un segundo KO no hereda dónde terminó el primero', async () => {
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, facing: 0 });
  npc.takeHit({ ...KO, knockback: 2, dir: { x: 1, z: 0 }, attacker: { position: new THREE.Vector3(29, 0, 2) } });
  assert.ok(npc._koEnd, 'miró dónde iba a terminar');
  npc._koEnd.set(999, 999, 999);
  npc.koState = null;
  npc.health = 0;
  npc._riseLeft = 1;
  npc._lowFrom = 'dormido';
  npc._startKnockout(false);
  assert.equal(npc._koPlan, 'dormido');
  assert.equal(npc._koEnd, null, 'dormido no vuelve a mirar: no le queda el dato viejo');
});

test('quien se paraba de una banca sigue en ella si lo noquean', async () => {
  const npc = await person('senora', { fijo: null, navigation: null, isWalkable: open, facing: 0, collisions: roomFor([29, 1.8, 31, 2.2, 0, .9]) });
  npc._riseLeft = .2;
  npc._lowFrom = 'banca';
  npc.takeHit({ ...KO, knockback: 2, dir: { x: 1, z: 0 }, attacker: { position: new THREE.Vector3(29, 0, 2) } });
  assert.equal(npc._koPlan, 'banca');
  const { x } = npc.position;
  run(npc, NPC_COMBAT.fall, {}, 1 / 60);
  assert.equal(npc.position.x, x, 'el golpe no lo saca de la banca');
});

// ---------- paraguas al recogerlo ----------

test('el paraguas va cerrado en la mano hasta que el brazo sube, y al terminar queda como estaba', async () => {
  const npc = await carrier('paraguas');
  npc.update(1 / 60, { player: far(), isRaining: true });
  const umbrella = npc.umbrella, open = umbrella.scale.x;
  assert.equal(umbrella.scale.x, umbrella.scale.y);
  npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  run(npc, NPC_COMBAT.fall + .1, { isRaining: true }, 1 / 60);
  assert.ok(Math.abs(umbrella.scale.x / umbrella.scale.y - 1) < 1e-6, 'en el piso sigue abierto');
  npc.koTimer = 0;
  let narrowest = 1, wideLow = 0, sawStick = false;
  while (npc.koState) {
    npc.update(1 / 60, { player: far(), isRaining: true });
    if (umbrella.parent === npc.scene) continue;
    const width = umbrella.scale.x / umbrella.scale.y, up = 1 - smooth(npc._koBlend);
    narrowest = Math.min(narrowest, width);
    sawStick ||= umbrella.children.some(child => child.visible && Math.abs(child.scale.x * width - 1) < 1e-6);
    if (up > .72 && up < .92) wideLow = Math.max(wideLow, width);
  }
  assert.ok(narrowest < .2, `se cierra: ${narrowest}`);
  assert.ok(sawStick, 'cerrado se le ve el palo');
  assert.ok(wideLow < .2, `con el brazo abajo sigue cerrado: ${wideLow}`);
  npc.update(1 / 60, { player: far(), isRaining: true });
  assert.ok(Math.abs(umbrella.scale.x / umbrella.scale.y - 1) < 1e-6, 'de pie, abierto');
  assert.equal(umbrella.children.length, 0, 'de pie, sin el palo');
  assert.equal(umbrella.visible, true);
});

for (const when of ['mientras lo agarra', 'ya en la mano']) test(`si cambia de modelo ${when} el paraguas no desaparece`, async () => {
  const npc = await carrier('paraguas');
  npc.update(1 / 60, { player: far(), isRaining: true });
  const umbrella = npc.umbrella, near = npc.position.clone().add(new THREE.Vector3(2, 0, 0));
  await npc._loadFull();
  npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  run(npc, NPC_COMBAT.fall + .1, { isRaining: true, player: near }, 1 / 60);
  npc.koTimer = 0;
  while (!npc._picking.length) npc.update(1 / 60, { player: near, isRaining: true });
  if (when === 'ya en la mano') while (npc._picking.length) npc.update(1 / 60, { player: near, isRaining: true });
  const before = npc.character;
  const other = before === npc.fullChar ? npc.lodChar : npc.fullChar;
  npc._show(other);
  assert.equal(npc._picking.length, 0);
  npc.update(1 / 60, { player: before === npc.fullChar ? far() : near, isRaining: true });
  npc._show(other);
  npc.update(1 / 60, { player: far(), isRaining: true });
  assert.equal(umbrella.visible, true, 'sigue en la mano');
  assert.notEqual(umbrella.parent, npc.scene);
  assert.ok(npc.character.holder.children.includes(umbrella), 'en la mano del modelo que se ve');
  assert.ok(umbrella.scale.x / umbrella.scale.y < .2, 'y sigue cerrado');
});

test('contra un muro la mano recoge lo caído al empezar a pararse, cuando está en el piso', async () => {
  const collisions = solids([28, 1.2, 28.9, 2.8], [31.1, 1.2, 32, 2.8], [28, .8, 32, 1.2], [28, 2.8, 32, 3.2]);
  const npc = await carrier('baston', { collisions });
  npc.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  run(npc, NPC_COMBAT.fall + .2, {}, 1 / 60);
  assert.equal(npc._koPlan, 'muro');
  npc.koTimer = 0;
  while (npc.koState && !npc._picking.length) npc.update(1 / 60, { player: far() });
  assert.ok(1 - smooth(npc._koBlend) < .1, `lleva ${1 - smooth(npc._koBlend)} de la subida`);
});

// ---------- agua ----------

test('huyendo no entra al agua aunque la baldosa se pueda pisar', async () => {
  const getWaterInfo = (x) => (x > 32 ? { surfaceY: -.18, bottomY: -.4 } : null);
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, facing: 0, getWaterInfo, groundHeight: x => (x > 32 ? -.3 : 0) });
  npc.takeHit({ damage: 5, dir: { x: 1, z: 0 }, attacker: { position: new THREE.Vector3(29, 0, 2) } });
  npc.fleeDir.set(1, 0, 0);
  for (let i = 0; i < 300; i++) { npc.fleeTimer = 5; npc.update(1 / 60, { player: far() }); assert.ok(npc.position.x <= 32, `entró: ${npc.position.x}`); }
  const bridge = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, facing: 0, getWaterInfo, groundHeight: () => 2 });
  bridge.position.y = 2;
  bridge.takeHit({ damage: 5, dir: { x: 1, z: 0 }, attacker: { position: new THREE.Vector3(29, 2, 2) } });
  bridge.fleeDir.set(1, 0, 0);
  for (let i = 0; i < 240; i++) { bridge.fleeTimer = 5; bridge.update(1 / 60, { player: far() }); }
  assert.ok(bridge.position.x > 32, 'por un puente sobre el agua sí pasa');
});

test('noqueado en la banca sigue en ella, y dormido se queda dormido', async () => {
  const bench = await person('senora', { fijo: { stance: 'banca' }, facing: 0 });
  bench.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  assert.equal(bench._koPlan, 'banca');
  const yaw = bench.root.rotation.y;
  run(bench, NPC_COMBAT.fall + .1);
  assert.equal(bench.root.rotation.y, yaw, 'tampoco gira para caer');
  run(bench, NPC_COMBAT.downMin + NPC_COMBAT.downExtra + NPC_COMBAT.rise + .2);
  assert.equal(bench.koState, null);
  const asleep = await person('habitante', { fijo: { stance: 'dormido' }, facing: 0 });
  asleep.takeHit({ ...KO, attacker: { position: new THREE.Vector3(30, 0, 4) } });
  assert.equal(asleep._koPlan, 'dormido');
});

// ---------- huir en un rincón ----------

/** Un rincón: muro al frente y a un lado, abierto por donde vino. */
const corner = () => solids([31, -2, 33, 8], [20, 6, 33, 8]);
const spinOf = (npc, seconds) => {
  let spin = 0, last = npc.root.rotation.y;
  for (let t = 0; t < seconds; t += 1 / 60) {
    npc.update(1 / 60, { player: far() });
    spin += Math.abs(npc.root.rotation.y - last);
    last = npc.root.rotation.y;
  }
  return spin;
};

test('en un rincón deja de rebotar: al segundo bloqueo toma una ruta por la red', async () => {
  const navigation = street();
  const npc = await person('oficinista', { fijo: null, navigation, collisions: corner(), at: [29.5, 0, 4.5] });
  npc.target = null; npc.wait = 1e9; npc.stance = null;
  const route = mock.method(navigation, 'createRoute');
  npc.alarmedByTheft(new THREE.Vector3(28, 0, 3.5));
  const spin = spinOf(npc, 8);
  assert.ok(route.mock.callCount() > 0, 'pidió ruta');
  assert.ok(spin < 12, `no da vueltas en el sitio: ${spin.toFixed(1)} rad`);
  assert.equal(npc.koState, null);
  assert.equal(npc._cowering, false);
  assert.ok(npc.target === null, 'al acabar la huida no le queda la ruta');
});

test('si la ruta le pasa por encima de algo sólido no lo atraviesa: se agacha ahí', async () => {
  const collisions = solids([29, .8, 30, 2]); // una columna en el camino
  const navigation = { nodes: [], nodeAt: () => -1, createRoute: () => [new THREE.Vector3(29.5, 0, 0)], routeTo: () => [] };
  const npc = await person('oficinista', { fijo: null, navigation, isWalkable: open, collisions, at: [29.5, 0, 4.5] });
  npc.target = null; npc.wait = 1e9; npc.stance = null; npc.person.style = {};
  npc.alarmedByTheft(new THREE.Vector3(29.5, 0, 5));
  assert.equal(npc._startFleeRoute(), true);
  for (let t = 0; t < 3; t += 1 / 60) {
    npc.update(1 / 60, { player: far() });
    const { x, z } = npc.position;
    assert.ok(!(x > 29 && x < 30 && z > .8 && z < 2), `dentro de la columna: ${x}, ${z}`);
  }
  assert.equal(npc._cowering, true);
});

test('sin red ni ruta se agacha a esperar, y al pasársele el susto se para antes de andar', async () => {
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open, collisions: corner(), at: [29.5, 0, 4.5] });
  npc.target = null; npc.wait = 1e9; npc.stance = null;
  npc.person.style = {}; // con las manos libres
  npc.alarmedByTheft(new THREE.Vector3(28, 0, 3.5));
  const spin = spinOf(npc, 7.9);
  assert.ok(spin < 12, `${spin.toFixed(1)} rad`);
  assert.equal(npc._cowering, true);
  assert.ok(LOW_STANCES.has(npc.stance), npc.stance);
  assert.equal(npc.moving, false);
  const here = npc.position.clone();
  run(npc, .25, {}, 1 / 60);
  assert.equal(npc._cowering, false);
  assert.equal(npc.stance, null);
  assert.ok(npc._riseLeft > 0, 'se está parando');
  assert.ok(npc.position.distanceTo(here) < 1e-6, 'sin deslizarse');
});

test('otro susto al que está agachado lo para de afán y sale corriendo', async () => {
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open });
  npc.target = null; npc.wait = 1e9;
  npc.person.style = {}; // con las manos libres: se agacha
  npc._cower();
  npc.fleeTimer = 5;
  npc.update(1 / 60, { player: far() });
  npc.alarmedByTheft(new THREE.Vector3(29, 0, 2));
  npc.update(1 / 60, { player: far() });
  assert.equal(npc._cowering, false);
  assert.ok(npc._riseLeft > 0);
  run(npc, RISE_TIME + .1, {}, 1 / 60);
  assert.equal(npc.moving, true);
});

test('quien carga algo en la mano no se abraza las rodillas: espera de pie', async () => {
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open });
  npc.person.style = { carry: 'izquierda' };
  npc.fleeTimer = 5;
  npc._cower();
  assert.ok(!LOW_STANCES.has(npc.stance), npc.stance);
  run(npc, 5.1, {}, 1 / 60);
  assert.equal(npc.stance, null);
  assert.equal(npc._riseLeft, 0, 'no estaba abajo: no tiene de dónde pararse');
});

// ---------- esperar, y salir de la banca ----------

test('el fijo que espera a que te vayas cambia de postura; nunca se sienta', async () => {
  const npc = await person('oficinista', { fijo: { stance: 'brazos-cruzados', alternas: ['hablar', 'sentado'] } });
  npc.alarmedByTheft(new THREE.Vector3(26, 0, 2));
  const player = new THREE.Vector3(26, 0, 2);
  run(npc, 8.5, { player });
  const seen = new Set();
  for (let t = 0; t < 120; t += .25) {
    player.set(npc.position.x + 3, 0, npc.position.z);
    npc.update(.25, { player });
    assert.equal(npc.fijo.out, true);
    if (!npc.target) seen.add(npc.stance);
  }
  assert.ok(seen.has('hablar'), 'sus alternas');
  assert.ok(!seen.has('sentado'), 'nada de sentarse a esperar');
  const wait = await person('oficinista', { fijo: { stance: 'brazos-cruzados' } });
  wait.alarmedByTheft(new THREE.Vector3(26, 0, 2));
  run(wait, 8.5, { player });
  const other = new Set();
  for (let t = 0; t < 400; t += .25) { player.set(wait.position.x + 3, 0, wait.position.z); wait.update(.25, { player }); if (!wait.target) other.add(wait.stance); }
  assert.ok(other.size >= 3, `varias: ${[...other]}`);
});

test('de la banca no sale por el lado que tiene una caja, aunque le quede mejor', async () => {
  for (const preferred of [-1, 1]) {
    // De frente el susto, un poco de lado: el lado por el que prefiere salir es `preferred`.
    const collisions = solids([30 - preferred * .25 - (preferred > 0 ? 2 : 0), 2.5, 30 - preferred * .25 + (preferred > 0 ? 0 : 2), 4.5]);
    const npc = await person('senora', { fijo: { stance: 'banca', facing: 0 }, facing: 0, at: [30, 0, 3], collisions });
    npc.fijo.facing = 0;
    npc.alarmedByTheft(new THREE.Vector3(30 + preferred * .3, 0, 4));
    let inside = 0;
    for (let t = 0; t < 1.5; t += 1 / 60) {
      npc.update(1 / 60, { player: far() });
      const { x, z } = npc.position;
      if (collisions.colliders.some(({ box }) => x > box.min.x && x < box.max.x && z > box.min.z && z < box.max.z)) inside++;
    }
    assert.equal(inside, 0, `lado ${preferred}`);
    assert.equal(npc._blocks, 0, `lado ${preferred}: ni se topó con la caja, la vio antes de salir`);
    assert.ok((npc.position.x - 30) * -preferred > .05 || npc.position.z > 3.1, `salió por el otro lado: ${npc.position.toArray()}`);
  }
});

// ---------- cambiar de modelo a media subida ----------

for (const [name, scare] of [
  ['popó de lejos', npc => npc.hitByPoop(new THREE.Vector3(npc.position.x + 3, 0, npc.position.z))],
  ['la pareja de alguien asustado', npc => { npc.fijo.pareja = { fijo: { out: false }, koState: null, _fleeFrom() {} }; npc._fleeFrom(new THREE.Vector3(npc.position.x + 1, 0, npc.position.z)); }],
  ['el esquive de una patrulla', (npc, ctx) => { ctx.chasers = [{ car: { position: new THREE.Vector3(npc.position.x, 0, npc.position.z - 6), group: { rotation: { y: -Math.PI / 2 } }, width: 2 }, speed: 6 }]; }]
]) test(`${name}: a 5 m cambia de modelo sin pararse de golpe`, async () => {
  const npc = await person('habitante', { fijo: { stance: 'dormido' }, facing: 0 });
  const player = new THREE.Vector3(npc.position.x + 5, 0, npc.position.z);
  const ctx = { player };
  npc.update(.05, ctx);
  assert.equal(npc.character, npc.lodChar, 'quieto a 5 m sigue liviano');
  const lod = npc.lodChar, full = npc.fullChar;
  const snaps = full.snaps;
  scare(npc, ctx);
  npc.update(1 / 60, ctx);
  assert.ok(npc.fleeTimer > 0, 'se asustó');
  assert.equal(npc.fijo.out, true);
  assert.equal(npc.character, full, 'ya es el modelo completo');
  assert.equal(full.motions.at(-1).from, lod, 'sigue desde donde iba');
  assert.equal(full.snaps, snaps, 'sin entrar de una en la postura');
  assert.equal(full.last.rising, true, 'se para a su ritmo');
});

test('quien cambió de postura sin que nadie lo viera sí aparece con ella puesta', async () => {
  const npc = await person('oficinista', { fijo: null, navigation: null, isWalkable: open });
  const lod = npc.lodChar, full = npc.fullChar;
  npc.update(.05, { player: far() });
  npc.animAcc = 2; // llevaba rato fuera de cámara
  const snaps = full.snaps;
  npc.update(.05, { player: new THREE.Vector3(npc.position.x + 2, 0, npc.position.z) });
  assert.equal(npc.character, full);
  assert.equal(full.snaps, snaps + 1);
  assert.notEqual(lod, full);
});

test('quien sigue en su sitio cambia de modelo más cerca que quien anda; asustado cuenta como cualquiera', async () => {
  const fixed = await person('oficinista', { fijo: { stance: 'brazos-cruzados' } });
  const walker = await person('oficinista', { fijo: null });
  const near = (npc, d) => new THREE.Vector3(npc.position.x + d, 0, npc.position.z);
  for (const npc of [fixed, walker]) npc.update(.05, { player: near(npc, 5) });
  assert.equal(fixed.character, fixed.lodChar, 'a 5 m el fijo sigue en liviano');
  assert.equal(walker.character, walker.fullChar, 'a 5 m el caminante ya es completo');
  fixed.update(.05, { player: near(fixed, NPC_LOD.fixedIn - .5) });
  assert.equal(fixed.character, fixed.fullChar);
  fixed.update(.05, { player: near(fixed, NPC_LOD.fixedOut - .5) });
  assert.equal(fixed.character, fixed.fullChar, 'histéresis');
  fixed.update(.05, { player: near(fixed, NPC_LOD.fixedOut + .5) });
  assert.equal(fixed.character, fixed.lodChar);
  fixed.alarmedByTheft(near(fixed, 1));
  fixed.update(.05, { player: near(fixed, 5) });
  assert.equal(fixed.fijo.out, true);
  assert.equal(fixed.character, fixed.fullChar, 'fuera de su sitio usa los umbrales de todos');
});

test('el celular de quien sigue en su sitio no se atrasa con el modelo: se ve a la misma distancia que antes', async () => {
  const npc = await person('oficinista', { fijo: { stance: 'celular' } });
  npc.fullChar = null; // todavía nadie se le ha acercado
  npc.update(.05, { player: new THREE.Vector3(npc.position.x + 5, 0, npc.position.z) });
  assert.equal(npc.character, npc.lodChar);
  assert.equal(npc.phone?.visible, true);
  assert.equal(npc.character.holder.children.includes(npc.phone), true);
  npc.update(.05, { player: new THREE.Vector3(npc.position.x + 9, 0, npc.position.z) });
  assert.equal(npc.phone.visible, false);
  // Un caminante que no tiene su modelo completo no lo saca (lejos ni lo anima).
  const walker = await person('oficinista', { fijo: null, stance: 'celular' });
  walker.stance = 'celular';
  walker.update(.05, { player: new THREE.Vector3(walker.position.x + 12, 0, walker.position.z) });
  assert.equal(walker.character, walker.lodChar);
  assert.equal(walker.phone, null);
});

test('el modelo que entra sigue en el mismo punto del paso y se anima en ese mismo cuadro', async () => {
  const npc = await person('oficinista', { fijo: null, navigation: street() });
  const lod = npc.lodChar, full = npc.fullChar;
  npc.update(.05, { player: far() });
  assert.equal(npc.character, lod);
  // Con presupuesto de animación todavía no le tocaba animarse a nadie.
  npc.animAcc = 0;
  const updates = full.updates ?? 0;
  npc.update(.001, { player: new THREE.Vector3(npc.position.x + 2, 0, npc.position.z), animationBudget: 4 });
  assert.equal(npc.character, full);
  assert.equal(full.motions.length, 1);
  assert.equal(full.motions[0].from, lod);
  assert.equal(full.updates, updates + 1, 'sin un cuadro en la pose de reposo');
  // Y el siguiente cuadro vuelve a respetar el presupuesto.
  npc.update(.001, { player: new THREE.Vector3(npc.position.x + 2, 0, npc.position.z), animationBudget: 4 });
  assert.equal(full.updates, updates + 1);
});

test('ninguna persona lejana actualiza matrices de mundo en su cuadro', async () => {
  const npc = await person('oficinista', { fijo: null });
  for (const distance of [3, 15, 30, 60]) {
    const spy = [mock.method(THREE.Object3D.prototype, 'updateMatrixWorld'), mock.method(THREE.Object3D.prototype, 'updateWorldMatrix')];
    for (let i = 0; i < 20; i++) npc.update(.05, { player: new THREE.Vector3(npc.position.x + distance, 0, npc.position.z) });
    const calls = spy.reduce((sum, method) => sum + method.mock.callCount(), 0);
    for (const method of spy) method.mock.restore();
    assert.equal(calls, 0, `a ${distance} m`);
  }
});

test('con un arma en la mano el jugador solo mira y cambia de peso', () => {
  const allowed = new Set(['mirar-izquierda', 'mirar-derecha', 'cambiar-peso']);
  const seen = new Set();
  for (const state of [{}, { cold: true }, { hungry: true }, { raining: true }, { tired: true }]) {
    for (let roll = 0; roll < 1; roll += .01) seen.add(pickGesture({ ...state, armed: true }, () => roll));
  }
  assert.deepEqual([...seen].sort(), [...allowed].sort());
  const bare = new Set();
  for (let roll = 0; roll < 1; roll += .01) bare.add(pickGesture({}, () => roll));
  assert.ok(bare.has('brazos-cruzados') && bare.has('rascarse'), 'con las manos libres sigue teniendo todos');
});

/** Lo mínimo de un jugador para que corra su lenguaje corporal. */
function bodyOf({ raining = false, roofed = false, weapon = 'punos' } = {}) {
  const player = Object.create(Player.prototype);
  Object.assign(player, {
    stats: { energia: 100, hambre: 100 }, position: new THREE.Vector3(75, 1, -16), speed: 0, action: null,
    bodyStyle: { stoop: 0, headDown: 0, swing: 1 }, gesture: null, _gestureLeft: 0, _stillTime: 0, _gestureDelay: 6, equippedWeapon: weapon,
    game: { weather: { isRaining: raining }, world: { active: { isRoofedAt: () => roofed } } }
  });
  return player;
}

test('bajo techo no se encoge aunque llueva afuera; en la calle sí', () => {
  const street = bodyOf({ raining: true });
  assert.equal(street._updateBodyLanguage(.1, false), 'encogido');
  assert.ok(street.bodyStyle.stoop > 0);
  const roofed = bodyOf({ raining: true, roofed: true });
  assert.equal(roofed._updateBodyLanguage(.1, false), null);
  assert.equal(roofed.bodyStyle.stoop, 0);
  assert.equal(roofed.bodyStyle.headDown, 0);
});

test('con arma no se encoge, y sacarla corta el gesto que tenga las manos ocupadas', () => {
  const armed = bodyOf({ raining: true, weapon: 'cuchillo' });
  assert.equal(armed._updateBodyLanguage(.1, false), null);
  const player = bodyOf();
  player.gesture = 'brazos-cruzados';
  player._gestureLeft = 3;
  assert.equal(player._updateBodyLanguage(.1, false), 'brazos-cruzados');
  player.equippedWeapon = 'cuchillo';
  assert.equal(player._updateBodyLanguage(.1, false), null);
  player.gesture = 'mirar-derecha';
  player._gestureLeft = 3;
  assert.equal(player._updateBodyLanguage(.1, false), 'mirar-derecha', 'mirar no estorba');
});

test('robarle a quien está en el piso no le deja defenderse; de pie, el adulto sí', () => {
  const stats = { salud: 100, dinero: 0 };
  const game = { player: { position: new THREE.Vector3() }, stats, world: { active: { npcs: [] } }, input: { consumePress: () => false }, interaction: {}, paused: false };
  const steal = new StealSystem(game);
  for (const stance of LOW_STANCES) {
    steal.executeRoboDirecto({ position: new THREE.Vector3(1, 0, 0), stance, look: { real: { edad: 'adulto' } } });
    assert.equal(stats.salud, 100, `${stance} no se defiende`);
  }
  steal.executeRoboDirecto({ position: new THREE.Vector3(1, 0, 0), stance: null, look: { real: { edad: 'adulto' } } });
  assert.ok(stats.salud < 100);
});

async function driver() {
  const npc = new AngryDriver(new THREE.Scene(), { isWalkable: () => true, groundHeight: () => 0 });
  await npc.ready;
  npc.position.set(0, 0, 0);
  npc.state = 'chase';
  npc.timer = 0;
  npc.attackTimer = 0;
  return npc;
}
const door = new THREE.Vector3(-10, 0, 0);

test('al conductor noqueado se le cae la varilla al piso, y la recoge cuando la mano llega', async () => {
  const npc = await driver();
  const pivot = npc.bar.pivot, rod = pivot.children[0];
  rod.geometry.computeBoundingBox();
  npc._walk(.01);
  const hanging = { position: pivot.position.clone(), tilt: pivot.rotation.x };
  const lowest = () => {
    npc.root.updateMatrixWorld(true);
    const { min, max } = rod.geometry.boundingBox;
    return Math.min(rod.localToWorld(new THREE.Vector3(0, min.y, 0)).y, rod.localToWorld(new THREE.Vector3(0, max.y, 0)).y);
  };
  const highest = () => {
    npc.root.updateMatrixWorld(true);
    const { min, max } = rod.geometry.boundingBox;
    return Math.max(rod.localToWorld(new THREE.Vector3(0, min.y, 0)).y, rod.localToWorld(new THREE.Vector3(0, max.y, 0)).y);
  };
  npc.state = 'windup';
  npc._walk(.2);
  npc.takeHit({ damage: 9999, attacker: { position: new THREE.Vector3(0, 0, 1) } });
  npc.think(.01, { player: far(), door, canChase: true }); // el golpe que traía se le cayó
  let last = pivot.position.y, jump = 0;
  for (let t = 0; t < NPC_COMBAT.fall + .05; t += 1 / 60) {
    npc.update(1 / 60, { player: far() });
    assert.ok(lowest() > -.03, `no atraviesa el piso: ${lowest()}`);
    jump = Math.max(jump, Math.abs(pivot.position.y - last));
    last = pivot.position.y;
  }
  assert.ok(jump < .12, `baja sin saltos: ${jump}`);
  assert.ok(highest() < .1, `tendido, la varilla está en el piso: ${highest()}`);
  npc.koTimer = 0;
  npc.update(1 / 60, { player: far() });
  while (1 - smooth(npc._koBlend) < .5) { npc.update(1 / 60, { player: far() }); assert.ok(highest() < .1, 'espera a la mano'); }
  while (npc.koState) { npc.update(1 / 60, { player: far() }); assert.ok(lowest() > -.03); }
  npc.update(1 / 60, { player: far() });
  assert.ok(pivot.position.distanceTo(hanging.position) < 1e-6, 'vuelve a colgar de su sitio');
  assert.ok(Math.abs(pivot.rotation.x - hanging.tilt) < 1e-6);
});

test('el conductor noqueado no piensa: ni corre, ni gira, ni termina el golpe que traía', async () => {
  const npc = await driver();
  npc.canReach = () => true;
  const player = new THREE.Vector3(1, 0, 0);
  assert.equal(npc.think(.05, { player, door, canChase: true }), 'swing');
  assert.equal(npc.state, 'windup');
  npc.takeHit({ damage: 9999, attacker: { position: player } });
  assert.ok(npc.koState);
  const position = npc.position.clone(), yaw = npc.root.rotation.y, timer = npc.timer;
  const results = [];
  for (let i = 0; i < 40; i++) results.push(npc.think(.05, { player: player.clone().add(new THREE.Vector3(0, 0, 3)), door, canChase: true }));
  assert.deepEqual(new Set(results), new Set([null]), 'tendido no pega');
  assert.equal(npc.state, 'chase', 'el golpe que traía se le cayó');
  assert.equal(npc.action, null);
  assert.deepEqual(npc.position.toArray(), position.toArray());
  assert.equal(npc.root.rotation.y, yaw);
  assert.equal(npc.timer, timer);
});

test('al conductor bravo el golpe no lo pone a correr como si huyera', async () => {
  const npc = await driver();
  const player = new THREE.Vector3(6, 0, 0);
  npc.fullChar = character();
  npc.takeHit({ damage: 5, attacker: { position: player } });
  npc._hitReactionRemaining = 0;
  npc.staggerTimer = 0;
  npc.update(.05, { player });
  assert.equal(npc.fleeTimer, 0);
  npc.moving = true;
  npc.update(.05, { player });
  assert.notEqual(npc.character.last?.stance, 'huir');
  assert.equal(npc.character.last?.running, false);
});
