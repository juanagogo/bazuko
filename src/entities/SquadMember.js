// src/entities/SquadMember.js
// Uno de los tres de la «limpieza social»: todo de negro, pasamontañas y pistola corta. El jefe se queda
// junto a la camioneta señalando y dando la orden; los otros dos persiguen al jugador y lo cascan a
// cachazos (golpes con la pistola) tras un aviso visible. Reutiliza el personaje y el LOD de Npc.
import * as THREE from 'three';
import { Npc } from './Npc.js';
import { DEFAULT_LOOK } from '../character/look.js';

export const SQUAD = {
  chaseSpeed: 5.2,      // más rápido que caminar (3 m/s), algo más lento que correr (6 m/s)
  walkSpeed: 1.8,       // al volver a la camioneta
  attackRange: 1.4,
  windup: .4,           // levanta la pistola antes del cachazo: tiempo para zafarse
  strikeTime: .16,
  recover: .3,
  cooldown: .75,
  damage: [20, 30],     // dos matones juntos tumban a cualquiera en pocos golpes
  giveUpTime: 22,
  giveUpDistance: 32,
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

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const _dir = new THREE.Vector3();

/** Hombre de negro: buzo, botas y pasamontañas; el jefe además lleva gorra */
export function squadLook(role) {
  return {
    ...DEFAULT_LOOK,
    piel: 1 + Math.floor(Math.random() * 4),
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
  constructor(scene, { role = 'maton', ...opts } = {}) {
    super(scene, new THREE.Vector3(0, -50, 0), { ...opts, speed: SQUAD.chaseSpeed, look: squadLook(role) });
    this.role = role;
    this.state = 'idle';     // idle | order (jefe) | chase | windup | strike | recover | return
    this.timer = 0;
    this.stateTimer = 0;
    this.attackTimer = 0;
    this.shoutTimer = 0;
    this.door = new THREE.Vector3();
    this.poseParams = {};
    this.root.visible = false;
    this._lastSpokenTime = Infinity; // no charla de peatón: solo grita lo suyo
  }

  get active() { return this.state !== 'idle'; }
  get isLeader() { return this.role === 'jefe'; }

  /** Cada modelo (lejano o cercano) lleva la pistola en la mano derecha */
  _show(char) {
    char.setWeapon?.('pistola');
    super._show(char);
  }

  /** Se baja por `door` (mundo) mirando hacia `face` */
  exitCar(door, face) {
    this.door.copy(door);
    this.position.copy(door);
    this.root.position.copy(door);
    this.root.rotation.set(0, Math.atan2(face.x - door.x, face.z - door.z), 0);
    this.root.visible = true;
    this.state = this.isLeader ? 'order' : 'chase';
    this.timer = 0;
    this.attackTimer = .5;
    this.shoutTimer = this.isLeader ? .4 : 1.2 + Math.random() * 1.5;
    this.poseParams = {};
  }

  /** Vuelve a subir: desaparece de la calle. */
  enterCar() {
    this.state = 'idle';
    this.moving = false;
    this.poseParams = {};
    this.root.visible = false;
    this.position.set(0, -50, 0);
    this.root.position.copy(this.position);
    if (this._bubbleEl) { this._bubbleEl.remove(); this._bubbleEl = null; }
    this._bubbleTimer = 0;
  }

  /** Ni huye, ni suelta plata, ni queda tendido: aguanta el golpe y sigue. */
  takeHit({ damage = 10, attacker = null } = {}) {
    if (!this.active) return 0;
    this.health = Math.max(30, this.health - damage * .5);
    this.staggerTimer = .2;
    if (attacker?.position && this.state === 'return') this.state = 'chase';
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
    if (this.isWalkable(next.x, next.z)) {
      next.y = this.groundHeight(next.x, next.z);
      this.position.copy(next);
      this.moving = true;
    }
    return dist - step;
  }

  /** La IA se resuelve en think(); el Npc base no camina. */
  _walk() {}

  _shout(dt, list) {
    this.shoutTimer -= dt;
    if (this.shoutTimer > 0) return null;
    const [min, max] = SQUAD.shoutEvery;
    this.shoutTimer = min + Math.random() * (max - min);
    const line = pick(list);
    this.say(line, 2.6);
    return line;
  }

  _setAttack(phase, length) {
    this.poseParams = { attack: { weapon: 'botella_picada', step: 0, phase, progress: 1 - Math.max(0, this.stateTimer) / length } };
  }

  /**
   * Devuelve 'order' (el jefe da la orden), 'swing', 'hit', 'miss', 'giveup' o 'home' (ya subió).
   * @param {number} dt
   * @param {{ player: THREE.Vector3, canChase: boolean, recall?: boolean }} ctx recall: el jefe ordenó volver
   */
  think(dt, { player, canChase, recall = false }) {
    this.moving = false;
    if (!this.active) return null;
    this.timer += dt;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    const toPlayer = Math.hypot(player.x - this.position.x, player.z - this.position.z);

    if (this.isLeader) {
      if (this.state === 'return') return this._goHome(dt);
      if (recall) { this.state = 'return'; this.poseParams = {}; return null; }
      // de pie junto a la camioneta, señalando a la víctima
      this._face(player.x, player.z, dt, 6);
      this.poseParams = { point: this.timer > .5 ? 1 : 0 };
      return this._shout(dt, LEADER_ORDERS) ? 'order' : null;
    }

    if (this.state !== 'return' && (recall || !canChase || this.timer > SQUAD.giveUpTime || toPlayer > SQUAD.giveUpDistance)) {
      this.state = 'return';
      this.poseParams = {};
      return 'giveup';
    }
    if (this.state === 'return') return this._goHome(dt);
    if (this.staggerTimer > 0) return null;

    this._face(player.x, player.z, dt);
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
        return toPlayer <= SQUAD.attackRange + .4 ? 'hit' : 'miss';
      }
      this._setAttack('recover', SQUAD.recover);
      if (this.stateTimer <= 0) { this.state = 'chase'; this.poseParams = {}; }
      return null;
    }
    this.walkSpeed = SQUAD.chaseSpeed;
    this._shout(dt, THUG_INSULTS);
    if (toPlayer <= SQUAD.attackRange && this.attackTimer <= 0) {
      this.state = 'windup';
      this.stateTimer = SQUAD.windup;
      this._setAttack('windup', SQUAD.windup);
      return 'swing';
    }
    this._moveTowards(player, SQUAD.chaseSpeed, dt, SQUAD.attackRange * .75);
    return null;
  }

  _goHome(dt) {
    this.walkSpeed = this.isLeader ? SQUAD.walkSpeed : SQUAD.chaseSpeed * .7;
    const left = this._moveTowards(this.door, this.walkSpeed, dt, .2);
    this._face(this.door.x, this.door.z, dt, 6);
    if (left <= .3) { this.enterCar(); return 'home'; }
    return null;
  }
}
