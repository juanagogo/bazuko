import { test, expect } from '@playwright/test';
import { ITEMS } from '../../src/data/items.js';

test.use({ video: 'off' });

test('Rebusque: malabares a un carro detenido en rojo pagan con B', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  // Solo se modifica el contexto desechable de esta prueba.
  await page.evaluate(ITEMS => {
    const g = window.__game;
    g.inventory.add(ITEMS.malabares, 1);
    g.stats.energia = 100;
    g.rebusque.random = () => 0;
    window.__avisos = [];
    window.addEventListener('toast', e => window.__avisos.push(e.detail.text));
  }, ITEMS);
  // Espera un carro quieto frente a un rojo y se para a su lado hasta que la tecla ofrezca el rebusque.
  await expect.poll(() => page.evaluate(() => {
    const g = window.__game;
    if (g.interaction.rebusquePrompt) return g.interaction.rebusquePrompt;
    const v = g.traffic.vehicles.find(v => !v.police && !v.hold && v.stopped && g.traffic.stoppedAtRed(v.car.position, .1).length);
    if (!v) return '';
    const yaw = v.car.group.rotation.y;
    const x = v.car.position.x + Math.sin(yaw) * 2.4, z = v.car.position.z + Math.cos(yaw) * 2.4;
    g.player.position.set(x, v.car.position.y, z);
    g.player.velocity?.set?.(0, 0, 0);
    return '';
  }), { timeout: 120_000, intervals: [400] }).toMatch(/malabares/);
  await expect(page.locator('#interaction-prompt')).toContainText('malabares');
  const antes = await page.evaluate(() => window.__game.stats.dinero);
  await page.keyboard.press('b');
  // El aviso de empezar sale al procesar la tecla; luego, uno de cobro o de corte.
  await expect.poll(() => page.evaluate(() => window.__avisos.some(t => /lanzo las pelotas/.test(t)))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.rebusque.activo), { timeout: 150_000 }).toBe(false);
  const despues = await page.evaluate(() => window.__game.stats.dinero);
  // Paga, o el carro arrancó con el verde y no cobra: las dos salidas terminan el trabajo sin errores.
  const avisos = await page.evaluate(() => window.__avisos);
  expect(despues > antes || avisos.some(t => /arrancaron|Me fui/.test(t))).toBe(true);
  expect(errors).toEqual([]);
});

async function entrar(page) {
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
}

test('Rebusque: cuidar carros parqueados con la franela, y B deja el puesto', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await entrar(page);
  await page.evaluate(ITEMS => {
    const g = window.__game;
    g.inventory.add(ITEMS.franela, 1);
    g.stats.energia = 100;
    window.__avisos = [];
    window.addEventListener('toast', e => window.__avisos.push(e.detail.text));
    // Junto a un carro parqueado, sobre el andén.
    const car = g.cars.find(c => !c.driven);
    const yaw = car.group.rotation.y;
    const x = car.position.x + Math.sin(yaw) * 2.6, z = car.position.z + Math.cos(yaw) * 2.6;
    g.player.position.set(x, g.world.active.getGroundHeight(x, z), z);
  }, ITEMS);
  await expect.poll(() => page.evaluate(() => window.__game.interaction.rebusquePrompt ?? ''), { timeout: 20_000 }).toMatch(/Cuidar los carros/);
  await page.keyboard.press('b');
  await expect.poll(() => page.evaluate(() => window.__avisos.some(t => /Saco la franela/.test(t)))).toBe(true);
  await expect(page.locator('#interaction-prompt')).toContainText('Dejar el puesto');
  await page.keyboard.press('b');
  await expect.poll(() => page.evaluate(() => window.__game.rebusque.activo)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__avisos.some(t => /Dejé el puesto|ningún dueño/.test(t)))).toBe(true);
  expect(errors).toEqual([]);
});

test('Rebusque: vender dulces al bus detenido', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await entrar(page);
  await page.evaluate(ITEMS => {
    const g = window.__game;
    g.inventory.add(ITEMS.dulces, 5);
    g.stats.energia = 100;
    window.__avisos = [];
    window.addEventListener('toast', e => window.__avisos.push(e.detail.text));
  }, ITEMS);
  // Espera el bus quieto en un semáforo y se arrima a su costado.
  await expect.poll(() => page.evaluate(() => {
    const g = window.__game;
    if (g.interaction.rebusquePrompt) return g.interaction.rebusquePrompt;
    const bus = g.traffic.busVehicles.map(b => b.car).find(b => b.speed <= .05 && b.group.visible !== false);
    if (!bus) return '';
    const h = bus.heading, lado = bus.width / 2 + 1.2;
    const x = bus.position.x - h.z * lado, z = bus.position.z + h.x * lado;
    g.player.position.set(x, bus.position.y, z);
    g.player.velocity?.set?.(0, 0, 0);
    return '';
  }), { timeout: 240_000, intervals: [500] }).toMatch(/pasajeros del bus/);
  await page.keyboard.press('b');
  await expect.poll(() => page.evaluate(() => window.__avisos.some(t => /damas y caballeros/.test(t)))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.rebusque.activo), { timeout: 150_000 }).toBe(false);
  const avisos = await page.evaluate(() => window.__avisos);
  expect(avisos.some(t => /Vendí|Nadie en el bus|bus arrancó|Me fui/.test(t))).toBe(true);
  expect(errors).toEqual([]);
});
