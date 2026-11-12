// src/systems/CrashSystem.js
// Los choques del tráfico: de vez en cuando, y más en las horas pico, dos carros se estrellan (uno le pega por detrás al otro
// o se cruzan en una esquina). Quedan averiados y parados en su carril, los conductores se bajan a discutir, el tráfico se
// va represando detrás y pasado un rato el choque se despeja y todo vuelve a rodar. Nunca nace a la vista del jugador.
import * as THREE from 'three';

const emit = (type, detail) => globalThis.window?.dispatchEvent?.(new CustomEvent(type, { detail }));

export const CRASH = {
  checkEvery: 8,          // s entre tiradas
  baseChance: .04,        // por tirada, fuera de las horas pico
  rushFactor: 3,          // de 6:30 a 9:30 y de 16:30 a 19:30
  nightFactor: .4,
  maxActive: 2,
  minDistance: 24,        // m: ni más cerca del jugador que esto
  farView: 45,            // m: dentro de esto tampoco si queda en el cuadro de la cámara
  minSpeed: 4,            // m/s mínimos del que embiste
  gap: 12,                // m: el de adelante tiene que estar así de cerca del que embiste
  damage: [.35, .65],
  argueDelay: 1.2,        // s antes de que se bajen los conductores
  clearAfter: [55, 95],   // s que dura el choque en la calle
  sideRange: 7            // m entre los dos carros que se cruzan
};

export const CRASH_LINES = ['¡Usted no mira, hermano!', '¡Me dañó el carro!', '¡Y ahora quién me paga!', '¡Se me atravesó, marica!', '¡Llame al seguro, ya!'];

/** Probabilidad de que una tirada provoque un choque: sube en las horas pico y baja de noche. */
export function crashChance(hour = 12) {
  const h = ((hour % 24) + 24) % 24;
  const rush = (h >= 6.5 && h < 9.5) || (h >= 16.5 && h < 19.5);
  const night = h >= 22 || h < 5;
  return CRASH.baseChance * (rush ? CRASH.rushFactor : night ? CRASH.nightFactor : 1);
}

const _frustum = new THREE.Frustum(), _m = new THREE.Matrix4(), _sphere = new THREE.Sphere();

export class CrashSystem {
  /**
   * @param {{ traffic: object, roadRage?: object, audio?: object, random?: () => number }} deps
   */
  constructor({ traffic, roadRage = null, audio = null, random = Math.random } = {}) {
    this.traffic = traffic;
    this.roadRage = roadRage;
    this.audio = audio;
    this.random = random;
    this.crashes = [];
    this.timer = 0;
    this.total = 0;
  }

  get active() { return this.crashes.length > 0; }

  /** ¿Este sitio queda a la vista del jugador? Así el choque nunca nace delante de la cámara. */
  _seen(position, player, camera) {
    const d = Math.hypot(position.x - player.x, position.z - player.z);
    if (d < CRASH.minDistance) return true;
    if (d >= CRASH.farView || !camera) return false;
    camera.updateMatrixWorld?.();
    _frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return _frustum.intersectsSphere(_sphere.set(position, 4));
  }

  _eligible(vehicle) {
    const car = vehicle.car;
    return !vehicle.hold && !vehicle.protestHold && vehicle.state !== 'chase' && !vehicle.rejoinTarget && !vehicle.crash
      && !car.isMoto && car.kind !== 'police' && car.kind !== 'buseta' && car.drawn !== false;
  }

  /** Busca un par que pueda chocar ahora: el que va detrás de otro en su carril, o dos que se cruzan en una esquina. */
  _findPair(player, camera) {
    const list = this.traffic.vehicles.filter(v => this._eligible(v) && v.speed >= CRASH.minSpeed);
    const start = Math.floor(this.random() * Math.max(1, list.length));
    for (let k = 0; k < list.length; k++) {
      const a = list[(start + k) % list.length];
      for (const b of this.traffic.vehicles) {
        if (b === a || !this._eligible(b)) continue;
        const dx = b.car.position.x - a.car.position.x, dz = b.car.position.z - a.car.position.z, dist = Math.hypot(dx, dz);
        if (a.route === b.route && Math.abs((a.lateral ?? 0) - (b.lateral ?? 0)) < .8) {
          const ahead = (b.distance - a.distance + a.route.length) % a.route.length;
          if (ahead > 0 && ahead < (a.car.length + b.car.length) / 2 + CRASH.gap && !this._seen(b.car.position, player, camera) && !this._seen(a.car.position, player, camera)) return { kind: 'rear', hit: a, hurt: b };
        } else if (dist < CRASH.sideRange && b.speed >= CRASH.minSpeed * .5) {
          const ya = a.car.group.rotation.y, yb = b.car.group.rotation.y;
          if (Math.abs(Math.cos(ya - yb)) < .4 && !this._seen(a.car.position, player, camera)) return { kind: 'side', hit: a, hurt: b };
        }
      }
    }
    return null;
  }

  /** Un par cualquiera en fila cerca de un punto (para los trucos y las pruebas), sin mirar la vista ni el azar. */
  pairNear(position, { maxDistance = 60 } = {}) {
    let best = null, bestSq = maxDistance * maxDistance;
    for (const a of this.traffic.vehicles) {
      if (!this._eligible(a)) continue;
      for (const b of this.traffic.vehicles) {
        if (b === a || b.route !== a.route || !this._eligible(b) || Math.abs((a.lateral ?? 0) - (b.lateral ?? 0)) > .8) continue;
        const ahead = (b.distance - a.distance + a.route.length) % a.route.length;
        if (ahead <= 0 || ahead > (a.car.length + b.car.length) / 2 + CRASH.gap) continue;
        const sq = (a.car.position.x - position.x) ** 2 + (a.car.position.z - position.z) ** 2;
        if (sq < bestSq) { bestSq = sq; best = { kind: 'rear', hit: a, hurt: b }; }
      }
    }
    return best;
  }

  /**
   * Provoca el choque de un par: los dos paran en seco y quedan averiados, suena el golpe y, un momento después, los
   * conductores se bajan a discutir. El del carril queda trancando el paso hasta que el choque se despeje.
   */
  crash({ kind = 'rear', hit, hurt }) {
    if (!hit || !hurt || hit.crash || hurt.crash) return null;
    const traffic = this.traffic;
    if (kind === 'rear') {
      // el de atrás queda pegado a la cola del de adelante, sin montarse
      const length = hit.route.length, gap = (hit.car.length + hurt.car.length) / 2 + .15;
      hit.distance = ((hurt.distance - gap) % length + length) % length;
      hit.lateral = hurt.lateral ?? 0;
      traffic.placeVehicle?.(hit);
    }
    const crash = { kind, vehicles: [hit, hurt], time: 0, argued: false, duration: CRASH.clearAfter[0] + this.random() * (CRASH.clearAfter[1] - CRASH.clearAfter[0]) };
    for (const vehicle of crash.vehicles) {
      vehicle.crash = crash;
      traffic.hold?.(vehicle.car, true);
      vehicle.speed = vehicle.nextSpeed = 0; vehicle.acceleration = 0;
      vehicle.car.setWreck?.(CRASH.damage[0] + this.random() * (CRASH.damage[1] - CRASH.damage[0]));
    }
    this.audio?.playCarCrash?.(hit.car.position);
    for (const vehicle of crash.vehicles) emit('car-honk', { x: vehicle.car.position.x, z: vehicle.car.position.z });
    this.crashes.push(crash);
    this.total++;
    return crash;
  }

  /** Despeja el choque: los conductores suben, los carros sueltan el freno y siguen su camino con la abolladura. */
  clear(crash) {
    if (crash.drivers) this.roadRage?.endArgue?.(crash.drivers);
    for (const vehicle of crash.vehicles) {
      vehicle.crash = null;
      this.traffic.hold?.(vehicle.car, false);
      vehicle.resumeDelay = vehicle.reactionTime ?? .5;
    }
    const at = this.crashes.indexOf(crash);
    if (at >= 0) this.crashes.splice(at, 1);
  }

  reset() { for (const crash of [...this.crashes]) this.clear(crash); this.timer = 0; }

  /** @param {{ hour?: number, player?: THREE.Vector3, camera?: THREE.Camera, blocked?: boolean }} ctx */
  update(dt, { hour = 12, player = null, camera = null, blocked = false } = {}) {
    if (dt <= 0 || !this.traffic) return;
    for (const crash of [...this.crashes]) {
      crash.time += dt;
      // el vehículo que se fue de la ciudad deshace el choque
      if (crash.vehicles.some(v => !this.traffic.vehicles.includes(v))) { this.clear(crash); continue; }
      if (!crash.argued && crash.time >= CRASH.argueDelay) {
        crash.argued = true;
        crash.drivers = this.roadRage?.argue?.(crash.vehicles[0].car, crash.vehicles[1].car, CRASH_LINES) ?? null;
      }
      if (crash.time >= crash.duration) this.clear(crash);
    }
    if (blocked || !player || this.crashes.length >= CRASH.maxActive) return;
    this.timer += dt;
    if (this.timer < CRASH.checkEvery) return;
    this.timer = 0;
    if (this.random() >= crashChance(hour)) return;
    const pair = this._findPair(player, camera);
    if (pair) this.crash(pair);
  }
}
