import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// El contexto de Playwright es temporal: estas pruebas nunca usan partidas personales.
test.use({
  video: 'off',
  viewport: { width: 1440, height: 980 },
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: [],
    chromiumSandbox: true
  }
});
test('Bolirana: mapa, práctica, abandono, victoria y saldo persistente', async ({
  page
}) => {
  test.setTimeout(240_000);
  const errors = [],
    external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) => {
    if (r.request().url().startsWith('http://127.0.0.1:5188/'))
      return r.continue();
    external.push(r.request().url());
    return r.abort();
  });
  async function capture(name) {
    if (!process.env.BOLIRANA_SHOTS) return;
    await mkdir(process.env.BOLIRANA_SHOTS, { recursive: true });
    await page.screenshot({ path: `${process.env.BOLIRANA_SHOTS}/${name}` });
  }
  await page.goto('http://127.0.0.1:5188/');
  await page
    .locator('#creator-modal')
    .waitFor({ state: 'visible', timeout: 120000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await page
    .locator('#loading-screen')
    .waitFor({ state: 'hidden', timeout: 120000 });
  await page
    .getByRole('button', { name: 'Continuar jugando', exact: true })
    .click();
  console.log('Partida cargada');
  await page.keyboard.press('m');
  await page.getByRole('button', { name: /El Rumbiadero/ }).click();
  assert.equal(
    await page.evaluate(() => window.__game.gps.waypoint.name),
    'El Rumbiadero · Bolirana'
  );
  assert.ok(await page.evaluate(() => window.__game.gps.route.length > 1));
  await capture('map-marker.png');
  await page.keyboard.press('Escape');

  const venue = await page.evaluate(() => {
    const g = window.__game,
      p = g.boliranaVenue.position;
    return {
      pos: p.toArray(),
      walk: g.world.active.isWalkableAt(p.x, p.z),
      distance: Math.hypot(p.x - 112.98, p.z - 94.64)
    };
  });
  assert.equal(venue.walk, true);
  assert.ok(venue.distance < 26);
  // Posición y saldo de prueba en un contexto temporal.
  await page.evaluate(() => {
    const g = window.__game;
    g.stats.dinero = 10000;
    g.player.position.copy(g.boliranaVenue.position);
    g.player.velocity?.set?.(0, 0, 0);
    g.cameraRig.yaw = Math.PI / 2;
    g.cameraRig.follow(g.player.position, 0, g.collisions);
  });
  await page.waitForTimeout(250);
  await page.keyboard.press('e');
  await page.locator('#bolirana-venue').waitFor({ state: 'visible' });
  let frame = page.frameLocator('#bolirana-venue iframe');
  await frame.locator('#enter-practice').waitFor({ state: 'visible' });
  const pos = await page.evaluate(() =>
    window.__game.player.position.toArray()
  );
  assert.equal(await page.evaluate(() => window.__game.paused), true);
  await capture('integrated-entry.png');
  await frame.locator('#enter-practice').click();
  const beforeWidth = (await frame.locator('#game').boundingBox()).width;
  await frame.locator('#toggle-instructions').click();
  assert.equal(await frame.locator('#instructions-panel').isVisible(), false);
  await page.waitForTimeout(150);
  assert.ok((await frame.locator('#game').boundingBox()).width > beforeWidth);
  await capture('help-hidden.png');
  await frame.locator('#toggle-instructions').click();
  assert.equal(await frame.locator('#instructions-panel').isVisible(), true);
  await frame.locator('#street-exit').click();
  await page.locator('#bolirana-venue').waitFor({ state: 'detached' });
  assert.deepEqual(
    await page.evaluate(() => window.__game.player.position.toArray()),
    pos
  );
  assert.equal(await page.evaluate(() => window.__game.stats.dinero), 10000);
  assert.equal(page.url(), 'http://127.0.0.1:5188/');
  await page.keyboard.press('e');
  await page.locator('#bolirana-venue').waitFor({ state: 'visible' });
  frame = page.frameLocator('#bolirana-venue iframe');
  await frame.locator('#enter-betting').click();
  await frame.locator('#stake').fill('2000');
  await frame.locator('#start').click();
  await page.waitForFunction(() => window.__game.stats.dinero === 8000);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('habitante-de-calle-save-v1'))
  );
  assert.equal(saved.stats.dinero, 8000);
  assert.equal(saved.bolirana.pending, true);
  await frame.locator('#abandon').click();
  await frame.locator('#result').waitFor({ state: 'visible' });
  assert.equal(
    await frame.locator('#result-money-label').innerText(),
    'PERDISTE'
  );
  assert.match(
    await frame.locator('#result-money-amount').innerText(),
    /−\$ 2\.000/
  );
  await capture('loss-amount.png');
  await frame.locator('#result-street').click();
  await page.locator('#bolirana-venue').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__game.stats.dinero), 8000);
  assert.equal(
    await page.evaluate(() => window.__game.bolirana.pending),
    false
  );
  await page.keyboard.press('e');
  await page.locator('#bolirana-venue').waitFor({ state: 'visible' });
  frame = page.frameLocator('#bolirana-venue iframe');
  await frame.locator('#enter-betting').click();
  await frame.locator('#stake').fill('100');
  await frame.locator('#start').click();
  await page.waitForFunction(() => window.__game.stats.dinero === 7900);
  // Partida completa mediante ratón; la rana es el objetivo reproducible.
  const child = page.frames().find((f) => f.url().includes('/bolirana/index'));
  await child.evaluate(() => {
    Math.random = () => 0.5;
  });
  async function shot() {
    await child.waitForFunction(
      () => window.bolirana && !window.bolirana.snapshot().inFlight
    );
    await page.waitForTimeout(650);
    const t = await child.evaluate(() => {
      const s = window.bolirana.snapshot();
      return window.bolirana.project(s.frog.x, s.frog.y, s.frog.z);
    });
    const rect = await page.locator('#bolirana-venue iframe').boundingBox();
    await page.mouse.move(t.x + rect.x, t.y + rect.y);
    await page.mouse.down();
    await child.waitForFunction(() => {
      const s = window.bolirana.snapshot();
      return s.charging && s.power >= 0.61 && s.power < 0.635;
    });
    await page.mouse.up();
    await child.waitForFunction(
      () => !window.bolirana.snapshot().inFlight,
      null,
      { timeout: 9000 }
    );
  }
  for (let i = 0; i < 3; i++) {
    await shot();
    console.log(`Tiro ${i + 1} completado`);
  }
  await frame.locator('#result').waitFor({ state: 'visible', timeout: 50000 });
  assert.match(
    await frame.locator('#result-score').innerText(),
    /^Parcero QA \d+ — Don Leo \d+$/
  );
  const state = await child.evaluate(() => window.bolirana.snapshot());
  const actual = await page.evaluate(() => window.__game.stats.dinero);
  assert.equal(
    actual,
    state.match.player > state.match.npc
      ? 8100
      : state.match.player === state.match.npc
        ? 8000
        : 7900
  );
  assert.equal(
    await frame.locator('#result-money-label').innerText(),
    'GANASTE'
  );
  assert.match(
    await frame.locator('#result-money-amount').innerText(),
    /\+\$ 100/
  );
  assert.ok(
    await frame
      .locator('#result-money-amount')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 48)
  );
  assert.equal(state.match.player, 60);
  assert.equal(actual, 8100);
  assert.match(await page.locator('#money').innerText(), /8[.,]100/);
  const savedWin = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('habitante-de-calle-save-v1'))
  );
  assert.equal(savedWin.stats.dinero, 8100);
  assert.equal(savedWin.bolirana.lastResult.outcome, 'win');
  await capture('integrated-result.png');
  await frame.locator('#result-street').click();
  await page.locator('#bolirana-venue').waitFor({ state: 'detached' });
  await page.waitForTimeout(800);
  await capture('street-return.png');
  assert.equal(await page.evaluate(() => window.__game.input.locked), false);
  await page.reload();
  await page
    .locator('#loading-screen')
    .waitFor({ state: 'hidden', timeout: 120000 });
  await page.waitForFunction(() => window.__game && !window.__game._loading);
  assert.equal(await page.evaluate(() => window.__game.stats.dinero), 8100);

  console.log('Mapa, práctica, abandono, victoria y persistencia comprobados');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
