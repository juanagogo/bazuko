// src/systems/LimpiezaSocialSystem.js
// «Limpieza social»: de noche, a veces, una camioneta 4x4 negra llega por la calle, frena junto al
// jugador y se bajan tres hombres de negro con pasamontañas y pistola. El jefe se queda señalando y
// dando la orden; los otros dos lo persiguen y lo cascan. Si lo alcanzan, los cachazos siguen aunque
// esté tambaleando: casi siempre lo matan. Si se les escapa, vuelven, se suben y la camioneta se va.
import * as THREE from 'three';
import { SquadMember, SQUAD } from '../entities/SquadMember.js';
import { makeSuv, rollWheels } from '../world/bogota/suv.js';

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
    this.routes = [];
    this.suv = null;
    this.state = 'idle';     // idle | arriving | stopped | out | leaving
    this.route = null;
    this.distance = 0;       // posición de la camioneta sobre la ruta
    this.stopAt = 0;
    this.speed = 0;
    this.timer = 0;
    this.checkTimer = 0;
    this.cooldown = LIMPIEZA.cooldown * .5;
    this.onPlayerHurt = null;
    this._people = null;
    this._ground = () => 0;
  }

  /**
   * @param {object} district distrito activo (caminable y altura del suelo)
   * @param {object[]} routes rutas de tráfico ({ length, sample(d, pos, dir) })
   * @param {object[]} people lista de peatones que los carros respetan
   */
  setup(district, routes, people = null) {
    this.reset();
    this._disposeActors();
    this.routes = routes ?? [];
    this._people = people;
    this._ground = (x, z) => district?.getGroundHeight?.(x, z) ?? 0;
    const opts = {
      isWalkable: (x, z) => district?.isWalkableAt?.(x, z) ?? true,
      groundHeight: this._ground
    };
    this.members = [
      new SquadMember(this.scene, { ...opts, role: 'jefe' }),
      new SquadMember(this.scene, { ...opts, role: 'maton' }),
      new SquadMember(this.scene, { ...opts, role: 'maton' })
    ];
    this.suv = makeSuv();
    this.suv.group.visible = false;
    this.scene.add(this.suv.group);
  }

  get active() { return this.state !== 'idle'; }
  get leader() { return this.members[0]; }
  get thugs() { return this.members.slice(1); }

  /** Busca un tramo de calle cerca del jugador y manda la camioneta. Devuelve true si viene. */
  trigger() {
    if (this.active || !this.suv || !this.members.length) return false;
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
    return target.copy(_side).applyMatrix4(this.suv.group.matrixWorld).setY(this._ground(target.x, target.z));
  }

  /** Recuperación tras morir o recargar: todos arriba y la camioneta desaparece. */
  reset() {
    for (const m of this.members) if (m.active) m.enterCar();
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
  update(dt, { canChase = true, isNight = false, allowSpawn = true, camera = null } = {}) {
    // en pausa no se anima: el mezclador no reescribe huesos quietos y las poses sumadas se acumularían
    if (dt <= 0) return;
    if (!this.active) {
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
    for (const m of this.members) if (m.active) m.update(dt, { player: this.player.position, camera });
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
    this.members.forEach((m, i) => {
      m.exitCar(this._doorPoint(i, _door), this.player.position);
      if (this._people && !this._people.includes(m)) this._people.push(m);
    });
    this.leader.say('¡Ese es! ¡Cásquenlo!', 3);
    this.state = 'out';
    this.timer = 0;
    toast('🚙 Una camioneta negra frenó en seco: ¡limpieza social! Corre (Shift) y no te dejes alcanzar.', 'death');
  }

  _hunt(dt, canChase) {
    const player = this.player.position;
    const thugsBack = this.thugs.every((m) => !m.active);
    for (const m of this.thugs) {
      if (!m.active) continue;
      const result = m.think(dt, { player, canChase });
      if (result === 'swing') this.audio?.playWhoosh?.();
      else if (result === 'hit') this._hitPlayer(m);
      else if (result === 'giveup' && !this._gaveUp) {
        this._gaveUp = true;
        toast(canChase ? '😮‍💨 Se cansaron de perseguirte y vuelven a la camioneta.' : '🚙 Se devuelven a la camioneta.', 'info');
      }
    }
    // el jefe se sube cuando sus muchachos ya volvieron
    const result = this.leader.think(dt, { player, canChase, recall: thugsBack });
    if (result === 'home' || !this.leader.active) {
      this._removePeople();
      this.state = 'leaving';
      this.timer = 0;
      this._gaveUp = false;
    }
  }

  _leave(dt) {
    this.speed = Math.min(LIMPIEZA.cruise * 1.2, this.speed + LIMPIEZA.acceleration * 1.5 * dt);
    const step = this.speed * dt;
    this.distance += step;
    rollWheels(this.suv, step);
    this.suv.setBraking(false);
    this._place();
    if (this.distance - this.stopAt > LIMPIEZA.leave || (this.route.loop === false && this.distance >= this.route.length)) this.reset();
  }

  _hitPlayer(member) {
    if (!this.stats || this.stats.salud <= 0) return;
    const [min, max] = SQUAD.damage;
    const damage = Math.round(min + this.random() * (max - min));
    this.stats.salud = Math.max(0, this.stats.salud - damage);
    this.audio?.playThud?.();
    // a diferencia del conductor, siguen pegando aunque esté tambaleando
    this.player.receiveHit?.(this.player.position.clone().sub(member.position), 1.6);
    this.onPlayerHurt?.(damage);
    toast(`🩸 ¡Cachazo! −${damage} de salud.`, 'death');
  }

  /** Personajes para precargar junto con los demás NPC. */
  get preloadables() { return this.members; }

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
