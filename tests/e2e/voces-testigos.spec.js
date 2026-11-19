// tests/e2e/voces-testigos.spec.js
// Un cosquilleo que sale mal delante de alguien, en el juego de verdad: mientras el jugador está junto a la víctima
// se piden las voces de quien lo vería; el testigo que llama a la Policía lo dice con su voz grabada, el mp3 llega,
// sale su burbuja con esa frase y la consola queda limpia.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    let semilla = 89123;
    Math.random = () => ((semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0) / 4294967296);
  });
});

const esVoz = (url) => url.includes('/audio/voces/');

test('el testigo que llama a la Policía lo dice con su voz grabada y su burbuja', async ({ page }) => {
  test.setTimeout(300_000);
  const errores = [];
  const llegadas = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
  page.on('pageerror', (err) => errores.push(String(err)));
  page.on('response', (r) => { if (esVoz(r.url())) llegadas.push({ url: r.url(), status: r.status() }); });

  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__game.audio.howler.ctx?.state)).toBe('running');

  // Delante de la cámara: la víctima a poco más de 1 m del jugador y, a unos 2,7 m, alguien cuya voz tiene frase para
  // llamar, el testigo más cercano. Elegimos a quien suele mantener la calma para oír la frase tras el grito
  // de la víctima. Un miedoso puede soltar el celular antes de que le llegue el turno.
  const testigo = await page.evaluate(async () => {
    const { timbreDe } = await import('/src/systems/voces/identidad.js');
    const g = window.__game, d = g.world.active, voces = g.audio.voces, p = g.player.position;
    g.clock.hour = 12;
    g.traffic.alertForTheft = () => false; // que ninguna patrulla lo vea: aquí solo cuenta el testigo
    // El Chato anda por el punto de arranque: lejos.
    if (g.dog) { g.dog.home?.set?.(p.x + 25, 0, p.z + 25); g.dog.position.set(p.x + 25, g.dog.position.y, p.z + 25); g.dog._wanderTarget = null; }
    const c = g.cameraRig.camera, f = c.getWorldDirection(c.position.clone());
    f.y = 0; f.normalize();
    const der = { x: -f.z, z: f.x };
    const libres = d.npcs.filter((n) => n.person && n.look?.real && !n.isVendor && !n.fijo && !n.koState && !n._disposed
      && !['sentado', 'acurrucado', 'banca', 'pedir', 'dormido'].includes(n.stance));
    const testigos = libres.filter(n => n.mind?.temper.tipo === 'indiferente' && voces.frasesTestigo(n, 'llamar').length);
    const victimas = libres.filter(n => voces.frasesRobo(n, 'pillado').length);
    const timbre = n => timbreDe(voces.vozDe(n));
    const t = testigos.find(n => victimas.some(v => timbre(v) !== timbre(n)));
    if (!t) throw new Error(`La población contiene ${testigos.length} testigos tranquilos y ${victimas.length} víctimas con grabación, sin una pareja de timbres distintos`);
    const v = victimas.find(n => timbre(n) !== timbre(t));
    const poner = (n, adelante, lado) => {
      const px = p.x + f.x * adelante + der.x * lado, pz = p.z + f.z * adelante + der.z * lado;
      n.position.set(px, d.getGroundHeight(px, pz), pz); n.root.position.copy(n.position);
      n.target = null; n.route = []; n.wait = 99; n.fleeTimer = 0; n._lastSpokenTime = performance.now();
      n.mind?.reset();
      n._bubbleEl?.remove(); n._bubbleEl = null;
    };
    for (const otra of libres) if (otra !== t && otra !== v && otra.position.distanceTo(p) < 8) { otra.position.x += 12; otra.root.position.copy(otra.position); }
    poner(v, 1.2, -.6);
    poner(t, 2.5, 1);
    window.__victima = v;
    window.__testigo = t;
    return { voz: voces.vozDe(t), vozVictima: voces.vozDe(v), arquetipo: t.person.arquetipo, sexo: t.look.real.sexo,
      frase: voces.frasesTestigo(t, 'llamar')[0].id, gritos: voces.frasesRobo(v, 'pillado').map(frase => frase.id) };
  });

  // Junto a la víctima (el aviso de E y Q a la vista) se piden las voces del testigo: su llamada queda cargada.
  await expect.poll(() => page.evaluate(({ frase, gritos }) => {
    const cargada = id => window.__game.audio.voces._sounds.get(`voces/${id}.mp3`)?.state() === 'loaded';
    return cargada(frase) && gritos.some(cargada);
  }, testigo), { timeout: 30_000 }).toBe(true);

  // El cosquilleo de verdad, con la barra fallada y la víctima que se da cuenta.
  const llamada = await page.evaluate(() => {
    const g = window.__game;
    g.witnesses.random = () => 0;
    g.witnesses._cooldown = 0;
    const azar = Math.random;
    Math.random = () => 0;
    try { g.steal.targetNpc = window.__victima; g.steal._endMinigame(false, 'play'); } finally { Math.random = azar; }
    const voz = g.audio.voces._voz;
    return {
      llama: g.witnesses.calls[0]?.npc === window.__testigo,
      vozVictima: voz?.source === window.__victima && voz.sound.playing(voz.id) ? voz.entry.voz : null,
      enEspera: g.audio.voces._enEspera?.source === window.__testigo
    };
  });
  expect(llamada).toEqual({ llama: true, vozVictima: testigo.vozVictima, enEspera: true });

  // Tras el grito de la víctima se comprueba la toma que realmente está sonando.
  let r;
  await expect.poll(async () => {
    r = await page.evaluate(frase => {
      const v = window.__game.audio.voces._voz;
      if (!v || !v.sound.playing(v.id) || v.source !== window.__testigo || v.entry.id !== frase) return null;
      const src = v.sound._src;
      return { id: v.entry.id, voz: v.entry.voz, text: v.entry.text, src: typeof src === 'string' ? src : src?.[0] };
    }, testigo.frase);
    return r !== null;
  }, { timeout: 6_000 }).toBe(true);
  expect(r.voz).toBe(testigo.voz);
  expect(r.id).toBe(testigo.frase);
  expect(r.src).toMatch(new RegExp(`/audio/voces/${testigo.frase}\\.mp3$`));
  await expect.poll(() => llegadas.find((l) => l.url.endsWith(`${testigo.frase}.mp3`))?.status).toBe(200);

  // Su burbuja dice la frase grabada.
  await expect(page.locator('.npc-bubble', { hasText: r.text })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('body')).toContainText('llamando a la Policía');
  await page.screenshot({ path: test.info().outputPath('testigo-voz-burbuja.png') });

  expect(llegadas.every((l) => l.status === 200 || l.status === 206 || l.status === 304)).toBe(true);
  expect(errores).toEqual([]);
  console.log(`[voces-testigos] ${testigo.arquetipo} ${testigo.sexo} → ${testigo.voz}: «${r.text}»; voces pedidas ${llegadas.length}`);
});
