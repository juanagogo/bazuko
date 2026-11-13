// tools/peatones/limosna.mjs
// Después de un robo que pillan en una zona con gente, ¿cuántos peatones a menos de 40 m le niegan la limosna al
// jugador al rato? Monta Bogotá como el juego (tools/peatones/montaje.mjs: los 88 NPC, la flota y los buses), deja
// andar la ciudad 30 s, pone al jugador junto al peatón que más gente tiene alrededor y le roba como steal.js cuando
// lo pillan (`_robadoTimer`, `alarmedByTheft` y el grito). El jugador se queda ahí. Cuenta a los 10 s, 1, 3 y 5 min
// quiénes (con persona, a menos de 40 m del robo) se niegan (`mind.refusesAlms()`) y por qué: lo vio, se lo
// contaron o fue la víctima. También dice si, pidiendo ahí, nadie le daría: la regla de `allRefuseAlms` (todos los que
// tienen persona a menos de 7 m se niegan), mirada sin hacerlos hablar para no tocar la corrida.
//
//   node --experimental-test-module-mocks tools/peatones/limosna.mjs <árbol> <semilla> [salida.json]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadTree, buildCity } from './montaje.mjs';

const [rootArg, seedArg = '7', out = null] = process.argv.slice(2);
const root = path.resolve(rootArg ?? process.cwd()), seed = Number(seedArg);

globalThis.window = new EventTarget();
const realNow = performance.now.bind(performance);
let clock = 0;
performance.now = () => clock;
const tree = await loadTree(root);
const { THREE } = tree;
const { city, traffic } = await buildCity(tree, seed);

const dt = 1 / 60, REACH = 40, CHECKS = [10, 60, 180, 300];
const player = new THREE.Vector3(112.98, 0, 97.84);
const camera = new THREE.PerspectiveCamera(55, 1280 / 800, .1, 300);
const people = city.npcs.filter(n => n.person);
let frame = 0;
function step(seconds) {
  for (const end = frame + Math.round(seconds / dt); frame < end; frame++) {
    clock += dt * 1000;
    player.y = city.getMovementGroundHeight(player.x, player.z, 0);
    camera.position.set(player.x - 4, player.y + 3, player.z + 4);
    camera.lookAt(player.x, player.y + 1.4, player.z);
    camera.updateMatrixWorld();
    city.update(dt, player, camera, traffic.vehicles);
    traffic.update(dt, { player, pedestrians: city.trafficPedestrians, camera, hour: 15 });
  }
}

step(30);
// El de más gente alrededor (con mente, andando por ahí: ni vendedor ni en su sitio).
const near = (p, r) => people.filter(n => n.position.distanceTo(p) <= r);
const candidates = people.filter(n => n.mind && !n.fijo && !n.koState);
const victim = candidates.reduce((best, n) => (near(n.position, REACH).length > near(best.position, REACH).length ? n : best));
const spot = victim.position.clone();
player.set(spot.x - .8, 0, spot.z);
victim._robadoTimer = 20;
victim.alarmedByTheft(player);
window.dispatchEvent(new CustomEvent('steal-caught', {}));
const t0 = city.minds.time;

const rows = [];
let elapsed = 0;
for (const at of CHECKS) {
  step(at - elapsed);
  elapsed = at;
  const now = city.minds.time, around = near(spot, REACH), refusers = around.filter(n => n.mind?.refusesAlms());
  const why = { victima: 0, vio: 0, chisme: 0 };
  for (const n of refusers) {
    const memory = n.mind.aware.memory, act = memory.strongest(now);
    if (memory.victimOf(now)) why.victima++;
    else if (act?.heard) why.chisme++;
    else why.vio++;
  }
  const beside = city.npcs.filter(n => n.person && n.position.distanceTo(player) <= 7);
  rows.push({ s: at, cerca: around.length, niegan: refusers.length, ...why, aSieteM: beside.length,
    nadieDa: beside.length > 0 && beside.every(n => n.mind?.refusesAlms()), t: +(now - t0).toFixed(1) });
}
performance.now = realNow;
const result = { root: path.basename(root), seed, victima: [+spot.x.toFixed(1), +spot.z.toFixed(1)], filas: rows };
console.log(JSON.stringify(result));
if (out) await writeFile(out, JSON.stringify(result));
process.exit(0);
