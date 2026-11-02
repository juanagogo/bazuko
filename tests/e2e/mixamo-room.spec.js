import { test, expect } from '@playwright/test';

test('los nueve clips reales conservan poses finitas y raíz fija en la sala', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/sala.html?prueba=personaje&animaciones=mixamo-preview');
  await expect(page.locator('#sala-banco-estado')).toContainText('9 clips cargados');
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  const poses = [['idle', 'Reposo'], ['walk', 'Caminar'], ['run', 'Correr'], ['buscar', 'Buscar'],
    ['pedir', 'Pedir'], ['beber', 'Beber'], ['saludo', 'Saludo'], ['lanzar', 'Lanzar'], ['dormir', 'Dormir']];
  for (const [clip, label] of poses) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const samples = await page.evaluate(({ clip }) => {
      const sala = window.__sala, character = sala.player.character;
      const duration = character.animationStatus.durations[clip];
      const samples = [];
      for (let i = 0; i < Math.ceil((duration + 1) * 60); i++) {
        sala.animationPreview.update(1 / 60);
        if (i % 10 !== 0) continue;
        character.group.updateMatrixWorld(true);
        let finite = true, floorMin = null;
        character.group.traverse(node => {
          finite &&= node.matrixWorld.elements.every(Number.isFinite);
        });
        // El retarget debe apoyar también manos/ropa al dormir. Medir geometría
        // visible real descubre penetraciones que no aparecen en la raíz física.
        if (i % (Math.max(1, Math.floor(duration * 6 / 5)) * 10) === 0) {
          floorMin = Infinity;
          character.group.traverse(node => {
            if (!node.isSkinnedMesh || !node.visible) return;
            node.skeleton.update();
            const vertex = node.position.clone();
            const indices = node.geometry.index?.array;
            const used = indices ? new Set(indices) : Array.from({ length: node.geometry.attributes.position.count }, (_, index) => index);
            for (const index of used) {
              node.getVertexPosition(index, vertex).applyMatrix4(node.matrixWorld);
              floorMin = Math.min(floorMin, vertex.y);
            }
          });
        }
        samples.push({ finite, floorMin, position: sala.player.position.toArray() });
      }
      // Captura del centro del gesto, ya mezclado, para revisión visual.
      sala.animationPreview.play(sala.animationPreview.name);
      for (let i = 0; i < Math.ceil(Math.max(.35, duration * .5) * 60); i++) sala.animationPreview.update(1 / 60);
      return samples;
    }, { clip });
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(sample => sample.finite && sample.position.every(value => value === 0)), clip).toBe(true);
    expect(Math.min(...samples.filter(sample => sample.floorMin !== null).map(sample => sample.floorMin)), `${clip}: apoyo sobre suelo`).toBeGreaterThanOrEqual(-.015);
    await page.locator('#sala-panel').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`Mixamo-${label}.png`) });
  }
  expect(errors).toEqual([]);
});

test('la sala carga el banco Mixamo real, permite inspeccionarlo y conserva aislada la selección', async ({ page }, testInfo) => {
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.addInitScript(() => {
    // La sala puede recordar otro modelo; el banco Mixamo debe arrancar con rig.
    if (!sessionStorage.getItem('mixamo-e2e-initialized')) {
      localStorage.setItem('bazuko.modelo', 'procedural');
      localStorage.setItem('bazuko.sala.modelo', 'procedural');
      sessionStorage.setItem('mixamo-e2e-initialized', '1');
    }
  });
  await page.goto('/sala.html?prueba=personaje&animaciones=mixamo-preview');
  await expect(page.locator('#sala-banco-estado')).toHaveAttribute('data-profile', 'mixamo-preview');
  await expect(page.locator('#sala-banco-estado')).toContainText('Mixamo + Blender');
  await expect(page.locator('#sala-clips')).toContainText('Reposo');
  await expect(page.locator('#sala-clips')).toContainText('Caminar');
  await expect(page.locator('#sala-clips')).toContainText('Correr');
  expect(requests).toContain('/models/preview/animaciones-mixamo.glb');
  expect(requests).not.toContain('/src/core/game.js');
  expect(requests).not.toContain('/models/animaciones-actionforge.glb');
  expect(await page.evaluate(() => localStorage.getItem('bazuko.modelo'))).toBe('procedural');

  const status = await page.evaluate(() => window.__sala.player.character.animationStatus);
  expect(status.source).toBe('/models/preview/animaciones-mixamo.glb');
  expect(status.clips).toEqual(expect.arrayContaining(['idle', 'walk', 'run']));
  for (const [clip, label] of [['buscar', 'Buscar'], ['pedir', 'Pedir'], ['comer', 'Comer'], ['beber', 'Beber'], ['saludo', 'Saludo'], ['cagar', 'Agacharse'], ['lanzar', 'Lanzar'], ['dormir', 'Dormir']]) {
    const control = page.getByRole('button', { name: label, exact: true });
    if (status.clips.includes(clip)) await expect(control).toBeEnabled();
    else await expect(control).toBeDisabled();
  }
  await page.getByRole('button', { name: 'Caminar', exact: true }).click();
  await expect(page.locator('#sala-pose-fuente')).toHaveText('Clip Mixamo · Caminar');
  await expect.poll(() => page.evaluate(() => window.__sala.animationPreview.time)).toBeGreaterThan(.4);
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  const sample = () => page.evaluate(() => {
    const sala = window.__sala;
    const bones = [];
    sala.player.character.group.traverse(node => {
      if (node.isBone) bones.push(...node.position.toArray(), ...node.quaternion.toArray());
    });
    return { time: sala.animationPreview.time, bones, position: sala.player.position.toArray() };
  });
  const before = await sample();
  await page.waitForTimeout(100);
  expect(await sample()).toEqual(before);
  for (let i = 0; i < 8; i++) {
    await page.getByRole('button', { name: 'Un fotograma', exact: true }).click();
    await expect.poll(async () => (await sample()).time).toBeCloseTo(before.time + (i + 1) / 60, 7);
  }
  const after = await sample();
  expect(after.bones.every(Number.isFinite)).toBe(true);
  expect(after.bones.some((value, i) => Math.abs(value - before.bones[i]) > .001)).toBe(true);
  expect(after.position).toEqual([0, 0, 0]);
  await page.screenshot({ path: testInfo.outputPath('Mixamo-Caminar.png') });

  await page.getByRole('button', { name: 'Nadar', exact: true }).click();
  await expect(page.locator('#sala-pose-fuente')).toHaveText('Pose procedural actual · Nadar');
  requests.length = 0;
  await page.getByRole('combobox', { name: 'Banco de animaciones', exact: true }).selectOption('default');
  await expect(page).toHaveURL(/sala\.html\?prueba=personaje$/);
  await expect(page.getByRole('button', { name: 'Movimiento libre', exact: true })).toBeVisible();
  await expect(page.locator('#sala-banco-estado')).toHaveAttribute('data-profile', 'default');
  expect(requests).not.toContain('/models/preview/animaciones-mixamo.glb');
  expect(requests).toContain('/models/animaciones-actionforge.glb');
  expect(await page.evaluate(() => localStorage.getItem('bazuko.modelo'))).toBe('procedural');
  expect(errors).toEqual([]);
});

test('un banco Mixamo ausente muestra error y no se presenta como otra animación', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/models/preview/animaciones-mixamo.glb', route => route.fulfill({ status: 404, body: 'No disponible' }));
  await page.goto('/sala.html?prueba=personaje&animaciones=mixamo-preview');
  await expect(page.getByRole('alert')).toContainText('No se pudo cargar el banco Mixamo + Blender');
  await expect(page.locator('#sala-banco-estado')).toHaveAttribute('data-profile', 'error');
  await expect(page.getByRole('button', { name: 'Caminar', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__sala.player.character.group.visible)).toBe(false);
  await expect(page.getByRole('combobox', { name: 'Banco de animaciones', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
