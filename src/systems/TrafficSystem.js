import * as THREE from 'three';
import { Car } from '../entities/Car.js';
import { signalState } from '../world/bogota/TrafficSignals.js';
import { PLAYER_RADIUS } from '../utils/constants.js';
import { SpatialGrid } from '../core/SpatialGrid.js';

const GAP = 1.8;
const ACCELERATION = 1.8;
const BRAKING = 2;
const PROBE_STEP = 0.5;
const PLAYER_IMPACT_RADIUS = PLAYER_RADIUS + 0.25;
const MIN_IMPACT_SPEED = 0.6;

function emitHonk(x, z) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      const detail = { x, z };
      const event = typeof CustomEvent !== 'undefined' ? new CustomEvent('car-honk', { detail }) : { type: 'car-honk', detail };
      window.dispatchEvent(event);
    } catch {}
  }
}

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
          lastHonkTime: 0 });
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
        if (outsideFront ** 2 + outsideSide ** 2 > PLAYER_IMPACT_RADIUS ** 2) continue;
        contact = true;
        if (!vehicle.playerContact && travel > 0 && vehicle.speed >= MIN_IMPACT_SPEED) {
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
    this._coordinateIntersections();
    for (const vehicle of this.vehicles) {
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
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (now - (vehicle.lastHonkTime || 0) > 4000) {
              vehicle.lastHonkTime = now;
              emitHonk(vehicle.car.position.x, vehicle.car.position.z);
            }
          }
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
        vehicle.route.sample(vehicle.distance, this._position, this._direction);
        vehicle.car.position.copy(this._position);
        vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
        vehicle.car.animateDrive(vehicle.speed * stepTime, vehicle.speed < vehicle.cruiseSpeed * 0.7);
      }
      remaining -= stepTime;
    }
  }

  dispose() {
    this.signals?.reservations?.clear();
    for (const { car } of this.vehicles) car.dispose();
    this.vehicles.length = 0;
  }
}
