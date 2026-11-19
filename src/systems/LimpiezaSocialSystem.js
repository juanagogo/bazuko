// src/systems/LimpiezaSocialSystem.js
// «Limpieza social»: de noche, a veces, una camioneta 4x4 negra llega por la calle, frena junto al
// jugador y se bajan tres hombres de negro con pasamontañas y pistola. El jefe se queda señalando y
// dando la orden y los otros dos persiguen. Si cae el jefe o dejan de poder perseguir, la camioneta se retira.
import * as THREE from 'three';
import { SquadMember, SQUAD } from '../entities/SquadMember.js';
import { makeSuv, rollWheels } from '../world/bogota/suv.js';
import { canReachCombatTarget } from './CombatGeometry.js';

const toast = (text, type = 'info') => globalThis.window?.dispatchEvent?.(new CustomEvent('toast', { detail: { text, type } }));

export const LIMPIEZA = {
  checkEvery: 45,       // s de juego entre tiradas de noche
  chance: .12,          // probabilidad por tirada
  cooldown: 300,        // s mínimos entre una visita y otra
  approach: 55,         // m que recorre la camioneta antes de frenar
  leave: 70,            // m que recorre al irse antes de desaparecer
  cruise: 13,           // m/s
  braking: 7,           // m/s² (frena en seco)
  acceleration: 4,
  reach: [3, 20],       // m: distancia del carril al jugador para poder llegar
  sampleStep: 2,
  dropDelay: .6         // s entre que frena y que se abren las puertas
};

/** Recta de `length` m desde `from` en dirección `dir` (para la sala de pruebas, sin calles) */
export function straightRoute(from, dir, length = 200) {
  const d = dir.clone().setY(0).normalize();
  return {
    length, loop: false,
    sample(distance, position, direction) {
      position.copy(from).addScaledVector(d, distance).setY(0);
      direction.copy(d);
    }
  };
}

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _side = new THREE.Vector3();
const _door = new THREE.Vector3();

export class LimpiezaSocialSystem {
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
    this.members = [];
    this.outcome = null;     // victoria | escape | derrota
    this._pendingSave = null;
    this.routes = [];
    this.suv = null;
    this.state = 'idle';     // idle | arriving | stopped | out | leaving
    this.route = null;
    this.distance = 0;       // posición de la camioneta sobre la ruta
    this.stopAt = 0;
    this.speed = 0;
    this.timer = 0;
    this.checkTimer = 0;
    this._attackInterval = 0;
    this._lastAttacker = null;
    this.cooldown = LIMPIEZA.cooldown * .5;
    this.onPlayerHurt = null;
    this._people = null;
    this._ground = () => 0;
    this._frustum = new THREE.Frustum();
    this._projection = new THREE.Matrix4();
  }

  /**
   * @param {object} district distrito activo (caminable y altura del suelo)
   * @param {object[]} routes rutas de tráfico ({ length, sample(d, pos, dir) })
   * @param {object[]} people lista de peatones que los carros respetan
   */
  setup(district, routes, people = null, { collisions = null } = {}) {
    const saved = this.members.length ? this.getSaveData() : this._pendingSave;
    this.reset();
    this._disposeActors();
    this.routes = routes ?? [];
    this._people = people;
    this.collisions = collisions;
    this.getWaterInfo = (x, z) => district?.getWaterInfo?.(x, z) ?? null;
    this._ground = (x, z, currentY = 0) => district?.getMovementGroundHeight?.(x, z, currentY)
      ?? district?.getGroundHeight?.(x, z) ?? currentY;
    const opts = {
      isWalkable: (x, z) => district?.isWalkableAt?.(x, z) ?? true,
      groundHeight: this._ground, getWaterInfo: this.getWaterInfo, collisions
    };
    this.members = ['jefe', 'maton-1', 'maton-2'].map((id, i) => new SquadMember(this.scene, {
      ...opts, role: i === 0 ? 'jefe' : 'maton', stableId: 'limpieza:' + id, random: this.random
    }));
    this.suv = makeSuv();
    this.suv.group.visible = false;
    this.scene.add(this.suv.group);
    this._pendingSave = null;
    this.loadSaveData(saved);
  }

  get active() { return this.state !== 'idle'; }
  get leader() { return this.members[0]; }
  get thugs() { return this.members.slice(1); }

  _defeated() {
    return this.leader?.isDead || (this.members.some(m => m.isDead) && this.thugs.every(m => !m.isAttacking));
  }

  getSaveData() {
    if (!this.members.length && this._pendingSave) return this._pendingSave;
    let outcome = this.outcome;
    if (!outcome && this.state === 'out') {
      if (this.stats?.salud <= 0) outcome = 'derrota';
      else if (this._defeated()) outcome = 'victoria';
    }
    return {
      outcome,
      health: Object.fromEntries(this.members.filter(m => !m.isDead).map(m => [m.stableId, m.health])),
      fallen: this.members.filter(m => m.isDead).map(m => ({
        id: m.stableId, position: m.position.toArray(), yaw: m._fallYaw, plan: m._koPlan, from: m._koFrom, bodyReleased: m.bodyReleased,
        emergencyReported: !!m.emergencyReported, emergencyAided: !!m.emergencyAided
      }))
    };
  }

  loadSaveData(data) {
    if (!data || typeof data !== 'object') return;
    if (!this.members.length) { this._pendingSave = data; return; }
    const fallen = Array.isArray(data.fallen) ? data.fallen : [];
    for (const m of this.members) {
      if (m.isDead) continue;
      const saved = fallen.find(entry => entry?.id === m.stableId);
      if (!saved) {
        const health = data.health?.[m.stableId];
        if (Number.isFinite(health) && health > 0) m.health = Math.min(health, m.maxHealth);
        continue;
      }
      const hasPosition = Array.isArray(saved.position) && saved.position.length === 3 && saved.position.every(Number.isFinite);
      if (hasPosition) m.position.fromArray(saved.position);
      m.restoreDeath({ facing: saved.yaw, plan: saved.plan, from: saved.from });
      m.emergencyReported = saved.emergencyReported === true;
      m.emergencyAided = saved.emergencyAided === true;
      if (!hasPosition || saved.bodyReleased === true) m.dispose();
    }
    this.outcome = ['victoria', 'derrota', 'escape'].includes(data.outcome) ? data.outcome : null;
    // Puede guardarse desde el propio impacto, antes del siguiente paso de la camioneta.
    if (!this.outcome && (this.leader.isDead || this.thugs.every(m => m.isDead))) this.outcome = 'victoria';
  }

  /** Busca un tramo de calle cerca del jugador y manda la camioneta. Devuelve true si viene. */
  trigger() {
    if (this.active || !this.suv || !this.members.length || this.outcome === 'victoria'
      || this.members.some(m => m.state === 'surrendered')) return false;
    const target = this.player.position;
    let best = null;
    for (const route of this.routes) {
      for (let d = 0; d < route.length; d += LIMPIEZA.sampleStep) {
        route.sample(d, _p, _d);
        const dist = Math.hypot(_p.x - target.x, _p.z - target.z);
        if (dist < LIMPIEZA.reach[0] || dist > LIMPIEZA.reach[1]) continue;
        if (!best || dist < best.dist) best = { route, d, dist };
      }
    }
    if (!best) return false;
    const { route, d } = best;
    // recta (sala): arranca desde atrás sin pasarse del inicio
    this.route = route;
    this.stopAt = d;
    this.distance = route.loop === false ? Math.max(0, d - LIMPIEZA.approach) : d - LIMPIEZA.approach;
    this.speed = LIMPIEZA.cruise;
    this.state = 'arriving';
    this.outcome = null;
    this.timer = 0;
    this.cooldown = LIMPIEZA.cooldown;
    this.suv.group.visible = true;
    this.suv.setLights(true);
    this._place();
    return true;
  }

  _place() {
    this.route.sample(this.distance, _p, _d);
    const g = this.suv.group;
    g.position.set(_p.x, 0, _p.z); // los carriles van a nivel de calle, como el tráfico
    g.rotation.set(0, Math.atan2(-_d.z, _d.x), 0); // el frente es +X local
    g.updateMatrixWorld();
  }

  /** Puerta `i` en el mundo: 0 el jefe (copiloto, a la derecha), 1 y 2 las de atrás */
  _doorPoint(i, target) {
    const { length, width } = this.suv;
    const local = [[.45, width / 2 + .6], [-.75, width / 2 + .6], [-.75, -(width / 2 + .6)]][i];
    _side.set(local[0] * length / 5, 0, local[1]);
    target.copy(_side).applyMatrix4(this.suv.group.matrixWorld);
    target.y = this._ground(target.x, target.z, target.y);
    return target;
  }

  /** La recuperación hace volver a los sobrevivientes. Las bajas conservan su lugar en la calle. */
  reset() {
    for (const m of this.members) if (m.active || m.state === 'surrendered') m.enterCar();
    this._park();
  }

  _park() {
    this._removePeople();
    if (this.suv) this.suv.group.visible = false;
    this.state = 'idle';
    this.route = null;
    this.speed = 0;
  }

  _removePeople() {
    if (!this._people) return;
    for (const m of this.members) {
      const index = this._people.indexOf(m);
      if (index >= 0) this._people.splice(index, 1);
    }
  }

  /**
   * @param {number} dt
   * @param {{ canChase?: boolean, isNight?: boolean, allowSpawn?: boolean, camera?: THREE.Camera }} ctx
   *   canChase = false durante la muerte o el sueño; camera ubica los globos de lo que gritan
   */
  update(dt, { canChase = true, isNight = false, allowSpawn = true, camera = null, drawDistance } = {}) {
    // en pausa no se anima: el mezclador no reescribe huesos quietos y las poses sumadas se acumularían
    if (dt <= 0) return;
    if (!this.active) {
      this._updateMembers(dt, camera, drawDistance);
      if (this.outcome === 'victoria') return;
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (!isNight || !allowSpawn || this.cooldown > 0) return;
      this.checkTimer += dt;
      if (this.checkTimer < LIMPIEZA.checkEvery) return;
      this.checkTimer = 0;
      if (this.random() < LIMPIEZA.chance) this.trigger();
      return;
    }
    this.timer += dt;
    if (this.state === 'arriving') this._arrive(dt);
    else if (this.state === 'stopped') {
      if (this.timer >= LIMPIEZA.dropDelay) this._dropOff();
    } else if (this.state === 'out') this._hunt(dt, canChase);
    else if (this.state === 'leaving') this._leave(dt);
    this._updateMembers(dt, camera, drawDistance);
  }

  _updateMembers(dt, camera, drawDistance) {
    let frustum;
    for (const m of this.members) {
      if (m._disposed || (!m.active && !m.isDead && m.state !== 'surrendered')) continue;
      if (camera?.projectionMatrix && !frustum) {
        frustum = this._frustum.setFromProjectionMatrix(this._projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      }
      m.update(dt, { player: this.player.position, camera, frustum, drawDistance, releaseDeadBody: true });
      if (m.state === 'surrendered' && m.position.distanceTo(this.player.position) > 20
        && (frustum ? !m.root.visible : m.position.distanceTo(this.player.position) > 40)) m.enterCar();
    }
  }

  _arrive(dt) {
    const left = this.stopAt - this.distance;
    // frena para quedar justo al lado; si el jugador está en el carril, frena antes de pisarlo
    const nose = this.suv.length / 2 + 1.2;
    this.route.sample(this.distance, _p, _d);
    const ahead = (this.player.position.x - _p.x) * _d.x + (this.player.position.z - _p.z) * _d.z;
    const lateral = Math.abs((this.player.position.x - _p.x) * _d.z - (this.player.position.z - _p.z) * _d.x);
    const blocked = lateral < this.suv.width / 2 + .6 && ahead > 0 && ahead < nose + 3;
    const stopDistance = this.speed ** 2 / (2 * LIMPIEZA.braking);
    const braking = blocked || left <= stopDistance + .5;
    this.speed = braking
      ? Math.max(0, this.speed - LIMPIEZA.braking * (blocked ? 2 : 1) * dt)
      : Math.min(LIMPIEZA.cruise, this.speed + LIMPIEZA.acceleration * dt);
    if (left < .05 || (blocked && this.speed < .3)) this.speed = 0;
    const step = Math.min(this.speed * dt, Math.max(0, left));
    this.distance += step;
    rollWheels(this.suv, step);
    this.suv.setBraking(braking);
    this._place();
    if (this.speed === 0 || this.distance >= this.stopAt - .05) {
      this.speed = 0;
      this.state = 'stopped';
      this.timer = 0;
      this.audio?.playThud?.();
    }
  }

  _dropOff() {
    this._attackInterval = 0;
    this._lastAttacker = null;
    this.members.forEach((m, i) => {
      if (m.isDead) return;
      m.exitCar(this._doorPoint(i, _door), this.player.position);
      if (this._people && !this._people.includes(m)) this._people.push(m);
    });
    this.leader.say('¡Ese es! ¡Cásquenlo!', 3);
    this.state = 'out';
    this.timer = 0;
    toast('Una camioneta negra frenó en seco: limpieza social. Córrale y no se deje alcanzar.', 'warn');
  }

  _hunt(dt, canChase) {
    const player = this.player.position;
    const thugs = this.thugs;
    if (this.stats?.salud <= 0) this._resolve('derrota');
    else if (this._defeated()) this._resolve('victoria');
    else if (!canChase) this._resolve('escape', false);
    this._attackInterval = Math.max(0, this._attackInterval - dt);
    if (this._lastAttacker === thugs[0]) thugs.reverse();
    let canSwing = this._attackInterval <= 0 && !thugs.some(m => m.state === 'windup' || m.state === 'strike');
    for (const m of thugs) {
      if (!m.active) continue;
      const result = m.think(dt, { player, canChase, canSwing });
      if (result === 'swing') {
        canSwing = false;
        this._lastAttacker = m;
        this._attackInterval = SQUAD.groupInterval;
        this.audio?.playWhoosh?.();
      }
      else if (result === 'hit') this._hitPlayer(m);
    }
    if (thugs.every(m => !m.isAttacking)) this._resolve(thugs.some(m => m.isDead) ? 'victoria' : 'escape', canChase);
    if (this.leader.active) this.leader.think(dt, { player, canChase });
    if (this.members.every(m => !m.active)) {
      this._removePeople();
      this.state = 'leaving';
      this.timer = 0;
    }
  }

  _resolve(outcome, canChase = true) {
    if (this.outcome || this.state !== 'out') return;
    this.outcome = outcome;
    // Cancela incluso un ataque que se encontraba ya en el cuadro de contacto.
    for (const member of this.members) member.retreat();
    if (outcome === 'victoria') toast('Vencí a los de la camioneta. Se acabó la persecución.', 'info');
    else if (outcome === 'escape') toast(canChase ? 'Se cansaron de perseguirte y vuelven a la camioneta.' : 'Se devuelven a la camioneta.', 'info');
    globalThis.window?.dispatchEvent?.(new CustomEvent('limpieza-outcome', { detail: { system: this, outcome } }));
  }

  _leave(dt) {
    this.speed = Math.min(LIMPIEZA.cruise * 1.2, this.speed + LIMPIEZA.acceleration * 1.5 * dt);
    const step = this.speed * dt;
    this.distance += step;
    rollWheels(this.suv, step);
    this.suv.setBraking(false);
    this._place();
    if (this.distance - this.stopAt > LIMPIEZA.leave || (this.route.loop === false && this.distance >= this.route.length)) this._park();
  }

  _hitPlayer(member) {
    if (!this.stats || this.stats.salud <= 0 || this.outcome) return;
    if (this.player.isRagdollActive) return; // ya está en el piso: el siguiente golpe es cuando se pare
    if (!member?.active || member.isAttacking === false || !canReachCombatTarget({ from: member.position, to: this.player.position,
      maxDistance: SQUAD.attackRange + .4, collisions: this.collisions, getWaterInfo: this.getWaterInfo,
      toInWater: !!this.player.isSwimming })) return;
    const [min, max] = SQUAD.damage;
    const previousHealth = this.stats.salud;
    const damage = Math.min(previousHealth, Math.round(min + this.random() * (max - min)));
    this.stats.salud = previousHealth - damage;
    this.audio?.playThud?.();
    // a diferencia del conductor, siguen pegando aunque esté tambaleando
    this.player.receiveHit?.(this.player.position.clone().sub(member.position), 1.6, { salud: this.stats.salud });
    this.onPlayerHurt?.(damage);
    const { x, y, z } = this.player.position;
    globalThis.window?.dispatchEvent?.(new CustomEvent('npc-player-hit', { detail: { attacker: member, victim: this.player,
      previousHealth, health: this.stats.salud, damage, weapon: 'pistola', position: { x, y, z } } }));
    toast(`Me dieron un cachazo: −${damage} de salud.`, 'death');
    if (this.stats.salud <= 0) this._resolve('derrota');
  }

  /** Personajes para precargar junto con los demás NPC. */
  get preloadables() { return this.members.filter(m => !m._disposed); }

  _disposeActors() {
    for (const m of this.members) m.dispose();
    this.members = [];
    this.suv?.dispose();
    this.suv = null;
  }

  dispose() {
    this.reset();
    this._disposeActors();
  }
}
