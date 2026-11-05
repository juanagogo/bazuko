import { test, expect } from '@playwright/test';

async function readyGame(page, url = '/') {
  await page.goto(url);
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
}

const FILAS = ['salud', 'hambre', 'sed', 'energia'];
const TAM = [[1440, 900], [1280, 800], [844, 390], [375, 812], [320, 568]];

/** Ninguna letra visible de la fila pisa el relleno, midiendo cajas reales. */
const letraSobreRelleno = () => {
  const malas = [];
  for (const fila of document.querySelectorAll('.stat-bar')) {
    const relleno = fila.querySelector('.fill')?.getBoundingClientRect();
    if (!relleno || !relleno.width) continue;
    for (const celda of fila.querySelectorAll('.stat-bar__name, .stat-bar__orden, .stat-bar__value')) {
      if (getComputedStyle(celda).display === 'none') continue;
      const rango = document.createRange();
      rango.selectNodeContents(celda);
      const r = rango.getBoundingClientRect();
      if (r.width && r.left < relleno.right - .5 && r.right > relleno.left + .5) malas.push(`${fila.dataset.stat}: ${celda.className}`);
    }
  }
  return malas;
};

for (const [width, height] of TAM) {
  test(`el HUD a ${width} con datos reales`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await readyGame(page);

    // Las filas están siempre, en el mismo orden.
    await expect.poll(() => page.locator('#hud-vitals .stat-bar').evaluateAll((f) => f.map((e) => e.dataset.stat))).toEqual(FILAS);

    for (const v of [15, 22, 33]) {
      await page.evaluate((v) => Object.assign(window.__game.stats, { salud: v, hambre: v, sed: v, energia: v }), v);
      await expect.poll(() => page.locator('#hud-vitals .stat-bar__value').first().textContent()).toBe(String(v));
      expect(await page.evaluate(letraSobreRelleno), `con ${v}`).toEqual([]);
    }

    // Crítica: placa con orden; el relleno no llega a la orden.
    await page.evaluate(() => Object.assign(window.__game.stats, { salud: 9, hambre: 8, sed: 7, energia: 6, vicio: 19, higiene: 5, animo: 4 }));
    await expect(page.locator('.stat-bar[data-stat="salud"]')).toHaveAttribute('data-level', 'critical');
    expect(await page.evaluate(letraSobreRelleno), 'crítica').toEqual([]);
    await expect(page.locator('#retazo')).toBeVisible();
    await expect(page.locator('#retazo .retazo__grito')).toHaveText(/./);
    await expect(page.locator('#status')).toContainText('Salud crítica');
    await page.evaluate(() => Object.assign(window.__game.stats, { salud: 100, hambre: 100, sed: 100, energia: 100, vicio: 100, higiene: 100, animo: 100, calor: 200 }));
    await expect(page.locator('#retazo')).toBeHidden();

    // La búsqueda no existe en cero.
    await page.evaluate(() => { window.__game.steal.buscado = 0; });
    await expect(page.locator('#wanted')).toBeHidden();
    await page.evaluate(() => { window.__game.steal.buscado = 2; });
    await expect(page.locator('#wanted')).toContainText('Te tienen fichado');
    await expect(page.locator('#wanted')).toHaveClass(/carton/);

    // Persecución de verdad, con una patrulla del tráfico.
    await page.evaluate(() => {
      const g = window.__game, t = g.traffic, v = t.vehicles.find((c) => c.police), p = g.player.position;
      v.car.position.set(p.x + 35, v.car.position.y, p.z);
      t._startChase(v);
    });
    await expect(page.locator('#wanted')).toHaveClass(/placa/);
    await expect(page.locator('#wanted .wanted__dato')).toHaveText(/Patrulla a \d+ m/);
    const area = await page.locator('#wanted').evaluate((e) => { const r = e.getBoundingClientRect(); return r.width * r.height / (innerWidth * innerHeight) * 100; });
    const meta = { 1440: 2.7, 844: 4, 375: 3.7 }[width];
    if (meta) expect(area, 'la placa se ve').toBeGreaterThanOrEqual(meta);
    await page.evaluate(() => { const t = window.__game.traffic; for (const v of t.vehicles) if (v.police && v.state !== 'patrol') t._returnToPatrol(v); window.__game.steal.buscado = 0; });
    await expect(page.locator('#wanted')).toBeHidden();

    // Avisos: máximo a la vista, y nunca en la zona del personaje.
    const tope = width >= 900 ? 3 : width > height ? 2 : 1;
    await page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new CustomEvent('toast', { detail: { text: `Aviso de prueba ${i}`, type: i % 2 ? 'warning' : 'info' } })); });
    const cajas = await page.locator('.loot-toast').evaluateAll((a) => a.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    expect(cajas.length).toBe(tope);
    for (const c of cajas) {
      const enX = c.l < width * .6 && c.r > width * .4, enY = c.t < height * .85 && c.b > height * .4;
      expect(enX && enY, JSON.stringify(c)).toBe(false);
      expect(c.r).toBeLessThanOrEqual(width);
    }
    await page.evaluate(() => [...document.querySelectorAll('.loot-toast')].length);

    // Plata y nombre largos no se salen.
    await page.evaluate(() => { const g = window.__game; g.stats.dinero = 12345678; g.look.nombre = 'WWWWWWWWWWWWWWWW'; });
    await expect(page.locator('#money')).toHaveClass(/plata--larguisima/);
    const hoja = await page.locator('.topbar__hoja').evaluate((e) => {
      const r = e.getBoundingClientRect(), m = document.getElementById('money').getBoundingClientRect();
      return { dentro: m.left >= r.left - 1 && m.right <= r.right + 1 };
    });
    expect(hoja.dentro).toBe(true);
  });
}

test('en escritorio destino, radar y filas son una columna en cualquier tamaño', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await readyGame(page);
  for (const size of ['s', 'm', 'l']) {
    await page.evaluate((v) => window.__game.minimap.setSize(v), size);
    const anchos = await page.evaluate(() => ['hud-dock', 'hud', 'minimap-container'].map((id) => document.getElementById(id).getBoundingClientRect().width));
    expect(Math.max(...anchos) - Math.min(...anchos), `columna ${size}`).toBeLessThanOrEqual(2);
  }
});

test('los clics sobre el cartón del radar no caen al mundo, y cada herramienta funciona', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await readyGame(page);
  const antes = await page.evaluate(() => window.__game.minimap.range);
  await page.locator('.radar__tools [data-radar="out"]').click();
  await expect.poll(() => page.evaluate(() => window.__game.minimap.range)).toBeGreaterThan(antes);
  const golpes = await page.evaluate(() => window.__game.input.isDown?.('Mouse0') ?? false);
  expect(golpes).toBe(false);
});

test('un clic de ratón en la calle pega, y el botón derecho no', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await page.evaluate(() => {
    const i = window.__game.input, cp = i.consumePress.bind(i);
    window.__golpes = 0;
    i.consumePress = (k) => { const v = cp(k); if (v && k === 'Mouse0') window.__golpes++; return v; };
  });
  await page.mouse.move(640, 300);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__golpes)).toBe(0);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__golpes)).toBe(1);
  await expect.poll(() => page.evaluate(() => !!window.__game.player.attack)).toBe(true);
});

test('la ayuda de los controles no pisa el radar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await page.locator('#controls-help-toggle').click();
  await expect(page.locator('#controls-help-content')).toBeVisible();
  const [ayuda, radar] = await page.evaluate(() => ['controls-help-content', 'hud-dock'].map((id) => document.getElementById(id).getBoundingClientRect().toJSON()));
  expect(ayuda.left).toBeGreaterThanOrEqual(radar.right);
  await page.locator('#needs-toggle').click({ timeout: 3000 });
});

test('con un menú abierto, Tab da la vuelta dentro y el aviso no cae en medio', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await readyGame(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-pause-menu', { detail: { tab: 'estado' } })));
  await expect(page.locator('#menu')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('toast', { detail: { text: 'Partida guardada', type: 'info' } })));
  const caja = await page.locator('.loot-toast').first().boundingBox();
  const tabs = await page.locator('.pause-tabs').boundingBox();
  expect(caja.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1);
  expect(caja.y).toBeLessThan(tabs.y + tabs.height + 20);
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('menu').contains(document.activeElement))).toBe(true);
  }
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  // La mesa no es un #menu, pero el costal no le quita el Tab.
  await page.keyboard.press('KeyC');
  await expect(page.locator('#craft-panel')).toBeVisible();
  const visitados = new Set();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    visitados.add(await page.evaluate(() => { const a = document.activeElement; return document.getElementById('craft-panel').contains(a) ? [...a.parentElement.children].indexOf(a) + a.className : 'FUERA'; }));
  }
  expect(visitados.has('FUERA')).toBe(false);
  expect(visitados.size).toBeGreaterThan(1);
  await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
});

test('el modo táctil guarda su sitio sin tapar nada', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await readyGame(page, '/?tactil=1');
  await expect(page.locator('body')).toHaveClass(/tactil/);
  const cajas = await page.evaluate(() => ['joystick', 'acciones', 'quickbar', 'panel-dock'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, r.left, r.top, r.right, r.bottom]; }));
  const [j, a] = cajas;
  expect(j[3]).toBeLessThanOrEqual(a[1]);
  expect(a[3]).toBeLessThanOrEqual(375);
});
