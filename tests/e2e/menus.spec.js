import { test, expect } from '@playwright/test';

async function entrar(page, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('bazuko.graphics_quality', 'baja'); } catch { /* sin almacenamiento */ } });
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
}

test('T y C cierran lo que abren, y cada ventana abre desde arriba', async ({ page }) => {
  await entrar(page, { width: 1280, height: 800 });
  for (const [tecla, panel] of [['t', '#talent-panel'], ['c', '#craft-panel']]) {
    await page.keyboard.press(tecla);
    await expect(page.locator(panel)).toHaveClass(/open/);
    await expect(page.locator(panel)).toHaveAttribute('role', 'dialog');
    await page.keyboard.press(tecla);
    await expect(page.locator(panel)).not.toHaveClass(/open/);
    expect(await page.evaluate(() => window.__game.paused)).toBe(false);
  }
  // Una tecla no abre un panel encima del otro.
  await page.keyboard.press('t');
  await page.keyboard.press('c');
  await expect(page.locator('#craft-panel')).not.toHaveClass(/open/);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-shop', { detail: {} })));
  await expect(page.locator('#menu')).toBeVisible();
  const body = page.locator('#menu-body');
  await body.evaluate(el => { el.scrollTop = 9999; });
  expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-shop', { detail: {} })));
  await expect(page.locator('#menu')).toBeVisible();
  expect(await body.evaluate(el => el.scrollTop), 'abre desde arriba').toBe(0);
});

test('el costal aguanta todos los tipos de objeto a cualquier tamaño', async ({ page }) => {
  await entrar(page, { width: 1440, height: 900 });
  const tipos = await page.evaluate(async () => {
    const { ITEMS } = await import('/src/data/items.js');
    const inv = window.__game.inventory;
    inv.maxWeight = 1e6;
    const ids = Object.keys(ITEMS);
    for (const id of ids.slice(0, 34)) inv.add(ITEMS[id], 2);
    return inv.items.length;
  });
  expect(tipos).toBe(34);
  await page.keyboard.press('i');
  const ventana = page.getByRole('dialog', { name: 'Inventario', exact: true });
  await expect(ventana).toBeVisible();
  await expect(ventana.locator('#inv-title')).toHaveText('El costal');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 844, height: 390 }, { width: 375, height: 812 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const m = await page.evaluate(() => {
      const caja = (el) => el.getBoundingClientRect();
      const win = caja(document.querySelector('.inv-window')), grid = document.querySelector('.inv-grid');
      const slots = [...document.querySelectorAll('.inv-slot[data-i]')].filter(el => !el.hidden);
      const primera = caja(slots[0]), en = slots.filter(el => Math.abs(caja(el).top - primera.top) < 2).length;
      const desborda = slots.filter(el => el.scrollWidth > el.clientWidth + 1).length;
      const head = caja(document.querySelector('.inv-head'));
      grid.scrollTop = 1e5;
      const ultima = caja(slots[33]), gridCaja = caja(grid);
      const alcanzable = ultima.bottom <= gridCaja.bottom + 1 && ultima.top >= gridCaja.top - 1;
      const headDespues = caja(document.querySelector('.inv-head')).top;
      grid.scrollTop = 0;
      return { win: [win.left, win.top, win.right, win.bottom], rueda: getComputedStyle(grid).overflowY, columnas: en, desborda, alcanzable, hace: grid.scrollHeight > grid.clientHeight, grillaX: grid.scrollWidth - grid.clientWidth, head: head.top, headDespues, pagina: document.documentElement.scrollWidth - innerWidth };
    });
    const nombre = `${viewport.width}×${viewport.height}`;
    expect(m.win[0], nombre).toBeGreaterThanOrEqual(0);
    expect(m.win[1], nombre).toBeGreaterThanOrEqual(0);
    expect(m.win[2], nombre).toBeLessThanOrEqual(viewport.width);
    expect(m.win[3], nombre).toBeLessThanOrEqual(viewport.height);
    expect(m.columnas, `${nombre}: el mando cuenta con 5 columnas`).toBe(5);
    expect(m.desborda, nombre).toBe(0);
    expect(m.grillaX, nombre).toBeLessThanOrEqual(1);
    expect(m.hace, `${nombre}: con 34 tipos la rejilla se desplaza`).toBe(true);
    expect(m.alcanzable, nombre).toBe(true);
    expect(m.rueda, `${nombre}: el dedo y la rueda también la desplazan`).toBe('auto');
    expect(m.headDespues, `${nombre}: la cabecera no se va con la rejilla`).toBe(m.head);
    expect(m.pagina, nombre).toBeLessThanOrEqual(0);
  }
});

test('el mapa grande pinta la ciudad sobre el cartón y no se sale de ella', async ({ page }) => {
  await entrar(page, { width: 1280, height: 800 });
  await page.keyboard.press('m');
  await expect(page.locator('.map-view__canvas')).toBeVisible();
  await page.locator('.map-view__tool').nth(3).click(); // Ver toda la ciudad
  await page.waitForTimeout(250);
  const px = await page.evaluate(() => {
    const c = document.querySelector('.map-view__canvas'), ctx = c.getContext('2d');
    const a = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
    let dentro = 0;
    const d = ctx.getImageData(c.width / 4, c.height / 4, c.width / 2, c.height / 2).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) dentro++;
    return { esquina: a(0, 0), dentro };
  });
  expect(px.esquina, 'fuera de la ciudad queda el cartón: nada de franja negra').toBe(0);
  expect(px.dentro, 'el plano se dibujó').toBeGreaterThan(1000);
  const viaje = await page.evaluate(() => {
    const mv = window.__game.mapView, plan = window.__game.mapPlan;
    mv.zoom = 6; mv.centerX = 1e5; mv.draw();
    const lado = mv._toScreen(plan.originX + plan.worldWidth, 0)[0];
    return { sobra: mv.cssWidth - lado };
  });
  expect(viaje.sobra, 'si la ciudad no cabe, la vista no enseña más que un borde de cartón').toBeCloseTo(24, 1);
  // A la vista, La mesa; por dentro sigue el nombre con el que se busca.
  await expect(page.locator('.map-view__place-name', { hasText: 'La mesa' })).toHaveCount(1);
  await expect(page.locator('.map-view__place-name', { hasText: 'Crafteo' })).toHaveCount(0);
});

test('la radio no suelta el deslizador a mitad del arrastre y su dial cabe a 375', async ({ page }) => {
  await entrar(page, { width: 375, height: 812 });
  await page.keyboard.press('r');
  await expect(page.locator('#menu-title')).toHaveText('La radio');
  const m = await page.evaluate(() => {
    const s = document.querySelector('.radio-tuner-slider');
    s.value = '890';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    const marcas = [...document.querySelectorAll('.radio-dial-tick')].map(el => el.getBoundingClientRect()).sort((a, b) => a.left - b.left);
    const dial = document.querySelector('.radio-dial-scale').getBoundingClientRect();
    return {
      mismo: document.querySelector('.radio-tuner-slider') === s, f: window.__game.radio.frequency,
      solapan: marcas.some((r, i) => i && r.left < marcas[i - 1].right),
      dentro: marcas.every(r => r.left >= dial.left - 1 && r.right <= dial.right + 1),
      x: document.getElementById('menu-body').scrollWidth - document.getElementById('menu-body').clientWidth,
    };
  });
  expect(m).toEqual({ mismo: true, f: 890, solapan: false, dentro: true, x: 0 });
});

test('la carreta se ve en el indicador mientras se lleva', async ({ page }) => {
  await entrar(page, { width: 1280, height: 800 });
  await expect(page.locator('#cart-indicator')).toBeHidden();
  await page.evaluate(() => { window.__game.cart.isAttached = true; });
  await expect(page.locator('#cart-indicator')).toBeVisible();
  await page.evaluate(() => { window.__game.cart.isAttached = false; });
  await expect(page.locator('#cart-indicator')).toBeHidden();
});

test('sin ratón: Q y E recorren la pausa, las flechas el costal, y el foco se ve', async ({ page }) => {
  await entrar(page, { width: 1280, height: 800 });
  await page.keyboard.press('Escape');
  const pestana = () => page.locator('.pause-tab[aria-selected="true"]').innerText();
  const inicial = (await pestana()).toLowerCase();
  await page.keyboard.press('e');
  const siguiente = (await pestana()).toLowerCase();
  expect(siguiente).not.toBe(inicial);
  await page.keyboard.press('q');
  expect((await pestana()).toLowerCase()).toBe(inicial);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();

  await page.evaluate(async () => { const { ITEMS } = await import('/src/data/items.js'); const inv = window.__game.inventory; inv.add(ITEMS.pan, 1); inv.add(ITEMS.agua, 1); });
  await page.keyboard.press('i');
  await expect(page.getByRole('dialog', { name: 'Inventario', exact: true })).toBeVisible();
  const elegida = () => page.locator('.inv-slot.selected').getAttribute('data-i');
  const antes = await elegida();
  await page.keyboard.press('ArrowRight');
  await expect.poll(elegida).not.toBe(antes);
  await page.keyboard.press('Escape');

  await page.keyboard.press('c');
  await page.keyboard.press('Tab');
  const foco = await page.evaluate(() => {
    const el = document.activeElement, s = getComputedStyle(el);
    return { dentro: !!el.closest('#craft-panel'), linea: s.outlineStyle, ancho: parseFloat(s.outlineWidth) };
  });
  expect(foco.dentro, 'el foco se queda en la mesa').toBe(true);
  expect(foco.linea).not.toBe('none');
  expect(foco.ancho).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('c');
  await expect(page.locator('#craft-panel')).toBeHidden();
});

test('bajo la lluvia, elegir sigue siendo círculo pero a marcador', async ({ page }) => {
  await entrar(page, { width: 1280, height: 800 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-tab__palabra.elegido')).toHaveCount(1);
  const fuente = () => page.locator('.pause-tab__palabra.elegido').evaluate(el => getComputedStyle(el, '::after').borderImageSource);
  await page.evaluate(() => document.body.classList.remove('mojado'));
  const seco = await fuente();
  await page.evaluate(() => document.body.classList.add('mojado'));
  expect(await fuente()).not.toBe(seco);
  // El puntero encima no le cambia el material: sigue siendo cinta.
  const verbo = page.getByRole('button', { name: 'Continuar jugando', exact: true });
  await verbo.hover();
  expect(await verbo.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(233, 219, 180)');
});
