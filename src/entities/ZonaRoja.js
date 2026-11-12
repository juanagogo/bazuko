// src/entities/ZonaRoja.js
// Zona Roja / Callejón: Servicio de compañía y habitaciones privadas.
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

    // Fachada de callejón oscuro
    const wall = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.4, 0.4), lam(0x2b2326));
    wall.position.set(0, 1.7, 0);
    wall.castShadow = wall.receiveShadow = true;
    this.group.add(wall);

    // Entrada con cortinas o marco rojizo
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.3, 0.46), lam(0x181114));
    doorFrame.position.set(0, 1.15, 0);
    this.group.add(doorFrame);

    const curtain = new THREE.Mesh(new THREE.BoxGeometry(1.44, 2.2, 0.1), lam(0x800f2f));
    curtain.position.set(0, 1.1, 0.2);
    this.group.add(curtain);

    // Toldo o marquesina de metal sobre la entrada
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.9), lam(0x111111));
    canopy.position.set(0, 2.35, 0.5);
    canopy.rotation.x = 0.1;
    this.group.add(canopy);

    // Tubo de neón rojo intenso (luz de ambiente nocturno)
    const neonTube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 8), new THREE.MeshBasicMaterial({ color: 0xff1744 }));
    neonTube.rotation.z = Math.PI / 2;
    neonTube.position.set(0, 2.25, 0.6);
    this.group.add(neonTube);

    const redLight = new THREE.PointLight(0xff1744, 2.4, 8);
    redLight.position.set(0, 2.2, 0.8);
    this.group.add(redLight);

    // Letrero de neón
    const sign = signMesh({
      title: 'ZONA ROJA · HABITACIONES',
      sub: 'SERVICIO $20.000 · ENTRADA DISCRETA',
      bg: '#33000f',
      fg: '#ff4d6d',
      accent: '#ff85a1',
      w: 1024,
      h: 256
    }, 3.0);
    sign.position.set(0, 2.85, 0.24);
    this.group.add(sign);

    // Columna de luz roja / Baliza de neón visible en el cielo desde toda la manzana
    const redBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 14, 8),
      new THREE.MeshBasicMaterial({ color: 0xff0055, transparent: true, opacity: 0.85 })
    );
    redBeacon.position.set(0, 9, 0.4);
    this.group.add(redBeacon);

    const redBeaconOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff0055 })
    );
    redBeaconOrb.position.set(0, 16, 0.4);
    this.group.add(redBeaconOrb);

    const tallLight = new THREE.PointLight(0xff0055, 3.5, 22);
    tallLight.position.set(0, 4, 1.2);
    this.group.add(tallLight);

    // ===== Personaje 3D: Trabajadora de la zona roja parada afuera =====
    this.character = this._buildWorkerFigure(lam);
    this.character.position.set(0.9, 0, 0.6);
    this.character.rotation.y = -0.4;
    this.group.add(this.character);

    // Segunda figura acompañando al lado izquierdo
    this.character2 = this._buildWorkerFigure(lam, true);
    this.character2.position.set(-0.95, 0, 0.6);
    this.character2.rotation.y = 0.35;
    this.group.add(this.character2);

    this._time = 0;
  }

  _buildWorkerFigure(lam, alt = false) {
    const char = new THREE.Group();

    // Botas altas de tacón
    const bootColor = alt ? 0x9d0208 : 0x111111;
    const lLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.8, 8), lam(bootColor));
    lLeg.position.set(-0.11, 0.4, 0);
    char.add(lLeg);

    const rLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.8, 8), lam(bootColor));
    rLeg.position.set(0.11, 0.4, 0);
    char.add(rLeg);

    // Falda / vestido
    const dressColor = alt ? 0x590d22 : 0x800f2f;
    const dress = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.4, 8), lam(dressColor));
    dress.position.set(0, 0.95, 0);
    char.add(dress);

    // Torso con chaqueta / abrigo
    const jacketColor = alt ? 0x222222 : 0xa4133c;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.45, 0.2), lam(jacketColor));
    torso.position.set(0, 1.25, 0);
    char.add(torso);

    // Brazos
    const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.48, 6), lam(jacketColor));
    lArm.position.set(-0.21, 1.2, 0);
    lArm.rotation.z = alt ? 0.2 : 0.1;
    char.add(lArm);

    const rArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.48, 6), lam(jacketColor));
    rArm.position.set(0.21, 1.2, 0);
    rArm.rotation.z = -0.2;
    rArm.rotation.x = -0.4; // Mano hacia adelante
    char.add(rArm);

    // Cigarrillo encendido con brasa roja en la mano derecha
    const cig = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 4), lam(0xffffff));
    cig.position.set(0.24, 1.35, 0.2);
    cig.rotation.x = Math.PI / 3;
    char.add(cig);

    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), new THREE.MeshBasicMaterial({ color: 0xff3300 }));
    ember.position.set(0.24, 1.39, 0.24);
    char.add(ember);

    // Cabeza
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), lam(0xdeb887));
    head.position.set(0, 1.58, 0);
    char.add(head);

    // Cabello estilizado largo
    const hairColor = alt ? 0x8b0000 : 0x1a0f08;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), lam(hairColor));
    hair.position.set(0, 1.62, -0.02);
    hair.scale.set(1, 1.2, 0.9);
    char.add(hair);

    return char;
  }

  update(dt) {
    this._time += dt || 0.016;
    // Respiración o movimiento sutil de las figuras
    if (this.character) {
      this.character.position.y = Math.sin(this._time * 1.5) * 0.01;
    }
    if (this.character2) {
      this.character2.position.y = Math.cos(this._time * 1.8) * 0.01;
    }
  }

  interactDistance(playerPos) {
    if (!this.group) return Infinity;
    const doorPos = new THREE.Vector3(0, 0, 0.5).applyMatrix4(this.group.matrixWorld);
    return Math.hypot(playerPos.x - doorPos.x, playerPos.z - doorPos.z);
  }
}

