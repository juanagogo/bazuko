// src/world/props/Farol.js
import * as THREE from 'three';
import { COLORS } from '../../utils/constants.js';

export class Farol {
  constructor(position, opts = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(position);

    const metalMat = new THREE.MeshLambertMaterial({
      color: 0x2a2a30,
      flatShading: true
    });

    // Poste
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4, 6);
    const pole = new THREE.Mesh(poleGeo, metalMat);
    pole.position.y = 2;
    pole.castShadow = true;
    this.group.add(pole);

    // Brazo
    const armGeo = new THREE.BoxGeometry(0.6, 0.08, 0.08);
    const arm = new THREE.Mesh(armGeo, metalMat);
    arm.position.set(0.3, 4, 0);
    this.group.add(arm);

    // Lámpara con material emisivo
    const lampGeo = new THREE.BoxGeometry(0.2, 0.15, 0.25);
    const lampMat = new THREE.MeshStandardMaterial({
      color: COLORS.ACCENT_AMBER,
      emissive: COLORS.ACCENT_AMBER,
      emissiveIntensity: 0.2,
      roughness: 0.3
    });
    this.lamp = new THREE.Mesh(lampGeo, lampMat);
    this.lamp.position.set(0.6, 3.9, 0);
    this.group.add(this.lamp);

    // Cono de luz volumétrica nocturna sutil
    const coneGeo = new THREE.CylinderGeometry(0.12, 1.4, 3.6, 10, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_AMBER,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    this.lightBeam = new THREE.Mesh(coneGeo, coneMat);
    this.lightBeam.position.set(0.6, 2.0, 0);
    this.lightBeam.visible = false;
    this.group.add(this.lightBeam);

    // Luz puntual (solo si no es de día — la controla el World)
    if (opts.addLight !== false) {
      this.light = new THREE.PointLight(COLORS.ACCENT_AMBER, 0, 9);
      this.light.position.set(0.6, 3.8, 0);
      this.group.add(this.light);
    }
  }

  /** Enciende/apaga la luz según hora */
  setNight(isNight) {
    if (this.light) {
      this.light.intensity = isNight ? 1.4 : 0;
    }
    if (this.lamp && this.lamp.material) {
      this.lamp.material.emissiveIntensity = isNight ? 2.8 : 0.2;
    }
    if (this.lightBeam) {
      this.lightBeam.visible = isNight;
      this.lightBeam.material.opacity = isNight ? 0.08 : 0.0;
    }
  }
}
