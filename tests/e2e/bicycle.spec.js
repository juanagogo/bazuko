import { test, expect } from '@playwright/test';

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, video: 'off', viewport: { width: 1280, height: 800 } });

test('bicicleta: alquiler, origen en mapa, impulso, salto, apoyos, reversa y misión diaria', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Ciclista QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#creator-modal')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  // Preparar una aproximación al rack, conservando el bucle y la interacción reales.
  await page.evaluate(() => {
    const g = window.__game, s = g.bikeStations[0];
    g.stats.dinero = 5000;
    window.__rentalOriginId = s.id;
    g.player.position.copy(s.position); g.player.position.z += 1.6;
    g.player.root.position.copy(g.player.position); g.player.resetGrounding();
    g.cameraRig._snap = true;
  });
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => !!window.__game.player.bicycle)).toBe(true);
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(4000);
  await page.evaluate(() => { window.__rentalReturnPoint = window.__game.player.position.toArray(); });
  await page.keyboard.press('m');
  await expect(page.locator('.map-view')).toBeVisible();
  await expect(page.locator('.map-view')).toContainText('Origen del alquiler');
  await page.screenshot({ path: info.outputPath('bicicleta-origen-alquiler.png') });
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
  // Preparar el corredor de ensayo sin modificar los sistemas de movimiento.
  await page.evaluate(() => {
    const g = window.__game;
    const bike = g.player.bicycle;
    g.clock.hour = 12;
    bike.group.rotation.y = 0; g.player.root.rotation.y = 0;
    // Buscar una calle realmente abierta en el mapa actual (no una coordenada de edificio).
    const d = g.world.active;
    let lane = null;
    for (let x = 20; x < 150 && !lane; x += 2) {
      for (let z = 20; z < 160; z += 2) {
        if (!Array.from({ length: 12 }, (_, i) => z + i).every(pz => d.tileTypeAt(Math.round(x / 2), Math.round(pz / 2)) === 'road')) continue;
        const y = d.getMovementGroundHeight?.(x, z, 0) ?? 0;
        if (!Array.from({ length: 12 }, (_, i) => z + i).every(pz => {
          const p = g.player.position.clone().set(x, y, pz);
          return g.collisions.isPositionFree(p, 1, bike);
        })) continue;
        lane = { x, y, z }; break;
      }
    }
    if (!lane) throw new Error('No hay un corredor de calle libre para la prueba');
    window.__bikeStartZ = lane.z;
    g.player.position.set(lane.x, lane.y, lane.z); g.player.resetGrounding();
    bike.position.copy(g.player.position); bike.group.position.copy(bike.position);
    g.cameraRig.mode = 'third-person'; g.cameraRig.yaw = Math.PI + .5; g.cameraRig.pitch = .24;
    g.cameraRig.distance = 4; g.cameraRig._snap = true;
  });
  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle?.speed ?? 0)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => window.__game.player.position.z - window.__bikeStartZ)).toBeGreaterThan(1);
  await page.screenshot({ path: info.outputPath('bicicleta-conduciendo.png') });
  await page.keyboard.down('d');
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle.group.rotation.y)).toBeLessThan(-.08);
  await page.keyboard.up('d');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__game.player.isGrounded), { intervals: [20, 30, 30] }).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__game.player.isGrounded)).toBe(true);
  await page.keyboard.up('w'); await page.keyboard.up('Shift'); await page.keyboard.down('s');
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle?.speed)).toBeLessThan(-.5);
  await page.keyboard.up('s');
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle?.lookBack)).toBeGreaterThan(.9);
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle?.reverseFoot)).toBeGreaterThan(.95);
  const backwardsZ = await page.evaluate(() => window.__game.player.position.z);
  await expect.poll(() => page.evaluate(() => window.__game.player.position.z)).toBeLessThan(backwardsZ - .1);
  await page.evaluate(() => {
    const g = window.__game;
    g.clock.hour = 12;
    g.cameraRig.yaw = g.player.root.rotation.y + Math.PI / 2;
    g.cameraRig.distance = 4.2; g.cameraRig.pitch = .12; g.cameraRig._snap = true;
  });
  await page.keyboard.press('F2');
  await expect(page.locator('#photo-mode')).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.locator('.photo-mode__panel')).toBeHidden();
  await page.screenshot({ path: info.outputPath('bicicleta-reversa.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle?.speed), { intervals: [20, 50, 100] }).toBeGreaterThanOrEqual(0);
  await page.keyboard.up('w');
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle?.speed)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle?.lookBack)).toBeLessThan(.05);
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle?.supportFoot)).toBeGreaterThan(.95);
  await page.keyboard.press('F2');
  await expect(page.locator('#photo-mode')).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.locator('.photo-mode__panel')).toBeHidden();
  await page.screenshot({ path: info.outputPath('bicicleta-detenida.png') });
  await page.keyboard.press('Escape');
  const stoppedZ = await page.evaluate(() => window.__game.player.position.z);
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.__game.player.bicycle?.supportFoot)).toBeLessThan(.05);
  await expect.poll(() => page.evaluate(() => window.__game.player.position.z)).toBeGreaterThan(stoppedZ + .2);
  await page.keyboard.up('w');
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => !!window.__game.player.bicycle)).toBe(false);
  const parkedSave = await page.evaluate(() => JSON.parse(localStorage.getItem('habitante-de-calle-save-v1')));
  expect(parkedSave.player.bicycleId).toBeNull();
  expect(parkedSave.bicycles.some(b => b.status === 'parked' && b.rental?.paid)).toBe(true);
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => !!window.__game.player.bicycle)).toBe(true);
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(4000);
  await page.evaluate(() => {
    const g = window.__game, b = g.player.bicycle;
    g.player.position.fromArray(window.__rentalReturnPoint); g.player.root.position.copy(g.player.position);
    b.position.copy(g.player.position); b.group.position.copy(b.position); b.speed = 0;
    g.player.velocity.set(0, 0, 0); g.player.resetGrounding();
  });
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => !!window.__game.player.bicycle)).toBe(false);
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(7000);
  expect(await page.evaluate(() => window.__game._getPOIs().some(p => p.rentalOrigin === window.__rentalOriginId))).toBe(false);
  const mission = await page.evaluate(() => window.__game.dailyMissions.missions.find(m => m.type === 'bicicleta'));
  expect(mission.completed).toBe(true); expect(mission.claimed).toBe(true);
  const returnedSave = await page.evaluate(() => JSON.parse(localStorage.getItem('habitante-de-calle-save-v1')));
  expect(returnedSave.stats.dinero).toBe(7000);
  expect(returnedSave.dailyMissions.missions.find(m => m.type === 'bicicleta').claimed).toBe(true);
  await page.keyboard.press('j');
  await expect(page.locator('.missions-modal-body')).toContainText('Bici de ida y vuelta');
  await expect(page.locator('.missions-card').filter({ hasText: 'Bici de ida y vuelta' })).toContainText('Completada');
  await page.screenshot({ path: info.outputPath('bicicleta-mision-diaria.png') });
  expect(errors).toEqual([]);
});
