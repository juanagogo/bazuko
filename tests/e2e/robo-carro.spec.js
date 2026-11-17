// tests/e2e/robo-carro.spec.js
// El robo de carros en el juego de verdad: Y junto a un carro parqueado fuerza la puerta, el jugador camina a la
// puerta, se mete, maneja con W hasta chocar contra el parqueado de delante, frena con Espacio y se baja con Y.
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

// Con FOTOS_ROBO_CARRO=<carpeta> guarda capturas de cada paso y una tira de cuadros manejando y bajándose.
const fotos = process.env.FOTOS_ROBO_CARRO;
let cuadro = 0;
async function foto(page, nombre) { if (fotos) await page.screenshot({ path: `${fotos}/${nombre}.png` }); }
async function tira(page, ms) {
  const hasta = Date.now() + ms;
  do {
    if (fotos) await page.screenshot({ path: `${fotos}/tira-${String(cuadro++).padStart(3, '0')}.png` });
    else await page.waitForTimeout(100);
  } while (Date.now() < hasta);
}

test('forzar un parqueado, manejar unos metros, chocar y bajarse', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await start(page);
  // Dos parqueados en fila, cerca del inicio: el de atrás se roba y el de delante sirve para chocar.
  const salida = await page.evaluate(() => {
    const g = window.__game;
    g.clock.hour = 12;
    g.traffic.alertForTheft = () => false; // lo que se prueba es el carro, no la persecución
    const p = g.player.position;
    let mejor = null;
    for (const a of g.cars) {
      const h = a.group.rotation.y, fx = Math.cos(h), fz = -Math.sin(h);
      for (const b of g.cars) {
        if (a === b) continue;
        const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
        const along = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
        if (Math.abs(along) < 6 || Math.abs(along) > 14 || side > .6) continue;
        const d = a.position.distanceTo(p);
        if (!mejor || d < mejor.d) mejor = { a, b, d, atras: along < 0 };
      }
    }
    if (!mejor) {
      // Los parqueados salen al azar: si ninguno quedó en fila con otro, se arrima uno 9 m delante del más cercano.
      const [a, b] = [...g.cars].sort((x, y) => x.position.distanceTo(p) - y.position.distanceTo(p));
      const h = a.group.rotation.y;
      b.position.set(a.position.x + Math.cos(h) * 9, a.position.y, a.position.z - Math.sin(h) * 9);
      b.group.rotation.y = h;
      mejor = { a, b, atras: false };
    }
    const { a, b, atras } = mejor;
    // Que mire hacia el de delante.
    if (atras) a.group.rotation.y += Math.PI;
    window.__robado = a;
    window.__delante = b;
    const door = a.driverDoor();
    g.player.position.set(door.x, door.y, door.z);
    g.player.root.position.copy(g.player.position);
    g.player.velocity?.set(0, 0, 0);
    g.cameraRig.yaw = a.group.rotation.y - Math.PI / 2 + .5;
    // El Chato anda por el inicio y se queda con las teclas: lejos.
    if (g.dog) { g.dog.position.set(door.x + 40, door.y, door.z + 40); g.dog.group?.position.copy(g.dog.position); }
    return { x: a.position.x, z: a.position.z, gap: a.position.distanceTo(b.position) };
  });
  await expect.poll(() => page.evaluate(() => window.__game.carjack.prompt)).toBe('[Y] Forzar la puerta y robarme el carro');
  await expect(page.locator('#interaction-prompt')).toContainText('Forzar la puerta');
  await page.waitForTimeout(400);
  await foto(page, '1-aviso-junto-al-parqueado');
  const buscado = await page.evaluate(() => window.__game.steal.buscado);
  await page.keyboard.press('KeyY');
  await expect.poll(() => page.evaluate(() => window.__game.carjack.transition?.phase), { timeout: 3000 }).toBe('grab');
  await page.waitForTimeout(150);
  await foto(page, '2-forzando-la-puerta');
  await expect.poll(() => page.evaluate(() => window.__game.carjack.driving && !window.__game.carjack.transition), { timeout: 5000 }).toBe(true);
  const sube = await page.evaluate(b => ({
    visible: window.__game.player.root.visible,
    alVolante: !!window.__robado._playerDriver?.visible,
    velocimetro: !document.getElementById('carjack-hud').hidden,
    fichado: window.__game.steal.buscado - b
  }), buscado);
  expect(sube).toEqual({ visible: false, alVolante: true, velocimetro: true, fichado: 1 });
  await page.waitForTimeout(700);
  await foto(page, '3-al-volante');
  // W hasta chocar con el parqueado de delante: el carro se detiene antes de meterse en él.
  await page.keyboard.down('KeyW');
  await tira(page, 2600);
  await page.keyboard.up('KeyW');
  const choque = await page.evaluate(({ x, z }) => {
    const a = window.__robado, b = window.__delante;
    return { recorrido: Math.hypot(a.position.x - x, a.position.z - z), separacion: a.position.distanceTo(b.position),
      largo: (a.length + b.length) / 2 };
  }, salida);
  expect(choque.recorrido).toBeGreaterThan(1.5);
  expect(choque.separacion).toBeGreaterThan(choque.largo - .3);
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => Math.abs(window.__game.carjack.speed)), { timeout: 6000 }).toBeLessThan(.5);
  await page.keyboard.up('Space');
  await page.keyboard.press('KeyY');
  await tira(page, 1200);
  await expect.poll(() => page.evaluate(() => !window.__game.carjack.driving && !window.__game.carjack.transition), { timeout: 5000 }).toBe(true);
  const baja = await page.evaluate(() => {
    const g = window.__game, a = window.__robado;
    return { visible: g.player.root.visible, conductor: a.driven, parqueado: g.cars.includes(a),
      fuera: g.player.position.distanceTo(a.position) > 1.2, velocimetro: document.getElementById('carjack-hud').hidden };
  });
  expect(baja).toEqual({ visible: true, conductor: false, parqueado: true, fuera: true, velocimetro: true });
  expect(errors).toEqual([]);
});
