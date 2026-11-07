import { test, expect } from '@playwright/test';

// Las voces de la calle con el juego real: las situaciones nuevas suenan (o esperan a cargar y suenan), el
// vocalizador no pasa de su límite, los subtítulos salen y el arresto se oye con el juego en pausa.

async function readyGame(page, errores) {
  page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
  page.on('pageerror', (err) => errores.push(String(err)));
  await page.goto('/');
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Yolanda');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__game.audio.howler.ctx?.state)).toBe('running');
  // El audio sale de la pausa del menú en el primer cuadro de juego.
  await expect.poll(() => page.evaluate(() => window.__game.audio._paused)).toBe(false);
}

/** Trae a la persona más cercana a `metros` del jugador y la deja quieta ahí. */
const acercar = (page, metros = 2, filtro = 'true') => page.evaluate(([m, f]) => {
  const g = window.__game, p = g.player.position;
  const ok = new Function('n', `return ${f}`);
  const gente = g.world.active.npcs.filter((n) => !n.vozArquetipo && !n.isVendor && !n.koState && n.look?.real && ok(n));
  gente.sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));
  const n = gente[0];
  n.position.set(p.x + m, n.position.y, p.z);
  n.root.position.copy(n.position);
  n.target = null; n.route = []; n.wait = 99;
  window.__npc = n;
  return { sexo: n.look.real.sexo, voz: n._voz ?? null };
}, [metros, filtro]);

/** La ruta de la voz que suena o espera a cargar, hasta que una empiece. */
const vozQueSuena = (page) => page.evaluate(() => {
  const a = window.__game.audio;
  const v = a._npcVoice;
  return v && v.sound.playing(v.id) ? v.sound._src?.[0] ?? v.sound._src : null;
});

test('las situaciones nuevas suenan, el vocalizador respeta su límite y los subtítulos salen', async ({ page }) => {
  const errores = [];
  await readyGame(page, errores);

  // Limosna con plata: quien está al lado contesta con una frase de begYes de su voz, o hace su «mmm».
  await acercar(page, 2);
  await page.waitForTimeout(300); // que el juego mida la distancia nueva
  await page.evaluate(() => {
    const n = window.__npc, a = window.__game.audio;
    window.__dichos = [];
    const decir = n.speakScenario.bind(n);
    n.speakScenario = (c, f) => { const r = decir(c, f); window.__dichos.push([c, r, a.lastRefusal, a.vocalizador.activos]); return r; };
    a._silenceVoices();
    window.dispatchEvent(new CustomEvent('beg-result', { detail: { success: true, money: 800 } }));
  });
  const dichos = await page.evaluate(() => window.__dichos);
  expect(dichos.length).toBe(1);
  expect(dichos[0][0]).toBe('begYes');
  // Con frase propia suena (o espera a cargar); sin ella, su «mmm» con su tono.
  expect(dichos[0][1] || dichos[0][3] > 0).toBe(true);

  // El vocalizador: dos reacciones a la vez como mucho, y se sueltan solas al terminar.
  const limite = await page.evaluate(() => {
    const g = window.__game, voc = g.audio.vocalizador, p = g.player.position;
    voc.callar();
    // Personas nuevas: quien acaba de hacer su gesto (la limosna) espera 1,2 s y no probaría el cupo.
    const gente = [1, 2, 3].map((x) => ({ position: p.clone().setX(p.x + x), look: { real: { sexo: 'mujer' } } }));
    return gente.map((n) => voc.decir(n, 'ay'));
  });
  expect(limite).toEqual([true, true, false]);
  await expect.poll(() => page.evaluate(() => window.__game.audio.vocalizador.activos), { timeout: 3000 }).toBe(0);

  // Todos los gestos se pueden tocar sin errores, con la voz de una mujer y de un hombre.
  const gestos = await page.evaluate(async () => {
    const voc = window.__game.audio.vocalizador, p = window.__game.player.position;
    const out = [];
    for (const g of ['ay', 'ay_fuerte', 'ey', 'uy', 'uf', 'jaja', 'mmm', 'mmm_no', 'murmullo', 'ronquido']) {
      for (const sexo of ['mujer', 'hombre']) {
        voc.callar();
        window.__game.audio._silenceVoices();
        out.push(voc.decir({ position: p.clone().setX(p.x + 2), look: { real: { sexo } } }, g));
        await new Promise((r) => setTimeout(r, 30));
      }
    }
    voc.callar();
    return out;
  });
  expect(gestos.every(Boolean)).toBe(true);

  // Subtítulo de la patrulla: la frase sale en una burbuja cuando de verdad suena.
  await page.evaluate(() => { window.__game.audio._silenceVoices(); window.__game.audio._pendingVoice = null; });
  const dicho = await page.evaluate(() => {
    const g = window.__game, wv = g.audio.worldVoices;
    const frase = wv._line('grito', 'policia_a');
    const sitio = { position: g.player.position.clone().setZ(g.player.position.z + 4) };
    wv._say(frase, sitio.position, { range: 26, level: .95, priority: 75, source: sitio });
    return frase.text;
  });
  await expect(page.locator('#npc-bubbles-container .npc-bubble', { hasText: dicho })).toBeVisible({ timeout: 8000 });

  // Atropello: la víctima grita (o se queja) y un testigo cercano reacciona un momento después.
  await page.evaluate(() => { window.__game.audio._silenceVoices(); });
  await acercar(page, 3);
  const atropello = await page.evaluate(async () => {
    const g = window.__game, victima = window.__npc, director = g.voces;
    const { GESTO_POR_CATEGORIA } = await import('/src/data/vocesReuso.js');
    const uy = GESTO_POR_CATEGORIA.witnessRunOver;
    // Alguien despierto y suelto (sin pareja ni banca): ni murmura ni ronca, y el director lo puede escoger.
    const otro = g.world.active.npcs.find((n) => n !== victima && !n.koState && !n.isVendor && n.look?.real && n.stance !== 'dormido' && !n.fijo);
    if (!otro) return { otro: false };
    // Pegado a la víctima: el testigo más cercano al atropello es él.
    otro.position.set(victima.position.x, otro.position.y, victima.position.z + 1.2); otro.root.position.copy(otro.position);
    otro.wait = 99; otro.target = null; otro.route = [];
    window.__testigo = otro;
    otro._lastVoiceTime = 0;
    // Solo cuenta lo que sale mientras el director atiende el atropello: escoge al testigo (con la víctima aparte) y
    // en ese mismo paso le hace decir su frase o su «uy». Lo demás (murmullos, ronquidos, sustos) no cuenta.
    window.__reaccion = null; window.__elegido = null; window.__enAtropello = false;
    const escoger = director._masCercana.bind(director);
    director._masCercana = (alcance, filtro, desde, excepto) => {
      const r = escoger(alcance, filtro, desde, excepto);
      if (excepto === victima) {
        window.__elegido ??= r === otro ? 'otro' : String(r?.name ?? r);
        window.__enAtropello = true;
        queueMicrotask(() => { window.__enAtropello = false; });
      }
      return r;
    };
    const voc = g.audio.vocalizador, gesto = voc.decir.bind(voc), decir = otro.speakScenario.bind(otro);
    voc.decir = (n, ...rest) => {
      const r = gesto(n, ...rest);
      if (n === otro && r && rest[0] === uy && window.__enAtropello) window.__reaccion ??= `gesto ${rest[0]}`;
      return r;
    };
    otro.speakScenario = (c, f) => {
      const r = decir(c, f);
      if (r && c === 'witnessRunOver' && window.__enAtropello) window.__reaccion ??= `frase ${g.audio.lastRefusal ?? 'suena'}`;
      return r;
    };
    victima.hitByCar({ x: victima.position.x + 1, z: victima.position.z }, 3);
    return { otro: true };
  });
  expect(atropello.otro).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__reaccion), { timeout: 6000 }).not.toBeNull();
  expect(await page.evaluate(() => window.__elegido)).toBe('otro');

  expect(errores).toEqual([]);
});

test('el arresto se oye con el juego en pausa y la tienda saluda con el menú abierto', async ({ page }) => {
  const errores = [];
  await readyGame(page, errores);
  // Una patrulla al lado del jugador; el arresto pausa el juego en el mismo evento.
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const patrulla = g.traffic.vehicles.find((v) => v.police);
    window.__patrulla = patrulla;
    g.audio._silenceVoices(); g.audio._pendingVoice = null;
    // El oyente queda junto a la patrulla: WorldVoices la busca a menos de 35 m.
    p.set(patrulla.car.position.x + 3, p.y, patrulla.car.position.z);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('police-arrest')));
  await expect(page.locator('#menu-title')).toHaveText('Te atrapó la Policía');
  await expect.poll(() => page.evaluate(() => {
    const a = window.__game.audio, v = a._npcVoice;
    return a._paused && !!v && /arresto/.test(String(v.sound._src)) && v.sound.playing(v.id);
  }), { timeout: 6000 }).toBe(true);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);

  // La tienda: el menú pausa el juego y Doña Rosa saluda igual.
  await page.evaluate(() => {
    const g = window.__game;
    g.audio._silenceVoices(); g.audio._pendingVoice = null;
    g.stats.higiene = 80;
    const pos = g.shop.group.position;
    g.player.position.set(pos.x + 2, g.player.position.y, pos.z);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-shop', { detail: { target: window.__game.shop } })));
  await expect.poll(() => page.evaluate(() => {
    const a = window.__game.audio, v = a._npcVoice;
    return window.__game.paused && !!v && /vendedora_ambiente/.test(String(v.sound._src)) && v.sound.playing(v.id);
  }), { timeout: 6000 }).toBe(true);
  expect(errores).toEqual([]);
});

test('quien dijo una frase de la calle conserva su voz, y el reclamo del espejo sigue al cuerpo solo si se baja', async ({ page }) => {
  const errores = [];
  await readyGame(page, errores);

  // Un hombre con voz del reparto dice una frase de la calle y, robado después, contesta con la suya.
  // Solo voces que tienen frase grabada de «robado» (vendedor y roberto no la tienen: ellos dicen la vocalización).
  await page.evaluate(async () => {
    const { NPC_VOICE_BANK } = await import('/src/data/npcVoices.js');
    window.__vocesRobado = new Set(NPC_VOICE_BANK.robbed.map((e) => e.voz).filter(Boolean));
  });
  await acercar(page, 2, "n.look.real.sexo === 'hombre' && window.__vocesRobado.has(n._castVoice())");
  const calle = await page.evaluate(async () => {
    const g = window.__game, a = g.audio, n = window.__npc;
    a._silenceVoices(); a._pendingVoice = null;
    n._bubbleEl?.remove(); n._bubbleEl = null; n._vozOida = false;
    a.streetVoices._nextAt = 0;
    const sv = a.streetVoices;
    const estado = { pausa: sv.paused, ext: sv.externalVoiceActive(), cargadas: Object.values(sv.bank).map((s) => s.state()) };
    sv.update(g.player.position, [n], performance.now() + 1e7);
    const dijo = sv._voice?.npc === n;
    if (!dijo) return { dijo, estado };
    a._silenceVoices();
    const { NPC_VOICE_BANK } = await import('/src/data/npcVoices.js');
    const pedidas = [];
    const pedir = a.playNpcVoice.bind(a);
    a.playNpcVoice = (path, owner, opts) => { if (owner === n) pedidas.push(path); return pedir(path, owner, opts); };
    n._lastVoiceTime = 0;
    n.speakScenario('robbed', true);
    a.playNpcVoice = pedir;
    const entry = NPC_VOICE_BANK.robbed.find((e) => e.audio === pedidas[0]);
    return { dijo, voz: n._voz, cast: n._castVoice(), entryVoz: entry?.voz ?? null, pedidas: pedidas.length };
  });
  expect(JSON.stringify(calle)).toContain('"dijo":true');
  expect(calle.voz).toBe(calle.cast);
  expect(calle.pedidas).toBe(1);
  expect(calle.entryVoz).toBe(calle.voz);

  // El espejo: el reclamo sale con la voz del carro si nadie se baja, y con una del sexo de quien se baja si sí.
  await expect.poll(() => page.evaluate(() => !!window.__game.roadRage.driver?.look?.real?.sexo), { timeout: 30_000 }).toBe(true);
  const espejo = await page.evaluate(async () => {
    const g = window.__game, a = g.audio, rr = g.roadRage;
    const { sexoDeConductor } = await import('/src/systems/VehicleAudio.js');
    const sexo = rr.driver.look.real.sexo, otra = sexo === 'mujer' ? 'roberto' : 'valentina';
    const libres = g.traffic.vehicles.filter((v) => !v.police && !v.isBus && v.dwellRemaining === undefined && v.car?.traffic && !a.vehicles.heard(v.car));
    const robar = (car) => {
      a._silenceVoices(); a._pendingVoice = null;
      a.vehicles.setDriverVoice(car, otra);
      g.player.position.set(car.position.x + 2, g.player.position.y, car.position.z);
      a.updateWorld(.016, g.player.position, null, g.traffic.vehicles);
      const sono = a.playMovingTheft(car);
      window.dispatchEvent(new CustomEvent('mirror-stolen', { detail: { car } }));
      const v = a._theftVoices.get(car);
      return { sono, voz: a.vehicles.driverVoice(car), linea: v ? a.theftVoices[a.theftSounds.indexOf(v.sound)] : null, suena: !!v?.sound.playing(v.id) };
    };
    const azar = rr.random;
    rr.random = () => .99;              // nadie se baja
    const solo = robar(libres[0].car);
    rr.random = () => 0;                // se baja
    const baja = robar(libres[1].car);
    rr.random = azar;
    return { sexo, otra, solo, baja, bajoDe: rr.vehicle?.car === libres[1].car, sexoBaja: sexoDeConductor(baja.voz), sexoLinea: sexoDeConductor(baja.linea), sexoSolo: sexoDeConductor(solo.linea) };
  });
  expect(espejo.solo.sono).toBe(true);
  expect(espejo.solo.voz).toBe(espejo.otra);
  expect(espejo.bajoDe).toBe(true);
  expect(espejo.baja.sono).toBe(true);
  expect(espejo.sexoBaja).toBe(espejo.sexo);
  expect(espejo.baja.suena).toBe(true);
  expect(espejo.sexoLinea).toBe(espejo.sexo); // la grabación que suena es de una voz de su sexo
  expect(espejo.sexoSolo).not.toBe(espejo.sexo); // y sin nadie que se baje, la del carro (del otro sexo)
  expect(errores).toEqual([]);
});
