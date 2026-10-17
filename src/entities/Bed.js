// src/entities/Bed.js
import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';
import { loadModel, cloneModel } from '../utils/ModelCache.js';

// Cambuche: ancho objetivo (dimensión mayor) y semitamaño de la huella de colisión/interacción
const CAMBUCHE_SIZE = 7.6; // dimensión mayor: tamaño de casa del mapa (edificios 8x4, alto 6-10); alto resultante ~4.2
const FOOT_HALF_X = 3.7;     // media huella (7.4 x 7.6 tras girar 90°), pegada a la esquina del mapa
const FOOT_HALF_Z = 3.8;
const INTERACT_EDGE = 1.1;   // distancia máxima al borde de la huella para dormir

export class Bed {
  constructor(scene, position, facing = 0) {
    this.scene = scene;
    this.facing = facing; // giro Y del modelo (frente hacia el interior del mapa)
    this.cooldown = 0;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    // Visual de respaldo (procedural) mientras carga el GLB o si falla; se retira al cargar
    this.fallback = new THREE.Group();
    this.group.add(this.fallback);
    this._loadModel();

    // ===== Colchón =====
    const mattressGeo = new THREE.BoxGeometry(1.2, 0.25, 2);
    const mattressMat = new THREE.MeshLambertMaterial({
      color: 0x555560,
      flatShading: true
    });
    const mattress = new THREE.Mesh(mattressGeo, mattressMat);
    mattress.position.y = 0.15;
    mattress.castShadow = true;
    mattress.receiveShadow = true;
    this.fallback.add(mattress);

    // ===== Almohada =====
    const pillowGeo = new THREE.BoxGeometry(0.7, 0.15, 0.4);
    const pillowMat = new THREE.MeshLambertMaterial({
      color: 0x777780,
      flatShading: true
    });
    const pillow = new THREE.Mesh(pillowGeo, pillowMat);
    pillow.position.set(0, 0.32, -0.7);
    pillow.castShadow = true;
    this.fallback.add(pillow);

    // ===== Cartón debajo (ambiente callejero) =====
    const cardGeo = new THREE.BoxGeometry(1.3, 0.05, 2.1);
    const cardMat = new THREE.MeshLambertMaterial({
      color: 0x8a6a3a,
      flatShading: true
    });
    const card = new THREE.Mesh(cardGeo, cardMat);
    card.position.y = 0.02;
    card.receiveShadow = true;
    this.fallback.add(card);

    // ===== Manta raída =====
    const blanketGeo = new THREE.BoxGeometry(1.15, 0.08, 1.2);
    const blanketMat = new THREE.MeshLambertMaterial({
      color: 0x4a3a30,
      flatShading: true
    });
    const blanket = new THREE.Mesh(blanketGeo, blanketMat);
    blanket.position.set(0, 0.3, 0.4);
    blanket.castShadow = true;
    this.fallback.add(blanket);

    // ===== Marcador flotante (anillo cian) — ahora BIEN visible =====
    const markerGeo = new THREE.RingGeometry(1.0, 1.3, 24);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_CYAN,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,     // ← ignora el depth buffer
      depthWrite: false
    });
    this.marker = new THREE.Mesh(markerGeo, markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.6;   // ← lo subimos para que flote sobre el colchón
    this.marker.renderOrder = 999;
    this.group.add(this.marker);

    // ===== Luz tenue =====
    this.light = new THREE.PointLight(0x2ab7ca, 0, 6);
    this.light.position.set(0, 3.5, 0);
    this.group.add(this.light);
  }

  get position() { return this.group.position; }

  /** Distancia en XZ desde p al borde de la huella del cambuche (0 si está dentro). */
  edgeDistance(p) {
    const dx = Math.max(Math.abs(p.x - this.group.position.x) - FOOT_HALF_X, 0);
    const dz = Math.max(Math.abs(p.z - this.group.position.z) - FOOT_HALF_Z, 0);
    return Math.hypot(dx, dz);
  }

  /** ¿El jugador está lo bastante cerca para dormir? (medido al borde, no al centro) */
  isNear(p) { return this.edgeDistance(p) < INTERACT_EDGE; }

  _loadModel() {
    loadModel('cambuche.glb', CAMBUCHE_SIZE).then((base) => {
      if (!base || !this.group.parent) return; // falló o ya se destruyó: queda el fallback
      const model = cloneModel(base);
      model.rotation.y = this.facing ?? 0;
      this.group.add(model);
      this.model = model;
      this.group.remove(this.fallback);
      this.fallback.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      this.fallback = null;
    });
  }

  update(dt) {
    if (this.marker) {
      this.marker.rotation.z += dt * 0.6;
      // Pulso de opacidad para que sea más llamativo
      this.marker.material.opacity = 0.7 + Math.sin(performance.now() * 0.003) * 0.2;
    }

    if (this.cooldown > 0) {
      this.cooldown -= dt;
    }
  }

  setNightLevel(level) {
    if (this.light) this.light.intensity = 0.6 * level;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.userData?.sharedAsset) return; // GLB compartido
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}