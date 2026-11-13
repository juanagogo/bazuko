// src/features/calle.js
// Lo que se vive en la calle de los de la calle: raspar ladrillo de las paredes para sacar polvo, el refugio donde se echa
// chamber en compañía (con guayabo al otro día), los bocadillos gigantes que persiguen al que ve visiones, y el cartón
// para echarse a dormir un rato en cualquier parte. Todo cuelga de `CalleSystem`; mientras nada de esto pasa, no cuesta nada.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ITEMS } from '../data/items.js';

const toast = (text, type = 'info') => globalThis.window?.dispatchEvent?.(new CustomEvent('toast', { detail: { text, type } }));
const cop = n => `$${Math.round(n).toLocaleString('es-CO')}`;
const pick = (list, random) => list[Math.floor(random() * list.length)];

export const BRICK = {
  scrapeTime: 2.8,        // s raspando, quieto junto a la pared
  cooldown: 240,          // s que tarda una pared en dar otro poco
  reach: 2.4,             // m a los que se deja de raspar si se aleja
  face: 1.5,              // m máximos entre el jugador y la pared que raspa, de frente a ella
  cell: 3,                // m de la cuadrícula: cada tramo de pared tiene su propio enfriamiento
  minHeight: 5,           // m: solo es pared de edificio lo que pasa de esta altura
  yield: [1, 2],
  dust: .4                // de higiene que se lleva el polvo
};

export const CHAMBER = {
  shelters: 2,
  price: 1500,
  limit: 3,               // pocillos por refugio: después no queda
  cooldown: 45,           // s entre pocillos del mismo refugio
  effect: { animo: 15, energia: 8, salud: -2, calor: 120 },
  hangoverAfter: 70,      // s de juego hasta el guayabo
  hangover: { salud: -5, energia: -10, animo: -6 },  // por pocillo tomado
  bocadilloChance: .4,    // de que el chamber traiga visiones
  chatterEvery: 9,
  company: 3,
  near: 35,
  reach: 3.2
};

export const BOCADILLO = {
  max: 1,                 // un solo bocadillo, gigante
  life: 20,
  speed: 3.1,             // más lento que correr: se les escapa
  hop: .8,
  touch: 1.4,
  scare: 3,               // de ánimo que se lleva el susto
  scareCooldown: 4,
  ring: [8, 12],
  fov: 1.1                // rad de abanico delante de la cámara donde nace
};

export const CARTON_SLEEP = {
  hours: .5,
  energia: 5,
  robbery: .12,
  robbed: [.1, .2],       // parte de la plata que se llevan
  police: .1,
  policeHurt: 3,
  rainEnergia: 2,
  rainSalud: 2
};

export const CHATTER = [
  'Quién fuera rico para tomarse un chamber entero.',
  'Eso sí es medicina: sube y baja, pero abriga.',
  'Ojo, parce, que los tombos pasan a la una.',
  'Hoy no se me pegó ni una moneda, hermano.',
  'Cuénteme, ¿usted también vio la rata gigante?',
  'Más tarde dicen que cierran la olla.',
  'Esto con panela sabría mejor.'
];

/** Lo que pasa al echarse un rato en un cartón: +5 de energía casi siempre, con el riesgo de que lo roben, lo muevan o llueva. */
export function cartonSleepOutcome({ random = Math.random, raining = false } = {}) {
  const c = CARTON_SLEEP;
  const out = { energia: c.energia, salud: 0, robbed: 0, moved: false, ruined: false, text: 'Dormí un ratico en el cartón: algo de descanso.' };
  if (raining) {
    Object.assign(out, { energia: c.rainEnergia, salud: -c.rainSalud, ruined: true, text: 'Me llovió encima y el cartón quedó hecho sopa.' });
  }
  if (random() < c.police) {
    Object.assign(out, { energia: Math.floor(out.energia / 2), salud: out.salud - c.policeHurt, moved: true, text: 'Un tombo me levantó a punta de bolillo: «¡Circule!».' });
  }
  if (random() < c.robbery) {
    out.robbed = c.robbed[0] + random() * (c.robbed[1] - c.robbed[0]);
    out.text = 'Me robaron un poco de plata mientras dormía en el cartón.';
  }
  return out;
}

// ---------- dibujo ----------

const TARP = new THREE.MeshLambertMaterial({ color: 0x2f67b1, side: THREE.DoubleSide });
const CARDBOARD = new THREE.MeshLambertMaterial({ color: 0x9a7549 });
const WOOD = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
const METAL = new THREE.MeshLambertMaterial({ color: 0x3b3b3e });

function shelterMesh() {
  const group = new THREE.Group();
  group.name = 'Refugio';
  for (const x of [-1.6, 1.6]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.1, 5), WOOD);
    pole.position.set(x, 1.05, -.8);
    group.add(pole);
  }
  const tarp = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), TARP);
  tarp.position.set(0, 2, -.4);
  tarp.rotation.x = -Math.PI / 2 + .6;
  group.add(tarp);
  for (let i = 0; i < 4; i++) {
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.1, .03, .8), CARDBOARD);
    sheet.position.set(-1.1 + i * .7, .02 + i * .005, -.2 + (i % 2) * .5);
    sheet.rotation.y = i * .4;
    group.add(sheet);
  }
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(.25, .2, .35, 8), METAL);
  pot.position.set(0, .18, .9);
  group.add(pot);
  return group;
}

const canvasOf = (width, height) => {
  const canvas = globalThis.document?.createElement?.('canvas');
  if (!canvas) return null;
  canvas.width = width; canvas.height = height;
  return canvas;
};

const asTexture = canvas => {
  if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

/** La pasta de guayaba: un marrón rojizo opaco y con grano, como el bocadillo de verdad. */
function pasteTexture() {
  const canvas = canvasOf(256, 256);
  if (!canvas) return null;
  const g = canvas.getContext('2d');
  g.fillStyle = '#8f4637'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${i % 2 ? '120,52,40' : '168,84,66'},.12)`;
    g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 14 + Math.random() * 30, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = i % 3 ? 'rgba(196,118,92,.55)' : 'rgba(86,34,28,.45)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6);
  }
  return asTexture(canvas);
}

/** La etiqueta verde con franja amarilla y roja, sin marca: solo el nombre y una guayaba. */
function labelTexture() {
  const canvas = canvasOf(1100, 440);
  if (!canvas) return null;
  const g = canvas.getContext('2d');
  const base = g.createLinearGradient(0, 0, 0, 440);
  base.addColorStop(0, '#3aa24a'); base.addColorStop(1, '#23702f');
  g.fillStyle = base; g.fillRect(0, 0, 1100, 440);
  g.fillStyle = '#f4c52a';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(1100, 0); g.lineTo(1100, 130); g.quadraticCurveTo(700, 80, 380, 170); g.quadraticCurveTo(170, 220, 0, 160); g.closePath(); g.fill();
  g.strokeStyle = '#d02a22'; g.lineWidth = 12;
  g.beginPath(); g.moveTo(1100, 140); g.quadraticCurveTo(700, 90, 380, 180); g.quadraticCurveTo(170, 230, 0, 170); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 92px sans-serif';
  g.lineWidth = 16; g.lineJoin = 'round';
  g.strokeStyle = '#143d1a'; g.strokeText('Bocadillo de guayaba', 520, 300);
  g.fillStyle = '#fff4cf'; g.fillText('Bocadillo de guayaba', 520, 300);
  g.fillStyle = '#a8c25a'; g.beginPath(); g.arc(1010, 70, 52, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ee7f93'; g.beginPath(); g.arc(1010, 70, 40, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f8cbd3'; g.beginPath(); g.arc(1010, 70, 24, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8d890';
  for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(1010 + Math.cos(i * .9) * 14, 70 + Math.sin(i * .9) * 14, 3, 0, Math.PI * 2); g.fill(); }
  return asTexture(canvas);
}

let bocadilloAssets = null;

/** Una barra larga de bocadillo de guayaba envuelta a medias en su etiqueta verde y amarilla; las puntas quedan a la vista. */
function bocadilloMesh() {
  bocadilloAssets ??= {
    body: new RoundedBoxGeometry(3.6, .8, 1.05, 3, .1),
    wrap: new THREE.BoxGeometry(2.4, .84, 1.09),
    paste: new THREE.MeshLambertMaterial({ color: 0xffffff, map: pasteTexture() }),
    label: new THREE.MeshLambertMaterial({ color: 0xffffff, map: labelTexture() }),
    plain: new THREE.MeshLambertMaterial({ color: 0x2f8a3c }),
    none: new THREE.MeshBasicMaterial({ visible: false })
  };
  const { body, wrap, paste, label, plain, none } = bocadilloAssets;
  if (!paste.map) paste.color.set(0x8f4637);
  if (!label.map) label.color.set(0x2f8a3c);
  const group = new THREE.Group();
  group.name = 'Bocadillo gigante';
  const bar = new THREE.Mesh(body, paste);
  // La etiqueta rodea la barra: arriba y a los dos lados lleva el nombre; abajo va lisa y las puntas quedan abiertas
  const band = new THREE.Mesh(wrap, [none, none, label, plain, label, label]);
  group.add(bar, band);
  group.children.forEach(child => { child.position.y += .44; });
  return group;
}

// ---------- el sistema ----------

export class CalleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {{ player: object, stats: object, inventory: object, people?: object, audio?: object, random?: () => number }} deps
   *   `people`: PeoplePool para la gente del refugio
   */
  constructor(scene, { player, stats, inventory, people = null, audio = null, random = Math.random }) {
    this.scene = scene;
    this.player = player;
    this.stats = stats;
    this.inventory = inventory;
    this.people = people;
    this.audio = audio;
    this.random = random;
    this.interaction = null;
    this.wallSpot = null;
    this.wallCooldowns = new Map();
    this.shelters = [];
    this.bocadillos = [];
    this.hangover = null;
    this.scrape = null;
    this._scare = 0;
    this.camera = null;
    this.collisions = null;
    this._ground = () => 0;
    this.root = new THREE.Group();
    this.root.name = 'Calle';
    scene.add(this.root);
  }

  /** Pone las paredes y los refugios en los puntos libres del distrito (los mismos de la basura) y los registra. */
  setup(district, points = [], { interaction = null, avoid = null } = {}) {
    this.reset();
    this._dispose();
    this.interaction = interaction;
    this._ground = (x, z) => district?.getGroundHeight?.(x, z) ?? 0;
    const taken = [];
    const free = (p, spacing) => !taken.some(q => q.distanceTo(p) < spacing) && !(avoid && avoid.distanceTo(p) < 30);
    const choose = (count, spacing) => {
      const out = [];
      for (const point of points) {
        if (out.length >= count) break;
        if (!free(point, spacing)) continue;
        const p = point.clone();
        p.y = this._ground(p.x, p.z);
        out.push(p); taken.push(p);
      }
      return out;
    };
    for (const position of choose(CHAMBER.shelters, 60)) this._addShelter(position);
    this.wallSpot = this._newWallSpot();
    this.interaction?.register?.(this.wallSpot);
  }

  _register(target) {
    this.root.add(target.mesh);
    this.interaction?.register?.(target);
  }

  /** El tramo de pared de edificio que el jugador tiene de frente, o null. La clave sale de una cuadrícula sobre la pared. */
  _faceWall() {
    if (!this.collisions) return null;
    const p = this.player.position, yaw = this.player.root?.rotation?.y ?? 0, fx = Math.sin(yaw), fz = Math.cos(yaw);
    const reach = BRICK.face;
    let best = null, bestSq = reach * reach;
    for (const { box } of this.collisions.queryStatic(p.x - reach, p.z - reach, p.x + reach, p.z + reach, [])) {
      if (box.max.y - box.min.y < BRICK.minHeight || box.min.y > p.y + 1.8 || box.max.y < p.y + .5) continue;
      const cx = Math.max(box.min.x, Math.min(p.x, box.max.x)), cz = Math.max(box.min.z, Math.min(p.z, box.max.z));
      const dx = cx - p.x, dz = cz - p.z, sq = dx * dx + dz * dz;
      if (sq > bestSq || (sq > .0001 && (dx * fx + dz * fz) / Math.sqrt(sq) < .6)) continue;
      bestSq = sq; best = { x: cx, z: cz };
    }
    if (!best) return null;
    return { x: best.x, z: best.z, key: Math.floor(best.x / BRICK.cell) + ',' + Math.floor(best.z / BRICK.cell) };
  }

  /** Un punto a un paso de la fachada de edificio más cercana y hacia dónde mirarla (para los trucos y las pruebas). */
  nearestWall(x, z, radius = 60) {
    if (!this.collisions) return null;
    let best = null, bestSq = Infinity;
    for (const { box } of this.collisions.queryStatic(x - radius, z - radius, x + radius, z + radius, [])) {
      if (box.max.y - box.min.y < BRICK.minHeight) continue;
      const cx = Math.max(box.min.x, Math.min(x, box.max.x)), cz = Math.max(box.min.z, Math.min(z, box.max.z));
      const dx = x - cx, dz = z - cz, sq = dx * dx + dz * dz;
      if (sq < .01 || sq >= bestSq) continue;
      const d = Math.sqrt(sq);
      bestSq = sq; best = { x: cx + dx / d * .9, z: cz + dz / d * .9, yaw: Math.atan2(-dx / d, -dz / d) };
    }
    return best;
  }

  _newWallSpot() {
    const spot = {
      kind: 'calle', type: 'ladrillo', position: new THREE.Vector3(1e6, 0, 1e6), key: null,
      prompt: () => (this.wallCooldowns.get(spot.key) ?? 0) > 0 ? '[E] Esta pared ya quedó pelada, vuelva más tarde' : '[E] Raspar la pared (polvo de ladrillo)',
      interact: () => this.startScrape(spot)
    };
    return spot;
  }

  /** Sin pared al frente el aviso se va lejos; con ella, queda pegado al tramo que se raspa. */
  _aimWall() {
    if (this.scrape) return;
    const spot = this.wallSpot, face = this._faceWall();
    if (face) { spot.position.set(face.x, this.player.position.y, face.z); spot.key = face.key; }
    else { spot.position.set(1e6, 0, 1e6); spot.key = null; }
  }

  _addShelter(position) {
    const shelter = {
      kind: 'calle', type: 'refugio', position, drinks: 0, cooldown: 0, crowd: [], mesh: shelterMesh(),
      prompt: () => shelter.drinks >= CHAMBER.limit ? '[E] Ya no queda chamber en la olla' : `[E] Echar chamber con la gente (${cop(CHAMBER.price)})`,
      interact: () => this.drink(shelter)
    };
    shelter.mesh.position.copy(position);
    shelter.mesh.rotation.y = this.random() * Math.PI * 2;
    this.shelters.push(shelter);
    this._register(shelter);
  }

  _dispose() {
    if (this.wallSpot) this.interaction?.unregister?.(this.wallSpot);
    this.wallSpot = null;
    this.wallCooldowns.clear();
    for (const target of this.shelters) {
      this.interaction?.unregister?.(target);
      this.root.remove(target.mesh);
      for (const figure of target.crowd ?? []) this.people?.release(figure);
    }
    this.shelters.length = 0;
  }

  /** Recuperación tras morir o recargar: sin visiones, sin guayabo pendiente y sin raspar. */
  reset() {
    this._clearBocadillos();
    this.hangover = null;
    this.scrape = null;
    this.pickUpCarton();
    for (const shelter of this.shelters) { this._leave(shelter); shelter.cooldown = 0; }
  }

  dispose() {
    this.reset();
    this._dispose();
    this.scene.remove(this.root);
  }

  // ---------- raspar ladrillo ----------

  startScrape(wall) {
    if (this.scrape) return false;
    if ((this.wallCooldowns.get(wall.key) ?? 0) > 0) { toast('Esta pared ya quedó pelada. Que se llene de polvo otra vez.', 'info'); return false; }
    this.scrape = { wall: { key: wall.key, position: wall.position.clone() }, time: 0 };
    this.player.playAction?.('buscar', BRICK.scrapeTime);
    toast('Rasco el ladrillo con una teja rota...', 'info');
    return true;
  }

  _scraping(dt) {
    const { wall } = this.scrape;
    if (this.player.position.distanceTo(wall.position) > BRICK.reach + 1) {
      this.scrape = null;
      toast('Me alejé y dejé el raspado a medias.', 'info');
      return;
    }
    this.scrape.time += dt;
    if (this.scrape.time < BRICK.scrapeTime) return;
    this.scrape = null;
    this.wallCooldowns.set(wall.key, BRICK.cooldown);
    const qty = BRICK.yield[0] + Math.floor(this.random() * (BRICK.yield[1] - BRICK.yield[0] + 1));
    this.stats.higiene = Math.max(0, this.stats.higiene - BRICK.dust);
    if (this.inventory.add(ITEMS.polvoLadrillo, qty)) {
      this.audio?.play?.('pickup');
      toast(`Raspé ${qty} de ${ITEMS.polvoLadrillo.name.toLowerCase()}. Tose uno de solo respirarlo.`, 'info');
    } else toast('Costal sin espacio para el polvo.', 'warn');
  }

  // ---------- refugio de chamber ----------

  drink(shelter) {
    if (shelter.drinks >= CHAMBER.limit) { toast('Ya no queda chamber en la olla. Vuelva otro día.', 'info'); return false; }
    if (shelter.cooldown > 0) { toast('Espere que el pocillo dé la vuelta.', 'info'); return false; }
    const paid = this.stats.dinero >= CHAMBER.price;
    if (paid) this.stats.dinero -= CHAMBER.price;
    const k = paid ? 1 : .5;
    const e = CHAMBER.effect;
    this.stats.animo = Math.min(100, this.stats.animo + e.animo * k);
    this.stats.energia = Math.min(100, this.stats.energia + e.energia * k);
    this.stats.salud = Math.max(0, this.stats.salud + e.salud);
    this.stats.calor = Math.min(300, (this.stats.calor || 0) + e.calor * k);
    shelter.drinks++;
    shelter.cooldown = CHAMBER.cooldown;
    this.player.playAction?.('beber', 1.2);
    this.audio?.play?.('pickup');
    this.hangover = { time: CHAMBER.hangoverAfter, drinks: (this.hangover?.drinks ?? 0) + 1 };
    toast(paid ? `Echamos chamber (${cop(CHAMBER.price)}). Calientico, pero ya me está dando el guayabo.` : 'No tenía con qué: me convidaron un traguito. Calientico, pero ya me está dando el guayabo.', 'info');
    if (this.random() < CHAMBER.bocadilloChance) this.summonBocadillos(2 + Math.floor(this.random() * 2));
    return true;
  }

  _hangover(dt) {
    this.hangover.time -= dt;
    if (this.hangover.time > 0) return;
    const { drinks } = this.hangover, h = CHAMBER.hangover;
    this.hangover = null;
    this.stats.salud = Math.max(0, this.stats.salud + h.salud * drinks);
    this.stats.energia = Math.max(0, this.stats.energia + h.energia * drinks);
    this.stats.animo = Math.max(0, this.stats.animo + h.animo * drinks);
    toast('¡Guayabo! La cabeza me da vueltas y el cuerpo no me responde.', 'warn');
  }

  _crowd(shelter, d) {
    if (!this.people) return;
    if (d < CHAMBER.near && !shelter.crowd.length && this.people.available > CHAMBER.company) {
      const stances = ['sentado', 'acurrucado', 'sentado'];
      for (let i = 0; i < CHAMBER.company; i++) {
        const figure = this.people.acquire();
        if (!figure) break;
        const angle = shelter.mesh.rotation.y + i * 2.1 + .4, p = shelter.position;
        this.people.pose(figure, { stance: stances[i % stances.length] });
        figure.group.position.set(p.x + Math.sin(angle) * 1.1, p.y, p.z + Math.cos(angle) * 1.1);
        figure.group.rotation.set(0, angle + Math.PI, 0);
        shelter.crowd.push(figure);
      }
    } else if (d > CHAMBER.near + 12) this._leave(shelter);
  }

  _leave(shelter) {
    for (const figure of shelter.crowd) this.people?.release(figure);
    shelter.crowd.length = 0;
  }

  // ---------- bocadillos gigantes ----------

  /** Hacia dónde mira la cámara, para que el bocadillo nazca a la vista y no a la espalda del jugador. */
  _viewYaw() {
    if (!this.camera) return null;
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    return Math.hypot(d.x, d.z) > .01 ? Math.atan2(d.z, d.x) : null;
  }

  _solidAt(x, z) {
    if (!this.collisions) return false;
    return this.collisions.queryStatic(x - .6, z - .6, x + .6, z + .6, []).some(({ box }) => box.max.y > .4 && box.min.y < 1.6 && box.min.x < x + .6 && box.max.x > x - .6 && box.min.z < z + .6 && box.max.z > z - .6);
  }

  /** Un punto del anillo delante de la cámara y libre de paredes; si no hay, cualquiera del anillo. */
  _bocadilloSpot() {
    const p = this.player.position, yaw = this._viewYaw(), span = BOCADILLO.ring;
    let angle = 0, r = span[0], x = p.x, z = p.z;
    for (let i = 0; i < 12; i++) {
      angle = yaw === null ? this.random() * Math.PI * 2 : yaw + (this.random() - .5) * BOCADILLO.fov;
      r = span[0] + this.random() * (span[1] - span[0]);
      x = p.x + Math.cos(angle) * r; z = p.z + Math.sin(angle) * r;
      if (!this._solidAt(x, z)) break;
    }
    return { x, z };
  }

  summonBocadillos(count = 3) {
    let made = 0;
    for (let i = 0; i < count && this.bocadillos.length < BOCADILLO.max; i++) {
      const { x, z } = this._bocadilloSpot();
      const mesh = bocadilloMesh();
      mesh.position.set(x, this._ground(x, z), z);
      this.root.add(mesh);
      this.bocadillos.push({ mesh, age: 0, phase: this.random() * 6 });
      made++;
    }
    if (made) toast('¿Eso que viene saltando son... bocadillos? ¡Gigantes!', 'warn');
    return made;
  }

  _clearBocadillos() {
    for (const b of this.bocadillos) this.root.remove(b.mesh);
    this.bocadillos.length = 0;
  }

  _bocadillos(dt) {
    const p = this.player.position;
    this._scare = Math.max(0, this._scare - dt);
    for (const b of this.bocadillos) {
      b.age += dt;
      const m = b.mesh.position, dx = p.x - m.x, dz = p.z - m.z, d = Math.hypot(dx, dz);
      if (d > .8) { m.x += dx / d * BOCADILLO.speed * dt; m.z += dz / d * BOCADILLO.speed * dt; }
      const hop = Math.abs(Math.sin(b.age * 5 + b.phase));
      m.y = this._ground(m.x, m.z) + hop * BOCADILLO.hop;
      b.mesh.rotation.y = Math.atan2(-dz, dx) + Math.PI / 2 + Math.sin(b.age * 3) * .2;
      const shrink = Math.min(1, (BOCADILLO.life - b.age) / 1.5);
      b.mesh.scale.set(1 + (1 - hop) * .08, (1 - (1 - hop) * .12) * Math.max(0, shrink), 1).multiplyScalar(Math.max(0, shrink));
      if (d < BOCADILLO.touch && !this._scare) {
        this._scare = BOCADILLO.scareCooldown;
        this.stats.animo = Math.max(0, this.stats.animo - BOCADILLO.scare);
        toast('¡Un bocadillo gigante me saltó encima! Qué susto.', 'warn');
      }
    }
    const alive = this.bocadillos.filter(b => b.age < BOCADILLO.life);
    for (const b of this.bocadillos) if (b.age >= BOCADILLO.life) this.root.remove(b.mesh);
    this.bocadillos = alive;
  }

  // ---------- cartón para dormir ----------

  /** Tiende un cartón en el piso, bajo el jugador, mientras duerme; `pickUpCarton` lo recoge al despertar. */
  layCarton(position, yaw = 0) {
    this.pickUpCarton();
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.1, .04, 2), CARDBOARD);
    sheet.name = 'Cartón tendido';
    sheet.position.set(position.x, position.y + .03, position.z);
    sheet.rotation.y = yaw;
    this.root.add(sheet);
    this._carton = sheet;
    return sheet;
  }

  pickUpCarton() {
    if (this._carton) this.root.remove(this._carton);
    this._carton = null;
  }

  // ---------- cada cuadro ----------

  update(dt, { blocked = false } = {}) {
    if (dt <= 0) return;
    if (this.stats && this.stats.salud <= 0) { if (this.hangover || this.bocadillos.length || this.scrape) this.reset(); return; }
    for (const [key, left] of this.wallCooldowns) {
      if (left <= dt) this.wallCooldowns.delete(key); else this.wallCooldowns.set(key, left - dt);
    }
    if (this.wallSpot) this._aimWall();
    for (const shelter of this.shelters) {
      if (shelter.cooldown > 0) shelter.cooldown = Math.max(0, shelter.cooldown - dt);
      this._crowd(shelter, this.player.position.distanceTo(shelter.position));
    }
    if (this.scrape) this._scraping(dt);
    if (this.hangover && !blocked) this._hangover(dt);
    if (this.bocadillos.length) this._bocadillos(dt);
    // la gente del refugio se pone a hablar cuando uno está cerca
    const near = this.shelters.find(s => s.crowd.length && this.player.position.distanceTo(s.position) < CHAMBER.reach * 3);
    if (near) {
      this._chatter = (this._chatter ?? CHAMBER.chatterEvery) - dt;
      if (this._chatter <= 0) { this._chatter = CHAMBER.chatterEvery * (.7 + this.random() * .6); toast(pick(CHATTER, this.random), 'info'); }
    }
  }

  get counts() { return { wallCooldowns: this.wallCooldowns.size, shelters: this.shelters.length, bocadillos: this.bocadillos.length, crowd: this.shelters.reduce((n, s) => n + s.crowd.length, 0) }; }
}
