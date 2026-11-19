import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SangreGolpes } from '../src/systems/SangreGolpes.js';
import { AngryDriver } from '../src/entities/AngryDriver.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { CHURCH, CHURCH_STEPS } from '../src/world/bogota/EastZones.js';
import { bridgeCenter } from '../src/world/bogota/Colpatria.js';
import { viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';
import { Game } from '../src/core/game.js';
import { ZonaAviso } from '../src/ui/ZonaAviso.js';

const consulta = { matches: false };
test.before(() => { globalThis.matchMedia = () => consulta; });
test.after(() => { delete globalThis.matchMedia; });
test.beforeEach(() => { consulta.matches = false; });
const persona = (x = 0, y = 0, z = 0) => ({ position: new THREE.Vector3(x, y, z), deathSettled: false });
const visibles = grupo => grupo.children.filter(objeto => objeto.visible);

function partida(t, distrito = { getMovementGroundHeight: () => 0 }) {
  const escena = new THREE.Scene(), jugador = persona(), eventos = new EventTarget();
  const sangre = new SangreGolpes(escena, { active: distrito }, jugador, eventos);
  t.after(() => sangre.dispose());
  return { sangre, jugador, escena, emitir: (tipo, detail) => eventos.dispatchEvent(new CustomEvent(tipo, { detail })) };
}

test('solo el daño confirmado de una pelea produce señal, localizada en la persona alcanzada', t => {
  const { sangre, jugador, escena, emitir } = partida(t);
  sangre.setNivel('discreta', false);
  const victima = persona(0, .12, 1.1), vecino = persona(1.3, .12, 1.1);
  const tela = new THREE.MeshStandardMaterial({ color: '#52685d' });
  t.after(() => tela.dispose());
  const pecho = new THREE.Vector3(0, 1.39, 1.1);
  for (const npc of [victima, vecino]) npc.character = { ropa: tela, pecho: punto => punto.copy(pecho) };
  emitir('death', { cause: 'hambre' });
  emitir('street-fight', { attacker: jugador, hits: [victima] });
  emitir('street-fight', { attacker: jugador, results: [{ target: victima, damage: 0 }] });
  emitir('street-fight', { attacker: vecino, results: [{ target: victima, damage: 20 }] });
  emitir('npc-player-hit', { attacker: vecino, victim: jugador, damage: 0 });
  assert.equal(escena.children.length, 0);
  emitir('street-fight', { attacker: jugador, results: [
    { target: victima, damage: 22, weapon: 'cuchillo' }, { target: vecino, damage: 0, weapon: 'cuchillo' }
  ] });
  const [trazo] = visibles(sangre.contactos);
  assert.equal(visibles(sangre.contactos).length, 1);
  assert.equal(trazo.position.y, pecho.y);
  assert.ok(trazo.position.z < pecho.z && pecho.distanceTo(trazo.position) < .23);
  assert.equal(tela.color.getHexString(), '52685d');
  assert.equal(vecino.character.ropa, victima.character.ropa);
  assert.notEqual(trazo.material, tela);
  const opacidad = trazo.material.opacity;
  sangre.update(0);
  assert.equal(trazo.material.opacity, opacidad);
  sangre.update(.12);
  assert.ok(trazo.material.opacity > 0 && trazo.material.opacity < opacidad);
  sangre.update(.13);
  assert.equal(escena.children.length, 0);

  emitir('npc-player-hit', { attacker: vecino, victim: jugador, weapon: 'punos', damage: 10 });
  const [devuelto] = visibles(sangre.contactos);
  assert.ok(Math.hypot(devuelto.position.x, devuelto.position.z) < .23);
  assert.ok(devuelto.scale.x < trazo.scale.x);
  emitir('npc-death', { victim: victima, attacker: jugador, position: victima.position });
  assert.equal(sangre.marcas.parent, null, 'Discreta solo señala el contacto');
});

test('la marca espera la caída, toma el apoyo final, desaparece gradualmente y la misma muerte no se duplica', t => {
  const { sangre, emitir, jugador } = partida(t);
  sangre.setNivel('visible', false);
  const victima = persona(1, 0, 2), inicio = victima.position.clone();
  const avisar = () => emitir('npc-death', { victim: victima, attacker: jugador, position: inicio });
  avisar(); avisar();
  sangre.update(1);
  assert.equal(visibles(sangre.marcas).length, 0);
  victima.position.set(3, 0, 2.2);
  victima.deathSettled = true;
  sangre.update(.016);
  const [marca] = visibles(sangre.marcas);
  assert.equal(visibles(sangre.marcas).length, 1);
  assert.ok(marca.position.distanceTo(victima.position) < .23 && marca.position.distanceTo(inicio) > 1.8);
  const alfa = marca.material.opacity;
  sangre.update(20);
  assert.ok(marca.material.opacity < alfa && marca.material.opacity > 0);
  sangre.update(4);
  avisar(); sangre.update(.1);
  assert.equal(sangre.marcas.parent, null);
});

test('un objeto largo señala la zona de contacto y conserva un trazo distinto para cada víctima del barrido', t => {
  const { sangre, jugador, escena } = partida(t);
  sangre.setNivel('visible', false);
  const objeto = new THREE.Group();
  objeto.name = 'weapon-arma';
  const tabla = new THREE.Mesh(new THREE.BoxGeometry(.04, .6, .02).translate(0, .3, 0));
  objeto.add(tabla); escena.add(objeto);
  t.after(() => { tabla.geometry.dispose(); tabla.material.dispose(); });
  jugador.character = { anclaGolpe: () => objeto };
  const frente = persona(0, 0, .83), lado = persona(1, 0, .83);
  sangre.contacto(jugador, frente, 'arma', 34);
  sangre.contacto(jugador, lado, 'arma', 34);
  objeto.position.set(0, .92, .2);
  objeto.rotation.x = Math.PI / 4;
  const [primera, segunda] = visibles(sangre.contactos);
  primera.onBeforeRender(); segunda.onBeforeRender();
  assert.ok(primera.position.y > objeto.position.y + .34);
  assert.ok(primera.position.z > objeto.position.z + .35);
  assert.ok(segunda.position.x > .6, 'el segundo efecto sigue en la segunda víctima');
  assert.ok(primera.position.distanceTo(segunda.position) > .6);
});

test('el conductor emite sobre el tramo visible de su varilla, orientada hacia abajo desde la mano', t => {
  const { sangre, jugador, escena } = partida(t);
  const conductor = persona(0, 0, 0);
  conductor.bar = AngryDriver.prototype._createBar();
  const { pivot, geometry, material } = conductor.bar;
  escena.add(pivot);
  t.after(() => { geometry.dispose(); material.dispose(); });
  jugador.position.set(0, 0, 1.12);
  sangre.setNivel('discreta', false);
  sangre.contacto(conductor, jugador, 'varilla', 18);
  pivot.position.set(-.07, 1.32, .2);
  pivot.rotation.x = -Math.PI / 2;
  const [trazo] = visibles(sangre.contactos);
  trazo.onBeforeRender();
  assert.ok(Math.abs(trazo.position.y - pivot.position.y) < .02);
  assert.ok(trazo.position.z - pivot.position.z > .65);
  assert.ok(trazo.position.x < -.04);
});

test('el apoyo conserva la cara seca del viaducto, la calle inferior y cada peldaño del atrio real', t => {
  const ciudad = new Bogota();
  ciudad.map = ciudad._layout();
  const { sangre } = partida(t, ciudad);
  sangre.setNivel('visible', false);
  function marcar(x, y, z) {
    sangre.limpiar();
    sangre.muere({ ...persona(x, y, z), deathSettled: true });
    sangre.update(.016);
    return visibles(sangre.marcas)[0];
  }
  function encima(marca, altura, mensaje) {
    assert.ok(marca, mensaje);
    marca.updateMatrixWorld();
    for (const u of [-.5, 0, .5]) for (const v of [-.5, 0, .5]) {
      const punto = new THREE.Vector3(u, 0, v).applyMatrix4(marca.matrixWorld);
      const separacion = punto.y - ciudad.getMovementGroundHeight(punto.x, punto.z, altura);
      assert.ok(separacion > 0 && separacion < .02, `${mensaje}: ${separacion}`);
    }
  }
  const xPuente = 78.5, zLago = 262;
  const arriba = viaductSurface(xPuente, zLago);
  encima(marcar(xPuente, arriba, zLago), arriba, 'tablero sobre agua');
  assert.equal(marcar(xPuente, ciudad.getWaterInfo(xPuente, zLago).bottomY, zLago), undefined, 'lecho sumergido');
  const zCalle = 90, xCalle = bridgeCenter(zCalle);
  const calle = ciudad.getMovementGroundHeight(xCalle, zCalle, 0);
  assert.ok(viaductSurface(xCalle, zCalle) - calle > 2);
  encima(marcar(xCalle, calle, zCalle), calle, 'calle debajo del tablero');
  const zRampa = 28, xRampa = bridgeCenter(zRampa), rampa = viaductSurface(xRampa, zRampa);
  const inclinada = marcar(xRampa, rampa, zRampa);
  encima(inclinada, rampa, 'rampa de Colpatria');
  assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(inclinada.quaternion).y < .995);
  const zIglesia = CHURCH.z0 + CHURCH.z1, frente = CHURCH.x0 * 2 - 1;
  for (const { top, depth } of CHURCH_STEPS) {
    const x = frente - depth + .02;
    const marca = marcar(x, top, zIglesia);
    encima(marca, top, 'peldaño del atrio');
    assert.ok(marca.scale.x < .50, 'junto a la contrahuella cabe una huella más angosta');
  }
  const extremo = frente - CHURCH_STEPS[1].depth - .02;
  const anterior = marcar(extremo, CHURCH_STEPS[0].top, zIglesia);
  assert.ok(anterior.position.x < frente - CHURCH_STEPS[1].depth);
  encima(anterior, CHURCH_STEPS[0].top, 'borde superior del peldaño anterior');
  assert.equal(marcar(xCalle, calle + 3, zCalle), undefined, 'sin un apoyo inmediato no se proyecta a otra planta');
});

test('movimiento reducido retira el contacto activo y conserva la marca estática de Visible', t => {
  const { sangre, jugador, escena } = partida(t);
  sangre.setNivel('visible', false);
  const victima = { ...persona(0, 0, 1), deathSettled: true };
  sangre.contacto(jugador, victima, 'arma', 34);
  sangre.muere(victima);
  sangre.update(.01);
  assert.equal(visibles(sangre.contactos).length, 1);
  const [marca] = visibles(sangre.marcas), pose = marca.position.clone(), escala = marca.scale.clone();
  consulta.matches = true;
  sangre.update(0);
  sangre.contacto(jugador, victima, 'arma', 34);
  assert.equal(sangre.contactos.parent, null);
  assert.deepEqual(marca.position, pose);
  assert.deepEqual(marca.scale, escala);
  assert.equal(marca.visible, true);
  sangre.setNivel('desactivada', false);
  sangre.muere({ ...persona(), deathSettled: true });
  assert.equal(escena.children.length, 0);
});

test('la caída y su marca sobreviven al rótulo de otro barrio y se retiran al cambiar de distrito', t => {
  const distrito = { _zoneAt: x => x < 69 ? 'andenes' : 'metro', getMovementGroundHeight: () => .12 };
  const { sangre, jugador, escena } = partida(t, distrito);
  sangre.setNivel('visible', false);
  const doc = { createElement: () => ({}), getElementById: () => ({ append() {} }) };
  const juego = Object.assign(Object.create(Game.prototype), {
    player: jugador, world: sangre.mundo, sangre, zonaAviso: new ZonaAviso({ doc })
  });
  jugador.position.set(68.99, .12, 75);
  juego._actualizarZona(.01);
  const caida = persona(68.6, .12, 75);
  sangre.muere(caida);
  jugador.position.x = 69.01;
  juego._actualizarZona(.01);
  caida.deathSettled = true;
  juego._actualizarZona(.01);
  const [marca] = visibles(sangre.marcas);
  assert.ok(marca);
  jugador.position.x = 68.99;
  juego._actualizarZona(.01);
  assert.equal(marca.visible, true);
  const pendiente = persona(68.7, .12, 75);
  sangre.muere(pendiente);
  juego.world.active = { ...distrito };
  juego._actualizarZona(.01);
  pendiente.deathSettled = true;
  juego._actualizarZona(.01);
  assert.equal(escena.children.length, 0);
});

test('pelear reutiliza la reserva, los recursos y el azar, y salir cancela las caídas pendientes', t => {
  const { sangre, jugador, escena, emitir } = partida(t);
  sangre.setNivel('visible', false);
  const actores = Array.from({ length: 120 }, (_, i) => ({ ...persona(i / 4), deathSettled: true }));
  const materiales = [...sangre.contactos.children, ...sangre.marcas.children].map(o => o.material);
  const recursos = [sangre.marcas.children[0].geometry, materiales[0].map, ...materiales];
  const azar = t.mock.method(Math, 'random');
  for (const victima of actores) {
    sangre.contacto(jugador, victima, 'arma', 34);
    sangre.muere(victima);
    sangre.update(.001);
  }
  assert.equal(azar.mock.callCount(), 0, 'el nivel de sangre no altera el azar del siguiente golpe');
  assert.equal(visibles(sangre.contactos).length, 8);
  assert.equal(visibles(sangre.marcas).length, 6);
  assert.deepEqual([...sangre.contactos.children, ...sangre.marcas.children].map(o => o.material), materiales);
  assert.ok(materiales.every(m => m.map === materiales[0].map));
  sangre.muere(persona());
  sangre.limpiar();
  sangre.update(1);
  assert.equal(escena.children.length, 0);
  assert.ok(sangre.marcas.children.every(m => !m.userData.caida));
  const liberados = new Set();
  for (const recurso of recursos) recurso.addEventListener('dispose', () => {
    assert.ok(!liberados.has(recurso));
    liberados.add(recurso);
  });
  sangre.dispose(); sangre.dispose();
  emitir('npc-player-hit', { attacker: actores[0], victim: jugador, weapon: 'punos', damage: 10 });
  assert.equal(liberados.size, recursos.length);
  assert.equal(escena.children.length, 0);
});
