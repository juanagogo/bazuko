import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { ITEMS } from '../../src/data/items.js';

test.use({ video: 'off', viewport: { width: 1440, height: 980 }, launchOptions: {
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: [], chromiumSandbox: true
} });

test('Inventario: tirar, recuperar, pausar el plazo y desaparecer sin duplicar', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function capture(name) {
    if (!process.env.DROP_SHOTS) return;
    await mkdir(process.env.DROP_SHOTS, { recursive: true });
    await page.screenshot({ path: `${process.env.DROP_SHOTS}/${name}.png` });
  }
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  // Solo se modifica el contexto desechable de esta prueba, nunca el perfil personal.
  await page.evaluate(ITEMS => {
    const g = window.__game;
    g.inventory.items = [];
    g.inventory.add(ITEMS.lata, 3);
    g.inventory.add(ITEMS.agua, 2);
    g.inventory.add(ITEMS.madera, 3);
    g.inventory.add(ITEMS.radioTransistor, 2);
    g.player.position.set(118.8, g.world.active.getGroundHeight(118.8, 104), 104);
    g.player.root.rotation.y = Math.PI;
    g.cameraRig.yaw = 0;
    g.cameraRig.follow(g.player.position, 0, g.collisions);
  }, ITEMS);
  async function drop(id, all) {
    await page.keyboard.press('i');
    await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
    const at = await page.evaluate(id => window.__game.inventory.items.findIndex(item => item.id === id), id);
    await page.locator(`.inv-slot[data-i="${at}"]`).click();
    await page.locator(`[data-act="${all ? 'dropAll' : 'drop1'}"]`).click();
    await expect.poll(() => page.evaluate(id => window.__game.droppedItems.items.find(item => item.item.id === id)?.quantity ?? 0, id)).toBe(all ? id === 'madera' ? 3 : 2 : 1);
  }
  await drop('lata', false);
  expect(await page.evaluate(() => window.__game.inventory.count('lata'))).toBe(2);
  await capture('inventario-tirar-una');
  // El inventario mantiene el plazo completo aunque permanezca abierto más de 10 s.
  await page.waitForTimeout(10_500);
  expect(await page.evaluate(() => window.__game.droppedItems.items[0].remaining)).toBe(10);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const g = window.__game;
    g.player.position.copy(g.droppedItems.items[0].position);
  });
  await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('dropped-item');
  await capture('lata-en-la-calle');
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => window.__game.inventory.count('lata'))).toBe(3);
  expect(await page.evaluate(() => window.__game.droppedItems.items.length)).toBe(0);

  await drop('agua', true);
  expect(await page.evaluate(() => window.__game.inventory.count('agua'))).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('habitante-de-calle-save-v1')).inventory.items.some(item => item.id === 'agua'))).toBe(false);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game.player.position.copy(window.__game.droppedItems.items[0].position));
  await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('dropped-item');
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => window.__game.inventory.count('agua'))).toBe(2);

  await drop('madera', true);
  await page.keyboard.press('Escape');
  await capture('tablas-en-la-calle');
  await expect.poll(() => page.evaluate(() => window.__game.droppedItems.items.length), { timeout: 20_000 }).toBe(0);
  expect(await page.evaluate(() => window.__game.inventory.count('madera'))).toBe(0);
  await capture('despues-de-diez-segundos');

  await drop('radioTransistor', true);
  await page.keyboard.press('Escape');
  await capture('radio-en-la-calle');
  await page.reload();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => window.__game?._loading)).toBe(false);
  expect(await page.evaluate(() => window.__game.droppedItems.items.length)).toBe(0);
  expect(await page.evaluate(() => window.__game.inventory.count('radioTransistor'))).toBe(0);
  expect(await page.evaluate(() => window.__game.inventory.count('lata'))).toBe(3);
  expect(await page.evaluate(() => window.__game.inventory.count('agua'))).toBe(2);
  expect(errors).toEqual([]);
});
