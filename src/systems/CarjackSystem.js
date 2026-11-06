// src/systems/CarjackSystem.js
// Robo de carros: forzar uno estacionado o sacar al conductor de uno detenido,
// manejarlo por la ciudad y bajarse para dejarlo estacionado.
import * as THREE from 'three';

export const CARJACK = {
  key: 'KeyY',
  reach: 1.3,            // metros desde la carrocería para alcanzar la puerta
  maxTrafficSpeed: 2.5,  // solo se saca al conductor de un carro casi detenido
  exitSpeed: 2,          // velocidad máxima para bajarse
  maxSpeed: 15,          // ≈ 54 km/h
  reverseSpeed: 5,
  acceleration: 6.5,
  braking: 13,
  handbrake: 18,
  drag: 1.4,
  steerRate: 1.9,        // rad/s a plena dirección
  alarmChance: 0.55,
  caughtDamage: 10,
  pedestrianHitSpeed: 3,
  cameraDistance: 8.5,
  cooldown: 1.2,
  xp: 25,
  maxWade: .3            // m de agua bajo el frente del carro: más hondo no se mete (lago)
};

/** Tiempos (s) de subir y bajar: caminar hasta la puerta, abrirla o sacar al conductor, meterse; y al revés. */
export const BOARDING = {
  walkSpeed: 2.2,      // m/s hasta la puerta
  maxWalk: .7,         // s como máximo; si queda lejos se acorta el paso
  force: .45,          // forzar la puerta de un estacionado
  pull: .6,            // sacar a la fuerza al conductor
  slip: .3,            // agacharse y entrar al asiento
  cameraReturn: .9,    // s en que la cámara vuelve a su distancia a pie al bajarse
  stepOut: .45,        // bajarse y alejarse un paso
  duck: .22            // m que baja el cuerpo al meterse
};

const smooth = t => t * t * (3 - 2 * t);

const box = new THREE.Box3();

/** Distancia horizontal desde un punto hasta la carrocería orientada de un carro. */
export function distanceToCarBody(point, car) {
  const h = car.group.rotation.y, fx = Math.cos(h), fz = -Math.sin(h);
  const dx = point.x - car.position.x, dz = point.z - car.position.z;
  const along = dx * fx + dz * fz, side = -dx * fz + dz * fx;
  const ox = Math.max(0, Math.abs(along) - car.length / 2);
  const oz = Math.max(0, Math.abs(side) - car.width / 2);
  return Math.hypot(ox, oz);
}

/** Medias extensiones de la caja alineada a los ejes que ocupa un carro con rumbo `h`. */
function carExtent(car, h) {
  const c = Math.abs(Math.cos(h)), s = Math.abs(Math.sin(h));
  return { x: (c * car.length + s * car.width) / 2, z: (s * car.length + c * car.width) / 2 };
}

export class CarjackSystem {
  constructor(game) {
    this.game = game;
    this.car = null;       // carro que maneja el jugador
    this.stolen = null;    // último carro robado: se guarda en la partida
    this.speed = 0;        // m/s a lo largo del frente (+X local); negativo en reversa
    this.cooldown = 0;
    this.prompt = null;
    this.target = null;
    this._savedCameraDistance = null;
    this._cameraReturn = null; // { from, to, t }: la cámara se acerca de a poco al bajarse
    this._audioEntry = { car: null, speed: 0, personBlocked: false };
    this._dom = null;
    this.transition = null; // subir o bajar en curso: { kind, phase, t, ... }
    // Carros que ya robó: volver a subirse a uno no es otro robo (sin alarma, fichado, testigos ni experiencia).
    this._owned = new WeakSet();
    this._waterToast = 0;
    this._buildUI();
  }

  get driving() { return !!this.car; }

  /** Entrada para el audio de motores: el carro robado sigue sonando al manejarlo. */
  get audioEntry() {
    if (!this.car) return null;
    this._audioEntry.car = this.car;
    this._audioEntry.speed = Math.abs(this.speed);
    return this._audioEntry;
  }

  _buildUI() {
    if (typeof document === 'undefined' || !document.createElement) return;
    const hud = document.createElement('div');
    hud.id = 'carjack-hud';
    hud.className = 'carton corte-d';
    hud.hidden = true;
    hud.innerHTML = '<b id="carjack-speed">0 km/h</b><p><kbd>W</kbd><kbd>S</kbd> acelerar <kbd>A</kbd><kbd>D</kbd> girar <kbd>Espacio</kbd> frenar <kbd>Y</kbd> bajarme</p>';
    document.body?.appendChild(hud);
    this._dom = { hud, speed: hud.querySelector('#carjack-speed') };
  }

  /** Carros que se pueden robar: estacionados o en circulación casi detenidos. */
  _candidates() {
    const list = [];
    // Las motos no tienen puerta ni carrocería propia (las dibuja el lote del tráfico): no se roban con Y.
    for (const car of this.game.cars ?? []) if (!car.isMoto) list.push({ car, vehicle: null });
    for (const vehicle of this.game.traffic?.vehicles ?? []) {
      // Las patrullas no se dejan quitar el carro.
      // Con el conductor afuera por una pelea (RoadRageSystem) el carro es de él: no se cruza con esa escena.
      if (!vehicle.police && !vehicle.hold && !vehicle.car?.isMoto && vehicle.speed <= CARJACK.maxTrafficSpeed) list.push({ car: vehicle.car, vehicle });
    }
    return list;
  }

  /** ¿Es un carro que ya robó (el de la partida o uno de esta sesión) y está estacionado? */
  _isOwn(car, vehicle = null) {
    return !vehicle && !!car && (car === this.stolen || this._owned.has(car));
  }

  _findTarget() {
    const player = this.game.player;
    if (!player?.position || player.isStunned || player.hasCart || player.isRagdollActive) return null;
    let best = null, bestDistance = CARJACK.reach;
    for (const candidate of this._candidates()) {
      if (Math.abs(candidate.car.position.y - player.position.y) > 1.5) continue;
      const d = distanceToCarBody(player.position, candidate.car);
      if (d < bestDistance) { bestDistance = d; best = candidate; }
    }
    return best;
  }

  /**
   * Avanza el sistema. Devuelve true mientras el jugador maneja, para que el
   * juego omita el movimiento a pie y las interacciones de ese cuadro.
   */
  update(dt, input) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.prompt = null;
    this._easeCamera(dt);
    if (this.transition) {
      // Mientras sube o baja nada lo interrumpe: ni el movimiento a pie ni el volante.
      this._animateTransition(dt);
      return true;
    }
    if (this.car) {
      // Cada pulsación se consume una sola vez: no hace falta enfriamiento para bajarse.
      if (input.consumePress(CARJACK.key)) {
        if (Math.abs(this.speed) <= CARJACK.exitSpeed) { this.exit(); return false; }
        this._toast('Tengo que frenar antes de bajarme.', 'warn');
      }
      this._drive(dt, input);
      return true;
    }
    this.target = this.cooldown > 0 ? null : this._findTarget();
    if (!this.target) return false;
    this.prompt = this.target.vehicle ? '[Y] Sacar al conductor y robarme el carro'
      : this._isOwn(this.target.car) ? '[Y] Subirme a mi carro' : '[Y] Forzar la puerta y robarme el carro';
    if (input.consumePress(CARJACK.key)) this.enter(this.target);
    return !!this.car;
  }

  enter({ car, vehicle }) {
    const game = this.game;
    const own = this._isOwn(car, vehicle);
    // La cinemática del espejo devuelve antes su cámara: si no, la distancia a pie que se guarda es la del primer plano.
    if (game.mirrorCinematic?.active) game.mirrorCinematic.stop();
    if (own) {
      // Ya es suyo: abre y se sube, sin forzar nada.
      this.speed = 0;
    } else if (vehicle) {
      // El conductor sale corriendo y reclama; el carro deja de seguir su ruta.
      game.audio?.playMovingTheft?.(car);
      game.traffic?.release?.(vehicle);
      // El conductor sigue sentado hasta que el jugador lo saca por la puerta (ver _animateTransition).
      if (!game.cars.includes(car)) game.cars.push(car);
      this.speed = 0;
      this._toast('¡Saqué al conductor! El carro es mío.', 'warn');
    } else {
      this.speed = 0;
      if (Math.random() < CARJACK.alarmChance) {
        game.audio?.playCarAlarm?.(car);
        this._toast('Forcé la puerta y saltó la alarma.', 'death');
      } else {
        this._toast('Forcé la puerta sin hacer ruido.', 'rare');
      }
    }
    if (!own) {
      this._raiseWanted();
      game.witnesses?.report?.('carro');
      game.stats?.addXP?.(CARJACK.xp, game.talents);
    }
    this.car = car;
    this.stolen = car;
    this._owned.add(car);
    // La Policía lo ve y lo captura a través del carro que maneja (ver TrafficSystem._ignoredBy).
    if (game.traffic) game.traffic.playerVehicle = car;
    car.driven = true;
    car.traffic = true; // luces encendidas mientras se maneja
    if (car.marker) car.marker.visible = false;
    car.setNight?.(game.clock?.isNight ?? false, game.weather?.isRaining ?? false);
    game.traffic?.setParkedCars?.(game.cars);
    game.player?.velocity?.set?.(0, 0, 0);
    this._startBoarding(car, !!vehicle);
    const rig = game.cameraRig;
    if (rig) {
      // Si se vuelve a subir mientras la cámara aún regresaba, la distancia a pie es la de destino.
      this._savedCameraDistance ??= this._cameraReturn?.to ?? rig.distance;
      this._cameraReturn = null;
      rig.distance = CARJACK.cameraDistance;
      // Sin subir animado (pruebas, sin cuerpo) la cámara salta detrás; si no, gira mientras se sube.
      if (rig.mode === 'third-person' && !this.transition) rig.yaw = car.group.rotation.y - Math.PI / 2;
    }
    this.cooldown = CARJACK.cooldown;
    if (!this.transition) this._finishBoarding();
    // Volver a su carro no cuenta como robo: ni fama, ni objetivo, ni encargo.
    if (own) this._emit('carjack-reenter', { car });
    else this._emit('carjack', { car, fromTraffic: !!vehicle });
  }

  exit() {
    const game = this.game, car = this.car;
    if (!car) return;
    const h = car.group.rotation.y;
    const fx = Math.cos(h), fz = -Math.sin(h);
    const lx = -Math.sin(h), lz = -Math.cos(h); // izquierda del conductor
    const sideOffset = car.width / 2 + 0.7, endOffset = car.length / 2 + 0.7;
    const options = [[lx * sideOffset, lz * sideOffset], [-lx * sideOffset, -lz * sideOffset],
      [fx * endOffset, fz * endOffset], [-fx * endOffset, -fz * endOffset]];
    let spot = options[0];
    for (const option of options) {
      if (!this._pointBlocked(car.position.x + option[0], car.position.z + option[1], car.position.y)) { spot = option; break; }
    }
    const player = game.player;
    player.position.set(car.position.x + spot[0], car.position.y, car.position.z + spot[1]);
    const ground = this._ground(player.position.x, player.position.z, car.position.y);
    if (Number.isFinite(ground)) player.position.y = ground;
    player.velocity?.set?.(0, 0, 0);
    // Sale desde la puerta, agachado, y da un paso hasta el sitio libre.
    const length = Math.hypot(spot[0], spot[1]) || 1, inward = Math.min(.45, length * .5);
    const from = player.position.clone();
    from.x -= spot[0] / length * inward; from.z -= spot[1] / length * inward;
    const to = player.position.clone();
    this.transition = { kind: 'exit', phase: 'stepOut', t: 0, from, to, car,
      yaw: Math.atan2(spot[0], spot[1]) };
    if (player.root) {
      player.root.position.copy(from);
      player.root.position.y -= BOARDING.duck;
      player.root.rotation.y = this.transition.yaw;
      player.root.visible = true;
    }
    player.position.copy(from);
    car.settle?.(.8);
    car.driven = false;
    car.setPlayerDriver?.(false);
    car.traffic = false; // queda estacionado: se le pueden robar los espejos
    car.setNight?.(game.clock?.isNight ?? false, game.weather?.isRaining ?? false);
    if (car.marker) car.marker.visible = !car.used;
    game.traffic?.setParkedCars?.(game.cars);
    // La cámara no salta hacia el jugador: vuelve a su distancia mientras se baja.
    if (game.cameraRig && this._savedCameraDistance != null) {
      this._cameraReturn = { from: game.cameraRig.distance, to: this._savedCameraDistance, t: 0 };
    }
    this._savedCameraDistance = null;
    this.car = null;
    if (game.traffic?.playerVehicle === car) game.traffic.playerVehicle = null;
    this.speed = 0;
    this.cooldown = CARJACK.cooldown;
    if (this._dom) this._dom.hud.hidden = true;
    this._emit('carjack-exit', { car });
  }

  /** Lo que se guarda: el último carro robado, para encontrarlo donde quedó. */
  serialize() {
    const car = this.stolen;
    if (!car || car._disposed || car.isMoto || !(this.game.cars ?? []).includes(car)) return null;
    return { pos: car.position.toArray().map(n => Math.round(n * 100) / 100), rot: Math.round(car.group.rotation.y * 1000) / 1000,
      kind: car.kind, variant: car.variant };
  }

  /** Rehace el carro robado de una partida guardada, estacionado donde quedó. */
  restore(data, { CarClass, migrate } = {}) {
    const game = this.game;
    if (!data || !Array.isArray(data.pos) || data.pos.length !== 3 || !data.pos.every(Number.isFinite) || !Number.isFinite(data.rot)) return null;
    // Una moto robada (partidas de antes del arreglo) no se rehace: saldría como un sedán.
    if (data.kind === 'police' || data.kind === 'moto') return null;
    if (this.car) this.reset();
    const position = migrate?.(data.pos) ?? data.pos;
    // El de esta sesión se reusa solo si es el mismo carro: otro tipo o color se rehace (el viejo queda como uno más).
    const mismo = (c) => c.kind === (typeof data.kind === 'string' ? data.kind : c.kind) && (data.variant == null || c.variant === data.variant);
    let car = this.stolen && (game.cars ?? []).includes(this.stolen) && mismo(this.stolen) ? this.stolen : null;
    if (!car) {
      if (!CarClass || !game.sceneMgr?.scene) return null;
      car = new CarClass(game.sceneMgr.scene, new THREE.Vector3(...position), data.rot,
        { kind: typeof data.kind === 'string' ? data.kind : null, variant: data.variant });
      game.cars.push(car);
      game.interaction?.register?.(car);
      // Al cargar en medio del juego el carro necesita modelo y descarte propios.
      car.preloadModel?.();
      game.renderer?.culling?.register?.(car.group, { dynamic: true, margin: .5 });
    }
    car.position.set(...position);
    car.group.rotation.y = data.rot;
    car.traffic = false;
    car.setDriverInside?.(false);
    game.traffic?.setParkedCars?.(game.cars);
    this.stolen = car;
    this._owned.add(car);
    return car;
  }

  /**
   * El último carro robado deja de ser suyo aunque no lo esté manejando: al cargar la partida guardada en la plana del
   * arresto al volante, `restore` ya lo dejó estacionado y `reset({ perdido })` no lo alcanza (no hay `this.car`).
   */
  perderRobado() {
    const car = this.stolen;
    if (!car) return;
    this._owned.delete(car);
    this.stolen = null;
  }

  /** Al cambiar de partida ningún carro de la anterior sigue siendo suyo; `restore` vuelve a marcar el de la nueva. */
  olvidarRobados() {
    this._owned = new WeakSet();
  }

  /**
   * Sale del carro sin colocar al jugador (recuperación o cambio de distrito). Con `perdido` (lo cogió la Policía
   * manejándolo) el carro deja de ser suyo: volver a subirse es otro robo y la partida ya no lo guarda.
   */
  reset({ perdido = false } = {}) {
    const car = this.car;
    if (car && perdido) {
      this._owned.delete(car);
      if (this.stolen === car) this.stolen = null;
    }
    if (car) {
      car.driven = false;
      car.traffic = false;
      car.setPlayerDriver?.(false);
    }
    if (this.transition?.driverPending) this.transition.car.setDriverInside?.(false);
    this.transition = null;
    if (this.game.player?.root) this.game.player.root.visible = true;
    const restore = this._savedCameraDistance ?? this._cameraReturn?.to;
    if (this.game.cameraRig && restore != null) this.game.cameraRig.distance = restore;
    this._savedCameraDistance = null;
    this._cameraReturn = null;
    if (car && this.game.traffic?.playerVehicle === car) this.game.traffic.playerVehicle = null;
    this.car = null;
    this.speed = 0;
    this.prompt = null;
    this.target = null;
    if (this._dom) this._dom.hud.hidden = true;
  }

  /** Punto junto a la puerta del conductor; si el modelo no lo da, el costado izquierdo. */
  _doorPoint(car) {
    if (typeof car.driverDoor === 'function') return car.driverDoor(new THREE.Vector3());
    const h = car.group.rotation.y, side = car.width / 2 + .55;
    return new THREE.Vector3(car.position.x - Math.sin(h) * side, car.position.y, car.position.z - Math.cos(h) * side);
  }

  _startBoarding(car, fromTraffic) {
    const player = this.game.player;
    if (!player?.position || !player.root) return;
    const door = this._doorPoint(car);
    const ground = this._ground(door.x, door.z, car.position.y);
    if (Number.isFinite(ground)) door.y = ground;
    const distance = Math.hypot(door.x - player.position.x, door.z - player.position.z);
    const walk = Math.min(BOARDING.maxWalk, distance / BOARDING.walkSpeed);
    this.transition = { kind: 'enter', phase: 'walk', t: 0, car, from: player.position.clone(), door,
      walk, speed: walk > 0 ? distance / walk : 0,
      grab: fromTraffic ? BOARDING.pull : BOARDING.force, driverPending: fromTraffic };
  }

  /** Se acomoda en el asiento: el cuerpo se oculta y el carro se hunde un poco en los muelles. */
  _finishBoarding() {
    const player = this.game.player;
    if (player?.root) {
      player.root.visible = false;
      player.root.position.y = this.car?.position.y ?? player.root.position.y;
    }
    this.car?.settle?.(1);
    this.car?.setPlayerDriver?.(true);
    this.transition = null;
    this._syncPlayer();
    if (this._dom) this._dom.hud.hidden = false;
  }

  _animateTransition(dt) {
    const tr = this.transition, player = this.game.player;
    tr.t += dt;
    const car = tr.car, faceCar = Math.atan2(car.position.x - player.position.x, car.position.z - player.position.z);
    if (tr.kind === 'enter') {
      const rig = this.game.cameraRig;
      if (rig?.mode === 'third-person' && !rig._drag) {
        const target = car.group.rotation.y - Math.PI / 2;
        rig.yaw += Math.atan2(Math.sin(target - rig.yaw), Math.cos(target - rig.yaw)) * (1 - Math.exp(-4 * dt));
      }
      if (tr.phase === 'walk') {
        const k = tr.walk > 0 ? Math.min(1, tr.t / tr.walk) : 1;
        player.position.lerpVectors(tr.from, tr.door, k);
        const dx = tr.door.x - tr.from.x, dz = tr.door.z - tr.from.z;
        const yaw = Math.hypot(dx, dz) > .05 && k < .8 ? Math.atan2(dx, dz) : faceCar;
        player.animateScripted?.(dt, { speed: k < 1 ? tr.speed : 0, yaw });
        if (k >= 1) { tr.phase = 'grab'; tr.t = 0; }
      } else if (tr.phase === 'grab') {
        const k = Math.min(1, tr.t / tr.grab);
        player.animateScripted?.(dt, { action: 'agarrar', actionProgress: k, yaw: faceCar });
        // A media sacudida el conductor queda fuera del asiento.
        if (tr.driverPending && k >= .55) {
          car.setDriverInside?.(false);
          tr.driverPending = false;
          // Sale por delante de la puerta, para no aparecer encima del jugador, y huye.
          const h = car.group.rotation.y;
          const out = tr.door.clone();
          out.x += Math.cos(h) * .8; out.z -= Math.sin(h) * .8;
          this.game.roadRage?.ejectDriver?.(car, out);
        }
        if (k >= 1) { tr.phase = 'slip'; tr.t = 0; car.settle?.(.5); }
      } else {
        const k = Math.min(1, tr.t / BOARDING.slip), e = smooth(k);
        // Se agacha y se mete hacia el asiento por la puerta.
        player.position.set(
          tr.door.x + (car.position.x - tr.door.x) * .3 * e,
          tr.door.y,
          tr.door.z + (car.position.z - tr.door.z) * .3 * e);
        player.animateScripted?.(dt, { action: 'buscar', actionProgress: e * .5, yaw: faceCar + Math.PI / 2 * e });
        if (player.root) player.root.position.copy(player.position).setY(tr.door.y - BOARDING.duck * e);
        if (k >= 1) { this._finishBoarding(); return; }
      }
      if (player.root) player.root.position.copy(player.position);
      return;
    }
    // Bajarse: se endereza y da un paso para separarse de la puerta.
    const k = Math.min(1, tr.t / BOARDING.stepOut), e = smooth(k);
    player.position.lerpVectors(tr.from, tr.to, e);
    player.animateScripted?.(dt, { speed: k < 1 ? BOARDING.walkSpeed * .7 : 0, yaw: tr.yaw });
    if (player.root) player.root.position.copy(player.position).setY(player.position.y - BOARDING.duck * (1 - e));
    if (k >= 1) {
      player.position.copy(tr.to);
      if (player.root) player.root.position.copy(tr.to);
      this.transition = null;
    }
  }

  _easeCamera(dt) {
    const back = this._cameraReturn, rig = this.game.cameraRig;
    if (!back || !rig) return;
    // Si otro movió la distancia (la rueda del ratón, la cinemática del espejo), la cámara ya es suya.
    if (back.last !== undefined && Math.abs(rig.distance - back.last) > 1e-6) { this._cameraReturn = null; return; }
    back.t = Math.min(1, back.t + dt / BOARDING.cameraReturn);
    const e = back.t * back.t * (3 - 2 * back.t);
    rig.distance = back.from + (back.to - back.from) * e;
    back.last = rig.distance;
    if (back.t >= 1) this._cameraReturn = null;
  }

  /**
   * Corta el regreso de la cámara al bajarse y da la distancia a pie a la que iba (o null si no regresaba). La usa
   * quien toma la cámara en ese momento, para restaurar después la distancia a pie y no una a medio camino.
   */
  takeCameraReturn() {
    const to = this._cameraReturn?.to ?? null;
    this._cameraReturn = null;
    return to;
  }

  _ground(x, z, y) {
    const district = this.game.world?.active;
    return district?.getMovementGroundHeight?.(x, z, y) ?? district?.getGroundHeight?.(x, z);
  }

  _pointBlocked(x, z, y) {
    const collisions = this.game.collisions;
    const hits = b => !!b && x + .4 > b.min.x && x - .4 < b.max.x && z + .4 > b.min.z && z - .4 < b.max.z &&
      b.max.y > y + .2 && b.min.y < y + 1.6;
    const candidates = collisions?.queryStatic?.(x - .4, z - .4, x + .4, z + .4, []) ?? [];
    if (candidates.some(({ box }) => hits(box))) return true;
    // Los carros parqueados, el tráfico y el bus son cajas dinámicas: no se baja dentro de otro vehículo.
    for (const entry of collisions?.dynamicColliders ?? []) {
      if (entry.vehicle === this.car || entry.vehicle?.car === this.car) continue;
      if (hits(entry.box)) return true;
    }
    // Ni al agua honda del lago, si hay otra puerta en seco.
    return this._waterDepth(x, z, y) > CARJACK.maxWade;
  }

  /** Metros de agua sobre el suelo en (x, z); 0 en seco o sobre el tablero de un puente. */
  _waterDepth(x, z, y, ground = this._ground(x, z, y)) {
    const water = this.game.world?.active?.getWaterInfo?.(x, z);
    if (!water || !Number.isFinite(water.surfaceY)) return 0;
    const floor = Number.isFinite(ground) ? ground : y;
    return Math.max(0, water.surfaceY - floor);
  }

  /** ¿El paso lleva el frente del carro a más agua de la que aguanta, y más honda que donde ya está? */
  _intoWater(nx, nz, ny, h) {
    const car = this.car, reach = car.length / 2 * (Math.sign(this.speed) || 1);
    const fx = Math.cos(h) * reach, fz = -Math.sin(h) * reach;
    const ahead = this._waterDepth(nx + fx, nz + fz, ny);
    if (ahead <= CARJACK.maxWade) return false;
    const now = this._waterDepth(car.position.x + fx, car.position.z + fz, car.position.y);
    return ahead >= now;
  }

  /** ¿La carrocería en (x, z) con rumbo h choca con algo sólido? */
  _bodyBlocked(x, z, y, h) {
    const car = this.car, collisions = this.game.collisions;
    if (!collisions) return false;
    const e = carExtent(car, h);
    box.min.set(x - e.x, y + .3, z - e.z);
    box.max.set(x + e.x, y + 1.5, z + e.z);
    const hits = ({ box: b }) => b.max.x > box.min.x && b.min.x < box.max.x && b.max.z > box.min.z && b.min.z < box.max.z &&
      b.max.y > box.min.y && b.min.y < box.max.y;
    const statics = collisions.queryStatic?.(box.min.x, box.min.z, box.max.x, box.max.z, []) ?? [];
    if (statics.some(hits)) return true;
    return (collisions.dynamicColliders ?? []).some(entry => entry.vehicle !== car && hits(entry));
  }

  _drive(dt, input) {
    const car = this.car;
    // WASD, flechas, stick del mando o palanca táctil: el eje ya reúne teclado y mando.
    const axis = input.axis ?? { x: 0, z: 0 };
    const arrows = { x: (input.isDown('ArrowRight') ? 1 : 0) - (input.isDown('ArrowLeft') ? 1 : 0),
      z: (input.isDown('ArrowDown') ? 1 : 0) - (input.isDown('ArrowUp') ? 1 : 0) };
    const throttle = THREE.MathUtils.clamp(-(axis.z || arrows.z), -1, 1);
    const steer = THREE.MathUtils.clamp(-(axis.x || arrows.x), -1, 1);
    const handbrake = input.isDown('Space');

    // Aceleración, freno al invertir el sentido, roce y freno de mano.
    if (throttle > 0) this.speed += (this.speed < 0 ? CARJACK.braking : CARJACK.acceleration) * dt;
    else if (throttle < 0) this.speed -= (this.speed > 0 ? CARJACK.braking : CARJACK.acceleration * .7) * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), CARJACK.drag * dt);
    if (handbrake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), CARJACK.handbrake * dt);
    this.speed = THREE.MathUtils.clamp(this.speed, -CARJACK.reverseSpeed, CARJACK.maxSpeed);

    // La dirección solo gira el carro si avanza; en reversa se invierte.
    const grip = THREE.MathUtils.clamp(Math.abs(this.speed) / 4, 0, 1);
    const yawRate = steer * CARJACK.steerRate * grip * Math.sign(this.speed);
    const h = car.group.rotation.y + yawRate * dt;
    const step = this.speed * dt;
    const nx = car.position.x + Math.cos(h) * step;
    const nz = car.position.z - Math.sin(h) * step;
    const ground = this._ground(nx, nz, car.position.y);
    const ny = Number.isFinite(ground) ? ground : car.position.y;

    this._waterToast = Math.max(0, this._waterToast - dt);
    if (Math.abs(this.speed) > .01 && this._intoWater(nx, nz, ny, h)) {
      // La orilla del lago: el carro no se mete al agua, se queda en el borde.
      if (this._waterToast <= 0) { this._toast('No me puedo meter al lago con el carro.', 'warn'); this._waterToast = 4; }
      this.speed = 0;
    } else if (Math.abs(ny - car.position.y) > 1.2 || this._bodyBlocked(nx, nz, ny, h)) {
      // Choque: rebota un poco y pierde casi toda la velocidad.
      if (Math.abs(this.speed) > 6) this._toast('¡Me estrellé!', 'warn');
      if (Math.abs(this.speed) > 6) this.game.stats && (this.game.stats.salud = Math.max(1, this.game.stats.salud - Math.round(Math.abs(this.speed) * .4)));
      this.speed *= -0.2;
    } else {
      car.group.rotation.y = h;
      car.position.set(nx, ny, nz);
      car.animateDrive?.(step, (throttle < 0 && this.speed > 0) || handbrake, { dt, speed: this.speed, steering: steer * .34 });
    }
    this._hitPedestrians();
    this._syncPlayer();
    if (this._dom) this._dom.speed.textContent = `${Math.round(Math.abs(this.speed) * 3.6)} km/h`;

    const rig = this.game.cameraRig;
    if (rig?.mode === 'third-person' && !rig._drag) {
      // La cámara vuelve suavemente detrás del carro cuando no se arrastra.
      const target = car.group.rotation.y - Math.PI / 2;
      const diff = Math.atan2(Math.sin(target - rig.yaw), Math.cos(target - rig.yaw));
      rig.yaw += diff * (1 - Math.exp(-3 * dt));
    }
  }

  _hitPedestrians() {
    if (Math.abs(this.speed) < CARJACK.pedestrianHitSpeed) return;
    for (const npc of this.game.world?.active?.npcs ?? []) {
      // Al que ya está en el suelo (o levantándose) el carro le pasa por encima sin otro golpe: no cuenta otra vez.
      if (!npc?.position || npc.koState || (npc._carjackHit ?? 0) > performance.now()) continue;
      if (distanceToCarBody(npc.position, this.car) > .35) continue;
      npc._carjackHit = performance.now() + 3000;
      const h = this.car.group.rotation.y, sign = Math.sign(this.speed) || 1;
      const hit = npc.hitByCar ? npc.hitByCar(this.car.position, Math.abs(this.speed), { x: Math.cos(h) * sign, z: -Math.sin(h) * sign })
        : npc.hitByPoop?.(this.car.position, { voz: false });
      // Solo un `false` explícito dice que no hubo golpe; `undefined` (otros peatones) cuenta como antes.
      if (hit === false) continue;
      this._raiseWanted();
      this.speed *= .6;
      this._toast('¡Casi atropello a alguien!', 'death');
    }
  }

  /** Robar o casi atropellar sube «te tienen fichado» y una patrulla que lo vea persigue. */
  _raiseWanted() {
    const steal = this.game.steal;
    if (!steal) return;
    steal.buscado = Math.min(3, (steal.buscado ?? 0) + 1);
    steal._calma = 0;
    if (steal._alertPolice) steal._alertPolice();
    else if (this.game.traffic) this.game.traffic.wantedLevel = steal.buscado;
  }

  /** El jugador va dentro del carro: su posición sigue a la carrocería. */
  _syncPlayer() {
    const player = this.game.player, car = this.car;
    if (!player || !car) return;
    player.position.copy(car.position);
    player.speed = Math.abs(this.speed);
    if (player.root) {
      player.root.position.copy(car.position);
      player.root.rotation.y = car.group.rotation.y + Math.PI / 2;
    }
  }

  _toast(text, type = 'info') {
    this._emit('toast', { text, type });
  }

  _emit(name, detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
