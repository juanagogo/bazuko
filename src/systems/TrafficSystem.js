import * as THREE from 'three';
import { Car } from '../entities/Car.js';
import { signalState } from '../world/bogota/TrafficSignals.js';
import { PLAYER_RADIUS } from '../utils/constants.js';
import { SpatialGrid } from '../core/SpatialGrid.js';
import { DETOUR_SPEED, REVERSE_SPEED, applyDetour, circles, planDetour, vehiclesOverlap } from './TrafficDetour.js';

const GAP = 1.8;
const ACCELERATION = 1.8;
const BRAKING = 2;
const PROBE_STEP = 0.5;
// Ante una persona el conductor se detiene unos tres metros antes: no contra ella y con espacio para rodearla.
const PERSON_STOP_GAP = 2.2;
const PERSON_MARGIN = PLAYER_RADIUS + .5;
const MANEUVER_ROOM = 2.5;

export class TrafficSystem {
  constructor(scene, routes, { carsPerRoute = 4, random = Math.random } = {}) {
    this.vehicles = [];
    this.random = random;
    this.routes = routes.alternatives ?? routes;
    this._position = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._probePosition = new THREE.Vector3();
    this._probeDirection = new THREE.Vector3();
    this._signalDirection = new THREE.Vector3();
    this._nearbyPedestrians = [];
    this._nearbyCars = [];
    this._carGrid = new SpatialGrid();
    this._personGrid = new SpatialGrid();
    this._carCandidates = [];
    this._personCandidates = [];
    this._routeVehicles = new Map();
    for (const route of routes) {
      // Evita una población inicial mayor que el espacio disponible en el circuito.
      const count = Math.min(carsPerRoute, Math.floor(route.length / 12));
      for (let i = 0; i < count; i++) {
        const distance = (i + 0.4) * route.length / count;
        route.sample(distance, this._position, this._direction);
        const car = new Car(scene, this._position, Math.atan2(-this._direction.z, this._direction.x), { traffic: true });
        const cruiseSpeed = 10 + random() * 4;
        this.vehicles.push({ car, route, distance, speed: 0, cruiseSpeed, nextDistance: distance, nextSpeed: 0,
          acceleration: 0, accelerationLimit: 1.8 + random() * .7, braking: 2.2 + random() * .6,
          reactionTime: .18 + random() * .35, resumeDelay: 0, stopped: false,
          routeTimer: 3 + random() * 5, recentRoutes: [route.key], routeChanges: 0,
          blockReason: null, blocker: null, suddenBrakes: 0, temper: 0, evadePatience: 0, personWait: 0, detour: null });
        // Temperamento sesgado hacia la calma; el impaciente pita antes y rodea antes.
        const vehicle = this.vehicles.at(-1);
        vehicle.temper = random() ** 1.6;
        // Tiempo para decidir que la persona no se va a quitar: uno o dos bocinazos y maniobra.
        vehicle.evadePatience = (2 + random() * 4) * (1.25 - vehicle.temper * .7);
      }
    }
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

  /** Posición y rumbo de un carro que rodea, `s` metros después del origen de su plan. */
  _detourPoseAt(vehicle, s) {
    const scratch = this._poseScratch ??= { position: new THREE.Vector3(), direction: new THREE.Vector3() };
    vehicle.route.sample(vehicle.detour.origin + s, scratch.position, scratch.direction);
    if (s < vehicle.detour.end) applyDetour(vehicle.detour, s, scratch.position, scratch.direction);
    return { x: scratch.position.x, z: scratch.position.z, hx: scratch.direction.x, hz: scratch.direction.z };
  }

  /** Carril de la ruta, desplazado mientras dura un rodeo. */
  _sample(vehicle, distance, position, direction) {
    vehicle.route.sample(distance, position, direction);
    // El retroceso es recto por el carril; el desplazamiento empieza al volver a avanzar.
    if (vehicle.detour?.phase === 'forward') applyDetour(vehicle.detour, this._detourProgress(vehicle, distance), position, direction);
  }

  _detourProgress(vehicle, distance = vehicle.distance) {
    const length = vehicle.route.length;
    const s = ((distance - vehicle.detour.origin) % length + length) % length;
    return s > length / 2 ? s - length : s;
  }

  // Separación entre una carrocería y una persona: negativa si la persona queda dentro.
  _personGap(position, center, hx, hz, car) {
    const dx = position.x - center.x, dz = position.z - center.z;
    return Math.max(Math.abs(dx * hx + dz * hz) - car.length / 2, Math.abs(-dx * hz + dz * hx) - car.width / 2);
  }

  /**
   * Durante un rodeo validado, la persona rodeada solo detiene al carro si se mete en la
   * trayectoria más de lo que el plan admitía, por ejemplo al caminar hacia el carro.
   */
  _personBlocksProbe(vehicle, position, car) {
    if (!vehicle.detour || vehicle.detour.person !== position) return this._personInCar(position, car);
    const probe = this._personGap(position, this._probePosition, this._probeDirection.x, this._probeDirection.z, car);
    return probe < vehicle.detour.personLimit - .05;
  }

  setStreetQueries({ isDrivable = null, isCrosswalk = null } = {}) {
    this.isDrivable = isDrivable;
    this.isCrosswalk = isCrosswalk;
  }

  /** Velocidad y tiempo quieto de cada persona: quien cruza se va, quien se planta no. */
  _trackPeople(dt, player, pedestrians) {
    this._people ??= new WeakMap();
    const track = position => {
      const motion = this._people.get(position);
      if (!motion) { this._people.set(position, { x: position.x, z: position.z, speed: 0, still: 0 }); return; }
      const speed = Math.hypot(position.x - motion.x, position.z - motion.z) / dt;
      motion.speed += (speed - motion.speed) * Math.min(1, dt * 4);
      motion.still = motion.speed < .35 ? motion.still + dt : 0;
      motion.x = position.x; motion.z = position.z;
    };
    if (player) track(player);
    for (const pedestrian of pedestrians) track(pedestrian.position);
  }

  /** Quién tiene la vía y qué hace la persona que detiene al carro. */
  _personContext(vehicle, person, personAhead) {
    const motion = this._people?.get(person);
    vehicle.personStanding = (motion?.still ?? 0) > 1.2;
    vehicle.personOnCrosswalk = this.isCrosswalk ? !!this.isCrosswalk(person.x, person.z) : undefined;
    // Con rojo, o sin turno en el cruce, la persona está en su derecho de pasar.
    vehicle.personPriority = 'vehicle';
    if (!this.signals) return;
    const direction = this._signalDirection;
    vehicle.route.sample(vehicle.distance, this._probePosition, direction);
    for (let ahead = 0; ahead <= personAhead + vehicle.car.length + 4; ahead += 1) {
      vehicle.route.sample(vehicle.distance + ahead, this._probePosition, this._probeDirection);
      if (this.signals.blocks(this._probePosition, direction, vehicle.car.position, vehicle.car.length, vehicle)) {
        vehicle.personPriority = 'pedestrian';
        return;
      }
    }
  }

  setBus(bus) {
    this.busVehicles = [bus].flat().filter(Boolean).map(vehicle => ({ car: vehicle,
      get heading() { return vehicle.heading ?? { x: 0, z: -1 }; } }));
    this.busVehicle = this.busVehicles[0] ?? null;
  }

  setParkedCars(cars) { this.parkedCars = cars.map(car => ({ car })); }

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
    return Math.abs(front) < car.length / 2 + along * other.car.length / 2 + across * other.car.width / 2 + margin &&
      Math.abs(side) < car.width / 2 + across * other.car.length / 2 + along * other.car.width / 2 + .15;
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
      for (const [vehicle, claim] of state.owners) {
        const overlaps = this._overlapsNode(vehicle.car, node);
        claim.entered ||= overlaps;
        if ((claim.entered && !overlaps) || (!claim.entered &&
          (signalState(this.signals.time, claim.plan.axis) !== 0 || !candidates.includes(vehicle)))) state.owners.delete(vehicle);
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
          [...state.owners.values()].some(claim => this._pathsConflict(plan, claim.plan)) ||
          waiting.some(earlier => this._pathsConflict(plan, earlier));
        if (blocked && !entered) waiting.push(plan);
        else state.owners.set(vehicle, { entered, plan });
      }
      state.busBlocked = !!state.busPlan && [...state.owners.values()].some(claim => this._pathsConflict(claim.plan, state.busPlan));
      for (const vehicle of state.queue) vehicle.crossingNode ??= node;
    }
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
    const plan = { points: [], width: car.width, axis: 0, compatible: new WeakMap() };
    for (let ahead = entry; ahead < entry + 100; ahead += .75) {
      route.sample(distance + ahead, this._probePosition, this._probeDirection);
      if (!inside(this._probePosition)) break;
      if (!plan.points.length) {
        plan.hx = this._probeDirection.x; plan.hz = this._probeDirection.z;
        plan.axis = Math.abs(plan.hx) >= Math.abs(plan.hz) ? 0 : 1;
      }
      plan.points.push({ x: this._probePosition.x, z: this._probePosition.z });
    }
    return plan;
  }

  _pathsConflict(a, b) {
    if (a === b) return false;
    const cached = a.compatible?.get(b);
    if (cached !== undefined) return cached;
    const startA = a.points[0], startB = b.points[0];
    // Una misma entrada permite seguir al líder; el control de distancia impide alcanzarlo.
    const sameEntry = startA && startB && a.hx * b.hx + a.hz * b.hz > .99 &&
      Math.hypot(startA.x - startB.x, startA.z - startB.z) < 1.2;
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
    // Motivo y causante de la detención: el claxon distingue un rojo de una obstrucción.
    vehicle.personPriority = null;
    const finish = (hardClearance, reason = null, blocker = null) => {
      vehicle.hardClearance = hardClearance;
      const playerFirst = vehicle.playerClearance < hardClearance;
      vehicle.blockReason = playerFirst ? 'person' : reason;
      vehicle.blocker = playerFirst || reason === 'person' ? null : blocker;
      vehicle.blockingPerson = playerFirst ? player : reason === 'person' ? blocker : null;
      if (vehicle.blockingPerson) this._personContext(vehicle, vehicle.blockingPerson, Math.min(hardClearance, vehicle.playerClearance));
      return Math.min(hardClearance, vehicle.playerClearance);
    };
    let clearance = Infinity, leader = null;
    for (const other of this._routeVehicles.get(route) ?? []) {
      if (other === vehicle || other.route !== route) continue;
      const gap = (other.distance - distance + route.length) % route.length;
      // Detrás de un carro detenido por una persona se deja espacio para que pueda maniobrar.
      const room = other.blockReason === 'person' && other.speed < .5 && !other.detour ? MANEUVER_ROOM : 0;
      const otherClearance = Math.max(0, gap - (car.length + other.car.length) / 2 - GAP - room);
      if (otherClearance < clearance) { clearance = otherClearance; leader = other; }
    }
    // Mira también alrededor de los giros; no solo en línea recta frente al carro.
    // El frenado crece de forma gradual: mirar también el trayecto mientras el pie llega al freno.
    const lookAhead = Math.max(7, speed * speed / (2 * (vehicle.braking ?? BRAKING)) + speed * 2.2 + 3);
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
      if (other === vehicle || other.route === route) continue;
      if (other.car.position.distanceToSquared(car.position) <= (radius + other.car.length) ** 2) nearbyCars.push(other);
    }
    this._personGrid.query(minX, minZ, maxX, maxZ, this._personCandidates);
    for (const pedestrian of this._personCandidates) {
      const dx = pedestrian.position.x - car.position.x, dz = pedestrian.position.z - car.position.z;
      if (dx * dx + dz * dz <= radius * radius) nearby.push(pedestrian);
    }
    // Estar junto al frente también obstruye a un conductor detenido por rojo
    // o por otro carro: no depender del primer motivo de frenado encontrado.
    const playerAtNose = !!player && this._personAtNose(player, car);
    vehicle.personBlocked = playerAtNose || nearby.some(pedestrian => this._personAtNose(pedestrian.position, car));
    // Quien se queda es el jugador; los peatones suelen ir cruzando y el conductor les da más tiempo.
    vehicle.personBlocker = playerAtNose ? 'player' : vehicle.personBlocked ? 'pedestrian' : null;
    // La señal corresponde al acceso actual, no al rumbo futuro tras doblar.
    const signalDirection = this._signalDirection ??= new THREE.Vector3();
    if (this.signals) route.sample(distance, this._probePosition, signalDirection);
    // Si el de adelante está rodeando a alguien, esa persona queda entre ambos: revisar todo el trayecto.
    const probeLimit = leader?.detour ? lookAhead : Math.min(lookAhead, clearance);
    // Lo mismo con un carro de otra ruta que rodea delante: se le sigue sin dejar de mirar detrás de él.
    let detouring = null, detouringClearance = Infinity;
    for (let ahead = 0; ahead <= probeLimit; ahead += PROBE_STEP) {
      this._sample(vehicle, distance + ahead, this._probePosition, this._probeDirection);
      if (this.signals?.blocks(this._probePosition, signalDirection, car.position, car.length, vehicle)) return finish(Math.max(0, ahead - PROBE_STEP), 'signal');
      if (player && vehicle.playerClearance === Infinity && this._personBlocksProbe(vehicle, player, car)) {
        if (ahead <= 10) { vehicle.personBlocked = true; vehicle.personBlocker = 'player'; }
        vehicle.playerClearance = Math.max(0, ahead - PROBE_STEP - PERSON_STOP_GAP);
      }
      for (const other of nearbyCars) if (other !== detouring && this._carInPath(other, car)) {
        if (other.detour && !detouring) { detouring = other; detouringClearance = Math.max(0, ahead - PROBE_STEP); continue; }
        if (other.detour) continue;
        // Un carro de otra ruta en el mismo carril se sigue como en una cola; uno transversal se cruza.
        const yaw = other.car.group.rotation.y, heading = other.heading ?? { x: Math.cos(yaw), z: -Math.sin(yaw) };
        const following = heading.x * Math.cos(car.group.rotation.y) - heading.z * Math.sin(car.group.rotation.y) > .7;
        if (detouringClearance < Infinity) return finish(detouringClearance, 'car', detouring);
        return finish(Math.max(0, ahead - PROBE_STEP), following ? 'car' : 'cross', other);
      }
      for (const pedestrian of nearby) {
        if (this._personBlocksProbe(vehicle, pedestrian.position, car)) {
          if (ahead <= 10 && !vehicle.personBlocked) { vehicle.personBlocked = true; vehicle.personBlocker = 'pedestrian'; }
          const personClearance = Math.max(0, ahead - PROBE_STEP - PERSON_STOP_GAP);
          if (detouringClearance < personClearance) return finish(detouringClearance, 'car', detouring);
          return finish(personClearance, 'person', pedestrian.position);
        }
      }
    }
    if (detouringClearance < Math.min(clearance, lookAhead + 1)) return finish(detouringClearance, 'car', detouring);
    return clearance <= lookAhead ? finish(clearance, 'car', leader) : finish(clearance);
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
        this._sample(vehicle, startDistance + travel * index / samples, this._probePosition, this._probeDirection);
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

  update(dt, { player = null, pedestrians = [], onPlayerHit = null } = {}) {
    if (dt <= 0) return;
    this.time = (this.time ?? 0) + dt;
    this._trackPeople(Math.min(dt, .5), player, pedestrians);
    this._coordinateIntersections();
    for (const vehicle of this.vehicles) {
      // Durante un rodeo el conductor no cambia de recorrido.
      if (vehicle.detour) continue;
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
      this._buildSpatialIndex(pedestrians);
      this._updating = true;
      try {
        for (const vehicle of this.vehicles) {
          const clearance = this._clearance(vehicle, player, pedestrians);
          if (vehicle.detour?.phase === 'reverse') { this._reverse(vehicle, stepTime, player, pedestrians); continue; }
          if (vehicle.giveRoom && this._giveRoom(vehicle, stepTime, player, pedestrians)) continue;
          this._considerDetour(vehicle, stepTime, player, pedestrians);
          const braking = vehicle.braking ?? BRAKING;
          // Anticipa la respuesta gradual del conductor; el peatón no es una pared
          // capaz de eliminar la velocidad restante en un solo subpaso.
          // El margen por el frenado gradual crece con la velocidad; a paso de maniobra casi no hace
          // falta, y conservarlo haría que el carro se arrastrara varios segundos hasta detenerse.
          const anticipation = vehicle.speed * Math.min(1.8, .2 + vehicle.speed * .3);
          const brakingClearance = Math.min(clearance, Math.max(0, vehicle.playerClearance - anticipation));
          let desiredSpeed = Math.min(vehicle.cruiseSpeed, Math.sqrt(2 * braking * brakingClearance));
          if (vehicle.impactStop) {
            desiredSpeed = 0;
            if (vehicle.speed < .1) {
              vehicle.impactWait = (vehicle.impactWait ?? 2) - stepTime;
              if (vehicle.impactWait <= 0) { vehicle.impactStop = false; vehicle.impactWait = undefined; }
            }
          }
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
          // El rodeo se hace despacio, a paso de maniobra.
          if (vehicle.detour) desiredSpeed = Math.min(desiredSpeed, DETOUR_SPEED);
          const targetAcceleration = THREE.MathUtils.clamp((desiredSpeed - vehicle.speed) / .65, -braking, vehicle.accelerationLimit ?? ACCELERATION);
          vehicle.acceleration = THREE.MathUtils.clamp(targetAcceleration, vehicle.acceleration - 3 * stepTime, vehicle.acceleration + 3 * stepTime);
          const candidateSpeed = THREE.MathUtils.clamp(vehicle.speed + vehicle.acceleration * stepTime, 0, vehicle.cruiseSpeed);
          const speed = desiredSpeed === 0 && candidateSpeed < .01 ? 0 : candidateSpeed;
          const travel = Math.min(Math.max(0, speed * stepTime), vehicle.hardClearance);
          vehicle.nextDistance = (vehicle.distance + travel) % vehicle.route.length;
          vehicle.nextSpeed = travel / stepTime;
          vehicle.nextTravel = travel;
          vehicle.nextWheelTravel = travel;

          // Frenazo muy superior al previsto porque algo se atraviesa de golpe; seguir una cola o un semáforo no cuenta.
          const hardBraking = vehicle.speed > 4 && clearance < 8 && (vehicle.blockReason === 'cross' || vehicle.blockReason === 'person') &&
            vehicle.speed * vehicle.speed / (2 * Math.max(clearance, .1)) > braking * 1.5;
          if (hardBraking && !vehicle.hardBraking) vehicle.suddenBrakes = (vehicle.suddenBrakes ?? 0) + 1;
          vehicle.hardBraking = hardBraking;
        }
      } finally {
        this._updating = false;
      }
      // Todos consultan las mismas posiciones antes de aplicar el movimiento.
      for (const vehicle of this.vehicles) {
        const startDistance = vehicle.distance;
        const travel = vehicle.nextTravel;
        vehicle.distance = vehicle.nextDistance;
        vehicle.speed = vehicle.nextSpeed;
        this._checkPlayerImpact(vehicle, player, startDistance, travel, onPlayerHit);
        // Terminado el rodeo, el carro ya volvió al centro de su carril.
        if (vehicle.detour?.phase === 'forward' && this._detourProgress(vehicle) >= vehicle.detour.end) vehicle.detour = null;
        this._sample(vehicle, vehicle.distance, this._position, this._direction);
        vehicle.car.position.copy(this._position);
        vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
        vehicle.car.animateDrive(vehicle.nextWheelTravel ?? vehicle.speed * stepTime, vehicle.speed < vehicle.cruiseSpeed * 0.7);
      }
      remaining -= stepTime;
    }
  }

  /**
   * El conductor rodea a quien se planta delante teniendo él la vía: decide cuando la persona
   * lleva un momento quieta y él ya reaccionó según su temperamento. Si ve que el carro de
   * adelante ya rodeó a esa misma persona, aprovecha el hueco enseguida, incluso rodando despacio.
   */
  _considerDetour(vehicle, stepTime, player, pedestrians) {
    if (vehicle.detour) return;
    const person = vehicle.blockingPerson;
    const seen = person && this._detoured?.get(person);
    const following = seen !== undefined && seen !== null && this.time - seen < 40;
    const waiting = vehicle.blockReason === 'person' && vehicle.personPriority === 'vehicle' && person &&
      vehicle.speed < (following ? DETOUR_SPEED + .5 : .3);
    if (!waiting) { vehicle.personWait = 0; return; }
    vehicle.personWait += stepTime;
    if (following) { if (vehicle.personWait < vehicle.reactionTime * 2 + .2) return; }
    // Alguien que cruza termina de pasar; solo se rodea a quien se planta o no deja de estorbar.
    else if (vehicle.personWait < vehicle.evadePatience || (!vehicle.personStanding && vehicle.personWait < vehicle.evadePatience * 2)) return;
    if (this.time < (vehicle.nextDetourPlan ?? 0)) return;
    // Si no hay hueco se vuelve a mirar en cuanto cambie algo: un carro que pasa, alguien que se mueve.
    vehicle.nextDetourPlan = this.time + (following ? .5 : 1);
    const { car } = vehicle, origin = vehicle.distance;
    const scratch = this._detourScratch ??= { position: new THREE.Vector3(), direction: new THREE.Vector3() };
    const sample = (s, position, direction) => {
      vehicle.route.sample(origin + s, scratch.position, scratch.direction);
      position.x = scratch.position.x; position.z = scratch.position.z;
      direction.x = scratch.direction.x; direction.z = scratch.direction.z;
    };
    const near = position => position !== person && position.distanceToSquared(car.position) < 30 * 30;
    const people = [...(player ? [player] : []), ...pedestrians.map(pedestrian => pedestrian.position)].filter(near);
    const others = [];
    const add = (other, heading, speed) => {
      const target = other.car;
      if (target === car || target.position.distanceToSquared(car.position) > 45 * 45 || Math.abs(target.position.y - car.position.y) > 3) return;
      const entry = { x: target.position.x, z: target.position.z, hx: heading.x, hz: heading.z, length: target.length, width: target.width, speed };
      // Quien ya rodea avanza por su plan; se supone algo más lento de lo que va, lo que deja más margen detrás.
      if (other.detour?.phase === 'forward') entry.poseAt = t => this._detourPoseAt(other, this._detourProgress(other) + DETOUR_SPEED * .6 * t);
      others.push(entry);
    };
    const yawHeading = target => ({ x: Math.cos(target.group.rotation.y), z: -Math.sin(target.group.rotation.y) });
    // Los del mismo carril guardan distancia por sí solos, y quien está rodeando no sigue recto:
    // proyectarlos en línea recta inventaría choques con la misma maniobra que abren.
    for (const other of this.vehicles) add(other, yawHeading(other.car), other.route === vehicle.route || other.detour ? 0 : other.speed);
    for (const other of this.parkedCars ?? []) add(other, yawHeading(other.car), 0);
    for (const other of this.busVehicles ?? []) if (other.car.group.visible) add(other, other.heading, other.car.speed ?? 0);
    // Rodando no se puede retroceder, y tampoco si el de atrás todavía se está acercando:
    // terminaría encima. Se espera a que se detenga y se vuelve a mirar.
    const follower = this._followerOf(vehicle, car.length + 8);
    const plan = planDetour({ sample, car, person, people, others, isDrivable: this.isDrivable,
      reverse: vehicle.speed < .3 && !(follower?.speed > .3) });
    if (!plan) {
      // Sin espacio para girar: el de atrás, si está pegado y detenido, puede dar un poco.
      if (follower && follower.speed < .3 && !follower.detour && !follower.giveRoom && this._gapBehind(vehicle, follower) < car.length + 4) {
        follower.giveRoom = { leader: vehicle, remaining: 1.5, until: this.time + 20 };
      }
      return;
    }
    vehicle.detour = { ...plan, origin, person, phase: plan.back > 0 ? 'reverse' : 'forward' };
    vehicle.personWait = 0;
    // Quien viene detrás reconoce a todo el grupo rodeado, no solo a quien detuvo a este carro.
    this._detoured ??= new WeakMap();
    for (const position of [person, ...people]) if (position.distanceToSquared(person) < 4 * 4) this._detoured.set(position, this.time);
  }

  /**
   * Retroceso corto y recto antes de rodear, con la misma geometría con que se planeó.
   * Si alguien ocupa el espacio de atrás, se detiene; si no se libera, abandona y vuelve a planear.
   */
  _reverse(vehicle, stepTime, player, pedestrians) {
    const detour = vehicle.detour;
    const remaining = this._detourProgress(vehicle) + detour.back;
    const moved = this._backUp(vehicle, Math.min(REVERSE_SPEED * stepTime, Math.max(0, remaining)), player, pedestrians);
    detour.blockedFor = moved ? 0 : (detour.blockedFor ?? 0) + stepTime;
    if (remaining - moved <= 1e-3) detour.phase = 'forward';
    // Todavía sin desplazamiento lateral: cancelar no produce saltos.
    else if (detour.blockedFor > 2) { vehicle.detour = null; vehicle.personWait = vehicle.evadePatience; }
  }

  /** Retrocede en línea recta por el carril si atrás no hay personas ni vehículos; devuelve lo recorrido. */
  _backUp(vehicle, travel, player, pedestrians) {
    const { car } = vehicle;
    const hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
    const x = car.position.x - hx * travel, z = car.position.z - hz * travel;
    const shape = circles(x, z, hx, hz, car.length, car.width, this._reverseShape ??= []);
    const other = this._reverseOther ??= [];
    const personBehind = position => {
      const dx = position.x - x, dz = position.z - z;
      return Math.abs(dx * hx + dz * hz) < car.length / 2 + PERSON_MARGIN && Math.abs(-dx * hz + dz * hx) < car.width / 2 + PERSON_MARGIN &&
        dx * hx + dz * hz < 0;
    };
    const blocked = (player && personBehind(player)) || pedestrians.some(pedestrian => personBehind(pedestrian.position)) ||
      [...this.vehicles, ...(this.parkedCars ?? [])].some(({ car: target }) => target !== car &&
        vehiclesOverlap(shape, circles(target.position.x, target.position.z, Math.cos(target.group.rotation.y), -Math.sin(target.group.rotation.y), target.length, target.width, other)));
    const moved = blocked ? 0 : travel;
    vehicle.nextDistance = (vehicle.distance - moved + vehicle.route.length) % vehicle.route.length;
    vehicle.nextSpeed = 0; vehicle.nextTravel = 0; vehicle.nextWheelTravel = -moved;
    vehicle.acceleration = 0;
    return moved;
  }

  /** Distancia por el carril entre un carro y el que lo sigue. */
  _gapBehind(vehicle, follower) {
    return (vehicle.distance - follower.distance + vehicle.route.length) % vehicle.route.length;
  }

  /** El carro inmediatamente detrás en el mismo recorrido, si está a menos de `range` metros. */
  _followerOf(vehicle, range) {
    let best = null, nearest = range;
    for (const other of this._routeVehicles.get(vehicle.route) ?? []) {
      if (other === vehicle) continue;
      const gap = this._gapBehind(vehicle, other);
      if (gap > 0 && gap < nearest) { nearest = gap; best = other; }
    }
    return best;
  }

  /**
   * Quien va detrás de un conductor atascado por una persona retrocede un poco para darle
   * espacio de maniobra y se queda quieto hasta que el de adelante sale o desiste.
   */
  _giveRoom(vehicle, stepTime, player, pedestrians) {
    const request = vehicle.giveRoom, leader = request.leader;
    // En cuanto el de adelante avanza por su rodeo ya no hace falta el espacio: se vuelve a la fila.
    const leaving = leader.detour?.phase === 'forward' && this._detourProgress(leader) > 0;
    const gone = !this.vehicles.includes(leader) || leader.route !== vehicle.route || leaving ||
      (!leader.detour && leader.blockReason !== 'person') || this.time > request.until;
    if (gone) { vehicle.giveRoom = null; return false; }
    // Sin nada más que retroceder, el mismo paso nulo lo mantiene quieto.
    const travel = Math.min(REVERSE_SPEED * stepTime, request.remaining), moved = this._backUp(vehicle, travel, player, pedestrians);
    request.remaining -= moved;
    // Si el de atrás tampoco deja espacio, se le pide a él: la fila retrocede en cadena.
    const behind = travel > 0 && !moved && this._followerOf(vehicle, vehicle.car.length + 4);
    if (behind && behind.speed < .3 && !behind.detour && !behind.giveRoom) {
      behind.giveRoom = { leader: vehicle, remaining: request.remaining, until: request.until };
    }
    return true;
  }

  dispose() {
    this.signals?.reservations?.clear();
    for (const { car } of this.vehicles) car.dispose();
    this.vehicles.length = 0;
  }
}
