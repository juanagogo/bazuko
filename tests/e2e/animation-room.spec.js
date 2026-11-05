import { test, expect } from '@playwright/test';

test('el visor recorre ambos modelos, congela poses y conserva el salto físico', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/sala.html?prueba=personaje');
  await expect(page.getByRole('button', { name: 'Movimiento libre', exact: true })).toBeVisible();
  for (const model of ['Realista', 'Liviano']) {
    await page.getByRole('button', { name: model, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__sala.player.modelKind)).toBe(model === 'Realista' ? 'realista' : 'procedural');
    for (const action of ['Caminar', 'Correr', 'Buscar', 'Pedir', 'Comer', 'Beber', 'Saludo', 'Agacharse', 'Lanzar', 'Dormir', 'Nadar', 'Flotar', 'Reposo']) {
      await page.getByRole('button', { name: action, exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__sala.animationPreview.time)).toBeGreaterThan(.5);
      const finite = await page.evaluate(() => {
        let valid = true;
        window.__sala.player.character.group.traverse(o => {
          valid &&= [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()].every(Number.isFinite);
        });
        return valid;
      });
      expect(finite, `${model}: ${action}`).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${model}-${action}.png`) });
    }
  }
  await page.getByRole('button', { name: 'Correr', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  const paused = await page.evaluate(() => window.__sala.animationPreview.time);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__sala.animationPreview.time)).toBe(paused);
  await page.getByRole('button', { name: 'Un fotograma', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__sala.animationPreview.time)).toBeCloseTo(paused + 1 / 60, 8);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Saltar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__sala.player.position.y)).toBeGreaterThan(.15);
  await expect.poll(() => page.evaluate(() => window.__sala.player.isGrounded)).toBe(true);
  expect(errors).toEqual([]);
});
