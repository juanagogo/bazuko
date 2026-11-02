// La planta oscura se mide en la imagen: la prueba compara cada píxel con el mismo calzado sin oscurecer.
import { test, expect } from '@playwright/test';

const SHOES = ['botas', 'zapatos', 'tenis', 'tenis-rotos'];

/** Cuántos píxeles quedan claramente más oscuros que el mismo píxel sin oscurecer. */
async function darkenedPixels(page, normal, without) {
  return page.evaluate(async ([a, b]) => {
    const pixels = async base64 => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [one, two] = await Promise.all([pixels(a), pixels(b)]);
    const luma = (d, i) => .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2];
    let changed = 0;
    for (let i = 0; i < one.length; i += 4) {
      const clear = luma(two, i);
      if (clear > 10 && luma(one, i) < clear * .7) changed++;
    }
    return changed;
  }, [normal.toString('base64'), without.toString('base64')]);
}

for (const quality of ['media', 'baja']) {
  test(`la planta del calzado sale oscura y el empeine no se toca (${quality})`, async ({ page }) => {
    test.setTimeout(170_000);
    await page.addInitScript(value => { try { localStorage.setItem('bazuko.graphics_quality', value); } catch { /* sin almacenamiento sigue en su calidad */ } }, quality);
    await page.goto('/sala.html?prueba=personaje');
    await expect.poll(() => page.evaluate(() => !!window.__sala?.player?.character?.animationStatus?.clips?.length), { timeout: 120_000 }).toBe(true);
    await page.getByRole('button', { name: 'Pausar', exact: true }).click({ timeout: 8000 });
    await page.addStyleTag({ content: 'body > *:not(canvas):not(#sala-canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
    await page.evaluate(async shoes => {
      const sala = window.__sala, { createRealisticCharacter } = await import('/src/character/RealisticCharacter.js');
      sala.player.root.visible = false;
      sala.hour = 11;
      sala.sceneMgr.setTimeOfDay(11, { cloudCover: .3, rainIntensity: 0, fogDensity: .6, flash: 0, wind: null });
      const people = [];
      let i = 0;
      for (const lod of [false, true]) for (const calzado of shoes) {
        const look = { piel: 1, peloColor: 0, desgaste: 1, real: { sexo: 'hombre', edad: 'adulto', pelo: 'corto', barba: 'ninguna', ropa: 'camiseta', calzado, tonos: { arriba: '#555555', abajo: '#444444', patron: 'liso', patronColor: '#444444', calzado: '#6a5040' } } };
        const character = await createRealisticCharacter(look, { lod });
        character.group.position.set((i++ - 3.5) * 1.2, 0, 0);
        sala.scene.add(character.group);
        for (let k = 0; k < 20; k++) character.update(1 / 30, { speed: 0 });
        people.push(character);
      }
      // Lo que cambia en la variante: el mismo programa con el oscurecido en cero. Si desaparece la cuenta, la prueba no la encuentra y falla.
      const soles = new Set();
      for (const { group } of people) group.traverse(node => { if (node.isMesh && node.material?.userData?.streetSurface === 'shoes') soles.add(node.material); });
      window.__soleTest = {
        people, count: soles.size,
        without(off) {
          for (const material of soles) {
            material.userData.soleOriginal ??= { compile: material.onBeforeCompile, key: material.customProgramCacheKey };
            const { compile, key } = material.userData.soleOriginal;
            material.onBeforeCompile = off ? (shader, renderer) => {
              compile.call(material, shader, renderer);
              const clean = shader.fragmentShader.replace(/float underside = [^;]+;/, 'float underside = 0.;');
              if (clean === shader.fragmentShader) window.__soleTest.missing = true;
              shader.fragmentShader = clean;
            } : compile;
            material.customProgramCacheKey = off ? () => `${key.call(material)}|sin-planta` : key;
            material.needsUpdate = true;
          }
        },
        stand(lifted) { for (const { group } of people) { group.position.y = lifted ? 1.1 : 0; group.rotation.x = lifted ? -1.3 : 0; group.updateMatrixWorld(true); } },
        // Cámara quieta: la de la sala se mece, y dos fotos seguidas no darían los mismos píxeles.
        view(height, distance, target) {
          const camera = sala.cameraRig.camera;
          sala.cameraRig.follow = sala.cameraRig.prepareMovement = () => {};
          camera.position.set(0, height, distance);
          camera.up.set(0, 1, 0);
          camera.lookAt(0, target, 0);
          camera.fov = 35;
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
        }
      };
    }, SHOES);
    expect(await page.evaluate(() => window.__soleTest.count), 'hay calzado que medir').toBeGreaterThan(3);
    const measure = async () => {
      const settle = () => page.waitForTimeout(500);
      await page.evaluate(() => window.__soleTest.without(false));
      await settle();
      const normal = await page.screenshot({ type: 'png' });
      await page.evaluate(() => window.__soleTest.without(true));
      await settle();
      const without = await page.screenshot({ type: 'png' });
      expect(await page.evaluate(() => !!window.__soleTest.missing), 'el oscurecido de la planta sigue existiendo').toBe(false);
      return darkenedPixels(page, normal, without);
    };
    // De pie, visto de cerca desde arriba y a 3 m: nada de lo que se ve se oscurece.
    await page.evaluate(() => { window.__soleTest.stand(false); window.__soleTest.view(2.4, 5, .1); });
    const near = await measure();
    expect(near, 'cerca: parche encima del zapato').toBeLessThan(40);
    await page.evaluate(() => window.__soleTest.view(1.5, 9, .6));
    const far = await measure();
    expect(far, 'a 3 m: parche encima del zapato').toBeLessThan(40);
    // Con el cuerpo tumbado hacia la cámara se ve la planta: ahí sí.
    await page.evaluate(() => { window.__soleTest.stand(true); window.__soleTest.view(.8, 5, .8); });
    const sole = await measure();
    expect(sole, 'la planta sale oscura').toBeGreaterThan(400);
  });
}
