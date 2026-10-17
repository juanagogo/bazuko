// src/entities/Pickup.js
import * as THREE from 'three';
import { LOOT_COMMON, LOOT_RARE } from '../data/items.js';
import { loadModel, cloneModel } from '../utils/ModelCache.js';
import { PICKUP_COOLDOWN, COLORS, SORT_BASE_TIME } from '../utils/constants.js';

const PICKUP_COLLIDER_RADIUS = 0.45;

export class Pickup {
  constructor(scene, position, collisions = null) {
    this.scene = scene;
    this.collisions = collisions;
    this.used = false;
    this.cooldown = 0;
    this.sorting = false;
    this.sortProgress = 0;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    // Bolsa de basura low-poly
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    const mat = new THREE.MeshLambertMaterial({
      color: COLORS.TRASH,
      flatShading: true
    });
    const proc = new THREE.Mesh(geo, mat);
    proc.position.y = 0.4;
    proc.castShadow = true;
    // Contenedor: this.mesh conserva la API (visible on/off); contiene procedural o GLB
    this.mesh = new THREE.Group();
    this.mesh.add(proc);
    this._proc = proc;
    this.group.add(this.mesh);
    this._loadModel();

    // Colisión: obstáculo circular pequeño (bolsa escalada a ~1.1 => radio ~0.45).
    // INTERACT_RANGE (1.8) alcanza de sobra al jugador pegado a este círculo (0.45 + 0.4).
    this.collider = collisions ? collisions.addCircle(position.x, position.z, PICKUP_COLLIDER_RADIUS) : null;

    // Marcador flotante (anillo)
    const markerGeo = new THREE.RingGeometry(0.5, 0.6, 12);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_AMBER,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7
    });
    this.marker = new THREE.Mesh(markerGeo, markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.02;
    this.group.add(this.marker);

    // Aura de boost
    const auraGeo = new THREE.RingGeometry(0.6, 0.85, 16);
    const auraMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_GOLD,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    });
    this.aura = new THREE.Mesh(auraGeo, auraMat);
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.03;
    this.group.add(this.aura);

    // Barra de selección (oculta inicialmente)
    const barBgGeo = new THREE.PlaneGeometry(1.2, 0.12);
    const barBgMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.7, depthTest: false
    });
    this.sortBarBg = new THREE.Mesh(barBgGeo, barBgMat);
    this.sortBarBg.rotation.x = -Math.PI / 2;
    this.sortBarBg.position.y = 0.06;
    this.sortBarBg.visible = false;
    this.group.add(this.sortBarBg);

    const barFillGeo = new THREE.PlaneGeometry(1.2, 0.12);
    const barFillMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_GREEN, depthTest: false
    });
    this.sortBarFill = new THREE.Mesh(barFillGeo, barFillMat);
    this.sortBarFill.rotation.x = -Math.PI / 2;
    this.sortBarFill.position.y = 0.065;
    this.sortBarFill.visible = false;
    this.group.add(this.sortBarFill);

    this._boostActive = false;
    this.onRespawn = null;
  }

  // Reemplaza la bolsa procedural por el GLB compartido cuando termina de cargar
  _loadModel() {
    loadModel('bolsa.glb', 1.1).then((base) => {
      if (!base || this._disposed) return; // fallback: queda la procedural
      const model = cloneModel(base);
      model.rotation.y = Math.random() * Math.PI * 2;
      this.mesh.remove(this._proc);
      this._proc.geometry.dispose();
      this._proc.material.dispose();
      this._proc = null;
      this.mesh.add(model);
    });
  }

  get position() { return this.group.position; }
  get sortComplete() { return this.sortProgress >= SORT_BASE_TIME; }

  setBoost(active) {
    this._boostActive = active;
  }

  /** Iniciar selección de basura */
  startSorting() {
    if (this.used || this.cooldown > 0) return false;
    this.sorting = true;
    this.sortProgress = 0;
    // La barra ahora es DOM sobre la cabeza del jugador (ui/PlayerOverhead.js)
    return true;
  }

  stopSorting() {
    this.sorting = false;
    this.sortProgress = 0;
    this.sortBarBg.visible = false;
    this.sortBarFill.visible = false;
  }

  /**
   * Recolectar la basura.
   * @param {boolean} boostActive
   * @param {boolean} sorted - si se completó la selección
   * @param {object} talentEffects - { rareChanceMult, sortValueMult }
   * @returns { items, rare, sorted } o null
   */
  harvest(boostActive = false, sorted = false, talentEffects = {}) {
    if (this.used || this.cooldown > 0) return null;

    // Sobrantes de una recolección anterior que no cupo en el inventario: se entregan tal cual
    if (this.leftover?.length) {
      const items = this.leftover;
      this.leftover = null;
      const rare = items.find((id) => LOOT_RARE.some((r) => r.item === id)) ?? null;
      this._consume();
      return { items, rare, sorted };
    }

    const rareChanceMult = talentEffects.rareChanceMult ?? 1;

    const items = [];
    let rolls;
    let rareChance;

    if (sorted) {
      // Selección: más rolls, más rare
      rolls = boostActive ? 6 : 4;
      rareChance = (boostActive ? 0.25 : 0.12) * rareChanceMult;
    } else {
      rolls = boostActive ? 4 : 2;
      rareChance = (boostActive ? 0.15 : 0.05) * rareChanceMult;
    }

    for (let i = 0; i < rolls; i++) {
      items.push(this._weightedPick(LOOT_COMMON));
    }

    let rare = null;
    if (Math.random() < rareChance) {
      rare = this._weightedPick(LOOT_RARE);
      items.push(rare);
    }

    this._consume();
    return { items, rare, sorted };
  }

  // Marca la bolsa como vaciada (oculta, en cooldown)
  _consume() {
    this.used = true;
    this.cooldown = PICKUP_COOLDOWN;
    this.mesh.visible = false;
    if (this.collider) this.collider.enabled = false; // se puede atravesar mientras no hay bolsa
    this.marker.visible = false;
    this.aura.visible = false;
    this.stopSorting();
  }

  /** Estado persistente (posición, si está vaciada y su reaparición) */
  serialize() {
    return {
      x: this.group.position.x, z: this.group.position.z,
      used: this.used, cooldown: this.cooldown,
      leftover: this.leftover?.length ? this.leftover.slice() : null
    };
  }

  restoreState(s) {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) return;
    this.relocate({ x: s.x, y: 0, z: s.z });
    if (Array.isArray(s.leftover) && s.leftover.length) {
      this.restore(s.leftover.filter((id) => typeof id === 'string'));
    } else if (s.used) {
      this._consume();
      this.cooldown = Math.max(0.1, Number(s.cooldown) || PICKUP_COOLDOWN);
    }
  }

  /** Devuelve a la bolsa los items que no cupieron: vuelve a estar disponible sin perderlos. */
  restore(leftoverIds) {
    if (!leftoverIds?.length) return;
    this.leftover = leftoverIds.slice();
    this.used = false;
    this.cooldown = 0;
    if (this.collider) this.collider.enabled = true;
    this.mesh.visible = true;
    this.marker.visible = true;
    this.aura.visible = true;
  }

  update(dt) {
    this._t = (this._t || 0) + dt;
    // Progreso de selección
    if (this.sorting && !this.used) {
      this.sortProgress += dt;
      const pct = Math.min(1, this.sortProgress / SORT_BASE_TIME);
      this.sortBarFill.scale.x = pct;
      this.sortBarFill.position.x = -(1 - pct) * 0.6;

      if (this.sortComplete) {
        this.sortBarFill.material.color.setHex(COLORS.ACCENT_GOLD);
      }
    }

    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        if (typeof this.onRespawn === 'function') {
          this.onRespawn(this);
        }
        this.used = false;
        if (this.collider) this.collider.enabled = true;
        this.mesh.visible = true;
        this.marker.visible = true;
        this.aura.visible = true;
      }
    }

    if (this.marker.visible) {
      this.marker.rotation.z += dt * 0.8;
    }

    if (this.aura.visible) {
      const targetOpacity = this._boostActive ? 0.7 : 0.0;
      const targetScale = this._boostActive
        ? 1.0 + Math.sin(this._t * 5) * 0.15
        : 1.0;

      this.aura.material.opacity +=
        (targetOpacity - this.aura.material.opacity) * Math.min(1, dt * 8);
      const currentScale = this.aura.scale.x;
      this.aura.scale.setScalar(
        currentScale + (targetScale - currentScale) * Math.min(1, dt * 8)
      );
      this.aura.rotation.z -= dt * 1.5;
    }
  }

  relocate(newPosition) {
    this.group.position.copy(newPosition);
    if (this.collider) { this.collider.x = newPosition.x; this.collider.z = newPosition.z; }
  }

  _weightedPick(table) {
    const total = table.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    for (const e of table) {
      r -= e.weight;
      if (r <= 0) return e.item;
    }
    return table[0].item;
  }

  dispose() {
    this._disposed = true;
    if (this.collider) { this.collisions?.removeCircle(this.collider); this.collider = null; }
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.userData?.sharedAsset) return; // geometría/material compartidos del GLB
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
