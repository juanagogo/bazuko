// src/entities/Bicycle.js
// Bicicleta urbana bogotana: transporte ágil para pedalear por la ciudad y objeto de hurto.
import * as THREE from 'three';
import { INTERACT_RANGE } from '../utils/constants.js';

const BIKE_COLORS = [
  0x1a5fb4, // azul clásico
  0xc01c28, // rojo brillante
  0x26a269, // verde cicloruta
  0xe5a50a, // amarillo bogotano
  0x222225, // negro mate
  0xd5d5d8  // plateado / aluminio
];

const WHEEL_RADIUS = 0.33;
const TIRE_TUBE_RADIUS = .024;
const ROLLING_RADIUS = WHEEL_RADIUS + TIRE_TUBE_RADIUS;
const WHEEL_TURNS_PER_PEDAL_TURN = 2.8;
const CHAIN_SOUND_PERIOD = .225;
const FRONT_AXLE_Z = .54, REAR_AXLE_Z = -.52;
const SEAT_CLUSTER = [0, .68, -.22];
const SEAT_POST_RISE = .10;
const SEAT_POST_REACH = -.02;
const SEAT_POST_LENGTH = Math.hypot(SEAT_POST_RISE, SEAT_POST_REACH);
const SADDLE_RISE = .12;
const MAX_STEER_ANGLE = .55;
const MAX_LEAN_ANGLE = .22;
const MAX_RIDE_PITCH = .30;
const MAX_RIDE_GROUND_CHANGE = .35;
const CRANK_RADIUS = .11;

function tubeBetween(p1, p2, radius, material) {
  const v1 = new THREE.Vector3(...p1);
  const v2 = new THREE.Vector3(...p2);
  const dir = new THREE.Vector3().subVectors(v2, v1);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;

  const mid = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

export class Bicycle {
  constructor(scene, position, rotation = 0, { locked = true, stolen = false, color = null, groundHeight = null } = {}) {
    this.scene = scene;
    this.kind = 'bicycle';
    this.isLocked = locked;
    this.stolen = stolen;
    this.isRidden = false;
    this.rider = null;
    this.groundHeight = groundHeight;

    this.position = position.clone();
    this.rotationY = rotation;
    this.steerAngle = 0;
    this.wheelRotation = 0;
    this.pedalRotation = 0;
    this._chainSoundTimer = 0;
    this._saddleDrop = 0;
    this._groundProbe = new THREE.Vector3();
    this._crankRadius = CRANK_RADIUS;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.group.rotation.y = rotation;

    this.color = color ?? BIKE_COLORS[Math.floor(Math.random() * BIKE_COLORS.length)];
    this._buildModel();
    this._settleParked(this.position.y);

    scene.add(this.group);
  }

  _buildModel() {
    const lam = (c, flat = true) => new THREE.MeshLambertMaterial({ color: c, flatShading: flat });
    const frameMat = lam(this.color);
    const metalMat = lam(0x8a929a);
    const rubberMat = lam(0x18181b);
    const seatMat = lam(0x202022);
    const chromeMat = lam(0xd0d5dd);

    // Grupo de la bicicleta centrado en el eje de gravedad (Y=0 es el suelo)
    this.bikeBody = new THREE.Group();
    this.group.add(this.bikeBody);

    // Puntos del cuadro (X=lado, Y=alto desde el suelo, Z=adelante/atrás)
    // Z positivo es el frente de la bicicleta
    const pFrontAxle = [0, WHEEL_RADIUS, FRONT_AXLE_Z];
    const pRearAxle = [0, WHEEL_RADIUS, REAR_AXLE_Z];
    const pBottomBracket = [0, 0.28, -0.06];
    const pSeatCluster = SEAT_CLUSTER;
    const pHeadTop = [0, 0.82, 0.40];
    const pHeadBottom = [0, 0.70, 0.43];

    // 1. Cuadro principal
    this.bikeBody.add(tubeBetween(pSeatCluster, pBottomBracket, 0.02, frameMat));
    this.bikeBody.add(tubeBetween(pSeatCluster, pHeadTop, 0.018, frameMat));
    this.bikeBody.add(tubeBetween(pBottomBracket, pHeadBottom, 0.022, frameMat));
    this.bikeBody.add(tubeBetween(pHeadBottom, pHeadTop, 0.024, frameMat));

    // Vainas traseras (stays)
    for (const s of [-1, 1]) {
      const axleOffset = [s * 0.045, pRearAxle[1], pRearAxle[2]];
      const bbOffset = [s * 0.035, pBottomBracket[1], pBottomBracket[2]];
      const seatOffset = [s * 0.025, pSeatCluster[1], pSeatCluster[2]];
      this.bikeBody.add(tubeBetween(bbOffset, axleOffset, 0.012, frameMat));
      this.bikeBody.add(tubeBetween(seatOffset, axleOffset, 0.012, frameMat));
    }

    // 2. Rueda trasera
    this.rearWheelGroup = new THREE.Group();
    this.rearWheelGroup.position.set(0, pRearAxle[1], pRearAxle[2]);
    this.rearTire = this._buildWheel(this.rearWheelGroup, rubberMat, metalMat);
    this.bikeBody.add(this.rearWheelGroup);

    // 3. Dirección y horquilla delantera
    this.steerGroup = new THREE.Group();
    this.steerGroup.position.set(0, pHeadTop[1], pHeadTop[2]);
    this.bikeBody.add(this.steerGroup);

    // Horquilla bajando desde el cabezal hacia el eje delantero
    for (const s of [-1, 1]) {
      const forkTop = [s * 0.025, 0, 0];
      const forkBottom = [s * 0.04, pFrontAxle[1] - pHeadTop[1], pFrontAxle[2] - pHeadTop[2]];
      this.steerGroup.add(tubeBetween(forkTop, forkBottom, 0.014, frameMat));
    }

    // Manubrio y potencia (stem)
    const stem = tubeBetween([0, 0, 0], [0, 0.08, 0.03], 0.016, chromeMat);
    this.steerGroup.add(stem);

    const barGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.54, 8);
    const handlebar = new THREE.Mesh(barGeo, chromeMat);
    handlebar.rotation.z = Math.PI / 2;
    handlebar.position.set(0, 0.08, 0.03);
    this.steerGroup.add(handlebar);

    // Empuñaduras de caucho en los extremos
    this.grips = [];
    for (const s of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 6), rubberMat);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(s * 0.22, 0.08, 0.03);
      this.steerGroup.add(grip);
      this.grips.push(grip);
    }

    // Rueda delantera (dentro del grupo de dirección)
    this.frontWheelGroup = new THREE.Group();
    this.frontWheelGroup.position.set(0, pFrontAxle[1] - pHeadTop[1], pFrontAxle[2] - pHeadTop[2]);
    this.frontTire = this._buildWheel(this.frontWheelGroup, rubberMat, metalMat);
    this.steerGroup.add(this.frontWheelGroup);

    // 4. Sillín / Asiento
    this._seatPost = tubeBetween(pSeatCluster, [0, pSeatCluster[1] + SEAT_POST_RISE, pSeatCluster[2] + SEAT_POST_REACH], 0.015, metalMat);
    this.bikeBody.add(this._seatPost);

    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.26), seatMat);
    saddle.position.set(pSeatCluster[0], pSeatCluster[1] + SADDLE_RISE, pSeatCluster[2] - 0.03);
    saddle.rotation.x = -0.06;
    saddle.castShadow = true;
    this.bikeBody.add(saddle);
    this.saddle = saddle;

    // 5. Platos y pedales
    this.crankGroup = new THREE.Group();
    this.crankGroup.position.set(0, pBottomBracket[1], pBottomBracket[2]);
    this.bikeBody.add(this.crankGroup);

    const chainRing = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.01, 12), metalMat);
    chainRing.rotation.z = Math.PI / 2;
    chainRing.position.x = 0.035;
    this.crankGroup.add(chainRing);

    this.pedals = [];
    this._crankArms = [];
    for (const s of [-1, 1]) {
      const arm = tubeBetween([s * 0.045, 0, 0], [s * 0.045, s * CRANK_RADIUS, 0], 0.01, metalMat);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.08), rubberMat);
      pedal.position.set(s * 0.08, s * CRANK_RADIUS, 0);
      this.crankGroup.add(arm, pedal);
      this.pedals.push(pedal);
      this._crankArms.push(arm);
    }

    // 6. Pata de apoyo (kickstand)
    this.kickstand = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 5), metalMat);
    this.kickstand.position.set(-0.06, 0.16, -0.22);
    this.kickstand.rotation.z = 0.45; // inclinada hacia afuera cuando está parqueada
    this.kickstand.rotation.x = -0.25;
    this.bikeBody.add(this.kickstand);

    // 7. Candado / Guaya de seguridad si está asegurada
    this.lockGroup = new THREE.Group();
    const lockCable = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 12), lam(0x0f52ba)); // guaya azul
    lockCable.rotation.y = Math.PI / 2;
    lockCable.position.set(0.06, pFrontAxle[1], pFrontAxle[2]);
    const lockHead = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.08), lam(0xd97706)); // candado dorado
    lockHead.position.set(0.06, pFrontAxle[1] - 0.08, pFrontAxle[2]);
    this.lockGroup.add(lockCable, lockHead);
    this.bikeBody.add(this.lockGroup);

    if (!this.isLocked) {
      this.lockGroup.visible = false;
    }

    // Inclinación inicial de parqueo si no está montada
    if (!this.isRidden) {
      this.bikeBody.rotation.z = -0.12;
    }
  }

  _buildWheel(parent, rubberMat, metalMat) {
    // Llanta de caucho
    const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_RADIUS, TIRE_TUBE_RADIUS, 8, 20), rubberMat);
    tire.rotation.y = Math.PI / 2;
    tire.castShadow = true;
    parent.add(tire);

    // Rin metálico
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_RADIUS - 0.02, 0.01, 6, 20), metalMat);
    rim.rotation.y = Math.PI / 2;
    parent.add(rim);

    // Manzana / Buje central
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 8), metalMat);
    hub.rotation.z = Math.PI / 2;
    parent.add(hub);

    // Rayos (cruzados)
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, (WHEEL_RADIUS - 0.02) * 2, 4), metalMat);
      spoke.rotation.x = (i * Math.PI) / 4;
      parent.add(spoke);
    }
    return tire;
  }

  _groundAt(x, z, referenceY) {
    const y = this.groundHeight?.(x, z, referenceY);
    return Number.isFinite(y) ? y : referenceY;
  }

  _tireLift(tire, referenceY, groundChange) {
    const tread = tire.geometry.attributes.position;
    const point = this._groundProbe;
    const ceiling = referenceY + groundChange;
    let lift = -Infinity;
    for (let i = 0; i < tread.count; i++) {
      point.fromBufferAttribute(tread, i).applyMatrix4(tire.matrixWorld);
      if (point.y > ceiling - lift) continue;
      const ground = this._groundAt(point.x, point.z, referenceY);
      if (Math.abs(ground - referenceY) <= groundChange) lift = Math.max(lift, ground - point.y);
    }
    return Number.isFinite(lift) ? lift : TIRE_TUBE_RADIUS;
  }

  _settleParked(referenceY) {
    this.position.y = this._groundAt(this.position.x, this.position.z, referenceY);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.rotationY;
    this._fitWheelSupport(referenceY, false);
    this.group.updateWorldMatrix(true, true);
  }

  _fitWheelSupport(referenceY, riding) {
    const body = this.bikeBody;
    const pitchLimit = riding ? MAX_RIDE_PITCH : .5;
    const groundChange = riding ? MAX_RIDE_GROUND_CHANGE : Infinity;
    body.position.y = 0;
    body.rotation.x = 0;
    // Encajar los dos neumáticos reales. Cerca de un sardinel importa la huella de la rueda,
    // y al inclinar el cuadro ya no coincide con la cota de su eje.
    let bestPitch = 0, bestLift = 0, smallestGap = Infinity;
    for (let pass = 0; pass < 4; pass++) {
      this.frontTire.updateWorldMatrix(true, false);
      this.rearTire.updateWorldMatrix(true, false);
      const front = this._tireLift(this.frontTire, referenceY, groundChange);
      const rear = this._tireLift(this.rearTire, referenceY, groundChange);
      // En piso plano evita que cada faceta del caucho cambie la altura del sillín al rodar.
      if (riding && pass === 0 && Math.max(Math.abs(front - TIRE_TUBE_RADIUS), Math.abs(rear - TIRE_TUBE_RADIUS)) < .005) {
        body.position.y = TIRE_TUBE_RADIUS;
        return;
      }
      const difference = front - rear;
      if (Math.abs(difference) < smallestGap) {
        smallestGap = Math.abs(difference);
        bestPitch = body.rotation.x;
        bestLift = Math.max(front, rear);
      }
      if (smallestGap < .001) break;
      const nextPitch = THREE.MathUtils.clamp(body.rotation.x - Math.atan2(difference, FRONT_AXLE_Z - REAR_AXLE_Z), -pitchLimit, pitchLimit);
      if (body.rotation.x === nextPitch) break;
      body.rotation.x = nextPitch;
    }
    body.rotation.x = bestPitch;
    body.position.y = bestLift;
  }

  interactDistance(point) {
    return this.position.distanceTo(point);
  }

  // Ajuste visual de tija para el alcance de piernas del ciclista, medido en metros.
  setSaddleDrop(meters = 0) {
    const drop = this.isRidden && Number.isFinite(meters) ? THREE.MathUtils.clamp(meters, 0, SEAT_POST_RISE) : 0;
    if (drop === this._saddleDrop) return drop;

    this._saddleDrop = drop;
    this.saddle.position.y = SEAT_CLUSTER[1] + SADDLE_RISE - drop;
    const rise = SEAT_POST_RISE - drop;
    this._seatPost.position.y = SEAT_CLUSTER[1] + rise / 2;
    this._seatPost.rotation.x = Math.atan2(SEAT_POST_REACH, rise);
    this._seatPost.scale.y = Math.hypot(rise, SEAT_POST_REACH) / SEAT_POST_LENGTH;
    return drop;
  }

  /** Recorrido visual más corto para las piernas cortas del modelo liviano. */
  setCrankRadius(meters = CRANK_RADIUS) {
    const radius = this.isRidden && Number.isFinite(meters) ? THREE.MathUtils.clamp(meters, .06, CRANK_RADIUS) : CRANK_RADIUS;
    if (radius === this._crankRadius) return;
    this._crankRadius = radius;
    for (let i = 0; i < this.pedals.length; i++) {
      const y = (i === 0 ? -1 : 1) * radius;
      this.pedals[i].position.y = y;
      const arm = this._crankArms[i];
      arm.position.y = y / 2;
      arm.scale.y = radius / CRANK_RADIUS;
    }
  }

  /**
   * Forzar candado y robar la bicicleta.
   * Levanta sospecha / fichado policial si hay policías o peatones cerca.
   */
  steal(player, game = null) {
    if (!this.isLocked && !this.stolen) {
      this.stolen = true;
    } else if (this.isLocked) {
      this.isLocked = false;
      this.stolen = true;
      if (this.lockGroup) this.lockGroup.visible = false;

      // Reportar a la policía si hay testigos
      if (game?.steal) {
        game.steal.buscado = Math.min(3, (game.steal.buscado || 0) + 1);
        window.dispatchEvent(new CustomEvent('steal', { detail: { type: 'bicycle' } }));
      }
      game?.audio?.play?.('pickup');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: 'Candado forzado. Me robé la cicla.', type: 'warn' }
        }));
      }
    }
    this.mount(player);
    return true;
  }

  mount(player) {
    if (this.isRidden || !player) return false;
    this.isRidden = true;
    this.rider = player;
    player.ridingBike = this;

    // Levantar pata de apoyo y enderezar
    if (this.kickstand) this.kickstand.rotation.z = Math.PI / 2;
    this.bikeBody.rotation.set(0, 0, 0);
    this.bikeBody.position.y = TIRE_TUBE_RADIUS;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: 'Monté en la bicicleta. Presione E para bajarse.', type: 'info' }
      }));
    }
    return true;
  }

  dismount() {
    if (!this.isRidden) return false;
    const rider = this.rider;
    if (rider) {
      if (rider.position) this.position.copy(rider.position);
      this.rotationY = rider.root?.rotation?.y ?? this.rotationY;
      rider.ridingBike = null;
    }
    this.rider = null;
    this.isRidden = false;
    this.setSaddleDrop();
    this.setCrankRadius();

    // Apoyar pata y ladear
    if (this.kickstand) this.kickstand.rotation.z = 0.45;
    this.bikeBody.rotation.z = -0.12;
    this._settleParked(rider?.groundSurface?.height ?? this.position.y);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: 'Me bajé de la bicicleta.', type: 'info' }
      }));
    }
    return true;
  }

  update(dt, player = null, audio = null) {
    if (this.isRidden && player) {
      // Sigue exactamente la posición y giro del jugador
      this.position.copy(player.position);
      this.group.position.copy(this.position);
      this.group.rotation.y = this.rotationY = player.root?.rotation?.y ?? 0;

      const speed = player.speed ?? 0;
      const moving = speed > 0.1;
      if (moving) {
        // Giro de ruedas proporcional a la distancia recorrida
        const rotDelta = (speed * dt) / ROLLING_RADIUS;
        this.wheelRotation += rotDelta;
        this.frontWheelGroup.rotation.x = this.wheelRotation;
        this.rearWheelGroup.rotation.x = this.wheelRotation;

        // Giro de pedales
        this.pedalRotation += rotDelta / WHEEL_TURNS_PER_PEDAL_TURN;
        this.crankGroup.rotation.x = this.pedalRotation;
        // La biela gira alrededor del plato y la plataforma se mantiene horizontal respecto al cuadro.
        for (const pedal of this.pedals) pedal.rotation.x = -this.pedalRotation;

        // Período audible conservado al pasar a una actualización por cuadro.
        this._chainSoundTimer += dt;
        if (this._chainSoundTimer > CHAIN_SOUND_PERIOD) {
          this._chainSoundTimer = 0;
          audio?.play?.('step');
        }
      }

      // El rumbo del jugador puede cambiar 90° de golpe con WASD. El cuadro y la horquilla
      // conservan un recorrido visual limitado mientras siguen ese rumbo.
      const turnRate = moving ? (player.movement?.turnRate ?? 0) : 0;
      const steer = THREE.MathUtils.clamp(-turnRate * .25, -MAX_STEER_ANGLE, MAX_STEER_ANGLE);
      const lean = THREE.MathUtils.clamp(-turnRate * .12, -MAX_LEAN_ANGLE, MAX_LEAN_ANGLE);
      const blend = Math.min(dt * (moving ? 10 : 8), 1);
      this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, steer, blend);
      this.steerGroup.rotation.y = this.steerAngle;
      this.bikeBody.rotation.z = THREE.MathUtils.lerp(this.bikeBody.rotation.z, lean, blend);

      if (this.groundHeight && player.isGrounded !== false && !player.isSwimming) {
        this._fitWheelSupport(player.groundSurface?.height ?? this.position.y, true);
      } else {
        this.bikeBody.rotation.x = 0;
        this.bikeBody.position.y = TIRE_TUBE_RADIUS;
      }
    } else {
      this.group.position.copy(this.position);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
