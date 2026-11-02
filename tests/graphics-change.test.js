// Cambiar de calidad o de resolución no puede dejar un cuadro negro ni congelar el juego.
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { Renderer } from '../src/core/Renderer.js';
import { AdaptiveResolution } from '../src/core/AdaptiveResolution.js';
import { AutoQuality } from '../src/core/GraphicsQuality.js';
import { Game } from '../src/core/game.js';
import { openPauseMenu } from '../src/ui/PauseMenu.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  window.devicePixelRatio = 1;
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
});

function fakeRenderer({ saved = null, shadows = false, compile = () => Promise.resolve() } = {}) {
  if (saved) localStorage.setItem('bazuko.graphics_quality', saved);
  const log = [], compiled = [], sun = { castShadow: shadows };
  const instance = {
    shadowMap: { enabled: shadows },
    info: { reset() { log.push('reinicia'); } },
    setPixelRatio(value) { log.push(`resolución ${value}`); },
    render() { log.push('dibuja'); },
    compileAsync() { compiled.push({ shadows: this.shadowMap.enabled, cast: sun.castShadow }); return compile(); }
  };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    resolution: new AdaptiveResolution(1), instance, autoQuality: new AutoQuality(saved === null),
    culling: { apply() {}, restore() {} }, silhouette: { render() {} }, _pixelRatio: 1,
    _lastFrame: { scene, camera, shadowLights: [sun] }
  });
  renderer.autoQuality.started = true;
  return { renderer, instance, log, compiled, sun, draw: () => renderer.render(scene, camera, null, [sun]) };
}

function fakeGame(options) {
  const fake = fakeRenderer(options), applied = [], toasts = [];
  window.addEventListener('toast', event => toasts.push(event.detail.text));
  const game = Object.assign(Object.create(Game.prototype), {
    renderer: fake.renderer,
    sceneMgr: { setQuality: quality => applied.push(quality) },
    cameraRig: { setQuality() {} }, weather: { wetness: 0 }, world: { active: { setWetness() {} } }
  });
  return { ...fake, game, applied, toasts };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('la resolución cambia justo antes de dibujar: el lienzo borrado nunca llega a la pantalla', () => {
  const { renderer, log, draw } = fakeRenderer({ saved: 'baja' });
  for (let i = 0; i < 300; i++) renderer.adaptResolution(40);
  assert.ok(renderer.resolution.ratio < 1, 'la presión bajó la resolución');
  assert.deepEqual(log, [], 'adaptResolution corre tras dibujar y no toca el lienzo');
  draw();
  assert.deepEqual(log, ['reinicia', `resolución ${renderer.resolution.ratio}`, 'dibuja']);
  log.length = 0;
  draw();
  assert.deepEqual(log, ['reinicia', 'dibuja'], 'sin cambio no se vuelve a borrar el lienzo');
});

test('bajar de calidad sola o elegir en Ajustes tampoco tocan el lienzo fuera del cuadro', () => {
  const { renderer, log, draw } = fakeRenderer();
  renderer.resolution.ratio = .75;
  renderer._dropAutoQuality();
  assert.deepEqual(log, []);
  draw();
  assert.deepEqual(log, ['reinicia', 'dibuja'], 'volvió a la resolución que ya tenía el lienzo');
  log.length = 0;
  renderer.resolution.ratio = .75;
  draw();
  log.length = 0;
  renderer.setQuality('media');
  assert.deepEqual(log, [], 'en la pausa se dibuja a 15 Hz: el lienzo quedaría negro hasta el siguiente');
  draw();
  assert.deepEqual(log, ['reinicia', 'resolución 1', 'dibuja']);
});

test('al tocar el mínimo de resolución deja compilada la variante sin sombras antes de apagarlas', () => {
  const { renderer, instance, compiled, sun } = fakeRenderer({ saved: 'media', shadows: true });
  renderer.setQuality('media');
  let atCompile = null;
  for (let i = 0; i < 500; i++) {
    renderer.adaptResolution(40);
    if (compiled.length && !atCompile) atCompile = { enabled: instance.shadowMap.enabled, pressure: renderer.resolution.pressure, cast: sun.castShadow };
  }
  assert.deepEqual(compiled, [{ shadows: false, cast: false }], 'una sola vez y con las sombras apagadas');
  assert.deepEqual(atCompile, { enabled: true, pressure: 0, cast: true }, 'todavía no hace falta: se sigue dibujando con sombras');
  assert.equal(instance.shadowMap.enabled, false, 'la presión termina apagándolas');
  const started = fakeRenderer({ saved: 'baja', shadows: true });
  started.renderer.setQuality('baja');
  started.renderer.autoQuality.tier = 1;
  started.instance.shadowMap.enabled = true;
  for (let i = 0; i < 500; i++) started.renderer.adaptResolution(40);
  assert.deepEqual(started.compiled, [], 'quien partió de baja ya la compiló al cargar');
});

test('los tirones de recién prendidas las sombras no bajan la calidad ni la resolución', async () => {
  const { renderer } = fakeRenderer();
  renderer.quality = 'baja';
  renderer.autoQuality.preparing = true;
  assert.equal(await renderer._raiseAutoQuality(), true);
  for (const ms of [2500, 900, 433, 600]) renderer.adaptResolution(ms);
  for (let i = 0; i < 16; i++) renderer.adaptResolution(16.7);
  assert.equal(renderer.effectiveQuality, 'media');
  assert.equal(renderer.autoQuality.blocked, false);
  assert.equal(renderer.resolution.ratio, 1);
  for (let i = 0; i < 300; i++) renderer.adaptResolution(40);
  assert.equal(renderer.effectiveQuality, 'baja', 'pasados esos cuadros, un equipo lento sigue bajando');
  assert.equal(renderer.autoQuality.blocked, true);
});

test('sin cambio de sombras o sin cuadros dibujados, la calidad se aplica en el acto', () => {
  const start = fakeGame();
  start.renderer._lastFrame = undefined;
  start.game.setGraphicsQuality('media', false);
  assert.deepEqual(start.compiled, []);
  assert.deepEqual(start.applied, ['media'], 'el arranque no puede esperar a una compilación');
  const running = fakeGame({ saved: 'media', shadows: true });
  running.game.setGraphicsQuality('alta');
  assert.deepEqual(running.compiled, []);
  assert.deepEqual(running.applied, ['alta']);
  assert.equal(running.renderer.quality, 'alta');
  assert.deepEqual(running.toasts, ['Calidad gráfica: alta']);
});

test('prender las sombras compila antes, sin dejar de dibujar; lo elegido se muestra y se guarda ya', async () => {
  let finish;
  const { game, renderer, instance, sun, compiled, applied, toasts } = fakeGame({ compile: () => new Promise(resolve => { finish = resolve; }) });
  game.setGraphicsQuality('media');
  assert.deepEqual(compiled, [{ shadows: true, cast: true }]);
  assert.equal(instance.shadowMap.enabled, false, 'mientras compila se sigue dibujando sin sombras');
  assert.equal(sun.castShadow, false);
  assert.deepEqual(applied, []);
  assert.equal(game.chosenQuality, 'media');
  assert.equal(localStorage.getItem('bazuko.graphics_quality'), 'media');
  assert.equal(renderer.autoQuality.blocked, true, 'la calidad ya no cambia sola');
  assert.deepEqual(toasts, []);
  finish();
  await flush();
  assert.deepEqual(applied, ['media']);
  assert.equal(renderer.effectiveQuality, 'media');
  assert.equal(instance.shadowMap.enabled, true);
  assert.deepEqual(toasts, ['Calidad gráfica: media']);
});

test('apagarlas también espera a compilar, y sin aviso cuando no se pide', async () => {
  let finish;
  const { game, instance, compiled, applied, toasts } = fakeGame({ saved: 'alta', shadows: true, compile: () => new Promise(resolve => { finish = resolve; }) });
  game.setGraphicsQuality('baja', false);
  assert.deepEqual(compiled, [{ shadows: false, cast: false }]);
  assert.equal(instance.shadowMap.enabled, true);
  finish();
  await flush();
  assert.deepEqual(applied, ['baja']);
  assert.equal(instance.shadowMap.enabled, false);
  assert.deepEqual(toasts, []);
});

test('de dos elecciones seguidas queda la última, termine primero la compilación que termine', async () => {
  const pending = [];
  const later = fakeGame({ compile: () => new Promise(resolve => pending.push(resolve)) });
  later.game.setGraphicsQuality('media');
  later.game.setGraphicsQuality('alta');
  pending[1]();
  await flush();
  assert.deepEqual(later.applied, ['alta']);
  pending[0]();
  await flush();
  assert.deepEqual(later.applied, ['alta'], 'la primera llega tarde y no pisa');
  assert.equal(later.renderer.quality, 'alta');
  assert.deepEqual(later.toasts, ['Calidad gráfica: alta']);

  pending.length = 0;
  const back = fakeGame({ compile: () => new Promise(resolve => pending.push(resolve)) });
  back.game.setGraphicsQuality('media');
  back.game.setGraphicsQuality('baja');
  assert.deepEqual(back.applied, ['baja'], 'volver a lo que ya se dibuja es inmediato');
  assert.equal(back.game.chosenQuality, 'baja');
  pending[0]();
  await flush();
  assert.deepEqual(back.applied, ['baja']);
  assert.equal(back.renderer.effectiveQuality, 'baja');
  assert.equal(localStorage.getItem('bazuko.graphics_quality'), 'baja');
});

test('una compilación que falla, o que no termina nunca, no deja la calidad atascada', async () => {
  const rejected = fakeGame({ compile: () => Promise.reject(new Error('sin paralelo')) });
  rejected.game.setGraphicsQuality('media');
  await flush();
  assert.deepEqual(rejected.applied, ['media']);
  const thrown = fakeGame({ compile: () => { throw new Error('contexto perdido'); } });
  thrown.game.setGraphicsQuality('media');
  assert.equal(thrown.instance.shadowMap.enabled, false, 'el fallo no deja encendida la variante de prueba');
  assert.equal(thrown.sun.castShadow, false);
  await flush();
  assert.deepEqual(thrown.applied, ['media']);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const hung = fakeGame({ compile: () => new Promise(() => {}) });
    hung.game.setGraphicsQuality('media');
    await Promise.resolve();
    assert.deepEqual(hung.applied, []);
    mock.timers.tick(20000);
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(hung.applied, ['media']);
  } finally { mock.timers.reset(); }
});

test('al recuperar un contexto perdido se vuelven a hornear los mapas y se repite la mezcla', () => {
  const baked = () => {
    const texture = new THREE.Texture({ width: 384, height: 512 });
    texture.mapping = THREE.CubeUVReflectionMapping;
    return texture;
  };
  let bakes = 0;
  const drawn = [], scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const instance = {
    domElement: new EventTarget(), shadowMap: { enabled: false }, info: { reset() {} }, target: null,
    getRenderTarget() { return this.target; }, setRenderTarget(target) { this.target = target; },
    render(what) { drawn.push(what === scene ? 'escena' : 'mezcla'); }
  };
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    instance, culling: { apply() {}, restore() {} }, silhouette: { render() {} },
    _bakeEnvironment() { bakes++; return { day: baked(), night: baked() }; }
  });
  const texture = renderer.createEnvironment(), mix = renderer.environmentMix;
  scene.userData.environmentDay = 1;
  assert.equal(bakes, 1);
  assert.deepEqual(drawn, ['mezcla']);
  drawn.length = 0;
  renderer.render(scene, camera);
  assert.deepEqual(drawn, ['escena'], 'la misma hora no vuelve a mezclar');
  const oldDay = mix.material.uniforms.dayMap.value, oldNight = mix.material.uniforms.nightMap.value;
  drawn.length = 0;
  instance.domElement.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(renderer._settleFrames, 20, 'la recompilación tampoco dice nada del equipo');
  renderer.render(scene, camera);
  assert.equal(bakes, 2);
  assert.notEqual(mix.material.uniforms.dayMap.value, oldDay);
  assert.notEqual(mix.material.uniforms.nightMap.value, oldNight);
  assert.deepEqual(drawn, ['mezcla', 'escena'], 'antes de dibujar la escena y aunque la hora no cambie');
  assert.equal(renderer.environmentMix.texture, texture, 'los materiales siguen con la misma textura');
  drawn.length = 0;
  renderer.render(scene, camera);
  assert.equal(bakes, 2, 'una sola vez por recuperación');
  assert.deepEqual(drawn, ['escena']);
});

test('Ajustes se vuelve a pintar al terminar de compilar, si sigue abierto', async () => {
  let finish;
  const { game, applied } = fakeGame({ compile: () => new Promise(resolve => { finish = resolve; }) });
  let painted = 0;
  game.menu = { isOpen: true, refresh() { painted++; assert.equal(applied.at(-1), game.chosenQuality); } };
  game.setGraphicsQuality('media');
  assert.equal(painted, 0);
  finish();
  await flush();
  assert.equal(painted, 1);
  game.menu.isOpen = false;
  game.setGraphicsQuality('baja');
  finish();
  await flush();
  assert.equal(painted, 1);
});

test('Ajustes marca lo elegido aunque el cambio aún no se aplique', () => {
  globalThis.document = {
    createElement(tag) {
      return { tag, className: '', textContent: '', children: [], attributes: {}, addEventListener() {}, setAttribute(k, v) { this.attributes[k] = v; },
        append(...nodes) { this.children.push(...nodes); }, appendChild(node) { this.children.push(node); return node; } };
    },
  };
  let config = null;
  const game = {
    chosenQuality: 'media', renderer: { quality: 'baja' }, creator: { isOpen: false },
    audio: { volume: .5, isMuted: () => false, setVolume() {}, toggleMute() {} },
    stats: { dinero: 0, level: 1, xp: 0 }, clock: { day: 1, hour: 12 },
    menu: { isOpen: false, open(c) { config = c; this.isOpen = true; }, refresh() {}, close() {} }
  };
  openPauseMenu(game, 'ajustes');
  const buttons = [];
  const walk = node => {
    if (node?.tag === 'button') buttons.push(node);
    for (const child of node?.children ?? []) walk(child);
  };
  walk(config.render().body);
  const elegido = label => {
    const b = buttons.find(n => n.children[0]?.textContent === label);
    return b.attributes['aria-pressed'] === 'true' && b.children[0].className === 'elegido';
  };
  assert.equal(elegido('Media'), true);
  assert.equal(elegido('Baja'), false);
  config.onClose?.();
});

test('arresto, muerte y sueño cierran la barra del cosquilleo: no queda debajo del menú', () => {
  const cancel = [];
  const shared = () => ({
    steal: { minigameActive: true, _endMinigame: (ok, why) => cancel.push([ok, why]) },
    input: { keys: {}, endFrame() {} }, audio: { updateSteps() {}, setPaused() {} },
    interaction: { boostActive: false }, menu: { open() {} }, stats: { salud: 0 }
  });
  const death = Object.assign(Object.create(Game.prototype), shared(), { player: { isRagdollActive: false }, deathCount: 0, diseases: {}, stats: { salud: 0 } });
  death._handleDeath();
  assert.deepEqual(cancel, [[false, 'cancel']]);
  cancel.length = 0;
  const arrest = Object.assign(Object.create(Game.prototype), shared(), { stats: { salud: 50 } });
  arrest._policeArrest();
  assert.deepEqual(cancel, [[false, 'cancel']]);
  cancel.length = 0;
  const sleeping = Object.assign(Object.create(Game.prototype), shared(), { built: { base: true }, player: { position: new THREE.Vector3() } });
  // Basta con ver la barra cerrada: lo que sigue del sueño no se prueba aquí.
  try { sleeping.sleep(); } catch { /* falta el resto del juego */ }
  assert.deepEqual(cancel, [[false, 'cancel']]);
});

test('Ajustes avisa cuando la calidad subió o bajó sola, no mientras se aplica lo elegido', () => {
  globalThis.document = {
    createElement(tag) {
      return { tag, className: '', textContent: '', children: [], attributes: {}, addEventListener() {}, setAttribute(k, v) { this.attributes[k] = v; },
        append(...nodes) { this.children.push(...nodes); }, appendChild(node) { this.children.push(node); return node; } };
    },
  };
  const hint = renderer => {
    let config = null;
    const game = {
      chosenQuality: 'baja', renderer, creator: { isOpen: false },
      audio: { volume: .5, isMuted: () => false, setVolume() {}, toggleMute() {} },
      stats: { dinero: 0, level: 1, xp: 0 }, clock: { day: 1, hour: 12 },
      menu: { isOpen: false, open(c) { config = c; this.isOpen = true; }, refresh() {}, close() {} }
    };
    openPauseMenu(game, 'ajustes');
    let text = null;
    const walk = node => {
      if (typeof node?.textContent === 'string' && node.textContent.startsWith('Baja va más fluido')) text = node.textContent;
      for (const child of node?.children ?? []) walk(child);
    };
    walk(config.render().body);
    config.onClose?.();
    return text;
  };
  assert.match(hint({ quality: 'baja', effectiveQuality: 'media' }), /Ahora corre en media: subió sola/);
  assert.doesNotMatch(hint({ quality: 'baja', effectiveQuality: 'baja' }), /Ahora corre/);
  assert.doesNotMatch(hint({ quality: 'media', effectiveQuality: 'media' }), /Ahora corre/, 'Lo elegido aún no se aplica');
});
