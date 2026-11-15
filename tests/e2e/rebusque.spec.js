import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Rebusque en el semáforo con el juego de verdad: compra las pelotas en el menú de la Tienda La Esquinita, espera al
// primero de una cola quieto en rojo, se para frente a su trompa, oprime B, comprueba que el cuerpo hace los malabares
// con las pelotas en el aire, abre y cierra la pausa a mitad del show, cobra y comprueba que los brazos bajan.
// Las evaluaciones solo abren la tienda, ponen al jugador y la cámara en su sitio y fijan el azar; el tráfico, los
// semáforos, la compra, la tecla, la pose y el cobro son los del juego.
// Las fotos van a REBUSQUE_FOTOS (o a test-results/rebusque); con REBUSQUE_GIF también los cuadros del show.

test.use({ video: 'off' });

/** Lo que se ve del cuerpo: la acción, la mano derecha y las pelotas, en metros sobre los pies. */
const cuerpo = page => page.evaluate(() => {
  const g = window.__game, p = g.player;
  let mano = null;
  p.character.group.traverse(o => { if (!mano && /righthand$/.test(o.name.replace(/[^a-z0-9]/gi, '').toLowerCase())) mano = o; });
  const pelotas = g.sceneMgr.scene.getObjectByName('Rebusque: pelotas');
  const y = o => o.getWorldPosition(o.position.clone()).y - p.position.y;
  return { modelo: p.modelKind, accion: p.action, mano: mano ? y(mano) : null, pelotas: !!pelotas?.visible,
    alto: pelotas?.visible ? Math.max(...pelotas.children.map(y)) : null };
});

test('Rebusque: compra las pelotas, hace malabares frente al primero de la cola en rojo y cobra', async ({ page }) => {
  test.setTimeout(400_000);
  const fotos = process.env.REBUSQUE_FOTOS ?? path.join('test-results', 'rebusque');
  await mkdir(fotos, { recursive: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);

  // La tienda: las pelotas se compran con la plata del jugador.
  await page.evaluate(async () => {
    const g = window.__game;
    g.stats.dinero = 5000;
    g.stats.energia = 100;
    const { openShop } = await import('/src/ui/placeMenus.js');
    openShop(g);
  });
  const fila = page.locator('.row', { hasText: 'Pelotas de malabares' });
  await fila.scrollIntoViewIfNeeded();
  await expect(fila).toBeVisible();
  await page.screenshot({ path: path.join(fotos, '1-tienda.png') });
  await fila.getByRole('button', { name: 'Comprar' }).click();
  await expect(fila.getByRole('button', { name: 'Comprar' })).toBeDisabled();
  await expect(fila).toContainText('Ya lo tengo.');
  expect(await page.evaluate(() => [window.__game.inventory.count('malabares'), window.__game.stats.dinero])).toEqual([1, 2000]);
  await page.evaluate(() => window.__game.menu.close());
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);

  await page.evaluate(() => {
    const g = window.__game;
    g.rebusque.random = () => 0;
    window.__avisos = [];
    window.addEventListener('toast', e => window.__avisos.push(e.detail.text));
  });
  // Espera al primero de una cola, quieto en rojo con rojo de sobra, y se para frente a su trompa (L/2 + 1,1 m).
  // El Chato se aparta para que no se meta en la escena.
  await expect.poll(() => page.evaluate(() => {
    const g = window.__game, s = g.traffic.signals;
    if (window.__carro && /malabares/.test(g.interaction.rebusquePrompt ?? '')) return g.interaction.rebusquePrompt;
    const rojo = car => { const yaw = car.group.rotation.y, eje = Math.abs(Math.cos(yaw)) >= Math.abs(Math.sin(yaw)) ? 0 : 1; const f = ((s.time - eje * 18) % 36 + 36) % 36; return f < 14 ? 0 : 36 - f; };
    const primero = v => !g.traffic.vehicles.some(o => {
      if (o === v) return false;
      const yaw = v.car.group.rotation.y, hx = Math.cos(yaw), hz = -Math.sin(yaw);
      const dx = o.car.position.x - v.car.position.x, dz = o.car.position.z - v.car.position.z;
      return dx * hx + dz * hz > 0 && dx * hx + dz * hz < 9 && Math.abs(dx * -hz + dz * hx) < 1.6;
    });
    const v = g.traffic.vehicles.find(v => !v.police && !v.hold && v.stopped
      && g.traffic.stoppedAtRed(v.car.position, .1).length && rojo(v.car) > 13 && primero(v));
    window.__carro = null;
    if (!v) return '';
    const yaw = v.car.group.rotation.y, a = v.car.length / 2 + 1.1;
    const x = v.car.position.x + Math.cos(yaw) * a, z = v.car.position.z - Math.sin(yaw) * a;
    g.player.position.set(x, v.car.position.y, z);
    g.player.velocity?.set?.(0, 0, 0);
    g.player.faceTowards?.(v.car.position);
    g.dog?.position?.set?.(x + 40, g.dog.position.y, z + 40);
    // La cámara de lado y cerca (de perfil, un poco hacia el carro), para ver las manos, las pelotas y la trompa.
    Object.assign(g.cameraRig, { yaw: yaw - Math.PI * .14, pitch: .1, distance: 3.6 });
    window.__carro = v;
    return '';
  }), { timeout: 240_000, intervals: [400] }).toMatch(/malabares/);
  await expect(page.locator('#interaction-prompt')).toContainText('malabares');
  await page.screenshot({ path: path.join(fotos, '2-aviso-en-rojo.png') });
  const antes = await page.evaluate(() => window.__game.stats.dinero);
  await page.keyboard.press('b');
  await expect.poll(() => page.evaluate(() => window.__avisos.some(t => /lanzo las pelotas/.test(t)))).toBe(true);
  expect(await page.evaluate(() => window.__game.stats.dinero), 'B no pidió limosna').toBe(antes);
  // El aviso lleva la cuenta del show y del rojo.
  await expect(page.locator('#interaction-prompt')).toContainText('Haciendo malabares');
  await expect(page.locator('#interaction-prompt')).toContainText('rojo');
  // El cuerpo hace los malabares y las pelotas suben por encima de las manos.
  const enShow = await cuerpo(page);
  expect(enShow.accion).toBe(enShow.modelo === 'procedural' ? 'calentarse' : 'malabares');
  expect(enShow.pelotas).toBe(true);
  await expect.poll(async () => { const c = await cuerpo(page); return c.alto - (c.mano ?? 1); }).toBeGreaterThan(.3);
  await page.waitForTimeout(800);
  const manoArriba = (await cuerpo(page)).mano;
  await page.screenshot({ path: path.join(fotos, '3-malabares.png') });

  // A mitad del show se abre la pausa: el show espera (el reloj del rojo también) y al cerrarla sigue.
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(true);
  const enPausa = await page.evaluate(() => window.__game.rebusque.trabajo?.tiempo);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__game.rebusque.trabajo?.tiempo)).toBe(enPausa);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  expect(await page.evaluate(() => window.__game.rebusque.activo)).toBe(true);

  if (process.env.REBUSQUE_GIF) {
    for (let i = 0; i < 40 && await page.evaluate(() => window.__game.rebusque.activo); i++) {
      await page.screenshot({ path: path.join(fotos, `gif-${String(i).padStart(2, '0')}.png`), clip: { x: 240, y: 100, width: 800, height: 600 } });
      await page.waitForTimeout(120);
    }
  }
  await expect.poll(() => page.evaluate(() => window.__game.rebusque.activo), { timeout: 60_000 }).toBe(false);
  await expect(page.getByText(/me dieron \$/i).first()).toBeVisible();
  await page.screenshot({ path: path.join(fotos, '4-cobro.png') });
  // Terminado el show, los brazos bajan y las pelotas se guardan.
  const despuesDelShow = await cuerpo(page);
  expect(despuesDelShow.accion).not.toBe('malabares');
  expect(despuesDelShow.pelotas).toBe(false);
  if (enShow.modelo !== 'procedural') await expect.poll(async () => manoArriba - (await cuerpo(page)).mano).toBeGreaterThan(.1);
  if (process.env.REBUSQUE_GIF) {
    for (let i = 40; i < 52; i++) {
      await page.screenshot({ path: path.join(fotos, `gif-${String(i).padStart(2, '0')}.png`), clip: { x: 240, y: 100, width: 800, height: 600 } });
      await page.waitForTimeout(150);
    }
  }
  const despues = await page.evaluate(() => window.__game.stats.dinero);
  expect(despues).toBeGreaterThan(antes); // random 0: cada conductor paga el mínimo
  expect((despues - antes) % 100).toBe(0);
  const aviso = await page.evaluate(() => window.__avisos.find(t => /me dieron/i.test(t)));
  expect(aviso).toContain(`$ ${(despues - antes).toLocaleString('es-CO')}`);
  // Terminado el show, el carro vuelve a ofrecer lo suyo y B no repite con los mismos carros.
  expect(await page.evaluate(() => window.__game.rebusque.prompt ?? '')).not.toMatch(/Haciendo malabares/);
  expect(errors).toEqual([]);
});
