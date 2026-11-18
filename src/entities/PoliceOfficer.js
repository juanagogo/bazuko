// src/entities/PoliceOfficer.js
// Agente de una patrulla de cuadrante. Se baja del carro sin cortes (abre la puerta, gira sentado, se para junto a ella
// y da el primer paso), persigue a pie por la red de andenes, busca donde vio al jugador por última vez y vuelve a
// subirse por la misma puerta. Lo de cada agente vive aquí; lo que comparten los dos de una patrulla (qué vieron,
// cuándo frena el carro, quién se baja) lo decide PoliceFootSystem. Reutiliza el personaje y el LOD de Npc.
import * as THREE from 'three';
import { Npc, NPC_COMBAT, NPC_HIT_REACTION_DURATION, NPC_LOD } from './Npc.js';
import { DEFAULT_LOOK } from '../character/look.js';
import { smooth } from '../character/BodyLanguage.js';
import { EXIT, EXIT_SECONDS, exitMotion, exitTimes, seatRise, seatSlide } from './patrolExit.js';
import { canReachCombatTarget, hasClearCombatLine, resolveCombatWalk } from '../systems/CombatGeometry.js';
import { PATROL_COLORS } from './patrolCar.js';

export const POLICE_FOOT = {
  dismountRange: 12,     // m: con el jugador a la vista y a esta distancia, la patrulla frena para que se bajen
  stuckTime: 1.5,        // s sin acercarse `stuckProgress` m: frena y se bajan
  stuckProgress: .6,
  stuckReach: 40,        // m: trabada más lejos que esto no se bajan; a los `stuckGiveUp` s desisten
  stuckGiveUp: 4,
  standoff: 4,           // m: el carro no se le echa encima a nadie
  brake: 4.5,            // m/s² al frenar para bajarse: un frenazo, no la parada de un semáforo
  brakeTimeout: 4,       // s: si no logra llegar al punto de parada, frena donde esté
  driverNear: 6,         // m: el conductor también se baja (fichado 2 o más)
  driverUnreachable: 3,  // s sin camino en carro hasta el jugador: el conductor también se baja (fichado 2 o más)
  cutOffSpeed: 7,        // m/s del conductor que trata de cerrarle el paso por la calle
  cutOffStandoff: 7,
  sprintSpeed: 6.8,      // m/s del pique: algo más que el trote del jugador (6)
  sprintTime: 7,         // s de pique; después se cansa
  tiredSpeed: 5.4,       // m/s cansado: el que corre derecho se le va
  exhaustAfter: 25,      // s corriendo: ya no da más
  exhaustedSpeed: 4.6,
  recover: .5,           // s de pique que recupera por segundo sin correr
  searchSpeed: 3.2,
  walkSpeed: 2,          // al volver al carro
  hurrySpeed: 4.5,       // volviendo, si su patrulla parada tiene al bus esperando o a alguien retenido: trota y no coge aire
  stepSpeed: 1.8,        // el primer paso al bajarse
  halt: .35,             // s frenando al desistir, en dos pasos cortos
  breather: [1, 1.4],    // s después, sin aire, con las manos en los muslos
  radio: 1.2,            // s de radio después, el que avisa
  heavy: 2,              // s que vuelve caminando pesado, con los hombros caídos
  warnRange: 5,          // m: señala y grita
  armedRange: 8,         // m: con fichado 3 apunta desde más lejos
  directRange: 8,        // m: con línea de vista va derecho, sin ruta
  replan: [.4, .6],      // s entre rutas
  sight: 30,             // m que alcanza a ver un agente a pie
  lostTime: 6,           // s sin verlo: va a buscar al último punto donde lo vio
  searchTime: [6, 8],    // s mirando alrededor antes de desistir
  giveUpRange: 55,
  giveUpTime: 40,        // s sin verlo, como el carro; también viéndolo sin poder llegarle (nadando, en un techo)
  progressTime: 20,      // s sin acortarle `progressGain` m, con él a más de `progressFar` m: desisten
  progressGain: 2,
  progressFar: 8,
  pursuitCap: 90,        // s de persecución: desisten, salvo que lo tengan a menos de `pursuitCapNear` m
  pursuitCapNear: 10,
  pursuitCapHard: 110,   // s: desisten aunque lo tengan cerca; ninguna persecución dura para siempre
  returnTimeout: 28,     // s volviendo: si nadie lo ve, se sube de una
  returnStall: 4,        // s sin acercarse a su carro: cambia de plan
  returnCap: 45,         // s volviendo: se sube de una aunque lo vean
  farFromCar: 60,
  shoutEvery: [2.4, 4]
};

/**
 * El agarrón: se ve venir y se puede quebrar. Ya cerca, con la línea limpia, el agente avisa (grita, se echa adelante y
 * estira la mano) y casi no gira; al final del aviso se echa con un zarpazo por ese rumbo, que se resuelve una sola vez:
 * si lo alcanza lo agarra del hombro y frenan los dos; si no, el traspié le cuesta metros y pique.
 */
export const POLICE_GRAB = {
  accel: 11.3,           // m/s²: de quieto al pique (6,8 m/s) en 0,6 s
  pointOff: 3,           // m: más cerca ya no señala, para tener el brazo libre cuando avise
  pointClear: .5,        // s sin señalar antes de avisar: el brazo de señalar termina de bajar antes del zarpazo
  warn: 2,               // m: con la línea limpia, avisa
  warnTime: .5,          // s del aviso
  warnTurn: Math.PI / 3, // rad/s que gira avisando: al que quiebra a tiempo lo deja de lado
  warnAim: Math.PI / 6,  // rad: avisa cuando lo tiene encarrilado (lo que alcanza a girar avisando), o...
  warnWait: .6,          // ...a los tantos s de tenerlo a esa distancia: quebrar antes del aviso solo lo demora
  warnFar: 4,            // m: si avisando se le va más lejos (arrancó en un carro), no se echa al aire
  gap: 1.5,              // m a los que llega al final del aviso
  lunge: .13,            // s del zarpazo: un paso largo
  lungeTurn: Math.PI / 3, // rad/s que alcanza a torcer el zarpazo hacia él: el que quiebra tarde no se salva
  hand: .5,              // m a los que se le echa al que sigue derecho: de ahí el brazo hace el resto
  lungeMax: 1.6,         // m que alcanza a echarse
  reach: 1.3,            // m: hasta aquí lo agarra
  cone: 40 * Math.PI / 180, // a cada lado del rumbo del zarpazo, visto desde donde se echó
  hold: .3,              // s del agarre, frenando los dos; después, el arresto
  holdGap: .55,          // m entre los dos mientras lo tiene del hombro
  stumble: .9,           // s del traspié
  stumbleCarry: .45,     // s que sigue de largo por el rumbo del zarpazo
  stumbleLow: .2,        // s hasta lo más lento del traspié
  stumbleSpeed: 1.75,    // m/s en lo más lento: así sigue hasta recomponerse
  stumbleSprint: 1.5,    // s de pique que le cuesta
  lead: .6,              // s, como mucho, que se le adelanta persiguiéndolo de cerca: corre a cortarle el camino, no a la cola
  sure: 2,               // zarpazos al aire seguidos: el siguiente ya no es un zarpazo, se le tira encima con todo el cuerpo
  sureTurn: 12,          // rad/s que gira entonces, avisando y echado: quebrar ya no lo deja de lado
  sureSwept: 1,          // rad que trae girados hacia un mismo lado sin enderezar...
  sureSweptTime: .3,     // ...y s que lleva girándolos: al que viene dando vueltas se le tira encima de una. Un quiebre suelto dura menos
  sweptTurn: .6,         // rad/s: menos que eso no es venir girando
  sweptRest: .8,         // s derecho (o quieto) para que lo girado se le olvide
  sureFar: 8,            // m: si se le aleja así, la cuenta de zarpazos al aire vuelve a cero...
  sureForget: 6          // ...y también a los tantos s sin echarle otro
};
// Lo que grita al avisar y lo que se lee en pantalla: con el aviso, con el zarpazo que no alcanzó y cuando, después de
// `sure` zarpazos al aire, se le tira encima. `traspie` es lo que se le escapa al agente al irse de largo.
export const POLICE_GRAB_LINES = { aviso: '¡Quieto ahí!', zafo: '¡Se le zafó!', encima: '¡Ya no se me va!', traspie: '¡Uy!' };
// Lo mismo, en corto, para la placa de la persecución: cabe donde va «¡CÓRRALE!» y sale en el mismo cuadro.
export const POLICE_GRAB_PLATE = { aviso: '¡QUIETO!', zafo: '¡SE ZAFÓ!', encima: '¡ENCIMA!' };

export const POLICE_SHOUTS = ['¡Quieto!', '¡Alto ahí!', '¡Policía, quieto!', '¡Deténgase!', '¡No se mueva!'];
export const POLICE_ARMED_SHOUTS = ['¡Las manos donde las vea!', '¡Quieto, policía!', '¡Al piso!'];
const SEARCH_LINES = ['¿Para dónde cogió?', 'Por aquí no está.', '¿Lo ve, mi cabo?'];
// Lo que dice el primero que desiste, según por qué (`PatrolUnit.endReason`).
const GIVE_UP_LINES = {
  perdido: ['Se nos voló.', 'Nada, se perdió.'],
  'sin-avance': ['¡Uf! No le doy alcance.', 'Ese man corre mucho.'],
  inalcanzable: ['Por allá no llegamos.', 'Que salga, ya lo cogemos.'],
  tope: ['Se nos voló.', 'Ya, déjelo así.'],
  estorbo: ['Estamos tapando la vía, vámonos.', 'Muévase, que tenemos la calle tapada.']
};
const HIT_LINE = '¡Eso es agresión a la autoridad!';
// Cómo corre: cansado se encorva y bracea menos; agotado, más. Al estirarse a agarrarlo se echa encima.
const TIRED_STYLE = { stoop: .14, swing: .88 };
const EXHAUSTED_STYLE = { stoop: .32, swing: .7, headDown: .12 };
// El zarpazo que no alcanzó: el brazo barre de largo con el tronco pasado tras él, dos o tres pasos de traspié con la
// cabeza caída y se recompone.
const STUMBLE_STYLE = { stoop: .5, swing: .5, limp: .9, headDown: .2 };
const RECOVER_STYLE = { stoop: .3, swing: .8, headDown: -.1 };
const STUMBLE_SWEEP = .3;  // s con el brazo barriendo de largo
const STUMBLE_STEPS = .3;  // s de los pasos de traspié; el resto, recomponiéndose
// Al desistir: frena con el tronco adelante y los brazos caídos; sin aire, la cabeza cuelga y a la mitad se levanta a
// mirar por dónde se fue; al radio se endereza con un último resuello; vuelve caminando pesado.
const HALT_STYLE = { stoop: .6, swing: .25 };
const HANG_STYLE = { headDown: .25 };
const LIFT_STYLE = { headDown: -.35 };
const GASP_STYLE = { stoop: -.12 };
const GASP = .25;          // s del último resuello al enderezarse
const HEAVY_STYLE = { stoop: .22, swing: .7, headDown: .12 };
const HEAVY_PACE = .8;     // de lo que camina normalmente

const URGENT_STEP = 3.6;    // m/s al final del primer paso de una bajada de afán: ya arrancó a correr
const LOOK_MAX = 1.1;       // rad que gira la cabeza
const STILL_REPLAN = 1.5;   // s entre rutas hacia un punto que no se mueve
const DOOR_SWITCH = 1.5;    // m que tiene que ganar para cambiar de puerta
const BOARD = { door: .35, sit: .5, swing: .45 };
const BENCH_FADE = .8;      // s que tarda en irse la postura de sentado: mientras, su peso queda en cero
const SLIDES = [.7, -.7, 1.3, -1.3];
const CAR_MARGIN = .3;      // m entre la carrocería de su patrulla y el centro del agente
const WALK_RADIUS = .32;    // el de resolveCombatWalk
const DOOR_CLEAR = 1.2;     // m del costado de su patrulla: el primer punto al bajarse, para no salir rozándola
const DOOR_LEAD = .8;       // m que ese punto se adelanta hacia donde va
const DOOR_TIME = 1;        // s: si en esto no llegó a ese punto, sigue sin él
const CAR_ROUND = .5;       // m que deja al rodear su patrulla por una punta
const CAR_NEAR = 6;         // m de su patrulla: más lejos no hay nada que rodear
const STILL_SPEED = .3;     // m/s: más despacio, persiguiendo y sin tenerlo agarrado, está quieto contra algo
const STILL_TIME = .6;      // s así (lo que cuenta es lo que se alejó de donde estaba, no el temblor): paso de lado y rodea
const SIDESTEP = .45;       // s del paso de lado
const ROUND_HOLD = 1.2;     // s que sostiene la punta que escogió para rodearla
const ROUND_REST = 2.5;     // s sin insistir en rodear su patrulla por la punta, si ahí fue donde se quedó quieto
const SHOULDER = .3;        // m del centro del cuerpo al hombro: de cerca, lo que asoma detrás de un poste
const SHOULDER_SIGHT = 8;   // m: hasta ahí un poste o un tronco en medio no lo esconde

const _dir = new THREE.Vector3();
const _motion = {};
const _try = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _probe = new THREE.Vector3(); // solo para _underVehicle: _b y _c pueden ser el destino que se está siguiendo
const _corner = new THREE.Vector3();
const _was = new THREE.Vector3();
const _side = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _mark = new THREE.Vector3();
const _lead = new THREE.Vector3();

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const lerpAngle = (from, to, k) => from + wrap(to - from) * k;
const pick = (list, random) => list[Math.floor(random() * list.length) % list.length];

/** Uniforme de la Policía de cuadrante, sin insignias reales: chaleco verde limón, pantalón verde oliva, botas y gorra. */
export function policeLook(index = 0) {
  return {
    ...DEFAULT_LOOK,
    piel: 1 + (index * 3 + 1) % 4,
    desgaste: 0,
    accesorios: ['gorra'],
    real: {
      sexo: 'hombre', edad: 'adulto', pelo: 'rapado', barba: 'ninguna', ropa: 'chaqueta', calzado: 'botas', cabeza: 'sin-sombrero',
      tonos: { arriba: PATROL_COLORS.chaleco, abajo: PATROL_COLORS.uniforme, patron: 'liso', calzado: PATROL_COLORS.bota }
    }
  };
}

export class PoliceOfficer extends Npc {
  /**
   * @param {THREE.Scene} scene
   * @param {{ role?: 'conductor' | 'acompanante', index?: number, routes?: object, random?: () => number,
   *   isWalkable?: (x:number, z:number) => boolean, groundHeight?: (x:number, z:number, y?:number) => number }} opts
   */
  constructor(scene, { role = 'acompanante', index = 0, routes = null, random = Math.random, ...opts } = {}) {
    super(scene, new THREE.Vector3(0, -50, 0), { ...opts, speed: POLICE_FOOT.sprintSpeed, look: policeLook(index) });
    this.collisions = opts.collisions ?? null;
    this.getWaterInfo = opts.getWaterInfo ?? null;
    this.routes = routes;
    this.random = random;
    this.role = role;
    this.seatSide = role === 'conductor' ? -1 : 1;
    this.doorSide = this.seatSide;
    this.flank = 0;
    this.state = 'dentro';   // dentro | bajando | persecucion | busqueda | regreso | subiendo
    this.car = null;
    this.fit = null;
    this.timer = 0;
    this.sprintLeft = POLICE_FOOT.sprintTime;
    this.shoutTimer = 0;
    this.searchPhase = 'ir';
    this.searchTimer = 0;
    this.returnTimer = 0;
    this.armed = false;
    this.sees = false;
    this.distance = Infinity;
    this.runTime = 0;          // s corriendo en esta persecución: a los `exhaustAfter` ya no da más
    this.cannotReach = false;  // lo ve pero no le puede llegar: nadando, más arriba o trabado contra algo
    this.lastLine = null;
    this.onHit = null;
    this.canReplan = () => true; // PoliceFootSystem reparte las rutas nuevas: una por cuadro entre todos
    this.poseParams = {};
    this.root.visible = false;
    this._lastSpokenTime = Infinity; // nada de charla de peatón: solo lo suyo
    this._route = [];
    this._routeIndex = 0;
    this._routeTarget = new THREE.Vector3(Infinity, 0, Infinity);
    this._replan = 0;
    this._blocked = 0;
    this._slide = 1;
    this._still = 0;
    this._stillAt = new THREE.Vector3();
    this._sidestep = 0;
    this._roundRest = 0;
    this._roundHold = 0;
    this._exitPoint = new THREE.Vector3();
    this._exitClock = 0;
    this.groundSpeed = 0;
    this._anchor = new THREE.Vector3();
    this._anchorTimer = 0;
    this._stuckCount = 0;
    this._pause = 0;
    this._doorCheck = 0;
    this._benchFade = 0;
    this._lookTimer = 0;
    this._lookYaw = 0;
    this._seat = new THREE.Vector3();
    this._edge = new THREE.Vector3();
    this._door = new THREE.Vector3();
    this._seatYaw = 0;
    this._outYaw = 0;
    this._faceYaw = 0;
    this._stepFrom = new THREE.Vector3();
    this._exitTimes = EXIT;
    this._grab = null;         // el agarrón en curso: { phase: 'aviso' | 'zarpazo' | 'agarre', t, ... }
    this._stumble = 0;         // s que le quedan del traspié
    this._stumbleSpeed = 0;
    this._stumbleYaw = 0;
    this._pace = 0;            // m/s a los que corre ahora: acelera hasta el pique con `POLICE_GRAB.accel`
    this._pointClock = 0;      // s sin señalar
    this._nearClock = 0;       // s con él a distancia de avisarle
    this._misses = 0;          // zarpazos al aire seguidos
    this._missClock = 0;       // s desde el último
    this._seenAt = new THREE.Vector3(Infinity, 0, Infinity); // dónde iba el jugador el cuadro anterior
    this._seenVelocity = new THREE.Vector3();
    this._seenHeading = null;  // el rumbo del jugador el cuadro anterior, si iba andando
    this._seenSwept = 0;       // rad que lleva girados hacia un mismo lado sin enderezar
    this._seenTurning = 0;     // s que lleva girándolos
    this._seenStraight = 0;    // s que lleva sin girar
    this._gesture = 0;         // s que le quedan de desistir quieto (ver `_desisting`)
    this._gestureClock = 0;
    this._halt = 0;
    this._haltSpeed = 0;
    this._haltYaw = 0;
    this._breath = 0;
    this._heavy = 0;           // s que le quedan de caminar pesado
    this._radio = false;
    this._returnBest = Infinity;
    this._returnStall = 0;
    this._returnPlan = 0;
    this._avoidDoor = 0;
    this._cornerGoal = new THREE.Vector3();
    this.searchPoint = new THREE.Vector3();
  }

  get out() { return this.state !== 'dentro'; }

  /**
   * Afuera se anima aunque el jugador esté lejos: el LOD de los NPC congela la pose a más de `animStop` m y el agente que
   * vuelve a su carro, o que busca, se deslizaría quieto. Son pocos y solo mientras están afuera.
   */
  _measurePlayer(ctx) {
    super._measurePlayer(ctx);
    if (this.out) this._playerDist = Math.min(this._playerDist, NPC_LOD.animStop);
  }

  say(text, seconds) {
    this.lastLine = text;
    return super.say(text, seconds);
  }
  get onFoot() { return this.state === 'persecucion' || this.state === 'busqueda' || this.state === 'regreso'; }
  get searchDone() { return this.state === 'busqueda' && this.searchPhase === 'mirar' && this.searchTimer <= 0; }

  /** Con fichado 3 lleva la pistola en la mano derecha; cada modelo (lejano o cercano) la recibe al mostrarse. */
  setArmed(armed) {
    if (this.armed === !!armed) return;
    this.armed = !!armed;
    this.character?.setWeapon?.(this.armed ? 'pistola' : null);
  }

  _show(char) {
    char.setWeapon?.(this.armed ? 'pistola' : null);
    this._tintCap(char);
    super._show(char);
  }

  /** La gorra del catálogo es negra: la del uniforme va del verde del pantalón. Su material es de cada persona. */
  _tintCap(char) {
    if (!char?.group || char.group.userData.policeCap) return;
    char.group.traverse(object => {
      if (object.name !== 'prop-gorra') return;
      char.group.userData.policeCap = true;
      object.traverse(mesh => mesh.material?.color?.set(PATROL_COLORS.gorra));
    });
  }

  /** El personaje lo lleva PoliceFootSystem con `think`; el Npc base no camina. */
  _walk() {}

  // ---------- bajarse y subirse ----------

  /** Dónde va cada cosa ahora: el carro puede mecerse un poco mientras tanto. */
  _carPoints(side) {
    const fit = this.fit;
    fit.seatPoint(this.seatSide, this._seat);
    fit.edgePoint(side, 0, this._edge);
    fit.doorPoint(side, this._door);
    this._door.y = this.groundHeight(this._door.x, this._door.z, fit.car.group.position.y);
    this._edge.y = this._door.y;
    const yaw = fit.car.group.rotation.y;
    this._seatYaw = Math.atan2(Math.cos(yaw), -Math.sin(yaw));
    this._outYaw = Math.atan2(side * Math.sin(yaw), side * Math.cos(yaw));
  }

  /**
   * Empieza a bajarse por la puerta `side` de la patrulla `fit`, para salir hacia `face`. `seconds` es lo que dura todo:
   * en una persecución se bajan de afán (ver `exitSeconds`).
   */
  startExit(fit, side, face = null, seconds = EXIT_SECONDS) {
    this.fit = fit;
    this.car = fit.car;
    this.doorSide = side;
    this.state = 'bajando';
    this.timer = 0;
    this._exitTimes = exitTimes(seconds);
    this._carPoints(side);
    this._faceYaw = face ? Math.atan2(face.x - this._door.x, face.z - this._door.z) : this._outYaw;
    this.position.copy(this._seat);
    this.root.position.copy(this._seat);
    this.root.rotation.set(0, this._seatYaw, 0);
    this.root.visible = true;
    this.moving = false;
    this.poseParams = { poses: [['patrulla', 1]], look: this._lookAt(face) };
    // Arranca sentado de una vez: la postura de sentado no entra de a poco desde de pie.
    this.character?.snapPose?.();
    this._poseStale = true;
    this.health = this.maxHealth;
    this.distance = Math.hypot((face?.x ?? this._door.x) - this._door.x, (face?.z ?? this._door.z) - this._door.z);
    this.sprintLeft = POLICE_FOOT.sprintTime;
    this.runTime = 0;
    this._dropGrab();
    this._stumble = 0;
    this._misses = this._missClock = 0;
    this._pace = 0;
    this._pointClock = 0;
    this._nearClock = 0;
    this._seenAt.set(Infinity, 0, Infinity);
    this._gesture = this._heavy = 0;
    this.shoutTimer = .4 + this.random() * .8;
    this.returnTimer = 0;
    this._returnAfterExit = false;
    this._route = [];
    this._blocked = 0;
    this._still = this._sidestep = this._exitClock = this._roundRest = this._roundHold = 0;
  }

  /** Giro de la cabeza hacia `point` (lo que acepta el personaje en `look`). */
  _lookAt(point) {
    if (!point) return 0;
    const angle = wrap(Math.atan2(point.x - this.position.x, point.z - this.position.z) - this.root.rotation.y);
    return Math.max(-LOOK_MAX, Math.min(LOOK_MAX, angle));
  }

  _updateExit(dt, player = null) {
    this.timer += dt;
    this._carPoints(this.doorSide);
    const t = this.timer, e = this._exitTimes, m = exitMotion(t, e, this.doorSide, _motion);
    this.moving = false;
    // Desde el primer cuadro la cabeza va hacia el jugador; el cuerpo lo sigue al pararse.
    if (player) this._faceYaw = Math.atan2(player.x - this.position.x, player.z - this.position.z);
    if (m.phase === 'door' || m.phase === 'swing') {
      // La puerta se abre con él todavía sentado; después se desliza hasta el borde girando hacia afuera.
      this.position.lerpVectors(this._seat, this._edge, m.slide);
      this.position.y = this._seat.y + (this._edge.y - this._seat.y) * m.drop;
      this.root.rotation.y = lerpAngle(this._seatYaw, this._outYaw, m.yaw);
      this.poseParams = { poses: m.poses, look: this._lookAt(player) };
    } else if (m.phase === 'rise') {
      // Se para saliendo del marco. De afán, al desdoblarse ya queda echado hacia adelante para arrancar a correr.
      this.position.lerpVectors(this._edge, this._door, m.out);
      this.position.y += m.lift;
      this.root.rotation.y = lerpAngle(this._outYaw, this._faceYaw, m.turn);
      this.poseParams = { poses: m.poses, look: this._lookAt(player), style: m.stoop > 0 ? { stoop: m.stoop } : undefined };
      this._stepFrom.copy(this._door);
    } else if (m.phase === 'step') {
      // El primer paso, ya de pie, hacia donde va a correr: de afán es el arranque de la carrera, inclinado.
      const k = m.step;
      this.root.rotation.y = lerpAngle(this._outYaw, this._faceYaw, m.turn);
      const speed = e.urgent ? POLICE_FOOT.stepSpeed + (URGENT_STEP - POLICE_FOOT.stepSpeed) * k : POLICE_FOOT.stepSpeed;
      _dir.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
      // Hacia el jugador, pero nunca contra su carro: si queda del otro lado, el paso va a lo largo del costado.
      _b.set(this._door.x - this._seat.x, 0, this._door.z - this._seat.z).normalize();
      const inward = _dir.dot(_b);
      if (inward < 0) _dir.addScaledVector(_b, -inward).normalize();
      _try.copy(this.position).addScaledVector(_dir, speed * dt);
      this._resolve(this.position, _try, _try);
      this.moving = this.position.distanceToSquared(_try) > 1e-8;
      this.position.copy(_try);
      this.walkSpeed = speed;
      this.poseParams = { stanceWeight: 0, look: this._lookAt(player), style: e.urgent ? { stoop: .4, swing: 1.15 } : undefined };
    } else {
      // Si mientras se bajaba la patrulla desistió, de una vez vuelve a la puerta.
      this.state = this._returnAfterExit ? 'regreso' : 'persecucion';
      this._returnAfterExit = false;
      this._planExit(player);
      this._pace = e.urgent ? URGENT_STEP : POLICE_FOOT.stepSpeed;
      this._benchFade = BENCH_FADE;
      this.poseParams = { stanceWeight: 0 };
      return true;
    }
    return false;
  }

  /**
   * El primer punto ya de pie: a `DOOR_CLEAR` m del costado, adelantado hacia donde va. Sin él sale rozando la carrocería
   * y, con el jugador hacia una punta del carro, se queda deslizándose contra ella.
   */
  _planExit(player) {
    const car = this.fit?.car;
    this._exitClock = 0;
    if (!car || !player) return;
    const yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    const dx = this.position.x - car.position.x, dz = this.position.z - car.position.z;
    const along = dx * fx + dz * fz, across = dx * rx + dz * rz, side = Math.sign(across) || this.doorSide;
    const lateral = (car.width ?? 1.9) / 2 + DOOR_CLEAR;
    if (Math.abs(across) >= lateral - .15) return;
    const toward = (player.x - this.position.x) * fx + (player.z - this.position.z) * fz;
    const a = along + Math.max(-DOOR_LEAD, Math.min(DOOR_LEAD, toward));
    this._exitPoint.set(car.position.x + fx * a + rx * side * lateral, this.position.y, car.position.z + fz * a + rz * side * lateral);
    this._exitClock = DOOR_TIME;
  }

  /**
   * Junto a su patrulla, por dónde arranca hacia `goal`: el punto de `_planExit` mientras no se haya abierto de la puerta
   * y, si `goal` queda al otro lado del carro, la punta por donde el rodeo es más corto, a `CAR_ROUND` m. Escogida una
   * punta va hasta ella (si no, de un cuadro al otro cambiaría de idea) y desde ahí vuelve a trazar. Null si va derecho.
   */
  _leaveCar(goal, dt) {
    const car = this.fit?.car;
    if (!car) return null;
    if (this._roundRest > 0) { this._roundRest -= dt; this._exitClock = this._roundHold = 0; return null; }
    if (this._exitClock > 0) {
      this._exitClock -= dt;
      const point = this._exitPoint;
      const reached = Math.hypot(point.x - this.position.x, point.z - this.position.z) < .35;
      const blocked = !this.isWalkable(point.x, point.z) || !this._clearTo(point);
      if (reached || blocked) this._exitClock = 0;
      else return point;
    }
    if (this._roundHold > 0) {
      this._roundHold -= dt;
      const corner = this._cornerGoal;
      if (Math.hypot(corner.x - this.position.x, corner.z - this.position.z) > .05 && this._roundHold > 0) return corner;
      // En la punta: la ruta que traía salía de donde estaba antes.
      this._roundHold = 0;
      this._route = [];
      this._replan = 0;
    }
    if (Math.hypot(car.position.x - this.position.x, car.position.z - this.position.z) > CAR_NEAR + (car.length ?? 4.4) / 2) return null;
    const around = this._aroundCar(goal, CAR_ROUND + .1, CAR_ROUND - .1);
    if (around === goal) return null;
    this._roundHold = ROUND_HOLD;
    return around;
  }

  /** Empieza a subirse por la puerta por la que se bajó (que la patrulla ya abre). */
  startBoard() {
    this.state = 'subiendo';
    this.timer = 0;
    this.moving = false;
    this.poseParams = { stanceWeight: 0 };
  }

  _updateBoard(dt) {
    this.timer += dt;
    this._carPoints(this.doorSide);
    const t = this.timer, sitEnd = BOARD.door + BOARD.sit, swingEnd = sitEnd + BOARD.swing;
    this.moving = false;
    if (t < BOARD.door) {
      // Junto a la puerta mientras termina de abrir: se da la vuelta para sentarse de espaldas al asiento.
      this.position.lerp(this._door, Math.min(1, dt * 8));
      this.root.rotation.y = lerpAngle(this.root.rotation.y, this._outYaw, Math.min(1, dt * 9));
      this.poseParams = { stanceWeight: 0 };
    } else if (t < sitEnd) {
      // Se sienta en el borde, agachando tronco y cabeza: lo mismo que pararse, al revés.
      const m = seatRise(1 - (t - BOARD.door) / BOARD.sit, this.doorSide, _motion);
      this.position.lerpVectors(this._edge, this._door, m.out);
      this.position.y += m.lift;
      this.root.rotation.y = lerpAngle(this.root.rotation.y, this._outYaw, Math.min(1, dt * 12));
      this.poseParams = { poses: m.poses };
    } else if (t < swingEnd) {
      const m = seatSlide(1 - (t - sitEnd) / BOARD.swing, this.doorSide, _motion);
      this.position.lerpVectors(this._seat, this._edge, m.slide);
      this.position.y = this._seat.y + (this._edge.y - this._seat.y) * m.drop;
      this.root.rotation.y = lerpAngle(this._seatYaw, this._outYaw, m.yaw);
      this.poseParams = { poses: m.poses };
    } else {
      this.enterCar();
      return true;
    }
    return false;
  }

  /** Adentro: desaparece de la calle (la figura sentada de la patrulla lo reemplaza). */
  enterCar() {
    this.state = 'dentro';
    this.moving = false;
    this.poseParams = {};
    this._dropGrab();
    this.root.visible = false;
    this.position.set(0, -50, 0);
    this.root.position.copy(this.position);
    this._route = [];
    if (this._bubbleEl) { this._bubbleEl.remove(); this._bubbleEl = null; }
    this._bubbleTimer = 0;
  }

  // ---------- moverse ----------

  /**
   * Camina contra todo menos su propia patrulla, que va aparte con su forma girada: la caja de colisión de los carros va
   * alineada a los ejes y, con el carro orillado en diagonal, tapa la puerta por donde se baja y se sube.
   */
  _resolve(from, to, result) {
    const car = this.fit?.car, list = this.collisions?.dynamicColliders;
    const index = car && list ? list.findIndex(entry => entry.vehicle === car) : -1;
    const own = index >= 0 ? list.splice(index, 1)[0] : null;
    try {
      resolveCombatWalk({ from, to, groundHeight: this.groundHeight, isWalkable: this.isWalkable,
        getWaterInfo: this.getWaterInfo, collisions: this.collisions }, result);
    } finally {
      if (own) list.splice(index, 0, own);
    }
    if (car) this._outsideCar(car, from, result);
    return result;
  }

  /**
   * Si el paso lo mete en la carrocería de su patrulla, se desliza por el costado que venía tocando (sin avanzar más de lo
   * que pedía el paso); si ya estaba adentro, sale por el costado más cercano.
   */
  _outsideCar(car, from, point) {
    const yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    const local = (x, z) => [(x - car.position.x) * fx + (z - car.position.z) * fz, (x - car.position.x) * rx + (z - car.position.z) * rz];
    const [along, across] = local(point.x, point.z);
    const halfLength = (car.length ?? 4.4) / 2 + CAR_MARGIN, halfWidth = (car.width ?? 1.9) / 2 + CAR_MARGIN;
    const inLength = halfLength - Math.abs(along), inWidth = halfWidth - Math.abs(across);
    if (inLength <= 0 || inWidth <= 0) return point;
    const [fromAlong, fromAcross] = local(from.x, from.z);
    let a = along, c = across;
    if (Math.abs(fromAcross) >= halfWidth - 1e-6) c = Math.sign(fromAcross) * halfWidth;
    else if (Math.abs(fromAlong) >= halfLength - 1e-6) a = Math.sign(fromAlong) * halfLength;
    else if (inWidth <= inLength) c = Math.sign(across || 1) * halfWidth;
    else a = Math.sign(along || 1) * halfLength;
    point.x = car.position.x + a * fx + c * rx;
    point.z = car.position.z + a * fz + c * rz;
    return point;
  }

  /** ¿La línea de `from` a `to` cruza la carrocería de su patrulla (con `pad` m de margen)? */
  _crossesCar(from, to, pad = 0) {
    const car = this.fit?.car;
    if (!car) return false;
    const yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    const ax = from.x - car.position.x, az = from.z - car.position.z, bx = to.x - car.position.x, bz = to.z - car.position.z;
    const p0 = [ax * fx + az * fz, ax * rx + az * rz], p1 = [bx * fx + bz * fz, bx * rx + bz * rz];
    const half = [(car.length ?? 4.4) / 2 + pad, (car.width ?? 1.9) / 2 + pad];
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 2; i++) {
      const d = p1[i] - p0[i];
      if (Math.abs(d) < 1e-9) { if (Math.abs(p0[i]) >= half[i]) return false; continue; }
      let enter = (-half[i] - p0[i]) / d, leave = (half[i] - p0[i]) / d;
      if (enter > leave) [enter, leave] = [leave, enter];
      t0 = Math.max(t0, enter);
      t1 = Math.min(t1, leave);
      if (t0 >= t1) return false;
    }
    return true;
  }

  /**
   * Avanza hacia `goal` sin pasar de `stop` m. Contra una pared o un carro prueba de lado, y si no logra moverse se queda
   * quieto (nunca corre en el sitio). Devuelve los metros que avanzó.
   */
  _advance(goal, speed, dt, stop = 0) {
    _dir.set(goal.x - this.position.x, 0, goal.z - this.position.z);
    const distance = _dir.length();
    if (distance <= stop || dt <= 0) { this.moving = false; return 0; }
    _dir.multiplyScalar(1 / distance);
    const step = Math.min(distance - stop, speed * dt);
    _try.copy(this.position).addScaledVector(_dir, step);
    this._resolve(this.position, _try, _a);
    let moved = Math.hypot(_a.x - this.position.x, _a.z - this.position.z);
    if (moved < step * .35) {
      // Se desliza por el borde: primero hacia el lado que le sirvió la última vez.
      for (const turn of SLIDES) {
        const angle = turn * this._slide, cos = Math.cos(angle), sin = Math.sin(angle);
        _b.set(_dir.x * cos - _dir.z * sin, 0, _dir.x * sin + _dir.z * cos);
        _try.copy(this.position).addScaledVector(_b, step);
        this._resolve(this.position, _try, _c);
        const slid = Math.hypot(_c.x - this.position.x, _c.z - this.position.z);
        if (slid > step * .5) {
          _a.copy(_c);
          moved = slid;
          if (turn < 0) this._slide = -this._slide;
          break;
        }
      }
    }
    this._blocked = moved < step * .35 ? this._blocked + dt : Math.max(0, this._blocked - dt * 2);
    this.moving = moved > 1e-3;
    if (this.moving) {
      this._face(_a.x, _a.z, dt, 12);
      this.position.copy(_a);
    }
    // El paso de la animación sigue a lo que de verdad avanzó: frenado contra algo, no patina.
    this.walkSpeed = Math.max(.5, moved / dt);
    return moved;
  }

  _face(x, z, dt, rate = 10) {
    const diff = wrap(Math.atan2(x - this.position.x, z - this.position.z) - this.root.rotation.y);
    this.root.rotation.y += diff * Math.min(1, dt * rate);
  }

  /** Siguiente punto de la ruta por andenes hasta `target`; null si no hay ruta (va derecho). */
  _waypoint(target, dt, force = false) {
    this._replan -= dt;
    const moved = Math.hypot(target.x - this._routeTarget.x, target.z - this._routeTarget.z) > 2.5;
    // Buscar ruta es lo caro: si otro agente ya buscó en este cuadro, sigue con la que tiene y prueba en el próximo.
    if ((force || this._replan <= 0 || moved) && this.canReplan()) {
      const [min, max] = POLICE_FOOT.replan;
      // Hacia algo quieto (su puerta, el punto donde lo vio) la ruta sirve más tiempo.
      const still = Math.hypot(target.x - this._routeTarget.x, target.z - this._routeTarget.z) < .3;
      this._replan = still ? STILL_REPLAN : min + this.random() * (max - min);
      this._route = this.routes?.routeTo?.(this.position, target) ?? [];
      this._routeIndex = 0;
      this._routeTarget.copy(target);
      // La ruta sale del nodo más cercano, que puede quedar atrás: arranca por el que ya va de camino.
      while (this._routeIndex < this._route.length - 1) {
        const here = this._route[this._routeIndex], next = this._route[this._routeIndex + 1];
        const ahead = Math.hypot(next.x - this.position.x, next.z - this.position.z);
        if (ahead > Math.hypot(next.x - here.x, next.z - here.z) + .3) break;
        this._routeIndex++;
      }
    }
    while (this._routeIndex < this._route.length - 1) {
      const point = this._route[this._routeIndex];
      // Un nodo que quedó debajo de un carro detenido no se alcanza nunca: sigue con el próximo y lo rodea.
      if (Math.hypot(point.x - this.position.x, point.z - this.position.z) > .9 && !this._underVehicle(point)) break;
      this._routeIndex++;
    }
    return this._route[this._routeIndex] ?? null;
  }

  /** ¿El punto cae dentro de un carro (con el radio del agente)? La red de andenes no sabe de carros. */
  _underVehicle(point) {
    const car = this.fit?.car;
    for (const entry of this.collisions?.dynamicColliders ?? []) {
      if (!entry.vehicle || entry.obb) continue;
      if (entry.vehicle === car) {
        if (this._outsideCar(car, point, _probe.copy(point)).distanceToSquared(point) > 1e-6) return true;
        continue;
      }
      const box = entry.box;
      if (point.x > box.min.x - WALK_RADIUS && point.x < box.max.x + WALK_RADIUS
        && point.z > box.min.z - WALK_RADIUS && point.z < box.max.z + WALK_RADIUS) return true;
    }
    return false;
  }

  /** Va a `target`: derecho si lo ve y está cerca, si no por la red de andenes. */
  _goTo(target, speed, dt, stop, direct) {
    const far = Math.hypot(target.x - this.position.x, target.z - this.position.z);
    // Trabado: se queda quieto un momento (no corre en el sitio) y vuelve a probar por el otro lado.
    if (this._pause > 0) {
      this._pause -= dt;
      this.moving = false;
      if (this._pause <= 0) { this._slide = -this._slide; this._route = []; this._replan = 0; }
      return 0;
    }
    let goal = target;
    if (!direct) {
      const waypoint = this._waypoint(target, dt, this._blocked > 1);
      if (waypoint && far > 1.5) goal = waypoint;
    }
    // Persiguiendo, recién bajado se abre de la puerta, y lo que quede al otro lado de su patrulla (el jugador, o el
    // nodo por el que va la ruta) se alcanza por la punta, no contra el costado.
    if (this.state === 'persecucion') goal = this._leaveCar(goal, dt) ?? goal;
    const last = goal === target;
    const moved = this._advance(goal, speed, dt, last ? stop : 0);
    if (this._watch(dt, far > stop + .4) && this._stuckCount >= 2) { this._pause = .8; this._stuckCount = 0; this.moving = false; }
    return moved;
  }

  /**
   * Cada 1,5 s mira cuánto se movió de verdad. Ir y venir contra un carro o una esquina no es avanzar: cuenta como
   * trabado, pide otra ruta y, a la segunda, se detiene un momento. Devuelve true cuando lo encontró trabado.
   */
  _watch(dt, trying) {
    this._anchorTimer += dt;
    if (this._anchorTimer < 1.5) return false;
    const moved = Math.hypot(this.position.x - this._anchor.x, this.position.z - this._anchor.z);
    this._anchorTimer = 0;
    this._anchor.copy(this.position);
    if (trying && moved < .6) {
      this._stuckCount++;
      this._route = [];
      this._replan = 0;
      return true;
    }
    this._stuckCount = 0;
    return false;
  }

  _clearTo(point) {
    const car = this.fit?.car ?? null;
    return hasClearCombatLine({ from: this.position, to: point, collisions: this.collisions, ignoreVehicle: car })
      && !this._crossesCar(this.position, point);
  }

  /** ¿Está nadando? */
  _swimming(point) {
    const water = this.getWaterInfo?.(point.x, point.z);
    return !!water && (point.y ?? 0) <= water.surfaceY + .12;
  }

  /** ¿El próximo paso hacia `point` es agua honda (o no se camina)? */
  _wetAhead(point) {
    const dx = point.x - this.position.x, dz = point.z - this.position.z, length = Math.hypot(dx, dz);
    if (length < 1e-3) return true;
    const x = this.position.x + dx / length * .9, z = this.position.z + dz / length * .9;
    const water = this.getWaterInfo?.(x, z);
    return !this.isWalkable(x, z) || (!!water && this.groundHeight(x, z, this.position.y) <= water.surfaceY + .12);
  }

  /**
   * Lo ve si está a su alcance y nada se atraviesa; bajándose ya mira hacia afuera. De cerca, algo angosto en medio (un
   * poste, un tronco) no lo esconde: le asoma un hombro por un lado. Un carro sí lo tapa, como siempre: de la punta de su
   * patrulla no saca la cuenta de que ya lo ve y se le echa derecho contra la carrocería.
   */
  canSee(player) {
    if (!player || !(this.onFoot || this.state === 'bajando')) return false;
    const dx = player.x - this.position.x, dz = player.z - this.position.z, distance = Math.hypot(dx, dz);
    if (distance > POLICE_FOOT.sight || Math.abs((player.y ?? 0) - this.position.y) >= 4) return false;
    if (this._clearTo(player)) return true;
    if (distance > SHOULDER_SIGHT || distance < 1e-3) return false;
    const car = this.fit?.car ?? null, vehicles = this.collisions?.dynamicColliders;
    if (this._crossesCar(this.position, player)
      || (vehicles?.length && !hasClearCombatLine({ from: this.position, to: player, collisions: { dynamicColliders: vehicles }, ignoreVehicle: car }))) return false;
    const sx = -dz / distance * SHOULDER, sz = dx / distance * SHOULDER;
    for (const side of [1, -1]) {
      _eye.set(this.position.x + sx * side, this.position.y, this.position.z + sz * side);
      _mark.set(player.x + sx * side, player.y ?? this.position.y, player.z + sz * side);
      if (hasClearCombatLine({ from: _eye, to: _mark, collisions: this.collisions, ignoreVehicle: car }) && !this._crossesCar(_eye, _mark)) return true;
    }
    return false;
  }

  _shout(dt, list) {
    this.shoutTimer -= dt;
    if (this.shoutTimer > 0) return null;
    const [min, max] = POLICE_FOOT.shoutEvery;
    this.shoutTimer = min + this.random() * (max - min);
    const line = pick(list, this.random);
    this.say(line, 2.4);
    return line;
  }

  // ---------- lo que hace cada cuadro ----------

  /**
   * Decide y mueve. Devuelve 'fuera' (terminó de bajarse), 'arresto', 'adentro' (ya subió) o null.
   * @param {number} dt
   * @param {{ player: THREE.Vector3, target: THREE.Vector3, sees: boolean, lastSeen: THREE.Vector3, unseen: number,
   *   inView?: (point: THREE.Vector3) => boolean }} ctx
   */
  think(dt, ctx) {
    _was.copy(this.position);
    const event = this._think(dt, ctx);
    // Lo que de verdad avanzó, para saber si está quieto contra algo.
    this.groundSpeed = dt > 0 ? Math.hypot(this.position.x - _was.x, this.position.z - _was.z) / dt : 0;
    return event;
  }

  /** Su patrulla lo tenía atajado: vuelve a trazar el camino desde donde está. */
  giveWay() {
    this._route = [];
    this._replan = 0;
    this._pause = 0;
    this._still = 0;
    this._roundRest = 0;
  }

  _think(dt, ctx) {
    if (dt <= 0 || this.state === 'dentro') { this.moving = false; return null; }
    if (this._benchFade > 0) this._benchFade = Math.max(0, this._benchFade - dt);
    if (this.state === 'bajando') return this._updateExit(dt, ctx.player) ? 'fuera' : null;
    if (this.state === 'subiendo') return this._updateBoard(dt) ? 'adentro' : null;
    this.poseParams = { stanceWeight: this._benchFade > 0 ? 0 : 1 };
    // Golpeado: aguanta el sacudón y sigue; mientras dura no avanza ni agarra a nadie.
    if (this._hitReactionRemaining > 0 || this.staggerTimer > 0) { this.moving = false; return null; }
    if (this.state === 'persecucion') return this._chase(dt, ctx);
    if (this.state === 'busqueda') return this._search(dt, ctx);
    return this._return(dt, ctx);
  }

  _chase(dt, { player, target, sees, lastSeen, unseen }) {
    this.sees = sees;
    const goal = sees ? target : lastSeen;
    this.distance = Math.hypot(player.x - this.position.x, player.z - this.position.z);
    this._readMotion(target, dt);
    // Los zarpazos al aire se le olvidan si el jugador de verdad se le fue lejos, o si pasa un rato sin echarle otro: el
    // que se zafa y huye no paga por los quiebres buenos.
    if (this._misses > 0) {
      this._missClock += dt;
      if (this.distance > POLICE_GRAB.sureFar || this._missClock >= POLICE_GRAB.sureForget) this._misses = 0;
    }
    // El agarrón en curso manda: aviso, zarpazo y agarre.
    if (this._grab) return this._grabbing(dt, player, target, sees);
    const toGoal = Math.hypot(goal.x - this.position.x, goal.z - this.position.z);
    if (!sees && (unseen >= POLICE_FOOT.lostTime || toGoal < 1.5)) {
      this.startSearch(lastSeen);
      return null;
    }
    const exhausted = this.runTime >= POLICE_FOOT.exhaustAfter;
    const top = this.sprintLeft > 0 ? POLICE_FOOT.sprintSpeed : exhausted ? POLICE_FOOT.exhaustedSpeed : POLICE_FOOT.tiredSpeed;
    // Acelera hasta su marcha: de quieto al pique en ~0,6 s.
    this._pace = Math.min(top, this._pace + POLICE_GRAB.accel * dt);
    // Se le zafó: sigue de largo por el rumbo del zarpazo, frenando y con el brazo barriendo; después da unos pasos de
    // traspié con la cabeza caída y se recompone, ya acelerando otra vez.
    let stumbled = null;
    if (this._stumble > 0) {
      const since = POLICE_GRAB.stumble - this._stumble;
      this._stumble = Math.max(0, this._stumble - dt);
      if (since < STUMBLE_SWEEP) { this.poseParams.stance = 'traspie'; this.poseParams.stanceWeight = 1; }
      else stumbled = since < STUMBLE_SWEEP + STUMBLE_STEPS ? STUMBLE_STYLE : RECOVER_STYLE;
      // Pierde la marcha en un par de pasos y no la retoma hasta recomponerse.
      const k = Math.min(1, (since + dt) / POLICE_GRAB.stumbleLow);
      this._pace = this._stumbleSpeed + (POLICE_GRAB.stumbleSpeed - this._stumbleSpeed) * k;
      if (since < POLICE_GRAB.stumbleCarry) {
        this.poseParams.style = stumbled ?? undefined;
        this.poseParams.point = 0;
        this._pointClock += dt;
        this._carryOn(dt, this._pace, this._stumbleYaw);
        this.runTime += dt;
        return null;
      }
    }
    this.poseParams.style = stumbled ?? (exhausted ? EXHAUSTED_STYLE : this.sprintLeft > 0 ? undefined : TIRED_STYLE);
    // Lo ve pero no le llega: nadando, más arriba (un techo, un puente) o trabado contra algo.
    const swimming = sees && this._swimming(target);
    this.cannotReach = sees && (swimming || Math.abs((target.y ?? 0) - this.position.y) > 1.5 || this._blocked > 1);
    if (swimming && this._wetAhead(target)) {
      // En la orilla: no se mete al agua ni va y viene por el borde. Lo mira y le grita.
      this.moving = false;
      this._pace = 0;
      this._face(player.x, player.z, dt, 8);
      this.poseParams.point = 1;
      this._pointClock = 0;
      this._shout(dt, this.armed ? POLICE_ARMED_SHOUTS : POLICE_SHOUTS);
      return null;
    }
    let aim = goal;
    // El segundo no corre detrás del primero: abre por un lado y le cierra el paso; ya encima, llega por ese lado.
    if (this.flank && sees && toGoal > 1) {
      const off = Math.max(.8, Math.min(4, toGoal * .4)) * this.flank;
      _c.set(goal.x - this.position.x, 0, goal.z - this.position.z).multiplyScalar(1 / toGoal);
      _b.set(goal.x - _c.z * off, goal.y, goal.z + _c.x * off);
      if (this.isWalkable(_b.x, _b.z)) aim = _b;
    }
    const direct = sees && toGoal < POLICE_FOOT.directRange;
    const stop = sees ? .75 : .5;
    // De cerca y viéndolo no corre a la cola: va adonde él va a estar cuando llegue. Al que da vueltas le corta el camino
    // en vez de quedarse girando por dentro, y al que sigue derecho lo persigue igual que antes.
    if (direct && POLICE_GRAB.lead > 0 && !(this._sidestep > 0)) {
      const v = this._seenVelocity;
      if (Math.hypot(v.x, v.z) > 1) {
        const t = Math.min(POLICE_GRAB.lead, toGoal / Math.max(this._pace, 1));
        _lead.set(aim.x + v.x * t, aim.y, aim.z + v.z * t);
        if (this.isWalkable(_lead.x, _lead.z)) aim = _lead;
      }
    }
    let moved;
    if (this._sidestep > 0) {
      // El paso de lado: en diagonal hacia el lado por donde le toca rodear.
      this._sidestep -= dt;
      _side.set(aim.x - this.position.x, 0, aim.z - this.position.z).normalize();
      _side.set(this.position.x + (_side.x * .4 - _side.z * this._slide) * 2, this.position.y, this.position.z + (_side.z * .4 + _side.x * this._slide) * 2);
      moved = this._advance(_side, this._pace, dt);
      if (moved < this._pace * dt * .35) this._slide = -this._slide;
    } else moved = this._goTo(aim, this._pace, dt, stop, direct);
    // Quieto contra algo sin tenerlo agarrado: no se queda ahí. Paso de lado, y otra ruta.
    const trying = toGoal > stop + .4 && !(this._pause > 0);
    if (!trying || Math.hypot(this.position.x - this._stillAt.x, this.position.z - this._stillAt.z) > STILL_SPEED * STILL_TIME) {
      this._still = 0;
      this._stillAt.copy(this.position);
    } else this._still += dt;
    if (this._still >= STILL_TIME) {
      this._still = 0;
      this._stillAt.copy(this.position);
      this._sidestep = SIDESTEP;
      this._roundRest = ROUND_REST;
      this._roundHold = 0;
      this._slide = -this._slide;
      this._route = [];
      this._replan = 0;
    }
    if (moved > 0) {
      this.runTime += dt;
      if (this.sprintLeft > 0) this.sprintLeft = Math.max(0, this.sprintLeft - dt);
    }
    if (sees && this.distance < 2.5) this._face(player.x, player.z, dt, 12);
    // Cerca: señala (con la pistola en la otra mano si viene armado) y grita. Ya encima baja el brazo, que lo necesita
    // libre para agarrarlo; recomponiéndose del traspié, también abajo.
    const warn = sees && this.distance <= (this.armed ? POLICE_FOOT.armedRange : POLICE_FOOT.warnRange);
    this.poseParams.point = warn && this.distance > POLICE_GRAB.pointOff && !(this._stumble > 0) ? 1 : 0;
    this._pointClock = this.poseParams.point ? 0 : this._pointClock + dt;
    if (warn || (sees && this.distance < 14)) this._shout(dt, this.armed ? POLICE_ARMED_SHOUTS : POLICE_SHOUTS);
    // Ya encima, con la línea limpia y el brazo de señalar abajo del todo: avisa. Lo agarra donde está, o en la puerta
    // del carro en que va.
    const near = Math.hypot(target.x - this.position.x, target.z - this.position.z);
    this._nearClock = sees && near <= POLICE_GRAB.warn ? this._nearClock + dt : 0;
    // Encarrilado: hacia donde va a estar él al final del zarpazo no tiene que girar más de lo que el aviso deja.
    const v = this._seenVelocity, ahead = POLICE_GRAB.warnTime + POLICE_GRAB.lunge;
    const off = wrap(Math.atan2(target.x + v.x * ahead - this.position.x, target.z + v.z * ahead - this.position.z) - this.root.rotation.y);
    const ready = sees && !(this._stumble > 0) && near <= POLICE_GRAB.warn && this._pointClock >= POLICE_GRAB.pointClear
      && (Math.abs(off) <= POLICE_GRAB.warnAim || this._nearClock >= POLICE_GRAB.warnWait);
    const clear = ready && canReachCombatTarget({ from: this.position, to: target, maxDistance: POLICE_GRAB.warn,
      collisions: this.collisions, getWaterInfo: this.getWaterInfo });
    if (ready && !clear && this._nearClock >= POLICE_GRAB.warnWait && !(this._sidestep > 0)) {
      // Lo tiene encima pero con algo en medio (un poste, una caneca): no se queda mirándolo. Paso de lado, y por ahí.
      this._sidestep = SIDESTEP * .5;
      this._slide = -this._slide;
      this._nearClock = 0;
    }
    if (clear) {
      // Al que ya se le zafó `sure` veces seguidas no lo vuelve a dejar de lado: se le tira encima y lo sigue con el cuerpo.
      // Y al que viene dando vueltas tampoco le regala el primero: girando sin parar el zarpazo derecho cae siempre al aire.
      const sure = this._misses >= POLICE_GRAB.sure
        || (Math.abs(this._seenSwept) >= POLICE_GRAB.sureSwept && this._seenTurning >= POLICE_GRAB.sureSweptTime);
      this._grab = { phase: 'aviso', t: 0, yaw: 0, speed: 0, run: 0, fromX: 0, fromZ: 0, sure };
      this.say(sure ? POLICE_GRAB_LINES.encima : POLICE_GRAB_LINES.aviso, 1.6);
      this.shoutTimer = Math.max(this.shoutTimer, 1.6);
      return this._grabbing(0, player, target, sees) ?? (sure ? 'encima' : 'aviso');
    }
    return null;
  }

  /**
   * El agarrón, ya empezado. El aviso: se echa adelante con la mano estirada, llega a `gap` m al paso de él y gira poco,
   * hacia donde va a estar si sigue igual. El zarpazo: un paso largo por ese rumbo que se resuelve una sola vez al final.
   * El agarre: la mano en el hombro, frenando los dos, y el arresto. Devuelve 'aviso', 'agarre', 'zafo', 'arresto' o null.
   */
  _grabbing(dt, player, target, sees) {
    const g = this._grab, G = POLICE_GRAB;
    g.t += dt;
    this.poseParams.point = 0;
    this.poseParams.style = undefined;
    this.poseParams.look = this._lookAt(player);
    this._pointClock += dt;
    if (g.phase === 'aviso') {
      // Lo perdió de vista, se le subió a algo o se le fue lejos: no se echa a ciegas.
      if (!sees || Math.abs((target.y ?? 0) - this.position.y) > 1.5
        || Math.hypot(target.x - this.position.x, target.z - this.position.z) > G.warnFar) { this._dropGrab(); return null; }
      const left = Math.max(0, G.warnTime - g.t), v = this._seenVelocity;
      const ahead = left + G.lunge;
      const want = Math.atan2(target.x + v.x * ahead - this.position.x, target.z + v.z * ahead - this.position.z);
      const most = (g.sure ? G.sureTurn : G.warnTurn) * dt;
      const yaw = this.root.rotation.y + Math.max(-most, Math.min(most, wrap(want - this.root.rotation.y)));
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const along = (target.x - this.position.x) * fx + (target.z - this.position.z) * fz, pace = v.x * fx + v.z * fz;
      const top = this.sprintLeft > 0 ? POLICE_FOOT.sprintSpeed : POLICE_FOOT.tiredSpeed;
      this.root.rotation.y = yaw;
      if (dt > 0) {
        this._pace = Math.max(0, Math.min(top, this._pace + G.accel * dt, pace + (along - G.gap) / Math.max(dt, left)));
        this._carryOn(dt, this._pace, yaw);
      }
      this.poseParams.stance = g.sure ? 'embestida' : 'aviso';
      this.poseParams.stanceWeight = 1;
      if (g.t < G.warnTime) return g.t === 0 ? (g.sure ? 'encima' : 'aviso') : null;
      // El zarpazo: lo justo para que al que sigue derecho le alcance el brazo.
      const reach = (target.x - this.position.x) * fx + (target.z - this.position.z) * fz + pace * G.lunge - G.hand;
      g.phase = 'zarpazo';
      g.t = 0;
      g.yaw = yaw;
      g.fromX = this.position.x;
      g.fromZ = this.position.z;
      g.speed = Math.max(0, Math.min(G.lungeMax, reach)) / G.lunge;
      g.run = this._pace;
      this.poseParams.stance = g.sure ? 'embestida' : 'zarpazo';
      return null;
    }
    if (g.phase === 'zarpazo') {
      // Ya echado tuerce apenas hacia él. El último cuadro avanza solo lo que le queda del zarpazo.
      const most = (g.sure ? G.sureTurn : G.lungeTurn) * dt;
      g.yaw += Math.max(-most, Math.min(most, wrap(Math.atan2(target.x - this.position.x, target.z - this.position.z) - g.yaw)));
      this._carryOn(dt, g.speed * Math.min(dt, Math.max(0, G.lunge - (g.t - dt))) / Math.max(dt, 1e-6), g.yaw);
      this.walkSpeed = Math.max(this.walkSpeed, g.run);
      this.poseParams.stance = g.sure ? 'embestida' : 'zarpazo';
      this.poseParams.stanceWeight = 1;
      if (g.t < G.lunge - 1e-6) return null;
      // Se resuelve una sola vez: a su alcance y por delante de donde se echó. Saltar no lo salva.
      const dx = target.x - this.position.x, dz = target.z - this.position.z, distance = Math.hypot(dx, dz);
      const bearing = Math.atan2(target.x - g.fromX, target.z - g.fromZ);
      const hit = distance <= G.reach && (g.sure || Math.abs(wrap(bearing - g.yaw)) <= G.cone)
        && canReachCombatTarget({ from: this.position, to: target, maxDistance: G.reach,
          collisions: this.collisions, getWaterInfo: this.getWaterInfo });
      if (hit) {
        g.phase = 'agarre';
        g.t = 0;
        this._misses = 0;
        g.hx = distance > 1e-3 ? dx / distance : Math.sin(g.yaw);
        g.hz = distance > 1e-3 ? dz / distance : Math.cos(g.yaw);
        this.poseParams.stance = 'agarre';
        return 'agarre';
      }
      // Se le zafó: el traspié le cuesta metros y pique.
      this._grab = null;
      this._misses++;
      this._missClock = 0;
      this.say(POLICE_GRAB_LINES.traspie, G.stumble);
      this._stumble = G.stumble;
      this._stumbleSpeed = Math.max(g.run, G.stumbleSpeed);
      this._stumbleYaw = g.yaw;
      this._pace = this._stumbleSpeed;
      this.sprintLeft = Math.max(0, this.sprintLeft - G.stumbleSprint);
      this.poseParams.stance = 'traspie';
      return 'zafo';
    }
    // El agarre: la mano en el hombro y frenan los dos (al jugador lo frena el juego); después, el arresto.
    const k = Math.min(1, g.t / G.hold);
    this.poseParams.stance = 'agarre';
    this.poseParams.stanceWeight = 1;
    const dx = target.x - this.position.x, dz = target.z - this.position.z, distance = Math.hypot(dx, dz);
    if (distance > 1e-3) { g.hx = dx / distance; g.hz = dz / distance; }
    // Pegado a él, a `holdGap` m.
    const pull = (distance - G.holdGap) * Math.min(1, dt * 12);
    _try.set(this.position.x + g.hx * pull, this.position.y, this.position.z + g.hz * pull);
    this._resolve(this.position, _try, _a);
    this.position.copy(_a);
    this.root.rotation.y = Math.atan2(g.hx, g.hz);
    this.walkSpeed = g.run * (1 - smooth(k));
    this.moving = this.walkSpeed > .3;
    if (g.t < G.hold) return null;
    this._dropGrab();
    return 'arresto';
  }

  /** Lo que va moviéndose el jugador (o la puerta del carro en que va), de un cuadro al otro. */
  _readMotion(target, dt) {
    if (Number.isFinite(this._seenAt.x) && dt > 0) {
      const vx = (target.x - this._seenAt.x) / dt, vz = (target.z - this._seenAt.z) / dt;
      // Un salto de sitio (se subió a un carro, se le perdió) no es moverse.
      if (Math.hypot(vx, vz) < 15) this._seenVelocity.set(vx, 0, vz);
      else this._seenVelocity.set(0, 0, 0);
      // Lo que trae girado hacia un mismo lado: un quiebre suelto no llega lejos; el que da vueltas, sea de corrido o a
      // golpes de tecla, sí. Se le olvida al cambiar de lado, o tras un rato derecho o quieto.
      const v = this._seenVelocity, heading = Math.hypot(v.x, v.z) > 2 ? Math.atan2(v.z, v.x) : null;
      const step = heading !== null && this._seenHeading !== null ? wrap(heading - this._seenHeading) : 0;
      if (Math.abs(step) > POLICE_GRAB.sweptTurn * dt) {
        if (step * this._seenSwept < 0) this._seenSwept = this._seenTurning = 0;
        this._seenSwept += step;
        this._seenTurning += dt;
        this._seenStraight = 0;
      } else if ((this._seenStraight += dt) >= POLICE_GRAB.sweptRest) this._seenSwept = this._seenTurning = 0;
      this._seenHeading = heading;
    }
    this._seenAt.copy(target);
  }

  /** Avanza `speed` m/s por el rumbo `yaw` (contra lo que haya), mirando hacia allá. Devuelve los metros. */
  _carryOn(dt, speed, yaw) {
    this.root.rotation.y = yaw;
    _try.set(this.position.x + Math.sin(yaw) * speed * dt, this.position.y, this.position.z + Math.cos(yaw) * speed * dt);
    this._resolve(this.position, _try, _a);
    const moved = Math.hypot(_a.x - this.position.x, _a.z - this.position.z);
    this.position.copy(_a);
    this.moving = moved > 1e-3;
    this.walkSpeed = Math.max(.5, moved / Math.max(dt, 1e-6));
    return moved;
  }

  /** ¿Va en mitad de un agarrón (avisando, echado o con la mano en el hombro)? */
  get grabbing() {
    return !!this._grab;
  }

  /** Suelta el agarrón en curso (golpeado, lo perdió de vista, se subió al carro...). */
  _dropGrab() {
    this._grab = null;
  }

  /** Va al último punto donde lo vio y mira alrededor. */
  startSearch(point) {
    this.state = 'busqueda';
    this.searchPhase = 'ir';
    this.searchPoint.copy(point);
    const [min, max] = POLICE_FOOT.searchTime;
    this.searchTimer = min + this.random() * (max - min);
    this._dropGrab();
    this._lookTimer = 0;
    this._route = [];
    this.poseParams.point = 0;
  }

  /** Lo volvió a ver: sigue corriendo. */
  resumeChase() {
    if (this.state !== 'busqueda' && this.state !== 'regreso') return;
    this.state = 'persecucion';
    this._route = [];
    this._gesture = this._heavy = 0;
    this._pace = this.moving ? Math.min(this.walkSpeed ?? 0, POLICE_FOOT.searchSpeed) : 0;
    this.poseParams.stance = undefined;
    this.poseParams.stanceWeight = 0;
  }

  _search(dt, { player, sees }) {
    this.distance = Math.hypot(player.x - this.position.x, player.z - this.position.z);
    this.sprintLeft = Math.min(POLICE_FOOT.sprintTime, this.sprintLeft + POLICE_FOOT.recover * dt);
    if (this.searchPhase === 'ir') {
      const left = Math.hypot(this.searchPoint.x - this.position.x, this.searchPoint.z - this.position.z);
      this._goTo(this.searchPoint, POLICE_FOOT.searchSpeed, dt, .6, left < POLICE_FOOT.directRange && this._clearTo(this.searchPoint));
      if (left < 1.2 || this._blocked > 2) {
        this.searchPhase = 'mirar';
        this._lookYaw = this.root.rotation.y;
        this.moving = false;
        if (this.random() < .6) this.say(pick(SEARCH_LINES, this.random), 2.6);
      }
      return null;
    }
    // Mira para un lado y para el otro, sin moverse del sitio.
    this.moving = false;
    this.searchTimer -= dt;
    this._lookTimer -= dt;
    if (this._lookTimer <= 0) {
      this._lookTimer = 1.1 + this.random() * .8;
      this._lookYaw = this.root.rotation.y + (this.random() < .5 ? -1 : 1) * (.9 + this.random() * .9);
    }
    this.root.rotation.y = lerpAngle(this.root.rotation.y, this._lookYaw, Math.min(1, dt * 3));
    return null;
  }

  /** Desiste: camina de vuelta a la patrulla. Con `reason` dice por qué (ver `GIVE_UP_LINES`). */
  startReturn(reason = null) {
    if (this.state === 'dentro' || this.state === 'subiendo') return;
    if (this.state === 'bajando') { this._returnAfterExit = true; return; }
    this.state = 'regreso';
    this.returnTimer = 0;
    this._dropGrab();
    this._route = [];
    this._blocked = 0;
    this._doorCheck = 0;
    this._anchorTimer = 0;
    this._anchor.copy(this.position);
    this._returnBest = Infinity;
    this._returnStall = 0;
    this._returnPlan = 0;
    this._avoidDoor = 0;
    this.poseParams.point = 0;
    this.poseParams.style = undefined;
    // El que corría frena en dos pasos, coge aire con las manos en los muslos y (el que avisa) habla por el radio de la
    // solapa antes de devolverse, caminando pesado.
    const winded = this.runTime > 3 || this.sprintLeft < POLICE_FOOT.sprintTime;
    const [least, most] = POLICE_FOOT.breather;
    this._radio = !!reason;
    this._halt = winded && this.moving ? POLICE_FOOT.halt : 0;
    this._haltSpeed = Math.max(1, this.walkSpeed ?? 0);
    this._haltYaw = this.root.rotation.y;
    this._breath = winded || reason ? least + this.random() * (most - least) : 0;
    this._gesture = this._halt + this._breath + (reason ? POLICE_FOOT.radio : 0);
    this._gestureClock = 0;
    this._heavy = winded ? POLICE_FOOT.heavy : 0;
    if (reason) this.say(pick(GIVE_UP_LINES[reason] ?? GIVE_UP_LINES.perdido, this.random), 2.6);
  }

  /**
   * De vuelta a la patrulla, por la puerta más cercana a la que se pueda llegar. Si en `returnStall` s no se acerca,
   * cambia de plan: la otra puerta, otra ruta y por último pide que el carro lo recoja ('recoger'). Nadie se sube a un
   * carro andando (`carStill`), y a los `returnCap` s se sube de una aunque lo vean.
   */
  _return(dt, { inView = () => false, doorBusy = () => false, doorOk = () => true, carStill = true, hurry = false, lastSeen = null }) {
    this.returnTimer += dt;
    this.sprintLeft = Math.min(POLICE_FOOT.sprintTime, this.sprintLeft + POLICE_FOOT.recover * dt);
    this.runTime = Math.max(0, this.runTime - dt * .5);
    this._chooseDoor(dt, doorOk);
    this._carPoints(this.doorSide);
    const door = this._door;
    const left = Math.hypot(door.x - this.position.x, door.z - this.position.z);
    // Si la ruta no lo trae, o quedó muy lejos, se sube de una donde nadie lo vea; pasado el tope, aunque lo vean.
    const late = this.returnTimer > POLICE_FOOT.returnTimeout || left > POLICE_FOOT.farFromCar;
    if ((late && !inView(this.position) && !inView(door)) || this.returnTimer > POLICE_FOOT.returnCap) {
      this.enterCar();
      return 'adentro';
    }
    // Con el bus esperando detrás de su patrulla, o un carro retenido, no se demora: ni coge aire, ni avisa quieto, ni
    // camina pesado.
    if (hurry && (this._gesture > 0 || this._heavy > 0)) {
      this._gesture = this._heavy = 0;
      this.poseParams.stance = this.poseParams.style = undefined;
      this.poseParams.stanceWeight = 0;
    }
    // Recién desistió: frena, coge aire y avisa por radio antes de echar a andar.
    if (this._gesture > 0 && this._desisting(dt, lastSeen)) return null;
    if (this._heavy > 0) this.poseParams.style = HEAVY_STYLE;
    // El carro se está moviendo (lo vienen a recoger, o se corre de un carril): lo espera quieto, mirándolo.
    if (!carStill) {
      this.moving = false;
      this._face(this.fit.car.position.x, this.fit.car.position.z, dt, 6);
      return null;
    }
    // Su compañero se está subiendo por esa misma puerta: espera a un lado.
    if (left < 1.6 && doorBusy(this.doorSide)) { this.moving = false; this._face(door.x, door.z, dt, 6); return null; }
    if (left <= .35) { this.startBoard(); return null; }
    // La puerta del otro lado: le da la vuelta al carro por la esquina que le quede más corta.
    const goal = this._aroundCar(door);
    // A la esquina va derecho solo si nada se atraviesa: con un carro parado detrás de la patrulla, derecho se queda pegado
    // contra él; la ruta por el andén lo rodea.
    const near = goal !== door ? this._clearTo(goal) : left < POLICE_FOOT.directRange && this._clearTo(door);
    const pace = hurry ? POLICE_FOOT.hurrySpeed : POLICE_FOOT.walkSpeed * (this._heavy > 0 ? HEAVY_PACE : 1);
    if (this._goTo(goal, left < 2 ? Math.min(1.4, pace) : pace, dt, 0, near) > 0 && this._heavy > 0) this._heavy = Math.max(0, this._heavy - dt);
    // Trabado cerca del carro: prueba por la otra puerta y no vuelve a esta.
    if (this._stuckCount && left < 6 && this._canUse(-this.doorSide, doorOk)) { this._leaveDoor(); this._stuckCount = 0; }
    // ¿Se está acercando? Si no, cambia de plan.
    if (left < this._returnBest - .5) { this._returnBest = left; this._returnStall = 0; return null; }
    this._returnStall += dt;
    if (this._returnStall < POLICE_FOOT.returnStall) return null;
    this._returnStall = 0;
    this._returnBest = Infinity;
    this._returnPlan++;
    if (this._returnPlan === 1 && this._canUse(-this.doorSide, doorOk)) { this._leaveDoor(); return null; }
    if (this._returnPlan <= 2) { this._route = []; this._replan = 0; this._slide = -this._slide; this._pause = 0; return null; }
    return 'recoger';
  }

  /**
   * Los tiempos de desistir, uno tras otro (ver `startReturn`): frena (`halt`) dando dos pasos cortos con el tronco
   * adelante y los brazos caídos; sin aire (`_breath`) con las manos en los muslos, la cabeza colgando y a la mitad
   * levantándola a mirar por dónde se fue; y el que avisa, al radio de la solapa, enderezándose con un último resuello y
   * mirando hacia allá. Devuelve true mientras dura.
   */
  _desisting(dt, lastSeen) {
    const at = this._gestureClock;
    this._gestureClock += dt;
    this._gesture = Math.max(0, this._gesture - dt);
    if (this._gesture <= 0) {
      this.poseParams.stance = this.poseParams.style = undefined;
      this.poseParams.stanceWeight = 0;
      return false;
    }
    if (at < this._halt) {
      const left = 1 - at / this._halt, yaw = this._haltYaw;
      _try.set(this.position.x + Math.sin(yaw) * 2, this.position.y, this.position.z + Math.cos(yaw) * 2);
      this._advance(_try, Math.max(.6, this._haltSpeed * left * .6), dt);
      this.poseParams.style = HALT_STYLE;
      return true;
    }
    this.moving = false;
    const breath = at - this._halt;
    if (breath < this._breath) {
      const lift = breath > this._breath / 2;
      this.poseParams.stance = 'sin-aire';
      this.poseParams.stanceWeight = 1;
      this.poseParams.style = lift ? LIFT_STYLE : HANG_STYLE;
      if (lift && lastSeen) this.poseParams.look = this._lookAt(lastSeen) * .7;
      return true;
    }
    const radio = breath - this._breath;
    this.poseParams.stance = 'radio-solapa';
    this.poseParams.stanceWeight = 1;
    this.poseParams.style = radio < GASP ? GASP_STYLE : undefined;
    if (lastSeen) {
      this._face(lastSeen.x, lastSeen.z, dt, 2.5);
      this.poseParams.look = this._lookAt(lastSeen);
    }
    return true;
  }

  /** Deja esta puerta por la otra, y no vuelve a ella en este regreso. */
  _leaveDoor() {
    this._avoidDoor = this.doorSide;
    this.doorSide = -this.doorSide;
    this._doorCheck = 3;
    this._route = [];
  }

  _canUse(side, doorOk) { return doorOk(side) && side !== this._avoidDoor; }

  /**
   * Si la línea a `goal` cruza su patrulla (con `pad` m de margen), la esquina del carro, a `round` m, por donde rodearlo
   * (la del camino más corto que no la cruce); si no, `goal`. La red de andenes no sabe de carros: sin esto se queda
   * contra el costado.
   */
  _aroundCar(goal, round = CAR_MARGIN + .35, pad = 0) {
    const car = this.fit?.car;
    if (!car || !this._crossesCar(this.position, goal, pad)) return goal;
    const yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    const halfLength = (car.length ?? 4.4) / 2 + round, halfWidth = (car.width ?? 1.9) / 2 + round;
    let best = goal, bestCost = Infinity;
    for (const along of [-halfLength, halfLength]) for (const across of [-halfWidth, halfWidth]) {
      _corner.set(car.position.x + fx * along + rx * across, this.position.y, car.position.z + fz * along + rz * across);
      const here = Math.hypot(_corner.x - this.position.x, _corner.z - this.position.z);
      // Ya en esa esquina (llega justo: entre el margen y el rodeo queda una franja angosta), sigue con la próxima.
      if (here < Math.min(.3, (round - pad) / 2) || this._crossesCar(this.position, _corner, pad)) continue;
      // Desde esa esquina, ¿todavía tiene que cruzar? Entonces le falta otra esquina: cuesta el ancho del carro más.
      const cost = here + Math.hypot(goal.x - _corner.x, goal.z - _corner.z) + (this._crossesCar(_corner, goal, pad) ? halfWidth * 2.5 : 0);
      if (cost < bestCost) { bestCost = cost; best = this._cornerGoal.copy(_corner); }
    }
    return best;
  }

  /**
   * La puerta a la que vuelve: la más cercana de las dos a las que se puede llegar (`doorOk`), sin cambiar a cada rato.
   * Cerca del carro, si la carrocería le tapa la suya y la otra está despejada, va por la otra.
   */
  _chooseDoor(dt, doorOk = () => true) {
    this._doorCheck -= dt;
    if (this._doorCheck > 0 || !this.fit) return;
    this._doorCheck = 1;
    this._carPoints(this.doorSide);
    const own = Math.hypot(this._door.x - this.position.x, this._door.z - this.position.z);
    const ownClear = own > 8 || this._clearTo(this._door);
    this._carPoints(-this.doorSide);
    const other = Math.hypot(this._door.x - this.position.x, this._door.z - this.position.z);
    if (!this._canUse(-this.doorSide, doorOk)) return;
    if (!this._canUse(this.doorSide, doorOk) || other < own - DOOR_SWITCH || (!ownClear && other < own && this._clearTo(this._door))) this.doorSide = -this.doorSide;
  }

  /** Ni huye, ni suelta plata, ni queda tendido: aguanta el golpe, se queja y su compañero responde. */
  takeHit({ damage = 10, dir = null, knockback = 0, attacker = null, attackId = null, id = null } = {}) {
    if (this._disposed || !this.onFoot || !Number.isFinite(damage) || damage <= 0) return false;
    if (!this._acceptAttackId(attacker, attackId ?? id)) return false;
    if (attacker?.position && !canReachCombatTarget({ from: attacker.position, to: this.position,
      collisions: this.collisions ?? attacker._lastCollisions, getWaterInfo: this.getWaterInfo,
      fromInWater: !!attacker.isSwimming })) return false;
    let dx = dir?.x ?? 0, dz = dir?.z ?? 0;
    if (!dir && attacker?.position) { dx = this.position.x - attacker.position.x; dz = this.position.z - attacker.position.z; }
    const length = Math.hypot(dx, dz);
    if (length > 1e-4) this._lastHit.set(dx / length, 0, dz / length);
    this._punchFacing = Math.atan2(-this._lastHit.x, -this._lastHit.z);
    this.health = Math.max(40, this.health - damage * .5);
    this._hitReactionRemaining = NPC_HIT_REACTION_DURATION;
    this.staggerTimer = NPC_COMBAT.stagger;
    this._knockVel.copy(this._lastHit).multiplyScalar(Math.min(.4, Math.max(0, knockback || 0)) * 2 / NPC_COMBAT.stagger);
    this.action = 'recibirGolpe';
    this.actionProgress = 0;
    this.moving = false;
    // Golpeado se le cae el agarrón en curso, salvo que ya lo tenga agarrado.
    if (this._grab?.phase !== 'agarre') this._dropGrab();
    if (this._bubbleTimer <= 0) this.say(HIT_LINE, 2.6);
    this.onHit?.(this, attacker);
    return 0;
  }
}
