import * as THREE from 'three';

export function textureSet({ emissive = true } = {}) {
  const textures = { map: new THREE.Texture(), bumpMap: new THREE.Texture() };
  if (emissive) textures.emissiveMap = new THREE.Texture();
  return textures;
}

export const groundTextureSet = () => textureSet({ emissive: false });

export function resetTestWindow() {
  globalThis.window = new EventTarget();
}
