// Referencia de iluminación día/noche, cámara y movimiento calculada con el JS original.
//   node tools/export_render.mjs        (requiere `npm ci` en la raíz)
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../..');
const load = (p) => import(pathToFileURL(resolve(web, p)).href);

// Entorno mínimo del navegador que usan CameraRig y Player.
const storage = new Map();
globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {} };
globalThis.localStorage = { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) };

const THREE = await load('node_modules/three/build/three.module.js');
const { SceneManager } = await load('src/core/Scene.js');
const { CameraRig } = await load('src/core/Camera.js');
const { Player } = await load('src/entities/Player.js');
const { CollisionSystem } = await load('src/systems/CollisionSystem.js');

// CameraRig recuerda el modo en localStorage: cada instancia arranca limpia (tercera persona).
const rig = () => { storage.clear(); return new CameraRig(new THREE.Scene(), { addEventListener() {} }); };
const arr = (v) => [v.x, v.y, v.z];

// ---- iluminación ----
const lighting = [];
for (const hour of [0, 3, 5.5, 6, 6.5, 7, 7.5, 9, 12, 15, 17.5, 18, 18.3, 19, 19.5, 21, 23.9]) {
  const sm = new SceneManager();
  sm.setTimeOfDay(hour);
  lighting.push({
    hour,
    sun: sm.sun.intensity, hemi: sm.ambient.intensity, env: sm.scene.environmentIntensity,
    sunColor: [sm.sun.color.r, sm.sun.color.g, sm.sun.color.b],
    background: [sm.scene.background.r, sm.scene.background.g, sm.scene.background.b],
    fogNear: sm.scene.fog.near, fogFar: sm.scene.fog.far,
  });
}
const sm = new SceneManager();
const hemiColors = { sky: [sm.ambient.color.r, sm.ambient.color.g, sm.ambient.color.b], ground: [sm.ambient.groundColor.r, sm.ambient.groundColor.g, sm.ambient.groundColor.b] };
const desat = [];
for (const d of [0, 0.3, 0.7, 1]) {
  const s = new SceneManager();
  s.setTimeOfDay(12);
  s.applyMentalState(d);
  desat.push({ d, background: [s.scene.background.r, s.scene.background.g, s.scene.background.b] });
}

// ---- cámara ----
const dirOf = (c) => arr(c.camera.getWorldDirection(new THREE.Vector3()));
const box = (a, b) => new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b));
const cameras = [];
for (const [yaw, pitch, distance, target, boxes] of [
  [-Math.PI / 2, 0.22, 5.5, [40, 0, 22], []],
  [0, 0.4, 7, [3, 0, -2], []],
  [2.2, 0.05, 9, [-10, 0.5, 8], []],
  [0, 0.22, 5.5, [0, 0, 0], [[[-5, 0, 2], [5, 12, 4]]]],
  [0.3, 0.3, 6, [0, 0, 0], [[[-5, 0, 2], [5, 12, 4]], [[-1, 0, 1], [1, 3, 1.2]]]],
  [Math.PI, 0.22, 5.5, [0, 0, 0], [[[-5, 0, 2], [5, 12, 4]]]],
  [0, 0.22, 5.5, [0, 0, 3], [[[-5, 0, 2], [5, 12, 4]]]],   // el punto de mira queda dentro de la pared
]) {
  const c = rig();
  c.yaw = yaw; c.pitch = pitch; c.distance = distance;
  const colliders = boxes.map(([a, b]) => ({ box: box(a, b) }));
  c.follow(new THREE.Vector3(...target), 1 / 60, { colliders });
  cameras.push({ yaw, pitch, distance, target, boxes, position: arr(c.camera.position), direction: dirOf(c), arm: c._armDistance });
}
// recuperación del brazo tras salir de la pared
const recovery = [];
{
  const c = rig();
  c.yaw = 0;
  const b = [{ box: box([-5, 0, 2], [5, 12, 4]) }];
  c.follow(new THREE.Vector3(), 1 / 60, { colliders: b });
  recovery.push(c._armDistance);
  for (let i = 0; i < 60; i++) { c.follow(new THREE.Vector3(), 1 / 60); if (i % 10 === 0) recovery.push(c._armDistance); }
}
// isométrica: snap y suavizado
const iso = [];
{
  const c = rig();
  c.toggle();
  c.follow(new THREE.Vector3(40, 0, 22), 0);
  iso.push({ position: arr(c.camera.position), direction: dirOf(c) });
  for (let i = 0; i < 30; i++) {
    c.follow(new THREE.Vector3(46 + i * 0.1, 0, 30), 1 / 60);
    if (i % 5 === 0) iso.push({ position: arr(c.camera.position), direction: dirOf(c) });
  }
}
const orbit = [];
{
  const c = rig();
  c.orbit(100, 100000); orbit.push([c.yaw, c.pitch, c.distance]);
  c.orbit(0, -100000); orbit.push([c.yaw, c.pitch, c.distance]);
  c.zoom(100000); orbit.push([c.yaw, c.pitch, c.distance]);
  c.zoom(-100000); orbit.push([c.yaw, c.pitch, c.distance]);
  c.toggle(Math.PI / 2); c.toggle(Math.PI / 2); orbit.push([c.yaw, c.pitch, c.distance]);
}

// ---- movimiento del jugador ----
function motor(camera, axis, { running = false, mult = 1, collisions = null, start = [0, 0, 0], dt = 0.1 } = {}) {
  const player = Object.assign(Object.create(Player.prototype), {
    time: 0, actionTimer: 0, input: { axis, isRunning: running }, speedWalk: 3, speedRun: 6, radius: 0.4,
    position: new THREE.Vector3(...start), root: new THREE.Group(), modelScale: 1,
    stats: { getSpeedMultiplier: () => mult },
    _direction: new THREE.Vector3(), _forward: new THREE.Vector3(), _right: new THREE.Vector3(),
    _delta: new THREE.Vector3(), _before: new THREE.Vector3(), character: { update() {} },
  });
  player.update(dt, camera, collisions);
  return { position: arr(player.position), rotationY: player.root.rotation.y, speed: player.speed, state: player.state };
}
const walls = new CollisionSystem();
{ const o = new THREE.Object3D(); o.position.set(2, 0, 2); walls.add(o, new THREE.Vector3(2, 8, 2)); }
const motion = [];
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
  const c = rig(); c.yaw = yaw; c.follow(new THREE.Vector3());
  for (const axis of [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: 0, z: 0 }]) {
    for (const opts of [{}, { running: true }, { mult: 0.5 }, { running: true, mult: 0.68 }]) {
      motion.push({ mode: 'third-person', yaw, axis, opts, ...motor(c.camera, axis, opts) });
    }
  }
}
{
  const c = rig(); c.toggle(); c.follow(new THREE.Vector3(), 0);
  for (const axis of [{ x: 0, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 0 }])
    motion.push({ mode: 'isometric', yaw: 0, axis, opts: {}, ...motor(c.camera, axis, {}) });
}
const collide = [];
{
  const c = rig(); c.yaw = Math.PI; c.follow(new THREE.Vector3());   // mira hacia −Z... según yaw
  for (const [start, axis] of [[[0.5, 0, 0], { x: 0, z: -1 }], [[0.5, 0, 2], { x: 1, z: 0 }], [[0.5, 0, 0], { x: 1, z: 1 }]]) {
    collide.push({ start, axis, ...motor(c.camera, axis, { running: true, collisions: walls, start, dt: 0.5 }) });
  }
}

const ref = {
  version: 1,
  fov: 55,
  lighting, hemiColors, desat, cameras, recovery, iso, orbit, motion, collide,
};
const out = resolve(here, '../data/render_reference.json');
writeFileSync(out, JSON.stringify(ref));
console.log(`OK ${out}: ${lighting.length} horas, ${cameras.length} cámaras, ${motion.length} movimientos`);
