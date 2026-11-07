import { test, expect } from '@playwright/test';
import { ITEMS } from '../../src/data/items.js';

test.use({ video: 'off' });

test('Rebusque: malabares frente al primero de la cola, pelotas en el aire, y al verde el carro espera y me quito', async ({ page }) => {
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
    window.__golpes = 0;
    window.addEventListener('toast', e => window.__avisos.push(e.detail.text));
    // Cuenta los atropellos sin cambiar lo que hace el juego con ellos.
    const golpe = g._onVehicleImpact;
    g._onVehicleImpact = info => { window.__golpes++; return golpe(info); };
  }, ITEMS);
  // Espera al primero de una cola, quieto en rojo con rojo de sobra, y se para frente a su trompa (L/2 + 1,1 m).
  await expect.poll(() => page.evaluate(() => {
    const g = window.__game, s = g.traffic.signals;
    if (window.__carro && /malabares/.test(g.interaction.rebusquePrompt ?? '')) return g.interaction.rebusquePrompt;
    const rojo = car => { const yaw = car.group.rotation.y, eje = Math.abs(Math.cos(yaw)) >= Math.abs(Math.sin(yaw)) ? 0 : 1; const f = ((s.time - eje * 18) % 36 + 36) % 36; return f < 14 ? 0 : 36 - f; };
    const primero = v => !g.traffic.vehicles.some(o => {
      if (o === v) return false;
      const yaw = v.car.group.rotation.y, hx = Math.cos(yaw), hz = -Math.sin(yaw);
      const dx = o.car.position.x - v.car.position.x, dz = o.car.position.z - v.car.position.z;
      return dx * hx + dz * hz > 0 && dx * hx + dz * hz < 9 && Math.abs(dx * -hz + dz * hx) < 1.6;
    });
    const v = g.traffic.vehicles.find(v => !v.police && !v.hold && v.stopped && v.car.kind !== 'moto' && !v.car.isMoto
      && g.traffic.stoppedAtRed(v.car.position, .1).length && rojo(v.car) > 13 && primero(v));
    window.__carro = null;
    if (!v) return '';
    const yaw = v.car.group.rotation.y, a = v.car.length / 2 + 1.1;
    const x = v.car.position.x + Math.cos(yaw) * a, z = v.car.position.z - Math.sin(yaw) * a;
    g.player.position.set(x, v.car.position.y, z);
    g.player.velocity?.set?.(0, 0, 0);
    window.__carro = v;
    return '';
  }), { timeout: 240_000, intervals: [400] }).toMatch(/malabares/);
  await expect(page.locator('#interaction-prompt')).toContainText('malabares');
  const antes = await page.evaluate(() => window.__game.stats.dinero);
  await page.keyboard.press('b');
  await expect.poll(() => page.evaluate(() => window.__avisos.some(t => /lanzo las pelotas/.test(t)))).toBe(true);
  // El aviso lleva la cuenta del rojo y el ritmo; las tres pelotas están en el aire, por encima de las manos.
  await expect(page.locator('#interaction-prompt')).toContainText('rojo');
  await expect.poll(() => page.evaluate(() => {
    const v = window.__game.rebusqueVisual, p = window.__game.player.position;
    return v.mallas >= 3 && v._bolas.every(b => b.mesh.visible && b.mesh.position.distanceTo(p) < 2.5)
      && v._bolas.some(b => b.mesh.position.y > p.y + 1.5);
  }), { timeout: 5_000, intervals: [50] }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.rebusque.activo), { timeout: 60_000 }).toBe(false);
  const despues = await page.evaluate(() => window.__game.stats.dinero);
  expect(despues).toBeGreaterThan(antes); // random 0: paga el mínimo, un poco más frente al primero
  // Se queda ahí: al verde el carro espera, y a los 20 s el artista se quita al andén. Nadie lo atropella.
  await expect.poll(() => page.evaluate(() => window.__game.rebusque.despeje.sostenidos.has(window.__carro)), { timeout: 60_000, intervals: [200] }).toBe(true);
  // Mientras se quita, camina de verdad: Player.speed es la velocidad que lleva (las piernas andan), no 0 deslizándose.
  await page.evaluate(() => {
    window.__paso = { max: 0, muestras: 0 };
    const mirar = () => {
      const g = window.__game, p = g.rebusque.despeje.paso;
      if (p && p.t > .7) { window.__paso.max = Math.max(window.__paso.max, g.player.speed); window.__paso.muestras++; }
      requestAnimationFrame(mirar);
    };
    requestAnimationFrame(mirar);
  });
  await expect.poll(() => page.evaluate(() => window.__game.rebusque.despeje.apartados), { timeout: 60_000, intervals: [500] }).toBeGreaterThanOrEqual(1);
  // El aviso sale al terminar el paso y cuenta lo que pasó: hasta el andén, un trecho, o nada (sigue en la vía).
  await expect.poll(() => page.evaluate(() => window.__avisos.some(t => /Me hice para atrás hasta el andén|Me quité de adelante|me toca quitarme de la vía/.test(t))), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !window.__game.rebusque.despeje.sostiene && !window.__game.rebusque.despeje.paso), { timeout: 30_000 }).toBe(true);
  const paso = await page.evaluate(() => ({ ...window.__paso, anden: window.__avisos.some(t => /hasta el andén/.test(t)),
    suelo: window.__game.world.active.getGroundTypeAt(window.__game.player.position.x, window.__game.player.position.z) }));
  if (paso.anden) {
    expect(paso.muestras).toBeGreaterThan(5);
    expect(paso.max).toBeGreaterThan(.8);
    expect(paso.max).toBeLessThan(3.2);
    expect(paso.suelo).toBe('sidewalk');
  }
  expect(await page.evaluate(() => window.__carro.hold)).not.toBe(true);
  expect(await page.evaluate(() => window.__golpes)).toBe(0);
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
