import { test, expect } from '@playwright/test';

async function readyGame(page) {
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Yolanda');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
}

const TAM = [[1440, 900], [844, 390], [320, 568]];
const sinDesborde = (page) => page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));

for (const [width, height] of TAM) {
  test(`la primera plana a ${width}: se imprime una vez y no tapa nada`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await readyGame(page);
    await page.evaluate(() => { const g = window.__game; g.stats.dinero = 12400; g.inventory.add({ id: 'carton', name: 'Cartón' }, 3); window.dispatchEvent(new CustomEvent('police-arrest')); });
    await expect(page.locator('#menu-title')).toHaveText('Te atrapó la Policía');
    await expect(page.locator('#menu')).toHaveAttribute('data-momento', 'plana');
    const titular = await page.locator('.plana__linea').allTextContents();
    expect(titular.join(' ')).toMatch(/^¡L[OA] COGIÓ LA TOMBA EN LA .+!$/);
    await expect(page.locator('.plana__pie')).toHaveText(/^Est[ae] es .+\.$/);
    await expect(page.locator('.plana__perdido .tachado').first()).toHaveText('$ 12.400');
    // El semitono se imprimió: hay tinta en el lienzo.
    await expect.poll(() => page.evaluate(() => {
      const c = document.querySelector('.plana__tinta');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let tinta = 0; for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 128) tinta++;
      return tinta;
    })).toBeGreaterThan(500);
    // El titular entra por los dos lados, la foto tiene alto y nada se sale.
    const m = await page.evaluate(() => ({
      lineas: [...document.querySelectorAll('.plana__linea')].map((l) => l.getBoundingClientRect().right),
      foto: document.querySelector('.plana__foto').getBoundingClientRect().height,
      letra: getComputedStyle(document.querySelector('.plana__linea')).fontFamily,
    }));
    for (const r of m.lineas) expect(r).toBeLessThanOrEqual(width + .5);
    expect(m.foto).toBeGreaterThan(120);
    expect(m.letra).toContain('Titular');
    const d = await sinDesborde(page);
    expect(d.w).toBeLessThanOrEqual(d.iw);
    expect(d.h).toBeLessThanOrEqual(d.ih);
    const boton = page.getByRole('button', { name: 'Continuar', exact: true });
    const caja = await boton.boundingBox();
    expect(caja.height).toBeGreaterThanOrEqual(44);
    expect(caja.y + caja.height).toBeLessThanOrEqual(height);
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu')).toBeVisible();
    // El teclado llega al botón y no se sale: es lo único que hay.
    await page.keyboard.press('Tab');
    await expect(boton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(boton).toBeFocused();
    await boton.click();
    await expect(page.locator('#menu')).toBeHidden();
    expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(0);
  });

  test(`la muerte y el recorte a ${width}: sin grito y con la calle real`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await readyGame(page);
    await page.evaluate(() => { const g = window.__game; g._deathCause = 'atropello'; g.stats.salud = 0; });
    await expect(page.locator('#menu-title')).toHaveText('Me atropellaron');
    await expect(page.locator('#menu')).toHaveAttribute('data-momento', 'muerte');
    expect(await page.locator('#menu .menu__body').innerText()).not.toMatch(/[¡!]/);
    expect(await page.locator('#menu .cinta').count()).toBe(0);
    await page.getByRole('button', { name: 'Volver al cambuche', exact: true }).click();
    await expect(page.locator('#menu')).toBeHidden();

    await page.evaluate(() => { const g = window.__game; g._deathCause = 'limpieza'; g.stats.salud = 0; });
    await expect(page.locator('#menu-title')).toHaveText('Te mató la limpieza social');
    await expect(page.locator('#menu')).toHaveAttribute('data-momento', 'recorte');
    await expect(page.locator('.recorte')).toHaveText(/^Hallan muert[oa] a .+, habitante de calle, en la .+\. Nadie vio nada\.$/);
    const vista = await page.evaluate(() => ({
      planas: document.querySelectorAll('.plana').length,
      fondo: getComputedStyle(document.querySelector('.recorte')).backgroundColor,
      gira: getComputedStyle(document.querySelector('.recorte')).rotate,
      letra: getComputedStyle(document.querySelector('.recorte')).fontFamily,
    }));
    expect(vista.planas).toBe(0);
    expect(vista.fondo).not.toContain('255, 225, 0');
    expect(vista.gira).toBe('none');
    expect(vista.letra).toContain('Titular Tira');
    await page.getByRole('button', { name: 'Volver al cambuche', exact: true }).click();
    await expect(page.locator('#menu')).toBeHidden();
  });
}

test('la limpieza social de punta a punta: aviso, golpes, recorte, cambuche y consejo', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.clock.hour = 23;
    window.__avisos = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('loot-toast')) window.__avisos.push({ t: n.textContent, c: n.className }); }).observe(document.body, { childList: true });
  });
  // La camioneta necesita un carril a menos de 20 m: se para en la Caracas si donde arrancó no hay.
  const viene = await page.evaluate(() => {
    const g = window.__game;
    if (g.limpieza.trigger()) return true;
    const r = g.limpieza.routes[0]; const p = g.player.position.clone(); const d = p.clone();
    r.sample(r.length / 2, p, d); p.z += 6;
    g.player.position.copy(p); g.player.root.position.copy(p);
    return g.limpieza.trigger();
  });
  expect(viene).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.limpieza.state), { timeout: 40_000 }).toBe('out');
  await expect.poll(() => page.evaluate(() => window.__avisos[0]?.t)).toBe('Una camioneta negra frenó en seco: limpieza social. Córrale y no se deje alcanzar.');
  expect(await page.evaluate(() => window.__avisos[0].c)).toContain('warn');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#menu-title')).toHaveText('Te mató la limpieza social');
  await expect(page.locator('.recorte')).toContainText('Nadie vio nada.');
  const avisos = await page.evaluate(() => window.__avisos.map((a) => a.t));
  expect(avisos.some((t) => t.startsWith('Me dieron un cachazo: −'))).toBe(true);
  await page.getByRole('button', { name: 'Volver al cambuche', exact: true }).click();
  await expect(page.locator('#menu')).toBeHidden();
  expect(await page.evaluate(() => window.__game.limpieza.active)).toBe(false);
  await page.evaluate(() => { const g = window.__game; g.limpieza.cooldown = 9999; window.__avisos = []; g.clock.hour = 12; });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__game.clock.hour = 20.5; });
  await expect.poll(() => page.evaluate(() => window.__avisos.map((a) => a.t))).toContain('Si vuelve la camioneta, córrale y no pare');
});

test('te cascaron no pausa ni tapa las cifras, y CERRADO dice la hora real', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await readyGame(page);
  await page.evaluate(() => { const g = window.__game; const d = g.player.position.clone(); d.set(1, 0, .4); g.player.receiveVehicleImpact(d, 10); });
  await expect(page.locator('#cascado')).toBeVisible();
  await expect(page.locator('#cascado')).toContainText('Me llevó un carro');
  await expect(page.locator('#cascado')).toContainText('Ya me levanto');
  const c = await page.evaluate(() => {
    const r = document.querySelector('#cascado').getBoundingClientRect(), v = document.querySelector('#hud-vitals').getBoundingClientRect();
    return { arriba: r.top, vitalesAbajo: v.bottom, pausado: window.__game.paused, menu: document.querySelector('#menu').hidden, botones: document.querySelectorAll('#cascado button').length };
  });
  expect(c.arriba).toBeGreaterThanOrEqual(c.vitalesAbajo);
  expect(c).toMatchObject({ pausado: false, menu: true, botones: 0 });
  await expect(page.locator('#cascado')).toBeHidden({ timeout: 15_000 });

  await page.evaluate(() => { const g = window.__game; g.built.base = true; g.clock.hour = 23; g.sleep(); });
  await expect(page.locator('#cerrado')).toContainText('CERRADO');
  await expect(page.locator('#cerrado')).toContainText('ABRIMOS A LAS 06:00');
  await expect(page.locator('#cerrado')).toBeHidden({ timeout: 25_000 });
});

test('las voces van en rojo, sin filtro en el lienzo y sin tapar las cifras', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await page.evaluate(() => { window.__game.traffic; window.__game.psychosis.induce(40, 1); });
  await expect(page.locator('.hallucination-word').first()).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('body')).toHaveClass(/voces/);
  const m = await page.evaluate(() => {
    const v = document.querySelector('.hallucination-word').getBoundingClientRect();
    const tapa = ['#hud-vitals', '#topbar', '#plata'].map((s) => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean)
      .some((r) => v.left < r.right && r.left < v.right && v.top < r.bottom && r.top < v.bottom);
    return { filtro: document.querySelector('canvas').style.filter, color: getComputedStyle(document.querySelector('.hallucination-word')).color, tapa };
  });
  expect(m.filtro).toBe('');
  expect(m.color).toBe('rgb(171, 29, 23)');
  expect(m.tapa).toBe(false);
});
