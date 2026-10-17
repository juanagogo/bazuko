// src/utils/WorldClip.js
// Planos de recorte globales del mundo jugable: los vehículos "entran/salen" por los muros del perímetro sin
// verse fuera del mundo. Un solo juego de 4 planos compartido por buses y autos (un fragmento se descarta si
// queda fuera de cualquiera de ellos).
import * as THREE from 'three';
import { WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Z, WORLD_MAX_Z } from './constants.js';

let _planes = null;
export function getWorldClipPlanes() {
  if (!_planes) {
    _planes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -WORLD_MIN_X),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), WORLD_MAX_X),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -WORLD_MIN_Z),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), WORLD_MAX_Z)
    ];
  }
  return _planes;
}
