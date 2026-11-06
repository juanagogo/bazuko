// src/entities/RobberMember.js
// El parrillero del «robo express»: una persona de la calle del generador normal que se baja de la moto con un cuchillo
// o una pistola. Se acerca al jugador, exige, y según lo que haga el jugador se devuelve a la moto o pelea.
import * as THREE from 'three';
import { Npc } from './Npc.js';
import { canReachCombatTarget, resolveCombatWalk } from '../systems/CombatGeometry.js';

export const ROBBER = {
  walkSpeed: 3.4,        // m/s al acercarse
  runSpeed: 5.6,         // m/s al volver a la moto o al perseguir
  holdDistance: 1.5,     // m a los que se queda exigiendo
  knifeRange: 1.5,
  windup: .45,
  strikeTime: .18,
  recover: .35,
  cooldown: 1.1,
  knifeDamage: [10, 18],
  shotDamage: [22, 34],
  shotRange: 14,
  shotChance: .5,        // acierta una de cada dos
  shotEvery: 1.7,
  health: 70
};

export const DEMANDS = [
  '¡Quieto, gonorrea!',
  '¡El celular, rápido!',
  '¡Pase la plata, marica!',
  '¡Sin chistar, que lo pincho!',
  '¡Suelte el costal, parcero!',
  '¡No se me haga el loco!'
];

export const DRIVER_CALLS = [
  '¡Rápido, parcero, que viene la ley!',
  '¡Ya, ya, que me dejo!',
  '¡Apúrele que nos cogen!'
];

export const FIGHT_LINES = [
  '¡Ahora sí se murió, hijueputa!',
  '¡Se las pica de bravo, ñero!',
  '¡Venga, venga, que lo cuadro!'
];

const pick = (list, random = Math.random) => list[Math.floor(random() * list.length)];
const _dir = new THREE.Vector3();

export class RobberMember extends Npc {
  /** @param {{ weapon?: 'cuchillo' | 'pistola' }} opts el resto son las opciones normales de Npc */
  constructor(scene, { weapon = 'cuchillo', ...opts } = {}) {
    super(scene, new THREE.Vector3(0, -50, 0), { ...opts, speed: ROBBER.walkSpeed });
    this.weapon = weapon;
    this.mode = 'idle';      // idle | approach | hold | return | fight
    this.state = 'idle';     // fase del golpe en pelea: idle | windup | strike | recover
    this.stateTimer = 0;
    this.attackTimer = 0;
    this.shotTimer = 0;
    this.speakTimer = 0;
    this.poseParams = {};
    this.door = new THREE.Vector3();
    this.collisions = opts.collisions ?? null;
    this.getWaterInfo = opts.getWaterInfo ?? null;
    this.health = this.maxHealth = ROBBER.health;
    this.root.visible = false;
    this._lastSpokenTime = Infinity;
  }

  get active() { return this.mode !== 'idle'; }
  get armed() { return this.weapon; }

  _show(char) {
    char.setWeapon?.(this.weapon);
    super._show(char);
  }

  setWeapon(weapon) {
    this.weapon = weapon;
    this.character?.setWeapon?.(weapon);
    this.lodChar?.setWeapon?.(weapon);
    this.fullChar?.setWeapon?.(weapon);
  }

  /** Se baja de la moto en `point` (mundo) mirando hacia `face`. */
  dismount(point, face) {
    this.door.copy(point);
    this.position.copy(point);
    this.root.position.copy(point);
    this.root.rotation.set(0, Math.atan2(face.x - point.x, face.z - point.z), 0);
    this.root.visible = true;
    this.mode = 'approach';
    this.state = 'idle';
    this.health = ROBBER.health;
    this.attackTimer = .6;
    this.shotTimer = 1;
    this.speakTimer = .5;
    this.poseParams = {};
  }

  /** Vuelve a la moto: desaparece de la calle. */
  remount() {
    this.mode = 'idle';
    this.state = 'idle';
    this.moving = false;
    this.poseParams = {};
    this.root.visible = false;
    this.position.set(0, -50, 0);
    this.root.position.copy(this.position);
    if (this._bubbleEl) { this._bubbleEl.remove(); this._bubbleEl = null; }
    this._bubbleTimer = 0;
  }

  /** Cada golpe del jugador le quita vida y lo pone a pelear; avisa con `onHit` para que el sistema lo sepa. */
  takeHit({ damage = 10, attacker = null } = {}) {
    if (!this.active) return false;
    if (attacker?.position && !canReachCombatTarget({ from: attacker.position, to: this.position,
      collisions: this.collisions ?? attacker._lastCollisions, getWaterInfo: this.getWaterInfo,
      fromInWater: !!attacker.isSwimming })) return false;
    this.health = Math.max(0, this.health - damage);
    this.staggerTimer = .25;
    this.onHit?.(this);
    return 0;
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
    this.walkSpeed = speed;
    return Math.hypot(target.x - next.x, target.z - next.z);
  }

  canReach(player, range = ROBBER.knifeRange) {
    return canReachCombatTarget({ from: this.position, to: player, maxDistance: range,
      collisions: this.collisions, getWaterInfo: this.getWaterInfo });
  }

  /** La IA se resuelve en think(); el Npc base no camina. */
  _walk() {}

  _speak(dt, list, every = [2.2, 3.4]) {
    this.speakTimer -= dt;
    if (this.speakTimer > 0) return null;
    this.speakTimer = every[0] + Math.random() * (every[1] - every[0]);
    const line = pick(list);
    this.say(line, 2.6);
    return line;
  }

  /** El arma afuera apuntando al jugador: la pistola con el brazo estirado, el cuchillo levantado listo para clavarlo. */
  _threat() {
    return { attack: this.weapon === 'pistola'
      ? { weapon: 'cuchillo', step: 0, phase: 'active', progress: .55 }
      : { weapon: 'cuchillo', step: 0, phase: 'windup', progress: .9 } };
  }

  _setAttack(phase, length) {
    this.poseParams = { attack: { weapon: 'cuchillo', step: 0, phase, progress: 1 - Math.max(0, this.stateTimer) / length } };
  }

  /**
   * Un paso de IA. Devuelve 'demand' (soltó una exigencia), 'arrived' (ya está a la distancia de exigir), 'swing',
   * 'hit' (cuchillazo que conecta), 'miss', 'aim', 'shot' (disparo; `this.shotHit` dice si acertó) o 'home' (ya subió).
   * @param {{ player: THREE.Vector3, mode: 'approach' | 'hold' | 'return' | 'fight' }} ctx
   */
  think(dt, { player, mode }) {
    this.moving = false;
    if (!this.active || dt <= 0) return null;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    if (mode !== this.mode) { this.mode = mode; this.state = 'idle'; this.poseParams = {}; }
    const toPlayer = Math.hypot(player.x - this.position.x, player.z - this.position.z);

    if (mode === 'return') {
      const left = this._moveTowards(this.door, ROBBER.runSpeed, dt, .25);
      this._face(this.door.x, this.door.z, dt, 8);
      if (left <= .35) { this.remount(); return 'home'; }
      return null;
    }
    if (this.staggerTimer > 0) return null;
    this._face(player.x, player.z, dt);

    if (mode === 'approach') {
      const left = this._moveTowards(player, ROBBER.walkSpeed, dt, ROBBER.holdDistance);
      this.poseParams = this._threat();
      const said = this._speak(dt, DEMANDS);
      return left <= ROBBER.holdDistance + .2 ? 'arrived' : said ? 'demand' : null;
    }
    if (mode === 'hold') {
      this.poseParams = this._threat();
      return this._speak(dt, DEMANDS) ? 'demand' : null;
    }

    // pelea
    if (this.state === 'windup' || this.state === 'strike' || this.state === 'recover') {
      this.stateTimer -= dt;
      if (this.state === 'windup') {
        this._setAttack('windup', ROBBER.windup);
        if (this.stateTimer <= 0) { this.state = 'strike'; this.stateTimer = ROBBER.strikeTime; }
        return null;
      }
      if (this.state === 'strike') {
        this._setAttack('active', ROBBER.strikeTime);
        if (this.stateTimer > 0) return null;
        this.state = 'recover';
        this.stateTimer = ROBBER.recover;
        this.attackTimer = ROBBER.cooldown;
        return this.canReach(player, ROBBER.knifeRange + .4) ? 'hit' : 'miss';
      }
      this._setAttack('recover', ROBBER.recover);
      if (this.stateTimer <= 0) { this.state = 'idle'; this.poseParams = {}; }
      return null;
    }
    this._speak(dt, FIGHT_LINES, [2.8, 4]);
    if (this.weapon === 'pistola') {
      // la pistola dispara desde donde esté si no está pegado: apunta y suelta el tiro
      this.poseParams = this._threat();
      this.shotTimer = Math.max(0, this.shotTimer - dt);
      if (toPlayer > 4.5) this._moveTowards(player, ROBBER.runSpeed * .6, dt, 4);
      if (this.shotTimer <= 0 && toPlayer <= ROBBER.shotRange) {
        this.shotTimer = ROBBER.shotEvery;
        this.shotHit = Math.random() < ROBBER.shotChance;
        return 'shot';
      }
      return null;
    }
    if (this.attackTimer <= 0 && this.canReach(player)) {
      this.state = 'windup';
      this.stateTimer = ROBBER.windup;
      this._setAttack('windup', ROBBER.windup);
      return 'swing';
    }
    this._moveTowards(player, ROBBER.runSpeed, dt, ROBBER.knifeRange * .75);
    return null;
  }
}
