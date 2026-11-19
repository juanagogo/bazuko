import { expect, test } from '@playwright/test';

test('un combo de puños conecta tres veces con un peatón de pie y los dos cuerpos vuelven a soltarse', async ({ page }) => {
  test.setTimeout(300_000);
  const errores = [];
  page.on('pageerror', error => errores.push(error.message));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Jairo');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.__game && !window.__game.paused)).toBe(true);

  const resultado = await page.evaluate(async () => {
    const { FrameMetrics } = await import('/src/core/FrameMetrics.js');
    const { LOW_STANCES } = await import('/src/character/archetypes.js');
    const juego = window.__game, jugador = juego.player, distrito = juego.world.active;
    const libres = distrito.npcs.filter(n => n.character && n.person && !n.isVendor && !n.fijo
      && !n._disposed && !n.isKnockedOut && !n.action && !n._standingUp && n._riseLeft === 0
      && !LOW_STANCES.has(n.stance) && n.health === n.maxHealth);
    const [peaton] = libres.sort((a, b) => a.position.distanceToSquared(jugador.position) - b.position.distanceToSquared(jugador.position));
    if (!peaton) throw new Error('La calle necesita un peatón de pie y con toda la salud');
    juego.clock.hour = 12;
    juego.stats.energia = 100;
    jugador.equipWeapon('punos');
    const x = 112.98, z = 97.84, y = distrito.getMovementGroundHeight(x, z, 0);
    const perro = juego.dog;
    if (perro) {
      perro.home.set(x + 25, distrito.getMovementGroundHeight(x + 25, z + 25, y), z + 25);
      perro.resetNear(perro.home);
      perro._wanderTarget = null;
      perro.guard(perro.home);
    }
    jugador.position.set(x, y, z);
    jugador.root.position.copy(jugador.position);
    jugador.root.rotation.set(0, Math.PI, 0);
    jugador.velocity.set(0, 0, 0);
    jugador.resetGrounding();
    peaton.position.set(x, y, z - .85);
    peaton.root.position.copy(peaton.position);
    peaton.root.rotation.set(0, 0, 0);
    peaton.target = null; peaton.route = []; peaton.wait = 5;
    // Una pared a la espalda del peatón conserva el alcance de los tres puños con el empujón real.
    const caja = juego.collisions.colliders[0].box.clone();
    caja.min.set(x - 1.2, y - .1, peaton.position.z - 1.4);
    caja.max.set(x + 1.2, y + 2.2, peaton.position.z - .48);
    const pared = { box: caja };
    juego.collisions.colliders.push(pared);

    const contactos = [], pausas = [], gastos = [];
    const saludInicial = peaton.health;
    // La energía también baja por el paso del tiempo. Tomarla al entrar y salir de la pulsación aísla su coste.
    const golpear = jugador.punch;
    jugador.punch = function () {
      const antes = this.stats.energia;
      const aceptado = golpear.call(this);
      if (aceptado) gastos.push(antes - this.stats.energia);
      return aceptado;
    };
    const alConectar = ({ detail }) => {
      if (detail.attacker === jugador) contactos.push({
        id: jugador.attack.id, paso: jugador.attack.step, salud: peaton.health,
        objetivo: detail.hits.length === 1 && detail.hits[0] === peaton
      });
    };
    window.addEventListener('street-fight', alConectar);
    // A pocos FPS puede caber toda la pausa entre dos imágenes. Se registra cuando alcanza a la víctima.
    const pausar = peaton.pausarImpacto;
    peaton.pausarImpacto = function (pausa) {
      const retorno = pausar.call(this, pausa);
      pausas.push({ id: jugador.attack.id, segundos: this.pausaImpacto,
        nominal: jugador.attack.timing.pausaImpacto, detenido: 0, avanceDurantePausa: 0 });
      return retorno;
    };
    const descontar = jugador.melee.descontarPausa;
    jugador.melee.descontarPausa = function (dt, atacante) {
      const pendiente = this.pausaImpacto;
      const libre = descontar.call(this, dt, atacante);
      const pausa = pausas.at(-1);
      if (pausa) {
        pausa.detenido += dt - libre;
        if (pendiente > 0 && dt < this.duration) pausa.avanceDurantePausa += libre;
      }
      return libre;
    };
    const siguienteCuadro = () => new Promise(resolve => requestAnimationFrame(resolve));
    const pulsar = () => {
      for (const tipo of ['keydown', 'keyup']) {
        document.body.dispatchEvent(new KeyboardEvent(tipo, { bubbles: true, key: 'g', code: 'KeyG' }));
      }
    };
    const rectos = () => !jugador.hitLean.active && !jugador.hitLean.applied
      && !peaton.hitLean.active && !peaton.hitLean.applied;
    try {
      const inicio = await siguienteCuadro();
      const instantes = [inicio];
      pulsar();
      let pulsaciones = 1, empezo = false, cedio = false;
      while (performance.now() - inicio < 30_000) {
        instantes.push(await siguienteCuadro());
        empezo ||= !!jugador.attack;
        cedio ||= Math.hypot(peaton.hitLean.pitch, peaton.hitLean.roll) > .01;
        if (contactos.length === pulsaciones && pulsaciones < 3) { pulsar(); pulsaciones++; }
        if (empezo && !jugador.attack) break;
      }
      const finCombo = !jugador.attack && empezo;
      const limite = performance.now() + 10_000;
      while ((!rectos() || jugador.melee.pausaImpacto > 0 || peaton.pausaImpacto > 0) && performance.now() < limite) {
        await siguienteCuadro();
      }
      const medicion = new FrameMetrics();
      // El 1 % abarca el combo entero si el monitor entrega más de las 600 imágenes que guarda el HUD.
      medicion.recent = new Float32Array(instantes.length - 1);
      for (const instante of instantes) medicion.sample(instante);
      return {
        contactos, pausas, gastos, saludInicial, saludFinal: peaton.health, finCombo, cedio,
        rectos: rectos(), pausaJugador: jugador.melee.pausaImpacto, pausaPeaton: peaton.pausaImpacto,
        medida: { cuadros: medicion.frames, fpsMedios: medicion.average, fps1PorCientoBajo: medicion.recentStats().low1Percent }
      };
    } finally {
      window.removeEventListener('street-fight', alConectar);
      delete jugador.punch;
      delete peaton.pausarImpacto;
      delete jugador.melee.descontarPausa;
      const indice = juego.collisions.colliders.indexOf(pared);
      if (indice >= 0) juego.collisions.colliders.splice(indice, 1);
    }
  });

  console.log(`MEDIDA ${JSON.stringify(resultado.medida)}`);
  expect(errores).toEqual([]);
  expect(resultado.finCombo).toBe(true);
  expect(resultado.contactos.map(golpe => golpe.paso)).toEqual([0, 1, 2]);
  expect(resultado.contactos.every(golpe => golpe.objetivo)).toBe(true);
  expect(resultado.contactos.map(golpe => resultado.saludInicial - golpe.salud)).toEqual([12, 24, 42]);
  expect(resultado.gastos).toEqual([4, 4, 4]);
  expect(resultado.saludFinal).toBe(resultado.saludInicial - 42);
  const ids = resultado.contactos.map(golpe => golpe.id);
  expect(new Set(ids).size).toBe(3);
  expect(resultado.pausas.map(pausa => pausa.id)).toEqual(ids);
  let exceso = 0;
  for (const pausa of resultado.pausas) {
    expect(pausa.nominal).toBeGreaterThan(0);
    expect(pausa.segundos).toBeGreaterThanOrEqual(0);
    expect(pausa.avanceDurantePausa).toBe(0);
    if (pausa.segundos === 0) {
      // Un cuadro largo del golpe anterior ya cubrió esta pausa entera.
      expect(exceso + 1e-8).toBeGreaterThanOrEqual(pausa.nominal);
      exceso -= pausa.nominal;
    } else {
      exceso = Math.max(0, pausa.detenido - pausa.segundos);
    }
  }
  expect(resultado.cedio).toBe(true);
  expect(resultado.rectos).toBe(true);
  expect([resultado.pausaJugador, resultado.pausaPeaton]).toEqual([0, 0]);
  expect(resultado.medida.cuadros).toBeGreaterThan(0);
  expect(resultado.medida.fps1PorCientoBajo).toBeGreaterThan(0);
  expect(resultado.medida.fps1PorCientoBajo).toBeLessThanOrEqual(resultado.medida.fpsMedios + .001);
});
