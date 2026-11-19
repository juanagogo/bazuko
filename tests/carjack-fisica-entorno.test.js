import assert from 'node:assert/strict';
import { test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { CARJACK } from '../src/systems/CarjackSystem.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { VIADUCT, viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';
import { BusService } from '../src/world/bogota/BusService.js';
import { CURB_HEIGHT } from '../src/world/bogota/parkedCars.js';
import { alVolante, caja, carroDePrueba, entrada, escenario, manejar } from './helpers/carjack-fisica.js';

test('en diez segundos el carro quieto se mueve menos de 2 cm en plano y con freno de mano en pendiente', async t => {
  for (const pendiente of [0, .055]) {
    const suelo = (x, z) => pendiente * (x + .3 * z);
    const carro = carroDePrueba({ x: 8, y: suelo(8, -4), z: -4, rumbo: .4 });
    const escena = escenario(t, { carro, suelo }), { chasis } = await alVolante(escena);
    const origen = carro.position.clone(), inicioChasis = chasis.translation();
    let recorrido = 0, avanceChasis = 0;
    manejar(escena, 10, entrada(0, 0, pendiente !== 0), 60, () => {
      recorrido = Math.max(recorrido, carro.position.distanceTo(origen));
      const p = chasis.translation();
      avanceChasis = Math.max(avanceChasis, Math.hypot(p.x - inicioChasis.x, p.z - inicioChasis.z));
    });
    assert.ok(recorrido < .02 && avanceChasis < .02, `pendiente ${pendiente}, raíz ${recorrido} m, chasis ${avanceChasis} m`);
  }
});

test('sube el sardinel, rueda por el andén y vuelve al nivel de la calzada', async t => {
  const suelo = x => x >= 12 && x < 25 ? CURB_HEIGHT : 0;
  const escena = escenario(t, { suelo }), { carro } = escena;
  await alVolante(escena);
  let arriba = false, abajo = false, maxima = -Infinity, minima = Infinity;
  manejar(escena, 5, entrada(1), 60, () => {
    const { x, y } = carro.position;
    maxima = Math.max(maxima, y);
    minima = Math.min(minima, y);
    if (x > 17 && x < 22) {
      arriba = true;
      assert.ok(Math.abs(y - CURB_HEIGHT) < .035, `altura sobre el andén: ${y} m`);
    }
    if (x > 35) {
      abajo = true;
      assert.ok(Math.abs(y) < .04, `altura al volver a la calle: ${y} m`);
    }
  });
  assert.ok(arriba && abajo, `quedó en x=${carro.position.x}`);
  assert.ok(maxima < CURB_HEIGHT + .16 && minima > -.14, `recorrido vertical [${minima}, ${maxima}] m`);
});

test('al renovarse el terreno conserva el tablero del puente o la calle inferior según la altura de llegada', async t => {
  const suelo = (_x, _z, y) => y > 3 ? 6 : 0;
  for (const nivel of [6, 0]) {
    const carro = carroDePrueba({ y: nivel }), escena = escenario(t, { carro, suelo });
    const { chasis } = await alVolante(escena);
    const apoyo = chasis.translation().y - carro.position.y;
    manejar(escena, 6, entrada(1), 60, () => {
      assert.ok(Math.abs(carro.position.y - nivel) < .07, `raíz en y=${carro.position.y}; calle a ${nivel} m`);
      assert.ok(Math.abs(chasis.translation().y - apoyo - nivel) < .14, 'el chasis rueda en ese mismo nivel');
    });
    assert.ok(carro.position.x > 55, `pasó por varios tramos del tablero: ${carro.position.x} m`);
  }
});

test('si pierde el carro en el aire al coronar la rampa de Colpatria, lo deja sobre el tablero', async t => {
  const ciudad = new Bogota();
  ciudad.map = ciudad._layout();
  const suelo = ciudad.getMovementGroundHeight.bind(ciudad);
  const carro = carroDePrueba({ x: 75, y: .02, z: 10, rumbo: -Math.PI / 2, largo: 4.35, ancho: 1.73 });
  const escena = escenario(t, { carro, suelo }), { chasis } = await alVolante(escena);
  const acelerar = entrada(1);
  for (let i = 0; i < 420 && carro.position.z < VIADUCT.crestStart + 3; i++) escena.sistema.update(1 / 60, acelerar);
  assert.ok(carro.position.z >= VIADUCT.crestStart + 3, 'subió la rampa real');
  const tablero = viaductSurface(carro.position.x, carro.position.z);
  assert.ok(tablero > 7);
  // Si la maniobra ya no despega por sí sola, mantener la regresión del contacto perdido en la misma cota.
  if (carro.position.y < tablero + .8) {
    const centro = chasis.translation();
    chasis.setTranslation({ x: centro.x, y: centro.y + tablero + .9 - carro.position.y, z: centro.z }, true);
    escena.sistema.update(1 / 60, entrada());
  }
  assert.ok(carro.position.y > tablero + .6, 'en el aire la altura por sí sola ya no identifica el piso');
  const antes = carro.position.clone();
  escena.sistema.reset({ perdido: true });
  assert.ok(Math.abs(carro.position.y - viaductSurface(carro.position.x, carro.position.z)) < .03,
    `vuelo en y=${antes.y}, tablero=${tablero}, carro parqueado en y=${carro.position.y}`);
  assert.ok(Math.hypot(carro.position.x - antes.x, carro.position.z - antes.z) < .1);
});

test('se detiene en la orilla antes de superar la profundidad permitida bajo el frente y muestra el aviso del lago', async t => {
  const suelo = x => x > 20 ? -(x - 20) * .25 : 0;
  const agua = x => x > 20 ? { surfaceY: 0 } : null;
  const escena = escenario(t, { suelo, agua }), { carro, avisos } = escena;
  await alVolante(escena);
  let profundidad = 0;
  manejar(escena, 6, entrada(1), 60, () => {
    const frente = carro.position.x + Math.cos(carro.group.rotation.y) * carro.length / 2;
    profundidad = Math.max(profundidad, -suelo(frente));
  });
  assert.ok(profundidad <= CARJACK.maxWade + .003, `agua bajo el frente: ${profundidad} m`);
  assert.ok(carro.position.x > 16 && carro.position.x < 21);
  assert.ok(avisos.includes('No me puedo meter al lago con el carro.'));
  assert.equal(escena.juego.stats.salud, 100);
  manejar(escena, 2, entrada(-1));
  assert.ok(carro.position.x < 16, 'puede salir en reversa hacia tierra firme');
});

test('el mundo carga las cajas estáticas cercanas y retira las que quedan lejos al seguir por la calle', async t => {
  const escena = escenario(t, { estaticas: [caja(2, 4, 4, 6), caja(119, 4, 121, 6)] });
  const { mundo } = await alVolante(escena);
  const juntoA = x => mundo.castRay(new RAPIER.Ray({ x, y: .9, z: 3 }, { x: 0, y: 0, z: 1 }), 4, true);
  manejar(escena, .1, entrada(1));
  assert.ok(juntoA(3));
  assert.equal(juntoA(120), null, 'la caja a 120 m está fuera del mundo local');
  const mando = entrada(1);
  for (let i = 0; i < 720 && escena.carro.position.x < 116; i++) escena.sistema.update(1 / 60, mando);
  assert.ok(escena.carro.position.x >= 116);
  assert.ok(juntoA(120), 'se incorporó la caja de la nueva cuadra');
  assert.equal(juntoA(3), null, 'la de la primera cuadra se liberó');
});

test('la caja del carro propio se ignora y las de un parqueado, un carro de tráfico y un bus lo detienen', async t => {
  for (const tipo of ['parqueado', 'tráfico', 'bus']) {
    const escena = escenario(t), { juego, carro, sistema } = escena;
    const otro = carroDePrueba({ x: 47, largo: tipo === 'bus' ? 10 : 4.4, ancho: 2.1 });
    otro.traffic = tipo === 'tráfico';
    const vehiculos = tipo === 'bus' ? [carro] : [carro, otro];
    const bus = tipo === 'bus' ? otro : undefined;
    const refrescar = () => juego.collisions.setVehicles(vehiculos, bus);
    refrescar();
    const barrera = juego.collisions.dynamicColliders.find(e => e.vehicle === otro).box.min.x;
    await alVolante(escena);
    let maxima = 0, previa = 0;
    manejar(escena, 6, entrada(1), 60, () => {
      refrescar();
      maxima = Math.max(maxima, carro.position.x);
      if (carro.position.x < 37) previa = Math.max(previa, sistema.speed);
    });
    assert.ok(previa > CARJACK.maxSpeed - .05, `la caja propia no lo frena: ${previa} m/s`);
    assert.ok(maxima > barrera - carro.length && maxima < barrera, `${tipo} en ${barrera}; llegó a ${maxima}`);
    assert.ok(escena.avisos.includes('¡Me estrellé!'));
    assert.equal(otro.position.x, 47, 'el obstáculo conserva su sitio');
  }
});

test('pasa en paralelo junto al bus en diagonal y choca únicamente si ocupa su carril', async t => {
  const eje = Math.SQRT1_2, bus = new BusService(new Bogota().getBusRoute());
  bus.group.rotation.set(0, Math.PI / 4, 0);
  bus.position.set(0, 0, 0);
  for (const lateral of [4.5, 0]) {
    const carro = carroDePrueba({ x: (-22 + lateral) * eje, z: (-22 - lateral) * eje, rumbo: -Math.PI / 4, largo: 4.35, ancho: 1.73 });
    const escena = escenario(t, { carro });
    escena.juego.collisions.setVehicles([carro], bus);
    await alVolante(escena);
    manejar(escena, 5, entrada(1));
    const avance = (carro.position.x + carro.position.z) * eje;
    const separacion = (carro.position.x - carro.position.z) * eje;
    if (lateral) {
      assert.ok(avance > 30 && Math.abs(separacion - lateral) < .2, `avance ${avance} m, separación ${separacion} m`);
      assert.equal(escena.juego.stats.salud, 100);
      assert.ok(!escena.avisos.includes('¡Me estrellé!'));
    } else {
      assert.ok(avance < -bus.length / 2, `el carro se metió en el bus: ${avance} m`);
      assert.ok(escena.avisos.includes('¡Me estrellé!'));
    }
  }
});
