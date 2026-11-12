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

    // ===== Dos trabajadoras sexuales paradas en el andén junto a la pared =====
    this.character = this._buildWorkerFigure(lam, false);
    this.character.position.set(1.15, 0, 0.25);
    this.character.rotation.y = -0.3;
    this.group.add(this.character);

    this.character2 = this._buildWorkerFigure(lam, true);
    this.character2.position.set(-1.15, 0, 0.25);
    this.character2.rotation.y = 0.3;
    this.group.add(this.character2);

    this._time = 0;
  }

  _buildWorkerFigure(lam, alt = false) {
    const char = new THREE.Group();

    // Botas altas de tacón
    const bootColor = alt ? 0x9d0208 : 0x111111;
    const lLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.8, 8), lam(bootColor));
    lLeg.position.set(-0.1, 0.4, 0);
    char.add(lLeg);

    const rLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.8, 8), lam(bootColor));
    rLeg.position.set(0.1, 0.4, 0);
    char.add(rLeg);

    // Falda / vestido
    const dressColor = alt ? 0x590d22 : 0x800f2f;
    const dress = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 8), lam(dressColor));
    dress.position.set(0, 0.95, 0);
    char.add(dress);

    // Torso con chaqueta / abrigo
    const jacketColor = alt ? 0x222222 : 0xa4133c;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.44, 0.18), lam(jacketColor));
    torso.position.set(0, 1.25, 0);
    char.add(torso);

    // Brazos
    const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.46, 6), lam(jacketColor));
    lArm.position.set(-0.2, 1.2, 0);
    lArm.rotation.z = alt ? 0.2 : 0.1;
    char.add(lArm);

    const rArm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.46, 6), lam(jacketColor));
    rArm.position.set(0.2, 1.2, 0);
    rArm.rotation.z = -0.2;
    rArm.rotation.x = -0.35;
    char.add(rArm);

    // Cigarrillo encendido con brasa en la mano derecha
    const cig = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.09, 4), lam(0xffffff));
    cig.position.set(0.23, 1.34, 0.18);
    cig.rotation.x = Math.PI / 3;
    char.add(cig);

    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 4), new THREE.MeshBasicMaterial({ color: 0xff3300 }));
    ember.position.set(0.23, 1.38, 0.22);
    char.add(ember);

    // Cabeza
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), lam(0xdeb887));
    head.position.set(0, 1.57, 0);
    char.add(head);

    // Cabello estilizado
    const hairColor = alt ? 0x8b0000 : 0x1a0f08;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), lam(hairColor));
    hair.position.set(0, 1.6, -0.02);
    hair.scale.set(1, 1.2, 0.9);
    char.add(hair);

    return char;
  }

  update(dt) {
    this._time += dt || 0.016;
    if (this.character) {
      this.character.position.y = Math.sin(this._time * 1.5) * 0.01;
    }
    if (this.character2) {
      this.character2.position.y = Math.cos(this._time * 1.8) * 0.01;
    }
  }

  interactDistance(playerPos) {
    if (!this.group) return Infinity;
    const doorPos = new THREE.Vector3(0, 0, 0.4).applyMatrix4(this.group.matrixWorld);
    return Math.hypot(playerPos.x - doorPos.x, playerPos.z - doorPos.z);
  }
}
