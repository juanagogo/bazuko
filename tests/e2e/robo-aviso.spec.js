// tests/e2e/robo-aviso.spec.js
// El aviso del robo en el juego de verdad: de espaldas dice «ni me ve» y la barra sale más ancha y más lenta;
// de frente dice «me está viendo» y la barra sale más angosta; de lado, el aviso y la barra de siempre.
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

// Una víctima quieta en un claro del parque, mirando hacia +Z, y el jugador a 0,9 m: detrás, delante o al lado.
const montar = () => {
  const g = window.__game, x = 112.98, z = 97.84;
  g.clock.hour = 12;
  g.traffic.alertForTheft = () => false;
  const n = g.world.active.npcs
    .filter(o => o.person && !o.isVendor && !o.fijo && !o.koState && !o._disposed && !['sentado', 'acurrucado', 'banca', 'pedir', 'dormido'].includes(o.stance))
    .sort((a, b) => a.position.distanceToSquared(g.player.position) - b.position.distanceToSquared(g.player.position))[0];
  const y = g.world.active.getGroundHeight(x, z);
  n._walk = () => { n.moving = false; };
  const update = n.update.bind(n);
  n.update = (...a) => { update(...a); n.position.set(x, y, z); n.root.position.copy(n.position); n.root.rotation.y = 0; };
  n.target = null; n.route = []; n.fleeTimer = 0; n.alerta = .3;
  window.__robo = {
    n,
    poner(dx, dz) {
      // El Chato anda por este claro y se queda con la E: lejos.
      if (g.dog) {
        g.dog.home?.set?.(x + 25, y, z + 25);
        g.dog.position.set(x + 25, y, z + 25);
        g.dog._wanderTarget = null;
      }
      // Los demás que anden cerca no se cuelan en el aviso.
      for (const o of g.world.active.npcs) if (o !== n && o.position.distanceTo(n.position) < 5) o._robadoTimer = 60;
      n._robadoTimer = 0;
      const p = g.player, px = x + dx, pz = z + dz, yaw = Math.atan2(-dx, -dz);
      p.position.set(px, g.world.active.getGroundHeight(px, pz), pz); p.root.position.copy(p.position);
      p.velocity?.set(0, 0, 0); p.action = null;
      // La cámara, de lado y cerca: se ven las dos caras de la escena, la víctima y el jugador.
      g.cameraRig.yaw = yaw + Math.PI + .6; g.cameraRig.distance = 3.6; p.root.rotation.set(0, yaw, 0);
      g.steal.cooldown = 0;
    }
  };
};

async function barraDesde(page, dx, dz, texto, fotos) {
  await page.evaluate(([a, b]) => window.__robo.poner(a, b), [dx, dz]);
  await expect.poll(() => page.evaluate(() => window.__game.interaction?.stealPrompt ?? ''), { timeout: 10_000 }).toBe(texto);
  await expect(page.locator('#interaction-prompt')).toBeVisible();
  if (fotos?.aviso) await page.screenshot({ path: fotos.aviso });
  await page.keyboard.press('e');
  await expect(page.locator('#steal-minigame')).toBeVisible();
  const barra = await page.evaluate(() => {
    const s = window.__game.steal, zona = document.querySelector('#steal-zone'), pista = document.querySelector('#steal-track');
    return { zona: s.zoneSize, marcador: s.markerSpeed, px: zona.getBoundingClientRect().width / pista.getBoundingClientRect().width };
  });
  if (fotos?.barra) await page.locator('#steal-minigame').screenshot({ path: fotos.barra });
  await page.keyboard.press('Escape');
  await expect(page.locator('#steal-minigame')).toBeHidden();
  return barra;
}

test('el aviso dice de espaldas o de frente, y de espaldas la barra es más ancha y más lenta', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await start(page);
  await page.evaluate(montar);
  const fotos = process.env.FOTOS_ROBO;
  // Para las fotos, que se vaya el letrero del lugar que sale al llegar.
  if (fotos) await page.waitForTimeout(6000);
  const ruta = (nombre) => fotos ? `${fotos}/${nombre}` : info.outputPath(nombre);

  const espalda = await barraDesde(page, 0, -.9, '[E] Cosquilleo · de espaldas, ni me ve · [Q] Robo directo',
    { aviso: ruta('espalda-aviso.png'), barra: ruta('espalda-barra.png') });
  const lado = await barraDesde(page, .9, 0, '[E] Cosquilleo · [Q] Robo directo', { barra: ruta('lado-barra.png') });
  const frente = await barraDesde(page, 0, .9, '[E] Cosquilleo · de frente: me está viendo · [Q] Robo directo',
    { aviso: ruta('frente-aviso.png'), barra: ruta('frente-barra.png') });

  info.annotations.push({ type: 'barra', description: JSON.stringify({ espalda, lado, frente }) });
  console.log('[robo-aviso]', JSON.stringify({ espalda, lado, frente }));
  // Lo que se ve en pantalla es lo que cuenta el juego.
  for (const b of [espalda, lado, frente]) expect(Math.abs(b.px - b.zona), JSON.stringify(b)).toBeLessThan(.01);
  expect(espalda.zona / lado.zona).toBeCloseTo(1.35, 5);
  expect(espalda.marcador / lado.marcador).toBeCloseTo(.85, 5);
  expect(frente.zona / lado.zona).toBeCloseTo(.7, 5);
  expect(espalda.px).toBeGreaterThan(frente.px * 1.5);
  expect(errors).toEqual([]);
});
