// src/systems/CarjackSystem.js
// Robo de carros: forzar la puerta de uno estacionado, manejarlo por la ciudad y bajarse para dejarlo estacionado.
import * as THREE from 'three';
import { modoEntrada } from '../core/modoEntrada.js';
import { CURB_HEIGHT } from '../world/bogota/parkedCars.js';
import { proyectarHazJugador } from '../world/bogota/carBeam.js';
import { apoyarCarroAlBajar, apoyarModelo, huellaRuedas, poseDeApoyo } from './apoyoCarro.js';

export const CARJACK = {
  key: 'KeyY',
  reach: 1.3,            // metros desde la carrocería para alcanzar la puerta
  exitSpeed: 2,          // velocidad máxima para bajarse
  maxSpeed: 15,          // ≈ 54 km/h
  reverseSpeed: 5,
  acceleration: 6.5,
  braking: 13,
  handbrake: 18,
  drag: 1.4,
  steerRate: 1.9,        // rad/s a plena dirección
  alarmChance: 0.55,
  cameraDistance: 8.5,
  cooldown: 1.2,
  xp: 25,
  maxWade: .3,           // m de agua bajo el frente del carro: más hondo no se mete (lago)
  homeAway: .05,         // m desde su puesto: más corrido, el carro dejado vuelve a él cuando nadie lo ve
  homeTurn: .035,        // rad (2°) de giro respecto a su puesto: más girado, también vuelve
  homeCheck: 1           // s entre una mirada y otra a los carros dejados lejos de su puesto
};

/** Tiempos (s) de subir y bajar: caminar hasta la puerta, forzarla, meterse; y al revés. */
export const BOARDING = {
  walkSpeed: 2.2,      // m/s hasta la puerta
  maxWalk: .7,         // s como máximo; si queda lejos se acorta el paso
  force: .45,          // forzar la puerta de un estacionado
  slip: .3,            // agacharse y entrar al asiento
  cameraReturn: .9,    // s en que la cámara vuelve a su distancia a pie al bajarse
  stepOut: .45,        // bajarse y alejarse un paso
  duck: .22            // m que baja el cuerpo al meterse
};

const smooth = t => t * t * (3 - 2 * t);

/** ¿Está mirando alrededor con las flechas? Mientras tanto la cámara no se devuelve detrás del carro. */
const lookingAround = input => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].some(code => input.isDown?.(code));

const box = new THREE.Box3();
const NO_INPUT = { axis: { x: 0, z: 0 }, isDown: () => false, consumePress: () => false };
const homeBox = new THREE.Box3();

const cargarChasis = () => import('./CarroFisico.js').then(modulo => modulo.prepararCarroFisico());

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
  constructor(game, { fisica = false, cargarFisica = cargarChasis } = {}) {
    this.game = game;
    this.fisica = fisica;
    this._cargarFisica = cargarFisica;
    this.fisicaLista = null;
    this.chasis = null;
    this.car = null;       // carro que maneja el jugador
    this.stolen = null;    // último carro robado
    this.speed = 0;        // m/s a lo largo del frente (+X local); negativo en reversa
    this.cooldown = 0;
    this.prompt = null;
    this.target = null;
    this._savedCameraDistance = null;
    this._cameraReturn = null; // { from, to, t }: la cámara se acerca de a poco al bajarse
    this._audioEntry = { car: null, speed: 0, personBlocked: false };
    this._dom = null;
    this.transition = null; // subir o bajar en curso: { kind, phase, t, ... }
    // Carros que ya robó: volver a subirse a uno no es otro robo (sin alarma, fichado ni experiencia).
    this._owned = new WeakSet();
    this._waterToast = 0;
    // Carros que dejó lejos de su puesto: vuelven a él cuando el jugador se aleja y no los ve.
    this._away = [];
    this._homeTimer = 0;
    this._sueloCarro = (x, z, y) => this._ground(x, z, y);
    this._poseApoyo = { rotacion: new THREE.Quaternion() };
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
    hud.innerHTML = '<b id="carjack-speed">0 km/h</b><p><kbd data-k="W" data-k-mando="Stick ↑">W</kbd><kbd data-k="S" data-k-mando="Stick ↓">S</kbd> acelerar <kbd data-k="A" data-k-mando="Stick ←">A</kbd><kbd data-k="D" data-k-mando="Stick →">D</kbd> girar <kbd data-k="Espacio">Espacio</kbd> frenar <kbd data-k="Y">Y</kbd> bajarme</p>';
    document.body?.appendChild(hud);
    this._dom = { hud, speed: hud.querySelector('#carjack-speed') };
  }

  /** ¿Es un carro que ya robó en esta sesión? */
  _isOwn(car) {
    return !!car && (car === this.stolen || this._owned.has(car));
  }

  _findTarget() {
    const player = this.game.player;
    if (!player?.position || player.isStunned || player.hasCart || player.isRagdollActive) return null;
    let best = null, bestDistance = CARJACK.reach;
    // Solo los estacionados.
    for (const car of this.game.cars ?? []) {
      if (Math.abs(car.position.y - player.position.y) > 1.5) continue;
      const d = distanceToCarBody(player.position, car);
      if (d < bestDistance) { bestDistance = d; best = { car }; }
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
    this._returnAbandoned(dt);
    const player = this.game.player;
    // Un golpe al bajarse corta el paso: el cuerpo ya es del golpe.
    if (this.transition?.kind === 'exit' && player?.isStunned) { this.transition = null; return false; }
    if (this.transition) {
      // Mientras sube o baja nada lo interrumpe: ni el movimiento a pie ni el volante.
      this._animateTransition(dt);
      return true;
    }
    if (this.car) {
      // Aturdido por un golpe (la camioneta, el conductor bravo): el carro sigue rodando, sin manos en el volante.
      if (player?.isStunned) { player.tickWheelStun?.(dt); this._drive(dt, NO_INPUT); return true; }
      // Cada pulsación se consume una sola vez: no hace falta enfriamiento para bajarse.
      if (input.consumePress(CARJACK.key)) {
        if (Math.abs(this.speed) > CARJACK.exitSpeed) this._toast('Tengo que frenar antes de bajarme.', 'warn');
        else if (this.exit()) return false;
        else this._toast('No hay por dónde bajarme.', 'warn');
      }
      this._drive(dt, input);
      return true;
    }
    // En pantalla táctil no hay botón para bajarse, así que tampoco se ofrece subirse; con la barra del cosquilleo
    // abierta la Y no le quita el turno.
    const blocked = this.cooldown > 0 || modoEntrada() === 'tactil' || this.game.steal?.minigameActive;
    this.target = blocked ? null : this._findTarget();
    if (!this.target) return false;
    this.prompt = this._isOwn(this.target.car) ? '[Y] Subirme a mi carro' : '[Y] Forzar la puerta y robarme el carro';
    if (input.consumePress(CARJACK.key)) this.enter(this.target);
    return !!this.car;
  }

  enter({ car }) {
    if (this.fisica && this.car) return;
    const game = this.game;
    // Ya es suyo: abre y se sube, sin forzar nada ni volver a contar el robo.
    const own = this._isOwn(car);
    this.speed = 0;
    if (!own) {
      if (Math.random() < CARJACK.alarmChance) {
        game.audio?.playCarAlarm?.(car);
        this._toast('Forcé la puerta y saltó la alarma.', 'death');
      } else {
        this._toast('Forcé la puerta sin hacer ruido.', 'rare');
      }
      this._raiseWanted();
      game.stats?.addXP?.(CARJACK.xp, game.talents);
    }
    this.car = car;
    this.stolen = car;
    this._owned.add(car);
    this._remove(car);
    // Guarda su puesto para devolverlo si lo deja botado. Sigue apoyado mientras el jugador camina hasta la puerta.
    const body = car.vehicle?.group;
    car._puesto ??= { x: car.position.x, y: car.position.y, z: car.position.z, h: car.group.rotation.y,
      tilt: body?.rotation.x ?? 0, lift: body?.position.y ?? 0, liftFlat: (body?.position.y ?? 0) - (body?.rotation.x ? CURB_HEIGHT / 2 : 0) };
    this._ruedasApoyo = huellaRuedas(car);
    if (game.player) game.player.atWheel = true;
    car.robado = true; // ya no tiene dueño que lo parquee: nadie lo cuida por propina (CarGuarding)
    // La patrulla lo ve por los vidrios: la caja del carro que maneja no tapa su línea de vista (CombatGeometry).
    car.driven = true;
    car.traffic = true; // luces encendidas mientras se maneja
    if (car.marker) car.marker.visible = false;
    this._actualizarLuces(car);
    game.player?.velocity?.set?.(0, 0, 0);
    this._startBoarding(car);
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
  }

  /** Se baja por el primer lado libre (izquierda, derecha, delante, detrás). Sin ninguno libre no se baja: devuelve false. */
  exit() {
    const game = this.game, car = this.car;
    if (!car) return false;
    if (this.fisica && Math.abs(this.speed) > CARJACK.exitSpeed) return false;
    if (this.fisica && this.transition?.kind === 'enter') {
      const { from } = this.transition;
      game.player.position.copy(from);
      game.player.root.position.copy(from);
      this.reset();
      return true;
    }
    const h = car.group.rotation.y;
    const fx = Math.cos(h), fz = -Math.sin(h);
    const lx = -Math.sin(h), lz = -Math.cos(h); // izquierda del conductor
    const sideOffset = car.width / 2 + 0.7, endOffset = car.length / 2 + 0.7;
    const options = [[lx * sideOffset, lz * sideOffset], [-lx * sideOffset, -lz * sideOffset],
      [fx * endOffset, fz * endOffset], [-fx * endOffset, -fz * endOffset]];
    const spot = options.find(([dx, dz]) => !this._pointBlocked(car.position.x + dx, car.position.z + dz, car.position.y));
    if (!spot) return false;
    this._estacionar();
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
    player.atWheel = false;
    this._leave(car);
    car.driven = false;
    car.setPlayerDriver?.(false);
    if (!this.fisica) car.settle?.(.8);
    car.traffic = false; // queda estacionado: se le pueden robar los espejos
    this._actualizarLuces(car);
    if (car.marker) car.marker.visible = !car.used;
    // La cámara no salta hacia el jugador: vuelve a su distancia mientras se baja.
    if (game.cameraRig && this._savedCameraDistance != null) {
      this._cameraReturn = { from: game.cameraRig.distance, to: this._savedCameraDistance, t: 0 };
    }
    this._savedCameraDistance = null;
    this.car = null;
    this.speed = 0;
    this.cooldown = CARJACK.cooldown;
    if (this._dom) this._dom.hud.hidden = true;
    return true;
  }

  /**
   * Sale del carro sin colocar al jugador (recuperación o arresto). Con `perdido` (lo cogió la Policía
   * manejándolo) el carro deja de ser suyo: volver a subirse es otro robo.
   */
  reset({ perdido = false } = {}) {
    const car = this.car;
    this._estacionar();
    if (car && perdido) {
      this._owned.delete(car);
      if (this.stolen === car) this.stolen = null;
    }
    if (car) {
      car.driven = false;
      car.traffic = false;
      car.setPlayerDriver?.(false);
      this._actualizarLuces(car);
      if (car.marker) car.marker.visible = !car.used;
      this._leave(car);
    }
    if (this.game.player) this.game.player.atWheel = false;
    this.transition = null;
    if (this.game.player?.root) this.game.player.root.visible = true;
    const restore = this._savedCameraDistance ?? this._cameraReturn?.to;
    if (this.game.cameraRig && restore != null) this.game.cameraRig.distance = restore;
    this._savedCameraDistance = null;
    this._cameraReturn = null;
    this.car = null;
    this.speed = 0;
    this.prompt = null;
    this.target = null;
    if (this._dom) this._dom.hud.hidden = true;
  }

  /**
   * Lo deja donde quedó; si no está en su puesto tal como estaba (corrido, girado o enderezado), entra en la lista de
   * los que vuelven a él.
   */
  _leave(car) {
    const home = car._puesto;
    if (!home || this._away.includes(car)) return;
    const body = car.vehicle?.group;
    const turn = Math.abs(Math.atan2(Math.sin(car.group.rotation.y - home.h), Math.cos(car.group.rotation.y - home.h)));
    const moved = Math.hypot(car.position.x - home.x, car.position.z - home.z) > CARJACK.homeAway || turn > CARJACK.homeTurn ||
      (body && (Math.abs(body.rotation.x - home.tilt) > 1e-4 || Math.abs(body.position.y - home.lift) > 1e-3 ||
        Math.abs(body.rotation.z) > 1e-4));
    if (moved) this._away.push(car);
  }

  _remove(car) {
    const i = this._away.indexOf(car);
    if (i >= 0) this._away.splice(i, 1);
  }

  /**
   * El carro dejado lejos de su puesto vuelve a él, con su ladeo del sardinel, cuando el jugador no ve ni el carro ni
   * el puesto (más allá de la niebla, como el tráfico atascado que se retira) y el puesto está libre. Si el jugador
   * sigue cerca, el carro se queda donde lo dejó.
   */
  _returnAbandoned(dt) {
    if (!this._away.length) return;
    this._homeTimer -= dt;
    if (this._homeTimer > 0) return;
    this._homeTimer = CARJACK.homeCheck;
    const player = this.game.player?.position;
    if (!player) return;
    const far = this.game.traffic?._resizeDistance?.() ?? 60, farSq = far * far;
    for (let i = this._away.length - 1; i >= 0; i--) {
      const car = this._away[i], home = car._puesto;
      if (car === this.car) { this._away.splice(i, 1); continue; }
      const dc = (car.position.x - player.x) ** 2 + (car.position.z - player.z) ** 2;
      const dh = (home.x - player.x) ** 2 + (home.z - player.z) ** 2;
      if (dc < farSq || dh < farSq || this._homeTaken(car, home)) continue;
      car.position.set(home.x, home.y, home.z);
      car.group.rotation.y = home.h;
      const body = car.vehicle?.group;
      if (body) {
        body.rotation.set(home.tilt, 0, 0);
        body.position.y = home.lift;
      }
      this._away.splice(i, 1);
    }
  }

  /** ¿Hay otro vehículo encima del puesto? */
  _homeTaken(car, home) {
    const e = carExtent(car, home.h);
    homeBox.min.set(home.x - e.x, home.y + .3, home.z - e.z);
    homeBox.max.set(home.x + e.x, home.y + 1.5, home.z + e.z);
    for (const entry of this.game.collisions?.dynamicColliders ?? []) {
      if (entry.vehicle !== car && entry.box && homeBox.intersectsBox(entry.box)) return true;
    }
    return false;
  }

  /** Punto junto a la puerta del conductor; si el modelo no lo da, el costado izquierdo. */
  _doorPoint(car) {
    if (typeof car.driverDoor === 'function') return car.driverDoor(new THREE.Vector3());
    const h = car.group.rotation.y, side = car.width / 2 + .55;
    return new THREE.Vector3(car.position.x - Math.sin(h) * side, car.position.y, car.position.z - Math.cos(h) * side);
  }

  _startBoarding(car) {
    const player = this.game.player;
    if (!player?.position || !player.root) return;
    const door = this._doorPoint(car);
    const ground = this._ground(door.x, door.z, car.position.y);
    if (Number.isFinite(ground)) door.y = ground;
    const distance = Math.hypot(door.x - player.position.x, door.z - player.position.z);
    const walk = Math.min(BOARDING.maxWalk, distance / BOARDING.walkSpeed);
    this.transition = { kind: 'enter', phase: 'walk', t: 0, car, from: player.position.clone(), door,
      walk, speed: walk > 0 ? distance / walk : 0 };
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
    this._apoyarModelo();
    this.transition = null;
    this._syncPlayer();
    if (this._dom) this._dom.hud.hidden = false;
    if (this.fisica && !this._falloFisica) this._prepararFisica();
  }

  _prepararFisica() {
    const car = this.car;
    this._fabricaFisica ??= Promise.resolve().then(this._cargarFisica);
    const sesion = this._fabricaFisica.then(crear => {
      // Puede haberse bajado y vuelto a subir al mismo carro mientras cargaba el módulo.
      if (this.fisicaLista !== sesion) return null;
      try {
        car.usarSuspensionFisica?.(true);
        this.chasis = crear(this);
        return this.chasis;
      } catch (error) {
        car.usarSuspensionFisica?.(false);
        throw error;
      }
    }).catch(error => {
      if (!this._falloFisica) console.warn('No se pudo activar la física del carro. Se conserva la conducción habitual.', error);
      this._falloFisica = true;
      return null;
    });
    this.fisicaLista = sesion;
  }

  _estacionar() {
    this.fisicaLista = null;
    if (this.chasis) this.chasis.liberar();
    else if (this.car && this.transition?.kind !== 'enter') {
      apoyarCarroAlBajar(this.car, this._sueloCarro);
    }
    this.chasis = null;
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
        const k = Math.min(1, tr.t / BOARDING.force);
        player.animateScripted?.(dt, { action: 'agarrar', actionProgress: k, yaw: faceCar });
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
        if (k >= 1) this._finishBoarding();
        return;
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
    // Si otro movió la distancia (la rueda del ratón), la cámara ya es suya.
    if (back.last !== undefined && Math.abs(rig.distance - back.last) > 1e-6) { this._cameraReturn = null; return; }
    back.t = Math.min(1, back.t + dt / BOARDING.cameraReturn);
    const e = back.t * back.t * (3 - 2 * back.t);
    rig.distance = back.from + (back.to - back.from) * e;
    back.last = rig.distance;
    if (back.t >= 1) this._cameraReturn = null;
  }

  _ground(x, z, y) {
    const district = this.game.world?.active;
    return district?.getMovementGroundHeight?.(x, z, y) ?? district?.getGroundHeight?.(x, z);
  }

  _actualizarLuces(carro) {
    const { clock, weather } = this.game;
    carro.setNight?.(clock?.lightsOn ?? clock?.isNight ?? false, weather?.isRaining ?? false, weather?.weather === 'niebla');
    if (carro.driven) proyectarHazJugador(carro, this._sueloCarro, carro.position.y);
  }

  _apoyarModelo() {
    const carro = this.car;
    if (!carro?.vehicle?.group) return;
    const giro = carro.vehicle.frontWheelPivots?.[0]?.rotation.y ?? 0;
    const pose = poseDeApoyo(carro, this._sueloCarro, carro.position.y, this._ruedasApoyo, this._poseApoyo, giro);
    apoyarModelo(carro, pose, this._ruedasApoyo);
  }

  _pointBlocked(x, z, y) {
    const collisions = this.game.collisions;
    const hits = b => !!b && x + .4 > b.min.x && x - .4 < b.max.x && z + .4 > b.min.z && z - .4 < b.max.z &&
      b.max.y > y + .2 && b.min.y < y + 1.6;
    const candidates = collisions?.queryStatic?.(x - .4, z - .4, x + .4, z + .4, []) ?? [];
    if (candidates.some(({ box }) => hits(box))) return true;
    // Los carros parqueados, el tráfico y el bus son cajas dinámicas: no se baja dentro de otro vehículo.
    for (const entry of collisions?.dynamicColliders ?? []) {
      if (entry.vehicle === this.car) continue;
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

  /** Metros cuadrados de planta que la carrocería en (x, z) con rumbo h mete dentro de cosas sólidas; 0 si nada. */
  _bodyOverlap(x, z, y, h) {
    const car = this.car, collisions = this.game.collisions;
    if (!collisions) return 0;
    const e = carExtent(car, h);
    box.min.set(x - e.x, y + .3, z - e.z);
    box.max.set(x + e.x, y + 1.5, z + e.z);
    let area = 0;
    const add = ({ box: b }) => {
      if (!(b.max.y > box.min.y && b.min.y < box.max.y)) return;
      const ox = Math.min(b.max.x, box.max.x) - Math.max(b.min.x, box.min.x);
      const oz = Math.min(b.max.z, box.max.z) - Math.max(b.min.z, box.min.z);
      if (ox > 0 && oz > 0) area += ox * oz;
    };
    for (const entry of collisions.queryStatic?.(box.min.x, box.min.z, box.max.x, box.max.z, []) ?? []) add(entry);
    for (const entry of collisions.dynamicColliders ?? []) if (entry.vehicle !== car) add(entry);
    return area;
  }

  /**
   * ¿El paso choca? Un carro que ya quedó encajado (lo soltaron pegado a un muro o a otro carro) puede salir: vale
   * cualquier paso que lo meta menos de lo que ya está metido, pero nunca uno que lo meta más.
   */
  _stepBlocked(nx, nz, ny, h) {
    const ahead = this._bodyOverlap(nx, nz, ny, h);
    if (ahead <= 0) return false;
    const car = this.car;
    return ahead >= this._bodyOverlap(car.position.x, car.position.z, car.position.y, car.group.rotation.y) - 1e-6;
  }

  _drive(dt, input) {
    const car = this.car;
    // W, A, S, D, stick del mando o palanca táctil: el eje ya reúne teclado y mando. Las flechas no manejan: mueven
    // solo la cámara (Camera.updateControls), igual que a pie.
    const axis = input.axis ?? { x: 0, z: 0 };
    const throttle = THREE.MathUtils.clamp(-axis.z, -1, 1);
    const steer = THREE.MathUtils.clamp(-axis.x, -1, 1);
    const handbrake = input.isDown('Space');

    if (this.chasis) {
      this._manejarChasis(dt, throttle, steer, handbrake);
      this._seguirCarro(dt, input);
      return;
    }

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
    } else if (Math.abs(ny - car.position.y) > 1.2 || this._stepBlocked(nx, nz, ny, h)) {
      // Choque: rebota un poco y pierde casi toda la velocidad.
      if (Math.abs(this.speed) > 6) this._toast('¡Me estrellé!', 'warn');
      if (Math.abs(this.speed) > 6) this.game.stats && (this.game.stats.salud = Math.max(1, this.game.stats.salud - Math.round(Math.abs(this.speed) * .4)));
      this.speed *= -0.2;
    } else {
      car.group.rotation.y = h;
      car.position.set(nx, ny, nz);
      car.animateDrive?.(step, (throttle < 0 && this.speed > 0) || handbrake, { dt, speed: this.speed, steering: steer * .34 });
      if (step || steer) this._apoyarModelo();
    }
    this._seguirCarro(dt, input);
  }

  _manejarChasis(dt, acelerador, direccion, frenoMano) {
    const { velocidad, distancia, giro, golpe, agua } = this.chasis.avanzar(dt, { acelerador, direccion, frenoMano });
    this.speed = velocidad;
    this._waterToast = Math.max(0, this._waterToast - dt);
    if (agua && this._waterToast <= 0) {
      this._toast('No me puedo meter al lago con el carro.', 'warn');
      this._waterToast = 4;
    }
    if (golpe > 6) {
      this._toast('¡Me estrellé!', 'warn');
      const stats = this.game.stats;
      if (stats) stats.salud = Math.max(1, stats.salud - Math.round(golpe * .4));
    }
    const frenando = frenoMano || acelerador * velocidad < 0;
    this.car.animateDrive?.(distancia, frenando, { dt, speed: velocidad, steering: giro });
  }

  _seguirCarro(dt, input) {
    const car = this.car;
    proyectarHazJugador(car, this._sueloCarro, this.chasis?.nivel ?? car.position.y);
    this._syncPlayer();
    if (this._dom) this._dom.speed.textContent = `${Math.round(Math.abs(this.speed) * 3.6)} km/h`;

    const rig = this.game.cameraRig;
    if (rig?.mode === 'third-person' && !rig._drag && !lookingAround(input)) {
      // La cámara vuelve suavemente detrás del carro cuando no se arrastra ni se mira con las flechas.
      const target = car.group.rotation.y - Math.PI / 2;
      const diff = Math.atan2(Math.sin(target - rig.yaw), Math.cos(target - rig.yaw));
      rig.yaw += diff * (1 - Math.exp(-3 * dt));
    }
  }

  /**
   * Robar un carro sube «te tienen fichado» y una patrulla que lo vea persigue: lo mismo que un robo a pie
   * (StealSystem._alertPolice y TrafficSystem.alertForTheft).
   */
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
