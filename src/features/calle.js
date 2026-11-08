// src/features/calle.js
// Lo que se vive en la calle de los de la calle: raspar ladrillo de las paredes para sacar polvo, el refugio donde se echa
// chamber en compañía (con guayabo al otro día), los bocadillos gigantes que persiguen al que ve visiones, y el cartón
// para echarse a dormir un rato en cualquier parte. Todo cuelga de `CalleSystem`; mientras nada de esto pasa, no cuesta nada.
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';

const toast = (text, type = 'info') => globalThis.window?.dispatchEvent?.(new CustomEvent('toast', { detail: { text, type } }));
const cop = n => `$${Math.round(n).toLocaleString('es-CO')}`;
const pick = (list, random) => list[Math.floor(random() * list.length)];

export const BRICK = {
  walls: 5,
  scrapeTime: 2.8,        // s raspando, quieto junto a la pared
  cooldown: 240,          // s que tarda una pared en dar otro poco
  reach: 2.4,             // m a los que se alcanza a raspar
  yield: [1, 2],
  dust: .4,               // de higiene que se lleva el polvo
  minSpacing: 25
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
  max: 4,
  life: 20,
  speed: 3.1,             // más lento que correr: se les escapa
  hop: .8,
  touch: 1.4,
  scare: 3,               // de ánimo que se lleva el susto
  scareCooldown: 4,
  ring: [10, 15]
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
  '—Quién fuera rico para tomarse un chamber entero.',
  '—Eso sí es medicina: sube y baja, pero abriga.',
  '—Ojo, parce, que los tombos pasan a la una.',
  '—Hoy no se me pegó ni una moneda, hermano.',
  '—Cuénteme, ¿usted también vio la rata gigante?',
  '—Más tarde dicen que cierran la olla.',
  '—Esto con panela sabría mejor.'
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

// Hileras de ladrillo pintadas una sola vez; sin lienzo (pruebas en Node) queda el color liso.
function brickTexture() {
  const canvas = globalThis.document?.createElement?.('canvas');
  if (!canvas) return null;
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#b9aa98'; g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row++) for (let col = -1; col < 4; col++) {
    g.fillStyle = ['#9c4a32', '#8d4230', '#a85438'][(row * 3 + col + 4) % 3];
    g.fillRect(col * 32 + (row % 2) * 16 + 1, row * 16 + 1, 30, 14);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  return texture;
}
const BRICK_RED = new THREE.MeshLambertMaterial({ color: 0x9c4a32, flatShading: true, map: brickTexture() });
const BRICK_DARK = new THREE.MeshLambertMaterial({ color: 0x5b2d20, flatShading: true });
const TARP = new THREE.MeshLambertMaterial({ color: 0x2f67b1, side: THREE.DoubleSide });
const CARDBOARD = new THREE.MeshLambertMaterial({ color: 0x9a7549 });
const WOOD = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
const METAL = new THREE.MeshLambertMaterial({ color: 0x3b3b3e });

function brickWallMesh() {
  const group = new THREE.Group();
  group.name = 'Pared de ladrillo';
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 1.7, .35), BRICK_RED);
  wall.position.y = .85;
  const worn = new THREE.Mesh(new THREE.BoxGeometry(1.2, .8, .02), BRICK_DARK);
  worn.position.set(.3, 1, .19);
  group.add(wall, worn);
  for (let i = 0; i < 4; i++) {
    const brick = new THREE.Mesh(new THREE.BoxGeometry(.22, .08, .1), BRICK_RED);
    brick.position.set(-1.2 + i * .4, .04, .4 + (i % 2) * .15);
    brick.rotation.y = i * .7;
    group.add(brick);
  }
  return group;
}

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

function bocadilloMesh() {
  const group = new THREE.Group();
  group.name = 'Bocadillo gigante';
  const paste = new THREE.Mesh(new THREE.BoxGeometry(1.5, .45, .8), new THREE.MeshLambertMaterial({ color: 0x8a2c2e, flatShading: true }));
  const leaf = new THREE.MeshLambertMaterial({ color: 0x7d8a45, flatShading: true });
  for (const x of [-.35, .35]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(.22, .5, .86), leaf);
    band.position.x = x;
    group.add(band);
  }
  const end = new THREE.Mesh(new THREE.BoxGeometry(.04, .38, .68), new THREE.MeshLambertMaterial({ color: 0xc9573f }));
  end.position.x = .76;
  group.add(paste, end);
  group.children.forEach(child => { child.position.y += .3; });
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
    this.walls = [];
    this.shelters = [];
    this.bocadillos = [];
    this.hangover = null;
    this.scrape = null;
    this._scare = 0;
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
    for (const position of choose(BRICK.walls, BRICK.minSpacing)) this._addWall(position);
  }

  _register(target) {
    this.root.add(target.mesh);
    this.interaction?.register?.(target);
  }

  _addWall(position) {
    const wall = {
      kind: 'calle', type: 'ladrillo', position, cooldown: 0, mesh: brickWallMesh(),
      prompt: () => wall.cooldown > 0 ? '[E] Esta pared ya quedó pelada, vuelva más tarde' : '[E] Raspar ladrillo (polvo)',
      interact: () => this.startScrape(wall)
    };
    wall.mesh.position.copy(position);
    wall.mesh.rotation.y = this.random() * Math.PI;
    this.walls.push(wall);
    this._register(wall);
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
    for (const target of [...this.walls, ...this.shelters]) {
      this.interaction?.unregister?.(target);
      this.root.remove(target.mesh);
      for (const figure of target.crowd ?? []) this.people?.release(figure);
    }
    this.walls.length = this.shelters.length = 0;
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
    if (wall.cooldown > 0) { toast('Esta pared ya quedó pelada. Que se llene de polvo otra vez.', 'info'); return false; }
    this.scrape = { wall, time: 0 };
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
    wall.cooldown = BRICK.cooldown;
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

  summonBocadillos(count = 3) {
    const p = this.player.position;
    let made = 0;
    for (let i = 0; i < count && this.bocadillos.length < BOCADILLO.max; i++) {
      const angle = this.random() * Math.PI * 2, r = BOCADILLO.ring[0] + this.random() * (BOCADILLO.ring[1] - BOCADILLO.ring[0]);
      const mesh = bocadilloMesh();
      mesh.position.set(p.x + Math.cos(angle) * r, this._ground(p.x, p.z), p.z + Math.sin(angle) * r);
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
      b.mesh.rotation.y = Math.atan2(-dz, dx) + Math.sin(b.age * 3) * .2;
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
    for (const wall of this.walls) if (wall.cooldown > 0) wall.cooldown = Math.max(0, wall.cooldown - dt);
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

  get counts() { return { walls: this.walls.length, shelters: this.shelters.length, bocadillos: this.bocadillos.length, crowd: this.shelters.reduce((n, s) => n + s.crowd.length, 0) }; }
}
