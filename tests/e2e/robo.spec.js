// tests/e2e/robo.spec.js
// El robo en el juego de verdad: el aviso dice que está de espaldas, la E abre la barra y la mano entra
// al bolsillo, la barra en la zona saca la plata, la víctima se palpa luego y, si el jugador sigue cerca,
// lo ve y sale corriendo; el raponazo (Q) tira la mano al frente, saca plata y deja fichado.
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

// Pone a una víctima quieta en un claro del parque y al jugador detrás (back > 0) o delante (back < 0).
const helpers = async () => {
  const g = window.__game;
  g.clock.hour = 12;
  // Con llovizna, quien lleva paraguas y bolsa no tiene mano para palparse: solo se voltea. La víctima tiene que tenerla.
  const { manosOcupadas } = await import('/src/features/stealReactions.js');
  const H = window.__robo = {
    g,
    hueso(re) { let b = null; g.player.root.traverse(o => { if (!b && re.test(o.name)) b = o; }); return b; },
    // Lo más adelante que llega una mano, en metros, en el marco del jugador.
    manoAlFrente() {
      const p = g.player, yaw = p.root.rotation.y;
      let max = -Infinity;
      for (const re of [/RightHand$/, /LeftHand$/]) {
        const b = H.hueso(re);
        if (!b) continue;
        const w = b.getWorldPosition(p.position.clone());
        max = Math.max(max, Math.sin(yaw) * (w.x - p.position.x) + Math.cos(yaw) * (w.z - p.position.z));
      }
      return max;
    },
    victima(excepto = null) {
      const p = g.player.position;
      const lista = g.world.active.npcs.filter(n => n !== excepto && n.person && !n.isVendor && !n.fijo && !n.koState && !n._disposed &&
        !['sentado', 'acurrucado', 'banca', 'pedir', 'dormido'].includes(n.stance));
      lista.sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));
      return lista.find(n => { const m = manosOcupadas(n); return !(m.derecha && m.izquierda); }) ?? lista[0];
    },
    poner(n, back) {
      const p = g.player, x = 112.98, z = 97.84;
      n.position.set(x, g.world.active.getGroundHeight(x, z), z); n.root.position.copy(n.position); n.root.rotation.y = 0;
      n.target = null; n.route = []; n.fleeTimer = 0; n._robadoTimer = 0; n.alerta = .3;
      n.scriptedHold = () => { n.moving = false; return true; };
      // Los demás que anden cerca no se cuelan en el aviso.
      for (const o of g.world.active.npcs) if (o !== n && o.position.distanceTo(n.position) < 4) o._robadoTimer = 60;
      const pz = z - back;
      p.position.set(x, g.world.active.getGroundHeight(x, pz), pz); p.root.position.copy(p.position);
      p.root.rotation.set(0, back > 0 ? 0 : Math.PI, 0);
      p.velocity?.set(0, 0, 0); p.resetGrounding?.(); p.action = null;
      g.steal.cooldown = 0;
      H.n = n;
    }
  };
};

test('cosquilleo de espaldas, plata, la víctima se palpa y me ve; raponazo de frente', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await start(page);
  await page.evaluate(helpers);
  await page.evaluate(() => {
    const r = window.__robo, g = r.g;
    // Lo que se prueba es la víctima: nadie llama a la Policía ni la patrulla arranca a perseguir. Si un arresto
    // pausa el juego, el raponazo nunca tiene aviso. Las llamadas y las persecuciones tienen sus pruebas.
    g.witnesses.random = () => 1;
    g.traffic.alertForTheft = () => false;
    window.__arrestos = 0;
    window.addEventListener('police-arrest', () => { window.__arrestos++; });
    r.poner(r.victima(), .9);
  });

  // 1. El aviso: de espaldas, con la E y la Q.
  await expect.poll(() => page.evaluate(() => window.__game.interaction?.stealPrompt ?? ''), { timeout: 10_000 })
    .toContain('de espaldas');
  await expect(page.locator('#interaction-prompt')).toContainText('Cosquilleo');
  const reposo = await page.evaluate(() => window.__robo.manoAlFrente());

  // 2. La E abre la barra y la mano va al bolsillo.
  await page.keyboard.press('e');
  await expect(page.locator('#steal-minigame')).toBeVisible();
  await page.evaluate(() => { window.__game.steal._ventaja.marcadorMult = 0; });
  await expect.poll(() => page.evaluate(() => window.__game.player.stealPose?.fase ?? null)).toBe('meter');
  await page.waitForTimeout(900);
  const metida = await page.evaluate(() => ({ alFrente: window.__robo.manoAlFrente(), d: window.__game.player.position.distanceTo(window.__robo.n.position) }));
  expect(metida.alFrente - reposo, JSON.stringify({ reposo, metida })).toBeGreaterThan(.15);
  expect(metida.d).toBeLessThan(.75);

  // 3. Con la barra en la zona, espacio: saca la plata. La víctima se palpa a los 0,5 s y me ve.
  const antes = await page.evaluate(() => {
    const g = window.__game, s = g.steal;
    s.ajustes.miron.chance = 0;
    s.ajustes.descubre = { chance: 1, min: .5, max: .5, radio: 10 };
    s.markerPos = s.zoneStart + s.zoneSize / 2;
    return g.stats.dinero;
  });
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__game.player.stealPose?.fase ?? null)).toBe('sacar');
  expect(await page.evaluate(() => window.__game.stats.dinero)).toBeGreaterThan(antes);
  await expect(page.locator('#steal-minigame')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__robo.n.poseParams?.hurto?.fase ?? null), { timeout: 5_000 }).toBe('palparse');
  await expect.poll(() => page.evaluate(() => window.__robo.n.fleeTimer ?? 0), { timeout: 5_000 }).toBeGreaterThan(0);

  // 4. Raponazo de frente a otra persona: la mano al frente en el contacto, plata y fichado.
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const r = window.__robo, g = r.g;
    g.steal.buscado = 0;
    r.poner(r.victima(r.n), -1.1);
    r.n.alerta = 0;
    window.__tiron = { max: -Infinity, t: 0 };
    const tick = () => {
      const pose = g.player.stealPose;
      if (pose?.fase === 'raponazo') {
        window.__tiron.t = Math.max(window.__tiron.t, pose.t);
        window.__tiron.max = Math.max(window.__tiron.max, r.manoAlFrente());
      }
      if (window.__tiron.t < .45) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const plata = await page.evaluate(() => window.__game.stats.dinero);
  await expect.poll(() => page.evaluate(() => window.__game.interaction?.stealPrompt ?? ''), { timeout: 10_000 }).toContain('[Q] Robo directo');
  await page.keyboard.press('q');
  await expect.poll(() => page.evaluate(() => window.__tiron.t), { timeout: 5_000 }).toBeGreaterThan(.3);
  const tiron = await page.evaluate(() => window.__tiron);
  expect(tiron.max, JSON.stringify(tiron)).toBeGreaterThan(.35);
  await expect.poll(() => page.evaluate(() => window.__game.stats.dinero)).toBeGreaterThan(plata);
  expect(await page.evaluate(() => window.__game.steal.buscado)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__arrestos)).toBe(0);

  expect(errors).toEqual([]);
});

test('cosquilleo a alguien que va andando: lo sigo con la mano adentro y, si me suelto, se me va', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await start(page);
  await page.evaluate(helpers);
  await page.evaluate(() => {
    window.__toasts = [];
    window.addEventListener('toast', e => window.__toasts.push(e.detail.text));
  });
  // Alguien que camina, con el modelo completo, y el jugador medio metro detrás. Nadie lo deja quieto.
  const elegido = await page.evaluate(async () => {
    const r = window.__robo, g = r.g;
    for (let intento = 0; intento < 60; intento++) {
      const lista = g.world.active.npcs.filter(n => n.person && !n.isVendor && !n.fijo && !n.koState && !n._disposed && n.moving && !(n.fleeTimer > 0) &&
        !['sentado', 'acurrucado', 'banca', 'pedir', 'dormido'].includes(n.stance));
      lista.sort((a, b) => a.position.distanceTo(g.player.position) - b.position.distanceTo(g.player.position));
      const n = lista[0];
      if (n) {
        for (let k = 0; k < 40 && !(n.character === n.fullChar && k > 5); k++) {
          const yaw = n.root.rotation.y, p = g.player;
          const x = n.position.x - Math.sin(yaw) * .8, z = n.position.z - Math.cos(yaw) * .8;
          p.position.set(x, n.position.y, z); p.root.position.copy(p.position); p.root.rotation.set(0, yaw, 0);
          p.velocity?.set(0, 0, 0); p.resetGrounding?.();
          for (const o of g.world.active.npcs) if (o !== n) o._robadoTimer = 60;
          n._robadoTimer = 0; n.alerta = .3; g.steal.cooldown = 0;
          await new Promise(res => setTimeout(res, 100));
        }
        if (n.moving && n.character === n.fullChar) { r.n = n; return { velocidad: n.walkSpeed }; }
      }
      await new Promise(res => setTimeout(res, 250));
    }
    return null;
  });
  expect(elegido, 'alguien caminando cerca').not.toBeNull();
  await expect.poll(() => page.evaluate(() => window.__game.interaction?.stealPrompt ?? '')).toContain('Cosquilleo');
  await page.keyboard.press('e');
  await expect(page.locator('#steal-minigame')).toBeVisible();
  await page.evaluate(() => { const s = window.__game.steal; s._ventaja.marcadorMult = 0; s.markerPos = 0; });
  // Va andando y el jugador va pegado: la barra sigue abierta y la mano adelante.
  const muestras = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(300);
    muestras.push(await page.evaluate(() => {
      const g = window.__game, n = window.__robo.n;
      return { d: Math.hypot(n.position.x - g.player.position.x, n.position.z - g.player.position.z), fase: g.player.stealPose?.fase ?? null,
        barra: g.steal.minigameActive, anda: n.moving, mano: window.__robo.manoAlFrente() };
    }));
  }
  const tarde = muestras.slice(2);
  expect(tarde.every(m => m.barra && m.fase === 'meter' && m.anda), JSON.stringify(muestras)).toBe(true);
  expect(Math.max(...tarde.map(m => m.d)), JSON.stringify(muestras)).toBeLessThan(.85);
  expect(Math.min(...tarde.map(m => m.mano)), JSON.stringify(muestras)).toBeGreaterThan(.2);
  // El jugador se echa para atrás (la entrada manda sobre el arrimo): ella sigue y se le va.
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position, n = window.__robo.n.position;
    g.cameraRig.yaw = Math.atan2(n.x - p.x, n.z - p.z) + Math.PI; g.cameraRig._snap = true; // detrás del jugador, mirando a la víctima
  });
  await page.keyboard.down('s');
  await expect.poll(() => page.evaluate(() => window.__game.steal.minigameActive), { timeout: 5_000 }).toBe(false);
  await page.keyboard.up('s');
  expect(await page.evaluate(() => window.__toasts.some(t => t.startsWith('Se me fue')))).toBe(true);
  expect(errors).toEqual([]);
});
