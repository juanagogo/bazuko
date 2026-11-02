import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { AutoQuality, effectiveQuality } from '../src/core/GraphicsQuality.js';
import { AdaptiveResolution } from '../src/core/AdaptiveResolution.js';
import { Renderer } from '../src/core/Renderer.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  window.devicePixelRatio = 1;
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
});

const run = (auto, ms, frameMs, options) => {
  const actions = [];
  for (let t = 0; t < ms; t += frameMs) {
    const action = auto.sample(frameMs, 4, options);
    if (action) actions.push(action);
  }
  return actions;
};

test('el peldaño automático se suma a lo elegido y la presión lo resta', () => {
  assert.equal(effectiveQuality('baja', 0, 1), 'media');
  assert.equal(effectiveQuality('baja', 1, 1), 'baja');
  assert.equal(effectiveQuality('alta', 0, 1), 'alta');
  assert.equal(effectiveQuality('media', 1), 'baja', 'sin peldaño sigue igual que siempre');
});

test('solo sube tras unos veinte segundos holgados y una sola vez', () => {
  const auto = new AutoQuality(true);
  assert.deepEqual(run(auto, 19500, 16.7), []);
  assert.deepEqual(run(auto, 1000, 16.7), ['subir']);
  assert.deepEqual(run(auto, 60000, 16.7), [], 'esperando la compilación no pide más');
});

test('un equipo justo no sube: los tirones, la presión o la resolución recortada reinician la cuenta', () => {
  const auto = new AutoQuality(true);
  for (let i = 0; i < 40; i++) {
    assert.deepEqual(run(auto, 1200, 16.7), []);
    for (let j = 0; j < 12; j++) auto.sample(33, 4);
  }
  assert.deepEqual(run(new AutoQuality(true), 60000, 16.7, { pressure: 1 }), []);
  assert.deepEqual(run(new AutoQuality(true), 60000, 16.7, { atMaxRatio: false }), []);
  assert.deepEqual(run(new AutoQuality(true), 60000, 22), [], '45 FPS no cuentan como holgura');
  assert.deepEqual(run(new AutoQuality(false), 60000, 16.7), [], 'quien eligió calidad no entra');
});

test('si en media no aguanta, baja y no vuelve a intentarlo en la sesión', () => {
  const auto = new AutoQuality(true);
  run(auto, 21000, 16.7);
  auto.preparing = false; auto.tier = 1; auto.reset();
  assert.deepEqual(run(auto, 30000, 16.7), [], 'si aguanta, se queda');
  assert.deepEqual(run(auto, 4000, 25), ['bajar']);
  assert.equal(auto.tier, 0);
  assert.deepEqual(run(auto, 60000, 16.7), []);
});

test('la holgura acepta el trabajo real de un cuadro en baja y rechaza al que no aguantaría las sombras', () => {
  // Medido en una partida a 60 FPS: mediana 8,4 ms, p90 9,5 ms, p99 10,3 ms. Antes el tope de 9 ms la reiniciaba sin parar.
  const works = [8.4, 8.4, 8.4, 9.5, 8.4, 8.4, 8.4, 8.4, 9.5, 8.4, 10.3, 8.4];
  const calm = new AutoQuality(true);
  const actions = [];
  let elapsed = 0;
  for (let i = 0; elapsed < 21000; i++, elapsed += 16.7) {
    const action = calm.sample(16.7, works[i % works.length]);
    if (action) actions.push(action);
  }
  assert.deepEqual(actions, ['subir']);
  const loaded = new AutoQuality(true);
  for (let t = 0; t < 60000; t += 16.7) assert.equal(loaded.sample(16.7, 13), null, 'con 13 ms en baja, las sombras no caben en 60 FPS');
});

test('volver de una pestaña oculta no cuenta como holgura ni como tirón', () => {
  const slow = new AutoQuality(true);
  assert.deepEqual(run(slow, 10000, 33), []);
  assert.equal(slow.sample(25000, 4), null, 'el intervalo oculto no llena los 20 s de espera');
  assert.equal(slow.preparing, false);
  assert.deepEqual(run(slow, 10000, 33), []);
  const calm = new AutoQuality(true);
  assert.deepEqual(run(calm, 19000, 16.7), []);
  assert.equal(calm.sample(25000, 4), null);
  assert.deepEqual(run(calm, 19000, 16.7), [], 'la espera vuelve a empezar');
  assert.deepEqual(run(calm, 2000, 16.7), ['subir']);
  const raised = new AutoQuality(true);
  raised.tier = 1;
  assert.equal(raised.sample(25000, 4), null, 'con sombras, una vuelta de pestaña no baja la calidad');
  assert.equal(raised.tier, 1);
  assert.equal(raised.blocked, false);
});

test('con sombras, varios cortes en una ventana sí bajan; uno suelto entre cuadros normales no', () => {
  const sueltos = new AutoQuality(true);
  sueltos.tier = 1;
  for (let i = 0; i < 12; i++) {
    assert.equal(sueltos.sample(600, 4), null);
    assert.deepEqual(run(sueltos, 5000, 16.7), [], 'un tirón cada cinco segundos es un tirón aislado');
  }
  assert.equal(sueltos.tier, 1);
  const seguidos = new AutoQuality(true);
  seguidos.tier = 1;
  assert.equal(seguidos.sample(600, 4), null);
  assert.equal(seguidos.sample(600, 4), null);
  assert.equal(seguidos.sample(600, 4), 'bajar');
  assert.equal(seguidos.tier, 0);
  assert.equal(seguidos.blocked, true);
});

test('intervalos que rozan los 250 ms no esconden a un equipo que no aguanta', () => {
  // Cada patrón alterna valores a lado y lado del límite, o mete un tirón antes de cerrar la ventana.
  const patterns = {
    'cortes con un cuadro normal entre ellos': i => i % 2 ? 16 : 600,
    '4 a 5 FPS': i => i % 2 ? 300 : 200,
    'justo a lado y lado del límite': i => i % 2 ? 260 : 240
  };
  for (const [name, frame] of Object.entries(patterns)) {
    const auto = new AutoQuality(true);
    auto.tier = 1;
    let elapsed = 0, action = null;
    for (let i = 0; !action && elapsed < 10000; i++) {
      const ms = frame(i);
      elapsed += ms;
      action = auto.sample(ms, 4);
    }
    assert.equal(action, 'bajar', name);
    assert.ok(elapsed < 4000, `${name}: tardó ${elapsed} ms`);
  }
  const lento = new AutoQuality(true);
  lento.tier = 1;
  let action = null, elapsed = 0;
  // 25 FPS con un tirón cada 2,5 s: antes cada tirón reiniciaba la ventana de 3 s y nunca bajaba.
  for (let next = 2500; !action && elapsed < 20000;) {
    const ms = elapsed >= next ? 300 : 40;
    if (ms === 300) next += 2500;
    elapsed += ms;
    action = lento.sample(ms, 4);
  }
  assert.equal(action, 'bajar');
  assert.ok(elapsed < 5000, `tardó ${elapsed} ms`);
});

function fakeRenderer(saved = null) {
  if (saved) localStorage.setItem('bazuko.graphics_quality', saved);
  const compiled = [];
  const instance = {
    shadowMap: { enabled: false }, ratio: 1,
    setPixelRatio(value) { this.ratio = value; }, getPixelRatio() { return this.ratio; },
    compileAsync() { compiled.push({ shadows: this.shadowMap.enabled, cast: sun.castShadow }); return Promise.resolve(); }
  };
  const sun = { castShadow: false };
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    resolution: new AdaptiveResolution(1), instance,
    autoQuality: new AutoQuality(localStorage.getItem('bazuko.graphics_quality') === null),
    _lastFrame: { scene: {}, camera: {}, shadowLights: [sun] }
  });
  return { renderer, compiled, sun, instance };
}

test('subir compila con sombra sin encenderla antes de tiempo y nunca guarda la preferencia', async () => {
  const { renderer, compiled, sun, instance } = fakeRenderer();
  renderer.setQuality('baja');
  assert.equal(localStorage.getItem('bazuko.graphics_quality'), null, 'el arranque no es una elección');
  assert.equal(renderer.effectiveQuality, 'baja');
  renderer.autoQuality.preparing = true;
  const done = renderer._raiseAutoQuality();
  assert.deepEqual(compiled, [{ shadows: true, cast: true }]);
  assert.equal(instance.shadowMap.enabled, false, 'mientras compila se sigue dibujando en baja');
  assert.equal(sun.castShadow, false);
  assert.equal(await done, true);
  assert.equal(renderer.effectiveQuality, 'media');
  assert.equal(renderer.quality, 'baja', 'lo elegido no cambia');
  assert.equal(instance.shadowMap.enabled, true);
  assert.equal(localStorage.getItem('bazuko.graphics_quality'), null);
});

test('bajar deja la calidad como estaba; una elección del jugador apaga todo el sistema', async () => {
  const { renderer, instance } = fakeRenderer();
  renderer.setQuality('baja');
  renderer.autoQuality.preparing = true;
  await renderer._raiseAutoQuality();
  renderer.autoQuality.tier = 0; renderer.autoQuality.blocked = true;
  renderer._dropAutoQuality();
  assert.equal(renderer.effectiveQuality, 'baja');
  assert.equal(instance.shadowMap.enabled, false);
  assert.equal(renderer.resolution.pressure, 0);

  const second = fakeRenderer();
  second.renderer.setQuality('baja');
  second.renderer.autoQuality.preparing = true;
  await second.renderer._raiseAutoQuality();
  second.renderer.setQuality('baja');
  assert.equal(second.renderer.effectiveQuality, 'baja');
  assert.equal(second.instance.shadowMap.enabled, false);
  assert.equal(localStorage.getItem('bazuko.graphics_quality'), 'baja', 'esta sí fue una elección');
  assert.equal(second.renderer.autoQuality.eligible, false);
});

test('con una preferencia guardada no cambia nada, y si el jugador elige mientras compila manda él', async () => {
  const saved = fakeRenderer('baja');
  saved.renderer.setQuality('baja');
  assert.equal(saved.renderer.autoQuality.eligible, false);
  for (let i = 0; i < 2000; i++) saved.renderer.adaptResolution(16.7, 4);
  assert.equal(saved.renderer.effectiveQuality, 'baja');

  localStorage.setItem('bazuko.graphics_quality', '');
  const racing = fakeRenderer();
  racing.renderer.autoQuality = new AutoQuality(true);
  racing.renderer.setQuality('baja');
  racing.renderer.autoQuality.preparing = true;
  const done = racing.renderer._raiseAutoQuality();
  racing.renderer.setQuality('alta');
  assert.equal(await done, false);
  assert.equal(racing.renderer.effectiveQuality, 'alta');

  const failing = fakeRenderer();
  failing.renderer.autoQuality = new AutoQuality(true);
  failing.renderer.setQuality('baja');
  failing.instance.compileAsync = () => Promise.reject(new Error('sin paralelo'));
  assert.equal(await failing.renderer._raiseAutoQuality(), false);
  assert.equal(failing.renderer.effectiveQuality, 'baja');
  assert.equal(failing.renderer.autoQuality.blocked, true);
});

test('a 60 FPS reales el intervalo que oscila alrededor del límite no devuelve a baja', () => {
  const auto = new AutoQuality(true);
  run(auto, 21000, 16.7);
  auto.preparing = false; auto.tier = 1; auto.reset();
  // Uno de cada tres cuadros mide 17,5 ms y el siguiente lo compensa: más del 20 % parece lento, y siguen siendo 60 FPS.
  const actions = [];
  for (let frame = 0; frame < 900; frame++) {
    const action = auto.sample(frame % 3 ? 16.25 : 17.5, 8);
    if (action) actions.push(action);
  }
  assert.deepEqual(actions, []);
  assert.equal(auto.tier, 1);
  assert.deepEqual(run(auto, 4000, 16.7, { pressure: 1 }), ['bajar'], 'Con presión sí baja, aunque vaya a 60 FPS');
});

test('un equipo que de verdad no aguanta sigue bajando', () => {
  const auto = new AutoQuality(true);
  run(auto, 21000, 16.7);
  auto.preparing = false; auto.tier = 1; auto.reset();
  assert.deepEqual(run(auto, 4000, 20.4), ['bajar'], '49 FPS');
});

test('mientras compila la subida los tirones no bajan la resolución', () => {
  const samples = [];
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    _settleFrames: 0, autoQuality: { preparing: true, sample() { samples.push('calidad'); return null; } },
    resolution: { ratio: 1, min: .75, pressure: 0, resetWindow() { samples.push('reinicia'); }, sample() { samples.push('resolución'); return false; } }
  });
  renderer.adaptResolution(120, 110);
  assert.deepEqual(samples, ['reinicia']);
  renderer.autoQuality.preparing = false;
  samples.length = 0;
  renderer.adaptResolution(16, 5);
  assert.deepEqual(samples, ['calidad', 'resolución']);
});
