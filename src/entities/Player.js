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
import { SMOKE_DURATION, PUFF_INTERVAL, FIRST_PUFF, PUFF, PUFF_LENGTH, isExhaling, smokable, SmokePuffs } from '../character/smoking.js';
import { BASUCO, BASUCO_LENGTH, BASUCO_TOTAL, isBasucoExhaling } from '../character/pipe.js';

const emit = (type, detail) => {
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new CustomEvent(type, { detail }));
};

// Energía que gasta cada golpe (puños o arma).
const ATTACK_ENERGY = 8;

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

    // Cigarrillo o porro: `smoking` = { kind, left, nextPuff, puff } (segundos; `puff` corre durante la calada)
    this.smoking = null;
    this._smoke = null;       // humo en la escena, se crea al primer cigarrillo
    this._wispTimer = 0;
    this._puffTimer = 0;
    this._smokeAt = new THREE.Vector3();
    this._smokeVelocity = new THREE.Vector3();

    // Basuco: `basuco` = { t, inhaled, stowed } mientras dura la pipa y la bocanada
    this.basuco = null;
    // Paranoia (0 a 1) y la alucinación más cercana; las pone PsychosisSystem
    this.paranoia = 0;
    this.paranoiaFocus = null;
    this._glance = 0;          // giro de la cabeza (rad, + a su izquierda)
    this._glanceTarget = 0;
    this._glanceTimer = 0;
    this._glanceSide = 1;
  }

  /** Humo en la escena (cigarrillo, porro y basuco); se crea la primera vez que hace falta */
  _puffs() { return this._smoke ??= new SmokePuffs(this.scene); }

  /**
   * Fuma basuco en pipa: se agacha, prende con el encendedor, aspira y bota el humo. Se queda
   * quieto mientras tiene la pipa. false si está ocupado.
   */
  startBasuco() {
    if (this.basuco || this.action || this.attack || this.isStunned) return false;
    this.basuco = { t: 0, inhaled: false, stowed: false };
    this.playAction('basuco', BASUCO_LENGTH);
    // necesita las dos manos: el cigarrillo se guarda mientras tanto
    if (this.smoking) { this.procedural.setSmoking?.(false); this._realistic?.setSmoking?.(false); }
    this.procedural.setBasuco?.(true);
    this._realistic?.setBasuco?.(true);
    return true;
  }

  /** Guarda la pipa y el encendedor (y devuelve el cigarrillo a la mano si lo tenía) */
  _stowBasuco() {
    if (!this.basuco || this.basuco.stowed) return;
    this.basuco.stowed = true;
    if (this.action === 'basuco') { this.action = null; this.actionTimer = 0; }
    this.procedural.setBasuco?.(false);
    this._realistic?.setBasuco?.(false);
    if (this.smoking) {
      this.procedural.setSmoking?.(true, this.smoking.kind);
      this._realistic?.setSmoking?.(true, this.smoking.kind);
    }
  }

  stopBasuco() {
    this._stowBasuco();
    this.basuco = null;
  }

  _updateBasuco(dt) {
    const b = this.basuco;
    if (!b) return;
    if (this.action === 'dormir' || this.isStunned) { this.stopBasuco(); return; }
    b.t += dt;
    // el efecto llega al terminar de aspirar
    if (!b.inhaled && b.t >= BASUCO.bend + BASUCO.light) {
      b.inhaled = true;
      emit('substance-consumed', { id: 'basuco' });
    }
    if (b.t >= BASUCO_LENGTH) this._stowBasuco();
    const puffs = this._puffs();
    // humo de la cazoleta mientras arde
    if (!b.stowed && b.t > BASUCO.bend && b.t < BASUCO.bend + BASUCO.light
      && (this._wispTimer -= dt) <= 0 && this.character.pipeBowl?.(this._smokeAt)) {
      this._wispTimer = 0.08;
      puffs.emit(this._smokeAt, { size: 0.03, grow: 0.2, life: 1.8, alpha: 0.3, color: '#e4e2dc' });
    }
    // una bocanada espesa al bajar las manos
    if (isBasucoExhaling(b.t) && (this._puffTimer -= dt) <= 0 && this.character.mouth?.(this._smokeAt)) {
      this._puffTimer = 0.04;
      const yaw = this.root.rotation.y;
      const fade = 1 - (b.t - BASUCO.bend - BASUCO.light) / BASUCO.exhale;
      this._smokeVelocity.set(Math.sin(yaw), -0.05, Math.cos(yaw)).multiplyScalar(0.7 * Math.max(0.2, fade));
      puffs.emit(this._smokeAt, { velocity: this._smokeVelocity, size: 0.07, grow: 0.7, life: 3.2, alpha: 0.5 * Math.max(0.3, fade), color: '#e9e7e2' });
    }
    if (b.t >= BASUCO_TOTAL) this.basuco = null;
  }

  /** Con paranoia, la cabeza voltea de golpe a un lado y al otro, o hacia lo que le pareció ver */
  _updateGlance(dt) {
    const p = this.paranoia ?? 0;
    if (p < 0.05) {
      this._glanceTarget = 0;
    } else if ((this._glanceTimer -= dt) <= 0) {
      this._glanceTimer = 0.45 + Math.random() * (1.6 - p);
      const focus = this.paranoiaFocus;
      if (focus && Math.random() < 0.5) {
        // ángulo de la sombra respecto al frente del personaje (+ a su izquierda)
        const yaw = Math.atan2(focus.x - this.position.x, focus.z - this.position.z) - this.root.rotation.y;
        this._glanceTarget = THREE.MathUtils.clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -1.2, 1.2);
      } else if (Math.random() < 0.2) {
        this._glanceTarget = 0;
      } else {
        this._glanceSide = -this._glanceSide;
        this._glanceTarget = this._glanceSide * (0.55 + Math.random() * 0.55) * Math.min(1, 0.4 + p);
      }
    }
    // giros bruscos, no suaves
    this._glance += (this._glanceTarget - this._glance) * Math.min(1, dt * 14);
  }

  /**
   * Prende un cigarrillo (o un porro con kind = 'hierba'): dura 10 minutos y cada 30 s se da una
   * calada. false si ya está fumando.
   */
  startSmoking(kind = 'cigarrillo') {
    if (this.smoking) return false;
    this.smoking = { kind, left: SMOKE_DURATION, nextPuff: FIRST_PUFF, puff: null };
    this.procedural.setSmoking?.(true, kind);
    this._realistic?.setSmoking?.(true, kind);
    return true;
  }

  stopSmoking() {
    if (!this.smoking) return;
    this.smoking = null;
    this.procedural.setSmoking?.(false);
    this._realistic?.setSmoking?.(false);
  }

  /** Lo que tiene en la mano izquierda: el cigarrillo se guarda mientras usa la pipa */
  get _holdingCigarette() { return !!this.smoking && !(this.basuco && !this.basuco.stowed); }

  _updateSmoking(dt) {
    const smoke = this.smoking;
    if (smoke) {
      if (this.action === 'dormir') { this.stopSmoking(); return; }
      smoke.left -= dt;
      if (smoke.left <= 0) {
        this.stopSmoking();
        const { emoji, name } = smokable(smoke.kind);
        emit('toast', { text: `${emoji} Se acabó el ${name}.`, type: 'info' });
        return;
      }
      // el reloj de la próxima calada corre también durante la actual: una cada 30 s exactos
      smoke.nextPuff -= dt;
      if (smoke.puff != null) {
        smoke.puff += dt;
        if (smoke.puff >= PUFF_LENGTH + PUFF.exhale) smoke.puff = null;
      } else if (smoke.nextPuff <= 0 && !this.attack && !this.isStunned && !this.action) {
        smoke.puff = 0;
        smoke.inhaled = false;
        smoke.nextPuff += PUFF_INTERVAL;
      }
      // el porro pega en cada calada (y la siguiente renueva el efecto)
      const { effect } = smokable(smoke.kind);
      if (effect && isExhaling(smoke.puff) && !smoke.inhaled) {
        smoke.inhaled = true;
        emit('substance-consumed', { id: effect });
      }
    }
    if (smoke && this._holdingCigarette) {
      const color = smokable(smoke.kind).smoke;
      this._puffs();
      // hilo de humo que sale de la brasa
      if ((this._wispTimer -= dt) <= 0 && this.character.cigaretteTip?.(this._smokeAt)) {
        this._wispTimer = 0.12;
        this._smoke.emit(this._smokeAt, { size: 0.025, grow: 0.18, life: 2.2, alpha: 0.22, color });
      }
      // la bocanada sale de la boca hacia el frente al bajar la mano
      if (isExhaling(smoke.puff) && (this._puffTimer -= dt) <= 0 && this.character.mouth?.(this._smokeAt)) {
        this._puffTimer = 0.05;
        const yaw = this.root.rotation.y;
        const fade = 1 - (smoke.puff - PUFF_LENGTH + PUFF.lower) / PUFF.exhale;
        this._smokeVelocity.set(Math.sin(yaw), -0.1, Math.cos(yaw)).multiplyScalar(0.55 * Math.max(0.2, fade));
        this._smoke.emit(this._smokeAt, { velocity: this._smokeVelocity, size: 0.05, grow: 0.45, life: 2.6, alpha: 0.38 * Math.max(0.3, fade), color });
      }
    }
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
      this._realistic.setSmoking?.(this._holdingCigarette, this.smoking?.kind);
      this._realistic.setBasuco?.(!!this.basuco && !this.basuco.stowed);
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
      if (this.attack.step + 1 < this.weapon.combo && !this._attackQueued && this._spendAttackEnergy()) this._attackQueued = true;
      return;
    }
    if (!this._spendAttackEnergy()) return;
    this._beginAttack(this.comboTimer > 0 ? this.comboStep : 0);
  }

  /** Cada golpe cuesta energía; exhausto no se puede pelear. */
  _spendAttackEnergy() {
    if (!this.stats || typeof this.stats.energia !== 'number') return true;
    if (this.stats.energia < ATTACK_ENERGY) {
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: '⚠️ ¡Estás demasiado exhausto para pelear! Necesitas descansar.', type: 'warn' }
        }));
      }
      return false;
    }
    this.stats.energia = Math.max(0, this.stats.energia - ATTACK_ENERGY);
    return true;
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
    if (hit) {
      this.audio?.playPunchHit?.(); // una sola voz por impacto, aunque alcance a varios
      // Agresión en vía pública: sube el nivel de búsqueda.
      if (this.game?.steal && typeof this.game.steal.buscado === 'number') {
        this.game.steal.buscado = Math.min(3, this.game.steal.buscado + 1);
      }
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('street-fight', { detail: { attacker: this } }));
      }
    }
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

  /** Golpe de un agresor: empujón y tambaleo breves, sin ragdoll. */
  receiveHit(direction, strength = 2) {
    if (this.ragdoll?.active) return;
    this._impactVelocity.copy(direction).setY(0);
    if (this._impactVelocity.lengthSq() < 1e-4) this._impactVelocity.set(0, 0, 1);
    this._impactVelocity.normalize().multiplyScalar(strength);
    this._impactTime = Math.max(this._impactTime, .3);
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
      this.stopSmoking(); // el cigarrillo se cae al salir volando
      this.stopBasuco();
      this._smoke?.update(dt);
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
    this._updateSmoking(dt);
    this._updateBasuco(dt);
    this._smoke?.update(dt);
    this._updateGlance(dt);

    // con la pipa en la boca se queda quieto
    const { x = 0, z = 0 } = this.basuco && !this.basuco.stowed ? {} : (this.input?.axis ?? {});
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
      smoke: this._holdingCigarette ? this.smoking : null,
      basuco: this.basuco && !this.basuco.stowed ? this.basuco.t : null,
      look: this._glance,
      t: this.time,
      load: this.load,
      dirt: this.stats ? Math.max(0, (40 - this.stats.higiene) / 40) : 0
    });
  }

  dispose() {
    this.ragdoll.clear();
    this._smoke?.dispose();
    this._realistic?.dispose?.();
    this._realisticPromise?.then(character => character.dispose?.()).catch(() => {});
    this.procedural.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this.scene.remove(this.root);
  }
}
