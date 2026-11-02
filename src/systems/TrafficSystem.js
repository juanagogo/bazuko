import * as THREE from 'three';
import { Car } from '../entities/Car.js';
import { signalState } from '../world/bogota/TrafficSignals.js';
import {
  PLAYER_RADIUS,
  POLICE_SIGHT_RANGE,
  POLICE_CLOSE_RANGE,
  POLICE_CHASE_SPEED,
  POLICE_CATCH_RANGE,
  POLICE_GIVE_UP_RANGE,
  POLICE_CHASE_TIMEOUT,
} from '../utils/constants.js';
import { SpatialGrid } from '../core/SpatialGrid.js';
import { canReachCombatTarget, hasClearCombatLine } from './CombatGeometry.js';

/** Cada nivel de «te tienen fichado» alarga en esta fracción el alcance con que una patrulla ve un robo. */
export const POLICE_SIGHT_PER_WANTED = .25;

const GAP = 1.8;
const ACCELERATION = 1.8;
const BRAKING = 2;
const CHASE_ACCELERATION = 3.2;
const PROBE_STEP = 0.5;
const ROUTE_SAMPLE_STEP = 2;
const CHASE_HEIGHT_TOLERANCE = .85;
const CHASE_PROBE_STEP = .25;
const CHASE_STEERING = [0, .45, -.45, .9, -.9, 1.35, -1.35, Math.PI / 2, -Math.PI / 2];
const REJOIN_TIMEOUT = 6;
const REJOIN_NODE_MARGIN = 4;
const REJOIN_CLEAR_RADIUS = 9;
const REJOIN_PERSON_RADIUS = 4;
// A la vista del jugador el salto se nota: aguanta más, sin quedarse trancando la vía para siempre.
const REJOIN_SEEN_RADIUS = 40;
const REJOIN_SEEN_TIMEOUT = 30;

function emit(type, detail) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      const event = typeof CustomEvent !== 'undefined' ? new CustomEvent(type, { detail }) : { type, detail };
      window.dispatchEvent(event);
    } catch {}
  }
}

function emitHonk(x, z) { emit('car-honk', { x, z }); }

// Los stops acompañan la desaceleración real o la espera; acelerar despacio no es frenar.
function brakeEngaged(before, after, dt) {
  return after < before - .08 * dt || (after <= .05 && after <= before + 1e-8);
}

export class TrafficSystem {
  constructor(scene, routes, { carsPerRoute = 4, policeCount = 0, random = Math.random } = {}) {
    this.vehicles = [];
    this.wantedLevel = 0; // lo mantiene StealSystem: el nivel de «te tienen fichado»
    this._pursuitInfo = { distance: 0, dx: 0, dz: 0, closeness: 0, x: 0, z: 0 };
    this.random = random;
    this.routes = routes.alternatives ?? routes;
    this._arrestDispatched = false;
    this._position = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._probePosition = new THREE.Vector3();
    this._probeDirection = new THREE.Vector3();
    this._signalDirection = new THREE.Vector3();
    this._visualDirection = new THREE.Vector3();
    this._visualPosition = new THREE.Vector3();
    this._time = 0;
    this._nearbyPedestrians = [];
    this._nearbyCars = [];
    this._carGrid = new SpatialGrid();
    this._personGrid = new SpatialGrid();
    this._carCandidates = [];
    this._personCandidates = [];
    this._routeVehicles = new Map();
    this._chaseColliders = [];
    this._chaseBox = new THREE.Box3();
    for (const route of routes) {
      // Evita una población inicial mayor que el espacio disponible en el circuito.
      const count = Math.min(carsPerRoute, Math.floor(route.length / 12));
      for (let i = 0; i < count; i++) {
        const distance = (i + 0.4) * route.length / count;
        this._spawn(scene, route, distance, false);
      }
    }
    // Las patrullas circulan como el resto del tráfico hasta que ven un robo.
    const spawnRoutes = [...routes];
    for (let i = 0; spawnRoutes.length && i < policeCount; i++) {
      const route = spawnRoutes[Math.floor(random() * spawnRoutes.length)];
      this._spawn(scene, route, random() * route.length, true);
    }
  }

  _spawn(scene, route, distance, police) {
    const random = this.random;
    route.sample(distance, this._position, this._direction);
    // La flota sale por conteo y no gasta azar: una de cada doce es buseta, tres de cada diez taxi. Con huellas
    // distintas por modelo, el mismo azar da así siempre el mismo tráfico.
    const count = this._spawnCount = (this._spawnCount ?? 0) + 1;
    const buseta = !police && count % 12 === 0;
    const kind = police ? 'police' : buseta ? 'buseta' : count * 7 % 10 < 3 ? 'taxi' : 'carro';
    const car = new Car(scene, this._position, Math.atan2(-this._direction.z, this._direction.x),
      { traffic: true, kind, variant: count * 37 });
    const cruiseSpeed = (10 + random() * 4) * (buseta ? .8 : 1);
    this.vehicles.push({ car, route, distance, speed: 0, cruiseSpeed, patrolSpeed: cruiseSpeed, nextDistance: distance, nextSpeed: 0,
      acceleration: 0, accelerationLimit: 1.8 + random() * .7, braking: 2.2 + random() * .6,
      reactionTime: .18 + random() * .35, resumeDelay: 0, stopped: false,
      routeTimer: 3 + random() * 5, recentRoutes: [route.key], routeChanges: 0,
      lastHonkTime: 0, police, state: 'patrol', chaseTime: 0 });
  }

  /** Metros a los que una patrulla alcanza a ver un robo: cada nivel de fichado los alarga. */
  get sightRange() {
    return POLICE_SIGHT_RANGE * (1 + POLICE_SIGHT_PER_WANTED * this.wantedLevel);
  }

  _canWitness(vehicle, playerPosition) {
    if (Math.abs((playerPosition.y ?? 0) - vehicle.car.position.y) > CHASE_HEIGHT_TOLERANCE) return false;
    if (!hasClearCombatLine({ from: vehicle.car.position, to: playerPosition,
      collisions: this.environment?.collisions, ignoreVehicle: vehicle.car })) return false;
    const dx = playerPosition.x - vehicle.car.position.x;
    const dz = playerPosition.z - vehicle.car.position.z;
    const distSq = dx * dx + dz * dz;
    const sight = this.sightRange;
    if (distSq > sight * sight) return false;
    const dist = Math.sqrt(distSq);
    if (dist <= POLICE_CLOSE_RANGE) return true;
    const yaw = vehicle.car.group.rotation.y;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    return (fx * dx + fz * dz) / dist > 0.2;
  }

  /** ¿Alguna patrulla tiene al jugador a la vista (cerca o de frente)? */
  witnessesTheft(playerPosition) {
    if (!playerPosition) return false;
    return this.vehicles.some(vehicle => vehicle.police && vehicle.state === 'patrol' && this._canWitness(vehicle, playerPosition));
  }

  /** Pasa a persecución a las patrullas que ven el robo. */
  alertForTheft(playerPosition) {
    if (!playerPosition) return false;
    let alerted = false;
    for (const vehicle of this.vehicles) {
      if (!vehicle.police || vehicle.state !== 'patrol' || !this._canWitness(vehicle, playerPosition)) continue;
      this._startChase(vehicle);
      alerted = true;
    }
    return alerted;
  }

  _startChase(vehicle) {
    vehicle.state = 'chase';
    vehicle.chaseTime = 0;
    vehicle.cruiseSpeed = POLICE_CHASE_SPEED;
    vehicle.impactStop = false;
    vehicle.car.pursuit = true;
    vehicle._chaseSteerTime = 0;
    vehicle.rejoinTarget = null;
  }

  /** Consultas del distrito activo: la cota conserva la planta de calle o del viaducto. */
  setEnvironment({ collisions = null, getGroundHeight = null, getWaterInfo = null } = {}) {
    this.environment = { collisions, getGroundHeight, getWaterInfo };
  }

  /** Tras una captura o al escapar, todas las patrullas vuelven a rondar. */
  endPursuit() {
    this._arrestDispatched = false;
    for (const vehicle of this.vehicles) {
      if (vehicle.police && vehicle.state !== 'patrol') this._returnToPatrol(vehicle);
    }
  }

  get inPursuit() {
    return this.vehicles.some(vehicle => vehicle.police && vehicle.state === 'chase');
  }

  /**
   * La patrulla en persecución más cercana, o null. `dx` y `dz` van de la patrulla hacia el jugador; `closeness` va
   * de 0 (a la distancia en que desiste) a 1 (a la distancia en que arresta): el arresto ocurre por distancia, no por
   * tiempo. Se llama cada cuadro desde la interfaz y devuelve siempre el mismo objeto.
   */
  get pursuitInfo() {
    let nearest = null, distance = Infinity;
    for (const vehicle of this.vehicles) {
      if (!vehicle.police || vehicle.state !== 'chase') continue;
      const d = vehicle._chaseDist ?? POLICE_GIVE_UP_RANGE;
      if (d < distance) { distance = d; nearest = vehicle; }
    }
    if (!nearest) return null;
    const info = this._pursuitInfo;
    info.distance = distance;
    info.dx = nearest._chaseDx ?? 0;
    info.dz = nearest._chaseDz ?? 0;
    info.closeness = Math.max(0, Math.min(1, (POLICE_GIVE_UP_RANGE - distance) / (POLICE_GIVE_UP_RANGE - POLICE_CATCH_RANGE)));
    info.x = nearest.car.position.x;
    info.z = nearest.car.position.z;
    return info;
  }

  _returnToPatrol(vehicle) {
    vehicle.state = 'patrol';
    vehicle.chaseTime = 0;
    vehicle.speed = vehicle.nextSpeed = vehicle.acceleration = 0;
    vehicle.cruiseSpeed = vehicle.patrolSpeed;
    vehicle.stopped = false;
    vehicle.resumeDelay = vehicle.reactionTime;
    vehicle.car.pursuit = false;
    vehicle._chaseSteerTime = 0;
    this._snapToNearestRoute(vehicle);
  }

  _snapToNearestRoute(vehicle) {
    if (!this.routes.length) return;
    let bestRoute = this.routes[0], bestDistance = 0, bestScore = Infinity;
    for (const route of this.routes) {
      for (let d = 0; d < route.length; d += ROUTE_SAMPLE_STEP) {
        route.sample(d, this._probePosition, this._probeDirection);
        const dx = this._probePosition.x - vehicle.car.position.x;
        const dz = this._probePosition.z - vehicle.car.position.z;
        const dy = this._probePosition.y - vehicle.car.position.y;
        const score = dx * dx + dz * dz + dy * dy * 25;
        if (score < bestScore) { bestScore = score; bestRoute = route; bestDistance = d; }
      }
    }
    // No volver dentro de un cruce: ahí entra sin reserva y sobre la trayectoria de otro.
    for (let tries = 0; tries < 30; tries++) {
      bestRoute.sample(bestDistance, this._probePosition, this._probeDirection);
      if (!this._nearNode(this._probePosition)) break;
      bestDistance = (bestDistance + 3) % bestRoute.length;
    }
    vehicle.route = bestRoute;
    vehicle.distance = vehicle.nextDistance = bestDistance;
    vehicle.recentRoutes = [bestRoute.key];
    bestRoute.sample(bestDistance, this._position, this._direction);
    if (this.environment && vehicle.car.position.distanceTo(this._position) > .2) {
      // Regresar al carril también es movimiento físico; no saltar una manzana ni cambiar de planta.
      vehicle.rejoinTarget = this._position.clone();
      vehicle._rejoinStuck = 0;
      return;
    }
    vehicle.rejoinTarget = null;
    vehicle.car.position.copy(this._position);
    vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
  }

  _nearNode(point) {
    const nodes = this.signals?.nodes;
    if (!nodes) return false;
    for (const node of nodes) {
      if (point.x >= node.x0 - REJOIN_NODE_MARGIN && point.x <= node.x1 + REJOIN_NODE_MARGIN &&
        point.z >= node.z0 - REJOIN_NODE_MARGIN && point.z <= node.z1 + REJOIN_NODE_MARGIN) return true;
    }
    return false;
  }

  _vehicleNear(point, vehicle, list) {
    if (!list) return false;
    for (const other of list) {
      if (other !== vehicle && other.car.position.distanceToSquared(point) < REJOIN_CLEAR_RADIUS ** 2) return true;
    }
    return false;
  }

  _playerWithin(point, radius) {
    const player = this._playerPosition;
    if (!player) return false;
    return (player.x - point.x) ** 2 + (player.z - point.z) ** 2 < radius ** 2;
  }

  _personNear(point) {
    if (this._playerWithin(point, REJOIN_PERSON_RADIUS)) return true;
    if (!this._personGrid) return false;
    const r = REJOIN_PERSON_RADIUS;
    this._personGrid.query(point.x - r, point.z - r, point.x + r, point.z + r, this._personCandidates);
    return this._personCandidates.some(({ position }) => (position.x - point.x) ** 2 + (position.z - point.z) ** 2 < r * r);
  }

  /** Con un bus parado al lado no aguanta los 30 s: el bus no sale de ahí mientras la patrulla siga contra su costado. */
  _blocksBus(vehicle) {
    const { position } = vehicle.car;
    return (this.busVehicles ?? []).some(({ car }) => car.speed < .1 && Math.abs(car.position.y - position.y) < 3 &&
      Math.hypot(car.position.x - position.x, car.position.z - position.z) < car.length / 2 + 6);
  }

  /**
   * Tope del regreso a ojo: si lleva rato sin avanzar (un poste, o un carro que justo espera a que él se quite), entra
   * a su carril en el primer punto libre, sin cruce, vehículos ni personas cerca. A la vista del jugador espera más y
   * busca un punto lejos de él. Si no lo hay en toda la ruta, sigue esperando.
   */
  _forceRejoin(vehicle) {
    const overdue = vehicle._rejoinStuck > REJOIN_SEEN_TIMEOUT || this._blocksBus(vehicle);
    if (!overdue && this._playerWithin(vehicle.car.position, REJOIN_SEEN_RADIUS)) return false;
    const { route } = vehicle, point = this._position;
    let distance = vehicle.distance;
    for (let walked = 0; walked < route.length; walked += 3, distance = (distance + 3) % route.length) {
      route.sample(distance, point, this._direction);
      if ((!overdue && this._playerWithin(point, REJOIN_SEEN_RADIUS)) || this._nearNode(point) || this._personNear(point) ||
        this._vehicleNear(point, vehicle, this.vehicles) || this._vehicleNear(point, vehicle, this.parkedCars) ||
        this._vehicleNear(point, vehicle, this.busVehicles)) continue;
      vehicle.distance = vehicle.nextDistance = distance;
      vehicle.car.position.copy(point);
      vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
      vehicle.rejoinTarget = null;
      vehicle.speed = vehicle.nextSpeed = 0;
      return true;
    }
    vehicle._rejoinStuck = 0;
    return false;
  }

  /** Muestreo exclusivamente visual: no escribe el rumbo físico ni la planificación del tráfico. */
  _animateRoute(vehicle, distance, dt, previousSpeed) {
    const { car, route, speed } = vehicle;
    const context = vehicle._driveContext ??= {};
    const yaw = car.group.rotation.y;
    route.sample(vehicle.distance + .65, this._visualPosition, this._visualDirection);
    const heading = Math.atan2(-this._visualDirection.z, this._visualDirection.x);
    const curve = Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw)) / .65;
    context.steering = Math.atan(curve * (car.vehicle.wheelbase ?? car.length * .58));
    route.sample(vehicle.distance + Math.max(6, speed * 1.3), this._visualPosition, this._visualDirection);
    const ahead = Math.atan2(-this._visualDirection.z, this._visualDirection.x);
    const turn = Math.atan2(Math.sin(ahead - yaw), Math.cos(ahead - yaw));
    context.turnSignal = Math.abs(turn) > .12 ? (turn > 0 ? 'left' : 'right')
      : Math.abs(context.steering) > .08 ? (context.steering > 0 ? 'left' : 'right') : null;
    context.dt = dt;
    context.speed = speed;
    context.acceleration = (speed - previousSpeed) / dt;
    car.animateDrive(distance, brakeEngaged(previousSpeed, speed, dt), context);
  }

  _personInCar(position, car) {
    const dx = position.x - this._probePosition.x, dz = position.z - this._probePosition.z;
    const forward = dx * this._probeDirection.x + dz * this._probeDirection.z;
    const sideways = dx * -this._probeDirection.z + dz * this._probeDirection.x;
    // Incluye el radio del peatón y un margen de frenado alrededor de la carrocería.
    return Math.abs(forward) < car.length / 2 + 0.8 && Math.abs(sideways) < car.width / 2 + 0.55;
  }

  _personAtNose(position, car) {
    const dx = position.x - car.position.x, dz = position.z - car.position.z;
    const hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
    const forward = dx * hx + dz * hz, sideways = -dx * hz + dz * hx;
    return forward > car.length / 2 - .75 && forward < car.length / 2 + 2.5 &&
      Math.abs(sideways) < car.width / 2 + .55;
  }

  setBus(bus) {
    this.busVehicles = [bus].flat().filter(Boolean).map(vehicle => ({ car: vehicle,
      get heading() { return vehicle.heading ?? { x: 0, z: -1 }; } }));
    this.busVehicle = this.busVehicles[0] ?? null;
  }

  setParkedCars(cars) { this.parkedCars = cars.map(car => ({ car })); }

  /**
   * Detiene un carro en su carril de forma gradual (p. ej. el conductor se baja) o lo libera.
   * @returns {object|null} el vehículo de tráfico
   */
  hold(car, held = true) {
    const vehicle = this.vehicles.find(v => v.car === car) ?? null;
    if (vehicle) vehicle.hold = held;
    return vehicle;
  }

  _chooseRoute(vehicle) {
    if (vehicle.crossingNode) return false;
    if (this.routes.length < 2) return false;
    const position = this._position, direction = this._direction;
    vehicle.route.sample(vehicle.distance, position, direction);
    if (Math.min(Math.abs(direction.x), Math.abs(direction.z)) > 1e-6) return false;
    const options = [];
    const margin = vehicle.car.length / 2 + 1;
    for (const route of this.routes) {
      if (route === vehicle.route || route.key === vehicle.route.key || vehicle.recentRoutes.includes(route.key)) continue;
      let start = 0;
      for (const segment of route.segments) {
        if (!segment.radius && Math.abs(segment.dx - direction.x) < 1e-6 && Math.abs(segment.dz - direction.z) < 1e-6) {
          const dx = position.x - segment.x, dz = position.z - segment.z;
          const along = dx * segment.dx + dz * segment.dz;
          const across = dx * -segment.dz + dz * segment.dx;
          if (Math.abs(across) < 1e-5 && along > margin && along < segment.length - margin) options.push({ route, distance: start + along });
        }
        start += segment.length;
      }
    }
    if (!options.length) return false;
    const selected = options[Math.min(options.length - 1, Math.floor(this.random() * options.length))];
    vehicle.route = selected.route;
    vehicle.distance = selected.distance;
    vehicle.recentRoutes.push(selected.route.key);
    if (vehicle.recentRoutes.length > 3) vehicle.recentRoutes.shift();
    vehicle.routeChanges++;
    return true;
  }

  _carInPath(other, car) {
    if (Math.abs(other.car.position.y - car.position.y) > 3) return false;
    // Quien viene detrás no estorba, tampoco en una curva, donde ya no van paralelos: avanzar solo aleja de él.
    // Sin esto, el que dobla y el que lo sigue se esperan mutuamente sin límite.
    const yaw = car.group.rotation.y;
    if ((other.car.position.x - car.position.x) * Math.cos(yaw) - (other.car.position.z - car.position.z) * Math.sin(yaw) <= 0) return false;
    const dx = other.car.position.x - this._probePosition.x, dz = other.car.position.z - this._probePosition.z;
    const headingX = other.heading?.x ?? Math.cos(other.car.group.rotation.y);
    const headingZ = other.heading?.z ?? -Math.sin(other.car.group.rotation.y);
    const along = Math.abs(headingX * this._probeDirection.x + headingZ * this._probeDirection.z);
    const across = Math.abs(headingX * -this._probeDirection.z + headingZ * this._probeDirection.x);
    const front = dx * this._probeDirection.x + dz * this._probeDirection.z;
    const side = dx * -this._probeDirection.z + dz * this._probeDirection.x;
    const headingDot = headingX * this._probeDirection.x + headingZ * this._probeDirection.z;
    // Un seguidor en el mismo carril no debe bloquear al carro que lleva delante.
    if (headingDot > .9 && front <= 0) return false;
    const margin = along > .9 ? GAP : .35;
    if (Math.abs(front) >= car.length / 2 + along * other.car.length / 2 + across * other.car.width / 2 + margin ||
      Math.abs(side) >= car.width / 2 + across * other.car.length / 2 + along * other.car.width / 2 + .15) return false;
    // Cruzados en ángulo, proyectar solo sobre los ejes propios agranda al otro: una buseta en el carril
    // contrario frenaría a quien termina de doblar. También se separan por los ejes del otro.
    const otherFront = dx * headingX + dz * headingZ, otherSide = -dx * headingZ + dz * headingX;
    return Math.abs(otherFront) < other.car.length / 2 + along * car.length / 2 + across * car.width / 2 + margin &&
      Math.abs(otherSide) < other.car.width / 2 + across * car.length / 2 + along * car.width / 2 + .15;
  }

  _overlapsNode(car, node, heading = null) {
    const c = Math.abs(heading?.x ?? Math.cos(car.group.rotation.y)), s = Math.abs(heading?.z ?? Math.sin(car.group.rotation.y));
    const x = c * car.length / 2 + s * car.width / 2;
    const z = s * car.length / 2 + c * car.width / 2;
    return car.position.x + x > node.x0 && car.position.x - x < node.x1 &&
      car.position.z + z > node.z0 && car.position.z - z < node.z1;
  }

  _coordinateIntersections() {
    if (!this.signals?.reservations) return;
    for (const vehicle of this.vehicles) vehicle.crossingNode = null;
    for (const node of this.signals.nodes) {
      let state = this.signals.reservations.get(node);
      if (!state) {
        state = { owners: new Map(), plans: new Map(), queue: [] };
        this.signals.reservations.set(node, state);
      }
      const candidates = [];
      for (const vehicle of this.vehicles) {
        if (vehicle.state === 'chase' || vehicle.rejoinTarget) continue;
        if (this._overlapsNode(vehicle.car, node)) { candidates.push(vehicle); continue; }
        // Fuera de este radio no puede solicitar el cruce en los próximos metros.
        const dx = Math.max(node.x0 - vehicle.car.position.x, 0, vehicle.car.position.x - node.x1);
        const dz = Math.max(node.z0 - vehicle.car.position.z, 0, vehicle.car.position.z - node.z1);
        if (dx * dx + dz * dz > 18 * 18) continue;
        for (let ahead = 1; ahead <= 18; ahead += 1) {
          vehicle.route.sample(vehicle.distance + ahead, this._probePosition, this._probeDirection);
          if (this._probePosition.x >= node.x0 && this._probePosition.x <= node.x1 && this._probePosition.z >= node.z0 && this._probePosition.z <= node.z1) {
            candidates.push(vehicle); break;
          }
        }
      }
      state.queue = state.queue.filter(vehicle => candidates.includes(vehicle));
      for (const vehicle of candidates) if (!state.queue.includes(vehicle)) state.queue.push(vehicle);
      // La patrulla que vuelve entra de última a la cola, pero puede quedar adelante en el carril: el de atrás tendría
      // la reserva sin poder usarla y quien la necesita esperaría para siempre. En un carril, primero el de adelante.
      for (let i = 0; i < state.queue.length; i++) for (let j = i + 1; j < state.queue.length; j++) {
        const a = state.queue[i], b = state.queue[j];
        if (this._aheadInLane(a, b)) { state.queue[i] = b; state.queue[j] = a; }
      }
      for (const [vehicle, claim] of state.owners) {
        const overlaps = this._overlapsNode(vehicle.car, node);
        claim.entered ||= overlaps;
        if ((claim.entered && !overlaps) || (!claim.entered &&
          (signalState(this.signals.time, claim.plan.axis) !== 0 || !candidates.includes(vehicle)))) state.owners.delete(vehicle);
        else if (claim.entered) claim.from = this._planProgress(vehicle.car, claim.plan);
      }
      for (const vehicle of state.plans.keys()) if (!candidates.includes(vehicle) && !state.owners.has(vehicle)) state.plans.delete(vehicle);
      for (const vehicle of candidates) if (!state.plans.has(vehicle)) state.plans.set(vehicle, this._crossingPlan(vehicle, node));
      const busInside = this.busVehicle?.car.group.visible && this.busVehicle.car.position.y < 3 && this._overlapsNode(this.busVehicle.car, node, this.busVehicle.heading);
      const bus = this.busVehicle?.car;
      const busCrossingX = bus?.pathX?.(node.z1, bus.laneX) ?? bus?.position.x;
      const busApproaching = bus?.group.visible && bus.position.y < 3 && bus.position.z > node.z1 &&
        bus.position.z < node.z1 + bus.length / 2 + 15 && busCrossingX >= node.x0 && busCrossingX <= node.x1;
      const busClaims = busInside || (busApproaching && signalState(this.signals.time, 1) === 0);
      if (bus && !state.busPlan) {
        state.busPlan = { width: bus.width, points: [], axis: 1 };
        for (let z = node.z1 + bus.length / 2; z >= node.z0 - bus.length / 2; z -= .75) state.busPlan.points.push({ x: bus.pathX?.(z, bus.laneX) ?? bus.position.x, z });
      }
      if (busClaims) for (const [vehicle, claim] of state.owners) {
        if (!claim.entered && this._pathsConflict(claim.plan, state.busPlan)) state.owners.delete(vehicle);
      }
      // Los que ya cruzan despejan primero. La cola solo da prioridad entre
      // trayectorias que se cortan: sentidos opuestos y convoyes pueden avanzar juntos.
      const waiting = [];
      const ordered = [...state.queue].sort((a, b) => Number(this._overlapsNode(b.car, node)) - Number(this._overlapsNode(a.car, node)));
      for (const vehicle of ordered) {
        if (state.owners.has(vehicle)) continue;
        const plan = state.plans.get(vehicle), entered = this._overlapsNode(vehicle.car, node);
        if (!entered && signalState(this.signals.time, plan.axis) !== 0) continue;
        const blocked = (busClaims && this._pathsConflict(plan, state.busPlan)) ||
          [...state.owners.values()].some(claim => this._claimConflict(plan, claim)) ||
          waiting.some(earlier => this._pathsConflict(plan, earlier));
        if (blocked && !entered) waiting.push(plan);
        else state.owners.set(vehicle, { entered, plan });
      }
      state.busBlocked = !!state.busPlan && [...state.owners.values()].some(claim => this._pathsConflict(claim.plan, state.busPlan));
      for (const vehicle of state.queue) vehicle.crossingNode ??= node;
    }
  }

  /** ¿`b` va delante de `a` en su carril? Dos rutas distintas pueden compartir el mismo tramo. */
  _aheadInLane(a, b) {
    if (a.route === b.route) return (b.distance - a.distance + a.route.length) % a.route.length < 40;
    const yaw = a.car.group.rotation.y;
    if (Math.cos(yaw - b.car.group.rotation.y) < .9) return false;
    const hx = Math.cos(yaw), hz = -Math.sin(yaw);
    const dx = b.car.position.x - a.car.position.x, dz = b.car.position.z - a.car.position.z;
    const ahead = dx * hx + dz * hz;
    return ahead > 0 && ahead < 40 && Math.abs(dz * hx - dx * hz) < 1;
  }

  _crossingPlan(vehicle, node) {
    const { route, distance, car } = vehicle;
    const pad = Math.hypot(car.length, car.width) / 2 + .4;
    const inside = point => point.x >= node.x0 - pad && point.x <= node.x1 + pad && point.z >= node.z0 - pad && point.z <= node.z1 + pad;
    let entry = 0;
    for (; entry < 30; entry += .75) {
      route.sample(distance + entry, this._probePosition, this._probeDirection);
      if (inside(this._probePosition)) break;
    }
    for (; entry > -30; entry -= .75) {
      route.sample(distance + entry - .75, this._probePosition, this._probeDirection);
      if (!inside(this._probePosition)) break;
    }
    // Dos cruces del desvío se montan sobre la carrera vecina. Lo que cae en el más angosto lo arbitra ese:
    // si no, quien espera el rojo de la carrera le quita el verde del cruce ancho a los que pasan por ella.
    const span = other => other.x1 - other.x0;
    const narrower = this.signals.nodes.filter(other => other !== node && span(other) < span(node) &&
      other.x0 < node.x1 && other.x1 > node.x0 && other.z0 < node.z1 && other.z1 > node.z0);
    const delegated = point => narrower.some(other => point.x >= other.x0 - pad && point.x <= other.x1 + pad && point.z >= other.z0 - pad && point.z <= other.z1 + pad);
    const plan = { points: [], width: car.width, axis: 0, compatible: new WeakMap() };
    for (let ahead = entry; ahead < entry + 100; ahead += .75) {
      route.sample(distance + ahead, this._probePosition, this._probeDirection);
      if (!inside(this._probePosition)) break;
      if (plan.hx === undefined) {
        plan.hx = this._probeDirection.x; plan.hz = this._probeDirection.z;
        plan.axis = Math.abs(plan.hx) >= Math.abs(plan.hz) ? 0 : 1;
      }
      if (!delegated(this._probePosition)) plan.points.push({ x: this._probePosition.x, z: this._probePosition.z });
    }
    return plan;
  }

  /** Primer punto de la trayectoria que el carro todavía no ha dejado atrás con la cola. */
  _planProgress(car, plan) {
    const hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
    const behind = car.length / 2 + .75;
    let index = 0;
    while (index < plan.points.length && (plan.points[index].x - car.position.x) * hx + (plan.points[index].z - car.position.z) * hz < -behind) index++;
    return index;
  }

  /** Quien ya está dentro solo reserva lo que le falta: el tramo que dejó atrás ya no le estorba a nadie. */
  _claimConflict(plan, claim) {
    if (!this._pathsConflict(plan, claim.plan)) return false;
    if (!claim.from) return true;
    const margin = (plan.width + claim.plan.width) / 2 + .5;
    for (let index = claim.from; index < claim.plan.points.length; index++) {
      const p = claim.plan.points[index];
      if (plan.points.some(q => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < margin ** 2)) return true;
    }
    return false;
  }

  _pathsConflict(a, b) {
    if (a === b) return false;
    const cached = a.compatible?.get(b);
    if (cached !== undefined) return cached;
    const startA = a.points[0], startB = b.points[0];
    // Una misma entrada permite seguir al líder; el control de distancia impide alcanzarlo. Solo cuenta la separación
    // lateral: cada plan empieza según la huella de su carro, y una buseta y un sedán del mismo carril no coinciden.
    const sameEntry = startA && startB && a.hx * b.hx + a.hz * b.hz > .99 &&
      Math.abs((startB.x - startA.x) * -a.hz + (startB.z - startA.z) * a.hx) < 1.2;
    const margin = (a.width + b.width) / 2 + .5;
    const conflict = !sameEntry && a.points.some(p => b.points.some(q => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < margin ** 2));
    a.compatible?.set(b, conflict); b.compatible?.set(a, conflict);
    return conflict;
  }

  _clearance(vehicle, player, pedestrians) {
    if (!this._updating) this._buildSpatialIndex(pedestrians);
    const { route, car, distance, speed } = vehicle;
    vehicle.personBlocked = false;
    vehicle.playerClearance = Infinity;
    const finish = hardClearance => {
      vehicle.hardClearance = hardClearance;
      return Math.min(hardClearance, vehicle.playerClearance);
    };
    let clearance = Infinity;
    for (const other of this._routeVehicles.get(route) ?? []) {
      if (other === vehicle || other.route !== route) continue;
      const gap = (other.distance - distance + route.length) % route.length;
      clearance = Math.min(clearance, Math.max(0, gap - (car.length + other.car.length) / 2 - GAP));
    }
    // Mira también alrededor de los giros; no solo en línea recta frente al carro.
    const lookAhead = Math.max(7, speed * speed / (2 * (vehicle.braking ?? BRAKING)) + speed * .8 + 2);
    // Descarte amplio y conservador una vez por carro, no por cada muestra de su ruta.
    // Incluye toda la diagonal de la carrocería y el trayecto hasta el punto de frenado.
    const radius = lookAhead + Math.hypot(car.length / 2 + 0.8, car.width / 2 + 0.55);
    const nearby = this._nearbyPedestrians;
    const nearbyCars = this._nearbyCars ??= [];
    nearby.length = 0;
    nearbyCars.length = 0;
    const minX = car.position.x - radius, maxX = car.position.x + radius;
    const minZ = car.position.z - radius, maxZ = car.position.z + radius;
    this._carGrid.query(minX, minZ, maxX, maxZ, this._carCandidates);
    for (const other of this._carCandidates) {
      if (other === vehicle || (other.route === route && other.state !== 'chase' && !other.rejoinTarget)) continue;
      if (other.car.position.distanceToSquared(car.position) <= (radius + other.car.length) ** 2) nearbyCars.push(other);
    }
    this._personGrid.query(minX, minZ, maxX, maxZ, this._personCandidates);
    for (const pedestrian of this._personCandidates) {
      const dx = pedestrian.position.x - car.position.x, dz = pedestrian.position.z - car.position.z;
      if (dx * dx + dz * dz <= radius * radius) nearby.push(pedestrian);
    }
    // Estar junto al frente también obstruye a un conductor detenido por rojo
    // o por otro carro: no depender del primer motivo de frenado encontrado.
    vehicle.personBlocked = (!!player && this._personAtNose(player, car)) ||
      nearby.some(pedestrian => this._personAtNose(pedestrian.position, car));
    // La señal corresponde al acceso actual, no al rumbo futuro tras doblar.
    const signalDirection = this._signalDirection ??= new THREE.Vector3();
    if (this.signals) route.sample(distance, this._probePosition, signalDirection);
    for (let ahead = 0; ahead <= Math.min(lookAhead, clearance); ahead += PROBE_STEP) {
      route.sample(distance + ahead, this._probePosition, this._probeDirection);
      if (this.signals?.blocks(this._probePosition, signalDirection, car.position, car.length, vehicle)) return finish(Math.max(0, ahead - PROBE_STEP));
      if (player && vehicle.playerClearance === Infinity && this._personInCar(player, car)) {
        vehicle.personBlocked ||= ahead <= 10;
        vehicle.playerClearance = Math.max(0, ahead - PROBE_STEP);
      }
      for (const other of nearbyCars) if (this._carInPath(other, car)) return finish(Math.max(0, ahead - PROBE_STEP));
      for (const pedestrian of nearby) {
        if (this._personInCar(pedestrian.position, car)) {
          vehicle.personBlocked ||= ahead <= 10;
          return finish(Math.max(0, ahead - PROBE_STEP));
        }
      }
    }
    return finish(clearance);
  }

  _buildSpatialIndex(pedestrians) {
    this._carGrid ??= new SpatialGrid(); this._personGrid ??= new SpatialGrid();
    this._routeVehicles ??= new Map(); this._carCandidates ??= []; this._personCandidates ??= [];
    this._carGrid.clear(); this._personGrid.clear();
    for (const list of this._routeVehicles.values()) list.length = 0;
    const insert = other => {
      const { x, z } = other.car.position, size = other.car.length;
      this._carGrid.insert(other, x - size, z - size, x + size, z + size);
    };
    for (const vehicle of this.vehicles) {
      insert(vehicle);
      if (vehicle.state === 'chase' || vehicle.rejoinTarget) continue;
      let list = this._routeVehicles.get(vehicle.route);
      if (!list) this._routeVehicles.set(vehicle.route, list = []);
      list.push(vehicle);
    }
    for (const vehicle of this.parkedCars ?? []) insert(vehicle);
    for (const vehicle of this.busVehicles ?? []) if (vehicle.car.group.visible) insert(vehicle);
    for (const person of pedestrians) this._personGrid.insert(person, person.position.x, person.position.z);
  }

  _checkPlayerImpact(vehicle, player, startDistance, travel, onPlayerHit) {
    let contact = false;
    if (player) {
      // Muestreo del volumen recorrido, incluso en curvas y cuadros lentos.
      const samples = Math.max(1, Math.ceil(travel / .2));
      for (let index = 0; index <= samples; index++) {
        vehicle.route.sample(startDistance + travel * index / samples, this._probePosition, this._probeDirection);
        if (Math.abs(player.y - this._probePosition.y) > 1.8) continue;
        const dx = player.x - this._probePosition.x, dz = player.z - this._probePosition.z;
        const front = dx * this._probeDirection.x + dz * this._probeDirection.z;
        const side = -dx * this._probeDirection.z + dz * this._probeDirection.x;
        const outsideFront = Math.max(0, Math.abs(front) - vehicle.car.length / 2);
        const outsideSide = Math.max(0, Math.abs(side) - vehicle.car.width / 2);
        if (outsideFront ** 2 + outsideSide ** 2 > PLAYER_RADIUS ** 2) continue;
        contact = true;
        if (!vehicle.playerContact && travel > 0 && vehicle.speed >= 1.2) {
          vehicle.impactStop = true;
          onPlayerHit?.({ vehicle: vehicle.car, speed: vehicle.speed, direction: this._probeDirection.clone() });
        }
        break;
      }
    }
    vehicle.playerContact = contact;
  }

  _planChase(vehicle, stepTime, player, returning = false) {
    vehicle._chaseCaught = vehicle._chaseGiveUp = false;
    if (!player) {
      vehicle.nextSpeed = Math.max(0, vehicle.speed - BRAKING * stepTime);
      vehicle._chaseDist = 0;
      return;
    }
    const dx = player.x - vehicle.car.position.x;
    const dz = player.z - vehicle.car.position.z;
    const dist = Math.hypot(dx, dz);
    vehicle._chaseDx = dx;
    vehicle._chaseDz = dz;
    vehicle._chaseDist = dist;
    if (returning && dist <= .2 && Math.abs(player.y - vehicle.car.position.y) <= .3) {
      vehicle.car.position.copy(player);
      vehicle.rejoinTarget = null;
      vehicle._chaseDist = 0;
      vehicle.nextSpeed = 0;
      return;
    }
    const targetWater = this.environment?.getWaterInfo?.(player.x, player.z);
    if (!returning && canReachCombatTarget({ from: vehicle.car.position, to: player,
      maxDistance: POLICE_CATCH_RANGE, maxHeightDifference: CHASE_HEIGHT_TOLERANCE,
      collisions: this.environment?.collisions, getWaterInfo: this.environment?.getWaterInfo,
      toInWater: !!targetWater && player.y <= targetWater.surfaceY + .12,
      ignoreVehicle: vehicle.car })) {
      vehicle._chaseCaught = true;
      vehicle.nextSpeed = 0;
      return;
    }
    if (!returning && (dist > POLICE_GIVE_UP_RANGE || vehicle.chaseTime + stepTime >= POLICE_CHASE_TIMEOUT)) {
      vehicle._chaseGiveUp = true;
      vehicle.nextSpeed = 0;
      return;
    }
    const rate = POLICE_CHASE_SPEED < vehicle.speed ? BRAKING : CHASE_ACCELERATION;
    vehicle.nextSpeed = THREE.MathUtils.clamp(POLICE_CHASE_SPEED, vehicle.speed - rate * stepTime, vehicle.speed + rate * stepTime);
    vehicle._chaseSteerTime = Math.max(0, (vehicle._chaseSteerTime ?? 0) - stepTime);
  }

  _chaseFootprint(vehicle, x, z, y, nx, nz) {
    const { getGroundHeight, getWaterInfo, collisions } = this.environment;
    const ground = getGroundHeight?.(x, z, y) ?? y;
    if (!Number.isFinite(ground) || Math.abs(ground - y) > .3) return null;
    const halfLength = vehicle.car.length / 2 + .12, halfWidth = vehicle.car.width / 2 + .12;
    // El centro y los cuatro extremos de cada eje evitan meter media carrocería en el lago o en un desnivel.
    for (const along of [-halfLength, 0, halfLength]) for (const side of [-halfWidth, 0, halfWidth]) {
      const px = x + nx * along - nz * side, pz = z + nz * along + nx * side;
      const support = getGroundHeight?.(px, pz, ground) ?? ground;
      if (!Number.isFinite(support) || Math.abs(support - ground) > .75) return null;
      const water = getWaterInfo?.(px, pz);
      if (water && support <= water.surfaceY + .12) return null;
    }
    const halfX = Math.abs(nx) * halfLength + Math.abs(nz) * halfWidth;
    const halfZ = Math.abs(nz) * halfLength + Math.abs(nx) * halfWidth;
    const box = this._chaseBox;
    box.min.set(x - halfX, ground + .25, z - halfZ);
    box.max.set(x + halfX, ground + 1.65, z + halfZ);
    const blocked = entry => entry?.box && entry.vehicle !== vehicle.car && box.intersectsBox(entry.box);
    const obstacles = collisions?.queryStatic?.(box.min.x, box.min.z, box.max.x, box.max.z, this._chaseColliders)
      ?? collisions?.colliders ?? [];
    if (obstacles.some(blocked) || collisions?.dynamicColliders?.some(blocked)) return null;
    return ground;
  }

  _chaseClearance(vehicle, nx, nz, travel) {
    let y = vehicle.car.position.y, allowed = 0;
    const count = Math.max(1, Math.ceil(travel / CHASE_PROBE_STEP));
    for (let index = 0; index <= count; index++) {
      const distance = travel * index / count;
      const ground = this._chaseFootprint(vehicle, vehicle.car.position.x + nx * distance,
        vehicle.car.position.z + nz * distance, y, nx, nz);
      if (ground === null) break;
      allowed = distance;
      y = ground;
    }
    this._chaseSweepY = y;
    return allowed;
  }

  _steerChase(vehicle, distance) {
    const bearing = Math.atan2(vehicle._chaseDz, vehicle._chaseDx);
    const lookAhead = Math.min(distance, 3 + vehicle.speed * .5);
    let best = -Infinity, bestAngle = bearing;
    for (const offset of CHASE_STEERING) {
      const angle = bearing + offset;
      const current = -vehicle.car.group.rotation.y;
      const turn = Math.atan2(Math.sin(angle - current), Math.cos(angle - current));
      const samples = Math.max(1, Math.ceil(Math.abs(turn) / .2));
      let canTurn = true;
      for (let i = 1; i <= samples; i++) {
        const yaw = current + turn * i / samples, p = vehicle.car.position;
        if (this._chaseFootprint(vehicle, p.x, p.z, p.y, Math.cos(yaw), Math.sin(yaw)) === null) {
          canTurn = false; break;
        }
      }
      if (!canTurn) continue;
      const clear = this._chaseClearance(vehicle, Math.cos(angle), Math.sin(angle), lookAhead);
      // Permite rodear el borde de un obstáculo; la preferencia leve conserva el lado elegido.
      const previous = vehicle._chaseHeading ?? bearing;
      const continuity = Math.cos(angle - previous) * .08;
      const score = clear * (.35 + Math.cos(offset)) + continuity;
      if (score > best) { best = score; bestAngle = angle; }
    }
    vehicle._chaseHeading = bestAngle;
    vehicle._chaseCanMove = best > -Infinity;
    vehicle._chaseSteerTime = .2;
  }

  _applyChase(vehicle, stepTime) {
    if (vehicle._chaseGiveUp) {
      this._returnToPatrol(vehicle);
      if (!this.inPursuit && !this._arrestDispatched) emit('police-escaped', {});
      return false;
    }
    vehicle.speed = vehicle.nextSpeed;
    if (vehicle.state === 'chase') vehicle.chaseTime += stepTime;
    if (vehicle._chaseCaught) {
      vehicle.car.animateDrive(0, true);
      return true;
    }
    const dist = vehicle._chaseDist || 0;
    if (dist > 1e-6) {
      let travel = Math.min(vehicle.speed * stepTime, Math.max(0, dist - (vehicle.rejoinTarget ? 0 : POLICE_CATCH_RANGE * .35)));
      let nx = vehicle._chaseDx / dist, nz = vehicle._chaseDz / dist;
      if (this.environment) {
        if (vehicle._chaseSteerTime <= 0) this._steerChase(vehicle, dist);
        nx = Math.cos(vehicle._chaseHeading); nz = Math.sin(vehicle._chaseHeading);
        const safeTravel = vehicle._chaseCanMove ? this._chaseClearance(vehicle, nx, nz, travel) : 0;
        if (safeTravel < travel) vehicle._chaseSteerTime = 0;
        travel = safeTravel;
        if (vehicle._chaseCanMove) vehicle.car.position.y = this._chaseSweepY;
      }
      if (vehicle.rejoinTarget) {
        vehicle._rejoinStuck = travel > 1e-3 ? 0 : (vehicle._rejoinStuck ?? 0) + stepTime;
        if (vehicle._rejoinStuck > REJOIN_TIMEOUT && this._forceRejoin(vehicle)) return false;
      }
      vehicle.car.position.x += nx * travel;
      vehicle.car.position.z += nz * travel;
      if (travel > 0) vehicle.car.group.rotation.y = Math.atan2(-nz, nx);
      vehicle.car.animateDrive(travel, false);
      vehicle.speed = stepTime > 0 ? travel / stepTime : 0;
    }
    return false;
  }

  update(dt, { player = null, pedestrians = [], onPlayerHit = null } = {}) {
    if (dt <= 0) return;
    let caught = false;
    this._playerPosition = player;
    this._coordinateIntersections();
    for (const vehicle of this.vehicles) {
      if (vehicle.state === 'chase' || vehicle.rejoinTarget) continue;
      vehicle.routeTimer -= Math.min(dt, .5);
      if (vehicle.routeTimer <= 0) {
        const changed = this._chooseRoute(vehicle);
        vehicle.routeTimer = changed ? 6 + this.random() * 8 : 1 + this.random() * 2;
      }
    }
    // Subpasos acotados: un cuadro lento no puede saltarse a otro vehículo o peatón.
    let remaining = Math.min(dt, 0.5);
    while (remaining > 1e-8) {
      const stepTime = Math.min(remaining, 0.05);
      this._time += stepTime;
      this._buildSpatialIndex(pedestrians);
      this._updating = true;
      try {
        for (const vehicle of this.vehicles) {
          if (vehicle.state === 'chase' || vehicle.rejoinTarget) {
            vehicle._offRouteStep = true;
            this._planChase(vehicle, stepTime, vehicle.rejoinTarget ?? player, !!vehicle.rejoinTarget);
            continue;
          }
          const clearance = this._clearance(vehicle, player, pedestrians);
          const braking = vehicle.braking ?? BRAKING;
          // Anticipa la respuesta gradual del conductor; el peatón no es una pared
          // capaz de eliminar la velocidad restante en un solo subpaso.
          const brakingClearance = Math.min(clearance, Math.max(0, vehicle.playerClearance - vehicle.speed));
          let desiredSpeed = Math.min(vehicle.cruiseSpeed, Math.sqrt(2 * braking * brakingClearance));
          if (vehicle.impactStop) {
            desiredSpeed = 0;
            if (vehicle.speed < .1) {
              vehicle.impactWait = (vehicle.impactWait ?? 2) - stepTime;
              if (vehicle.impactWait <= 0) { vehicle.impactStop = false; vehicle.impactWait = undefined; }
            }
          }
          // Conductor fuera del carro: frena con su aceleración normal y espera.
          if (vehicle.hold) desiredSpeed = 0;
          // Anticipa las curvas y reduce la velocidad antes de girar.
          let start = 0;
          for (const segment of vehicle.route.segments) {
            if (segment.radius) {
              const ahead = ((start - vehicle.distance) % vehicle.route.length + vehicle.route.length) % vehicle.route.length;
              const inCurve = vehicle.distance >= start && vehicle.distance < start + segment.length;
              const turnSpeed = Math.sqrt(segment.radius * 1.8);
              desiredSpeed = Math.min(desiredSpeed, Math.sqrt(turnSpeed ** 2 + 2 * braking * (inCurve ? 0 : ahead)));
            }
            start += segment.length;
          }
          if (clearance < .05 && vehicle.speed < .1) vehicle.stopped = true;
          if (vehicle.stopped && clearance > .5) {
            vehicle.resumeDelay = vehicle.reactionTime; vehicle.stopped = false;
          }
          if (vehicle.resumeDelay > 0) { vehicle.resumeDelay -= stepTime; desiredSpeed = 0; }
          const targetAcceleration = THREE.MathUtils.clamp((desiredSpeed - vehicle.speed) / .65, -braking, vehicle.accelerationLimit ?? ACCELERATION);
          vehicle.acceleration = THREE.MathUtils.clamp(targetAcceleration, vehicle.acceleration - 3 * stepTime, vehicle.acceleration + 3 * stepTime);
          const candidateSpeed = THREE.MathUtils.clamp(vehicle.speed + vehicle.acceleration * stepTime, 0, vehicle.cruiseSpeed);
          const speed = desiredSpeed === 0 && candidateSpeed < .01 ? 0 : candidateSpeed;
          const travel = Math.min(Math.max(0, speed * stepTime), vehicle.hardClearance);
          vehicle.nextDistance = (vehicle.distance + travel) % vehicle.route.length;
          vehicle.nextSpeed = travel / stepTime;
          vehicle.nextTravel = travel;

          if (clearance < 3.5 && vehicle.speed > 0.8) {
            // Los cuatro segundos de espera no transcurren mientras la simulación está en pausa.
            if (this._time - (vehicle.lastHonkTime || 0) > 4) {
              vehicle.lastHonkTime = this._time;
              emitHonk(vehicle.car.position.x, vehicle.car.position.z);
            }
          }
        }
      } finally {
        this._updating = false;
      }
      // Todos consultan las mismas posiciones antes de aplicar el movimiento.
      for (const vehicle of this.vehicles) {
        if (vehicle._offRouteStep) {
          vehicle._offRouteStep = false;
          if (this._applyChase(vehicle, stepTime)) caught = true;
          continue;
        }
        const startDistance = vehicle.distance;
        const travel = vehicle.nextTravel;
        const previousSpeed = vehicle.speed;
        vehicle.distance = vehicle.nextDistance;
        vehicle.speed = vehicle.nextSpeed;
        this._checkPlayerImpact(vehicle, player, startDistance, travel, onPlayerHit);
        vehicle.route.sample(vehicle.distance, this._position, this._direction);
        vehicle.car.position.copy(this._position);
        vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
        this._animateRoute(vehicle, travel, stepTime, previousSpeed);
      }
      remaining -= stepTime;
    }
    if (caught && !this._arrestDispatched) {
      this._arrestDispatched = true;
      emit('police-arrest', { reason: 'chase' });
    }
  }

  dispose() {
    this.signals?.reservations?.clear();
    for (const { car } of this.vehicles) car.dispose();
    this.vehicles.length = 0;
  }
}
