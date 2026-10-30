// src/systems/RoadRageSystem.js
// Al robar el retrovisor de un carro en circulación, a veces el conductor frena, se baja
// con una varilla y persigue al jugador. Un solo conductor a la vez; su personaje se
// precarga durante la pantalla de carga y se reutiliza.
import * as THREE from 'three';
import { AngryDriver, ROAD_RAGE } from '../entities/AngryDriver.js';

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
    this.driver = null;
    this.traffic = null;
    this.vehicle = null;     // vehículo de tráfico detenido
    this.state = 'idle';     // idle | stopping | out
    this.stopTimer = 0;
    this.onPlayerHurt = null;
    this._door = new THREE.Vector3();
    this._people = null;
  }

  /**
   * @param {object} district distrito activo (caminable y altura del suelo)
   * @param {object} traffic sistema de tráfico
   * @param {object[]} people lista de peatones que los carros respetan
   */
  setup(district, traffic, people = null) {
    this.reset();
    this.driver?.dispose();
    this.traffic = traffic;
    this._people = people;
    this.driver = new AngryDriver(this.scene, {
      isWalkable: (x, z) => district?.isWalkableAt?.(x, z) ?? true,
      groundHeight: (x, z) => district?.getGroundHeight?.(x, z) ?? 0
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
    if (!this.active) return;
    const car = this.vehicle.car;
    if (this.state === 'stopping') {
      this.stopTimer += dt;
      if (this.vehicle.speed > .05 && this.stopTimer < ROAD_RAGE.stopTimeout) return;
      car.setDriverInside?.(false);
      this.driver.exitCar(car, car.driverDoor(this._door));
      this._people?.push(this.driver);
      this.state = 'out';
      toast('😡 ¡El conductor se bajó con una varilla! Corre (Shift).', 'death');
    }
    const result = this.driver.think(dt, { player: this.player.position, door: car.driverDoor(this._door), canChase });
    if (result === 'swing') this.audio?.playWhoosh?.();
    else if (result === 'hit') this._hitPlayer();
    else if (result === 'giveup') toast('😮‍💨 El conductor dejó de perseguirte y vuelve a su carro.', 'info');
    else if (result === 'home') this._release();
    if (this.driver.active) this.driver.update(dt, { player: this.player.position });
  }

  _hitPlayer() {
    if (!this.stats || this.stats.salud <= 0 || this.player.isStunned) return;
    const [min, max] = ROAD_RAGE.damage;
    const damage = Math.round(min + this.random() * (max - min));
    this.stats.salud = Math.max(0, this.stats.salud - damage);
    this.audio?.playThud?.();
    this.player.receiveHit?.(this.player.position.clone().sub(this.driver.position), 2.2);
    this.onPlayerHurt?.(damage);
    toast(`🩸 ¡Te pegaron con la varilla! −${damage} de salud.`, 'death');
  }

  /** Personajes para precargar junto con los demás NPC. */
  get preloadables() { return this.driver ? [this.driver] : []; }

  dispose() {
    this.reset();
    this.driver?.dispose();
    this.driver = null;
  }
}
