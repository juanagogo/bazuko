// src/world/World.js
import { ZonaCero } from './districts/ZonaCero.js';
import { Bogota } from './districts/Bogota.js';

const DISTRICT_CLASSES = {
  ZonaCero: ZonaCero,
  Bogota: Bogota
  // Industrial, Centro, Norte → fase 2
};

export class World {
  constructor(scene) {
    this.scene = scene;
    this.active = null;
    this.activeName = null;
  }

  loadDistrict(name, collisions) {
    if (this.activeName === name) return;
    if (this.active) this.active.dispose(this.scene);

    const Cls = DISTRICT_CLASSES[name];
    if (!Cls) {
      console.warn(`Distrito ${name} no existe`);
      return;
    }

    this.active = new Cls();
    this.active.build(this.scene, collisions);
    this.activeName = name;
  }

  update(dt, playerPos, camera, trafficVehicles = [], hour = null) {
    this.active?.update(dt, playerPos, camera, trafficVehicles, hour);
  }
}
