// src/systems/ProtestSystem.js
// «Protesta por lo que sea»: de la nada una multitud (la gente de la calle del PeoplePool, con pancartas) se toma un tramo de
// calle y al otro lado se forma una fila de antimotines con escudos. Se miran un rato, gritan, vuelan piedras y los tombos
// tiran gas lacrimógeno; luego todo se rompe y la gente sale corriendo. La calle queda hecha un desastre (piedras, palos,
// cartones y pancartas) y el jugador puede juntar cartón del suelo; después todo se va desvaneciendo. Es raro y con
// enfriamiento: más probable de día y en algunas zonas. Mientras no hay protesta no hace nada ni cuesta nada.
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';
import { straightRoute } from './LimpiezaSocialSystem.js';

const toast = (text, type = 'info') => globalThis.window?.dispatchEvent?.(new CustomEvent('toast', { detail: { text, type } }));

export const PROTEST = {
  checkEvery: 45,        // s de juego entre tiradas
  baseChance: .02,       // probabilidad por tirada a mediodía en el centro
  maxChance: .3,
  cooldown: 900,         // s mínimos entre una protesta y otra
  afterReset: 240,       // s de calma tras morir o recargar
  grace: 600,            // s de partida nueva sin protestas
  reach: [28, 70],       // m del jugador al centro de la protesta
  sampleStep: 4,
  crowd: 56,             // personas en la calle y los andenes, contando la gente barata de atrás
  protesters: 16,        // de ellas, las que son personas reales del PeoplePool (las de adelante); el resto es instanciada
  cops: 22,
  closeRadius: 50,       // m a la redonda del centro que quedan cerrados al tráfico mientras dura la gente en la calle
  phases: { gathering: 22, faceoff: 28, clash: 26, dispersal: 12, aftermath: 150, cleanup: 45 },
  gap: 7,                // m del centro a cada fila
  sidewalk: 7.4,         // m del eje de la calle al grupo de cada anden
  walkSpeed: 2.1,
  runSpeed: 5.6,
  rockEvery: .42,
  rockDamage: [5, 9],
  strayChance: .12,      // de las piedras, las que van al jugador si está entre las filas
  canisterEvery: 3,
  canisterLimit: 6,
  gasRadius: 5.2,
  signs: 6,              // consignas distintas
  signEvery: 3,          // una de cada tantas personas lleva pancarta
  gasLife: 18,
  gasDamage: 2.4,        // de salud por segundo dentro de la nube
  provokeRange: 4,       // m de la fila de tombos
  provokeTime: 3.5,
  scraps: 6,
  litterCapacity: 90
};

export const CAUSES = [
  'contra el precio del tinto',
  'por el derecho a la siesta a mitad del día',
  'contra el pico y placa de los domingos',
  'por más empanada y menos impuestos',
  'contra los huecos de la calle de siempre',
  'por una ciclovía que no se acabe en la esquina',
  'contra la lluvia, que cae sin permiso',
  'por el regreso del bus que nunca pasa',
  'contra el tráfico, desde la mitad de la calle'
];
export const CHANTS = ['¡Que se vaya, que se vaya!', '¡El pueblo unido!', '¡Eso, eso, eso!', '¡Sin tinto no hay país!', '¡Se ve, se siente, la siesta está presente!', '¡Ruido, ruido, que nos oigan!'];
export const SLOGANS = ['SIN TINTO\nNO HAY PAÍS', 'MÁS SIESTA', 'QUEREMOS\nEMPANADA', 'NI UN HUECO\nMÁS', 'BUS YA', '¡QUE SE\nOIGA!'];
export const COP_LINES = ['¡Despejen la vía!', '¡Última advertencia!', '¡Atrás, atrás!', '¡Dispérsense ya!'];

export const ZONE_PROTEST = { parque: 1.8, andenes: 1.4, candelaria: 1.2, chapinero: 1.2, barrio: .6, lago: .5, cartucho: .3 };

/** Probabilidad de que una tirada arme una protesta: de día y en zonas de plaza; de madrugada casi nunca. */
export function protestChance({ hour = 12, zone = 'andenes' } = {}) {
  const h = ((hour % 24) + 24) % 24;
  const time = h >= 9 && h < 18 ? 1 : h >= 7 && h < 21 ? .5 : .08;
  return Math.min(PROTEST.maxChance, PROTEST.baseChance * time * (ZONE_PROTEST[zone] ?? 1));
}

const PHASES = ['gathering', 'faceoff', 'clash', 'dispersal', 'aftermath', 'cleanup'];
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _c = new THREE.Color();
const SIGN_STICK = new THREE.CylinderGeometry(.025, .025, 1.5, 5), SIGN_BOARD = new THREE.BoxGeometry(.95, .6, .03), SIGN_WOOD = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
const SHIRTS = [0x6b4a3a, 0x4b5d6e, 0x5f6b52, 0x8a7a5a, 0x5a4f6b, 0x7a4a3d, 0x3d3d3d, 0xa8a090, 0x365456, 0x1f2328, 0x6a6f75, 0x8b2b2b], JEANS = [0x2b3a55, 0x1f2430, 0x3c4a63, 0x4a4036, 0x2a2a2a];
const SKINS = [0x8d5a3b, 0xb07a52, 0xc99a73, 0x6d4630, 0xe0b48f], HAIRS = [0x15110d, 0x2b2118, 0x4a3a2a, 0x8a8a86, 0x0e0e0e];
const _q2 = new THREE.Quaternion(), _roll = new THREE.Euler();
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

const GAS_VERTEX = `attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  gl_PointSize = aSize * 260. / max(-mv.z, 1.);
  gl_Position = projectionMatrix * mv;
}`;
const GAS_FRAGMENT = `varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - .5);
  gl_FragColor = vec4(.86, .88, .8, smoothstep(.5, .12, r) * vAlpha);
}`;

export class ProtestSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {{ player: object, stats: object, people: object, cops: object, audio?: object, random?: () => number }} deps
   *   `people`: PeoplePool; `cops`: grupo de antimotines con `acquire()` y `release()`
   */
  constructor(scene, { player, stats, people, cops, audio = null, random = Math.random }) {
    this.scene = scene;
    this.player = player;
    this.stats = stats;
    this.people = people;
    this.cops = cops;
    this.audio = audio;
    this.random = random;
    this.state = 'idle';
    this.timer = 0;
    this.elapsed = 0;
    this.cooldown = PROTEST.cooldown * .5;
    this.checkTimer = 0;
    this.routes = [];
    this.actors = [];
    this.rocks = [];
    this.clouds = [];
    this.scraps = [];
    this.center = new THREE.Vector3();
    this.axis = new THREE.Vector3(1, 0, 0);
    this.cause = '';
    this.onPlayerHurt = null;
    this.onProvoked = null;
    this.interaction = null;
    this._traffic = null;
    this.vehicles = null;
    this.cheap = [];
    this._ground = () => 0;
    this.root = new THREE.Group();
    this.root.name = 'Protesta';
    this.root.visible = false;
    scene.add(this.root);
    this._visuals();
  }

  get active() { return this.state !== 'idle'; }
  get counts() { return { actors: this.actors.length, rocks: this.rocks.length, clouds: this.clouds.length, scraps: this.scraps.filter(s => !s.used).length }; }

  setup(district, routes, trafficPeople = null, { interaction = null, vehicles = null } = {}) {
    this.reset();
    this.routes = routes ?? [];
    this._traffic = trafficPeople;
    this.vehicles = vehicles;
    this.interaction = interaction;
    this._ground = (x, z) => district?.getGroundHeight?.(x, z) ?? 0;
  }

  // ---------- dibujo ----------

  _visuals() {
    const cap = PROTEST.litterCapacity;
    const make = (geometry, material, count) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false;
      this.root.add(mesh);
      return mesh;
    };
    // Piedras, bombas de gas gastadas y palos comparten malla: se distinguen por el color y la escala.
    this.signFaces = this._signFaces();
    this._crowd(make);
    this.cues = this._cues();
    this.root.add(this.cues.group);
    this.bits = make(new THREE.IcosahedronGeometry(.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), cap);
    this.sheets = make(new THREE.BoxGeometry(1, .03, 1), new THREE.MeshLambertMaterial(), cap);
    this.bitsData = [];
    this.sheetsData = [];
    const geometry = new THREE.BufferGeometry();
    const n = PROTEST.canisterLimit * 16;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.gas = new THREE.Points(geometry, new THREE.ShaderMaterial({ vertexShader: GAS_VERTEX, fragmentShader: GAS_FRAGMENT, transparent: true, depthWrite: false }));
    this.gas.frustumCulled = false;
    this.gas.visible = false;
    this.root.add(this.gas);
  }

  /** El cartón de cada consigna: un material por consigna, que comparten las pancartas reales y las instanciadas. */
  _signFaces() {
    return SLOGANS.map((slogan, i) => {
      const face = new THREE.MeshLambertMaterial({ color: [0xe6dcc4, 0xd9b873, 0xc9d6e0][i % 3] });
      const canvas = globalThis.document?.createElement?.('canvas');
      if (canvas) {
        canvas.width = 256; canvas.height = 160;
        const g = canvas.getContext('2d');
        g.fillStyle = ['#e6dcc4', '#d9b873', '#c9d6e0'][i % 3]; g.fillRect(0, 0, 256, 160);
        g.fillStyle = ['#a1261c', '#1c3b7a', '#222'][i % 3]; g.font = 'bold 40px sans-serif'; g.textAlign = 'center';
        slogan.split('\n').forEach((line, row, all) => g.fillText(line, 128, 80 + (row - (all.length - 1) / 2) * 46));
        face.map = new THREE.CanvasTexture(canvas);
        face.map.colorSpace = THREE.SRGBColorSpace;
      }
      return face;
    });
  }

  /** Una pancarta para quien la lleva en la mano: un cartón con consigna en un palo. */
  _makeSign(slogan) {
    const sign = new THREE.Group();
    const plate = new THREE.Mesh(SIGN_BOARD, this.signFaces[slogan % this.signFaces.length]), pole = new THREE.Mesh(SIGN_STICK, SIGN_WOOD);
    plate.position.set(0, 2.35, 0); pole.position.set(0, 1.55, 0);
    sign.add(plate, pole);
    sign.position.set(.28, 0, .25);
    return sign;
  }

  /**
   * La gente barata de atrás: cuerpo, cabeza y piernas instanciados, y las pancartas en una malla por consigna. No tienen
   * mezclador ni sombra; se colocan a mano cada cuadro.
   */
  _crowd(make) {
    const cap = PROTEST.crowd, material = () => new THREE.MeshLambertMaterial();
    this.legs = make(new THREE.CylinderGeometry(.075, .065, .85, 6), material(), cap * 2);
    this.arms = make(new THREE.CylinderGeometry(.055, .045, .62, 5), material(), cap * 2);
    this.torsos = make(new THREE.CapsuleGeometry(.2, .42, 3, 8), material(), cap);
    this.heads = make(new THREE.SphereGeometry(.12, 8, 6), material(), cap);
    this.hair = make(new THREE.SphereGeometry(.13, 8, 4, 0, Math.PI * 2, 0, Math.PI * .56), material(), cap);
    this.poles = make(SIGN_STICK, SIGN_WOOD, cap);
    this.boards = this.signFaces.map(face => make(SIGN_BOARD, face, cap));
    // El palo y el cartón llevan su color propio: sin color por instancia, que sin dato las pinta de negro.
    for (const mesh of [this.poles, ...this.boards]) mesh.instanceColor = null;
    this.crowdMeshes = [this.legs, this.arms, this.torsos, this.heads, this.hair, this.poles, ...this.boards];
  }

  /** Las señales de calle cerrada: una camioneta de la policía y barreras con conos en los dos extremos. Se arman una vez. */
  _cues() {
    const group = new THREE.Group();
    group.visible = false;
    const box = (w, h, d, color, x, y, z, parent) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const van = new THREE.Group();
    box(2.1, 1.1, 5, 0xf1f1ee, 0, .95, 0, van);
    box(1.9, .85, 2.6, 0xf1f1ee, 0, 1.9, -.6, van);
    box(2.12, .3, 5.02, 0x1d3f7a, 0, .75, 0, van);
    box(.9, .14, .3, 0x2457d6, -.4, 2.4, -.6, van);
    box(.9, .14, .3, 0xd62a2a, .4, 2.4, -.6, van);
    const barrier = () => {
      const g = new THREE.Group();
      for (const x of [-1.2, 1.2]) box(.08, 1, .08, 0x444444, x, .5, 0, g);
      box(2.6, .22, .06, 0xe8e8e0, 0, .85, 0, g);
      box(2.6, .22, .06, 0xd9462f, 0, .55, 0, g);
      return g;
    };
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(.17, .55, 7), new THREE.MeshLambertMaterial({ color: 0xff6a1a }), 16);
    cone.frustumCulled = false;
    group.add(van, cone);
    return { group, van, cone, barriers: Array.from({ length: 6 }, () => { const b = barrier(); group.add(b); return b; }) };
  }

  /** Pone las señales en los dos extremos del tramo cerrado, sobre el eje de la protesta. */
  _placeCues() {
    const { group, van, cone, barriers } = this.cues, side = this._side().clone(), reach = PROTEST.closeRadius - 3;
    const yaw = Math.atan2(this.axis.x, this.axis.z), put = (object, along, lateral, rotation = yaw) => {
      const x = this.center.x + this.axis.x * along + side.x * lateral, z = this.center.z + this.axis.z * along + side.z * lateral;
      object.position.set(x, this._ground(x, z), z);
      object.rotation.y = rotation;
    };
    let n = 0;
    for (const end of [-1, 1]) {
      for (const lateral of [-3.6, 0, 3.6]) put(barriers[n++], end * reach, lateral);
      for (const lateral of [-5.2, -1.8, 1.8, 5.2]) {
        const x = this.center.x + this.axis.x * (end * (reach - 1.5)) + side.x * lateral, z = this.center.z + this.axis.z * (end * (reach - 1.5)) + side.z * lateral;
        _m.compose(_p.set(x, this._ground(x, z) + .27, z), _q.identity(), _s.set(1, 1, 1));
        cone.setMatrixAt((end > 0 ? 4 : 0) + (lateral < -3 ? 0 : lateral < 0 ? 1 : lateral < 3 ? 2 : 3), _m);
      }
    }
    cone.count = 8;
    cone.instanceMatrix.needsUpdate = true;
    put(van, reach - 6, 2.2, yaw + Math.PI * .5 + .35);
    group.visible = true;
  }

  // ---------- empezar ----------

  canStart({ blocked = false, allowSpawn = true } = {}) {
    return !this.active && !blocked && allowSpawn && this.elapsed >= PROTEST.grace && this.cooldown <= 0;
  }

  /** Busca un tramo de calle a cierta distancia del jugador. `force` no mira cooldown ni gracia (el truco). */
  trigger({ force = false } = {}) {
    if (this.active || !this.people || !this.cops) return false;
    const target = this.player.position, options = [];
    for (const route of this.routes) {
      for (let d = 20; d < route.length - 20; d += PROTEST.sampleStep) {
        route.sample(d, _p, _d);
        const dist = Math.hypot(_p.x - target.x, _p.z - target.z);
        if (dist >= PROTEST.reach[0] && dist <= PROTEST.reach[1]) options.push({ x: _p.x, z: _p.z, dx: _d.x, dz: _d.z, dist });
      }
    }
    let site = options.length ? options[Math.floor(this.random() * options.length)] : null;
    if (!site && force) {
      const angle = this.random() * Math.PI * 2;
      const route = straightRoute(_p.set(target.x + Math.cos(angle) * 34, 0, target.z + Math.sin(angle) * 34), _d.set(-Math.sin(angle), 0, Math.cos(angle)), 60);
      route.sample(30, _p, _d);
      site = { x: _p.x, z: _p.z, dx: _d.x, dz: _d.z, dist: 34 };
    }
    if (!site) return false;
    this.center.set(site.x, 0, site.z);
    this.axis.set(site.dx, 0, site.dz).normalize();
    this.cause = CAUSES[Math.floor(this.random() * CAUSES.length)];
    this.cooldown = PROTEST.cooldown;
    this._enter('gathering');
    this._spawn();
    this.vehicles?.closeSegment?.(this.center.x, this.center.z, PROTEST.closeRadius);
    this._placeCues();
    toast(`Mire, por ahí hay protesta ${this.cause}. A ${Math.round(site.dist)} m.`, 'warn');
    return true;
  }

  _side() { return _d.set(-this.axis.z, 0, this.axis.x); }

  /** Los puestos de la multitud: filas apretadas en la calle y dos grupos en los andenes; adelante primero. */
  _slots() {
    const slots = [];
    const street = PROTEST.crowd - 16;
    for (let i = 0; i < street; i++) {
      const row = Math.floor(i / 8), col = i % 8;
      slots.push({ along: -3.2 - row * 1.05, lateral: (col - 3.5 + (row % 2) * .5) * .95 + (this.random() - .5) * .3, rank: row === 0 ? 0 : row + 1 });
    }
    for (let i = 0; i < 16; i++) {
      const sideSign = i % 2 ? 1 : -1, k = Math.floor(i / 2), row = Math.floor(k / 4), col = k % 4;
      slots.push({ along: -2.5 - row * 1.3 - col * .3, lateral: sideSign * (PROTEST.sidewalk + col * .9) + (this.random() - .5) * .4, rank: i < 4 ? 1 : row + 4 });
    }
    return slots;
  }

  _spawn() {
    const { center: c, axis: a } = this;
    const side = this._side().clone();
    const slots = this._slots(), order = slots.map((_, i) => i).sort((x, y) => slots[x].rank - slots[y].rank || x - y);
    const real = new Set(order.slice(0, Math.min(PROTEST.protesters, this.people.available)));
    const police = Math.min(PROTEST.cops, this.cops.available);
    slots.forEach((slot, i) => {
      const goal = c.clone().addScaledVector(a, slot.along).addScaledVector(side, slot.lateral);
      const start = goal.clone().addScaledVector(a, -(26 + this.random() * 12)).addScaledVector(side, (this.random() - .5) * 8);
      const slogan = i % PROTEST.signEvery === 0 ? i / PROTEST.signEvery % PROTEST.signs : -1;
      const figure = real.has(i) ? this.people.acquire() : null;
      const actor = this._add(figure, 'protester', start, goal, a, 'hablar');
      if (!figure) {
        actor.cheap = { shirt: SHIRTS[i % SHIRTS.length], jeans: JEANS[(i * 7) % JEANS.length], skin: SKINS[(i * 3) % SKINS.length], hair: HAIRS[(i * 5) % HAIRS.length], height: .88 + (i * 37 % 13) / 100, phase: this.random() * 6.28, slogan };
        this.cheap.push(actor);
      } else if (slogan >= 0) {
        actor.sign = this._makeSign(slogan);
        figure.group.add(actor.sign);
      }
    });
    for (let i = 0; i < police; i++) {
      const figure = this.cops.acquire();
      if (!figure) break;
      const rank = i < 18 ? Math.floor(i / 9) : 2, k = i < 18 ? i % 9 : i - 18;
      const lateral = rank < 2 ? (k - 4) * .85 + rank * .42 : (k - 1.5) * 2.4;
      const goal = c.clone().addScaledVector(a, PROTEST.gap + (rank < 2 ? rank * 1.05 : 4.5)).addScaledVector(side, lateral);
      const start = goal.clone().addScaledVector(a, 28 + this.random() * 6).addScaledVector(side, (this.random() - .5) * 3);
      this._add(figure, 'cop', start, goal, a.clone().negate(), null);
    }
    this._flushCrowd(0);
  }

  _add(figure, kind, start, goal, facing, stance) {
    const actor = { figure, kind, pos: start.clone(), goal, facing: Math.atan2(facing.x, facing.z), stance, base: stance, speed: PROTEST.walkSpeed * (.85 + this.random() * .3), proxy: { position: start.clone() }, arrived: false, gassed: 0 };
    if (figure) {
      figure.group.position.set(start.x, this._ground(start.x, start.z), start.z);
      figure.group.rotation.set(0, Math.atan2(goal.x - start.x, goal.z - start.z), 0);
      this.people.pose?.(figure, { stance, live: true });
    }
    this.actors.push(actor);
    this._traffic?.push(actor.proxy);
    return actor;
  }

  _enter(state) {
    this.state = state;
    this.timer = 0;
    this._eventTimer = 0;
    this._dispersed = false;
    this.root.visible = true;
  }

  // ---------- acabar ----------

  _drop(actor) {
    const pool = actor.kind === 'cop' ? this.cops : this.people;
    actor.sign?.removeFromParent();
    if (actor.figure) pool.release(actor.figure);
    if (this._traffic) { const i = this._traffic.indexOf(actor.proxy); if (i >= 0) this._traffic.splice(i, 1); }
  }

  _releaseActors() {
    for (const actor of this.actors) this._drop(actor);
    this.actors.length = 0;
    this.cheap.length = 0;
    this._flushCrowd(0);
  }

  _clearLitter() {
    this.bitsData.length = this.sheetsData.length = 0;
    this.bits.count = this.sheets.count = 0;
    this.rocks.length = this.clouds.length = 0;
    for (const scrap of this.scraps) this.interaction?.unregister?.(scrap);
    this.scraps.length = 0;
    this.gas.visible = false;
  }

  /** La calle ya está libre de gente: se quitan las señales y vuelve el tráfico. */
  _reopenStreet() {
    this.cues.group.visible = false;
    this.vehicles?.openSegment?.();
  }

  /** Recuperación tras morir o recargar: nadie en la calle, ni gas, ni basura. */
  reset() {
    this._releaseActors();
    this._reopenStreet();
    this._clearLitter();
    if (this.state !== 'idle') this.cooldown = Math.max(this.cooldown, PROTEST.afterReset);
    this.state = 'idle';
    this.root.visible = false;
    this.checkTimer = 0;
  }

  dispose() {
    this.reset();
    this.scene.remove(this.root);
    for (const mesh of [this.bits, this.sheets, this.gas, ...this.crowdMeshes]) { mesh.geometry.dispose?.(); mesh.material.dispose(); }
  }

  // ---------- cada cuadro ----------

  update(dt, { hour = 12, zone = 'andenes', blocked = false, allowSpawn = true, camera = null } = {}) {
    if (dt <= 0) return;
    this.elapsed += dt;
    if (!this.active) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (!this.canStart({ blocked, allowSpawn })) return;
      this.checkTimer += dt;
      if (this.checkTimer < PROTEST.checkEvery) return;
      this.checkTimer = 0;
      if (this.random() < protestChance({ hour, zone })) this.trigger();
      return;
    }
    if (this.stats && this.stats.salud <= 0) { this.reset(); return; }
    this.timer += dt;
    this._eventTimer += dt;
    const phase = PROTEST.phases[this.state];
    switch (this.state) {
      case 'gathering': this._gather(dt); break;
      case 'faceoff': this._faceoff(dt); break;
      case 'clash': this._clash(dt); break;
      case 'dispersal': this._disperse(dt); break;
      case 'aftermath': case 'cleanup': this._litter(dt); break;
    }
    if (this.state !== 'aftermath' && this.state !== 'cleanup') this._moveActors(dt);
    this._rocks(dt);
    this._gas(dt);
    this._playerEffects(dt);
    if (this.timer >= phase) this._next();
  }

  _next() {
    const i = PHASES.indexOf(this.state);
    if (this.state === 'dispersal') { this._releaseActors(); this._reopenStreet(); this._makeLitter(); }
    if (this.state === 'cleanup') { this._clearLitter(); this.state = 'idle'; this.root.visible = false; return; }
    this._enter(PHASES[i + 1]);
    if (this.state === 'faceoff') toast('Los tombos formaron la fila. Esto se va a poner feo.', 'warn');
    if (this.state === 'clash') toast('¡Piedras y gas! Aléjese de la calle.', 'death');
    if (this.state === 'dispersal') toast('¡Corra! Se acabó la protesta.', 'warn');
    if (this.state === 'aftermath') toast('La calle quedó hecha un desastre. Entre los cartones algo se rescata.', 'info');
  }

  _gather(dt) {
    if (this.actors.every(a => a.arrived)) this.timer = Math.max(this.timer, PROTEST.phases.gathering - .01);
  }

  _faceoff(dt) {
    if (this._eventTimer >= 5.5) {
      this._eventTimer = 0;
      toast(this.random() < .35 ? COP_LINES[Math.floor(this.random() * COP_LINES.length)] : CHANTS[Math.floor(this.random() * CHANTS.length)], 'info');
    }
  }

  _clash(dt) {
    this._rockTimer = (this._rockTimer ?? 0) - dt;
    this._canisterTimer = (this._canisterTimer ?? 0) - dt;
    const crowd = this.actors.filter(a => a.kind === 'protester'), police = this.actors.filter(a => a.kind === 'cop');
    if (this._rockTimer <= 0 && crowd.length && police.length) {
      this._rockTimer = PROTEST.rockEvery * (.6 + this.random() * .8);
      const from = crowd[Math.floor(this.random() * crowd.length)].pos;
      const player = this.player.position, between = this._between(player);
      if (between && this.random() < PROTEST.strayChance) this._throw(from, player.x, player.z, 1.1, 'rock');
      else { const to = police[Math.floor(this.random() * police.length)].pos; this._throw(from, to.x + (this.random() - .5), to.z + (this.random() - .5), 1.2, 'rock'); }
    }
    if (this._canisterTimer <= 0 && police.length && this.clouds.length < PROTEST.canisterLimit) {
      this._canisterTimer = PROTEST.canisterEvery * (.7 + this.random() * .6);
      const from = police[Math.floor(this.random() * police.length)].pos, side = this._side();
      _p.copy(this.center).addScaledVector(this.axis, -(1 + this.random() * 7)).addScaledVector(side, (this.random() - .5) * 8);
      this._throw(from, _p.x, _p.z, 1.6, 'canister');
    }
  }

  _between(p) {
    const along = (p.x - this.center.x) * this.axis.x + (p.z - this.center.z) * this.axis.z;
    const lateral = Math.abs((p.x - this.center.x) * this.axis.z - (p.z - this.center.z) * this.axis.x);
    return Math.abs(along) < PROTEST.gap + 2 && lateral < 9;
  }

  _throw(from, tx, tz, time, kind) {
    const y0 = this._ground(from.x, from.z) + 1.7, y1 = this._ground(tx, tz) + .1, g = 9.8;
    this.rocks.push({ kind, x: from.x, y: y0, z: from.z, vx: (tx - from.x) / time, vz: (tz - from.z) / time, vy: (y1 - y0 + .5 * g * time * time) / time, landed: false, index: -1, hit: false });
  }

  _rocks(dt) {
    const player = this.player.position;
    for (const rock of this.rocks) {
      if (rock.landed) continue;
      rock.vy -= 9.8 * dt;
      rock.x += rock.vx * dt; rock.y += rock.vy * dt; rock.z += rock.vz * dt;
      const ground = this._ground(rock.x, rock.z) + .08;
      if (rock.kind === 'rock' && !rock.hit && Math.hypot(rock.x - player.x, rock.z - player.z) < .8 && rock.y > player.y && rock.y < player.y + 2) {
        rock.hit = true;
        const damage = Math.round(PROTEST.rockDamage[0] + this.random() * (PROTEST.rockDamage[1] - PROTEST.rockDamage[0]));
        this.stats.salud = Math.max(0, this.stats.salud - damage);
        toast(`¡Le cayó una piedra! −${damage} de salud.`, 'death');
        this.onPlayerHurt?.();
      }
      if (rock.y <= ground) {
        rock.y = ground; rock.landed = true;
        if (rock.kind === 'canister') this.clouds.push({ x: rock.x, z: rock.z, age: 0, seed: this.random() * 10 });
        this._place(rock);
      }
    }
    const flying = this.rocks.length;
    this.rocks = this.rocks.filter(r => !r.landed);
    if (flying) this._flush();
  }

  _place(rock) {
    if (this.bitsData.length >= PROTEST.litterCapacity - PROTEST.canisterLimit) this.bitsData.shift();
    this.bitsData.push({ kind: rock.kind, x: rock.x, y: rock.y, z: rock.z, s: rock.kind === 'canister' ? .26 : .1 + this.random() * .08, ry: this.random() * 6 });
  }

  _flush() {
    const mesh = this.bits, all = this.bitsData.concat(this.rocks.map(r => ({ kind: r.kind, x: r.x, y: r.y, z: r.z, s: r.kind === 'canister' ? .26 : .12, ry: r.x }))).slice(0, PROTEST.litterCapacity);
    all.forEach((b, i) => {
      _m.compose(_p.set(b.x, b.y, b.z), _q.setFromEuler(_e.set(b.ry, b.ry * 2, 0)), _s.set(b.s, b.kind === 'stick' ? b.s * .7 : b.s, b.kind === 'stick' ? b.s * 10 : b.s));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.set(b.kind === 'canister' ? 0x2e3a2c : b.kind === 'stick' ? 0x6b4a2b : b.kind === 'burnt' ? 0x151515 : 0x77736c));
    });
    mesh.count = all.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  _gas(dt) {
    const attr = this.gas.geometry.attributes, pos = attr.position.array, alpha = attr.aAlpha.array, size = attr.aSize.array;
    this.clouds = this.clouds.filter(c => (c.age += dt) < PROTEST.gasLife);
    let n = 0;
    for (const cloud of this.clouds) {
      const k = cloud.age / PROTEST.gasLife, spread = (.35 + Math.min(1, cloud.age / 3)) * PROTEST.gasRadius, fade = Math.min(1, cloud.age / 1.2) * (1 - k * k);
      for (let i = 0; i < 16; i++, n++) {
        const a = cloud.seed + i * 2.399 + cloud.age * .15, r = spread * Math.sqrt((i + .5) / 16);
        pos[n * 3] = cloud.x + Math.cos(a) * r; pos[n * 3 + 1] = this._ground(cloud.x, cloud.z) + .6 + (i % 4) * .55 + k * 1.5; pos[n * 3 + 2] = cloud.z + Math.sin(a) * r;
        alpha[n] = .8 * fade; size[n] = 4.2 + (i % 3) * .9;
      }
    }
    for (let i = n; i < alpha.length; i++) alpha[i] = 0;
    this.gas.visible = n > 0;
    if (n || this._gasDirty) { attr.position.needsUpdate = attr.aAlpha.needsUpdate = attr.aSize.needsUpdate = true; this._gasDirty = n > 0; }
  }

  _inGas(x, z) { return this.clouds.some(c => c.age > 1 && Math.hypot(c.x - x, c.z - z) < PROTEST.gasRadius * .85); }

  _playerEffects(dt) {
    const p = this.player.position;
    if (this._inGas(p.x, p.z)) {
      this.stats.salud = Math.max(0, this.stats.salud - PROTEST.gasDamage * dt);
      this._cough = (this._cough ?? 0) - dt;
      if (this._cough <= 0) { this._cough = 4; toast('El gas arde: ¡tos, tos! Salga de la nube.', 'warn'); this.onPlayerHurt?.(); }
    }
    // Quien se pega a la fila de tombos mientras la cosa está caliente se gana la atención de la patrulla.
    if (this.state === 'faceoff' || this.state === 'clash') {
      const near = this.actors.some(a => a.kind === 'cop' && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < PROTEST.provokeRange);
      this._provoke = near ? (this._provoke ?? 0) + dt : 0;
      if (this._provoke >= PROTEST.provokeTime) { this._provoke = 0; toast('¡Usted, retírese de la fila! Lo vamos a llevar.', 'death'); this.onProvoked?.(); }
    }
  }

  // ---------- gente ----------

  _disperse(dt) {
    if (!this._dispersed) {
      this._dispersed = true;
      for (const a of this.actors) {
        if (a.kind === 'protester') {
          _p.copy(a.pos).sub(this.center).addScaledVector(this.axis, -2).setY(0);
          const angle = Math.atan2(_p.x, _p.z) + (this.random() - .5) * 1.8;
          a.goal = a.pos.clone().add(new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(45));
          a.speed = PROTEST.runSpeed * (.8 + this.random() * .4); a.stance = 'huir'; a.arrived = false;
        } else {
          a.goal = a.pos.clone().addScaledVector(this.axis, -5); a.stance = null; a.speed = 1.6; a.arrived = false;
        }
      }
    }
  }

  _moveActors(dt) {
    for (const a of this.actors) {
      const dx = a.goal.x - a.pos.x, dz = a.goal.z - a.pos.z, dist = Math.hypot(dx, dz);
      let speed = 0;
      if (dist > .25) {
        speed = a.speed;
        const step = Math.min(dist, speed * dt);
        a.pos.x += dx / dist * step; a.pos.z += dz / dist * step;
        a.facing += wrap(Math.atan2(dx, dz) - a.facing) * Math.min(1, dt * 8);
      } else if (!a.arrived) {
        a.arrived = true;
        a.facing = a.kind === 'cop' ? Math.atan2(-this.axis.x, -this.axis.z) : Math.atan2(this.axis.x, this.axis.z);
      }
      if (this.state === 'clash' && a.kind === 'protester' && a.arrived) {
        const gassed = this._inGas(a.pos.x, a.pos.z);
        if (gassed && !a.gassed) { a.gassed = 1; a.stance = 'nariz'; a.goal = a.pos.clone().addScaledVector(this.axis, -9); a.speed = PROTEST.runSpeed * .7; a.arrived = false; }
      }
      a.proxy.position.copy(a.pos);
      a.speedNow = speed;
      if (!a.figure) continue;
      const g = a.figure.group;
      g.position.set(a.pos.x, this._ground(a.pos.x, a.pos.z), a.pos.z);
      g.rotation.y = a.facing;
      a.figure.character.update?.(dt, { speed, running: speed > 4, stance: speed > 0 && a.stance !== 'huir' && a.stance !== 'nariz' ? null : a.stance, stanceWeight: 1 });
    }
    this._flushCrowd(dt);
  }

  /** Coloca la gente instanciada: piernas, brazos, cuerpo, cabeza y pancarta; saltan al gritar y corren cuando huyen. */
  _flushCrowd(dt) {
    this._clock = (this._clock ?? 0) + dt;
    const list = this.cheap, counts = this.boards.map(() => 0);
    let poles = 0, fresh = false;
    const put = (mesh, index, x, y, z, yaw, roll, sx, sy, sz) => {
      _q.setFromEuler(_e.set(0, yaw, 0));
      if (roll) _q.multiply(_q2.setFromEuler(_roll.set(0, 0, roll)));
      _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
      mesh.setMatrixAt(index, _m);
    };
    list.forEach((a, i) => {
      const k = a.cheap, h = k.height, yaw = a.facing, sin = Math.sin(yaw), cos = Math.cos(yaw);
      const hop = a.speedNow > 0 ? Math.abs(Math.sin(this._clock * (a.stance === 'huir' ? 11 : 6) + k.phase)) * .08 : (this.state === 'clash' ? Math.max(0, Math.sin(this._clock * 7 + k.phase)) * .1 : 0);
      const y = this._ground(a.pos.x, a.pos.z) + hop;
      const at = (dx, dz) => [a.pos.x + cos * dx + sin * dz, a.pos.z - sin * dx + cos * dz];
      const stride = a.speedNow > 0 ? Math.sin(this._clock * (a.stance === 'huir' ? 11 : 6) + k.phase) * .35 : 0;
      for (const side of [-1, 1]) {
        const [lx, lz] = at(side * .1, 0), [ax, az] = at(side * .27, 0);
        put(this.legs, i * 2 + (side > 0 ? 1 : 0), lx, y + .425 * h, lz, yaw, 0, 1, h, 1);
        const raised = side > 0 && (k.slogan >= 0 || (this.state === 'clash' && k.phase > 3.2));
        put(this.arms, i * 2 + (side > 0 ? 1 : 0), ax, y + (raised ? 1.45 : 1.18) * h, az, yaw, raised ? -side * .25 : side * stride * .5, 1, h, 1);
      }
      const [tx, tz] = at(0, 0);
      put(this.torsos, i, tx, y + 1.17 * h, tz, yaw, 0, 1.3, h, .8);
      put(this.heads, i, tx, y + 1.7 * h, tz, yaw, 0, 1, h, 1);
      put(this.hair, i, tx, y + 1.71 * h, tz, yaw, 0, 1, h, 1);
      if (!a.painted) {
        fresh = true; a.painted = true;
        for (const side of [0, 1]) { this.legs.setColorAt(i * 2 + side, _c.set(k.jeans)); this.arms.setColorAt(i * 2 + side, _c.set(k.shirt)); }
        this.torsos.setColorAt(i, _c.set(k.shirt)); this.heads.setColorAt(i, _c.set(k.skin)); this.hair.setColorAt(i, _c.set(k.hair));
      }
      if (k.slogan >= 0) {
        const [ox, oz] = at(.28, .25);
        put(this.poles, poles++, ox, y + 1.55, oz, yaw, 0, 1, 1, 1);
        put(this.boards[k.slogan], counts[k.slogan]++, ox, y + 2.35, oz, yaw, 0, 1, 1, 1);
      }
    });
    this.legs.count = this.arms.count = list.length * 2;
    this.torsos.count = this.heads.count = this.hair.count = list.length;
    this.poles.count = poles;
    this.boards.forEach((mesh, n) => { mesh.count = counts[n]; });
    for (const mesh of this.crowdMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (fresh && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // ---------- el desastre ----------

  _makeLitter() {
    const { center: c, axis: a } = this, side = this._side().clone(), r = () => this.random();
    for (let i = 0; i < 24; i++) this.bitsData.push({ kind: 'stick', x: c.x + a.x * (r() - .5) * 16 + side.x * (r() - .5) * 12, z: c.z + a.z * (r() - .5) * 16 + side.z * (r() - .5) * 12, y: 0, s: .09 + r() * .05, ry: r() * 6 });
    for (let i = 0; i < 6; i++) this.bitsData.push({ kind: 'burnt', x: c.x - a.x * (2 + r() * 5) + side.x * (r() - .5) * 8, z: c.z - a.z * (2 + r() * 5) + side.z * (r() - .5) * 8, y: 0, s: .35 + r() * .25, ry: r() * 6 });
    for (const b of this.bitsData) if (b.kind !== 'rock' && b.kind !== 'canister') b.y = this._ground(b.x, b.z) + .05;
    this._flush();
    this.sheetsData = [];
    for (let i = 0; i < 26; i++) {
      const board = i < PROTEST.scraps;
      this.sheetsData.push({ x: c.x - a.x * (1 + r() * 9) + side.x * (r() - .5) * 11, z: c.z - a.z * (1 + r() * 9) + side.z * (r() - .5) * 11, w: .8 + r() * .5, d: .5 + r() * .5, ry: r() * 6, color: board ? 0x9a7549 : [0xd9d2c3, 0xb23a30, 0x2f5fa8, 0xe0b72f][i % 4], scale: 1 });
    }
    this._flushSheets();
    this.scraps = this.sheetsData.slice(0, PROTEST.scraps).map((s, i) => {
      const scrap = {
        kind: 'protestScrap', position: new THREE.Vector3(s.x, this._ground(s.x, s.z), s.z), used: false, index: i,
        harvest: () => {
          if (scrap.used) return null;
          scrap.used = true; s.scale = 0; this._flushSheets();
          const extra = ['lata', 'botella', 'chatarra'].filter(id => ITEMS[id] && this.random() < .35);
          return { items: ['carton', ...(this.random() < .5 ? ['carton'] : []), ...extra], rare: null, sorted: false };
        },
        returnUncollected: items => { if (items.length) { scrap.used = false; s.scale = 1; this._flushSheets(); } }
      };
      this.interaction?.register?.(scrap);
      return scrap;
    });
  }

  _flushSheets() {
    const mesh = this.sheets;
    this.sheetsData.forEach((s, i) => {
      _m.compose(_p.set(s.x, this._ground(s.x, s.z) + .03, s.z), _q.setFromEuler(_e.set(0, s.ry, 0)), _s.set(s.w * s.scale, 1, s.d * s.scale));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.set(s.color));
    });
    mesh.count = this.sheetsData.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  _litter() {
    if (this.state !== 'cleanup') return;
    const k = 1 - this.timer / PROTEST.phases.cleanup;
    for (const s of this.sheetsData) if (s.scale > 0) s.scale = Math.min(1, k * 1.2);
    for (const scrap of this.scraps) if (k < .6 && !scrap.used) { scrap.used = true; this.interaction?.unregister?.(scrap); }
    this._flushSheets();
    this.bits.count = Math.ceil(this.bitsData.length * k);
  }
}
