import * as THREE from 'three';

export const lam = color => new THREE.MeshLambertMaterial({ color, flatShading: true });

export function disposeSceneGroup(scene, group) {
  scene.remove(group);
  group.traverse(object => {
    object.geometry?.dispose?.();
    object.material?.map?.dispose?.();
    object.material?.dispose?.();
  });
}
