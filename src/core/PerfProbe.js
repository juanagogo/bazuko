/** Sonda de rendimiento para `?perf`: escenarios repetibles desde la consola, sin tocar el guardado. */
import * as THREE from 'three';
export function frameStats(intervals) {
  const sorted = [...intervals].sort((a, b) => a - b);
  const at = p => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] * 10) / 10 : 0;
  return { frames: sorted.length, max: at(1), p95: at(.95), p99: at(.99), over500ms: sorted.filter(ms => ms > 500).length };
}

function delta(after, before) {
  return Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - (before[key] ?? 0)]));
}

/** Rama con nombre más cercana a la escena: sirve para saber qué sistema aporta los dibujos. */
function branchName(object, scene) {
  const names = [];
  for (let o = object; o && o !== scene; o = o.parent) if (o.name) names.push(o.name);
  return names.slice(-2).reverse().join(' › ') || object.type;
}

function drawBreakdown(game, top) {
  const scene = game.sceneMgr.scene, view = game.cameraRig.camera, sun = game.sceneMgr.sun;
  const shadowCameras = sun?.shadow?.getViewportCount ? Array.from({ length: sun.shadow.getViewportCount() }, (_, i) => sun.shadow.getCamera(i)) : [];
  const count = (camera, shadow) => {
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    const groups = new Map();
    let total = 0;
    scene.traverseVisible(o => {
      if (!(o.isMesh || o.isInstancedMesh || o.isBatchedMesh) || !o.layers.test(camera.layers) || (shadow && !o.castShadow)) return;
      if (o.frustumCulled !== false && !frustum.intersectsObject(o)) return;
      const draws = Array.isArray(o.material) ? Math.max(1, o.geometry.groups.length) : 1;
      const key = branchName(o, scene), entry = groups.get(key) ?? { draws: 0, instanced: 0 };
      entry.draws += draws;
      if (o.isInstancedMesh) entry.instanced += draws;
      groups.set(key, entry);
      total += draws;
    });
    return { total, top: [...groups].sort((a, b) => b[1].draws - a[1].draws).slice(0, top).map(([name, e]) => ({ name, ...e })) };
  };
  return { mode: game.cameraRig.mode, view: count(view, false), cascades: shadowCameras.map(camera => count(camera, true)) };
}

export function installPerfProbe(game, target = globalThis) {
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  /** Mide intervalos de cuadro y trabajo gráfico mientras corre `step(progress)`. */
  const measure = async (name, seconds, step = () => {}) => {
    const diagnostics = game.renderer.diagnostics, before = diagnostics.snapshot(), sequence = diagnostics.sequence ?? 0;
    const bakes = game.sceneMgr.atmosphere?.bakeCount ?? 0, intervals = [], started = performance.now();
    let last = started;
    while (last - started < seconds * 1000) {
      step(Math.min(1, (last - started) / (seconds * 1000)));
      await nextFrame();
      const now = performance.now();
      intervals.push(now - last);
      last = now;
    }
    const info = game.renderer.instance.info.render;
    return { name, ...frameStats(intervals), meanMs:intervals.length?(last-started)/intervals.length:0,elapsedMs:last-started,work: delta(diagnostics.snapshot(), before), bakes: (game.sceneMgr.atmosphere?.bakeCount ?? 0) - bakes,
      events: diagnostics.events.filter(event => event.sequence > sequence), quality: game.renderer.effectiveQuality, pixelRatio: game.renderer.instance.getPixelRatio(),
      drawCalls: info.drawCalls, triangles: info.triangles, memoryMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null };
  };
  const probe = {
    report: () => game.getPerformanceReport(),
    idle: (seconds = 3) => measure('quieto', seconds),
    turn: (seconds = 4) => { const yaw = game.cameraRig.yaw; return measure('giro 360', seconds, p => { game.cameraRig.yaw = yaw + p * Math.PI * 2; }); },
    toggleCamera: async (seconds = 2) => { game.hud?.cameraButton?.click(); return measure('cámara ' + game.cameraRig.mode, seconds); },
    quality: async (level, seconds = 3) => {
      const started = performance.now(), ok = await game.changeGraphicsQuality(level), changeMs = Math.round(performance.now() - started);
      return { ...(await measure('calidad ' + level, seconds)), ok, changeMs };
    },
    pressure: (value, seconds = 3) => { game.renderer.resolution.pressure = value; return measure('pressure ' + value, seconds); },
    ratio: (value, seconds = 3) => { game.renderer.resolution.ratio = value; game.renderer.instance.setPixelRatio(value); return measure('pixelRatio ' + value, seconds); },
    lockQuality: (locked = true) => { game.renderer.adaptiveLocked = locked; return locked; },
    /** Milisegundos de GPU de los últimos cuadros (requiere ?perf y la función timestamp-query del navegador). */
    gpu: async (seconds = 2) => {
      const renderer = game.renderer.instance;
      if (!renderer.backend.trackTimestamp) return { supported: false };
      const samples = [], started = performance.now();
      while (performance.now() - started < seconds * 1000) {
        await nextFrame();
        const ms = await renderer.resolveTimestampsAsync('render');
        if (ms) samples.push(ms);
      }
      samples.sort((a, b) => a - b);
      return { supported: true, samples: samples.length, medianMs: samples[Math.floor(samples.length / 2)] ?? null, maxMs: samples.at(-1) ?? null };
    },
    /** Mallas que dibuja cada cámara (vista y cascadas de sombra), agrupadas por su rama de la escena. */
    breakdown: (top = 15) => drawBreakdown(game, top),
    /** Perfil de luz temporal ('midday', 'night'…; null vuelve al reloj). No se guarda. */
    timeProfile: (id = null) => game.sceneMgr.setTimeProfile(id),
    get scene() { return game.sceneMgr.scene; },
    /** Acceso de depuración (solo con ?perf). */
    get game() { return game; },
    /** Obstrucción de cada vehículo a menos de 55 m y coste de trazarlos todos (dos pasadas: la segunda ya optimizada). */
    acoustics: () => {
      const acoustics = game.audio.acoustics, p = game.player.position, ears = { x: p.x, y: p.y + 1.6, z: p.z };
      const sources = [...(game.traffic?.vehicles ?? []).map(v => v.car), ...(game.world.active?.busServices ?? []), ...game.cars]
        .filter(s => s.position.distanceTo(p) < 55);
      let audible, traceMs;
      for (let pass = 0; pass < 2; pass++) {
        const started = performance.now();
        audible = sources.map(s => ({ distance: Math.round(s.position.distanceTo(p)), obstruction: Math.round(acoustics.obstruction(s.position, ears, 1) * 100) / 100 }));
        traceMs = +(performance.now() - started).toFixed(3);
      }
      return { traceMs, audible };
    },
    /** Prepara el detalle completo del NPC más cercano que aún no lo tiene, como al acercarse en partida. */
    npcDetail: async () => {
      const position = game.player.position;
      const npc = (game.world.active?.npcs ?? []).filter(n => !n.fullChar && !n._fullLoading)
        .sort((a, b) => a.position.distanceTo(position) - b.position.distanceTo(position))[0];
      if (!npc) return null;
      const diagnostics = game.renderer.diagnostics, before = diagnostics.snapshot(), started = performance.now();
      await npc._loadFull();
      return { ms: Math.round(performance.now() - started), distance: Math.round(npc.position.distanceTo(position)), work: delta(diagnostics.snapshot(), before) };
    }
  };
  target.__bazukoPerf = probe;
  return probe;
}
