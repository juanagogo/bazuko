// src/entities/CraftingStation.js
import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';

/**
 * La mesa. Junto a ella, E abre lo mismo que C abre desde cualquier parte.
 */
export class CraftingStation {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'mesa';

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    // Mesa de trabajo
    const tableMat = new THREE.MeshLambertMaterial({
      color: 0x5a3a1a, flatShading: true
    });
    const tableTop = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.1, 1.2), tableMat
    );
    tableTop.position.y = 0.9;
    tableTop.castShadow = true;
    this.group.add(tableTop);

    // Patas
    const legGeo = new THREE.BoxGeometry(0.12, 0.9, 0.12);
    const legPositions = [
      [-0.8, 0.45, -0.5], [0.8, 0.45, -0.5],
      [-0.8, 0.45, 0.5], [0.8, 0.45, 0.5]
    ];
    for (const [x, y, z] of legPositions) {
      const leg = new THREE.Mesh(legGeo, tableMat);
      leg.position.set(x, y, z);
      this.group.add(leg);
    }

    // Herramientas sobre la mesa
    const toolMat = new THREE.MeshLambertMaterial({
      color: 0x999999, flatShading: true
    });
    const anvil = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.2, 0.4), toolMat
    );
    anvil.position.set(-0.5, 1.05, 0);
    this.group.add(anvil);

    const hammer = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.5), toolMat
    );
    hammer.position.set(0.4, 1.0, 0.2);
    hammer.rotation.y = 0.5;
    this.group.add(hammer);

    // Marcador
    const markerGeo = new THREE.RingGeometry(1.2, 1.5, 24);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_GREEN,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    this.marker = new THREE.Mesh(markerGeo, markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.05;
    this.group.add(this.marker);
  }

  get position() { return this.group.position; }

  update(dt) {
    if (this.marker) this.marker.rotation.z += dt * 0.6;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
