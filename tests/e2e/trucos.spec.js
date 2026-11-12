import { test, expect } from '@playwright/test';

// Entra al juego creando el personaje, como el resto de las pruebas de navegador.
async function entrar(page, ruta) {
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('bazuko.graphics_quality', 'baja'); } catch { /* sin almacenamiento */ } });
  await page.goto(ruta);
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Tester');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
}

test('el modo trucos solo existe con ?trucos en la dirección', async ({ page }) => {
  await entrar(page, '/?trucos');
  expect(await page.evaluate(() => !!window.__game.cheats)).toBe(true);
  await expect(page.locator('#trucos-marca')).toHaveText('Trucos');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-tab', { hasText: 'Trucos' })).toHaveCount(1);
  await page.keyboard.press('Escape');

  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game?.cheats)).toBe(false);
  await expect(page.locator('#trucos-marca')).toHaveCount(0);
});

test('la pestaña Trucos da costal, cambuche, plata y no guarda la partida', async ({ page }) => {
  await entrar(page, '/?trucos');
  await page.keyboard.press('Escape');
  await page.locator('.pause-tab', { hasText: 'Trucos' }).click();
  const panel = page.locator('.pause-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.pause-section-title', { hasText: 'Jugador' })).toHaveCount(1);

  // El costal no construye: primero se llena y se comprueba que el cambuche sigue igual.
  const antes = await page.evaluate(() => ({ built: window.__game.built, guardado: localStorage.getItem('habitante-de-calle-save-v1') }));
  await panel.getByRole('button', { name: 'Llenarlo con todo' }).click();
  const trasCostal = await page.evaluate(() => ({
    built: window.__game.built, itemCount: window.__game.inventory.itemCount,
  }));
  expect(trasCostal.itemCount).toBeGreaterThan(100);
  expect(trasCostal.built).toEqual(antes.built);

  await panel.getByRole('button', { name: 'Construir y mejorar todo' }).click();
  const built = await page.evaluate(() => Object.keys(window.__game.built).sort());
  expect(built).toEqual(['base', 'cama', 'fogon', 'paredes', 'techo', 'vela']);

  await panel.getByRole('button', { name: /Dar \$/ }).click();
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBeGreaterThan(900_000);

  const guardado = await page.evaluate(() => {
    const ok = window.__game._save();
    return { ok, crudo: localStorage.getItem('habitante-de-calle-save-v1') };
  });
  expect(guardado.ok).toBe(false);
  expect(guardado.crudo).toBe(antes.guardado);
});
