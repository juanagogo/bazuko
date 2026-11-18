import { test, expect } from '@playwright/test';

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, video: 'off', viewport: { width: 1280, height: 800 } });

test('descanso: residencia de pago, mapa diferenciado y sueño gratuito en banca', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Descanso QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await page.evaluate(() => {
    const g = window.__game, r = g.street.residencia;
    if (!r) throw new Error('No existe la residencia en la ciudad');
    g.stats.dinero = 7999; g.stats.energia = 10; g.clock.hour = 12;
    g.player.position.copy(r.position); g.player.root.position.copy(g.player.position);
    g.player.resetGrounding(); g.cameraRig._snap = true;
    window.__restSnapshots = [];
    let benchRecord = null, benchStart = null;
    const animate = g.player.updateSleepPose.bind(g.player);
    g.player.updateSleepPose = dt => {
      animate(dt);
      if (!benchRecord || !g.player.sleepingOnBench) return;
      benchRecord.animationFrames = (benchRecord.animationFrames ?? 0) + 1;
      const group = g.player.character.group;
      const left = group.getObjectByName('mixamorigLeftFoot'), right = group.getObjectByName('mixamorigRightFoot');
      if (!left || !right) {
        benchRecord.missingFeet = true;
        return;
      }
      group.updateWorldMatrix(true, true);
      benchRecord.feet = [left, right].map(b => b.getWorldPosition(benchStart.clone()).y - g.player.position.y);
      benchRecord.seated = !!g.player.benchSeat;
      benchRecord.still = g.player.position.distanceTo(benchStart) < .0001;
      benchRecord.posed = true;
    };
    window.addEventListener('sleep-start', () => {
      const start = g.player.position.clone();
      const banca = g.player.sleepingOnBench;
      const record = { banca, hidden: !g.player.root.visible, cash: g.stats.dinero, posed: false };
      window.__restSnapshots.push(record);
      if (banca) { benchRecord = record; benchStart = start; }
    });
  });
  await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('residencia');
  await page.keyboard.press('e');
  await expect(page.locator('#menu-title')).toHaveText('Residencia El Descanso');
  await expect(page.getByRole('button', { name: /Necesito.*8[.]000/ })).toBeDisabled();
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBe(7999);
  await page.screenshot({ path: info.outputPath('residencia-precio.png') });
  await page.evaluate(() => { window.__game.stats.dinero = 20000; window.__game.menu.refresh(); });
  await page.getByRole('button', { name: /Pagar.*8[.]000.*dormir/ }).click();
  await expect.poll(() => page.evaluate(() => window.__game.isSleeping)).toBe(false);
  const paid = await page.evaluate(() => ({ snapshot: window.__restSnapshots[0], cash: window.__game.stats.dinero,
    visible: window.__game.player.root.visible, saved: JSON.parse(localStorage.getItem('habitante-de-calle-save-v1')) }));
  expect(paid.snapshot.hidden).toBe(true); expect(paid.snapshot.cash).toBe(12000);
  expect(paid.cash).toBeGreaterThanOrEqual(12000); expect(paid.visible).toBe(true);
  expect(paid.saved.stats.dinero).toBe(paid.cash);

  await page.keyboard.press('m');
  await expect(page.locator('.map-view')).toBeVisible();
  const free = page.locator('.map-view__place').filter({ hasText: 'Hogar de paso (gratis)' });
  const hotel = page.locator('.map-view__place').filter({ hasText: 'Residencia El Descanso' });
  await expect(free).toHaveCount(1); await expect(hotel).toHaveCount(1);
  expect(await free.locator('.map-view__place-icon').textContent()).not.toBe(await hotel.locator('.map-view__place-icon').textContent());
  await hotel.click();
  await expect.poll(() => page.evaluate(() => window.__game.gps.waypoint?.name)).toMatch(/Residencia El Descanso/);
  await page.screenshot({ path: info.outputPath('alojamientos-mapa.png') });
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const g = window.__game;
    const bench = g.benches.find(b => !(g.world.active.npcs ?? []).some(n => n.position.distanceTo(b.position) < 2)
      && g.collisions.isPositionFree(b.position, .45));
    if (!bench) throw new Error('No hay una banca libre para la prueba');
    g.stats.energia = 10; g.clock.hour = 12;
    g.player.position.copy(bench.position);
    g.player.root.position.copy(g.player.position); g.player.velocity.set(0, 0, 0); g.player.resetGrounding();
    g.cameraRig.mode = 'third-person'; g.cameraRig.yaw = bench.spot.rot + .5;
    g.cameraRig.distance = 3.8; g.cameraRig.pitch = .12; g.cameraRig._snap = true;
  });
  await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('bench');
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => !!window.__game.player.benchSeat)).toBe(true);
  await page.keyboard.press('q');
  await expect(page.locator('#menu-title')).toHaveText('Descansar en la banca');
  await expect(page.locator('.rest-options')).toContainText('25 %');
  await page.screenshot({ path: info.outputPath('banca-opciones.png') });
  await page.getByRole('button', { name: 'Dormir 3 h gratis', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.isSleeping)).toBe(false);
  const bench = await page.evaluate(() => ({ record: window.__restSnapshots.find(r => r.banca),
    sitting: !!window.__game.player.benchSeat, energy: window.__game.stats.energia,
    saved: JSON.parse(localStorage.getItem('habitante-de-calle-save-v1')) }));
  expect(bench.record.hidden).toBe(false); expect(bench.record.seated).toBe(true); expect(bench.record.still).toBe(true);
  expect(bench.record.posed, JSON.stringify(bench.record)).toBe(true);
  for (const y of bench.record.feet) { expect(y).toBeGreaterThan(.02); expect(y).toBeLessThan(.16); }
  expect(bench.energy).toBeGreaterThan(34); expect(bench.sitting).toBe(true);
  expect(bench.saved.stats.energia).toBeGreaterThan(34);
  await page.screenshot({ path: info.outputPath('banca-despertar.png') });
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => !!window.__game.player.benchSeat)).toBe(false);
  await page.getByRole('button', { name: 'Mostrar controles', exact: true }).click({ timeout: 5000 });
  await expect(page.locator('#controls-help-content')).toBeVisible();
  await page.screenshot({ path: info.outputPath('controles-descanso.png') });
  for (const viewport of [{ width: 800, height: 650 }, { width: 390, height: 650 }]) {
    await page.setViewportSize(viewport);
    const rects = await page.evaluate(() => {
      const rect = id => {
        const b = document.getElementById(id).getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      };
      return { help: rect('controls-help-toggle'), panels: rect('panel-dock'), content: rect('controls-help-content') };
    });
    expect(rects.help.bottom).toBeLessThan(rects.panels.top);
    expect(rects.content.top).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`controles-${viewport.width}.png`) });
  }
  expect(errors).toEqual([]);
});
