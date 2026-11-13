import { test, expect } from '@playwright/test';

// El bucle real del juego corre. Las evaluaciones solo preparan (comida, cartones, la hora, el fichado, dónde
// está cada uno) y observan; la E, el menú del cambuche y dormir se hacen con el teclado y el ratón.
test.beforeEach(async ({ page }) => {
  // Se limpia una sola vez: el último escenario recarga la página y necesita la partida guardada.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('chato-e2e')) return;
    sessionStorage.setItem('chato-e2e', '1');
    localStorage.clear();
  });
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

const tecla = page => page.locator('#interaction-prompt');
const avisos = page => page.evaluate(() => window.__avisos);

/** Deja al jugador a `metros` del cambuche, del lado contrario al rincón de El Chato o junto a él. */
async function pararse(page, donde) {
  await page.evaluate(donde => {
    const game = window.__game, { player, cambuche, dog } = game, district = game.world.active;
    const c = cambuche.position, h = dog.home;
    const ux = (c.x - h.x) / Math.hypot(c.x - h.x, c.z - h.z), uz = (c.z - h.z) / Math.hypot(c.x - h.x, c.z - h.z);
    const [x, z] = donde === 'cambuche' ? [c.x + ux * .6, c.z + uz * .6]
      : donde === 'perro' ? [dog.position.x - ux * 1.1, dog.position.z - uz * 1.1]
        : [c.x - ux * 30, c.z - uz * 30];
    player.position.set(x, district.getMovementGroundHeight(x, z, 0), z);
    player.root.position.copy(player.position);
    player.velocity.set(0, 0, 0);
    player.resetGrounding();
    player.action = null;
  }, donde);
  await frames(page, 8);
}

async function dormirDeNoche(page) {
  await page.evaluate(() => { window.__game.clock.hour = 22; window.__avisos.length = 0; });
  await pararse(page, 'cambuche');
  await expect(tecla(page)).toContainText('Mi cambuche');
  await page.keyboard.press('KeyE');
  await page.getByRole('button', { name: /^Dormir hasta/ }).click();
  await expect.poll(() => page.evaluate(() => window.__game.isSleeping)).toBe(false);
  await frames(page, 4);
}

const loQueTengo = page => page.evaluate(() => {
  const game = window.__game;
  return { plata: game.stats.dinero, latas: game.inventory.count('lata'), caleta: game.street.caleta.count('lata') };
});

test('El Chato cuida el cambuche con E, espanta al ladrón de la noche y sigue cuidando al recargar', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);

  // Un cambuche sin paredes, con plata, material y algo en la caleta. Esta noche viene el ladrón.
  await page.evaluate(async () => {
    const { ITEMS } = await import('/src/data/items.js');
    const { SLEEP } = await import('/src/data/cambuche.js');
    const game = window.__game;
    SLEEP.roboProb = 1;
    game.inventory.add(ITEMS.carton, 8); game.inventory.add(ITEMS.lata, 8); game.inventory.add(ITEMS.pan, 1);
    game.stats.dinero = 10000;
  });
  await pararse(page, 'cambuche');
  await page.keyboard.press('KeyE');
  await page.getByRole('button', { name: 'Armar', exact: true }).first().click();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  await page.evaluate(() => { const game = window.__game; game.street.caleta.store(game.inventory, 'lata', 4, game.built); });
  expect(await loQueTengo(page)).toEqual({ plata: 10000, latas: 4, caleta: 4 });

  // Sin El Chato de amigo, lo de siempre: se llevan parte de la plata y del material.
  await dormirDeNoche(page);
  // La plata no se compara tal cual: la misión de pasar la noche también paga al despertar.
  expect(await avisos(page)).toContainEqual(expect.stringContaining('Me robaron mientras dormía ($ 4.000 y material)'));
  expect((await loQueTengo(page)).latas).toBe(2);

  // Le doy pan: ya es amigo. Junto al cambuche armado, la E le pide que cuide.
  await pararse(page, 'perro');
  await expect(tecla(page)).toContainText('Darle pan o atún a El Chato');
  await page.keyboard.press('KeyE');
  await expect(tecla(page)).toContainText('Pedirle a El Chato que cuide el cambuche');
  await page.keyboard.press('KeyE');
  await expect(tecla(page)).toContainText('Llamar a El Chato para que me siga');
  expect(await avisos(page)).toContainEqual(expect.stringContaining('Le pedí a El Chato que cuidara el cambuche'));

  // Me voy lejos y no me sigue; junto al cambuche la E sigue siendo del cambuche.
  await pararse(page, 'lejos');
  await frames(page, 90);
  const lejos = await page.evaluate(() => {
    const { dog, player } = window.__game;
    return { alJugador: dog.position.distanceTo(player.position), alPuesto: dog.position.distanceTo(dog.guarding) };
  });
  expect(lejos.alJugador).toBeGreaterThan(20);
  expect(lejos.alPuesto).toBeLessThan(1.5);

  // Con él cuidando, el ladrón de esta noche no se lleva nada.
  const antes = await loQueTengo(page);
  await dormirDeNoche(page);
  expect(await avisos(page)).toContainEqual('El Chato espantó a un ladrón mientras dormía.');
  expect((await avisos(page)).join(' ')).not.toContain('Me robaron');
  const despues = await loQueTengo(page);
  expect(despues.latas).toBe(antes.latas);
  expect(despues.caleta).toBe(antes.caleta);
  expect(despues.plata).toBeGreaterThanOrEqual(antes.plata);

  // Dormir guardó la partida: al recargar sigue cuidando, en su rincón.
  await page.reload({ waitUntil: 'commit' });
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => !!window.__game?.dog?.guarding), { timeout: 60_000 }).toBe(true);
  const seguir = page.getByRole('button', { name: 'Continuar jugando', exact: true });
  if (await seguir.isVisible().catch(() => false)) await seguir.click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  await pararse(page, 'perro');
  await expect(tecla(page)).toContainText('Llamar a El Chato para que me siga');
  await page.keyboard.press('KeyE');
  await expect(tecla(page)).toContainText('Pedirle a El Chato que cuide el cambuche');
  expect(await page.evaluate(() => window.__game.dog.guarding)).toBe(null);
  expect(errors).toEqual([]);
});

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
