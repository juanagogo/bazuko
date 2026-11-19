import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCity, loadTree } from '../tools/peatones/montaje.mjs';
import { canSee, SENSES } from '../src/entities/npc/perception.js';
import { sightClear, solidAt } from '../src/entities/npc/room.js';

// El corrillo en la ciudad montada como el juego (Bogotá, sus NPC, el tráfico), con semilla fija: una pelea a puños del
// jugador donde más gente anda junta mirones de verdad, sin poner a nadie a mano, y una en una calle sola sigue sola.
// Las reglas, una por una, van en tests/npc-corrillo.test.js.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realRandom = Math.random, realNow = performance.now;
globalThis.window = new EventTarget();
let clock = 0;
performance.now = () => clock;
after(() => { Math.random = realRandom; performance.now = realNow; });
const tree = await loadTree(root);
const { THREE } = tree;
const DT = 1 / 60;

/** La ciudad de `seed`, andando: `step(segundos, cadaCuadro)` corre cuadros como el juego, con el jugador en `player`. */
async function cityOf(seed) {
  const { city, traffic, collisions } = await buildCity(tree, seed);
  const player = new THREE.Vector3(112.98, 0, 97.84);
  const camera = new THREE.PerspectiveCamera(55, 1280 / 800, .1, 300);
  const step = (seconds, each = () => {}) => {
    for (let frame = Math.round(seconds / DT); frame > 0; frame--) {
      clock += DT * 1000;
      player.y = city.getMovementGroundHeight(player.x, player.z, 0);
      camera.position.set(player.x - 4, player.y + 3, player.z + 4);
      camera.lookAt(player.x, player.y + 1.4, player.z);
      camera.updateMatrixWorld();
      each();
      city.update(DT, player, camera, traffic.vehicles);
      traffic.update(DT, { player, pedestrians: city.trafficPedestrians, camera, hour: 15 });
    }
  };
  return { city, player, step, collisions };
}

/**
 * Una pelea del jugador junto a `victim`: ocho golpes, uno cada 1,5 s, y lo que dura la escena después (8 s). Devuelve
 * cuántos miraban a la vez como mucho, quiénes miraron y cuántos cuadros alguien miró parado en la calzada.
 */
function fightBy({ city, player, step }, victim, stand = null) {
  const nav = city.pedestrianNavigation, spot = victim.position.clone();
  const people = city.npcs.filter(n => n.mind && n !== victim);
  const onRoad = n => !!nav.nodes[nav.nodeAt(n.position.x, n.position.z)]?.crossing;
  player.set(stand?.x ?? (spot.x - .8), 0, stand?.z ?? spot.z);
  const watched = new Map();
  let most = 0, standingOnRoad = 0, blows = 0, next = 0, t = 0, last = null;
  step(24, () => {
    if (blows < 8 && t >= next) { next += 1.5; blows++; window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: { position: player } } })); }
    let now = 0;
    for (const n of people) {
      const a = n.mind.aware;
      if (!a.watching || Math.hypot(n.position.x - spot.x, n.position.z - spot.z) > 30) continue;
      now++; last = t;
      watched.set(n, n.mind.temper.tipo);
      if ((!n.target || a.watchPass) && onRoad(n)) standingOnRoad++;
    }
    most = Math.max(most, now);
    t += DT;
  });
  return { most, watched: [...watched.values()].sort(), standingOnRoad, last };
}

const walkers = city => city.npcs.filter(n => n.mind && !n.fijo && !n.koState);

/** Un claro en el andén con gente que va caminando y tiene vista al lugar de la pelea. */
function busySidewalk({ city, collisions }) {
  const nav = city.pedestrianNavigation, people = walkers(city);
  const clear = (x, y, z) => {
    const node = nav.nodes[nav.nodeAt(x, z)];
    return node?.main && !node.crossing && !solidAt(collisions, x, y, z);
  };
  // El juego permite acercarse desde cualquiera de los cuatro lados del peatón.
  const offsets = [[-.8, 0], [.8, 0], [0, -.8], [0, .8]];
  const sameSide = (ax, az, bx, bz) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, node = nav.nodes[nav.nodeAt(ax + (bx - ax) * t, az + (bz - az) * t)];
      if (!node?.main || node.crossing) return false;
    }
    return true;
  };
  let best = null;
  for (const victim of people) {
    const v = victim.position;
    for (const [dx, dz] of offsets) {
      const x = v.x + dx, z = v.z + dz;
      if (!clear(x, v.y, z)) continue;
      let visible = 0, facing = 0, close = 0;
      for (const other of people) {
        if (other === victim || !other.moving || !other.target) continue;
        const p = other.position, distance = Math.hypot(p.x - x, p.z - z);
        if (distance <= 5 || distance >= SENSES.sight || !clear(p.x, p.y, p.z)
          || !sightClear(collisions, p.y, p.x, p.z, x, z) || !sameSide(p.x, p.z, x, z)) continue;
        visible++;
        if (distance <= 12) close++;
        if (canSee(p.x, p.z, other.root.rotation.y, x, z, SENSES.sight)) facing++;
      }
      if (!best || visible > best.visible || (visible === best.visible &&
        (facing > best.facing || (facing === best.facing && close > best.close)))) {
        best = { victim, stand: {x, z}, visible, facing, close };
      }
    }
  }
  return best;
}

test('en la ciudad, una pelea donde anda gente junta mirones sin que nadie los ponga: dos o más a la vez, ninguno parado en la calzada, y se van cuando se acaba', async () => {
  // Las dos ciudades se montan en este orden y en este proceso: así dan siempre lo mismo.
  let total = 0;
  for (const seed of [14, 22]) {
    const world = await cityOf(seed);
    world.step(30);
    // Espera a que haya un grupo natural en el mismo andén. Sólo se consulta
    // su posición y orientación antes de que empiece la escena.
    let site = busySidewalk(world);
    for (let s = 30; s < 300 && !(site?.visible >= 5 && site.facing >= 2); s += 3) {
      world.step(3);
      site = busySidewalk(world);
    }
    assert.ok(site?.visible >= 3, `semilla ${seed}: andan ${site?.visible ?? 0} cerca y a la vista`);
    const result = fightBy(world, site.victim, site.stand);
    assert.ok(result.most >= 2, `semilla ${seed}: miraron ${result.most} a la vez (${result.watched.join(', ') || 'nadie'})`);
    total += result.watched.length;
    assert.equal(result.standingOnRoad, 0, `semilla ${seed}: nadie mira parado en la calzada`);
    // La escena acaba a los 18,5 s (8 s después del último golpe) y se van de 1 a 4 s después.
    assert.ok(result.last < 18.5 + 4.6, `semilla ${seed}: el último dejó de mirar a los ${result.last?.toFixed(1)} s`);
  }
  assert.ok(total >= 5, `entre las dos peleas miraron ${total}`);
});

test('en la ciudad, una pelea en una calle sola sigue sola: nadie llega de lejos a mirarla', async () => {
  const world = await cityOf(14);
  world.step(30);
  // Junto al peatón con menos gente a 25 m.
  const people = world.city.npcs.filter(n => n.mind);
  const around = n => people.filter(o => o !== n && Math.hypot(o.position.x - n.position.x, o.position.z - n.position.z) < 25).length;
  const victim = walkers(world.city).reduce((best, n) => (around(n) < around(best) ? n : best));
  assert.equal(around(victim), 0, 'no hay nadie a 25 m');
  const result = fightBy(world, victim);
  assert.equal(result.most, 0, `miraron ${result.watched.join(', ')}`);
});
