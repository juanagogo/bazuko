import assert from 'node:assert/strict';
import { Box3, Group, Vector3 } from 'three';
import { CarjackSystem, CARJACK } from '../../src/systems/CarjackSystem.js';
import { CollisionSystem } from '../../src/systems/CollisionSystem.js';

export function caja(x1, z1, x2, z2, y1 = 0, y2 = 2) {
  return { box: new Box3(new Vector3(x1, y1, z1), new Vector3(x2, y2, z2)) };
}

export function carroDePrueba({ x = 0, y = 0, z = 0, rumbo = 0, largo = 4.2, ancho = 1.8 } = {}) {
  const group = new Group(), carroceria = new Group(), bodyVisual = new Group();
  group.position.set(x, y, z);
  group.rotation.y = rumbo;
  group.add(carroceria);
  carroceria.add(bodyVisual);
  return {
    group, position: group.position, length: largo, width: ancho, marker: { visible: true },
    vehicle: { group: carroceria, bodyVisual }, setNight() {}, animateDrive() {}
  };
}

export function entrada(acelerador = 0, izquierda = 0, frenoMano = false, bajarse = false) {
  return {
    axis: { x: -izquierda, z: -acelerador },
    isDown: tecla => tecla === 'Space' && frenoMano,
    consumePress(tecla) {
      if (tecla !== CARJACK.key || !bajarse) return false;
      bajarse = false;
      return true;
    }
  };
}

export function escenario(t, {
  carro = carroDePrueba(), suelo = () => 0, agua, estaticas = [], dinamicas = [], opciones = { fisica: true }
} = {}) {
  globalThis.window = Object.assign(new EventTarget(), { performance: globalThis.performance });
  const avisos = [];
  window.addEventListener('toast', evento => avisos.push(evento.detail.text));
  const colisiones = new CollisionSystem();
  colisiones.colliders = estaticas;
  colisiones.dynamicColliders = dinamicas;
  const juego = {
    cars: [carro], traffic: { vehicles: [] },
    player: { position: carro.position.clone().add(new Vector3(0, 0, -1.5)), root: new Group(), velocity: new Vector3() },
    cameraRig: { mode: 'third-person', yaw: 0, distance: 5.5 },
    collisions: colisiones, world: { active: { getMovementGroundHeight: suelo, getWaterInfo: agua } },
    steal: { buscado: 0 }, stats: { salud: 100, addXP() {} }
  };
  const sistema = new CarjackSystem(juego, opciones);
  juego.carjack = sistema;
  t.after(() => sistema.reset());
  return { carro, juego, sistema, avisos };
}

export function completarTransicion({ sistema }) {
  const sinTeclas = entrada();
  for (let i = 0; sistema.transition && i < 180; i++) sistema.update(1 / 60, sinTeclas);
  assert.equal(sistema.transition, null, 'la transición termina en menos de tres segundos');
}

export function subir(escena) {
  escena.sistema.enter({ car: escena.carro });
  completarTransicion(escena);
  assert.equal(escena.sistema.car, escena.carro);
}

export async function alVolante(escena) {
  subir(escena);
  const fisica = await escena.sistema.fisicaLista;
  assert.ok(fisica?.mundo, 'al quedar al volante está creado el mundo de Rapier');
  assert.equal(escena.sistema.chasis, fisica);
  return fisica;
}

export function manejar({ sistema }, segundos, mando = entrada(), hz = 60, observar) {
  const cuadros = Math.round(segundos * hz);
  for (let i = 0; i < cuadros; i++) {
    sistema.update(1 / hz, mando);
    observar?.((i + 1) / hz);
  }
}

export function estado({ carro, sistema }) {
  return [...carro.position.toArray(), carro.group.rotation.y, sistema.speed];
}
