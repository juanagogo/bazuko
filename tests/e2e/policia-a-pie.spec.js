import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Los agentes de la patrulla se bajan y persiguen a pie, con el bucle real del juego. Las evaluaciones solo ponen al
// jugador y a la patrulla en su sitio, arrancan la persecución como un robo visto y observan; lo que deciden los agentes,
// el tráfico, el arresto y el guardado son los de verdad.

// La partida se limpia una sola vez por prueba: la de guardar y cargar recarga la página y necesita lo guardado.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('policia-limpio')) return;
    localStorage.clear();
    sessionStorage.setItem('policia-limpio', '1');
  });
});

// Si algo falla, queda la secuencia de estados de la tripulación para saber dónde se quedó.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const log = await page.evaluate(() => window.__policia && {
    states: window.__policia.states, arrests: window.__policia.arrests, escapes: window.__policia.escapes
  }).catch(() => null);
  if (log) await testInfo.attach('policia.json', { body: JSON.stringify(log, null, 1), contentType: 'application/json' });
});

async function start(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#creator-modal')).toBeVisible({ timeout: 120_000 });
  await page.locator('#cr-name').fill('Policía QA');
  await page.locator('#creator-done').click();
  await resume(page);
}

async function resume(page) {
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Continuar jugando', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__game.paused)).toBe(false);
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

/** Tiras de cuadros: van a EVIDENCIAS si existe (para mirarlas después) y si no, a la salida de la prueba. */
async function stripDir(testInfo, name) {
  const dir = process.env.EVIDENCIAS ? path.join(process.env.EVIDENCIAS, name) : testInfo.outputPath(name);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Fotos seguidas mientras `isOn` lo diga: espera el primer cuadro en que pasa (la bajada dura menos de 2 s). */
async function strip(page, dir, prefix, isOn, max = 14) {
  await page.waitForFunction(isOn, null, { polling: 'raf', timeout: 30_000 });
  let count = 0;
  while (count < max && await page.evaluate(isOn)) {
    await page.screenshot({ path: path.join(dir, `${prefix}-${String(count).padStart(2, '0')}.png`) });
    count++;
  }
  return count;
}

/**
 * Solo para las fotos: la cámara deja de seguir al jugador y mira la puerta del acompañante desde afuera y un poco
 * adelante, a 6 m. `on = false` la devuelve al jugador.
 */
async function aimAtDoor(page, on = true) {
  await page.evaluate(on => {
    const rig = window.__game.cameraRig;
    if (!rig.__followPlayer) {
      rig.__followPlayer = rig.follow.bind(rig);
      rig.follow = (target, ...rest) => rig.__followPlayer(window.__aim?.() ?? target, ...rest);
    }
    window.__aim = on ? () => {
      const { unit } = window.__policia, fit = unit.fit, car = fit.car, side = unit.partner.out ? unit.partner.doorSide : unit.partner.seatSide;
      const door = fit.doorPoint(side);
      const yaw = car.group.rotation.y, ox = door.x - car.position.x, oz = door.z - car.position.z, length = Math.hypot(ox, oz) || 1;
      const dx = ox / length + Math.cos(yaw) * .8, dz = oz / length - Math.sin(yaw) * .8;
      rig.yaw = Math.atan2(dx, dz);
      return door;
    } : null;
    rig.pitch = on ? .28 : .22;
    rig.distance = on ? 6 : 5.5;
    rig._snap = true;
  }, on);
}

/**
 * Pone al jugador en la calle, unos metros delante de una patrulla de ronda, con la cámara mirándola, aparta a El Chato
 * y deja un registro de lo que hace la tripulación cuadro a cuadro.
 */
async function facePatrol(page, { ahead = 24, wanted = 1, pair = false } = {}) {
  return page.evaluate(({ ahead, wanted, pair }) => {
    const game = window.__game, district = game.world.active;
    const patrols = game.traffic.vehicles.filter(vehicle => vehicle.police && vehicle.state === 'patrol' && !vehicle.rejoinTarget && vehicle.crew);
    if (!patrols.length) throw new Error('No hay patrulla con tripulación');
    const point = patrols[0].car.position.clone(), direction = patrols[0].car.position.clone();
    // Con `pair`, la patrulla que tenga otra de ronda más cerca del sitio del robo (para ver el refuerzo).
    let patrol = patrols[0], best = Infinity;
    if (pair) for (const candidate of patrols) {
      candidate.route.sample(candidate.distance + ahead, point, direction);
      for (const other of patrols) {
        if (other === candidate) continue;
        const distance = other.car.position.distanceTo(point);
        if (distance < best) { best = distance; patrol = candidate; }
      }
    }
    patrol.route.sample(patrol.distance + ahead, point, direction);
    // En el andén de al lado, no en la calzada: ahí lo atropella cualquier carro.
    const side = Math.hypot(direction.x, direction.z) || 1, nx = -direction.z / side, nz = direction.x / side;
    const tile = (x, z) => district.tileTypeAt?.(Math.round(x / 2), Math.round(z / 2));
    search: for (const offset of [4, 5, 6, 7, 8, 9]) for (const sign of [1, -1]) {
      const x = point.x + nx * offset * sign, z = point.z + nz * offset * sign;
      if (tile(x, z) === 'sidewalk' && (district.isWalkableAt?.(x, z) ?? true)) { point.x = x; point.z = z; break search; }
    }
    const ground = district.getMovementGroundHeight?.(point.x, point.z, point.y) ?? district.getGroundHeight(point.x, point.z);
    const player = game.player;
    player.position.set(point.x, ground, point.z);
    player.root.position.copy(player.position);
    player.velocity?.set(0, 0, 0);
    player.resetGrounding?.();
    // El Chato se queda lejos: no se mete entre la patrulla y el jugador.
    if (game.dog) {
      game.dog.home?.set?.(point.x + 25, ground, point.z + 25);
      game.dog.position.set(point.x + 25, ground, point.z + 25);
      game.dog._wanderTarget = null;
    }
    const dx = player.position.x - patrol.car.position.x, dz = player.position.z - patrol.car.position.z;
    game.cameraRig.yaw = Math.atan2(dx, dz);
    game.cameraRig._snap = true;
    game.steal.buscado = wanted;
    game.traffic.wantedLevel = wanted;
    const unit = patrol.crew;
    const log = window.__policia = { states: [], exitSpeeds: [], arrests: [], escapes: 0, unit, patrol };
    window.addEventListener('police-arrest', event => log.arrests.push(event.detail?.reason ?? null));
    window.addEventListener('police-escaped', () => { log.escapes++; });
    const update = game.policeFoot.update.bind(game.policeFoot);
    let last = '';
    // De ronda, un salto de más de 2 m en un cuadro es el tráfico reubicándola, no la patrulla manejando.
    const carAt = patrol.car.position.clone();
    log.maxJump = 0;
    // Quién señala, de cualquier patrulla (con fichado 3 el refuerzo puede llegar primero), y si lleva la pistola.
    log.pointing = [];
    const pointed = new Set();
    game.policeFoot.update = (dt, ctx) => {
      update(dt, ctx);
      if (patrol.state === 'patrol') log.maxJump = Math.max(log.maxJump, patrol.car.position.distanceTo(carAt));
      carAt.copy(patrol.car.position);
      for (const crew of game.policeFoot.units) for (const officer of crew.officers) {
        if (officer.poseParams.point !== 1 || pointed.has(officer)) continue;
        pointed.add(officer);
        log.pointing.push({ officer, own: crew === unit, role: officer.role, armed: officer.armed, distance: +officer.distance.toFixed(1) });
      }
      const key = `${unit.mode}/${unit.phase}/${unit.partner.state}/${unit.driver.state}`;
      if (key !== last) {
        last = key;
        log.states.push({ key, speed: +patrol.speed.toFixed(3), state: patrol.state, at: Math.round(performance.now()),
          distance: Number.isFinite(unit.partner.distance) ? +unit.partner.distance.toFixed(1) : null, car: +unit.carDistance.toFixed(1),
          seen: unit.seen, unseen: +unit.unseen.toFixed(1), health: game.stats.salud });
        if (/bajando/.test(key)) log.exitSpeeds.push(patrol.speed);
      }
    };
    return { patrol: patrol.car.position.toArray(), player: player.position.toArray() };
  }, { ahead, wanted, pair });
}

/**
 * Un robo a la vista de la patrulla: si un carro se atraviesa en la línea de vista, la persecución arranca igual. Con
 * `alone`, las demás patrullas que lo hayan visto vuelven a su ronda para que la prueba siga a una sola.
 */
async function stealInSight(page, { alone = true } = {}) {
  return page.evaluate(alone => {
    const game = window.__game, patrol = window.__policia.patrol;
    game.steal._alertPolice();
    const seen = patrol.state === 'chase';
    if (!seen) game.traffic._startChase(patrol);
    if (alone) for (const other of game.traffic.vehicles) {
      if (other.police && other !== patrol && other.state === 'chase') game.traffic._returnToPatrol(other);
    }
    return seen;
  }, alone);
}

const partnerState = () => window.__policia.unit.partner.state;

test('robo cerca de la patrulla: se acerca, frena del todo, se baja el agente, lo persigue a pie y lo arresta', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await start(page);
  await facePatrol(page);
  await aimAtDoor(page);
  await stealInSight(page);
  const dir = await stripDir(testInfo, 'bajada');
  const shots = await strip(page, dir, 'bajada', () => window.__policia.unit.partner.state === 'bajando');
  await aimAtDoor(page, false);
  expect(shots, 'fotos de la bajada').toBeGreaterThan(2);
  await expect.poll(() => page.evaluate(() => window.__policia.arrests.length), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.locator('#menu-title')).toHaveText('Te atrapó la Policía');
  const log = await page.evaluate(() => ({ ...window.__policia, unit: null, patrol: null }));
  const keys = log.states.map(state => state.key);
  expect(keys.some(key => key.includes('/frenando/')), keys.join(' > ')).toBe(true);
  expect(log.exitSpeeds.length).toBeGreaterThan(0);
  expect(Math.max(...log.exitSpeeds), 'nadie se baja de un carro andando').toBeLessThan(.05);
  expect(keys.some(key => key.includes('persecucion')), keys.join(' > ')).toBe(true);
  expect(log.arrests).toEqual(['a-pie']);
  // El arresto de siempre: al continuar, la patrulla vuelve a su ronda con los dos adentro.
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.locator('#menu')).toBeHidden();
  const after = await page.evaluate(() => {
    const { unit, patrol } = window.__policia;
    return { officers: unit.officers.map(officer => [officer.state, officer.root.visible]), state: patrol.state,
      doors: [unit.fit.doorAmount(-1), unit.fit.doorAmount(1)], pursuit: window.__game.traffic.inPursuit,
      people: window.__game.world.active.trafficPedestrians.filter(person => unit.officers.includes(person)).length };
  });
  expect(after).toEqual({ officers: [['dentro', false], ['dentro', false]], state: 'patrol', doors: [0, 0], pursuit: false, people: 0 });
  expect(errors).toEqual([]);
});

test('sin verlo: busca donde lo vio, desiste, vuelve caminando, se sube y la patrulla sigue su ronda', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await start(page);
  await facePatrol(page);
  await stealInSight(page);
  await page.waitForFunction(() => window.__policia.unit.partner.state === 'persecucion', null, { polling: 'raf', timeout: 30_000 });
  // Se le pierde: detrás de la patrulla, lejos de lo que alcanzan a ver el agente (30 m) y el carro (35 m con fichado
  // 1) pero a menos de 55 m del agente, que lo va a buscar adonde lo vio por última vez, del otro lado. Siempre en el
  // andén: en la calzada o en una cebra lo puede atropellar un carro y quedar otra vez a la vista.
  const lost = await page.evaluate(() => {
    const game = window.__game, district = game.world.active, { patrol, unit } = window.__policia;
    const car = patrol.car.position, officer = unit.partner.position, navigation = district.pedestrianNavigation;
    const fits = (x, z) => {
      const fromCar = Math.hypot(x - car.x, z - car.z), fromOfficer = Math.hypot(x - officer.x, z - officer.z);
      return fromCar > 37 && fromOfficer > 32 && fromOfficer < 46 && (navigation?.isSidewalkAt?.({ x, z }) ?? true);
    };
    const point = car.clone(), direction = car.clone();
    let spot = null;
    // Al lado de la ruta, del carril al andén.
    for (let back = 38; back <= 46 && !spot; back += 2) {
      patrol.route.sample(patrol.distance - back, point, direction);
      const length = Math.hypot(direction.x, direction.z) || 1, sideX = -direction.z / length, sideZ = direction.x / length;
      for (const side of [4, -4, 5, -5, 6, -6, 7, -7, 8, -8]) {
        const x = point.x + sideX * side, z = point.z + sideZ * side;
        if (fits(x, z)) { spot = car.clone().set(x, car.y, z); break; }
      }
    }
    // Si la ruta no da, alrededor del carro a 38–40 m, en el andén y a menos de 46 m del agente: más lejos (55 m)
    // desistirían de una, sin buscarlo.
    for (let turn = 0; turn < 96 && !spot; turn++) {
      const angle = turn / 96 * Math.PI * 2, radius = 38 + (turn % 3);
      const x = car.x + Math.cos(angle) * radius, z = car.z + Math.sin(angle) * radius;
      if (fits(x, z)) spot = car.clone().set(x, car.y, z);
    }
    if (!spot) throw new Error('No hubo escondite a 37–46 m');
    const ground = district.getMovementGroundHeight?.(spot.x, spot.z, car.y) ?? district.getGroundHeight(spot.x, spot.z);
    game.player.position.set(spot.x, ground, spot.z);
    game.player.root.position.copy(game.player.position);
    game.player.resetGrounding?.();
    return { car: Math.hypot(spot.x - car.x, spot.z - car.z), officer: Math.hypot(spot.x - officer.x, spot.z - officer.z) };
  });
  testInfo.annotations.push({ type: 'escondite', description: `a ${lost.car.toFixed(1)} m del carro y ${lost.officer.toFixed(1)} m del agente` });
  await expect.poll(() => page.evaluate(partnerState), { timeout: 30_000 }).toBe('busqueda');
  await expect.poll(() => page.evaluate(() => window.__policia.escapes), { timeout: 30_000 }).toBe(1);
  await expect(page.locator('.loot-toast', { hasText: 'Los despisté' })).toBeVisible();
  expect(await page.evaluate(() => window.__game.traffic.inPursuit), 'desistir apaga la persecución').toBe(false);
  // La cámara a la puerta, para ver cómo se sube. El jugador se queda donde se escondió, a menos de 40 m del carro: si la
  // patrulla quedara trabada volviendo a su carril, el tráfico la reubicaría de un salto a su vista (REJOIN_SEEN_RADIUS
  // y REJOIN_SEEN_TIMEOUT de TrafficSystem), y eso es lo que vigila el final de la prueba.
  await aimAtDoor(page);
  const dir = await stripDir(testInfo, 'subida');
  const shots = await strip(page, dir, 'subida', () => window.__policia.unit.partner.state === 'subiendo');
  await aimAtDoor(page, false);
  expect(shots, 'fotos de la subida').toBeGreaterThan(2);
  await expect.poll(() => page.evaluate(() => window.__policia.patrol.state), { timeout: 30_000 }).toBe('patrol');
  const log = await page.evaluate(() => {
    const { unit, patrol, states } = window.__policia;
    return { keys: states.map(state => state.key), arrests: window.__policia.arrests.length,
      officers: unit.officers.map(officer => officer.state), doors: [unit.fit.doorAmount(-1), unit.fit.doorAmount(1)],
      hold: patrol.hold, passenger: unit.fit.passengerInside };
  });
  const order = ['persecucion', 'busqueda', 'regreso', 'subiendo'];
  const seen = order.map(state => log.keys.findIndex(key => key.split('/')[2] === state));
  expect(seen.every((index, i) => index >= 0 && (i === 0 || index > seen[i - 1])), log.keys.join(' > ')).toBe(true);
  expect(log).toMatchObject({ arrests: 0, officers: ['dentro', 'dentro'], doors: [0, 0], hold: false, passenger: true });
  // La ronda sigue: la patrulla vuelve a moverse por su carril, manejando y no de un salto, con el jugador mirando.
  await expect.poll(() => page.evaluate(() => window.__policia.patrol.speed), { timeout: 30_000 }).toBeGreaterThan(.5);
  const back = await page.evaluate(() => {
    const { patrol } = window.__policia, player = window.__game.player.position;
    return { jump: window.__policia.maxJump, player: patrol.car.position.distanceTo(player) };
  });
  testInfo.annotations.push({ type: 'vuelta al carril', description: `salto máximo ${back.jump.toFixed(2)} m, jugador a ${back.player.toFixed(1)} m` });
  expect(back.jump, 'ningún salto de reubicación a la vista').toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('fichado 3: llega otra patrulla de refuerzo, comparte la vista y los agentes se bajan con la pistola, señalando', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await start(page);
  await facePatrol(page, { wanted: 3 });
  // Otra patrulla de ronda, puesta a 60–110 m del jugador (menos de los 120 m del refuerzo) en un tramo de calle sin
  // cruce ni carros encima y con vía libre en línea recta hacia él: primero detrás de esta patrulla, en su misma ruta, y
  // si no hay, en cualquier otra. Así el refuerzo llega siempre, no solo cuando el reparto lo deja cerca. (El carro que
  // persigue va derecho hacia el jugador y rodea lo que se le atraviesa, pero contra una cuadra entera se traba.)
  const reinforcement = await page.evaluate(() => {
    const game = window.__game, traffic = game.traffic, { patrol } = window.__policia, player = game.player.position;
    const other = traffic.vehicles.find(vehicle => vehicle.police && vehicle !== patrol && vehicle.state === 'patrol' && vehicle.crew);
    if (!other) throw new Error('No hay otra patrulla');
    const point = other.car.position.clone(), direction = other.car.position.clone();
    const routes = [patrol.route, ...traffic.routes.filter(route => route !== patrol.route)];
    const free = () => {
      const distance = point.distanceTo(player);
      return distance >= 60 && distance <= 110 && !traffic._nearNode(point) && !traffic._vehicleNear(point, other, traffic.vehicles)
        && !traffic._vehicleNear(point, other, traffic.parkedCars) && !traffic._vehicleNear(point, other, traffic.busVehicles);
    };
    const straight = () => {
      const dx = player.x - point.x, dz = player.z - point.z, distance = Math.hypot(dx, dz), run = distance - 25;
      other.car.position.copy(point);
      return traffic._chaseClearance(other, dx / distance, dz / distance, run) >= run - .5;
    };
    for (const route of routes) for (let back = 0; back < route.length; back += 3) {
      const distance = ((route === patrol.route ? patrol.distance : 0) - back + route.length * 2) % route.length;
      route.sample(distance, point, direction);
      if (!free() || !straight()) continue;
      traffic._releaseReservations(other);
      other.route = route;
      other.distance = other.nextDistance = distance;
      other.car.position.copy(point);
      other.car.group.rotation.y = Math.atan2(-direction.z, direction.x);
      other.rejoinTarget = null;
      other.speed = other.nextSpeed = 0;
      const index = traffic.vehicles.indexOf(other);
      // El refuerzo no lo ve por sí mismo en ningún momento (ni por distancia ni por las cuadras): lo que sabe es lo que
      // ve la primera patrulla. Así la prueba no depende de por dónde quedó.
      const crew = other.crew, look = crew._look;
      crew._look = (...args) => {
        look.apply(crew, args);
        crew.seen = crew.carSees = false;
        for (const officer of crew.officers) officer.sees = false;
      };
      // Lo que hace el refuerzo, hasta el arresto: lo que maneja, lo cerca que llega, si se bajan y su reloj de «sin verlo».
      const log = window.__refuerzo = {
        index, start: point.distanceTo(player), closest: Infinity, travel: 0, out: false, reinforcing: false,
        sharedTime: 0, clockWhileSeen: 0, seenBefore: false, last: null,
      };
      const update = game.policeFoot.update;
      game.policeFoot.update = (dt, ctx) => {
        update(dt, ctx);
        const seenBefore = log.seenBefore;
        log.seenBefore = game.policeFoot.seen;
        if (window.__policia.arrests.length) return;
        if (other.state !== 'chase') return;
        log.reinforcing ||= crew.reinforcing;
        const position = other.car.position;
        if (log.last) {
          const step = position.distanceTo(log.last);
          if (step < 3) log.travel += step;
          log.last.copy(position);
        } else log.last = position.clone();
        log.closest = Math.min(log.closest, position.distanceTo(game.player.position));
        log.out ||= crew.anyoneOut;
        // Mientras maneja, su reloj de «sin verlo» es el de toda la persecución (lo pone el tráfico antes de esta vuelta):
        // si la primera patrulla lo tenía a la vista en el cuadro anterior, va en cero más un subpaso. Parado no lo usa nadie.
        if (seenBefore && (crew.phase === 'carro' || crew.phase === 'cierre')) {
          log.sharedTime += dt;
          log.clockWhileSeen = Math.max(log.clockWhileSeen, other.chaseTime ?? 0);
        }
      };
      return { index, distance: log.start };
    }
    throw new Error('No hubo tramo libre a 60–110 m del jugador');
  });
  testInfo.annotations.push({ type: 'refuerzo', description: `puesto a ${reinforcement.distance.toFixed(0)} m del jugador` });
  await stealInSight(page);
  await page.waitForFunction(() => window.__policia.unit.mode === 'persigue', null, { polling: 'raf', timeout: 10_000 });
  const state = await page.evaluate(index => {
    const game = window.__game, unit = window.__policia.unit, other = game.traffic.vehicles[index];
    return { armed: unit.officers.map(officer => officer.armed), other: { state: other.state, reinforcing: other.crew.reinforcing } };
  }, reinforcement.index);
  expect(state.armed, 'los dos sacan la pistola').toEqual([true, true]);
  expect(state.other, `refuerzo a ${reinforcement.distance.toFixed(0)} m`).toEqual({ state: 'chase', reinforcing: true });
  // Apunta pero no dispara: lo que sigue es el arresto de siempre.
  await expect.poll(() => page.evaluate(() => window.__policia.arrests), { timeout: 60_000 }).toEqual(['a-pie']);
  expect(await page.evaluate(() => window.__game.stats.salud)).toBeGreaterThan(0);
  // El refuerzo vino manejando hacia él (cuánto acorta en línea recta depende de las cuadras y de lo que se le atraviese:
  // el arresto llega a los pocos segundos). Y la vista es una sola: mientras la primera patrulla lo tenía a la vista, el
  // reloj de «perdido» del refuerzo no corrió aunque él no lo viera (con PR #84 desistiría a los 6 s de no verlo él mismo).
  // Si nadie lo ve, ese reloj sí corre, como debe.
  const came = await page.evaluate(() => window.__refuerzo);
  testInfo.annotations.push({ type: 'refuerzo llegó', description: `de ${came.start.toFixed(0)} a ${came.closest.toFixed(0)} m manejando ${came.travel.toFixed(0)} m; se bajaron: ${came.out}; ${came.sharedTime.toFixed(1)} s con la primera viéndolo y su reloj hasta ${came.clockWhileSeen.toFixed(2)} s` });
  expect(came.reinforcing).toBe(true);
  expect(came.travel, 'el refuerzo vino manejando').toBeGreaterThan(10);
  expect(came.closest, 'y se acercó').toBeLessThan(came.start - 3);
  expect(came.sharedTime, 'la primera patrulla lo tuvo a la vista mientras el refuerzo manejaba').toBeGreaterThan(.5);
  expect(came.clockWhileSeen, 'la vista es una sola para toda la persecución').toBeLessThan(.2);
  // Antes de agarrarlo, quien llegó lo señaló con la izquierda y la pistola en la derecha (el arresto pide tenerlo a la
  // vista y a 1,2 m, y armado señala desde 8 m). Puede ser el de esta patrulla o el del refuerzo.
  const pointing = await page.evaluate(() => window.__policia.pointing.map(({ officer, ...entry }) => {
    let pistol = false;
    officer.root.traverse(object => { if (object.name === 'weapon-pistola') pistol = true; });
    return { ...entry, pistol };
  }));
  expect(pointing.length, 'alguien lo señaló antes del arresto').toBeGreaterThan(0);
  for (const entry of pointing) expect(entry, 'señala armado, con la pistola en la mano').toMatchObject({ armed: true, pistol: true });
  testInfo.annotations.push({ type: 'señaló', description: pointing.map(entry => `${entry.own ? 'esta patrulla' : 'refuerzo'}: ${entry.role} a ${entry.distance} m`).join('; ') });
  expect(errors).toEqual([]);
});

test('a media persecución a pie no se duerme; ya desistidos, dormir no deja a nadie afuera, cierra puertas, apaga la sirena y así se guarda', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await start(page);
  await facePatrol(page, { wanted: 2 });
  await stealInSight(page);
  await expect.poll(() => page.evaluate(partnerState), { timeout: 30_000 }).toBe('persecucion');
  // Con el cambuche armado, el menú no deja dormir con la tomba encima: el botón apagado y la nota dice por qué.
  await page.evaluate(() => { window.__game.built.base = true; window.dispatchEvent(new CustomEvent('open-cambuche')); });
  await expect(page.getByRole('button', { name: /^(Dormir hasta|Echar una siesta)/ })).toBeDisabled();
  await expect(page.locator('.menu__money', { hasText: 'Con la tomba encima no puedo dormir.' })).toBeVisible();
  await page.evaluate(() => window.__game.menu.close());
  // Y el juego tampoco, lo pida quien lo pida: avisa y la persecución sigue.
  const refused = await page.evaluate(() => {
    const game = window.__game, fails = [];
    window.addEventListener('sleep-fail', event => fails.push(event.detail?.reason), { once: true });
    game.sleep();
    return { fails, sleeping: game.isSleeping, pursuit: game.traffic.inPursuit, out: game.policeFoot.active };
  });
  expect(refused).toEqual({ fails: ['persecucion'], sleeping: false, pursuit: true, out: true });
  await expect(page.locator('.loot-toast', { hasText: 'Con la tomba encima no puedo dormir' })).toBeVisible();
  // Desisten: el aviso de que se les perdió sale y ellos todavía van afuera, cogiendo aire antes de volver al carro.
  await page.evaluate(() => { for (const unit of window.__game.policeFoot.units) unit._desist('perdido'); });
  await expect.poll(() => page.evaluate(() => window.__policia.escapes), { timeout: 10_000 }).toBe(1);
  const before = await page.evaluate(() => {
    const game = window.__game;
    // `_save` se llama al dormirse: se mira qué quedó guardado de la persecución.
    const save = game.save.save.bind(game.save);
    game.save.save = data => { window.__guardado = { pursuit: game.traffic.inPursuit, out: game.policeFoot.active }; return save(data); };
    const out = game.policeFoot.active, pursuit = game.traffic.inPursuit;
    game.sleep();
    return { out, pursuit, sleeping: game.isSleeping };
  });
  expect(before, 'dormido con los agentes todavía afuera, ya sin persecución').toEqual({ out: true, pursuit: false, sleeping: true });
  await expect.poll(() => page.evaluate(() => window.__game.isSleeping), { timeout: 15_000 }).toBe(false);
  // Despierto, unos cuadros del bucle real.
  await page.evaluate(() => new Promise(resolve => { let n = 30; const next = () => --n <= 0 ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next); }));
  const after = await page.evaluate(() => {
    const game = window.__game, units = game.policeFoot.units;
    const police = game.traffic.vehicles.filter(vehicle => vehicle.police);
    return {
      saved: window.__guardado,
      orphans: units.flatMap(unit => unit.officers).filter(officer => officer.out || officer.root.visible).length,
      people: game.world.active.trafficPedestrians.filter(person => game.policeFoot.officers.includes(person)).length,
      doors: units.flatMap(unit => [unit.fit.doorAmount(-1), unit.fit.doorAmount(1)]).filter(amount => amount > 0).length,
      patrols: police.filter(vehicle => vehicle.state !== 'patrol').length,
      modes: units.filter(unit => unit.mode !== 'ronda').length,
      siren: police.filter(vehicle => vehicle.car.pursuit).length,
      pursuit: game.traffic.inPursuit,
      arrests: window.__policia.arrests.length,
      escapes: window.__policia.escapes
    };
  });
  expect(after).toEqual({ saved: { pursuit: false, out: false }, orphans: 0, people: 0, doors: 0, patrols: 0, modes: 0, siren: 0,
    pursuit: false, arrests: 0, escapes: 1 });
  expect(errors).toEqual([]);
});
