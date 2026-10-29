import { test, expect } from '@playwright/test';

// Flujos del PR #4 original, adaptados a carga inicial, pausa e interfaz actuales.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

async function startNewGame(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#menu-title')).toHaveText('Nota del desarrollador');
  // La nota actual oculta temporalmente los créditos; conserva el enlace de colaboración.
  await expect(page.getByRole('link', { name: 'Ver issues del proyecto original' })).toHaveAttribute('href', 'https://github.com/juanagogo/bazuko/issues');
  await expect(page.locator('#menu')).toContainText('issues abiertos al público');
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect(page.locator('#creator-modal')).toBeHidden();
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.locator('#player-name')).toHaveText('Parcero QA');
}

test('partida nueva, talentos, recetas y edición del personaje', async ({ page }) => {
  await startNewGame(page);
  await expect(page.locator('#clock')).toHaveText(/Día 1 — \d{2}:\d{2}/);
  await page.keyboard.press('T');
  await expect(page.locator('#talent-panel')).toHaveClass(/open/);
  await expect(page.locator('#talent-panel')).toContainText('Árbol de Talentos');
  await page.keyboard.press('Escape');
  await expect(page.locator('#talent-panel')).not.toHaveClass(/open/);
  await expect(page.locator('#menu')).toBeHidden();

  await page.keyboard.press('C');
  await expect(page.locator('#craft-panel')).toHaveClass(/open/);
  await expect(page.locator('#craft-panel')).toContainText('Mesa de Crafteo');
  await expect(page.locator('#craft-panel .craft-recipe').first()).toBeVisible();
  await expect(page.locator('#craft-panel .craft-go')).toBeDisabled();
  // Con los materiales de la curita, elegirla y fabricarla desde el banco.
  await page.evaluate(async () => {
    const { ITEMS } = await import('/src/data/items.js');
    window.__game.inventory.add(ITEMS.botella, 1);
    window.__game.inventory.add(ITEMS.carton, 1);
  });
  await page.keyboard.press('C');
  await page.keyboard.press('C');
  await page.locator('#craft-panel .craft-recipe[data-id="curita"]').click();
  await expect(page.locator('#craft-panel .craft-recipe[data-id="curita"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#craft-panel .craft-go').click();
  expect(await page.evaluate(() => window.__game.inventory.count('curita'))).toBe(2);
  await expect(page.locator('#craft-panel .craft-reason')).toContainText('Te faltan 2 materiales');
  // Un panel abierto pausa el juego: cerrarlo antes de editar la apariencia.
  await page.keyboard.press('Escape');
  await page.keyboard.press('P');
  await expect(page.locator('#creator-modal')).toBeVisible();
  await expect(page.locator('#creator-title')).toHaveText('Crea tu personaje');
  await page.locator('#creator-close').click();
  await expect(page.locator('#creator-modal')).toBeHidden();
});

test('ayuda bajo demanda, inventario y pausa sin abrir dos paneles al pulsar Escape', async ({ page }) => {
  await startNewGame(page);
  const help = page.locator('#controls-help-toggle');
  await expect(help).toHaveText('!');
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await help.click();
  await expect(page.locator('#controls-help-content')).toBeVisible();
  await expect(page.locator('#controls-help-content')).toContainText('Inventario');
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('I');
  await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
  await expect(page.locator('#menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-title')).toHaveText('Partida en Pausa');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
});

test('mapa con M, destino por clic y por la lista, ruta en el radar y pestañas de la pausa', async ({ page }) => {
  await startNewGame(page);
  await expect(page.locator('#minimap-canvas')).toBeVisible();
  await expect(page.locator('#minimap-info')).not.toBeEmpty();

  await page.keyboard.press('m');
  await expect(page.locator('#menu-title')).toHaveText('Partida en Pausa');
  await expect(page.getByRole('tab', { name: /Mapa/ })).toHaveAttribute('aria-selected', 'true');
  const canvas = page.locator('.map-view__canvas');
  await expect(canvas).toBeVisible();
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/mapa.png` });

  // Clic sobre el mapa: marca destino y calcula ruta.
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * .3, box.y + box.height * .3);
  await expect.poll(() => page.evaluate(() => window.__game.gps.waypoint?.name)).toBeTruthy();
  await expect(page.locator('.map-view__dest strong')).toBeVisible();

  // Lista «Ir a…»: la recicladora reemplaza el destino y tiene ruta a pie.
  await page.locator('.map-view__place', { hasText: 'Recicladora' }).click();
  const route = await page.evaluate(() => ({ name: window.__game.gps.waypoint.name, points: window.__game.gps.route.length }));
  expect(route.name).toBe('Recicladora');
  expect(route.points).toBeGreaterThan(1);
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/mapa-ruta.png` });

  // Q/E recorren las pestañas; M desde otra pestaña vuelve al mapa y desde el mapa cierra.
  await page.keyboard.press('e');
  await expect(page.getByRole('tab', { name: /Estado/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.pause-needs')).toBeVisible();
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/estado.png` });
  await page.keyboard.press('e');
  await expect(page.locator('.pause-settings')).toBeVisible();
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/ajustes.png` });
  await page.keyboard.press('e');
  await expect(page.locator('.pause-controls')).toContainText('Abrir / cerrar el mapa');
  await page.keyboard.press('m');
  await expect(page.getByRole('tab', { name: /Mapa/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('m');
  await expect(page.locator('#menu')).toBeHidden();

  await expect(page.locator('#minimap-info')).toContainText('Recicladora');
  await expect.poll(() => page.evaluate(() => window.__game.gpsBeacon.group.visible)).toBe(true);
  await page.waitForTimeout(400);
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/radar.png` });

  // Clic derecho en el mapa quita el destino.
  await page.keyboard.press('m');
  await page.locator('.map-view__canvas').click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__game.gps.waypoint)).toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
});

test('volumen por categoría en Ajustes y pisadas al caminar', async ({ page }) => {
  await startNewGame(page);
  await page.locator('#game-canvas').click();
  await page.keyboard.down('w');
  // A pocos FPS en el navegador de pruebas, caminar unos metros produce las primeras pisadas.
  await expect.poll(() => page.evaluate(() => window.__game.audio._lastStep), { timeout: 30_000 }).toBeGreaterThanOrEqual(0);
  await page.keyboard.up('w');

  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-title')).toHaveText('Partida en Pausa');
  await page.getByRole('tab', { name: /Ajustes/ }).click();
  for (const name of ['ambiente', 'tráfico', 'voces', 'efectos']) {
    await expect(page.getByRole('slider', { name: `Volumen de ${name}` })).toBeVisible();
  }
  await page.getByRole('slider', { name: 'Volumen de tráfico' }).fill('40');
  await expect.poll(() => page.evaluate(() => window.__game.audio.getMix('traffic'))).toBe(.4);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bazuko.audio_mix')).traffic)).toBe(.4);
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/ajustes-sonido.png` });
});
