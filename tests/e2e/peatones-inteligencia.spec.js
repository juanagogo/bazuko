import { test, expect } from '@playwright/test';

// Peatones con más cabeza (docs/peatones-inteligencia.md). Corre el bucle real del juego: las evaluaciones solo
// colocan gente y miran lo que hace.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

async function start(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Peatones QA');
  await page.locator('#creator-done').click();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
  // De día y sin lluvia, el perro lejos, y las mentes de la calle ya armadas.
  await page.evaluate(() => {
    const game = window.__game;
    game.clock.hour = 12;
    const dog = game.dog;
    if (dog) { dog.home?.set?.(dog.home.x + 25, dog.home.y, dog.home.z + 25); dog.position.x += 25; dog.position.z += 25; dog._wanderTarget = null; }
  });
  await expect.poll(() => page.evaluate(() => !!window.__game.world.active.minds)).toBe(true);
}

/**
 * Prepara un andén recto: busca cerca del jugador una fila de baldosas de andén (sin cruces) con `length` seguidas y
 * `half` baldosas de sitio a cada lado, y devuelve los extremos. Con `clear`, sin nadie parado (un vendedor, alguien
 * en su sitio, uno que mira) a menos de esos metros del andén.
 */
async function sidewalkNearPlayer(page, length = 12, half = 1, clear = 0) {
  return page.evaluate(({ length, half, clear }) => {
    const game = window.__game, city = game.world.active, nav = city.pedestrianNavigation, T = nav.tileSize;
    const standing = clear ? city.npcs.filter(n => n.fijo || n.isVendor || !n.target) : [];
    const empty = (x, z) => standing.every(n => {
      const dx = Math.max(x * T - n.position.x, 0, n.position.x - (x + length - 1) * T), dz = Math.abs(n.position.z - z * T);
      return Math.hypot(dx, dz) >= clear;
    });
    const ok = (x, z) => { const id = nav.grid[z]?.[x] ?? -1; return id >= 0 && !nav.nodes[id].crossing; };
    const px = Math.round(game.player.position.x / T), pz = Math.round(game.player.position.z / T);
    let best = null;
    for (let r = 0; r < 40 && !best; r++) {
      for (let z = pz - r; z <= pz + r && !best; z++) for (let x = px - r; x <= px + r && !best; x++) {
        let run = true;
        for (let k = 0; k < length && run; k++) for (let w = -half; w <= half && run; w++) run = ok(x + k, z + w);
        if (run && empty(x, z)) best = { x0: x * T, x1: (x + length - 1) * T, z: z * T };
      }
    }
    return best;
  }, { length, half, clear });
}

/** Dos caminantes de verdad (con mente, sin sitio fijo) puestos en los extremos, cada uno con ruta hacia el otro. */
async function placeWalkersHeadOn(page, lane) {
  return page.evaluate(({ x0, x1, z }) => {
    const game = window.__game, city = game.world.active;
    const walkers = city.npcs.filter(n => n.mind && !n.fijo && !n.isVendor && n.character && !n.koState);
    const [a, b] = walkers.slice(0, 2);
    const set = (npc, from, to) => {
      const y = city.getMovementGroundHeight(from, z, 0);
      npc.position.set(from, y, z); npc.root.position.copy(npc.position);
      const route = [];
      const dir = Math.sign(to - from);
      for (let x = from + 2 * dir; dir > 0 ? x <= to : x >= to; x += 2 * dir) route.push(new npc.position.constructor(x, city.getMovementGroundHeight(x, z, 0), z));
      npc.route = route; npc.routeIndex = 0; npc.target = route[0]; npc.wait = 0;
      npc.stance = null; npc.action = null; npc.fleeTimer = 0; npc.person.pausa = 0;
      npc.mind.side = 0; npc.mind.pace = 1;
    };
    set(a, x0, x1); set(b, x1, x0);
    window.__pair = { a, b, samples: [] };
    return [a.mind.id, b.mind.id];
  }, lane);
}

test('dos peatones de frente se cruzan sin atravesarse y sin vibrar', async ({ page }) => {
  await start(page);
  const lane = await sidewalkNearPlayer(page, 12, 1, 4);
  expect(lane, 'un andén recto y despejado cerca del inicio').toBeTruthy();
  await page.evaluate(({ x0, x1, z }) => {
    const game = window.__game, player = game.player;
    const x = (x0 + x1) / 2, pz = z + 7;
    player.position.set(x, game.world.active.getMovementGroundHeight(x, pz, 0), pz);
    player.root.position.copy(player.position); player.velocity.set(0, 0, 0); player.resetGrounding(); player.action = null;
  }, lane);
  // El cruce se mide con el andén para ellos dos: si alguien que pasa se les arrima a menos de 1,5 m, lo que se vería es
  // cómo lo esquivan a él. Se repite hasta tener un cruce limpio (en la calle de verdad pasa gente: hasta seis veces).
  let result = null;
  for (let attempt = 0; attempt < 6 && !(result && result.others >= 1.5); attempt++) {
    await placeWalkersHeadOn(page, lane);
    result = await page.evaluate(() => new Promise(resolve => {
      const game = window.__game, city = game.world.active, pair = window.__pair, { a, b } = pair;
      const rest = [...city.npcs.filter(n => n !== a && n !== b), game.dog, game.player].filter(Boolean);
      // El andén va a lo largo de X: el desvío de cada uno es su Z, y el de uno respecto al otro, la diferencia.
      let closest = Infinity, others = Infinity, nearest = null, frames = 0, maxTurn = 0, turnAt = null, startGap = null, sideSpeed = 0;
      let swings = 0, way = 0, edge = b.position.z - a.position.z;
      const off0 = edge, last = { a: { z: a.position.z, yaw: a.root.rotation.y }, b: { z: b.position.z, yaw: b.root.rotation.y } };
      const recent = [];
      const t0 = performance.now();
      let before = t0;
      const step = () => {
        frames++;
        const now = performance.now(), dt = Math.max(1e-3, (now - before) / 1000);
        before = now;
        const gap = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        closest = Math.min(closest, gap);
        for (const o of rest) for (const n of [a, b]) {
          const d = Math.hypot(o.position.x - n.position.x, o.position.z - n.position.z);
          if (d < others) { others = d; nearest = o === game.player ? 'jugador' : o === game.dog ? 'perro' : `${o.arquetipo ?? 'npc'}${o.fijo ? ' fijo' : ''}${o.target ? ' andando' : ' quieto'} (${o.position.x.toFixed(1)}, ${o.position.z.toFixed(1)})`; }
        }
        const off = b.position.z - a.position.z;
        if (startGap === null && Math.abs(off - off0) > .02) startGap = gap;
        if (gap < 4) {
          // Un cambio de lado: el desvío de uno respecto al otro venía creciendo y se devuelve más de 2 cm (o al revés).
          // Abrirse para pasar y cerrarse después es uno; temblar o hacer zigzag son más.
          if (!way) { if (Math.abs(off - edge) > .02) { way = Math.sign(off - edge); edge = off; } }
          else if ((off - edge) * way > 0) edge = off;
          else if (Math.abs(off - edge) > .02) { swings++; way = -way; edge = off; }
        }
        // A qué velocidad se corre de lado cada uno, promediada en un cuarto de segundo (un cuadro suelto no dice nada).
        recent.push([now, a.position.z, b.position.z]);
        while (recent.length > 2 && now - recent[0][0] > 250) recent.shift();
        const span = (now - recent[0][0]) / 1000;
        if (span > .2) sideSpeed = Math.max(sideSpeed, Math.abs(a.position.z - recent[0][1]) / span, Math.abs(b.position.z - recent[0][2]) / span);
        for (const [key, npc] of [['a', a], ['b', b]]) {
          const l = last[key];
          l.z = npc.position.z;
          let turn = Math.abs(npc.root.rotation.y - l.yaw) % (2 * Math.PI);
          if (turn > Math.PI) turn = 2 * Math.PI - turn;
          // Mientras se esquivan (a menos de 4 m): cuánto gira por segundo.
          if (gap < 4 && turn / dt > maxTurn) {
            maxTurn = turn / dt;
            turnAt = { who: key, gap: +gap.toFixed(2), side: +npc.mind.side.toFixed(2), toNode: npc.target ? +Math.hypot(npc.target.x - npc.position.x, npc.target.z - npc.position.z).toFixed(2) : null, dt: +dt.toFixed(3) };
          }
          l.yaw = npc.root.rotation.y;
        }
        const passed = a.position.x > b.position.x + 3;
        if (passed || performance.now() - t0 > 25_000) {
          resolve({ closest, swings, frames, passed, maxTurn, turnAt, startGap, sideSpeed, others, nearest, lane: [pair.a.route.at(-1).x, pair.b.route.at(-1).x, a.position.z], ax: a.position.x, bx: b.position.x });
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }));
    console.log('[peatones] cruce de frente', JSON.stringify(result));
  }
  expect(result.others, `nadie más se les arrimó (${result.nearest})`).toBeGreaterThanOrEqual(1.5);
  expect(result.passed, `no se cruzaron: ${result.ax.toFixed(1)} / ${result.bx.toFixed(1)}`).toBe(true);
  // Se abren con tiempo, sin afán, y se pasan con su espacio: no a un roce. El lado lo escogen a unos 5 m; aquí se mide
  // desde cuándo ya se han abierto 2 cm, que cae entre 4 y 5,6 m según en qué cuadro le toque pensar a cada uno.
  expect(result.startGap, 'empiezan a abrirse con tiempo, a más de 3,5 m').toBeGreaterThanOrEqual(3.5);
  expect(result.closest).toBeGreaterThanOrEqual(.8);
  expect(result.sideSpeed, 'de lado se corren a paso tranquilo').toBeLessThanOrEqual(.55);
  expect(result.swings, 'cambios de lado: vibración o zigzag').toBeLessThanOrEqual(1);
  // Al esquivarse el cuerpo no da quiebres: gira menos de ~60° por segundo.
  expect(result.maxTurn).toBeLessThan(1);
});

test('un peatón espera en el borde a que pase el carro y después cruza, sin pasarse de su paciencia', async ({ page }) => {
  await start(page);
  // Un carro de verdad en marcha que en unos segundos pasa, en línea recta, por un paso de cebra sin semáforo. Se
  // pone a un caminante en el borde de ese paso, con ruta al otro lado, y se mira cada cuadro.
  let result = null;
  for (let attempt = 0; attempt < 40 && !result?.found; attempt++) {
    if (attempt) await page.waitForTimeout(500);
    result = await page.evaluate(async () => {
      const { signalFor, CROSS } = await import('/src/entities/npc/crossing.js');
      const game = window.__game, city = game.world.active, nav = city.pedestrianNavigation, T = nav.tileSize;
      const V = game.player.position.constructor, p = new V(), dir = new V(), d0 = new V();
      const nodeId = (x, z) => nav.grid[z]?.[x] ?? -1;
      let plan = null;
      for (const vehicle of game.traffic.vehicles) {
        if (plan) break;
        if (vehicle.state === 'chase' || vehicle.rejoinTarget || vehicle.police || vehicle.speed < 5) continue;
        vehicle.route.sample(vehicle.distance, p, d0);
        for (let ahead = 14; ahead <= 40 && !plan; ahead++) {
          vehicle.route.sample(vehicle.distance + ahead, p, dir);
          if (dir.x * d0.x + dir.z * d0.z < .995) break; // dobla antes: la cuenta en línea recta no vale
          const id = nav.nodeAt(p.x, p.z), n = nav.nodes[id];
          if (!n?.crossing || n.underDeck) continue;
          // El paso va de través al carro, por la cuadrícula: de un borde del andén al otro.
          const sx = Math.abs(dir.x) > Math.abs(dir.z) ? 0 : 1, sz = 1 - sx;
          const edge = sign => {
            const tiles = [];
            for (let k = 1; k < 14; k++) {
              const other = nodeId(n.x + sign * sx * k, n.z + sign * sz * k);
              if (other < 0) return null;
              if (!nav.nodes[other].crossing) return { curb: other, tiles };
              tiles.push(other);
            }
            return null;
          };
          const a = edge(-1), b = edge(1);
          if (!a || !b) continue;
          const beyond = nodeId(nav.nodes[b.curb].x + sx, nav.nodes[b.curb].z + sz);
          const ids = [a.curb, ...a.tiles.reverse(), id, ...b.tiles, b.curb];
          if (beyond >= 0 && !nav.nodes[beyond].crossing) ids.push(beyond);
          const A = nav._point(a.curb), B = nav._point(b.curb), length = Math.hypot(B.x - A.x, B.z - A.z);
          const span = { ax: A.x, az: A.z, ux: (B.x - A.x) / length, uz: (B.z - A.z) / length, length };
          if (signalFor(city.signals, span).axis >= 0) continue;
          // El jugador, cerca y en el andén, fuera de la ruta y del carril.
          let spot = null;
          for (const s of [3, -3, 4, -4]) {
            const pid = nodeId(nav.nodes[a.curb].x + sz * s, nav.nodes[a.curb].z + sx * s);
            if (pid >= 0 && !nav.nodes[pid].crossing) { spot = nav._point(pid); break; }
          }
          if (!spot) continue;
          plan = { vehicle, ids, A, B, span, cross: { x: p.x, z: p.z, hx: dir.x, hz: dir.z }, spot, lastChance: CROSS.lastChance, grace: CROSS.grace };
        }
      }
      if (!plan) return { found: false };
      const player = game.player;
      player.position.copy(plan.spot); player.root.position.copy(player.position);
      player.velocity.set(0, 0, 0); player.resetGrounding(); player.action = null;
      const walker = city.npcs.find(n => n.mind && !n.fijo && !n.isVendor && n.character && !n.koState && n.fleeTimer <= 0);
      const route = plan.ids.map(id => nav._point(id));
      walker.position.copy(route[0]); walker.root.position.copy(walker.position);
      walker.route = route; walker.routeIndex = 0; walker.target = route[0]; walker.wait = 0;
      walker.stance = null; walker.action = null; walker.person.pausa = 0;
      walker.mind.crossing.state = 0; walker.mind.crossing.target = null; walker.mind.crossing.waited = 0;
      const { vehicle, cross, B } = plan, car = vehicle.car;
      // Del paso de cebra al carro, por el rumbo del carro: negativo mientras no llega.
      const along = () => (car.position.x - cross.x) * cross.hx + (car.position.z - cross.z) * cross.hz;
      const startAlong = along();
      return new Promise(resolve => {
        const t0 = performance.now();
        let maxWaited = 0, stepOn = null, carStopped = false, stop = null;
        const tick = () => {
          const t = (performance.now() - t0) / 1000;
          const c = walker.mind.crossing, here = nav.nodeAt(walker.position.x, walker.position.z);
          maxWaited = Math.max(maxWaited, c.waited);
          const passed = along() > car.length / 2 + 1;
          if (!passed && vehicle.speed < .5 && !carStopped) {
            carStopped = true;
            // Dónde y por qué se detuvo: ¿por el caminante?
            const hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
            const wx = walker.position.x - car.position.x, wz = walker.position.z - car.position.z;
            stop = { t, along: +along().toFixed(2), personBlocked: !!vehicle.personBlocked, walkerAhead: +(wx * hx + wz * hz).toFixed(2),
              walkerSide: +(-wx * hz + wz * hx).toFixed(2), waiting: walker.mind.waiting, clearance: vehicle.hardClearance };
          }
          if (!stepOn && here >= 0 && nav.nodes[here].crossing) {
            const gap = -along() - car.length / 2;
            stepOn = { t, passed, speed: vehicle.speed, seconds: vehicle.speed > .5 ? gap / vehicle.speed : Infinity };
          }
          const arrived = Math.hypot(walker.position.x - B.x, walker.position.z - B.z) < .6;
          if (arrived || t > 45) {
            resolve({ found: true, arrived, t, maxWaited, maxWait: c.maxWait, grace: plan.grace, stepOn, carStopped,
              startAlong, stop, length: plan.span.length });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    });
  }
  console.log('[peatones] cruce con carro', JSON.stringify(result));
  expect(result?.found, 'un carro en marcha hacia un paso de cebra sin semáforo').toBe(true);
  expect(result.arrived, 'llegó al otro lado').toBe(true);
  expect(result.maxWaited, 'no esperó más que su paciencia').toBeLessThanOrEqual(result.maxWait + result.grace + .1);
  // Al bajar a la calzada el carro ya pasó, está detenido o le falta tiempo de sobra para llegar.
  const s = result.stepOn;
  expect(s.passed || s.speed < .5 || s.seconds > 3, `bajó con el carro a ${s.seconds.toFixed(1)} s`).toBe(true);
  // Si el carro no se detuvo antes del paso, tuvo que esperarlo en el borde.
  if (!result.carStopped) expect(result.maxWaited).toBeGreaterThan(.3);
});

/**
 * Lleva al jugador al sitio más abierto cerca del inicio (la baldosa con más andén alrededor, sin calzada) y
 * devuelve su centro. Ahí caben un robo con testigos o una pelea con su corrillo.
 */
async function openSpot(page) {
  return page.evaluate(() => {
    const game = window.__game, city = game.world.active, nav = city.pedestrianNavigation, T = nav.tileSize;
    const ok = (x, z) => { const id = nav.grid[z]?.[x] ?? -1; return id >= 0 && !nav.nodes[id].crossing && nav.nodes[id].main; };
    const px = Math.round(game.player.position.x / T), pz = Math.round(game.player.position.z / T);
    let best = null, bestCount = -1;
    for (let z = pz - 40; z <= pz + 40; z += 2) for (let x = px - 40; x <= px + 40; x += 2) {
      if (!ok(x, z)) continue;
      let count = 0;
      for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) if (dx * dx + dz * dz <= 25 && ok(x + dx, z + dz)) count++;
      if (count > bestCount) { bestCount = count; best = { x: x * T, z: z * T }; }
    }
    const player = game.player, y = city.getMovementGroundHeight(best.x, best.z, 0);
    player.position.set(best.x, y, best.z); player.root.position.copy(player.position);
    player.velocity.set(0, 0, 0); player.resetGrounding(); player.action = null;
    return { ...best, open: bestCount };
  });
}

/**
 * Pone a `count` caminantes con mente en puntos pisables a `radius` m del jugador, de cara a él, quietos: repartidos
 * alrededor o, con `angles` (radianes, uno por persona), cada uno lo más cerca de ese rumbo que se pueda pisar.
 */
async function placeAround(page, count, radius, tipo, angles = null) {
  return page.evaluate(({ count, radius, tipo, angles }) => {
    const game = window.__game, city = game.world.active, nav = city.pedestrianNavigation, p = game.player.position;
    const people = city.npcs.filter(n => n.mind && !n.fijo && !n.isVendor && n.character && !n.koState && n.fleeTimer <= 0)
      .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p)).slice(0, count);
    const placed = [];
    for (let k = 0; k < people.length; k++) {
      const npc = people[k];
      for (let tries = 0; tries < 24; tries++) {
        const a = angles ? angles[k] + (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * .06 : (k / people.length + tries / 24) * Math.PI * 2;
        const x = p.x + Math.sin(a) * radius, z = p.z + Math.cos(a) * radius;
        const id = nav.nodeAt(x, z);
        if (id < 0 || nav.nodes[id].crossing || !nav.nodes[id].main) continue;
        npc.position.set(x, city.getMovementGroundHeight(x, z, 0), z); npc.root.position.copy(npc.position);
        npc.root.rotation.y = Math.atan2(p.x - x, p.z - z);
        npc.target = null; npc.route = []; npc.wait = 1e6; npc.stance = null; npc.action = null; npc.person.pausa = 0;
        const { TEMPERS } = window.__peatones ?? {};
        if (TEMPERS) npc.mind.temper = { ...npc.mind.temper, ...TEMPERS[tipo], tipo };
        placed.push(npc);
        break;
      }
    }
    return placed.length;
  }, { count, radius, tipo, angles });
}

test('quien ve un raponazo huye por la red de andenes, lejos del ladrón y sin estrellarse ni agacharse', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => { window.__peatones = await import('/src/entities/npc/temperament.js'); });
  const spot = await openSpot(page);
  expect(spot.open, 'un sitio abierto cerca del inicio').toBeGreaterThan(40);
  expect(await placeAround(page, 2, 7, 'miedoso')).toBe(2);
  const result = await page.evaluate(() => new Promise(resolve => {
    const game = window.__game, city = game.world.active, nav = city.pedestrianNavigation, p = game.player.position;
    const near = city.npcs.filter(n => n.mind && Math.hypot(n.position.x - p.x, n.position.z - p.z) < 7.5 && Math.hypot(n.position.x - p.x, n.position.z - p.z) > 6.5);
    const [victim, witness] = near;
    // La víctima, al lado del jugador; el testigo sigue a 7 m mirándolo.
    victim.position.set(p.x + .8, victim.position.y, p.z); victim.root.position.copy(victim.position);
    game.steal.executeRoboDirecto(victim); // el raponazo de verdad: botín, grito, aviso a la policía
    const start = { x: witness.position.x, z: witness.position.z };
    let routed = false, cowered = false, offNet = 0, farthest = 0, backed = false, frames = 0, stuck = 0, last = { ...start };
    const sim0 = city.minds.time;
    let lastSim = sim0, goal = 0;
    const t0 = performance.now();
    const tick = () => {
      frames++;
      const a = witness.mind.aware;
      // Solo cuentan los cuadros en que el juego avanzó (un cuadro sin simulación no mueve a nadie).
      const advanced = city.minds.time > lastSim + 1e-6;
      lastSim = city.minds.time;
      if (a.reaction === 1) backed = true;
      if (witness._fleeRouted) {
        routed = true;
        const end = witness.route.at(-1);
        if (end) goal = Math.max(goal, Math.hypot(end.x - p.x, end.z - p.z));
      }
      if (witness._cowering) cowered = true;
      if (nav.nodeAt(witness.position.x, witness.position.z) < 0) offNet++;
      farthest = Math.max(farthest, Math.hypot(witness.position.x - p.x, witness.position.z - p.z));
      // Corriendo pero sin avanzar: contra un muro.
      if (advanced && witness.fleeTimer > 0 && witness.moving && Math.hypot(witness.position.x - last.x, witness.position.z - last.z) < 1e-3) stuck++;
      last = { x: witness.position.x, z: witness.position.z };
      if (performance.now() - t0 > 9000) {
        resolve({ routed, cowered, offNet, farthest, goal, backed, frames, stuck, level: a.level, tipo: witness.mind.temper.tipo,
          simSeconds: city.minds.time - sim0, start: Math.hypot(start.x - p.x, start.z - p.z) });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log('[peatones] testigo de un robo', JSON.stringify(result));
  expect(result.backed, 'retrocedió de frente antes de correr').toBe(true);
  expect(result.routed, 'huyó por una ruta de la red').toBe(true);
  expect(result.cowered, 'se agachó con salida').toBe(false);
  expect(result.offNet, 'se salió de la red').toBe(0);
  expect(result.stuck, 'cuadros corriendo contra algo').toBeLessThan(10);
  // Planeó ir lejos y se alejó: al menos lo que pide la huida (4 m más que donde estaba). Hasta dónde llega en 9 s
  // depende de su paso y de las esquinas del camino: los 8 s de huida se le acaban antes de llegar.
  expect(result.goal, 'a dónde planeó huir').toBeGreaterThan(16);
  expect(result.farthest).toBeGreaterThan(result.start + 4);
});

test('una pelea arma corrillo: los curiosos llegan a paso vivo y quedan en arco a 4-6 m, de cara y a un metro entre sí, y se van al acabarse', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => { window.__peatones = await import('/src/entities/npc/temperament.js'); });
  const spot = await openSpot(page);
  expect(spot.open).toBeGreaterThan(40);
  // Seis curiosos a 10 m, tres de cada lado (como llega la gente por un andén): cada grupo arma su arco.
  const placed = await placeAround(page, 6, 10, 'curioso', [-.35, 0, .35, Math.PI - .35, Math.PI, Math.PI + .35].map(a => a + Math.PI / 2));
  expect(placed).toBeGreaterThanOrEqual(5);
  // La pelea: el jugador reparte golpes 12 s de juego (lo que el juego avisa con `street-fight` en cada golpe que
  // conecta). El tiempo es el de la simulación: no depende de cuántos cuadros alcance a pintar la máquina.
  const result = await page.evaluate(() => new Promise(resolve => {
    const game = window.__game, city = game.world.active, p = game.player.position;
    const people = city.npcs.filter(n => n.mind && Math.abs(Math.hypot(n.position.x - p.x, n.position.z - p.z) - 10) < .5);
    const sim0 = city.minds.time, wall0 = performance.now();
    const arrived = new Map();
    let hits = 0, arc = null, best = 0;
    const facing = n => {
      const a = n.root.rotation.y - Math.atan2(p.x - n.position.x, p.z - n.position.z);
      return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    };
    const tick = () => {
      const t = city.minds.time - sim0;
      if (t < 12 && t >= hits) { hits++; window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: game.player } })); }
      // Plantados: mirando, ya en su puesto (no en el último paso hacia él), en el anillo y de cara.
      const planted = people.filter(n => n.mind.aware.watching && !n.target
        && Math.hypot(n.position.x - n.mind.aware.watchX, n.position.z - n.mind.aware.watchZ) < .15).map(n => ({
        n, d: Math.hypot(n.position.x - p.x, n.position.z - p.z), facing: facing(n), x: n.position.x, z: n.position.z
      })).filter(w => w.d >= 3.9 && w.d <= 6.1 && w.facing < .5);
      for (const w of planted) if (!arrived.has(w.n)) arrived.set(w.n, t);
      if (!arc && t < 8) {
        // El arco: tres o más, ninguno a menos de 0,9 m de otro y al menos tres con alguien al lado a 0,9-1,2 m.
        const near = w => Math.min(...planted.filter(o => o !== w).map(o => Math.hypot(o.x - w.x, o.z - w.z)));
        const apart = planted.every(w => near(w) >= .9);
        const together = planted.filter(w => near(w) <= 1.2).length;
        best = Math.max(best, apart ? together : 0);
        if (planted.length >= 3 && apart && together >= 3) {
          arc = { t, ring: planted.map(w => ({ d: +w.d.toFixed(2), facing: +w.facing.toFixed(2), next: +near(w).toFixed(2) })) };
        }
      }
      if (t > 32 || performance.now() - wall0 > 90_000) {
        resolve({ arc, best, arrivals: [...arrived.values()].map(v => +v.toFixed(2)).sort((a, b) => a - b),
          after: people.filter(n => n.mind.aware.watching).length, people: people.length, simSeconds: t });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log('[peatones] corrillo', JSON.stringify(result));
  expect(result.simSeconds, 'el juego avanzó').toBeGreaterThan(32);
  expect(result.arc, `arco de tres o más antes de 8 s (mejor: ${result.best})`).toBeTruthy();
  // Llegan escalonados a paso vivo: los primeros, pasados unos 3 s; antes de 6,5 s ya hay arco.
  expect(result.arrivals[0], 'nadie se planta al instante').toBeGreaterThanOrEqual(2.5);
  expect(result.arc.t).toBeLessThanOrEqual(6.5);
  expect(result.after, 'se dispersaron al acabarse').toBe(0);
});

test('quien lo vio robar se acuerda: un rato después le saca el cuerpo y no le da limosna; quien no vio pasa normal', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => { window.__peatones = await import('/src/entities/npc/temperament.js'); });
  const spot = await openSpot(page);
  expect(spot.open).toBeGreaterThan(40);
  // Un andén ancho cerca; el jugador se para en la mitad, en el camino, y cada uno lo recorre de punta a punta.
  const lane = await sidewalkNearPlayer(page, 12, 2);
  expect(lane, 'un andén ancho cerca').toBeTruthy();
  await page.evaluate(({ lane, spot }) => {
    const game = window.__game, city = game.world.active, player = game.player, { x0, x1, z } = lane, mid = (x0 + x1) / 2;
    const put = (x, pz) => {
      player.position.set(x, city.getMovementGroundHeight(x, pz, 0), pz); player.root.position.copy(player.position);
      player.velocity.set(0, 0, 0); player.resetGrounding(); player.action = null;
    };
    const park = (npc, k) => { npc.position.set(x0 + 60 * k, npc.position.y, z + 60 * k); npc.root.position.copy(npc.position); npc.target = null; npc.route = []; npc.wait = 1e6; };
    const walk = npc => new Promise(resolve => {
      put(mid, z);
      // El andén despejado: los demás que andan por ahí, lejos (si no, alguien parado en la punta lo hace buscar
      // otro camino y la cuenta ya no es del jugador).
      for (const other of city.npcs) {
        if (other === npc || !other.mind || other.fijo || other.isVendor) continue;
        const dx = Math.max(x0 - other.position.x, 0, other.position.x - x1);
        if (Math.hypot(dx, other.position.z - z) < 10) park(other, -2);
      }
      npc.position.set(x0, city.getMovementGroundHeight(x0, z, 0), z); npc.root.position.copy(npc.position); npc.root.rotation.y = Math.PI / 2;
      const route = [];
      for (let x = x0 + 2; x <= x1; x += 2) route.push(new npc.position.constructor(x, city.getMovementGroundHeight(x, z, 0), z));
      npc.route = route; npc.routeIndex = 0; npc.target = route[0]; npc.wait = 0;
      npc.stance = null; npc.action = null; npc.fleeTimer = 0; npc.person.pausa = 0; npc.mind.side = 0; npc.mind.pace = 1;
      // 25 s de juego (no de reloj: con la máquina cargada el juego avanza menos por segundo), con un tope de reloj.
      const sim0 = city.minds.time, wall0 = performance.now();
      let closest = Infinity;
      const tick = () => {
        closest = Math.min(closest, Math.hypot(npc.position.x - player.position.x, npc.position.z - player.position.z));
        if (npc.position.x > mid + 4 || city.minds.time - sim0 > 25 || performance.now() - wall0 > 90_000) {
          resolve({ closest, passed: npc.position.x > mid + 4, refuses: npc.mind.refusesAlms(), level: npc.mind.aware.level, room: npc.mind.playerRoom });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    window.__memoria = { put, park, walk, spot };
  }, { lane, spot });
  // Antes del robo: alguien con mente, sin sitio fijo, pasa junto al jugador; después se va lejos.
  const control = await page.evaluate(async () => {
    const game = window.__game, city = game.world.active, m = window.__memoria;
    const npc = city.npcs.find(n => n.mind && !n.fijo && !n.isVendor && n.character && !n.koState && n.fleeTimer <= 0);
    const result = await m.walk(npc);
    m.park(npc, 1);
    return result;
  });
  // El robo: un cosquilleo fallido de verdad en el sitio abierto, y la víctima lo pilla (el juego avisa que gritó). Solo
  // lo ve quien estaba mirando. Uno limpio no lo ve nadie: así lo dice el juego («nadie se dio cuenta»).
  await page.evaluate(() => { const m = window.__memoria; m.put(m.spot.x, m.spot.z); });
  expect(await placeAround(page, 2, 7, 'curioso')).toBe(2);
  const theft = await page.evaluate(() => new Promise(resolve => {
    const game = window.__game, city = game.world.active, p = game.player.position;
    const near = city.npcs.filter(n => n.mind && Math.abs(Math.hypot(n.position.x - p.x, n.position.z - p.z) - 7) < .5);
    const [victim, witness] = near;
    victim.position.set(p.x + .8, victim.position.y, p.z); victim.root.position.copy(victim.position);
    window.__memoria.witness = witness;
    game.steal.startCosquilleo(victim);
    // Que lo note seguro, y sin el aviso a la patrulla: que no venga a meterse en la prueba.
    victim.alerta = 2;
    const traffic = game.traffic;
    game.traffic = null;
    game.steal._endMinigame(false);
    game.traffic = traffic;
    const sim0 = city.minds.time, wall0 = performance.now();
    const tick = () => {
      if (city.minds.time - sim0 > 2 || performance.now() - wall0 > 20_000) {
        resolve({ witness: witness.mind.aware.memory.grudge(city.minds.time), wanted: game.traffic?.wantedLevel ?? 0 });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  // Un rato después, el testigo recorre el mismo andén.
  const witness = await page.evaluate(() => window.__memoria.walk(window.__memoria.witness));
  console.log('[peatones] memoria', JSON.stringify({ theft, control, witness }));
  expect(theft.witness, 'el testigo se acuerda').toBeGreaterThan(.2);
  expect(control.passed && witness.passed, 'los dos pasaron').toBe(true);
  expect(control.refuses).toBe(false);
  expect(witness.refuses, 'quien lo vio no le da limosna').toBe(true);
  expect(control.closest, 'quien no vio pasa a lo normal').toBeLessThan(1.6);
  expect(witness.closest, 'quien lo vio le saca el cuerpo').toBeGreaterThanOrEqual(2);
});
