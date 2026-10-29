import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { SubstanceEffects, filterCss } from '../src/systems/SubstanceEffects.js';

let clock, sound, events;

beforeEach(() => {
  clock = 0;
  events = new EventTarget();
  sound = {
    onsets: [], sustains: [], stops: 0, disposed: 0, updates: [],
    playOnset(id) { this.onsets.push(id); },
    startSustain(id) { this.sustains.push(id); },
    stopSustain() { this.stops++; },
    update(intensity, opts) { this.updates.push([intensity, opts]); },
    dispose() { this.disposed++; }
  };
});

const effects = (opts = {}) => new SubstanceEffects({ sound, now: () => clock, eventTarget: events, reducedMotion: false, ...opts });
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('un efecto nuevo sube en 3 s, se sostiene y se apaga al cumplir su duración', () => {
  const fx = effects();
  fx.consume('pegante');
  assert.equal(fx.intensity, 0);
  fx.update(1.5); assert.ok(close(fx.intensity, 0.5));
  fx.update(1.5); assert.equal(fx.intensity, 1);
  fx.update(29);  assert.ok(close(fx.intensity, 0.5)); // 32 de 35 s
  assert.equal(fx.active, true);
  fx.update(3);   assert.equal(fx.active, false);
  assert.equal(fx.intensity, 0);
  assert.deepEqual(sound.onsets, ['pegante']);
  assert.deepEqual(sound.sustains, ['pegante']);
  assert.equal(sound.stops, 1);
});

test('en pausa la duración no avanza y el sonido de consumir suena al instante', () => {
  const fx = effects();
  fx.consume('hierba');
  assert.deepEqual(sound.onsets, ['hierba']);
  clock += 5000;
  assert.equal(fx.intensity, 0);
  assert.equal(fx.active, true);
  assert.equal(fx.currentId, 'hierba');
  fx.update(1.5);
  assert.ok(close(fx.intensity, 0.5));
});

test('repetir la misma sustancia renueva la duración sin bajar la intensidad', () => {
  const fx = effects();
  fx.consume('pastilla');
  fx.update(3);
  fx.update(40);
  assert.ok(close(fx.intensity, 1 / 3));
  fx.consume('pastilla');
  assert.ok(close(fx.intensity, 1 / 3));
  fx.update(0.1);
  assert.ok(fx.intensity > 1 / 3);
  assert.deepEqual(sound.onsets, ['pastilla', 'pastilla']);
  assert.deepEqual(sound.sustains, ['pastilla']);
  fx.update(44);
  assert.equal(fx.active, true);
});

test('cambiar de sustancia desvanece la anterior en 1 s reales antes de subir la nueva', () => {
  const fx = effects();
  fx.consume('pegante');
  fx.update(3);
  fx.consume('pastilla');
  assert.equal(fx.currentId, 'pegante');
  assert.equal(fx.intensity, 1);
  clock += 500;
  assert.ok(close(fx.intensity, 0.5));
  clock += 600;
  assert.equal(fx.currentId, 'pastilla');
  assert.equal(fx.intensity, 0);
  fx.update(1.5);
  assert.ok(close(fx.intensity, 0.5));
  assert.equal(sound.stops, 1);
  assert.deepEqual(sound.sustains, ['pegante', 'pastilla']);
  assert.deepEqual(sound.onsets, ['pegante', 'pastilla']);
});

test('si se piden varias sustancias durante un desvanecido, gana la última', () => {
  const fx = effects();
  fx.consume('pegante');
  fx.update(3);
  fx.consume('pastilla');
  fx.consume('hierba');
  clock += 1100;
  assert.equal(fx.currentId, 'hierba');
  assert.deepEqual(sound.sustains, ['pegante', 'hierba']);
});

test('los cortes forzados se desvanecen en tiempo real aun en pausa', () => {
  const fx = effects();
  fx.consume('hierba');
  fx.update(3);
  fx.end();
  assert.equal(fx.intensity, 1);
  clock += 500;
  assert.ok(close(fx.intensity, 0.5));
  clock += 600;
  assert.equal(fx.active, false);
  assert.equal(sound.stops, 1);
  fx.end();
  assert.equal(sound.stops, 1);
});

test('un corte forzado descarta la sustancia que esperaba su turno', () => {
  const fx = effects();
  fx.consume('pegante');
  fx.update(3);
  fx.consume('pastilla');
  fx.end();
  clock += 1100;
  assert.equal(fx.active, false);
  assert.deepEqual(sound.sustains, ['pegante']);
});

test('tintico no activa nada y el evento substance-consumed sí', () => {
  const fx = effects();
  assert.equal(fx.consume('tintico'), false);
  assert.deepEqual(sound.onsets, []);
  assert.equal(fx.active, false);
  events.dispatchEvent(new CustomEvent('substance-consumed', { detail: { id: 'pegante' } }));
  assert.equal(fx.currentId, 'pegante');
  fx.dispose();
  assert.equal(fx.active, false);
  assert.equal(sound.disposed, 1);
  events.dispatchEvent(new CustomEvent('substance-consumed', { detail: { id: 'hierba' } }));
  assert.equal(fx.active, false);
  assert.deepEqual(sound.onsets, ['pegante']);
});

// ===== Imagen =====

function fakeCanvas() {
  const draws = [];
  const ctx2d = { globalAlpha: 1, drawImage(...args) { draws.push(args); }, clearRect() {} };
  const doc = {
    createElement: (tag) => ({
      tag, style: { cssText: '' }, width: 0, height: 0, removed: false,
      getContext: () => ctx2d, remove() { this.removed = true; }
    })
  };
  const canvas = { style: { filter: '' }, ownerDocument: doc, inserted: [], after(...els) { this.inserted.push(...els); } };
  return { canvas, draws };
}

function visualFixture(opts = {}) {
  const { canvas, draws } = fakeCanvas();
  const fx = effects({ canvas, ...opts });
  const [trail, overlay] = canvas.inserted;
  return { fx, canvas, draws, trail, overlay, camera: new THREE.PerspectiveCamera(55) };
}

test('filterCss arma el filtro en orden y omite blur cuando se pide', () => {
  assert.equal(filterCss({ hueRotate: 55, blur: 1.6, sepia: 0.35 }), 'blur(1.6px) sepia(0.35) hue-rotate(55deg)');
  assert.equal(filterCss({ contrast: 1.12, saturate: 2.3, brightness: 0.9 }), 'saturate(2.3) brightness(0.9) contrast(1.12)');
  assert.equal(filterCss({ hueRotate: 12.34567 }), 'hue-rotate(12.346deg)');
  assert.equal(filterCss({ blur: 1.6, sepia: 0.35 }, { blur: false }), 'sepia(0.35)');
  assert.equal(filterCss({}), '');
});

test('las capas quedan sobre el juego y bajo el HUD', () => {
  const { canvas, trail, overlay } = visualFixture();
  assert.equal(canvas.inserted.length, 2);
  assert.equal(trail.tag, 'canvas');
  assert.equal(overlay.tag, 'div');
  for (const el of [trail, overlay]) {
    assert.match(el.style.cssText, /z-index:0/);
    assert.match(el.style.cssText, /pointer-events:none/);
  }
});

test('mientras dura el efecto el canvas lleva el filtro de la receta y al terminar se limpia', () => {
  const { fx, canvas, overlay, trail, camera } = visualFixture();
  fx.consume('pegante');
  fx.update(3);
  fx.beforeRender(camera); fx.afterRender(camera);
  assert.match(canvas.style.filter, /blur\(/);
  assert.match(canvas.style.filter, /sepia\(/);
  assert.equal(overlay.style.mixBlendMode, 'multiply');
  fx.end();
  clock += 1100;
  fx.beforeRender(camera); fx.afterRender(camera);
  assert.equal(canvas.style.filter, '');
  assert.equal(overlay.style.opacity, '0');
  assert.equal(trail.style.opacity, '0');
});

test('sin efecto no toca el filtro de otros sistemas', () => {
  const { fx, canvas, camera } = visualFixture();
  canvas.style.filter = 'contrast(140%)'; // la psicosis lo escribe en cada cuadro
  fx.beforeRender(camera); fx.afterRender(camera);
  assert.equal(canvas.style.filter, 'contrast(140%)');
});

test('si otro sistema borra el filtro, el siguiente cuadro lo repone', () => {
  const { fx, canvas, camera } = visualFixture();
  fx.consume('hierba');
  fx.update(3);
  fx.beforeRender(camera); fx.afterRender(camera);
  canvas.style.filter = '';
  fx.beforeRender(camera); fx.afterRender(camera);
  assert.match(canvas.style.filter, /sepia\(/);
});

test('en calidad baja no hay estela ni blur', () => {
  const { fx, canvas, trail, draws, camera } = visualFixture();
  fx.consume('pegante');
  fx.update(3);
  fx.beforeRender(camera, { quality: 'baja' });
  fx.afterRender(camera);
  assert.doesNotMatch(canvas.style.filter, /blur\(/);
  assert.match(canvas.style.filter, /sepia\(/);
  assert.equal(trail.style.opacity, '0');
  assert.equal(draws.length, 0);
  fx.beforeRender(camera, { quality: 'alta' });
  fx.afterRender(camera);
  assert.equal(draws.length, 1);
});

test('la cámara se distorsiona solo durante el render y vuelve a su lugar', () => {
  const { fx, camera } = visualFixture();
  camera.rotation.z = 0.01;
  fx.consume('pegante');
  fx.update(3);
  fx.beforeRender(camera);
  assert.notEqual(camera.fov, 55);
  assert.notEqual(camera.rotation.z, 0.01);
  fx.afterRender(camera);
  assert.equal(camera.fov, 55);
  assert.equal(camera.rotation.z, 0.01);
});

test('con movimiento reducido la cámara se mueve al 20 %', () => {
  const offset = (reducedMotion) => {
    const { fx, camera } = visualFixture({ reducedMotion });
    fx.consume('pegante');
    fx.update(3);
    fx.beforeRender(camera);
    return camera.fov - 55;
  };
  const full = offset(false), calm = offset(true);
  assert.ok(Math.abs(full) > 0.5);
  assert.ok(Math.abs(calm - 0.2 * full) < 1e-9);
});

test('la estela sigue el tamaño de la ventana', () => {
  const { fx, trail, draws, camera } = visualFixture();
  globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
  try {
    fx.consume('pastilla');
    fx.update(3);
    fx.beforeRender(camera); fx.afterRender(camera);
    assert.deepEqual([trail.width, trail.height], [640, 360]);
    globalThis.innerWidth = 800; globalThis.innerHeight = 600;
    fx.beforeRender(camera); fx.afterRender(camera);
    assert.deepEqual([trail.width, trail.height], [400, 300]);
    assert.deepEqual(draws.at(-1).slice(1), [0, 0, 400, 300]);
  } finally {
    delete globalThis.innerWidth; delete globalThis.innerHeight;
  }
});

test('dispose quita las capas y limpia el filtro', () => {
  const { fx, canvas, trail, overlay, camera } = visualFixture();
  fx.consume('pegante');
  fx.update(3);
  fx.beforeRender(camera); fx.afterRender(camera);
  fx.dispose();
  assert.equal(canvas.style.filter, '');
  assert.equal(trail.removed, true);
  assert.equal(overlay.removed, true);
});

test('repetir la misma sustancia no hace saltar la cámara ni los colores', () => {
  const { fx, canvas, camera } = visualFixture();
  fx.consume('pastilla');
  fx.update(3);
  fx.update(10);
  fx.beforeRender(camera);
  const before = { fov: camera.fov, filter: canvas.style.filter };
  fx.afterRender(camera);
  fx.consume('pastilla');
  fx.beforeRender(camera);
  assert.equal(camera.fov, before.fov);
  assert.equal(canvas.style.filter, before.filter);
  fx.afterRender(camera);
});

test('al ocultar la pestaña la capa sostenida calla aunque el juego deje de dibujar', () => {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const canvas = { style: { filter: '' }, ownerDocument: doc };
  const fx = effects({ canvas });
  fx.consume('pegante');
  fx.update(3);
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(sound.updates.at(-1), [1, { paused: true }]);
  fx.dispose();
  const count = sound.updates.length;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(sound.updates.length, count);
});
