import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, video: 'off' });

test('Ayuda se pulsa separada del dock y se lee encima del aviso de barrio', async ({ page }, info) => {
  // La interfaz real, sin iniciar la carga de la ciudad ni sus modelos.
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  await page.route('http://127.0.0.1:5188/', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.classList.remove('is-loading');
    document.getElementById('loading-screen').hidden = true;
    const { createPanelDock } = await import('/src/ui/PanelDock.js');
    const { startControlsHelp } = await import('/src/ui/ControlsHelp.js');
    createPanelDock({}); startControlsHelp();
    const zone = document.createElement('div');
    zone.id = 'zona-cartel'; zone.className = 'carton corte-c'; zone.textContent = 'La Candelaria';
    document.body.append(zone);
    await document.fonts.ready;
  });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 650 }, { width: 390, height: 650 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Mostrar controles', exact: true }).click({ timeout: 5000 });
    const result = await page.evaluate(() => {
      const help = document.getElementById('controls-help'), content = document.getElementById('controls-help-content');
      const panel = document.getElementById('panel-dock').getBoundingClientRect();
      const toggle = document.getElementById('controls-help-toggle').getBoundingClientRect(), box = content.getBoundingClientRect();
      const zone = document.getElementById('zona-cartel').getBoundingClientRect();
      const x = Math.max(box.left, zone.left) + 5, y = Math.max(box.top, zone.top) + 5;
      const overlap = x < Math.min(box.right, zone.right) && y < Math.min(box.bottom, zone.bottom);
      return { separated: toggle.bottom < panel.top, top: box.top, left: box.left,
        zoneCovered: !overlap || help.contains(document.elementFromPoint(x, y)) };
    });
    expect(result.separated).toBe(true); expect(result.top).toBeGreaterThanOrEqual(0);
    expect(result.left).toBeGreaterThanOrEqual(0); expect(result.zoneCovered).toBe(true);
    await page.screenshot({ path: info.outputPath(`ayuda-${viewport.width}.png`) });
    await page.getByRole('button', { name: 'Ocultar controles', exact: true }).click();
  }
});
