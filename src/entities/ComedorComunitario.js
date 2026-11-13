// src/entities/ComedorComunitario.js
// Comedor Comunitario: Almuerzo caliente gratuito cada 24 horas.
import * as THREE from 'three';
import { signMesh } from '../utils/signs.js';

export class ComedorComunitario {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'comedor';

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

    // Base / Plataforma
    const platform = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 2.2), lam(0x8a857b));
    platform.position.set(0, 0.075, 0);
    platform.receiveShadow = true;
    this.group.add(platform);

    // Mostrador de atención y reparto
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.7), lam(0x3a5a40));
    counter.position.set(0, 0.52, 0.3);
    counter.castShadow = counter.receiveShadow = true;
    this.group.add(counter);

    // Borde superior del mostrador (acero / madera clara)
    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.08, 0.8), lam(0xdad7cd));
    counterTop.position.set(0, 0.98, 0.3);
    counterTop.castShadow = true;
    this.group.add(counterTop);

    // Gran olla comunitaria de sancocho (aluminio)
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.45, 12), lam(0xb0b0b0));
    pot.position.set(-0.65, 1.22, 0.3);
    pot.castShadow = true;
    this.group.add(pot);

    // Tapa / Caldo humeante en la olla
    const soup = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 12), lam(0xd4a373));
    soup.position.set(-0.65, 1.42, 0.3);
    this.group.add(soup);

    // Cazo / Cucharón grande
    const ladleHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), lam(0x555555));
    ladleHandle.position.set(-0.55, 1.55, 0.3);
    ladleHandle.rotation.z = 0.35;
    this.group.add(ladleHandle);

    // Bandejas de comida
    for (let i = 0; i < 3; i++) {
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.28), lam(0xd0d0d0));
      tray.position.set(0.1 + i * 0.42, 1.04, 0.3);
      this.group.add(tray);
    }

    // Estantería trasera con víveres (arroz, plátano, verduras)
    const backShelf = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 0.35), lam(0x582f0e));
    backShelf.position.set(0, 0.95, -0.7);
    backShelf.castShadow = true;
    this.group.add(backShelf);

    // Cajas de alimentos
    const foodColors = [0xe76f51, 0xf4a261, 0xe9c46a, 0x2a9d8f, 0xa7c957];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        const foodBox = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.3, 0.25),
          lam(foodColors[(i + row * 2) % foodColors.length])
        );
        foodBox.position.set(-0.9 + i * 0.45, 0.7 + row * 0.55, -0.6);
        this.group.add(foodBox);
      }
    }

    // Toldo institucional (franjas amarillo y rojo Bogotá)
    const awning = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.05, 1.8),
        lam(i % 2 === 0 ? 0xc0392b : 0xf2c600)
      );
      stripe.position.set(-1.33 + i * 0.38, 0, 0);
      awning.add(stripe);
    }
    awning.position.set(0, 2.35, -0.1);
    awning.rotation.x = 0.2;
    awning.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(awning);

    // 4 Postes esquineros
    for (const x of [-1.4, 1.4]) {
      for (const z of [-0.85, 0.75]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), lam(0x333333));
        post.position.set(x, 1.2, z);
        post.castShadow = true;
        this.group.add(post);
      }
    }

    // Letrero oficial
    const sign = signMesh({
      title: 'COMEDOR COMUNITARIO',
      sub: 'ALCALDÍA MAYOR - INTEGRACIÓN SOCIAL',
      bg: '#991b1b',
      fg: '#ffffff',
      accent: '#fef08a'
    }, 2.8);
    sign.position.set(0, 2.7, 0.2);
    this.group.add(sign);

    // Luz cálida del local
    const light = new THREE.PointLight(0xffeedd, 2.8, 8);
    light.position.set(0, 2.1, 0.2);
    this.group.add(light);
  }

  get position() { return this.group.position; }

  update() {}

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
    this.group.clear();
  }
}
