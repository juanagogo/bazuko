// src/entities/AngryDriver.js
// Conductor al que le robaron el retrovisor: se baja con una varilla, persigue al jugador
// y lo golpea tras un aviso visible (levanta la varilla). Reutiliza el personaje y LOD de Npc.
import * as THREE from 'three';
import { Npc } from './Npc.js';
import { canReachCombatTarget, resolveCombatWalk } from '../systems/CombatGeometry.js';
import { koHandDown, smooth } from '../character/BodyLanguage.js';

export const ROAD_RAGE = {
  chance: .35,          // probabilidad de bajarse al robarle un retrovisor en circulación
  chaseSpeed: 4.4,      // más rápido que caminar (3 m/s), más lento que correr (6 m/s)
  walkSpeed: 1.6,       // al volver a su carro
  attackRange: 1.5,
  windup: .45,          // la varilla se levanta antes de golpear: tiempo para esquivar
  strikeTime: .18,
  cooldown: 1.4,
  damage: [10, 16],
  giveUpTime: 18,
  giveUpDistance: 28,
  returnTimeout: 30,    // respaldo si una caja le corta el regreso: 28 m a pie son unos 18 s
  stopTimeout: 10       // respaldo si el carro no logra detenerse (frenar desde crucero tarda ~6 s)
};

// La varilla colgando a un lado, y en el piso a lo largo del cuerpo, donde apoya la mano al pararse.
const _barHanging = { x: -.26, y: .95, z: .08, tilt: -.35 };
const BAR_LIES = { x: -.36, y: .03, z: 0, tilt: Math.PI / 2 };
const BAR_LENGTH = .895; // de la mano a la punta
const BAR_FALLS_BY = .55; // de la caída: ya tocó el piso cuando el cuerpo sigue bajando

const _dir = new THREE.Vector3();

export class AngryDriver extends Npc {
  /**
   * @param {THREE.Scene} scene
   * @param {{ isWalkable?: (x:number, z:number) => boolean, groundHeight?: (x:number, z:number) => number }} opts
   */
  constructor(scene, opts = {}) {
    super(scene, new THREE.Vector3(0, -50, 0), { ...opts, speed: ROAD_RAGE.chaseSpeed });
    this.collisions = opts.collisions ?? null;
    this.getWaterInfo = opts.getWaterInfo ?? null;
    this.state = 'idle';     // idle | chase | windup | strike | return
    this.car = null;
    this.timer = 0;
    this.attackTimer = 0;
    this.action = null;
    this.root.visible = false;
    this.bar = this._createBar();
    this.root.add(this.bar.pivot);
  }

  get active() { return this.state !== 'idle'; }

  /** Varilla metálica sujeta a la mano derecha; su giro marca el aviso y el golpe. */
  _createBar() {
    const pivot = new THREE.Group();
    pivot.name = 'Varilla';
    const geometry = new THREE.CylinderGeometry(.018, .018, .95, 8);
    geometry.translate(0, -.42, 0); // la mano sujeta un extremo
    const material = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: .85, roughness: .35 });
    const rod = new THREE.Mesh(geometry, material);
    rod.castShadow = true;
    pivot.add(rod);
    // Frente del Npc hacia +Z local: la derecha queda en −X.
    pivot.position.set(_barHanging.x, _barHanging.y, _barHanging.z);
    return { pivot, geometry, material, pose: 0 };
  }

  /** Se baja junto a la puerta de su carro y empieza a perseguir. */
  exitCar(car, door) {
    this.car = car;
    this.position.copy(door);
    this.root.position.copy(door);
    this.root.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.root.visible = true;
    this.state = 'chase';
    this.timer = 0;
    this.attackTimer = .6;
    this.action = null;
  }

  /** Vuelve a subir: desaparece de la calle. */
  enterCar() {
    this.state = 'idle';
    this.action = null;
    this.moving = false;
    this.root.visible = false;
    this.position.set(0, -50, 0);
    this.root.position.copy(this.position);
  }

  _face(x, z, dt, rate = 10) {
    let diff = Math.atan2(x - this.position.x, z - this.position.z) - this.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.root.rotation.y += diff * Math.min(1, dt * rate);
  }

  _moveTowards(target, speed, dt, stop) {
    _dir.copy(target).sub(this.position).setY(0);
    const dist = _dir.length();
    if (dist <= stop) return dist;
    _dir.multiplyScalar(1 / dist);
    const step = Math.min(dist - stop, speed * dt);
    const next = this._nextPosition.copy(this.position).addScaledVector(_dir, step);
    resolveCombatWalk({ from: this.position, to: next, groundHeight: this.groundHeight,
      isWalkable: this.isWalkable, getWaterInfo: this.getWaterInfo, collisions: this.collisions }, next);
    this.moving = this.position.distanceToSquared(next) > 1e-10;
    this.position.copy(next);
    return Math.hypot(target.x - next.x, target.z - next.z);
  }

  canReach(player, range = ROAD_RAGE.attackRange) {
    return canReachCombatTarget({ from: this.position, to: player, maxDistance: range,
      collisions: this.collisions, getWaterInfo: this.getWaterInfo });
  }

  /** Se le cae la varilla: lo que traía en el aire se le suelta desde donde estaba. */
  _startKnockout(bench) {
    super._startKnockout(bench);
    this.bar.pose = 0;
    this._barFrom = { x: this.bar.pivot.position.x, y: this.bar.pivot.position.y, z: this.bar.pivot.position.z, tilt: this.bar.pivot.rotation.x };
  }

  /** Noqueado no corre `_walk`: la varilla cae con él y la recoge cuando la mano llega al piso. */
  _updateReaction(dt) {
    super._updateReaction(dt);
    if (!this._barFrom) return;
    const pivot = this.bar.pivot, ko = smooth(this._koBlend);
    const rising = this.koState === 'rising' || !this.koState;
    const from = rising ? _barHanging : this._barFrom;
    const k = this.koState ? smooth(Math.min(1, rising ? ko / (1 - koHandDown(this._koPlan)) : this._koBlend / BAR_FALLS_BY)) : 0;
    const tilt = from.tilt + (BAR_LIES.tilt - from.tilt) * k;
    // La punta de abajo se apoya en el piso mientras gira: el extremo de la mano es el que baja y sube.
    const y = Math.max(from.y + (BAR_LIES.y - from.y) * k, BAR_LIES.y + BAR_LENGTH * Math.cos(tilt));
    pivot.position.set(from.x + (BAR_LIES.x - from.x) * k, y, from.z + (BAR_LIES.z - from.z) * k);
    pivot.rotation.x = tilt;
    if (!this.koState) this._barFrom = null;
  }

  /** La IA se resuelve en think(); aquí solo se anima la varilla. */
  _walk(dt) {
    this.fleeTimer = 0; // lo que corre es think(): el golpe que recibe no lo pone a huir
    const target = { windup: 1, strike: -1 }[this.state] ?? 0;
    const bar = this.bar;
    bar.pose += (target - bar.pose) * Math.min(1, dt * (this.state === 'strike' ? 28 : 9));
    // 0: colgando a un lado · 1: levantada detrás de la cabeza · −1: golpe hacia delante.
    bar.pivot.rotation.x = bar.pose >= 0 ? -.35 + bar.pose * 2.9 : -.35 + bar.pose * .95;
    bar.pivot.position.y = .95 + Math.abs(bar.pose) * .55;
  }

  /**
   * Decide persecución, golpe o regreso. Devuelve 'hit' cuando un golpe conecta y
   * 'home' cuando ya volvió a subirse al carro.
   * @param {number} dt
   * @param {{ player: THREE.Vector3, door: THREE.Vector3, canChase: boolean }} ctx
   */
  think(dt, { player, door, canChase }) {
    this.moving = false;
    if (!this.active || dt <= 0) return null;
    if (this.koState) {
      // Noqueado no piensa: ni corre el reloj, ni gira, ni termina el golpe que traía.
      if (this.state === 'windup' || this.state === 'strike') { this.state = 'chase'; this.action = null; }
      return null;
    }
    this.timer += dt;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    const toPlayer = Math.hypot(player.x - this.position.x, player.z - this.position.z);
    if (this.state !== 'return' && (!canChase || this.timer > ROAD_RAGE.giveUpTime || toPlayer > ROAD_RAGE.giveUpDistance)) {
      this.state = 'return';
      this.timer = 0;
      this.action = null;
      return 'giveup';
    }
    if (this.state === 'return') {
      this.walkSpeed = ROAD_RAGE.walkSpeed;
      const left = this._moveTowards(door, ROAD_RAGE.walkSpeed, dt, .25);
      this._face(door.x, door.z, dt, 6);
      // Camina en línea recta: si no llega, sube igual para que su carro no quede parado para siempre.
      if (left <= .3 || this.timer > ROAD_RAGE.returnTimeout) { this.enterCar(); return 'home'; }
      return null;
    }
    this.walkSpeed = ROAD_RAGE.chaseSpeed;
    this._face(player.x, player.z, dt);
    if (this.state === 'windup') {
      this.windupTimer -= dt;
      if (this.windupTimer <= 0) { this.state = 'strike'; this.strikeTimer = ROAD_RAGE.strikeTime; }
      return null;
    }
    if (this.state === 'strike') {
      this.strikeTimer -= dt;
      if (this.strikeTimer > 0) return null;
      this.state = 'chase';
      this.action = null;
      this.attackTimer = ROAD_RAGE.cooldown;
      // Solo conecta si el jugador sigue al alcance al bajar la varilla.
      return this.canReach(player, ROAD_RAGE.attackRange + .35) ? 'hit' : 'miss';
    }
    if (this.attackTimer <= 0 && this.canReach(player)) {
      this.state = 'windup';
      this.windupTimer = ROAD_RAGE.windup;
      this.action = 'lanzar';
      return 'swing';
    }
    this._moveTowards(player, ROAD_RAGE.chaseSpeed, dt, ROAD_RAGE.attackRange * .8);
    return null;
  }

  dispose() {
    this.bar.geometry.dispose();
    this.bar.material.dispose();
    super.dispose();
  }
}
