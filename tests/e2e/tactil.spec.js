import { test, expect } from '@playwright/test';

/** Se entra como se entraría con la mano: `tap` si hay pantalla táctil, y con el ratón si no. */
async function readyGame(page, oprimir = 'click') {
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero');
  await page.locator('#creator-done')[oprimir]();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true })[oprimir]();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  await page.waitForTimeout(200);
}

// Toque de verdad por el protocolo del navegador: cada dedo con su id, varios a la vez.
class Dedos {
  constructor(cdp) { this.cdp = cdp; this.vivos = new Map(); }
  puntos() { return [...this.vivos].map(([id, p]) => ({ id, ...p })); }
  async bajar(id, x, y) { this.vivos.set(id, { x, y }); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.puntos() }); }
  async mover(id, x, y) { this.vivos.set(id, { x, y }); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.puntos() }); }
  async subir(id) { const p = this.vivos.get(id); this.vivos.delete(id); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, ...p }] }); }
  async tocar(x, y) { await this.bajar(9, x, y); await new Promise((r) => setTimeout(r, 40)); await this.subir(9); }
}
const centro = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; };

test.describe('con el dedo', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

  test('los paneles y las cinco casillas quedan al alcance y el cartón deja ver la cabeza al girar', async ({ page }) => {
    await readyGame(page, 'tap');
    await page.evaluate(async () => {
      const game = window.__game;
      const { ITEMS } = await import('/src/data/items.js');
      game.inventory.add(ITEMS.pan, 2);
      game.inventory.bindHotbar(0, 'pan');
      const { player, world, cameraRig: rig } = game;
      const x = 114.184248, z = 238.688629;
      player.position.set(x, world.active.getMovementGroundHeight(x, z, 0), z);
      player.velocity.set(0, 0, 0);
      player.resetGrounding();
      player.root.position.copy(player.position);
      Object.assign(rig, { mode: 'third-person', yaw: 2.55, pitch: .22, distance: 5.5, _snap: true });
    });
    await expect(page.locator('#zona-cartel')).toBeVisible();
    await expect(page.locator('#zona-cartel')).toBeHidden();
    await expect(page.locator('#quickbar .qb-slot')).toHaveCount(5);
    await expect(page.locator('#quickbar')).toBeVisible();

    const measure = () => page.evaluate(() => {
      const controls = '#pause-toggle, #panel-dock button, #quickbar .qb-slot, #acciones > button, #needs-toggle, .radar__abrir';
      return [...document.querySelectorAll(controls)].filter(el => el.checkVisibility({ visibilityProperty: true })).flatMap(el => {
        const { left, right, top, bottom, width, height } = el.getBoundingClientRect();
        const label = el.id || el.dataset.accion || el.className;
        if (width < 44 || height < 44 || left < 0 || right > innerWidth || top < 0 || bottom > innerHeight) return [`${label} fuera de tamaño o del área visible`];
        const y = (top + bottom) / 2;
        return [left + 2, (left + right) / 2, right - 2].some(x => !el.contains(document.elementFromPoint(x, y)))
          ? [`${label} queda tapado por otro elemento`] : [];
      });
    });
    for (const [width, height] of [[360, 780], [375, 812], [390, 844], [412, 915], [844, 390], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(measure, { message: `${width}×${height}` }).toEqual([]);
      const box = await page.locator('#missions-open').boundingBox();
      for (const x of [box.x + box.width / 2, box.x + box.width - 2]) {
        await page.touchscreen.tap(x, box.y + box.height / 2);
        await expect(page.locator('#menu')).toContainText('Misiones del día');
        await expect(page.locator('#menu')).toBeVisible();
        await page.locator('#menu-close').tap();
        await expect(page.locator('#menu')).toBeHidden();
      }
    }

    await page.setViewportSize({ width: 844, height: 390 });
    const overlap = () => page.evaluate(() => {
      const { player, cameraRig: { camera } } = window.__game;
      const head = player.character.ragdollRig?.head ?? player.character.group.getObjectByName('mixamorigHead');
      const point = player.position.clone();
      if (head) head.getWorldPosition(point);
      else point.y += 1.62;
      const right = point.clone().set(1, 0, 0).applyQuaternion(camera.quaternion);
      const screen = [];
      for (const dy of [0, .19]) for (const dx of [-.11, .11]) {
        const world = point.clone().addScaledVector(right, dx);
        world.y += dy;
        const p = world.project(camera);
        screen.push([(p.x + 1) * innerWidth / 2, (1 - p.y) * innerHeight / 2]);
      }
      const dock = document.getElementById('hud-dock').getBoundingClientRect();
      const intersection = (axis, min, max) => {
        const values = screen.map(point => point[axis]);
        return Math.max(0, Math.min(max, Math.max(...values)) - Math.max(min, Math.min(...values)));
      };
      const area = intersection(0, dock.left, dock.right) * intersection(1, dock.top, dock.bottom);
      return { area, headOnscreen: screen.every(([x, y]) => x > 0 && x < innerWidth && y > 0 && y < innerHeight) };
    });
    await expect.poll(overlap).toEqual({ area: 0, headOnscreen: true });
    await page.locator('.radar__abrir').tap();
    await expect(page.locator('.radar__abrir')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.radar__abrir').tap();
    await page.locator('#needs-toggle').tap();
    await expect(page.locator('#needs-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#inventory-open').tap();
    await expect(page.getByRole('dialog', { name: 'Inventario', exact: true })).toBeVisible();
  });

  test('mover y mirar a la vez, sostener, tocar con otro dedo y volver de la pausa', async ({ page, context }) => {
    await readyGame(page, 'tap');
    const dedos = new Dedos(await context.newCDPSession(page));
    await expect(page.locator('body')).toHaveClass(/\btactil\b/);
    await expect(page.locator('.joystick__aro')).toBeVisible();
    await expect(page.locator('#panel-dock kbd').first()).toBeHidden();

    const c = await centro(page, '.joystick__aro');
    await dedos.bajar(1, c.x, c.y);
    await dedos.mover(1, c.x, c.y - c.w / 2);
    await expect.poll(() => page.evaluate(() => window.__game.input.axis.z)).toBeLessThan(-.9);

    const yaw = await page.evaluate(() => window.__game.cameraRig.yaw);
    await dedos.bajar(2, 230, 450);
    for (let i = 1; i <= 6; i++) await dedos.mover(2, 230 - i * 10, 450);
    expect(Math.abs(await page.evaluate(() => window.__game.cameraRig.yaw) - yaw)).toBeGreaterThan(.1);
    expect(await page.evaluate(() => window.__game.input.axis.z)).toBeLessThan(-.9);
    await dedos.subir(2);

    // Con la palanca oprimida, Pausa responde aunque el navegador no le dé clic a un segundo dedo, y no queda nada pegado.
    const p = await centro(page, '#pause-toggle');
    await dedos.tocar(p.x, p.y);
    await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__game.input.axis)).toEqual({ x: 0, z: 0 });
    await dedos.subir(1);
    await page.getByRole('button', { name: 'Continuar jugando', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);

    // Correr: un toque lo deja puesto, otro lo quita.
    await expect(page.locator('[data-accion="correr"]')).toBeVisible();
    const r = await centro(page, '[data-accion="correr"]');
    await dedos.tocar(r.x, r.y);
    await expect.poll(() => page.evaluate(() => window.__game.input.isRunning)).toBe(true);
    await dedos.tocar(r.x, r.y);
    await expect.poll(() => page.evaluate(() => window.__game.input.isRunning)).toBe(false);

    // Tocar el mundo no es un golpe.
    await page.evaluate(() => { const i = window.__game.input, cp = i.consumePress.bind(i); window.__golpes = 0; i.consumePress = (k) => { const v = cp(k); if (v && k === 'Mouse0') window.__golpes++; return v; }; });
    await dedos.tocar(230, 450);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__golpes)).toBe(0);

    // «Más»: abre, todo se puede oprimir, y su clic no cae en lo que abre.
    const m = await centro(page, '[data-accion="mas"]');
    await dedos.tocar(m.x, m.y);
    await expect(page.locator('#tactil-mas')).toBeVisible();
    const cajas = await page.locator('#tactil-mas button').evaluateAll((b) => b.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height, r.right, r.bottom]; }));
    for (const [w, h, right, bottom] of cajas) {
      expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44);
      expect(right).toBeLessThanOrEqual(375); expect(bottom).toBeLessThanOrEqual(812);
    }
    const a = await centro(page, '[data-accion="ayuda"]');
    await dedos.tocar(a.x, a.y);
    await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(true);
    await expect(page.locator('.pause-controls')).toBeVisible();
    await expect(page.locator('.pause-controls')).not.toContainText('Shift');
    await expect(page.locator('.pause-controls kbd')).toHaveCount(0);
    await expect(page.locator('#tactil-mas')).toBeHidden();
  });

  test('junto a la basura la cinta se toca y se sostiene', async ({ page, context }) => {
    await readyGame(page, 'tap');
    const dedos = new Dedos(await context.newCDPSession(page));
    await page.evaluate(() => { const g = window.__game, p = g.pickups[0].position, y = g.player.position.y; g.player.position.set(p.x + 1, y, p.z); g.player.root.position.copy(g.player.position); });
    const q = page.locator('#interaction-prompt .cx[data-tecla="KeyQ"]');
    await expect(q).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#interaction-prompt kbd').first()).toBeHidden();
    const c = await centro(page, '#interaction-prompt .cx[data-tecla="KeyQ"]');
    await dedos.bajar(1, c.x, c.y);
    await expect.poll(() => page.evaluate(() => window.__game.interaction.isHoldingQ)).toBe(true);
    await dedos.subir(1);
    await expect.poll(() => page.evaluate(() => window.__game.interaction.isHoldingQ)).toBe(false);
  });

  test('un toque no deja clic de ratón: ni golpe en la calle ni compra en el panel que abre', async ({ page, context }) => {
    await readyGame(page, 'tap');
    const dedos = new Dedos(await context.newCDPSession(page));
    await page.evaluate(() => {
      const i = window.__game.input, cp = i.consumePress.bind(i);
      window.__golpes = 0; window.__clics = 0;
      i.consumePress = (k) => { const v = cp(k); if (v && k === 'Mouse0') window.__golpes++; return v; };
      document.addEventListener('click', (e) => { if (e.isTrusted) window.__clics++; });
    });
    // El clic de cortesía que sigue a un toque no pega. Es lo único que lo distingue de un clic de ratón de verdad.
    const cortesia = (conToque) => page.evaluate((t) => {
      if (t) for (const tipo of ['pointerdown', 'pointerup']) window.dispatchEvent(new PointerEvent(tipo, { pointerType: 'touch', pointerId: 77 }));
      window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    }, conToque);
    await page.waitForTimeout(900); // lo que quedara del toque que entró al juego
    await cortesia(true);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__golpes)).toBe(0);
    await page.waitForTimeout(900);
    await cortesia(false);
    await expect.poll(() => page.evaluate(() => window.__golpes)).toBe(1);

    // Mañas abre un panel con botones justo debajo del dedo.
    const m = await centro(page, '[data-accion="mas"]');
    await dedos.tocar(m.x, m.y);
    await expect(page.locator('#tactil-mas')).toBeVisible();
    await page.waitForTimeout(250);
    await page.evaluate(() => { window.__clics = 0; });
    const c = await centro(page, '[data-accion="manas"]');
    await dedos.tocar(c.x, c.y);
    await expect.poll(() => page.evaluate(() => window.__game.hud._talentOpen)).toBe(true);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__clics)).toBe(0);
  });

  test('con algo detrás, Correr lo dice además de ponerse rojo', async ({ page }) => {
    await readyGame(page, 'tap');
    const correr = page.locator('[data-accion="correr"]');
    await expect(correr).toHaveText('Correr');
    await page.evaluate(() => { const r = window.__game.roadRage; r.update = () => {}; r.state = 'out'; });
    await expect(correr).toHaveText('Corra');
    await expect(correr).toHaveClass(/tactil-boton--pilas/);
    await page.evaluate(() => { const r = window.__game.roadRage; r.state = 'idle'; delete r.update; });
    await expect(correr).toHaveText('Correr');
  });
});

test('con ratón y teclado no hay nada táctil, y el aviso sigue con su tecla', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await expect(page.locator('body')).not.toHaveClass(/\btactil\b/);
  await expect(page.locator('#joystick')).toBeHidden();
  await expect(page.locator('#acciones')).toBeHidden();
  await expect(page.locator('#panel-dock kbd').first()).toBeVisible();
  // Con ratón no hay ni reloj de revisión.
  expect(await page.evaluate(() => window.__game.tactil._reloj ?? null)).toBeNull();
});
