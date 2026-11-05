import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Flujos del PR #4 original, adaptados a carga inicial, pausa e interfaz actuales.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

async function startNewGame(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#menu-title')).toHaveText('Nota del desarrollador');
  // La nota actual oculta temporalmente los créditos; conserva el enlace de colaboración.
  await expect(page.getByRole('link', { name: 'Ver issues del proyecto original' })).toHaveAttribute('href', 'https://github.com/juanagogo/bazuko/issues');
  await expect(page.locator('#menu')).toContainText('issues abiertos al público');
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect(page.locator('#creator-modal')).toBeHidden();
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.locator('#player-name')).toHaveText('Parcero QA');
}

test('modo foto congela la partida, exporta una imagen y restaura la cámara', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text());
  });
  await startNewGame(page);
  await page.keyboard.press('v');
  const originalCamera = await page.evaluate(() => ({ mode: window.__game.cameraRig.mode, yaw: window.__game.cameraRig.yaw, distance: window.__game.cameraRig.distance }));
  await page.keyboard.press('F2');
  await expect(page.locator('#photo-mode')).toBeVisible();
  await expect(page.locator('#topbar')).toBeHidden();
  await expect(page.locator('#hud-dock')).toBeHidden();
  const state = () => page.evaluate(() => {
    const game = window.__game;
    return { clock: game.clock.serialize(), health: game.stats.salud, hunger: game.stats.hambre,
      position: game.player.position.toArray(), vehicles: game.traffic.vehicles.map(({ car }) => car.group.position.toArray()) };
  });
  const frozen = await state();
  await page.keyboard.press('w');
  await page.keyboard.press('i');
  await page.getByRole('button', { name: 'Girar a la izquierda', exact: true }).click();
  await page.getByRole('button', { name: 'Acercar cámara', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.cameraRig.yaw)).not.toBe(originalCamera.yaw);
  await page.waitForTimeout(700);
  expect(await state()).toEqual(frozen);
  await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/modo-foto.png` });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Guardar foto', exact: true }).click();
  const download = await downloadPromise;
  const photoPath = testInfo.outputPath('bogota.png');
  await download.saveAs(photoPath);
  const png = await readFile(photoPath);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.length).toBeGreaterThan(4096);
  expect(png.readUInt32BE(16)).toBeGreaterThan(200);
  expect(png.readUInt32BE(20)).toBeGreaterThan(200);
  // Comprobar contenido de color y opaco; una descarga válida podría ser un canvas vacío.
  const imageContent = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    const colors = new Set(); let opaque = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 255) opaque++;
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    }
    return { colors: colors.size, opaque };
  }, png.toString('base64'));
  expect(imageContent.colors).toBeGreaterThan(40);
  expect(imageContent.opaque).toBe(1024);
  await page.keyboard.press('Escape');
  await expect(page.locator('#photo-mode')).toBeHidden();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#topbar')).toBeVisible();
  const restored = await page.evaluate(() => ({ mode: window.__game.cameraRig.mode, yaw: window.__game.cameraRig.yaw, distance: window.__game.cameraRig.distance }));
  expect(restored).toEqual(originalCamera);
  expect(errors).toEqual([]);
});

test('creador visual adaptable y accesible con movimiento reducido', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('textbox', { name: 'Nombre del personaje' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Nombre del personaje' }).fill('Luz Dary');
  for (const size of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    await expect(page.locator('#creator-done')).toBeInViewport();
    await expect(page.locator('#creator-random')).toBeInViewport();
    const dimensions = await page.locator('#creator-modal').evaluate(root => ({ width: root.scrollWidth, viewport: innerWidth }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
    for (const tabName of ['Estilo', 'Cuerpo', 'Pelo', 'Barba', 'Ropa', 'Nombre']) {
      const tab = page.getByRole('tab', { name: tabName, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }
    if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/creador-${size.width}.png` });
  }
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect(page.locator('#player-name')).toHaveText('Luz Dary');
  await page.keyboard.press('F2');
  await expect(page.getByRole('button', { name: 'Guardar foto', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-title')).toHaveText('Un momentico');
  for (const tabName of ['Estado', 'Ajustes', 'Controles', 'Mapa']) {
    await page.getByRole('tab', { name: new RegExp(tabName) }).click();
    const overflow = await page.locator('#menu-body').evaluate(body => body.scrollWidth - body.clientWidth);
    expect(overflow, `La pestaña ${tabName} debe caber a 375 px`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('tab', { name: /Estado/ }).click();
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/pausa-375.png` });
});

test('partida nueva, talentos, recetas y edición del personaje', async ({ page }) => {
  await startNewGame(page);
  await expect(page.locator('#clock')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator('#day-display')).toHaveText('Día 1');
  await page.keyboard.press('T');
  await expect(page.locator('#talent-panel')).toHaveClass(/open/);
  await expect(page.locator('#talent-panel')).toContainText('Mañas');
  await page.keyboard.press('Escape');
  await expect(page.locator('#talent-panel')).not.toHaveClass(/open/);
  await expect(page.locator('#menu')).toBeHidden();

  await page.keyboard.press('C');
  await expect(page.locator('#craft-panel')).toHaveClass(/open/);
  await expect(page.locator('#craft-panel')).toContainText('La mesa');
  await expect(page.locator('#craft-panel .craft-recipe').first()).toBeVisible();
  await expect(page.locator('#craft-panel .craft-go')).toBeDisabled();
  // Con los materiales de la curita, elegirla y fabricarla desde el banco.
  await page.evaluate(async () => {
    const { ITEMS } = await import('/src/data/items.js');
    window.__game.inventory.add(ITEMS.botella, 1);
    window.__game.inventory.add(ITEMS.carton, 1);
  });
  await page.keyboard.press('C');
  await page.keyboard.press('C');
  await page.locator('#craft-panel .craft-recipe[data-id="curita"]').click();
  await expect(page.locator('#craft-panel .craft-recipe[data-id="curita"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#craft-panel .craft-go').click();
  expect(await page.evaluate(() => window.__game.inventory.count('curita'))).toBe(2);
  await expect(page.locator('#craft-panel .craft-reason')).toContainText('Me faltan 2 materiales');
  // Un panel abierto pausa el juego: cerrarlo antes de editar la apariencia.
  await page.keyboard.press('Escape');
  await page.keyboard.press('P');
  await expect(page.locator('#creator-modal')).toBeVisible();
  await expect(page.locator('#creator-title')).toHaveText('Su personaje');
  await page.locator('#creator-close').click();
  await expect(page.locator('#creator-modal')).toBeHidden();
});

test('ayuda bajo demanda, inventario y pausa sin abrir dos paneles al pulsar Escape', async ({ page }) => {
  await startNewGame(page);
  const help = page.locator('#controls-help-toggle');
  await expect(help).toHaveText('Ayuda');
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await help.click();
  await expect(page.locator('#controls-help-content')).toBeVisible();
  await expect(page.locator('#controls-help-content')).toContainText('El costal');
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('I');
  await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
  // El foco acompaña a la casilla elegida y el banco muestra su detalle.
  await expect(page.locator('#inv-overlay .inv-slot.selected')).toBeFocused();
  await expect(page.locator('#inv-overlay .inv-bench .inv-name')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.locator('#inv-overlay')).not.toHaveClass(/open/);
  await expect(page.locator('#menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-title')).toHaveText('Un momentico');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();

  // Accesos visibles en el juego: hacen lo mismo que I y C.
  await page.locator('#inventory-open').click();
  await expect(page.locator('#inv-overlay')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await page.locator('#craft-open').click();
  await expect(page.locator('#craft-panel')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#craft-panel')).not.toHaveClass(/open/);
  await expect(page.locator('#menu')).toBeHidden();
});

test('mapa con M, destino por clic y por la lista, ruta en el radar y pestañas de la pausa', async ({ page }) => {
  await startNewGame(page);
  await expect(page.locator('#minimap-canvas')).toBeVisible();
  await expect(page.locator('#minimap-info')).not.toBeEmpty();

  await page.keyboard.press('m');
  await expect(page.locator('#menu-title')).toHaveText('Un momentico');
  await expect(page.getByRole('tab', { name: /Mapa/ })).toHaveAttribute('aria-selected', 'true');
  const canvas = page.locator('.map-view__canvas');
  await expect(canvas).toBeVisible();
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/mapa.png` });

  // Clic sobre el mapa: marca destino y calcula ruta.
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * .3, box.y + box.height * .3);
  await expect.poll(() => page.evaluate(() => window.__game.gps.waypoint?.name)).toBeTruthy();
  await expect(page.locator('.map-view__dest strong')).toBeVisible();

  // Lista «Ir a…»: la recicladora reemplaza el destino y tiene ruta a pie.
  await page.locator('.map-view__place', { hasText: 'Recicladora' }).click();
  const route = await page.evaluate(() => ({ name: window.__game.gps.waypoint.name, points: window.__game.gps.route.length }));
  expect(route.name).toBe('Recicladora El Progreso');
  expect(route.points).toBeGreaterThan(1);
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/mapa-ruta.png` });

  // Q/E recorren las pestañas; M desde otra pestaña vuelve al mapa y desde el mapa cierra.
  await page.keyboard.press('e');
  await expect(page.getByRole('tab', { name: /Estado/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.pause-needs')).toBeVisible();
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/estado.png` });
  await page.keyboard.press('e');
  await expect(page.locator('.pause-settings')).toBeVisible();
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/ajustes.png` });
  await page.keyboard.press('e');
  await expect(page.locator('.pause-controls')).toContainText('Abrir / cerrar el mapa');
  await page.keyboard.press('m');
  await expect(page.getByRole('tab', { name: /Mapa/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('m');
  await expect(page.locator('#menu')).toBeHidden();

  await expect(page.locator('#minimap-info')).toContainText('Recicladora');
  await expect.poll(() => page.evaluate(() => window.__game.gpsBeacon.group.visible)).toBe(true);
  await page.waitForTimeout(400);
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/radar.png` });

  // Clic derecho en el mapa quita el destino.
  await page.keyboard.press('m');
  await page.locator('.map-view__canvas').click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__game.gps.waypoint)).toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
});

test('radar y mapa señalan lo que necesitas: M + Enter traza la ruta a la fogata gratis', async ({ page }) => {
  await startNewGame(page);
  // Cada sesión empieza a las 22:00 con llovizna: sin plata ni comida, lo que queda es la fogata.
  await page.evaluate(() => {
    const { stats, inventory } = window.__game;
    stats.dinero = 0; stats.calor = 0;
    inventory.items.length = 0;
  });
  await expect(page.locator('#minimap-info')).toContainText('Fogata de caneca');
  await expect(page.locator('#minimap-info')).toContainText('Calor gratis');
  await expect(page.locator('#minimap-info')).toHaveClass(/is-need/);
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/radar-necesidad.png` });

  await page.keyboard.press('m');
  const nearest = page.locator('.map-view__nearest');
  await expect(nearest).toHaveText('Ir al calor más cercano');
  await expect(nearest).toBeFocused();
  await expect(page.locator('.map-view__place', { hasText: 'Fogata de caneca' })).toHaveCount(1);
  await expect(page.locator('.map-view__place', { hasText: 'Gasolinera' })).toContainText('Solo referencia');
  const filterRows = await page.locator('.map-view__filter').evaluateAll(list => new Set(list.map(b => Math.round(b.getBoundingClientRect().top))).size);
  expect(filterRows).toBe(1);
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/mapa-necesidad.png` });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__game.gps.waypoint?.name)).toBe('Fogata de caneca');
  await expect(page.locator('.map-view__dest strong')).toContainText('Fogata de caneca');
  await expect(nearest).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.map-view__dest strong')).toContainText('Fogata de caneca');

  // Los filtros dejan solo lo que sirve y explican por qué no hay opción.
  await page.locator('.map-view__filter', { hasText: 'Agua' }).click();
  await expect(page.locator('.map-view__no-option')).toContainText('No alcanza: agua desde');
  await expect(page.locator('.map-view__place', { hasText: 'Fritanga La Mona' })).toContainText('sin plata');
  await page.locator('.map-view__filter', { hasText: 'Todo' }).click();
  await expect(page.locator('.map-view__no-option')).toHaveCount(0);

  // Espacio pulsa los botones del panel, aunque Input lo cancele para el salto.
  const heat = page.locator('.map-view__filter', { hasText: 'Calor' });
  await heat.focus();
  await page.keyboard.press('Space');
  await expect(heat).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.map-view__filter', { hasText: 'Todo' }).click();

  // Y también las pestañas, que están en el mismo menú.
  await page.getByRole('tab', { name: /Estado/ }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('tab', { name: /Estado/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /Mapa/ }).click();

  // Marcar un lugar no mueve el panel, que a esta altura se desplaza entero.
  const side = page.locator('.map-view__side');
  const fire = page.locator('.map-view__place', { hasText: 'Fogata de caneca' });
  await fire.scrollIntoViewIfNeeded();
  const scrolled = await side.evaluate(node => node.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  await fire.click();
  expect(await side.evaluate(node => node.scrollTop)).toBe(scrolled);

  // En teclado español, «+» es la tecla física de «]»: acerca el mapa y no cambia de pestaña.
  const mapZoom = () => page.evaluate(() => window.__game.mapView.zoom);
  const zoomBefore = await mapZoom();
  await page.locator('.map-view__canvas').dispatchEvent('keydown', { code: 'BracketRight', key: '+', bubbles: true });
  expect(await mapZoom()).toBeGreaterThan(zoomBefore);
  await expect(page.getByRole('tab', { name: /Mapa/ })).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('m');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#minimap-info')).toContainText('Fogata de caneca');
  await expect(page.locator('#minimap-info')).toHaveClass(/is-route/);

  // Y con el juego andando, «-» aleja el radar.
  const radarBase = () => page.evaluate(() => window.__game.minimap.zoomBase);
  const baseBefore = await radarBase();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Slash', key: '-' })));
  expect(await radarBase()).not.toBe(baseBefore);

  // E calienta junto a la fogata del callejón, entre ella y la mesa de crafteo, que se abre con C.
  await page.evaluate(() => {
    const { player, world, stats } = window.__game;
    const { x, z } = world.active.fireBarrels[1].position;
    player.position.set(x + 1, player.position.y, z);
    stats.calor = 0;
  });
  await expect.poll(() => page.evaluate(() => window.__game.interaction.currentTargetType)).toBe('fireBarrel');
  await page.locator('#game-canvas').click();
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => window.__game.stats.calor)).toBeGreaterThan(0);
});

test('volumen por categoría en Ajustes y pisadas al caminar', async ({ page }) => {
  await startNewGame(page);
  await page.locator('#game-canvas').click();
  await page.keyboard.down('w');
  // A pocos FPS en el navegador de pruebas, caminar unos metros produce las primeras pisadas.
  await expect.poll(() => page.evaluate(() => window.__game.audio._lastStep), { timeout: 30_000 }).toBeGreaterThanOrEqual(0);
  await page.keyboard.up('w');

  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-title')).toHaveText('Un momentico');
  await page.getByRole('tab', { name: /Ajustes/ }).click();
  for (const name of ['ambiente', 'tráfico', 'voces', 'efectos']) {
    await expect(page.getByRole('slider', { name: `Volumen de ${name}` })).toBeVisible();
  }
  await page.getByRole('slider', { name: 'Volumen de tráfico' }).fill('40');
  await expect.poll(() => page.evaluate(() => window.__game.audio.getMix('traffic'))).toBe(.4);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bazuko.audio_mix')).traffic)).toBe(.4);
  if (process.env.GPS_SHOTS) await page.screenshot({ path: `${process.env.GPS_SHOTS}/ajustes-sonido.png` });
});

test('salto en el bucle real, fabricación con costal lleno y llegada a un edificio', async ({ page }) => {
  await startNewGame(page);
  // El clic ahora inicia un golpe y bloquea el salto durante el ataque.
  // Esta prueba de movimiento empieza directamente con el teclado.
  await page.evaluate(() => {
    const player = window.__game.player;
    const probe = window.__jumpProbe = { start: player.position.y, peak: player.position.y, active: true };
    const sample = () => {
      probe.peak = Math.max(probe.peak, player.position.y);
      if (probe.active) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__jumpProbe.peak - window.__jumpProbe.start),
    { timeout: 30_000 }).toBeGreaterThan(.15);
  await expect.poll(() => page.evaluate(() => window.__game.player.isGrounded),
    { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => { window.__jumpProbe.active = false; });

  await page.keyboard.press('v');
  await expect.poll(() => page.evaluate(() => window.__game.cameraRig.mode)).toBe('isometric');
  for (const { z, key, goal } of [{ z: 25, key: 's', goal: 31 }, { z: 300, key: 'w', goal: 294 }]) {
    await page.evaluate(async (startZ) => {
      const { viaductSurface } = await import('/src/world/bogota/ColpatriaViaduct.js');
      const player = window.__game.player;
      player.position.set(75, viaductSurface(75, startZ), startZ);
      player.root.position.copy(player.position);
      player.velocity.set(0, 0, 0);
      player.resetGrounding();
    }, z);
    await page.keyboard.down('Shift');
    await page.keyboard.down(key);
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(({ startZ, goalZ }) => {
      const current = window.__game.player.position.z;
      return goalZ > startZ ? current >= goalZ : current <= goalZ;
    }, { startZ: z, goalZ: goal }), { timeout: 30_000 }).toBe(true);
    await page.keyboard.up(key);
    await page.keyboard.up('Shift');
    await expect.poll(() => page.evaluate(() => window.__game.player.isGrounded)).toBe(true);
    const landing = await page.evaluate(async () => {
      const { viaductSurface } = await import('/src/world/bogota/ColpatriaViaduct.js');
      const player = window.__game.player;
      return { layer: player.groundSurface.layer,
        gap: player.position.y - viaductSurface(player.position.x, player.position.z) };
    });
    expect(landing.layer).toBe('viaduct');
    expect(Math.abs(landing.gap)).toBeLessThan(.05);
  }
  await page.evaluate(() => {
    const game = window.__game;
    const { x, z } = game.world.active.reserved.spawn;
    game.player.position.set(x, game.world.active.getGroundHeight(x, z), z);
    game.player.root.position.copy(game.player.position);
    game.player.velocity.set(0, 0, 0);
    game.player.resetGrounding();
  });

  // Preparar materiales; fabricar mediante el panel real con los 20 kg ocupados.
  await page.evaluate(async () => {
    const { ITEMS } = await import('/src/data/items.js');
    const inventory = window.__game.inventory;
    inventory.deserialize({ items: [] });
    for (const [id, qty] of Object.entries({ chatarra: 2, cable: 1, madera: 1, lata: 78 })) {
      if (!inventory.add(ITEMS[id], qty)) throw new Error(`No se pudo preparar ${id}`);
    }
  });
  expect(await page.evaluate(() => window.__game.inventory.totalWeight)).toBe(20);
  await page.keyboard.press('c');
  await page.locator('.craft-recipe[data-id="arma"]').click();
  await expect(page.locator('.craft-go')).toBeEnabled();
  await page.locator('.craft-go').click();
  expect(await page.evaluate(() => window.__game.inventory.count('arma'))).toBe(1);
  expect(await page.evaluate(() => window.__game.inventory.totalWeight)).toBeCloseTo(16.8);
  await page.keyboard.press('Escape');

  // El marcador de Colpatria debe terminar en la misma acera que la ruta.
  await page.keyboard.press('m');
  await page.locator('.map-view__place', { hasText: 'Torre Colpatria' }).click();
  const destination = await page.evaluate(() => {
    const gps = window.__game.gps;
    return { accessible: gps.isRoutable(gps.waypoint.x, gps.waypoint.z),
      waypoint: gps.waypoint, end: gps.route.at(-1) };
  });
  expect(destination.accessible).toBe(true);
  expect(destination.end).toEqual({ x: destination.waypoint.x, z: destination.waypoint.z });
  await page.evaluate(({ x, z }) => {
    const game = window.__game;
    game.player.position.set(x, game.world.active.getGroundHeight(x, z), z);
    game.player.root.position.copy(game.player.position);
    game.player.resetGrounding();
  }, destination.end);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game.gps.waypoint)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__game.gpsBeacon.group.visible)).toBe(false);
});
