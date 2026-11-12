// src/entities/ResidenciaElCarmen.js
// Residencias El Carmen: Fachada integrada al edificio existente sobre el andén.
import * as THREE from 'three';
import { signMesh } from '../utils/signs.js';

export class ResidenciaElCarmen {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'residencia';
    this.title = 'Residencias El Carmen';

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.position = this.group.position;
    scene.add(this.group);

    const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

    // Marco del zaguán integrado plano contra la pared de ladrillo
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.34, 0.08), lam(0x231d19));
    frame.position.set(0, 1.17, 0.04);
    this.group.add(frame);

    // Puerta de madera pesada de inquilinato
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.42, 2.2, 0.04), lam(0x382618));
    door.position.set(0, 1.1, 0.07);
    this.group.add(door);

    // Reja o mirilla de bronce en la puerta
    const peephole = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.06), lam(0xd4af37));
    peephole.position.set(0, 1.45, 0.08);
    this.group.add(peephole);

    // Manija y aldaba
    const knocker = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8), lam(0x111111));
    knocker.position.set(0.42, 1.05, 0.1);
    this.group.add(knocker);

    // Grada o escalón de piedra en la entrada
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 0.35), lam(0x7a746c));
    step.position.set(0, 0.07, 0.2);
    step.receiveShadow = true;
    this.group.add(step);

    // Farol de entrada con luz cálida
    const lampBracket = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.2), lam(0x1a1a1a));
    lampBracket.position.set(-0.82, 2.05, 0.12);
    this.group.add(lampBracket);

    const lampGlass = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.16), new THREE.MeshBasicMaterial({ color: 0xffe29a }));
    lampGlass.position.set(-0.82, 2.0, 0.22);
    this.group.add(lampGlass);

    const warmLight = new THREE.PointLight(0xffb74d, 1.8, 6);
    warmLight.position.set(-0.82, 2.0, 0.35);
    this.group.add(warmLight);

    // Letrero iluminado estilo comercial bogotano
    const sign = signMesh({
      title: 'RESIDENCIAS EL CARMEN',
      sub: 'PIEZAS $10.000 · DESCANSO SEGURO',
      bg: '#0f2942',
      fg: '#ffffff',
      accent: '#f6ad55',
      w: 1024,
      h: 256
    }, 2.6);
    sign.position.set(0, 2.7, 0.06);
    this.group.add(sign);
  }

  update() {}

  interactDistance(playerPos) {
    if (!this.group) return Infinity;
    const doorPos = new THREE.Vector3(0, 0, 0.4).applyMatrix4(this.group.matrixWorld);
    return Math.hypot(playerPos.x - doorPos.x, playerPos.z - doorPos.z);
  }
}
