import * as THREE from 'three';
import { Car } from '../entities/Car.js';

const GAP = 1.8;
const ACCELERATION = 1.8;
const BRAKING = 5;
const PROBE_STEP = 0.5;

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
        route.sample(distance, this._position, this._direction);
        const car = new Car(scene, this._position, Math.atan2(-this._direction.z, this._direction.x), { traffic: true });
        const cruiseSpeed = 3.5 + random() * 1.5;
        this.vehicles.push({ car, route, distance, speed: 0, cruiseSpeed, nextDistance: distance, nextSpeed: 0, lastHonkTime: 0 });
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

  _clearance(vehicle, player, pedestrians) {
    const { route, car, distance, speed } = vehicle;
    let clearance = Infinity;
    for (const other of this.vehicles) {
      if (other === vehicle || other.route !== route) continue;
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

  update(dt, { player = null, pedestrians = [] } = {}) {
    if (dt <= 0) return;
    // Subpasos acotados: un cuadro lento no puede saltarse a otro vehículo o peatón.
    let remaining = Math.min(dt, 0.5);
    while (remaining > 1e-8) {
      const stepTime = Math.min(remaining, 0.05);
      for (const vehicle of this.vehicles) {
        const clearance = this._clearance(vehicle, player, pedestrians);
        const desiredSpeed = Math.min(vehicle.cruiseSpeed, Math.sqrt(2 * BRAKING * clearance));
        const rate = desiredSpeed < vehicle.speed ? BRAKING : ACCELERATION;
        const speed = THREE.MathUtils.clamp(desiredSpeed, vehicle.speed - rate * stepTime, vehicle.speed + rate * stepTime);
        const travel = Math.min(Math.max(0, speed * stepTime), clearance);
        vehicle.nextDistance = (vehicle.distance + travel) % vehicle.route.length;
        vehicle.nextSpeed = travel / stepTime;
        if (clearance < 3.5 && vehicle.speed > 0.8) {
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          if (now - (vehicle.lastHonkTime || 0) > 4000) {
            vehicle.lastHonkTime = now;
            emitHonk(vehicle.car.position.x, vehicle.car.position.z);
          }
        }
      }
      // Todos consultan las mismas posiciones antes de aplicar el movimiento.
      for (const vehicle of this.vehicles) {
        vehicle.distance = vehicle.nextDistance;
        vehicle.speed = vehicle.nextSpeed;
        vehicle.route.sample(vehicle.distance, this._position, this._direction);
        vehicle.car.position.copy(this._position);
        vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
        vehicle.car.animateDrive(vehicle.speed * stepTime, vehicle.speed < vehicle.cruiseSpeed * 0.7);
      }
      remaining -= stepTime;
    }
  }

  dispose() {
    for (const { car } of this.vehicles) car.dispose();
    this.vehicles.length = 0;
  }
}
