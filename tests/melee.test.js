import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { Npc } from '../src/entities/Npc.js';
import { WEAPONS, comboStep, COMBO_WINDOW } from '../src/data/weapons.js';
import { ITEMS, isUsable } from '../src/data/items.js';
import { RECIPES } from '../src/data/recipes.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { attackExtension, createMeleeOverlay } from '../src/character/melee.js';
import { attachWeapon } from '../src/character/props.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { className: '', textContent: '', style: {}, remove() {} }; },
    body: { appendChild() {} }
  };
});

function makeInput() {
  const input = {
    axis: { x: 0, z: 0 },
    isRunning: false,
    presses: new Set(),
    consumePress(key) {
      if (key === 'KeyG' && input.presses.has('KeyG')) { input.presses.delete('KeyG'); return true; }
      return false;
    },
    isDown() { return false; }
  };
  return input;
}

function makeAudio() {
  const audio = { whoosh: 0, hit: 0, playWhoosh() { audio.whoosh++; }, playPunchHit() { audio.hit++; } };
  return audio;
}

function arena({ weapon = 'punos' } = {}) {
  const scene = new THREE.Scene();
  const input = makeInput();
  const audio = makeAudio();
  const stats = { dinero: 0 };
  const player = new Player(scene, input, stats, audio);
  player.position.set(10, 0, 10);
  player.root.rotation.y = 0; // mira a +Z
  if (weapon !== 'punos') player.equipWeapon(weapon);
  const npc = (x, z) => new Npc(scene, new THREE.Vector3(x, 0, z), { look: {} });
  const tick = (n, dt, npcs) => { for (let i = 0; i < n; i++) player.update(dt, null, null, null, npcs); };
  return { scene, input, audio, stats, player, npc, tick };
}

// ---------- datos ----------

test('tabla de armas: puños son lo más débil y corto; cuchillo rápido y fuerte; botella con más alcance', () => {
  const { punos, cuchillo, botella_picada: botella } = WEAPONS;
  assert.ok(punos && cuchillo && botella);
  assert.ok(punos.damage < botella.damage && botella.damage < cuchillo.damage);
  assert.ok(punos.range < cuchillo.range || punos.range < botella.range);
  assert.ok(botella.range > cuchillo.range, 'la botella llega un poco más lejos');
  const total = (w) => w.windup + w.active + w.recovery;
  assert.ok(total(cuchillo) < total(botella), 'el cuchillo es más rápido');
  for (const w of Object.values(WEAPONS)) {
    assert.ok(w.combo >= 1 && w.combo <= 3, `${w.id}: combo entre 1 y 3`);
    assert.ok(w.windup > 0 && w.active > 0 && w.recovery > 0 && w.knockback > 0);
  }
});

test('el último golpe del combo pega más fuerte y tarda más', () => {
  const w = WEAPONS.punos;
  const first = comboStep(w, 0), last = comboStep(w, w.combo - 1);
  assert.ok(last.damage > first.damage && last.knockback > first.knockback);
  assert.ok(last.recovery > first.recovery);
  assert.equal(first.step, 0);
});

test('cuchillo y botella picada son objetos usables que se fabrican con materiales de la calle', () => {
  for (const id of ['cuchillo', 'botella_picada']) {
    assert.ok(ITEMS[id], id);
    assert.equal(ITEMS[id].weapon, id);
    assert.ok(WEAPONS[ITEMS[id].weapon]);
    assert.ok(isUsable(ITEMS[id]));
    assert.ok(RECIPES.some((r) => r.result === id), `${id} sin receta`);
  }
});

// ---------- jugador: fases y combos ----------

test('el golpe tiene preparación, impacto único y recuperación', () => {
  const { player, input, audio, npc, tick, stats } = arena();
  const target = npc(10, 11);
  assert.equal(player.attack, null);
  input.presses.add('KeyG');
  tick(1, 0.01, [target]);
  assert.equal(player.attack.phase, 'windup');
  assert.equal(player.action, 'golpear');
  assert.equal(audio.whoosh, 1);
  assert.equal(audio.hit, 0, 'aún no hay impacto');
  assert.equal(target.health, target.maxHealth);

  tick(1, WEAPONS.punos.windup, [target]);
  assert.equal(player.attack.phase, 'active');
  assert.ok(target.health < target.maxHealth, 'el daño se aplica al llegar el impacto');
  assert.equal(audio.hit, 1);
  assert.ok(stats.dinero > 0, 'el botín se conserva');
  assert.ok(target.panicTimer > 0);
  const hp = target.health;

  tick(20, 0.05, [target]); // recuperación completa
  assert.equal(player.attack, null);
  assert.equal(target.health, hp, 'el mismo golpe no daña dos veces');
});

test('pulsar durante la recuperación encadena el siguiente golpe hasta el máximo del combo', () => {
  const { player, input, npc, tick } = arena();
  const target = npc(10, 11);
  const steps = [];
  input.presses.add('KeyG');
  for (let i = 0; i < 120; i++) {
    if (player.attack?.phase === 'recovery' && !player._attackQueued) input.presses.add('KeyG');
    player.update(0.02, null, null, null, [target]);
    if (player.attack && steps.at(-1) !== player.attack.step) steps.push(player.attack.step);
    if (target.isKnockedOut) break;
  }
  assert.deepEqual(steps.slice(0, 3), [0, 1, 2]);
  assert.ok(!steps.some((s) => s >= WEAPONS.punos.combo), 'no pasa del combo del arma');
});

test('el combo se reinicia tras una pausa', () => {
  const { player, input, tick } = arena();
  input.presses.add('KeyG');
  tick(1, 0.01, []);
  tick(30, 0.02, []); // termina el golpe 0
  assert.equal(player.attack, null);
  assert.equal(player.comboStep, 1, 'si se pulsa a tiempo continúa en el golpe 1');
  tick(Math.ceil((COMBO_WINDOW + 0.1) / 0.02), 0.02, []);
  assert.equal(player.comboStep, 0);
  input.presses.add('KeyG');
  tick(1, 0.01, []);
  assert.equal(player.attack.step, 0);
});

test('puños golpean solo al más cercano; el cuchillo a todos los que alcance', () => {
  const punos = arena();
  const a1 = punos.npc(10, 11), b1 = punos.npc(10.3, 11.2);
  punos.input.presses.add('KeyG');
  punos.tick(1, 0.01, [a1, b1]);
  punos.tick(1, WEAPONS.punos.windup + 0.001, [a1, b1]);
  assert.equal([a1, b1].filter((n) => n.health < n.maxHealth).length, 1);
  assert.ok(a1.health < a1.maxHealth, 'el más cercano recibe el golpe');

  const knife = arena({ weapon: 'cuchillo' });
  const a2 = knife.npc(10, 11), b2 = knife.npc(10.3, 11.2), far = knife.npc(10, 14);
  knife.input.presses.add('KeyG');
  knife.tick(1, 0.01, [a2, b2, far]);
  knife.tick(1, WEAPONS.cuchillo.windup + 0.001, [a2, b2, far]);
  assert.ok(a2.health < a2.maxHealth && b2.health < b2.maxHealth);
  assert.equal(far.health, far.maxHealth, 'fuera de alcance no recibe daño');
});

test('golpes a la espalda o fuera de alcance no conectan', () => {
  const { player, input, npc, tick, audio } = arena();
  const behind = npc(10, 9), far = npc(10, 13);
  input.presses.add('KeyG');
  tick(1, 0.01, [behind, far]);
  tick(1, WEAPONS.punos.windup + 0.001, [behind, far]);
  assert.equal(behind.health, behind.maxHealth);
  assert.equal(far.health, far.maxHealth);
  assert.equal(audio.hit, 0);
});

test('equipar: alterna el arma, vuelve a puños si se pierde del inventario', () => {
  const { player } = arena();
  const inv = new InventorySystem();
  assert.equal(player.equippedWeapon, 'punos');
  inv.add(ITEMS.cuchillo, 1);
  assert.equal(player.toggleWeapon('cuchillo'), true);
  assert.equal(player.equippedWeapon, 'cuchillo');
  player.syncWeapon(inv);
  assert.equal(player.equippedWeapon, 'cuchillo');
  assert.equal(player.toggleWeapon('cuchillo'), false);
  assert.equal(player.equippedWeapon, 'punos');
  player.equipWeapon('cuchillo');
  inv.remove('cuchillo', 1);
  player.syncWeapon(inv);
  assert.equal(player.equippedWeapon, 'punos');
  assert.equal(player.equipWeapon('no-existe'), false);
});

test('un aturdimiento cancela el golpe en curso', () => {
  const { player, input, tick } = arena();
  input.presses.add('KeyG');
  tick(1, 0.01, []);
  assert.ok(player.attack);
  player.receiveVehicleImpact(new THREE.Vector3(1, 0, 0), 5, { collisions: null });
  tick(1, 0.01, []);
  assert.equal(player.attack, null);
});

// ---------- NPC: salud, reacción y KO ----------

test('un golpe resta salud, aturde un instante y hace huir; sin dañar de más a un noqueado', () => {
  const { npc } = arena();
  const n = npc(10, 11);
  const start = n.position.clone();
  const money = n.takeHit({ damage: 20, dir: { x: 0, z: 1 }, knockback: 1 });
  assert.equal(n.health, n.maxHealth - 20);
  assert.ok(money > 0);
  assert.ok(n.fleeTimer > 0 && n.panicTimer > 0);
  assert.ok(n.fleeDir.z > 0.9, 'huye alejándose del golpe');
  n.update(0.1, {});
  assert.ok(n.position.z > start.z, 'el golpe empuja un poco');
  assert.equal(n.takeHit({ damage: 1, dir: { x: 0, z: 1 } }), 0, 'el botín cae una sola vez por golpiza');
});

test('takePunch sigue funcionando como envoltorio', () => {
  const { npc, player } = arena();
  const n = npc(10, 11);
  const drop = n.takePunch(player);
  assert.ok(drop >= 200);
  assert.ok(n.health < n.maxHealth);
  assert.ok(n.panicTimer > 0);
});

test('a 0 de salud el peatón cae, queda tendido, se levanta con salud completa y huye; nunca desaparece', () => {
  const { npc, scene } = arena();
  const n = npc(10, 11);
  n.takeHit({ damage: n.maxHealth, dir: { x: 0, z: 1 }, knockback: 0.5 });
  assert.equal(n.health, 0);
  assert.equal(n.isKnockedOut, true);
  assert.equal(n.fleeTimer, 0, 'tendido no huye');
  for (let i = 0; i < 20; i++) n.update(0.05, {});
  assert.equal(n._koBlend, 1, 'termina de caer');
  const at = n.position.clone();
  for (let i = 0; i < 40; i++) n.update(0.1, {}); // 4 s tendido
  assert.ok(n.isKnockedOut);
  assert.ok(n.position.distanceTo(at) < 0.5, 'no camina mientras está noqueado');
  assert.equal(n.takeHit({ damage: 50, dir: { x: 0, z: 1 } }), 0);
  assert.equal(n.health, 0, 'los golpes a un noqueado se ignoran');
  assert.ok(scene.children.includes(n.root), 'sigue en la escena');
  for (let i = 0; i < 100 && n.isKnockedOut; i++) n.update(0.1, {}); // espera a que se levante (<10 s)
  assert.equal(n.isKnockedOut, false);
  assert.equal(n.health, n.maxHealth);
  assert.ok(n.fleeTimer > 0, 'se levanta huyendo');
  assert.ok(scene.children.includes(n.root));
});

test('el jugador no puede golpear a un peatón noqueado', () => {
  const { player, input, npc, tick } = arena();
  const n = npc(10, 11);
  n.takeHit({ damage: 1000, dir: { x: 0, z: 1 } });
  input.presses.add('KeyG');
  tick(1, 0.01, [n]);
  tick(1, WEAPONS.punos.windup + 0.001, [n]);
  assert.equal(n.health, 0);
});

test('la pose de KO se conserva al cambiar el detalle del modelo', () => {
  const { npc } = arena();
  const n = npc(10, 11);
  const lod = { group: new THREE.Group(), update() {} };
  const full = { group: new THREE.Group(), update() {} };
  const far = { player: { x: 1e4, z: 1e4 } };
  n._show(lod);
  n.takeHit({ damage: 1000, dir: { x: 0, z: 1 } });
  for (let i = 0; i < 20; i++) n.update(0.05, far);
  assert.ok(lod.group.rotation.x < -1.4, 'tendido');
  n._show(full);
  assert.ok(full.group.rotation.x < -1.4, 'el otro modelo también queda tendido');
  assert.equal(lod.group.rotation.x, 0, 'el que sale se limpia');
});

// ---------- animación procedural sobre el esqueleto ----------

function skeleton() {
  const root = new THREE.Group();
  const bones = new Map();
  const add = (name, parent, x, y, z) => {
    const b = new THREE.Bone();
    b.name = `mixamorig${name}`;
    b.position.set(x, y, z);
    parent.add(b);
    bones.set(b.name, b);
    return b;
  };
  const hips = add('Hips', root, 0, 1, 0);
  const s0 = add('Spine', hips, 0, 0.1, 0);
  const s1 = add('Spine1', s0, 0, 0.15, 0);
  const s2 = add('Spine2', s1, 0, 0.15, 0);
  const rArm = add('RightArm', s2, -0.2, 0.15, 0);
  const rFore = add('RightForeArm', rArm, 0, -0.3, 0);
  const rHand = add('RightHand', rFore, 0, -0.3, 0);
  const lArm = add('LeftArm', s2, 0.2, 0.15, 0);
  const lFore = add('LeftForeArm', lArm, 0, -0.3, 0);
  add('LeftHand', lFore, 0, -0.3, 0);
  root.updateMatrixWorld(true);
  return { root, bones, rHand, lFore, rFore, s2 };
}

const worldPos = (o) => { o.updateWorldMatrix(true, false); return o.getWorldPosition(new THREE.Vector3()); };

test('el impacto estira el brazo hacia delante y vuelve a la pose original', () => {
  const sk = skeleton();
  const overlay = createMeleeOverlay(sk.bones, sk.root);
  const rest = worldPos(sk.rHand).clone();
  const strike = { weapon: 'punos', step: 1, phase: 'active', progress: 0.5, t: 0.04 }; // cross con la derecha
  for (let i = 0; i < 30; i++) {
    for (const b of sk.bones.values()) b.quaternion.identity(); // el mixer reescribe la pose cada cuadro
    overlay.apply(0.016, strike);
  }
  const hit = worldPos(sk.rHand);
  assert.ok(hit.z - rest.z > 0.3, `la mano debe ir hacia delante (+Z), z=${hit.z - rest.z}`);
  assert.ok(hit.y > rest.y + 0.2, 'la mano sube desde la cadera hacia el pecho');
  for (let i = 0; i < 60; i++) {
    for (const b of sk.bones.values()) b.quaternion.identity();
    overlay.apply(0.016, null);
  }
  assert.ok(worldPos(sk.rHand).distanceTo(rest) < 1e-3, 'se desvanece sin dejar rastro');
  assert.equal(overlay.active, false);
});

test('el jab usa el brazo izquierdo y el cuchillo cruza el cuerpo de lado a lado', () => {
  const sk = skeleton();
  const overlay = createMeleeOverlay(sk.bones, sk.root);
  const restL = worldPos(sk.lFore).clone();
  for (let i = 0; i < 30; i++) {
    for (const b of sk.bones.values()) b.quaternion.identity();
    overlay.apply(0.016, { weapon: 'punos', step: 0, phase: 'active', progress: 0.5, t: 0.04 });
  }
  assert.ok(worldPos(sk.lFore).z - restL.z > 0.2, 'el antebrazo izquierdo avanza');

  const cock = skeleton(), strikeSk = skeleton();
  const o1 = createMeleeOverlay(cock.bones, cock.root), o2 = createMeleeOverlay(strikeSk.bones, strikeSk.root);
  for (let i = 0; i < 40; i++) {
    for (const b of cock.bones.values()) b.quaternion.identity();
    for (const b of strikeSk.bones.values()) b.quaternion.identity();
    o1.apply(0.016, { weapon: 'cuchillo', step: 0, phase: 'windup', progress: 0.5, t: 0.04 });
    o2.apply(0.016, { weapon: 'cuchillo', step: 0, phase: 'active', progress: 0.5, t: 0.04 });
  }
  assert.ok(worldPos(cock.rHand).x < worldPos(strikeSk.rHand).x - 0.2, 'del lado derecho (−X) hacia el izquierdo (+X)');
});

test('el efecto no depende de la velocidad: el cuerpo sigue en marcha y no hay estado compartido entre personajes', () => {
  const a = skeleton(), b = skeleton();
  const oa = createMeleeOverlay(a.bones, a.root), ob = createMeleeOverlay(b.bones, b.root);
  const strike = { weapon: 'cuchillo', step: 2, phase: 'active', progress: 0.5, t: 0.03 };
  for (let i = 0; i < 20; i++) oa.apply(0.016, strike);
  assert.ok(oa.active);
  assert.equal(ob.active, false);
  assert.ok(b.rHand.position.distanceTo(new THREE.Vector3(0, -0.3, 0)) < 1e-9);
});

test('extensión del ataque: se encoge al preparar, llega al máximo en el impacto y se relaja', () => {
  assert.equal(attackExtension(null), 0);
  const e = (phase, progress) => attackExtension({ phase, progress });
  assert.ok(e('windup', 0.5) < 0);
  assert.ok(e('windup', 1) > 0.95);
  assert.equal(e('active', 0.5), 1);
  assert.ok(e('recovery', 0.9) < e('recovery', 0.1));
});

// ---------- arma en mano ----------

test('el arma se ata a la mano derecha, se cambia y libera sus materiales', () => {
  const sk = skeleton();
  const knife = attachWeapon(sk.root, sk.bones, 'cuchillo');
  assert.ok(knife.object.parent === sk.rHand, 'cuelga de la mano');
  assert.ok(knife.object.name.includes('cuchillo'));
  let disposed = 0;
  const materials = new Set();
  knife.object.traverse((o) => { if (o.isMesh) materials.add(o.material); });
  for (const m of materials) m.addEventListener('dispose', () => disposed++);
  const geometry = knife.object.children.find((o) => o.isMesh).geometry;
  let geoDisposed = false;
  geometry.addEventListener('dispose', () => { geoDisposed = true; });
  knife.dispose();
  assert.equal(knife.object.parent, null);
  assert.equal(disposed, materials.size);
  assert.equal(geoDisposed, false, 'la geometría es compartida');

  const bottle = attachWeapon(sk.root, sk.bones, 'botella_picada');
  assert.ok(bottle.object.parent === sk.rHand);
  assert.equal(attachWeapon(sk.root, sk.bones, 'puños'), null);
  bottle.dispose();
});
