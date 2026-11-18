// src/entities/ZonaRoja.js
// Zona Roja / Callejón: Fachada integrada al edificio existente sobre el andén.
import * as THREE from 'three';
import { signMesh } from '../utils/signs.js';

export class ZonaRoja {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'prostibulo';
    this.title = 'Zona Roja';

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.position = this.group.position;
    scene.add(this.group);

    const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

    // Marco del portal / entrada integrada a la pared de ladrillo existente
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.4, 0.08), lam(0x181114));
    frame.position.set(0, 1.2, 0.04);
    this.group.add(frame);

    // Cortinaje rojo de entrada
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.22, 0.04), lam(0x800f2f));
    curtain.position.set(0, 1.11, 0.08);
    this.group.add(curtain);

    // Toldo / marquesina delgada de metal sobre la entrada
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.65), lam(0x1a1a1a));
    canopy.position.set(0, 2.42, 0.32);
    canopy.rotation.x = 0.12;
    this.group.add(canopy);

    // Tubo de neón rojo intenso bajo el toldo
    const neonTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff1744 })
    );
    neonTube.rotation.z = Math.PI / 2;
    neonTube.position.set(0, 2.36, 0.45);
    this.group.add(neonTube);

    // Luz ambiental roja que baña la pared de ladrillo y el andén
    const redLight = new THREE.PointLight(0xff1744, 2.8, 7);
    redLight.position.set(0, 2.1, 0.6);
    this.group.add(redLight);

    // Letrero de neón plano montado directamente sobre la pared
    const sign = signMesh({
      title: 'ZONA ROJA · HABITACIONES',
      sub: 'SERVICIO $20.000 · ENTRADA DISCRETA',
      bg: '#2b000d',
      fg: '#ff4d6d',
      accent: '#ff85a1',
      w: 1024,
      h: 256
    }, 2.6);
    sign.position.set(0, 2.82, 0.06);
    this.group.add(sign);
  }

  update(dt) {}

  interactDistance(playerPos) {
    if (!this.group) return Infinity;
    const doorPos = new THREE.Vector3(0, 0, 0.4).applyMatrix4(this.group.matrixWorld);
    return Math.hypot(playerPos.x - doorPos.x, playerPos.z - doorPos.z);
  }
}
