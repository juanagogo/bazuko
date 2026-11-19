// tests/e2e/voces.spec.js
// Lo que dice la gente al pasar, en el juego de verdad: al cargar no se piden las voces de golpe; quien está al lado
// dice una frase con la voz de su papel, el mp3 llega, sale su burbuja y la consola queda limpia.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()); });

const esVoz = (url) => url.includes('/audio/voces/');

test('quien pasa cerca dice una frase grabada con su burbuja, y las voces se piden de a pocas', async ({ page }) => {
  const errores = [];
  const pedidas = [];
  const llegadas = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
  page.on('pageerror', (err) => errores.push(String(err)));
  page.on('request', (r) => { if (esVoz(r.url())) pedidas.push(r.url()); });
  page.on('response', (r) => { if (esVoz(r.url())) llegadas.push({ url: r.url(), status: r.status() }); });

  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  // Cargado el juego, ninguna voz pedida todavía: se piden al hablar.
  expect(pedidas).toEqual([]);
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__game.audio.howler.ctx?.state)).toBe('running');

  // El Chato anda por el punto de arranque: se le manda lejos para que no estorbe.
  // Se trae a 2 m a una persona con frase de ambiente grabada para su papel.
  const persona = await page.evaluate(() => {
    const g = window.__game, p = g.player.position, a = g.audio;
    if (g.dog) { g.dog.position.set(p.x + 25, g.dog.position.y, p.z + 25); g.dog._wanderTarget = null; }
    const gente = g.world.active.npcs.filter((n) => n.person && !n.isVendor && !n.fijo && !n.koState && !n._disposed &&
      n.look?.real && !['sentado', 'acurrucado', 'banca', 'pedir', 'dormido'].includes(n.stance));
    gente.sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));
    const n = gente.find(n => a.voces.frasesPara(n).length && a.voces.reparto.disponible(n, a.voces.vozDe(n)));
    if (!n) throw new Error('Hace falta una persona libre con voz de ambiente');
    n.position.set(p.x + 2, g.world.active.getMovementGroundHeight(p.x + 2, p.z, p.y), p.z);
    n.root.position.copy(n.position);
    n.target = null; n.route = []; n.wait = 99;
    n._bubbleEl?.remove(); n._bubbleEl = null;
    for (const otra of gente) if (otra !== n && otra.position.distanceTo(p) < 7) { otra.position.x += 15; otra.root.position.copy(otra.position); }
    window.__npc = n;
    a.streetVoices.cancel(); a.conversations.cancel(); a.vehicles.stopRemarks();
    a.voces._nextAmbient = 0;
    return { arquetipo: n.person.arquetipo, sexo: n.look.real.sexo, voz: a.voces.vozDe(n) };
  });

  const sonando = () => page.evaluate(() => {
    const v = window.__game.audio.voces._voz;
    const src = v?.sound._src;
    return v?.entry.situacion === 'ambiente' && v.sound.playing(v.id)
      ? { src: typeof src === 'string' ? src : src?.[0], text: v.entry.text, voz: v.entry.voz, quien: v.source === window.__npc } : null;
  });
  let frase;
  await expect.poll(async () => { frase = await sonando(); return frase; }, { timeout: 20_000 }).not.toBeNull();
  expect(frase.quien).toBe(true);
  expect(frase.voz).toBe(persona.voz);
  expect(frase.src).toMatch(new RegExp(`/audio/voces/${persona.voz}_ambiente_\\d+\\.mp3$`));
  await expect.poll(() => llegadas.find((l) => l.url.endsWith(frase.src.split('/').pop()))?.status).toBe(200);

  // Su burbuja dice la frase.
  const burbuja = page.locator('.npc-bubble', { hasText: frase.text });
  await expect(burbuja).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: test.info().outputPath('voz-burbuja.png') });

  // Cada papel cercano precarga como máximo cuatro tomas de ambiente. La calle también prepara reacciones al acercarse.
  const ambiente = new Map();
  for (const url of pedidas) {
    const voz = new URL(url).pathname.match(/\/audio\/voces\/(.+)_ambiente_\d+\.mp3$/)?.[1];
    if (voz) ambiente.set(voz, (ambiente.get(voz) ?? 0) + 1);
  }
  expect(ambiente.has(persona.voz)).toBe(true);
  expect(ambiente.size).toBeLessThanOrEqual(3);
  for (const [voz, cantidad] of ambiente) expect(cantidad, voz).toBeLessThanOrEqual(4);
  expect(llegadas.every((l) => l.status === 200 || l.status === 206 || l.status === 304)).toBe(true);
  expect(errores).toEqual([]);
  console.log(`[voces] ${persona.arquetipo} ${persona.sexo} → ${persona.voz}: «${frase.text}», ${pedidas.length} audios pedidos, ambiente de ${[...ambiente.keys()].join(', ')}`);
});
