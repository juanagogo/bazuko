import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as THREE from 'three';
import { seededRandom } from '../src/entities/npc/mind.js';

// El montaje, las entradas y los actores son los de sala.html. Solo se sustituyen WebGL y los GLB.
mock.module('../src/core/Renderer.js', { namedExports: {
  Renderer: class { createEnvironment() { return null; } }
} });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, loadCatalog: async () => ({}), normalizeReal: (_, look) => look,
  createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {}, dispose() {} })
} });
const { Sala } = await import('../src/sala/Sala.js');
const { PRUEBAS } = await import('../src/sala/pruebas.js');

async function montar(t, id) {
  t.mock.method(Math, 'random', seededRandom(1109));
  // La cámara guardada de la ciudad no cambia la dirección que indica W en la sala.
  const almacenamiento = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => key === 'bazuko.camera' ? 'isometric' : null
  } });
  t.after(() => {
    if (almacenamiento) Object.defineProperty(globalThis, 'localStorage', almacenamiento);
    else delete globalThis.localStorage;
  });
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  const sala = new Sala(new EventTarget());
  sala.steal = { buscado: 0 };
  const panel = await PRUEBAS.find(prueba => prueba.id === id).montar(sala);
  sala.cameraRig.follow(sala.player.position, 0);
  t.after(() => {
    window.dispatchEvent(new Event('pagehide'));
    if (sala.limpieza) sala.limpieza.dispose();
    else for (const npc of sala.npcs) npc.dispose();
    sala.player.dispose();
  });
  const elegir = texto => panel.acciones.find(accion => accion.texto === texto).hacer();
  function avanzar(cuadros = 1) {
    for (let i = 0; i < cuadros; i++) {
      sala.cameraRig.prepareMovement();
      sala.updateSimulation(1 / 60);
      sala.cameraRig.follow(sala.player.position, 1 / 60, null, sala.player.speed, sala.input.isRunning, sala.player.movement);
      sala.input.endFrame();
    }
  }
  return { sala, panel, elegir, avanzar };
}

function tecla(code, pulsada) {
  window.dispatchEvent(Object.assign(new Event(pulsada ? 'keydown' : 'keyup'), { code }));
}

test('pelea deja acercarse con W, equipa el cuchillo y muestra un contacto al hacer clic izquierdo', async t => {
  const { sala, elegir, avanzar } = await montar(t, 'pelea');
  sala.sangre.setNivel('visible', false);
  avanzar();
  assert.ok(sala.npcs.every(npc => npc.root.visible && Number.isFinite(npc._playerDist)));
  const central = sala.npcs[2];
  elegir('Cuchillo');
  tecla('KeyW', true);
  avanzar(42);
  tecla('KeyW', false);
  avanzar(2);
  assert.ok(sala.player.position.distanceTo(central.position) < sala.player.weapon.range);
  window.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }));
  avanzar(8);
  assert.ok(central.health < central.maxHealth);
  assert.equal(sala.player.equippedWeapon, 'cuchillo');
  assert.ok(sala.scene.getObjectByName('sangre-contacto')?.children.some(marca => marca.visible));
  assert.ok(sala.scene.getObjectByName('polvo-golpes')?.children.some(nube => nube.visible));

  await elegir('Nuevos peatones');
  assert.ok(central._disposed);
  assert.equal(sala.scene.getObjectByName('sangre-contacto'), undefined);
  assert.equal(sala.npcs.length, 5);
  assert.ok(sala.npcs.every(npc => npc.health === npc.maxHealth));
});

test('el encuadre de pelea despeja a los cinco peatones y deja ver la piel al acercar los cuerpos', async t => {
  const { sala } = await montar(t, 'pelea');
  assert.equal(sala.scene.getObjectByName('luz-sala-camioneta'), undefined);
  assert.ok(sala.npcs.every(npc => npc.position.z > 0));
  assert.ok(sala.cameraRig.camera.position.z < 0);
  assert.equal(sala.silhouetteTest(sala.cameraRig.camera), false);
  // Desde el frente del peatón central, pedir cuerpo completo debe hallar un hueco entre los dos vecinos.
  sala.player.root.rotation.y = -.28;
  sala.frameCharacter(false);
  const { yaw } = sala.cameraRig;
  assert.ok(sala.npcs.every(npc =>
    Math.abs(npc.position.x * Math.cos(yaw) - npc.position.z * Math.sin(yaw)) >= .64));
});

test('la camioneta recibe luz lateral de noche y activa la silueta solo si tapa el torso', async t => {
  const { sala, elegir, avanzar } = await montar(t, 'limpieza');
  const luz = sala.scene.getObjectByName('luz-sala-camioneta');
  const iluminar = () => { for (const fn of sala.beforeRender) fn(sala.cameraRig.camera); };
  iluminar();
  assert.ok(luz.isSpotLight && luz.intensity > 0 && luz.distance < 20 && !luz.castShadow);
  sala.setHour(13);
  iluminar();
  assert.equal(luz.intensity, 0);
  const desdeAtras = { position: new THREE.Vector3(13, 1.4, 0) };
  assert.equal(sala.silhouetteTest(desdeAtras), false);
  elegir('🚙 Que llegue');
  for (let i = 0; i < 600 && sala.limpieza.state !== 'out'; i++) avanzar();
  assert.equal(sala.limpieza.state, 'out');
  assert.equal(sala.silhouetteTest(desdeAtras), true);
  assert.equal(sala.silhouetteTest({ position: new THREE.Vector3(-1, 1.4, 0) }), false);
});

test('limpieza conecta G con los ocupantes que se bajan y actualiza a cada uno solo una vez por cuadro', async t => {
  const { sala, panel, elegir, avanzar } = await montar(t, 'limpieza');
  const { members } = sala.limpieza;
  assert.equal(sala.npcs.length, 0);
  elegir('🚙 Que llegue');
  for (let i = 0; i < 600 && sala.limpieza.state !== 'out'; i++) avanzar();
  assert.deepEqual(sala.npcs, members);
  const actualizaciones = members.map(m => t.mock.method(m, 'update'));
  avanzar();
  assert.ok(actualizaciones.every(m => m.mock.callCount() === 1));
  sala.updateSimulation(0);
  assert.ok(actualizaciones.every(m => m.mock.callCount() === 1));

  elegir('Puños');
  for (let i = 0; i < 180 && !members.some(m => m.health < m.maxHealth); i++) {
    if (i % 10 === 0) { tecla('KeyG', true); tecla('KeyG', false); }
    avanzar();
  }
  assert.ok(members.some(m => m.health < m.maxHealth));
  assert.ok(sala.stats.salud > 0);
  assert.match(panel.estado(), /Matón 1 · \d+ PV/);
  elegir('⏹ Que se vayan');
  assert.equal(sala.npcs.length, 0);
});

for (const arma of ['Puños', 'Cuchillo']) {
  test(`limpieza permite ganar con ${arma} y el mismo recorrido de teclado sin curar ni recolocar actores`, async t => {
    const { sala, panel, elegir, avanzar } = await montar(t, 'limpieza');
    sala.sangre.setNivel('visible', false);
    elegir(arma);
    elegir('🚙 Que llegue');
    tecla('KeyW', true);
    tecla('KeyD', true);
    avanzar(12);
    tecla('KeyD', false);
    avanzar(88);
    tecla('KeyW', false);
    for (let i = 0; i < 600 && sala.limpieza.state !== 'out'; i++) avanzar();
    assert.equal(sala.limpieza.state, 'out');

    tecla('KeyW', true);
    tecla('KeyA', true);
    for (let i = 0; i < 900 && !sala.limpieza.outcome; i++) {
      if (i === 8) { tecla('KeyW', false); tecla('KeyA', false); }
      if (i % 5 === 0) {
        if (arma === 'Cuchillo') window.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }));
        else { tecla('KeyG', true); tecla('KeyG', false); }
      }
      avanzar();
    }
    assert.equal(sala.limpieza.outcome, 'victoria');
    assert.ok(sala.stats.salud > 0 && sala.stats.energia < 100);
    assert.equal(sala.steal.buscado, 0);
    assert.equal(sala.stats.dinero, 0);
    avanzar(90);
    assert.equal(sala.limpieza.leader.deathSettled, true);
    assert.match(panel.estado(), /Desenlace · victoria/);
    assert.match(panel.estado(), /Jefe · 0 PV · fallecido/);
    assert.ok(sala.scene.getObjectByName('sangre-suelo')?.children.some(marca => marca.visible));
  });
}
