// src/entities/Moto.js
// Una moto que circula. La geometría, el material y el lote viven en motos.js: aquí solo van sus datos y su puesto,
// que es lo que el tráfico mueve como a cualquier vehículo.
import * as THREE from 'three';
import { MOTO_COLLIDERS, MOTO_SIZES } from '../world/bogota/motos.js';

export class Moto {
  constructor(position, rotation, { variant, occupancy, helmets, kids, bags, packs, cloth, color, phase = 0 }) {
    this.isMoto = true;
    this.kind = 'moto';
    this.variant = variant;
    // Cinco puestos: 0 el conductor, 1 el niño del tanque y 2 a 4 los de atrás.
    this.occupancy = occupancy ?? [true, false, false, false, false];
    this.helmets = helmets ?? [false, false, false, false, false];
    this.kids = kids ?? [false, false, false, false, false];
    this.bags = bags ?? [false, false, false, false, false];
    this.packs = packs ?? [false, false, false, false, false];
    this.cloth = cloth ?? [0, 0, 0, 0, 0];
    this.phase = phase;
    this.color = new THREE.Color(color);
    this.length = MOTO_SIZES[variant].length;
    this.width = MOTO_SIZES[variant].width;
    this.collider = MOTO_COLLIDERS[variant];
    this.drawn = true;
    // Sin padre en la escena: el lote dibuja la moto y este grupo solo guarda dónde va.
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = rotation;
  }

  get position() { return this.group.position; }

  /** El cargador de modelos pregunta por cada vehículo; la moto no tiene GLB que esperar. */
  preloadModel() { return Promise.resolve(); }

  setDrawn(drawn) {
    if (this.drawn === drawn) return;
    this.drawn = drawn;
    this.group.visible = drawn;
  }

  updateLod() {}

  /** El tráfico mueve a la moto; aquí no hay marcador de parqueado ni enfriamiento que avanzar. */
  update() {}

  animateDrive() {}

  dispose() {}
}
