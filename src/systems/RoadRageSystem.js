// src/systems/RoadRageSystem.js
// La furia vial: un carro en circulación puede frenar y bajarse con una varilla cuando el jugador
// le roba un retrovisor, se le planta adelante, lo bloquea, le pega o le tira algo. Hasta tres
// conductores a la vez, ya precargados; su personaje se reutiliza y nada corre mientras están dentro.
import * as THREE from 'three';
import { AngryDriver, ROAD_RAGE } from '../entities/AngryDriver.js';
import { canReachCombatTarget, hasClearCombatLine } from './CombatGeometry.js';

const toast = (text, type = 'info') => globalThis.window?.dispatchEvent?.(new CustomEvent('toast', { detail: { text, type } }));

export class RoadRageSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {{ player: object, stats: object, audio?: object, random?: () => number }} deps
   */
  constructor(scene, { player, stats, audio = null, random = Math.random }) {
    this.scene = scene;
    this.player = player;
    this.stats = stats;
    this.audio = audio;
    this.random = random;
    this.traffic = null;
    this.drivers = [];          // reserva de conductores, siempre los mismos
    this.incidents = [];        // { driver, vehicle, car, cause, state, stopTimer, doorSide, rider }; state: stopping | out | fled (le robaron el carro y huye)
    this._carState = new WeakMap();
    this._projectiles = [];     // popó en vuelo que podría caer sobre un carro
    this._time = 0;
    this.onPlayerHurt = null;
    this._door = new THREE.Vector3();
    // Reutilizado cada cuadro al comprobar que la puerta tiene salida.
    this._line = { from: this._door, to: new THREE.Vector3(), collisions: null, chestHeight: .8 };
    this._people = null;
  }

  /**
   * @param {object} district distrito activo (caminable y altura del suelo)
   * @param {object} traffic sistema de tráfico
   * @param {object[]} people lista de peatones que los carros respetan
   */
  setup(district, traffic, people = null, { collisions = null } = {}) {
    this.reset();
    for (const driver of this.drivers) driver.dispose();
    this.drivers = [];
    this.traffic = traffic;
    this._people = people;
    this.collisions = collisions;
    this._line.collisions = collisions;
    this.getWaterInfo = (x, z) => district?.getWaterInfo?.(x, z) ?? null;
    this._ground = (x, z, currentY = 0) => district?.getMovementGroundHeight?.(x, z, currentY)
      ?? district?.getGroundHeight?.(x, z) ?? currentY;
    const opts = {
      isWalkable: (x, z) => district?.isWalkableAt?.(x, z) ?? true,
      groundHeight: this._ground, getWaterInfo: this.getWaterInfo, collisions
    };
    for (let i = 0; i < ROAD_RAGE.maxDrivers; i++) this.drivers.push(new AngryDriver(this.scene, opts));
    this._carState = new WeakMap();
    this._projectiles.length = 0;
    this._time = 0;
  }

  get active() { return this.incidents.length > 0; }
  /** 'out' apenas haya uno fuera: es lo que mira el HUD, aunque otro siga frenando. */
  get state() {
    for (let index = 0; index < this.incidents.length; index++) if (this.incidents[index].state === 'out') return 'out';
    return this.incidents[0]?.state ?? 'idle';
  }
  get driver() { return this.incidents[0]?.driver ?? this.drivers[0] ?? null; }

  /** El incidente de ese carro, si su conductor va frenando, está afuera o huye. */
  incidentOf(car) {
    for (let index = 0; index < this.incidents.length; index++) if (this.incidents[index].car === car) return this.incidents[index];
    return null;
  }
  /** Quién se bajó, o se va a bajar, de ese carro. */
  driverOf(car) { return this.incidentOf(car)?.driver ?? null; }
  /** ¿Algún conductor bravo tiene sostenido este vehículo de tráfico? */
  holds(vehicle) {
    for (let index = 0; index < this.incidents.length; index++) if (vehicle && this.incidents[index].vehicle === vehicle) return true;
    return false;
  }

  /** Personajes para precargar junto con los demás NPC. */
  get preloadables() { return this.drivers; }

  /** ¿Este vehículo puede tener un conductor que se baje? Solo carros y motos en circulación con quien conduzca. */
  _canSnap(car) {
    if (!car || car.kind === 'police' || car.kind === 'buseta') return false;
    if (car.isMoto) return !!car.occupancy?.[0];
    return !!car.traffic;
  }

  /** Primer conductor de la reserva que no está en un incidente. */
  _freeDriver() {
    for (let index = 0; index < this.drivers.length; index++) {
      const candidate = this.drivers[index];
      let busy = false;
      for (let other = 0; other < this.incidents.length; other++) {
        if (this.incidents[other].driver === candidate) { busy = true; break; }
      }
      if (!busy) return candidate;
    }
    return null;
  }

  _hasCar(car) {
    for (let index = 0; index < this.incidents.length; index++) if (this.incidents[index].car === car) return true;
    return false;
  }

  _carStateOf(car) {
    let state = this._carState.get(car);
    if (!state) { state = { cooldowns: {}, frontTimer: 0, blockTimer: 0 }; this._carState.set(car, state); }
    return state;
  }

  /**
   * Intenta que el conductor se baje. Cada detonante tiene su probabilidad y su enfriamiento por carro.
   * @param {object} car vehículo en circulación
   * @param {'mirror'|'front'|'block'|'hit'|'thrown'} cause
   * @returns {boolean} si el conductor va a bajarse
   */
  trigger(car, cause = 'mirror') {
    const rule = ROAD_RAGE.triggers[cause];
    if (!rule || !this._canSnap(car)) return false;
    if (this._hasCar(car)) return false;
    const driver = this._freeDriver();
    if (!driver) return false;
    const state = this._carStateOf(car);
    if (this._time < (state.cooldowns[cause] ?? 0)) return false;
    state.cooldowns[cause] = this._time + rule.cooldown;
    if (this.random() >= rule.chance) return false;
    const vehicle = this.traffic?.hold(car, true);
    if (!vehicle) return false;
    this.incidents.push({ driver, vehicle, car, cause, state: 'stopping', stopTimer: 0,
      doorSide: car.vehicle?.driverDoor?.side ?? -1, rider: null });
    return true;
  }

  /**
   * Robo del carro con el conductor adentro (CarjackSystem): lo sacan por la puerta y huye sin varilla.
   * Si ese carro ya tiene a su conductor afuera, o no queda nadie libre en la reserva, simplemente desaparece.
   * @returns {boolean} si salió alguien corriendo
   */
  ejectDriver(car, door) {
    if (!car || !door || this._hasCar(car)) return false;
    const driver = this._freeDriver();
    if (!driver) return false;
    const at = new THREE.Vector3(door.x, this._ground?.(door.x, door.z, car.position.y) ?? door.y, door.z);
    driver.thrownOut(car, at, this.player.position);
    this._people?.push(driver);
    this.incidents.push({ driver, vehicle: null, car, cause: 'carjack', state: 'fled', stopTimer: 0, doorSide: -1, rider: null });
    return true;
  }

  _release(incident) {
    if (incident.vehicle) {
      this.traffic?.hold(incident.car, false);
      incident.car.setDriverInside?.(true);
    }
    if (incident.rider) incident.car.occupancy[0] = true;
    this._removePerson(incident.driver);
    const index = this.incidents.indexOf(incident);
    if (index >= 0) this.incidents.splice(index, 1);
  }

  _removePerson(driver) {
    const index = this._people?.indexOf(driver) ?? -1;
    if (index >= 0) this._people.splice(index, 1);
  }

  /** Recuperación tras morir o recargar: los conductores vuelven a sus carros y el tráfico sigue. */
  reset() {
    for (const incident of [...this.incidents]) {
      if (incident.driver.active) incident.driver.enterCar();
      this._release(incident);
    }
    this._projectiles.length = 0;
  }

  /** El popó lanzado puede caer sobre un carro; se le sigue el vuelo hasta que toca algo. */
  noteThrown(projectile) {
    if (projectile?.position) this._projectiles.push(projectile);
  }

  /**
   * @param {number} dt
   * @param {{ canChase?: boolean }} ctx canChase = false durante la muerte o el sueño
   */
  update(dt, { canChase = true } = {}) {
    if (dt > 0) this._time += dt;
    // Hacia atrás: el incidente que termina se quita de la lista sin saltarse al siguiente.
    for (let index = this.incidents.length - 1; index >= 0; index--) this._updateIncident(this.incidents[index], dt, canChase);
    if (dt <= 0) return;
    this._watchBlocked(dt);
    this._watchProjectiles();
  }

  _updateIncident(incident, dt, canChase) {
    const { car, driver } = incident;
    // Le robaron el carro: huye hasta perderse de vista y vuelve a la reserva.
    if (incident.state === 'fled') {
      if (dt <= 0) return;
      if (driver.think(dt, { player: this.player.position }) === 'gone') this._release(incident);
      if (driver.active) driver.update(dt, { player: this.player.position });
      return;
    }
    if (incident.state === 'stopping') {
      incident.stopTimer += dt;
      if (incident.vehicle.speed > .05 && incident.stopTimer < ROAD_RAGE.stopTimeout) return;
      // La puerta del conductor da al andén: si ahí hay un parqueado o una pared, se baja por el otro lado.
      incident.doorSide = car.vehicle?.driverDoor?.side ?? -1;
      this._doorPoint(car, incident.doorSide, this._door);
      this._line.to.set(this._door.x + .04, this._door.y, this._door.z + .04);
      if (!hasClearCombatLine(this._line)) {
        incident.doorSide = -incident.doorSide;
        this._doorPoint(car, incident.doorSide, this._door);
      }
      // Frenó tan lejos que ya no alcanzaría al jugador: sigue su camino en vez de anunciar la varilla y rendirse en el mismo cuadro.
      if (Math.hypot(this._door.x - this.player.position.x, this._door.z - this.player.position.z) > ROAD_RAGE.giveUpDistance - .5) {
        this._release(incident);
        return;
      }
      this._hideRider(incident);
      car.setDriverInside?.(false);
      driver.exitCar(car, this._door);
      this._people?.push(driver);
      incident.state = 'out';
      // El reclamo por el robo lo pone InteractionSystem con la voz de siempre; aquí solo va la burbuja del grito.
      if (incident.cause === 'mirror') toast('¡El conductor se bajó con una varilla! Córrale.', 'death');
      else toast('¡El conductor se bajó a reclamar! Córrale.', 'death');
      driver.say?.(ROAD_RAGE.yells[Math.floor(this.random() * ROAD_RAGE.yells.length)], 2.5);
    }
    this._doorPoint(car, incident.doorSide, this._door);
    const result = driver.think(dt, { player: this.player.position, door: this._door, canChase });
    if (result === 'swing') this.audio?.playWhoosh?.();
    else if (result === 'hit') this._hitPlayer(incident);
    else if (result === 'giveup') toast('El conductor dejó de perseguirme y vuelve a su carro.', 'info');
    else if (result === 'home') this._release(incident);
    if (driver.active) driver.update(dt, { player: this.player.position });
  }

  /** Los carros salen por la puerta; la moto por su costado, junto al asiento. */
  _doorPoint(car, side, target) {
    if (typeof car.driverDoor === 'function') car.driverDoor(target, side);
    else {
      car.group.updateMatrixWorld();
      target.set(0, 0, side * ((car.width ?? .7) / 2 + .45)).applyMatrix4(car.group.matrixWorld);
    }
    // Al piso: con la puerta sobre un andén o el puente, el conductor no sale en el aire.
    return target.setY(this._ground(target.x, target.z, car.position.y));
  }

  /** Mientras el motociclista está fuera, el primer puesto del lote queda vacío. */
  _hideRider(incident) {
    const car = incident.car;
    if (!car.isMoto) return;
    incident.rider = car.occupancy[0];
    car.occupancy[0] = false;
  }

  /** Mira quién frena por el jugador parado adelante y quién lleva rato bloqueado. */
  _watchBlocked(dt) {
    if (!this.traffic?.vehicles || !this._freeDriver()) return;
    const player = this.player.position;
    const reach = ROAD_RAGE.frontRange + 8;
    for (const vehicle of this.traffic.vehicles) {
      const car = vehicle.car;
      if (!this._canSnap(car)) continue;
      const dx = car.position.x - player.x, dz = car.position.z - player.z;
      if (dx * dx + dz * dz > reach * reach || this._hasCar(car)) continue;
      const state = this._carState.get(car);
      if (!vehicle.personBlocked || !(vehicle.playerClearance <= ROAD_RAGE.frontRange)
        || vehicle.speed > .6) {
        if (state) { state.frontTimer = 0; state.blockTimer = 0; }
        continue;
      }
      const blocked = state ?? this._carStateOf(car);
      blocked.frontTimer += dt;
      blocked.blockTimer += dt;
      if (blocked.frontTimer >= ROAD_RAGE.frontDelay) {
        blocked.frontTimer = 0;
        if (this.trigger(car, 'front')) return;
      }
      if (blocked.blockTimer >= ROAD_RAGE.blockDelay) {
        blocked.blockTimer = 0;
        this.trigger(car, 'block');
      }
    }
  }

  _watchProjectiles() {
    for (let index = this._projectiles.length - 1; index >= 0; index--) {
      const projectile = this._projectiles[index];
      if (!projectile.alive || !projectile.position) { this._projectiles.splice(index, 1); continue; }
      const car = this._carUnder(projectile.position);
      if (!car) continue;
      this._projectiles.splice(index, 1);
      this.trigger(car, 'thrown');
    }
  }

  _carUnder(point) {
    for (const vehicle of this.traffic?.vehicles ?? []) {
      const car = vehicle.car;
      if (!this._canSnap(car)) continue;
      if (Math.abs(point.y - car.position.y) > 2.2) continue;
      const radius = car.length / 2 + .7;
      if ((point.x - car.position.x) ** 2 + (point.z - car.position.z) ** 2 <= radius * radius) return car;
    }
    return null;
  }

  _hitPlayer(incident = this.incidents[0]) {
    const driver = incident?.driver;
    if (!this.stats || this.stats.salud <= 0 || this.player.isStunned) return;
    if (!driver?.active || !canReachCombatTarget({ from: driver.position, to: this.player.position,
      maxDistance: ROAD_RAGE.attackRange + .35, collisions: this.collisions, getWaterInfo: this.getWaterInfo,
      toInWater: !!this.player.isSwimming })) return;
    const [min, max] = ROAD_RAGE.damage;
    const damage = Math.round(min + this.random() * (max - min));
    this.stats.salud = Math.max(0, this.stats.salud - damage);
    this.audio?.playThud?.();
    this.player.receiveHit?.(this.player.position.clone().sub(driver.position), 2.2, { salud: this.stats.salud });
    this.onPlayerHurt?.(damage);
    toast(`¡Me pegaron con la varilla! −${damage} de salud.`, 'death');
  }

  dispose() {
    this.reset();
    for (const driver of this.drivers) driver.dispose();
    this.drivers = [];
  }
}
