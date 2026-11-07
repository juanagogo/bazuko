// src/entities/SellPoint.js
// Recicladora El Progreso: compra el material al peso.
import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';
import { signMesh } from '../utils/signs.js';
import { disposeSceneGroup, lam } from '../utils/entityHelpers.js';

export class SellPoint {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'recycler';

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    // Base
    const baseGeo = new THREE.BoxGeometry(1.5, 1.2, 1);
    const baseMat = lam(0x4a3a2a);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.6;
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    // Techo
    const roofGeo = new THREE.BoxGeometry(2, 0.15, 1.3);
    const roof = new THREE.Mesh(roofGeo, baseMat);
    roof.position.y = 1.6;
    roof.castShadow = true;
    this.group.add(roof);

    // Luz ámbar (nivel 0)
    const lightGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const lightMat = new THREE.MeshBasicMaterial({ color: COLORS.ACCENT_AMBER });
    const light = new THREE.Mesh(lightGeo, lightMat);
    light.position.set(0, 1.4, 0.5);
    this.group.add(light);

    // Letrero
    const sign = signMesh({ title: 'RECICLADORA', sub: 'EL PROGRESO · PAGAMOS AL PESO', bg: '#1f6b3a' }, 2.4);
    sign.position.set(0, 2.15, 0);
    this.group.add(sign);

    // Báscula y costales de material
    const scaleBase = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), lam(0x7d8288));
    scaleBase.position.set(1.4, 0.04, 0.6);
    const scalePole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), lam(0x333333));
    scalePole.position.set(1.4, 0.5, 0.35);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16), lam(0xe8e3d6));
    dial.rotation.x = Math.PI / 2;
    dial.position.set(1.4, 0.95, 0.38);
    this.group.add(scaleBase, scalePole, dial);
    const sackColors = [0xe8e3d6, 0x2f6fb0, 0xd9cfa8];
    for (let i = 0; i < 3; i++) {
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 6), lam(sackColors[i]));
      sack.scale.set(1, 1.2, 1);
      sack.position.set(-1.3 + i * 0.25, 0.42, 0.5 - i * 0.5);
      sack.castShadow = true;
      this.group.add(sack);
    }
  }

  get position() { return this.group.position; }

  sell(inventory, mult = 1) {
    return inventory.sellAll(mult);
  }

  dispose() {
    disposeSceneGroup(this.scene, this.group);
  }
}