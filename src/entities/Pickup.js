// src/entities/Pickup.js
import * as THREE from 'three';
import { ITEMS, LOOT_COMMON, LOOT_RARE } from '../data/items.js';
import { PICKUP_COOLDOWN, COLORS, SORT_BASE_TIME } from '../utils/constants.js';
import { createImportedModel, disposeImportedInstance } from '../utils/ImportedModels.js';
import { instanceBatches } from '../graphics/InstanceBatches.js';

export class Pickup {
  constructor(scene, position, { modelKind = 'bolsa', cooldown = PICKUP_COOLDOWN } = {}) {
    this.scene = scene;
    this.modelKind = modelKind;
    this.refillSeconds = cooldown;
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
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = 0.4;
    this.mesh.castShadow = true;
    this.group.add(this.mesh);

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

    // Modelo y aro se dibujan en lotes compartidos; su `visible` sigue marcando recogida y reaparición.
    this._batchReleases = [];
    if (scene.isScene) this._batchReleases.push(instanceBatches(scene).add(this.marker, 'aro de recogible'));

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
    this.guaranteedLoot = [];
    this._pendingLoot = null;
  }

  get position() { return this.group.position; }
  get sortComplete() { return this.sortProgress >= SORT_BASE_TIME; }

  preloadModel() {
    return this._modelPromise ??= createImportedModel(this.modelKind).then(model => {
      if (this._disposed) { disposeImportedInstance(model); return; }
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose(); this.mesh.material.dispose();
      this.mesh = model;
      this.importedModel = model;
      this.group.add(model);
      if (this.scene.isScene) model.traverse(o => { if (o.isMesh) this._batchReleases.push(instanceBatches(this.scene).add(o)); });
    });
  }

  setBoost(active) {
    this._boostActive = active;
  }

  /** Iniciar selección de basura */
  startSorting() {
    if (this.used || this.cooldown > 0) return false;
    this.sorting = true;
    this.sortProgress = 0;
    this.sortBarBg.visible = true;
    this.sortBarFill.visible = true;
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
   * @param {object} talentEffects - { rareChanceMult, sortValueMult, extraRolls }
   * @returns { items, rare, sorted } o null
   */
  harvest(boostActive = false, sorted = false, talentEffects = {}) {
    if (this.used || this.cooldown > 0) return null;

    const rareChanceMult = talentEffects.rareChanceMult ?? 1;

    const pending = this._pendingLoot;
    this._pendingLoot = null;
    const items = pending ? [...pending.items] : [...this.guaranteedLoot];
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
    rolls += talentEffects.extraRolls ?? 0;

    for (let i = 0; !pending && i < rolls; i++) {
      items.push(this._weightedPick(LOOT_COMMON));
    }

    let rare = null;
    if (!pending && Math.random() < rareChance) {
      rare = this._weightedPick(LOOT_RARE);
      items.push(rare);
    }
    rare ??= items.find(id => ['rare', 'veryRare'].includes(ITEMS[id]?.rarity) || ITEMS[id]?.rare) ?? null;

    this.used = true;
    this.cooldown = this.refillSeconds;
    this.mesh.visible = false;
    this.marker.visible = false;
    this.aura.visible = false;
    this.stopSorting();

    return { items, rare, sorted: pending?.sorted ?? sorted };
  }

  /** Conserva el contenido que no cabe; recoger de nuevo no vuelve a sortearlo. */
  returnUncollected(items, sorted = false) {
    if (!items.length) return;
    this._pendingLoot = { items: [...items], sorted };
    this.used = false;
    this.cooldown = 0;
    this.mesh.visible = true;
    this.marker.visible = true;
    this.aura.visible = true;
  }

  update(dt) {
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
        ? 1.0 + Math.sin(performance.now() * 0.005) * 0.15
        : 1.0;

      this.aura.material.opacity +=
        (targetOpacity - this.aura.material.opacity) * Math.min(1, dt * 8);
      const currentScale = this.aura.scale.x;
      this.aura.scale.setScalar(
        currentScale + (targetScale - currentScale) * Math.min(1, dt * 8)
      );
      this.aura.rotation.z -= dt * 1.5;
      // Sin potenciador su opacidad es 0: no cuesta un dibujo. Se apaga en partida, después del
      // calentamiento de carga, para que su pipeline ya esté preparado al activarse.
      this.aura.material.visible = this.aura.material.opacity > .01;
    }
  }

  relocate(newPosition) {
    this.group.position.copy(newPosition);
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
    for (const release of this._batchReleases.splice(0)) release();
    if (this.importedModel) disposeImportedInstance(this.importedModel);
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
