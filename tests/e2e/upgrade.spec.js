import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

async function startNewGame(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Bogotá QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#menu-title')).toHaveText('Nota del desarrollador');
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect(page.locator('#player-name')).toHaveText('Bogotá QA');
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
}

async function expectContainedHorizontally(page, selectors) {
  for (const selector of selectors) {
    const bounds = await page.locator(selector).evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: innerWidth,
        overflow: element.scrollWidth - element.clientWidth };
    });
    expect(bounds.left, `${selector}: borde izquierdo`).toBeGreaterThanOrEqual(-1);
    expect(bounds.right, `${selector}: borde derecho`).toBeLessThanOrEqual(bounds.viewport + 1);
    expect(bounds.overflow, `${selector}: contenido horizontal`).toBeLessThanOrEqual(1);
  }
}

test('HUD a 375 px conserva radar, controles táctiles y necesidades accesibles bajo demanda', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startNewGame(page);

  await expect(page.locator('#clock')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator('#day-display')).toHaveText('Día 1');
  await expect(page.locator('#money')).not.toBeEmpty();
  await expect(page.locator('#hud-vitals [data-stat="salud"]')).toBeVisible();
  await expect(page.locator('#hud-vitals [data-stat="energia"]')).toBeVisible();
  await expect(page.locator('#minimap-canvas')).toBeVisible();
  await expectContainedHorizontally(page, ['#hud-dock', '#topbar', '#game-settings']);

  // Ningún tamaño guardado saca el cartón de la pantalla, tampoco en móvil.
  for (const size of ['s', 'm', 'l']) {
    await page.evaluate(value => window.__game.minimap.setSize(value), size);
    await expect(page.locator('#hud-dock')).toHaveAttribute('data-radar-size', size);
    await expectContainedHorizontally(page, ['#hud-dock']);
  }
  await page.evaluate(() => window.__game.minimap.setSize('m'));

  const disclosure = page.locator('#needs-toggle');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure).toHaveAttribute('aria-controls', 'needs-details');
  await expect(disclosure).toHaveAccessibleName(/\S/);
  await expect(page.locator('#needs-details')).toBeHidden();
  await disclosure.focus();
  await disclosure.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#needs-details')).toBeVisible();
  for (const [id, label] of [['higiene', 'Higiene'], ['animo', 'Ánimo'], ['vicio', 'Vicio']]) {
    const row = page.locator(`#needs-details [data-stat="${id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(label);
    await expect(row.getByRole('meter', { name: label, exact: true })).toBeVisible();
  }
  await expectContainedHorizontally(page, ['#hud-dock', '#needs-details']);
  await disclosure.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#needs-details')).toBeHidden();
  await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);

  // Lo que está mal se sube solo: el jugador no debe abrir el panel
  // para enterarse de la sed o de la abstinencia.
  await page.evaluate(() => {
    window.__game.stats.sed = 12;
    window.__game.stats.vicio = 12;
  });
  await expect(page.locator('#hud-vitals [data-stat="sed"]')).toHaveAttribute('data-level', 'critical');
  await expect(page.locator('#needs-subidas [data-stat="vicio"]')).toBeVisible();
  await expect(page.locator('#status')).toContainText(/beber agua/i);
  await expect(page.locator('#needs-details')).toBeHidden();
  await page.evaluate(() => {
    const stats = window.__game.stats;
    for (const id of ['hambre', 'sed', 'energia', 'salud', 'higiene', 'animo', 'vicio']) stats[id] = 80;
    // La integración añade frío nocturno: de día no quedan avisos climáticos.
    window.__game.clock.hour = 12;
  });
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#needs-subidas [data-stat="vicio"]')).toHaveCount(0);

  // En móvil los controles están visibles sin hover. Comprobar también que
  // reciben el clic: un botón puede tener 44 px y seguir tapado por el canvas.
  // Las herramientas del radar salen al tocarlo; solo Pausa queda arriba.
  await page.locator('.radar__abrir').click();
  await expect(page.locator('#minimap-container')).toHaveClass(/abierto/);
  const buttons = page.locator('#game-settings button:visible, #needs-toggle, #panel-dock .dock-btn, .radar__abrir, .radar__tools button');
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    const rect = await button.boundingBox();
    expect(rect.width, `ancho: ${await button.getAttribute('aria-label') ?? await button.textContent()}`).toBeGreaterThanOrEqual(44);
    expect(rect.height, `alto: ${await button.getAttribute('aria-label') ?? await button.textContent()}`).toBeGreaterThanOrEqual(44);
    await button.click({ trial: true });
  }
  const originalZoom = await page.evaluate(() => window.__game.minimap.zoomBase);
  await page.locator('.radar__tools [data-radar="in"]').click();
  await expect.poll(() => page.evaluate(() => window.__game.minimap.zoomBase)).toBeLessThan(originalZoom);
  const closeZoom = await page.evaluate(() => window.__game.minimap.zoomBase);
  await page.locator('.radar__tools [data-radar="out"]').click();
  await expect.poll(() => page.evaluate(() => window.__game.minimap.zoomBase)).toBeGreaterThan(closeZoom);
  await page.locator('.radar__tools [data-radar="toggle"]').click();
  await expect(page.locator('#minimap-canvas')).toBeHidden();
  await page.locator('.radar__show').click();
  await expect(page.locator('#minimap-canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('hud-375.png') });
});

test('el contexto de natación sigue al jugador y queda oculto y congelado durante foto', async ({ page }, testInfo) => {
  await startNewGame(page);
  const status = page.locator('#movement-status');
  await expect(status).toBeHidden();
  const depth = await page.evaluate(() => {
    const game = window.__game;
    const water = game.world.active.getWaterInfo(45, 262);
    if (!water) throw new Error('El punto de prueba debe pertenecer al lago');
    game.player.position.set(45, water.surfaceY - .9, 262);
    game.player.root.position.copy(game.player.position);
    game.player.velocity.set(0, 0, 0);
    game.player.resetGrounding();
    game.cameraRig._snap = true;
    return water.depth;
  });
  expect(depth).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => window.__game.player.isSwimming)).toBe(true);
  await expect(status).toBeVisible();
  await expect(status).toContainText('Nadando');
  await expect(status).toContainText('WASD');
  await expect(status).toContainText('Shift');
  await page.screenshot({ path: testInfo.outputPath('hud-natacion.png') });

  await page.keyboard.press('F2');
  await expect(page.locator('#photo-mode')).toBeVisible();
  for (const selector of ['#movement-status', '#hud-dock', '#topbar', '#game-settings', '#controls-help-toggle']) {
    await expect(page.locator(selector)).toBeHidden();
  }
  const frozen = await page.evaluate(() => {
    const game = window.__game;
    return { position: game.player.position.toArray(), energy: game.stats.energia, clock: game.clock.serialize() };
  });
  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  await page.keyboard.press('i');
  await page.getByRole('button', { name: 'Girar a la izquierda', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const next = () => ++frames === 12 ? resolve() : requestAnimationFrame(next);
    requestAnimationFrame(next);
  }));
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => {
    const game = window.__game;
    return { position: game.player.position.toArray(), energy: game.stats.energia, clock: game.clock.serialize() };
  })).toEqual(frozen);
  await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#photo-mode')).toBeHidden();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(status).toBeVisible();
  await expect(status).toContainText('Nadando');

  const shallowDepth = await page.evaluate(() => {
    const game = window.__game;
    const water = game.world.active.getWaterInfo(28, 262);
    if (!water) throw new Error('El punto de prueba debe pertenecer a la orilla sumergida');
    game.player.position.set(28, water.bottomY, 262);
    game.player.root.position.copy(game.player.position);
    game.player.velocity.set(0, 0, 0);
    game.player.resetGrounding();
    game.cameraRig._snap = true;
    return water.depth;
  });
  expect(shallowDepth).toBeGreaterThan(.1);
  expect(shallowDepth).toBeLessThan(.8);
  await expect.poll(() => page.evaluate(() => window.__game.player.isSwimming)).toBe(false);
  await expect(status).toBeVisible();
  await expect(status).toContainText('En el agua');
  await expect(status).not.toContainText('Shift');

  await page.evaluate(() => {
    const game = window.__game;
    const x = 112.98, z = 97.84;
    game.player.position.set(x, game.world.active.getGroundHeight(x, z), z);
    game.player.root.position.copy(game.player.position);
    game.player.velocity.set(0, 0, 0);
    game.player.resetGrounding();
    game.cameraRig._snap = true;
  });
  await expect.poll(() => page.evaluate(() => window.__game.player.isSwimming)).toBe(false);
  await expect(status).toBeHidden();
});
