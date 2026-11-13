// src/systems/PoliceFootSystem.js
// Patrullas cuyos agentes se bajan. La patrulla en persecución que tiene al jugador cerca y a la vista, o que se traba sin
// poder acercarse, frena del todo (orillándose si hay dónde) y sus agentes se bajan y lo persiguen a pie: la captura la
// hace un agente que lo alcanza, nunca el carro. Si lo pierden de vista lo buscan donde lo vieron, vuelven caminando,
// se suben y la patrulla sigue su ronda. Cada patrulla lleva su tripulación en `vehicle.crew`: TrafficSystem le pregunta
// cómo mover el carro mientras dura la persecución (`planCar`) y la sube de una al terminar (`recall`).
import * as THREE from 'three';
import { PoliceOfficer, POLICE_FOOT } from '../entities/PoliceOfficer.js';
import { PatrolCar } from '../entities/patrolCar.js';
import { hasClearCombatLine } from './CombatGeometry.js';
import { POLICE_CATCH_RANGE, POLICE_GIVE_UP_RANGE } from '../utils/constants.js';

const BRAKE_STOP = 6;          // m/s²: lo último para quedar quieto del todo
const CHASE_PAD = POLICE_CATCH_RANGE * .35; // lo que TrafficSystem._applyChase deja sin recorrer antes del objetivo
const HEIGHT_TOLERANCE = .85;
const PROBE_EVERY = .25;       // s entre pruebas de si el carro llega hasta el jugador
const CUT_OFF_EVERY = 1;       // s entre decisiones de volver al volante
const CUT_OFF_FROM = 14;       // m: más cerca no vale la pena arrancar
const CUT_OFF_RETRY = 4;       // s de espera después de trabarse cerrándole el paso
const CUT_OFF_PARTNER_FAR = 20; // m: el compañero viene tan atrás que el conductor tiene que bajarse
const CUT_OFF_CATCH = 1.5;     // s con el jugador al alcance del carro antes de bajarse
const RELOCATE_EVERY = 2;      // s entre una mirada y otra a si la patrulla parada tapa un carril o un cruce
const RELOCATE_CLEAR = 6;      // m del carro a los que tiene que ir el compañero para que el conductor la corra
const RELOCATE_MAX = 2;        // veces por persecución
const RELOCATE_BUS_MAX = 5;    // veces por persecución, si lo que tapa es el corredor del bus
const RELOCATE_NEAR = 3.5;     // m: con alguien así de cerca del carro no se corre
const PICKUP_FROM = 6;         // m: más cerca, el agente que no logra volver llega solo
const PICKUP_GAP = 3.2;        // m: el carro que lo recoge para a esto de él
const PICKUP_SPEED = 4;        // m/s
const PICKUP_TIME = 8;         // s para llegar; después frena donde esté
const EXIT_TIME = { 1: 1.4, 2: .95 }; // s de la bajada: con fichado 2 o más, de afán
const DRIVER_DELAY = .4;       // s después del compañero se baja el conductor
const ESCAPE_NOTICE = .3;      // s después de desistir: el HUD repinta la placa a 10 Hz y bota la información que llega en plena persecución
const REINFORCE_RANGE = 120;   // m: la patrulla de refuerzo tiene que estar a esta distancia
const REINFORCE_TIME = 25;     // s que el refuerzo insiste aunque venga de lejos
const LANE_STEP = 1.5, LANE_CELL = 4;
const LANE_STRIDE = 6;         // x, y, z, medio ancho y rumbo (x, z) de cada muestra de carril
const LANE_HALF = 1.1;          // m: medio ancho de un carro que pasa por el carril, con margen
const LANE_HEIGHT = 2;         // m: una muestra más arriba o más abajo es otro piso (la rampa del bus, la calle de abajo)
const BUS_MARGIN = .35;
const BUS_HALF = LANE_HALF + .01; // las muestras más anchas que un carril son del corredor del bus
const BUS_WEIGHT = 8;          // por muestra del corredor del bus bajo una parada: pesa más que un carril de carros
const CUT_WEIGHT = 40;         // por sentido de la calle que queda cortado del todo: mucho más que tapar un carril con otro libre
const CUT_REACH = 10;          // m alrededor de la parada donde se miran los carriles de cada sentido
const CUT_SECTION = 6;         // m a lo largo de cada carril: la sección de la calle a la altura del carro
const HEADING_STEP = Math.PI / 4; // los carriles de un mismo sentido van con el rumbo redondeado a esto
const ALIGN_REACH = 4;         // m: el carril más cercano a esta distancia da el eje con el que queda parada
const ALIGN_TURN = .8;         // rad: más que esto entre ese eje y el rumbo con que llega, es la calle que cruza: no se endereza
const ALIGN_SWERVE = .9;       // rad: más que esto de coleteo para quedar derecha, no se endereza
const ALIGN_LEAD = 1.5;        // m del último tramo, derecho por el eje
const PATH_SAMPLES = 16;       // puntos de la curva hasta la parada
const PATH_LOOK = .8;          // m del camino adelante del punto más cercano al que apunta
const HELD_EVERY = .5;         // s entre una mirada y otra a si tiene a alguien retenido detrás
const HELD_RANGE = 14;         // m: los carros que se miran
const HELD_AHEAD = 10;         // m de la ruta de cada carro, adelante, en que la patrulla lo retiene
const HELD_LIMIT = 8;          // s con un carro retenido: la patrulla se corre ya, o desisten y se van
const CUT_LIMIT = 8;           // s con un sentido de la calle cortado del todo, aunque no venga nadie: lo mismo
const STAND_REACH = 6;         // m hasta el andén desde donde queda parado quien se baja
const VIEW_DISTANCE = 90;
const SPACING = .7;            // m entre dos agentes a pie
const PULL_OVER = [3.4, 2.8, 2.2, 1.6, .8, 0]; // m de lado que prueba para orillarse

function emit(type, detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(typeof CustomEvent !== 'undefined' ? new CustomEvent(type, { detail }) : Object.assign(new Event(type), { detail }));
  } catch {}
}
const toast = (text, type = 'info') => emit('toast', { text, type });
const byScore = (a, b) => a.score - b.score || a.order - b.order;

const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
const _matrix = new THREE.Matrix4();
const _target = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _stand = new THREE.Vector3();
const _doorAt = new THREE.Vector3();
const _pick = new THREE.Vector3();
const _node = new THREE.Vector3();
const _door = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _curve = { x: 0, z: 0, tx: 0, tz: 0 };

/**
 * Punto y tangente de la curva con que la patrulla llega a su parada: sale de (sx, sz) con su rumbo (fx, fz) y llega a
 * (ex, ez) con el eje del carril (ax, az). Bézier cúbica con los puntos de control a un tercio de la distancia. La curva
 * termina `ALIGN_LEAD` m antes de la parada (ver `leadOf`): de ahí en adelante va derecho por el eje.
 */
function curveAt(u, sx, sz, fx, fz, ex, ez, ax, az, out = _curve) {
  const k = Math.hypot(ex - sx, ez - sz) / 3;
  const x1 = sx + fx * k, z1 = sz + fz * k, x2 = ex - ax * k, z2 = ez - az * k, v = 1 - u;
  out.x = v * v * v * sx + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * ex;
  out.z = v * v * v * sz + 3 * v * v * u * z1 + 3 * v * u * u * z2 + u * u * u * ez;
  out.tx = 3 * v * v * (x1 - sx) + 6 * v * u * (x2 - x1) + 3 * u * u * (ex - x2);
  out.tz = 3 * v * v * (z1 - sz) + 6 * v * u * (z2 - z1) + 3 * u * u * (ez - z2);
  return out;
}

/** Cuánto antes de la parada termina la curva: `ALIGN_LEAD` m, o menos si la parada está muy cerca. */
const leadOf = (sx, sz, ex, ez) => Math.min(ALIGN_LEAD, Math.hypot(ex - sx, ez - sz) / 3);

/** Una patrulla con sus dos agentes: el conductor y el acompañante. */
class PatrolUnit {
  constructor(system, vehicle, index) {
    this.system = system;
    this.vehicle = vehicle;
    this.fit = new PatrolCar(vehicle.car, system.random);
    this.driver = system._createOfficer('conductor', index * 2);
    this.partner = system._createOfficer('acompanante', index * 2 + 1);
    this.officers = [this.partner, this.driver];
    // Si los dos corren, el conductor abre por un flanco.
    this.driver.flank = index % 2 ? -1 : 1;
    for (const officer of this.officers) officer.onHit = (who) => this._officerHit(who);
    this.mode = 'ronda';      // ronda | persigue | desiste
    this.phase = 'ronda';     // ronda | carro | frenando | parada | cierre
    this.level = 0;
    this.seen = false;        // lo ve esta patrulla (su carro o sus agentes); lo de toda la persecución es `anyoneSees`
    this.carSees = false;
    this.carDistance = Infinity;
    this.endReason = null;    // por qué desistieron: perdido | lejos | sin-avance | inalcanzable | tope | estorbo | trabada
    this.stopTarget = new THREE.Vector3();
    this.stopAxis = new THREE.Vector3();   // con qué eje queda parada (ver `_chooseStop`); en cero, como llegue
    this._brakeFrom = new THREE.Vector3(); // dónde y con qué rumbo empezó a frenar: el arranque de la curva hasta la parada
    this._brakeDir = new THREE.Vector3();
    this._relocateTo = new THREE.Vector3();
    this._relocateAxis = new THREE.Vector3();
    this._held = new Map();                // carros retenidos detrás de la patrulla quieta y desde hace cuánto
    this._path = [];                       // el camino hasta una parada con eje (ver `_buildPath`)
    this._doorOk = { [-1]: true, [1]: true };
    this._doorFree = { [-1]: true, [1]: true };
    this.reinforcing = false;
    this.dead = false;
    this._reset();
  }

  /** Lo que sabe toda la persecución, por radio: si alguna patrulla lo ve, cuánto lleva nadie viéndolo y dónde lo vieron. */
  get anyoneSees() { return this.system.seen; }
  get unseen() { return this.system.unseen; }
  get lastSeen() { return this.system.lastSeen; }

  /** ¿Está persiguiendo (o volviendo) y su carro sigue en persecución? */
  get watching() { return this.mode !== 'ronda' && this.vehicle.state === 'chase' && !this.dead; }

  _reset() {
    this._clock = 0;
    this._gapBest = Infinity;
    this._gapClock = 0;
    this._stalled = 0;
    this._pickup = 0;
    this._pickedUp = false;
    this._pickupWait = false;
    this._driverDelay = 0;
    this._parkedOnBus = false;
    this._brakeClock = 0;
    this._bestDistance = Infinity;
    this._stuckClock = 0;
    this._unreachable = 0;
    this._reachable = true;
    this._probeTimer = 0;
    this._cutOffTimer = CUT_OFF_EVERY;
    this._dismountPending = false;
    this._forceDriver = false;
    this._escort = 0;
    this._relocateTimer = RELOCATE_EVERY;
    this._relocating = false;
    this._relocations = 0;
    this._backToCar = false;
    this._playerCarStill = 0;
    this._toldDismount = false;
    this._reinforceClock = 0;
    this._clearHeld();
  }

  /** Ya no está quieta (o empieza otra persecución): nadie retenido. */
  _clearHeld() {
    this._held.clear();
    this._heldTimer = 0;
    this._moveNow = false;   // alguien lleva `HELD_LIMIT` s retenido, o un sentido cortado: se corre ya, o se van
    this._holding = false;   // de esos, alguien retenido
    this._cutFor = 0;        // s con un sentido de la calle cortado del todo
    this._cannotMove = false; // y no hubo a dónde correrla
  }

  /** Para TrafficSystem: mientras no desista, la patrulla sigue en persecución (también antes de su primer cuadro). */
  get pursuing() { return this.mode !== 'desiste'; }

  /** A pie cuenta el agente más cercano; con todos adentro, el carro. */
  get pursuitDistance() {
    let best = Infinity;
    for (const officer of this.officers) {
      if (officer.state === 'persecucion' || officer.state === 'busqueda') best = Math.min(best, officer.distance);
    }
    if (best === Infinity && this.mode === 'persigue') best = this.carDistance;
    return Number.isFinite(best) ? best : undefined;
  }

  /** ¿Lo más cerca que lo tiene esta patrulla es un agente a pie? (el HUD dice «Agente a X m» en vez de «Patrulla»). */
  get pursuitOnFoot() { return this.officers.some(officer => officer.state === 'persecucion' || officer.state === 'busqueda'); }

  get anyoneOut() { return this.officers.some(officer => officer.out); }

  // ---------- el carro (lo llama TrafficSystem en cada subpaso) ----------

  planCar(vehicle, stepTime, player, traffic) {
    if (!player || this.dead) return false;
    if (this.mode === 'ronda') this._begin(traffic);
    if (this.phase === 'carro') return this._drive(vehicle, stepTime, player, traffic);
    if (this.phase === 'cierre') return this._cutOff(vehicle, stepTime, player, traffic);
    if (this.phase === 'frenando') return this._brake(vehicle, stepTime);
    return this._park(vehicle, stepTime);
  }

  _begin(traffic) {
    // La primera patrulla que arranca abre una persecución nueva (su vista y su aviso); el refuerzo se suma a la que va.
    if (!this.system.units.some(unit => unit !== this && unit.mode === 'persigue')) {
      this.system._newPursuit(this.system.player?.position ?? this.vehicle.car.position);
    }
    this.mode = 'persigue';
    this.phase = 'carro';
    this.level = traffic.wantedLevel ?? 0;
    this.endReason = null;
    this.vehicle._lostSightTime = 0;
    this._reset();
    for (const officer of this.officers) officer.setArmed(this.level >= 3);
    if (this.level >= 3) this.system._reinforce(this);
  }

  _carTarget(player) {
    return this.system.playerVehicle?.position ?? player;
  }

  /** Persecución en carro, como siempre, salvo que no captura: frena para que se bajen. */
  _drive(vehicle, stepTime, player, traffic) {
    const target = this._carTarget(player), car = vehicle.car;
    const distance = Math.hypot(target.x - car.position.x, target.z - car.position.z);
    // El refuerzo viene de lejos: mientras insiste, apunta en la misma dirección pero dentro de los 55 m, para que el
    // tráfico no lo dé por perdido por distancia.
    let aim = target;
    if (this.reinforcing && this._reinforceClock <= REINFORCE_TIME && distance > POLICE_GIVE_UP_RANGE - 1) {
      const k = (POLICE_GIVE_UP_RANGE - 1) / distance;
      aim = _aim.set(car.position.x + (target.x - car.position.x) * k, target.y, car.position.z + (target.z - car.position.z) * k);
    }
    // Los relojes de abandono (40 s, y los 6 s de #84) cuentan lo que nadie de la persecución lo ha visto.
    vehicle.chaseTime = this.unseen;
    if (this.anyoneSees) vehicle._lostSightTime = 0;
    traffic._planChase(vehicle, stepTime, aim, false);
    vehicle._chaseCaught = false;
    if (vehicle._chaseGiveUp) {
      this._carGaveUp(traffic);
      return true;
    }
    this._standoff(vehicle, stepTime, distance, POLICE_FOOT.standoff);
    if (distance < this._bestDistance - POLICE_FOOT.stuckProgress) {
      this._bestDistance = distance;
      this._stuckClock = 0;
    } else this._stuckClock += stepTime;
    const playerCar = this.system.playerVehicle;
    if (playerCar) {
      // Con el jugador en un carro sigue en carro; cuando ese carro se queda quieto, van a su puerta.
      this._playerCarStill = (playerCar.speed ?? 0) < .3 ? this._playerCarStill + stepTime : 0;
      if (this._playerCarStill >= 1 && distance <= 14) this._startBrake(vehicle, traffic);
    } else if (distance <= POLICE_FOOT.dismountRange && this.carSees) this._startBrake(vehicle, traffic);
    else if (this._stuckClock >= POLICE_FOOT.stuckTime && distance <= POLICE_FOOT.stuckReach) this._startBrake(vehicle, traffic);
    else if (this._stuckClock >= POLICE_FOOT.stuckGiveUp && !this.reinforcing) {
      vehicle._chaseGiveUp = true;
      vehicle.nextSpeed = 0;
      this.endReason = 'trabada';
      this._carGaveUp(traffic);
    }
    return true;
  }

  /**
   * El carro se devuelve a su ronda (TrafficSystem._applyChase avisa el escape si era la última que perseguía): que no
   * salga otro aviso de esta misma persecución.
   */
  _carGaveUp(traffic) {
    this.endReason ??= 'perdido';
    if (!traffic.vehicles.some(other => other !== this.vehicle && traffic._pursuing(other))) this.system._escapeHandled();
  }

  /** El conductor sigue al volante tratando de cerrarle el paso, sin echársele encima. */
  _cutOff(vehicle, stepTime, player, traffic) {
    vehicle.chaseTime = this.unseen;
    if (this.anyoneSees) vehicle._lostSightTime = 0;
    traffic._planChase(vehicle, stepTime, player, false);
    vehicle._chaseCaught = false;
    if (vehicle._chaseGiveUp) {
      // Se fue lejos o nadie lo ve: el carro no se devuelve con el compañero a pie. Frena y lo espera; desistir lo deciden ellos.
      vehicle._chaseGiveUp = false;
      this._cutOffTimer = CUT_OFF_RETRY;
      this._startBrake(vehicle, traffic);
      return true;
    }
    const distance = vehicle._chaseDist ?? 0;
    this._standoff(vehicle, stepTime, distance, POLICE_FOOT.cutOffStandoff, POLICE_FOOT.cutOffSpeed);
    // Su compañero a pie va adelante: frena antes que llevárselo.
    if (this._officerAhead(vehicle)) vehicle.nextSpeed = Math.max(0, vehicle.speed - BRAKE_STOP * stepTime);
    // Trabada: quiere andar y no avanza. Que el jugador corra casi igual de rápido no es estar trabada.
    if (vehicle.nextSpeed > .5 && vehicle.speed < .3) this._stuckClock += stepTime;
    else this._stuckClock = 0;
    if (this._stuckClock >= POLICE_FOOT.stuckTime) {
      this._cutOffTimer = CUT_OFF_RETRY;
      this._startBrake(vehicle, traffic);
    }
    return true;
  }

  _officerAhead(vehicle) {
    const car = vehicle.car, yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw);
    return this.officers.some(officer => {
      if (!officer.onFoot) return false;
      const dx = officer.position.x - car.position.x, dz = officer.position.z - car.position.z;
      const ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
      return ahead > 0 && ahead < car.length / 2 + 3.5 && side < car.width / 2 + .8;
    });
  }

  _standoff(vehicle, stepTime, distance, standoff, maxSpeed = Infinity) {
    const cap = Math.min(maxSpeed, Math.sqrt(2 * POLICE_FOOT.brake * Math.max(0, distance - standoff)));
    if (vehicle.nextSpeed > cap) vehicle.nextSpeed = Math.max(cap, vehicle.speed - POLICE_FOOT.brake * stepTime, 0);
  }

  /** Busca dónde orillarse y empieza a frenar. Nadie se baja de un carro andando. */
  _startBrake(vehicle, traffic) {
    this.system._chooseStop(vehicle, traffic, this.stopTarget, { axis: this.stopAxis });
    this._goStop();
  }

  /** Arranca hacia `stopTarget` (con `stopAxis`, si lo hay) y frena ahí. */
  _goStop() {
    const vehicle = this.vehicle, car = vehicle.car, yaw = car.group.rotation.y;
    this.phase = 'frenando';
    this._brakeClock = 0;
    this._brakeFrom.copy(car.position);
    this._brakeDir.set(Math.cos(yaw), 0, -Math.sin(yaw));
    vehicle._chaseSteerTime = 0;
    if (this.stopAxis.lengthSq() > 0) this._buildPath();
  }

  /**
   * El camino hasta la parada con eje, como puntos (x, z): la curva de `curveAt` desde donde empezó a frenar, el último
   * tramo derecho por el eje y la prolongación del eje más allá, para que al final siga apuntando por la línea.
   */
  _buildPath() {
    const axis = this.stopAxis, end = this.stopTarget, from = this._brakeFrom, heading = this._brakeDir, path = this._path;
    const lead = leadOf(from.x, from.z, end.x, end.z), lx = end.x - axis.x * lead, lz = end.z - axis.z * lead;
    path.length = 0;
    for (let i = 0; i <= PATH_SAMPLES; i++) {
      const point = curveAt(i / PATH_SAMPLES, from.x, from.z, heading.x, heading.z, lx, lz, axis.x, axis.z);
      path.push(point.x, point.z);
    }
    path.push(end.x, end.z, end.x + axis.x * 4, end.z + axis.z * 4);
  }

  _brake(vehicle, stepTime) {
    this._brakeClock += stepTime;
    const car = vehicle.car;
    let dx = this.stopTarget.x - car.position.x, dz = this.stopTarget.z - car.position.z;
    let distance = Math.hypot(dx, dz);
    // Junto a un carril llega por la curva que la deja derecha, con su eje (ver `_buildPath`); si ya pasó la parada a lo
    // largo del eje, llegó: no se devuelve a corregir de lado.
    const axis = this.stopAxis, along = axis.lengthSq() > 0 ? dx * axis.x + dz * axis.z : null;
    let next;
    if (this._brakeClock > (this._pickup ? PICKUP_TIME : POLICE_FOOT.brakeTimeout) || distance < .15 || (along !== null && along < .05)) {
      // No llegó al punto de parada (o ya está): frena donde va, derecho.
      const yaw = car.group.rotation.y, left = vehicle.speed * vehicle.speed / (2 * BRAKE_STOP);
      dx = Math.cos(yaw) * left; dz = -Math.sin(yaw) * left; distance = left;
      next = Math.max(0, vehicle.speed - BRAKE_STOP * stepTime);
    } else {
      if (along !== null) {
        this._alongPath(car, _aim);
        dx = _aim.x * distance; dz = _aim.z * distance;
      }
      next = Math.min(vehicle.speed + 1.5 * stepTime, Math.sqrt(2 * POLICE_FOOT.brake * Math.max(0, distance - .1)));
      if (this._pickup) next = Math.min(next, PICKUP_SPEED);
      next = Math.max(next, vehicle.speed - BRAKE_STOP * stepTime, 0);
    }
    vehicle.nextSpeed = next < .05 ? 0 : next;
    if (distance > .02 && vehicle.nextSpeed > 0) {
      const k = (distance + CHASE_PAD) / distance;
      vehicle._chaseDx = dx * k;
      vehicle._chaseDz = dz * k;
      vehicle._chaseDist = distance + CHASE_PAD;
    } else vehicle._chaseDist = 0;
    vehicle._chaseSteerTime = Math.max(0, (vehicle._chaseSteerTime ?? 0) - stepTime);
    vehicle._chaseCaught = vehicle._chaseGiveUp = false;
    if (vehicle.nextSpeed === 0) {
      this.phase = 'parada';
      this._dismountPending = true;
      this._pickup = 0;
      car.pursuit = false; // quieta: luces sí, sirena no
      this._checkDoors();
    }
    return true;
  }

  /**
   * Hacia dónde mover el carro para seguir el camino de `_buildPath` (`out`, unitario): al punto que queda `PATH_LOOK` m
   * más adelante del punto del camino más cercano al carro.
   */
  _alongPath(car, out) {
    const path = this._path, x = car.position.x, z = car.position.z;
    let best = Infinity, segment = 0, at = 0;
    for (let i = 0; i + 3 < path.length; i += 2) {
      const ax = path[i], az = path[i + 1], bx = path[i + 2] - ax, bz = path[i + 3] - az, length = bx * bx + bz * bz;
      const t = length > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / length)) : 0;
      const distance = (ax + bx * t - x) ** 2 + (az + bz * t - z) ** 2;
      if (distance < best) { best = distance; segment = i; at = t; }
    }
    let left = PATH_LOOK, i = segment, t = at, px = path[i], pz = path[i + 1];
    while (i + 3 < path.length) {
      const bx = path[i + 2] - path[i], bz = path[i + 3] - path[i + 1], length = Math.hypot(bx, bz);
      const room = length * (1 - t);
      px = path[i] + bx * t; pz = path[i + 1] + bz * t;
      if (room >= left && length > 1e-6) { px += bx / length * left; pz += bz / length * left; break; }
      left -= room;
      i += 2; t = 0;
      px = path[i]; pz = path[i + 1];
    }
    const dx = px - x, dz = pz - z, length = Math.hypot(dx, dz);
    if (length < 1e-4) out.copy(this.stopAxis);
    else out.set(dx / length, 0, dz / length);
  }

  /**
   * ¿Desde dónde queda parado quien se baja por cada lado se llega caminando a los andenes? Ver `_standOk`. Anota además
   * si quedó encima del corredor del bus.
   */
  _checkDoors() {
    const car = this.vehicle.car;
    this._parkedOnBus = this.system._onBusway(this.vehicle);
    const clear = this._doorFree;
    for (const side of [-1, 1]) {
      clear[side] = this.system._doorClear(car, this.fit, side);
      this._doorOk[side] = clear[side] && this.system._standOk(this.fit.doorPoint(side, _door), car.position.y);
    }
    // Ninguna da a un andén: no se quedan sin puerta. Sirve la que no da contra nada (la otra puede tener un carro
    // parqueado encima: el que vuelve se quedaría pegado a él); si las dos dan contra algo, las dos valen y decide quién
    // llega.
    if (!this._doorOk[-1] && !this._doorOk[1]) for (const side of [-1, 1]) this._doorOk[side] = clear[side] || !clear[-side];
  }

  _park(vehicle) {
    vehicle.nextSpeed = 0;
    vehicle._chaseDist = 0;
    vehicle._chaseCaught = vehicle._chaseGiveUp = false;
    return true;
  }

  // ---------- los agentes (cada cuadro) ----------

  /** ¿La patrulla está quieta, parqueada? Solo así se abre una puerta o se sube alguien. */
  get parked() { return this.phase === 'parada' && Math.abs(this.vehicle.speed ?? 0) < .05; }

  update(dt, ctx) {
    const vehicle = this.vehicle, traffic = this.system.traffic;
    this.fit.update(dt);
    if (this.mode === 'ronda') return;
    // La persecución terminó por el carro (desistió sin que nadie se bajara) o por fuera: todos adentro.
    if (vehicle.state !== 'chase') { this.recall(); return; }
    const player = ctx.player;
    this._reinforceClock += dt;
    const level = traffic.wantedLevel ?? 0;
    if (level > this.level) {
      this.level = level;
      for (const officer of this.officers) officer.setArmed(level >= 3);
      if (level >= 3) this.system._reinforce(this);
    }
    this._probe(dt, player);
    this._watchHeld(dt);
    if (this._dismountPending) this._dismount(player);
    if (this._driverDelay > 0) this._driverDelay = Math.max(0, this._driverDelay - dt);

    const parked = this.parked;
    // Parada sobre el corredor del bus con el bus esperando al lado, o con un carro retenido detrás: los que vuelven no
    // se demoran.
    const hurry = this._moveNow || (this.mode === 'desiste' && this._parkedOnBus && !!traffic._blocksBus?.(vehicle));
    for (const officer of this.officers) {
      if (!officer.out) continue;
      const other = officer === this.driver ? this.partner : this.driver;
      const event = officer.think(dt, {
        player, target: this._footTarget(player, officer), sees: officer.sees, lastSeen: this.lastSeen,
        unseen: this.unseen, inView: ctx.inView, doorBusy: side => other.state === 'subiendo' && other.doorSide === side,
        doorOk: side => this._doorOk[side], carStill: parked, hurry
      });
      if (event === 'arresto') this.system._arrest();
      else if (event === 'adentro') this._boarded(officer);
      else if (event === 'recoger') this._pickUp(officer);
      // Ya cerca de la puerta de vuelta: la abre si el carro la había cerrado para arrancar (nunca con el carro andando).
      if (parked && officer.state === 'regreso' && officer.position.distanceTo(this.fit.doorPoint(officer.doorSide, _target)) < 3) {
        this.fit.setDoor(officer.doorSide, true);
      }
      if (officer.out) officer.update(dt, { player });
    }

    // Nadie afuera: ninguna puerta tiene por qué seguir abierta.
    if (!this.anyoneOut) { this.fit.setDoor(-1, false); this.fit.setDoor(1, false); }
    // Va a recoger al que no logra volver: arranca con las puertas ya cerradas.
    if (this._pickupWait && this.phase === 'parada' && this.fit.doorAmount(-1) === 0 && this.fit.doorAmount(1) === 0) {
      this._pickupWait = false;
      if (this.anyoneOut && this.driver.state === 'dentro' && !this.officers.some(officer => officer.state === 'subiendo')) this._goStop();
      else this._pickup = 0;
    }
    if (this.mode === 'persigue') this._decide(dt, player);
    else if (this.mode === 'desiste' && this.phase === 'parada') this._relocate(dt);
    if (this.mode === 'desiste' && this.officers.every(officer => !officer.out)
      && this.fit.doorAmount(-1) === 0 && this.fit.doorAmount(1) === 0) this._finish();
    // Parqueada con la gente afuera: estroboscópicas y direccionales, sin sirena.
    if (this.phase === 'parada' && this.mode !== 'ronda') vehicle.car.animateDrive(0, false, { dt, speed: 0, turnSignal: 'hazard' });
  }

  /** Quién lo ve de esta patrulla: el carro (si alguien va adentro) o cualquier agente a pie. Lo junta `_share`. */
  _look(player, traffic) {
    const car = this.vehicle.car;
    this.carDistance = Math.hypot(player.x - car.position.x, player.z - car.position.z);
    const someoneInside = this.officers.some(officer => officer.state === 'dentro');
    this.carSees = someoneInside && this.carDistance <= traffic.sightRange
      && Math.abs((player.y ?? 0) - car.position.y) <= HEIGHT_TOLERANCE
      && hasClearCombatLine({ from: car.position, to: player, collisions: this.system.collisions, ignoreVehicle: car });
    let seen = this.carSees;
    for (const officer of this.officers) {
      officer.sees = officer.canSee(player);
      seen ||= officer.sees;
      if (officer.out) officer.distance = Math.hypot(player.x - officer.position.x, player.z - officer.position.z);
    }
    this.seen = seen;
  }

  /** ¿Llega el carro hasta el jugador? Sin camino unos segundos, el conductor también se baja (fichado 2 o más). */
  _probe(dt, player) {
    if (this.driver.out) { this._unreachable = 0; return; }
    this._probeTimer -= dt;
    if (this._probeTimer <= 0) {
      this._probeTimer = PROBE_EVERY;
      this._reachable = this.system._carCanReach(this.vehicle, player);
    }
    this._unreachable = this._reachable ? 0 : this._unreachable + dt;
  }

  _driverShouldExit() {
    // Con alguien retenido detrás se queda al volante: la tiene que correr.
    if (this.driver.out || this._driverDelay > 0 || this._moveNow) return false;
    if (this._forceDriver || this.system.playerVehicle) return true;
    if (this.level < 2) return false;
    if (this.carDistance > POLICE_FOOT.driverNear && this._unreachable < POLICE_FOOT.driverUnreachable) return false;
    // Tapando un carril, el corredor del bus o un cruce se queda al volante, para quitarla de ahí apenas el compañero se
    // aleje (`_relocate`) o en cuanto retenga a alguien (`_watchHeld`).
    return !this.system._blocking(this.vehicle);
  }

  _footTarget(player, officer) {
    const car = this.system.playerVehicle;
    if (!car) return player;
    return car.door?.(officer.seatSide, officer._footGoal ??= new THREE.Vector3()) ?? car.position;
  }

  /** Ya parada: se baja el acompañante y, si toca, también el conductor. */
  _dismount(player) {
    this._dismountPending = false;
    if (this.mode !== 'persigue') return;
    if (!this.partner.out) {
      this._exit(this.partner, player);
      // El compañero sale primero; el conductor, un momento después.
      this._driverDelay = DRIVER_DELAY;
    }
    if (this._driverShouldExit()) this._exit(this.driver, player);
    if (!this._toldDismount) {
      this._toldDismount = true;
      toast('¡Se bajaron de la patrulla y vienen a pie!', 'death');
    }
  }

  _exit(officer, player) {
    const fit = this.fit;
    let side = officer.seatSide;
    // Su puerta da contra una pared o un carro: sale por la del otro, si no la está usando.
    const other = officer === this.driver ? this.partner : this.driver;
    if (!this.system._doorClear(this.vehicle.car, fit, side)
      && this.system._doorClear(this.vehicle.car, fit, -side) && !(other.state === 'bajando' && other.doorSide === -side)) side = -side;
    const urgent = this.level >= 2;
    officer.startExit(fit, side, player, EXIT_TIME[urgent ? 2 : 1]);
    fit.setDoor(side, true, true);
    if (officer === this.driver) this.vehicle.car.setDriverInside?.(false);
    else fit.setPassengerInside(false);
    this.vehicle.hold = true; // marca de espera: ni se retira ni se reubica (ver TrafficSystem._canRetire)
    this.system._addPerson(officer);
  }

  _boarded(officer) {
    this.system._removePerson(officer);
    // Se cierra todo lo que no esté usando el compañero, también la puerta que abrió antes de cambiar de lado.
    const other = officer === this.driver ? this.partner : this.driver;
    for (const side of [-1, 1]) if (!(other.out && other.doorSide === side)) this.fit.setDoor(side, false);
    if (officer === this.driver) this.vehicle.car.setDriverInside?.(true);
    else this.fit.setPassengerInside(true);
  }

  /** Persecución a pie: buscar, desistir, volver al volante o bajar al conductor. */
  _decide(dt, player) {
    const traffic = this.system.traffic;
    if (this.anyoneSees) for (const officer of this.officers) if (officer.state === 'busqueda') officer.resumeChase();
    const onFoot = this.officers.filter(officer => officer.onFoot);
    if (onFoot.length) {
      const done = onFoot.every(officer => officer.searchDone);
      const far = !this.anyoneSees && onFoot.every(officer => officer.distance > POLICE_FOOT.giveUpRange);
      if (done || this.unseen >= POLICE_FOOT.giveUpTime) { this._desist('perdido'); return; }
      if (far) { this._desist('lejos'); return; }
    }
    const reason = this._worthGoingOn(dt);
    if (reason) { this._desist(reason); return; }
    // Con el jugador en un carro que arrancó: todos al carro y sigue la persecución en carro.
    const playerCar = this.system.playerVehicle;
    if (playerCar && (playerCar.speed ?? 0) > 2 && this.anyoneOut && !this._backToCar) {
      this._backToCar = true;
      for (const officer of this.officers) officer.startReturn();
    }
    if (this._backToCar && !this.anyoneOut && this.fit.doorAmount(-1) === 0 && this.fit.doorAmount(1) === 0) {
      this._backToCar = false;
      this._drive2();
      return;
    }
    if (this._backToCar) return;
    // Todos adentro sin haber desistido (volvieron por su cuenta): sigue la persecución en carro.
    if (!this.anyoneOut && this.phase === 'parada' && !this._dismountPending) {
      if (this.fit.doorAmount(-1) === 0 && this.fit.doorAmount(1) === 0) this._drive2();
      return;
    }
    const partnerChasing = this.partner.state === 'persecucion';
    if (this.phase === 'cierre') {
      // Lo alcanzó con el compañero lejos: le cierra el paso de verdad y se baja también (si no, lo escoltaría a unos
      // metros sin poder arrestarlo, porque el carro no captura).
      const caught = this.carSees && this.carDistance <= POLICE_FOOT.dismountRange && this.partner.distance > CUT_OFF_PARTNER_FAR;
      this._escort = caught ? this._escort + dt : 0;
      if (this._escort >= CUT_OFF_CATCH) this._forceDriver = true;
      // Sin camino para el carro no se queda varado en la vía: se orilla y espera.
      const stranded = this._unreachable >= POLICE_FOOT.driverUnreachable;
      if (stranded) this._cutOffTimer = CUT_OFF_RETRY;
      if (!partnerChasing || stranded || this._driverShouldExit()) this._startBrake(this.vehicle, traffic);
      return;
    }
    if (this.phase !== 'parada') return;
    if (this._driverShouldExit()) { this._exit(this.driver, player); return; }
    if (this._relocate(dt)) return;
    // Lleva rato reteniendo a alguien y no hay a dónde correrla: se van, de afán.
    if (this._cannotMove) { this._desist('estorbo'); return; }
    // Al volante otra vez: solo si el jugador va lejos, el carro llega y su compañero sigue corriendo.
    this._cutOffTimer -= dt;
    if (this._cutOffTimer > 0 || this.driver.out || !partnerChasing || this.partner.doorSide !== this.partner.seatSide) return;
    if (!this.seen || this.carDistance < CUT_OFF_FROM || !this._reachable) { this._cutOffTimer = CUT_OFF_EVERY; return; }
    this.fit.setDoor(this.partner.doorSide, false);
    if (this.fit.doorAmount(this.partner.doorSide) > 0) { this._cutOffTimer = .1; return; }
    this._cutOffTimer = CUT_OFF_EVERY;
    this.phase = 'cierre';
    this._bestDistance = Infinity;
    this._stuckClock = 0;
    this._resumeLights();
  }

  /**
   * ¿Vale la pena seguir? Aunque lo vean, una persecución tiene que poder terminar: si en `progressTime` s nadie le acortó
   * distancia y va a más de `progressFar` m; si lo ven sin poder llegarle (nadando, en un techo) `giveUpTime` s; y a los
   * `pursuitCap` s, salvo que lo tengan cerca. Devuelve el motivo para desistir, o null.
   */
  _worthGoingOn(dt) {
    this._clock += dt;
    const gap = this._gap();
    const chasing = this.officers.filter(officer => officer.state === 'persecucion');
    const stuck = this.anyoneSees && chasing.length > 0 && chasing.every(officer => officer.cannotReach);
    this._stalled = stuck ? this._stalled + dt : 0;
    // Sin poder llegarle manda el plazo de inalcanzable (esperan en la orilla); el de no acortarle distancia, no.
    if (gap < this._gapBest - POLICE_FOOT.progressGain) { this._gapBest = gap; this._gapClock = 0; }
    else if (!stuck) this._gapClock += dt;
    if (this._stalled >= POLICE_FOOT.giveUpTime) return 'inalcanzable';
    if (this._gapClock >= POLICE_FOOT.progressTime && gap > POLICE_FOOT.progressFar) return 'sin-avance';
    if (this._clock >= POLICE_FOOT.pursuitCap && gap >= POLICE_FOOT.pursuitCapNear) return 'tope';
    return null;
  }

  /** Lo más cerca que lo tiene esta patrulla: el agente que corre o busca más cercano, o el carro si alguien maneja. */
  _gap() {
    let best = Infinity;
    for (const officer of this.officers) if (officer.state === 'persecucion' || officer.state === 'busqueda') best = Math.min(best, officer.distance);
    if (this.phase === 'carro' || this.phase === 'cierre' || best === Infinity) best = Math.min(best, this.carDistance);
    return best;
  }

  /**
   * El agente que vuelve no logra acercarse a su carro: si el conductor está al volante, la patrulla va por él y para a
   * unos metros. Una vez por regreso, y solo si el carro llega hasta allá.
   */
  _pickUp(officer) {
    if (this._pickedUp || !this.parked || this.driver.state !== 'dentro' || officer === this.driver) return;
    const car = this.vehicle.car;
    if (Math.hypot(officer.position.x - car.position.x, officer.position.z - car.position.z) < PICKUP_FROM) return;
    if (this.officers.some(other => other.state === 'subiendo')) return;
    if (!this.system._pickupPoint(this.vehicle, officer, this.stopTarget)) return;
    this.stopAxis.set(0, 0, 0);
    this._pickedUp = true;
    this._pickup = 1;
    this.fit.setDoor(-1, false);
    this.fit.setDoor(1, false);
    this._pickupWait = true;
  }

  /** De vuelta a la persecución en carro (el jugador arrancó en un carro). */
  _drive2() {
    this.phase = 'carro';
    this._bestDistance = Infinity;
    this._stuckClock = 0;
    this._playerCarStill = 0;
    this.vehicle.hold = false;
    this._resumeLights();
  }

  /**
   * Parada tapando un carril o metida en un cruce, con el conductor adentro y el compañero ya lejos del carro: cierra la
   * puerta del compañero y se corre a un sitio libre unos metros adelante. Sobre el corredor del bus también ya
   * desistiendo, y si no hay sitio libre, a uno fuera del corredor. Con alguien retenido detrás (`_moveNow`) no espera
   * nada de eso: se corre ya, con tal de que nadie esté junto al carro, y si no hay a dónde lo anota (`_cannotMove`).
   * Devuelve true mientras lo está haciendo.
   */
  _relocate(dt) {
    const fit = this.fit, partner = this.partner, car = this.vehicle.car, now = this._moveNow;
    const away = now || (partner.onFoot && Math.hypot(partner.position.x - car.position.x, partner.position.z - car.position.z) > RELOCATE_CLEAR);
    if (this._relocating) {
      if (!away || this.driver.state !== 'dentro' || (now && !this._carClear())) { this._relocating = false; return false; }
      // Las dos: el compañero pudo haber cambiado de puerta para volver y la de su asiento sigue abierta.
      fit.setDoor(-1, false);
      fit.setDoor(1, false);
      if (fit.doorAmount(-1) > 0 || fit.doorAmount(1) > 0) return true;
      this._relocating = false;
      this._relocations++;
      this.stopTarget.copy(this._relocateTo);
      this.stopAxis.copy(this._relocateAxis);
      this._goStop();
      return true;
    }
    this._relocateTimer -= dt;
    if (this._relocateTimer > 0) return false;
    this._relocateTimer = now ? HELD_EVERY : RELOCATE_EVERY;
    if (!away || this.driver.state !== 'dentro' || (!now && !this.system._blocking(this.vehicle))) return false;
    // Ya desistiendo solo se corre del corredor del bus; de un carril, no: el compañero viene de vuelta a esa puerta.
    const bus = this.system._onBusway(this.vehicle);
    if (!now && (this._relocations >= (bus ? RELOCATE_BUS_MAX : RELOCATE_MAX) || (this.mode !== 'persigue' && !bus))) return false;
    // Nadie subiéndose ni junto al carro, sea de esta patrulla o de otra: no arranca con alguien al lado.
    // Un sitio libre de todo; si no hay y está sobre el corredor del bus, uno fuera del corredor aunque tape un carril; y si
    // lo que pasa es que corta un sentido sin retener a nadie, uno que deje pasar por algún carril de cada sentido.
    const traffic = this.system.traffic, to = this._relocateTo, axis = this._relocateAxis;
    const found = this._carClear() && (this.system._chooseStop(this.vehicle, traffic, to, { free: true, axis })
      || (bus && this.system._chooseStop(this.vehicle, traffic, to, { offBus: true, axis }))
      || (now && !this._holding && this.system._chooseStop(this.vehicle, traffic, to, { uncut: true, axis })))
      && Math.hypot(to.x - car.position.x, to.z - car.position.z) >= 1.5;
    if (!found) {
      if (now) this._cannotMove = true;
      return false;
    }
    this._relocating = true;
    fit.setDoor(-1, false);
    fit.setDoor(1, false);
    return true;
  }

  /** Nadie subiéndose ni a menos de `RELOCATE_NEAR` m del carro, sea de esta patrulla o de otra. */
  _carClear() {
    const car = this.vehicle.car;
    if (this.officers.some(officer => officer.state === 'subiendo')) return false;
    return !this.system.officers.some(officer => officer.out && officer.position.distanceTo(car.position) < RELOCATE_NEAR);
  }

  /**
   * ¿Tiene a alguien retenido detrás, o corta del todo un sentido de la calle? Cada `HELD_EVERY` s. Pasados `HELD_LIMIT`
   * (o `CUT_LIMIT`) s se mueve (`_moveNow`): si el conductor anda afuera, vuelve de afán a correrla; ya adentro, `_relocate`
   * la corre a un sitio libre (o, si solo cortaba, a uno que no corte), y si no hay, desisten.
   */
  _watchHeld(dt) {
    if (this.phase !== 'parada') { if (this._held.size || this._moveNow || this._cutFor) this._clearHeld(); return; }
    this._heldTimer -= dt;
    if (this._heldTimer > 0) return;
    this._heldTimer = HELD_EVERY;
    const held = this.system._heldBehind(this.vehicle, this._held, HELD_EVERY), car = this.vehicle.car, yaw = car.group.rotation.y;
    // Un sentido de la calle cortado del todo tampoco aguanta, aunque todavía no venga nadie.
    this._cutFor = this.system._laneCut(car.position.x, car.position.z, Math.cos(yaw), -Math.sin(yaw), car) ? this._cutFor + HELD_EVERY : 0;
    this._holding = held >= HELD_LIMIT;
    const now = this._holding || this._cutFor >= CUT_LIMIT;
    if (now && !this._moveNow) this._relocateTimer = 0;
    this._moveNow = now;
    if (!now) { this._cannotMove = false; return; }
    const driver = this.driver;
    if (this.mode === 'persigue' && driver.out && driver.state !== 'regreso' && driver.state !== 'subiendo') driver.startReturn();
  }

  _resumeLights() {
    const car = this.vehicle.car;
    car.pursuit = true;
    // Las direccionales de parqueo se apagan al arrancar.
    car.animateDrive(0, false, { dt: 1e-3, speed: 0, turnSignal: null });
  }

  /** Lo perdieron, o no vale la pena seguir (`reason`, ver `endReason`): vuelven caminando al carro. */
  _desist(reason = 'perdido') {
    if (this.mode !== 'persigue') return;
    this.mode = 'desiste';
    this.endReason = reason;
    let said = false;
    for (const officer of this.officers) {
      if (!officer.out) continue;
      officer.startReturn(said ? null : reason);
      said = true;
    }
    if (this.phase === 'cierre' || this.phase === 'carro') this._startBrake(this.vehicle, this.system.traffic);
    // El aviso sale un momento después, con la placa del HUD ya abajo (si sale de una, el HUD lo bota), y una sola vez
    // por persecución: si otra patrulla sigue, lo dará la última.
    this.system._scheduleEscape(reason);
  }

  /** Lo vieron robar mientras volvían: retoman la persecución desde donde están, con los que ya andan afuera. */
  resume(player) {
    if (this.mode !== 'desiste') return;
    this.mode = 'persigue';
    this.endReason = null;
    this._clock = 0;
    this._gapBest = Infinity;
    this._gapClock = 0;
    this._stalled = 0;
    this._backToCar = false;
    // Si ya nadie perseguía, es otra persecución: cuando la pierdan habrá otro aviso.
    if (!this.system.units.some(unit => unit !== this && unit.mode === 'persigue')) this.system._newPursuit(player);
    else this.system._spot(player);
    for (const officer of this.officers) officer.resumeChase();
  }

  /** ¿Alguien de esta patrulla, que ya desistió y vuelve al carro, lo ve robar en `player`? */
  witnesses(player) {
    if (this.mode !== 'desiste' || !this.watching || !player) return false;
    if (this.officers.some(officer => officer.onFoot && officer.canSee(player))) return true;
    return this.officers.some(officer => officer.state === 'dentro') && this.system.traffic._canWitness(this.vehicle, player);
  }

  /** Los dos adentro y las puertas cerradas: la patrulla vuelve a su ronda. */
  _finish() {
    const vehicle = this.vehicle, traffic = this.system.traffic;
    this.mode = 'ronda';
    this.phase = 'ronda';
    this.reinforcing = false;
    vehicle.hold = false;
    vehicle.stoppedFor = 0;
    this._clearHeld();
    this._resumeLights();
    if (vehicle.state === 'chase') traffic._returnToPatrol(vehicle);
    vehicle.car.pursuit = false;
  }

  /** Le pegaron a uno: si se habían ido, vuelven por él; su compañero sale o viene. */
  _officerHit(officer) {
    const player = this.system.player?.position;
    if (this.mode === 'ronda') return;
    if (this.mode === 'desiste') this.resume(player ?? officer.position);
    else if (player) this.system._spot(player);
    officer.resumeChase();
    const other = officer === this.driver ? this.partner : this.driver;
    if (other.out) other.resumeChase();
    else {
      if (other === this.driver) this._forceDriver = true;
      if (this.phase === 'parada') this._exit(other, player ?? officer.position);
      else if (this.phase === 'cierre') this._startBrake(this.vehicle, this.system.traffic);
    }
  }

  /** De una vez: todos adentro, puertas cerradas y la patrulla lista para su ronda (arresto, muerte o recarga). */
  recall() {
    for (const officer of this.officers) {
      if (officer.out) officer.enterCar();
      this.system._removePerson(officer);
    }
    this.fit.restore();
    this.mode = 'ronda';
    this.phase = 'ronda';
    this.reinforcing = false;
    this.vehicle.hold = false;
    this.vehicle.stoppedFor = 0;
    this._reset();
  }

  /** Su carro ya no está: el que esté afuera se va cuando nadie lo vea. */
  orphan(dt, ctx) {
    this.mode = 'ronda';
    let left = false;
    for (const officer of this.officers) {
      if (!officer.out) continue;
      if (!ctx.inView(officer.position)) { officer.enterCar(); this.system._removePerson(officer); continue; }
      left = true;
      officer.moving = false;
      officer.update(dt, { player: ctx.player });
    }
    this.dead = !left;
  }

  dispose() {
    this.recall();
    for (const officer of this.officers) officer.dispose();
    this.fit.dispose();
    if (this.vehicle.crew === this) this.vehicle.crew = null;
  }
}

export class PoliceFootSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {{ player: object, audio?: object, random?: () => number, getPlayerVehicle?: () => object|null }} deps
   *   `getPlayerVehicle` da el carro que maneja el jugador ({ position, speed, door(side, target) }) o null.
   */
  constructor(scene, { player, audio = null, random = Math.random, getPlayerVehicle = null } = {}) {
    this.scene = scene;
    this.player = player;
    this.audio = audio;
    this.random = random;
    this.getPlayerVehicle = getPlayerVehicle;
    this.traffic = null;
    this.units = [];
    this.people = null;
    this.collisions = null;
    this.arrests = 0;
    // Lo que sabe toda la persecución (todas las patrullas que la siguen, refuerzo incluido): una sola medida.
    this.seen = false;
    this.unseen = 0;
    this.lastSeen = new THREE.Vector3();
    this._escapeTimer = 0;
    this._escapeReason = null;
    this._noticeSent = false;
    this._replanned = false;
    this._lanes = new Map();
    this._cutLanes = new Map(); // para `_laneCut`, reutilizados
    this._cutCount = new Array(16).fill(0);
    this._stops = [];      // candidatos de parada, reutilizados (ver `_chooseStop`)
    this._stopOrder = [];
    this._frustum = new THREE.Frustum();
    this._camera = null;
    this.inView = point => this._inView(point);
    this._takeReplan = () => {
      if (this._replanned) return false;
      this._replanned = true;
      return true;
    };
  }

  /**
   * @param {object} district distrito activo: caminable, altura del suelo, agua y red de andenes
   * @param {object} traffic sistema de tráfico (sus patrullas reciben tripulación)
   * @param {object[]} people peatones que los carros respetan: los agentes a pie entran ahí
   */
  setup(district, traffic, people = null, { collisions = null } = {}) {
    this._disposeUnits();
    this.traffic = traffic;
    this.people = people;
    this.collisions = collisions ?? traffic?.environment?.collisions ?? null;
    this.routes = district?.pedestrianNavigation ?? null;
    this._isWalkable = (x, z) => district?.isWalkableAt?.(x, z) ?? true;
    this._ground = (x, z, currentY = 0) => district?.getMovementGroundHeight?.(x, z, currentY)
      ?? district?.getGroundHeight?.(x, z) ?? currentY;
    this._water = (x, z) => district?.getWaterInfo?.(x, z) ?? null;
    if (!traffic) return;
    this.units = traffic.vehicles.filter(vehicle => vehicle.police).map((vehicle, index) => {
      const unit = new PatrolUnit(this, vehicle, index);
      vehicle.crew = unit;
      return unit;
    });
    this._buildLanes(traffic.routes ?? [], district?.busServices ?? traffic.busVehicles?.map(bus => bus.car) ?? []);
  }

  _createOfficer(role, index) {
    const officer = new PoliceOfficer(this.scene, { role, index, routes: this.routes, random: this.random,
      isWalkable: this._isWalkable, groundHeight: this._ground, getWaterInfo: this._water, collisions: this.collisions });
    officer.canReplan = this._takeReplan;
    return officer;
  }

  get officers() { return this.units.flatMap(unit => unit.officers); }

  /** Personajes para precargar junto con los demás NPC. */
  get preloadables() { return this.officers; }

  get playerVehicle() { return this.getPlayerVehicle?.() ?? null; }

  /** ¿Algún agente anda a pie? */
  get active() { return this.units.some(unit => unit.anyoneOut); }

  /**
   * @param {number} dt
   * @param {{ camera?: THREE.Camera }} ctx la cámara decide qué se alcanza a ver (subirse de una, irse sin carro)
   */
  update(dt, { camera = null } = {}) {
    if (!this.traffic || dt <= 0) return;
    const player = this.player?.position;
    if (!player) return;
    this._camera = camera;
    if (camera) {
      camera.updateMatrixWorld?.();
      this._frustum.setFromProjectionMatrix(_matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    this._replanned = false;
    const ctx = { player, inView: this.inView };
    // Primero lo que ve cada patrulla; después, lo que sabe toda la persecución; después cada una decide.
    for (const unit of this.units) if (unit.watching && this.traffic.vehicles.includes(unit.vehicle)) unit._look(player, this.traffic);
    this._share(dt, player);
    for (const unit of this.units) {
      if (!this.traffic.vehicles.includes(unit.vehicle)) unit.orphan(dt, ctx);
      else unit.update(dt, ctx);
    }
    this._notify(dt);
    this._separate();
    if (this.units.some(unit => unit.dead)) {
      for (const unit of this.units.filter(unit => unit.dead)) unit.dispose();
      this.units = this.units.filter(unit => !unit.dead);
    }
  }

  /** Junta lo que ve cada patrulla que persigue: si una lo ve, todas saben dónde está (y ningún reloj de abandono corre). */
  _share(dt, player) {
    let pursuing = false, seen = false;
    for (const unit of this.units) {
      if (!unit.watching || unit.mode !== 'persigue') continue;
      pursuing = true;
      seen ||= unit.seen;
    }
    this.seen = seen;
    if (!pursuing) { this.unseen = 0; return; }
    if (seen) this._spot(player);
    else this.unseen += dt;
  }

  _spot(player) {
    this.lastSeen.copy(player);
    this.unseen = 0;
  }

  /** Empieza una persecución: su vista y su aviso de escape son nuevos. */
  _newPursuit(player) {
    this._spot(player);
    this.seen = false;
    this._noticeSent = false;
    this._escapeTimer = 0;
  }

  /** Una patrulla desistió: el aviso sale en un momento si para entonces ya nadie persigue. */
  _scheduleEscape(reason) {
    if (this._noticeSent) return;
    this._escapeTimer = ESCAPE_NOTICE;
    this._escapeReason = reason;
  }

  /** El tráfico ya avisó el escape (una patrulla se devolvió en carro): no sale otro. */
  _escapeHandled() {
    this._noticeSent = true;
    this._escapeTimer = 0;
  }

  _notify(dt) {
    if (this._escapeTimer <= 0 || (this._escapeTimer -= dt) > 0) return;
    this._escapeTimer = 0;
    const traffic = this.traffic;
    if (this._noticeSent || traffic.inPursuit || traffic._arrestDispatched) return;
    this._noticeSent = true;
    emit('police-escaped', { reason: this._escapeReason });
  }

  /** Dos agentes no se montan uno encima del otro: el de atrás se corre lo que falte. */
  _separate() {
    if (!this.units.some(unit => unit.anyoneOut)) return;
    const walking = this.officers.filter(officer => officer.onFoot);
    for (let i = 0; i < walking.length; i++) for (let j = i + 1; j < walking.length; j++) {
      const a = walking[i], b = walking[j];
      const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z, distance = Math.hypot(dx, dz);
      if (distance >= SPACING) continue;
      const nx = distance > 1e-4 ? dx / distance : 1, nz = distance > 1e-4 ? dz / distance : 0;
      _target.set(b.position.x + nx * (SPACING - distance), b.position.y, b.position.z + nz * (SPACING - distance));
      b._resolve(b.position, _target, _target);
      b.position.copy(_target);
      b.root.position.copy(_target);
    }
  }

  _inView(point) {
    if (!this._camera) return false;
    _sphere.center.set(point.x, point.y + .9, point.z);
    const camera = this._camera.position;
    return Math.hypot(camera.x - point.x, camera.z - point.z) < VIEW_DISTANCE && this._frustum.intersectsSphere(_sphere);
  }

  _addPerson(officer) {
    if (this.people && !this.people.includes(officer)) this.people.push(officer);
  }

  _removePerson(officer) {
    const index = this.people?.indexOf(officer) ?? -1;
    if (index >= 0) this.people.splice(index, 1);
  }

  /** La misma consecuencia que la captura en carro: el juego abre el arresto una sola vez. */
  _arrest() {
    if (this.traffic._arrestDispatched) return;
    this.traffic._arrestDispatched = true;
    this.arrests++;
    emit('police-arrest', { reason: 'a-pie' });
  }

  /**
   * Fichado 3: la patrulla de ronda más cercana viene de refuerzo. No una que todavía vuelve a su carril (puede estar
   * trabada, y la persecución le cortaría el regreso) ni una retenida.
   */
  _reinforce(unit) {
    const player = this.player?.position;
    if (!player) return;
    let best = null, bestDistance = REINFORCE_RANGE;
    for (const other of this.units) {
      if (other === unit || other.mode !== 'ronda' || other.vehicle.state !== 'patrol' || other.dead) continue;
      if (other.vehicle.rejoinTarget || other.vehicle.hold) continue;
      const distance = other.vehicle.car.position.distanceTo(player);
      if (distance < bestDistance) { bestDistance = distance; best = other; }
    }
    if (!best) return;
    this.traffic._startChase(best.vehicle);
    best.reinforcing = true;
    best._reinforceClock = 0;
  }

  /** Si su puerta da a algo sólido (pared, poste, otro carro) o a donde no se camina. */
  _doorClear(car, fit, side) {
    const door = fit.doorPoint(side, _target);
    door.y = this._ground(door.x, door.z, car.position.y);
    if (!this._isWalkable(door.x, door.z)) return false;
    const collisions = this.collisions;
    if (!collisions) return true;
    return hasClearCombatLine({ from: car.position, to: door, collisions, chestHeight: .8, ignoreVehicle: car })
      && hasClearCombatLine({ from: door, to: { x: door.x + .04, y: door.y, z: door.z + .04 }, collisions, chestHeight: .8 });
  }

  /** ¿Hay por dónde meter el carro hacia el jugador? Prueba de frente y abriéndose un poco a cada lado. */
  _carCanReach(vehicle, player) {
    const traffic = this.traffic;
    if (!traffic?.environment) return true;
    const car = vehicle.car, dx = player.x - car.position.x, dz = player.z - car.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 3) return true;
    if (Math.abs((player.y ?? 0) - car.position.y) > HEIGHT_TOLERANCE) return false;
    const bearing = Math.atan2(dz, dx), length = Math.min(5, distance - 1.5);
    for (const offset of [0, .45, -.45, .9, -.9]) {
      const angle = bearing + offset;
      if (traffic._chaseClearance(vehicle, Math.cos(angle), Math.sin(angle), length) >= length - .1) return true;
    }
    return false;
  }

  /**
   * Dónde parar para recoger a un agente que no logra volver: a `PICKUP_GAP` m de él, de su lado de lo que lo tenga
   * atajado (el tramo de él hasta ahí se camina y está despejado), y a donde el carro llega. Prueba de frente hacia el
   * carro y abriéndose hasta los costados. False si no hay.
   */
  _pickupPoint(vehicle, officer, target) {
    const car = vehicle.car, from = officer.position;
    if (Math.abs(from.y - car.position.y) > HEIGHT_TOLERANCE) return false;
    const bearing = Math.atan2(car.position.z - from.z, car.position.x - from.x);
    for (const offset of [0, .5, -.5, 1, -1, 1.6, -1.6]) {
      const angle = bearing + offset;
      _pick.set(from.x + Math.cos(angle) * PICKUP_GAP, car.position.y, from.z + Math.sin(angle) * PICKUP_GAP);
      let walk = true;
      for (const k of [.35, .7, 1]) walk &&= this._isWalkable(from.x + (_pick.x - from.x) * k, from.z + (_pick.z - from.z) * k);
      if (!walk || Math.abs(this._ground(_pick.x, _pick.z, from.y) - from.y) > .6) continue;
      if (this.collisions && !hasClearCombatLine({ from, to: _pick, collisions: this.collisions, chestHeight: .8 })) continue;
      if (!this._carCanReach(vehicle, _pick)) continue;
      target.copy(_pick);
      return true;
    }
    return false;
  }

  /**
   * Muestras de los carriles y del corredor del bus, para no parquear encima de uno: x, y, z, el medio ancho de lo que
   * pasa por ahí (un carro, o el bus, que es más ancho) y su rumbo. La altura separa la rampa del bus de la calle de abajo.
   */
  _buildLanes(routes, buses = []) {
    this._lanes.clear();
    const add = (x, y, z, half, hx, hz) => {
      const key = `${Math.floor(x / LANE_CELL)}:${Math.floor(z / LANE_CELL)}`;
      let list = this._lanes.get(key);
      if (!list) this._lanes.set(key, list = []);
      const length = Math.hypot(hx, hz) || 1;
      list.push(x, y, z, half, hx / length, hz / length);
    };
    const point = new THREE.Vector3(), direction = new THREE.Vector3();
    for (const route of routes) {
      for (let distance = 0; distance < route.length; distance += LANE_STEP) {
        direction.set(1, 0, 0);
        route.sample(distance, point, direction);
        add(point.x, point.y, point.z, LANE_HALF, direction.x, direction.z);
      }
    }
    for (const bus of buses) {
      if (!Number.isFinite(bus?.startZ) || !Number.isFinite(bus?.endZ)) continue;
      const lane = bus.laneX ?? bus.position?.x ?? 0, from = Math.min(bus.startZ, bus.endZ), to = Math.max(bus.startZ, bus.endZ);
      const half = (bus.width ?? 2.6) / 2 + BUS_MARGIN;
      const pathX = z => typeof bus.pathX === 'function' ? bus.pathX(z, lane) : lane;
      for (let z = from; z <= to; z += LANE_STEP) {
        const x = pathX(z);
        add(x, bus.groundHeight?.(x, z) ?? bus.height ?? 0, z, half, pathX(z + LANE_STEP) - x, LANE_STEP);
      }
    }
  }

  /**
   * ¿La muestra `k` de `list` queda debajo de un carro parqueado en (x, z) mirando hacia (nx, nz)? Lo ancho de lo que pasa
   * va de través al carril: cuenta contra el largo de la patrulla si quedó atravesada (la trompa metida en el carril) y
   * contra su ancho si quedó a lo largo.
   */
  _under(list, k, x, z, nx, nz, halfLength, halfWidth) {
    const dx = list[k] - x, dz = list[k + 2] - z, hx = list[k + 4], hz = list[k + 5], half = list[k + 3];
    return Math.abs(dx * nx + dz * nz) < halfLength + half * Math.abs(hx * nz - hz * nx)
      && Math.abs(-dx * nz + dz * nx) < halfWidth + half * Math.abs(hx * nx + hz * nz);
  }

  /**
   * Cuántas muestras de carril (o del bus) quedarían debajo de un carro parqueado en (x, z) mirando hacia (nx, nz). Con
   * `minHalf` cuenta solo las de lo que pasa más ancho que eso (el bus, ver `_busBlock`).
   */
  _laneBlock(x, z, nx, nz, car, y = car.position.y, minHalf = 0) {
    const halfLength = car.length / 2 + .6, halfWidth = car.width / 2;
    const cx = Math.floor(x / LANE_CELL), cz = Math.floor(z / LANE_CELL);
    let count = 0;
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const list = this._lanes.get(`${i}:${j}`);
      if (!list) continue;
      for (let k = 0; k < list.length; k += LANE_STRIDE) {
        if (Math.abs(list[k + 1] - y) > LANE_HEIGHT || list[k + 3] < minHalf) continue;
        if (this._under(list, k, x, z, nx, nz, halfLength, halfWidth)) count++;
      }
    }
    return count;
  }

  /**
   * Cuántos sentidos de la calle quedarían cortados del todo con la patrulla parada en (x, z) mirando hacia (nx, nz). Los
   * carriles de carros de la sección de la calle a la altura del carro se agrupan por rumbo (de a 45°) y por su corrimiento
   * de lado (de a `LANE_STEP` m); un sentido está cortado si la patrulla tapa todos sus carriles. El corredor del bus va
   * aparte (`_busBlock`): no tiene por dónde rodearla.
   */
  _laneCut(x, z, nx, nz, car, y = car.position.y) {
    const halfLength = car.length / 2 + .6, halfWidth = car.width / 2, reach = Math.ceil(CUT_REACH / LANE_CELL);
    const cx = Math.floor(x / LANE_CELL), cz = Math.floor(z / LANE_CELL);
    const lanes = this._cutLanes;
    lanes.clear();
    for (let i = cx - reach; i <= cx + reach; i++) for (let j = cz - reach; j <= cz + reach; j++) {
      const list = this._lanes.get(`${i}:${j}`);
      if (!list) continue;
      for (let k = 0; k < list.length; k += LANE_STRIDE) {
        if (Math.abs(list[k + 1] - y) > LANE_HEIGHT || list[k + 3] >= BUS_HALF) continue;
        const dx = list[k] - x, dz = list[k + 2] - z, hx = list[k + 4], hz = list[k + 5];
        if (Math.abs(dx) > CUT_REACH || Math.abs(dz) > CUT_REACH || Math.abs(dx * hx + dz * hz) > CUT_SECTION) continue;
        const key = (Math.round(Math.atan2(hz, hx) / HEADING_STEP) & 7) * 1000 + 500 + Math.round((-dx * hz + dz * hx) / LANE_STEP);
        if (!lanes.get(key)) lanes.set(key, this._under(list, k, x, z, nx, nz, halfLength, halfWidth));
      }
    }
    const lanesOf = this._cutCount.fill(0);
    for (const [key, blocked] of lanes) {
      const heading = Math.floor(key / 1000);
      lanesOf[heading * 2]++;
      if (blocked) lanesOf[heading * 2 + 1]++;
    }
    let cut = 0;
    for (let heading = 0; heading < 8; heading++) if (lanesOf[heading * 2] && lanesOf[heading * 2 + 1] === lanesOf[heading * 2]) cut++;
    return cut;
  }

  /**
   * El eje del carril más cercano a (x, z), a menos de `ALIGN_REACH` m, en el sentido de (nx, nz): con ese rumbo queda
   * parada la patrulla, derecha. False si no hay, o si es la calle que cruza (más de `ALIGN_TURN` de giro).
   */
  _laneAxis(x, z, nx, nz, y, out) {
    const cx = Math.floor(x / LANE_CELL), cz = Math.floor(z / LANE_CELL);
    let best = ALIGN_REACH * ALIGN_REACH, found = false;
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const list = this._lanes.get(`${i}:${j}`);
      if (!list) continue;
      for (let k = 0; k < list.length; k += LANE_STRIDE) {
        if (Math.abs(list[k + 1] - y) > LANE_HEIGHT) continue;
        const dx = list[k] - x, dz = list[k + 2] - z, distance = dx * dx + dz * dz;
        if (distance >= best) continue;
        best = distance;
        found = true;
        const sign = list[k + 4] * nx + list[k + 5] * nz < 0 ? -1 : 1;
        out.set(list[k + 4] * sign, 0, list[k + 5] * sign);
      }
    }
    return found && out.x * nx + out.z * nz >= Math.cos(ALIGN_TURN);
  }

  /**
   * ¿La patrulla llega a (ex, ez) quedando con el eje (ax, az)? Sigue la curva de `curveAt` desde donde está: la carrocería
   * cabe en cada punto (con el rumbo de la curva ahí) y no coletea más de `ALIGN_SWERVE` respecto del eje.
   */
  _curveClear(vehicle, traffic, ex, ez, ax, az) {
    const car = vehicle.car, yaw = car.group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const sx = car.position.x, sz = car.position.z, lead = leadOf(sx, sz, ex, ez), lx = ex - ax * lead, lz = ez - az * lead;
    const steps = Math.max(4, Math.ceil(Math.hypot(lx - sx, lz - sz) / .5)), last = Math.ceil(lead / .5);
    const swerve = Math.cos(ALIGN_SWERVE);
    let y = car.position.y;
    for (let i = 1; i <= steps + last; i++) {
      let x, z, tx = ax, tz = az;
      if (i <= steps) {
        const point = curveAt(i / steps, sx, sz, fx, fz, lx, lz, ax, az), length = Math.hypot(point.tx, point.tz) || 1;
        x = point.x; z = point.z; tx = point.tx / length; tz = point.tz / length;
        if (tx * ax + tz * az < swerve) return false;
      } else { x = lx + ax * lead * (i - steps) / last; z = lz + az * lead * (i - steps) / last; }
      if (!traffic.environment) continue;
      const ground = traffic._chaseFootprint(vehicle, x, z, y, tx, tz);
      if (ground === null) return false;
      y = ground;
    }
    return true;
  }

  /** Lo mismo que `_laneBlock`, pero solo el corredor del bus: el bus no tiene por dónde rodear una patrulla parada. */
  _busBlock(x, z, nx, nz, car) {
    return this._laneBlock(x, z, nx, nz, car, car.position.y, BUS_HALF);
  }

  /** ¿La patrulla quieta tapa el corredor del bus? */
  _onBusway(vehicle) {
    const car = vehicle.car, yaw = car.group.rotation.y;
    return this._busBlock(car.position.x, car.position.z, Math.cos(yaw), -Math.sin(yaw), car) > 0;
  }

  /**
   * ¿Quien queda parado en `point` (junto a una puerta) llega caminando a los andenes? Se camina ahí, no es agua, está a
   * la altura del carro y hay un nodo de la red a la vista, a menos de `STAND_REACH` m y casi a la misma altura (desde la
   * rampa del bus, el andén de abajo no cuenta).
   */
  _standOk(point, y) {
    if (!this._isWalkable(point.x, point.z)) return false;
    const ground = this._ground(point.x, point.z, y);
    if (!Number.isFinite(ground) || Math.abs(ground - y) > .6) return false;
    const water = this._water(point.x, point.z);
    if (water && ground <= water.surfaceY + .12) return false;
    const routes = this.routes;
    if (!routes?.nodes || !routes.nodeAt) return true;
    const tile = routes.tileSize ?? 2, reach = Math.ceil(STAND_REACH / tile);
    const cx = Math.round(point.x / tile), cz = Math.round(point.z / tile);
    _stand.set(point.x, ground, point.z);
    for (let ring = 0; ring <= reach; ring++) for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      const id = routes.grid?.[cz + j]?.[cx + i] ?? -1;
      const node = id >= 0 ? routes.nodes[id] : null;
      if (!node?.main || !node.neighbors?.length) continue;
      const x = (cx + i) * tile, z = (cz + j) * tile;
      if (Math.hypot(x - point.x, z - point.z) > STAND_REACH) continue;
      if (Math.abs((routes.groundHeight?.(x, z) ?? ground) - ground) > .6) continue;
      _node.set(x, ground, z);
      if (!this.collisions || hasClearCombatLine({ from: _stand, to: _node, collisions: this.collisions, chestHeight: .8 })) return true;
    }
    return false;
  }

  /**
   * Dónde parar: adelante, al alcance del frenazo, y si se puede orillado hacia el lado del jugador, fuera de los carriles
   * y del corredor del bus, lejos de los cruces y con las dos puertas dando a donde se camina. Si toca tapar algo, mejor un
   * carril con otro libre al lado que cortar un sentido entero, y cualquier carril antes que el corredor del bus. Junto a
   * un carril queda derecha, con su eje (`axis`, en cero si no: llega derecho y queda como llegue). Si nada sirve, frena
   * derecho. Con `free`, solo un sitio que no tape nada; con `offBus`, uno fuera del corredor del bus con al menos una
   * puerta que sirva; con `uncut`, además, uno que no corte ningún sentido entero.
   */
  _chooseStop(vehicle, traffic, target, { free = false, offBus = false, uncut = false, axis = null } = {}) {
    const car = vehicle.car, yaw = car.group.rotation.y, player = this.player?.position ?? car.position;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    const playerSide = (player.x - car.position.x) * rx + (player.z - car.position.z) * rz >= 0 ? 1 : -1;
    const brakeDistance = vehicle.speed * vehicle.speed / (2 * POLICE_FOOT.brake);
    const first = Math.max(2.5, brakeDistance + .5);
    const candidates = this._stops;
    axis?.set(0, 0, 0);
    let count = 0;
    for (const ahead of [first, first + 2.5, first + 5, first + 8]) for (const lateral of PULL_OVER) for (const side of [playerSide, -playerSide]) {
      if (!lateral && side !== playerSide) continue;
      const ox = fx * ahead + rx * lateral * side, oz = fz * ahead + rz * lateral * side;
      const length = Math.hypot(ox, oz), nx = ox / length, nz = oz / length;
      const x = car.position.x + ox, z = car.position.z + oz;
      if (Math.hypot(player.x - x, player.z - z) < 3) continue;
      // Junto a un carril queda con su eje si alcanza a enderezarse en el camino; si no, como llegue.
      const aligned = !!axis && this._laneAxis(x, z, nx, nz, car.position.y, _axis)
        && this._curveClear(vehicle, { environment: null }, x, z, _axis.x, _axis.z);
      const hx = aligned ? _axis.x : nx, hz = aligned ? _axis.z : nz;
      // Lo que manda es no cortar un sentido ni tapar un carril (y menos el corredor del bus); después, no meterse a un
      // cruce, que las puertas den a donde se camina, frenar cerca y no quedar atravesada.
      _node.set(x, car.position.y, z);
      const lane = this._laneBlock(x, z, hx, hz, car), crossing = !!traffic._nearNode?.(_node);
      if (free && (lane || crossing)) continue;
      const bus = lane ? this._busBlock(x, z, hx, hz, car) : 0;
      if ((offBus || uncut) && bus) continue;
      const doors = this._doorsOk(x, z, hx, hz, car);
      if ((free && doors < 2) || ((offBus || uncut) && doors < 1)) continue;
      const cut = lane ? this._laneCut(x, z, hx, hz, car) : 0;
      if (uncut && cut) continue;
      const candidate = candidates[count] ??= {};
      candidate.x = x; candidate.z = z; candidate.nx = nx; candidate.nz = nz; candidate.length = length; candidate.order = count;
      candidate.aligned = aligned; candidate.ax = hx; candidate.az = hz;
      candidate.score = lane * 3 + cut * CUT_WEIGHT + bus * BUS_WEIGHT + (crossing ? 6 : 0) + (2 - doors) * 4
        + ahead * .3 + Math.abs(Math.atan2(lateral, ahead)) * 2 + (side === playerSide ? 0 : 1.5);
      count++;
    }
    // El mejor puntaje al que el carro llega. Probar si llega es lo caro (barre la carrocería contra las colisiones):
    // se prueba en orden de puntaje y solo hasta el primero que sirve.
    candidates.length = Math.max(candidates.length, count);
    const ordered = this._stopOrder;
    ordered.length = 0;
    for (let i = 0; i < count; i++) ordered.push(candidates[i]);
    ordered.sort(byScore);
    for (const candidate of ordered) {
      if (traffic.environment && (candidate.aligned
        ? !this._curveClear(vehicle, traffic, candidate.x, candidate.z, candidate.ax, candidate.az)
        : traffic._chaseClearance(vehicle, candidate.nx, candidate.nz, candidate.length) < candidate.length - .05)) continue;
      target.set(candidate.x, car.position.y, candidate.z);
      if (candidate.aligned) axis?.set(candidate.ax, 0, candidate.az);
      return true;
    }
    if (free || offBus || uncut) return false;
    const clear = traffic.environment ? traffic._chaseClearance(vehicle, fx, fz, first) : first;
    target.set(car.position.x + fx * clear, car.position.y, car.position.z + fz * clear);
    return true;
  }

  /** Cuántas de las dos puertas de un carro parado en (x, z) mirando hacia (nx, nz) dan a donde se puede bajar y volver. */
  _doorsOk(x, z, nx, nz, car) {
    const y = car.position.y, along = car.vehicle?.driverDoor?.x ?? .2, out = car.width / 2 + .55;
    let count = 0;
    for (const side of [-1, 1]) {
      // A la derecha del rumbo (nx, nz) queda (-nz, nx): el mismo eje local +z de PatrolCar.doorPoint.
      _doorAt.set(x + nx * along - nz * out * side, y, z + nz * along + nx * out * side);
      if (this._standOk(_doorAt, y)) count++;
    }
    return count;
  }

  /** ¿La patrulla quieta tapa un carril, el corredor del bus o quedó en un cruce? */
  _blocking(vehicle) {
    const car = vehicle.car, yaw = car.group.rotation.y;
    return this._laneBlock(car.position.x, car.position.z, Math.cos(yaw), -Math.sin(yaw), car) > 0
      || !!this.traffic?._nearNode?.(car.position);
  }

  /**
   * Los carros que la patrulla quieta tiene retenidos: quietos, cerca y con ella en su camino, en los `HELD_AHEAD` m de
   * su ruta que siguen (la misma prueba con que el tráfico decide frenar). `held` lleva cuánto lleva cada uno así, de a
   * `step` s; devuelve lo que lleva el que más.
   */
  _heldBehind(vehicle, held, step) {
    const traffic = this.traffic, car = vehicle.car;
    let worst = 0;
    for (const other of traffic.vehicles) {
      if (other === vehicle || other.police || other.state === 'chase' || other.rejoinTarget || !other.route
        || Math.abs(other.speed ?? 0) >= .05
        || Math.hypot(other.car.position.x - car.position.x, other.car.position.z - car.position.z) > HELD_RANGE
        || !this._inPathOf(vehicle, other)) { held.delete(other); continue; }
      const seconds = (held.get(other) ?? 0) + step;
      held.set(other, seconds);
      worst = Math.max(worst, seconds);
    }
    return worst;
  }

  /** ¿`vehicle` le queda en el camino a `other`, en lo que le falta de su ruta hasta `HELD_AHEAD` m? */
  _inPathOf(vehicle, other) {
    const traffic = this.traffic;
    for (let ahead = 0; ahead <= HELD_AHEAD; ahead += .5) {
      other.route.sample(other.distance + ahead, traffic._probePosition, traffic._probeDirection);
      if (traffic._carInPath(vehicle, other.car)) return true;
    }
    return false;
  }

  /** Arresto, muerte o recarga: todos adentro (TrafficSystem.endPursuit ya lo hace por cada patrulla). */
  reset() {
    for (const unit of this.units) unit.recall();
  }

  _disposeUnits() {
    for (const unit of this.units) unit.dispose();
    this.units = [];
  }

  dispose() {
    this._disposeUnits();
    this.traffic = null;
  }
}
