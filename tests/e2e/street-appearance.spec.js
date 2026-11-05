import { test, expect } from '@playwright/test';

const wetness = page => page.evaluate(async () => (await import('/src/character/streetMaterials.js')).streetWetness.value);
// Sin partida guardada la sala arranca con un look vacío, y entonces no habría nada que comparar.
const LOOK = { piel: 2, peloColor: 1, desgaste: 1, real: { sexo: 'hombre', edad: 'adulto', pelo: 'corto', barba: 'ninguna', ropa: 'buzo', calzado: 'tenis', cabeza: 'sin-sombrero' } };

test('el material de calle es el de la sala, se moja y conserva el personaje y sus animaciones', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text());
  });
  // ?aspecto=realista se sigue aceptando: fuerza el modelo realista, sin otro material que comparar.
  await page.goto('/sala.html?prueba=personaje&animaciones=mixamo-preview&aspecto=realista');
  await expect(page.locator('#sala-banco-estado')).toContainText('9 clips cargados');
  await expect(page.getByRole('combobox', { name: 'Apariencia del personaje', exact: true })).toHaveCount(0);
  const original = await page.evaluate(async look => {
    await window.__sala.player.setLook(look);
    const { character } = window.__sala.player;
    return { look: character.look, profile: character.animationProfile };
  }, LOOK);
  expect(original.look).toEqual(LOOK);
  expect(original.profile).toBe('mixamo-preview');
  let dressed = null;
  await page.getByRole('button', { name: 'Pausar', exact: true }).click({ timeout: 8000 });
  const wet = page.locator('#sala-mojado');
  for (const [state, name, value] of [['false', 'Seco', 0], ['true', 'Mojado', 1], ['false', 'Seco-otra-vez', 0]]) {
    if (await wet.getAttribute('aria-pressed') !== state) await wet.click({ timeout: 8000 });
    await expect(wet).toHaveAttribute('aria-pressed', state);
    expect(await wetness(page)).toBe(value);
    const result = await page.evaluate(() => {
      const sala = window.__sala;
      sala.renderer.setQuality('alta');
      sala.renderer.instance.setPixelRatio(1);
      sala.animationPreview.play('reposo');
      for (let i = 0; i < 120; i++) sala.animationPreview.update(1 / 60);
      const meshes = [];
      sala.player.character.group.traverse(node => {
        if (node.isSkinnedMesh) meshes.push({ name: node.name, vertices: node.geometry.attributes.position.count, surface: node.material.userData.streetSurface ?? null });
      });
      return { look: sala.player.character.look, profile: sala.player.character.animationProfile, meshes };
    });
    expect(result.look).toEqual(LOOK);
    expect(result.profile).toBe(original.profile);
    expect(result.meshes.length).toBeGreaterThan(4);
    dressed ??= result.meshes;
    expect(result.meshes, 'mojarse no le cambia las piezas').toEqual(dressed);
    expect(result.meshes.map(mesh => mesh.surface)).toContain('skin');
    await page.getByRole('button', { name: 'Ver rostro', exact: true }).click({ timeout: 8000 });
    await page.locator('#sala-panel').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`${name}-rostro.png`) });
    await page.getByRole('button', { name: 'Cuerpo completo', exact: true }).click({ timeout: 8000 });
    await page.screenshot({ path: testInfo.outputPath(`${name}-cuerpo.png`) });
  }
  await expect(page).toHaveURL(/aspecto=realista/);
  await page.setViewportSize({ width: 432, height: 883 });
  await page.getByRole('button', { name: 'Cuerpo completo', exact: true }).click({ timeout: 8000 });
  await expect(page.locator('#sala-panel')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('Final-estrecho.png') });
  await page.getByRole('button', { name: 'Mostrar controles', exact: true }).click({ timeout: 8000 });
  await expect(page.locator('#sala-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Ver rostro', exact: true }).click({ timeout: 8000 });
  await expect(page.locator('#sala-panel')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('Final-rostro-estrecho.png') });
  expect(errors).toEqual([]);
});
