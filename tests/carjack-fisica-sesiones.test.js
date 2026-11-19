import assert from 'node:assert/strict';
import { test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Game } from '../src/core/game.js';
import { CARJACK } from '../src/systems/CarjackSystem.js';
import { prepararCarroFisico } from '../src/systems/CarroFisico.js';
import { alVolante, carroDePrueba, completarTransicion, entrada, escenario, estado, manejar, subir } from './helpers/carjack-fisica.js';

function vigilarMundos(t) {
  const vivos = new Set();
  let liberados = 0;
  const crear = RAPIER.World.prototype.createCollider, liberar = RAPIER.World.prototype.free;
  t.mock.method(RAPIER.World.prototype, 'createCollider', function (...args) {
    vivos.add(this);
    return crear.apply(this, args);
  });
  t.mock.method(RAPIER.World.prototype, 'free', function () {
    const resultado = liberar.call(this);
    vivos.delete(this);
    liberados++;
    return resultado;
  });
  return {
    contar() {
      let cuerpos = 0, colisionadores = 0;
      for (const mundo of vivos) {
        cuerpos += mundo.bodies.len();
        colisionadores += mundo.colliders.len();
      }
      return { mundos: vivos.size, cuerpos, colisionadores };
    },
    get liberados() { return liberados; }
  };
}

function quedaParqueado({ juego, carro, sistema }) {
  assert.equal(sistema.chasis, null);
  assert.equal(sistema.car, null);
  assert.equal(sistema.transition, null);
  assert.equal(carro.traffic, false);
  assert.equal(carro.driven, false);
  assert.equal(juego.player.atWheel, false);
  assert.equal(juego.player.root.visible, true);
}

test('cincuenta subidas y bajadas liberan cada mundo de Rapier y vuelven a cero cuerpos y colisionadores', async t => {
  const registro = vigilarMundos(t), inicio = { mundos: 0, cuerpos: 0, colisionadores: 0 };
  const escena = escenario(t);
  assert.deepEqual(registro.contar(), inicio);
  for (let i = 0; i < 50; i++) {
    await alVolante(escena);
    manejar(escena, .1);
    const activos = registro.contar();
    assert.ok(activos.mundos === 1 && activos.cuerpos >= 1 && activos.colisionadores >= 2,
      `subida ${i + 1}: ${JSON.stringify(activos)}`);
    assert.ok(escena.sistema.exit());
    completarTransicion(escena);
    quedaParqueado(escena);
    assert.deepEqual(registro.contar(), inicio);
    assert.equal(registro.liberados, i + 1);
  }
});

test('entrar dos veces conserva un solo conductor y al perder el carro libera el mundo y la propiedad', async t => {
  const registro = vigilarMundos(t), escena = escenario(t), otro = carroDePrueba({ x: 8 });
  const { carro, sistema, juego } = escena;
  juego.cars.push(otro);
  sistema.enter({ car: carro });
  sistema.enter({ car: otro });
  assert.equal(registro.contar().mundos, 0, 'el mundo espera hasta que el jugador se sienta');
  completarTransicion(escena);
  assert.ok(await sistema.fisicaLista);
  sistema.enter({ car: carro });
  assert.equal(sistema.transition, null, 'el jugador sigue sentado');
  assert.equal(juego.cars.filter(car => car.driven).length, 1);
  assert.ok(sistema.car.driven);
  assert.equal(registro.contar().mundos, 1);
  const robado = sistema.car;
  sistema.reset({ perdido: true });
  assert.equal(sistema.stolen, null);
  assert.equal(registro.liberados, 1);
  assert.deepEqual(registro.contar(), { mundos: 0, cuerpos: 0, colisionadores: 0 });
  assert.ok(juego.cars.every(car => !car.driven && !car.traffic));
  assert.ok(!sistema._isOwn(robado));
  assert.equal(juego.player.root.visible, true);
  assert.equal(sistema.transition, null);
});

test('bajarse a mitad de la subida devuelve el jugador a pie y nunca llega a crear el mundo', async t => {
  const registro = vigilarMundos(t), escena = escenario(t);
  const { sistema, carro, juego } = escena, origen = juego.player.position.clone();
  sistema.enter({ car: carro });
  sistema.update(.12, entrada());
  assert.equal(sistema.transition.kind, 'enter');
  assert.ok(sistema.exit());
  completarTransicion(escena);
  await sistema.fisicaLista;
  quedaParqueado(escena);
  assert.ok(juego.player.position.distanceTo(origen) < .01);
  assert.deepEqual(registro.contar(), { mundos: 0, cuerpos: 0, colisionadores: 0 });
  assert.equal(registro.liberados, 0);
});

test('si sale mientras carga Rapier, la promesa tardía no crea un chasis huérfano ni devuelve al conductor', async t => {
  const registro = vigilarMundos(t), pendiente = Promise.withResolvers();
  const escena = escenario(t, { opciones: { fisica: true, cargarFisica: () => pendiente.promise } });
  subir(escena);
  const primera = escena.sistema.fisicaLista;
  assert.ok(primera instanceof Promise);
  assert.ok(escena.sistema.exit());
  completarTransicion(escena);
  pendiente.resolve(await prepararCarroFisico());
  assert.equal(await primera, null);
  quedaParqueado(escena);
  assert.equal(registro.contar().mundos, 0);
  assert.equal(registro.liberados, 0);
  await alVolante(escena);
  assert.equal(registro.contar().mundos, 1, 'una nueva subida sí crea su propio chasis');
});

test('se puede arrancar durante la carga y el chasis toma la posición, el rumbo y la velocidad que ya lleva', async t => {
  const pendiente = Promise.withResolvers();
  const escena = escenario(t, { opciones: { fisica: true, cargarFisica: () => pendiente.promise } });
  const { sistema, carro } = escena;
  subir(escena);
  manejar(escena, .75, entrada(1, .4));
  assert.equal(sistema.chasis, null);
  assert.ok(sistema.speed > 4 && carro.position.length() > 1 && carro.group.rotation.y > .1);
  const antes = estado(escena), origen = carro.position.clone();
  pendiente.resolve(await prepararCarroFisico());
  const { chasis } = await sistema.fisicaLista;
  assert.deepEqual(estado(escena), antes);
  const velocidad = chasis.linvel(), centro = chasis.translation(), rumbo = carro.group.rotation.y;
  assert.ok(Math.abs(centro.x - carro.position.x) < .001 && Math.abs(centro.z - carro.position.z) < .001);
  assert.ok(Math.abs(velocidad.x * Math.cos(rumbo) - velocidad.z * Math.sin(rumbo) - sistema.speed) < .001);
  sistema.update(1 / 60, entrada(1));
  assert.ok(Math.abs(sistema.speed - antes[4]) < .3);
  assert.ok(Math.abs(carro.position.distanceTo(origen) - antes[4] / 60) < .02);
  assert.ok(Math.abs(carro.group.rotation.y - rumbo) < .02);
});

test('si falla la carga avisa por consola una sola vez y la conducción habitual sigue disponible', async t => {
  const aviso = t.mock.method(console, 'warn', () => {});
  const escena = escenario(t, { opciones: { fisica: true, cargarFisica: async () => { throw new Error('Carga interrumpida'); } } });
  const base = escenario(t, { opciones: {} });
  for (let subida = 0; subida < 2; subida++) {
    subir(base);
    subir(escena);
    await escena.sistema.fisicaLista;
    assert.equal(escena.sistema.chasis, null);
    for (const mando of [entrada(1), entrada(1, -.4), entrada(0, 0, true)]) {
      manejar(base, .5, mando);
      manejar(escena, .5, mando);
      assert.deepEqual(estado(escena), estado(base));
    }
    assert.ok(escena.sistema.exit() && base.sistema.exit());
    completarTransicion(base);
    completarTransicion(escena);
  }
  assert.equal(aviso.mock.callCount(), 1);
});

test('la regla para bajarse usa la velocidad del chasis y el carro queda derecho en el sitio donde se detuvo', async t => {
  const escena = escenario(t), { sistema, carro } = escena;
  await alVolante(escena);
  manejar(escena, 2, entrada(1, .4));
  assert.ok(sistema.speed > CARJACK.exitSpeed);
  assert.equal(sistema.exit(), false);
  sistema.update(1 / 60, entrada(0, 0, false, true));
  assert.equal(sistema.car, carro);
  assert.ok(escena.avisos.includes('Tengo que frenar antes de bajarme.'));
  manejar(escena, 3, entrada(0, 0, true));
  assert.ok(Math.abs(sistema.speed) < CARJACK.exitSpeed);
  const puesto = carro.position.clone(), rumbo = carro.group.rotation.y;
  assert.equal(sistema.update(1 / 60, entrada(0, 0, false, true)), false);
  completarTransicion(escena);
  quedaParqueado(escena);
  assert.ok(carro.position.distanceTo(puesto) < .03);
  assert.equal(carro.group.rotation.y, rumbo);
  assert.ok(Math.abs(carro.position.y) < .001);
  const arriba = new Vector3(0, 1, 0).applyQuaternion(carro.vehicle.group.getWorldQuaternion(new Quaternion()));
  assert.ok(arriba.y > .99999);
});

test('de lado o boca abajo se endereza en el sitio y vuelve a responder al acelerador', async t => {
  for (const angulo of [Math.PI / 2, Math.PI]) {
    const carro = carroDePrueba({ x: 16, z: -23, rumbo: .4 }), escena = escenario(t, { carro });
    const { chasis } = await alVolante(escena);
    const inicio = carro.position.clone();
    const tumbado = carro.group.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angulo));
    // De lado necesita la altura del semiancho para apoyar la carrocería sin empezar dentro del piso.
    chasis.setTranslation({ x: inicio.x, y: carro.width / 2 + .02, z: inicio.z }, true);
    chasis.setRotation(tumbado, true);
    manejar(escena, 3);
    const arriba = new Vector3(0, 1, 0).applyQuaternion(chasis.rotation());
    assert.ok(arriba.y > .97, `giro inicial ${angulo}: vertical final ${arriba.y}`);
    assert.ok(carro.position.distanceTo(inicio) < .3, `se enderezó a ${carro.position.distanceTo(inicio)} m`);
    manejar(escena, 1, entrada(1));
    assert.ok(escena.sistema.speed > 3);
  }
});

test('arresto, muerte y parada del juego liberan el mundo en ese mismo momento', async t => {
  const registro = vigilarMundos(t);
  for (const causa of ['arresto', 'muerte', 'parada']) {
    const escena = escenario(t), { juego } = escena;
    Object.setPrototypeOf(juego, Game.prototype);
    Object.assign(juego, {
      deathCount: 0, _save() {}, _calleCercana: () => 'la Séptima', look: {},
      input: { keys: {}, endFrame() {} }, audio: { updateSteps() {} }, interaction: {}, menu: { open() {} }
    });
    await alVolante(escena);
    assert.equal(registro.contar().mundos, 1);
    if (causa === 'arresto') juego._policeArrest();
    if (causa === 'muerte') { juego.stats.salud = 0; assert.ok(juego._handleDeath()); }
    if (causa === 'parada') juego.stop();
    assert.deepEqual(registro.contar(), { mundos: 0, cuerpos: 0, colisionadores: 0 }, causa);
    quedaParqueado(escena);
  }
  assert.equal(registro.liberados, 3);
});
