import { test, expect } from '@playwright/test';

// Prueba de humo para CI: el juego arranca, se crea el personaje, se entra a la partida
// y queda una partida guardada, sin errores de página ni recursos faltantes.
test('arranca, crea el personaje y guarda sin errores', async ({ page }) => {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`error de página: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(() => localStorage.clear());

  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Humo');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 150_000 });
  await expect(page.locator('#game-canvas')).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('habitante-de-calle-save-v1') ?? 'null'));
  expect(saved).not.toBeNull();
  await expect(page.locator('#error-screen')).toHaveCount(0);
  expect(problems).toEqual([]);
});
