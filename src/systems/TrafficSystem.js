import {CAR_DRIVER,BUS_DRIVER,LOOKAHEAD,acceleration as slopAcceleration,laneSafe,laneAcceleration,canStopBefore} from '../vehicles/SlopTrafficAI.js';
import {TrafficCollisionWorld} from '../vehicles/TrafficCollisionWorld.js';
import {weightedMove} from '../vehicles/SlopDynamics.js';
import {BogotaRoadNetwork} from '../vehicles/BogotaRoadNetwork.js';
import * as THREE from 'three';
import { Car } from '../entities/Car.js';
import { intersectionPhase } from '../world/bogota/TrafficSignals.js';
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
import {trafficVariant} from '../vehicles/VehicleTypes.js';

const GAP = 1.8;
// Persecución de las patrullas (fuera de la red de calles).
const BRAKING = 2;
const CHASE_ACCELERATION = 3.2;
const PROBE_STEP = 0.5;
const ROUTE_SAMPLE_STEP = 2;

function emit(type, detail) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      const event = typeof CustomEvent !== 'undefined' ? new CustomEvent(type, { detail }) : { type, detail };
      window.dispatchEvent(event);
    } catch {}
  }
}

function emitHonk(x, z) { emit('car-honk', { x, z }); }

export class TrafficSystem {
  constructor(scene, routes, { carsPerRoute = 4, policeCount = 0, random = Math.random } = {}) {
    this.vehicles = [];
    this.random = random;
    this.routes = routes.alternatives ?? routes;
    this.network=new BogotaRoadNetwork(this.routes);
    this.physics=new TrafficCollisionWorld(scene);this.physics.network=this.network;
    this._arrestDispatched = false;
    this._position = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._probePosition = new THREE.Vector3();
    this._probeDirection = new THREE.Vector3();
    this._signalDirection = new THREE.Vector3();
    this._nearbyPedestrians = [];
    this._nearbyCars = [];
    this._carGrid = new SpatialGrid();
    this._personGrid = new SpatialGrid();
    this._carCandidates = [];
    this._personCandidates = [];
    this._routeVehicles = new Map();
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
      // Lejos de los carros que ya circulan en ese recorrido: dos vehículos superpuestos se bloquean para siempre.
      let distance = random() * route.length;
      for (let attempt = 0; attempt < 8 && this.vehicles.some(other => other.route === route && Math.abs(other.distance - distance) < 12); attempt++)
        distance = (distance + route.length / 8 + random() * 6) % route.length;
      this._spawn(scene, route, distance, true);
    }
  }

  _spawn(scene, route, distance, police) {
    const random = this.random;
    route.sample(distance, this._position, this._direction);
    // Las patrullas usan la carrocería de policía del donante; el resto, una clase al azar del tráfico.
    const car = new Car(scene, this._position, Math.atan2(-this._direction.z, this._direction.x),
      { traffic: true, kind: police ? 'police' : null, variant: police ? 'police_pickup' : trafficVariant(random) });
    const cruiseSpeed = car.variant==='bus'?8+random()*2:10 + random() * 4;
    const driver=car.variant==='bus'?BUS_DRIVER:CAR_DRIVER;
    this.vehicles.push({ car, route, distance, speed: 0, cruiseSpeed, patrolSpeed: cruiseSpeed, nextDistance: distance, nextSpeed: 0,
      driver:{...driver},v0:cruiseSpeed,acceleration: 0, accelerationLimit:driver.a, braking:9,
      reactionTime:0,resumeDelay:0,stopped:false,
      routeTimer: 3 + random() * 5, recentRoutes: [route.key], routeChanges: 0,
      lastHonkTime: 0, police, state: 'patrol', chaseTime: 0 });
  }

  _canWitness(vehicle, playerPosition) {
    const dx = playerPosition.x - vehicle.car.position.x;
    const dz = playerPosition.z - vehicle.car.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > POLICE_SIGHT_RANGE * POLICE_SIGHT_RANGE) return false;
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

  _returnToPatrol(vehicle) {
    vehicle.state = 'patrol';
    vehicle.chaseTime = 0;
    vehicle.speed = vehicle.nextSpeed = vehicle.acceleration = 0;
    vehicle.cruiseSpeed = vehicle.patrolSpeed;
    vehicle.stopped = false;
    vehicle.resumeDelay = vehicle.reactionTime;
    vehicle.car.pursuit = false;
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
        const score = dx * dx + dz * dz;
        if (score < bestScore) { bestScore = score; bestRoute = route; bestDistance = d; }
      }
    }
    vehicle.route = bestRoute;
    vehicle.distance = vehicle.nextDistance = bestDistance;
    vehicle.recentRoutes = [bestRoute.key];
    bestRoute.sample(bestDistance, this._position, this._direction);
    vehicle.car.position.copy(this._position);
    vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
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
    if ((vehicle.crossingNode&&!vehicle.replanWaiting)||Math.abs(vehicle.dl??0)>.5) return false;
    if (this.routes.length < 2) return false;
    this.network??=new BogotaRoadNetwork(this.routes);
    const options=this.network.continuations(vehicle).filter(o=>!vehicle.recentRoutes.includes(o.route.key));
    if(!options.length)return false;
    const selected=weightedMove(options,o=>o.straight?3:1,this.random);
    vehicle.route = selected.route;
    vehicle.distance = selected.distance;
    vehicle.recentRoutes.push(selected.route.key);
    if (vehicle.recentRoutes.length > 3) vehicle.recentRoutes.shift();
    vehicle.routeChanges++;
    return true;
  }

  _tryLaneChange(vehicle){
    if(vehicle.crossingNode||Math.abs(vehicle.dl??0)>.5||vehicle.speed<=2)return false;
    const v={speed:vehicle.speed,v0:vehicle.cruiseSpeed,driver:vehicle.driver??CAR_DRIVER};
    let best=laneAcceleration(v,Number.isFinite(vehicle.leaderGap)?{speed:vehicle.leaderSpeed}:null,vehicle.leaderGap)+.6,pick=null;
    for(const option of this.network?.laneChanges(vehicle)??[]){
      const target=new THREE.Vector3(),direction=new THREE.Vector3();option.route.sample(option.distance,target,direction);
      let lead=null,back=null,leadGap=Infinity,backGap=Infinity;
      for(const other of [...this.vehicles,...(this.parkedCars??[]),...(this.busVehicles??[])]){
        if(other===vehicle||Math.abs(other.car.position.y-target.y)>2)continue;
        const dx=other.car.position.x-target.x,dz=other.car.position.z-target.z,along=dx*direction.x+dz*direction.z,side=dx*-direction.z+dz*direction.x;
        if(Math.abs(side)>vehicle.car.width+.4)continue;
        const gap=Math.abs(along)-(vehicle.car.length+other.car.length)/2;
        const driver={speed:other.speed??0,v0:other.cruiseSpeed??12,driver:other.driver??CAR_DRIVER};
        if(along>=0&&gap<leadGap){lead=driver;leadGap=gap;}else if(along<0&&gap<backGap){back=driver;backGap=gap;}
      }
      if(!laneSafe(v,lead,leadGap,back,backGap,-3))continue;
      const gain=laneAcceleration(v,lead,leadGap);if(gain>best){best=gain;pick=option;}
    }
    if(!pick)return false;
    const p=new THREE.Vector3(),d=new THREE.Vector3();pick.route.sample(pick.distance,p,d);
    vehicle.dl=(vehicle.car.position.z-p.z)*d.x-(vehicle.car.position.x-p.x)*d.z;
    vehicle.route=pick.route;vehicle.distance=pick.distance;return true;
  }

  _carInPath(other, car) {
    // Every half-meter probe used to recalculate these getters and trigonometry.
    // All drivers read the same spatial snapshot before movement in this substep.
    const snapshot = this._updating ? other.probeSnapshot : null;
    const position = snapshot ?? other.car.position;
    if (Math.abs(position.y - car.position.y) > 3) return false;
    const dx = position.x - this._probePosition.x, dz = position.z - this._probePosition.z;
    const headingX = snapshot?.headingX ?? other.heading?.x ?? Math.cos(other.car.group.rotation.y);
    const headingZ = snapshot?.headingZ ?? other.heading?.z ?? -Math.sin(other.car.group.rotation.y);
    const along = Math.abs(headingX * this._probeDirection.x + headingZ * this._probeDirection.z);
    const across = Math.abs(headingX * -this._probeDirection.z + headingZ * this._probeDirection.x);
    const front = dx * this._probeDirection.x + dz * this._probeDirection.z;
    const side = dx * -this._probeDirection.z + dz * this._probeDirection.x;
    const headingDot = headingX * this._probeDirection.x + headingZ * this._probeDirection.z;
    // Un seguidor en el mismo carril no debe bloquear al carro que lleva delante.
    if (headingDot > .9 && front <= 0) return false;
    const margin = along > .9 ? GAP : .35;
    return Math.abs(front) < car.length / 2 + along * other.car.length / 2 + across * other.car.width / 2 + margin &&
      Math.abs(side) < car.width / 2 + across * other.car.length / 2 + along * other.car.width / 2 + .15;
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
    for (const vehicle of this.vehicles) vehicle.crossingNode = null;
    for (const node of this.signals.nodes) {
      let state = this.signals.reservations.get(node);
      if (!state) {
        state = { owners: new Map(), plans: new Map(), queue: [] };
        this.signals.reservations.set(node, state);
      }
      const candidates = [];
      for (const vehicle of this.vehicles) {
        if (vehicle.state === 'chase') continue;
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
      for (const [vehicle, claim] of state.owners) {
        const overlaps = this._overlapsNode(vehicle.car, node);
        claim.entered ||= overlaps;
        if ((claim.entered && !overlaps) || (!claim.entered &&
          ((intersectionPhase(this.signals,node,claim.plan.axis) !== 0&&!claim.committed) || !candidates.includes(vehicle)))) state.owners.delete(vehicle);
      }
      for (const vehicle of state.plans.keys()) if (!candidates.includes(vehicle) && !state.owners.has(vehicle)) state.plans.delete(vehicle);
      for (const vehicle of candidates) if (!state.plans.has(vehicle)) state.plans.set(vehicle, this._crossingPlan(vehicle, node));
      const busInside = this.busVehicle?.car.group.visible && this.busVehicle.car.position.y < 3 && this._overlapsNode(this.busVehicle.car, node, this.busVehicle.heading);
      const bus = this.busVehicle?.car;
      const busCrossingX = bus?.pathX?.(node.z1, bus.laneX) ?? bus?.position.x;
      const busApproaching = bus?.group.visible && bus.position.y < 3 && bus.position.z > node.z1 &&
        bus.position.z < node.z1 + bus.length / 2 + 15 && busCrossingX >= node.x0 && busCrossingX <= node.x1;
      const busClaims = busInside || (busApproaching && intersectionPhase(this.signals,node,1) === 0);
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
      // Quien va detrás en el mismo acceso no puede reservar antes que quien tiene delante: su reserva
      // bloqueaba al primero y ninguno avanzaba (el reloj de espera del primero se reinicia al replanear).
      for (const [vehicle, claim] of state.owners) if (!claim.entered && this._queuedAhead(vehicle, claim.plan, node, state)) state.owners.delete(vehicle);
      const ordered = [...state.queue].sort((a, b) => Number(this._overlapsNode(b.car, node)) - Number(this._overlapsNode(a.car, node)) ||
        Math.floor(this._stopDistance(a,node,state.plans.get(a))/2) - Math.floor(this._stopDistance(b,node,state.plans.get(b))/2) || (b.waitAge??0)-(a.waitAge??0));
      for (const vehicle of ordered) {
        if (state.owners.has(vehicle)) continue;
        const plan = state.plans.get(vehicle), entered = this._overlapsNode(vehicle.car, node);
        const phase=intersectionPhase(this.signals,node,plan.axis);
        const distance=this._stopDistance(vehicle,node,plan),stoppable=canStopBefore({speed:vehicle.speed,v0:vehicle.cruiseSpeed,driver:vehicle.driver??CAR_DRIVER},distance,phase===0?'green':phase===1?'amber':'red');
        const committed=phase===1&&!stoppable;
        // Slop's unsignalized-corner rule: yield on the minor road, reserve only a clear exit.
        // A stopped minor-road car eventually competes by waiting age instead of starving forever.
        if(node.control==='priority'&&!entered&&plan.axis!==node.mainAxis){
          if(distance>1||vehicle.speed>.3)continue;
          const mainApproaching=candidates.some(other=>other!==vehicle&&state.plans.get(other)?.axis===node.mainAxis&&this._stopDistance(other,node,state.plans.get(other))<Math.max(3,other.speed*2));
          if(mainApproaching&&(vehicle.waitAge??0)<4)continue;
        }
        if(!entered&&(phase===2||(phase===1&&!committed)))continue;
        if(!entered&&!this._exitClear(vehicle,plan))continue;
        if(!entered&&this._queuedAhead(vehicle,plan,node,state))continue;
        const blocked = (busClaims && this._pathsConflict(plan, state.busPlan)) ||
          [...state.owners.values()].some(claim => this._pathsConflict(plan, claim.plan)) ||
          waiting.some(earlier => this._pathsConflict(plan, earlier));
        if (blocked && !entered) waiting.push(plan);
        else state.owners.set(vehicle, { entered, plan,committed });
      }
      state.busBlocked = !!state.busPlan && [...state.owners.values()].some(claim => this._pathsConflict(claim.plan, state.busPlan));
      for (const vehicle of state.queue) vehicle.crossingNode ??= node;
    }
  }

  /** Otro vehículo del mismo acceso y carril, más cerca del cruce y aún sin reserva. */
  _queuedAhead(vehicle,plan,node,state){
    const p=vehicle.car.position,own=this._stopDistance(vehicle,node,plan);
    for(const other of state.queue){
      if(other===vehicle||state.owners.has(other))continue;
      const otherPlan=state.plans.get(other);if(!otherPlan||otherPlan.hx===undefined||Math.sign(otherPlan.hx)!==Math.sign(plan.hx)||Math.sign(otherPlan.hz)!==Math.sign(plan.hz))continue;
      const o=other.car.position,lateral=plan.axis===0?Math.abs(o.z-p.z):Math.abs(o.x-p.x);
      if(lateral<1.5&&this._stopDistance(other,node,otherPlan)<own-.5)return true;
    }
    return false;
  }
  _stopDistance(vehicle,node,plan){
    const p=vehicle.car.position,pad=vehicle.car.length/2+.8;
    return Math.max(0,(plan.axis===0?(plan.hx>0?node.x0-p.x:p.x-node.x1):(plan.hz>0?node.z0-p.z:p.z-node.z1))-pad);
  }
  _exitClear(vehicle,plan){
    const p=plan.points.at(-1),previous=plan.points.at(-2);if(!p||!previous)return true;
    const length=Math.hypot(p.x-previous.x,p.z-previous.z)||1,tx=(p.x-previous.x)/length,tz=(p.z-previous.z)/length;
    for(const other of [...this.vehicles,...(this.parkedCars??[]),...(this.busVehicles??[])]){
      if(other===vehicle||Math.abs(other.car.position.y-vehicle.car.position.y)>2||other.speed>.5)continue;
      const dx=other.car.position.x-p.x,dz=other.car.position.z-p.z,along=dx*tx+dz*tz,side=dx*-tz+dz*tx;
      if(along>=0&&along<vehicle.car.length+other.car.length/2+2&&Math.abs(side)<(vehicle.car.width+other.car.width)/2+.2)return false;
    }return true;
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
    const plan = { points: [], width: car.width, axis: 0, compatible: new WeakMap() };
    for (let ahead = entry; ahead < entry + 100; ahead += .75) {
      route.sample(distance + ahead, this._probePosition, this._probeDirection);
      if (!inside(this._probePosition)) break;
      if (!plan.points.length) {
        plan.hx = this._probeDirection.x; plan.hz = this._probeDirection.z;
        plan.axis = Math.abs(plan.hx) >= Math.abs(plan.hz) ? 0 : 1;
      }
      plan.points.push({ x: this._probePosition.x, z: this._probePosition.z });
    }
    return plan;
  }

  _pathsConflict(a, b) {
    if (a === b) return false;
    const cached = a.compatible?.get(b);
    if (cached !== undefined) return cached;
    const startA = a.points[0], startB = b.points[0];
    // Una misma entrada permite seguir al líder; el control de distancia impide alcanzarlo.
    const sameEntry = startA && startB && a.hx * b.hx + a.hz * b.hz > .99 &&
      Math.hypot(startA.x - startB.x, startA.z - startB.z) < 1.2;
    const margin = (a.width + b.width) / 2 + .5;
    const conflict = !sameEntry && a.points.some(p => b.points.some(q => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < margin ** 2));
    a.compatible?.set(b, conflict); b.compatible?.set(a, conflict);
    return conflict;
  }

  _clearance(vehicle, player, pedestrians) {
    if (!this._updating) this._buildSpatialIndex(pedestrians);
    const { route, car, distance, speed } = vehicle;
    vehicle.personBlocked = false;
    vehicle.playerClearance = Infinity;
    const finish = hardClearance => {
      vehicle.hardClearance = hardClearance;
      return Math.min(hardClearance, vehicle.playerClearance);
    };
    let clearance = Infinity;vehicle.leaderSpeed=0;vehicle.leaderGap=Infinity;vehicle.stopDistance=Infinity;vehicle.obstacleGap=Infinity;vehicle.obstacleSpeed=0;
    for (const other of this._routeVehicles.get(route) ?? []) {
      if (other === vehicle || other.route !== route) continue;
      const gap = (other.distance - distance + route.length) % route.length;
      const bumperGap=Math.max(0,gap-(car.length+other.car.length)/2);
      if(bumperGap<vehicle.leaderGap){vehicle.leaderGap=bumperGap;vehicle.leaderSpeed=other.speed;}
      clearance = Math.min(clearance, Math.max(0, bumperGap-GAP));
    }
    // Mira también alrededor de los giros; no solo en línea recta frente al carro.
    const lookAhead = LOOKAHEAD;
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
    for (const other of this._carCandidates) {
      if (other === vehicle || (other.route === route && other.state !== 'chase')) continue;
      if (other.car.position.distanceToSquared(car.position) <= (radius + other.car.length) ** 2) nearbyCars.push(other);
    }
    this._personGrid.query(minX, minZ, maxX, maxZ, this._personCandidates);
    for (const pedestrian of this._personCandidates) {
      const dx = pedestrian.position.x - car.position.x, dz = pedestrian.position.z - car.position.z;
      if (dx * dx + dz * dz <= radius * radius) nearby.push(pedestrian);
    }
    // Estar junto al frente también obstruye a un conductor detenido por rojo
    // o por otro carro: no depender del primer motivo de frenado encontrado.
    vehicle.personBlocked = (!!player && this._personAtNose(player, car)) ||
      nearby.some(pedestrian => this._personAtNose(pedestrian.position, car));
    // La señal corresponde al acceso actual, no al rumbo futuro tras doblar.
    const signalDirection = this._signalDirection ??= new THREE.Vector3();
    if (this.signals) route.sample(distance, this._probePosition, signalDirection);
    const signalNodes=this.signals?.nodes?.filter(n=>car.position.x+radius>=n.x0&&car.position.x-radius<=n.x1&&car.position.z+radius>=n.z0&&car.position.z-radius<=n.z1);
    for (let ahead = 0; ahead <= Math.min(lookAhead, clearance); ahead += PROBE_STEP) {
      route.sample(distance + ahead, this._probePosition, this._probeDirection);
      if (this.signals?.blocks(this._probePosition, signalDirection, car.position, car.length, vehicle,signalNodes)){vehicle.stopDistance=Math.max(0,ahead-PROBE_STEP);return finish(vehicle.stopDistance);}
      if (player && vehicle.playerClearance === Infinity && this._personInCar(player, car)) {
        vehicle.personBlocked ||= ahead <= 10;
        vehicle.playerClearance = Math.max(0, ahead - PROBE_STEP);
      }
      for (const other of nearbyCars) if (this._carInPath(other, car)) {
        const clearance=Math.max(0,ahead-PROBE_STEP);vehicle.obstacleGap=clearance+GAP;vehicle.obstacleSpeed=Math.abs(other.car.controller==='player'?(other.car.physics?.speed??0):(other.speed??0));return finish(clearance);
      }
      for (const pedestrian of nearby) {
        if (this._personInCar(pedestrian.position, car)) {
          vehicle.personBlocked ||= ahead <= 10;
          vehicle.stopDistance=Math.max(0,ahead-PROBE_STEP);return finish(vehicle.stopDistance);
        }
      }
    }
    return finish(clearance);
  }

  _buildSpatialIndex(pedestrians) {
    this._carGrid ??= new SpatialGrid(); this._personGrid ??= new SpatialGrid();
    this._routeVehicles ??= new Map(); this._carCandidates ??= []; this._personCandidates ??= [];
    this._carGrid.clear(); this._personGrid.clear();
    for (const list of this._routeVehicles.values()) list.length = 0;
    const insert = other => {
      const { x, y, z } = other.car.position, size = other.car.length;
      const snapshot = other.probeSnapshot ??= {};
      snapshot.x = x; snapshot.y = y; snapshot.z = z;
      const heading = other.heading;
      snapshot.headingX = heading?.x ?? Math.cos(other.car.group.rotation.y);
      snapshot.headingZ = heading?.z ?? -Math.sin(other.car.group.rotation.y);
      this._carGrid.insert(other, x - size, z - size, x + size, z + size);
    };
    for (const vehicle of this.vehicles) {
      insert(vehicle);
      if (vehicle.state === 'chase') continue;
      let list = this._routeVehicles.get(vehicle.route);
      if (!list) this._routeVehicles.set(vehicle.route, list = []);
      list.push(vehicle);
    }
    for (const vehicle of this.parkedCars ?? []) insert(vehicle);
    for (const vehicle of this.busVehicles ?? []) if (vehicle.car.group.visible) insert(vehicle);
    for (const person of pedestrians) this._personGrid.insert(person, person.position.x, person.position.z);
  }

  _checkPlayerImpact(vehicle, player, startDistance, travel, onPlayerHit) {
    let contact = false;
    if (player) {
      // Muestreo del volumen recorrido, incluso en curvas y cuadros lentos.
      const samples = Math.max(1, Math.ceil(travel / .2));
      for (let index = 0; index <= samples; index++) {
        vehicle.route.sample(startDistance + travel * index / samples, this._probePosition, this._probeDirection);
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

  _planChase(vehicle, stepTime, player) {
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
    if (dist <= POLICE_CATCH_RANGE) {
      vehicle._chaseCaught = true;
      vehicle.nextSpeed = 0;
      return;
    }
    if (dist > POLICE_GIVE_UP_RANGE || vehicle.chaseTime + stepTime >= POLICE_CHASE_TIMEOUT) {
      vehicle._chaseGiveUp = true;
      vehicle.nextSpeed = 0;
      return;
    }
    const rate = POLICE_CHASE_SPEED < vehicle.speed ? BRAKING : CHASE_ACCELERATION;
    vehicle.nextSpeed = THREE.MathUtils.clamp(POLICE_CHASE_SPEED, vehicle.speed - rate * stepTime, vehicle.speed + rate * stepTime);
  }

  _applyChase(vehicle, stepTime) {
    if (vehicle._chaseGiveUp) {
      this._returnToPatrol(vehicle);
      if (!this.inPursuit && !this._arrestDispatched) emit('police-escaped', {});
      return false;
    }
    vehicle.speed = vehicle.nextSpeed;
    vehicle.chaseTime += stepTime;
    if (vehicle._chaseCaught) {
      vehicle.car.animateDrive(0, true);
      return true;
    }
    const dist = vehicle._chaseDist || 0;
    if (dist > 1e-6) {
      const travel = Math.min(vehicle.speed * stepTime, Math.max(0, dist - POLICE_CATCH_RANGE * 0.35));
      const nx = vehicle._chaseDx / dist;
      const nz = vehicle._chaseDz / dist;
      vehicle.car.position.x += nx * travel;
      vehicle.car.position.z += nz * travel;
      vehicle.car.group.rotation.y = Math.atan2(-nz, nx);
      vehicle.car.animateDrive(travel, false);
      vehicle.speed = stepTime > 0 ? travel / stepTime : 0;
    }
    return false;
  }

  update(dt, { player = null, pedestrians = [], onPlayerHit = null, driving=null, collisions=null, onCollision=null } = {}) {
    if (dt <= 0) return;
    let caught = false;
    this.physics.onCollision=onCollision;
    this._coordinateIntersections();
    for (const vehicle of this.vehicles) {
      if (vehicle.state === 'chase') continue;
      vehicle.waitAge=vehicle.speed<.05?(vehicle.waitAge??0)+Math.min(dt,.5):0;
      if(vehicle.waitAge>18&&vehicle.crossingNode&&!this._overlapsNode(vehicle.car,vehicle.crossingNode)){
        vehicle.replanWaiting=true;
        if(this._chooseRoute(vehicle))for(const state of this.signals?.reservations?.values()??[]){state.plans.delete(vehicle);state.owners.delete(vehicle);}
        vehicle.replanWaiting=false;vehicle.waitAge=0;
      }
      vehicle.laneTimer=(vehicle.laneTimer??0)-Math.min(dt,.5);if(vehicle.laneTimer<=0){vehicle.laneTimer=.4+this.random()*.3;this._tryLaneChange(vehicle);}
      vehicle.routeTimer -= Math.min(dt, .5);
      if (vehicle.routeTimer <= 0) {
        const changed = this._chooseRoute(vehicle);
        vehicle.routeTimer = changed ? 6 + this.random() * 8 : 1 + this.random() * 2;
        if(!changed)this._tryLaneChange(vehicle);
      }
    }
    // Subpasos acotados: un cuadro lento no puede saltarse a otro vehículo o peatón.
    let remaining = Math.min(dt, 0.5);
    while (remaining > 1e-8) {
      const stepTime = Math.min(remaining, 0.05);
      this._buildSpatialIndex(pedestrians);
      this._updating = true;
      try {
        for (const vehicle of this.vehicles) {
          if (vehicle.state === 'chase') {
            this._planChase(vehicle, stepTime, player);
            continue;
          }
          const clearance = this._clearance(vehicle, player, pedestrians);
          let desiredSpeed = Infinity;
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
              const turnSpeed = Math.sqrt(segment.radius * (vehicle.driver?.aLat??CAR_DRIVER.aLat));
              desiredSpeed = Math.min(desiredSpeed, Math.sqrt(turnSpeed ** 2 + 5 * (inCurve ? 0 : ahead)));
            }
            start += segment.length;
          }
          if ((clearance < .5 || desiredSpeed < .05) && vehicle.speed < .1) vehicle.stopped = true;
          if (vehicle.stopped && clearance > .5) {
            vehicle.resumeDelay = vehicle.reactionTime; vehicle.stopped = false;
          }

          vehicle.driver??={...CAR_DRIVER};vehicle.v0=vehicle.cruiseSpeed;
          const obstacleCloser=(vehicle.obstacleGap??Infinity)<(vehicle.leaderGap??Infinity);
          const gap=obstacleCloser?vehicle.obstacleGap:vehicle.leaderGap;
          const leaderSpeed=obstacleCloser?vehicle.obstacleSpeed:vehicle.leaderSpeed;
          vehicle.acceleration=slopAcceleration(vehicle,{gap,leaderSpeed,stopDistance:vehicle.stopDistance,cap:desiredSpeed,playerGap:vehicle.playerClearance,playerSpeed:0});
          const candidateSpeed = THREE.MathUtils.clamp(vehicle.speed + vehicle.acceleration * stepTime, 0, vehicle.cruiseSpeed);
          const speed = candidateSpeed < .01 ? 0 : candidateSpeed;
          const travel = Math.min(Math.max(0, speed * stepTime), vehicle.hardClearance);
          vehicle.nextDistance = (vehicle.distance + travel) % vehicle.route.length;
          vehicle.nextSpeed = travel / stepTime;
          vehicle.nextTravel = travel;

          if (clearance < 3.5 && vehicle.speed > 0.8) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (now - (vehicle.lastHonkTime || 0) > 4000) {
              vehicle.lastHonkTime = now;
              emitHonk(vehicle.car.position.x, vehicle.car.position.z);
            }
          }
        }
      } finally {
        this._updating = false;
      }
      // Todos consultan las mismas posiciones antes de aplicar el movimiento.
      for (const vehicle of this.vehicles) {
        if (vehicle.state === 'chase') {
          if (this._applyChase(vehicle, stepTime)) caught = true;
          continue;
        }
        const startDistance = vehicle.distance;
        const travel = vehicle.nextTravel;
        vehicle.distance = vehicle.nextDistance;
        vehicle.speed = vehicle.nextSpeed;
        this._checkPlayerImpact(vehicle, player, startDistance, travel, onPlayerHit);
        vehicle.route.sample(vehicle.distance, this._position, this._direction);
        vehicle.car.position.copy(this._position);
        vehicle.car.group.rotation.y = Math.atan2(-this._direction.z, this._direction.x);
        this.physics.routePose(vehicle,stepTime);
        vehicle.car.animateDrive(vehicle.speed * stepTime, vehicle.acceleration < -.8||vehicle.speed<.3);
      }
      this.physics.step(this.vehicles,this.parkedCars,this.busVehicles,driving,stepTime,collisions);
      remaining -= stepTime;
    }
    if (caught && !this._arrestDispatched) {
      this._arrestDispatched = true;
      emit('police-arrest', { reason: 'chase' });
    }
  }

  collideDrivenCar(car,driver){this.physics.collideDriver(car,driver);}

  dispose() {
    this.physics.dispose();
    this.signals?.reservations?.clear();
    for (const { car } of this.vehicles) car.dispose();
    this.vehicles.length = 0;
  }
}

