import { expect, test } from '@playwright/test';

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, video: 'off' });

test('comprar el maletín, repartir en bici y recuperar el equipo tras tres faltas', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#cr-name').fill('Domiciliario QA');
  await page.locator('#creator-done').click();
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click({ timeout: 120_000 });

  const goTo = kind => page.evaluate(kind => {
    const g = window.__game, player = g.player;
    const point = kind === 'shop' ? g.deliveries.shops[0].position
      : kind === 'station' ? g.bikeStations[0].position : g.deliveries.destination.position;
    player.position.set(point.x, point.y, point.z + (kind === 'station' ? 1.6 : 0));
    player.root.position.copy(player.position);
    player.resetGrounding();
    player.velocity.set(0, 0, 0);
    if (player.bicycle) {
      player.bicycle.position.copy(player.position);
      player.bicycle.speed = 0;
    }
    g.cameraRig._snap = true;
  }, kind);

  await expect.poll(() => page.evaluate(() => window.__game.stats.dinero)).toBe(0);
  await page.keyboard.press('m');
  await expect(page.locator('.map-view')).toContainText('La Esquinita — Equipo de Rappi');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Mostrar controles', exact: true }).click();
  await page.getByRole('button', { name: 'Guía de domicilios de Rappi' }).click();
  const guide = page.locator('.pause-rappi-help');
  await expect(guide).toContainText('$ 50.000');
  await expect(guide).toContainText('Pulse E en el comercio para recoger');
  await guide.getByRole('button', { name: 'Abrir Misiones' }).click();
  const streetTab = page.getByRole('tab', { name: 'Calle', exact: true });
  const rappiTab = page.getByRole('tab', { name: 'Rappi', exact: true });
  await expect(streetTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.missions-cards-grid')).toBeVisible();
  await streetTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(rappiTab).toBeFocused();
  await expect(rappiTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.missions-cards-grid')).toHaveCount(0);
  await expect(page.locator('.missions-modal-body')).toContainText('Maletín de Rappi', { ignoreCase: true });
  await page.getByRole('button', { name: 'Marcar La Esquinita' }).click();
  await goTo('shop');
  await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('shop');
  await page.keyboard.press('e');
  const gear = page.locator('.row').filter({ hasText: 'Maletín de Rappi' });
  await expect(gear).toContainText('$ 50.000');
  await expect(gear.getByRole('button', { name: 'Comprar', exact: true })).toBeDisabled();
  await page.evaluate(async () => {
    const { MISSION_TEMPLATES } = await import('/src/systems/DailyMissionSystem.js');
    const { stats, dailyMissions, menu } = window.__game;
    stats.dinero = 51000;
    dailyMissions.completedTypes = new Set(MISSION_TEMPLATES.slice(0, 6).map(({ type }) => type));
    menu.refresh();
  });
  await gear.getByRole('button', { name: 'Comprar', exact: true }).click();
  await expect(gear.getByRole('button', { name: 'Comprado' })).toBeDisabled();
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(1000);
  await expect.poll(() => page.evaluate(() => window.__game.player.character.group.getObjectByName('prop-maletin-domicilios')?.visible)).toBe(true);
  expect(await page.evaluate(() => window.__game.inventory.slots.map(item => item.id))).toEqual(expect.arrayContaining(['maletinRappi', 'chaquetaRappi', 'gorraRappi']));
  await page.keyboard.press('Escape');

  await page.keyboard.press('p');
  await page.getByRole('tab', { name: 'Ropa' }).click();
  const bagChip = page.getByRole('button', { name: 'Maletín de Rappi' });
  await expect(bagChip).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('equipo-de-reparto.png') });
  const randomize = value => page.evaluate(value => {
    const original = Math.random;
    Math.random = () => value;
    try { document.getElementById('creator-random').click(); }
    finally { Math.random = original; }
  }, value);
  await randomize(.75);
  await expect(bagChip).toHaveAttribute('aria-pressed', 'false');
  await randomize(.25);
  for (const name of ['Maletín de Rappi', 'Chaqueta de Rappi', 'Gorra de Rappi']) {
    await expect(page.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
  }
  await bagChip.click();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('#creator-modal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__game.deliveries.ready)).toBe(false);
  await page.keyboard.press('j');
  await expect(streetTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Aceptar pedido' })).toHaveCount(0);
  await rappiTab.click();
  await page.getByRole('button', { name: 'Poner maletín' }).click();
  await expect(page.getByRole('button', { name: 'Aceptar pedido' })).toBeVisible();
  await streetTab.click();
  await expect(page.locator('.missions-modal-body')).toContainText('Las misiones de calle están en pausa');
  expect(await page.evaluate(() => window.__game.deliveries.ready)).toBe(true);
  await page.getByRole('button', { name: 'Volver a Calle' }).click();
  await expect(streetTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.missions-modal-body')).not.toContainText('Las misiones de calle están en pausa');
  await rappiTab.click();
  await page.getByRole('button', { name: 'Poner maletín' }).click();
  await page.keyboard.press('Escape');

  await goTo('station');
  await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('bicycle-station');
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => Boolean(window.__game.player.bicycle))).toBe(true);
  for (const [type, payout, count] of [['person', 4000, 1], ['building', 4000, 2]]) {
    await page.keyboard.press('j');
    await expect(rappiTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.missions-cards-grid')).toHaveCount(0);
    await page.getByRole('button', { name: 'Aceptar pedido' }).click();
    expect(await page.evaluate(() => window.__game.deliveries.job.client.type)).toBe(type);
    expect(await page.evaluate(() => window.__game.gps.waypoint?.name)).toContain('Recoger pedido');
    await goTo('stop');
    await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('delivery');
    await page.keyboard.press('e');
    await expect.poll(() => page.evaluate(() => window.__game.deliveries.order?.pickedUp)).toBe(true);
    if (count === 1) {
      const initialSeconds = await page.evaluate(() => window.__game.deliveries.secondsLeft);
      await expect.poll(() => page.evaluate(() => window.__game.deliveries.secondsLeft)).toBeLessThan(initialSeconds);
      await expect(page.locator('#mision')).toContainText(/\d:\d{2} — ENTREGAR PEDIDO/);
      const savedTime = await page.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'));
        const save = JSON.parse(localStorage.getItem('habitante-de-calle-save-v1'));
        return save.deliveries.order.secondsLeft === window.__game.deliveries.secondsLeft;
      });
      expect(savedTime).toBe(true);
      await page.keyboard.press('j');
      await page.getByRole('button', { name: 'Volver a Calle' }).click();
      await expect(streetTab).toHaveAttribute('aria-selected', 'true');
      await rappiTab.click();
      await expect(page.locator('.missions-modal-body')).toContainText('Pedido en pausa');
      await page.getByRole('button', { name: 'Poner maletín' }).click();
      await expect(page.getByRole('button', { name: 'Seguir pedido' })).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      await page.evaluate(() => {
        const deliveries = window.__game.deliveries;
        deliveries.update(deliveries.secondsLeft);
      });
      await expect(page.locator('#mision')).toContainText('SIN PROPINA');
    }
    await page.keyboard.press('m');
    await expect(page.locator('.map-view')).toContainText('Entregar pedido');
    await page.keyboard.press('Escape');
    await goTo('stop');
    await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('delivery');
    const cash = await page.evaluate(() => window.__game.stats.dinero);
    await page.keyboard.press('e');
    await expect.poll(() => page.evaluate(() => window.__game.deliveries.completed)).toBe(count);
    expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(cash + payout);
    expect(await page.evaluate(() => Boolean(window.__game.player.bicycle))).toBe(true);
  }

  await page.reload();
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click({ timeout: 120_000 });
  expect(await page.evaluate(() => window.__game.deliveries.serialize())).toEqual({ owned: true, equipped: ['bag', 'jacket', 'cap'], completed: 2, strikes: 0, order: null });

  await page.keyboard.press('i');
  await page.locator('.inv-slot').filter({ hasText: 'Gorra de Rappi' }).dblclick();
  await expect.poll(() => page.evaluate(() => window.__game.deliveries.equipped)).toEqual(['bag', 'jacket']);
  await page.keyboard.press('Escape');

  for (let strike = 1; strike <= 3; strike++) {
    await page.keyboard.press('j');
    await page.getByRole('button', { name: 'Aceptar pedido' }).click();
    await goTo('stop');
    await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('delivery');
    await page.keyboard.press('e');
    await expect.poll(() => page.evaluate(() => window.__game.deliveries.order?.pickedUp)).toBe(true);
    await page.keyboard.press('j');
    await page.getByRole('button', { name: 'Quedarme con el pedido (+1 falta)', exact: true }).click();
    expect(await page.evaluate(() => window.__game.deliveries.strikes)).toBe(strike);
    await page.keyboard.press('Escape');
  }
  expect(await page.evaluate(() => window.__game.inventory.count('maletinRappi'))).toBe(0);
  if (await page.evaluate(() => !!window.__game.player.bicycle)) {
    await goTo('station');
    await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('bicycle');
    await page.keyboard.press('e');
    await expect.poll(() => page.evaluate(() => !!window.__game.player.bicycle)).toBe(false);
  }
  await goTo('shop');
  await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('shop');
  await page.keyboard.press('e');
  await expect(page.getByRole('button', { name: 'Pagar multa' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__game.stats.dinero = 18000; });
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Pagar multa' }).click();
  await expect(gear.getByRole('button', { name: 'Comprado' })).toBeDisabled();
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(0);
  expect(await page.evaluate(() => window.__game.deliveries.serialize())).toEqual({ owned: true, equipped: ['bag'], completed: 2, strikes: 0, order: null });
  expect(errors).toEqual([]);
});
