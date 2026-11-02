// src/entities/Cambuche.js
// Refugio que se arma por piezas (base, techo, paredes, colchón, fogón, vela).
// Geometría portada de rebusque; medidas en metros, escaladas al mundo.
import * as THREE from 'three';
import { CHARACTER_SCALE } from '../utils/constants.js';
import { createImportedModel, disposeImportedInstance } from '../utils/ImportedModels.js';
import { createFlame, fireGlow, stepFlames } from '../world/bogota/flame.js';
import { cardboard } from '../world/bogota/textures.js';

export class Cambuche {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'cambuche';
    this.t = 0;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = Math.PI * 0.08;
    scene.add(this.group);

    const root = new THREE.Group();
    root.scale.setScalar(CHARACTER_SCALE);
    this.group.add(root);

    this._cardMap = cardboard(21).map;
    const cardMat = new THREE.MeshStandardMaterial({ map: this._cardMap, roughness: 0.92 });
    const pieces = {};

    // Cartones sueltos que marcan el sitio antes de armar
    const marker = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.6 + Math.random() * 0.4, 0.03, 0.5), cardMat);
      m.position.set((Math.random() - 0.5) * 1.4, 0.02 + i * 0.01, (Math.random() - 0.5) * 1);
      m.rotation.y = Math.random() * 3;
      marker.add(m);
    }
    root.add(marker);

    // Base de cartón aplanado
    const base = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 2.1), cardMat);
      // Las hojas se solapan: cada una queda ligeramente encima de la anterior.
      m.position.set(-0.9 + i * 0.88, 0.03 + i * 0.008, 0);
      m.rotation.y = (Math.random() - 0.5) * 0.08;
      m.receiveShadow = true;
      base.add(m);
    }
    pieces.base = base;

    // Techo de lona azul sobre palos
    const techo = new THREE.Group();
    const stickMat = new THREE.MeshStandardMaterial({ color: '#4a3a28', roughness: 0.9 });
    for (const [x, z, h] of [[-1.5, -1.2, 1.7], [1.5, -1.2, 1.7], [-1.5, 1.2, 1.1], [1.5, 1.2, 1.1]]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, h, 6), stickMat);
      s.position.set(x, h / 2, z);
      s.castShadow = true;
      techo.add(s);
    }
    const tarpGeo = new THREE.PlaneGeometry(3.4, 2.8, 12, 10);
    const tp = tarpGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), y = tp.getY(i);
      tp.setZ(i, -Math.cos((x / 1.7) * Math.PI) * 0.05 - (1 - Math.abs(y) / 1.4) * 0.12);
    }
    tarpGeo.computeVertexNormals();
    const tarp = new THREE.Mesh(tarpGeo, new THREE.MeshStandardMaterial({ color: '#1f5fbf', roughness: 0.45, side: THREE.DoubleSide }));
    tarp.rotation.x = -Math.PI / 2 + 0.22;
    tarp.position.y = 1.45;
    tarp.castShadow = true;
    techo.add(tarp);
    pieces.techo = techo;

    // Paredes de tablas
    const paredes = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.85 });
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.2 + Math.random() * 0.3, 0.05), woodMat);
      p.position.set(-1.35 + i * 0.45, 0.62, -1.25);
      p.rotation.z = (Math.random() - 0.5) * 0.06;
      p.castShadow = true;
      paredes.add(p);
    }
    for (const x of [-1.55, 1.55]) {
      for (let i = 0; i < 4; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05 + Math.random() * 0.2, 0.5), woodMat);
        p.position.set(x, 0.55, -0.95 + i * 0.52);
        p.castShadow = true;
        paredes.add(p);
      }
    }
    pieces.paredes = paredes;

    // Colchón manchado
    const cama = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 1.9), new THREE.MeshStandardMaterial({ color: '#9d9a86', roughness: 0.95 }));
    cama.position.set(-0.4, 0.13, 0);
    cama.castShadow = true;
    pieces.cama = cama;

    // Fogón de latas con fuego
    const fogon = new THREE.Group();
    const canMat = new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.85, roughness: 0.35 });
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), canMat);
      const a = (i / 5) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.18, 0.06, Math.sin(a) * 0.18);
      fogon.add(c);
    }
    this.fire = createFlame(0.46, 0.66);
    this.fire.position.y = 0.04;
    fogon.add(this.fire);
    this.fireLight = new THREE.PointLight(0xff8a2a, 2.5, 5);
    this.fireLight.position.y = 0.4;
    this.fireGlow = fireGlow();
    fogon.add(this.fireLight);
    fogon.position.set(1.0, 0, 1.3);
    pieces.fogon = fogon;

    // Vela y foto
    const vela = new THREE.Group();
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), new THREE.MeshStandardMaterial({ color: '#f2eee0' }));
    candle.position.y = 0.06;
    this.flame = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc46b').multiplyScalar(5) }));
    this.flame.position.y = 0.15;
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), new THREE.MeshStandardMaterial({ color: '#d8c7a5', emissive: '#3a2a15', emissiveIntensity: 0.3 }));
    photo.position.set(0.12, 0.12, -0.02);
    photo.rotation.y = -0.4;
    vela.add(candle, this.flame, photo);
    vela.position.set(0.6, 0.06, -0.9);
    pieces.vela = vela;

    Object.values(pieces).forEach((p) => {
      p.visible = false;
      root.add(p);
    });

    // Anillo que marca el sitio
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 2.1, 32),
      new THREE.MeshBasicMaterial({ color: 0xf6c400, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.03;
    this.group.add(this.marker);

    this.pieces = pieces;
    this.markerPile = marker;
    this.built = {};
  }

  get position() { return this.group.position; }

  preloadModel() {
    return this._modelPromise ??= createImportedModel('cambuche').then(model => {
      if (this._disposed) { disposeImportedInstance(model); return; }
      this.model = model;
      // Ligera separación del suelo para evitar planos superpuestos.
      model.position.y = 0.025;
      this.group.add(model);
      this.setBuilt(this.built);
    });
  }

  /** Muestra las piezas construidas: { base: true, techo: true, ... } */
  setBuilt(built) {
    this.built = { ...built };
    for (const [id, obj] of Object.entries(this.pieces)) obj.visible = !!built[id];
    this.markerPile.visible = !built.base;
    if (this.model) {
      const assembled = !!built.base && !!built.techo;
      this.model.visible = assembled;
      // Hasta reunir base y techo solo se ven las piezas ya construidas.
      if (assembled) for (const id of ['base', 'techo', 'paredes', 'cama']) this.pieces[id].visible = false;
    }
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    stepFlames(t);
    this.fire.scale.y = 0.66 * (1 + Math.sin(t * 1.9) * 0.05);
    this.fireLight.intensity = (2.85 + Math.sin(t * 2.4) * 0.2) * this.fireGlow.step(dt);
    this.flame.scale.setScalar(0.9 + Math.sin(t * 2.7) * 0.1);
    this.marker.material.opacity = 0.35 + Math.sin(t * 2) * 0.15;
  }

  setNight(isNight) { this.fireGlow.setNight(isNight); }

  dispose() {
    this._disposed = true;
    if (this.model) disposeImportedInstance(this.model);
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this._cardMap?.dispose?.();
  }
}
