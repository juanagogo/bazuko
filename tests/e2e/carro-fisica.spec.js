import { expect, test } from '@playwright/test';
import { CARJACK } from '../../src/systems/CarjackSystem.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let semilla = 89123;
    Math.random = () => ((semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0) / 4294967296);
    localStorage.clear();
    localStorage.setItem('bazuko.graphics_quality', 'baja');
  });
});

async function arrancar(page, fisica) {
  await page.goto(fisica ? '/?carro=fisica' : '/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Parcero QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
}

function prepararTerminal() {
  const g = window.__game;
  const x = 64, z = -5;
  const barrera = g.collisions.queryStatic(x - 1, -75, x + 1, -71, []).find(({ box }) =>
    box.min.x < x - 3 && box.max.x > x + 3 && box.min.z < -73.5 && box.max.z > -72 && box.max.z < -71.5);
  if (!barrera) throw new Error('Falta la barrera roja y blanca del fondo de la terminal.');
  const particulares = g.cars.filter(c => c.kind === 'carro' && !c.traffic);
  const carro = particulares.find(c => c.vehicle.model === 'sedanNoventero') ?? particulares[0];
  if (!carro) throw new Error('Falta un carro particular parqueado.');
  g.clock.hour = 12;
  g.traffic.alertForTheft = () => false;
  g.renderer.adaptResolution = () => {};
  g.renderer.resolution.setLimit(g.renderer.resolution.max);
  carro.position.set(x, g.world.active.getMovementGroundHeight(x, z, 0), z);
  carro.group.rotation.set(0, Math.PI / 2, 0);
  carro.group.updateWorldMatrix(true, false);
  const puerta = carro.driverDoor();
  g.player.position.copy(puerta);
  g.player.root.position.copy(puerta);
  g.player.velocity.set(0, 0, 0);
  g.cameraRig.yaw = carro.group.rotation.y - Math.PI / 2;
  if (g.dog) {
    g.dog.position.set(puerta.x + 40, puerta.y, puerta.z + 40);
    g.dog.group?.position.copy(g.dog.position);
  }
  g._syncVehicleColliders();
  window.__pistaCarro = { carro, x, z, barrera: barrera.box.max.z };
}

function conducirAlFondo(tope) {
  const g = window.__game, { carro, x: carril, z: salida, barrera } = window.__pistaCarro;
  const alNorte = Math.PI / 2;
  const angulo = a => Math.atan2(Math.sin(a), Math.cos(a));
  const teclas = new Set();
  function tecla(codigo, pulsada) {
    if (teclas.has(codigo) === pulsada) return;
    if (pulsada) teclas.add(codigo); else teclas.delete(codigo);
    window.dispatchEvent(new KeyboardEvent(pulsada ? 'keydown' : 'keyup', { code: codigo, bubbles: true, cancelable: true }));
  }
  let aviso = false;
  const escucha = e => {
    const cerca = Math.abs(carro.position.x - carril) < 4 && carro.position.z - barrera < carro.length / 2 + 2.5;
    if (e.detail?.text === '¡Me estrellé!' && cerca) aviso = true;
  };
  window.addEventListener('toast', escucha);
  const intervalos = [];
  let fase = 'recta', ultimo, rumboAnterior = alNorte, velocidadAlFrenar = 0;
  let recta = 0, giro = 0, cuadrosConFreno = 0, maxima = 0, antes = 0, despues, rumboAlChocar;
  let margenMinimo = Infinity;

  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => {
      limpiar();
      reject(new Error(`No terminó la maniobra en "${fase}", centro (${carro.position.x}, ${carro.position.z}), velocidad ${g.carjack.speed}.`));
    }, 120_000);
    let solicitud;
    function limpiar() {
      clearTimeout(limite);
      cancelAnimationFrame(solicitud);
      window.removeEventListener('toast', escucha);
      for (const codigo of [...teclas]) tecla(codigo, false);
    }
    function cuadro(ahora) {
      if (ultimo !== undefined && ahora > ultimo) intervalos.push(ahora - ultimo);
      const dt = ultimo === undefined ? 1 / 60 : Math.max(.001, Math.min(.1, (ahora - ultimo) / 1000));
      ultimo = ahora;
      const v = g.carjack.speed, { x, z } = carro.position, h = carro.group.rotation.y;
      const fondo = (Math.abs(Math.sin(h)) * carro.length + Math.abs(Math.cos(h)) * carro.width) / 2;
      const margen = z - fondo - barrera;
      maxima = Math.max(maxima, v);
      margenMinimo = Math.min(margenMinimo, margen);
      if (margen > 0 && margen < 5) antes = Math.max(antes, v);
      if (fase === 'recta') {
        tecla('KeyW', true);
        if (v >= tope - .1) {
          recta = salida - z;
          tecla('KeyA', true);
          fase = 'curva';
        }
      } else if (fase === 'curva') {
        giro = angulo(h - alNorte);
        if (giro >= .07) {
          velocidadAlFrenar = v;
          tecla('KeyW', false);
          tecla('Space', true);
          fase = 'freno de mano';
        }
      } else if (fase === 'freno de mano') {
        if (g.input.isDown('Space')) cuadrosConFreno++;
        if (velocidadAlFrenar - v > 1 || angulo(h - alNorte) - giro > .12) {
          tecla('Space', false);
          tecla('KeyA', false);
          tecla('KeyW', true);
          fase = 'hacia la barrera';
        }
      } else if (fase === 'hacia la barrera') {
        const destino = Math.atan2(Math.min(12, Math.max(4, z - barrera)), carril - x);
        const velocidadAngular = angulo(h - rumboAnterior) / dt;
        const correccion = angulo(destino - h - .14 * velocidadAngular);
        tecla('KeyA', correccion > .06);
        tecla('KeyD', correccion < -.06);
        if (aviso && margen < 1.5) {
          despues = Math.abs(v);
          rumboAlChocar = Math.abs(angulo(h - alNorte));
          tecla('KeyW', false);
          tecla('KeyA', false);
          tecla('KeyD', false);
          tecla('Space', true);
          fase = 'parar';
        }
      } else if (Math.abs(v) < .45) {
        limpiar();
        resolve({ modelo: carro.vehicle.model, recta, giro, cuadrosConFreno, maxima, antes, despues, rumboAlChocar, margenMinimo,
          recorrido: Math.hypot(x - carril, z - salida), intervalos });
        return;
      }
      rumboAnterior = h;
      solicitud = requestAnimationFrame(cuadro);
    }
    solicitud = requestAnimationFrame(cuadro);
  });
}

function medirCuadros(intervalos) {
  const ms = intervalos.reduce((suma, t) => suma + t, 0);
  const lentos = [...intervalos].sort((a, b) => b - a).slice(0, Math.ceil(intervalos.length * .01));
  const fps = (n, tiempo) => Number((1000 * n / tiempo).toFixed(2));
  return { cuadros: intervalos.length, fpsMedia: fps(intervalos.length, ms),
    fpsUnoPorCientoMasLento: fps(lentos.length, lentos.reduce((suma, t) => suma + t, 0)) };
}

for (const fisica of [false, true]) {
  const modo = fisica ? 'Rapier' : 'habitual';
  test(`robar un parqueado, girar con el freno de mano y chocar de frente con conducción ${modo}`, async ({ page }) => {
    test.setTimeout(300_000);
    const errores = [];
    page.on('pageerror', error => errores.push(error.message));
    await arrancar(page, fisica);
    await page.evaluate(prepararTerminal);
    await expect(page.locator('#interaction-prompt')).toContainText('Forzar la puerta');
    await page.keyboard.press('KeyY');
    await page.waitForFunction(() => window.__game.carjack.car === window.__pistaCarro.carro && !window.__game.carjack.transition);
    const activo = await page.evaluate(async () => {
      const sistema = window.__game.carjack;
      await sistema.fisicaLista;
      return !!sistema.chasis;
    });
    expect(activo).toBe(fisica);
    await expect(page.locator('#carjack-hud')).toBeVisible();
    const ruta = await page.evaluate(conducirAlFondo, CARJACK.maxSpeed);
    expect(ruta.intervalos.length).toBeGreaterThan(20);
    console.log('MEDIDA ' + JSON.stringify({ modo, modelo: ruta.modelo, ...medirCuadros(ruta.intervalos) }));
    expect(ruta.recta).toBeGreaterThan(10);
    expect(ruta.giro).toBeGreaterThan(.06);
    expect(ruta.cuadrosConFreno).toBeGreaterThan(0);
    expect(ruta.maxima).toBeLessThanOrEqual(CARJACK.maxSpeed + .001);
    expect(ruta.recorrido).toBeGreaterThan(60);
    expect(ruta.margenMinimo).toBeGreaterThan(-.45);
    expect(ruta.antes).toBeGreaterThan(8);
    expect(ruta.despues).toBeLessThan(ruta.antes - 4);
    expect(ruta.rumboAlChocar).toBeLessThan(.36);
    await page.keyboard.press('KeyY');
    await page.waitForFunction(() => !window.__game.carjack.driving && !window.__game.carjack.transition);
    await expect(page.locator('#carjack-hud')).toBeHidden();
    const estacionado = await page.evaluate(() => {
      const g = window.__game, { carro } = window.__pistaCarro, p = carro.position;
      const inclinacion = objeto => {
        const q = objeto.getWorldQuaternion(objeto.quaternion.clone());
        return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
      };
      return { parqueado: g.cars.includes(carro) && !carro.driven && !carro.traffic,
        fuera: g.player.root.visible && g.player.position.distanceTo(p) > 1.2,
        desnivel: Math.abs(p.y - g.world.active.getMovementGroundHeight(p.x, p.z, p.y)),
        inclinacion: Math.max(inclinacion(carro.group), inclinacion(carro.vehicle.bodyVisual)) };
    });
    expect(estacionado.parqueado && estacionado.fuera).toBe(true);
    expect(estacionado.desnivel).toBeLessThan(.08);
    expect(estacionado.inclinacion).toBeLessThan(.05);
    expect(errores).toEqual([]);
  });
}
