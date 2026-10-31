// src/entities/AngryDriver.js
// Conductor al que le robaron el retrovisor: se baja con una varilla, persigue al jugador
// y lo golpea tras un aviso visible (levanta la varilla). Reutiliza el personaje y LOD de Npc.
import * as THREE from 'three';
import { Npc } from './Npc.js';

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
  stopTimeout: 10       // respaldo si el carro no logra detenerse (frenar desde crucero tarda ~6 s)
};

const _dir = new THREE.Vector3();

export class AngryDriver extends Npc {
  /**
   * @param {THREE.Scene} scene
   * @param {{ isWalkable?: (x:number, z:number) => boolean, groundHeight?: (x:number, z:number) => number }} opts
   */
  constructor(scene, opts = {}) {
    super(scene, new THREE.Vector3(0, -50, 0), { ...opts, speed: ROAD_RAGE.chaseSpeed });
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
    pivot.position.set(-.26, .95, .08);
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
    if (this.isWalkable(next.x, next.z)) {
      next.y = this.groundHeight(next.x, next.z);
      this.position.copy(next);
      this.moving = true;
    }
    return dist - step;
  }

  /** La IA se resuelve en think(); aquí solo se anima la varilla. */
  _walk(dt) {
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
    if (!this.active) return null;
    this.timer += dt;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    const toPlayer = Math.hypot(player.x - this.position.x, player.z - this.position.z);
    if (this.state !== 'return' && (!canChase || this.timer > ROAD_RAGE.giveUpTime || toPlayer > ROAD_RAGE.giveUpDistance)) {
      this.state = 'return';
      this.action = null;
      return 'giveup';
    }
    if (this.state === 'return') {
      this.walkSpeed = ROAD_RAGE.walkSpeed;
      const left = this._moveTowards(door, ROAD_RAGE.walkSpeed, dt, .25);
      this._face(door.x, door.z, dt, 6);
      if (left <= .3) { this.enterCar(); return 'home'; }
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
      return toPlayer <= ROAD_RAGE.attackRange + .35 ? 'hit' : 'miss';
    }
    if (toPlayer <= ROAD_RAGE.attackRange && this.attackTimer <= 0) {
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
