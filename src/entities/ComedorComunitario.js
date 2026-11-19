// src/entities/ComedorComunitario.js
// Comedor Comunitario: Almuerzo caliente gratuito cada 5 minutos.
import * as THREE from 'three';
import { signMesh } from '../utils/signs.js';
import { addComedorCounter } from './comedorMostrador.js';

export const COMEDOR_NAME = 'Comedor Comunitario';

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

    addComedorCounter(this.group);

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

  /** El mostrador mira a +Z y se atiende desde el borde libre de la plataforma. */
  get gpsWaypoint() {
    const { x, z } = this.position;
    return { x, z: z + 1.65, access: { x, z: z + 2 }, arrivalDistance: 1.2 };
  }

  acceptsGpsArrival(position, interactionTarget) {
    return interactionTarget === this && position.z > this.position.z;
  }

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
