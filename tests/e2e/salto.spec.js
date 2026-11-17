import { test, expect } from '@playwright/test';

// Salto, caída y aterrizaje medidos cuadro a cuadro con dt fijo (tools/animacion): el ápice, que ningún
// hueso principal salte de velocidad angular más de TIRON_MAX rad/s entre dos cuadros y que se apoye
// con el pie de delante. Antes de este cambio los aterrizajes daban 86-94 rad/s; los clips de andar y
// correr llegan solos a ~18 y un aterrizaje continuo, a ~45 (la rodilla empieza a doblarse al tocar).
const TIRON_MAX = 55;

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()); });

async function start(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
}

/**
 * Detiene el bucle de la partida y mueve al jugador con `_updatePlayerMovement` (suelo, colisiones y
 * capas reales) a 60 FPS fijos. `guion(i)` devuelve las teclas oprimidas en el cuadro i y si Espacio
 * se acaba de pulsar. Devuelve el resumen de medidas.js y los pies al tocar el suelo.
 */
async function jumpInGame(page, { x, z, cuadros, guion }) {
  return page.evaluate(async ({ x, z, cuadros, guion }) => {
    const { analizarSalto, analizarTirones } = await import('/tools/animacion/medidas.js');
    const game = window.__game, player = game.player, input = game.input;
    game._running = false;
    if (game.dog) { game.dog.home?.set?.(x + 25, 0, z + 25); game.dog.position?.set?.(x + 25, 0, z + 25); game.dog._wanderTarget = null; }
    player.position.set(x, game.world.active.getGroundHeight(x, z), z);
    player.root.position.copy(player.position); player.root.rotation.set(0, Math.PI / 2, 0);
    player.velocity.set(0, 0, 0); player.resetGrounding(); player.action = null;
    game.cameraRig.mode = 'isometric';
    const names = ['Hips', 'Spine', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'];
    const bones = names.map(n => [n, player.character.group.getObjectByName(`mixamorig${n}`)]).filter(([, b]) => b);
    // Tobillos: al pisar, el pie de delante entra de talón y el de atrás ya despega.
    const ankles = ['LeftFoot', 'RightFoot'].map(n => player.character.group.getObjectByName(`mixamorig${n}`));
    const frames = [];
    let touch = null;
    const steps = new Function('i', `return (${guion})(i)`);
    for (let i = -30; i < cuadros; i++) {
      const { teclas = [], pulsar = false } = i < 0 ? {} : steps(i);
      input.keys = Object.fromEntries(teclas.map(k => [k, true]));
      if (pulsar) { input.pressedThisFrame.add('Space'); input.pressedThisFrame.add('KeySpace'); }
      const wasGrounded = player.isGrounded;
      game._updatePlayerMovement(1 / 60);
      input.endFrame();
      if (i < 0) continue;
      player.root.updateMatrixWorld(true);
      frames.push({ dt: 1 / 60, y: player.position.y, enSuelo: player.isGrounded, huesos: Object.fromEntries(bones.map(([n, b]) => [n, b.quaternion.toArray()])) });
      if (!wasGrounded && player.isGrounded && !touch && ankles.every(Boolean)) {
        const v = player.velocity.clone().setY(0).normalize();
        const [l, r] = ankles.map(t => t.getWorldPosition(t.position.clone()));
        const [front, back] = l.dot(v) > r.dot(v) ? [l, r] : [r, l];
        touch = { split: front.dot(v) - back.dot(v), frontLower: front.y - back.y };
      }
    }
    input.keys = {};
    return { salto: analizarSalto(frames), tirones: analizarTirones(frames, { umbral: 20 }), touch, model: player.modelKind };
  }, { x, z, cuadros, guion: guion.toString() });
}

test('salto parado y en carrera: ápice de 0,75-0,80 m, sin tirones y apoyando el pie de delante', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  expect(await page.evaluate(() => window.__game.player.modelKind)).toBe('realista');

  const parado = await jumpInGame(page, { x: 112.98, z: 97.84, cuadros: 70,
    guion: i => ({ teclas: i >= 4 && i < 34 ? ['Space'] : [], pulsar: i === 4 }) });
  expect(parado.salto.despega).toBe(true);
  expect(parado.salto.apice).toBeGreaterThan(.75);
  expect(parado.salto.apice).toBeLessThan(.8);
  expect(parado.tirones.peor.valor, JSON.stringify(parado.tirones.peor)).toBeLessThan(TIRON_MAX);

  // Desde el claro, A en la cámara isométrica corre hacia -z por piso parejo unos 9 m: corre, salta
  // sostenido y sigue corriendo.
  const carrera = await jumpInGame(page, { x: 112.98, z: 97.84, cuadros: 90,
    guion: i => ({ teclas: ['KeyA', 'ShiftLeft', ...(i >= 30 && i < 60 ? ['Space'] : [])], pulsar: i === 30 }) });
  expect(carrera.salto.apice).toBeGreaterThan(.75);
  expect(carrera.salto.apice).toBeLessThan(.8);
  expect(carrera.tirones.peor.valor, JSON.stringify(carrera.tirones.peor)).toBeLessThan(TIRON_MAX);
  expect(carrera.touch, 'tocó el suelo').not.toBeNull();
  expect(carrera.touch.split, 'llega en zancada, no con los pies juntos').toBeGreaterThan(.2);
  expect(carrera.touch.frontLower, 'apoya con el pie de delante').toBeLessThan(0);

  // Un toque da un salto más bajo, pero sigue siendo un salto.
  const toque = await jumpInGame(page, { x: 112.98, z: 97.84, cuadros: 60,
    guion: i => ({ pulsar: i === 4 }) });
  expect(toque.salto.apice).toBeGreaterThan(.5);
  expect(toque.salto.apice).toBeLessThan(parado.salto.apice - .1);
  expect(errors).toEqual([]);
});

test('subir al puente y saltar en el tablero sigue aterrizando en el tablero', async ({ page }) => {
  await start(page);
  const landing = await page.evaluate(async () => {
    const { viaductSurface } = await import('/src/world/bogota/ColpatriaViaduct.js');
    const game = window.__game, player = game.player, input = game.input;
    game._running = false;
    player.position.set(78.5, viaductSurface(78.5, 262), 262);
    player.root.position.copy(player.position); player.velocity.set(0, 0, 0); player.resetGrounding();
    let airborne = false;
    for (let i = 0; i < 90; i++) {
      input.keys = i < 30 ? { Space: true } : {};
      if (i === 0) input.pressedThisFrame.add('Space');
      game._updatePlayerMovement(1 / 60);
      input.endFrame();
      airborne ||= !player.isGrounded;
    }
    input.keys = {};
    return { airborne, grounded: player.isGrounded, layer: player.groundSurface.layer,
      gap: player.position.y - viaductSurface(player.position.x, player.position.z) };
  });
  expect(landing.airborne).toBe(true);
  expect(landing.grounded).toBe(true);
  expect(landing.layer).toBe('viaduct');
  expect(Math.abs(landing.gap)).toBeLessThan(.05);
});

test('bajar de un bordillo y caer de 2,2 m: sin tirones, apoyando el pie de delante', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bazuko.sala.modelo', 'realista'));
  await page.goto('/sala.html?prueba=personaje');
  await page.waitForFunction(() => window.__sala?.player?.modelKind === 'realista' && window.__sala.player.character.animationStatus, null, { timeout: 120_000 });
  const results = await page.evaluate(async () => {
    const { correrCaso } = await import('/tools/animacion/banco.js');
    const { analizarPatinaje, analizarTirones } = await import('/tools/animacion/medidas.js');
    const out = {};
    const cases = [
      { nombre: 'caida-bordillo', suelo: { borde: 0, alto: .9 }, inicio: [-3.2, 0], cuadros: 120, guion: [{ desde: 0, hasta: 119, teclas: ['KeyD'] }], captura: { desde: 0, hasta: -1 } },
      { nombre: 'caida-alta', suelo: { borde: 0, alto: 2.2 }, inicio: [-6.5, 0], cuadros: 130, guion: [{ desde: 0, hasta: 129, teclas: ['KeyD', 'ShiftLeft'] }], captura: { desde: 0, hasta: -1 } }
    ];
    for (const caso of cases) {
      const r = await correrCaso(window.__sala, caso);
      const touch = r.cuadros.findIndex((c, i) => i > 0 && c.enSuelo && !r.cuadros[i - 1].enSuelo);
      const c = r.cuadros[touch];
      const [front, back] = c.tobillos.izq[0] > c.tobillos.der[0] ? [c.tobillos.izq, c.tobillos.der] : [c.tobillos.der, c.tobillos.izq];
      // El patinaje se mide del aterrizaje en adelante: arrancar desde quieto tiene su propio deslizamiento.
      out[caso.nombre] = { peor: analizarTirones(r.cuadros).peor, patinaje: analizarPatinaje(r.cuadros, { desde: touch - 2, hasta: touch + 40 }), touch, frontLower: front[1] - back[1] };
    }
    return out;
  });
  for (const [name, r] of Object.entries(results)) {
    expect(r.touch, `${name}: tocó el suelo`).toBeGreaterThan(0);
    expect(r.peor.valor, `${name}: ${JSON.stringify(r.peor)}`).toBeLessThan(TIRON_MAX);
    expect(r.frontLower, `${name}: apoya con el pie de delante`).toBeLessThan(0);
  }
  expect(results['caida-bordillo'].patinaje.p95, `el pie apoyado no patina al bajar del bordillo: ${JSON.stringify(results['caida-bordillo'].patinaje)}`).toBeLessThan(1.5);
});
