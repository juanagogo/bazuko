import assert from 'node:assert/strict';
import { test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { CARJACK } from '../src/systems/CarjackSystem.js';
import { PASO_FISICO, MAX_PASOS } from '../src/systems/CarroFisico.js';
import { alVolante, caja, carroDePrueba, entrada, escenario, estado, manejar } from './helpers/carjack-fisica.js';

test('el chasis dinámico apoya cuatro suspensiones y las ruedas se colocan según el largo y el ancho', async t => {
  const huellas = [];
  for (const [largo, ancho] of [[3.7, 1.6], [5.3, 2.3]]) {
    const escena = escenario(t, { carro: carroDePrueba({ largo, ancho }) });
    const { mundo, chasis, vehiculo } = await alVolante(escena);
    assert.ok(mundo instanceof RAPIER.World);
    assert.ok(chasis instanceof RAPIER.RigidBody && chasis.isDynamic());
    assert.ok(vehiculo instanceof RAPIER.DynamicRayCastVehicleController);
    assert.equal(vehiculo.chassis(), chasis);
    assert.equal(vehiculo.numWheels(), 4);
    const carroceria = chasis.collider(0);
    for (const [eje, medida] of [['x', largo], ['z', ancho]]) {
      let dimension = 0;
      for (const signo of [-1, 1]) {
        const origen = carroceria.translation(), direccion = { x: 0, y: 0, z: 0 };
        origen[eje] += signo * 8;
        direccion[eje] = -signo;
        const distancia = carroceria.castRay(new RAPIER.Ray(origen, direccion), 10, true);
        assert.ok(distancia > 0 && distancia < 8);
        dimension += 8 - distancia;
      }
      assert.ok(Math.abs(dimension - medida) < .12, `carro de ${medida} m en ${eje}, chasis de ${dimension} m`);
    }
    manejar(escena, 1, entrada(1));
    const apoyos = [];
    for (let i = 0; i < 4; i++) {
      assert.ok(vehiculo.wheelIsInContact(i) && vehiculo.wheelSuspensionForce(i) > 0);
      assert.ok(vehiculo.wheelSuspensionRestLength(i) > 0 && vehiculo.wheelMaxSuspensionTravel(i) > 0);
      apoyos.push(vehiculo.wheelChassisConnectionPointCs(i));
    }
    assert.equal(new Set(apoyos.map(p => Math.sign(p.x) + ',' + Math.sign(p.z))).size, 4);
    const separacion = eje => Math.max(...apoyos.map(p => p[eje])) - Math.min(...apoyos.map(p => p[eje]));
    huellas.push([separacion('x'), separacion('z')]);
  }
  assert.ok(huellas[1][0] > huellas[0][0] * 1.2 && huellas[1][1] > huellas[0][1] * 1.2,
    `batalla y vía de ambos carros: ${JSON.stringify(huellas)}`);
});

test('acelera por el +X local, llega al tope en 2–4 s, frena antes de ir en reversa y respeta ambos límites', async t => {
  const rumbo = .83, carro = carroDePrueba({ x: 4, z: -3, rumbo });
  const escena = escenario(t, { carro }), { sistema, juego } = escena;
  const { chasis } = await alVolante(escena);
  sistema._dom = { hud: {}, speed: {} };
  const salida = carro.position.clone();
  const frente = new Vector3(Math.cos(rumbo), 0, -Math.sin(rumbo));
  let alTope, frenando = false, reversa = false, minima = 0;
  function comprobarVelocidad() {
    const h = carro.group.rotation.y, v = chasis.linvel();
    const sobreElFrente = v.x * Math.cos(h) - v.z * Math.sin(h);
    assert.ok(Math.abs(sistema.speed - sobreElFrente) < .035, `marcador ${sistema.speed}, chasis ${sobreElFrente}`);
    assert.ok(sistema.speed <= CARJACK.maxSpeed + .0001 && sistema.speed >= -CARJACK.reverseSpeed - .0001);
    assert.equal(sistema._dom.speed.textContent, Math.round(Math.abs(sistema.speed) * 3.6) + ' km/h');
    assert.equal(sistema.audioEntry.speed, Math.abs(sistema.speed));
    assert.ok(juego.player.position.distanceTo(carro.position) < .00001);
  }
  manejar(escena, 5, entrada(1), 60, segundos => {
    comprobarVelocidad();
    if (sistema.speed >= CARJACK.maxSpeed - .02) alTope ??= segundos;
  });
  assert.ok(alTope >= 2 && alTope <= 4, `tiempo hasta el tope: ${alTope} s`);
  assert.ok(carro.position.clone().sub(salida).dot(frente) > 40);
  const costado = new Vector3(-frente.z, 0, frente.x);
  assert.ok(Math.abs(carro.position.clone().sub(salida).dot(costado)) < .1);
  manejar(escena, 6, entrada(-1), 60, () => {
    comprobarVelocidad();
    if (sistema.speed > 0 && sistema.speed < CARJACK.exitSpeed) frenando = true;
    if (sistema.speed < -1) { assert.ok(frenando); reversa = true; }
    minima = Math.min(minima, sistema.speed);
  });
  assert.ok(reversa && minima <= -CARJACK.reverseSpeed + .02, `reversa máxima: ${minima} m/s`);
  const inicioReversa = carro.position.clone(), rumboReversa = carro.group.rotation.y;
  manejar(escena, .5, entrada(-1, 1));
  assert.ok(carro.position.clone().sub(inicioReversa).dot(frente) < -1);
  assert.ok(carro.group.rotation.y < rumboReversa - .02, 'a la izquierda, la cola gira al retroceder');
});

test('la misma maniobra es determinista y termina a menos de medio metro entre 30, 60 y 144 Hz', async t => {
  async function recorrido(hz) {
    const escena = escenario(t);
    await alVolante(escena);
    const muestras = [];
    for (const [segundos, mando] of [
      [3, entrada(1)], [.5, entrada(1, .65)], [.5, entrada(0, .65, true)],
      [1, entrada(1, -.45)], [1, entrada(-1)], [.5, entrada()]
    ]) {
      manejar(escena, segundos, mando, hz);
      muestras.push(estado(escena));
    }
    return muestras;
  }
  const a = await recorrido(60), b = await recorrido(60);
  assert.deepEqual(a, b);
  const treinta = await recorrido(30), cientoCuarenta = await recorrido(144);
  for (const [p, q] of [[a, treinta], [a, cientoCuarenta], [treinta, cientoCuarenta]]) {
    for (let i = 0; i < p.length; i++) {
      const diferencia = new Vector3(...p[i].slice(0, 3)).distanceTo(new Vector3(...q[i].slice(0, 3)));
      assert.ok(diferencia < .5, `tramo ${i + 1}: ${diferencia} m`);
    }
  }
});

test('la pestaña oculta avanza únicamente el tope de pasos de 1/60 s y descarta los segundos sobrantes', async t => {
  const escena = escenario(t), fisica = await alVolante(escena);
  manejar(escena, 4, entrada(1));
  assert.ok(escena.sistema.speed > CARJACK.maxSpeed - .05);
  const partida = escena.carro.position.clone(), intervalos = [], avanzar = fisica.mundo.step;
  t.mock.method(fisica.mundo, 'step', function (...args) {
    intervalos.push(this.timestep);
    return avanzar.apply(this, args);
  });
  escena.sistema.update(5, entrada(1));
  assert.ok(intervalos.length > 0 && intervalos.length <= MAX_PASOS, `pasos: ${intervalos.length}`);
  assert.ok(intervalos.every(dt => Math.abs(dt - 1 / 60) < 1e-7));
  assert.equal(PASO_FISICO, 1 / 60);
  assert.ok(escena.carro.position.distanceTo(partida) <= CARJACK.maxSpeed * MAX_PASOS / 60 + .005);
  intervalos.length = 0;
  escena.sistema.update(1 / 60, entrada(1));
  assert.equal(intervalos.length, 1, 'el cuadro siguiente vuelve a su duración normal');

  const muro = 65, contraMuro = escenario(t, { estaticas: [caja(muro, -8, muro + .2, 8)] });
  await alVolante(contraMuro);
  const mando = entrada(1), parachoques = () => contraMuro.carro.position.x + contraMuro.carro.length / 2;
  for (let i = 0; i < 420 && parachoques() < muro - .7; i++) contraMuro.sistema.update(1 / 60, mando);
  assert.ok(parachoques() < muro && parachoques() > muro - .8 && contraMuro.sistema.speed > 14.9);
  contraMuro.sistema.update(5, mando);
  assert.ok(parachoques() <= muro + .05 && contraMuro.sistema.speed < 3, 'la pausa termina con el carro de este lado del muro');
  assert.ok(contraMuro.avisos.includes('¡Me estrellé!'));
});

test('el freno de mano aumenta el ángulo de derrape sobre la misma curva y al soltarlo vuelve el agarre', async t => {
  async function curva(frenoMano) {
    const escena = escenario(t), { chasis } = await alVolante(escena);
    manejar(escena, 4, entrada(1));
    function deslizamiento() {
      const h = escena.carro.group.rotation.y, v = chasis.linvel();
      const longitudinal = v.x * Math.cos(h) - v.z * Math.sin(h);
      const lateral = v.x * Math.sin(h) + v.z * Math.cos(h);
      return Math.atan2(Math.abs(lateral), Math.abs(longitudinal)) * 180 / Math.PI;
    }
    let mayor = 0;
    manejar(escena, .6, entrada(0, 1, frenoMano), 60, () => {
      const v = chasis.linvel();
      if (Math.hypot(v.x, v.z) > 4) mayor = Math.max(mayor, deslizamiento());
    });
    manejar(escena, 2, entrada(1));
    assert.ok(escena.sistema.speed > 5, 'sale del derrape en marcha');
    return { mayor, recuperado: deslizamiento() };
  }
  const normal = await curva(false), conFreno = await curva(true);
  assert.ok(conFreno.mayor > 12 && conFreno.mayor > normal.mayor + 5,
    `curva normal ${normal.mayor}°, con freno de mano ${conFreno.mayor}°`);
  assert.ok(conFreno.recuperado < 5 && conFreno.recuperado < conFreno.mayor / 2,
    `después de soltarlo: ${conFreno.recuperado}°`);
});
