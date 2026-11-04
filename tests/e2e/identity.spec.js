import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`identidad urbana: controles separados y paneles accesibles a ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
    await page.locator('#cr-name').fill('Parcero de Bogotá');
    await page.locator('#creator-done').click();
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
    await page.evaluate(async () => {
      const game = window.__game;
      const { ITEMS } = await import('/src/data/items.js');
      game.stats.dinero = 1234567;
      game.inventory.add(ITEMS.pan, 2);
      game.inventory.bindHotbar(0, 'pan');
    });
    await expect(page.locator('#money')).toContainText('1.234.567');
    await expect(page.locator('#quickbar')).toBeVisible();

    const bounds = await page.evaluate(() => ['topbar', 'panel-dock', 'hud-dock', 'game-settings', 'quickbar', 'camera-controls']
      .map(id => { const el = document.getElementById(id); const b = el.getBoundingClientRect();
        return { id, left:b.left, right:b.right, top:b.top, bottom:b.bottom, overflow:el.scrollWidth-el.clientWidth }; }));
    for (const box of bounds) {
      expect(box.left, box.id).toBeGreaterThanOrEqual(0);
      expect(box.right, box.id).toBeLessThanOrEqual(viewport.width);
      expect(box.bottom, box.id).toBeLessThanOrEqual(viewport.height);
      expect(box.overflow, box.id).toBeLessThanOrEqual(1);
    }
    for (let i=0;i<bounds.length;i++) for(let j=i+1;j<bounds.length;j++) {
      const a=bounds[i], b=bounds[j];
      const overlap=Math.min(a.right,b.right)>Math.max(a.left,b.left) && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);
      expect(overlap, `${a.id} no debe tapar ${b.id}`).toBe(false);
    }
    await page.locator('#inventory-open').click();
    await expect(page.getByRole('dialog', { name: 'Inventario', exact: true })).toBeVisible();
    await expect(page.locator('#controls-help-toggle')).toBeHidden();
    await page.keyboard.press('Escape');
    await page.locator('#craft-open').click();
    await expect(page.locator('#craft-panel')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#craft-panel')).not.toHaveClass(/open/);
    await page.keyboard.press('Escape');
    for (const name of ['Mapa','Estado','Ajustes','Controles']) {
      await page.getByRole('tab', { name, exact:true }).click();
      await expect(page.getByRole('tab', { name, exact:true })).toHaveAttribute('aria-selected','true');
      const overflow=await page.locator('#menu-body').evaluate(el=>el.scrollWidth-el.clientWidth);
      expect(overflow, name).toBeLessThanOrEqual(1);
    }
  });
}
