import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARJACK } from '../src/systems/CarjackSystem.js';
import { alVolante, caja, carroDePrueba, entrada, escenario, manejar } from './helpers/carjack-fisica.js';

test('contra un muro de 20 cm a velocidad tope rebota sin atravesarlo a 30 ni a 144 Hz', async t => {
  const muro = 65;
  for (const hz of [30, 144]) {
    const escena = escenario(t, { estaticas: [caja(muro, -12, muro + .2, 12, 0, 4)] });
    const { carro, sistema, avisos } = escena;
    await alVolante(escena);
    let previa = 0, frenteMaximo = 0, minimoTrasGolpe = Infinity;
    manejar(escena, 7, entrada(1), hz, () => {
      const h = carro.group.rotation.y;
      const frente = carro.position.x + (Math.abs(Math.cos(h)) * carro.length + Math.abs(Math.sin(h)) * carro.width) / 2;
      frenteMaximo = Math.max(frenteMaximo, frente);
      if (frente < muro - .5) previa = Math.max(previa, sistema.speed);
      if (avisos.includes('¡Me estrellé!')) minimoTrasGolpe = Math.min(minimoTrasGolpe, sistema.speed);
    });
    assert.ok(previa >= CARJACK.maxSpeed - .02, `${hz} Hz: llega a ${previa} m/s`);
    assert.ok(frenteMaximo >= muro - .2 && frenteMaximo < muro + .2,
      `${hz} Hz: el parachoques llegó a ${frenteMaximo} m, límite posterior ${muro + .2}`);
    assert.ok(minimoTrasGolpe < -.05, `${hz} Hz: rebote a ${minimoTrasGolpe} m/s`);
    assert.equal(avisos.filter(aviso => aviso === '¡Me estrellé!').length, 1);
    assert.ok(escena.juego.stats.salud < 100);
  }
});

test('el daño del impacto depende de la rapidez perdida, conserva el redondeo y deja al menos un punto de salud', async t => {
  async function golpe(rumbo, salud) {
    const carro = carroDePrueba({ rumbo });
    const escena = escenario(t, { carro, estaticas: [caja(41, -120, 41.2, 120, 0, 4)] });
    const { juego, sistema } = escena, { chasis } = await alVolante(escena);
    juego.stats.salud = salud;
    const mando = entrada(1);
    for (let i = 0; i < 600; i++) {
      const antes = chasis.linvel(), rapidez = Math.hypot(antes.x, antes.z);
      sistema.update(1 / 60, mando);
      if (juego.stats.salud === salud) continue;
      const despues = chasis.linvel(), perdida = rapidez - Math.hypot(despues.x, despues.z);
      assert.ok(rapidez > 14 && perdida > 6, `antes ${rapidez}, pérdida ${perdida}, rumbo ${rumbo}`);
      assert.equal(juego.stats.salud, Math.max(1, salud - Math.round(perdida * .4)),
        `antes ${rapidez}, pérdida ${perdida}, rumbo ${rumbo}`);
      assert.ok(escena.avisos.includes('¡Me estrellé!'));
      return { danoPorPerdida: Math.round(perdida * .4), danoPorEntrada: Math.round(rapidez * .4) };
    }
    assert.fail('nunca chocó con pérdida de salud');
  }
  await golpe(0, 100);
  const oblicuo = await golpe(.75, 100);
  assert.ok(oblicuo.danoPorPerdida < oblicuo.danoPorEntrada, 'el golpe oblicuo conserva parte de su rapidez');
  await golpe(0, 3);
});

test('un roce a buena velocidad gira el chasis y lo deja resbalar a lo largo del muro sin aviso ni daño', async t => {
  const rumbo = .16, carro = carroDePrueba({ rumbo });
  const escena = escenario(t, { carro, estaticas: [caja(-15, -9.2, 180, -9, 0, 4)] });
  const { chasis } = await alVolante(escena);
  let inicioRoce, velocidadAlRoce, giro = 0;
  manejar(escena, 7, entrada(1), 60, () => {
    const h = carro.group.rotation.y, v = chasis.linvel();
    const borde = carro.position.z - (Math.abs(Math.sin(h)) * carro.length + Math.abs(Math.cos(h)) * carro.width) / 2;
    if (borde < -8.95 && inicioRoce === undefined) {
      inicioRoce = carro.position.x;
      velocidadAlRoce = Math.hypot(v.x, v.z);
    }
    if (inicioRoce !== undefined) giro = Math.max(giro, Math.abs(h - rumbo));
    assert.ok(borde > -9.2, `el costado llegó a z=${borde}`);
  });
  assert.ok(velocidadAlRoce > 12, `rapidez al rozar: ${velocidadAlRoce}`);
  assert.ok(carro.position.x > inicioRoce + 8, `inicio ${inicioRoce} m, terminó en ${carro.position.x} m`);
  assert.ok(giro > .035 && chasis.linvel().x > 6, `cambio de rumbo tras tocar: ${giro} rad`);
  assert.equal(escena.juego.stats.salud, 100);
  assert.ok(!escena.avisos.includes('¡Me estrellé!'));
});
