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
import { PUNCH } from '../data/combat.js';
import { hasMeleeLine } from '../systems/MeleeCombat.js';

export class Player {
  constructor(scene, input, stats=null, audio=null) {
    this.audio = audio;
    this.jumpVelocity = 0;
    this.isGrounded = true;
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
    this._punchKnockback = new THREE.Vector3();
    this._punchTargets = null;
    this._punchHitDone = false;
    this._punchInvulnerability = 0;

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
    this.actionDuration = 0;
    this.sorting = false;
    this.hasCart = false;     // seleccionando basura (mantener Q)
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
    this.actionDuration = duration;
    this._punchTargets = null;
  }


  punch(npcs = []) {
    if (this.isStunned || this.action || this.hasCart || this.sorting) return false;
    this.playAction('golpear', PUNCH.duration);
    this._punchTargets = npcs;
    this._punchHitDone = false;
    this.audio?.playWhoosh?.();
    return true;
  }

  _connectPunch() {
    const forwardX = Math.sin(this.root.rotation.y);
    const forwardZ = Math.cos(this.root.rotation.y);
    let target = null, nearest = PUNCH.range;
    for (const npc of this._punchTargets ?? []) {
      if (!npc?.position || npc._disposed || typeof npc.takePunch !== 'function') continue;
      if (Math.abs(npc.position.y - this.position.y) > PUNCH.verticalTolerance) continue;
      const dx = npc.position.x - this.position.x;
      const dz = npc.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= nearest || dist < 0.001) continue;
      if ((dx * forwardX + dz * forwardZ) / dist <= PUNCH.minFacingDot) continue;
      if (!hasMeleeLine(this.position, npc.position, this._lastCollisions)) continue;
      target = npc; nearest = dist;
    }
    if (target) {
      const drop = target.takePunch(this);
      this.audio?.playPunchHit?.();
      if (Number.isFinite(drop) && drop > 0 && typeof this.stats?.dinero === 'number') this.stats.dinero += drop;
    }
  }

  receivePunch(attacker, damage = 6) {
    if (this.isStunned || this._punchInvulnerability > 0 || !(this.stats?.salud > 0)) return false;
    if (!attacker?.position || !Number.isFinite(damage) || damage <= 0) return false;
    const dx = this.position.x - attacker.position.x, dz = this.position.z - attacker.position.z;
    if (Math.hypot(dx, dz) > PUNCH.range || Math.abs(this.position.y - attacker.position.y) > PUNCH.verticalTolerance) return false;
    if (!hasMeleeLine(attacker.position, this.position, this._lastCollisions)) return false;
    this.stats.salud = Math.max(0, this.stats.salud - damage);
    this._punchInvulnerability = 0.75;
    this.velocity.set(0, 0, 0);
    this._punchKnockback.set(dx, 0, dz).normalize().multiplyScalar(2);
    this.playAction('recibirGolpe', 0.4);
    this.audio?.playPunchHit?.();
    return true;
  }

  playBeg() {
    this.playAction('pedir', 1.2);
  }

  receiveVehicleImpact(direction, speed, { collisions = this._lastCollisions } = {}) {
    this.playAction(null, 0);
    this._punchKnockback.set(0, 0, 0);
    if (this.ragdoll.start(direction, speed, collisions)) return;
    this._impactVelocity.copy(direction).setY(0).normalize().multiplyScalar(Math.min(9, speed * .7));
    this._impactTime = 1;
    this.root.rotation.z = .85;
  }

  get isStunned() { return !!this.ragdoll?.active || this._impactTime > 0 || (this.action === 'recibirGolpe' && this.actionTimer > 0); }
  get isRagdollActive() { return !!this.ragdoll?.active; }

  clearVehicleImpact() {
    this.velocity?.set(0, 0, 0);
    this.ragdoll.clear();
    this._impactVelocity.set(0, 0, 0);
    this._impactTime = 0;
    this._punchKnockback?.set(0, 0, 0);
    this._punchInvulnerability = 0;
    if (this.action === 'golpear' || this.action === 'recibirGolpe') this.playAction(null, 0);
    this.root.rotation.z = 0;
  }

  update(dt, camera, collisions, groundHeight = null, npcs = []) {
    this.time += dt;
    this._lastCollisions = collisions;
    this._punchInvulnerability = Math.max(0, (this._punchInvulnerability ?? 0) - dt);
    if (this.ragdoll?.active) {
      this.velocity?.set(0, 0, 0);
      this.ragdoll.update(dt, collisions);
      this.speed = 0; this.state = 'ragdoll';
      return;
    }
    if (this.actionTimer > 0) {
      this.actionTimer = Math.max(0, this.actionTimer - dt);
      if (this.action === 'golpear' && !this._punchHitDone && this.actionDuration - this.actionTimer >= PUNCH.impactTime - 1e-8) {
        this._punchHitDone = true;
        this._connectPunch();
      }
      if (this.actionTimer <= 0) { this.action = null; this._punchTargets = null; }
    }

    // Salto y combate cuerpo a cuerpo estilo GTA
    const wantsJump = typeof this.input?.consumePress === 'function' && (this.input.consumePress('Space') || this.input.consumePress('KeySpace'));
    if (wantsJump && this.isGrounded && !this.isStunned && !this.hasCart && !this.sorting) {
      this.jumpVelocity = 5.2;
      this.isGrounded = false;
      this.playAction('saltar', 0.65);
      this.audio?.playJump?.();
    }

    const wantsPunch = typeof this.input?.consumePress === 'function' && (this.input.consumePress('KeyG') || this.input.consumePress('Mouse0'));
    if (wantsPunch && !this.isStunned && !this.action && !this.hasCart && !this.sorting) {
      this.punch(npcs);
    }

    const { x = 0, z = 0 } = this.input?.axis ?? {};
    const stunned = this._impactTime > 0;
    const hurt = this.action === 'recibirGolpe';
    const moving = !stunned && !hurt && (x !== 0 || z !== 0);
    const running = Boolean(this.input?.isRunning && moving);
    let speed = running ? this.speedRun : this.speedWalk;
    if (this.stats?.getSpeedMultiplier) {
      speed *= this.stats.getSpeedMultiplier();
    }
    if (this.hasCart) {
      speed *= 0.82;
    }
    if (this.action === 'golpear') speed *= 0.35;
    // Movimiento
    const dir = this._direction.set(x, 0, z);
    if (camera?.userData?.cameraMode === 'third-person') {
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
    if (this._punchKnockback) {
      delta.addScaledVector(this._punchKnockback, (1 - Math.exp(-8 * dt)) / 8);
      this._punchKnockback.multiplyScalar(Math.exp(-8 * dt));
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
    this.isGrounded ??= true;
    this.jumpVelocity ??= 0;
    let groundY = 0;
    if (!this.isGrounded) {
      this.jumpVelocity -= 17.0 * dt;
      this.position.y += this.jumpVelocity * dt;
      groundY = typeof groundHeight === 'function' ? groundHeight(this.position.x, this.position.z) : 0;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.jumpVelocity = 0;
        this.isGrounded = true;
        this.audio?.playLanding?.();
      }
    } else if (typeof groundHeight === 'function') {
      groundY = groundHeight(this.position.x, this.position.z);
      this.position.y = THREE.MathUtils.lerp(this.position.y, groundY, 1 - Math.exp(-22 * dt));
    }

    this.root.position.copy(this.position);

    // Rotación suave
    if (moving) {
      const targetAngle = Math.atan2(dir.x, dir.z);
      let diff = targetAngle - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += diff * Math.min(1, 14 * dt);

      // Inclinación centrífuga (banking lateral en giros)
      const targetBank = THREE.MathUtils.clamp(-diff * (running ? 0.38 : 0.22), -0.22, 0.22);
      this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, targetBank, 1 - Math.exp(-14 * dt));
      // Inclinación hacia adelante con la aceleración
      this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, running ? 0.08 : 0.02, 1 - Math.exp(-10 * dt));
    } else {
      this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, 0, 1 - Math.exp(-12 * dt));
      this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, 0, 1 - Math.exp(-10 * dt));
    }

    this.state = (this.speed < 0.25) ? 'idle' : (running ? 'run' : 'walk');

    // Animación del personaje (velocidad en metros del modelo, no del mundo)
    this.character.update(dt, {
      speed: stunned ? 0 : this.speed / this.modelScale,
      running,
      action: stunned ? null : (this.sorting ? 'buscar' : this.action),
      actionProgress: this.actionDuration > 0 ? THREE.MathUtils.clamp(1 - this.actionTimer / this.actionDuration, 0, 1) : 0,
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
