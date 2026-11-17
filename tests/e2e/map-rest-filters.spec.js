import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, video: 'off' });

test('mapa: filtros de descanso, ruta y categorías visibles al desplazar la lista', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Montar el mapa y sus POI reales sin descargar los modelos de la ciudad.
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  await page.route('http://127.0.0.1:5188/', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ Game }, { Menu }, { openPauseMenu }, { Bogota }, { cityMapPlan }, { Vector3 }] = await Promise.all([
      import('/src/core/game.js'), import('/src/ui/Menu.js'), import('/src/ui/PauseMenu.js'),
      import('/src/world/districts/Bogota.js'), import('/src/world/bogota/CityMapRaster.js'), import('/node_modules/.vite/deps/three.js'),
    ]);
    document.body.classList.remove('is-loading'); document.getElementById('loading-screen').hidden = true;
    const district = new Bogota(); district.map = district._layout();
    const position = new Vector3(112.98, 0, 97.84);
    const game = Object.assign(Object.create(Game.prototype), {
      world: { active: district }, mapPlan: cityMapPlan(district), built: { base: true },
      clock: { hour: 22, day: 1, isNight: true }, stats: { dinero: 10000, energia: 100, hambre: 100, sed: 100 },
      inventory: { items: [], totalWeight: 0, maxWeight: 10 }, bicycles: [],
      player: { position, root: { rotation: { y: 0 } } },
      cambuche: { position: new Vector3(112.98, 0, 94.64) },
      street: { hogar: { position: new Vector3(110, 0, 48) }, residencia: { position: new Vector3(130, 0, 64) } },
      menu: new Menu(), _syncGpsBeacon() {}, _cameraYaw() { return 0; },
      gps: {
        route: [], waypoint: null,
        routeLengthTo(from, to) { return Math.hypot(to.x - from.x, to.z - from.z); },
        setWaypoint(target, from) { this.waypoint = target; this.route = [from.clone(), target]; return true; },
        remainingDistance(from) { return this.routeLengthTo(from, this.waypoint); },
        remainingRoute(from) { return this.waypoint ? [from, this.waypoint] : []; },
      },
    });
    window.__mapTest = game; openPauseMenu(game, 'mapa');
    await document.fonts.ready; game.mapView._resize(); game.mapView.draw();
  });
  const filters = page.getByRole('group', { name: 'Filtrar lugares' });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 740 }]) {
    await page.setViewportSize(viewport);
    for (const [label, name] of [['Cambuche', 'Cambuche'], ['Residencias', 'Residencia El Descanso'], ['Refugios', 'Hogar de paso']]) {
      await filters.getByRole('button', { name: label, exact: true }).click();
      const places = page.locator('.map-view__place');
      await expect(places).toHaveCount(1); await expect(places).toContainText(name);
      await expect(filters.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await places.click();
      expect(await page.evaluate(() => window.__mapTest.gps.waypoint.name)).toContain(name);
      await page.screenshot({ path: info.outputPath(`${label.toLowerCase()}-${viewport.width}.png`) });
    }
    await filters.getByRole('button', { name: 'Todo', exact: true }).click();
    await page.locator('.map-view__side').evaluate(node => { node.scrollTop = node.scrollHeight; });
    const sticky = await filters.evaluate(node => {
      const a = node.getBoundingClientRect(), b = node.parentElement.getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom && node.parentElement.scrollTop > 0;
    });
    expect(sticky).toBe(true);
    await filters.getByRole('button', { name: 'Residencias', exact: true }).click();
    await expect(page.locator('.map-view__place')).toContainText('8.000');
  }
  expect(errors).toEqual([]);
});
