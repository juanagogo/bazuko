import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { attackExtension } from '../src/character/melee.js';
import { CameraRig } from '../src/core/Camera.js';
import { Clock } from '../src/core/Clock.js';
import { Input } from '../src/core/Input.js';
import { WEAPONS, COMBO_WINDOW, comboStep } from '../src/data/weapons.js';
import { seededRandom as azarConSemilla } from '../src/entities/npc/mind.js';
import { PolvoGolpes } from '../src/systems/PolvoGolpes.js';
import { SangreGolpes } from '../src/systems/SangreGolpes.js';

mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  optionsFor: () => [], randomReal: () => ({}),
  createRealisticCharacter: async () => ({
    group: new THREE.Group(), tiempo: 0,
    update(dt) { this.tiempo += dt; }, dispose() {}
  })
} });
const { Player } = await import('../src/entities/Player.js');
const { Npc } = await import('../src/entities/Npc.js');
const { Game } = await import('../src/core/game.js');

const frecuencias = [30, 60, 144, 2000];
// Cuadros desde la primera pulsación hasta quedar libre, medidos con estas entradas sin pausa de impacto.
const base = {
  punos: { pulsos: [.14, .48], danos: [12, 12, 18], cuadros: [33, 66, 155, 2138] },
  cuchillo: { pulsos: [.11, .40], danos: [28, 28, 42], cuadros: [27, 53, 128, 1747] },
  botella_picada: { pulsos: [.18], danos: [20, 30], cuadros: [30, 59, 140, 1932] },
  arma: { pulsos: [.26], danos: [34, 51], cuadros: [40, 80, 189, 2620] }
};
const preferencia = { matches: false };
function prepararVentana() {
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.matchMedia = () => preferencia;
  preferencia.matches = false;
}
beforeEach(prepararVentana);

function cerca(actual, esperado, margen, mensaje) {
  assert.ok(Math.abs(actual - esperado) <= margen + 1e-8, `${mensaje}: ${actual}, se esperaba ${esperado} ± ${margen}`);
}

function preparar(t, arma = 'punos') {
  const escena = new THREE.Scene(), input = new Input(), npcs = [];
  const stats = { energia: 100, salud: 100, dinero: 0, higiene: 70 };
  const audio = { golpes: [], playWhoosh() {}, updateSteps() {},
    playPunchHit(...args) { this.golpes.push(args); } };
  const jugador = new Player(escena, input, stats, audio);
  jugador.position.set(0, 0, 0);
  jugador.root.position.copy(jugador.position);
  jugador.equipWeapon(arma);
  const juego = Object.assign(Object.create(Game.prototype), {
    stats, audio, input, player: jugador, clock: new Clock(), world: { active: { npcs } },
    cameraRig: { camera: null }, creator: { isOpen: false },
    menu: { isOpen: false, open() { this.isOpen = true; } },
    interaction: {}, deathCount: 0, _save() {}
  });
  jugador.game = juego;
  function cerrar() {
    for (const npc of npcs) npc.dispose();
    jugador.polvoGolpes?.dispose();
    jugador.dispose();
  }
  t?.after(cerrar);
  async function peaton(x = 0, z = 1, opciones = {}) {
    const npc = new Npc(escena, new THREE.Vector3(x, 0, z), { look: {}, facing: Math.PI, speed: 1, ...opciones });
    npcs.push(npc);
    await npc.preload();
    npc.wait = 5;
    return npc;
  }
  function avanzar(dt) {
    juego._updatePlayerMovement(dt);
    for (const npc of npcs) npc.update(dt, { player: jugador.position });
    input.endFrame();
  }
  return { escena, npcs, juego, jugador, input, audio, peaton, avanzar, cerrar };
}

function conectar(campo) {
  const { jugador, avanzar } = campo;
  assert.equal(jugador.punch(), true);
  const dt = jugador.attack.timing.windup / 6;
  for (let i = 0; i < 6; i++) avanzar(dt);
  assert.ok(jugador.melee.pausaImpacto > 0, 'el golpe acaba de conectar');
}

function polvoVisible(escena) {
  return escena.getObjectByName('polvo-golpes')?.children.filter(nube => nube.visible) ?? [];
}

test('G produce un trazo en el impacto mortal y una marca al terminar el empujón y la caída', async t => {
  const { escena, juego, jugador, input, peaton, avanzar } = preparar(t);
  const sangre = new SangreGolpes(escena, juego.world, jugador);
  sangre.setNivel('visible', false);
  t.after(() => sangre.dispose());
  const victima = await peaton(), inicio = victima.position.clone();
  victima.health = 5;
  input.pressedThisFrame.add('KeyG');
  for (let i = 0; i < 18 && !victima.isDead; i++) avanzar(1 / 60);
  assert.equal(victima.isDead, true);
  assert.equal(sangre.contactos.children.filter(o => o.visible).length, 1);
  assert.ok(sangre.marcas.children.every(o => !o.visible));
  for (let i = 0; i < 90; i++) {
    sangre.update(1 / 60);
    if (!victima.deathSettled) assert.ok(sangre.marcas.children.every(o => !o.visible));
    avanzar(1 / 60);
  }
  const marcas = sangre.marcas.children.filter(o => o.visible);
  assert.equal(marcas.length, 1);
  assert.ok(marcas[0].position.distanceTo(victima.position) < .2);
  assert.ok(marcas[0].position.distanceTo(inicio) > .6);
});

for (const [arma, referencia] of Object.entries(base)) {
  for (const [indice, fps] of frecuencias.entries()) {
    test(`a ${fps} cuadros/s el combo de ${WEAPONS[arma].name} conserva los contactos, el daño, la energía y dura lo de la base más las pausas`, async t => {
      const { jugador, input, peaton, avanzar, audio } = preparar(t, arma);
      const victima = await peaton(0, 1, { isWalkable: (x, z) => z <= 1.08 });
      const dt = 1 / fps;
      const teclas = new Set(referencia.pulsos.map(tiempo => Math.ceil(tiempo * fps)));
      const danos = [], medidas = [];
      const duraciones = referencia.danos.map((_, paso) => comboStep(WEAPONS[arma], paso).pausaImpacto);
      assert.equal(duraciones[0], WEAPONS[arma].pausaImpacto);
      assert.ok(duraciones[0] > 0 && duraciones.at(-1) > duraciones[0], 'el remate detiene más tiempo');
      assert.equal(jugador.punch(), true);
      let cuadro = 0, inicioPausa = null;
      while (jugador.attack && cuadro < 3 * fps) {
        cuadro++;
        if (teclas.has(cuadro)) input.pressedThisFrame.add('KeyG');
        const salud = victima.health;
        avanzar(dt);
        if (victima.health < salud) {
          danos.push(salud - victima.health);
          assert.ok(jugador.melee.pausaImpacto > 0);
          inicioPausa = cuadro;
        }
        cerca(victima.pausaImpacto, jugador.melee.pausaImpacto, 1e-8, 'los dos cuerpos comparten la pausa');
        if (inicioPausa !== null && jugador.melee.pausaImpacto === 0) {
          medidas.push((cuadro - inicioPausa) * dt);
          inicioPausa = null;
        }
      }
      assert.equal(jugador.attack, null);
      assert.deepEqual(danos, referencia.danos);
      assert.equal(jugador.stats.energia, 100 - (arma === 'punos' ? 4 : 8) * referencia.danos.length);
      assert.equal(audio.golpes.length, referencia.danos.length);
      assert.equal(medidas.length, duraciones.length);
      medidas.forEach((medida, paso) => cerca(medida, duraciones[paso], dt, `pausa del golpe ${paso + 1}`));
      const totalPausas = duraciones.reduce((suma, segundos) => suma + segundos, 0);
      cerca(cuadro * dt, referencia.cuadros[indice] * dt + totalPausas, dt, 'duración del combo completo');
      const detenido = medidas.reduce((suma, segundos) => suma + segundos, 0);
      cerca(cuadro * dt - detenido, referencia.cuadros[indice] * dt, 0, 'tiempo de combate sin los cuadros de pausa');
    });
  }
}

test('a 10 cuadros/s los tres puños conservan su pausa acumulada dentro de un cuadro', async t => {
  const dt = .1, esperadas = base.punos.danos.map((_, paso) => comboStep(WEAPONS.punos, paso).pausaImpacto);
  for (const pulsos of [base.punos.pulsos, null]) {
    const { jugador, peaton, avanzar, input } = preparar(t);
    const victima = await peaton(0, 1, { speed: 0, isWalkable: (x, z) => z <= 1.08 });
    victima._defenseUsed = true;
    const avisosDeImpacto = t.mock.method(victima, 'pausarImpacto');
    const pausas = [], danos = [];
    assert.ok(jugador.punch());
    let pulso = 0;
    for (let cuadro = 0; jugador.attack && cuadro < 40; cuadro++) {
      const antes = jugador.time, salud = victima.health;
      if (!pulsos || pulsos[pulso] <= antes + 1e-9) { input.pressedThisFrame.add('KeyG'); pulso++; }
      avanzar(dt);
      if (victima.health < salud) {
        danos.push(salud - victima.health);
        pausas.push(0);
      } else if (jugador.time === antes) {
        pausas[pausas.length - 1] += dt;
      }
    }
    assert.equal(jugador.attack, null);
    assert.deepEqual(danos, base.punos.danos);
    assert.equal(avisosDeImpacto.mock.callCount(), danos.length, 'cada contacto avisa incluso si su pausa ya quedó cubierta por el redondeo');
    pausas.forEach((medida, paso) => cerca(medida, esperadas[paso], dt, `pausa del golpe ${paso + 1}`));
    const sumar = (total, segundos) => total + segundos;
    cerca(pausas.reduce(sumar, 0), esperadas.reduce(sumar, 0), dt, 'suma del tiempo que de verdad se detuvo');
  }
});

test('el cuchillo conserva la pose de contacto si un cuadro largo alcanza la recuperación', async t => {
  const { jugador, peaton, avanzar } = preparar(t, 'cuchillo');
  const victima = await peaton();
  const actualizaciones = t.mock.method(jugador.character, 'update');
  const extension = () => attackExtension(actualizaciones.mock.calls.at(-1).arguments[1].attack);
  assert.ok(jugador.punch());
  avanzar(.08);
  assert.equal(victima.health, 100);
  avanzar(.1);
  assert.equal(victima.health, 100 - WEAPONS.cuchillo.damage);
  assert.equal(extension(), 1, 'el modelo muestra el arma extendida en el cuadro del contacto');
  const brazo = jugador.character.ragdollRig.rightArm.quaternion;
  const poseDelContacto = brazo.clone();
  for (let cuadro = 0; cuadro < 3; cuadro++) {
    avanzar(.02);
    assert.ok(brazo.equals(poseDelContacto), 'el brazo conserva la pose durante la pausa');
  }
  avanzar(.02);
  assert.ok(extension() < 1 && brazo.angleTo(poseDelContacto) > .001, 'el brazo empieza a retirarse en el primer cuadro libre');
});

test('el cuerpo, la pose y el reloj del golpe se detienen, otro peatón sigue y la tecla pulsada durante la pausa encadena', async t => {
  const campo = preparar(t);
  const { jugador, juego, input, peaton, avanzar } = campo;
  const victima = await peaton(), vecino = await peaton(3, 0, { wander: 4 });
  vecino.wait = 0;
  vecino.target = new THREE.Vector3(6, 0, 0);
  conectar(campo);
  const posJugador = jugador.position.clone(), posVictima = victima.position.clone(), posVecino = vecino.position.clone();
  const giroJugador = jugador.root.quaternion.clone(), giroVictima = victima.root.quaternion.clone();
  const poseVictima = victima.character.tiempo, progreso = jugador.melee.elapsed, relojVictima = victima.staggerTimer;
  const enfriamiento = jugador.melee.cooldownRemaining;
  const poseJugador = t.mock.method(jugador.character, 'update');
  const mitad = jugador.melee.pausaImpacto / 2;
  input.keys.KeyD = true;
  input.pressedThisFrame.add('KeyG');
  const hora = juego.clock.hour;
  const dt = juego._pasoDeSimulacion(mitad);
  assert.equal(juego.paused, false);
  cerca(dt, mitad, 1e-8, 'la partida recibe todo el intervalo');
  juego.clock.update(dt);
  avanzar(dt);
  assert.ok(juego.clock.hour > hora && vecino.position.distanceTo(posVecino) > 0);
  assert.ok(jugador.position.equals(posJugador) && victima.position.equals(posVictima));
  assert.ok(jugador.root.quaternion.equals(giroJugador) && victima.root.quaternion.equals(giroVictima));
  assert.ok(poseJugador.mock.calls.every(llamada => llamada.arguments[0] === 0));
  assert.equal(victima.character.tiempo, poseVictima);
  assert.equal(jugador.melee.elapsed, progreso);
  assert.equal(jugador.melee.cooldownRemaining, enfriamiento);
  assert.equal(victima.staggerTimer, relojVictima);
  assert.equal(jugador.melee.queued, true);
  assert.equal(jugador.stats.energia, 92);
  avanzar(mitad + .01);
  assert.equal(jugador.melee.pausaImpacto, 0);
  assert.ok(jugador.position.equals(posJugador) && victima.position.equals(posVictima));
  assert.equal(jugador.melee.elapsed, progreso);
  assert.equal(victima.staggerTimer, relojVictima);
  avanzar(.02);
  assert.ok(jugador.position.distanceTo(posJugador) > 0 && victima.position.distanceTo(posVictima) > 0);
  cerca(jugador.melee.elapsed - progreso, .02, 1e-7, 'el reloj del golpe reanuda con un cuadro entero');
  cerca(relojVictima - victima.staggerTimer, .02, 1e-7, 'la reacción reanuda con el mismo cuadro');
  input.keys.KeyD = false;
  for (let i = 0; i < 45 && jugador.attack?.step === 0; i++) avanzar(.01);
  assert.equal(jugador.attack?.step, 1, 'no hubo que volver a oprimir G');
});

test('la ventana de continuación empieza tras la recuperación y cuenta los 450 ms completos', async t => {
  for (const espera of [.449, .451]) {
    const campo = preparar(t);
    const { jugador, peaton, avanzar } = campo;
    await peaton();
    conectar(campo);
    const tiempo = jugador.attack.timing;
    avanzar(tiempo.pausaImpacto);
    avanzar(tiempo.active + tiempo.recovery - .001);
    assert.equal(jugador.attack?.phase, 'recovery');
    avanzar(.001);
    assert.equal(jugador.attack, null);
    cerca(jugador.comboTimer, .45, 1e-7, 'al acabar la recuperación');
    avanzar(espera);
    assert.equal(jugador.punch(), true);
    assert.equal(jugador.attack.step, espera < .45 ? 1 : 0);
  }
});

test('un barrido de cuchillo daña a tres peatones con una pausa, un sonido y tres fogonazos', async t => {
  const campo = preparar(t, 'cuchillo');
  const { jugador, escena, peaton, avanzar, audio } = campo;
  jugador.polvoGolpes = new PolvoGolpes(escena);
  const blancos = await Promise.all([peaton(-.35), peaton(), peaton(.35)]);
  const encuentros = [];
  window.addEventListener('street-fight', e => encuentros.push(e.detail.hits));
  conectar(campo);
  assert.deepEqual(blancos.map(npc => npc.health), [72, 72, 72]);
  assert.deepEqual(encuentros, [blancos]);
  assert.deepEqual(audio.golpes, [['cuchillo', false]]);
  const posiciones = polvoVisible(escena).map(nube => nube.position.x).sort((a, b) => a - b);
  assert.equal(posiciones.length, 3);
  assert.ok(posiciones[0] < 0 && posiciones[2] > 0, 'hay polvo sobre los dos peatones laterales');
  cerca(posiciones[1], 0, .01, 'el tercer fogonazo corresponde al peatón del centro');
  const pausa = WEAPONS.cuchillo.pausaImpacto;
  cerca(jugador.melee.pausaImpacto, pausa, 1e-8, 'una sola pausa para el barrido entero');
  avanzar(pausa / 2);
  for (const npc of blancos) cerca(npc.pausaImpacto, pausa / 2, 1e-8, 'las víctimas reanudan juntas');
  avanzar(pausa / 2 + .001);
  assert.equal(jugador.melee.pausaImpacto, 0);
  assert.ok(blancos.every(npc => npc.pausaImpacto === 0));
  assert.equal(audio.golpes.length, 1);
});

test('un golpe al aire o rechazado no tiene pausa, sonido, polvo ni temblor', async t => {
  for (const rechazado of [false, true]) {
    const { escena, jugador, peaton, avanzar, audio } = preparar(t);
    jugador.polvoGolpes = new PolvoGolpes(escena);
    const victima = await peaton(0, rechazado ? 1 : 2);
    if (rechazado) t.mock.method(victima, 'takeHit', () => false);
    const rig = new CameraRig(escena, new EventTarget());
    assert.equal(jugador.punch(), true);
    for (let i = 0; i < 42; i++) {
      avanzar(.01);
      assert.equal(jugador.melee.pausaImpacto, 0);
      assert.equal(victima.pausaImpacto, 0);
    }
    assert.equal(jugador.attack, null);
    assert.equal(victima.health, 100);
    assert.equal(audio.golpes.length, 0);
    assert.equal(polvoVisible(escena).length, 0);
    assert.equal(rig.trauma, 0);
  }
});

test('el alcance al conectar andando conserva los contactos del cuadro de impacto de la base', async t => {
  for (const [arma, distancia] of [['punos', 1.809], ['cuchillo', 1.85675]]) {
    const { jugador, input, peaton, avanzar } = preparar(t, arma);
    const victima = await peaton(0, distancia);
    jugador.hasInertia = false;
    input.keys.KeyS = true;
    assert.equal(jugador.punch(), true);
    for (let i = 0; i < 9; i++) avanzar(1 / 60);
    assert.equal(victima.health, 100 - WEAPONS[arma].damage, arma);
  }
});

test('al empujar a un peatón hasta el borde del alcance, el combo de cuchillo conserva los contactos de la base', async t => {
  for (const fps of [30, 60, 144]) {
    for (const [distancia, golpes] of [[.32, 3], [.35, 2], [1.015, 2], [1.025, 1]]) {
      const { jugador, peaton, avanzar } = preparar(t, 'cuchillo');
      const victima = await peaton(0, distancia, { speed: 0 });
      victima._defenseUsed = true;
      jugador.punch();
      for (let i = 0; i < 1.5 * fps; i++) {
        if (i === Math.ceil(.17 * fps) || i === Math.ceil(.42 * fps)) jugador.punch();
        avanzar(1 / fps);
      }
      const salud = 100 - base.cuchillo.danos.slice(0, golpes).reduce((suma, dano) => suma + dano, 0);
      assert.equal(victima.health, salud, `${fps} cuadros/s, peatón a ${distancia} m`);
    }
  }
});

test('con intervalos de cuadro irregulares cada contacto inicia una pausa y el combo conserva su duración', async t => {
  const casos = [
    { arma: 'punos', ritmos: [60, 30, 144], duracionBase: 1.1319444444444446 },
    { arma: 'cuchillo', ritmos: [144, 144, 144, 144, 144, 144, 144, 144, 30], duracionBase: .8888888888888875 }
  ];
  for (const { arma, ritmos, duracionBase } of casos) {
    const { jugador, peaton, avanzar } = preparar(t, arma);
    const victima = await peaton(0, 1, { speed: 0, isWalkable: (x, z) => z <= 1.08 });
    victima._defenseUsed = true;
    jugador.punch();
    let cuadro = 0, cuadroEnPausa = 0, pulso = 0, golpes = 0, pausas = 0, tiempo = 0, combate = 0;
    let inicioPausa = 0, duracionPausa = 0;
    const cuadroMayor = 1 / Math.min(...ritmos);
    while (jugador.attack && tiempo < 3) {
      const enPausa = jugador.melee.pausaImpacto > 0;
      const indice = enPausa ? cuadroEnPausa++ : cuadro++;
      const dt = 1 / ritmos[indice % ritmos.length];
      if (combate + 1e-8 >= base[arma].pulsos[pulso]) { jugador.punch(); pulso++; }
      const salud = victima.health, duracion = jugador.attack.timing.pausaImpacto;
      avanzar(dt);
      tiempo += dt;
      if (!enPausa) combate += dt;
      if (victima.health < salud) {
        golpes++;
        pausas += duracion;
        inicioPausa = tiempo;
        duracionPausa = duracion;
        assert.ok(victima.pausaImpacto === jugador.melee.pausaImpacto && victima.pausaImpacto > 0);
      }
      if (enPausa && !jugador.melee.pausaImpacto) {
        cerca(tiempo - inicioPausa, duracionPausa, cuadroMayor, 'duración de cada pausa con cuadros irregulares');
      }
    }
    assert.equal(golpes, base[arma].danos.length);
    cerca(combate, duracionBase, 0, 'duración de los mismos cuadros activos sin pausa');
    cerca(tiempo, duracionBase + pausas, cuadroMayor, 'la cadencia irregular conserva el combo');
  }
});

const ritmosDeCombate = [[30], [60], [144], [200], [60, 30, 144, 90, 45, 144, 75]];

function generarSecuencia(arma, indice, semilla) {
  const azar = azarConSemilla(semilla), datos = WEAPONS[arma];
  const distancias = [datos.range - datos.knockback, .2, datos.range - .001,
    datos.range, datos.range + .001, .25 + azar() * (datos.range - .25)];
  const distancia = distancias[indice % distancias.length];
  const cercaDeVentana = datos.windup + datos.active + datos.recovery + COMBO_WINDOW;
  let pulsos = null; // Sin lista se machaca G en cada cuadro de combate.
  if (indice % 3 === 1) {
    pulsos = [0, cercaDeVentana + (azar() - .5) * .07, 2 * cercaDeVentana + (azar() - .5) * .1];
  } else if (indice % 3 === 2) {
    pulsos = [0, ...Array.from({ length: 2 + Math.floor(azar() * 5) }, () => azar() * 1.9)].sort((a, b) => a - b);
  }
  return { arma, semilla, distancia, pulsos, salud: indice % 8 === 1 ? 20 : 100,
    lateral: indice % 6 === 5 ? (azar() - .5) * .6 : 0,
    pared: Math.floor(indice / 6) % 2 ? distancia + .1 + azar() * .6 : Infinity,
    movimiento: [null, 'KeyS', null, 'KeyW'][indice % 4], sinDefensa: indice % 2 === 0 };
}

async function jugarSecuencia(caso, ritmos, conPausa) {
  const datos = WEAPONS[caso.arma], pausaOriginal = datos.pausaImpacto, azarOriginal = Math.random;
  let campo;
  try {
    if (!conPausa) datos.pausaImpacto = 0;
    Math.random = () => .5;
    prepararVentana();
    campo = preparar(null, caso.arma);
    const { jugador, peaton, avanzar, input } = campo;
    const victima = await peaton(caso.lateral, caso.distancia, { isWalkable: (x, z) => z <= caso.pared });
    victima.health = caso.salud;
    victima._defenseUsed = caso.sinDefensa;
    // Un saludo ambiental lee el reloj real y consume azar si la batería lleva más de catorce segundos.
    victima._lastSpokenTime = Infinity;
    Math.random = caso.azarFijo === undefined ? azarConSemilla(caso.semilla) : () => caso.azarFijo;
    const golpes = [], posiciones = [], fines = [];
    window.addEventListener('street-fight', () => {
      golpes.push([jugador.attack.step, jugador.attack.timing.damage]);
      posiciones.push(jugador.position.clone(), victima.position.clone());
    });
    let combate = 0, real = 0, cuadroActivo = 0, cuadroEnPausa = 0, pulso = 0;
    while (combate < 3.2 && real < 6) {
      const enPausa = jugador.melee.pausaImpacto > 0;
      // Los pasos activos son idénticos en las dos corridas, también con ritmos irregulares.
      const indice = enPausa ? cuadroEnPausa++ : cuadroActivo++;
      const dt = 1 / ritmos[indice % ritmos.length];
      if (!enPausa) {
        if (caso.movimiento) input.keys[caso.movimiento] = combate < 1;
        if (!caso.pulsos && combate < 1.65) input.pressedThisFrame.add('KeyG');
        while (caso.pulsos && caso.pulsos[pulso] <= combate + 1e-9) {
          input.pressedThisFrame.add('KeyG');
          pulso++;
        }
        combate += dt;
      }
      const aturdimiento = victima.staggerTimer;
      avanzar(dt);
      if (aturdimiento > 0 && victima.staggerTimer === 0) fines.push(victima.position.clone());
      real += dt;
    }
    assert.ok(combate >= 3.2, 'el combate vuelve a avanzar tras la pausa');
    if (golpes.length && conPausa) assert.ok(cuadroEnPausa > 0, 'se detuvo al conectar');
    return { firma: { golpes, dano: caso.salud - victima.health, energia: jugador.stats.energia,
      saludJugador: jugador.stats.salud, nocaut: victima.koState }, posiciones, fines };
  } finally {
    datos.pausaImpacto = pausaOriginal;
    Math.random = azarOriginal;
    campo?.cerrar();
  }
}

function compararPosiciones(conPausa, sinPausa, lugar) {
  assert.equal(conPausa.length, sinPausa.length, lugar);
  for (let i = 0; i < sinPausa.length; i++) {
    const distancia = conPausa[i].distanceTo(sinPausa[i]);
    assert.ok(distancia < .01, `${lugar}, posición ${i + 1} separada ${distancia} m`);
  }
}

test('a 200 cuadros/s el empujón contra la pared conserva los contactos en el borde del alcance', async () => {
  const caso = { arma: 'arma', distancia: .456, pared: .456 + .15, lateral: 0, movimiento: null,
    sinDefensa: true, salud: 100, azarFijo: .2, pulsos: [0, .4727, .5217, .7795, 1.5947] };
  const referencia = await jugarSecuencia(caso, [200], false);
  const actual = await jugarSecuencia(caso, [200], true);
  assert.deepEqual(referencia.firma.golpes, [[0, 34], [1, 51]]);
  assert.deepEqual(actual.firma, referencia.firma);
  compararPosiciones(actual.posiciones, referencia.posiciones, 'cuerpos al contacto');
  compararPosiciones(actual.fines, referencia.fines, 'fin del empujón');
});

for (const arma of Object.keys(base)) {
  for (const ritmos of ritmosDeCombate) {
    const ritmo = ritmos.length === 1 ? `${ritmos[0]} cuadros/s` : 'cuadros irregulares';
    test(`las secuencias de ${WEAPONS[arma].name} a ${ritmo} equivalen al mismo combate sin pausa`, async () => {
      let contactos = 0, nocauts = 0, empujones = 0;
      for (let i = 0; i < 30; i++) {
        const caso = generarSecuencia(arma, i, 11 + i);
        const referencia = await jugarSecuencia(caso, ritmos, false);
        const actual = await jugarSecuencia(caso, ritmos, true);
        const contexto = `semilla ${caso.semilla}, distancia ${caso.distancia} m, pared ${caso.pared}`;
        assert.deepEqual(actual.firma, referencia.firma, contexto);
        compararPosiciones(actual.posiciones, referencia.posiciones, `${contexto}, cuerpos al contacto`);
        compararPosiciones(actual.fines, referencia.fines, `${contexto}, fin del empujón`);
        contactos += referencia.firma.golpes.length;
        empujones += referencia.fines.length;
        if (referencia.firma.nocaut) nocauts++;
      }
      assert.ok(contactos > 0 && nocauts > 0 && empujones > 0, 'la muestra incluye contactos, nocauts y empujones completos');
    });
  }
  for (const fps of [30, 60, 144]) {
    test(`al reanudar cada golpe de ${WEAPONS[arma].name} a ${fps} cuadros/s ambos cuerpos avanzan sin tirón`, async t => {
      const { jugador, peaton, avanzar, input } = preparar(t, arma);
      const victima = await peaton(0, .75, { speed: 0 });
      victima._defenseUsed = true;
      input.keys.KeyS = true;
      let contactos = 0, reanudaciones = 0, reanudado = false;
      for (let cuadro = 0; cuadro < 3 * fps; cuadro++) {
        if (contactos < WEAPONS[arma].combo) input.pressedThisFrame.add('KeyG');
        const salud = victima.health, aturdimiento = victima.staggerTimer;
        const antesJugador = jugador.position.clone(), antesVictima = victima.position.clone();
        avanzar(1 / fps);
        if (victima.health < salud) {
          assert.equal(contactos, reanudaciones, 'el golpe anterior ya había reanudado');
          contactos++;
          reanudado = false;
        } else if (aturdimiento > 1e-8) {
          const mueveJugador = !jugador.position.equals(antesJugador);
          const mueveVictima = !victima.position.equals(antesVictima);
          const gastaAturdimiento = victima.staggerTimer < aturdimiento;
          if (!reanudado && (mueveJugador || mueveVictima || gastaAturdimiento)) {
            reanudado = true;
            reanudaciones++;
          }
          if (reanudado) {
            assert.ok(mueveJugador, `quien pega se detuvo en el cuadro ${cuadro} del golpe ${contactos}`);
            assert.ok(mueveVictima, `el peatón se detuvo en el cuadro ${cuadro} del golpe ${contactos}`);
            assert.ok(gastaAturdimiento, `se repitió el aturdimiento en el cuadro ${cuadro} del golpe ${contactos}`);
          }
        }
      }
      assert.equal(contactos, WEAPONS[arma].combo, 'se midieron todos los golpes del combo');
      assert.equal(reanudaciones, contactos, 'cada contacto reanudó antes de terminar');
    });
  }
}

const interrupciones = {
  aturdimiento: ({ jugador }) => jugador.receiveHit(new THREE.Vector3(1, 0, 0), 1),
  arresto: ({ juego }) => { juego._policeArrest(); assert.equal(juego._arrestPending, true); },
  muerte: ({ juego }) => { juego.stats.salud = 0; assert.equal(juego._handleDeath(), true); },
  menú: ({ juego }) => { juego.menu.isOpen = true; juego._pasoDeSimulacion(1 / 60); },
  foto: ({ juego }) => { juego.photoMode = { active: true }; juego._pasoDeSimulacion(1 / 60); },
  'pestaña oculta': ({ juego }) => {
    globalThis.document = { hidden: true };
    try { juego._pasoDeSimulacion(1 / 60); } finally { delete globalThis.document; }
  },
  'cinco segundos entre cuadros': ({ juego }) => cerca(juego._pasoDeSimulacion(5), .1, 1e-8, 'dt de la ciudad'),
  'cinco segundos en la simulación': ({ avanzar }) => avanzar(5)
};
for (const [nombre, interrumpir] of Object.entries(interrupciones)) {
  test(`${nombre} en pleno contacto libera al jugador y a todas las víctimas`, async t => {
    const campo = preparar(t, 'arma');
    const { jugador, peaton } = campo;
    const blancos = await Promise.all([peaton(-.3), peaton(), peaton(.3)]);
    conectar(campo);
    assert.ok(blancos.every(npc => npc.pausaImpacto > 0));
    interrumpir(campo);
    assert.equal(jugador.melee.pausaImpacto, 0);
    for (const npc of blancos) {
      assert.equal(npc.pausaImpacto, 0);
      const antes = npc.staggerTimer;
      npc.update(.01);
      assert.ok(!antes || npc.staggerTimer < antes, 'puede retomar su reacción');
    }
  });
}

test('la cámara acusa cada arma y cada remate y con movimiento reducido quedan el sonido y la pausa', async t => {
  const primeros = [];
  for (const [arma, referencia] of Object.entries(base)) {
    const { jugador, escena, peaton, avanzar } = preparar(t, arma);
    await peaton(0, 1, { isWalkable: (x, z) => z <= 1.08 });
    const rig = new CameraRig(escena, new EventTarget());
    const impulsos = [];
    jugador.punch();
    for (let i = 0; i < 300 && jugador.attack; i++) {
      if (!jugador.melee.queued && jugador.attack.step < referencia.danos.length - 1) jugador.punch();
      rig.trauma = 0;
      avanzar(.01);
      if (rig.trauma > 0) impulsos.push(rig.trauma);
    }
    assert.equal(impulsos.length, referencia.danos.length);
    assert.ok(impulsos.at(-1) > impulsos[0], `el remate de ${arma} se siente más`);
    primeros.push(impulsos[0]);
  }
  assert.ok(primeros.every((valor, i) => valor > (primeros[i - 1] ?? 0)), 'puños, cuchillo, botella y arma casera');
  preferencia.matches = true;
  const campo = preparar(t);
  const { escena, jugador, peaton, audio } = campo;
  const victima = await peaton();
  const rig = new CameraRig(escena, new EventTarget());
  jugador.polvoGolpes = new PolvoGolpes(escena);
  conectar(campo);
  assert.equal(rig.trauma, 0);
  assert.equal(polvoVisible(escena).length, 0);
  assert.equal(victima.health, 88);
  assert.equal(audio.golpes.length, 1);
  cerca(jugador.melee.pausaImpacto, WEAPONS.punos.pausaImpacto, 1e-8, 'el movimiento reducido conserva la pausa');
  assert.equal(victima.pausaImpacto, jugador.melee.pausaImpacto);
});
