// Quien acuesta el cuerpo es la cadera: con las posturas horneadas, el grupo no gira además.
import { test, expect } from '@playwright/test';

test('noqueado el grupo sigue sin girar y el cuerpo queda en el piso, en los dos modelos', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/sala.html?prueba=personaje');
  await expect.poll(() => page.evaluate(() => !!window.__sala?.player?.character?.animationStatus?.clips?.length), { timeout: 100_000 }).toBe(true);
  const results = await page.evaluate(async () => {
    const { createRealisticCharacter } = await import('/src/character/RealisticCharacter.js');
    const look = { piel: 1, peloColor: 0, desgaste: 1, real: { sexo: 'hombre', edad: 'adulto', pelo: 'corto', barba: 'ninguna', ropa: 'camiseta', calzado: 'botas', tonos: { arriba: '#555555', abajo: '#444444', patron: 'liso', patronColor: '#444444', calzado: '#6a5040' } } };
    const out = [];
    for (const lod of [false, true]) {
      const character = await createRealisticCharacter(look, { lod });
      window.__sala.scene.add(character.group);
      for (let i = 0; i < 20; i++) character.update(1 / 30, { speed: 0, ko: 1, koPlan: 'espalda' });
      let head = null;
      character.group.traverse(node => { if (node.isBone && !head && /Head$/.test(node.name)) head = node; });
      character.group.updateMatrixWorld(true);
      head.updateWorldMatrix(true, false);
      out.push({ lod, x: character.group.rotation.x, head: head.matrixWorld.elements[13] });
      character.dispose();
    }
    return out;
  });
  for (const { lod, x, head } of results) {
    expect(x, `liviano: ${lod}`).toBe(0);
    expect(head, `liviano: ${lod}`).toBeLessThan(.45);
  }
});
