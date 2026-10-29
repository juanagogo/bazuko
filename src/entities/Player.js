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
import { WEAPONS, DEFAULT_WEAPON, COMBO_WINDOW, CHAIN_AT, comboStep } from '../data/weapons.js';

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
    this.sorting = false;
    this.hasCart = false;     // seleccionando basura (mantener Q)

    // Combate cuerpo a cuerpo: `attack` = { weapon, step, phase: windup|active|recovery, t, progress, timing }
    this.equippedWeapon = DEFAULT_WEAPON;
    this.attack = null;
    this.comboStep = 0;       // golpe con el que arranca el próximo ataque
    this.comboTimer = 0;      // ventana restante para continuar el combo
    this._attackQueued = false;
    this._targets = [];
  }

  get weapon() { return WEAPONS[this.equippedWeapon] ?? WEAPONS[DEFAULT_WEAPON]; }

  /** Equipa un arma de la tabla (o puños); false si no existe. */
  equipWeapon(id = DEFAULT_WEAPON) {
    if (!WEAPONS[id]) return false;
    this.equippedWeapon = id;
    this.attack = null;
    this.comboStep = 0;
    this.comboTimer = 0;
    this._attackQueued = false;
    const held = id === DEFAULT_WEAPON ? null : id;
    this.character?.setWeapon?.(held);
    this._realistic?.setWeapon?.(held);
    return true;
  }

  /** Equipa el arma o, si ya la tiene en la mano, vuelve a puños. Devuelve si quedó equipada. */
  toggleWeapon(id) {
    if (!WEAPONS[id] || id === DEFAULT_WEAPON) return false;
    if (this.equippedWeapon === id) { this.equipWeapon(DEFAULT_WEAPON); return false; }
    return this.equipWeapon(id);
  }

  /** Vuelve a puños si el arma equipada ya no está en el inventario. */
  syncWeapon(inventory) {
    if (this.equippedWeapon !== DEFAULT_WEAPON && inventory.count(this.equippedWeapon) <= 0) {
      this.equipWeapon(DEFAULT_WEAPON);
    }
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
      this._realistic.setWeapon?.(this.equippedWeapon === DEFAULT_WEAPON ? null : this.equippedWeapon);
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


  /**
   * Pulsación de ataque: arranca el golpe que toca del combo o, si ya hay uno en curso, lo deja
   * en cola para encadenarlo al final de su recuperación.
   */
  punch() {
    if (this.attack) {
      if (this.attack.step + 1 < this.weapon.combo) this._attackQueued = true;
      return;
    }
    this._beginAttack(this.comboTimer > 0 ? this.comboStep : 0);
  }

  _beginAttack(step) {
    const weapon = this.weapon;
    const timing = comboStep(weapon, step);
    this.attack = { weapon: weapon.id, step, phase: 'windup', t: 0, progress: 0, timing };
    this._attackQueued = false;
    this.comboTimer = 0;
    this.playAction('golpear', timing.windup + timing.active + timing.recovery);
    this.audio?.playWhoosh?.();
  }

  _endAttack(next) {
    this.attack = null;
    this._attackQueued = false;
    if (this.action === 'golpear') { this.action = null; this.actionTimer = 0; }
    this.comboStep = next;
    this.comboTimer = next > 0 ? COMBO_WINDOW : 0;
  }

  _updateAttack(dt, npcs) {
    const a = this.attack;
    if (!a) {
      if (this.comboTimer > 0 && (this.comboTimer -= dt) <= 0) this.comboStep = 0;
      return;
    }
    if (this.isStunned || this.hasCart || this.sorting) { this._endAttack(0); return; }
    a.t += dt;
    const timing = a.timing;
    for (;;) {
      if (a.phase === 'windup') {
        if (a.t < timing.windup) { a.progress = a.t / timing.windup; return; }
        a.t -= timing.windup;
        a.phase = 'active';
        this._applyImpact(timing, a.weapon, npcs);
      } else if (a.phase === 'active') {
        if (a.t < timing.active) { a.progress = a.t / timing.active; return; }
        a.t -= timing.active;
        a.phase = 'recovery';
      } else {
        if (this._attackQueued && a.t >= timing.recovery * CHAIN_AT) { this._beginAttack(a.step + 1); return; }
        if (a.t < timing.recovery) { a.progress = a.t / timing.recovery; return; }
        this._endAttack(a.step + 1 < this.weapon.combo ? a.step + 1 : 0);
        return;
      }
    }
  }

  /** Impacto: puños golpean al más cercano de frente; las armas, a todos los que alcancen. */
  _applyImpact(timing, weaponId, npcs) {
    const weapon = WEAPONS[weaponId];
    const forwardX = Math.sin(this.root.rotation.y);
    const forwardZ = Math.cos(this.root.rotation.y);
    const targets = this._targets;
    targets.length = 0;
    let closest = null, closestDist = Infinity;
    for (const npc of npcs) {
      if (!npc || !npc.position || npc.isKnockedOut) continue;
      const dx = npc.position.x - this.position.x;
      const dz = npc.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > timing.range) continue;
      if ((dx * forwardX + dz * forwardZ) / (dist || 1) < weapon.arc) continue;
      if (weapon.hitAll) targets.push(npc);
      else if (dist < closestDist) { closest = npc; closestDist = dist; }
    }
    if (closest) targets.push(closest);
    let hit = false;
    for (const npc of targets) {
      const dx = npc.position.x - this.position.x;
      const dz = npc.position.z - this.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const info = { damage: timing.damage, dir: { x: dx / len, z: dz / len }, knockback: timing.knockback, attacker: this, weapon: weaponId };
      const drop = typeof npc.takeHit === 'function' ? npc.takeHit(info)
        : typeof npc.takePunch === 'function' ? npc.takePunch(this) : null;
      if (drop === null) continue;
      hit = true;
      if (drop && this.stats && typeof this.stats.dinero === 'number') this.stats.dinero += drop;
    }
    if (hit) this.audio?.playPunchHit?.(); // una sola voz por impacto, aunque alcance a varios
    targets.length = 0;
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
  }

  update(dt, camera, collisions, groundHeight = null, npcs = []) {
    this.time += dt;
    this._lastCollisions = collisions;
    if (this.ragdoll?.active) {
      this.attack = null;
      this.velocity?.set(0, 0, 0);
      this.ragdoll.update(dt, collisions);
      this.speed = 0; this.state = 'ragdoll';
      return;
    }
    if (this.actionTimer > 0) {
      this.actionTimer -= dt;
      if (this.actionTimer <= 0) this.action = null;
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
    if (wantsPunch && !this.isStunned && (!this.action || this.attack) && !this.hasCart && !this.sorting) {
      this.punch();
    }
    this._updateAttack(dt, npcs);

    const { x = 0, z = 0 } = this.input?.axis ?? {};
    const stunned = this._impactTime > 0;
    const moving = !stunned && (x !== 0 || z !== 0);
    const running = Boolean(this.input?.isRunning && moving);
    let speed = running ? this.speedRun : this.speedWalk;
    if (this.stats?.getSpeedMultiplier) {
      speed *= this.stats.getSpeedMultiplier();
    }
    if (this.hasCart) {
      speed *= 0.82;
    }
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
      attack: this.attack,
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
