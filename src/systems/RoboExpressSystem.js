// src/systems/RoboExpressSystem.js
// «Robo express»: dos hombres en una moto frenan junto al jugador, el parrillero se baja con un cuchillo o una pistola y
// exige. El jugador puede entregar (pierde plata o un objeto, sin heridas), correr (a veces lo persiguen un rato en
// moto) o pelear (arriesgado: cuchillazo o tiro; la policía reacciona como a cualquier pelea). Es raro y con enfriamiento:
// más probable de noche, en zonas pobres u oscuras y cuando se carga más plata. Mientras no hay robo no hace nada.
import * as THREE from 'three';
import { Moto } from '../entities/Moto.js';
import { RobberMember, ROBBER, DRIVER_CALLS } from '../entities/RobberMember.js';
import { straightRoute } from './LimpiezaSocialSystem.js';

const toast = (text, type = 'info') => globalThis.window?.dispatchEvent?.(new CustomEvent('toast', { detail: { text, type } }));
const cop = n => `$${Math.round(n).toLocaleString('es-CO')}`;

export const ROBO = {
  checkEvery: 30,        // s de juego entre tiradas
  baseChance: .02,       // probabilidad por tirada, de día, en el centro y sin plata encima
  nightFactor: 2.4,      // de 8 de la noche a 5 de la mañana
  duskFactor: 1.5,       // de 6 a 8 de la noche
  richScale: 20000,      // pesos que suman otro tanto a la probabilidad (hasta el triple)
  maxChance: .5,
  cooldown: 480,         // s mínimos entre un robo y otro
  afterReset: 120,       // s de calma tras morir o recargar
  grace: 300,            // s de partida nueva sin robos
  approach: 50,          // m que recorre la moto antes de frenar
  leave: 60,             // m que recorre al irse
  cruise: 11,            // m/s
  braking: 8,
  acceleration: 5,
  reach: [3, 18],        // m del carril al jugador para poder llegar
  sampleStep: 2,
  dropDelay: .5,
  patience: 7,           // s que espera el parrillero a que el jugador entregue antes de revisarlo él
  holdNear: 4.5,         // m: más cerca que esto sigue siendo «ahí parado»
  runDistance: 7.5,      // m: más lejos que esto, el jugador está huyendo
  runConfirm: .6,        // s huyendo antes de que lo tomen como fuga
  chaseChance: .5,       // de las fugas, las que se persiguen en moto
  chaseTime: 6,          // s que dura la persecución
  chaseSpeed: 9,
  chaseCatch: 2.4,       // m: a esta distancia se rinden y se van
  fightTimeout: 14,
  lootShare: [.15, .4],  // parte de la plata que se llevan
  minLoot: 1000,
  itemChance: .35,       // probabilidad de que se lleven un objeto en vez de plata
  knifeChance: .55
};

/** Cuánto pesa cada zona en el riesgo: más en las pobres y oscuras (ver ZONA_NOMBRES). */
export const ZONE_RISK = { cartucho: 1.8, barrio: 1.4, andenes: 1, parque: 1, candelaria: .8, chapinero: .5, lago: .6 };

/** Probabilidad de que una tirada dispare un robo. */
export function robberyChance({ hour = 12, zone = 'andenes', money = 0 } = {}) {
  const h = ((hour % 24) + 24) % 24;
  const time = h >= 20 || h < 5 ? ROBO.nightFactor : h >= 18 ? ROBO.duskFactor : 1;
  const rich = 1 + Math.min(2, Math.max(0, money) / ROBO.richScale);
  return Math.min(ROBO.maxChance, ROBO.baseChance * time * (ZONE_RISK[zone] ?? 1) * rich);
}

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();

export class RoboExpressSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {{ player: object, stats: object, inventory?: object, audio?: object, random?: () => number }} deps
   */
  constructor(scene, { player, stats, inventory = null, audio = null, random = Math.random }) {
    this.scene = scene;
    this.player = player;
    this.stats = stats;
    this.inventory = inventory;
    this.audio = audio;
    this.random = random;
    this.robber = null;
    this.moto = null;
    this.entry = null;
    this.extras = null;
    this.routes = [];
    this.state = 'idle';  // idle | arriving | stopped | demand | robbing | fleeing | chase | fight | leaving
    this.route = null;
    this.distance = 0;
    this.stopAt = 0;
    this.speed = 0;
    this.timer = 0;
    this.checkTimer = 0;
    this.elapsed = 0;
    this.cooldown = ROBO.cooldown * .5;
    this.holdTimer = 0;
    this.runTimer = 0;
    this.arrived = false;
    this.outcome = null;  // 'entrego' | 'huyo' | 'peleo' según lo último que pasó
    this.onPlayerHurt = null;
    this.onShot = null;
    this._people = null;
    this._ground = () => 0;
    this._heading = new THREE.Vector3(1, 0, 0);
  }

  /**
   * @param {object} district distrito activo
   * @param {object[]} routes rutas del tráfico
   * @param {object[]} people lista de peatones que los carros respetan
   * @param {{ collisions?: object, extraMotos?: object[] }} extra `extraMotos`: la lista que dibuja el lote de motos
   */
  setup(district, routes, people = null, { collisions = null, extraMotos = null } = {}) {
    this.reset();
    this._dispose();
    this.routes = routes ?? [];
    this._people = people;
    this.collisions = collisions;
    this.extras = extraMotos;
    this.getWaterInfo = (x, z) => district?.getWaterInfo?.(x, z) ?? null;
    this._ground = (x, z, y = 0) => district?.getMovementGroundHeight?.(x, z, y) ?? district?.getGroundHeight?.(x, z) ?? y;
    this._walkable = (x, z) => district?.isWalkableAt?.(x, z) ?? true;
    this.robber = new RobberMember(this.scene, {
      isWalkable: this._walkable, groundHeight: this._ground, getWaterInfo: this.getWaterInfo, collisions
    });
    this.robber.onHit = () => this._onRobberHit();
    this.moto = new Moto(new THREE.Vector3(0, -50, 0), 0, {
      variant: 0, occupancy: [true, false, true, false, false], helmets: [true, false, true, false, false],
      cloth: [3, 0, 5, 0, 0], color: '#1a1c20', phase: .37
    });
    this.moto.setDrawn(false);
    this.entry = { car: this.moto, speed: 0, acceleration: 0 };
  }

  get active() { return this.state !== 'idle'; }
  get awaitingAnswer() { return this.state === 'demand' && this.arrived; }
  get preloadables() { return this.robber ? [this.robber] : []; }

  /** ¿Puede empezar un robo ahora? Lo decide todo lo que ya sabe el juego. */
  canStart({ blocked = false, allowSpawn = true } = {}) {
    return !this.active && !!this.moto && !blocked && allowSpawn && this.elapsed >= ROBO.grace && this.cooldown <= 0;
  }

  /** Busca un tramo de calle cerca del jugador y manda la moto. `force` no mira cooldown ni gracia (el truco). */
  trigger({ force = false } = {}) {
    if (this.active || !this.moto || !this.robber) return false;
    const target = this.player.position;
    let best = null;
    for (const route of this.routes) {
      for (let d = 0; d < route.length; d += ROBO.sampleStep) {
        route.sample(d, _p, _d);
        const dist = Math.hypot(_p.x - target.x, _p.z - target.z);
        if (dist < ROBO.reach[0] || dist > ROBO.reach[1]) continue;
        if (!best || dist < best.dist) best = { route, d, dist };
      }
    }
    if (!best && force) {
      // Sin calle cerca (sala de pruebas, parque): una recta que pasa a pocos metros del jugador.
      const angle = this.random() * Math.PI * 2;
      _d.set(Math.cos(angle), 0, Math.sin(angle));
      _v.set(-_d.z, 0, _d.x).multiplyScalar(5).add(target).addScaledVector(_d, -60);
      best = { route: straightRoute(_v.clone(), _d.clone(), 120), d: 60, dist: 5 };
    }
    if (!best) return false;
    this.route = best.route;
    this.stopAt = best.d;
    this.distance = best.route.loop === false ? Math.max(0, best.d - ROBO.approach) : best.d - ROBO.approach;
    this.speed = ROBO.cruise;
    this.state = 'arriving';
    this.timer = 0;
    this.cooldown = ROBO.cooldown;
    this.arrived = false;
    this.holdTimer = this.runTimer = 0;
    this.outcome = null;
    const weapon = this.random() < ROBO.knifeChance ? 'cuchillo' : 'pistola';
    this.robber.setWeapon(weapon);
    this.moto.occupancy[2] = true;
    this.moto.setDrawn(true);
    if (this.extras && !this.extras.includes(this.entry)) this.extras.push(this.entry);
    this._place();
    return true;
  }

  _place() {
    this.route.sample(this.distance, _p, _d);
    this._heading.copy(_d);
    this._setMoto(_p.x, _p.z, Math.atan2(-_d.z, _d.x));
  }

  _setMoto(x, z, yaw) {
    const g = this.moto.group;
    g.position.set(x, 0, z);
    g.rotation.set(0, yaw, 0);
    g.updateMatrixWorld();
  }

  _doorPoint(target) {
    _v.set(-.1, 0, this.moto.width / 2 + .7).applyMatrix4(this.moto.group.matrixWorld);
    target.copy(_v);
    target.y = this._ground(target.x, target.z, target.y);
    return target;
  }

  /** Recuperación tras morir o recargar: todos arriba y la moto desaparece. */
  reset() {
    if (this.robber?.active) this.robber.remount();
    this._removeTargets();
    if (this.moto) { this.moto.setDrawn(false); this.moto.occupancy[2] = true; }
    if (this.extras && this.entry) { const i = this.extras.indexOf(this.entry); if (i >= 0) this.extras.splice(i, 1); }
    if (this.state !== 'idle') this.cooldown = Math.max(this.cooldown, ROBO.afterReset);
    this.state = 'idle';
    this.route = null;
    this.speed = 0;
    this.arrived = false;
    this.checkTimer = 0;
  }

  _addTargets() {
    const m = this.robber;
    if (this._people && !this._people.includes(m)) this._people.push(m);
    const list = this.player.extraMeleeTargets;
    if (!list?.includes(m)) this.player.extraMeleeTargets = [...(list ?? []), m];
  }

  _removeTargets() {
    const m = this.robber;
    if (!m) return;
    if (this._people) { const i = this._people.indexOf(m); if (i >= 0) this._people.splice(i, 1); }
    const list = this.player.extraMeleeTargets;
    if (list?.includes(m)) { const rest = list.filter(t => t !== m); this.player.extraMeleeTargets = rest.length ? rest : null; }
  }

  /**
   * @param {number} dt
   * @param {{ hour?: number, zone?: string, blocked?: boolean, allowSpawn?: boolean, camera?: THREE.Camera, giveIn?: boolean }} ctx
   *   blocked = muerte, sueño, arresto, menú o escena; giveIn = el jugador pidió entregar
   */
  update(dt, { hour = 12, zone = 'andenes', blocked = false, allowSpawn = true, camera = null, giveIn = false } = {}) {
    if (dt <= 0) return;
    this.elapsed += dt;
    if (!this.active) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (!this.canStart({ blocked, allowSpawn })) return;
      this.checkTimer += dt;
      if (this.checkTimer < ROBO.checkEvery) return;
      this.checkTimer = 0;
      if (this.random() < robberyChance({ hour, zone, money: this.stats?.dinero ?? 0 })) this.trigger();
      return;
    }
    // Una muerte o un arresto en pleno robo lo deshace: nadie se queda en la calle esperando.
    if (blocked && this.stats && this.stats.salud <= 0) { this.reset(); return; }
    this.timer += dt;
    const player = this.player.position;
    switch (this.state) {
      case 'arriving': this._arrive(dt); break;
      case 'stopped': if (this.timer >= ROBO.dropDelay) this._dismount(); break;
      case 'demand': this._demand(dt, giveIn); break;
      case 'robbing': this._robbing(dt); break;
      case 'fleeing': this._fleeing(dt); break;
      case 'chase': this._chase(dt); break;
      case 'fight': this._fight(dt); break;
      case 'leaving': this._leave(dt); break;
    }
    if (this.robber.active) this._keepTargets();
    this.robber.update(dt, { player, camera });
  }

  _keepTargets() { if (this.state === 'demand' || this.state === 'fight' || this.state === 'robbing') this._addTargets(); }

  _arrive(dt) {
    const left = this.stopAt - this.distance;
    const nose = this.moto.length / 2 + 1;
    this.route.sample(this.distance, _p, _d);
    const ahead = (this.player.position.x - _p.x) * _d.x + (this.player.position.z - _p.z) * _d.z;
    const lateral = Math.abs((this.player.position.x - _p.x) * _d.z - (this.player.position.z - _p.z) * _d.x);
    const blocked = lateral < this.moto.width / 2 + .7 && ahead > 0 && ahead < nose + 2;
    const stopDistance = this.speed ** 2 / (2 * ROBO.braking);
    const braking = blocked || left <= stopDistance + .4;
    this.speed = braking ? Math.max(0, this.speed - ROBO.braking * (blocked ? 2 : 1) * dt) : Math.min(ROBO.cruise, this.speed + ROBO.acceleration * dt);
    if (left < .05 || (blocked && this.speed < .3)) this.speed = 0;
    this.distance += Math.min(this.speed * dt, Math.max(0, left));
    this.entry.speed = this.speed; this.entry.acceleration = braking ? -ROBO.braking : ROBO.acceleration;
    this._place();
    if (this.speed === 0 || this.distance >= this.stopAt - .05) {
      this.speed = 0; this.entry.speed = 0; this.entry.acceleration = 0;
      this.state = 'stopped';
      this.timer = 0;
      this.audio?.playThud?.();
    }
  }

  _dismount() {
    this.moto.occupancy[2] = false;
    this.robber.dismount(this._doorPoint(_p), this.player.position);
    this._addTargets();
    this.state = 'demand';
    this.timer = 0;
    this.arrived = false;
    toast('Una moto frenó junto a usted: ¡atraco! Pulse E para entregar, o corra, o defiéndase.', 'warn');
  }

  _distanceToPlayer() {
    const p = this.player.position, r = this.robber.position;
    return Math.hypot(p.x - r.x, p.z - r.z);
  }

  _demand(dt, giveIn) {
    const result = this.robber.think(dt, { player: this.player.position, mode: this.arrived ? 'hold' : 'approach' });
    if (result === 'arrived' && !this.arrived) { this.arrived = true; this.holdTimer = 0; }
    const d = this._distanceToPlayer();
    if (this.arrived) this.holdTimer += dt;
    if (giveIn && d <= ROBO.holdNear + 1) { this.rob(); return; }
    if (this.arrived && this.holdTimer >= ROBO.patience && d <= ROBO.holdNear) { this.rob(); return; }
    this.runTimer = d > ROBO.runDistance ? this.runTimer + dt : 0;
    if (this.runTimer >= ROBO.runConfirm) this._onRun();
  }

  /** Lo que se llevan: plata casi siempre, o un objeto del costal; sin nada encima, un empujón y se van. */
  _loot() {
    const money = Math.max(0, this.stats?.dinero ?? 0);
    const items = this.inventory?.items ?? [];
    const wantsItem = items.length && (money < ROBO.minLoot || this.random() < ROBO.itemChance);
    if (wantsItem) {
      const at = Math.floor(this.random() * items.length), item = items[at];
      return { kind: 'item', name: item.name, take: () => { this.inventory.removeAt(at, 1); } };
    }
    if (money <= 0) return { kind: 'nada', take: () => {} };
    const [a, b] = ROBO.lootShare;
    const amount = Math.min(money, Math.max(ROBO.minLoot, Math.round(money * (a + this.random() * (b - a)) / 100) * 100));
    return { kind: 'plata', amount, take: () => { this.stats.dinero = Math.max(0, this.stats.dinero - amount); } };
  }

  /** El jugador entregó o se quedó parado: le revisan el costal y se van. Sin heridas. */
  rob() {
    if (this.state !== 'demand') return false;
    const loot = this._loot();
    loot.take();
    this.loot = loot;
    this.outcome = 'entrego';
    if (loot.kind === 'plata') toast(`Me robaron ${cop(loot.amount)}.`, 'death');
    else if (loot.kind === 'item') toast(`Me quitaron del costal: ${loot.name}.`, 'death');
    else toast('No tenía nada y me empujaron, pero no me hicieron nada.', 'warn');
    this.robber.say('¡Gracias, parcero, y no mire pa\' atrás!', 2.6);
    this.state = 'robbing';
    this.timer = 0;
    return true;
  }

  _robbing(dt) {
    this.robber.think(dt, { player: this.player.position, mode: 'hold' });
    if (this.timer >= .9) this._startReturn();
  }

  _onRun() {
    this.outcome = 'huyo';
    this._chasing = this.random() < ROBO.chaseChance;
    this.robber.say(this._chasing ? '¡Cójalo, cójalo!' : '¡Ahí se va, deje así!', 2.4);
    this._startReturn();
  }

  _startReturn() {
    this._removeTargets();
    this.state = 'fleeing';
    this.timer = 0;
    this.robber.think(0.001, { player: this.player.position, mode: 'return' });
  }

  _fleeing(dt) {
    const result = this.robber.think(dt, { player: this.player.position, mode: 'return' });
    if (result !== 'home') return;
    this.moto.occupancy[2] = true;
    this.timer = 0;
    this.state = this._chasing && this.outcome === 'huyo' ? 'chase' : 'leaving';
    this._chasing = false;
    if (this.state === 'leaving') this._heading.set(Math.cos(this.moto.group.rotation.y), 0, -Math.sin(this.moto.group.rotation.y));
    this.leaveFrom = this.moto.group.position.clone();
  }

  _chase(dt) {
    const g = this.moto.group, p = this.player.position;
    _d.set(p.x - g.position.x, 0, p.z - g.position.z);
    const dist = _d.length();
    if (this.timer >= ROBO.chaseTime || dist <= ROBO.chaseCatch) {
      if (dist <= ROBO.chaseCatch) this.driverSay('¡Uy, no, deje así, deje así!');
      this._heading.set(Math.cos(g.rotation.y), 0, -Math.sin(g.rotation.y));
      this.leaveFrom = g.position.clone();
      this.state = 'leaving';
      this.timer = 0;
      return;
    }
    _d.multiplyScalar(1 / dist);
    // gira hacia el jugador poco a poco, sin salirse de lo caminable
    const want = Math.atan2(-_d.z, _d.x);
    let diff = want - g.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const yaw = g.rotation.y + diff * Math.min(1, dt * 3);
    const step = ROBO.chaseSpeed * dt, nx = g.position.x + Math.cos(yaw) * step, nz = g.position.z - Math.sin(yaw) * step;
    if (!this._walkable(nx, nz)) { this.timer = ROBO.chaseTime; return; }
    this._setMoto(nx, nz, yaw);
    this.entry.speed = ROBO.chaseSpeed; this.entry.acceleration = 0;
  }

  driverSay(text) { this.robber?.say(text, 2.4); }

  _onRobberHit() {
    if (this.state === 'demand' || this.state === 'robbing') this._startFight();
  }

  _startFight() {
    this.outcome = 'peleo';
    this.state = 'fight';
    this.timer = 0;
    this.arrived = false;
    toast(this.robber.weapon === 'pistola' ? '¡Sacó la pistola! Esto se puso feo.' : '¡Sacó el cuchillo! Esto se puso feo.', 'warn');
  }

  _fight(dt) {
    if (this.robber.health <= 0 || this.timer >= ROBO.fightTimeout || this._distanceToPlayer() > 40 || (this.stats?.salud ?? 1) <= 0) {
      this.robber.say(pickOne(DRIVER_CALLS, this.random), 2.4);
      toast('El ladrón salió corriendo.', 'info');
      this._startReturn();
      return;
    }
    const player = this.player.position;
    const result = this.robber.think(dt, { player, mode: 'fight' });
    if (result === 'swing') this.audio?.playWhoosh?.();
    else if (result === 'hit') this._hurt(ROBBER.knifeDamage, 'cuchillazo');
    else if (result === 'shot') {
      this.audio?.playThud?.();
      this.onShot?.();
      if (this.robber.shotHit) this._hurt(ROBBER.shotDamage, 'tiro');
      else toast('Un tiro pasó zumbando.', 'warn');
    }
  }

  _hurt(range, what) {
    if (!this.stats || this.stats.salud <= 0 || this.player.isRagdollActive) return;
    const damage = Math.round(range[0] + this.random() * (range[1] - range[0]));
    this.stats.salud = Math.max(0, this.stats.salud - damage);
    this.player.receiveHit?.(this.player.position.clone().sub(this.robber.position), what === 'tiro' ? 2.2 : 1.2, { salud: this.stats.salud });
    this.onPlayerHurt?.(damage, what);
    toast(what === 'tiro' ? `Me pegaron un tiro: −${damage} de salud.` : `Me cortaron con el cuchillo: −${damage} de salud.`, 'death');
  }

  _leave(dt) {
    this.speed = Math.min(ROBO.cruise * 1.3, this.speed + ROBO.acceleration * 1.5 * dt);
    const g = this.moto.group, step = this.speed * dt, nx = g.position.x + this._heading.x * step, nz = g.position.z + this._heading.z * step;
    const blocked = !this._walkable(nx, nz);
    if (!blocked) this._setMoto(nx, nz, g.rotation.y);
    this.entry.speed = this.speed; this.entry.acceleration = ROBO.acceleration;
    if (blocked || Math.hypot(g.position.x - this.leaveFrom.x, g.position.z - this.leaveFrom.z) > ROBO.leave) this.reset();
  }

  _dispose() {
    this.robber?.dispose?.();
    this.robber = null;
    this.moto = null;
    this.entry = null;
  }

  dispose() {
    this.reset();
    this._dispose();
  }
}

function pickOne(list, random) { return list[Math.floor(random() * list.length)]; }
