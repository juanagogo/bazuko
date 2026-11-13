// src/entities/patrolCar.js
// Lo que la patrulla necesita para que sus agentes se bajen y se suban sin clips: las dos puertas delanteras, que se
// abren sobre su bisagra, el hueco oscuro que dejan en la carrocería, el acompañante sentado y el uniforme de los dos.
// Todo cuelga de la carrocería suspendida, así que se mece con ella. Geometrías por modelo y lado, y materiales, se
// comparten entre patrullas; nada de esto se libera al desechar un carro.
import * as THREE from 'three';
import { CAR_MODELS } from '../world/bogota/carModels.js';
import { getCarBody, getDriverGeometry } from '../world/bogota/VehicleBody.js';

/** Uniforme de las patrullas de cuadrante: verde oliva, chaleco reflectivo verde limón y gorra. */
export const PATROL_COLORS = { chaleco: '#b9d531', uniforme: '#4b5a2a', gorra: '#3a4329', bota: '#1b1b1c' };
const SKINS = ['#e0b08a', '#c68a5e', '#9a6440', '#6e4529'];

const DOOR_OPEN = 1.12;   // rad: la puerta abierta queda a unos 64°
const DOOR_TIME = .35;    // s en abrir o cerrar
const DOOR_SNAP = .16;    // s en abrirse de un tirón, cuando se bajan a perseguir
const DOOR_BOUNCE = .2;   // s del rebote contra el tope después del tirón
const BOUNCE = .03;       // cuánto pasa del tope en el rebote: apenas un par de grados
const SEATED_TOP = 1.13;  // m de la raíz al tope de la gorra en la postura `patrulla` (lo mide patrol-seat.test.js)
const HEAD_ROOM = .05;    // m entre el tope de la gorra y el techo por dentro
const ROOF_SKIN = .03;    // m de grueso del techo
const OUT = .55;          // m desde el costado hasta donde queda parado quien se baja (como `Car.driverDoor`)

let materials = null;
function shared() {
  if (materials) return materials;
  const make = (color, roughness, metalness = 0) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    material.userData.shared = true;
    return material;
  };
  materials = {
    paint: make('#cfd2d2', .42, .2),
    stripe: make('#0b5c2e', .5),
    inner: make('#2a2b2d', .85),
    frame: make('#141516', .6),
    hole: make('#0b0b0c', 1)
  };
  return materials;
}

const smooth = t => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };

/** Rejilla de la cara de la puerta: `zAt(x, y)` da la Z local; `flip` voltea la cara. */
function panelGeometry(x0, x1, yLow, yHigh, zAt, flip, cols = 7, rows = 4) {
  const positions = [], index = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const x = x0 + (x1 - x0) * i / cols;
    const lo = yLow(x), hi = Math.max(lo + .01, yHigh(x));
    const y = lo + (hi - lo) * j / rows;
    positions.push(x, y, zAt(x, y));
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    if (flip) index.push(a, c, b, b, c, d);
    else index.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Marco de la ventana bajada: una cinta delgada por el borde, con cara a los dos lados. */
function frameGeometry(points, zAt, width = .045) {
  const positions = [], index = [];
  for (let k = 0; k < points.length - 1; k++) {
    const [ax, ay] = points[k], [bx, by] = points[k + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    // Hacia adentro de la ventana: a la derecha del recorrido, que va de atrás hacia adelante por arriba.
    const nx = (by - ay) / len * width, ny = -(bx - ax) / len * width;
    const quad = [[ax, ay], [bx, by], [ax + nx, ay + ny], [bx + nx, by + ny]];
    const base = positions.length / 3;
    for (const [x, y] of quad) positions.push(x, y, zAt(x, y));
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

const doorCache = new Map();
/** Puerta delantera de un modelo, de un lado (−1 izquierda, la del conductor; 1 derecha). Coordenadas desde la bisagra. */
function doorParts(model, side) {
  const key = `${model}:${side}`;
  if (doorCache.has(key)) return doorCache.get(key);
  const spec = CAR_MODELS[model], body = getCarBody(model);
  const [x0, x1] = spec.gaps?.doors?.[0] ?? [spec.driver.x - .55, spec.driver.x + .55];
  const [w0, w1] = spec.windows?.at(-1) ?? [x0, x1];
  const low = x => body.yBottom(x) + .03, belt = x => body.belt(x) - .01;
  const hingeY = (low(x1) + belt(x1)) / 2, hingeZ = body.sideZ(x1, hingeY);
  // Coordenadas de la puerta: la bisagra en el origen, el lado hacia +Z si es la derecha.
  const local = offset => (x, y) => side * (body.sideZ(x, y) + offset - hingeZ);
  const shift = geometry => { geometry.translate(-x1, 0, 0); return geometry; };
  const outer = shift(panelGeometry(x0 + .01, x1 - .01, low, belt, local(.012), side < 0));
  const inner = shift(panelGeometry(x0 + .01, x1 - .01, low, belt, local(-.035), side > 0));
  // Franja verde de la patrulla, a la misma altura que la pintada en la carrocería.
  const stripeLow = x => spec.policeY ?? (body.shoulder(x) - .29);
  const stripe = shift(panelGeometry(x0 + .02, x1 - .02, x => Math.max(low(x), stripeLow(x)),
    x => Math.min(belt(x), stripeLow(x) + .22), local(.016), side < 0, 6, 1));
  const top = x => body.edge(x) - .03;
  const fx0 = Math.max(x0 + .02, w0), fx1 = Math.min(x1 - .02, w1);
  const outline = [[fx0, belt(fx0)], [fx0, top(fx0)]];
  for (let k = 1; k <= 8; k++) { const x = fx0 + (fx1 - fx0) * k / 8; outline.push([x, Math.max(belt(x), top(x))]); }
  outline.push([fx1, belt(fx1)]);
  const frame = shift(frameGeometry(outline, local(.004)));
  // El hueco que deja la puerta abierta: sobre la chapa, en coordenadas del carro.
  const hole = panelGeometry(x0 + .02, x1 - .02, low, belt, (x, y) => side * (body.sideZ(x, y) + .006), side < 0, 7, 3);
  const parts = { outer, inner, stripe, frame, hole, hinge: new THREE.Vector3(x1, 0, side * hingeZ) };
  doorCache.set(key, parts);
  return parts;
}

/**
 * A qué altura va la raíz de quien se sienta en un modelo, con `anchor` su asiento y `height` la altura a la que llega
 * la cabeza del conductor de siempre: la que deja el tope de la gorra `HEAD_ROOM` m bajo el techo, medido en la carrocería
 * sobre el asiento y un poco alrededor, que el techo baja hacia el parabrisas y hacia los lados.
 */
export function seatLift(model, anchor, height) {
  let top = height;
  if (CAR_MODELS[model]) {
    const body = getCarBody(model), z = Math.abs(anchor.z);
    let roof = Infinity;
    for (const dx of [-.3, -.2, -.1, 0, .1]) for (const dz of [-.12, 0, .12]) roof = Math.min(roof, body.topY(anchor.x + dx, z + dz));
    top = Math.min(top, roof - ROOF_SKIN - HEAD_ROOM);
  }
  return Math.max(0, top - SEATED_TOP);
}

/**
 * Accesorios de una patrulla para los agentes a pie. Se crea una vez por patrulla; `update(dt)` anima las puertas y
 * ajusta lo que se ve sentado al detalle del carro.
 */
export class PatrolCar {
  constructor(car, random = Math.random) {
    this.car = car;
    const v = car.vehicle, parent = v.bodyVisual ?? car.group, m = shared();
    this.anchor = (v.driverAnchor ?? new THREE.Vector3(.2, 0, -.38)).clone();
    this.height = v.driverHeight ?? 1.5;
    this.seatLift = seatLift(v.model, this.anchor, this.height);
    this.doors = {};
    for (const side of [-1, 1]) {
      const parts = CAR_MODELS[v.model] ? doorParts(v.model, side) : null;
      const pivot = new THREE.Group();
      pivot.name = side < 0 ? 'Puerta del conductor' : 'Puerta del acompañante';
      pivot.visible = false;
      let hole = null;
      if (parts) {
        pivot.position.copy(parts.hinge);
        for (const [geometry, material] of [[parts.outer, m.paint], [parts.inner, m.inner], [parts.stripe, m.stripe], [parts.frame, m.frame]]) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          pivot.add(mesh);
        }
        hole = new THREE.Mesh(parts.hole, m.hole);
        hole.name = 'Hueco de la puerta';
        hole.visible = false;
        parent.add(hole);
      }
      parent.add(pivot);
      this.doors[side] = { pivot, hole, open: 0, wanted: false, fast: false, bounce: 0 };
    }
    // Los dos van de uniforme: la figura sentada del conductor se viste de agente y se suma el acompañante.
    const skin = () => SKINS[Math.floor(random() * SKINS.length)];
    const geometry = () => getDriverGeometry(PATROL_COLORS.chaleco, skin(), PATROL_COLORS.gorra);
    if (car.driver?.children[0]) car.driver.children[0].geometry = geometry();
    this.passenger = new THREE.Group();
    this.passenger.name = 'Acompañante';
    const seated = new THREE.Mesh(geometry(), v.trimMaterial ?? m.inner);
    seated.name = 'Cuerpo del acompañante';
    seated.position.y = this.height;
    this.passenger.add(seated);
    this.passenger.position.set(this.anchor.x, 0, Math.abs(this.anchor.z));
    parent.add(this.passenger);
    this.passengerInside = true;
  }

  /** Abre (true) o cierra la puerta delantera de un lado; `fast`, de un tirón y rebotando contra el tope. */
  setDoor(side, open, fast = false) {
    const door = this.doors[side];
    if (open && fast && !door.wanted) door.fast = true;
    if (!open) door.fast = false;
    door.wanted = !!open;
  }

  /** 0 cerrada .. 1 abierta. */
  doorAmount(side) { return this.doors[side].open; }

  setPassengerInside(inside) { this.passengerInside = !!inside; }

  /** Dónde va sentado cada uno, en el mundo: la raíz a la altura que le deja la cabeza bajo el techo (ver `seatLift`). */
  seatPoint(side, target = new THREE.Vector3()) {
    this.car.group.updateMatrixWorld();
    return target.set(this.anchor.x, this.seatLift, side * Math.abs(this.anchor.z)).applyMatrix4(this.car.group.matrixWorld);
  }

  /** Justo afuera del costado, a la altura `lift` sobre la calle: hasta ahí se desliza, con un pie ya en el piso, antes de pararse. */
  edgePoint(side, lift, target = new THREE.Vector3()) {
    this.car.group.updateMatrixWorld();
    const x = this.car.vehicle.driverDoor?.x ?? this.anchor.x;
    return target.set(x, lift, side * (this.car.width / 2 + .12)).applyMatrix4(this.car.group.matrixWorld);
  }

  /** Dónde queda parado quien se baja por ese lado, a nivel de la calle. */
  doorPoint(side, target = new THREE.Vector3()) {
    this.car.group.updateMatrixWorld();
    const x = this.car.vehicle.driverDoor?.x ?? this.anchor.x;
    return target.set(x, 0, side * (this.car.width / 2 + OUT)).applyMatrix4(this.car.group.matrixWorld).setY(this.car.group.position.y);
  }

  update(dt) {
    for (const side of [-1, 1]) {
      const door = this.doors[side];
      const goal = door.wanted ? 1 : 0;
      if (door.open !== goal) {
        const opening = goal > door.open, time = opening && door.fast ? DOOR_SNAP : DOOR_TIME;
        door.open = opening ? Math.min(1, door.open + dt / time) : Math.max(0, door.open - dt / time);
        if (door.open === 1 && door.fast) { door.fast = false; door.bounce = DOOR_BOUNCE; }
        if (!opening) door.bounce = 0;
      } else if (door.bounce > 0) door.bounce = Math.max(0, door.bounce - dt);
      const shown = door.open > 0;
      door.pivot.visible = shown;
      if (door.hole) door.hole.visible = door.open > .08;
      // El rebote: pasa un poco del tope y vuelve, cada vez menos.
      const k = door.bounce > 0 ? door.bounce / DOOR_BOUNCE : 0;
      if (shown) door.pivot.rotation.y = side * DOOR_OPEN * smooth(door.open) * (1 + BOUNCE * Math.sin((1 - k) * Math.PI * 2) * k);
    }
    // El acompañante se ve como el conductor: solo de cerca y mientras va sentado.
    const detail = this.car.driver?.children[0]?.visible ?? true;
    this.passenger.visible = this.passengerInside;
    this.passenger.children[0].visible = detail;
  }

  /** Todo cerrado y los dos adentro: como salió de fábrica. */
  restore() {
    for (const side of [-1, 1]) Object.assign(this.doors[side], { wanted: false, open: 0, fast: false, bounce: 0 });
    this.passengerInside = true;
    this.car.setDriverInside?.(true);
    this.update(0);
  }

  dispose() {
    for (const side of [-1, 1]) {
      this.doors[side].pivot.removeFromParent();
      this.doors[side].hole?.removeFromParent();
    }
    this.passenger.removeFromParent();
  }
}
