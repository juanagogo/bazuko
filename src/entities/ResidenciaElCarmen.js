// src/entities/ResidenciaElCarmen.js
// Residencias El Carmen: Piezas de inquilinato para descansar seguro sin robos ni frío.
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

    // Fachada del zaguán / entrada
    const wall = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 0.4), lam(0x593d2e));
    wall.position.set(0, 1.6, 0);
    wall.castShadow = wall.receiveShadow = true;
    this.group.add(wall);

    // Marco del portón principal
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.3, 0.46), lam(0x231d19));
    frame.position.set(0, 1.15, 0);
    this.group.add(frame);

    // Puerta de madera pesada de inquilinato
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.36, 2.18, 0.1), lam(0x382618));
    door.position.set(0, 1.1, 0.2);
    door.castShadow = true;
    this.group.add(door);

    // Reja o mirilla de bronce en la puerta
    const peephole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.12), lam(0xd4af37));
    peephole.position.set(0, 1.45, 0.2);
    this.group.add(peephole);

    // Manija y aldaba
    const knocker = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), lam(0x111111));
    knocker.position.set(0.45, 1.05, 0.25);
    this.group.add(knocker);

    // Grada o escalón de entrada
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.7), lam(0x7a746c));
    step.position.set(0, 0.09, 0.45);
    step.receiveShadow = true;
    this.group.add(step);

    // Farol de entrada con luz cálida
    const lampBracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.25), lam(0x1a1a1a));
    lampBracket.position.set(-0.85, 2.1, 0.3);
    this.group.add(lampBracket);

    const lampGlass = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.18), new THREE.MeshBasicMaterial({ color: 0xffe29a }));
    lampGlass.position.set(-0.85, 2.05, 0.42);
    this.group.add(lampGlass);

    const warmLight = new THREE.PointLight(0xffb74d, 1.5, 6);
    warmLight.position.set(-0.85, 2.05, 0.6);
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
    }, 2.8);
    sign.position.set(0, 2.7, 0.24);
    this.group.add(sign);
  }

  update() {}
}

