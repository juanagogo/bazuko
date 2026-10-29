// Comparación visual y de rendimiento en un Chromium aislado con GPU local.
// Requiere Vite/preview ya activo; no levanta servidores ni usa el perfil habitual.
// node tools/review-bogota-route.mjs --url http://127.0.0.1:43178/ --output work/bogota-before --label before-f494bcb
import { chromium } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:5173/' },
  output: { type: 'string', default: 'work/bogota-route' },
  label: { type: 'string', default: 'review' },
  seconds: { type: 'string', default: '6' },
  hud: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false }
} });
if (values.help) {
  console.log('Uso: node tools/review-bogota-route.mjs --url URL --output CARPETA --label before|after [--seconds 5..8] [--hud]');
  process.exit(0);
}
const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 8) throw new Error('--seconds debe estar entre 5 y 8.');
const output = resolve(values.output);
const viewport = { width: 1280, height: 800 };
const seed = 89123, fixedDt = 1 / 60, settleFrames = 45;
// Confirmados contra _layout/getMovementGroundHeight: Comercio es andén;
// Lago es plaza fuera del viaducto; Ribera es el paseo seco, no el lecho en X45.
const route = [
  { name: 'cambuche', x: 112.98, z: 97.84, yaw: -Math.PI / 2 },
  { name: 'comercio', x: 105, z: 158, yaw: -Math.PI / 2 },
  { name: 'lago', x: 98, z: 234, yaw: 2.35 },
  { name: 'ribera', x: 20, z: 262, yaw: -Math.PI / 2 }
];
const captures = route.flatMap(point => (point.name === 'cambuche' ? ['baja', 'media', 'alta'] : ['baja'])
  .flatMap(quality => [12, 22].map(hour => ({ ...point, quality, hour }))));
const measuredViews = route.slice(0, 3).map(point => ({ ...point, quality: 'baja', hour: 12 }));
const report = { version: 1, label: values.label, url: values.url, createdAt: new Date().toISOString(),
  viewport, deviceScaleFactor: 1, seed, fixedDt, settleFrames, seconds, hud: values.hud,
  adaptiveResolution: false, camera: { mode: 'third-person', pitch: .3, distance: 6.5, fov: 55 },
  weather: { day: 1, type: 'llovizna', wetnessBeforeStep: .6 },
  method: 'Bucle completo de gameplay con paso fijo; FPS y p95 usan RAF/tiempo reales externos. Sin modo foto.',
  limitations: ['La semilla fija el azar; cambios en el orden de creación de objetos pueden alterar NPC o decoración.',
    'Las mediciones corresponden solo a este equipo, renderer y escenas; no son FPS de otras máquinas.'],
  gpu: null, look: null, errors: [], resourceErrors: [], captures: [], measurements: [] };
const persist = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push({ kind: 'javascript', message: error.message }));
page.on('response', response => {
  if (response.status() >= 400) report.resourceErrors.push({ status: response.status(), url: response.url() });
});
page.on('console', message => {
  if (/Failed to load resource/i.test(message.text())) return; // URL y estado en resourceErrors.
  if (message.type() === 'error' || /Shader Error|WebGLProgram.*(error|failed)/i.test(message.text())) {
    report.errors.push({ kind: 'console', message: message.text().slice(0, 4000), location: message.location() });
  }
});
try {
  await page.addInitScript(initialSeed => {
    let state = initialSeed;
    window.__routeSeed = value => { state = value; };
    Math.random = () => ((state = Math.imul(state, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
    localStorage.clear();
  }, seed);
  await page.goto(values.url, { waitUntil: 'commit' });
  await page.locator('#creator-modal').waitFor({ state: 'visible', timeout: 120_000 });
  await page.locator('#cr-name').fill('Bogotá revisión');
  await page.locator('#creator-done').click();
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 180_000 });
  const continueButton = page.getByRole('button', { name: 'Continuar jugando', exact: true });
  await continueButton.waitFor({ state: 'visible', timeout: 180_000 });
  // Cortar el RAF antes de cerrar la nota evita una cantidad variable de pasos
  // de simulación entre la carga y el primer punto de ambas ejecuciones.
  await page.evaluate(() => { window.__game._running = false; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await continueButton.click();
  report.runtime = await page.evaluate(() => ({ userAgent: navigator.userAgent,
    assets: [...document.scripts].map(script => script.src).filter(Boolean) }));
  report.look = await page.evaluate(() => window.__game.look);
  report.gpu = await page.evaluate(() => {
    const gl = window.__game.renderer.instance.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return { renderer, vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
      software: /swiftshader|llvmpipe|softpipe|software/i.test(renderer) };
  });
  console.log(`${values.label}: ${report.gpu.renderer}`);
  if (report.gpu.software) report.limitations.push('El renderer detectado es software; estos resultados no acreditan rendimiento de GPU física.');
  if (!values.hud) await page.addStyleTag({ content:
    '#app > :not(#game-canvas), body > :not(#app) { display: none !important; }' });

  // Instrumentación exclusiva de esta página. Se llama al bucle original y a
  // todos sus sistemas. Solo se controlan el reloj de simulación y su scheduler;
  // las medidas de rendimiento usan nativeNow/RAF, fuera del reloj simulado.
  await page.evaluate(({ fixedDt, seed, camera }) => {
    const game = window.__game, nativeRAF = window.requestAnimationFrame.bind(window);
    const nativeNow = performance.now.bind(performance), loop = game._loop;
    const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    let simulationMs = 100_000, scenario = null;
    game.renderer.adaptResolution = () => {};
    game.clock.update = () => { game.clock.day = 1; game.clock.hour = scenario.hour; };
    const info = () => ({ render: { ...game.renderer.instance.info.render },
      memory: { ...game.renderer.instance.info.memory }, programs: game.renderer.instance.info.programs.length,
      selectedQuality: game.renderer.quality, effectiveQuality: game.renderer.effectiveQuality,
      pixelRatio: game.renderer.instance.getPixelRatio(), canvas: { width: game.renderer.instance.domElement.width,
        height: game.renderer.instance.domElement.height }, position: game.player.position.toArray(),
      camera: { position: game.cameraRig.camera.position.toArray(), quaternion: game.cameraRig.camera.quaternion.toArray(),
        fov: game.cameraRig.camera.fov, far: game.cameraRig.camera.far },
      clock: game.clock.serialize(), weather: { type: game.weather.weather, intensity: game.weather.rainIntensity,
        wetness: game.weather.wetness, windClock: game.weather._windClock }, simulationMs });
    function step() {
      if (document.hidden || game.paused || game.photoMode.active) throw new Error('La vista debe estar visible y gameplay sin pausa.');
      simulationMs += fixedDt * 1000;
      game._lastTime = simulationMs - fixedDt * 1000;
      game._lastRenderTime = simulationMs - fixedDt * 1000;
      game.weather.timer = 0; game.weather.nextChange = Infinity; game.weather.wetness = .6;
      for (const need of ['salud', 'hambre', 'sed', 'energia', 'higiene', 'animo', 'vicio']) game.stats[need] = 100;
      game._running = true;
      const raf = window.requestAnimationFrame;
      try {
        Object.defineProperty(performance, 'now', { configurable: true, value: () => simulationMs });
        window.requestAnimationFrame = callback => callback === game._loop ? 0 : nativeRAF(callback);
        loop();
      } finally {
        window.requestAnimationFrame = raf;
        if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor);
        else delete performance.now;
        game._running = false;
      }
    }
    async function frames(count) {
      for (let i = 0; i < count; i++) await new Promise((resolve, reject) => nativeRAF(() => {
        try { step(); resolve(); } catch (error) { reject(error); }
      }));
    }
    async function setup(value) {
      scenario = value;
      window.__routeSeed(seed);
      game.renderer.setQuality(value.quality);
      const district = game.world.active, player = game.player;
      if (!district.isWalkableAt(value.x, value.z) || district.getWaterInfo(value.x, value.z)) {
        throw new Error(`Punto ${value.name} dejó de ser seco y caminable: revisar las coordenadas explícitamente.`);
      }
      player.clearVehicleImpact(); player.resetGrounding(); player.stopSmoking(); player.stopBasuco();
      player.action = null; player.actionTimer = 0;
      player.position.set(value.x, district.getMovementGroundHeight(value.x, value.z, 0), value.z);
      player.root.position.copy(player.position); player.root.rotation.set(0, value.yaw + Math.PI, 0);
      game.input.keys = {}; game.input.endFrame();
      game.roadRage.reset(); game.limpieza.reset(); game.traffic.endPursuit();
      game.clock.day = 1; game.clock.hour = value.hour;
      // Pasar por otro tipo garantiza que setWeather aplique valores inmediatos.
      game.weather.setWeather('nublado', false); game.weather.setWeather('llovizna', false);
      game.weather._windClock = 0; game.weather.windDirection.set(.8, .6); game.weather.flash = 0;
      game.weather._flashTime = -1; game.weather._nextLightning = Infinity;
      const rain = game.weather.rainParticles?.material.uniforms;
      if (rain) rain.uTime.value = 0;
      const sky = game.sceneMgr.skyDome?.material.uniforms;
      if (sky) { sky.time.value = 0; sky.cloudOffset.value.set(0, 0); }
      Object.assign(game.cameraRig, { mode: camera.mode, pitch: camera.pitch, yaw: value.yaw,
        distance: camera.distance, baseFov: camera.fov, targetFov: camera.fov, roll: 0, _targetRoll: 0,
        _bobTime: 0, _bobAmount: 0, _snap: true });
      game.cameraRig.camera.userData.cameraMode = camera.mode;
      game.cameraRig.camera.fov = camera.fov; game.cameraRig.camera.updateProjectionMatrix();
      await frames(1);
      return { tile: district.getGroundTypeAt(value.x, value.z), ground: player.position.y };
    }
    async function measure(seconds) {
      const intervals = [], cpu = [], counters = [], start = nativeNow();
      let previous = null;
      while (nativeNow() - start < seconds * 1000) await new Promise((resolve, reject) => nativeRAF(timestamp => {
        try {
          if (previous !== null) intervals.push(timestamp - previous);
          previous = timestamp;
          const begin = nativeNow(); step(); cpu.push(nativeNow() - begin);
          counters.push({ ...game.renderer.instance.info.render }); resolve();
        } catch (error) { reject(error); }
      }));
      const elapsedMs = intervals.reduce((sum, value) => sum + value, 0);
      const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
      return { measuredFrames: intervals.length, elapsedMs, averageFPS: intervals.length * 1000 / elapsedMs,
        frameMs: { p50: percentile(intervals, .5), p95: percentile(intervals, .95), p99: percentile(intervals, .99) },
        loopCpuMs: { p50: percentile(cpu, .5), p95: percentile(cpu, .95) },
        renderMean: Object.fromEntries(['calls', 'triangles', 'points', 'lines'].map(key =>
          [key, counters.reduce((sum, entry) => sum + entry[key], 0) / counters.length])), ...info() };
    }
    window.__routeReview = { setup, frames, measure, info };
  }, { fixedDt, seed, camera: report.camera });

  for (const scenario of captures) {
    const location = await page.evaluate(value => window.__routeReview.setup(value), scenario);
    await page.evaluate(count => window.__routeReview.frames(count), settleFrames);
    const state = await page.evaluate(() => window.__routeReview.info());
    const filename = `${scenario.name}-${scenario.hour === 12 ? 'dia' : 'noche'}-${scenario.quality}.png`;
    await page.screenshot({ path: join(output, filename) });
    report.captures.push({ ...scenario, ...location, filename, ...state });
    await persist();
    console.log(`Captura: ${filename} (${state.render.calls} llamadas, ${state.render.triangles} triángulos)`);
  }
  // Todas las capturas se terminan antes de medir: la cantidad de frames lograda
  // en seis segundos no puede cambiar la escena de una captura posterior.
  for (const scenario of measuredViews) {
    await page.evaluate(value => window.__routeReview.setup(value), scenario);
    await page.evaluate(count => window.__routeReview.frames(count), settleFrames);
    const measurement = await page.evaluate(seconds => window.__routeReview.measure(seconds), seconds);
    report.measurements.push({ ...scenario, ...measurement });
    await persist();
    console.log(`${scenario.name}: ${measurement.averageFPS.toFixed(1)} FPS; p95 ${measurement.frameMs.p95.toFixed(1)} ms`);
  }
  report.completedAt = new Date().toISOString();
  if (report.errors.length) throw new Error(`Se detectaron ${report.errors.length} errores JS/console/shader; consultar report.json.`);
  await rm(join(output, 'error.png'), { force: true });
} catch (error) {
  report.errors.push({ kind: 'runner', message: error.stack ?? error.message });
  await page.screenshot({ path: join(output, 'error.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await persist();
  await browser.close();
}
console.log(`Informe: ${join(output, 'report.json')}`);
