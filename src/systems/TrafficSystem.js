import * as THREE from 'three';
import { Car } from '../entities/Car.js';
import {
  POLICE_SIGHT_RANGE,
  POLICE_CLOSE_RANGE,
  POLICE_CHASE_SPEED,
  POLICE_CATCH_RANGE,
  POLICE_GIVE_UP_RANGE,
  POLICE_CHASE_TIMEOUT,
} from '../utils/constants.js';

const GAP = 1.8;
const ACCELERATION = 1.8;
const BRAKING = 5;
const CHASE_ACCELERATION = 3.2;
const PROBE_STEP = 0.5;
const ROUTE_SAMPLE_STEP = 2;

export class TrafficSystem {
  constructor(scene, routes, { carsPerRoute = 4, policeCount = 2, random = Math.random } = {}) {
    this.vehicles = [];
    this.routes = routes;
    this._random = random;
    this._arrestDispatched = false;
    this._position = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._probePosition = new THREE.Vector3();
    this._probeDirection = new THREE.Vector3();
    this._nearbyPedestrians = [];
    for (const route of routes) {
      // Evita una población inicial mayor que el espacio disponible en el circuito.
      const count = Math.min(carsPerRoute, Math.floor(route.length / 12));
      for (let i = 0; i < count; i++) {
        const distance = (i + 0.4) * route.length / count;
        this._spawn(scene, route, distance, false);
      }
    }
    if (routes.length && policeCount > 0) {
      for (let i = 0; i < policeCount; i++) {
        const route = routes[Math.floor(random() * routes.length)];
        const distance = random() * route.length;
        this._spawn(scene, route, distance, true);
      }
    }
  }

  _spawn(scene, route, distance, police) {
    route.sample(distance, this._position, this._direction);
    const car = new Car(scene, this._position, Math.atan2(-this._direction.z, this._direction.x), {
      traffic: true,
      kind: police ? 'police' : null,
    });
    const cruiseSpeed = police ? 5 + this._random() * 1.5 : 3.5 + this._random() * 1.5;
    this.vehicles.push({
      car,
      route,
      distance,
      speed: 0,
      cruiseSpeed,
      patrolSpeed: cruiseSpeed,
      nextDistance: distance,
      nextSpeed: 0,
      police,
      state: 'patrol',
      chaseTime: 0,
    });
  }

  _canWitness(vehicle, playerPosition) {
    const dx = playerPosition.x - vehicle.car.position.x;
    const dz = playerPosition.z - vehicle.car.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > POLICE_SIGHT_RANGE * POLICE_SIGHT_RANGE) return false;
    const dist = Math.sqrt(distSq);
    if (dist <= POLICE_CLOSE_RANGE) return true;
    const yaw = vehicle.car.group.rotation.y;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    return (fx * dx + fz * dz) / dist > 0.2;
  }

  /** ¿Alguna patrulla tiene al jugador a la vista (cerca o de frente)? */
  witnessesTheft(playerPosition) {
    if (!playerPosition) return false;
    for (const vehicle of this.vehicles) {
      if (!vehicle.police || vehicle.state !== 'patrol') continue;
      if (this._canWitness(vehicle, playerPosition)) return true;
    }
    return false;
  }

  /** Pasa a persecución a las patrullas que ven el robo. */
  alertForTheft(playerPosition) {
    if (!playerPosition) return false;
    let alerted = false;
    for (const vehicle of this.vehicles) {
      if (!vehicle.police || vehicle.state !== 'patrol') continue;
      if (!this._canWitness(vehicle, playerPosition)) continue;
      this._startChase(vehicle);
      alerted = true;
    }
    return alerted;
  }

  _startChase(vehicle) {
    vehicle.state = 'chase';
    vehicle.chaseTime = 0;
    vehicle.cruiseSpeed = POLICE_CHASE_SPEED;
    vehicle.car.pursuit = true;
  }

  /** Tras una captura o al escapar, todas las patrullas vuelven a rondar. */
  endPursuit() {
    this._arrestDispatched = false;
    for (const vehicle of this.vehicles) {
      if (vehicle.police && vehicle.state !== 'patrol') this._returnToPatrol(vehicle);
    }
  }

  get inPursuit() {
    return this.vehicles.some((vehicle) => vehicle.police && vehicle.state === 'chase');
  }

  _returnToPatrol(vehicle) {
    vehicle.state = 'patrol';
    vehicle.chaseTime = 0;
    vehicle.speed = 0;
    vehicle.nextSpeed = 0;
    vehicle.cruiseSpeed = vehicle.patrolSpeed;
    vehicle.car.pursuit = false;
    this._snapToNearestRoute(vehicle);
  }

  _snapToNearestRoute(vehicle) {
    if (!this.routes.length) return;
    let bestRoute = this.routes[0];
    let bestDistance = 0;
    let bestScore = Infinity;
    for (const route of this.routes) {
      for (let d = 0; d < route.length; d += ROUTE_SAMPLE_STEP) {
        route.sample(d, this._probePosition, this._probeDirection);
        const dx = this._probePosition.x - vehicle.car.position.x;
        const dz = this._probePosition.z - vehicle.car.position.z;
        const score = dx * dx + dz * dz;
        if (score < bestScore) {
          bestScore = score;
          bestRoute = route;
          bestDistance = d;
        }
      }
    }
    vehicle.route = bestRoute;
    vehicle.distance = bestDistance;
    vehicle.nextDistance = bestDistance;
    bestRoute.sample(bestDistance, this._position, this._direction);
    vehicle.car.position.copy(this._position);
    vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
  }

  /** Cambia a otro circuito y se reubica en el punto más cercano del nuevo carril. */
  _reroute(vehicle) {
    if (this.routes.length < 2) return;
    let next = this.routes[Math.floor(this._random() * this.routes.length)];
    if (next === vehicle.route) {
      next = this.routes[(this.routes.indexOf(next) + 1) % this.routes.length];
    }
    let bestDistance = 0;
    let bestScore = Infinity;
    for (let d = 0; d < next.length; d += ROUTE_SAMPLE_STEP) {
      next.sample(d, this._probePosition, this._probeDirection);
      const dx = this._probePosition.x - vehicle.car.position.x;
      const dz = this._probePosition.z - vehicle.car.position.z;
      const score = dx * dx + dz * dz;
      if (score < bestScore) {
        bestScore = score;
        bestDistance = d;
      }
    }
    vehicle.route = next;
    vehicle.nextDistance = bestDistance;
  }

  _personInCar(position, car) {
    const dx = position.x - this._probePosition.x, dz = position.z - this._probePosition.z;
    const forward = dx * this._probeDirection.x + dz * this._probeDirection.z;
    const sideways = dx * -this._probeDirection.z + dz * this._probeDirection.x;
    // Incluye el radio del peatón y un margen de frenado alrededor de la carrocería.
    return Math.abs(forward) < car.length / 2 + 0.8 && Math.abs(sideways) < car.width / 2 + 0.55;
  }

  _clearance(vehicle, player, pedestrians) {
    const { route, car, distance, speed } = vehicle;
    let clearance = Infinity;
    for (const other of this.vehicles) {
      if (other === vehicle || other.route !== route || other.state === 'chase') continue;
      const gap = (other.distance - distance + route.length) % route.length;
      clearance = Math.min(clearance, Math.max(0, gap - (car.length + other.car.length) / 2 - GAP));
    }
    // Mira también alrededor de los giros; no solo en línea recta frente al carro.
    const lookAhead = Math.max(5, speed * speed / (2 * BRAKING) + speed * 0.2 + 2);
    // Descarte amplio y conservador una vez por carro, no por cada muestra de su ruta.
    // Incluye toda la diagonal de la carrocería y el trayecto hasta el punto de frenado.
    const radius = lookAhead + Math.hypot(car.length / 2 + 0.8, car.width / 2 + 0.55);
    const nearby = this._nearbyPedestrians;
    nearby.length = 0;
    for (const pedestrian of pedestrians) {
      const dx = pedestrian.position.x - car.position.x, dz = pedestrian.position.z - car.position.z;
      if (dx * dx + dz * dz <= radius * radius) nearby.push(pedestrian);
    }
    for (let ahead = 0; ahead <= Math.min(lookAhead, clearance); ahead += PROBE_STEP) {
      route.sample(distance + ahead, this._probePosition, this._probeDirection);
      if (player && this._personInCar(player, car)) return Math.max(0, ahead - PROBE_STEP);
      for (const pedestrian of nearby) {
        if (this._personInCar(pedestrian.position, car)) return Math.max(0, ahead - PROBE_STEP);
      }
    }
    return clearance;
  }

  _planChase(vehicle, stepTime, player) {
    if (!player) {
      vehicle.nextSpeed = Math.max(0, vehicle.speed - BRAKING * stepTime);
      vehicle._chaseCaught = false;
      vehicle._chaseDx = 0;
      vehicle._chaseDz = 0;
      return;
    }
    const dx = player.x - vehicle.car.position.x;
    const dz = player.z - vehicle.car.position.z;
    const dist = Math.hypot(dx, dz);
    vehicle._chaseCaught = dist <= POLICE_CATCH_RANGE;
    vehicle._chaseDx = dx;
    vehicle._chaseDz = dz;
    vehicle._chaseDist = dist;
    if (vehicle._chaseCaught) {
      vehicle.nextSpeed = 0;
      return;
    }
    if (dist > POLICE_GIVE_UP_RANGE || vehicle.chaseTime + stepTime >= POLICE_CHASE_TIMEOUT) {
      vehicle._chaseGiveUp = true;
      vehicle.nextSpeed = 0;
      return;
    }
    vehicle._chaseGiveUp = false;
    const desiredSpeed = POLICE_CHASE_SPEED;
    const rate = desiredSpeed < vehicle.speed ? BRAKING : CHASE_ACCELERATION;
    vehicle.nextSpeed = THREE.MathUtils.clamp(
      desiredSpeed,
      vehicle.speed - rate * stepTime,
      vehicle.speed + rate * stepTime,
    );
  }

  _applyChase(vehicle, stepTime) {
    if (vehicle._chaseGiveUp) {
      this._returnToPatrol(vehicle);
      if (!this.inPursuit && !this._arrestDispatched) {
        window.dispatchEvent(new CustomEvent('police-escaped', {}));
      }
      return false;
    }
    vehicle.speed = vehicle.nextSpeed;
    vehicle.chaseTime += stepTime;
    if (vehicle._chaseCaught) {
      vehicle.car.animateDrive(0, true);
      return true;
    }
    const dist = vehicle._chaseDist || 0;
    if (dist > 1e-6) {
      const travel = Math.min(vehicle.speed * stepTime, Math.max(0, dist - POLICE_CATCH_RANGE * 0.35));
      const nx = vehicle._chaseDx / dist;
      const nz = vehicle._chaseDz / dist;
      vehicle.car.position.x += nx * travel;
      vehicle.car.position.z += nz * travel;
      vehicle.car.group.rotation.y = Math.atan2(-nz, nx);
      vehicle.car.animateDrive(travel, false);
      vehicle.speed = stepTime > 0 ? travel / stepTime : 0;
    }
    return false;
  }

  update(dt, { player = null, pedestrians = [] } = {}) {
    if (dt <= 0) return;
    let caught = false;
    // Subpasos acotados: un cuadro lento no puede saltarse a otro vehículo o peatón.
    let remaining = Math.min(dt, 0.5);
    while (remaining > 1e-8) {
      const stepTime = Math.min(remaining, 0.05);
      for (const vehicle of this.vehicles) {
        if (vehicle.state === 'chase') {
          this._planChase(vehicle, stepTime, player);
          continue;
        }
        const clearance = this._clearance(vehicle, player, pedestrians);
        const desiredSpeed = Math.min(vehicle.cruiseSpeed, Math.sqrt(2 * BRAKING * clearance));
        const rate = desiredSpeed < vehicle.speed ? BRAKING : ACCELERATION;
        const speed = THREE.MathUtils.clamp(desiredSpeed, vehicle.speed - rate * stepTime, vehicle.speed + rate * stepTime);
        const travel = Math.min(Math.max(0, speed * stepTime), clearance);
        const raw = vehicle.distance + travel;
        // Al completar una vuelta, la patrulla puede cambiar de circuito al azar.
        if (vehicle.police && vehicle.state === 'patrol' && raw >= vehicle.route.length && this._random() < 0.7) {
          vehicle.nextDistance = raw % vehicle.route.length;
          vehicle.nextSpeed = travel / stepTime;
          this._reroute(vehicle);
        } else {
          vehicle.nextDistance = raw % vehicle.route.length;
          vehicle.nextSpeed = travel / stepTime;
        }
      }
      // Todos consultan las mismas posiciones antes de aplicar el movimiento.
      for (const vehicle of this.vehicles) {
        if (vehicle.state === 'chase') {
          if (this._applyChase(vehicle, stepTime)) caught = true;
          continue;
        }
        vehicle.distance = vehicle.nextDistance;
        vehicle.speed = vehicle.nextSpeed;
        vehicle.route.sample(vehicle.distance, this._position, this._direction);
        vehicle.car.position.copy(this._position);
        vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
        vehicle.car.animateDrive(vehicle.speed * stepTime, vehicle.speed < vehicle.cruiseSpeed * 0.7);
      }
      remaining -= stepTime;
    }
    if (caught && !this._arrestDispatched) {
      this._arrestDispatched = true;
      window.dispatchEvent(new CustomEvent('police-arrest', { detail: { reason: 'chase' } }));
    }
  }

  dispose() {
    for (const { car } of this.vehicles) car.dispose();
    this.vehicles.length = 0;
  }
}
