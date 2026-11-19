import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// El rap en el vagón con el juego de verdad: en el torniquete del Portal se elige rapear, el viaje funde a la escena,
// suena el beat y Espacio pega cada golpe; al final la gente dice lo suyo, se cobra y se llega a la otra estación.
// Las evaluaciones solo ponen plata, energía y la hora, y programan las pulsaciones con el reloj de la canción;
// la ventana, el viaje, la escena, el juicio, el cobro y la llegada son los del juego.
// Las fotos van a RAP_FOTOS (o a test-results/rap).

test.use({ video: 'off' });

/** Oprime Espacio en cada golpe que diga `cuales`, con eventos de teclado de verdad, a la hora del reloj de la canción. */
const rimar = (page, cuales) => page.evaluate((cuales) => {
  const r = window.__game.rapBus;
  r.cancion.golpes.forEach((g, i) => {
    if (cuales === 'mitad' && i % 2) return;
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true })),
      Math.max(0, (g.t - r.tiempo()) * 1000 - 4));
  });
}, cuales);

async function entrar(page) {
  const errores = [];
  page.on('pageerror', (error) => errores.push(error.message));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  return errores;
}

/** La ventana del Portal del Centro, con plata, energía y la hora puestas. */
async function abrirPortal(page, { hora = 21, energia = 100 } = {}) {
  await page.evaluate(async ({ hora, energia }) => {
    const g = window.__game;
    Object.assign(g.stats, { dinero: 10000, energia, sed: 90, higiene: 90 });
    g.clock.hour = hora;
    const { openTransit } = await import('/src/ui/streetMenus.js');
    openTransit(g, g.street.stops.find((s) => s.stop.id === 'portal'));
  }, { hora, energia });
  await expect(page.locator('.viaje')).toBeVisible();
}

test('Rap en el vagón: rapea todo en la caja, se luce, cobra y llega a la Calle 72', async ({ page }) => {
  test.setTimeout(400_000);
  const fotos = process.env.RAP_FOTOS ?? path.join('test-results', 'rap');
  await mkdir(fotos, { recursive: true });
  const errores = await entrar(page);
  await abrirPortal(page);

  // Rapear y pedir son de una en una.
  const rapear = page.locator('.viaje-rapear');
  const pedir = page.locator('.viaje-pedir').first();
  await expect(rapear).toContainText('Rapear en el vagón');
  await pedir.click();
  await rapear.click();
  await expect(rapear).toHaveAttribute('aria-checked', 'true');
  await expect(pedir).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: path.join(fotos, '1-estacion.png') });
  await page.locator('.viaje .rows li', { hasText: 'Calle 72' }).getByRole('button').click();

  // El viaje funde a la escena: el juego queda quieto, con su saludo de la hora.
  await expect(page.locator('#rap-bus')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.rap__ruta')).toHaveText('En el articulado, rumbo a Metro, Estación Calle 72');
  await expect(page.locator('.rap__gente li')).toHaveCount(5);
  expect(await page.evaluate(() => window.__game.paused)).toBe(true);
  await expect(page.locator('.rap__escena')).toContainText('Buenas noches, señores pasajeros');
  await rimar(page, 'todo');
  await expect.poll(() => page.evaluate(() => window.__game.rapBus.tiempo() / window.__game.rapBus.cancion.compas), { timeout: 30_000 }).toBeGreaterThan(3.85);
  await expect(page.locator('.rap__zona.is-justo, .rap__zona.is-bien').first()).toBeVisible();
  await page.screenshot({ path: path.join(fotos, '2-rimando.png') });

  // La cuenta: cada pasajero con lo suyo, el total y un solo verbo.
  await expect(page.locator('.rap__cuenta')).toBeVisible({ timeout: 40_000 });
  const r = await page.evaluate(() => window.__game.rapBus.resultado);
  expect(r.nivel).toBe('durisimo');
  await expect(page.locator('.rap__grito')).toHaveText('¡ME LUCÍ!');
  await expect(page.locator('.rap__fila')).toHaveCount(5);
  await expect(page.locator('.rap__cuenta')).not.toContainText('null');
  await page.screenshot({ path: path.join(fotos, '3-cuenta.png') });
  await page.getByRole('button', { name: 'Bajarme del bus' }).click();

  // Llega: el juego sigue, en la Calle 72, con la plata del rap y sin el pasaje.
  await expect.poll(() => page.evaluate(() => window.__game.paused), { timeout: 30_000 }).toBe(false);
  await expect(page.locator('#rap-bus')).toBeHidden();
  const llegada = await page.evaluate(() => ({ dinero: window.__game.stats.dinero, z: window.__game.player.position.z }));
  expect(llegada.dinero).toBe(10000 - 3200 + r.total);
  expect(Math.abs(llegada.z - 112)).toBeLessThan(3);
  await page.screenshot({ path: path.join(fotos, '4-llegada.png') });
  expect(errores).toEqual([]);
});

test('Rap en el vagón: a medias se traba y lo tacha; con Esc se calla; sin energía no se ofrece', async ({ page }) => {
  test.setTimeout(400_000);
  const errores = await entrar(page);
  await abrirPortal(page, { hora: 8 });
  await page.locator('.viaje-rapear').click();
  await page.locator('.viaje .rows li', { hasText: 'Calle 26' }).getByRole('button').click();
  await expect(page.locator('#rap-bus')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.rap__escena')).toContainText('Buenos días, señores pasajeros');
  await rimar(page, 'mitad');
  // Lo que no pegó sale tachado, con la trabada al lado.
  await expect(page.locator('.rap__pedazo.is-trabado .tachado').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.rap__trabada').first()).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.locator('.rap__grito')).toHaveText('ME QUEDÉ CALLADO');
  // Machacar no se salta la cuenta: espera un momento antes de dejar bajarse con teclado.
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__game.paused), { timeout: 30_000 }).toBe(false);
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(10000 - 3200);

  // Sin energía, la opción sale tachada con el motivo al lado.
  await abrirPortal(page, { energia: 5 });
  await expect(page.locator('.viaje-rapear')).toBeDisabled();
  await expect(page.locator('.viaje-rapear')).toContainText('Estoy muy cansado para rapear');
  expect(errores).toEqual([]);
});
