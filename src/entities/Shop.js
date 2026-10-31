// src/entities/Shop.js
// Tienda La Esquinita: comida, remedios y materiales para el cambuche.
import * as THREE from 'three';
import { signMesh } from '../utils/signs.js';
import { disposeSceneGroup, lam } from '../utils/entityHelpers.js';

export class Shop {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'shop';

    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);


    // Mostrador
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.7), lam(0xe8e3d6));
    counter.position.set(0, 0.5, -0.3);
    counter.castShadow = counter.receiveShadow = true;
    this.group.add(counter);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.18, 0.72), lam(0xc0392b));
    stripe.position.set(0, 0.85, -0.3);
    this.group.add(stripe);

    // Estantería de fondo con productos de colores
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.9, 0.4), lam(0x6b4a2e));
    shelf.position.set(0, 0.95, -1.1);
    shelf.castShadow = true;
    this.group.add(shelf);
    const colors = [0xf2c600, 0xc0392b, 0x2f6fb0, 0x3f7a3a, 0xe0962b, 0xe8e3d6];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 7; i++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.28, 0.2),
          lam(colors[(i + row * 2) % colors.length])
        );
        box.position.set(-1 + i * 0.33, 0.55 + row * 0.55, -0.85);
        this.group.add(box);
      }
    }

    // Toldo a rayas
    const awning = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 1.5), lam(i % 2 ? 0xe8e3d6 : 0x2f6fb0));
      s.position.set(-1.12 + i * 0.45, 0, 0);
      awning.add(s);
    }
    awning.position.set(0, 2.3, -0.5);
    awning.rotation.x = 0.25;
    awning.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(awning);

    // Postes
    for (const x of [-1.2, 1.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), lam(0x333333));
      post.position.set(x, 1.15, 0.2);
      this.group.add(post);
    }

    // Letrero
    const sign = signMesh({ title: 'LA ESQUINITA', sub: 'TIENDA · MISCELÁNEA' }, 2.6);
    sign.position.set(0, 2.85, -0.4);
    this.group.add(sign);

    // Luz cálida del local
    const light = new THREE.PointLight(0xffd9a0, 3, 7);
    light.position.set(0, 2, 0.4);
    this.group.add(light);
  }

  get position() { return this.group.position; }

  update() {}

  dispose() {
    disposeSceneGroup(this.scene, this.group);
  }
}
