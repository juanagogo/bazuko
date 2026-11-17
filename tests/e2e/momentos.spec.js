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

test('recargar la página con la plana o el cartón abiertos, o después de seguir, no deshace el castigo ni lo cobra dos veces', async ({ page }) => {
  await readyGame(page);
  const recargar = async () => {
    await page.reload();
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
    return page.evaluate(() => ({ plata: window.__game.stats.dinero, filas: window.__game.inventory.items.map((i) => i.id), salud: window.__game.stats.salud }));
  };
  // Lo último guardado (como al dormir): cuatro filas en el costal y algo de plata.
  const guardadoCon = (plata) => page.evaluate(async (plata) => {
    const g = window.__game, { ITEMS } = await import('/src/data/items.js');
    g.inventory.clear();
    for (const [id, n] of [['carton', 2], ['lata', 3], ['pilas', 1], ['cable', 1]]) g.inventory.add(ITEMS[id], n);
    g.stats.dinero = plata;
    g._save();
  }, plata);

  await guardadoCon(12400);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('police-arrest')));
  await expect(page.locator('#menu')).toHaveAttribute('data-momento', 'plana');
  expect(await recargar(), 'F5 con la plana abierta').toMatchObject({ plata: 0, filas: [] });
  await expect(page.locator('#menu')).toBeHidden();

  await guardadoCon(5000);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('police-arrest')));
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.locator('#menu')).toBeHidden();
  expect(await recargar(), 'F5 después de seguir').toMatchObject({ plata: 0, filas: [] });

  await guardadoCon(3000);
  await page.evaluate(() => { const g = window.__game; g._deathCause = 'atropello'; g.stats.salud = 0; });
  await expect(page.locator('#menu')).toHaveAttribute('data-momento', 'muerte');
  const muerto = await recargar();
  expect(muerto, 'F5 con el cartón abierto: se pierde la primera mitad del costal, no la plata').toMatchObject({ plata: 3000, filas: ['pilas', 'cable'] });
  expect(muerto.salud, 'vuelve como del cambuche, no muerto otra vez').toBeGreaterThan(50);
  await expect(page.locator('#menu')).toBeHidden();
  expect((await recargar()).filas, 'otro F5 no se lleva otra mitad').toEqual(['pilas', 'cable']);
});

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

test('el cartel del lugar no toca la plata, los avisos ni la misión del día', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  // El cartel se pone con la zona elegida, sin caminar hasta ella, y se queda quieto mientras se mide.
  const poner = (zona) => page.evaluate((zona) => {
    const za = window.__game.zonaAviso;
    za._update ??= za.update;
    za._zona = null;
    za._update.call(za, 1 / 60, { _zoneAt: () => zona }, 10, 10);
    za.update = () => {};
  }, zona);
  // La misión del día con su texto real, a la vista mientras dure la prueba.
  const mision = () => page.evaluate(() => {
    const h = window.__game.hud;
    h._misionTexto = undefined;
    h._pintarMision(window.__game.inventory);
    if (h.misionEl.hidden) { h._setText(h.misionEl, 'TOCA JUNTAR 8 CARTONES'); h.misionEl.hidden = false; }
    h._misionS = 1e9;
  });
  const avisos = () => page.evaluate(() => {
    for (const text of ['Encontraste 2 latas de atún', 'Te robaron el costal mientras dormías', 'Ganaste 1.500 pesos reciclando']) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text, type: 'info' } }));
    }
  });
  // Cajas reales: el cartel no se monta en nada de lo que sale arriba y no se sale de la pantalla.
  const choques = (ignorar = []) => page.evaluate((ignorar) => {
    const ver = (el) => el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
    const cartel = document.getElementById('zona-cartel');
    if (!ver(cartel)) return ['el cartel no se ve'];
    const c = cartel.getBoundingClientRect(), nombre = cartel.textContent;
    const malas = [];
    if (c.left < 0 || c.right > innerWidth || c.top < 0) malas.push(`${nombre} se sale de la pantalla`);
    const otros = [['plata', document.querySelector('#topbar .topbar__hoja')], ['misión', document.getElementById('mision')],
      ['botones', document.getElementById('game-settings')], ['radar', document.getElementById('hud-dock')],
      ...[...document.querySelectorAll('.loot-toast')].map((e, i) => [`aviso ${i + 1}`, e])];
    for (const [que, el] of otros) {
      if (!ver(el) || ignorar.some((i) => que.startsWith(i))) continue;
      const o = el.getBoundingClientRect();
      if (Math.min(c.right, o.right) - Math.max(c.left, o.left) > .5 && Math.min(c.bottom, o.bottom) - Math.max(c.top, o.top) > .5) malas.push(`${nombre} sobre ${que}`);
    }
    return malas;
  }, ignorar);

  await mision();
  await expect(page.locator('#mision')).toBeVisible();
  for (const [width, height] of [[1280, 800], [1000, 800]]) {
    await page.setViewportSize({ width, height });
    for (const zona of ['metro', 'parque', 'lago', 'candelaria', 'andenes']) {
      await avisos();
      await poner(zona);
      await expect(page.locator('.loot-toast')).toHaveCount(3);
      await page.waitForTimeout(400);
      expect(await choques(), `${zona} a ${width}`).toEqual([]);
    }
  }
  // Un nombre corto queda con la letra de siempre (5,2vw), en una línea.
  await page.setViewportSize({ width: 1280, height: 800 });
  await poner('andenes');
  await page.waitForTimeout(400);
  const corto = await page.locator('#zona-cartel').evaluate((e) => ({ letra: getComputedStyle(e).fontSize, alto: e.getBoundingClientRect().height }));
  expect(corto.letra).toBe('66.56px');
  expect(corto.alto).toBeLessThan(66.56 * 2);

  // Ventanas de escritorio bajas: de 900 a 1126 px de ancho, el nombre largo en dos o tres líneas alcanzaría el radar.
  // Desde 610 px de alto no lo toca, tampoco con el radar grande; desde 1127 px de ancho, a ningún alto.
  for (const tam of ['m', 'l']) {
    await page.evaluate((t) => window.__game.minimap.setSize(t, false), tam);
    for (const [width, height] of [[900, 610], [1000, 610], [1126, 610], [1127, 501]]) {
      await page.setViewportSize({ width, height });
      await poner('metro');
      await page.waitForTimeout(400);
      // Con menos de 525 px de alto el cartel (a 12vh) ya rozaba la misión de arriba antes de este cambio: aquí no se mira.
      expect(await choques(height < 525 ? ['misión'] : []), `metro a ${width} × ${height}, radar ${tam}`).toEqual([]);
    }
  }
  await page.evaluate(() => window.__game.minimap.setSize('m', false));
  // Un píxel más abajo (a 609 de alto) o más angosto (a 1126 × 501), el cartel queda como antes: letra de 5,2vw y
  // ancho máximo de 90vw.
  for (const [width, height] of [[900, 609], [1126, 609], [1126, 501]]) {
    await page.setViewportSize({ width, height });
    await poner('metro');
    const antes = await page.locator('#zona-cartel').evaluate((e) => ({ letra: parseFloat(getComputedStyle(e).fontSize), ancho: parseFloat(getComputedStyle(e).maxWidth) }));
    expect(antes.letra, `letra a ${width} × ${height}`).toBeCloseTo(width * .052, 1);
    expect(antes.ancho, `ancho máximo a ${width} × ${height}`).toBeCloseTo(width * .9, 1);
  }

  // En pantalla angosta, la misión y el cartel iban en el mismo sitio, bajo el radar. De pie, los avisos van
  // debajo de la misión desde antes y no se miran aquí.
  for (const [width, height, ignorar] of [[820, 800, []], [390, 844, ['aviso']]]) {
    await page.setViewportSize({ width, height });
    await mision();
    for (const zona of ['metro', 'andenes']) {
      await poner(zona);
      await page.waitForTimeout(400);
      await expect(page.locator('#mision')).toBeVisible();
      expect(await choques(ignorar), `${zona} a ${width}`).toEqual([]);
    }
  }
});
