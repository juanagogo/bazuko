import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { Npc } from '../src/entities/Npc.js';
import { AudioSystem } from '../src/systems/AudioSystem.js';
import { SceneManager } from '../src/core/Scene.js';
import { Farol } from '../src/world/props/Farol.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById(id) {
      return null;
    },
    createElement(tag) {
      return {
        className: '',
        textContent: '',
        style: {},
        classList: {
          add() {},
          remove() {},
          toggle() {}
        },
        remove() {}
      };
    },
    body: {
      appendChild() {},
      classList: {
        toggle() {}
      }
    }
  };
});

test('Físicas GTA: inclinación centrífuga (banking) al girar en carrera', () => {
  const scene = new THREE.Scene();
  const input = {
    axis: { x: 1, z: 0 },
    isRunning: true,
    consumePress() { return false; },
    isDown() { return true; }
  };

  const player = new Player(scene, input);
  assert.equal(player.root.rotation.z, 0);

  // Girar en curva a alta velocidad
  player.update(0.1, null, null);
  assert.notEqual(player.root.rotation.z, 0, 'El cuerpo debe inclinarse en la dirección del giro');

  // Al detenerse, el cuerpo recupera la verticalidad
  input.axis = { x: 0, z: 0 };
  input.isRunning = false;
  for (let i = 0; i < 20; i++) player.update(0.1, null, null);
  assert.ok(Math.abs(player.root.rotation.z) < 0.01, 'El cuerpo se endereza al detenerse');
});

test('Físicas GTA: mecánica de salto, gravedad y caída libre', () => {
  const scene = new THREE.Scene();
  let pressed = true;
  const input = {
    axis: { x: 0, z: 0 },
    isRunning: false,
    consumePress(key) {
      if ((key === 'Space' || key === 'KeySpace') && pressed) {
        pressed = false;
        return true;
      }
      return false;
    },
    isDown() { return false; }
  };

  const audio = {
    playJump() { audio.jumpCalled = true; },
    playLanding() { audio.landCalled = true; },
    jumpCalled: false,
    landCalled: false
  };

  const player = new Player(scene, input, null, audio);
  assert.equal(player.isGrounded, true);
  assert.equal(player.position.y, 0);

  // 1. Iniciar salto
  player.update(0.016, null, null);
  assert.equal(player.isGrounded, false, 'El jugador despega del suelo');
  assert.ok(player.jumpVelocity > 4.0, 'Tiene velocidad vertical de impulso');
  assert.equal(player.action, 'saltar');
  assert.equal(audio.jumpCalled, true);

  // 2. Punto álgido del salto
  player.update(0.2, null, null);
  assert.ok(player.position.y > 0.35, 'El personaje gana altura en el aire');

  // 3. Caída y aterrizaje
  for (let i = 0; i < 30; i++) player.update(0.05, null, null);
  assert.equal(player.isGrounded, true, 'El personaje aterriza');
  assert.equal(player.position.y, 0, 'Se asienta sobre la cota del suelo');
  assert.equal(audio.landCalled, true);
});

test('Combate callejero GTA: puñetazo, impacto con transeúnte, reacción y botín', () => {
  const scene = new THREE.Scene();
  let punchPressed = true;
  const input = {
    axis: { x: 0, z: 0 },
    isRunning: false,
    consumePress(key) {
      if (key === 'KeyG' && punchPressed) {
        punchPressed = false;
        return true;
      }
      return false;
    },
    isDown() { return false; }
  };

  const audio = {
    playWhoosh() { audio.whoosh = true; },
    playPunchHit() { audio.punchHit = true; },
    whoosh: false,
    punchHit: false
  };

  const stats = { dinero: 1000 };
  const player = new Player(scene, input, stats, audio);
  player.position.set(10, 0, 10);
  player.root.rotation.y = 0; // Mirando hacia +Z

  // Transeúnte ubicado 1 metro al frente
  const npc = new Npc(scene, new THREE.Vector3(10, 0, 11), { look: {} });
  assert.equal(npc.panicTimer, 0);

  // Lanzar puñetazo
  player.update(0.1, null, null, null, [npc]);

  assert.equal(player.action, 'golpear');
  assert.equal(audio.whoosh, true);
  assert.equal(audio.punchHit, true, 'El golpe conecta con el peatón');
  assert.ok(npc.panicTimer > 0, 'El transeúnte entra en estado de pánico y huida');
  assert.ok(stats.dinero > 1000, 'El jugador recoge el botín arrojado por el peatón');
  assert.ok(npc._bubbleEl !== null, 'El peatón grita una frase bogotana al ser golpeado');
});

test('Gráficos: Farol nocturno con cono volumétrico de luz y material emisivo', () => {
  const farol = new Farol(new THREE.Vector3(5, 0, 5));
  assert.ok(farol.lamp);
  assert.ok(farol.lightBeam);

  // De día el haz está apagado
  farol.setNight(false);
  assert.equal(farol.lightBeam.visible, false);

  // De noche el haz se enciende y la lámpara emite luz
  farol.setNight(true);
  assert.equal(farol.lightBeam.visible, true);
  assert.ok(farol.lamp.material.emissiveIntensity > 2.0);
});

test('Gráficos: SceneManager con seguimiento solar y niebla según lluvia', () => {
  const mgr = new SceneManager();
  const pos = new THREE.Vector3(20, 0, 20);

  // Mañana (7 AM): sol viene del oriente (-x)
  mgr.followTarget(pos, 7.0);
  assert.ok(mgr.sun.position.x < pos.x, 'El sol de la mañana viene de los cerros orientales');

  // Tarde (17 PM): sol va hacia el occidente (+x)
  mgr.followTarget(pos, 17.0);
  assert.ok(mgr.sun.position.x > pos.x, 'El sol de la tarde se proyecta hacia la sabana occidental');

  // Lluvia: la niebla se hace más densa (menor alcance)
  mgr.setTimeOfDay(14.0, false, 0);
  const clearFar = mgr.scene.fog.far;

  mgr.setTimeOfDay(14.0, true, 0.8);
  const rainFar = mgr.scene.fog.far;
  assert.ok(rainFar < clearFar, 'La bruma de lluvia reduce la distancia de niebla para ambiente de páramo');
});
