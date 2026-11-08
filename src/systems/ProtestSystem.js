// src/systems/ProtestSystem.js
// «Protesta por lo que sea»: de la nada una multitud (la gente de la calle del PeoplePool, con pancartas) se toma un tramo de
// calle y al otro lado se forma una fila de antimotines con escudos. Se miran un rato, gritan, vuelan piedras y los tombos
// tiran gas lacrimógeno; luego todo se rompe y la gente sale corriendo. La calle queda hecha un desastre (piedras, palos,
// cartones y pancartas) y el jugador puede juntar cartón del suelo; después todo se va desvaneciendo. Es raro y con
// enfriamiento: más probable de día y en algunas zonas. Mientras no hay protesta no hace nada ni cuesta nada.
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';
import { DAY_LENGTH_SECONDS } from '../utils/constants.js';
import { straightRoute } from './LimpiezaSocialSystem.js';
import { stepMelee } from './MeleeChase.js';

const toast = (text, type = 'info') => globalThis.window?.dispatchEvent?.(new CustomEvent('toast', { detail: { text, type } }));

const gameHours = hours => hours * DAY_LENGTH_SECONDS / 24;

export const PROTEST = {
  checkEvery: 45,        // s de juego entre tiradas
  baseChance: .02,       // probabilidad por tirada a mediodía en el centro
  maxChance: .3,
  cooldown: 900,         // s mínimos entre una protesta y otra
  afterReset: 240,       // s de calma tras morir o recargar
  grace: 600,            // s de partida nueva sin protestas
  reach: [28, 70],       // m del jugador al centro de la protesta
  sampleStep: 4,
  crowd: 56,             // personas en la calle y los andenes: todas personas reales de la calle, con sus piernas
  protesters: 56,        // tamaño del grupo propio de gente de la protesta
  cops: 22,
  closeRadius: 50,       // m a la redonda del centro que quedan cerrados al tráfico mientras dura la gente en la calle
  // Todo se mide en tiempo de juego: un día de juego dura DAY_LENGTH_SECONDS, así que una hora de juego son 150 s a velocidad normal.
  phases: { gathering: gameHours(.15), faceoff: gameHours(.3), clash: gameHours(.4), dispersal: gameHours(.08), aftermath: gameHours(1), cleanup: gameHours(.3) },
  normalHours: 2,        // lo que dura el cara a cara y los choques de una protesta normal
  paroHours: 24,         // lo que dura un paro grande: un día de juego entero con la calle cerrada
  paroChance: .25,       // de las protestas, las que son un paro grande
  gap: 7,                // m del centro a cada fila
  sidewalk: 7.4,         // m del eje de la calle al grupo de cada anden
  walkSpeed: 2.1,
  runSpeed: 5.6,
  rockEvery: .3,
  chargers: 12,          // tombos de adelante que rompen la fila
  chargeSpeed: 5.6,      // corren casi como el jugador y más que la gente que huye
  dragSpeed: 3,
  warnTime: 2.6,         // de "¡Última advertencia!" a la carga
  chargeTime: 13,
  regroupTime: 7,
  chargeGap: 6,          // pausa con la fila formada antes de otra carga
  batonDamage: [6, 11],  // al jugador
  beatDamage: [12, 24],  // a un manifestante
  beatings: 4,           // golpes que recibe uno antes de que lo dejen
  fallChance: .45,
  dragChance: .3,        // el resto se pone a pelear
  fightTime: 2.4,
  hp: 70,
  copHp: 90,
  copRockDamage: [10, 18],
  rockStagger: .6,
  wreckTime: 50,         // s de choque hasta que los carros atrapados quedan hechos un desastre
  rockDamage: [5, 9],
  strayChance: .22,      // de las piedras, las que van al jugador si está entre las filas
  canisterEvery: 3,
  canisterLimit: 6,
  gasRadius: 5.2,
  signs: 6,              // consignas distintas
  tires: 5,              // montones de llantas quemándose en la calle
  signEvery: 3,          // una de cada tantas personas lleva pancarta
  gasLife: 18,
  gasDamage: 2.4,        // de salud por segundo dentro de la nube
  provokeRange: 4,       // m de la fila de tombos
  provokeTime: 3.5,
  scraps: 6,
  litterCapacity: 90,
  chantGap: [2, 5],               // s entre un grito y el siguiente
  sirenGap: [25, 50],             // s entre sirenas en un paro
  calmDispersal: gameHours(.2),   // la gente que se va tranquila tarda más que la que sale corriendo
  peacefulHours: 1,               // una protesta normal pacífica dura menos
  tension: {
    threshold: 1,                 // al llegar aquí empieza el choque: última advertencia y carga
    start: .08,
    peaceful: .34,                // de las protestas normales, la tercera parte sigue pacífica y otra tercera se pone tensa; el resto es pelea
    tense: .33,
    paroPeaceful: .12,            // los paros se inclinan al conflicto
    paroTense: .28,
    shortChance: .5,              // de las tensas, las que terminan en un choque corto
    shortClash: .35,              // fracción del choque normal que dura el corto
    seconds: { peaceful: 45, tense: 50, tenseShort: [35, 60], fight: [12, 28] },
    caps: { peaceful: .25, tense: .75 },
    tenseAt: .5,                  // desde aquí se prenden las primeras llantas
    afterClash: .3,
    decay: .012,                  // por segundo, cuando la tensión está por encima de lo que daría la protesta sola
    hitCop: .5,                   // le pega a un tombo con el puño
    hitProtester: .18,
    poopCop: .4,                  // le tira popó a un tombo
    poopProtester: .12,
    hostile: .35,                 // lo que cada manifestante golpeado los vuelve contra el jugador
    hostileLimit: .3
  },
  // Lo que queda en la calle según qué tan feo se puso: cartones y volantes siempre; piedras, palos y llantas cuando se calentó; todo cuando hubo choque.
  debris: {
    peaceful: { sheets: 16, trash: 9, sticks: 0, rocks: 0, burnt: 0, tires: 0, aftermath: gameHours(.4), cleanup: gameHours(.15) },
    tense: { sheets: 22, trash: 12, sticks: 10, rocks: 12, burnt: 2, tires: 2, aftermath: gameHours(.7), cleanup: gameHours(.22) },
    clash: { sheets: 26, trash: 16, sticks: 24, rocks: 0, burnt: 6, tires: 5, aftermath: gameHours(1), cleanup: gameHours(.3) }
  }
};

const cause = (alert, hint, slogans = null, chants = null) => ({ alert, hint, slogans, chants });

/** Las causas: paros de gremio de aquí y las cosas que a uno le da por protestar en Latinoamérica. Cada protesta elige una. */
export const CAUSES = [
  cause('PARO: taxistas por el precio de la gasolina', 'un paro de taxistas por el precio de la gasolina',
    ['GASOLINA A\nPRECIO JUSTO', 'TAXISTAS\nUNIDOS', 'NO MÁS\nALZAS', '¡PARO\nYA!'], ['¡Gasolina barata!', '¡Pito, pito, que nos oigan!']),
  cause('PARO CAMIONERO: contra los peajes', 'un paro camionero por los peajes',
    ['PEAJES\nAL SUELO', 'CAMIONEROS\nUNIDOS', 'LA CARGA\nNO PAGA', '¡PARO\nCAMIONERO!'], ['¡Peajes no, carreteras sí!', '¡Camionero unido!']),
  cause('PARO: mototaxistas por el pico y placa', 'un paro de mototaxistas por el pico y placa',
    ['MOTO SIN\nPICO', 'NO AL PICO\nY PLACA', 'LA MOTO\nTAMBIÉN\nTRABAJA', 'DÉJENNOS\nRODAR'], ['¡Pico y placa, no más!', '¡Rrrrum, que nos oigan!']),
  cause('MARCHA: estudiantes de la pública por la matrícula', 'una marcha de los estudiantes de la pública por la matrícula',
    ['MATRÍCULA\nJUSTA', 'EDUCACIÓN\nPÚBLICA', '¡NO A LA\nALZA!', 'ESTUDIAR\nNO ES LUJO'], ['¡Educación pública, no se vende!', '¡Matrícula justa!']),
  cause('PROTESTA: vendedores ambulantes, los sacaron del andén', 'una protesta de vendedores ambulantes porque los sacaron del andén',
    ['EL ANDÉN\nES DE TODOS', 'DÉJENNOS\nTRABAJAR', 'VENDER NO\nES DELITO', 'NO MÁS\nDESALOJOS'], ['¡Vender no es delito!', '¡Déjenos trabajar!']),
  cause('VOTACIÓN EN LA CALLE: votan para tumbar al presidente', 'están votando en plena calle para tumbar al presidente',
    ['¡VOTE\nAQUÍ!', 'TUMBE AL\nPRESIDENTE', 'URNA DE\nCARTÓN', '¡UN VOTO\nPOR UNA\nEMPANADA!'], ['¡Que voten, que voten!', '¡Urna, urna, urna!']),
  cause('CACEROLAZO: se fue la luz en todo el país', 'un cacerolazo porque se fue la luz en todo el país',
    ['¡LA LUZ,\nLA LUZ!', 'APAGÓN\nNACIONAL', 'VELA EN\nMANO', '¡QUE VUELVA\nLA LUZ!'], ['¡Que vuelva la luz!', '¡Cacerola, cacerola!']),
  cause('PROTESTA: adelantaron el reloj y nadie sabe qué hora es', 'una protesta porque adelantaron el reloj una hora y nadie sabe qué hora es',
    ['¿QUÉ\nHORA ES?', 'DEVUELVAN\nMI HORA', 'EL RELOJ\nMIENTE', 'LLEGUÉ\nTARDE A\nTODO'], ['¿Qué hora es? ¡No sabemos!', '¡Devuelvan la hora!']),
  cause('CACEROLAZO: prohibieron el tinto después de las seis', 'un cacerolazo porque prohibieron el tinto después de las seis',
    ['TINTO\nLIBRE', 'SIN TINTO\nNO HAY PAÍS', '¡QUE SIRVAN\nEL TINTO!', 'LAS SEIS NO\nSON DELITO'], ['¡Sin tinto no hay país!', '¡Tinto, tinto, tinto!']),
  cause('PARO: subieron el pasaje cien pesos', 'un paro porque subieron el pasaje cien pesos',
    ['PASAJE\nJUSTO', '¡NI CIEN\nPESOS MÁS!', 'BUS YA', 'CIEN PESOS\nSON MIS\nCIEN PESOS'], ['¡Ni cien pesos más!', '¡Pasaje justo!']),
  cause('MARCHA: la selección no clasificó al Mundial', 'una marcha porque la selección no clasificó al Mundial',
    ['¡QUE VUELVA\nEL MUNDIAL!', 'SELECCIÓN SIN\nPASAPORTE', 'NOS DEBEN\nUN GOL', '¡AL MUNDIAL\nCON LAS\nMANOS!'], ['¡Al Mundial, al Mundial!', '¡Un gol, un gol!']),
  cause('PARO: lustrabotas, ya nadie usa zapatos de cuero', 'un paro de lustrabotas porque ya nadie usa zapatos de cuero',
    ['LUSTRE\nPARA TODOS', 'DEVUELVAN\nEL CUERO', 'TENIS NO,\nBETÚN SÍ', 'LUSTRABOTAS\nUNIDOS'], ['¡Betún, betún!', '¡Lustre para todos!']),
  cause('PROTESTA: el presidente se autoproclamó presidente otra vez', 'una protesta porque el presidente se autoproclamó presidente otra vez',
    ['YA SE\nPROCLAMÓ\nOTRA VEZ', '¡UNA VEZ\nES SUFICIENTE!', 'PRESIDENTE\nDE SÍ MISMO', '¡QUE SE VAYA\nOTRA VEZ!'], ['¡Otra vez no!', '¡Que se vaya, que se vaya!'])
];

export const pickCause = (random = Math.random) => CAUSES[Math.min(CAUSES.length - 1, Math.floor(random() * CAUSES.length))];

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

/** El genio de una protesta: pacífica, tensa (a veces con un choque corto) o pelea. Los paros se inclinan al conflicto. */
export function rollTemper(random = Math.random, paro = false) {
  const T = PROTEST.tension, r = random();
  const peaceful = paro ? T.paroPeaceful : T.peaceful, tense = paro ? T.paroTense : T.tense;
  if (r < peaceful) return { temper: 'peaceful', shortClash: false };
  if (r < peaceful + tense) return { temper: 'tense', shortClash: random() < T.shortChance };
  return { temper: 'fight', shortClash: false };
}

const TEMPERS = ['peaceful', 'tense', 'fight'];

const PHASES = ['gathering', 'faceoff', 'clash', 'dispersal', 'aftermath', 'cleanup'];
const _sph = new THREE.Sphere(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _c = new THREE.Color();
const SIGN_STICK = new THREE.CylinderGeometry(.025, .025, 1.5, 5), SIGN_BOARD = new THREE.BoxGeometry(.95, .6, .03), SIGN_WOOD = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = x => x * x * (3 - 2 * x);

const FLAMES = 6, SMOKES = 18;
const FIRE_VERTEX = `attribute float aAlpha;
attribute float aSize;
attribute float aTone;
varying float vAlpha;
varying float vTone;
void main() {
  vAlpha = aAlpha;
  vTone = aTone;
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  gl_PointSize = aSize * 260. / max(-mv.z, 1.);
  gl_Position = projectionMatrix * mv;
}`;
const FIRE_FRAGMENT = `varying float vAlpha;
varying float vTone;
void main() {
  float r = length(gl_PointCoord - .5);
  vec3 flame = mix(vec3(1., .78, .25), vec3(1., .38, .08), vTone * 4. + r);
  vec3 color = mix(flame, vec3(.06, .06, .07), smoothstep(.6, 1., vTone));
  gl_FragColor = vec4(color, smoothstep(.5, .1, r) * vAlpha);
}`;
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
    this.cause = null;
    this.chants = CHANTS;
    this.plan = { kind: 'normal', total: gameHours(PROTEST.normalHours) };
    this.standoff = 0;
    this.phases = { ...PROTEST.phases };
    this.tension = 0;
    this.peak = 0;
    this.hostile = 0;
    this.clashes = 0;
    this.clashTime = 0;
    this.tireN = 0;
    this.outcome = null;
    this._melee = [];
    this._thrown = [];
    this._thinTimer = 0;
    this.piles = [];
    this._lit = false;
    this.onPlayerHurt = null;
    this.onProvoked = null;
    this.interaction = null;
    this._onThrown = e => this.noteThrown(e.detail?.projectile);
    globalThis.window?.addEventListener?.('poop-thrown', this._onThrown);
    this._traffic = null;
    this.vehicles = null;
    this.wavers = [];
    this._frustum = new THREE.Frustum();
    this.charge = { phase: 'idle', t: 0 };
    this.deaths = { protesters: 0, cops: 0 };
    this._wreck = 0;
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
    this.cues = this._cues();
    this._tires(make);
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
    const faces = SLOGANS.map((_, i) => new THREE.MeshLambertMaterial({ color: [0xe6dcc4, 0xd9b873, 0xc9d6e0][i % 3] }));
    faces.forEach((face, i) => {
      const canvas = globalThis.document?.createElement?.('canvas');
      if (!canvas) return;
      canvas.width = 256; canvas.height = 160;
      face.map = new THREE.CanvasTexture(canvas);
      face.map.colorSpace = THREE.SRGBColorSpace;
      this._paintFace(face, i, SLOGANS[i]);
    });
    return faces;
  }

  _paintFace(face, i, slogan) {
    const canvas = face.map?.image;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    g.fillStyle = ['#e6dcc4', '#d9b873', '#c9d6e0'][i % 3]; g.fillRect(0, 0, 256, 160);
    g.fillStyle = ['#a1261c', '#1c3b7a', '#222'][i % 3]; g.textAlign = 'center';
    const lines = slogan.split('\n');
    g.font = `bold ${lines.length > 2 || lines.some(l => l.length > 11) ? 32 : 40}px sans-serif`;
    lines.forEach((line, row) => g.fillText(line, 128, 80 + 12 + (row - (lines.length - 1) / 2) * 42));
    face.map.needsUpdate = true;
  }

  /** Las pancartas de esta protesta dicen lo de su causa. */
  _paintSigns(slogans) {
    this.signFaces.forEach((face, i) => this._paintFace(face, i, slogans[i % slogans.length]));
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

  /** Los montones de llantas y su fuego: tres llantas por montón y una nube de partículas de llama y humo negro. */
  _tires(make) {
    this.tires = make(new THREE.TorusGeometry(.32, .13, 6, 12).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1b1b1d }), PROTEST.tires * 3);
    this.tires.instanceColor = null;
    const n = PROTEST.tires * (FLAMES + SMOKES);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    geometry.setAttribute('aTone', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.fire = new THREE.Points(geometry, new THREE.ShaderMaterial({ vertexShader: FIRE_VERTEX, fragmentShader: FIRE_FRAGMENT, transparent: true, depthWrite: false }));
    this.fire.frustumCulled = false;
    this.fire.visible = false;
    this.root.add(this.fire);
  }

  /** Pone los montones entre las dos filas, repartidos a lo ancho de la calle; se prenden en el cara a cara. */
  _placeTires() {
    const side = this._side().clone(), n = PROTEST.tires;
    this.piles = Array.from({ length: n }, (_, i) => {
      const lateral = (i - (n - 1) / 2) * (8.6 / (n - 1)) + (this.random() - .5) * .8, along = 1.6 + this.random() * 1.6;
      const x = this.center.x + this.axis.x * along + side.x * lateral, z = this.center.z + this.axis.z * along + side.z * lateral;
      return { x, z, seed: this.random() };
    });
    this._lit = false;
    this._flushTires(1);
  }

  _flushTires(scale) {
    this.piles.forEach((pile, i) => {
      if (i >= this.tireN) return;
      for (let k = 0; k < 3; k++) {
        _m.compose(_p.set(pile.x + (k % 2 ? .06 : -.05), this._ground(pile.x, pile.z) + (.14 + k * .25) * scale, pile.z + (k === 1 ? .05 : 0)), _q.setFromEuler(_e.set(k * .08, pile.seed * 6 + k, k * .06)), _s.set(scale, scale, scale));
        this.tires.setMatrixAt(i * 3 + k, _m);
      }
    });
    this.tires.count = Math.min(this.piles.length, this.tireN) * 3;
    this.tires.instanceMatrix.needsUpdate = true;
  }

  /** Llamas mientras dura el cara a cara y el choque, apagándose en el desastre; el humo negro dura hasta la limpieza. */
  _burn(dt) {
    if (!this.piles.length) return;
    this._fireClock = (this._fireClock ?? 0) + dt;
    const lit = this.tireN > 0 && (this.state === 'faceoff' || this.state === 'clash' || this.state === 'dispersal' || this.state === 'aftermath' || this.state === 'cleanup');
    if (lit) this._lit = true;
    const flame = !lit ? 0 : this.state === 'aftermath' ? Math.max(0, 1 - this.timer / 40) * .6 : this.state === 'cleanup' ? 0 : 1;
    const smoke = !lit ? 0 : this.state === 'cleanup' ? Math.max(0, 1 - this.timer / this.phases.cleanup) : 1;
    const attr = this.fire.geometry.attributes, pos = attr.position.array, alpha = attr.aAlpha.array, size = attr.aSize.array, tone = attr.aTone.array;
    const t = this._fireClock;
    let n = 0;
    for (const [k, pile] of this.piles.entries()) {
      const gy = this._ground(pile.x, pile.z), on = k < this.tireN ? 1 : 0;
      for (let j = 0; j < FLAMES; j++, n++) {
        const u = (t * 1.6 + j / FLAMES + pile.seed) % 1, a = j * 2.1 + pile.seed * 9 + t * 3;
        pos[n * 3] = pile.x + Math.cos(a) * .22 * (1 - u); pos[n * 3 + 1] = gy + .45 + u * 1.5; pos[n * 3 + 2] = pile.z + Math.sin(a) * .22 * (1 - u);
        alpha[n] = on * flame * (1 - u) * .95; size[n] = 2.2 * (1 - u * .5); tone[n] = u * .25;
      }
      for (let j = 0; j < SMOKES; j++, n++) {
        const u = (t * .13 + j / SMOKES + pile.seed) % 1, a = j * 1.7 + pile.seed * 7 + u * 2;
        pos[n * 3] = pile.x + u * 3.2 + Math.cos(a) * .5 * u; pos[n * 3 + 1] = gy + 1.1 + u * 8; pos[n * 3 + 2] = pile.z + u * 1.4 + Math.sin(a) * .5 * u;
        alpha[n] = on * smoke * .95 * Math.min(1, u * 7) * (1 - u) ** .8; size[n] = 3 + u * 7; tone[n] = 1;
      }
    }
    this.fire.visible = lit;
    attr.position.needsUpdate = attr.aAlpha.needsUpdate = attr.aSize.needsUpdate = attr.aTone.needsUpdate = true;
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
  trigger({ force = false, kind = null, temper = null } = {}) {
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
    this.cause = pickCause(this.random);
    this.chants = this.cause.chants ?? CHANTS;
    const paro = kind ? kind === 'paro' : this.random() < PROTEST.paroChance;
    const roll = rollTemper(this.random, paro);
    if (TEMPERS.includes(temper)) { roll.temper = temper; roll.shortClash = temper === 'tense' && this.random() < PROTEST.tension.shortChance; }
    this.plan = { kind: paro ? 'paro' : 'normal', total: gameHours(paro ? PROTEST.paroHours : roll.temper === 'peaceful' ? PROTEST.peacefulHours : PROTEST.normalHours), ...this._heatPlan(roll) };
    this.phases = { ...PROTEST.phases };
    if (roll.shortClash) this.phases.clash = PROTEST.phases.clash * PROTEST.tension.shortClash;
    this.tension = this.peak = PROTEST.tension.start;
    this.hostile = 0;
    this.clashes = 0;
    this.clashTime = 0;
    this.tireN = 0;
    this.outcome = null;
    this._chantWait = 1.5;
    this._sirenWait = 6;
    this.standoff = 0;
    this._firstFaceoff = true;
    this._paintSigns(this.cause.slogans ?? SLOGANS);
    this.cooldown = PROTEST.cooldown;
    this._enter('gathering');
    this._spawn();
    this.vehicles?.closeSegment?.(this.center.x, this.center.z, PROTEST.closeRadius);
    this._placeCues();
    this._placeTires();
    toast(`Mire, por ahí: ${this.cause.hint}. A ${Math.round(site.dist)} m.`, 'warn');
    this._announce();
    return true;
  }

  /** Cómo sube la tensión sola: hasta dónde y a qué ritmo; las que llegan al umbral van al choque sin que nadie las empuje. */
  _heatPlan({ temper, shortClash }) {
    const T = PROTEST.tension, between = ([lo, hi]) => lo + this.random() * (hi - lo);
    const reach = temper === 'fight' || (temper === 'tense' && shortClash);
    const seconds = temper === 'peaceful' ? T.seconds.peaceful : temper === 'fight' ? between(T.seconds.fight) : shortClash ? between(T.seconds.tenseShort) : T.seconds.tense;
    const cap = reach ? T.threshold : T.caps[temper];
    return { temper, shortClash, reach, cap, rate: (cap - T.start) / seconds };
  }

  /** Sube (o baja) la tensión por lo que hizo alguien; lo que pase del umbral manda a la gente al choque. */
  _bump(amount) {
    const T = PROTEST.tension, before = this.tension;
    this.tension = Math.max(0, Math.min(T.threshold, this.tension + amount));
    this.peak = Math.max(this.peak, this.tension);
    if (before < T.tenseAt && this.tension >= T.tenseAt && amount > 0) toast('Se están calentando los ánimos.', 'warn');
    this._heated();
  }

  _heated() {
    if (this.tireN === 0 && this.tension >= PROTEST.tension.tenseAt) this._ignite(PROTEST.debris.tense.tires);
  }

  /** Prende las primeras llantas (o todas) y las muestra. */
  _ignite(n) {
    if (n <= this.tireN) return;
    this.tireN = Math.min(n, this.piles.length);
    this._flushTires(1);
  }

  /** Lo que el jugador le hace a la gente: pegar o tirar popó a un tombo calienta la cosa rápido; a un manifestante, menos, pero los vuelve contra él. */
  _provokeBy(actor, how) {
    if (!this.active || this.state === 'dispersal' || this.state === 'aftermath' || this.state === 'cleanup') return;
    const T = PROTEST.tension, cop = actor.kind === 'cop';
    this._bump(how === 'poop' ? (cop ? T.poopCop : T.poopProtester) : (cop ? T.hitCop : T.hitProtester));
    if (!cop) this.hostile = Math.min(1, this.hostile + T.hostile);
  }

  /** El golpe del jugador a quien está en la calle (por extraMeleeTargets): le quita salud, a veces lo tumba, y calienta la tensión. */
  _playerHit(actor, hit) {
    if (actor.mode === 'dead' || actor.hidden) return false;
    const damage = Math.max(4, hit?.damage ?? 10);
    this._provokeBy(actor, 'hit');
    actor.hp -= damage * (actor.kind === 'cop' ? .6 : 1.4);
    if (actor.hp <= 0) { this._kill(actor); return 0; }
    actor.stagger = PROTEST.rockStagger;
    if (actor.kind === 'protester' && (actor.mode === 'stand' || actor.mode === 'flee') && this.random() < .35) this._knockDown(actor);
    return 0;
  }

  /** Un proyectil del jugador (popó) en el aire: si le pega a alguien de la protesta, lo toma como provocación. */
  noteThrown(projectile) {
    if (projectile && this.active) this._thrown.push(projectile);
  }

  _thrownStep() {
    if (!this._thrown.length) return;
    this._thrown = this._thrown.filter(p => {
      if (!p.alive) return false;
      const hit = this.actors.find(a => a.mode !== 'dead' && !a.hidden && Math.hypot(a.pos.x - p.position.x, a.pos.z - p.position.z) < .9 && Math.abs(this._ground(a.pos.x, a.pos.z) + .9 - p.position.y) < 1.2);
      if (!hit) return true;
      p.dispose?.();
      p.alive = false;
      this._provokeBy(hit, 'poop');
      return false;
    });
  }

  /** Que el jugador pueda pegarles: las figuras entran a la lista de blancos del puño, con el mismo contrato que los demás. */
  _syncMelee() {
    if (!this._melee.length) return;
    const list = this.player.extraMeleeTargets ?? [];
    if (this._melee.every(m => list.includes(m))) return;
    this.player.extraMeleeTargets = [...list.filter(m => !m.isProtest), ...this._melee];
  }

  /** El cartel de arriba con la causa de esta protesta, aparte del aviso chiquito. */
  _announce() {
    globalThis.window?.dispatchEvent?.(new CustomEvent('protest-alert', { detail: { text: this.cause.alert } }));
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
    const placed = new Set(order.slice(0, Math.min(PROTEST.crowd, this.people.available)));
    const police = Math.min(PROTEST.cops, this.cops.available);
    slots.forEach((slot, i) => {
      if (!placed.has(i)) return;
      const goal = c.clone().addScaledVector(a, slot.along).addScaledVector(side, slot.lateral);
      const start = goal.clone().addScaledVector(a, -(26 + this.random() * 12)).addScaledVector(side, (this.random() - .5) * 8);
      const slogan = i % PROTEST.signEvery === 0 ? i / PROTEST.signEvery % PROTEST.signs : -1;
      const figure = this.people.acquire();
      const actor = this._add(figure, 'protester', start, goal, a, 'hablar');
      actor.slot = goal.clone();
      if (slogan >= 0) {
        actor.sign = this._makeSign(slogan);
        figure.group.add(actor.sign);
      }
      if (slot.rank >= 3) this.wavers.push(actor);
    });
    for (let i = 0; i < police; i++) {
      const figure = this.cops.acquire();
      if (!figure) break;
      const rank = i < 18 ? Math.floor(i / 9) : 2, k = i < 18 ? i % 9 : i - 18;
      const lateral = rank < 2 ? (k - 4) * .85 + rank * .42 : (k - 1.5) * 2.4;
      const goal = c.clone().addScaledVector(a, PROTEST.gap + (rank < 2 ? rank * 1.05 : 4.5)).addScaledVector(side, lateral);
      const start = goal.clone().addScaledVector(a, 28 + this.random() * 6).addScaledVector(side, (this.random() - .5) * 3);
      const cop = this._add(figure, 'cop', start, goal, a.clone().negate(), null);
      cop.slot = goal.clone();
      cop.rank = rank;
    }
  }

  _add(figure, kind, start, goal, facing, stance) {
    const system = this;
    const actor = { figure, kind, pos: start.clone(), goal, facing: Math.atan2(facing.x, facing.z), stance, base: stance, speed: PROTEST.walkSpeed * (.85 + this.random() * .3), proxy: null, arrived: false, gassed: 0,
      mode: kind === 'cop' ? 'line' : 'stand', hp: kind === 'cop' ? PROTEST.copHp : PROTEST.hp, ko: 0, hits: 0, speedNow: 0, melee: { state: 'chase', stateTimer: 0, attackTimer: 0 } };
    figure.group.position.set(start.x, this._ground(start.x, start.z), start.z);
    figure.group.rotation.set(0, Math.atan2(goal.x - start.x, goal.z - start.z), 0);
    this.people.pose?.(figure, { stance, live: true });
    actor.proxy = {
      position: start.clone(), isProtest: true,
      get isKnockedOut() { return actor.mode === 'dead' || actor.mode === 'down' || !!actor.hidden; },
      takeHit: hit => system._playerHit(actor, hit),
      hitByPoop: () => {}
    };
    this.actors.push(actor);
    this._traffic?.push(actor.proxy);
    this._melee.push(actor.proxy);
    return actor;
  }

  _enter(state) {
    this.state = state;
    this.timer = 0;
    this._eventTimer = 0;
    this._dispersed = false;
    this.root.visible = true;
    if (state === 'dispersal') this.phases.dispersal = this._severity() === 'peaceful' ? PROTEST.calmDispersal : PROTEST.phases.dispersal;
    if (state === 'aftermath') {
      this.outcome = this._severity();
      this.phases.aftermath = PROTEST.debris[this.outcome].aftermath;
      this.phases.cleanup = PROTEST.debris[this.outcome].cleanup;
    }
  }

  // ---------- acabar ----------

  _drop(actor) {
    const pool = actor.kind === 'cop' ? this.cops : this.people;
    actor.sign?.removeFromParent();
    if (actor.figure) pool.release(actor.figure);
    if (this._traffic) { const i = this._traffic.indexOf(actor.proxy); if (i >= 0) this._traffic.splice(i, 1); }
    const j = this._melee.indexOf(actor.proxy);
    if (j >= 0) this._melee.splice(j, 1);
    const list = this.player.extraMeleeTargets;
    if (list?.includes(actor.proxy)) { const rest = list.filter(m => m !== actor.proxy); this.player.extraMeleeTargets = rest.length ? rest : null; }
  }

  _releaseActors(keepDead = false) {
    const stay = [];
    for (const actor of this.actors) {
      if (keepDead && actor.mode === 'dead') stay.push(actor);
      else this._drop(actor);
    }
    this.actors = stay;
    this.wavers.length = 0;
  }

  _clearLitter() {
    this.bitsData.length = this.sheetsData.length = 0;
    this.bits.count = this.sheets.count = 0;
    this.rocks.length = this.clouds.length = 0;
    for (const scrap of this.scraps) this.interaction?.unregister?.(scrap);
    this.scraps.length = 0;
    this.gas.visible = false;
    this.piles.length = 0;
    this._lit = false;
    this.tireN = 0;
    this._thrown.length = 0;
    this.audio?.stopProtest?.();
    this.tires.count = 0;
    this.fire.visible = false;
    this._releaseActors();
    this._wreck = 0;
    this.vehicles?.removeWrecks?.();
  }

  /** La calle ya está libre de gente: se quitan las señales y vuelve el tráfico. */
  _reopenStreet() {
    this.cues.group.visible = false;
    this.vehicles?.openSegment?.();
  }

  /** Recuperación tras morir o recargar: nadie en la calle, ni gas, ni basura. */
  reset() {
    this._reopenStreet();
    this._clearLitter();
    if (this.state !== 'idle') this.cooldown = Math.max(this.cooldown, PROTEST.afterReset);
    this.state = 'idle';
    this.charge = { phase: 'idle', t: 0 };
    this.deaths = { protesters: 0, cops: 0 };
    this.root.visible = false;
    this.checkTimer = 0;
  }

  dispose() {
    globalThis.window?.removeEventListener?.('poop-thrown', this._onThrown);
    this.reset();
    this.scene.remove(this.root);
    for (const mesh of [this.bits, this.sheets, this.gas, this.tires, this.fire, ]) { mesh.geometry.dispose?.(); mesh.material.dispose(); }
  }

  // ---------- cada cuadro ----------

  update(dt, { hour = 12, zone = 'andenes', blocked = false, allowSpawn = true, camera = null, clockSpeed = 1 } = {}) {
    if (dt <= 0) return;
    this._camera = camera;
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
    const gameDt = dt * clockSpeed;
    this.timer += gameDt;
    if (this.state === 'faceoff' || this.state === 'clash') this.standoff += gameDt;
    this._eventTimer += dt;
    const phase = this.phases[this.state];
    if (this.state === 'clash') this.clashTime += dt;
    switch (this.state) {
      case 'gathering': this._gather(dt); break;
      case 'faceoff': this._faceoff(dt); break;
      case 'clash': this._clash(dt); break;
      case 'dispersal': this._disperse(dt); break;
      case 'aftermath': case 'cleanup': this._litter(dt); break;
    }
    if (this.state !== 'aftermath' && this.state !== 'cleanup') { this._people(dt); this._moveActors(dt); }
    this._trash(dt);
    this._rocks(dt);
    this._wave(dt);
    this._gas(dt);
    this._burn(dt);
    this._playerEffects(dt);
    this._thrownStep();
    this._meleeTimer = (this._meleeTimer ?? 0) - dt;
    if (this._meleeTimer <= 0) { this._meleeTimer = .5; this._syncMelee(); }
    this._sound(dt);
    if (this.timer >= phase) this._next();
  }

  _next() {
    const i = PHASES.indexOf(this.state);
    if (this.state === 'faceoff' && this.tension < PROTEST.tension.threshold) {
      if (this.standoff < this.plan.total) { this.timer = 0; return; }
      this._enter('dispersal');
      toast(this._severity() === 'peaceful' ? 'La gente se va para la casa caminando, sin afán.' : '¡Corra! Se acabó la protesta.', 'warn');
      return;
    }
    if (this.state === 'clash') this._standDown(true);
    if (this.state === 'dispersal') { this._releaseActors(true); this._reopenStreet(); this._makeLitter(); }
    if (this.state === 'cleanup') { this._clearLitter(); this.state = 'idle'; this.root.visible = false; return; }
    if (this.state === 'clash' && this.standoff < this.plan.total) {
      for (const a of this.actors) {
        if (!a.gassed) continue;
        a.gassed = 0; a.arrived = false; a.stance = 'hablar'; a.speed = PROTEST.walkSpeed; a.goal = a.slot.clone();
      }
      this._cooled();
      this._enter('faceoff');
      toast('Se calmó la cosa un rato, pero nadie se va.', 'info');
      return;
    }
    this._enter(PHASES[i + 1]);
    if (this.state === 'faceoff') {
      toast(this.plan.temper === 'peaceful' ? 'Los tombos formaron la fila. Por ahora todo tranquilo.' : 'Los tombos formaron la fila. Esto se va a poner feo.', this.plan.temper === 'peaceful' ? 'info' : 'warn');
      this._sirenNow();
    }
    if (this.state === 'clash') { this.clashes++; this._ignite(PROTEST.debris.clash.tires); toast('¡Piedras y gas! Aléjese de la calle.', 'death'); this.charge = { phase: 'idle', t: 1.2 }; }
    if (this.state === 'dispersal') toast(this._severity() === 'peaceful' ? 'La gente se va para la casa caminando, sin afán.' : '¡Corra! Se acabó la protesta.', 'warn');
    if (this.state === 'aftermath') {
      this.audio?.stopProtest?.();
      toast(this.outcome === 'peaceful' ? 'Quedaron volantes y cartones en la calle. Algo se rescata.' : 'La calle quedó hecha un desastre. Entre los cartones algo se rescata.', 'info');
    }
  }

  _gather(dt) {
    if (this.actors.every(a => a.arrived)) this.timer = Math.max(this.timer, PROTEST.phases.gathering - .01);
  }

  /** Después de un choque la tensión baja un poco; una tensa de choque corto ya no vuelve a reventar. */
  _cooled() {
    const T = PROTEST.tension;
    this.tension = Math.min(this.tension, T.afterClash);
    this.hostile *= .5;
    if (this.plan.shortClash && this.plan.reach) {
      this.plan.reach = false; this.plan.cap = T.caps.tense; this.plan.rate = (T.caps.tense - T.afterClash) / T.seconds.tense;
    }
  }

  /** El genio de la protesta empuja la tensión; al umbral se acaba el cara a cara. */
  _heat(dt) {
    const p = this.plan, T = PROTEST.tension;
    if (this.tension < p.cap) this.tension = Math.min(p.cap, this.tension + p.rate * dt);
    else if (this.tension > p.cap) this.tension = Math.max(p.cap, this.tension - T.decay * dt);
    this.peak = Math.max(this.peak, this.tension);
    this._heated();
  }

  /** Qué tan feo se puso: pacífica, tensa (se calentó o hubo un choque corto) o choque completo. */
  _severity() {
    if (this.clashes > 0 && this.clashTime >= PROTEST.phases.clash * .5) return 'clash';
    return this.clashes > 0 || this.peak >= PROTEST.tension.tenseAt ? 'tense' : 'peaceful';
  }

  _faceoff(dt) {
    if (this.tension < PROTEST.tension.threshold) this._heat(dt);
    if (this.tension >= PROTEST.tension.threshold || this.standoff >= this.plan.total) { this.timer = this.phases.faceoff; return; }
    if (this._eventTimer >= 5.5) {
      this._eventTimer = 0;
      toast(this.tension >= .4 && this.random() < .35 ? COP_LINES[Math.floor(this.random() * COP_LINES.length)] : this.chants[Math.floor(this.random() * this.chants.length)], 'info');
    }
  }

  _clash(dt) {
    this._chargeStep(dt);
    this._rockTimer = (this._rockTimer ?? 0) - dt;
    this._canisterTimer = (this._canisterTimer ?? 0) - dt;
    const police = this.actors.filter(a => a.kind === 'cop');
    if (this._rockTimer <= 0 && police.some(a => a.mode !== 'dead')) {
      this._rockTimer = PROTEST.rockEvery * (.6 + this.random() * .8);
      const crowd = this.actors.filter(a => a.kind === 'protester' && a.mode === 'stand' && !a.action && !a.hidden && !a.gassed && a.arrived);
      if (crowd.length) this._pickUp(crowd[Math.floor(this.random() * crowd.length)]);
    }
    if (this._canisterTimer <= 0 && police.length && this.clouds.length < PROTEST.canisterLimit) {
      this._canisterTimer = PROTEST.canisterEvery * (.7 + this.random() * .6);
      const from = police[Math.floor(this.random() * police.length)].pos, side = this._side();
      _p.copy(this.center).addScaledVector(this.axis, -(1 + this.random() * 7)).addScaledVector(side, (this.random() - .5) * 8);
      this._throw(from, _p.x, _p.z, 1.6, 'canister');
    }
  }

  _along(p) { return (p.x - this.center.x) * this.axis.x + (p.z - this.center.z) * this.axis.z; }
  _lateral(p) { return Math.abs((p.x - this.center.x) * this.axis.z - (p.z - this.center.z) * this.axis.x); }

  _between(p) { return Math.abs(this._along(p)) < PROTEST.gap + 2 && this._lateral(p) < 9; }

  /** En medio del lío: entre las filas o metido en la multitud. */
  _inFray(p) { const along = this._along(p); return along > -14 && along < PROTEST.gap + 3 && this._lateral(p) < 14; }

  // ---------- la carga ----------

  /** Aviso, carga, regreso a la fila y pausa; se repite mientras dure el choque. */
  _chargeStep(dt) {
    const c = this.charge;
    c.t -= dt;
    if (c.phase === 'idle' && c.t <= 0) {
      c.phase = 'warn'; c.t = PROTEST.warnTime;
      toast(COP_LINES[1], 'death');
    } else if (c.phase === 'warn' && c.t <= 0) this._launch();
    else if (c.phase === 'run' && (c.t <= 0 || !this.actors.some(a => a.mode === 'charge' || a.mode === 'drag'))) this._standDown(false);
    else if (c.phase === 'regroup' && (c.t <= 0 || this.actors.every(a => a.kind !== 'cop' || a.mode === 'line' || a.mode === 'dead'))) { c.phase = 'idle'; c.t = PROTEST.chargeGap; }
  }

  /** La fila se rompe: cada tombo de adelante corre tras el manifestante más cercano, y a quien esté en medio le tocan dos. */
  _launch() {
    const c = this.charge, free = new Set();
    const cops = this.actors.filter(a => a.kind === 'cop' && a.mode === 'line' && a.rank < 2).slice(0, PROTEST.chargers);
    const crowd = this.actors.filter(a => a.kind === 'protester' && a.mode === 'stand' && !a.hidden);
    for (const cop of cops) {
      let best = null, bestSq = Infinity;
      for (const p of crowd) {
        if (free.has(p)) continue;
        const sq = (p.pos.x - cop.pos.x) ** 2 + (p.pos.z - cop.pos.z) ** 2;
        if (sq < bestSq) { best = p; bestSq = sq; }
      }
      if (best) free.add(best);
      this._send(cop, best);
    }
    const me = this.player.position;
    const enraged = this.hostile > PROTEST.tension.hostileLimit && Math.hypot(me.x - this.center.x, me.z - this.center.z) < 30;
    if (this.stats.salud > 0 && (this._inFray(me) || enraged)) {
      cops.sort((x, y) => (x.pos.x - me.x) ** 2 + (x.pos.z - me.z) ** 2 - (y.pos.x - me.x) ** 2 - (y.pos.z - me.z) ** 2);
      for (const cop of cops.slice(0, 2 + (enraged ? Math.round(this.hostile * 3) : 0))) cop.target = this.player;
    }
    this._sirenNow();
    for (const p of crowd) if (!free.has(p) && this._along(p.pos) > -9 && this.random() < .6) this._flee(p);
    c.phase = 'run'; c.t = PROTEST.chargeTime;
    toast('¡Cargan los tombos! ¡Corra!', 'death');
  }

  _send(cop, target) {
    cop.mode = 'charge'; cop.target = target; cop.driven = true;
    cop.melee = { state: 'chase', stateTimer: 0, attackTimer: .2 + this.random() * .6 };
    if (target) this._flee(target);
  }

  _flee(p) {
    if (p.mode !== 'stand') return;
    p.mode = 'flee'; p.stance = 'huir'; p.arrived = false; p.speed = PROTEST.runSpeed * (.55 + this.random() * .35);
    p.goal = p.pos.clone().addScaledVector(this.axis, -(16 + this.random() * 14)).addScaledVector(this._side(), (this.random() - .5) * 16);
  }

  /** Los tombos vuelven a la fila y la gente a su puesto. `hard`: ya se acabó el choque, nadie se queda corriendo. */
  _standDown(hard) {
    this.charge = { phase: 'regroup', t: PROTEST.regroupTime };
    if (hard) this.charge = { phase: 'idle', t: PROTEST.chargeGap };
    for (const a of this.actors) {
      if (a.kind === 'cop') {
        if (a.mode === 'line' || a.mode === 'dead') continue;
        if (a.mode === 'drag' && !hard) { a.target = null; continue; }
        if (a.victim) { this._knockDown(a.victim); a.victim = null; }
        a.mode = 'return'; a.target = null; a.attack = null; a.driven = false; a.arrived = false; a.goal = a.slot.clone(); a.speed = 3.6;
        a.melee = { state: 'chase', stateTimer: 0, attackTimer: 0 };
      } else if (a.mode === 'flee' || a.mode === 'fight' || a.mode === 'drag') {
        a.mode = 'stand'; a.attack = null; a.driven = false; a.arrived = false; a.stance = 'hablar'; a.speed = PROTEST.walkSpeed * 1.4; a.goal = a.slot.clone();
      }
    }
  }

  /** Cada cuadro: los tombos que persiguen, arrastran o vuelven, y la gente que huye, cae, se levanta o responde. */
  _people(dt) {
    for (const a of this.actors) {
      a.stagger = Math.max(0, (a.stagger ?? 0) - dt);
      a.speedNow = 0;
      a.driven = false;
      if (a.kind === 'cop') this._copStep(a, dt);
      else this._personStep(a, dt);
    }
  }

  _turn(a, x, z, dt, rate = 10) { a.facing += wrap(Math.atan2(x - a.pos.x, z - a.pos.z) - a.facing) * Math.min(1, dt * rate); }

  _copStep(a, dt) {
    if (a.mode === 'dead') { this._dying(a, dt); return; }
    if (a.mode === 'return') {
      if (a.arrived) { a.mode = 'line'; a.speed = PROTEST.walkSpeed; }
      return;
    }
    if (a.mode === 'drag') { this._dragStep(a, dt); return; }
    if (a.mode !== 'charge') return;
    a.driven = true;
    if (a.stagger > 0) return;
    a.melee.attackTimer = Math.max(0, a.melee.attackTimer - dt);
    const target = a.target, me = this.player;
    const valid = t => t && (t === me ? this.stats.salud > 0 : !t.hidden && t.mode !== 'dead' && t.hits < PROTEST.beatings);
    if (!valid(target)) { this._retarget(a); return; }
    const spot = target === me ? me.position : target.pos;
    this._turn(a, spot.x, spot.z, dt);
    const result = stepMelee(a.melee, dt, spot, {
      speed: PROTEST.chargeSpeed,
      reach: (t, range) => Math.hypot(t.x - a.pos.x, t.z - a.pos.z) <= range,
      move: (t, speed, step, stop) => {
        const dx = t.x - a.pos.x, dz = t.z - a.pos.z, dist = Math.hypot(dx, dz);
        if (dist <= stop) return;
        const run = Math.min(dist - stop, speed * step);
        a.pos.x += dx / dist * run; a.pos.z += dz / dist * run;
        a.speedNow = speed;
      },
      pose: (phase, length) => { a.attack = phase ? { weapon: 'botella_picada', step: 0, phase, progress: 1 - Math.max(0, a.melee.stateTimer) / length } : null; }
    });
    if (result === 'hit') this._baton(a, target);
  }

  /** El que ya recibió su parte se deja: el tombo busca otro cerca o se devuelve. */
  _retarget(a) {
    const me = this.player;
    if (this.stats.salud > 0 && this._inFray(me.position) && this.actors.filter(o => o.target === me).length < 2) { a.target = me; return; }
    let best = null, bestSq = 20 * 20;
    for (const p of this.actors) {
      if (p.kind !== 'protester' || p.hidden || p.hits >= PROTEST.beatings || (p.mode !== 'stand' && p.mode !== 'flee')) continue;
      if (this.actors.some(o => o.target === p)) continue;
      const sq = (p.pos.x - a.pos.x) ** 2 + (p.pos.z - a.pos.z) ** 2;
      if (sq < bestSq) { best = p; bestSq = sq; }
    }
    if (best) { a.target = best; this._flee(best); a.melee.state = 'chase'; return; }
    a.mode = 'return'; a.target = null; a.attack = null; a.driven = false; a.arrived = false; a.goal = a.slot.clone(); a.speed = 3.6;
  }

  /** El bolillazo: al jugador le quita salud por el flujo de siempre; a un manifestante lo tumba, lo arrastra o lo pone a pelear. */
  _baton(cop, target) {
    if (target === this.player) {
      const damage = Math.round(PROTEST.batonDamage[0] + this.random() * (PROTEST.batonDamage[1] - PROTEST.batonDamage[0]));
      this.stats.salud = Math.max(0, this.stats.salud - damage);
      toast(`¡Un bolillazo! −${damage} de salud.`, 'death');
      this.onPlayerHurt?.();
      return;
    }
    const p = target;
    p.hits++;
    p.hp -= PROTEST.beatDamage[0] + this.random() * (PROTEST.beatDamage[1] - PROTEST.beatDamage[0]);
    if (p.hp <= 0) { this._kill(p); return; }
    if (p.mode === 'stand' || p.mode === 'flee') {
      const roll = this.random();
      if (roll < PROTEST.fallChance) this._knockDown(p);
      else if (roll < PROTEST.fallChance + PROTEST.dragChance) this._grab(cop, p);
      else { p.mode = 'fight'; p.foe = cop; p.fightT = PROTEST.fightTime; p.punchT = 0; p.arrived = true; p.goal = p.pos.clone(); p.stance = null; }
    } else if (p.mode === 'fight' && p.hits >= 2) this._knockDown(p);
  }

  /** Muere el tombo o el manifestante: cae y queda tendido en el desastre hasta la limpieza. Nada de sangre, solo la siesta eterna. */
  _kill(a) {
    if (a.mode === 'dead') return;
    if (a.victim) { this._knockDown(a.victim); a.victim = null; }
    if (a.kind === 'protester' && a.foe) a.foe = null;
    a.mode = 'dead'; a.ko = 0; a.target = null; a.attack = null; a.action = null; a.arrived = true; a.goal = a.pos.clone(); a.stance = null;
    if (a.sign) { a.sign.removeFromParent(); a.sign = null; }
    this.deaths[a.kind === 'cop' ? 'cops' : 'protesters']++;
    toast(a.kind === 'cop' ? 'Un tombo quedó tendido. Los compañeros ni lo miran.' : 'Un manifestante quedó tendido. Alguien gritó que llamen a la ambulancia.', 'death');
  }

  _dying(a, dt) {
    a.driven = true;
    a.ko = Math.min(1, a.ko + dt / .9);
  }

  _knockDown(p) {
    p.mode = 'down'; p.ko = 0; p.koTimer = 5 + this.random() * 3; p.stance = null; p.attack = null; p.arrived = true; p.goal = p.pos.clone();
  }

  /** Lo agarra del brazo y se lo lleva por detrás de la fila; ahí lo suelta. */
  _grab(cop, p) {
    p.mode = 'drag'; p.stance = 'nariz'; p.arrived = true; p.goal = p.pos.clone();
    cop.mode = 'drag'; cop.victim = p; cop.target = null; cop.attack = null; cop.melee = { state: 'chase', stateTimer: 0, attackTimer: 0 };
    cop.dragGoal = cop.slot.clone().addScaledVector(this.axis, 5);
  }

  _dragStep(cop, dt) {
    cop.driven = true;
    const p = cop.victim, goal = cop.dragGoal, dx = goal.x - cop.pos.x, dz = goal.z - cop.pos.z, dist = Math.hypot(dx, dz);
    if (dist > .6) {
      const step = Math.min(dist, PROTEST.dragSpeed * dt);
      cop.pos.x += dx / dist * step; cop.pos.z += dz / dist * step;
      cop.speedNow = PROTEST.dragSpeed;
      this._turn(cop, goal.x, goal.z, dt);
    }
    if (p) { p.pos.x = cop.pos.x - dx / (dist || 1) * .8; p.pos.z = cop.pos.z - dz / (dist || 1) * .8; p.speedNow = dist > .6 ? PROTEST.dragSpeed : 0; p.facing = cop.facing; p.driven = true; }
    if (dist > .6) return;
    if (p) this._knockDown(p);
    cop.victim = null;
    if (this.charge.phase === 'run') { cop.mode = 'charge'; this._retarget(cop); } else { cop.mode = 'return'; cop.driven = false; cop.arrived = false; cop.goal = cop.slot.clone(); cop.speed = 3.6; }
  }

  _personStep(a, dt) {
    if (a.mode === 'dead') { this._dying(a, dt); return; }
    if (a.mode === 'down') {
      a.driven = true;
      a.ko = Math.min(1, a.ko + dt / .7);
      if (a.ko >= 1 && (a.koTimer -= dt) <= 0) a.mode = 'rise';
    } else if (a.mode === 'rise') {
      a.driven = true;
      a.ko = Math.max(0, a.ko - dt / 1.5);
      if (a.ko <= 0) {
        a.mode = 'stand'; a.arrived = false; a.hits = Math.max(a.hits, PROTEST.beatings);
        if (this.state === 'dispersal') { a.goal = a.fleeGoal ?? a.pos.clone(); a.speed = PROTEST.runSpeed; a.stance = 'huir'; }
        else if (this.charge.phase === 'run') this._flee(a);
        else { a.goal = a.slot.clone(); a.speed = PROTEST.walkSpeed * 1.4; a.stance = 'hablar'; }
      }
    } else if (a.mode === 'fight') {
      a.driven = true;
      a.fightT -= dt;
      a.punchT += dt;
      if (a.foe) this._turn(a, a.foe.pos.x, a.foe.pos.z, dt);
      const period = .7, progress = (a.punchT % period) / period;
      a.attack = { weapon: 'punos', step: Math.floor(a.punchT / period) % 2, phase: progress < .3 ? 'windup' : progress < .6 ? 'active' : 'recover', progress: progress < .3 ? progress / .3 : progress < .6 ? (progress - .3) / .3 : (progress - .6) / .4 };
      if (a.foe && !a.punched && progress >= .45 && progress < .6 && Math.hypot(a.foe.pos.x - a.pos.x, a.foe.pos.z - a.pos.z) < 2) { a.punched = true; a.foe.stagger = .6; a.foe.melee.state = 'chase'; }
      if (progress < .3) a.punched = false;
      if (a.fightT <= 0) { a.attack = null; a.mode = 'stand'; a.foe = null; a.hits++; a.driven = false; this._flee(a); }
    } else if (a.mode === 'flee' && a.arrived) {
      a.mode = 'stand'; a.stance = 'hablar';
    }
    if (a.action) this._actionStep(a, dt);
  }

  // ---------- las piedras de la gente ----------

  /** Se agacha a recoger una piedra; luego la tira. */
  _pickUp(a) {
    a.action = 'buscar'; a.actionT = 0; a.actionLen = .8; a.thrown = false;
  }

  _actionStep(a, dt) {
    a.driven = true;
    a.actionT += dt;
    if (a.mode !== 'stand' || a.gassed || a.hidden) { a.action = null; return; }
    if (a.action === 'buscar') {
      if (a.actionT >= a.actionLen) { a.action = 'lanzar'; a.actionT = 0; a.actionLen = .65; a.aim = this._aim(a); }
      return;
    }
    this._turn(a, a.aim.x, a.aim.z, dt, 14);
    if (!a.thrown && a.actionT >= .3) { a.thrown = true; this._throw(a.pos, a.aim.x, a.aim.z, a.aim.time, 'rock'); }
    if (a.actionT >= a.actionLen) a.action = null;
  }

  /** A quién le tira: casi siempre a la fila de tombos, y al jugador si anda en medio. */
  _aim(a) {
    const me = this.player.position, police = this.actors.filter(o => o.kind === 'cop' && o.mode !== 'dead');
    const turned = this.hostile > PROTEST.tension.hostileLimit && Math.hypot(me.x - this.center.x, me.z - this.center.z) < 28;
    if (this.stats.salud > 0 && (this._between(me) || turned) && this.random() < PROTEST.strayChance + (turned ? this.hostile * .5 : 0)) {
      return { x: me.x + (this.random() - .5) * 1.2, z: me.z + (this.random() - .5) * 1.2, time: 1.1 };
    }
    const to = police.length ? police[Math.floor(this.random() * police.length)].pos : this.center;
    return { x: to.x + (this.random() - .5), z: to.z + (this.random() - .5), time: 1.2 };
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
      if (rock.kind === 'rock' && !rock.hit) {
        const cop = this.actors.find(a => a.kind === 'cop' && a.mode !== 'dead' && Math.hypot(rock.x - a.pos.x, rock.z - a.pos.z) < .7 && rock.y > ground && rock.y < ground + 1.9);
        if (cop) {
          rock.hit = true; rock.landed = true; this._place(rock);
          cop.stagger = PROTEST.rockStagger;
          cop.hp -= PROTEST.copRockDamage[0] + this.random() * (PROTEST.copRockDamage[1] - PROTEST.copRockDamage[0]);
          if (cop.hp <= 0) this._kill(cop);
          continue;
        }
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
      mesh.setColorAt(i, _c.set(b.kind === 'canister' ? 0x2e3a2c : b.kind === 'stick' ? 0x6b4a2b : b.kind === 'burnt' ? 0x151515 : b.kind === 'trash' ? 0xa7a49b : 0x77736c));
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

  // ---------- sonido ----------

  _soundDistance() {
    const me = this.player.position;
    return Math.hypot(me.x - this.center.x, me.z - this.center.z);
  }

  /** La sirena del paro y de los tombos: una sola a la vez, con volumen por distancia. */
  _sirenNow() {
    this.audio?.playProtest?.('siren', this._soundDistance());
  }

  /** El grito de la multitud se repite en la concentración y el cara a cara (también entre choques); la sirena, en los paros. */
  _sound(dt) {
    const audio = this.audio;
    if (!audio?.playProtest) return;
    const distance = this._soundDistance();
    audio.updateProtest?.(distance);
    this._chantWait = Math.max(0, (this._chantWait ?? 0) - dt);
    if ((this.state === 'gathering' || this.state === 'faceoff') && this._chantWait <= 0 && audio.playProtest('chant', distance)) {
      this._chantWait = PROTEST.chantGap[0] + this.random() * (PROTEST.chantGap[1] - PROTEST.chantGap[0]);
    }
    this._sirenWait = Math.max(0, (this._sirenWait ?? 0) - dt);
    if (this.plan.kind === 'paro' && (this.state === 'faceoff' || this.state === 'clash') && this._sirenWait <= 0) {
      this._sirenWait = PROTEST.sirenGap[0] + this.random() * (PROTEST.sirenGap[1] - PROTEST.sirenGap[0]);
      this._sirenNow();
    }
  }

  // ---------- gente ----------

  /** En un paro grande la multitud se afloja y se vuelve a llenar: parte de la gente instanciada se va caminando y regresa. */
  _wave(dt) {
    if (this.plan.kind !== 'paro' || this.state === 'gathering' || this.state === 'dispersal' || !this.wavers.length) return;
    this._thinTimer -= dt;
    if (this._thinTimer > 0) return;
    this._thinTimer = .6;
    const level = .45 + .55 * (.5 + .5 * Math.sin(this.standoff / gameHours(3) * Math.PI * 2));
    const keep = Math.round(level * this.wavers.length), side = this._side().clone();
    for (let k = 0; k < this.wavers.length; k++) {
      const a = this.wavers[k], want = k < keep;
      if (a.mode !== 'stand') continue;
      if (!want && !a.away) {
        a.away = true; a.arrived = false; a.stance = null; a.speed = PROTEST.walkSpeed;
        a.goal = a.pos.clone().addScaledVector(side, (k % 2 ? 1 : -1) * 40);
        return;
      }
      if (want && a.away) {
        a.away = false; a.hidden = false; a.arrived = false; a.stance = 'hablar'; a.speed = PROTEST.walkSpeed * 1.3;
        a.goal = a.slot.clone();
        return;
      }
    }
  }

  _disperse(dt) {
    if (!this._dispersed) {
      this._dispersed = true;
      this._standDown(true);
      for (const a of this.actors) {
        if (a.mode === 'dead') continue;
        a.away = false; a.hidden = false;
        if (a.kind === 'protester') {
          _p.copy(a.pos).sub(this.center).addScaledVector(this.axis, -2).setY(0);
          const angle = Math.atan2(_p.x, _p.z) + (this.random() - .5) * 1.8;
          a.goal = a.pos.clone().add(new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(45));
          const calm = this._severity() === 'peaceful';
          a.speed = calm ? PROTEST.walkSpeed * (1 + this.random() * .4) : PROTEST.runSpeed * (.8 + this.random() * .4); a.stance = calm ? null : 'huir'; a.arrived = false; a.fleeGoal = a.goal.clone();
          if (a.mode === 'down') a.koTimer = Math.min(a.koTimer, .5);
        } else {
          a.goal = a.pos.clone().addScaledVector(this.axis, -5); a.stance = null; a.speed = 1.6; a.arrived = false;
        }
      }
    }
  }

  _moveActors(dt) {
    this._frame = (this._frame ?? 0) + 1;
    const view = this.player.position, camera = this._camera;
    if (camera) this._frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.actors.forEach((a, i) => {
      let speed = a.speedNow;
      if (!a.driven) {
        speed = 0;
        const dx = a.goal.x - a.pos.x, dz = a.goal.z - a.pos.z, dist = Math.hypot(dx, dz);
        if (dist > .25) {
          speed = a.speed;
          const step = Math.min(dist, speed * dt);
          a.pos.x += dx / dist * step; a.pos.z += dz / dist * step;
          a.facing += wrap(Math.atan2(dx, dz) - a.facing) * Math.min(1, dt * 8);
        } else if (!a.arrived) {
          a.arrived = true;
          if (a.away) a.hidden = true;
          a.facing = a.kind === 'cop' ? Math.atan2(-this.axis.x, -this.axis.z) : Math.atan2(this.axis.x, this.axis.z);
        }
        if (this.state === 'clash' && a.kind === 'protester' && a.arrived && a.mode === 'stand') {
          const gassed = this._inGas(a.pos.x, a.pos.z);
          if (gassed && !a.gassed) { a.gassed = 1; a.stance = 'nariz'; a.goal = a.pos.clone().addScaledVector(this.axis, -9); a.speed = PROTEST.runSpeed * .7; a.arrived = false; }
        }
      }
      a.speedNow = speed;
      const g = a.figure.group, ground = this._ground(a.pos.x, a.pos.z);
      a.proxy.position.set(a.pos.x, ground, a.pos.z);
      // Lo que la cámara no ve, o está muy lejos, ni se dibuja ni se anima.
      const seen = !camera || (this._frustum.intersectsSphere(_sph.set(_p.set(a.pos.x, ground + 1, a.pos.z), 2.4)) && (a.pos.x - view.x) ** 2 + (a.pos.z - view.z) ** 2 < 110 * 110);
      g.visible = !a.hidden && seen;
      if (a.hidden || !seen || (a.settled && a.mode === 'dead')) return;
      g.position.set(a.pos.x, ground, a.pos.z);
      g.rotation.y = a.facing;
      // Lejos de la cámara se anima a menor ritmo: la persona se ve igual y cuesta una fracción.
      a.animAcc = (a.animAcc ?? 0) + dt;
      const sq = (a.pos.x - view.x) ** 2 + (a.pos.z - view.z) ** 2;
      const every = sq < 484 ? 1 : sq < 2025 ? 2 : sq < 6400 ? 4 : 8;
      if (every > 1 && (this._frame + i) % every !== 0 && !a.action && !a.attack && a.mode !== 'down' && a.mode !== 'rise') return;
      const walking = speed > 0 && a.stance !== 'huir' && a.stance !== 'nariz';
      a.figure.character.update(Math.min(a.animAcc, .25), {
        speed, running: speed > 4, stance: walking ? null : a.stance, stanceWeight: 1,
        ko: smooth(a.ko), koRising: a.mode === 'rise', koPlan: 'espalda', attack: a.attack ?? null,
        action: a.action ?? null, actionProgress: a.action ? Math.min(1, a.actionT / a.actionLen) : 0
      });
      a.animAcc = 0;
      if (a.mode === 'dead' && a.ko >= 1) a.settled = true;
    });
  }

  /** La gente se va poniendo más maltrecha: a medida que sube el choque, los carros atrapados se van rompiendo. */
  _trash(dt) {
    if (this.state !== 'clash') return;
    const before = this._wreck;
    this._wreck = Math.min(1, this._wreck + dt / PROTEST.wreckTime);
    if (Math.floor(this._wreck * 20) !== Math.floor(before * 20)) this.vehicles?.setWreckLevel?.(this._wreck);
  }

  // ---------- el desastre ----------

  _makeLitter() {
    const { center: c, axis: a } = this, side = this._side().clone(), r = () => this.random();
    const D = PROTEST.debris[this._severity()];
    const spread = (kind, n, s0, s1, extra = {}) => {
      for (let i = 0; i < n; i++) this.bitsData.push({ kind, x: c.x + a.x * (r() - .5) * 16 + side.x * (r() - .5) * 12, z: c.z + a.z * (r() - .5) * 16 + side.z * (r() - .5) * 12, y: 0, s: s0 + r() * s1, ry: r() * 6, ...extra });
    };
    spread('trash', D.trash, .1, .06);
    spread('stick', D.sticks, .09, .05);
    spread('rock', D.rocks, .1, .08);
    for (let i = 0; i < D.burnt; i++) this.bitsData.push({ kind: 'burnt', x: c.x - a.x * (2 + r() * 5) + side.x * (r() - .5) * 8, z: c.z - a.z * (2 + r() * 5) + side.z * (r() - .5) * 8, y: 0, s: .35 + r() * .25, ry: r() * 6 });
    for (const b of this.bitsData) if (b.kind !== 'canister') b.y = this._ground(b.x, b.z) + (b.kind === 'rock' ? .06 : .05);
    this._flush();
    this.sheetsData = [];
    for (let i = 0; i < D.sheets; i++) {
      const board = i < PROTEST.scraps, banner = !board && i % 4 >= 2;
      this.sheetsData.push({ x: c.x - a.x * (1 + r() * 9) + side.x * (r() - .5) * 11, z: c.z - a.z * (1 + r() * 9) + side.z * (r() - .5) * 11, w: (.8 + r() * .5) * (banner ? 1.8 : 1), d: .5 + r() * .5, ry: r() * 6, color: board ? 0x9a7549 : [0xd9d2c3, 0xb23a30, 0x2f5fa8, 0xe0b72f][i % 4], scale: 1 });
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
    const k = 1 - this.timer / this.phases.cleanup;
    for (const s of this.sheetsData) if (s.scale > 0) s.scale = Math.min(1, k * 1.2);
    for (const scrap of this.scraps) if (k < .6 && !scrap.used) { scrap.used = true; this.interaction?.unregister?.(scrap); }
    this._flushSheets();
    this.bits.count = Math.ceil(this.bitsData.length * k);
    this._flushTires(Math.min(1, k * 1.2));
  }
}
