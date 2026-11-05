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
import { koHandDown, RISE_TIME, smooth } from '../character/BodyLanguage.js';
import { LOW_STANCES, SEARCH_ACTION, personLook, pickArchetype, pickStop, pickWalk, rollPerson } from '../character/archetypes.js';
import { UMBRELLA_REST, createCane, createClosedStick, createPhone, createUmbrella } from '../character/props.js';
import { HAND_ON_FLOOR } from '../character/stances.js';
import { WEAPONS } from '../data/weapons.js';
import { canReachCombatTarget, resolveCombatWalk } from '../systems/CombatGeometry.js';
import { acabarFrase, empezarFrase } from '../ui/frases.js';

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

// Golpes: sin muerte ni desaparición. A 0 de salud el peatón cae, queda tendido y se levanta huyendo.
export const NPC_HEALTH = 100;
export const NPC_COMBAT = {
  stagger: 0.28,   // s de sacudón tras cada golpe (no camina; el golpe lo empuja)
  flee: 5,         // s de huida veloz tras recibir un golpe
  fall: 0.7,       // s en caer: primero ceden las rodillas, después se va de espaldas
  downMin: 6,      // s mínimos tendido
  downExtra: 2,    // + hasta tantos s al azar
  rise: 1.5,       // s en levantarse: sentado, una mano y una rodilla, piernas y por último el tronco
  riseFlee: 6,     // s de huida al levantarse
  counterWindup: .35,
  counterActive: .1,
  counterRecovery: .22,
  counterRange: 1.75
};
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
// Lo que se le cae a quien queda noqueado, en metros desde sus pies: `x` hacia su izquierda y `z` hacia adelante. Queda
// donde va a apoyar la mano derecha al levantarse. `from` es de dónde sale, `top` a qué altura está la mano y `far` hasta
// dónde llega el resto del objeto en el piso, desde el agarre: eso también tiene que quedar libre y a la misma altura.
const UMBRELLA_CLOSED = .13; // de ancho, frente al paraguas abierto
const UMBRELLA_OPENS = .94;  // cuánto lleva de pararse cuando el domo ya pasa por encima de la cabeza
const DROP_TIME = .35;
const DROP_FLOOR = .25;  // m de diferencia con el piso del cuerpo: más ya es otro piso
const DROP_REACH = .06;  // m de holgura contra un sólido
const DROP_CANE = { x: HAND_ON_FLOOR.x - .06, z: HAND_ON_FLOOR.z - .1, from: [-.25, 0], top: .85, lift: .02, tilt: Math.PI / 2, spin: Math.PI / 2, far: [-.05, -.8], grip: 'prop-baston-calle' };
const DROP_UMBRELLA = { x: HAND_ON_FLOOR.x - .12, z: HAND_ON_FLOOR.z - .12, from: [-.2, .2], top: 1.2, ...UMBRELLA_REST, spin: 0, far: [-.1, .9], grip: 'paraguas' };
const PICK_TIME = .35;   // s en que lo recogido termina de acomodarse en la mano
const DROP_SPOTS = [[1, 1], [.55, .55], [-1, 1], [-.55, .55]]; // de más a menos a mano: si el primero no cabe, el siguiente
const DROP_TURNS = [0, Math.PI / 2, -Math.PI / 2, Math.PI]; // si en ninguno cabe como cayó, apuntando para otro lado
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
// Quien está así no mira a nadie: duerme o tiene la vista en lo suyo.
const NO_GLANCE = new Set(['dormido', 'acurrucado', 'celular', 'telefono']);
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
export async function randomStreetLook({ gastada = false } = {}) {
  const catalog = await loadCatalog();
  const person = rollPerson(gastada ? 'habitante' : pickArchetype('comun'));
  person.real.accesorios = [];
  const look = personLook(person);
  look.real = normalizeReal(catalog, person.real);
  return look;
}

export class Npc {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position
   * @param {{ wander?: number, facing?: number, isWalkable?: (x:number, z:number) => boolean, navigation?: object, groundHeight?: (x:number, z:number) => number, speed?: number, look?: object, gastada?: boolean, zona?: string, arquetipo?: string, fijo?: { stance: string, alternas?: string[], techo?: boolean, reach?: number } }} opts
   */
  constructor(scene, position, opts = {}) {
    this.scene = scene;
    this.home = position.clone();
    this.position = position.clone();
    this.wander = opts.wander ?? 0;
    this.navigation = opts.navigation ?? null;
    this.groundHeight = opts.groundHeight ?? (() => this.home.y);
    // Quién es: `gastada` es habitante de calle y, si no, lo decide la zona. Un `look` dado o un subtipo
    // (escuadrón, conductor bravo) no tienen arquetipo ni conductas: los lleva su propio sistema.
    const arquetipo = opts.look || this.constructor !== Npc ? null
      : opts.arquetipo ?? (opts.gastada ? 'habitante' : pickArchetype(opts.zona));
    const low = LOW_STANCES.has(opts.fijo?.stance);
    this.person = arquetipo ? rollPerson(arquetipo, { sinCarga: !!opts.fijo, tallaFija: opts.fijo?.stance === 'banca' }) : null;
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
    this._playerDist = Infinity;
    this._noseTimer = 0;
    this._noseCooldown = Math.random() * 3;
    this._dropped = [];        // lo que se le cayó al quedar noqueado, mientras está en el piso
    this._fallenCane = null;
    this._player = null;
    this._riseLeft = 0;        // s que le faltan para tener la cadera arriba después de un susto
    this._lowFrom = null;      // la postura baja que acaba de dejar
    this._koPlan = 'espalda';  // cómo cae y cómo se para (ver KO_PLANS)
    this._koFrom = null;       // la postura baja en la que lo noquearon
    this._koTurn = null;       // giro de la caída, si detrás no hay espacio
    this._koEnd = null;        // dónde va a terminar el empuje del golpe
    this._fleeAwayX = 0;       // hacia dónde queda alejarse del susto
    this._fleeAwayZ = 0;
    this._blocks = 0;          // veces seguidas que se ha topado huyendo, cerca del mismo sitio
    this._blockX = 0;
    this._blockZ = 0;
    this._fleeRouted = false;  // huye por la red: se topó dos veces seguidas
    this._cowering = false;    // huyendo sin salida: agachado, esperando a que se le pase
    this._picking = [];        // lo que ya tiene en la mano y todavía se está acomodando
    this._standingUp = false;  // se está parando con calma: la cadera todavía no ha llegado arriba
    // Quien se queda en su sitio toda la partida: `out` mientras anda por ahí después de un susto.
    // `toRest`: va a donde esperar, no de vuelta. `reach`: m que puede salirse de la red al llegar.
    this.fijo = opts.fijo ? {
      stance: opts.fijo.stance, alternas: opts.fijo.alternas ?? null, facing: this.root.rotation.y, low, techo: !!opts.fijo.techo,
      reach: opts.fijo.reach ?? 0, out: false, returnIn: 0, fails: 0, pareja: null, toRest: false, dodging: false,
      nextPose: CONDUCT.alternateMin + Math.random() * CONDUCT.alternateExtra
    } : null;
    if (this.fijo) this.stance = this.fijo.stance;
    this.panicTimer = 0;       // s restantes de pánico: sin charla espontánea mientras dura
    this.panicDir = null;
    this.state = 'idle';
    this._ownsLocomotionState = this.constructor === Npc;
    this.action = null;
    this.actionProgress = 0;
    this._hitReactionRemaining = 0;
    this._punchFacing = this.root.rotation.y;
    this.maxHealth = NPC_HEALTH;
    this.health = NPC_HEALTH;
    this.koState = null;       // null | 'down' (cayendo o tendido) | 'rising'
    this.koTimer = 0;
    this._koBlend = 0;         // 0 de pie .. 1 tendido
    this.staggerTimer = 0;
    this._knockVel = new THREE.Vector3();
    this._lastHit = new THREE.Vector3(0, 0, 1);
    this.looted = false;       // una recompensa por la vida del NPC, también después de un KO
    this._acceptedAttacks = new WeakMap();
    this._anonymousAttacks = new Set();
    this._counter = null;
    this._counterPose = null;
    this._defenseUsed = false;
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
      this.character.update(Math.random() * 3, { speed: 0, stance: this._posedStance, style: this.style, action: this.action });
    })().catch((e) => { this.loadError = e; console.warn('[Npc] no se pudo crear', e); });
  }

  /** Su arquetipo vestido con lo que de verdad hay en el catálogo; sin arquetipo, la apariencia de calle. */
  async _personLook(opts) {
    if (!this.person) return randomStreetLook({ gastada: opts.gastada });
    const look = personLook(this.person);
    look.real = normalizeReal(await loadCatalog(), this.person.real);
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

  _show(char) {
    if (this.character === char) return;
    const motion = this.character?.motionState?.();
    this._finishPicking();
    if (this.character) this.root.remove(this.character.group);
    this.character = char;
    this.root.add(char.group);
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

    this._scream(POOP_SCREAMS);
  }

  /** Lo pillaron metiéndole la mano o le arrancaron algo: huye gritando, sin mancha. */
  alarmedByTheft(thiefPosition = null) {
    this._fleeFrom(thiefPosition);
    this._scream(THEFT_SCREAMS);
  }

  // Dirección de huida: alejarse del origen del susto
  _fleeFrom(origin) {
    if (!this.koState) this.fleeTimer = 8;
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

  _scream(screams) {
    const msg = any(screams);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: msg, type: 'warn' } }));
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
      if (this.isVendor) return; // no deja su puesto
      if (this._cowering) {
        if (this.fleeTimer <= 0) this._stopCowering();
        return;
      }
      this._leaveSpot();
      if (this._riseLeft > 0) return; // desde el piso primero se para: no se desliza sentado
      if (this._fleeRouted) this._fleeAlongRoute(dt);
      else this._fleeStraight(dt);
      if (this.fleeTimer <= 0 && this._fleeRouted) this._endFleeRoute();
      this.root.rotation.y += wrapAngle(Math.atan2(this.fleeDir.x, this.fleeDir.z) - this.root.rotation.y) * Math.min(1, dt * 10);
      return;
    }
    if (this._riseLeft > 0) return; // se está parando de donde estaba agachado

    if (this.fijo && this._stayAtSpot(dt)) return;
    if (!this.navigation && this.wander <= 0 && !this.fijo) return;
    if (!this.target) {
      if ((this.wait -= dt) > 0) return;
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
      const d = this._direction.copy(this.target).sub(this.position);
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

  /** Huye derecho; si se topa, gira a un lado que esté libre. */
  _fleeStraight(dt) {
    this._leaveBench();
    const dir = this.fleeDir, step = this.walkSpeed * 2.4 * dt;
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
      const route = navigation.createRoute(this.position);
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
    const step = Math.min(dist, this.walkSpeed * 2.4 * dt);
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

  /** Velocidad al andar: bajo la lluvia, quien no lleva paraguas apura el paso. */
  _paceNow() {
    return this._raining && this.person?.paraguas === null ? this.walkSpeed * this.person.correr : this.walkSpeed;
  }

  /** El arraigo: lejos de su sitio prefiere volver, y así cada zona conserva a su gente. */
  _chooseRoute() {
    const route = this.navigation.createRoute(this.position);
    if (!this.person || !route.length) return route;
    const away = (list) => (list.at(-1).x - this.home.x) ** 2 + (list.at(-1).z - this.home.z) ** 2;
    if (away(route) < CONDUCT.rooted ** 2) return route;
    const other = this.navigation.createRoute(this.position);
    return other.length && away(other) < away(route) ? other : route;
  }

  /**
   * Terminó un recorrido: según quién sea, se queda un rato en lo suyo o sigue. Nunca se queda parado
   * en un cruce ni fuera de la red: ahí solo toma aire. Bajo la lluvia, sin paraguas, tampoco.
   */
  _takeStop() {
    this.stance = null;
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

  /** En su sitio no camina; después de un susto espera a que se calme la cosa y vuelve. true: no anda. */
  _stayAtSpot(dt) {
    const fijo = this.fijo;
    if (!fijo.out) {
      this.root.rotation.y += wrapAngle(fijo.facing - this.root.rotation.y) * Math.min(1, dt * CONDUCT.turn);
      if (fijo.alternas && (fijo.nextPose -= dt) <= 0) {
        fijo.nextPose = CONDUCT.alternateMin + Math.random() * CONDUCT.alternateExtra;
        this.stance = fijo.alternas[Math.floor(Math.random() * fijo.alternas.length)];
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
    this.stance = fijo.stance;
    if (fijo.low) this.style = null;
    this.wait = 0;
  }

  /** La postura de este momento: la nariz y la lluvia mandan sobre lo que estuviera haciendo de pie. */
  _stanceNow() {
    const person = this.person;
    if (!person || LOW_STANCES.has(this.stance)) return this.stance;
    if (this._noseTimer > 0) return 'nariz';
    if (this._raining && !this.isVendor && !(this.fijo?.techo && !this.fijo.out)) {
      if (person.paraguas !== null) return 'paraguas';
      if (this.moving || this.fijo) return person.lluvia ?? this.stance;
    }
    return this.stance;
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
    this._measurePlayer(ctx);
    if (this.fijo && ctx.chasers?.length) this._dodgeChasers(ctx.chasers);
    // Empezó a llover con él parado: sin paraguas se va pronto.
    if (this._raining && this.person.paraguas === null && !this.target && !this.fijo && this.wait > 2) this.wait = .5 + Math.random() * 1.5;
    if (this._noseTimer > 0) this._noseTimer -= dt;
    if (this._noseCooldown > 0) this._noseCooldown -= dt;
    else if ((ctx.hygiene ?? 100) < CONDUCT.noseHygiene && this._playerDist < CONDUCT.noseRange && this.person.nariz
      && !this.koState && this.fleeTimer <= 0 && !LOW_STANCES.has(this.stance) && !(this._raining && this.person.paraguas !== null && !this.fijo?.techo)) {
      this._noseTimer = 2 + Math.random() * 2;
      this._noseCooldown = this._noseTimer + 8 + Math.random() * 12;
    }
  }

  /** Giro de cabeza hacia el jugador cercano, solo con el modelo completo. */
  _glanceAt(ctx, stance) {
    if (!this.person || !ctx.player || this.character !== this.fullChar || !(this._playerDist < CONDUCT.glance)) return 0;
    if (this.koState || this.fleeTimer > 0 || this.action || NO_GLANCE.has(stance)) return 0;
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
    if (this._riseLeft > 0) this._riseLeft = Math.max(0, this._riseLeft - dt);
    if (this.person) this._updateConduct(dt, ctx);
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
      this.action = 'golpear';
      this.moving = false;
      if (this._ownsLocomotionState) this.state = 'defend';
    } else {
      if (this.action === 'recibirGolpe') { this.action = null; this.actionProgress = 0; }
      if (!this.koState && dt > reactionTime) this._walk(dt - reactionTime);
      else this.moving = false;
      if (this._ownsLocomotionState) this.state = this.koState ?? (this.moving ? (this.fleeTimer > 0 ? 'flee' : 'walk') : 'idle');
    }
    this.root.position.copy(this.position);
    if (this._dropped.length) this._updateDropped(dt);
    if (this._picking.length) this._updatePicking(dt);
    if (this.koState === 'rising' && this.umbrella && this._holder.umbrella) this._foldUmbrella();

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

    if (!this.character) return;

    const dist = ctx.player ? this._playerDist : 0;
    // fuera de cámara: ni se dibuja ni se anima
    _sphere.center.set(this.position.x, this.position.y + 0.9, this.position.z);
    const onScreen = !ctx.frustum || ctx.frustum.intersectsSphere(_sphere);
    // El límite solo apaga el dibujo: ruta, reservas y tráfico siguen arriba, con su posición.
    const drawn = onScreen && dist <= (ctx.drawDistance ?? Infinity) + (this.root.visible ? NPC_LOD.drawMargin : 0);
    this.root.visible = drawn;
    // Sin dibujarse, nadie lee sus huesos: el render se ahorra recorrer sus matrices.
    if (ctx.skipHiddenMatrices) this.root.matrixWorldAutoUpdate = drawn;
    if (!drawn) { this.animAcc += dt; return; }

    this._updateDetail(dist);
    this._updateSpeech(dt, ctx);
    // Huir manda sobre la postura que tuviera, menos sobre el paraguas: sale corriendo con él en la mano.
    const posture = this.poseParams?.stance ?? this._stanceNow();
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
    // La velocidad va en metros del modelo: con la talla cambia el largo del paso, no se patina.
    const scale = REALISTIC_SCALE * (this.look?.real?.talla?.alto ?? 1);
    this.character.update(Math.min(this.animAcc, 0.2), {
      speed: this.moving ? (this.fleeTimer > 0 ? this.walkSpeed * 2.4 : this._paceNow()) / scale : 0,
      running: this.moving && this.fleeTimer > 0,
      ...this.poseParams,
      state: this.state, action: this.action, actionProgress: this.actionProgress,
      attack: this._counterPose ?? this.poseParams?.attack,
      look: this.poseParams?.look ?? this._glanceAt(ctx, stance),
      // Caer sigue a la misma mezcla que acuesta el cuerpo.
      stance,
      style: this.poseParams?.style ?? this.style,
      rising: this._riseLeft > 0,
      ko: smooth(this._koBlend),
      koRising: this.koState === 'rising',
      koPlan: this._koPlan,
      koFrom: this._koFrom
    });
    this._poseStale = false;
    this._posedStance = stance;
    this.animAcc = 0;
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
  _counterAttack(attacker) {
    if (this._defenseUsed || this.koState || typeof attacker?.stats?.salud !== 'number') return;
    this._defenseUsed = true;
    if (this.look?.real?.edad !== 'adulto' && Math.random() >= .35) return;
    this._counter = { attacker, phase: 'wait', elapsed: 0, struck: false, damage: Math.floor(10 + Math.random() * 7) };
    this._counterPose = null;
  }

  _clearCounterAttack() {
    if (this._counterPose && this.action === 'golpear') this.action = null;
    this._counter = null;
    this._counterPose = null;
  }

  _updateCounterAttack(dt) {
    const counter = this._counter;
    if (!counter) return false;
    const attacker = counter.attacker;
    if (this._disposed || this.koState || !attacker?.position || attacker._disposed || attacker.stats?.salud <= 0) {
      this._clearCounterAttack(); return false;
    }
    // Cada nuevo golpe interrumpe la preparación; nunca devuelve daño durante el sacudón.
    if (this._hitReactionRemaining > 0) {
      if (counter.struck) { this._clearCounterAttack(); return false; }
      counter.phase = 'wait'; counter.elapsed = 0; this._counterPose = null;
      return false;
    }
    if (counter.phase === 'wait') {
      counter.phase = 'windup'; counter.elapsed = 0;
      this.say(DEFENSE_PHRASES[Math.floor(Math.random() * DEFENSE_PHRASES.length)], 4);
      this._counterPose = { weapon: 'punos', step: 0, phase: 'windup', progress: 0,
        timing: { windup: NPC_COMBAT.counterWindup, active: NPC_COMBAT.counterActive, recovery: NPC_COMBAT.counterRecovery } };
    }
    this.root.rotation.y += wrapAngle(Math.atan2(attacker.position.x - this.position.x, attacker.position.z - this.position.z) - this.root.rotation.y) * Math.min(1, dt * 12);
    counter.elapsed += dt;
    if (counter.phase === 'windup' && counter.elapsed >= NPC_COMBAT.counterWindup) {
      counter.phase = 'active'; counter.elapsed -= NPC_COMBAT.counterWindup;
      counter.struck = true;
      if (canReachCombatTarget({ from: this.position, to: attacker.position,
        collisions: this.collisions ?? attacker._lastCollisions, getWaterInfo: this.getWaterInfo,
        maxDistance: NPC_COMBAT.counterRange,
        fromInWater: false, toInWater: !!attacker.inWater })) {
        attacker.stats.salud = Math.max(0, attacker.stats.salud - counter.damage);
        attacker.audio?.playPunchHit?.();
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: `¡Se me defendió! −${counter.damage} de salud.`, type: 'warn' }
          }));
        }
      }
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

  /**
   * false rechaza el contacto; un número >=0 lo acepta y es su recompensa.
   * Los IDs se deduplican por atacante, sin bloquear pasos legítimos del combo.
   */
  takeHit({ damage = 10, dir = null, knockback = 0, attacker = null, weapon = 'punos', attackId = null, id = null } = {}) {
    if (this._disposed || this.koState || !Number.isFinite(damage) || damage <= 0) return false;
    if (!this._acceptAttackId(attacker, attackId ?? id)) return false;
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
    if (this.health <= 0) this._startKnockout(bench);
    else {
      this._setFleeAway(this._lastHit.x, this._lastHit.z);
      this.fleeDir.copy(this._lastHit);
      this.fleeTimer = Math.max(this.fleeTimer, NPC_COMBAT.flee);
      this.panicTimer = NPC_COMBAT.flee;
      if (this._bubbleTimer <= 0) this.say(HIT_PHRASES[Math.floor(Math.random() * HIT_PHRASES.length)], 4);
    }
    if (this.looted) return 0;
    this.looted = true;
    if (!low) this._counterAttack(attacker); // desde el piso nadie devuelve el golpe
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

  _startKnockout(bench = false) {
    this._clearCounterAttack();
    this._hitReactionRemaining = 0;
    this.action = null;
    this.actionProgress = 0;
    this.koState = 'down';
    this.koTimer = NPC_COMBAT.downMin + Math.random() * NPC_COMBAT.downExtra;
    this.fleeTimer = 0;
    this._koEnd = null; // el de una caída anterior ya no dice nada
    this.panicTimer = 0;
    this._planFall(bench);
    this._dropHeld();
    if (this._bubbleEl) { this._bubbleEl.remove(); this._bubbleEl = null; acabarFrase(this); }
    this._bubbleTimer = 0;
  }

  /** Sacudón, caída, tendido y levantada; corre aunque el peatón esté fuera de cámara. */
  _updateReaction(dt) {
    this._hitReactionRemaining = Math.max(0, this._hitReactionRemaining - dt);
    if (this.panicTimer > 0) this.panicTimer = Math.max(0, this.panicTimer - dt);
    if (this.staggerTimer > 0) {
      const elapsed = Math.min(dt, this.staggerTimer);
      // Integral exacta del empuje lineal: no recorre más a 10 FPS que a 60 FPS.
      const step = elapsed * (this.staggerTimer - elapsed / 2) / NPC_COMBAT.stagger;
      if (this._knockVel.x || this._knockVel.z) {
        this._nextPosition.copy(this.position).addScaledVector(this._knockVel, step);
        resolveCombatWalk({ from: this.position, to: this._nextPosition,
          groundHeight: this.groundHeight, isWalkable: this.isWalkable,
          getWaterInfo: this.getWaterInfo,
          collisions: this.collisions ?? this._combatCollisions }, this.position);
      }
      this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    }

    if (this.koState === 'down') {
      if (this._koBlend < 1) {
        this._koBlend = Math.min(1, this._koBlend + dt / NPC_COMBAT.fall);
        this._turnWhileFalling();
        if (this._koBlend >= 1) this._poseStale = true; // el cuadro que llega a tendido todavía se anima
      } else if ((this.koTimer -= dt) <= 0) this.koState = 'rising';
    } else if (this.koState === 'rising') {
      this._koBlend = Math.max(0, this._koBlend - dt / NPC_COMBAT.rise);
      if (this._koBlend <= 0) this._recover();
    }
  }

  /** Dónde queda el cuerpo cuando se acabe el empuje del golpe. */
  _knockEnd() {
    const end = this._koEnd ??= new THREE.Vector3();
    end.copy(this.position);
    if (!this._knockVel.x && !this._knockVel.z) return end;
    this._nextPosition.copy(this.position).addScaledVector(this._knockVel, this.staggerTimer / 2);
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
      const ground = this.groundHeight(x, z);
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
    const reach = this.staggerTimer / 2, dist = Math.hypot(this._knockVel.x, this._knockVel.z) * reach;
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

  /** Queda noqueado: lo que tenía en la mano cae al piso a su lado, y lo recoge cuando la mano llega a él. */
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
      const ground = this.groundHeight(px, pz);
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

  /** Junto al cuerpo, donde va a apoyar la mano; si ahí no cabe, más cerca, al otro lado o apuntando para otra parte; en el peor caso, a sus pies. */
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
        y = this.groundHeight(x, z);
        turn = tryTurn;
        break search;
      }
    }
    drop.x = dx; drop.z = dz;
    drop.floor = y + how.lift;
    drop.standing.setFromAxisAngle(_yAxis, yaw + turn);
    drop.lying.copy(drop.standing).multiply(_q1.setFromAxisAngle(_xAxis, how.tilt)).multiply(_q2.setFromAxisAngle(_yAxis, how.spin));
  }

  /** Cae hasta el piso y ahí se queda: no sube solo. Empieza a irse cuando la mano ya llegó. */
  _updateDropped(dt) {
    const rising = this.koState === 'rising';
    for (let i = this._dropped.length - 1; i >= 0; i--) {
      const drop = this._dropped[i], mesh = drop.mesh, how = drop.how;
      if (rising && 1 - smooth(this._koBlend) >= koHandDown(this._koPlan) && this.root.visible && this.character) {
        this._dropped.splice(i, 1);
        this._startPicking(drop);
        continue;
      }
      drop.fall = Math.min(1, drop.fall + dt / DROP_TIME);
      const k = drop.fall * drop.fall;
      const px = this.position.x, pz = this.position.z, cos = Math.cos(drop.yaw), sin = Math.sin(drop.yaw);
      const fromX = how.from[0] * cos + how.from[1] * sin, fromZ = -how.from[0] * sin + how.from[1] * cos;
      mesh.position.set(px + fromX + (drop.x - fromX) * drop.fall, drop.top + (drop.floor - drop.top) * k, pz + fromZ + (drop.z - fromZ) * drop.fall);
      mesh.quaternion.slerpQuaternions(drop.standing, drop.lying, k);
      mesh.visible = this.root.visible;
    }
  }

  /** La mano llegó: desde aquí el objeto va con ella, y en un momento queda como se lleva. */
  _startPicking(drop) {
    const mesh = drop.mesh, cane = mesh === this._fallenCane;
    const motion = this.character.grab?.(mesh, drop.how.grip);
    if (!motion) { this._leaveFloor(mesh); return; }
    mesh.position.copy(motion.from.position);
    mesh.quaternion.copy(motion.from.quaternion);
    mesh.scale.copy(motion.from.scale);
    mesh.visible = true;
    if (!cane) this._holder.umbrella = this.character;
    this._picking.push({ mesh, cane, t: 0, ...motion });
  }

  _updatePicking(dt) {
    for (let i = this._picking.length - 1; i >= 0; i--) {
      const pick = this._picking[i];
      pick.t = Math.min(1, pick.t + dt / PICK_TIME);
      const k = smooth(pick.t), mesh = pick.mesh;
      mesh.position.lerpVectors(pick.from.position, pick.to.position, k);
      mesh.quaternion.slerpQuaternions(pick.from.quaternion, pick.to.quaternion, k);
      mesh.scale.lerpVectors(pick.from.scale, pick.to.scale, k);
      if (pick.t >= 1 && pick.cane) this._caneBackInHand(mesh);
      if (pick.t >= 1) this._picking.splice(i, 1);
    }
  }

  /** El bastón suelto se cambia por el que siempre lleva en la mano: están en el mismo sitio. */
  _caneBackInHand(mesh) {
    mesh.removeFromParent();
    mesh.visible = false;
    this._setCaneInHand(true);
  }

  /** Cambió de modelo con algo a medio acomodar: queda puesto de una, en la mano del que entra. */
  _finishPicking() {
    for (const pick of this._picking.splice(0)) {
      if (pick.cane) this._caneBackInHand(pick.mesh);
      else {
        // Queda en la mano; si es otro modelo el que sigue, `_updateUmbrella` lo pasa a él.
        pick.mesh.position.copy(pick.to.position);
        pick.mesh.quaternion.copy(pick.to.quaternion);
        pick.mesh.scale.copy(pick.to.scale);
      }
    }
  }

  _leaveFloor(mesh) {
    mesh.removeFromParent();
    mesh.visible = false;
    if (mesh === this._fallenCane) this._setCaneInHand(true);
  }

  _pickUpDropped() {
    for (const { mesh } of this._dropped) this._leaveFloor(mesh);
    this._dropped.length = 0;
    this._finishPicking();
    if (this._fallenCane && !this._fallenCane.parent) this._setCaneInHand(true);
  }

  _recover() {
    this.koState = null;
    this.health = this.maxHealth;
    this._koFrom = null;
    this._koPlan = 'espalda';
    this._pickUpDropped();
    this._openUmbrella();
    // Recuperarse no crea otra recompensa ni otro intento de defensa.
    this._setFleeAway(this._lastHit.x, this._lastHit.z);
    this.fleeDir.copy(this._lastHit);
    this.fleeTimer = NPC_COMBAT.riseFlee;
    this.panicTimer = NPC_COMBAT.riseFlee;
  }

  say(text, duration = 3.5) {
    if (typeof document === 'undefined') return;
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

  _updateSpeech(dt, ctx) {
    if (this._bubbleTimer > 0) {
      this._bubbleTimer -= dt;
      if (this._bubbleTimer <= 0 && this._bubbleEl) {
        this._bubbleEl.remove();
        this._bubbleEl = null;
        acabarFrase(this);
      }
    }

    if (!ctx.player || this.koState || this.action === 'recibirGolpe' || this._counter || this.panicTimer > 0) return;
    if (this.stance === 'dormido') return;
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
    if (!umbrella || this._dropped.some(drop => drop.mesh === umbrella) || this._picking.some(pick => pick.mesh === umbrella)) return;
    const carrying = this.koState === 'rising' && !!this._holder.umbrella; // ya lo recogió y se está parando con él
    umbrella.visible = open || carrying;
    if (!umbrella.visible || !this.character || this._holder.umbrella === this.character) return;
    if (!this.character.hold?.(umbrella, 'paraguas')) this.root.add(umbrella);
    umbrella.castShadow = this.character === this.fullChar; // lejos: sin sombra propia, como el cuerpo
    this._holder.umbrella = this.character;
    if (carrying) this._foldUmbrella();
  }

  /**
   * Mientras se para lo lleva cerrado: apretada a lo ancho, la tela se recoge sin geometría nueva, y el palo, que se
   * volvería un hilo, lo pone el mismo bastón de quien lo lleva. Solo cuesta durante la subida; abre con el brazo ya arriba.
   */
  _foldUmbrella() {
    const mesh = this.umbrella, pick = this._picking.find(item => item.mesh === mesh);
    const grip = pick ? smooth(Math.min(1, pick.t * 4)) : 1;
    const up = Math.min(1, Math.max(0, (1 - smooth(this._koBlend) - UMBRELLA_OPENS) / (1 - UMBRELLA_OPENS)));
    const width = 1 - (1 - UMBRELLA_CLOSED) * grip * (1 - smooth(up));
    mesh.scale.set(mesh.scale.y * width, mesh.scale.y, mesh.scale.y * width);
    const stick = this._closedStick ??= createClosedStick(this.person?.paraguas ?? 0);
    if (stick.parent !== mesh) mesh.add(stick);
    stick.visible = width < .5;
    stick.scale.set(1 / width, 1, 1 / width);
  }

  _openUmbrella() {
    const mesh = this.umbrella;
    if (!mesh) return;
    mesh.scale.setScalar(mesh.scale.y);
    this._closedStick?.removeFromParent();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
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
