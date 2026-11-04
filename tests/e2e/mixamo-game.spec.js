import { test, expect } from '@playwright/test';

test('el juego permite probar Mixamo con movimiento físico y acciones complementarias', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('bazuko.modelo', 'procedural'));
  await page.goto('/?animaciones=mixamo-preview', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Prueba de animaciones');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  const status = await page.evaluate(() => window.__game.player.character.animationStatus);
  expect(status.profile).toBe('mixamo-game-preview');
  expect(status.clips).toEqual(expect.arrayContaining(['idle', 'walk', 'run', 'buscar', 'pedir', 'beber', 'saludo', 'dormir', 'lanzar', 'comer', 'cagar']));
  expect(await page.evaluate(() => localStorage.getItem('bazuko.modelo'))).toBe('procedural');
  expect(await page.evaluate(() => window.__game.player.modelKind)).toBe('realista');
  const start = await page.evaluate(() => window.__game.player.position.toArray());
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(([x, , z]) => {
    const p = window.__game.player.position;
    return Math.hypot(p.x - x, p.z - z);
  }, start)).toBeGreaterThan(.25);
  await page.keyboard.up('w');
  for (const name of ['comer', 'cagar']) {
    await page.evaluate(name => window.__game.player.playAction(name, 2), name);
    await expect.poll(() => page.evaluate(() => window.__game.player.actionProgress)).toBeGreaterThan(.15);
    expect(await page.evaluate(() => {
      let finite = true;
      window.__game.player.character.group.traverse(node => {
        finite &&= node.matrixWorld.elements.every(Number.isFinite);
      });
      return finite;
    })).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('Mixamo-en-juego.png') });
  expect(errors).toEqual([]);
});
