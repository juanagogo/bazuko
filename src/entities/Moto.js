// src/entities/Moto.js
// Una moto que circula. La geometría, el material y el lote viven en motos.js: aquí solo van sus datos y su puesto,
// que es lo que el tráfico mueve como a cualquier vehículo.
import * as THREE from 'three';
import { MOTO_SIZES } from '../world/bogota/motos.js';

export class Moto {
  constructor(position, rotation, { variant, occupancy, helmets, color }) {
    this.isMoto = true;
    this.kind = 'moto';
    this.variant = variant;
    this.occupancy = occupancy;
    this.helmets = helmets;
    this.color = new THREE.Color(color);
    this.length = MOTO_SIZES[variant].length;
    this.width = MOTO_SIZES[variant].width;
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
