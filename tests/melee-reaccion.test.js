import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { HIT_LEAN } from '../src/character/HitLean.js';
import { WEAPONS, comboStep } from '../src/data/weapons.js';
import { CollisionSystem } from '../src/systems/CollisionSystem.js';

function modelo() {
  return { group: new THREE.Group(), cuadros: 0, update() { this.cuadros++; }, dispose() {} };
}
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  createRealisticCharacter: async () => modelo(), loadCatalog: async () => ({}),
  normalizeReal: (_catalogo, aspecto) => aspecto, optionsFor: () => [], REALISTIC_SCALE: 1
} });
const { Npc, NPC_COMBAT } = await import('../src/entities/Npc.js');
const { AngryDriver } = await import('../src/entities/AngryDriver.js');
const { SquadMember } = await import('../src/entities/SquadMember.js');

async function peaton(opciones = {}) {
  const npc = new Npc(new THREE.Scene(), new THREE.Vector3(), { look: {}, facing: 0, ...opciones });
  await npc.ready;
  npc.fullChar = npc.lodChar;
  return npc;
}

function vertical(npc) {
  npc.root.updateWorldMatrix(true, true);
  return new THREE.Vector3().setFromMatrixColumn(npc.character.group.matrixWorld, 1).normalize();
}

function angulo(npc) {
  const eje = vertical(npc);
  return Math.atan2(Math.hypot(eje.x, eje.z), eje.y);
}

function recto(npc) {
  assert.equal(npc.hitLean.active, false);
  assert.equal(npc.hitLean.applied, false);
  assert.ok(angulo(npc) < 1e-10);
}

function golpear(npc, empujon = 1, direccion = { x: 1, z: 0 }, dano = 1) {
  return npc.takeHit({ dir: direccion, knockback: empujon, damage: dano });
}

test('de frente, de lado y por la espalda la cabeza sigue el empujón aunque el peatón se gire', async () => {
  for (const rumbo of [0, 1.1, -2]) {
    for (const relativo of [Math.PI, Math.PI / 2, -Math.PI / 2, 0]) {
      const npc = await peaton({ facing: rumbo });
      const dir = { x: Math.sin(rumbo + relativo), z: Math.cos(rumbo + relativo) };
      golpear(npc, 1.6, dir);
      for (let i = 0; i < 9; i++) {
        npc.update(1 / 60);
        const eje = vertical(npc), magnitud = Math.hypot(eje.x, eje.z);
        assert.ok(magnitud > .02);
        assert.ok((eje.x * dir.x + eje.z * dir.z) / magnitud > .95, 'la vertical visible se desplaza hacia el empujón');
      }
      if (relativo === 0) assert.ok(Math.abs(npc.root.rotation.y - rumbo) > 1, 'volteó a mirar a quien tenía atrás');
      npc.dispose();
    }
  }
});

test('el ángulo crece con el empujón de cada arma y con el remate', async () => {
  let anterior = 0;
  for (const arma of [WEAPONS.cuchillo, WEAPONS.punos, WEAPONS.botella_picada, WEAPONS.arma]) {
    const picos = [];
    for (const paso of [0, arma.combo - 1]) {
      const npc = await peaton();
      const golpe = comboStep(arma, paso);
      golpear(npc, golpe.knockback, { x: 0, z: -1 }, golpe.damage);
      let pico = 0;
      for (let i = 0; i < 24; i++) { npc.update(1 / 144); pico = Math.max(pico, angulo(npc)); }
      picos.push(pico);
      npc.dispose();
    }
    assert.ok(picos[0] > anterior && picos[1] > picos[0] * 1.5, arma.name);
    anterior = picos[0];
  }
});

test('tres empujones seguidos respetan el tope conjunto y vuelven a cero antes de un segundo', async () => {
  for (const fps of [30, 60, 144]) {
    const npc = await peaton(), paso = 1 / fps;
    let pico = 0;
    for (let i = 0; i < 3; i++) {
      golpear(npc, comboStep(WEAPONS.arma, 1).knockback, { x: 1, z: 1 });
      npc.update(paso);
      pico = Math.max(pico, angulo(npc));
    }
    for (let i = 1; i < fps - 1; i++) {
      npc.update(paso);
      const actual = angulo(npc);
      pico = Math.max(pico, actual);
      if (i * paso > .5) assert.ok(actual < .009, 'después de medio segundo el rebote es menor que medio grado');
    }
    assert.ok(pico > .25 && pico <= HIT_LEAN.max + 1e-8, `${fps} cuadros/s, pico ${pico}`);
    recto(npc);
    npc.dispose();
  }
});

test('la pausa conserva posición, rumbo, pose e inclinación y reanuda con cuadros enteros', async () => {
  const npc = await peaton();
  golpear(npc);
  npc.update(.05);
  const inicio = npc.position.clone(), giro = npc.root.rotation.y, cuerpo = npc.character.group.quaternion.clone();
  const cuadros = npc.character.cuadros, tiempo = npc.staggerTimer, progreso = npc.actionProgress;
  const pausa = { restante: .05, detenida: true };
  npc.pausarImpacto(pausa);
  npc.update(.03);
  assert.ok(npc.position.equals(inicio) && npc.character.group.quaternion.equals(cuerpo));
  assert.equal(npc.root.rotation.y, giro);
  assert.equal(npc.character.cuadros, cuadros);
  assert.equal(npc.staggerTimer, tiempo);
  assert.equal(npc.actionProgress, progreso);
  for (const aLaVista of [false, true]) {
    npc.update(.01, { frustum: { intersectsSphere: () => aLaVista }, skipHiddenMatrices: true });
    assert.equal(npc.root.visible, aLaVista);
    assert.equal(npc.root.matrixWorldAutoUpdate, aLaVista);
    assert.ok(npc.character.group.quaternion.equals(cuerpo));
    assert.equal(npc.character.cuadros, cuadros);
  }
  pausa.restante = 0;
  npc.update(.03);
  assert.ok(npc.position.equals(inicio) && npc.character.group.quaternion.equals(cuerpo));
  assert.equal(npc.staggerTimer, tiempo, 'el cuadro en que termina la pausa sigue detenido');
  pausa.detenida = false;
  npc.update(.03);
  assert.ok(npc.position.x > inicio.x && Math.abs(npc.staggerTimer - (tiempo - .03)) < 1e-10);
  npc.update(.03);
  assert.ok(Math.abs(npc.staggerTimer - (tiempo - .06)) < 1e-10);
  npc.dispose();
});

test('desde el piso no se inclina y un golpe que noquea quita de inmediato la inclinación anterior', async () => {
  for (const postura of ['dormido', 'sentado', 'acurrucado', 'pedir', 'banca']) {
    const npc = await peaton({ stance: postura });
    golpear(npc, 2.88);
    npc.update(.08);
    recto(npc);
    assert.equal(npc.position.x, 0);
    npc.dispose();
  }
  const npc = await peaton();
  golpear(npc, 2);
  npc.update(.05);
  assert.ok(angulo(npc) > .07);
  npc.stance = 'sentado';
  npc.update(.01);
  recto(npc);
  npc.stance = null;
  golpear(npc, 2);
  npc.update(.05);
  assert.ok(angulo(npc) > .07);
  golpear(npc, 2, { x: -1, z: 0 }, npc.health);
  assert.ok(npc.isKnockedOut);
  recto(npc);
  npc.update(NPC_COMBAT.fall);
  assert.equal(golpear(npc, 2), false);
  recto(npc);
  npc.dispose();
});

test('el muelle sigue el cambio de modelo y se disipa fuera de cámara sin gastar animaciones', async () => {
  const npc = await peaton(), liviano = npc.lodChar;
  golpear(npc, 2);
  npc.update(.04);
  const anterior = npc.character.group.quaternion.clone(), cuadros = liviano.cuadros;
  npc.update(.01, { animationBudget: 4 });
  assert.equal(liviano.cuadros, cuadros);
  assert.ok(!npc.character.group.quaternion.equals(anterior), 'el muelle sigue avanzando entre dos cuadros de animación');
  npc.fullChar = modelo();
  npc.update(.01);
  assert.ok(liviano.group.quaternion.equals(new THREE.Quaternion()));
  assert.ok(angulo(npc) > .05);
  const cuenta = npc.fullChar.cuadros;
  const fuera = { frustum: { intersectsSphere: () => false } };
  for (let i = 0; i < 60; i++) npc.update(1 / 60, fuera);
  assert.equal(npc.fullChar.cuadros, cuenta);
  recto(npc);
  npc.dispose();
});

test('retirar, volver a usar y desechar un cuerpo lo deja derecho y sin pausa', async () => {
  const npc = await peaton();
  for (const retirar of [() => npc.scene.remove(npc.root), () => npc.dispose()]) {
    golpear(npc, 2);
    npc.update(.05);
    assert.ok(angulo(npc) > .07);
    npc.pausarImpacto({ restante: .05, detenida: true });
    retirar();
    assert.equal(npc.pausaImpacto, 0);
    recto(npc);
    if (!npc._disposed) npc.scene.add(npc.root);
  }
  for (const Tipo of [AngryDriver, SquadMember]) {
    const actor = new Tipo(new THREE.Scene(), { look: {} });
    await actor.ready;
    const puerta = new THREE.Vector3(), jugador = new THREE.Vector3(4, 0, 1);
    const bajar = () => Tipo === AngryDriver ? actor.exitCar({}, puerta) : actor.exitCar(puerta, jugador);
    bajar();
    actor.fullChar = actor.lodChar;
    golpear(actor, 2);
    actor.update(.05);
    assert.ok(angulo(actor) > .05);
    actor.pausarImpacto({ restante: .05, detenida: true });
    const lugar = actor.position.clone(), giro = actor.root.rotation.y, reloj = actor.timer;
    actor.think(.03, { player: jugador, door: puerta, canChase: true });
    actor.update(.03);
    assert.ok(actor.position.equals(lugar) && actor.root.rotation.y === giro && actor.timer === reloj);
    actor.enterCar();
    recto(actor);
    bajar();
    actor.update(.02);
    recto(actor);
    assert.equal(actor.pausaImpacto, 0);
    actor.dispose();
  }
});

test('el empujón frena desde el primer tercio y termina donde predice la base, también contra una pared y al noquear', async () => {
  const tramo = NPC_COMBAT.stagger / 3;
  const npc = await peaton();
  golpear(npc, 1.8);
  for (const recorrido of [1, 1.6, 1.8]) {
    npc.update(tramo);
    assert.ok(Math.abs(npc.position.x - recorrido) < 1e-8);
    assert.ok(Math.abs(npc._knockEnd().x - 1.8) < 1e-8);
  }
  npc.dispose();

  for (const limite of ['abierto', 'pared', 'mobiliario']) {
    const colisiones = new CollisionSystem();
    if (limite === 'pared') {
      const pared = new THREE.Object3D();
      pared.position.x = 1.1;
      colisiones.add(pared, new THREE.Vector3(.2, 3, 4));
    } else if (limite === 'mobiliario') colisiones.addFallObstacle(1, -2, 1.2, 2, 0, 1.2);
    const destino = { abierto: 1.8, pared: 1 - .32, mobiliario: .75 }[limite];
    for (const fps of [30, 60, 144]) {
      const npc = await peaton({ collisions: colisiones });
      golpear(npc, 1.8, { x: 1, z: 0 }, npc.maxHealth);
      assert.ok(Math.abs(npc._koEnd.x - destino) < .01);
      for (let i = 0; i < Math.ceil(NPC_COMBAT.stagger * fps); i++) {
        npc.update(1 / fps);
        assert.ok(npc.position.x <= destino + 1e-8, limite);
      }
      assert.ok(Math.abs(npc.position.x - destino) < .01, `${limite} a ${fps} cuadros/s`);
      npc.dispose();
    }
  }
});
