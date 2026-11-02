// La entrada con el juego real: carga, creador en cinco tamaños, modo foto y panel de rendimiento.
import { expect, test } from '@playwright/test';

const limpio = (page) => page.addInitScript(() => {
  try { localStorage.clear(); localStorage.setItem('bazuko.graphics_quality', 'baja'); } catch { /* sin almacenamiento */ }
});
const TAMANOS = [[1440, 900], [1280, 800], [844, 390], [375, 812], [320, 568]];
const cruzan = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test('la carga se imprime en una tinta, escribe BAZUKO y no tiene barra ni porcentaje', async ({ page }) => {
  await limpio(page);
  await page.route('**/src/core/game.js*', async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  await page.locator('.carga__arte').waitFor({ timeout: 60_000 });
  await expect(page.locator('#loading-status')).toHaveText('Un momentico');
  await expect(page.locator('#loading-screen progress, #loading-percent')).toHaveCount(0);
  const hoja = await page.evaluate(() => {
    const canvas = document.querySelector('.carga__arte');
    const datos = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const tintas = new Set();
    let puntos = 0;
    for (let i = 0; i < datos.length; i += 4) {
      if (datos[i + 3] < 250) continue;
      puntos++;
      tintas.add(`${datos[i]},${datos[i + 1]},${datos[i + 2]}`);
    }
    const lomos = [...document.querySelectorAll('.carga__lomo')];
    return { tintas: [...tintas], puntos, total: datos.length / 4, escritos: lomos.filter(l => l.getAttribute('visibility') === 'visible').length, lomos: lomos.length };
  });
  expect(hoja.tintas).toEqual(['20,17,12']);
  expect(hoja.puntos / hoja.total).toBeGreaterThan(.05);
  expect(hoja.escritos).toBeGreaterThan(0);
  expect(hoja.escritos).toBeLessThan(hoja.lomos);
  const barra = page.locator('#loading-progress');
  await expect(barra).toHaveRole('progressbar');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#loading-screen')).toBeHidden();
  const antes = Number(await barra.getAttribute('aria-valuenow'));
  await page.locator('#cr-name').fill('Luz Dary');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#loading-screen .carga__arte')).toHaveCount(0);
  expect(Number(await barra.getAttribute('aria-valuenow'))).toBeGreaterThan(antes);
  expect(await page.locator('.carga__lomo[visibility="hidden"]').count()).toBe(0);
});

test('si la carga falla lo dice corto y deja reintentar', async ({ page }) => {
  await limpio(page);
  await page.route('**/src/core/game.js*', route => route.abort());
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#loading-retry')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#loading-status')).toContainText('No se pudo cargar');
});

test('el creador se usa en todos los tamaños y 16 W no se cortan', async ({ page }) => {
  await limpio(page);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#creator-wait')).toBeHidden({ timeout: 60_000 });
  const nombre = page.locator('#cr-name');
  for (const [width, height] of TAMANOS) {
    await page.setViewportSize({ width, height });
    await page.locator('#cr-tab-identidad').click();
    await nombre.fill('W'.repeat(16));
    const medida = await page.evaluate(() => {
      const input = document.getElementById('cr-name');
      const caja = id => document.querySelector(id).getBoundingClientRect().toJSON();
      const lienzo = caja('#creator-canvas'), hoja = caja('.creator__side');
      const contexto = document.createElement('canvas').getContext('2d');
      contexto.font = `800 ${getComputedStyle(input).fontSize} "Dios Le Pague"`;
      const centro = document.elementFromPoint(lienzo.left + lienzo.width / 2, lienzo.top + lienzo.height / 2);
      const pestanas = [...document.querySelectorAll('.cr-tab')].map(b => b.getBoundingClientRect());
      return {
        cabe: contexto.measureText(input.value).width <= input.clientWidth,
        px: parseFloat(getComputedStyle(input).fontSize),
        lienzoAlto: lienzo.height, personajeLibre: centro?.id,
        cruza: lienzo.left < hoja.right - 1 && hoja.left < lienzo.right - 1 && lienzo.top < hoja.bottom - 1 && hoja.top < lienzo.bottom - 1,
        desborde: document.documentElement.scrollWidth - innerWidth,
        modal: document.getElementById('creator-modal').scrollWidth - innerWidth,
        pestanasFuera: pestanas.filter(r => r.right > innerWidth || r.left < 0).length,
        pisadas: pestanas.slice(1).filter((r, i) => r.left < pestanas[i].right - .5).length,
      };
    });
    expect(medida, `${width}`).toMatchObject({ cabe: true, personajeLibre: 'creator-canvas', cruza: false, desborde: 0, modal: 0, pestanasFuera: 0, pisadas: 0 });
    expect(medida.px).toBeGreaterThanOrEqual(16);
    expect(medida.lienzoAlto).toBeGreaterThanOrEqual(150);
    for (const id of ['#creator-close', '#creator-random', '#creator-done', '#creator-rot-l', '#creator-rot-r']) await expect(page.locator(id)).toBeInViewport({ ratio: 1 });
    if (width < 900) {
      const chicos = await page.locator('#creator-modal button:visible').evaluateAll(lista => lista.filter(b => {
        const r = b.getBoundingClientRect();
        return r.width < 44 || r.height < 44;
      }).map(b => b.id || b.textContent));
      expect(chicos).toEqual([]);
    }
    // El error sale al pedir empezar sin nombre y se va apenas hay nombre.
    await nombre.fill('');
    await page.locator('#creator-done').click();
    await expect(page.locator('#creator-error')).toBeVisible();
    await expect(page.locator('#creator-error')).toBeInViewport({ ratio: 1 });
    await expect(nombre).toHaveAttribute('aria-invalid', 'true');
    await nombre.fill('Jairo');
    await expect(page.locator('#creator-error')).toBeHidden();
    await expect(nombre).not.toHaveAttribute('aria-invalid', 'true');
  }
});

test('el creador se maneja con teclado, sin perder el foco y sin salirse del diálogo', async ({ page }) => {
  await limpio(page);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Jairo');
  await page.locator('#cr-tab-identidad').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#cr-tab-cuerpo')).toBeFocused();
  await expect(page.locator('#cr-tab-cuerpo')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#creator-panel')).toHaveAttribute('aria-labelledby', 'cr-tab-cuerpo');
  await page.keyboard.press('Tab');
  const mujer = page.getByRole('button', { name: 'Mujer', exact: true });
  await mujer.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Mujer', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Mujer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Mujer', exact: true })).toHaveClass(/elegido/);
  // Dando vueltas con Tab nunca se sale del diálogo.
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#creator-modal'))).toBe(true);
  }
  await page.locator('#creator-close').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('#creator-modal'))).toBe(true);
});

test('al cerrar el creador en plena partida el foco vuelve a donde estaba', async ({ page }) => {
  await limpio(page);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Jairo');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  const ayuda = page.locator('#controls-help-toggle');
  await ayuda.focus();
  await page.keyboard.press('P');
  await expect(page.locator('#creator-modal')).toBeVisible();
  await expect(page.locator('#creator-done')).toHaveText('Guardar');
  await expect(page.locator('#cr-tab-cuerpo')).toBeFocused();
  await page.locator('#creator-close').click();
  await expect(page.locator('#creator-modal')).toBeHidden();
  await expect(ayuda).toBeFocused();
});

test('con cuerpo joven la ropa ofrecida es solo la que cubre', async ({ page }) => {
  await limpio(page);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Jairo');
  await page.locator('#cr-tab-cuerpo').click();
  for (const sexo of ['Hombre', 'Mujer']) {
    await page.locator('#cr-tab-cuerpo').click();
    await page.getByRole('button', { name: sexo, exact: true }).click();
    await page.getByRole('button', { name: 'Joven', exact: true }).click();
    await page.locator('#cr-tab-ropa').click();
    const vistas = await page.getByRole('group', { name: 'Ropa', exact: true }).getByRole('button').allTextContents();
    const { permitidas, todas } = await page.evaluate(async sexoId => {
      const { loadCatalog, optionsFor } = await import('/src/character/RealisticCharacter.js');
      const { garmentAllowed } = await import('/src/character/archetypes.js');
      const opciones = optionsFor(await loadCatalog(), 'ropa', sexoId);
      return { permitidas: opciones.filter(o => garmentAllowed(o.id, 'joven')).map(o => o.label), todas: opciones.length };
    }, sexo.toLowerCase());
    expect(vistas).toEqual(permitidas);
    expect(todas).toBeGreaterThanOrEqual(vistas.length);
  }
});

test('el personaje se gira con el dedo y el panel no se mueve', async ({ browser }) => {
  const contexto = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
  const page = await contexto.newPage();
  await limpio(page);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#creator-wait')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#cr-name')).not.toBeFocused();
  await page.waitForTimeout(600);
  const lienzo = page.locator('#creator-canvas');
  const caja = await lienzo.boundingBox();
  await expect.poll(() => lienzo.evaluate(c => getComputedStyle(c).touchAction)).toBe('none');
  const antes = await lienzo.screenshot();
  const cdp = await contexto.newCDPSession(page);
  const y = caja.y + caja.height / 2;
  const punto = x => [{ x, y }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: punto(120) });
  for (let x = 130; x <= 260; x += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: punto(x) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  expect(Buffer.compare(antes, await lienzo.screenshot())).not.toBe(0);
  expect(await page.evaluate(() => document.getElementById('creator-panel').scrollTop)).toBe(0);
  await contexto.close();
});

test('foto: controles de cartón que se esconden, archivo con el nombre del juego y F3 sin tapar', async ({ page }) => {
  await limpio(page);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Jairo');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);

  for (const [width, height] of TAMANOS) {
    await page.setViewportSize({ width, height });
    await page.keyboard.press('F3');
    await expect(page.locator('#performance-panel')).toBeVisible();
    await page.waitForTimeout(300);
    const tapa = await page.evaluate(({ }) => {
      const panel = document.getElementById('performance-panel').getBoundingClientRect();
      const piezas = ['#hud-dock', '#minimap-container', '#panel-dock', '#quickbar', '#topbar'].map(s => [s, document.querySelector(s)]).filter(([, e]) => {
        if (!e) return false;
        const c = getComputedStyle(e), r = e.getBoundingClientRect();
        return c.visibility === 'visible' && c.display !== 'none' && r.width > 2;
      }).map(([s, e]) => [s, e.getBoundingClientRect().toJSON()]);
      return { panel: panel.toJSON(), piezas };
    }, {});
    const pisadas = tapa.piezas.filter(([, r]) => cruzan(tapa.panel, r)).map(([s]) => s);
    expect(pisadas, `F3 a ${width}`).toEqual([]);
    expect(tapa.panel.right).toBeLessThanOrEqual(width);
    await page.keyboard.press('F3');
    await expect(page.locator('#performance-panel')).toBeHidden();

    await page.keyboard.press('F2');
    await expect(page.locator('#photo-mode')).toBeVisible();
    const medida = await page.evaluate(() => {
      const r = document.querySelector('.photo-mode__panel').getBoundingClientRect();
      const otros = [...document.querySelectorAll('body *')].filter(e => {
        if (e.closest('#photo-mode') || e.id === 'game-canvas' || e.id === 'app') return false;
        const c = getComputedStyle(e), b = e.getBoundingClientRect();
        return c.display !== 'none' && c.visibility === 'visible' && +c.opacity > 0 && b.width > 2 && b.height > 2;
      }).map(e => e.id || e.className || e.tagName);
      const chicos = [...document.querySelectorAll('#photo-mode button')].filter(b => b.offsetParent && (b.getBoundingClientRect().width < 44 || b.getBoundingClientRect().height < 44)).length;
      return { tapa: r.width * r.height / innerWidth / innerHeight, dentro: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, otros, chicos };
    });
    expect(medida.otros, `lo que queda a ${width}`).toEqual([]);
    expect(medida.dentro).toBe(true);
    expect(medida.chicos).toBe(0);
    expect(medida.tapa, `tapa a ${width}`).toBeLessThan(.2);
    await page.keyboard.press('h');
    await expect(page.locator('.photo-mode__panel')).toBeHidden();
    await expect(page.locator('#menu'), 'en la foto, H no abre el estado').toBeHidden();
    await expect(page.locator('.photo-mode__show')).toBeFocused();
    await page.locator('.photo-mode__show').click();
    await expect(page.locator('.photo-mode__panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#photo-mode')).toBeHidden();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press('F2');
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Guardar foto', exact: true }).click();
  expect((await descarga).suggestedFilename()).toMatch(/^Bazuko-Bogota-.+\.png$/);
  await expect(page.locator('.photo-mode__status')).toContainText('Foto lista');
  await page.keyboard.press('Escape');
});
