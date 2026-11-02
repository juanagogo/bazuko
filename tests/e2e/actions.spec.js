import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()); });
async function start(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
}
async function shot(page, testInfo, name) {
  const outputPath = file => process.env.UPGRADE_SHOTS ? `${process.env.UPGRADE_SHOTS}/${file}` : testInfo.outputPath(file);
  await page.screenshot({ path: outputPath(`${name}.png`) });
  if (await page.locator('#photo-mode').isVisible()) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Guardar foto', exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs(outputPath(`${name}-sin-interfaz.png`));
  }
}

test('caminar, correr, salto articulado y golpe con reacción ocurren en la partida real', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text()); });
  await start(page);
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.__game.player.state)).toBe('walk');
  await shot(page, testInfo, 'caminar');
  await page.keyboard.down('Shift');
  await expect.poll(() => page.evaluate(() => window.__game.player.state)).toBe('run');
  await shot(page, testInfo, 'correr');
  await page.evaluate(() => {
    const game = window.__game;
    const capture = () => {
      const player = game.player;
      if (!player.isGrounded && player.airTime > .14 && player.jumpVelocity < 1) {
        game.photoMode.enter(); return;
      }
      requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  });
  await page.keyboard.press('Space');
  await expect(page.locator('#photo-mode')).toBeVisible();
  await page.keyboard.up('w'); await page.keyboard.up('Shift');
  const airborne = await page.evaluate(() => ({ ...window.__game.player.movement, state: window.__game.player.state }));
  expect(airborne.grounded).toBe(false); expect(airborne.airTime).toBeGreaterThan(.14);
  expect(airborne.state).toBe('jump');
  await shot(page, testInfo, 'salto');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game.player.isGrounded)).toBe(true);

  await page.evaluate(() => {
    const game = window.__game, player = game.player;
    player.position.set(112.98, game.world.active.getGroundHeight(112.98, 97.84), 97.84);
    player.root.position.copy(player.position); player.root.rotation.set(0, Math.PI, 0);
    player.velocity.set(0, 0, 0); player.resetGrounding(); player.action = null;
    game.cameraRig.yaw = -.7; game.cameraRig._snap = true;
    const npc = game.world.active.npcs.find(item => item.character && !item._disposed);
    npc.position.set(112.98, player.position.y, 96.6); npc.root.position.copy(npc.position);
    npc.root.rotation.y = 0; npc.walkSpeed = 0;
    window.__combatCheck = { money: game.stats.dinero, npc, seenWindup: false, earlyReward: false, hit: false };
    const sample = () => {
      const probe = window.__combatCheck;
      if (player.attack?.phase === 'windup') {
        probe.seenWindup = true;
        probe.earlyReward ||= game.stats.dinero !== probe.money;
      }
      if (npc.health < npc.maxHealth && npc.staggerTimer > 0
        && npc.action === 'recibirGolpe' && npc.actionProgress > .1) {
        probe.hit = true; game.photoMode.enter(); return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press('g');
  await expect(page.locator('#photo-mode')).toBeVisible();
  const combat = await page.evaluate(() => ({ windup: window.__combatCheck.seenWindup,
    earlyReward: window.__combatCheck.earlyReward,
    hit: window.__combatCheck.hit, reward: window.__game.stats.dinero - window.__combatCheck.money,
    health: window.__combatCheck.npc.health }));
  expect(combat.windup).toBe(true); expect(combat.hit).toBe(true);
  expect(combat.earlyReward).toBe(false);
  expect(combat.reward).toBeGreaterThanOrEqual(200); expect(combat.health).toBeLessThan(100);
  await shot(page, testInfo, 'golpe');
  expect(errors).toEqual([]);
});

test('lanzarse al lago, nadar con estela y salir andando conserva el puente', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text()); });
  await start(page);
  await page.evaluate(async () => {
    const game = window.__game, player = game.player;
    const { viaductSurface } = await import('/src/world/bogota/ColpatriaViaduct.js');
    player.position.set(78.5, viaductSurface(78.5, 262), 262);
    player.root.position.copy(player.position); player.velocity.set(0, 0, 0); player.resetGrounding();
    game.cameraRig._snap = true;
  });
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__game.player.isGrounded)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__game.player.isGrounded)).toBe(true);
  expect(await page.evaluate(() => window.__game.player.isSwimming)).toBe(false);
  expect(await page.evaluate(() => window.__game.player.position.y)).toBeGreaterThan(7);

  // Caída real desde la cota del puente sobre una porción libre del lago.
  await page.evaluate(() => {
    const game = window.__game, player = game.player;
    player.position.set(40, 7.82, 262); player.root.position.copy(player.position);
    player.velocity.set(0, 0, 0); player.resetGrounding(); player.isGrounded = false;
    game.cameraRig.yaw = 0; game.cameraRig._snap = true;
    window.__diveProbe = { low: 7.82, splash: false };
    const sample = () => {
      window.__diveProbe.low = Math.min(window.__diveProbe.low, player.position.y);
      window.__diveProbe.splash ||= game.waterEffects.drops.geometry.drawRange.count > 0;
      if (!player.isSwimming || !window.__diveProbe.splash) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await expect.poll(() => page.evaluate(() => window.__game.player.isSwimming)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__diveProbe.splash)).toBe(true);
  expect(await page.evaluate(() => window.__diveProbe.low)).toBeGreaterThan(-2);
  const before = await page.evaluate(() => window.__game.player.position.x);
  await page.keyboard.down('d'); await page.keyboard.down('Shift');
  await expect.poll(() => page.evaluate(() => window.__game.player.position.x)).toBeGreaterThan(before + 1.5);
  expect(await page.evaluate(() => window.__game.player.state)).toBe('swim');
  await expect.poll(() => page.evaluate(() => window.__game.waterEffects.rings.count)).toBeGreaterThan(0);
  await shot(page, testInfo, 'nadar');
  await page.keyboard.up('d'); await page.keyboard.up('Shift');
  // Vista diurna del agua; reloj se cambia solo en este contexto aislado de prueba.
  await page.evaluate(() => { window.__game.clock.hour = 12; });
  await page.keyboard.down('a'); await page.keyboard.down('Shift');
  await shot(page, testInfo, 'lago-dia');
  await expect.poll(() => page.evaluate(() => window.__game.player.position.x), { timeout: 25_000 }).toBeLessThan(24);
  await page.keyboard.up('a'); await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => window.__game.player.inWater)).toBe(false);
  expect(await page.evaluate(() => window.__game.player.isGrounded)).toBe(true);
  await shot(page, testInfo, 'orilla');
  expect(errors).toEqual([]);
});
