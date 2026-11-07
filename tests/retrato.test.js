// El retrato de la pestaña Estado se dibuja en el lienzo del juego: tiene que ir antes del cuadro del juego, que lo
// tapa, o lo que se ve ese cuadro es la figura sola sobre fucsia. Y sin la toma de la calle, que el retrato no usa.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';

const ANCHO = 120, ALTO = 80;

/** Lienzos de mentira: lo que se dibuja del lienzo WebGL es fucsia con una figura en medio. */
function documentoFalso(lienzo) {
  const pixeles = (w, h, figura) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, dentro = figura && x >= 50 && x < 70 && y >= 10 && y < 70;
      px.set(dentro ? [40, 60, 30, 255] : [255, 0, 255, 255], i);
    }
    return px;
  };
  globalThis.document = {
    createElement: () => {
      const c = { width: 0, height: 0, px: null };
      const ctx = {
        drawImage(fuente) { c.px = fuente === lienzo ? pixeles(c.width, c.height, true) : new Uint8ClampedArray(fuente.px ?? pixeles(c.width, c.height, false)); },
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(c.px ?? pixeles(w, h, false)) }),
        putImageData(img) { c.px = new Uint8ClampedArray(img.data); },
      };
      c.getContext = () => ctx;
      return c;
    },
  };
}

function juego() {
  const draws = [];
  const lienzo = { width: ANCHO, height: ALTO };
  let claro = 0x101820;
  const gl = {
    domElement: lienzo, shadowMap: { autoUpdate: true }, autoClear: true,
    getClearColor: (c) => c.setHex(claro), getClearAlpha: () => 1,
    setClearColor(hex) { claro = new THREE.Color(hex).getHex(); },
    render(scene) { draws.push({ quien: 'figura', claro, hijos: scene.children.length }); },
  };
  documentoFalso(lienzo);
  const camera = new THREE.PerspectiveCamera(55);
  const player = { position: new THREE.Vector3(10, 0, 10), root: new THREE.Group() };
  const game = Object.assign(Object.create(Game.prototype), {
    _effectiveQuality: 'media',
    renderer: {
      instance: gl, effectiveQuality: 'media', resolution: { resetWindow() {} },
      render(scene, cam) { draws.push({ quien: cam === camera ? 'juego' : 'calle', claro }); },
    },
    sceneMgr: { scene: new THREE.Scene(), sun: new THREE.DirectionalLight() },
    cameraRig: { camera }, player, world: { active: null }, localLights: { update() {} },
    collisions: { mayOccludePlayer: () => false },
    performanceHUD: { update() { return false; } },
    _retratoPendiente: true,
  });
  game.sceneMgr.scene.add(player.root, new THREE.AmbientLight());
  return { game, draws };
}

beforeEach(() => { globalThis.window = new EventTarget(); });

test('con el retrato pendiente, lo último que se dibuja en el cuadro es el juego, no la figura sobre fucsia', () => {
  const { game, draws } = juego();
  game._renderFrame(1000, true);
  assert.equal(game._retratoPendiente, false, 'se tomó');
  assert.ok(game._retrato?.width > 0 && game._retrato.width < ANCHO, 'recortado a la figura');
  assert.deepEqual(draws.map((d) => d.quien), ['figura', 'juego'], 'una sola pasada de la figura, sin la calle, antes del juego');
  assert.equal(draws[0].claro, 0xff00ff);
  assert.equal(draws.at(-1).quien, 'juego');
  assert.notEqual(draws.at(-1).claro, 0xff00ff, 'el color de fondo vuelve antes del cuadro del juego');
  draws.length = 0;
  game._renderFrame(1016, true);
  assert.deepEqual(draws.map((d) => d.quien), ['juego'], 'una vez por apariencia');
});

test('el retrato del primer cuadro lleva la pose de ese cuadro, no la de fábrica', () => {
  const { game } = juego();
  // Un hueso que la animación ya movió este cuadro, sin que nadie haya dibujado todavía: matrixWorld sigue en cero.
  const hueso = new THREE.Bone();
  game.player.root.add(hueso);
  hueso.rotation.z = -1.3;
  let enElMundo = null;
  const gl = game.renderer.instance, render = gl.render;
  gl.render = (scene, cam) => { enElMundo = new THREE.Euler().setFromRotationMatrix(hueso.matrixWorld).z; render(scene, cam); };
  game._renderFrame(1000, true);
  assert.equal(game._retratoPendiente, false, 'se tomó');
  assert.ok(Math.abs(enElMundo + 1.3) < 1e-6, `el hueso en el mundo al tomar la figura: ${enElMundo}`);
});

test('cambiar de personaje con K vuelve a pedir el retrato', async () => {
  const game = Object.assign(Object.create(Game.prototype), {
    _retratoPendiente: false,
    player: { modelKind: 'realista', async setModel(kind) { this.modelKind = kind; } },
  });
  await game._toggleModel();
  assert.equal(game.player.modelKind, 'procedural');
  assert.equal(game._retratoPendiente, true);
  const falla = Object.assign(Object.create(Game.prototype), {
    _retratoPendiente: false,
    player: { modelKind: 'procedural', async setModel() { throw new Error('sin modelo'); } },
  });
  await assert.rejects(falla._toggleModel());
  assert.equal(falla._retratoPendiente, false, 'si el cambio falla no hay retrato nuevo que tomar');
});
