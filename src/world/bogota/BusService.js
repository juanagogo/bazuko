import * as THREE from 'three';
import { articulatedBus, ARTICULATED_BUS_SIZE } from './props.js';
import { createImportedModel, disposeImportedInstance } from '../../utils/ImportedModels.js';

const ACCELERATION = 1.1, BRAKING = 4, CRUISE_SPEED = 5;
const STOP_SECONDS = 4, END_FADE_METERS = 6;

/** Servicio hacia el norte por el carril exclusivo, con relevo en los extremos. */
export class BusService {
  constructor({ x, startZ, endZ, stationZ = null, height = 0.02, groundHeight = null, pathX = null }) {
    if (startZ === endZ || (stationZ !== null && !(stationZ > Math.min(startZ,endZ) && stationZ < Math.max(startZ,endZ)))) throw new Error('La estación debe quedar dentro del recorrido del bus.');
    this.group = articulatedBus();
    this.group.userData.noMerge = true;
    this.group.name = 'Bus troncal Caracas';
    this.position = this.group.position;
    this.length = ARTICULATED_BUS_SIZE.length;
    this.width = ARTICULATED_BUS_SIZE.width;
    this.startZ = startZ;
    this.endZ = endZ;
    this.direction = Math.sign(endZ - startZ);
    this.stationZ = stationZ;
    this.height = height;
    this.groundHeight = groundHeight;
    this.laneX = x;
    this.pathX = pathX;
    this.position.set(x, groundHeight?.(x, startZ) ?? height, startZ);
    this.speed = 0;
    this.servedStation = stationZ === null;
    this.dwellRemaining = 0;
    this.materials = new Map();
    this.group.traverse(mesh => {
      if (!mesh.isMesh) return;
      const material = mesh.material;
      this.materials.set(material, material.opacity);
    });
    this._alignToGround();
    this._updateVisibility();
  }

  _clearance(position) {
    if (position.y + 1.8 < this.position.y - .2 || position.y > this.position.y + 3) return Infinity;
    const h = this.heading;
    const dx = position.x - this.position.x, dz = position.z - this.position.z;
    if (Math.abs(dx * -h.z + dz * h.x) > this.width / 2 + .55) return Infinity;
    const ahead = dx * h.x + dz * h.z;
    if (ahead < -this.length / 2 - .55) return Infinity;
    return Math.max(0, ahead - this.length / 2 - .8);
  }

  get heading() {
    const dx = this.pathX ? this.pathX(this.position.z + this.direction * .01, this.laneX) - this.pathX(this.position.z - this.direction * .01, this.laneX) : 0;
    const scale = Math.hypot(dx, .02);
    return { x: dx / scale, z: this.direction * .02 / scale };
  }

  _alignRoute() {
    this.position.x = this.pathX ? this.pathX(this.position.z, this.laneX) : this.laneX;
    const h = this.heading;
    const offset=this.collisionLateral??0;this.position.x-=h.z*offset;
    // YXZ conserva la inclinación de las rampas al girar sobre el eje vertical.
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = h.x === 0 ? (this.direction < 0 ? 0 : Math.PI) : Math.atan2(-h.x, -h.z);
  }

  preloadModel() {
    return this._modelPromise ??= createImportedModel('transmilenio', { ownMaterials: true }).then(model => {
      if (this._disposed) { disposeImportedInstance(model); return; }
      const geometries = new Set();
      this.group.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
      for (const child of [...this.group.children]) this.group.remove(child);
      for (const geometry of geometries) geometry.dispose();
      for (const material of this.materials.keys()) material.dispose();
      this.materials.clear();
      this.group.userData.wheels = [];
      this.model = model;
      this.group.add(model);
      model.traverse(object => {
        for (const material of [object.material].flat().filter(Boolean)) this.materials.set(material, material.opacity);
      });
      this._updateVisibility();
    });
  }

  dispose() {
    this._disposed = true;
    if (this.model) disposeImportedInstance(this.model);
  }

  _alignToGround() {
    this._alignRoute();
    if (this.groundHeight) {
      this.position.y = this.groundHeight(this.position.x, this.position.z);
      const h = this.heading;
      const front = this.groundHeight(this.position.x + h.x * this.length / 2, this.position.z + h.z * this.length / 2);
      const rear = this.groundHeight(this.position.x - h.x * this.length / 2, this.position.z - h.z * this.length / 2);
      this.group.rotation.x = Math.atan2(front - rear, this.length);
      // El chasis tiene longitud: sus ruedas delanteras alcanzan la rampa antes que el centro.
      // Cinco apoyos evitan que la carrocería corte el tablero en las entradas y la cresta.
      const slope = Math.tan(this.group.rotation.x);
      for (const fraction of [-.5, -.25, 0, .25, .5]) {
        const offset = fraction * this.length;
        this.position.y = Math.max(this.position.y,
          this.groundHeight(this.position.x - h.x * offset, this.position.z - h.z * offset) + offset * slope);
      }
    }
  }

  _updateVisibility() {
    // El relevo se desvanece en los extremos; nunca cruza los muros del perímetro.
    const opacity = THREE.MathUtils.clamp(Math.min(
      this.direction * (this.position.z - this.startZ) / END_FADE_METERS,
      this.direction * (this.endZ - this.position.z) / END_FADE_METERS), 0, 1);
    this.group.visible = opacity > 0;
    for (const [material, baseOpacity] of this.materials) {
      const transparent = opacity < 1;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = baseOpacity * opacity;
      material.depthWrite = !transparent;
    }
  }

  update(dt, { player = null, pedestrians = [], vehicles = [] } = {}) {
    this.personBlocked = false;
    let remaining = Math.min(Math.max(dt, 0), 0.5);
    while (remaining > 1e-8) {
      const step = Math.min(remaining, 0.05);
      remaining -= step;
      if (this.dwellRemaining > 0) {
        this.dwellRemaining = Math.max(0, this.dwellRemaining - step);
        continue;
      }
      const heading = this.heading;
      const zPerMeter = Math.abs(heading.z);
      let clearance = this.direction * (this.endZ - this.position.z) / zPerMeter;
      clearance = Math.min(clearance, this.signals?.busClearance(this.position, this.length, this.direction) ?? Infinity);
      if (!this.servedStation) clearance = Math.min(clearance, this.direction * (this.stationZ - this.position.z) / zPerMeter);
      let personClearance = player ? this._clearance(player) : Infinity;
      for (const npc of pedestrians) personClearance = Math.min(personClearance, this._clearance(npc.position));
      for (const { car } of vehicles) {
        if (car.position.y + 2 < this.position.y - .2 || car.position.y > this.position.y + 3) continue;
        const cos = Math.abs(Math.cos(car.group.rotation.y)), sin = Math.abs(Math.sin(car.group.rotation.y));
        const halfX = cos * car.length / 2 + sin * car.width / 2;
        const halfZ = sin * car.length / 2 + cos * car.width / 2;
        const dx = car.position.x - this.position.x, dz = car.position.z - this.position.z;
        const across = Math.abs(dx * -heading.z + dz * heading.x);
        const sideExtent = Math.abs(heading.z) * halfX + Math.abs(heading.x) * halfZ;
        const ahead = dx * heading.x + dz * heading.z;
        const frontExtent = Math.abs(heading.x) * halfX + Math.abs(heading.z) * halfZ;
        if (across > this.width / 2 + sideExtent + .2 || ahead < -this.length / 2 - frontExtent) continue;
        clearance = Math.min(clearance, Math.max(0, ahead - this.length / 2 - frontExtent - .8));
      }
      this.personBlocked = personClearance < 2.5 || personClearance < Math.min(clearance, 10);
      clearance = Math.min(clearance, personClearance);
      const desiredSpeed = Math.min(CRUISE_SPEED * Math.max(.6, zPerMeter), Math.sqrt(2 * BRAKING * Math.max(0, clearance)));
      const rate = desiredSpeed < this.speed ? BRAKING : ACCELERATION;
      this.speed = THREE.MathUtils.clamp(desiredSpeed, this.speed - rate * step, this.speed + rate * step);
      const travel = Math.min(this.speed * step, Math.max(0, clearance));
      this.position.z += travel * heading.z;
      this._alignRoute();
      this.speed = travel / step;
      for (const wheel of this.group.userData.wheels) wheel.rotateY(travel / 0.5);
      if (!this.servedStation && this.direction * (this.position.z - this.stationZ) >= -1e-8) {
        this.position.z = this.stationZ;
        this.servedStation = true;
        this.speed = 0;
        this.dwellRemaining = STOP_SECONDS;
      }
      if (this.direction * (this.position.z - this.endZ) >= -1e-8) {
        this.position.z = this.startZ;
        this.servedStation = this.stationZ === null;
        this.speed = 0;
      }
    }
    this.collisionLateral=(this.collisionLateral??0)*Math.exp(-Math.max(0,dt)*1.8);
    this._alignToGround();
    this._updateVisibility();
  }
}
