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
    this._bogotaPopulation = null;
  }

  getPopulationSaveData() {
    return this.active?.getPopulationSaveData?.() ?? this._bogotaPopulation;
  }

  loadDistrict(name, collisions, population) {
    if (this.activeName === name) return;
    const Cls = DISTRICT_CLASSES[name];
    if (!Cls) {
      console.warn(`Distrito ${name} no existe`);
      return;
    }

    if (this.activeName === 'Bogota') this._bogotaPopulation = this.active.getPopulationSaveData();
    if (this.active) this.active.dispose(this.scene);
    this.active = new Cls(name === 'Bogota' ? population ?? this._bogotaPopulation : undefined);
    this.active.build(this.scene, collisions);
    this.activeName = name;
  }

  update(dt, playerPos, camera, trafficVehicles = []) {
    this.active?.update(dt, playerPos, camera, trafficVehicles);
  }
}
