// src/systems/RoadRageSystem.js
// Al robar el retrovisor de un carro en circulación, a veces el conductor frena, se baja
// con una varilla y persigue al jugador. Un solo conductor a la vez; su personaje se
// precarga durante la pantalla de carga y se reutiliza.
import * as THREE from 'three';
import { AngryDriver, ROAD_RAGE } from '../entities/AngryDriver.js';
import { canReachCombatTarget, hasClearCombatLine } from './CombatGeometry.js';

const toast = (text, type = 'info') => globalThis.window?.dispatchEvent?.(new CustomEvent('toast', { detail: { text, type } }));
const restoredPosition = record => Array.isArray(record?.position) && record.position.length === 3 && record.position.every(Number.isFinite);

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
    this.driver = null;
    this.traffic = null;
    this.vehicle = null;     // vehículo de tráfico detenido
    this.state = 'idle';     // idle | stopping | out
    this.stopTimer = 0;
    this.onPlayerHurt = null;
    this._door = new THREE.Vector3();
    this._doorSide = -1;     // lado por el que se bajó: por ahí mismo regresa
    this._people = null;
  }

  /**
   * @param {object} district distrito activo (caminable y altura del suelo)
   * @param {object} traffic sistema de tráfico
   * @param {object[]} people lista de peatones que los carros respetan
   */
  setup(district, traffic, people = null, { collisions = null } = {}) {
    this.reset();
    this.driver?.dispose();
    this.traffic = traffic;
    this._people = people;
    this.collisions = collisions;
    this.getWaterInfo = (x, z) => district?.getWaterInfo?.(x, z) ?? null;
    this._ground = (x, z, currentY = 0) => district?.getMovementGroundHeight?.(x, z, currentY)
      ?? district?.getGroundHeight?.(x, z) ?? currentY;
    this.driver = new AngryDriver(this.scene, {
      isWalkable: (x, z) => district?.isWalkableAt?.(x, z) ?? true,
      groundHeight: this._ground, getWaterInfo: this.getWaterInfo, collisions
    });
  }

  get active() { return this.state !== 'idle'; }

  /** Llamado al robar un retrovisor. Devuelve true si el conductor va a bajarse. */
  trigger(car) {
    if (!car?.traffic || !this.driver || this.active || this.random() >= ROAD_RAGE.chance) return false;
    const vehicle = this.traffic?.hold(car, true);
    if (!vehicle) return false;
    this.vehicle = vehicle;
    this.state = 'stopping';
    this.stopTimer = 0;
    return true;
  }

  /** Recuperación tras morir o recargar: el conductor vuelve a su carro y el tráfico sigue. */
  reset() {
    if (this.driver?.active) this.driver.enterCar();
    this._release();
  }

  _release() {
    if (this.vehicle) {
      this.traffic?.hold(this.vehicle.car, false);
      this.vehicle.car.setDriverInside?.(true);
    }
    this._removePerson();
    this.vehicle = null;
    this.state = 'idle';
  }

  _removePerson() {
    const index = this._people?.indexOf(this.driver) ?? -1;
    if (index >= 0) this._people.splice(index, 1);
  }

  /**
   * @param {number} dt
   * @param {{ canChase?: boolean }} ctx canChase = false durante la muerte o el sueño
   */
  update(dt, { canChase = true } = {}) {
    if (!this.active || dt <= 0) return;
    const car = this.vehicle.car;
    if (this.state === 'stopping') {
      this.stopTimer += dt;
      if (this.vehicle.speed > .05 && this.stopTimer < ROAD_RAGE.stopTimeout) return;
      // La puerta de la buseta da al andén: si ahí hay un parqueado o una pared, se baja por el otro lado.
      this._doorSide = car.vehicle?.driverDoor?.side ?? -1;
      car.driverDoor(this._door, this._doorSide);
      this._door.y = this._ground(this._door.x, this._door.z, car.position.y);
      if (!hasClearCombatLine({ from: this._door, to: { x: this._door.x + .04, y: this._door.y, z: this._door.z + .04 }, collisions: this.collisions, chestHeight: .8 })) {
        this._doorSide = -this._doorSide;
        car.driverDoor(this._door, this._doorSide);
        this._door.y = this._ground(this._door.x, this._door.z, car.position.y);
      }
      // Frenó tan lejos que ya no alcanzaría al jugador: sigue su camino en vez de anunciar la varilla y rendirse en el mismo cuadro.
      if (Math.hypot(this._door.x - this.player.position.x, this._door.z - this.player.position.z) > ROAD_RAGE.giveUpDistance - .5) { this._release(); return; }
      car.setDriverInside?.(false);
      this.driver.exitCar(car, this._door);
      this._people?.push(this.driver);
      this.state = 'out';
      toast('¡El conductor se bajó con una varilla! Córrale.', 'death');
    }
    car.driverDoor(this._door, this._doorSide);
    this._door.y = this._ground(this._door.x, this._door.z, car.position.y);
    const result = this.driver.think(dt, { player: this.player.position, door: this._door, canChase });
    if (result === 'swing') this.audio?.playWhoosh?.();
    else if (result === 'hit') this._hitPlayer();
    else if (result === 'giveup') toast('El conductor dejó de perseguirme y vuelve a su carro.', 'info');
    else if (result === 'home') this._release();
    if (this.driver.active) this.driver.update(dt, { player: this.player.position });
  }

  _hitPlayer() {
    if (!this.stats || this.stats.salud <= 0 || this.player.isStunned) return;
    if (!this.driver?.active || !canReachCombatTarget({ from: this.driver.position, to: this.player.position,
      maxDistance: ROAD_RAGE.attackRange + .35, collisions: this.collisions, getWaterInfo: this.getWaterInfo,
      toInWater: !!this.player.isSwimming })) return;
    const [min, max] = ROAD_RAGE.damage;
    const damage = Math.round(min + this.random() * (max - min));
    this.stats.salud = Math.max(0, this.stats.salud - damage);
    this.audio?.playThud?.();
    this.player.receiveHit?.(this.player.position.clone().sub(this.driver.position), 2.2, { salud: this.stats.salud });
    this.onPlayerHurt?.(damage);
    toast(`¡Me pegaron con la varilla! −${damage} de salud.`, 'death');
  }

  /** Personajes para precargar junto con los demás NPC. */
  get preloadables() { return this.driver ? [this.driver] : []; }

  serializeRoster() {
    this._remember(this.driver);
    for (const { driver } of this._fallen.values()) this._remember(driver);
    return Object.fromEntries(this._roster);
  }

  restoreRoster(data) {
    this.reset();
    this._clearFallen();
    for (const vehicle of this.traffic?.vehicles ?? []) {
      const id = driverId(vehicle.spawnOrdinal);
      if (vehicle.car.driverId === `${id}:relevo`) vehicle.car.driverId = id;
    }
    this._roster.clear();
    if (!this._driverOptions) return;
    if (this.driver?.isDead) { this.driver.dispose(); this.driver = this._createDriver(1); }
    this.driver.health = this.driver.maxHealth;
    this.driver.looted = false;
    for (const [id, record] of Object.entries(data ?? {})) {
      if (!/^conductor:[1-9]\d*$/.test(id) || !Number.isFinite(record?.health)) continue;
      const health = Math.min(this.driver.maxHealth, Math.max(0, record.health));
      const saved = { health, looted: health === 0 || !!record.looted };
      if (record.emergencyReported === true) saved.emergencyReported = true;
      if (record.emergencyAided === true) saved.emergencyAided = true;
      this._roster.set(id, saved);
      if (health) {
        if (this.driver.stableId === id) {
          this.driver.health = health;
          this.driver.looted = saved.looted;
        }
        continue;
      }
      const slot = Number(id.slice(id.indexOf(':') + 1));
      const car = this.traffic?.vehicles?.find(v => v.spawnOrdinal === slot)?.car;
      // La flota empieza en sus posiciones de circulación al cargar. Allí ya conduce el relevo.
      if (car) this._replaceDriver(car, id);
      if (!restoredPosition(record)) continue;
      const driver = this._createDriver(slot, car);
      driver.emergencyReported = !!saved.emergencyReported;
      driver.emergencyAided = !!saved.emergencyAided;
      driver.position.fromArray(record.position);
      driver.root.visible = true;
      driver.restoreDeath({ facing: record.facing, plan: record.plan });
      this._fallen.set(id, { driver, car: null });
    }
  }

  dispose() {
    this.reset();
    this.driver?.dispose();
    this.driver = null;
  }
}
