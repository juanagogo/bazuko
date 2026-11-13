import { test, expect } from '@playwright/test';

// El bucle real del juego corre. Las evaluaciones solo preparan (el fichado y dónde está cada uno) y observan.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

async function start(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Chato QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  await page.evaluate(() => {
    window.__avisos = [];
    window.addEventListener('toast', event => window.__avisos.push(event.detail.text));
  });
}

async function frames(page, count = 12) {
  await page.evaluate(count => new Promise(resolve => {
    const next = () => --count <= 0 ? resolve() : requestAnimationFrame(next);
    requestAnimationFrame(next);
  }), count);
}

const avisos = page => page.evaluate(() => window.__avisos);

test('fichado y con El Chato al lado, avisa de la patrulla que tiene cerca y se queda mirándola', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await page.evaluate(() => window.__game.dog.befriend());

  // Me paro con El Chato en un sitio transitable a unos `metros` de una patrulla de las que rondan la ciudad.
  const arrimarme = (metros) => page.evaluate(metros => {
    const game = window.__game, { player, dog } = game, district = game.world.active;
    const patrulla = window.__patrulla ??= game.traffic.vehicles.find(vehicle => vehicle.police);
    const p = patrulla.car.position;
    for (let radio = metros; radio < metros + 12; radio += 2) for (let giro = 0; giro < 16; giro++) {
      const x = p.x + Math.cos(giro * Math.PI / 8) * radio, z = p.z + Math.sin(giro * Math.PI / 8) * radio;
      if (!district.isWalkableAt(x, z) || !district.isWalkableAt(x + 1.5, z)) continue;
      player.position.set(x, district.getMovementGroundHeight(x, z, 0), z);
      player.root.position.copy(player.position);
      player.velocity.set(0, 0, 0);
      player.resetGrounding();
      player.action = null;
      dog.resetNear(player.position.clone().setX(x + 1.5));
      return Math.hypot(p.x - dog.position.x, p.z - dog.position.z);
    }
    return null;
  }, metros);
  const deLaPatrulla = async () => (await avisos(page)).filter(text => text.includes('patrulla'));

  // Sin estar fichado, la patrulla cerca no le dice nada.
  expect(await arrimarme(14)).toBeLessThan(30);
  await frames(page, 90);
  expect(await deLaPatrulla()).toEqual([]);

  // Fichado y con la patrulla cerca: avisa una vez y se queda mirando hacia ella.
  await page.evaluate(() => { window.__game.steal.buscado = 1; window.__avisos.length = 0; });
  expect(await arrimarme(14)).toBeLessThan(30);
  await expect.poll(deLaPatrulla).toEqual(['El Chato: ¡Le ladra a una patrulla que viene!']);
  await frames(page, 75);
  const mira = await page.evaluate(() => {
    const { dog } = window.__game, p = window.__patrulla.car.position;
    const hacia = Math.atan2(p.x - dog.position.x, p.z - dog.position.z);
    const desvio = Math.atan2(Math.sin(hacia - dog.group.rotation.y), Math.cos(hacia - dog.group.rotation.y));
    return { mira: dog._lookAt === p, cuerpo: Math.abs(desvio), echado: dog._posture.lie, quieto: dog.speed < .2 };
  });
  expect(mira.mira, 'mira a la patrulla').toBe(true);
  // Quieto, gira el cuerpo hasta dejarla al alcance del cuello; la cabeza hace el resto.
  if (mira.quieto) expect(mira.cuerpo).toBeLessThan(1.1);
  expect(mira.echado).toBeLessThan(.2);
  expect(await deLaPatrulla()).toHaveLength(1);
  expect(errors).toEqual([]);
});
