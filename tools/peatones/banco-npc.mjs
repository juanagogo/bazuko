// tools/peatones/banco-npc.mjs
// Cuánto cuesta por cuadro pensar a los 88 NPC de Bogotá: corre `city.update` (que llama `Npc.update` para todos)
// durante miles de cuadros a 60 Hz, con la flota, los buses, una cámara que sigue al jugador y un jugador que camina,
// corre y se queda quieto entre la gente. Mide `city.update` (NPC, palomas, semáforos y buses) y aparte el tráfico.
//
//   node --experimental-test-module-mocks tools/peatones/banco-npc.mjs --root <árbol> [--frames 6000] [--seed 7] [--json salida.json] [--recuerdan]
//
// `--recuerdan`: la mitad de los peatones se acuerda de un robo del jugador desde el principio (lo reconocen, le
// dejan espacio y se lo cuentan a la otra mitad). En un árbol sin memoria no cambia nada.
//
// Sin navegador: el cuerpo de cada NPC es una sustitución sin costo, así que mide la lógica, no la animación.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadTree, buildCity } from './montaje.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const root = path.resolve(opt('root', process.cwd()));
const frames = Number(opt('frames', 6000));
const seed = Number(opt('seed', 7));
const out = opt('json', null);
const grudges = args.includes('--recuerdan');

globalThis.window = new EventTarget();
const realNow = performance.now.bind(performance);
const tree = await loadTree(root);
const { THREE } = tree;
// El habla de los NPC sortea con performance.now(): con un reloj propio, las corridas se repiten.
let clock = 0;
performance.now = () => clock;
const { city, traffic } = await buildCity(tree, seed);
performance.now = realNow;

const camera = new THREE.PerspectiveCamera(55, 1280 / 800, .1, 300);
const player = new THREE.Vector3(112.98, 0, 97.84);
// Recorrido del jugador por la calle del cambuche y el parque: anda, corre, se queda quieto.
const path2 = [[112.98, 97.84], [112.98, 110], [124, 110], [124, 96], [112.98, 96]];
let leg = 0, pause = 0;
const dt = 1 / 60;
const npcTimes = new Float64Array(frames), trafficTimes = new Float64Array(frames);
const yieldFrame = () => new Promise(resolve => setImmediate(resolve));
for (let frame = 0; frame < frames; frame++) {
  clock += dt * 1000;
  const time = frame * dt;
  // Cada 20 s cambia de paso: 8 s andando, 6 corriendo, 6 quieto.
  const phase = time % 20;
  const speed = phase < 8 ? 3 : phase < 14 ? 6 : 0;
  if (speed > 0 && pause <= 0) {
    const [tx, tz] = path2[(leg + 1) % path2.length];
    const dx = tx - player.x, dz = tz - player.z, dist = Math.hypot(dx, dz);
    const step = Math.min(dist, speed * dt);
    if (dist < .05) leg++;
    else { player.x += dx / dist * step; player.z += dz / dist * step; }
  }
  player.y = city.getMovementGroundHeight(player.x, player.z, 0);
  camera.position.set(player.x - 4, player.y + 3, player.z + 4);
  camera.lookAt(player.x, player.y + 1.4, player.z);
  camera.updateMatrixWorld();
  const t0 = realNow();
  city.update(dt, player, camera, traffic.vehicles);
  const t1 = realNow();
  if (grudges && frame === 0) for (const npc of city.npcs) if (npc.mind && npc.mind.id % 2 === 0) npc.mind.aware?.memory?.remember('robo', 1, city.minds.time);
  traffic.update(dt, { player, pedestrians: city.trafficPedestrians, camera, hour: 18 });
  const t2 = realNow();
  npcTimes[frame] = t1 - t0;
  trafficTimes[frame] = t2 - t1;
  if (frame % 1000 === 999) { process.stderr.write(`[banco] ${frame + 1}/${frames}\n`); await yieldFrame(); }
}

const stats = (list, skip) => {
  const sorted = Array.from(list.subarray(skip)).sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { p50: +at(.5).toFixed(4), p95: +at(.95).toFixed(4), p99: +at(.99).toFixed(4), media: +mean.toFixed(4) };
};
// Los primeros 600 cuadros calientan el JIT y reparten las rutas: no cuentan.
const skip = Math.min(600, Math.floor(frames / 4));
const result = {
  root, seed, frames, npcs: city.npcs.length, vehiculos: traffic.vehicles.length,
  cityUpdateMs: stats(npcTimes, skip), traficoMs: stats(trafficTimes, skip)
};
console.log(JSON.stringify(result));
if (out) await writeFile(out, JSON.stringify(result, null, 2));
process.exit(0);
