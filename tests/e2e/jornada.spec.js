// tests/e2e/jornada.spec.js
// La jornada en el juego de verdad: al anochecer sale el aviso una sola vez, el reloj queda subrayado con su título
// y la patrulla ve menos lejos.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()); });

test('al anochecer avisa una vez, el reloj marca la noche y la patrulla ve menos', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);

  // La partida nueva empieza a las 6: de mañana y sin aviso.
  const clock = page.locator('#clock');
  await expect(clock).toHaveAttribute('data-franja', 'manana');
  await expect(clock).toHaveAttribute('title', /^La mañana: la Policía ve lejos/);
  const dia = await page.evaluate(() => {
    window.__avisosJornada = [];
    window.addEventListener('toast', (e) => window.__avisosJornada.push(e.detail.text));
    return { franja: window.__game.jornada.franja.id, vista: window.__game.traffic.sightRange };
  });
  expect(dia.franja).toBe('manana');
  expect(await clock.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');

  // Un minuto de juego antes de las 20:00: el reloj corre solo y cruza la hora.
  await page.evaluate(() => { window.__game.clock.hour = 19.98; });
  await expect(page.locator('.loot-toast', { hasText: 'Anocheció' })).toBeVisible({ timeout: 10_000 });
  await expect(clock).toHaveAttribute('data-franja', 'noche');
  await expect(clock).toHaveAttribute('title', 'La noche: la Policía ve menos, pero la calle se pone brava');
  expect(await clock.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline');

  // Dos segundos más de noche: el aviso no se repite.
  await page.waitForTimeout(2_000);
  const noche = await page.evaluate(() => ({
    avisos: window.__avisosJornada.filter((t) => t.startsWith('Anocheció')).length,
    hora: window.__game.clock.hour, franja: window.__game.jornada.franja.id, vista: window.__game.traffic.sightRange,
  }));
  expect(noche.avisos).toBe(1);
  expect(noche.hora).toBeGreaterThan(20);
  expect(noche.franja).toBe('noche');
  expect(noche.vista).toBeCloseTo(dia.vista * .75 / 1.15, 3);
  expect(errors).toEqual([]);
});
