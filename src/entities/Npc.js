import * as THREE from 'three';

import {
  createRealisticCharacter,
  loadCatalog,
  normalizeReal,
  optionsFor,
  REALISTIC_SCALE
} from '../character/RealisticCharacter.js';

import { randomLook, DEFAULT_LOOK } from '../character/look.js';
import { NpcCombat } from '../systems/NpcCombat.js';
import { pick } from '../utils/random.js';

// ==========================================
// UTILIDADES
// ==========================================

// ==========================================
// BANCO DE VOCES
// Archivos ubicados en public/audio/
// ==========================================

import { NPC_VOICE_BANK } from '../data/npcVoices.js';
export { NPC_VOICE_BANK } from '../data/npcVoices.js';

const recentVoicePaths = [];
const voiceLastPlayedAt = new Map();
const VOICE_REPEAT_DELAY = 8000;

function getRandomVoice(category, gender) {
  const pool = NPC_VOICE_BANK[category]?.filter(entry => !entry.gender || entry.gender === gender) ?? [];
  const now = performance.now();
  const available = pool.filter(entry => now - (voiceLastPlayedAt.get(entry.audio) ?? -Infinity) >= VOICE_REPEAT_DELAY);
  const withoutRecent = available.filter(entry => !recentVoicePaths.includes(entry.audio));
  const entry = pick(withoutRecent.length ? withoutRecent : available);
  if (!entry) return null;
  recentVoicePaths.push(entry.audio);
  if (recentVoicePaths.length > 4) recentVoicePaths.shift();
  voiceLastPlayedAt.set(entry.audio, now);
  return entry;
}

export const NPC_LOD = {
  fullIn: 7,
  fullOut: 10,
  maxFull: 8,
  animEvery: 20,
  animStop: 40
};
const NPC_KNOCKOUT_DURATION = 3.5;
const NPC_RESPAWN_DELAY = 8;
const fullCharacterOwners = new Set();
const fullCharacterPool = [];
let liveNpcCount = 0;

function returnFullCharacter(model, dispose = false) {
  if (!model) return;
  if (dispose || liveNpcCount === 0) model.dispose?.();
  else fullCharacterPool.push(model);
}

const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.4);

// ==========================================
// GENERACIÓN DE PERSONAJES
// ==========================================

export async function randomStreetLook({ gastada = false } = {}) {
  const catalog = await loadCatalog();
  const sexo = Math.random() < 0.72 ? 'hombre' : 'mujer';

  const ropaOpts = optionsFor(catalog, 'ropa', sexo).map(o => o.id);
  const viejas = ropaOpts.filter(id =>
    ['rota', 'saco', 'chaqueta', 'buzo', 'overol', 'sudadera'].includes(id)
  );

  if (!ropaOpts.length) {
    throw new Error('[Npc] No hay ropa disponible para ' + sexo);
  }

  const look = randomLook(DEFAULT_LOOK);
  look.piel = 1 + Math.floor(Math.random() * 5);
  look.desgaste = gastada ? 2 : 0;

  look.real = normalizeReal(catalog, {
    sexo,
    edad: pick(['joven', 'adulto', 'adulto', 'mayor']),
    pelo: pick(optionsFor(catalog, 'pelo', sexo))?.id ??
      DEFAULT_LOOK?.real?.pelo ?? 'ninguno',
    barba: sexo === 'hombre' && Math.random() < 0.7
      ? pick(['descuidada', 'candado', 'larga', 'bigote'])
      : 'ninguna',
    ropa: gastada && viejas.length ? pick(viejas) : pick(ropaOpts),
    calzado: gastada
      ? pick(['tenis-rotos', 'tenis-rotos', 'botas'])
      : pick(optionsFor(catalog, 'calzado', sexo))?.id ?? 'tenis-rotos'
  });

  return look;
}

// ==========================================
// CLASE NPC
// ==========================================

export class Npc {

  static clearAllAggro(npcs) {
    if (!Array.isArray(npcs)) return;
    for (const npc of npcs) {
      if (npc) npc.resetAggro();
    }
  }

  constructor(scene, position, opts = {}) {
    this._disposed = false;
    liveNpcCount++;
    this.scene = scene;
    this.home = position.clone();
    this.position = position.clone();

    this.radius = 0.4;
    this.wander = opts.wander ?? 0;
    this.navigation = opts.navigation ?? null;
    this.groundHeight = opts.groundHeight ?? (() => this.home.y);
    this.walkSpeed = opts.speed ?? (0.85 + Math.random() * 0.45);
    this.isWalkable = opts.isWalkable ?? (() => true);

    this.route = [];
    this.routeIndex = 0;
    this._direction = new THREE.Vector3();
    this._nextPosition = new THREE.Vector3();
    this._wanderTarget = new THREE.Vector3();

    this.root = new THREE.Group();
    this.root.position.copy(position);
    this.root.rotation.y = opts.facing ?? Math.random() * Math.PI * 2;
    scene.add(this.root);

    this.target = null;
    this.wait = this.navigation ? 0 : Math.random() * 6;
    this.moving = false;
    this.animAcc = 0;
    this.animationBudget = 1;
    this.frame = Math.floor(Math.random() * 3);

    this.lodChar = null;
    this.fullChar = null;
    this._fullLoading = null;
    this.character = null;
    this._characterLoadToken = 0;
    this._knockoutTimer = 0;
    this._respawnTimer = 0;
    this._koDespawned = false;
    this._respawning = false;
    this._respawnLoading = null;

    this.isSplatted = false;
    this.splatTimer = 0;
    this.fleeTimer = 0;
    this.fleeDir = new THREE.Vector3();
    this.splatMesh = null;

    this._bubbleEl = null;
    this._bubbleTimer = 0;
    this._lastSpokenTime = 0;
    this._lastPlayerDistance = Infinity;
    this._lastVoiceTime = 0;
    this._mobVoiceUntil = 0;
    this._projPos = new THREE.Vector3();

    this.umbrella = null;
    this.panicTimer = 0;
    this.panicDir = null;

    this.assaultTarget = null;
    this.assaultTimer = 0;
    this.assaultAction = null;
    this.assaultKind = null;
    this.assaultDelay = 0;
    this.combatActionDuration = 0.6;
    this.reactionTimer = 0;
    this.grabbed = false;
    this._attackCooldown = 0;

    this.valentia = Math.random();
    this.maxHp = 100;
    this.hp = this.maxHp;

    this.healthBar = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0xd83232,
        depthTest: false
      })
    );
    this.healthBar.position.set(0, 2.3, 0);
    this.healthBar.scale.set(0.8, 0.07, 1);
    this.healthBar.visible = false;
    this.root.add(this.healthBar);

    this.velocity = new THREE.Vector3();
    this.combatAI = new NpcCombat(this);

    this.ready = (async () => {
      this.look = opts.look ?? await randomStreetLook({
        gastada: opts.gastada
      });

      await this._loadLodCharacter();
    })().catch(error => {
      this.loadError = error;
      console.warn('[Npc] Error cargando personaje:', error);
    });
  }

  async preload() {
    await this.ready;
    if (this.loadError) throw this.loadError;
  }

  async _loadLodCharacter() {
    const token = ++this._characterLoadToken;
    const model = await createRealisticCharacter(this.look, { lod: true });
    if (this._disposed || token !== this._characterLoadToken) {
      model.dispose?.();
      return null;
    }
    this.lodChar = model;
    this._show(model);
    model.update(Math.random() * 3, { speed: 0 });
    return model;
  }

  _loadFull() {
    if (this._disposed || this.fullChar) return Promise.resolve();
    if (this._fullLoading) return this._fullLoading;
    const reusable = fullCharacterPool.pop() ?? null;
    if (!reusable && fullCharacterOwners.size + fullCharacterPool.length >= NPC_LOD.maxFull) {
      return Promise.resolve();
    }

    fullCharacterOwners.add(this);
    this._wantsFull = true;
    this._fullLoading = this.ready.then(async () => {
      if (this._disposed || !this._wantsFull || this.loadError || !this.look) {
        fullCharacterOwners.delete(this);
        returnFullCharacter(reusable, this._koDespawned);
        return;
      }

      const model = reusable
        ? (await reusable.setLook(this.look), reusable)
        : await createRealisticCharacter(this.look, { lod: false });

      if (this._disposed || !this._wantsFull) {
        returnFullCharacter(model, this._koDespawned);
        fullCharacterOwners.delete(this);
      } else {
        this.fullChar = model;
      }
    }).catch(error => {
      returnFullCharacter(reusable, this._koDespawned);
      fullCharacterOwners.delete(this);
      throw error;
    }).finally(() => {
      this._fullLoading = null;
    });

    return this._fullLoading;
  }

  _releaseFull(dispose = false) {
    this._wantsFull = false;
    if (this.fullChar) {
      if (this.character === this.fullChar) {
        this.root.remove(this.fullChar.group);
        this.character = null;
        if (this.lodChar) this._show(this.lodChar);
      }
      returnFullCharacter(this.fullChar, dispose);
      this.fullChar = null;
      fullCharacterOwners.delete(this);
    } else if (!this._fullLoading) {
      fullCharacterOwners.delete(this);
    }
  }

  _show(char) {
    if (!char || this._disposed || this.character === char) return;
    if (this.character) this.root.remove(this.character.group);
    this.character = char;
    this.root.add(char.group);
  }

  _updateDetail(dist) {
    if (dist < NPC_LOD.fullIn) {
      if (this.fullChar) {
        this._show(this.fullChar);
      } else if (!this._fullLoading && !this.loadError) {
        this._loadFull().catch(error =>
          console.warn('[Npc] Modelo completo no disponible:', error)
        );
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

      if (this.isWalkable(x, z)) {
        return this._wanderTarget.set(x, 0, z);
      }
    }
    return null;
  }

  resetAggro() {
    this.assaultTarget = null;
    this.assaultTimer = 0;
    this.assaultAction = null;
    this.assaultKind = null;
    this.fleeTimer = 0;
    this.reactionTimer = 0;
    this._attackCooldown = 0;
    this.combatAI?.dispose();
    if (this.hp <= 0) { this.assaultAction = 'fueraCombate'; this.reactionTimer = Infinity; }
  }

  // ==========================================
  // REPRODUCTOR CONTROLADO DE AUDIO
  // ==========================================

  speakScenario(category, force = false) {
    const knockoutVoice = category === 'knockout';
    if (this._disposed || (this.hp <= 0 && !knockoutVoice)) return;
    const now = performance.now();
    if (!force && this._lastVoiceTime > 0 && now - this._lastVoiceTime < 2500) return false;
    const entry = getRandomVoice(category, this.look?.real?.sexo);
    if (!entry) return;
    this._lastVoiceTime = now;
    this.say(entry.text, 3.5);
    this.audio?.playNpcVoice?.(entry.audio, this, { allowKnockedOut: knockoutVoice });
    return true;
  }

  // ==========================================
  // EVENTO DE ROBO (TECLA Q)
  // ==========================================

  onRobbed(attacker, nearbyNpcs = []) {
    if (this.hp <= 0 || this._disposed) return;

    this.triggerMobAssault(attacker, true);

    if (Array.isArray(nearbyNpcs) && nearbyNpcs.length > 0) {
      let followerDelay = .15;

      nearbyNpcs.forEach((other) => {
        if (
          other &&
          other !== this &&
          other.hp > 0 &&
          !other._disposed &&
          other.position.distanceTo(this.position) < 12.0
        ) {
          other.beginAssault(attacker, 'golpe_jab', followerDelay, true);
          followerDelay += .15;
        }
      });
    }
  }

  // ==========================================
  // IMPACTO DE PROYECTILES
  // ==========================================

  hitByPoop(projectileOrigin = null) {
    this.isSplatted = true;
    this.splatTimer = 12;
    this.fleeTimer = 8;
    this.target = null;
    this.route = [];

    if (projectileOrigin) {
      this.fleeDir.copy(this.position).sub(projectileOrigin);
      this.fleeDir.y = 0;
      if (this.fleeDir.lengthSq() < 0.001) {
        this.fleeDir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      }
      this.fleeDir.normalize();
    } else {
      const angle = Math.random() * Math.PI * 2;
      this.fleeDir.set(Math.cos(angle), 0, Math.sin(angle));
    }

    if (!this.splatMesh) {
      const geo = new THREE.SphereGeometry(0.14, 6, 6);
      geo.scale(1.2, 0.4, 0.9);

      const mat = new THREE.MeshStandardMaterial({
        color: 0x3d2008,
        roughness: 0.95
      });

      this.splatMesh = new THREE.Mesh(geo, mat);
      this.splatMesh.position.set(0, 1.1, 0.18);
      this.root.add(this.splatMesh);
    }

    const screams = [
      '¡¡AY QUÉ ASCO, ME CAYÓ UN MOJÓN!! 🤮',
      '¡¡GONORREA COCHINO, ME TIRÓ POPÓ!! 🤬',
      '¡¡POLICÍA, UN LOCO ME ESTÁ TIRANDO MIERDA!! 🚨',
      '¡¡GAS, QUÉ COCHINADA TAN HIJUEPUTA!! 🤢',
      '¡¡QUÉ PESTILENCIA, AUXILIO ME EMBARRARON!! 🤮',
      '¡¡MALDITO ENFERMO, ME LAS VAS A PAGAR!! 🏃‍♂️💨'
    ];

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: pick(screams), type: 'warn' }
      }));

      if (Math.random() < 0.35) {
        const droppedMoney = 500 * (1 + Math.floor(Math.random() * 4));

        window.dispatchEvent(new CustomEvent('npc-dropped-loot', {
          detail: {
            position: this.position.clone(),
            amount: droppedMoney
          }
        }));
      }
    }
  }

  // ==========================================
  // MOVIMIENTO Y PERSECUCIÓN
  // ==========================================

  _walk(dt) {
    this.moving = false;

    if (this.grabbed || this.hp <= 0) return;

    // SI ESTÁ EN REACCIÓN A GOLPE, DEJAR QUE SE MUESTRE LA ANIMACIÓN DE REACCIÓN
    if (this.reactionTimer > 0) return;

    // === MODO PERSECUCIÓN / LINCHAMIENTO DIRECTO ===
    if (this.combatAI?.state !== 'libre') return;

    if (this.fleeTimer > 0) {
      this.fleeTimer -= dt;

      const next = this._nextPosition.copy(this.position)
        .addScaledVector(this.fleeDir, this.walkSpeed * 2.4 * dt);

      if (this.isWalkable(next.x, next.z)) {
        next.y = this.groundHeight(next.x, next.z);
        this.position.copy(next);
        this.moving = true;
      } else {
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

    if (this.combatAI && this.combatAI.state !== 'libre') return;
    if (!this.navigation && this.wander <= 0) return;

    if (!this.target) {
      this.wait -= dt;
      if (this.wait > 0) return;

      if (this.navigation) {
        this.route = this.navigation.createRoute(this.position) ?? [];
        this.routeIndex = 0;
        this.target = this.route[0] ?? null;
      } else {
        this.target = this._pickTarget();
      }

      if (!this.target) {
        this.wait = 2;
        return;
      }
    }

    const d = this._direction.copy(this.target).sub(this.position);
    d.y = 0;
    const dist = d.length();

    if (dist < 0.001) {
      this._advanceTarget();
      return;
    }

    const step = Math.min(dist, this.walkSpeed * dt);
    d.normalize();

    const next = this._nextPosition.copy(this.position)
      .addScaledVector(d, step);

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

  _advanceTarget() {
    this.target = this.navigation
      ? (this.route[++this.routeIndex] ?? null)
      : null;

    if (!this.target) {
      this.wait = this.navigation
        ? 1 + Math.random() * 3
        : 3 + Math.random() * 8;
    }
  }

  // ==========================================
  // ACTUALIZACIÓN PRINCIPAL
  // ==========================================

  update(dt, ctx = {}) {
    if (this._disposed) return;
    this.audio ??= globalThis.window?.__game?.audio;
    if (this._respawning) return;
    if (this._koDespawned) {
      this._respawnTimer -= dt;
      if (this._respawnTimer <= 0) this._respawn();
      return;
    }
    if (this.hp <= 0 && this._knockoutTimer > 0) {
      this._knockoutTimer = Math.max(0, this._knockoutTimer - dt);
      if (!this._knockoutTimer) this._despawnKnockedOut();
    }

    // SI EL JUGADOR ESTÁ MUERTO O REAPARECIÓ, LIMPIAR HOSTILIDAD
    const playerStats = ctx.playerStats || this.assaultTarget?.stats || globalThis.window?.__game?.stats;
    if (playerStats?.salud <= 0 && this.hp > 0 && this.combatAI?.state !== 'libre') {
      this.resetAggro();
    }

    this._combatBefore ??= new THREE.Vector3();
    this._combatBefore.copy(this.position);

    if (this.healthBar) {
      this.healthBar.visible =
        this.hp > 0 &&
        this.hp < this.maxHp &&
        (!ctx.player || this.position.distanceTo(ctx.player) < 12);

      this.healthBar.scale.x = 0.8 * this.hp / this.maxHp;
    }

    if (this.reactionTimer > 0 && Number.isFinite(this.reactionTimer)) {
      this.reactionTimer = Math.max(0, this.reactionTimer - dt);
      if (!this.reactionTimer && this.assaultTimer <= 0) {
        this.assaultAction = null;
      }
    }

    if (this.combatAI && !this.grabbed && !this.reactionTimer && this.hp > 0 && this.assaultTimer <= 0) {
      this.combatAI.update(dt);
    }

    if (this.velocity.lengthSq() > 0.001) {
      const next = this._nextPosition.copy(this.position)
        .addScaledVector(this.velocity, dt);

      if (this.isWalkable(next.x, next.z)) {
        next.y = this.groundHeight(next.x, next.z);
        this.position.copy(next);
      }

      this.velocity.multiplyScalar(Math.exp(-10 * dt));
    }

    // Separar perseguidores sin atravesar paredes ni apilar sus cuerpos.
    if (ctx.npcs && this.hp > 0 && this.combatAI?.state !== 'libre') {
      for (const other of ctx.npcs) {
        if (!other || other === this || other.hp <= 0) continue;

        if (other.grabbed || this.grabbed || Math.abs(other.position.y - this.position.y) > 1.2) continue;

        const minDist = this.radius + (other.radius || 0.4);
        const dx = this.position.x - other.position.x;
        const dz = this.position.z - other.position.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < minDist * minDist && distSq > 0.00001) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;

          const nextX = this.position.x + (dx / dist) * overlap * 0.4;
          const nextZ = this.position.z + (dz / dist) * overlap * 0.4;

          if (this.isWalkable(nextX, nextZ)) {
            this.position.x = nextX;
            this.position.z = nextZ;
            this.position.y = this.groundHeight(nextX, nextZ);
          }
        }
      }
    }

    this._walk(dt);

    this.combatSpeed = dt > 0
      ? this._combatBefore.distanceTo(this.position) / dt
      : 0;

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

    if (!this.character) {
      this._updateSpeech(dt, { ...ctx, player: null });
      return;
    }

    const dist = ctx.player
      ? Math.hypot(
        this.position.x - ctx.player.x,
        this.position.z - ctx.player.z
      )
      : 0;

    _sphere.center.set(
      this.position.x,
      this.position.y + 0.9,
      this.position.z
    );

    const onScreen = !ctx.frustum || ctx.frustum.intersectsSphere(_sphere);
    this.root.visible = onScreen;

    const outOfCombat = this.hp <= 0 && this.assaultAction === 'fueraCombate';

    if (ctx.player && dist > NPC_LOD.fullOut) this._releaseFull();

    if (!onScreen && !outOfCombat) {
      this._updateSpeech(dt, { ...ctx, player: null });
      if (this._bubbleEl) this._bubbleEl.style.display = 'none';
      this.animAcc += dt;
      return;
    }

    if (ctx.player) this._updateDetail(dist);
    this._updateSpeech(dt, ctx);
    this._updateUmbrella(ctx.isRaining ?? false);

    if (this._bubbleEl && ctx.camera && typeof window !== 'undefined') {
      this._projPos.set(
        this.position.x,
        this.position.y + 2.05,
        this.position.z
      ).project(ctx.camera);

      if (this._projPos.z > -1 && this._projPos.z < 1) {
        const sx = (this._projPos.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-this._projPos.y * 0.5 + 0.5) * window.innerHeight;

        this._bubbleEl.style.left = `${sx}px`;
        this._bubbleEl.style.top = `${sy}px`;
        this._bubbleEl.style.display = 'block';
      } else {
        this._bubbleEl.style.display = 'none';
      }
    }

    this.animAcc += dt;
    this.frame++;

    if (dist > NPC_LOD.animStop && !outOfCombat) return;

    const budget = ctx.animationBudget ?? this.animationBudget;
    const interval = outOfCombat
      ? 0
      : dist > NPC_LOD.animEvery
        ? 0.1 * budget
        : budget > 1 ? budget / 60 : 0;

    if (interval && this.animAcc < interval) return;

    const duration = outOfCombat
      ? 0
      : this.reactionTimer > 0
        ? this.reactionDuration ?? 0.45
        : this.combatActionDuration || 0.6;

    this.character.update(Math.min(this.animAcc, 0.2), {
      speed: this.combatSpeed / REALISTIC_SCALE,
      action: this.assaultAction,
      actionDuration: duration,
      actionSequence: this.actionSequence
    });

    this.animAcc = 0;
  }

  // ==========================================
  // ATAQUES COLECTIVOS Y LINCHAMIENTO
  // ==========================================

  beginAssault(target, action = 'golpe_jab', delay = 0, robberyChase = false) {
    if (!target || this.hp <= 0 || this._disposed) return;
    const player = target.position ? target : { position: target };
    this.fleeTimer = 0; this.target = null; this.route = [];
    this.audio = player.audio ?? this.audio;
    this.combatAI.entrarEnCombate(player);
    this.combatAI.state = 'acercarse';
    this.combatAI.timer = delay;
    this.combatAI.activationDelay = delay;
    this.combatAI.mob = true;
    this.combatAI.robberyChase = robberyChase;
  }

  triggerMobAssault(target, isLeader = false) {
    if (!target || this.hp <= 0 || this._disposed) return;

    this.beginAssault(target, 'golpe_jab', 0, true);
    this.speakScenario('theftChase', isLeader);
  }

  // ==========================================
  // RECEPCIÓN DE GOLPES (REACCIÓN + TAUNT)
  // ==========================================

  takePunch(attacker, info = {}) {
    if (this.hp <= 0 || this._disposed) return 0;

    const canBlock = ['acercarse', 'advertido', 'combate'].includes(this.combatAI?.state);
    const blocked = canBlock && this.valentia > 0.3 && Math.random() < 0.35;

    if (info.dir) {
      this.velocity.copy(info.dir).multiplyScalar((info.knock ?? 0.2) * (blocked ? 2 : 6));
    }

    this.applyDamage((info.dmg ?? 5) * (blocked ? 0.4 : 1));

    if (this.hp <= 0) return 0;

    // Un impacto interrumpe el ataque pendiente: no puede golpear con el clip de reacción.
    if (['preparar', 'golpear', 'recuperar'].includes(this.combatAI.state)) {
      this.combatAI.liberarFicha();
      this.combatAI.state = 'acercarse';
      this.combatAI.timer = .3;
    }
    this.actionSequence = (this.actionSequence ?? 0) + 1;

    // 1. ASIGNACIÓN Y TIEMPO DE ANIMACIÓN DE REACCIÓN
    if (blocked) {
      this.assaultAction = 'bloquear';
      this.reactionTimer = 0.6;
    } else {
      this.assaultAction = info.tipo === 'cross' ? 'reaccion_cabeza' : 'reaccion_pecho';
      this.reactionTimer = 0.45;
    }
    this.reactionDuration = this.reactionTimer;

    // 2. VOZ DE DOLOR/IMPACTO
    this.audio = attacker?.audio ?? this.audio;
    this.speakScenario('hit', true);

    // 3. RESPUESTA Y TAUNT/HUIDA CON DELAY PARA NO CANCELAR LA VOZ NI LA ANIMACIÓN
    if (this.valentia > 0.3) {
      this.audio = attacker?.audio ?? this.audio;
      this.combatAI.entrarEnCombate(attacker, true);
      return 0;
    }

    // SI ES COBARDE
    if (attacker?.position) {
      const dx = this.position.x - attacker.position.x;
      const dz = this.position.z - attacker.position.z;
      const len = Math.hypot(dx, dz) || 1;

      this.panicDir = { x: dx / len, z: dz / len };
      this.panicTimer = 5;
      this.fleeDir.set(dx / len, 0, dz / len);
      this.fleeTimer = 6;

      this.speakScenario('flee');
    }

    const dropMoney = 200 + Math.floor(Math.random() * 400);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          text: `💥 ¡Puñetazo! El transeúnte soltó $${dropMoney} y reaccionó.`,
          kind: 'info'
        }
      }));
    }

    return dropMoney;
  }

  applyDamage(amount) {
    if (!Number.isFinite(amount) || amount <= 0 || this.hp <= 0) {
      return;
    }

    this.hp = Math.max(0, this.hp - amount);

    if (this.hp === 0) {
      this.resetAggro();
      this.assaultAction = 'fueraCombate';
      this.reactionTimer = Infinity;
      this._knockoutTimer = NPC_KNOCKOUT_DURATION;
      this.velocity.set(0, 0, 0);
      this.speakScenario('knockout', true);
    }
  }

  _despawnKnockedOut() {
    if (this._koDespawned || this._disposed) return;
    this._koDespawned = true;
    this._respawnTimer = NPC_RESPAWN_DELAY;
    this._releaseFull(true);
    for (const model of fullCharacterPool) model.dispose?.();
    fullCharacterPool.length = 0;
    this._characterLoadToken++;
    this.root.remove(this.character?.group);
    this.lodChar?.dispose?.();
    this.lodChar = null;
    this.fullChar = null;
    this.character = null;
    this.root.visible = false;
    this.healthBar.visible = false;
    this._bubbleEl?.remove();
    this._bubbleEl = null;
    if (this.splatMesh) {
      this.root.remove(this.splatMesh);
      this.splatMesh.geometry?.dispose?.();
      this.splatMesh.material?.dispose?.();
      this.splatMesh = null;
    }
  }

  _respawn() {
    this.position.copy(this.home);
    this.position.y = this.groundHeight(this.home.x, this.home.z);
    this.root.position.copy(this.position);
    this.root.visible = false;
    this.hp = this.maxHp;
    this.healthBar.visible = false;
    this.healthBar.scale.x = 0.8;
    this.target = null;
    this.route = [];
    this.routeIndex = 0;
    this.wait = this.navigation ? 0 : Math.random() * 6;
    this.moving = false;
    this.velocity.set(0, 0, 0);
    this.assaultTarget = null;
    this.assaultTimer = 0;
    this.assaultAction = null;
    this.assaultKind = null;
    this.reactionTimer = 0;
    this.fleeTimer = 0;
    this.panicTimer = 0;
    this.grabbed = false;
    this._knockoutTimer = 0;
    this._respawnTimer = 0;
    this._koDespawned = false;
    this.loadError = null;
    this.combatAI.dispose();
    this._respawning = true;
    this._respawnLoading = this._loadLodCharacter().then(model => {
      if (!this._disposed && model) this.root.visible = true;
    }).catch(error => {
      this.loadError = error;
      console.warn('[Npc] Error reapareciendo personaje:', error);
    }).finally(() => {
      this._respawning = false;
      this._respawnLoading = null;
    });
  }

  // ==========================================
  // BURBUJAS Y DIÁLOGOS
  // ==========================================

  say(text, duration = 3.5) {
    if (typeof document === 'undefined' || this._disposed) return;

    const container = document.getElementById('npc-bubbles-container') ?? document.body;

    if (!container) return;

    this._bubbleEl?.remove();

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

    if (!ctx.player || this.hp <= 0 || this.combatAI?.state !== 'libre') return;

    const now = performance.now();
    const dist = Math.hypot(
      this.position.x - ctx.player.x,
      this.position.z - ctx.player.z
    );

    const passedBy = dist < 2.8 && this._lastPlayerDistance >= 2.8 && this.moving;
    this._lastPlayerDistance = dist;
    if (passedBy && (!this._lastSpokenTime || now - this._lastSpokenTime > 14000)) {
      this._lastSpokenTime = now;
      this.speakScenario('ambient');
    }
  }

  // ==========================================
  // LLUVIA Y PARAGUAS
  // ==========================================

  _updateUmbrella(isRaining) {
    if (isRaining) {
      if (!this.umbrella) {
        const group = new THREE.Group();

        const domeMat = new THREE.MeshStandardMaterial({
          color: 0x181a20,
          roughness: 0.65
        });
        const domeGeo = new THREE.ConeGeometry(0.68, 0.22, 10);
        const dome = new THREE.Mesh(domeGeo, domeMat);
        dome.position.y = 1.95;
        group.add(dome);

        const stickMat = new THREE.MeshStandardMaterial({
          color: 0x222222,
          metalness: 0.8
        });
        const stickGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6);
        const stick = new THREE.Mesh(stickGeo, stickMat);
        stick.position.set(0.18, 1.55, 0.1);
        group.add(stick);

        this.umbrella = group;
        this.root.add(group);
      }

      this.umbrella.visible = true;
    } else if (this.umbrella) {
      this.umbrella.visible = false;
    }
  }

  // ==========================================
  // LIMPIEZA DE RECURSOS
  // ==========================================

  dispose() {
    if (this._disposed) return;
    this._characterLoadToken++;
    this._releaseFull();
    this._disposed = true;

    this.healthBar?.material?.dispose?.();
    this.combatAI?.dispose?.();

    if (this._bubbleEl) {
      this._bubbleEl.remove();
      this._bubbleEl = null;
    }

    if (this.umbrella) {
      this.root.remove(this.umbrella);

      this.umbrella.traverse(obj => {
        obj.geometry?.dispose?.();

        if (Array.isArray(obj.material)) {
          obj.material.forEach(mat => mat.dispose?.());
        } else {
          obj.material?.dispose?.();
        }
      });

      this.umbrella = null;
    }

    const models = new Set([this.lodChar]);
    for (const model of models) model?.dispose?.();
    fullCharacterOwners.delete(this);

    if (this.splatMesh) {
      this.root.remove(this.splatMesh);
      this.splatMesh.geometry?.dispose?.();
      this.splatMesh.material?.dispose?.();
      this.splatMesh = null;
    }

    this.scene.remove(this.root);
    liveNpcCount--;
    if (liveNpcCount === 0) {
      for (const model of fullCharacterPool) model.dispose?.();
      fullCharacterPool.length = 0;
    }
  }
}
