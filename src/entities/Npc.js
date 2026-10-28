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
import { PUNCH } from '../data/combat.js';

const any = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Distancias (m) al jugador
export const NPC_LOD = {
  fullIn: 7,       // cerca: pasa al modelo completo
  fullOut: 10,     // se aleja: vuelve al liviano (histéresis para que no parpadee)
  animEvery: 20,   // más allá: animación cada 3 cuadros
  animStop: 40     // más allá: animación congelada
};

export const NPC_COMBAT = {
  impactDuration: 0.4,
  fleeDuration: 5,
  guardDuration: 3,
  freezeDuration: 3,
  counterDelay: 0.65,
  counterRange: 1.65,
  counterDamage: 6
};

const TEMPERAMENTS = ['evasivo', 'defensivo', 'inmovil'];
const REACTION_PHRASES = {
  evasivo: ['¡Auxilio, me están pegando!', '¡Socio, no me pegue!'],
  defensivo: ['¡Quieto ahí! ¡No me vuelva a pegar!', '¡Aléjese, que me defiendo!'],
  inmovil: ['¡No me haga daño!', '¡Por favor, déjeme tranquilo!']
};


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
   * @param {{ wander?: number, facing?: number, isWalkable?: (x:number, z:number) => boolean, navigation?: object, groundHeight?: (x:number, z:number) => number, speed?: number, look?: object, gastada?: boolean, temperament?: 'evasivo'|'defensivo'|'inmovil' }} opts
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
    this.movementSpeed = 0;
    this.running = false;
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
    // Se elige una sola vez y no depende del cuerpo, el sexo ni la ropa.
    const temperamentRoll = Math.random();
    this.temperament = TEMPERAMENTS.includes(opts.temperament) ? opts.temperament
      : temperamentRoll < 0.5 ? 'evasivo' : temperamentRoll < 0.8 ? 'defensivo' : 'inmovil';
    this.combatReaction = null;
    this.combatAction = null;
    this.combatActionProgress = 0;
    this._punchLootDropped = false;

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

  _show(char) {
    if (this.character === char) return;
    if (this.character) this.root.remove(this.character.group);
    this.character = char;
    this.root.add(char.group);
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
    // La huida por un proyectil sustituye cualquier respuesta cuerpo a cuerpo.
    this.combatReaction = null;
    this.combatAction = null;
    this.combatActionProgress = 0;
    this.isSplatted = true;
    this.splatTimer = 12;
    this.fleeTimer = 8;
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
    this.movementSpeed = 0;
    this.running = false;

    // La huida por un golpe y la de los proyectiles comparten transitabilidad.
    if (this.fleeTimer > 0) {
      const speed = this.walkSpeed * 2.4;
      const step = speed * Math.min(dt, this.fleeTimer);
      this.fleeTimer = Math.max(0, this.fleeTimer - dt);
      const angle = Math.atan2(this.fleeDir.x, this.fleeDir.z);
      // Busca una salida sin atravesar paredes ni cortar esquinas de la red.
      for (const turn of [0, 0.6, -0.6, Math.PI / 2, -Math.PI / 2, Math.PI]) {
        const next = this._nextPosition.set(
          this.position.x + Math.sin(angle + turn) * step, this.position.y,
          this.position.z + Math.cos(angle + turn) * step
        );
        if (!this._canTraverseTo(next.x, next.z)) continue;
        next.y = this.groundHeight(next.x, next.z);
        this.position.copy(next);
        this.fleeDir.set(Math.sin(angle + turn), 0, Math.cos(angle + turn));
        this.moving = step > 0;
        this.movementSpeed = this.moving ? speed : 0;
        this.running = this.moving;
        break;
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
      this.movementSpeed = this.moving ? this.walkSpeed : 0;
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

  /** Comprueba todo el trayecto corto, también los cambios de tile junto a esquinas. */
  _canTraverseTo(x, z) {
    const dx = x - this.position.x, dz = z - this.position.z;
    const samples = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
    let previousNode = this.navigation?.nodeAt?.(this.position.x, this.position.z);
    for (let i = 1; i <= samples; i++) {
      const px = this.position.x + dx * i / samples, pz = this.position.z + dz * i / samples;
      if (!this.isWalkable(px, pz)) return false;
      if (this.navigation?.nodeAt) {
        const node = this.navigation.nodeAt(px, pz);
        if (node < 0 || (previousNode >= 0 && node !== previousNode &&
          !this.navigation.nodes[previousNode]?.neighbors.includes(node))) return false;
        previousNode = node;
      }
    }
    return true;
  }

  _faceAttacker(dt) {
    const position = this.combatReaction?.attacker?.position;
    if (!position) return;
    let diff = Math.atan2(position.x - this.position.x, position.z - this.position.z) - this.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.root.rotation.y += diff * Math.min(1, dt * 12);
  }

  _canCounter(attacker) {
    if (!attacker?.position || typeof attacker.receivePunch !== 'function') return false;
    const position = attacker.position;
    return Math.abs(position.y - this.position.y) <= PUNCH.verticalTolerance &&
      Math.hypot(position.x - this.position.x, position.z - this.position.z) <= NPC_COMBAT.counterRange &&
      this._canTraverseTo(position.x, position.z);
  }

  _finishCombatReaction() {
    this.combatReaction = null;
    this.combatAction = null;
    this.combatActionProgress = 0;
    this.target = null;
    this.route = [];
    this.wait = 0.5;
  }

  /** Devuelve si puede seguir caminando; las fases inmóviles siguen simulándose fuera de cámara. */
  _updateCombatReaction(dt) {
    const reaction = this.combatReaction;
    this.combatAction = null;
    this.combatActionProgress = 0;
    if (!reaction) return true;
    reaction.elapsed += dt;
    if (reaction.phase === 'impact') {
      this.combatAction = 'recibirGolpe';
      this.combatActionProgress = Math.min(1, reaction.elapsed / NPC_COMBAT.impactDuration);
      if (reaction.elapsed >= NPC_COMBAT.impactDuration) {
        reaction.elapsed = 0;
        if (reaction.temperament === 'evasivo') {
          reaction.phase = 'flee';
          this.fleeTimer = NPC_COMBAT.fleeDuration;
          const origin = reaction.attacker?.position;
          this.fleeDir.copy(this.position).sub(origin ?? this.home).setY(0);
          if (this.fleeDir.lengthSq() < 0.001) this.fleeDir.set(0, 0, 1);
          this.fleeDir.normalize();
        } else {
          reaction.phase = reaction.temperament === 'defensivo' ? 'guard' : 'freeze';
          reaction.remaining = reaction.temperament === 'defensivo' ? NPC_COMBAT.guardDuration : NPC_COMBAT.freezeDuration;
        }
      }
      return false;
    }
    if (reaction.phase === 'flee') {
      if (this.fleeTimer <= 0) this._finishCombatReaction();
      return true;
    }
    reaction.remaining -= dt;
    this._faceAttacker(dt);
    if (reaction.phase === 'counter') {
      this.combatAction = 'golpear';
      this.combatActionProgress = Math.min(1, reaction.elapsed / PUNCH.duration);
      if (!reaction.counterImpacted && reaction.elapsed >= PUNCH.impactTime) {
        reaction.counterImpacted = true;
        if (this._canCounter(reaction.attacker)) reaction.attacker.receivePunch(this, NPC_COMBAT.counterDamage);
      }
      if (reaction.elapsed >= PUNCH.duration) {
        reaction.phase = 'guard';
        reaction.elapsed = 0;
      }
    } else {
      this.combatAction = reaction.phase === 'guard' ? 'defender' : 'asustado';
      if (reaction.remaining <= 0) this._finishCombatReaction();
      else if (reaction.phase === 'guard' && !reaction.counterUsed &&
        reaction.elapsed >= NPC_COMBAT.counterDelay && this._canCounter(reaction.attacker)) {
        reaction.phase = 'counter';
        reaction.elapsed = 0;
        reaction.counterUsed = true;
        this.combatAction = 'golpear';
      }
    }
    return false;
  }

  /**
   * @param {number} dt
   * @param {{ player?: THREE.Vector3, frustum?: THREE.Frustum }} ctx
   */
  update(dt, ctx = {}) {
    this.moving = false;
    this.movementSpeed = 0;
    this.running = false;
    if (this._updateCombatReaction(dt)) this._walk(dt);
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

    const dist = ctx.player ? Math.hypot(this.position.x - ctx.player.x, this.position.z - ctx.player.z) : 0;
    // fuera de cámara: ni se dibuja ni se anima
    _sphere.center.set(this.position.x, this.position.y + 0.9, this.position.z);
    const onScreen = !ctx.frustum || ctx.frustum.intersectsSphere(_sphere);
    this.root.visible = onScreen;
    this._updateSpeech(dt, ctx, onScreen && !!this.character);
    if (!this.character) return;
    if (!onScreen) {
      if (this._bubbleEl) this._bubbleEl.style.display = 'none';
      this.animAcc += dt;
      return;
    }

    this._updateDetail(dist);
    this._updateUmbrella(ctx.isRaining ?? false);

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
    const budget = ctx.animationBudget ?? this.animationBudget;
    const interval = dist > NPC_LOD.animEvery ? .1 * budget : budget > 1 ? budget / 60 : 0;
    if (interval && this.animAcc < interval) return;
    this.character.update(Math.min(this.animAcc, 0.2), {
      speed: this.movementSpeed / REALISTIC_SCALE, running: this.running,
      action: this.combatAction, actionProgress: this.combatActionProgress
    });
    this.animAcc = 0;
  }



  takePunch(attacker) {
    if (this._disposed) return 0;
    const counterUsed = this.combatReaction?.counterUsed ?? false;
    this.combatReaction = { phase: 'impact', elapsed: 0, attacker, temperament: this.temperament, counterUsed };
    this.combatAction = 'recibirGolpe';
    this.combatActionProgress = 0;
    this.fleeTimer = 0;
    this.target = null;
    this.route = [];
    this.say(any(REACTION_PHRASES[this.temperament]), 4);

    const dropMoney = !this._punchLootDropped && this.temperament === 'evasivo'
      ? 200 + Math.floor(Math.random() * 400) : 0;
    this._punchLootDropped = true;
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      const response = this.temperament === 'evasivo' ? 'intenta huir'
        : this.temperament === 'defensivo' ? 'se prepara para defenderse' : 'se queda paralizado y se cubre';
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: `💥 El transeúnte recibió el golpe y ${response}.${dropMoney ? ` Soltó ${dropMoney} pesos.` : ''}`, type: 'info' }
      }));
    }
    return dropMoney;
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

  _updateSpeech(dt, ctx, allowAmbient = true) {
    if (this._bubbleTimer > 0) {
      this._bubbleTimer -= dt;
      if (this._bubbleTimer <= 0 && this._bubbleEl) {
        this._bubbleEl.remove();
        this._bubbleEl = null;
      }
    }

    if (!allowAmbient || !ctx.player || this.combatReaction || this.fleeTimer > 0) return;
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
