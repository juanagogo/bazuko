import { test, expect } from '@playwright/test';

// Lo que se rompe solo con la pantalla chica y el dedo: lo que queda por debajo, lo que se pisa y lo que hace cada toque.
// Una entrada al juego por prueba, y el tamaño cambia adentro, porque cargar es lo que cuesta.

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

class Dedos {
  constructor(cdp) { this.cdp = cdp; this.vivos = new Map(); }
  puntos() { return [...this.vivos].map(([id, p]) => ({ id, ...p })); }
  async bajar(id, x, y) { this.vivos.set(id, { x, y }); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.puntos() }); }
  async mover(id, x, y) { this.vivos.set(id, { x, y }); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.puntos() }); }
  async subir(id) { const p = this.vivos.get(id); this.vivos.delete(id); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, ...p }] }); }
  async cancelar() { this.vivos.clear(); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); }
  async tocar(x, y, id = 9) { await this.bajar(id, x, y); await espera(40); await this.subir(id); }
}
const centro = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error(`sin caja: ${sel}`); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; };
const tocar = async (page, dedos, sel, id) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); const c = await centro(page, sel); await dedos.tocar(c.x, c.y, id); await espera(120); };

/** Entra como se entraría con la mano, y deja a mano lo que cada prueba necesita para poner la escena. */
async function entrar(page, oprimir = 'tap') {
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero');
  await page.locator('#creator-done')[oprimir]();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true })[oprimir]();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  await page.evaluate(() => {
    const g = window.__game;
    const H = window.H = {
      g,
      tp(x, z) { const p = g.player, y = g.world.active.getMovementGroundHeight?.(x, z, 0) ?? 0; p.position.set(x, y, z); p.root.position.copy(p.position); p.velocity.set(0, 0, 0); p.resetGrounding(); g.cameraRig._snap = true; },
      calm(over = {}) { Object.assign(g.stats, { salud: 100, hambre: 88, sed: 86, energia: 84, higiene: 82, animo: 80, vicio: 90, calor: 0 }, over); },
      async items(spec, clear = true) { const { ITEMS } = await import('/src/data/items.js'); if (clear) g.inventory.clear(); for (const [id, qty] of Object.entries(spec)) g.inventory.add(ITEMS[id], qty); },
      tranquilo() { H.calm(); g.clock.hour = 12; g.weather.setWeather('soleado', false); g.weather.timer = 0; g.weather.nextChange = 1e7; setInterval(() => { H.calm(); g.steal.buscado = 0; g.traffic.wantedLevel = 0; document.querySelectorAll('.loot-toast').forEach((t) => t.remove()); }, 300); },
    };
    window.__teclas = [];
    addEventListener('keydown', (e) => window.__teclas.push(`v${e.code}`), true);
    addEventListener('keyup', (e) => window.__teclas.push(`^${e.code}`), true);
    H.tranquilo();
  });
}
const teclas = (page) => page.evaluate(() => window.__teclas.splice(0));

const MOVILES = [[844, 390], [667, 375], [740, 360], [568, 320], [740, 300], [780, 300], [800, 320], [667, 331], [375, 812], [360, 640], [320, 568], [320, 454]];

test.describe('con el dedo', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test('la hoja «Más»: nada pasa por debajo de ningún botón, a ningún tamaño', async ({ page, context }) => {
    await entrar(page);
    const dedos = new Dedos(await context.newCDPSession(page));
    await page.evaluate(() => { const p = H.g.pickups[0].position; H.tp(p.x + 1, p.z); });
    await expect(page.locator('#interaction-prompt')).toContainText('Recoger', { timeout: 8000 });

    for (const [width, height] of MOVILES) {
      await page.setViewportSize({ width, height });
      await espera(200);
      await tocar(page, dedos, '[data-accion="mas"]');
      await expect(page.locator('#tactil-mas')).toBeVisible();
      const revisado = await page.evaluate(() => [...document.querySelectorAll('.tactil-mas__boton')].map((b) => {
        const r = b.getBoundingClientRect(), tapado = [];
        for (const [a, c] of [[.5, .5], [.1, .15], [.9, .15], [.1, .85], [.9, .85]]) {
          const e = document.elementFromPoint(r.left + r.width * a, r.top + r.height * c);
          if (e !== b && !b.contains(e)) tapado.push(e?.id || e?.className?.toString() || e?.tagName);
        }
        return { boton: b.dataset.accion, tapado, afuera: r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight, ancho: r.width, alto: r.height };
      }));
      expect(revisado.length).toBeGreaterThan(3);
      for (const b of revisado) {
        expect(b.tapado, `${b.boton} a ${width}×${height}`).toEqual([]);
        expect(b.afuera, `${b.boton} se sale a ${width}×${height}`).toBe(false);
        expect(b.ancho).toBeGreaterThanOrEqual(44);
        expect(b.alto).toBeGreaterThanOrEqual(44);
      }
      await tocar(page, dedos, '[data-accion="mas"]');
      await expect(page.locator('#tactil-mas')).toBeHidden();
    }

    // Donde estaba Cámara se cambia la cámara: ni se recoge ni se roba por debajo.
    await page.setViewportSize({ width: 844, height: 390 });
    await espera(200);
    await tocar(page, dedos, '[data-accion="mas"]');
    await teclas(page);
    const antes = await page.evaluate(() => H.g.cameraRig.mode);
    await tocar(page, dedos, '[data-accion="camara"]');
    await expect.poll(() => page.evaluate(() => H.g.cameraRig.mode)).not.toBe(antes);
    expect(await teclas(page)).not.toContain('vKeyE');
    await expect(page.locator('#tactil-mas')).toBeHidden();
    await expect(page.locator('#interaction-prompt')).toBeVisible();

    // El radar con el dedo: tocarlo saca sus herramientas.
    await tocar(page, dedos, '.radar__abrir');
    await expect(page.locator('.radar__tools')).toBeVisible();
    await tocar(page, dedos, '.radar__abrir');
    await expect(page.locator('.radar__tools')).toBeHidden();
  });

  test('el costal acostado y de pie, con 34 objetos y casi lleno', async ({ page, context }) => {
    await entrar(page);
    const dedos = new Dedos(await context.newCDPSession(page));
    await page.evaluate(async () => {
      const { ITEMS } = await import('/src/data/items.js');
      H.g.inventory.clear();
      for (const id of Object.keys(ITEMS).slice(0, 34)) H.g.inventory.add(ITEMS[id], 2);
      H.g.inventoryUI.open();
    });
    for (const [width, height] of [[568, 320], [620, 360], [667, 375], [700, 340], [759, 390], [844, 390], [320, 568], [320, 454]]) {
      await page.setViewportSize({ width, height });
      await espera(200);
      const m = await page.evaluate(() => {
        const win = document.querySelector('.inv-window'), grid = document.querySelector('.inv-grid');
        const techo = grid.getBoundingClientRect();
        const verse = (r) => Math.min(r.bottom, techo.bottom) - Math.max(r.top, techo.top);
        const filas = new Set([...grid.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0 && verse(r) >= r.height * .75).map((r) => Math.round(r.top))).size;
        const salidos = [...win.querySelectorAll('button, .inv-load, .inv-load-flag')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + .5 || r.left < -.5); }).length;
        const ven = win.getBoundingClientRect();
        return { filas, salidos, hoja: document.documentElement.scrollWidth, ancho: ven.width, alto: ven.height, gridAncho: techo.width };
      });
      expect(m.filas, `filas a la vista a ${width}×${height}`).toBeGreaterThanOrEqual(height < 500 && width < height ? 2 : 3);
      expect(m.salidos, `a ${width}×${height}`).toBe(0);
      expect(m.hoja).toBeLessThanOrEqual(width);
      expect(m.alto, `el costal aprovecha el alto a ${width}×${height}`).toBeGreaterThan(height * .8);
      if (width < 760 && width > height) expect(m.gridAncho, `no deja media hoja vacía a ${width}`).toBeGreaterThan(m.ancho * .45);
    }

    // A 320 el aviso de carga también cabe.
    await page.evaluate(async () => { await H.items({ chatarra: 20 }); });
    await page.setViewportSize({ width: 320, height: 568 });
    await espera(200);
    await expect(page.locator('.inv-load-flag')).not.toBeEmpty();
    const bandera = await page.locator('.inv-load-flag').boundingBox();
    expect(bandera.x + bandera.width).toBeLessThanOrEqual(320);
    const cierre = await page.locator('.inv-close').boundingBox();
    expect(cierre.x + cierre.width).toBeLessThanOrEqual(320);
    expect(cierre.height).toBeGreaterThanOrEqual(44);
    await tocar(page, dedos, '.inv-close');
    await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
  });

  test('con poco alto nada se pisa, y lo que cuesta caro queda a su distancia', async ({ page, context }) => {
    await entrar(page);
    const dedos = new Dedos(await context.newCDPSession(page));
    await page.evaluate(async () => {
      await H.items({ pan: 3, agua: 2, carton: 2, chatarra: 1, botella: 1 });
      H.g.inventory.hotbar = ['pan', 'agua', 'carton', 'chatarra', 'botella'];
      H.g.inventory._notify?.();
      const m = document.getElementById('mision'); m.textContent = 'TOCA JUNTAR 8 CARTONES'; m.hidden = false;
      setInterval(() => { m.hidden = false; }, 200);
      H.g.hud._retazoId = undefined;
    });
    const medir = () => page.evaluate(() => {
      const ve = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const piezas = { dock: '#hud-dock', mision: '#mision', palanca: '.joystick__aro', mas: '[data-accion="mas"]', casillas: '#quickbar', paneles: '#panel-dock', pegar: '[data-accion="pegar"]', correr: '[data-accion="correr"]' };
      const R = {};
      for (const [k, s] of Object.entries(piezas)) { const e = document.querySelector(s); if (e && ve(e)) R[k] = e.getBoundingClientRect(); }
      const pisa = [], k = Object.keys(R);
      for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
        const a = R[k[i]], b = R[k[j]];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) pisa.push(`${k[i]}/${k[j]}`);
      }
      const dist = (a, b) => Math.hypot(Math.max(R[a].left - R[b].right, R[b].left - R[a].right, 0), Math.max(R[a].top - R[b].bottom, R[b].top - R[a].bottom, 0));
      const lleno = [...document.querySelectorAll('#hud-dock *')].filter((e) => ve(e) && e.children.length === 0 && e.textContent.trim() && e.getBoundingClientRect().bottom > innerHeight + .5).length;
      return { pisa, palancaMas: dist('palanca', 'mas'), casillasPaneles: dist('casillas', 'paneles'), lleno };
    });
    for (const [width, height] of MOVILES) {
      await page.setViewportSize({ width, height });
      await espera(250);
      const m = await medir();
      expect(m.pisa, `a ${width}×${height}`).toEqual([]);
      expect(m.lleno, `a ${width}×${height}`).toBe(0);
      if (width >= 360) {
        expect(m.casillasPaneles, `casillas y paneles a ${width}×${height}`).toBeGreaterThanOrEqual(8);
        if (width > height) expect(m.palancaMas, `palanca y Más a ${width}×${height}`).toBeGreaterThanOrEqual(8);
      }
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await espera(150);
    await tocar(page, dedos, '#pause-toggle');
    await expect.poll(() => page.evaluate(() => H.g.paused)).toBe(true);
  });

  test('el pulgar en la palanca no deja mudo al otro dedo, y un toque no vale dos', async ({ page, context }) => {
    await entrar(page);
    const dedos = new Dedos(await context.newCDPSession(page));
    await page.evaluate(() => H.tp(58, 130));
    const aro = await centro(page, '.joystick__aro');

    // El otro dedo abre el costal, usa sus botones y lo cierra con el pulgar quieto.
    await page.evaluate(async () => { await H.items({ carton: 5 }); });
    await dedos.bajar(1, aro.x, aro.y);
    await dedos.mover(1, aro.x, aro.y - aro.w / 2);
    await tocar(page, dedos, '#inventory-open', 2);
    await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => H.g.input.axis)).toEqual({ x: 0, z: 0 });

    // Se tira uno solo, aunque después llegue el clic de ratón que deja el navegador donde sí lo da.
    const tirar = await centro(page, '[data-act="drop1"]');
    await dedos.bajar(2, tirar.x, tirar.y);
    await espera(30);
    await dedos.subir(2);
    await page.mouse.click(tirar.x, tirar.y);
    await espera(100);
    expect(await page.evaluate(() => H.g.inventory.slots[0].qty)).toBe(4);
    await tocar(page, dedos, '.inv-close', 2);
    await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);

    // La pausa también responde: y sigue sin hacer falta el pulgar.
    await tocar(page, dedos, '#pause-toggle', 2);
    await expect.poll(() => page.evaluate(() => H.g.paused)).toBe(true);
    await page.getByRole('button', { name: 'Continuar jugando', exact: true }).waitFor();
    const seguir = await centro(page, 'button:has-text("Continuar jugando")');
    await dedos.tocar(seguir.x, seguir.y, 2);
    await expect.poll(() => page.evaluate(() => H.g.paused)).toBe(false);
    await dedos.subir(1);

    // Soltar fuera del botón y la interrupción del sistema: se sueltan las teclas, y no se ejecuta nada.
    for (const accion of ['correr', 'mas']) {
      const b = await centro(page, `[data-accion="${accion}"]`);
      await dedos.bajar(3, b.x, b.y);
      await espera(30);
      await dedos.mover(3, b.x - 200, b.y - 150);
      await dedos.subir(3);
      await espera(80);
      expect(await page.evaluate(() => H.g.input.isRunning), `${accion} al soltar afuera`).toBe(false);
      await expect(page.locator('#tactil-mas'), `${accion} al soltar afuera`).toBeHidden();
      await dedos.bajar(3, b.x, b.y);
      await espera(30);
      await dedos.cancelar();
      await espera(80);
      expect(await page.evaluate(() => H.g.input.isRunning), `${accion} interrumpido`).toBe(false);
      await expect(page.locator('#tactil-mas'), `${accion} interrumpido`).toBeHidden();
    }
    await tocar(page, dedos, '[data-accion="mas"]');
    for (const accion of ['camara', 'radio', 'ayuda', 'sonido']) {
      const b = await centro(page, `[data-accion="${accion}"]`);
      await teclas(page);
      const antes = await page.evaluate(() => ({ camara: H.g.cameraRig.mode, pausa: H.g.paused, menu: H.g.menu.isOpen, sonido: document.getElementById('audio-toggle').title }));
      await dedos.bajar(3, b.x, b.y);
      await espera(30);
      await dedos.mover(3, b.x + 150, b.y + 400 > 380 ? 8 : b.y + 400);
      await dedos.subir(3);
      await espera(80);
      await dedos.bajar(3, b.x, b.y);
      await espera(30);
      await dedos.cancelar();
      await espera(80);
      expect(await page.evaluate(() => ({ camara: H.g.cameraRig.mode, pausa: H.g.paused, menu: H.g.menu.isOpen, sonido: document.getElementById('audio-toggle').title })), accion).toEqual(antes);
      expect((await teclas(page)).filter((t) => t.startsWith('v')), accion).toEqual([]);
      await expect(page.locator('#tactil-mas'), `${accion}: la hoja sigue abierta`).toBeVisible();
    }
    await tocar(page, dedos, '[data-accion="mas"]');
    // Lo que se sostiene se suelta de verdad: Pegar no queda oprimido tras la interrupción.
    const pegar = await centro(page, '[data-accion="pegar"]');
    await dedos.bajar(3, pegar.x, pegar.y);
    await espera(30);
    await dedos.cancelar();
    await espera(50);
    const pegado = (await teclas(page)).filter((t) => t.endsWith('KeyG'));
    expect(pegado.at(-1)).toBe('^KeyG');
  });

  test('isométrica: la palanca es la pantalla; el teclado sigue igual y el siguiente dedo libre toma el mirar', async ({ page, context }) => {
    await entrar(page);
    const dedos = new Dedos(await context.newCDPSession(page));
    await page.evaluate(() => { H.tp(58, 130); H.g.player.resetGrounding(); });
    await tocar(page, dedos, '[data-accion="mas"]');
    await tocar(page, dedos, '[data-accion="camara"]');
    await expect.poll(() => page.evaluate(() => H.g.cameraRig.camera.userData.cameraMode)).toBe('isometric');
    const pantalla = () => page.evaluate(() => { const v = H.g.player.position.clone().project(H.g.cameraRig.camera); return { x: v.x * innerWidth / 2, y: -v.y * innerHeight / 2, wx: H.g.player.position.x, wz: H.g.player.position.z }; });
    const aro = await centro(page, '.joystick__aro');

    // Arriba con el dedo es arriba en la pantalla: no en diagonal.
    await page.evaluate(() => H.tp(58, 130));
    await espera(150);
    let a = await pantalla();
    await dedos.bajar(1, aro.x, aro.y);
    await dedos.mover(1, aro.x, aro.y - aro.w / 2);
    await expect.poll(async () => { const b = await pantalla(); return Math.hypot(b.wx - a.wx, b.wz - a.wz); }, { timeout: 8000 }).toBeGreaterThan(.6);
    await dedos.subir(1);
    let b = await pantalla();
    const dedoX = Math.abs(b.wx - a.wx), dedoZ = Math.abs(b.wz - a.wz);
    expect(Math.abs(dedoX - dedoZ) / Math.hypot(dedoX, dedoZ), `el mundo va en diagonal: es lo que la cámara ve arriba (${dedoX}, ${dedoZ})`).toBeLessThan(.35);

    // Tercera persona: un dedo libre mira, y al soltarlo el siguiente sigue sin saltar.
    await tocar(page, dedos, '[data-accion="mas"]');
    await tocar(page, dedos, '[data-accion="camara"]');
    await expect.poll(() => page.evaluate(() => H.g.cameraRig.camera.userData.cameraMode)).toBe('third-person');
    const yaw = () => page.evaluate(() => H.g.cameraRig.yaw);
    await dedos.bajar(1, aro.x, aro.y);
    await dedos.mover(1, aro.x, aro.y - aro.w / 2);
    await dedos.bajar(2, 500, 150);
    await dedos.mover(2, 480, 150);
    await dedos.bajar(3, 620, 200);
    await dedos.subir(2);
    const y0 = await yaw();
    await dedos.mover(3, 621, 200);
    expect(Math.abs(await yaw() - y0), 'el dedo nuevo no salta').toBeLessThan(.05);
    for (let i = 1; i <= 5; i++) await dedos.mover(3, 621 - i * 14, 200);
    expect(Math.abs(await yaw() - y0), 'y mira').toBeGreaterThan(.1);
    expect(await page.evaluate(() => H.g.input.axis.z)).toBeLessThan(-.9);
    await dedos.subir(3);
    await dedos.subir(1);
    await tocar(page, dedos, '[data-accion="mas"]');
    await tocar(page, dedos, '[data-accion="camara"]');
    await expect.poll(() => page.evaluate(() => H.g.cameraRig.camera.userData.cameraMode)).toBe('isometric');

    // Con teclado, en esta cámara, W sigue siendo el eje del mundo.
    await page.evaluate(() => { H.tp(58, 130); });
    await espera(150);
    a = await pantalla();
    await page.keyboard.down('KeyW');
    await expect.poll(async () => { const c = await pantalla(); return Math.hypot(c.wx - a.wx, c.wz - a.wz); }, { timeout: 8000 }).toBeGreaterThan(.6);
    await page.keyboard.up('KeyW');
    b = await pantalla();
    expect(Math.abs(b.wx - a.wx)).toBeLessThan(.15);
  });

  test('tras detener la barra, Brincar no salta por el mismo gesto', async ({ page }) => {
    await entrar(page);
    await page.evaluate(() => {
      H.tp(58, 130);
      const npc = H.g.world.active.npcs.find((n) => n.character && !n._disposed && !n.isVendor);
      H.g.steal.startCosquilleo(npc);
    });
    await expect(page.locator('#steal-minigame')).toBeVisible();
    // Dentro de un mismo instante, para que la carga de la máquina no cuente en una espera de 250 ms.
    const oprimir = (veces) => page.evaluate((veces) => {
      const b = document.querySelector('[data-accion="brincar"]'), r = b.getBoundingClientRect();
      const o = { pointerId: 77, bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4, pointerType: 'touch' };
      window.__teclas.length = 0;
      const salida = [];
      for (let i = 0; i < veces; i++) {
        b.dispatchEvent(new PointerEvent('pointerdown', o));
        b.dispatchEvent(new PointerEvent('pointerup', o));
        salida.push({ espacios: window.__teclas.splice(0).filter((t) => t === 'vSpace').length, barra: H.g.steal.minigameActive });
      }
      return salida;
    }, veces);
    const [primera, segunda] = await oprimir(2);
    expect(primera.barra, 'el primer toque detiene la barra').toBe(false);
    expect(segunda.espacios, 'el segundo toque, pegado al que detuvo').toBe(0);
    await espera(300);
    expect((await oprimir(1))[0].espacios, 'después ya salta').toBe(1);
  });

  test('el mapa se pellizca: acerca sin saltar, y al quedar un dedo no marca destino', async ({ page, context }) => {
    await entrar(page);
    const dedos = new Dedos(await context.newCDPSession(page));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-pause-menu', { detail: { tab: 'mapa' } })));
    await expect(page.locator('.map-view canvas')).toBeVisible();
    await espera(200);
    const caja = await page.locator('.map-view canvas').boundingBox();
    const mx = caja.x + caja.width / 2, my = caja.y + caja.height / 2;
    const estado = () => page.evaluate(() => { const m = H.g.mapView; return { zoom: m.zoom, cx: m.centerX, cz: m.centerZ, destino: H.g.gps?.waypoint ?? null }; });
    const mundoEnMedio = (s) => ({ x: s.cx + (mx - caja.x - caja.width / 2) / s.zoom, z: s.cz + (my - caja.y - caja.height / 2) / s.zoom });
    const e0 = await estado();
    await dedos.bajar(1, mx - 30, my);
    await dedos.bajar(2, mx + 30, my);
    for (let i = 1; i <= 6; i++) { await dedos.mover(1, mx - 30 - i * 10, my); await dedos.mover(2, mx + 30 + i * 10, my); }
    const e1 = await estado();
    expect(e1.zoom, 'abrir los dedos acerca').toBeGreaterThan(e0.zoom * 1.3);
    const a = mundoEnMedio(e0), b = mundoEnMedio(e1);
    expect(Math.hypot(a.x - b.x, a.z - b.z) * e1.zoom, 'el punto entre los dedos sigue entre los dedos').toBeLessThan(6);
    // Al soltar uno, el otro arrastra desde donde está: sin salto, y sin marcar nada al soltar.
    await dedos.subir(2);
    const e2 = await estado();
    await dedos.mover(1, mx - 88, my);
    const e3 = await estado();
    expect(Math.hypot(e3.cx - e2.cx, e3.cz - e2.cz) * e3.zoom).toBeLessThan(12);
    await dedos.subir(1);
    await espera(120);
    expect((await estado()).destino, 'no marcó destino').toBeNull();
  });

  test('con el dedo ningún objeto habla de teclas, y la foto tampoco', async ({ page, context }) => {
    await entrar(page);
    const dedos = new Dedos(await context.newCDPSession(page));
    const TECLAS = /\bShift\b|WASD|\bEsc\b|\[[A-Z]\]|\bTab\b|[Tt]ecla|\b[Cc]lic\b|[Rr]atón|[Pp]resiona|\bF2\b|con [A-Z]\b|\([A-Z]\)|\bo [A-Z]\b|[Rr]ueda|[Ff]lechas|Enter|teclado/;
    const hablan = await page.evaluate(async () => {
      const { ITEMS } = await import('/src/data/items.js');
      const ui = H.g.inventoryUI, inv = H.g.inventory;
      ui.open();
      const salida = [];
      for (const id of Object.keys(ITEMS)) {
        inv.clear();
        inv.add(ITEMS[id], 1);
        ui.select(0, { focus: false });
        ui._render();
        salida.push({ id, nota: document.querySelector('.inv-note')?.textContent ?? '', todo: document.querySelector('.inv-bench')?.innerText ?? '' });
      }
      ui.close();
      return salida;
    });
    expect(hablan.length).toBeGreaterThan(30);
    expect(hablan.find((h) => h.id === 'radioTransistor').nota).toMatch(/sintonizador/);
    for (const h of hablan) expect(h.todo, h.id).not.toMatch(TECLAS);

    await page.evaluate(() => H.g.photoMode.enter());
    await expect(page.locator('#photo-mode-help')).toHaveText('Arrastre para girar.');
    const yaw = await page.evaluate(() => H.g.cameraRig.yaw);
    await dedos.bajar(1, 300, 120);
    for (let i = 1; i <= 4; i++) await dedos.mover(1, 300 + i * 20, 120);
    await dedos.subir(1);
    await expect.poll(() => page.evaluate(() => H.g.cameraRig.yaw)).not.toBe(yaw);
  });

  test('morir, caer preso, dormir, armar el cambuche, comprar y vender: todo con el dedo', async ({ page, context }) => {
    await entrar(page);
    const dedos = new Dedos(await context.newCDPSession(page));
    const plata = () => page.evaluate(() => H.g.stats.dinero);
    const enLaHoja = (nombre) => page.locator('#menu').getByRole('button', { name: nombre });
    const oprimirEn = async (loc) => { const b = await loc.boundingBox(); await dedos.tocar(b.x + b.width / 2, b.y + b.height / 2); await espera(150); };
    await page.evaluate(async () => { H.g.stats.dinero = 50000; window.__pm = await import('/src/ui/placeMenus.js'); });

    // Comprar: baja la plata y entra el objeto.
    await page.evaluate(async () => { await H.items({}); window.__pm.openShop(H.g); });
    await expect(page.locator('#menu')).toBeVisible();
    let antes = await plata();
    await oprimirEn(page.locator('#menu .row button:not([disabled])').first());
    expect(await plata()).toBeLessThan(antes);
    expect(await page.evaluate(() => H.g.inventory.usedSlots)).toBe(1);
    await tocar(page, dedos, '#menu-close');
    await expect(page.locator('#menu')).toBeHidden();

    // Vender en la recicladora: sube.
    await page.evaluate(async () => { await H.items({ carton: 3 }); window.__pm.openRecycler(H.g); });
    antes = await plata();
    await oprimirEn(page.locator('#menu .menu__foot button:not([disabled])').first());
    await expect.poll(plata).toBeGreaterThan(antes);
    await tocar(page, dedos, '#menu-close');
    await expect(page.locator('#menu')).toBeHidden();

    // El jíbaro: comprar baja, vender sube.
    await page.evaluate(async () => { H.g.inventory.clear(); H.g.clock.hour = 23; H.g.hud.toggleDealerPanel(); });
    await expect(page.locator('#dealer-panel')).toHaveClass(/open/);
    antes = await plata();
    await tocar(page, dedos, '.dealer-buy-btn:not([disabled])');
    await expect.poll(plata).toBeLessThan(antes);
    antes = await plata();
    await tocar(page, dedos, '.dealer-sell-btn');
    await expect.poll(plata).toBeGreaterThan(antes);
    await tocar(page, dedos, '.dealer-close');
    await expect(page.locator('#dealer-panel')).not.toHaveClass(/open/);
    await page.evaluate(() => { H.g.clock.hour = 12; });

    // El cambuche: armar gasta material, y deja dormir.
    await page.evaluate(async () => { await H.items({ carton: 12, tablas: 6, cuerda: 6, lona: 6, chatarra: 6 }); window.__pm.openCambuche(H.g); });
    const materiales = () => page.evaluate(() => H.g.inventory.slots.reduce((t, s) => t + (s?.qty ?? 0), 0));
    antes = await materiales();
    await oprimirEn(page.locator('#menu .row button:not([disabled])').first());
    await expect.poll(materiales).toBeLessThan(antes);
    expect(await page.evaluate(() => H.g.built.base)).toBe(true);
    // Dormir: se oprime, se pasa la noche y vuelve la calle.
    await page.evaluate(() => { H.g.clock.hour = 23; window.__pm.openCambuche(H.g); });
    await oprimirEn(page.locator('#menu .menu__foot button:not([disabled])').last());
    await expect(page.locator('#cerrado')).toContainText('ABRIMOS A LAS 06:00');
    await expect(page.locator('#cerrado')).toBeHidden({ timeout: 25_000 });
    await expect.poll(() => page.evaluate(() => H.g.paused)).toBe(false);

    // Caer preso: el único botón responde al dedo.
    await page.evaluate(() => { H.g.stats.dinero = 12400; window.dispatchEvent(new CustomEvent('police-arrest')); });
    await expect(page.locator('#menu')).toHaveAttribute('data-momento', 'plana');
    await expect(enLaHoja('Continuar')).toBeVisible();
    await espera(400);
    await oprimirEn(enLaHoja('Continuar'));
    await expect(page.locator('#menu')).toBeHidden();
    expect(await plata()).toBe(0);
    await expect.poll(() => page.evaluate(() => H.g.paused)).toBe(false);

    // Morir: igual.
    await page.evaluate(() => { H.g._deathCause = 'atropello'; H.g.stats.salud = 0; });
    await expect(page.locator('#menu')).toHaveAttribute('data-momento', 'muerte');
    const boton = page.locator('#menu .menu__foot button').first();
    await expect(boton).toBeVisible({ timeout: 15_000 });
    await espera(400);
    await oprimirEn(boton);
    await expect(page.locator('#menu')).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => H.g.stats.salud)).toBeGreaterThan(0);
  });

  test('el creador acostado: el saludo no le pasa por encima al nombre', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
    for (const [width, height] of [[844, 390], [667, 375]]) {
      await page.setViewportSize({ width, height });
      await espera(150);
      // El brazo sale hacia la izquierda del personaje y la cabeza va en el medio: el nombre vive a la derecha.
      const m = await page.evaluate(() => { const s = document.querySelector('.creator__stage').getBoundingClientRect(), c = document.querySelector('.creator__marca').getBoundingClientRect(); return { centro: s.left + s.width / 2, izquierda: c.left, derecha: c.right, fin: s.right, abajo: c.bottom }; });
      expect(m.izquierda).toBeGreaterThan(m.centro - 2);
      expect(m.derecha).toBeLessThanOrEqual(m.fin);
    }
  });
});

test.describe('con ratón y teclado', () => {
  test('todos los botones del HUD responden, y Tab no se sale de la mesa ni de las mañas', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await entrar(page, 'click');
    await expect(page.locator('body')).not.toHaveClass(/\btactil\b/);
    await expect(page.locator('.joystick__aro')).toBeHidden();
    await expect(page.locator('#tactil-mas')).toBeHidden();
    await expect(page.locator('#panel-dock kbd').first()).toHaveText('I');

    await page.locator('#audio-toggle').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('audio-toggle').title)).not.toBe('Silenciar sonido');
    await page.locator('#audio-toggle').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('audio-toggle').title)).toBe('Silenciar sonido');

    await page.locator('#radio-toggle').click();
    await expect(page.locator('#menu-title')).toHaveText('La radio');
    await expect(page.locator('#menu-close kbd')).toHaveText('R');
    await page.locator('#menu-close').click();
    await expect(page.locator('#menu')).toBeHidden();

    await page.locator('#pause-toggle').click();
    await expect.poll(() => page.evaluate(() => H.g.paused)).toBe(true);
    await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
    await expect.poll(() => page.evaluate(() => H.g.paused)).toBe(false);

    const modo = await page.evaluate(() => H.g.cameraRig.mode);
    await page.locator('#camera-toggle').click();
    await expect.poll(() => page.evaluate(() => H.g.cameraRig.mode)).not.toBe(modo);
    await page.locator('#camera-toggle').click();
    await expect.poll(() => page.evaluate(() => H.g.cameraRig.mode)).toBe(modo);

    await page.locator('.radar__tools [data-radar="toggle"]').click();
    await expect(page.locator('#minimap-container')).toHaveClass(/hidden/);
    await page.locator('.radar__show').click();
    await expect(page.locator('#minimap-container')).not.toHaveClass(/hidden/);
    await page.locator('#needs-toggle').click();
    await expect(page.locator('#needs-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#needs-toggle').click();
    await expect(page.locator('#needs-toggle')).toHaveAttribute('aria-expanded', 'false');

    // Un mismo cierre: misma forma, y la tecla de cada ventana. La tecla lo abre y lo cierra.
    const paneles = [
      { abre: '#craft-open', panel: '#craft-panel', cierra: '.craft-close', tecla: 'C' },
      { abre: '#inventory-open', panel: '#inv-overlay', cierra: '.inv-close', tecla: 'I' },
    ];
    const forma = async (sel) => page.locator(sel).evaluate((b) => { const c = getComputedStyle(b), r = b.getBoundingClientRect(); return { picto: !!b.querySelector('.picto[data-dibujo]'), kbd: b.querySelector('kbd')?.textContent, alto: r.height, derecha: Math.round(innerWidth - r.right) >= 0, clase: b.classList.contains('cierre'), lado: c.marginLeft !== '0px' || b.previousElementSibling !== null }; });
    for (const { abre, panel, cierra, tecla } of paneles) {
      await page.locator(abre).click();
      await expect(page.locator(panel)).toHaveClass(/open/);
      const f = await forma(cierra);
      expect(f).toMatchObject({ picto: true, kbd: tecla, clase: true });
      expect(f.alto).toBeGreaterThanOrEqual(44);
      await page.locator(cierra).click();
      await expect(page.locator(panel)).not.toHaveClass(/open/);
    }
    // Tab da la vuelta adentro, y cierra con su tecla.
    for (const [tecla, sel, cierra] of [['c', '#craft-panel', '.craft-close'], ['t', '#talent-panel', '.talent-close']]) {
      await page.keyboard.press(tecla);
      await expect(page.locator(sel)).toHaveClass(/open/);
      expect(await forma(cierra)).toMatchObject({ picto: true, kbd: tecla.toUpperCase(), clase: true });
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate((s) => document.querySelector(s).contains(document.activeElement), sel), `Tab ${i} en ${sel}`).toBe(true);
      }
      await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
      await page.keyboard.press(tecla);
      await expect(page.locator(sel)).not.toHaveClass(/open/);
    }

    // Una sola cabecera: el título y la plata en la misma línea, y la equis a la derecha, aquí y en el jíbaro y la tienda.
    await page.evaluate(async () => { H.g.stats.dinero = 5000; (await import('/src/ui/placeMenus.js')).openShop(H.g); });
    await expect(page.locator('#menu-dato')).toContainText('$ 5.000');
    await expect(page.locator('#menu-close kbd')).toHaveText('Esc');
    await expect(page.locator('.menu__foot .menu__money')).toHaveCount(0);
    const lados = await page.evaluate(() => { const t = document.getElementById('menu-title').getBoundingClientRect(), d = document.getElementById('menu-dato').getBoundingClientRect(), c = document.getElementById('menu-close').getBoundingClientRect(), r = document.querySelector('.menu__head').getBoundingClientRect(); return { adentro: d.bottom <= r.bottom && d.top >= r.top, derecha: c.left > d.right && c.left > t.right, sinIcono: getComputedStyle(document.getElementById('menu-icon')).display }; });
    expect(lados).toEqual({ adentro: true, derecha: true, sinIcono: 'none' });
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu')).toBeHidden();

    // Las necesidades en el mismo orden en el cartón y en la pausa.
    await page.locator('#needs-toggle').click();
    const enElHud = await page.locator('#hud-vitals .stat-bar').evaluateAll((f) => f.map((e) => e.dataset.stat ?? e.id));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-pause-menu', { detail: { tab: 'estado' } })));
    await expect(page.locator('#menu')).toBeVisible();
    const textoPausa = await page.locator('#menu-body, .menu__body').first().innerText();
    expect(textoPausa.search(/Salud/i)).toBeLessThan(textoPausa.search(/Hambre/i));
    expect(textoPausa.search(/Hambre/i)).toBeLessThan(textoPausa.search(/Sed/i));
    expect(enElHud.length).toBeGreaterThan(2);
  });

  test('con mando: Fabricar y las casillas tienen botón, y ninguna etiqueta nombra una tecla que no está', async ({ page }) => {
    await page.addInitScript(() => {
      const botones = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
      window.__pad = { index: 0, id: 'mando de prueba', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: botones, timestamp: 1 };
      navigator.getGamepads = () => [window.__pad];
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await entrar(page, 'click');
    const boton = (i, v) => page.evaluate(([i, v]) => new Promise((listo) => { window.__pad.buttons[i] = { pressed: v, value: v ? 1 : 0 }; let n = 3; const paso = () => (n-- ? requestAnimationFrame(paso) : listo()); paso(); }), [i, v]);
    const tocarBoton = async (...lista) => { for (const i of lista) await boton(i, true); for (const i of [...lista].reverse()) await boton(i, false); await espera(100); };
    await espera(400);

    await tocarBoton(3); // Y: el costal
    await expect(page.locator('body')).toHaveClass(/\bmando\b/);
    await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
    await expect(page.locator('.inv-close kbd')).toHaveText('B');
    await tocarBoton(1); // B lo cierra
    await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);

    // El dock y el aviso dicen el botón, y lo que no tiene botón no se escribe.
    await expect(page.locator('#panel-dock [data-k="I"]')).toHaveText('Y');
    await expect(page.locator('#panel-dock [data-k="C"]')).toHaveText('LB+Y');
    const sobran = await page.evaluate(() => [...document.querySelectorAll('kbd:not([data-k], .cx kbd, #steal-ayuda kbd)')].filter((k) => k.getBoundingClientRect().width > 0).map((k) => k.textContent));
    expect(sobran).toEqual([]);

    // LB sostenido + Y: la mesa, sin abrir el costal ni cambiar la cámara.
    const camara = await page.evaluate(() => H.g.cameraRig.mode);
    await tocarBoton(4, 3);
    await expect(page.locator('#craft-panel')).toHaveClass(/open/);
    await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => H.g.cameraRig.mode)).toBe(camara);
    await tocarBoton(1);
    await expect(page.locator('#craft-panel')).not.toHaveClass(/open/);

    // LB + arriba usa la casilla 1, sin encender la radio.
    await page.evaluate(async () => { H.calm({ hambre: 30 }); await H.items({ pan: 3 }); H.g.inventory.hotbar = ['pan', null, null, null, null]; H.g.inventoryUI.useHotbar = ((orig) => function (i) { window.__casilla = i; return orig.call(this, i); })(H.g.inventoryUI.useHotbar); });
    await teclas(page);
    await tocarBoton(4, 12);
    await expect.poll(() => page.evaluate(() => window.__casilla)).toBe(0);
    await expect(page.locator('#menu')).toBeHidden();

    // LB solo sigue cambiando la cámara, al soltarlo.
    await boton(4, true);
    expect(await page.evaluate(() => H.g.cameraRig.mode)).toBe(camara);
    await boton(4, false);
    await expect.poll(() => page.evaluate(() => H.g.cameraRig.mode)).not.toBe(camara);

    // La pestaña Controles habla de botones.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-pause-menu', { detail: { tab: 'controles' } })));
    await expect(page.locator('.pause-controls')).toContainText('LB+Y');
    await expect(page.locator('.pause-controls')).not.toContainText('WASD');
    await expect(page.locator('.pause-controls kbd')).toHaveCount(0);
  });
});
