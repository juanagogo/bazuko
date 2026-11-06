// src/systems/PoopSystem.js
import * as THREE from 'three';
import { PoopProjectile } from '../entities/PoopProjectile.js';
import { GroundPoops, POOP_PIECES } from '../entities/GroundPoops.js';
import { ITEMS } from '../data/items.js';
import { PoopSequence, poopBlockReason } from './PoopSequence.js';

const SEQUENCE_ACTIONS = new Set(['bajarse', 'cagar', 'subirse']);
const COOLDOWN = 2.2;
const BEHIND = .3, PEE_AHEAD = .06;  // metros desde los pies: el montón detrás, el chichi entre los pies
const HIP = .32, STREAM_HIP = .24, STREAM_AHEAD = .05;

export class PoopSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} audio
   * @param {object} inventory
   * @param {object} stats
   * @param {object} world
   * @param {{ quality?: () => string }} options  calidad efectiva, para cuántas moscas dibujar
   */
  constructor(scene, audio = null, inventory = null, stats = null, world = null, { quality } = {}) {
    this.scene = scene;
    this.audio = audio;
    this.inventory = inventory;
    this.stats = stats;
    this.world = world;
    this.quality = quality ?? (() => 'alta');

    this.activeProjectiles = [];
    this.splatParticles = [];
    this.poopCooldown = 0;
    this._throwDir = new THREE.Vector3();
    this.sequence = new PoopSequence();
    this.ground = new GroundPoops(scene);
    this._current = null;   // { player, pile, forward } mientras dura la escena
    this._time = 0;
    this._from = new THREE.Vector3();
    this._stream = new THREE.Vector3();
  }

  /** Las popós del piso (incluidas las que se están yendo). */
  get groundPoops() { return this.ground.piles; }

  /**
   * Hacer popó: se baja el pantalón, se agacha censurado, deja el montón y el chichi y se vuelve a
   * vestir (ver PoopSequence). Lo de siempre (higiene, estómago y el mojón al inventario) se entrega al
   * terminar de hacer popó; si lo interrumpen antes, no.
   * @param {object} player
   * @returns {boolean} si empezó
   */
  poop(player) {
    if (this.poopCooldown > 0) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: `Espere ${this.poopCooldown.toFixed(1).replace('.', ',')} s para otro popó`, type: 'info' }
        }));
      }
      return false;
    }
    if (this.sequence.active || !player?.position) return false;
    if (poopBlockReason(player)) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: 'Ahora no: termine lo que está haciendo.', type: 'info' }
        }));
      }
      return false;
    }
    if (!this.sequence.start(player)) return false;
    player.setPoopPose?.({ drop: 0, censor: false, stance: 'pretina' });

    const yaw = player.root?.rotation?.y ?? 0;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // El piso que hay debajo de cada cosa, en la capa de los pies: sobre el viaducto queda en el tablero
    // y junto a un sardinel no flota. Si la consulta salta más de 60 cm, se queda a la altura de los pies.
    const feetY = player.position.y;
    const onGround = point => {
      const y = this.world?.active?.getMovementGroundHeight?.(point.x, point.z, feetY);
      point.y = Number.isFinite(y) && Math.abs(y - feetY) <= .6 ? y : feetY;
      return point;
    };
    const pile = this.ground.spawn(onGround(player.position.clone().addScaledVector(forward, -BEHIND)), {
      pieces: 0, pee: true, peeAt: onGround(player.position.clone().addScaledVector(forward, -PEE_AHEAD))
    });
    this._current = { player, pile, forward };
    return true;
  }

  /**
   * Lanza un mojón de popó al frente o hacia donde apunta la cámara.
   * Si no tiene popó en el inventario, hace popó primero.
   * @param {object} player
   * @param {object} cameraRig
   * @returns {boolean}
   */
  throwPoop(player, cameraRig = null) {
    if (this.sequence.active) return false;
    const poopCount = this.inventory?.count?.('popo') ?? 0;
    if (poopCount <= 0) {
      return this.poop(player);
    }

    this.inventory.remove('popo', 1);
    player?.playAction?.('lanzar', 0.65);
    this.audio?.playWhoosh?.();

    // Determina la dirección de lanzamiento
    const dir = this._throwDir.set(0, 0, 1);
    if (cameraRig?.camera && cameraRig.mode === 'third-person') {
      cameraRig.camera.getWorldDirection(dir);
      dir.y = 0;
    } else if (player?.root) {
      dir.set(Math.sin(player.root.rotation.y), 0, Math.cos(player.root.rotation.y));
    }
    dir.normalize();

    // Punto de partida a la altura del pecho/brazo del jugador
    const startPos = (player?.position?.clone() ?? new THREE.Vector3()).add(new THREE.Vector3(0, 1.25, 0));
    startPos.addScaledVector(dir, 0.45);

    const npcs = this.world?.active?.npcs ?? [];
    // Cae en la capa desde la que se lanzó: desde el viaducto, en el tablero; desde la calle, en la calle.
    const feetY = player?.position?.y ?? 0;
    const groundHeightFn = (x, z) => this.world?.active?.getMovementGroundHeight?.(x, z, feetY) ?? this.world?.active?.getGroundHeight?.(x, z) ?? 0;

    const projectile = new PoopProjectile(this.scene, startPos, dir, npcs, groundHeightFn);
    this.activeProjectiles.push(projectile);

    const remaining = this.inventory.count('popo');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: `¡Popó al aire! (Quedan: ${remaining})`, type: 'info' }
      }));
      window.dispatchEvent(new CustomEvent('poop-thrown', { detail: { remaining } }));
    }

    return true;
  }

  /** Un mojón lanzado que cae al piso: montón entero, sin charquito, y le llegan las moscas. */
  _spawnGroundPoop(position) {
    const pile = this.ground.spawn(position, { pieces: POOP_PIECES });
    this.ground.settle(pile);
    return pile;
  }

  _spawnSplatEffect(position) {
    if (!this.scene) return;
    const particleCount = 10;
    const geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const mat = new THREE.MeshBasicMaterial({ color: 0x3d2008 });

    for (let i = 0; i < particleCount; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        1.5 + Math.random() * 2.5,
        Math.sin(angle) * speed
      );
      this.scene.add(mesh);
      this.splatParticles.push({ mesh, vel, lifetime: 0.65 });
    }
  }

  /** Aplica un cuadro de la escena al jugador y a su montón. */
  _advance(dt) {
    const { player, pile, forward } = this._current;
    const frame = this.sequence.update(dt, player);
    if (!frame) return;
    if (frame.actionChanged) player.playAction?.(frame.action, frame.actionLeft + .25);
    if (!frame.finished && !frame.interrupted) player.setPoopPose?.({ drop: frame.drop, censor: frame.censor, stance: frame.stance });
    this.ground.reveal(pile, frame.pieces);
    this._from.copy(player.position).setY(player.position.y + HIP);
    this.ground.dropPiece(pile, frame.falling?.index ?? null, this._from, frame.falling?.progress ?? 1);
    const stream = frame.streaming
      ? this._stream.copy(player.position).addScaledVector(forward, STREAM_AHEAD).setY(player.position.y + STREAM_HIP)
      : null;
    this.ground.setPee(pile, frame.pee, stream);
    if (frame.fart) this.audio?.playFart?.();
    if (frame.completed) this._deliver();
    if (frame.finished || frame.interrupted) this._end();
  }

  /** Lo de siempre al hacer popó: higiene, estómago y el mojón para lanzar. */
  _deliver() {
    if (this.stats) {
      // Disminuye levemente la higiene al no limpiarse
      this.stats.higiene = Math.max(0, this.stats.higiene - 3);
      // Alivia el estómago
      this.stats.hambre = Math.max(0, this.stats.hambre - 2);
    }
    if (this.inventory && ITEMS.popo) this.inventory.add(ITEMS.popo, 1);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: 'Popó listo. Oprima [X] para lanzarlo.', type: 'warn' }
      }));
      window.dispatchEvent(new CustomEvent('poop-produced'));
    }
  }

  /** Corta la escena en el acto (muerte, arresto): queda vestido y no se entrega nada. */
  cancel() {
    if (!this._current) return;
    this.sequence.interrupt();
    this._end();
  }

  /** Fin de la escena, terminada o cortada: vestido, sin chorrito y con lo que alcanzó a caer. */
  _end() {
    const { player, pile } = this._current;
    this._current = null;
    player.setPoopPose?.(null);
    if (SEQUENCE_ACTIONS.has(player.action)) { player.action = null; player.actionTimer = 0; }
    this.ground.dropPiece(pile, null);
    this.ground.setPee(pile, pile.pee, null);
    if (pile.pieces > 0 || pile.pee > 0) this.ground.settle(pile);
    else this.ground.remove(pile);
    this.poopCooldown = COOLDOWN;
  }

  /**
   * Avanza la escena, los proyectiles en vuelo, las popós del piso y las salpicaduras.
   * @param {number} dt
   * @param {{ listener?: THREE.Vector3, camera?: THREE.Camera }} context  para moscas, olor y zumbido
   */
  update(dt, { listener = null, camera = null } = {}) {
    this._time += dt;
    if (this.poopCooldown > 0 && !this._current) {
      this.poopCooldown = Math.max(0, this.poopCooldown - dt);
    }
    if (this._current) this._advance(dt);

    // 1. Proyectiles activos
    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const p = this.activeProjectiles[i];
      const res = p.update(dt);
      if (res.hit) {
        this.activeProjectiles.splice(i, 1);
        if (res.type === 'npc') {
          this.audio?.playSplat?.();
          this._spawnSplatEffect(res.position);
          this.stats?.addXP?.(5);
          if (this.stats) {
            this.stats.animo = Math.min(100, this.stats.animo + 4);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('toast', {
              detail: { text: '¡Diana! Le pegué con el popó al peatón.', type: 'rare' }
            }));
          }
        } else if (res.type === 'ground') {
          this.audio?.playSplat?.();
          // El proyectil se detiene 4 cm sobre el piso; el montón va a ras.
          this._spawnGroundPoop(res.position.clone().setY(res.position.y - .04));
        }
      }
    }

    // 2. Partículas de salpicadura
    for (let i = this.splatParticles.length - 1; i >= 0; i--) {
      const sp = this.splatParticles[i];
      sp.lifetime -= dt;
      sp.vel.y -= 14 * dt;
      sp.mesh.position.addScaledVector(sp.vel, dt);
      if (sp.lifetime <= 0) {
        this.scene.remove(sp.mesh);
        sp.mesh.geometry?.dispose?.();
        sp.mesh.material?.dispose?.();
        this.splatParticles.splice(i, 1);
      }
    }

    // 3. Popós del piso, moscas, olor y zumbido
    this.ground.update(dt, { camera, listener, time: this._time, quality: this.quality() });
    this.audio?.flyBuzz?.update?.(dt, listener ? this.ground.nearestDistance(listener) : Infinity);
  }

  dispose() {
    if (this._current) this._current.player.setPoopPose?.(null);
    this._current = null;
    for (const p of this.activeProjectiles) p.dispose();
    this.activeProjectiles = [];

    this.ground.dispose();

    for (const sp of this.splatParticles) {
      this.scene.remove(sp.mesh);
      sp.mesh.geometry?.dispose?.();
      sp.mesh.material?.dispose?.();
    }
    this.splatParticles = [];
  }
}
