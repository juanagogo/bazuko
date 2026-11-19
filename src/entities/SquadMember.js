// src/entities/SquadMember.js
// Uno de los tres de la «limpieza social»: todo de negro, pasamontañas y pistola corta. El jefe se queda
// junto a la camioneta señalando y dando la orden; los otros dos persiguen al jugador y lo cascan a
// cachazos (golpes con la pistola) tras un aviso visible. Reutiliza el personaje y el LOD de Npc.
import * as THREE from 'three';
import { Npc } from './Npc.js';
import { DEFAULT_LOOK } from '../character/look.js';
import { canReachCombatTarget, resolveCombatWalk } from '../systems/CombatGeometry.js';

export const SQUAD = {
  chaseSpeed: 5.2,      // más rápido que caminar (3 m/s), algo más lento que correr (6 m/s)
  walkSpeed: 1.8,       // al volver a la camioneta
  attackRange: 1.4,
  windup: .4,           // levanta la pistola antes del cachazo: tiempo para zafarse
  strikeTime: .16,
  recover: .3,
  cooldown: .75,
  groupInterval: 1.9,   // los dos persiguen; dejan ver el cachazo de cada compañero antes de empezar el suyo
  damage: [20, 30],     // dos matones juntos tumban a cualquiera en pocos golpes
  giveUpTime: 22,
  giveUpDistance: 32,
  returnTimeout: 18,    // un sobreviviente bloqueado se rinde y la camioneta puede irse
  shoutEvery: [2.6, 4.2]
};

export const LEADER_ORDERS = [
  '¡Ese es! ¡Cásquenlo!',
  '¡Denle a ese chirrete hijueputa!',
  '¡Limpien la calle, muchachos!',
  '¡Que no se les vuele ese ñero!',
  '¡Denle duro, que aquí no queremos viciosos!',
  '¡Rápido, que esto no se puede ver!'
];

export const THUG_INSULTS = [
  '¡Chirrete hijueputa!',
  '¡Venga pa\' acá, chirrete hijueputa!',
  '¡Venga pa\' acá, gonorrea!',
  '¡Quieto, malparido!',
  '¡Se le acabó la vagancia, ñero!',
  '¡Corra, corra, que igual lo cogemos!',
  '¡Hijueputa, no se me esconda!',
  '¡Usted aquí sobra, pirobo!'
];

const pick = (list, random) => list[Math.floor(random() * list.length)];
const _dir = new THREE.Vector3();

/** Hombre de negro: buzo, botas y pasamontañas; el jefe además lleva gorra */
export function squadLook(role, random = Math.random) {
  return {
    ...DEFAULT_LOOK,
    piel: 1 + Math.floor(random() * 4),
    desgaste: 0,
    uniforme: '#161618',
    accesorios: role === 'jefe' ? ['pasamontanas', 'gorra'] : ['pasamontanas'],
    real: { sexo: 'hombre', edad: 'adulto', pelo: 'calvo', barba: 'ninguna', ropa: 'buzo', calzado: 'botas', cabeza: 'sin-sombrero' }
  };
}

export class SquadMember extends Npc {
  /**
   * @param {THREE.Scene} scene
   * @param {{ role?: 'jefe' | 'maton', isWalkable?: (x:number, z:number) => boolean, groundHeight?: (x:number, z:number) => number }} opts
   */
  constructor(scene, { role = 'maton', stableId = null, random = Math.random, ...opts } = {}) {
    super(scene, new THREE.Vector3(0, -50, 0), { ...opts, speed: SQUAD.chaseSpeed, look: squadLook(role, random) });
    this.stableId = stableId;
    this.random = random;
    this.collisions = opts.collisions ?? null;
    this.getWaterInfo = opts.getWaterInfo ?? null;
    this.role = role;
    this.state = 'idle';     // idle | order | chase | windup | strike | recover | return | surrendered | dead
    this.timer = 0;
    this.stateTimer = 0;
    this.attackTimer = 0;
    this.shoutTimer = 0;
    this.door = new THREE.Vector3();
    this.poseParams = {};
    this.root.visible = false;
    this._lastSpokenTime = Infinity; // no charla de peatón: solo grita lo suyo
  }

  get active() { return !this.isDead && this.state !== 'idle' && this.state !== 'surrendered'; }
  get isLeader() { return this.role === 'jefe'; }
  get isAggressor() { return this.state !== 'idle'; }
  get isAttacking() { return this.active && this.state !== 'return'; }
  get canReceiveMeleeHit() { return this.isAttacking; }

  /** Cada modelo (lejano o cercano) lleva la pistola en la mano derecha */
  _show(char) {
    char.setWeapon?.(this.state === 'surrendered' ? null : 'pistola');
    super._show(char);
  }

  /** Se baja por `door` (mundo) mirando hacia `face` */
  exitCar(door, face) {
    if (this.isDead) return;
    this.door.copy(door);
    this.position.copy(door);
    this.root.position.copy(door);
    this.root.rotation.set(0, Math.atan2(face.x - door.x, face.z - door.z), 0);
    this.root.visible = true;
    this.state = this.isLeader ? 'order' : 'chase';
    this.character?.setWeapon?.('pistola');
    this.timer = 0;
    this.attackTimer = .5;
    this.shoutTimer = this.isLeader ? .4 : 1.2 + this.random() * 1.5;
    this.staggerTimer = 0;
    this.poseParams = {};
  }

  /** Vuelve a subir: desaparece de la calle. */
  enterCar() {
    if (this.isDead) return;
    this.limpiarImpacto();
    this.state = 'idle';
    this.moving = false;
    this.poseParams = {};
    this.root.visible = false;
    this.position.set(0, -50, 0);
    this.root.position.copy(this.position);
    if (this._bubbleEl) { this._bubbleEl.remove(); this._bubbleEl = null; }
    this._bubbleTimer = 0;
  }

  /** Cada contacto válido del combate conserva su daño y devuelve cero de botín. */
  takeHit({ damage = 10, attacker = null, dir = null, knockback = 0, weapon = 'punos', attackId = null, id = null } = {}) {
    if (!this.isAttacking || this._disposed || !Number.isFinite(damage) || damage <= 0) return false;
    if (attacker?.position && !canReachCombatTarget({ from: attacker.position, to: this.position,
      collisions: this.collisions ?? attacker._lastCollisions, getWaterInfo: this.getWaterInfo,
      fromInWater: !!attacker.isSwimming })) return false;
    if (!this._acceptAttackId(attacker, attackId ?? id)) return false;
    const previousHealth = this.health;
    this.health = Math.max(0, previousHealth - damage);
    const push = dir ?? (attacker?.position && _dir.subVectors(this.position, attacker.position));
    if (push && Number.isFinite(push.x) && Number.isFinite(push.z) && Math.hypot(push.x, push.z) > .0001) {
      this._lastHit.set(push.x, 0, push.z).normalize();
    }
    this.hitBy = attacker;
    this.staggerTimer = .2;
    this.moving = false;
    this.poseParams = {};
    if (this.health === 0) {
      this.state = 'dead';
      this._dieFromHit({ attacker, weapon, attackId: attackId ?? id, previousHealth, wasAggressor: true });
      return 0;
    }
    this._inclinarGolpe(this._lastHit, knockback);
    this.state = this.isLeader ? 'order' : 'chase';
    if (this._bubbleTimer <= 0) this.say('¡Ah, se las pica de bravo! ¡Ahora sí lo matamos!', 3);
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
    return Math.hypot(target.x - next.x, target.z - next.z);
  }

  canReach(player, range = SQUAD.attackRange, checkFacing = false) {
    if (checkFacing) {
      const dx = player.x - this.position.x, dz = player.z - this.position.z, distance = Math.hypot(dx, dz);
      const yaw = this.root.rotation.y;
      if (distance > .001 && (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance < .3) return false;
    }
    return canReachCombatTarget({ from: this.position, to: player, maxDistance: range,
      collisions: this.collisions, getWaterInfo: this.getWaterInfo });
  }

  /** La IA se resuelve en think(); el Npc base no camina. */
  _walk() {}

  _shout(dt, list) {
    this.shoutTimer -= dt;
    if (this.shoutTimer > 0) return null;
    const [min, max] = SQUAD.shoutEvery;
    this.shoutTimer = min + this.random() * (max - min);
    const line = pick(list, this.random);
    this.say(line, 2.6);
    return line;
  }

  _setAttack(phase, length) {
    this.poseParams = { attack: { weapon: 'botella_picada', step: 0, phase, progress: 1 - Math.max(0, this.stateTimer) / length } };
  }

  /**
   * Devuelve 'order' (el jefe da la orden), 'swing', 'hit', 'miss', 'giveup' o 'home' (ya subió).
   * @param {number} dt
   * @param {{ player: THREE.Vector3, canChase: boolean, recall?: boolean, canSwing?: boolean }} ctx
   */
  think(dt, { player, canChase, recall = false, canSwing = true }) {
    dt = this.tiempoTrasImpacto(dt);
    if (dt <= 0) return null;
    this.moving = false;
    if (!this.active) return null;
    this.timer += dt;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    const toPlayer = Math.hypot(player.x - this.position.x, player.z - this.position.z);

    if (this.state === 'return') return this._goHome(dt);
    if (recall || (!this.isLeader && (!canChase || this.timer > SQUAD.giveUpTime || toPlayer > SQUAD.giveUpDistance))) {
      this.retreat();
      return 'giveup';
    }
    if (this.staggerTimer > 0) return null;
    if (this.isLeader) {
      // de pie junto a la camioneta, señalando a la víctima
      this._face(player.x, player.z, dt, 6);
      this.poseParams = { point: this.timer > .5 ? 1 : 0 };
      return this._shout(dt, LEADER_ORDERS) ? 'order' : null;
    }

    if (this.state === 'chase' || (this.state === 'windup' && this.stateTimer > SQUAD.windup * .5)) {
      this._face(player.x, player.z, dt);
    }
    if (this.state === 'windup' || this.state === 'strike' || this.state === 'recover') {
      this.stateTimer -= dt;
      if (this.state === 'windup') {
        this._setAttack('windup', SQUAD.windup);
        if (this.stateTimer <= 0) { this.state = 'strike'; this.stateTimer = SQUAD.strikeTime; }
        return null;
      }
      if (this.state === 'strike') {
        this._setAttack('active', SQUAD.strikeTime);
        if (this.stateTimer > 0) return null;
        this.state = 'recover';
        this.stateTimer = SQUAD.recover;
        this.attackTimer = SQUAD.cooldown;
        // solo conecta si el jugador sigue al alcance al bajar la pistola
        return this.canReach(player, SQUAD.attackRange + .4, true) ? 'hit' : 'miss';
      }
      this._setAttack('recover', SQUAD.recover);
      if (this.stateTimer <= 0) { this.state = 'chase'; this.poseParams = {}; }
      return null;
    }
    this.walkSpeed = SQUAD.chaseSpeed;
    this._shout(dt, THUG_INSULTS);
    if (this.canReach(player)) {
      if (!canSwing || this.attackTimer > 0) {
        this.poseParams = { combatGuard: true };
        return null;
      }
      this.state = 'windup';
      this.stateTimer = SQUAD.windup;
      this._setAttack('windup', SQUAD.windup);
      return 'swing';
    }
    this.poseParams = {};
    this._moveTowards(player, SQUAD.chaseSpeed, dt, SQUAD.attackRange * .75);
    return null;
  }

  retreat() {
    if (!this.isAttacking) return;
    this.state = 'return';
    this.stateTimer = SQUAD.returnTimeout;
    this.moving = false;
    this.poseParams = {};
  }

  _goHome(dt) {
    this.walkSpeed = this.isLeader ? SQUAD.walkSpeed : SQUAD.chaseSpeed * .7;
    const left = this._moveTowards(this.door, this.walkSpeed, dt, .2);
    this._face(this.door.x, this.door.z, dt, 6);
    if (left <= .3) { this.enterCar(); return 'home'; }
    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.state = 'surrendered';
      this.moving = false;
      this.poseParams = { stance: 'acurrucado' };
      this.character?.setWeapon?.(null);
      return 'surrendered';
    }
    return null;
  }
}
