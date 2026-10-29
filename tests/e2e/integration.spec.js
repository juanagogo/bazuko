import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Cada escenario conserva el bucle real del juego. Las evaluaciones únicamente
// preparan posiciones/objetos y observan estado; no reemplazan daño ni sistemas.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

async function start(page) {
  await page.goto('/', { waitUntil: 'commit' });
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
  await page.addInitScript(() => {
    window.__testPad = { index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__testPad] });
  });
  const press = async index => {
    await page.evaluate(index => { window.__testPad.buttons[index] = { pressed: true, touched: true, value: 1 }; }, index);
    await frames(page, 3);
    await page.evaluate(index => { window.__testPad.buttons[index] = { pressed: false, touched: false, value: 0 }; }, index);
    await frames(page, 3);
  };
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
