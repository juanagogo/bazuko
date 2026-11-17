// src/entities/npc/awareness.js
// Lo que cada peatón nota y cómo reacciona, por grados. En su turno de pensar (4 a 5 veces por segundo de cerca, una
// de lejos) mira el canal de estímulos: lo que ve en su cono y lo que oye. Eso le sube la alerta, que baja sola con
// el tiempo, y según el nivel:
// - curiosidad: voltea la cabeza 1 a 3 s y afloja el paso (el indiferente no: sigue a su paso mirando de reojo);
// - una pelea o un arresto cerca arman corrillo, y cada uno mira a su manera: el curioso se arrima a paso vivo al arco
//   de adentro (a 4 a 6 m, de cara, repartidos); el bravo y el avisador miran desde el anillo de afuera (de 6 a 9 m), y
//   el avisador, al rato, avisa y sigue; el indiferente que pasa a menos de 10 m afloja, la mira y a veces se detiene
//   unos segundos donde va; el miedoso la mira de lejos (8 a 10 m) o se va. Nadie mira desde la calzada ni detrás de
//   algo, nadie cruza la calle para ir, va quien alcanza a llegar a tiempo y se van de a pocos cuando se acaba;
// - recelo: a quien se lo causó le deja 3 m (lo rodea abierto) y, si lo tiene adelante sin sitio para rodearlo,
//   cambia de camino;
// - miedo: si el peligro está a su alcance de miedo (según su temperamento), retrocede un momento de frente (o de
//   lado, si atrás no cabe) y después huye con cabeza (flight.js); el bravo, en cambio, le planta cara. Más lejos lo
//   mira con recelo. Quien está sentado, en el piso o en su sitio no se mueve por miedo: mira desde donde está. En
//   plena calzada no se para: primero sale al andén que no lo acerque al peligro y ahí reacciona.
// Quien está conversando y reacciona deja la conversación, y la corta para los dos.
// - el avisador grita que llamen a la policía cuando ve al jugador hacer algo malo.
// El temperamento (temperament.js) solo cambia los umbrales. Lo malo que le vio hacer al jugador lo recuerda unos
// minutos (memory.js): lo reconoce, le da recelo de lejos, no le da limosna y lo cuenta al que tiene al lado.
import { OUTER, STIMULI } from './stimuli.js';
import { canSee, decayAlarm, levelFor, strength } from './perception.js';
import { FlightPlanner } from './flight.js';
import { GOSSIP_PHRASES, MEMORY, Memory, RECLAIM_PHRASES, RECOGNIZE_PHRASES } from './memory.js';
import { pathClear, sightClear, solidAt } from './room.js';
import { LOW_STANCES } from '../../character/archetypes.js';
import { hypot } from './hypot.js';

export const REACT = {
  look: [1, 3],      // s que mira lo que le llamó la atención
  slow: .6,          // ritmo mientras mira
  wary: 3,           // m que le deja a quien le da recelo
  waryAhead: 8,      // m: así de cerca adelante y sin sitio para rodearlo, cambia de camino
  waryEvery: 6,      // s entre dos cambios de camino
  back: .7,          // s que retrocede de frente antes de salir corriendo
  startle: [.15, .6], // s entre notar el peligro y moverse: el miedoso de una, el indiferente se demora
  backSpeed: .8,     // m/s
  flinch: 1.5,       // s que se queda mirando, sin moverse, quien está sentado, en el piso o en su sitio
  stand: 2.5,        // s que le planta cara
  watchReach: 25,    // m: hasta aquí busca una escena (que llegue a tiempo lo decide `arrive`)
  ring: [4, 6],      // m del corrillo: en arco alrededor de lo que pasa
  rows: [4.4, 5.5],  // m de las dos filas del corrillo (la segunda queda a 1,1 m de la primera)
  gap: 1.05,         // m entre dos mirones de la misma fila
  crowd: 6,          // m de arco que prefiere caminar de más con tal de no quedar pegado a otro mirón: el arco se reparte
  backRow: 4,        // m de arco que prefiere caminar de más con tal de quedar en la primera fila
  notice: [.1, .5],  // s desde el estímulo hasta que la cabeza arranca a voltear (a medio giro, de .3 a .8 s)
  hesitate: [.2, .9], // s que se queda mirando antes de arrancar hacia el corrillo: no salen todos a la vez
  arrive: 12,        // s desde que lo nota para estar en su puesto, como mucho...
  fight: 18,         // ...y lo que queda de pelea: de la primera trompada al final de la escena van unos 18 s (10 de golpes y 8 más)
  watchLeft: 3,      // s de escena que le tienen que quedar al llegar para que valga la pena ir
  retry: 1.5,        // s: si no le alcanzaba para llegar, vuelve a mirar si la pelea sigue...
  retries: 4,        // ...estas veces; después mira desde donde va
  turnBack: 15,      // m: quien iba alejándose de la escena y la tiene más lejos que esto no se devuelve a mirarla
  outer: [6, 9],     // m del anillo de afuera: de ahí miran los que quieren ver pero no arrimarse
  outerOff: .6,      // m más allá de su radio de miedo se para quien mira desde afuera
  spread: 2,         // m entre dos puestos del anillo de afuera
  passBy: 10,        // m: el indiferente que pasa así de cerca de una escena afloja el paso y voltea...
  passStop: .75,     // ...y esta parte de ellos se detiene a mirar desde donde va, si queda a 6 m o más...
  passLook: [2, 5],  // ...estos segundos, y sigue su camino
  tell: [3, 5],      // s que mira el avisador antes de avisar y seguir en lo suyo
  brisk: 1.3,        // ritmo hacia el corrillo, a paso vivo...
  briskSpeed: 1.6,   // ...y no menos de esto (m/s)
  far: [8, 10],      // m desde los que el miedoso mira una pelea, si no se va
  lastLeg: 1.6,      // m: tan cerca de su puesto en el corrillo, va derecho a él (sin correrse de lado)
  room: .85,         // m: trabado camino a su puesto, se queda donde está si nadie le queda más cerca que esto
  watchers: 8,       // mirones por escena, entre los dos anillos y los que miran de lejos
  leave: [1, 4],     // s que tardan en irse cuando se acaba, escalonados (la escena dura 8 s tras el último golpe: de 9 a 12)
  reportEvery: 30,   // s entre dos avisos de la misma persona
  replan: 1.5,       // s entre dos cambios de rumbo al huir
  safe: 25,          // m: huyendo, más allá de esto y sin ver el peligro un rato, para
  unseen: 3,         // s sin ver el peligro para dejar de huir
  fleeMax: 15,       // s que huye como mucho mientras el peligro sigue cerca
  lookBack: 2,       // s entre dos miradas atrás al huir (las primeras)
  lookBacks: 6,      // s de huida en que todavía mira atrás
  fleeRamp: .4,      // s en que pasa de andar a correr al salir huyendo
  threatFresh: 6,    // s que vale lo último que supo de la amenaza
  gazeMax: 70 * Math.PI / 180,   // cuánto gira la cabeza
  gazeBehind: 2.3,   // rad: más atrás no voltea, sigue de frente
  glance: [.8, 1.8], // s: apurado en la calzada mira el carro de a vistazos, de tanto cada tanto
  gazeRate: 7        // rapidez del resorte de la mirada
};
const FLEE_RUN_GAIN = 1.4; // corriendo va a 2,4 veces su paso (Npc)
// Los puestos de cada fila del corrillo: tantos como quepan a `gap` m (como mucho 32, los bits de la máscara).
const ROW_SLOTS = REACT.rows.map(r => Math.min(32, Math.floor(2 * Math.PI * r / REACT.gap)));
// Posturas en las que no gira la cabeza (las mismas que `NO_GLANCE` de Npc.js).
const NO_GAZE = new Set(['dormido', 'acurrucado', 'celular', 'telefono']);

// Lo que dicen. De usted y de aquí.
export const STAND_PHRASES = ['¡Quieto ahí! ¿Usted qué se cree?', '¡A mí no me venga con eso!', '¡Respete, que lo estoy viendo!', '¡Váyase de aquí o llamo a la policía!'];
export const REPORT_PHRASES = ['¡Policía! ¡Por aquí están robando!', '¡Llamen a la policía!', '¡Ese de ahí! ¡Que alguien avise a la patrulla!'];
export const WATCH_PHRASES = ['¡Uy, se armó la pelea!', '¿Qué pasó allá?', 'Eso se puso feo.', 'Mire, mire, allá.'];

const NONE = 0, BACK = 1, STAND = 2, FLINCH = 3;
const EXITS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Hacia dónde retrocede, en orden: derecho hacia atrás, en diagonal y de lado (rad respecto a alejarse del peligro).
const BACK_TURNS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2];
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

export class Awareness {
  constructor(mind) {
    this.mind = mind;
    const npc = mind.npc, sys = mind.system;
    this.alarm = 0;
    this.level = 0;
    this.lastStimulus = -Infinity;
    this.lastPerceive = sys.time;
    this.seen = sys.bus.count;      // estímulos ya mirados
    this.threat = null;             // quién le causa la alerta (el agente del jugador, un NPC...) o null
    this.threatX = 0; this.threatZ = 0; this.threatAt = -Infinity; this.threatKind = null;
    this.reaction = NONE; this.reactionUntil = 0; this.backX = 0; this.backZ = 0;
    this.reactionAt = 0; this._turnAt = 0; // primero la cabeza; el cuerpo desde `_turnAt`; los pies desde `reactionAt`
    this._fleeStart = -1; this._lookBackAt = 0; this.lookBackUntil = -Infinity; // la huida que decidió la mente
    this.gazeX = 0; this.gazeZ = 0; this.gazeUntil = -Infinity;
    this.gazeYaw = 0; this.gazeVel = 0; this._gazeT = sys.time;
    this.slowUntil = -Infinity;
    this.noticeAt = -Infinity;      // desde cuándo voltea la cabeza a lo que le llamó la atención
    this.watching = null; this._watchId = 0; this.watchSlot = -1; this.watchRow = 0; this.watchX = 0; this.watchZ = 0;
    this.ringX = 0; this.ringZ = 0; this.watchFar = false;
    this.watchLeave = Infinity; this._skipScene = 0; this._watchRank = 0;
    this._sceneSeen = 0; this._sceneGo = Infinity; // la escena que notó y cuándo arranca hacia ella
    this._sceneTries = 0; this._sceneTryAt = 0;     // si no le alcanzaba para llegar: cuántas veces miró y cuándo vuelve a mirar
    this.watchPass = false;                         // mira de paso: se detuvo donde iba y sigue su camino
    this._tellAt = Infinity;                        // el avisador: cuándo avisa y se va
    this._toTell = null;                            // lo que tiene por avisar cuando haya mirado un momento
    this._stareUntil = -Infinity;                   // el indiferente junto a una escena: la mira de frente, no de reojo
    this._farScene = 0; this._farChoice = false;    // el miedoso: si mira esa pelea de lejos o se va
    this._exiting = false;                          // sale de la calzada antes de reaccionar
    this._fleeRetry = -Infinity; this._replanAt = -Infinity; this._waryAt = -Infinity;
    this.reportAt = -Infinity;
    this._point = { x: 0, y: 0, z: 0 };
    this._bonus = (x, z) => this._fleeBonus(x, z);
    this.memory = new Memory();
    this._gossipTry = -Infinity;
    // Lo que se le nota al cuerpo (para saber cuándo le pasa algo): robo, popó, golpe.
    this._robbed = npc._robadoTimer ?? 0;
    this._flee = npc.fleeTimer ?? 0;
    this._splatted = !!npc.isSplatted;
    this._hit = !!npc.koState || (npc._hitReactionRemaining ?? 0) > 0;
  }

  get system() { return this.mind.system; }

  /** Lo pusieron en otro sitio: suelta el corrillo, el susto, la huida y la mirada. Lo que recuerda se queda. */
  reset() {
    this._stopWatching();
    this.alarm = 0; this.level = 0; this.threat = null; this.threatAt = -Infinity; this.threatKind = null;
    this.reaction = NONE; this.reactionUntil = 0; this.reactionAt = 0; this._turnAt = 0;
    this._fleeStart = -1; this.lookBackUntil = -Infinity;
    this.gazeUntil = -Infinity; this.gazeYaw = 0; this.gazeVel = 0; this.noticeAt = -Infinity; this.slowUntil = -Infinity;
    this._sceneSeen = 0; this._sceneGo = Infinity; this._exiting = false; this._stareUntil = -Infinity; this._toTell = null;
    this.seen = this.system.bus.count; // lo que pasó donde estaba ya no lo ve
  }
  get npc() { return this.mind.npc; }

  /** Mira (x, z) unos segundos. */
  lookAt(x, z, seconds) {
    this.gazeX = x; this.gazeZ = z;
    this.gazeUntil = Math.max(this.gazeUntil, this.system.time + seconds);
  }

  /** Le pasó a él: robo, popó o golpe del jugador. Miedo de una. */
  victim(kind, x, z) {
    const sys = this.system, player = sys._playerAgent;
    this.alarm = 1;
    this.level = 3;
    this.lastStimulus = sys.time;
    this.threat = player.position ? player : null;
    this.threatX = player.position?.x ?? x; this.threatZ = player.position?.z ?? z;
    this.threatAt = sys.time; this.threatKind = kind;
    this.memory.remember(kind, 1, sys.time, { victim: true });
    this._stopWatching();
    this.mind.leaveTalk();
    if (this.npc.fleeTimer > 0) this._startFlight(sys.time);
  }

  /** Empieza una huida de un peligro: mira atrás de vez en cuando y para lejos (ver `_flight`). */
  _startFlight(now) {
    this._fleeStart = now;
    this._lookBackAt = now + .8 + this.mind.random() * .4;
  }

  /** Su turno de pensar: lo que percibe del canal, la alerta, el nivel y la reacción. */
  perceive() {
    const npc = this.npc, sys = this.system, bus = sys.bus, now = sys.time;
    const elapsed = now - this.lastPerceive;
    this.lastPerceive = now;
    this.alarm = decayAlarm(this.alarm, elapsed, now - this.lastStimulus);
    if (npc.koState) { this.seen = bus.count; return; }
    const range = sys.sight, px = npc.position.x, pz = npc.position.z, yaw = npc.root?.rotation.y ?? 0;
    let best = 0, bx = 0, bz = 0, origin = null, kind = null, born = now;
    for (let id = Math.max(this.seen, bus.oldest); id < bus.count; id++) {
      if (!bus.alive(id, now)) continue;
      const i = bus.slot(id);
      if (bus.origin[i] === npc) continue; // su propio grito
      const x = bus.x[i], z = bus.z[i], d = hypot(x - px, z - pz);
      if (d > bus.radius[i] && d > range) continue;
      const s = strength(bus.kind[i], d, canSee(px, pz, yaw, x, z, range), bus.intensity[i], bus.radius[i], range);
      if (s > best) { best = s; bx = x; bz = z; origin = bus.origin[i]; kind = bus.kind[i]; born = bus.born[i]; }
    }
    this.seen = bus.count;
    // Quien le da recelo sigue ahí cerca y a la vista: no se le pasa.
    const threat = this.threat;
    if (this.level >= 2 && threat?.position && now - this.threatAt < 60) {
      const d = hypot(threat.position.x - px, threat.position.z - pz);
      if (d < 8 && canSee(px, pz, yaw, threat.position.x, threat.position.z, range)) {
        this.lastStimulus = now; this.threatX = threat.position.x; this.threatZ = threat.position.z; this.threatAt = now;
      }
    }
    const before = this.level;
    if (best > .02) {
      this.alarm = Math.min(1, this.alarm + best * this.mind.temper.gain);
      this.lastStimulus = now;
      const source = origin?.position ? origin : null;
      // Un grito asusta pero no dice de quién: la amenaza es el sitio.
      if (kind !== 'grito' && kind !== 'sirena' && kind !== 'pito') this.threat = source;
      this.threatX = source?.position.x ?? bx; this.threatZ = source?.position.z ?? bz;
      this.threatAt = now; this.threatKind = kind;
      // La cabeza no voltea en el mismo instante: un poco después de que pasó (si ya estaba mirando, sigue).
      if (now >= this.gazeUntil) this.noticeAt = Math.max(now, born + REACT.notice[0] + this.mind.random() * (REACT.notice[1] - REACT.notice[0]));
      this.lookAt(bx, bz, REACT.look[0] + this.mind.random() * (REACT.look[1] - REACT.look[0]));
      // Lo malo que le vio hacer al jugador, con la fuerza con que lo percibió y lo que le importa (su temperamento).
      if (STIMULI[kind]?.bad && origin === sys._playerAgent && best >= .1) this.memory.remember(kind, Math.min(1, best * 1.5 * this.mind.temper.gain), now);
    }
    const grudge = this._recognize(now, px, pz, yaw, range);
    this.level = levelFor(this.alarm, this.level);
    if (best > .02 || this.level !== before) this._react(before, kind, origin);
    // Espacio para el jugador: 3 m con recelo; si se acuerda de algo, más cuanto más le pesa.
    const wary = this.level >= 2 && this.threat === sys._playerAgent ? REACT.wary : 0;
    const room = Math.max(wary, grudge >= MEMORY.recognize ? 1.5 + 2.5 * grudge : 0);
    // Quien va a su puesto del corrillo (o ya está en él) no le saca el cuerpo al que pelea: su puesto y la ruta que
    // lleva hasta él ya le quedan lejos (`_routeFor`), y la esquiva cree que va derecho hacia él.
    this.mind.playerRoom = this.watching && !this.watchFar ? 0 : room;
    this._flight(now, px, pz, yaw, range);
    this._fear(now);
    this._gossip(now);
    this._wary(now);
    this._watchScene(now);
    this._replanFlight(now);
  }

  /** Cambió de nivel o percibió algo: qué hace. */
  _react(before, kind, origin) {
    const sys = this.system, now = sys.time, level = this.level, mind = this.mind;
    if (level >= 1 && !mind.temper.glance) this.slowUntil = now + 1.5; // el indiferente no afloja: mira de reojo
    // El avisador grita que llamen a la policía cuando ve al jugador hacer algo malo. Si es algo que se puede quedar
    // mirando (una pelea), primero mira un momento y avisa desde su puesto; si no va a mirarla, avisa ya (`_watchScene`).
    if (kind && STIMULI[kind]?.bad && origin === sys._playerAgent && level >= 2 && mind.temper.report >= .5) {
      if (STIMULI[kind].scene) this._toTell = kind;
      else this._report(kind);
    }
  }

  /** El avisador que no va a mirar (o ya no): avisa lo que tenía por avisar. */
  _tellNow() {
    const kind = this._toTell;
    if (!kind) return;
    this._toTell = null;
    this._report(kind);
  }

  /** Con miedo y el peligro a su alcance: retrocede y huye, o le planta cara. Se mira en cada turno: puede acercarse. */
  _fear(now) {
    const npc = this.npc, mind = this.mind, sys = this.system;
    if (this.level < 3 || npc.fleeTimer > 0 || this.reaction !== NONE || npc.koState) return;
    const t = this.threat?.position, tx = t ? t.x : this.threatX, tz = t ? t.z : this.threatZ;
    const d = hypot(tx - npc.position.x, tz - npc.position.z);
    // A quien le hizo algo lo esquiva desde más lejos.
    const victimOf = this.threat === sys._playerAgent ? this.memory.victimOf(now) : null;
    const reach = victimOf ? Math.max(mind.temper.fearReach, 8) : mind.temper.fearReach;
    if (d > reach || now - this.threatAt > REACT.threatFresh) return;
    // Ante una pelea, el miedoso que decidió mirarla de lejos no huye mientras quede a 8 m o más.
    if (STIMULI[this.threatKind]?.scene && this._watchFar(now, d, tx, tz)) return;
    // En plena calzada no se para: primero sale al andén y ahí reacciona.
    if (this._leaveRoad(tx, tz)) return;
    this._stopWatching();
    this.mind.leaveTalk();
    this.threatX = tx; this.threatZ = tz;
    const brave = mind.temper.stand >= .5 && this.threat === sys._playerAgent;
    if (brave) {
      const lines = victimOf ? RECLAIM_PHRASES : STAND_PHRASES;
      if (!(npc._bubbleTimer > 0)) npc.say(lines[Math.floor(mind.random() * lines.length)]);
    }
    // Sentado, acostado, agachado o en su sitio: no se traslada ni se voltea por miedo. Mira desde donde está.
    if (LOW_STANCES.has(npc.stance) || (npc.fijo && !npc.fijo.out) || npc._riseLeft > 0) {
      this.reaction = FLINCH; this.reactionUntil = now + REACT.flinch;
      return;
    }
    // Primero voltea la cabeza (ya, con `gaze`), a la mitad de la demora el cuerpo y después se mueve: el miedoso
    // de una, el indiferente casi medio segundo después.
    const gain = mind.temper.gain ?? 1;
    const delay = Math.max(REACT.startle[0], Math.min(REACT.startle[1], REACT.startle[1] - (gain - .45) * .43));
    this.reactionAt = now + delay; this._turnAt = now + delay / 2;
    if (brave) { this.reaction = STAND; this.reactionUntil = this.reactionAt + REACT.stand; return; }
    this.reaction = BACK; this.reactionUntil = this.reactionAt + REACT.back;
    this._backRoom(tx, tz);
  }

  /**
   * El miedoso ante una pelea: la mira de lejos, a 8 a 10 m, o se va (huye como de cualquier peligro). Lo decide una
   * vez por escena con su azar. Si la pelea se le arrima a menos de 8 m, deja de mirar y huye. true mientras la mira.
   */
  _watchFar(now, d, tx, tz) {
    const npc = this.npc, mind = this.mind;
    if (!(mind.temper.far > 0) || npc.fijo || LOW_STANCES.has(npc.stance) || npc._riseLeft > 0) return false;
    const scene = this.system.bus.sceneNear(tx, tz, 4, now);
    if (!scene) return false;
    if (this._farScene !== scene.id) { this._farScene = scene.id; this._farChoice = mind.random() < mind.temper.far; }
    const ds = hypot(npc.position.x - scene.x, npc.position.z - scene.z);
    if (!this._farChoice || ds < REACT.far[0] - .3 || d < REACT.far[0] - .5) {
      if (this.watching === scene) this._stopWatching();
      return false;
    }
    if (this.watching === scene) return true;
    if (scene.watchers >= REACT.watchers) return false; // ya hay un gentío mirando: se va
    if (this.watching) this._stopWatching();
    // Su puesto: donde está, si ya queda a 8-10 m; si no, en la línea que lo une a la pelea, a esa distancia.
    const r = Math.min(REACT.far[1] - .3, Math.max(REACT.far[0] + .3, ds));
    let x = npc.position.x, z = npc.position.z, route = null, start = 0;
    if (Math.abs(r - ds) > .3) {
      x = scene.x + (npc.position.x - scene.x) / ds * r; z = scene.z + (npc.position.z - scene.z) / ds * r;
      if (!this._spotOk(x, z, scene)) return false;
      route = this._routeFor(x, z, scene, REACT.far[0] - .5, 30);
      if (!route) return false;
      start = this._routeStart;
    }
    mind.leaveTalk();
    scene.watchers++;
    this.watching = scene; this.watchFar = true; this._watchId = scene.id; this.watchSlot = -1;
    this.watchX = x; this.watchZ = z; this.ringX = scene.x; this.ringZ = scene.z; this.watchLeave = Infinity;
    if (route) { npc.route = route; npc.routeIndex = start; npc.target = route[start]; }
    else { npc.route = []; npc.routeIndex = 0; npc.target = null; }
    npc.wait = 0; npc.stance = null; npc.action = null;
    return true;
  }

  /**
   * Asustado en plena calzada no se queda ahí: sale al andén más cercano que no lo acerque al peligro (termina de
   * cruzar o se devuelve), apurado, y reacciona ya en el andén, en su siguiente turno. true mientras va saliendo.
   */
  _leaveRoad(tx, tz) {
    const npc = this.npc, nav = npc.navigation, p = npc.position;
    if (!nav?.nodeAt || !this._onRoadAt(p.x, p.z)) { this._exiting = false; return false; }
    if (this._exiting) return true;
    // Las salidas: el primer andén siguiendo la calzada hacia cada lado (un paso de cebra es una tira derecha).
    const id = nav.nodeAt(p.x, p.z), node = nav.nodes[id], T = nav.tileSize;
    const ax = tx - p.x, az = tz - p.z, ad = hypot(ax, az) || 1;
    let best = null, bestD = Infinity, away = null, awayD = -Infinity;
    for (const [dx, dz] of EXITS) {
      for (let k = 1; k <= 8; k++) {
        const other = nav.grid[node.z + dz * k]?.[node.x + dx * k] ?? -1;
        if (other < 0) break;
        if (nav.nodes[other].crossing) continue;
        const x = (node.x + dx * k) * T, z = (node.z + dz * k) * T, ex = x - p.x, ez = z - p.z, d = hypot(ex, ez) || 1;
        // No sirve la salida que va hacia el peligro; si todas van hacia él, la que más se aleja.
        if ((ex * ax + ez * az) / (d * ad) <= .2 && d < bestD) { best = [x, z]; bestD = d; }
        const from = hypot(x - tx, z - tz);
        if (from > awayD) { away = [x, z]; awayD = from; }
        break;
      }
    }
    const exit = best ?? away;
    if (!exit) return false;
    const point = p.clone ? p.clone() : { x: 0, y: p.y, z: 0 };
    point.x = exit[0]; point.z = exit[1];
    npc.route = [point]; npc.routeIndex = 0; npc.target = point; npc.wait = 0; npc.stance = null; npc.action = null;
    this._exiting = true;
    this._stopWatching();
    this.mind.leaveTalk();
    return true;
  }

  /** ¿Es calzada con tráfico el punto (x, z)? */
  _onRoadAt(x, z) {
    if (!this.npc.navigation?.nodeAt) return false;
    const point = this._point;
    point.x = x; point.z = z;
    return this.mind._onRoad(point);
  }

  /**
   * Huyendo de un peligro (la huida que empezó la mente o la del que le robaron): mira atrás cada tanto al principio;
   * mientras el peligro siga cerca sigue corriendo (hasta `fleeMax`), y pasados `safe` m sin verlo `unseen` s, para.
   */
  _flight(now, px, pz, yaw, range) {
    const npc = this.npc;
    if (this._fleeStart < 0) return;
    if (!(npc.fleeTimer > 0) || npc.koState) { this._fleeStart = -1; return; }
    const t = this.threat?.position, tx = t ? t.x : this.threatX, tz = t ? t.z : this.threatZ;
    const d = hypot(tx - px, tz - pz), running = now - this._fleeStart;
    // Lo ve al mirar atrás (o lo tiene encima): sabe dónde está.
    if (t && d < range && (now < this.lookBackUntil || canSee(px, pz, yaw, tx, tz, range))) {
      this.threatX = tx; this.threatZ = tz; this.threatAt = now;
    }
    if (running < REACT.lookBacks && now >= this._lookBackAt) {
      this.lookBackUntil = now + .5;
      this._lookBackAt = now + REACT.lookBack * (.85 + this.mind.random() * .3);
    }
    if (d >= REACT.safe && now - this.threatAt >= REACT.unseen) {
      npc.fleeTimer = Math.min(npc.fleeTimer, .05); // Npc la termina a su manera en el cuadro que sigue
      this._fleeStart = -1;
      return;
    }
    if (npc.fleeTimer < 1 && d < REACT.safe && running < REACT.fleeMax) npc.fleeTimer = 1;
  }

  /**
   * Hacia dónde da el paso atrás: alejándose del peligro, si en todo el trecho hay red y nada sólido; si no, en
   * diagonal o de lado, hacia donde quepa; si no cabe en ninguna, se queda donde está.
   */
  _backRoom(tx, tz) {
    const npc = this.npc, p = npc.position;
    let ax = p.x - tx, az = p.z - tz;
    const d = hypot(ax, az) || 1, length = REACT.backSpeed * REACT.back, flip = this.mind.id % 2 ? -1 : 1;
    ax /= d; az /= d;
    this.backX = 0; this.backZ = 0;
    for (let k = 0; k < BACK_TURNS.length; k++) {
      const turn = BACK_TURNS[k] * flip, c = Math.cos(turn), s = Math.sin(turn);
      const x = ax * c + az * s, z = az * c - ax * s;
      if (!pathClear(npc, p.x, p.z, x * length, z * length)) continue;
      if (this._onRoadAt(p.x + x * length, p.z + z * length)) continue; // nunca hacia atrás a la calzada
      this.backX = x; this.backZ = z;
      return;
    }
  }

  /**
   * ¿Ve al jugador del que se acuerda? Le sube la alerta (recelo; miedo si fue su víctima) y, la primera vez en un
   * rato, lo mira y la víctima lo dice. Devuelve cuánto le pesa lo que recuerda.
   */
  _recognize(now, px, pz, yaw, range) {
    const memory = this.memory, sys = this.system, player = sys.player, npc = this.npc;
    const grudge = memory.grudge(now);
    if (grudge < MEMORY.recognize || !player || !canSee(px, pz, yaw, player.x, player.z, range)) return grudge;
    // Con poco que recordar, curiosidad; con bastante, recelo (nunca miedo: eso es de la víctima). A la víctima, la
    // primera vez que lo ve en un rato, miedo: huye o, si es brava, le reclama. Después le queda el recelo.
    const first = now - memory.recognizedAt > 30, act = memory.victimOf(now, MEMORY.recognize);
    this.alarm = Math.max(this.alarm, act && first ? .75 : .15 + .5 * grudge);
    this.lastStimulus = now;
    this.threat = sys._playerAgent; this.threatX = player.x; this.threatZ = player.z; this.threatAt = now;
    if (first) {
      memory.recognizedAt = now;
      this.lookAt(player.x, player.z, 2);
      // El bravo se lo dice al plantarse; los demás, al verlo.
      if (act && this.mind.temper.stand < .5 && !(npc._bubbleTimer > 0)) npc.say(RECOGNIZE_PHRASES[act.tipo] ?? '¡Usted otra vez! ¡Aléjese!');
    }
    return grudge;
  }

  /** Lo cuenta al que tiene al lado, más flojo (memory.js). */
  _gossip(now) {
    const memory = this.memory, npc = this.npc, sys = this.system;
    if (now < this._gossipTry || now - memory.gossipAt < MEMORY.gossipEvery || npc.fleeTimer > 0 || npc.koState) return;
    if (memory.grudge(now) * MEMORY.hearsay < MEMORY.floor) return;
    this._gossipTry = now + 1;
    const grid = sys.grid, out = sys.neighbors, n = grid.query(npc.position.x, npc.position.z, MEMORY.gossipReach, out);
    for (let k = 0; k < n; k++) {
      const other = grid.agents[out[k]];
      if (other === npc || !other?.mind?.aware || other.koState || other.fleeTimer > 0) continue;
      if (hypot(other.position.x - npc.position.x, other.position.z - npc.position.z) > MEMORY.gossipReach) continue;
      if (!memory.tell(other.mind.aware.memory, now)) continue;
      if (this.mind.random() < .4 && !(npc._bubbleTimer > 0)) npc.say(GOSSIP_PHRASES[Math.floor(this.mind.random() * GOSSIP_PHRASES.length)]);
      return;
    }
  }

  _report(kind) {
    const npc = this.npc, sys = this.system, now = sys.time;
    if (now - this.reportAt < REACT.reportEvery || now - sys.reportAt < 5) return;
    this.reportAt = now; sys.reportAt = now;
    // La primera frase habla de un robo: solo para un robo.
    const first = kind === 'robo' ? 0 : 1;
    if (!(npc._bubbleTimer > 0)) npc.say(REPORT_PHRASES[first + Math.floor(this.mind.random() * (REPORT_PHRASES.length - first))]);
    // Nadie lo escucha todavía: es el punto de enganche para que la policía se entere (ver docs/peatones-inteligencia.md).
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('npc-police-report', { detail: { npc, tipo: kind, x: this.threatX, z: this.threatZ } }));
    }
  }

  /** Con recelo del jugador que tiene adelante y sin sitio para rodearlo a 3 m: otro camino (otro andén). */
  _wary(now) {
    const mind = this.mind, npc = this.npc, sys = this.system;
    if (this.level < 2 || this.threat !== sys._playerAgent || !sys.player || !npc.target || npc.fleeTimer > 0 || this.watching) return;
    if (now - this._waryAt < REACT.waryEvery || mind.crossing.state !== 0) return;
    const dx = sys.player.x - npc.position.x, dz = sys.player.z - npc.position.z, d = hypot(dx, dz);
    if (d > REACT.waryAhead || d < .5) return;
    const front = (dx * mind._segX + dz * mind._segZ) / d;
    if (front < .3) return;
    const lateral = Math.abs(-dx * mind._segZ + dz * mind._segX);
    if (lateral >= REACT.wary) return;
    const side = lateral > 0 && (-dx * mind._segZ + dz * mind._segX) > 0 ? -1 : 1; // al lado contrario del jugador
    if (mind.roomFor(mind.side + side * (REACT.wary - lateral))) return; // cabe rodearlo
    this._waryAt = now;
    mind.reroute = true; mind._rerouteFrom = sys._playerAgent;
  }

  /**
   * En su turno de pensar: lo que se le nota al cuerpo desde el turno anterior. Si le robaron y se dio cuenta, le cayó
   * popó o le pegaron, deja el estímulo. Va en el turno y no en cada cuadro: leer estos campos en peatones de muchas
   * formas crea un número nuevo en cada lectura, y lo que marcan dura más que un turno (la huida, 8 s; el golpe, 0,5 s).
   */
  watchBody() {
    const npc = this.npc, sys = this.system, x = npc.position.x, z = npc.position.z;
    const player = sys._playerAgent;
    const robbed = npc._robadoTimer ?? 0, flee = npc.fleeTimer ?? 0;
    // Le metieron la mano (steal.js le pone `_robadoTimer`) y lo pillaron: huye gritando, con la huida recién puesta.
    // Lo que el juego da por no visto («nadie se dio cuenta», «disimulé») no lo vio nadie: ni estímulo, ni grito, ni
    // recuerdo, ni para la víctima ni para los que estaban mirando.
    if (robbed > this._robbed + .01 && flee > 0 && (this._flee <= 0 || flee > this._flee + .01)) {
      sys.emit('robo', x, z, 0, 1, player);
      sys.emit('grito', x, z, 0, 1, npc);
      this.victim('robo', x, z);
    }
    this._robbed = robbed;
    this._flee = flee;
    if (npc.isSplatted && !this._splatted) {
      sys.emit('popo', x, z, 0, 1, player);
      sys.emit('grito', x, z, 0, 1, npc);
      this.victim('popo', x, z);
    }
    this._splatted = !!npc.isSplatted;
    const hit = !!npc.koState || (npc._hitReactionRemaining ?? 0) > 0;
    if (hit && !this._hit) {
      // Quién le pegó lo guarda Npc.takeHit (`hitBy`; null si fue un carro). Sin ese dato, el jugador si estaba encima.
      const by = npc.hitBy;
      const origin = by !== undefined ? (by?.position ? sys._agentFor(by) : null)
        : sys.player && hypot(sys.player.x - x, sys.player.z - z) < 3.5 ? player : null;
      sys.emit('golpe', x, z, 0, 1, origin);
      sys.emit('grito', x, z, 0, .8, npc);
      if (origin === player) this.victim('golpe', x, z);
    }
    this._hit = hit;
  }

  // --- Corrillo ---------------------------------------------------------------------------------------------

  _watchScene(now) {
    const npc = this.npc, sys = this.system, scene = this.watching, temper = this.mind.temper;
    if (scene) {
      const over = scene.id !== this._watchId || scene.until < now;
      // El que mira de paso: unos segundos (o hasta que se acabe) y sigue por donde iba.
      if (this.watchPass) {
        if (over || now >= this.watchLeave) { this._skipScene = this._watchId; this._stopWatching(); }
        return;
      }
      if (over) {
        // Se acabó. Quien todavía iba hacia su puesto ya no va. Los que miraban se van de a pocos: cada uno en su franja
        // según el orden en que llegó, con algo de azar; así no se van todos a la vez aunque el azar caiga parecido.
        this._tellNow();
        if (this.watchLeave === Infinity) {
          const share = ((this._watchRank % 4) + this.mind.random()) / 4;
          this.watchLeave = npc.target && !this.watchFar ? now : now + REACT.leave[0] + share * (REACT.leave[1] - REACT.leave[0]);
        }
        if (now >= this.watchLeave) this._stopWatching(true);
        return;
      }
      if (this.watchFar) return; // el miedoso lo mira `_watchFar`
      // El avisador mira un momento desde su puesto, avisa (si es algo de avisar) y sigue en lo suyo.
      if (temper.report >= .5 && !npc.target) {
        if (this._tellAt === Infinity) this._tellAt = now + REACT.tell[0] + this.mind.random() * (REACT.tell[1] - REACT.tell[0]);
        else if (now >= this._tellAt) {
          this._toTell = null;
          if (STIMULI[scene.kind]?.bad) this._report(scene.kind);
          this._skipScene = scene.id;
          this._stopWatching(true);
          return;
        }
      }
      // La pelea se corrió: busca otro puesto alrededor.
      if (hypot(scene.x - this.ringX, scene.z - this.ringZ) > 2.5) this._takeSpot(scene);
      return;
    }
    if (npc.fijo || npc.fleeTimer > 0 || this.reaction !== NONE) return this._tellNow();
    // El curioso, el bravo y el avisador van a mirar; el indiferente mira de paso; el miedoso, de lejos o se va (`_fear`).
    // Para ir hasta allá hay que haberse enterado; a quien le pasa a menos de `passBy` no le hace falta más.
    const passer = temper.watch <= 0 && temper.glance;
    if (temper.watch <= 0 && !passer || this.level < 1 && !passer) return this._tellNow();
    const near = sys.bus.sceneNear(npc.position.x, npc.position.z, passer ? REACT.passBy : REACT.watchReach, now);
    if (!near) return this._tellNow();
    // El indiferente que pasa cerca afloja el paso y voltea a mirar, se detenga o no, mientras no la haya dejado atrás.
    if (passer && Math.abs(wrap(Math.atan2(near.x - npc.position.x, near.z - npc.position.z) - (npc.root?.rotation.y ?? 0))) < REACT.gazeBehind) {
      this.slowUntil = now + 1.5; this._stareUntil = now + 1.5; this.lookAt(near.x, near.z, 1.5);
    }
    if (near.watchers >= REACT.watchers || near.id === this._skipScene) return this._tellNow();
    // A quien la pelea le queda encima no se arrima: retrocede (lo decide _fear). Quien mira desde afuera y la tiene
    // más cerca de lo que quisiera, sin llegar a asustarse, se retira hasta su distancia y mira desde ahí.
    const d = hypot(near.x - npc.position.x, near.z - npc.position.z);
    if (d <= temper.fearReach && !(this.level < 3 && this._watchesFromOutside())) return this._tellNow();
    // Se decide una vez por escena: el curioso casi siempre, del indiferente la mitad. Primero voltea la cabeza, se
    // queda un instante mirando y después arranca (o se detiene): cada uno a su tiempo.
    if (this._sceneSeen !== near.id) {
      this._sceneSeen = near.id; this._sceneTries = 0; this._sceneTryAt = 0;
      if (this.mind.random() >= (passer ? REACT.passStop : temper.watch)) { this._skipScene = near.id; return this._tellNow(); }
      this._sceneGo = Math.max(now, this.noticeAt) + REACT.hesitate[0] + this.mind.random() * (REACT.hesitate[1] - REACT.hesitate[0]);
    }
    if (now < this._sceneGo || now < this._sceneTryAt) return;
    // De paso: se detiene cuando su camino lo deja en el anillo de afuera, en un sitio que sirva; mientras, sigue.
    if (passer) { this._passBy(near, d); return; }
    if (this._takeSpot(near)) return;
    // No le alcanza lo que queda para llegar a ningún puesto. La pelea puede seguir: vuelve a mirar en un rato, unas
    // veces; después mira desde donde va.
    if (++this._sceneTries >= REACT.retries) { this._skipScene = near.id; this._tellNow(); }
    else this._sceneTryAt = now + REACT.retry;
  }

  /**
   * Un puesto para mirar `scene`. El curioso, en el arco de adentro (dos filas, a 4,4 y 5,5 m): el libre más cercano a
   * su lado que no quede pegado a otro ya ocupado, así el arco se llena repartido aunque todos lleguen por el mismo
   * lado. Quien no se arrima tanto (el bravo, el avisador), en el anillo de afuera, a la distancia a la que se siente
   * tranquilo: desde donde está si ya queda ahí, o en el punto más cercano de ese círculo. Siempre pisable, fuera de la
   * calzada, sin nada que le tape la pelea y con una ruta que no cruce la calle, no le pase por encima a la pelea y le
   * alcance para llegar con algo de pelea por ver. false si no hay ninguno.
   */
  _takeSpot(scene, elsewhere = false) {
    const npc = this.npc, nav = npc.navigation, now = this.system.time;
    if (!nav?.routeTo || !npc.position.clone) return false;
    const retake = this.watching === scene;
    const outer = this._watchesFromOutside();
    // Para buscar otro puesto (`elsewhere`) el suyo sigue tomado mientras elige; se suelta al cambiarse.
    if (retake && !elsewhere) this._releaseSlot(scene);
    const px = npc.position.x, pz = npc.position.z, from = Math.atan2(px - scene.x, pz - scene.z);
    const far = hypot(px - scene.x, pz - scene.z);
    if (outer && !retake && this._standHere(scene, far)) return true;
    // El plazo depende de la distancia: lo que alcanza a andar a paso vivo (con algo de margen por los que se le
    // atraviesan) en lo que le queda de pelea, dejando `watchLeft` para mirar, y nunca más de `arrive` desde que lo notó.
    const since = retake ? now : Math.min(now, Math.max(this.noticeAt, now - 1.5));
    const reachBy = ends => Math.max(0, Math.min(since + REACT.arrive, ends - REACT.watchLeft) - now - .6) * this._briskSpeed();
    // `wide`: lo que alcanzaría si esto resulta ser una pelea. Tras un golpe suelto no se conforma con un puesto peor
    // solo porque es el que le alcanza: espera a ver si sigue (vuelve a mirar en `retry`).
    const reach = reachBy(sceneEnds(scene)), wide = retake ? reach : reachBy(sceneEnds(scene, true));
    // Quien iba alejándose y ya la tiene lejos no se devuelve.
    if (!retake && far > REACT.turnBack && npc.target && this.mind._segX * (scene.x - px) + this.mind._segZ * (scene.z - pz) < 0) return false;
    const keepOff = Math.min(this.mind.temper.fearReach + .3, far - .1);
    const list = outer ? outerCandidates(scene, from, this._outerRadius()) : spotCandidates(scene, from);
    for (let k = 0, tries = 0; k < list.length && tries < 8; k++) {
      const c = list[k];
      if (hypot(c.x - px, c.z - pz) > wide || !this._spotOk(c.x, c.z, scene)) continue;
      tries++;
      const route = this._routeFor(c.x, c.z, scene, keepOff, wide, true);
      if (!route) continue;
      if (this._routeLength > reach) return false;
      if (retake && elsewhere) this._releaseSlot(scene);
      if (!this._hold(scene, c.row, c.slot, c.x, c.z)) return false;
      if (!retake) this._join(scene);
      const start = this._routeStart;
      npc.route = route; npc.routeIndex = start; npc.target = route[start]; npc.wait = 0; npc.stance = null; npc.action = null;
      return true;
    }
    if (retake) this._stopWatching(true);
    return false;
  }

  /** ¿Mira desde el anillo de afuera? Quien empieza a tenerle miedo a la pelea antes de llegar al arco de adentro. */
  _watchesFromOutside() { return this.mind.temper.fearReach > REACT.rows[0] - .3; }

  /** A qué distancia de la escena se para en el anillo de afuera: un poco más allá de su radio de miedo, de 6 a 9 m. */
  _outerRadius() { return Math.min(REACT.outer[1], Math.max(REACT.outer[0], this.mind.temper.fearReach + REACT.outerOff)); }

  /**
   * Mira desde donde está, si ya queda más allá de su radio de miedo y a no más de `passBy`, y el sitio sirve: andén,
   * con vista, sin nadie encima ni otro mirón pegado. true si se quedó.
   */
  _standHere(scene, far) {
    const npc = this.npc, x = npc.position.x, z = npc.position.z;
    if (far < Math.max(REACT.outer[0], this.mind.temper.fearReach + .3) || far > REACT.passBy || this.mind.crossing.state !== 0) return false;
    if (!this._spotOk(x, z, scene) || this._crowded(x, z) || spotTaken(scene, x, z, REACT.gap)) return false;
    if (!this._hold(scene, 2, -1, x, z)) return false;
    this._join(scene);
    npc.route = []; npc.routeIndex = 0; npc.target = null; npc.wait = 0; npc.stance = null; npc.action = null;
    return true;
  }

  /**
   * El indiferente, de paso: si por donde va queda a la distancia del anillo de afuera (de 6 m a `passBy`) y el sitio
   * sirve, se detiene ahí unos segundos a mirar y después sigue su camino (conserva su ruta). No busca puesto ni se
   * desvía. true si se detuvo.
   */
  _passBy(scene, far) {
    const npc = this.npc, x = npc.position.x, z = npc.position.z;
    if (far < REACT.outer[0] || far > REACT.passBy || this.mind.crossing.state !== 0 || !npc.target) return false;
    if (!this._spotOk(x, z, scene) || this._crowded(x, z) || spotTaken(scene, x, z, REACT.gap)) return false;
    if (!this._hold(scene, 2, -1, x, z)) return false;
    this._join(scene);
    this.watchPass = true;
    this.watchLeave = this.system.time + REACT.passLook[0] + this.mind.random() * (REACT.passLook[1] - REACT.passLook[0]);
    return true;
  }

  /** Toma el puesto (fila 0 o 1 del arco, con su casilla; 2 = anillo de afuera, donde sea). false si ya no hay. */
  _hold(scene, row, slot, x, z) {
    if (row === 2) {
      slot = 0;
      while (slot < OUTER && scene.outMask & (1 << slot)) slot++;
      if (slot === OUTER) return false;
      scene.outMask |= 1 << slot; scene.outX[slot] = x; scene.outZ[slot] = z;
    } else if (row === 0) scene.slots |= 1 << slot;
    else scene.slots2 |= 1 << slot;
    this.watching = scene; this._watchId = scene.id; this.watchSlot = slot; this.watchRow = row; this.watchFar = false; this.watchPass = false;
    this.watchX = x; this.watchZ = z; this.ringX = scene.x; this.ringZ = scene.z; this.watchLeave = Infinity;
    return true;
  }

  /** Entra a la cuenta de mirones de la escena: deja la charla y, a veces, lo comenta. */
  _join(scene) {
    const npc = this.npc;
    this._watchRank = scene.watchers;
    scene.watchers++;
    this._tellAt = Infinity;
    this.mind.leaveTalk();
    if (this.mind.random() < .3 && !(npc._bubbleTimer > 0)) npc.say(WATCH_PHRASES[Math.floor(this.mind.random() * WATCH_PHRASES.length)]);
  }

  /** ¿Tiene a alguien encima (a menos de `room`) en (x, z)? */
  _crowded(x, z) {
    const sys = this.system, npc = this.npc;
    const n = sys.grid ? sys.grid.query(x, z, REACT.room, sys.neighbors) : 0;
    for (let k = 0; k < n; k++) {
      const other = sys.grid.agents[sys.neighbors[k]];
      if (other && other !== npc && hypot(other.position.x - x, other.position.z - z) < REACT.room) return true;
    }
    return false;
  }

  /** ¿Sirve (x, z) para mirar `scene`? Red principal, andén y no calzada, sin nada sólido ni nada que tape la vista. */
  _spotOk(x, z, scene) {
    const npc = this.npc, nav = npc.navigation, id = nav.nodeAt(x, z);
    if (id < 0 || nav.nodes[id].crossing || !nav.nodes[id].main || !npc.isWalkable(x, z)) return false;
    const y = npc.position.y;
    return !solidAt(npc.collisions, x, y, z) && sightClear(npc.collisions, y, x, z, scene.x, scene.z);
  }

  /**
   * Ruta de la red hasta (x, z), derecha donde se pueda: de cada punto salta al más lejano que se alcanza en línea
   * recta sin salirse de la red ni pasar por algo sólido (las baldosas van en escuadra; la gente, no). Los cruces de
   * calle no se saltan: ahí sigue mirando el tráfico. null si es más larga que `reach` m o pasa a menos de `keepOff` m
   * de la escena; con `sameSide`, también si baja a la calzada (nadie cruza la calle para ir a mirar). Arranca por el
   * primer punto (`_routeStart` = 0).
   */
  _routeFor(x, z, scene, keepOff, reach, sameSide = false) {
    const npc = this.npc, p = npc.position, spot = p.clone();
    spot.x = x; spot.z = z;
    const full = npc.navigation.routeTo(p, spot);
    if (!full.length || full.length > 30) return null;
    const route = [];
    let ax = p.x, az = p.z, length = 0;
    for (let i = 0; i < full.length;) {
      let last = i;
      while (last < full.length - 1 && !this._onRoadAt(full[last].x, full[last].z)) last++;
      let j = last;
      while (j > i && !pathClear(npc, ax, az, full[j].x - ax, full[j].z - az)) j--;
      const q = full[j];
      length += hypot(q.x - ax, q.z - az);
      if (length > reach || segmentDistance(ax, az, q.x, q.z, scene.x, scene.z) < keepOff) return null;
      if (sameSide && this._onRoadAt(q.x, q.z)) return null;
      route.push(q);
      ax = q.x; az = q.z; i = j + 1;
    }
    this._routeStart = 0; this._routeLength = length;
    return route;
  }

  _releaseSlot(scene) {
    if (this.watchSlot < 0) return;
    if (this.watchRow === 0) scene.slots &= ~(1 << this.watchSlot);
    else if (this.watchRow === 1) scene.slots2 &= ~(1 << this.watchSlot);
    else scene.outMask &= ~(1 << this.watchSlot);
    this.watchSlot = -1;
  }

  _stopWatching(walkOn = false) {
    const scene = this.watching;
    if (!scene) return;
    if (scene.id === this._watchId) {
      this._releaseSlot(scene);
      scene.watchers = Math.max(0, scene.watchers - 1);
    }
    this.watching = null; this.watchSlot = -1; this.watchLeave = Infinity; this.watchFar = false; this.watchPass = false; this._tellAt = Infinity;
    if (walkOn) { const npc = this.npc; npc.target = null; npc.wait = .2 + this.mind.random() * .8; }
  }

  /** A qué paso va hacia el corrillo (m/s): vivo, y no menos de `briskSpeed`. */
  _briskSpeed() {
    const walk = Math.max(.5, this.npc.walkSpeed ?? 1);
    return walk * Math.max(REACT.brisk, REACT.briskSpeed / walk);
  }

  // --- Cada cuadro, antes de andar ------------------------------------------------------------------------

  /**
   * Cuánto de la velocidad de huida lleva (de 0 a 1): la huida de un peligro arranca andando y en `fleeRamp` ya corre.
   * Las demás huidas (la peste, el carro que se le viene) siguen de una.
   */
  fleePace() {
    if (this._fleeStart < 0) return 1;
    const k = Math.min(1, (this.system.time - this._fleeStart) / REACT.fleeRamp);
    return (1 + FLEE_RUN_GAIN * k) / (1 + FLEE_RUN_GAIN);
  }

  /** true si este cuadro no camina: retrocede, planta cara o mira desde el corrillo. */
  hold(dt) {
    const npc = this.npc, sys = this.system, now = sys.time;
    if ((this.reaction === BACK || this.reaction === STAND) && now < this.reactionAt) {
      // Lo acaba de notar: la cabeza ya mira (gaze); sigue andando hasta que el cuerpo se voltea y ahí se detiene.
      if (now < this._turnAt) return false;
      this._face(this.threatX - npc.position.x, this.threatZ - npc.position.z, dt);
      return true;
    }
    if (this.reaction === BACK) {
      // Retrocede unos pasos de cara al peligro, sin darle la espalda, por donde cupo; después sale corriendo.
      const dx = this.backX * REACT.backSpeed * dt, dz = this.backZ * REACT.backSpeed * dt;
      if ((dx || dz) && pathClear(npc, npc.position.x, npc.position.z, dx, dz)) { npc.position.x += dx; npc.position.z += dz; }
      this._face(this.threatX - npc.position.x, this.threatZ - npc.position.z, dt);
      if (now >= this.reactionUntil) {
        this.reaction = NONE;
        const p = this._point;
        p.x = this.threatX; p.y = npc.position.y; p.z = this.threatZ;
        npc._fleeFrom?.(p);
        if (npc.fleeTimer > 0) this._startFlight(now);
      }
      return true;
    }
    if (this.reaction === STAND) {
      const t = this.threat?.position;
      if (t) this._face(t.x - npc.position.x, t.z - npc.position.z, dt);
      if (now >= this.reactionUntil) this._calmDown();
      return true;
    }
    if (this.reaction === FLINCH) {
      // Sentado o en su sitio: lo mira (la cabeza, con `gaze`) y sigue en lo suyo, sin moverse de ahí.
      if (now >= this.reactionUntil) {
        if (this.mind.temper.stand >= .5 && this.threat === sys._playerAgent) this._calmDown();
        else this.reaction = NONE;
      }
      return false;
    }
    if (this._exiting && !this._onRoadAt(npc.position.x, npc.position.z)) this._exiting = false;
    if (this.watching) {
      if (this.watchPass) {
        // De paso: quieto donde iba, de cara a lo que pasa; su ruta sigue ahí para cuando arranque.
        npc.moving = false;
        this._face(this.watching.x - npc.position.x, this.watching.z - npc.position.z, dt);
        return true;
      }
      const dx = this.watchX - npc.position.x, dz = this.watchZ - npc.position.z, d = hypot(dx, dz);
      if (d < .6 || !npc.target) {
        // En su puesto: el último trecho hasta el punto exacto (al llegar corrido de lado por la esquiva) y quieto,
        // de cara a lo que pasa.
        npc.moving = false;
        if (d > .03 && d < 1.5) {
          const step = Math.min(d, (npc.walkSpeed ?? 1) * dt), sx = dx / d * step, sz = dz / d * step;
          if (pathClear(npc, npc.position.x, npc.position.z, sx, sz)) { npc.position.x += sx; npc.position.z += sz; npc.moving = true; }
        }
        npc.target = null; npc.wait = 1; npc.stance = null; npc.action = null;
        this._face(this.watching.x - npc.position.x, this.watching.z - npc.position.z, dt);
        return true;
      }
    }
    return false;
  }

  /** Ya le dijo lo suyo al jugador: sigue con recelo, sin volver a plantarse enseguida. */
  _calmDown() {
    this.reaction = NONE;
    this.alarm = Math.min(this.alarm, .5);
    this.level = levelFor(this.alarm, 2);
  }

  _face(dx, dz, dt) {
    const root = this.npc.root;
    if (!root || (Math.abs(dx) + Math.abs(dz)) < 1e-6) return;
    root.rotation.y += wrap(Math.atan2(dx, dz) - root.rotation.y) * Math.min(1, dt * 4);
  }

  /** Ritmo: mirando algo afloja el paso (no al cruzar la calle); hacia el corrillo y saliendo de la calzada, apura. */
  paceFactor() {
    if (this._exiting) return REACT.brisk;
    if (this.watching && !this.watchFar && !this.watchPass && this.npc.target) return this._briskSpeed() / Math.max(.5, this.npc.walkSpeed ?? 1);
    const now = this.system.time, looks = (this.level >= 1 && this.level < 3) || now < this._stareUntil;
    return looks && now < this.slowUntil && this.mind.crossing.state !== 2 ? REACT.slow : 1;
  }

  /** Mira una escena o va hacia ella, reacciona a un susto o va saliendo de la calzada. */
  busy() { return !!this.watching || this.reaction !== NONE || this._exiting; }

  /** ¿`target` es su puesto en el corrillo y ya lo tiene a menos de `lastLeg`? Ese último trecho lo va derecho. */
  arriving(target) {
    if (!this.watching || this.watchFar || target.x !== this.watchX || target.z !== this.watchZ) return false;
    return hypot(target.x - this.npc.position.x, target.z - this.npc.position.z) < REACT.lastLeg;
  }

  /**
   * Trabado camino a su puesto (alguien quieto en el camino): en vez de dar media vuelta, se queda a mirar donde está
   * si queda a 4-6 m, fuera de la calzada y sin nadie encima; si no, busca otro puesto; si no hay, sigue su camino.
   */
  unstick() {
    const npc = this.npc, scene = this.watching, x = npc.position.x, z = npc.position.z;
    const d = hypot(x - scene.x, z - scene.z);
    const lo = this.watchRow === 2 ? this.mind.temper.fearReach + .3 : REACT.ring[0], hi = this.watchRow === 2 ? REACT.outer[1] : REACT.ring[1];
    if (!this._crowded(x, z) && !this._onRoadAt(x, z) && (this.watchFar || (d >= lo && d <= hi))) {
      this.watchX = x; this.watchZ = z;
      if (this.watchRow === 2 && this.watchSlot >= 0) { scene.outX[this.watchSlot] = x; scene.outZ[this.watchSlot] = z; }
      npc.route = []; npc.routeIndex = 0; npc.target = null;
      return;
    }
    if (!this.watchFar && this._takeSpot(scene, true)) return;
    this._stopWatching(true);
  }

  /** Giro de cabeza (rad, respecto al cuerpo) para `look`; null si no tiene a qué mirar y ya volvió al frente. */
  gaze(stance) {
    const npc = this.npc, sys = this.system, now = sys.time;
    let want = null;
    if (npc.fleeTimer > 0 && now < this.lookBackUntil && !npc.koState) {
      // Huyendo mira atrás por encima del hombro: hasta donde da el cuello, del lado por donde viene el peligro.
      const angle = wrap(Math.atan2(this.threatX - npc.position.x, this.threatZ - npc.position.z) - (npc.root?.rotation.y ?? 0));
      want = Math.sign(angle || 1) * Math.min(REACT.gazeMax, Math.abs(angle));
    } else if (!(npc.koState || npc.fleeTimer > 0 || npc.action) && !NO_GAZE.has(stance)) {
      let tx = 0, tz = 0, has = true;
      const noticed = now >= this.noticeAt;
      if (this.watching && noticed) { tx = this.watching.x; tz = this.watching.z; }
      else if (this.reaction !== NONE) { tx = this.threatX; tz = this.threatZ; }
      else if (now < this.gazeUntil && noticed && (!this.mind.temper.glance || now < this._stareUntil || this._glancing(now))) { tx = this.gazeX; tz = this.gazeZ; }
      else if ((this.mind.crossing.state === 1 || (this.mind.crossing.hurry && this._glancing(now))) && this.mind.crossing.threat?.position) {
        // En el borde mira el carro (o el bus) que viene; apurado en la calzada, de a vistazos: también mira adelante.
        tx = this.mind.crossing.threat.position.x; tz = this.mind.crossing.threat.position.z;
      }
      else has = false;
      if (has) {
        const angle = wrap(Math.atan2(tx - npc.position.x, tz - npc.position.z) - (npc.root?.rotation.y ?? 0));
        want = Math.abs(angle) > REACT.gazeBehind ? 0 : Math.max(-REACT.gazeMax, Math.min(REACT.gazeMax, angle));
      }
    }
    // Desde quieta, o tras una pausa larga (no se animaba), arranca de a poco en vez de recuperar el tiempo de un salto.
    // Ya girando, lejos de la cámara Npc se anima cada 0,1 a 0,3 s: eso no es una pausa, y la cabeza va al mismo ritmo.
    let dt = now - this._gazeT;
    if (dt > .4 || (dt > .07 && Math.abs(this.gazeYaw) < .01 && Math.abs(this.gazeVel) < .05)) dt = 1 / 60;
    this._gazeT = now;
    if (want === null && Math.abs(this.gazeYaw) < .01 && Math.abs(this.gazeVel) < .05) { this.gazeYaw = 0; this.gazeVel = 0; return null; }
    // Resorte críticamente amortiguado, en pasos cortos: llega suave y no se pasa.
    const w = REACT.gazeRate, target = want ?? 0;
    for (; dt > 1e-4; dt -= 1 / 60) {
      const h = Math.min(dt, 1 / 60);
      this.gazeVel += (w * w * (target - this.gazeYaw) - 2 * w * this.gazeVel) * h;
      this.gazeYaw += this.gazeVel * h;
    }
    return this.gazeYaw;
  }

  /** ¿Le toca un vistazo al carro? Cada uno con su compás, para que no volteen todos a la vez. */
  _glancing(now) {
    const [look, every] = REACT.glance;
    return (now + this.mind.id * .61) % every < look;
  }

  // --- Huir con cabeza ------------------------------------------------------------------------------------

  /** Al empezar a huir (o al tener que cambiar de rumbo): una ruta lejos de la amenaza. false si no hay. */
  fleeSmart() {
    const npc = this.npc, sys = this.system, now = sys.time, nav = npc.navigation;
    if (!nav?.nodes || now < this._fleeRetry || (npc.fijo && npc.fleeTimer <= 3)) return false;
    let tx, tz;
    if (now - this.threatAt < REACT.threatFresh) {
      const t = this.threat?.position;
      tx = t ? t.x : this.threatX; tz = t ? t.z : this.threatZ;
    } else if (sys.player && npc._playerDist < 12) { tx = sys.player.x; tz = sys.player.z; }
    else { tx = npc.position.x - (npc._fleeAwayX ?? 0) * 4; tz = npc.position.z - (npc._fleeAwayZ ?? 0) * 4; }
    const planner = sys.planner(nav);
    const goal = planner.plan(npc.position.x, npc.position.z, tx, tz, this._bonus);
    if (goal < 0) { this._fleeRetry = now + 1; return false; }
    const route = planner.route(goal);
    npc.route = route;
    npc.routeIndex = route.length > 1 && hypot(route[0].x - npc.position.x, route[0].z - npc.position.z) < 1.1 ? 1 : 0;
    npc.target = route[npc.routeIndex];
    npc._fleeRouted = true;
    this.threatX = tx; this.threatZ = tz;
    return true;
  }

  /** Puntos por lo que hay donde termina la huida: gente alrededor y una patrulla cerca. */
  _fleeBonus(x, z) {
    const sys = this.system, grid = sys.grid, out = sys.neighbors;
    let bonus = 0, people = 0;
    const n = grid.query(x, z, 6, out);
    for (let k = 0; k < n && people < 4; k++) {
      const agent = grid.agents[out[k]];
      if (agent !== this.npc && agent !== this.threat && agent?.mind) people++;
    }
    bonus += people * 1.2;
    const vehicles = sys.vehicles ?? [];
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v?.police || !v.car?.position) continue;
      if (hypot(v.car.position.x - x, v.car.position.z - z) < 25) { bonus += 6; break; }
    }
    return bonus;
  }

  /** Huyendo, si la amenaza se le pone adelante y cerca, cambia de rumbo. */
  _replanFlight(now) {
    const npc = this.npc, t = this.threat?.position;
    if (!(npc.fleeTimer > 0) || !npc._fleeRouted || !t || now < this._replanAt) return;
    const dx = t.x - npc.position.x, dz = t.z - npc.position.z;
    if (hypot(dx, dz) > 5 || dx * npc.fleeDir.x + dz * npc.fleeDir.z <= 0) return;
    this._replanAt = now + REACT.replan;
    this.threatX = t.x; this.threatZ = t.z; this.threatAt = now;
    npc._endFleeRoute?.();
  }
}

/**
 * Los puestos libres del arco de adentro de `scene`, de menos a más costo para quien llega desde el ángulo `from`: lo
 * que camina por el arco desde su lado, más si es la fila de atrás, mucho más si queda pegado a otro mirón (así se
 * reparten por el arco en vez de amontonarse por donde llegaron), y en la fila de atrás, más si queda justo detrás de
 * alguien de la primera (que le tapa).
 */
function spotCandidates(scene, from) {
  const list = [], taken = [];
  for (let row = 0; row < 2; row++) {
    const mask = row === 0 ? scene.slots : scene.slots2, n = ROW_SLOTS[row], step = 2 * Math.PI / n;
    for (let k = 0; k < n; k++) if (mask & (1 << k)) taken.push(row, k * step);
  }
  for (let row = 0; row < 2; row++) {
    const mask = row === 0 ? scene.slots : scene.slots2, n = ROW_SLOTS[row], step = 2 * Math.PI / n, r = REACT.rows[row];
    for (let k = 0; k < n; k++) {
      if (mask & (1 << k)) continue;
      const angle = k * step, x = scene.x + Math.sin(angle) * r, z = scene.z + Math.cos(angle) * r;
      let next = outerTaken(scene, x, z, REACT.gap * 1.2), behind = false;
      for (let i = 0; i < taken.length; i += 2) {
        const tr = REACT.rows[taken[i]], ta = taken[i + 1];
        if (hypot(scene.x + Math.sin(ta) * tr - x, scene.z + Math.cos(ta) * tr - z) <= REACT.gap * 1.2) next = true;
        if (row === 1 && taken[i] === 0 && Math.abs(wrap(ta - angle)) < step * .4) behind = true;
      }
      const cost = Math.abs(wrap(angle - from)) * r + row * REACT.backRow + (next ? REACT.crowd : 0) + (behind ? 2 : 0);
      list.push({ row, slot: k, x, z, cost });
    }
  }
  return list.sort((a, b) => a.cost - b.cost);
}

/**
 * Los puestos del anillo de afuera de `scene`, a `r` m: del más cercano a su lado (`from`) hacia los dos lados, cada
 * `spread` m de arco, hasta un cuarto de vuelta; sin los que quedan pegados a otro mirón.
 */
function outerCandidates(scene, from, r) {
  const list = [], step = REACT.spread / r;
  for (let k = 0; k * step <= Math.PI / 2; k++) {
    for (let sign = 1; sign >= (k ? -1 : 1); sign -= 2) {
      const angle = from + sign * k * step, x = scene.x + Math.sin(angle) * r, z = scene.z + Math.cos(angle) * r;
      if (!spotTaken(scene, x, z, REACT.gap * 1.2)) list.push({ row: 2, slot: -1, x, z, cost: k });
    }
  }
  return list;
}

/** ¿Hay un mirón del anillo de afuera a menos de `within` m de (x, z)? */
function outerTaken(scene, x, z, within) {
  for (let k = 0; k < OUTER; k++) if (scene.outMask & (1 << k) && hypot(scene.outX[k] - x, scene.outZ[k] - z) < within) return true;
  return false;
}

/** ¿Hay un puesto tomado, del arco de adentro o del anillo de afuera, a menos de `within` m de (x, z)? */
function spotTaken(scene, x, z, within) {
  if (outerTaken(scene, x, z, within)) return true;
  for (let row = 0; row < 2; row++) {
    const mask = row === 0 ? scene.slots : scene.slots2, n = ROW_SLOTS[row], step = 2 * Math.PI / n, r = REACT.rows[row];
    for (let k = 0; k < n; k++) if (mask & (1 << k) && hypot(scene.x + Math.sin(k * step) * r - x, scene.z + Math.cos(k * step) * r - z) < within) return true;
  }
  return false;
}

/**
 * Hasta cuándo se cuenta con que dure `scene`. Una pelea que ya lleva más de un golpe suele durar `fight` desde que
 * empezó; lo demás (un golpe suelto, un choque, un arresto), lo que diga la escena. Con `goesOn`: si el golpe suelto
 * resulta ser una pelea.
 */
function sceneEnds(scene, goesOn = false) {
  const fight = (scene.kind === 'pelea' || scene.kind === 'golpe') && (goesOn || scene.hits >= 2);
  return fight ? Math.max(scene.until, scene.born + REACT.fight) : scene.until;
}

/** Distancia de (cx, cz) al trecho de (ax, az) a (bx, bz). */
function segmentDistance(ax, az, bx, bz, cx, cz) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / len2)) : 0;
  return hypot(ax + dx * t - cx, az + dz * t - cz);
}

/** El planificador de huidas de una red (uno por distrito: comparte los arreglos). */
export function plannerFor(cache, nav) {
  if (cache.nav !== nav) { cache.nav = nav; cache.planner = new FlightPlanner(nav); }
  return cache.planner;
}
