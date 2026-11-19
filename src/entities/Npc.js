// src/entities/Npc.js
// Persona de la calle (ambiente): personaje realista que se queda quieto, deambula cerca o recorre la
// red peatonal del distrito. Su arquetipo (ver character/archetypes.js) decide cómo se ve, cómo anda y
// qué hace al terminar un recorrido; `opts.fijo` la deja en su sitio toda la partida, salvo que la asusten.
//
// Rendimiento: de lejos usa la versión liviana (cuerpo proxy de MakeHuman y piezas simplificadas);
// la completa se precarga al iniciar y se muestra al acercarse: a 7 m quien anda y a 4 m quien sigue en su sitio, que se
// ve menos. Fuera de cámara no se dibuja ni se anima, y la animación se actualiza menos seguido a media distancia.
import * as THREE from 'three';
import { createRealisticCharacter, loadCatalog, normalizeReal, REALISTIC_SCALE } from '../character/RealisticCharacter.js';
import { KO_PLANS, RISE_TIME, smooth } from '../character/BodyLanguage.js';
import { HitLean } from '../character/HitLean.js';
import { LOW_STANCES, SEARCH_ACTION, personLook, pickArchetype, pickStop, pickWalk, rollPerson } from '../character/archetypes.js';
import { UMBRELLA_REST, createCane, createPhone, createUmbrella } from '../character/props.js';
import { streetCaneContactY } from '../character/streetCane.js';
import { BENCH_EXIT, benchPush, HAND_ON_FLOOR } from '../character/stances.js';
import { WEAPONS } from '../data/weapons.js';
import { canReachCombatTarget, resolveCombatWalk } from '../systems/CombatGeometry.js';
import { canGreet } from '../systems/StreetVoices.js';
import { acabarFrase, empezarFrase } from '../ui/frases.js';
import { esElJugador, vocesDelJuego } from '../systems/voces/acceso.js';
import { CONVERSATION_FLOOR_GAP, onSidewalk } from './npc/conversationSpace.js';
import { sideStepRoom } from './npc/steering.js';
import { seededRandom } from './npc/mind.js';

const any = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Gritos y quejas de los peatones en Bogotá
const POOP_SCREAMS = [
  '¡¡AY QUÉ ASCO, ME CAYÓ POPÓ!!',
  '¡¡GONORREA COCHINO, ME TIRÓ POPÓ!!',
  '¡¡POLICÍA, UN LOCO ME ESTÁ TIRANDO MIERDA!!',
  '¡¡GAS, QUÉ COCHINADA TAN HIJUEPUTA!!',
  '¡¡QUÉ PESTILENCIA, AUXILIO ME EMBARRARON!!',
  '¡¡MALDITO ENFERMO, ME LAS VA A PAGAR!!'
];
const THEFT_SCREAMS = [
  '¡¡LADRÓN, ME ESTÁ ROBANDO!!',
  '¡¡GONORREA, SUÉLTEME EL BOLSILLO!!',
  '¡¡AUXILIO, ME QUIEREN ROBAR!!',
  '¡¡POLICÍA, COJAN A ESE RATERO!!',
  '¡¡QUITE LA MANO DE AHÍ, HIJUEPUTA!!'
];

// Distancias (m) al jugador
export const NPC_LOD = {
  fullIn: 7,       // cerca: pasa al modelo completo
  fullOut: 10,     // se aleja: vuelve al liviano (histéresis para que no parpadee)
  fixedIn: 4,      // quien sigue quieto en su sitio entra más cerca: en un grupo no cambian todos a la vez
  fixedOut: 6,
  animEvery: 20,   // más allá: animación cada 3 cuadros
  animStop: 40,    // más allá: animación congelada
  drawMargin: 4    // en baja, un peatón ya dibujado aguanta esto más allá del límite: no parpadea en el borde
};

export const NPC_HIT_REACTION_DURATION = .48;
const FUERZA_INCLINACION = 1 / 1.5;
const RITMO_INCLINACION = 1.8;


// Lo que dice cualquiera, además de lo de su arquetipo.
const GREETINGS = [
  'Buenas tardes, vecino.',
  'Dios lo bendiga, vecino.',
  'Qué frío tan berraco hace hoy.',
  'Pilas con los carros en la Caracas.',
  'Pilas por la 19 que está caliente.'
];

const BOGOTA_PHRASES = [
  ...GREETINGS,
  '¿Tiene una monedita que le sobre?',
  'Mucho juicio, mi rey.',
  'Tome 500 para un pan, mijo.'
];

const BOGOTA_DIRTY_PHRASES = [
  '¡Uff, aléjese que huele a caño!',
  'Vaya al caño a pegarse una lavada.',
  '¡Paso, paso, no se me pegue!',
  '¡Gas, qué tufo!'
];

const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.4);
const _solids = [];
const FLEE_BODY = .2; // m de radio del cuerpo al huir
const CHANGED_UNSEEN = .3; // s sin animarse: lo que hizo mientras tanto nadie lo vio

// A cero la caída termina en una pose fija. Las acciones del personaje terminan al recibir el golpe.
export const NPC_HEALTH = 100;
export const NPC_COMBAT = {
  stagger: 0.28,   // s de sacudón tras cada golpe (no camina; el golpe lo empuja)
  flee: 5,         // s de huida veloz tras recibir un golpe
  fall: 0.7,       // s en caer: primero ceden las rodillas, después se va de espaldas
  counterWindup: .35,
  counterWarning: .18, // s de guardia visible antes del primer movimiento
  knifeWarning: .35, // s adicionales con el cuchillo a la vista antes de preparar el golpe
  counterActive: .1,
  counterRecovery: .22
};

// Integral de la velocidad que baja linealmente a cero durante el aturdimiento.
function avanceEmpujon(restante, dt = restante) {
  const tiempo = Math.min(dt, restante);
  return tiempo * (restante - tiempo / 2) / NPC_COMBAT.stagger;
}

const DEFENSE_PHRASES = [
  '¡A mí no me viene a montar la perseguidora, ñero!',
  '¡Tome pa\' que lleve, respete a la gente!',
  '¡Aquí no le vamos a copiar, atrevido!'
];
const HIT_PHRASES = [
  '¡Uy qué le pasa, ñero loco!',
  '¡Ayúdenme, me están atracando!',
  '¡Policía, policía!',
  '¡Socio, no me pegue, tome esto!',
  '¡Qué boleta, bájese de la nube!'
];

// Conductas de quien tiene arquetipo.
const CONDUCT = {
  stopMin: 4, stopExtra: 16,  // s de una parada
  breathMin: .4, breathExtra: 1.4, // s de un respiro donde no se puede parar o no quiere
  rooted: 40,      // m: lejos de su sitio, prefiere el recorrido que lo acerque
  startStopped: .35, // parte de los caminantes que ya está parada al empezar la partida
  standUp: 1.1,    // s en pararse antes de andar, desde una postura con la cadera abajo
  riseFast: RISE_TIME, // s en pararse de un susto, un robo o un golpe: hasta tener la cadera arriba no da un paso
  glance: 4.5,     // m: mira al jugador, solo con el modelo completo
  glanceMax: 1.1,  // rad que gira la cabeza
  glanceBehind: 2.3, // rad: más atrás que esto no lo ve
  noseHygiene: 30, // higiene del jugador por debajo de la cual huele
  noseRange: 3,    // m
  returnMin: 3, returnExtra: 5, // s desde que se le pasa el susto hasta volver a su sitio
  returnClear: 8,  // m: con el jugador tan cerca no vuelve todavía
  spotTaken: 1,    // m: el jugador está sobre su sitio
  spotStep: 1.2,   // m: a esta distancia del sitio espera a que se lo dejen libre
  alternateMin: 8, alternateExtra: 17, // s entre posturas de quien se queda en su sitio
  turn: 3,         // velocidad con la que vuelve a mirar a donde miraba
  dodgeNear: 4,    // m: una patrulla en persecución tan cerca, o a dodgeTime s de llegar, lo hace quitarse
  dodgeTime: 1.2,
  dodgeSide: 1.4,  // m a cada lado del carro que cuentan como estar en su camino
  dodgeFlee: 3,    // s de la carrera para quitarse del camino
  benchClear: 1,   // m de su sitio en que todavía tiene la banca al lado
  benchFront: .5,  // cuánto se abre hacia adelante al salir de lado de la banca
  fleeBlockSpan: 3 // m: toparse otra vez sin haberse alejado esto es estar en un rincón
};
// Al caer: el largo que ocupa acostado, de los pies a la cabeza, y lo que aguanta de desnivel debajo del cuerpo.
const FALL = { length: 1.9, body: .42, trunk: .24, step: .32, floor: .3, curb: .09, low: .12, high: 1.2, legs: .85, legsBody: .15, turnUntil: .55 };
// De menos a más giro: lo que menos se note. Más allá de esto se escurre donde está.
const NO_TURN = [0];
const FALL_TURNS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, 3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI];
// El objeto cae desde la mano y queda junto al cuerpo. Las distancias se miden desde los pies,
// con x hacia su izquierda y z hacia adelante. La punta también necesita espacio en el mismo piso.
const DROP_TIME = .35;
const DROP_FLOOR = .25;  // m de diferencia con el piso del cuerpo: más ya es otro piso
const DROP_REACH = .06;  // m de holgura contra un sólido
const DROP_CANE = { x: HAND_ON_FLOOR.x - .06, z: HAND_ON_FLOOR.z - .1, from: [-.25, 0], top: .85, lift: .02, tilt: Math.PI / 2, spin: Math.PI / 2, far: [-.05, -.8], grip: 'prop-baston-calle' };
const DROP_UMBRELLA = { x: HAND_ON_FLOOR.x - .12, z: HAND_ON_FLOOR.z - .12, from: [-.2, .2], top: 1.2, ...UMBRELLA_REST, spin: 0, far: [-.1, .9], grip: 'paraguas' };
const DROP_SPOTS = [[1, 1], [.55, .55], [-1, 1], [-.55, .55]]; // de más a menos a mano: si el primero no cabe, el siguiente
const DROP_TURNS = [0, Math.PI / 2, -Math.PI / 2, Math.PI]; // si en ninguno cabe como cayó, apuntando para otro lado
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _conversationEye = new THREE.Vector3();
// Conversando: a qué distancia da por llegado a su sitio, qué tan rápido se voltea hacia el otro y hasta dónde gira
// la cabeza para mirarlo (más que al jugador: a quien le hablan lo miran de frente).
const TALK = { arrive: .08, turn: 4, lookMax: 1.25 };
// s: en una pareja fija, cuánto tarda el otro en contestar cuando uno deja de hablar (entre una y dos veces esto).
const PAIR_REPLY = .8;
// Lluvia sin paraguas: desde qué intensidad es un aguacero (la llovizna es .3, el aguacero .72), qué parte se encoge
// con llovizna y qué parte se cubre la cabeza con un aguacero.
const RAIN_REACTION = { heavy: .5, drizzleHunch: .3, heavyCover: .6 };
// Quien está así no mira a nadie: duerme o tiene la vista en lo suyo.
const NO_GLANCE = new Set(['dormido', 'acurrucado', 'celular', 'telefono']);
const WITNESS_STANCE = { llamar: 'telefono', grabar: 'celular', auxiliar: 'agachado' };
// De pie, mientras se le pasa el susto: nadie se queda tieso esperando a que el jugador se vaya.
const WAIT_STANCES = ['mirar-izquierda', 'mirar-derecha', 'brazos-cruzados', 'cambiar-peso'];

const wrapAngle = (angle) => {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};

/**
 * Apariencia de la calle. `gastada` es un habitante de calle (El Cartucho); sin ella, cualquiera de los
 * que no viven en la calle, sin lo que cargaría (es para quien aparece de la nada: un conductor bravo).
 */
export async function randomStreetLook({ gastada = false, random = Math.random, sexo } = {}) {
  const catalog = await loadCatalog();
  const person = rollPerson(gastada ? 'habitante' : pickArchetype('comun', random), { random, sexo });
  person.real.accesorios = [];
  const look = personLook(person, random);
  look.real = normalizeReal(catalog, person.real);
  return look;
}

export class Npc {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position
   * @param {{ wander?: number, facing?: number, isWalkable?: (x:number, z:number) => boolean, navigation?: object, routeRandom?: () => number, groundHeight?: (x:number, z:number) => number, speed?: number, look?: object, gastada?: boolean, zona?: string, arquetipo?: string, delantal?: 'tinto' | 'fritanga' | null, fijo?: { stance: string, alternas?: string[], techo?: boolean, reach?: number } }} opts
   */
  constructor(scene, position, opts = {}) {
    this.scene = scene;
    this.routeRandom = opts.routeRandom;
    this.home = position.clone();
    this.position = position.clone();
    this.wander = opts.wander ?? 0;
    this.navigation = opts.navigation ?? null;
    this.groundHeight = opts.groundHeight ?? (() => this.home.y);
    // Quién es: `gastada` es habitante de calle y, si no, lo decide la zona. Un `look` dado o un subtipo
    // (escuadrón, conductor bravo) no tienen arquetipo ni conductas: los lleva su propio sistema.
    const arquetipo = opts.look || this.constructor !== Npc ? null
      : opts.arquetipo ?? (opts.gastada ? 'habitante' : pickArchetype(opts.zona, opts.personRandom));
    const low = LOW_STANCES.has(opts.fijo?.stance);
    this.person = arquetipo ? rollPerson(arquetipo, { random: opts.personRandom, sexo: opts.sexo,
      sinCarga: !!opts.fijo, tallaFija: opts.fijo?.stance === 'banca' }) : null;
    this.walkSpeed = opts.speed ?? this.person?.speed ?? (0.85 + Math.random() * 0.45);
    this.route = [];
    this.routeIndex = 0;
    this._direction = new THREE.Vector3();
    this._nextPosition = new THREE.Vector3();
    this.isWalkable = opts.isWalkable ?? (() => true);
    this.collisions = opts.collisions ?? null;
    this.getWaterInfo = opts.getWaterInfo ?? null;
    this.root = new THREE.Group();
    this.root.position.copy(position);
    this.root.rotation.y = opts.facing ?? Math.random() * Math.PI * 2;
    scene.add(this.root);
    this.target = null;
    this.wait = this.navigation ? 0 : Math.random() * 6;
    this.moving = false;
    this.animAcc = 0;
    this._pedestrianMotion = this.person ? { distance: 0, elapsed: 0, angle: 0, reset: false } : null;
    this.animationBudget = 1;
    this.frame = Math.floor(Math.random() * 3); // reparte los cuadros de animación entre NPC
    this.lodChar = null;   // liviano (siempre)
    this.fullChar = null;  // completo (precargado; se muestra al acercarse)
    this._fullLoading = null;
    this.character = null; // el que se ve ahora
    this.isSplatted = false;
    this.splatTimer = 0;
    this.fleeTimer = 0;
    this.fleeDir = new THREE.Vector3();
    this.splatMesh = null;
    this._bubbleEl = null;
    this._bubbleTimer = 0;
    this._lastSpokenTime = 0;
    this._projPos = new THREE.Vector3();
    this.umbrella = null;
    this.phone = null;
    this._holder = { umbrella: null, phone: null };  // modelo que los tiene en la mano
    this._smokingChar = null;
    // Lenguaje corporal (ver docs/animaciones-actionforge.md): postura pedida, forma de llevar el cuerpo y paso.
    this.stance = opts.stance ?? null;
    this.style = opts.style ?? (low ? null : this.person?.style ?? null);
    this.andar = opts.andar ?? this.person?.andar ?? null;
    this._poseStale = false;
    this._posedStance = null;  // la postura que ya tiene encima, aunque esté lejos y no se anime
    this._raining = false;
    this._rain = 0;
    this._playerDist = Infinity;
    this._noseTimer = 0;
    this._noseCooldown = Math.random() * 3;
    this._dropped = [];        // accesorios que quedaron junto al cuerpo
    this._fallenCane = null;
    this._player = null;
    this._witness = null;      // testigo de un robo o una pelea: grabando o llamando (ver WitnessSystem)
    this._riseLeft = 0;        // s que le faltan para tener la cadera arriba después de un susto
    this._lowFrom = null;      // la postura baja que acaba de dejar
    this._koPlan = 'espalda';  // postura de caída de KO_PLANS
    this._koFrom = null;       // postura baja al recibir el último golpe
    this._koTurn = null;       // giro de la caída, si detrás no hay espacio
    this._koEnd = null;        // dónde va a terminar el empuje del golpe
    this._fleeAwayX = 0;       // hacia dónde queda alejarse del susto
    this._fleeAwayZ = 0;
    this._blocks = 0;          // veces seguidas que se ha topado huyendo, cerca del mismo sitio
    this._blockX = 0;
    this._blockZ = 0;
    this._fleeRouted = false;  // huye por la red: se topó dos veces seguidas
    this._cowering = false;    // huyendo sin salida: agachado, esperando a que se le pase
    this._standingUp = false;  // se está parando con calma: la cadera todavía no ha llegado arriba
    // Quien se queda en su sitio toda la partida: `out` mientras anda por ahí después de un susto.
    // `toRest`: va a donde esperar, no de vuelta. `reach`: m que puede salirse de la red al llegar.
    this.fijo = opts.fijo ? {
      stance: opts.fijo.stance, alternas: opts.fijo.alternas ?? null, facing: this.root.rotation.y, low, techo: !!opts.fijo.techo,
      reach: opts.fijo.reach ?? 0, out: false, returnIn: 0, fails: 0, pareja: null, toRest: false, dodging: false,
      nextPose: CONDUCT.alternateMin + Math.random() * CONDUCT.alternateExtra
    } : null;
    if (this.fijo) this.stance = this.fijo.stance;
    // En el andén cubierto, el asiento de acero queda un poco más alto que la madera del parque.
    this._bench = this.stance === 'banca' ? { rise: null, advance: 0, yaw: this.root.rotation.y, leaving: false, portal: this.fijo?.techo ?? false } : null;
    this.panicTimer = 0;       // s restantes de pánico: sin charla espontánea mientras dura
    this.panicDir = null;
    this.state = 'idle';
    this._ownsLocomotionState = this.constructor === Npc;
    this.action = null;
    this.actionProgress = 0;
    this._hitReactionRemaining = 0;
    this.hitLean = new HitLean();
    this._pausaImpacto = null;
    this.root.addEventListener('removed', () => this.limpiarImpacto());
    this.hitBy = undefined;    // quién le dio el último golpe (null si nadie: un carro); undefined si nunca le pegaron
    this._punchFacing = this.root.rotation.y;
    this.maxHealth = NPC_HEALTH;
    this.health = NPC_HEALTH;
    this.koState = null;       // 'down' conserva la exclusión de interacción mientras cae y una vez en el suelo
    this.bodyReleased = false;
    this._koBlend = 0;         // 0 de pie .. 1 tendido
    this.staggerTimer = 0;
    this._knockVel = new THREE.Vector3();
    this._lastHit = new THREE.Vector3(0, 0, 1);
    this.looted = false;       // una recompensa por la vida del NPC
    this._acceptedAttacks = new WeakMap();
    this._anonymousAttacks = new Set();
    this._counter = null;
    this._counterPose = null;
    this._defenseUsed = false;
    // El azar propio reutiliza una muestra individual anterior sin alterar los turnos del tráfico.
    const personRandom = opts.personRandom ?? seededRandom(this._noseCooldown * 0x50000000);
    this.carriesKnife = opts.carriesKnife ?? (!!this.person && personRandom() < .18);
    this.defenseResolve = opts.defenseResolve ?? personRandom();
    this._combatCollisions = null;
    // Parte de los caminantes ya está en lo suyo cuando empieza la partida: la calle no arranca en fila.
    if (this.person && this.navigation && !this.fijo && Math.random() < CONDUCT.startStopped) {
      this._takeStop();
      this.wait *= Math.random();
    }

    this.ready = (async () => {
      this.look = opts.look ?? await this._personLook(opts);
      this.lodChar = await createRealisticCharacter(this.look, { lod: true, andar: this.andar });
      if (this._disposed) { this.lodChar.dispose?.(); return; }
      this._show(this.lodChar);
      // arranca cada uno en otro punto de la animación para que no se muevan al unísono
      this._posedStance = this._stanceNow();
      this.character.update(Math.random() * 3, { speed: 0, stance: this._posedStance, style: this.style, action: this.action,
        bench: this._bench, ko: smooth(this._koBlend), koPlan: this._koPlan, koFrom: this._koFrom });
      if (this._fallenCane) this.character.setPropVisible?.('baston-calle', false);
    })().catch((e) => { this.loadError = e; console.warn('[Npc] no se pudo crear', e); });
  }

  /** Una visita puede empezar desde su ruta normal en el andén, si no está atendiendo otro suceso. */
  canStartVisit() {
    return this.person && !this.isVendor && !this.fijo && !this.walkVisit && !this.action && !this.talk && !this._witness &&
      !this.koState && !this.fleeTimer && !this.staggerTimer && !this._riseLeft && !this._standingUp &&
      !LOW_STANCES.has(this.stance) && !this.mind?.aware.busy();
  }

  startVisit(spot, route, { facing, stance, wait, entry, stops, safeStops = stops, alternas, sheltered = false }) {
    if (this._disposed || this.isDead) return;
    this.walkVisit = { spot, entry, stops, safeStops, facing, stance, wait, alternas, sheltered, scared: false };
    this.route = route;
    this.routeIndex = 0;
    this.target = route[0];
    this.wait = 0;
    this.stance = pickWalk(this.person, this.routeRandom);
  }

  /** Su arquetipo vestido con lo que de verdad hay en el catálogo; sin arquetipo, la apariencia de calle. */
  async _personLook(opts) {
    if (!this.person) return randomStreetLook({ gastada: opts.gastada, random: opts.personRandom, sexo: opts.sexo });
    const look = personLook(this.person, opts.personRandom);
    look.real = normalizeReal(await loadCatalog(), this.person.real);
    if (opts.delantal) look.delantal = opts.delantal;
    return look;
  }

  async preload() {
    await this.ready;
    if (this.loadError) throw this.loadError;
    await this._loadFull();
  }

  _loadFull() {
    return this._fullLoading ??= createRealisticCharacter(this.look, { lod: false, andar: this.andar })
      .then(c => {
        if (this._disposed) { c.dispose?.(); return; }
        this.fullChar = c;
        if (this._fallenCane?.parent) c.setPropVisible?.('baston-calle', false); // llegó con el bastón ya en el piso
      });
  }

  get isKnockedOut() { return !!this.koState; }
  get isDead() { return this.koState === 'down'; }
  get deathSettled() { return this.isDead && this._koBlend >= 1; }

  get pausaImpacto() { return this._pausaImpacto?.restante ?? 0; }

  pausarImpacto(pausa) { this._pausaImpacto = pausa; }

  tiempoTrasImpacto(dt) { return this._pausaImpacto?.detenida ? 0 : dt; }

  limpiarImpacto() {
    this._enderezarGolpe();
    this._pausaImpacto = null;
  }

  _enderezarGolpe() {
    if (this.hitLean.applied) this.hitLean.remove(this.character.group);
    this.hitLean.clear();
  }

  _inclinarGolpe(direccion, empujon) {
    this.hitLean.orientar(this.root.rotation.y);
    this.hitLean.kick(direccion, this.root.rotation.y, empujon * FUERZA_INCLINACION);
  }

  _show(char) {
    if (this.character === char) return;
    if (this.hitLean.applied) this.hitLean.remove(this.character.group);
    const motion = this.character?.motionState?.();
    if (this.character) this.root.remove(this.character.group);
    this.character = char;
    this.root.add(char.group);
    if (this._counter?.weapon === 'cuchillo' && this._counter.phase !== 'wait') char.setWeapon?.('cuchillo');
    if (motion) char.applyMotion?.(motion); // sigue en el mismo punto del paso y de lo que estaba haciendo: el cambio de detalle no se nota
    // Sin nada que heredar, o si llevaba rato sin animarse, la postura ya debe estar puesta cuando se vea.
    if (!motion || this.animAcc > CHANGED_UNSEEN) char.snapPose?.();
    this._poseStale = true;
  }

  /** Cambia de detalle según distancia; permite carga diferida fuera del arranque normal. */
  _updateDetail(dist) {
    const still = this.fijo && !this.fijo.out;
    if (dist < (still ? NPC_LOD.fixedIn : NPC_LOD.fullIn)) {
      if (this.fullChar) this._show(this.fullChar);
      else if (!this._fullLoading) {
        this._loadFull().catch((e) => console.warn('[Npc] sin modelo completo', e));
      }
    } else if (dist > (still ? NPC_LOD.fixedOut : NPC_LOD.fullOut) && this.lodChar) {
      this._show(this.lodChar);
    }
  }

  _pickTarget() {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * this.wander;
      const x = this.home.x + Math.cos(a) * r;
      const z = this.home.z + Math.sin(a) * r;
      if (this.isWalkable(x, z)) return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  hitByPoop(projectileOrigin = null) {
    if (this._disposed || this.koState) return false;
    this.isSplatted = true;
    this.splatTimer = 12;
    this._fleeFrom(projectileOrigin);

    // Marca visual de popó en el NPC
    if (!this.splatMesh) {
      const splatGeo = new THREE.SphereGeometry(0.14, 6, 6);
      splatGeo.scale(1.2, 0.4, 0.9);
      const splatMat = new THREE.MeshStandardMaterial({
        color: 0x3d2008,
        roughness: 0.95
      });
      this.splatMesh = new THREE.Mesh(splatGeo, splatMat);
      this.splatMesh.position.set(0, 1.1, 0.18);
      this.root.add(this.splatMesh);
    }

    // Si lo dice con su voz grabada y su burbuja, no sale además el grito en texto; lo demás sigue igual.
    this._scream(POOP_SCREAMS, vocesDelJuego()?.decirPopo?.(this) === true);
    return true;
  }

  /**
   * Lo pillaron metiéndole la mano o le arrancaron algo: huye gritando, sin mancha. Con `yaGrito`, ya lo gritó con su
   * voz grabada y su burbuja (AudioSystem.voces): no sale además el grito en texto, y lo demás sigue igual.
   */
  alarmedByTheft(thiefPosition = null, yaGrito = false) {
    if (this._disposed || this.isDead) return;
    this._fleeFrom(thiefPosition);
    this._scream(THEFT_SCREAMS, yaGrito);
  }

  // Dirección de huida: alejarse del origen del susto
  _fleeFrom(origin) {
    if (this._disposed || this.isDead) return;
    this._clearCounterAttack();
    this.talk?.leave?.();
    this.fleeTimer = 8;
    this.target = null;
    this.route = [];
    this._blocks = 0;
    this._fleeRouted = false;
    this._cowering = false; // si estaba agachado, primero se para: la postura baja sigue puesta
    if (origin) {
      this.fleeDir.copy(this.position).sub(origin);
      this.fleeDir.y = 0;
      if (this.fleeDir.lengthSq() < 0.001) this.fleeDir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      this.fleeDir.normalize();
    } else {
      const angle = Math.random() * Math.PI * 2;
      this.fleeDir.set(Math.cos(angle), 0, Math.sin(angle));
    }
    this._setFleeAway(this.fleeDir.x, this.fleeDir.z);
  }

  /** Hacia dónde queda alejarse del susto: se conserva aunque el rumbo cambie al toparse. */
  _setFleeAway(x, z) {
    this._fleeAwayX = x;
    this._fleeAwayZ = z;
  }

  /** El grito en el aviso y, a veces, las monedas que se le caen del susto. `callado`: ya gritó con su voz. */
  _scream(screams, callado = false) {
    const grito = any(screams); // se sortea siempre: con voz o sin ella, el azar que sigue es el mismo
    const msg = callado ? null : grito;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      if (msg) window.dispatchEvent(new CustomEvent('toast', { detail: { text: msg, type: 'warn' } }));
      // 35% de probabilidad de soltar monedas del pánico
      if (Math.random() < 0.35) {
        const droppedMoney = 500 * (1 + Math.floor(Math.random() * 4));
        window.dispatchEvent(new CustomEvent('npc-dropped-loot', {
          detail: { position: this.position.clone(), amount: droppedMoney }
        }));
      }
    }
  }

  _walk(dt) {
    this.moving = false;
    if (this.koState || this.staggerTimer > 0) return; // noqueado o sacudido: no camina

    // Si fue impactado por popó: huye despavorido a gran velocidad
    if (this.fleeTimer > 0) {
      this.fleeTimer = Math.max(0, this.fleeTimer - dt);
      if (this.fleeTimer === 0) this._defenseUsed = false;
      if (this.isVendor) return; // no deja su puesto
      if (this.walkVisit) this.walkVisit.scared = true;
      if (this._cowering) {
        if (this.fleeTimer <= 0) this._stopCowering();
        return;
      }
      this._leaveSpot();
      if (this._riseLeft > 0) return; // desde el piso primero se para: no se desliza sentado
      if (this._fleeRouted) this._fleeAlongRoute(dt);
      else if (!this.mind?.fleeSmart()) this._fleeStraight(dt); // con mente huye por la red, lejos de la amenaza
      if (this.fleeTimer <= 0 && this._fleeRouted) this._endFleeRoute();
      this.root.rotation.y += wrapAngle(Math.atan2(this.fleeDir.x, this.fleeDir.z) - this.root.rotation.y) * Math.min(1, dt * 10);
      return;
    }
    if (this._riseLeft > 0) return; // se está parando de donde estaba agachado
    if (this.mind?.holdWalk(dt)) return; // espera, cede o mira: ver entities/npc/mind.js
    // Conversando (NpcConversations): se acerca a su sitio frente al otro y desde ahí lo mira.
    if (this.talk) { this._converse(dt); return; }

    if (this.fijo && this._stayAtSpot(dt)) return;
    if (!this.navigation && this.wander <= 0 && !this.fijo && !(this.target && this.deathResponse === 'auxiliar')) return;
    if (!this.target) {
      if ((this.wait -= dt) > 0) {
        if (this._atVisit()) {
          const { facing, alternas, wait } = this.walkVisit;
          this.root.rotation.y += wrapAngle(facing - this.root.rotation.y) * Math.min(1, dt * CONDUCT.turn);
          if (alternas) {
            const phase = Math.max(0, Math.min(alternas.length - 1, Math.floor((1 - this.wait / wait) * alternas.length)));
            this.stance = alternas[phase];
          }
        }
        return;
      }
      if (this.person && this._standUp()) return;
      if (this.navigation) {
        this.route = this._chooseRoute();
        this.routeIndex = 0;
        this.target = this.route[0] ?? null;
      } else {
        this.target = this._pickTarget();
      }
      if (!this.target) { this.wait = 2; return; }
      if (this.person) this.stance = pickWalk(this.person);
    }
    if (this.target) {
      // Con mente apunta al punto de su ruta corrido de lado si esquiva a alguien (entities/npc/steering.js).
      const d = this._direction.copy(this.mind?.aim(this.target) ?? this.target).sub(this.position);
      d.y = 0;
      const dist = d.length();
      if (dist < 0.001) {
        this._advanceTarget();
        return;
      }
      if (this._spotTaken()) return;
      const step = Math.min(dist, this._paceNow() * dt);
      const next = this._nextPosition.copy(this.position).addScaledVector(d.normalize(), step);
      if (!this._canStep(next.x, next.z)) {
        this.target = null;
        this.route = [];
        this.wait = 0.5;
        if (this.fijo?.out && ++this.fijo.fails > 3) this.fijo = null; // no hay cómo volver: sigue como cualquiera
        return;
      }
      next.y = this.groundHeight(next.x, next.z);
      this.position.copy(next);
      this.moving = step > 0;
      this.root.rotation.y += wrapAngle(Math.atan2(d.x, d.z) - this.root.rotation.y) * Math.min(1, dt * 5);
      if (step >= dist) this._advanceTarget();
    }
  }

  /**
   * Se acerca al interlocutor o abre paso. Conserva su ruta para retomarla después. El fijo se queda en su sitio.
   */
  _converse(dt) {
    const talk = this.talk, other = talk.partner.position;
    if (!talk.ready) {
      const spot = talk.spot;
      const d = spot && !this.fijo ? this._direction.set(spot.x - this.position.x, 0, spot.z - this.position.z) : null;
      const dist = d ? d.length() : 0;
      if (dist < TALK.arrive) talk.ready = true;
      else {
        let step = Math.min(dist, this._paceNow() * dt);
        d.normalize();
        const grid = this.mind?.system?.grid;
        if (grid) step *= sideStepRoom(grid, this, d.x * step, d.z * step);
        if (step <= 0) return; // espera a que el tercero libere el espacio
        const next = this._nextPosition.copy(this.position).addScaledVector(d, step);
        next.y = this.groundHeight(next.x, next.z);
        if (!onSidewalk(this, next) || !this._canStep(next.x, next.z) || this._entersSolid(next)
          || Math.abs(next.y - this.position.y) > CONVERSATION_FLOOR_GAP) {
          talk.ready = talk.yielding === true;
          talk.blocked = !talk.ready;
          return;
        }
        this.position.copy(next);
        this.moving = true;
        this.root.rotation.y += wrapAngle(Math.atan2(d.x, d.z) - this.root.rotation.y) * Math.min(1, dt * 5);
        return;
      }
    }
    if (this.fijo) return;
    this.root.rotation.y += wrapAngle(Math.atan2(other.x - this.position.x, other.z - this.position.z) - this.root.rotation.y) * Math.min(1, dt * TALK.turn);
  }

  /** Huye derecho; si se topa, gira a un lado que esté libre. */
  _fleeStraight(dt) {
    this._leaveBench();
    const dir = this.fleeDir, step = this._fleeSpeed() * dt;
    const next = this._nextPosition.copy(this.position).addScaledVector(dir, step);
    next.y = this.groundHeight(next.x, next.z);
    if (this._canFleeTo(next)) {
      this.position.copy(next);
      this.moving = true;
      return;
    }
    const { x, z } = this.position;
    this._blocks = Math.hypot(x - this._blockX, z - this._blockZ) < CONDUCT.fleeBlockSpan ? this._blocks + 1 : 1;
    this._blockX = x;
    this._blockZ = z;
    if (this._blocks >= 2) {
      // En un rincón, girar de a 90° solo lo devuelve al punto de partida.
      if (!this._startFleeRoute()) this._cower();
      return;
    }
    const oldX = dir.x, oldZ = dir.z;
    for (let side = 1; side >= -1; side -= 2) {
      dir.set(-oldZ * side, 0, oldX * side);
      next.copy(this.position).addScaledVector(dir, Math.max(step, FLEE_BODY));
      next.y = this.groundHeight(next.x, next.z);
      if (this._canFleeTo(next)) return;
    }
    dir.set(-oldZ, 0, oldX);
  }

  /** Ni sólidos ni agua: una baldosa se puede pisar y tener el lago en una esquina. */
  _canFleeTo(next) {
    if (!this.isWalkable(next.x, next.z) || this._entersSolid(next)) return false;
    const water = this.getWaterInfo?.(next.x, next.z);
    return !(water && next.y <= water.surfaceY + .08);
  }

  /** De las rutas de la red, la que termina más lejos de donde se topó y sin devolverse hacia el susto. */
  _startFleeRoute() {
    const navigation = this.navigation;
    if (!navigation?.createRoute) return false;
    let best = null, score = -Infinity;
    for (let i = 0; i < 3; i++) {
      const route = navigation.createRoute(this.position, this.routeRandom);
      if (!route.length) continue;
      const end = route.at(-1), dx = end.x - this.position.x, dz = end.z - this.position.z;
      const value = Math.hypot(dx, dz) + (dx * this._fleeAwayX + dz * this._fleeAwayZ);
      if (value > score) { score = value; best = route; }
    }
    if (!best) return false;
    this.route = best;
    this.routeIndex = 0;
    this.target = best[0];
    this._fleeRouted = true;
    return true;
  }

  _fleeAlongRoute(dt) {
    const target = this.target;
    if (!target) { this._endFleeRoute(); return; }
    const d = this._direction.copy(target).sub(this.position);
    d.y = 0;
    const dist = d.length();
    if (dist < .001) { this.target = this.route[++this.routeIndex] ?? null; return; }
    const step = Math.min(dist, this._fleeSpeed() * dt);
    const next = this._nextPosition.copy(this.position).addScaledVector(d.divideScalar(dist), step);
    next.y = this.groundHeight(next.x, next.z);
    if (this._entersSolid(next)) { this._endFleeRoute(); this._cower(); return; }
    this.position.copy(next);
    this.moving = step > 0;
    this.fleeDir.copy(d);
    if (step >= dist) this.target = this.route[++this.routeIndex] ?? null;
  }

  _endFleeRoute() {
    this._fleeRouted = false;
    this._blocks = 0;
    this.target = null;
    this.route = [];
    this.routeIndex = 0;
  }

  /** No hay por dónde: se agacha a esperar a que se le pase. Con algo en la mano no se abraza las rodillas: espera de pie. */
  _cower() {
    this._cowering = true;
    this.moving = false;
    this.stance = this.person?.style?.carry ? WAIT_STANCES[Math.floor(Math.random() * 2)] : 'acurrucado';
    if (LOW_STANCES.has(this.stance)) this._lowFrom = this.stance;
  }

  _stopCowering() {
    this._cowering = false;
    if (LOW_STANCES.has(this.stance)) this._riseLeft = CONDUCT.riseFast;
    this.stance = null;
  }

  _advanceTarget() {
    this.target = this.navigation || this.fijo?.out ? (this.route[++this.routeIndex] ?? null) : null;
    if (this.target) return;
    if (this.fijo?.out) {
      if (this.fijo.toRest) this.fijo.toRest = false;
      else this._backAtSpot();
    } else if (this.person && this.navigation) this._takeStop();
    else this.wait = this.navigation ? 1 + Math.random() * 3 : 3 + Math.random() * 8;
  }

  /** ¿Ese paso lo mete en algo sólido? La red va por baldosas y una columna cabe en una. Quien ya está dentro (la banca) puede salir. */
  _entersSolid(next) {
    return !!this.collisions?.queryStatic && this._solidAt(next) && !this._solidAt(this.position);
  }

  _solidAt({ x, y, z }) {
    const r = FLEE_BODY;
    return this.collisions.queryStatic(x - r, z - r, x + r, z + r, _solids).some(({ box }) =>
      box.max.y > y + .5 && box.min.y < y + 1.2 && x > box.min.x - r && x < box.max.x + r && z > box.min.z - r && z < box.max.z + r);
  }

  /** La red manda. Solo quien vuelve a su sitio puede salirse de ella, y solo cerca de él: al llegar o si ya estaba afuera. */
  _canStep(x, z) {
    if (this.isWalkable(x, z)) return true;
    const fijo = this.fijo;
    if (!fijo?.out || fijo.toRest || !fijo.reach || Math.hypot(x - this.home.x, z - this.home.z) >= fijo.reach) return false;
    return this.routeIndex === this.route.length - 1 || !this.isWalkable(this.position.x, this.position.z);
  }

  /** El jugador está parado en su sitio: llegando a él, espera a un paso en vez de metérsele encima. */
  _spotTaken() {
    const fijo = this.fijo, player = this._player, navigation = this.navigation;
    if (!fijo?.out || fijo.toRest || !player) return false;
    if (Math.hypot(this.position.x - this.home.x, this.position.z - this.home.z) > CONDUCT.spotStep) return false;
    if (navigation?.nodes?.[navigation.nodeAt(this.position.x, this.position.z)]?.crossing) return false; // en un cruce no se espera
    return Math.hypot(player.x - this.home.x, player.z - this.home.z) < CONDUCT.spotTaken;
  }

  /** Velocidad al huir: 2,4 veces su paso; con mente, la huida de un peligro arranca andando (entities/npc/awareness.js). */
  _fleeSpeed() {
    return this.walkSpeed * 2.4 * (this.mind ? this.mind.fleePace() : 1);
  }

  /** Velocidad al andar: bajo la lluvia, quien no lleva paraguas apura el paso. */
  _paceNow() {
    const pace = this._raining && this.person?.paraguas === null ? this.walkSpeed * this.person.correr : this.walkSpeed;
    return this.mind ? pace * this.mind.paceFactor() : pace; // frena para ceder, apura al cruzar la calle
  }

  /** El arraigo: lejos de su sitio prefiere volver, y así cada zona conserva a su gente. */
  _chooseRoute() {
    if (this.walkVisit) {
      const visit = this.walkVisit, { spot, entry, stops } = visit, leaving = this._atVisit();
      if (visit.scared && (!this._player || spot.distanceToSquared(this._player) >= CONDUCT.returnClear ** 2)) visit.scared = false;
      const exits = visit.scared ? visit.safeStops : stops;
      const goal = leaving || visit.scared ? exits[Math.floor(this.routeRandom() * exits.length)] : spot;
      const visitRoute = this.navigation.routeTo(this.position, goal);
      if (visitRoute.length) {
        if (leaving && this.position.distanceToSquared(entry) > .01) visitRoute.unshift(entry);
        return visitRoute;
      }
    }
    const route = this.navigation.createRoute(this.position, this.routeRandom);
    if (!this.person || !route.length) return route;
    const away = (list) => (list.at(-1).x - this.home.x) ** 2 + (list.at(-1).z - this.home.z) ** 2;
    if (away(route) < CONDUCT.rooted ** 2) return route;
    const other = this.navigation.createRoute(this.position, this.routeRandom);
    return other.length && away(other) < away(route) ? other : route;
  }

  /**
   * Terminó un recorrido: según quién sea, se queda un rato en lo suyo o sigue. Nunca se queda parado
   * en un cruce ni fuera de la red: ahí solo toma aire. Bajo la lluvia, sin paraguas, tampoco.
   */
  _takeStop() {
    this.stance = null;
    if (this._atVisit()) {
      this.stance = this.walkVisit.stance;
      this.wait = this.walkVisit.wait;
      return;
    }
    const node = this.navigation.nodes?.[this.navigation.nodeAt?.(this.position.x, this.position.z)];
    const wet = this._raining && this.person.paraguas === null;
    if (!node || node.crossing || wet || Math.random() >= this.person.pausa) {
      this.wait = CONDUCT.breathMin + Math.random() * CONDUCT.breathExtra;
      return;
    }
    const what = pickStop(this.person);
    if (what === SEARCH_ACTION) this.action = what;
    else this.stance = what;
    this.wait = CONDUCT.stopMin + Math.random() * CONDUCT.stopExtra;
  }

  _atVisit() {
    return !!this.walkVisit && this.position.distanceToSquared(this.walkVisit.spot) < .12 ** 2;
  }

  /** Quien está en el piso o agachado se para antes de andar. true: todavía no sale. */
  _standUp() {
    this._standingUp = false;
    if (this.action === SEARCH_ACTION) { this.action = null; this.wait = CONDUCT.breathMin; return true; }
    if (LOW_STANCES.has(this.stance)) { this._lowFrom = this.stance; this.stance = null; this.wait = CONDUCT.standUp; this._standingUp = true; return true; }
    return false;
  }

  /** Lo asustaron: lo primero es soltar lo que estaba haciendo y levantarse. */
  _leaveSpot() {
    const person = this.person;
    if (!person || this.isVendor) return;
    if (LOW_STANCES.has(this.stance)) this._lowFrom = this.stance;
    if (LOW_STANCES.has(this.stance) || this._standingUp) this._riseLeft = CONDUCT.riseFast; // también si ya se estaba parando con calma
    this._standingUp = false;
    this.stance = null;
    this.wait = 0;
    if (this.action === SEARCH_ACTION) this.action = null;
    const fijo = this.fijo;
    if (!fijo || fijo.out) return;
    fijo.out = true;
    fijo.fails = 0;
    fijo.returnIn = CONDUCT.returnMin + Math.random() * CONDUCT.returnExtra;
    this.target = null;
    this.style = person.style;
    // Si asustan a uno de una pareja, el otro no se queda ahí parado.
    const other = fijo.pareja;
    if (other?.fijo && !other.fijo.out && !other.koState) other._fleeFrom(this.position);
  }

  /** De la banca se sale por delante o de lado: el espaldar no se atraviesa. Con una patrulla encima no hay tiempo de escoger. */
  _leaveBench() {
    const fijo = this.fijo, dir = this.fleeDir;
    if (fijo?.stance !== 'banca' || fijo.dodging) return;
    if (Math.hypot(this.position.x - this.home.x, this.position.z - this.home.z) > CONDUCT.benchClear) return;
    const fx = Math.sin(fijo.facing), fz = Math.cos(fijo.facing);
    if (dir.x * fx + dir.z * fz >= 0) return;
    const next = this._nextPosition, { x, y, z } = this.position;
    for (let i = 0, side = dir.x * fz - dir.z * fx < 0 ? -1 : 1; i < 2; i++, side = -side) {
      const dx = fz * side + fx * CONDUCT.benchFront, dz = -fx * side + fz * CONDUCT.benchFront;
      next.set(x + dx, y, z + dz);
      if (this.isWalkable(next.x, next.z) && !this._entersSolid(next)) { dir.set(dx, 0, dz).normalize(); return; }
    }
    dir.set(fx, 0, fz); // tiene los dos lados tapados
  }

  /** El cuerpo visible pasa por delante del asiento; al caminar, la raíz alcanza a la pose. */
  _updateBenchPose() {
    const bench = this._bench;
    if (!bench) return;
    bench.rise = null;
    if (!this.fijo?.out || this.koState) {
      bench.leaving = false;
      bench.advance = 0;
      return;
    }
    const front = BENCH_EXIT * (this.look?.real?.talla?.ancho ?? 1);
    if (this._lowFrom === 'banca' && this._riseLeft > 0) {
      bench.leaving = true;
      bench.rise = 1 - this._riseLeft / CONDUCT.riseFast;
      bench.advance = front * benchPush(bench.rise);
    } else if (bench.leaving) {
      const dx = this.position.x - this.home.x, dz = this.position.z - this.home.z;
      const distance = Math.hypot(dx, dz);
      if (bench.portal) {
        // El zapato trasero aún pasa a la altura de la chapa. La pelvis sigue el primer paso
        // y devuelve el avance de la pose poco a poco a lo largo del primer metro de suelo.
        bench.advance = front * (1 - THREE.MathUtils.smoothstep(distance, 0, CONDUCT.benchClear));
      } else {
        const forward = dx * Math.sin(bench.yaw) + dz * Math.cos(bench.yaw);
        const clear = THREE.MathUtils.smoothstep(distance, .85, 1.35);
        bench.advance = Math.max(0, front - Math.max(0, forward)) * (1 - clear);
      }
      if (bench.advance < .001) { bench.leaving = false; bench.advance = 0; }
    }
  }

  /** En su sitio no camina; después de un susto espera a que se calme la cosa y vuelve. true: no anda. */
  _stayAtSpot(dt) {
    const fijo = this.fijo;
    if (!fijo.out) {
      this.root.rotation.y += wrapAngle(fijo.facing - this.root.rotation.y) * Math.min(1, dt * CONDUCT.turn);
      if (fijo.alternas && (fijo.nextPose -= dt) <= 0) {
        fijo.nextPose = CONDUCT.alternateMin + Math.random() * CONDUCT.alternateExtra;
        const was = this.stance;
        this.stance = this._pairTurn(fijo.alternas[Math.floor(Math.random() * fijo.alternas.length)]);
        // Terminó de hablar: al rato le contesta el otro, no se quedan los dos callados mirándose.
        const other = fijo.pareja;
        if (was === 'hablar' && this.stance !== 'hablar' && other?.fijo && !other.fijo.out) {
          other.fijo.nextPose = Math.min(other.fijo.nextPose, PAIR_REPLY + Math.random() * PAIR_REPLY);
        }
      }
      return true;
    }
    if (this.target) return false;
    fijo.returnIn -= dt;
    if (fijo.returnIn > 0 || this._playerDist < CONDUCT.returnClear) {
      if (this._walkToRest()) return false;
      this._waitInPlace(dt);
      return true;
    }
    this.route = this.navigation?.routeTo?.(this.position, this.home) ?? [this.home.clone()];
    this.routeIndex = 0;
    this.target = this.route[0] ?? null;
    fijo.returnIn = 1;
    fijo.toRest = false;
    this.stance = null;
    if (!this.target) this.fijo = null; // sin camino a casa: sigue como cualquier peatón
    return false;
  }

  /**
   * En una pareja que conversa se habla por turnos: si el otro ya está gesticulando, este escucha con otra de sus
   * posturas. Sin pareja, o con el otro fuera de su sitio, la postura queda como viene.
   */
  _pairTurn(stance) {
    const other = this.fijo?.pareja;
    if (stance !== 'hablar' || !other?.fijo || other.fijo.out || other.stance !== 'hablar') return stance;
    return this.fijo.alternas?.find(name => name !== 'hablar') ?? stance;
  }

  /** Esperando a que se vaya el jugador tampoco se queda tieso: cambia de postura, como cuando está en su sitio. */
  _waitInPlace(dt) {
    const fijo = this.fijo;
    if (this.stance && (fijo.nextPose -= dt) > 0) return;
    fijo.nextPose = CONDUCT.alternateMin + Math.random() * CONDUCT.alternateExtra;
    const own = fijo.alternas?.filter(name => !LOW_STANCES.has(name));
    const list = own?.length ? own : WAIT_STANCES;
    this.stance = list[Math.floor(Math.random() * list.length)];
  }

  /**
   * Se le acabó la huida y todavía no puede volver: espera en el centro de una baldosa de andén, nunca en
   * un cruce ni en la calzada, aunque el jugador esté al lado. Sin red (el andén del bus) se queda donde está.
   */
  _walkToRest() {
    const navigation = this.navigation;
    if (!navigation?.routeToRest || navigation.isRestingAt(this.position)) return false;
    const route = navigation.routeToRest(this.position);
    if (!route.length) return false;
    this.route = route;
    this.routeIndex = 0;
    this.target = route[0];
    this.fijo.toRest = true;
    this.stance = null;
    return true;
  }

  /** Llegó de vuelta: retoma su lugar y su postura. */
  _backAtSpot() {
    const fijo = this.fijo;
    fijo.out = false;
    fijo.dodging = false;
    this.position.copy(this.home);
    this.stance = this._pairTurn(fijo.stance);
    if (fijo.low) this.style = null;
    this.wait = 0;
  }

  /** La postura de este momento: la nariz y la lluvia mandan sobre lo que estuviera haciendo de pie. */
  _stanceNow() {
    if (this.isDead || (this._counter && this._counter.phase !== 'wait')) return null;
    const person = this.person;
    if (!person || LOW_STANCES.has(this.stance)) return this.stance;
    // Se tapa la nariz solo si tiene libre esa mano (el bastón, por ejemplo, la ocupa).
    if (this._noseTimer > 0 && person.nariz) return 'nariz';
    // Conversando ya en su sitio: gesticula al hablar y escucha a su manera. Con paraguas bajo la lluvia, lo conserva.
    const talk = this.talk;
    const sheltered = (this.fijo?.techo && !this.fijo.out) || (this.walkVisit?.sheltered && this._atVisit());
    if (talk?.ready && !(this._raining && person.paraguas !== null && !sheltered)) return talk.stance ?? null;
    if (this._raining && !this.isVendor && !sheltered) {
      if (person.paraguas !== null) return 'paraguas';
      if (this.moving || this.fijo) return this._rainReaction() ?? this.stance;
    }
    return this.stance;
  }

  /**
   * Sin paraguas, cada quien reacciona según lo que cae y a su manera: con llovizna casi nadie se pone la mano en la
   * cabeza (unos pocos se encogen de frío); con aguacero la mayoría se cubre y el resto se encoge. Quien está en su
   * sitio no se cubre por una llovizna. Las manos ocupadas con una carga no se juntan al frente.
   */
  _rainReaction() {
    const person = this.person;
    const temper = this._rainTemper ??= Math.random();
    const handsFree = !person.style?.carry;
    if (this._rain < RAIN_REACTION.heavy) {
      if (this.fijo || temper >= RAIN_REACTION.drizzleHunch) return null;
      return person.lluvia === 'encogido' || handsFree ? 'encogido' : null;
    }
    if (this.fijo) return handsFree ? 'encogido' : person.lluvia;
    return temper < RAIN_REACTION.heavyCover || !handsFree ? person.lluvia : 'encogido';
  }

  /** Dónde está el jugador: una sola medida por cuadro para todo lo que la pregunta. */
  _measurePlayer(ctx) {
    this._player = ctx.player ?? null;
    this._playerDist = ctx.player ? Math.hypot(this.position.x - ctx.player.x, this.position.z - ctx.player.z) : Infinity;
  }

  /** Una patrulla en persecución no frena por nadie: quien está en su camino se quita de lado, también desde la banca. */
  _dodgeChasers(chasers) {
    if (this.isVendor || this.koState || this.fleeTimer > 0) return;
    for (let i = 0; i < chasers.length; i++) {
      const vehicle = chasers[i], car = vehicle.car, speed = vehicle.speed ?? 0;
      if (speed < 1) continue;
      const dx = this.position.x - car.position.x, dz = this.position.z - car.position.z;
      const near = CONDUCT.dodgeNear + speed * CONDUCT.dodgeTime;
      if (dx * dx + dz * dz > near * near) continue;
      const hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
      const side = -dx * hz + dz * hx;
      if (dx * hx + dz * hz < 0 || Math.abs(side) > car.width / 2 + CONDUCT.dodgeSide) continue;
      const away = side < 0 ? -1 : 1;
      this._nextPosition.set(this.position.x + hz * away, this.position.y, this.position.z - hx * away);
      this._fleeFrom(this._nextPosition);
      this.fleeTimer = CONDUCT.dodgeFlee;
      this.fijo.dodging = true;
      return;
    }
  }

  /** Lluvia, olor y jugador cerca: lo que cambia la conducta aunque no le toque animarse. */
  _updateConduct(dt, ctx) {
    this._raining = !!ctx.isRaining;
    // Sin intensidad (pruebas, sala) se toma como lluvia fuerte: la reacción de siempre.
    this._rain = this._raining ? (ctx.rain ?? 1) : 0;
    this._measurePlayer(ctx);
    if (this.fijo && ctx.chasers?.length) this._dodgeChasers(ctx.chasers);
    // Empezó a llover con él parado: sin paraguas se va pronto.
    if (this._raining && this.person.paraguas === null && !this.target && !this.fijo && this.wait > 2 && !(this.walkVisit?.sheltered && this._atVisit())) {
      this.wait = .5 + Math.random() * 1.5;
    }
    if (this._noseTimer > 0) this._noseTimer -= dt;
    // Con el jugador sucio ya cerca se pide el audio de lo que diría por el olor, una vez por persona.
    if (!this._olorPedido && (ctx.hygiene ?? 100) < CONDUCT.noseHygiene && this._playerDist < CONDUCT.noseRange * 3) {
      this._olorPedido = true;
      vocesDelJuego()?.prepararOlor?.(this);
    }
    if (this._noseCooldown > 0) this._noseCooldown -= dt;
    else if ((ctx.hygiene ?? 100) < CONDUCT.noseHygiene && this._playerDist < CONDUCT.noseRange
      && !this.koState && this.fleeTimer <= 0 && !LOW_STANCES.has(this.stance)) {
      this._noseTimer = 2 + Math.random() * 2;
      this._noseCooldown = this._noseTimer + 6 + Math.random() * 8;
      // Con mal olor, el peatón huye corriendo de la peste
      if (!this.isVendor) {
        this._fleeFrom(ctx.player);
        this.fleeTimer = 4.0;
      }
      // El texto se sortea siempre: así el azar del juego es el mismo con voz o sin ella.
      const queja = this.isVendor ? '¡Aléjese del puesto con esa peste!' : any(BOGOTA_DIRTY_PHRASES);
      if (vocesDelJuego()?.decirOlor?.(this) !== true) this.say(queja);
    }
  }

  /** Giro de cabeza hacia el jugador cercano, solo con el modelo completo. */
  _glanceAt(ctx, stance) {
    if (!this.person || this.character !== this.fullChar) return 0;
    if (this.koState || this.fleeTimer > 0 || this.action || NO_GLANCE.has(stance)) return 0;
    // Conversando mira a quien le habla, no al jugador: la cabeza completa lo que el cuerpo no ha girado.
    const partner = (this.talk?.attention ?? this.talk?.partner)?.position;
    if (partner) {
      const toPartner = wrapAngle(Math.atan2(partner.x - this.position.x, partner.z - this.position.z) - this.root.rotation.y);
      return Math.max(-TALK.lookMax, Math.min(TALK.lookMax, toPartner));
    }
    if (!ctx.player || !(this._playerDist < CONDUCT.glance)) return 0;
    const angle = wrapAngle(Math.atan2(ctx.player.x - this.position.x, ctx.player.z - this.position.z) - this.root.rotation.y);
    if (Math.abs(angle) > CONDUCT.glanceBehind) return 0;
    return Math.max(-CONDUCT.glanceMax, Math.min(CONDUCT.glanceMax, angle));
  }

  /** Lo que la postura pone en la mano: paraguas, celular y cigarrillo aparecen y se van con ella. */
  _updateHeld(stance) {
    this._updateUmbrella(stance === 'paraguas' && !this.koState);
    // Quien sigue quieto en su sitio entra al modelo completo más cerca: lo que tiene en la mano no se atrasa con él.
    const near = !this.koState && (this.character === this.fullChar || (!!this.fijo && !this.fijo.out && this._playerDist < NPC_LOD.fullIn));
    const onPhone = near && (stance === 'telefono' || stance === 'celular');
    if (onPhone) this.phone ??= createPhone();
    if (this.phone) {
      if (onPhone && this._holder.phone !== this.character && this.character.hold?.(this.phone, 'telefono')) this._holder.phone = this.character;
      this.phone.visible = onPhone;
    }
    const smoking = near && stance === 'fumar-quieto' ? this.character : null;
    if (smoking !== this._smokingChar) {
      this._smokingChar?.setSmoking?.(false);
      smoking?.setSmoking?.(true);
      this._smokingChar = smoking;
    }
  }

  /**
   * @param {number} dt
   * @param {{ player?: THREE.Vector3, frustum?: THREE.Frustum }} ctx
   */
  update(dt, ctx = {}) {
    if (this._disposed) return;
    if (this._pausaImpacto) {
      dt = this.tiempoTrasImpacto(dt);
      if (!this.pausaImpacto && !this._pausaImpacto.detenida) this._pausaImpacto = null;
      if (dt <= 0) {
        this._measurePlayer(ctx);
        if (this.character && this._actualizarVisibilidad(ctx) && !this.hitLean.applied) this.hitLean.apply(this.character.group);
        return;
      }
    }
    if (this.hitLean.applied) this.hitLean.remove(this.character.group);
    const beforeX = this.position.x, beforeZ = this.position.z, beforeYaw = this.root.rotation.y;
    if (this._riseLeft > 0) this._riseLeft = Math.max(0, this._riseLeft - dt);
    if (this.person && !this.isDead) this._updateConduct(dt, ctx);
    else this._measurePlayer(ctx);
    const reactionTime = Math.min(dt, this._hitReactionRemaining);
    this._updateReaction(dt);
    const countering = this._updateCounterAttack(Math.max(0, dt - reactionTime));
    if (!this.koState && this._hitReactionRemaining > 0) {
      this.action = 'recibirGolpe';
      if (this._ownsLocomotionState) this.state = 'recibirGolpe';
      this.actionProgress = 1 - this._hitReactionRemaining / NPC_HIT_REACTION_DURATION;
      this.moving = false;
      if (this._riseLeft <= 0) this.root.rotation.y += wrapAngle(this._punchFacing - this.root.rotation.y) * Math.min(1, dt * 12);
    } else if (countering) {
      this.action = this._counterPose ? 'golpear' : null;
      this.moving = false;
      if (this._ownsLocomotionState) this.state = 'defend';
    } else {
      if (this.action === 'recibirGolpe') { this.action = null; this.actionProgress = 0; }
      if (!this.koState && dt > reactionTime && this._updateWitness(dt - reactionTime)) { /* quieto, grabando o llamando */ }
      else if (!this.koState && dt > reactionTime) this._walk(dt - reactionTime);
      else this.moving = false;
      if (this._ownsLocomotionState) this.state = this.isDead ? 'dead' : this.moving ? (this.fleeTimer > 0 ? 'flee' : 'walk') : 'idle';
    }
    this.root.position.copy(this.position);
    this._updateBenchPose();
    if (this._dropped.length) this._updateDropped(dt);

    if (this.splatTimer > 0) {
      this.splatTimer -= dt;
      if (this.splatTimer <= 0) {
        this.isSplatted = false;
        if (this.splatMesh) {
          this.root.remove(this.splatMesh);
          this.splatMesh.geometry?.dispose?.();
          this.splatMesh.material?.dispose?.();
          this.splatMesh = null;
        }
      }
    }

    this._tickBubble(dt);
    if (this.hitLean.active) {
      if (LOW_STANCES.has(this.poseParams?.stance ?? this.stance)) this.hitLean.clear();
      else {
        this.hitLean.update(dt * RITMO_INCLINACION);
        this.hitLean.orientar(this.root.rotation.y);
      }
    }
    // Las poblaciones civiles retiran sus cadáveres del padrón al alejarse. Los encuentros
    // con vehículos usan la misma pose y piden soltar su modelo cuando ya no está a la vista.
    if (ctx.releaseDeadBody && this.deathSettled && ctx.player && this._playerDist > NPC_LOD.animEvery) {
      const hidden = ctx.frustum ? !this._actualizarVisibilidad(ctx) : this._playerDist > (ctx.drawDistance ?? NPC_LOD.animStop) + NPC_LOD.drawMargin;
      if (hidden) { this.dispose(); return; }
    }
    if (!this.character) return;
    this._actualizarModelo(dt, ctx, beforeX, beforeZ, beforeYaw);
    if (this.root.visible) this.hitLean.apply(this.character.group);
  }

  _actualizarVisibilidad(ctx) {
    const dist = ctx.player ? this._playerDist : 0;
    // fuera de cámara: ni se dibuja ni se anima
    _sphere.center.set(this.position.x, this.position.y + (this.isDead ? .45 : .9), this.position.z);
    _sphere.radius = this.isDead ? 2.2 : 1.4; // la cabeza tendida puede seguir en pantalla aunque los pies ya no
    const onScreen = !ctx.frustum || ctx.frustum.intersectsSphere(_sphere);
    // El límite solo apaga el dibujo: ruta, reservas y tráfico siguen arriba, con su posición.
    const drawn = onScreen && dist <= (ctx.drawDistance ?? Infinity) + (this.root.visible ? NPC_LOD.drawMargin : 0);
    this.root.visible = drawn;
    for (const drop of this._dropped) drop.mesh.visible = drawn;
    // Sin dibujarse, nadie lee sus huesos: el render se ahorra recorrer sus matrices.
    if (ctx.skipHiddenMatrices) this.root.matrixWorldAutoUpdate = drawn;
    return drawn;
  }

  _actualizarModelo(dt, ctx, beforeX, beforeZ, beforeYaw) {
    const drawn = this._actualizarVisibilidad(ctx);
    const dist = ctx.player ? this._playerDist : 0;
    const sample = this._pedestrianMotion;
    const measureStep = sample && drawn && dist <= NPC_LOD.animStop && !this.isVendor && !this.koState;
    if (measureStep) {
      // El paso visible toma metros recorridos, incluyendo los tramos cortos y los cuadros saltados por el LOD.
      if (this.moving) {
        const dx = this.position.x - beforeX, dz = this.position.z - beforeZ;
        sample.distance += Math.sqrt(dx * dx + dz * dz);
      }
      sample.angle += wrapAngle(this.root.rotation.y - beforeYaw);
      sample.elapsed += dt;
    } else if (sample) {
      sample.distance = sample.elapsed = sample.angle = 0;
      sample.reset ||= dist > NPC_LOD.animStop || (!drawn && this.animAcc + dt > CHANGED_UNSEEN);
    }
    if (!drawn) { this.animAcc += dt; return; }
    this._updateDetail(dist);
    if (!this.isDead) this._updateSpeech(dt, ctx);
    // Huir manda sobre la postura que tuviera, menos sobre el paraguas: sale corriendo con él en la mano. El testigo
    // tiene el celular en la oreja (llamando) o al frente (grabando).
    const witness = this._witness && WITNESS_STANCE[this._witness.mode];
    const posture = this.poseParams?.stance ?? (witness || this._stanceNow());
    const stance = this.fleeTimer > 0 && this.moving && posture !== 'paraguas' ? 'huir' : posture;
    this._updateHeld(stance);

    this.animAcc += dt;
    this.frame++;
    // Navegación activa, pose lejana congelada; si cambió de postura, esa sí la toma, de una, una sola vez.
    if (dist > NPC_LOD.animStop && !this.koState) {
      if (stance === this._posedStance) return;
      this.character.snapPose?.();
    }
    if (this.koState === 'down' && this._koBlend >= 1 && !this._poseStale) return; // tendido: pose fija, sin animar
    const budget = ctx.animationBudget ?? this.animationBudget;
    const interval = dist > NPC_LOD.animEvery ? .1 * budget : budget > 1 ? budget / 60 : 0;
    // Recién cambiado de modelo se anima ya: un cuadro con el modelo nuevo en su pose de reposo se ve como un destello.
    if (interval && this.animAcc < interval && !this._poseStale) return;
    const talk = this.talk, partner = talk?.partner;
    const canAttend = this.poseParams?.look == null && !this.koState && this.fleeTimer <= 0 && !this.action
      && !NO_GLANCE.has(stance) && !LOW_STANCES.has(stance);
    const attention = canAttend && talk?.attention;
    const attending = canAttend && !talk?.yielding && talk?.ready && partner?.talk?.ready && partner.talk.partner === this;
    let conversationEye = null;
    if (attention) {
      const { x, y, z } = attention.position;
      conversationEye = attention.character?.eyePosition?.(_conversationEye) ?? _conversationEye.set(x, y + 1.55, z);
    } else if (attending) conversationEye = partner.character?.eyePosition?.(_conversationEye) ?? null;
    const look = this.isDead ? 0 : this.poseParams?.look ?? (stance === 'mirar-surtido' ? 0 : this.mind?.gaze(stance) ?? this._glanceAt(ctx, stance));
    // La velocidad va en metros del modelo: con la talla cambia el largo del paso, no se patina.
    const scale = REALISTIC_SCALE * (this.look?.real?.talla?.alto ?? 1);
    this.character.update(Math.min(this.animAcc, 0.2), {
      speed: this.moving ? (this.fleeTimer > 0 ? this._fleeSpeed() : this._paceNow()) / scale : 0,
      running: this.moving && this.fleeTimer > 0,
      caneGround: this.groundHeight,
      caneYaw: this.root.rotation.y,
      bench: this._bench,
      pedestrianMotion: measureStep ? sample : null,
      ...this.poseParams,
      state: this.state, action: this.action, actionProgress: this.actionProgress,
      troncoDirigido: this.hitLean.active,
      attack: this._counterPose ?? this.poseParams?.attack,
      combatGuard: this._counter?.phase === 'warning' || this._counter?.phase === 'wait' || !!this.poseParams?.combatGuard,
      look: conversationEye ? 0 : look,
      conversationEye,
      conversationNod: attending ? talk.nod : 0,
      // Caer sigue a la misma mezcla que acuesta el cuerpo.
      stance,
      style: this.poseParams?.style ?? this.style,
      rising: this._riseLeft > 0,
      ko: smooth(this._koBlend),
      koPlan: this._koPlan,
      koFrom: this._koFrom
    });
    this._poseStale = false;
    this._posedStance = stance;
    this.animAcc = 0;
    if (measureStep) {
      sample.distance = sample.elapsed = sample.angle = 0;
      sample.reset = false;
    }
  }



  /** Compatibilidad: cada llamada representa un contacto distinto, sin inmunidad global. */
  takePunch(attacker) {
    if (!attacker?.position) return false;
    return this.takeHit({ damage: WEAPONS.punos.damage, knockback: WEAPONS.punos.knockback, attacker, weapon: 'punos' });
  }

  _acceptAttackId(attacker, attackId) {
    if (attackId === null || attackId === undefined) return true;
    const owner = attacker && (typeof attacker === 'object' || typeof attacker === 'function');
    let accepted = owner ? this._acceptedAttacks.get(attacker) : this._anonymousAttacks;
    if (!accepted) { accepted = new Set(); this._acceptedAttacks.set(attacker, accepted); }
    if (accepted.has(attackId)) return false;
    accepted.add(attackId);
    return true;
  }

  /** La defensa se anuncia y conecta después; alejarse o ponerse tras una pared la evita. */
  _counterAttack(attacker, unarmedDamage = null, damageFactor = 1) {
    if (this._defenseUsed || !this._ownsLocomotionState || this.isVendor || this.isDead || LOW_STANCES.has(this.stance)
      || typeof attacker?.stats?.salud !== 'number') return false;
    this._defenseUsed = true;
    if (this.health < this.maxHealth * .3 || this.defenseResolve + .15 * (this.mind?.temper?.stand ?? 0) < .6) return false;
    if (this.person?.real?.accesorios?.some(item => item.id === 'baston-calle') || this.person?.style?.carry) return false;
    const weapon = this.carriesKnife ? 'cuchillo' : 'punos';
    const damage = (this.carriesKnife ? WEAPONS.cuchillo.damage : (unarmedDamage ?? 10 + Math.random() * 7)) * damageFactor;
    this._counter = { attacker, weapon, phase: 'wait', elapsed: 0, damage: Math.floor(damage) };
    return true;
  }

  /** Un raponazo puede provocar la misma respuesta anunciada que una agresión de frente. */
  defendAgainstTheft(attacker, unarmedDamage, damageFactor) {
    return this._counterAttack(attacker, unarmedDamage, damageFactor);
  }

  _clearCounterAttack() {
    if (this._counter?.weapon === 'cuchillo' && this._counter.phase !== 'wait') {
      this.lodChar?.setWeapon?.(null);
      if (this.fullChar !== this.lodChar) this.fullChar?.setWeapon?.(null);
    }
    if (this._counterPose && this.action === 'golpear') this.action = null;
    this._counter = null;
    this._counterPose = null;
  }

  _updateCounterAttack(dt) {
    const counter = this._counter;
    if (!counter) return false;
    const attacker = counter.attacker;
    if (this._disposed || this.isDead || !attacker?.position || attacker._disposed || attacker.stats?.salud <= 0 ||
      attacker.isSwimming || attacker.inWater || attacker.atWheel || attacker.state === 'sleeping') {
      this._clearCounterAttack(); return false;
    }
    if (this._hitReactionRemaining > 0) return false;
    if (counter.phase === 'wait') {
      if (counter.weapon === 'cuchillo' && !this.character) return true;
      counter.phase = 'warning';
      if (counter.weapon === 'cuchillo') this.character?.setWeapon?.('cuchillo');
      this.say(counter.weapon === 'cuchillo' ? '¡Atrás, tengo cuchillo!' : any(DEFENSE_PHRASES), 2);
      // El aviso se dibuja al menos un cuadro, también si el golpe entró en un cuadro largo.
      return true;
    }
    if (counter.phase === 'warning' || (counter.phase === 'windup' && counter.elapsed < NPC_COMBAT.counterWindup * .6)) {
      const yaw = Math.atan2(attacker.position.x - this.position.x, attacker.position.z - this.position.z);
      this.root.rotation.y += wrapAngle(yaw - this.root.rotation.y) * Math.min(1, dt * 12);
    }
    counter.elapsed += dt;
    if (counter.phase === 'warning') {
      const duration = counter.weapon === 'cuchillo' ? NPC_COMBAT.knifeWarning : NPC_COMBAT.counterWarning;
      if (counter.elapsed < duration) return true;
      counter.elapsed -= duration;
      counter.phase = 'windup';
      this._counterPose = { weapon: counter.weapon, step: 0, phase: 'windup', progress: 0,
        timing: { windup: NPC_COMBAT.counterWindup, active: NPC_COMBAT.counterActive, recovery: NPC_COMBAT.counterRecovery } };
    }
    if (counter.phase === 'windup' && counter.elapsed >= NPC_COMBAT.counterWindup) {
      counter.phase = 'active'; counter.elapsed -= NPC_COMBAT.counterWindup;
      this._counterContact(counter);
    }
    if (counter.phase === 'active' && counter.elapsed >= NPC_COMBAT.counterActive) {
      counter.phase = 'recovery'; counter.elapsed -= NPC_COMBAT.counterActive;
    }
    if (counter.phase === 'recovery' && counter.elapsed >= NPC_COMBAT.counterRecovery) {
      this._clearCounterAttack(); return false;
    }
    this._counterPose.phase = counter.phase;
    const duration = counter.phase === 'windup' ? NPC_COMBAT.counterWindup
      : counter.phase === 'active' ? NPC_COMBAT.counterActive : NPC_COMBAT.counterRecovery;
    this._counterPose.progress = Math.min(1, counter.elapsed / duration);
    return true;
  }

  _counterContact({ attacker: player, weapon, damage }) {
    const dx = player.position.x - this.position.x, dz = player.position.z - this.position.z;
    const distance = Math.hypot(dx, dz), yaw = this.root.rotation.y;
    if (distance > 1e-6 && (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance < WEAPONS[weapon].arc) return;
    if (!canReachCombatTarget({ from: this.position, to: player.position,
      collisions: this.collisions ?? player._lastCollisions, getWaterInfo: this.getWaterInfo,
      maxDistance: WEAPONS[weapon].range, toInWater: !!player.isSwimming || !!player.inWater })) return;
    const previousHealth = player.stats.salud;
    const health = player.stats.salud = Math.max(0, previousHealth - damage);
    player.stats.danoPor = 'pelea';
    player.receiveHit?.(this._direction.set(dx, 0, dz), 1.6, { salud: health });
    player.audio?.playPunchHit?.(weapon);
    if (globalThis.window?.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('npc-player-hit', { detail: { attacker: this, victim: player, weapon,
        damage: previousHealth - health, previousHealth, health, position: player.position.clone() } }));
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: `¡Se me defendió! −${previousHealth - health} de salud.`, type: 'warn' }
      }));
    }
  }

  /**
   * false rechaza el contacto; un número >=0 lo acepta y es su recompensa.
   * Los IDs se deduplican por atacante, sin bloquear pasos legítimos del combo.
   */
  takeHit({ damage = 10, dir = null, knockback = 0, attacker = null, weapon = 'punos', attackId = null, id = null } = {}) {
    if (this._disposed || this.koState || !(this.health > 0) || !Number.isFinite(damage) || damage <= 0) return false;
    if (!this._acceptAttackId(attacker, attackId ?? id)) return false;
    const previousHealth = this.health;
    this._witness = null;
    this._witnessFinished = false;
    this.mind?.leaveTalk?.();
    this.talk?.leave?.();
    this._clearCounterAttack();
    this.hitBy = attacker; // la mente culpa a quien le pegó (entities/npc/awareness.js); null: un carro, nadie
    let dx = dir?.x ?? 0, dz = dir?.z ?? 0;
    if (!dir && attacker?.position) { dx = this.position.x - attacker.position.x; dz = this.position.z - attacker.position.z; }
    const len = Math.hypot(dx, dz);
    if (Number.isFinite(len) && len > .0001) this._lastHit.set(dx / len, 0, dz / len);
    this.panicDir = { x: this._lastHit.x, z: this._lastHit.z };
    this._punchFacing = Math.atan2(-this._lastHit.x, -this._lastHit.z);
    this._combatCollisions = attacker?._lastCollisions ?? this._combatCollisions;
    this.health = Math.max(0, this.health - damage);
    this.target = null; this.route = []; this.routeIndex = 0; this.wait = 0;
    this._cowering = false;
    this._fleeRouted = false;
    this._blocks = 0;
    const low = LOW_STANCES.has(this.stance);
    const bench = this.fijo?.stance === 'banca' && !this.fijo.out && low;
    this._leaveSpot();
    this.staggerTimer = NPC_COMBAT.stagger;
    this._hitReactionRemaining = NPC_HIT_REACTION_DURATION;
    this.action = 'recibirGolpe'; this.actionProgress = 0; this.moving = false;
    if (this._ownsLocomotionState) this.state = 'recibirGolpe';
    // Quien está en el piso no sale rodando con el golpe: primero tiene que pararse.
    this._knockVel.copy(this._lastHit).multiplyScalar(low || !Number.isFinite(knockback) ? 0 : Math.max(0, knockback) * 2 / NPC_COMBAT.stagger);
    if (this.health <= 0) this._dieFromHit({ attacker, weapon, attackId: attackId ?? id, previousHealth,
      wasAggressor: this.isAggressor === true }, bench);
    else {
      if (!low && this._riseLeft <= 0) this._inclinarGolpe(this._lastHit, knockback);
      else this._enderezarGolpe();
      this._setFleeAway(this._lastHit.x, this._lastHit.z);
      this.fleeDir.copy(this._lastHit);
      this.fleeTimer = Math.max(this.fleeTimer, NPC_COMBAT.flee);
      this.panicTimer = NPC_COMBAT.flee;
      if (this._bubbleTimer <= 0) {
        // El texto se sortea siempre: así el azar del juego es el mismo con voz o sin ella.
        const queja = HIT_PHRASES[Math.floor(Math.random() * HIT_PHRASES.length)];
        // Si le pegó el jugador y lo dice con su voz, la burbuja es la de la grabación y dura lo mismo que la de texto.
        if (esElJugador(attacker) && vocesDelJuego()?.decirGolpeado?.(this) === true) this._bubbleTimer = Math.max(this._bubbleTimer, 4);
        else this.say(queja, 4);
      }
      if (!low) this._counterAttack(attacker);
    }
    if (this.looted) return 0;
    this.looted = true;
    const dropMoney = 200 + Math.floor(Math.random() * 400);
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      const verb = WEAPONS[weapon]?.hitVerb ?? 'Golpe';
      const end = this.koState ? 'quedó tendido' : 'intenta defenderse o huir';
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: `${verb}: el transeúnte soltó ${dropMoney} y ${end}.`, kind: 'info' }
      }));
    }
    return dropMoney;
  }

  /** El cruce a cero queda consumido antes de notificar: un oyente puede guardar o intentar otro golpe. */
  _dieFromHit({ attacker = null, weapon = 'punos', attackId = null, previousHealth, wasAggressor = false }, bench = false) {
    if (this._disposed || this.isDead || !(previousHealth > 0) || this.health !== 0) return false;
    this._startDeath(bench);
    globalThis.window?.dispatchEvent?.(new CustomEvent('npc-death', { detail: {
      victim: this, attacker, position: this.position.clone(), previousHealth, health: 0, weapon, attackId, wasAggressor
    } }));
    return true;
  }

  _startDeath(bench, pose = null) {
    this.koState = 'down';
    this.state = 'dead';
    this.limpiarImpacto();
    this._clearCounterAttack();
    this.mind?.reset?.();
    this.talk?.leave?.();
    this.talk = null;
    this._witness = null;
    this._witnessFinished = false;
    this.walkVisit = null;
    this.target = null;
    this.route.length = 0;
    this.routeIndex = 0;
    this.wait = 0;
    this._hitReactionRemaining = 0;
    this.action = null;
    this.actionProgress = 0;
    this.poseParams = null;
    this.moving = false;
    this.fleeTimer = 0;
    this.panicTimer = 0;
    if (pose && Object.hasOwn(KO_PLANS, pose.plan)) {
      this._koPlan = pose.plan;
      this._koFrom = LOW_STANCES.has(pose.from) ? pose.from : null;
      this._koTurn = null;
    } else this._planFall(bench);
    this._riseLeft = 0;
    this._standingUp = false;
    this.stance = null;
    this._dropHeld();
    if (this.phone) this.phone.visible = false;
    this._smokingChar?.setSmoking?.(false);
    this._smokingChar = null;
    if (this._bubbleEl) { this._bubbleEl.remove(); this._bubbleEl = null; acabarFrase(this); }
    this._bubbleTimer = 0;
  }

  /** Rehidrata un fallecido en la posición asignada por el guardado, sin representar otro incidente. */
  restoreDeath({ facing, plan, from } = {}) {
    if (this._disposed) return;
    const bench = this.stance === 'banca';
    this.health = 0;
    this.looted = true;
    this.staggerTimer = 0;
    this._knockVel.set(0, 0, 0);
    if (Number.isFinite(facing)) this.root.rotation.y = facing;
    if (!this.isDead) {
      if (LOW_STANCES.has(this.stance)) { this._lowFrom = this.stance; this._riseLeft = CONDUCT.riseFast; }
      this._startDeath(bench, { plan, from });
    } else if (Object.hasOwn(KO_PLANS, plan)) {
      this._koPlan = plan;
      this._koFrom = LOW_STANCES.has(from) ? from : null;
    }
    this.root.rotation.y = Number.isFinite(facing) ? facing : this._fallYaw;
    this._koTurn = null;
    this._koEnd?.copy(this.position);
    for (const drop of this._dropped) {
      drop.yaw = this.root.rotation.y;
      this._restDrop(drop, this.position);
    }
    this._koBlend = 1;
    this._poseStale = true;
    this.root.position.copy(this.position);
    this._updateReaction(0);
    this._updateDropped(DROP_TIME);
    if (this.character) this._actualizarModelo(0, {}, this.position.x, this.position.z, this.root.rotation.y);
  }

  /** Sacudón y caída; corre también fuera de cámara. Una vez en el suelo conserva la última pose. */
  _updateReaction(dt) {
    this._hitReactionRemaining = Math.max(0, this._hitReactionRemaining - dt);
    if (this.panicTimer > 0) this.panicTimer = Math.max(0, this.panicTimer - dt);
    if (this.staggerTimer > 0) {
      if (this._knockVel.x || this._knockVel.z) {
        this._nextPosition.copy(this.position).addScaledVector(this._knockVel, avanceEmpujon(this.staggerTimer, dt));
        resolveCombatWalk({ from: this.position, to: this._nextPosition,
          groundHeight: this.groundHeight, isWalkable: this.isWalkable,
          getWaterInfo: this.getWaterInfo,
          collisions: this.collisions ?? this._combatCollisions }, this.position);
      }
      this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    }

    if (this.isDead && this._koBlend < 1) {
      this._koBlend = Math.min(1, this._koBlend + dt / NPC_COMBAT.fall);
      this._turnWhileFalling();
      if (this._koBlend >= 1) this._poseStale = true;
    }
  }

  /** Dónde queda el cuerpo cuando se acabe el empuje del golpe. */
  _knockEnd() {
    const end = this._koEnd ??= new THREE.Vector3();
    end.copy(this.position);
    if (!this._knockVel.x && !this._knockVel.z) return end;
    this._nextPosition.copy(this.position).addScaledVector(this._knockVel, avanceEmpujon(this.staggerTimer));
    return resolveCombatWalk({ from: this.position, to: this._nextPosition,
      groundHeight: this.groundHeight, isWalkable: this.isWalkable, getWaterInfo: this.getWaterInfo,
      collisions: this.collisions ?? this._combatCollisions }, end);
  }

  /** Lo que ocupa sitio en este rectángulo, para quien cae. */
  _fallRoom(minX, minZ, maxX, maxZ) {
    const collisions = this.collisions ?? this._combatCollisions;
    if (collisions?.queryFallRoom) return collisions.queryFallRoom(minX, minZ, maxX, maxZ, _solids);
    return collisions?.queryStatic ? collisions.queryStatic(minX, minZ, maxX, maxZ, _solids) : [];
  }

  /** ¿Hay algo a la altura del cuerpo en este punto? */
  _bodyHits(x, z, y, margin, list) {
    for (let i = 0; i < list.length; i++) {
      const { box } = list[i];
      if (box.max.y > y + FALL.low && box.min.y < y + FALL.high && x > box.min.x - margin && x < box.max.x + margin && z > box.min.z - margin && z < box.max.z + margin) return true;
    }
    return false;
  }

  /** ¿Cabe acostado desde `at` con los pies ahí y la cabeza hacia `yaw` + 180°? Sin nada encima ni un piso que se acaba, ni siquiera un sardinel. */
  _roomToLie(at, yaw, list) {
    const backX = -Math.sin(yaw), backZ = -Math.cos(yaw), { body, step, length, floor, curb } = FALL;
    let last = at.y;
    for (let d = 0; d <= length; d += step) {
      const x = at.x + backX * d, z = at.z + backZ * d;
      const ground = this.groundHeight(x, z, at.y);
      if (!Number.isFinite(ground) || Math.abs(ground - at.y) > floor || (d > 0 && Math.abs(ground - last) > curb)) return false;
      last = ground;
      // Los pies ya están donde está: lo que tenga pegado solo estorba si el cuerpo va hacia allá.
      if (d > 0 && this._bodyHits(x, z, at.y, body, list)) return false;
    }
    return true;
  }

  /** ¿Caben las piernas si se escurre sentado mirando a `yaw`? La espalda sí puede ir contra algo. */
  _roomToSit(at, yaw, list) {
    const { legs, legsBody } = FALL;
    for (const k of [.4, .7, 1]) {
      if (this._bodyHits(at.x + Math.sin(yaw) * legs * k, at.z + Math.cos(yaw) * legs * k, at.y, legsBody, list)) return false;
    }
    return true;
  }

  /** Antes de caer mira qué tiene detrás: si no cabe, gira hacia un lado libre mientras se va, o se escurre donde le quepan las piernas. */
  _chooseFall(at, turns) {
    const reach = FALL.length + FALL.body;
    const list = this._fallRoom(at.x - reach, at.z - reach, at.x + reach, at.z + reach);
    const yaw = this.root.rotation.y;
    for (let i = 0; i < turns.length; i++) {
      if (this._roomToLie(at, yaw + turns[i], list)) return { turn: turns[i], slump: false };
    }
    for (let i = 0; i < turns.length; i++) {
      if (this._roomToSit(at, yaw + turns[i], list)) return { turn: turns[i], slump: true };
    }
    return { turn: 0, slump: true };
  }

  /** El empuje no lleva el cuerpo a meterse en lo que no detiene a nadie (a lo sólido ya no entra): se queda antes. */
  _stopKnockShort() {
    const reach = avanceEmpujon(this.staggerTimer), dist = Math.hypot(this._knockVel.x, this._knockVel.z) * reach;
    const collisions = this.collisions ?? this._combatCollisions;
    if (!(dist > 0) || !collisions?.queryFallObstacles) return;
    const { x, y, z } = this.position, room = dist + FALL.trunk;
    const list = collisions.queryFallObstacles(x - room, z - room, x + room, z + room, _solids);
    if (!list.length) return;
    // Si ya estaba pegado, puede irse de ahí; lo que no puede es entrar.
    const margin = this._bodyHits(x, z, y, FALL.trunk, list) ? .04 : FALL.trunk;
    const dirX = this._knockVel.x * reach / dist, dirZ = this._knockVel.z * reach / dist;
    let free = 0;
    for (let d = Math.min(.15, dist); d <= dist; d += .15) {
      if (this._bodyHits(x + dirX * d, z + dirZ * d, y, margin, list)) break;
      free = d;
      if (d < dist && d + .15 > dist) d = dist - .15;
    }
    if (free < dist) this._knockVel.multiplyScalar(free / dist);
  }

  _planFall(bench) {
    const from = this._riseLeft > 0 ? this._lowFrom : null;
    this._koFrom = from;
    this._koTurn = null;
    if (bench || from === 'banca') { this._koPlan = 'banca'; this._knockVel.set(0, 0, 0); return; }
    if (from === 'dormido') { this._koPlan = 'dormido'; return; }
    this._stopKnockShort();
    const at = this._knockEnd();
    if (from) {
      // Desde el piso no da vueltas: se va de espaldas o, si no cabe, se escurre.
      const { slump } = this._chooseFall(at, NO_TURN), kneeling = from === 'pedir';
      this._koPlan = slump ? (kneeling ? 'muro-rodillas' : 'muro-bajo') : kneeling ? 'rodillas' : 'bajo';
      return;
    }
    const { turn, slump } = this._chooseFall(at, FALL_TURNS);
    this._koPlan = slump ? 'muro' : 'espalda';
    this._setFallTurn(turn);
  }

  _setFallTurn(turn) {
    this._koTurn = turn ? { from: this.root.rotation.y, by: turn, at: this._koBlend } : null;
  }

  _turnWhileFalling() {
    const turn = this._koTurn;
    if (!turn) return;
    const span = Math.max(.01, FALL.turnUntil - turn.at);
    const k = Math.min(1, (this._koBlend - turn.at) / span);
    this.root.rotation.y = turn.from + turn.by * smooth(k);
    if (k >= 1) this._koTurn = null;
  }

  /** Cómo va a quedar mirando al terminar de caer: de ahí sale dónde queda lo que se le cae. */
  get _fallYaw() { return this._koTurn ? this._koTurn.from + this._koTurn.by : this.root.rotation.y; }

  /** Lo que llevaba cae junto al cuerpo. El LOD nunca vuelve a ponérselo en la mano. */
  _dropHeld() {
    const umbrella = this.umbrella;
    if (umbrella?.visible && this._holder.umbrella) {
      this._holder.umbrella = null;
      this._dropOnFloor(umbrella, DROP_UMBRELLA);
    }
    const cane = this.person?.real?.accesorios?.find(item => item.id === 'baston-calle');
    if (!cane) return;
    this._setCaneInHand(false);
    this._fallenCane ??= createCane(cane.color);
    this._fallenCane.castShadow = this.character === this.fullChar;
    this._dropOnFloor(this._fallenCane, DROP_CANE);
  }

  _setCaneInHand(inHand) {
    this.lodChar?.setPropVisible?.('baston-calle', inHand);
    this.fullChar?.setPropVisible?.('baston-calle', inHand);
  }

  /**
   * Testigo de un robo o una pelea: se queda quieto mirando al jugador con el celular, grabando o llamando a la
   * Policía, durante `seconds`. Un golpe, un susto o quedar noqueado lo interrumpen (ver WitnessSystem).
   */
  witness(mode, seconds, focus = null) {
    if (this._disposed || this.isDead || this.koState || this.isVendor || this.fijo || this.fleeTimer > 0 || this._hitReactionRemaining > 0) return false;
    if (this.deathResponse ? !focus : this.mind?.busy()) return false;
    this.mind?.leaveTalk();
    this._witness = { mode, time: seconds, focus };
    this._witnessFinished = false;
    this.target = null;
    this.route = [];
    return true;
  }

  stopWitness() { this._witness = null; }

  get witnessing() { return this._witness?.mode ?? null; }

  /** Quieto, de frente al jugador y con el celular arriba mientras dura. */
  _updateWitness(dt) {
    const w = this._witness;
    if (!w) return false;
    if (this.koState || this.fleeTimer > 0) { this._witness = null; return false; }
    if ((w.time -= dt) <= 0) { this._witness = null; this._witnessFinished = true; return false; }
    this.moving = false;
    const focus = w.focus ?? this._player;
    if (focus) {
      const yaw = Math.atan2(focus.x - this.position.x, focus.z - this.position.z);
      this.root.rotation.y += wrapAngle(yaw - this.root.rotation.y) * Math.min(1, dt * 6);
    }
    return true;
  }

  /** Pasa el objeto al mundo, una sola vez: desde ahí ya no gasta matrices de ningún hueso. */
  _dropOnFloor(mesh, how) {
    this.scene.add(mesh);
    mesh.scale.setScalar(REALISTIC_SCALE);
    const yaw = this._fallYaw;
    const drop = { mesh, how, yaw, x: 0, z: 0, floor: 0, top: this.position.y + how.top, standing: new THREE.Quaternion(), lying: new THREE.Quaternion(), fall: 0 };
    this._dropped.push(drop);
    this._restDrop(drop, this._koEnd ?? this.position);
    this._updateDropped(0);
  }

  /** ¿Cabe ahí? El agarre y la otra punta, en el mismo piso del cuerpo y fuera de todo lo sólido. */
  _dropFits(at, x, z, farX, farZ) {
    for (let k = 0; k <= 1; k += .5) {
      const px = x + (farX - x) * k, pz = z + (farZ - z) * k;
      const ground = this.groundHeight(px, pz, at.y);
      if (!Number.isFinite(ground) || Math.abs(ground - at.y) > DROP_FLOOR) return false;
      const r = DROP_REACH;
      const list = this._fallRoom(px - r, pz - r, px + r, pz + r);
      for (let i = 0; i < list.length; i++) {
        const { box } = list[i];
        if (box.max.y > ground + .02 && box.min.y < ground + .35 && px > box.min.x - r && px < box.max.x + r && pz > box.min.z - r && pz < box.max.z + r) return false;
      }
    }
    return true;
  }

  /** Busca un lugar libre junto al cuerpo, manteniendo la altura del piso que pisaba. */
  _restDrop(drop, at) {
    const { how, yaw } = drop;
    let dx = 0, dz = 0, y = at.y, turn = 0;
    search: for (const tryTurn of DROP_TURNS) {
      const cos = Math.cos(yaw + tryTurn), sin = Math.sin(yaw + tryTurn);
      const baseCos = Math.cos(yaw), baseSin = Math.sin(yaw);
      for (const [kx, kz] of DROP_SPOTS) {
        const lx = how.x * kx, lz = how.z * kz;
        const x = at.x + lx * baseCos + lz * baseSin, z = at.z - lx * baseSin + lz * baseCos;
        if (!this._dropFits(at, x, z, x + how.far[0] * cos + how.far[1] * sin, z - how.far[0] * sin + how.far[1] * cos)) continue;
        dx = x - at.x; dz = z - at.z;
        y = this.groundHeight(x, z, at.y);
        turn = tryTurn;
        break search;
      }
    }
    drop.fall = 0;
    drop.x = dx; drop.z = dz;
    drop.floor = y + how.lift;
    drop.standing.setFromAxisAngle(_yAxis, yaw + turn);
    drop.lying.copy(drop.standing).multiply(_q1.setFromAxisAngle(_xAxis, how.tilt)).multiply(_q2.setFromAxisAngle(_yAxis, how.spin));
  }

  /** Los accesorios se apoyan en el piso, a la misma altura que el cuerpo. */
  _updateDropped(dt) {
    for (const drop of this._dropped) {
      if (drop.fall >= 1) continue;
      const { mesh, how } = drop;
      drop.fall = Math.min(1, drop.fall + dt / DROP_TIME);
      const k = drop.fall * drop.fall;
      const px = this.position.x, pz = this.position.z, cos = Math.cos(drop.yaw), sin = Math.sin(drop.yaw);
      const fromX = how.from[0] * cos + how.from[1] * sin, fromZ = -how.from[0] * sin + how.from[1] * cos;
      const x = px + fromX + (drop.x - fromX) * drop.fall, z = pz + fromZ + (drop.z - fromZ) * drop.fall;
      mesh.position.set(x, drop.top + (drop.floor - drop.top) * k, z);
      mesh.quaternion.slerpQuaternions(drop.standing, drop.lying, k);
      if (how === DROP_CANE) {
        const floorAt = drop.floorAt ??= (px, pz) => this.groundHeight(px, pz, this.position.y);
        mesh.position.y = Math.max(mesh.position.y, streetCaneContactY(mesh, floorAt));
      }
      mesh.visible = this.root.visible;
    }
  }

  say(text, duration = 3.5) {
    if (this._disposed || this.isDead || typeof document === 'undefined') return;
    const container = document.getElementById('npc-bubbles-container') ?? document.body;
    if (!container) return;

    if (this._bubbleEl) this._bubbleEl.remove();

    this._bubbleEl = document.createElement('div');
    this._bubbleEl.className = 'npc-bubble';
    this._bubbleEl.textContent = text;
    this._bubbleTimer = duration;
    container.appendChild(this._bubbleEl);
    // Se mide una vez y espera escondida a que le toque su sitio: ver src/ui/frases.js
    this._fraseW = this._bubbleEl.offsetWidth;
    this._fraseH = this._bubbleEl.offsetHeight;
    this._fraseVista = 'no';
    this._bubbleEl.style.display = 'none';
    empezarFrase(this);
  }

  /** Se le quita la burbuja si todavía dice `text`: la voz grabada que la acompañaba se cortó. */
  callar(text) {
    if (!this._bubbleEl || this._bubbleEl.textContent !== text) return;
    this._bubbleEl.remove();
    this._bubbleEl = null;
    this._bubbleTimer = 0;
    acabarFrase(this);
  }

  /** La burbuja se acaba a su tiempo aunque quien habló haya salido de cámara: si no, queda flotando para siempre. */
  _tickBubble(dt) {
    if (!(this._bubbleTimer > 0)) return;
    this._bubbleTimer -= dt;
    if (this._bubbleTimer <= 0 && this._bubbleEl) {
      this._bubbleEl.remove();
      this._bubbleEl = null;
      acabarFrase(this);
    }
  }

  _updateSpeech(dt, ctx) {
    if (!ctx.player || this._bubbleEl || !canGreet(this)) return;
    const now = performance.now();

    if (this._playerDist < 2.8 && (now - this._lastSpokenTime > 14000)) {
      this._lastSpokenTime = now;
      if (Math.random() < 0.5) {
        const isDirty = (ctx.hygiene ?? 100) < CONDUCT.noseHygiene;
        const list = isDirty ? BOGOTA_DIRTY_PHRASES : !this.person ? BOGOTA_PHRASES : Math.random() < .65 ? this.person.frases : GREETINGS;
        const phrase = list[Math.floor(Math.random() * list.length)];
        this.say(phrase);
      }
    }
  }

  /** Paraguas en la mano derecha: una malla por persona, con geometría y material compartidos. */
  _updateUmbrella(open) {
    if (open) this.umbrella ??= createUmbrella(this.person?.paraguas ?? 0);
    const umbrella = this.umbrella;
    if (!umbrella || this._dropped.some(drop => drop.mesh === umbrella)) return;
    umbrella.visible = open;
    if (!umbrella.visible || !this.character || this._holder.umbrella === this.character) return;
    if (!this.character.hold?.(umbrella, 'paraguas')) this.root.add(umbrella);
    umbrella.castShadow = this.character === this.fullChar;
    this._holder.umbrella = this.character;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.bodyReleased = this.isDead;
    this.root.visible = false;
    this.talk?.leave?.();
    this.limpiarImpacto();
    this._clearCounterAttack();
    if (this._bubbleEl) {
      this._bubbleEl.remove();
      this._bubbleEl = null;
      acabarFrase(this);
    }
    this.umbrella?.removeFromParent();
    this.umbrella = null;
    this._fallenCane?.removeFromParent();
    this._fallenCane = null;
    this._dropped.length = 0;
    this.phone?.removeFromParent();
    this.phone = null;
    this.lodChar?.dispose?.();
    this.fullChar?.dispose?.();
    if (this.splatMesh) {
      this.root.remove(this.splatMesh);
      this.splatMesh.geometry?.dispose?.();
      this.splatMesh.material?.dispose?.();
      this.splatMesh = null;
    }
    this.scene.remove(this.root);
  }
}
