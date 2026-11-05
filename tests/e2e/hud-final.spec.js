import { test, expect } from '@playwright/test';

// Lo que se juega en el HUD, en el juego vivo y en cada anchura donde alguna vez se rompió.

async function readyGame(page) {
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Yolanda');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
}

const conModo = (page, modo) => page.evaluate(async (modo) => {
  const { ponerModo } = await import('/src/core/modoEntrada.js');
  ponerModo(modo, { fijar: true });
}, modo);

const cuadros = (page, n = 3) => page.evaluate((n) => new Promise((fin) => {
  const paso = () => (n-- > 0 ? requestAnimationFrame(paso) : fin());
  paso();
}), n);

const caja = (page, selector) => page.evaluate((s) => {
  const r = document.querySelector(s)?.getBoundingClientRect();
  return r && r.width > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
}, selector);

const seTocan = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Un objetivo de la tecla de contexto, quieto: el sistema de interacción no lo cambia mientras se mira. */
const conPrompt = (page, tipo = 'car') => page.evaluate((tipo) => {
  const i = window.__game.interaction;
  i.update = () => {};
  i.currentTarget = { traffic: true };
  i.currentTargetType = tipo;
}, tipo);

test('el radar dice qué hacer, con precio y a la vista, y con el dedo sin tecla', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await readyGame(page);
  // De día y con calor, para que lo que pida sea la sed.
  const conSed = (dinero) => page.evaluate((dinero) => {
    const g = window.__game;
    g.clock.hour = 12;
    g.stats.calor = 200;
    Object.assign(g.stats, { sed: 8, hambre: 90, energia: 90, salud: 90, dinero });
    g.inventory.clear();
  }, dinero);
  const sed = () => conSed(90000);
  const sinPlata = () => conSed(0);
  const orden = page.locator('.radar__orden');

  await sed();
  await expect(orden).toBeVisible();
  await expect(orden).toHaveText(/Agua\s*\$\s*[\d.]+/);

  await sinPlata();
  await expect(orden).toBeVisible();
  await expect(orden).toContainText('Sin plata: pida limosna');
  await expect(orden.locator('kbd')).toHaveText('B');

  for (const [width, height] of [[844, 390], [375, 812], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await conModo(page, 'tactil');
    await sinPlata();
    await expect(orden).toBeVisible();
    await expect(orden).toContainText('Sin plata');
    await expect(orden.locator('kbd')).toHaveCount(0);
    const o = await caja(page, '.radar__orden'), carton = await caja(page, '#hud-dock');
    expect(o.right).toBeLessThanOrEqual(carton.right + 1);
    expect(o.bottom).toBeLessThanOrEqual(carton.bottom + 1);
  }
});

test('la mesa da su aviso y abre el panel, con tecla y con el dedo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  const irALaMesa = () => page.evaluate(() => {
    const g = window.__game, m = g.craftingStation.position;
    g.player.position.set(m.x + 1, m.y, m.z + .4);
    g.player.resetGrounding?.();
  });
  await irALaMesa();
  await expect(page.locator('#interaction-prompt')).toContainText('Fabricar');
  await page.keyboard.press('e');
  await expect(page.locator('#craft-panel')).toBeVisible();
  await page.evaluate(() => window.__game.hud.toggleCraftPanel());
  await expect(page.locator('#craft-panel')).toBeHidden();

  await page.setViewportSize({ width: 375, height: 812 });
  await conModo(page, 'tactil');
  await irALaMesa();
  const cinta = page.locator('#interaction-prompt [data-tecla="KeyE"]');
  await expect(cinta).toContainText('Fabricar');
  await cinta.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true });
  await cinta.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true });
  await expect(page.locator('#craft-panel')).toBeVisible();
});

test('nada se tapa: Envión con Energía, tecla con Envión, y la tecla no va sobre el personaje', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await conPrompt(page); // primero: quieto el sistema, el Envión no se acaba mientras se mide
  await page.evaluate(() => { const i = window.__game.interaction; i.boostActive = true; i.boostTimer = 60; });
  for (const [width, height] of [[1440, 900], [1280, 800], [1100, 700], [1024, 700], [900, 600]]) {
    await page.setViewportSize({ width, height });
    await cuadros(page);
    const envion = await caja(page, '#boost-indicator');
    expect(envion, `Envión a ${width}`).not.toBeNull();
    expect(seTocan(envion, await caja(page, '#interaction-prompt')), `tecla sobre Envión a ${width}`).toBe(false);
    expect(seTocan(envion, await caja(page, '#hud-dock')), `Envión sobre el cartón a ${width}`).toBe(false);
  }
  await conModo(page, 'tactil');
  for (const [width, height] of [[844, 390], [760, 360], [375, 812], [360, 640], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await cuadros(page, 12);
    const envion = await caja(page, '#boost-indicator'), prompt = await caja(page, '#interaction-prompt');
    expect(envion, `Envión a ${width}`).not.toBeNull();
    expect(seTocan(envion, await caja(page, '[data-stat="energia"]')), `Envión sobre Energía a ${width}`).toBe(false);
    expect(seTocan(envion, await caja(page, '#hud-dock')), `Envión sobre el cartón a ${width}`).toBe(false);
    expect(seTocan(envion, prompt), `Envión con la tecla a ${width}`).toBe(false);
    // El personaje va en el centro: en la franja del 40 % al 60 % no cae nada de la tecla.
    expect(prompt.left, `tecla sobre el personaje a ${width}`).toBeGreaterThanOrEqual(width * .6 - 1);
    expect(prompt.top).toBeGreaterThanOrEqual(0);
  }
});

test('las filas críticas de Higiene y Vicio dicen qué hacer donde caben', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await page.evaluate(() => Object.assign(window.__game.stats, { higiene: 6, vicio: 8 }));
  await expect(page.locator('[data-stat="higiene"] .stat-bar__orden')).toBeVisible();
  await expect(page.locator('[data-stat="vicio"] .stat-bar__orden')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await conModo(page, 'tactil');
  await page.evaluate(() => Object.assign(window.__game.stats, { higiene: 6, vicio: 8 }));
  await expect(page.locator('[data-stat="higiene"] .stat-bar__orden')).toBeVisible();
  const carton = await caja(page, '#hud-dock'), orden = await caja(page, '[data-stat="higiene"] .stat-bar__orden');
  expect(orden.right).toBeLessThanOrEqual(carton.right);
});

test('el cosquilleo se lee: su ayuda va por fuera de la barra, sin tecla con el dedo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  // Todo de una: el minijuego corre, y si la persona se aleja se acaba solo.
  const abrir = () => page.evaluate(() => {
    const g = window.__game, npc = [...g.world.active.npcs][0];
    g.steal.startCosquilleo(npc);
    const rect = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const ayuda = document.querySelector('#steal-ayuda');
    const datos = { caja: rect('#steal-minigame'), pista: rect('#steal-track'), ayuda: rect('#steal-ayuda'), dock: rect('#hud-dock'), color: getComputedStyle(ayuda).color, texto: ayuda.textContent, teclas: [...ayuda.querySelectorAll('kbd')].map((k) => k.textContent), inline: document.querySelector('#steal-minigame').getAttribute('style') };
    g.steal._endMinigame(false, 'cancel');
    return datos;
  });
  const teclado = await abrir();
  expect(teclado.texto).toContain('Detener');
  expect(teclado.teclas).toContain('Espacio');
  expect(teclado.ayuda.top).toBeGreaterThanOrEqual(teclado.pista.bottom);
  expect(teclado.color).toBe('rgb(20, 17, 12)');
  expect(teclado.inline).toBeNull();
  await expect(page.locator('#steal-minigame')).toBeHidden();

  await page.setViewportSize({ width: 375, height: 812 });
  await conModo(page, 'tactil');
  const dedo = await abrir();
  expect(dedo.teclas).toEqual([]);
  expect(dedo.texto).toContain('Toque');
  expect(dedo.caja.left).toBeGreaterThanOrEqual(0);
  expect(dedo.caja.right).toBeLessThanOrEqual(375);
  expect(seTocan(dedo.caja, dedo.dock)).toBe(false);
});

test('a 320 con la patrulla encima el cartón se pliega y se ve la calle', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await readyGame(page);
  await conModo(page, 'tactil');
  const dockNormal = await caja(page, '#hud-dock');
  // Una patrulla de verdad, sostenida a 12 m delante del jugador.
  await page.evaluate(() => {
    const g = window.__game, t = g.traffic, v = t.vehicles.find((c) => c.police), p = g.player.position;
    t._startChase(v);
    const fijar = () => {
      v.car.position.set(p.x + 12, v.car.position.y, p.z);
      v._chaseDist = 12; v.state = 'chase'; v.chaseTime = 0;
      requestAnimationFrame(fijar);
    };
    fijar();
  });
  await expect(page.locator('#wanted')).toHaveAttribute('data-estado', 'encima');
  await expect(page.locator('#wanted')).toContainText('RRALE');
  const dock = await page.evaluate(() => ({ b: document.querySelector('#hud-dock').getBoundingClientRect().bottom, radar: getComputedStyle(document.querySelector('.radar__screen')).display, destino: document.querySelector('.radar__destino').getBoundingClientRect().height }));
  expect(dock.destino).toBeGreaterThan(0);
  expect(dock.radar).toBe('none');
  expect(dock.b).toBeLessThan(dockNormal.bottom);
  expect(dock.b).toBeLessThan(568 * .36);
});

test('el calor se ve mientras dura y se acaba solo', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await readyGame(page);
  await page.evaluate(() => { window.__game.stats.calor = 95; });
  await expect(page.locator('.disease-item--calor')).toBeVisible();
  await expect(page.locator('.disease-item--calor')).toContainText(/1:3\d|1:2\d/);
  for (const [width, height] of [[844, 390], [375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { window.__game.stats.calor = 95; });
    await expect(page.locator('.disease-item--calor')).toBeVisible();
  }
  await page.evaluate(() => { window.__game.stats.calor = 0; });
  await expect(page.locator('.disease-item--calor')).toHaveCount(0);
});

test('hablan dos o tres, los más cercanos, sin pisarse y dentro de la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  for (const [width, height, maximo] of [[1280, 800, 3], [375, 812, 2]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const g = window.__game, yo = g.player.position;
      const gente = [...(g.world.active.npcs ?? [])].sort((a, b) => a.position.distanceToSquared(yo) - b.position.distanceToSquared(yo)).slice(0, 6);
      const c = g.cameraRig.camera, adelante = c.getWorldDirection(c.position.clone());
      gente.forEach((n, i) => {
        n.position.set(yo.x + adelante.x * (2 + i) + (i - 2.5) * .5, n.position.y, yo.z + adelante.z * (2 + i));
        n.say('Hágase a un ladito, por favor, que voy de afán', 12);
      });
    });
    await page.waitForTimeout(600);
    const vistas = await page.evaluate(() => [...document.querySelectorAll('.npc-bubble')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => {
      const r = b.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }));
    expect(vistas.length).toBeGreaterThan(0);
    expect(vistas.length).toBeLessThanOrEqual(maximo);
    vistas.forEach((a, i) => {
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.right).toBeLessThanOrEqual(width);
      expect(a.top).toBeGreaterThanOrEqual(0);
      vistas.slice(i + 1).forEach((b) => expect(seTocan(a, b)).toBe(false));
    });
  }
});

test('la malilla no sacude la cámara ni reescribe la página en cada cuadro', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    g.stats.vicio = 0;
    await new Promise((f) => setTimeout(f, 600));
    let escrituras = 0;
    const raiz = document.getElementById('psychosis-overlay');
    const o = new MutationObserver((m) => { escrituras += m.length; });
    o.observe(raiz, { attributes: true, childList: true, subtree: true });
    const giros = [];
    const t0 = performance.now();
    await new Promise((fin) => {
      const paso = () => {
        giros.push(g.cameraRig.camera.rotation.z);
        if (performance.now() - t0 < 4000) requestAnimationFrame(paso); else fin();
      };
      paso();
    });
    o.disconnect();
    return { escrituras, giros, s: (performance.now() - t0) / 1000 };
  });
  const media = r.giros.reduce((a, b) => a + b, 0) / r.giros.length;
  const signos = r.giros.reduce((n, v, i) => n + (i && Math.sign(v - media) !== Math.sign(r.giros[i - 1] - media) && Math.abs(v - r.giros[i - 1]) > 1e-3 ? 1 : 0), 0);
  expect(signos / 2 / r.s, 'vueltas de la cámara por segundo').toBeLessThanOrEqual(.5);
  expect(r.escrituras / r.s, 'escrituras por segundo en la capa de la malilla').toBeLessThan(2);
});

test('con la pausa arriba el juego no se dibuja, y el mapa de la pausa sigue dibujándose', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await page.waitForTimeout(400);
  const dibujos = () => page.evaluate(() => new Promise((fin) => {
    const info = window.__game.renderer.instance.info.render, antes = info.frame;
    setTimeout(() => fin(info.frame - antes), 1500);
  }));
  await expect.poll(() => page.evaluate(() => window.__game.menu.opaco)).toBe(true);
  expect(await dibujos()).toBe(0);

  // El mapa se dibuja por su cuenta: se puede mover aunque el juego no se dibuje.
  await page.keyboard.press('KeyM');
  const lienzoMapa = page.locator('#menu canvas').first();
  await expect(lienzoMapa).toBeVisible();
  const marca = () => lienzoMapa.evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 97) s = (s + d[i] * (i % 13)) % 1000003; return { s, tinta: d.some((v, i) => i % 4 !== 3 && v > 0) }; });
  await expect.poll(async () => (await marca()).tinta).toBe(true);
  const antes = await marca();
  const b = await lienzoMapa.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 80, b.y + b.height / 2 + 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await marca()).s).not.toBe(antes.s);
  expect(await dibujos()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
  await expect.poll(dibujos).toBeGreaterThan(0);

  // Con la plana arriba tampoco, una vez impresa.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('police-arrest')));
  await expect(page.locator('#menu')).toHaveAttribute('data-momento', 'plana');
  await page.waitForTimeout(500);
  expect(await dibujos()).toBe(0);
});

test('una partida dañada no deja en la carga: se aparta sin borrarla y se empieza sin ella', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('sembrada')) {
      sessionStorage.setItem('sembrada', '1');
      localStorage.setItem('habitante-de-calle-save-v1', '{"pegado": no es json');
    }
  });
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => localStorage.getItem('habitante-de-calle-save-v1-danada'))).toBe('{"pegado": no es json');
});

test('la plana: se ve la persona, con cámara propia, y la del juego queda igual', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  await page.evaluate(() => {
    const g = window.__game, c = g.cameraRig.camera, r = g.renderer, render = r.render;
    window.dispatchEvent(new CustomEvent('police-arrest'));
    const foto = g._trasRender;
    const ver = () => [c.position.toArray(), c.quaternion.toArray(), c.fov];
    window.__foto = { camaras: 0 };
    g._trasRender = () => {
      window.__foto.antes = ver();
      r.render = function (scene, camara, ...resto) { if (camara !== c) window.__foto.camaras++; return render.call(r, scene, camara, ...resto); };
      foto();
      r.render = render;
      window.__foto.despues = ver();
    };
  });
  await expect(page.locator('#menu')).toHaveAttribute('data-momento', 'plana');
  await expect.poll(() => page.evaluate(() => {
    const c = document.querySelector('.plana__tinta');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v) => v > 0);
  })).toBe(true);
  const foto = await page.evaluate(() => window.__foto);
  expect(foto.camaras, 'la foto la toma una cámara propia').toBe(1);
  expect(foto.despues).toEqual(foto.antes);
  // Lo impreso es de punto fino, y en la foto hay una persona: la figura se tomó aparte.
  const celda = await page.evaluate(async () => {
    const { celdaDePlana } = await import('/src/ui/PrimeraPlana.js');
    return [celdaDePlana(320), celdaDePlana(1440)];
  });
  expect(celda).toEqual([4.5, 5]);
});

for (const [causa, titulo] of [['carro', 'Me llevó un carro'], ['golpe', 'TE CASCARON']]) {
  test(`tirado por ${causa}: «${titulo}», sin salirse a 320`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await readyGame(page);
    await page.evaluate((causa) => {
      const g = window.__game, d = g.player.position.clone().set(1, 0, .4);
      if (causa === 'carro') g.player.receiveVehicleImpact(d, 10);
      else { g.stats.salud = 30; g.player.receiveHit(d, 2, { salud: 30 }); }
    }, causa);
    await expect(page.locator('#cascado')).toBeVisible();
    await expect(page.locator('#cascado strong')).toHaveText(titulo);
    const c = await caja(page, '#cascado strong');
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.right).toBeLessThanOrEqual(320);
  });
}

test('la plata se mueve de verdad: vender sube, comprar baja, armar gasta', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  const plata = () => page.evaluate(() => window.__game.stats.dinero);
  const menus = '/src/ui/placeMenus.js';

  await page.evaluate(async (menus) => {
    const g = window.__game, { ITEMS } = await import('/src/data/items.js');
    g.stats.dinero = 1000;
    g.inventory.clear();
    g.inventory.add(ITEMS.lata, 2);
    (await import(menus)).openRecycler(g);
  }, menus);
  await page.getByRole('button', { name: /Vender todo/ }).click();
  expect(await plata()).toBeGreaterThan(1000);
  expect(await page.evaluate(() => window.__game.inventory.count('lata'))).toBe(0);
  await page.evaluate(() => window.__game.menu.close());

  await page.evaluate(async (menus) => {
    const g = window.__game;
    g.stats.dinero = 90000;
    (await import(menus)).openShop(g);
  }, menus);
  await page.getByRole('button', { name: 'Comprar', exact: true }).first().click();
  expect(await plata()).toBeLessThan(90000);
  await page.evaluate(() => window.__game.menu.close());

  const materiales = await page.evaluate(async (menus) => {
    const g = window.__game, { ITEMS } = await import('/src/data/items.js');
    g.built.base = false;
    g.inventory.clear();
    g.inventory.add(ITEMS.carton, 20);
    (await import(menus)).openCambuche(g);
    return g.inventory.count('carton');
  }, menus);
  await page.getByRole('button', { name: 'Armar', exact: true }).first().click();
  const queda = await page.evaluate(() => [window.__game.inventory.count('carton'), window.__game.built.base]);
  expect(queda[0]).toBeLessThan(materiales);
  expect(queda[1]).toBe(true);
});

test('quieto, en la página casi no se escribe nada: se compara antes de escribir', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await readyGame(page);
  const escrituras = () => page.evaluate(async () => {
    let n = 0;
    const quien = {};
    const o = new MutationObserver((m) => {
      for (const r of m) {
        const clave = r.target?.id || r.target?.className || r.target?.parentElement?.id || r.type;
        quien[clave] = (quien[clave] ?? 0) + 1;
      }
      n += m.length;
    });
    o.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true });
    await new Promise((f) => setTimeout(f, 4000));
    o.disconnect();
    return { porSegundo: n / 4, quien };
  });
  await page.waitForTimeout(1500);
  const quieto = await escrituras();
  expect(quieto.porSegundo, JSON.stringify(quieto.quien)).toBeLessThan(6);
  await page.evaluate(() => { const g = window.__game; g.stats.vicio = 0; });
  await page.waitForTimeout(1500);
  const conMalilla = await escrituras();
  expect(conMalilla.porSegundo, JSON.stringify(conMalilla.quien)).toBeLessThan(12);
});
