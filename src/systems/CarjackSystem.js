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
  xp: 25
};

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
    this.speed = 0;        // m/s a lo largo del frente (+X local); negativo en reversa
    this.cooldown = 0;
    this.prompt = null;
    this.target = null;
    this._savedCameraDistance = null;
    this._audioEntry = { car: null, speed: 0, personBlocked: false };
    this._dom = null;
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
    for (const car of this.game.cars ?? []) list.push({ car, vehicle: null });
    for (const vehicle of this.game.traffic?.vehicles ?? []) {
      // Las patrullas no se dejan quitar el carro.
      if (!vehicle.police && vehicle.speed <= CARJACK.maxTrafficSpeed) list.push({ car: vehicle.car, vehicle });
    }
    return list;
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
    this.prompt = this.target.vehicle ? '[Y] Sacar al conductor y robarme el carro' : '[Y] Forzar la puerta y robarme el carro';
    if (input.consumePress(CARJACK.key)) this.enter(this.target);
    return !!this.car;
  }

  enter({ car, vehicle }) {
    const game = this.game;
    if (vehicle) {
      // El conductor sale corriendo y reclama; el carro deja de seguir su ruta.
      game.audio?.playMovingTheft?.(car);
      game.traffic?.release?.(vehicle);
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
    this._raiseWanted();
    game.stats?.addXP?.(CARJACK.xp, game.talents);
    this.car = car;
    car.driven = true;
    car.traffic = true; // luces encendidas mientras se maneja
    if (car.marker) car.marker.visible = false;
    car.setNight?.(game.clock?.isNight ?? false, game.weather?.isRaining ?? false);
    game.traffic?.setParkedCars?.(game.cars);
    if (game.player?.root) game.player.root.visible = false;
    game.player?.velocity?.set?.(0, 0, 0);
    const rig = game.cameraRig;
    if (rig) {
      this._savedCameraDistance ??= rig.distance;
      rig.distance = CARJACK.cameraDistance;
      if (rig.mode === 'third-person') rig.yaw = car.group.rotation.y - Math.PI / 2;
    }
    this.cooldown = CARJACK.cooldown;
    this._syncPlayer();
    if (this._dom) this._dom.hud.hidden = false;
    this._emit('carjack', { car, fromTraffic: !!vehicle });
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
    if (player.root) {
      player.root.position.copy(player.position);
      player.root.visible = true;
    }
    player.velocity?.set?.(0, 0, 0);
    car.driven = false;
    car.traffic = false; // queda estacionado: se le pueden robar los espejos
    car.setNight?.(game.clock?.isNight ?? false, game.weather?.isRaining ?? false);
    if (car.marker) car.marker.visible = !car.used;
    game.traffic?.setParkedCars?.(game.cars);
    if (game.cameraRig && this._savedCameraDistance != null) game.cameraRig.distance = this._savedCameraDistance;
    this._savedCameraDistance = null;
    this.car = null;
    this.speed = 0;
    this.cooldown = CARJACK.cooldown;
    if (this._dom) this._dom.hud.hidden = true;
    this._emit('carjack-exit', { car });
  }

  /** Sale del carro sin colocar al jugador (recuperación o cambio de distrito). */
  reset() {
    const car = this.car;
    if (car) {
      car.driven = false;
      car.traffic = false;
    }
    if (this.game.player?.root) this.game.player.root.visible = true;
    if (this.game.cameraRig && this._savedCameraDistance != null) this.game.cameraRig.distance = this._savedCameraDistance;
    this._savedCameraDistance = null;
    this.car = null;
    this.speed = 0;
    this.prompt = null;
    this.target = null;
    if (this._dom) this._dom.hud.hidden = true;
  }

  _ground(x, z, y) {
    const district = this.game.world?.active;
    return district?.getMovementGroundHeight?.(x, z, y) ?? district?.getGroundHeight?.(x, z);
  }

  _pointBlocked(x, z, y) {
    const collisions = this.game.collisions;
    const candidates = collisions?.queryStatic?.(x - .4, z - .4, x + .4, z + .4, []) ?? [];
    return candidates.some(({ box: b }) => x + .4 > b.min.x && x - .4 < b.max.x && z + .4 > b.min.z && z - .4 < b.max.z &&
      b.max.y > y + .2 && b.min.y < y + 1.6);
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
    const throttle = (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0) - (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0);
    const steer = (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0) - (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0);
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

    if (Math.abs(ny - car.position.y) > 1.2 || this._bodyBlocked(nx, nz, ny, h)) {
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
      if (!npc?.position || (npc._carjackHit ?? 0) > performance.now()) continue;
      if (distanceToCarBody(npc.position, this.car) > .35) continue;
      npc._carjackHit = performance.now() + 3000;
      npc.hitByPoop?.(this.car.position);
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
