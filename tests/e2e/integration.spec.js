import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Cada escenario conserva el bucle real del juego. Las evaluaciones únicamente
// preparan posiciones/objetos y observan estado; no reemplazan daño ni sistemas.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

async function start(page, url = '/') {
  await page.goto(url, { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Integración QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
}

async function frames(page, count = 12) {
  await page.evaluate(count => new Promise(resolve => {
    const next = () => --count <= 0 ? resolve() : requestAnimationFrame(next);
    requestAnimationFrame(next);
  }), count);
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

// Cada aviso dura 2,5 s: se anota al aparecer para no depender de los cuadros que tarde cada paso.
async function recordToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(changes => {
      for (const { addedNodes } of changes) for (const node of addedNodes) {
        if (node.classList?.contains('loot-toast')) window.__toasts.push(node.textContent);
      }
    }).observe(document.body, { childList: true });
  });
  return text => expect.poll(() => page.evaluate(() => window.__toasts)).toContainEqual(expect.stringContaining(text));
}

// Los avisos no reciben clics: se les permite un instante para preguntar qué queda encima en su centro.
const lastToastOnTop = page => page.evaluate(() => {
  const toast = [...document.querySelectorAll('.loot-toast')].at(-1);
  if (!toast) return false;
  const box = toast.getBoundingClientRect();
  toast.style.pointerEvents = 'auto';
  const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  toast.style.pointerEvents = '';
  return top === toast;
});

async function simulatedPad(page) {
  await page.addInitScript(() => {
    window.__testPad = { index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__testPad] });
  });
  return async index => {
    await page.evaluate(index => { window.__testPad.buttons[index] = { pressed: true, touched: true, value: 1 }; }, index);
    await frames(page, 3);
    await page.evaluate(index => { window.__testPad.buttons[index] = { pressed: false, touched: false, value: 0 }; }, index);
    await frames(page, 3);
  };
}

test('cuchillo encadena tres golpes, botella noquea y recuperar al NPC no renueva el dinero', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page);
  await page.evaluate(async () => {
    const game = window.__game, player = game.player;
    const { ITEMS } = await import('/src/data/items.js');
    game.inventory.clear();
    game.inventory.add(ITEMS.cuchillo, 1);
    game.inventory.add(ITEMS.botella_picada, 1);
    game.stats.energia = game.stats.salud = 100;
    game.clock.hour = 12;
    player.position.set(112.98, game.world.active.getMovementGroundHeight(112.98, 97.84, 0), 97.84);
    player.root.position.copy(player.position); player.root.rotation.set(0, Math.PI, 0);
    player.velocity.set(0, 0, 0); player.resetGrounding(); player.action = null;
    const npc = game.world.active.npcs.find(npc => npc.character && !npc._disposed);
    npc.position.set(112.98, player.position.y, 96.8); npc.root.position.copy(npc.position);
    // Un objetivo quieto permite observar todos los contactos del combo. Sigue
    // recibiendo daño, animando el sacudón, cayendo y recuperándose normalmente.
    npc.isWalkable = () => false; npc.walkSpeed = 0;
    npc.health = npc.maxHealth; npc.looted = false;
    window.__integrationCombat = { npc, money: game.stats.dinero, steps: [], hits: [], queued: [], complete: false };
    window.addEventListener('street-fight', event => {
      if (event.detail?.attacker !== player) return;
      window.__integrationCombat.hits.push({ health: npc.health, money: game.stats.dinero });
    });
  });
  await page.keyboard.press('i');
  await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
  await page.locator('.inv-slot[data-i="0"]').click();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__game.player.equippedWeapon)).toBe('cuchillo');
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const game = window.__game, probe = window.__integrationCombat;
    probe.deadline = performance.now() + 10_000;
    const sample = () => {
      const attack = game.player.attack;
      if (attack && !probe.steps.includes(attack.step)) probe.steps.push(attack.step);
      if (attack?.phase === 'recovery' && attack.step < 2 && !probe.queued.includes(attack.step)) {
        probe.queued.push(attack.step);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'g', bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG', key: 'g', bubbles: true }));
      }
      if (probe.steps.includes(2) && !attack) { probe.complete = true; return; }
      if (performance.now() < probe.deadline) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => window.__integrationCombat.complete)).toBe(true);
  const combo = await page.evaluate(() => {
    const p = window.__integrationCombat;
    return { steps: p.steps, hits: p.hits, money: p.money, health: p.npc.health };
  });
  expect(combo.steps).toEqual([0, 1, 2]);
  expect(combo.hits.map(hit => hit.health)).toEqual([72, 44, 2]);
  const moneyAfterFirstHit = combo.hits[0].money;
  expect(moneyAfterFirstHit - combo.money).toBeGreaterThanOrEqual(200);
  expect(moneyAfterFirstHit - combo.money).toBeLessThan(600);
  expect(combo.hits.map(hit => hit.money)).toEqual(Array(3).fill(moneyAfterFirstHit));

  await page.keyboard.press('i');
  await page.locator('.inv-slot[data-i="1"]').click();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__game.player.equippedWeapon)).toBe('botella_picada');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game.player.melee.cooldownRemaining)).toBe(0);
  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => window.__integrationCombat.npc.isKnockedOut)).toBe(true);
  expect(await page.evaluate(() => window.__integrationCombat.npc.health)).toBe(0);
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(moneyAfterFirstHit);
  if (process.env.UPGRADE_SHOTS) {
    await mkdir(process.env.UPGRADE_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.UPGRADE_SHOTS, 'combate-integrado.png') });
  }
  await expect.poll(() => page.evaluate(() => window.__integrationCombat.npc.isKnockedOut), { timeout: 25_000 }).toBe(false);
  expect(await page.evaluate(() => window.__integrationCombat.npc.health)).toBe(100);
  expect(await page.evaluate(() => window.__integrationCombat.npc.looted)).toBe(true);
  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => window.__integrationCombat.npc.health)).toBeLessThan(100);
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(moneyAfterFirstHit);
  expect(errors).toEqual([]);
});

test('entrar al agua cancela el contacto pendiente, el cigarrillo y la pose de pipa', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page);
  const prepared = await page.evaluate(() => {
    const game = window.__game, player = game.player;
    const npc = game.world.active.npcs.find(npc => npc.character && !npc._disposed);
    player.clearVehicleImpact(); player.resetGrounding(); player.action = null;
    const smoking = player.startSmoking('cigarrillo');
    const attacking = player.punch();
    const water = game.world.active.getWaterInfo(45, 262);
    player.position.set(45, water.surfaceY - .9, 262);
    player.root.position.copy(player.position); player.root.rotation.set(0, 0, 0);
    player.velocity.set(0, 0, 0);
    npc.position.set(45, player.position.y, 263); npc.root.position.copy(npc.position);
    npc.isWalkable = () => false; npc.walkSpeed = 0;
    window.__integrationWater = { npc, health: npc.health, money: game.stats.dinero };
    return { smoking, attacking, depth: water.depth };
  });
  expect(prepared).toMatchObject({ smoking: true, attacking: true });
  expect(prepared.depth).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => window.__game.player.isSwimming)).toBe(true);
  await frames(page);
  const wet = await page.evaluate(() => {
    const game = window.__game, player = game.player, probe = window.__integrationWater;
    return { attack: player.attack, smoking: player.smoking, action: player.action, state: player.state,
      health: probe.npc.health, beforeHealth: probe.health, money: game.stats.dinero, beforeMoney: probe.money,
      canAttack: player.punch(), canSmoke: player.startSmoking(), canUsePipe: player.startBasuco() };
  });
  expect(wet).toMatchObject({ attack: null, smoking: null, canAttack: false, canSmoke: false, canUsePipe: false });
  expect(wet.action).not.toBe('golpear');
  expect(wet.state).toBe('tread');
  expect(wet.health).toBe(wet.beforeHealth); expect(wet.money).toBe(wet.beforeMoney);

  // La negativa de la animación también debe llegar a la interfaz antes de
  // gastar objetos o aplicar sus efectos a las necesidades.
  await page.evaluate(async () => {
    const game = window.__game, { ITEMS } = await import('/src/data/items.js');
    game.inventory.clear();
    for (const id of ['cigarrillo', 'hierba', 'basuco']) game.inventory.add(ITEMS[id], 2);
  });
  await page.keyboard.press('i');
  await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
  const needs = () => page.evaluate(() => {
    const { stats } = window.__game;
    return Object.fromEntries(['hambre', 'sed', 'energia', 'salud', 'higiene', 'animo', 'vicio'].map(id => [id, stats[id]]));
  });
  const beforeConsumption = await needs();
  for (let slot = 0; slot < 3; slot++) {
    await page.locator(`.inv-slot[data-i="${slot}"]`).click();
    await page.keyboard.press('Enter');
  }
  expect(await page.evaluate(() => window.__game.inventory.items.map(item => item.qty))).toEqual([2, 2, 2]);
  expect(await needs()).toEqual(beforeConsumption);
  expect(await page.evaluate(() => ({ smoking: window.__game.player.smoking, basuco: window.__game.player.basuco })))
    .toEqual({ smoking: null, basuco: null });
  await page.keyboard.press('Escape');

  expect(await page.evaluate(() => {
    const game = window.__game, player = game.player;
    player.position.set(112.98, game.world.active.getMovementGroundHeight(112.98, 97.84, 0), 97.84);
    player.root.position.copy(player.position); player.resetGrounding(); player.action = null;
    const started = player.startBasuco();
    const water = game.world.active.getWaterInfo(45, 262);
    player.position.set(45, water.surfaceY - .9, 262); player.root.position.copy(player.position);
    return started;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.player.isSwimming)).toBe(true);
  await frames(page, 3);
  expect(await page.evaluate(() => ({ basuco: window.__game.player.basuco, action: window.__game.player.action,
    state: window.__game.player.state }))).toEqual({ basuco: null, action: null, state: 'tread' });
  expect(errors).toEqual([]);
});

test('foto congela patrulla, agresores, sustancias y radio y reanuda la simulación al salir', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page);
  const activated = await page.evaluate(() => {
    const game = window.__game;
    const police = game.traffic.vehicles.find(vehicle => vehicle.police);
    const civilian = game.traffic.vehicles.find(vehicle => !vehicle.police);
    if (!police || !civilian) throw new Error('Faltan vehículos reales en la ciudad');
    game.traffic._startChase(police);
    // La bronca pasa junto al jugador: un carro que frena lejos sigue su camino sin que nadie se baje.
    game.player.position.copy(civilian.car.driverDoor()).add({ x: 6, y: 0, z: 0 });
    const previousRandom = game.roadRage.random;
    game.roadRage.random = () => 0;
    const driverTriggered = game.roadRage.trigger(civilian.car);
    game.roadRage.random = previousRandom;
    // Llevar el encuentro al punto de bajada; la IA y los actores son los reales.
    civilian.speed = 0;
    game.roadRage.update(.001);
    const squadTriggered = game.limpieza.trigger();
    if (squadTriggered) {
      game.limpieza.distance = game.limpieza.stopAt;
      game.limpieza._place(); game.limpieza._dropOff();
    }
    window.dispatchEvent(new CustomEvent('substance-consumed', { detail: { id: 'pastilla' } }));
    game.radio.turnOn();
    window.__integrationPhoto = { police };
    const entered = game.photoMode.enter();
    return { entered, driverTriggered, squadTriggered, members: game.limpieza.members.filter(member => member.active).length,
      driver: game.roadRage.driver.active, substance: game.substanceEffects.currentId, police: police.state };
  });
  expect(activated).toEqual({ entered: true, driverTriggered: true, squadTriggered: true, members: 3,
    driver: true, substance: 'pastilla', police: 'chase' });
  await expect(page.locator('#photo-mode')).toBeVisible();
  const snapshot = () => page.evaluate(() => {
    const game = window.__game, police = window.__integrationPhoto.police;
    const actor = member => ({ position: member.position.toArray(), state: member.state, timer: member.timer,
      stateTimer: member.stateTimer, staggerTimer: member.staggerTimer });
    return { clock: game.clock.serialize(), position: game.player.position.toArray(), health: game.stats.salud,
      police: { state: police.state, time: police.chaseTime, position: police.car.position.toArray() },
      driver: actor(game.roadRage.driver), members: game.limpieza.members.map(actor),
      squad: { distance: game.limpieza.distance, timer: game.limpieza.timer, state: game.limpieza.state },
      substance: { elapsed: game.substanceEffects._effect.elapsed, phase: game.substanceEffects._effect.phase },
      battery: game.radio.battery };
  });
  const frozen = await snapshot();
  const yaw = await page.evaluate(() => window.__game.cameraRig.yaw);
  await page.keyboard.down('w'); await page.keyboard.press('g'); await page.keyboard.press('i');
  await page.getByRole('button', { name: 'Girar a la izquierda', exact: true }).click();
  await frames(page, 24);
  await page.keyboard.up('w');
  expect(await snapshot()).toEqual(frozen);
  expect(await page.evaluate(() => window.__game.cameraRig.yaw)).not.toBe(yaw);
  expect(await page.evaluate(() => ({ audio: window.__game.audio._paused, radio: window.__game.radio._paused })))
    .toEqual({ audio: true, radio: true });
  await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#photo-mode')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__game.substanceEffects._effect?.elapsed ?? -1)).toBeGreaterThan(frozen.substance.elapsed);
  await expect.poll(() => page.evaluate(() => window.__game.limpieza.timer)).toBeGreaterThan(frozen.squad.timer);
  expect(errors).toEqual([]);
});

test('arresto desde el agua limpia movimiento, amenazas y efectos antes de recuperar control', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page);
  await page.evaluate(async () => {
    const game = window.__game;
    const { ITEMS } = await import('/src/data/items.js');
    game.inventory.add(ITEMS.cuchillo, 1); game.player.equipWeapon('cuchillo');
    game.stats.dinero = 8000;
    const water = game.world.active.getWaterInfo(45, 262);
    game.player.position.set(45, water.surfaceY - .9, 262);
    game.player.root.position.copy(game.player.position); game.player.resetGrounding();
  });
  await expect.poll(() => page.evaluate(() => window.__game.player.isSwimming)).toBe(true);
  await page.evaluate(() => {
    const game = window.__game;
    const police = game.traffic.vehicles.find(vehicle => vehicle.police);
    game.traffic._startChase(police);
    game.steal.buscado = 3;
    window.dispatchEvent(new CustomEvent('substance-consumed', { detail: { id: 'basuco' } }));
    // Inercia vertical no nula detecta una recuperación que solo cambie X/Z.
    game.player.jumpVelocity = -4; game.player.airTime = 1;
    window.dispatchEvent(new CustomEvent('police-arrest'));
  });
  await expect(page.locator('#menu-title')).toHaveText('Te atrapó la Policía');
  const before = await page.evaluate(() => window.__game.player.position.toArray());
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => window.__game.player.position.toArray())).toEqual(before);
  // Capturar el estado inmediatamente tras el botón, antes de un nuevo cuadro,
  // distingue el reinicio explícito de corregir la flotación un cuadro después.
  await page.evaluate(() => {
    const game = window.__game;
    const button = [...document.querySelectorAll('#menu button')].find(button => button.textContent.trim() === 'Continuar');
    button.addEventListener('click', () => {
      const player = game.player;
      window.__integrationArrest = { swimming: player.isSwimming, inWater: player.inWater, depth: player.waterDepth,
        grounded: player.isGrounded, jumpVelocity: player.jumpVelocity, airTime: player.airTime,
        attack: player.attack, action: player.action, smoking: player.smoking, basuco: player.basuco,
        money: game.stats.dinero, inventory: game.inventory.items.length, weapon: player.equippedWeapon,
        pursuit: game.traffic.inPursuit, driver: game.roadRage.active, squad: game.limpieza.active,
        wanted: game.steal.buscado, substance: game.substanceEffects._effect,
        position: player.position.toArray(), ground: game.world.active.getMovementGroundHeight(player.position.x, player.position.z, 0) };
    });
  });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  const recovered = await page.evaluate(() => window.__integrationArrest);
  expect(recovered).toMatchObject({ swimming: false, inWater: false, depth: 0, grounded: true,
    jumpVelocity: 0, airTime: 0, attack: null, action: null, smoking: null, basuco: null,
    money: 0, inventory: 0, weapon: 'punos', pursuit: false, driver: false, squad: false, wanted: 0, substance: null });
  expect(recovered.position[1]).toBeCloseTo(recovered.ground, 5);
  await expect(page.locator('#menu')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  expect(errors).toEqual([]);
});

test('mando simulado navega inventario sin tirar objetos y activa controles del modo foto', async ({ page }) => {
  const errors = collectErrors(page);
  const press = await simulatedPad(page);
  await start(page);
  await page.evaluate(async () => {
    const game = window.__game, { ITEMS } = await import('/src/data/items.js');
    game.inventory.clear(); game.inventory.add(ITEMS.pan, 2); game.stats.hambre = 30;
  });
  await press(3); // Y: inventario.
  await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
  await press(13); // Cruceta abajo: siguiente fila, nunca tirar.
  expect(await page.evaluate(() => window.__game.inventoryUI.selected)).toBe(5);
  expect(await page.evaluate(() => window.__game.inventory.count('pan'))).toBe(2);
  await press(12);
  expect(await page.evaluate(() => window.__game.inventoryUI.selected)).toBe(0);
  await press(0); // A: usar el pan seleccionado una sola vez.
  expect(await page.evaluate(() => window.__game.inventory.count('pan'))).toBe(1);
  expect(await page.evaluate(() => window.__game.stats.hambre)).toBeGreaterThan(50);
  await press(1);
  await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
  await page.keyboard.press('F2');
  await expect(page.locator('#photo-mode')).toBeVisible();
  await frames(page, 3);
  const yaw = await page.evaluate(() => window.__game.cameraRig.yaw);
  await page.getByRole('button', { name: 'Girar a la izquierda', exact: true }).focus();
  await press(0);
  expect(await page.evaluate(() => window.__game.cameraRig.yaw)).not.toBe(yaw);
  await press(1);
  await expect(page.locator('#photo-mode')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  expect(errors).toEqual([]);
});

// Equipa el arma casera desde el inventario y encadena sus dos golpes contra un NPC quieto.
async function swingHomemadeWeapon(page) {
  await page.evaluate(async () => {
    const game = window.__game, player = game.player;
    const { ITEMS } = await import('/src/data/items.js');
    game.inventory.clear();
    game.inventory.add(ITEMS.arma, 1);
    game.stats.energia = game.stats.salud = 100;
    game.clock.hour = 12;
    player.position.set(112.98, game.world.active.getMovementGroundHeight(112.98, 97.84, 0), 97.84);
    player.root.position.copy(player.position); player.root.rotation.set(0, Math.PI, 0);
    player.velocity.set(0, 0, 0); player.resetGrounding(); player.action = null;
    const npc = game.world.active.npcs.find(npc => npc.character && !npc._disposed);
    npc.position.set(112.98, player.position.y, 96.34); npc.root.position.copy(npc.position);
    npc.isWalkable = () => false; npc.walkSpeed = 0;
    npc.health = npc.maxHealth;
    window.__clubProbe = { steps: [], hits: [], queued: [], complete: false, finite: true, seen: false, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    window.addEventListener('street-fight', event => {
      if (event.detail?.attacker === player) window.__clubProbe.hits.push(npc.health);
    });
    window.__clubNpc = npc;
  });
  await page.keyboard.press('i');
  await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
  await page.locator('.inv-slot[data-i="0"]').click();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__game.player.equippedWeapon)).toBe('arma');
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const game = window.__game, player = game.player, probe = window.__clubProbe;
    probe.deadline = performance.now() + 10_000;
    const sample = () => {
      const attack = player.attack, club = player.character.group.getObjectByName('weapon-arma');
      if (attack && club) {
        let shown = true;
        for (let node = club; node; node = node.parent) shown &&= node.visible;
        probe.seen ||= shown;
        club.updateWorldMatrix(true, false);
        const e = club.matrixWorld.elements, p = player.position;
        probe.finite &&= e.every(Number.isFinite);
        [e[12] - p.x, e[13] - p.y, e[14] - p.z].forEach((value, axis) => {
          probe.min[axis] = Math.min(probe.min[axis], value);
          probe.max[axis] = Math.max(probe.max[axis], value);
        });
      }
      if (attack && !probe.steps.includes(attack.step)) probe.steps.push(attack.step);
      if (attack?.phase === 'recovery' && attack.step < 1 && !probe.queued.includes(attack.step)) {
        probe.queued.push(attack.step);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'g', bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG', key: 'g', bubbles: true }));
      }
      if (probe.steps.includes(1) && !attack) { probe.complete = true; return; }
      if (performance.now() < probe.deadline) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => window.__clubProbe.complete)).toBe(true);
  const combo = await page.evaluate(() => window.__clubProbe);
  expect(combo.steps).toEqual([0, 1]);
  expect(combo.hits).toEqual([66, 15]);
  expect(combo.seen, 'el arma se ve en la mano').toBe(true);
  expect(combo.finite).toBe(true);
  const travel = Math.hypot(...combo.max.map((value, axis) => value - combo.min[axis]));
  expect(travel, 'el arma recorre el golpe').toBeGreaterThan(.5);
}

const skeletonIsFinite = page => page.evaluate(() => {
  let finite = true;
  window.__game.player.root.traverse(node => { finite &&= node.matrixWorld.elements.every(Number.isFinite); });
  return finite;
});

// Altura del nodo más alto del cuerpo sobre los pies: de pie ronda la estatura; acostado queda cerca del piso.
const bodyHeight = page => page.evaluate(() => {
  const player = window.__game.player;
  let top = -Infinity;
  player.character.group.traverse(node => { top = Math.max(top, node.matrixWorld.elements[13]); });
  return top - player.position.y;
});

// Mira cada cuadro del sueño y vuelve al despertar: la simulación está quieta, el cuerpo no.
const watchSleep = page => page.evaluate(() => new Promise(resolve => {
  const game = window.__game, player = game.player, seen = { frames: 0, lowest: Infinity, weaponShown: false };
  const sample = () => {
    if (!game.isSleeping) { resolve(seen); return; }
    let top = -Infinity;
    player.character.group.traverse(node => {
      top = Math.max(top, node.matrixWorld.elements[13]);
      if (node.name.startsWith('weapon-') && node.visible) seen.weaponShown = true;
    });
    seen.frames++;
    seen.lowest = Math.min(seen.lowest, top - player.position.y);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}));

test('arma casera: se equipa del inventario, barre, remata con más daño y la recicladora no la vende de la mano', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page);
  await swingHomemadeWeapon(page);
  expect(await skeletonIsFinite(page)).toBe(true);
  await page.evaluate(async () => {
    const { ITEMS } = await import('/src/data/items.js');
    const { openRecycler } = await import('/src/ui/placeMenus.js');
    window.__game.inventory.add(ITEMS.lata, 1);
    openRecycler(window.__game);
  });
  await page.getByRole('button', { name: /Vender todo/ }).click();
  expect(await page.evaluate(() => {
    const { inventory, player } = window.__game;
    return [inventory.count('arma'), inventory.count('lata'), player.equippedWeapon];
  })).toEqual([1, 0, 'arma']);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('con las animaciones Mixamo, el arma casera golpea y al dormir se acuesta, la suelta y se levanta', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, '/?animaciones=mixamo-preview');
  expect(await page.evaluate(() => window.__game.player.character.animationStatus.profile)).toBe('mixamo-game-preview');
  await swingHomemadeWeapon(page);
  await frames(page, 30);
  const standing = await bodyHeight(page);
  await page.evaluate(() => {
    const game = window.__game;
    Object.assign(game.built, { base: true, paredes: true });
    game.stats.higiene = 90;
    game.sleep();
  });
  expect(await page.evaluate(() => window.__game.player.action)).toBe('dormir');
  const asleep = await watchSleep(page);
  expect(asleep.lowest, `de pie mide ${standing}`).toBeLessThan(standing * .6);
  expect(asleep.weaponShown, 'no duerme con el arma en la mano').toBe(false);
  expect(await skeletonIsFinite(page)).toBe(true);
  expect(await page.evaluate(() => window.__game.player.action), 'despierto no sigue acostado').toBe(null);
  await expect.poll(() => bodyHeight(page)).toBeGreaterThan(standing * .9);
  expect(await page.evaluate(() => window.__game.diseases.hasAny), 'dormir bañado no pega nada').toBe(false);
  expect(errors).toEqual([]);
});

test('sin plata de noche: radar y mapa llevan al Dealer, E abre su tienda y solo se vende lo elegido', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page);
  const offer = await page.evaluate(async () => {
    const game = window.__game;
    const { ITEMS, dealerOffer } = await import('/src/data/items.js');
    const { cop } = await import('/src/utils/money.js');
    game.inventory.clear();
    game.inventory.add(ITEMS.pegante, 1);
    game.inventory.add(ITEMS.hierba, 2);
    game.stats.dinero = 0; game.stats.hambre = 15; game.stats.sed = 80; game.stats.calor = 100;
    return { value: dealerOffer(ITEMS.pegante), label: cop(dealerOffer(ITEMS.pegante)) };
  });
  const radar = page.locator('#minimap-info');
  await expect(radar).toContainText('Dealer');
  await expect(radar).toContainText('Sin plata: venda');

  await page.keyboard.press('m');
  const go = page.locator('.map-view__nearest');
  await expect(go).toHaveText('Ir a vender');
  await expect(go).toBeFocused();
  await expect(page.locator('.map-view__no-option')).toContainText('Venda sustancias');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__game.gps.waypoint?.name)).toBe('Dealer');
  await page.keyboard.press('m');
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);

  await page.evaluate(() => {
    const game = window.__game, player = game.player, at = game.dealer.position;
    player.position.set(at.x + .6, game.world.active.getMovementGroundHeight(at.x + .6, at.z, 0), at.z);
    player.root.position.copy(player.position); player.velocity.set(0, 0, 0); player.resetGrounding();
  });
  await expect(page.locator('#interaction-prompt')).toContainText('jíbaro');
  await page.keyboard.press('e');
  const panel = page.locator('#dealer-panel');
  await expect(panel).toHaveClass(/open/);
  const toastShown = await recordToasts(page);
  expect(await page.evaluate(() => [window.__game.stats.dinero, window.__game.inventory.count('pegante')]), 'E no vende nada').toEqual([0, 1]);
  await expect(panel.locator('.dealer-sell-btn')).toHaveCount(2);
  const sell = panel.locator('.dealer-sell-btn[data-id="pegante"]');
  await expect(sell).toHaveCSS('min-height', '46px');
  await page.evaluate(() => { window.__realRandom = Math.random; Math.random = () => .99; }); // sin requisa
  await sell.click();
  await page.evaluate(() => { Math.random = window.__realRandom; });
  expect(await page.evaluate(() => [window.__game.stats.dinero, window.__game.inventory.count('pegante'), window.__game.inventory.count('hierba')])).toEqual([offer.value, 0, 2]);
  await expect(panel.locator('.dealer-money')).toContainText(offer.label);
  await expect(panel.locator('.dealer-sell-btn')).toHaveCount(1);

  for (const size of [{ width: 375, height: 667 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    const fit = await page.evaluate(() => {
      const box = document.getElementById('dealer-panel'), button = box.querySelector('.dealer-sell-btn');
      button.scrollIntoView({ block: 'center' });
      const rect = button.getBoundingClientRect(), outer = box.getBoundingClientRect();
      return { spill: box.scrollWidth - box.clientWidth, left: outer.left, right: outer.right, top: rect.top, bottom: rect.bottom };
    });
    expect(fit.spill, `${size.width} px`).toBeLessThanOrEqual(0);
    expect(fit.left, `${size.width} px`).toBeGreaterThanOrEqual(0);
    expect(fit.right, `${size.width} px`).toBeLessThanOrEqual(size.width);
    expect(fit.top, `${size.width} px`).toBeGreaterThanOrEqual(0);
    expect(fit.bottom, `${size.width} px`).toBeLessThanOrEqual(size.height);
  }

  // La requisa se lleva lo que se quería vender y sin pagar: el aviso tiene que verse sobre la tienda abierta.
  await panel.locator('.dealer-sell-btn[data-id="hierba"]').evaluate(button => {
    const random = Math.random;
    Math.random = () => 0;
    button.click();
    Math.random = random;
  });
  await toastShown('Requisa');
  expect(await lastToastOnTop(page), 'el aviso queda encima de la tienda').toBe(true);
  expect(await page.evaluate(() => [window.__game.stats.dinero, window.__game.inventory.count('hierba')])).toEqual([offer.value, 0]);
  await expect(panel.locator('.dealer-sell-btn')).toHaveCount(0);

  for (const key of ['e', 'q']) {
    await page.keyboard.press(key);
    await expect(panel, `${key} cierra la tienda`).not.toHaveClass(/open/);
    await frames(page, 5);
    await expect(panel, 'la misma pulsación no la vuelve a abrir').not.toHaveClass(/open/);
    if (key === 'e') {
      await page.keyboard.press('q');
      await expect(panel, 'q también la abre').toHaveClass(/open/);
    }
  }
  await expect(radar).not.toContainText('Sin plata');
  await expect(radar).not.toContainText('Dealer');
  await expect(radar).toContainText('$');

  await page.evaluate(() => { window.__game.clock.hour = 12; });
  await page.keyboard.press('e');
  await expect(panel.locator('.dealer-empty')).toContainText('De día');
  await expect(panel.locator('.dealer-sell-btn')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test('con el mando, vender en la tienda no pierde la fila y nunca salta a comprar', async ({ page }) => {
  const errors = collectErrors(page);
  const press = await simulatedPad(page);
  await start(page);
  await page.evaluate(async () => {
    const game = window.__game, { ITEMS } = await import('/src/data/items.js');
    game.inventory.clear();
    game.inventory.add(ITEMS.pegante, 1);
    game.inventory.add(ITEMS.hierba, 2);
    game.stats.dinero = 0;
    game.clock.hour = 22;
    window.__realRandom = Math.random;
    Math.random = () => .99; // sin requisa
    game.hud.toggleDealerPanel();
  });
  const panel = page.locator('#dealer-panel'), sellers = panel.locator('.dealer-sell-btn');
  await expect(panel).toHaveClass(/open/);
  await frames(page, 3); // El mando ignora lo que ya venía pulsado al abrir: primero tiene que ver la tienda.
  await sellers.first().focus();
  await press(0); // A
  await expect(sellers).toHaveCount(1);
  await expect(sellers.first(), 'sigue en la venta que queda').toBeFocused();
  await press(0);
  await expect(sellers).toHaveCount(0);
  const sold = await page.evaluate(() => window.__game.stats.dinero);
  expect(sold).toBeGreaterThan(0);
  await expect(panel.locator('.dealer-empty'), 'sin ventas espera en el aviso').toBeFocused();
  await press(0);
  await press(0);
  expect(await page.evaluate(() => window.__game.stats.dinero), 'A no compra por inercia').toBe(sold);
  await press(1); // B
  await expect(panel).not.toHaveClass(/open/);
  await page.evaluate(() => { Math.random = window.__realRandom; });
  expect(errors).toEqual([]);
});

test('con el mando, quedarse sin plata en la tienda deja el foco en la fila y A no compra ni vende otra cosa', async ({ page }) => {
  const errors = collectErrors(page);
  const press = await simulatedPad(page);
  await start(page);
  await page.evaluate(async () => {
    const game = window.__game, { ITEMS, dealerPrice } = await import('/src/data/items.js');
    game.inventory.clear();
    game.inventory.add(ITEMS.hierba, 1);
    game.stats.dinero = dealerPrice(ITEMS.tintico);
    game.clock.hour = 22;
    game.hud.toggleDealerPanel();
  });
  const panel = page.locator('#dealer-panel'), buy = page.locator('.dealer-buy-btn[data-id="tintico"]');
  await expect(panel).toHaveClass(/open/);
  await frames(page, 3); // El mando ignora lo que ya venía pulsado al abrir: primero tiene que ver la tienda.
  await buy.focus();
  await press(0); // A: compra y se queda sin plata.
  await expect(buy).toBeDisabled();
  const row = panel.locator('.dealer-product', { has: buy });
  await expect(row, 'espera en la fila que ya no se puede comprar').toBeFocused();
  const bag = () => page.evaluate(() => [window.__game.stats.dinero, window.__game.inventory.items.map(({ id, qty }) => `${id}×${qty}`).join()]);
  const bought = await bag();
  expect(bought[0]).toBe(0);
  await press(0);
  await press(0);
  expect(await bag(), 'insistir no compra ni vende otra cosa').toEqual(bought);
  await press(13); // Abajo: la cruceta sigue desde la fila, y las demás de Comprar tampoco se pueden pulsar.
  await expect(panel.locator('.dealer-sell-btn').first()).toBeFocused();
  await expect(row, 'sin el foco deja de ser una parada').not.toHaveAttribute('tabindex');
  await press(1); // B
  await expect(panel).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

// Cuadro a cuadro desde que se acuesta hasta 40 después de despertar: el mayor salto de altura del cuerpo y lo que recorrió en el piso.
const watchWake = page => page.evaluate(() => new Promise(resolve => {
  const game = window.__game, player = game.player, from = player.position.clone();
  let left = 40, previous = null, biggestStep = 0;
  const sample = () => {
    let top = -Infinity;
    player.character.group.traverse(node => { top = Math.max(top, node.matrixWorld.elements[13]); });
    const height = top - player.position.y;
    if (previous !== null) biggestStep = Math.max(biggestStep, Math.abs(height - previous));
    previous = height;
    if (!game.isSleeping && --left <= 0) {
      resolve({ biggestStep, moved: Math.hypot(player.position.x - from.x, player.position.z - from.z) });
      return;
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}));

test('quien se acuesta corriendo no resbala al despertar y se levanta de a poco, también si ya va andando', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page);
  await frames(page, 30);
  const standing = await bodyHeight(page);
  const sleepRunning = () => page.evaluate(() => {
    const game = window.__game;
    Object.assign(game.built, { base: true, paredes: true });
    game.stats.higiene = 90;
    game.player.velocity.set(0, 0, 6); // Llegó corriendo y pulsó E sin frenar.
    game.sleep();
  });

  await sleepRunning();
  const still = await watchWake(page);
  expect(still.moved, 'sin teclas no resbala').toBeLessThan(.001);
  // A 10 cuadros por segundo un cuadro cambia hasta la mitad del cuerpo; de pie de golpe serían casi tres cuartos.
  expect(still.biggestStep, `de pie mide ${standing}`).toBeLessThan(standing * .65);

  await sleepRunning();
  await page.keyboard.down('w');
  const walking = await watchWake(page);
  await page.keyboard.up('w');
  expect(walking.moved, 'con W sí camina').toBeGreaterThan(.3);
  expect(walking.biggestStep, `de pie mide ${standing}`).toBeLessThan(standing * .65);
  expect(errors).toEqual([]);
});

test('dormir sucio en la pose nueva puede pegar sarna y la pomada la cura; sin la enfermedad no se gasta', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page);
  await page.evaluate(async () => {
    const game = window.__game;
    const { ITEMS } = await import('/src/data/items.js');
    game.inventory.clear();
    game.inventory.add(ITEMS.pomada, 1);
    Object.assign(game.built, { base: true, paredes: true });
    game.stats.higiene = 10;
  });
  const toastShown = await recordToasts(page);
  const usePomada = async () => {
    await page.keyboard.press('i');
    await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
    await page.locator('.inv-slot[data-i="0"]').click();
    await page.keyboard.press('Enter');
    const onTop = await lastToastOnTop(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
    return onTop;
  };
  expect(await usePomada(), 'el aviso queda encima del inventario').toBe(true);
  await toastShown('No tengo sarna');
  expect(await page.evaluate(() => window.__game.inventory.count('pomada'))).toBe(1);

  await frames(page, 10);
  const standing = await bodyHeight(page);
  const action = await page.evaluate(() => {
    const game = window.__game, random = Math.random;
    Math.random = () => 0;
    game.sleep();
    Math.random = random;
    return game.player.action;
  });
  expect(action).toBe('dormir');
  const asleep = await watchSleep(page);
  expect(asleep.frames, 'el sueño se dibuja cuadro a cuadro').toBeGreaterThan(1);
  expect(asleep.lowest, `de pie mide ${standing}`).toBeLessThan(standing * .6);
  expect(await skeletonIsFinite(page)).toBe(true);
  await toastShown('Dormí sucio');
  expect(await page.evaluate(() => window.__game.player.action), 'despierto no sigue acostado').toBe(null);
  await expect.poll(() => bodyHeight(page)).toBeGreaterThan(standing * .9);
  await expect(page.locator('#disease-panel')).toContainText('Sarna');
  expect(await page.evaluate(() => !!JSON.parse(localStorage.getItem('habitante-de-calle-save-v1')).diseases.active.sarna), 'queda guardada').toBe(true);

  await usePomada();
  await toastShown('Me curé: Sarna');
  expect(await page.evaluate(() => [window.__game.diseases.hasAny, window.__game.inventory.count('pomada')])).toEqual([false, 0]);
  expect(errors).toEqual([]);
});
