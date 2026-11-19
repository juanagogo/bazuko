import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Quaternion, Scene, Texture, Vector3 } from 'three';
import * as texturas from '../src/world/bogota/textures.js';
import { CURB_HEIGHT, parkCar } from '../src/world/bogota/parkedCars.js';
import { prepararCarroFisico } from '../src/systems/CarroFisico.js';
import { BOARDING } from '../src/systems/CarjackSystem.js';
import { Clock } from '../src/core/Clock.js';
import { viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';
import { alVolante, completarTransicion, entrada, escenario, manejar, subir } from './helpers/carjack-fisica.js';

mock.module('../src/world/bogota/textures.js', { namedExports: { ...texturas, radialSprite: () => new Texture() } });
const { Car } = await import('../src/entities/Car.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');
const { CAR_MODELS } = await import('../src/world/bogota/carModels.js');
const { getCarBody, getCarGeometry, wheelSeats } = await import('../src/world/bogota/VehicleBody.js');

function medirCauchos(carro, suelo) {
  const v = carro.vehicle, base = getCarGeometry(v.model, carro.kind);
  const moldura = v.bodyVisual.getObjectByName('Molduras e interior'), punto = new Vector3();
  let siguiente = base.trim.attributes.position.count;
  carro.group.updateMatrixWorld(true);
  return v.asientosRuedas().map(([, , lado], i) => {
    const cantidad = (lado < 0 ? base.wheelLeft : base.wheelRight).attributes.position.count;
    const malla = v.wheels[i] ?? moldura, inicio = malla === moldura ? siguiente : 0;
    siguiente += cantidad;
    let distancia = Infinity;
    for (let j = inicio; j < inicio + cantidad; j++) {
      punto.fromBufferAttribute(malla.geometry.attributes.position, j).applyMatrix4(malla.matrixWorld);
      distancia = Math.min(distancia, punto.y - suelo(punto.x, punto.z, carro.position.y));
    }
    return distancia;
  });
}

for (const fisica of [false, true]) {
  const modo = fisica ? 'Rapier' : 'habitual';
  test(`la pickup conserva el apoyo sobre el sardinel mientras el jugador entra agachado y arranca con conducción ${modo}`, async t => {
    const ciudad = new Bogota();
    ciudad.map = ciudad._layout();
    const suelo = ciudad.getMovementGroundHeight.bind(ciudad);
    const puesto = ciudad.getParkingSpots().find(p => p.x === 13.6 && p.z === 8);
    const carro = new Car(new Scene(), new Vector3(puesto.x, 0, puesto.z), puesto.rot, { kind: 'carro', model: 'pickup', variant: 3 });
    t.after(() => carro.dispose());
    parkCar(carro, puesto);
    const escena = escenario(t, { carro, suelo, opciones: { fisica } }), { sistema, juego } = escena;
    const v = carro.vehicle, asientos = wheelSeats(CAR_MODELS.pickup, getCarBody('pickup'));
    const comprobarApoyo = fase => {
      const errores = asientos.map(([x, z], i) => {
        const centro = v.wheels[i]?.parent.getWorldPosition(new Vector3()) ??
          v.bodyVisual.localToWorld(new Vector3(x, v.wheelRadius, z));
        return centro.y - v.wheelRadius - suelo(centro.x, centro.z, carro.position.y);
      });
      assert.ok(errores.every(y => Math.abs(y) < .025), `${fase}: distancias rueda–piso ${errores.join(', ')}`);
    };
    comprobarApoyo('parqueada');
    sistema.enter({ car: carro });
    let agachado = 0;
    for (let f = 0; f < 180 && sistema.transition; f++) {
      sistema.update(1 / 60, entrada());
      carro.update(1 / 60, juego.player.position);
      comprobarApoyo('entrada');
      if (sistema.transition?.phase === 'slip') {
        agachado = Math.max(agachado, juego.player.position.y - juego.player.root.position.y);
      }
    }
    assert.equal(sistema.transition, null);
    assert.ok(agachado > BOARDING.duck * .9, `descenso visible al entrar: ${agachado} m`);
    await sistema.fisicaLista;
    comprobarApoyo('sentado');
    manejar(escena, .5, entrada(1), 60, () => comprobarApoyo('arranque'));
    assert.equal(v.wheels.length, 4);
    assert.ok(v.wheels.every(rueda => rueda.rotation.z < -1), 'las cuatro llantas ruedan con la distancia recorrida');
    manejar(escena, .08, entrada(1, 1));
    assert.ok(v.frontWheelPivots.every(eje => eje.rotation.y > .04), 'la dirección se ve en los dos ejes delanteros');
  });

  test(`el carro del jugador proyecta los faros con el clima de la ciudad y apaga los stops al quedar vacío con conducción ${modo}`, async t => {
    const carro = new Car(new Scene(), new Vector3(), 0, { kind: 'carro', model: 'sedanPopular', variant: 3 });
    t.after(() => carro.dispose());
    const escena = escenario(t, { carro, opciones: { fisica } }), { sistema, juego } = escena, v = carro.vehicle;
    const lucesApagadas = v.tailMat.color.r;
    juego.clock = new Clock({ hour: 18.5 });
    assert.equal(v.beam, null);
    for (const salida of ['a pie', 'recuperación']) {
      if (salida === 'recuperación') {
        juego.clock.hour = 12;
        juego.weather = { weather: 'niebla' };
      }
      subir(escena);
      await sistema.fisicaLista;
      assert.ok(v.flares[0].visible && v.beam?.visible, 'los faros iluminan también el pavimento');
      manejar(escena, .2, entrada(0, 0, true));
      assert.ok(v.tailMat.color.r > 2, 'los stops se encienden al frenar');
      if (salida === 'a pie') {
        assert.ok(sistema.exit());
        completarTransicion(escena);
      } else sistema.reset();
      assert.equal(v.tailMat.color.r, lucesApagadas);
      assert.equal(v.flares[0].visible, false);
      assert.ok(!v.beam?.visible);
      assert.equal(v.wheels.length, 0);
      carro.update(1, new Vector3(220, 0, 140));
      assert.equal(carro.marker.visible, false, 'al recuperar al jugador lejos de su carro se oculta el contorno');
    }
  });

  test(`la banda exterior del caucho apoya en el andén y en ambos sentidos de la rampa de Colpatria con conducción ${modo}`, async t => {
    const ciudad = new Bogota();
    ciudad.map = ciudad._layout();
    const suelo = ciudad.getMovementGroundHeight.bind(ciudad);
    for (const [model, kind, x, z, rot, viaducto] of [
      ['sedanPopular', 'taxi', 110, 143.6, 0, false], ['hatchPopular', 'carro', 132.4, 162, Math.PI / 2, false],
      ['pickup', 'carro', 75, 29, Math.PI / 2, true], ['pickup', 'carro', 75, 29, -Math.PI / 2, true],
    ]) {
      const carro = new Car(new Scene(), new Vector3(x, viaducto ? viaductSurface(x, z) : 0, z), rot, { model, kind, variant: 3 });
      t.after(() => carro.dispose());
      if (!viaducto) parkCar(carro, { x, z, rot });
      const escena = escenario(t, { carro, suelo, opciones: { fisica } });
      subir(escena);
      await escena.sistema.fisicaLista;
      manejar(escena, 2, entrada(0, 0, true));
      const comprobar = () => {
        const distancias = medirCauchos(carro, suelo);
        assert.ok(distancias.every(d => Math.abs(d) < .015), `${model} en (${x}, ${z}): ${distancias}`);
      };
      comprobar();
      assert.ok(escena.sistema.exit());
      completarTransicion(escena);
      comprobar();
    }
  });
}

test('al acelerar y frenar los faros de Rapier se proyectan sobre los dos niveles de un sardinel', async t => {
  const suelo = (x, z) => x + .3 * z > 8 ? .12 : .02;
  const carro = new Car(new Scene(), new Vector3(0, .02, 0), 0, { kind: 'carro', model: 'sedanPopular', variant: 3 });
  t.after(() => carro.dispose());
  const escena = escenario(t, { carro, suelo });
  escena.juego.clock = new Clock({ hour: 22 });
  await alVolante(escena);
  const haz = carro.vehicle.beam, malla = haz.geometry, p = new Vector3(), centro = new Vector3();
  let menor = Infinity, mayor = -Infinity, cruces = 0;
  const medir = () => {
    haz.updateWorldMatrix(true, false);
    if (malla.userData.cortes.activos) cruces++;
    for (let i = 0; i < malla.drawRange.count; i += 3) {
      centro.set(0, 0, 0);
      for (let j = 0; j < 3; j++) centro.add(p.fromBufferAttribute(malla.attributes.position, malla.index.getX(i + j)));
      centro.multiplyScalar(1 / 3).applyMatrix4(haz.matrixWorld);
      // La arista vertical une dos cotas en el mismo punto; los cortes la sitúan con precisión milimétrica.
      if (Math.abs(centro.x + .3 * centro.z - 8) < .001) continue;
      const d = centro.y - suelo(centro.x, centro.z);
      menor = Math.min(menor, d); mayor = Math.max(mayor, d);
    }
  };
  manejar(escena, 1, entrada(1), 60, medir);
  manejar(escena, .6, entrada(0, 0, true), 60, medir);
  assert.ok(cruces > 0);
  assert.ok(menor > .025 && mayor < .035, `luz sobre el piso: ${menor} a ${mayor} m`);
});

test('el rin, las molduras y las luces de cada modelo se conservan al conducir y volver a parquear', async t => {
  const acabados = new Set();
  for (const model of ['sedanNoventero', 'sedanDeportivo']) {
    const carro = new Car(new Scene(), new Vector3(), 0, { kind: 'carro', model, variant: 3 });
    const escena = escenario(t, { carro }), vehiculo = carro.vehicle;
    escena.juego.clock = { isNight: true };
    t.after(() => carro.dispose());
    const moldura = vehiculo.bodyVisual.getObjectByName('Molduras e interior');
    const lamparas = vehiculo.bodyVisual.getObjectByName('Lámparas y placas');
    const acabado = moldura.material, parqueada = moldura.geometry, detalles = [...vehiculo.details];
    acabados.add(acabado);
    assert.equal(vehiculo.height, CAR_MODELS[model].H);
    assert.equal(vehiculo.wheels.length, 0);
    await alVolante(escena);
    assert.notEqual(moldura.geometry, parqueada);
    assert.equal(vehiculo.wheels.length, 4);
    assert.equal(vehiculo.wipers.length, 2);
    for (const rueda of vehiculo.wheels) assert.equal(rueda.material, acabado);
    for (const plumilla of vehiculo.wipers) assert.equal(plumilla.children[0].material, acabado);
    assert.ok(vehiculo.flares[0].visible && vehiculo.headlightMaterial.emissiveIntensity > 1);
    carro.updateLod(200 ** 2);
    assert.ok(vehiculo.wheels.every(rueda => !rueda.visible));
    carro.updateLod(0);
    assert.ok(vehiculo.wheels.every(rueda => rueda.visible));
    assert.ok(escena.sistema.exit());
    completarTransicion(escena);
    assert.equal(moldura.geometry, parqueada);
    assert.deepEqual(vehiculo.details, detalles);
    assert.equal(vehiculo.wheels.length, 0);
    assert.equal(vehiculo.wipers.length, 0);
    assert.equal(vehiculo.bodyVisual.getObjectByName('Lámparas y placas'), lamparas);
    assert.equal(vehiculo.flares[0].visible, false);
  }
  assert.equal(acabados.size, 2, 'el noventero conserva su rin de acero y el deportivo su aleación');
});

test('el parqueado robado muestra la inclinación de los muelles una sola vez, cuatro ruedas rodando y dirección visible', async t => {
  const carro = new Car(new Scene(), new Vector3(), .35, { traffic: false, kind: 'carro', variant: 3 });
  const escena = escenario(t, { carro });
  t.after(() => carro.dispose());
  const { chasis, vehiculo } = await alVolante(escena), modelo = carro.vehicle;
  assert.equal(modelo.wheels.length, 4);
  assert.equal(modelo.frontWheelPivots.length, 2);
  const ruedasAlSalir = modelo.wheels.map(rueda => rueda.rotation.z);
  const posicionNeutra = modelo.bodyVisual.position.clone();
  let cabeceoAlAcelerar = 0, cabeceoAlFrenar = 0, ladeoAlGirar = 0, diferenciaMuelles = 0;
  function comprobarPose() {
    carro.update(1 / 60);
    const q = chasis.rotation();
    const fisica = new Quaternion(q.x, q.y, q.z, q.w).normalize();
    const visual = modelo.bodyVisual.getWorldQuaternion(new Quaternion());
    assert.ok(visual.angleTo(fisica) < .001, 'la carrocería dibuja la orientación medida por Rapier');
    assert.ok(modelo.bodyVisual.position.distanceTo(posicionNeutra) < .0001, 'el bamboleo de la animación está desactivado');
    const longitudes = [0, 1, 2, 3].map(i => vehiculo.wheelSuspensionLength(i));
    diferenciaMuelles = Math.max(diferenciaMuelles, Math.max(...longitudes) - Math.min(...longitudes));
    return fisica;
  }
  manejar(escena, 1.5, entrada(1), 60, () => {
    const frente = new Vector3(1, 0, 0).applyQuaternion(comprobarPose());
    cabeceoAlAcelerar = Math.max(cabeceoAlAcelerar, frente.y);
  });
  for (const [i, rueda] of modelo.wheels.entries()) {
    assert.ok(rueda.visible && rueda.parent.visible);
    assert.ok(rueda.rotation.z < ruedasAlSalir[i] - 1, `rueda ${i + 1} al avanzar`);
  }
  manejar(escena, .5, entrada(-1), 60, () => {
    const frente = new Vector3(1, 0, 0).applyQuaternion(comprobarPose());
    cabeceoAlFrenar = Math.min(cabeceoAlFrenar, frente.y);
  });
  manejar(escena, 1.5, entrada(1));
  manejar(escena, .5, entrada(1, 1), 60, () => {
    comprobarPose();
    const techo = new Vector3(0, 1, 0).applyQuaternion(modelo.group.quaternion);
    ladeoAlGirar = Math.max(ladeoAlGirar, techo.z);
  });
  assert.ok(cabeceoAlAcelerar > .002 && cabeceoAlFrenar < -.002,
    `elevación del frente al arrancar ${cabeceoAlAcelerar}, al frenar ${cabeceoAlFrenar}`);
  assert.ok(ladeoAlGirar > .002 && diferenciaMuelles > .003,
    `ladeo ${ladeoAlGirar}, diferencia entre suspensiones ${diferenciaMuelles} m`);
  assert.ok(modelo.frontWheelPivots.every(eje => eje.rotation.y > .05), 'al girar a la izquierda se orientan los dos ejes delanteros');
});

test('la pickup en su puesto real apoya dos llantas en el andén y dos en la calzada al manejar, bajarse o cancelar otra subida', async t => {
  const ciudad = new Bogota();
  ciudad.map = ciudad._layout();
  const suelo = ciudad.getMovementGroundHeight.bind(ciudad);
  const puesto = ciudad.getParkingSpots().find(p => p.x === 13.6 && p.z === 8);
  assert.ok(puesto);
  const carro = new Car(new Scene(), new Vector3(puesto.x, 0, puesto.z), puesto.rot, { kind: 'carro', model: 'pickup', variant: 3 });
  parkCar(carro, puesto);
  const escena = escenario(t, { carro, suelo }), modelo = carro.vehicle;
  t.after(() => carro.dispose());
  await alVolante(escena);
  manejar(escena, 10, entrada(0, 0, true));
  function comprobarApoyos(puntos, fase) {
    const alturas = puntos.map(({ x, y, z }) => {
      const altura = suelo(x, z, y);
      assert.ok(Math.abs(y - altura) < .02, `${fase}, llanta en (${x}, ${z}): base ${y} m y suelo ${altura} m`);
      return altura;
    });
    assert.equal(alturas.filter(y => y >= CURB_HEIGHT - .01).length, 2, fase);
    assert.equal(alturas.filter(y => Math.abs(y) < .01).length, 2, fase);
  }
  comprobarApoyos(modelo.wheels.map(rueda => {
    const base = rueda.parent.getWorldPosition(new Vector3());
    base.y -= rueda.userData.radius;
    return base;
  }), 'al volante');
  assert.ok(escena.sistema.exit());
  completarTransicion(escena);
  const spec = CAR_MODELS[modelo.model], molduras = modelo.bodyVisual.children.find(malla => malla.name === 'Molduras e interior');
  const asientos = wheelSeats(spec, getCarBody(spec.id));
  const apoyosParqueado = () => asientos.map(([x, z]) => molduras.localToWorld(new Vector3(x, 0, z)));
  const aparcado = apoyosParqueado();
  comprobarApoyos(aparcado, 'de nuevo parqueado');
  escena.sistema.enter({ car: carro });
  escena.sistema.update(.08, entrada());
  assert.ok(escena.sistema.exit());
  completarTransicion(escena);
  const trasCancelar = apoyosParqueado();
  comprobarApoyos(trasCancelar, 'al cancelar la reentrada');
  assert.ok(trasCancelar.every((p, i) => p.distanceTo(aparcado[i]) < .001));
});

test('si frena y se baja mientras todavía carga Rapier, el modelo real queda derecho y la carga tardía respeta el parqueo', async t => {
  const carga = Promise.withResolvers();
  const carro = new Car(new Scene(), new Vector3(), 0, { kind: 'carro', model: 'sedanPopular', variant: 3 });
  const escena = escenario(t, { carro, opciones: { fisica: true, cargarFisica: () => carga.promise } });
  t.after(() => carro.dispose());
  subir(escena);
  const sesion = escena.sistema.fisicaLista;
  manejar(escena, 1.2, entrada(1));
  const frenar = entrada(-1);
  for (let i = 0; i < 120 && escena.sistema.speed > 1.9; i++) escena.sistema.update(1 / 60, frenar);
  assert.ok(escena.sistema.speed > 1 && escena.sistema.speed <= 1.9 && escena.sistema.chasis === null);
  assert.ok(escena.sistema.exit());
  completarTransicion(escena);
  carga.resolve(await prepararCarroFisico());
  assert.equal(await sesion, null);
  assert.equal(escena.sistema.chasis, null);
  const arriba = new Vector3(0, 1, 0).applyQuaternion(carro.vehicle.bodyVisual.getWorldQuaternion(new Quaternion()));
  assert.ok(arriba.y > .99999, `vertical del carro parqueado: ${arriba.y}`);
});
