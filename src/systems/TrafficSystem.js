import * as THREE from 'three';
import { Car } from '../entities/Car.js';
import { Moto } from '../entities/Moto.js';
import { CarFleet } from '../world/bogota/vehicles.js';
import { BusPassengers } from './BusPassengers.js';
import { MOTO_LATERAL, MotoFleet, motoLoad } from '../world/bogota/motos.js';
import { signalState } from '../world/bogota/TrafficSignals.js';
import {
  PLAYER_RADIUS,
  POLICE_SIGHT_RANGE,
  POLICE_CLOSE_RANGE,
  POLICE_CHASE_SPEED,
  POLICE_CATCH_RANGE,
  POLICE_GIVE_UP_RANGE,
  POLICE_CHASE_TIMEOUT,
} from '../utils/constants.js';
import { SpatialGrid } from '../core/SpatialGrid.js';
import { canReachCombatTarget, hasClearCombatLine } from './CombatGeometry.js';
import { busetaEvery, cruiseSpeedFor, motoThreshold, trafficTargetVehicles } from './trafficDensity.js';

/** Cada nivel de «te tienen fichado» alarga en esta fracción el alcance con que una patrulla ve un robo. */
export const POLICE_SIGHT_PER_WANTED = .25;

const GAP = 1.8;
// Velocidad a la que un carro ya no alcanza a frenar por quien se le cruza corriendo, en m/s.
const RUNOVER_SPEED = 5;
/** Las motos se aprietan más en la cola: son cortas y frenan mejor. */
const MOTO_GAP = 1.1;
// Separación lateral a partir de la cual dos vehículos no se estorban en la distancia del circuito: por debajo de
// esto la caja de la moto (0,72) sí toca la de un carro (1,6), que es lo que mide el margen de `_carInPath`.
const LANE_SEPARATION = 1.31;
// Dos motos solo se estorban si van a menos que esto una de otra: así caben varias de lado en la caja del semáforo.
const MOTO_SEPARATION = .85;
const ACCELERATION = 1.8;
const BRAKING = 2;
// La salida se toma con calma; el freno entra rápido, que a velocidad de avenida no alcanza el tiempo.
const ACCEL_ONSET = 3, BRAKE_ONSET = 12;
const CHASE_ACCELERATION = 3.2;
const PROBE_STEP = 0.5;
const ROUTE_SAMPLE_STEP = 2;
const CHASE_HEIGHT_TOLERANCE = .85;
const CHASE_PROBE_STEP = .25;
const CHASE_STEERING = [0, .45, -.45, .9, -.9, 1.35, -1.35, Math.PI / 2, -Math.PI / 2];
const REJOIN_TIMEOUT = 6;
const REJOIN_NODE_MARGIN = 4;
const REJOIN_CLEAR_RADIUS = 9;
const REJOIN_PERSON_RADIUS = 4;
// A la vista del jugador el salto se nota: aguanta más, sin quedarse trancando la vía para siempre.
const REJOIN_SEEN_RADIUS = 40;
const REJOIN_SEEN_TIMEOUT = 30;
// Más acá del alcance de la niebla nadie ve un carro: se apaga entero y solo avanza por su ruta. La burbuja es ese
// radio más un margen: fuera de ella el vehículo sale de la flota y la ciudad reparte otro cerca del jugador.
const HIDE_MIN_DISTANCE = 120, HIDE_FOG_MARGIN = 30;
// Detalle completo solo cerca: más lejos el carro se dibuja instanciado. Entre las dos distancias no cambia, para
// que parado en el límite no salte de malla.
const CAR_INSTANCE_OUT = 44, CAR_INSTANCE_IN = 36;
// A qué distancia de la vista aparece un carro del montaje diario: fuera de la niebla no se ve el salto.
const RESIZE_SAFE_DISTANCE = 60;
// Cambios de flota por segundo: al cambiar de densidad la ciudad tarda unos segundos, nunca un salto.
const RESIZE_MIN_RATE = 1, RESIZE_MAX_RATE = 24, RESIZE_RATE_PER_MISSING = .5;
// Al llenar una vista nueva se siembran varios carros por cuadro: no hay nada que hacer saltar a la vista.
const FRESH_BURST = 48, FRESH_SECONDS = 2;
// Un salto mayor que esto del centro de la burbuja cambia de barrio: las calles de enfrente no se habían visto.
const FRESH_VIEW_JUMP = 35;
// La burbuja se corre hacia donde mira la cámara: lo de atrás no lo ve nadie y lo de adelante sí.
const BUBBLE_AHEAD = 50;
// Intentos por carro nuevo, cercanía mínima al jugador con cámara, separación entre centros y celda del índice.
const SPAWN_TRIES = 80, SPAWN_NEAR = 14, SPAWN_GAP = 6.5, SPAWN_CELL = 8;
// Mitad del ancho de una franja: más al lado que esto ya es otro carril u otra franja de motos.
const SPAWN_LANE = 1.3;
// Fuera de una vista nueva, un carro solo nace a la vista desde esta fracción de la niebla, donde ya es una mancha.
const SPAWN_VISIBLE_FROM = .6;
// No se entra a un cruce sin sitio al otro lado: desde esta cercanía al cruce se mira un carro de largo más allá de su salida.
const BOX_REACH = 16, BOX_SCAN = 44, BOX_SLACK = 1.5, BOX_SLOW = 2.5, BOX_PATIENCE = 6;
// La caja de las motos en el rojo, solo en Ultra: el primer carro frena BOX_SETBACK más atrás de lo normal y las motos se abren en
// filas de tres delante de él. Los carriles de la caja son desplazamientos laterales respecto al carril: el primero es la
// franja de siempre y los otros dos quedan entre el eje del carril y el borde de los carros parqueados, sin pasar la raya central.
const BOX_LATERALS = Object.freeze([MOTO_LATERAL, .45, -.5]);
const BOX_SETBACK = 9.7, BOX_ROWS = 4, BOX_GAP = .4, BOX_REACH_LINE = 32, BOX_CROSS = 16;
// Desde esta distancia a la línea la moto ya pasó la trompa del primer carro: elige su puesto y se abre hacia él.
// Las filas de carros en una vía de un carril: el carro se acomoda a su fila a esta velocidad lateral, en metros por segundo.
const FILE_STEER = 1;
const BOX_CHOOSE_FROM = BOX_SETBACK - 2, BOX_STEER = 2.5;
// Metros por delante para saber si un carro que nace fuera de la vista va a entrar en ella.
const ENTER_LOOKAHEAD = 30;
// Un carro parado más que esto fuera de la vista se retira: el trancón que se ve se queda, el que no, se despeja.
const STUCK_LIMIT = 45;

function emit(type, detail) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      const event = typeof CustomEvent !== 'undefined' ? new CustomEvent(type, { detail }) : { type, detail };
      window.dispatchEvent(event);
    } catch {}
  }
}

function emitHonk(x, z) { emit('car-honk', { x, z }); }

// Los stops acompañan la desaceleración real o la espera; acelerar despacio no es frenar.
function brakeEngaged(before, after, dt) {
  return after < before - .08 * dt || (after <= .05 && after <= before + 1e-8);
}

export class TrafficSystem {
  constructor(scene, routes, { carsPerRoute = 4, policeCount = 0, random = Math.random } = {}) {
    this.vehicles = [];
    this.wantedLevel = 0; // lo mantiene StealSystem: el nivel de «te tienen fichado»
    this.scene = scene;
    // Sin nivel la flota no cambia de tamaño: el reloj y la densidad los pone el juego, no las pruebas.
    this.densityId = null;
    // Cada cuántos vehículos sale una moto del conteo; la hora lo ajusta en `update`.
    this._motoThreshold = motoThreshold(12);
    this.onVehicleAdded = null;
    this.onVehicleRemoved = null;
    this._resizeCredit = 0;
    this._viewPosition = new THREE.Vector3();
    // Hacia dónde mira la cámara: los carros nuevos se buscan de frente para que la calle se vea viva.
    this._forward = { x: 0, z: -1 };
    // Al cargar y tras un salto grande la ciudad no se ha visto: se puede sembrar el frente sin que nadie note el cambio.
    this._freshTime = FRESH_SECONDS;
    this._lastCenterX = null;
    this._lastCenterZ = null;
    this._lastTarget = null;
    this._center = new THREE.Vector3();
    this._routeCumulative = null;
    this._spawnGrid = new Map();
    this._byOrder = (a, b) => a.order - b.order;
    this._holdPosition = new THREE.Vector3();
    this._holdDirection = new THREE.Vector3();
    this._holdCandidates = [];
    this._pursuitInfo = { distance: 0, dx: 0, dz: 0, closeness: 0, x: 0, z: 0 };
    this.random = random;
    // Los circuitos de partida: sobre ellos se reparte la flota diaria; las alternativas solo reciben a quien cambia de ruta.
    this.startRoutes = routes;
    this.routes = routes.alternatives ?? routes;
    this._arrestDispatched = false;
    this._position = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._probePosition = new THREE.Vector3();
    this._probeDirection = new THREE.Vector3();
    this._signalDirection = new THREE.Vector3();
    this._visualDirection = new THREE.Vector3();
    this._visualPosition = new THREE.Vector3();
    this._time = 0;
    this._nearbyPedestrians = [];
    this._nearbyCars = [];
    this._carGrid = new SpatialGrid();
    this._personGrid = new SpatialGrid();
    this._carCandidates = [];
    this._personCandidates = [];
    this._routeVehicles = new Map();
    this._chaseColliders = [];
    this._chaseBox = new THREE.Box3();
    for (const route of routes) {
      // Evita una población inicial mayor que el espacio disponible en el circuito.
      const count = Math.min(carsPerRoute, Math.floor(route.length / 12));
      for (let i = 0; i < count; i++) {
        const distance = (i + 0.4) * route.length / count;
        this._spawn(scene, route, distance, false);
      }
    }
    // Las patrullas circulan como el resto del tráfico hasta que ven un robo.
    const spawnRoutes = [...routes];
    for (let i = 0; spawnRoutes.length && i < policeCount; i++) {
      const route = spawnRoutes[Math.floor(random() * spawnRoutes.length)];
      this._spawn(scene, route, random() * route.length, true);
    }
  }

  _spawn(scene, route, distance, police) {
    const random = this.random;
    route.sample(distance, this._position, this._direction);
    // La flota sale por conteo y no gasta azar: una de cada doce es buseta, tres de cada diez taxi y una tajada son
    // motos, que suben en las horas pico. Con huellas distintas por modelo, el mismo azar da así siempre el mismo tráfico.
    const count = this._spawnCount = (this._spawnCount ?? 0) + 1;
    // Una de cada cinco es buseta; Ultra sube la tajada de buses. Las motos van aparte y crecen en el pico.
    const buseta = !police && count % busetaEvery(this.densityId) === 0;
    const moto = !police && !buseta && count % 10 >= this._motoThreshold;
    const kind = police ? 'police' : buseta ? 'buseta' : moto ? 'moto' : count * 7 % 10 < 3 ? 'taxi' : 'carro';
    const rotation = Math.atan2(-this._direction.z, this._direction.x);
    // La moto nace ya en su franja, para no saltar al primer cuadro.
    const file = count % 2 ? 1 : -1, lateral = this._fileLateral(route, distance, { moto, wide: buseta, file });
    if (lateral) this._lateral(this._position, this._direction, lateral);
    const car = moto ? this._newMoto(count, rotation)
      : new Car(scene, this._position, rotation, { traffic: true, kind, variant: count * 37 });
    // La vía manda la velocidad: avenida o calle; la moto pica más y la buseta va cargada.
    const cruiseSpeed = cruiseSpeedFor(route, random, { moto, buseta });
    const vehicle = { car, route, order: count, distance, speed: 0, cruiseSpeed, patrolSpeed: cruiseSpeed, nextDistance: distance, nextSpeed: 0,
      acceleration: 0, accelerationLimit: moto ? 4 + random() * .8 : 2.6 + random() * .6, braking: moto ? 4.4 + random() * .6 : 4.2 + random() * .6,
      reactionTime: moto ? .1 + random() * .2 : .18 + random() * .35, resumeDelay: 0, stopped: false,
      routeTimer: 3 + random() * 5, recentRoutes: [route.key], routeChanges: 0,
      lastHonkTime: 0, police, state: 'patrol', chaseTime: 0 };
    // Las motos van por su franja y tienen el hueco de frenado corto, para apretarse en la cola.
    vehicle.file = file; vehicle.wide = buseta;
    if (lateral) vehicle.lateral = lateral;
    if (moto) vehicle.gap = MOTO_GAP;
    this.vehicles.push(vehicle);
    return vehicle;
  }

  /**
   * Desplazamiento lateral con que va un vehículo en ese punto del circuito. En Ultra, las vías de un carril llevan dos filas
   * de carros dentro del carril (la moto va entre ellas si cabe); las anchas, la franja de la moto de siempre.
   */
  _fileLateral(route, distance, { moto, wide, file }) {
    if (this.densityId !== 'ultra') return moto ? MOTO_LATERAL * (route.laneSide ?? 1) : 0;
    const layout = route.layoutAt?.(distance);
    if (!layout) return moto ? MOTO_LATERAL * (route.laneSide ?? 1) : 0;
    return moto ? layout.moto : wide ? layout.wide : file > 0 ? layout.inner : layout.outer;
  }

  /** El carro se acomoda poco a poco a su fila cuando el tramo cambia el reparto. */
  _fileStep(vehicle, dt) {
    const target = this._fileLateral(vehicle.route, vehicle.distance, { moto: false, wide: vehicle.wide, file: vehicle.file });
    const lateral = vehicle.lateral ?? 0;
    if (target === lateral) return;
    vehicle.lateral = lateral + THREE.MathUtils.clamp(target - lateral, -FILE_STEER * dt, FILE_STEER * dt);
  }

  /** Una moto del lote: la carga (gente, cascos, accesorios y color) sale de `motoLoad`, sin gastar azar. */
  _newMoto(count, rotation) {
    this._motoFleet ??= new MotoFleet(this.scene);
    return new Moto(this._position, rotation, motoLoad(count));
  }

  /** Nivel de densidad elegido por el jugador. Sin nivel la flota se queda como la dejó el constructor. */
  setDensity(id) {
    const wasUltra = this.densityId === 'ultra';
    this.densityId = id ?? null;
    // Ultra usa dos carriles por sentido en las vías anchas; cambiar de lado reparte de nuevo la flota sobre los otros circuitos.
    const lanes = this.startRoutes.twoLanes;
    if (lanes && wasUltra !== (this.densityId === 'ultra')) {
      const ultra = this.densityId === 'ultra';
      this.routes = ultra ? lanes.alternatives : this.startRoutes.alternatives ?? this.startRoutes;
      this._routeCumulative = null;
      for (const vehicle of [...this.vehicles]) if (this._canRetire(vehicle)) this._retire(vehicle);
    }
    this._motoThreshold = motoThreshold(12, this.densityId);
    this._resizeCredit = 0;
    this._freshTime = FRESH_SECONDS;
  }

  /** Distancia a la niebla de la escena; 0 cuando la escena no tiene. */
  _fogDistance() {
    const far = this.scene?.fog?.far;
    return Number.isFinite(far) ? far : 0;
  }

  /** Distancia a la que un carro desaparece entero: más allá de la niebla no lo ve nadie. */
  _hideDistance() {
    return Math.max(HIDE_MIN_DISTANCE, this._fogDistance() + HIDE_FOG_MARGIN);
  }

  /** Distancia a la que un carro entra o sale de la flota: dentro de la niebla se vería el salto. */
  _resizeDistance() {
    return Math.max(RESIZE_SAFE_DISTANCE, this._fogDistance());
  }

  /** ¿El punto cae fuera del cono de la cámara? Sin cámara de matriz se exige estar más allá de la niebla. */
  _outOfView(point) {
    const view = this._viewPosition;
    const dx = point.x - view.x, dz = point.z - view.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq > this._hideDistance() ** 2) return true;
    const matrix = this._camera?.matrixWorldInverse?.elements;
    if (!matrix) return distanceSq >= this._resizeDistance() ** 2;
    const cx = matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12];
    const cy = matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13];
    const cz = matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14];
    const depth = -cz;
    if (depth <= 0 || depth > (this._fogDistance() || Infinity)) return true;
    const halfH = Math.tan((this._camera.fov ?? 60) * Math.PI / 360) * depth;
    const halfW = halfH * (this._camera.aspect || 1);
    return Math.abs(cx) > halfW || Math.abs(cy) > halfH;
  }

  /**
   * Detalle y visibilidad de cada carro según su distancia a la vista. De ronda y lejos se dibuja en el lote lejano,
   * que apaga la malla completa; cerca recupera su detalle. Un carro apagado no gasta matrices, sombras, audio ni
   * animación; en la simulación sigue igual que el resto. Una persecución o un regreso se ven aunque estén lejos.
   */
  _updateLod() {
    const view = this._viewPosition, hideSq = this._hideDistance() ** 2;
    for (const vehicle of this.vehicles) {
      const car = vehicle.car, dx = car.position.x - view.x, dz = car.position.z - view.z;
      const distanceSq = dx * dx + dz * dz;
      const onDuty = vehicle.state !== 'patrol' || vehicle.rejoinTarget || vehicle.hold;
      if (!onDuty && distanceSq > hideSq) { car.instanced = false; car.setDrawn(false); continue; }
      // Las motos ya viven en su propio lote a cualquier distancia. Sin cámara no hay a quién esconderle nada.
      const distant = !onDuty && !!this._camera && !car.isMoto &&
        distanceSq > (car.instanced ? CAR_INSTANCE_IN : CAR_INSTANCE_OUT) ** 2;
      if (distant) { car.instanced = true; car.setDrawn(false); continue; }
      car.instanced = false;
      car.setDrawn(true);
      car.updateLod(distanceSq);
    }
  }

  /** Ajusta la flota a lo que pide la hora, a unos pocos carros por segundo y fuera de la vista. */
  _resizeFleet(hour, dt) {
    const target = trafficTargetVehicles(hour, this.densityId);
    // Un salto grande de la hora cambia la ciudad entera: se llena de una vez, como al cargar.
    const last = this._lastTarget;
    if (last === null || Math.abs(target - last) > Math.max(20, last * .15)) this._freshTime = FRESH_SECONDS;
    this._lastTarget = target;
    // Las patrullas no entran en la cuenta: la densidad habla del tráfico particular.
    const civilians = this._countInBubble();
    const missing = target - civilians;
    if (!missing) { this._resizeCredit = 0; return; }
    if (missing > 0) this._indexVehicles();
    if (missing > 0 && this._freshTime > 0) {
      this._freshTime -= dt;
      let added = 0;
      const want = Math.min(missing, FRESH_BURST);
      while (added < want && this._addVehicle()) added++;
      return;
    }
    const rate = Math.min(RESIZE_MAX_RATE, Math.max(RESIZE_MIN_RATE, Math.abs(missing) * RESIZE_RATE_PER_MISSING));
    this._resizeCredit += rate * dt;
    while (this._resizeCredit >= 1) {
      this._resizeCredit -= 1;
      if (!(missing > 0 ? this._addVehicle() : this._removeVehicle())) { this._resizeCredit = 0; break; }
    }
  }

  /** Radio de la burbuja: con cámara llega hasta la niebla, sin ella hasta donde se esconden los carros. */
  _bubbleRadius() {
    return this._camera ? Math.max(RESIZE_SAFE_DISTANCE * 1.5, this._fogDistance()) : this._hideDistance();
  }

  /** Saca de la flota a quien ya dejó atrás la burbuja y cuenta a los civiles que quedan dentro. */
  _countInBubble() {
    const center = this._center, bubbleSq = this._bubbleRadius() ** 2;
    let civilians = 0;
    for (let index = this.vehicles.length - 1; index >= 0; index--) {
      const vehicle = this.vehicles[index];
      const dx = vehicle.car.position.x - center.x, dz = vehicle.car.position.z - center.z;
      if (dx * dx + dz * dz <= bubbleSq) {
        if (!vehicle.police) civilians++;
        continue;
      }
      if (this._canRetire(vehicle)) this._retire(vehicle);
    }
    return civilians;
  }

  /** Índice de celdas con la posición de cada vehículo, para no sembrar un carro encima de otro. */
  _indexVehicles() {
    const grid = this._spawnGrid;
    for (const bucket of grid.values()) bucket.length = 0;
    for (const vehicle of this.vehicles) this._indexSpawn(vehicle.car.position.x, vehicle.car.position.z);
  }

  _indexSpawn(x, z) {
    const key = Math.floor(x / SPAWN_CELL) * 100003 + Math.floor(z / SPAWN_CELL);
    let bucket = this._spawnGrid.get(key);
    if (!bucket) this._spawnGrid.set(key, bucket = []);
    bucket.push(x, z);
  }

  /** ¿Hay otro vehículo en la misma franja a menos de un carro de largo? Los de otro carril no estorban. */
  _crowded(x, z, hx, hz) {
    const cx = Math.floor(x / SPAWN_CELL), cz = Math.floor(z / SPAWN_CELL);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const bucket = this._spawnGrid.get(i * 100003 + j);
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k += 2) {
        const ox = bucket[k] - x, oz = bucket[k + 1] - z;
        if (Math.abs(ox * hx + oz * hz) < SPAWN_GAP && Math.abs(ox * hz - oz * hx) < SPAWN_LANE) return true;
      }
    }
    return false;
  }

  /** El conteo decide el tipo del próximo vehículo (ver `_spawn`), así que se sabe antes de nacer. */
  _nextSpawnIsMoto() {
    const count = (this._spawnCount ?? 0) + 1;
    return count % busetaEvery(this.densityId) !== 0 && count % 10 >= this._motoThreshold;
  }

  _addVehicle() {
    const spot = this._findSpawn();
    if (!spot) return false;
    const vehicle = this._spawn(this.scene, spot.route, spot.distance, false);
    this._indexSpawn(vehicle.car.position.x, vehicle.car.position.z);
    this.onVehicleAdded?.(vehicle.car);
    return true;
  }

  /**
   * Un punto libre de cualquier circuito dentro de la burbuja, elegido por largo de circuito. Con una vista nueva se
   * prefiere el que cae a la vista; después, el que está fuera de ella y entra solo, o el que ya es mancha en la niebla.
   */
  _findSpawn() {
    const routes = this.routes;
    let cumulative = this._routeCumulative;
    if (!cumulative || cumulative.length !== routes.length) {
      let sum = 0;
      cumulative = this._routeCumulative = routes.map(route => sum += route.length);
    }
    const total = cumulative[cumulative.length - 1];
    const center = this._center, view = this._viewPosition, camera = this._camera, fresh = this._freshTime > 0;
    const radiusSq = this._bubbleRadius() ** 2, fog = this._fogDistance() || this._hideDistance();
    const nearSq = (camera ? SPAWN_NEAR : RESIZE_SAFE_DISTANCE) ** 2;
    const position = this._position, direction = this._direction, ahead = this._probePosition;
    let best = null, bestScore = 0;
    for (let tries = 0; tries < SPAWN_TRIES && bestScore < 3; tries++) {
      const pick = this.random() * total;
      let index = 0;
      while (index < cumulative.length - 1 && cumulative[index] < pick) index++;
      const route = routes[index], distance = Math.max(0, route.length - (cumulative[index] - pick));
      route.sample(distance, position, direction);
      const cx = position.x - center.x, cz = position.z - center.z;
      if (cx * cx + cz * cz > radiusSq) continue;
      const dx = position.x - view.x, dz = position.z - view.z, fromViewSq = dx * dx + dz * dz;
      if (fromViewSq < nearSq) continue;
      // Nacer dentro de un cruce es pedir la reserva a la fuerza; fuera de él entra como cualquier otro.
      if (this._nearNode(position)) continue;
      const visible = !!camera && !this._outOfView(position);
      if (visible && !fresh && fromViewSq < (fog * SPAWN_VISIBLE_FROM) ** 2) continue;
      // La moto nace en su franja, no en el eje del carril: ahí es donde puede encimarse con otra.
      const next = (this._spawnCount ?? 0) + 1;
      const strip = this._fileLateral(route, distance, { moto: this._nextSpawnIsMoto(), wide: next % busetaEvery(this.densityId) === 0, file: next % 2 ? 1 : -1 });
      if (this._crowded(position.x + direction.z * strip, position.z - direction.x * strip, direction.x, direction.z)) continue;
      let score = 1;
      if (visible) score = 4;
      else if (camera) {
        ahead.copy(position).addScaledVector(direction, ENTER_LOOKAHEAD);
        if (!this._outOfView(ahead)) score = 3;
      }
      if (score > bestScore) { bestScore = score; best = { route, distance }; }
    }
    return best;
  }

  /** Saca de circulación un carro del montaje: se suelta de los cruces, se avisa y se libera. */
  _retire(vehicle) {
    const index = this.vehicles.indexOf(vehicle);
    this.vehicles.splice(index, 1);
    // Un carro que se va no puede quedar como dueño de un cruce: bloquearía a los demás para siempre.
    this._releaseReservations(vehicle);
    this.onVehicleRemoved?.(vehicle.car);
    vehicle.car.dispose();
  }

  /** ¿Se puede retirar sin dejar a medias una persecución o una espera? */
  _canRetire(vehicle) {
    return !vehicle.police && vehicle.state === 'patrol' && !vehicle.rejoinTarget && !vehicle.hold;
  }

  /** Saca de circulación al que va más lejos de la vista, sin tocar patrullas ni persecuciones. */
  _removeVehicle() {
    const view = this._center;
    let best = null, bestSq = -1;
    for (const vehicle of this.vehicles) {
      if (!this._canRetire(vehicle)) continue;
      const dx = vehicle.car.position.x - view.x, dz = vehicle.car.position.z - view.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > bestSq) { bestSq = distanceSq; best = vehicle; }
    }
    if (!best) return false;
    this._retire(best);
    return true;
  }

  /**
   * Un carro parado mucho rato fuera de la vista se retira y la flota manda otro a un tramo libre. Los trancones que el
   * jugador ve se quedan, como el tráfico de verdad, y se despejan cuando deja de mirar.
   */
  _clearStuck(dt) {
    const view = this._viewPosition, safeSq = this._resizeDistance() ** 2;
    for (const vehicle of this.vehicles) {
      vehicle.stoppedFor = vehicle.speed < .05 ? (vehicle.stoppedFor ?? 0) + dt : 0;
      if (vehicle.stoppedFor < STUCK_LIMIT) continue;
      const dx = vehicle.car.position.x - view.x, dz = vehicle.car.position.z - view.z;
      if (dx * dx + dz * dz < safeSq) continue;
      if (this._canRetire(vehicle)) {
        this._retire(vehicle);
        return; // uno por cuadro, para que la retirada se note como el resto del montaje
      }
      // Una patrulla de ronda no se retira: se la devuelve a un punto libre de su circuito, como al volver de una persecución.
      if (vehicle.police && vehicle.state === 'patrol' && !this._playerWithin(vehicle.car.position, REJOIN_SEEN_RADIUS)) {
        vehicle._rejoinStuck = REJOIN_SEEN_TIMEOUT + 1;
        if (this._forceRejoin(vehicle)) vehicle._rejoinStuck = 0;
      }
    }
  }

  /** Saca al vehículo de las colas, los planes y los dueños de todos los cruces. */
  _releaseReservations(vehicle) {
    for (const state of this.signals?.reservations?.values() ?? []) {
      state.owners.delete(vehicle);
      state.plans.delete(vehicle);
      const index = state.queue.indexOf(vehicle);
      if (index >= 0) state.queue.splice(index, 1);
    }
  }

  /** Metros a los que una patrulla alcanza a ver un robo: cada nivel de fichado los alarga. */
  get sightRange() {
    return POLICE_SIGHT_RANGE * (1 + POLICE_SIGHT_PER_WANTED * this.wantedLevel);
  }

  _canWitness(vehicle, playerPosition) {
    if (Math.abs((playerPosition.y ?? 0) - vehicle.car.position.y) > CHASE_HEIGHT_TOLERANCE) return false;
    if (!hasClearCombatLine({ from: vehicle.car.position, to: playerPosition,
      collisions: this.environment?.collisions, ignoreVehicle: vehicle.car })) return false;
    const dx = playerPosition.x - vehicle.car.position.x;
    const dz = playerPosition.z - vehicle.car.position.z;
    const distSq = dx * dx + dz * dz;
    const sight = this.sightRange;
    if (distSq > sight * sight) return false;
    const dist = Math.sqrt(distSq);
    if (dist <= POLICE_CLOSE_RANGE) return true;
    const yaw = vehicle.car.group.rotation.y;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    return (fx * dx + fz * dz) / dist > 0.2;
  }

  /** ¿Alguna patrulla tiene al jugador a la vista (cerca o de frente)? */
  witnessesTheft(playerPosition) {
    if (!playerPosition) return false;
    return this.vehicles.some(vehicle => vehicle.police && vehicle.state === 'patrol' && this._canWitness(vehicle, playerPosition));
  }

  /** Pasa a persecución a las patrullas que ven el robo. */
  alertForTheft(playerPosition) {
    if (!playerPosition) return false;
    let alerted = false;
    for (const vehicle of this.vehicles) {
      if (!vehicle.police || vehicle.state !== 'patrol' || !this._canWitness(vehicle, playerPosition)) continue;
      this._startChase(vehicle);
      alerted = true;
    }
    return alerted;
  }

  _startChase(vehicle) {
    vehicle.state = 'chase';
    vehicle.chaseTime = 0;
    vehicle.cruiseSpeed = POLICE_CHASE_SPEED;
    vehicle.impactStop = false;
    vehicle.car.pursuit = true;
    vehicle._chaseSteerTime = 0;
    vehicle.rejoinTarget = null;
  }

  /** Consultas del distrito activo: la cota conserva la planta de calle o del viaducto. */
  setEnvironment({ collisions = null, getGroundHeight = null, getWaterInfo = null } = {}) {
    this.environment = { collisions, getGroundHeight, getWaterInfo };
  }

  /** Tras una captura o al escapar, todas las patrullas vuelven a rondar. */
  endPursuit() {
    this._arrestDispatched = false;
    for (const vehicle of this.vehicles) {
      if (vehicle.police && vehicle.state !== 'patrol') this._returnToPatrol(vehicle);
    }
  }

  get inPursuit() {
    return this.vehicles.some(vehicle => vehicle.police && vehicle.state === 'chase');
  }

  /**
   * La patrulla en persecución más cercana, o null. `dx` y `dz` van de la patrulla hacia el jugador; `closeness` va
   * de 0 (a la distancia en que desiste) a 1 (a la distancia en que arresta): el arresto ocurre por distancia, no por
   * tiempo. Se llama cada cuadro desde la interfaz y devuelve siempre el mismo objeto.
   */
  get pursuitInfo() {
    let nearest = null, distance = Infinity;
    for (const vehicle of this.vehicles) {
      if (!vehicle.police || vehicle.state !== 'chase') continue;
      const d = vehicle._chaseDist ?? POLICE_GIVE_UP_RANGE;
      if (d < distance) { distance = d; nearest = vehicle; }
    }
    if (!nearest) return null;
    const info = this._pursuitInfo;
    info.distance = distance;
    info.dx = nearest._chaseDx ?? 0;
    info.dz = nearest._chaseDz ?? 0;
    info.closeness = Math.max(0, Math.min(1, (POLICE_GIVE_UP_RANGE - distance) / (POLICE_GIVE_UP_RANGE - POLICE_CATCH_RANGE)));
    info.x = nearest.car.position.x;
    info.z = nearest.car.position.z;
    return info;
  }

  _returnToPatrol(vehicle) {
    vehicle.state = 'patrol';
    vehicle.chaseTime = 0;
    vehicle.speed = vehicle.nextSpeed = vehicle.acceleration = 0;
    vehicle.cruiseSpeed = vehicle.patrolSpeed;
    vehicle.stopped = false;
    vehicle.resumeDelay = vehicle.reactionTime;
    vehicle.car.pursuit = false;
    vehicle._chaseSteerTime = 0;
    this._snapToNearestRoute(vehicle);
  }

  _snapToNearestRoute(vehicle) {
    if (!this.routes.length) return;
    let bestRoute = this.routes[0], bestDistance = 0, bestScore = Infinity;
    for (const route of this.routes) {
      for (let d = 0; d < route.length; d += ROUTE_SAMPLE_STEP) {
        route.sample(d, this._probePosition, this._probeDirection);
        const dx = this._probePosition.x - vehicle.car.position.x;
        const dz = this._probePosition.z - vehicle.car.position.z;
        const dy = this._probePosition.y - vehicle.car.position.y;
        const score = dx * dx + dz * dz + dy * dy * 25;
        if (score < bestScore) { bestScore = score; bestRoute = route; bestDistance = d; }
      }
    }
    // No volver dentro de un cruce: ahí entra sin reserva y sobre la trayectoria de otro.
    for (let tries = 0; tries < 30; tries++) {
      bestRoute.sample(bestDistance, this._probePosition, this._probeDirection);
      if (!this._nearNode(this._probePosition)) break;
      bestDistance = (bestDistance + 3) % bestRoute.length;
    }
    vehicle.route = bestRoute;
    vehicle.distance = vehicle.nextDistance = bestDistance;
    vehicle.recentRoutes = [bestRoute.key];
    bestRoute.sample(bestDistance, this._position, this._direction);
    if (this.environment && vehicle.car.position.distanceTo(this._position) > .2) {
      // Regresar al carril también es movimiento físico; no saltar una manzana ni cambiar de planta.
      vehicle.rejoinTarget = this._position.clone();
      vehicle._rejoinStuck = 0;
      return;
    }
    vehicle.rejoinTarget = null;
    vehicle.car.position.copy(this._position);
    vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
  }

  _nearNode(point) {
    const nodes = this.signals?.nodes;
    if (!nodes) return false;
    for (const node of nodes) {
      if (point.x >= node.x0 - REJOIN_NODE_MARGIN && point.x <= node.x1 + REJOIN_NODE_MARGIN &&
        point.z >= node.z0 - REJOIN_NODE_MARGIN && point.z <= node.z1 + REJOIN_NODE_MARGIN) return true;
    }
    return false;
  }

  _vehicleNear(point, vehicle, list) {
    if (!list) return false;
    for (const other of list) {
      if (other !== vehicle && other.car.position.distanceToSquared(point) < REJOIN_CLEAR_RADIUS ** 2) return true;
    }
    return false;
  }

  _playerWithin(point, radius) {
    const player = this._playerPosition;
    if (!player) return false;
    return (player.x - point.x) ** 2 + (player.z - point.z) ** 2 < radius ** 2;
  }

  _personNear(point) {
    if (this._playerWithin(point, REJOIN_PERSON_RADIUS)) return true;
    if (!this._personGrid) return false;
    const r = REJOIN_PERSON_RADIUS;
    this._personGrid.query(point.x - r, point.z - r, point.x + r, point.z + r, this._personCandidates);
    return this._personCandidates.some(({ position }) => (position.x - point.x) ** 2 + (position.z - point.z) ** 2 < r * r);
  }

  /** Con un bus parado al lado no aguanta los 30 s: el bus no sale de ahí mientras la patrulla siga contra su costado. */
  _blocksBus(vehicle) {
    const { position } = vehicle.car;
    return (this.busVehicles ?? []).some(({ car }) => car.speed < .1 && Math.abs(car.position.y - position.y) < 3 &&
      Math.hypot(car.position.x - position.x, car.position.z - position.z) < car.length / 2 + 6);
  }

  /**
   * Tope del regreso a ojo: si lleva rato sin avanzar (un poste, o un carro que justo espera a que él se quite), entra
   * a su carril en el primer punto libre, sin cruce, vehículos ni personas cerca. A la vista del jugador espera más y
   * busca un punto lejos de él. Si no lo hay en toda la ruta, sigue esperando.
   */
  _forceRejoin(vehicle) {
    const overdue = vehicle._rejoinStuck > REJOIN_SEEN_TIMEOUT || this._blocksBus(vehicle);
    if (!overdue && this._playerWithin(vehicle.car.position, REJOIN_SEEN_RADIUS)) return false;
    const { route } = vehicle, point = this._position;
    let distance = vehicle.distance;
    for (let walked = 0; walked < route.length; walked += 3, distance = (distance + 3) % route.length) {
      route.sample(distance, point, this._direction);
      if ((!overdue && this._playerWithin(point, REJOIN_SEEN_RADIUS)) || this._nearNode(point) || this._personNear(point) ||
        this._vehicleNear(point, vehicle, this.vehicles) || this._vehicleNear(point, vehicle, this.parkedCars) ||
        this._vehicleNear(point, vehicle, this.busVehicles)) continue;
      vehicle.distance = vehicle.nextDistance = distance;
      vehicle.car.position.copy(point);
      vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
      vehicle.rejoinTarget = null;
      vehicle.speed = vehicle.nextSpeed = 0;
      return true;
    }
    vehicle._rejoinStuck = 0;
    return false;
  }

  /** Muestreo exclusivamente visual: no escribe el rumbo físico ni la planificación del tráfico. */
  _animateRoute(vehicle, distance, dt, previousSpeed) {
    const { car, route, speed } = vehicle;
    const context = vehicle._driveContext ??= {};
    const yaw = car.group.rotation.y;
    route.sample(vehicle.distance + .65, this._visualPosition, this._visualDirection);
    const heading = Math.atan2(-this._visualDirection.z, this._visualDirection.x);
    const curve = Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw)) / .65;
    context.steering = Math.atan(curve * (car.vehicle?.wheelbase ?? car.length * .58));
    route.sample(vehicle.distance + Math.max(6, speed * 1.3), this._visualPosition, this._visualDirection);
    const ahead = Math.atan2(-this._visualDirection.z, this._visualDirection.x);
    const turn = Math.atan2(Math.sin(ahead - yaw), Math.cos(ahead - yaw));
    context.turnSignal = Math.abs(turn) > .12 ? (turn > 0 ? 'left' : 'right')
      : Math.abs(context.steering) > .08 ? (context.steering > 0 ? 'left' : 'right') : null;
    context.dt = dt;
    context.speed = speed;
    context.acceleration = (speed - previousSpeed) / dt;
    car.animateDrive(distance, brakeEngaged(previousSpeed, speed, dt), context);
  }

  _personInCar(position, car) {
    const dx = position.x - this._probePosition.x, dz = position.z - this._probePosition.z;
    const forward = dx * this._probeDirection.x + dz * this._probeDirection.z;
    const sideways = dx * -this._probeDirection.z + dz * this._probeDirection.x;
    // Incluye el radio del peatón y un margen de frenado alrededor de la carrocería.
    return Math.abs(forward) < car.length / 2 + 0.8 && Math.abs(sideways) < car.width / 2 + 0.55;
  }

  _personAtNose(position, car) {
    const dx = position.x - car.position.x, dz = position.z - car.position.z;
    const hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
    const forward = dx * hx + dz * hz, sideways = -dx * hz + dz * hx;
    return forward > car.length / 2 - .75 && forward < car.length / 2 + 2.5 &&
      Math.abs(sideways) < car.width / 2 + .55;
  }

  setBus(bus) {
    this.busVehicles = [bus].flat().filter(Boolean).map(vehicle => ({ car: vehicle,
      get heading() { return vehicle.heading ?? { x: 0, z: -1 }; } }));
    this.busVehicle = this.busVehicles[0] ?? null;
  }

  setParkedCars(cars) { this.parkedCars = cars.map(car => ({ car })); }

  /**
   * Detiene un carro en su carril de forma gradual (p. ej. el conductor se baja) o lo libera.
   * @returns {object|null} el vehículo de tráfico
   */
  hold(car, held = true) {
    const vehicle = this.vehicles.find(v => v.car === car) ?? null;
    if (vehicle) vehicle.hold = held;
    return vehicle;
  }

  _chooseRoute(vehicle) {
    if (vehicle.crossingNode) return false;
    if (this.routes.length < 2) return false;
    const position = this._position, direction = this._direction;
    vehicle.route.sample(vehicle.distance, position, direction);
    if (Math.min(Math.abs(direction.x), Math.abs(direction.z)) > 1e-6) return false;
    const options = [];
    const margin = vehicle.car.length / 2 + 1;
    for (const route of this.routes) {
      if (route === vehicle.route || route.key === vehicle.route.key || route.lane !== vehicle.route.lane || vehicle.recentRoutes.includes(route.key)) continue;
      let start = 0;
      for (const segment of route.segments) {
        if (!segment.radius && Math.abs(segment.dx - direction.x) < 1e-6 && Math.abs(segment.dz - direction.z) < 1e-6) {
          const dx = position.x - segment.x, dz = position.z - segment.z;
          const along = dx * segment.dx + dz * segment.dz;
          const across = dx * -segment.dz + dz * segment.dx;
          if (Math.abs(across) < 1e-5 && along > margin && along < segment.length - margin) options.push({ route, distance: start + along });
        }
        start += segment.length;
      }
    }
    if (!options.length) return false;
    const selected = options[Math.min(options.length - 1, Math.floor(this.random() * options.length))];
    vehicle.route = selected.route;
    vehicle.distance = selected.distance;
    vehicle.recentRoutes.push(selected.route.key);
    if (vehicle.recentRoutes.length > 3) vehicle.recentRoutes.shift();
    vehicle.routeChanges++;
    return true;
  }

  _carInPath(other, car) {
    if (Math.abs(other.car.position.y - car.position.y) > 3) return false;
    // Quien viene detrás no estorba, tampoco en una curva, donde ya no van paralelos: avanzar solo aleja de él.
    // Sin esto, el que dobla y el que lo sigue se esperan mutuamente sin límite.
    const yaw = car.group.rotation.y;
    if ((other.car.position.x - car.position.x) * Math.cos(yaw) - (other.car.position.z - car.position.z) * Math.sin(yaw) <= 0) return false;
    const dx = other.car.position.x - this._probePosition.x, dz = other.car.position.z - this._probePosition.z;
    const headingX = other.heading?.x ?? Math.cos(other.car.group.rotation.y);
    const headingZ = other.heading?.z ?? -Math.sin(other.car.group.rotation.y);
    const along = Math.abs(headingX * this._probeDirection.x + headingZ * this._probeDirection.z);
    const across = Math.abs(headingX * -this._probeDirection.z + headingZ * this._probeDirection.x);
    const front = dx * this._probeDirection.x + dz * this._probeDirection.z;
    const side = dx * -this._probeDirection.z + dz * this._probeDirection.x;
    const headingDot = headingX * this._probeDirection.x + headingZ * this._probeDirection.z;
    // Un seguidor en el mismo carril no debe bloquear al carro que lleva delante.
    if (headingDot > .9 && front <= 0) return false;
    const margin = along > .9 ? GAP : .35;
    if (Math.abs(front) >= car.length / 2 + along * other.car.length / 2 + across * other.car.width / 2 + margin ||
      Math.abs(side) >= car.width / 2 + across * other.car.length / 2 + along * other.car.width / 2 + .15) return false;
    // Cruzados en ángulo, proyectar solo sobre los ejes propios agranda al otro: una buseta en el carril
    // contrario frenaría a quien termina de doblar. También se separan por los ejes del otro.
    const otherFront = dx * headingX + dz * headingZ, otherSide = -dx * headingZ + dz * headingX;
    return Math.abs(otherFront) < other.car.length / 2 + along * car.length / 2 + across * car.width / 2 + margin &&
      Math.abs(otherSide) < other.car.width / 2 + across * car.length / 2 + along * car.width / 2 + .15;
  }

  _overlapsNode(car, node, heading = null) {
    const c = Math.abs(heading?.x ?? Math.cos(car.group.rotation.y)), s = Math.abs(heading?.z ?? Math.sin(car.group.rotation.y));
    const x = c * car.length / 2 + s * car.width / 2;
    const z = s * car.length / 2 + c * car.width / 2;
    return car.position.x + x > node.x0 && car.position.x - x < node.x1 &&
      car.position.z + z > node.z0 && car.position.z - z < node.z1;
  }

  _coordinateIntersections() {
    if (!this.signals?.reservations) return;
    const grid = this._nodeGrid ??= new SpatialGrid();
    grid.clear();
    for (const vehicle of this.vehicles) {
      vehicle.crossingNode = null;
      if (vehicle.state === 'chase' || vehicle.rejoinTarget) continue;
      grid.insert(vehicle, vehicle.car.position.x, vehicle.car.position.z);
    }
    const near = this._nodeNear ??= [];
    for (const node of this.signals.nodes) {
      let state = this.signals.reservations.get(node);
      if (!state) {
        state = { owners: new Map(), plans: new Map(), queue: [] };
        this.signals.reservations.set(node, state);
      }
      const candidates = [];
      // Solo los que están a menos de un carro largo y 18 m del cruce: el índice evita mirar a toda la flota por cada cruce.
      grid.query(node.x0 - 28, node.z0 - 28, node.x1 + 28, node.z1 + 28, near).sort(this._byOrder);
      for (const vehicle of near) {
        if (this._overlapsNode(vehicle.car, node)) { candidates.push(vehicle); continue; }
        // Fuera de este radio no puede solicitar el cruce en los próximos metros.
        const dx = Math.max(node.x0 - vehicle.car.position.x, 0, vehicle.car.position.x - node.x1);
        const dz = Math.max(node.z0 - vehicle.car.position.z, 0, vehicle.car.position.z - node.z1);
        if (dx * dx + dz * dz > 18 * 18) continue;
        for (let ahead = 1; ahead <= 18; ahead += 1) {
          vehicle.route.sample(vehicle.distance + ahead, this._probePosition, this._probeDirection);
          if (this._probePosition.x >= node.x0 && this._probePosition.x <= node.x1 && this._probePosition.z >= node.z0 && this._probePosition.z <= node.z1) {
            candidates.push(vehicle); break;
          }
        }
      }
      state.queue = state.queue.filter(vehicle => candidates.includes(vehicle));
      for (const vehicle of candidates) if (!state.queue.includes(vehicle)) state.queue.push(vehicle);
      // La patrulla que vuelve entra de última a la cola, pero puede quedar adelante en el carril: el de atrás tendría
      // la reserva sin poder usarla y quien la necesita esperaría para siempre. En un carril, primero el de adelante.
      for (let i = 0; i < state.queue.length; i++) for (let j = i + 1; j < state.queue.length; j++) {
        const a = state.queue[i], b = state.queue[j];
        if (this._aheadInLane(a, b)) { state.queue[i] = b; state.queue[j] = a; }
      }
      for (const [vehicle, claim] of state.owners) {
        const overlaps = this._overlapsNode(vehicle.car, node);
        claim.entered ||= overlaps;
        if ((claim.entered && !overlaps) || (!claim.entered &&
          (signalState(this.signals.time, claim.plan.axis) !== 0 || !candidates.includes(vehicle)))) state.owners.delete(vehicle);
        else if (claim.entered) claim.from = this._planProgress(vehicle.car, claim.plan);
      }
      for (const vehicle of state.plans.keys()) if (!candidates.includes(vehicle) && !state.owners.has(vehicle)) state.plans.delete(vehicle);
      for (const vehicle of candidates) if (!state.plans.has(vehicle)) state.plans.set(vehicle, this._crossingPlan(vehicle, node));
      const busInside = this.busVehicle?.car.group.visible && this.busVehicle.car.position.y < 3 && this._overlapsNode(this.busVehicle.car, node, this.busVehicle.heading);
      const bus = this.busVehicle?.car;
      const busCrossingX = bus?.pathX?.(node.z1, bus.laneX) ?? bus?.position.x;
      const busApproaching = bus?.group.visible && bus.position.y < 3 && bus.position.z > node.z1 &&
        bus.position.z < node.z1 + bus.length / 2 + 15 && busCrossingX >= node.x0 && busCrossingX <= node.x1;
      const busClaims = busInside || (busApproaching && signalState(this.signals.time, 1) === 0);
      if (bus && !state.busPlan) {
        state.busPlan = { width: bus.width, points: [], axis: 1 };
        for (let z = node.z1 + bus.length / 2; z >= node.z0 - bus.length / 2; z -= .75) state.busPlan.points.push({ x: bus.pathX?.(z, bus.laneX) ?? bus.position.x, z });
      }
      if (busClaims) for (const [vehicle, claim] of state.owners) {
        if (!claim.entered && this._pathsConflict(claim.plan, state.busPlan)) state.owners.delete(vehicle);
      }
      // Los que ya cruzan despejan primero. La cola solo da prioridad entre
      // trayectorias que se cortan: sentidos opuestos y convoyes pueden avanzar juntos.
      const waiting = [];
      const ordered = [...state.queue].sort((a, b) => Number(this._overlapsNode(b.car, node)) - Number(this._overlapsNode(a.car, node)));
      for (const vehicle of ordered) {
        if (state.owners.has(vehicle)) continue;
        const plan = state.plans.get(vehicle), entered = this._overlapsNode(vehicle.car, node);
        if (!entered && signalState(this.signals.time, plan.axis) !== 0) continue;
        const blocked = (busClaims && this._pathsConflict(plan, state.busPlan)) ||
          [...state.owners.values()].some(claim => this._claimConflict(plan, claim)) ||
          waiting.some(earlier => this._pathsConflict(plan, earlier));
        if (blocked && !entered) waiting.push(plan);
        else state.owners.set(vehicle, { entered, plan });
      }
      state.busBlocked = !!state.busPlan && [...state.owners.values()].some(claim => this._pathsConflict(claim.plan, state.busPlan));
      for (const vehicle of state.queue) vehicle.crossingNode ??= node;
    }
  }

  /** ¿`b` va delante de `a` en su carril? Dos rutas distintas pueden compartir el mismo tramo. */
  _aheadInLane(a, b) {
    if (a.route === b.route) return (b.distance - a.distance + a.route.length) % a.route.length < 40;
    const yaw = a.car.group.rotation.y;
    if (Math.cos(yaw - b.car.group.rotation.y) < .9) return false;
    const hx = Math.cos(yaw), hz = -Math.sin(yaw);
    const dx = b.car.position.x - a.car.position.x, dz = b.car.position.z - a.car.position.z;
    const ahead = dx * hx + dz * hz;
    return ahead > 0 && ahead < 40 && Math.abs(dz * hx - dx * hz) < 1;
  }

  _crossingPlan(vehicle, node) {
    const { route, distance, car } = vehicle;
    const pad = Math.hypot(car.length, car.width) / 2 + .4;
    const inside = point => point.x >= node.x0 - pad && point.x <= node.x1 + pad && point.z >= node.z0 - pad && point.z <= node.z1 + pad;
    let entry = 0;
    for (; entry < 30; entry += .75) {
      route.sample(distance + entry, this._probePosition, this._probeDirection);
      if (inside(this._probePosition)) break;
    }
    for (; entry > -30; entry -= .75) {
      route.sample(distance + entry - .75, this._probePosition, this._probeDirection);
      if (!inside(this._probePosition)) break;
    }
    // Dos cruces del desvío se montan sobre la carrera vecina. Lo que cae en el más angosto lo arbitra ese:
    // si no, quien espera el rojo de la carrera le quita el verde del cruce ancho a los que pasan por ella.
    const span = other => other.x1 - other.x0;
    const narrower = this.signals.nodes.filter(other => other !== node && span(other) < span(node) &&
      other.x0 < node.x1 && other.x1 > node.x0 && other.z0 < node.z1 && other.z1 > node.z0);
    const delegated = point => narrower.some(other => point.x >= other.x0 - pad && point.x <= other.x1 + pad && point.z >= other.z0 - pad && point.z <= other.z1 + pad);
    const plan = { points: [], width: car.width, axis: 0, compatible: new WeakMap() };
    for (let ahead = entry; ahead < entry + 100; ahead += .75) {
      route.sample(distance + ahead, this._probePosition, this._probeDirection);
      if (!inside(this._probePosition)) break;
      if (plan.hx === undefined) {
        plan.hx = this._probeDirection.x; plan.hz = this._probeDirection.z;
        plan.axis = Math.abs(plan.hx) >= Math.abs(plan.hz) ? 0 : 1;
      }
      if (!delegated(this._probePosition)) plan.points.push({ x: this._probePosition.x, z: this._probePosition.z });
    }
    return plan;
  }

  /** Primer punto de la trayectoria que el carro todavía no ha dejado atrás con la cola. */
  _planProgress(car, plan) {
    const hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
    const behind = car.length / 2 + .75;
    let index = 0;
    while (index < plan.points.length && (plan.points[index].x - car.position.x) * hx + (plan.points[index].z - car.position.z) * hz < -behind) index++;
    return index;
  }

  /** Quien ya está dentro solo reserva lo que le falta: el tramo que dejó atrás ya no le estorba a nadie. */
  _claimConflict(plan, claim) {
    if (!this._pathsConflict(plan, claim.plan)) return false;
    if (!claim.from) return true;
    const margin = (plan.width + claim.plan.width) / 2 + .5;
    for (let index = claim.from; index < claim.plan.points.length; index++) {
      const p = claim.plan.points[index];
      if (plan.points.some(q => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < margin ** 2)) return true;
    }
    return false;
  }

  _pathsConflict(a, b) {
    if (a === b) return false;
    const cached = a.compatible?.get(b);
    if (cached !== undefined) return cached;
    const startA = a.points[0], startB = b.points[0];
    // Una misma entrada permite seguir al líder; el control de distancia impide alcanzarlo. Solo cuenta la separación
    // lateral: cada plan empieza según la huella de su carro, y una buseta y un sedán del mismo carril no coinciden.
    const sameEntry = startA && startB && a.hx * b.hx + a.hz * b.hz > .99 &&
      Math.abs((startB.x - startA.x) * -a.hz + (startB.z - startA.z) * a.hx) < 1.2;
    const margin = (a.width + b.width) / 2 + .5;
    const conflict = !sameEntry && a.points.some(p => b.points.some(q => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < margin ** 2));
    a.compatible?.set(b, conflict); b.compatible?.set(a, conflict);
    return conflict;
  }

  _clearance(vehicle, player, pedestrians) {
    if (!this._updating) this._buildSpatialIndex(pedestrians);
    const { route, car, distance, speed } = vehicle;
    const lateral = vehicle.lateral ?? 0, followGap = vehicle.gap ?? GAP;
    vehicle.personBlocked = false;
    vehicle.playerClearance = Infinity;
    const finish = hardClearance => {
      vehicle.hardClearance = hardClearance;
      return Math.min(hardClearance, vehicle.playerClearance);
    };
    let clearance = Infinity;
    for (const other of this._routeVehicles.get(route) ?? []) {
      if (other === vehicle || other.route !== route) continue;
      // Cada franja es su propia línea: dos que van a carriles distintos no se estorban en la distancia del circuito,
      // y quien se acerca a la franja ajena ya lo frena el hueco físico de `_carInPath`. Sin esto, el carro que ve
      // pasar una moto frena hasta parar, porque el hueco se mide solo sobre el carril.
      if (car.isMoto && other.car.isMoto) continue;
      if (Math.abs(lateral - (other.lateral ?? 0)) > LANE_SEPARATION) continue;
      const ahead = (other.distance - distance + route.length) % route.length;
      clearance = Math.min(clearance, Math.max(0, ahead - (car.length + other.car.length) / 2 - followGap));
    }
    // Mira también alrededor de los giros; no solo en línea recta frente al carro.
    const lookAhead = Math.max(7, speed * speed / (2 * (vehicle.braking ?? BRAKING)) + speed * .8 + 2);
    // Descarte amplio y conservador una vez por carro, no por cada muestra de su ruta.
    // Incluye toda la diagonal de la carrocería y el trayecto hasta el punto de frenado.
    const radius = lookAhead + Math.hypot(car.length / 2 + 0.8, car.width / 2 + 0.55);
    const nearby = this._nearbyPedestrians;
    const nearbyCars = this._nearbyCars ??= [];
    nearby.length = 0;
    nearbyCars.length = 0;
    const minX = car.position.x - radius, maxX = car.position.x + radius;
    const minZ = car.position.z - radius, maxZ = car.position.z + radius;
    this._carGrid.query(minX, minZ, maxX, maxZ, this._carCandidates);
    const yaw = car.group?.rotation.y ?? 0, yawCos = Math.cos(yaw), yawSin = Math.sin(yaw);
    for (const other of this._carCandidates) {
      if (other === vehicle) continue;
      // Entre motos del mismo rumbo manda la geometría: dos vehículos pueden ir por rutas distintas y estar en la misma franja.
      if (car.isMoto && other.car.isMoto) {
        const otherYaw = other.car.group.rotation.y;
        if (Math.cos(otherYaw) * yawCos + Math.sin(otherYaw) * yawSin > .9) {
          const dx = other.car.position.x - car.position.x, dz = other.car.position.z - car.position.z;
          const along = dx * yawCos - dz * yawSin, side = -dx * yawSin - dz * yawCos;
          if (Math.abs(side) < MOTO_SEPARATION && (along > .05 || (along > -.05 && other.order < vehicle.order))) {
            clearance = Math.min(clearance, Math.max(0, along - (car.length + other.car.length) / 2 - followGap));
          }
          continue;
        }
      }
      if ((other.route === route && other.state !== 'chase' && !other.rejoinTarget)) continue;
      if (other.car.position.distanceToSquared(car.position) > (radius + other.car.length) ** 2) continue;
      // Los dos descartes de `_carInPath` sobre el rumbo del carro: quien está atrás o a otra altura no estorba en ninguna muestra.
      if (Math.abs(other.car.position.y - car.position.y) > 3) continue;
      if ((other.car.position.x - car.position.x) * yawCos - (other.car.position.z - car.position.z) * yawSin <= 0) continue;
      nearbyCars.push(other);
    }
    this._personGrid.query(minX, minZ, maxX, maxZ, this._personCandidates);
    for (const pedestrian of this._personCandidates) {
      const dx = pedestrian.position.x - car.position.x, dz = pedestrian.position.z - car.position.z;
      // Quien cruza corriendo y sin mirar (un evento raro) no lo ve venir un carro que ya va rápido: no frena por él.
      if (pedestrian.runoverDoom && speed > RUNOVER_SPEED) continue;
      if (dx * dx + dz * dz <= radius * radius) nearby.push(pedestrian);
    }
    // Estar junto al frente también obstruye a un conductor detenido por rojo
    // o por otro carro: no depender del primer motivo de frenado encontrado.
    vehicle.personBlocked = (!!player && this._personAtNose(player, car)) ||
      nearby.some(pedestrian => this._personAtNose(pedestrian.position, car));
    // La señal corresponde al acceso actual, no al rumbo futuro tras doblar.
    const signalDirection = this._signalDirection ??= new THREE.Vector3();
    // Solo cuentan los cruces al alcance del frenado: casi todos los vehículos no tienen ninguno cerca.
    const nodes = this._nearNodes ??= [];
    nodes.length = 0;
    const reach = lookAhead + car.length + 2;
    for (const node of this.signals?.nodes ?? []) {
      if (car.position.x >= node.x0 - reach && car.position.x <= node.x1 + reach &&
        car.position.z >= node.z0 - reach && car.position.z <= node.z1 + reach) nodes.push(node);
    }
    const playerNear = !!player && (player.x - car.position.x) ** 2 + (player.z - car.position.z) ** 2 <= (radius + 2) ** 2;
    // Sin cruce, carro, persona ni jugador al alcance, la muestra del camino no tiene qué encontrar.
    const legacy = !!this.signals && !this.signals.nodes;
    if (!legacy && !nodes.length && !nearbyCars.length && !nearby.length && !playerNear) return finish(clearance);
    const held = nodes.length && !car.isMoto ? this._boxHold(vehicle, nodes) : null;
    const setback = car.isMoto || this.densityId !== 'ultra' ? 0 : BOX_SETBACK;
    if (this.signals) route.sample(distance, this._probePosition, signalDirection);
    for (let ahead = 0; ahead <= Math.min(lookAhead, clearance); ahead += PROBE_STEP) {
      route.sample(distance + ahead, this._probePosition, this._probeDirection);
      if ((nodes.length || legacy) && this.signals.blocks(this._probePosition, signalDirection, car.position, car.length, vehicle, nodes, held, setback)) return finish(Math.max(0, ahead - PROBE_STEP));
      // El semáforo se mira sobre el carril: la franja de la moto no puede dejar el cruce fuera de su alcance.
      if (lateral) this._lateral(this._probePosition, this._probeDirection, lateral);
      if (player && vehicle.playerClearance === Infinity && this._personInCar(player, car)) {
        vehicle.personBlocked ||= ahead <= 10;
        vehicle.playerClearance = Math.max(0, ahead - PROBE_STEP);
      }
      for (const other of nearbyCars) if (this._carInPath(other, car)) return finish(Math.max(0, ahead - PROBE_STEP));
      for (const pedestrian of nearby) {
        if (this._personInCar(pedestrian.position, car)) {
          vehicle.personBlocked ||= ahead <= 10;
          return finish(Math.max(0, ahead - PROBE_STEP));
        }
      }
    }
    return finish(clearance);
  }

  /**
   * El cruce que este vehículo no debe pisar todavía: al otro lado de su salida no cabe un carro. Sin esto la cola de
   * la calle de enfrente se mete en el cruce y se traba toda la ciudad. Las motos pasan por el costado y no cuentan.
   */
  _boxHold(vehicle, nodes) {
    // Esperar eternamente por un hueco es un abrazo mortal entre colas: pasado un rato se entra de todos modos.
    // Cada conductor aguanta distinto: los trancones se aflojan de a uno, no todos a la vez.
    if ((vehicle.stoppedFor ?? 0) > BOX_PATIENCE + vehicle.order * 37 % 20) return null;
    const { route, car, distance } = vehicle, p = car.position;
    const probe = this._holdPosition ??= new THREE.Vector3(), direction = this._holdDirection ??= new THREE.Vector3();
    for (const node of nodes) {
      if (p.x >= node.x0 && p.x <= node.x1 && p.z >= node.z0 && p.z <= node.z1) continue;
      const dx = Math.max(node.x0 - p.x, 0, p.x - node.x1), dz = Math.max(node.z0 - p.z, 0, p.z - node.z1);
      if (dx * dx + dz * dz > BOX_REACH * BOX_REACH) continue;
      if (this.signals.reservations.get(node)?.owners.get(vehicle)?.entered) continue;
      let entered = false, exit = -1;
      for (let along = 0; along <= BOX_SCAN; along++) {
        route.sample(distance + along, probe, direction);
        const inside = probe.x >= node.x0 && probe.x <= node.x1 && probe.z >= node.z0 && probe.z <= node.z1;
        if (inside) entered = true;
        else if (entered) { exit = along; break; }
      }
      if (exit < 0) continue;
      const half = (car.length + BOX_SLACK) / 2;
      route.sample(distance + exit + half, probe, direction);
      const found = this._carGrid.query(probe.x - 12, probe.z - 12, probe.x + 12, probe.z + 12, this._holdCandidates ??= []);
      for (const other of found) {
        if (other === vehicle || other.car.isMoto || (other.speed ?? 0) > BOX_SLOW) continue;
        const ox = other.car.position.x - probe.x, oz = other.car.position.z - probe.z;
        const along = ox * direction.x + oz * direction.z, side = ox * direction.z - oz * direction.x;
        if (Math.abs(side) < SPAWN_LANE && Math.abs(along) < half + other.car.length / 2 - .3) return node;
      }
    }
    return null;
  }

  /** Metros hasta donde frena esta moto por el semáforo, o null si no hay ninguno al alcance: se mira sobre el carril. */
  _lineAhead(vehicle) {
    const { route, car, distance } = vehicle, p = car.position;
    const nodes = this._lineNodes ??= [];
    nodes.length = 0;
    for (const node of this.signals?.nodes ?? []) {
      if (p.x >= node.x0 - BOX_REACH_LINE && p.x <= node.x1 + BOX_REACH_LINE && p.z >= node.z0 - BOX_REACH_LINE && p.z <= node.z1 + BOX_REACH_LINE) nodes.push(node);
    }
    if (!nodes.length) return null;
    const probe = this._lineProbe ??= new THREE.Vector3(), direction = this._lineDirection ??= new THREE.Vector3(), heading = this._lineHeading ??= new THREE.Vector3();
    route.sample(distance, probe, heading);
    for (let ahead = 0; ahead <= BOX_REACH_LINE; ahead++) {
      route.sample(distance + ahead, probe, direction);
      if (this.signals.blocks(probe, heading, p, car.length, vehicle, nodes)) return ahead;
    }
    return null;
  }

  /**
   * Puesto de la caja: el de menos motos delante de las que ya lo tomaron. Se llenan primero los del fondo, que no estorban la
   * franja por donde llegan las siguientes; la franja misma no tiene tope.
   */
  _boxColumn(vehicle, line) {
    const p = vehicle.car.position, yaw = vehicle.car.group.rotation.y, hx = Math.cos(yaw), hz = -Math.sin(yaw), counts = [0, 0, 0];
    // Las variantes de un circuito comparten calle sin compartir ruta: se cuenta por lugar, no por ruta.
    const found = this._carGrid.query(p.x - line - 4, p.z - line - 4, p.x + line + 4, p.z + line + 4, this._boxCandidates ??= []);
    for (const other of found) {
      if (other === vehicle || other.boxColumn === undefined) continue;
      const dx = other.car.position.x - p.x, dz = other.car.position.z - p.z;
      const along = dx * hx + dz * hz, side = dx * hz - dz * hx;
      const heading = Math.cos(other.car.group.rotation.y) * hx - Math.sin(other.car.group.rotation.y) * hz;
      if (heading > .9 && along > -2.6 && along < line + 2 && Math.abs(side) < 4) counts[other.boxColumn]++;
    }
    let best = 0;
    for (const column of [1, 2]) if (counts[column] < BOX_ROWS && counts[column] <= counts[best]) best = column;
    return best;
  }

  /**
   * La moto que se acerca al rojo se abre a su puesto delante de donde queda el primer carro y, con el verde, sale primero
   * y vuelve a su franja pasado el cruce. El lugar a lo largo lo da el hueco normal, que con BOX_GAP las apila en filas.
   */
  _boxStep(vehicle, dt) {
    const { route, distance } = vehicle, length = route.length;
    // La caja es de Ultra, donde las motos se juntan de verdad: con menos flota el primer carro no deja el hueco.
    const ultra = this.densityId === 'ultra';
    const line = ultra ? this._lineAhead(vehicle) : null;
    if (vehicle.boxColumn !== undefined &&
      (!ultra || vehicle.route !== vehicle.boxRoute || (distance - vehicle.boxExit + length) % length < length / 2)) vehicle.boxColumn = undefined;
    // El puesto se elige al llegar a la cabeza de la franja, no antes: así las que vienen detrás ven los puestos ya tomados.
    if (vehicle.boxColumn === undefined && line !== null && line <= BOX_CHOOSE_FROM) {
      vehicle.boxColumn = this._boxColumn(vehicle, line);
      vehicle.boxRoute = route;
      vehicle.boxExit = (distance + line + BOX_CROSS) % length;
    }
    const layout = ultra ? route.layoutAt?.(distance) : null;
    // En una vía de un carril las columnas se reparten alrededor del centro libre, sin salirse de la calzada.
    const target = layout
      ? THREE.MathUtils.clamp(vehicle.boxColumn === undefined ? layout.moto : layout.center + BOX_LATERALS[vehicle.boxColumn] - BOX_LATERALS[1], .4 - layout.reachOut, layout.reachIn - .4)
      : (vehicle.boxColumn === undefined ? MOTO_LATERAL : BOX_LATERALS[vehicle.boxColumn]) * (route.laneSide ?? 1);
    const step = BOX_STEER * dt;
    const next = vehicle.lateral + THREE.MathUtils.clamp(target - vehicle.lateral, -step, step);
    if (next === vehicle.lateral || this._stripFree(vehicle, next)) vehicle.lateral = next;
    vehicle.gap = vehicle.boxColumn === undefined && line === null ? MOTO_GAP : BOX_GAP;
  }

  /** Ninguna otra moto ocupa ese desplazamiento a la altura de esta: moverse de lado no puede montarse sobre la de al lado. */
  _stripFree(vehicle, lateral) {
    const p = vehicle.car.position, yaw = vehicle.car.group.rotation.y, hx = Math.cos(yaw), hz = -Math.sin(yaw);
    const found = this._carGrid.query(p.x - 4, p.z - 4, p.x + 4, p.z + 4, this._boxCandidates ??= []);
    for (const other of found) {
      if (other === vehicle || !other.car.isMoto) continue;
      const dx = other.car.position.x - p.x, dz = other.car.position.z - p.z;
      if (Math.abs(dx * hx + dz * hz) < vehicle.car.length && Math.abs(vehicle.lateral + dx * hz - dz * hx - lateral) < MOTO_SEPARATION) return false;
    }
    return true;
  }

  /** Corre un punto a la franja de la moto. Sin esto el hueco se mide sobre el carril y la moto no pasa la cola. */
  _lateral(position, direction, lateral) {
    position.x += direction.z * lateral;
    position.z -= direction.x * lateral;
  }

  _buildSpatialIndex(pedestrians) {
    this._carGrid ??= new SpatialGrid(); this._personGrid ??= new SpatialGrid();
    this._routeVehicles ??= new Map(); this._carCandidates ??= []; this._personCandidates ??= [];
    this._carGrid.clear(); this._personGrid.clear();
    for (const list of this._routeVehicles.values()) list.length = 0;
    const insert = other => {
      const { x, z } = other.car.position, size = other.car.length;
      this._carGrid.insert(other, x - size, z - size, x + size, z + size);
    };
    for (const vehicle of this.vehicles) {
      insert(vehicle);
      if (vehicle.state === 'chase' || vehicle.rejoinTarget) continue;
      let list = this._routeVehicles.get(vehicle.route);
      if (!list) this._routeVehicles.set(vehicle.route, list = []);
      list.push(vehicle);
    }
    for (const vehicle of this.parkedCars ?? []) insert(vehicle);
    for (const vehicle of this.busVehicles ?? []) if (vehicle.car.group.visible) insert(vehicle);
    for (const person of pedestrians) this._personGrid.insert(person, person.position.x, person.position.z);
  }

  /** Un peatón que cruza sin mirar y un carro que ya no alcanza a frenar: el golpe lo tumba y el conductor se detiene. */
  _checkRunovers(vehicle) {
    if (vehicle.speed < RUNOVER_SPEED || vehicle.impactStop || !this._personGrid) return;
    const { car } = vehicle, p = car.position, reach = car.length / 2 + 1.5;
    const found = this._personGrid.query(p.x - reach, p.z - reach, p.x + reach, p.z + reach, this._runoverCandidates ??= []);
    const hx = Math.cos(car.group.rotation.y), hz = -Math.sin(car.group.rotation.y);
    for (const person of found) {
      if (!person.runoverDoom || person.koState || !person.takeHit) continue;
      const ox = person.position.x - p.x, oz = person.position.z - p.z;
      const along = ox * hx + oz * hz, side = Math.abs(ox * hz - oz * hx);
      if (along > car.length / 2 + .4 || along < -car.length / 2 || side > car.width / 2 + .35) continue;
      person.runoverDoom = false;
      person.takeHit({ damage: 60, dir: { x: hx, z: hz }, knockback: 2, weapon: 'carro' });
      vehicle.impactStop = true;
      return;
    }
  }

  _checkPlayerImpact(vehicle, player, startDistance, travel, onPlayerHit) {
    let contact = false;
    if (player) {
      // Muestreo del volumen recorrido, incluso en curvas y cuadros lentos.
      const samples = Math.max(1, Math.ceil(travel / .2));
      for (let index = 0; index <= samples; index++) {
        vehicle.route.sample(startDistance + travel * index / samples, this._probePosition, this._probeDirection);
        if (vehicle.lateral) this._lateral(this._probePosition, this._probeDirection, vehicle.lateral);
        if (Math.abs(player.y - this._probePosition.y) > 1.8) continue;
        const dx = player.x - this._probePosition.x, dz = player.z - this._probePosition.z;
        const front = dx * this._probeDirection.x + dz * this._probeDirection.z;
        const side = -dx * this._probeDirection.z + dz * this._probeDirection.x;
        const outsideFront = Math.max(0, Math.abs(front) - vehicle.car.length / 2);
        const outsideSide = Math.max(0, Math.abs(side) - vehicle.car.width / 2);
        if (outsideFront ** 2 + outsideSide ** 2 > PLAYER_RADIUS ** 2) continue;
        contact = true;
        if (!vehicle.playerContact && travel > 0 && vehicle.speed >= 1.2) {
          vehicle.impactStop = true;
          onPlayerHit?.({ vehicle: vehicle.car, speed: vehicle.speed, direction: this._probeDirection.clone() });
        }
        break;
      }
    }
    vehicle.playerContact = contact;
  }

  _planChase(vehicle, stepTime, player, returning = false) {
    vehicle._chaseCaught = vehicle._chaseGiveUp = false;
    if (!player) {
      vehicle.nextSpeed = Math.max(0, vehicle.speed - BRAKING * stepTime);
      vehicle._chaseDist = 0;
      return;
    }
    const dx = player.x - vehicle.car.position.x;
    const dz = player.z - vehicle.car.position.z;
    const dist = Math.hypot(dx, dz);
    vehicle._chaseDx = dx;
    vehicle._chaseDz = dz;
    vehicle._chaseDist = dist;
    if (returning && dist <= .2 && Math.abs(player.y - vehicle.car.position.y) <= .3) {
      vehicle.car.position.copy(player);
      vehicle.rejoinTarget = null;
      vehicle._chaseDist = 0;
      vehicle.nextSpeed = 0;
      return;
    }
    const targetWater = this.environment?.getWaterInfo?.(player.x, player.z);
    if (!returning && canReachCombatTarget({ from: vehicle.car.position, to: player,
      maxDistance: POLICE_CATCH_RANGE, maxHeightDifference: CHASE_HEIGHT_TOLERANCE,
      collisions: this.environment?.collisions, getWaterInfo: this.environment?.getWaterInfo,
      toInWater: !!targetWater && player.y <= targetWater.surfaceY + .12,
      ignoreVehicle: vehicle.car })) {
      vehicle._chaseCaught = true;
      vehicle.nextSpeed = 0;
      return;
    }
    if (!returning && (dist > POLICE_GIVE_UP_RANGE || vehicle.chaseTime + stepTime >= POLICE_CHASE_TIMEOUT)) {
      vehicle._chaseGiveUp = true;
      vehicle.nextSpeed = 0;
      return;
    }
    const rate = POLICE_CHASE_SPEED < vehicle.speed ? BRAKING : CHASE_ACCELERATION;
    vehicle.nextSpeed = THREE.MathUtils.clamp(POLICE_CHASE_SPEED, vehicle.speed - rate * stepTime, vehicle.speed + rate * stepTime);
    vehicle._chaseSteerTime = Math.max(0, (vehicle._chaseSteerTime ?? 0) - stepTime);
  }

  _chaseFootprint(vehicle, x, z, y, nx, nz) {
    const { getGroundHeight, getWaterInfo, collisions } = this.environment;
    const ground = getGroundHeight?.(x, z, y) ?? y;
    if (!Number.isFinite(ground) || Math.abs(ground - y) > .3) return null;
    const halfLength = vehicle.car.length / 2 + .12, halfWidth = vehicle.car.width / 2 + .12;
    // El centro y los cuatro extremos de cada eje evitan meter media carrocería en el lago o en un desnivel.
    for (const along of [-halfLength, 0, halfLength]) for (const side of [-halfWidth, 0, halfWidth]) {
      const px = x + nx * along - nz * side, pz = z + nz * along + nx * side;
      const support = getGroundHeight?.(px, pz, ground) ?? ground;
      if (!Number.isFinite(support) || Math.abs(support - ground) > .75) return null;
      const water = getWaterInfo?.(px, pz);
      if (water && support <= water.surfaceY + .12) return null;
    }
    const halfX = Math.abs(nx) * halfLength + Math.abs(nz) * halfWidth;
    const halfZ = Math.abs(nz) * halfLength + Math.abs(nx) * halfWidth;
    const box = this._chaseBox;
    box.min.set(x - halfX, ground + .25, z - halfZ);
    box.max.set(x + halfX, ground + 1.65, z + halfZ);
    const blocked = entry => entry?.box && entry.vehicle !== vehicle.car && box.intersectsBox(entry.box);
    const obstacles = collisions?.queryStatic?.(box.min.x, box.min.z, box.max.x, box.max.z, this._chaseColliders)
      ?? collisions?.colliders ?? [];
    if (obstacles.some(blocked) || collisions?.dynamicColliders?.some(blocked)) return null;
    return ground;
  }

  _chaseClearance(vehicle, nx, nz, travel) {
    let y = vehicle.car.position.y, allowed = 0;
    const count = Math.max(1, Math.ceil(travel / CHASE_PROBE_STEP));
    for (let index = 0; index <= count; index++) {
      const distance = travel * index / count;
      const ground = this._chaseFootprint(vehicle, vehicle.car.position.x + nx * distance,
        vehicle.car.position.z + nz * distance, y, nx, nz);
      if (ground === null) break;
      allowed = distance;
      y = ground;
    }
    this._chaseSweepY = y;
    return allowed;
  }

  _steerChase(vehicle, distance) {
    const bearing = Math.atan2(vehicle._chaseDz, vehicle._chaseDx);
    const lookAhead = Math.min(distance, 3 + vehicle.speed * .5);
    let best = -Infinity, bestAngle = bearing;
    for (const offset of CHASE_STEERING) {
      const angle = bearing + offset;
      const current = -vehicle.car.group.rotation.y;
      const turn = Math.atan2(Math.sin(angle - current), Math.cos(angle - current));
      const samples = Math.max(1, Math.ceil(Math.abs(turn) / .2));
      let canTurn = true;
      for (let i = 1; i <= samples; i++) {
        const yaw = current + turn * i / samples, p = vehicle.car.position;
        if (this._chaseFootprint(vehicle, p.x, p.z, p.y, Math.cos(yaw), Math.sin(yaw)) === null) {
          canTurn = false; break;
        }
      }
      if (!canTurn) continue;
      const clear = this._chaseClearance(vehicle, Math.cos(angle), Math.sin(angle), lookAhead);
      // Permite rodear el borde de un obstáculo; la preferencia leve conserva el lado elegido.
      const previous = vehicle._chaseHeading ?? bearing;
      const continuity = Math.cos(angle - previous) * .08;
      const score = clear * (.35 + Math.cos(offset)) + continuity;
      if (score > best) { best = score; bestAngle = angle; }
    }
    vehicle._chaseHeading = bestAngle;
    vehicle._chaseCanMove = best > -Infinity;
    vehicle._chaseSteerTime = .2;
  }

  _applyChase(vehicle, stepTime) {
    if (vehicle._chaseGiveUp) {
      this._returnToPatrol(vehicle);
      if (!this.inPursuit && !this._arrestDispatched) emit('police-escaped', {});
      return false;
    }
    vehicle.speed = vehicle.nextSpeed;
    if (vehicle.state === 'chase') vehicle.chaseTime += stepTime;
    if (vehicle._chaseCaught) {
      vehicle.car.animateDrive(0, true);
      return true;
    }
    const dist = vehicle._chaseDist || 0;
    if (dist > 1e-6) {
      let travel = Math.min(vehicle.speed * stepTime, Math.max(0, dist - (vehicle.rejoinTarget ? 0 : POLICE_CATCH_RANGE * .35)));
      let nx = vehicle._chaseDx / dist, nz = vehicle._chaseDz / dist;
      if (this.environment) {
        if (vehicle._chaseSteerTime <= 0) this._steerChase(vehicle, dist);
        nx = Math.cos(vehicle._chaseHeading); nz = Math.sin(vehicle._chaseHeading);
        const safeTravel = vehicle._chaseCanMove ? this._chaseClearance(vehicle, nx, nz, travel) : 0;
        if (safeTravel < travel) vehicle._chaseSteerTime = 0;
        travel = safeTravel;
        if (vehicle._chaseCanMove) vehicle.car.position.y = this._chaseSweepY;
      }
      if (vehicle.rejoinTarget) {
        vehicle._rejoinStuck = travel > 1e-3 ? 0 : (vehicle._rejoinStuck ?? 0) + stepTime;
        if (vehicle._rejoinStuck > REJOIN_TIMEOUT && this._forceRejoin(vehicle)) return false;
      }
      vehicle.car.position.x += nx * travel;
      vehicle.car.position.z += nz * travel;
      if (travel > 0) vehicle.car.group.rotation.y = Math.atan2(-nz, nx);
      vehicle.car.animateDrive(travel, false);
      vehicle.speed = stepTime > 0 ? travel / stepTime : 0;
    }
    return false;
  }

  update(dt, { player = null, pedestrians = [], onPlayerHit = null, camera = null, hour = null } = {}) {
    if (dt <= 0) return;
    let caught = false;
    this._playerPosition = player;
    // La vista manda: detalle, niebla y a quién se deja entrar o salir sin que se vea.
    const view = this._viewPosition;
    if (camera?.position) view.copy(camera.position);
    else if (player) view.copy(player);
    this._camera = camera?.matrixWorldInverse ? camera : null;
    const center = this._center.copy(view);
    if (this._camera) {
      const m = this._camera.matrixWorldInverse.elements;
      const fx = -m[8], fz = -m[10], length = Math.hypot(fx, fz) || 1;
      this._forward.x = fx / length; this._forward.z = fz / length;
      center.x += this._forward.x * BUBBLE_AHEAD; center.z += this._forward.z * BUBBLE_AHEAD;
    }
    // Un salto de la burbuja (carga, recuperación, viaje) deja calles nuevas: se llenan de una vez.
    if (this._lastCenterX === null || Math.hypot(center.x - this._lastCenterX, center.z - this._lastCenterZ) > FRESH_VIEW_JUMP) {
      this._freshTime = FRESH_SECONDS;
    }
    this._lastCenterX = center.x; this._lastCenterZ = center.z;
    if (Number.isFinite(hour)) this._motoThreshold = motoThreshold(hour, this.densityId);
    if (this.densityId && Number.isFinite(hour)) this._resizeFleet(hour, dt);
    this._updateLod();
    this._clearStuck(dt);
    this._coordinateIntersections();
    for (const vehicle of this.vehicles) {
      if (vehicle.state === 'chase' || vehicle.rejoinTarget) continue;
      vehicle.routeTimer -= Math.min(dt, .5);
      if (vehicle.routeTimer <= 0) {
        const changed = this._chooseRoute(vehicle);
        vehicle.routeTimer = changed ? 6 + this.random() * 8 : 1 + this.random() * 2;
      }
    }
    // Subpasos acotados: un cuadro lento no puede saltarse a otro vehículo o peatón.
    let remaining = Math.min(dt, 0.5);
    while (remaining > 1e-8) {
      const stepTime = Math.min(remaining, 0.05);
      this._time += stepTime;
      this._buildSpatialIndex(pedestrians);
      this._updating = true;
      try {
        for (const vehicle of this.vehicles) {
          if (vehicle.state === 'chase' || vehicle.rejoinTarget) {
            vehicle._offRouteStep = true;
            this._planChase(vehicle, stepTime, vehicle.rejoinTarget ?? player, !!vehicle.rejoinTarget);
            continue;
          }
          if (vehicle.car.isMoto) this._boxStep(vehicle, stepTime);
          else if (this.densityId === 'ultra' && !vehicle.police) this._fileStep(vehicle, stepTime);
          const clearance = this._clearance(vehicle, player, pedestrians);
          const braking = vehicle.braking ?? BRAKING;
          // Anticipa la respuesta gradual del conductor; el peatón no es una pared
          // capaz de eliminar la velocidad restante en un solo subpaso.
          const brakingClearance = Math.min(clearance, Math.max(0, vehicle.playerClearance - vehicle.speed));
          let desiredSpeed = Math.min(vehicle.cruiseSpeed, Math.sqrt(2 * braking * brakingClearance));
          if (vehicle.impactStop) {
            desiredSpeed = 0;
            if (vehicle.speed < .1) {
              vehicle.impactWait = (vehicle.impactWait ?? 2) - stepTime;
              if (vehicle.impactWait <= 0) { vehicle.impactStop = false; vehicle.impactWait = undefined; }
            }
          }
          // Conductor fuera del carro: frena con su aceleración normal y espera.
          if (vehicle.hold) desiredSpeed = 0;
          // Anticipa las curvas y reduce la velocidad antes de girar.
          let start = 0;
          for (const segment of vehicle.route.segments) {
            if (segment.radius) {
              const ahead = ((start - vehicle.distance) % vehicle.route.length + vehicle.route.length) % vehicle.route.length;
              const inCurve = vehicle.distance >= start && vehicle.distance < start + segment.length;
              const turnSpeed = Math.sqrt(segment.radius * 1.8);
              desiredSpeed = Math.min(desiredSpeed, Math.sqrt(turnSpeed ** 2 + 2 * braking * (inCurve ? 0 : ahead)));
            }
            start += segment.length;
          }
          if (clearance < .05 && vehicle.speed < .1) vehicle.stopped = true;
          if (vehicle.stopped && clearance > .5) {
            vehicle.resumeDelay = vehicle.reactionTime; vehicle.stopped = false;
          }
          if (vehicle.resumeDelay > 0) { vehicle.resumeDelay -= stepTime; desiredSpeed = 0; }
          const targetAcceleration = THREE.MathUtils.clamp((desiredSpeed - vehicle.speed) / .65, -braking, vehicle.accelerationLimit ?? ACCELERATION);
          vehicle.acceleration = THREE.MathUtils.clamp(targetAcceleration, vehicle.acceleration - BRAKE_ONSET * stepTime, vehicle.acceleration + ACCEL_ONSET * stepTime);
          const candidateSpeed = THREE.MathUtils.clamp(vehicle.speed + vehicle.acceleration * stepTime, 0, vehicle.cruiseSpeed);
          const speed = desiredSpeed === 0 && candidateSpeed < .01 ? 0 : candidateSpeed;
          const travel = Math.min(Math.max(0, speed * stepTime), vehicle.hardClearance);
          vehicle.nextDistance = (vehicle.distance + travel) % vehicle.route.length;
          vehicle.nextSpeed = travel / stepTime;
          vehicle.nextTravel = travel;

          if (clearance < 3.5 && vehicle.speed > 0.8) {
            // Los cuatro segundos de espera no transcurren mientras la simulación está en pausa.
            if (this._time - (vehicle.lastHonkTime || 0) > 4) {
              vehicle.lastHonkTime = this._time;
              emitHonk(vehicle.car.position.x, vehicle.car.position.z);
            }
          }
        }
      } finally {
        this._updating = false;
      }
      // Todos consultan las mismas posiciones antes de aplicar el movimiento.
      for (const vehicle of this.vehicles) {
        if (vehicle._offRouteStep) {
          vehicle._offRouteStep = false;
          if (this._applyChase(vehicle, stepTime)) caught = true;
          continue;
        }
        const startDistance = vehicle.distance;
        const travel = vehicle.nextTravel;
        const previousSpeed = vehicle.speed;
        vehicle.distance = vehicle.nextDistance;
        vehicle.speed = vehicle.nextSpeed;
        this._checkPlayerImpact(vehicle, player, startDistance, travel, onPlayerHit);
        this._checkRunovers(vehicle);
        vehicle.route.sample(vehicle.distance, this._position, this._direction);
        // La moto vive en su franja: la colisión, la sombra y el aviso la siguen ahí, no en el carril.
        if (vehicle.lateral) this._lateral(this._position, this._direction, vehicle.lateral);
        vehicle.car.position.copy(this._position);
        vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
        // El carro instanciado no gasta la animación de ruedas y carrocería: no se ve.
        if (!vehicle.car.instanced) this._animateRoute(vehicle, travel, stepTime, previousSpeed);
      }
      remaining -= stepTime;
    }
    this._motoFleet?.sync(this.vehicles, camera?.position);
    this._carFleet ??= new CarFleet(this.scene);
    this._carFleet.sync(this.vehicles);
    this._busPassengers ??= new BusPassengers(this.scene);
    this._busPassengers.sync(this.vehicles, camera?.position, hour, performance.now() / 1000);
    if (caught && !this._arrestDispatched) {
      this._arrestDispatched = true;
      emit('police-arrest', { reason: 'chase' });
    }
  }

  dispose() {
    this.signals?.reservations?.clear();
    for (const { car } of this.vehicles) car.dispose();
    this.vehicles.length = 0;
    this._motoFleet?.dispose();
    this._motoFleet = null;
    this._carFleet?.dispose();
    this._carFleet = null;
    this._busPassengers?.dispose();
    this._busPassengers = null;
  }
}
