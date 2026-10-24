// src/entities/Player.js
import * as THREE from 'three';
import {
  PLAYER_RADIUS,
  PLAYER_SPEED_WALK,
  PLAYER_SPEED_RUN,
  CHARACTER_SCALE
} from '../utils/constants.js';
import { createCharacter } from '../character/character.js';
import { createRealisticCharacter, REALISTIC_SCALE } from '../character/RealisticCharacter.js';
import { PlayerRagdoll } from '../systems/PlayerRagdoll.js';

export class Player {
  constructor(scene, input, stats=null) {
    this.input = input;
    this.scene = scene;
    this.stats = stats;
    this.position = new THREE.Vector3(16, 0, 16); // zona reservada spawn
    this.radius = PLAYER_RADIUS;
    this.speedWalk = PLAYER_SPEED_WALK;
    this.speedRun = PLAYER_SPEED_RUN;
    this.speedMult = 1; // debuff por salud mental baja
    this.velocity = new THREE.Vector3();
    this.hasInertia = true;
    this._direction = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._before = new THREE.Vector3();
    this._impactVelocity = new THREE.Vector3();
    this._impactTime = 0;

    // Contenedor raíz (posición + rumbo); el personaje va escalado adentro
    this.root = new THREE.Group();
    this.root.position.copy(this.position);
    scene.add(this.root);

    this.character = createCharacter();
    this.character.group.scale.setScalar(CHARACTER_SCALE);
    this.character.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.root.add(this.character.group);
    this.procedural = this.character;
    this.modelScale = CHARACTER_SCALE;
    this.modelKind = 'procedural';
    this.ragdoll = new PlayerRagdoll(this);

    this.time = 0;
    this.speed = 0;
    this.state = 'idle';
    this.load = 0;            // 0..1: llenado del costal (tamaño del saco)
    this.action = null;       // 'pedir' | 'buscar' | 'comer' | 'dormir' | 'saludo'
    this.actionTimer = 0;
    this.sorting = false;     // seleccionando basura (mantener Q)
    this.frozen = false;
  }

  setLook(look) {
    this.look = look;
    this.procedural.setLook(look);
    this.procedural.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    return this._realistic?.setLook(look);
  }

  /** Cambia entre el personaje realista (MakeHuman, por defecto) y el procedural (liviano) */
  async setModel(kind) {
    if (kind === this.modelKind) return;
    this.clearVehicleImpact();
    this.modelKind = kind;
    if (kind === 'realista') {
      this._realisticPromise ??= createRealisticCharacter(this.look ?? {});
      this._realistic = await this._realisticPromise;
      if (this._realistic.look !== this.look && this.look) await this._realistic.setLook(this.look);
      if (this.modelKind !== 'realista') return; // se cambió mientras cargaba
      this.root.remove(this.character.group);
      this.character = this._realistic;
      this.modelScale = REALISTIC_SCALE;
    } else {
      this.root.remove(this.character.group);
      this.character = this.procedural;
      this.modelScale = CHARACTER_SCALE;
    }
    this.root.add(this.character.group);
  }

  /** Anima una acción breve (segundos) */
  playAction(action, duration = 1) {
    this.action = action;
    this.actionTimer = duration;
  }

  playBeg() {
    this.playAction('pedir', 1.2);
  }

  receiveVehicleImpact(direction, speed, { collisions = this._lastCollisions } = {}) {
    if (this.ragdoll.start(direction, speed, collisions)) return;
    this._impactVelocity.copy(direction).setY(0).normalize().multiplyScalar(Math.min(9, speed * .7));
    this._impactTime = 1;
    this.root.rotation.z = .85;
  }

  get isStunned() { return !!this.ragdoll?.active || this._impactTime > 0; }
  get isRagdollActive() { return !!this.ragdoll?.active; }

  clearVehicleImpact() {
    this.velocity?.set(0, 0, 0);
    this.ragdoll.clear();
    this._impactVelocity.set(0, 0, 0);
    this._impactTime = 0;
    this.root.rotation.z = 0;
    this.frozen = false;
  }

  update(dt, camera, collisions) {
    this.time += dt;
    this._lastCollisions = collisions;
    if (this.ragdoll?.active) {
      this.velocity?.set(0, 0, 0);
      this.ragdoll.update(dt, collisions);
      this.speed = 0; this.state = 'ragdoll';
      return;
    }
    if (this.actionTimer > 0) {
      this.actionTimer -= dt;
      if (this.actionTimer <= 0) this.action = null;
    }

    const { x, z } = this.input.axis;
    const stunned = this._impactTime > 0;
    if (this.frozen) this.velocity?.set(0, 0, 0);
    const moving = !stunned && !this.frozen && (x !== 0 || z !== 0);
    const running = this.input.isRunning && moving;
    let speed = running ? this.speedRun : this.speedWalk;
    if (this.stats?.getSpeedMultiplier) {
      speed *= this.stats.getSpeedMultiplier();
    }
    // Movimiento
    const dir = this._direction.set(x, 0, z);
    if (camera?.userData.cameraMode === 'third-person') {
      const forward = camera.getWorldDirection(this._forward);
      forward.y = 0;
      forward.normalize();
      const right = this._right.set(-forward.z, 0, forward.x);
      dir.copy(right).multiplyScalar(x).addScaledVector(forward, -z);
    }
    if (moving) dir.normalize();
    let delta;
    if (this.hasInertia && dt > 0) {
      this.velocity ??= new THREE.Vector3();
      const targetSpeed = moving ? speed : 0;
      const targetVelX = moving ? dir.x * targetSpeed : 0;
      const targetVelZ = moving ? dir.z * targetSpeed : 0;
      const accelRate = moving ? 22 : 18;
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVelX, 1 - Math.exp(-accelRate * dt));
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVelZ, 1 - Math.exp(-accelRate * dt));
      if (!moving && this.velocity.lengthSq() < 0.0005) {
        this.velocity.set(0, 0, 0);
      }
      delta = this._delta.copy(this.velocity).multiplyScalar(dt);
    } else {
      delta = this._delta.copy(dir).multiplyScalar(moving ? speed * dt : 0);
    }
    if (stunned) {
      delta.addScaledVector(this._impactVelocity, (1 - Math.exp(-4 * dt)) / 4);
      this._impactVelocity.multiplyScalar(Math.exp(-4 * dt));
      this._impactTime = Math.max(0, this._impactTime - dt);
    }
    this.root.rotation.z = .85 * this._impactTime;

    const before = this._before.copy(this.position);
    if (collisions) {
      this.position.copy(
        collisions.resolveMove(this.position, delta, this.radius, this.position)
      );
    } else {
      this.position.add(delta);
    }
    this.speed = dt > 0 ? before.distanceTo(this.position) / dt : 0;

    this.root.position.copy(this.position);

    // Rotación suave
    if (moving) {
      const targetAngle = Math.atan2(dir.x, dir.z);
      let diff = targetAngle - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += diff * Math.min(1, 12 * dt);
    }

    this.state = (this.speed < 0.25) ? 'idle' : (running ? 'run' : 'walk');

    // Animación del personaje (velocidad en metros del modelo, no del mundo)
    this.character.update(dt, {
      speed: stunned ? 0 : this.speed / this.modelScale,
      running,
      action: stunned ? null : (this.sorting ? 'buscar' : this.action),
      t: this.time,
      load: this.load,
      dirt: this.stats ? Math.max(0, (40 - this.stats.higiene) / 40) : 0
    });
  }

  dispose() {
    this.ragdoll.clear();
    this._realistic?.dispose?.();
    this._realisticPromise?.then(character => character.dispose?.()).catch(() => {});
    this.procedural.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this.scene.remove(this.root);
  }
}
