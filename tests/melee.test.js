import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Player } from '../src/entities/Player.js';
import { Npc } from '../src/entities/Npc.js';
import { WEAPONS, comboStep, COMBO_WINDOW } from '../src/data/weapons.js';
import { ITEMS, isUsable } from '../src/data/items.js';
import { RECIPES } from '../src/data/recipes.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { attackExtension, attackSide, createMeleeOverlay } from '../src/character/melee.js';
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

test('el arma casera es la más lenta, pero la que más pega, más alcanza y más empuja', () => {
  const { arma, ...others } = WEAPONS;
  const total = (w) => w.windup + w.active + w.recovery;
  for (const w of Object.values(others)) {
    assert.ok(arma.damage > w.damage, `pega más que ${w.id}`);
    assert.ok(arma.range > w.range, `alcanza más que ${w.id}`);
    assert.ok(arma.knockback > w.knockback, `empuja más que ${w.id}`);
    assert.ok(total(arma) > total(w), `tarda más que ${w.id}`);
  }
});

test('cuchillo, botella picada y arma casera son objetos usables que se fabrican con materiales de la calle', () => {
  for (const id of ['cuchillo', 'botella_picada', 'arma']) {
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

test('el arma casera fabricada se equipa y alcanza a quien la botella no llega', () => {
  const { player, input, npc, tick } = arena();
  assert.equal(player.toggleWeapon(ITEMS.arma.weapon), true);
  assert.equal(player.weapon.id, 'arma');
  const target = npc(10, 12); // a 2 m
  assert.ok(WEAPONS.botella_picada.range < 2);
  input.presses.add('KeyG');
  tick(1, 0.01, [target]);
  tick(1, WEAPONS.arma.windup + 0.001, [target]);
  assert.equal(target.health, target.maxHealth - WEAPONS.arma.damage);
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
  assert.equal(n.takeHit({ damage: 50, dir: { x: 0, z: 1 } }), false);
  assert.equal(n.health, 0, 'los golpes a un noqueado se ignoran');
  assert.ok(scene.children.includes(n.root), 'sigue en la escena');
  for (let i = 0; i < 100 && n.isKnockedOut; i++) n.update(0.1, {}); // espera a que se levante (<10 s)
  assert.equal(n.isKnockedOut, false);
  assert.equal(n.health, n.maxHealth);
  assert.ok(n.fleeTimer > 0, 'se levanta huyendo');
  assert.equal(n.takeHit({ damage: 1 }), 0, 'despertar no renueva el dinero del mismo peatón');
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
  const seen = (model) => { model.ko = []; model.update = (_dt, params) => model.ko.push(params.ko); return model; };
  const lod = seen({ group: new THREE.Group() });
  const full = seen({ group: new THREE.Group() });
  const far = { player: { x: 1e4, z: 1e4 } };
  n._show(lod);
  n.takeHit({ damage: 1000, dir: { x: 0, z: 1 } });
  for (let i = 0; i < 20; i++) n.update(0.05, far);
  assert.equal(lod.ko.at(-1), 1, 'tendido');
  assert.equal(lod.group.rotation.x, 0, 'el cuerpo lo acuesta la cadera, no el grupo');
  n._show(full);
  n.update(0.05, far);
  assert.equal(full.ko.at(-1), 1, 'el otro modelo también queda tendido');
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

test('el arma casera barre de lado a lado y remata desde arriba con la mano derecha, con el seguimiento y la guardia de los demás golpes', () => {
  const handAt = (attack) => {
    const sk = skeleton();
    const overlay = createMeleeOverlay(sk.bones, sk.root);
    overlay.apply(0.016, attack);
    return worldPos(sk.rHand);
  };
  const arma = (step, phase, progress = 0.5) => ({ weapon: 'arma', step, phase, progress });
  for (const step of [0, 1]) assert.equal(attackSide(arma(step, 'active')), 'R');
  assert.ok(handAt(arma(0, 'windup')).x < handAt(arma(0, 'active')).x - 0.2, 'barrido: del lado derecho (−X) hacia el izquierdo (+X)');
  assert.ok(handAt(arma(1, 'windup')).y > handAt(arma(1, 'active')).y + 0.2, 'garrotazo: de arriba hacia abajo');
  for (const step of [0, 1]) {
    assert.ok(handAt(arma(step, 'active', 1)).distanceTo(handAt(arma(step, 'active', 0))) > 0.03, 'sigue después del contacto');
    assert.ok(handAt(arma(step, 'recovery', 0.35)).distanceTo(handAt(arma(step, 'active', 1))) > 0.15, 'la mano vuelve a la guardia antes de soltarse');
  }

  const sk = skeleton();
  const overlay = createMeleeOverlay(sk.bones, sk.root);
  const rest = worldPos(sk.rHand).clone();
  for (const attack of [arma(1, 'windup', 0.2), arma(1, 'windup', 0.9), arma(1, 'active', 0), arma(1, 'active', 1), arma(1, 'recovery', 0.3), arma(1, 'recovery', 1)]) {
    for (const b of sk.bones.values()) b.quaternion.identity();
    overlay.apply(0.016, attack);
    assert.ok(worldPos(sk.rHand).toArray().every(Number.isFinite), `${attack.phase} ${attack.progress}`);
  }
  for (let i = 0; i < 60; i++) {
    for (const b of sk.bones.values()) b.quaternion.identity();
    overlay.apply(0.016, null);
  }
  assert.ok(worldPos(sk.rHand).distanceTo(rest) < 1e-3, 'se desvanece sin dejar rastro');
});

test('extensión del ataque: se encoge al preparar, llega al máximo en el impacto y se relaja', () => {
  assert.equal(attackExtension(null), 0);
  const e = (phase, progress) => attackExtension({ phase, progress });
  assert.ok(e('windup', 0.5) < 0);
  assert.ok(e('windup', 1) > 0.95);
  assert.equal(e('active', 0), 1);
  assert.ok(e('active', 1) < e('active', 0), 'cede después del contacto');
  assert.equal(e('active', 1), e('recovery', 0), 'sin salto entre contacto y recuperación');
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

  const club = attachWeapon(sk.root, sk.bones, 'arma');
  assert.ok(club.object.parent === sk.rHand, 'el arma casera también va en la mano');
  assert.equal(club.object.name, 'weapon-arma');
  const box = new THREE.Box3().setFromObject(club.object);
  assert.ok(box.max.y - box.min.y > 0.5 || box.max.x - box.min.x > 0.5 || box.max.z - box.min.z > 0.5, 'es una tabla larga');
  club.dispose();
});

test('en el modelo liviano ningún arma atraviesa el piso, quieto, caminando ni corriendo', () => {
  const box = new THREE.Box3();
  for (const id of ['cuchillo', 'botella_picada', 'arma']) {
    const scene = new THREE.Scene();
    const input = makeInput();
    const player = new Player(scene, input, { energia: 100, salud: 100, dinero: 0, higiene: 100 }, null, {});
    player.position.set(0, 0, 0);
    player.equipWeapon(id);
    const weapon = player.character.group.getObjectByName(`weapon-${id}`);
    for (const [z, running] of [[0, false], [-1, false], [-1, true]]) {
      input.axis.z = z;
      input.isRunning = running;
      for (let frame = 0; frame < 120; frame++) {
        player.update(1 / 60, null, null, () => 0, []);
        scene.updateMatrixWorld(true);
        box.setFromObject(weapon, true);
        assert.ok(box.min.y >= 0, `${id} en z ${z}${running ? ' corriendo' : ''}: ${box.min.y.toFixed(3)} m`);
      }
    }
  }
});


function realCombatRig() {
  const json = JSON.parse(readFileSync(new URL('../public/models/personaje/hombre-adulto/cuerpo.gltf', import.meta.url)));
  const nodes = json.nodes.map(node => {
    const bone = new THREE.Bone(); bone.name = node.name ?? '';
    if (node.translation) bone.position.fromArray(node.translation);
    if (node.rotation) bone.quaternion.fromArray(node.rotation);
    if (node.scale) bone.scale.fromArray(node.scale);
    return bone;
  });
  json.nodes.forEach((node, i) => { for (const child of node.children ?? []) nodes[i].add(nodes[child]); });
  const root = new THREE.Group();
  for (const i of json.scenes[json.scene ?? 0].nodes) root.add(nodes[i]);
  const bones = new Map(nodes.map(b => [b.name, b]));
  const base = nodes.map(b => b.quaternion.clone());
  return { root, bones, nodes, restore: () => nodes.forEach((b, i) => b.quaternion.copy(base[i])) };
}

test('cada arma enlaza preparación, contacto y recuperación sin saltos en el esqueleto real', () => {
  for (const weapon of Object.values(WEAPONS)) for (let step = 0; step < weapon.combo; step++) {
    const rig = realCombatRig();
    const overlay = createMeleeOverlay(rig.bones, rig.root);
    const sample = (phase, progress) => {
      rig.restore();
      overlay.apply(1 / 60, { id: 1, weapon: weapon.id, step, phase, progress });
      return rig.nodes.map(b => b.quaternion.clone());
    };
    const before = sample('windup', .9999), impact = sample('active', 0);
    const follow = sample('active', 1), recover = sample('recovery', 0);
    before.forEach((q, i) => assert.ok(q.clone().normalize().angleTo(impact[i].clone().normalize()) < 1e-5, `${weapon.id}: entrada al contacto`));
    follow.forEach((q, i) => assert.ok(q.clone().normalize().angleTo(recover[i].clone().normalize()) < 1e-6, `${weapon.id}: salida del contacto`));
    assert.ok(follow.some((q, i) => q.clone().normalize().angleTo(impact[i].clone().normalize()) > .03), 'el cuerpo continúa después del impacto');
    const end = sample('recovery', 1);
    rig.restore();
    end.forEach((q, i) => assert.ok(q.clone().normalize().angleTo(rig.nodes[i].quaternion.clone().normalize()) < 1e-6, 'retorna al clip base'));
  }
});

test('el combate conserva apoyos y orienta la cabeza sin retrasar el impacto a distintos FPS', () => {
  const poses = [30, 60, 144].map(fps => {
    const rig = realCombatRig();
    const overlay = createMeleeOverlay(rig.bones, rig.root);
    const feet = [...rig.bones.values()].filter(b => /Foot|ToeBase/.test(b.name));
    const before = feet.map(worldPos);
    const head = [...rig.bones.values()].find(b => b.name.endsWith('Head'));
    const headRest = head.quaternion.clone().normalize();
    const attack = { id: 1, weapon: 'punos', step: 1, phase: 'active', progress: 0 };
    overlay.apply(1 / fps, attack);
    feet.forEach((foot, i) => assert.ok(worldPos(foot).distanceTo(before[i]) < 1e-9));
    assert.deepEqual(rig.root.position.toArray(), [0, 0, 0]);
    assert.ok(head.quaternion.clone().normalize().angleTo(headRest) > .1, 'la cabeza compensa el giro del torso');
    return rig.nodes.map(b => b.quaternion.clone());
  });
  poses.forEach(pose => pose.forEach((q, i) => assert.ok(q.clone().normalize().angleTo(poses[0][i].clone().normalize()) < 1e-6)));
});


test('un combo comienza desde la recuperación anterior, sin cortar a brazos en reposo', () => {
  const rig = realCombatRig();
  const overlay = createMeleeOverlay(rig.bones, rig.root);
  overlay.apply(1 / 60, { id: 1, weapon: 'punos', step: 0, phase: 'recovery', progress: .4 });
  const before = rig.nodes.map(b => b.quaternion.clone().normalize());
  rig.restore();
  overlay.apply(1 / 60, { id: 2, weapon: 'punos', step: 1, phase: 'windup', progress: 0 });
  rig.nodes.forEach((bone, i) => assert.ok(bone.quaternion.clone().normalize().angleTo(before[i]) < 1e-6));
});
