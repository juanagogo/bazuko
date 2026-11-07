// tests/e2e/zorra.spec.js
// Ganarle la zorra a un reciclador a punta de E en un andén despejado: las E de más no le meten la mano,
// empujando no hay robo (ni E ni Q), la tecla de contexto dice que se suelta con U y U la suelta.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()); });

async function start(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
}

// El reciclador, quieto en el claro del parque del robo.spec (sin basura al lado), y el jugador a un metro, de frente.
// `__colocar(dx)` lo repite corrido `dx` metros: tras el forcejeo el reciclador echa a andar y hay que volver a ponerlo.
const ponerJunto = () => {
  const g = window.__game;
  g.clock.hour = 12;
  g.stats.energia = 100;
  const r = window.__rec = g.zorraCtl.recicladores.find(r => r.estado.tieneZorra && r.zorra && !r._disposed);
  window.__colocar = (dx = 0) => {
    const p = g.player, x = 112.98 + dx, z = 97.84;
    r.estado.fase = 'parada'; r.estado.faseRestante = 999; r._limpiarRuta(); r.moving = false; r._robadoTimer = 0;
    r.position.set(x, g.world.active.getGroundHeight(x, z), z); r.root.position.copy(r.position); r.root.rotation.y = 0;
    for (const o of g.world.active.npcs) if (o !== r && o.position.distanceTo(r.position) < 5) o._robadoTimer = 120;
    // El Chato ronda su cambuche, al lado: con las manos ocupadas la E sería suya (acariciarlo), y es justo.
    const d = g.dog;
    if (d) {
      d.home.set(x - 25, g.world.active.getGroundHeight(x - 25, z), z);
      d.position.copy(d.home); d.group.position.copy(d.home); d._wanderTarget = null;
    }
    p.position.set(x, r.position.y, z + 1); p.root.position.copy(p.position); p.root.rotation.set(0, Math.PI, 0);
    p.velocity?.set?.(0, 0, 0); p.resetGrounding?.();
    g.steal.cooldown = 0;
    g.steal._avisoManos = 0;
    window.__avisos = [];
  };
  window.__colocar();
  window.addEventListener('toast', e => window.__avisos.push(e.detail.text));
  return (g.pickups ?? []).filter(b => !b.used && b.position.distanceTo(g.player.position) < 3).length;
};

const estado = page => page.evaluate(() => {
  const g = window.__game;
  return {
    zorra: g.zorra.estado, forcejeo: !!g.zorraCtl.forcejeo, cosquilleo: g.steal.minigameActive,
    tiron: !!g.steal.raponazo, mano: g.steal.coreo?.fase ?? null,
    aviso: document.getElementById('interaction-prompt')?.textContent ?? ''
  };
});

test('le gano la zorra machacando E: la E de más no le roba, empujando no hay robo y U la suelta', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  expect(await page.evaluate(ponerJunto), 'sin basura al lado').toBe(0);
  await expect.poll(() => estado(page).then(s => s.aviso), { timeout: 10_000 }).toContain('Forcejear');

  // Machaca como un jugador: sigue unas E más después de ganar.
  let gano = -1;
  for (let i = 0; i < 80 && (gano < 0 || i - gano < 6); i++) {
    await page.keyboard.press('e');
    await page.waitForTimeout(90);
    if (gano < 0 && (await estado(page)).zorra === 'pushing') gano = i;
  }
  expect(gano, 'ganó el forcejeo').toBeGreaterThanOrEqual(0);
  let s = await estado(page);
  expect(s).toMatchObject({ zorra: 'pushing', forcejeo: false, cosquilleo: false, tiron: false, mano: null });
  expect(s.aviso).toContain('Soltar la zorra');
  expect(s.aviso).not.toContain('Cosquilleo');

  // Otra vez junto al reciclador, una E y una Q a propósito tampoco roban: cada una dice con qué se suelta.
  for (const tecla of ['e', 'q']) {
    await page.evaluate(() => window.__colocar());
    await page.waitForTimeout(300);
    await page.keyboard.press(tecla);
    await page.waitForTimeout(300);
    s = await estado(page);
    expect(s, `con ${tecla}`).toMatchObject({ zorra: 'pushing', cosquilleo: false, tiron: false, mano: null });
    expect(await page.evaluate(() => window.__avisos), `con ${tecla}`).toContain('Primero suelto la zorra con U');
  }

  // U la suelta; ya con las manos libres, el cosquilleo vuelve.
  await page.keyboard.press('u');
  await expect.poll(() => estado(page).then(s => s.zorra), { timeout: 5_000 }).toBe('dropped');
  // Lejos de la zorra soltada, que si no es ella la que tiene la E.
  await page.evaluate(() => window.__colocar(4));
  await expect.poll(() => estado(page).then(s => s.aviso), { timeout: 5_000 }).toContain('Cosquilleo');
  await page.keyboard.press('e');
  await expect.poll(() => estado(page).then(s => s.cosquilleo), { timeout: 5_000 }).toBe(true);
  await page.keyboard.press('Escape');
});
