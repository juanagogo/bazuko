import * as THREE from 'three';
import { BICYCLE, bicycleGrip } from '../data/bicycle.js';

const BIKE_RADIUS = BICYCLE.wheelRadius;

const material = (color, options = {}) => new THREE.MeshStandardMaterial({
  color, roughness: .78, ...options
});

function rod(from, to, radius, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const delta = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), mat);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function bicycleVisual(root) {
  const rubber = material('#17191a', { roughness: .94 });
  const frame = material('#245f69', { metalness: .25, roughness: .55 });
  const frameHighlight = material('#3b8990', { metalness: .2, roughness: .5 });
  const metal = material('#9da5a1', { metalness: .78, roughness: .3 });
  const chrome = material('#d1d3c8', { metalness: .9, roughness: .22 });
  const seatMat = material('#242322', { roughness: .97 });
  const steering = new THREE.Group();
  steering.name = 'SteeringGroup';
  steering.position.fromArray(BICYCLE.steering);
  root.add(steering);
  const wheels = [];
  for (const z of [-BICYCLE.wheelbase / 2, BICYCLE.wheelbase / 2]) {
    const wheelAssembly = new THREE.Group();
    // El pivote del conjunto está en el buje: al pedalear la rueda no se separa del cuadro.
    wheelAssembly.position.set(0, BIKE_RADIUS + BICYCLE.tire, z);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(BIKE_RADIUS, BICYCLE.tire, 10, 32), rubber);
    wheel.rotation.y = Math.PI / 2;
    wheel.castShadow = wheel.receiveShadow = true;
    wheelAssembly.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(BIKE_RADIUS - .018, .012, 6, 32), chrome);
    rim.rotation.y = Math.PI / 2;
    wheelAssembly.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .1, 10), metal);
    hub.rotation.z = Math.PI / 2;
    wheelAssembly.add(hub);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      wheelAssembly.add(rod(
        [0, 0, 0],
        [0, Math.sin(angle) * (BIKE_RADIUS - .04), Math.cos(angle) * (BIKE_RADIUS - .04)],
        .006, metal
      ));
    }
    if (z > 0) {
      wheelAssembly.position.sub(steering.position);
      steering.add(wheelAssembly);
    } else root.add(wheelAssembly);
    wheels.push(wheelAssembly);
  }
  root.add(
    // Cuadro de diamante, con tubos algo más gruesos que los radios.
    rod([0, .366, -.58], [0, .78, -.18], .021, frame),
    rod([0, .78, -.18], [0, .43, -.08], .026, frame),
    rod([0, .43, -.08], [0, .366, -.58], .018, frameHighlight),
    rod([0, .43, -.08], [0, .72, .48], .026, frame),
    rod([0, .78, -.18], [0, .78, .48], .022, frameHighlight)
  );
  const local = (a) => [a[0], a[1] - BICYCLE.steering[1], a[2] - BICYCLE.steering[2]];
  steering.add(rod(local([-.045, .366, .58]), local([-.045, .78, .48]), .017, chrome),
    rod(local([.045, .366, .58]), local([.045, .78, .48]), .017, chrome),
    rod(local([0, .78, .48]), local([0, 1.08, .45]), .018, metal),
    rod(local([0, 1.08, .45]), local([0, 1.12, .32]), .016, chrome),
    rod(local([-.31, 1.12, .32]), local([.31, 1.12, .32]), .013, chrome));
  for (const sign of [-1, 1]) {
    steering.add(rod(local([sign * .21, 1.12, .32]), local([sign * .32, 1.12, .32]), .022, rubber),
      rod(local([sign * .2, 1.11, .35]), local([sign * .29, 1.08, .38]), .008, metal));
  }
  const seatPost = rod([0, .72, -.18], BICYCLE.seat, .014, chrome);
  root.add(seatPost);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(.18, .045, .3), seatMat);
  seat.position.fromArray(BICYCLE.seat);
  seat.name = 'Saddle';
  seat.rotation.x = -.12;
  seat.castShadow = true;
  root.add(seat);
  // Bielas, pedales y plato: pequeños detalles que rompen el aspecto de juguete.
  const pedalAssembly = new THREE.Group();
  pedalAssembly.position.fromArray(BICYCLE.crank);
  pedalAssembly.name = 'CrankGroup';
  const crank = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .13, 10), metal);
  crank.rotation.z = Math.PI / 2;
  pedalAssembly.add(crank,
    rod([-.07, 0, 0], [-.2, 0, -BICYCLE.crankRadius], .014, metal),
    rod([.07, 0, 0], [.2, 0, BICYCLE.crankRadius], .014, metal)
  );
  const pedalLeft = new THREE.Mesh(new THREE.BoxGeometry(.12, .035, .09), rubber);
  pedalLeft.position.set(.2, 0, BICYCLE.crankRadius);
  const pedalRight = new THREE.Mesh(new THREE.BoxGeometry(.12, .035, .09), rubber);
  pedalRight.position.set(-.2, 0, -BICYCLE.crankRadius);
  pedalAssembly.add(pedalLeft, pedalRight);
  const chainring = new THREE.Mesh(new THREE.TorusGeometry(.105, .009, 5, 18), metal);
  chainring.rotation.y = Math.PI / 2;
  chainring.position.set(-.08, 0, 0);
  pedalAssembly.add(chainring);
  root.add(pedalAssembly);
  root.name = 'VisualGroup';
  const anchors = new THREE.Group(); anchors.name = 'RiderAnchors'; root.add(anchors);
  const seatAnchor = new THREE.Object3D(); seatAnchor.name = 'seatAnchor'; seatAnchor.position.copy(seat.position); anchors.add(seatAnchor);
  for (const side of ['left', 'right']) {
    const grip = new THREE.Object3D(); grip.name = `${side}HandGrip`;
    bicycleGrip(side, 0, grip.position).sub(steering.position); steering.add(grip);
  }
  for (const [pedal, name] of [[pedalLeft, 'leftPedalTarget'], [pedalRight, 'rightPedalTarget']]) {
    const target = new THREE.Object3D(); target.name = name; target.position.y = .018; pedal.add(target);
  }
  return { wheels, steering, pedalAssembly, pedals: [pedalLeft, pedalRight] };
}

export class Bicycle {
  constructor(scene, position = new THREE.Vector3(), rotation = 0, { id, stationId = null } = {}) {
    this.scene = scene;
    this.id = id;
    this.stationId = stationId;
    this.status = 'available';
    this.rentalOrigin = null;
    this.rentalPaid = false;
    this.rider = null;
    this.position = position.clone();
    this.group = new THREE.Group();
    this.group.name = `bicycle-${id ?? 'publica'}`;
    this.group.position.copy(this.position);
    this.group.rotation.y = rotation;
    this._wheelPhase = 0;
    this._driveSpeed = 0;
    this.speed = 0;
    this.lookBack = 0;
    this.supportFoot = 0;
    this.reverseFoot = 0;
    this.reversePhase = 0;
    this.driveInput = 0;
    this._reverseHold = 0;
    this.pedalPhase = 0;
    this.steerAngle = 0;
    this.mountTime = 0;
    this.visual = new THREE.Group(); this.group.add(this.visual);
    this._visual = bicycleVisual(this.visual);
    this._candidate = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._heading = new THREE.Vector3();
    this._exit = new THREE.Vector3();
    scene.add(this.group);
  }

  get kind() { return 'bicycle'; }
  get title() { return 'Bicicleta pública'; }
  interactDistance(point) { return Math.hypot(point.x - this.position.x, point.z - this.position.z); }

  mount(player, stolen = false) {
    if (!player || this.rider || player.bicycle || (!['available', 'parked', 'stolen'].includes(this.status) && !stolen)) return false;
    const collisions = player.game?.collisions ?? player._lastCollisions;
    const station = player.game?.bikeStations?.find(s => s.bikes.includes(this));
    this._origin.copy(this.position);
    // Sacar la bici del rack ANTES de alinear al ciclista. Las otras bicis siguen sólidas.
    if (station) {
      let found = false;
      for (const distance of [2.3, -2.3, 3.2, -3.2]) {
        const yaw = this.group.rotation.y;
        this._candidate.set(Math.sin(yaw) * distance, 0, Math.cos(yaw) * distance).add(this.position);
        if (this._freeAt(this._candidate, player, collisions, .85)) { this._origin.copy(this._candidate); found = true; break; }
      }
      if (!found) return false;
    } else if (!this._freeAt(this._origin, player, collisions, .5)) return false;
    if (typeof player.mountBicycle === 'function' && !player.mountBicycle(this)) return false;
    station?.removeBike(this);
    this.position.copy(this._origin);
    this.rider = player;
    this.status = stolen || this.status === 'stolen' ? 'stolen' : 'rented';
    if (stolen) { this.rentalOrigin = null; this.rentalPaid = false; }
    this.stationId = null;
    player.position.copy(this.position);
    player.root.position.copy(this.position);
    player.root.rotation.y = this.group.rotation.y;
    player.root.rotation.x = player.root.rotation.z = 0;
    this.group.position.copy(this.position);
    this.speed = this._driveSpeed = 0;
    this.lookBack = this._reverseHold = 0;
    this.supportFoot = this.reverseFoot = this.reversePhase = this.driveInput = 0;
    this.mountTime = BICYCLE.mountSeconds;
    return true;
  }

  _freeAt(point, player, collisions, radius) {
    const district = player.game?.world?.active;
    const surface = district?.getPlayerGroundSurface?.(point.x, point.z, { from: this.position, grounded: true, surface: player.groundSurface });
    const y = typeof surface === 'number' ? surface : surface?.height;
    if (Number.isFinite(y)) point.y = y;
    if (Math.abs(point.y - this.position.y) > .5 || district?.getWaterInfo?.(point.x, point.z)?.depth > .1) return false;
    return collisions?.isPositionFree?.(point, radius, this) ?? true;
  }

  dismount(player, { forced = false } = {}) {
    if (this.rider !== player) return false;
    if (!forced && player.isGrounded === false) return false;
    let found = false;
    if (!forced) {
      const yaw = this.group.rotation.y;
      for (const side of [1, -1]) {
        this._exit.set(Math.cos(yaw) * side, 0, -Math.sin(yaw) * side).add(this.position);
        if (this._freeAt(this._exit, player, player.game?.collisions ?? player._lastCollisions, player.radius ?? .4)) { found = true; break; }
      }
      if (!found) return false;
      player.position.copy(this._exit); player.root.position.copy(player.position);
    } else {
      // Un golpe durante un salto no deja la bicicleta suspendida para siempre.
      const district = player.game?.world?.active;
      const surface = district?.getPlayerGroundSurface?.(this.position.x, this.position.z,
        { from: this.position, grounded: false, surface: player.groundSurface });
      const y = typeof surface === 'number' ? surface : surface?.height;
      if (Number.isFinite(y)) this.position.y = y;
      else if (player.groundSurface?.height !== undefined) this.position.y = player.groundSurface.height;
      this.group.position.copy(this.position);
    }
    this.rider = null;
    player.bicycle = null;
    player.velocity?.set(0, 0, 0);
    player.speed = 0;
    player.root.rotation.x = player.root.rotation.z = 0;
    if (this.status === 'rented') this.status = 'parked';
    this.speed = this._driveSpeed = 0;
    this.lookBack = this._reverseHold = 0;
    this.supportFoot = this.reverseFoot = this.reversePhase = this.driveInput = 0;
    this.visual.rotation.set(0, 0, 0);
    return true;
  }

  drive(dt, throttle, steer, sprint, grounded) {
    this.mountTime = Math.max(0, this.mountTime - dt);
    const active = this.mountTime === 0;
    const request = active && Math.abs(throttle) > .05 ? Math.sign(throttle) : 0;
    this.driveInput = request;
    const effort = Math.min(1, Math.abs(throttle));
    const magnitude = Math.abs(this.speed);
    if (request && this.speed * request < 0) {
      // La tecla contraria frena hasta cero antes de cambiar de sentido.
      this.speed = Math.sign(this.speed) * Math.max(0, magnitude - 9 * effort * dt);
      this._reverseHold = 0;
    } else if (request) {
      this._reverseHold = request < 0 ? this._reverseHold + dt : 0;
      if (request > 0 || this.speed < 0 || this._reverseHold >= BICYCLE.reverseDelay) {
        const max = request < 0 ? BICYCLE.reverseSpeed : sprint ? 8 : 5.5;
        const acceleration = request < 0 ? 2.3 : sprint ? 5 : 3.5;
        const push = effort * acceleration * Math.max(0, 1 - magnitude / max);
        const drag = .15 + .018 * magnitude ** 2;
        this.speed = request * Math.max(0, Math.min(request < 0 ? BICYCLE.reverseSpeed : 8.5, magnitude + (push - drag) * dt));
      }
    } else {
      this._reverseHold = 0;
      this.speed = Math.sign(this.speed) * Math.max(0, magnitude - (.15 + .018 * magnitude ** 2) * dt);
    }
    if (Math.abs(this.speed) < .000001) this.speed = 0;
    this.steerAngle += ((active ? steer * BICYCLE.maxSteer : 0) - this.steerAngle) * (1 - Math.exp(-9 * dt));
    if (grounded) this.group.rotation.y += Math.tan(this.steerAngle) * this.speed / BICYCLE.wheelbase * dt;
    return this._heading.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y)).multiplyScalar(this.speed);
  }

  advanceAnimation(dt, distance, grounded, pedaling) {
    this._wheelPhase += distance / (BIKE_RADIUS + BICYCLE.tire);
    if (grounded && pedaling && distance > .00001) this.pedalPhase = (this.pedalPhase + distance / 2.8 * Math.PI * 2) % (Math.PI * 2);
    if (grounded && distance < -.00001) this.reversePhase = (this.reversePhase - distance / .9 * Math.PI * 2) % (Math.PI * 2);
    const reverse = grounded && (this.speed < -.08 || this.driveInput < 0 && this.speed <= 0) ? 1 : 0;
    const support = grounded && this.mountTime === 0 && !this.driveInput && Math.abs(this.speed) < .08 ? 1 : 0;
    const blend = 1 - Math.exp(-10 * dt);
    this.supportFoot += (support - this.supportFoot) * blend;
    this.reverseFoot += (reverse - this.reverseFoot) * blend;
    const backwards = this.speed < -.08 && distance < -.00001 ? 1 : 0;
    this.lookBack += (backwards - this.lookBack) * (1 - Math.exp(-7 * dt));
    this._visual.steering.rotation.y = this.steerAngle;
    for (const wheel of this._visual.wheels) wheel.rotation.x = this._wheelPhase;
    this._visual.pedalAssembly.rotation.x = this.pedalPhase;
    for (const pedal of this._visual.pedals) pedal.rotation.x = -this.pedalPhase;
    const lean = -this.steerAngle * Math.min(.6, Math.abs(this.speed) / 10);
    this.visual.rotation.z += (lean - this.visual.rotation.z) * (1 - Math.exp(-8 * dt));
  }

  update(dt, player) {
    if (this.rider !== player) return;
    this.position.copy(player.position);
    this.group.position.copy(this.position);
    this.group.rotation.y = player.root.rotation.y;
    // Player es el único que avanza la física y el reloj de pedaleo.
  }

  saveState() {
    return {
      id: this.id, x: this.position.x, y: this.position.y, z: this.position.z,
      rotation: this.group.rotation.y, status: this.status, stationId: this.stationId,
      rental: this.rentalPaid ? { stationId: this.rentalOrigin, paid: true } : null
    };
  }

  loadState(state) {
    if (!state || state.id !== this.id) return;
    if (Number.isFinite(state.x)) this.position.x = state.x;
    if (Number.isFinite(state.y)) this.position.y = state.y;
    if (Number.isFinite(state.z)) this.position.z = state.z;
    if (Number.isFinite(state.rotation)) this.group.rotation.y = state.rotation;
    if (['available', 'parked', 'stolen', 'rented'].includes(state.status)) this.status = state.status === 'rented' ? 'parked' : state.status;
    this.stationId = state.stationId ?? null;
    this.rentalOrigin = typeof state.rental?.stationId === 'string' ? state.rental.stationId : null;
    this.rentalPaid = !!this.rentalOrigin && state.rental?.paid === true && this.status !== 'stolen';
    this.group.position.copy(this.position);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
      if (object.material && !object.material.userData?.shared) object.material.dispose?.();
    });
  }
}

export class BicycleStation {
  constructor(scene, { id, name, x, y = 0, z, rot = 0, capacity = 6 }) {
    this.scene = scene;
    this.kind = 'bicycle-station';
    this.id = id;
    this.title = name;
    this.capacity = capacity;
    this.position = new THREE.Vector3(x, y, z);
    this.group = new THREE.Group();
    this.group.name = `bicycle-station-${id}`;
    this.group.position.copy(this.position);
    this.group.rotation.y = rot;
    this.bikes = [];
    const metal = material('#263b3d', { metalness: .35, roughness: .72 });
    const sign = material('#d4b44c', { roughness: .8 });
    const rackWidth = (capacity - 1) * .72 + .5;
    this.group.add(new THREE.Mesh(new THREE.BoxGeometry(rackWidth, .08, .45), metal));
    for (let i = 0; i < capacity; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(.04, .38, .04), metal);
      post.position.set((i - (capacity - 1) / 2) * .72, .2, 0);
      this.group.add(post);
    }
    const marker = new THREE.Mesh(new THREE.BoxGeometry(.8, .38, .04), sign);
    marker.position.set(0, .65, 0);
    this.group.add(marker);
    this.group.traverse((object) => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });
    scene.add(this.group);
  }

  interactDistance(point) {
    const dx = point.x - this.position.x, dz = point.z - this.position.z;
    const c = Math.cos(this.group.rotation.y), s = Math.sin(this.group.rotation.y);
    const x = dx * c - dz * s, z = dx * s + dz * c;
    return Math.hypot(Math.max(0, Math.abs(x) - (this.capacity - 1) * .36 - .3), Math.max(0, Math.abs(z) - .9));
  }
  availableBike() { return this.bikes.find((bike) => bike.status === 'available' && !bike.rider) ?? null; }
  dockPosition(index = 0, out = new THREE.Vector3()) {
    const offset = new THREE.Vector3((index - (this.capacity - 1) / 2) * .72, 0, .24).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y);
    return out.copy(this.position).add(offset);
  }

  addBike(bike) {
    if (!bike || this.bikes.includes(bike) || this.bikes.length >= this.capacity) return false;
    this.bikes.push(bike);
    bike.stationId = this.id;
    return true;
  }

  removeBike(bike) {
    const before = this.bikes.length;
    this.bikes = this.bikes.filter((item) => item !== bike);
    return this.bikes.length !== before;
  }

  returnBike(bike) {
    if (!bike || (this.bikes.length >= this.capacity && !this.bikes.includes(bike))) return false;
    this.removeBike(bike);
    bike.rider = null;
    bike.status = 'available';
    bike.stationId = this.id;
    bike.rentalOrigin = null;
    bike.rentalPaid = false;
    const occupied = new Set(this.bikes.map(item => item.dockSlot));
    const slot = Array.from({ length: this.capacity }, (_, i) => i).find(i => !occupied.has(i));
    bike.dockSlot = slot;
    bike.position.copy(this.dockPosition(slot));
    bike.group.position.copy(bike.position);
    bike.group.rotation.y = this.group.rotation.y;
    this.bikes.push(bike);
    return true;
  }

  takeBike() {
    const bike = this.availableBike();
    if (!bike) return null;
    this.bikes = this.bikes.filter((item) => item !== bike);
    return bike;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
      if (object.material && !object.material.userData?.shared) object.material.dispose?.();
    });
  }
}
