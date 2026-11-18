// src/entities/npc/mind.js
// La cabeza de cada peatón y el sistema de la calle que las reúne. `StreetMinds` vive en el distrito: arma cada
// cuadro la rejilla de quién está cerca de quién y le da a cada peatón con arquetipo una `NpcMind`. `Npc` solo la
// consulta desde unos pocos ganchos (`mind.aim`, `mind.holdWalk`, `mind.paceFactor`...): toda la lógica vive aquí.
//
// Cada mente tiene su propio azar sembrado por su número: lo que decide no gasta el `Math.random` del juego. Aun
// así, una prueba de tráfico que siembra el juego no sale igual de cada semilla que sin las mentes: los peatones
// esperan, cruzan y piden ruta en otros momentos, y eso cambia cuándo frena cada carro.
import { CrowdGrid } from './crowd.js';
import { AVOID, approach, avoid, dropNeck, easeSide, runnerThreat, sideStepRoom } from './steering.js';
import { CROSS, acceptGap, crossingTemper, firstArrival, signalAllows, signalFor } from './crossing.js';
import { rollTemperament } from './temperament.js';
import { StimulusBus } from './stimuli.js';
import { sightRange } from './perception.js';
import { Awareness, plannerFor } from './awareness.js';
import { refusalFor } from './memory.js';
import { pathClear, solidAt } from './room.js';
import { DAY_CYCLE_SECONDS } from '../../core/Clock.js';
import { hypot } from './hypot.js';

/** Generador pequeño y sembrado (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MIND = {
  far: 40,        // m del jugador: más allá, con la pose ya congelada, no se esquiva (nadie lo ve) y piensa menos
  idleReset: 180, // cuadros sin andar (3 s): vuelve a su línea
  tick: .22,      // s entre dos vistazos de quien está cerca (4,5 por segundo), repartidos entre todos
  farTick: 1,     // s entre dos vistazos de quien está lejos
  perFrame: 16,   // mentes que piensan como mucho en un cuadro; las demás, en el siguiente
  push: .62,      // m entre centros: el jugador se le mete encima
  pushSpeed: 1,   // m/s del jugador para que cuente como empujón
  pushBack: .22,  // m que lo corre un empujón
  pushCooldown: 5 // s antes de quejarse otra vez
};

// Lo que dice quien recibe un empujón. De usted y de aquí.
export const PUSH_PHRASES = [
  '¡Ey, cuidado, que no está solo!',
  '¡Uy, mire por dónde camina!',
  '¡Más despacio, que me tumba!',
  '¡Epa, no empuje!',
  'Qué falta de respeto, hombre.'
];

const STEP_PACE = .3; // ritmo mínimo mientras se corre de lado
const AHEAD = 1;      // m que mira por delante en la línea corrida: lo que hay ahí ya no lo despejó la red
const TOUCH = .45;    // m: corrido de su línea, con algo sólido así de cerca en la dirección en que anda, se para
const _escape = { x: 0, z: 0, need: 0 };
const _lane = { x: 0, z: 0 }, _line = { x: 0, z: 0 };
const _curb = new Int32Array(16), _at = { x: 0, z: 0 };

/** Corta la frase que tenga en pantalla (la de la conversación): se acaba ya, como al cumplir su tiempo. */
function hush(npc) {
  if (!(npc._bubbleTimer > 0)) return;
  npc._bubbleTimer = 1e-6;
  npc._tickBubble?.(1);
}

export class NpcMind {
  constructor(npc, id, system) {
    this.npc = npc;
    this.id = id;
    this.system = system;
    this.random = seededRandom(Math.imul(id + 1, 2654435761) ^ 0x5bd1e995);
    // Esquiva: cuánto se corre de la línea de su ruta (+ derecha) y a qué ritmo anda (1 = su paso).
    this.side = 0;
    this.wantSide = 0;
    this.sideHold = 0;
    this.sideLock = 0;
    this.sideLockAgent = null;
    this.pace = 1;
    this.wantPace = 1;
    this.blockedFor = 0;
    this.stuckX = 0; this.stuckZ = 0; // dónde se trabó (steering.stuckClock)
    this.freeFor = 0; this.freeFrame = -1; // cuánto lleva libre el otro lado, y el último cuadro en que lo vio así
    this.playerRoom = 0;      // m que le deja al jugador (crece con el recelo)
    this.reroute = false;
    this._rerouteFrom = null;
    this._rerouteGroup = false; // lo que le cierra el paso es un grupo de quietos
    this._rerouteStuck = false; // el cambio de ruta sale de estar trabado (no del recelo)
    this._routeAway = false;    // la última ruta de `_routeAwayFrom` sale para el otro lado del que estorba
    this.dodging = false;
    this.yielding = false;
    this.passing = false;     // en un desempate frente a frente, pasa él: se corre de una (steering.avoid)
    this.backOff = false;     // en un desempate cede y el otro le quedó encima: se echa un poco atrás
    this.cramped = false;     // no le cupo correrse todo lo que pedía: el otro no cuenta con su mitad
    this.rounding = false;    // rodea a alguien quieto por su lado libre: se corre a paso de esquivar
    this.brisk = false;       // tiene al otro ya encima: se corre con decisión (steering.avoid)
    this.roundSign = 0;       // por qué lado de ese quieto lo rodea (+1 por su derecha, −1 por su izquierda)
    this.blockerStill = false; // quien le estorba está quieto (no se mueve: no le va a despejar el paso)
    this.blockerGroup = false; // lo que le estorba es un grupo de quietos sin paso (steering.avoid): espera
    this.groupWaited = 0;     // s que lleva esperando frente a un grupo sin paso, sin otra ruta que no lo devuelva
    this.hardStop = false;    // tiene a alguien encima por delante: se para (lo decide steering.avoid)
    this.backed = 0;          // m que lleva echándose atrás en este desempate (no más de AVOID.backMax)
    // Acuerdo de cuello (steering.js): con quién, alrededor de qué quieto, si pasa primero y hacia qué lado lo rodea.
    this.neckWith = null; this.neckStill = null; this.neckFirst = false; this.neckDir = 1;
    this.neckSince = 0; this.neckX = 0; this.neckZ = 0; this.neckQueued = false; this.neckLine = false;
    // La fila que deja pasar quien cede: el último que pasó, por qué quieto, desde cuándo y cuántos van tras el primero.
    this.queueAfter = null; this.queueStill = null; this.queueSince = 0; this.queueCount = 0;
    this.stepping = false;
    this.sideVel = 0;         // m/s a la que se está corriendo de lado (entra y sale suave: steering.easeSide)
    this.headOnWith = null;   // con quién se cruza de frente: sostiene el lado hasta que se cruzaron
    this._steerFrame = -1;
    this.nextTick = system.time + (id % 16) * MIND.tick / 16; // cada uno piensa en su turno
    this.pushCooldown = 0;
    this.lookAtPlayer = 0;
    this.asideLeft = 0; this.asideX = 0; this.asideZ = 0; this.asideRate = AVOID.dodgeRate;
    this._segX = 0; this._segZ = 1;
    this._legTarget = null; this._legRoute = null; this._legX = 0; this._legZ = 0; // de dónde salió hacia su objetivo
    this._aim = { x: 0, y: 0, z: 0 };
    this.temper = rollTemperament(npc.person, this.random);
    const { margin, maxWait } = crossingTemper(this.temper.impatience);
    // El paso de cebra que tiene por delante. `state`: 0 nada, 1 espera en el borde, 2 va cruzando.
    this.crossing = {
      state: 0, waited: 0, margin, maxWait, target: null, end: null, routeRef: null, hurry: false,
      ax: 0, az: 0, ux: 1, uz: 0, length: 0, axis: -1, threat: null
    };
    this.thinking = false; // le toca pensar en este cuadro (lo decide StreetMinds.beginFrame)
    this.seenFrame = -1;   // último cuadro en que estaba en la calle (en `district.npcs`): escondido no piensa
    // Lo que nota y cómo reacciona: entities/npc/awareness.js.
    this.aware = new Awareness(this);
  }

  /** Ritmo de este cuadro: solo cuenta si la esquiva corrió en este cuadro. */
  paceFactor() {
    const hurry = (this.crossing.hurry ? CROSS.hurry : 1) * this.aware.paceFactor();
    if (this._steerFrame !== this.system.frame) return hurry;
    // Mientras da un paso de lado sigue dando pasos: no se desliza quieto. Con alguien encima por delante no: ahí el
    // paso de lado es de lado y nada más.
    return (this.stepping && !this.hardStop && this.pace < STEP_PACE ? STEP_PACE : this.pace) * hurry;
  }

  /** Giro de cabeza para `look` (lo pide Npc al animarse); null deja el vistazo de siempre. */
  gaze(stance) { return this.aware.gaze(stance); }

  /**
   * ¿Anda pendiente de otra cosa (una pelea que mira o a la que va, un susto, salir de la calzada, esperar en el borde
   * para cruzar o ir cruzando)? No conversa.
   */
  busy() { return this.aware.busy() || this.crossing.state !== 0; }

  /** Qué parte de la velocidad de huida lleva (Npc la pide al huir): arranca andando y enseguida corre. */
  fleePace() { return this.aware.fleePace(); }

  /** Huir con cabeza en vez de derecho (lo pide Npc al huir sin ruta). false: que huya como antes. */
  fleeSmart() { return this.aware.fleeSmart(); }

  /** ¿Se acuerda de algo malo del jugador como para no darle limosna? */
  refusesAlms() { return this.aware.memory.refusesAlms(this.system.time); }

  /** Se lo dice (a veces): no le da nada. */
  sayRefusal() {
    const npc = this.npc;
    if (this.random() < .6 && !(npc._bubbleTimer > 0)) npc.say(refusalFor(this.aware.memory.strongest(this.system.time)));
  }

  /**
   * Deja la conversación en que estaba (NpcConversations) para reaccionar a algo: la corta para los dos, así el otro
   * no se queda hablando solo. El sistema de conversaciones la da por terminada en su cuadro y calla la voz; la frase
   * que tenía en pantalla cualquiera de los dos se borra ya.
   */
  leaveTalk() {
    const npc = this.npc, talk = npc.talk;
    if (!talk) return;
    const partner = talk.partner?.talk?.partner === npc ? talk.partner : null;
    hush(npc);
    npc.talk = null;
    if (partner) { hush(partner); partner.talk = null; }
  }

  /**
   * Vuelve a empezar donde lo pusieron (un peatón que se recicla en otra calle): sin corrillo, susto, huida, cruce ni
   * lado a medias. Conserva el temperamento y lo que recuerda del jugador: es la misma persona.
   */
  reset() {
    this.aware.reset();
    this.leaveTalk();
    this.side = 0; this.wantSide = 0; this.sideHold = 0; this.sideLock = 0; this.sideLockAgent = null; this.sideVel = 0; this.headOnWith = null;
    this.pace = 1; this.wantPace = 1; this.blockedFor = 0; this.reroute = false; this._rerouteFrom = null; this._rerouteGroup = false;
    this._rerouteStuck = false;
    this.dodging = false; this.yielding = false; this.passing = false; this.backOff = false; this.cramped = false;
    this.rounding = false; this.brisk = false; this.roundSign = 0; this.hardStop = false; this.stepping = false; this.backed = 0;
    this.blockerGroup = false; this.groupWaited = 0;
    dropNeck(this);
    this.queueAfter = null; this.queueStill = null; this.queueCount = 0;
    this.asideLeft = 0; this.lookAtPlayer = 0;
    this._legTarget = null; this._legRoute = null;
    const c = this.crossing;
    c.state = 0; c.waited = 0; c.target = null; c.end = null; c.routeRef = null; c.hurry = false; c.threat = null;
  }

  /** ¿Está parado en el borde del andén esperando para cruzar? */
  get waiting() { return this.crossing.state === 1; }

  /**
   * ¿Correrse a `side` (m a la derecha de la línea de su ruta) cae en piso pisable y sin nada sólido? Mira todo el
   * trecho de lado desde donde está y el metro que sigue en la línea nueva: un poste a medio camino también lo para.
   */
  roomFor(side) {
    const npc = this.npc, rx = -this._segZ, rz = this._segX;
    const target = npc.target, delta = side - this.side;
    const sx = npc.position.x + rx * delta, sz = npc.position.z + rz * delta;
    if (delta && !pathClear(npc, npc.position.x, npc.position.z, rx * delta, rz * delta)) return false;
    if (!pathClear(npc, sx, sz, this._segX * AHEAD, this._segZ * AHEAD)) return false;
    // El punto al que apunta en el tramo.
    return !target || npc.isWalkable(target.x + rx * side, target.z + rz * side);
  }

  /**
   * ¿Hay andén de verdad corrido a `side` en los próximos `length` m? Piso pisable, nada sólido y, donde su línea va
   * por andén, que la línea corrida no baje a un cruce de calzada. Para rodear un grupo más abierto que `maxSide`.
   */
  sidewalkFor(side, length) {
    const npc = this.npc, rx = -this._segZ, rz = this._segX, fx = this._segX, fz = this._segZ, delta = side - this.side;
    const sx = npc.position.x + rx * delta, sz = npc.position.z + rz * delta;
    if (!pathClear(npc, sx, sz, fx * length, fz * length)) return false;
    const nav = npc.navigation;
    if (!nav?.isSidewalkAt) return true;
    const lane = _lane, line = _line;
    for (let k = 0; k <= length; k++) {
      lane.x = sx + fx * k; lane.z = sz + fz * k;
      line.x = npc.position.x - rx * this.side + fx * k; line.z = npc.position.z - rz * this.side + fz * k;
      if (!nav.isSidewalkAt(lane) && nav.isSidewalkAt(line)) return false;
    }
    return true;
  }

  /**
   * A dónde apunta en este cuadro: el punto de su ruta corrido de lado si esquiva a alguien. Ajusta también el ritmo
   * (`paceFactor`). Lo llama `Npc._walk` una vez por cuadro con el objetivo de la ruta.
   */
  aim(target) {
    const npc = this.npc, sys = this.system;
    if (this._steerFrame < sys.frame - MIND.idleReset) { this.side = 0; this.sideVel = 0; this.pace = 1; this.sideHold = 0; this.blockedFor = 0; }
    else if (this._steerFrame < sys.frame - 1) this.pace = 1;
    this._steerFrame = sys.frame;
    // El tramo: del punto anterior de la ruta al objetivo. Sin punto anterior, desde donde estaba al tomar ese objetivo
    // y no desde donde va: corrido de lado, la línea giraría con él y daría vueltas alrededor del punto sin llegar.
    if (target !== this._legTarget || npc.route !== this._legRoute) {
      this._legTarget = target; this._legRoute = npc.route; this._legX = npc.position.x; this._legZ = npc.position.z;
    }
    const hasPrev = npc.routeIndex > 0 && npc.route[npc.routeIndex] === target;
    let sx = target.x - (hasPrev ? npc.route[npc.routeIndex - 1].x : this._legX);
    let sz = target.z - (hasPrev ? npc.route[npc.routeIndex - 1].z : this._legZ), len = hypot(sx, sz);
    if (len < 1e-3) { sx = target.x - npc.position.x; sz = target.z - npc.position.z; len = hypot(sx, sz); }
    if (len < 1e-3) return target;
    this._segX = sx / len; this._segZ = sz / len;
    // Lejos del jugador nadie lo ve: no se esquiva. Quien vuelve a su sitio llega derecho al último punto.
    const last = npc.fijo?.out && npc.routeIndex >= npc.route.length - 1;
    if (npc._playerDist > MIND.far || last || !sys.grid) {
      this.side = 0; this.pace = 1;
      return target;
    }
    const blockedBefore = this.blockedFor;
    avoid(this, sys.grid, this._segX, this._segZ, npc.walkSpeed, sys.dt);
    // El último trecho hasta su puesto en el corrillo lo va derecho: corrido de lado apuntaría al puesto del de al
    // lado. Si alguien se le para justo delante, frena; trabado, se queda donde está o busca otro puesto (unstick).
    if (this.aware.arriving(target)) {
      this.side = 0; this.stepping = false;
      this.pace = this.hardStop ? approach(this.pace, 0, AVOID.stopBrake, sys.dt) : approach(this.pace, 1, AVOID.accel, sys.dt);
      // Aquí no se corre de lado: frenado frente a alguien quieto cuenta como trabado aunque la esquiva viera un lado.
      this.blockedFor = this.hardStop && this.blockerStill ? blockedBefore + sys.dt : 0;
      if (this.blockedFor > AVOID.stuckYield) { this.reroute = true; this._rerouteFrom = this.sideLockAgent; }
      return target;
    }
    // Al jugador que se le atraviesa lo mira al pasar.
    if (this.sideLockAgent?.isPlayer && sys.player && sys.time >= this.aware.gazeUntil) this.aware.lookAt(sys.player.x, sys.player.z, .8);
    // Corrido de su línea, lo que tiene por delante ya no lo despejó la red: si en el metro que sigue hay algo sólido
    // o se acaba el andén, vuelve hacia su línea y afloja mientras tanto.
    const blocked = Math.abs(this.side) > .02 && !pathClear(npc, npc.position.x, npc.position.z, this._segX * AHEAD, this._segZ * AHEAD);
    if (blocked) {
      if (!(this.wantSide * this.side >= 0 && Math.abs(this.wantSide) < Math.abs(this.side))) this.wantSide = 0;
      if (this.wantPace > .5) this.wantPace = .5;
      this.cramped = true;
    }
    const outward = Math.abs(this.wantSide) > Math.abs(this.side);
    const before = this.side;
    // Quitarse del camino de quien corre (o un desempate) es un paso brusco, y con el otro ya encima o algo sólido por
    // delante tampoco hay tiempo de suavidades; rodear a un quieto, un paso decidido; esquivar con tiempo a otro que anda
    // y volver a la línea, un paso suave.
    const quick = this.dodging || this.passing, close = this.brisk || blocked, firm = close || this.rounding;
    const rate = quick ? AVOID.dodgeRate : firm ? AVOID.roundRate : outward ? AVOID.sideRate : AVOID.relaxRate;
    const accel = quick || close ? AVOID.dodgeAccel : this.rounding ? AVOID.roundAccel : AVOID.sideAccel;
    this.side = easeSide(this, this.wantSide, rate, accel, sys.dt);
    this.pace = this.hardStop ? approach(this.pace, 0, AVOID.stopBrake, sys.dt)
      : approach(this.pace, this.wantPace, this.wantPace < this.pace ? AVOID.brake : AVOID.accel, sys.dt);
    // Correrse de lado es un paso de lado de verdad, aunque casi no avance: no depende del ritmo hacia adelante. Nunca
    // hacia alguien quieto que ya tiene casi encima.
    const delta = this.side - before;
    this.stepping = false;
    if (delta) {
      const dx = -this._segZ * delta, dz = this._segX * delta;
      const part = pathClear(npc, npc.position.x, npc.position.z, dx, dz) ? sideStepRoom(sys.grid, npc, dx, dz) : 0;
      npc.position.x += dx * part; npc.position.z += dz * part;
      this.side = before + delta * part;
      this.sideVel *= part;
      this.stepping = Math.abs(delta) * part > .15 * sys.dt;
    }
    // Cede en un desempate con el otro encima: un paso corto hacia atrás (no más de `backMax`), sin salirse ni meterse
    // en nada.
    if (this.backOff && this.backed < AVOID.backMax) {
      const step = Math.min(AVOID.backOff * sys.dt, AVOID.backMax - this.backed);
      const bx = -this._segX * step, bz = -this._segZ * step;
      if (pathClear(npc, npc.position.x, npc.position.z, bx, bz)) { npc.position.x += bx; npc.position.z += bz; this.backed += step; }
    } else if (!this.backOff) this.backed = 0;
    // Callejón: parado frente a alguien quieto y sin ningún lado libre (steering.avoid): busca otro camino.
    if (!this.blockerGroup) this.groupWaited = 0;
    if (this.blockedFor > AVOID.deadEnd && this.blockerStill) {
      this.reroute = true; this._rerouteFrom = this.sideLockAgent; this._rerouteGroup = this.blockerGroup; this._rerouteStuck = true;
    }
    if (Math.abs(this.side) < 1e-3) return target;
    const aim = this._aim;
    aim.x = target.x - this._segZ * this.side;
    aim.y = target.y;
    aim.z = target.z + this._segX * this.side;
    // Corrido de su línea, andar hacia adelante no mira los sólidos (solo la red): si lo que tiene justo delante, en
    // la dirección en que va, es un poste, se para mientras termina de correrse en vez de meterse en él.
    if (blocked) {
      const dx = aim.x - npc.position.x, dz = aim.z - npc.position.z, len = hypot(dx, dz);
      if (len > 1e-3 && !pathClear(npc, npc.position.x, npc.position.z, dx / len * TOUCH, dz / len * TOUCH)) {
        this.pace = approach(this.pace, 0, AVOID.stopBrake, sys.dt);
      }
    }
    return aim;
  }

  /** ¿Le toca pensar en este cuadro? Unas 4,5 veces por segundo de cerca y una de lejos, cada uno en su turno. */
  tickDue() {
    const sys = this.system;
    if (sys.time < this.nextTick) return false;
    // La distancia de este cuadro (la de Npc se mide después, al actualizarse).
    const p = sys.player, far = !p || hypot(this.npc.position.x - p.x, this.npc.position.z - p.z) > MIND.far;
    const period = far ? MIND.farTick : MIND.tick;
    // El siguiente, un periodo después del que tenía y no del cuadro en que le tocó: tras un cuadro largo cada uno
    // conserva su turno (si no, todos los que vencen en ese cuadro quedan pensando juntos para siempre), y los turnos
    // que se perdió no se acumulan.
    this.nextTick += period;
    if (this.nextTick <= sys.time) this.nextTick += Math.ceil((sys.time - this.nextTick) / period + 1e-9) * period;
    return true;
  }

  /** El jugador se le metió encima andando o corriendo: se corre un poco y se queja. */
  _pushed(dt) {
    const npc = this.npc, sys = this.system, player = sys.player;
    if ((this.pushCooldown -= dt) > 0 || !player || !(npc._playerDist < MIND.push) || npc.koState) return false;
    const pvx = sys.grid.velocityX(sys._playerAgent), pvz = sys.grid.velocityZ(sys._playerAgent);
    const dx = npc.position.x - player.x, dz = npc.position.z - player.z;
    // Cuenta si el jugador va hacia él, no si es él quien pasa rozando a alguien quieto.
    if (hypot(pvx, pvz) < MIND.pushSpeed || pvx * dx + pvz * dz <= 0) return false;
    this.pushCooldown = MIND.pushCooldown;
    const still = npc.fijo && !npc.fijo.out;
    if (!still) {
      const len = hypot(dx, dz) || 1, nx = npc.position.x + dx / len * MIND.pushBack, nz = npc.position.z + dz / len * MIND.pushBack;
      if (npc.isWalkable(nx, nz) && !solidAt(npc.collisions, nx, npc.position.y, nz)) { npc.position.x = nx; npc.position.z = nz; }
    }
    this.lookAtPlayer = 1.6; // se voltea a mirarlo
    if (this.random() < .7 && !(npc._bubbleTimer > 0)) npc.say(PUSH_PHRASES[Math.floor(this.random() * PUSH_PHRASES.length)]);
    this.onPushed?.();
    return true;
  }

  /** Parado y alguien viene corriendo derecho hacia él: se quita de lado. true mientras da el paso. */
  _stepAside(dt) {
    const npc = this.npc;
    if (this.asideLeft > 0) {
      this.asideLeft -= dt;
      const step = this.asideRate * dt;
      const nx = npc.position.x + this.asideX * step, nz = npc.position.z + this.asideZ * step;
      if (npc.isWalkable(nx, nz) && !solidAt(npc.collisions, nx, npc.position.y, nz)) {
        npc.position.x = nx; npc.position.z = nz;
        npc.moving = true;
        return true;
      }
      this.asideLeft = 0;
      return false;
    }
    if (npc.target || (npc.fijo && !npc.fijo.out) || npc._playerDist > MIND.far) return false;
    const grid = this.system.grid, out = this.system.neighbors;
    const n = grid.query(npc.position.x, npc.position.z, AVOID.runnerQuery, out);
    for (let k = 0; k < n; k++) {
      const i = out[k], agent = grid.agents[i];
      if (agent === npc || grid.speed[i] < AVOID.runner) continue;
      if (!runnerThreat(npc.position.x, npc.position.z, agent.position.x, agent.position.z, grid.vx[i], grid.vz[i], _escape)) continue;
      this.asideX = _escape.x; this.asideZ = _escape.z; this.asideRate = AVOID.dodgeRate;
      this.asideLeft = Math.min(.8, _escape.need / AVOID.dodgeRate);
      return true;
    }
    return false;
  }

  /**
   * Antes de andar por su ruta: true si este cuadro no camina (espera, cede, mira...). Aquí también se suelta una
   * ruta en la que lleva rato trabado detrás de alguien: busca otra.
   */
  holdWalk(dt) {
    const npc = this.npc;
    this._pushed(dt);
    const thinks = this.thinking;
    if (this.aware.hold(dt)) return true;
    if ((this.asideLeft > 0 || thinks) && this._stepAside(dt)) return true;
    if (this.reroute) {
      this.reroute = false;
      this.blockedFor = 0;
      // Camino al corrillo no da media vuelta: se queda a mirar donde está o busca otro puesto.
      if (this.aware.watching) { this._rerouteFrom = null; this._rerouteGroup = false; this._rerouteStuck = false; this.aware.unstick(); return false; }
      if (!npc.fijo?.out && npc.navigation?.createRoute) {
        const stuck = this._rerouteStuck, group = this._rerouteGroup;
        const route = this._routeAwayFrom(this._rerouteFrom);
        this._rerouteFrom = null; this._rerouteGroup = false; this._rerouteStuck = false;
        // Frente a un grupo que le cierra el andén (una pareja que conversa) no da media vuelta por nada: solo toma una
        // ruta que salga para el otro lado y, si lo devuelve más de `groupBack` m, sigue esperando a que se muevan (hasta
        // `groupPatience`).
        if (group) this.groupWaited += AVOID.deadEnd;
        const take = !stuck || !group || this._routeAway && (this.groupWaited >= AVOID.groupPatience || this._backtrack(route) <= AVOID.groupBack);
        if (take) {
          this.groupWaited = 0;
          npc.route = route;
          // La ruta empieza en el centro de su baldosa: si ya está ahí al lado, no vuelve hacia el que le estorba.
          npc.routeIndex = route.length > 1 && hypot(route[0].x - npc.position.x, route[0].z - npc.position.z) < 1.1 ? 1 : 0;
          npc.target = route[npc.routeIndex] ?? null;
          if (!npc.target) npc.wait = .3 + this.random() * .6;
          npc.moving = false;
          // Arranca desde quieto: sin esto, el cuadro que no anduvo le devolvía el paso entero y daba un tirón.
          this.pace = 0; this._steerFrame = this.system.frame;
          return true;
        }
      }
    }
    return this._crossHold(dt, thinks);
  }

  /**
   * Cruzar mirando el tráfico. Al tomar un tramo que baja a la calzada se para en el borde del andén y mira; cruza
   * cuando le da el semáforo y el hueco, o cuando se le acaba la paciencia. Ya cruzando, apura el paso si se le
   * viene un carro. true mientras espera.
   */
  _crossHold(dt, thinks) {
    const npc = this.npc, c = this.crossing, target = npc.target;
    if (!target || !npc.navigation?.nodeAt || !npc.route) { c.state = 0; c.hurry = false; c.target = null; return false; }
    // Detrás de otro que espera en el mismo borde: espera ahí mismo, en la fila, en vez de buscar otro camino.
    const next = npc.route[npc.routeIndex + 1];
    if (c.state === 0 && (this.hardStop || this.yielding) && this.sideLockAgent?.mind?.waiting && next && npc.route[npc.routeIndex] === target &&
      Math.abs(target.x - npc.position.x) + Math.abs(target.z - npc.position.z) < 2.2 && this._onRoad(next)) {
      npc.target = next; npc.routeIndex++;
    }
    if (c.target !== npc.target || c.routeRef !== npc.route) this._nextStretch(npc.target);
    if (c.state === 1) {
      c.waited += dt;
      // Lo movieron del borde (un empujón largo, una huida): vuelve a mirar desde donde quedó.
      if (Math.abs(npc.position.x - c.ax) + Math.abs(npc.position.z - c.az) > 1.5) { c.target = null; return false; }
      if (thinks && this._mayCross()) { c.state = 2; c.waited = 0; return false; }
      if (c.waited >= c.maxWait + CROSS.grace) { c.state = 2; c.waited = 0; return false; }
      if (thinks) this._curbRoom();
      this._faceStreet(dt);
      return true;
    }
    if (c.state === 2 && thinks) {
      // Lo que le falta por cruzar contra lo que tarda el primero en llegar.
      const done = (npc.position.x - c.ax) * c.ux + (npc.position.z - c.az) * c.uz;
      const left = Math.max(0, c.length - done) / Math.max(.5, npc.walkSpeed);
      c.hurry = firstArrival(c, this.system.vehicles, this.system.buses, npc.position.y) < left + 1;
    }
    return false;
  }

  /**
   * Esperando en el borde guarda su espacio como cualquier quieto. Lejos del jugador nadie se esquiva, y dos que llegan
   * al mismo punto del borde quedarían uno dentro del otro: el que llegó después se corre un cuerpo a lo largo del borde
   * (o, si no hay andén a los lados, un paso atrás). A la par, se corre el de mayor número.
   */
  _curbRoom() {
    const npc = this.npc, c = this.crossing, grid = this.system.grid, out = this.system.neighbors;
    const px = npc.position.x, pz = npc.position.z, touch = AVOID.body * 2;
    const n = grid.query(px, pz, touch, out);
    for (let k = 0; k < n; k++) {
      const other = grid.agents[out[k]], om = other?.mind;
      if (!om || other === npc || !om.waiting || Math.abs(other.position.y - npc.position.y) > 1.5) continue;
      const rx = other.position.x - px, rz = other.position.z - pz;
      if (rx * rx + rz * rz >= touch * touch) continue;
      if (c.waited > om.crossing.waited || c.waited === om.crossing.waited && this.id < om.id) continue;
      // A lo largo del borde, alejándose del otro; si están en el mismo punto, primero a su derecha.
      const sx = -c.uz, sz = c.ux, lat = rx * sx + rz * sz, away = lat > .01 ? -1 : 1;
      for (let t = 0; t < 3; t++) {
        const dx = t === 2 ? -c.ux : sx * (t ? -away : away), dz = t === 2 ? -c.uz : sz * (t ? -away : away);
        const have = -(rx * dx + rz * dz), need = CROSS.curbGap - have; // lo que ya está apartado en esa dirección
        if (need <= 0) continue;
        const nx = px + dx * need, nz = pz + dz * need;
        _at.x = nx; _at.z = nz;
        if (!npc.isWalkable(nx, nz) || solidAt(npc.collisions, nx, npc.position.y, nz) || this._onRoad(_at) || this._curbTaken(nx, nz, other)) continue;
        this.asideX = dx; this.asideZ = dz; this.asideRate = AVOID.relaxRate; this.asideLeft = need / AVOID.relaxRate;
        c.ax += dx * need; c.az += dz * need; // sigue siendo su borde: desde ahí mide el cruce
        return;
      }
      return;
    }
  }

  /** ¿Hay otro cuerpo (que no sea él ni `other`) en el sitio (x, z) del borde? */
  _curbTaken(x, z, other) {
    const grid = this.system.grid, touch = AVOID.body * 2;
    const n = grid.query(x, z, touch, _curb);
    for (let k = 0; k < n; k++) {
      const agent = grid.agents[_curb[k]];
      if (!agent || agent === this.npc || agent === other) continue;
      const dx = agent.position.x - x, dz = agent.position.z - z;
      if (dx * dx + dz * dz < touch * touch) return true;
    }
    return false;
  }

  /** Tomó un tramo nuevo: ¿baja del andén a un paso de cebra? Si sí, mide el cruce y decide si espera. */
  _nextStretch(target) {
    const npc = this.npc, c = this.crossing, nav = npc.navigation;
    const previous = c.target;
    c.target = target;
    c.routeRef = npc.route;
    // Llegó al otro lado: termina el cruce.
    if (c.state === 2 && (previous === c.end || !this._onRoad(npc.position) && !this._onRoad(target))) { c.state = 0; c.hurry = false; }
    if (c.state === 2) return;
    c.state = 0; c.hurry = false;
    if (!nav?.nodeAt || !this._onRoad(target) || this._onRoad(npc.position)) return;
    // El cruce: de donde está, por los puntos de calzada, hasta el primero de andén del otro lado.
    const route = npc.route;
    let i = npc.routeIndex, end = target;
    while (i < route.length && this._onRoad(route[i])) end = route[i++];
    if (i < route.length) end = route[i];
    const dx = end.x - npc.position.x, dz = end.z - npc.position.z, length = hypot(dx, dz);
    if (length < .5) return;
    c.ax = npc.position.x; c.az = npc.position.z; c.ux = dx / length; c.uz = dz / length; c.length = length; c.end = end;
    c.axis = signalFor(this.system.signals, c).axis;
    c.waited = 0;
    // Mira antes de bajar: con la calle libre ni se detiene.
    c.state = this._mayCross() ? 2 : 1;
  }

  /** ¿Es calzada (un paso de cebra con tráfico) el punto (x, z)? Bajo el viaducto no pasan carros. */
  _onRoad(point) {
    const nav = this.npc.navigation, id = nav.nodeAt(point.x, point.z);
    if (id < 0) return false;
    const node = nav.nodes[id];
    return node.crossing && !node.underDeck;
  }

  /** ¿Cruza ya? Semáforo y hueco; pasada su paciencia, cualquier hueco en el que no lo atropellen. */
  _mayCross() {
    const npc = this.npc, c = this.crossing, sys = this.system;
    const crossTime = c.length / Math.max(.5, npc.walkSpeed) + .4;
    const arrival = firstArrival(c, sys.vehicles, sys.buses, npc.position.y);
    if (c.waited >= c.maxWait) return arrival > CROSS.lastChance;
    return signalAllows(sys.signals?.time ?? 0, c.axis, crossTime) && acceptGap(arrival, crossTime, c.margin);
  }

  /** Esperando en el borde: de cara a la calle. */
  _faceStreet(dt) {
    const root = this.npc.root;
    if (!root) return;
    let turn = Math.atan2(this.crossing.ux, this.crossing.uz) - root.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    root.rotation.y += turn * Math.min(1, dt * 4);
  }

  /** Cuánto lo devuelve `route`: los metros que se va hacia atrás en la dirección en que iba. */
  _backtrack(route) {
    const { x, z } = this.npc.position;
    let back = 0;
    for (let i = 0; i < route.length; i++) back = Math.max(back, -((route[i].x - x) * this._segX + (route[i].z - z) * this._segZ));
    return back;
  }

  /**
   * Trabado contra alguien que no le da paso: de tres recorridos de la red, el que sale para el otro lado; si ninguno
   * de los tres sale para allá, mira hasta tres más. El azar es el suyo, no el del juego.
   */
  _routeAwayFrom(blocker) {
    const npc = this.npc, nav = npc.navigation, { x, z } = npc.position;
    const bx = blocker?.position?.x ?? x + this._segX, bz = blocker?.position?.z ?? z + this._segZ;
    let best = [], score = -Infinity;
    for (let i = 0; i < 6 && (i < 3 || score < 10); i++) {
      const route = nav.createRoute(npc.position, this.random);
      if (route.length < 2) continue;
      // Hacia dónde arranca (el segundo punto: el primero es el centro de su baldosa) y qué tan lejos termina del otro.
      const first = route[1], end = route.at(-1);
      const away = (first.x - x) * (x - bx) + (first.z - z) * (z - bz);
      const value = (away > 0 ? 10 : 0) + hypot(end.x - bx, end.z - bz) * .1;
      if (value > score) {
        score = value; best = route;
        // ¿Sale para otro lado? No arranca hacia el que estorba (a menos de 60° de él).
        const toward = (first.x - x) * (bx - x) + (first.z - z) * (bz - z);
        this._routeAway = toward < .5 * hypot(first.x - x, first.z - z) * hypot(bx - x, bz - z);
      }
    }
    if (!best.length) this._routeAway = false;
    return best;
  }
}

/**
 * El gancho de `Bogota.update`: arma las mentes del distrito la primera vez y les da su cuadro. Va en una función
 * aparte y no escrito en `update`: el `new` dentro de ese método grande le cambia a V8 cómo lo optimiza, y el método
 * entero pasa a reservar unos 5 KB más por cuadro aunque la línea no corra (medido con el muestreador de memoria).
 */
export function thinkStreet(district, dt, playerPos, vehicles) {
  (district.minds ??= new StreetMinds(district)).beginFrame(dt, playerPos, vehicles);
}

/** Las mentes de la calle de un distrito: la rejilla, el reloj y lo que ven todos en el mismo cuadro. */
export class StreetMinds {
  constructor(district) {
    this.district = district;
    this.grid = new CrowdGrid(128);
    this.neighbors = new Int32Array(32);
    this.frame = 0;
    this.time = 0;
    this.dt = 0;
    this.player = null;
    this._playerAgent = { position: null, isPlayer: true };
    this._nextId = 0;
    this._cursor = 0; // por dónde empieza a repartir los turnos (ver beginFrame)
    this.minds = [];
    this.vehicles = [];
    this.buses = null;
    this.signals = null;
    // Lo que pasa en la calle y se ve u oye (stimuli.js), y hasta dónde se ve con esta luz.
    this.bus = new StimulusBus();
    this.sight = sightRange();
    this.reportAt = -Infinity;
    this._sirenAt = -Infinity;
    this._plannerCache = { nav: null, planner: null };
    this._listeners = [];
    this._listen();
  }

  /** Deja un estímulo en el canal con el reloj de las mentes. */
  emit(tipo, x, z, radio, intensidad, origen) { return this.bus.emit(tipo, x, z, radio, intensidad, origen, this.time); }

  /** El planificador de huidas de la red `nav` (uno por distrito). */
  planner(nav) { return plannerFor(this._plannerCache, nav); }

  /** Quién es `who` para las mentes: el jugador tiene un solo agente. */
  _agentFor(who) { return !who || (this.player && who.position === this.player) ? this._playerAgent : who; }

  /** Los eventos del juego que dejan estímulos. Sin `window` (algunas pruebas) no escucha nada. */
  _listen() {
    const target = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
    if (!target) return;
    this._window = target;
    const on = (name, handler) => { target.addEventListener(name, handler); this._listeners.push([name, handler]); };
    const at = (fn) => () => { if (this.player) fn(this.player); };
    on('street-fight', event => {
      const who = event.detail?.attacker, p = who?.position ?? this.player;
      if (p) this.emit('pelea', p.x, p.z, 0, 1, this._agentFor(who));
    });
    on('mirror-stolen', event => {
      const p = event.detail?.car?.position ?? this.player;
      if (p) this.emit('robo', p.x, p.z, 0, .8, this._playerAgent);
    });
    on('steal-caught', at(p => this.emit('grito', p.x, p.z, 0, 1, null)));
    on('car-honk', event => { const d = event.detail; if (Number.isFinite(d?.x)) this.emit('pito', d.x, d.z, 0, 1, null); });
    on('police-chase', at(p => this.emit('persecucion', p.x, p.z, 20, .8, this._playerAgent)));
    on('police-arrest', at(p => this.emit('arresto', p.x, p.z, 0, 1, this._playerAgent)));
    // Dormir salta el reloj sin simular (game.js): para la memoria pasó lo que avanzó el reloj del mundo (core/Clock.js).
    // Los turnos no se mueven.
    on('sleep-end', event => this.age((event.detail?.hours ?? 0) * DAY_CYCLE_SECONDS / 24));
  }

  /** Pasaron `seconds` de juego sin simularlos: todos olvidan como si los hubieran vivido. */
  age(seconds) {
    for (const mind of this.minds) mind.aware.memory.age(seconds);
  }

  /** Mente para quien tiene arquetipo y anda por la calle; los vendedores atienden su puesto. */
  _attach(npc) {
    if (!npc.person || npc.isVendor) { npc.mind = null; return; }
    const mind = new NpcMind(npc, this._nextId++, this);
    npc.mind = mind;
    this.minds.push(mind);
  }

  /** Una vez por cuadro, antes de actualizar a los NPC. */
  beginFrame(dt, playerPos, vehicles = []) {
    this.frame++;
    this.dt = dt;
    this.time += dt;
    this.vehicles = vehicles;
    this.buses = this.district.busServices ?? null;
    this.signals = this.district.signals ?? null;
    const npcs = this.district.npcs, frame = this.frame;
    const grid = this.grid;
    grid.clear();
    this.player = playerPos ?? null;
    if (playerPos) {
      this._playerAgent.position = playerPos;
      grid.pinned = grid.add(this._playerAgent, playerPos, dt); // en un gentío, la consulta llena no lo deja por fuera
    }
    // La gente de la calle es la de `district.npcs`: quien no está ahí (escondido para reciclarlo) ni piensa ni se
    // esquiva. De `trafficPedestrians` entran además los agentes que nunca fueron peatones del distrito (el perro, un
    // conductor bravo): los que tienen `mind` definido ya pasaron por la lista de arriba.
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i];
      if (npc.mind === undefined) this._attach(npc);
      if (npc.mind) npc.mind.seenFrame = frame;
      if (npc.position && !npc._disposed) grid.add(npc, npc.position, dt);
    }
    const extra = this.district.trafficPedestrians;
    if (extra && extra !== npcs) {
      for (let i = 0; i < extra.length; i++) {
        const agent = extra[i];
        if (!agent?.position || agent._disposed || agent.mind !== undefined) continue;
        grid.add(agent, agent.position, dt);
      }
    }
    // De noche o con lluvia se ve menos (el bus guarda si es de noche: lo pone setNightMode).
    this.sight = sightRange(!!this.district.busServices?.[0]?.night, (this.district.wetness ?? 0) > .05);
    // Suena la patrulla con la sirena prendida (`car.pursuit`, lo mismo que mira PoliceSirenAudio): una por segundo.
    // No basta `state === 'chase'`: parada con los agentes a pie sigue persiguiendo, pero en silencio.
    if (this.time - this._sirenAt >= 1) {
      let sirens = 0;
      for (let i = 0; i < vehicles.length && sirens < 2; i++) {
        const v = vehicles[i];
        if (!v?.police || !v.car?.pursuit || !v.car.position) continue;
        this.emit('sirena', v.car.position.x, v.car.position.z, 0, 1, v);
        sirens++;
      }
      if (sirens) this._sirenAt = this.time;
    }
    // Cada uno piensa en su turno: nota lo que le pasó, mira lo que pasó alrededor y decide. Como mucho `perFrame` por
    // cuadro: a los que no les alcanzó el cuadro les toca en el siguiente, primero que a nadie.
    const minds = this.minds, count = minds.length, start = count ? this._cursor % count : 0;
    let thinkers = 0;
    for (let k = 0; k < count; k++) {
      const i = start + k < count ? start + k : start + k - count, mind = minds[i];
      mind.thinking = false;
      if (mind.seenFrame !== frame) {
        // Escondido: no ocupa un puesto del corrillo ni sigue en un acuerdo de cuello mientras tanto.
        if (mind.aware.watching) mind.aware._stopWatching();
        if (mind.neckWith) dropNeck(mind);
        continue;
      }
      if (thinkers >= MIND.perFrame || mind.npc._disposed || mind.npc.mind !== mind || !mind.tickDue()) continue;
      mind.thinking = true;
      mind.aware.watchBody(); // le robaron y se dio cuenta, le cayó popó o le pegaron
      mind.aware.perceive();
      if (++thinkers === MIND.perFrame) this._cursor = i + 1;
    }
  }

  /** Velocidad del jugador estimada en este cuadro (m/s). */
  get playerSpeed() { return hypot(this.grid.velocityX(this._playerAgent), this.grid.velocityZ(this._playerAgent)); }

  dispose() {
    for (const [name, handler] of this._listeners) this._window?.removeEventListener(name, handler);
    this._listeners.length = 0;
    this.bus.clear();
    this.grid.clear();
    for (const mind of this.minds) if (mind.npc.mind === mind) mind.npc.mind = null;
    this.minds.length = 0;
  }
}
