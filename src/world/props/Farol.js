// src/world/props/Farol.js
import * as THREE from 'three';
import { COLORS } from '../../utils/constants.js';
import { STREET_LAMP, acquireStreetLampAssets, releaseStreetLampAssets, setStreetLampNight, setStreetLampWetness } from '../bogota/StreetLampModel.js';

// A más altura la misma luz alcanzaría menos: se compensa para dejar igual el piso bajo el poste.
const LAMP_LIGHT = Object.freeze({ intensity: 34, range: 12, drop: .15 });

export class Farol {
  constructor(position, opts = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(position);
    if (opts.yaw) this.group.rotation.y = opts.yaw; // +X local queda hacia la calzada
    this.nightIntensity = 14;

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
      this.light = new THREE.PointLight(0xffd29a, 0, 9);
      this.light.position.set(0.6, 3.8, 0);
      this.group.add(this.light);
    }
  }

  /** Cambia el modelo liviano por el poste de la ciudad, compartido e instanciable. */
  preloadModel() {
    if (this.model) return Promise.resolve();
    const assets = acquireStreetLampAssets();
    this.model = new THREE.Group();
    this.model.name = 'Poste de alumbrado';
    const pole = new THREE.Mesh(assets.geometry, assets.material);
    pole.castShadow = true;
    pole.receiveShadow = true;
    const halo = new THREE.Mesh(assets.haloGeometry, assets.haloMaterial);
    halo.renderOrder = 12; // después de la ciudad de fondo (10) y los cerros (11), que no lo recorten
    this.model.add(pole, halo);
    for (const child of [...this.group.children]) {
      if (child === this.light) continue;
      this.group.remove(child);
      child.geometry?.dispose(); child.material?.dispose();
    }
    this.group.add(this.model);
    this.group.matrixAutoUpdate = true;
    if (this.light) {
      this.light.matrixAutoUpdate = this.light.matrixWorldAutoUpdate = true;
      this.light.position.set(STREET_LAMP.lens.x, STREET_LAMP.lens.y - LAMP_LIGHT.drop, 0);
      this.light.distance = LAMP_LIGHT.range;
      this.nightIntensity = LAMP_LIGHT.intensity;
      if (this.light.intensity > 0) this.light.intensity = this.nightIntensity;
    }
    // La noche pudo llegar antes que el modelo, al cargar una partida guardada.
    if (this.isNight !== undefined) setStreetLampNight(this.isNight);
    return Promise.resolve();
  }

  dispose() {
    if (!this.model) return;
    this.model.removeFromParent();
    this.model = null;
    releaseStreetLampAssets();
  }

  /** La humedad del piso es de toda la ciudad: un solo valor para todos los faroles. */
  static setWetness(amount) { setStreetLampWetness(amount); }

  setNight(isNight) {
    if (this.light) {
      // Candelas a la altura de la lámpara, con caída cuadrática: ver LAMP_LIGHT.
      this.light.intensity = isNight ? this.nightIntensity : 0;
    }
    this.isNight = isNight;
    if (this.model) setStreetLampNight(isNight);
    if (this.lamp && this.lamp.material) {
      this.lamp.material.emissiveIntensity = isNight ? 2.8 : 0.2;
    }
    if (this.lightBeam) {
      this.lightBeam.visible = isNight;
      this.lightBeam.material.opacity = isNight ? 0.08 : 0.0;
    }
  }
}
