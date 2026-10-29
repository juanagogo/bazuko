// src/entities/Npc.js
// Persona de la calle (ambiente): personaje realista con apariencia al azar que se queda
// quieto, deambula cerca o recorre la red peatonal del distrito.
//
// Rendimiento: de lejos usa la versión liviana (cuerpo proxy de MakeHuman y piezas simplificadas);
// la completa se precarga al iniciar y se muestra al acercarse. Fuera de cámara no se dibuja ni se anima, y la animación
// se actualiza menos seguido a media distancia.
import * as THREE from 'three';
import { createRealisticCharacter, loadCatalog, normalizeReal, optionsFor, REALISTIC_SCALE } from '../character/RealisticCharacter.js';
import { randomLook, DEFAULT_LOOK } from '../character/look.js';
import { WEAPONS } from '../data/weapons.js';
import { canReachCombatTarget, resolveCombatWalk } from '../systems/CombatGeometry.js';

const any = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Distancias (m) al jugador
export const NPC_LOD = {
  fullIn: 7,       // cerca: pasa al modelo completo
  fullOut: 10,     // se aleja: vuelve al liviano (histéresis para que no parpadee)
  animEvery: 20,   // más allá: animación cada 3 cuadros
  animStop: 40     // más allá: animación congelada
};

export const NPC_HIT_REACTION_DURATION = .48;


const BOGOTA_PHRASES = [
  'Dios lo bendiga, vecino.',
  'Pilas por la 19 que está caliente.',
  '¿Tiene una monedita que le sobre?',
  'Mucho juicio, mi rey.',
  'Tome 500 para un pan, mijo.',
  'Qué frío tan berraco hace hoy.',
  'Pilas con los carros en la Caracas.',
  'Buenas tardes, vecino.'
];

const BOGOTA_DIRTY_PHRASES = [
  '¡Uff, aléjese que huele a caño!',
  'Vaya al caño a pegarse una lavada.',
  '¡Paso, paso, no se me pegue!',
  '¡Gas, qué tufo!'
];

const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.4);

// Golpes: sin muerte ni desaparición. A 0 de salud el peatón cae, queda tendido y se levanta huyendo.
export const NPC_HEALTH = 100;
export const NPC_COMBAT = {
  stagger: 0.28,   // s de sacudón tras cada golpe (no camina; el golpe lo empuja)
  flee: 5,         // s de huida veloz tras recibir un golpe
  fall: 0.4,       // s en caer
  downMin: 6,      // s mínimos tendido
  downExtra: 2,    // + hasta tantos s al azar
  rise: 0.6,       // s en levantarse
  riseFlee: 6,     // s de huida al levantarse
  counterWindup: .35,
  counterActive: .1,
  counterRecovery: .22,
  counterRange: 1.75
};
const DEFENSE_PHRASES = [
  '¡A mí no me viene a montar la perseguidora, ñero!',
  '¡Tome pa\' que lleve, respete a la gente!',
  '¡Aquí no le vamos a copiar, atrevido!'
];
const HIT_PHRASES = [
  '¡Uy qué le pasa, ñero loco!',
  '¡Ayúdenme, me están atracando!',
  '¡Policía, policía!',
  '¡Socio, no me pegue, tome esto!',
  '¡Qué boleta, bájese de la nube!'
];
const easeInOut = (x) => x * x * (3 - 2 * x);

/** Apariencia al azar; `gastada` prefiere ropa vieja (El Cartucho). */
export async function randomStreetLook({ gastada = false } = {}) {
  const catalog = await loadCatalog();
  const sexo = Math.random() < 0.72 ? 'hombre' : 'mujer';
  const ropaOpts = optionsFor(catalog, 'ropa', sexo).map((o) => o.id);
  const viejas = ropaOpts.filter((id) => ['rota', 'saco', 'chaqueta', 'buzo', 'overol', 'sudadera'].includes(id));
  const look = randomLook(DEFAULT_LOOK);
  look.piel = 1 + Math.floor(Math.random() * 5);
  look.desgaste = gastada ? 2 : 0;
  look.real = normalizeReal(catalog, {
    sexo,
    edad: any(['joven', 'adulto', 'adulto', 'mayor']),
    pelo: any(optionsFor(catalog, 'pelo', sexo)).id,
    barba: sexo === 'hombre' && Math.random() < 0.7 ? any(['descuidada', 'candado', 'larga', 'bigote']) : 'ninguna',
    ropa: gastada && viejas.length ? any(viejas) : any(ropaOpts),
    calzado: gastada ? any(['tenis-rotos', 'tenis-rotos', 'botas']) : any(optionsFor(catalog, 'calzado', sexo)).id
  });
  return look;
}

export class Npc {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position
   * @param {{ wander?: number, facing?: number, isWalkable?: (x:number, z:number) => boolean, navigation?: object, groundHeight?: (x:number, z:number) => number, speed?: number, look?: object, gastada?: boolean }} opts
   */
  constructor(scene, position, opts = {}) {
    this.scene = scene;
    this.home = position.clone();
    this.position = position.clone();
    this.wander = opts.wander ?? 0;
    this.navigation = opts.navigation ?? null;
    this.groundHeight = opts.groundHeight ?? (() => this.home.y);
    this.walkSpeed = opts.speed ?? (0.85 + Math.random() * 0.45);
    this.route = [];
    this.routeIndex = 0;
    this._direction = new THREE.Vector3();
    this._nextPosition = new THREE.Vector3();
    this.isWalkable = opts.isWalkable ?? (() => true);
    this.root = new THREE.Group();
    this.root.position.copy(position);
    this.root.rotation.y = opts.facing ?? Math.random() * Math.PI * 2;
    scene.add(this.root);
    this.target = null;
    this.wait = this.navigation ? 0 : Math.random() * 6;
    this.moving = false;
    this.animAcc = 0;
    this.animationBudget = 1;
    this.frame = Math.floor(Math.random() * 3); // reparte los cuadros de animación entre NPC
    this.lodChar = null;   // liviano (siempre)
    this.fullChar = null;  // completo (precargado; se muestra al acercarse)
    this._fullLoading = null;
    this.character = null; // el que se ve ahora
    this.isSplatted = false;
    this.splatTimer = 0;
    this.fleeTimer = 0;
    this.fleeDir = new THREE.Vector3();
    this.splatMesh = null;
    this._bubbleEl = null;
    this._bubbleTimer = 0;
    this._lastSpokenTime = 0;
    this._projPos = new THREE.Vector3();
    this.umbrella = null;
    this.panicTimer = 0;       // s restantes de pánico: sin charla espontánea mientras dura
    this.panicDir = null;
    this.state = 'idle';
    this._ownsLocomotionState = this.constructor === Npc;
    this.action = null;
    this.actionProgress = 0;
    this._hitReactionRemaining = 0;
    this._punchFacing = this.root.rotation.y;
    this.maxHealth = NPC_HEALTH;
    this.health = NPC_HEALTH;
    this.koState = null;       // null | 'down' (cayendo o tendido) | 'rising'
    this.koTimer = 0;
    this._koBlend = 0;         // 0 de pie .. 1 tendido
    this.staggerTimer = 0;
    this._knockVel = new THREE.Vector3();
    this._lastHit = new THREE.Vector3(0, 0, 1);
    this.looted = false;       // una recompensa por la vida del NPC, también después de un KO
    this._acceptedAttacks = new WeakMap();
    this._anonymousAttacks = new Set();
    this._counter = null;
    this._counterPose = null;
    this._defenseUsed = false;
    this._combatCollisions = null;

    this.ready = (async () => {
      this.look = opts.look ?? await randomStreetLook({ gastada: opts.gastada });
      this.lodChar = await createRealisticCharacter(this.look, { lod: true });
      if (this._disposed) { this.lodChar.dispose?.(); return; }
      this._show(this.lodChar);
      // arranca cada uno en otro punto de la animación para que no se muevan al unísono
      this.character.update(Math.random() * 3, { speed: 0 });
    })().catch((e) => { this.loadError = e; console.warn('[Npc] no se pudo crear', e); });
  }

  async preload() {
    await this.ready;
    if (this.loadError) throw this.loadError;
    await this._loadFull();
  }

  _loadFull() {
    return this._fullLoading ??= createRealisticCharacter(this.look, { lod: false })
      .then(c => { if (this._disposed) c.dispose?.(); else this.fullChar = c; });
  }

  get isKnockedOut() { return !!this.koState; }

  _show(char) {
    if (this.character === char) return;
    if (this.character) {
      this.root.remove(this.character.group);
      this.character.group.rotation.x = 0; // el modelo que sale no conserva la pose tendida
      this.character.group.position.y = 0;
    }
    this.character = char;
    this.root.add(char.group);
    this._applyPose();
  }

  /** Solo KO: la reacción de pie vive en ActionPose y no se inclina dos veces. */
  _applyPose() {
    const group = this.character?.group;
    if (!group) return;
    const lie = easeInOut(this._koBlend);
    group.rotation.x = lie === 0 ? 0 : -lie * Math.PI / 2;
    group.position.y = lie * 0.1; // tendido de espaldas: el cuerpo apoya sobre el suelo
  }

  /** Cambia de detalle según distancia; permite carga diferida fuera del arranque normal. */
  _updateDetail(dist) {
    if (dist < NPC_LOD.fullIn) {
      if (this.fullChar) this._show(this.fullChar);
      else if (!this._fullLoading) {
        this._loadFull().catch((e) => console.warn('[Npc] sin modelo completo', e));
      }
    } else if (dist > NPC_LOD.fullOut && this.lodChar) {
      this._show(this.lodChar);
    }
  }

  _pickTarget() {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * this.wander;
      const x = this.home.x + Math.cos(a) * r;
      const z = this.home.z + Math.sin(a) * r;
      if (this.isWalkable(x, z)) return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  hitByPoop(projectileOrigin = null) {
    this.isSplatted = true;
    this.splatTimer = 12;
    if (!this.koState) this.fleeTimer = 8;
    this.target = null;
    this.route = [];

    // Dirección de huida: alejarse del origen del lanzamiento
    if (projectileOrigin) {
      this.fleeDir.copy(this.position).sub(projectileOrigin);
      this.fleeDir.y = 0;
      if (this.fleeDir.lengthSq() < 0.001) this.fleeDir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      this.fleeDir.normalize();
    } else {
      const angle = Math.random() * Math.PI * 2;
      this.fleeDir.set(Math.cos(angle), 0, Math.sin(angle));
    }

    // Marca visual de popó en el NPC
    if (!this.splatMesh) {
      const splatGeo = new THREE.SphereGeometry(0.14, 6, 6);
      splatGeo.scale(1.2, 0.4, 0.9);
      const splatMat = new THREE.MeshStandardMaterial({
        color: 0x3d2008,
        roughness: 0.95
      });
      this.splatMesh = new THREE.Mesh(splatGeo, splatMat);
      this.splatMesh.position.set(0, 1.1, 0.18);
      this.root.add(this.splatMesh);
    }

    // Gritos y quejas de los peatones en Bogotá
    const screams = [
      '¡¡AY QUÉ ASCO, ME CAYÓ UN MOJÓN!! 🤮',
      '¡¡GONORREA COCHINO, ME TIRÓ POPÓ!! 🤬',
      '¡¡POLICÍA, UN LOCO ME ESTÁ TIRANDO MIERDA!! 🚨',
      '¡¡GAS, QUÉ COCHINADA TAN HIJUEPUTA!! 🤢',
      '¡¡QUÉ PESTILENCIA, AUXILIO ME EMBARRARON!! 🤮',
      '¡¡MALDITO ENFERMO, ME LAS VAS A PAGAR!! 🏃‍♂️💨'
    ];
    const msg = screams[Math.floor(Math.random() * screams.length)];
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: msg, type: 'warn' } }));
      // 35% de probabilidad de soltar monedas del pánico
      if (Math.random() < 0.35) {
        const droppedMoney = 500 * (1 + Math.floor(Math.random() * 4));
        window.dispatchEvent(new CustomEvent('npc-dropped-loot', {
          detail: { position: this.position.clone(), amount: droppedMoney }
        }));
      }
    }
  }

  _walk(dt) {
    this.moving = false;
    if (this.koState || this.staggerTimer > 0) return; // noqueado o sacudido: no camina

    // Si fue impactado por popó: huye despavorido a gran velocidad
    if (this.fleeTimer > 0) {
      this.fleeTimer = Math.max(0, this.fleeTimer - dt);
      const speed = this.walkSpeed * 2.4;
      const step = speed * dt;
      const next = this._nextPosition.copy(this.position).addScaledVector(this.fleeDir, step);
      if (this.isWalkable(next.x, next.z)) {
        next.y = this.groundHeight(next.x, next.z);
        this.position.copy(next);
        this.moving = true;
      } else {
        // Esquiva paredes cambiando de rumbo
        const oldX = this.fleeDir.x;
        this.fleeDir.x = -this.fleeDir.z;
        this.fleeDir.z = oldX;
      }
      let diff = Math.atan2(this.fleeDir.x, this.fleeDir.z) - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += diff * Math.min(1, dt * 10);
      return;
    }

    if (!this.navigation && this.wander <= 0) return;
    if (!this.target) {
      if ((this.wait -= dt) > 0) return;
      if (this.navigation) {
        this.route = this.navigation.createRoute(this.position);
        this.routeIndex = 0;
        this.target = this.route[0] ?? null;
      } else {
        this.target = this._pickTarget();
      }
      if (!this.target) { this.wait = 2; return; }
    }
    if (this.target) {
      const d = this._direction.copy(this.target).sub(this.position);
      d.y = 0;
      const dist = d.length();
      if (dist < 0.001) {
        this._advanceTarget();
        return;
      }
      const step = Math.min(dist, this.walkSpeed * dt);
      const next = this._nextPosition.copy(this.position).addScaledVector(d.normalize(), step);
      if (!this.isWalkable(next.x, next.z)) {
        this.target = null;
        this.route = [];
        this.wait = 0.5;
        return;
      }
      next.y = this.groundHeight(next.x, next.z);
      this.position.copy(next);
      this.moving = step > 0;
      let diff = Math.atan2(d.x, d.z) - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += diff * Math.min(1, dt * 5);
      if (step >= dist) this._advanceTarget();
    }
  }

  _advanceTarget() {
    this.target = this.navigation ? (this.route[++this.routeIndex] ?? null) : null;
    if (!this.target) this.wait = this.navigation ? 1 + Math.random() * 3 : 3 + Math.random() * 8;
  }

  /**
   * @param {number} dt
   * @param {{ player?: THREE.Vector3, frustum?: THREE.Frustum }} ctx
   */
  update(dt, ctx = {}) {
    const reactionTime = Math.min(dt, this._hitReactionRemaining);
    this._updateReaction(dt);
    const countering = this._updateCounterAttack(Math.max(0, dt - reactionTime));
    if (!this.koState && this._hitReactionRemaining > 0) {
      this.action = 'recibirGolpe';
      if (this._ownsLocomotionState) this.state = 'recibirGolpe';
      this.actionProgress = 1 - this._hitReactionRemaining / NPC_HIT_REACTION_DURATION;
      this.moving = false;
      let turn = this._punchFacing - this.root.rotation.y;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      this.root.rotation.y += turn * Math.min(1, dt * 12);
    } else if (countering) {
      this.action = 'golpear';
      this.moving = false;
      if (this._ownsLocomotionState) this.state = 'defend';
    } else {
      if (this.action === 'recibirGolpe') { this.action = null; this.actionProgress = 0; }
      if (!this.koState && dt > reactionTime) this._walk(dt - reactionTime);
      else this.moving = false;
      if (this._ownsLocomotionState) this.state = this.koState ?? (this.moving ? (this.fleeTimer > 0 ? 'flee' : 'walk') : 'idle');
    }
    this.root.position.copy(this.position);

    if (this.splatTimer > 0) {
      this.splatTimer -= dt;
      if (this.splatTimer <= 0) {
        this.isSplatted = false;
        if (this.splatMesh) {
          this.root.remove(this.splatMesh);
          this.splatMesh.geometry?.dispose?.();
          this.splatMesh.material?.dispose?.();
          this.splatMesh = null;
        }
      }
    }

    if (!this.character) return;
    this._applyPose();

    const dist = ctx.player ? Math.hypot(this.position.x - ctx.player.x, this.position.z - ctx.player.z) : 0;
    // fuera de cámara: ni se dibuja ni se anima
    _sphere.center.set(this.position.x, this.position.y + 0.9, this.position.z);
    const onScreen = !ctx.frustum || ctx.frustum.intersectsSphere(_sphere);
    this.root.visible = onScreen;
    if (!onScreen) { this.animAcc += dt; return; }

    this._updateDetail(dist);
    this._updateSpeech(dt, ctx);
    this._updateUmbrella((ctx.isRaining ?? false) && !this.koState);

    // Proyectar burbuja flotante a pantalla
    if (this._bubbleEl && ctx.camera && typeof window !== 'undefined') {
      this._projPos.set(this.position.x, this.position.y + 2.05, this.position.z).project(ctx.camera);
      if (this._projPos.z < 1) {
        const sx = (this._projPos.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-(this._projPos.y * 0.5) + 0.5) * window.innerHeight;
        this._bubbleEl.style.left = `${sx}px`;
        this._bubbleEl.style.top = `${sy}px`;
        this._bubbleEl.style.display = 'block';
      } else {
        this._bubbleEl.style.display = 'none';
      }
    }

    this.animAcc += dt;
    this.frame++;
    if (dist > NPC_LOD.animStop) return; // navegación activa, pose lejana congelada
    if (this.koState === 'down' && this._koBlend >= 1) return; // tendido: pose fija, sin animar
    const budget = ctx.animationBudget ?? this.animationBudget;
    const interval = dist > NPC_LOD.animEvery ? .1 * budget : budget > 1 ? budget / 60 : 0;
    if (interval && this.animAcc < interval) return;
    this.character.update(Math.min(this.animAcc, 0.2), {
      speed: this.moving ? this.walkSpeed * (this.fleeTimer > 0 ? 2.4 : 1) / REALISTIC_SCALE : 0,
      running: this.moving && this.fleeTimer > 0,
      ...this.poseParams,
      state: this.state, action: this.action, actionProgress: this.actionProgress,
      attack: this._counterPose ?? this.poseParams?.attack
    });
    this._applyPose();
    this.animAcc = 0;
  }



  /** Compatibilidad: cada llamada representa un contacto distinto, sin inmunidad global. */
  takePunch(attacker) {
    if (!attacker?.position) return false;
    return this.takeHit({ damage: WEAPONS.punos.damage, knockback: WEAPONS.punos.knockback, attacker, weapon: 'punos' });
  }

  _acceptAttackId(attacker, attackId) {
    if (attackId === null || attackId === undefined) return true;
    const owner = attacker && (typeof attacker === 'object' || typeof attacker === 'function');
    let accepted = owner ? this._acceptedAttacks.get(attacker) : this._anonymousAttacks;
    if (!accepted) { accepted = new Set(); this._acceptedAttacks.set(attacker, accepted); }
    if (accepted.has(attackId)) return false;
    accepted.add(attackId);
    return true;
  }

  /** La defensa se anuncia y conecta después; alejarse o ponerse tras una pared la evita. */
  _counterAttack(attacker) {
    if (this._defenseUsed || this.koState || typeof attacker?.stats?.salud !== 'number') return;
    this._defenseUsed = true;
    if (this.look?.real?.edad !== 'adulto' && Math.random() >= .35) return;
    this._counter = { attacker, phase: 'wait', elapsed: 0, struck: false, damage: Math.floor(10 + Math.random() * 7) };
    this._counterPose = null;
  }

  _clearCounterAttack() {
    if (this._counterPose && this.action === 'golpear') this.action = null;
    this._counter = null;
    this._counterPose = null;
  }

  _updateCounterAttack(dt) {
    const counter = this._counter;
    if (!counter) return false;
    const attacker = counter.attacker;
    if (this._disposed || this.koState || !attacker?.position || attacker._disposed || attacker.stats?.salud <= 0) {
      this._clearCounterAttack(); return false;
    }
    // Cada nuevo golpe interrumpe la preparación; nunca devuelve daño durante el sacudón.
    if (this._hitReactionRemaining > 0) {
      if (counter.struck) { this._clearCounterAttack(); return false; }
      counter.phase = 'wait'; counter.elapsed = 0; this._counterPose = null;
      return false;
    }
    if (counter.phase === 'wait') {
      counter.phase = 'windup'; counter.elapsed = 0;
      this.say(DEFENSE_PHRASES[Math.floor(Math.random() * DEFENSE_PHRASES.length)], 4);
      this._counterPose = { weapon: 'punos', step: 0, phase: 'windup', progress: 0,
        timing: { windup: NPC_COMBAT.counterWindup, active: NPC_COMBAT.counterActive, recovery: NPC_COMBAT.counterRecovery } };
    }
    let turn = Math.atan2(attacker.position.x - this.position.x, attacker.position.z - this.position.z) - this.root.rotation.y;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    this.root.rotation.y += turn * Math.min(1, dt * 12);
    counter.elapsed += dt;
    if (counter.phase === 'windup' && counter.elapsed >= NPC_COMBAT.counterWindup) {
      counter.phase = 'active'; counter.elapsed -= NPC_COMBAT.counterWindup;
      counter.struck = true;
      if (canReachCombatTarget({ from: this.position, to: attacker.position,
        collisions: this.collisions ?? attacker._lastCollisions, getWaterInfo: this.getWaterInfo,
        maxDistance: NPC_COMBAT.counterRange,
        fromInWater: false, toInWater: !!attacker.inWater })) {
        attacker.stats.salud = Math.max(0, attacker.stats.salud - counter.damage);
        attacker.audio?.playPunchHit?.();
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('toast', {
            detail: { text: `¡El transeúnte se defendió! (-${counter.damage} de salud)`, type: 'warn' }
          }));
        }
      }
    }
    if (counter.phase === 'active' && counter.elapsed >= NPC_COMBAT.counterActive) {
      counter.phase = 'recovery'; counter.elapsed -= NPC_COMBAT.counterActive;
    }
    if (counter.phase === 'recovery' && counter.elapsed >= NPC_COMBAT.counterRecovery) {
      this._clearCounterAttack(); return false;
    }
    this._counterPose.phase = counter.phase;
    const duration = counter.phase === 'windup' ? NPC_COMBAT.counterWindup
      : counter.phase === 'active' ? NPC_COMBAT.counterActive : NPC_COMBAT.counterRecovery;
    this._counterPose.progress = Math.min(1, counter.elapsed / duration);
    return true;
  }

  /**
   * false rechaza el contacto; un número >=0 lo acepta y es su recompensa.
   * Los IDs se deduplican por atacante, sin bloquear pasos legítimos del combo.
   */
  takeHit({ damage = 10, dir = null, knockback = 0, attacker = null, weapon = 'punos', attackId = null, id = null } = {}) {
    if (this._disposed || this.koState || !Number.isFinite(damage) || damage <= 0) return false;
    if (!this._acceptAttackId(attacker, attackId ?? id)) return false;
    let dx = dir?.x ?? 0, dz = dir?.z ?? 0;
    if (!dir && attacker?.position) { dx = this.position.x - attacker.position.x; dz = this.position.z - attacker.position.z; }
    const len = Math.hypot(dx, dz);
    if (Number.isFinite(len) && len > .0001) this._lastHit.set(dx / len, 0, dz / len);
    this.panicDir = { x: this._lastHit.x, z: this._lastHit.z };
    this._punchFacing = Math.atan2(-this._lastHit.x, -this._lastHit.z);
    this._combatCollisions = attacker?._lastCollisions ?? this._combatCollisions;
    this.health = Math.max(0, this.health - damage);
    this.target = null; this.route = []; this.routeIndex = 0; this.wait = 0;
    this.staggerTimer = NPC_COMBAT.stagger;
    this._hitReactionRemaining = NPC_HIT_REACTION_DURATION;
    this.action = 'recibirGolpe'; this.actionProgress = 0; this.moving = false;
    if (this._ownsLocomotionState) this.state = 'recibirGolpe';
    this._knockVel.copy(this._lastHit).multiplyScalar((Number.isFinite(knockback) ? Math.max(0, knockback) : 0) * 2 / NPC_COMBAT.stagger);
    if (this.health <= 0) this._startKnockout();
    else {
      this.fleeDir.copy(this._lastHit);
      this.fleeTimer = Math.max(this.fleeTimer, NPC_COMBAT.flee);
      this.panicTimer = NPC_COMBAT.flee;
      if (this._bubbleTimer <= 0) this.say(HIT_PHRASES[Math.floor(Math.random() * HIT_PHRASES.length)], 4);
    }
    if (this.looted) return 0;
    this.looted = true;
    this._counterAttack(attacker);
    const dropMoney = 200 + Math.floor(Math.random() * 400);
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      const verb = WEAPONS[weapon]?.hitVerb ?? 'Golpe';
      const end = this.koState ? 'quedó tendido' : 'intenta defenderse o huir';
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: `${verb}: el transeúnte soltó ${dropMoney} y ${end}.`, kind: 'info' }
      }));
    }
    return dropMoney;
  }

  _startKnockout() {
    this._clearCounterAttack();
    this._hitReactionRemaining = 0;
    this.action = null;
    this.actionProgress = 0;
    this.koState = 'down';
    this.koTimer = NPC_COMBAT.downMin + Math.random() * NPC_COMBAT.downExtra;
    this.fleeTimer = 0;
    this.panicTimer = 0;
    if (this._bubbleEl) { this._bubbleEl.remove(); this._bubbleEl = null; }
    this._bubbleTimer = 0;
  }

  /** Sacudón, caída, tendido y levantada; corre aunque el peatón esté fuera de cámara. */
  _updateReaction(dt) {
    this._hitReactionRemaining = Math.max(0, this._hitReactionRemaining - dt);
    if (this.panicTimer > 0) this.panicTimer = Math.max(0, this.panicTimer - dt);
    if (this.staggerTimer > 0) {
      const elapsed = Math.min(dt, this.staggerTimer);
      // Integral exacta del empuje lineal: no recorre más a 10 FPS que a 60 FPS.
      const step = elapsed * (this.staggerTimer - elapsed / 2) / NPC_COMBAT.stagger;
      if (this._knockVel.x || this._knockVel.z) {
        this._nextPosition.copy(this.position).addScaledVector(this._knockVel, step);
        resolveCombatWalk({ from: this.position, to: this._nextPosition,
          groundHeight: this.groundHeight, isWalkable: this.isWalkable,
          getWaterInfo: this.getWaterInfo,
          collisions: this.collisions ?? this._combatCollisions }, this.position);
      }
      this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    }

    if (this.koState === 'down') {
      if (this._koBlend < 1) this._koBlend = Math.min(1, this._koBlend + dt / NPC_COMBAT.fall);
      else if ((this.koTimer -= dt) <= 0) this.koState = 'rising';
    } else if (this.koState === 'rising') {
      this._koBlend = Math.max(0, this._koBlend - dt / NPC_COMBAT.rise);
      if (this._koBlend <= 0) this._recover();
    }
  }

  _recover() {
    this.koState = null;
    this.health = this.maxHealth;
    // Recuperarse no crea otra recompensa ni otro intento de defensa.
    this.fleeDir.copy(this._lastHit);
    this.fleeTimer = NPC_COMBAT.riseFlee;
    this.panicTimer = NPC_COMBAT.riseFlee;
  }

  say(text, duration = 3.5) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('npc-bubbles-container') ?? document.body;
    if (!container) return;

    if (this._bubbleEl) this._bubbleEl.remove();

    this._bubbleEl = document.createElement('div');
    this._bubbleEl.className = 'npc-bubble';
    this._bubbleEl.textContent = text;
    this._bubbleTimer = duration;
    container.appendChild(this._bubbleEl);
  }

  _updateSpeech(dt, ctx) {
    if (this._bubbleTimer > 0) {
      this._bubbleTimer -= dt;
      if (this._bubbleTimer <= 0 && this._bubbleEl) {
        this._bubbleEl.remove();
        this._bubbleEl = null;
      }
    }

    if (!ctx.player || this.koState || this.action === 'recibirGolpe' || this._counter || this.panicTimer > 0) return;
    const now = performance.now();
    const dist = Math.hypot(this.position.x - ctx.player.x, this.position.z - ctx.player.z);

    if (dist < 2.8 && (now - this._lastSpokenTime > 14000)) {
      this._lastSpokenTime = now;
      if (Math.random() < 0.5) {
        const isDirty = (ctx.hygiene ?? 100) < 30;
        const list = isDirty ? BOGOTA_DIRTY_PHRASES : BOGOTA_PHRASES;
        const phrase = list[Math.floor(Math.random() * list.length)];
        this.say(phrase);
      }
    }
  }

  _updateUmbrella(isRaining) {
    if (isRaining) {
      if (!this.umbrella) {
        const group = new THREE.Group();
        const domeMat = new THREE.MeshStandardMaterial({ color: 0x181a20, roughness: 0.65 });
        const domeGeo = new THREE.ConeGeometry(0.68, 0.22, 10);
        const dome = new THREE.Mesh(domeGeo, domeMat);
        dome.position.y = 1.95;
        group.add(dome);

        const stickMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 });
        const stickGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6);
        const stick = new THREE.Mesh(stickGeo, stickMat);
        stick.position.set(0.18, 1.55, 0.1);
        group.add(stick);

        this.umbrella = group;
        this.root.add(this.umbrella);
      }
      this.umbrella.visible = true;
    } else if (this.umbrella) {
      this.umbrella.visible = false;
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._clearCounterAttack();
    if (this._bubbleEl) {
      this._bubbleEl.remove();
      this._bubbleEl = null;
    }
    if (this.umbrella) {
      this.root.remove(this.umbrella);
      this.umbrella = null;
    }
    this.lodChar?.dispose?.();
    this.fullChar?.dispose?.();
    if (this.splatMesh) {
      this.root.remove(this.splatMesh);
      this.splatMesh.geometry?.dispose?.();
      this.splatMesh.material?.dispose?.();
      this.splatMesh = null;
    }
    this.scene.remove(this.root);
  }
}
