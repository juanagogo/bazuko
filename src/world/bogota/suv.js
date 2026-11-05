// src/world/bogota/suv.js
// Camioneta 4x4 negra de lujo, sin marca: alta, cuadrada y con vidrios polarizados. Sale del mismo constructor
// que la flota, con geometría compartida. El frente apunta a +X local, como makeVehicle.
import * as THREE from 'three';
import { makeVehicle } from './vehicles.js';

export const SUV_SIZE = { length: 5, width: 2.02 };

const WHEEL_R = 0.42;

/** @returns {{ group: THREE.Group, length: number, width: number, wheels: THREE.Object3D[], setBraking(on:boolean):void, setLights(on:boolean):void, dispose():void }} */
export function makeSuv() {
  const v = makeVehicle('carro', 0, { beams: false, model: 'camionetaNegra' });
  const [paint, glass] = v.wetMaterials;
  paint.color.set('#07080a');
  paint.metalness = .6; paint.roughness = .22; paint.clearcoat = 1; paint.clearcoatRoughness = .03;
  glass.color.set('#050709'); glass.opacity = .9;
  v.group.name = 'camioneta-negra';
  // makeVehicle no trae los espejos: los pone Car, y esta camioneta no pasa por Car. Su geometría ya está en coordenadas de la carrocería.
  const mirrors = new THREE.Mesh(v.mirrorGeometry, v.trimMaterial);
  mirrors.name = 'Carcasas y lunas de los retrovisores';
  v.bodyVisual.add(mirrors);
  let braking = false, lights = false;
  const tail = () => v.tailMat.color.set('#ff1a12').multiplyScalar(braking ? 3.5 : lights ? 1.2 : .14);
  return {
    group: v.group, length: v.length, width: v.width, wheels: v.wheels,
    setBraking(on) { braking = on; tail(); },
    setLights(on) {
      lights = on; tail();
      v.headlightMaterial.emissiveIntensity = on ? 1.6 : .02;
      for (const flare of v.flares) flare.visible = on;
    },
    dispose() { v.dispose(); v.group.removeFromParent(); }
  };
}

/** Las ruedas giran con lo recorrido */
export const rollWheels = (suv, distance) => { for (const w of suv.wheels) w.rotation.z -= distance / WHEEL_R; };
