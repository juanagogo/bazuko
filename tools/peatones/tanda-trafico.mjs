// tools/peatones/tanda-trafico.mjs
// Una semilla del tráfico montado como el juego (ver tests/helpers/traffic-world.js, runLikeTheGame): ciudad completa, 88 NPC,
// perro, parqueados, flota con dos patrullas, buses con semáforos y, si se pide, persecuciones repetidas. Imprime una
// línea JSON con el peor tiempo detenido, cuántos vehículos pasaron de 90 s y de 180 s parados seguidos, cuántos
// quedaron trabados al final y lo que hicieron los peatones en los cruces.
//
//   node --experimental-test-module-mocks tools/peatones/tanda-trafico.mjs --root <árbol> --seed 3 [--minutes 5] [--chases] [--density normal] [--sustos]
//
// `--sustos` (docs/testing.md: un cambio de conducta se mide con sustos): cada 20 s el jugador se para en el andén
// junto a una persona fija a menos de 16 m de un cruce, la asusta como al robarle y se queda ahí; además arma una pelea
// (`street-fight`), que en un árbol con mentes ven y oyen los demás (huyen, se arriman a mirar).
//
// Una semilla por proceso: el azar sembrado no arrastra nada de otra corrida. tandas.mjs las lanza en lote.
import path from 'node:path';
import { loadTree, buildCity } from './montaje.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const root = path.resolve(opt('root', process.cwd()));
const seed = Number(opt('seed', 1));
const minutes = Number(opt('minutes', 5));
const chases = args.includes('--chases');
const scares = args.includes('--sustos');
const density = opt('density', 'normal');
const hour = Number(opt('hour', 7));

globalThis.window = new EventTarget();
const realNow = performance.now;
let clock = 0;
performance.now = () => (clock += 100);
const tree = await loadTree(root);
const { THREE } = tree;
const { collisions, city, traffic, parked } = await buildCity(tree, seed, { density });

const player = new THREE.Vector3(112.98, 0, 97.84);
const stoppedFor = new Map(), longest = new Map(), farFor = new Map();
let worst = { seconds: 0 }, farWorst = { seconds: 0 }, busWorst = { seconds: 0 }, patrolFar = { seconds: 0 };
let chasing = false, nextChase = 20, started = 0, heading = [1, 0], time = 0;
const patrols = traffic.vehicles.filter(vehicle => vehicle.police), moved = new THREE.Vector3(), step = new THREE.Vector3();
if (chases) {
  traffic.setEnvironment({ collisions, getGroundHeight: (x, z, y) => city.getMovementGroundHeight(x, z, y), getWaterInfo: (x, z) => city.getWaterInfo(x, z) });
  const finish = () => { chasing = false; nextChase = time + 30; traffic.endPursuit(); player.set(112.98, 0, 97.84); };
  window.addEventListener('police-arrest', finish);
  window.addEventListener('police-escaped', finish);
}
// Peatones: cuánto tiempo pasan dentro de un cruce y el que más esperó en el andén (si el árbol lo sabe medir).
let crossingSeconds = 0, worstPedWait = 0;
const nav = city.pedestrianNavigation;
// Sustos: los fijos (no vendedores) a menos de 16 m de un cruce, y una baldosa de andén a su lado para el jugador.
const T = nav.tileSize, crossings = nav.nodes.filter(node => node.crossing).map(node => [node.x * T, node.z * T]);
const scareable = scares ? city.npcs.filter(npc => npc.fijo && !npc.isVendor && crossings.some(([x, z]) => Math.hypot(x - npc.position.x, z - npc.position.z) < 16)) : [];
const sidewalkBeside = (x, z) => {
  let best = null, bestD = Infinity;
  const cx = Math.round(x / T), cz = Math.round(z / T);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const id = nav.grid[cz + dz]?.[cx + dx] ?? -1;
    if (id < 0 || nav.nodes[id].crossing) continue;
    const point = nav._point(id), d = Math.hypot(point.x - x, point.z - z);
    if (d > .8 && d < bestD) { bestD = d; best = point; }
  }
  return best;
};
let nextScare = 15, scared = 0;
const t0 = Date.now();
for (let frame = 0; frame < minutes * 600; frame++) {
  time = frame * .1;
  if (chases) {
    if (!chasing && time >= nextChase) {
      const patrol = patrols[started++ % patrols.length], { x, z } = patrol.car.position;
      player.set(x + 6, city.getGroundHeight(x + 6, z), z);
      traffic._startChase(patrol);
      chasing = true;
      heading = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
    }
    if (chasing) {
      collisions.resolveMove(player, step.set(heading[0] * .5, 0, heading[1] * .5), .35, moved);
      if (moved.distanceTo(player) > .25 && city.isWalkableAt(moved.x, moved.z)) player.set(moved.x, city.getGroundHeight(moved.x, moved.z), moved.z);
      else heading = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
    }
    collisions.setVehicles([...parked, ...traffic.vehicles.map(vehicle => vehicle.car)], city.busServices);
  }
  if (scares && !chasing && time >= nextScare && scareable.length) {
    nextScare = time + 20;
    const npc = scareable[scared % scareable.length], spot = sidewalkBeside(npc.position.x, npc.position.z);
    if (spot) {
      scared++;
      player.set(spot.x, city.getMovementGroundHeight(spot.x, spot.z, 0), spot.z);
      npc._fleeFrom(player.clone());
      npc.fleeTimer = Math.max(npc.fleeTimer, 4);
      window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: player } } }));
    }
  }
  city.update(.1, player, null, traffic.vehicles);
  traffic.update(.1, { player, pedestrians: city.trafficPedestrians, hour });
  for (const vehicle of traffic.vehicles) {
    const seconds = vehicle.speed < .05 ? (stoppedFor.get(vehicle) ?? 0) + .1 : 0;
    stoppedFor.set(vehicle, seconds);
    if (seconds > (longest.get(vehicle) ?? 0)) longest.set(vehicle, seconds);
    if (seconds > worst.seconds) worst = { seconds: +seconds.toFixed(1), kind: vehicle.car.kind, x: +vehicle.car.position.x.toFixed(1), z: +vehicle.car.position.z.toFixed(1) };
    // Como la prueba «fuera de la vista»: parado a más de 60 m del jugador.
    const far = vehicle.car.position.distanceTo(player) > 60 && vehicle.speed < .05 ? (farFor.get(vehicle) ?? 0) + .1 : 0;
    farFor.set(vehicle, far);
    if (far > farWorst.seconds) farWorst = { seconds: +far.toFixed(1), kind: vehicle.car.kind, x: +vehicle.car.position.x.toFixed(1), z: +vehicle.car.position.z.toFixed(1) };
    // Aparte, los buses (paran en sus paraderos) y las patrullas lejos del jugador (la cola de los cruces anchos).
    if (/bus/.test(vehicle.car.kind ?? '') && seconds > busWorst.seconds) busWorst = { seconds: +seconds.toFixed(1), kind: vehicle.car.kind, x: +vehicle.car.position.x.toFixed(1), z: +vehicle.car.position.z.toFixed(1) };
    if (vehicle.police && far > patrolFar.seconds) patrolFar = { seconds: +far.toFixed(1), x: +vehicle.car.position.x.toFixed(1), z: +vehicle.car.position.z.toFixed(1) };
  }
  for (const npc of city.npcs) {
    const id = nav.nodeAt(npc.position.x, npc.position.z);
    if (id >= 0 && nav.nodes[id].crossing) crossingSeconds += .1;
    const wait = npc.mind?.crossing?.waited ?? 0;
    if (wait > worstPedWait) worstPedWait = wait;
  }
  if (frame % 600 === 599) process.stderr.write(`[tanda s${seed}] ${Math.round(time + .1)} s de ${minutes * 60} (${((Date.now() - t0) / 1000).toFixed(0)} s reales)\n`);
}
// Retirados por estar trabados no cuentan aquí: se mide lo que sigue en la calle al final.
const stuckAtEnd = traffic.vehicles.filter(vehicle => (stoppedFor.get(vehicle) ?? 0) >= 60).length;
const all = [...longest.values()];
const result = {
  seed, minutes, chases, density, vehicles: traffic.vehicles.length,
  worst, farWorst, busWorst, patrolFar, over90: all.filter(s => s > 90).length, over180: all.filter(s => s > 180).length, stuckAtEnd,
  pedestrianCrossingSeconds: +crossingSeconds.toFixed(1), worstPedWait: +worstPedWait.toFixed(1), chasesStarted: started,
  scares: scared, scareable: scareable.length
};
performance.now = realNow;
console.log(JSON.stringify(result));
process.exit(0);
