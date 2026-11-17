// tests/e2e/testigos.spec.js
// Un cosquilleo que sale mal delante de la gente: el más cercano que lo vio saca el celular y llama, sale el aviso,
// y la llamada termina sola, sube el fichaje y el testigo vuelve a caminar.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()); });

test('un cosquilleo pillado delante de alguien: saca el celular, llama y al terminar vuelve a caminar', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);

  const r = await page.evaluate(() => {
    const g = window.__game, d = g.world.active, x = 112.98, z = 97.84;
    g.clock.hour = 12;
    g.traffic.alertForTheft = () => false; // que ninguna patrulla lo vea: aquí solo cuenta la llamada
    // El Chato anda por este claro: lejos.
    if (g.dog) { g.dog.home?.set?.(x + 25, 0, z + 25); g.dog.position.set(x + 25, 0, z + 25); g.dog._wanderTarget = null; }
    const libres = d.npcs.filter((n) => n.person && !n.isVendor && !n.fijo && !n.koState && !n._disposed
      && !['sentado', 'acurrucado', 'banca', 'pedir', 'dormido'].includes(n.stance));
    const [v, t] = libres;
    const poner = (n, px, pz) => { n.position.set(px, d.getGroundHeight(px, pz), pz); n.root.position.copy(n.position); n.target = null; n.route = []; n.fleeTimer = 0; };
    poner(v, x, z);
    poner(t, x + 3, z + 2);
    const p = g.player;
    p.position.set(x, d.getGroundHeight(x, z - .9), z - .9); p.root.position.copy(p.position);
    const antes = g.steal.buscado;
    g.witnesses.random = () => 0;
    g.witnesses._cooldown = 0;
    // El cosquilleo de verdad, con la barra fallada y la víctima que se da cuenta.
    const azar = Math.random;
    Math.random = () => 0;
    try { g.steal.targetNpc = v; g.steal._endMinigame(false, 'play'); } finally { Math.random = azar; }
    const testigo = g.witnesses.calls[0]?.npc ?? null;
    window.__testigo = testigo;
    return { antes, llama: testigo?.witnessing ?? null, esLaVictima: testigo === v };
  });
  expect(r.llama).toBe('llamar');
  expect(r.esLaVictima).toBe(false);
  await expect(page.locator('body')).toContainText('llamando a la Policía', { timeout: 5_000 });
  // Nadie le llega: la llamada termina sola, sube el fichaje y el testigo suelta el celular.
  await expect.poll(() => page.evaluate(() => window.__game.steal.buscado), { timeout: 20_000 }).toBeGreaterThan(r.antes);
  await expect.poll(() => page.evaluate(() => window.__testigo.witnessing), { timeout: 5_000 }).toBe(null);
  await expect(page.locator('body')).toContainText('Un testigo llamó a la Policía');
  expect(await page.evaluate(() => window.__game.witnesses.calls.length)).toBe(0);
  expect(errors).toEqual([]);
});
