// src/systems/PoopSystem.js
import * as THREE from 'three';
import { PoopProjectile } from '../entities/PoopProjectile.js';
import { ITEMS } from '../data/items.js';

// Geometrías y materiales compartidos para evitar recreación y saturación de memoria GPU
const _groundPoopGeo = new THREE.CylinderGeometry(0.18, 0.26, 0.08, 7);
const _groundPoopMat = new THREE.MeshStandardMaterial({
  color: 0x4a2810,
  roughness: 0.95
});
const _splatGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
const _splatMat = new THREE.MeshBasicMaterial({ color: 0x3d2008 });

export class PoopSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} audio
   * @param {object} inventory
   * @param {object} stats
   * @param {object} world
   */
  constructor(scene, audio = null, inventory = null, stats = null, world = null) {
    this.scene = scene;
    this.audio = audio;
    this.inventory = inventory;
    this.stats = stats;
    this.world = world;

    this.activeProjectiles = [];
    this.groundPoops = [];
    this.splatParticles = [];
    this.poopCooldown = 0;
    this._throwDir = new THREE.Vector3();
  }

  /**
   * Acción de hacer popó (defecar en el sitio).
   * Relaja al personaje, deja un mojón en el suelo y añade 1 mojón al inventario.
   * @param {object} player
   * @returns {boolean}
   */
  poop(player) {
    if (this.poopCooldown > 0) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: `⏳ Espera ${this.poopCooldown.toFixed(1)}s para volver a cagar`, type: 'info' }
        }));
      }
      return false;
    }

    this.poopCooldown = 2.2;
    player?.playAction?.('cagar', 1.0);
    this.audio?.playFart?.();

    if (this.stats) {
      // Disminuye levemente la higiene al no limpiarse
      this.stats.higiene = Math.max(0, this.stats.higiene - 3);
      // Alivia el estómago
      this.stats.hambre = Math.max(0, this.stats.hambre - 2);
    }

    // Deja una marca física de popó en el piso donde estaba parado
    if (player?.position && this.scene) {
      const dropPos = player.position.clone();
      const groundY = this.world?.active?.getGroundHeight?.(dropPos.x, dropPos.z) ?? dropPos.y;
      dropPos.y = groundY + 0.04;
      this._spawnGroundPoop(dropPos);
    }

    // Añade el mojón al inventario para que el jugador lo tenga como proyectil
    if (this.inventory && ITEMS.popo) {
      this.inventory.add(ITEMS.popo, 1);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: '💩 ¡Te echaste una cagada! Tienes un mojón listo. Presiona [X] para lanzarlo.', type: 'warn' }
      }));
      window.dispatchEvent(new CustomEvent('poop-produced'));
    }

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
    const groundHeightFn = (x, z) => this.world?.active?.getGroundHeight?.(x, z) ?? 0;

    const projectile = new PoopProjectile(this.scene, startPos, dir, npcs, groundHeightFn);
    this.activeProjectiles.push(projectile);

    const remaining = this.inventory.count('popo');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: `💩 ¡Mojón al aire! (Te quedan: ${remaining})`, type: 'info' }
      }));
      window.dispatchEvent(new CustomEvent('poop-thrown', { detail: { remaining } }));
    }

    return true;
  }

  _spawnGroundPoop(position) {
    if (!this.scene) return;
    const mesh = new THREE.Mesh(_groundPoopGeo, _groundPoopMat);
    mesh.position.copy(position);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(mesh);
    this.groundPoops.push({ mesh, lifetime: 45 });
  }

  _spawnSplatEffect(position) {
    if (!this.scene) return;
    const particleCount = 10;

    for (let i = 0; i < particleCount; i++) {
      const mesh = new THREE.Mesh(_splatGeo, _splatMat);
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

  /**
   * Actualiza proyectiles en vuelo, mojones en el piso y efectos de salpicadura.
   * @param {number} dt
   */
  update(dt) {
    if (this.poopCooldown > 0) {
      this.poopCooldown = Math.max(0, this.poopCooldown - dt);
    }

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
              detail: { text: '🎯 ¡Diana! Le pegaste con el mojón al peatón (+5 XP).', type: 'rare' }
            }));
          }
        } else if (res.type === 'ground') {
          this.audio?.playSplat?.();
          this._spawnGroundPoop(res.position);
        }
      }
    }

    // 2. Mojones en el piso (desaparecen tras 45s)
    for (let i = this.groundPoops.length - 1; i >= 0; i--) {
      const gp = this.groundPoops[i];
      gp.lifetime -= dt;
      if (gp.lifetime <= 0) {
        this.scene.remove(gp.mesh);
        this.groundPoops.splice(i, 1);
      }
    }

    // 3. Partículas de salpicadura
    for (let i = this.splatParticles.length - 1; i >= 0; i--) {
      const sp = this.splatParticles[i];
      sp.lifetime -= dt;
      sp.vel.y -= 14 * dt;
      sp.mesh.position.addScaledVector(sp.vel, dt);
      if (sp.lifetime <= 0) {
        this.scene.remove(sp.mesh);
        this.splatParticles.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const p of this.activeProjectiles) p.dispose();
    this.activeProjectiles = [];

    for (const gp of this.groundPoops) {
      this.scene.remove(gp.mesh);
    }
    this.groundPoops = [];

    for (const sp of this.splatParticles) {
      this.scene.remove(sp.mesh);
    }
    this.splatParticles = [];
  }
}
