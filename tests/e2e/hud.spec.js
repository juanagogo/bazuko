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
    for (const texto of ['Aviso de prueba 0', LARGO]) await revisarUnAviso(page, texto, width, height, 'con necesidades críticas');
    await page.evaluate(() => Object.assign(window.__game.stats, { salud: 100, hambre: 100, sed: 100, energia: 100, vicio: 100, higiene: 100, animo: 100, calor: 200 }));
    await expect(page.locator('#retazo')).toBeHidden();

    // La búsqueda no existe en cero.
    await page.evaluate(() => { window.__game.steal.buscado = 0; });
    await expect(page.locator('#wanted')).toBeHidden();
    await page.evaluate(() => { window.__game.steal.buscado = 2; });
    await expect(page.locator('#wanted')).toContainText('Te tienen fichado');
    await expect(page.locator('#wanted')).toHaveClass(/carton/);
    await revisarUnAviso(page, LARGO, width, height, 'con ficha');

    // Persecución de verdad, con una patrulla del tráfico.
    await page.evaluate(() => {
      const g = window.__game, t = g.traffic, v = t.vehicles.find((c) => c.police), p = g.player.position;
      v.car.position.set(p.x + 35, v.car.position.y, p.z);
      t._startChase(v);
    });
    await expect(page.locator('#wanted')).toHaveClass(/placa/);
    await expect(page.locator('#wanted .wanted__dato')).toHaveText(/Patrulla a \d+ m/);
    await revisarUnAviso(page, LARGO, width, height, 'con la patrulla');
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

const LARGO = 'Dormí en el hogar de paso: me bañé, comí caliente y nadie me robó. No me cupo: Machete, Varilla; la dejé ahí.';
const REALES = [
  'Aviso de prueba 0',
  '¡Me pillaron robando!',
  'Una camioneta negra frenó en seco: limpieza social. Córrale y no se deje alcanzar.',
  'La botella está vacía. Se llena con lluvia fuerte o en una pila pública del parque.',
  LARGO,
];

function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dosCuadros = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const sinAvisos = (page) => page.evaluate(() => { const a = window.__game.hud.avisos; if (!a) return; a.cola.length = 0; for (const v of [...a.visibles]) a._quitar(v, false); });
const avisar = (page, textos, tipo) => page.evaluate(({ textos, tipo }) => { for (const [i, text] of textos.entries()) window.dispatchEvent(new CustomEvent('toast', { detail: { text, type: tipo ?? (i % 2 ? 'warning' : 'info') } })); }, { textos, tipo });
const cajasDeAvisos = (page) => page.locator('.loot-toast').evaluateAll((a) => a.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, texto: e.textContent.slice(0, 30) }; }));

const cajaDelRetazo = (page) => page.evaluate(() => { const e = document.getElementById('retazo'); const r = e.getBoundingClientRect(); return r.height > 0 && getComputedStyle(e).visibility !== 'hidden' ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null; });

async function sinMontarseEnElRetazo(page, cajas, contexto) {
  const retazo = await cajaDelRetazo(page);
  if (!retazo) return;
  for (const c of cajas) expect(c.b <= retazo.t || c.t >= retazo.b || c.r <= retazo.l || c.l >= retazo.r, `${contexto}: ${JSON.stringify(c)} sobre el retazo ${JSON.stringify(retazo)}`).toBe(true);
}

async function revisarUnAviso(page, texto, width, height, contexto) {
  await sinAvisos(page);
  await dosCuadros(page);
  const retazoAntes = await cajaDelRetazo(page);
  await avisar(page, [texto], 'warn');
  await dosCuadros(page);
  const cajas = await cajasDeAvisos(page);
  expect(cajas.length, contexto).toBe(1);
  fueraDelPersonaje(cajas, width, height, contexto);
  await sinMontarseEnElRetazo(page, cajas, contexto);
  await sinAvisos(page);
  await dosCuadros(page);
  expect(await cajaDelRetazo(page), `${contexto}: el retazo vuelve a verse al irse el aviso`).toEqual(retazoAntes);
}

function fueraDelPersonaje(cajas, width, height, contexto) {
  for (const c of cajas) {
    const enX = c.l < width * .6 && c.r > width * .4, enY = c.t < height * .85 && c.b > height * .4;
    expect(enX && enY, `${contexto}: ${JSON.stringify(c)}`).toBe(false);
    expect(c.r, `${contexto}: se sale por la derecha`).toBeLessThanOrEqual(width);
    expect(c.t, `${contexto}: se sale por arriba`).toBeGreaterThanOrEqual(0);
  }
}

const ponerEstado = (page, stats, busqueda) => page.evaluate(({ stats, busqueda }) => {
  const g = window.__game, t = g.traffic;
  Object.assign(g.stats, { salud: 100, hambre: 100, sed: 100, energia: 100, vicio: 100, higiene: 100, animo: 100 }, stats);
  for (const v of t.vehicles) if (v.police && v.state !== 'patrol') t._returnToPatrol(v);
  g.steal.buscado = busqueda === 'nada' ? 0 : 2;
  if (busqueda === 'patrulla') {
    const v = t.vehicles.find((c) => c.police), p = g.player.position;
    v.car.position.set(p.x + 35, v.car.position.y, p.z);
    t._startChase(v);
  }
}, { stats, busqueda });

const MAL = { salud: 9, hambre: 8, sed: 7, energia: 6, vicio: 19, higiene: 5, animo: 4 };

test('en los demás tamaños, el aviso que no entra en la zona del personaje sale donde salía, con necesidades bien y mal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await readyGame(page);
  const comoAntes = () => page.evaluate(() => {
    const w = innerWidth, h = innerHeight;
    const b = (id) => { const e = document.getElementById(id); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.height > 0 ? r : null; };
    if (w >= 900 && h > 500) return Math.round((b('game-settings')?.bottom ?? 60) + 14);
    if (w > h) return Math.round((b('topbar')?.bottom ?? 90) + 8);
    return Math.round(Math.max(b('retazo')?.bottom ?? 0, b('hud-dock')?.bottom ?? 120, b('mision')?.bottom ?? 0) + 8);
  });
  let iguales = 0;
  for (const [width, height] of [[1440, 900], [1280, 800], [844, 390], [375, 812], [360, 800], [390, 844], [412, 915], [430, 932]]) {
    await page.setViewportSize({ width, height });
    for (const [nombre, stats] of [['bien', {}], ['mal', MAL]]) {
      await sinAvisos(page);
      await ponerEstado(page, stats, 'nada');
      await page.waitForTimeout(300);
      await dosCuadros(page);
      for (const texto of ['Aviso de prueba 0', LARGO]) {
        const contexto = `${width} × ${height}, ${nombre}, «${texto.slice(0, 20)}»`;
        const antes = await comoAntes();
        await avisar(page, [texto], 'warn');
        await dosCuadros(page);
        const [c] = await cajasDeAvisos(page);
        const alto = c.b - c.t;
        const habriaEntrado = width < height && c.l < width * .6 && c.r > width * .4 && antes < height * .85 && antes + alto > height * .4;
        if (!habriaEntrado) {
          expect(c.t, contexto).toBe(antes);
          iguales++;
        }
        fueraDelPersonaje([c], width, height, contexto);
        await sinMontarseEnElRetazo(page, [c], contexto);
        await sinAvisos(page);
      }
    }
  }
  expect(iguales).toBeGreaterThan(20);
});

test('a 320 de pie, el aviso más largo y los que esperan en la cola no entran en la zona del personaje', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await readyGame(page);
  await sinAvisos(page);
  await avisar(page, [LARGO]);
  await dosCuadros(page);
  const solo = await cajasDeAvisos(page);
  expect(solo).toHaveLength(1);
  fueraDelPersonaje(solo, 320, 568, 'el más largo');
  const topbar = await page.locator('#topbar').evaluate((e) => e.getBoundingClientRect().bottom);
  expect(solo[0].t, 'no tapa la plata').toBeGreaterThanOrEqual(topbar);

  await sinAvisos(page);
  await avisar(page, REALES);
  const vistos = new Set();
  for (let i = 0; i < REALES.length; i++) {
    await dosCuadros(page);
    const cajas = await cajasDeAvisos(page);
    expect(cajas).toHaveLength(1);
    fueraDelPersonaje(cajas, 320, 568, `aviso ${i}`);
    vistos.add(cajas[0].texto);
    await page.evaluate(() => { const a = window.__game.hud.avisos; a._quitar(a.visibles[0]); });
  }
  expect(vistos.size).toBe(REALES.length);
});

test('de pie entre 320 y 375, ningún aviso entra en la zona del personaje, con textos, altos y necesidades al azar', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await readyGame(page);
  const semilla = 20261115;
  const rand = azar(semilla);
  const palabras = REALES.join(' ').split(' ');
  for (let caso = 0; caso < 24; caso++) {
    const width = 320 + Math.floor(rand() * 56), height = 568 + Math.floor(rand() * 245);
    const mal = rand() < .5;
    const stats = Object.fromEntries(['salud', 'hambre', 'sed', 'energia', 'higiene', 'animo', 'vicio'].map((k) => [k, mal && rand() < .6 ? 8 + Math.floor(rand() * 22) : 100]));
    const busqueda = ['nada', 'ficha', 'patrulla'][Math.floor(rand() * 3)];
    const textos = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
      if (rand() < .4) return REALES[Math.floor(rand() * REALES.length)];
      const n = 1 + Math.floor(rand() * 32), desde = Math.floor(rand() * palabras.length);
      return Array.from({ length: n }, (_, i) => palabras[(desde + i) % palabras.length]).join(' ');
    });
    const contexto = `semilla ${semilla}, caso ${caso}: ${width} × ${height}, ${busqueda}`;
    await sinAvisos(page);
    await page.setViewportSize({ width, height });
    await ponerEstado(page, stats, busqueda);
    await page.waitForTimeout(300);
    await avisar(page, textos, 'warn');
    const vistos = new Set();
    for (let paso = 0; paso < 6; paso++) {
      await dosCuadros(page);
      const cajas = await cajasDeAvisos(page);
      if (!cajas.length) break;
      expect(cajas.length, contexto).toBe(1);
      fueraDelPersonaje(cajas, width, height, `${contexto}, aviso ${paso}`);
      await sinMontarseEnElRetazo(page, cajas, `${contexto}, aviso ${paso}`);
      vistos.add(cajas[0].texto);
      await page.evaluate(() => { const a = window.__game.hud.avisos; a._quitar(a.visibles[0]); });
    }
    expect(vistos.size, contexto).toBe(new Set(textos.map((x) => x.slice(0, 30))).size);
  }
  await ponerEstado(page, {}, 'nada');
});

test('con el celular acostado (568 × 320), dos avisos largos van a la derecha, fuera de la zona del personaje', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await readyGame(page);
  await sinAvisos(page);
  await avisar(page, [LARGO, REALES[3], REALES[2]]);
  await dosCuadros(page);
  const cajas = await cajasDeAvisos(page);
  expect(cajas).toHaveLength(2);
  fueraDelPersonaje(cajas, 568, 320, 'acostado');
  for (const c of cajas) expect(c.b).toBeLessThanOrEqual(320);
});

test('al pasar de 1280 a 320 y volver, el HUD y los avisos quedan como si hubiera cargado en ese tamaño', async ({ page, browser, baseURL }) => {
  const textos = REALES.slice(2);
  const medir = (p) => p.evaluate(() => {
    const caja = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
    return {
      hud: ['topbar', 'hud-dock', 'minimap-container', 'hud', 'quickbar', 'panel-dock'].map((id) => [id, caja(document.getElementById(id))]),
      avisos: [...document.querySelectorAll('.loot-toast')].map((e) => [e.textContent, caja(e)]),
    };
  });
  const recienCargado = async (width, height) => {
    const aparte = await browser.newContext({ baseURL, viewport: { width, height } });
    const otra = await aparte.newPage();
    await readyGame(otra);
    await sinAvisos(otra);
    await avisar(otra, textos);
    await dosCuadros(otra);
    const m = await medir(otra);
    await aparte.close();
    return m;
  };
  const de320 = await recienCargado(320, 568);
  expect(de320.avisos).toHaveLength(1);

  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await sinAvisos(page);
  await avisar(page, textos);
  await dosCuadros(page);
  const de1280 = await medir(page);
  expect(de1280.avisos).toHaveLength(3);
  await page.setViewportSize({ width: 320, height: 568 });
  await dosCuadros(page);
  expect(await medir(page), 'de 1280 a 320').toEqual(de320);
  fueraDelPersonaje(await cajasDeAvisos(page), 320, 568, 'tras pasar a 320');
  await page.setViewportSize({ width: 1280, height: 800 });
  await dosCuadros(page);
  expect(await medir(page), 'de vuelta a 1280').toEqual(de1280);
});
